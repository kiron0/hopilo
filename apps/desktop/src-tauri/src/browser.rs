//! Browser connection: register the native messaging host with Chromium
//! browsers so the Hopilo extension can reach the local library (spec 10.4).
//! Registration only writes a small JSON manifest into each browser's
//! `NativeMessagingHosts` folder, and only when the user asks.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::json;

pub use hopilo_native_host::{DEFAULT_EXTENSION_ID as EXTENSION_ID, FIREFOX_EXTENSION_ID, HOST_NAME};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTarget {
    pub id: &'static str,
    pub name: &'static str,
    /// The browser's profile folder exists on this computer.
    pub installed: bool,
    /// Our host manifest is present and points at this app's host binary.
    pub registered: bool,
    pub manifest_path: String,
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// (id, display name, profile folder) for each supported browser.
fn known_browsers() -> Vec<(&'static str, &'static str, PathBuf)> {
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
        // Windows registers hosts in the registry; not supported yet.
        vec![]
    }
}

fn manifest_path(id: &str, profile: &Path) -> PathBuf {
    // Firefox uses a differently named folder (lowercase with dashes on Linux).
    let folder = if id == "firefox" && cfg!(target_os = "linux") { "native-messaging-hosts" } else { "NativeMessagingHosts" };
    profile.join(folder).join(format!("{HOST_NAME}.json"))
}

/// The host executable shipped next to the app binary.
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
            let registered = std::fs::read_to_string(&mp)
                .ok()
                .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
                .zip(host.as_ref())
                .is_some_and(|(v, h)| v.get("path").and_then(|p| p.as_str()) == Some(&h.display().to_string()));
            BrowserTarget { id, name, installed: profile.is_dir(), registered, manifest_path: mp.display().to_string() }
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
        let mp = manifest_path(id, &profile);
        std::fs::create_dir_all(mp.parent().unwrap()).map_err(|e| format!("{name}: {e}"))?;
        std::fs::write(&mp, &body).map_err(|e| format!("{name}: {e}"))?;
        done.push(name.to_string());
    }
    Ok(done)
}

/// Remove only manifests that Hopilo wrote (same host name).
pub fn unregister(ids: &[String]) -> Result<Vec<String>, String> {
    let mut done = Vec::new();
    for (id, name, profile) in known_browsers() {
        if !ids.iter().any(|x| x == id) {
            continue;
        }
        let mp = manifest_path(id, &profile);
        if mp.is_file() {
            std::fs::remove_file(&mp).map_err(|e| format!("{name}: {e}"))?;
            done.push(name.to_string());
        }
    }
    Ok(done)
}

/// Where the unpacked extension lives in a development checkout.
pub fn extension_dir() -> Option<PathBuf> {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../extension/dist");
    std::fs::canonicalize(p).ok()
}

/// The Firefox build of the extension (load via about:debugging).
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
}
