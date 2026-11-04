use super::*;
use hopilo_core::*;

fn capture(origin: &str, text: &str) -> (Source, Vec<Message>) {
    let sid = new_id();
    let source = Source {
        source_id: sid.clone(),
        kind: SourceKind::LocalAgent,
        provider: "claude-code".into(),
        title: "Auth migration".into(),
        origin: Some(origin.into()),
        project: None,
        model: None,
        captured_at: now_rfc3339(),
        capture_status: CaptureStatus::Complete,
        missing_items: vec![],
        omitted: vec![],
    };
    let msgs = vec![Message {
        id: "m1".into(),
        source_id: sid,
        role: Role::User,
        created_at: None,
        blocks: vec![Block::text(text)],
    }];
    (source, msgs)
}

fn pack_from(source: Source, messages: Vec<Message>) -> Pack {
    Pack {
        schema_version: SCHEMA_VERSION.into(),
        pack_id: String::new(),
        title: "Project X — Auth Migration".into(),
        version: 0,
        created_at: String::new(),
        mode: Mode::Full,
        sources: vec![source],
        messages,
        context: ContextBrief::default(),
        attachments: vec![],
        tags: vec![],
        integrity: Integrity::default(),
    }
}

#[test]
fn capture_round_trip_and_duplicate_detection() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let (s, m) = capture("/a.jsonl", "migrate sessions table to uuid keys");
    let first = db.insert_capture(&s, &m).unwrap();
    assert!(first.duplicate_of.is_none());

    let (s2, m2) = capture("/a.jsonl", "migrate sessions table to uuid keys");
    let again = db.insert_capture(&s2, &m2).unwrap();
    assert_eq!(again.duplicate_of.as_deref(), Some(first.source_id.as_str()));

    let (back, msgs) = db.get_source(&first.source_id).unwrap();
    assert_eq!(back, s);
    assert_eq!(msgs, m);
    assert_eq!(db.list_sources().unwrap().len(), 1);

    let hits = db.search("uuid", 10).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].kind, "source");
}

#[test]
fn versions_are_immutable_and_append_only() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let (s, m) = capture("/b.jsonl", "v1 text");
    let v1 = db.create_pack(pack_from(s.clone(), m.clone()), None).unwrap();
    assert_eq!(v1.version, 1);

    let mut next = pack_from(s, m);
    next.messages[0].blocks = vec![Block::text("v2 text")];
    let v2 = db.add_version(&v1.pack_id, next, Some("edited")).unwrap();
    assert_eq!(v2.version, 2);

    let old = db.get_pack(&v1.pack_id, Some(1)).unwrap();
    let v3 = db.add_version(&v1.pack_id, old, Some("Rollback to v1")).unwrap();
    assert_eq!(v3.version, 3);

    assert_eq!(db.get_pack(&v1.pack_id, Some(1)).unwrap().messages, v1.messages);
    assert_eq!(db.get_pack(&v1.pack_id, Some(2)).unwrap().messages[0].blocks[0].plain_text(), "v2 text");
    assert_eq!(db.list_versions(&v1.pack_id).unwrap().len(), 3);

    db.update_pack(&v1.pack_id, Some("Renamed"), Some(true), None, None).unwrap();
    let rows = db.list_packs().unwrap();
    assert_eq!(rows[0].title, "Renamed");
    assert!(rows[0].favorite);
    assert_eq!(rows[0].latest_version, 3);
    assert_eq!(db.get_pack(&v1.pack_id, Some(1)).unwrap().title, "Renamed");

    let dup = db.duplicate_pack(&v1.pack_id).unwrap();
    assert_eq!(dup.version, 1);
    assert_eq!(db.list_packs().unwrap().len(), 2);

    db.delete_pack(&v1.pack_id).unwrap();
    assert!(db.list_versions(&v1.pack_id).unwrap().is_empty());
}

#[test]
fn attachments_are_content_addressed() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let bytes = b"hello";
    let att = Attachment {
        id: new_id(),
        file_name: "notes.txt".into(),
        media_type: "text/plain".into(),
        size: 5,
        sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824".into(),
        origin_path: None,
        text: Some("hello".into()),
    };
    let (_, dup) = db.insert_attachment(&att, bytes).unwrap();
    assert!(!dup);
    let (existing, dup) = db.insert_attachment(&Attachment { id: new_id(), ..att.clone() }, bytes).unwrap();
    assert!(dup);
    assert_eq!(existing.id, att.id);
    assert_eq!(db.attachment_bytes(&att.sha256).unwrap(), bytes);
    db.delete_attachment(&att.id).unwrap();
    assert!(db.attachment_bytes(&att.sha256).is_none());
}

#[test]
fn reopen_keeps_data_and_schema() {
    let dir = tempfile::tempdir().unwrap();
    {
        let mut db = Store::open(dir.path()).unwrap();
        db.set_setting("theme", &serde_json::json!("dark")).unwrap();
        db.record_handoff("p", 1, "ChatGPT", "clipboard", "copied").unwrap();
    }
    let db = Store::open(dir.path()).unwrap();
    assert_eq!(db.settings().unwrap()["theme"], "dark");
    assert_eq!(db.stats().unwrap().handoffs_total, 1);
    assert_eq!(db.integrity_check().unwrap(), "ok");
}

#[test]
fn fts_query_is_injection_safe() {
    assert_eq!(fts_query("auth \"OR\" x"), Some("\"auth\"* \"OR\"* \"x\"*".into()));
    assert_eq!(fts_query("   "), None);
}

#[test]
fn relations_tags_and_audit() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let (s, m) = capture("/c.jsonl", "audit me");
    let p = db.create_pack(pack_from(s, m), None).unwrap();
    let dup = db.duplicate_pack(&p.pack_id).unwrap();
    let rel = db.relations(Some(&dup.pack_id)).unwrap();
    assert_eq!(rel.len(), 1);
    assert_eq!(rel[0].kind, "duplicated");
    assert_eq!(rel[0].from_pack, p.pack_id);

    db.set_tags(&p.pack_id, &["Backend".into(), " backend".into(), "auth".into()]).unwrap();
    let row = db.list_packs().unwrap().into_iter().find(|r| r.id == p.pack_id).unwrap();
    assert_eq!(row.tags, vec!["auth", "backend"]);

    let clean = db.audit().unwrap();
    assert_eq!(clean.database, "ok");
    assert_eq!(clean.versions_checked, 2);
    assert!(clean.version_problems.is_empty());

    db.conn
        .execute("UPDATE pack_versions SET snapshot_json = replace(snapshot_json, 'audit me', 'edited') WHERE pack_id = ?1", [&p.pack_id])
        .unwrap();
    assert_eq!(db.audit().unwrap().version_problems.len(), 1);
}

#[test]
fn sessions_refresh_in_place_and_keep_pin_and_tags() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let (s, m) = capture("/s.jsonl", "first turn");
    let first = db.insert_capture(&s, &m).unwrap();
    db.update_session(&first.source_id, &SessionPatch { pinned: Some(true), tags: Some(vec!["Auth".into()]), ..Default::default() })
        .unwrap();

    let (s2, mut m2) = capture("/s.jsonl", "first turn");
    m2.push(Message { id: "m2".into(), source_id: s2.source_id.clone(), role: Role::Assistant, created_at: None, blocks: vec![Block::text("reply")] });
    let again = db.upsert_session(&s2, &m2, Some("2030-01-01T00:00:00Z")).unwrap();
    assert_eq!(again.source_id, first.source_id);
    assert!(again.duplicate_of.is_none());

    let rows = db.list_sessions().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].message_count, 2);
    assert!(rows[0].pinned);
    assert_eq!(rows[0].tags, vec!["auth"]);
    assert_eq!(rows[0].updated_at, "2030-01-01T00:00:00Z");
    let (src, msgs) = db.get_source(&first.source_id).unwrap();
    assert_eq!(src.source_id, first.source_id);
    assert!(msgs.iter().all(|m| m.source_id == first.source_id));
    assert_eq!(db.search("reply", 5).unwrap().len(), 1);
}

#[test]
fn removed_agent_sessions_stay_hidden_until_captured_again() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let (s, m) = capture("/h.jsonl", "hide me");
    let id = db.insert_capture(&s, &m).unwrap().source_id;
    db.remove_session(&id).unwrap();
    assert!(db.list_sessions().unwrap().is_empty());
    assert!(db.session_origins().unwrap()["/h.jsonl"].hidden);

    let (s2, m2) = capture("/h.jsonl", "hide me");
    assert_eq!(db.insert_capture(&s2, &m2).unwrap().source_id, id);
    assert_eq!(db.list_sessions().unwrap().len(), 1);
}

#[test]
fn compose_combines_sessions_with_their_files_and_logs_copies() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let a = db.insert_capture(&capture("/a1", "one").0, &capture("/a1", "one").1).unwrap().source_id;
    let (s, m) = capture("/a2", "two");
    let b = db.insert_capture(&s, &m).unwrap().source_id;
    let att = Attachment {
        id: new_id(),
        file_name: "notes.txt".into(),
        media_type: "text/plain".into(),
        size: 5,
        sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824".into(),
        origin_path: None,
        text: Some("hello".into()),
    };
    db.insert_attachment(&att, b"hello").unwrap();
    assert_eq!(db.add_files(Some(&b), &[att.clone()]).unwrap(), b);
    assert_eq!(db.session_row(&b).unwrap().file_count, 1);

    let pack = db.compose(&[a.clone(), b.clone()]).unwrap();
    assert_eq!(pack.sources.len(), 2);
    assert_eq!(pack.messages.len(), 3);
    assert_eq!(pack.attachments.len(), 1);
    assert!(pack.title.starts_with("2 sessions"));

    db.record_copy(&[a.clone()], "chatgpt", "clipboard", "copied").unwrap();
    assert!(db.session_row(&a).unwrap().last_copied_at.is_some());
    assert_eq!(db.list_handoffs(1).unwrap()[0].pack_title.as_deref(), Some("Auth migration"));

    let loose = db.add_files(None, &[att]).unwrap();
    assert_eq!(db.session_row(&loose).unwrap().title, "notes.txt");
}

#[test]
fn upgrade_folds_packs_and_loose_files_into_sessions() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();

    let (old, old_m) = capture("/u.jsonl", "old");
    let (new, new_m) = capture("/u.jsonl", "new");
    for (s, m) in [(&old, &old_m), (&new, &new_m)] {
        let text = m[0].blocks[0].plain_text().to_string();
        db.conn
            .execute(
                "INSERT INTO sources (id, kind, provider, title, origin, captured_at, capture_status, source_json, message_count, token_estimate, content_hash)
                 VALUES (?1, 'local-agent', 'claude-code', 't', '/u.jsonl', ?2, 'complete', ?3, 1, 1, ?4)",
                params![s.source_id, if text == "old" { "2020" } else { "2021" }, serde_json::to_string(s).unwrap(), text],
            )
            .unwrap();
    }

    let (gone, gone_m) = capture("/gone.jsonl", "only in the pack");
    let mut pack = pack_from(gone, gone_m);
    pack.context.note = Some("Keep the API stable".into());
    db.create_pack(pack, None).unwrap();

    let att = Attachment {
        id: new_id(),
        file_name: "spec.pdf".into(),
        media_type: "application/pdf".into(),
        size: 3,
        sha256: "abc".into(),
        origin_path: None,
        text: None,
    };
    db.insert_attachment(&att, b"pdf").unwrap();

    db.upgrade_to_sessions().unwrap();
    let rows = db.list_sessions().unwrap();
    let titles: Vec<&str> = rows.iter().map(|r| r.title.as_str()).collect();
    assert_eq!(rows.iter().filter(|r| r.origin.as_deref() == Some("/u.jsonl")).count(), 1);
    assert!(rows.iter().any(|r| r.id == new.source_id));
    assert!(titles.contains(&"Project X — Auth Migration"), "{titles:?}");
    assert!(titles.contains(&"Added files"), "{titles:?}");
    assert!(rows.iter().any(|r| r.origin.as_deref() == Some("/gone.jsonl")));
}
