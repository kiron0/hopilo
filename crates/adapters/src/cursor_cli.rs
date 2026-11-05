
use std::path::{Path, PathBuf};

use hopilo_core::{new_id, now_rfc3339, Block, CaptureStatus, Message, OmittedCount, Role, Source, SourceKind};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;

use crate::text::title_from;
use crate::{file_meta, home, memo_scan, omitted, AdapterError, Capture, DiscoveredSession, LocalAgentAdapter, Result};

pub struct CursorCli;

impl LocalAgentAdapter for CursorCli {
    fn id(&self) -> &'static str {
        "cursor-cli"
    }

    fn display_name(&self) -> &'static str {
        "Cursor CLI"
    }

    fn default_roots(&self) -> Vec<PathBuf> {
        let base = std::env::var_os("CURSOR_CONFIG_DIR").map(PathBuf::from).or_else(|| home().map(|h| h.join(".cursor")));
        base.map(|b| vec![b.join("chats")]).unwrap_or_default()
    }

    fn scan_depth(&self) -> usize {
        2
    }

    fn discover(&self, root: &Path) -> Result<Vec<DiscoveredSession>> {
        let mut out = Vec::new();
        let Ok(hashes) = std::fs::read_dir(root) else { return Ok(out) };
        for h in hashes.flatten() {
            let Ok(chats) = std::fs::read_dir(h.path()) else { continue };
            for c in chats.flatten() {
                let db = c.path().join("store.db");
                if db.is_file() {
                    out.extend(memo_scan(&db, quick_scan));
                }
            }
        }
        Ok(out)
    }

    fn read(&self, path: &Path) -> Result<Capture> {
        read_store(path)
    }
}

fn quick_scan(db: &Path) -> Option<DiscoveredSession> {
    let cap = read_store(db).ok()?;
    let count = cap.messages.iter().filter(|m| m.role != Role::Tool).count();
    if count == 0 {
        return None;
    }
    let (size_bytes, modified_at) = file_meta(db).ok()?;
    Some(DiscoveredSession {
        adapter: "cursor-cli".into(),
        path: db.display().to_string(),
        session_id: db.parent()?.file_name()?.to_string_lossy().to_string(),
        title: cap.source.title,
        project: cap.source.project,
        model: cap.source.model,
        modified_at,
        size_bytes,
        message_count: count,
    })
}

fn sql(db: &Path) -> impl Fn(rusqlite::Error) -> AdapterError + '_ {
    move |e| AdapterError::Io { path: db.display().to_string(), source: std::io::Error::other(e) }
}

fn bytes(r: &rusqlite::Row, i: usize) -> rusqlite::Result<Vec<u8>> {
    Ok(match r.get_ref(i)? {
        rusqlite::types::ValueRef::Text(b) | rusqlite::types::ValueRef::Blob(b) => b.to_vec(),
        _ => Vec::new(),
    })
}

fn decode_meta(raw: &[u8]) -> Option<Value> {
    if let Ok(v) = serde_json::from_slice(raw) {
        return Some(v);
    }
    let s = std::str::from_utf8(raw).ok()?.trim();
    serde_json::from_slice(&hex::decode(s).ok()?).ok()
}

fn unwrap_query(text: &str) -> &str {
    match (text.find("<user_query>"), text.find("</user_query>")) {
        (Some(a), Some(b)) if b > a => text[a + "<user_query>".len()..b].trim(),
        _ => text.trim(),
    }
}

#[derive(Default)]
struct Tally {
    thinking: usize,
    system: usize,
    injected: usize,
}

fn blocks_for(role: Role, content: &Value, t: &mut Tally) -> Vec<Block> {
    let mut blocks = Vec::new();
    let mut text = |s: &str, blocks: &mut Vec<Block>| {
        let s = if role == Role::User {
            if s.contains("<user_info>") && !s.contains("<user_query>") {
                t.injected += 1;
                return;
            }
            unwrap_query(s)
        } else {
            s.trim()
        };
        if !s.is_empty() {
            blocks.push(Block::text(s.to_string()));
        }
    };
    match content {
        Value::String(s) => text(s, &mut blocks),
        Value::Array(parts) => {
            for p in parts {
                match p.get("type").and_then(Value::as_str).unwrap_or("") {
                    "text" => text(p.get("text").and_then(Value::as_str).unwrap_or(""), &mut blocks),
                    "tool-call" | "tool_call" | "tool_use" => blocks.push(Block::ToolCall {
                        name: p.get("toolName").or_else(|| p.get("name")).and_then(Value::as_str).unwrap_or("tool").to_string(),
                        input: p.get("args").or_else(|| p.get("input")).map(|a| serde_json::to_string_pretty(a).unwrap_or_default()).unwrap_or_default(),
                    }),
                    "tool-result" | "tool_result" => {
                        let r = p.get("result").or_else(|| p.get("content")).cloned().unwrap_or(Value::Null);
                        blocks.push(Block::ToolResult {
                            name: p.get("toolName").and_then(Value::as_str).map(str::to_string),
                            output: match r {
                                Value::String(s) => s,
                                Value::Null => String::new(),
                                other => other.to_string(),
                            },
                            is_error: p.get("isError").and_then(Value::as_bool).unwrap_or(false),
                        });
                    }
                    "reasoning" | "redacted-reasoning" | "thinking" => t.thinking += 1,
                    _ => {}
                }
            }
        }
        _ => {}
    }
    blocks
}

fn read_store(db: &Path) -> Result<Capture> {
    let conn = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(sql(db))?;
    let meta = conn
        .query_row("SELECT value FROM meta WHERE key = '0' OR key = 'meta' LIMIT 1", [], |r| bytes(r, 0))
        .ok()
        .and_then(|raw| decode_meta(&raw))
        .unwrap_or(Value::Null);

    let mut stmt = conn.prepare("SELECT data FROM blobs ORDER BY rowid").map_err(sql(db))?;
    let rows = stmt.query_map([], |r| bytes(r, 0)).map_err(sql(db))?;
    let source_id = new_id();
    let mut messages = Vec::new();
    let mut t = Tally::default();
    let mut first_prompt = None;
    let mut seen = std::collections::HashSet::new();
    for data in rows.flatten() {
        if data.first() != Some(&b'{') {
            continue;
        }
        let Ok(v) = serde_json::from_slice::<Value>(&data) else { continue };
        let Some(role_s) = v.get("role").and_then(Value::as_str) else { continue };
        let role = match role_s {
            "user" => Role::User,
            "assistant" => Role::Assistant,
            "tool" => Role::Tool,
            _ => {
                t.system += 1;
                continue;
            }
        };
        let blocks = blocks_for(role, v.get("content").unwrap_or(&Value::Null), &mut t);
        if blocks.is_empty() {
            continue;
        }
        if let Some(id) = v.get("id").and_then(Value::as_str) {
            if !seen.insert(id.to_string()) {
                continue;
            }
        }
        if role == Role::User && first_prompt.is_none() {
            first_prompt = blocks.iter().find_map(|b| match b {
                Block::Text { text } => Some(title_from(text)),
                _ => None,
            });
        }
        messages.push(Message { id: new_id(), source_id: source_id.clone(), role, created_at: None, blocks });
    }

    let mut om: Vec<OmittedCount> = Vec::new();
    omitted(&mut om, "hidden reasoning blocks", t.thinking);
    omitted(&mut om, "system prompts", t.system);
    omitted(&mut om, "injected workspace context", t.injected);
    let chat_id = db.parent().and_then(Path::file_name).map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let source = Source {
        source_id,
        kind: SourceKind::LocalAgent,
        provider: "cursor-cli".into(),
        title: meta
            .get("name")
            .and_then(Value::as_str)
            .filter(|n| !n.trim().is_empty() && *n != "New Agent")
            .map(title_from)
            .or(first_prompt)
            .unwrap_or_else(|| format!("Cursor CLI chat {}", chat_id.chars().take(8).collect::<String>())),
        origin: Some(db.display().to_string()),
        project: None,
        model: meta.get("lastUsedModel").and_then(Value::as_str).map(str::to_string),
        captured_at: now_rfc3339(),
        capture_status: CaptureStatus::Complete,
        missing_items: vec![],
        omitted: om,
    };
    Ok(Capture { source, messages, files: vec![] })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_json_blobs_in_order() {
        let dir = tempfile::tempdir().unwrap();
        let chat = dir.path().join("hash").join("chat-1");
        std::fs::create_dir_all(&chat).unwrap();
        let db = chat.join("store.db");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB);").unwrap();
        let meta = hex::encode(r#"{"name":"Fix CI","lastUsedModel":"gpt-5"}"#);
        conn.execute("INSERT INTO meta VALUES ('0', ?1)", [meta]).unwrap();
        let blobs: [&[u8]; 5] = [
            br#"{"role":"system","content":"You are..."}"#,
            br#"{"role":"user","content":[{"type":"text","text":"<user_info>os</user_info>"}]}"#,
            br#"{"role":"user","content":[{"type":"text","text":"<user_query>why does CI fail</user_query>"}]}"#,
            b"\x0a\x20binary-node",
            br#"{"role":"assistant","content":[{"type":"text","text":"Missing env var."},{"type":"tool-call","toolName":"shell","args":{"cmd":"env"}}]}"#,
        ];
        for (i, b) in blobs.iter().enumerate() {
            conn.execute("INSERT INTO blobs VALUES (?1, ?2)", rusqlite::params![format!("b{i}"), b.to_vec()]).unwrap();
        }
        drop(conn);

        let found = CursorCli.discover(dir.path()).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].session_id, "chat-1");
        assert_eq!(found[0].title, "Fix CI");
        assert_eq!(found[0].model.as_deref(), Some("gpt-5"));
        let cap = CursorCli.read(&db).unwrap();
        assert_eq!(cap.messages.len(), 2);
        assert_eq!(cap.messages[0].blocks[0].plain_text(), "why does CI fail");
        assert!(matches!(&cap.messages[1].blocks[1], Block::ToolCall { name, .. } if name == "shell"));
    }
}
