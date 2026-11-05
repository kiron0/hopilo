import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Copy,
  Download,
  FileImage,
  FilePlus2,
  FileText,
  FolderOpen,
  Globe,
  LayoutGrid,
  List,
  Loader2,
  MessagesSquare,
  Paperclip,
  Pin,
  Plus,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  SparkIcon,
  ToolsIcon,
  Trash2,
  X,
} from "../components/Icons";
import { api, errorText, type Attachment, type Level, type SessionRow } from "../lib/api";
import { copySessions, exportSessionsAs, FORMATS, type Format, pickFiles, saveFileAs } from "../lib/actions";
import { basename, bytes, plural, provider, relativeTime, tokens } from "../lib/format";
import { prefetch, saveSetting, useLoad } from "../lib/hooks";
import { type SessionFilter, useApp } from "../lib/store";
import { target, TARGETS } from "../lib/targets";
import { Transcript } from "../components/Transcript";
import { AddSessionModal } from "../components/AddSession";
import { FileImportModal } from "../components/FileImport";
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
  TargetSelect,
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

const LEVELS: { value: Level; label: string }[] = [
  { value: "full", label: "Full" },
  { value: "balanced", label: "Balanced" },
  { value: "minimal", label: "Minimal" },
];

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

const FORMAT_KEYS = Object.keys(FORMATS) as Format[];
const EXPORT_PICK_KEY = "hopilo.exportFormats";

function loadPicked(): Format[] {
  try {
    const raw = JSON.parse(localStorage.getItem(EXPORT_PICK_KEY) ?? "[]");
    const valid = Array.isArray(raw) ? FORMAT_KEYS.filter((f) => raw.includes(f)) : [];
    return valid.length ? valid : ["md"];
  } catch {
    return ["md"];
  }
}

function savePicked(f: Format[]) {
  try {
    localStorage.setItem(EXPORT_PICK_KEY, JSON.stringify(f));
  } catch {}
}

function FormatThumb({ format }: { format: Format }) {
  const line = "h-[3px] rounded-full bg-current opacity-25";
  return (
    <div aria-hidden className="relative mx-auto flex h-[62px] w-[50px] flex-col gap-[5px] rounded-[7px] border border-line bg-card px-[7px] pt-[9px] shadow-item">
      {format === "md" && (
        <>
          <div className="h-[4px] w-[70%] rounded-full bg-current opacity-60" />
          <div className={cx(line, "w-full")} />
          <div className={cx(line, "w-[85%]")} />
          <div className="flex gap-[3px]"><div className="h-[3px] w-[3px] rounded-full bg-current opacity-40" /><div className={cx(line, "w-[70%]")} /></div>
          <div className="flex gap-[3px]"><div className="h-[3px] w-[3px] rounded-full bg-current opacity-40" /><div className={cx(line, "w-[55%]")} /></div>
        </>
      )}
      {format === "txt" && [100, 92, 100, 74, 88].map((w, i) => <div key={i} className={line} style={{ width: `${w}%` }} />)}
      {format === "json" && (
        <div className="font-mono text-[7px] leading-[9px] opacity-60">
          {"{"}
          <div className="pl-[5px]">"id": …</div>
          <div className="pl-[5px]">"msgs": [ ]</div>
          {"}"}
        </div>
      )}
      {format === "handoff" && (
        <>
          <div className="mx-auto h-[22px] w-[4px] bg-[repeating-linear-gradient(to_bottom,currentColor_0_3px,transparent_3px_6px)] opacity-40" />
          <div className="mx-auto h-[8px] w-[10px] rounded-[2px] border border-current opacity-50" />
        </>
      )}
      <span className="absolute -bottom-[7px] left-1/2 -translate-x-1/2 rounded-[5px] bg-surface-3 px-[5px] py-px font-mono text-[9px] font-semibold uppercase tracking-wide text-muted">
        .{FORMATS[format].ext}
      </span>
    </div>
  );
}

function ExportModal({ ids, level, onClose }: { ids: string[]; level: Level; onClose: () => void }) {
  const [picked, setPicked] = useState<Format[]>(loadPicked);
  const [busy, setBusy] = useState(false);
  const toggle = (f: Format) =>
    setPicked((p) => {
      const next = p.includes(f) ? p.filter((x) => x !== f) : FORMAT_KEYS.filter((x) => x === f || p.includes(x));
      savePicked(next);
      return next;
    });
  const label =
    picked.length === 0
      ? "Export"
      : picked.length === 1
      ? `Export ${FORMATS[picked[0]].name}`
      : picked.length === FORMAT_KEYS.length
      ? "Export all as .zip"
      : `Export ${picked.length} as .zip`;

  return (
    <Modal
      title={ids.length > 1 ? `Export ${ids.length} sessions` : "Export session"}
      onClose={onClose}
      wide
      footer={(close) => (
        <>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={picked.length === 0}
            onClick={async () => {
              setBusy(true);
              try {
                if (await exportSessionsAs(ids, picked, { level })) close();
              } finally {
                setBusy(false);
              }
            }}
          >
            {label}
          </Button>
        </>
      )}
    >
      <div role="group" aria-label="Formats" className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {FORMAT_KEYS.map((f) => {
          const on = picked.includes(f);
          return (
            <label
              key={f}
              className={cx(
                "relative flex cursor-pointer flex-col items-center gap-3 rounded-2xl border px-2.5 pb-3 pt-4 text-center transition-all",
                on ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-surface text-faint hover:border-line-strong hover:bg-surface-2",
              )}
            >
              <span className="absolute right-2.5 top-2.5 flex">
                <Checkbox label={`Include ${FORMATS[f].name}`} checked={on} onChange={() => toggle(f)} />
              </span>
              <FormatThumb format={f} />
              <span className="mt-1 block">
                <span className="block text-[13px] font-semibold text-ink">{FORMATS[f].name}</span>
                <span className="mt-0.5 block text-[11px] text-faint">{FORMATS[f].hint}</span>
              </span>
            </label>
          );
        })}
      </div>
      <p className="mt-3 text-[12px] text-faint">
        {picked.length > 1 ? "Several formats are saved together in one .zip file." : "Pick more than one format to get them all in a single .zip."}
      </p>
    </Modal>
  );
}

function SessionList() {
  const { q, filter, provider: providerFilter, model: modelFilter, resource: resourceFilter, page, selected: picked } = useApp((s) => s.listView);
  const { data, error, loading, reload } = useLoad(() => (filter === "hidden" ? api.listHiddenSessions() : api.listSessions()), [filter]);
  const navigate = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const settings = useApp((s) => s.settings);
  const setListView = useApp((s) => s.setListView);
  const setQ = (v: string) => setListView({ q: v, page: 0 });
  const setFilter = (v: Filter) => setListView({ filter: v, page: 0 });
  const setPage = (v: number) => setListView({ page: v });
  const selected = useMemo(() => new Set(picked), [picked]);
  const setSelected = (n: Set<string>) => setListView({ selected: [...n] });
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<{ id: string; title: string } | null>(null);
  const [confirmRestoreBulk, setConfirmRestoreBulk] = useState<string[] | null>(null);
  const limitChoice = useApp((s) => s.listView.limit);
  const hideUnanswered = useApp((s) => s.listView.hideUnanswered);
  const [listRef, autoPageSize] = useFitRows<HTMLDivElement>(52, 10);
  const automaticPageSize = settings.sessionLayout === "thumbnails" ? 12 : settings.sessionGroup === "none" ? autoPageSize : 10;
  const pageSize = Math.max(10, limitChoice === "auto" ? automaticPageSize : limitChoice);

  const onLimitChange = (lim: number | "auto") => setListView({ limit: lim, page: 0 });

  const sync = async (manual: boolean) => {
    if (syncing) return;
    lastSync = Date.now();
    setSyncing(true);
    try {
      const r = await api.syncSessions();
      reload();
      if (manual) {
        const changed = r.added + r.updated;
        const parts = [r.added && `${r.added} new`, r.updated && `${r.updated} updated`, r.failed && `${r.failed} unreadable`].filter(Boolean);
        toast({
          kind: r.failed && !changed ? "warning" : "success",
          text: parts.length ? `Sessions synced: ${parts.join(", ")}` : `Up to date · ${plural(r.found, "session")} in agent folders`,
        });
      }
    } catch (e) {
      if (manual) toast({ kind: "error", text: `Could not check agent folders: ${errorText(e)}` });
    } finally {
      setSyncing(false);
    }
  };
  useEffect(() => {
    if (Date.now() - lastSync > SYNC_EVERY_MS) sync(false);
  }, []);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter(
      (r) =>
        matches(r, filter) &&
        (providerFilter === "all" || r.provider === providerFilter) &&
        (modelFilter === "all" || (r.model?.trim() || "__unknown") === modelFilter) &&
        (resourceFilter === "all" || (resourceFilter === "with-files" ? r.fileCount > 0 : r.fileCount === 0)) &&
        !(hideUnanswered && isUnanswered(r)) &&
        (!needle || r.title.toLowerCase().includes(needle) || (r.project ?? "").toLowerCase().includes(needle) || (r.model ?? "").toLowerCase().includes(needle) || provider(r.provider).label.toLowerCase().includes(needle) || r.tags.some((t) => t.includes(needle))),
    );
  }, [data, q, filter, providerFilter, modelFilter, resourceFilter, hideUnanswered]);
  const providerOptions = useMemo<SelectOption[]>(() => {
    const list: SelectOption[] = [{ value: "all", label: "All tools", icon: <ToolsIcon size={14} className="text-muted" /> }];
    const targets = TARGETS.filter((t) => t.id !== "other")
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "chat" ? -1 : 1))
      .map((t) => ({
        value: t.id,
        label: t.label,
        group: t.kind === "chat" ? "Chat apps" : "Coding agents & editors",
        icon: <ProviderLogo id={t.id} size={14} className="text-muted" />,
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
          icon: <ProviderLogo id={id} size={14} className="text-muted" />,
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
  const pageRows = rows.slice(pg * pageSize, pg * pageSize + pageSize);
  const groups = useMemo(() => groupSessions(pageRows, settings.sessionGroup), [pageRows, settings.sessionGroup]);
  const hasQueryOrFilter = q || filter !== "all" || providerFilter !== "all" || modelFilter !== "all" || resourceFilter !== "all" || hideUnanswered;
  const known = useMemo(() => new Set((data ?? []).map((r) => r.id)), [data]);
  const ids = [...selected].filter((id) => known.has(id));

  const toggle = (id: string) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSelected(n);
  };
  const copy = async (list: string[]) => {
    setBusy(list.join());
    await copySessions(list);
    setBusy(null);
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
      <Button size="sm" variant={on ? "secondary" : "primary"} busy={busy === r.id} icon={<Copy size={13} />} onClick={() => copy([r.id])} title={`Copy for ${target(settings.defaultTarget).label}`}>
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
          onMouseEnter={() => prefetch(sessionLoader(r.id), [r.id])}
          onFocus={() => prefetch(sessionLoader(r.id), [r.id])}
          onClick={() => openSession(r)}
          className="min-w-0 flex-1 text-left"
        >
          {titleLine(r)}
          <span className="mt-0.5 block truncate font-mono text-[11px] text-faint" title={r.origin ?? undefined}>{meta(r)}</span>
        </button>
        {r.fileCount > 0 && <span className="hidden items-center gap-1 font-mono text-[11px] text-faint sm:flex" title={plural(r.fileCount, "file")}><Paperclip size={12} /> {r.fileCount}</span>}
        {sessionAction(r, on)}
      </div>
    );
  };
  const thumbnail = (r: SessionRow) => {
    const on = selected.has(r.id);
    return (
      <article key={r.id} className={cx("flex min-h-44 flex-col rounded-2xl border p-3.5 shadow-item transition-colors", on ? "border-accent bg-accent-soft/60" : "border-line bg-card hover:border-line-strong hover:bg-surface-2/50")}>
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
          <span className="truncate text-[11.5px] text-faint">{provider(r.provider).label}</span>
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
            <SearchField label="Filter sessions" placeholder="Search title, folder, tool, model or tag" value={q} onChange={setQ} className="min-w-0 flex-1" />
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
          />
        </Card>
      )}
      {rows.length > 0 && (
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
            {groups.map((group) => (
              <section key={group.key} aria-label={group.label || "Sessions"} className={settings.sessionGroup === "none" ? undefined : "border-b border-line last:border-b-0"}>
                {group.label && (
                  <div className="flex items-center gap-2 border-b border-line bg-surface-2/70 px-4 py-2">
                    <h2 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-muted" title={group.key === "__none" ? undefined : group.key}>{group.label}</h2>
                    <span className="font-mono text-[10.5px] text-faint">{group.rows.length}</span>
                  </div>
                )}
                <div className={settings.sessionLayout === "thumbnails" ? "grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3" : "divide-y divide-line"}>
                  {group.rows.map(settings.sessionLayout === "thumbnails" ? thumbnail : listRow)}
                </div>
              </section>
            ))}
          </div>
          <div className="shrink-0 border-t border-line bg-surface-2/50 px-4 py-2.5">
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
                    <Button size="sm" icon={<Download size={13} />} onClick={() => setExporting(true)}>
                      Export
                    </Button>
                    <Button size="sm" variant="primary" busy={busy === ids.join()} icon={<Copy size={13} />} onClick={() => copy(ids)}>
                      {ids.length > 1 ? "Copy together" : "Copy"}
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
      {exporting && <ExportModal ids={ids} level={settings.level} onClose={() => setExporting(false)} />}
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
              toast({ kind: "error", text: errorText(err) });
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
            try {
              for (const sid of confirmRestoreBulk) {
                await api.restoreSession(sid);
              }
              reload();
              setSelected(new Set());
              toast({ kind: "success", text: `Restored ${plural(confirmRestoreBulk.length, "session")} to Sessions` });
              setConfirmRestoreBulk(null);
            } catch (err) {
              toast({ kind: "error", text: errorText(err) });
            }
          }}
        />
      )}
    </FillPage>
  );
}

function FilesTab({ files }: { files: Attachment[] }) {
  const toast = useApp((s) => s.toast);
  if (files.length === 0)
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center p-8">
        <EmptyState icon={<Paperclip size={20} />} title="No files" body="Files shared in this conversation show up here. Add more with Add files." />
      </div>
    );
  return (
    <div className="min-h-0 flex-1 overflow-auto p-5">
      <ul className="divide-y divide-line rounded-2xl border border-line">
        {files.map((f) => {
          const Icon = f.mediaType.startsWith("image/") ? FileImage : FileText;
          return (
            <li key={f.sha256} className="flex items-center gap-3 px-3.5 py-2.5">
              <Icon size={16} className="shrink-0 text-faint" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium" data-selectable>{f.fileName}</div>
                <div className="font-mono text-[11px] text-faint">
                  {bytes(f.size)} · {f.mediaType || "file"} · {f.text != null ? "included as text when copied" : "attach it yourself when you paste"}
                </div>
              </div>
              <Button size="sm" variant="ghost" icon={<FolderOpen size={13} />} onClick={() => api.openFile(f.sha256).catch((e) => toast({ kind: "error", text: errorText(e) }))}>
                Open
              </Button>
              <Button size="sm" icon={<Download size={13} />} onClick={() => saveFileAs(f.sha256, f.fileName)}>
                Save
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SessionPage({ id }: { id: string }) {
  const { data, error, loading } = useLoad(sessionLoader(id), [id]);
  const navigate = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const settings = useApp((s) => s.settings);
  const [tab, setTab] = useState<"conversation" | "markdown" | "files">("conversation");
  const [to, setTo] = useState(settings.defaultTarget);
  const [level, setLevel] = useState<Level>(settings.level);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [paths, setPaths] = useState<string[] | null>(null);
  const back = () => navigate({ page: "sessions" });

  if (error) return <ErrorNote text={error} />;
  if (loading && !data) return <SessionPageSkeleton />;
  if (!data) return null;
  const { row, source, messages, files, tokenEstimate } = data;
  const agent = row.kind === "local-agent";

  const copy = async (markdown = false) => {
    setBusy(true);
    await copySessions([id], { target: to, level, markdown });
    setBusy(false);
  };
  const remove = async () => {
    try {
      await api.removeSession(id);
      setConfirmDelete(false);
      back();
    } catch (e) {
      toast({ kind: "error", text: errorText(e) });
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
            <span>· {plural(messages.length, "message")}</span>
            <span>· ~{tokens(tokenEstimate)} tokens</span>
            <span>· {relativeTime(row.updatedAt)}</span>
            {row.lastCopiedAt && <span>· copied {relativeTime(row.lastCopiedAt)}</span>}
          </span>
        }
        actions={
          <>
            <StatusBadge status={source.captureStatus} />
            <button
              type="button"
              onClick={() => api.updateSession(id, { pinned: !row.pinned })}
              className={cx(
                "inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-[12px] font-medium transition-all cursor-pointer",
                row.pinned
                  ? "border border-accent/40 bg-accent-soft text-accent shadow-xs hover:bg-accent-soft/80 active:scale-[0.98]"
                  : "border border-line bg-surface text-muted hover:border-line-strong hover:text-ink active:scale-[0.98]"
              )}
              title={row.pinned ? "Pinned to top · Click to unpin" : "Pin to the top"}
            >
              <Pin size={13} filled={row.pinned} className={row.pinned ? "fill-current" : "-rotate-45 text-muted"} />
              <span>{row.pinned ? "Pinned" : "Pin"}</span>
            </button>
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
      <PageToolbar>
        <span className="text-[12.5px] font-medium text-muted">Continue in</span>
        <div className="w-52 shrink-0">
          <TargetSelect value={to} onChange={setTo} />
        </div>
        <Segmented label="How much to include" value={level} onChange={setLevel} options={LEVELS} />
        <Button variant="primary" busy={busy} icon={<Copy size={14} />} onClick={() => copy()}>
          Copy
        </Button>
        <div className="flex-1" />
        <Button size="sm" icon={<Copy size={13} />} onClick={() => copy(true)}>
          Copy Markdown
        </Button>
        <Button size="sm" icon={<Download size={13} />} onClick={() => setExporting(true)}>
          Export
        </Button>
        <Button size="sm" icon={<FilePlus2 size={13} />} onClick={async () => { const p = await pickFiles(); if (p.length) setPaths(p); }}>
          Add files
        </Button>
      </PageToolbar>

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
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
          <Segmented
            label="View"
            value={tab}
            onChange={(v) => setTab(v as "conversation" | "markdown" | "files")}
            options={[
              { value: "conversation", label: "Conversation" },
              { value: "markdown", label: "Markdown" },
              { value: "files", label: files.length ? `Files (${files.length})` : "Files" },
            ]}
          />
          {busy && <Loader2 size={14} className="animate-spin text-accent" />}
        </div>
        {tab === "conversation" || tab === "markdown" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-auto p-5">
            <Transcript messages={messages} renderMarkdown={tab === "markdown"} />
          </div>
        ) : (
          <FilesTab files={files} />
        )}
      </Card>
      {exporting && <ExportModal ids={[id]} level={level} onClose={() => setExporting(false)} />}
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
