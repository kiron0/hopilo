import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { isMac } from "../lib/platform";
import { api } from "../lib/api";
import { captureClipboard, copySessions } from "../lib/actions";
import { basename, provider, relativeTime } from "../lib/format";
import { useBootstrap, useDebouncedValue, useLoad } from "../lib/hooks";
import { useApp } from "../lib/store";
import { target } from "../lib/targets";
import { Toasts } from "../components/Toasts";
import { IconButton, Kbd, ProviderBadge, Skeleton, cx } from "../components/ui";
import { CaptureIcon, OverviewIcon, Paperclip, Pin, Plus, SearchIcon, SettingsIcon, Copy, Loader2, Power } from "../components/Icons";
import { BackgroundLayer } from "../components/Flow";
import { prettyShortcut } from "../components/HandoffSettings";

function buildPopoverPath(w: number, h: number, anchorX: number | null, mac: boolean): string {
  const r = 18;
  if (!mac) {
    return `M ${r} 0 L ${w - r} 0 Q ${w} 0 ${w} ${r} L ${w} ${h - r} Q ${w} ${h} ${w - r} ${h} L ${r} ${h} Q 0 ${h} 0 ${h - r} L 0 ${r} Q 0 0 ${r} 0 Z`;
  }

  const top = 12;
  const halfW = 16;
  const targetX = anchorX ?? w / 2;
  const ax = Math.max(r + halfW, Math.min(targetX, w - r - halfW));

  return [
    `M ${r} ${top}`,
    `L ${ax - halfW} ${top}`,
    `C ${ax - 14.0} ${top}, ${ax - 12.0} ${top - 0.9}, ${ax - 10.4} ${top - 2.4}`,
    `L ${ax - 4.0} ${top - 9.2}`,
    `C ${ax - 1.8} ${top - 11.8}, ${ax + 1.8} ${top - 11.8}, ${ax + 4.0} ${top - 9.2}`,
    `L ${ax + 10.4} ${top - 2.4}`,
    `C ${ax + 12.0} ${top - 0.9}, ${ax + 14.0} ${top}, ${ax + halfW} ${top}`,
    `L ${w - r} ${top}`,
    `Q ${w} ${top} ${w} ${top + r}`,
    `L ${w} ${h - r}`,
    `Q ${w} ${h} ${w - r} ${h}`,
    `L ${r} ${h}`,
    `Q 0 ${h} 0 ${h - r}`,
    `L 0 ${top + r}`,
    `Q 0 ${top} ${r} ${top}`,
    `Z`,
  ].join(" ");
}

export function QuickPanel() {
  const ready = useBootstrap();
  const settings = useApp((s) => s.settings);
  const sessions = useLoad(() => api.listSessions());
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q);
  const [busy, setBusy] = useState<string | null>(null);
  const [anchorX, setAnchorX] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 448, h: 610 });

  useEffect(() => {
    if (!containerRef.current) return;
    const updateSize = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        if (clientWidth > 0 && clientHeight > 0) {
          setSize({ w: clientWidth, h: clientHeight });
        }
      }
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const popoverPath = useMemo(
    () => buildPopoverPath(size.w, size.h, anchorX, isMac),
    [size.w, size.h, anchorX]
  );

  useEffect(() => {
    let un: (() => void) | undefined;
    let disposed = false;
    listen<number>("hopilo://quick-anchor", ({ payload }) => setAnchorX(payload - 10)).then((f) => {
      if (disposed) f();
      else un = f;
    });

    const unFocus = getCurrentWindow().onFocusChanged(({ payload }) => {
      if (payload) sessions.reload();
    });

    return () => {
      disposed = true;
      un?.();
      unFocus.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && getCurrentWindow().hide();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const needle = debouncedQ.trim().toLowerCase();
  const recent = (sessions.data ?? [])
    .filter((s) => !needle || s.title.toLowerCase().includes(needle) || provider(s.provider).label.toLowerCase().includes(needle))
    .slice(0, needle ? 12 : 8);

  if (!ready) return null;

  const row = "nav-item h-auto min-h-10 w-full py-1.5 text-left text-[13px] focus-visible:bg-surface focus-visible:shadow-item disabled:opacity-50";
  const bg = settings.background ?? "mist";
  const copy = async (id: string) => {
    setBusy(id);
    await copySessions([id], { excludeSecrets: settings.shortcutRedact });
    setBusy(null);
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
    >
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        style={{ filter: "drop-shadow(0 10px 24px rgba(0, 0, 0, 0.35)) drop-shadow(0 2px 6px rgba(0, 0, 0, 0.15))" }}
        aria-hidden
      >
        <path d={popoverPath} fill="var(--canvas, #000)" />
      </svg>
      <svg width="0" height="0" className="absolute pointer-events-none" aria-hidden>
        <defs>
          <clipPath id="quick-panel-clip" clipPathUnits="userSpaceOnUse">
            <path d={popoverPath} />
          </clipPath>
        </defs>
      </svg>

      <svg className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible" aria-hidden>
        <path d={popoverPath} fill="none" stroke="var(--border)" strokeWidth="1" />
      </svg>

      <div
        className="quick-shell app relative isolate flex h-full flex-col text-[13px]"
        data-bg={bg}
        style={{
          clipPath: "url(#quick-panel-clip)",
          WebkitClipPath: "url(#quick-panel-clip)",
        }}
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
        <BackgroundLayer />

        <header className={cx("relative z-10 flex shrink-0 items-center gap-2.5 px-4 pb-3", isMac ? "pt-5" : "pt-3.5")}>
          <img src="/hopilo-mark.svg" alt="" className="h-7 w-7 drop-shadow-[0_3px_6px_rgb(40_30_120/0.25)]" draggable={false} />
          <span className="font-display flex-1 text-[16px] font-semibold">Hopilo</span>
          <IconButton label="Settings" onClick={() => api.showMainWindow("settings")}>
            <SettingsIcon size={17} />
          </IconButton>
        </header>

      <div className="relative z-10 shrink-0 px-3 pb-2.5">
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

      <div className="relative z-10 mx-2 mb-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[16px] border border-line bg-canvas shadow-card">
        <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
          <div className="label-mono flex items-center justify-between gap-2 px-3 pt-1 pb-1.5 text-faint">
            <span className="truncate">Tap to copy for {target(settings.defaultTarget).label}</span>
            {settings.globalShortcut && (
              <span className="flex shrink-0 items-center gap-0.5 normal-case" title="Copies the latest session from any app">
                {prettyShortcut(settings.globalShortcut).map((k) => <Kbd key={k}>{k}</Kbd>)}
              </span>
            )}
          </div>
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
                <span className="flex items-center gap-1.5 truncate font-medium text-ink">
                  <span className="truncate">{s.title}</span>
                  {s.pinned && <Pin size={10} filled className="shrink-0 text-accent fill-current" />}
                </span>
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
          {sessions.data && recent.length === 0 && (
            <div className="flex min-h-[120px] flex-col items-center justify-center px-4 py-6 text-center text-faint">
              {needle ? "No matching sessions." : "No sessions yet."}
            </div>
          )}

          <div className="label-mono px-3 pt-3 pb-1.5 text-faint">Add</div>
          <button type="button" data-row className={row} onClick={() => captureClipboard()}>
            <span className="text-faint"><CaptureIcon size={17} /></span> <span className="flex-1">Save clipboard as a session</span>
          </button>
          <button type="button" data-row className={row} onClick={() => api.showMainWindow("sessions")}>
            <span className="text-faint"><Plus size={17} /></span> <span className="flex-1">Paste, import or add files…</span>
          </button>
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-line bg-surface-2 px-3 py-2.5">
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
    </div>
  );
}
