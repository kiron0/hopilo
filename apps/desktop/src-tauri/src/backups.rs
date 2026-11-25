use crate::commands::{blocking, err, lock, notify, save_setting_blocking, try_lock, with_store, AppState, CmdResult};
use hopilo_database::backup::{self, BackupReport};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
use zeroize::Zeroizing;

struct Schedule {
    directory: PathBuf,
    password: Zeroizing<String>,
    hours: u64,
    next: Instant,
}
#[derive(Default)]
struct ScheduleState {
    active: Option<Schedule>,
    generation: u64,
}
#[derive(Default)]
pub struct BackupRuntime {
    schedule: Mutex<ScheduleState>,
    operation: Mutex<()>,
    last: Mutex<Option<String>>,
}

pub(crate) fn lock_operation(runtime: &BackupRuntime) -> std::sync::MutexGuard<'_, ()> {
    lock(&runtime.operation)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    unlocked: bool,
    directory: Option<String>,
    hours: Option<u64>,
    last_result: Option<String>,
}

fn validate_directory(path: &Path) -> CmdResult<()> {
    if !path.is_absolute() || !path.is_dir() {
        return Err("Choose an existing absolute backup folder".into());
    }
    Ok(())
}
fn destination(directory: &Path, prefix: &str) -> PathBuf {
    directory.join(format!("{prefix}-{}.hbackup", hopilo_core::new_id()))
}
const KEEP_SCHEDULED: usize = 10;
const KEEP_RECOVERY: usize = 5;
const RETRY_AFTER_FAILURE: Duration = Duration::from_secs(5 * 60);

fn prune_backups(directory: &Path, prefix: &str, keep: usize) {
    let Ok(entries) = std::fs::read_dir(directory) else { return };
    let mut backups: Vec<(std::time::SystemTime, PathBuf)> = entries
        .flatten()
        .filter(|e| {
            let name = e.file_name();
            let name = name.to_string_lossy();
            name.starts_with(prefix) && name.ends_with(".hbackup")
        })
        .filter_map(|e| {
            let meta = std::fs::symlink_metadata(e.path()).ok()?;
            meta.is_file().then(|| (meta.modified().unwrap_or(std::time::UNIX_EPOCH), e.path()))
        })
        .collect();
    backups.sort_by_key(|b| std::cmp::Reverse(b.0));
    for (_, path) in backups.into_iter().skip(keep) {
        let _ = std::fs::remove_file(path);
    }
}

fn prune_scheduled(directory: &Path, keep: usize) {
    prune_backups(directory, "hopilo-", keep);
}

fn take_due(schedule: &mut Option<Schedule>, now: Instant) -> Option<(PathBuf, Zeroizing<String>)> {
    let s = schedule.as_mut()?;
    if now < s.next {
        return None;
    }
    s.next = now + Duration::from_secs(s.hours * 3600);
    Some((s.directory.clone(), s.password.clone()))
}

#[tauri::command]
pub async fn backup_status(app: AppHandle) -> CmdResult<BackupStatus> {
    let runtime = app.state::<BackupRuntime>();
    let schedule = lock(&runtime.schedule);
    let saved = app.state::<AppState>().setting("backup.schedule");
    let saved_dir = saved.as_ref().and_then(|v| v.get("directory")).and_then(|v| v.as_str()).map(str::to_string);
    let saved_hours = saved.as_ref().and_then(|v| v.get("hours")).and_then(|v| v.as_u64());
    let last_result = lock(&runtime.last).clone();
    Ok(BackupStatus {
        unlocked: schedule.active.is_some(),
        directory: schedule.active.as_ref().map(|s| s.directory.display().to_string()).or(saved_dir),
        hours: schedule.active.as_ref().map(|s| s.hours).or(saved_hours),
        last_result,
    })
}
#[tauri::command]
pub async fn create_backup(app: AppHandle, path: String, password: String) -> CmdResult<BackupReport> {
    let password = Zeroizing::new(password);
    blocking(app, move |app, state| {
        let runtime = app.state::<BackupRuntime>();
        let _guard = lock(&runtime.operation);
        let prepared = with_store(&state, |s| s.prepare_backup(Path::new(&path), &password).map_err(err))?;
        let result = prepared.write(&password).map_err(err)?;
        *lock(&runtime.last) = Some(format!("Verified backup saved: {path}"));
        Ok(result)
    })
    .await
}
#[tauri::command]
pub async fn verify_backup(app: AppHandle, path: String, password: String) -> CmdResult<BackupReport> {
    let password = Zeroizing::new(password);
    blocking(app, move |_, _| Ok(backup::verify(Path::new(&path), &password).map_err(err)?.report)).await
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    report: BackupReport,
    recovery_path: String,
}
#[tauri::command]
pub async fn restore_backup(app: AppHandle, path: String, password: String) -> CmdResult<RestoreResult> {
    let password = Zeroizing::new(password);
    blocking(app, move |app, state| {
        let runtime = app.state::<BackupRuntime>();
        let _guard = lock(&runtime.operation);
        let _sync = lock(&state.sync_lock);
        let verified = backup::verify(Path::new(&path), &password).map_err(err)?;
        let recovery_dir = state.library_root.join("recovery");
        std::fs::create_dir_all(&recovery_dir).map_err(err)?;
        let recovery = destination(&recovery_dir, "before-restore");
        let prepared = with_store(&state, |s| s.prepare_backup(&recovery, &password).map_err(err))?;
        prepared.write(&password).map_err(err)?;
        prune_backups(&recovery_dir, "before-restore-", KEEP_RECOVERY);
        let recovery_path = recovery.display().to_string();
        let (report, settings) = with_store(&state, |s| {
            let report = s.restore_backup(verified).map_err(err)?;
            Ok((report, s.settings().map_err(err)?))
        })?;
        state.replace_settings_mirror(settings);
        let shortcut = state.setting(crate::SHORTCUT_KEY).and_then(|v| v.as_str().map(str::to_string));
        if let Err(error) = crate::apply_shortcut(app, shortcut.as_deref()) {
            eprintln!("Restored shortcut could not be registered: {error}");
            save_setting_blocking(app, crate::SHORTCUT_KEY, serde_json::Value::Null)?;
        }
        lock(&state.discovery).clear();
        {
            let mut sched = lock(&runtime.schedule);
            sched.active = None;
            sched.generation = sched.generation.wrapping_add(1);
        }
        let _ = app.emit("hopilo://settings-changed", ("restored", serde_json::Value::Null));
        notify(app);
        Ok(RestoreResult { report, recovery_path })
    })
    .await
}
#[tauri::command]
pub async fn unlock_backup_schedule(app: AppHandle, directory: String, hours: u64, password: String) -> CmdResult<()> {
    let password = Zeroizing::new(password);
    blocking(app, move |app, state| {
        if !(1..=168).contains(&hours) {
            return Err("Backup interval must be 1–168 hours".into());
        }
        if password.chars().count() < 12 {
            return Err("Use a backup password of at least 12 characters".into());
        }
        let directory = std::fs::canonicalize(directory).map_err(err)?;
        validate_directory(&directory)?;
        tempfile::NamedTempFile::new_in(&directory).map_err(err)?;
        if directory.starts_with(std::fs::canonicalize(&state.library_root).map_err(err)?) {
            return Err("Choose a folder outside Hopilo library storage".into());
        }
        save_setting_blocking(
            app,
            "backup.schedule",
            serde_json::json!({"directory":directory.display().to_string(),"hours":hours}),
        )?;
        let runtime = app.state::<BackupRuntime>();
        let mut sched = lock(&runtime.schedule);
        sched.generation = sched.generation.wrapping_add(1);
        sched.active = Some(Schedule { directory, password, hours, next: Instant::now() });
        Ok(())
    })
    .await
}
#[tauri::command]
pub fn lock_backup_schedule(app: AppHandle) -> CmdResult<()> {
    let runtime = app.state::<BackupRuntime>();
    let mut sched = lock(&runtime.schedule);
    sched.active = None;
    sched.generation = sched.generation.wrapping_add(1);
    Ok(())
}

pub fn start(app: &AppHandle) {
    app.manage(BackupRuntime::default());
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(30));
        let runtime = app.state::<BackupRuntime>();
        let Some(_operation) = try_lock(&runtime.operation) else { continue };
        let (dir, pw, generation) = {
            let mut sched = lock(&runtime.schedule);
            let Some((dir, pw)) = take_due(&mut sched.active, Instant::now()) else { continue };
            (dir, pw, sched.generation)
        };
        let path = destination(&dir, "hopilo");
        let state = app.state::<AppState>();
        let result = with_store(&state, |s| s.prepare_backup(&path, &pw).map_err(err))
            .and_then(|prepared| prepared.write(&pw).map_err(err));
        let mut sched = lock(&runtime.schedule);
        if sched.generation != generation {
            if result.is_ok() {
                prune_scheduled(&dir, KEEP_SCHEDULED);
            }
            continue;
        }
        if result.is_ok() {
            prune_scheduled(&dir, KEEP_SCHEDULED);
        } else if let Some(s) = sched.active.as_mut() {
            s.next = Instant::now() + RETRY_AFTER_FAILURE.min(Duration::from_secs(s.hours * 3600));
        }
        drop(sched);
        *lock(&runtime.last) = Some(match result {
            Ok(_) => format!("Verified backup saved: {}", path.display()),
            Err(e) => format!("Scheduled backup failed: {e}"),
        });
        let _ = app.emit("hopilo://backup-changed", ());
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pruning_keeps_newest_scheduled_backups_and_ignores_other_files() {
        let dir = tempfile::tempdir().unwrap();
        let base = std::time::SystemTime::now() - Duration::from_secs(3600);
        for i in 0..12u64 {
            let path = dir.path().join(format!("hopilo-{i:02}.hbackup"));
            let file = std::fs::File::create(&path).unwrap();
            file.set_modified(base + Duration::from_secs(i * 60)).unwrap();
        }
        std::fs::write(dir.path().join("manual.hbackup"), b"keep").unwrap();
        std::fs::write(dir.path().join("hopilo-notes.txt"), b"keep").unwrap();
        prune_scheduled(dir.path(), 10);
        let mut names: Vec<_> =
            std::fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
        names.sort();
        assert_eq!(names.len(), 12);
        assert!(!names.contains(&"hopilo-00.hbackup".to_string()));
        assert!(!names.contains(&"hopilo-01.hbackup".to_string()));
        assert!(names.contains(&"hopilo-11.hbackup".to_string()));
        assert!(names.contains(&"manual.hbackup".to_string()));
        assert!(names.contains(&"hopilo-notes.txt".to_string()));
    }

    #[test]
    fn unlocked_schedule_runs_immediately_then_at_interval_and_stops_when_locked() {
        let now = Instant::now();
        let mut schedule = Some(Schedule {
            directory: PathBuf::from("/backups"),
            password: Zeroizing::new("long test password".into()),
            hours: 24,
            next: now,
        });
        assert!(take_due(&mut schedule, now).is_some());
        assert!(take_due(&mut schedule, now + Duration::from_secs(3600)).is_none());
        assert!(take_due(&mut schedule, now + Duration::from_secs(24 * 3600)).is_some());
        schedule = None;
        assert!(take_due(&mut schedule, now + Duration::from_secs(48 * 3600)).is_none());
    }
}
