import { ActionMenu } from "../components/ActionMenu";
import { FilePreview, FileThumbnail } from "../components/FilePreview";
import { findTranscriptMatches } from "../lib/transcriptSearch";
import { useEffect, useMemo, useRef, useState } from "react";
import { isMac, modKey } from "../lib/platform";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FilePlus2,
  FileText,
  FolderOpen,
  GitBranch,
  GitMerge,
  Globe,
  LayoutGrid,
  List,
  MessagesSquare,
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
import { invalidateQuery, prefetch, patchCachedSession, saveSetting, useDebouncedValue, useLoad } from "../lib/hooks";
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
  } catch (e) {
    patchCachedSession(id, { pinned: !pinned });
    toast({ key: `pin-${id}`, kind: "error", text: `Couldn't ${pinned ? "pin" : "unpin"} “${title}”: ${errorText(e)}` });
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
  const navigate = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const settings = useApp((s) => s.settings);
  const setListView = useApp((s) => s.setListView);
  const setQ = (v: string) => setListView({ q: v, page: 0 });
  const debouncedQ = useDebouncedValue(q);
  const setFilter = (v: Filter) => setListView({ filter: v, page: 0, selected: [] });
  const setPage = (v: number) => setListView({ page: v });
  const selected = useMemo(() => new Set(picked), [picked]);
  const setSelected = (n: Set<string>) => setListView({ selected: [...n] });
  const [syncing, setSyncing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [handoff, setHandoff] = useState<{ ids: string[]; action: HandoffAction } | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<{ id: string; title: string } | null>(null);
  const [confirmRestoreBulk, setConfirmRestoreBulk] = useState<string[] | null>(null);
  const [confirmPurge, setConfirmPurge] = useState<string[] | null>(null);
  const [purging, setPurging] = useState(false);
  const [purgeError, setPurgeError] = useState("");
  const limitChoice = useApp((s) => s.listView.limit);
  const hideUnanswered = useApp((s) => s.listView.hideUnanswered);
  const [listRef, autoPageSize] = useFitRows<HTMLDivElement>(52, 10);
  const togglePin = (r: SessionRow) => void setPinned(r.id, !r.pinned, r.title);
  const automaticPageSize = settings.sessionLayout === "thumbnails" ? 12 : settings.sessionGroup === "none" ? autoPageSize : 10;
  const pageSize = Math.min(200, Math.max(10, limitChoice === "auto" ? automaticPageSize : limitChoice));

  const query = { q: debouncedQ, filter, provider: providerFilter, model: modelFilter, resource: resourceFilter,
    hideUnanswered, offset: page * pageSize, limit: pageSize,
    searchProviders: TARGETS.filter((t) => t.label.toLowerCase().includes(debouncedQ.trim().toLowerCase())).map((t) => t.id) };
  const { data, error, loading, reload } = useLoad(() => api.querySessions(query), ["session-page", query]);
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pg = Math.floor((data?.offset ?? 0) / pageSize);
  const pageRows = rows;
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
    const extra = new Set((data?.providers ?? []).filter((id) => id && !known.has(id)));
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
  }, [data?.providers, providerFilter]);
  const modelOptions = useMemo<SelectOption[]>(() => {
    const models = new Set(data?.models ?? []);
    if (modelFilter !== "all") models.add(modelFilter);
    return [
      { value: "all", label: "All models", icon: <SparkIcon size={14} className="text-muted" /> },
      ...[...models].sort((a, b) => a.localeCompare(b)).map((model) => ({
        value: model,
        label: model === "__unknown" ? "Unknown model" : model,
        icon: <Bot size={14} className="text-muted" />,
      })),
    ];
  }, [data?.models, modelFilter]);
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
  const unanswered = data?.counts.unanswered ?? 0;
  const groups = useMemo(() => groupSessions(pageRows, settings.sessionGroup), [pageRows, settings.sessionGroup]);
  const hasQueryOrFilter = q || filter !== "all" || providerFilter !== "all" || modelFilter !== "all" || resourceFilter !== "all" || hideUnanswered;
  const clearFilters = () => setListView({ q: "", filter: "all", provider: "all", model: "all", resource: "all", hideUnanswered: false, page: 0 });
  const ids = [...selected];

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
    prefetch(sessionLoader(r.id), ["session", r.id]);
    navigate({ page: "sessions", id: r.id });
  };
  const sessionAction = (r: SessionRow, on: boolean) =>
    filter === "hidden" ? (
      <>
        <Button size="sm" variant="secondary" icon={<RotateCcw size={13} />} onClick={() => setConfirmRestore({ id: r.id, title: r.title })}>Restore</Button>
        <IconButton label={`Permanently delete ${r.title}`} onClick={() => { setConfirmPurge([r.id]); setPurgeError(""); }}><Trash2 size={14} /></IconButton>
      </>
    ) : (
      <Button size="sm" variant={on ? "secondary" : "primary"} icon={<Copy size={13} />} onClick={() => copy([r.id])} title={`Copy for ${target(settings.defaultTarget).label}`}>
        Copy
      </Button>
    );
  const titleLine = (r: SessionRow) => (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate font-medium">{r.title}</span>
      {r.pinned && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-accent/30 bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-accent shadow-xs">
          <Pin size={10} filled className="shrink-0 fill-current" />
          <span>Pinned</span>
        </span>
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
          onMouseEnter={() => prefetch(sessionLoader(r.id), ["session", r.id])}
          onFocus={() => prefetch(sessionLoader(r.id), ["session", r.id])}
          onClick={() => openSession(r)}
          className="min-w-0 flex-1 text-left"
        >
          {titleLine(r)}
          <span className="mt-0.5 block truncate font-mono text-[11px] text-faint" title={r.origin ?? undefined}>{meta(r)}</span>
        </button>
        {r.fileCount > 0 && <span className="hidden items-center gap-1 font-mono text-[11px] text-faint sm:flex" title={plural(r.fileCount, "file")}><Paperclip size={12} /> {r.fileCount}</span>}
        {filter !== "hidden" && <PinButton compact pinned={r.pinned} onToggle={() => togglePin(r)} />}
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
          <button type="button" onMouseEnter={() => prefetch(sessionLoader(r.id), ["session", r.id])} onFocus={() => prefetch(sessionLoader(r.id), ["session", r.id])} onClick={() => openSession(r)} className="min-w-0 flex-1 text-left">
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
          {filter !== "hidden" && <PinButton compact pinned={r.pinned} onToggle={() => togglePin(r)} />}
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
            {ids.length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] font-medium">{plural(ids.length, "session")} selected</span>
                <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
                <div className="flex-1" />
                {filter === "hidden" ? (
                  <><Button
                    size="sm"
                    variant="secondary"
                    icon={<RotateCcw size={13} />}
                    onClick={() => setConfirmRestoreBulk(ids)}
                  >
                    Restore {plural(ids.length, "session")}
                  </Button>
                  <Button size="sm" variant="danger" icon={<Trash2 size={13} />} onClick={() => { setConfirmPurge(ids); setPurgeError(""); }}>Permanently delete {plural(ids.length, "session")}</Button></>
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
            )}
              <Pagination
                page={pg}
                pageSize={pageSize}
                total={total}
                onPage={setPage}
                noun="session"
                limitOptions={["auto", 10, 25, 50, 100] as const}
                currentLimit={limitChoice}
                onLimitChange={onLimitChange}
              />
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
      {confirmPurge && <AlertDialog title={`Permanently delete ${plural(confirmPurge.length, "session")}?`}
        description={<>This permanently deletes these hidden sessions from Hopilo and cannot be undone. Original agent files stay on disk. If their source is still configured and available, sync can import these sessions again. Remove the original source or its configuration to stop re-import. Saved snapshots and shared file bytes remain.{purgeError && <span role="alert" className="mt-2 block text-danger">{purgeError}</span>}</>}
        confirmLabel="Permanently delete" loading={purging} onClose={() => setConfirmPurge(null)} onConfirm={async () => {
          setPurging(true); setPurgeError("");
          try {
            await api.permanentlyDeleteSessions(confirmPurge);
            setConfirmPurge(null); setSelected(new Set()); invalidateQuery(); useApp.getState().bump(); reload();
            toast({ kind: "success", text: "Hidden sessions permanently deleted." });
          } catch (error) { setPurgeError(errorText(error)); } finally { setPurging(false); }
        }} />}
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

export function FilesTab({ files, sessionId }: { files: Attachment[]; sessionId: string }) {
  const toast = useApp((s) => s.toast);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [infoFile, setInfoFile] = useState<Attachment | null>(null);
  const [removeFile, setRemoveFile] = useState<Attachment | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");

  if (files.length === 0)
    return (
      <div className="flex h-full min-h-[300px] flex-1 items-center justify-center p-8">
        <EmptyState icon={<Paperclip size={20} />} title="No files" body="Files shared in this conversation show up here. Add more with Add files." />
      </div>
    );
  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-auto p-5">
      <ul aria-label="Session files" className="grid grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))] gap-3">
        {files.map((file) => <FileTile key={file.id} file={file}
          onOpen={() => setPreview(file)}
          onInfo={() => setInfoFile(file)}
          onRemove={file.manualMessageId ? () => { setRemoveFile(file); setRemoveError(""); } : undefined}
        />)}
      </ul>
      {removeFile && <AlertDialog title="Delete added file?"
        description={<>Delete “{removeFile.fileName}” from this session? Its upload message is removed when no files remain in it. Original files, other sessions and saved snapshots stay intact.{removeError && <span role="alert" className="mt-2 block text-danger">{removeError}</span>}</>}
        confirmLabel="Delete file" loading={removing} onClose={() => setRemoveFile(null)} onConfirm={async () => {
          if (!removeFile.manualMessageId) return;
          setRemoving(true); setRemoveError("");
          try {
            await api.removeSessionFile(sessionId, removeFile.manualMessageId, removeFile.sha256, removeFile.fileName);
            setRemoveFile(null); setInfoFile(null); setPreview(null);
            invalidateQuery(); useApp.getState().bump();
            toast({ kind: "success", text: `Deleted ${removeFile.fileName} from this session.` });
          } catch (error) { setRemoveError(errorText(error)); }
          finally { setRemoving(false); }
        }} />}
      {preview && <FilePreview file={preview} onClose={() => setPreview(null)} />}
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
                onClick={() => { setPreview(infoFile); setInfoFile(null); }}
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

function FileTile({ file, onOpen, onInfo, onRemove }: {
  file: Attachment; onOpen: () => void; onInfo: () => void; onRemove?: () => void;
}) {
  const tileRef = useRef<HTMLLIElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!tileRef.current || typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      setNear(!!entry?.isIntersecting);
    }, { rootMargin: "300px" });
    observer.observe(tileRef.current); return () => observer.disconnect();
  }, []);
  return <li ref={tileRef} className="group min-w-0 overflow-hidden rounded-2xl border border-line bg-surface shadow-item transition hover:border-accent/40">
    <button type="button" aria-label={`Preview ${file.fileName}`} onClick={onOpen} className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-surface-2">
      <FileThumbnail file={file} near={near} />
    </button>
    <div className="flex items-center justify-between gap-1.5 px-3 py-2">
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[12.5px] font-medium text-ink">{file.fileName}</span>
        <span className="block font-mono text-[10.5px] text-faint">{bytes(file.size)} · {file.manualMessageId ? "Added in Hopilo" : "From session"}</span>
      </button>
      <ActionMenu label={`Actions for ${file.fileName}`} items={[
        { label: "Open", icon: <FolderOpen size={14} />, onSelect: onOpen },
        { label: "Download", icon: <Download size={14} />, onSelect: () => { void saveFileAs(file.sha256, file.fileName); } },
        { label: "Details", icon: <FileText size={14} />, onSelect: onInfo },
        ...(onRemove ? [{ label: "Delete", icon: <Trash2 size={14} />, danger: true, onSelect: onRemove }] : []),
      ]} />
    </div>
  </li>;
}

function SessionPage({ id }: { id: string }) {
  const { data, error, loading } = useLoad(sessionLoader(id), ["session", id]);
  const navigate = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const [tab, setTab] = useState<"conversation" | "files">("conversation");
  const [transcriptView, setTranscriptView] = useState<"preview" | "source">("preview");
  const [search, setSearch] = useState("");
  const searchQuery = useDebouncedValue(search);
  const [matchIndex, setMatchIndex] = useState(0);
  const [activeMatchId, setActiveMatchId] = useState<string | undefined>();
  const [activeMessageId, setActiveMessageId] = useState<string | undefined>();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [handoff, setHandoff] = useState<{ ids: string[]; action: HandoffAction } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeError, setPurgeError] = useState("");
  const [paths, setPaths] = useState<string[] | null>(null);
  const back = () => navigate({ page: "sessions" });

  const messages = data?.messages;
  const searchResults = useMemo(() => findTranscriptMatches(messages ?? [], searchQuery), [messages, searchQuery]);
  const matches = searchResults.matches;

  const jumpTo = (targetIdx: number) => {
    if (matches.length === 0) return;
    const clamped = (targetIdx + matches.length) % matches.length;
    setMatchIndex(clamped);
    const target = matches[clamped];
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


  if (error) return <ErrorNote text={error} />;
  if (loading && !data) return <SessionPageSkeleton />;
  if (!data) return null;
  const { row, source, files, tokenEstimate } = data;
  const agent = row.kind === "local-agent";
  const togglePin = () => void setPinned(id, !row.pinned, row.title);

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
            {row.hidden && <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => { setConfirmPurge(true); setPurgeError(""); }}>Permanently delete</Button>}
            {!row.hidden && <PinButton pinned={row.pinned} onToggle={togglePin} />}
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
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2.5 border-b border-line px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <Segmented
              label="View"
              value={tab}
              onChange={(v) => setTab(v as "conversation" | "files")}
              options={[
                { value: "conversation", label: "Conversation" },
                { value: "files", label: files.length ? `Files (${files.length})` : "Files" },
              ]}
            />
            {tab === "conversation" && <Segmented label="Transcript view" value={transcriptView} onChange={setTranscriptView}
              options={[{ value: "preview", label: "Preview" }, { value: "source", label: "Source" }]} />}
          </div>

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
                    {matches.length ? `${matchIndex + 1}/${matches.length}${searchResults.truncated ? "+" : ""}` : "0/0"}
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
              files={files}
              view={transcriptView}
              activeMatchId={activeMatchId}
              activeMessageId={activeMessageId}
              searchQuery={searchQuery}
            />
          </div>
        ) : (
          <FilesTab files={files} sessionId={id} />
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
      {confirmPurge && <AlertDialog title="Permanently delete hidden session?" description={<>Permanently delete “{row.title}” from Hopilo? This cannot be undone. Original agent files, saved snapshots and shared file bytes remain. If its source is still configured and available, sync can import it again. Remove the original source or its configuration to stop re-import.{purgeError && <span role="alert" className="mt-2 block text-danger">{purgeError}</span>}</>}
        confirmLabel="Permanently delete" loading={purging} onClose={() => setConfirmPurge(false)} onConfirm={async () => {
          setPurging(true); setPurgeError("");
          try { await api.permanentlyDeleteSessions([id]); invalidateQuery(); useApp.getState().bump(); back(); }
          catch (error) { setPurgeError(errorText(error)); } finally { setPurging(false); }
        }} />}
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
