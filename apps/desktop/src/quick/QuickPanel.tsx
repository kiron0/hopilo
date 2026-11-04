import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Loader2, Power } from "lucide-react";
import { api, type DiscoveredRow, type PackRow } from "../lib/api";
import { captureClipboard, copyHandoff, quickHandoff } from "../lib/actions";
import { basename, provider, relativeTime } from "../lib/format";
import { useBootstrap, useLoad } from "../lib/hooks";
import { useApp } from "../lib/store";
import { target } from "../lib/targets";
import { Toasts } from "../components/Toasts";
import { Button, IconButton, Kbd, Skeleton } from "../components/ui";
import { CaptureIcon, FilesIcon, HomeIcon, PacksIcon, SearchIcon, SendIcon, SettingsIcon } from "../components/Icons";
import { ProviderBadge } from "../pages/Dashboard";

/** Compact menu-bar panel: capture, recent items, one-tap copy. No sidebar. */
export function QuickPanel() {
  const ready = useBootstrap();
  const settings = useApp((s) => s.settings);
  const sessions = useLoad(() => api.discoverSessions(), [], { refreshOnChange: false });
  const packs = useLoad(() => api.listPacks());
  const [selected, setSelected] = useState<PackRow | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // Refresh when the panel is shown again.
  useEffect(() => {
    const un = getCurrentWindow().onFocusChanged(({ payload }) => {
      if (payload) {
        sessions.reload();
        packs.reload();
      }
    });
    return () => {
      un.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && getCurrentWindow().hide();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const needle = q.trim().toLowerCase();
  const recentPacks = (packs.data ?? []).filter((p) => !p.archived && (!needle || p.title.toLowerCase().includes(needle))).slice(0, 4);
  const recentSessions = (sessions.data ?? []).filter((s) => !needle || s.title.toLowerCase().includes(needle)).slice(0, 4);
  const sel = selected ?? recentPacks[0] ?? null;

  if (!ready) return null;

  // Rows share the dashboard sidebar's look: quiet until hovered or chosen,
  // then a raised white pill.
  const row = "nav-item h-auto min-h-10 w-full py-1.5 text-left text-[13px] focus-visible:bg-surface focus-visible:shadow-item disabled:opacity-50";
  const runSession = async (s: DiscoveredRow) => {
    setBusy(s.path);
    await quickHandoff(s.adapter, s.path);
    setBusy(null);
  };

  return (
    <div
      className="quick-shell relative isolate flex h-full flex-col overflow-hidden rounded-[18px] border border-line text-[13px]"
      onKeyDown={(e) => {
        // Arrow keys move between rows, like a native menu.
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-row]:not(:disabled)"));
        const i = rows.indexOf(document.activeElement as HTMLElement);
        const next = e.key === "ArrowDown" ? rows[Math.min(rows.length - 1, i + 1)] : rows[Math.max(0, i - 1)];
        if (next) {
          e.preventDefault();
          next.focus();
        }
      }}
    >
      <div aria-hidden className="app-aura app-aura-contained">
        <span />
        <span />
        <span />
      </div>

      <header className="flex shrink-0 items-center gap-2.5 px-4 pt-3.5 pb-3">
        <img src="/hopilo-mark.svg" alt="" className="h-7 w-7 drop-shadow-[0_3px_6px_rgb(40_30_120/0.25)]" draggable={false} />
        <span className="font-display flex-1 text-[16px] font-semibold">Hopilo</span>
        <IconButton label="Settings" onClick={() => api.showMainWindow("settings")}>
          <SettingsIcon size={17} />
        </IconButton>
      </header>

      <div className="shrink-0 px-3 pb-2.5">
        <label className="flex h-8.5 items-center gap-2 rounded-full border border-line bg-card px-3 text-faint shadow-item focus-within:border-accent">
          <SearchIcon size={14} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search recent"
            className="min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-ink outline-none placeholder:text-faint"
          />
          <Kbd>esc</Kbd>
        </label>
      </div>

      <div className="mx-2 mb-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[16px] border border-line bg-canvas/80 shadow-card">
        <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
          <div className="label-mono px-3 pt-1 pb-1.5 text-faint">Capture</div>
          <button type="button" data-row className={row} onClick={() => captureClipboard()}>
            <span className="text-faint"><CaptureIcon size={17} /></span> <span className="flex-1">Capture clipboard</span>
          </button>
          <button type="button" data-row className={row} onClick={() => api.showMainWindow("capture")}>
            <span className="text-faint"><FilesIcon size={17} /></span> <span className="flex-1">Import file or text…</span>
          </button>

          <div className="label-mono px-3 pt-3 pb-1.5 text-faint">Continue agent session</div>
          {sessions.loading && !sessions.data &&
            [0, 1, 2].map((i) => (
              <div key={i} aria-hidden className="flex items-center gap-2.5 px-3 py-2">
                <Skeleton className="h-[22px] w-[22px] rounded-[7px]" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-3" style={{ width: `${75 - i * 12}%` }} />
                  <Skeleton className="h-2.5 w-2/5" />
                </div>
              </div>
            ))}
          {recentSessions.map((s) => (
            <button key={s.path} type="button" data-row className={row} disabled={!!busy} onClick={() => runSession(s)} title={`Copy a handoff for ${target(settings.defaultTarget).label}`}>
              <ProviderBadge id={s.adapter} size={22} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{s.title}</span>
                <span className="block truncate font-mono text-[10.5px] text-faint">{basename(s.project) || provider(s.adapter).label} · {relativeTime(s.modifiedAt)}</span>
              </span>
              {busy === s.path ? <Loader2 size={13} className="animate-spin text-accent" /> : <Copy size={13} className="text-faint" />}
            </button>
          ))}
          {sessions.data && recentSessions.length === 0 && <div className="px-3 py-1.5 text-faint">No sessions found.</div>}

          <div className="label-mono px-3 pt-3 pb-1.5 text-faint">Recent packs</div>
          {recentPacks.map((p) => (
            <button key={p.id} type="button" data-row aria-current={sel?.id === p.id ? "page" : undefined} className={row} onClick={() => setSelected(p)}>
              <span className={sel?.id === p.id ? "text-accent" : "text-faint"}>
                <PacksIcon size={17} active={sel?.id === p.id} />
              </span>
              <span className="min-w-0 flex-1 truncate">{p.title}</span>
              <span className="font-mono text-[10.5px] text-faint">v{p.latestVersion}</span>
            </button>
          ))}
          {packs.data && recentPacks.length === 0 && <div className="px-3 py-1.5 text-faint">No packs yet.</div>}
        </div>

        {sel && (
          <div className="shrink-0 border-t border-line px-3 py-3">
            <div className="mb-2 truncate text-[12px] text-muted">
              Selected: <span className="font-medium text-ink">{sel.title}</span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="primary"
                className="flex-1"
                icon={<Copy size={14} />}
                onClick={() => copyHandoff(sel.id, sel.latestVersion, settings.defaultTarget, settings.toolDetail, settings.level)}
              >
                Copy for {target(settings.defaultTarget).label}
              </Button>
              <Button icon={<SendIcon size={14} />} onClick={() => api.showMainWindow("handoff")}>
                Review
              </Button>
            </div>
          </div>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-between px-3 pb-2.5 text-[12.5px]">
        <button type="button" className="nav-item h-8 gap-2 px-2.5 text-[12.5px]" onClick={() => api.showMainWindow()}>
          <span className="text-faint"><HomeIcon size={15} /></span> Open Dashboard
        </button>
        <button type="button" className="nav-item h-8 gap-2 px-2.5 text-[12.5px] hover:text-danger" onClick={() => api.quit()}>
          <Power size={14} /> Quit
        </button>
      </footer>
      <Toasts />
    </div>
  );
}
