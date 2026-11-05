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

    fn discover(&self, root: &Path) -> Result<Vec<DiscoveredSession>> {
        let db = if root.is_file() {
            root.to_path_buf()
        } else {
            root.join(DB_NAME)
        };
        if !db.is_file() {
            return Ok(vec![]);
        }
        let size = std::fs::metadata(&db).map(|m| m.len()).unwrap_or(0);
        let conn = open_ro(&db)?;

        let table = conn
            .query_row(
                "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('cursorDiskKV', 'ItemTable') ORDER BY name DESC LIMIT 1",
                [],
                |r| r.get::<_, String>(0),
            )
            .ok();

        let Some(table_name) = table else {
            return Ok(vec![]);
        };

        let query = format!("SELECT key, value FROM {} WHERE key LIKE 'composerData:%'", table_name);
        let mut stmt = match conn.prepare(&query) {
            Ok(s) => s,
            Err(_) => return Ok(vec![]),
        };

        let mut rows = stmt.query([]).map_err(sql_err(&db))?;
        let mut out = Vec::new();

        while let Some(row) = rows.next().map_err(sql_err(&db))? {
            let key: String = row.get(0).map_err(sql_err(&db))?;
            let val_str: String = match row.get(1) {
                Ok(s) => s,
                Err(_) => continue,
            };

            let Ok(json): std::result::Result<Value, _> = serde_json::from_str(&val_str) else {
                continue;
            };

            let composer_id = json.get("composerId").and_then(Value::as_str).unwrap_or_else(|| key.trim_start_matches("composerData:"));
            let name = json.get("name").and_then(Value::as_str).filter(|n| !n.trim().is_empty()).unwrap_or("Cursor chat");
            let created_at = json.get("createdAt").and_then(Value::as_i64).map(|ms| {
                chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)
                    .map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
                    .unwrap_or_default()
            }).unwrap_or_else(now_rfc3339);

            let conversation = json.get("conversation").and_then(Value::as_array);
            let message_count = conversation.map(|c| c.len()).unwrap_or(0);
            if message_count == 0 {
                continue;
            }

            out.push(DiscoveredSession {
                adapter: "cursor".into(),
                path: format!("{}#{}", db.display(), composer_id),
                session_id: composer_id.to_string(),
                title: title_from(name),
                project: None,
                model: Some("Cursor Agent".to_string()),
                modified_at: created_at,
                size_bytes: size,
                message_count,
            });
        }

        Ok(out)
    }

    fn read(&self, path: &Path) -> Result<Capture> {
        let (db, composer_id) = split_locator(path).ok_or_else(|| AdapterError::Unrecognized(path.display().to_string()))?;
        let conn = open_ro(&db)?;

        let table = conn
            .query_row(
                "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('cursorDiskKV', 'ItemTable') ORDER BY name DESC LIMIT 1",
                [],
                |r| r.get::<_, String>(0),
            )
            .map_err(sql_err(&db))?;

        let query = format!("SELECT value FROM {} WHERE key = ?1 OR key = ?2", table);
        let mut stmt = conn.prepare(&query).map_err(sql_err(&db))?;

        let key_with_prefix = format!("composerData:{}", composer_id);
        let val_str: String = stmt
            .query_row([&key_with_prefix, &composer_id], |r| r.get::<_, String>(0))
            .map_err(sql_err(&db))?;

        let json: Value = serde_json::from_str(&val_str)
            .map_err(|_| AdapterError::Unrecognized(format!("{}#{} (invalid JSON)", db.display(), composer_id)))?;

        let name = json.get("name").and_then(Value::as_str).filter(|n| !n.trim().is_empty()).unwrap_or("Cursor chat");
        let created_at = json.get("createdAt").and_then(Value::as_i64).map(|ms| {
            chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)
                .map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
                .unwrap_or_default()
        }).unwrap_or_else(now_rfc3339);

        let source_id = new_id();
        let mut messages = Vec::new();

        if let Some(conversation) = json.get("conversation").and_then(Value::as_array) {
            for bubble in conversation {
                let role_type = bubble.get("type").and_then(Value::as_i64).unwrap_or(1);
                let role = if role_type == 2 { Role::Assistant } else { Role::User };
                let text = bubble.get("text").and_then(Value::as_str).unwrap_or("").trim();
                if !text.is_empty() {
                    messages.push(Message {
                        id: new_id(),
                        source_id: source_id.clone(),
                        role,
                        created_at: Some(created_at.clone()),
                        blocks: vec![Block::text(text.to_string())],
                    });
                }
            }
        }

        let source = Source {
            source_id,
            kind: SourceKind::LocalAgent,
            provider: "cursor".into(),
            title: title_from(name),
            origin: Some(format!("{}#{}", db.display(), composer_id)),
            project: None,
            model: Some("Cursor Agent".to_string()),
            captured_at: created_at,
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
}
