//! Official account data exports from web chat apps. Users request these in
//! the provider's settings and receive a `.zip` containing
//! `conversations.json`. Supported: ChatGPT and Claude.ai.
//!
//! Parsing follows the documented/observed export shapes; unknown content
//! types are reported as not recovered rather than dropped silently.

use std::io::Read;
use std::path::Path;

use hopilo_core::{new_id, now_rfc3339, Block, CaptureStatus, Message, OmittedCount, Role, Source, SourceKind};
use serde::Serialize;
use serde_json::Value;

use crate::text::title_from;
use crate::{omitted, AdapterError, Capture, Result};

/// Refuse exports larger than this once unpacked.
const MAX_EXPORT_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportConversation {
    pub id: String,
    pub title: String,
    pub updated_at: String,
    pub message_count: usize,
}

pub struct ParsedExport {
    pub provider: &'static str,
    pub conversations: Vec<(ExportConversation, Capture)>,
}

fn io(path: &Path, e: impl std::fmt::Display) -> AdapterError {
    AdapterError::Io { path: path.display().to_string(), source: std::io::Error::other(e.to_string()) }
}

/// Load `conversations.json` from a `.json` file or an export `.zip`.
fn load_json(path: &Path) -> Result<Value> {
    let bytes = if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("zip")) {
        let f = std::fs::File::open(path).map_err(|e| io(path, e))?;
        let mut zip = zip::ZipArchive::new(f).map_err(|e| io(path, e))?;
        let mut entry = zip
            .by_name("conversations.json")
            .map_err(|_| AdapterError::Unrecognized(format!("{} (no conversations.json inside)", path.display())))?;
        if entry.size() > MAX_EXPORT_BYTES {
            return Err(io(path, "export is too large"));
        }
        let mut buf = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut buf).map_err(|e| io(path, e))?;
        buf
    } else {
        std::fs::read(path).map_err(|e| io(path, e))?
    };
    serde_json::from_slice(&bytes).map_err(|_| AdapterError::Unrecognized(path.display().to_string()))
}

pub fn parse_export(path: &Path) -> Result<ParsedExport> {
    let v = load_json(path)?;
    let Some(list) = v.as_array() else { return Err(AdapterError::Unrecognized(path.display().to_string())) };
    let first = list.first();
    let origin = path.display().to_string();
    if first.is_some_and(|c| c.get("mapping").is_some()) {
        Ok(ParsedExport { provider: "chatgpt", conversations: list.iter().filter_map(|c| chatgpt(c, &origin)).collect() })
    } else if first.is_some_and(|c| c.get("chat_messages").is_some()) {
        Ok(ParsedExport { provider: "claude", conversations: list.iter().filter_map(|c| claude(c, &origin)).collect() })
    } else if list.is_empty() {
        Ok(ParsedExport { provider: "chatgpt", conversations: vec![] })
    } else {
        Err(AdapterError::Unrecognized(format!("{} (not a ChatGPT or Claude export)", path.display())))
    }
}

fn secs_to_rfc3339(v: Option<&Value>) -> Option<String> {
    let s = v?.as_f64()?;
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis((s * 1000.0) as i64).map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

#[allow(clippy::too_many_arguments)]
fn finish(
    provider: &'static str,
    origin: &str,
    conv_id: String,
    title: Option<String>,
    updated_at: String,
    messages: Vec<Message>,
    source_id: String,
    missing: Vec<String>,
    om: Vec<OmittedCount>,
) -> Option<(ExportConversation, Capture)> {
    if messages.is_empty() {
        return None;
    }
    let title = title.filter(|t| !t.trim().is_empty()).unwrap_or_else(|| {
        messages
            .iter()
            .find(|m| m.role == Role::User)
            .and_then(|m| m.blocks.first())
            .map(|b| title_from(b.plain_text()))
            .unwrap_or_else(|| "Untitled conversation".into())
    });
    let count = messages.iter().filter(|m| m.role != Role::Tool).count();
    let source = Source {
        source_id,
        kind: SourceKind::ChatExport,
        provider: provider.into(),
        title: title.clone(),
        origin: Some(format!("{origin}#{conv_id}")),
        project: None,
        model: None,
        captured_at: now_rfc3339(),
        capture_status: if missing.is_empty() { CaptureStatus::Complete } else { CaptureStatus::Partial },
        missing_items: missing,
        omitted: om,
    };
    Some((ExportConversation { id: conv_id, title, updated_at, message_count: count }, Capture { source, messages, files: Vec::new() }))
}

fn chatgpt(c: &Value, origin: &str) -> Option<(ExportConversation, Capture)> {
    let conv_id = c.get("conversation_id").or_else(|| c.get("id")).and_then(Value::as_str)?.to_string();
    let mapping = c.get("mapping")?.as_object()?;
    // The visible thread is the path from `current_node` back to the root.
    let mut chain = Vec::new();
    let mut cursor = c.get("current_node").and_then(Value::as_str).map(str::to_string);
    let mut guard = 0;
    while let Some(id) = cursor {
        let Some(node) = mapping.get(&id) else { break };
        chain.push(node);
        cursor = node.get("parent").and_then(Value::as_str).map(str::to_string);
        guard += 1;
        if guard > 100_000 {
            break;
        }
    }
    chain.reverse();

    let source_id = new_id();
    let (mut hidden, mut reasoning, mut media) = (0, 0, 0);
    let mut messages = Vec::new();
    let mut model = None;
    for node in chain {
        let Some(m) = node.get("message").filter(|m| !m.is_null()) else { continue };
        let role = m.get("author").and_then(|a| a.get("role")).and_then(Value::as_str).unwrap_or("");
        let content = m.get("content").cloned().unwrap_or(Value::Null);
        let ctype = content.get("content_type").and_then(Value::as_str).unwrap_or("text");
        let meta = m.get("metadata");
        if model.is_none() {
            model = meta.and_then(|x| x.get("model_slug")).and_then(Value::as_str).map(str::to_string);
        }
        if role == "system" || meta.and_then(|x| x.get("is_visually_hidden_from_conversation")).and_then(Value::as_bool) == Some(true) || ctype == "user_editable_context" {
            hidden += 1;
            continue;
        }
        if matches!(ctype, "thoughts" | "reasoning_recap") {
            reasoning += 1;
            continue;
        }
        let created_at = secs_to_rfc3339(m.get("create_time"));
        let id = m.get("id").and_then(Value::as_str).map(str::to_string).unwrap_or_else(new_id);
        let mut blocks = Vec::new();
        match ctype {
            "code" => blocks.push(Block::ToolCall {
                name: m.get("recipient").and_then(Value::as_str).unwrap_or("code").to_string(),
                input: content.get("text").and_then(Value::as_str).unwrap_or("").to_string(),
            }),
            "execution_output" => blocks.push(Block::ToolResult {
                name: m.get("author").and_then(|a| a.get("name")).and_then(Value::as_str).map(str::to_string),
                output: content.get("text").and_then(Value::as_str).unwrap_or("").to_string(),
                is_error: false,
            }),
            _ => {
                for p in content.get("parts").and_then(Value::as_array).into_iter().flatten() {
                    match p {
                        Value::String(s) if !s.trim().is_empty() => blocks.push(Block::text(s.trim_end())),
                        Value::String(_) => {}
                        _ => {
                            media += 1;
                            blocks.push(Block::Missing { description: "image or file shared in the conversation".into() });
                        }
                    }
                }
                if blocks.is_empty() {
                    if let Some(t) = content.get("text").and_then(Value::as_str).filter(|t| !t.trim().is_empty()) {
                        blocks.push(Block::text(t.trim_end()));
                    }
                }
            }
        }
        if blocks.is_empty() {
            continue;
        }
        let role = match role {
            "user" => Role::User,
            "tool" => {
                // Tool output shown as text: keep it as a tool result.
                blocks = blocks
                    .into_iter()
                    .map(|b| match b {
                        Block::Text { text } => Block::ToolResult {
                            name: m.get("author").and_then(|a| a.get("name")).and_then(Value::as_str).map(str::to_string),
                            output: text,
                            is_error: false,
                        },
                        other => other,
                    })
                    .collect();
                Role::Tool
            }
            _ => Role::Assistant,
        };
        messages.push(Message { id, source_id: source_id.clone(), role, created_at, blocks });
    }
    let mut missing = Vec::new();
    if media > 0 {
        missing.push(format!("{media} image(s) or file(s) referenced but not included in the export text"));
    }
    let mut om = Vec::new();
    omitted(&mut om, "hidden system or memory context", hidden);
    omitted(&mut om, "reasoning summaries", reasoning);
    let updated = secs_to_rfc3339(c.get("update_time")).unwrap_or_default();
    let title = c.get("title").and_then(Value::as_str).map(str::to_string);
    let mut out = finish("chatgpt", origin, conv_id, title, updated, messages, source_id, missing, om)?;
    out.1.source.model = model;
    Some(out)
}

fn claude(c: &Value, origin: &str) -> Option<(ExportConversation, Capture)> {
    let conv_id = c.get("uuid").and_then(Value::as_str)?.to_string();
    let source_id = new_id();
    let (mut thinking, mut lost_files) = (0, 0);
    let mut messages = Vec::new();
    for m in c.get("chat_messages").and_then(Value::as_array).into_iter().flatten() {
        let role = match m.get("sender").and_then(Value::as_str) {
            Some("human") => Role::User,
            Some("assistant") => Role::Assistant,
            _ => continue,
        };
        let id = m.get("uuid").and_then(Value::as_str).map(str::to_string).unwrap_or_else(new_id);
        let created_at = m.get("created_at").and_then(Value::as_str).map(str::to_string);
        let mut blocks = Vec::new();
        let mut results = Vec::new();
        match m.get("content").and_then(Value::as_array) {
            Some(items) if !items.is_empty() => {
                for b in items {
                    match b.get("type").and_then(Value::as_str).unwrap_or("") {
                        "text" => {
                            if let Some(t) = b.get("text").and_then(Value::as_str).filter(|t| !t.trim().is_empty()) {
                                blocks.push(Block::text(t.trim_end()));
                            }
                        }
                        "thinking" | "redacted_thinking" => thinking += 1,
                        "tool_use" => blocks.push(Block::ToolCall {
                            name: b.get("name").and_then(Value::as_str).unwrap_or("tool").to_string(),
                            input: b.get("input").map(|i| serde_json::to_string_pretty(i).unwrap_or_default()).unwrap_or_default(),
                        }),
                        "tool_result" => {
                            let output = match b.get("content") {
                                Some(Value::Array(parts)) => parts.iter().filter_map(|p| p.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("\n"),
                                Some(Value::String(s)) => s.clone(),
                                _ => String::new(),
                            };
                            results.push(Block::ToolResult {
                                name: b.get("name").and_then(Value::as_str).map(str::to_string),
                                output,
                                is_error: b.get("is_error").and_then(Value::as_bool).unwrap_or(false),
                            });
                        }
                        _ => {}
                    }
                }
            }
            _ => {
                if let Some(t) = m.get("text").and_then(Value::as_str).filter(|t| !t.trim().is_empty()) {
                    blocks.push(Block::text(t.trim_end()));
                }
            }
        }
        for a in m.get("attachments").and_then(Value::as_array).into_iter().flatten() {
            let name = a.get("file_name").and_then(Value::as_str).unwrap_or("attachment");
            match a.get("extracted_content").and_then(Value::as_str).filter(|t| !t.is_empty()) {
                Some(text) => blocks.push(Block::text(format!("Attached file `{name}`:\n\n{text}"))),
                None => {
                    lost_files += 1;
                    blocks.push(Block::Missing { description: format!("attachment “{name}”") });
                }
            }
        }
        for f in m.get("files").and_then(Value::as_array).into_iter().flatten() {
            lost_files += 1;
            let name = f.get("file_name").and_then(Value::as_str).unwrap_or("file");
            blocks.push(Block::Missing { description: format!("file “{name}”") });
        }
        if !blocks.is_empty() {
            messages.push(Message { id: id.clone(), source_id: source_id.clone(), role, created_at: created_at.clone(), blocks });
        }
        if !results.is_empty() {
            messages.push(Message { id: format!("{id}-results"), source_id: source_id.clone(), role: Role::Tool, created_at, blocks: results });
        }
    }
    let mut missing = Vec::new();
    if lost_files > 0 {
        missing.push(format!("{lost_files} file(s) referenced but not included in the export"));
    }
    let mut om = Vec::new();
    omitted(&mut om, "hidden reasoning (thinking) blocks", thinking);
    let updated = c.get("updated_at").and_then(Value::as_str).unwrap_or("").to_string();
    let title = c.get("name").and_then(Value::as_str).map(str::to_string);
    finish("claude", origin, conv_id, title, updated, messages, source_id, missing, om)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/exports").join(name)
    }

    #[test]
    fn chatgpt_follows_current_branch() {
        let e = parse_export(&fixture("chatgpt-conversations.json")).unwrap();
        assert_eq!(e.provider, "chatgpt");
        let (meta, cap) = &e.conversations[0];
        assert_eq!(meta.title, "Postgres index advice");
        let texts: Vec<&str> = cap.messages.iter().map(|m| m.blocks[0].plain_text()).collect();
        // The abandoned first answer (other branch) is not included.
        assert_eq!(texts, vec!["Which index for `WHERE user_id = $1 ORDER BY created_at`?", "Use a composite index on `(user_id, created_at)`."]);
        assert_eq!(cap.source.model.as_deref(), Some("gpt-5"));
        assert!(cap.source.omitted.iter().any(|o| o.what.starts_with("hidden system")));
        assert!(cap.source.origin.as_deref().unwrap().ends_with("#c1"));
    }

    #[test]
    fn claude_export_keeps_attachments_text() {
        let e = parse_export(&fixture("claude-conversations.json")).unwrap();
        assert_eq!(e.provider, "claude");
        let (meta, cap) = &e.conversations[0];
        assert_eq!(meta.title, "Release checklist");
        assert_eq!(cap.messages.len(), 2);
        assert!(cap.messages[0].blocks.iter().any(|b| b.plain_text().contains("Attached file `notes.md`")));
        assert_eq!(cap.source.capture_status, CaptureStatus::Partial);
        assert!(cap.source.omitted.iter().any(|o| o.what.contains("thinking")));
    }

    #[test]
    fn rejects_unknown_json() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("x.json");
        std::fs::write(&p, r#"[{"foo":1}]"#).unwrap();
        assert!(parse_export(&p).is_err());
    }
}
