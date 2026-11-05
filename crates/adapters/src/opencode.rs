use std::path::{Path, PathBuf};

use hopilo_core::{new_id, now_rfc3339, Block, CaptureStatus, Message, OmittedCount, Role, Source, SourceKind};
use rusqlite::{Connection, OpenFlags, OptionalExtension};

use serde_json::Value;

use crate::text::title_from;
use crate::{home, omitted, AdapterError, Capture, DiscoveredSession, LocalAgentAdapter, Result};

pub struct OpenCode;

const DB_NAME: &str = "opencode.db";

fn open_ro(db: &Path) -> Result<Connection> {
    Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|e| AdapterError::Io { path: db.display().to_string(), source: std::io::Error::other(e) })
}

fn sql_err(db: &Path) -> impl Fn(rusqlite::Error) -> AdapterError + '_ {
    move |e| AdapterError::Io { path: db.display().to_string(), source: std::io::Error::other(e) }
}

fn millis_to_rfc3339(ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)
        .map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        .unwrap_or_default()
}

pub fn split_locator(path: &Path) -> Option<(PathBuf, String)> {
    let s = path.to_string_lossy();
    let (db, id) = s.rsplit_once('#')?;
    Some((PathBuf::from(db), id.to_string()))
}

impl LocalAgentAdapter for OpenCode {
    fn id(&self) -> &'static str {
        "opencode"
    }

    fn display_name(&self) -> &'static str {
        "OpenCode"
    }

    fn default_roots(&self) -> Vec<PathBuf> {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| home().map(|h| h.join(".local").join("share")))
            .map(|d| vec![d.join("opencode")])
            .unwrap_or_default()
    }

    fn scan_depth(&self) -> usize {
        0
    }

    fn discover(&self, root: &Path) -> Result<Vec<DiscoveredSession>> {
        let db = root.join(DB_NAME);
        if !db.is_file() {
            return Ok(vec![]);
        }
        let size = std::fs::metadata(&db).map(|m| m.len()).unwrap_or(0);
        let conn = open_ro(&db)?;
        let mut out = Vec::new();
        for (id, row) in list_sessions(&conn, &db)? {
            if row.count == 0 {
                continue;
            }
            out.push(DiscoveredSession {
                adapter: "opencode".into(),
                path: format!("{}#{id}", db.display()),
                title: real_title(row.title).unwrap_or_else(|| format!("OpenCode session {id}")),
                session_id: id,
                project: row.dir,
                model: row.model.and_then(|m| model_name(&m)),
                modified_at: row.updated.map(millis_to_rfc3339).unwrap_or_default(),
                size_bytes: size,
                message_count: row.count as usize,
            });
        }
        out.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
        Ok(out)
    }

    fn read(&self, path: &Path) -> Result<Capture> {
        let (db, session_id) = split_locator(path).ok_or_else(|| AdapterError::Unrecognized(path.display().to_string()))?;
        let conn = open_ro(&db)?;
        let rows = list_sessions(&conn, &db)?;
        match rows.get(&session_id) {
            Some(r) if r.store == Store::V2 => read_session_v2(&conn, &db, &session_id, path, r),
            _ => read_session(&db, &session_id, path),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Store {
    /// `session` + `message` + `part` (OpenCode 1.x).
    V1,
    /// `session_v2` + `session_message` (newer builds; sessions migrate over).
    V2,
}

#[derive(Debug)]
struct SessionRow {
    title: Option<String>,
    dir: Option<String>,
    model: Option<String>,
    updated: Option<i64>,
    count: i64,
    store: Store,
}

fn has_table(conn: &Connection, name: &str) -> bool {
    conn.query_row("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1", [name], |_| Ok(())).is_ok()
}

/// Top-level, unarchived sessions from both stores. While OpenCode migrates,
/// a session can be in either or both; the most recently updated copy wins
/// (the old store on a tie, since it keeps per-part detail).
fn list_sessions(conn: &Connection, db: &Path) -> Result<std::collections::HashMap<String, SessionRow>> {
    let mut map: std::collections::HashMap<String, SessionRow> = std::collections::HashMap::new();
    let queries = [
        (Store::V1, "session", "SELECT s.id, s.title, s.directory, s.model, s.time_updated,
                (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id)
             FROM session s WHERE s.parent_id IS NULL AND s.time_archived IS NULL"),
        (Store::V2, "session_v2", "SELECT s.id, s.title, s.directory, s.model, s.time_updated,
                (SELECT COUNT(*) FROM session_message m WHERE m.session_id = s.id AND m.type IN ('user', 'assistant'))
             FROM session_v2 s WHERE s.parent_id IS NULL AND s.time_archived IS NULL"),
    ];
    for (store, table, sql) in queries {
        if !has_table(conn, table) {
            continue;
        }
        let mut stmt = conn.prepare(sql).map_err(sql_err(db))?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    SessionRow { title: r.get(1)?, dir: r.get(2)?, model: r.get(3)?, updated: r.get(4)?, count: r.get(5)?, store },
                ))
            })
            .map_err(sql_err(db))?;
        for (id, row) in rows.flatten() {
            if row.count == 0 {
                continue;
            }
            let replace = match map.get(&id) {
                None => true,
                Some(prev) => row.updated.unwrap_or(0) > prev.updated.unwrap_or(0),
            };
            if replace {
                map.insert(id, row);
            }
        }
    }
    Ok(map)
}

/// OpenCode names a session "New session - <timestamp>" until it titles it.
fn real_title(t: Option<String>) -> Option<String> {
    t.filter(|t| !t.trim().is_empty() && !t.starts_with("New session - ") && !t.starts_with("Child session - "))
}

fn model_name(raw: &str) -> Option<String> {
    match serde_json::from_str::<Value>(raw) {
        Ok(v) => v.get("modelID").or_else(|| v.get("id")).and_then(Value::as_str).map(str::to_string),
        Err(_) => Some(raw.to_string()).filter(|s| !s.is_empty()),
    }
}

fn read_session(db: &Path, session_id: &str, locator: &Path) -> Result<Capture> {
    let conn = open_ro(db)?;
    let (title, dir): (Option<String>, Option<String>) = conn
        .query_row("SELECT title, directory FROM session WHERE id = ?1", [session_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()
        .map_err(sql_err(db))?
        .ok_or_else(|| AdapterError::Unrecognized(locator.display().to_string()))?;

    let mut msg_stmt = conn
        .prepare("SELECT id, time_created, data FROM message WHERE session_id = ?1 ORDER BY time_created, id")
        .map_err(sql_err(db))?;
    let msgs: Vec<(String, i64, String)> = msg_stmt
        .query_map([session_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(sql_err(db))?
        .flatten()
        .collect();
    let mut part_stmt = conn
        .prepare("SELECT data FROM part WHERE message_id = ?1 ORDER BY time_created, id")
        .map_err(sql_err(db))?;

    let source_id = new_id();
    let mut messages = Vec::new();
    let (mut reasoning, mut files, mut compactions, mut unreadable) = (0, 0, 0, 0);
    let mut recovered = Vec::new();
    let mut model = None;
    let mut first_prompt = None;

    for (mid, created, data) in msgs {
        let Ok(meta) = serde_json::from_str::<Value>(&data) else {
            unreadable += 1;
            continue;
        };
        let role = match meta.get("role").and_then(Value::as_str) {
            Some("user") => Role::User,
            Some("assistant") => Role::Assistant,
            _ => continue,
        };
        if role == Role::Assistant && model.is_none() {
            model = meta.get("modelID").and_then(Value::as_str).map(str::to_string);
        }
        let created_at = Some(millis_to_rfc3339(created));
        let mut blocks = Vec::new();
        let mut results = Vec::new();
        let parts: Vec<String> = part_stmt.query_map([&mid], |r| r.get(0)).map_err(sql_err(db))?.flatten().collect();
        for p in parts {
            let Ok(part) = serde_json::from_str::<Value>(&p) else {
                unreadable += 1;
                continue;
            };
            match part.get("type").and_then(Value::as_str).unwrap_or("") {
                "text" => {

                    if part.get("synthetic").and_then(Value::as_bool) == Some(true) {
                        continue;
                    }
                    if let Some(t) = part.get("text").and_then(Value::as_str).filter(|t| !t.trim().is_empty()) {
                        blocks.push(Block::text(t.trim_end()));
                    }
                }
                "reasoning" => reasoning += 1,
                "tool" => {
                    let name = part.get("tool").and_then(Value::as_str).unwrap_or("tool").to_string();
                    let state = part.get("state").cloned().unwrap_or(Value::Null);
                    let input = state.get("input").map(|i| serde_json::to_string_pretty(i).unwrap_or_default()).unwrap_or_default();
                    blocks.push(Block::ToolCall { name: name.clone(), input });
                    let status = state.get("status").and_then(Value::as_str).unwrap_or("");
                    let output = state
                        .get("output")
                        .and_then(Value::as_str)
                        .or_else(|| state.get("error").and_then(Value::as_str))
                        .unwrap_or("")
                        .to_string();
                    if !output.is_empty() || status == "error" {
                        results.push(Block::ToolResult { name: Some(name), output, is_error: status == "error" });
                    }
                }
                "file" => {
                    let name = part.get("filename").and_then(Value::as_str).unwrap_or("file");
                    let mime = part.get("mime").and_then(Value::as_str).unwrap_or("");
                    let url = part.get("url").and_then(Value::as_str).unwrap_or("");
                    let f = if url.starts_with("data:") {
                        hopilo_core::CapturedFile::from_base64(name, mime, url)
                    } else {
                        crate::text::read_local_file(url).map(|mut f| {
                            f.name = name.to_string();
                            if !mime.is_empty() {
                                f.media_type = mime.to_string();
                            }
                            f
                        })
                    };
                    match f {
                        Some(f) => {
                            blocks.push(f.block());
                            recovered.push(f);
                        }
                        None => {
                            files += 1;
                            blocks.push(Block::Missing { description: format!("file “{name}” attached in OpenCode") });
                        }
                    }
                }
                "compaction" => compactions += 1,
                _ => {}
            }
        }
        if role == Role::User && first_prompt.is_none() {
            first_prompt = blocks.iter().find_map(|b| match b {
                Block::Text { text } => Some(title_from(text)).filter(|t| !t.is_empty()),
                _ => None,
            });
        }
        if !blocks.is_empty() {
            messages.push(Message { id: mid.clone(), source_id: source_id.clone(), role, created_at: created_at.clone(), blocks });
        }
        if !results.is_empty() {
            messages.push(Message { id: format!("{mid}-results"), source_id: source_id.clone(), role: Role::Tool, created_at, blocks: results });
        }
    }

    let mut missing = Vec::new();
    if compactions > 0 {
        missing.push(format!("{compactions} compaction(s): earlier history was summarized by OpenCode"));
    }
    if files > 0 {
        missing.push(format!("{files} attached file(s) referenced but not recovered"));
    }
    if unreadable > 0 {
        missing.push(format!("{unreadable} unreadable record(s)"));
    }
    let mut om: Vec<OmittedCount> = Vec::new();
    omitted(&mut om, "hidden reasoning parts", reasoning);

    Ok(Capture {
        source: Source {
            source_id,
            kind: SourceKind::LocalAgent,
            provider: "opencode".into(),
            title: real_title(title).or(first_prompt).unwrap_or_else(|| format!("OpenCode session {session_id}")),
            origin: Some(locator.display().to_string()),
            project: dir,
            model,
            captured_at: now_rfc3339(),
            capture_status: if missing.is_empty() { CaptureStatus::Complete } else { CaptureStatus::Partial },
            missing_items: missing,
            omitted: om,
        },
        messages,
        files: recovered,
    })
}

fn read_session_v2(conn: &Connection, db: &Path, session_id: &str, locator: &Path, row: &SessionRow) -> Result<Capture> {
    let mut stmt = conn
        .prepare("SELECT id, type, time_created, data FROM session_message WHERE session_id = ?1 ORDER BY seq, time_created, id")
        .map_err(sql_err(db))?;
    let rows: Vec<(String, String, Option<i64>, String)> = stmt
        .query_map([session_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .map_err(sql_err(db))?
        .flatten()
        .collect();

    let source_id = new_id();
    let mut messages = Vec::new();
    let (mut reasoning, mut files, mut compactions, mut unreadable, mut synthetic, mut system) = (0, 0, 0, 0, 0, 0);
    let mut model = row.model.as_deref().and_then(model_name);
    let mut first_prompt = None;

    for (mid, kind, created, data) in rows {
        let Ok(v) = serde_json::from_str::<Value>(&data) else {
            unreadable += 1;
            continue;
        };
        let created_at = created.map(millis_to_rfc3339);
        match kind.as_str() {
            "user" => {
                let mut blocks = Vec::new();
                if let Some(t) = v.get("text").and_then(Value::as_str).filter(|t| !t.trim().is_empty()) {
                    blocks.push(Block::text(t.trim_end()));
                    if first_prompt.is_none() {
                        first_prompt = Some(title_from(t)).filter(|t| !t.is_empty());
                    }
                }
                for f in v.get("files").and_then(Value::as_array).into_iter().flatten() {
                    let name = f.get("filename").or_else(|| f.get("name")).and_then(Value::as_str).unwrap_or("file");
                    files += 1;
                    blocks.push(Block::Missing { description: format!("file “{name}” attached in OpenCode") });
                }
                if !blocks.is_empty() {
                    messages.push(Message { id: mid, source_id: source_id.clone(), role: Role::User, created_at, blocks });
                }
            }
            "assistant" => {
                if model.is_none() {
                    model = v.pointer("/model/id").and_then(Value::as_str).map(str::to_string);
                }
                let mut blocks = Vec::new();
                let mut results = Vec::new();
                for part in v.get("content").and_then(Value::as_array).into_iter().flatten() {
                    match part.get("type").and_then(Value::as_str).unwrap_or("") {
                        "text" => {
                            if let Some(t) = part.get("text").and_then(Value::as_str).filter(|t| !t.trim().is_empty()) {
                                blocks.push(Block::text(t.trim_end()));
                            }
                        }
                        "reasoning" => reasoning += 1,
                        "tool" => {
                            let name = part.get("name").or_else(|| part.get("tool")).and_then(Value::as_str).unwrap_or("tool").to_string();
                            let state = part.get("state").cloned().unwrap_or(Value::Null);
                            let input = state.get("input").map(|i| serde_json::to_string_pretty(i).unwrap_or_default()).unwrap_or_default();
                            blocks.push(Block::ToolCall { name: name.clone(), input });
                            let status = state.get("status").and_then(Value::as_str).unwrap_or("");
                            let output = match state.get("content") {
                                Some(Value::Array(items)) => items
                                    .iter()
                                    .filter_map(|i| i.get("text").and_then(Value::as_str))
                                    .collect::<Vec<_>>()
                                    .join("\n"),
                                _ => state
                                    .get("output")
                                    .and_then(Value::as_str)
                                    .or_else(|| state.get("error").and_then(Value::as_str))
                                    .unwrap_or("")
                                    .to_string(),
                            };
                            if !output.is_empty() || status == "error" {
                                results.push(Block::ToolResult { name: Some(name), output, is_error: status == "error" });
                            }
                        }
                        _ => {}
                    }
                }
                if !blocks.is_empty() {
                    messages.push(Message { id: mid.clone(), source_id: source_id.clone(), role: Role::Assistant, created_at: created_at.clone(), blocks });
                }
                if !results.is_empty() {
                    messages.push(Message { id: format!("{mid}-results"), source_id: source_id.clone(), role: Role::Tool, created_at, blocks: results });
                }
            }
            "compaction" => compactions += 1,
            "synthetic" => synthetic += 1,
            "system" => system += 1,
            _ => {}
        }
    }

    let mut missing = Vec::new();
    if compactions > 0 {
        missing.push(format!("{compactions} compaction(s): earlier history was summarized by OpenCode"));
    }
    if files > 0 {
        missing.push(format!("{files} attached file(s) referenced but not recovered"));
    }
    if unreadable > 0 {
        missing.push(format!("{unreadable} unreadable record(s)"));
    }
    let mut om: Vec<OmittedCount> = Vec::new();
    omitted(&mut om, "hidden reasoning parts", reasoning);
    omitted(&mut om, "automatic continue prompts", synthetic);
    omitted(&mut om, "system notices", system);

    Ok(Capture {
        source: Source {
            source_id,
            kind: SourceKind::LocalAgent,
            provider: "opencode".into(),
            title: real_title(row.title.clone()).or(first_prompt).unwrap_or_else(|| format!("OpenCode session {session_id}")),
            origin: Some(locator.display().to_string()),
            project: row.dir.clone(),
            model,
            captured_at: now_rfc3339(),
            capture_status: if missing.is_empty() { CaptureStatus::Complete } else { CaptureStatus::Partial },
            missing_items: missing,
            omitted: om,
        },
        messages,
        files: vec![],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_db(dir: &Path) -> PathBuf {
        let db = dir.join(DB_NAME);
        let c = Connection::open(&db).unwrap();
        c.execute_batch(
            r#"
            CREATE TABLE session (id TEXT, parent_id TEXT, title TEXT, directory TEXT, model TEXT,
                time_created INTEGER, time_updated INTEGER, time_archived INTEGER);
            CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
            CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
            INSERT INTO session VALUES ('ses_1', NULL, 'Fix trust score', '/work/ext', '{"providerID":"x","modelID":"glm-5.2"}', 1, 1793503894244, NULL);
            INSERT INTO session VALUES ('ses_child', 'ses_1', 'subtask', '/work/ext', NULL, 1, 2, NULL);
            INSERT INTO message VALUES ('m1', 'ses_1', 10, 10, '{"role":"user"}');
            INSERT INTO message VALUES ('m2', 'ses_1', 20, 20, '{"role":"assistant","modelID":"glm-5.2"}');
            INSERT INTO message VALUES ('mc', 'ses_child', 30, 30, '{"role":"user"}');
            INSERT INTO part VALUES ('p1', 'm1', 'ses_1', 11, 11, '{"type":"text","text":"Check the trust score calculation"}');
            INSERT INTO part VALUES ('p0', 'm1', 'ses_1', 12, 12, '{"type":"text","text":"injected","synthetic":true}');
            INSERT INTO part VALUES ('p2', 'm2', 'ses_1', 21, 21, '{"type":"reasoning","text":"hidden"}');
            INSERT INTO part VALUES ('p3', 'm2', 'ses_1', 22, 22, '{"type":"tool","tool":"bash","callID":"c1","state":{"status":"completed","input":{"command":"npm test"},"output":"2 failing"}}');
            INSERT INTO part VALUES ('p4', 'm2', 'ses_1', 23, 23, '{"type":"text","text":"Two tests fail in `score.ts`."}');
            INSERT INTO part VALUES ('p5', 'm2', 'ses_1', 24, 24, '{"type":"step-finish"}');
            "#,
        )
        .unwrap();
        db
    }

    #[test]
    fn discovers_top_level_sessions_and_reads_read_only() {
        let dir = tempfile::tempdir().unwrap();
        let db = sample_db(dir.path());
        let before = std::fs::read(&db).unwrap();

        let found = OpenCode.discover(dir.path()).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].title, "Fix trust score");
        assert_eq!(found[0].model.as_deref(), Some("glm-5.2"));

        let cap = OpenCode.read(Path::new(&found[0].path)).unwrap();
        let roles: Vec<Role> = cap.messages.iter().map(|m| m.role).collect();
        assert_eq!(roles, vec![Role::User, Role::Assistant, Role::Tool]);
        assert_eq!(cap.messages[0].blocks.len(), 1, "synthetic text is skipped");
        assert_eq!(cap.messages[1].blocks[1].plain_text(), "Two tests fail in `score.ts`.");
        assert_eq!(cap.messages[2].blocks[0].plain_text(), "2 failing");
        assert_eq!(cap.source.project.as_deref(), Some("/work/ext"));
        assert!(cap.source.omitted.iter().any(|o| o.count == 1));

        assert_eq!(std::fs::read(&db).unwrap(), before);
    }

    #[test]
    fn reads_sessions_that_only_exist_in_the_v2_store() {
        let dir = tempfile::tempdir().unwrap();
        let db = sample_db(dir.path());
        let c = Connection::open(&db).unwrap();
        c.execute_batch(
            r#"
            CREATE TABLE session_v2 (id TEXT, parent_id TEXT, title TEXT, directory TEXT, model TEXT,
                time_created INTEGER, time_updated INTEGER, time_archived INTEGER);
            CREATE TABLE session_message (id TEXT, session_id TEXT, type TEXT, seq INTEGER, time_created INTEGER, time_updated INTEGER, data TEXT);
            INSERT INTO session_v2 VALUES ('ses_2', NULL, 'New session - 2026-11-05T06:41:06.253Z', '/work/app', '{"id":"mimo","providerID":"opencode"}', 1, 1793861149822, NULL);
            INSERT INTO session_message VALUES ('a', 'ses_2', 'user', 1, 10, 10, '{"text":"Sweep the workspace for bugs","files":[]}');
            INSERT INTO session_message VALUES ('b', 'ses_2', 'synthetic', 2, 11, 11, '{"text":"Continue"}');
            INSERT INTO session_message VALUES ('c', 'ses_2', 'assistant', 3, 12, 12, '{"model":{"id":"mimo"},"content":[{"type":"reasoning","text":"x"},{"type":"tool","id":"t","name":"bash","state":{"status":"completed","input":{"command":"ls"},"content":[{"type":"text","text":"a.rs"}]}},{"type":"text","text":"Found it."}]}');
            "#,
        )
        .unwrap();
        drop(c);

        let found = OpenCode.discover(dir.path()).unwrap();
        assert_eq!(found.len(), 2);
        let v2 = found.iter().find(|s| s.session_id == "ses_2").unwrap();
        assert_eq!(v2.message_count, 2);
        assert_eq!(v2.model.as_deref(), Some("mimo"));
        let cap = OpenCode.read(Path::new(&v2.path)).unwrap();
        assert_eq!(cap.source.title, "Sweep the workspace for bugs");
        let roles: Vec<Role> = cap.messages.iter().map(|m| m.role).collect();
        assert_eq!(roles, vec![Role::User, Role::Assistant, Role::Tool]);
        assert_eq!(cap.messages[2].blocks[0].plain_text(), "a.rs");
        assert_eq!(cap.messages[1].blocks.last().unwrap().plain_text(), "Found it.");
    }
}
