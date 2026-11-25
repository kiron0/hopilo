#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn forward_to_cli() -> Option<i32> {
    let mut args = std::env::args_os().skip(1);
    let first = args.next()?;
    if !matches!(first.to_str(), Some("mcp" | "sessions" | "handoff" | "--help" | "-h" | "--version" | "-V")) {
        return None;
    }
    let name = if cfg!(windows) { "hopilo-cli.exe" } else { "hopilo-cli" };
    let Ok(exe) = std::env::current_exe() else {
        eprintln!("Hopilo: failed to locate current executable for {name}");
        return Some(1);
    };
    let Some(dir) = exe.parent() else {
        eprintln!("Hopilo: failed to locate directory for {name}");
        return Some(1);
    };
    let cli = dir.join(name);
    if !cli.is_file() {
        eprintln!("Hopilo: {name} was not found next to the app");
        return Some(1);
    }
    match std::process::Command::new(cli).arg(first).args(args).status() {
        Ok(status) => Some(status.code().unwrap_or(1)),
        Err(e) => {
            eprintln!("Hopilo: failed to launch {name}: {e}");
            Some(1)
        }
    }
}

fn main() {
    if let Some(code) = forward_to_cli() {
        std::process::exit(code);
    }
    hopilo_desktop_lib::run()
}
