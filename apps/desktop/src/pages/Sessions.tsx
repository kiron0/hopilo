import { useEffect, useMemo, useRef, useState } from "react";
import { isMac, modKey } from "../lib/platform";
import { createPortal } from "react-dom";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileImage,
  FilePlus2,
  FileText,
  FolderOpen,
  GitBranch,
  GitMerge,
  Globe,
  LayoutGrid,
  List,
  MessagesSquare,
  MoreHorizontal,
  Paperclip,
  Pin,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  SparkIcon,
  ToolsIcon,
  Trash2,
  X,
} from "../components/Icons";
import { api, errorText, type Attachment, type SessionRow } from "../lib/api";
import { pickFiles, saveFileAs } from "../lib/actions";
import { basename, bytes, plural, provider, relativeTime, tokens } from "../lib/format";
import { prefetch, patchCachedSession, saveSetting, useDebouncedValue, useLoad } from "../lib/hooks";
import { type SessionFilter, useApp } from "../lib/store";
import { target, TARGETS } from "../lib/targets";
import { Transcript } from "../components/Transcript";
import { AddSessionModal } from "../components/AddSession";
import { FileImportModal } from "../components/FileImport";
import { HandoffModal, type HandoffAction } from "../components/HandoffModal";
import { ProviderLogo } from "../components/ProviderLogos";
import { Select, type SelectOption } from "../components/Select";
import { SessionListSkeleton, SessionPageSkeleton } from "../components/Skeletons";
import {
  AlertDialog,
  Badge,
  Button,
  Card,
  Checkbox,
  cx,
  EmptyState,
  ErrorNote,
  IconButton,
  Modal,
  PageHeader,
  Pagination,
  ProviderBadge,
  SearchField,
  Segmented,
  StatusBadge,
  useFitRows,
} from "../components/ui";
import { FillPage, PageFooter, PageToolbar } from "../components/PageSlots";

type Filter = SessionFilter;

export const sessionLoader = (id: string) => () => api.getSession(id);

const SYNC_EVERY_MS = 60_000;
let lastSync = 0;

const FILTERS: SelectOption[] = [
  { value: "all", label: "All", icon: <MessagesSquare size={14} className="text-muted" /> },
  { value: "agents", label: "Coding agents", icon: <Bot size={14} className="text-muted" /> },
  { value: "web", label: "Web chats", icon: <Globe size={14} className="text-muted" /> },
  { value: "added", label: "Added", icon: <Plus size={14} className="text-muted" /> },
  { value: "pinned", label: "Pinned", icon: <Pin size={14} filled className="text-accent fill-accent" /> },
  { value: "hidden", label: "Hidden", icon: <RotateCcw size={14} className="text-muted" /> },
];

export const isUnanswered = (r: SessionRow) => r.kind === "local-agent" && r.replyCount === 0;

export async function setPinned(id: string, pinned: boolean, title: string) {
  const { toast, bump } = useApp.getState();
  patchCachedSession(id, { pinned });
  try {
    await api.updateSession(id, { pinned });
    bump();
    toast({ key: `pin-${id}`, kind: "success", text: pinned ? `Pinned “${title}” to the top` : `Unpinned “${title}”` });
    return true;
  } catch (e) {
    patchCachedSession(id, { pinned: !pinned });
    toast({ key: `pin-${id}`, kind: "error", text: `Couldn't ${pinned ? "pin" : "unpin"} “${title}”: ${errorText(e)}` });
    return false;
  }
}

function PinButton({ pinned, onToggle, compact }: { pinned: boolean; onToggle: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pinned}
      aria-label={pinned ? "Unpin" : "Pin to top"}
      title={pinned ? "Pinned to top · Click to unpin" : "Pin to the top"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl text-[12px] font-medium transition-all active:scale-[0.96]",
        compact ? "h-8 w-8" : "h-8 px-2.5",
        pinned
          ? "border border-accent/40 bg-accent-soft text-accent shadow-xs hover:bg-accent-soft/80"
          : "border border-line/60 bg-surface text-muted hover:border-line-strong hover:text-ink",
        compact && !pinned && "opacity-40 group-hover:opacity-100 hover:!opacity-100 focus-visible:opacity-100",
      )}
    >
      <Pin size={13} filled={pinned} className={pinned ? "fill-current" : "-rotate-45"} />
      {!compact && <span>{pinned ? "Pinned" : "Pin"}</span>}
    </button>
  );
}

function matches(r: SessionRow, f: Filter) {
  switch (f) {
    case "all":
      return true;
    case "agents":
      return r.kind === "local-agent";
    case "web":
      return r.kind === "browser-chat";
    case "added":
      return r.kind !== "local-agent" && r.kind !== "browser-chat";
    case "pinned":
      return r.pinned;
    case "hidden":
      return true;
  }
}

function meta(r: SessionRow) {
  return [
    provider(r.provider).label,
    r.model,
    basename(r.project),
    plural(r.messageCount, "message"),
    r.fileCount ? plural(r.fileCount, "file") : "",
    relativeTime(r.updatedAt),
  ]
    .filter(Boolean)
    .join(" · ");
}

type SessionGroup = "none" | "folder" | "provider" | "model";

export function groupSessions(rows: SessionRow[], by: SessionGroup): { key: string; label: string; rows: SessionRow[] }[] {
  if (by === "none") return [{ key: "all", label: "", rows }];
  const groups = new Map<string, { label: string; rows: SessionRow[] }>();
  for (const row of rows) {
    const key = by === "folder" ? row.project?.trim() || "__none" : by === "provider" ? row.provider || "__none" : row.model?.trim() || "__none";
    const label =
      by === "folder"
        ? row.project?.trim() ? basename(row.project) : "No folder"
        : by === "provider"
        ? row.provider ? provider(row.provider).label : "Unknown tool"
        : row.model?.trim() || "Unknown model";
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { label, rows: [row] });
  }
  return [...groups].map(([key, group]) => ({ key, ...group }));
}

function FilterSelect({ label, value, options, onChange, className = "w-36" }: { label: string; value: string; options: SelectOption[]; onChange: (value: string) => void; className?: string }) {
  return <div className={`shrink-0 ${className}`}><Select size="sm" label={label} value={value} options={options} onChange={onChange} /></div>;
}

function SessionList() {
  const { q, filter, provider: providerFilter, model: modelFilter, resource: resourceFilter, page, selected: picked } = useApp((s) => s.listView);
  const { data, error, loading, reload } = useLoad(() => (filter === "hidden" ? api.listHiddenSessions() : api.listSessions()), [filter]);
  const navigate = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const settings = useApp((s) => s.settings);
  const setListView = useApp((s) => s.setListView);
  const setQ = (v: string) => setListView({ q: v, page: 0 });
  const debouncedQ = useDebouncedValue(q);
  const setFilter = (v: Filter) => setListView({ filter: v, page: 0 });
  const setPage = (v: number) => setListView({ page: v });
  const selected = useMemo(() => new Set(picked), [picked]);
  const setSelected = (n: Set<string>) => setListView({ selected: [...n] });
  const [syncing, setSyncing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [handoff, setHandoff] = useState<{ ids: string[]; action: HandoffAction } | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<{ id: string; title: string } | null>(null);
  const [confirmRestoreBulk, setConfirmRestoreBulk] = useState<string[] | null>(null);
  const limitChoice = useApp((s) => s.listView.limit);
  const hideUnanswered = useApp((s) => s.listView.hideUnanswered);
  const [listRef, autoPageSize] = useFitRows<HTMLDivElement>(52, 10);
  const [pinOverrides, setPinOverrides] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setPinOverrides((prev) => {
      if (!data || Object.keys(prev).length === 0) return prev;
      const next = { ...prev };
      let changed = false;
      for (const [id, pinned] of Object.entries(prev)) {
        const row = data.find((r) => r.id === id);
        if (row && row.pinned === pinned) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [data]);
  const isPinned = (r: SessionRow) => pinOverrides[r.id] ?? r.pinned;
  const togglePin = async (r: SessionRow) => {
    const next = !isPinned(r);
    setPinOverrides((o) => ({ ...o, [r.id]: next }));
    if (!(await setPinned(r.id, next, r.title))) setPinOverrides((o) => ({ ...o, [r.id]: !next }));
  };
  const automaticPageSize = settings.sessionLayout === "thumbnails" ? 12 : settings.sessionGroup === "none" ? autoPageSize : 10;
  const pageSize = Math.max(10, limitChoice === "auto" ? automaticPageSize : limitChoice);

  const onLimitChange = (lim: number | "auto") => setListView({ limit: lim, page: 0 });

  const sync = async (manual: boolean) => {
    if (syncing) return;
    lastSync = Date.now();
    setSyncing(true);
    if (manual) toast({ key: "sync", kind: "loading", text: "Checking agent folders…" });
    try {
      const r = await api.syncSessions();
      reload();
      if (manual) {
        const changed = r.added + r.updated;
        const parts = [r.added && `${r.added} new`, r.updated && `${r.updated} updated`, r.failed && `${r.failed} unreadable`].filter(Boolean);
        toast({
          key: "sync",
          kind: r.failed && !changed ? "warning" : "success",
          text: parts.length ? `Sessions synced: ${parts.join(", ")}` : `Up to date · ${plural(r.found, "session")} in agent folders`,
        });
      }
    } catch (e) {
      if (manual) toast({ key: "sync", kind: "error", text: `Could not check agent folders: ${errorText(e)}` });
    } finally {
      setSyncing(false);
    }
  };
  useEffect(() => {
    if (Date.now() - lastSync > SYNC_EVERY_MS) sync(false);
  }, []);

  const rows = useMemo(() => {
    const needle = debouncedQ.trim().toLowerCase();
    const filtered = (data ?? []).filter(
      (r) =>
        (filter === "pinned" ? isPinned(r) : matches(r, filter)) &&
        (providerFilter === "all" || r.provider === providerFilter) &&
        (modelFilter === "all" || (r.model?.trim() || "__unknown") === modelFilter) &&
        (resourceFilter === "all" || (resourceFilter === "with-files" ? r.fileCount > 0 : r.fileCount === 0)) &&
        !(hideUnanswered && isUnanswered(r)) &&
        (!needle ||
          r.title.toLowerCase().includes(needle) ||
          (r.project ?? "").toLowerCase().includes(needle) ||
          (r.model ?? "").toLowerCase().includes(needle) ||
          provider(r.provider).label.toLowerCase().includes(needle) ||
          r.tags.some((t) => t.includes(needle))),
    );
    if (filter === "hidden") return filtered;
    return filtered.slice().sort((a, b) => {
      const ap = isPinned(a) ? 1 : 0;
      const bp = isPinned(b) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return 0;
    });
  }, [data, debouncedQ, filter, providerFilter, modelFilter, resourceFilter, hideUnanswered, pinOverrides]);
  const providerOptions = useMemo<SelectOption[]>(() => {
    const list: SelectOption[] = [{ value: "all", label: "All tools", icon: <ToolsIcon size={14} className="text-muted" /> }];
    const targets = TARGETS.filter((t) => t.id !== "other")
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "chat" ? -1 : 1))
      .map((t) => ({
        value: t.id,
        label: t.label,
        group: t.kind === "chat" ? "Chat apps" : "Coding agents & editors",
        icon: <ProviderLogo id={t.id} size={14} className="text-muted" monochrome />,
      }));
    list.push(...targets);
    const known = new Set(TARGETS.map((t) => t.id));
    const extra = new Set((data ?? []).map((r) => r.provider).filter((id) => id && !known.has(id)));
    if (providerFilter !== "all" && !known.has(providerFilter)) extra.add(providerFilter);
    if (extra.size > 0) {
      for (const id of [...extra].sort()) {
        list.push({
          value: id,
          label: provider(id).label,
          group: "Other tools",
          icon: <ProviderLogo id={id} size={14} className="text-muted" monochrome />,
        });
      }
    }
    return list;
  }, [data, providerFilter]);
  const modelOptions = useMemo<SelectOption[]>(() => {
    const models = new Set((data ?? []).map((r) => r.model?.trim() || "__unknown"));
    if (modelFilter !== "all") models.add(modelFilter);
    return [
      { value: "all", label: "All models", icon: <SparkIcon size={14} className="text-muted" /> },
      ...[...models].sort((a, b) => a.localeCompare(b)).map((model) => ({
        value: model,
        label: model === "__unknown" ? "Unknown model" : model,
        icon: <Bot size={14} className="text-muted" />,
      })),
    ];
  }, [data, modelFilter]);
  const resourceOptions: SelectOption[] = useMemo(
    () => [
      { value: "all", label: "All resources", icon: <Paperclip size={14} className="text-muted" /> },
      { value: "with-files", label: "With files", icon: <FileText size={14} className="text-muted" /> },
      { value: "without-files", label: "Without files", icon: <X size={14} className="text-muted" /> },
    ],
    [],
  );
  const groupOptions: SelectOption[] = useMemo(
    () => [
      { value: "none", label: "No categories", icon: <SlidersHorizontal size={14} className="text-muted" /> },
      { value: "folder", label: "By Folder", icon: <FolderOpen size={14} className="text-muted" /> },
      { value: "provider", label: "By Tool", icon: <ToolsIcon size={14} className="text-muted" /> },
      { value: "model", label: "By Model", icon: <Bot size={14} className="text-muted" /> },
    ],
    [],
  );
  const unanswered = useMemo(() => (data ?? []).filter(isUnanswered).length, [data]);
  const pg = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
  const pageRows = useMemo(() => rows.slice(pg * pageSize, pg * pageSize + pageSize), [rows, pg, pageSize]);
  const groups = useMemo(() => groupSessions(pageRows, settings.sessionGroup), [pageRows, settings.sessionGroup]);
  const hasQueryOrFilter = q || filter !== "all" || providerFilter !== "all" || modelFilter !== "all" || resourceFilter !== "all" || hideUnanswered;
  const clearFilters = () => setListView({ q: "", filter: "all", provider: "all", model: "all", resource: "all", hideUnanswered: false, page: 0 });
  const known = useMemo(() => new Set((data ?? []).map((r) => r.id)), [data]);
  const ids = [...selected].filter((id) => known.has(id));

  const toggle = (id: string) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSelected(n);
  };
  const copy = (list: string[]) => {
    setHandoff({ ids: list, action: "copy" });
  };
  const openSession = (r: SessionRow) => {
    prefetch(sessionLoader(r.id), [r.id]);
    navigate({ page: "sessions", id: r.id });
  };
  const sessionAction = (r: SessionRow, on: boolean) =>
    filter === "hidden" ? (
      <Button size="sm" variant="secondary" icon={<RotateCcw size={13} />} onClick={() => setConfirmRestore({ id: r.id, title: r.title })}>
        Restore
      </Button>
    ) : (
      <Button size="sm" variant={on ? "secondary" : "primary"} icon={<Copy size={13} />} onClick={() => copy([r.id])} title={`Copy for ${target(settings.defaultTarget).label}`}>
        Copy
      </Button>
    );
  const titleLine = (r: SessionRow) => (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate font-medium">{r.title}</span>
      {isPinned(r) && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            togglePin(r);
          }}
          title="Pinned to top · Click to unpin"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-accent/30 bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-accent shadow-xs transition-colors hover:bg-accent-soft/80"
        >
          <Pin size={10} filled className="shrink-0 fill-current" />
          <span>Pinned</span>
        </button>
      )}
      {r.missingCount > 0 && <AlertTriangle size={12} className="shrink-0 text-warning" aria-label="Partly captured" />}
      {r.tags.slice(0, 2).map((tag) => <Badge key={tag}>{tag}</Badge>)}
    </span>
  );
  const listRow = (r: SessionRow) => {
    const on = selected.has(r.id);
    return (
      <div key={r.id} data-fit-row className={cx("group flex items-center gap-3 px-4 py-2.5", on ? "bg-accent-soft/60" : "hover:bg-surface-2/60")}>
        <Checkbox label={`Select ${r.title}`} checked={on} onChange={() => toggle(r.id)} />
        <ProviderBadge id={r.provider} size={30} />
        <button
          type="button"
          draggable
          onDragStart={(e) => e.dataTransfer.setData("text/plain", `hopilo://session/${r.id}`)}
          onMouseEnter={() => prefetch(sessionLoader(r.id), [r.id])}
          onFocus={() => prefetch(sessionLoader(r.id), [r.id])}
          onClick={() => openSession(r)}
          className="min-w-0 flex-1 text-left"
        >
          {titleLine(r)}
          <span className="mt-0.5 block truncate font-mono text-[11px] text-faint" title={r.origin ?? undefined}>{meta(r)}</span>
        </button>
        {r.fileCount > 0 && <span className="hidden items-center gap-1 font-mono text-[11px] text-faint sm:flex" title={plural(r.fileCount, "file")}><Paperclip size={12} /> {r.fileCount}</span>}
        {filter !== "hidden" && <PinButton compact pinned={isPinned(r)} onToggle={() => togglePin(r)} />}
        {sessionAction(r, on)}
      </div>
    );
  };
  const thumbnail = (r: SessionRow) => {
    const on = selected.has(r.id);
    return (
      <article key={r.id} className={cx("group flex min-h-44 flex-col rounded-2xl border p-3.5 shadow-item transition-colors", on ? "border-accent bg-accent-soft/60" : "border-line bg-card hover:border-line-strong hover:bg-surface-2/50")}>
        <div className="flex items-start gap-3">
          <Checkbox label={`Select ${r.title}`} checked={on} onChange={() => toggle(r.id)} />
          <ProviderBadge id={r.provider} size={34} />
          <button type="button" onMouseEnter={() => prefetch(sessionLoader(r.id), [r.id])} onFocus={() => prefetch(sessionLoader(r.id), [r.id])} onClick={() => openSession(r)} className="min-w-0 flex-1 text-left">
            {titleLine(r)}
            <span className="mt-1 block truncate text-[12px] text-muted" title={r.project ?? undefined}>{basename(r.project) || "No folder"}</span>
          </button>
        </div>
        <button type="button" onClick={() => openSession(r)} className="mt-3 min-w-0 flex-1 text-left">
          <span className="block truncate font-mono text-[11px] text-faint" title={r.model ?? undefined}>{r.model || "Unknown model"}</span>
          <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted">
            <span>{plural(r.messageCount, "message")}</span>
            <span>{plural(r.fileCount, "file")}</span>
            <span>{relativeTime(r.updatedAt)}</span>
          </span>
        </button>
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">{provider(r.provider).label}</span>
          {filter !== "hidden" && <PinButton compact pinned={isPinned(r)} onToggle={() => togglePin(r)} />}
          {sessionAction(r, on)}
        </div>
      </article>
    );
  };

  return (
    <FillPage>
      <PageHeader
        title="Sessions"
        subtitle="Every conversation from your AI tools, with its files. Copy one into another AI in a click."
        actions={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setAdding(true)}>
            Add
          </Button>
        }
      />
      <PageToolbar>
        <div className="flex w-full flex-col gap-2.5">
          <div className="flex w-full items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center">
              <SearchField label="Filter sessions" placeholder="Search title, folder, tool, model or tag" value={q} onChange={setQ} className="min-w-0 flex-1" />
              <div
                className={cx(
                  "flex items-center shrink-0 overflow-hidden transition-[max-width,opacity,padding] duration-200 ease-out",
                  hasQueryOrFilter
                    ? "max-w-40 opacity-100 pl-2"
                    : "max-w-0 opacity-0 pl-0 pointer-events-none",
                )}
              >
                <button
                  type="button"
                  onClick={clearFilters}
                  tabIndex={hasQueryOrFilter ? 0 : -1}
                  aria-hidden={!hasQueryOrFilter}
                  title="Clear search and filters"
                  className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-card px-3 text-[12.5px] font-medium text-muted shadow-item transition-colors duration-150 hover:border-line-strong hover:bg-surface-2/60 hover:text-ink active:scale-[0.98]"
                >
                  <X size={13} className="shrink-0" />
                  <span>Clear filters</span>
                </button>
              </div>
            </div>
            <div className="flex h-9 items-center rounded-xl border border-line bg-card p-0.5 shadow-item shrink-0" role="group" aria-label="Layout view">
              <button
                type="button"
                aria-label="List view"
                title="List view"
                onClick={() => saveSetting("sessionLayout", "list")}
                className={cx(
                  "flex h-7.5 w-7.5 items-center justify-center rounded-lg transition-colors",
                  settings.sessionLayout === "list" ? "bg-surface-3 text-ink shadow-xs" : "text-faint hover:text-ink",
                )}
              >
                <List size={14} />
              </button>
              <button
                type="button"
                aria-label="Cards view"
                title="Cards view"
                onClick={() => saveSetting("sessionLayout", "thumbnails")}
                className={cx(
                  "flex h-7.5 w-7.5 items-center justify-center rounded-lg transition-colors",
                  settings.sessionLayout === "thumbnails" ? "bg-surface-3 text-ink shadow-xs" : "text-faint hover:text-ink",
                )}
              >
                <LayoutGrid size={14} />
              </button>
            </div>
            <IconButton label="Check agent folders for new sessions" onClick={() => sync(true)} disabled={syncing} className="h-9 w-9 shrink-0 rounded-full border border-line bg-card shadow-item">
              <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
            </IconButton>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect label="Show sessions" value={filter} options={FILTERS} onChange={(value) => setFilter(value as Filter)} className="w-36" />
            <FilterSelect label="Filter by tool" value={providerFilter} options={providerOptions} onChange={(provider) => setListView({ provider, page: 0 })} className="w-44" />
            <FilterSelect label="Filter by model" value={modelFilter} options={modelOptions} onChange={(model) => setListView({ model, page: 0 })} className="w-40" />
            <FilterSelect
              label="Filter by resources"
              value={resourceFilter}
              onChange={(resource) => setListView({ resource: resource as typeof resourceFilter, page: 0 })}
              options={resourceOptions}
              className="w-38"
            />
            <FilterSelect
              label="Categorize sessions"
              value={settings.sessionGroup}
              onChange={(v) => saveSetting("sessionGroup", v as typeof settings.sessionGroup)}
              options={groupOptions}
              className="w-38"
            />
            {(unanswered > 0 || hideUnanswered) && (
              <button
                type="button"
                aria-pressed={hideUnanswered}
                title="Agent sessions where only your prompt was saved — the run failed or never answered"
                onClick={() => setListView({ hideUnanswered: !hideUnanswered, page: 0 })}
                className={cx(
                  "h-8 shrink-0 rounded-full border px-3 text-[12px] font-medium shadow-item transition-colors",
                  hideUnanswered ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-card text-muted hover:text-ink",
                )}
              >
                {hideUnanswered ? "Unanswered hidden" : "Hide unanswered"}
                <span className="ml-1.5 font-mono text-[10.5px] opacity-70">{unanswered}</span>
              </button>
            )}
          </div>
        </div>
      </PageToolbar>

      {error && <ErrorNote text={error} />}
      {loading && !data && <SessionListSkeleton />}
      {data && rows.length === 0 && (
        <Card className="flex min-h-0 flex-1 flex-col items-center justify-center p-8">
          <EmptyState
            icon={<MessagesSquare size={20} />}
            title={
              filter === "hidden"
                ? "No hidden sessions"
                : hasQueryOrFilter
                ? "No matching sessions"
                : syncing
                ? "Looking for sessions…"
                : "No sessions yet"
            }
            body={
              filter === "hidden"
                ? "Sessions you remove from Hopilo appear here so you can restore them anytime."
                : hasQueryOrFilter
                ? "Try a different search or filter."
                : "Sessions from Claude Code, Codex, Gemini CLI, Antigravity, Cursor, VS Code Copilot, OpenCode and other coding agents appear here on their own. Save web chats with the browser extension, or use Add."
            }
            action={
              hasQueryOrFilter ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<X size={13} />}
                  onClick={clearFilters}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        </Card>
      )}
      {rows.length > 0 && (
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
            {groups.map((group) => {
              const isFolder = settings.sessionGroup === "folder";
              const groupRowIds = group.rows.map((r) => r.id);
              const folderIds = isFolder && group.key !== "__none" ? rows.filter((r) => r.project?.trim() === group.key).map((r) => r.id) : [];
              const allSelected = groupRowIds.length > 0 && groupRowIds.every((id) => selected.has(id));
              const toggleGroup = () => {
                const next = new Set(selected);
                if (allSelected) {
                  for (const id of groupRowIds) next.delete(id);
                } else {
                  for (const id of groupRowIds) next.add(id);
                }
                setSelected(next);
              };

              return (
                <section key={group.key} aria-label={group.label || "Sessions"} className={settings.sessionGroup === "none" ? undefined : "border-b border-line last:border-b-0"}>
                  {group.label && (
                    <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2">
                      {isFolder && (
                        <Checkbox
                          label={`Select all in ${group.label}`}
                          checked={allSelected}
                          onChange={toggleGroup}
                        />
                      )}
                      <h2 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-muted" title={group.key === "__none" ? undefined : group.key}>
                        {group.label}
                      </h2>
                      <span className="font-mono text-[10.5px] text-faint">{group.rows.length}</span>
                      {folderIds.length > 1 && filter !== "hidden" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<GitMerge size={13} />}
                          onClick={() => setHandoff({ ids: folderIds, action: "copy" })}
                          title={`Combine all ${folderIds.length} sessions in this folder into one pack`}
                        >
                          Copy all {folderIds.length}
                        </Button>
                      )}
                      {isFolder && group.key !== "__none" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<FolderOpen size={13} />}
                          onClick={() => api.openFolder(group.key).then(() => toast({ kind: "success", text: `Opened ${group.label}` })).catch((e) => toast({ kind: "error", text: `Couldn't open the folder: ${errorText(e)}` }))}
                          title={`Open folder: ${group.key}`}
                        >
                          Open folder
                        </Button>
                      )}
                    </div>
                  )}
                  <div className={settings.sessionLayout === "thumbnails" ? "grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3" : "divide-y divide-line"}>
                    {group.rows.map(settings.sessionLayout === "thumbnails" ? thumbnail : listRow)}
                  </div>
                </section>
              );
            })}
          </div>
          <div className="shrink-0 border-t border-line bg-surface-2 px-4 py-2.5">
            {ids.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] font-medium">{plural(ids.length, "session")} selected</span>
                <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
                <div className="flex-1" />
                {filter === "hidden" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<RotateCcw size={13} />}
                    onClick={() => setConfirmRestoreBulk(ids)}
                  >
                    Restore {plural(ids.length, "session")}
                  </Button>
                ) : (
                  <>
                    {ids.length === 2 && (
                      <Button size="sm" icon={<GitBranch size={13} />} onClick={() => navigate({ page: "compare", a: ids[0], b: ids[1] })} title="Compare these two sessions side by side">
                        Compare
                      </Button>
                    )}
                    <Button size="sm" icon={<Download size={13} />} onClick={() => setHandoff({ ids, action: "export" })}>
                      Export
                    </Button>
                    <Button size="sm" variant="primary" icon={ids.length > 1 ? <GitMerge size={13} /> : <Copy size={13} />} onClick={() => setHandoff({ ids, action: "copy" })}>
                      {ids.length > 1 ? "Copy combined" : "Copy"}
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <Pagination
                page={pg}
                pageSize={pageSize}
                total={rows.length}
                onPage={setPage}
                noun="session"
                limitOptions={["auto", 10, 25, 50, 100] as const}
                currentLimit={limitChoice}
                onLimitChange={onLimitChange}
              />
            )}
          </div>
        </Card>
      )}
      <PageFooter>
        <span className="mr-auto text-[12px] text-faint">
          Agent session files are only read, never changed. Copies go to {target(settings.defaultTarget).label} at the {settings.level} level; change that in Settings.
        </span>
      </PageFooter>
      {adding && <AddSessionModal onClose={() => setAdding(false)} />}
      {handoff && <HandoffModal ids={handoff.ids} action={handoff.action} onClose={() => setHandoff(null)} />}
      {confirmRestore && (
        <AlertDialog
          title="Restore session"
          description={`Restore “${confirmRestore.title}” back to your active Sessions list?`}
          confirmLabel="Restore"
          destructive={false}
          icon={<RotateCcw size={15} />}
          onClose={() => setConfirmRestore(null)}
          onConfirm={async () => {
            try {
              await api.restoreSession(confirmRestore.id);
              reload();
              toast({ kind: "success", text: `Restored “${confirmRestore.title}” to Sessions` });
              setConfirmRestore(null);
            } catch (err) {
              toast({ key: "restore", kind: "error", text: `Restore failed: ${errorText(err)}` });
            }
          }}
        />
      )}
      {confirmRestoreBulk && (
        <AlertDialog
          title={`Restore ${plural(confirmRestoreBulk.length, "session")}`}
          description={`Restore ${plural(confirmRestoreBulk.length, "session")} back to your active Sessions list?`}
          confirmLabel="Restore"
          destructive={false}
          icon={<RotateCcw size={15} />}
          onClose={() => setConfirmRestoreBulk(null)}
          onConfirm={async () => {
            toast({ key: "restore", kind: "loading", text: `Restoring ${plural(confirmRestoreBulk.length, "session")}…` });
            try {
              for (const sid of confirmRestoreBulk) {
                await api.restoreSession(sid);
              }
              reload();
              setSelected(new Set());
              toast({ key: "restore", kind: "success", text: `Restored ${plural(confirmRestoreBulk.length, "session")} to Sessions` });
              setConfirmRestoreBulk(null);
            } catch (err) {
              toast({ key: "restore", kind: "error", text: `Restore failed: ${errorText(err)}` });
            }
          }}
        />
      )}
    </FillPage>
  );
}

function ImageLightbox({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4 backdrop-blur-md cursor-zoom-out select-none"
    >
      <img
        src={url}
        alt={alt}
        onClick={onClose}
        className="max-h-full max-w-full object-contain rounded shadow-2xl"
      />
    </div>,
    document.body
  );
}

function FilesTab({ files }: { files: Attachment[] }) {
  const toast = useApp((s) => s.toast);
  const [preview, setPreview] = useState<{ file: Attachment; url: string } | null>(null);
  const [infoFile, setInfoFile] = useState<Attachment | null>(null);

  if (files.length === 0)
    return (
      <div className="flex h-full min-h-[300px] flex-1 items-center justify-center p-8">
        <EmptyState icon={<Paperclip size={20} />} title="No files" body="Files shared in this conversation show up here. Add more with Add files." />
      </div>
    );
  const images = files.filter((file) => file.mediaType.startsWith("image/"));
  const documents = files.filter((file) => !file.mediaType.startsWith("image/"));
  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-auto p-5">
      {images.length > 0 && (
        <section aria-label="Images">
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {images.map((file) => (
              <ImageTile
                key={file.id}
                file={file}
                onOpen={(url) => setPreview({ file, url })}
                onInfo={() => setInfoFile(file)}
              />
            ))}
          </ul>
        </section>
      )}
      {documents.length > 0 && (
        <ul className="divide-y divide-line rounded-2xl border border-line">
          {documents.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <FileText size={16} className="shrink-0 text-faint" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium" data-selectable>{f.fileName}</div>
                <div className="font-mono text-[11px] text-faint">
                  {bytes(f.size)} · {f.mediaType || "file"} · {f.text != null ? "included as text when copied" : "attach it yourself when you paste"}
                </div>
              </div>
              <Button size="sm" variant="ghost" icon={<FolderOpen size={13} />} onClick={() => api.openFile(f.sha256).then(() => toast({ kind: "success", text: `Opened ${f.fileName}` })).catch((e) => toast({ kind: "error", text: `Couldn't open ${f.fileName}: ${errorText(e)}` }))}>
                Open
              </Button>
              <Button size="sm" icon={<Download size={13} />} onClick={() => saveFileAs(f.sha256, f.fileName)}>
                Save
              </Button>
            </li>
          ))}
        </ul>
      )}
      {preview && (
        <ImageLightbox
          url={preview.url}
          alt={preview.file.fileName}
          onClose={() => setPreview(null)}
        />
      )}
      {infoFile && (
        <Modal
          title="File info"
          onClose={() => setInfoFile(null)}
          footer={
            <div className="flex w-full items-center justify-between gap-2">
              <Button
                size="sm"
                variant="ghost"
                icon={<FolderOpen size={13} />}
                onClick={() =>
                  api
                    .openFile(infoFile.sha256)
                    .catch((e) => toast({ kind: "error", text: errorText(e) }))
                }
              >
                Open
              </Button>
              <Button
                size="sm"
                icon={<Download size={13} />}
                onClick={() => saveFileAs(infoFile.sha256, infoFile.fileName)}
              >
                Save
              </Button>
            </div>
          }
        >
          <div className="space-y-3.5 text-[13px]">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-faint">File name</div>
              <div className="mt-0.5 break-all font-medium text-ink select-text">{infoFile.fileName}</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wider text-faint">Size</div>
                <div className="mt-0.5 font-mono text-muted">{bytes(infoFile.size)}</div>
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wider text-faint">Media type</div>
                <div className="mt-0.5 font-mono text-muted">{infoFile.mediaType || "image"}</div>
              </div>
            </div>
            {infoFile.originPath && (
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wider text-faint">Original path</div>
                <div className="mt-0.5 break-all font-mono text-[11px] text-muted select-text">{infoFile.originPath}</div>
              </div>
            )}
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wider text-faint">SHA-256</span>
                <button
                  type="button"
                  className="flex items-center gap-1 text-[11px] text-accent hover:underline"
                  onClick={() => {
                    writeText(infoFile.sha256)
                      .then(() => toast({ kind: "success", text: "Copied SHA-256" }))
                      .catch((e) => toast({ kind: "error", text: `Copy failed: ${errorText(e)}` }));
                  }}
                >
                  <Copy size={11} /> Copy
                </button>
              </div>
              <div className="mt-0.5 break-all font-mono text-[11px] text-muted select-text">{infoFile.sha256}</div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ImageTile({
  file,
  onOpen,
  onInfo,
}: {
  file: Attachment;
  onOpen: (url: string) => void;
  onInfo: () => void;
}) {
  const tileRef = useRef<HTMLLIElement>(null);
  const [near, setNear] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const tile = tileRef.current;
    if (!tile || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setNear(true);
        observer.disconnect();
      },
      { rootMargin: "300px" },
    );
    observer.observe(tile);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!near) return;
    let active = true;
    api
      .previewFile(file.sha256)
      .then((value) => active && setUrl(value))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [file.sha256, near]);

  return (
    <li ref={tileRef} className="group min-w-0 overflow-hidden rounded-2xl border border-line bg-surface text-left shadow-item transition hover:border-accent/40 hover:shadow-pop">
      <button
        type="button"
        disabled={!url}
        aria-label={`Preview ${file.fileName}`}
        onClick={() => url && onOpen(url)}
        className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-surface-2 disabled:cursor-default"
      >
        {url ? (
          <img
            src={url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
          />
        ) : (
          <FileImage size={24} className={failed ? "text-danger" : near ? "animate-pulse text-faint" : "text-faint"} />
        )}
      </button>
      <div className="flex items-center justify-between gap-1.5 px-3 py-2">
        <button
          type="button"
          disabled={!url}
          onClick={() => url && onOpen(url)}
          className="min-w-0 flex-1 text-left disabled:cursor-default"
        >
          <span className="block truncate text-[12.5px] font-medium text-ink">{file.fileName}</span>
          <span className="block font-mono text-[10.5px] text-faint">{bytes(file.size)}</span>
        </button>
        <button
          type="button"
          title="More info"
          aria-label={`More info for ${file.fileName}`}
          onClick={(e) => {
            e.stopPropagation();
            onInfo();
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-faint transition hover:bg-surface-2 hover:text-ink focus:text-ink"
        >
          <MoreHorizontal size={15} />
        </button>
      </div>
    </li>
  );
}

function findOccurrences(text: string, query: string): number {
  if (!text || !query.trim()) return 0;
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, "gi");
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function SessionPage({ id }: { id: string }) {
  const { data, error, loading } = useLoad(sessionLoader(id), [id]);
  const navigate = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const [tab, setTab] = useState<"conversation" | "files">("conversation");
  const [search, setSearch] = useState("");
  const searchQuery = useDebouncedValue(search);
  const [matchIndex, setMatchIndex] = useState(0);
  const [activeMatchId, setActiveMatchId] = useState<string | undefined>();
  const [activeMessageId, setActiveMessageId] = useState<string | undefined>();
  const [forceShown, setForceShown] = useState<number | undefined>();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [handoff, setHandoff] = useState<{ ids: string[]; action: HandoffAction } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [paths, setPaths] = useState<string[] | null>(null);
  const [pinned, setPinnedLocal] = useState<boolean | null>(null);
  const back = () => navigate({ page: "sessions" });

  const messages = data?.messages;
  const matches = useMemo(() => {
    if (!messages || !searchQuery.trim()) return [];
    const q = searchQuery.trim();
    const found: { matchId: string; messageId: string; messageIndex: number }[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      for (let bIdx = 0; bIdx < m.blocks.length; bIdx++) {
        const b = m.blocks[bIdx];
        let text = "";
        let prefix = `${m.id}-${bIdx}`;
        switch (b.type) {
          case "text":
            text = b.text;
            break;
          case "toolCall":
            text = b.input;
            prefix = `${m.id}-${bIdx}-body`;
            break;
          case "toolResult":
            text = b.output;
            prefix = `${m.id}-${bIdx}-body`;
            break;
          case "missing":
            text = b.description;
            break;
          case "file":
            text = b.name;
            break;
        }
        if (!text) continue;
        const count = findOccurrences(text, q);
        for (let occ = 0; occ < count; occ++) {
          found.push({
            matchId: `${prefix}-${occ}`,
            messageId: m.id,
            messageIndex: i,
          });
        }
      }
    }
    return found;
  }, [messages, searchQuery]);

  const jumpTo = (targetIdx: number) => {
    if (matches.length === 0) return;
    const clamped = (targetIdx + matches.length) % matches.length;
    setMatchIndex(clamped);
    const target = matches[clamped];
    setForceShown((curr) => Math.max(curr ?? 40, target.messageIndex + 20));
    setActiveMatchId(target.matchId);
    setActiveMessageId(target.messageId);

    const scrollToTarget = () => {
      const matchEl = document.getElementById(`match-${target.matchId}`);
      if (matchEl) {
        matchEl.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        const msgEl = document.getElementById(`msg-${target.messageId}`);
        msgEl?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    };

    requestAnimationFrame(() => {
      scrollToTarget();
      setTimeout(scrollToTarget, 60);
    });
  };

  const prevMatch = () => jumpTo(matchIndex - 1);
  const nextMatch = () => jumpTo(matchIndex + 1);

  useEffect(() => {
    setMatchIndex(0);
    if (matches.length > 0) {
      const first = matches[0];
      setForceShown((curr) => Math.max(curr ?? 40, first.messageIndex + 20));
      setActiveMatchId(first.matchId);
      setActiveMessageId(first.messageId);
      const scrollToTarget = () => {
        const matchEl = document.getElementById(`match-${first.matchId}`);
        if (matchEl) {
          matchEl.scrollIntoView({ behavior: "smooth", block: "center" });
        } else {
          document.getElementById(`msg-${first.messageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      };
      requestAnimationFrame(() => {
        scrollToTarget();
        setTimeout(scrollToTarget, 60);
      });
    } else {
      setActiveMatchId(undefined);
      setActiveMessageId(undefined);
    }
  }, [matches, searchQuery]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setTab("conversation");
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (pinned !== null && data?.row && data.row.pinned === pinned) {
      setPinnedLocal(null);
    }
  }, [data?.row.pinned, pinned]);

  if (error) return <ErrorNote text={error} />;
  if (loading && !data) return <SessionPageSkeleton />;
  if (!data) return null;
  const { row, source, files, tokenEstimate } = data;
  const agent = row.kind === "local-agent";
  const isPinnedNow = pinned ?? row.pinned;
  const togglePin = async () => {
    const next = !isPinnedNow;
    setPinnedLocal(next);
    const ok = await setPinned(id, next, row.title);
    if (!ok) setPinnedLocal(!next);
  };

  const remove = async () => {
    try {
      await api.removeSession(id);
      setConfirmDelete(false);
      toast({ kind: "success", text: agent ? `Removed “${row.title}”. Restore it anytime from Hidden.` : `Deleted “${row.title}”.` });
      back();
    } catch (e) {
      toast({ kind: "error", text: `Couldn't ${agent ? "remove" : "delete"} “${row.title}”: ${errorText(e)}` });
    }
  };
  const restore = async () => {
    try {
      await api.restoreSession(id);
      toast({ kind: "success", text: `Restored “${row.title}” to Sessions` });
      back();
    } catch (e) {
      toast({ kind: "error", text: errorText(e) });
    }
  };

  return (
    <FillPage>
      <PageHeader
        title={row.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
            <button type="button" onClick={back} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
              <ArrowLeft size={13} /> Sessions
            </button>
            <span>· {provider(row.provider).label}</span>
            {row.project && <span title={row.project}>· {basename(row.project)}</span>}
            {row.model && <span>· {row.model}</span>}
            <span>· {plural(data.messages.length, "message")}</span>
            <span>· ~{tokens(tokenEstimate)} tokens</span>
            <span>· {relativeTime(row.updatedAt)}</span>
            {row.lastCopiedAt && <span>· copied {relativeTime(row.lastCopiedAt)}</span>}
          </span>
        }
        actions={
          <>
            <StatusBadge status={source.captureStatus} />
            {!row.hidden && <PinButton pinned={isPinnedNow} onToggle={togglePin} />}
            {!row.hidden && (
              <IconButton label="Compare with another session" onClick={() => navigate({ page: "compare", a: id })}>
                <GitBranch size={15} />
              </IconButton>
            )}
            {row.hidden ? (
              <Button size="sm" icon={<RotateCcw size={13} />} onClick={() => setConfirmRestore(true)}>
                Restore
              </Button>
            ) : (
              <IconButton label={agent ? "Remove from Hopilo" : "Delete"} onClick={() => setConfirmDelete(true)}>
                <Trash2 size={15} />
              </IconButton>
            )}
          </>
        }
      />

      {(source.missingItems.length > 0 || source.omitted.length > 0) && (
        <Card className="mb-3 space-y-1.5 p-3 text-[12.5px]">
          {source.missingItems.map((m) => (
            <div key={m} className="flex items-start gap-2 text-warning">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {m}
            </div>
          ))}
          {source.omitted.map((o) => (
            <div key={o.what} className="text-muted">
              Left out: {o.count} × {o.what}
            </div>
          ))}
        </Card>
      )}

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {row.hidden && (
          <div className="flex items-center justify-between border-b border-line bg-surface-2 px-4 py-2 text-[12.5px] text-muted">
            <span>This session is hidden from Hopilo. The files on your computer are untouched.</span>
            <Button size="sm" variant="secondary" icon={<RotateCcw size={13} />} onClick={() => setConfirmRestore(true)}>
              Restore to Sessions
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line px-4 py-2.5">
          <Segmented
            label="View"
            value={tab}
            onChange={(v) => setTab(v as "conversation" | "files")}
            options={[
              { value: "conversation", label: "Conversation" },
              { value: "files", label: files.length ? `Files (${files.length})` : "Files" },
            ]}
          />

          {tab === "conversation" ? (
            <div className="flex min-w-[220px] max-w-sm flex-1 items-center gap-1.5 rounded-xl border border-line bg-card px-2.5 py-1 shadow-item focus-within:border-accent">
              <Search size={13} className="shrink-0 text-faint" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (e.shiftKey) prevMatch();
                    else nextMatch();
                  } else if (e.key === "Escape") {
                    setSearch("");
                    setActiveMatchId(undefined);
                    searchInputRef.current?.blur();
                  }
                }}
                placeholder={`Search conversation (${modKey}${isMac ? "" : "+"}F)`}
                className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
              />
              {search && (
                <div className="flex items-center gap-1 shrink-0">
                  <span className="font-mono text-[11px] text-faint select-none">
                    {matches.length ? `${matchIndex + 1}/${matches.length}` : "0/0"}
                  </span>
                  <div className="flex items-center border-l border-line pl-1 text-faint">
                    <button
                      type="button"
                      disabled={matches.length <= 1}
                      title="Previous match (Shift+Enter)"
                      aria-label="Previous match"
                      onClick={prevMatch}
                      className="flex h-5 w-5 items-center justify-center rounded hover:bg-surface-2 hover:text-ink disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                    >
                      <ChevronLeft size={13} />
                    </button>
                    <button
                      type="button"
                      disabled={matches.length <= 1}
                      title="Next match (Enter)"
                      aria-label="Next match"
                      onClick={nextMatch}
                      className="flex h-5 w-5 items-center justify-center rounded hover:bg-surface-2 hover:text-ink disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                    >
                      <ChevronRight size={13} />
                    </button>
                  </div>
                  <button
                    type="button"
                    title="Clear search (Esc)"
                    aria-label="Clear search"
                    onClick={() => {
                      setSearch("");
                      setActiveMatchId(undefined);
                      setActiveMessageId(undefined);
                    }}
                    className="flex h-4 w-4 items-center justify-center rounded-full text-faint hover:bg-surface-2 hover:text-ink cursor-pointer"
                  >
                    <X size={11} />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1" />
          )}

          <div className="flex items-center gap-2">
            <Button size="sm" icon={<FilePlus2 size={13} />} onClick={async () => { const p = await pickFiles(); if (p.length) setPaths(p); }}>
              Add files
            </Button>
            <Button size="sm" icon={<Copy size={13} />} onClick={() => setHandoff({ ids: [id], action: "copy-markdown" })}>
              Copy Markdown
            </Button>
            <Button size="sm" icon={<Download size={13} />} onClick={() => setHandoff({ ids: [id], action: "export" })}>
              Export
            </Button>
            <Button variant="primary" size="sm" icon={<Copy size={13} />} onClick={() => setHandoff({ ids: [id], action: "copy" })}>
              Copy
            </Button>
          </div>
        </div>
        {tab === "conversation" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-auto p-5">
            <Transcript
              key={id}
              messages={data.messages}
              activeMatchId={activeMatchId}
              activeMessageId={activeMessageId}
              searchQuery={searchQuery}
              forceShown={forceShown}
            />
          </div>
        ) : (
          <FilesTab files={files} />
        )}
      </Card>
      {handoff && <HandoffModal ids={handoff.ids} action={handoff.action} onClose={() => setHandoff(null)} />}
      {paths && <FileImportModal paths={paths} session={id} onClose={() => setPaths(null)} />}
      {confirmDelete && (
        <AlertDialog
          title={agent ? "Remove session" : "Delete session"}
          description={
            agent
              ? `Remove “${row.title}” from Hopilo? The session file stays on your computer, and you can restore it anytime from Hidden sessions.`
              : `Delete “${row.title}” from Hopilo? This cannot be undone.`
          }
          confirmLabel={agent ? "Remove" : "Delete"}
          destructive
          onClose={() => setConfirmDelete(false)}
          onConfirm={remove}
        />
      )}
      {confirmRestore && (
        <AlertDialog
          title="Restore session"
          description={`Restore “${row.title}” back to your active Sessions list?`}
          confirmLabel="Restore"
          destructive={false}
          icon={<RotateCcw size={15} />}
          onClose={() => setConfirmRestore(false)}
          onConfirm={restore}
        />
      )}
    </FillPage>
  );
}

export function Sessions() {
  const route = useApp((s) => s.route);
  const id = route.page === "sessions" ? route.id : undefined;
  return id ? <SessionPage key={id} id={id} /> : <SessionList />;
}
