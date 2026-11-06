import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronRight, FileImage, FileText, MessagesSquare, Wrench } from "./Icons";
import type { Block, Message } from "../lib/api";
import { bytes, formatFullDateTime, humanizeDateTime } from "../lib/format";
import { Checkbox, cx, EmptyState } from "./ui";

const ROLE_LABEL = { user: "User", assistant: "Assistant", system: "System", tool: "Tool" } as const;

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
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);
  if (parts.length <= 1) return <>{text}</>;
  let occIdx = 0;
  return (
    <>
      {parts.map((part, i) => {
        if (regex.test(part)) {
          const matchId = matchPrefix ? `${matchPrefix}-${occIdx++}` : undefined;
          const isActive = matchId != null && activeMatchId === matchId;
          return (
            <mark
              key={i}
              id={matchId ? `match-${matchId}` : undefined}
              className={cx(
                "rounded-[3px] px-0.5 transition-colors select-text",
                isActive
                  ? "bg-amber-400 text-black font-semibold ring-2 ring-amber-500 shadow-sm"
                  : "bg-amber-400/25 text-inherit",
              )}
            >
              {part}
            </mark>
          );
        }
        return part;
      })}
    </>
  );
}

function ToolBlock({
  title,
  body,
  error,
  searchQuery,
  matchPrefix,
  activeMatchId,
}: {
  title: string;
  body: string;
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
      {effectiveOpen && (
        <pre data-selectable className="max-h-80 overflow-auto border-t border-line px-3 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink">
          <HighlightedText text={body} query={searchQuery} matchPrefix={matchPrefix} activeMatchId={activeMatchId} />
        </pre>
      )}
    </div>
  );
}

function BlockView({
  b,
  searchQuery,
  matchPrefix,
  activeMatchId,
}: {
  b: Block;
  searchQuery?: string;
  matchPrefix?: string;
  activeMatchId?: string;
}) {
  switch (b.type) {
    case "text":
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
      const Glyph = b.mediaType.startsWith("image/") ? FileImage : FileText;
      return (
        <div className="inline-flex max-w-full items-center gap-2 rounded-xl border border-line bg-surface px-2.5 py-1.5 text-[12.5px] shadow-item" title={b.mediaType}>
          <Glyph size={15} className="shrink-0 text-accent" />
          <span className="truncate font-medium">
            <HighlightedText text={b.name} query={searchQuery} matchPrefix={matchPrefix} activeMatchId={activeMatchId} />
          </span>
          <span className="shrink-0 font-mono text-[11px] text-faint">{bytes(b.size)}</span>
        </div>
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
  forceShown,
}: {
  messages: Message[];
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  activeMatchId?: string;
  activeMessageId?: string;
  searchQuery?: string;
  forceShown?: number;
}) {
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    if (forceShown && forceShown > shown) {
      setShown(forceShown);
    }
  }, [forceShown, shown]);

  const visible = messages.length > shown ? messages.slice(0, shown) : messages;
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (shown >= messages.length) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShown((curr) => Math.min(messages.length, curr + PAGE));
        }
      },
      { rootMargin: "600px 0px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [shown, messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center p-8">
        <EmptyState icon={<MessagesSquare size={20} />} title="No messages" body="This session has no recorded conversation messages." />
      </div>
    );
  }

  return (
    <>
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
      {messages.length > shown && (
        <div ref={sentinelRef} className="h-4 w-full" aria-hidden="true" />
      )}
    </>
  );
}
