use std::collections::{HashMap, HashSet};

use hopilo_core::{
    new_id, now_rfc3339, Attachment, Block, CaptureStatus, ContextBrief, Integrity, Message, Mode, Pack, Role, Source,
    SourceKind, SCHEMA_VERSION,
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::{content_hash, event, index, kebab, messages_text, DbError, ImportOutcome, Result, Store};
use hopilo_core::render::estimate_tokens;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRow {
    pub id: String,
    pub kind: String,
    pub provider: String,
    pub title: String,
    pub origin: Option<String>,
    pub project: Option<String>,
    pub model: Option<String>,

    pub updated_at: String,
    pub capture_status: String,
    pub message_count: i64,
    pub token_estimate: i64,
    pub missing_count: i64,
    pub file_count: i64,
    pub pinned: bool,
    pub tags: Vec<String>,
    pub last_copied_at: Option<String>,
    pub hidden: bool,
    pub reply_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFile {
    #[serde(flatten)]
    pub file: Attachment,
    pub manual_message_id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPatch {
    pub title: Option<String>,
    pub pinned: Option<bool>,
    pub tags: Option<Vec<String>>,
}

pub struct OriginState {
    pub id: String,
    pub updated_at: String,
    pub hidden: bool,
    pub project: Option<String>,
    pub title: String,
    pub title_edited: bool,
}

impl OriginState {
    pub fn unchanged_since(&self, modified_at: &str) -> bool {
        match (
            chrono::DateTime::parse_from_rfc3339(&self.updated_at),
            chrono::DateTime::parse_from_rfc3339(modified_at),
        ) {
            (Ok(saved), Ok(modified)) => saved >= modified,
            _ => false,
        }
    }
}

pub(crate) const ROW_COLUMNS: &str = "id, kind, provider, title, origin, project, model, COALESCE(updated_at, captured_at),
    capture_status, message_count, token_estimate, missing_count, file_count, pinned, tags, last_copied_at, hidden, reply_count";

pub(crate) fn row_from(r: &rusqlite::Row) -> rusqlite::Result<SessionRow> {
    Ok(SessionRow {
        id: r.get(0)?,
        kind: r.get(1)?,
        provider: r.get(2)?,
        title: r.get(3)?,
        origin: r.get(4)?,
        project: r.get(5)?,
        model: r.get(6)?,
        updated_at: r.get(7)?,
        capture_status: r.get(8)?,
        message_count: r.get(9)?,
        token_estimate: r.get(10)?,
        missing_count: r.get(11)?,
        file_count: r.get(12)?,
        pinned: r.get(13)?,
        tags: serde_json::from_str(&r.get::<_, String>(14)?).unwrap_or_default(),
        last_copied_at: r.get(15)?,
        hidden: r.get(16)?,
        reply_count: r.get(17)?,
    })
}

fn file_count(messages: &[Message]) -> i64 {
    messages.iter().flat_map(|m| m.blocks.iter()).filter(|b| matches!(b, Block::File { .. })).count() as i64
}

fn reply_count(messages: &[Message]) -> i64 {
    messages.iter().filter(|m| m.role != Role::User).count() as i64
}

fn clean_tags(tags: &[String]) -> Vec<String> {
    let mut clean: Vec<String> =
        tags.iter().map(|t| t.trim().to_lowercase()).filter(|t| !t.is_empty() && t.chars().count() <= 40).collect();
    clean.sort();
    clean.dedup();
    clean
}

fn file_block(a: &Attachment) -> Block {
    Block::File { name: a.file_name.clone(), media_type: a.media_type.clone(), sha256: a.sha256.clone(), size: a.size }
}

impl Store {
    pub fn upsert_session(
        &mut self,
        source: &Source,
        messages: &[Message],
        updated_at: Option<&str>,
    ) -> Result<ImportOutcome> {
        self.upsert_session_inner(source, messages, updated_at, None)
    }

    fn upsert_session_inner(
        &mut self,
        source: &Source,
        messages: &[Message],
        updated_at: Option<&str>,
        manual: Option<&Message>,
    ) -> Result<ImportOutcome> {
        let existing: Option<(String, String, bool, Option<String>)> = match &source.origin {
            Some(origin) => self
                .conn
                .query_row(
                    "SELECT id, content_hash, hidden, CASE WHEN title_edited THEN title END
                     FROM sources WHERE origin = ?1 ORDER BY captured_at DESC LIMIT 1",
                    [origin],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .optional()?,
            None => None,
        };
        let updated = updated_at.map(str::to_string).unwrap_or_else(|| source.captured_at.clone());
        let sid = existing.as_ref().map(|(id, ..)| id.as_str()).unwrap_or(&source.source_id);
        let overlays = self.manual_file_messages(sid)?;
        let mut combined;
        let messages = if overlays.is_empty() {
            messages
        } else {
            combined = messages.to_vec();
            for message in overlays {
                combined.retain(|m| m.id != message.id);
                combined.push(message);
            }
            combined.as_slice()
        };
        let hash = content_hash(messages)?;
        if let Some((id, old_hash, hidden, _)) = &existing {
            if *old_hash == hash && !hidden {
                let tx = self.conn.transaction()?;
                let mut refreshed = source.clone();
                refreshed.source_id = id.clone();
                tx.execute(
                    "UPDATE sources SET kind = ?2, provider = ?3, origin = ?4, project = ?5, model = ?6,
                        capture_status = ?7, source_json = ?8, missing_count = ?9, file_count = ?10,
                        updated_at = CASE WHEN updated_at IS NULL OR julianday(?11) >= julianday(updated_at)
                            THEN ?11 ELSE updated_at END WHERE id = ?1",
                    params![
                        id,
                        kebab(&source.kind),
                        source.provider,
                        source.origin,
                        source.project,
                        source.model,
                        kebab(&source.capture_status),
                        serde_json::to_string(&refreshed)?,
                        source.missing_items.len() as i64,
                        file_count(messages),
                        updated,
                    ],
                )?;
                let retitled = tx.execute(
                    "UPDATE sources SET title = ?2 WHERE id = ?1 AND title_edited = 0 AND title <> ?2",
                    params![id, source.title],
                )?;
                if retitled > 0 {
                    tx.execute(
                        "UPDATE search_index SET title = ?2 WHERE kind = 'source' AND ref_id = ?1",
                        params![id, source.title],
                    )?;
                }
                tx.commit()?;
                return Ok(ImportOutcome { source_id: id.clone(), duplicate_of: Some(id.clone()) });
            }
        }
        let id = existing.as_ref().map(|(id, ..)| id.clone()).unwrap_or_else(|| source.source_id.clone());
        let title = existing.as_ref().and_then(|(.., t)| t.clone()).unwrap_or_else(|| source.title.clone());
        let source = Source { source_id: id.clone(), title, ..source.clone() };
        let text = messages_text(messages);
        let tx = self.conn.transaction()?;
        let values = params![
            id,
            kebab(&source.kind),
            source.provider,
            source.title,
            source.origin,
            source.project,
            source.model,
            source.captured_at,
            kebab(&source.capture_status),
            serde_json::to_string(&source)?,
            messages.len() as i64,
            estimate_tokens(&text) as i64,
            hash,
            source.missing_items.len() as i64,
            file_count(messages),
            updated,
            reply_count(messages),
        ];
        if existing.is_some() {
            tx.execute(
                "UPDATE sources SET kind = ?2, provider = ?3, title = ?4, origin = ?5, project = ?6, model = ?7,
                    captured_at = ?8, capture_status = ?9, source_json = ?10, message_count = ?11, token_estimate = ?12,
                    content_hash = ?13, missing_count = ?14, file_count = ?15, updated_at = ?16, reply_count = ?17, hidden = 0
                 WHERE id = ?1",
                values,
            )?;
            tx.execute("DELETE FROM messages WHERE source_id = ?1", [&id])?;
            tx.execute("DELETE FROM search_index WHERE kind = 'source' AND ref_id = ?1", [&id])?;
        } else {
            tx.execute(
                "INSERT INTO sources (id, kind, provider, title, origin, project, model, captured_at, capture_status,
                    source_json, message_count, token_estimate, content_hash, missing_count, file_count, updated_at, reply_count)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
                values,
            )?;
        }
        {
            let mut stmt = tx.prepare_cached(
                "INSERT INTO messages (source_id, ordinal, id, role, created_at, blocks_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )?;
            for (i, m) in messages.iter().enumerate() {
                stmt.execute(params![
                    id,
                    i as i64,
                    m.id,
                    kebab(&m.role),
                    m.created_at,
                    serde_json::to_string(&m.blocks)?
                ])?;
            }
        }
        index(&tx, "source", &id, &source.title, &text)?;
        let verb = if existing.is_some() { "Updated" } else { "Captured" };
        event(&tx, "capture", Some(&id), &format!("{verb} {} from {}", source.title, source.provider))?;
        if let Some(message) = manual {
            tx.execute(
                "INSERT INTO manual_file_messages VALUES(?1,?2,?3)",
                params![id, message.id, serde_json::to_string(message)?],
            )?;
        }
        tx.commit()?;
        Ok(ImportOutcome { source_id: id, duplicate_of: None })
    }

    pub fn list_sessions(&self) -> Result<Vec<SessionRow>> {
        let now = crate::cache::stamp(&self.conn);
        if let Some(hit) = crate::cache::Cache::sessions(&self.cache, now) {
            return Ok((*hit).clone());
        }
        let mut stmt = self.conn.prepare_cached(&format!(
            "SELECT {ROW_COLUMNS} FROM sources WHERE hidden = 0
             ORDER BY pinned DESC, COALESCE(updated_at, captured_at) DESC, rowid DESC"
        ))?;
        let rows: Vec<SessionRow> = stmt.query_map([], row_from)?.collect::<std::result::Result<_, _>>()?;
        crate::cache::Cache::put_sessions(&self.cache, now, std::sync::Arc::new(rows.clone()));
        Ok(rows)
    }

    pub fn list_hidden_sessions(&self) -> Result<Vec<SessionRow>> {
        let mut stmt = self.conn.prepare_cached(&format!(
            "SELECT {ROW_COLUMNS} FROM sources WHERE hidden = 1
             ORDER BY COALESCE(updated_at, captured_at) DESC, rowid DESC"
        ))?;
        let rows = stmt.query_map([], row_from)?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn restore_session(&mut self, id: &str) -> Result<()> {
        let tx = self.conn.transaction()?;
        let title: String = tx
            .query_row("SELECT title FROM sources WHERE id = ?1", [id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| DbError::NotFound(format!("session {id}")))?;
        tx.execute("UPDATE sources SET hidden = 0 WHERE id = ?1", [id])?;
        let mut text = String::new();
        {
            let mut stmt =
                tx.prepare_cached("SELECT blocks_json FROM messages WHERE source_id = ?1 ORDER BY ordinal")?;
            let rows = stmt.query_map([id], |r| r.get::<_, String>(0))?;
            for r in rows {
                if let Ok(blocks) = serde_json::from_str::<Vec<Block>>(&r?) {
                    for b in &blocks {
                        text.push_str(b.plain_text());
                        text.push('\n');
                    }
                }
            }
        }
        tx.execute("DELETE FROM search_index WHERE kind = 'source' AND ref_id = ?1", [id])?;
        index(&tx, "source", id, &title, &text)?;
        event(&tx, "restore", Some(id), "Restored session")?;
        tx.commit()?;
        Ok(())
    }

    pub fn session_row(&self, id: &str) -> Result<SessionRow> {
        self.conn
            .query_row(&format!("SELECT {ROW_COLUMNS} FROM sources WHERE id = ?1"), [id], row_from)
            .optional()?
            .ok_or_else(|| DbError::NotFound(format!("session {id}")))
    }

    pub fn session_origins(&self) -> Result<std::collections::HashMap<String, OriginState>> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT origin, id, COALESCE(updated_at, captured_at), hidden, project, title, title_edited FROM sources WHERE origin IS NOT NULL ORDER BY captured_at ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                OriginState {
                    id: r.get(1)?,
                    updated_at: r.get(2)?,
                    hidden: r.get(3)?,
                    project: r.get(4)?,
                    title: r.get(5)?,
                    title_edited: r.get(6)?,
                },
            ))
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn session_files(&self, messages: &[Message]) -> Vec<Attachment> {
        let file_blocks: Vec<&Block> =
            messages.iter().flat_map(|m| m.blocks.iter()).filter(|b| matches!(b, Block::File { .. })).collect();
        if file_blocks.is_empty() {
            return Vec::new();
        }

        let shas: Vec<&str> = file_blocks
            .iter()
            .filter_map(|b| match b {
                Block::File { sha256, .. } if !sha256.is_empty() => Some(sha256.as_str()),
                _ => None,
            })
            .collect();

        let mut found: HashMap<String, Attachment> = HashMap::new();
        for chunk in shas.chunks(500) {
            let placeholders = vec!["?"; chunk.len()].join(",");
            let query = format!(
                "SELECT id, file_name, media_type, size, sha256, origin_path, text FROM attachments WHERE sha256 IN ({placeholders})"
            );
            let Ok(mut stmt) = self.conn.prepare(&query) else { continue };
            let Ok(rows) = stmt.query_map(rusqlite::params_from_iter(chunk.iter().copied()), Self::attachment_from_row)
            else {
                continue;
            };
            for row in rows.flatten() {
                found.entry(row.sha256.clone()).or_insert(row);
            }
        }

        file_blocks
            .into_iter()
            .enumerate()
            .filter_map(|(i, b)| match b {
                Block::File { name, media_type, sha256, size } => {
                    if let Some(att) = found.get(sha256.as_str()) {
                        let mut a = att.clone();
                        a.id = format!("{}-{i}", a.id);
                        a.file_name = name.clone();
                        Some(a)
                    } else {
                        Some(Attachment {
                            id: format!("file-{sha256}-{i}"),
                            file_name: name.clone(),
                            media_type: media_type.clone(),
                            size: *size,
                            sha256: sha256.clone(),
                            origin_path: None,
                            text: None,
                        })
                    }
                }
                _ => None,
            })
            .collect()
    }

    pub fn update_session(&mut self, id: &str, patch: &SessionPatch) -> Result<()> {
        let tags = patch.tags.as_ref().map(|t| serde_json::to_string(&clean_tags(t))).transpose()?;
        let title = patch.title.as_deref().map(str::trim).filter(|t| !t.is_empty());
        let tx = self.conn.transaction()?;
        let n = tx.execute(
            "UPDATE sources SET title = COALESCE(?2, title), title_edited = title_edited OR ?2 IS NOT NULL, pinned = COALESCE(?3, pinned), tags = COALESCE(?4, tags) WHERE id = ?1",
            params![id, title, patch.pinned, tags],
        )?;
        if n == 0 {
            return Err(DbError::NotFound(format!("session {id}")));
        }
        if let Some(t) = title {
            tx.execute("UPDATE search_index SET title = ?2 WHERE kind = 'source' AND ref_id = ?1", params![id, t])?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn remove_session(&mut self, id: &str) -> Result<()> {
        let row = self.session_row(id)?;
        if row.kind == "local-agent" && row.origin.is_some() {
            let tx = self.conn.transaction()?;
            tx.execute("UPDATE sources SET hidden = 1, pinned = 0 WHERE id = ?1", [id])?;
            tx.execute("DELETE FROM search_index WHERE kind = 'source' AND ref_id = ?1", [id])?;
            event(&tx, "delete", Some(id), "Removed session")?;
            tx.commit()?;
            Ok(())
        } else {
            self.delete_source(id)
        }
    }

    pub fn permanently_delete_sessions(&mut self, ids: &[String]) -> Result<()> {
        if ids.is_empty() || ids.len() > 10_000 {
            return Err(DbError::NotFound("choose 1–10,000 hidden sessions".into()));
        }
        let tx = self.conn.transaction()?;
        let unique: HashSet<_> = ids.iter().collect();
        for id in &unique {
            let hidden: bool =
                tx.query_row("SELECT EXISTS(SELECT 1 FROM sources WHERE id=?1 AND hidden=1)", [id], |r| r.get(0))?;
            if !hidden {
                return Err(DbError::NotFound("hidden session".into()));
            }
        }
        for id in unique {
            tx.execute("DELETE FROM sources WHERE id=?1", [id])?;
            tx.execute("DELETE FROM search_index WHERE kind='source' AND ref_id=?1", [id])?;
        }
        event(&tx, "delete", None, "Permanently deleted hidden sessions")?;
        tx.commit()?;
        Ok(())
    }

    pub fn composed_title(&self, ids: &[String]) -> Result<String> {
        let mut titles = Vec::new();
        let mut seen = HashSet::new();
        for id in ids {
            if !seen.insert(id.as_str()) {
                continue;
            }
            if let Some(title) = self
                .conn
                .query_row("SELECT title FROM sources WHERE id = ?1", [id], |r| r.get::<_, String>(0))
                .optional()?
            {
                titles.push(title);
            }
        }
        match titles.as_slice() {
            [] => Err(DbError::NotFound("session".into())),
            [one] => Ok(one.clone()),
            many => Ok(format!(
                "{} sessions: {}",
                many.len(),
                many.iter().map(String::as_str).collect::<Vec<_>>().join(" + ")
            )),
        }
    }

    pub fn compose(&self, ids: &[String]) -> Result<Pack> {
        let mut sources = Vec::new();
        let mut messages = Vec::new();
        let mut seen = HashSet::new();
        for id in ids {
            if !seen.insert(id.as_str()) {
                continue;
            }
            let (s, m) = self.get_source(id)?;
            sources.push(s);
            messages.extend(m);
        }
        if sources.is_empty() {
            return Err(DbError::NotFound("session".into()));
        }
        let title = match sources.as_slice() {
            [one] => one.title.clone(),
            many => format!(
                "{} sessions: {}",
                many.len(),
                many.iter().map(|s| s.title.as_str()).collect::<Vec<_>>().join(" + ")
            ),
        };
        let attachments = self.session_files(&messages);
        Ok(Pack {
            schema_version: SCHEMA_VERSION.into(),
            pack_id: ids.join(","),
            title,
            version: 0,
            created_at: now_rfc3339(),
            mode: Mode::Full,
            sources,
            messages,
            context: ContextBrief::default(),
            attachments,
            tags: vec![],
            integrity: Integrity::default(),
        })
    }

    pub fn record_copy(&mut self, ids: &[String], target: &str, method: &str, status: &str) -> Result<()> {
        let now = now_rfc3339();
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO handoffs (id, pack_id, version, target, method, status, created_at) VALUES (?1, ?2, 0, ?3, ?4, ?5, ?6)",
            params![new_id(), ids.join(","), target, method, status, now],
        )?;
        if matches!(status, "copied" | "drafted" | "exported") {
            for id in ids {
                tx.execute("UPDATE sources SET last_copied_at = ?2 WHERE id = ?1", params![id, now])?;
            }
        }
        event(&tx, "handoff", ids.first().map(String::as_str), &format!("{status} via {method} for {target}"))?;
        tx.commit()?;
        Ok(())
    }

    pub fn add_files(&mut self, session: Option<&str>, files: &[Attachment]) -> Result<String> {
        if files.is_empty() {
            return Err(DbError::NotFound("files".into()));
        }
        let blocks: Vec<Block> = files.iter().map(file_block).collect();
        match session {
            Some(id) => {
                let (source, mut messages) = self.get_source(id)?;
                let message = Message {
                    id: new_id(),
                    source_id: id.into(),
                    role: Role::User,
                    created_at: Some(now_rfc3339()),
                    blocks,
                };
                messages.push(message.clone());
                self.replace_messages(&source, &messages, Some(&message))?;
                Ok(id.to_string())
            }
            None => {
                let title = match files {
                    [one] => one.file_name.clone(),
                    [first, rest @ ..] => format!("{} and {} more", first.file_name, rest.len()),
                    [] => unreachable!(),
                };
                let source = manual_source(&title, SourceKind::File);
                let msg = Message {
                    id: new_id(),
                    source_id: source.source_id.clone(),
                    role: Role::User,
                    created_at: None,
                    blocks,
                };
                Ok(self.upsert_session_inner(&source, std::slice::from_ref(&msg), None, Some(&msg))?.source_id)
            }
        }
    }

    pub fn manual_file_messages(&self, id: &str) -> Result<Vec<Message>> {
        let mut stmt = self
            .conn
            .prepare_cached("SELECT message_json FROM manual_file_messages WHERE source_id=?1 ORDER BY rowid")?;
        let json = stmt.query_map([id], |r| r.get::<_, String>(0))?.collect::<std::result::Result<Vec<_>, _>>()?;
        json.into_iter().map(|s| serde_json::from_str(&s).map_err(DbError::from)).collect()
    }

    pub fn session_file_entries(&self, id: &str, messages: &[Message]) -> Result<Vec<SessionFile>> {
        let owned: HashSet<_> = self
            .manual_file_messages(id)?
            .into_iter()
            .flat_map(|m| {
                m.blocks.into_iter().filter_map(move |block| match block {
                    Block::File { sha256, name, .. } => Some((m.id.clone(), sha256, name)),
                    _ => None,
                })
            })
            .collect();
        let owners = messages.iter().flat_map(|m| {
            m.blocks.iter().filter_map(|block| match block {
                Block::File { sha256, name, .. } => {
                    Some(owned.contains(&(m.id.clone(), sha256.clone(), name.clone())).then(|| m.id.clone()))
                }
                _ => None,
            })
        });
        Ok(self
            .session_files(messages)
            .into_iter()
            .zip(owners)
            .map(|(file, manual_message_id)| SessionFile { file, manual_message_id })
            .collect())
    }

    pub fn remove_session_file(&mut self, id: &str, message_id: &str, sha: &str, name: &str) -> Result<()> {
        let mut owned = self
            .manual_file_messages(id)?
            .into_iter()
            .find(|m| m.id == message_id)
            .ok_or_else(|| DbError::NotFound("Hopilo-added file message".into()))?;
        let before = owned.blocks.len();
        owned.blocks.retain(
            |b| !matches!(b, Block::File { sha256, name: file_name, .. } if sha256 == sha && file_name == name),
        );
        if before == owned.blocks.len() {
            return Err(DbError::NotFound("Hopilo-added file".into()));
        }
        let (source, mut messages) = self.get_source(id)?;
        let position = messages.iter().position(|m| m.id == message_id).unwrap_or(messages.len());
        messages.retain(|m| m.id != message_id);
        if !owned.blocks.is_empty() {
            messages.insert(position.min(messages.len()), owned.clone());
        }
        self.replace_messages(&source, &messages, Some(&owned))
    }

    fn replace_messages(&mut self, source: &Source, messages: &[Message], manual: Option<&Message>) -> Result<()> {
        let id = &source.source_id;
        let text = messages_text(messages);
        let tx = self.conn.transaction()?;
        tx.execute(
            "UPDATE sources SET message_count = ?2, token_estimate = ?3, content_hash = ?4, file_count = ?5, updated_at = ?6, reply_count = ?7 WHERE id = ?1",
            params![
                id,
                messages.len() as i64,
                estimate_tokens(&text) as i64,
                content_hash(messages)?,
                file_count(messages),
                now_rfc3339(),
                reply_count(messages)
            ],
        )?;
        tx.execute("DELETE FROM messages WHERE source_id = ?1", [id])?;
        {
            let mut stmt = tx.prepare_cached(
                "INSERT INTO messages (source_id, ordinal, id, role, created_at, blocks_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )?;
            for (i, m) in messages.iter().enumerate() {
                stmt.execute(params![
                    id,
                    i as i64,
                    m.id,
                    kebab(&m.role),
                    m.created_at,
                    serde_json::to_string(&m.blocks)?
                ])?;
            }
        }
        tx.execute("DELETE FROM search_index WHERE kind = 'source' AND ref_id = ?1", [id])?;
        index(&tx, "source", id, &source.title, &text)?;
        if let Some(message) = manual {
            if message.blocks.is_empty() {
                tx.execute(
                    "DELETE FROM manual_file_messages WHERE source_id=?1 AND message_id=?2",
                    params![id, message.id],
                )?;
            } else {
                tx.execute("INSERT INTO manual_file_messages VALUES(?1,?2,?3) ON CONFLICT(source_id,message_id) DO UPDATE SET message_json=excluded.message_json",
                    params![id, message.id, serde_json::to_string(message)?])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn adopt_pack(&mut self, pack: &Pack) -> Result<Vec<String>> {
        let mut ids = Vec::new();
        for s in &pack.sources {
            let msgs: Vec<Message> = pack.messages.iter().filter(|m| m.source_id == s.source_id).cloned().collect();
            let exists: bool =
                self.conn
                    .query_row("SELECT EXISTS(SELECT 1 FROM sources WHERE id = ?1)", [&s.source_id], |r| r.get(0))?;
            if exists {
                let hidden: bool =
                    self.conn.query_row("SELECT hidden FROM sources WHERE id = ?1", [&s.source_id], |r| r.get(0))?;
                if hidden {
                    self.restore_session(&s.source_id)?;
                }
                ids.push(s.source_id.clone());
            } else if !msgs.is_empty() {
                ids.push(self.upsert_session(s, &msgs, None)?.source_id);
            }
        }
        let in_messages: HashSet<&str> = pack
            .messages
            .iter()
            .flat_map(|m| m.blocks.iter())
            .filter_map(|b| if let Block::File { sha256, .. } = b { Some(sha256.as_str()) } else { None })
            .collect();
        let loose: Vec<&Attachment> =
            pack.attachments.iter().filter(|a| !in_messages.contains(a.sha256.as_str())).collect();
        let note = pack.context.note.as_deref().map(str::trim).filter(|n| !n.is_empty());
        if note.is_some() || !loose.is_empty() {
            let source = manual_source(&pack.title, SourceKind::Pack);
            let mut blocks: Vec<Block> = note.map(Block::text).into_iter().collect();
            blocks.extend(loose.into_iter().map(file_block));
            let msg = Message {
                id: new_id(),
                source_id: source.source_id.clone(),
                role: Role::User,
                created_at: None,
                blocks,
            };
            ids.push(self.upsert_session(&source, &[msg], None)?.source_id);
        }
        Ok(ids)
    }

    pub(crate) fn upgrade_to_sessions(&mut self) -> Result<()> {
        self.conn.execute_batch(
            "DELETE FROM search_index WHERE kind = 'source' AND ref_id IN (
                 SELECT id FROM sources s WHERE origin IS NOT NULL AND EXISTS (
                     SELECT 1 FROM sources n WHERE n.origin = s.origin AND (n.captured_at > s.captured_at OR (n.captured_at = s.captured_at AND n.rowid > s.rowid))));
             DELETE FROM sources WHERE id IN (
                 SELECT id FROM sources s WHERE origin IS NOT NULL AND EXISTS (
                     SELECT 1 FROM sources n WHERE n.origin = s.origin AND (n.captured_at > s.captured_at OR (n.captured_at = s.captured_at AND n.rowid > s.rowid))));",
        )?;
        let ids: Vec<String> = {
            let mut stmt = self.conn.prepare_cached("SELECT id FROM sources")?;
            let rows = stmt.query_map([], |r| r.get(0))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        for id in ids {
            let (_, msgs) = self.get_source(&id)?;
            self.conn.execute("UPDATE sources SET file_count = ?2 WHERE id = ?1", params![id, file_count(&msgs)])?;
        }
        let packs: Vec<(String, bool)> = {
            let mut stmt =
                self.conn.prepare_cached("SELECT id, pinned FROM packs WHERE archived = 0 ORDER BY created_at")?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        for (pid, pinned) in packs {
            let Ok(pack) = self.get_pack(&pid, None) else { continue };
            for sid in self.adopt_pack(&pack)? {
                if pinned {
                    self.conn.execute("UPDATE sources SET pinned = 1 WHERE id = ?1", [&sid])?;
                }
            }
        }
        let orphans: Vec<Attachment> = {
            let mut stmt = self.conn.prepare_cached(
                "SELECT id, file_name, media_type, size, sha256, origin_path, text FROM attachments a
                 WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE instr(m.blocks_json, a.sha256) > 0)
                 ORDER BY created_at",
            )?;
            let rows = stmt.query_map([], Self::attachment_from_row)?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        if !orphans.is_empty() {
            let blocks: Vec<Block> = orphans.iter().map(file_block).collect();
            let source = manual_source("Added files", SourceKind::File);
            let msg = Message {
                id: new_id(),
                source_id: source.source_id.clone(),
                role: Role::User,
                created_at: None,
                blocks,
            };
            self.upsert_session(&source, &[msg], None)?;
        }
        Ok(())
    }
}

fn manual_source(title: &str, kind: SourceKind) -> Source {
    Source {
        source_id: new_id(),
        kind,
        provider: "manual".into(),
        title: title.into(),
        origin: None,
        project: None,
        model: None,
        captured_at: now_rfc3339(),
        capture_status: CaptureStatus::Complete,
        missing_items: vec![],
        omitted: vec![],
    }
}
