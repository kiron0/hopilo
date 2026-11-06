import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../lib/api";
import { captureClipboard, copySessions } from "../lib/actions";
import { basename, provider, relativeTime } from "../lib/format";
import { useBootstrap, useLoad } from "../lib/hooks";
import { useApp } from "../lib/store";
import { target } from "../lib/targets";
import { Toasts } from "../components/Toasts";
import { IconButton, Kbd, ProviderBadge, Skeleton } from "../components/ui";
import { CaptureIcon, OverviewIcon, Paperclip, Plus, SearchIcon, SettingsIcon, Copy, Loader2, Power } from "../components/Icons";

export function QuickPanel() {
  const ready = useBootstrap();
  const settings = useApp((s) => s.settings);
  const sessions = useLoad(() => api.listSessions());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const un = getCurrentWindow().onFocusChanged(({ payload }) => {
      if (payload) sessions.reload();
    });
    return () => {
      un.then((f) => f());
    };

  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && getCurrentWindow().hide();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const needle = q.trim().toLowerCase();
  const recent = (sessions.data ?? [])
    .filter((s) => !needle || s.title.toLowerCase().includes(needle) || provider(s.provider).label.toLowerCase().includes(needle))
    .slice(0, needle ? 12 : 8);

  if (!ready) return null;

  const row = "nav-item h-auto min-h-10 w-full py-1.5 text-left text-[13px] focus-visible:bg-surface focus-visible:shadow-item disabled:opacity-50";
  const copy = async (id: string) => {
    setBusy(id);
    await copySessions([id]);
    setBusy(null);
  };

  return (
    <div
      className="quick-shell relative isolate flex h-full flex-col overflow-hidden rounded-[18px] border border-line text-[13px]"
      onKeyDown={(e) => {

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
      <div aria-hidden className="app-aura app-aura-contained overflow-hidden rounded-[17px]">
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
            aria-label="Search sessions"
            placeholder="Search sessions"
            className="min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-ink outline-none placeholder:text-faint"
          />
          <Kbd>esc</Kbd>
        </label>
      </div>

      <div className="mx-2 mb-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[16px] border border-line bg-canvas/80 shadow-card">
        <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
          <div className="label-mono px-3 pt-1 pb-1.5 text-faint">Tap to copy for {target(settings.defaultTarget).label}</div>
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
          {recent.map((s) => (
            <button key={s.id} type="button" data-row className={row} disabled={!!busy} onClick={() => copy(s.id)} title={`Copy for ${target(settings.defaultTarget).label}`}>
              <ProviderBadge id={s.provider} size={22} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{s.title}</span>
                <span className="flex items-center gap-1.5 truncate font-mono text-[10.5px] text-faint">
                  {basename(s.project) || provider(s.provider).label} · {relativeTime(s.updatedAt)}
                  {s.fileCount > 0 && (
                    <span className="inline-flex items-center gap-0.5">
                      · <Paperclip size={10} /> {s.fileCount}
                    </span>
                  )}
                </span>
              </span>
              {busy === s.id ? <Loader2 size={13} className="animate-spin text-accent" /> : <Copy size={13} className="text-faint" />}
            </button>
          ))}
          {sessions.data && recent.length === 0 && <div className="px-3 py-1.5 text-faint">{needle ? "No matching sessions." : "No sessions yet."}</div>}

          <div className="label-mono px-3 pt-3 pb-1.5 text-faint">Add</div>
          <button type="button" data-row className={row} onClick={() => captureClipboard()}>
            <span className="text-faint"><CaptureIcon size={17} /></span> <span className="flex-1">Save clipboard as a session</span>
          </button>
          <button type="button" data-row className={row} onClick={() => api.showMainWindow("sessions")}>
            <span className="text-faint"><Plus size={17} /></span> <span className="flex-1">Paste, import or add files…</span>
          </button>
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-line bg-surface-2/40 px-3 py-2.5">
          <button
            type="button"
            onClick={() => api.showMainWindow()}
            className="flex h-9 flex-1 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 text-[12.5px] font-medium text-ink shadow-xs transition-colors hover:border-line-strong hover:bg-surface-2 active:bg-surface-3 cursor-pointer"
          >
            <OverviewIcon size={13} className="text-accent" />
            <span>Open Hopilo</span>
          </button>
          <button
            type="button"
            onClick={() => api.quit()}
            title="Quit Hopilo"
            className="flex h-9 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-4 text-[12.5px] font-medium text-muted shadow-xs transition-colors hover:border-danger/40 hover:bg-danger-soft hover:text-danger active:bg-danger-soft/80 cursor-pointer"
          >
            <Power size={14} />
            <span>Quit</span>
          </button>
        </footer>
      </div>

      <Toasts />
    </div>
  );
}
