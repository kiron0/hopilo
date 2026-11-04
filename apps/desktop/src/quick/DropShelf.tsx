import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, FileDown, GripVertical, X } from "lucide-react";
import { api, type Level } from "../lib/api";
import { copyHandoff, exportPack } from "../lib/actions";
import { tokens } from "../lib/format";
import { useBootstrap, useLoad } from "../lib/hooks";
import { useApp } from "../lib/store";
import { target } from "../lib/targets";
import { Toasts } from "../components/Toasts";
import { ProviderChip, Segmented } from "../components/ui";

/** Small floating window holding one pack (DND-13). Drag the tile onto a
 *  ChatGPT, Claude or Gemini tab that has the Hopilo extension, or copy or
 *  save it. Nothing is sent anywhere. */
export function DropShelf() {
  const ready = useBootstrap();
  const settings = useApp((s) => s.settings);
  const packId = new URLSearchParams(window.location.search).get("pack") ?? "";
  const { data, error } = useLoad(() => api.getPack(packId, null), [packId]);
  const [level, setLevel] = useState<Level>(settings.level === "full" ? "balanced" : settings.level);

  useEffect(() => {
    if (ready) requestAnimationFrame(() => getCurrentWindow().show().catch(() => undefined));
  }, [ready]);

  if (!ready) return null;
  const pack = data?.pack;

  return (
    <div className="quick-shell relative isolate flex h-full flex-col overflow-hidden rounded-[18px] border border-line text-[13px]">
      <div aria-hidden className="app-aura app-aura-contained">
        <span />
        <span />
        <span />
      </div>
      <header data-tauri-drag-region className="flex h-8 shrink-0 items-center gap-1.5 px-3 text-[11.5px] text-faint">
        <span data-tauri-drag-region className="label-mono flex-1">Drop Shelf</span>
        <button type="button" aria-label="Close Drop Shelf" onClick={() => api.closeDropShelf()} className="flex h-5 w-5 items-center justify-center rounded-md hover:bg-surface-3 hover:text-ink">
          <X size={13} />
        </button>
      </header>
      {error && <div className="px-3 text-danger">{error}</div>}
      {pack && (
        <div className="flex flex-1 flex-col gap-2 px-3 pb-3">
          <div
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", `hopilo://pack/${pack.packId}@${pack.version}`);
              e.dataTransfer.effectAllowed = "copy";
            }}
            className="card card-sm flex cursor-grab items-center gap-2.5 px-3 py-2.5 shadow-item active:cursor-grabbing"
            title="Drag onto a ChatGPT, Claude or Gemini tab that has the Hopilo extension"
          >
            <GripVertical size={14} className="shrink-0 text-faint" />
            <ProviderChip id={pack.sources[0]?.provider ?? "manual"} size={26} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{pack.title}</div>
              <div className="font-mono text-[11px] text-faint">v{pack.version} · {pack.messages.length} msgs · {tokens(Math.ceil(pack.messages.reduce((n, m) => n + m.blocks.reduce((k, b) => k + ("text" in b ? b.text.length : 0), 0), 0) / 4))} tokens</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Segmented label="How much to include" value={level} onChange={setLevel} options={[{ value: "minimal", label: "Min" }, { value: "balanced", label: "Bal" }, { value: "full", label: "Full" }]} />
            <div className="flex-1" />
            <button
              type="button"
              aria-label={`Copy for ${target(settings.defaultTarget).label}`}
              title={`Copy for ${target(settings.defaultTarget).label}`}
              onClick={() => copyHandoff(pack.packId, pack.version, settings.defaultTarget, settings.toolDetail, level)}
              className="bg-brand flex h-8 w-8 items-center justify-center rounded-full text-white shadow-brand hover:brightness-110"
            >
              <Copy size={14} />
            </button>
            <button
              type="button"
              aria-label="Save as Markdown file"
              title="Save as Markdown file"
              onClick={() => exportPack(pack.packId, pack.version, "md", settings.toolDetail, level)}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-item hover:text-ink"
            >
              <FileDown size={14} />
            </button>
          </div>
        </div>
      )}
      <Toasts />
    </div>
  );
}
