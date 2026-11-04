import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileImage, FileText, File as FileIcon, XCircle } from "./Icons";
import { api, errorText, type FilePreflight } from "../lib/api";
import { bytes } from "../lib/format";
import { useApp } from "../lib/store";
import { deviceNoun } from "../lib/platform";
import { Button, Checkbox, Modal, Spinner } from "./ui";

const KIND_ICON = { text: FileText, image: FileImage, pdf: FileText, binary: FileIcon };

/** Preflight review for dropped or chosen files (DND-01, DND-09): shows
 *  type, size and warnings; nothing is stored until the user confirms.
 *  Files join `session`, or start a new session when it is null. */
export function FileImportModal({ paths, session, onClose }: { paths: string[]; session: string | null; onClose: () => void }) {
  const toast = useApp((s) => s.toast);
  const navigate = useApp((s) => s.navigate);
  const [files, setFiles] = useState<FilePreflight[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .preflightFiles(paths)
      .then((r) => {
        setFiles(r.files);
        setNotes(r.notes);
      })
      .catch((e) => setError(errorText(e)));
  }, [paths]);

  const accepted = (files ?? []).filter((f) => f.accepted && !skip.has(f.path));

  const run = async () => {
    setBusy(true);
    try {
      const r = await api.addFiles(session, accepted.map((f) => f.path));
      if (r.errors.length) toast({ kind: "warning", text: `Some files were skipped: ${r.errors.join("; ")}` });
      if (r.added) toast({ kind: "success", text: `Added ${r.added} file${r.added === 1 ? "" : "s"}${session ? " to this session" : ""}.` });
      if (r.sessionId && r.sessionId !== session) navigate({ page: "sessions", id: r.sessionId });
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={session ? "Add files to this session" : "Add files as a new session"}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!files || accepted.length === 0} onClick={run}>
            Add {accepted.length} file{accepted.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      {error && <div className="mb-3 text-danger">{error}</div>}
      {!files && !error && <Spinner label="Checking files" />}
      {files && (
        <div className="space-y-3">
          <p className="text-muted">{`Files are copied into Hopilo on this ${deviceNoun}. Originals are not changed.`}</p>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {files.map((f) => {
              const Icon = KIND_ICON[f.kind];
              const on = f.accepted && !skip.has(f.path);
              return (
                <li key={f.path} className="flex items-start gap-3 px-3.5 py-2.5">
                  <Checkbox
                    label={`Add ${f.name}`}
                    disabled={!f.accepted}
                    checked={on}
                    onChange={() => {
                      const n = new Set(skip);
                      if (n.has(f.path)) n.delete(f.path);
                      else n.add(f.path);
                      setSkip(n);
                    }}
                    className="mt-0.5"
                  />
                  <Icon size={16} className="mt-0.5 shrink-0 text-faint" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium" title={f.path}>{f.name}</span>
                      <span className="text-[12px] text-faint">{bytes(f.size)} · {f.mediaType}</span>
                    </div>
                    {f.error && (
                      <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-danger"><XCircle size={12} /> {f.error}</div>
                    )}
                    {f.warnings.map((w) => (
                      <div key={w} className="mt-0.5 flex items-center gap-1.5 text-[12px] text-warning"><AlertTriangle size={12} /> {w}</div>
                    ))}
                    {f.accepted && !f.warnings.length && (
                      <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-success"><CheckCircle2 size={12} /> Ready</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {notes.map((n) => (
            <div key={n} className="text-[12px] text-muted">{n}</div>
          ))}
        </div>
      )}
    </Modal>
  );
}
