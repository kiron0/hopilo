import { type ReactNode, useEffect } from "react";
import { BuildIcon, CaptureIcon, FilesIcon, HomeIcon, PacksIcon, SearchIcon, SendIcon, SessionsIcon, SettingsIcon, ToolsIcon, BrowserIcon, MapIcon } from "./Icons";
import { api } from "../lib/api";
import { bytes } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { type Route, useApp } from "../lib/store";
import { Kbd, Skeleton } from "./ui";
import { CommandPalette } from "./CommandPalette";
import { Toasts } from "./Toasts";

type NavIcon = (p: { size?: number; active?: boolean }) => ReactNode;
type NavItem = { page: Route["page"]; label: string; icon: NavIcon; hint: string };

const GROUPS: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { page: "dashboard", label: "Home", icon: HomeIcon, hint: "Overview and quick actions" },
      { page: "capture", label: "Capture", icon: CaptureIcon, hint: "Bring in a chat, text or files" },
    ],
  },
  {
    title: "Library",
    items: [
      { page: "sessions", label: "Sessions", icon: SessionsIcon, hint: "Conversations found or captured" },
      { page: "packs", label: "Packs", icon: PacksIcon, hint: "Ready-to-share context, with versions" },
      { page: "map", label: "Context Map", icon: MapIcon, hint: "Arrange, merge and split packs" },
      { page: "attachments", label: "Files", icon: FilesIcon, hint: "Files you added" },
    ],
  },
  {
    title: "Workflows",
    items: [
      { page: "builder", label: "Build a pack", icon: BuildIcon, hint: "Combine sessions, files and notes" },
      { page: "handoff", label: "Send to AI", icon: SendIcon, hint: "Review, then copy or export" },
    ],
  },
  {
    title: "Connect",
    items: [
      { page: "agents", label: "AI tools", icon: ToolsIcon, hint: "Supported apps and agents" },
      { page: "browser", label: "Browser", icon: BrowserIcon, hint: "Extension for ChatGPT, Claude and Gemini" },
    ],
  },
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
        <div className="bg-brand h-full rounded-full" style={{ width: s ? `${Math.min(100, 8 + s.packCount * 6)}%` : "8%" }} />
      </div>
      {s ? <div className="mt-1.5 text-[11px] text-muted">{`${s.packCount} packs · ${s.sourceCount} sessions`}</div> : <Skeleton className="mt-2 h-2.5 w-2/3" />}
      <div className="text-[11px] text-faint">Stays on this Mac</div>
    </button>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const route = useApp((s) => s.route);
  const navigate = useApp((s) => s.navigate);
  const draftCount = useApp((s) => s.draft.items.length);
  const setPaletteOpen = useApp((s) => s.setPaletteOpen);

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
        <button type="button" aria-current={active ? "page" : undefined} onClick={() => navigate({ page: it.page } as Route)} className="nav-item w-full text-left">
          <span className={active ? "text-accent" : "text-faint"}>
            <it.icon size={18} active={active} />
          </span>
          <span className="flex-1">{it.label}</span>
          {it.page === "builder" && draftCount > 0 && (
            <span className="rounded-full bg-accent-soft px-1.5 font-mono text-[10.5px] font-semibold text-accent">{draftCount}</span>
          )}
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
        <div data-tauri-drag-region className="h-11 shrink-0" />
        <div data-tauri-drag-region className="flex items-center gap-2.5 px-2 pb-5">
          <img src="/hopilo-mark.png" alt="" className="h-7 w-7 rounded-lg shadow-card" draggable={false} />
          <span data-tauri-drag-region className="font-display text-[17px] font-semibold">Hopilo</span>
        </div>
        <nav aria-label="Main" className="flex-1 overflow-auto">
          {GROUPS.map((g, i) => (
            <div key={i} className="mb-4">
              {g.title && <div className="label-mono mb-1.5 px-3 text-faint">{g.title}</div>}
              <ul className="space-y-1">{g.items.map(link)}</ul>
            </div>
          ))}
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
            <span className="flex-1 text-left font-mono text-[11.5px]">search everything</span>
            <SearchIcon size={14} />
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto max-w-[1180px] px-7 pt-1 pb-12">{children}</div>
        </main>
      </div>
      <CommandPalette />
      <Toasts />
    </div>
  );
}
