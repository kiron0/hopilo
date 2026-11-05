use std::path::PathBuf;

use hopilo_core::brief::ContextLevel;
use hopilo_core::render::{estimate_tokens, render_handoff_prompt, render_markdown, RenderOptions, ToolDetail};
use hopilo_core::scan::scan_pack;
use hopilo_core::model::Role;
use hopilo_core::Pack;
use hopilo_database::ImportOutcome;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::commands::{blocking, err, notify, with_store, write_atomic, AppState, CmdResult};

#[derive(Deserialize, Clone, Copy, Default)]
#[serde(rename_all = "camelCase")]
pub enum ToolDetailOpt {
    Full,
    #[default]
    Truncated,
    Omit,
}

fn render_opts(t: ToolDetailOpt, level: ContextLevel) -> RenderOptions {
    RenderOptions {
        level,
        tool_detail: match t {
            ToolDetailOpt::Full => ToolDetail::Full,
            ToolDetailOpt::Truncated => ToolDetail::Truncated { limit: 2000 },
            ToolDetailOpt::Omit => ToolDetail::Omit,
        },
        ..Default::default()
    }
}

struct Defaults {
    target: String,
    tool_detail: ToolDetailOpt,
    level: ContextLevel,
}

fn defaults(state: &State<AppState>) -> Defaults {
    let get = |k: &str| state.setting(k);
    Defaults {
        target: get("defaultTarget").and_then(|v| v.as_str().map(str::to_string)).unwrap_or_else(|| "claude".into()),
        tool_detail: get("toolDetail").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default(),
        level: get("level").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default(),
    }
}

#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CopyOptions {
    #[serde(default)]
    pub markdown: bool,
    pub target: Option<String>,
    pub tool_detail: Option<ToolDetailOpt>,
    pub level: Option<ContextLevel>,
    #[serde(default)]
    pub exclude_secrets: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyOutcome {
    ids: Vec<String>,
    title: String,
    target: String,
    token_estimate: usize,

    missing: usize,

    findings: usize,

    attach: Vec<String>,
}

fn outcome(pack: &Pack, ids: &[String], target: String, text: &str) -> CopyOutcome {
    CopyOutcome {
        ids: ids.to_vec(),
        title: pack.title.clone(),
        target,
        token_estimate: estimate_tokens(text),
        missing: pack.sources.iter().map(|s| s.missing_items.len()).sum(),
        findings: scan_pack(pack, None).len(),
        attach: pack.attachments.iter().filter(|a| a.text.is_none()).map(|a| a.file_name.clone()).collect(),
    }
}

pub(crate) fn copy_blocking(app: &AppHandle, ids: &[String], opts: CopyOptions) -> CmdResult<CopyOutcome> {
    if ids.is_empty() {
        return Err("Choose at least one session".into());
    }
    let state = app.state::<AppState>();
    let d = defaults(&state);
    let target = opts.target.as_ref().filter(|t| !t.is_empty()).cloned().unwrap_or(d.target);
    let ropts = render_opts(opts.tool_detail.unwrap_or(d.tool_detail), opts.level.unwrap_or(d.level));
    let mut pack = with_store(&state, |s| s.compose(ids).map_err(err))?;
    if opts.exclude_secrets {
        hopilo_core::scan::redact_pack(&mut pack);
    }
    let text = if opts.markdown { render_markdown(&pack, &ropts) } else { render_handoff_prompt(&pack, &ropts) };
    let text = if opts.exclude_secrets { hopilo_core::scan::redact_text(&text) } else { text };
    app.clipboard().write_text(text.clone()).map_err(|e| format!("Couldn't write to the clipboard: {e}"))?;
    let (rec_target, method) = if opts.markdown { ("other", "clipboard-markdown") } else { (target.as_str(), "clipboard") };
    with_store(&state, |s| s.record_copy(ids, rec_target, method, "copied").map_err(err))?;
    notify(app);
    Ok(outcome(&pack, ids, target, &text))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelStats {
    pub message_count: usize,
    pub token_estimate: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffPreflight {
    pub title: String,
    pub total_messages: usize,
    pub total_tokens: usize,
    pub findings: Vec<hopilo_core::scan::Finding>,
    pub full: LevelStats,
    pub balanced: LevelStats,
    pub minimal: LevelStats,
}

#[tauri::command]
pub async fn preflight_handoff(app: AppHandle, ids: Vec<String>) -> CmdResult<HandoffPreflight> {
    blocking(app, move |app, _| {
        if ids.is_empty() {
            return Err("Choose at least one session".into());
        }
        let state = app.state::<AppState>();
        let d = defaults(&state);
        let pack = with_store(&state, |s| s.compose(&ids).map_err(err))?;
        let findings = hopilo_core::scan::scan_pack(&pack, None);
        let total_messages = pack.messages.len();
        let level_stats = |level: ContextLevel| {
            let ropts = render_opts(d.tool_detail, level);
            let tokens = estimate_tokens(&render_handoff_prompt(&pack, &ropts));
            let visible = hopilo_core::render::visible_messages(&pack, &ropts);
            let message_count = match level {
                ContextLevel::Full => visible.len(),
                ContextLevel::Balanced => {
                    let split = visible.len().saturating_sub(hopilo_core::brief::BALANCED_RECENT);
                    let (earlier, recent) = visible.split_at(split);
                    earlier.iter().filter(|m| m.role != Role::Tool && m.has_text()).count() + recent.len()
                }
                ContextLevel::Minimal => {
                    let first = hopilo_core::brief::first_user(&visible);
                    let last_user = hopilo_core::brief::last_with(&visible, Role::User)
                        .filter(|m| Some(m.id.as_str()) != first.map(|f| f.id.as_str()));
                    let last_assistant = hopilo_core::brief::last_with(&visible, Role::Assistant);
                    let count = [first.is_some(), last_user.is_some(), last_assistant.is_some()].iter().filter(|b| **b).count();
                    count.max(usize::from(total_messages > 0)).min(total_messages)
                }
            };
            LevelStats { message_count, token_estimate: tokens }
        };
        let full = level_stats(ContextLevel::Full);
        let balanced = level_stats(ContextLevel::Balanced);
        let minimal = level_stats(ContextLevel::Minimal);
        Ok(HandoffPreflight {
            title: pack.title.clone(),
            total_messages,
            total_tokens: full.token_estimate,
            findings,
            full,
            balanced,
            minimal,
        })
    })
    .await
}

#[tauri::command]
pub async fn copy_sessions(app: AppHandle, ids: Vec<String>, opts: Option<CopyOptions>) -> CmdResult<CopyOutcome> {
    blocking(app, move |app, _| copy_blocking(app, &ids, opts.unwrap_or_default())).await
}

#[tauri::command]
pub async fn suggest_export_name(app: AppHandle, ids: Vec<String>, ext: String) -> CmdResult<String> {
    blocking(app, move |_, state| {
        with_store(&state, |s| {
            let title = s.composed_title(&ids).map_err(err)?;
            Ok(hopilo_pack_format::export_filename_for(&title, 0, &ext))
        })
    })
    .await
}

#[tauri::command]
pub async fn export_sessions(app: AppHandle, ids: Vec<String>, format: String, path: String, opts: Option<CopyOptions>) -> CmdResult<String> {
    blocking(app, move |app, state| export_blocking(app, &state, &ids, &format, &path, opts)).await
}

#[tauri::command]
pub async fn export_sessions_zip(app: AppHandle, ids: Vec<String>, formats: Vec<String>, path: String, opts: Option<CopyOptions>) -> CmdResult<String> {
    blocking(app, move |app, state| export_zip_blocking(app, &state, &ids, &formats, &path, opts)).await
}

const EXPORT_FORMATS: [&str; 4] = ["md", "txt", "json", "handoff"];

struct Prepared {
    pack: Pack,
    blobs: std::collections::HashMap<String, Vec<u8>>,
    ropts: RenderOptions,
    exclude_secrets: bool,
}

fn prepare_export(state: &State<AppState>, ids: &[String], formats: &[&str], opts: Option<CopyOptions>) -> CmdResult<Prepared> {
    if let Some(bad) = formats.iter().find(|f| !EXPORT_FORMATS.contains(f)) {
        return Err(format!("unknown export format {bad}"));
    }
    let opts = opts.unwrap_or_default();
    let d = defaults(state);
    let ropts = render_opts(opts.tool_detail.unwrap_or(d.tool_detail), opts.level.unwrap_or(d.level));
    let want_blobs = formats.contains(&"handoff");
    with_store(state, |s| {
        let mut pack = s.compose(ids).map_err(err)?;
        if opts.exclude_secrets {
            hopilo_core::scan::redact_pack(&mut pack);
        }
        let mut blobs = std::collections::HashMap::new();
        if want_blobs {
            for a in &pack.attachments {
                if let Some(bytes) = s.attachment_bytes(&a.sha256) {
                    blobs.insert(a.sha256.clone(), bytes);
                }
            }
        }
        Ok(Prepared { pack, blobs, ropts, exclude_secrets: opts.exclude_secrets })
    })
}

fn render_export(p: &Prepared, format: &str) -> CmdResult<Vec<u8>> {
    Ok(match format {
        "md" => {
            let s = render_markdown(&p.pack, &p.ropts);
            if p.exclude_secrets { hopilo_core::scan::redact_text(&s).into_bytes() } else { s.into_bytes() }
        }
        "txt" => {
            let s = render_handoff_prompt(&p.pack, &p.ropts);
            if p.exclude_secrets { hopilo_core::scan::redact_text(&s).into_bytes() } else { s.into_bytes() }
        }
        "json" => hopilo_pack_format::to_json(&p.pack).map_err(err)?.into_bytes(),
        "handoff" => {
            let mut buf = std::io::Cursor::new(Vec::new());
            hopilo_pack_format::write_handoff(&p.pack, &p.ropts, &|a| p.blobs.get(&a.sha256).cloned(), &mut buf).map_err(err)?;
            buf.into_inner()
        }
        other => return Err(format!("unknown export format {other}")),
    })
}

fn export_blocking(app: &AppHandle, state: &State<AppState>, ids: &[String], format: &str, path: &str, opts: Option<CopyOptions>) -> CmdResult<String> {
    let prepared = prepare_export(state, ids, &[format], opts)?;
    let dest = PathBuf::from(path);
    write_atomic(&dest, &render_export(&prepared, format)?)?;
    with_store(state, |s| s.record_copy(ids, "file", &format!("export-{format}"), "exported").map_err(err))?;
    notify(app);
    Ok(dest.display().to_string())
}

fn export_zip_blocking(app: &AppHandle, state: &State<AppState>, ids: &[String], formats: &[String], path: &str, opts: Option<CopyOptions>) -> CmdResult<String> {
    use std::io::Write;
    let mut formats: Vec<&str> = formats.iter().map(String::as_str).collect();
    formats.sort_by_key(|f| EXPORT_FORMATS.iter().position(|x| x == f));
    formats.dedup();
    if formats.is_empty() {
        return Err("pick at least one format".into());
    }
    let prepared = prepare_export(state, ids, &formats, opts)?;
    let title = with_store(state, |s| s.composed_title(ids).map_err(err))?;
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for f in &formats {
        zip.start_file(hopilo_pack_format::export_filename_for(&title, 0, f), o).map_err(err)?;
        zip.write_all(&render_export(&prepared, f)?).map_err(err)?;
    }
    let bytes = zip.finish().map_err(err)?.into_inner();
    let dest = PathBuf::from(path);
    write_atomic(&dest, &bytes)?;
    with_store(state, |s| s.record_copy(ids, "file", &format!("export-zip-{}", formats.join("+")), "exported").map_err(err))?;
    notify(app);
    Ok(dest.display().to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardCapture {
    #[serde(flatten)]
    outcome: ImportOutcome,
    chars: usize,
}

#[tauri::command]
pub async fn capture_clipboard(app: AppHandle) -> CmdResult<ClipboardCapture> {
    blocking(app, move |app, _| {
        let app = app.clone();
        let text = app.clipboard().read_text().unwrap_or_default();
        if text.trim().is_empty() {
            return Err("The clipboard has no text to save.".into());
        }
        let chars = text.chars().count();
        let state = app.state::<AppState>();
        let outcome = crate::commands::import_text_inner(app.clone(), state, text, "clipboard".into(), None, None)?;
        Ok(ClipboardCapture { outcome, chars })
    })
    .await
}

pub fn copy_latest_session(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let flash = |text: &str| {
            if let Some(tray) = app.tray_by_id("hopilo") {
                let _ = tray.set_title(Some(text));
                let app2 = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    if let Some(t) = app2.tray_by_id("hopilo") {
                        let _ = t.set_title(None::<&str>);
                    }
                });
            }
        };
        crate::commands::sync_blocking(&app, crate::commands::SyncMode::Wait);
        let state = app.state::<AppState>();
        let latest = with_store(&state, |s| s.list_sessions().map_err(err)).ok().and_then(|rows| {
            let mut rows = rows;
            rows.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
            rows.into_iter().next()
        });
        let Some(row) = latest else {
            flash("No sessions");
            return;
        };
        match copy_blocking(&app, &[row.id], CopyOptions::default()) {
            Ok(out) if out.findings > 0 || out.missing > 0 => flash("Copied · check it"),
            Ok(_) => flash("Copied"),
            Err(_) => flash("Failed"),
        }
    });
}
