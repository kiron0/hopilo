use std::path::{Path, PathBuf};

use hopilo_core::{
    new_id, now_rfc3339, Block, CaptureStatus, Message, Role, Source, SourceKind,
};
use serde_json::Value;

use crate::text::title_from;
use crate::{
    file_meta, home, open_lines, AdapterError, Capture, DiscoveredSession,
    LocalAgentAdapter, Result,
};

pub struct Antigravity;

impl LocalAgentAdapter for Antigravity {
    fn id(&self) -> &'static str {
        "antigravity"
    }

    fn display_name(&self) -> &'static str {
        "Antigravity"
    }

    fn default_roots(&self) -> Vec<PathBuf> {
        let mut roots = Vec::new();
        if let Some(dir) = std::env::var_os("ANTIGRAVITY_DATA_DIR") {
            roots.push(PathBuf::from(dir.clone()).join("brain"));
            roots.push(PathBuf::from(dir));
        }
        if let Some(dir) = std::env::var_os("ANTIGRAVITY_HOME") {
            roots.push(PathBuf::from(dir).join("brain"));
        }
        if let Some(h) = home() {
            roots.push(h.join(".gemini").join("antigravity").join("brain"));
            roots.push(h.join(".antigravity").join("brain"));
        }
        if let Some(appdata) = std::env::var_os("APPDATA") {
            roots.push(PathBuf::from(appdata).join("antigravity").join("brain"));
        }
        roots
    }

    fn discover(&self, root: &Path) -> Result<Vec<DiscoveredSession>> {
        let target = if root.join("brain").is_dir() {
            root.join("brain")
        } else {
            root.to_path_buf()
        };

        if target.is_file() {
            if let Some(s) = quick_scan(&target, target.parent().unwrap_or(&target)) {
                return Ok(vec![s]);
            }
            return Ok(vec![]);
        }

        let Ok(rd) = std::fs::read_dir(&target) else {
            return Ok(vec![]);
        };

        let mut out = Vec::new();
        for entry in rd.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let candidate1 = path.join(".system_generated").join("logs").join("transcript.jsonl");
            let candidate2 = path.join("transcript.jsonl");
            let candidate3 = path.join(".system_generated").join("logs").join("transcript_full.jsonl");

            let transcript = if candidate1.is_file() {
                Some(candidate1)
            } else if candidate2.is_file() {
                Some(candidate2)
            } else if candidate3.is_file() {
                Some(candidate3)
            } else {
                None
            };

            if let Some(t) = transcript {
                if let Some(s) = quick_scan(&t, &path) {
                    out.push(s);
                }
            }
        }

        out.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
        Ok(out)
    }

    fn read(&self, path: &Path) -> Result<Capture> {
        read_session(path)
    }
}

fn extract_user_request(s: &str) -> String {
    if let Some(start) = s.find("<USER_REQUEST>") {
        let after = &s[start + "<USER_REQUEST>".len()..];
        if let Some(end) = after.find("</USER_REQUEST>") {
            return after[..end].trim().to_string();
        }
        return after.trim().to_string();
    }
    let mut clean = s;
    if let Some(idx) = clean.find("<ADDITIONAL_METADATA>") {
        clean = &clean[..idx];
    }
    if let Some(idx) = clean.find("<USER_SETTINGS_CHANGE>") {
        clean = &clean[..idx];
    }
    clean.trim().to_string()
}

fn extract_project(s: &str) -> Option<String> {
    if let Some(pos) = s.find("Active Workspaces:") {
        let after = &s[pos + "Active Workspaces:".len()..];
        for line in after.lines() {
            let t = line.trim();
            if let Some(p) = t.strip_prefix("- ") {
                let p = p.trim();
                if !p.is_empty() {
                    return Some(p.to_string());
                }
            }
        }
    }
    if let Some(pos) = s.find("Active Document:") {
        let after = &s[pos + "Active Document:".len()..];
        if let Some(line) = after.lines().next() {
            let path_str = line.split('(').next().unwrap_or(line).trim();
            if let Some(parent) = Path::new(path_str).parent() {
                return Some(parent.display().to_string());
            }
        }
    }
    None
}

fn quick_scan(transcript: &Path, session_dir: &Path) -> Option<DiscoveredSession> {
    let (size_bytes, modified_at) = file_meta(transcript).ok()?;
    let mut title = None;
    let mut project = None;
    let mut model = None;
    let mut count = 0;
    for line in open_lines(transcript).ok()?.map_while(|l| l.ok()) {
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        let kind = v.get("type").and_then(Value::as_str).unwrap_or("");
        match kind {
            "USER_INPUT" => {
                count += 1;
                let content = v.get("content").and_then(Value::as_str).unwrap_or("");
                if title.is_none() {
                    let prompt = extract_user_request(content);
                    if !prompt.is_empty() {
                        title = Some(title_from(&prompt));
                    }
                }
                if project.is_none() {
                    project = extract_project(content);
                }
            }
            "PLANNER_RESPONSE" => {
                count += 1;
                if model.is_none() {
                    model = Some("Gemini".to_string());
                }
            }
            _ => {}
        }
    }
    if count == 0 {
        return None;
    }
    let session_id = session_dir
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| transcript.file_stem().unwrap().to_string_lossy().to_string());
    Some(DiscoveredSession {
        adapter: "antigravity".into(),
        path: transcript.display().to_string(),
        session_id: session_id.clone(),
        title: title.unwrap_or_else(|| format!("Session {}", &session_id[..8.min(session_id.len())])),
        project,
        model,
        modified_at,
        size_bytes,
        message_count: count,
    })
}

fn resolve_transcript(path: &Path) -> Result<PathBuf> {
    if path.is_file() {
        return Ok(path.to_path_buf());
    }
    let p1 = path.join(".system_generated").join("logs").join("transcript.jsonl");
    if p1.is_file() {
        return Ok(p1);
    }
    let p2 = path.join("transcript.jsonl");
    if p2.is_file() {
        return Ok(p2);
    }
    let p3 = path.join(".system_generated").join("logs").join("transcript_full.jsonl");
    if p3.is_file() {
        return Ok(p3);
    }
    Err(AdapterError::Unrecognized(path.display().to_string()))
}

fn read_session(path: &Path) -> Result<Capture> {
    let transcript = resolve_transcript(path)?;
    let source_id = new_id();
    let mut messages = Vec::new();
    let mut project = None;
    let mut first_prompt = None;
    let mut model = None;

    for line in open_lines(&transcript)?.map_while(|l| l.ok()) {
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        let kind = v.get("type").and_then(Value::as_str).unwrap_or("");
        let created_at = v.get("created_at").and_then(Value::as_str).map(str::to_string);
        let step_idx = v.get("step_index").and_then(Value::as_u64);
        let id = step_idx.map(|idx| format!("step-{}", idx)).unwrap_or_else(new_id);

        match kind {
            "USER_INPUT" => {
                let raw = v.get("content").and_then(Value::as_str).unwrap_or("");
                let clean = extract_user_request(raw);
                if clean.is_empty() {
                    continue;
                }
                if first_prompt.is_none() {
                    first_prompt = Some(title_from(&clean));
                }
                if project.is_none() {
                    project = extract_project(raw);
                }
                messages.push(Message {
                    id,
                    source_id: source_id.clone(),
                    role: Role::User,
                    created_at,
                    blocks: vec![Block::text(clean)],
                });
            }
            "PLANNER_RESPONSE" => {
                if model.is_none() {
                    model = Some("Gemini".to_string());
                }
                let mut blocks = Vec::new();
                if let Some(text) = v.get("content").and_then(Value::as_str).filter(|s| !s.trim().is_empty()) {
                    blocks.push(Block::text(text.trim()));
                }
                if let Some(tools) = v.get("tool_calls").and_then(Value::as_array) {
                    for tc in tools {
                        let name = tc.get("name").and_then(Value::as_str).unwrap_or("tool").to_string();
                        let input = tc
                            .get("args")
                            .map(|a| serde_json::to_string_pretty(a).unwrap_or_default())
                            .unwrap_or_default();
                        blocks.push(Block::ToolCall { name, input });
                    }
                }
                if !blocks.is_empty() {
                    messages.push(Message {
                        id,
                        source_id: source_id.clone(),
                        role: Role::Assistant,
                        created_at,
                        blocks,
                    });
                }
            }
            "GENERIC" => {
                let status = v.get("status").and_then(Value::as_str).unwrap_or("");
                let is_error = status == "ERROR";
                let text = v.get("content").and_then(Value::as_str).unwrap_or("");
                if !text.trim().is_empty() {
                    messages.push(Message {
                        id,
                        source_id: source_id.clone(),
                        role: Role::Tool,
                        created_at,
                        blocks: vec![Block::ToolResult {
                            name: None,
                            output: text.to_string(),
                            is_error,
                        }],
                    });
                }
            }
            _ => {}
        }
    }

    if messages.is_empty() {
        return Err(AdapterError::Unrecognized(transcript.display().to_string()));
    }

    let session_dir = if transcript.is_file() && transcript.file_name().is_some_and(|n| n == "transcript.jsonl" || n == "transcript_full.jsonl") {
        transcript.parent().and_then(Path::parent).and_then(Path::parent).unwrap_or(&transcript)
    } else {
        path
    };
    let session_id = session_dir.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(new_id);
    let title = first_prompt.unwrap_or_else(|| format!("Session {}", &session_id[..8.min(session_id.len())]));

    let source = Source {
        source_id: source_id.clone(),
        kind: SourceKind::LocalAgent,
        provider: "antigravity".into(),
        title,
        origin: None,
        project,
        model: model.or_else(|| Some("Gemini".into())),
        captured_at: now_rfc3339(),
        capture_status: CaptureStatus::Complete,
        missing_items: vec![],
        omitted: vec![],
    };

    Ok(Capture {
        source,
        messages,
        files: vec![],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovers_and_reads_antigravity_session() {
        let dir = tempfile::tempdir().unwrap();
        let session_dir = dir.path().join("sess-1234");
        let logs_dir = session_dir.join(".system_generated").join("logs");
        std::fs::create_dir_all(&logs_dir).unwrap();

        let transcript_content = r#"{"step_index":0,"source":"USER_EXPLICIT","type":"USER_INPUT","status":"DONE","created_at":"2026-11-04T10:00:00Z","content":"<USER_REQUEST>\nBuild an awesome Rust app\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nActive Workspaces:\n- /workspace/hopilo\n</ADDITIONAL_METADATA>"}
{"step_index":1,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","created_at":"2026-11-04T10:00:02Z","content":"I will help you build it.","tool_calls":[{"name":"read_file","args":{"Path":"Cargo.toml"}}]}
{"step_index":2,"source":"MODEL","type":"GENERIC","status":"DONE","created_at":"2026-11-04T10:00:03Z","content":"[package]\nname = \"hopilo\""}
"#;
        std::fs::write(logs_dir.join("transcript.jsonl"), transcript_content).unwrap();

        let adapter = Antigravity;
        let sessions = adapter.discover(dir.path()).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].adapter, "antigravity");
        assert_eq!(sessions[0].session_id, "sess-1234");
        assert_eq!(sessions[0].title, "Build an awesome Rust app");
        assert_eq!(sessions[0].project, Some("/workspace/hopilo".into()));

        let cap = adapter.read(Path::new(&sessions[0].path)).unwrap();
        assert_eq!(cap.source.provider, "antigravity");
        assert_eq!(cap.messages.len(), 3);
        assert_eq!(cap.messages[0].role, Role::User);
        assert_eq!(cap.messages[1].role, Role::Assistant);
        assert_eq!(cap.messages[2].role, Role::Tool);
    }
}

