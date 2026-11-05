import { useEffect, useMemo, useState } from "react";
import { api, type SessionRow } from "../lib/api";
import { copySessions } from "../lib/actions";
import { basename, plural, provider, relativeTime } from "../lib/format";
import { prefetch, saveSetting, useLoad } from "../lib/hooks";
import { useApp } from "../lib/store";
import { target } from "../lib/targets";
import { deviceNoun } from "../lib/platform";
import { Button, Card, cx, ProviderBadge, Skeleton } from "../components/ui";
import { RowSkeleton } from "../components/Skeletons";
import { AddSessionModal } from "../components/AddSession";
import { sessionLoader } from "./Sessions";
import { ArrowRight, Bot, ChevronRight, ClipboardCheck, Copy, Globe, MessagesSquare, Send, ShieldCheck, X } from "../components/Icons";
import { Flow } from "../components/Flow";

const SLOTS = [
  { x: 50, y: 46 },
  { x: 20, y: 30 },
  { x: 80, y: 30 },
  { x: 22, y: 74 },
  { x: 78, y: 72 },
  { x: 50, y: 88 },
];

const BUBBLE_PALETTE = [
  { c1: "#6d7bff", c2: "#a77bff", sh: "109, 123, 255" },
  { c1: "#4f9bff", c2: "#7fd3ff", sh: "79, 155, 255" },
  { c1: "#a77bff", c2: "#ff8fc8", sh: "167, 123, 255" },
  { c1: "#3fd6a0", c2: "#5fc6ff", sh: "63, 190, 170" },
  { c1: "#8e95b8", c2: "#b8a8ff", sh: "120, 125, 170" },
  { c1: "#ff8fc8", c2: "#c48cff", sh: "220, 120, 200" },
];

function SourcesMap({ sessions, loading }: { sessions: SessionRow[]; loading: boolean }) {
  const navigate = useApp((s) => s.navigate);
  const setListView = useApp((s) => s.setListView);
  const bubbles = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sessions) counts.set(s.provider, (counts.get(s.provider) ?? 0) + 1);
    const list = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, SLOTS.length);
    const max = Math.max(1, ...list.map(([, n]) => n));
    return list.map(([id, n], i) => ({ id, n, slot: SLOTS[i], size: 62 + Math.sqrt(n / max) * (i === 0 ? 68 : 42) }));
  }, [sessions]);

  return (
    <Card className="card-w flex flex-col p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-[15px]">Sources map</h2>
        <button
          type="button"
          onClick={() => navigate({ page: "sessions", filter: "all" })}
          className="group flex items-center gap-1 rounded-full border border-line bg-surface/80 px-3 py-1 text-[12px] font-medium text-muted shadow-item transition-all hover:-translate-y-px hover:border-line-strong hover:bg-surface hover:text-ink hover:shadow-card active:scale-[0.98]"
        >
          <span>Open</span>
          <ChevronRight size={13} className="text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
        </button>
      </div>
      <div className="bubbles relative mt-2 min-h-[210px] flex-1" role="list" aria-label="Sessions by tool">
        {loading && bubbles.length === 0 && (
          <div className="map-skel" aria-hidden="true">
            {SLOTS.slice(0, 5).map((sl, i) => (
              <i
                key={i}
                style={{
                  left: `${sl.x}%`,
                  top: `${sl.y}%`,
                  width: i === 0 ? 120 : 80 - i * 6,
                  height: i === 0 ? 120 : 80 - i * 6,
                  animationDelay: `${-i * 0.4}s`,
                }}
              />
            ))}
          </div>
        )}
        {!loading && bubbles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-center text-muted">
            Your sources appear here after the first scan.
          </div>
        )}
        {bubbles.map((b, i) => {
          const pal = BUBBLE_PALETTE[i % BUBBLE_PALETTE.length];
          const d = b.size;
          const style = {
            left: `${b.slot.x}%`,
            top: `${b.slot.y}%`,
            width: `${d}px`,
            height: `${d}px`,
            transform: "translate(-50%, -50%)",
            "--c1": pal.c1,
            "--c2": pal.c2,
            "--rgb": pal.sh,
            "--bsh": `rgba(${pal.sh}, 0.25)`,
            "--shadow": `rgba(${pal.sh}, 0.25)`,
            "--inner": `rgba(${pal.sh}, 0.08)`,
            "--chip": `${Math.round(Math.max(24, Math.min(42, d * 0.28)))}px`,
            "--spin": `${11 + (i % 3) * 2.5}s`,
            "--dur": `${5.5 + (i % 3) * 0.8}s`,
            "--delay": `${-i * 0.7}s`,
          } as React.CSSProperties;
          const small = d < 80;

          return (
            <div
              key={b.id}
              role="listitem"
              className={cx("bubble", small && "small")}
              style={style}
            >
              <div className="b-float">
                <button
                  type="button"
                  onClick={() => {
                    navigate({ page: "sessions", filter: "all" });
                    setListView({ q: provider(b.id).label });
                  }}
                  className="disc"
                  title={`${provider(b.id).label}: ${plural(b.n, "session")}`}
                >
                  <span className="b-ico img">
                    <ProviderBadge id={b.id} size={d > 95 ? 24 : 18} />
                  </span>
                  <b>{provider(b.id).label}</b>
                  <span className="sz">{b.n}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="map-foot mt-auto flex items-center gap-2 pt-3 text-[12px] text-faint">
        <span className="hot-key" />
        <span>Bubble size = number of sessions</span>
      </div>
    </Card>
  );
}

const PARTICLES = [
  { left: "4%", top: "45%", width: 11, height: 11, filter: "blur(2.5px)", "--fd": "2.4s" },
  { left: "18%", top: "62%", width: 8, height: 8, filter: "blur(1.5px)", "--fd": "3s", "--fdl": "-0.6s" },
  { left: "32%", top: "38%", width: 13, height: 13, filter: "blur(3.5px)", "--fd": "2.7s", "--fdl": "-1.2s" },
  { left: "52%", top: "58%", width: 7, height: 7, filter: "blur(1px)", "--fd": "2.2s", "--fdl": "-0.3s" },
  { left: "72%", top: "42%", width: 9, height: 9, filter: "blur(2px)", "--fd": "2.6s", "--fdl": "-0.9s" },
  { left: "86%", top: "65%", width: 12, height: 12, filter: "blur(3.5px)", "--fd": "2.9s", "--fdl": "-2.1s" },
] as const;

const EMBERS = [
  { left: "18%", "--ed": "3.2s", "--edl": "0s" },
  { left: "36%", "--ed": "2.6s", "--edl": "-1.1s" },
  { left: "55%", "--ed": "3.6s", "--edl": "-2s" },
  { left: "72%", "--ed": "2.9s", "--edl": "-0.6s" },
  { left: "88%", "--ed": "3.4s", "--edl": "-1.7s" },
] as const;

interface TileProps {
  tone: "c-blue" | "c-violet" | "c-green" | "c-crimson";
  icon: React.ReactNode;
  title: string;
  value: string;
  unit: string;
  caption: string;
  action: string;
  onClick: () => void;
  loading?: boolean;
  delay?: number;
  glowStyle?: React.CSSProperties;
  effect?: "shine" | "particles" | "embers";
}

function Tile({
  tone,
  icon,
  title,
  value,
  unit,
  caption,
  action,
  onClick,
  loading,
  delay = 0.24,
  glowStyle,
  effect = "shine",
}: TileProps) {
  return (
    <article
      className={cx("lc rise min-h-[175px]", tone)}
      style={{ animationDelay: `${delay}s` }}
    >
      <span className="glow" style={glowStyle} />
      {effect === "shine" && <span className="shine" />}
      {effect === "particles" && (
        <div className="parts" aria-hidden="true">
          {PARTICLES.map((s, i) => (
            <i key={i} style={s as React.CSSProperties} />
          ))}
        </div>
      )}
      {effect === "embers" && (
        <>
          {EMBERS.map((s, i) => (
            <i key={i} className="ember" style={s as React.CSSProperties} />
          ))}
        </>
      )}
      <div className="lc-top">
        <span className="glass-ico">{icon}</span>
        <b>{title}</b>
      </div>
      {loading ? (
        <div aria-hidden className="lc-num">
          <span className="inline-block h-9 w-20 rounded-xl bg-white/20 animate-pulse" />
        </div>
      ) : (
        <div className="lc-num">
          <strong>{value}</strong>
          <em>{unit}</em>
        </div>
      )}
      <div className="lc-sub">{caption}</div>
      <div className="lc-foot">
        <button
          type="button"
          onClick={onClick}
          className="pill group cursor-pointer"
        >
          <span>{action}</span>
          <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    </article>
  );
}

const STEPS = [
  {
    icon: <Bot size={16} />,
    title: "Pick a session",
    body: "From a coding agent (Claude Code, Codex, Aider) or a web chat.",
  },
  {
    icon: <ClipboardCheck size={16} />,
    title: "Choose how much",
    body: "Full, Balanced, or Minimal. Files and attachments stay intact.",
  },
  {
    icon: <Send size={16} />,
    title: "Universal handoff",
    body: "Hopilo copies one ready prompt pack. Paste into any AI and send.",
  },
];

function RecentRow({ row }: { row: SessionRow }) {
  const navigate = useApp((s) => s.navigate);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <ProviderBadge id={row.provider} />
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onMouseEnter={() => prefetch(sessionLoader(row.id), [row.id])}
        onClick={() => navigate({ page: "sessions", id: row.id })}
      >
        <div className="truncate font-medium">{row.title}</div>
        <div className="truncate font-mono text-[11px] text-faint">
          {provider(row.provider).label} · {basename(row.project) || plural(row.messageCount, "message")} · {relativeTime(row.updatedAt)}
        </div>
      </button>
      <Button
        size="sm"
        busy={busy}
        icon={<Copy size={13} />}
        onClick={async () => {
          setBusy(true);
          await copySessions([row.id]);
          setBusy(false);
        }}
      >
        Copy
      </Button>
    </div>
  );
}

const BANNER_TTL_MS = 24 * 60 * 60 * 1000;

export function Overview() {
  const navigate = useApp((s) => s.navigate);
  const settings = useApp((s) => s.settings);
  const stats = useLoad(() => api.stats());
  const sessions = useLoad(() => api.listSessions());
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const s = stats.data;
  const loading = sessions.loading && !sessions.data;
  const all = useMemo(() => sessions.data ?? [], [sessions.data]);

  const bannerFirstSeen = settings.bannerFirstSeen ?? (typeof window !== "undefined" ? Number(localStorage.getItem("hopilo_banner_first_seen") || 0) : 0);
  const bannerExpired = bannerFirstSeen > 0 && now - bannerFirstSeen > BANNER_TTL_MS;
  const showBanner = !settings.onboarded && !bannerExpired;

  useEffect(() => {
    if (settings.onboarded) return;
    if (bannerExpired) {
      saveSetting("onboarded", true);
      return;
    }
    if (!bannerFirstSeen) {
      const ts = Date.now();
      if (typeof window !== "undefined") {
        localStorage.setItem("hopilo_banner_first_seen", String(ts));
      }
      saveSetting("bannerFirstSeen", ts);
    }
  }, [settings.onboarded, bannerExpired, bannerFirstSeen]);

  useEffect(() => {
    if (!showBanner || !bannerFirstSeen) return;
    const remaining = Math.max(0, BANNER_TTL_MS - (now - bannerFirstSeen));
    if (remaining === 0) return;
    const t = setTimeout(() => setNow(Date.now()), remaining);
    return () => clearTimeout(t);
  }, [showBanner, bannerFirstSeen, now]);

  const recent = useMemo(() => [...all].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [all]);
  const latest = recent[0];
  const agents = all.filter((r) => r.kind === "local-agent").length;
  const web = all.filter((r) => r.kind === "browser-chat").length;
  const tools = new Set(all.map((r) => r.provider)).size;

  return (
    <div className="space-y-5 pb-6">
      {showBanner && (
        <Card className="flex items-start gap-3 p-4">
          <img
            src="/hopilo-mark.svg"
            alt="Hopilo"
            className="h-8 w-8 shrink-0 drop-shadow-[0_2px_6px_rgb(40_30_120/0.25)]"
            draggable={false}
          />
          <div className="flex-1">
            <div className="font-semibold">Welcome to Hopilo</div>
            <p className="mt-0.5 text-muted">
              {`Every AI session in one place, with its files. Hit a usage limit or want a second opinion? Copy the session and paste it into another AI. Everything stays on this ${deviceNoun}.`}
            </p>
          </div>
          <button
            type="button"
            aria-label="Dismiss welcome"
            title="Dismiss"
            className="text-muted hover:text-ink cursor-pointer"
            onClick={() => saveSetting("onboarded", true)}
          >
            <X size={16} />
          </button>
        </Card>
      )}

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]" aria-label="Overview">
        <Card className="card-w relative isolate overflow-hidden p-7">
          <div className="hero-plume pointer-events-none absolute inset-0 -z-10">
            <Flow mode="plume" />
          </div>
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-20 dark:hidden">
            <span className="absolute -right-24 -bottom-28 h-80 w-80 rounded-full bg-[var(--aura-1)] blur-3xl opacity-50" />
            <span className="absolute right-24 -bottom-16 h-56 w-56 rounded-full bg-[var(--aura-2)] blur-3xl opacity-50" />
            <span className="absolute -top-20 right-8 h-40 w-40 rounded-full bg-[var(--aura-3)] blur-3xl opacity-50" />
          </div>
          <h1 className="text-[24px] font-normal text-muted">Ready to continue</h1>
          <div className="mt-1 flex items-baseline gap-2">
            {loading ? <Skeleton className="my-1.5 h-[60px] w-20 rounded-2xl" /> : <span className="font-display text-[64px] leading-[1.05] font-semibold tabular-nums">{all.length}</span>}
            <span className="font-display text-[22px] font-medium text-accent">sessions</span>
          </div>
          <p className="mt-2 max-w-md text-muted">Pick up any conversation in another AI. Hopilo copies it as one message you paste; nothing is ever sent for you.</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!latest || busy}
              onClick={async () => {
                if (!latest) return;
                setBusy(true);
                await copySessions([latest.id]);
                setBusy(false);
              }}
              className="group flex h-12 items-center gap-2.5 rounded-full border border-line bg-surface py-1.5 pr-4 pl-1.5 shadow-item transition-all hover:-translate-y-px hover:border-line-strong hover:shadow-card active:scale-[0.98] disabled:opacity-50 disabled:hover:translate-y-0"
            >
              <span className="bg-brand flex h-9 w-9 items-center justify-center rounded-full text-white shadow-brand transition-transform group-hover:scale-105">
                <Copy size={15} />
              </span>
              <span className="text-left leading-tight">
                <span className="block text-[13px] font-semibold">{busy ? "Copying…" : "Continue latest"}</span>
                <span className="block max-w-[180px] truncate font-mono text-[10.5px] text-faint">{latest ? latest.title : "no session yet"}</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => navigate({ page: "sessions", filter: "all" })}
              className="group flex h-12 items-center gap-2.5 rounded-full border border-line bg-surface/90 px-4 text-[13px] font-medium text-ink shadow-item transition-all hover:-translate-y-px hover:border-line-strong hover:bg-surface hover:shadow-card active:scale-[0.98]"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-accent transition-colors group-hover:bg-accent group-hover:text-white">
                <MessagesSquare size={14} />
              </span>
              <span>Choose a different session</span>
              <ArrowRight size={14} className="text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
            </button>
          </div>
          <div className="mt-5 flex items-center gap-2 font-mono text-[11px] text-faint">
            <span className={cx("h-1.5 w-1.5 rounded-full", all.length ? "bg-success" : "bg-faint")} />
            {loading ? "loading…" : plural(tools, "tool")} · copies for {target(settings.defaultTarget).label} · local only
          </div>
        </Card>
        <SourcesMap sessions={all} loading={loading} />
      </section>

      <section aria-label="At a glance" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile
          tone="c-blue"
          icon={<Bot size={15} />}
          title="Coding agents"
          loading={loading}
          value={String(agents)}
          unit="sessions"
          caption="Kept in step with their files"
          action="Browse"
          onClick={() => navigate({ page: "sessions", filter: "agents" })}
          delay={0.24}
          glowStyle={{ left: 60, top: -60, "--bd": "6.5s" } as React.CSSProperties}
          effect="shine"
        />
        <Tile
          tone="c-violet"
          icon={<Globe size={15} />}
          title="Web chats"
          loading={loading}
          value={String(web)}
          unit="saved"
          caption={s ? `${s.capturesToday} new today` : ""}
          action="Open"
          onClick={() => navigate({ page: "sessions", filter: "web" })}
          delay={0.3}
          glowStyle={{ left: 0, top: 80, "--bd": "7s" } as React.CSSProperties}
          effect="particles"
        />
        <Tile
          tone="c-green"
          icon={<Send size={15} />}
          title="Copies"
          loading={!s}
          value={String(s?.handoffsTotal ?? 0)}
          unit="made"
          caption={s?.lastHandoff ? `Last for ${target(s.lastHandoff.target).label} · ${relativeTime(s.lastHandoff.createdAt)}` : "None yet"}
          action="Copy one"
          onClick={() => navigate({ page: "sessions", filter: "all" })}
          delay={0.36}
          glowStyle={{ left: 20, top: 70, "--bd": "6s" } as React.CSSProperties}
          effect="shine"
        />
        <Tile
          tone="c-crimson"
          icon={<ShieldCheck size={15} />}
          title="Privacy"
          value="0"
          unit="uploads"
          caption={`Nothing leaves this ${deviceNoun}`}
          action="Details"
          onClick={() => navigate({ page: "settings", section: "privacy" })}
          delay={0.42}
          glowStyle={{ left: 40, top: -70, "--bd": "5s" } as React.CSSProperties}
          effect="embers"
        />
      </section>

      <section className="grid grid-cols-1 items-stretch gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card className="flex h-full flex-col">
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <h2 className="font-semibold text-[15px]">Recent sessions</h2>
            <button
              type="button"
              className="group flex items-center gap-1 rounded-full border border-line bg-surface/80 px-3 py-1 text-[12px] font-medium text-muted shadow-item transition-all hover:-translate-y-px hover:border-line-strong hover:bg-surface hover:text-ink hover:shadow-card active:scale-[0.98]"
              onClick={() => navigate({ page: "sessions", filter: "all" })}
            >
              <span>All</span>
              <ChevronRight size={13} className="text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
            </button>
          </div>
          <div className="flex-1 divide-y divide-line flex flex-col justify-around">
            {loading && (
              <div role="status" aria-label="Loading sessions" className="divide-y divide-line">
                {[0, 1, 2, 3].map((i) => (
                  <RowSkeleton key={i} i={i} buttons={1} />
                ))}
              </div>
            )}
            {sessions.data && recent.length === 0 && <div className="flex-1 flex items-center justify-center px-4 py-8 text-center text-[13px] text-muted">No sessions yet. Coding-agent sessions show up on their own.</div>}
            {recent.slice(0, 4).map((r) => (
              <RecentRow key={r.id} row={r} />
            ))}
          </div>
        </Card>
        <Card className="flex h-full flex-col justify-between p-5">
          <div className="flex items-center justify-between pb-2">
            <h2 className="font-semibold text-[15px]">How it works</h2>
            <button
              type="button"
              className="group flex items-center gap-1 rounded-full border border-line bg-surface/80 px-3 py-1 text-[12px] font-medium text-muted shadow-item transition-all hover:-translate-y-px hover:border-line-strong hover:bg-surface hover:text-ink hover:shadow-card active:scale-[0.98]"
              onClick={() => setAdding(true)}
            >
              <span>Add session</span>
              <ArrowRight size={12} className="text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
            </button>
          </div>
          <ol className="flex flex-1 flex-col justify-between py-2 space-y-3">
            {STEPS.map((st, i) => (
              <li key={st.title} className="flex items-center gap-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  {st.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-ink">
                    <span className="font-mono text-faint mr-1">{i + 1}.</span> {st.title}
                  </div>
                  <div className="text-[12px] text-muted leading-snug">{st.body}</div>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </section>
      {adding && <AddSessionModal onClose={() => setAdding(false)} />}
    </div>
  );
}

export { Overview as Home };

