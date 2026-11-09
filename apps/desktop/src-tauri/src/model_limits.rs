//! On-demand metadata sync. Catalog coverage is data-driven; official adapters are supplements.
use crate::commands::{save_setting_blocking, AppState};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Read,
    sync::{LazyLock, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Manager};

const KEY: &str = "modelLimits";
const MAX_BYTES: u64 = 32 * 1024 * 1024;
const MAX_MODELS: usize = 50_000;
static SYNC_LOCK: Mutex<()> = Mutex::new(());
const SOURCES: [(&str, &str, &str); 6] = [
    ("models.dev", "models.dev community catalog", "https://models.dev/api.json"),
    ("claude", "Anthropic official supplement", "https://platform.claude.com/docs/en/about-claude/models/overview.md"),
    ("gpt-5", "OpenAI GPT-5 official supplement", "https://developers.openai.com/api/docs/models/gpt-5.md"),
    ("gemini", "Google Gemini 2.5 Pro official supplement", "https://aistudio.google.com/docs/models/gemini-2.5-pro"),
    ("deepseek", "DeepSeek official supplement", "https://api-docs.deepseek.com/quick_start/pricing.md"),
    ("grok", "xAI official supplement", "https://docs.x.ai/developers/models.md"),
];

fn provider_id(source: &str) -> &str {
    match source {
        "claude" => "anthropic",
        "gpt-5" => "openai",
        "gemini" => "google",
        "grok" => "xai",
        x => x,
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelLimit {
    #[serde(default)]
    provider_id: String,
    #[serde(default)]
    provider_name: String,
    id: String,
    #[serde(default)]
    name: String,
    window: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    input_limit: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    output_limit: Option<u64>,
    #[serde(default)]
    stale: bool,
}
impl ModelLimit {
    fn key(&self) -> (String, String) {
        (self.provider_id.clone(), self.id.clone())
    }
    fn valid(&self) -> bool {
        !self.provider_id.is_empty()
            && self.provider_id.trim() == self.provider_id
            && self.provider_id.len() <= 200
            && !self.id.is_empty()
            && self.id.trim() == self.id
            && self.id.len() <= 500
            && (1..=100_000_000).contains(&self.window)
            && self.input_limit.is_none_or(|n| n > 0 && n <= self.window)
            && self.output_limit.is_none_or(|n| n > 0 && n <= 100_000_000)
    }
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ProviderChange {
    id: String,
    name: String,
    added: usize,
    changed: usize,
    removed: usize,
    retained: usize,
    invalid: usize,
    models: usize,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SourceReport {
    id: String,
    name: String,
    url: String,
    kind: String,
    status: String,
    checked_at: String,
    updated_at: Option<String>,
    error: Option<String>,
    etag: Option<String>,
    last_modified: Option<String>,
    providers: Vec<ProviderChange>,
    models: Vec<ModelLimit>,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct LimitCache {
    version: u32,
    sources: Vec<SourceReport>,
}

fn parse_catalog(body: &str) -> Result<(Vec<ModelLimit>, BTreeMap<String, usize>), String> {
    let json: serde_json::Value = serde_json::from_str(body).map_err(|e| format!("Invalid catalog JSON: {e}"))?;
    let providers = json.as_object().filter(|v| !v.is_empty()).ok_or("Catalog must contain provider objects")?;
    let mut models = vec![];
    let mut invalid = BTreeMap::new();
    for (provider, data) in providers {
        let Some(entries) = data.get("models").and_then(|v| v.as_object()) else { continue };
        let provider_name = data.get("name").and_then(|v| v.as_str()).unwrap_or(provider);
        for (id, value) in entries {
            // Budgets cover text destinations. Non-text-only and decision models are not chat context windows.
            if value.get("type").and_then(|v| v.as_str()).is_some_and(|t| t != "chat") {
                continue;
            }
            if value
                .pointer("/modalities/output")
                .and_then(|v| v.as_array())
                .is_some_and(|a| !a.iter().any(|v| v.as_str() == Some("text")))
            {
                continue;
            }
            let n = |key: &str| value.get("limit").and_then(|v| v.get(key)).and_then(|v| v.as_u64());
            let m = ModelLimit {
                provider_id: provider.clone(),
                provider_name: provider_name.into(),
                id: id.clone(),
                name: value.get("name").and_then(|v| v.as_str()).unwrap_or(id).into(),
                window: n("context").unwrap_or(0),
                input_limit: n("input"),
                output_limit: n("output"),
                stale: false,
            };
            let invalid_optional = ["input", "output"].iter().any(|key| {
                value.get("limit").and_then(|v| v.get(key)).is_some_and(|v| !v.is_null() && v.as_u64().is_none())
            });
            if !m.valid() || invalid_optional {
                *invalid.entry(provider.clone()).or_default() += 1;
                continue;
            }
            models.push(m);
            if models.len() > MAX_MODELS {
                return Err("Catalog exceeds supported model count; previous cache retained".into());
            }
        }
    }
    if models.is_empty() {
        return Err("Catalog contains no valid text model limits; previous cache retained".into());
    }
    models.sort_by_key(ModelLimit::key);
    Ok((models, invalid))
}
static NUMBER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*([kKmM]?)\b").expect("valid number pattern"));

fn number(text: &str) -> Option<u64> {
    // Only accept an unambiguous leading token count, never prices or prose.
    let c = NUMBER.captures(text)?;
    let base: f64 = c[1].replace(',', "").parse().ok()?;
    let n = base
        * match c[2].to_lowercase().as_str() {
            "k" => 1000.,
            "m" => 1_000_000.,
            _ => 1.,
        };
    (n.fract() == 0. && (1024.0..=100_000_000.0).contains(&n)).then_some(n as u64)
}

fn cells(line: &str) -> Vec<&str> {
    line.trim().trim_matches('|').split('|').map(str::trim).collect()
}

fn transposed(body: &str, id_label: &str, context_label: &str, prefix: &str) -> Vec<ModelLimit> {
    let rows: Vec<_> = body.lines().filter(|l| l.trim_start().starts_with('|')).map(cells).collect();
    let Some(ids) = rows.iter().find(|r| r.first().is_some_and(|v| v.contains(id_label))) else { return vec![] };
    let Some(limits) = rows.iter().find(|r| r.first().is_some_and(|v| v.contains(context_label))) else {
        return vec![];
    };
    if ids.len() != limits.len() {
        return vec![];
    }
    let id_re = Regex::new(&format!(r"{}[a-zA-Z0-9.-]+", regex::escape(prefix))).unwrap();
    ids.iter()
        .zip(limits)
        .filter_map(|(id, limit)| {
            Some(ModelLimit {
                provider_id: if prefix == "claude-" { "anthropic" } else { "deepseek" }.into(),
                provider_name: String::new(),
                name: String::new(),
                output_limit: None,
                stale: false,
                id: id_re.find(id)?.as_str().to_owned(),
                window: number(limit)?,
                input_limit: None,
            })
        })
        .collect()
}

fn parse(id: &str, body: &str) -> Result<Vec<ModelLimit>, String> {
    let mut models = match id {
        "claude" => transposed(body, "Claude API ID", "Context window", "claude-"),
        "deepseek" => transposed(body, "MODEL", "CONTEXT LENGTH", "deepseek-"),
        "gpt-5" => {
            if !body.contains("Model ID: `gpt-5`") {
                return Err("Model ID missing from official document".into());
            }
            let window = body
                .lines()
                .find(|l| l.contains("context window"))
                .and_then(|l| number(l.trim_start_matches(['-', ' '])));
            let input_limit =
                body.lines().find_map(|l| l.split_once("Maximum input tokens:").and_then(|(_, n)| number(n)));
            window
                .map(|window| {
                    vec![ModelLimit {
                        provider_id: provider_id(id).into(),
                        provider_name: String::new(),
                        name: String::new(),
                        output_limit: None,
                        stale: false,
                        id: "gpt-5".into(),
                        window,
                        input_limit,
                    }]
                })
                .unwrap_or_default()
        }
        "gemini" => {
            if !body.contains("gemini-2.5-pro") {
                return Err("Model ID missing from official document".into());
            }
            let input = body.lines().find_map(|l| l.split_once("**Input token limit**").and_then(|(_, n)| number(n)));
            input
                .map(|window| {
                    vec![ModelLimit {
                        provider_id: provider_id(id).into(),
                        provider_name: String::new(),
                        name: String::new(),
                        output_limit: None,
                        stale: false,
                        id: "gemini-2.5-pro".into(),
                        window,
                        input_limit: Some(window),
                    }]
                })
                .unwrap_or_default()
        }
        "grok" => body
            .lines()
            .filter(|l| l.trim_start().starts_with('|'))
            .filter_map(|l| {
                let row = cells(l);
                let id = row.first()?.split_whitespace().next()?;
                if !id.starts_with("grok-") {
                    return None;
                }
                Some(ModelLimit {
                    provider_id: "xai".into(),
                    provider_name: "xAI".into(),
                    name: String::new(),
                    output_limit: None,
                    stale: false,
                    id: id.into(),
                    window: number(row.get(1)?)?,
                    input_limit: None,
                })
            })
            .collect(),
        _ => vec![],
    };
    models.sort_by(|a, b| a.id.cmp(&b.id));
    models.dedup_by(|a, b| a == b);
    if models.is_empty() || models.windows(2).any(|w| w[0].id == w[1].id) {
        return Err("No unambiguous model limits found; saved limits retained".into());
    }
    Ok(models)
}

enum Fetch {
    Modified(String, Option<String>, Option<String>),
    NotModified,
}
fn fetch(url: &str, old: Option<&SourceReport>) -> Result<Fetch, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(25))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5
                || attempt.url().scheme() != "https"
                || attempt.previous().first().is_some_and(|u| u.host_str() != attempt.url().host_str())
            {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .user_agent("Hopilo/model-limit-sync")
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client.get(url);
    if let Some(old) = old.filter(|s| !s.models.is_empty()) {
        if let Some(etag) = &old.etag {
            request = request.header(reqwest::header::IF_NONE_MATCH, etag);
        }
        if let Some(modified) = &old.last_modified {
            request = request.header(reqwest::header::IF_MODIFIED_SINCE, modified);
        }
    }
    let response = request.send().and_then(|r| r.error_for_status()).map_err(|e| e.to_string())?;
    if response.status() == reqwest::StatusCode::NOT_MODIFIED {
        return if old.is_some_and(|s| !s.models.is_empty()) {
            Ok(Fetch::NotModified)
        } else {
            Err("Source returned 304 without a saved cache".into())
        };
    }
    if response.status().is_redirection() {
        return Err("Unexpected redirect; previous cache retained".into());
    }
    let header = |key| response.headers().get(key).and_then(|v| v.to_str().ok()).map(str::to_owned);
    let etag = header(reqwest::header::ETAG);
    let modified = header(reqwest::header::LAST_MODIFIED);
    let mut body = String::new();
    response.take(MAX_BYTES + 1).read_to_string(&mut body).map_err(|e| e.to_string())?;
    if body.len() as u64 > MAX_BYTES {
        return Err("Metadata exceeds 32 MiB limit; previous cache retained".into());
    }
    Ok(Fetch::Modified(body, etag, modified))
}

fn merge_models(
    old: &[ModelLimit],
    new: Vec<ModelLimit>,
    invalid: BTreeMap<String, usize>,
) -> (Vec<ModelLimit>, Vec<ProviderChange>) {
    let mut previous: BTreeMap<_, _> = old.iter().map(|m| (m.key(), m.clone())).collect();
    let mut changes: BTreeMap<String, ProviderChange> = BTreeMap::new();
    let mut merged = vec![];
    for m in new {
        let c = changes.entry(m.provider_id.clone()).or_insert_with(|| ProviderChange {
            id: m.provider_id.clone(),
            name: m.provider_name.clone(),
            ..Default::default()
        });
        match previous.remove(&m.key()) {
            Some(old) if old != m => c.changed += 1,
            None => c.added += 1,
            _ => (),
        }
        c.models += 1;
        merged.push(m);
    }
    for (_, mut m) in previous {
        let c = changes.entry(m.provider_id.clone()).or_insert_with(|| ProviderChange {
            id: m.provider_id.clone(),
            name: m.provider_name.clone(),
            ..Default::default()
        });
        if !m.stale {
            c.removed += 1;
        }
        c.retained += 1;
        m.stale = true;
        merged.push(m);
    }
    for (id, count) in invalid {
        changes
            .entry(id.clone())
            .or_insert_with(|| ProviderChange { id: id.clone(), name: id, ..Default::default() })
            .invalid = count;
    }
    merged.sort_by_key(ModelLimit::key);
    (merged, changes.into_values().collect())
}

fn source_report(
    id: &str,
    name: &str,
    url: &str,
    old: Option<&SourceReport>,
    result: Result<Fetch, String>,
    now: &str,
) -> SourceReport {
    let kind = if id == "models.dev" { "catalog" } else { "official" };
    let mut report = SourceReport {
        id: id.into(),
        name: name.into(),
        url: url.into(),
        kind: kind.into(),
        status: "failed".into(),
        checked_at: now.into(),
        updated_at: old.and_then(|s| s.updated_at.clone()),
        models: old.map(|s| s.models.clone()).unwrap_or_default(),
        etag: old.and_then(|s| s.etag.clone()),
        last_modified: old.and_then(|s| s.last_modified.clone()),
        ..Default::default()
    };
    let parsed = match result {
        Ok(Fetch::NotModified) => {
            report.status = "unchanged".into();
            report.updated_at = Some(now.into());
            report.providers = old
                .map(|s| {
                    s.providers
                        .iter()
                        .map(|p| ProviderChange {
                            id: p.id.clone(),
                            name: p.name.clone(),
                            models: p.models,
                            retained: p.retained,
                            invalid: p.invalid,
                            ..Default::default()
                        })
                        .collect()
                })
                .unwrap_or_default();
            return report;
        }
        Ok(Fetch::Modified(body, etag, modified)) => {
            let parsed = if kind == "catalog" {
                parse_catalog(&body)
            } else {
                parse(id, &body).map(|mut models| {
                    for m in &mut models {
                        m.provider_name = name.replace(" official supplement", "");
                        m.name = m.id.clone();
                    }
                    (models, BTreeMap::new())
                })
            };
            parsed.map(|(models, invalid)| (models, invalid, etag, modified))
        }
        Err(e) => Err(e),
    };
    match parsed {
        Ok((models, invalid, etag, modified)) => {
            let (models, providers) = merge_models(&report.models, models, invalid);
            report.status =
                if providers.iter().any(|p| p.added + p.changed + p.removed > 0) { "updated" } else { "unchanged" }
                    .into();
            report.models = models;
            report.providers = providers;
            report.updated_at = Some(now.into());
            report.etag = etag;
            report.last_modified = modified;
        }
        Err(e) => report.error = Some(e),
    }
    report
}

fn previous_cache(app: &AppHandle) -> LimitCache {
    let mut cache: LimitCache =
        app.state::<AppState>().setting(KEY).and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
    for source in &mut cache.sources {
        if source.kind.is_empty() {
            source.kind = "official".into();
        }
        for model in &mut source.models {
            if model.provider_id.is_empty() {
                model.provider_id = provider_id(&source.id).into();
            }
            if model.provider_name.is_empty() {
                model.provider_name = source.name.clone();
            }
            if model.name.is_empty() {
                model.name = model.id.clone();
            }
        }
    }
    cache
}

#[tauri::command]
pub async fn sync_model_limits(app: AppHandle) -> Result<LimitCache, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = SYNC_LOCK.try_lock().map_err(|_| "A model metadata sync or import is already running")?;
        let previous = previous_cache(&app);
        let now = chrono::Utc::now().to_rfc3339();
        let mut sources: Vec<SourceReport> = std::thread::scope(|scope| {
            let jobs: Vec<_> = SOURCES
                .iter()
                .map(|&(id, name, url)| {
                    let old = previous.sources.iter().find(|s| s.id == id);
                    let now = &now;
                    scope.spawn(move || source_report(id, name, url, old, fetch(url, old), now))
                })
                .collect();
            jobs.into_iter()
                .map(|job| job.join().map_err(|_| "Model sync worker failed".to_string()))
                .collect::<Result<_, _>>()
        })?;
        sources.extend(previous.sources.into_iter().filter(|s| !SOURCES.iter().any(|(id, _, _)| *id == s.id)));
        let cache = LimitCache { version: 2, sources };
        save_setting_blocking(&app, KEY, serde_json::to_value(&cache).map_err(|e| e.to_string())?)?;
        Ok(cache)
    })
    .await
    .map_err(|e| e.to_string())?
}

type ImportParts = (Vec<ModelLimit>, BTreeMap<String, usize>, &'static str);

fn parse_import(json: &str) -> Result<ImportParts, String> {
    let value: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let parsed = if let Some(items) = value.get("models").and_then(|v| v.as_array()) {
        if items.is_empty() || items.len() > MAX_MODELS {
            return Err("Runtime report must contain 1–50,000 models".into());
        }
        let mut seen = BTreeSet::new();
        let mut models = vec![];
        for item in items {
            let mut m: ModelLimit = serde_json::from_value(item.clone()).map_err(|e| e.to_string())?;
            if !m.valid() || !seen.insert(m.key()) {
                return Err("Runtime report contains invalid or duplicate provider/model IDs".into());
            }
            m.stale = false;
            if m.name.is_empty() {
                m.name = m.id.clone();
            }
            if m.provider_name.is_empty() {
                m.provider_name = m.provider_id.clone();
            }
            models.push(m);
        }
        (models, BTreeMap::new(), "reported")
    } else {
        let (models, invalid) = parse_catalog(json)?;
        (models, invalid, "catalog")
    };

    Ok(parsed)
}

#[tauri::command]
pub async fn import_model_limits(app: AppHandle, json: String) -> Result<LimitCache, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = SYNC_LOCK.try_lock().map_err(|_| "A model metadata sync or import is already running")?;
        if json.len() as u64 > MAX_BYTES {
            return Err("Metadata exceeds 32 MiB limit".into());
        }
        let (models, invalid, kind) = parse_import(&json)?;
        let mut cache = previous_cache(&app);
        let id = if kind == "reported" { "runtime-import" } else { "catalog-import" };
        let now = chrono::Utc::now().to_rfc3339();
        let old = cache.sources.iter().find(|s| s.id == id);
        let (models, providers) = merge_models(old.map(|s| s.models.as_slice()).unwrap_or_default(), models, invalid);
        let report = SourceReport {
            id: id.into(),
            name: if kind == "reported" { "Imported runtime metadata" } else { "Imported models.dev catalog" }.into(),
            kind: kind.into(),
            status: if providers.iter().any(|p| p.added + p.changed + p.removed > 0) { "updated" } else { "unchanged" }
                .into(),
            checked_at: now.clone(),
            updated_at: Some(now),
            models,
            providers,
            ..Default::default()
        };
        cache.sources.retain(|s| s.id != id);
        cache.sources.push(report);
        cache.version = 2;
        save_setting_blocking(&app, KEY, serde_json::to_value(&cache).map_err(|e| e.to_string())?)?;
        Ok(cache)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn model(provider: &str, id: &str, window: u64) -> ModelLimit {
        ModelLimit {
            provider_id: provider.into(),
            provider_name: provider.into(),
            id: id.into(),
            name: id.into(),
            window,
            ..Default::default()
        }
    }
    const CATALOG: &str = r#"{"new-provider":{"name":"New Provider","models":{"org/model-v1":{"name":"Model","limit":{"context":128000,"input":120000,"output":8000}},"invalid":{"limit":{"context":0}},"audio":{"modalities":{"output":["audio"]},"limit":{"context":10000}}}},"other-provider":{"models":{"org/model-v1":{"limit":{"context":64000}}}}}"#;
    #[test]
    fn catalog_is_provider_agnostic_and_validates_limits() {
        let (models, invalid) = parse_catalog(CATALOG).unwrap();
        assert_eq!(models.len(), 2);
        assert_ne!(models[0].provider_id, models[1].provider_id);
        assert_eq!(models[0].id, "org/model-v1");
        assert_eq!(models[0].input_limit, Some(120000));
        assert_eq!(invalid["new-provider"], 1);
        for bad in
            ["{}", "[]", "<html>Sign in</html>", r#"{"x":{"models":{"bad":{"limit":{"context":100,"input":200}}}}}"#]
        {
            assert!(parse_catalog(bad).is_err());
        }
    }
    #[test]
    fn diffs_keep_removed_and_invalid_previous_entries_as_stale() {
        let old = vec![
            model("new-provider", "org/model-v1", 100000),
            model("new-provider", "invalid", 200000),
            model("gone", "old-model", 50000),
        ];
        let (new, invalid) = parse_catalog(CATALOG).unwrap();
        let (models, changes) = merge_models(&old, new, invalid);
        assert_eq!(models.len(), 4);
        assert_eq!(models.iter().filter(|m| m.stale).count(), 2);
        let p = changes.iter().find(|p| p.id == "new-provider").unwrap();
        assert_eq!((p.changed, p.removed, p.retained, p.invalid), (1, 1, 1, 1));
        assert_eq!(changes.iter().find(|p| p.id == "other-provider").unwrap().added, 1);
        let (new, invalid) = parse_catalog(CATALOG).unwrap();
        let (_, repeated) = merge_models(&models, new, invalid);
        assert!(repeated.iter().all(|p| p.added + p.changed + p.removed == 0));
    }
    #[test]
    fn failures_and_304_preserve_models_and_success_dates() {
        let old = source_report(
            "models.dev",
            "Catalog",
            "url",
            None,
            Ok(Fetch::Modified(CATALOG.into(), Some("etag".into()), None)),
            "2026-11-09T00:00:00Z",
        );
        let failed =
            source_report("models.dev", "Catalog", "url", Some(&old), Err("Offline".into()), "2026-11-10T00:00:00Z");
        assert_eq!(failed.models, old.models);
        assert_eq!(failed.updated_at, old.updated_at);
        assert_eq!(failed.status, "failed");
        let same =
            source_report("models.dev", "Catalog", "url", Some(&old), Ok(Fetch::NotModified), "2026-11-10T00:00:00Z");
        assert_eq!(same.models, old.models);
        assert_eq!(same.etag, old.etag);
        assert_eq!(same.status, "unchanged");
        assert_eq!(same.providers[0].added, 0);
        let malformed = source_report(
            "models.dev",
            "Catalog",
            "url",
            Some(&old),
            Ok(Fetch::Modified("{}".into(), None, None)),
            "today",
        );
        assert_eq!(malformed.models, old.models);
        assert_eq!(malformed.status, "failed");
    }
    #[test]
    fn cache_survives_serialization_and_legacy_fields_load() {
        let legacy = r#"{"sources":[{"id":"gpt-5","models":[{"id":"gpt-5","window":400000}]}]}"#;
        let cache: LimitCache = serde_json::from_str(legacy).unwrap();
        assert_eq!(cache.sources[0].models[0].window, 400000);
        let source = source_report(
            "models.dev",
            "Catalog",
            "url",
            None,
            Ok(Fetch::Modified(CATALOG.into(), None, None)),
            "today",
        );
        let cache = LimitCache { version: 2, sources: vec![source] };
        let restored: LimitCache = serde_json::from_value(serde_json::to_value(&cache).unwrap()).unwrap();
        assert_eq!(cache.sources[0].models, restored.sources[0].models);
    }
    #[test]
    fn offline_import_validates_reports_without_claiming_official_provenance() {
        let (models, _, kind) =
            parse_import(r#"{"models":[{"providerId":"custom-host","id":"org/model","window":64000,"stale":true}]}"#)
                .unwrap();
        assert_eq!(kind, "reported");
        assert_eq!(models[0].provider_id, "custom-host");
        assert_eq!(models[0].name, "org/model");
        assert!(!models[0].stale);
        assert_eq!(parse_import(CATALOG).unwrap().2, "catalog");
        for bad in [
            r#"{"models":[]}"#,
            r#"{"models":[{"id":"missing-provider","window":64000}]}"#,
            r#"{"models":[{"providerId":"x","id":"m","window":64,"inputLimit":128}]}"#,
            r#"{"models":[{"providerId":"x","id":"m","window":64000},{"providerId":"x","id":"m","window":32000}]}"#,
        ] {
            assert!(parse_import(bad).is_err());
        }
    }
    #[test]
    fn database_cache_and_custom_choice_survive_restart() {
        let dir = tempfile::tempdir().unwrap();
        let source = source_report(
            "models.dev",
            "Catalog",
            "url",
            None,
            Ok(Fetch::Modified(CATALOG.into(), None, None)),
            "2026-11-09T00:00:00Z",
        );
        let cache = LimitCache { version: 2, sources: vec![source] };
        let choice = serde_json::json!({ "other": { "providerId": "new-provider", "modelId": "org/model-v1", "appLimit": 64000 } });
        {
            let mut db = hopilo_database::Store::open(dir.path()).unwrap();
            db.set_setting(KEY, &serde_json::to_value(&cache).unwrap()).unwrap();
            db.set_setting("destinationBudgets", &choice).unwrap();
        }
        let db = hopilo_database::Store::open(dir.path()).unwrap();
        let settings = db.settings().unwrap();
        let restored: LimitCache = serde_json::from_value(settings[KEY].clone()).unwrap();
        assert_eq!(restored.sources[0].models, cache.sources[0].models);
        assert_eq!(settings["destinationBudgets"], choice);
    }
    #[test]
    fn official_supplements_preserve_provider_identity() {
        assert_eq!(
            parse("claude", "| Claude API ID | `claude-sonnet-4-5` |\n| [Context window](url) | 200K tokens |")
                .unwrap()[0]
                .provider_id,
            "anthropic"
        );
        assert_eq!(
            parse("deepseek", "| MODEL | deepseek-chat(1) |\n| CONTEXT LENGTH | 128K |").unwrap()[0].provider_id,
            "deepseek"
        );
        assert_eq!(
            parse("gpt-5", "Model ID: `gpt-5`\n- 400,000 context window\n- Maximum input tokens: 272,000").unwrap()[0]
                .input_limit,
            Some(272000)
        );
    }
    #[test]
    #[ignore = "Explicit online validation of broad catalog and official supplements"]
    fn live_metadata_sources() {
        for (id, name, url) in SOURCES {
            let report = source_report(id, name, url, None, fetch(url, None), "2026-11-09T00:00:00Z");
            assert_ne!(report.status, "failed", "{id}: {:?}", report.error);
            println!("{id}: {} records, {} providers", report.models.len(), report.providers.len());
            if id == "models.dev" {
                assert!(report.models.len() > 1000);
                assert!(report.providers.len() > 50);
            }
        }
    }
}
