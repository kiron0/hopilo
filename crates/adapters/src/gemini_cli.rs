//! Gemini CLI sessions: `~/.gemini/tmp/<project>/chats/session-*.jsonl` (or
//! `$GEMINI_CLI_HOME`). The first line is a header; later lines are messages
//! keyed by `id` (a repeated id replaces the earlier one) or `{"$set": …}`
//! patches, where `$set.messages` is a full snapshot of the message list.
//! Older versions wrote one `session-*.json` object with a `messages` array.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use hopilo_core::{new_id, now_rfc3339, Block, CaptureStatus, Message, OmittedCount, Role, Source, SourceKind};
use serde_json::Value;

use crate::text::title_from;
use crate::{file_meta, home, jsonl_files, omitted, open_lines, AdapterError, Capture, DiscoveredSession, LocalAgentAdapter, Result};

/// Gemini CLI and its fork Qwen Code share this session format; only the
/// folder and the label differ.
pub struct GeminiCli {
    id: &'static str,
    name: &'static str,
    env: &'static str,
    dir: &'static str,
}

pub const GEMINI_CLI: GeminiCli = GeminiCli { id: "gemini-cli", name: "Gemini CLI", env: "GEMINI_CLI_HOME", dir: ".gemini" };
pub const QWEN_CODE: GeminiCli = GeminiCli { id: "qwen-code", name: "Qwen Code", env: "QWEN_CODE_HOME", dir: ".qwen" };

impl GeminiCli {
    fn base_dir(&self) -> Option<PathBuf> {
        std::env::var_os(self.env).map(PathBuf::from).or_else(|| home().map(|h| h.join(self.dir)))
    }
}

/// `projects.json` maps project paths to the folder names used under `tmp/`.
fn project_paths(base: &Path) -> HashMap<String, String> {
    let Ok(text) = std::fs::read_to_string(base.join("projects.json")) else { return HashMap::new() };
    let Ok(v) = serde_json::from_str::<Value>(&text) else { return HashMap::new() };
    v.get("projects")
        .and_then(Value::as_object)
        .map(|m| m.iter().filter_map(|(path, slug)| Some((slug.as_str()?.to_string(), path.clone()))).collect())
        .unwrap_or_default()
}

impl LocalAgentAdapter for GeminiCli {
    fn id(&self) -> &'static str {
        self.id
    }

    fn display_name(&self) -> &'static str {
        self.name
    }

    fn default_roots(&self) -> Vec<PathBuf> {
        self.base_dir().map(|b| vec![b.join("tmp")]).unwrap_or_default()
    }

    fn discover(&self, root: &Path) -> Result<Vec<DiscoveredSession>> {
        let mut files = Vec::new();
        jsonl_files(root, 2, &mut files);
        json_session_files(root, &mut files);
        files.retain(|p| {
            p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("session-"))
                && p.parent().and_then(Path::file_name).is_some_and(|d| d == "chats")
        });
        let mut out = Vec::new();
        for path in files {
            let Ok(cap) = read_session(&path, self) else { continue };
            let count = cap.messages.iter().filter(|m| m.role != Role::Tool).count();
            if count == 0 {
                continue;
            }
            let Ok((size_bytes, modified_at)) = file_meta(&path) else { continue };
            out.push(DiscoveredSession {
                adapter: self.id.into(),
                session_id: path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(),
                path: path.display().to_string(),
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
        read_session(path, self)
    }
}

/// Legacy `chats/session-*.json` files.
fn json_session_files(root: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(root) else { return };
    for e in rd.flatten() {
        let chats = e.path().join("chats");
        let Ok(inner) = std::fs::read_dir(&chats) else { continue };
        for f in inner.flatten() {
            let p = f.path();
            let is_file = f.file_type().map(|t| t.is_file()).unwrap_or(false);
            if is_file && p.extension().is_some_and(|x| x == "json") {
                out.push(p);
            }
        }
    }
}

fn parts_text(content: &Value, tally: &mut usize) -> (Vec<Block>, bool) {
    // Returns blocks and whether the message was only function responses.
    match content {
        Value::String(s) if !s.trim().is_empty() => (vec![Block::text(s.trim_end())], false),
        Value::Array(parts) => {
            let mut blocks = Vec::new();
            let mut only_responses = !parts.is_empty();
            for p in parts {
                if let Some(t) = p.get("text").and_then(Value::as_str) {
                    only_responses = false;
                    if !t.trim().is_empty() {
                        blocks.push(Block::text(t.trim_end()));
                    }
                } else if let Some(fc) = p.get("functionCall") {
                    only_responses = false;
                    blocks.push(Block::ToolCall {
                        name: fc.get("name").and_then(Value::as_str).unwrap_or("tool").to_string(),
                        input: fc.get("args").map(|a| serde_json::to_string_pretty(a).unwrap_or_default()).unwrap_or_default(),
                    });
                } else if let Some(fr) = p.get("functionResponse") {
                    blocks.push(Block::ToolResult {
                        name: fr.get("name").and_then(Value::as_str).map(str::to_string),
                        output: response_text(fr.get("response")),
                        is_error: false,
                    });
                } else if p.get("inlineData").is_some() || p.get("fileData").is_some() {
                    only_responses = false;
                    *tally += 1;
                    blocks.push(Block::Missing { description: "file shared in the conversation".into() });
                }
            }
            (blocks, only_responses)
        }
        _ => (vec![], false),
    }
}

fn response_text(v: Option<&Value>) -> String {
    match v {
        Some(Value::Object(o)) => o
            .get("output")
            .and_then(Value::as_str)
            .or_else(|| o.get("error").and_then(Value::as_str))
            .map(str::to_string)
            .unwrap_or_else(|| Value::Object(o.clone()).to_string()),
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
        None => String::new(),
    }
}

fn read_session(path: &Path, fmt: &GeminiCli) -> Result<Capture> {
    let mut header: Option<Value> = None;
    let mut records: Vec<Value> = Vec::new();
    let mut unreadable = 0;

    if path.extension().is_some_and(|e| e == "json") {
        let text = std::fs::read_to_string(path).map_err(|source| AdapterError::Io { path: path.display().to_string(), source })?;
        let v: Value = serde_json::from_str(&text).map_err(|_| AdapterError::Unrecognized(path.display().to_string()))?;
        records = v.get("messages").and_then(Value::as_array).cloned().unwrap_or_default();
        header = Some(v);
    } else {
        let mut index: HashMap<String, usize> = HashMap::new();
        for line in open_lines(path)? {
            let line = line.map_err(|source| AdapterError::Io { path: path.display().to_string(), source })?;
            if line.trim().is_empty() {
                continue;
            }
            let Ok(v) = serde_json::from_str::<Value>(&line) else {
                unreadable += 1;
                continue;
            };
            if let Some(set) = v.get("$set") {
                if let Some(all) = set.get("messages").and_then(Value::as_array) {
                    records = all.clone();
                    index = records.iter().enumerate().filter_map(|(i, r)| Some((r.get("id")?.as_str()?.to_string(), i))).collect();
                }
                continue;
            }
            if header.is_none() && v.get("sessionId").is_some() && v.get("type").is_none() {
                header = Some(v);
                continue;
            }
            if v.get("type").is_none() {
                continue;
            }
            match v.get("id").and_then(Value::as_str).and_then(|id| index.get(id).copied()) {
                Some(i) => records[i] = v,
                None => {
                    if let Some(id) = v.get("id").and_then(Value::as_str) {
                        index.insert(id.to_string(), records.len());
                    }
                    records.push(v);
                }
            }
        }
    }
    let Some(header) = header else { return Err(AdapterError::Unrecognized(path.display().to_string())) };

    let source_id = new_id();
    let mut messages = Vec::new();
    let mut thoughts = 0;
    let mut info = 0;
    let mut files = 0;
    let mut model = None;
    let mut first_prompt = None;
    for r in &records {
        let kind = r.get("type").and_then(Value::as_str).unwrap_or("");
        let created_at = r.get("timestamp").and_then(Value::as_str).map(str::to_string);
        let id = r.get("id").and_then(Value::as_str).map(str::to_string).unwrap_or_else(new_id);
        let content = r.get("content").cloned().unwrap_or(Value::Null);
        match kind {
            "user" => {
                let (blocks, only_responses) = parts_text(&content, &mut files);
                if blocks.is_empty() {
                    continue;
                }
                if only_responses {
                    messages.push(Message { id, source_id: source_id.clone(), role: Role::Tool, created_at, blocks });
                    continue;
                }
                if first_prompt.is_none() {
                    first_prompt = blocks.iter().find_map(|b| match b {
                        Block::Text { text } => Some(title_from(text)).filter(|t| !t.is_empty()),
                        _ => None,
                    });
                }
                messages.push(Message { id, source_id: source_id.clone(), role: Role::User, created_at, blocks });
            }
            "gemini" | "model" | "assistant" => {
                thoughts += r.get("thoughts").and_then(Value::as_array).map(Vec::len).unwrap_or(0);
                if model.is_none() {
                    model = r.get("model").and_then(Value::as_str).map(str::to_string);
                }
                let (mut blocks, _) = parts_text(&content, &mut files);
                let mut results = Vec::new();
                for call in r.get("toolCalls").and_then(Value::as_array).into_iter().flatten() {
                    let name = call.get("name").and_then(Value::as_str).unwrap_or("tool").to_string();
                    blocks.push(Block::ToolCall {
                        name: name.clone(),
                        input: call.get("args").map(|a| serde_json::to_string_pretty(a).unwrap_or_default()).unwrap_or_default(),
                    });
                    if let Some(res) = call.get("result") {
                        let output = match res {
                            Value::Array(items) => items
                                .iter()
                                .map(|i| response_text(i.get("functionResponse").and_then(|f| f.get("response"))))
                                .collect::<Vec<_>>()
                                .join("\n"),
                            other => response_text(Some(other)),
                        };
                        let is_error = call.get("status").and_then(Value::as_str) == Some("error");
                        results.push(Block::ToolResult { name: Some(name), output, is_error });
                    }
                }
                if !blocks.is_empty() {
                    messages.push(Message { id: id.clone(), source_id: source_id.clone(), role: Role::Assistant, created_at: created_at.clone(), blocks });
                }
                if !results.is_empty() {
                    messages.push(Message { id: format!("{id}-results"), source_id: source_id.clone(), role: Role::Tool, created_at, blocks: results });
                }
            }
            _ => info += 1,
        }
    }

    let slug = path.parent().and_then(Path::parent).and_then(Path::file_name).map(|s| s.to_string_lossy().to_string());
    let project = slug.and_then(|s| {
        let base = path.parent()?.parent()?.parent()?.parent()?;
        project_paths(base).get(&s).cloned()
    });

    let mut missing = Vec::new();
    if unreadable > 0 {
        missing.push(format!("{unreadable} unreadable line(s) in the session file"));
    }
    if files > 0 {
        missing.push(format!("{files} file(s) referenced but not recovered"));
    }
    let mut om: Vec<OmittedCount> = Vec::new();
    omitted(&mut om, "hidden reasoning (thoughts)", thoughts);
    omitted(&mut om, "CLI info/status messages", info);

    let sid = header.get("sessionId").and_then(Value::as_str).unwrap_or("").to_string();
    Ok(Capture {
        source: Source {
            source_id,
            kind: SourceKind::LocalAgent,
            provider: fmt.id.into(),
            title: first_prompt.unwrap_or_else(|| format!("{} session {}", fmt.name, &sid[..sid.len().min(8)])),
            origin: Some(path.display().to_string()),
            project,
            model,
            captured_at: now_rfc3339(),
            capture_status: if missing.is_empty() { CaptureStatus::Complete } else { CaptureStatus::Partial },
            missing_items: missing,
            omitted: om,
        },
        messages,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/gemini-cli/tmp/demo/chats/session-2026-11-01T10-00-sample.jsonl")
    }

    #[test]
    fn reads_jsonl_with_set_snapshots() {
        let cap = GEMINI_CLI.read(&fixture()).unwrap();
        assert_eq!(cap.source.title, "Why does the build fail on CI?");
        assert_eq!(cap.source.project.as_deref(), Some("/work/demo"));
        assert_eq!(cap.source.model.as_deref(), Some("gemini-3-pro"));
        let roles: Vec<Role> = cap.messages.iter().map(|m| m.role).collect();
        assert_eq!(roles, vec![Role::User, Role::Assistant, Role::Tool, Role::Assistant]);
        match &cap.messages[2].blocks[0] {
            Block::ToolResult { name, output, .. } => {
                assert_eq!(name.as_deref(), Some("run_shell_command"));
                assert!(output.contains("error: lockfile out of date"));
            }
            b => panic!("unexpected {b:?}"),
        }
        // The edited reply (same id written twice) keeps only the last text.
        assert_eq!(cap.messages[3].blocks[0].plain_text(), "Run `pnpm install` and commit `pnpm-lock.yaml`.");
        assert!(cap.source.omitted.iter().any(|o| o.what.starts_with("hidden reasoning") && o.count == 1));
    }

    #[test]
    fn discovers_fixture() {
        let root = fixture().parent().unwrap().parent().unwrap().parent().unwrap().to_path_buf();
        let found = GEMINI_CLI.discover(&root).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].message_count, 3);
    }
}
