import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Command } from "cmdk";
import { Globe, ClipboardPaste, Copy, FileUp, GitBranch, OverviewIcon, MessagesSquare, Search, Settings, X } from "./Icons";
import { api, type SearchHit } from "../lib/api";
import { captureClipboard, importHandoffFile } from "../lib/actions";
import { useDebouncedValue } from "../lib/hooks";
import { type Route, useApp } from "../lib/store";
import { cx, IconButton, Kbd } from "./ui";
import { SETTINGS_GROUPS, SETTINGS_SECTIONS } from "./settingsNav";

const PAGES: { route: Route; label: string; icon: React.ReactNode }[] = [
  { route: { page: "overview" }, label: "Overview", icon: <OverviewIcon size={15} /> },
  { route: { page: "sessions" }, label: "Sessions", icon: <MessagesSquare size={15} /> },
  { route: { page: "compare" }, label: "Compare sessions", icon: <GitBranch size={15} /> },
  { route: { page: "browser" }, label: "Browser extension", icon: <Globe size={15} /> },
  { route: { page: "settings" }, label: "Settings", icon: <Settings size={15} /> },
];

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  const setOpen = useApp((s) => s.setPaletteOpen);
  const navigate = useApp((s) => s.navigate);
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [closing, setClosing] = useState(false);
  const [active, setActive] = useState(open);

  useEffect(() => {
    if (open) {
      setActive(true);
      setClosing(false);
    } else if (active && !closing) {
      setClosing(true);
      const timer = setTimeout(() => {
        setActive(false);
        setClosing(false);
      }, 130);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setActive(false);
      setClosing(false);
    }, 130);
  }, [closing, setOpen]);

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  useEffect(() => {
    const query = debouncedQ.trim();
    if (query.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    api
      .search(query)
      .then((next) => {
        if (!cancelled) setHits(Array.isArray(next) ? next : []);
      })
      .catch(() => {
        if (!cancelled) setHits([]);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQ]);

  if (!active || typeof document === "undefined") return null;
  const go = (r: Route) => {
    navigate(r);
    requestClose();
  };
  const openHit = (h: SearchHit) => go({ page: "sessions", id: h.refId });

  const item =
    "flex h-9.5 cursor-pointer items-center gap-2.5 rounded-xl px-3 text-[13px] text-muted transition-colors data-[selected=true]:bg-accent-soft data-[selected=true]:text-ink hover:bg-surface-2";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-6 pt-[12vh]">
      <div
        className={cx(
          "fixed inset-0 bg-black/40 backdrop-blur-sm",
          closing ? "modal-backdrop-out" : "modal-backdrop-in"
        )}
        onMouseDown={requestClose}
      />
      <Command
        label="Search & Commands"
        shouldFilter={true}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && requestClose()}
        className={cx(
          "relative z-10 flex w-full max-w-xl flex-col rounded-[22px] border border-line bg-surface shadow-pop outline-none overflow-hidden",
          closing ? "modal-dialog-out" : "modal-dialog-in"
        )}
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3">
          <Search size={18} className="text-faint shrink-0" />
          <Command.Input
            autoFocus
            value={q}
            onValueChange={setQ}
            aria-label="Search sessions, tools, or type a command"
            placeholder="Search sessions, tools, or type a command…"
            className="h-9 flex-1 bg-transparent text-[14.5px] text-ink outline-none placeholder:text-faint"
          />
          <IconButton label="Close" onClick={requestClose}>
            <X size={16} />
          </IconButton>
        </div>

        <Command.List className="max-h-[380px] overflow-auto p-3">
          <Command.Empty className="px-3 py-8 text-center text-[13px] text-muted">
            No matching sessions or commands.
          </Command.Empty>
          {hits.length > 0 && (
            <Command.Group
              heading="Sessions"
              className="mb-2 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-faint"
            >
              {hits.map((h) => (
                <Command.Item
                  key={`${h.kind}-${h.refId}`}
                  value={`${h.title} ${h.snippet} ${h.refId}`}
                  onSelect={() => openHit(h)}
                  className={item}
                >
                  <MessagesSquare size={16} className="shrink-0 text-faint" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-ink">{h.title}</div>
                    <div className="truncate text-[11.5px] text-faint">
                      {h.snippet.replace(/\s+/g, " ")}
                    </div>
                  </div>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          <Command.Group
            heading="Actions"
            className="mb-2 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-faint"
          >
            <Command.Item
              value="capture clipboard save clipboard as session"
              onSelect={() => {
                setOpen(false);
                captureClipboard();
              }}
              className={item}
            >
              <ClipboardPaste size={16} className="shrink-0 text-accent" />
              <span className="font-medium">Save clipboard as a session</span>
            </Command.Item>
            <Command.Item
              value="copy latest session handoff quick"
              onSelect={() => {
                setOpen(false);
                useApp.getState().toast({ kind: "loading", text: "Copying your latest session…", key: "latest" });
                api.copyLatest().catch((e) => useApp.getState().toast({ kind: "error", text: `Copy failed: ${String(e)}`, key: "latest" }));
              }}
              className={item}
            >
              <Copy size={16} className="shrink-0 text-accent" />
              <span className="font-medium">Copy latest session</span>
            </Command.Item>
            <Command.Item
              value="import hopilo bundle open handoff file"
              onSelect={async () => {
                setOpen(false);
                const ids = await importHandoffFile();
                if (ids?.[0]) navigate({ page: "sessions", id: ids[0] });
              }}
              className={item}
            >
              <FileUp size={16} className="shrink-0 text-accent" />
              <span className="font-medium">Import a .hopilo bundle</span>
            </Command.Item>
          </Command.Group>
          <Command.Group
            heading="Go to"
            className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-faint"
          >
            {PAGES.map((p) => (
              <Command.Item
                key={p.label}
                value={`go to ${p.label}`}
                onSelect={() => go(p.route)}
                className={item}
              >
                <span className="shrink-0 text-faint">{p.icon}</span>
                <span className="font-medium">{p.label}</span>
              </Command.Item>
            ))}
          </Command.Group>
          {q.trim() && (
            <Command.Group
              heading="Settings"
              className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-faint"
            >
              {SETTINGS_SECTIONS.map((sec) => {
                const group = SETTINGS_GROUPS.find((g) => g.id === sec.group)!;
                return (
                  <Command.Item
                    key={`settings-${sec.id}`}
                    value={`settings ${group.label} ${sec.label}`}
                    keywords={sec.keywords.split(" ")}
                    onSelect={() => go({ page: "settings", section: sec.id })}
                    className={item}
                  >
                    <span className="shrink-0 text-faint"><group.icon size={15} /></span>
                    <span className="font-medium">{sec.label}</span>
                    <span className="ml-auto text-[11.5px] text-faint">{group.label}</span>
                  </Command.Item>
                );
              })}
            </Command.Group>
          )}
        </Command.List>

        <div className="flex items-center justify-between border-t border-line bg-surface-2 px-5 py-2.5 text-[11.5px] text-faint">
          <div className="flex items-center gap-3">
            <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> navigate</span>
            <span><Kbd>↵</Kbd> select</span>
          </div>
          <span><Kbd>esc</Kbd> to close</span>
        </div>
      </Command>
    </div>,
    document.body
  );
}
