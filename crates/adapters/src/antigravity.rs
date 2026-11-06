use std::collections::HashMap;
use std::path::{Path, PathBuf};

use hopilo_core::{new_id, now_rfc3339, Block, CaptureStatus, Message, Role, Source, SourceKind};
use rusqlite::OpenFlags;
use serde_json::Value;

use crate::text::title_from;
use crate::{
    file_meta, home, open_lines, AdapterError, Capture, DiscoveredSession, LocalAgentAdapter,
    Result,
};

pub struct Antigravity;

impl LocalAgentAdapter for Antigravity {
    fn id(&self) -> &'static str {
        "antigravity"
    }

    fn display_name(&self) -> &'static str {
        "Antigravity"
    }

    fn default_roots(&self) -> Vec<PathBuf> {
        let mut roots = Vec::new();
        if let Some(dir) = std::env::var_os("ANTIGRAVITY_DATA_DIR") {
            roots.push(PathBuf::from(dir.clone()).join("brain"));
            roots.push(PathBuf::from(dir));
        }
        if let Some(dir) = std::env::var_os("ANTIGRAVITY_HOME") {
            roots.push(PathBuf::from(dir).join("brain"));
        }
        if let Some(h) = home() {
            for flavor in ["antigravity", "antigravity-ide", "antigravity-cli"] {
                roots.push(h.join(".gemini").join(flavor).join("brain"));
            }
            roots.push(h.join(".antigravity").join("brain"));
        }
        if let Some(appdata) = std::env::var_os("APPDATA") {
            roots.push(PathBuf::from(appdata).join("antigravity").join("brain"));
        }
        roots
    }

    fn scan_depth(&self) -> usize {
        3
    }

    fn discover(&self, root: &Path) -> Result<Vec<DiscoveredSession>> {
        let target = if root.join("brain").is_dir() {
            root.join("brain")
        } else {
            root.to_path_buf()
        };

        if target.is_file() {
            if let Some(mut s) = quick_scan(&target, target.parent().unwrap_or(&target)) {
                if let Some(db) = find_summary_db(&target) {
                    if let Some(name) = lookup_antigravity_title(&db, &s.session_id) {
                        s.title = name;
                    }
                }
                return Ok(vec![s]);
            }
            return Ok(vec![]);
        }

        let Ok(rd) = std::fs::read_dir(&target) else {
            return Ok(vec![]);
        };

        let mut transcripts = Vec::new();
        for entry in rd.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let candidate1 = path
                .join(".system_generated")
                .join("logs")
                .join("transcript.jsonl");
            let candidate2 = path.join("transcript.jsonl");
            let candidate3 = path
                .join(".system_generated")
                .join("logs")
                .join("transcript_full.jsonl");

            let candidate4 = path
                .join(".system_generated")
                .join("logs")
                .join("overview.txt");
            let transcript = [candidate1, candidate2, candidate3, candidate4]
                .into_iter()
                .find(|c| c.is_file());

            transcripts.extend(transcript);
        }

        let db_titles = find_summary_db(&target)
            .map(|db| load_antigravity_titles(&db))
            .unwrap_or_default();

        let mut out = crate::par_scan(&transcripts, |t| {
            let dir = t
                .ancestors()
                .find(|a| a.parent() == Some(target.as_path()))?;
            let mut s = quick_scan(t, dir)?;
            if let Some(name) = db_titles.get(&s.session_id) {
                s.title = name.clone();
            }
            Some(s)
        });
        out.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
        Ok(out)
    }

    fn read(&self, path: &Path) -> Result<Capture> {
        read_session(path)
    }
}

fn extract_user_request(s: &str) -> String {
    if let Some(start) = s.find("<USER_REQUEST>") {
        let after = &s[start + "<USER_REQUEST>".len()..];
        if let Some(end) = after.find("</USER_REQUEST>") {
            return after[..end].trim().to_string();
        }
        return after.trim().to_string();
    }
    let mut clean = s;
    if let Some(idx) = clean.find("<ADDITIONAL_METADATA>") {
        clean = &clean[..idx];
    }
    if let Some(idx) = clean.find("<USER_SETTINGS_CHANGE>") {
        clean = &clean[..idx];
    }
    clean.trim().to_string()
}

fn extract_project(s: &str) -> Option<String> {
    if let Some(pos) = s.find("Active Workspaces:") {
        let after = &s[pos + "Active Workspaces:".len()..];
        for line in after.lines() {
            let t = line.trim();
            if let Some(p) = t.strip_prefix("- ") {
                let p = p.trim();
                if !p.is_empty() {
                    return Some(p.to_string());
                }
            }
        }
    }
    if let Some(pos) = s.find("Command Working Directory:") {
        let after = &s[pos + "Command Working Directory:".len()..];
        if let Some(line) = after.lines().next() {
            let cwd = line.trim();
            if !cwd.is_empty() {
                if let Some(root) = project_root(Path::new(cwd)) {
                    return Some(root.display().to_string());
                }
            }
        }
    }
    let documents = metadata_documents(s);
    if documents.len() > 1 {
        if let Some(root) = common_parent(&documents) {
            return Some(root.display().to_string());
        }
    }
    if let Some(pos) = s.find("Active Document:") {
        let after = &s[pos + "Active Document:".len()..];
        if let Some(line) = after.lines().next() {
            let path_str = line.split(" (").next().unwrap_or(line).trim();
            if let Some(root) = project_root(Path::new(path_str)) {
                return Some(root.display().to_string());
            }
        }
    }
    if let Some(pos) = s.find("Other open documents:") {
        let after = &s[pos + "Other open documents:".len()..];
        for line in after.lines() {
            let t = line.trim();
            if let Some(p) = t.strip_prefix("- ") {
                let path_str = p.split(" (").next().unwrap_or(p).trim();
                if let Some(root) = project_root(Path::new(path_str)) {
                    return Some(root.display().to_string());
                }
            }
        }
    }
    None
}

fn metadata_documents(s: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(pos) = s.find("Active Document:") {
        let after = &s[pos + "Active Document:".len()..];
        if let Some(line) = after.lines().next() {
            let path = line.split(" (").next().unwrap_or(line).trim();
            if !path.is_empty() {
                paths.push(PathBuf::from(path));
            }
        }
    }
    if let Some(pos) = s.find("Other open documents:") {
        let after = &s[pos + "Other open documents:".len()..];
        for line in after.lines() {
            let Some(path) = line.trim().strip_prefix("- ") else {
                if !line.trim().is_empty() {
                    break;
                }
                continue;
            };
            let path = path.split(" (").next().unwrap_or(path).trim();
            if !path.is_empty() {
                paths.push(PathBuf::from(path));
            }
        }
    }
    paths
}

fn common_parent(paths: &[PathBuf]) -> Option<PathBuf> {
    let mut root = paths.first()?.parent()?.to_path_buf();
    while !paths.iter().all(|path| path.starts_with(&root)) {
        root = root.parent()?.to_path_buf();
    }
    (root.parent().is_some()).then_some(root)
}

fn project_root(document: &Path) -> Option<PathBuf> {
    if crate::macos_protected_user_path(document) {
        return document.parent().map(Path::to_path_buf);
    }
    let start = if document.is_dir() {
        document
    } else {
        document.parent()?
    };

    for dir in start.ancestors() {
        if [".git", ".hg", ".svn"]
            .iter()
            .any(|marker| dir.join(marker).exists())
        {
            return Some(dir.to_path_buf());
        }
    }

    for dir in start.ancestors() {
        if [
            "pnpm-workspace.yaml",
            "go.work",
            "lerna.json",
            "nx.json",
            "turbo.json",
        ]
        .iter()
        .any(|marker| dir.join(marker).is_file())
        {
            return Some(dir.to_path_buf());
        }
        let cargo = dir.join("Cargo.toml");
        if cargo.is_file()
            && std::fs::read_to_string(cargo).is_ok_and(|text| text.contains("[workspace]"))
        {
            return Some(dir.to_path_buf());
        }
    }

    Some(start.to_path_buf())
}

fn quick_scan(transcript: &Path, session_dir: &Path) -> Option<DiscoveredSession> {
    let (size_bytes, modified_at) = file_meta(transcript).ok()?;
    let mut title = None;
    let mut project = None;
    let mut model = None;
    let mut count = 0;
    for line in open_lines(transcript).ok()?.map_while(|l| l.ok()) {
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let kind = v.get("type").and_then(Value::as_str).unwrap_or("");
        match kind {
            "USER_INPUT" => {
                count += 1;
                let content = v.get("content").and_then(Value::as_str).unwrap_or("");
                if title.is_none() {
                    let prompt = extract_user_request(content);
                    if !prompt.is_empty() {
                        title = Some(title_from(&prompt));
                    }
                }
                if project.is_none() {
                    project = extract_project(content);
                }
            }
            "PLANNER_RESPONSE" => {
                count += 1;
                if model.is_none() {
                    model = Some("Gemini".to_string());
                }
            }
            _ => {}
        }
    }
    if count == 0 {
        return None;
    }
    let session_id = session_dir
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| {
            transcript
                .file_stem()
                .unwrap()
                .to_string_lossy()
                .to_string()
        });
    Some(DiscoveredSession {
        adapter: "antigravity".into(),
        path: transcript.display().to_string(),
        session_id: session_id.clone(),
        title: title
            .unwrap_or_else(|| format!("Session {}", &session_id[..8.min(session_id.len())])),
        project,
        model,
        modified_at,
        size_bytes,
        message_count: count,
    })
}

fn resolve_transcript(path: &Path) -> Result<PathBuf> {
    if path.is_file() {
        return Ok(path.to_path_buf());
    }
    let p1 = path
        .join(".system_generated")
        .join("logs")
        .join("transcript.jsonl");
    if p1.is_file() {
        return Ok(p1);
    }
    let p2 = path.join("transcript.jsonl");
    if p2.is_file() {
        return Ok(p2);
    }
    let p3 = path
        .join(".system_generated")
        .join("logs")
        .join("transcript_full.jsonl");
    if p3.is_file() {
        return Ok(p3);
    }
    Err(AdapterError::Unrecognized(path.display().to_string()))
}

fn read_session(path: &Path) -> Result<Capture> {
    let transcript = resolve_transcript(path)?;
    let source_id = new_id();
    let mut messages = Vec::new();
    let mut project = None;
    let mut first_prompt = None;
    let mut model = None;
    let mut files = Vec::new();
    let mut missing_files = 0;

    for line in open_lines(&transcript)?.map_while(|l| l.ok()) {
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let kind = v.get("type").and_then(Value::as_str).unwrap_or("");
        let created_at = v
            .get("created_at")
            .and_then(Value::as_str)
            .map(str::to_string);
        let step_idx = v.get("step_index").and_then(Value::as_u64);
        let id = step_idx
            .map(|idx| format!("step-{}", idx))
            .unwrap_or_else(new_id);

        match kind {
            "USER_INPUT" => {
                let raw = v.get("content").and_then(Value::as_str).unwrap_or("");
                let clean = extract_user_request(raw);
                let media = v.get("media").and_then(Value::as_array);
                if clean.is_empty() && media.is_none_or(Vec::is_empty) {
                    continue;
                }
                if first_prompt.is_none() {
                    first_prompt = Some(title_from(&clean));
                }
                if project.is_none() {
                    project = extract_project(raw);
                }
                let mut blocks = Vec::new();
                if !clean.is_empty() {
                    blocks.push(Block::text(clean));
                }
                for item in media.into_iter().flatten() {
                    let uri = item.get("uri").or_else(|| item.get("url")).and_then(Value::as_str).unwrap_or("");
                    let mime = item.get("mime_type").or_else(|| item.get("mimeType")).and_then(Value::as_str).unwrap_or("");
                    match crate::text::read_local_file(uri) {
                        Some(mut file) => {
                            if !mime.is_empty() {
                                file.media_type = mime.to_string();
                            }
                            blocks.push(file.block());
                            if !files.iter().any(|saved: &hopilo_core::CapturedFile| saved.sha256() == file.sha256()) {
                                files.push(file);
                            }
                        }
                        None => {
                            missing_files += 1;
                            blocks.push(Block::Missing { description: "file shared in the Antigravity conversation".into() });
                        }
                    }
                }
                messages.push(Message {
                    id,
                    source_id: source_id.clone(),
                    role: Role::User,
                    created_at,
                    blocks,
                });
            }
            "PLANNER_RESPONSE" => {
                if model.is_none() {
                    model = Some("Gemini".to_string());
                }
                let mut blocks = Vec::new();
                if let Some(text) = v
                    .get("content")
                    .and_then(Value::as_str)
                    .filter(|s| !s.trim().is_empty())
                {
                    blocks.push(Block::text(text.trim()));
                }
                if let Some(tools) = v.get("tool_calls").and_then(Value::as_array) {
                    for tc in tools {
                        let name = tc
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("tool")
                            .to_string();
                        let input = tc
                            .get("args")
                            .map(|a| serde_json::to_string_pretty(a).unwrap_or_default())
                            .unwrap_or_default();
                        blocks.push(Block::ToolCall { name, input });
                    }
                }
                if !blocks.is_empty() {
                    messages.push(Message {
                        id,
                        source_id: source_id.clone(),
                        role: Role::Assistant,
                        created_at,
                        blocks,
                    });
                }
            }
            "GENERIC" => {
                let status = v.get("status").and_then(Value::as_str).unwrap_or("");
                let is_error = status == "ERROR";
                let text = v.get("content").and_then(Value::as_str).unwrap_or("");
                if !text.trim().is_empty() {
                    messages.push(Message {
                        id,
                        source_id: source_id.clone(),
                        role: Role::Tool,
                        created_at,
                        blocks: vec![Block::ToolResult {
                            name: None,
                            output: text.to_string(),
                            is_error,
                        }],
                    });
                }
            }
            _ => {}
        }
    }

    if messages.is_empty() {
        return Err(AdapterError::Unrecognized(transcript.display().to_string()));
    }

    let session_dir = if transcript.is_file()
        && transcript
            .file_name()
            .is_some_and(|n| n == "transcript.jsonl" || n == "transcript_full.jsonl")
    {
        transcript
            .parent()
            .and_then(Path::parent)
            .and_then(Path::parent)
            .unwrap_or(&transcript)
    } else {
        path
    };
    let session_id = session_dir
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(new_id);
    let db_title = find_summary_db(&transcript).and_then(|db| lookup_antigravity_title(&db, &session_id));
    let title = db_title
        .or(first_prompt)
        .unwrap_or_else(|| format!("Session {}", &session_id[..8.min(session_id.len())]));

    let missing_items = if missing_files == 0 {
        vec![]
    } else {
        vec![format!("{missing_files} attached file(s) referenced but not recovered")]
    };
    let source = Source {
        source_id: source_id.clone(),
        kind: SourceKind::LocalAgent,
        provider: "antigravity".into(),
        title,
        origin: Some(transcript.display().to_string()),
        project,
        model: model.or_else(|| Some("Gemini".into())),
        captured_at: now_rfc3339(),
        capture_status: if missing_items.is_empty() { CaptureStatus::Complete } else { CaptureStatus::Partial },
        missing_items,
        omitted: vec![],
    };

    Ok(Capture {
        source,
        messages,
        files,
    })
}

fn find_summary_db(start: &Path) -> Option<PathBuf> {
    for ancestor in start.ancestors() {
        let candidate = ancestor.join("conversation_summaries.db");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    if let Some(dir) = std::env::var_os("ANTIGRAVITY_DATA_DIR") {
        let candidate = PathBuf::from(dir).join("conversation_summaries.db");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    if let Some(h) = home() {
        for flavor in ["antigravity", "antigravity-ide", "antigravity-cli"] {
            let candidate = h.join(".gemini").join(flavor).join("conversation_summaries.db");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        let candidate = h.join(".antigravity").join("conversation_summaries.db");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn load_antigravity_titles(db_path: &Path) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Ok(conn) = rusqlite::Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) else {
        return map;
    };

    if let Ok(mut stmt) = conn.prepare(
        "SELECT conversation_id,
                COALESCE(
                  NULLIF(trim(title), ''),
                  NULLIF(trim(preview), '')
                )
         FROM conversation_summaries
         WHERE trim(title) != '' OR trim(preview) != ''",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        }) {
            for (id, title) in rows.flatten() {
                let clean = title_from(&title);
                if !clean.is_empty() {
                    map.insert(id, clean);
                }
            }
        }
    }

    if let Ok(mut stmt) = conn.prepare(
        "SELECT conversation_id, title FROM conversations_fts WHERE trim(title) != ''",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        }) {
            for (id, title) in rows.flatten() {
                let clean = title_from(&title);
                if !clean.is_empty() {
                    map.entry(id).or_insert(clean);
                }
            }
        }
    }

    map
}

fn lookup_antigravity_title(db_path: &Path, session_id: &str) -> Option<String> {
    let conn = rusqlite::Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ).ok()?;

    if let Ok(title) = conn.query_row(
        "SELECT COALESCE(NULLIF(trim(title), ''), NULLIF(trim(preview), ''))
         FROM conversation_summaries WHERE conversation_id = ?1",
        [session_id],
        |r| r.get::<_, Option<String>>(0),
    ) {
        if let Some(t) = title.filter(|s| !s.trim().is_empty()) {
            let clean = title_from(&t);
            if !clean.is_empty() {
                return Some(clean);
            }
        }
    }

    if let Ok(title) = conn.query_row(
        "SELECT title FROM conversations_fts WHERE conversation_id = ?1 AND trim(title) != '' LIMIT 1",
        [session_id],
        |r| r.get::<_, Option<String>>(0),
    ) {
        if let Some(t) = title.filter(|s| !s.trim().is_empty()) {
            let clean = title_from(&t);
            if !clean.is_empty() {
                return Some(clean);
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovers_and_reads_antigravity_session() {
        let dir = tempfile::tempdir().unwrap();
        let session_dir = dir.path().join("sess-1234");
        let logs_dir = session_dir.join(".system_generated").join("logs");
        std::fs::create_dir_all(&logs_dir).unwrap();

        let transcript_content = r#"{"step_index":0,"source":"USER_EXPLICIT","type":"USER_INPUT","status":"DONE","created_at":"2026-11-04T10:00:00Z","content":"<USER_REQUEST>\nBuild an awesome Rust app\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nActive Workspaces:\n- /workspace/hopilo\n</ADDITIONAL_METADATA>"}
{"step_index":1,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","created_at":"2026-11-04T10:00:02Z","content":"I will help you build it.","tool_calls":[{"name":"read_file","args":{"Path":"Cargo.toml"}}]}
{"step_index":2,"source":"MODEL","type":"GENERIC","status":"DONE","created_at":"2026-11-04T10:00:03Z","content":"[package]\nname = \"hopilo\""}
"#;
        std::fs::write(logs_dir.join("transcript.jsonl"), transcript_content).unwrap();

        let adapter = Antigravity;
        let sessions = adapter.discover(dir.path()).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].adapter, "antigravity");
        assert_eq!(sessions[0].session_id, "sess-1234");
        assert_eq!(sessions[0].title, "Build an awesome Rust app");
        assert_eq!(sessions[0].project, Some("/workspace/hopilo".into()));

        let cap = adapter.read(Path::new(&sessions[0].path)).unwrap();
        assert_eq!(cap.source.provider, "antigravity");
        assert_eq!(cap.messages.len(), 3);
        assert_eq!(cap.messages[0].role, Role::User);
        assert_eq!(cap.messages[1].role, Role::Assistant);
        assert_eq!(cap.messages[2].role, Role::Tool);
    }

    #[test]
    fn active_document_resolves_to_repository_root() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join(".git")).unwrap();
        let pages = dir.path().join("apps/desktop/src/pages");
        std::fs::create_dir_all(&pages).unwrap();
        let document = pages.join("Sessions.tsx");
        std::fs::write(&document, "").unwrap();

        let metadata = format!(
            "Active Document: {} (LANGUAGE_TYPESCRIPT)",
            document.display()
        );
        assert_eq!(
            extract_project(&metadata),
            Some(dir.path().display().to_string())
        );
    }

    #[test]
    fn command_working_directory_resolves_to_root() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join(".git")).unwrap();
        let sub = dir.path().join("sub/folder");
        std::fs::create_dir_all(&sub).unwrap();

        let metadata = format!("Command Working Directory: {}", sub.display());
        assert_eq!(
            extract_project(&metadata),
            Some(dir.path().display().to_string())
        );
    }

    #[test]
    fn protected_documents_use_shared_workspace_root() {
        let metadata = r#"Active Document: /Users/test/Documents/hopilo/apps/desktop/src/pages/Settings.tsx (LANGUAGE_TYPESCRIPT)
Other open documents:
- /Users/test/Documents/hopilo/apps/desktop/src/pages/Sessions.tsx (LANGUAGE_TYPESCRIPT)
- /Users/test/Documents/hopilo/.github/workflows/release.yml (LANGUAGE_YAML)
- /Users/test/Documents/hopilo/CHANGELOG.md (LANGUAGE_MARKDOWN)
</ADDITIONAL_METADATA>"#;
        assert_eq!(
            extract_project(metadata),
            Some("/Users/test/Documents/hopilo".into())
        );
    }

    #[test]
    fn recovers_uploaded_media() {
        let dir = tempfile::tempdir().unwrap();
        let logs = dir.path().join("session/.system_generated/logs");
        let uploaded = dir.path().join("session/.user_uploaded/image.png");
        std::fs::create_dir_all(&logs).unwrap();
        std::fs::create_dir_all(uploaded.parent().unwrap()).unwrap();
        std::fs::write(&uploaded, [137, 80, 78, 71]).unwrap();
        let line = serde_json::json!({
            "step_index": 0,
            "type": "USER_INPUT",
            "content": "<USER_REQUEST>Review this image</USER_REQUEST>",
            "media": [{ "mime_type": "image/png", "uri": uploaded.display().to_string() }]
        });
        std::fs::write(logs.join("transcript.jsonl"), format!("{line}\n")).unwrap();

        let capture = read_session(&logs.join("transcript.jsonl")).unwrap();
        assert_eq!(capture.files.len(), 1);
        assert_eq!(capture.files[0].media_type, "image/png");
        assert!(matches!(capture.messages[0].blocks[1], Block::File { .. }));
    }

    #[test]
    fn discovers_antigravity_title_from_conversation_summaries_db() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("conversation_summaries.db");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', preview TEXT NOT NULL DEFAULT '');
             INSERT INTO conversation_summaries VALUES ('sess-xyz', 'Hopilo Specification Implementation', 'preview text');"
        ).unwrap();
        drop(conn);

        let brain = dir.path().join("brain");
        let session_dir = brain.join("sess-xyz");
        let logs_dir = session_dir.join(".system_generated").join("logs");
        std::fs::create_dir_all(&logs_dir).unwrap();
        let transcript_content = r#"{"step_index":0,"source":"USER_EXPLICIT","type":"USER_INPUT","status":"DONE","created_at":"2026-11-04T10:00:00Z","content":"<USER_REQUEST>@[spec.md] implement now</USER_REQUEST>"}"#;
        std::fs::write(logs_dir.join("transcript.jsonl"), transcript_content).unwrap();

        let sessions = Antigravity.discover(&brain).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "sess-xyz");
        assert_eq!(sessions[0].title, "Hopilo Specification Implementation");

        let cap = Antigravity.read(Path::new(&sessions[0].path)).unwrap();
        assert_eq!(cap.source.title, "Hopilo Specification Implementation");
    }
}
