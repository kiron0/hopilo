mod browser;
mod commands;
mod files;
mod handoff;

use std::sync::Mutex;
use std::time::{Duration, Instant};

use commands::AppState;
use hopilo_database::Store;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, PhysicalPosition, Rect, WindowEvent};

const MAIN_MIN_SHARE: f64 = 0.8;

fn fit_main_to_display(w: &tauri::WebviewWindow) {
    use tauri::LogicalSize;
    let Ok(Some(m)) = w.current_monitor().or_else(|_| w.primary_monitor()) else { return };
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

struct StartupState {
    show_main: std::sync::atomic::AtomicBool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CloseAction {
    Hide,
    Quit,
}

fn close_action(macos: bool, setting: Option<&str>) -> CloseAction {
    if macos || setting != Some("quit") { CloseAction::Hide } else { CloseAction::Quit }
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
    let store = state.store.try_lock().ok()?;
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
    let latest = MenuItem::with_id(app, "latest", "Copy latest session", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open Hopilo", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Hopilo", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&latest, &PredefinedMenuItem::separator(app)?, &open, &quit])?;
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
            "latest" => handoff::copy_latest_session(app),
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
                .with_denylist(&["quick"])
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
            app.manage(AppState {
                store: Mutex::new(store),
                discovery: Mutex::new(Default::default()),
                sync_lock: Mutex::new(()),
            });

            let sync_handle = app.handle().clone();
            tauri::async_runtime::spawn_blocking(move || commands::sync_blocking(&sync_handle, commands::SyncMode::Background));
            app.manage(PanelState { hidden_at: Mutex::new(None) });
            build_tray(app)?;

            if let Some(w) = app.get_webview_window("main") {
                fit_main_to_display(&w);
            }

            let first_run = !settings.contains_key("onboarded");
            let default_startup = if cfg!(target_os = "linux") { "overview" } else { "tray" };
            let startup = settings.get("startupSurface").and_then(|v| v.as_str()).unwrap_or(default_startup);
            let want = first_run || startup != "tray";
            app.manage(StartupState { show_main: std::sync::atomic::AtomicBool::new(want) });
            if want {

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
                match close_action(cfg!(target_os = "macos"), setting_str(window.app_handle(), "closeButton").as_deref()) {
                    CloseAction::Quit => window.app_handle().exit(0),
                    CloseAction::Hide => {
                        api.prevent_close();
                        if let Some(quick) = window.app_handle().get_webview_window("quick") {
                            let _ = quick.hide();
                        }
                        let _ = window.hide();
                    }
                }
            }
            ("main" | "quick", WindowEvent::Focused(true)) => {
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn_blocking(move || commands::sync_blocking(&app, commands::SyncMode::Background));
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
            commands::sync_sessions,
            commands::list_sessions,
            commands::list_hidden_sessions,
            commands::restore_session,
            commands::get_session,
            commands::update_session,
            commands::remove_session,
            commands::list_chat_export,
            commands::import_chat_export,
            commands::import_text,
            commands::import_aider_history,
            commands::import_handoff_file,
            commands::preflight_files,
            commands::add_files,
            commands::save_file,
            commands::open_file,
            commands::open_folder,
            commands::open_url,
            commands::list_handoffs,
            commands::recent_activity,
            commands::stats,
            commands::search,
            commands::get_settings,
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

    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            show_main(app);
        }
        let _ = (app, event);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_close_always_hides_but_other_platforms_honor_setting() {
        assert_eq!(close_action(true, Some("quit")), CloseAction::Hide);
        assert_eq!(close_action(false, Some("quit")), CloseAction::Quit);
        assert_eq!(close_action(false, Some("hide")), CloseAction::Hide);
    }
}
