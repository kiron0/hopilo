use rusqlite::Connection;

const MIGRATIONS: &[&str] = &[

    r#"
    CREATE TABLE sources (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        provider TEXT NOT NULL,
        title TEXT NOT NULL,
        origin TEXT,
        project TEXT,
        model TEXT,
        captured_at TEXT NOT NULL,
        capture_status TEXT NOT NULL,
        source_json TEXT NOT NULL,
        message_count INTEGER NOT NULL,
        token_estimate INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        missing_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX sources_origin ON sources(origin);

    CREATE TABLE messages (
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        id TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT,
        blocks_json TEXT NOT NULL,
        PRIMARY KEY (source_id, ordinal)
    );

    CREATE TABLE attachments (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        media_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        sha256 TEXT NOT NULL UNIQUE,
        origin_path TEXT,
        text TEXT,
        created_at TEXT NOT NULL
    );

    CREATE TABLE packs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        favorite INTEGER NOT NULL DEFAULT 0,
        pinned INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        latest_version INTEGER NOT NULL
    );

    CREATE TABLE pack_versions (
        pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        label TEXT,
        mode TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        message_count INTEGER NOT NULL,
        token_estimate INTEGER NOT NULL,
        providers TEXT NOT NULL DEFAULT '',
        attachment_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (pack_id, version)
    );

    -- Provenance link only: a source may be deleted while snapshots keep a copy.
    CREATE TABLE pack_version_sources (
        pack_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        source_id TEXT NOT NULL,
        PRIMARY KEY (pack_id, version, source_id),
        FOREIGN KEY (pack_id, version) REFERENCES pack_versions(pack_id, version) ON DELETE CASCADE
    );

    CREATE TABLE handoffs (
        id TEXT PRIMARY KEY,
        pack_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        target TEXT NOT NULL,
        method TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
    );

    CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE TABLE activity_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        ref_id TEXT,
        detail TEXT NOT NULL,
        created_at TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE search_index USING fts5(
        kind UNINDEXED, ref_id UNINDEXED, title, body, tokenize = 'unicode61'
    );
    "#,

    r#"
    CREATE TABLE pack_relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_pack TEXT NOT NULL,
        from_version INTEGER,
        to_pack TEXT NOT NULL,
        to_version INTEGER,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX pack_relations_from ON pack_relations(from_pack);
    CREATE INDEX pack_relations_to ON pack_relations(to_pack);
    ALTER TABLE packs ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
    "#,

    r#"
    ALTER TABLE sources ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE sources ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE sources ADD COLUMN file_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE sources ADD COLUMN updated_at TEXT;
    ALTER TABLE sources ADD COLUMN last_copied_at TEXT;
    ALTER TABLE sources ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
    UPDATE sources SET updated_at = captured_at;
    "#,

    r#"
    ALTER TABLE sources ADD COLUMN title_edited INTEGER NOT NULL DEFAULT 0;
    "#,

    r#"
    ALTER TABLE sources ADD COLUMN reply_count INTEGER NOT NULL DEFAULT 0;
    UPDATE sources SET reply_count = (
        SELECT COUNT(*) FROM messages m WHERE m.source_id = sources.id AND m.role <> 'user'
    );
    CREATE INDEX sources_list ON sources(hidden, pinned, COALESCE(updated_at, captured_at));
    CREATE INDEX sources_captured ON sources(captured_at);
    CREATE INDEX attachments_created ON attachments(created_at);
    CREATE INDEX packs_list ON packs(pinned, updated_at);
    CREATE INDEX handoffs_created ON handoffs(created_at);
    ANALYZE;
    "#,
];

pub fn latest() -> usize {
    MIGRATIONS.len()
}

pub fn run(conn: &mut Connection) -> rusqlite::Result<()> {
    let current: usize = conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? as usize;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}
