use super::*;
use hopilo_core::*;

#[test]
fn paged_library_filters_unicode_ids_hidden_and_keeps_stable_order() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let mut ids = Vec::new();
    for i in 0..31 {
        let (mut source, messages) = capture(&format!("/page-{i}"), "hello");
        source.title = format!("ÉTUDE {i}");
        source.model = Some("Model A".into());
        ids.push(db.upsert_session(&source, &messages, Some("2030-01-01T00:00:00Z")).unwrap().source_id);
    }
    db.update_session(
        &ids[0],
        &SessionPatch { pinned: Some(true), tags: Some(vec!["special".into()]), ..Default::default() },
    )
    .unwrap();
    let first = db.query_sessions(&SessionQuery { limit: 10, ..Default::default() }).unwrap();
    let next = db.query_sessions(&SessionQuery { limit: 10, offset: 10, ..Default::default() }).unwrap();
    assert_eq!(first.total, 31);
    assert_eq!(first.counts.hidden, 0);
    assert_eq!(first.rows.len(), 10);
    assert_eq!(first.rows[0].id, ids[0]);
    assert!(next.rows.iter().all(|r| !first.rows.iter().any(|p| p.id == r.id)));
    let found =
        db.query_sessions(&SessionQuery { q: "étude".into(), model: "Model A".into(), ..Default::default() }).unwrap();
    assert_eq!(found.total, 31);
    let found = db.query_sessions(&SessionQuery { q: "special".into(), ..Default::default() }).unwrap();
    assert_eq!(found.rows[0].id, ids[0]);
    let selected = db
        .query_sessions(&SessionQuery { ids: Some(vec![ids[3].clone(), ids[20].clone()]), ..Default::default() })
        .unwrap();
    assert_eq!(selected.total, 2);
    assert!(db.query_sessions(&SessionQuery { ids: Some(vec![]), ..Default::default() }).unwrap().rows.is_empty());
    db.remove_session(&ids[3]).unwrap();
    assert_eq!(db.query_sessions(&SessionQuery::default()).unwrap().total, 30);
    assert_eq!(db.query_sessions(&SessionQuery::default()).unwrap().counts.total, 30);
    assert_eq!(db.query_sessions(&SessionQuery::default()).unwrap().counts.hidden, 1);
    assert_eq!(
        db.query_sessions(&SessionQuery { q: "no matches".into(), ..Default::default() }).unwrap().counts.hidden,
        1
    );
    assert_eq!(db.query_sessions(&SessionQuery { filter: "hidden".into(), ..Default::default() }).unwrap().total, 1);
    let last = db.query_sessions(&SessionQuery { limit: 10, offset: 100_000, ..Default::default() }).unwrap();
    assert_eq!(last.offset, 20);
    assert_eq!(last.rows.len(), 10);
    assert_eq!(db.query_sessions(&SessionQuery { q: "' OR 1=1 --".into(), ..Default::default() }).unwrap().total, 0);
}

#[test]
#[ignore = "synthetic scale benchmark; run explicitly"]
fn benchmark_library_paging() {
    use std::time::Instant;
    for count in [1_000, 10_000, 100_000] {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Store::open(dir.path()).unwrap();
        let tx = db.conn.transaction().unwrap();
        {
            let mut insert = tx.prepare("INSERT INTO sources (id,kind,provider,title,captured_at,capture_status,source_json,message_count,token_estimate,content_hash)
                VALUES (?1,'local-agent','codex',?2,'2030-01-01T00:00:00Z','complete','{}',2,100,'hash')").unwrap();
            for i in 0..count {
                insert.execute(params![format!("id{i}"), format!("Session {i}")]).unwrap();
            }
        }
        tx.commit().unwrap();
        let start = Instant::now();
        let all = db.list_sessions().unwrap();
        let full = serde_json::to_vec(&all).unwrap();
        let full_time = start.elapsed();
        let start = Instant::now();
        let page = db.query_sessions(&SessionQuery { limit: 25, ..Default::default() }).unwrap();
        let payload = serde_json::to_vec(&page).unwrap();
        let page_time = start.elapsed();
        let start = Instant::now();
        db.query_sessions(&SessionQuery { limit: 25, offset: 25, ..Default::default() }).unwrap();
        let warm = start.elapsed();
        assert_eq!(page.rows.len(), 25);
        eprintln!(
            "sessions={count} full={full_time:?}/{} bytes page={page_time:?}/{} bytes warm={warm:?}",
            full.len(),
            payload.len()
        );
    }
}

#[test]
fn query_sessions_scopes_to_project_roots() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let mut ids = Vec::new();
    for (i, project) in [Some("/w/app"), Some(" /w/app/sub "), Some("/w/application"), Some("C:\\w\\app\\x"), None]
        .into_iter()
        .enumerate()
    {
        let (mut source, messages) = capture(&format!("/scope-{i}"), &format!("scope {i}"));
        source.project = project.map(str::to_string);
        ids.push(db.upsert_session(&source, &messages, None).unwrap().source_id);
    }
    let scoped = |roots: Vec<&str>| {
        let mut found: Vec<String> = db
            .query_sessions(&SessionQuery {
                project_roots: Some(roots.into_iter().map(str::to_string).collect()),
                ..Default::default()
            })
            .unwrap()
            .rows
            .into_iter()
            .map(|r| r.id)
            .collect();
        found.sort();
        found
    };
    let mut expected = vec![ids[0].clone(), ids[1].clone()];
    expected.sort();
    assert_eq!(scoped(vec!["/w/app"]), expected);
    assert_eq!(scoped(vec!["C:\\w\\app"]), vec![ids[3].clone()]);
    assert!(scoped(vec![]).is_empty());
    let rows_only = db.query_sessions(&SessionQuery { rows_only: true, limit: 2, ..Default::default() }).unwrap();
    assert_eq!((rows_only.rows.len(), rows_only.total, rows_only.counts.total), (2, 5, 0));
    assert!(rows_only.folders.is_empty() && rows_only.models.is_empty());
    assert_eq!(db.query_sessions(&SessionQuery::default()).unwrap().total, 5);
}

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
    let msgs = vec![
        Message {
            id: "m1".into(),
            source_id: sid.clone(),
            role: Role::User,
            created_at: None,
            blocks: vec![Block::text(text)],
        },
        Message {
            id: "m2".into(),
            source_id: sid,
            role: Role::Assistant,
            created_at: None,
            blocks: vec![Block::text("On it.")],
        },
    ];
    (source, msgs)
}

#[test]
fn sync_origin_preserves_renamed_title_marker_and_failed_handoffs_do_not_mark_copied() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let (source, messages) = capture("/renamed.jsonl", "hello");
    let id = db.upsert_session(&source, &messages, None).unwrap().source_id;
    db.update_session(&id, &SessionPatch { title: Some("My title".into()), ..Default::default() }).unwrap();
    assert!(db.session_origins().unwrap()["/renamed.jsonl"].title_edited);
    db.record_copy(std::slice::from_ref(&id), "claude", "extension", "failed").unwrap();
    assert!(db.session_row(&id).unwrap().last_copied_at.is_none());
    db.record_copy(std::slice::from_ref(&id), "claude", "extension", "drafted").unwrap();
    assert!(db.session_row(&id).unwrap().last_copied_at.is_some());
}

#[test]
fn sync_compares_instants_including_subsecond_changes_and_offsets() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let (source, messages) = capture("/fast.jsonl", "hello");
    db.upsert_session(&source, &messages, Some("2030-01-01T00:00:00Z")).unwrap();
    let origin = db.session_origins().unwrap().remove("/fast.jsonl").unwrap();
    assert!(!origin.unchanged_since("2030-01-01T00:00:00.000000001Z"));
    assert!(origin.unchanged_since("2030-01-01T06:00:00+06:00"));
    assert!(!origin.unchanged_since("invalid"));
    db.upsert_session(&source, &messages, Some("2030-01-01T00:00:00.000000001Z")).unwrap();
    let origin = db.session_origins().unwrap().remove("/fast.jsonl").unwrap();
    assert!(origin.unchanged_since("2030-01-01T00:00:00.000000001Z"));
}

#[test]
fn agent_sessions_without_a_reply_are_listed_and_flagged() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let (s, mut m) = capture("/failed.jsonl", "prompt that errored");
    m.truncate(1);
    let id = db.insert_capture(&s, &m).unwrap().source_id;
    let rows = db.list_sessions().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].reply_count, 0);

    let (s2, m2) = capture("/failed.jsonl", "prompt that errored");
    assert_eq!(db.insert_capture(&s2, &m2).unwrap().source_id, id);
    assert_eq!(db.list_sessions().unwrap()[0].reply_count, 1, "updates once the agent answers");
}

#[test]
fn session_list_and_transcripts_are_cached_until_the_next_write() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let (s, m) = capture("/c.jsonl", "first");
    let id = db.insert_capture(&s, &m).unwrap().source_id;
    let a = db.list_sessions().unwrap();
    let before = db.conn.total_changes();
    assert_eq!(db.list_sessions().unwrap().len(), a.len());
    assert_eq!(db.get_source(&id).unwrap().1.len(), 2);
    assert_eq!(db.get_source(&id).unwrap().1.len(), 2);
    assert_eq!(db.conn.total_changes(), before);

    db.update_session(&id, &SessionPatch { title: Some("Renamed".into()), ..Default::default() }).unwrap();
    assert_eq!(db.list_sessions().unwrap()[0].title, "Renamed");
    assert_eq!(db.get_source(&id).unwrap().0.title, "Renamed");
    assert_eq!(db.query_sessions(&SessionQuery::default()).unwrap().counts.pinned, 0);

    let mut other = Store::open(dir.path()).unwrap();
    other
        .update_session(
            &id,
            &SessionPatch { title: Some("From host".into()), pinned: Some(true), ..Default::default() },
        )
        .unwrap();
    assert_eq!(db.list_sessions().unwrap()[0].title, "From host");
    assert_eq!(db.query_sessions(&SessionQuery::default()).unwrap().counts.pinned, 1);
}

#[test]
fn list_queries_use_indexes() {
    let dir = tempfile::tempdir().unwrap();
    let db = Store::open(dir.path()).unwrap();
    let plan: Vec<String> = db
        .conn
        .prepare(
            "EXPLAIN QUERY PLAN SELECT id FROM sources WHERE hidden = 0
             ORDER BY pinned DESC, COALESCE(updated_at, captured_at) DESC, rowid DESC",
        )
        .unwrap()
        .query_map([], |r| r.get::<_, String>(3))
        .unwrap()
        .flatten()
        .collect();
    let plan = plan.join("\n");
    assert!(plan.contains("sources_list"), "{plan}");
    assert!(!plan.contains("TEMP B-TREE"), "{plan}");
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

    let (mut s2, m2) = capture("/a.jsonl", "migrate sessions table to uuid keys");
    s2.captured_at = "2099-01-01T00:00:00Z".into();
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
fn uppercase_digests_are_stored_under_the_lowercase_key() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let lower = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
    let att = Attachment {
        id: new_id(),
        file_name: "notes.txt".into(),
        media_type: "text/plain".into(),
        size: 5,
        sha256: lower.to_ascii_uppercase(),
        origin_path: None,
        text: None,
    };
    let (stored, _) = db.insert_attachment(&att, b"hello").unwrap();
    assert_eq!(stored.sha256, lower);
    assert!(db.has_sha(lower).unwrap());
    assert_eq!(db.attachment_bytes(lower).unwrap(), b"hello");
}

#[test]
fn deleting_attachment_keeps_blob_still_referenced_by_a_message() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let (s, m) = capture("/f.jsonl", "look at this");
    let id = db.insert_capture(&s, &m).unwrap().source_id;
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
    db.add_files(Some(&id), std::slice::from_ref(&att)).unwrap();

    db.delete_attachment(&att.id).unwrap();
    assert_eq!(db.attachment_bytes(&att.sha256).unwrap(), b"hello");
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
fn remove_setting_deletes_key() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    db.set_setting("theme", &serde_json::json!("dark")).unwrap();
    assert_eq!(db.settings().unwrap()["theme"], "dark");
    db.remove_setting("theme").unwrap();
    assert!(!db.settings().unwrap().contains_key("theme"));
}

#[test]
fn fts_query_is_injection_safe() {
    assert_eq!(fts_query("auth \"OR\" x"), Some("\"auth\"* \"OR\"* \"x\"*".into()));
    assert_eq!(fts_query("   "), None);
}

#[test]
fn legacy_content_hash_matches_pre_camel_case_serialization() {
    use sha2::{Digest, Sha256};

    let msg = Message {
        id: "m1".into(),
        source_id: "s1".into(),
        role: Role::User,
        created_at: None,
        blocks: vec![
            Block::ToolCall { name: "Bash".into(), input: "{}".into() },
            Block::ToolResult { name: Some("Bash".into()), output: "failed".into(), is_error: true },
            Block::File { name: "a.txt".into(), media_type: "text/plain".into(), sha256: "abc".into(), size: 3 },
            Block::Missing { description: "gone".into() },
            Block::text("after"),
        ],
    };
    let serialized = concat!(
        r#"["user",[{"type":"toolCall","name":"Bash","input":"{}"},"#,
        r#"{"type":"toolResult","name":"Bash","output":"failed","is_error":true},"#,
        r#"{"type":"file","name":"a.txt","mediaType":"text/plain","sha256":"abc","size":3},"#,
        r#"{"type":"missing","description":"gone"},"#,
        r#"{"type":"text","text":"after"}]]"#
    );
    let mut hasher = Sha256::new();
    hasher.update(serialized.as_bytes());
    hasher.update([0u8]);

    assert_eq!(legacy_content_hash(&[msg]).unwrap(), hex::encode(hasher.finalize()));
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
        .execute(
            "UPDATE pack_versions SET snapshot_json = replace(snapshot_json, 'audit me', 'edited') WHERE pack_id = ?1",
            [&p.pack_id],
        )
        .unwrap();
    assert_eq!(db.audit().unwrap().version_problems.len(), 1);
}

#[test]
fn sessions_refresh_in_place_and_keep_pin_and_tags() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let (s, m) = capture("/s.jsonl", "first turn");
    let first = db.insert_capture(&s, &m).unwrap();
    db.update_session(
        &first.source_id,
        &SessionPatch { pinned: Some(true), tags: Some(vec!["Auth".into()]), ..Default::default() },
    )
    .unwrap();

    let (s2, mut m2) = capture("/s.jsonl", "first turn");
    m2.push(Message {
        id: "m3".into(),
        source_id: s2.source_id.clone(),
        role: Role::User,
        created_at: None,
        blocks: vec![Block::text("next")],
    });
    let again = db.upsert_session(&s2, &m2, Some("2030-01-01T00:00:00Z")).unwrap();
    assert_eq!(again.source_id, first.source_id);
    assert!(again.duplicate_of.is_none());

    let rows = db.list_sessions().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].message_count, 3);
    assert!(rows[0].pinned);
    assert_eq!(rows[0].tags, vec!["auth"]);
    assert_eq!(rows[0].updated_at, "2030-01-01T00:00:00Z");
    let (src, msgs) = db.get_source(&first.source_id).unwrap();
    assert_eq!(src.source_id, first.source_id);
    assert!(msgs.iter().all(|m| m.source_id == first.source_id));
    assert_eq!(db.search("next", 5).unwrap().len(), 1);
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
fn duplicate_content_refreshes_source_metadata() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let (mut source, messages) = capture("/same.jsonl", "same content");
    source.project = Some("/work/app/src/pages".into());
    let id = db.insert_capture(&source, &messages).unwrap().source_id;

    let (mut refreshed, refreshed_messages) = capture("/same.jsonl", "same content");
    refreshed.project = Some("/work/app".into());
    refreshed.missing_items = vec!["new parser notice".into()];
    refreshed.capture_status = CaptureStatus::Partial;
    let result = db.upsert_session(&refreshed, &refreshed_messages, Some("2030-01-01T00:00:00Z")).unwrap();

    assert_eq!(result.source_id, id);
    assert_eq!(result.duplicate_of.as_deref(), Some(id.as_str()));
    let (stored, _) = db.get_source(&id).unwrap();
    assert_eq!(stored.project.as_deref(), Some("/work/app"));
    assert_eq!(stored.missing_items, vec!["new parser notice"]);
    assert_eq!(stored.capture_status, CaptureStatus::Partial);
    assert_eq!(db.session_origins().unwrap()["/same.jsonl"].project.as_deref(), Some("/work/app"));
}

#[test]
fn restore_session_unhides_and_reindexes() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let (s, m) = capture("/h.jsonl", "hide me");
    let id = db.insert_capture(&s, &m).unwrap().source_id;
    db.remove_session(&id).unwrap();
    assert!(db.list_sessions().unwrap().is_empty());
    assert_eq!(db.list_hidden_sessions().unwrap().len(), 1);
    db.restore_session(&id).unwrap();
    assert_eq!(db.list_sessions().unwrap().len(), 1);
    assert!(db.list_hidden_sessions().unwrap().is_empty());
    assert_eq!(db.search("hide", 5).unwrap().len(), 1);
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
    assert_eq!(db.add_files(Some(&b), std::slice::from_ref(&att)).unwrap(), b);
    assert_eq!(db.session_row(&b).unwrap().file_count, 1);

    let pack = db.compose(&[a.clone(), b.clone()]).unwrap();
    assert_eq!(pack.sources.len(), 2);
    assert_eq!(pack.messages.len(), 5);
    assert_eq!(pack.attachments.len(), 1);
    assert!(pack.title.starts_with("2 sessions"));

    db.record_copy(std::slice::from_ref(&a), "chatgpt", "clipboard", "copied").unwrap();
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
                "INSERT INTO sources (id, kind, provider, title, origin, captured_at, capture_status, source_json, message_count, token_estimate, content_hash, reply_count)
                 VALUES (?1, 'local-agent', 'claude-code', 't', '/u.jsonl', ?2, 'complete', ?3, 1, 1, ?4, 1)",
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
        sha256: hopilo_pack_format_sha(b"pdf"),
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

#[test]
fn renamed_session_keeps_its_title_when_the_agent_file_changes() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let (s, m) = capture("/r.jsonl", "first draft");
    let id = db.upsert_session(&s, &m, Some("2030-01-01T00:00:00Z")).unwrap().source_id;
    db.update_session(&id, &SessionPatch { title: Some("My name".into()), ..Default::default() }).unwrap();
    assert_eq!(db.get_source(&id).unwrap().0.title, "My name");

    let (s2, m2) = capture("/r.jsonl", "first draft, then more work");
    let again = db.upsert_session(&s2, &m2, Some("2030-01-02T00:00:00Z")).unwrap();
    assert!(again.duplicate_of.is_none());
    assert_eq!(again.source_id, id);
    assert_eq!(db.session_row(&id).unwrap().title, "My name");
    assert_eq!(db.get_source(&id).unwrap().0.title, "My name");
    assert_eq!(db.search("name", 5).unwrap().iter().filter(|h| h.ref_id == id).count(), 1);
}

#[test]
fn unchanged_session_picks_up_a_better_title() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let (mut s, m) = capture("/t.jsonl", "same words");
    s.title = "New session - 2026".into();
    let id = db.upsert_session(&s, &m, Some("2030-01-01T00:00:00Z")).unwrap().source_id;
    let (mut s2, m2) = capture("/t.jsonl", "same words");
    s2.title = "Real title".into();
    assert!(db.upsert_session(&s2, &m2, Some("2030-01-01T00:00:00Z")).unwrap().duplicate_of.is_some());
    assert_eq!(db.session_row(&id).unwrap().title, "Real title");

    db.update_session(&id, &SessionPatch { title: Some("Mine".into()), ..Default::default() }).unwrap();
    let (s3, m3) = capture("/t.jsonl", "same words");
    db.upsert_session(&s3, &m3, None).unwrap();
    assert_eq!(db.session_row(&id).unwrap().title, "Mine");
}

#[test]
fn only_the_newest_migration_backup_is_kept() {
    let dir = tempfile::tempdir().unwrap();
    for n in ["hopilo.db.before-v3", "hopilo.db.before-v4", "hopilo.db"] {
        std::fs::write(dir.path().join(n), b"x").unwrap();
    }
    prune_backups(dir.path(), 4);
    assert!(!dir.path().join("hopilo.db.before-v3").exists());
    assert!(dir.path().join("hopilo.db.before-v4").exists());
    assert!(dir.path().join("hopilo.db").exists());
}

#[test]
fn reader_connection_audits_without_the_writer() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let (s, m) = capture("/a.jsonl", "hello");
    db.insert_capture(&s, &m).unwrap();
    let reader = Store::open_reader(dir.path()).unwrap();
    assert_eq!(reader.audit().unwrap().database, "ok");
    assert!(reader.list_sessions().unwrap().len() == 1);
}

fn hopilo_pack_format_sha(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(bytes))
}

#[test]
fn attachment_with_forged_checksum_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let forged = Attachment {
        id: new_id(),
        file_name: "x.txt".into(),
        media_type: "text/plain".into(),
        size: 5,
        sha256: "../../escape".into(),
        origin_path: None,
        text: None,
    };
    assert!(db.insert_attachment(&forged, b"hello").is_err());
    let wrong = Attachment { sha256: hopilo_pack_format_sha(b"other"), ..forged };
    assert!(db.insert_attachment(&wrong, b"hello").is_err());
    assert!(!dir.path().join("escape").exists());
}

#[test]
fn search_kind_returns_only_that_kind() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let (s, m) = capture("/k.jsonl", "zebra crossing notes");
    db.upsert_session(&s, &m, None).unwrap();
    let att = Attachment {
        id: new_id(),
        file_name: "zebra.txt".into(),
        media_type: "text/plain".into(),
        size: 5,
        sha256: hopilo_pack_format_sha(b"zebra"),
        origin_path: None,
        text: Some("zebra".into()),
    };
    db.insert_attachment(&att, b"zebra").unwrap();
    let hits = db.search_kind("zebra", "source", 20).unwrap();
    assert_eq!(hits.len(), 1);
    assert!(hits.iter().all(|h| h.kind == "source"));
}

#[test]
fn restored_session_is_searchable_again() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let (s, m) = capture("/h.jsonl", "quokka habitat");
    let id = db.upsert_session(&s, &m, None).unwrap().source_id;
    db.remove_session(&id).unwrap();
    assert!(db.search_kind("quokka", "source", 20).unwrap().is_empty());
    db.restore_session(&id).unwrap();
    assert_eq!(db.search_kind("quokka", "source", 20).unwrap().len(), 1);
}

#[test]
fn session_files_and_count_match_with_or_without_attachment_rows() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let source = Source {
        source_id: new_id(),
        kind: SourceKind::LocalAgent,
        provider: "claude-code".into(),
        title: "Test Files".into(),
        origin: None,
        project: None,
        model: None,
        captured_at: now_rfc3339(),
        capture_status: CaptureStatus::Complete,
        missing_items: vec![],
        omitted: vec![],
    };
    let file_a = Block::File {
        name: "test.png".into(),
        media_type: "image/png".into(),
        sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
        size: 1024,
    };
    let file_b = Block::File {
        name: "doc.txt".into(),
        media_type: "text/plain".into(),
        sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".into(),
        size: 256,
    };
    let file_c = Block::File {
        name: "test_copy.png".into(),
        media_type: "image/png".into(),
        sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
        size: 1024,
    };
    let msgs = vec![
        Message {
            id: new_id(),
            source_id: source.source_id.clone(),
            role: Role::User,
            created_at: None,
            blocks: vec![Block::text("Here is image"), file_a.clone()],
        },
        Message {
            id: new_id(),
            source_id: source.source_id.clone(),
            role: Role::Assistant,
            created_at: None,
            blocks: vec![Block::text("And doc"), file_b.clone(), file_c.clone()],
        },
    ];
    let outcome = db.upsert_session(&source, &msgs, None).unwrap();
    let row = db.session_row(&outcome.source_id).unwrap();
    let files = db.session_files(&msgs).unwrap();
    assert_eq!(row.file_count, 3);
    assert_eq!(files.len(), 3);
    assert_eq!(files[0].file_name, "test.png");
    assert_eq!(files[1].file_name, "doc.txt");
    assert_eq!(files[2].file_name, "test_copy.png");
}

#[test]
fn attachment_bytes_rejects_non_sha_names() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("secret.txt"), b"nope").unwrap();
    let db = Store::open(dir.path()).unwrap();
    assert!(db.attachment_bytes("../secret.txt").is_none());
    assert!(db.attachment_bytes("").is_none());
}

#[test]
fn encrypted_backup_roundtrip_preserves_settings_history_and_blobs() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(&dir.path().join("library")).unwrap();
    let file = CapturedFile {
        name: "notes.txt".into(),
        media_type: "text/plain".into(),
        bytes: b"private backup content".to_vec(),
    };
    let (attachment, _) = db.insert_attachment(&file.attachment(), &file.bytes).unwrap();
    let (source, mut messages) = capture("/session", "private request");
    messages[0].blocks.push(file.block());
    let id = db.upsert_session(&source, &messages, None).unwrap().source_id;
    db.set_setting("theme", &serde_json::json!("dark")).unwrap();
    db.record_copy(std::slice::from_ref(&id), "claude", "clipboard", "copied").unwrap();
    let backup_path = dir.path().join("library.hbackup");
    let password = "a strong test password";
    let report = db.create_backup(&backup_path, password).unwrap();
    assert!(report.verified);
    assert_eq!((report.sessions, report.files), (1, 1));
    let bytes = std::fs::read(&backup_path).unwrap();
    assert!(!bytes.windows(file.bytes.len()).any(|part| part == file.bytes));
    assert!(backup::verify(&backup_path, "wrong password").is_err());
    let verified = backup::verify(&backup_path, password).unwrap();
    let restored_dir = dir.path().join("restored");
    let mut restored = Store::open(&restored_dir).unwrap();
    restored.set_setting("theme", &serde_json::json!("light")).unwrap();
    restored.query_sessions(&SessionQuery::default()).unwrap();
    restored.restore_backup(verified).unwrap();
    assert_eq!(restored.query_sessions(&SessionQuery::default()).unwrap().total, 1);
    assert_eq!(restored.settings().unwrap()["theme"], "dark");
    assert_eq!(restored.list_handoffs(10).unwrap().len(), 1);
    assert_eq!(std::fs::read(restored_dir.join("attachments").join(&attachment.sha256)).unwrap(), file.bytes);
    std::fs::write(db.root().join("attachments").join(&attachment.sha256), "damaged").unwrap();
    assert!(db.create_backup(&backup_path, password).is_err());
    assert_eq!(std::fs::read(&backup_path).unwrap(), bytes);
    assert!(db.create_backup(&db.root().join("attachments/unsafe.hbackup"), password).is_err());
    let mut corrupt = bytes;
    let last = corrupt.len() - 1;
    corrupt[last] ^= 1;
    let corrupt_path = dir.path().join("damaged.hbackup");
    std::fs::write(&corrupt_path, corrupt).unwrap();
    assert!(backup::verify(&corrupt_path, password).is_err());
    assert_eq!(restored.settings().unwrap()["theme"], "dark");
    assert!(db.create_backup(&dir.path().join("short.hbackup"), "short").is_err());
}

#[test]
fn manual_file_removal_preserves_native_refs_other_files_snapshots_and_sync() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let first =
        CapturedFile { name: "shared.txt".into(), media_type: "text/plain".into(), bytes: b"shared content".to_vec() };
    let second = CapturedFile {
        name: "manual-only.txt".into(),
        media_type: "text/plain".into(),
        bytes: b"manual-only content".to_vec(),
    };
    let (a, _) = db.insert_attachment(&first.attachment(), &first.bytes).unwrap();
    let (b, _) = db.insert_attachment(&second.attachment(), &second.bytes).unwrap();
    let (source, mut native) = capture("/agent.jsonl", "agent prompt");
    native[0].blocks.push(first.block());
    let id = db.upsert_session(&source, &native, None).unwrap().source_id;
    assert!(db.remove_session_file(&id, &native[0].id, &a.sha256, &a.file_name).is_err());
    db.add_files(Some(&id), &[a.clone(), b.clone()]).unwrap();
    let upload = db.manual_file_messages(&id).unwrap()[0].id.clone();
    let (_, messages) = db.get_source(&id).unwrap();
    let entries = db.session_file_entries(&id, &messages).unwrap();
    assert!(entries[0].manual_message_id.is_none(), "shared SHA does not make native files removable");
    assert_eq!(entries[1].manual_message_id.as_deref(), Some(upload.as_str()));
    native[1].blocks = vec![Block::text("new agent response")];
    db.upsert_session(&source, &native, None).unwrap();
    assert_eq!(db.get_source(&id).unwrap().1.len(), 3);
    let snapshot = db.compose(std::slice::from_ref(&id)).unwrap();
    db.query_sessions(&SessionQuery::default()).unwrap();
    assert!(db.remove_session_file(&id, "forged", &a.sha256, &a.file_name).is_err());
    assert!(db.remove_session_file(&id, &upload, &a.sha256, "wrong name").is_err());
    db.remove_session_file(&id, &upload, &a.sha256, &a.file_name).unwrap();
    assert_eq!(db.manual_file_messages(&id).unwrap()[0].blocks.len(), 1);
    assert_eq!(db.session_row(&id).unwrap().file_count, 2);
    db.remove_session_file(&id, &upload, &b.sha256, &b.file_name).unwrap();
    let (_, after) = db.get_source(&id).unwrap();
    assert_eq!(after.len(), 2, "empty manual upload message is removed");
    assert!(db.manual_file_messages(&id).unwrap().is_empty());
    assert_eq!(db.query_sessions(&SessionQuery::default()).unwrap().rows[0].file_count, 1);
    assert_eq!(db.session_files(&after).unwrap()[0].file_name, first.name);
    assert_eq!(snapshot.messages.len(), 3, "existing snapshots remain immutable");
    assert_eq!(db.attachment_bytes(&a.sha256).unwrap(), first.bytes);
    assert_eq!(db.attachment_bytes(&b.sha256).unwrap(), second.bytes);
    db.upsert_session(&source, &native, None).unwrap();
    assert_eq!(db.get_source(&id).unwrap().1.len(), 2, "removed uploads do not return on sync");
    let standalone = db.add_files(None, std::slice::from_ref(&b)).unwrap();
    let own = db.manual_file_messages(&standalone).unwrap()[0].id.clone();
    assert!(db.remove_session_file(&id, &own, &b.sha256, &b.file_name).is_err());
    db.remove_session_file(&standalone, &own, &b.sha256, &b.file_name).unwrap();
    assert!(db.get_source(&standalone).unwrap().1.is_empty());
    assert_eq!(db.session_row(&standalone).unwrap().file_count, 0);
}

#[test]
fn permanent_hidden_deletion_is_atomic_and_allows_sync_reimport() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let (source, messages) = capture("/deleted-agent", "private hidden content");
    let a = db.upsert_session(&source, &messages, None).unwrap().source_id;
    let (other, other_messages) = capture("/other-agent", "other content");
    let b = db.upsert_session(&other, &other_messages, None).unwrap().source_id;
    db.remove_session(&a).unwrap();
    assert!(db.permanently_delete_sessions(&[a.clone(), b.clone()]).is_err());
    assert!(db.session_row(&a).is_ok(), "a mixed active/hidden batch must roll back completely");
    db.remove_session(&b).unwrap();
    db.query_sessions(&SessionQuery::default()).unwrap();
    db.permanently_delete_sessions(&[a.clone(), b.clone(), a.clone()]).unwrap();
    assert!(db.list_hidden_sessions().unwrap().is_empty());
    assert!(db.session_row(&a).is_err());
    assert!(db.get_source(&a).is_err());
    assert!(db.restore_session(&a).is_err());
    assert!(db.search("private hidden", 20).unwrap().is_empty());
    assert!(db.upsert_session(&source, &messages, None).is_ok(), "existing source can be synced again");
    drop(db);
    let mut db = Store::open(dir.path()).unwrap();
    assert!(db.upsert_session(&other, &other_messages, None).is_ok(), "no suppression survives app restart");
    db.wipe().unwrap();
    assert!(db.list_sessions().unwrap().is_empty());
}

#[test]
fn folder_list_values_filter_back_to_their_sessions() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let mut ids = Vec::new();
    for (i, project) in [" /w/app ", "/w/app", "/w/other"].into_iter().enumerate() {
        let (mut source, messages) = capture(&format!("/folder-{i}"), &format!("folder {i}"));
        source.project = Some(project.to_string());
        ids.push(db.upsert_session(&source, &messages, None).unwrap().source_id);
    }
    let page = db.query_sessions(&SessionQuery::default()).unwrap();
    assert_eq!(page.folders, vec!["/w/app".to_string(), "/w/other".to_string()]);
    for folder in page.folders {
        let found = db.query_sessions(&SessionQuery { folder: folder.clone(), ..Default::default() }).unwrap();
        assert!(found.total > 0, "folder {folder:?} from the list must match its sessions");
    }
    let mut app: Vec<String> = db
        .query_sessions(&SessionQuery { folder: "/w/app".into(), ..Default::default() })
        .unwrap()
        .rows
        .into_iter()
        .map(|r| r.id)
        .collect();
    app.sort();
    let mut expected = vec![ids[0].clone(), ids[1].clone()];
    expected.sort();
    assert_eq!(app, expected);
}

#[test]
fn today_counts_follow_the_local_day() {
    let tz = chrono::FixedOffset::east_opt(6 * 3600).unwrap();
    let now = chrono::TimeZone::with_ymd_and_hms(&tz, 2026, 11, 11, 3, 0, 0).unwrap();
    let (start, end) = crate::local_day_bounds(now);
    assert_eq!(start, "2026-11-10T18:00:00Z");
    assert_eq!(end, "2026-11-11T18:00:00Z");
}
