use crate::{DbError, Result, Store};
use ring::{
    aead, pbkdf2,
    rand::{SecureRandom, SystemRandom},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::File,
    io::{Read, Seek, Write},
    num::NonZeroU32,
    path::Path,
};
use zeroize::Zeroizing;

const MAGIC: &[u8; 8] = b"HOPBAK01";
const CHUNK: usize = 1024 * 1024;
const ITERATIONS: u32 = 600_000;
const MAX_BYTES: u64 = 20 * 1024 * 1024 * 1024;
const MAX_ENTRIES: usize = 200_000;

fn invalid(message: &str) -> DbError {
    DbError::Io(std::io::Error::other(message))
}
fn wrap(error: impl std::fmt::Display) -> DbError {
    invalid(&error.to_string())
}
fn sha_file(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hash = Sha256::new();
    let mut buf = [0; 65536];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
    }
    Ok(hex::encode(hash.finalize()))
}
fn key(password: &str, salt: &[u8]) -> Result<aead::LessSafeKey> {
    let mut bytes = Zeroizing::new([0u8; 32]);
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        NonZeroU32::new(ITERATIONS).unwrap(),
        salt,
        password.as_bytes(),
        bytes.as_mut(),
    );
    Ok(aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_256_GCM, bytes.as_ref())
            .map_err(|_| invalid("Could not initialize backup encryption"))?,
    ))
}
fn nonce(index: u64) -> aead::Nonce {
    let mut n = [0u8; 12];
    n[4..].copy_from_slice(&index.to_be_bytes());
    aead::Nonce::assume_unique_for_key(n)
}
fn aad(header: &[u8], index: u64, size: u32) -> Vec<u8> {
    [header, &index.to_be_bytes(), &size.to_be_bytes()].concat()
}

fn encrypt(mut input: impl Read, mut output: impl Write, password: &str) -> Result<()> {
    let mut header = [0u8; 40];
    header[..8].copy_from_slice(MAGIC);
    SystemRandom::new().fill(&mut header[8..]).map_err(|_| invalid("Could not generate backup salt"))?;
    let key = key(password, &header[8..])?;
    output.write_all(&header)?;
    let mut index = 0;
    loop {
        let mut buf = Zeroizing::new(vec![0; CHUNK]);
        let mut n = 0;
        while n < CHUNK {
            let read = input.read(&mut buf[n..])?;
            if read == 0 {
                break;
            }
            n += read;
        }
        buf.truncate(n);
        let size = n as u32;
        key.seal_in_place_append_tag(nonce(index), aead::Aad::from(aad(&header, index, size)), &mut *buf)
            .map_err(|_| invalid("Backup encryption failed"))?;
        output.write_all(&size.to_be_bytes())?;
        output.write_all(&buf)?;
        if n == 0 {
            break;
        }
        index += 1;
    }
    Ok(())
}
fn decrypt(mut input: impl Read, mut output: impl Write, password: &str) -> Result<()> {
    let mut header = [0u8; 40];
    input.read_exact(&mut header)?;
    if &header[..8] != MAGIC {
        return Err(invalid("Not a supported encrypted Hopilo backup"));
    }
    let key = key(password, &header[8..])?;
    let mut total = 0u64;
    let mut index = 0;
    loop {
        let mut size = [0u8; 4];
        input.read_exact(&mut size)?;
        let size = u32::from_be_bytes(size);
        if size as usize > CHUNK {
            return Err(invalid("Invalid backup record"));
        }
        total = total.saturating_add(size as u64);
        if total > MAX_BYTES {
            return Err(invalid("Backup exceeds 20 GiB limit"));
        }
        let mut buf = Zeroizing::new(vec![0; size as usize + 16]);
        input.read_exact(&mut buf)?;
        let plain = key
            .open_in_place(nonce(index), aead::Aad::from(aad(&header, index, size)), &mut buf)
            .map_err(|_| invalid("Wrong password or damaged backup"))?;
        output.write_all(plain)?;
        if size == 0 {
            let mut extra = [0];
            if input.read(&mut extra)? != 0 {
                return Err(invalid("Unexpected data after backup"));
            }
            break;
        }
        index += 1;
    }
    Ok(())
}

#[derive(Serialize, Deserialize)]
struct Entry {
    sha256: String,
    size: u64,
}
#[derive(Serialize, Deserialize)]
struct Manifest {
    version: u32,
    created_at: String,
    files: BTreeMap<String, Entry>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupReport {
    pub created_at: String,
    pub files: usize,
    pub sessions: usize,
    pub verified: bool,
}

pub struct VerifiedBackup {
    dir: tempfile::TempDir,
    pub report: BackupReport,
}

fn allowed(name: &str) -> bool {
    name == "hopilo.db"
        || name
            .strip_prefix("attachments/")
            .is_some_and(|sha| sha.len() == 64 && sha.bytes().all(|b| b.is_ascii_hexdigit()))
}

pub fn verify(path: &Path, password: &str) -> Result<VerifiedBackup> {
    let dir = tempfile::tempdir()?;
    let mut archive = tempfile::tempfile()?;
    decrypt(File::open(path)?, &mut archive, password)?;
    archive.rewind()?;
    let mut zip = zip::ZipArchive::new(archive).map_err(wrap)?;
    if zip.len() > MAX_ENTRIES {
        return Err(invalid("Too many backup entries"));
    }
    let manifest: Manifest = {
        let entry = zip.by_name("manifest.json").map_err(wrap)?;
        let bytes = hopilo_core::limits::read_bounded(entry, 16 * 1024 * 1024)?;
        serde_json::from_slice(&bytes)?
    };
    if manifest.version != 1 || !manifest.files.contains_key("hopilo.db") || zip.len() != manifest.files.len() + 1 {
        return Err(invalid("Invalid backup manifest"));
    }
    let mut seen = std::collections::HashSet::new();
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(wrap)?;
        let name = entry.name().to_string();
        if !seen.insert(name.clone()) {
            return Err(invalid("Duplicate backup path"));
        }
        if name == "manifest.json" {
            continue;
        }
        if !allowed(&name) || entry.is_dir() {
            return Err(invalid("Unsafe backup path"));
        }
        let expected = manifest.files.get(&name).ok_or_else(|| invalid("Unlisted backup entry"))?;
        total = total.saturating_add(expected.size);
        if total > MAX_BYTES || entry.size() != expected.size {
            return Err(invalid("Backup size mismatch"));
        }
        let dest = dir.path().join(&name);
        std::fs::create_dir_all(dest.parent().unwrap())?;
        let mut out = File::create(&dest)?;
        let copied = std::io::copy(&mut entry.by_ref().take(expected.size + 1), &mut out)?;
        if copied != expected.size || sha_file(&dest)? != expected.sha256 {
            return Err(invalid("Backup checksum mismatch"));
        }
        if let Some(sha) = name.strip_prefix("attachments/") {
            if sha != expected.sha256 {
                return Err(invalid("Attachment checksum mismatch"));
            }
        }
    }
    let mut conn = rusqlite::Connection::open_with_flags(
        dir.path().join("hopilo.db"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE,
    )?;
    let integrity: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    let version: usize = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if integrity != "ok" || version == 0 || version > crate::migrations::latest() {
        return Err(invalid("Backup database is damaged or uses a different schema version"));
    }
    crate::tune(&conn)?;
    crate::migrations::run(&mut conn)?;
    if conn.prepare("PRAGMA foreign_key_check")?.exists([])? {
        return Err(invalid("Backup database relationships are invalid"));
    }
    let sessions = conn.query_row("SELECT COUNT(*) FROM sources", [], |r| r.get(0))?;
    let mut stmt = conn.prepare("SELECT sha256 FROM attachments")?;
    for sha in stmt.query_map([], |r| r.get::<_, String>(0))? {
        if !manifest.files.contains_key(&format!("attachments/{}", sha?)) {
            return Err(invalid("A library attachment is missing from the backup"));
        }
    }
    drop(stmt);
    drop(conn);
    Ok(VerifiedBackup {
        report: BackupReport {
            created_at: manifest.created_at,
            files: manifest.files.len() - 1,
            sessions,
            verified: true,
        },
        dir,
    })
}

pub struct PreparedBackup {
    _stage: tempfile::TempDir,
    path: std::path::PathBuf,
    paths: Vec<(String, std::path::PathBuf)>,
}

impl PreparedBackup {
    pub fn write(self, password: &str) -> Result<BackupReport> {
        let mut manifest = Manifest { version: 1, created_at: hopilo_core::now_rfc3339(), files: BTreeMap::new() };
        let mut archive = tempfile::tempfile()?;
        let mut total = 0u64;
        {
            let mut zip = zip::ZipWriter::new(&mut archive);
            for (name, file) in self.paths {
                let size = std::fs::metadata(&file)?.len();
                total = total.saturating_add(size);
                if total > MAX_BYTES || manifest.files.len() >= MAX_ENTRIES - 1 {
                    return Err(invalid("Backup exceeds size or file count limit"));
                }
                let sha = sha_file(&file)?;
                if name.starts_with("attachments/") && name != format!("attachments/{sha}") {
                    return Err(invalid("Stored attachment failed verification"));
                }
                zip.start_file(
                    &name,
                    zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated),
                )
                .map_err(wrap)?;
                std::io::copy(&mut File::open(file)?, &mut zip)?;
                manifest.files.insert(name, Entry { sha256: sha, size });
            }
            zip.start_file("manifest.json", zip::write::SimpleFileOptions::default()).map_err(wrap)?;
            serde_json::to_writer(&mut zip, &manifest)?;
            zip.finish().map_err(wrap)?;
        }
        archive.rewind()?;
        let parent = self.path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
        let mut output = tempfile::NamedTempFile::new_in(parent)?;
        encrypt(&mut archive, &mut output, password)?;
        output.as_file().sync_all()?;
        let verified = verify(output.path(), password)?;
        output.persist(&self.path).map_err(wrap)?;
        Ok(verified.report)
    }
}

impl Store {
    pub fn create_backup(&self, path: &Path, password: &str) -> Result<BackupReport> {
        self.prepare_backup(path, password)?.write(password)
    }

    pub fn prepare_backup(&self, path: &Path, password: &str) -> Result<PreparedBackup> {
        if password.chars().count() < 12 {
            return Err(invalid("Use a backup password of at least 12 characters"));
        }
        if path.extension().is_none_or(|ext| ext != "hbackup") {
            return Err(invalid("Backup filename must end in .hbackup"));
        }
        let parent = path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
        if std::fs::canonicalize(parent)?.starts_with(std::fs::canonicalize(self.root.join("attachments"))?) {
            return Err(invalid("Choose a backup destination outside attachment storage"));
        }
        let stage = tempfile::tempdir()?;
        let snapshot = stage.path().join("hopilo.db");
        self.conn.execute("VACUUM INTO ?1", [snapshot.display().to_string()])?;
        let mut paths = vec![("hopilo.db".to_string(), snapshot)];
        for entry in std::fs::read_dir(self.root.join("attachments"))? {
            let entry = entry?;
            let name = format!("attachments/{}", entry.file_name().to_string_lossy());
            if !entry.file_type()?.is_file() || !allowed(&name) {
                continue;
            }
            paths.push((name, entry.path()));
        }
        Ok(PreparedBackup { _stage: stage, path: path.to_path_buf(), paths })
    }
    pub fn restore_backup(&mut self, verified: VerifiedBackup) -> Result<BackupReport> {
        let blobs = verified.dir.path().join("attachments");
        if blobs.is_dir() {
            for entry in std::fs::read_dir(blobs)? {
                let entry = entry?;
                let mut temp = tempfile::NamedTempFile::new_in(self.root.join("attachments"))?;
                std::io::copy(&mut File::open(entry.path())?, &mut temp)?;
                temp.as_file().sync_all()?;
                temp.persist(self.root.join("attachments").join(entry.file_name())).map_err(wrap)?;
            }
        }
        self.conn.flush_prepared_statement_cache();
        self.conn.restore("main", verified.dir.path().join("hopilo.db"), None::<fn(rusqlite::backup::Progress)>)?;
        self.cache = Default::default();
        Ok(verified.report)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encrypted_fixture(path: &Path, manifest: &Manifest, entries: &[(&str, &[u8])]) {
        let mut archive = std::io::Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut archive);
            for (name, bytes) in entries {
                zip.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
                zip.write_all(bytes).unwrap();
            }
            zip.start_file("manifest.json", zip::write::SimpleFileOptions::default()).unwrap();
            serde_json::to_writer(&mut zip, manifest).unwrap();
            zip.finish().unwrap();
        }
        archive.rewind().unwrap();
        encrypt(archive, File::create(path).unwrap(), "long test password").unwrap();
    }

    #[test]
    fn authenticated_archives_still_require_safe_paths_checksums_and_valid_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.hbackup");
        let payload = b"not a SQLite database";
        let mut manifest = Manifest {
            version: 1,
            created_at: String::new(),
            files: BTreeMap::from([(
                "hopilo.db".into(),
                Entry { sha256: hex::encode(Sha256::digest(payload)), size: payload.len() as u64 },
            )]),
        };
        encrypted_fixture(&path, &manifest, &[("hopilo.db", payload)]);
        assert!(verify(&path, "long test password").is_err());
        manifest.files.get_mut("hopilo.db").unwrap().sha256 = "incorrect".into();
        encrypted_fixture(&path, &manifest, &[("hopilo.db", payload)]);
        assert!(verify(&path, "long test password").err().unwrap().to_string().contains("checksum"));
        manifest.files.insert("../escape".into(), Entry { sha256: String::new(), size: 0 });
        encrypted_fixture(&path, &manifest, &[("../escape", b""), ("hopilo.db", payload)]);
        assert!(verify(&path, "long test password").err().unwrap().to_string().contains("Unsafe backup path"));
        assert!(!dir.path().join("escape").exists());
    }

    #[test]
    fn supported_older_schema_migrates_only_the_verified_extracted_copy() {
        let dir = tempfile::tempdir().unwrap();
        let library = dir.path().join("old");
        let store = Store::open(&library).unwrap();
        store.conn.execute_batch("DROP TABLE manual_file_messages; PRAGMA user_version=6;").unwrap();
        let path = dir.path().join("old.hbackup");
        store.create_backup(&path, "long test password").unwrap();
        let original_version: usize = store.conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(original_version, 6);
        let verified = verify(&path, "long test password").unwrap();
        let mut restored = Store::open(&dir.path().join("restored")).unwrap();
        restored.restore_backup(verified).unwrap();
        assert!(restored.manual_file_messages("missing").unwrap().is_empty());
        assert_eq!(
            restored.conn.query_row("PRAGMA user_version", [], |r| r.get::<_, usize>(0)).unwrap(),
            crate::migrations::latest()
        );
    }
    #[test]
    fn stray_non_blob_files_in_attachment_storage_do_not_block_backups() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("library")).unwrap();
        std::fs::write(dir.path().join("library/attachments/.DS_Store"), b"finder").unwrap();
        let path = dir.path().join("library.hbackup");
        let report = store.prepare_backup(&path, "long test password").unwrap().write("long test password").unwrap();
        assert!(report.verified);
        assert_eq!(report.files, 0);
    }

    #[test]
    fn authenticated_records_reject_wrong_password_tampering_and_truncation() {
        let mut encrypted = Vec::new();
        encrypt(&b"private library"[..], &mut encrypted, "test password long").unwrap();
        let mut clear = Vec::new();
        decrypt(&encrypted[..], &mut clear, "test password long").unwrap();
        assert_eq!(clear, b"private library");
        assert!(decrypt(&encrypted[..], Vec::new(), "wrong password").is_err());
        let last = encrypted.len() - 1;
        encrypted[last] ^= 1;
        assert!(decrypt(&encrypted[..], Vec::new(), "test password long").is_err());
        encrypted[last] ^= 1;
        assert!(decrypt(&encrypted[..last], Vec::new(), "test password long").is_err());
    }

    #[test]
    fn multi_record_backups_reject_reordering_missing_final_record_and_trailing_bytes() {
        let data: Vec<u8> = (0..CHUNK + 73).map(|i| (i % 251) as u8).collect();
        let mut encrypted = Vec::new();
        encrypt(&data[..], &mut encrypted, "long test password").unwrap();
        let mut clear = Vec::new();
        decrypt(&encrypted[..], &mut clear, "long test password").unwrap();
        assert_eq!(clear, data);
        let first_end = 40 + 4 + CHUNK + 16;
        let second_end = first_end + 4 + 73 + 16;
        let swapped =
            [&encrypted[..40], &encrypted[first_end..second_end], &encrypted[40..first_end], &encrypted[second_end..]]
                .concat();
        assert!(decrypt(&swapped[..], Vec::new(), "long test password").is_err());
        assert!(decrypt(&encrypted[..second_end], Vec::new(), "long test password").is_err());
        encrypted.push(0);
        assert!(decrypt(&encrypted[..], Vec::new(), "long test password").is_err());
    }
}
