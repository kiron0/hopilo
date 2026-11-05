use std::path::{Path, PathBuf};

use hopilo_core::{
    new_id, now_rfc3339, Block, CaptureStatus, Message, OmittedCount, Role, Source, SourceKind,
};
use serde::Deserialize;
use serde_json::Value;

use crate::text::{strip_injected, title_from};
use crate::{
    file_meta, home, jsonl_files, omitted, par_scan, open_lines, AdapterError, Capture, DiscoveredSession,
    LocalAgentAdapter, Result,
};

pub struct ClaudeCode;

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct LineHead {
    #[serde(rename = "type")]
    kind: String,
    cwd: Option<String>,
    custom_title: Option<String>,
    summary: Option<String>,
    is_meta: bool,
    is_sidechain: bool,
    // Kept raw: most lines only need counting, and fully parsing every
    // message (tool output can be megabytes) dominated discovery time.
    message: Option<Box<serde_json::value::RawValue>>,
}

impl LocalAgentAdapter for ClaudeCode {
    fn id(&self) -> &'static str {
        "claude-code"
    }

    fn display_name(&self) -> &'static str {
        "Claude Code"
    }

    fn default_roots(&self) -> Vec<PathBuf> {
        if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR") {
            // Accepts a comma-separated list, like Claude Code itself.
            return dir
                .to_string_lossy()
                .split(',')
                .map(str::trim)
                .filter(|d| !d.is_empty())
                .map(|d| PathBuf::from(d).join("projects"))
                .collect();
        }
        let mut roots = Vec::new();
        if let Some(h) = home() {
            roots.push(h.join(".claude").join("projects"));
            // Newer releases follow XDG and write here instead.
            roots.push(h.join(".config").join("claude").join("projects"));
        }
        if let Some(x) = std::env::var_os("XDG_CONFIG_HOME") {
            let p = PathBuf::from(x).join("claude").join("projects");
            if !roots.contains(&p) {
                roots.push(p);
            }
        }
        roots
    }

    fn scan_depth(&self) -> usize {
        1
    }

    fn discover(&self, root: &Path) -> Result<Vec<DiscoveredSession>> {
        let mut files = Vec::new();
        jsonl_files(root, 1, &mut files);
        Ok(par_scan(&files, quick_scan))
    }

    fn read(&self, path: &Path) -> Result<Capture> {
        read_session(path)
    }
}

fn quick_scan(path: &Path) -> Option<DiscoveredSession> {
    let (size_bytes, modified_at) = file_meta(path).ok()?;
    let mut title = None;
    let mut first_prompt = None;
    let mut project = None;
    let mut model = None;
    let mut count = 0;
    for line in open_lines(path).ok()?.map_while(|l| l.ok()) {
        let Ok(h) = serde_json::from_str::<LineHead>(&line) else { continue };
        match h.kind.as_str() {
            "custom-title" => title = h.custom_title.or(title),
            "summary" if title.is_none() => title = h.summary,
            "user" | "assistant" if !h.is_meta && !h.is_sidechain => {
                count += 1;
                if project.is_none() {
                    project = h.cwd;
                }
                let want_model = model.is_none() && h.kind == "assistant";
                let want_prompt = first_prompt.is_none() && h.kind == "user";
                if want_model || want_prompt {
                    let msg: Value = h.message.and_then(|r| serde_json::from_str(r.get()).ok()).unwrap_or_default();
                    if want_model {
                        model = msg.get("model").and_then(Value::as_str).map(str::to_string);
                    }
                    if want_prompt {
                        first_prompt = first_text(&msg).map(|t| title_from(&slash_command(&t))).filter(|t| !t.is_empty());
                    }
                }
            }
            _ => {}
        }
    }
    if count == 0 {
        return None;
    }
    let session_id = path.file_stem()?.to_string_lossy().to_string();
    Some(DiscoveredSession {
        adapter: "claude-code".into(),
        path: path.display().to_string(),
        title: title.or(first_prompt).unwrap_or_else(|| format!("Session {}", &session_id[..8.min(session_id.len())])),
        session_id,
        project,
        model,
        modified_at,
        size_bytes,
        message_count: count,
    })
}

fn tag<'a>(text: &'a str, name: &str) -> Option<&'a str> {
    let open = format!("<{name}>");
    let start = text.find(&open)? + open.len();
    let end = text[start..].find(&format!("</{name}>"))? + start;
    Some(text[start..end].trim())
}

/// Claude Code records a slash command as `<command-message>`,
/// `<command-name>` and `<command-args>` tags. Show it the way it was typed.
fn slash_command(text: &str) -> std::borrow::Cow<'_, str> {
    if !text.contains("<command-name>") {
        return text.into();
    }
    let Some(name) = tag(text, "command-name") else { return text.into() };
    let args = tag(text, "command-args").unwrap_or("");
    let name = if name.starts_with('/') { name.to_string() } else { format!("/{name}") };
    if args.is_empty() { name.into() } else { format!("{name} {args}").into() }
}

fn first_text(msg: &Value) -> Option<String> {
    match msg.get("content")? {
        Value::String(s) => Some(s.clone()),
        Value::Array(blocks) => blocks.iter().find_map(|b| {
            (b.get("type")?.as_str()? == "text").then(|| b.get("text")?.as_str().map(str::to_string))?
        }),
        _ => None,
    }
}

fn tool_result_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|p| match p.get("type").and_then(Value::as_str) {
                Some("text") => p.get("text").and_then(Value::as_str).map(str::to_string),
                Some(other) => Some(format!("[{other} content not recovered]")),
                None => None,
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

#[derive(Default)]
struct Tally {
    thinking: usize,
    meta: usize,
    sidechain: usize,
    reminders: usize,
    unreadable: usize,
    images: usize,
    compacted: bool,
    files: Vec<hopilo_core::CapturedFile>,
}

fn read_session(path: &Path) -> Result<Capture> {
    let source_id = new_id();
    let mut messages: Vec<Message> = Vec::new();

    let mut last_assistant_id: Option<String> = None;
    let mut tool_names: std::collections::HashMap<String, String> = Default::default();
    let mut t = Tally::default();
    let mut title = None;
    let mut first_prompt = None;
    let mut project = None;
    let mut model = None;
    let mut saw_any = false;

    for line in open_lines(path)? {
        let line = line.map_err(|source| AdapterError::Io { path: path.display().to_string(), source })?;
        if line.trim().is_empty() {
            continue;
        }
        let v: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => {
                t.unreadable += 1;
                continue;
            }
        };
        saw_any = true;
        let kind = v.get("type").and_then(Value::as_str).unwrap_or("");
        match kind {
            "custom-title" => {
                title = v.get("customTitle").and_then(Value::as_str).map(str::to_string).or(title);
                continue;
            }
            "summary" => {
                if title.is_none() {
                    title = v.get("summary").and_then(Value::as_str).map(str::to_string);
                }
                continue;
            }
            "system" => {
                if v.get("subtype").and_then(Value::as_str) == Some("compact_boundary") {
                    t.compacted = true;
                }
                continue;
            }
            "user" | "assistant" => {}
            _ => continue,
        }
        if v.get("isSidechain").and_then(Value::as_bool) == Some(true) {
            t.sidechain += 1;
            continue;
        }
        if v.get("isMeta").and_then(Value::as_bool) == Some(true) {
            t.meta += 1;
            continue;
        }
        if project.is_none() {
            project = v.get("cwd").and_then(Value::as_str).map(str::to_string);
        }
        let Some(msg) = v.get("message") else { continue };
        let created_at = v.get("timestamp").and_then(Value::as_str).map(str::to_string);
        let line_id = v.get("uuid").and_then(Value::as_str).map(str::to_string).unwrap_or_else(new_id);

        let mut blocks = Vec::new();
        match msg.get("content") {
            Some(Value::String(s)) => {
                let (clean, n) = strip_injected(&slash_command(s));
                t.reminders += n;
                if !clean.is_empty() {
                    blocks.push(Block::text(clean));
                }
            }
            Some(Value::Array(items)) => {
                for b in items {
                    match b.get("type").and_then(Value::as_str).unwrap_or("") {
                        "text" => {
                            let raw = b.get("text").and_then(Value::as_str).unwrap_or("");
                            let (clean, n) = strip_injected(&slash_command(raw));
                            t.reminders += n;
                            if !clean.is_empty() {
                                blocks.push(Block::text(clean));
                            }
                        }
                        "thinking" | "redacted_thinking" => t.thinking += 1,
                        "tool_use" => {
                            let name = b.get("name").and_then(Value::as_str).unwrap_or("tool").to_string();
                            if let Some(id) = b.get("id").and_then(Value::as_str) {
                                tool_names.insert(id.to_string(), name.clone());
                            }
                            let input = b
                                .get("input")
                                .map(|i| serde_json::to_string_pretty(i).unwrap_or_default())
                                .unwrap_or_default();
                            blocks.push(Block::ToolCall { name, input });
                        }
                        "tool_result" => {
                            let name = b
                                .get("tool_use_id")
                                .and_then(Value::as_str)
                                .and_then(|id| tool_names.get(id).cloned());
                            let (output, n) = strip_injected(&tool_result_text(b.get("content")));
                            t.reminders += n;
                            blocks.push(Block::ToolResult {
                                name,
                                output,
                                is_error: b.get("is_error").and_then(Value::as_bool).unwrap_or(false),
                            });
                        }
                        "image" | "document" => {
                            let kind = b["type"].as_str().unwrap_or("file");
                            match recover_block_file(b, kind, t.files.len() + 1) {
                                Some(f) => {
                                    blocks.push(f.block());
                                    t.files.push(f);
                                }
                                None => {
                                    t.images += 1;
                                    blocks.push(Block::Missing { description: format!("{kind} shared in the conversation") });
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }

        if kind == "assistant" {
            if model.is_none() {
                model = msg.get("model").and_then(Value::as_str).map(str::to_string);
            }
            let api_id = msg.get("id").and_then(Value::as_str).map(str::to_string);
            if api_id.is_some() && api_id == last_assistant_id {
                if let Some(prev) = messages.last_mut() {
                    prev.blocks.extend(blocks);
                    continue;
                }
            }
            last_assistant_id = api_id;
        } else {
            last_assistant_id = None;
        }

        if blocks.is_empty() {
            continue;
        }
        let role = if kind == "assistant" {
            Role::Assistant
        } else if blocks.iter().all(|b| matches!(b, Block::ToolResult { .. })) {
            Role::Tool
        } else {
            Role::User
        };
        if role == Role::User && first_prompt.is_none() {
            first_prompt = blocks.iter().find_map(|b| match b {
                Block::Text { text } => Some(title_from(text)).filter(|t| !t.is_empty()),
                _ => None,
            });
        }
        messages.push(Message { id: line_id, source_id: source_id.clone(), role, created_at, blocks });
    }

    if !saw_any {
        return Err(AdapterError::Unrecognized(path.display().to_string()));
    }

    messages.retain(|m| !m.blocks.is_empty());

    let mut missing = Vec::new();
    if t.compacted {
        missing.push("Earlier history was compacted by Claude Code; only its summary remains in the session file".into());
    }
    if t.unreadable > 0 {
        missing.push(format!("{} unreadable line(s) in the session file", t.unreadable));
    }
    if t.images > 0 {
        missing.push(format!("{} image/document attachment(s) referenced but not recovered", t.images));
    }
    let mut om: Vec<OmittedCount> = Vec::new();
    omitted(&mut om, "hidden reasoning (thinking) blocks", t.thinking);
    omitted(&mut om, "injected system reminders", t.reminders);
    omitted(&mut om, "agent-injected meta messages", t.meta);
    omitted(&mut om, "sub-agent (sidechain) messages", t.sidechain);

    let session_id = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let source = Source {
        source_id,
        kind: SourceKind::LocalAgent,
        provider: "claude-code".into(),
        title: title.or(first_prompt).unwrap_or_else(|| format!("Claude Code session {session_id}")),
        origin: Some(path.display().to_string()),
        project,
        model,
        captured_at: now_rfc3339(),
        capture_status: if missing.is_empty() { CaptureStatus::Complete } else { CaptureStatus::Partial },
        missing_items: missing,
        omitted: om,
    };
    Ok(Capture { source, messages, files: t.files })
}

fn recover_block_file(b: &Value, kind: &str, n: usize) -> Option<hopilo_core::CapturedFile> {
    let src = b.get("source")?;
    let named = b.get("title").or_else(|| b.get("name")).and_then(Value::as_str).map(str::to_string);
    let media = src.get("media_type").and_then(Value::as_str).unwrap_or("");
    match src.get("type").and_then(Value::as_str)? {
        "base64" => hopilo_core::CapturedFile::from_base64(named.unwrap_or_else(|| format!("{kind}-{n}")), media, src.get("data").and_then(Value::as_str)?),
        "text" => {
            let data = src.get("data").and_then(Value::as_str)?;
            Some(hopilo_core::CapturedFile {
                name: named.unwrap_or_else(|| format!("document-{n}.txt")),
                media_type: if media.is_empty() { "text/plain".into() } else { media.into() },
                bytes: data.as_bytes().to_vec(),
            })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    fn fixture() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/claude-code/sample-session.jsonl")
    }

    #[test]
    fn reads_fixture_without_modifying_it() {
        let before = Sha256::digest(std::fs::read(fixture()).unwrap());
        let cap = ClaudeCode.read(&fixture()).unwrap();
        let after = Sha256::digest(std::fs::read(fixture()).unwrap());
        assert_eq!(hex::encode(before), hex::encode(after));

        assert_eq!(cap.source.title, "Fix the failing login test");
        assert_eq!(cap.source.project.as_deref(), Some("/work/demo-app"));
        assert_eq!(cap.source.model.as_deref(), Some("claude-opus-4-5"));

        let roles: Vec<Role> = cap.messages.iter().map(|m| m.role).collect();
        assert_eq!(roles, vec![Role::User, Role::Assistant, Role::Tool, Role::Assistant]);
        assert_eq!(cap.messages[1].blocks.len(), 2);
        match &cap.messages[2].blocks[0] {
            Block::ToolResult { name, output, is_error } => {
                assert_eq!(name.as_deref(), Some("Bash"));
                assert!(output.contains("AssertionError: expected 200, got 401"));
                assert!(*is_error);
            }
            b => panic!("unexpected {b:?}"),
        }

        assert!(!cap.messages[0].blocks[0].plain_text().contains("system-reminder"));
        let what: Vec<&str> = cap.source.omitted.iter().map(|o| o.what.as_str()).collect();
        assert!(what.contains(&"hidden reasoning (thinking) blocks"));
        assert!(what.contains(&"agent-injected meta messages"));
        assert_eq!(cap.source.capture_status, CaptureStatus::Complete);
    }

    #[test]
    fn discovers_fixture_dir() {
        let root = fixture().parent().unwrap().to_path_buf();
        let found = ClaudeCode.discover(&root).unwrap();
        let s = found.iter().find(|s| s.session_id == "sample-session").unwrap();
        assert_eq!(s.title, "Fix the failing login test");
        assert_eq!(s.message_count, 5);
    }

    #[test]
    fn recovers_base64_images_and_text_documents() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        let line = serde_json::json!({
            "type": "user", "sessionId": "abc", "cwd": "/work/x", "uuid": "u1",
            "message": { "role": "user", "content": [
                { "type": "text", "text": "Look at this" },
                { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "iVBORw0KGgo=" } },
                { "type": "document", "title": "notes.txt", "source": { "type": "text", "media_type": "text/plain", "data": "hello" } },
                { "type": "image", "source": { "type": "url", "url": "https://example.invalid/x.png" } }
            ] }
        });
        std::fs::write(&path, format!("{line}\n")).unwrap();
        let cap = ClaudeCode.read(&path).unwrap();
        assert_eq!(cap.files.len(), 2);
        assert_eq!(cap.files[0].name, "image-1.png");
        assert_eq!(cap.files[1].name, "notes.txt");
        let blocks = &cap.messages[0].blocks;
        assert_eq!(blocks.iter().filter(|b| matches!(b, Block::File { .. })).count(), 2);
        assert_eq!(blocks.iter().filter(|b| matches!(b, Block::Missing { .. })).count(), 1);
    }

    #[test]
    fn slash_commands_read_as_typed() {
        let raw = "<command-message>caveman</command-message>\n<command-name>/caveman</command-name>\n<command-args>fix the bug</command-args>";
        assert_eq!(slash_command(raw), "/caveman fix the bug");
        assert_eq!(slash_command("<command-name>clear</command-name>"), "/clear");
        assert_eq!(slash_command("plain text"), "plain text");
    }
}
