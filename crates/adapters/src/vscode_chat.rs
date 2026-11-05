
use std::path::{Path, PathBuf};

use hopilo_core::{new_id, now_rfc3339, Block, CaptureStatus, Message, OmittedCount, Role, Source, SourceKind};
use serde_json::Value;

use crate::text::title_from;
use crate::{file_meta, home, omitted, open_lines, session_stem, AdapterError, Capture, DiscoveredSession, LocalAgentAdapter, Result};

pub struct VsCodeChat;

const EDITORS: [&str; 3] = ["Code", "Code - Insiders", "VSCodium"];

impl LocalAgentAdapter for VsCodeChat {
    fn id(&self) -> &'static str {
        "vscode-copilot"
    }

    fn display_name(&self) -> &'static str {
        "VS Code Copilot"
    }

    fn default_roots(&self) -> Vec<PathBuf> {
        let mut bases = Vec::new();
        if let Some(h) = home() {
            bases.push(h.join("Library").join("Application Support"));
            bases.push(h.join(".config"));
        }
        if let Some(a) = std::env::var_os("APPDATA") {
            bases.push(PathBuf::from(a));
        }
        let all: Vec<PathBuf> = bases.iter().flat_map(|b| EDITORS.iter().map(move |e| b.join(e).join("User"))).collect();
        let present: Vec<PathBuf> = all.iter().filter(|p| p.is_dir()).cloned().collect();
        if present.is_empty() {
            all.into_iter().take(1).collect()
        } else {
            present
        }
    }

    fn scan_depth(&self) -> usize {
        3
    }

    fn discover(&self, root: &Path) -> Result<Vec<DiscoveredSession>> {
        let mut files = Vec::new();
        let mut collect = |dir: PathBuf| {
            let Ok(rd) = std::fs::read_dir(dir) else { return };
            for f in rd.flatten() {
                let p = f.path();
                let ok = f.file_type().is_ok_and(|t| t.is_file()) && p.extension().is_some_and(|e| e == "json" || e == "jsonl");
                if ok {
                    files.push(p);
                }
            }
        };
        if let Ok(rd) = std::fs::read_dir(root.join("workspaceStorage")) {
            for ws in rd.flatten() {
                collect(ws.path().join("chatSessions"));
            }
        }
        collect(root.join("globalStorage").join("emptyWindowChatSessions"));

        files.sort_by_key(|p| std::cmp::Reverse(std::fs::metadata(p).and_then(|m| m.modified()).ok()));
        let mut seen = std::collections::HashSet::new();
        files.retain(|p| seen.insert(session_stem(p)));

        Ok(crate::par_scan(&files, quick_scan))
    }

    fn read(&self, path: &Path) -> Result<Capture> {
        read_session(path)
    }
}

fn quick_scan(path: &Path) -> Option<DiscoveredSession> {
    let cap = read_session(path).ok()?;
    let count = cap.messages.iter().filter(|m| m.role != Role::Tool).count();
    if count == 0 {
        return None;
    }
    let (size_bytes, modified_at) = file_meta(path).ok()?;
    Some(DiscoveredSession {
        adapter: "vscode-copilot".into(),
        path: path.display().to_string(),
        session_id: session_stem(path),
        title: cap.source.title,
        project: cap.source.project,
        model: cap.source.model,
        modified_at,
        size_bytes,
        message_count: count,
    })
}

fn slot<'a>(mut cur: &'a mut Value, path: &[Value]) -> Option<&'a mut Value> {
    for k in path {
        cur = match k {
            Value::String(s) => {
                if !cur.is_object() {
                    *cur = Value::Object(Default::default());
                }
                cur.as_object_mut()?.entry(s.clone()).or_insert(Value::Null)
            }
            Value::Number(n) => {
                let i = n.as_u64()? as usize;
                let arr = cur.as_array_mut()?;
                if i >= arr.len() {
                    arr.resize(i + 1, Value::Null);
                }
                &mut arr[i]
            }
            _ => return None,
        };
    }
    Some(cur)
}

fn replay(path: &Path) -> Result<Value> {
    let mut state = Value::Null;
    for line in open_lines(path)? {
        let line = line.map_err(|source| AdapterError::Io { path: path.display().to_string(), source })?;
        let Ok(op) = serde_json::from_str::<Value>(&line) else { continue };
        let keys = op.get("k").and_then(Value::as_array).cloned().unwrap_or_default();
        let v = op.get("v").cloned().unwrap_or(Value::Null);
        match op.get("kind").and_then(Value::as_i64) {
            Some(0) => state = v,
            Some(1) => {
                if let Some(s) = slot(&mut state, &keys) {
                    *s = v;
                }
            }
            Some(2) => {
                if let Some(s) = slot(&mut state, &keys) {
                    if !s.is_array() {
                        *s = Value::Array(Vec::new());
                    }
                    let arr = s.as_array_mut().expect("just made an array");
                    if let Some(i) = op.get("i").and_then(Value::as_u64) {
                        arr.truncate(i as usize);
                    }
                    match v {
                        Value::Array(items) => arr.extend(items),
                        other => arr.push(other),
                    }
                }
            }
            Some(3) => {
                if let Some((last, parent)) = keys.split_last() {
                    if let Some(p) = slot(&mut state, parent) {
                        match (p, last) {
                            (Value::Object(o), Value::String(k)) => {
                                o.remove(k);
                            }
                            (Value::Array(a), Value::Number(n)) => {
                                if let Some(i) = n.as_u64().map(|i| i as usize).filter(|i| *i < a.len()) {
                                    a.remove(i);
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
            _ => {}
        }
    }
    if state.is_null() {
        return Err(AdapterError::Unrecognized(path.display().to_string()));
    }
    Ok(state)
}

fn load(path: &Path) -> Result<Value> {
    if path.extension().is_some_and(|e| e == "jsonl") {
        return replay(path);
    }
    let text = std::fs::read_to_string(path).map_err(|source| AdapterError::Io { path: path.display().to_string(), source })?;
    serde_json::from_str(&text).map_err(|_| AdapterError::Unrecognized(path.display().to_string()))
}

fn millis(v: Option<&Value>) -> Option<String> {
    chrono::DateTime::from_timestamp_millis(v?.as_i64()?).map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

fn workspace_folder(session: &Path) -> Option<String> {
    let ws = session.parent()?.parent()?.join("workspace.json");
    let v: Value = serde_json::from_str(&std::fs::read_to_string(ws).ok()?).ok()?;
    let uri = v.get("folder").or_else(|| v.get("workspace")).and_then(Value::as_str)?;
    let raw = uri.strip_prefix("file://").unwrap_or(uri);
    Some(crate::text::percent_decode(raw))
}

fn message_text(v: &Value) -> Option<&str> {
    match v {
        Value::String(s) => Some(s),
        Value::Object(o) => o.get("value").and_then(Value::as_str),
        _ => None,
    }
}

#[derive(Default)]
struct Tally {
    thinking: usize,
    attachments: usize,
    edits: usize,
}

fn response_blocks(parts: &[Value], t: &mut Tally) -> Vec<Block> {
    let mut blocks = Vec::new();
    let mut text = String::new();
    let flush = |text: &mut String, blocks: &mut Vec<Block>| {
        let s = text.trim();
        if !s.is_empty() {
            blocks.push(Block::text(s.to_string()));
        }
        text.clear();
    };
    for p in parts {
        match p.get("kind").and_then(Value::as_str) {
            None | Some("markdownContent") | Some("markdownVuln") => {
                let v = p.get("value").or_else(|| p.pointer("/content/value"));
                if let Some(s) = v.and_then(Value::as_str) {
                    text.push_str(s);
                }
            }
            Some("inlineReference") => {
                let name = p.get("name").and_then(Value::as_str).or_else(|| p.pointer("/inlineReference/path").and_then(Value::as_str));
                if let Some(n) = name {
                    text.push('`');
                    text.push_str(n);
                    text.push('`');
                }
            }
            Some("toolInvocationSerialized") => {
                flush(&mut text, &mut blocks);
                let name = p
                    .get("toolId")
                    .and_then(Value::as_str)
                    .or_else(|| p.get("invocationMessage").and_then(message_text))
                    .unwrap_or("tool")
                    .to_string();
                let input = p
                    .pointer("/toolSpecificData/commandLine/original")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| p.get("invocationMessage").and_then(message_text).map(str::to_string))
                    .unwrap_or_default();
                blocks.push(Block::ToolCall { name: name.clone(), input });
                let out = p.get("pastTenseMessage").and_then(message_text).or_else(|| p.pointer("/resultDetails/output").and_then(Value::as_str));
                if let Some(o) = out {
                    blocks.push(Block::ToolResult { name: Some(name), output: o.to_string(), is_error: false });
                }
            }
            Some("thinking") => t.thinking += 1,
            Some("textEditGroup") => t.edits += 1,
            _ => {}
        }
    }
    flush(&mut text, &mut blocks);
    blocks
}

fn read_session(path: &Path) -> Result<Capture> {
    let doc = load(path)?;
    let requests = doc.get("requests").and_then(Value::as_array).ok_or_else(|| AdapterError::Unrecognized(path.display().to_string()))?;
    let source_id = new_id();
    let mut messages = Vec::new();
    let mut t = Tally::default();
    let mut model = None;
    let mut first_prompt = None;

    for r in requests {
        let ts = millis(r.get("timestamp"));
        if let Some(text) = r.pointer("/message/text").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()) {
            if first_prompt.is_none() {
                first_prompt = Some(title_from(text));
            }
            let mut blocks = vec![Block::text(text.to_string())];
            let vars = r.pointer("/variableData/variables").and_then(Value::as_array).map(Vec::len).unwrap_or(0);
            if vars > 0 {
                t.attachments += vars;
                blocks.push(Block::Missing { description: format!("{vars} attached context item(s)") });
            }
            messages.push(Message {
                id: r.get("requestId").and_then(Value::as_str).map(str::to_string).unwrap_or_else(new_id),
                source_id: source_id.clone(),
                role: Role::User,
                created_at: ts.clone(),
                blocks,
            });
        }
        if model.is_none() {
            model = r.get("modelId").and_then(Value::as_str).map(|m| m.trim_start_matches("copilot/").to_string());
        }
        let parts = r.get("response").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]);
        let blocks = response_blocks(parts, &mut t);
        if !blocks.is_empty() {
            messages.push(Message {
                id: r.get("responseId").and_then(Value::as_str).map(str::to_string).unwrap_or_else(new_id),
                source_id: source_id.clone(),
                role: Role::Assistant,
                created_at: ts,
                blocks,
            });
        }
    }

    let title = doc
        .get("customTitle")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(title_from)
        .or(first_prompt)
        .unwrap_or_else(|| "VS Code chat".into());
    if model.is_none() {
        model = doc.pointer("/inputState/selectedModel/metadata/name").and_then(Value::as_str).map(str::to_string);
    }
    let mut missing = Vec::new();
    if t.attachments > 0 {
        missing.push(format!("{} attached context item(s) referenced but not recovered", t.attachments));
    }
    let mut om: Vec<OmittedCount> = Vec::new();
    omitted(&mut om, "hidden reasoning (thinking) blocks", t.thinking);
    omitted(&mut om, "inline file edit groups", t.edits);

    let source = Source {
        source_id,
        kind: SourceKind::LocalAgent,
        provider: "vscode-copilot".into(),
        title,
        origin: Some(path.display().to_string()),
        project: workspace_folder(path),
        model,
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

    #[test]
    fn replays_jsonl_edit_log() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path().join("workspaceStorage").join("abc");
        std::fs::create_dir_all(ws.join("chatSessions")).unwrap();
        std::fs::write(ws.join("workspace.json"), r#"{"folder":"file:///Users/me/My%20App"}"#).unwrap();
        let lines = [
            r#"{"kind":0,"v":{"version":3,"sessionId":"s","requests":[],"inputState":{"selectedModel":{"metadata":{"name":"GPT-5"}}}}}"#,
            r#"{"kind":1,"k":["customTitle"],"v":"Creating tests"}"#,
            r#"{"kind":2,"k":["requests"],"v":[{"requestId":"r1","timestamp":1774593750649,"message":{"text":"create test"},"response":[],"modelId":"copilot/gpt-4.1"}]}"#,
            r#"{"kind":2,"k":["requests",0,"response"],"v":[{"value":"Sure, "},{"value":"done."},{"kind":"toolInvocationSerialized","toolId":"run_in_terminal","invocationMessage":"Running","toolSpecificData":{"commandLine":{"original":"npm test"}},"pastTenseMessage":{"value":"Ran npm test"}}]}"#,
        ];
        std::fs::write(ws.join("chatSessions").join("s.jsonl"), lines.join("\n")).unwrap();

        let found = VsCodeChat.discover(dir.path()).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].title, "Creating tests");
        assert_eq!(found[0].project.as_deref(), Some("/Users/me/My App"));
        assert_eq!(found[0].model.as_deref(), Some("gpt-4.1"));
        let cap = VsCodeChat.read(Path::new(&found[0].path)).unwrap();
        assert_eq!(cap.messages.len(), 2);
        assert_eq!(cap.messages[1].blocks[0].plain_text(), "Sure, done.");
        assert!(matches!(&cap.messages[1].blocks[1], Block::ToolCall { name, input } if name == "run_in_terminal" && input == "npm test"));
    }

    #[test]
    fn reads_legacy_json_and_skips_empty() {
        let dir = tempfile::tempdir().unwrap();
        let cs = dir.path().join("globalStorage").join("emptyWindowChatSessions");
        std::fs::create_dir_all(&cs).unwrap();
        let doc = serde_json::json!({"requests":[{"message":{"text":"why is it slow"},"response":[{"value":"Because."}]}]});
        std::fs::write(cs.join("a.json"), doc.to_string()).unwrap();
        std::fs::write(cs.join("b.json"), r#"{"requests":[]}"#).unwrap();
        let found = VsCodeChat.discover(dir.path()).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].title, "why is it slow");
    }
}
