import { useMemo, useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, Boxes, FilePlus2, GripVertical, Hammer, MessagesSquare, Paperclip, Plus, Type, X } from "lucide-react";
import { api, errorText, type PackRow, type SourceRow } from "../lib/api";
import { pickFiles } from "../lib/actions";
import { plural, provider, relativeTime } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { type DraftItem, useApp } from "../lib/store";
import { sourceDraftItem } from "./Sessions";
import { attachmentDraftItem } from "../lib/draftItems";

export { attachmentDraftItem };
import { FileImportModal } from "../components/FileImport";
import { Badge, Button, Card, cx, Modal, PageHeader, ProviderDot, SectionLabel, Segmented, StatusBadge, TextArea, TextInput } from "../components/ui";

export function packDraftItem(p: PackRow): DraftItem {
  return {
    key: `pack:${p.id}`,
    item: { kind: "pack", id: p.id, version: null },
    label: p.title,
    meta: `Pack v${p.latestVersion} · ${plural(p.messageCount, "message")}`,
    provider: p.providers[0] ?? "manual",
  };
}


type LibTab = "sessions" | "packs" | "files";

function LibraryCard({ item, onAdd, extra }: { item: DraftItem; onAdd: () => void; extra?: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `lib:${item.key}`, data: { item } });
  return (
    <div
      ref={setNodeRef}
      className={cx("group flex items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2 shadow-card", isDragging && "opacity-40")}
    >
      <button type="button" aria-label={`Drag ${item.label}`} {...listeners} {...attributes} className="cursor-grab text-faint hover:text-muted active:cursor-grabbing">
        <GripVertical size={14} />
      </button>
      <ProviderDot id={item.provider} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{item.label}</div>
        <div className="truncate text-[11.5px] text-faint">{item.meta}</div>
      </div>
      {extra}
      <button type="button" aria-label={`Add ${item.label} to pack`} onClick={onAdd} className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-accent-soft hover:text-accent">
        <Plus size={14} />
      </button>
    </div>
  );
}

function CanvasTile({ item, warn, onRemove }: { item: DraftItem; warn?: string; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.key, data: { item } });
  const kindIcon = item.item.kind === "attachment" ? <Paperclip size={14} /> : item.item.kind === "pack" ? <Boxes size={14} /> : <MessagesSquare size={14} />;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx("flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 shadow-card", isDragging && "z-10 opacity-60")}
    >
      <button type="button" aria-label={`Reorder ${item.label}`} {...listeners} {...attributes} className="cursor-grab text-faint hover:text-muted active:cursor-grabbing">
        <GripVertical size={15} />
      </button>
      <span className="text-faint">{kindIcon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{item.label}</div>
        <div className="flex items-center gap-1.5 truncate text-[12px] text-faint">
          <ProviderDot id={item.provider} size={7} /> {provider(item.provider).label} · {item.meta}
        </div>
        {warn && (
          <div className="mt-0.5 flex items-center gap-1 text-[11.5px] text-warning">
            <AlertTriangle size={11} /> {warn}
          </div>
        )}
      </div>
      {item.item.kind === "source" && item.item.messageIds && <Badge tone="accent">Selected</Badge>}
      <button type="button" aria-label={`Remove ${item.label}`} onClick={onRemove} className="flex h-6 w-6 items-center justify-center rounded-md text-faint hover:bg-surface-3 hover:text-ink">
        <X size={14} />
      </button>
    </li>
  );
}

function Canvas({ items, warnings, children }: { items: DraftItem[]; warnings: Map<string, string>; children?: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: "canvas" });
  const remove = useApp((s) => s.removeFromDraft);
  return (
    <div
      ref={setNodeRef}
      className={cx(
        "min-h-[300px] rounded-2xl border-2 border-dashed p-4 transition-colors",
        isOver ? "border-accent bg-accent-soft/60" : "border-line-strong/70 bg-surface-2/60",
      )}
    >
      {items.length === 0 ? (
        <div className="flex h-[260px] flex-col items-center justify-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface text-accent shadow-card">
            <Hammer size={20} />
          </div>
          <div className="font-semibold">Drop sessions, packs, files or text</div>
          <div className="mt-1 max-w-xs text-muted">Drag from the library on the left, drop files from Finder, or use the + buttons.</div>
        </div>
      ) : (
        <SortableContext items={items.map((i) => i.key)} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2" aria-label="Pack contents, in order">
            {items.map((it) => (
              <CanvasTile key={it.key} item={it} warn={warnings.get(it.key)} onRemove={() => remove(it.key)} />
            ))}
          </ol>
        </SortableContext>
      )}
      {children}
    </div>
  );
}

function AddTextModal({ onClose, onAdded }: { onClose: () => void; onAdded: (d: DraftItem) => void }) {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title="Add text"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!text.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                const out = await api.importText(text, "manual", title);
                const { source, messages } = await api.getSource(out.sourceId);
                onAdded(sourceDraftItem({ id: out.sourceId, title: source.title, provider: source.provider, messageCount: messages.length }));
                onClose();
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Add to pack
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <TextInput placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
        <TextArea autoFocus rows={10} placeholder="Paste a snippet, requirements, decisions…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Text" />
        {error && <div className="text-danger">{error}</div>}
        <p className="text-[12px] text-faint">Saved to your library as a manual source, so it can be reused.</p>
      </div>
    </Modal>
  );
}

export function Builder() {
  const draft = useApp((s) => s.draft);
  const setDraft = useApp((s) => s.setDraft);
  const addToDraft = useApp((s) => s.addToDraft);
  const clearDraft = useApp((s) => s.clearDraft);
  const navigate = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);

  const sources = useLoad(() => api.listSources());
  const packs = useLoad(() => api.listPacks());
  const atts = useLoad(() => api.listAttachments());
  const [tab, setTab] = useState<LibTab>("sessions");
  const [filter, setFilter] = useState("");
  const [dragging, setDragging] = useState<DraftItem | null>(null);
  const [filePaths, setFilePaths] = useState<string[] | null>(null);
  const [addText, setAddText] = useState(false);
  const [busy, setBusy] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const sourceById = useMemo(() => new Map((sources.data ?? []).map((s) => [s.id, s])), [sources.data]);
  const inDraft = new Set(draft.items.map((i) => i.key));

  const libItems: { item: DraftItem; status?: SourceRow["captureStatus"] }[] = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const match = (s: string) => !f || s.toLowerCase().includes(f);
    if (tab === "sessions")
      return (sources.data ?? []).filter((s) => match(s.title)).map((s) => ({ item: { ...sourceDraftItem(s), meta: `${plural(s.messageCount, "message")} · ${relativeTime(s.capturedAt)}` }, status: s.captureStatus }));
    if (tab === "packs") return (packs.data ?? []).filter((p) => match(p.title) && p.id !== draft.packId).map((p) => ({ item: packDraftItem(p) }));
    return (atts.data ?? []).filter((a) => match(a.fileName)).map((a) => ({ item: attachmentDraftItem(a) }));
  }, [tab, filter, sources.data, packs.data, atts.data, draft.packId]);

  const warnings = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of draft.items) {
      if (it.item.kind === "source") {
        const s = sourceById.get(it.item.id);
        if (s && s.missingCount > 0) m.set(it.key, `Partial capture — ${plural(s.missingCount, "missing item")}`);
        if (!s && sources.data) m.set(it.key, "This capture was deleted");
      }
      if (it.item.kind === "attachment" && it.meta.includes("attach original")) m.set(it.key, "Not inlined — you'll attach the original file at the destination");
    }
    return m;
  }, [draft.items, sourceById, sources.data]);

  const counts = {
    sessions: draft.items.filter((i) => i.item.kind === "source").length,
    packs: draft.items.filter((i) => i.item.kind === "pack").length,
    files: draft.items.filter((i) => i.item.kind === "attachment").length,
    selected: draft.items.some((i) => i.item.kind === "source" && i.item.messageIds),
  };

  const onDragStart = (e: DragStartEvent) => setDragging((e.active.data.current?.item as DraftItem) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const { active, over } = e;
    if (!over) return;
    const id = String(active.id);
    if (id.startsWith("lib:")) {
      const item = active.data.current?.item as DraftItem;
      if (inDraft.has(item.key)) return;
      const items = [...draft.items];
      const at = items.findIndex((i) => i.key === over.id);
      items.splice(at === -1 ? items.length : at, 0, item);
      setDraft({ items });
      return;
    }
    if (over.id !== active.id) {
      const from = draft.items.findIndex((i) => i.key === active.id);
      const to = draft.items.findIndex((i) => i.key === over.id);
      if (from >= 0 && to >= 0) setDraft({ items: arrayMove(draft.items, from, to) });
    }
  };

  const build = async () => {
    setBusy(true);
    try {
      const pack = await api.buildPack({
        packId: draft.packId,
        title: draft.title,
        note: draft.note,
        items: draft.items.map((i) => i.item),
        label: draft.packId ? "Edited in Builder" : null,
      });
      clearDraft();
      toast({ kind: "success", text: `Saved “${pack.title}” v${pack.version}.` });
      navigate({ page: "packs", packId: pack.packId });
    } catch (e) {
      toast({ kind: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const canBuild = draft.items.length > 0 || draft.note.trim().length > 0;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <PageHeader
        title={draft.packId ? "Add to a pack" : "Build a pack"}
        subtitle={draft.packId ? "Building saves a new version. Earlier versions stay unchanged." : "Combine sessions, earlier packs, files and notes into one reviewable pack."}
        actions={
          <>
            {(draft.items.length > 0 || draft.packId) && (
              <Button variant="ghost" onClick={clearDraft}>
                Clear
              </Button>
            )}
            <Button variant="primary" icon={<Hammer size={15} />} disabled={!canBuild} busy={busy} onClick={build}>
              {draft.packId ? "Save new version" : "Build Pack"}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-[264px_minmax(0,1fr)_232px] gap-5">
        <section aria-label="Library">
          <SectionLabel>Library</SectionLabel>
          <Segmented
            label="Library type"
            value={tab}
            onChange={setTab}
            options={[
              { value: "sessions", label: "Sessions" },
              { value: "packs", label: "Packs" },
              { value: "files", label: "Files" },
            ]}
          />
          <TextInput aria-label="Filter library" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} className="mt-2.5" />
          <div className="mt-2.5 max-h-[460px] space-y-2 overflow-auto pr-1">
            {libItems.map(({ item, status }) => (
              <LibraryCard
                key={item.key}
                item={item}
                extra={status && status !== "complete" ? <StatusBadge status={status} /> : inDraft.has(item.key) ? <Badge tone="accent">Added</Badge> : undefined}
                onAdd={() => {
                  const n = addToDraft([item]);
                  if (!n) toast({ kind: "info", text: "Already in this pack." });
                }}
              />
            ))}
            {libItems.length === 0 && (
              <div className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-muted">
                {tab === "sessions" ? (
                  <>
                    Nothing captured yet.{" "}
                    <button type="button" className="text-accent hover:underline" onClick={() => navigate({ page: "sessions", tab: "agents" })}>
                      Capture a session
                    </button>
                  </>
                ) : tab === "packs" ? (
                  "No other packs yet."
                ) : (
                  "No files yet — drop some on the canvas."
                )}
              </div>
            )}
          </div>
        </section>

        <section aria-label="Pack contents">
          <SectionLabel>Sources · in handoff order</SectionLabel>
          <Canvas items={draft.items} warnings={warnings} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button icon={<Type size={14} />} onClick={() => setAddText(true)}>
              Add text
            </Button>
            <Button
              icon={<FilePlus2 size={14} />}
              onClick={async () => {
                const p = await pickFiles();
                if (p.length) setFilePaths(p);
              }}
            >
              Add files
            </Button>
            <Button
              variant="ghost"
              onClick={() => navigate({ page: "sessions", tab: "library" })}
              title="Open a capture and choose specific messages"
            >
              Select messages…
            </Button>
          </div>
        </section>

        <aside aria-label="Pack inspector">
          <SectionLabel>Pack inspector</SectionLabel>
          <Card className="space-y-4 p-4">
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-muted">Title</span>
              <TextInput placeholder="Defaults to the first source" value={draft.title} onChange={(e) => setDraft({ title: e.target.value })} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-muted">Note for the next AI</span>
              <TextArea rows={4} placeholder="Goal, constraints, what to do next…" value={draft.note} onChange={(e) => setDraft({ note: e.target.value })} />
            </label>
            <div className="space-y-1.5 text-[12.5px]">
              <div className="flex justify-between">
                <span className="text-muted">Mode</span>
                <span className="font-medium">{counts.selected ? "Selected" : "Full"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Sessions</span>
                <span>{counts.sessions}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Packs merged</span>
                <span>{counts.packs}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Files</span>
                <span>{counts.files}</span>
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[12px] font-medium text-muted">Validation</div>
              {draft.items.length === 0 ? (
                <div className="text-[12.5px] text-faint">Add something to validate.</div>
              ) : warnings.size === 0 ? (
                <div className="text-[12.5px] text-success">All sources complete.</div>
              ) : (
                <ul className="space-y-1 text-[12.5px] text-warning">
                  {[...warnings.values()].map((w, i) => (
                    <li key={i} className="flex gap-1.5">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {w}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Button variant="primary" className="w-full" icon={<Hammer size={15} />} disabled={!canBuild} busy={busy} onClick={build}>
              {draft.packId ? "Save new version" : "Build Pack"}
            </Button>
          </Card>
        </aside>
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="flex w-[260px] items-center gap-2.5 rounded-xl border border-accent bg-surface px-3 py-2 shadow-pop">
            <ProviderDot id={dragging.provider} />
            <div className="min-w-0 flex-1 truncate font-medium">{dragging.label}</div>
          </div>
        )}
      </DragOverlay>

      {filePaths && (
        <FileImportModal
          paths={filePaths}
          onClose={() => setFilePaths(null)}
          onImported={(a) => addToDraft(a.map(attachmentDraftItem))}
        />
      )}
      {addText && <AddTextModal onClose={() => setAddText(false)} onAdded={(d) => addToDraft([d])} />}
    </DndContext>
  );
}
