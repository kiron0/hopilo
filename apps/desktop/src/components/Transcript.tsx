import { CodeBlock } from "./CodeBlock";
import { structuredLanguage } from "../lib/structuredText";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronRight, MessagesSquare, Wrench } from "./Icons";
import type { Attachment, Block, Message } from "../lib/api";
import { FilePreview, FileThumbnail } from "./FilePreview";
import { bytes, formatFullDateTime, humanizeDateTime } from "../lib/format";
import { MarkdownPreview } from "./MarkdownPreview";
import { Button, Checkbox, cx, EmptyState, Segmented } from "./ui";

const ROLE_LABEL = { user: "User", assistant: "Assistant", system: "System", tool: "Tool" } as const;

function ConversationFile({ file, children }: { file: Attachment; children: React.ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [near, setNear] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const observer = new IntersectionObserver(([entry]) => setNear(!!entry?.isIntersecting), { rootMargin: "300px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return <>
    <button ref={ref} type="button" aria-label={`Preview ${file.fileName}`} onClick={() => setOpen(true)}
      className="block w-60 max-w-full overflow-hidden rounded-xl border border-line bg-surface text-left shadow-item transition-colors hover:border-accent/40">
      <span className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-surface-2"><FileThumbnail file={file} near={near} /></span>
      <span className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
        <span className="min-w-0 flex-1 truncate font-medium">{children}</span>
        <span className="shrink-0 font-mono text-[11px] text-faint">{bytes(file.size)}</span>
      </span>
    </button>
    {open && <FilePreview file={file} onClose={() => setOpen(false)} />}
  </>;
}

function HighlightedText({
  text,
  query,
  matchPrefix,
  activeMatchId,
}: {
  text: string;
  query?: string;
  matchPrefix?: string;
  activeMatchId?: string;
}) {
  if (!query || !query.trim()) return <>{text}</>;
  const trimmed = query.trim();
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, "gi");
  const active = matchPrefix && activeMatchId?.startsWith(`${matchPrefix}-`) ? Number(activeMatchId.slice(matchPrefix.length + 1)) : 0;
  const first = Math.max(0, (Number.isFinite(active) ? active : 0) - 50);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let occurrence = 0;
  let match: RegExpExecArray | null;
  while (occurrence < first + 100 && (match = regex.exec(text))) {
    const index = occurrence++;
    if (index < first) continue;
    const matchId = matchPrefix ? `${matchPrefix}-${index}` : undefined;
    const isActive = matchId != null && activeMatchId === matchId;
    parts.push(text.slice(cursor, match.index));
    parts.push(<mark key={index} id={matchId ? `match-${matchId}` : undefined}
      className={cx("rounded-[3px] px-0.5 transition-colors select-text", isActive
        ? "bg-amber-400 text-black font-semibold ring-2 ring-amber-500 shadow-sm" : "bg-amber-400/25 text-inherit")}>{match[0]}</mark>);
    cursor = regex.lastIndex;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;

}

function ToolBlock({
  title,
  body,
  language,
  error,
  searchQuery,
  matchPrefix,
  activeMatchId,
}: {
  title: string;
  body: string;
  language?: string;
  error?: boolean;
  searchQuery?: string;
  matchPrefix?: string;
  activeMatchId?: string;
}) {
  const hasMatch = searchQuery && searchQuery.trim() && body.toLowerCase().includes(searchQuery.trim().toLowerCase());
  const [open, setOpen] = useState(false);
  const effectiveOpen = open || !!hasMatch;
  const firstLine = body.split("\n").find((l) => l.trim()) ?? "";
  return (
    <div className="rounded-lg border border-line bg-surface-2">
      <button
        type="button"
        aria-expanded={effectiveOpen}
        onClick={() => setOpen(!effectiveOpen)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px]"
      >
        <ChevronRight size={13} className={cx("shrink-0 text-faint transition-transform", effectiveOpen && "rotate-90")} />
        <Wrench size={12} className={error ? "text-danger" : "text-faint"} />
        <span className={cx("font-medium", error ? "text-danger" : "text-muted")}>{title}</span>
        {!effectiveOpen && <span className="truncate font-mono text-[11.5px] text-faint">{firstLine.slice(0, 120)}</span>}
      </button>
      {effectiveOpen && (!searchQuery?.trim() ? <CodeBlock code={body} language={language ?? structuredLanguage(body) ?? "text"} /> : (
        <pre data-selectable className="max-h-80 overflow-auto border-t border-line px-3 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink">
          <HighlightedText text={body} query={searchQuery} matchPrefix={matchPrefix} activeMatchId={activeMatchId} />
        </pre>
      ))}
    </div>
  );
}

function BlockView({
  b,
  rich,
  searchQuery,
  matchPrefix,
  activeMatchId,
  files,
}: {
  b: Block;
  files?: Attachment[];
  rich?: boolean;
  searchQuery?: string;
  matchPrefix?: string;
  activeMatchId?: string;
}) {
  switch (b.type) {
    case "text":
      if (rich) return <MarkdownPreview text={b.text} />;
      return (
        <div data-selectable className="text-[13px] leading-relaxed break-words whitespace-pre-wrap">
          <HighlightedText text={b.text} query={searchQuery} matchPrefix={matchPrefix} activeMatchId={activeMatchId} />
        </div>
      );
    case "toolCall":
      return (
        <ToolBlock
          title={`Tool call · ${b.name}`}
          body={b.input}
          language="json"
          searchQuery={searchQuery}
          matchPrefix={matchPrefix ? `${matchPrefix}-body` : undefined}
          activeMatchId={activeMatchId}
        />
      );
    case "toolResult":
      return (
        <ToolBlock
          title={`${b.isError ? "Tool error" : "Tool result"}${b.name ? ` · ${b.name}` : ""}`}
          body={b.output}
          error={b.isError}
          searchQuery={searchQuery}
          matchPrefix={matchPrefix ? `${matchPrefix}-body` : undefined}
          activeMatchId={activeMatchId}
        />
      );
    case "missing":
      return (
        <div className="flex items-center gap-2 rounded-lg bg-warning-soft px-2.5 py-1.5 text-[12px] text-warning">
          <AlertTriangle size={13} /> Referenced but not recovered: <HighlightedText text={b.description} query={searchQuery} matchPrefix={matchPrefix} activeMatchId={activeMatchId} />
        </div>
      );
    case "file": {
      const file = files?.find((file) => file.sha256 === b.sha256 && file.fileName === b.name)
        ?? { id: b.sha256, fileName: b.name, mediaType: b.mediaType, sha256: b.sha256, size: b.size, originPath: null, text: null };
      return (
        <ConversationFile key={`${b.sha256}:${b.name}`} file={file}>
          <HighlightedText text={b.name} query={searchQuery} matchPrefix={matchPrefix} activeMatchId={activeMatchId} />
        </ConversationFile>
      );
    }
  }
}

const PAGE = 40;

export function Transcript({
  messages,
  selected,
  onToggle,
  activeMatchId,
  activeMessageId,
  searchQuery,
  view: controlledView,
  files,
}: {
  messages: Message[];
  files?: Attachment[];
  view?: "preview" | "source";
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  activeMatchId?: string;
  activeMessageId?: string;
  searchQuery?: string;
}) {
  const [shown, setShown] = useState(PAGE);
  const [localView, setView] = useState<"preview" | "source">("preview");
  const view = controlledView ?? localView;
  const sentinelRef = useRef<HTMLDivElement>(null);
  const visible = messages.slice(0, shown);
  useEffect(() => {
    if (!activeMessageId) return;
    const index = messages.findIndex((m) => m.id === activeMessageId);
    if (index >= 0) setShown((count) => Math.max(count, Math.ceil((index + 1) / PAGE) * PAGE));
  }, [activeMessageId, messages]);
  useEffect(() => {
    if (shown >= messages.length || !sentinelRef.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) setShown((count) => Math.min(messages.length, count + PAGE));
    }, { rootMargin: "600px 0px" });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [shown, messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full min-h-[300px] flex-1 items-center justify-center p-8">
        <EmptyState icon={<MessagesSquare size={20} />} title="No messages" body="This session has no recorded conversation messages." />
      </div>
    );
  }

  return (
    <>
      {(controlledView === undefined || searchQuery?.trim()) && <div className="mb-3 flex flex-wrap items-center gap-3">{controlledView === undefined && <Segmented label="Transcript view" value={view} onChange={setView} options={[{ value: "preview", label: "Preview" }, { value: "source", label: "Source" }]} />}{searchQuery?.trim() && <span className="text-[12px] text-muted">Search shows source for exact match navigation.</span>}</div>}
      <ol className="space-y-3">
        {visible.map((m) => {
          const isSel = selected?.has(m.id);
          const isMsgActive = activeMessageId === m.id;
          return (
            <li
              id={`msg-${m.id}`}
              key={m.id + m.sourceId}
              className={cx(
                "flex gap-3 rounded-xl border px-3.5 py-3 transition-all [contain-intrinsic-size:auto_96px] [content-visibility:auto]",
                isMsgActive ? "border-accent/40 bg-accent-soft/20 ring-1 ring-accent/30" : isSel ? "border-accent/50 bg-accent-soft/50" : "border-transparent",
                m.role === "user" && !isSel && !isMsgActive && "bg-surface-2",
              )}
            >
              {onToggle && (
                <Checkbox label={`Include ${ROLE_LABEL[m.role]} message`} checked={!!isSel} onChange={() => onToggle(m.id)} className="mt-0.5" />
              )}
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2 text-[11.5px]">
                  <span className={cx("font-semibold", m.role === "user" ? "text-accent" : "text-muted")}>{ROLE_LABEL[m.role]}</span>
                  {m.createdAt && (
                    <span className="text-faint" title={formatFullDateTime(m.createdAt)}>
                      {humanizeDateTime(m.createdAt)}
                    </span>
                  )}
                </div>
                {m.blocks.map((b, i) => (
                  <BlockView
                    key={i}
                    b={b}
                    files={files}
                    rich={view === "preview" && !searchQuery?.trim()}
                    searchQuery={searchQuery}
                    matchPrefix={`${m.id}-${i}`}
                    activeMatchId={activeMatchId}
                  />
                ))}
              </div>
            </li>
          );
        })}
      </ol>
      {shown < messages.length && <div ref={sentinelRef} className="py-3 text-center">
        <Button size="sm" variant="ghost" onClick={() => setShown((count) => Math.min(messages.length, count + PAGE))}>Load more messages</Button>
      </div>}
    </>
  );
}
