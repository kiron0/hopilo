import { useEffect, useMemo, useRef, useState } from "react";
import { FileDown, GitMerge, Hammer, Map as MapIcon, RefreshCw, Scissors } from "../components/Icons";
import { api, errorText, type PackRow } from "../lib/api";
import { exportPack } from "../lib/actions";
import { plural, provider, relativeTime, tokens } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { useApp } from "../lib/store";
import { packDraftItem } from "./Builder";
import { Badge, Button, Card, Checkbox, cx, EmptyState, Modal, PageHeader, ProviderChip, Segmented, TextInput } from "../components/ui";
import { MapSkeleton } from "../components/Skeletons";
import { FillPage } from "../components/PageSlots";

type Metric = "tokens" | "messages" | "files";
type Pos = { x: number; y: number };

const METRIC_LABEL: Record<Metric, string> = { tokens: "token estimate", messages: "message count", files: "attachment count" };

function metricOf(p: PackRow, m: Metric) {
  return m === "tokens" ? p.tokenEstimate : m === "messages" ? p.messageCount : p.attachmentCount;
}

/** Deterministic starting spot for packs without a saved position. */
function seedPosition(i: number): Pos {
  const angle = i * 2.399963; // golden angle
  const r = 12 + 8 * Math.sqrt(i);
  return { x: 50 + Math.cos(angle) * r * 1.3, y: 50 + Math.sin(angle) * r };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type RailAction = "builder" | "split" | "export";
const RAIL: { id: RailAction; label: string; icon: React.ReactNode }[] = [
  { id: "builder", label: "Add to Builder", icon: <Hammer size={15} /> },
  { id: "split", label: "Open to split", icon: <Scissors size={15} /> },
  { id: "export", label: "Export .handoff", icon: <FileDown size={15} /> },
];

export function ContextMap() {
  const navigate = useApp((s) => s.navigate);
  const addToDraft = useApp((s) => s.addToDraft);
  const settings = useApp((s) => s.settings);
  const toast = useApp((s) => s.toast);
  const packs = useLoad(() => api.listPacks());
  const relations = useLoad(() => api.packRelations(null));
  const saved = useLoad(() => api.getSettings());
  const [view, setView] = useState<"map" | "list">("map");
  const [metric, setMetric] = useState<Metric>("tokens");
  const [tag, setTag] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [positions, setPositions] = useState<Record<string, Pos>>({});
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const [drag, setDrag] = useState<{ id: string; over: string | null; rail: RailAction | null } | null>(null);
  const [mergeIds, setMergeIds] = useState<string[] | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const railRefs = useRef<Partial<Record<RailAction, HTMLDivElement | null>>>({});

  const rows = useMemo(() => (packs.data ?? []).filter((p) => !p.archived && (!tag || p.tags.includes(tag))), [packs.data, tag]);
  const allTags = useMemo(() => [...new Set((packs.data ?? []).flatMap((p) => p.tags))].sort(), [packs.data]);

  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({ width: 800, height: 600 });

  useEffect(() => {
    if (!canvas.current) return;
    const measure = () => {
      if (canvas.current) {
        const rect = canvas.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setCanvasSize({ width: rect.width, height: rect.height });
        }
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(canvas.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [view]);

  useEffect(() => {
    const stored = (saved.data?.["map.positions"] ?? {}) as Record<string, Pos>;
    setPositions((cur) => ({ ...stored, ...cur }));
  }, [saved.data]);

  const pos = (p: PackRow, i: number) => positions[p.id] ?? seedPosition(i);
  const max = Math.max(1, ...rows.map((p) => metricOf(p, metric)));

  // Scale bubble sizes proportionally when window shrinks or expands
  const scale = useMemo(() => {
    const w = canvasSize.width || 800;
    const h = canvasSize.height || 600;
    const diag = Math.hypot(w, h);
    return Math.min(1.2, Math.max(0.65, diag / 1000));
  }, [canvasSize]);

  const sizeOf = (p: PackRow) => Math.round((56 + Math.sqrt(metricOf(p, metric) / max) * 78) * scale);

  // Clamped position keeping bubbles fully inside the visible window / canvas frame
  const clampedPos = (p: PackRow, i: number) => {
    const raw = pos(p, i);
    const s = sizeOf(p);
    const w = canvasSize.width || 800;
    const h = canvasSize.height || 600;
    const padX = (s / 2 / w) * 100 + 1.5;
    const padY = (s / 2 / h) * 100 + 2;
    return {
      x: clamp(raw.x, Math.min(padX, 45), Math.max(100 - padX, 55)),
      y: clamp(raw.y, Math.min(padY, 45), Math.max(100 - padY, 55)),
    };
  };

  const persist = (next: Record<string, Pos>) => {
    api.setSetting("map.positions", next).catch(() => undefined);
  };

  const runRail = async (action: RailAction, ids: string[]) => {
    const chosen = rows.filter((r) => ids.includes(r.id));
    if (action === "builder") {
      const n = addToDraft(chosen.map(packDraftItem));
      toast({ kind: "success", text: n ? `Added ${plural(n, "pack")} to the Builder.` : "Already in the Builder.", action: { label: "Open Builder", run: () => navigate({ page: "builder" }) } });
    } else if (action === "split") {
      navigate({ page: "packs", packId: chosen[0].id });
    } else {
      for (const p of chosen) await exportPack(p.id, p.latestVersion, "handoff", settings.toolDetail, settings.level);
    }
  };

  const toggle = (id: string, additive: boolean) => {
    setSelected((cur) => {
      const n = new Set(additive ? cur : []);
      if (cur.has(id) && additive) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  // Pointer dragging: move freely; dropping on another bubble proposes a
  // merge; dropping on a rail target runs that action.
  const startDrag = (e: React.PointerEvent, p: PackRow) => {
    if (e.button !== 0) return;
    const box = canvas.current?.getBoundingClientRect();
    if (!box) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const before = positions[p.id];
    const restore = () =>
      setPositions((cur) => {
        const n = { ...cur };
        if (before) n[p.id] = before;
        else delete n[p.id];
        return n;
      });
    let moved = false;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const hit = (cx: number, cy: number) => {
      for (const [id, el] of Object.entries(railRefs.current)) {
        const r = el?.getBoundingClientRect();
        if (r && cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) return { rail: id as RailAction, over: null };
      }
      const over = rows.find((o, i) => {
        if (o.id === p.id) return false;
        const op = clampedPos(o, i);
        const ox = box.left + (op.x / 100) * box.width;
        const oy = box.top + (op.y / 100) * box.height;
        return Math.hypot(cx - ox, cy - oy) < sizeOf(o) / 2;
      });
      return { rail: null, over: over?.id ?? null };
    };
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
      moved = true;
      const s = sizeOf(p);
      const padX = (s / 2 / box.width) * 100 + 1.5;
      const padY = (s / 2 / box.height) * 100 + 2;
      const x = clamp(((ev.clientX - box.left) / box.width) * 100, padX, 100 - padX);
      const y = clamp(((ev.clientY - box.top) / box.height) * 100, padY, 100 - padY);
      setPositions((cur) => ({ ...cur, [p.id]: { x, y } }));
      setDrag({ id: p.id, ...hit(ev.clientX, ev.clientY) });
    };
    const onUp = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      setDrag(null);
      if (!moved) {
        toggle(p.id, ev.shiftKey || ev.metaKey || ev.ctrlKey);
        return;
      }
      const h = hit(ev.clientX, ev.clientY);
      if (h.rail) {
        restore();
        runRail(h.rail, [p.id]);
      } else if (h.over) {
        restore();
        setMergeIds([h.over, p.id]);
      } else {
        // Read the latest positions after this drag's final update.
        requestAnimationFrame(() => persist(positionsRef.current));
      }
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };

  const sel = rows.filter((r) => selected.has(r.id));
  const lines = useMemo(() => {
    const ids = new Map(rows.map((r, i) => [r.id, i]));
    return (relations.data ?? []).filter((l) => ids.has(l.fromPack) && ids.has(l.toPack));
  }, [relations.data, rows]);

  return (
    <FillPage className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader
        title="Context Map"
        subtitle="Every pack as a bubble. Drag to arrange, drop one pack on another to merge, or onto an action on the right. Shift-click to pick several."
        actions={
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: "map", label: "Map" },
              { value: "list", label: "List" },
            ]}
          />
        }
      />
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-[12.5px] text-muted">
          Bubble size
          <Segmented label="Bubble size" value={metric} onChange={setMetric} options={[{ value: "tokens", label: "Tokens" }, { value: "messages", label: "Messages" }, { value: "files", label: "Files" }]} />
        </div>
        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {["", ...allTags].map((t) => (
              <button key={t || "all"} type="button" aria-pressed={tag === t} onClick={() => setTag(t)} className={cx("h-7 rounded-full border px-3 text-[12px]", tag === t ? "border-accent bg-accent-soft font-semibold" : "border-line text-muted hover:text-ink")}>
                {t ? `#${t}` : "All"}
              </button>
            ))}
          </div>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCw size={13} />}
          onClick={() => {
            setPositions({});
            api.setSetting("map.positions", {}).catch(() => undefined);
            toast({ kind: "info", text: "Bubble positions reset to fit window." });
          }}
          title="Reset bubble positions to fit current window"
        >
          Reset layout
        </Button>
        <div className="flex-1" />
        {sel.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] text-muted">{sel.length} selected</span>
            {sel.length >= 2 && (
              <Button size="sm" variant="primary" icon={<GitMerge size={13} />} onClick={() => setMergeIds(sel.map((s) => s.id))}>
                Merge
              </Button>
            )}
            {RAIL.map((r) => (
              <Button key={r.id} size="sm" icon={r.icon} onClick={() => runRail(r.id, sel.map((s) => s.id))} disabled={r.id === "split" && sel.length > 1}>
                {r.label}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        )}
      </div>

      {packs.loading && !packs.data && <MapSkeleton />}
      {packs.data && rows.length === 0 && (
        <Card>
          <EmptyState icon={<MapIcon size={20} />} title="No packs to map yet" body="Build a pack, or use Copy handoff on a coding session — it appears here as a bubble." action={<Button variant="primary" onClick={() => navigate({ page: "builder" })}>Build a pack</Button>} />
        </Card>
      )}

      {rows.length > 0 && view === "map" && (
        <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
          <Card className="card-soft relative flex-1 h-full min-h-[360px] overflow-hidden" aria-label="Context Map">
            <div ref={canvas} className="absolute inset-0" role="group" aria-label={`Packs sized by ${METRIC_LABEL[metric]}`}>
              <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full">
                {lines.map((l, k) => {
                  const ai = rows.findIndex((r) => r.id === l.fromPack);
                  const bi = rows.findIndex((r) => r.id === l.toPack);
                  const a = clampedPos(rows[ai], ai);
                  const b = clampedPos(rows[bi], bi);
                  return <line key={k} x1={`${a.x}%`} y1={`${a.y}%`} x2={`${b.x}%`} y2={`${b.y}%`} stroke="var(--border-strong)" strokeWidth={1.5} strokeDasharray={l.kind === "split" ? "4 4" : undefined} />;
                })}
              </svg>
              {rows.map((p, i) => {
                const at = clampedPos(p, i);
                const size = sizeOf(p);
                const isSel = selected.has(p.id);
                const isOver = drag?.over === p.id;
                const dragging = drag?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={isSel}
                    aria-label={`${p.title}: ${tokens(p.tokenEstimate)} tokens, ${plural(p.messageCount, "message")}`}
                    onPointerDown={(e) => startDrag(e, p)}
                    onDoubleClick={() => navigate({ page: "packs", packId: p.id })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") navigate({ page: "packs", packId: p.id });
                      if (e.key === " ") {
                        e.preventDefault();
                        toggle(p.id, true);
                      }
                    }}
                    className={cx(
                      "absolute flex touch-none flex-col items-center justify-center rounded-full border text-center transition-[box-shadow,border-color,scale]",
                      dragging ? "z-20 scale-105 cursor-grabbing" : "cursor-grab",
                      isOver ? "border-accent ring-4 ring-accent/30" : isSel ? "border-accent" : "border-line",
                    )}
                    style={{
                      left: `${at.x}%`,
                      top: `${at.y}%`,
                      width: size,
                      height: size,
                      transform: "translate(-50%, -50%)",
                      background: `radial-gradient(circle at 35% 30%, var(--surface), color-mix(in oklab, var(--surface) 84%, ${provider(p.providers[0] ?? "manual").color}))`,
                      boxShadow: `inset 0 1px 2px var(--bubble-hi), 0 16px 34px -16px color-mix(in oklab, ${provider(p.providers[0] ?? "manual").color} var(--glow-mix), transparent), var(--elev-item)`,
                    }}
                  >
                    <ProviderChip id={p.providers[0] ?? "manual"} size={size > 110 ? 26 : 20} />
                    <span className="mt-1 line-clamp-2 max-w-[78%] text-[11.5px] leading-tight font-semibold">{p.title}</span>
                    <span className="font-mono text-[10px] text-faint">
                      {metric === "tokens" ? tokens(p.tokenEstimate) : metric === "messages" ? `${p.messageCount} msgs` : `${p.attachmentCount} files`}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="pointer-events-none absolute bottom-3 left-4 flex items-center gap-3 text-[11px] text-faint">
              <span>Size = {METRIC_LABEL[metric]}</span>
              <span className="flex items-center gap-1"><svg width="22" height="6" aria-hidden><line x1="0" y1="3" x2="22" y2="3" stroke="var(--border-strong)" strokeWidth="1.5" /></svg> merged / copied from</span>
              <span className="flex items-center gap-1"><svg width="22" height="6" aria-hidden><line x1="0" y1="3" x2="22" y2="3" stroke="var(--border-strong)" strokeWidth="1.5" strokeDasharray="4 4" /></svg> split from</span>
            </div>
          </Card>
          <div className="flex w-[160px] shrink-0 flex-col gap-3" aria-label="Drop actions">
            {RAIL.map((r) => (
              <div
                key={r.id}
                ref={(el) => {
                  railRefs.current[r.id] = el;
                }}
                className={cx(
                  "flex flex-1 flex-col items-center justify-center gap-1.5 rounded-[22px] border-2 border-dashed text-center text-[12.5px] transition-colors",
                  drag?.rail === r.id ? "border-accent bg-accent-soft text-ink" : "border-line-strong/70 text-muted",
                )}
              >
                {r.icon}
                {r.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {rows.length > 0 && view === "list" && (
        <Card className="min-h-0 flex-1 divide-y divide-line overflow-auto">
          {rows.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
              <Checkbox label={`Select ${p.title}`} checked={selected.has(p.id)} onChange={() => toggle(p.id, true)} />
              <ProviderChip id={p.providers[0] ?? "manual"} size={24} />
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => navigate({ page: "packs", packId: p.id })}>
                <div className="truncate font-medium">{p.title}</div>
                <div className="font-mono text-[11px] text-faint">v{p.latestVersion} · {p.messageCount} msgs · {tokens(p.tokenEstimate)} · {relativeTime(p.updatedAt)}</div>
              </button>
              {p.tags.map((t) => (
                <Badge key={t}>#{t}</Badge>
              ))}
            </div>
          ))}
        </Card>
      )}

      {mergeIds && <MergeModal ids={mergeIds} packs={rows} onClose={() => setMergeIds(null)} />}
    </FillPage>
  );
}

function MergeModal({ ids, packs, onClose }: { ids: string[]; packs: PackRow[]; onClose: () => void }) {
  const navigate = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const chosen = ids.map((i) => packs.find((p) => p.id === i)).filter(Boolean) as PackRow[];
  const [title, setTitle] = useState(chosen.map((p) => p.title).join(" + "));
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={`Merge ${chosen.length} packs`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            icon={<GitMerge size={14} />}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api.mergePacks(ids, title);
                toast({ kind: "success", text: `Merged into “${r.pack.title}”${r.duplicatesRemoved ? `, ${r.duplicatesRemoved} duplicate message(s) kept once` : ""}${r.notesCombined > 1 ? `, ${r.notesCombined} notes kept side by side` : ""}.` });
                onClose();
                navigate({ page: "packs", packId: r.pack.packId });
              } catch (e) {
                toast({ kind: "error", text: errorText(e) });
              } finally {
                setBusy(false);
              }
            }}
          >
            Merge into a new pack
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-muted">The original packs stay as they are. The new pack lists both as its source.</p>
        <ol className="space-y-1.5">
          {chosen.map((p, i) => (
            <li key={p.id} className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-faint">{i + 1}.</span>
              <ProviderChip id={p.providers[0] ?? "manual"} size={20} />
              <span className="flex-1 truncate font-medium">{p.title}</span>
              <span className="font-mono text-[11px] text-faint">{p.messageCount} msgs</span>
            </li>
          ))}
        </ol>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-muted">New pack title</span>
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <p className="text-[12px] text-faint">Messages that appear in more than one pack are kept once. If the packs have different notes, both are kept and labelled.</p>
      </div>
    </Modal>
  );
}
