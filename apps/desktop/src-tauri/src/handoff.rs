use std::path::PathBuf;

use hopilo_core::brief::ContextLevel;
use hopilo_core::framing::{arrange_sources, render_framed, Framing, Intent, PromptStyle, SessionOrder};
use hopilo_core::render::{estimate_tokens, render_handoff_prompt, render_markdown, RenderOptions, ToolDetail};
use hopilo_core::scan::{RedactionRules, Redactor, RuleError};
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
    intent: Intent,
    instructions: Option<String>,
    style: Option<PromptStyle>,
}

#[derive(Deserialize)]
struct Template {
    id: String,
    text: String,
}

fn defaults(state: &State<AppState>) -> Defaults {
    let get = |k: &str| state.setting(k);
    let intent_key = get("defaultIntent").and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default();
    let (intent, instructions) = match serde_json::from_value::<Intent>(serde_json::Value::String(intent_key.clone())) {
        Ok(i) if i != Intent::Custom => (i, None),
        _ => {
            let templates: Vec<Template> = get("handoffTemplates").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
            match templates.into_iter().find(|t| t.id == intent_key) {
                Some(t) => (Intent::Custom, Some(t.text)),
                None => (Intent::Continue, None),
            }
        }
    };
    Defaults {
        target: get("defaultTarget").and_then(|v| v.as_str().map(str::to_string)).unwrap_or_else(|| "claude".into()),
        tool_detail: get("toolDetail").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default(),
        level: get("level").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default(),
        intent,
        instructions,
        style: get("promptStyle").and_then(|v| serde_json::from_value(v).ok()),
    }
}

pub(crate) fn redaction_rules(state: &State<AppState>) -> RedactionRules {
    state.setting("redaction").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
}

fn redactor(state: &State<AppState>, ignore: &[String]) -> (Redactor, Vec<RuleError>) {
    Redactor::new(&redaction_rules(state), ignore.iter().cloned())
}

pub(crate) fn style_for_target(target: &str) -> PromptStyle {
    match target {
        "claude" | "claude-code" => PromptStyle::Xml,
        "gemini" | "gemini-cli" | "antigravity" => PromptStyle::ContextFirst,
        _ => PromptStyle::Markdown,
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
    pub intent: Option<Intent>,
    pub instructions: Option<String>,
    pub note: Option<String>,
    pub style: Option<PromptStyle>,
    pub order: Option<SessionOrder>,
    #[serde(default)]
    pub ignore: Vec<String>,
}

impl CopyOptions {
    fn framing(&self, d: &Defaults, target: &str) -> Framing {
        let (intent, instructions) = match self.intent {
            Some(Intent::Custom) => (Intent::Custom, self.instructions.clone()),
            Some(i) => (i, None),
            None => (d.intent, d.instructions.clone()),
        };
        Framing {
            intent,
            instructions,
            note: self.note.clone(),
            style: self.style.or(d.style).unwrap_or_else(|| style_for_target(target)),
        }
    }
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

fn outcome(pack: &Pack, ids: &[String], target: String, text: &str, findings: usize) -> CopyOutcome {
    CopyOutcome {
        ids: ids.to_vec(),
        title: pack.title.clone(),
        target,
        token_estimate: estimate_tokens(text),
        missing: pack.sources.iter().map(|s| s.missing_items.len()).sum(),
        findings,
        attach: pack.attachments.iter().filter(|a| a.text.is_none()).map(|a| a.file_name.clone()).collect(),
    }
}

pub(crate) fn copy_blocking(app: &AppHandle, ids: &[String], opts: CopyOptions) -> CmdResult<CopyOutcome> {
    if ids.is_empty() {
        return Err("Choose at least one session".into());
    }
    let state = app.state::<AppState>();
    let d = defaults(&state);
    let target = opts.target.as_ref().filter(|t| !t.is_empty()).cloned().unwrap_or_else(|| d.target.clone());
    let ropts = render_opts(opts.tool_detail.unwrap_or(d.tool_detail), opts.level.unwrap_or(d.level));
    let framing = opts.framing(&d, &target);
    let (red, _) = redactor(&state, &opts.ignore);
    let mut pack = with_store(&state, |s| s.compose(ids).map_err(err))?;
    arrange_sources(&mut pack, opts.order.unwrap_or_default());
    red.drop_excluded(&mut pack);
    let findings = red.scan_pack(&pack, None).len();
    if opts.exclude_secrets {
        red.redact_pack(&mut pack);
    }
    let text = if opts.markdown { render_markdown(&pack, &ropts) } else { render_framed(&pack, &ropts, &framing) };
    let text = if opts.exclude_secrets { red.redact_text(&text) } else { text };
    app.clipboard().write_text(text.clone()).map_err(|e| format!("Couldn't write to the clipboard: {e}"))?;
    let (rec_target, method) = if opts.markdown { ("other", "clipboard-markdown") } else { (target.as_str(), "clipboard") };
    with_store(&state, |s| s.record_copy(ids, rec_target, method, "copied").map_err(err))?;
    notify(app);
    let remaining = if opts.exclude_secrets { 0 } else { findings };
    Ok(outcome(&pack, ids, target, &text, remaining))
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
    pub rule_errors: Vec<RuleError>,
    pub excluded_files: Vec<String>,
    pub source_count: usize,
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
        let mut pack = with_store(&state, |s| s.compose(&ids).map_err(err))?;
        let (red, rule_errors) = redactor(&state, &[]);
        let excluded_files = red.drop_excluded(&mut pack);
        let findings = red.scan_pack(&pack, None);
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
            rule_errors,
            excluded_files,
            source_count: pack.sources.len(),
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
            Ok(hopilo_pack_format::export_filename_for(&title, 0, export_ext(&ext)))
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

const EXPORT_FORMATS: [&str; 5] = ["md", "txt", "html", "json", "handoff"];

pub(crate) fn export_ext(format: &str) -> &str {
    match format {
        "handoff" => "hopilo",
        other => other,
    }
}

struct Prepared {
    pack: Pack,
    blobs: std::collections::HashMap<String, Vec<u8>>,
    ropts: RenderOptions,
    exclude_secrets: bool,
    redactor: Redactor,
    framing: Framing,
}

fn redact_export_pack(pack: &mut Pack, redactor: &Redactor, include_blobs: bool) -> std::collections::HashMap<String, Vec<u8>> {
    redactor.redact_pack(pack);
    let mut replacements = std::collections::HashMap::new();
    let mut blobs = std::collections::HashMap::new();
    for a in &mut pack.attachments {
        if let Some(text) = &a.text {
            let bytes = text.as_bytes();
            let sha = hopilo_pack_format::sha256_hex(bytes);
            let size = bytes.len() as u64;
            replacements.insert(a.sha256.clone(), (sha.clone(), size));
            a.sha256 = sha.clone();
            a.size = size;
            if include_blobs { blobs.insert(sha, bytes.to_vec()); }
        }
    }
    for m in &mut pack.messages {
        for b in &mut m.blocks {
            if let hopilo_core::Block::File { sha256, size, .. } = b {
                if let Some((sha, len)) = replacements.get(sha256) {
                    *sha256 = sha.clone();
                    *size = *len;
                }
            }
        }
    }
    blobs
}

fn prepare_export(state: &State<AppState>, ids: &[String], formats: &[&str], opts: Option<CopyOptions>) -> CmdResult<Prepared> {
    if let Some(bad) = formats.iter().find(|f| !EXPORT_FORMATS.contains(f)) {
        return Err(format!("unknown export format {bad}"));
    }
    let opts = opts.unwrap_or_default();
    let d = defaults(state);
    let ropts = render_opts(opts.tool_detail.unwrap_or(d.tool_detail), opts.level.unwrap_or(d.level));
    let target = opts.target.clone().filter(|t| !t.is_empty()).unwrap_or_else(|| d.target.clone());
    let framing = opts.framing(&d, &target);
    let (red, _) = redactor(state, &opts.ignore);
    let want_blobs = formats.contains(&"handoff");
    with_store(state, |s| {
        let mut pack = s.compose(ids).map_err(err)?;
        arrange_sources(&mut pack, opts.order.unwrap_or_default());
        red.drop_excluded(&mut pack);
        strip_local_paths(&mut pack);
        let redacted_blobs = if opts.exclude_secrets { redact_export_pack(&mut pack, &red, want_blobs) } else { Default::default() };
        let mut blobs = std::collections::HashMap::new();
        if want_blobs {
            for a in &pack.attachments {
                if let Some(bytes) = redacted_blobs.get(&a.sha256).cloned().or_else(|| s.attachment_bytes(&a.sha256)) {
                    blobs.insert(a.sha256.clone(), bytes);
                }
            }
        }
        Ok(Prepared { pack, blobs, ropts, exclude_secrets: opts.exclude_secrets, redactor: red, framing })
    })
}

fn strip_local_paths(pack: &mut Pack) {
    for a in &mut pack.attachments {
        a.origin_path = None;
    }
    for s in &mut pack.sources {
        let is_web = s.origin.as_deref().is_some_and(|o| {
            let o = o.trim_start().to_ascii_lowercase();
            o.starts_with("https://") || o.starts_with("http://")
        });
        if !is_web {
            s.origin = None;
        }
    }
}

fn render_export(p: &Prepared, format: &str) -> CmdResult<Vec<u8>> {
    Ok(match format {
        "md" => {
            let s = render_markdown(&p.pack, &p.ropts);
            if p.exclude_secrets { p.redactor.redact_text(&s).into_bytes() } else { s.into_bytes() }
        }
        "txt" => {
            let s = render_framed(&p.pack, &p.ropts, &p.framing);
            if p.exclude_secrets { p.redactor.redact_text(&s).into_bytes() } else { s.into_bytes() }
        }
        "html" => {
            let s = hopilo_core::html::render_html(&p.pack, &p.ropts);
            if p.exclude_secrets { p.redactor.redact_text(&s).into_bytes() } else { s.into_bytes() }
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
        zip.start_file(hopilo_pack_format::export_filename_for(&title, 0, export_ext(f)), o).map_err(err)?;
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

static FLASH_GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static LATEST_BUSY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LatestCopied {
    ok: bool,
    title: Option<String>,
    id: Option<String>,
    findings: usize,
    missing: usize,
    error: Option<String>,
    source: String,
}

pub fn copy_latest_session(app: &AppHandle, source: &str) {
    use std::sync::atomic::Ordering;
    use tauri::Emitter;
    if LATEST_BUSY.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    let source = source.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let flash = |text: &str| {
            if let Some(tray) = app.tray_by_id("hopilo") {
                let _ = tray.set_title(Some(text));
                let _ = tray.set_tooltip(Some(format!("Hopilo · {text}")));
                let generation = FLASH_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
                let app2 = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    if FLASH_GENERATION.load(Ordering::SeqCst) != generation {
                        return;
                    }
                    if let Some(t) = app2.tray_by_id("hopilo") {
                        let _ = t.set_title(None::<&str>);
                        let _ = t.set_tooltip(Some("Hopilo"));
                    }
                });
            }
        };
        crate::commands::sync_blocking(&app, crate::commands::SyncMode::Wait);
        let state = app.state::<AppState>();
        let agents_only = state.setting("shortcutScope").and_then(|v| v.as_str().map(|s| s == "agents")).unwrap_or(false);
        let redact = state.setting("shortcutRedact").and_then(|v| v.as_bool()).unwrap_or(true);
        let latest = with_store(&state, |s| s.list_sessions().map_err(err)).ok().and_then(|rows| {
            rows.into_iter()
                .filter(|r| !agents_only || r.kind == "local-agent")
                .filter(|r| r.message_count > 0)
                .max_by(|a, b| a.updated_at.cmp(&b.updated_at))
        });
        let event = match latest {
            None => {
                flash("No sessions");
                LatestCopied { ok: false, title: None, id: None, findings: 0, missing: 0, error: Some("No sessions to copy yet.".into()), source }
            }
            Some(row) => {
                let opts = CopyOptions { exclude_secrets: redact, ..CopyOptions::default() };
                match copy_blocking(&app, std::slice::from_ref(&row.id), opts) {
                    Ok(out) => {
                        flash(if out.findings > 0 || out.missing > 0 { "Copied · check it" } else { "Copied" });
                        LatestCopied { ok: true, title: Some(out.title), id: Some(row.id), findings: out.findings, missing: out.missing, error: None, source }
                    }
                    Err(e) => {
                        flash("Copy failed");
                        LatestCopied { ok: false, title: Some(row.title), id: Some(row.id), findings: 0, missing: 0, error: Some(e), source }
                    }
                }
            }
        };
        let _ = app.emit("hopilo://latest-copied", event);
        LATEST_BUSY.store(false, Ordering::SeqCst);
    });
}

#[tauri::command]
pub fn copy_latest(app: AppHandle) {
    copy_latest_session(&app, "app");
}

#[tauri::command]
pub fn test_redaction_rule(pattern: String, keyword: bool, sample: String) -> hopilo_core::scan::RuleTest {
    hopilo_core::scan::test_rule(&pattern, keyword, &sample)
}

#[tauri::command]
pub fn builtin_redaction_kinds() -> Vec<&'static str> {
    hopilo_core::scan::BUILTIN_KINDS.to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;
    use hopilo_core::{Block, CapturedFile, CaptureStatus, ContextBrief, Integrity, Message, Mode, Source, SourceKind, SCHEMA_VERSION};

    #[test]
    fn redacted_archive_contains_sanitized_file_bytes_and_valid_references() {
        let file = CapturedFile { name: "config.txt".into(), media_type: "text/plain".into(), bytes: b"email admin@example.com".to_vec() };
        let attachment = file.attachment();
        let mut pack = Pack {
            schema_version: SCHEMA_VERSION.into(), pack_id: "p".into(), title: "Review admin@example.com".into(),
            version: 0, created_at: String::new(), mode: Mode::Full,
            sources: vec![Source {
                source_id: "s".into(), kind: SourceKind::Manual, provider: "manual".into(), title: "Review".into(),
                origin: None, project: None, model: None, captured_at: String::new(), capture_status: CaptureStatus::Complete,
                missing_items: vec![], omitted: vec![],
            }],
            messages: vec![Message { id: "m".into(), source_id: "s".into(), role: Role::User, created_at: None, blocks: vec![file.block(), file.block()] }],
            context: ContextBrief::default(), attachments: vec![attachment.clone(), attachment], tags: vec![], integrity: Integrity::default(),
        };
        pack.attachments[1].id.push_str("-second");
        let redactor = Redactor::builtin();
        let blobs = redact_export_pack(&mut pack, &redactor, true);
        let mut archive = std::io::Cursor::new(Vec::new());
        hopilo_pack_format::write_handoff(&pack, &RenderOptions::default(), &|a| blobs.get(&a.sha256).cloned(), &mut archive).unwrap();
        archive.set_position(0);
        let imported = hopilo_pack_format::read_handoff(archive).unwrap();
        assert!(!serde_json::to_string(&imported.pack).unwrap().contains("admin@example.com"));
        for a in &imported.pack.attachments {
            let bytes = &imported.attachments[&a.id];
            assert_eq!(bytes.as_slice(), b"email [REDACTED: Email address]");
            assert_eq!(a.size, bytes.len() as u64);
            assert_eq!(a.sha256, hopilo_pack_format::sha256_hex(bytes));
        }
        for b in &imported.pack.messages[0].blocks {
            assert!(matches!(b, Block::File { sha256, size, .. } if sha256 == &imported.pack.attachments[0].sha256 && *size == imported.pack.attachments[0].size));
        }
        assert_eq!(file.bytes, b"email admin@example.com", "original source remains unchanged");
    }
}
