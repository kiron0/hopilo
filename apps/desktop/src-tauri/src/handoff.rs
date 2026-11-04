//! One-call handoff actions. Rendering, the clipboard write and the handoff
//! record all happen here, so the prompt text never travels through the web
//! view and every surface (dashboard, Quick Panel, tray menu) behaves the same.

use hopilo_core::brief::ContextLevel;
use hopilo_core::render::{estimate_tokens, render_handoff_prompt, render_markdown};
use hopilo_core::scan::scan_pack;
use hopilo_database::ImportOutcome;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::commands::{notify, quick_pack_blocking, render_opts, with_store, AppState, ToolDetailOpt};

type CmdResult<T> = Result<T, String>;

/// What was copied, so the caller can confirm it and flag anything to review.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyOutcome {
    pack_id: String,
    version: u32,
    title: String,
    target: String,
    token_estimate: usize,
    /// Capture gaps (messages the source could not provide).
    missing: usize,
    /// Possible secrets found by the sensitive-data check.
    findings: usize,
}

/// Saved defaults for a handoff, used when the caller passes none.
struct Defaults {
    target: String,
    tool_detail: ToolDetailOpt,
    level: ContextLevel,
}

fn defaults(state: &State<AppState>) -> Defaults {
    let settings = with_store(state, |s| s.settings().map_err(|e| e.to_string())).unwrap_or_default();
    let get = |k: &str| settings.get(k).cloned();
    Defaults {
        target: get("defaultTarget").and_then(|v| v.as_str().map(str::to_string)).unwrap_or_else(|| "chatgpt".into()),
        tool_detail: get("toolDetail").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default(),
        level: get("level").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default(),
    }
}

/// Render a pack, put it on the clipboard and log it as "copied" (never as
/// delivered: Hopilo does not send anything).
fn copy_rendered(
    app: &AppHandle,
    pack_id: &str,
    version: Option<u32>,
    markdown: bool,
    target: Option<String>,
    tool_detail: Option<ToolDetailOpt>,
    level: Option<ContextLevel>,
) -> CmdResult<CopyOutcome> {
    let state = app.state::<AppState>();
    let d = defaults(&state);
    let target = target.filter(|t| !t.is_empty()).unwrap_or(d.target);
    let opts = render_opts(tool_detail.unwrap_or(d.tool_detail), Some(level.unwrap_or(d.level)));
    let (pack, text) = with_store(&state, |s| {
        let pack = s.get_pack(pack_id, version).map_err(|e| e.to_string())?;
        let text = if markdown { render_markdown(&pack, &opts) } else { render_handoff_prompt(&pack, &opts) };
        Ok((pack, text))
    })?;
    app.clipboard().write_text(text.clone()).map_err(|e| format!("Couldn't write to the clipboard: {e}"))?;
    let (rec_target, method) = if markdown { ("other", "clipboard-markdown") } else { (target.as_str(), "clipboard") };
    with_store(&state, |s| s.record_handoff(&pack.pack_id, pack.version, rec_target, method, "copied").map_err(|e| e.to_string()))?;
    notify(app);
    Ok(CopyOutcome {
        token_estimate: estimate_tokens(&text),
        missing: pack.sources.iter().map(|s| s.missing_items.len()).sum(),
        findings: scan_pack(&pack, None).len(),
        pack_id: pack.pack_id,
        version: pack.version,
        title: pack.title,
        target,
    })
}

/// Copy a pack's handoff prompt (or its Markdown) in one step.
#[tauri::command]
pub fn copy_pack(
    app: AppHandle,
    id: String,
    version: Option<u32>,
    markdown: Option<bool>,
    target: Option<String>,
    tool_detail: Option<ToolDetailOpt>,
    level: Option<ContextLevel>,
) -> CmdResult<CopyOutcome> {
    copy_rendered(&app, &id, version, markdown.unwrap_or(false), target, tool_detail, level)
}

/// Capture a local agent session, build a Full pack and copy its handoff
/// prompt with the saved defaults — the whole Flow B in one call.
#[tauri::command]
pub async fn quick_handoff(app: AppHandle, adapter: String, path: String) -> CmdResult<CopyOutcome> {
    tauri::async_runtime::spawn_blocking(move || {
        let pack = quick_pack_blocking(&app, &adapter, &path)?;
        notify(&app);
        copy_rendered(&app, &pack.pack_id, Some(pack.version), false, None, None, None)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardCapture {
    #[serde(flatten)]
    outcome: ImportOutcome,
    chars: usize,
}

/// One-time clipboard import (CAP-04), read on the Rust side. There is no
/// background clipboard monitoring.
#[tauri::command]
pub fn capture_clipboard(app: AppHandle) -> CmdResult<ClipboardCapture> {
    let text = app.clipboard().read_text().unwrap_or_default();
    if text.trim().is_empty() {
        return Err("The clipboard has no text to capture.".into());
    }
    let chars = text.chars().count();
    let state = app.state::<AppState>();
    let outcome = crate::commands::import_text(app.clone(), state, text, "clipboard".into(), None, None)?;
    Ok(ClipboardCapture { outcome, chars })
}

/// Tray menu: hand off the most recently active agent session without
/// opening any window. Shows the result briefly next to the menu-bar icon.
pub fn continue_latest_session(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
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
        let rows = crate::commands::discover_sessions(app.clone()).await.unwrap_or_default();
        let Some(latest) = rows.into_iter().next() else {
            flash("No sessions");
            return;
        };
        let (adapter, path) = (latest.session.adapter.clone(), latest.session.path.clone());
        match quick_handoff(app.clone(), adapter, path).await {
            Ok(out) if out.findings > 0 || out.missing > 0 => flash("Copied · review"),
            Ok(_) => flash("Copied"),
            Err(_) => flash("Failed"),
        }
    });
}
