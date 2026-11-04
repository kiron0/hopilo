import { useState } from "react";
import { Bot, ClipboardPaste, FileArchive, FilePlus2, FileUp, FolderPlus, Type } from "lucide-react";
import { api, errorText } from "../lib/api";
import { captureClipboard, importPackFile, pickFiles } from "../lib/actions";
import { PASTE_SOURCES, provider } from "../lib/providers";
import { useApp } from "../lib/store";
import { ProviderBadge } from "./Dashboard";
import { FileImportModal } from "../components/FileImport";
import { ExportImportModal, pickChatExport } from "../components/ExportImport";
import { Button, Card, cx, Field, PageHeader, ProviderChip, SectionLabel, TextArea, TextInput } from "../components/ui";
import { Select } from "../components/Select";

const QUICK_PICKS = ["chatgpt", "claude", "gemini", "grok", "deepseek", "perplexity", "copilot", "mistral"];

function Tile({ icon, title, body, onClick }: { icon: React.ReactNode; title: string; body: string; onClick: () => void }) {
  return (
    <Card className="transition-all hover:-translate-y-px hover:shadow-pop">
      <button type="button" onClick={onClick} className="flex w-full items-start gap-3 p-4 text-left">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">{icon}</span>
        <span>
          <span className="block font-semibold">{title}</span>
          <span className="mt-0.5 block text-[12.5px] text-muted">{body}</span>
        </span>
      </button>
    </Card>
  );
}

export function QuickCapture() {
  const navigate = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const [paths, setPaths] = useState<string[] | null>(null);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [from, setFrom] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const saveNote = async () => {
    setBusy(true);
    try {
      const out = await api.importText(text, "manual", title, from || undefined);
      setText("");
      setTitle("");
      toast({ kind: "success", text: "Saved to your library.", action: { label: "View", run: () => navigate({ page: "sessions", tab: "library", sourceId: out.sourceId }) } });
    } catch (e) {
      toast({ kind: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const more = PASTE_SOURCES.filter((p) => !QUICK_PICKS.includes(p.id));

  return (
    <div className="space-y-7">
      <PageHeader title="Capture" subtitle="Bring a conversation into Hopilo. Nothing is captured until you choose it here — no background watching." />

      <section>
        <SectionLabel>Paste a chat from any AI</SectionLabel>
        <Card className="space-y-4 p-5">
          <div>
            <div className="mb-2 text-[13px] font-medium">Where is it from?</div>
            <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Where is it from?">
              {QUICK_PICKS.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={from === id}
                  onClick={() => setFrom(from === id ? "" : id)}
                  className={cx(
                    "flex h-8 items-center gap-2 rounded-full border pr-3 pl-1 text-[12.5px] font-medium transition-colors",
                    from === id ? "border-accent bg-accent-soft text-ink" : "border-line bg-surface text-muted hover:text-ink",
                  )}
                >
                  <ProviderBadge id={id} size={22} />
                  {provider(id).label}
                </button>
              ))}
              <div className="w-48">
                <Select
                  size="sm"
                  label="Other AI"
                  emptyLabel="Other AI…"
                  value={more.some((m) => m.id === from) ? from : ""}
                  onChange={setFrom}
                  options={more.map((p) => ({ value: p.id, label: p.label, group: p.kind === "chat" ? "Chat apps" : "Coding agents & editors", icon: <ProviderChip id={p.id} size={18} /> }))}
                />
              </div>
            </div>
          </div>
          <Field label="Title" hint="Optional — first line if empty">
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Conversation" hint="In the chat: ⌘A, ⌘C, then paste here">
            <TextArea rows={8} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-faint">Kept exactly as pasted. Marked as a pasted source, since Hopilo can't verify it.</span>
            <Button variant="primary" icon={<Type size={14} />} disabled={!text.trim()} busy={busy} onClick={saveNote}>
              Save {from ? `${provider(from).label} chat` : "to library"}
            </Button>
          </div>
        </Card>
      </section>

      <section>
        <SectionLabel>Or bring it in another way</SectionLabel>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Tile icon={<Bot size={18} />} title="Coding-agent session" body="Claude Code, Codex, Gemini CLI or OpenCode — found automatically." onClick={() => navigate({ page: "sessions", tab: "agents" })} />
          <Tile icon={<FileArchive size={18} />} title="ChatGPT or Claude export" body="The .zip from Settings › Export data. Pick which chats to import." onClick={async () => { const p = await pickChatExport(); if (p) setExportPath(p); }} />
          <Tile icon={<ClipboardPaste size={18} />} title="Clipboard, in one click" body="Saves whatever text is on the clipboard right now." onClick={() => captureClipboard()} />
          <Tile icon={<FilePlus2 size={18} />} title="Files" body="Specs, logs, code. You review each file before it's stored." onClick={async () => { const p = await pickFiles(); if (p.length) setPaths(p); }} />
          <Tile icon={<FolderPlus size={18} />} title="A folder" body="Up to 200 files. Skips node_modules, .git and links." onClick={async () => { const p = await pickFiles(true); if (p.length) setPaths(p); }} />
          <Tile icon={<FileUp size={18} />} title="A Hopilo pack" body="A .handoff file someone shared. Checked for tampering." onClick={async () => { const p = await importPackFile(); if (p) navigate({ page: "packs", packId: p.packId }); }} />
        </div>
      </section>
      {paths && <FileImportModal paths={paths} onClose={() => setPaths(null)} />}
      {exportPath && <ExportImportModal path={exportPath} onClose={() => setExportPath(null)} />}
    </div>
  );
}
