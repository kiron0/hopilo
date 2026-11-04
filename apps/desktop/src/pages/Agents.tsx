import { useMemo, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { CheckCircle2, ClipboardPaste, FileArchive, FileText, FolderOpen, ScanSearch } from "../components/Icons";
import { open } from "@tauri-apps/plugin-dialog";
import { errorText } from "../lib/api";
import { api } from "../lib/api";
import { useLoad } from "../lib/hooks";
import { CAPTURE_LABEL, type CaptureMethod, PROVIDERS } from "../lib/providers";
import { useApp } from "../lib/store";
import { ProviderBadge } from "./Dashboard";
import { ExportImportModal, pickChatExport } from "../components/ExportImport";
import { PageFooter, PageToolbar } from "../components/PageSlots";
import { Badge, Button, Card, IconButton, PageHeader, SectionLabel, Segmented, SearchField } from "../components/ui";

const METHOD_ICON: Record<CaptureMethod, React.ReactNode> = {
  auto: <ScanSearch size={12} />,
  export: <FileArchive size={12} />,
  file: <FileText size={12} />,
  paste: <ClipboardPaste size={12} />,
  none: null,
};

export function Agents() {
  const info = useLoad(() => api.appInfo());
  const sessions = useLoad(() => api.discoverSessions(), [], { refreshOnChange: false });
  const navigate = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const [kind, setKind] = useState<"all" | "chat" | "agent">("all");
  const [q, setQ] = useState("");
  const [exportPath, setExportPath] = useState<string | null>(null);

  const list = useMemo(
    () => PROVIDERS.filter((p) => p.kind !== "local" && p.id !== "other" && (kind === "all" || p.kind === kind) && (!q.trim() || p.label.toLowerCase().includes(q.trim().toLowerCase()))),
    [kind, q],
  );
  const adapters = new Map((info.data?.adapters ?? []).map((a) => [a.id, a]));
  const counts = new Map<string, number>();
  for (const s of sessions.data ?? []) counts.set(s.adapter, (counts.get(s.adapter) ?? 0) + 1);

  const getContext = async (method: CaptureMethod) => {
    if (method === "export") {
      const p = await pickChatExport();
      if (p) setExportPath(p);
    } else if (method === "file") {
      const p = await open({ multiple: false, filters: [{ name: "Aider chat history", extensions: ["md"] }] });
      if (!p || Array.isArray(p)) return;
      try {
        const out = await api.importAiderHistory(p);
        toast({ kind: out.duplicateOf ? "info" : "success", text: out.duplicateOf ? "That history is already in your library." : "Imported the Aider history.", action: { label: "View", run: () => navigate({ page: "sessions", tab: "library", sourceId: out.sourceId }) } });
      } catch (e) {
        toast({ kind: "error", text: errorText(e) });
      }
    } else if (method === "auto") navigate({ page: "sessions", tab: "agents" });
    else navigate({ page: "capture" });
  };

  return (
    <div>
      <PageHeader
        title="AI tools"
        subtitle="Every tool you can move a conversation between. Each row shows how Hopilo gets the conversation out."
      />
      <PageToolbar className="gap-3">
        <Segmented
          label="Kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: "all", label: "All" },
            { value: "chat", label: "Chat apps" },
            { value: "agent", label: "Coding agents & editors" },
          ]}
        />
        <SearchField label="Search tools" placeholder="Search AI tools" value={q} onChange={setQ} className="w-64" />
      </PageToolbar>

      {(["agent", "chat"] as const)
        .filter((k) => kind === "all" || kind === k)
        .map((k) => {
          const rows = list.filter((p) => p.kind === k);
          if (!rows.length) return null;
          return (
            <section key={k} className="mb-6">
              <SectionLabel>{k === "agent" ? "Coding agents & editors" : "Chat apps"}</SectionLabel>
              <p className="-mt-1 mb-2.5 text-[12px] text-faint">
                {k === "agent" ? "To continue: start a session in the project folder and paste as the first message." : "To continue: open a new chat, paste, check it, then send."}
              </p>
              <Card className="divide-y divide-line">
                {rows.map((p) => {
                  const a = adapters.get(p.id);
                  const n = counts.get(p.id) ?? 0;
                  const ready = p.capture !== "auto" || a?.available;
                  return (
                    <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                      <ProviderBadge id={p.id} size={28} />
                      <div className="w-44 shrink-0 truncate font-medium">{p.label}</div>
                      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px] text-muted">
                        {METHOD_ICON[p.capture]}
                        <span className="truncate">{CAPTURE_LABEL[p.capture]}</span>
                      </div>
                      {p.capture === "auto" &&
                        (a?.available ? (
                          <Badge tone="success"><CheckCircle2 size={11} /> {n} found</Badge>
                        ) : (
                          <Badge>Not installed</Badge>
                        ))}
                      {p.capture === "auto" && a?.available && (
                        <IconButton label={`Show ${p.label} folder`} onClick={() => revealItemInDir(a.roots[0])}>
                          <FolderOpen size={14} />
                        </IconButton>
                      )}
                      <Button size="sm" className="w-[132px]" onClick={() => getContext(p.capture)} disabled={!ready}>
                        {p.capture === "auto" ? "Browse sessions" : p.capture === "export" ? "Import export…" : p.capture === "file" ? "Import history…" : "Paste a chat"}
                      </Button>
                    </div>
                  );
                })}
              </Card>
            </section>
          );
        })}
      <PageFooter>
        <span className="mr-auto text-[12px] text-faint">Session files and exports are only read, never changed. Browser chats are captured with the Hopilo extension.</span>
      </PageFooter>
      {exportPath && <ExportImportModal path={exportPath} onClose={() => setExportPath(null)} />}
    </div>
  );
}
