import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Copy, Download, FileImage, FilePlus2, FileText, FolderOpen, Loader2, MessagesSquare, Paperclip, Pin, Plus, RefreshCw, Trash2, X } from "../components/Icons";
import { api, errorText, type Attachment, type Level, type SessionRow } from "../lib/api";
import { copySessions, exportSessions, FORMATS, type Format, pickFiles, saveFileAs } from "../lib/actions";
import { basename, bytes, plural, provider, relativeTime, tokens } from "../lib/format";
import { prefetch, useLoad } from "../lib/hooks";
import { type SessionFilter, useApp } from "../lib/store";
import { target } from "../lib/targets";
import { Transcript } from "../components/Transcript";
import { AddSessionModal } from "../components/AddSession";
import { FileImportModal } from "../components/FileImport";
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
  useModalClose,
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

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "agents", label: "Coding agents" },
  { value: "web", label: "Web chats" },
  { value: "added", label: "Added" },
  { value: "pinned", label: "Pinned" },
];

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
    basename(r.project),
    plural(r.messageCount, "message"),
    r.fileCount ? plural(r.fileCount, "file") : "",
    relativeTime(r.updatedAt),
  ]
    .filter(Boolean)
    .join(" · ");
}

function ExportModalBody({ ids, level }: { ids: string[]; level: Level }) {
  const close = useModalClose();
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {(Object.keys(FORMATS) as Format[]).map((f) => (
        <button
          key={f}
          type="button"
          onClick={async () => {
            if (await exportSessions(ids, f, { level })) close?.();
          }}
          className="card card-sm p-3.5 text-left transition-all hover:-translate-y-px hover:shadow-pop"
        >
          <span className="block text-[13px] font-semibold">{FORMATS[f].name}</span>
          <span className="mt-0.5 block font-mono text-[11px] text-faint">.{FORMATS[f].ext} · {FORMATS[f].hint}</span>
        </button>
      ))}
    </div>
  );
}

function ExportModal({ ids, level, onClose }: { ids: string[]; level: Level; onClose: () => void }) {
  return (
    <Modal title={ids.length > 1 ? `Export ${ids.length} sessions` : "Export session"} onClose={onClose}>
      <ExportModalBody ids={ids} level={level} />
    </Modal>
  );
}

function SessionList() {
  const { data, error, loading } = useLoad(() => api.listSessions());
  const navigate = useApp((s) => s.navigate);
  const settings = useApp((s) => s.settings);

  const { q, filter, page, selected: picked } = useApp((s) => s.listView);
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
  const [limitChoice, setLimitChoice] = useState<number | "auto">("auto");
  const [listRef, autoPageSize] = useFitRows<HTMLDivElement>(52, 10);
  const pageSize = Math.max(10, limitChoice === "auto" ? autoPageSize : limitChoice);

  const onLimitChange = (lim: number | "auto") => {
    setLimitChoice(lim);
    setPage(0);
  };

  const sync = async () => {
    lastSync = Date.now();
    setSyncing(true);
    await api.syncSessions().catch(() => undefined);
    setSyncing(false);
  };
  useEffect(() => {
    if (Date.now() - lastSync > SYNC_EVERY_MS) sync();
  }, []);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter(
      (r) =>
        matches(r, filter) &&
        (!needle || r.title.toLowerCase().includes(needle) || (r.project ?? "").toLowerCase().includes(needle) || provider(r.provider).label.toLowerCase().includes(needle) || r.tags.some((t) => t.includes(needle))),
    );
  }, [data, q, filter]);
  const pg = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
  const ids = [...selected].filter((id) => data?.some((r) => r.id === id));

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
        <SearchField label="Filter sessions" placeholder="Search by title, project, tool or tag" value={q} onChange={setQ} className="flex-1" />
        <Segmented label="Show" value={filter} onChange={setFilter} options={FILTERS} />
        <IconButton label="Check agent folders for new sessions" onClick={sync} className="h-9 w-9 rounded-full border border-line bg-card shadow-item">
          <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
        </IconButton>
      </PageToolbar>

      {error && <ErrorNote text={error} />}
      {loading && !data && <SessionListSkeleton />}
      {data && rows.length === 0 && (
        <Card className="flex min-h-0 flex-1 flex-col items-center justify-center p-8">
          <EmptyState
            icon={<MessagesSquare size={20} />}
            title={q || filter !== "all" ? "No matching sessions" : syncing ? "Looking for sessions…" : "No sessions yet"}
            body={
              q || filter !== "all"
                ? "Try a different search or filter."
                : "Sessions from Claude Code, Codex, Gemini CLI, OpenCode and Qwen Code appear here on their own. Save web chats with the browser extension, or use Add."
            }
          />
        </Card>
      )}
      {rows.length > 0 && (
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div ref={listRef} className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
            {rows.slice(pg * pageSize, pg * pageSize + pageSize).map((r) => {
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
                    onClick={() => navigate({ page: "sessions", id: r.id })}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{r.title}</span>
                      {r.pinned && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-accent/30 bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-accent shadow-xs">
                          <Pin size={10} filled className="shrink-0 fill-current" />
                          <span>Pinned</span>
                        </span>
                      )}
                      {r.missingCount > 0 && <AlertTriangle size={12} className="shrink-0 text-warning" aria-label="Partly captured" />}
                      {r.tags.slice(0, 2).map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-faint" title={r.origin ?? undefined}>
                      {meta(r)}
                    </span>
                  </button>
                  {r.fileCount > 0 && (
                    <span className="hidden items-center gap-1 font-mono text-[11px] text-faint sm:flex" title={plural(r.fileCount, "file")}>
                      <Paperclip size={12} /> {r.fileCount}
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant={on ? "secondary" : "primary"}
                    busy={busy === r.id}
                    icon={<Copy size={13} />}
                    onClick={() => copy([r.id])}
                    title={`Copy for ${target(settings.defaultTarget).label}`}
                  >
                    Copy
                  </Button>
                </div>
              );
            })}
          </div>
          <div className="shrink-0 border-t border-line bg-surface-2/50 px-4 py-2.5">
            {ids.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] font-medium">{plural(ids.length, "session")} selected</span>
                <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
                <div className="flex-1" />
                <Button size="sm" icon={<Download size={13} />} onClick={() => setExporting(true)}>
                  Export
                </Button>
                <Button size="sm" variant="primary" busy={busy === ids.join()} icon={<Copy size={13} />} onClick={() => copy(ids)}>
                  {ids.length > 1 ? "Copy together" : "Copy"}
                </Button>
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
  const settings = useApp((s) => s.settings);
  const toast = useApp((s) => s.toast);
  const [tab, setTab] = useState<"conversation" | "markdown" | "files">("conversation");
  const [to, setTo] = useState(settings.defaultTarget);
  const [level, setLevel] = useState<Level>(settings.level);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [paths, setPaths] = useState<string[] | null>(null);
  const back = () => navigate({ page: "sessions" });

  if (error) return <ErrorNote text={error} />;
  if (loading && !data) return <SessionPageSkeleton />;
  if (!data) return null;
  const { row, source, messages, files, tokenEstimate } = data;
  const canDelete = row.kind === "browser-chat";

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
            {canDelete && (
              <IconButton label="Delete" onClick={() => setConfirmDelete(true)}>
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
      {confirmDelete && canDelete && (
        <AlertDialog
          title="Delete session"
          description={`Delete “${row.title}” from Hopilo? This cannot be undone.`}
          confirmLabel="Delete"
          destructive
          onClose={() => setConfirmDelete(false)}
          onConfirm={remove}
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
