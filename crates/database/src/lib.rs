use std::collections::HashMap;
use std::path::{Path, PathBuf};

use hopilo_core::render::estimate_tokens;
use hopilo_core::{new_id, now_rfc3339, Attachment, Block, Message, Pack, Source};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;

pub mod backup;
mod cache;
mod migrations;
mod session_query;
mod sessions;

use sessions::upsert_session_tx;

pub use cache::Transcript;
pub use session_query::{SessionPage, SessionQuery};
pub use sessions::{SessionFile, SessionPatch, SessionRow};

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("database error: {0}")]
    Sql(#[from] rusqlite::Error),
    #[error("serialization error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0} not found")]
    NotFound(String),
}

pub type Result<T> = std::result::Result<T, DbError>;

pub struct Store {
    conn: Connection,
    root: PathBuf,
    cache: std::cell::RefCell<cache::Cache>,
}

fn contains_ascii_ci(haystack: &str, needle: &str) -> bool {
    let nb = needle.as_bytes();
    if nb.is_empty() {
        return true;
    }
    haystack.as_bytes().windows(nb.len()).any(|w| w.eq_ignore_ascii_case(nb))
}

pub(crate) fn tune(conn: &Connection, writable: bool) -> rusqlite::Result<()> {
    conn.create_scalar_function(
        "hopilo_lower",
        1,
        rusqlite::functions::FunctionFlags::SQLITE_UTF8 | rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
        |ctx| Ok(ctx.get::<String>(0)?.to_lowercase()),
    )?;
    conn.create_scalar_function(
        "hopilo_match",
        5,
        rusqlite::functions::FunctionFlags::SQLITE_UTF8 | rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
        |ctx| {
            let needle_raw = ctx.get_raw(0).as_str()?;
            if needle_raw.is_empty() {
                return Ok(true);
            }
            let needle_ascii = needle_raw.is_ascii();
            for i in 1..=4 {
                let raw = ctx.get_raw(i);
                let Ok(s) = raw.as_str() else { continue };
                if s.is_empty() {
                    continue;
                }
                if needle_ascii && s.is_ascii() {
                    if contains_ascii_ci(s, needle_raw) {
                        return Ok(true);
                    }
                } else if s.to_lowercase().contains(needle_raw) {
                    return Ok(true);
                }
            }
            Ok(false)
        },
    )?;
    conn.execute_batch(if writable {
        "PRAGMA synchronous = NORMAL;
         PRAGMA journal_size_limit = 67108864;
         PRAGMA temp_store = MEMORY;
         PRAGMA cache_size = -65536;
         PRAGMA mmap_size = 1073741824;"
    } else {
        "PRAGMA temp_store = MEMORY;
         PRAGMA cache_size = -65536;
         PRAGMA mmap_size = 1073741824;"
    })?;
    conn.set_prepared_statement_cache_capacity(64);
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRow {
    pub id: String,
    pub kind: String,
    pub provider: String,
    pub title: String,
    pub origin: Option<String>,
    pub project: Option<String>,
    pub model: Option<String>,
    pub captured_at: String,
    pub capture_status: String,
    pub message_count: i64,
    pub token_estimate: i64,
    pub missing_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub source_id: String,

    pub duplicate_of: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackRow {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub favorite: bool,
    pub pinned: bool,
    pub archived: bool,
    pub latest_version: i64,
    pub message_count: i64,
    pub token_estimate: i64,
    pub providers: Vec<String>,
    pub attachment_count: i64,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationRow {
    pub from_pack: String,
    pub from_version: Option<i64>,
    pub from_title: Option<String>,
    pub to_pack: String,
    pub to_version: Option<i64>,
    pub to_title: Option<String>,

    pub kind: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditReport {
    pub database: String,
    pub versions_checked: usize,
    pub version_problems: Vec<String>,
    pub attachments_checked: usize,
    pub attachment_problems: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionRow {
    pub version: i64,
    pub created_at: String,
    pub label: Option<String>,
    pub mode: String,
    pub message_count: i64,
    pub token_estimate: i64,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffRow {
    pub id: String,
    pub pack_id: String,
    pub pack_title: Option<String>,
    pub version: i64,
    pub target: String,
    pub method: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub kind: String,
    pub ref_id: String,
    pub title: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub source_count: i64,
    pub pinned_count: i64,
    pub attachment_count: i64,
    pub provider_count: i64,
    pub captures_today: i64,
    pub handoffs_total: i64,
    pub handoffs_today: i64,
    pub last_capture_at: Option<String>,
    pub last_handoff: Option<HandoffRow>,
    pub storage_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityRow {
    pub kind: String,
    pub ref_id: Option<String>,
    pub detail: String,
    pub created_at: String,
}

fn content_hash(messages: &[Message]) -> Result<String> {
    use sha2::{Digest, Sha256};

    let mut h = Sha256::new();
    for m in messages {
        h.update(serde_json::to_vec(&(&m.role, &m.blocks))?);
        h.update([0u8]);
    }
    Ok(hex::encode(h.finalize()))
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum LegacyBlock<'a> {
    Text {
        text: &'a str,
    },
    ToolCall {
        name: &'a str,
        input: &'a str,
    },
    ToolResult {
        #[serde(default)]
        name: Option<&'a str>,
        output: &'a str,
        #[serde(default)]
        is_error: bool,
    },
    Missing {
        description: &'a str,
    },
    #[serde(rename_all = "camelCase")]
    File {
        name: &'a str,
        media_type: &'a str,
        sha256: &'a str,
        size: u64,
    },
}

fn legacy_blocks(blocks: &[Block]) -> Vec<LegacyBlock<'_>> {
    blocks
        .iter()
        .map(|b| match b {
            Block::Text { text } => LegacyBlock::Text { text },
            Block::ToolCall { name, input } => LegacyBlock::ToolCall { name, input },
            Block::ToolResult { name, output, is_error } => {
                LegacyBlock::ToolResult { name: name.as_deref(), output, is_error: *is_error }
            }
            Block::Missing { description } => LegacyBlock::Missing { description },
            Block::File { name, media_type, sha256, size } => {
                LegacyBlock::File { name, media_type, sha256, size: *size }
            }
        })
        .collect()
}

fn legacy_content_hash(messages: &[Message]) -> Result<String> {
    use sha2::{Digest, Sha256};

    let mut h = Sha256::new();
    for m in messages {
        h.update(serde_json::to_vec(&(m.role, legacy_blocks(&m.blocks)))?);
        h.update([0u8]);
    }
    Ok(hex::encode(h.finalize()))
}

fn messages_text(messages: &[Message]) -> String {
    let mut s = String::new();
    for m in messages {
        for b in &m.blocks {
            s.push_str(b.plain_text());
            s.push('\n');
        }
    }
    s
}

fn kebab<T: Serialize>(v: &T) -> String {
    serde_json::to_value(v).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default()
}

fn fts_query(q: &str) -> Option<String> {
    let terms: Vec<String> = q
        .split_whitespace()
        .map(|t| t.replace('"', ""))
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{t}\"*"))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" "))
}

fn prune_backups(root: &Path, keep: i64) {
    let keep_name = format!("hopilo.db.before-v{keep}");
    let Ok(rd) = std::fs::read_dir(root) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with("hopilo.db.before-v") && name != keep_name {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

impl Store {
    pub fn open(root: &Path) -> Result<Self> {
        std::fs::create_dir_all(root.join("attachments"))?;
        let conn = Connection::open(root.join("hopilo.db"))?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        tune(&conn, true)?;

        let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if current > 0 && (current as usize) < migrations::latest() {
            let backup = root.join(format!("hopilo.db.before-v{}", current + 1));
            if !backup.exists() {
                conn.execute("VACUUM INTO ?1", [backup.display().to_string()])?;
            }
        }
        let mut store = Self { conn, root: root.to_path_buf(), cache: Default::default() };
        migrations::run(&mut store.conn)?;
        if current > 0 && current < 3 {
            store.upgrade_to_sessions()?;
        }
        if current > 0 && (current as usize) < migrations::latest() {
            prune_backups(root, current + 1);
        }
        let _ = store.conn.execute_batch("PRAGMA optimize = 0x10002;");
        Ok(store)
    }

    pub fn open_reader(root: &Path) -> Result<Self> {
        use rusqlite::OpenFlags;
        let conn = Connection::open_with_flags(
            root.join("hopilo.db"),
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX | OpenFlags::SQLITE_OPEN_URI,
        )?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        tune(&conn, false)?;
        Ok(Self { conn, root: root.to_path_buf(), cache: Default::default() })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn integrity_check(&self) -> Result<String> {
        Ok(self.conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?)
    }

    pub fn insert_capture(&mut self, source: &Source, messages: &[Message]) -> Result<ImportOutcome> {
        self.upsert_session(source, messages, None)
    }

    pub fn insert_capture_with_attachments(
        &mut self,
        source: &Source,
        messages: &[Message],
        files: &[(Attachment, Vec<u8>)],
    ) -> Result<ImportOutcome> {
        let mut validated = Vec::with_capacity(files.len());
        for (att, bytes) in files {
            validated.push((validate_attachment_bytes(att, bytes)?, bytes.as_slice()));
        }
        let mut written_blobs = Vec::new();
        for (att, bytes) in &validated {
            let path = self.blob_path(&att.sha256);
            if !path.exists() {
                let tmp = tempfile::NamedTempFile::new_in(self.root.join("attachments"))?;
                std::fs::write(tmp.path(), bytes)?;
                match tmp.persist_noclobber(&path) {
                    Ok(_) => written_blobs.push((att.sha256.clone(), path)),
                    Err(e) if e.error.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(e) => {
                        for (_, p) in written_blobs {
                            let _ = std::fs::remove_file(p);
                        }
                        return Err(DbError::Io(e.error));
                    }
                }
            }
        }
        let res = (|| -> Result<ImportOutcome> {
            let tx = self.conn.transaction()?;
            for (att, _) in &validated {
                insert_attachment_tx(&tx, att)?;
            }
            let outcome = upsert_session_tx(&tx, source, messages, None, None, true)?;
            tx.commit()?;
            Ok(outcome)
        })();
        if let Err(e) = res {
            for (sha, p) in written_blobs {
                let referenced = self.attachment_by_sha(&sha).map(|a| a.is_some()).unwrap_or(true);
                if !referenced {
                    let _ = std::fs::remove_file(p);
                }
            }
            return Err(e);
        }
        Ok(res.unwrap())
    }

    pub fn list_sources(&self) -> Result<Vec<SourceRow>> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT id, kind, provider, title, origin, project, model, captured_at, capture_status,
                    message_count, token_estimate, missing_count
             FROM sources ORDER BY captured_at DESC, rowid DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(SourceRow {
                id: r.get(0)?,
                kind: r.get(1)?,
                provider: r.get(2)?,
                title: r.get(3)?,
                origin: r.get(4)?,
                project: r.get(5)?,
                model: r.get(6)?,
                captured_at: r.get(7)?,
                capture_status: r.get(8)?,
                message_count: r.get(9)?,
                token_estimate: r.get(10)?,
                missing_count: r.get(11)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn imported_origins(&self) -> Result<HashMap<String, (String, String)>> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT origin, id, captured_at FROM sources WHERE origin IS NOT NULL ORDER BY captured_at ASC",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?))))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn get_source(&self, id: &str) -> Result<(Source, Vec<Message>)> {
        Ok((*self.get_source_shared(id)?).clone())
    }

    pub fn get_source_shared(&self, id: &str) -> Result<Transcript> {
        let now = cache::stamp(&self.conn);
        if let Some(hit) = cache::Cache::source(&self.cache, now, id) {
            return Ok(hit);
        }
        let loaded = std::sync::Arc::new(self.load_source(id)?);
        cache::Cache::put_source(&self.cache, now, id, loaded.clone());
        Ok(loaded)
    }

    fn load_source(&self, id: &str) -> Result<(Source, Vec<Message>)> {
        let (json, title, captured_at): (String, String, String) = self
            .conn
            .query_row("SELECT source_json, title, captured_at FROM sources WHERE id = ?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .optional()?
            .ok_or_else(|| DbError::NotFound(format!("source {id}")))?;
        let mut source: Source = serde_json::from_str(&json)?;
        source.title = title;
        source.captured_at = captured_at;
        let mut stmt = self.conn.prepare_cached(
            "SELECT id, role, created_at, blocks_json FROM messages WHERE source_id = ?1 ORDER BY ordinal",
        )?;
        let rows = stmt.query_map([id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, String>(3)?))
        })?;
        let mut messages = Vec::new();
        for row in rows {
            let (mid, role, created_at, blocks) = row?;
            messages.push(Message {
                id: mid,
                source_id: id.to_string(),
                role: serde_json::from_value(serde_json::Value::String(role))?,
                created_at,
                blocks: serde_json::from_str(&blocks)?,
            });
        }
        Ok((source, messages))
    }

    pub fn delete_source(&mut self, id: &str) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM sources WHERE id = ?1", [id])?;
        delete_search_index(&tx, "source", id)?;
        event(&tx, "delete", Some(id), "Deleted capture")?;
        tx.commit()?;
        Ok(())
    }

    fn blob_path(&self, sha: &str) -> PathBuf {
        self.root.join("attachments").join(sha)
    }

    pub fn insert_attachment(&mut self, att: &Attachment, bytes: &[u8]) -> Result<(Attachment, bool)> {
        let att = validate_attachment_bytes(att, bytes)?;
        if let Some(existing) = self.attachment_by_sha(&att.sha256)? {
            return Ok((existing, true));
        }
        let path = self.blob_path(&att.sha256);
        let mut created = false;
        if !path.exists() {
            let tmp = tempfile::NamedTempFile::new_in(self.root.join("attachments"))?;
            std::fs::write(tmp.path(), bytes)?;
            match tmp.persist_noclobber(&path) {
                Ok(_) => created = true,
                Err(e) if e.error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(e) => return Err(DbError::Io(e.error)),
            }
        }
        let result = (|| -> Result<(Attachment, bool)> {
            let tx = self.conn.transaction()?;
            let out = insert_attachment_tx(&tx, &att)?;
            tx.commit()?;
            Ok(out)
        })();
        if let Err(e) = result {
            if created {
                let referenced = self.attachment_by_sha(&att.sha256).map(|a| a.is_some()).unwrap_or(true);
                if !referenced {
                    let _ = std::fs::remove_file(&path);
                }
            }
            return Err(e);
        }
        result
    }

    fn attachment_from_row(r: &rusqlite::Row) -> rusqlite::Result<Attachment> {
        Ok(Attachment {
            id: r.get(0)?,
            file_name: r.get(1)?,
            media_type: r.get(2)?,
            size: r.get::<_, i64>(3)? as u64,
            sha256: r.get(4)?,
            origin_path: r.get(5)?,
            text: r.get(6)?,
        })
    }

    pub fn attachment_by_sha(&self, sha: &str) -> Result<Option<Attachment>> {
        let lower;
        let key = if sha.bytes().any(|b| b.is_ascii_uppercase()) {
            lower = sha.to_ascii_lowercase();
            lower.as_str()
        } else {
            sha
        };
        Ok(self
            .conn
            .query_row(
                "SELECT id, file_name, media_type, size, sha256, origin_path, text FROM attachments WHERE sha256 = ?1",
                [key],
                Self::attachment_from_row,
            )
            .optional()?)
    }

    pub fn has_sha(&self, sha: &str) -> Result<bool> {
        Ok(self.attachment_by_sha(sha)?.is_some())
    }

    pub fn list_attachments(&self) -> Result<Vec<Attachment>> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT id, file_name, media_type, size, sha256, origin_path, text FROM attachments ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], Self::attachment_from_row)?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn get_attachment(&self, id: &str) -> Result<Attachment> {
        self.conn
            .query_row(
                "SELECT id, file_name, media_type, size, sha256, origin_path, text FROM attachments WHERE id = ?1",
                [id],
                Self::attachment_from_row,
            )
            .optional()?
            .ok_or_else(|| DbError::NotFound(format!("attachment {id}")))
    }

    pub fn attachment_bytes(&self, sha: &str) -> Option<Vec<u8>> {
        std::fs::read(self.attachment_blob_path(sha)?).ok()
    }

    pub fn attachment_blob_path(&self, sha: &str) -> Option<PathBuf> {
        if sha.len() != 64 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        let lower;
        let key = if sha.bytes().any(|b| b.is_ascii_uppercase()) {
            lower = sha.to_ascii_lowercase();
            lower.as_str()
        } else {
            sha
        };
        Some(self.blob_path(key))
    }

    pub fn delete_attachment(&mut self, id: &str) -> Result<()> {
        let att = self.get_attachment(id)?;
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM attachments WHERE id = ?1", [id])?;
        delete_search_index(&tx, "attachment", id)?;
        tx.commit()?;

        let sha_lower = att.sha256.to_ascii_lowercase();
        let still_used: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM source_files WHERE sha256 = ?1)
                 OR EXISTS(SELECT 1 FROM pack_files WHERE sha256 = ?1)
                 OR EXISTS(SELECT 1 FROM attachments WHERE sha256 = ?1)",
            [&sha_lower],
            |r| r.get(0),
        )?;
        if !still_used {
            let _ = std::fs::remove_file(self.blob_path(&sha_lower));
        }
        Ok(())
    }

    pub fn create_pack(&mut self, mut pack: Pack, label: Option<&str>) -> Result<Pack> {
        pack.pack_id = new_id();
        pack.version = 1;
        let now = now_rfc3339();
        pack.created_at = now.clone();
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO packs (id, title, created_at, updated_at, latest_version) VALUES (?1, ?2, ?3, ?3, 1)",
            params![pack.pack_id, pack.title, now],
        )?;
        insert_version(&tx, &mut pack, label)?;
        event(&tx, "pack", Some(&pack.pack_id), &format!("Built {} v1", pack.title))?;
        tx.commit()?;
        Ok(pack)
    }

    pub fn add_version(&mut self, pack_id: &str, mut pack: Pack, label: Option<&str>) -> Result<Pack> {
        let tx = self.conn.transaction()?;
        let latest: i64 = tx
            .query_row("SELECT latest_version FROM packs WHERE id = ?1", [pack_id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| DbError::NotFound(format!("pack {pack_id}")))?;
        pack.pack_id = pack_id.to_string();
        pack.version = latest as u32 + 1;
        pack.created_at = now_rfc3339();
        insert_version(&tx, &mut pack, label)?;
        tx.execute(
            "UPDATE packs SET latest_version = ?2, updated_at = ?3, title = ?4 WHERE id = ?1",
            params![pack_id, pack.version, pack.created_at, pack.title],
        )?;
        event(&tx, "pack", Some(pack_id), &format!("Saved {} v{}", pack.title, pack.version))?;
        tx.commit()?;
        Ok(pack)
    }

    pub fn list_packs(&self) -> Result<Vec<PackRow>> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT p.id, p.title, p.created_at, p.updated_at, p.favorite, p.pinned, p.archived, p.latest_version,
                    v.message_count, v.token_estimate, v.providers, v.attachment_count, p.tags
             FROM packs p JOIN pack_versions v ON v.pack_id = p.id AND v.version = p.latest_version
             ORDER BY p.pinned DESC, p.updated_at DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            let providers: String = r.get(10)?;
            Ok(PackRow {
                id: r.get(0)?,
                title: r.get(1)?,
                created_at: r.get(2)?,
                updated_at: r.get(3)?,
                favorite: r.get(4)?,
                pinned: r.get(5)?,
                archived: r.get(6)?,
                latest_version: r.get(7)?,
                message_count: r.get(8)?,
                token_estimate: r.get(9)?,
                providers: providers.split(',').filter(|s| !s.is_empty()).map(str::to_string).collect(),
                attachment_count: r.get(11)?,
                tags: serde_json::from_str(&r.get::<_, String>(12)?).unwrap_or_default(),
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn list_versions(&self, pack_id: &str) -> Result<Vec<VersionRow>> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT version, created_at, label, mode, message_count, token_estimate, content_hash
             FROM pack_versions WHERE pack_id = ?1 ORDER BY version DESC",
        )?;
        let rows = stmt.query_map([pack_id], |r| {
            Ok(VersionRow {
                version: r.get(0)?,
                created_at: r.get(1)?,
                label: r.get(2)?,
                mode: r.get(3)?,
                message_count: r.get(4)?,
                token_estimate: r.get(5)?,
                content_hash: r.get(6)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn get_pack(&self, pack_id: &str, version: Option<u32>) -> Result<Pack> {
        let (title, latest): (String, i64) = self
            .conn
            .query_row("SELECT title, latest_version FROM packs WHERE id = ?1", [pack_id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()?
            .ok_or_else(|| DbError::NotFound(format!("pack {pack_id}")))?;
        let v = version.map(i64::from).unwrap_or(latest);
        let json: String = self
            .conn
            .query_row(
                "SELECT snapshot_json FROM pack_versions WHERE pack_id = ?1 AND version = ?2",
                params![pack_id, v],
                |r| r.get(0),
            )
            .optional()?
            .ok_or_else(|| DbError::NotFound(format!("pack {pack_id} v{v}")))?;
        let mut pack: Pack = serde_json::from_str(&json)?;
        pack.title = title;
        Ok(pack)
    }

    pub fn update_pack(
        &mut self,
        pack_id: &str,
        title: Option<&str>,
        favorite: Option<bool>,
        pinned: Option<bool>,
        archived: Option<bool>,
    ) -> Result<()> {
        let tx = self.conn.transaction()?;
        let n = tx.execute(
            "UPDATE packs SET title = COALESCE(?2, title), favorite = COALESCE(?3, favorite),
                pinned = COALESCE(?4, pinned), archived = COALESCE(?5, archived) WHERE id = ?1",
            params![pack_id, title, favorite, pinned, archived],
        )?;
        if n == 0 {
            return Err(DbError::NotFound(format!("pack {pack_id}")));
        }
        if let Some(t) = title {
            update_search_index_title(&tx, "pack", pack_id, t)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn delete_pack(&mut self, pack_id: &str) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM packs WHERE id = ?1", [pack_id])?;
        delete_search_index(&tx, "pack", pack_id)?;
        event(&tx, "delete", Some(pack_id), "Deleted pack")?;
        tx.commit()?;
        Ok(())
    }

    pub fn duplicate_pack(&mut self, pack_id: &str) -> Result<Pack> {
        let mut pack = self.get_pack(pack_id, None)?;
        let from_version = pack.version;
        pack.title = format!("{} (copy)", pack.title);
        pack.pack_id = new_id();
        pack.version = 1;
        let now = now_rfc3339();
        pack.created_at = now.clone();
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO packs (id, title, created_at, updated_at, latest_version) VALUES (?1, ?2, ?3, ?3, 1)",
            params![pack.pack_id, pack.title, now],
        )?;
        insert_version(&tx, &mut pack, Some("Duplicated"))?;
        event(&tx, "pack", Some(&pack.pack_id), &format!("Built {} v1", pack.title))?;
        tx.execute(
            "INSERT INTO pack_relations (from_pack, from_version, to_pack, to_version, kind, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![pack_id, from_version, &pack.pack_id, Some(1_u32), "duplicated", now_rfc3339()],
        )?;
        tx.commit()?;
        Ok(pack)
    }

    pub fn add_relation(
        &mut self,
        from: &str,
        from_v: Option<u32>,
        to: &str,
        to_v: Option<u32>,
        kind: &str,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO pack_relations (from_pack, from_version, to_pack, to_version, kind, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![from, from_v, to, to_v, kind, now_rfc3339()],
        )?;
        Ok(())
    }

    pub fn relations(&self, pack_id: Option<&str>) -> Result<Vec<RelationRow>> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT r.from_pack, r.from_version, a.title, r.to_pack, r.to_version, b.title, r.kind, r.created_at
             FROM pack_relations r LEFT JOIN packs a ON a.id = r.from_pack LEFT JOIN packs b ON b.id = r.to_pack
             WHERE ?1 IS NULL OR r.from_pack = ?1 OR r.to_pack = ?1 ORDER BY r.id",
        )?;
        let rows = stmt.query_map([pack_id], |r| {
            Ok(RelationRow {
                from_pack: r.get(0)?,
                from_version: r.get(1)?,
                from_title: r.get(2)?,
                to_pack: r.get(3)?,
                to_version: r.get(4)?,
                to_title: r.get(5)?,
                kind: r.get(6)?,
                created_at: r.get(7)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn set_tags(&mut self, pack_id: &str, tags: &[String]) -> Result<()> {
        let mut clean: Vec<String> =
            tags.iter().map(|t| t.trim().to_lowercase()).filter(|t| !t.is_empty() && t.len() <= 40).collect();
        clean.sort();
        clean.dedup();
        let n = self
            .conn
            .execute("UPDATE packs SET tags = ?2 WHERE id = ?1", params![pack_id, serde_json::to_string(&clean)?])?;
        if n == 0 {
            return Err(DbError::NotFound(format!("pack {pack_id}")));
        }
        Ok(())
    }

    pub fn audit(&self) -> Result<AuditReport> {
        let database: String = self.conn.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        let mut report = AuditReport { database, ..Default::default() };
        let mut stmt =
            self.conn.prepare_cached("SELECT pack_id, version, snapshot_json, content_hash FROM pack_versions")?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?))
        })?;
        for row in rows {
            let (pid, v, json, hash) = row?;
            report.versions_checked += 1;
            match serde_json::from_str::<Pack>(&json) {
                Ok(p) => {
                    let current = content_hash(&p.messages)?;
                    if current != hash && legacy_content_hash(&p.messages)? != hash {
                        report
                            .version_problems
                            .push(format!("{} v{v}: content does not match its recorded hash", p.title));
                    }
                }
                Err(_) => report.version_problems.push(format!("pack {pid} v{v}: snapshot is unreadable")),
            }
        }
        let attachments: Vec<(String, String)> = {
            let mut stmt =
                self.conn.prepare_cached("SELECT file_name, sha256 FROM attachments ORDER BY created_at DESC")?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        for (file_name, sha) in attachments {
            report.attachments_checked += 1;
            let Some(path) = self.attachment_blob_path(&sha) else {
                report.attachment_problems.push(format!("{file_name}: invalid stored checksum"));
                continue;
            };
            match sha256_file(&path) {
                None => report.attachment_problems.push(format!("{file_name}: stored file is missing")),
                Some(actual) => {
                    if !actual.eq_ignore_ascii_case(&sha) {
                        report.attachment_problems.push(format!("{file_name}: stored file was changed or damaged"));
                    }
                }
            }
        }
        Ok(report)
    }

    pub fn record_handoff(
        &mut self,
        pack_id: &str,
        version: u32,
        target: &str,
        method: &str,
        status: &str,
    ) -> Result<String> {
        let id = new_id();
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO handoffs (id, pack_id, version, target, method, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, pack_id, version, target, method, status, now_rfc3339()],
        )?;
        event(&tx, "handoff", Some(pack_id), &format!("{status} via {method} for {target}"))?;
        tx.commit()?;
        Ok(id)
    }

    pub fn list_handoffs(&self, limit: i64) -> Result<Vec<HandoffRow>> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT h.id, h.pack_id, COALESCE(p.title, s.title), h.version, h.target, h.method, h.status, h.created_at
             FROM handoffs h LEFT JOIN packs p ON p.id = h.pack_id LEFT JOIN sources s ON s.id = h.pack_id
             ORDER BY h.created_at DESC, h.rowid DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map([limit], |r| {
            Ok(HandoffRow {
                id: r.get(0)?,
                pack_id: r.get(1)?,
                pack_title: r.get(2)?,
                version: r.get(3)?,
                target: r.get(4)?,
                method: r.get(5)?,
                status: r.get(6)?,
                created_at: r.get(7)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn recent_activity(&self, limit: i64) -> Result<Vec<ActivityRow>> {
        let mut stmt = self
            .conn
            .prepare_cached("SELECT kind, ref_id, detail, created_at FROM activity_events ORDER BY id DESC LIMIT ?1")?;
        let rows = stmt.query_map([limit], |r| {
            Ok(ActivityRow { kind: r.get(0)?, ref_id: r.get(1)?, detail: r.get(2)?, created_at: r.get(3)? })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn settings(&self) -> Result<HashMap<String, serde_json::Value>> {
        let mut stmt = self.conn.prepare_cached("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut out = HashMap::new();
        for row in rows {
            let (k, v) = row?;
            out.insert(k, serde_json::from_str(&v)?);
        }
        Ok(out)
    }

    pub fn set_setting(&mut self, key: &str, value: &serde_json::Value) -> Result<()> {
        self.conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, serde_json::to_string(value)?],
        )?;
        Ok(())
    }

    pub fn remove_setting(&mut self, key: &str) -> Result<()> {
        self.conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
        Ok(())
    }

    pub fn search(&self, q: &str, limit: i64) -> Result<Vec<SearchHit>> {
        let Some(query) = fts_query(q) else { return Ok(vec![]) };
        let mut stmt = self.conn.prepare_cached(
            "SELECT kind, ref_id, title, snippet(search_index, 3, '[', ']', '…', 12)
             FROM search_index WHERE search_index MATCH ?1 ORDER BY rank LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![query, limit], |r| {
            Ok(SearchHit { kind: r.get(0)?, ref_id: r.get(1)?, title: r.get(2)?, snippet: r.get(3)? })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn search_kind(&self, q: &str, kind: &str, limit: i64) -> Result<Vec<SearchHit>> {
        let Some(query) = fts_query(q) else { return Ok(vec![]) };
        let mut stmt = self.conn.prepare_cached(
            "SELECT kind, ref_id, title, snippet(search_index, 3, '[', ']', '…', 12)
             FROM search_index WHERE search_index MATCH ?1 AND kind = ?2 ORDER BY rank LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![query, kind, limit], |r| {
            Ok(SearchHit { kind: r.get(0)?, ref_id: r.get(1)?, title: r.get(2)?, snippet: r.get(3)? })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn stats(&self) -> Result<Stats> {
        let (today, tomorrow) = local_day_bounds(chrono::Local::now());
        let (source_count, pinned_count, provider_count, last_capture_at): (i64, i64, i64, Option<String>) =
            self.conn.query_row(
                "SELECT
                    COUNT(*),
                    COALESCE(SUM(pinned), 0),
                    COUNT(DISTINCT provider),
                    MAX(captured_at)
                 FROM sources WHERE hidden = 0",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )?;
        let captures_today: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM sources WHERE captured_at >= ?1 AND captured_at < ?2",
            [&today, &tomorrow],
            |r| r.get(0),
        )?;
        let (attachment_count, blob_bytes, handoffs_total): (i64, i64, i64) = self.conn.query_row(
            "SELECT
                (SELECT COUNT(*) FROM attachments),
                (SELECT COALESCE(SUM(size), 0) FROM attachments),
                (SELECT COUNT(*) FROM handoffs)",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        let handoffs_today: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM handoffs WHERE created_at >= ?1 AND created_at < ?2",
            [&today, &tomorrow],
            |r| r.get(0),
        )?;
        let db_bytes = std::fs::metadata(self.root.join("hopilo.db")).map(|m| m.len()).unwrap_or(0)
            + std::fs::metadata(self.root.join("hopilo.db-wal")).map(|m| m.len()).unwrap_or(0);
        let storage_bytes = blob_bytes.max(0) as u64 + db_bytes;
        Ok(Stats {
            source_count,
            pinned_count,
            attachment_count,
            provider_count,
            captures_today,
            handoffs_total,
            handoffs_today,
            last_capture_at,
            last_handoff: self.list_handoffs(1)?.into_iter().next(),
            storage_bytes,
        })
    }

    pub fn wipe(&mut self) -> Result<()> {
        let tx = self.conn.transaction()?;
        for t in [
            "manual_file_messages",
            "source_files",
            "messages",
            "sources",
            "pack_files",
            "pack_versions",
            "pack_version_sources",
            "pack_relations",
            "packs",
            "handoffs",
            "attachments",
            "activity_events",
            "search_index_map",
            "search_index",
        ] {
            tx.execute(&format!("DELETE FROM {t}"), [])?;
        }
        tx.commit()?;
        self.cache = Default::default();
        let _ = self.conn.pragma_update(None, "wal_checkpoint", "TRUNCATE");
        let dir = self.root.join("attachments");
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let _ = std::fs::remove_file(e.path());
            }
        }
        Ok(())
    }
}

fn local_day_bounds<Tz: chrono::TimeZone>(now: chrono::DateTime<Tz>) -> (String, String) {
    let tz = now.timezone();
    let date = now.date_naive();
    let start = |d: chrono::NaiveDate| {
        let midnight = d.and_hms_opt(0, 0, 0).unwrap_or_default();
        tz.from_local_datetime(&midnight)
            .earliest()
            .map(|t| t.with_timezone(&chrono::Utc))
            .unwrap_or_else(|| midnight.and_utc())
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
    };
    (start(date), start(date.succ_opt().unwrap_or(date)))
}

fn validate_attachment_bytes(att: &Attachment, bytes: &[u8]) -> Result<Attachment> {
    use sha2::{Digest, Sha256};
    if att.size != bytes.len() as u64
        || att.sha256.len() != 64
        || !att.sha256.bytes().all(|b| b.is_ascii_hexdigit())
        || !hex::encode(Sha256::digest(bytes)).eq_ignore_ascii_case(&att.sha256)
    {
        return Err(DbError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("{}: contents do not match the recorded checksum or size", att.file_name),
        )));
    }
    Ok(if att.sha256.bytes().any(|b| b.is_ascii_uppercase()) {
        Attachment { sha256: att.sha256.to_ascii_lowercase(), ..att.clone() }
    } else {
        att.clone()
    })
}

fn insert_attachment_tx(tx: &Transaction, att: &Attachment) -> Result<(Attachment, bool)> {
    if let Some(existing) = tx
        .query_row(
            "SELECT id, file_name, media_type, size, sha256, origin_path, text FROM attachments WHERE sha256 = ?1",
            [&att.sha256],
            Store::attachment_from_row,
        )
        .optional()?
    {
        return Ok((existing, true));
    }
    tx.execute(
        "INSERT INTO attachments (id, file_name, media_type, size, sha256, origin_path, text, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            att.id,
            att.file_name,
            att.media_type,
            att.size as i64,
            att.sha256,
            att.origin_path,
            att.text,
            now_rfc3339()
        ],
    )?;
    index(tx, "attachment", &att.id, &att.file_name, att.text.as_deref().unwrap_or(""))?;
    event(tx, "attachment", Some(&att.id), &format!("Added file {}", att.file_name))?;
    Ok((att.clone(), false))
}

fn sha256_file(path: &Path) -> Option<String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = std::fs::File::open(path).ok()?;
    let mut h = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Some(hex::encode(h.finalize()))
}

fn insert_version(tx: &Transaction, pack: &mut Pack, label: Option<&str>) -> Result<()> {
    let hash = content_hash(&pack.messages)?;
    pack.integrity.content_hash = Some(hash.clone());
    let text = messages_text(&pack.messages);
    let mut providers: Vec<&str> = pack.sources.iter().map(|s| s.provider.as_str()).collect();
    providers.sort();
    providers.dedup();
    tx.execute(
        "INSERT INTO pack_versions (pack_id, version, created_at, label, mode, snapshot_json, content_hash,
            message_count, token_estimate, providers, attachment_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            pack.pack_id,
            pack.version,
            pack.created_at,
            label,
            kebab(&pack.mode),
            serde_json::to_string(&pack)?,
            hash,
            pack.messages.len() as i64,
            estimate_tokens(&text) as i64,
            providers.join(","),
            pack.attachments.len() as i64,
        ],
    )?;
    for s in &pack.sources {
        tx.execute(
            "INSERT OR IGNORE INTO pack_version_sources (pack_id, version, source_id) VALUES (?1, ?2, ?3)",
            params![pack.pack_id, pack.version, s.source_id],
        )?;
    }
    let mut shas = std::collections::HashSet::new();
    for a in &pack.attachments {
        if !a.sha256.is_empty() {
            shas.insert(a.sha256.to_ascii_lowercase());
        }
    }
    for m in &pack.messages {
        for b in &m.blocks {
            if let Block::File { sha256, .. } = b {
                if !sha256.is_empty() {
                    shas.insert(sha256.to_ascii_lowercase());
                }
            }
        }
    }
    for sha in shas {
        tx.execute(
            "INSERT OR IGNORE INTO pack_files (pack_id, version, sha256) VALUES (?1, ?2, ?3)",
            params![pack.pack_id, pack.version, sha],
        )?;
    }
    delete_search_index(tx, "pack", &pack.pack_id)?;
    let body = format!("{}\n{}", pack.context.note.as_deref().unwrap_or(""), text);
    index(tx, "pack", &pack.pack_id, &pack.title, &body)?;
    Ok(())
}

pub(crate) fn delete_search_index(tx: &Transaction, kind: &str, id: &str) -> Result<()> {
    let fts_rowid: Option<i64> = tx
        .query_row("SELECT fts_rowid FROM search_index_map WHERE kind = ?1 AND ref_id = ?2", params![kind, id], |r| {
            r.get(0)
        })
        .optional()?;
    match fts_rowid {
        Some(rowid) => {
            tx.execute("DELETE FROM search_index WHERE rowid = ?1", [rowid])?;
            tx.execute("DELETE FROM search_index_map WHERE kind = ?1 AND ref_id = ?2", params![kind, id])?;
        }
        None => {
            tx.execute("DELETE FROM search_index WHERE kind = ?1 AND ref_id = ?2", params![kind, id])?;
        }
    }
    Ok(())
}

pub(crate) fn update_search_index_title(tx: &Transaction, kind: &str, id: &str, title: &str) -> Result<()> {
    let fts_rowid: Option<i64> = tx
        .query_row("SELECT fts_rowid FROM search_index_map WHERE kind = ?1 AND ref_id = ?2", params![kind, id], |r| {
            r.get(0)
        })
        .optional()?;
    match fts_rowid {
        Some(rowid) => {
            tx.execute("UPDATE search_index SET title = ?2 WHERE rowid = ?1", params![rowid, title])?;
        }
        None => {
            tx.execute("UPDATE search_index SET title = ?3 WHERE kind = ?1 AND ref_id = ?2", params![kind, id, title])?;
        }
    }
    Ok(())
}

fn index(tx: &Transaction, kind: &str, id: &str, title: &str, body: &str) -> Result<()> {
    tx.execute(
        "INSERT INTO search_index (kind, ref_id, title, body) VALUES (?1, ?2, ?3, ?4)",
        params![kind, id, title, body],
    )?;
    let rowid = tx.last_insert_rowid();
    tx.execute(
        "INSERT OR REPLACE INTO search_index_map (kind, ref_id, fts_rowid) VALUES (?1, ?2, ?3)",
        params![kind, id, rowid],
    )?;
    Ok(())
}

fn event(tx: &Transaction, kind: &str, ref_id: Option<&str>, detail: &str) -> Result<()> {
    tx.execute(
        "INSERT INTO activity_events (kind, ref_id, detail, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![kind, ref_id, detail, now_rfc3339()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests;
