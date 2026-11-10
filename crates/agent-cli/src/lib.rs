use std::fmt;

use hopilo_core::brief::ContextLevel;
use hopilo_core::render::{estimate_tokens, render_handoff_prompt, RenderOptions};
use hopilo_core::scan::{RedactionRules, Redactor};
use hopilo_core::Pack;
use hopilo_database::{DbError, SessionQuery, Store};
use serde::Serialize;

pub mod mcp;

pub const SETTINGS_KEY: &str = "agentAccess";
pub const DEFAULT_LIMIT: usize = 20;
pub const MAX_LIMIT: usize = 50;
pub const MAX_IDS: usize = 20;
pub const MAX_TEXT: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentError {
    pub code: &'static str,
    pub message: String,
}

impl AgentError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }

    fn library(e: impl fmt::Display) -> Self {
        Self::new("library", format!("Could not read the Hopilo library: {e}"))
    }
}

impl fmt::Display for AgentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} ({})", self.message, self.code)
    }
}

impl std::error::Error for AgentError {}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Access {
    pub enabled: bool,
    pub selected: Option<Vec<String>>,
}

impl Access {
    pub fn load(store: &Store) -> Access {
        let Some(v) = store.settings().ok().and_then(|s| s.get(SETTINGS_KEY).cloned()) else {
            return Access::default();
        };
        let selected = (v.get("mode").and_then(|m| m.as_str()) == Some("selected")).then(|| {
            let mut ids: Vec<String> = v
                .get("sessions")
                .and_then(|p| p.as_array())
                .map(|a| a.iter().filter_map(|s| s.as_str()).filter(|s| valid_id(s)).map(str::to_string).collect())
                .unwrap_or_default();
            ids.sort();
            ids.dedup();
            ids
        });
        Access { enabled: v.get("enabled").and_then(|e| e.as_bool()).unwrap_or(false), selected }
    }

    pub fn require(self) -> Result<Access, AgentError> {
        if !self.enabled {
            return Err(AgentError::new(
                "agent_access_disabled",
                "Agent access is turned off. Turn it on in Hopilo → Settings → Agent access.",
            ));
        }
        Ok(self)
    }

    pub fn allows(&self, id: &str) -> bool {
        self.selected.as_ref().is_none_or(|ids| ids.iter().any(|s| s == id))
    }
}

pub fn normalize_root(path: &str) -> Option<String> {
    let trimmed = path.trim();
    let stripped = trimmed.trim_end_matches(['/', '\\']);
    if stripped.is_empty() || stripped.ends_with(':') {
        return None;
    }
    Some(stripped.to_string())
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub provider: String,
    pub project: Option<String>,
    pub model: Option<String>,
    pub updated_at: String,
    pub message_count: i64,
    pub token_estimate: i64,
    pub file_count: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Handoff {
    pub title: String,
    pub text: String,
    pub token_estimate: usize,
    pub findings_redacted: usize,
    pub attach_manually: Vec<String>,
}

fn redactor(store: &Store) -> Redactor {
    let rules: RedactionRules = store
        .settings()
        .ok()
        .and_then(|s| s.get("redaction").cloned())
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    Redactor::new(&rules, []).0
}

pub fn search(
    store: &Store,
    project: Option<&str>,
    query: &str,
    limit: Option<usize>,
) -> Result<Vec<SessionSummary>, AgentError> {
    let access = Access::load(store).require()?;
    let roots = match project {
        Some(p) => Some(vec![normalize_root(p).ok_or_else(|| AgentError::new("bad_request", "project is empty"))?]),
        None => None,
    };
    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let page = store
        .query_sessions(&SessionQuery {
            q: query.chars().take(200).collect(),
            limit,
            project_roots: roots,
            ids: access.selected,
            rows_only: true,
            ..Default::default()
        })
        .map_err(AgentError::library)?;
    let red = redactor(store);
    Ok(page
        .rows
        .into_iter()
        .take(limit)
        .map(|r| SessionSummary {
            id: r.id,
            title: red.redact_text(&r.title),
            provider: r.provider,
            project: r.project,
            model: r.model,
            updated_at: r.updated_at,
            message_count: r.message_count,
            token_estimate: r.token_estimate,
            file_count: r.file_count,
        })
        .collect())
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric())
}

fn not_found(id: &str) -> AgentError {
    let shown: String = id.chars().take(64).collect();
    AgentError::new("not_found", format!("No session {shown} is available to agents."))
}

fn strip_local_paths(pack: &mut Pack) {
    for a in &mut pack.attachments {
        a.origin_path = None;
    }
    for s in &mut pack.sources {
        let is_web = s.origin.as_deref().is_some_and(|o| {
            let o = o.trim_start().to_ascii_lowercase();
            o.starts_with("https://") || o.starts_with("http://")
        });
        if !is_web {
            s.origin = None;
        }
    }
}

pub fn handoff(store: &Store, ids: &[String], level: ContextLevel) -> Result<Handoff, AgentError> {
    let access = Access::load(store).require()?;
    if ids.is_empty() {
        return Err(AgentError::new("bad_request", "Give at least one session id."));
    }
    if ids.len() > MAX_IDS {
        return Err(AgentError::new("bad_request", format!("At most {MAX_IDS} sessions per handoff.")));
    }
    for id in ids {
        if !valid_id(id) {
            return Err(not_found(id));
        }
        match store.session_row(id) {
            Ok(row) if !row.hidden && access.allows(id) => {}
            Ok(_) | Err(DbError::NotFound(_)) => return Err(not_found(id)),
            Err(e) => return Err(AgentError::library(e)),
        }
    }
    let mut pack = store.compose(ids).map_err(AgentError::library)?;
    let red = redactor(store);
    red.drop_excluded(&mut pack);
    strip_local_paths(&mut pack);
    let findings_redacted = red.scan_pack(&pack, None).iter().map(|f| f.count.max(1)).sum();
    red.redact_pack(&mut pack);
    let text = render_handoff_prompt(&pack, &RenderOptions { level, ..Default::default() });
    if text.len() > MAX_TEXT {
        return Err(AgentError::new(
            "too_large",
            "This handoff is larger than 4 MiB. Try level \"balanced\" or \"minimal\", or fewer sessions.",
        ));
    }
    Ok(Handoff {
        title: pack.title.clone(),
        token_estimate: estimate_tokens(&text),
        findings_redacted,
        attach_manually: pack.attachments.iter().filter(|a| a.text.is_none()).map(|a| a.file_name.clone()).collect(),
        text,
    })
}

pub fn parse_level(level: Option<&str>) -> Result<ContextLevel, AgentError> {
    match level.map(str::trim) {
        None | Some("") | Some("balanced") => Ok(ContextLevel::Balanced),
        Some("full") => Ok(ContextLevel::Full),
        Some("minimal") => Ok(ContextLevel::Minimal),
        Some(other) => {
            Err(AgentError::new("bad_request", format!("Unknown level \"{other}\". Use minimal, balanced or full.")))
        }
    }
}

pub fn open_library() -> Result<Store, AgentError> {
    let dir = hopilo_native_host::default_data_dir()
        .ok_or_else(|| AgentError::new("library", "Hopilo's data folder could not be located."))?;
    if !dir.join("hopilo.db").is_file() {
        return Err(AgentError::new(
            "library",
            format!("No Hopilo library at {}. Open Hopilo once first.", dir.display()),
        ));
    }
    Store::open_reader(&dir).map_err(AgentError::library)
}

#[cfg(test)]
mod tests;
