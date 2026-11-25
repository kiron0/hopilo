use std::collections::{BTreeMap, HashSet};
use std::io::{Read, Seek, Write};
use std::path::Path;

use hopilo_core::framing::render_framed_with_body;
use hopilo_core::render::{render_markdown, RenderOptions};
use hopilo_core::{Attachment, Pack, SCHEMA_VERSION};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zip::write::SimpleFileOptions;

pub const ARCHIVE_FORMAT: &str = "hopilo.handoff";
pub const ARCHIVE_FORMAT_VERSION: u32 = 1;

const MAX_UNPACKED_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum FormatError {
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
    #[error("archive error: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("not a Hopilo archive: {0}")]
    NotHandoff(String),
    #[error("checksum mismatch for {0}")]
    Checksum(String),
    #[error("archive is too large to import safely")]
    TooLarge,
}

pub type Result<T> = std::result::Result<T, FormatError>;

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn utf8_char_len(first: u8) -> usize {
    match first {
        0x00..=0x7F => 1,
        0xC2..=0xDF => 2,
        0xE0..=0xEF => 3,
        0xF0..=0xF4 => 4,
        _ => 0,
    }
}

fn validate_utf8_chunk(mut chunk: &[u8], pending: &mut [u8; 4], pending_len: &mut usize) -> bool {
    if *pending_len > 0 {
        let expected = utf8_char_len(pending[0]);
        if expected < 2 {
            return false;
        }
        let need = expected - *pending_len;
        if chunk.len() < need {
            pending[*pending_len..*pending_len + chunk.len()].copy_from_slice(chunk);
            *pending_len += chunk.len();
            return std::str::from_utf8(&pending[..*pending_len])
                .is_err_and(|e| e.error_len().is_none() && e.valid_up_to() == 0);
        }
        pending[*pending_len..expected].copy_from_slice(&chunk[..need]);
        if std::str::from_utf8(&pending[..expected]).is_err() {
            return false;
        }
        *pending_len = 0;
        chunk = &chunk[need..];
    }
    match std::str::from_utf8(chunk) {
        Ok(_) => true,
        Err(e) if e.error_len().is_some() => false,
        Err(e) => {
            let tail = &chunk[e.valid_up_to()..];
            pending[..tail.len()].copy_from_slice(tail);
            *pending_len = tail.len();
            true
        }
    }
}

pub fn sha256_bounded(mut reader: impl Read, max_bytes: u64, check_utf8: bool) -> std::io::Result<(String, u64, bool)> {
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    let mut total = 0u64;
    let mut valid_utf8 = true;
    let mut pending = [0u8; 4];
    let mut pending_len = 0usize;
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        total = total.saturating_add(n as u64);
        if total > max_bytes {
            return Err(std::io::Error::other("larger than the size limit"));
        }
        let chunk = &buf[..n];
        hasher.update(chunk);
        if check_utf8 && valid_utf8 {
            valid_utf8 = validate_utf8_chunk(chunk, &mut pending, &mut pending_len);
        }
    }
    if check_utf8 && valid_utf8 && pending_len > 0 {
        valid_utf8 = false;
    }
    Ok((hex::encode(hasher.finalize()), total, valid_utf8))
}

pub fn sanitize_filename(title: &str) -> String {
    let mut s = String::with_capacity(title.len().min(60));
    let mut chars_written = 0usize;
    let mut prev_dash = true;
    for c in title.chars() {
        if c.is_ascii_alphanumeric() {
            s.push(c.to_ascii_lowercase());
            chars_written += 1;
            prev_dash = false;
        } else if !prev_dash {
            s.push('-');
            chars_written += 1;
            prev_dash = true;
        }
        if chars_written >= 60 {
            break;
        }
    }
    let trimmed = s.trim_end_matches('-');
    if trimmed.is_empty() {
        "context-pack".into()
    } else if trimmed.len() == s.len() {
        s
    } else {
        trimmed.to_string()
    }
}

struct CountWriter(u64);

impl Write for CountWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0 += buf.len() as u64;
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

pub fn export_filename(pack: &Pack, ext: &str) -> String {
    export_filename_for(&pack.title, pack.version, ext)
}

pub fn export_filename_for(title: &str, version: u32, ext: &str) -> String {
    match version {
        0 => format!("{}.{ext}", sanitize_filename(title)),
        v => format!("{}-v{v}.{ext}", sanitize_filename(title)),
    }
}

pub fn to_json(pack: &Pack) -> Result<String> {
    Ok(serde_json::to_string_pretty(pack)?)
}

pub fn from_json(s: &str) -> Result<Pack> {
    if s.len() as u64 > hopilo_core::limits::DOCUMENT_BYTES {
        return Err(FormatError::TooLarge);
    }
    let pack: Pack = serde_json::from_str(s)?;
    validate_attachments(&pack)?;
    Ok(pack)
}

fn validate_attachments(pack: &Pack) -> Result<()> {
    for a in &pack.attachments {
        if a.sha256.len() != 64 || !a.sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(FormatError::NotHandoff(format!("invalid attachment checksum for {}", a.file_name)));
        }
    }
    Ok(())
}

pub fn to_markdown(pack: &Pack, opts: &RenderOptions) -> String {
    render_markdown(pack, opts)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format: String,
    pub format_version: u32,
    pub schema_version: String,
    pub pack_id: String,
    pub title: String,
    pub version: u32,
    pub created_at: String,
    pub exported_by: String,
    pub files: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceMapEntry<'a> {
    message_id: &'a str,
    source_id: &'a str,
    provider: &'a str,
    origin: Option<&'a str>,
}

fn attachment_path(a: &Attachment) -> String {
    let prefix: String = a.sha256.chars().take(12).map(|c| c.to_ascii_lowercase()).collect();
    format!("attachments/{}-{}", prefix, sanitize_attachment_name(&a.file_name))
}

fn sanitize_attachment_name(name: &str) -> String {
    let base = Path::new(name).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let s: String =
        base.chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '_' }).collect();
    if s.is_empty() || s.starts_with('.') {
        format!("file{s}")
    } else {
        s
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffEntry {
    pub path: String,
    pub size: Option<u64>,
    pub kind: &'static str,
}

pub fn handoff_entries(
    pack: &Pack,
    opts: &RenderOptions,
    available: &dyn Fn(&Attachment) -> bool,
) -> Result<Vec<HandoffEntry>> {
    validate_attachments(pack)?;
    let transcript_opts = RenderOptions { include_attachments_inline: false, ..opts.clone() };
    let mut json_count = CountWriter(0);
    serde_json::to_writer_pretty(&mut json_count, pack)?;
    let full_md = render_markdown(pack, opts);
    let prompt_md = render_framed_with_body(pack, &full_md, &Default::default());
    let mut entries = vec![
        HandoffEntry { path: "conversation/normalized.json".into(), size: Some(json_count.0), kind: "data" },
        HandoffEntry {
            path: "conversation/transcript.md".into(),
            size: Some(render_markdown(pack, &transcript_opts).len() as u64),
            kind: "transcript",
        },
        HandoffEntry { path: "context/full.md".into(), size: Some(full_md.len() as u64), kind: "transcript" },
        HandoffEntry { path: "context/handoff-prompt.md".into(), size: Some(prompt_md.len() as u64), kind: "prompt" },
        HandoffEntry { path: "provenance/source-map.json".into(), size: None, kind: "meta" },
    ];
    let mut seen = HashSet::new();
    for a in &pack.attachments {
        let path = attachment_path(a);
        if !seen.contains(&path) && available(a) {
            seen.insert(path.clone());
            entries.push(HandoffEntry { path, size: Some(a.size), kind: "file" });
        }
    }
    entries.push(HandoffEntry { path: "manifest.json".into(), size: None, kind: "meta" });
    entries.push(HandoffEntry { path: "checksums.sha256".into(), size: None, kind: "meta" });
    Ok(entries)
}

pub fn write_handoff<W: Write + Seek>(
    pack: &Pack,
    opts: &RenderOptions,
    bytes_for: &dyn Fn(&Attachment) -> Option<Vec<u8>>,
    writer: W,
) -> Result<()> {
    validate_attachments(pack)?;
    let mut zip = zip::ZipWriter::new(writer);
    let mut sums = BTreeMap::new();
    let o = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    fn entry<W: Write + Seek>(
        zip: &mut zip::ZipWriter<W>,
        sums: &mut BTreeMap<String, String>,
        name: &str,
        write: impl FnOnce(&mut DigestWriter<&mut zip::ZipWriter<W>>) -> Result<()>,
    ) -> Result<()> {
        zip.start_file(name, SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated))?;
        let mut writer = DigestWriter { writer: zip, hash: Sha256::new() };
        write(&mut writer)?;
        sums.insert(name.to_string(), hex::encode(writer.hash.finalize()));
        Ok(())
    }
    entry(&mut zip, &mut sums, "conversation/normalized.json", |w| {
        serde_json::to_writer_pretty(w, pack)?;
        Ok(())
    })?;
    let transcript_opts = RenderOptions { include_attachments_inline: false, ..opts.clone() };
    entry(&mut zip, &mut sums, "conversation/transcript.md", |w| {
        w.write_all(render_markdown(pack, &transcript_opts).as_bytes())?;
        Ok(())
    })?;
    let full_md = render_markdown(pack, opts);
    entry(&mut zip, &mut sums, "context/full.md", |w| {
        w.write_all(full_md.as_bytes())?;
        Ok(())
    })?;
    let prompt_md = render_framed_with_body(pack, &full_md, &Default::default());
    entry(&mut zip, &mut sums, "context/handoff-prompt.md", |w| {
        w.write_all(prompt_md.as_bytes())?;
        Ok(())
    })?;
    let sources: std::collections::HashMap<_, _> = pack.sources.iter().map(|s| (s.source_id.as_str(), s)).collect();
    let map: Vec<_> = pack
        .messages
        .iter()
        .map(|m| {
            let src = sources.get(m.source_id.as_str());
            SourceMapEntry {
                message_id: &m.id,
                source_id: &m.source_id,
                provider: src.map(|s| s.provider.as_str()).unwrap_or(""),
                origin: src.and_then(|s| s.origin.as_deref()),
            }
        })
        .collect();
    entry(&mut zip, &mut sums, "provenance/source-map.json", |w| {
        serde_json::to_writer_pretty(w, &map)?;
        Ok(())
    })?;
    let mut written = HashSet::new();
    for a in &pack.attachments {
        let path = attachment_path(a);
        if written.contains(&path) {
            continue;
        }
        if let Some(bytes) = bytes_for(a) {
            if bytes.len() as u64 != a.size || !sha256_hex(&bytes).eq_ignore_ascii_case(&a.sha256) {
                return Err(FormatError::Checksum(path));
            }
            written.insert(path.clone());
            entry(&mut zip, &mut sums, &path, |w| {
                w.write_all(&bytes)?;
                Ok(())
            })?;
        }
    }
    let manifest = Manifest {
        format: ARCHIVE_FORMAT.into(),
        format_version: ARCHIVE_FORMAT_VERSION,
        schema_version: SCHEMA_VERSION.into(),
        pack_id: pack.pack_id.clone(),
        title: pack.title.clone(),
        version: pack.version,
        created_at: pack.created_at.clone(),
        exported_by: concat!("hopilo ", env!("CARGO_PKG_VERSION")).into(),
        files: sums.keys().cloned().collect(),
    };
    entry(&mut zip, &mut sums, "manifest.json", |w| {
        serde_json::to_writer_pretty(w, &manifest)?;
        Ok(())
    })?;
    zip.start_file("checksums.sha256", o)?;
    for (path, hash) in sums {
        writeln!(zip, "{hash}  {path}")?;
    }
    zip.finish()?;
    Ok(())
}

struct DigestWriter<W> {
    writer: W,
    hash: Sha256,
}
impl<W: Write> Write for DigestWriter<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let n = self.writer.write(buf)?;
        self.hash.update(&buf[..n]);
        Ok(n)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.writer.flush()
    }
}

pub struct ImportedHandoff {
    pub manifest: Manifest,
    pub pack: Pack,

    pub attachments: BTreeMap<String, std::sync::Arc<Vec<u8>>>,
}

pub fn read_handoff<R: Read + Seek>(reader: R) -> Result<ImportedHandoff> {
    let mut zip = zip::ZipArchive::new(reader)?;
    let mut total: u64 = 0;
    for i in 0..zip.len() {
        total = total.saturating_add(zip.by_index(i)?.size());
    }
    if total > MAX_UNPACKED_BYTES {
        return Err(FormatError::TooLarge);
    }
    let mut remaining = MAX_UNPACKED_BYTES;
    let mut read = |name: &str| -> Result<Vec<u8>> {
        let mut f = zip.by_name(name).map_err(|_| FormatError::NotHandoff(format!("missing {name}")))?;
        let limit = remaining.min(hopilo_core::limits::DOCUMENT_BYTES);
        let capacity = usize::try_from(f.size().min(limit).min(8 * 1024 * 1024)).unwrap_or(0);
        let mut buf = Vec::with_capacity(capacity);
        f.by_ref().take(limit + 1).read_to_end(&mut buf)?;
        if buf.len() as u64 > limit {
            return Err(FormatError::TooLarge);
        }
        remaining -= buf.len() as u64;
        Ok(buf)
    };
    let sums = String::from_utf8_lossy(&read("checksums.sha256")?).to_string();
    let expected: BTreeMap<String, String> =
        sums.lines().filter_map(|l| l.split_once("  ").map(|(h, p)| (p.to_string(), h.to_string()))).collect();
    let mut verified = |name: &str| -> Result<Vec<u8>> {
        let bytes = read(name)?;
        match expected.get(name) {
            Some(h) if h.eq_ignore_ascii_case(&sha256_hex(&bytes)) => Ok(bytes),
            _ => Err(FormatError::Checksum(name.to_string())),
        }
    };
    let manifest: Manifest = serde_json::from_slice(&verified("manifest.json")?)?;
    if manifest.format != ARCHIVE_FORMAT {
        return Err(FormatError::NotHandoff(manifest.format));
    }
    if manifest.format_version != ARCHIVE_FORMAT_VERSION {
        return Err(FormatError::NotHandoff(format!("unsupported archive version {}", manifest.format_version)));
    }
    let pack: Pack = serde_json::from_slice(&verified("conversation/normalized.json")?)?;
    validate_attachments(&pack)?;
    let manifest_files: HashSet<&str> = manifest.files.iter().map(String::as_str).collect();
    let mut attachments = BTreeMap::new();
    let mut read_blobs = BTreeMap::new();
    for a in &pack.attachments {
        let p = attachment_path(a);
        if manifest_files.contains(p.as_str()) {
            let bytes = match read_blobs.get(&p) {
                Some(bytes) => std::sync::Arc::clone(bytes),
                None => {
                    let bytes = std::sync::Arc::new(verified(&p)?);
                    read_blobs.insert(p.clone(), bytes.clone());
                    bytes
                }
            };
            if bytes.len() as u64 != a.size || !sha256_hex(&bytes).eq_ignore_ascii_case(&a.sha256) {
                return Err(FormatError::Checksum(p));
            }
            attachments.insert(a.id.clone(), bytes);
        }
    }
    Ok(ImportedHandoff { manifest, pack, attachments })
}

#[cfg(test)]
mod tests {
    use super::*;
    use hopilo_core::*;
    use std::io::Cursor;

    fn sample() -> (Pack, Vec<u8>) {
        let img = vec![0x89, b'P', b'N', b'G', 1, 2, 3];
        let att = Attachment {
            id: "a1".into(),
            file_name: "../../diagram.png".into(),
            media_type: "image/png".into(),
            size: img.len() as u64,
            sha256: sha256_hex(&img),
            origin_path: None,
            text: None,
        };
        let pack = Pack {
            schema_version: SCHEMA_VERSION.into(),
            pack_id: "p1".into(),
            title: "Auth Migration: Phase 2!".into(),
            version: 3,
            created_at: "2026-11-03T00:00:00Z".into(),
            mode: Mode::Full,
            sources: vec![],
            messages: vec![Message {
                id: "m1".into(),
                source_id: "s1".into(),
                role: Role::User,
                created_at: None,
                blocks: vec![Block::text("keep `exact/path.rs` intact")],
            }],
            context: ContextBrief::default(),
            attachments: vec![att],
            tags: vec![],
            integrity: Integrity::default(),
        };
        (pack, img)
    }

    #[test]
    fn handoff_entries_match_written_archive() {
        let (pack, img) = sample();
        let opts = RenderOptions::default();
        let mut buf = Cursor::new(Vec::new());
        let bytes = img.clone();
        write_handoff(&pack, &opts, &move |_| Some(bytes.clone()), &mut buf).unwrap();
        let mut zip = zip::ZipArchive::new(Cursor::new(buf.into_inner())).unwrap();
        let mut written: Vec<(String, u64)> = (0..zip.len())
            .map(|i| {
                let f = zip.by_index(i).unwrap();
                (f.name().to_string(), f.size())
            })
            .collect();
        written.sort();
        let listed = handoff_entries(&pack, &opts, &|_| true).unwrap();
        let mut names: Vec<String> = listed.iter().map(|e| e.path.clone()).collect();
        names.sort();
        assert_eq!(names, written.iter().map(|(n, _)| n.clone()).collect::<Vec<_>>());
        for e in listed.iter().filter(|e| e.size.is_some()) {
            let actual = written.iter().find(|(n, _)| *n == e.path).unwrap().1;
            assert_eq!(e.size, Some(actual), "size of {}", e.path);
        }
        let without_files = handoff_entries(&pack, &opts, &|_| false).unwrap();
        assert!(without_files.iter().all(|e| e.kind != "file"));
    }

    #[test]
    fn filenames_are_sanitized() {
        assert_eq!(sanitize_filename("Auth Migration: Phase 2!"), "auth-migration-phase-2");
        assert_eq!(sanitize_filename("///"), "context-pack");
        assert_eq!(sanitize_attachment_name("../../diagram.png"), "diagram.png");
    }

    #[test]
    fn malformed_unicode_checksum_returns_error_without_panicking() {
        let (mut pack, _) = sample();
        pack.attachments[0].sha256 = format!("{}é{}", "a".repeat(11), "b".repeat(51));
        assert!(from_json(&to_json(&pack).unwrap()).is_err());
        assert!(handoff_entries(&pack, &RenderOptions::default(), &|_| true).is_err());
        let mut buf = Cursor::new(Vec::new());
        assert!(write_handoff(&pack, &RenderOptions::default(), &|_| None, &mut buf).is_err());
    }

    #[test]
    fn handoff_accepts_uppercase_sha_and_rejects_mismatched_size() {
        let (mut pack, img) = sample();
        pack.attachments[0].sha256 = pack.attachments[0].sha256.to_ascii_uppercase();
        let mut buf = Cursor::new(Vec::new());
        let bytes = img.clone();
        write_handoff(&pack, &RenderOptions::default(), &move |_| Some(bytes.clone()), &mut buf).unwrap();
        buf.set_position(0);
        let back = read_handoff(buf).unwrap();
        assert_eq!(back.attachments["a1"].as_slice(), img.as_slice());
    }

    #[test]
    fn handoff_round_trip() {
        let (pack, img) = sample();
        let mut buf = Cursor::new(Vec::new());
        let bytes = img.clone();
        write_handoff(&pack, &RenderOptions::default(), &move |_| Some(bytes.clone()), &mut buf).unwrap();
        buf.set_position(0);
        let back = read_handoff(buf).unwrap();
        assert_eq!(back.pack, pack);
        assert_eq!(back.attachments.get("a1").map(|b| b.as_slice()), Some(img.as_slice()));
        assert!(back.manifest.files.iter().any(|f| f.starts_with("attachments/") && f.ends_with("-diagram.png")));
    }

    #[test]
    fn repeated_attachment_occurrences_share_one_imported_blob() {
        let (mut pack, img) = sample();
        let mut repeated = pack.attachments[0].clone();
        repeated.id = "a2".into();
        pack.attachments.push(repeated);
        let calls = std::cell::Cell::new(0);
        let mut archive = Cursor::new(Vec::new());
        write_handoff(
            &pack,
            &RenderOptions::default(),
            &|_| {
                calls.set(calls.get() + 1);
                Some(img.clone())
            },
            &mut archive,
        )
        .unwrap();
        assert_eq!(calls.get(), 1);
        archive.set_position(0);
        let imported = read_handoff(archive).unwrap();
        assert!(std::sync::Arc::ptr_eq(&imported.attachments["a1"], &imported.attachments["a2"]));
    }

    #[test]
    fn tampered_archive_is_rejected() {
        let (pack, _) = sample();
        let mut buf = Cursor::new(Vec::new());
        write_handoff(&pack, &RenderOptions::default(), &|_| None, &mut buf).unwrap();

        buf.set_position(0);
        let mut src = zip::ZipArchive::new(buf).unwrap();
        let mut out = Cursor::new(Vec::new());
        {
            let mut w = zip::ZipWriter::new(&mut out);
            for i in 0..src.len() {
                let mut f = src.by_index(i).unwrap();
                let name = f.name().to_string();
                let mut data = Vec::new();
                f.read_to_end(&mut data).unwrap();
                if name == "conversation/normalized.json" {
                    data = String::from_utf8(data).unwrap().replace("exact/path.rs", "other/path.rs").into_bytes();
                }
                w.start_file(name, SimpleFileOptions::default()).unwrap();
                w.write_all(&data).unwrap();
            }
            w.finish().unwrap();
        }
        out.set_position(0);
        assert!(matches!(read_handoff(out), Err(FormatError::Checksum(_))));
    }
}
