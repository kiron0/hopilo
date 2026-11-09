import { useEffect, useMemo, useRef, useState } from "react";
import { api, type SessionRow } from "../lib/api";
import { basename, plural, provider, relativeTime } from "../lib/format";
import { useDebouncedValue, useLoad } from "../lib/hooks";
import { Bot, CheckIcon, FolderOpen, Globe, MessagesSquare, Pin, Plus, ToolsIcon } from "./Icons";
import { Select, type SelectOption } from "./Select";
import { RowSkeleton } from "./Skeletons";
import { cx, EmptyState, Modal, Pagination, ProviderBadge, SearchField } from "./ui";

type Kind = "all" | "agents" | "web" | "added" | "pinned";

const KINDS: SelectOption[] = [
  { value: "all", label: "All", icon: <MessagesSquare size={14} className="text-muted" /> },
  { value: "agents", label: "Coding agents", icon: <Bot size={14} className="text-muted" /> },
  { value: "web", label: "Web chats", icon: <Globe size={14} className="text-muted" /> },
  { value: "added", label: "Added", icon: <Plus size={14} className="text-muted" /> },
  { value: "pinned", label: "Pinned", icon: <Pin size={14} filled className="text-accent" /> },
];

const LIMITS = [10, 25, 50, 100] as const;

export function SessionPickerModal({
  title = "Pick a session",
  selected,
  exclude = [],
  preferProject,
  onPick,
  onClose,
}: {
  title?: string;
  selected?: string;
  exclude?: string[];
  preferProject?: string | null;
  onPick: (row: SessionRow) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const needle = useDebouncedValue(q).trim().toLowerCase();
  const [kind, setKind] = useState<Kind>("all");
  const [tool, setTool] = useState("all");
  const [folder, setFolder] = useState(preferProject?.trim() || "all");
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState<number>(25);
  const [active, setActive] = useState(0);

  const query = { q: needle, filter: kind, provider: tool, folder, offset: page * limit, limit, exclude };
  const { data, loading } = useLoad(() => api.querySessions(query), ["picker-sessions", query]);
  const tools = useMemo<SelectOption[]>(
    () => [
      { value: "all", label: "All tools", icon: <ToolsIcon size={14} className="text-muted" /> },
      ...[...new Set(data?.providers ?? [])].sort().map((p) => ({ value: p, label: provider(p).label })),
    ],
    [data?.providers],
  );
  const folders = useMemo<SelectOption[]>(
    () => [
      { value: "all", label: "All folders", icon: <FolderOpen size={14} className="text-muted" /> },
      ...[...new Set(data?.folders ?? [])].sort().map((p) => ({ value: p, label: basename(p) || p })),
    ],
    [data?.folders],
  );

  useEffect(() => {
    if (data && folder !== "all" && !folders.some((f) => f.value === folder)) setFolder("all");
  }, [data, folders, folder]);

  const total = data?.total ?? 0;
  const pg = Math.floor((data?.offset ?? 0) / limit);
  const shown = data?.rows ?? [];
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
    setActive(0);
  }, [pg, limit]);

  useEffect(() => {
    setPage(0);
    setActive(0);
  }, [kind, tool, folder, needle, limit]);

  const pick = (r: SessionRow | undefined) => {
    if (!r) return;
    onPick(r);
    onClose();
  };

  const filtered = kind !== "all" || tool !== "all" || folder !== "all" || !!needle;

  return (
    <Modal title={title} onClose={onClose} wide>
      <div
        className="space-y-3"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(shown.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && shown[active]) {
            e.preventDefault();
            pick(shown[active]);
          }
        }}
      >
        <SearchField autoFocus label="Search sessions" placeholder="Search title, folder, tool, model or tag" value={q} onChange={setQ} />
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-40"><Select size="sm" label="Show" value={kind} options={KINDS} onChange={(v) => setKind(v as Kind)} /></div>
          <div className="w-44"><Select size="sm" label="Tool" value={tool} options={tools} onChange={setTool} /></div>
          <div className="w-48"><Select size="sm" label="Folder" value={folder} options={folders} onChange={setFolder} /></div>
          {filtered && (
            <button
              type="button"
              onClick={() => {
                setQ("");
                setKind("all");
                setTool("all");
                setFolder("all");
              }}
              className="text-[12px] font-medium text-accent hover:underline"
            >
              Clear
            </button>
          )}
          <span className="ml-auto font-mono text-[11px] text-faint">{plural(total, "session")}</span>
        </div>

        <div ref={listRef} className="h-[min(52vh,460px)] overflow-y-auto overscroll-contain rounded-xl border border-line bg-card">
          {loading && !data ? (
            <div className="divide-y divide-line">
              {Array.from({ length: 8 }, (_, i) => (
                <RowSkeleton key={i} i={i} buttons={0} badge={28} />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <div className="flex h-full min-h-[300px] flex-col items-center justify-center p-6">
              <EmptyState icon={<MessagesSquare size={20} />} title="No matching sessions" body="Try a different search or clear the filters." />
            </div>
          ) : (
            <ul role="listbox" aria-label="Sessions" className="divide-y divide-line">
              {shown.map((r, i) => {
                const on = r.id === selected;
                return (
                  <li key={r.id} role="option" aria-selected={on} data-index={i}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(r)}
                      className={cx("flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors", i === active ? "bg-surface-2" : "hover:bg-surface-2/60")}
                    >
                      <ProviderBadge id={r.provider} size={28} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] font-medium text-ink">{r.title}</span>
                          {r.pinned && <Pin size={11} filled className="shrink-0 text-accent" />}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-faint">
                          {[provider(r.provider).label, r.model, basename(r.project), plural(r.messageCount, "message"), relativeTime(r.updatedAt)].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      {on && <CheckIcon size={15} className="shrink-0 text-accent" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <Pagination page={pg} pageSize={limit} total={total} onPage={setPage} noun="session" limitOptions={LIMITS} currentLimit={limit} onLimitChange={(l) => setLimit(typeof l === "number" ? l : 25)} />
        <p className="text-[11px] text-faint">↑ ↓ to move, Enter to pick.</p>
      </div>
    </Modal>
  );
}
