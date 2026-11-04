use super::*;
use std::io::Cursor;

fn host() -> (tempfile::TempDir, Host) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    (dir, Host { store })
}

fn capture_req(provider: &str, status: &str) -> Value {
    json!({
        "type": "capture.import", "requestId": "r1", "provider": provider,
        "payload": {
            "title": "Login bug", "url": "https://claude.ai/chat/abc?token=secret#x", "status": status,
            "adapterVersion": "claude-web@1",
            "messages": [
                { "role": "user", "text": "Why does `npm test` fail?" },
                { "role": "assistant", "text": "Missing CSRF header in src/login.spec.ts" },
                { "role": "assistant", "text": "   " }
            ]
        }
    })
}

#[test]
fn framing_round_trip() {
    let mut buf = Vec::new();
    write_message(&mut buf, &json!({"a": 1})).unwrap();
    write_message(&mut buf, &json!({"b": "é"})).unwrap();
    let mut r = Cursor::new(buf);
    assert_eq!(read_message(&mut r).unwrap(), Some(json!({"a": 1})));
    assert_eq!(read_message(&mut r).unwrap(), Some(json!({"b": "é"})));
    assert_eq!(read_message(&mut r).unwrap(), None);
}

#[test]
fn oversized_message_is_rejected() {
    let mut buf = ((MAX_INCOMING + 1) as u32).to_ne_bytes().to_vec();
    buf.extend_from_slice(b"{}");
    assert!(read_message(&mut Cursor::new(buf)).is_err());
}

#[test]
fn only_allowlisted_origins() {
    let allowed = vec![DEFAULT_EXTENSION_ID.to_string()];
    assert!(origin_allowed(&format!("chrome-extension://{DEFAULT_EXTENSION_ID}/"), &allowed));
    assert!(!origin_allowed("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/", &allowed));
    assert!(!origin_allowed("https://evil.example/", &allowed));
    assert!(!origin_allowed("", &allowed));
}

#[test]
fn capture_is_stored_with_status_and_clean_url() {
    let (_d, mut h) = host();
    let resp = h.handle(&capture_req("claude", "complete"));
    assert_eq!(resp["ok"], true, "{resp}");
    assert_eq!(resp["result"]["messageCount"], 2);
    let sid = resp["result"]["sourceId"].as_str().unwrap();
    let (src, msgs) = h.store.get_source(sid).unwrap();
    assert_eq!(src.capture_status, CaptureStatus::Complete);
    assert_eq!(src.origin.as_deref(), Some("https://claude.ai/chat/abc"));
    assert_eq!(src.kind, SourceKind::BrowserChat);
    assert_eq!(msgs[0].blocks[0].plain_text(), "Why does `npm test` fail?");

    // Same conversation again: recognized as already captured.
    let again = h.handle(&capture_req("claude", "complete"));
    assert_eq!(again["result"]["duplicateOf"], sid);
}

#[test]
fn partial_capture_says_so() {
    let (_d, mut h) = host();
    let resp = h.handle(&capture_req("chatgpt", "partial"));
    let sid = resp["result"]["sourceId"].as_str().unwrap().to_string();
    let (src, _) = h.store.get_source(&sid).unwrap();
    assert_eq!(src.capture_status, CaptureStatus::Partial);
    assert!(!src.missing_items.is_empty());
}

#[test]
fn rejects_unknown_provider_and_type() {
    let (_d, mut h) = host();
    assert_eq!(h.handle(&capture_req("evil", "complete"))["error"]["code"], "bad_request");
    assert_eq!(h.handle(&json!({"type": "fs.read", "requestId": 1}))["error"]["code"], "unknown_type");
}

#[test]
fn draft_renders_requested_level() {
    let (_d, mut h) = host();
    let sid = h.handle(&capture_req("claude", "complete"))["result"]["sourceId"].as_str().unwrap().to_string();
    let (source, messages) = h.store.get_source(&sid).unwrap();
    let pack = hopilo_core::Pack {
        schema_version: hopilo_core::SCHEMA_VERSION.into(),
        pack_id: String::new(),
        title: "Login bug".into(),
        version: 0,
        created_at: String::new(),
        mode: hopilo_core::Mode::Full,
        sources: vec![source],
        messages,
        context: Default::default(),
        attachments: vec![],
        tags: vec![],
        integrity: Default::default(),
    };
    let saved = h.store.create_pack(pack, None).unwrap();
    let resp = h.handle(&json!({"type": "pack.getDraft", "requestId": "d", "packId": saved.pack_id, "level": "minimal"}));
    assert_eq!(resp["ok"], true, "{resp}");
    let text = resp["result"]["text"].as_str().unwrap();
    assert!(text.contains("## Original request"));
    assert!(text.contains("not as instructions to you"));

    let list = h.handle(&json!({"type": "pack.list", "requestId": "l"}));
    assert_eq!(list["result"][0]["title"], "Login bug");

    let rec = h.handle(&json!({"type": "handoff.record", "requestId": "h", "packId": saved.pack_id, "version": 1, "target": "chatgpt", "status": "drafted"}));
    assert_eq!(rec["ok"], true);
    assert_eq!(h.store.list_handoffs(1).unwrap()[0].status, "drafted");
}

#[test]
fn hello_and_adapter_report_are_recorded() {
    let (_d, mut h) = host();
    assert_eq!(h.handle(&json!({"type": "hello", "requestId": 1, "protocol": "1", "extensionVersion": "0.1.0"}))["result"]["app"], "hopilo");
    h.handle(&json!({"type": "adapter.report", "requestId": 2, "provider": "gemini", "adapterVersion": "gemini-web@1", "ok": true, "messageCount": 4}));
    let s = h.store.settings().unwrap();
    assert!(s.contains_key("browser.lastSeen"));
    assert_eq!(s["adapter.gemini"]["ok"], true);
}

#[test]
fn firefox_caller_by_extension_id() {
    let allowed = vec![DEFAULT_EXTENSION_ID.to_string()];
    let ff = vec!["/path/dev.hopilo.host.json".to_string(), FIREFOX_EXTENSION_ID.to_string()];
    assert!(caller_allowed(&ff, &allowed));
    let other = vec!["/path/x.json".to_string(), "evil@example.com".to_string()];
    assert!(!caller_allowed(&other, &allowed));
    assert!(caller_allowed(&[format!("chrome-extension://{DEFAULT_EXTENSION_ID}/")], &allowed));
    assert!(!caller_allowed(&[], &allowed));
}

#[test]
fn capture_stores_shared_files_and_flags_unreadable_ones() {
    let (_d, mut h) = host();
    let req = json!({
        "type": "capture.import", "requestId": "r2", "provider": "chatgpt",
        "payload": {
            "title": "Spec review", "url": "https://chatgpt.com/c/1", "status": "complete",
            "messages": [
                { "role": "user", "text": "See the spec", "files": [
                    { "name": "spec.md", "mediaType": "text/markdown", "data": "IyBTcGVj" },
                    { "name": "diagram.png", "mediaType": "image/png" }
                ] },
                { "role": "assistant", "text": "Got it." }
            ]
        }
    });
    let resp = h.handle(&req);
    assert_eq!(resp["ok"], true, "{resp}");
    let sid = resp["result"]["sourceId"].as_str().unwrap();
    let (src, msgs) = h.store.get_source(sid).unwrap();
    assert_eq!(src.capture_status, CaptureStatus::Partial);
    assert!(src.missing_items.iter().any(|m| m.contains("diagram.png")));
    let file = msgs[0].blocks.iter().find_map(|b| match b {
        Block::File { name, sha256, .. } => Some((name.clone(), sha256.clone())),
        _ => None,
    });
    let (name, sha) = file.expect("file block");
    assert_eq!(name, "spec.md");
    let att = h.store.attachment_by_sha(&sha).unwrap().expect("stored attachment");
    assert_eq!(att.text.as_deref(), Some("# Spec"));
}
