//! Hopilo desktop shell: tray/menu-bar icon, Quick Panel, main window and
//! the IPC surface over the local library.

mod browser;
mod commands;
mod files;

use std::sync::Mutex;
use std::time::{Duration, Instant};

use commands::AppState;
use hopilo_database::Store;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, PhysicalPosition, Rect, RunEvent, WindowEvent};

/// When the Quick Panel last hid because it lost focus. A tray click that
/// arrives right after should close it, not reopen it.
struct PanelState {
    hidden_at: Mutex<Option<Instant>>,
}

/// Set at launch when the main window should open; the window is shown when
/// the page reports it has painted (no blank or wrong-theme first frame).
struct StartupState {
    show_main: std::sync::atomic::AtomicBool,
}

#[tauri::command]
fn app_ready(window: tauri::Window) {
    let app = window.app_handle();
    if window.label() == "main" && app.state::<StartupState>().show_main.swap(false, std::sync::atomic::Ordering::SeqCst) {
        show_main(app);
    }
}

fn setting_str(app: &AppHandle, key: &str) -> Option<String> {
    let state = app.state::<AppState>();
    let store = state.store.lock().ok()?;
    store.settings().ok()?.get(key)?.as_str().map(str::to_string)
}

pub(crate) fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn toggle_quick_panel(app: &AppHandle, tray_rect: Option<Rect>) {
    let Some(w) = app.get_webview_window("quick") else { return };
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
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
    if let Some(rect) = tray_rect {
        // Anchor under (macOS) or above (Windows/Linux taskbar) the tray icon.
        let scale = w.scale_factor().unwrap_or(1.0);
        let pos = rect.position.to_physical::<f64>(scale);
        let size = rect.size.to_physical::<f64>(scale);
        let win = w.outer_size().unwrap_or_default();
        let mut x = pos.x + size.width / 2.0 - win.width as f64 / 2.0;
        let mut y = if cfg!(target_os = "macos") { pos.y + size.height + 6.0 } else { pos.y - win.height as f64 - 6.0 };
        if let Ok(Some(m)) = w.current_monitor() {
            let mp = m.position();
            let ms = m.size();
            x = x.clamp(mp.x as f64 + 8.0, (mp.x + ms.width as i32) as f64 - win.width as f64 - 8.0);
            y = y.max(mp.y as f64);
        }
        let _ = w.set_position(PhysicalPosition::new(x, y));
    }
    let _ = w.show();
    let _ = w.set_focus();
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Hopilo", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Hopilo", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &PredefinedMenuItem::separator(app)?, &quit])?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    TrayIconBuilder::with_id("hopilo")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Hopilo")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = event {
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
    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&["quick", "shelf"])
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE | tauri_plugin_window_state::StateFlags::POSITION,
                )
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let store = Store::open(&dir).map_err(|e| format!("Could not open the Hopilo library at {}: {e}", dir.display()))?;
            let settings = store.settings().unwrap_or_default();
            app.manage(AppState { store: Mutex::new(store), discovery: Mutex::new(Default::default()) });
            app.manage(PanelState { hidden_at: Mutex::new(None) });
            build_tray(app)?;

            let first_run = !settings.contains_key("onboarded");
            let startup = settings.get("startupSurface").and_then(|v| v.as_str()).unwrap_or("tray");
            let want = first_run || startup != "tray";
            app.manage(StartupState { show_main: std::sync::atomic::AtomicBool::new(want) });
            if want {
                // Fallback: show anyway if the page never reports ready.
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(3));
                    if handle.state::<StartupState>().show_main.swap(false, std::sync::atomic::Ordering::SeqCst) {
                        show_main(&handle);
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| match (window.label(), event) {
            ("main", WindowEvent::CloseRequested { api, .. }) => {
                if setting_str(window.app_handle(), "closeButton").as_deref() == Some("quit") {
                    window.app_handle().exit(0);
                } else {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            ("quick", WindowEvent::Focused(false)) => {
                let _ = window.hide();
                if let Ok(mut t) = window.app_handle().state::<PanelState>().hidden_at.lock() {
                    *t = Some(Instant::now());
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            app_ready,
            commands::app_info,
            commands::show_main_window,
            commands::quit_app,
            commands::discover_sessions,
            commands::import_session,
            commands::import_text,
            commands::list_chat_export,
            commands::import_chat_export,
            commands::list_sources,
            commands::get_source,
            commands::delete_source,
            commands::preflight_files,
            commands::import_files,
            commands::list_attachments,
            commands::delete_attachment,
            commands::build_pack,
            commands::quick_pack_from_session,
            commands::list_packs,
            commands::get_pack,
            commands::update_pack,
            commands::delete_pack,
            commands::duplicate_pack,
            commands::restore_version,
            commands::preview_pack,
            commands::suggest_export_name,
            commands::export_pack,
            commands::import_pack_file,
            commands::record_handoff,
            commands::list_handoffs,
            commands::recent_activity,
            commands::stats,
            commands::search,
            commands::get_settings,
            commands::set_setting,
            commands::integrity_check,
            commands::wipe_library,
            commands::browser_status,
            commands::register_browser_host,
            commands::unregister_browser_host,
            commands::ollama_status,
            commands::ollama_summarize,
            commands::diff_versions,
            commands::pack_relations,
            commands::set_pack_tags,
            commands::split_pack,
            commands::merge_packs,
            commands::pull_new_messages,
            commands::audit_library,
            commands::import_aider_history,
            commands::open_drop_shelf,
            commands::close_drop_shelf,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Hopilo");

    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { .. } = event {
            show_main(app);
        }
        let _ = (app, event);
    });
}
