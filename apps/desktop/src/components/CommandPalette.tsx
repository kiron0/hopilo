import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { Globe, ClipboardPaste, MessagesSquare, Search, Settings } from "./Icons";
import { api, type SearchHit } from "../lib/api";
import { captureClipboard } from "../lib/actions";
import { type Route, useApp } from "../lib/store";

const PAGES: { route: Route; label: string; icon: React.ReactNode }[] = [
  { route: { page: "sessions" }, label: "Sessions", icon: <MessagesSquare size={15} /> },
  { route: { page: "browser" }, label: "Browser extension", icon: <Globe size={15} /> },
  { route: { page: "settings" }, label: "Settings", icon: <Settings size={15} /> },
];

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  const setOpen = useApp((s) => s.setPaletteOpen);
  const navigate = useApp((s) => s.navigate);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const t = setTimeout(() => api.search(q).then(setHits).catch(() => setHits([])), 120);
    return () => clearTimeout(t);
  }, [q]);

  if (!open) return null;
  const go = (r: Route) => {
    navigate(r);
    setOpen(false);
  };
  const openHit = (h: SearchHit) => go({ page: "sessions", id: h.refId });

  const item = "flex h-9 cursor-default items-center gap-2.5 rounded-lg px-2.5 text-[13px] data-[selected=true]:bg-accent-soft data-[selected=true]:text-ink text-muted";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 pt-[14vh]" onMouseDown={() => setOpen(false)}>
      <Command
        label="Command menu"
        shouldFilter={true}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        className="animate-pop w-[560px] overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
      >
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search size={16} className="text-faint" />
          <Command.Input autoFocus value={q} onValueChange={setQ} aria-label="Search every session, or type a command" placeholder="Search every session, or type a command" className="h-12 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint" />
        </div>
        <Command.List className="max-h-[360px] overflow-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-muted">No matches.</Command.Empty>
          {hits.length > 0 && (
            <Command.Group heading="Sessions" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-faint">
              {hits.map((h) => (
                <Command.Item key={`${h.kind}-${h.refId}`} value={`${h.title} ${h.snippet} ${h.refId}`} onSelect={() => openHit(h)} className={item}>
                  <MessagesSquare size={15} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-ink">{h.title}</div>
                    <div className="truncate text-[11.5px] text-faint">{h.snippet.replace(/\s+/g, " ")}</div>
                  </div>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-faint">
            <Command.Item value="capture clipboard" onSelect={() => { setOpen(false); captureClipboard(); }} className={item}>
              <ClipboardPaste size={15} /> Save clipboard as a session
            </Command.Item>
          </Command.Group>
          <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-faint">
            {PAGES.map((p) => (
              <Command.Item key={p.label} value={`go ${p.label}`} onSelect={() => go(p.route)} className={item}>
                {p.icon} {p.label}
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
