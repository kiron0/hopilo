use std::path::{Path, PathBuf};

use hopilo_core::{new_id, Block, CaptureStatus, Message, Role, Source, SourceKind};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;

use crate::text::title_from;
use crate::{home, AdapterError, Capture, DiscoveredSession, LocalAgentAdapter, Result};

pub struct Zed;

const DB_NAME: &str = "threads.db";

fn decode_record(data: &[u8], kind: &str) -> std::io::Result<Vec<u8>> {
    let reader: Box<dyn std::io::Read + '_> =
        if kind == "zstd" { Box::new(zstd::stream::read::Decoder::new(data)?) } else { Box::new(data) };
    hopilo_core::limits::read_bounded(reader, hopilo_core::limits::DOCUMENT_BYTES)
}

fn open_ro(db: &Path) -> Result<Connection> {
    Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|e| AdapterError::Io { path: db.display().to_string(), source: std::io::Error::other(e) })
}

fn sql_err(db: &Path) -> impl Fn(rusqlite::Error) -> AdapterError + '_ {
    move |e| AdapterError::Io { path: db.display().to_string(), source: std::io::Error::other(e) }
}

pub fn split_locator(path: &Path) -> Option<(PathBuf, String)> {
    let s = path.to_string_lossy();
    let (db, id) = s.rsplit_once('#')?;
    Some((PathBuf::from(db), id.to_string()))
}

impl LocalAgentAdapter for Zed {
    fn id(&self) -> &'static str {
        "zed"
    }

    fn display_name(&self) -> &'static str {
        "Zed"
    }

    fn default_roots(&self) -> Vec<PathBuf> {
        let mut roots = Vec::new();
        if let Some(h) = home() {
            roots.push(h.join("Library").join("Application Support").join("Zed").join("threads"));
            roots.push(h.join(".local").join("share").join("zed").join("threads"));
        }
        if let Some(appdata) = std::env::var_os("LOCALAPPDATA") {
            roots.push(PathBuf::from(appdata).join("Zed").join("threads"));
        }
        roots
    }

    fn discover(&self, root: &Path) -> Result<Vec<DiscoveredSession>> {
        let db = if root.is_file() { root.to_path_buf() } else { root.join(DB_NAME) };
        if !db.is_file() {
            return Ok(vec![]);
        }
        let size = std::fs::metadata(&db).map(|m| m.len()).unwrap_or(0);
        let conn = open_ro(&db)?;
        let mut stmt = conn
            .prepare(
                "SELECT id, summary, updated_at, folder_paths, data_type, data FROM threads WHERE length(data) <= ?1 ORDER BY updated_at DESC",
            )
            .map_err(sql_err(&db))?;

        let mut rows = stmt.query([hopilo_core::limits::DOCUMENT_BYTES]).map_err(sql_err(&db))?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(sql_err(&db))? {
            let id: String = row.get(0).map_err(sql_err(&db))?;
            let summary: String = row.get(1).map_err(sql_err(&db))?;
            let updated_at: String = row.get(2).map_err(sql_err(&db))?;
            let folder_paths: Option<String> = row.get(3).ok();
            let data_type: String = row.get(4).map_err(sql_err(&db))?;
            let data: Vec<u8> = row.get(5).map_err(sql_err(&db))?;

            let decompressed = match decode_record(&data, &data_type) {
                Ok(bytes) => bytes,
                Err(_) => continue,
            };

            let Ok(json): std::result::Result<Value, _> = serde_json::from_slice(&decompressed) else {
                continue;
            };

            let title = json.get("title").and_then(Value::as_str).filter(|t| !t.trim().is_empty()).unwrap_or(&summary);
            let message_count = json.get("messages").and_then(Value::as_array).map(|a| a.len()).unwrap_or(0);
            if message_count == 0 {
                continue;
            }

            let project =
                folder_paths.and_then(|p| p.lines().next().map(|s| s.trim().to_string())).filter(|s| !s.is_empty());

            out.push(DiscoveredSession {
                adapter: "zed".into(),
                path: format!("{}#{}", db.display(), id),
                session_id: id,
                title: title_from(title),
                project,
                model: Some("Zed Assistant".to_string()),
                modified_at: updated_at,
                size_bytes: size,
                message_count,
            });
        }
        Ok(out)
    }

    fn read(&self, path: &Path) -> Result<Capture> {
        let (db, id) = split_locator(path).ok_or_else(|| AdapterError::Unrecognized(path.display().to_string()))?;
        let conn = open_ro(&db)?;
        let mut stmt = conn
            .prepare("SELECT summary, updated_at, folder_paths, data_type, data FROM threads WHERE id = ?1 AND length(data) <= ?2")
            .map_err(sql_err(&db))?;

        let row = stmt
            .query_row(rusqlite::params![&id, hopilo_core::limits::DOCUMENT_BYTES], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, Vec<u8>>(4)?,
                ))
            })
            .map_err(sql_err(&db))?;

        let (summary, updated_at, folder_paths, data_type, data) = row;
        let decompressed = decode_record(&data, &data_type)
            .map_err(|e| AdapterError::Io { path: db.display().to_string(), source: e })?;

        let json: Value = serde_json::from_slice(&decompressed)
            .map_err(|_| AdapterError::Unrecognized(format!("{}#{} (invalid JSON)", db.display(), id)))?;

        let project =
            folder_paths.and_then(|p| p.lines().next().map(|s| s.trim().to_string())).filter(|s| !s.is_empty());
        let title = json.get("title").and_then(Value::as_str).filter(|t| !t.trim().is_empty()).unwrap_or(&summary);

        let source_id = new_id();
        let mut messages = Vec::new();

        if let Some(raw_msgs) = json.get("messages").and_then(Value::as_array) {
            for m in raw_msgs {
                if let Some(user) = m.get("User") {
                    let mut text_parts = Vec::new();
                    if let Some(content) = user.get("content").and_then(Value::as_array) {
                        for item in content {
                            if let Some(t) = item.get("Text").and_then(Value::as_str) {
                                text_parts.push(t.to_string());
                            } else if let Some(mention) = item
                                .get("Mention")
                                .and_then(|m| m.get("uri"))
                                .and_then(|u| u.get("File"))
                                .and_then(|f| f.get("abs_path"))
                                .and_then(Value::as_str)
                            {
                                text_parts.push(format!("`{mention}`"));
                            }
                        }
                    } else if let Some(t) = user.get("text").and_then(Value::as_str) {
                        text_parts.push(t.to_string());
                    }
                    let body = text_parts.join(" ").trim().to_string();
                    if !body.is_empty() {
                        messages.push(Message {
                            id: new_id(),
                            source_id: source_id.clone(),
                            role: Role::User,
                            created_at: Some(updated_at.clone()),
                            blocks: vec![Block::text(body)],
                        });
                    }
                } else if let Some(agent) = m.get("Agent") {
                    let mut text_parts = Vec::new();
                    if let Some(content) = agent.get("content").and_then(Value::as_array) {
                        for item in content {
                            if let Some(t) = item.get("Text").and_then(Value::as_str) {
                                text_parts.push(t.to_string());
                            } else if let Some(thinking) =
                                item.get("Thinking").and_then(|th| th.get("text")).and_then(Value::as_str)
                            {
                                text_parts.push(format!("> {thinking}\n\n"));
                            }
                        }
                    } else if let Some(t) = agent.get("text").and_then(Value::as_str) {
                        text_parts.push(t.to_string());
                    }
                    let body = text_parts.join("").trim().to_string();
                    if !body.is_empty() {
                        messages.push(Message {
                            id: new_id(),
                            source_id: source_id.clone(),
                            role: Role::Assistant,
                            created_at: Some(updated_at.clone()),
                            blocks: vec![Block::text(body)],
                        });
                    }
                } else if let Some(role_str) = m.get("role").and_then(Value::as_str) {
                    let role = if role_str.eq_ignore_ascii_case("user") { Role::User } else { Role::Assistant };
                    let text = m.get("text").and_then(Value::as_str).unwrap_or("").trim();
                    if !text.is_empty() {
                        messages.push(Message {
                            id: new_id(),
                            source_id: source_id.clone(),
                            role,
                            created_at: Some(updated_at.clone()),
                            blocks: vec![Block::text(text.to_string())],
                        });
                    }
                }
            }
        }

        let source = Source {
            source_id,
            kind: SourceKind::LocalAgent,
            provider: "zed".into(),
            title: title_from(title),
            origin: Some(format!("{}#{}", db.display(), id)),
            project,
            model: Some("Zed Assistant".to_string()),
            captured_at: updated_at,
            capture_status: CaptureStatus::Complete,
            missing_items: vec![],
            omitted: vec![],
        };

        Ok(Capture { source, messages, files: vec![] })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovers_and_reads_zed_thread() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("threads.db");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute(
            "CREATE TABLE threads (id TEXT PRIMARY KEY, summary TEXT, updated_at TEXT, folder_paths TEXT, data_type TEXT, data BLOB)",
            [],
        )
        .unwrap();

        let json = serde_json::json!({
            "title": "Build a widget",
            "messages": [
                { "role": "user", "text": "Can you build a widget?" },
                { "role": "assistant", "text": "Sure, here is the widget." }
            ]
        });
        let raw = serde_json::to_vec(&json).unwrap();
        let compressed = zstd::encode_all(&raw[..], 3).unwrap();

        conn.execute(
            "INSERT INTO threads (id, summary, updated_at, folder_paths, data_type, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                "thread-123",
                "Widget discussion",
                "2026-11-05T06:00:00Z",
                "/Users/test/projects/widget\n",
                "zstd",
                compressed
            ],
        )
        .unwrap();

        let zed = Zed;
        let sessions = zed.discover(dir.path()).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "thread-123");
        assert_eq!(sessions[0].title, "Build a widget");
        assert_eq!(sessions[0].project.as_deref(), Some("/Users/test/projects/widget"));

        let cap = zed.read(Path::new(&sessions[0].path)).unwrap();
        assert_eq!(cap.messages.len(), 2);
        assert_eq!(cap.messages[0].role, Role::User);
        assert_eq!(cap.messages[0].blocks[0].plain_text(), "Can you build a widget?");
        assert_eq!(cap.messages[1].role, Role::Assistant);
        assert_eq!(cap.messages[1].blocks[0].plain_text(), "Sure, here is the widget.");
    }
}
