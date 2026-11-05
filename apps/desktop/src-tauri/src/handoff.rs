use std::path::PathBuf;

use hopilo_core::brief::ContextLevel;
use hopilo_core::render::{estimate_tokens, render_handoff_prompt, render_markdown, RenderOptions, ToolDetail};
use hopilo_core::scan::scan_pack;
use hopilo_core::Pack;
use hopilo_database::ImportOutcome;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::commands::{err, notify, with_store, write_atomic, AppState, CmdResult};

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
    let settings = with_store(state, |s| s.settings().map_err(err)).unwrap_or_default();
    let get = |k: &str| settings.get(k).cloned();
    Defaults {
        target: get("defaultTarget").and_then(|v| v.as_str().map(str::to_string)).unwrap_or_else(|| "claude".into()),
        tool_detail: get("toolDetail").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default(),
        level: get("level").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default(),
    }
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CopyOptions {
    #[serde(default)]
    markdown: bool,
    target: Option<String>,
    tool_detail: Option<ToolDetailOpt>,
    level: Option<ContextLevel>,
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
    let target = opts.target.filter(|t| !t.is_empty()).unwrap_or(d.target);
    let ropts = render_opts(opts.tool_detail.unwrap_or(d.tool_detail), opts.level.unwrap_or(d.level));
    let (pack, text) = with_store(&state, |s| {
        let pack = s.compose(ids).map_err(err)?;
        let text = if opts.markdown { render_markdown(&pack, &ropts) } else { render_handoff_prompt(&pack, &ropts) };
        Ok((pack, text))
    })?;
    app.clipboard().write_text(text.clone()).map_err(|e| format!("Couldn't write to the clipboard: {e}"))?;
    let (rec_target, method) = if opts.markdown { ("other", "clipboard-markdown") } else { (target.as_str(), "clipboard") };
    with_store(&state, |s| s.record_copy(ids, rec_target, method, "copied").map_err(err))?;
    notify(app);
    Ok(outcome(&pack, ids, target, &text))
}

#[tauri::command]
pub fn copy_sessions(app: AppHandle, ids: Vec<String>, opts: Option<CopyOptions>) -> CmdResult<CopyOutcome> {
    copy_blocking(&app, &ids, opts.unwrap_or_default())
}

#[tauri::command]
pub fn suggest_export_name(state: State<AppState>, ids: Vec<String>, ext: String) -> CmdResult<String> {
    with_store(&state, |s| {
        let title = s.composed_title(&ids).map_err(err)?;
        Ok(hopilo_pack_format::export_filename_for(&title, 0, &ext))
    })
}

#[tauri::command]
pub fn export_sessions(app: AppHandle, state: State<AppState>, ids: Vec<String>, format: String, path: String, opts: Option<CopyOptions>) -> CmdResult<String> {
    if !matches!(format.as_str(), "md" | "txt" | "json" | "handoff") {
        return Err(format!("unknown export format {format}"));
    }
    let opts = opts.unwrap_or_default();
    let d = defaults(&state);
    let ropts = render_opts(opts.tool_detail.unwrap_or(d.tool_detail), opts.level.unwrap_or(d.level));
    let dest = PathBuf::from(&path);

    // Snapshot what we need while holding the library lock, then render and
    // write outside it so a large export never freezes the rest of the UI.
    let (pack, blobs) = with_store(&state, |s| {
        let pack = s.compose(&ids).map_err(err)?;
        let mut blobs: std::collections::HashMap<String, Vec<u8>> = std::collections::HashMap::new();
        if format == "handoff" {
            for a in &pack.attachments {
                if let Some(bytes) = s.attachment_bytes(&a.sha256) {
                    blobs.insert(a.sha256.clone(), bytes);
                }
            }
        }
        Ok((pack, blobs))
    })?;

    match format.as_str() {
        "md" => write_atomic(&dest, render_markdown(&pack, &ropts).as_bytes())?,
        "txt" => write_atomic(&dest, render_handoff_prompt(&pack, &ropts).as_bytes())?,
        "json" => write_atomic(&dest, hopilo_pack_format::to_json(&pack).map_err(err)?.as_bytes())?,
        "handoff" => {
            let mut buf = std::io::Cursor::new(Vec::new());
            hopilo_pack_format::write_handoff(&pack, &ropts, &|a| blobs.get(&a.sha256).cloned(), &mut buf).map_err(err)?;
            write_atomic(&dest, &buf.into_inner())?;
        }
        _ => unreachable!(),
    }
    with_store(&state, |s| s.record_copy(&ids, "file", &format!("export-{format}"), "exported").map_err(err))?;
    notify(&app);
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
pub fn capture_clipboard(app: AppHandle) -> CmdResult<ClipboardCapture> {
    let text = app.clipboard().read_text().unwrap_or_default();
    if text.trim().is_empty() {
        return Err("The clipboard has no text to save.".into());
    }
    let chars = text.chars().count();
    let state = app.state::<AppState>();
    let outcome = crate::commands::import_text(app.clone(), state, text, "clipboard".into(), None, None)?;
    Ok(ClipboardCapture { outcome, chars })
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
        crate::commands::sync_blocking(&app);
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
