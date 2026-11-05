//! One tolerant reader for the many agents that store a conversation as a
//! JSONL log (or a JSON array) of chat messages. The shapes differ only in
//! where the role/content live and what tool parts are called, so each agent is
//! a small [`ChatLogAgent`] description over the same parser.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use hopilo_core::{new_id, now_rfc3339, Block, CaptureStatus, Message, OmittedCount, Role, Source, SourceKind};
use serde_json::Value;

use crate::text::{strip_injected, title_from};
use crate::{file_meta, home, is_jsonl, memo_scan, omitted, open_lines, session_stem, AdapterError, Capture, DiscoveredSession, LocalAgentAdapter, Result};

pub struct ChatLogAgent {
    pub id: &'static str,
    pub name: &'static str,
    roots: fn() -> Vec<PathBuf>,
    depth: usize,
    /// Which files under a root are session logs.
    accept: fn(&Path) -> bool,
}

impl ChatLogAgent {
    fn session_id(&self, path: &Path) -> String {
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        // Session-per-folder layouts: the folder name is the id.
        if matches!(name.as_str(), "events.jsonl" | "context.jsonl" | "api_conversation_history.json") {
            if let Some(dir) = path.parent().and_then(Path::file_name) {
                return dir.to_string_lossy().to_string();
            }
        }
        session_stem(path)
    }
}

fn dir_files(root: &Path, depth: usize, accept: fn(&Path) -> bool, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(root) else { return };
    for e in rd.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        let p = e.path();
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() && depth > 0 {
            dir_files(&p, depth - 1, accept, out);
        } else if ft.is_file() && accept(&p) {
            out.push(p);
        }
    }
}

impl LocalAgentAdapter for ChatLogAgent {
    fn id(&self) -> &'static str {
        self.id
    }

    fn display_name(&self) -> &'static str {
        self.name
    }

    fn default_roots(&self) -> Vec<PathBuf> {
        (self.roots)()
    }

    fn scan_depth(&self) -> usize {
        self.depth
    }

    fn discover(&self, root: &Path) -> Result<Vec<DiscoveredSession>> {
        let mut files = Vec::new();
        dir_files(root, self.depth, self.accept, &mut files);
        Ok(files
            .iter()
            .filter_map(|p| {
                memo_scan(p, |p| {
                    let cap = read_log(self, p).ok()?;
                    let count = cap.messages.iter().filter(|m| m.role != Role::Tool).count();
                    if count == 0 {
                        return None;
                    }
                    let (size_bytes, modified_at) = file_meta(p).ok()?;
                    Some(DiscoveredSession {
                        adapter: self.id.into(),
                        path: p.display().to_string(),
                        session_id: self.session_id(p),
                        title: cap.source.title,
                        project: cap.source.project,
                        model: cap.source.model,
                        modified_at,
                        size_bytes,
                        message_count: count,
                    })
                })
            })
            .collect())
    }

    fn read(&self, path: &Path) -> Result<Capture> {
        read_log(self, path)
    }
}

// ---------------------------------------------------------------- agents ---

fn named(p: &Path, n: &str) -> bool {
    p.file_name().is_some_and(|f| f == n)
}

fn env_or_home(var: &str, rel: &[&str]) -> Option<PathBuf> {
    std::env::var_os(var).map(PathBuf::from).or_else(|| {
        let mut p = home()?;
        for r in rel {
            p.push(r);
        }
        Some(p)
    })
}

/// Factory's Droid CLI: `~/.factory/sessions/<project>/<id>.jsonl`.
pub const DROID: ChatLogAgent = ChatLogAgent {
    id: "droid",
    name: "Factory Droid",
    roots: || env_or_home("FACTORY_HOME", &[".factory"]).map(|b| vec![b.join("sessions")]).unwrap_or_default(),
    depth: 2,
    accept: is_jsonl,
};

/// Pi coding agent: `~/.pi/agent/sessions/<project>/<stamp>_<id>.jsonl`.
pub const PI: ChatLogAgent = ChatLogAgent {
    id: "pi",
    name: "Pi",
    roots: || env_or_home("PI_CODING_AGENT_DIR", &[".pi", "agent"]).map(|b| vec![b.join("sessions")]).unwrap_or_default(),
    depth: 2,
    accept: is_jsonl,
};

/// Kimi CLI: `~/.kimi/sessions/<workdir-hash>/<id>/context.jsonl` (or `<id>.jsonl`).
pub const KIMI: ChatLogAgent = ChatLogAgent {
    id: "kimi-cli",
    name: "Kimi CLI",
    roots: || env_or_home("KIMI_SHARE_DIR", &[".kimi"]).map(|b| vec![b.join("sessions")]).unwrap_or_default(),
    depth: 2,
    accept: |p| is_jsonl(p) && !p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("wire")),
};

/// Block's Goose: `~/.local/share/goose/sessions/<id>.jsonl`.
pub const GOOSE: ChatLogAgent = ChatLogAgent {
    id: "goose",
    name: "Goose",
    roots: || {
        let mut roots = Vec::new();
        if let Some(d) = std::env::var_os("XDG_DATA_HOME") {
            roots.push(PathBuf::from(d).join("goose").join("sessions"));
        }
        if let Some(h) = home() {
            let p = h.join(".local").join("share").join("goose").join("sessions");
            if !roots.contains(&p) {
                roots.push(p);
            }
        }
        if let Some(a) = std::env::var_os("APPDATA") {
            roots.push(PathBuf::from(a).join("Block").join("goose").join("data").join("sessions"));
        }
        roots
    },
    depth: 0,
    accept: is_jsonl,
};

/// GitHub Copilot CLI: `~/.copilot/session-state/<id>.jsonl` or
/// `<id>/events.jsonl`, and the older `history-session-state/*.json`.
pub const COPILOT_CLI: ChatLogAgent = ChatLogAgent {
    id: "copilot-cli",
    name: "Copilot CLI",
    roots: || {
        let base = std::env::var_os("XDG_CONFIG_HOME")
            .map(|x| PathBuf::from(x).join(".copilot"))
            .filter(|p| p.is_dir())
            .or_else(|| home().map(|h| h.join(".copilot")));
        base.map(|b| vec![b.join("session-state"), b.join("history-session-state")]).unwrap_or_default()
    },
    depth: 1,
    accept: |p| is_jsonl(p) || p.extension().is_some_and(|e| e == "json"),
};

/// VS Code-family editors that extensions like Cline store data under.
pub(crate) fn editor_user_dirs() -> Vec<PathBuf> {
    const EDITORS: [&str; 7] = ["Code", "Code - Insiders", "VSCodium", "Cursor", "Windsurf", "Trae", "Kiro"];
    let mut bases = Vec::new();
    if let Some(h) = home() {
        bases.push(h.join("Library").join("Application Support"));
        bases.push(h.join(".config"));
    }
    if let Some(a) = std::env::var_os("APPDATA") {
        bases.push(PathBuf::from(a));
    }
    let mut out = Vec::new();
    for b in &bases {
        for e in EDITORS {
            out.push(b.join(e).join("User"));
        }
    }
    out
}

/// Task folders for a Cline-family extension, across every editor it may be
/// installed in. Only folders that exist are returned, so Settings stays short.
fn extension_tasks(ext_id: &str, extra: Option<PathBuf>) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = editor_user_dirs()
        .into_iter()
        .map(|u| u.join("globalStorage").join(ext_id).join("tasks"))
        .filter(|p| p.is_dir())
        .collect();
    if let Some(e) = extra.filter(|p| p.is_dir()) {
        out.push(e);
    }
    if out.is_empty() {
        // Show where it would be on this platform even when not installed.
        if let Some(first) = editor_user_dirs().into_iter().find(|u| u.parent().is_some_and(Path::is_dir)).or_else(|| editor_user_dirs().into_iter().next()) {
            out.push(first.join("globalStorage").join(ext_id).join("tasks"));
        }
    }
    out
}

fn cline_task(p: &Path) -> bool {
    named(p, "api_conversation_history.json")
}

/// Cline (VS Code extension and `cline` CLI).
pub const CLINE: ChatLogAgent = ChatLogAgent {
    id: "cline",
    name: "Cline",
    roots: || extension_tasks("saoudrizwan.claude-dev", home().map(|h| h.join(".cline").join("data").join("tasks"))),
    depth: 1,
    accept: cline_task,
};

pub const ROO_CODE: ChatLogAgent = ChatLogAgent {
    id: "roo-code",
    name: "Roo Code",
    roots: || extension_tasks("rooveterinaryinc.roo-cline", None),
    depth: 1,
    accept: cline_task,
};

pub const KILO_CODE: ChatLogAgent = ChatLogAgent {
    id: "kilo-code",
    name: "Kilo Code",
    roots: || extension_tasks("kilocode.kilo-code", home().map(|h| h.join(".kilocode").join("cli").join("global").join("tasks"))),
    depth: 1,
    accept: cline_task,
};

// ---------------------------------------------------------------- parser ---

#[derive(Default)]
struct Tally {
    thinking: usize,
    injected: usize,
    media: usize,
    unreadable: usize,
    system: usize,
}

/// Context agents inject into the user's turn.
const CONTEXT_TAGS: [&str; 7] = ["environment_details", "user_info", "additional_data", "env", "project_layout", "rules", "attached_files"];
/// Wrappers around the user's actual words.
const QUERY_TAGS: [&str; 3] = ["task", "user_query", "feedback"];

fn strip_tag_blocks(text: &str, tag: &str, removed: &mut usize) -> String {
    let open = format!("<{tag}>");
    if !text.contains(&open) {
        return text.to_string();
    }
    let close = format!("</{tag}>");
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find(&open) {
        out.push_str(&rest[..start]);
        *removed += 1;
        rest = match rest[start..].find(&close) {
            Some(end) => &rest[start + end + close.len()..],
            None => "",
        };
    }
    out.push_str(rest);
    out
}

fn inner_tag<'a>(text: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{tag}>");
    let start = text.find(&open)? + open.len();
    let end = text[start..].find(&format!("</{tag}>")).map(|e| start + e).unwrap_or(text.len());
    Some(text[start..end].trim())
}

/// Removes injected context from user text and unwraps `<task>`-style tags.
fn clean_user_text(raw: &str, t: &mut Tally) -> String {
    let mut s = raw.to_string();
    for tag in CONTEXT_TAGS {
        s = strip_tag_blocks(&s, tag, &mut t.injected);
    }
    let (s, n) = strip_injected(&s);
    t.injected += n;
    for tag in QUERY_TAGS {
        if let Some(inner) = inner_tag(&s, tag) {
            return inner.to_string();
        }
    }
    s
}

/// Best-effort plain text out of a tool output in any of the common shapes.
fn value_text(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        Value::Array(items) => items.iter().map(value_text).filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n"),
        Value::Object(o) => {
            for k in ["text", "content", "output", "result", "value", "detailedContent"] {
                if let Some(inner) = o.get(k) {
                    let t = value_text(inner);
                    if !t.is_empty() {
                        return t;
                    }
                }
            }
            v.to_string()
        }
        other => other.to_string(),
    }
}

fn args_text(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => serde_json::from_str::<Value>(s)
            .ok()
            .filter(|v| v.is_object() || v.is_array())
            .and_then(|v| serde_json::to_string_pretty(&v).ok())
            .unwrap_or_else(|| s.clone()),
        Some(other) => serde_json::to_string_pretty(other).unwrap_or_default(),
    }
}

fn first_str<'a>(v: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|k| v.pointer(k).and_then(Value::as_str))
}

fn push_text(role: Role, s: &str, blocks: &mut Vec<Block>, t: &mut Tally) {
    let s = if role == Role::User { clean_user_text(s, t) } else { s.to_string() };
    let s = s.trim();
    if !s.is_empty() {
        blocks.push(Block::text(s.to_string()));
    }
}

fn parts_to_blocks(role: Role, content: &Value, names: &mut HashMap<String, String>, t: &mut Tally) -> Vec<Block> {
    let mut blocks = Vec::new();
    match content {
        Value::String(s) => push_text(role, s, &mut blocks, t),
        Value::Array(parts) => {
            for p in parts {
                if let Value::String(s) = p {
                    push_text(role, s, &mut blocks, t);
                    continue;
                }
                let kind = p.get("type").and_then(Value::as_str).unwrap_or("");
                match kind {
                    "tool_use" | "toolCall" | "tool-call" | "tool_call" | "function_call" | "toolRequest" => {
                        let name = first_str(p, &["/name", "/toolName", "/function/name", "/toolCall/value/name", "/toolCall/name"])
                            .unwrap_or("tool")
                            .to_string();
                        if let Some(id) = first_str(p, &["/id", "/toolCallId", "/call_id"]) {
                            names.insert(id.to_string(), name.clone());
                        }
                        let input = ["/input", "/arguments", "/args", "/function/arguments", "/toolCall/value/arguments", "/toolCall/arguments"]
                            .iter()
                            .find_map(|k| p.pointer(k));
                        blocks.push(Block::ToolCall { name, input: args_text(input) });
                    }
                    "tool_result" | "toolResult" | "tool-result" | "function_call_output" | "toolResponse" => {
                        let id = first_str(p, &["/tool_use_id", "/toolCallId", "/call_id", "/id"]);
                        let name = first_str(p, &["/toolName", "/name"]).map(str::to_string).or_else(|| id.and_then(|i| names.get(i).cloned()));
                        let out = ["/content", "/result", "/output", "/toolResult/value", "/toolResult"].iter().find_map(|k| p.pointer(k));
                        let is_error = p.get("is_error").or_else(|| p.get("isError")).and_then(Value::as_bool).unwrap_or(false);
                        blocks.push(Block::ToolResult { name, output: out.map(value_text).unwrap_or_default(), is_error });
                    }
                    "thinking" | "reasoning" | "redacted_thinking" => t.thinking += 1,
                    "image" | "image_url" | "input_image" | "file" | "document" => {
                        t.media += 1;
                        blocks.push(Block::Missing { description: format!("{kind} shared in the conversation") });
                    }
                    _ => {
                        if let Some(s) = p.get("text").and_then(Value::as_str) {
                            push_text(role, s, &mut blocks, t);
                        }
                    }
                }
            }
        }
        Value::Object(o) => {
            if let Some(s) = o.get("text").and_then(Value::as_str) {
                push_text(role, s, &mut blocks, t);
            }
        }
        _ => {}
    }
    blocks
}

fn map_role(r: &str) -> Option<Role> {
    match r {
        "user" | "human" => Some(Role::User),
        "assistant" | "model" | "ai" | "bot" => Some(Role::Assistant),
        "tool" | "toolResult" | "tool_result" | "function" => Some(Role::Tool),
        _ => None,
    }
}

#[derive(Default)]
struct Meta {
    title: Option<String>,
    project: Option<String>,
    model: Option<String>,
}

fn note_meta(v: &Value, m: &mut Meta) {
    if m.title.is_none() {
        m.title = first_str(v, &["/title", "/description", "/summary", "/data/title"]).map(title_from).filter(|s| !s.is_empty());
    }
    if m.project.is_none() {
        m.project = first_str(v, &["/cwd", "/working_dir", "/workingDirectory", "/workspace", "/data/context/cwd", "/data/cwd", "/context/cwd"])
            .map(str::to_string);
    }
    if m.model.is_none() {
        m.model = first_str(v, &["/model", "/modelId", "/data/selectedModel", "/data/model", "/data/newModel"]).map(str::to_string);
    }
}

/// Cline puts the folder in its injected environment block.
fn cline_cwd(text: &str) -> Option<String> {
    let marker = "# Current Working Directory (";
    let start = text.find(marker)? + marker.len();
    let end = text[start..].find(')')?;
    Some(text[start..start + end].to_string())
}

struct Entry {
    role: Role,
    ts: Option<String>,
    content: Value,
    calls: Option<Value>,
    model: Option<String>,
    tool_id: Option<String>,
}

fn timestamp(v: &Value) -> Option<String> {
    first_str(v, &["/timestamp", "/created_at", "/createdAt", "/message/timestamp"]).map(str::to_string).or_else(|| {
        // Goose and others use epoch seconds or millis.
        let n = v.get("created").or_else(|| v.get("timestamp")).and_then(Value::as_i64)?;
        let dt = if n > 10_000_000_000 { chrono::DateTime::from_timestamp_millis(n) } else { chrono::DateTime::from_timestamp(n, 0) };
        dt.map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
    })
}

/// Turns one log entry into a chat message, if it is one.
fn as_message(v: &Value) -> Option<Entry> {
    let ts = timestamp(v);
    let entry = |role, content, calls| Entry { role, ts: ts.clone(), content, calls, model: None, tool_id: None };

    // Copilot CLI events.
    if let (Some(kind), Some(data)) = (v.get("type").and_then(Value::as_str), v.get("data")) {
        match kind {
            "user.message" => return Some(entry(Role::User, data.get("content").cloned().unwrap_or(Value::Null), None)),
            "assistant.message" => {
                return Some(entry(Role::Assistant, data.get("content").cloned().unwrap_or(Value::Null), data.get("toolRequests").cloned()))
            }
            "tool.execution_complete" => {
                let part = serde_json::json!([{
                    "type": "tool_result",
                    "tool_use_id": data.get("toolCallId"),
                    "content": data.get("result"),
                    "is_error": data.get("success").and_then(Value::as_bool) == Some(false),
                }]);
                return Some(entry(Role::Tool, part, None));
            }
            _ => {}
        }
    }

    let m = match v.get("message") {
        Some(inner) if inner.get("role").is_some() => inner,
        _ if v.get("role").is_some() => v,
        _ => return None,
    };
    let role_s = m.get("role").and_then(Value::as_str)?;
    if matches!(role_s, "system" | "developer") {
        return Some(entry(Role::System, Value::Null, None));
    }
    let role = map_role(role_s)?;
    Some(Entry {
        role,
        ts,
        content: m.get("content").or_else(|| m.get("parts")).cloned().unwrap_or(Value::Null),
        calls: m.get("tool_calls").cloned(),
        model: m.get("model").and_then(Value::as_str).map(str::to_string),
        tool_id: m.get("tool_call_id").and_then(Value::as_str).map(str::to_string),
    })
}

fn read_entries(path: &Path, t: &mut Tally) -> Result<Vec<Value>> {
    let io = |source| AdapterError::Io { path: path.display().to_string(), source };
    if path.extension().is_some_and(|e| e == "json") {
        let text = std::fs::read_to_string(path).map_err(io)?;
        let v: Value = serde_json::from_str(&text).map_err(|_| AdapterError::Unrecognized(path.display().to_string()))?;
        return match v {
            Value::Array(items) => Ok(items),
            Value::Object(mut o) => {
                // Copilot CLI's older single-file format, or {messages: [...]}.
                let list = ["chatMessages", "messages"].iter().find_map(|k| match o.remove(*k) {
                    Some(Value::Array(a)) => Some(a),
                    _ => None,
                });
                match list {
                    Some(list) => {
                        let mut items = vec![Value::Object(o)];
                        items.extend(list);
                        Ok(items)
                    }
                    None => Err(AdapterError::Unrecognized(path.display().to_string())),
                }
            }
            _ => Err(AdapterError::Unrecognized(path.display().to_string())),
        };
    }
    let mut out = Vec::new();
    for line in open_lines(path)? {
        let line = line.map_err(io)?;
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<Value>(&line) {
            Ok(v) => out.push(v),
            Err(_) => t.unreadable += 1,
        }
    }
    Ok(out)
}

fn read_log(agent: &ChatLogAgent, path: &Path) -> Result<Capture> {
    let mut t = Tally::default();
    let entries = read_entries(path, &mut t)?;
    let source_id = new_id();
    let mut meta = Meta::default();
    let mut names: HashMap<String, String> = HashMap::new();
    let mut messages: Vec<Message> = Vec::new();
    let mut first_prompt = None;

    for v in &entries {
        let Some(Entry { mut role, ts, content, calls, model, tool_id }) = as_message(v) else {
            note_meta(v, &mut meta);
            continue;
        };
        if role == Role::System {
            t.system += 1;
            continue;
        }
        if meta.model.is_none() && role == Role::Assistant {
            meta.model = model;
        }
        if meta.project.is_none() && role == Role::User {
            meta.project = cline_cwd(&value_text(&content));
        }
        let mut blocks = if role == Role::Tool && content.is_string() {
            // OpenAI-style tool message: plain string answering a call id.
            vec![Block::ToolResult {
                name: tool_id.as_deref().and_then(|i| names.get(i).cloned()),
                output: content.as_str().unwrap_or("").to_string(),
                is_error: false,
            }]
        } else {
            parts_to_blocks(role, &content, &mut names, &mut t)
        };
        for c in calls.as_ref().and_then(Value::as_array).into_iter().flatten() {
            let name = first_str(c, &["/function/name", "/name"]).unwrap_or("tool").to_string();
            if let Some(id) = first_str(c, &["/id", "/toolCallId"]) {
                names.insert(id.to_string(), name.clone());
            }
            let input = c.pointer("/function/arguments").or_else(|| c.get("arguments")).or_else(|| c.get("input"));
            blocks.push(Block::ToolCall { name, input: args_text(input) });
        }
        if blocks.is_empty() {
            continue;
        }
        if role == Role::User && blocks.iter().all(|b| matches!(b, Block::ToolResult { .. })) {
            role = Role::Tool;
        }
        if role == Role::User && first_prompt.is_none() {
            first_prompt = blocks.iter().find_map(|b| match b {
                Block::Text { text } => Some(title_from(text)).filter(|s| !s.is_empty()),
                _ => None,
            });
        }
        messages.push(Message { id: new_id(), source_id: source_id.clone(), role, created_at: ts, blocks });
    }
    if entries.is_empty() {
        return Err(AdapterError::Unrecognized(path.display().to_string()));
    }

    let mut missing = Vec::new();
    if t.unreadable > 0 {
        missing.push(format!("{} unreadable line(s) in the session file", t.unreadable));
    }
    if t.media > 0 {
        missing.push(format!("{} image/file attachment(s) referenced but not recovered", t.media));
    }
    let mut om: Vec<OmittedCount> = Vec::new();
    omitted(&mut om, "hidden reasoning (thinking) blocks", t.thinking);
    omitted(&mut om, "injected context blocks", t.injected);
    omitted(&mut om, "system prompts", t.system);

    let sid = agent.session_id(path);
    let short: String = sid.chars().take(8).collect();
    let source = Source {
        source_id,
        kind: SourceKind::LocalAgent,
        provider: agent.id.into(),
        title: meta.title.or(first_prompt).unwrap_or_else(|| format!("{} session {short}", agent.name)),
        origin: Some(path.display().to_string()),
        project: meta.project,
        model: meta.model,
        captured_at: now_rfc3339(),
        capture_status: if missing.is_empty() { CaptureStatus::Complete } else { CaptureStatus::Partial },
        missing_items: missing,
        omitted: om,
    };
    Ok(Capture { source, messages, files: vec![] })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(dir: &Path, rel: &str, body: &str) -> PathBuf {
        let p = dir.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, body).unwrap();
        p
    }

    #[test]
    fn droid_style_anthropic_blocks() {
        let dir = tempfile::tempdir().unwrap();
        let body = [
            r#"{"type":"session_start","id":"s1","title":"Fix the build","cwd":"/work/app"}"#,
            r#"{"type":"message","timestamp":"2026-01-01T00:00:00Z","message":{"role":"user","content":[{"type":"text","text":"<system-reminder>x</system-reminder>Fix the build"}]}}"#,
            r#"{"type":"message","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hm"},{"type":"text","text":"Running it."},{"type":"tool_use","id":"t1","name":"Execute","input":{"command":"make"}}]}}"#,
            r#"{"type":"message","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}"#,
        ]
        .join("\n");
        write(dir.path(), "proj/s1.jsonl", &body);
        let found = DROID.discover(dir.path()).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].title, "Fix the build");
        assert_eq!(found[0].project.as_deref(), Some("/work/app"));
        let cap = DROID.read(Path::new(&found[0].path)).unwrap();
        let roles: Vec<Role> = cap.messages.iter().map(|m| m.role).collect();
        assert_eq!(roles, vec![Role::User, Role::Assistant, Role::Tool]);
        assert_eq!(cap.messages[0].blocks[0].plain_text(), "Fix the build");
        assert_eq!(cap.messages[0].created_at.as_deref(), Some("2026-01-01T00:00:00Z"));
        assert!(matches!(&cap.messages[2].blocks[0], Block::ToolResult { name: Some(n), .. } if n == "Execute"));
    }

    #[test]
    fn openai_style_messages_with_tool_calls() {
        let dir = tempfile::tempdir().unwrap();
        let body = [
            r#"{"role":"system","content":"be nice"}"#,
            r#"{"role":"user","content":"list files"}"#,
            r#"{"role":"assistant","content":"","tool_calls":[{"id":"c1","type":"function","function":{"name":"shell","arguments":"{\"cmd\":\"ls\"}"}}]}"#,
            r#"{"role":"tool","tool_call_id":"c1","content":"a.txt"}"#,
            r#"{"role":"assistant","content":"One file."}"#,
        ]
        .join("\n");
        let p = write(dir.path(), "h/sess/context.jsonl", &body);
        let cap = KIMI.read(&p).unwrap();
        assert_eq!(cap.messages.len(), 4);
        assert!(matches!(&cap.messages[2].blocks[0], Block::ToolResult { name: Some(n), output, .. } if n == "shell" && output == "a.txt"));
        assert_eq!(KIMI.session_id(&p), "sess");
        assert_eq!(cap.source.omitted.iter().find(|o| o.what == "system prompts").map(|o| o.count), Some(1));
    }

    #[test]
    fn copilot_cli_events() {
        let dir = tempfile::tempdir().unwrap();
        let body = [
            r#"{"type":"session.start","data":{"sessionId":"abc","selectedModel":"gpt-5","context":{"cwd":"/w"}}}"#,
            r#"{"type":"user.message","data":{"content":"hello there"},"timestamp":"2026-01-01T00:00:00Z"}"#,
            r#"{"type":"assistant.message","data":{"content":"hi","toolRequests":[{"toolCallId":"t","name":"bash","arguments":{"command":"ls"}}]}}"#,
            r#"{"type":"tool.execution_complete","data":{"toolCallId":"t","success":true,"result":{"content":"x"}}}"#,
        ]
        .join("\n");
        let p = write(dir.path(), "abc/events.jsonl", &body);
        let cap = COPILOT_CLI.read(&p).unwrap();
        assert_eq!(cap.source.model.as_deref(), Some("gpt-5"));
        assert_eq!(cap.source.project.as_deref(), Some("/w"));
        assert_eq!(cap.messages.len(), 3);
        assert!(matches!(&cap.messages[2].blocks[0], Block::ToolResult { name: Some(n), output, .. } if n == "bash" && output == "x"));
        assert_eq!(COPILOT_CLI.session_id(&p), "abc");
    }

    #[test]
    fn cline_task_history() {
        let dir = tempfile::tempdir().unwrap();
        let body = serde_json::json!([
            {"role":"user","content":[{"type":"text","text":"<task>\nAdd a README\n</task>"},{"type":"text","text":"<environment_details>\n# Current Working Directory (/Users/me/proj) Files\nREADME\n</environment_details>"}]},
            {"role":"assistant","content":[{"type":"text","text":"Sure."}]}
        ]);
        let p = write(dir.path(), "1700000000000/api_conversation_history.json", &body.to_string());
        let found = CLINE.discover(dir.path()).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].session_id, "1700000000000");
        assert_eq!(found[0].title, "Add a README");
        assert_eq!(found[0].project.as_deref(), Some("/Users/me/proj"));
        let cap = CLINE.read(&p).unwrap();
        assert_eq!(cap.messages[0].blocks.len(), 1);
    }

    #[test]
    fn non_chat_json_is_not_a_session() {
        let dir = tempfile::tempdir().unwrap();
        let p = write(dir.path(), "config.json", r#"{"theme":"dark"}"#);
        assert!(COPILOT_CLI.read(&p).is_err());
        assert!(COPILOT_CLI.discover(dir.path()).unwrap().is_empty());
    }
}
