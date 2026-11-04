import { type ReactNode, useEffect, useMemo, useState } from "react";
import { SearchIcon, SessionsIcon, SettingsIcon, BrowserIcon } from "./Icons";
import { api } from "../lib/api";
import { bytes } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { type Route, useApp } from "../lib/store";
import { Kbd, Skeleton } from "./ui";
import { CommandPalette } from "./CommandPalette";
import { Toasts } from "./Toasts";
import { PageSlotsContext } from "./PageSlots";

type NavIcon = (p: { size?: number; active?: boolean }) => ReactNode;
type NavItem = { page: Route["page"]; label: string; icon: NavIcon; hint: string };

const NAV: NavItem[] = [
  { page: "sessions", label: "Sessions", icon: SessionsIcon, hint: "Every conversation, with its files" },
  { page: "browser", label: "Browser", icon: BrowserIcon, hint: "Extension for ChatGPT, Claude, Gemini and more" },
];

function LibraryCard() {
  const stats = useLoad(() => api.stats());
  const s = stats.data;
  const navigate = useApp((st) => st.navigate);
  return (
    <button type="button" onClick={() => navigate({ page: "settings", section: "storage" })} className="card card-sm block w-full p-3.5 text-left shadow-none">
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-semibold">Your library</span>
        {s ? <span className="font-mono text-[10.5px] text-faint">{bytes(s.storageBytes)}</span> : <Skeleton className="h-2.5 w-10" />}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className="bg-brand h-full rounded-full" style={{ width: s ? `${Math.min(100, 8 + s.providerCount * 12)}%` : "8%" }} />
      </div>
      {s ? <div className="mt-1.5 text-[11px] text-muted">{`${s.sourceCount} sessions · ${s.providerCount} tools`}</div> : <Skeleton className="mt-2 h-2.5 w-2/3" />}
      <div className="text-[11px] text-faint">Stays on this Mac</div>
    </button>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const route = useApp((s) => s.route);
  const navigate = useApp((s) => s.navigate);
  const setPaletteOpen = useApp((s) => s.setPaletteOpen);
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const [footerSlot, setFooterSlot] = useState<HTMLElement | null>(null);
  const slots = useMemo(() => ({ header: headerSlot, footer: footerSlot }), [headerSlot, footerSlot]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(!useApp.getState().paletteOpen);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        navigate({ page: "settings" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, setPaletteOpen]);

  const link = (it: NavItem) => {
    const active = route.page === it.page;
    return (
      <li key={it.page}>
        <button type="button" aria-current={active ? "page" : undefined} onClick={() => navigate({ page: it.page } as Route)} className="nav-item h-9 w-full text-left">
          <span className={active ? "text-accent" : "text-faint"}>
            <it.icon size={18} active={active} />
          </span>
          <span className="flex-1">{it.label}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="flex h-full">
      <div aria-hidden className="app-aura">
        <span />
        <span />
        <span />
      </div>
      <aside className="flex w-[236px] shrink-0 flex-col px-3.5">
        <div data-tauri-drag-region className="h-10 shrink-0" />
        <div data-tauri-drag-region className="flex items-center gap-2.5 px-2 pb-4">
          <img src="/hopilo-mark.svg" alt="" className="h-7 w-7 drop-shadow-[0_3px_6px_rgb(40_30_120/0.25)]" draggable={false} />
          <span data-tauri-drag-region className="font-display text-[17px] font-semibold">Hopilo</span>
        </div>
        <nav aria-label="Main" className="flex-1 overflow-auto">
          <ul className="space-y-0.5">{NAV.map(link)}</ul>
        </nav>
        <div className="space-y-2 pb-3">
          <ul>{link({ page: "settings", label: "Settings", icon: SettingsIcon, hint: "Preferences" })}</ul>
          <LibraryCard />
        </div>
      </aside>

      <div className="app-content my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[22px] border border-line bg-canvas/80 shadow-card">
        <header data-tauri-drag-region className="flex h-12 shrink-0 items-center justify-end gap-2 px-5">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-8.5 w-72 items-center gap-2 rounded-full border border-line bg-card px-3 text-faint shadow-item transition-colors hover:text-muted"
          >
            <Kbd>⌘K</Kbd>
            <span className="flex-1 text-left text-[12.5px] text-muted">Search</span>
            <SearchIcon size={14} />
          </button>
        </header>
        {/* Fixed page header, scrolling content, fixed page footer. */}
        <div ref={setHeaderSlot} className="page-header-slot" />
        <main
          key={route.page}
          className="page-scroll at-top min-h-0 flex-1 overflow-auto"
          onScroll={(e) => e.currentTarget.classList.toggle("at-top", e.currentTarget.scrollTop < 2)}
        >
          <div className="page-inner mx-auto max-w-[1180px] px-7 pt-1 pb-12">
            <PageSlotsContext.Provider value={slots}>{children}</PageSlotsContext.Provider>
          </div>
        </main>
        <div ref={setFooterSlot} className="page-footer-slot" />
      </div>
      <CommandPalette />
      <Toasts />
    </div>
  );
}
