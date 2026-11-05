use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use hopilo_adapters::{adapter_by_id, all_adapters, AdapterInfo, DiscoveredSession};
use hopilo_core::render::estimate_tokens;
use hopilo_core::{new_id, now_rfc3339, Attachment, Block, CaptureStatus, Message, Role, Source, SourceKind};
use hopilo_database::{ActivityRow, HandoffRow, ImportOutcome, SearchHit, SessionPatch, SessionRow, Stats, Store};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::files::{self, FilePreflight};

pub struct AppState {
    pub store: Mutex<Store>,

    pub discovery: Mutex<HashMap<PathBuf, (u64, Vec<DiscoveredSession>)>>,

    pub sync_lock: Mutex<()>,
}

fn folder_fingerprint(root: &Path, depth: usize) -> u64 {
    use std::hash::{Hash, Hasher};
    fn walk(dir: &Path, depth: usize, h: &mut std::collections::hash_map::DefaultHasher) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
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
    let mut store = state.store.lock().map_err(|_| "library is busy, try again".to_string())?;
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
    if let Some(q) = app.get_webview_window("quick") {
        let _ = q.hide();
    }
    Ok(())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
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
            let cached = state.discovery.lock().ok().and_then(|c| c.get(&root).filter(|(f, _)| *f == fp).map(|(_, v)| v.clone()));
            let sessions = match cached {
                Some(v) => v,
                None => {
                    let v = a.discover(&root).unwrap_or_default();
                    if let Ok(mut c) = state.discovery.lock() {
                        c.insert(root.clone(), (fp, v.clone()));
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
    let allowed = adapter
        .default_roots()
        .iter()
        .filter_map(|r| std::fs::canonicalize(r).ok())
        .any(|root| real.starts_with(root));
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

pub(crate) fn store_captured_files(store: &mut Store, files: &[hopilo_core::CapturedFile]) -> CmdResult<Vec<Attachment>> {
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
    let mut result = SyncResult::default();
    let known = with_store(&state, |s| s.session_origins().map_err(err)).unwrap_or_default();
    let found = discover_all(app);
    result.found = found.len();
    let mut last_emit = std::time::Instant::now();
    let mut pending = false;
    for d in found {
        let prior = known.get(&d.path);
        if prior.is_some_and(|p| p.hidden || (p.updated_at >= d.modified_at && p.project == d.project)) {
            continue;
        }
        let saved = read_session(&d.adapter, &d.path).and_then(|(source, messages, files)| {
            with_store(&state, |s| {
                store_captured_files(s, &files)?;
                s.upsert_session(&source, &messages, Some(&d.modified_at)).map_err(err)
            })
        });
        match saved {
            Ok(out) if out.duplicate_of.is_some() => {}
            Ok(_) if prior.is_some() => result.updated += 1,
            Ok(_) => result.added += 1,
            Err(_) => result.failed += 1,
        }
        if result.added + result.updated > 0 {
            pending = true;
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
    files: Vec<Attachment>,
    token_estimate: usize,
}

#[tauri::command]
pub async fn get_session(app: AppHandle, id: String) -> CmdResult<SessionDetail> {
    blocking(app, move |_, state| {
        let (row, source, messages, files) = with_store(&state, |s| {
            let row = s.session_row(&id).map_err(err)?;
            let (source, messages) = s.get_source(&id).map_err(err)?;
            let files = s.session_files(&messages);
            Ok((row, source, messages, files))
        })?;
        let text: String = messages.iter().flat_map(|m| m.blocks.iter().map(|b| b.plain_text())).collect();
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportListing {
    provider: String,
    conversations: Vec<hopilo_adapters::exports::ExportConversation>,
}

#[tauri::command]
pub async fn list_chat_export(path: String) -> CmdResult<ExportListing> {
    tauri::async_runtime::spawn_blocking(move || {
        let parsed = hopilo_adapters::exports::parse_export(Path::new(&path)).map_err(err)?;
        let mut conversations: Vec<_> = parsed.conversations.into_iter().map(|(c, _)| c).collect();
        conversations.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(ExportListing { provider: parsed.provider.into(), conversations })
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn import_chat_export(app: AppHandle, path: String, ids: Vec<String>) -> CmdResult<Vec<ImportOutcome>> {
    let a2 = app.clone();
    let out = tauri::async_runtime::spawn_blocking(move || {
        let parsed = hopilo_adapters::exports::parse_export(Path::new(&path)).map_err(err)?;
        let wanted: HashSet<&String> = ids.iter().collect();
        let state = a2.state::<AppState>();
        let mut outcomes = Vec::new();
        for (meta, cap) in parsed.conversations {
            if wanted.contains(&meta.id) {
                outcomes.push(with_store(&state, |s| s.upsert_session(&cap.source, &cap.messages, Some(&meta.updated_at)).map_err(err))?);
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

fn import_handoff_blocking(app: &AppHandle, state: &State<AppState>, path: &str) -> CmdResult<Vec<String>> {
    let p = Path::new(path);
    let is_json = p.extension().is_some_and(|e| e.eq_ignore_ascii_case("json"));
    let (pack, blobs): (hopilo_core::Pack, std::collections::BTreeMap<String, Vec<u8>>) = if is_json {
        let text = std::fs::read_to_string(p).map_err(err)?;
        (hopilo_pack_format::from_json(&text).map_err(err)?, Default::default())
    } else {
        let f = std::fs::File::open(p).map_err(err)?;
        let h = hopilo_pack_format::read_handoff(f).map_err(err)?;
        (h.pack, h.attachments)
    };
    let ids = with_store(state, |s| {
        for a in &pack.attachments {
            if let Some(bytes) = blobs.get(&a.id) {
                s.insert_attachment(a, bytes).map_err(err)?;
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
        with_store(&state, |s| Ok(PreflightResult { files: expanded.iter().map(|p| files::preflight(p, s)).collect(), notes }))
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
                    Ok((a, _)) => stored.push(a),
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

fn stored_file(state: &State<AppState>, sha: &str) -> CmdResult<(Attachment, Vec<u8>)> {
    with_store(state, |s| {
        let a = s.attachment_by_sha(sha).map_err(err)?.ok_or("That file is no longer in the library")?;
        let bytes = s.attachment_bytes(sha).ok_or("That file's contents are missing from the library")?;
        Ok((a, bytes))
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
pub fn open_url(app: AppHandle, url: String) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(url, None::<&str>).map_err(err)
}

#[tauri::command]
pub fn open_folder(app: AppHandle, path: String) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("Folder does not exist: {path}"));
    }
    app.opener().open_path(path, None::<&str>).map_err(err)
}

#[tauri::command]
pub async fn open_file(app: AppHandle, sha: String) -> CmdResult<()> {
    blocking(app, move |app, state| open_file_blocking(app, &state, &sha)).await
}

fn open_file_blocking(app: &AppHandle, state: &State<AppState>, sha: &str) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    if sha.len() < 16 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Not a library file reference".into());
    }
    let (a, bytes) = stored_file(state, sha)?;
    let name: String = a.file_name.chars().map(|c| if matches!(c, '/' | '\\' | ':' | '\0') { '_' } else { c }).collect();
    let dir = app.path().app_cache_dir().map_err(err)?.join("open").join(&sha[..sha.len().min(16)]);
    std::fs::create_dir_all(&dir).map_err(err)?;
    let dest = dir.join(if name.trim().is_empty() { "file".to_string() } else { name });
    std::fs::write(&dest, bytes).map_err(err)?;
    app.opener().open_path(dest.display().to_string(), None::<&str>).map_err(err)
}

pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> CmdResult<()> {
    let tmp = path.with_extension(format!("{}.part", path.extension().and_then(|e| e.to_str()).unwrap_or("tmp")));
    std::fs::write(&tmp, bytes).map_err(err)?;
    std::fs::rename(&tmp, path).map_err(err)
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
    blocking(app, move |_, state| {
        with_store(&state, |s| s.list_handoffs(limit.unwrap_or(50)).map_err(err))
    })
    .await
}

#[tauri::command]
pub async fn recent_activity(app: AppHandle, limit: Option<i64>) -> CmdResult<Vec<ActivityRow>> {
    blocking(app, move |_, state| {
        with_store(&state, |s| s.recent_activity(limit.unwrap_or(30)).map_err(err))
    })
    .await
}

#[tauri::command]
pub async fn stats(app: AppHandle) -> CmdResult<Stats> {
    blocking(app, |_, state| with_store(&state, |s| s.stats().map_err(err))).await
}

#[tauri::command]
pub async fn search(app: AppHandle, query: String) -> CmdResult<Vec<SearchHit>> {
    blocking(app, move |_, state| {
        with_store(&state, |s| Ok(s.search(&query, 40).map_err(err)?.into_iter().filter(|h| h.kind == "source").take(20).collect()))
    })
    .await
}

#[tauri::command]
pub async fn get_settings(app: AppHandle) -> CmdResult<HashMap<String, serde_json::Value>> {
    blocking(app, move |_, state| {
        with_store(&state, |s| s.settings().map_err(err))
    })
    .await
}

#[tauri::command]
pub async fn set_setting(app: AppHandle, key: String, value: serde_json::Value) -> CmdResult<()> {
    blocking(app, move |app, state| {
        let app = app.clone();
        with_store(&state, |s| s.set_setting(&key, &value).map_err(err))?;
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
            adapters: settings.into_iter().filter_map(|(k, v)| k.strip_prefix("adapter.").map(|p| (p.to_string(), v))).collect(),
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
    fn session_path_must_be_inside_agent_root() {
        let adapter = adapter_by_id("claude-code").unwrap();
        assert!(checked_session_path(adapter.as_ref(), "/etc/hosts").is_err());
    }
}
