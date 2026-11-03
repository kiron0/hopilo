import { useMemo, useState } from "react";
import { ArrowRight, Bot, ChevronRight, ClipboardCheck, Copy, MessagesSquare, MousePointerClick, Send, ShieldCheck, X } from "lucide-react";
import { api, type DiscoveredRow, type SourceRow } from "../lib/api";
import { quickHandoff } from "../lib/actions";
import { basename, plural, provider, relativeTime } from "../lib/format";
import { saveSetting, useLoad } from "../lib/hooks";
import { useApp } from "../lib/store";
import { target } from "../lib/targets";
import { Button, Card, cx, Skeleton } from "../components/ui";
import { RowSkeleton } from "../components/Skeletons";
import { SparkIcon } from "../components/Icons";

export function CopyHandoffButton({ row, variant = "primary" }: { row: DiscoveredRow; variant?: "primary" | "secondary" }) {
  const [busy, setBusy] = useState(false);
  const defaultTarget = useApp((s) => s.settings.defaultTarget);
  return (
    <Button
      size="sm"
      variant={variant}
      busy={busy}
      icon={<Copy size={13} />}
      onClick={async () => {
        setBusy(true);
        await quickHandoff(row.adapter, row.path);
        setBusy(false);
      }}
      title={`Save this session as a pack and copy a ready-to-paste message for ${target(defaultTarget).label}`}
    >
      Copy handoff
    </Button>
  );
}

export function SessionContinueRow({ row, compact }: { row: DiscoveredRow; compact?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <ProviderBadge id={row.adapter} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{row.title}</div>
        <div className="truncate font-mono text-[11px] text-faint">
          {provider(row.adapter).label} · {basename(row.project) || "no project"} · {relativeTime(row.modifiedAt)}
        </div>
      </div>
      <CopyHandoffButton row={row} variant={compact ? "secondary" : "primary"} />
    </div>
  );
}

/** Rounded square with the provider's initial, in its color. */
export function ProviderBadge({ id, size = 30 }: { id: string; size?: number }) {
  const p = provider(id);
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-[10px] font-display text-[11px] font-semibold text-white shadow-card"
      style={{ width: size, height: size, background: `linear-gradient(140deg, ${p.color}, color-mix(in oklab, ${p.color} 70%, black))` }}
    >
      {p.label.replace(/[^A-Za-z]/g, "").slice(0, 1)}
    </span>
  );
}

const SLOTS = [
  { x: 50, y: 46 },
  { x: 20, y: 30 },
  { x: 80, y: 30 },
  { x: 22, y: 74 },
  { x: 78, y: 72 },
  { x: 50, y: 88 },
];

/** Bubble overview of where your sessions come from (sized by count). */
function SourcesMap({ discovered, sources, loading }: { discovered: DiscoveredRow[]; sources: SourceRow[]; loading: boolean }) {
  const navigate = useApp((s) => s.navigate);
  const bubbles = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of discovered) counts.set(d.adapter, (counts.get(d.adapter) ?? 0) + 1);
    for (const s of sources) if (s.kind !== "local-agent") counts.set(s.provider, (counts.get(s.provider) ?? 0) + 1);
    const list = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, SLOTS.length);
    const max = Math.max(1, ...list.map(([, n]) => n));
    return list.map(([id, n], i) => ({ id, n, slot: SLOTS[i], size: 58 + Math.sqrt(n / max) * (i === 0 ? 70 : 46) }));
  }, [discovered, sources]);

  return (
    <Card className="card-soft flex flex-col p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Sources map</h2>
        <button type="button" onClick={() => navigate({ page: "sessions" })} className="flex items-center text-[12px] font-medium text-accent hover:underline">
          Open <ChevronRight size={14} />
        </button>
      </div>
      <div className="relative mt-2 min-h-[210px] flex-1" role="list" aria-label="Sessions by tool">
        {loading && bubbles.length === 0 && (
          <div role="status" aria-label="Loading sources">
            {SLOTS.slice(0, 5).map((sl, i) => (
              <Skeleton key={i} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${sl.x}%`, top: `${sl.y}%`, width: i === 0 ? 128 : 84 - i * 4, height: i === 0 ? 128 : 84 - i * 4 }} />
            ))}
          </div>
        )}
        {!loading && bubbles.length === 0 && <div className="absolute inset-0 flex items-center justify-center text-center text-muted">Your sources appear here after the first scan.</div>}
        {bubbles.map((b) => (
          <button
            key={b.id}
            role="listitem"
            type="button"
            onClick={() => navigate({ page: "sessions", tab: provider(b.id).capture === "auto" ? "agents" : "library" })}
            className="bubble absolute flex flex-col items-center justify-center rounded-full border border-white/70 bg-[radial-gradient(circle_at_35%_30%,var(--surface),color-mix(in_oklab,var(--surface)_82%,transparent))] transition-[scale] hover:scale-105 dark:border-white/10"
            style={{
              left: `${b.slot.x}%`,
              top: `${b.slot.y}%`,
              width: b.size,
              height: b.size,
              animationDuration: `${5.5 + (b.slot.x % 3) * 0.8}s`,
              animationDelay: `${-(b.slot.y % 5) * 0.7}s`,
              boxShadow: `inset 0 1px 2px var(--bubble-hi), 0 14px 30px -14px color-mix(in oklab, ${provider(b.id).color} var(--glow-mix), transparent), var(--elev-item)`,
            }}
            aria-label={`${provider(b.id).label}: ${plural(b.n, "session")}`}
          >
            <ProviderBadge id={b.id} size={b.size > 90 ? 28 : 22} />
            <span className="mt-1 max-w-[90%] truncate text-[11px] font-semibold">{provider(b.id).label}</span>
            <span className="font-mono text-[10px] text-faint">{b.n}</span>
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-faint">
        <span className="bg-brand h-2 w-4 rounded-full" /> Bubble size = number of sessions
      </div>
    </Card>
  );
}

function Tile({ tone, icon, title, value, unit, caption, action, onClick, loading }: { tone: string; icon: React.ReactNode; title: string; value: string; unit: string; caption: string; action: string; onClick: () => void; loading?: boolean }) {
  return (
    <div className={cx("tile flex min-h-[168px] flex-col p-4", tone)}>
      <span aria-hidden className="tile-glow" />
      <div className="flex items-center gap-2">
        <span className="flex h-7.5 w-7.5 items-center justify-center rounded-[10px] border border-white/25 bg-white/15 shadow-[inset_0_1px_1px_rgb(255_255_255/0.3)]">{icon}</span>
        <span className="text-[13px] font-semibold">{title}</span>
      </div>
      {loading ? (
        <div aria-hidden className="mt-3 space-y-2">
          <span className="block h-[34px] w-16 rounded-lg bg-white/20" />
          <span className="block h-3 w-3/4 rounded bg-white/15" />
        </div>
      ) : (
        <>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="font-display text-[34px] leading-none font-medium tabular-nums">{value}</span>
            <span className="text-[12px] font-medium text-white/80">{unit}</span>
          </div>
          <div className="mt-1 truncate text-[12px] text-white/75">{caption}</div>
        </>
      )}
      <div className="flex-1" />
      <button type="button" onClick={onClick} className="mt-3 inline-flex h-8 w-fit items-center gap-1 rounded-full border border-white/35 bg-white/15 px-3.5 text-[12.5px] font-medium shadow-[inset_0_1px_1px_rgb(255_255_255/0.3)] transition-colors hover:bg-white/25">
        {action} <ArrowRight size={13} />
      </button>
    </div>
  );
}

const STEPS = [
  { icon: <MousePointerClick size={16} />, title: "Pick a conversation", body: "A coding-agent session, a pasted chat, or files." },
  { icon: <ClipboardCheck size={16} />, title: "Check what's included", body: "See every message, what's missing and any secrets." },
  { icon: <Send size={16} />, title: "Paste into any AI", body: "Hopilo copies one ready message. You press send." },
];

export function Dashboard() {
  const navigate = useApp((s) => s.navigate);
  const settings = useApp((s) => s.settings);
  const stats = useLoad(() => api.stats());
  const sources = useLoad(() => api.listSources());
  const discovered = useLoad(() => api.discoverSessions(), [], { refreshOnChange: false });
  const [busy, setBusy] = useState(false);
  const s = stats.data;
  const found = discovered.data ?? [];
  const latest = found[0];
  const tools = new Set(found.map((d) => d.adapter)).size;

  return (
    <div className="space-y-5">
      {!settings.onboarded && (
        <Card className="flex items-start gap-3 p-4">
          <span className="bg-brand flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white">
            <SparkIcon size={16} />
          </span>
          <div className="flex-1">
            <div className="font-semibold">Welcome to Hopilo</div>
            <p className="mt-0.5 text-muted">
              Hit a usage limit or want a second opinion? Hopilo moves your conversation to another AI as one message you can read before sending. Everything stays on this Mac.
            </p>
          </div>
          <button type="button" aria-label="Dismiss welcome" className="text-muted hover:text-ink" onClick={() => saveSetting("onboarded", true)}>
            <X size={16} />
          </button>
        </Card>
      )}

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]" aria-label="Overview">
        <Card className="relative isolate overflow-hidden p-7">
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
            <span className="absolute -right-24 -bottom-28 h-80 w-80 rounded-full bg-[var(--aura-1)] blur-3xl" />
            <span className="absolute right-24 -bottom-16 h-56 w-56 rounded-full bg-[var(--aura-2)] blur-3xl" />
            <span className="absolute -top-20 right-8 h-40 w-40 rounded-full bg-[var(--aura-3)] blur-3xl" />
          </div>
<h1 className="text-[24px] font-normal text-muted">Ready to continue</h1>
          <div className="mt-1 flex items-baseline gap-2">
            {discovered.loading && !discovered.data ? (
              <Skeleton className="my-1.5 h-[60px] w-20 rounded-2xl" />
            ) : (
              <span className="font-display text-[64px] leading-[1.05] font-medium tabular-nums">{found.length}</span>
            )}
            <span className="font-display text-[22px] font-medium text-accent">sessions</span>
          </div>
          <p className="mt-2 max-w-md text-muted">
            Pick up any conversation in another AI. Hopilo turns it into one message you paste — nothing is ever sent for you.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button
              type="button"
              disabled={!latest || busy}
              onClick={async () => {
                if (!latest) return;
                setBusy(true);
                await quickHandoff(latest.adapter, latest.path);
                setBusy(false);
              }}
              className="flex items-center gap-2.5 rounded-full border border-line bg-surface py-1.5 pr-4 pl-1.5 shadow-item transition-transform hover:-translate-y-px active:scale-[0.98] disabled:opacity-50"
            >
              <span className="bg-brand flex h-9 w-9 items-center justify-center rounded-full text-white shadow-brand">
                <Copy size={15} />
              </span>
              <span className="text-left leading-tight">
                <span className="block text-[13px] font-semibold">{busy ? "Copying…" : "Continue latest"}</span>
                <span className="block max-w-[180px] truncate font-mono text-[10.5px] text-faint">{latest ? latest.title : "no session yet"}</span>
              </span>
            </button>
            <button type="button" onClick={() => navigate({ page: "sessions", tab: "agents" })} className="flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
              Choose a different session <ArrowRight size={14} />
            </button>
          </div>
          <div className="mt-5 flex items-center gap-2 font-mono text-[11px] text-faint">
            <span className={cx("h-1.5 w-1.5 rounded-full", found.length ? "bg-success" : "bg-faint")} />
            {discovered.loading && !discovered.data ? "scanning…" : `${plural(tools, "tool")} detected`} · copies for {target(settings.defaultTarget).label} · local only
          </div>
        </Card>
        <SourcesMap discovered={found} sources={sources.data ?? []} loading={discovered.loading && !discovered.data} />
      </section>

      <section aria-label="At a glance" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile
          tone="tile-blue"
          icon={<Bot size={15} />}
          title="Agent sessions"
          loading={discovered.loading && !discovered.data}
          value={String(found.length)}
          unit="found"
          caption="From your coding agents"
          action="Browse"
          onClick={() => navigate({ page: "sessions", tab: "agents" })}
        />
        <Tile
          tone="tile-violet"
          icon={<MessagesSquare size={15} />}
          title="Captured"
          loading={!s}
          value={String(s?.sourceCount ?? 0)}
          unit="saved"
          caption={s ? `${s.capturesToday} today · last ${relativeTime(s.lastCaptureAt)}` : ""}
          action="Open"
          onClick={() => navigate({ page: "sessions", tab: "library" })}
        />
        <Tile
          tone="tile-green"
          icon={<Send size={15} />}
          title="Handoffs"
          loading={!s}
          value={String(s?.handoffsTotal ?? 0)}
          unit="copied"
          caption={s?.lastHandoff ? `Last for ${target(s.lastHandoff.target).label} · ${relativeTime(s.lastHandoff.createdAt)}` : "None yet"}
          action="Send"
          onClick={() => navigate({ page: "handoff" })}
        />
        <Tile
          tone="tile-rose"
          icon={<ShieldCheck size={15} />}
          title="Privacy"
          value="0"
          unit="uploads"
          caption="Nothing leaves this Mac"
          action="Details"
          onClick={() => navigate({ page: "settings", section: "privacy" })}
        />
      </section>

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <div className="flex items-center justify-between px-4 pt-4 pb-1">
            <h2 className="font-semibold">Continue a coding session</h2>
            <button type="button" className="flex items-center text-[12px] font-medium text-accent hover:underline" onClick={() => navigate({ page: "sessions", tab: "agents" })}>
              All <ChevronRight size={14} />
            </button>
          </div>
          <div className="divide-y divide-line">
            {discovered.loading && !discovered.data && (
              <div role="status" aria-label="Looking for sessions" className="divide-y divide-line">
                {[0, 1, 2, 3].map((i) => (
                  <RowSkeleton key={i} i={i} />
                ))}
              </div>
            )}
            {discovered.data && found.length === 0 && <div className="px-4 py-6 text-center text-muted">No Claude Code, Codex, Gemini CLI or OpenCode sessions found.</div>}
            {found.slice(0, 4).map((r) => (
              <SessionContinueRow key={r.path} row={r} compact />
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="font-semibold">How it works</h2>
          <ol className="mt-3 space-y-3">
            {STEPS.map((st, i) => (
              <li key={st.title} className="flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">{st.icon}</span>
                <div>
                  <div className="text-[13px] font-semibold">
                    <span className="font-mono text-faint">{i + 1}.</span> {st.title}
                  </div>
                  <div className="text-[12px] text-muted">{st.body}</div>
                </div>
              </li>
            ))}
          </ol>
          <Button size="sm" className="mt-4" onClick={() => navigate({ page: "agents" })}>
            See supported AI tools
          </Button>
        </Card>
      </section>
    </div>
  );
}
