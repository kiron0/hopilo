import { ExternalLink, SparkIcon } from "./Icons";
import { Button, Modal } from "./ui";
import { openExternal, type UpdateInfo } from "../lib/updates";

export function UpdateModal({
  update,
  currentVersion,
  onClose,
}: {
  update: UpdateInfo;
  currentVersion: string;
  onClose: () => void;
}) {
  return (
    <Modal title="Update Available" onClose={onClose}>
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
                <span> · Released {new Date(update.publishedAt).toLocaleDateString()}</span>
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

        <div className="flex items-center justify-end gap-2.5 pt-1">
          <Button variant="secondary" onClick={onClose}>
            Later
          </Button>
          <Button
            variant="primary"
            icon={<ExternalLink size={13} />}
            onClick={() => {
              openExternal(update.downloadUrl || update.releaseUrl);
              onClose();
            }}
          >
            Download from GitHub
          </Button>
        </div>
      </div>
    </Modal>
  );
}
