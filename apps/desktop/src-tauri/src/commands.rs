use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, RwLock};
use std::time::{Duration, Instant};

use hopilo_adapters::{adapter_by_id, all_adapters, AdapterInfo, DiscoveredSession};
use hopilo_core::render::estimate_tokens;
use hopilo_core::{new_id, now_rfc3339, Attachment, Block, CaptureStatus, Message, Role, Source, SourceKind};
use hopilo_database::{ActivityRow, HandoffRow, ImportOutcome, SearchHit, SessionPatch, SessionRow, Stats, Store};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::files::{self, FilePreflight};

type DiscoveryCache = HashMap<(String, PathBuf), (u64, Vec<DiscoveredSession>)>;

pub struct AppState {
    pub store: Mutex<Store>,

    pub discovery: Mutex<DiscoveryCache>,

    pub sync_lock: Mutex<()>,
    pub last_background_sync: Mutex<Option<Instant>>,
    pub settings: RwLock<HashMap<String, serde_json::Value>>,
}

impl AppState {
    pub(crate) fn setting(&self, key: &str) -> Option<serde_json::Value> {
        self.settings.read().ok()?.get(key).cloned()
    }
}

fn folder_fingerprint(root: &Path, depth: usize) -> u64 {
    use std::hash::{Hash, Hasher};
    fn walk(dir: &Path, depth: usize, h: &mut std::collections::hash_map::DefaultHasher) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        let mut entries: Vec<_> = rd.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() && depth > 0 {
                walk(&e.path(), depth - 1, h);
            } else if ft.is_file() {
                if let Ok(md) = e.metadata() {
                    e.path().hash(h);
                    md.len().hash(h);
                    md.modified().ok().hash(h);
                }
            }
        }
    }
    let mut h = std::collections::hash_map::DefaultHasher::new();
    if let Some(parent) = root.parent() {
        for name in ["conversation_summaries.db", "session_index.jsonl", "state_5.sqlite", "threads.db", "opencode.db"]
        {
            for suffix in ["", "-wal"] {
                let f = parent.join(format!("{name}{suffix}"));
                if let Ok(md) = f.metadata() {
                    f.hash(&mut h);
                    md.len().hash(&mut h);
                    md.modified().ok().hash(&mut h);
                }
            }
        }
    }
    walk(root, depth, &mut h);
    h.finish()
}

pub(crate) type CmdResult<T> = Result<T, String>;

pub(crate) fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub(crate) async fn blocking<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(&AppHandle, State<'_, AppState>) -> CmdResult<T> + Send + 'static,
) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(move || f(&app, app.state::<AppState>())).await.map_err(err)?
}

pub(crate) fn with_store<T>(state: &State<AppState>, f: impl FnOnce(&mut Store) -> Result<T, String>) -> CmdResult<T> {
    let mut store = state.store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    f(&mut store)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    data_dir: String,
    platform: String,
    adapters: Vec<AdapterInfo>,
}

#[tauri::command]
pub async fn app_info(app: AppHandle) -> CmdResult<AppInfo> {
    blocking(app, move |app, state| {
        let app = app.clone();
        let data_dir = with_store(&state, |s| Ok(s.root().display().to_string()))?;
        Ok(AppInfo {
            version: app.package_info().version.to_string(),
            data_dir,
            platform: std::env::consts::OS.into(),
            adapters: all_adapters().iter().map(|a| a.info()).collect(),
        })
    })
    .await
}

#[tauri::command]
pub fn show_main_window(app: AppHandle, route: Option<String>) -> CmdResult<()> {
    crate::show_main(&app);
    if let Some(r) = route {
        app.emit_to("main", "hopilo://navigate", r).map_err(err)?;
    }
    crate::hide_quick(&app);
    Ok(())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

pub(crate) fn save_setting_blocking(app: &AppHandle, key: &str, value: serde_json::Value) -> CmdResult<()> {
    let state = app.state::<AppState>();
    with_store(&state, |s| s.set_setting(key, &value).map_err(err))?;
    if let Ok(mut mirror) = state.settings.write() {
        mirror.insert(key.to_string(), value.clone());
    }
    let _ = app.emit("hopilo://settings-changed", (key, &value));
    Ok(())
}

pub(crate) fn notify(app: &AppHandle) {
    let _ = app.emit("hopilo://library-changed", ());
}

fn discover_all(app: &AppHandle) -> Vec<DiscoveredSession> {
    let state = app.state::<AppState>();
    let mut out: Vec<DiscoveredSession> = Vec::new();
    for a in all_adapters() {
        for root in a.default_roots() {
            if !root.is_dir() {
                continue;
            }
            let fp = folder_fingerprint(&root, a.scan_depth());
            let key = (a.id().to_string(), root.clone());
            let cached =
                state.discovery.lock().ok().and_then(|c| c.get(&key).filter(|(f, _)| *f == fp).map(|(_, v)| v.clone()));
            let sessions = match cached {
                Some(v) => v,
                None => {
                    let Ok(v) = a.discover(&root) else { continue };
                    if let Ok(mut c) = state.discovery.lock() {
                        c.insert(key, (fp, v.clone()));
                    }
                    v
                }
            };
            out.extend(sessions);
        }
    }
    dedupe_discovered(out)
}

fn dedupe_discovered(mut found: Vec<DiscoveredSession>) -> Vec<DiscoveredSession> {
    found.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    let mut seen = HashSet::new();
    found.retain(|d| seen.insert((d.adapter.clone(), d.session_id.clone())));
    found
}

fn checked_session_path(adapter: &dyn hopilo_adapters::LocalAgentAdapter, path: &str) -> CmdResult<PathBuf> {
    let (file, fragment) = match path.rsplit_once('#') {
        Some((f, frag)) => (f, Some(frag)),
        None => (path, None),
    };
    let real = std::fs::canonicalize(file).map_err(|e| format!("{file}: {e}"))?;
    let allowed =
        adapter.default_roots().iter().filter_map(|r| std::fs::canonicalize(r).ok()).any(|root| real.starts_with(root));
    if !allowed {
        return Err("That file is outside the agent's session folder".into());
    }
    Ok(match fragment {
        Some(f) => PathBuf::from(format!("{}#{f}", real.display())),
        None => real,
    })
}

fn read_session(adapter_id: &str, path: &str) -> CmdResult<(Source, Vec<Message>, Vec<hopilo_core::CapturedFile>)> {
    let adapter = adapter_by_id(adapter_id).ok_or_else(|| format!("unknown adapter {adapter_id}"))?;
    let real = checked_session_path(adapter.as_ref(), path)?;
    let cap = adapter.read(&real).map_err(err)?;
    let mut source = cap.source;

    source.origin = Some(path.to_string());
    let messages: Vec<Message> =
        cap.messages.into_iter().map(|m| Message { source_id: source.source_id.clone(), ..m }).collect();
    Ok((source, messages, cap.files))
}

pub(crate) fn store_captured_files(
    store: &mut Store,
    files: &[hopilo_core::CapturedFile],
) -> CmdResult<Vec<Attachment>> {
    files.iter().map(|f| store.insert_attachment(&f.attachment(), &f.bytes).map(|(a, _)| a).map_err(err)).collect()
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    added: usize,
    updated: usize,
    failed: usize,
    found: usize,
    busy: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum SyncMode {
    Background,
    Wait,
}

pub(crate) fn sync_blocking(app: &AppHandle, mode: SyncMode) -> SyncResult {
    if cfg!(debug_assertions) && std::env::var_os("HOPILO_TEST_NO_SYNC").is_some() {
        return SyncResult::default();
    }
    use std::sync::TryLockError;
    let state = app.state::<AppState>();
    let _guard = match mode {
        SyncMode::Wait => state.sync_lock.lock().unwrap_or_else(|p| p.into_inner()),
        SyncMode::Background => match state.sync_lock.try_lock() {
            Ok(g) => g,
            Err(TryLockError::Poisoned(p)) => p.into_inner(),
            Err(TryLockError::WouldBlock) => return SyncResult { busy: true, ..Default::default() },
        },
    };
    if mode == SyncMode::Background {
        let mut last = state.last_background_sync.lock().unwrap_or_else(|p| p.into_inner());
        if last.is_some_and(|at| at.elapsed() < Duration::from_secs(30)) {
            return SyncResult::default();
        }
        *last = Some(Instant::now());
    }
    let mut result = SyncResult::default();
    const ANTIGRAVITY_MEDIA_MIGRATION: &str = "migration.antigravityMediaV1";
    let backfill_antigravity = state.setting(ANTIGRAVITY_MEDIA_MIGRATION).and_then(|v| v.as_bool()) != Some(true);
    let mut antigravity_backfill_failed = false;
    let known = with_store(&state, |s| s.session_origins().map_err(err)).unwrap_or_default();
    let found = discover_all(app);
    result.found = found.len();
    let mut last_emit = std::time::Instant::now();
    let mut pending = false;
    for d in found {
        let prior = known.get(&d.path);
        let force_backfill = backfill_antigravity && d.adapter == "antigravity";
        if prior.is_some_and(|p| {
            p.hidden
                || (!force_backfill
                    && p.unchanged_since(&d.modified_at)
                    && p.project == d.project
                    && (p.title_edited || p.title == d.title))
        }) {
            continue;
        }
        let saved = read_session(&d.adapter, &d.path).and_then(|(source, messages, files)| {
            with_store(&state, |s| {
                store_captured_files(s, &files)?;
                s.upsert_session(&source, &messages, Some(&d.modified_at)).map_err(err)
            })
        });
        match saved {
            Ok(_) => {
                if prior.is_some() {
                    result.updated += 1;
                } else {
                    result.added += 1;
                }
                pending = true;
            }
            Err(_) => {
                result.failed += 1;
                antigravity_backfill_failed |= force_backfill;
            }
        }
        if pending && last_emit.elapsed() >= std::time::Duration::from_millis(1500) {
            notify(app);
            last_emit = std::time::Instant::now();
            pending = false;
        }
    }
    if pending {
        notify(app);
    }
    if backfill_antigravity && !antigravity_backfill_failed {
        let done = serde_json::Value::Bool(true);
        if with_store(&state, |s| s.set_setting(ANTIGRAVITY_MEDIA_MIGRATION, &done).map_err(err)).is_ok() {
            if let Ok(mut mirror) = state.settings.write() {
                mirror.insert(ANTIGRAVITY_MEDIA_MIGRATION.into(), done);
            }
        }
    }
    result
}

#[tauri::command]
pub async fn sync_sessions(app: AppHandle) -> CmdResult<SyncResult> {
    tauri::async_runtime::spawn_blocking(move || sync_blocking(&app, SyncMode::Wait)).await.map_err(err)
}

#[tauri::command]
pub async fn list_sessions(app: AppHandle) -> CmdResult<Vec<SessionRow>> {
    blocking(app, |_, state| with_store(&state, |s| s.list_sessions().map_err(err))).await
}

#[tauri::command]
pub async fn query_sessions(
    app: AppHandle,
    query: hopilo_database::SessionQuery,
) -> CmdResult<hopilo_database::SessionPage> {
    blocking(app, move |_, state| with_store(&state, |s| s.query_sessions(&query).map_err(err))).await
}

#[tauri::command]
pub async fn list_hidden_sessions(app: AppHandle) -> CmdResult<Vec<SessionRow>> {
    blocking(app, |_, state| with_store(&state, |s| s.list_hidden_sessions().map_err(err))).await
}

#[tauri::command]
pub async fn restore_session(app: AppHandle, id: String) -> CmdResult<()> {
    blocking(app, move |app, state| {
        with_store(&state, |s| s.restore_session(&id).map_err(err))?;
        notify(app);
        Ok(())
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
    row: SessionRow,
    source: Source,
    messages: Vec<Message>,
    files: Vec<hopilo_database::SessionFile>,
    token_estimate: usize,
}

#[tauri::command]
pub async fn get_session(app: AppHandle, id: String) -> CmdResult<SessionDetail> {
    blocking(app, move |_, state| {
        let (mut row, source, messages, files) = with_store(&state, |s| {
            let row = s.session_row(&id).map_err(err)?;
            let (source, messages) = s.get_source(&id).map_err(err)?;
            let files = s.session_file_entries(&id, &messages).map_err(err)?;
            Ok((row, source, messages, files))
        })?;
        row.file_count = files.len() as i64;
        let text = messages.iter().flat_map(|m| m.blocks.iter().map(|b| b.plain_text())).collect::<Vec<_>>().join("\n");
        Ok(SessionDetail { files, token_estimate: estimate_tokens(&text), row, source, messages })
    })
    .await
}

#[tauri::command]
pub async fn update_session(app: AppHandle, id: String, patch: SessionPatch) -> CmdResult<()> {
    blocking(app, move |app, state| {
        let app = app.clone();
        with_store(&state, |s| s.update_session(&id, &patch).map_err(err))?;
        notify(&app);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn remove_session(app: AppHandle, id: String) -> CmdResult<()> {
    blocking(app, move |app, state| {
        with_store(&state, |s| s.remove_session(&id).map_err(err))?;
        notify(app);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn permanently_delete_sessions(app: AppHandle, ids: Vec<String>) -> CmdResult<()> {
    blocking(app, move |app, state| {
        let _sync = state.sync_lock.lock().map_err(err)?;
        with_store(&state, |s| s.permanently_delete_sessions(&ids).map_err(err))?;
        notify(app);
        Ok(())
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportListing {
    provider: String,
    conversations: Vec<hopilo_adapters::exports::ExportConversation>,
}

#[tauri::command]
pub async fn list_chat_export(path: String) -> CmdResult<ExportListing> {
    tauri::async_runtime::spawn_blocking(move || {
        let (provider, mut conversations) = hopilo_adapters::exports::list_export(Path::new(&path)).map_err(err)?;
        conversations.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(ExportListing { provider, conversations })
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn import_chat_export(app: AppHandle, path: String, ids: Vec<String>) -> CmdResult<Vec<ImportOutcome>> {
    let a2 = app.clone();
    let out = tauri::async_runtime::spawn_blocking(move || {
        let wanted: HashSet<String> = ids.into_iter().collect();
        let parsed = hopilo_adapters::exports::parse_export_selected(Path::new(&path), &wanted).map_err(err)?;
        let state = a2.state::<AppState>();
        let mut outcomes = Vec::new();
        for (meta, cap) in parsed.conversations {
            if wanted.contains(&meta.id) {
                outcomes.push(with_store(&state, |s| {
                    store_captured_files(s, &cap.files)?;
                    s.upsert_session(&cap.source, &cap.messages, Some(&meta.updated_at)).map_err(err)
                })?);
            }
        }
        Ok::<_, String>(outcomes)
    })
    .await
    .map_err(err)??;
    notify(&app);
    Ok(out)
}

pub(crate) fn import_text_inner(
    app: AppHandle,
    state: State<AppState>,
    text: String,
    kind: String,
    title: Option<String>,
    label: Option<String>,
) -> CmdResult<ImportOutcome> {
    if text.trim().is_empty() {
        return Err("Nothing to save: the text is empty".into());
    }
    let kind_enum = match kind.as_str() {
        "clipboard" => SourceKind::Clipboard,
        _ => SourceKind::Manual,
    };
    let source_id = new_id();
    let first_line = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
    let auto_title: String = first_line.chars().take(70).collect();
    let source = Source {
        source_id: source_id.clone(),
        kind: kind_enum,
        provider: label.filter(|l| !l.trim().is_empty()).unwrap_or_else(|| kind.clone()),
        title: title.filter(|t| !t.trim().is_empty()).unwrap_or(auto_title),
        origin: None,
        project: None,
        model: None,
        captured_at: now_rfc3339(),
        capture_status: CaptureStatus::Complete,
        missing_items: vec![],
        omitted: vec![],
    };
    let msg = Message { id: new_id(), source_id, role: Role::User, created_at: None, blocks: vec![Block::text(text)] };
    let out = with_store(&state, |s| s.insert_capture(&source, &[msg]).map_err(err))?;
    notify(&app);
    Ok(out)
}

#[tauri::command]
pub async fn import_aider_history(app: AppHandle, path: String) -> CmdResult<ImportOutcome> {
    blocking(app, move |app, state| {
        let cap = hopilo_adapters::aider::read_history(Path::new(&path)).map_err(err)?;
        let out = with_store(&state, |s| s.insert_capture(&cap.source, &cap.messages).map_err(err))?;
        notify(app);
        Ok(out)
    })
    .await
}

#[tauri::command]
pub async fn import_handoff_file(app: AppHandle, path: String) -> CmdResult<Vec<String>> {
    blocking(app, move |app, state| import_handoff_blocking(app, &state, &path)).await
}

pub(crate) fn import_handoff_blocking(app: &AppHandle, state: &State<AppState>, path: &str) -> CmdResult<Vec<String>> {
    let p = Path::new(path);
    let is_json = p.extension().is_some_and(|e| e.eq_ignore_ascii_case("json"));
    let (pack, blobs): (hopilo_core::Pack, std::collections::BTreeMap<String, std::sync::Arc<Vec<u8>>>) = if is_json {
        let text = hopilo_core::limits::read_text(p).map_err(err)?;
        (hopilo_pack_format::from_json(&text).map_err(err)?, Default::default())
    } else {
        let f = std::fs::File::open(p).map_err(err)?;
        let h = hopilo_pack_format::read_handoff(f).map_err(err)?;
        (h.pack, h.attachments)
    };
    let ids = with_store(state, |s| {
        for a in &pack.attachments {
            if let Some(bytes) = blobs.get(&a.id) {
                let a = Attachment { origin_path: None, ..a.clone() };
                s.insert_attachment(&a, bytes).map_err(err)?;
            }
        }
        s.adopt_pack(&pack).map_err(err)
    })?;
    notify(app);
    Ok(ids)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightResult {
    files: Vec<FilePreflight>,
    notes: Vec<String>,
}

#[tauri::command]
pub async fn preflight_files(app: AppHandle, paths: Vec<String>) -> CmdResult<PreflightResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let (expanded, notes) = files::expand(&paths);
        let state = app.state::<AppState>();
        let is_known = |sha: &str| with_store(&state, |s| Ok(s.has_sha(sha).unwrap_or(false))).unwrap_or(false);
        Ok(PreflightResult { files: expanded.iter().map(|p| files::preflight(p, &is_known)).collect(), notes })
    })
    .await
    .map_err(err)?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddFilesResult {
    session_id: Option<String>,
    added: usize,
    errors: Vec<String>,
}

#[tauri::command]
pub async fn add_files(app: AppHandle, session: Option<String>, paths: Vec<String>) -> CmdResult<AddFilesResult> {
    let a2 = app.clone();
    let out = tauri::async_runtime::spawn_blocking(move || {
        let state = a2.state::<AppState>();
        let mut stored = Vec::new();
        let mut errors = Vec::new();
        for p in paths {
            match files::load(Path::new(&p)) {
                Ok((att, bytes)) => match with_store(&state, |s| s.insert_attachment(&att, &bytes).map_err(err)) {
                    Ok((mut a, _)) => {
                        a.file_name = att.file_name;
                        stored.push(a);
                    }
                    Err(e) => errors.push(e),
                },
                Err(e) => errors.push(e),
            }
        }
        let session_id = if stored.is_empty() {
            None
        } else {
            Some(with_store(&state, |s| s.add_files(session.as_deref(), &stored).map_err(err))?)
        };
        Ok::<_, String>(AddFilesResult { session_id, added: stored.len(), errors })
    })
    .await
    .map_err(err)??;
    notify(&app);
    Ok(out)
}

#[tauri::command]
pub async fn remove_session_file(
    app: AppHandle,
    id: String,
    message_id: String,
    sha: String,
    name: String,
) -> CmdResult<()> {
    blocking(app, move |app, state| {
        with_store(&state, |s| s.remove_session_file(&id, &message_id, &sha, &name).map_err(err))?;
        notify(app);
        Ok(())
    })
    .await
}

fn is_sha256(sha: &str) -> bool {
    sha.len() == 64 && sha.bytes().all(|b| b.is_ascii_hexdigit())
}

fn stored_file(state: &State<AppState>, sha: &str) -> CmdResult<(Attachment, Vec<u8>)> {
    if !is_sha256(sha) {
        return Err("Not a library file reference".into());
    }
    with_store(state, |s| {
        if let Some(a) = s.attachment_by_sha(sha).map_err(err)? {
            if let Some(bytes) = s.attachment_bytes(sha) {
                return Ok((a, bytes));
            }
            if let Some(origin) = &a.origin_path {
                if let Ok(bytes) = std::fs::read(origin) {
                    if hopilo_pack_format::sha256_hex(&bytes).eq_ignore_ascii_case(sha) {
                        return Ok((a, bytes));
                    }
                }
            }
            return Err("That file's contents are missing from the library".into());
        }
        if let Some(bytes) = s.attachment_bytes(sha) {
            let a = Attachment {
                id: format!("file-{sha}"),
                file_name: format!("file-{}.bin", &sha[..8.min(sha.len())]),
                media_type: "application/octet-stream".into(),
                size: bytes.len() as u64,
                sha256: sha.to_string(),
                origin_path: None,
                text: None,
            };
            return Ok((a, bytes));
        }
        Err("That file is no longer in the library".into())
    })
}

#[tauri::command]
pub async fn save_file(app: AppHandle, sha: String, path: String) -> CmdResult<String> {
    blocking(app, move |_, state| {
        let (_, bytes) = stored_file(&state, &sha)?;
        write_atomic(Path::new(&path), &bytes)?;
        Ok(path)
    })
    .await
}

#[tauri::command]
pub async fn preview_file(app: AppHandle, sha: String) -> CmdResult<String> {
    blocking(app, move |_, state| {
        use base64::Engine;
        let (attachment, bytes) = stored_file(&state, &sha)?;
        if !attachment.media_type.starts_with("image/") {
            return Err("Only images can be previewed".into());
        }
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
        Ok(format!("data:{};base64,{encoded}", attachment.media_type))
    })
    .await
}

#[tauri::command]
pub async fn read_file_preview(
    app: AppHandle,
    sha: String,
    offset: u64,
    length: u32,
) -> CmdResult<tauri::ipc::Response> {
    blocking(app, move |_, state| {
        let root = with_store(&state, |s| Ok(s.root().to_path_buf()))?;
        let bytes = files::preview_chunk(&root, &sha, offset, length).map_err(err)?;
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
}

#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    if !is_external_url(&url) {
        return Err("Only web and mail links can be opened".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(err)
}

fn is_external_url(url: &str) -> bool {
    let lower = url.trim_start().to_ascii_lowercase();
    ["https://", "http://", "mailto:"].iter().any(|p| lower.starts_with(p))
}

#[tauri::command]
pub fn open_folder(app: AppHandle, path: String) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let p = std::path::Path::new(&path);
    if !p.is_dir() {
        return Err(format!("Folder does not exist: {path}"));
    }
    if p.extension().is_some() {
        return app.opener().reveal_item_in_dir(p).map_err(err);
    }
    app.opener().open_path(path, None::<&str>).map_err(err)
}

const LAUNCHABLE_EXTS: &[&str] = &[
    "app",
    "command",
    "tool",
    "terminal",
    "sh",
    "bash",
    "zsh",
    "csh",
    "ksh",
    "fish",
    "pkg",
    "mpkg",
    "dmg",
    "scpt",
    "scptd",
    "applescript",
    "workflow",
    "action",
    "prefpane",
    "webloc",
    "inetloc",
    "fileloc",
    "url",
    "exe",
    "com",
    "bat",
    "cmd",
    "msi",
    "msix",
    "appx",
    "ps1",
    "psm1",
    "vbs",
    "vbe",
    "js",
    "jse",
    "wsf",
    "wsh",
    "hta",
    "scr",
    "pif",
    "lnk",
    "reg",
    "cpl",
    "jar",
    "desktop",
    "appimage",
    "run",
    "deb",
    "rpm",
    "py",
    "pyw",
    "pl",
    "rb",
    "php",
];

fn is_launchable(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| LAUNCHABLE_EXTS.contains(&e.to_ascii_lowercase().as_str()))
}

#[tauri::command]
pub async fn open_file(app: AppHandle, sha: String) -> CmdResult<()> {
    blocking(app, move |app, state| open_file_blocking(app, &state, &sha)).await
}

fn open_file_blocking(app: &AppHandle, state: &State<AppState>, sha: &str) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let (a, bytes) = stored_file(state, sha)?;
    let name: String =
        a.file_name
            .chars()
            .map(|c| {
                if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() {
                    '_'
                } else {
                    c
                }
            })
            .collect();
    let name = name.trim_matches(|c: char| c == '.' || c.is_whitespace()).to_string();
    let dir = app.path().app_cache_dir().map_err(err)?.join("open").join(&sha[..sha.len().min(16)]);
    std::fs::create_dir_all(&dir).map_err(err)?;
    let dest = dir.join(if name.trim().is_empty() { "file".to_string() } else { name });
    std::fs::write(&dest, bytes).map_err(err)?;
    if is_launchable(&dest.display().to_string()) {
        return app.opener().reveal_item_in_dir(&dest).map_err(err);
    }
    app.opener().open_path(dest.display().to_string(), None::<&str>).map_err(err)
}

pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> CmdResult<()> {
    use std::io::Write;
    write_atomic_with(path, |file| file.write_all(bytes).map_err(err))
}

pub(crate) fn write_atomic_with(path: &Path, write: impl FnOnce(&mut std::fs::File) -> CmdResult<()>) -> CmdResult<()> {
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or_else(|| Path::new("."));
    let mut tmp = tempfile::NamedTempFile::new_in(parent).map_err(err)?;
    write(tmp.as_file_mut())?;
    tmp.as_file().sync_all().map_err(err)?;
    tmp.persist(path).map_err(err)?;
    Ok(())
}

#[tauri::command]
pub async fn import_text(
    app: AppHandle,
    text: String,
    kind: String,
    title: Option<String>,
    label: Option<String>,
) -> CmdResult<ImportOutcome> {
    blocking(app, move |app, state| import_text_inner(app.clone(), state, text, kind, title, label)).await
}

#[tauri::command]
pub async fn list_handoffs(app: AppHandle, limit: Option<i64>) -> CmdResult<Vec<HandoffRow>> {
    blocking(app, move |_, state| with_store(&state, |s| s.list_handoffs(limit.unwrap_or(50)).map_err(err))).await
}

#[tauri::command]
pub async fn recent_activity(app: AppHandle, limit: Option<i64>) -> CmdResult<Vec<ActivityRow>> {
    blocking(app, move |_, state| with_store(&state, |s| s.recent_activity(limit.unwrap_or(30)).map_err(err))).await
}

#[tauri::command]
pub async fn stats(app: AppHandle) -> CmdResult<Stats> {
    blocking(app, |_, state| with_store(&state, |s| s.stats().map_err(err))).await
}

#[tauri::command]
pub async fn search(app: AppHandle, query: String) -> CmdResult<Vec<SearchHit>> {
    blocking(app, move |_, state| with_store(&state, |s| s.search_kind(&query, "source", 20).map_err(err))).await
}

#[tauri::command]
pub async fn get_settings(app: AppHandle) -> CmdResult<HashMap<String, serde_json::Value>> {
    blocking(app, move |_, state| with_store(&state, |s| s.settings().map_err(err))).await
}

#[tauri::command]
pub async fn set_setting(app: AppHandle, key: String, value: serde_json::Value) -> CmdResult<()> {
    blocking(app, move |app, state| {
        let app = app.clone();
        with_store(&state, |s| s.set_setting(&key, &value).map_err(err))?;
        if let Ok(mut mirror) = state.settings.write() {
            mirror.insert(key.clone(), value.clone());
        }
        let _ = app.emit("hopilo://settings-changed", (&key, &value));
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn integrity_check(app: AppHandle) -> CmdResult<String> {
    blocking(app, |_, state| with_store(&state, |s| s.integrity_check().map_err(err))).await
}

#[tauri::command]
pub async fn audit_library(app: AppHandle) -> CmdResult<hopilo_database::AuditReport> {
    blocking(app, |_, state| {
        let root = with_store(&state, |s| Ok(s.root().to_path_buf()))?;
        Store::open_reader(&root).map_err(err)?.audit().map_err(err)
    })
    .await
}

#[tauri::command]
pub async fn wipe_library(app: AppHandle) -> CmdResult<()> {
    blocking(app, |app, state| {
        with_store(&state, |s| s.wipe().map_err(err))?;
        if let Ok(mut c) = state.discovery.lock() {
            c.clear();
        }
        notify(app);
        Ok(())
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStatus {
    extension_id: String,
    extension_dir: Option<String>,
    firefox_extension_dir: Option<String>,
    host_binary: Option<String>,
    host_binary_exists: bool,
    browsers: Vec<crate::browser::BrowserTarget>,
    last_seen: Option<String>,
    extension_version: Option<String>,
    adapters: HashMap<String, serde_json::Value>,
}

#[tauri::command]
pub async fn browser_status(app: AppHandle) -> CmdResult<BrowserStatus> {
    blocking(app, move |_, state| {
        let settings = with_store(&state, |s| s.settings().map_err(err))?;
        let host = crate::browser::host_binary();
        Ok(BrowserStatus {
            extension_id: crate::browser::EXTENSION_ID.into(),
            extension_dir: crate::browser::extension_dir().map(|p| p.display().to_string()),
            firefox_extension_dir: crate::browser::firefox_extension_dir().map(|p| p.display().to_string()),
            host_binary_exists: host.as_ref().is_some_and(|h| h.is_file()),
            host_binary: host.map(|h| h.display().to_string()),
            browsers: crate::browser::targets(),
            last_seen: settings.get("browser.lastSeen").and_then(|v| v.as_str()).map(str::to_string),
            extension_version: settings.get("browser.extensionVersion").and_then(|v| v.as_str()).map(str::to_string),
            adapters: settings
                .into_iter()
                .filter_map(|(k, v)| k.strip_prefix("adapter.").map(|p| (p.to_string(), v)))
                .collect(),
        })
    })
    .await
}

#[tauri::command]
pub async fn register_browser_host(ids: Vec<String>) -> CmdResult<Vec<String>> {
    tauri::async_runtime::spawn_blocking(move || crate::browser::register(&ids)).await.map_err(err)?
}

#[tauri::command]
pub async fn unregister_browser_host(app: AppHandle, ids: Vec<String>) -> CmdResult<Vec<String>> {
    let res = tauri::async_runtime::spawn_blocking(move || crate::browser::unregister(&ids)).await.map_err(err)??;
    blocking(app.clone(), move |app, state| {
        let targets = crate::browser::targets();
        let any_registered = targets.iter().any(|b| b.registered);
        if !any_registered {
            with_store(&state, |s| {
                let _ = s.remove_setting("browser.lastSeen");
                let _ = s.remove_setting("browser.extensionVersion");
                Ok(())
            })?;
            let _ = app.emit("hopilo://settings-changed", ("browser.lastSeen", &serde_json::Value::Null));
        }
        notify(app);
        Ok(())
    })
    .await?;
    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deleted_hidden_session_returns_only_when_discovered_in_an_existing_source() {
        use hopilo_adapters::{codex::Codex, LocalAgentAdapter};
        let dir = tempfile::tempdir().unwrap();
        let sessions = dir.path().join("sessions");
        std::fs::create_dir(&sessions).unwrap();
        let source_file = sessions.join("rollout-source.jsonl");
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../fixtures/codex/rollout-2026-11-01T09-00-00-sample.jsonl");
        std::fs::copy(fixture, &source_file).unwrap();
        let original = std::fs::read(&source_file).unwrap();
        let mut store = Store::open(&dir.path().join("library")).unwrap();
        let capture = Codex.read(&source_file).unwrap();
        let id = store.upsert_session(&capture.source, &capture.messages, None).unwrap().source_id;
        store.remove_session(&id).unwrap();
        store.permanently_delete_sessions(&[id]).unwrap();
        assert!(store.list_sessions().unwrap().is_empty());
        assert!(store.session_origins().unwrap().is_empty());
        let discovered = Codex.discover(&sessions).unwrap();
        assert_eq!(discovered.len(), 1);
        let capture = Codex.read(Path::new(&discovered[0].path)).unwrap();
        let imported =
            store.upsert_session(&capture.source, &capture.messages, Some(&discovered[0].modified_at)).unwrap();
        assert_eq!(store.list_sessions().unwrap().len(), 1);
        assert_eq!(std::fs::read(&source_file).unwrap(), original);
        store.remove_session(&imported.source_id).unwrap();
        store.permanently_delete_sessions(&[imported.source_id]).unwrap();
        std::fs::remove_file(&source_file).unwrap();
        assert!(Codex.discover(&sessions).unwrap().is_empty());
        assert!(store.list_sessions().unwrap().is_empty());
    }

    #[test]
    fn chatgpt_import_export_reimport_flow_preserves_branch_and_source_file() {
        use hopilo_core::render::RenderOptions;
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/exports/chatgpt-conversations.json");
        let before = std::fs::read(&path).unwrap();
        let (provider, list) = hopilo_adapters::exports::list_export(&path).unwrap();
        assert_eq!(provider, "chatgpt");
        assert_eq!(list.len(), 1);
        let selected = HashSet::from([list[0].id.clone()]);
        let parsed = hopilo_adapters::exports::parse_export_selected(&path, &selected).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(dir.path()).unwrap();
        let (meta, capture) = &parsed.conversations[0];
        let id = store.upsert_session(&capture.source, &capture.messages, Some(&meta.updated_at)).unwrap().source_id;
        assert!(store
            .upsert_session(&capture.source, &capture.messages, Some(&meta.updated_at))
            .unwrap()
            .duplicate_of
            .is_some());
        let pack = store.compose(std::slice::from_ref(&id)).unwrap();
        let text = hopilo_core::render::render_handoff_prompt(&pack, &RenderOptions::default());
        assert!(text.contains("composite index"));
        assert!(!text.contains("Abandoned first answer"));
        let dest = dir.path().join("export.hopilo");
        write_atomic_with(&dest, |file| {
            hopilo_pack_format::write_handoff(&pack, &RenderOptions::default(), &|_| None, file).map_err(err)
        })
        .unwrap();
        let imported = hopilo_pack_format::read_handoff(std::fs::File::open(dest).unwrap()).unwrap();
        let restored_dir = tempfile::tempdir().unwrap();
        let mut restored = Store::open(restored_dir.path()).unwrap();
        let ids = restored.adopt_pack(&imported.pack).unwrap();
        assert_eq!(restored.get_source(&ids[0]).unwrap().1, capture.messages);
        assert_eq!(std::fs::read(path).unwrap(), before);
    }

    #[test]
    fn failed_streamed_export_leaves_previous_destination_intact() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("export.json");
        std::fs::write(&path, "previous export").unwrap();
        assert!(write_atomic_with(&path, |file| {
            file.write_all(b"incomplete").map_err(err)?;
            Err("simulated failure".into())
        })
        .is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"previous export");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn atomic_exports_replace_destination_without_touching_part_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("export.md");
        let unrelated = dir.path().join("export.md.part");
        std::fs::write(&path, "old").unwrap();
        std::fs::write(&unrelated, "keep").unwrap();
        write_atomic(&path, b"new complete export").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new complete export");
        assert_eq!(std::fs::read(&unrelated).unwrap(), b"keep");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
    }

    #[test]
    fn discovery_fingerprint_tracks_parent_database_wal() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("sessions");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(dir.path().join("state_5.sqlite"), "unchanged database").unwrap();
        let before = folder_fingerprint(&root, 4);
        let wal = dir.path().join("state_5.sqlite-wal");
        std::fs::write(&wal, "new committed title").unwrap();
        let after = folder_fingerprint(&root, 4);
        assert_ne!(before, after);
        assert_eq!(after, folder_fingerprint(&root, 4));
        std::fs::write(&wal, "another committed title with a new size").unwrap();
        assert_ne!(after, folder_fingerprint(&root, 4));
    }

    fn found(adapter: &str, id: &str, modified: &str, path: &str) -> DiscoveredSession {
        DiscoveredSession {
            adapter: adapter.into(),
            path: path.into(),
            session_id: id.into(),
            title: String::new(),
            project: None,
            model: None,
            modified_at: modified.into(),
            size_bytes: 0,
            message_count: 1,
        }
    }

    #[test]
    fn duplicate_sessions_across_roots_keep_newest() {
        let out = dedupe_discovered(vec![
            found("antigravity", "a", "2026-01-01T00:00:00Z", "/old"),
            found("antigravity", "a", "2026-02-01T00:00:00Z", "/new"),
            found("codex", "a", "2026-01-01T00:00:00Z", "/codex"),
        ]);
        assert_eq!(out.len(), 2);
        assert!(out.iter().any(|d| d.path == "/new"));
        assert!(!out.iter().any(|d| d.path == "/old"));
    }

    #[test]
    fn only_web_and_mail_links_open_externally() {
        assert!(is_external_url("https://github.com/kiron0/hopilo"));
        assert!(is_external_url("mailto:a@b.c"));
        assert!(!is_external_url("file:///etc/passwd"));
        assert!(!is_external_url("javascript:alert(1)"));
        assert!(!is_external_url("/Applications/Calculator.app"));
    }

    #[test]
    fn launchable_files_are_not_opened_directly() {
        assert!(is_launchable("/tmp/x/notes.command"));
        assert!(is_launchable("/tmp/x/Setup.EXE"));
        assert!(is_launchable("run.sh"));
        assert!(!is_launchable("diagram.png"));
        assert!(!is_launchable("README"));
        assert!(!is_launchable("report.pdf"));
    }

    #[test]
    fn session_path_must_be_inside_agent_root() {
        let adapter = adapter_by_id("claude-code").unwrap();
        assert!(checked_session_path(adapter.as_ref(), "/etc/hosts").is_err());
    }
}
