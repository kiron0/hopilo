import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Archive, ArrowLeft, Bot, BrowserIcon, Copy, FileUp, GitBranch, Globe, OverviewIcon, Pin, SearchIcon, SessionsIcon, SettingsIcon } from "./Icons";
import { importHandoffFile } from "../lib/actions";
import { SETTINGS_GROUPS, settingsGroupFor } from "./settingsNav";
import { api } from "../lib/api";
import { bytes } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { type Route, type SessionFilter, useApp } from "../lib/store";
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
];

const SHORTCUT_FILTERS = new Set<SessionFilter>(["pinned", "agents", "web", "hidden"]);

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
  const listFilter = useApp((s) => s.listView.filter);
  const rows = useLoad(() => api.listSessions());
  const counts = useMemo(() => {
    const r = rows.data ?? [];
    return {
      pinned: r.filter((x) => x.pinned).length,
      agents: r.filter((x) => x.kind === "local-agent").length,
      web: r.filter((x) => x.kind === "browser-chat").length,
    };
  }, [rows.data]);
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
      if (e.key === "Escape" && !e.defaultPrevented) {
        const st = useApp.getState();
        const t = e.target as HTMLElement | null;
        const typing = !!t?.closest("input, textarea, select, [contenteditable='true']");
        if (st.route.page === "settings" && !st.paletteOpen && !typing && !document.querySelector("[role='dialog'], [role='alertdialog']")) {
          navigate(st.lastAppRoute);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, setPaletteOpen]);

  const link = (it: NavItem) => {
    const active = route.page === it.page && !(route.page === "sessions" && !route.id && SHORTCUT_FILTERS.has(listFilter));
    return (
      <li key={it.page}>
        <button
          type="button"
          aria-current={active ? "page" : undefined}
          title={it.hint}
          onClick={() => navigate(it.page === "sessions" && SHORTCUT_FILTERS.has(listFilter) ? { page: "sessions", filter: "all" } : ({ page: it.page } as Route))}
          className={`nav-item h-10 w-full text-left cursor-pointer ${active ? "on" : ""}`}
        >
          <it.icon size={20} active={active} className="ic" />
          <span className="flex-1 text-[14px] font-medium">{it.label}</span>
        </button>
      </li>
    );
  };

  const small = (key: string, label: string, Icon: NavIcon, onClick: () => void, active = false, count?: number, hint?: string) => (
    <li key={key}>
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        title={hint ?? label}
        onClick={onClick}
        className={`nav-item h-9 w-full text-left cursor-pointer ${active ? "on" : ""}`}
      >
        <Icon size={18} active={active} className="ic" />
        <span className="flex-1 truncate text-[13px] font-medium">{label}</span>
        {count != null && count > 0 && <span className="font-mono text-[10.5px] text-faint">{count}</span>}
      </button>
    </li>
  );
  const filterLink = (filter: SessionFilter, label: string, Icon: NavIcon, count?: number) =>
    small(filter, label, Icon, () => navigate({ page: "sessions", filter }), route.page === "sessions" && !route.id && listFilter === filter, count);

  const bg = settings.background ?? "mist";

  return (
    <div className="cleanly-app app" data-bg={bg}>
      <BackgroundLayer />
      <header data-tauri-drag-region className="cleanly-titlebar">
        <div data-tauri-drag-region className="flex-1" />
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="flex h-8.5 w-72 items-center gap-2 rounded-full border border-line bg-card px-3 text-faint shadow-item transition-all hover:text-muted hover:shadow-card active:scale-[0.99] cursor-pointer"
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
          {route.page === "settings" ? (
            <nav key="settings" aria-label="Settings" className="flex-1 overflow-auto">
              <button
                type="button"
                onClick={() => navigate(useApp.getState().lastAppRoute)}
                title="Back (Esc)"
                className="nav-item h-10 w-full cursor-pointer text-left"
              >
                <ArrowLeft size={18} className="ic" />
                <span className="flex-1 text-[14px] font-medium">Back to app</span>
              </button>
              <div className="mx-3 mt-4 mb-2 font-display text-[15px] font-semibold">Settings</div>
              <ul className="space-y-1">
                {SETTINGS_GROUPS.map((g) => {
                  const on = settingsGroupFor(route.section) === g.id;
                  return (
                    <li key={g.id}>
                      <button
                        type="button"
                        aria-current={on ? "page" : undefined}
                        onClick={() => navigate({ page: "settings", section: g.id })}
                        className={`nav-item h-10 w-full text-left cursor-pointer ${on ? "on" : ""}`}
                      >
                        <g.icon size={20} active={on} className="ic" />
                        <span className="flex-1 text-[14px] font-medium">{g.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          ) : (
            <nav key="main" aria-label="Main" className="flex-1 overflow-auto">
              <ul className="space-y-1">{NAV.map(link)}</ul>
              <div className="nav-heading">Library</div>
              <ul className="space-y-0.5">
                {filterLink("pinned", "Pinned", Pin as NavIcon, counts.pinned)}
                {filterLink("agents", "Coding agents", Bot as NavIcon, counts.agents)}
                {filterLink("web", "Web chats", Globe as NavIcon, counts.web)}
                {filterLink("hidden", "Hidden", Archive as NavIcon)}
              </ul>
              <div className="nav-heading">Tools</div>
              <ul className="space-y-0.5">
                {small("compare", "Compare sessions", GitBranch as NavIcon, () => navigate({ page: "compare" }), route.page === "compare", undefined, "Compare two sessions side by side")}
                {small("latest", "Copy latest session", Copy as NavIcon, () => void api.copyLatest().catch(() => undefined), false, undefined, "Copy your most recent session with your defaults")}
                {small(
                  "import",
                  "Import bundle",
                  FileUp as NavIcon,
                  async () => {
                    const ids = await importHandoffFile();
                    if (ids?.[0]) navigate({ page: "sessions", id: ids[0] });
                  },
                  false,
                  undefined,
                  "Open a .hopilo, .handoff or .json file",
                )}
                {small("browser", "Browser extension", BrowserIcon, () => navigate({ page: "browser" }), route.page === "browser")}
              </ul>
            </nav>
          )}
          <div className="space-y-2 pt-2">
            {route.page !== "settings" && <ul>{link({ page: "settings", label: "Settings", icon: SettingsIcon, hint: "Preferences" })}</ul>}
            <LibraryCard />
          </div>
        </aside>

        <main className="cleanly-main">
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
