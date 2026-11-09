use crate::commands::{err, with_store, write_atomic, AppState, CmdResult};
use serde::{Deserialize, Serialize};
use std::{
    io::Read,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Manager};

const URL: &str = "https://models.dev/api.json";
const FILE: &str = "model-limits.json";
const MAX_BYTES: u64 = 32 * 1024 * 1024;
const MAX_MODELS: usize = 50_000;
const PAGE: usize = 40;
const PROVIDERS: &[&str] =
    &["anthropic", "openai", "google", "deepseek", "xai", "perplexity", "alibaba", "moonshotai", "github-copilot"];

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelLimit {
    provider_id: String,
    provider_name: String,
    id: String,
    name: String,
    window: u64,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Catalog {
    updated_at: Option<String>,
    models: Vec<ModelLimit>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPage {
    updated_at: Option<String>,
    total: usize,
    matches: usize,
    models: Vec<ModelLimit>,
}

#[derive(Default)]
pub struct LimitState {
    catalog: Mutex<Option<Arc<Catalog>>>,
    sync: Mutex<()>,
}

fn parse_catalog(body: &str) -> Result<Vec<ModelLimit>, String> {
    let json: serde_json::Value = serde_json::from_str(body).map_err(|e| format!("Invalid catalog JSON: {e}"))?;
    let providers = json.as_object().ok_or("Catalog must contain provider objects")?;
    let mut models = vec![];
    for (provider, data) in providers {
        if !PROVIDERS.contains(&provider.as_str()) {
            continue;
        }
        let Some(entries) = data.get("models").and_then(|v| v.as_object()) else { continue };
        let provider_name = data.get("name").and_then(|v| v.as_str()).unwrap_or(provider);
        for (id, value) in entries {
            if value
                .pointer("/modalities/output")
                .and_then(|v| v.as_array())
                .is_some_and(|a| !a.iter().any(|v| v.as_str() == Some("text")))
            {
                continue;
            }
            let limit = |key: &str| value.pointer(&format!("/limit/{key}")).and_then(|v| v.as_u64()).filter(|n| *n > 0);
            let Some(context) = limit("context") else { continue };
            let window = limit("input").map_or(context, |input| input.min(context));
            if window > 100_000_000 || id.is_empty() || id.len() > 500 || provider.len() > 200 {
                continue;
            }
            models.push(ModelLimit {
                provider_id: provider.clone(),
                provider_name: provider_name.into(),
                id: id.clone(),
                name: value.get("name").and_then(|v| v.as_str()).unwrap_or(id).into(),
                window,
            });
            if models.len() > MAX_MODELS {
                return Err("Catalog exceeds the supported model count".into());
            }
        }
    }
    if models.is_empty() {
        return Err("Catalog contains no text model limits".into());
    }
    models.sort_by(|a, b| (&a.provider_id, &a.id).cmp(&(&b.provider_id, &b.id)));
    Ok(models)
}

fn fetch() -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(25))
        .redirect(reqwest::redirect::Policy::limited(3))
        .user_agent("Hopilo/model-limit-sync")
        .https_only(true)
        .build()
        .map_err(|e| e.to_string())?;
    let response = client.get(URL).send().and_then(|r| r.error_for_status()).map_err(|e| e.to_string())?;
    let mut body = String::new();
    response.take(MAX_BYTES + 1).read_to_string(&mut body).map_err(|e| e.to_string())?;
    if body.len() as u64 > MAX_BYTES {
        return Err("Catalog exceeds 32 MiB".into());
    }
    Ok(body)
}

fn file(app: &AppHandle) -> CmdResult<PathBuf> {
    with_store(&app.state::<AppState>(), |s| Ok(s.root().join(FILE)))
}

fn catalog(app: &AppHandle) -> CmdResult<Arc<Catalog>> {
    let state = app.state::<LimitState>();
    let mut slot = state.catalog.lock().map_err(err)?;
    if let Some(catalog) = slot.as_ref() {
        return Ok(catalog.clone());
    }
    let mut loaded: Catalog = match std::fs::read(file(app)?) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => Catalog::default(),
    };
    loaded.models.retain(|m| PROVIDERS.contains(&m.provider_id.as_str()));
    let loaded = Arc::new(loaded);
    *slot = Some(loaded.clone());
    Ok(loaded)
}

fn search(catalog: &Catalog, query: &str) -> CatalogPage {
    let terms: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
    let mut matches = 0;
    let mut models = vec![];
    for m in &catalog.models {
        let haystack = format!("{}/{} {} {}", m.provider_id, m.id, m.name, m.provider_name).to_lowercase();
        if terms.iter().all(|t| haystack.contains(t.as_str())) {
            matches += 1;
            if models.len() < PAGE {
                models.push(m.clone());
            }
        }
    }
    CatalogPage { updated_at: catalog.updated_at.clone(), total: catalog.models.len(), matches, models }
}

#[tauri::command]
pub async fn search_model_limits(app: AppHandle, query: String) -> CmdResult<CatalogPage> {
    tauri::async_runtime::spawn_blocking(move || catalog(&app).map(|c| search(&c, &query))).await.map_err(err)?
}

#[tauri::command]
pub async fn sync_model_limits(app: AppHandle) -> CmdResult<CatalogPage> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<LimitState>();
        let _guard = state.sync.try_lock().map_err(|_| "A model limit sync is already running")?;
        let models = parse_catalog(&fetch()?)?;
        let next = Catalog { updated_at: Some(chrono::Utc::now().to_rfc3339()), models };
        write_atomic(&file(&app)?, &serde_json::to_vec(&next).map_err(err)?)?;
        let next = Arc::new(next);
        *state.catalog.lock().map_err(err)? = Some(next.clone());
        Ok(search(&next, ""))
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;

    const CATALOG: &str = r#"{
        "anthropic":{"name":"Anthropic","models":{
            "org/model-v1":{"name":"Model","limit":{"context":128000,"input":120000,"output":8000}},
            "no-limit":{"limit":{"context":0}},
            "audio":{"modalities":{"output":["audio"]},"limit":{"context":10000}}}},
        "openai":{"models":{"org/model-v1":{"limit":{"context":64000}}}},
        "openrouter":{"name":"OpenRouter","models":{"org/model-v1":{"limit":{"context":32000}}}}
    }"#;

    #[test]
    fn keeps_text_models_and_uses_the_smaller_input_limit() {
        let models = parse_catalog(CATALOG).unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!((models[0].provider_id.as_str(), models[0].window), ("anthropic", 120000));
        assert_eq!((models[1].provider_name.as_str(), models[1].window), ("openai", 64000));
        for bad in ["{}", "[]", "<html>Sign in</html>"] {
            assert!(parse_catalog(bad).is_err());
        }
    }

    #[test]
    fn loads_only_destination_providers() {
        assert!(parse_catalog(r#"{"openrouter":{"models":{"m":{"limit":{"context":1000}}}}}"#).is_err());
        let models = parse_catalog(CATALOG).unwrap();
        assert!(models.iter().all(|m| PROVIDERS.contains(&m.provider_id.as_str())));
        let providers: std::collections::HashSet<_> = PROVIDERS.iter().collect();
        assert_eq!(providers.len(), PROVIDERS.len());
    }

    #[test]
    fn search_matches_all_terms_and_caps_results() {
        let mut models = parse_catalog(CATALOG).unwrap();
        for i in 0..100 {
            models.push(ModelLimit {
                provider_id: "bulk".into(),
                provider_name: "Bulk".into(),
                id: format!("m{i}"),
                name: format!("m{i}"),
                window: 1000,
            });
        }
        let catalog = Catalog { updated_at: None, models };
        let page = search(&catalog, "ANTHROPIC model");
        assert_eq!((page.matches, page.models[0].id.as_str()), (1, "org/model-v1"));
        let page = search(&catalog, "bulk");
        assert_eq!((page.total, page.matches, page.models.len()), (102, 100, PAGE));
    }
}
