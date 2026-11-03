//! Native messaging host for the Hopilo browser extension (spec 10.4).
//!
//! Chrome starts this process when the extension's background worker calls
//! `connectNative("dev.hopilo.host")` and passes the caller's origin as the
//! first argument. Messages are length-prefixed JSON on stdin/stdout
//! (4-byte native-endian length). Only allowlisted extension origins are
//! served, and every payload from a web page is treated as untrusted data.

use std::io::{Read, Write};

use hopilo_core::brief::ContextLevel;
use hopilo_core::render::{estimate_tokens, render_handoff_prompt, RenderOptions};
use hopilo_core::scan::scan_pack;
use hopilo_core::{new_id, now_rfc3339, Block, CaptureStatus, Message, Role, Source, SourceKind};
use hopilo_database::Store;
use serde::Deserialize;
use serde_json::{json, Value};

pub const HOST_NAME: &str = "dev.hopilo.host";
pub const PROTOCOL: &str = "1";
/// The ID Chrome derives from the public key pinned in the extension manifest.
pub const DEFAULT_EXTENSION_ID: &str = "fgddcclgflboboacjmfdkkpgdbaolleo";
/// Firefox identifies extensions by the gecko id in their manifest.
pub const FIREFOX_EXTENSION_ID: &str = "hopilo@hopilo.dev";

/// Chrome refuses host-to-extension messages over 1 MiB; stay under it.
pub const MAX_OUTGOING: usize = 1_000_000;
/// Extension-to-host messages may be up to 64 MiB; we accept far less.
pub const MAX_INCOMING: usize = 16 * 1024 * 1024;
const MAX_MESSAGES: usize = 5_000;
const WEB_PROVIDERS: &[&str] = &["chatgpt", "claude", "gemini", "deepseek", "grok", "perplexity"];

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

/// `chrome-extension://<id>/` must name an allowlisted extension.
pub fn origin_allowed(origin: &str, allowed: &[String]) -> bool {
    let Some(rest) = origin.strip_prefix("chrome-extension://") else { return false };
    let id = rest.trim_end_matches('/');
    !id.is_empty() && allowed.iter().any(|a| a == id)
}

/// Chromium passes the caller origin as the first argument; Firefox passes
/// the host manifest path and then the extension id.
pub fn caller_allowed(args: &[String], allowed: &[String]) -> bool {
    match args {
        [origin, ..] if origin.starts_with("chrome-extension://") => origin_allowed(origin, allowed),
        [_, ext_id, ..] => ext_id == FIREFOX_EXTENSION_ID,
        _ => false,
    }
}

/// Where the desktop app keeps its library (Tauri's app data dir).
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
    base.map(|b| b.join("dev.hopilo.desktop"))
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
    text: String,
    #[serde(default)]
    created_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CapturePayload {
    title: String,
    #[serde(default)]
    url: Option<String>,
    messages: Vec<CaptureMessage>,
    /// "complete" only when the adapter saw the whole thread.
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
    // Keep scheme, host and path; drop query strings and fragments.
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
            "pack.list" => match self.store.list_packs() {
                Ok(rows) => ok(
                    &id,
                    json!(rows
                        .into_iter()
                        .filter(|p| !p.archived)
                        .take(30)
                        .map(|p| json!({ "id": p.id, "title": p.title, "version": p.latest_version, "messageCount": p.message_count, "tokenEstimate": p.token_estimate, "providers": p.providers }))
                        .collect::<Vec<_>>()),
                ),
                Err(e) => err(&id, "library", e.to_string()),
            },
            "pack.getDraft" => self.draft(&id, req),
            "handoff.record" => {
                let pack_id = req.get("packId").and_then(Value::as_str).unwrap_or("");
                let version = req.get("version").and_then(Value::as_u64).unwrap_or(0) as u32;
                let target = req.get("target").and_then(Value::as_str).unwrap_or("other");
                let status = match req.get("status").and_then(Value::as_str) {
                    Some("drafted") => "drafted",
                    Some("copied") => "copied",
                    _ => "failed",
                };
                match self.store.record_handoff(pack_id, version, target, "extension", status) {
                    Ok(hid) => ok(&id, json!({ "id": hid })),
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
        let messages: Vec<Message> = payload
            .messages
            .into_iter()
            .filter(|m| !m.text.trim().is_empty())
            .map(|m| Message {
                id: new_id(),
                source_id: source_id.clone(),
                role: if m.role == "user" { Role::User } else { Role::Assistant },
                created_at: m.created_at,
                blocks: vec![Block::text(m.text)],
            })
            .collect();
        let status = if payload.status == "complete" && payload.missing.is_empty() { CaptureStatus::Complete } else { CaptureStatus::Partial };
        let mut missing: Vec<String> = payload.missing.into_iter().take(20).map(|s| s.chars().take(300).collect()).collect();
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
        let Some(pack_id) = req.get("packId").and_then(Value::as_str) else { return err(id, "bad_request", "packId missing") };
        let version = req.get("version").and_then(Value::as_u64).map(|v| v as u32);
        let level = match req.get("level").and_then(Value::as_str) {
            Some("minimal") => ContextLevel::Minimal,
            Some("full") => ContextLevel::Full,
            _ => ContextLevel::Balanced,
        };
        let pack = match self.store.get_pack(pack_id, version) {
            Ok(p) => p,
            Err(e) => return err(id, "not_found", e.to_string()),
        };
        let text = render_handoff_prompt(&pack, &RenderOptions { level, ..Default::default() });
        // JSON escaping can grow the text; leave headroom under Chrome's cap.
        if text.len() > MAX_OUTGOING * 3 / 4 {
            return err(id, "too_large", "This pack is too large to insert directly. Try the Balanced or Minimal level, or copy it from the Hopilo app.");
        }
        let findings = scan_pack(&pack, None).len();
        let missing: usize = pack.sources.iter().map(|s| s.missing_items.len()).sum();
        ok(
            id,
            json!({
                "packId": pack.pack_id, "version": pack.version, "title": pack.title,
                "tokenEstimate": estimate_tokens(&text), "findings": findings, "missing": missing,
                "attachManually": pack.attachments.iter().filter(|a| a.text.is_none()).map(|a| a.file_name.clone()).collect::<Vec<_>>(),
                "text": text,
            }),
        )
    }
}

#[cfg(test)]
mod tests;
