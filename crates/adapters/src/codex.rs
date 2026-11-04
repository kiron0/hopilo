//! Codex CLI sessions: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (or
//! `$CODEX_HOME/sessions`). Lines are `{timestamp, type, payload}`; older
//! rollouts put response items at the top level without `payload`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use hopilo_core::{
    new_id, now_rfc3339, Block, CaptureStatus, Message, OmittedCount, Role, Source, SourceKind,
};
use serde_json::Value;

use crate::text::title_from;
use crate::{
    file_meta, home, jsonl_files, omitted, open_lines, AdapterError, Capture, DiscoveredSession,
    LocalAgentAdapter, Result,
};

pub struct Codex;

impl LocalAgentAdapter for Codex {
    fn id(&self) -> &'static str {
        "codex"
    }

    fn display_name(&self) -> &'static str {
        "Codex CLI"
    }

    fn default_roots(&self) -> Vec<PathBuf> {
        let base = std::env::var_os("CODEX_HOME")
            .map(PathBuf::from)
            .or_else(|| home().map(|h| h.join(".codex")));
        base.map(|b| vec![b.join("sessions")]).unwrap_or_default()
    }

    fn discover(&self, root: &Path) -> Result<Vec<DiscoveredSession>> {
        let mut files = Vec::new();
        jsonl_files(root, 4, &mut files);
        let mut out = Vec::new();
        for path in files {
            let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            if !name.starts_with("rollout-") {
                continue;
            }
            // Discovery uses the full reader: Codex files carry the first user
            // prompt after injected context, so a prefix scan is unreliable.
            let Ok(cap) = read_rollout(&path) else { continue };
            let count = cap.messages.iter().filter(|m| m.role != Role::Tool).count();
            if count == 0 {
                continue;
            }
            let Ok((size_bytes, modified_at)) = file_meta(&path) else { continue };
            out.push(DiscoveredSession {
                adapter: "codex".into(),
                path: path.display().to_string(),
                session_id: session_id_from(&path),
                title: cap.source.title,
                project: cap.source.project,
                model: cap.source.model,
                modified_at,
                size_bytes,
                message_count: count,
            });
        }
        Ok(out)
    }

    fn read(&self, path: &Path) -> Result<Capture> {
        read_rollout(path)
    }
}

fn session_id_from(path: &Path) -> String {
    path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
}

fn is_injected_user_text(t: &str) -> bool {
    let t = t.trim_start();
    ["<environment_context>", "<user_instructions>", "<permissions instructions>", "# AGENTS.md", "<INSTRUCTIONS>"]
        .iter()
        .any(|p| t.starts_with(p))
}

fn output_text(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => {
            // function_call_output often wraps `{output, metadata}` as a string.
            serde_json::from_str::<Value>(s)
                .ok()
                .and_then(|inner| inner.get("output").and_then(Value::as_str).map(str::to_string))
                .unwrap_or_else(|| s.clone())
        }
        Some(Value::Object(o)) => o
            .get("content")
            .and_then(Value::as_str)
            .or_else(|| o.get("output").and_then(Value::as_str))
            .map(str::to_string)
            .unwrap_or_else(|| Value::Object(o.clone()).to_string()),
        Some(other) => other.to_string(),
        None => String::new(),
    }
}

fn pretty_args(s: &str) -> String {
    serde_json::from_str::<Value>(s)
        .ok()
        .and_then(|v| serde_json::to_string_pretty(&v).ok())
        .unwrap_or_else(|| s.to_string())
}

#[derive(Default)]
struct Tally {
    reasoning: usize,
    injected: usize,
    unreadable: usize,
    images: usize,
    compactions: usize,
    files: Vec<hopilo_core::CapturedFile>,
}

fn read_rollout(path: &Path) -> Result<Capture> {
    let source_id = new_id();
    let mut messages = Vec::new();
    let mut names: HashMap<String, String> = HashMap::new();
    let mut t = Tally::default();
    let mut project = None;
    let mut model = None;
    let mut first_prompt = None;
    let mut saw_any = false;

    for line in open_lines(path)? {
        let line = line.map_err(|source| AdapterError::Io { path: path.display().to_string(), source })?;
        if line.trim().is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            t.unreadable += 1;
            continue;
        };
        saw_any = true;
        let ts = v.get("timestamp").and_then(Value::as_str).map(str::to_string);
        let (outer, item) = match v.get("payload") {
            Some(p) => (v.get("type").and_then(Value::as_str).unwrap_or(""), p),
            None => ("response_item", &v),
        };
        match outer {
            "session_meta" => {
                project = project.or(item.get("cwd").and_then(Value::as_str).map(str::to_string));
                continue;
            }
            "turn_context" => {
                model = model.or(item.get("model").and_then(Value::as_str).map(str::to_string));
                continue;
            }
            "compacted" => {
                t.compactions += 1;
                if let Some(summary) = item.get("message").and_then(Value::as_str).filter(|s| !s.trim().is_empty()) {
                    messages.push(Message {
                        id: new_id(),
                        source_id: source_id.clone(),
                        role: Role::System,
                        created_at: ts,
                        blocks: vec![Block::text(format!("Codex compaction summary:\n\n{summary}"))],
                    });
                }
                continue;
            }
            "response_item" => {}
            _ => continue,
        }

        let id = item.get("id").and_then(Value::as_str).map(str::to_string).unwrap_or_else(new_id);
        let push = |messages: &mut Vec<Message>, role, blocks| {
            messages.push(Message { id: id.clone(), source_id: source_id.clone(), role, created_at: ts.clone(), blocks });
        };
        match item.get("type").and_then(Value::as_str).unwrap_or("") {
            "message" => {
                let role = match item.get("role").and_then(Value::as_str) {
                    Some("user") => Role::User,
                    Some("assistant") => Role::Assistant,
                    _ => {
                        t.injected += 1;
                        continue;
                    }
                };
                let mut blocks = Vec::new();
                for c in item.get("content").and_then(Value::as_array).into_iter().flatten() {
                    match c.get("type").and_then(Value::as_str) {
                        Some("input_text" | "output_text" | "text") => {
                            let text = c.get("text").and_then(Value::as_str).unwrap_or("");
                            if role == Role::User && is_injected_user_text(text) {
                                t.injected += 1;
                            } else if !text.trim().is_empty() {
                                blocks.push(Block::text(text.trim_end()));
                            }
                        }
                        Some("input_image") => {
                            let url = c.get("image_url").and_then(|u| u.as_str().or_else(|| u.get("url").and_then(Value::as_str))).unwrap_or("");
                            let n = t.files.len() + 1;
                            let recovered = if url.starts_with("data:") {
                                hopilo_core::CapturedFile::from_base64(format!("image-{n}"), "", url)
                            } else {
                                crate::text::read_local_file(url)
                            };
                            match recovered {
                                Some(f) => {
                                    blocks.push(f.block());
                                    t.files.push(f);
                                }
                                None => {
                                    t.images += 1;
                                    blocks.push(Block::Missing { description: "image shared in the conversation".into() });
                                }
                            }
                        }
                        _ => {}
                    }
                }
                if blocks.is_empty() {
                    continue;
                }
                if role == Role::User && first_prompt.is_none() {
                    first_prompt = blocks.iter().find_map(|b| match b {
                        Block::Text { text } => Some(title_from(text)).filter(|s| !s.is_empty()),
                        _ => None,
                    });
                }
                push(&mut messages, role, blocks);
            }
            kind @ ("function_call" | "custom_tool_call" | "local_shell_call") => {
                let name = item.get("name").and_then(Value::as_str).unwrap_or("shell").to_string();
                if let Some(cid) = item.get("call_id").and_then(Value::as_str) {
                    names.insert(cid.to_string(), name.clone());
                }
                let input = match kind {
                    "function_call" => pretty_args(item.get("arguments").and_then(Value::as_str).unwrap_or("")),
                    "custom_tool_call" => item.get("input").and_then(Value::as_str).unwrap_or("").to_string(),
                    _ => item.get("action").map(|a| serde_json::to_string_pretty(a).unwrap_or_default()).unwrap_or_default(),
                };
                push(&mut messages, Role::Assistant, vec![Block::ToolCall { name, input }]);
            }
            "function_call_output" | "custom_tool_call_output" | "local_shell_call_output" => {
                let name = item.get("call_id").and_then(Value::as_str).and_then(|c| names.get(c).cloned());
                let output = output_text(item.get("output"));
                push(&mut messages, Role::Tool, vec![Block::ToolResult { name, output, is_error: false }]);
            }
            "reasoning" => t.reasoning += 1,
            "compaction" => t.compactions += 1,
            _ => {}
        }
    }

    if !saw_any {
        return Err(AdapterError::Unrecognized(path.display().to_string()));
    }

    let mut missing = Vec::new();
    if t.compactions > 0 {
        missing.push(format!(
            "{} compaction(s): earlier history is stored encrypted or summarized by Codex and could not be recovered",
            t.compactions
        ));
    }
    if t.unreadable > 0 {
        missing.push(format!("{} unreadable line(s) in the session file", t.unreadable));
    }
    if t.images > 0 {
        missing.push(format!("{} image(s) referenced but not recovered", t.images));
    }
    let mut om: Vec<OmittedCount> = Vec::new();
    omitted(&mut om, "hidden reasoning items", t.reasoning);
    omitted(&mut om, "injected developer/environment context", t.injected);

    let sid = session_id_from(path);
    Ok(Capture {
        source: Source {
            source_id,
            kind: SourceKind::LocalAgent,
            provider: "codex".into(),
            title: first_prompt.unwrap_or_else(|| format!("Codex session {sid}")),
            origin: Some(path.display().to_string()),
            project,
            model,
            captured_at: now_rfc3339(),
            capture_status: if missing.is_empty() { CaptureStatus::Complete } else { CaptureStatus::Partial },
            missing_items: missing,
            omitted: om,
        },
        messages,
        files: t.files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/codex/rollout-2026-11-01T09-00-00-sample.jsonl")
    }

    #[test]
    fn reads_fixture() {
        let cap = Codex.read(&fixture()).unwrap();
        assert_eq!(cap.source.title, "Add pagination to GET /v1/orders");
        assert_eq!(cap.source.project.as_deref(), Some("/work/api"));
        assert_eq!(cap.source.model.as_deref(), Some("gpt-5.5-codex"));
        let roles: Vec<Role> = cap.messages.iter().map(|m| m.role).collect();
        assert_eq!(
            roles,
            vec![Role::User, Role::Assistant, Role::Tool, Role::Assistant, Role::Tool, Role::Assistant]
        );
        match &cap.messages[2].blocks[0] {
            Block::ToolResult { name, output, .. } => {
                assert_eq!(name.as_deref(), Some("shell"));
                assert_eq!(output, "src/routes/orders.rs:12: pub async fn list_orders");
            }
            b => panic!("unexpected {b:?}"),
        }
        assert_eq!(cap.source.capture_status, CaptureStatus::Complete);
        assert!(cap.source.omitted.iter().any(|o| o.what == "injected developer/environment context" && o.count == 2));
    }

    #[test]
    fn discovers_rollouts() {
        let root = fixture().parent().unwrap().to_path_buf();
        let found = Codex.discover(&root).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].message_count, 4);
    }
}
