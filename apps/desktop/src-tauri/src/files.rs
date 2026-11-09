use std::io::Read;
use std::path::{Path, PathBuf};

use hopilo_core::{new_id, Attachment};
use hopilo_pack_format::sha256_hex;
use serde::Serialize;

pub const MAX_FILE_BYTES: u64 = 25 * 1024 * 1024;
const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_FOLDER_FILES: usize = 200;
const MAX_FOLDER_DEPTH: usize = 3;
const SKIP_DIRS: &[&str] = &["node_modules", ".git", "target", "dist", "build", ".venv", "__pycache__"];

const TEXT_EXTS: &[&str] = &[
    "txt",
    "md",
    "markdown",
    "json",
    "jsonl",
    "csv",
    "tsv",
    "log",
    "yaml",
    "yml",
    "toml",
    "xml",
    "html",
    "htm",
    "css",
    "scss",
    "js",
    "jsx",
    "mjs",
    "cjs",
    "ts",
    "tsx",
    "py",
    "rs",
    "go",
    "java",
    "kt",
    "swift",
    "c",
    "h",
    "cc",
    "cpp",
    "hpp",
    "cs",
    "rb",
    "php",
    "sh",
    "zsh",
    "bash",
    "fish",
    "sql",
    "ini",
    "cfg",
    "conf",
    "graphql",
    "proto",
    "lua",
    "dart",
    "scala",
    "r",
    "vue",
    "svelte",
    "gradle",
    "properties",
    "tex",
    "rst",
];
const TEXT_NAMES: &[&str] = &["dockerfile", "makefile", "readme", "license", "gemfile", "procfile"];
const SENSITIVE_NAMES: &[&str] = &[".env", "id_rsa", "id_ed25519", ".npmrc", ".pypirc", "credentials", ".netrc"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePreflight {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub media_type: String,

    pub kind: String,
    pub accepted: bool,
    pub duplicate: bool,
    pub warnings: Vec<String>,
    pub error: Option<String>,
}

fn classify(path: &Path) -> (String, &'static str) {
    let name = path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let image = |m: &str| (m.to_string(), "image");
    match ext.as_str() {
        "png" => image("image/png"),
        "jpg" | "jpeg" => image("image/jpeg"),
        "gif" => image("image/gif"),
        "webp" => image("image/webp"),
        "svg" => image("image/svg+xml"),
        "heic" => image("image/heic"),
        "pdf" => ("application/pdf".into(), "pdf"),
        "html" | "htm" => ("text/html".into(), "html"),
        "mp3" => ("audio/mpeg".into(), "audio"),
        "wav" => ("audio/wav".into(), "audio"),
        "m4a" => ("audio/mp4".into(), "audio"),
        "aac" => ("audio/aac".into(), "audio"),
        "flac" => ("audio/flac".into(), "audio"),
        "ogg" | "opus" => ("audio/ogg".into(), "audio"),
        "mp4" | "m4v" => ("video/mp4".into(), "video"),
        "mov" => ("video/quicktime".into(), "video"),
        "webm" => ("video/webm".into(), "video"),
        "ogv" => ("video/ogg".into(), "video"),
        "json" | "jsonl" => ("application/json".into(), "text"),
        "md" | "markdown" => ("text/markdown".into(), "text"),
        "csv" => ("text/csv".into(), "text"),
        e if TEXT_EXTS.contains(&e) => ("text/plain".into(), "text"),
        _ if TEXT_NAMES.contains(&name.as_str()) || name.starts_with('.') => ("text/plain".into(), "text"),
        _ => ("application/octet-stream".into(), "binary"),
    }
}

pub fn expand(paths: &[String]) -> (Vec<PathBuf>, Vec<String>) {
    let mut out = Vec::new();
    let mut notes = Vec::new();
    fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>, notes: &mut Vec<String>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        let mut entries: Vec<_> = rd.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            if out.len() >= MAX_FOLDER_FILES {
                return;
            }
            let name = e.file_name().to_string_lossy().to_string();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_symlink() {
                notes.push(format!("Skipped symlink {}", e.path().display()));
                continue;
            }
            if ft.is_dir() {
                if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
                    continue;
                }
                if depth == 0 {
                    notes.push(format!("Stopped at depth limit in {}", e.path().display()));
                    continue;
                }
                walk(&e.path(), depth - 1, out, notes);
            } else if ft.is_file() && name != ".DS_Store" {
                out.push(e.path());
            }
        }
    }
    for p in paths {
        let path = PathBuf::from(p);
        if path.is_dir() {
            let before = out.len();
            walk(&path, MAX_FOLDER_DEPTH, &mut out, &mut notes);
            if out.len() >= MAX_FOLDER_FILES {
                notes.push(format!("Folder import is limited to {MAX_FOLDER_FILES} files; the rest were not listed"));
            }
            if out.len() == before {
                notes.push(format!("No importable files in {}", path.display()));
            }
        } else {
            out.push(path);
        }
    }
    let mut seen = std::collections::HashSet::new();
    out.retain(|p| seen.insert(p.clone()));
    (out, notes)
}

pub fn preflight(path: &Path, is_known: &dyn Fn(&str) -> bool) -> FilePreflight {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let (media_type, kind) = classify(path);
    let mut pf = FilePreflight {
        path: path.display().to_string(),
        name: name.clone(),
        size: 0,
        media_type,
        kind: kind.into(),
        accepted: false,
        duplicate: false,
        warnings: vec![],
        error: None,
    };
    let meta = match std::fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) => {
            pf.error = Some(format!("Cannot read: {e}"));
            return pf;
        }
    };
    if meta.file_type().is_symlink() {
        match std::fs::canonicalize(path) {
            Ok(real) => pf.warnings.push(format!("Symlink — will import the target {}", real.display())),
            Err(_) => {
                pf.error = Some("Broken symlink".into());
                return pf;
            }
        }
    }
    let meta = match std::fs::metadata(path) {
        Ok(m) if m.is_file() => m,
        Ok(_) => {
            pf.error = Some("Not a regular file".into());
            return pf;
        }
        Err(e) => {
            pf.error = Some(format!("Cannot read: {e}"));
            return pf;
        }
    };
    pf.size = meta.len();
    if pf.size > MAX_FILE_BYTES {
        pf.error = Some(format!("Larger than the {} MB limit", MAX_FILE_BYTES / 1024 / 1024));
        return pf;
    }
    let lower = name.to_lowercase();
    if SENSITIVE_NAMES.iter().any(|s| lower == *s || lower.starts_with(&format!("{s}."))) {
        pf.warnings.push("Looks like a credentials file — review before sharing".into());
    }
    match kind {
        "text" if pf.size > MAX_TEXT_BYTES => {
            pf.warnings.push("Large text file — stored as a file, not inlined into handoffs".into())
        }
        "pdf" => pf.warnings.push("PDF text is not extracted yet — attach the original file at the destination".into()),
        "image" => pf.warnings.push("Images are kept as original files — attach them at the destination".into()),
        "binary" => pf.warnings.push("Unrecognized type — kept as a file only".into()),
        _ => {}
    }
    match read_bounded(path) {
        Ok(bytes) => {
            if matches!(kind, "text" | "html") && std::str::from_utf8(&bytes).is_err() {
                pf.warnings.push("Not valid UTF-8 text — kept as a file only".into());
            }
            pf.duplicate = is_known(&sha256_hex(&bytes));
            if pf.duplicate {
                pf.warnings.push("Already in your library — the existing copy will be reused".into());
            }
            pf.accepted = true;
        }
        Err(e) => pf.error = Some(format!("Cannot read: {e}")),
    }
    pf
}

pub fn load(path: &Path) -> Result<(Attachment, Vec<u8>), String> {
    let pf_name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "file".into());
    let meta = std::fs::metadata(path).map_err(|e| format!("{pf_name}: {e}"))?;
    if !meta.is_file() {
        return Err(format!("{pf_name}: not a regular file"));
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err(format!("{pf_name}: larger than the size limit"));
    }
    let bytes = read_bounded(path).map_err(|e| format!("{pf_name}: {e}"))?;
    let size = bytes.len() as u64;
    if size > MAX_FILE_BYTES {
        return Err(format!("{pf_name}: larger than the size limit"));
    }
    let (media_type, kind) = classify(path);
    let text = (matches!(kind, "text" | "html") && size <= MAX_TEXT_BYTES)
        .then(|| std::str::from_utf8(&bytes).ok().map(str::to_owned))
        .flatten();
    Ok((
        Attachment {
            id: new_id(),
            file_name: pf_name,
            media_type,
            size,
            sha256: sha256_hex(&bytes),
            origin_path: Some(path.display().to_string()),
            text,
        },
        bytes,
    ))
}

fn read_bounded(path: &Path) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)?.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(std::io::Error::other("larger than the size limit"));
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_expansion_skips_symlinks_and_vendor_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join("a.md"), "# hi").unwrap();
        std::fs::create_dir(root.join("node_modules")).unwrap();
        std::fs::write(root.join("node_modules/x.js"), "x").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("/etc/hosts", root.join("link")).unwrap();
        let (files, _notes) = expand(&[root.display().to_string(), root.join("a.md").display().to_string()]);
        assert_eq!(files, vec![root.join("a.md")]);
        #[cfg(unix)]
        assert!(_notes.iter().any(|n| n.contains("Skipped symlink")));
    }

    #[test]
    fn classifies_common_types() {
        assert_eq!(classify(Path::new("a.rs")).1, "text");
        assert_eq!(classify(Path::new("Dockerfile")).1, "text");
        assert_eq!(classify(Path::new("x.pdf")).1, "pdf");
        assert_eq!(classify(Path::new("x.PNG")).1, "image");
        assert_eq!(classify(Path::new("x.bin")).1, "binary");
    }

    #[test]
    fn load_extracts_utf8_text_only() {
        let dir = tempfile::tempdir().unwrap();
        let t = dir.path().join("n.txt");
        std::fs::write(&t, "hello").unwrap();
        let (a, b) = load(&t).unwrap();
        assert_eq!(a.text.as_deref(), Some("hello"));
        assert_eq!(b, b"hello");
        let bin = dir.path().join("n.log");
        std::fs::write(&bin, [0xff, 0xfe, 0x00]).unwrap();
        assert!(load(&bin).unwrap().0.text.is_none());
    }
}

/// Preview bytes stay bounded and are read from content-addressed library storage.
pub fn preview_chunk(root: &Path, sha: &str, offset: u64, length: u32) -> std::io::Result<Vec<u8>> {
    use std::io::{Seek, SeekFrom};
    if sha.len() != 64 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) || length > 1024 * 1024 {
        return Err(std::io::Error::other("Invalid preview reference or chunk size"));
    }
    let path = root.join("attachments").join(sha);
    let meta = std::fs::symlink_metadata(&path)?;
    if !meta.is_file() || meta.len() > 64 * 1024 * 1024 || offset > meta.len() {
        return Err(std::io::Error::other("Preview unavailable: library file is invalid or exceeds 64 MiB"));
    }
    let mut file = std::fs::File::open(path)?;
    file.seek(SeekFrom::Start(offset))?;
    let mut out = Vec::new();
    file.take(length as u64).read_to_end(&mut out)?;
    Ok(out)
}

#[cfg(test)]
mod preview_tests {
    use super::*;
    #[test]
    fn preview_reads_only_bounded_hash_named_regular_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("attachments")).unwrap();
        let sha = "a".repeat(64);
        std::fs::write(dir.path().join("attachments").join(&sha), b"abcdef").unwrap();
        assert_eq!(preview_chunk(dir.path(), &sha, 2, 3).unwrap(), b"cde");
        assert!(preview_chunk(dir.path(), "../hopilo.db", 0, 1).is_err());
        assert!(preview_chunk(dir.path(), &sha, 0, 1024 * 1024 + 1).is_err());
        assert!(preview_chunk(dir.path(), &sha, 7, 1).is_err());
        assert!(preview_chunk(dir.path(), &sha, 6, 1).unwrap().is_empty());
        let huge = std::fs::File::create(dir.path().join("attachments").join("b".repeat(64))).unwrap();
        huge.set_len(64 * 1024 * 1024 + 1).unwrap();
        assert!(preview_chunk(dir.path(), &"b".repeat(64), 0, 1).is_err());
        #[cfg(unix)]
        {
            let link = "c".repeat(64);
            std::os::unix::fs::symlink(
                dir.path().join("attachments").join(&sha),
                dir.path().join("attachments").join(&link),
            )
            .unwrap();
            assert!(preview_chunk(dir.path(), &link, 0, 1).is_err());
        }
    }
}
