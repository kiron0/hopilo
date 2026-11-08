use std::io::{Read, Write};

use hopilo_core::brief::ContextLevel;
use hopilo_core::render::{estimate_tokens, render_handoff_prompt, RenderOptions};
use hopilo_core::scan::{RedactionRules, Redactor};
use hopilo_core::{new_id, now_rfc3339, Block, CaptureStatus, Message, Role, Source, SourceKind};
use hopilo_database::Store;
use serde::Deserialize;
use serde_json::{json, Value};

pub const HOST_NAME: &str = "dev.hopilo.host";
pub const PROTOCOL: &str = "2";

pub const DEFAULT_EXTENSION_ID: &str = "fgddcclgflboboacjmfdkkpgdbaolleo";

pub const FIREFOX_EXTENSION_ID: &str = "hopilo@hopilo.dev";

pub const MAX_OUTGOING: usize = 1_000_000;

pub const MAX_INCOMING: usize = 60 * 1024 * 1024;

const MAX_FILE: usize = 20 * 1024 * 1024;
const MAX_MESSAGES: usize = 5_000;
const WEB_PROVIDERS: &[&str] = &["claude", "gemini", "deepseek", "grok", "perplexity"];

pub fn read_message(r: &mut impl Read) -> std::io::Result<Option<Value>> {
    let mut len = [0u8; 4];
    match r.read_exact(&mut len) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let n = u32::from_ne_bytes(len) as usize;
    if n > MAX_INCOMING {
        return Err(std::io::Error::other("message too large"));
    }
    let mut buf = vec![0u8; n];
    r.read_exact(&mut buf)?;
    serde_json::from_slice(&buf).map(Some).map_err(std::io::Error::other)
}

pub fn write_message(w: &mut impl Write, v: &Value) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(v)?;
    w.write_all(&(bytes.len() as u32).to_ne_bytes())?;
    w.write_all(&bytes)?;
    w.flush()
}

pub fn fit_outgoing(resp: Value) -> Value {
    let size = serde_json::to_vec(&resp).map(|b| b.len()).unwrap_or(usize::MAX);
    if size <= MAX_OUTGOING {
        return resp;
    }
    let id = resp.get("requestId").cloned().unwrap_or(Value::Null);
    err(&id, "too_large", "This reply is too large to send to the browser. Try the Balanced or Minimal level, or copy it from the Hopilo app.")
}

pub fn origin_allowed(origin: &str, allowed: &[String]) -> bool {
    let Some(rest) = origin.strip_prefix("chrome-extension://") else { return false };
    let id = rest.trim_end_matches('/');
    !id.is_empty() && allowed.iter().any(|a| a == id)
}

pub fn caller_allowed(args: &[String], allowed: &[String]) -> bool {
    match args {
        [origin, ..] if origin.starts_with("chrome-extension://") => origin_allowed(origin, allowed),
        [_, ext_id, ..] => ext_id == FIREFOX_EXTENSION_ID,
        _ => false,
    }
}

pub fn default_data_dir() -> Option<std::path::PathBuf> {
    if let Some(d) = std::env::var_os("HOPILO_DATA_DIR") {
        return Some(d.into());
    }
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from);
    let base = if cfg!(target_os = "macos") {
        home.map(|h| h.join("Library").join("Application Support"))
    } else if cfg!(windows) {
        std::env::var_os("APPDATA").map(Into::into)
    } else {
        std::env::var_os("XDG_DATA_HOME").map(Into::into).or_else(|| home.map(|h| h.join(".local").join("share")))
    };
    base.map(|b| {
        let primary = b.join("io.coreify.hopilo");
        if primary.exists() {
            primary
        } else if b.join("dev.hopilo.desktop").exists() {
            b.join("dev.hopilo.desktop")
        } else {
            primary
        }
    })
}

pub fn allowed_ids(store: &Store) -> Vec<String> {
    let mut ids = vec![DEFAULT_EXTENSION_ID.to_string()];
    if let Some(extra) = store.settings().ok().and_then(|s| s.get("browser.allowedExtensionIds").cloned()) {
        for v in extra.as_array().into_iter().flatten() {
            if let Some(s) = v.as_str() {
                ids.push(s.to_string());
            }
        }
    }
    ids
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaptureMessage {
    role: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    created_at: Option<String>,

    #[serde(default)]
    files: Vec<CaptureFile>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaptureFile {
    name: String,
    #[serde(default)]
    media_type: String,

    #[serde(default)]
    data: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CapturePayload {
    title: String,
    #[serde(default)]
    url: Option<String>,
    messages: Vec<CaptureMessage>,

    status: String,
    #[serde(default)]
    missing: Vec<String>,
    #[serde(default)]
    adapter_version: Option<String>,
}

pub struct Host {
    pub store: Store,
}

fn err(request_id: &Value, code: &str, message: impl Into<String>) -> Value {
    json!({ "requestId": request_id, "ok": false, "error": { "code": code, "message": message.into() } })
}

fn ok(request_id: &Value, result: Value) -> Value {
    json!({ "requestId": request_id, "ok": true, "result": result })
}

fn clean_url(u: &str) -> Option<String> {

    let u = u.split(['?', '#']).next()?.to_string();
    (u.starts_with("https://") && u.len() < 2048).then_some(u)
}

impl Host {
    pub fn handle(&mut self, req: &Value) -> Value {
        let id = req.get("requestId").cloned().unwrap_or(Value::Null);
        let kind = req.get("type").and_then(Value::as_str).unwrap_or("");
        match kind {
            "hello" => {
                let _ = self.store.set_setting("browser.lastSeen", &json!(now_rfc3339()));
                if let Some(v) = req.get("extensionVersion").and_then(Value::as_str) {
                    let _ = self.store.set_setting("browser.extensionVersion", &json!(v));
                }
                ok(&id, json!({ "app": "hopilo", "protocol": PROTOCOL, "version": env!("CARGO_PKG_VERSION") }))
            }
            "capture.import" => self.capture(&id, req),
            "session.list" => match self.store.list_sessions() {
                Ok(rows) => ok(
                    &id,
                    json!(rows
                        .into_iter()
                        .take(40)
                        .map(|r| json!({ "id": r.id, "title": r.title, "provider": r.provider, "messageCount": r.message_count, "tokenEstimate": r.token_estimate, "fileCount": r.file_count, "updatedAt": r.updated_at, "pinned": r.pinned }))
                        .collect::<Vec<_>>()),
                ),
                Err(e) => err(&id, "library", e.to_string()),
            },
            "session.getDraft" => self.draft(&id, req),
            "handoff.record" => {
                let ids = session_ids(req);
                let target = req.get("target").and_then(Value::as_str).unwrap_or("other");
                let status = match req.get("status").and_then(Value::as_str) {
                    Some("drafted") => "drafted",
                    Some("copied") => "copied",
                    _ => "failed",
                };
                if ids.is_empty() {
                    return err(&id, "bad_request", "ids missing");
                }
                match self.store.record_copy(&ids, target, "extension", status) {
                    Ok(()) => ok(&id, json!({})),
                    Err(e) => err(&id, "library", e.to_string()),
                }
            }
            "adapter.report" => {
                let provider = req.get("provider").and_then(Value::as_str).unwrap_or("");
                if !WEB_PROVIDERS.contains(&provider) {
                    return err(&id, "bad_request", "unknown provider");
                }
                let report = json!({
                    "adapterVersion": req.get("adapterVersion").cloned().unwrap_or(Value::Null),
                    "ok": req.get("ok").and_then(Value::as_bool).unwrap_or(false),
                    "messageCount": req.get("messageCount").and_then(Value::as_u64).unwrap_or(0),
                    "detail": req.get("detail").and_then(Value::as_str).map(|s| s.chars().take(300).collect::<String>()),
                    "testedAt": now_rfc3339(),
                });
                match self.store.set_setting(&format!("adapter.{provider}"), &report) {
                    Ok(()) => ok(&id, json!({})),
                    Err(e) => err(&id, "library", e.to_string()),
                }
            }
            _ => err(&id, "unknown_type", format!("unsupported request type “{kind}”")),
        }
    }

    fn capture(&mut self, id: &Value, req: &Value) -> Value {
        let provider = req.get("provider").and_then(Value::as_str).unwrap_or("");
        if !WEB_PROVIDERS.contains(&provider) {
            return err(id, "bad_request", "unknown provider");
        }
        let payload: CapturePayload = match req.get("payload").cloned().map(serde_json::from_value) {
            Some(Ok(p)) => p,
            _ => return err(id, "bad_request", "malformed capture payload"),
        };
        if payload.messages.is_empty() {
            return err(id, "empty", "No messages were found on this page.");
        }
        if payload.messages.len() > MAX_MESSAGES {
            return err(id, "too_large", "Conversation is too long to capture in one go.");
        }
        let source_id = new_id();
        let mut unrecovered: Vec<String> = Vec::new();
        let mut messages: Vec<Message> = Vec::new();
        for m in payload.messages {
            let mut blocks = Vec::new();
            for f in m.files.into_iter().take(50) {
                let name: String = f.name.trim().chars().take(200).collect();
                let file = f
                    .data
                    .as_deref()
                    .and_then(|d| hopilo_core::CapturedFile::from_base64(if name.is_empty() { "file".to_string() } else { name.clone() }, f.media_type.clone(), d))
                    .filter(|cf| cf.bytes.len() <= MAX_FILE);
                match file {
                    Some(cf) => match self.store.insert_attachment(&cf.attachment(), &cf.bytes) {
                        Ok(_) => blocks.push(cf.block()),
                        Err(_) => {
                            blocks.push(Block::Missing { description: format!("file “{name}”") });
                            unrecovered.push(name);
                        }
                    },
                    None => {
                        blocks.push(Block::Missing { description: format!("file “{name}”") });
                        unrecovered.push(name);
                    }
                }
            }
            if !m.text.trim().is_empty() {
                blocks.insert(0, Block::text(m.text));
            }
            if blocks.is_empty() {
                continue;
            }
            messages.push(Message {
                id: new_id(),
                source_id: source_id.clone(),
                role: if m.role == "user" { Role::User } else { Role::Assistant },
                created_at: m.created_at,
                blocks,
            });
        }
        let mut missing: Vec<String> = payload.missing.into_iter().take(20).map(|s| s.chars().take(300).collect()).collect();
        if !unrecovered.is_empty() {
            let names = unrecovered.iter().take(5).cloned().collect::<Vec<_>>().join(", ");
            missing.push(format!("{} file(s) shown in the chat couldn't be downloaded: {names}", unrecovered.len()));
        }
        let status = if payload.status == "complete" && missing.is_empty() { CaptureStatus::Complete } else { CaptureStatus::Partial };
        if status == CaptureStatus::Partial && missing.is_empty() {
            missing.push("The page may not have shown the whole conversation".into());
        }
        let title: String = payload.title.trim().chars().take(200).collect();
        let source = Source {
            source_id,
            kind: SourceKind::BrowserChat,
            provider: provider.into(),
            title: if title.is_empty() { format!("{provider} conversation") } else { title },
            origin: payload.url.as_deref().and_then(clean_url),
            project: None,
            model: payload.adapter_version.map(|v| format!("captured by web adapter {v}")),
            captured_at: now_rfc3339(),
            capture_status: status,
            missing_items: missing,
            omitted: vec![],
        };
        match self.store.insert_capture(&source, &messages) {
            Ok(out) => ok(id, json!({ "sourceId": out.source_id, "duplicateOf": out.duplicate_of, "messageCount": messages.len(), "status": status })),
            Err(e) => err(id, "library", e.to_string()),
        }
    }

    fn draft(&mut self, id: &Value, req: &Value) -> Value {
        let ids = session_ids(req);
        if ids.is_empty() {
            return err(id, "bad_request", "ids missing");
        }
        let level = match req.get("level").and_then(Value::as_str) {
            Some("minimal") => ContextLevel::Minimal,
            Some("full") => ContextLevel::Full,
            _ => ContextLevel::Balanced,
        };
        let mut pack = match self.store.compose(&ids) {
            Ok(p) => p,
            Err(e) => return err(id, "not_found", e.to_string()),
        };
        let rules: RedactionRules = self.store.settings().ok()
            .and_then(|s| s.get("redaction").cloned())
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        let (redactor, _) = Redactor::new(&rules, []);
        redactor.drop_excluded(&mut pack);
        let text = render_handoff_prompt(&pack, &RenderOptions { level, ..Default::default() });

        if text.len() > MAX_OUTGOING * 3 / 4 {
            return err(id, "too_large", "This session is too long to insert directly. Try the Balanced or Minimal level, or copy it from the Hopilo app.");
        }
        let findings = redactor.scan_pack(&pack, None).len();
        let missing: usize = pack.sources.iter().map(|s| s.missing_items.len()).sum();
        ok(
            id,
            json!({
                "ids": ids, "title": pack.title,
                "tokenEstimate": estimate_tokens(&text), "findings": findings, "missing": missing,
                "attachManually": pack.attachments.iter().filter(|a| a.text.is_none()).map(|a| a.file_name.clone()).collect::<Vec<_>>(),
                "text": text,
            }),
        )
    }
}

fn session_ids(req: &Value) -> Vec<String> {
    req.get("ids")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .filter(|s| !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric()))
                .take(20)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests;
