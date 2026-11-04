import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ClipboardPaste, FileArchive, FilePlus2, FileUp, History } from "./Icons";
import { api, errorText } from "../lib/api";
import { captureClipboard, importHandoffFile, pickFiles } from "../lib/actions";
import { PASTE_SOURCES, provider } from "../lib/providers";
import { useApp } from "../lib/store";
import { modKey } from "../lib/platform";
import { FileImportModal } from "./FileImport";
import { ExportImportModal, pickChatExport } from "./ExportImport";
import { Button, cx, Field, Modal, ProviderBadge, ProviderChip, TextArea, TextInput } from "./ui";
import { Select } from "./Select";

const QUICK_PICKS = ["chatgpt", "claude", "gemini", "grok", "deepseek", "perplexity"];

function Way({ icon, title, body, onClick }: { icon: React.ReactNode; title: string; body: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="card card-sm flex items-start gap-3 p-3.5 text-left transition-all hover:-translate-y-px hover:shadow-pop">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[12px] text-muted">{body}</span>
      </span>
    </button>
  );
}

export function AddSessionModal({ onClose }: { onClose: () => void }) {
  const navigate = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [paths, setPaths] = useState<string[] | null>(null);
  const [exportPath, setExportPath] = useState<string | null>(null);

  const done = (id?: string) => {
    onClose();
    if (id) navigate({ page: "sessions", id });
  };

  const savePaste = async () => {
    setBusy(true);
    try {
      const out = await api.importText(text, "manual", title, from || undefined);
      toast({ kind: "success", text: "Saved." });
      done(out.sourceId);
    } catch (e) {
      toast({ kind: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const pickAider = async () => {
    const res = await open({ multiple: false, filters: [{ name: "Aider history", extensions: ["md"] }] });
    if (!res || Array.isArray(res)) return;
    try {
      done((await api.importAiderHistory(res)).sourceId);
    } catch (e) {
      toast({ kind: "error", text: `Import failed: ${errorText(e)}` });
    }
  };

  if (paths) return <FileImportModal paths={paths} session={null} onClose={onClose} />;
  if (exportPath) return <ExportImportModal path={exportPath} onClose={onClose} />;

  const more = PASTE_SOURCES.filter((p) => !QUICK_PICKS.includes(p.id));
  return (
    <Modal
      title="Add a session"
      onClose={onClose}
      wide
      footer={(close) => (
        <>
          <span className="mr-auto text-[12px] text-faint">Coding-agent sessions appear on their own. Web chats: use the browser extension.</span>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!text.trim()} busy={busy} onClick={savePaste}>
            Save {from ? `${provider(from).label} chat` : "pasted chat"}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
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
          <div className="w-44">
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
        <Field label="Title" hint="Optional">
          <TextInput placeholder="Uses the first line if empty" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Conversation">
          <TextArea autoFocus rows={7} placeholder={`Paste the conversation here. In the chat app: ${modKey}A to select it, ${modKey}C to copy.`} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Way icon={<ClipboardPaste size={17} />} title="Clipboard" body="Save the copied text as it is." onClick={async () => { const out = await captureClipboard(); if (out) done(out.sourceId); }} />
          <Way icon={<FileArchive size={17} />} title="ChatGPT or Claude export" body="The .zip from Settings › Export data." onClick={async () => { const p = await pickChatExport(); if (p) setExportPath(p); }} />
          <Way icon={<FilePlus2 size={17} />} title="Files" body="Specs, logs, images. Kept as one session." onClick={async () => { const p = await pickFiles(); if (p.length) setPaths(p); }} />
          <Way icon={<FileUp size={17} />} title="Hopilo export" body="A .handoff or .json file from Hopilo." onClick={async () => { const ids = await importHandoffFile(); if (ids) done(ids[0]); }} />
          <Way icon={<History size={17} />} title="Aider chat history" body="An .aider.chat.history.md file." onClick={pickAider} />
        </div>
      </div>
    </Modal>
  );
}
