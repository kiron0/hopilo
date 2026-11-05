use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use hopilo_core::{Message, Source};
use serde::Serialize;

pub mod aider;
pub mod claude_code;
pub mod codex;
pub mod cursor;
pub mod exports;
pub mod gemini_cli;
pub mod opencode;
mod text;
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
        Box::new(codex::Codex),
        Box::new(cursor::Cursor),
        Box::new(gemini_cli::GEMINI_CLI),
        Box::new(opencode::OpenCode),
        Box::new(gemini_cli::QWEN_CODE),
        Box::new(zed::Zed),
    ]
}

pub fn adapter_by_id(id: &str) -> Option<Box<dyn LocalAgentAdapter>> {
    all_adapters().into_iter().find(|a| a.id() == id)
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

pub(crate) fn open_lines(path: &Path) -> Result<impl Iterator<Item = std::io::Result<String>>> {

    let f = File::open(path).map_err(|source| AdapterError::Io {
        path: path.display().to_string(),
        source,
    })?;
    Ok(BufReader::new(f).lines())
}

pub(crate) fn file_meta(path: &Path) -> Result<(u64, String)> {
    let md = std::fs::metadata(path).map_err(|source| AdapterError::Io {
        path: path.display().to_string(),
        source,
    })?;
    let modified = md
        .modified()
        .ok()
        .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
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
        } else if ft.is_file() && p.extension().is_some_and(|e| e == "jsonl") {
            out.push(p);
        }
    }
}

pub(crate) fn omitted(list: &mut Vec<hopilo_core::OmittedCount>, what: &str, count: usize) {
    if count > 0 {
        list.push(hopilo_core::OmittedCount { what: what.to_string(), count });
    }
}
