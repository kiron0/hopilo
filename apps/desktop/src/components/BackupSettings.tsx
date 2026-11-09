import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api, errorText, type BackupReport } from "../lib/api";
import { useLoad } from "../lib/hooks";
import { invalidateQuery } from "../lib/hooks";
import { useApp } from "../lib/store";
import { AlertDialog, Button, Card, Field, PasswordInput, Skeleton, TextInput } from "./ui";
import { relativeTime } from "../lib/format";

export function BackupSettings() {
  const status = useLoad(() => api.backupStatus(), ["backup-status"]);
  const [password, setPassword] = useState(""); const [repeat, setRepeat] = useState("");
  const [directory, setDirectory] = useState(""); const [hours, setHours] = useState(24);
  const [path, setPath] = useState(""); const [report, setReport] = useState<BackupReport | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [confirmRestore, setConfirmRestore] = useState(false);
  useEffect(() => { if (status.data?.directory) setDirectory(status.data.directory); if (status.data?.hours) setHours(status.data.hours); }, [status.data?.directory, status.data?.hours]);
  const run = async (work: () => Promise<void>) => {
    if (busy) return; setBusy(true); setError(""); setMessage("");
    try { await work(); status.reload(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const ready = password.length >= 12 && password === repeat;
  return <Card className="space-y-4 p-5" aria-label="Encrypted library backups">
    <div><h2 className="font-semibold">Encrypted library backups</h2><p className="mt-1 text-[12px] text-muted">Includes sessions, attachments, history and settings. Files stay local. AES-256-GCM encryption and checksums are verified before save and restore.</p></div>
    {error && <p role="alert" className="text-danger">{error}</p>}
    {status.error && <p role="alert" className="text-danger">{status.error}</p>}
    {message && <p role="status" className="text-success break-all">{message}</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Backup password"><PasswordInput label="Backup password" placeholder="Enter backup password" autoComplete="new-password" value={password} onChange={(e) => { setPassword(e.target.value); setReport(null); }} disabled={busy} /><p className="mt-1 text-[12px] text-faint">At least 12 characters for new backups. Keep it somewhere safe; Hopilo cannot recover it.</p></Field>
      <Field label="Repeat password"><PasswordInput label="Repeat password" placeholder="Repeat backup password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} disabled={busy} /><p className="mt-1 text-[12px] text-faint">Required when creating or scheduling a new backup.</p></Field>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button variant="primary" disabled={!ready || busy} busy={busy} onClick={() => void run(async () => {
        const destination = await save({ defaultPath: "hopilo-library.hbackup", filters: [{ name: "Encrypted Hopilo backup", extensions: ["hbackup"] }] });
        if (!destination) return;
        const backup = await api.createBackup(destination, password); setMessage(`Verified backup saved · ${backup.sessions} sessions · ${backup.files} files`);
        setPassword(""); setRepeat("");
      })}>Create encrypted backup</Button>
      <Button variant="secondary" disabled={busy} onClick={() => void run(async () => {
        const chosen = await open({ multiple: false, filters: [{ name: "Encrypted Hopilo backup", extensions: ["hbackup"] }] });
        if (typeof chosen === "string") { setPath(chosen); setReport(null); }
      })}>Choose backup to verify / restore</Button>
    </div>
    {path && <div className="space-y-2 rounded-xl border border-line p-3">
      <p className="break-all text-[12px] text-muted">{path}</p>
      <div className="flex flex-wrap gap-2"><Button disabled={!password || busy} onClick={() => void run(async () => { setReport(await api.verifyBackup(path, password)); })}>Verify backup</Button>
        <Button variant="danger" disabled={!report || busy} onClick={() => setConfirmRestore(true)}>Restore verified backup…</Button></div>
      {report && <p role="status" className="text-[12px] text-success">Verified · {report.sessions} sessions · {report.files} files · created {relativeTime(report.createdAt)}</p>}
    </div>}
    <div className="space-y-3 border-t border-line pt-4">
      <h3 className="text-[13px] font-semibold">Scheduled local backups</h3>
      <p className="text-[12px] text-muted">Runs while Hopilo is open. Unlock once per app run; password stays in memory and is never saved in settings. Unlock creates the first backup within 30 seconds, then repeats at your interval.</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1"><Field label="Backup folder"><TextInput readOnly placeholder={status.loading && !status.data ? "Loading backup folder…" : "Choose a backup folder"} value={directory} /></Field></div>
        <Button disabled={busy} onClick={() => void run(async () => { const folder = await open({ directory: true, multiple: false }); if (typeof folder === "string") setDirectory(folder); })}>Choose folder</Button>
        <Field label="Every (hours)"><TextInput className="w-24" type="number" placeholder="24" min={1} max={168} value={hours} onChange={(e) => setHours(Number(e.target.value))} disabled={busy} /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!ready || !directory || !Number.isInteger(hours) || hours < 1 || hours > 168 || busy} onClick={() => void run(async () => {
          await api.unlockBackupSchedule(directory, hours, password); setPassword(""); setRepeat(""); setMessage("Backup schedule unlocked for this app run.");
        })}>Unlock schedule</Button>
        <Button variant="ghost" disabled={!status.data?.unlocked || busy} onClick={() => void run(async () => { await api.lockBackupSchedule(); setMessage("Schedule locked. Password removed from schedule memory."); })}>Lock schedule</Button>
        <span className="text-[12px] text-muted">{!status.data && status.loading ? <Skeleton className="inline-block h-3 w-14" /> : status.data ? (status.data.unlocked ? "Unlocked" : "Locked") : "Unavailable"}</span>
        <Button size="sm" variant="ghost" disabled={busy} onClick={status.reload}>Refresh status</Button>
      </div>
      {status.data?.lastResult && <p role="status" className="break-all text-[12px] text-muted">{status.data.lastResult}</p>}
    </div>
    {confirmRestore && <AlertDialog title="Replace this library from backup?" description={<>This replaces current sessions, history and settings. Hopilo first saves a verified encrypted recovery backup using the password entered above. Agent source files are never changed. Quit other Hopilo instances before restoring.{error && <span role="alert" className="mt-2 block text-danger">{error}</span>}</>} confirmLabel="Restore library" onClose={() => setConfirmRestore(false)} loading={busy} onConfirm={async () => {
      await run(async () => {
        const restored = await api.restoreBackup(path, password); setConfirmRestore(false); setReport(null); setPassword(""); setRepeat("");
        invalidateQuery(); useApp.getState().bump();
        setMessage(`Restored ${restored.report.sessions} sessions. Recovery backup: ${restored.recoveryPath}`);
      });
    }} />}
  </Card>;
}
