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

    fn discover(&self, root: &Path) -> Result<Vec<DiscoveredSession>> {
        let db = root.join(DB_NAME);
        if !db.is_file() {
            return Ok(vec![]);
        }
        let size = std::fs::metadata(&db).map(|m| m.len()).unwrap_or(0);
        let conn = open_ro(&db)?;
        let mut stmt = conn
            .prepare(
                "SELECT s.id, s.title, s.directory, s.model, s.time_updated,
                        (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id)
                 FROM session s WHERE s.parent_id IS NULL AND s.time_archived IS NULL
                 ORDER BY s.time_updated DESC",
            )
            .map_err(sql_err(&db))?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<i64>>(4)?,
                    r.get::<_, i64>(5)?,
                ))
            })
            .map_err(sql_err(&db))?;
        let mut out = Vec::new();
        for row in rows.flatten() {
            let (id, title, dir, model, updated, count) = row;
            if count == 0 {
                continue;
            }
            out.push(DiscoveredSession {
                adapter: "opencode".into(),
                path: format!("{}#{id}", db.display()),
                title: title.filter(|t| !t.trim().is_empty()).unwrap_or_else(|| format!("OpenCode session {id}")),
                session_id: id,
                project: dir,
                model: model.and_then(|m| model_name(&m)),
                modified_at: updated.map(millis_to_rfc3339).unwrap_or_default(),

                size_bytes: size,
                message_count: count as usize,
            });
        }
        Ok(out)
    }

    fn read(&self, path: &Path) -> Result<Capture> {
        let (db, session_id) = split_locator(path).ok_or_else(|| AdapterError::Unrecognized(path.display().to_string()))?;
        read_session(&db, &session_id, path)
    }
}

fn model_name(raw: &str) -> Option<String> {
    match serde_json::from_str::<Value>(raw) {
        Ok(v) => v.get("modelID").and_then(Value::as_str).map(str::to_string),
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
            title: title.filter(|t| !t.trim().is_empty()).or(first_prompt).unwrap_or_else(|| format!("OpenCode session {session_id}")),
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
}
