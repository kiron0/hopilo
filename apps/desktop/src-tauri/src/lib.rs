mod backups;
mod browser;
mod commands;
mod compare;
mod files;
mod handoff;
mod model_limits;

use std::sync::Mutex;
use std::time::{Duration, Instant};

use commands::AppState;
use hopilo_database::Store;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Monitor, PhysicalPosition, Rect, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

const MAIN_MIN_SHARE: f64 = 0.8;

fn fit_main_to_display(w: &tauri::WebviewWindow) {
    fit_main_to_display_on(w, w.current_monitor().ok().flatten().or_else(|| w.primary_monitor().ok().flatten()));
}

fn fit_main_to_display_on(w: &tauri::WebviewWindow, monitor: Option<Monitor>) {
    let Some(m) = monitor else { return };
    let scale = m.scale_factor();
    let area = m.work_area().size.to_logical::<f64>(scale);
    let min = LogicalSize::new((area.width * MAIN_MIN_SHARE).round(), (area.height * MAIN_MIN_SHARE).round());
    let _ = w.set_min_size(Some(min));
    let _ = w.set_max_size(Some(area));
    if let (Ok(size), Ok(ws)) = (w.inner_size(), w.scale_factor()) {
        let s = size.to_logical::<f64>(ws);
        let fit = LogicalSize::new(s.width.clamp(min.width, area.width), s.height.clamp(min.height, area.height));
        if (fit.width - s.width).abs() > 0.5 || (fit.height - s.height).abs() > 0.5 {
            let _ = w.set_size(fit);
            let _ = w.center();
        }
    }
}
struct PanelState {
    hidden_at: Mutex<Option<Instant>>,
}

const FIRST_LAUNCH_KEY: &str = "firstLaunchAt";
const WELCOME_WIDTH: f64 = 390.0;
const WELCOME_TOP_OFFSET: f64 = 110.0;

#[tauri::command]
fn app_ready(window: tauri::Window, height: Option<f64>) {
    if window.label() != "welcome" {
        return;
    }
    let app = window.app_handle();
    let Some(w) = app.get_webview_window("welcome") else { return };
    if let Some(h) = height.filter(|h| h.is_finite() && *h > 100.0) {
        let _ = w.set_size(LogicalSize::new(WELCOME_WIDTH, h.ceil()));
    }
    place_on_cursor_monitor(&w, Placement::Top(WELCOME_TOP_OFFSET));
    set_dock_presence(app, true);
    let _ = w.show();
    let _ = w.set_focus();
}

#[tauri::command]
fn finish_welcome(app: AppHandle) {
    show_main(&app);
    if let Some(w) = app.get_webview_window("welcome") {
        let _ = w.close();
    }
}

fn open_welcome(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("welcome") {
        place_on_cursor_monitor(&w, Placement::Top(WELCOME_TOP_OFFSET));
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let builder = WebviewWindowBuilder::new(app, "welcome", WebviewUrl::App("index.html?surface=welcome".into()))
        .title("Welcome to Hopilo")
        .inner_size(WELCOME_WIDTH, 520.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .visible(false)
        .disable_drag_drop_handler();
    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
    builder.build()?;
    Ok(())
}

enum Placement {
    Top(f64),
    Center,
}

fn cursor_monitor(w: &WebviewWindow) -> Option<Monitor> {
    w.cursor_position()
        .ok()
        .and_then(|p| w.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| w.current_monitor().ok().flatten())
        .or_else(|| w.primary_monitor().ok().flatten())
}

fn place_on_cursor_monitor(w: &WebviewWindow, placement: Placement) {
    let Some(m) = cursor_monitor(w) else {
        let _ = w.center();
        return;
    };
    let area = m.work_area();
    let (ax, ay) = (area.position.x as f64, area.position.y as f64);
    let (aw, ah) = (area.size.width as f64, area.size.height as f64);
    let size = w.outer_size().unwrap_or_default();
    let (ww, wh) = (size.width as f64, size.height as f64);
    let x = ax + ((aw - ww) / 2.0).max(0.0);
    let y = match placement {
        Placement::Center => ay + ((ah - wh) / 2.0).max(0.0),
        Placement::Top(offset) => ay + (offset * m.scale_factor()).min((ah - wh).max(0.0)),
    };
    let _ = w.set_position(PhysicalPosition::new(x.round(), y.round()));
}

fn setting_str(app: &AppHandle, key: &str) -> Option<String> {
    app.state::<AppState>().setting(key)?.as_str().map(str::to_string)
}

#[cfg(target_os = "macos")]
fn set_dock_presence(app: &AppHandle, visible: bool) {
    let policy = if visible { tauri::ActivationPolicy::Regular } else { tauri::ActivationPolicy::Accessory };
    let _ = app.set_activation_policy(policy);
    if visible {
        use objc2::AnyThread;
        use objc2_app_kit::{NSApplication, NSImage};
        use objc2_foundation::{MainThreadMarker, NSData};
        if let Some(mtm) = MainThreadMarker::new() {
            let ns_app = NSApplication::sharedApplication(mtm);
            let data = NSData::with_bytes(include_bytes!("../icons/icon.png"));
            if let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) {
                unsafe {
                    ns_app.setApplicationIconImage(Some(&image));
                }
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn set_dock_presence(_app: &AppHandle, _visible: bool) {}

fn refresh_dock(app: &AppHandle, closing: Option<&str>) {
    let open = ["main", "welcome"].iter().any(|label| {
        Some(*label) != closing && app.get_webview_window(label).and_then(|w| w.is_visible().ok()).unwrap_or(false)
    });
    set_dock_presence(app, open);
}

fn emit_visibility(app: &AppHandle, label: &str, visible: bool) {
    let _ = app.emit_to(label, "hopilo://visibility", visible);
}

pub(crate) fn hide_quick(app: &AppHandle) {
    if let Some(q) = app.get_webview_window("quick") {
        let _ = q.hide();
        emit_visibility(app, "quick", false);
    }
}

pub(crate) fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        set_dock_presence(app, true);
        emit_visibility(app, "main", true);
        if !w.is_visible().unwrap_or(false) || w.is_minimized().unwrap_or(false) {
            fit_main_to_display_on(&w, cursor_monitor(&w));
            place_on_cursor_monitor(&w, Placement::Center);
        }
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn hide_main(window: &tauri::Window) {
    let _ = window.hide();
    emit_visibility(window.app_handle(), "main", false);
    refresh_dock(window.app_handle(), Some("main"));
}

const SHORTCUT_KEY: &str = "globalShortcut";

fn apply_shortcut(app: &AppHandle, accelerator: Option<&str>) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    match accelerator.map(str::trim).filter(|a| !a.is_empty()) {
        Some(a) => gs.register(a).map_err(|e| format!("Couldn't use {a} as a shortcut: {e}")),
        None => Ok(()),
    }
}

#[tauri::command]
fn set_global_shortcut(app: AppHandle, accelerator: Option<String>) -> Result<(), String> {
    let previous = setting_str(&app, SHORTCUT_KEY);
    if let Err(e) = apply_shortcut(&app, accelerator.as_deref()) {
        let _ = apply_shortcut(&app, previous.as_deref());
        return Err(e);
    }
    let value =
        accelerator.filter(|a| !a.trim().is_empty()).map(serde_json::Value::String).unwrap_or(serde_json::Value::Null);
    commands::save_setting_blocking(&app, SHORTCUT_KEY, value)
}

fn is_bundle_path(p: &std::path::Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("hopilo") || e.eq_ignore_ascii_case("handoff"))
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BundleImport {
    ids: Vec<String>,
    files: usize,
    errors: Vec<String>,
}

fn open_bundles(app: &AppHandle, paths: Vec<std::path::PathBuf>) {
    let paths: Vec<_> = paths.into_iter().filter(|p| is_bundle_path(p) && p.is_file()).collect();
    if paths.is_empty() {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let mut out = BundleImport { ids: vec![], files: paths.len(), errors: vec![] };
        for p in &paths {
            match commands::import_handoff_blocking(&app, &state, &p.to_string_lossy()) {
                Ok(ids) => out.ids.extend(ids),
                Err(e) => out.errors.push(format!(
                    "{}: {e}",
                    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
                )),
            }
        }
        show_main(&app);
        std::thread::sleep(Duration::from_millis(400));
        let _ = app.emit_to("main", "hopilo://bundle-imported", out);
    });
}

fn bundle_args(args: &[String]) -> Vec<std::path::PathBuf> {
    args.iter().skip(1).filter(|a| !a.starts_with('-')).map(std::path::PathBuf::from).collect()
}

#[allow(dead_code)]
fn answer_relaunch(app: &AppHandle) {
    let visible = |label: &str| app.get_webview_window(label).and_then(|w| w.is_visible().ok()).unwrap_or(false);
    if visible("main") {
        show_main(app);
    } else if !visible("quick") {
        toggle_quick_panel(app, tray_rect(app));
    }
}

#[allow(dead_code)]
fn tray_rect(app: &AppHandle) -> Option<Rect> {
    app.tray_by_id("hopilo")?.rect().ok().flatten()
}

fn toggle_quick_panel(app: &AppHandle, anchor_rect: Option<Rect>) {
    let Some(w) = app.get_webview_window("quick") else { return };
    if w.is_visible().unwrap_or(false) {
        hide_quick(app);
        return;
    }
    let recently_hidden = app
        .state::<PanelState>()
        .hidden_at
        .lock()
        .ok()
        .and_then(|t| *t)
        .is_some_and(|t| t.elapsed() < Duration::from_millis(250));
    if recently_hidden {
        return;
    }
    let rect = anchor_rect.or_else(|| tray_rect(app));
    if let Some(rect) = rect {
        let scale = w.scale_factor().unwrap_or(1.0);
        let pos = rect.position.to_logical::<f64>(scale);
        let size = rect.size.to_logical::<f64>(scale);
        let win = w.outer_size().unwrap_or_default().to_logical::<f64>(scale);
        let tray_center_x = pos.x + size.width / 2.0;
        let mut x = tray_center_x - win.width / 2.0;
        let mut y = if cfg!(target_os = "macos") { pos.y + size.height } else { pos.y - win.height - 6.0 };
        if let Ok(Some(m)) = w.current_monitor() {
            let mp = m.position().to_logical::<f64>(scale);
            let ms = m.size().to_logical::<f64>(scale);
            x = x.min(mp.x + ms.width - win.width - 8.0).max(mp.x + 8.0);
            y = y.max(mp.y);
        }
        let _ = w.set_position(LogicalPosition::new(x, y));
        let _ = app.emit_to("quick", "hopilo://quick-anchor", tray_center_x - x);
    }
    let _ = w.set_shadow(false);
    emit_visibility(app, "quick", true);
    let _ = w.show();
    let _ = w.set_focus();
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let latest = MenuItem::with_id(app, "latest", "Copy latest session", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open Hopilo", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Hopilo", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&latest, &PredefinedMenuItem::separator(app)?, &open, &settings, &PredefinedMenuItem::separator(app)?, &quit],
    )?;
    let icon_bytes: &[u8] = if cfg!(target_os = "macos") {
        include_bytes!("../icons/tray.png")
    } else {
        include_bytes!("../icons/32x32.png")
    };
    let icon = tauri::image::Image::from_bytes(icon_bytes)?;
    TrayIconBuilder::with_id("hopilo")
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Hopilo")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "latest" => handoff::copy_latest_session(app, "tray"),
            "open" => show_main(app),
            "settings" => {
                let _ = commands::show_main_window(app.clone(), Some("settings".into()));
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left, button_state: MouseButtonState::Up, rect, ..
            } = event
            {
                let app = tray.app_handle();
                if setting_str(app, "trayClick").as_deref() == Some("dashboard") {
                    show_main(app);
                } else {
                    toggle_quick_panel(app, Some(rect));
                }
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        let bundles = bundle_args(&args);
        if bundles.iter().any(|p| is_bundle_path(p)) {
            open_bundles(app, bundles);
        } else {
            answer_relaunch(app);
        }
    }));
    #[allow(unused_mut)]
    let mut app = builder
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&["quick", "welcome"])
                .with_state_flags(tauri_plugin_window_state::StateFlags::SIZE)
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        handoff::copy_latest_session(app, "shortcut");
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .setup(|app| {
            // Debug UI flows use a disposable library; release builds always use app data.
            let dir = if cfg!(debug_assertions) {
                std::env::var_os("HOPILO_TEST_DATA_DIR")
                    .map(std::path::PathBuf::from)
                    .unwrap_or(app.path().app_data_dir()?)
            } else {
                app.path().app_data_dir()?
            };
            let mut store = Store::open(&dir)
                .map_err(|e| format!("Could not open the Hopilo library at {}: {e}", dir.display()))?;
            let _ = store.remove_setting("modelLimits");
            let settings = store.settings().unwrap_or_default();
            app.manage(AppState {
                store: Mutex::new(store),
                discovery: Mutex::new(Default::default()),
                sync_lock: Mutex::new(()),
                last_background_sync: Mutex::new(None),
                settings: std::sync::RwLock::new(settings.clone()),
            });

            let first_launch = (!settings.contains_key(FIRST_LAUNCH_KEY) && !settings.contains_key("onboarded"))
                || (cfg!(debug_assertions) && std::env::var_os("HOPILO_SHOW_WELCOME").is_some());
            if !settings.contains_key(FIRST_LAUNCH_KEY) {
                let stamp = serde_json::Value::String(hopilo_core::now_rfc3339());
                if let Ok(mut store) = app.state::<AppState>().store.lock() {
                    let _ = store.set_setting(FIRST_LAUNCH_KEY, &stamp);
                }
                if let Ok(mut mirror) = app.state::<AppState>().settings.write() {
                    mirror.insert(FIRST_LAUNCH_KEY.into(), stamp);
                }
            }
            app.manage(model_limits::LimitState::default());
            app.manage(PanelState { hidden_at: Mutex::new(None) });
            build_tray(app)?;
            backups::start(app.handle());
            if let Some(accel) = settings.get(SHORTCUT_KEY).and_then(|v| v.as_str()) {
                if let Err(e) = apply_shortcut(app.handle(), Some(accel)) {
                    eprintln!("hopilo: {e}");
                }
            }
            let launch_bundles = bundle_args(&std::env::args().collect::<Vec<_>>());
            if !launch_bundles.is_empty() {
                open_bundles(app.handle(), launch_bundles);
            }

            if let Some(w) = app.get_webview_window("main") {
                fit_main_to_display(&w);
            }
            if first_launch {
                open_welcome(app.handle())?;
            }

            if !cfg!(debug_assertions) {
                use tauri_plugin_autostart::ManagerExt;
                let launcher = app.autolaunch();
                if launcher.is_enabled().unwrap_or(false) {
                    let _ = launcher.enable();
                }
            }

            let sync_handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(1));
                commands::sync_blocking(&sync_handle, commands::SyncMode::Background);
            });
            Ok(())
        })
        .on_window_event(|window, event| match (window.label(), event) {
            ("main", WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                hide_main(window);
            }
            ("main" | "quick", WindowEvent::Focused(true)) => {
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn_blocking(move || {
                    commands::sync_blocking(&app, commands::SyncMode::Background)
                });
            }
            ("welcome", WindowEvent::Destroyed) => refresh_dock(window.app_handle(), Some("welcome")),
            ("quick", WindowEvent::Focused(false)) => {
                hide_quick(window.app_handle());
                if let Ok(mut t) = window.app_handle().state::<PanelState>().hidden_at.lock() {
                    *t = Some(Instant::now());
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            app_ready,
            finish_welcome,
            set_global_shortcut,
            compare::compare_sessions,
            handoff::copy_latest,
            handoff::test_redaction_rule,
            handoff::builtin_redaction_kinds,
            backups::backup_status,
            backups::create_backup,
            backups::verify_backup,
            backups::restore_backup,
            backups::unlock_backup_schedule,
            backups::lock_backup_schedule,
            handoff::preview_handoff,
            handoff::handoff_messages,
            commands::app_info,
            commands::show_main_window,
            commands::quit_app,
            commands::sync_sessions,
            commands::list_sessions,
            commands::query_sessions,
            commands::list_hidden_sessions,
            commands::restore_session,
            commands::get_session,
            commands::update_session,
            commands::remove_session,
            commands::permanently_delete_sessions,
            commands::list_chat_export,
            commands::import_chat_export,
            commands::import_text,
            commands::import_aider_history,
            commands::import_handoff_file,
            commands::preflight_files,
            commands::add_files,
            commands::remove_session_file,
            commands::save_file,
            commands::preview_file,
            commands::read_file_preview,
            commands::open_file,
            commands::open_folder,
            commands::open_url,
            commands::list_handoffs,
            commands::recent_activity,
            commands::stats,
            commands::search,
            commands::get_settings,
            model_limits::sync_model_limits,
            model_limits::search_model_limits,
            commands::set_setting,
            commands::integrity_check,
            commands::audit_library,
            commands::wipe_library,
            commands::browser_status,
            commands::register_browser_host,
            commands::unregister_browser_host,
            handoff::copy_sessions,
            handoff::preflight_handoff,
            handoff::suggest_export_name,
            handoff::export_sessions,
            handoff::export_sessions_zip,
            handoff::capture_clipboard,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Hopilo");

    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            answer_relaunch(app);
        }
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = &event {
            open_bundles(app, urls.iter().filter_map(|u| u.to_file_path().ok()).collect());
        }
        let _ = (app, event);
    });
}
