import { useState } from "react";
import { AlertTriangle, SparkIcon } from "./Icons";
import { Button, Modal } from "./ui";
import { installInAppUpdate, type UpdateInfo, type UpdateInstallProgress } from "../lib/updates";
import { bytes, formatDate } from "../lib/format";

export function UpdateModal({
  update,
  currentVersion,
  onClose,
}: {
  update: UpdateInfo;
  currentVersion: string;
  onClose: () => void;
}) {
  const [progress, setProgress] = useState<UpdateInstallProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null && error === null;

  const install = async () => {
    setError(null);
    setProgress({ phase: "downloading", downloadedBytes: 0 });
    try {
      await installInAppUpdate(update, setProgress);
    } catch (cause) {
      setProgress(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <Modal
      title="Update Available"
      onClose={onClose}
      dismissible={!busy}
      footer={(close) => (
        <div className="flex w-full items-center justify-end gap-2.5">
          <Button variant="secondary" onClick={close} disabled={busy}>
            Later
          </Button>
          <Button
            variant="primary"
            busy={busy}
            icon={<SparkIcon size={13} />}
            onClick={install}
          >
            {progress?.phase === "installing" ? "Installing…" : error ? "Try Again" : busy ? "Downloading…" : "Update Now"}
          </Button>
        </div>
      )}
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface-2/60 p-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <SparkIcon size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[15px]">{update.name || `Version ${update.version}`}</span>
              <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10.5px] font-semibold text-accent">
                v{update.version}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-muted">
              Current version: <span className="font-mono text-faint">v{currentVersion}</span>
              {update.publishedAt && (
                <span> · Released {formatDate(update.publishedAt)}</span>
              )}
            </p>
          </div>
        </div>

        {update.releaseNotes && (
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-muted">Release Notes</div>
            <div className="max-h-56 overflow-y-auto rounded-xl border border-line bg-card p-3.5 font-sans text-[12.5px] leading-relaxed text-ink shadow-item whitespace-pre-wrap">
              {update.releaseNotes}
            </div>
          </div>
        )}

        {progress && (
          <div className="rounded-xl border border-line bg-card p-3.5" aria-live="polite">
            <div className="flex items-center justify-between gap-3 text-[12px] font-medium">
              <span>{progress.phase === "installing" ? "Verifying and installing…" : "Downloading update…"}</span>
              {progress.phase === "downloading" && progress.percent !== undefined && (
                <span className="font-mono text-faint">{progress.percent}%</span>
              )}
            </div>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2"
              role="progressbar"
              aria-label="Update download progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.percent}
            >
              <div
                className={`h-full rounded-full bg-accent transition-[width] duration-150 ${progress.percent === undefined ? "w-1/3 animate-pulse" : ""}`}
                style={progress.percent === undefined ? undefined : { width: `${progress.percent}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] text-faint">
              {progress.phase === "installing"
                ? "Hopilo will restart automatically when the signed update is ready."
                : progress.totalBytes
                  ? `${bytes(progress.downloadedBytes)} of ${bytes(progress.totalBytes)}`
                  : `${bytes(progress.downloadedBytes)} downloaded`}
            </p>
          </div>
        )}

        {error && (
          <div className="flex gap-2.5 rounded-xl border border-line bg-danger-soft p-3.5 text-[12px] text-danger" role="alert">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Update couldn't be installed</div>
              <p className="mt-0.5 leading-relaxed">{error} Try again, or check your internet connection.</p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
