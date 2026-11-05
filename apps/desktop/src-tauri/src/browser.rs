use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use serde_json::json;

pub use hopilo_native_host::{DEFAULT_EXTENSION_ID as EXTENSION_ID, FIREFOX_EXTENSION_ID, HOST_NAME};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTarget {
    pub id: &'static str,
    pub name: &'static str,

    pub installed: bool,

    pub registered: bool,
    pub manifest_path: String,
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn known_browsers() -> Vec<(&'static str, &'static str, PathBuf)> {
    if cfg!(windows) {
        let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
        let roaming = std::env::var_os("APPDATA").map(PathBuf::from);
        let mut browsers = Vec::new();
        if let Some(local) = local {
            browsers.extend([
                ("chrome", "Google Chrome", local.join("Google/Chrome/User Data")),
                ("chromium", "Chromium", local.join("Chromium/User Data")),
                ("edge", "Microsoft Edge", local.join("Microsoft/Edge/User Data")),
                ("brave", "Brave", local.join("BraveSoftware/Brave-Browser/User Data")),
            ]);
        }
        if let Some(roaming) = roaming {
            browsers.push(("firefox", "Firefox", roaming.join("Mozilla/Firefox")));
        }
        return browsers;
    }
    let Some(h) = home() else { return vec![] };
    if cfg!(target_os = "macos") {
        let s = h.join("Library").join("Application Support");
        vec![
            ("chrome", "Google Chrome", s.join("Google/Chrome")),
            ("chrome-beta", "Chrome Beta", s.join("Google/Chrome Beta")),
            ("chromium", "Chromium", s.join("Chromium")),
            ("edge", "Microsoft Edge", s.join("Microsoft Edge")),
            ("brave", "Brave", s.join("BraveSoftware/Brave-Browser")),
            ("arc", "Arc", s.join("Arc/User Data")),
            ("vivaldi", "Vivaldi", s.join("Vivaldi")),
            ("firefox", "Firefox", s.join("Mozilla")),
        ]
    } else if cfg!(target_os = "linux") {
        let c = h.join(".config");
        vec![
            ("chrome", "Google Chrome", c.join("google-chrome")),
            ("chromium", "Chromium", c.join("chromium")),
            ("edge", "Microsoft Edge", c.join("microsoft-edge")),
            ("brave", "Brave", c.join("BraveSoftware/Brave-Browser")),
            ("vivaldi", "Vivaldi", c.join("vivaldi")),
            ("firefox", "Firefox", h.join(".mozilla")),
        ]
    } else {
        vec![]
    }
}

fn manifest_path(id: &str, profile: &Path) -> Option<PathBuf> {
    if cfg!(windows) {
        return hopilo_native_host::default_data_dir()
            .map(|p| p.join("native-messaging").join(format!("{id}-{HOST_NAME}.json")));
    }
    let folder = if id == "firefox" && cfg!(target_os = "linux") { "native-messaging-hosts" } else { "NativeMessagingHosts" };
    Some(profile.join(folder).join(format!("{HOST_NAME}.json")))
}

fn registry_parent(id: &str) -> Option<&'static str> {
    match id {
        "chrome" => Some(r"HKCU\Software\Google\Chrome\NativeMessagingHosts"),
        "chromium" => Some(r"HKCU\Software\Chromium\NativeMessagingHosts"),
        "edge" => Some(r"HKCU\Software\Microsoft\Edge\NativeMessagingHosts"),
        "brave" => Some(r"HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts"),
        "firefox" => Some(r"HKCU\Software\Mozilla\NativeMessagingHosts"),
        _ => None,
    }
}

fn registry_key(id: &str) -> Option<String> {
    registry_parent(id).map(|p| format!(r"{p}\{HOST_NAME}"))
}

fn registry_registered(id: &str) -> bool {
    let Some(key) = registry_key(id) else { return false };
    Command::new("reg").args(["query", &key, "/ve"]).output().is_ok_and(|o| o.status.success())
}

fn register_windows(id: &str, manifest: &Path) -> Result<(), String> {
    let key = registry_key(id).ok_or_else(|| format!("Unsupported browser: {id}"))?;
    let path = manifest.to_string_lossy();
    let out = Command::new("reg")
        .args(["add", &key, "/ve", "/t", "REG_SZ", "/d", path.as_ref(), "/f"])
        .output()
        .map_err(|e| format!("Could not update Windows browser registration: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn unregister_windows(id: &str) -> Result<bool, String> {
    if !registry_registered(id) {
        return Ok(false);
    }
    let key = registry_key(id).ok_or_else(|| format!("Unsupported browser: {id}"))?;
    let out = Command::new("reg")
        .args(["delete", &key, "/f"])
        .output()
        .map_err(|e| format!("Could not update Windows browser registration: {e}"))?;
    if out.status.success() {
        Ok(true)
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

pub fn host_binary() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let name = if cfg!(windows) { "hopilo-native-host.exe" } else { "hopilo-native-host" };
    Some(exe.parent()?.join(name))
}

fn manifest_json(id: &str, host: &Path) -> serde_json::Value {
    let mut v = json!({
        "name": HOST_NAME,
        "description": "Hopilo desktop bridge",
        "path": host.display().to_string(),
        "type": "stdio",
    });
    if id == "firefox" {
        v["allowed_extensions"] = json!([FIREFOX_EXTENSION_ID]);
    } else {
        v["allowed_origins"] = json!([format!("chrome-extension://{EXTENSION_ID}/")]);
    }
    v
}

pub fn targets() -> Vec<BrowserTarget> {
    let host = host_binary();
    known_browsers()
        .into_iter()
        .map(|(id, name, profile)| {
            let mp = manifest_path(id, &profile);
            let registered = if cfg!(windows) {
                registry_registered(id)
            } else {
                mp.as_ref()
                    .and_then(|p| std::fs::read_to_string(p).ok())
                    .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
                    .zip(host.as_ref())
                    .is_some_and(|(v, h)| v.get("path").and_then(|p| p.as_str()) == Some(&h.display().to_string()))
            };
            BrowserTarget {
                id,
                name,
                installed: profile.is_dir(),
                registered,
                manifest_path: mp.map(|p| p.display().to_string()).unwrap_or_default(),
            }
        })
        .collect()
}

pub fn register(ids: &[String]) -> Result<Vec<String>, String> {
    let host = host_binary().ok_or("Couldn't locate the Hopilo bridge program")?;
    if !host.is_file() {
        return Err(format!("The bridge program is missing at {}. Rebuild Hopilo (cargo build -p hopilo-native-host).", host.display()));
    }
    let mut done = Vec::new();
    for (id, name, profile) in known_browsers() {
        if !ids.iter().any(|x| x == id) || !profile.is_dir() {
            continue;
        }
        let body = serde_json::to_vec_pretty(&manifest_json(id, &host)).map_err(|e| e.to_string())?;
        let mp = manifest_path(id, &profile).ok_or_else(|| format!("{name}: couldn't locate the app data folder"))?;
        let parent = mp.parent().ok_or_else(|| format!("{name}: invalid manifest path"))?;
        std::fs::create_dir_all(parent).map_err(|e| format!("{name}: {e}"))?;
        std::fs::write(&mp, &body).map_err(|e| format!("{name}: {e}"))?;
        if cfg!(windows) {
            register_windows(id, &mp).map_err(|e| format!("{name}: {e}"))?;
        }
        done.push(name.to_string());
    }
    Ok(done)
}

pub fn unregister(ids: &[String]) -> Result<Vec<String>, String> {
    let mut done = Vec::new();
    for (id, name, profile) in known_browsers() {
        if !ids.iter().any(|x| x == id) {
            continue;
        }
        let mp = manifest_path(id, &profile);
        let removed = if cfg!(windows) {
            unregister_windows(id).map_err(|e| format!("{name}: {e}"))?
        } else if let Some(path) = mp.as_ref().filter(|p| p.is_file()) {
            std::fs::remove_file(path).map_err(|e| format!("{name}: {e}"))?;
            true
        } else {
            false
        };
        if cfg!(windows) {
            if let Some(mp) = mp.filter(|p| p.is_file()) {
                std::fs::remove_file(mp).map_err(|e| format!("{name}: {e}"))?;
            }
        }
        if removed {
            done.push(name.to_string());
        }
    }
    Ok(done)
}

pub fn extension_dir() -> Option<PathBuf> {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../extension/dist");
    std::fs::canonicalize(p).ok()
}

pub fn firefox_extension_dir() -> Option<PathBuf> {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../extension/dist-firefox");
    std::fs::canonicalize(p).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_allows_only_our_extension() {
        let v = manifest_json("chrome", Path::new("/x/hopilo-native-host"));
        assert_eq!(v["name"], HOST_NAME);
        assert_eq!(v["type"], "stdio");
        assert_eq!(v["allowed_origins"], json!([format!("chrome-extension://{EXTENSION_ID}/")]));
        let f = manifest_json("firefox", Path::new("/x/hopilo-native-host"));
        assert_eq!(f["allowed_extensions"], json!([FIREFOX_EXTENSION_ID]));
        assert!(f.get("allowed_origins").is_none());
    }

    #[test]
    fn windows_registry_paths_are_browser_specific() {
        assert!(registry_key("chrome").unwrap().contains(r"Google\Chrome"));
        assert!(registry_key("edge").unwrap().contains(r"Microsoft\Edge"));
        assert!(registry_key("firefox").unwrap().contains(r"Mozilla"));
        assert!(registry_key("unknown").is_none());
    }
}
