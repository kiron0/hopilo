use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use hopilo_core::{Message, Source};
use serde::Serialize;

pub mod aider;
pub mod antigravity;
pub mod claude_code;
pub mod codex;
pub mod cursor;
pub mod cursor_cli;
pub mod exports;
pub mod gemini_cli;
pub mod generic;
pub mod opencode;
mod text;
pub mod vscode_chat;
pub mod zed;

#[derive(Debug, thiserror::Error)]
pub enum AdapterError {
    #[error("could not read {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("{0} is not a recognized session file")]
    Unrecognized(String),
}

pub type Result<T> = std::result::Result<T, AdapterError>;

pub(crate) fn macos_protected_user_path(path: &Path) -> bool {
    if !cfg!(target_os = "macos") {
        return false;
    }
    let Some(home) = home() else { return false };
    is_under_protected_folders(path, &home)
}

fn lexical_normalize(path: &Path) -> Vec<String> {
    use std::path::Component;
    let mut parts: Vec<String> = Vec::new();
    for c in path.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                if parts.last().is_some_and(|p| p != "/" && !p.ends_with(':')) {
                    parts.pop();
                }
            }
            Component::RootDir => parts.push("/".into()),
            Component::Prefix(p) => parts.push(p.as_os_str().to_string_lossy().to_ascii_lowercase()),
            Component::Normal(s) => parts.push(s.to_string_lossy().to_lowercase()),
        }
    }
    parts
}

pub(crate) fn is_under_protected_folders(path: &Path, home: &Path) -> bool {
    let p = lexical_normalize(path);
    ["desktop", "documents", "downloads"].iter().any(|folder| {
        let mut target = lexical_normalize(home);
        target.push((*folder).to_string());
        p.len() >= target.len() && p[..target.len()] == target[..]
    })
}

pub(crate) fn open_sqlite_ro(db: &Path) -> std::result::Result<rusqlite::Connection, rusqlite::Error> {
    let conn = rusqlite::Connection::open_with_flags(
        db,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let _ = conn.busy_timeout(std::time::Duration::from_millis(250));
    Ok(conn)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredSession {
    pub adapter: String,
    pub path: String,
    pub session_id: String,
    pub title: String,
    pub project: Option<String>,
    pub model: Option<String>,
    pub modified_at: String,
    pub size_bytes: u64,

    pub message_count: usize,
}

#[derive(Debug, Clone)]
pub struct Capture {
    pub source: Source,
    pub messages: Vec<Message>,

    pub files: Vec<hopilo_core::CapturedFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterInfo {
    pub id: &'static str,
    pub display_name: &'static str,
    pub roots: Vec<String>,
    pub available: bool,
}

pub trait LocalAgentAdapter: Send + Sync {
    fn id(&self) -> &'static str;
    fn display_name(&self) -> &'static str;

    fn default_roots(&self) -> Vec<PathBuf>;

    fn scan_depth(&self) -> usize {
        4
    }

    fn discover(&self, root: &Path) -> Result<Vec<DiscoveredSession>>;
    fn read(&self, path: &Path) -> Result<Capture>;

    fn info(&self) -> AdapterInfo {
        let roots = self.default_roots();
        AdapterInfo {
            id: self.id(),
            display_name: self.display_name(),
            available: roots.iter().any(|r| r.is_dir()),
            roots: roots.iter().map(|r| r.display().to_string()).collect(),
        }
    }
}

pub fn all_adapters() -> Vec<Box<dyn LocalAgentAdapter>> {
    vec![
        Box::new(claude_code::ClaudeCode),
        Box::new(antigravity::Antigravity),
        Box::new(codex::Codex),
        Box::new(cursor::Cursor),
        Box::new(cursor_cli::CursorCli),
        Box::new(gemini_cli::GEMINI_CLI),
        Box::new(opencode::OpenCode),
        Box::new(gemini_cli::QWEN_CODE),
        Box::new(vscode_chat::VsCodeChat),
        Box::new(generic::COPILOT_CLI),
        Box::new(generic::CLINE),
        Box::new(generic::ROO_CODE),
        Box::new(generic::KILO_CODE),
        Box::new(generic::DROID),
        Box::new(generic::PI),
        Box::new(generic::KIMI),
        Box::new(generic::GOOSE),
        Box::new(zed::Zed),
    ]
}

pub fn adapter_by_id(id: &str) -> Option<Box<dyn LocalAgentAdapter>> {
    all_adapters().into_iter().find(|a| a.id() == id)
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from)
}

pub(crate) fn open_lines(path: &Path) -> Result<Box<dyn Iterator<Item = std::io::Result<String>>>> {
    let io = |source| AdapterError::Io { path: path.display().to_string(), source };
    let f = File::open(path).map_err(io)?;
    let bounded = |reader| hopilo_core::limits::LimitedReader::new(reader, hopilo_core::limits::DOCUMENT_BYTES);
    if path.extension().is_some_and(|e| e == "zst") {
        let dec = zstd::stream::read::Decoder::new(f).map_err(io)?;
        return Ok(Box::new(BufReader::new(bounded(Box::new(dec) as Box<dyn std::io::Read>)).lines()));
    }
    Ok(Box::new(BufReader::new(bounded(Box::new(f) as Box<dyn std::io::Read>)).lines()))
}

pub(crate) fn is_jsonl(p: &Path) -> bool {
    let name = p.file_name().map(|n| n.to_string_lossy()).unwrap_or_default();
    name.ends_with(".jsonl") || name.ends_with(".jsonl.zst")
}

pub(crate) fn session_stem(p: &Path) -> String {
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    for ext in [".jsonl.zst", ".jsonl", ".json"] {
        if let Some(stem) = name.strip_suffix(ext) {
            return stem.to_string();
        }
    }
    p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
}

type MemoKey = (PathBuf, u64, Option<std::time::SystemTime>);
type Memo = std::sync::Mutex<std::collections::HashMap<PathBuf, (MemoKey, DiscoveredSession)>>;

fn memo() -> &'static Memo {
    static MEMO: std::sync::OnceLock<Memo> = std::sync::OnceLock::new();
    MEMO.get_or_init(Default::default)
}

pub(crate) fn par_scan<F>(files: &[PathBuf], scan: F) -> Vec<DiscoveredSession>
where
    F: Fn(&Path) -> Option<DiscoveredSession> + Sync,
{
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
    if files.len() < 16 || threads < 2 {
        return files.iter().filter_map(|p| memo_scan(p, &scan)).collect();
    }
    let chunk = files.len().div_ceil(threads);
    std::thread::scope(|s| {
        let handles: Vec<_> = files
            .chunks(chunk)
            .map(|part| s.spawn(|| part.iter().filter_map(|p| memo_scan(p, &scan)).collect::<Vec<_>>()))
            .collect();
        handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    })
}

pub(crate) fn memo_scan(
    path: &Path,
    scan: impl FnOnce(&Path) -> Option<DiscoveredSession>,
) -> Option<DiscoveredSession> {
    let md = std::fs::metadata(path).ok()?;
    let key: MemoKey = (path.to_path_buf(), md.len(), md.modified().ok());
    if let Some((k, v)) = memo().lock().ok().and_then(|m| m.get(path).cloned()) {
        if k == key {
            return Some(v);
        }
    }
    let v = scan(path)?;
    if let Ok(mut m) = memo().lock() {
        m.insert(path.to_path_buf(), (key, v.clone()));
    }
    Some(v)
}

pub(crate) type DbMemoKey = (u64, Option<std::time::SystemTime>, u64, Option<std::time::SystemTime>);
type DbMemo = std::sync::Mutex<std::collections::HashMap<PathBuf, (DbMemoKey, Vec<DiscoveredSession>)>>;

fn db_memo() -> &'static DbMemo {
    static MEMO: std::sync::OnceLock<DbMemo> = std::sync::OnceLock::new();
    MEMO.get_or_init(Default::default)
}

pub(crate) fn sqlite_cache_stamp(db: &Path) -> Option<DbMemoKey> {
    let md = std::fs::metadata(db).ok()?;
    let mut wal_os = db.as_os_str().to_os_string();
    wal_os.push("-wal");
    let wal_md = std::fs::metadata(Path::new(&wal_os)).ok();
    Some((md.len(), md.modified().ok(), wal_md.as_ref().map_or(0, |m| m.len()), wal_md.and_then(|m| m.modified().ok())))
}

pub(crate) fn db_memo_scan(
    db: &Path,
    scan: impl FnOnce(&Path) -> Result<Vec<DiscoveredSession>>,
) -> Result<Vec<DiscoveredSession>> {
    let Some(key) = sqlite_cache_stamp(db) else {
        return Ok(Vec::new());
    };
    if let Some((k, v)) = db_memo().lock().ok().and_then(|m| m.get(db).cloned()) {
        if k == key {
            return Ok(v);
        }
    }
    let v = scan(db)?;
    if let Ok(mut m) = db_memo().lock() {
        m.insert(db.to_path_buf(), (key, v.clone()));
    }
    Ok(v)
}

pub(crate) fn file_meta(path: &Path) -> Result<(u64, String)> {
    let md = std::fs::metadata(path).map_err(|source| AdapterError::Io { path: path.display().to_string(), source })?;
    let modified = md
        .modified()
        .ok()
        .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339_opts(chrono::SecondsFormat::Nanos, true))
        .unwrap_or_default();
    Ok((md.len(), modified))
}

pub(crate) fn jsonl_files(root: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(root) else { return };
    for entry in rd.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        let p = entry.path();
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() && depth > 0 {
            jsonl_files(&p, depth - 1, out);
        } else if ft.is_file() && is_jsonl(&p) {
            out.push(p);
        }
    }
}

pub(crate) fn omitted(list: &mut Vec<hopilo_core::OmittedCount>, what: &str, count: usize) {
    if count > 0 {
        list.push(hopilo_core::OmittedCount { what: what.to_string(), count });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protected_folders_normalize_case_and_dot_segments() {
        let h = Path::new("/Users/Alice");
        assert!(is_under_protected_folders(Path::new("/Users/Alice/documents/app/file.txt"), h));
        assert!(is_under_protected_folders(Path::new("/users/alice/foo/../Desktop/secret.png"), h));
        assert!(!is_under_protected_folders(Path::new("/Users/Alice/Projects/Desktop/app"), h));
    }
}
