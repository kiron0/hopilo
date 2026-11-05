import { type ReactNode, useEffect, useMemo, useState } from "react";
import { OverviewIcon, SearchIcon, SessionsIcon, SettingsIcon, BrowserIcon } from "./Icons";
import { api } from "../lib/api";
import { bytes } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { type Route, useApp } from "../lib/store";
import { deviceNoun, modKey } from "../lib/platform";
import { Kbd, Skeleton } from "./ui";
import { CommandPalette } from "./CommandPalette";
import { Toasts } from "./Toasts";
import { PageSlotsContext } from "./PageSlots";
import { BackgroundLayer } from "./Flow";

type NavIcon = (p: { size?: number; active?: boolean; className?: string }) => ReactNode;
type NavItem = { page: Route["page"]; label: string; icon: NavIcon; hint: string };

const NAV: NavItem[] = [
  { page: "overview", label: "Overview", icon: OverviewIcon, hint: "Overview and quick actions" },
  { page: "sessions", label: "Sessions", icon: SessionsIcon, hint: "Every conversation, with its files" },
  { page: "browser", label: "Browser", icon: BrowserIcon, hint: "Extension for ChatGPT, Claude, Gemini and more" },
];

function LibraryCard() {
  const stats = useLoad(() => api.stats());
  const s = stats.data;
  const navigate = useApp((st) => st.navigate);
  return (
    <button
      type="button"
      onClick={() => navigate({ page: "settings", section: "storage" })}
      className="disk block w-full p-4 text-left transition-transform hover:-translate-y-0.5 cursor-pointer"
    >
      <div className="disk-row flex items-baseline justify-between">
        <span className="text-[13px] font-semibold">Your library</span>
        {s ? <span className="font-mono text-[11px] text-faint">{bytes(s.storageBytes)}</span> : <Skeleton className="h-2.5 w-10" />}
      </div>
      <div className="bar mt-2.5">
        <span className="used" style={{ width: s ? `${Math.min(100, 8 + s.providerCount * 12)}%` : "8%" }} />
      </div>
      {s ? <div className="disk-note mt-2 text-[11.5px] text-muted">{`${s.sourceCount} sessions · ${s.providerCount} tools`}</div> : <Skeleton className="mt-2 h-2.5 w-2/3" />}
      <div className="disk-note text-[11px] text-faint">{`Stays on this ${deviceNoun}`}</div>
    </button>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const route = useApp((s) => s.route);
  const navigate = useApp((s) => s.navigate);
  const settings = useApp((s) => s.settings);
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
        <button
          type="button"
          aria-current={active ? "page" : undefined}
          onClick={() => navigate({ page: it.page } as Route)}
          className={`nav-item h-10 w-full text-left cursor-pointer ${active ? "on" : ""}`}
        >
          <it.icon size={20} active={active} className="ic" />
          <span className="flex-1 text-[14px] font-medium">{it.label}</span>
        </button>
      </li>
    );
  };

  const bg = settings.background ?? "mist";

  return (
    <div className="cleanly-app app" data-bg={bg}>
      <BackgroundLayer />
      <header data-tauri-drag-region className="cleanly-titlebar">
        <div data-tauri-drag-region className="flex-1" />
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="flex h-8.5 w-72 items-center gap-2 rounded-full border border-line bg-card/90 px-3 text-faint shadow-item transition-all hover:bg-card hover:text-muted hover:shadow-card active:scale-[0.99] cursor-pointer"
        >
          <Kbd>{modKey}K</Kbd>
          <span className="flex-1 text-left text-[12.5px] text-muted">Search sessions & actions…</span>
          <SearchIcon size={14} />
        </button>
      </header>

      <div className="cleanly-body">
        <aside className="cleanly-nav">
          <div data-tauri-drag-region className="brand flex items-center gap-2.5 px-3 pb-3">
            <img src="/hopilo-mark.svg" alt="" className="h-7 w-7 drop-shadow-[0_3px_6px_rgb(40_30_120/0.25)]" draggable={false} />
            <span data-tauri-drag-region className="brand-name font-display text-[19px] font-medium tracking-tight">Hopilo</span>
          </div>
          <nav aria-label="Main" className="flex-1 overflow-auto">
            <ul className="space-y-1">{NAV.map(link)}</ul>
          </nav>
          <div className="space-y-2 pt-2">
            <ul>{link({ page: "settings", label: "Settings", icon: SettingsIcon, hint: "Preferences" })}</ul>
            <LibraryCard />
          </div>
        </aside>

        <main key={route.page} className="cleanly-main">
          <div ref={setHeaderSlot} className="page-header-slot" />
          <div className="screen flex-1 min-h-0 flex flex-col gap-4">
            <PageSlotsContext.Provider value={slots}>{children}</PageSlotsContext.Provider>
          </div>
          <div ref={setFooterSlot} className="page-footer-slot" />
        </main>
      </div>

      <CommandPalette />
      <Toasts />
    </div>
  );
}
