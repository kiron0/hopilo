use super::*;
use hopilo_core::{new_id, now_rfc3339, Block, CaptureStatus, Message, Role, Source, SourceKind};
use serde_json::{json, Value};

const SECRET: &str = "AKIAIOSFODNN7EXAMPLE";

struct Lib {
    dir: tempfile::TempDir,
    ids: Vec<String>,
}

impl Lib {
    fn reader(&self) -> Store {
        Store::open_reader(self.dir.path()).unwrap()
    }

    fn set_access(&self, value: Value) {
        Store::open(self.dir.path()).unwrap().set_setting(SETTINGS_KEY, &value).unwrap();
    }
}

fn session(project: Option<&str>, title: &str, origin: &str) -> (Source, Vec<Message>) {
    let sid = new_id();
    let source = Source {
        source_id: sid.clone(),
        kind: SourceKind::LocalAgent,
        provider: "claude-code".into(),
        title: title.into(),
        origin: Some(origin.into()),
        project: project.map(str::to_string),
        model: None,
        captured_at: now_rfc3339(),
        capture_status: CaptureStatus::Complete,
        missing_items: vec![],
        omitted: vec![],
    };
    let messages = vec![
        Message {
            id: "m1".into(),
            source_id: sid.clone(),
            role: Role::User,
            created_at: None,
            blocks: vec![Block::text(format!("Deploy with key {SECRET}"))],
        },
        Message {
            id: "m2".into(),
            source_id: sid,
            role: Role::Assistant,
            created_at: None,
            blocks: vec![Block::text("Done.")],
        },
    ];
    (source, messages)
}

fn library() -> Lib {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path()).unwrap();
    let mut ids = Vec::new();
    for (i, (project, title)) in [
        (Some("/work/app"), "Auth fix"),
        (Some("/work/app/web"), "Web build"),
        (Some("/work/application"), "Other project"),
        (None, "Loose chat"),
        (Some("/work/app"), "Hidden one"),
    ]
    .into_iter()
    .enumerate()
    {
        let (s, m) = session(project, title, &format!("/Users/me/.claude/projects/{i}.jsonl"));
        ids.push(db.upsert_session(&s, &m, None).unwrap().source_id);
    }
    db.remove_session(&ids[4]).unwrap();
    db.set_setting(SETTINGS_KEY, &json!({ "enabled": true, "mode": "selected", "sessions": [ids[0], ids[1], ids[4]] }))
        .unwrap();
    Lib { dir, ids }
}

fn titles(rows: &[SessionSummary]) -> Vec<String> {
    let mut t: Vec<String> = rows.iter().map(|r| r.title.clone()).collect();
    t.sort();
    t
}

#[test]
fn selected_mode_lists_ids_and_ignores_bad_ones() {
    let lib = library();
    lib.set_access(json!({ "enabled": true, "mode": "selected", "sessions": [lib.ids[0], "../x", 7, lib.ids[0]] }));
    let access = Access::load(&lib.reader());
    assert_eq!(access.selected, Some(vec![lib.ids[0].clone()]));
    assert!(access.allows(&lib.ids[0]));
    assert!(!access.allows(&lib.ids[1]));
    lib.set_access(json!({ "enabled": true, "mode": "selected" }));
    assert!(search(&lib.reader(), None, "", None).unwrap().is_empty());
    lib.set_access(json!({ "enabled": true, "mode": "all", "sessions": [lib.ids[0]] }));
    assert_eq!(Access::load(&lib.reader()).selected, None);
}

#[test]
fn access_is_off_by_default() {
    let lib = library();
    lib.set_access(json!({ "enabled": false }));
    assert_eq!(search(&lib.reader(), None, "", None).unwrap_err().code, "agent_access_disabled");
    assert_eq!(
        handoff(&lib.reader(), &[lib.ids[0].clone()], ContextLevel::Full).unwrap_err().code,
        "agent_access_disabled"
    );
    lib.set_access(json!(null));
    assert_eq!(search(&lib.reader(), None, "", None).unwrap_err().code, "agent_access_disabled");
    lib.set_access(json!({ "enabled": "yes" }));
    assert_eq!(search(&lib.reader(), None, "", None).unwrap_err().code, "agent_access_disabled");
}

#[test]
fn search_returns_only_selected_visible_sessions() {
    let lib = library();
    let store = lib.reader();
    assert_eq!(titles(&search(&store, None, "", None).unwrap()), vec!["Auth fix", "Web build"]);
    assert_eq!(titles(&search(&store, Some("/work/app/web/"), "", None).unwrap()), vec!["Web build"]);
    assert_eq!(titles(&search(&store, None, "auth", None).unwrap()), vec!["Auth fix"]);
    assert_eq!(search(&store, None, "", Some(1)).unwrap().len(), 1);
    assert_eq!(search(&store, None, "", Some(0)).unwrap().len(), 1);
    assert!(search(&store, Some("/work/application"), "", None).unwrap().is_empty());
    assert_eq!(search(&store, Some("  "), "", None).unwrap_err().code, "bad_request");
}

#[test]
fn handoff_refuses_ids_outside_scope_without_revealing_them() {
    let lib = library();
    let store = lib.reader();
    for id in [&lib.ids[2], &lib.ids[3], &lib.ids[4], &"01MISSING".to_string(), &"../etc".to_string()] {
        let e = handoff(&store, std::slice::from_ref(id), ContextLevel::Full).unwrap_err();
        assert_eq!(e.code, "not_found", "{id}");
    }
    assert_eq!(handoff(&store, &[], ContextLevel::Full).unwrap_err().code, "bad_request");
    let many: Vec<String> = (0..21).map(|_| lib.ids[0].clone()).collect();
    assert_eq!(handoff(&store, &many, ContextLevel::Full).unwrap_err().code, "bad_request");
}

#[test]
fn handoff_redacts_secrets_and_strips_local_paths() {
    let lib = library();
    let h = handoff(&lib.reader(), &[lib.ids[0].clone(), lib.ids[1].clone()], ContextLevel::Full).unwrap();
    assert!(h.text.contains("Deploy with key"));
    assert!(!h.text.contains(SECRET));
    assert!(h.findings_redacted >= 2);
    assert!(!h.text.contains("/Users/me"));
    assert!(h.token_estimate > 0);
}

#[test]
fn custom_keyword_rules_apply_to_handoff_and_titles() {
    let lib = library();
    Store::open(lib.dir.path()).unwrap().set_setting("redaction", &json!({ "keywords": ["Auth"] })).unwrap();
    let store = lib.reader();
    assert!(search(&store, None, "", None).unwrap().iter().all(|r| !r.title.contains("Auth")));
    let h = handoff(&store, &[lib.ids[0].clone()], ContextLevel::Minimal).unwrap();
    assert!(!h.text.contains("Auth fix"));
}

#[test]
fn reader_never_writes_to_the_library() {
    let lib = library();
    let before = std::fs::read(lib.dir.path().join("hopilo.db")).unwrap();
    let store = lib.reader();
    search(&store, None, "", None).unwrap();
    handoff(&store, &[lib.ids[0].clone()], ContextLevel::Full).unwrap();
    drop(store);
    let db = Store::open(lib.dir.path()).unwrap();
    assert!(db.list_handoffs(10).unwrap().is_empty());
    assert!(db.session_row(&lib.ids[0]).unwrap().last_copied_at.is_none());
    assert!(!before.is_empty());
}

#[test]
fn level_parsing() {
    assert_eq!(parse_level(None).unwrap(), ContextLevel::Balanced);
    assert_eq!(parse_level(Some("full")).unwrap(), ContextLevel::Full);
    assert_eq!(parse_level(Some("minimal")).unwrap(), ContextLevel::Minimal);
    assert_eq!(parse_level(Some("huge")).unwrap_err().code, "bad_request");
}

mod protocol {
    use super::*;
    use crate::mcp::{handle_line, PROTOCOL_VERSION};

    fn call(lib: &Lib, msg: Value) -> Option<Value> {
        let dir = lib.dir.path().to_path_buf();
        let open = move || Store::open_reader(&dir).map_err(|e| AgentError::new("library", e.to_string()));
        handle_line(&msg.to_string(), &open)
    }

    fn text(resp: &Value) -> String {
        resp["result"]["content"][0]["text"].as_str().unwrap().to_string()
    }

    #[test]
    fn initialize_list_and_notifications() {
        let lib = library();
        let init = call(&lib, json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}})).unwrap();
        assert_eq!(init["id"], 1);
        assert_eq!(init["result"]["protocolVersion"], PROTOCOL_VERSION);
        assert!(init["result"]["capabilities"]["tools"].is_object());
        assert!(call(&lib, json!({"jsonrpc":"2.0","method":"notifications/initialized"})).is_none());
        let list = call(&lib, json!({"jsonrpc":"2.0","id":"a","method":"tools/list"})).unwrap();
        let names: Vec<&str> =
            list["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert_eq!(names, vec!["search_sessions", "prepare_handoff"]);
        assert!(list["result"]["tools"][1]["inputSchema"]["required"][0] == "ids");
        assert_eq!(call(&lib, json!({"jsonrpc":"2.0","id":2,"method":"ping"})).unwrap()["result"], json!({}));
    }

    #[test]
    fn tool_calls_search_and_handoff() {
        let lib = library();
        let found = call(&lib, json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_sessions","arguments":{"query":"web"}}})).unwrap();
        assert_eq!(found["result"]["isError"], false);
        let parsed: Value = serde_json::from_str(&text(&found)).unwrap();
        assert_eq!(parsed["sessions"][0]["id"], lib.ids[1].as_str());
        let h = call(&lib, json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"prepare_handoff","arguments":{"ids":[lib.ids[1]],"level":"full"}}})).unwrap();
        assert_eq!(h["result"]["isError"], false);
        assert!(text(&h).contains("Web build"));
        assert!(!text(&h).contains(SECRET));
        let denied = call(&lib, json!({"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"prepare_handoff","arguments":{"ids":[lib.ids[2]]}}})).unwrap();
        assert_eq!(denied["result"]["isError"], true);
        assert!(text(&denied).contains("not_found"));
    }

    #[test]
    fn settings_are_reread_on_every_call() {
        let lib = library();
        let req =
            json!({"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"search_sessions","arguments":{}}});
        assert_eq!(call(&lib, req.clone()).unwrap()["result"]["isError"], false);
        lib.set_access(json!({ "enabled": false, "projects": ["/work/app"] }));
        let off = call(&lib, req).unwrap();
        assert_eq!(off["result"]["isError"], true);
        assert!(text(&off).contains("agent_access_disabled"));
    }

    #[test]
    fn malformed_requests_get_errors() {
        let lib = library();
        let dir = lib.dir.path().to_path_buf();
        let open = move || Store::open_reader(&dir).map_err(|e| AgentError::new("library", e.to_string()));
        assert_eq!(handle_line("{not json", &open).unwrap()["error"]["code"], -32700);
        assert_eq!(handle_line("[]", &open).unwrap()["error"]["code"], -32600);
        assert!(handle_line("   ", &open).is_none());
        assert_eq!(handle_line(&" ".repeat(crate::mcp::MAX_LINE + 1), &open).unwrap()["error"]["code"], -32600);
        assert_eq!(
            call(&lib, json!({"jsonrpc":"2.0","id":7,"method":"resources/list"})).unwrap()["error"]["code"],
            -32601
        );
        assert_eq!(
            call(&lib, json!({"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"delete_everything"}}))
                .unwrap()["error"]["code"],
            -32602
        );
        assert_eq!(call(&lib, json!({"jsonrpc":"2.0","id":{},"method":"ping"})).unwrap()["error"]["code"], -32600);
        let bad = call(&lib, json!({"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"search_sessions","arguments":{"limit":"ten"}}})).unwrap();
        assert_eq!(bad["result"]["isError"], true);
        let bad = call(&lib, json!({"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"prepare_handoff","arguments":{"ids":"x"}}})).unwrap();
        assert_eq!(bad["result"]["isError"], true);
    }
}

#[test]
fn enabled_access_defaults_to_every_visible_session() {
    let lib = library();
    lib.set_access(json!({ "enabled": true }));
    let store = lib.reader();
    assert_eq!(
        titles(&search(&store, None, "", None).unwrap()),
        vec!["Auth fix", "Loose chat", "Other project", "Web build"]
    );
    assert!(handoff(&store, &[lib.ids[3].clone()], ContextLevel::Minimal).is_ok());
    assert_eq!(handoff(&store, &[lib.ids[4].clone()], ContextLevel::Full).unwrap_err().code, "not_found");
    lib.set_access(json!({ "enabled": true, "mode": "selected", "sessions": [lib.ids[1], lib.ids[2]] }));
    let store = lib.reader();
    assert_eq!(titles(&search(&store, None, "", None).unwrap()), vec!["Other project", "Web build"]);
    assert_eq!(handoff(&store, &[lib.ids[0].clone()], ContextLevel::Full).unwrap_err().code, "not_found");
    assert!(handoff(&store, &[lib.ids[1].clone()], ContextLevel::Full).is_ok());
}
