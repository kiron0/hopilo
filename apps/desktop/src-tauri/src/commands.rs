//! IPC commands for the dashboard and Quick Panel. Every command is local:
//! nothing here opens a network connection.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use hopilo_adapters::{adapter_by_id, all_adapters, AdapterInfo, DiscoveredSession};
use hopilo_core::brief::ContextLevel;
use hopilo_core::render::{estimate_tokens, render_handoff_prompt, render_markdown, RenderOptions, ToolDetail};
use hopilo_core::scan::{scan_pack, Finding};
use hopilo_core::{
    new_id, now_rfc3339, Attachment, Block, CaptureStatus, ContextBrief, Integrity, Message, Mode, Pack, Role,
    Source, SourceKind, SCHEMA_VERSION,
};
use hopilo_database::{ActivityRow, HandoffRow, ImportOutcome, PackRow, SearchHit, SourceRow, Stats, Store, VersionRow};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::files::{self, FilePreflight};

pub struct AppState {
    pub store: Mutex<Store>,
    /// Discovery results per agent folder, reused while nothing in the
    /// folder has changed (same files, sizes and modification times).
    pub discovery: Mutex<HashMap<PathBuf, (u64, Vec<DiscoveredSession>)>>,
}

/// How deep each agent keeps its session files below its root; the change
/// detector looks no deeper, so unrelated subfolders (tool output, git
/// snapshots) are never walked.
fn scan_depth(adapter: &str) -> usize {
    match adapter {
        "opencode" => 0,
        "claude-code" => 1,
        "gemini-cli" | "qwen-code" => 2,
        _ => 4,
    }
}

/// Cheap change detector for an agent folder: hashes file names, sizes and
/// modification times without reading contents.
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

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub(crate) fn with_store<T>(state: &State<AppState>, f: impl FnOnce(&mut Store) -> Result<T, String>) -> CmdResult<T> {
    let mut store = state.store.lock().map_err(|_| "library is busy, try again".to_string())?;
    f(&mut store)
}

// ---- app ------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    data_dir: String,
    platform: String,
    adapters: Vec<AdapterInfo>,
}

#[tauri::command]
pub fn app_info(app: AppHandle, state: State<AppState>) -> CmdResult<AppInfo> {
    let data_dir = with_store(&state, |s| Ok(s.root().display().to_string()))?;
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        data_dir,
        platform: std::env::consts::OS.into(),
        adapters: all_adapters().iter().map(|a| a.info()).collect(),
    })
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

/// Tell other windows the library changed so they refresh.
pub(crate) fn notify(app: &AppHandle) {
    let _ = app.emit("hopilo://library-changed", ());
}

// ---- local agent sessions ---------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredRow {
    #[serde(flatten)]
    pub(crate) session: DiscoveredSession,
    imported_source_id: Option<String>,
    imported_at: Option<String>,
    /// File changed since the last capture.
    changed_since_import: bool,
}

#[tauri::command]
pub async fn discover_sessions(app: AppHandle) -> CmdResult<Vec<DiscoveredRow>> {
    let imported = {
        let state = app.state::<AppState>();
        with_store(&state, |s| s.imported_origins().map_err(err))?
    };
    let a2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = a2.state::<AppState>();
        let mut rows = Vec::new();
        for a in all_adapters() {
            for root in a.default_roots() {
                if !root.is_dir() {
                    continue;
                }
                // OpenCode keeps everything in one database at the folder root;
                // its subfolders hold git snapshots that are slow to walk.
                let fp = folder_fingerprint(&root, scan_depth(a.id()));
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
                for session in sessions {
                    let hit = imported.get(&session.path);
                    rows.push(DiscoveredRow {
                        changed_since_import: hit.is_some_and(|(_, at)| session.modified_at > *at),
                        imported_source_id: hit.map(|(id, _)| id.clone()),
                        imported_at: hit.map(|(_, at)| at.clone()),
                        session,
                    });
                }
            }
        }
        rows.sort_by(|a, b| b.session.modified_at.cmp(&a.session.modified_at));
        rows
    })
    .await
    .map_err(err)
}

/// Only files inside an adapter's own session folder may be read, so this
/// command cannot be used to read arbitrary files. A `#fragment` (one
/// session inside a database file) is kept as-is.
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

/// Read and normalize a session file. Runs without the library lock, so a
/// large session never blocks other screens.
fn read_session(adapter_id: &str, path: &str) -> CmdResult<(Source, Vec<Message>)> {
    let adapter = adapter_by_id(adapter_id).ok_or_else(|| format!("unknown adapter {adapter_id}"))?;
    let real = checked_session_path(adapter.as_ref(), path)?;
    let cap = adapter.read(&real).map_err(err)?;
    let mut source = cap.source;
    // Keep the origin as discovered so the library can match it later.
    source.origin = Some(path.to_string());
    let messages: Vec<Message> =
        cap.messages.into_iter().map(|m| Message { source_id: source.source_id.clone(), ..m }).collect();
    Ok((source, messages))
}

#[tauri::command]
pub async fn import_session(app: AppHandle, adapter: String, path: String) -> CmdResult<ImportOutcome> {
    let a2 = app.clone();
    let out = tauri::async_runtime::spawn_blocking(move || {
        let (source, messages) = read_session(&adapter, &path)?;
        let state = a2.state::<AppState>();
        with_store(&state, |s| s.insert_capture(&source, &messages).map_err(err))
    })
    .await
    .map_err(err)??;
    notify(&app);
    Ok(out)
}

// ---- account data exports (ChatGPT, Claude.ai) ------------------------------

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
            if !wanted.contains(&meta.id) {
                continue;
            }
            outcomes.push(with_store(&state, |s| s.insert_capture(&cap.source, &cap.messages).map_err(err))?);
        }
        Ok::<_, String>(outcomes)
    })
    .await
    .map_err(err)??;
    notify(&app);
    Ok(out)
}

// ---- text / clipboard / manual ---------------------------------------------

#[tauri::command]
pub fn import_text(
    app: AppHandle,
    state: State<AppState>,
    text: String,
    kind: String,
    title: Option<String>,
    label: Option<String>,
) -> CmdResult<ImportOutcome> {
    if text.trim().is_empty() {
        return Err("Nothing to import — the text is empty".into());
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

// ---- library: sources --------------------------------------------------------

#[tauri::command]
pub fn list_sources(state: State<AppState>) -> CmdResult<Vec<SourceRow>> {
    with_store(&state, |s| s.list_sources().map_err(err))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDetail {
    source: Source,
    messages: Vec<Message>,
    token_estimate: usize,
}

#[tauri::command]
pub fn get_source(state: State<AppState>, id: String) -> CmdResult<SourceDetail> {
    with_store(&state, |s| {
        let (source, messages) = s.get_source(&id).map_err(err)?;
        let text: String = messages.iter().flat_map(|m| m.blocks.iter().map(|b| b.plain_text())).collect();
        Ok(SourceDetail { token_estimate: estimate_tokens(&text), source, messages })
    })
}

#[tauri::command]
pub fn delete_source(app: AppHandle, state: State<AppState>, id: String) -> CmdResult<()> {
    with_store(&state, |s| s.delete_source(&id).map_err(err))?;
    notify(&app);
    Ok(())
}

// ---- attachments ---------------------------------------------------------------

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
pub struct ImportFilesResult {
    attachments: Vec<Attachment>,
    errors: Vec<String>,
}

#[tauri::command]
pub async fn import_files(app: AppHandle, paths: Vec<String>) -> CmdResult<ImportFilesResult> {
    let a2 = app.clone();
    let out = tauri::async_runtime::spawn_blocking(move || {
        let state = a2.state::<AppState>();
        let mut attachments = Vec::new();
        let mut errors = Vec::new();
        for p in paths {
            match files::load(Path::new(&p)) {
                Ok((att, bytes)) => match with_store(&state, |s| s.insert_attachment(&att, &bytes).map_err(err)) {
                    Ok((a, _)) => attachments.push(a),
                    Err(e) => errors.push(e),
                },
                Err(e) => errors.push(e),
            }
        }
        ImportFilesResult { attachments, errors }
    })
    .await
    .map_err(err)?;
    notify(&app);
    Ok(out)
}

#[tauri::command]
pub fn list_attachments(state: State<AppState>) -> CmdResult<Vec<Attachment>> {
    with_store(&state, |s| s.list_attachments().map_err(err))
}

#[tauri::command]
pub fn delete_attachment(app: AppHandle, state: State<AppState>, id: String) -> CmdResult<()> {
    with_store(&state, |s| s.delete_attachment(&id).map_err(err))?;
    notify(&app);
    Ok(())
}

// ---- packs ------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BuildItem {
    #[serde(rename_all = "camelCase")]
    Source {
        id: String,
        /// None = every message (Full); Some = only these (Selected).
        #[serde(default)]
        message_ids: Option<Vec<String>>,
    },
    Attachment { id: String },
    /// Carry over everything from an existing pack version.
    Pack { id: String, version: Option<u32> },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildRequest {
    /// When set, the result is saved as a new version of this pack.
    pack_id: Option<String>,
    title: String,
    items: Vec<BuildItem>,
    #[serde(default)]
    note: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    label: Option<String>,
}

fn assemble(store: &Store, req: &BuildRequest) -> CmdResult<Pack> {
    let mut sources: Vec<Source> = Vec::new();
    let mut messages: Vec<Message> = Vec::new();
    let mut attachments: Vec<Attachment> = Vec::new();
    let mut seen_sources = HashSet::new();
    let mut seen_atts = HashSet::new();
    let mut any_selected = false;

    for item in &req.items {
        match item {
            BuildItem::Source { id, message_ids } => {
                if !seen_sources.insert(id.clone()) {
                    continue;
                }
                let (source, msgs) = store.get_source(id).map_err(err)?;
                let keep: Option<HashSet<&String>> = message_ids.as_ref().map(|ids| ids.iter().collect());
                if keep.is_some() {
                    any_selected = true;
                }
                messages.extend(msgs.into_iter().filter(|m| keep.as_ref().is_none_or(|k| k.contains(&m.id))));
                sources.push(source);
            }
            BuildItem::Attachment { id } => {
                if seen_atts.insert(id.clone()) {
                    attachments.push(store.get_attachment(id).map_err(err)?);
                }
            }
            BuildItem::Pack { id, version } => {
                let p = store.get_pack(id, *version).map_err(err)?;
                if p.mode == Mode::Selected {
                    any_selected = true;
                }
                for s in p.sources {
                    if seen_sources.insert(s.source_id.clone()) {
                        sources.push(s);
                    }
                }
                messages.extend(p.messages);
                for a in p.attachments {
                    if seen_atts.insert(a.id.clone()) {
                        attachments.push(a);
                    }
                }
            }
        }
    }
    if sources.is_empty() && attachments.is_empty() && req.note.as_deref().is_none_or(|n| n.trim().is_empty()) {
        return Err("Add at least one session, file or note to build a pack".into());
    }
    let title = Some(req.title.trim())
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .or_else(|| sources.first().map(|s| s.title.clone()))
        .or_else(|| attachments.first().map(|a| a.file_name.clone()))
        .unwrap_or_else(|| "Untitled pack".into());
    Ok(Pack {
        schema_version: SCHEMA_VERSION.into(),
        pack_id: String::new(),
        title,
        version: 0,
        created_at: String::new(),
        mode: if any_selected { Mode::Selected } else { Mode::Full },
        sources,
        messages,
        context: ContextBrief { note: req.note.clone().filter(|n| !n.trim().is_empty()), ..Default::default() },
        attachments,
        tags: req.tags.clone(),
        integrity: Integrity::default(),
    })
}

#[tauri::command]
pub fn build_pack(app: AppHandle, state: State<AppState>, req: BuildRequest) -> CmdResult<Pack> {
    let pack = with_store(&state, |s| {
        let pack = assemble(s, &req)?;
        match &req.pack_id {
            Some(id) => s.add_version(id, pack, req.label.as_deref()).map_err(err),
            None => s.create_pack(pack, req.label.as_deref()).map_err(err),
        }
    })?;
    notify(&app);
    Ok(pack)
}

/// One-step Flow B: capture a local session (reusing an identical earlier
/// capture) and build a Full pack from it.
#[tauri::command]
pub async fn quick_pack_from_session(app: AppHandle, adapter: String, path: String) -> CmdResult<Pack> {
    let a2 = app.clone();
    let pack = tauri::async_runtime::spawn_blocking(move || quick_pack_blocking(&a2, &adapter, &path)).await.map_err(err)??;
    notify(&app);
    Ok(pack)
}

/// Capture + Full pack, on the calling thread (blocking file reads).
pub(crate) fn quick_pack_blocking(app: &AppHandle, adapter: &str, path: &str) -> CmdResult<Pack> {
    {
        let (source, messages) = read_session(adapter, path)?;
        let state = app.state::<AppState>();
        with_store(&state, |s| {
            let out = s.insert_capture(&source, &messages).map_err(err)?;
            let req = BuildRequest {
                pack_id: None,
                title: String::new(),
                items: vec![BuildItem::Source { id: out.source_id, message_ids: None }],
                note: None,
                tags: vec![],
                label: Some("Quick handoff".into()),
            };
            let pack = assemble(s, &req)?;
            s.create_pack(pack, req.label.as_deref()).map_err(err)
        })
    }
}

#[tauri::command]
pub fn list_packs(state: State<AppState>) -> CmdResult<Vec<PackRow>> {
    with_store(&state, |s| s.list_packs().map_err(err))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackDetail {
    pack: Pack,
    versions: Vec<VersionRow>,
}

#[tauri::command]
pub fn get_pack(state: State<AppState>, id: String, version: Option<u32>) -> CmdResult<PackDetail> {
    with_store(&state, |s| {
        Ok(PackDetail { pack: s.get_pack(&id, version).map_err(err)?, versions: s.list_versions(&id).map_err(err)? })
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackPatch {
    title: Option<String>,
    favorite: Option<bool>,
    pinned: Option<bool>,
    archived: Option<bool>,
}

#[tauri::command]
pub fn update_pack(app: AppHandle, state: State<AppState>, id: String, patch: PackPatch) -> CmdResult<()> {
    let title = patch.title.as_deref().map(str::trim).filter(|t| !t.is_empty());
    with_store(&state, |s| s.update_pack(&id, title, patch.favorite, patch.pinned, patch.archived).map_err(err))?;
    notify(&app);
    Ok(())
}

#[tauri::command]
pub fn delete_pack(app: AppHandle, state: State<AppState>, id: String) -> CmdResult<()> {
    with_store(&state, |s| s.delete_pack(&id).map_err(err))?;
    notify(&app);
    Ok(())
}

#[tauri::command]
pub fn duplicate_pack(app: AppHandle, state: State<AppState>, id: String) -> CmdResult<Pack> {
    let p = with_store(&state, |s| s.duplicate_pack(&id).map_err(err))?;
    notify(&app);
    Ok(p)
}

/// Restore an old version by saving its content as a new version (LIB-05).
#[tauri::command]
pub fn restore_version(app: AppHandle, state: State<AppState>, id: String, version: u32) -> CmdResult<Pack> {
    let p = with_store(&state, |s| {
        let old = s.get_pack(&id, Some(version)).map_err(err)?;
        s.add_version(&id, old, Some(&format!("Restored from v{version}"))).map_err(err)
    })?;
    notify(&app);
    Ok(p)
}

// ---- preview / export ---------------------------------------------------------------

#[derive(Deserialize, Clone, Copy, Default)]
#[serde(rename_all = "camelCase")]
pub enum ToolDetailOpt {
    Full,
    #[default]
    Truncated,
    Omit,
}

pub(crate) fn render_opts(t: ToolDetailOpt, level: Option<ContextLevel>) -> RenderOptions {
    RenderOptions {
        level: level.unwrap_or_default(),
        tool_detail: match t {
            ToolDetailOpt::Full => ToolDetail::Full,
            ToolDetailOpt::Truncated => ToolDetail::Truncated { limit: 2000 },
            ToolDetailOpt::Omit => ToolDetail::Omit,
        },
        ..Default::default()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingItem {
    source: String,
    item: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    text: String,
    token_estimate: usize,
    findings: Vec<Finding>,
    missing: Vec<MissingItem>,
    omitted: Vec<MissingItem>,
    /// Files that are not inlined and must be attached by hand.
    attach_manually: Vec<String>,
    /// Files listed in the pack whose bytes are no longer in the library.
    unavailable: Vec<String>,
    message_count: usize,
}

#[tauri::command]
pub fn preview_pack(
    state: State<AppState>,
    id: String,
    version: Option<u32>,
    view: String,
    tool_detail: Option<ToolDetailOpt>,
    level: Option<ContextLevel>,
) -> CmdResult<Preview> {
    with_store(&state, |s| {
        let pack = s.get_pack(&id, version).map_err(err)?;
        let opts = render_opts(tool_detail.unwrap_or_default(), level);
        let text = if view == "prompt" { render_handoff_prompt(&pack, &opts) } else { render_markdown(&pack, &opts) };
        let mut missing = Vec::new();
        let mut omitted = Vec::new();
        for src in &pack.sources {
            missing.extend(src.missing_items.iter().map(|i| MissingItem { source: src.title.clone(), item: i.clone() }));
            omitted.extend(
                src.omitted.iter().map(|o| MissingItem { source: src.title.clone(), item: format!("{} × {}", o.count, o.what) }),
            );
        }
        Ok(Preview {
            token_estimate: estimate_tokens(&text),
            findings: scan_pack(&pack, None),
            missing,
            omitted,
            attach_manually: pack.attachments.iter().filter(|a| a.text.is_none()).map(|a| a.file_name.clone()).collect(),
            unavailable: pack
                .attachments
                .iter()
                .filter(|a| s.attachment_bytes(&a.sha256).is_none())
                .map(|a| a.file_name.clone())
                .collect(),
            message_count: pack.messages.len(),
            text,
        })
    })
}

#[tauri::command]
pub fn suggest_export_name(state: State<AppState>, id: String, version: Option<u32>, ext: String) -> CmdResult<String> {
    with_store(&state, |s| Ok(hopilo_pack_format::export_filename(&s.get_pack(&id, version).map_err(err)?, &ext)))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> CmdResult<()> {
    let tmp = path.with_extension(format!("{}.part", path.extension().and_then(|e| e.to_str()).unwrap_or("tmp")));
    std::fs::write(&tmp, bytes).map_err(err)?;
    std::fs::rename(&tmp, path).map_err(err)
}

#[tauri::command]
pub fn export_pack(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    version: Option<u32>,
    format: String,
    path: String,
    tool_detail: Option<ToolDetailOpt>,
    level: Option<ContextLevel>,
) -> CmdResult<String> {
    let dest = PathBuf::from(&path);
    let opts = render_opts(tool_detail.unwrap_or_default(), level);
    with_store(&state, |s| {
        let pack = s.get_pack(&id, version).map_err(err)?;
        match format.as_str() {
            "md" => write_atomic(&dest, render_markdown(&pack, &opts).as_bytes())?,
            "txt" => write_atomic(&dest, render_handoff_prompt(&pack, &opts).as_bytes())?,
            "json" => write_atomic(&dest, hopilo_pack_format::to_json(&pack).map_err(err)?.as_bytes())?,
            "handoff" => {
                let mut buf = std::io::Cursor::new(Vec::new());
                hopilo_pack_format::write_handoff(&pack, &opts, &|a| s.attachment_bytes(&a.sha256), &mut buf)
                    .map_err(err)?;
                write_atomic(&dest, &buf.into_inner())?;
            }
            other => return Err(format!("unknown export format {other}")),
        }
        s.record_handoff(&id, pack.version, "file", &format!("export-{format}"), "exported").map_err(err)?;
        Ok(())
    })?;
    notify(&app);
    Ok(dest.display().to_string())
}

/// Import a `.handoff` archive or pack `.json` as a new pack.
#[tauri::command]
pub fn import_pack_file(app: AppHandle, state: State<AppState>, path: String) -> CmdResult<Pack> {
    let p = Path::new(&path);
    let is_json = p.extension().is_some_and(|e| e.eq_ignore_ascii_case("json"));
    let pack = with_store(&state, |s| {
        let (pack, blobs) = if is_json {
            let text = std::fs::read_to_string(p).map_err(err)?;
            (hopilo_pack_format::from_json(&text).map_err(err)?, Default::default())
        } else {
            let f = std::fs::File::open(p).map_err(err)?;
            let h = hopilo_pack_format::read_handoff(f).map_err(err)?;
            (h.pack, h.attachments)
        };
        let mut atts = Vec::new();
        for a in &pack.attachments {
            match blobs.get(&a.id) {
                Some(bytes) => atts.push(s.insert_attachment(a, bytes).map_err(err)?.0),
                None => atts.push(a.clone()),
            }
        }
        let pack = Pack { attachments: atts, ..pack };
        s.create_pack(pack, Some("Imported")).map_err(err)
    })?;
    notify(&app);
    Ok(pack)
}

#[tauri::command]
pub fn record_handoff(
    app: AppHandle,
    state: State<AppState>,
    pack_id: String,
    version: u32,
    target: String,
    method: String,
    status: String,
) -> CmdResult<String> {
    let id = with_store(&state, |s| s.record_handoff(&pack_id, version, &target, &method, &status).map_err(err))?;
    notify(&app);
    Ok(id)
}

#[tauri::command]
pub fn list_handoffs(state: State<AppState>, limit: Option<i64>) -> CmdResult<Vec<HandoffRow>> {
    with_store(&state, |s| s.list_handoffs(limit.unwrap_or(50)).map_err(err))
}

#[tauri::command]
pub fn recent_activity(state: State<AppState>, limit: Option<i64>) -> CmdResult<Vec<ActivityRow>> {
    with_store(&state, |s| s.recent_activity(limit.unwrap_or(30)).map_err(err))
}

#[tauri::command]
pub fn stats(state: State<AppState>) -> CmdResult<Stats> {
    with_store(&state, |s| s.stats().map_err(err))
}

#[tauri::command]
pub fn search(state: State<AppState>, query: String) -> CmdResult<Vec<SearchHit>> {
    with_store(&state, |s| s.search(&query, 20).map_err(err))
}

// ---- settings / storage --------------------------------------------------------------

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> CmdResult<HashMap<String, serde_json::Value>> {
    with_store(&state, |s| s.settings().map_err(err))
}

#[tauri::command]
pub fn set_setting(app: AppHandle, state: State<AppState>, key: String, value: serde_json::Value) -> CmdResult<()> {
    with_store(&state, |s| s.set_setting(&key, &value).map_err(err))?;
    let _ = app.emit("hopilo://settings-changed", (&key, &value));
    Ok(())
}

#[tauri::command]
pub fn integrity_check(state: State<AppState>) -> CmdResult<String> {
    with_store(&state, |s| s.integrity_check().map_err(err))
}

#[tauri::command]
pub fn wipe_library(app: AppHandle, state: State<AppState>) -> CmdResult<()> {
    with_store(&state, |s| s.wipe().map_err(err))?;
    notify(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(store: &mut Store, text: &str) -> (String, Vec<String>) {
        let sid = new_id();
        let src = Source {
            source_id: sid.clone(),
            kind: SourceKind::Manual,
            provider: "manual".into(),
            title: text.into(),
            origin: None,
            project: None,
            model: None,
            captured_at: now_rfc3339(),
            capture_status: CaptureStatus::Complete,
            missing_items: vec![],
            omitted: vec![],
        };
        let msgs: Vec<Message> = (0..3)
            .map(|i| Message {
                id: format!("{sid}-{i}"),
                source_id: sid.clone(),
                role: Role::User,
                created_at: None,
                blocks: vec![Block::text(format!("{text} {i}"))],
            })
            .collect();
        let ids = msgs.iter().map(|m| m.id.clone()).collect();
        store.insert_capture(&src, &msgs).unwrap();
        (sid, ids)
    }

    #[test]
    fn assemble_full_selected_and_merge() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(dir.path()).unwrap();
        let (a, a_ids) = source(&mut store, "alpha");
        let (b, _) = source(&mut store, "beta");

        let full = assemble(
            &store,
            &BuildRequest {
                pack_id: None,
                title: String::new(),
                items: vec![
                    BuildItem::Source { id: a.clone(), message_ids: None },
                    BuildItem::Source { id: b.clone(), message_ids: None },
                    BuildItem::Source { id: a.clone(), message_ids: None },
                ],
                note: None,
                tags: vec![],
                label: None,
            },
        )
        .unwrap();
        assert_eq!(full.mode, Mode::Full);
        assert_eq!(full.sources.len(), 2);
        assert_eq!(full.messages.len(), 6);
        assert_eq!(full.title, "alpha");

        let selected = assemble(
            &store,
            &BuildRequest {
                pack_id: None,
                title: "Pick".into(),
                items: vec![BuildItem::Source { id: a.clone(), message_ids: Some(vec![a_ids[1].clone()]) }],
                note: Some("context".into()),
                tags: vec![],
                label: None,
            },
        )
        .unwrap();
        assert_eq!(selected.mode, Mode::Selected);
        assert_eq!(selected.messages.len(), 1);
        assert_eq!(selected.messages[0].blocks[0].plain_text(), "alpha 1");

        let saved = store.create_pack(selected, None).unwrap();
        let merged = assemble(
            &store,
            &BuildRequest {
                pack_id: None,
                title: "Merged".into(),
                items: vec![
                    BuildItem::Pack { id: saved.pack_id.clone(), version: None },
                    BuildItem::Source { id: b, message_ids: None },
                ],
                note: None,
                tags: vec![],
                label: None,
            },
        )
        .unwrap();
        assert_eq!(merged.messages.len(), 4);
        assert_eq!(merged.mode, Mode::Selected);
    }

    #[test]
    fn empty_build_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let req = BuildRequest { pack_id: None, title: "x".into(), items: vec![], note: None, tags: vec![], label: None };
        assert!(assemble(&store, &req).is_err());
    }

    #[test]
    fn merge_dedupes_and_split_keeps_original() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(dir.path()).unwrap();
        let (a, a_ids) = source(&mut store, "alpha");
        let mk = |store: &mut Store, items: Vec<BuildItem>, note: Option<&str>| {
            let req = BuildRequest { pack_id: None, title: String::new(), items, note: note.map(str::to_string), tags: vec![], label: None };
            let p = assemble(store, &req).unwrap();
            store.create_pack(p, None).unwrap()
        };
        let p1 = mk(&mut store, vec![BuildItem::Source { id: a.clone(), message_ids: None }], Some("first note"));
        let p2 = mk(&mut store, vec![BuildItem::Source { id: a.clone(), message_ids: Some(vec![a_ids[0].clone()]) }], Some("second note"));
        let merged = merge_inner(&mut store, &[p1.pack_id.clone(), p2.pack_id.clone()], "").unwrap();
        assert_eq!(merged.pack.messages.len(), 3);
        assert_eq!(merged.duplicates_removed, 1);
        assert_eq!(merged.notes_combined, 2);
        assert!(merged.pack.context.note.as_deref().unwrap().contains("first note"));
        assert_eq!(store.relations(Some(&merged.pack.pack_id)).unwrap().len(), 2);

        let part = split_inner(&mut store, &p1.pack_id, None, &[a_ids[2].clone()], "Part").unwrap();
        assert_eq!(part.messages.len(), 1);
        assert_eq!(part.mode, Mode::Selected);
        assert_eq!(store.get_pack(&p1.pack_id, None).unwrap().messages.len(), 3, "original unchanged");
        assert!(split_inner(&mut store, &p1.pack_id, None, &[], "x").is_err());
    }

    #[test]
    fn session_path_must_be_inside_agent_root() {
        let adapter = adapter_by_id("claude-code").unwrap();
        assert!(checked_session_path(adapter.as_ref(), "/etc/hosts").is_err());
    }
}

// ---- browser extension bridge (Phase 2) --------------------------------------

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
pub fn browser_status(state: State<AppState>) -> CmdResult<BrowserStatus> {
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
}

#[tauri::command]
pub fn register_browser_host(ids: Vec<String>) -> CmdResult<Vec<String>> {
    crate::browser::register(&ids)
}

#[tauri::command]
pub fn unregister_browser_host(ids: Vec<String>) -> CmdResult<Vec<String>> {
    crate::browser::unregister(&ids)
}

// ---- local summarizer: Ollama (CTX-10) -----------------------------------------
// Talks only to Ollama on this computer. The result is a draft for the user
// to check against the transcript; it never replaces captured content.

const OLLAMA: &str = "http://127.0.0.1:11434";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    running: bool,
    models: Vec<String>,
}

#[tauri::command]
pub async fn ollama_status() -> CmdResult<OllamaStatus> {
    tauri::async_runtime::spawn_blocking(|| {
        let agent = ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(2)).build();
        match agent.get(&format!("{OLLAMA}/api/tags")).call() {
            Ok(r) => {
                let v: serde_json::Value = r.into_json().unwrap_or_default();
                let models = v
                    .get("models")
                    .and_then(|m| m.as_array())
                    .map(|a| a.iter().filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(str::to_string)).collect())
                    .unwrap_or_default();
                OllamaStatus { running: true, models }
            }
            Err(_) => OllamaStatus { running: false, models: vec![] },
        }
    })
    .await
    .map_err(err)
}

/// Longest input sent to the local model, to keep summaries fast.
const SUMMARY_INPUT_CHARS: usize = 60_000;

#[tauri::command]
pub async fn ollama_summarize(app: AppHandle, id: String, version: Option<u32>, model: String) -> CmdResult<String> {
    let body = {
        let state = app.state::<AppState>();
        with_store(&state, |s| {
            let pack = s.get_pack(&id, version).map_err(err)?;
            Ok(render_markdown(&pack, &render_opts(ToolDetailOpt::Truncated, Some(ContextLevel::Balanced))))
        })?
    };
    let input: String = body.chars().take(SUMMARY_INPUT_CHARS).collect();
    let prompt = format!(
        "Summarize this AI work session for someone continuing it in another AI tool. Use these headings: Goal, Decisions, Constraints, Current state, Next steps. \
         Copy file paths, commands, error messages and code exactly as written. Do not add anything that is not in the text; write \"not stated\" when a heading has nothing.\n\n{input}"
    );
    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(180)).build();
        let resp = agent
            .post(&format!("{OLLAMA}/api/generate"))
            .send_json(serde_json::json!({ "model": model, "prompt": prompt, "stream": false, "options": { "temperature": 0.1 } }))
            .map_err(|e| format!("Ollama didn't respond: {e}"))?;
        let v: serde_json::Value = resp.into_json().map_err(err)?;
        v.get("response").and_then(|r| r.as_str()).map(|r| r.trim().to_string()).ok_or_else(|| "Ollama returned no text".to_string())
    })
    .await
    .map_err(err)?
}

// ---- Phase 3: lineage, compare, split, merge, pull new, audit ------------------

#[tauri::command]
pub fn diff_versions(state: State<AppState>, id: String, from: u32, to: u32) -> CmdResult<hopilo_core::diff::PackDiff> {
    with_store(&state, |s| {
        let a = s.get_pack(&id, Some(from)).map_err(err)?;
        let b = s.get_pack(&id, Some(to)).map_err(err)?;
        Ok(hopilo_core::diff::diff_packs(&a, &b))
    })
}

#[tauri::command]
pub fn pack_relations(state: State<AppState>, id: Option<String>) -> CmdResult<Vec<hopilo_database::RelationRow>> {
    with_store(&state, |s| s.relations(id.as_deref()).map_err(err))
}

#[tauri::command]
pub fn set_pack_tags(app: AppHandle, state: State<AppState>, id: String, tags: Vec<String>) -> CmdResult<()> {
    with_store(&state, |s| s.set_tags(&id, &tags).map_err(err))?;
    notify(&app);
    Ok(())
}

/// Copy chosen messages into a new pack (DND-11). The original pack is not
/// changed; the new one records where it came from.
#[tauri::command]
pub fn split_pack(app: AppHandle, state: State<AppState>, id: String, version: Option<u32>, message_ids: Vec<String>, title: String) -> CmdResult<Pack> {
    let p = with_store(&state, |s| split_inner(s, &id, version, &message_ids, &title))?;
    notify(&app);
    Ok(p)
}

fn split_inner(s: &mut Store, id: &str, version: Option<u32>, message_ids: &[String], title: &str) -> CmdResult<Pack> {
        let src = s.get_pack(id, version).map_err(err)?;
        let keep: HashSet<&String> = message_ids.iter().collect();
        let messages: Vec<Message> = src.messages.iter().filter(|m| keep.contains(&m.id)).cloned().collect();
        if messages.is_empty() {
            return Err("Choose at least one message to move into the new pack".into());
        }
        let used: HashSet<&String> = messages.iter().map(|m| &m.source_id).collect();
        let pack = Pack {
            title: if title.trim().is_empty() { format!("{} (part)", src.title) } else { title.trim().to_string() },
            mode: Mode::Selected,
            sources: src.sources.iter().filter(|x| used.contains(&x.source_id)).cloned().collect(),
            messages,
            attachments: vec![],
            ..src.clone()
        };
        let new = s.create_pack(pack, Some(&format!("Split from {} v{}", src.title, src.version))).map_err(err)?;
        s.add_relation(id, Some(src.version), &new.pack_id, Some(1), "split").map_err(err)?;
        Ok(new)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeResult {
    pack: Pack,
    duplicates_removed: usize,
    notes_combined: usize,
}

/// Merge packs in the given order into a new pack (LIB-06). Identical
/// messages appear once; differing notes are kept side by side, labelled.
#[tauri::command]
pub fn merge_packs(app: AppHandle, state: State<AppState>, ids: Vec<String>, title: String) -> CmdResult<MergeResult> {
    if ids.len() < 2 {
        return Err("Pick at least two packs to merge".into());
    }
    let out = with_store(&state, |s| merge_inner(s, &ids, &title))?;
    notify(&app);
    Ok(out)
}

fn merge_inner(s: &mut Store, ids: &[String], title: &str) -> CmdResult<MergeResult> {
        let packs: Vec<Pack> = ids.iter().map(|i| s.get_pack(i, None).map_err(err)).collect::<Result<_, _>>()?;
        let mut seen_msgs = HashSet::new();
        let mut seen_sources = HashSet::new();
        let mut seen_files = HashSet::new();
        let (mut messages, mut sources, mut attachments, mut notes) = (vec![], vec![], vec![], vec![]);
        let mut dups = 0;
        for p in &packs {
            for m in &p.messages {
                let key = serde_json::to_string(&(&m.role, &m.blocks)).unwrap_or_default();
                if seen_msgs.insert(key) {
                    messages.push(m.clone());
                } else {
                    dups += 1;
                }
            }
            for x in &p.sources {
                if seen_sources.insert(x.source_id.clone()) {
                    sources.push(x.clone());
                }
            }
            for a in &p.attachments {
                if seen_files.insert(a.sha256.clone()) {
                    attachments.push(a.clone());
                }
            }
            if let Some(n) = p.context.note.as_deref().filter(|n| !n.trim().is_empty()) {
                notes.push(format!("From “{}”:\n{}", p.title, n.trim()));
            }
        }
        let any_selected = packs.iter().any(|p| p.mode == Mode::Selected);
        let mut tags: Vec<String> = packs.iter().flat_map(|p| p.tags.clone()).collect();
        tags.sort();
        tags.dedup();
        let pack = Pack {
            schema_version: SCHEMA_VERSION.into(),
            pack_id: String::new(),
            title: if title.trim().is_empty() { packs.iter().map(|p| p.title.as_str()).collect::<Vec<_>>().join(" + ") } else { title.trim().into() },
            version: 0,
            created_at: String::new(),
            mode: if any_selected { Mode::Selected } else { Mode::Full },
            sources,
            messages,
            context: ContextBrief { note: (!notes.is_empty()).then(|| notes.join("\n\n")), ..Default::default() },
            attachments,
            tags,
            integrity: Integrity::default(),
        };
        let new = s.create_pack(pack, Some(&format!("Merged {} packs", packs.len()))).map_err(err)?;
        for p in &packs {
            s.add_relation(&p.pack_id, Some(p.version), &new.pack_id, Some(1), "merged").map_err(err)?;
        }
        Ok(MergeResult { pack: new, duplicates_removed: dups, notes_combined: notes.len() })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullResult {
    added: usize,
    pack: Option<Pack>,
    skipped: Vec<String>,
}

/// Incremental capture (CAP-10): re-read the coding-agent sessions a pack was
/// built from and append only messages it doesn't have yet, as a new version.
#[tauri::command]
pub async fn pull_new_messages(app: AppHandle, id: String) -> CmdResult<PullResult> {
    let a2 = app.clone();
    let out = tauri::async_runtime::spawn_blocking(move || {
        let state = a2.state::<AppState>();
        let mut pack = with_store(&state, |s| s.get_pack(&id, None).map_err(err))?;
        let fingerprint = |m: &Message| serde_json::to_string(&(&m.role, &m.blocks)).unwrap_or_default();
        let have: HashSet<String> = pack.messages.iter().map(fingerprint).collect();
        let mut added = 0;
        let mut skipped = Vec::new();
        for i in 0..pack.sources.len() {
            let src = pack.sources[i].clone();
            let (Some(origin), Some(adapter)) = (src.origin.clone(), adapter_by_id(&src.provider)) else {
                if src.kind == SourceKind::LocalAgent {
                    skipped.push(src.title.clone());
                }
                continue;
            };
            let Ok(real) = checked_session_path(adapter.as_ref(), &origin) else {
                skipped.push(format!("{} (file no longer available)", src.title));
                continue;
            };
            let Ok(cap) = adapter.read(&real) else {
                skipped.push(format!("{} (couldn't be read)", src.title));
                continue;
            };
            // Insert new messages right after the last message from this source.
            let last_pos = pack.messages.iter().rposition(|m| m.source_id == src.source_id).map(|p| p + 1).unwrap_or(pack.messages.len());
            let fresh: Vec<Message> = cap
                .messages
                .into_iter()
                .filter(|m| !have.contains(&fingerprint(m)))
                .map(|m| Message { source_id: src.source_id.clone(), ..m })
                .collect();
            added += fresh.len();
            pack.messages.splice(last_pos..last_pos, fresh);
            pack.sources[i].capture_status = cap.source.capture_status;
            pack.sources[i].missing_items = cap.source.missing_items;
            pack.sources[i].omitted = cap.source.omitted;
            pack.sources[i].captured_at = now_rfc3339();
        }
        if added == 0 {
            return Ok::<_, String>(PullResult { added, pack: None, skipped });
        }
        let label = format!("Pulled {added} new message(s)");
        let saved = with_store(&state, |s| s.add_version(&id, pack, Some(&label)).map_err(err))?;
        Ok(PullResult { added, pack: Some(saved), skipped })
    })
    .await
    .map_err(err)??;
    notify(&app);
    Ok(out)
}

#[tauri::command]
pub fn audit_library(state: State<AppState>) -> CmdResult<hopilo_database::AuditReport> {
    with_store(&state, |s| s.audit().map_err(err))
}

/// Import an Aider `.aider.chat.history.md` the user picked.
#[tauri::command]
pub fn import_aider_history(app: AppHandle, state: State<AppState>, path: String) -> CmdResult<ImportOutcome> {
    let cap = hopilo_adapters::aider::read_history(Path::new(&path)).map_err(err)?;
    let out = with_store(&state, |s| s.insert_capture(&cap.source, &cap.messages).map_err(err))?;
    notify(&app);
    Ok(out)
}

// ---- Drop Shelf (DND-13) ------------------------------------------------------

/// Open (or refocus) the small Drop Shelf window holding one pack. It stays
/// above other windows only when the user turned that on.
#[tauri::command]
pub fn open_drop_shelf(app: AppHandle, state: State<AppState>, pack_id: String) -> CmdResult<()> {
    let on_top = with_store(&state, |s| Ok(s.settings().map_err(err)?.get("shelfOnTop").and_then(|v| v.as_bool()).unwrap_or(false)))?;
    let url = format!("index.html?surface=shelf&pack={pack_id}");
    if let Some(w) = app.get_webview_window("shelf") {
        let _ = w.eval(&format!("window.location.replace({})", serde_json::to_string(&url).unwrap_or_default()));
        let _ = w.set_always_on_top(on_top);
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let w = tauri::WebviewWindowBuilder::new(&app, "shelf", tauri::WebviewUrl::App(url.into()))
        .title("Hopilo Drop Shelf")
        .inner_size(300.0, 168.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(true)
        // Shown by the page once it has painted, so it never flashes.
        .visible(false)
        .skip_taskbar(true)
        .always_on_top(on_top)
        .build()
        .map_err(err)?;
    // Park it near the bottom-right corner, clear of the dock.
    if let Ok(Some(m)) = w.current_monitor() {
        let scale = m.scale_factor();
        let size = m.size();
        let x = size.width as f64 - (300.0 + 24.0) * scale;
        let y = size.height as f64 - (168.0 + 120.0) * scale;
        let _ = w.set_position(tauri::PhysicalPosition::new(x.max(0.0), y.max(0.0)));
    }
    Ok(())
}

#[tauri::command]
pub fn close_drop_shelf(app: AppHandle) {
    if let Some(w) = app.get_webview_window("shelf") {
        let _ = w.close();
    }
}
