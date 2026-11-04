import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errorText } from "../lib/api";
import { relativeTime } from "../lib/format";
import { provider } from "../lib/providers";
import { useApp } from "../lib/store";
import { Button, Checkbox, Modal, Spinner, SearchField } from "./ui";

/** Ask for a ChatGPT or Claude data export (.zip or conversations.json). */
export async function pickChatExport(): Promise<string | null> {
  const res = await open({ multiple: false, filters: [{ name: "Chat export", extensions: ["zip", "json"] }] });
  return !res || Array.isArray(res) ? null : res;
}

/** Choose conversations from an account data export and import them. */
export function ExportImportModal({ path, onClose }: { path: string; onClose: () => void }) {
  const toast = useApp((s) => s.toast);
  const navigate = useApp((s) => s.navigate);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.listChatExport>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listChatExport(path).then(setData).catch((e) => setError(errorText(e)));
  }, [path]);

  const rows = useMemo(() => (data?.conversations ?? []).filter((c) => !q.trim() || c.title.toLowerCase().includes(q.trim().toLowerCase())), [data, q]);
  const label = data ? provider(data.provider).label : "";

  return (
    <Modal
      title={data ? `Import from your ${label} export` : "Import chat export"}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={picked.size === 0}
            onClick={async () => {
              setBusy(true);
              try {
                const out = await api.importChatExport(path, [...picked]);
                const dup = out.filter((o) => o.duplicateOf).length;
                toast({
                  kind: "success",
                  text: `Imported ${out.length - dup} conversation(s)${dup ? `, ${dup} already saved` : ""}.`,
                  action: out[0] ? { label: "Open", run: () => navigate({ page: "sessions", id: out[0].sourceId }) } : undefined,
                });
                onClose();
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Import {picked.size || ""} conversation{picked.size === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      {error && <div className="mb-3 text-danger">{error}</div>}
      {!data && !error && <Spinner label="Reading export" />}
      {data && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <SearchField label={`Search ${data.conversations.length} conversations`} value={q} onChange={setQ} className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(rows.map((r) => r.id)))}>Select shown</Button>
          </div>
          <ul className="max-h-[50vh] divide-y divide-line overflow-auto rounded-2xl border border-line">
            {rows.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5 hover:bg-surface-2">
                  <Checkbox
                    label={`Import ${c.title}`}
                    checked={picked.has(c.id)}
                    onChange={() => {
                      const n = new Set(picked);
                      if (n.has(c.id)) n.delete(c.id);
                      else n.add(c.id);
                      setPicked(n);
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.title}</span>
                    <span className="block font-mono text-[11px] text-faint">{c.messageCount} messages · {relativeTime(c.updatedAt)}</span>
                  </span>
                </label>
              </li>
            ))}
            {rows.length === 0 && <li className="px-3.5 py-6 text-center text-muted">No conversations match.</li>}
          </ul>
          <p className="text-[12px] text-faint">The export file is only read. Images and files that weren't included in the export are marked as missing.</p>
        </div>
      )}
    </Modal>
  );
}
