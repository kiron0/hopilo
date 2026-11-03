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

    // Same file, same content, new capture ids: detected as duplicate.
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

    // "Rollback" = re-save v1's content as a new version (LIB-05).
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

    // Tamper with a snapshot behind the store's back.
    db.conn
        .execute("UPDATE pack_versions SET snapshot_json = replace(snapshot_json, 'audit me', 'edited') WHERE pack_id = ?1", [&p.pack_id])
        .unwrap();
    assert_eq!(db.audit().unwrap().version_problems.len(), 1);
}
