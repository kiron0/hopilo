use std::path::{Path, PathBuf};

use hopilo_core::{new_id, now_rfc3339, Block, CaptureStatus, Message, Role, Source, SourceKind};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;

use crate::text::title_from;
use crate::{home, AdapterError, Capture, DiscoveredSession, LocalAgentAdapter, Result};

pub struct Cursor;

const DB_NAME: &str = "state.vscdb";

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

impl LocalAgentAdapter for Cursor {
    fn id(&self) -> &'static str {
        "cursor"
    }

    fn display_name(&self) -> &'static str {
        "Cursor"
    }

    fn default_roots(&self) -> Vec<PathBuf> {
        let mut roots = Vec::new();
        if let Some(h) = home() {
            roots.push(h.join("Library").join("Application Support").join("Cursor").join("User").join("globalStorage"));
            roots.push(h.join(".config").join("Cursor").join("User").join("globalStorage"));
        }
        if let Some(appdata) = std::env::var_os("APPDATA") {
            roots.push(PathBuf::from(appdata).join("Cursor").join("User").join("globalStorage"));
        }
        roots
    }

    fn scan_depth(&self) -> usize {
        0
    }

    fn discover(&self, root: &Path) -> Result<Vec<DiscoveredSession>> {
        let db = if root.is_file() { root.to_path_buf() } else { root.join(DB_NAME) };
        if !db.is_file() {
            return Ok(vec![]);
        }
        let (size, file_mtime) = crate::file_meta(&db)?;
        let conn = open_ro(&db)?;
        let Some(table) = kv_table(&conn) else { return Ok(vec![]) };

        let Ok(mut stmt) = conn.prepare(&format!("SELECT key, value FROM {table} WHERE key LIKE 'composerData:%'")) else {
            return Ok(vec![]);
        };
        let mut rows = stmt.query([]).map_err(sql_err(&db))?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(sql_err(&db))? {
            let key: String = row.get(0).map_err(sql_err(&db))?;
            let Some(json) = json_cell(row.get_ref(1).ok()) else { continue };
            let composer_id = json
                .get("composerId")
                .and_then(Value::as_str)
                .unwrap_or_else(|| key.trim_start_matches("composerData:"))
                .to_string();
            let message_count = bubble_headers(&json).len().max(legacy_conversation(&json).len());
            if message_count == 0 {
                continue;
            }
            out.push(DiscoveredSession {
                adapter: "cursor".into(),
                path: format!("{}#{}", db.display(), composer_id),
                session_id: composer_id,
                title: composer_title(&json),
                project: None,
                model: composer_model(&json),
                modified_at: composer_time(&json, "lastUpdatedAt").or_else(|| composer_time(&json, "createdAt")).unwrap_or_else(|| file_mtime.clone()),
                size_bytes: size,
                message_count,
            });
        }
        Ok(out)
    }

    fn read(&self, path: &Path) -> Result<Capture> {
        let (db, composer_id) = split_locator(path).ok_or_else(|| AdapterError::Unrecognized(path.display().to_string()))?;
        let conn = open_ro(&db)?;
        let table = kv_table(&conn).ok_or_else(|| AdapterError::Unrecognized(db.display().to_string()))?;
        let json = kv_get(&conn, table, &format!("composerData:{composer_id}"))
            .or_else(|| kv_get(&conn, table, &composer_id))
            .ok_or_else(|| AdapterError::Unrecognized(format!("{}#{} (no such chat)", db.display(), composer_id)))?;

        let created_at = composer_time(&json, "createdAt");
        let source_id = new_id();
        let mut messages = Vec::new();
        let mut missing_bubbles = 0;
        let mut thinking = 0;

        let headers = bubble_headers(&json);
        let bubbles: Vec<Value> = if headers.is_empty() {
            legacy_conversation(&json).to_vec()
        } else {
            headers
                .iter()
                .filter_map(|h| {
                    let id = h.get("bubbleId").and_then(Value::as_str)?;
                    let b = kv_get(&conn, table, &format!("bubbleId:{composer_id}:{id}"));
                    if b.is_none() {
                        missing_bubbles += 1;
                    }
                    b
                })
                .collect()
        };

        for bubble in &bubbles {
            let role = if bubble.get("type").and_then(Value::as_i64) == Some(2) { Role::Assistant } else { Role::User };
            if bubble.get("thinking").is_some_and(|t| !t.is_null()) {
                thinking += 1;
            }
            let mut blocks = Vec::new();
            let text = bubble.get("text").and_then(Value::as_str).unwrap_or("").trim();
            if !text.is_empty() {
                blocks.push(Block::text(text.to_string()));
            }
            if let Some(tool) = bubble.get("toolFormerData").filter(|t| t.is_object()) {
                let name = tool.get("name").and_then(Value::as_str).unwrap_or("tool").to_string();
                let input = tool
                    .get("rawArgs")
                    .or_else(|| tool.get("params"))
                    .map(|a| match a {
                        Value::String(s) => s.clone(),
                        other => serde_json::to_string_pretty(other).unwrap_or_default(),
                    })
                    .unwrap_or_default();
                blocks.push(Block::ToolCall { name: name.clone(), input });
                if let Some(result) = tool.get("result").filter(|r| !r.is_null()) {
                    let output = match result {
                        Value::String(s) => s.clone(),
                        other => other.to_string(),
                    };
                    blocks.push(Block::ToolResult { name: Some(name), output, is_error: tool.get("status").and_then(Value::as_str) == Some("error") });
                }
            }
            if blocks.is_empty() {
                continue;
            }
            let stamp = bubble.get("createdAt").and_then(|v| match v {
                Value::String(s) => Some(s.clone()),
                Value::Number(n) => n.as_i64().and_then(millis_rfc3339),
                _ => None,
            });
            messages.push(Message {
                id: bubble.get("bubbleId").and_then(Value::as_str).map(str::to_string).unwrap_or_else(new_id),
                source_id: source_id.clone(),
                role,
                created_at: stamp.or_else(|| created_at.clone()),
                blocks,
            });
        }

        let mut missing_items = Vec::new();
        if missing_bubbles > 0 {
            missing_items.push(format!("{missing_bubbles} message(s) listed by Cursor but not found in its database"));
        }
        let mut om = Vec::new();
        crate::omitted(&mut om, "hidden reasoning (thinking) blocks", thinking);
        let source = Source {
            source_id,
            kind: SourceKind::LocalAgent,
            provider: "cursor".into(),
            title: composer_title(&json),
            origin: Some(format!("{}#{}", db.display(), composer_id)),
            project: None,
            model: composer_model(&json),
            captured_at: now_rfc3339(),
            capture_status: if missing_items.is_empty() { CaptureStatus::Complete } else { CaptureStatus::Partial },
            missing_items,
            omitted: om,
        };
        Ok(Capture { source, messages, files: vec![] })
    }
}

fn millis_rfc3339(ms: i64) -> Option<String> {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms).map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

fn kv_table(conn: &Connection) -> Option<&'static str> {
    for t in ["cursorDiskKV", "ItemTable"] {
        let exists = conn
            .query_row("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?1", [t], |_| Ok(()))
            .is_ok();
        if exists {
            return Some(t);
        }
    }
    None
}

fn json_cell(v: Option<rusqlite::types::ValueRef<'_>>) -> Option<Value> {
    let bytes = match v? {
        rusqlite::types::ValueRef::Text(b) | rusqlite::types::ValueRef::Blob(b) => b,
        _ => return None,
    };
    serde_json::from_slice(bytes).ok()
}

fn kv_get(conn: &Connection, table: &str, key: &str) -> Option<Value> {
    conn.query_row(&format!("SELECT value FROM {table} WHERE key = ?1"), [key], |r| Ok(json_cell(r.get_ref(0).ok())))
        .ok()
        .flatten()
}

fn bubble_headers(json: &Value) -> &[Value] {
    json.get("fullConversationHeadersOnly").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}

fn legacy_conversation(json: &Value) -> &[Value] {
    json.get("conversation").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}

fn composer_title(json: &Value) -> String {
    if let Some(name) = json
        .get("name")
        .and_then(Value::as_str)
        .filter(|n| !n.trim().is_empty())
    {
        return title_from(name);
    }
    if let Some(sub) = json
        .get("subtitle")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
    {
        return title_from(sub);
    }
    if let Some(conv) = json.get("conversation").and_then(Value::as_array) {
        for msg in conv {
            if msg.get("type").and_then(Value::as_str) == Some("user") {
                if let Some(text) = msg.get("text").and_then(Value::as_str).filter(|t| !t.trim().is_empty()) {
                    return title_from(text);
                }
            }
        }
    }
    "Cursor chat".into()
}

fn composer_model(json: &Value) -> Option<String> {
    json.pointer("/modelConfig/modelName").and_then(Value::as_str).filter(|m| !m.is_empty() && *m != "default").map(str::to_string)
}

fn composer_time(json: &Value, key: &str) -> Option<String> {
    json.get(key).and_then(Value::as_i64).and_then(millis_rfc3339)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovers_and_reads_cursor_composer() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("state.vscdb");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute(
            "CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)",
            [],
        )
        .unwrap();

        let json = serde_json::json!({
            "composerId": "comp-456",
            "name": "Refactor router",
            "createdAt": 1700000000000_i64,
            "conversation": [
                { "type": 1, "text": "Refactor the router into modules." },
                { "type": 2, "text": "Done! The router is modularized." }
            ]
        });
        let val_str = serde_json::to_string(&json).unwrap();

        conn.execute(
            "INSERT INTO cursorDiskKV (key, value) VALUES (?1, ?2)",
            rusqlite::params!["composerData:comp-456", val_str],
        )
        .unwrap();

        let cursor = Cursor;
        let sessions = cursor.discover(dir.path()).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "comp-456");
        assert_eq!(sessions[0].title, "Refactor router");

        let cap = cursor.read(Path::new(&sessions[0].path)).unwrap();
        assert_eq!(cap.messages.len(), 2);
        assert_eq!(cap.messages[0].role, Role::User);
        assert_eq!(cap.messages[0].blocks[0].plain_text(), "Refactor the router into modules.");
        assert_eq!(cap.messages[1].role, Role::Assistant);
        assert_eq!(cap.messages[1].blocks[0].plain_text(), "Done! The router is modularized.");
    }

    #[test]
    fn reads_bubble_keyed_chats_from_modern_cursor() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("state.vscdb");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value BLOB)", []).unwrap();
        let composer = serde_json::json!({
            "composerId": "c1", "name": "Fix login", "createdAt": 1700000000000_i64, "lastUpdatedAt": 1700000500000_i64,
            "conversation": [], "modelConfig": {"modelName": "claude-4-sonnet"},
            "fullConversationHeadersOnly": [{"bubbleId": "b1", "type": 1}, {"bubbleId": "b2", "type": 2}, {"bubbleId": "gone", "type": 2}]
        });
        let put = |k: &str, v: serde_json::Value| {
            conn.execute("INSERT INTO cursorDiskKV VALUES (?1, ?2)", rusqlite::params![k, v.to_string().into_bytes()]).unwrap();
        };
        put("composerData:c1", composer);
        put("bubbleId:c1:b1", serde_json::json!({"type": 1, "bubbleId": "b1", "text": "Login fails"}));
        put("bubbleId:c1:b2", serde_json::json!({"type": 2, "bubbleId": "b2", "text": "Fixed the token check.",
            "toolFormerData": {"name": "edit_file", "rawArgs": "{\"path\":\"a.ts\"}", "result": "ok"}}));

        let found = Cursor.discover(dir.path()).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].message_count, 3);
        assert_eq!(found[0].modified_at, "2023-11-14T22:21:40Z");
        assert_eq!(found[0].model.as_deref(), Some("claude-4-sonnet"));
        let cap = Cursor.read(Path::new(&found[0].path)).unwrap();
        assert_eq!(cap.messages.len(), 2);
        assert_eq!(cap.messages[1].blocks.len(), 3);
        assert_eq!(cap.source.capture_status, CaptureStatus::Partial);
    }
}
