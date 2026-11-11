#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn forward_to_cli() -> Option<i32> {
    let mut args = std::env::args_os().skip(1);
    let first = args.next()?;
    if !matches!(first.to_str()?, "mcp" | "sessions" | "handoff") {
        return None;
    }
    let exe = std::env::current_exe().ok()?;
    let name = if cfg!(windows) { "hopilo-cli.exe" } else { "hopilo-cli" };
    let cli = exe.parent()?.join(name);
    if !cli.is_file() {
        eprintln!("Hopilo: {} was not found next to the app", name);
        return Some(1);
    }
    let status = std::process::Command::new(cli).arg(first).args(args).status().ok()?;
    Some(status.code().unwrap_or(1))
}

fn main() {
    if let Some(code) = forward_to_cli() {
        std::process::exit(code);
    }
    hopilo_desktop_lib::run()
}
