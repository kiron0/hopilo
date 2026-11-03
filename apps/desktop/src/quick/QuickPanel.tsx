import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ClipboardPaste, Copy, LayoutDashboard, Loader2, Power, Search, Settings, SquarePlus } from "lucide-react";
import { api, type DiscoveredRow, type PackRow } from "../lib/api";
import { captureClipboard, copyHandoff, quickHandoff } from "../lib/actions";
import { basename, provider, relativeTime } from "../lib/format";
import { useBootstrap, useLoad } from "../lib/hooks";
import { useApp } from "../lib/store";
import { target } from "../lib/targets";
import { Toasts } from "../components/Toasts";
import { cx, Kbd, Skeleton } from "../components/ui";
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

  const row = "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left transition-[background-color,box-shadow] hover:bg-surface hover:shadow-item focus-visible:bg-surface";
  const runSession = async (s: DiscoveredRow) => {
    setBusy(s.path);
    await quickHandoff(s.adapter, s.path);
    setBusy(null);
  };

  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-[14px] border border-line bg-canvas text-[13px]"
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
      <header className="flex items-center gap-2 px-3 pt-3 pb-1">
        <img src="/hopilo-mark.png" alt="" className="h-5 w-5 rounded" draggable={false} />
        <span className="font-display flex-1 text-[14px] font-semibold">Hopilo</span>
        <button type="button" aria-label="Settings" className="rounded-lg p-1 text-muted hover:bg-surface hover:text-ink" onClick={() => api.showMainWindow("settings")}>
          <Settings size={15} />
        </button>
      </header>

      <div className="px-3 pt-2.5">
        <div className="relative">
          <Search size={13} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search recent"
            aria-label="Search recent"
            className="h-8 w-full rounded-[10px] border border-line bg-surface pr-2 pl-8 text-[12.5px] shadow-item outline-none focus:border-accent"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        <div className="px-2.5 pt-1 pb-1 label-mono text-faint">Capture</div>
        <button type="button" data-row className={row} onClick={() => captureClipboard()}>
          <ClipboardPaste size={15} className="text-muted" /> <span className="flex-1">Capture clipboard</span>
        </button>
        <button type="button" data-row className={row} onClick={() => api.showMainWindow("capture")}>
          <SquarePlus size={15} className="text-muted" /> <span className="flex-1">Import file / text…</span>
        </button>

        <div className="px-2.5 pt-3 pb-1 label-mono text-faint">Continue agent session</div>
        {sessions.loading && !sessions.data &&
          [0, 1, 2].map((i) => (
            <div key={i} aria-hidden className="flex items-center gap-2.5 px-2.5 py-1.5">
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
              <span className="block truncate">{s.title}</span>
              <span className="block truncate text-[11px] text-faint">{basename(s.project) || provider(s.adapter).label} · {relativeTime(s.modifiedAt)}</span>
            </span>
            {busy === s.path ? <Loader2 size={13} className="animate-spin text-accent" /> : <Copy size={13} className="text-faint" />}
          </button>
        ))}
        {sessions.data && recentSessions.length === 0 && <div className="px-2.5 py-1 text-faint">No sessions found.</div>}

        <div className="px-2.5 pt-3 pb-1 label-mono text-faint">Recent packs</div>
        {recentPacks.map((p) => (
          <button key={p.id} type="button" data-row aria-pressed={sel?.id === p.id} className={cx(row, sel?.id === p.id && "bg-surface font-medium shadow-item")} onClick={() => setSelected(p)}>
            <span className={cx("h-2 w-2 shrink-0 rounded-full border", sel?.id === p.id ? "border-accent bg-accent" : "border-line-strong")} />
            <span className="min-w-0 flex-1 truncate">{p.title}</span>
            <span className="text-[11px] text-faint">v{p.latestVersion}</span>
          </button>
        ))}
        {packs.data && recentPacks.length === 0 && <div className="px-2.5 py-1 text-faint">No packs yet.</div>}
      </div>

      {sel && (
        <div className="border-t border-line px-3 py-2.5">
          <div className="mb-2 truncate text-[12px] text-muted">
            Selected: <span className="text-ink">{sel.title}</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => copyHandoff(sel.id, sel.latestVersion, settings.defaultTarget, settings.toolDetail, settings.level)}
              className="bg-brand flex h-8.5 flex-1 items-center justify-center gap-1.5 rounded-full font-medium text-white shadow-brand hover:brightness-110"
            >
              <Copy size={14} /> Copy for {target(settings.defaultTarget).label}
            </button>
            <button type="button" onClick={() => api.showMainWindow("handoff")} className="h-8.5 rounded-full border border-line bg-surface px-3.5 shadow-item hover:border-line-strong">
              Review
            </button>
          </div>
        </div>
      )}

      <footer className="flex items-center justify-between border-t border-line px-3 py-2 text-[12.5px]">
        <button type="button" className="flex items-center gap-1.5 text-muted hover:text-ink" onClick={() => api.showMainWindow()}>
          <LayoutDashboard size={14} /> Open Dashboard
        </button>
        <span className="text-faint"><Kbd>esc</Kbd></span>
        <button type="button" className="flex items-center gap-1.5 text-muted hover:text-danger" onClick={() => api.quit()}>
          <Power size={14} /> Quit
        </button>
      </footer>
      <Toasts />
    </div>
  );
}
