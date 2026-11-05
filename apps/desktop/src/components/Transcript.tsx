import { lazy, Suspense, useState } from "react";
import { AlertTriangle, ChevronRight, FileImage, FileText, MessagesSquare, Wrench } from "./Icons";
import type { Block, Message } from "../lib/api";
import { bytes, formatFullDateTime, humanizeDateTime } from "../lib/format";
import { Button, Checkbox, cx, EmptyState } from "./ui";

const MarkdownBlock = lazy(() => import("./MarkdownViewer").then((module) => ({ default: module.MarkdownBlock })));

const ROLE_LABEL = { user: "User", assistant: "Assistant", system: "System", tool: "Tool" } as const;

function ToolBlock({ title, body, error }: { title: string; body: string; error?: boolean }) {
  const [open, setOpen] = useState(false);
  const firstLine = body.split("\n").find((l) => l.trim()) ?? "";
  return (
    <div className="rounded-lg border border-line bg-surface-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px]">
        <ChevronRight size={13} className={cx("shrink-0 text-faint transition-transform", open && "rotate-90")} />
        <Wrench size={12} className={error ? "text-danger" : "text-faint"} />
        <span className={cx("font-medium", error ? "text-danger" : "text-muted")}>{title}</span>
        {!open && <span className="truncate font-mono text-[11.5px] text-faint">{firstLine.slice(0, 120)}</span>}
      </button>
      {open && (
        <pre data-selectable className="max-h-80 overflow-auto border-t border-line px-3 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink">
          {body}
        </pre>
      )}
    </div>
  );
}

function BlockView({ b, renderMarkdown }: { b: Block; renderMarkdown?: boolean }) {
  switch (b.type) {
    case "text":
      return renderMarkdown ? (
        <Suspense fallback={<div data-selectable className="text-[13px] leading-relaxed break-words whitespace-pre-wrap">{b.text}</div>}>
          <MarkdownBlock text={b.text} />
        </Suspense>
      ) : (
        <div data-selectable className="text-[13px] leading-relaxed break-words whitespace-pre-wrap">
          {b.text}
        </div>
      );
    case "toolCall":
      return <ToolBlock title={`Tool call · ${b.name}`} body={b.input} />;
    case "toolResult":
      return <ToolBlock title={`${b.isError ? "Tool error" : "Tool result"}${b.name ? ` · ${b.name}` : ""}`} body={b.output} error={b.isError} />;
    case "missing":
      return (
        <div className="flex items-center gap-2 rounded-lg bg-warning-soft px-2.5 py-1.5 text-[12px] text-warning">
          <AlertTriangle size={13} /> Referenced but not recovered: {b.description}
        </div>
      );
    case "file": {
      const Glyph = b.mediaType.startsWith("image/") ? FileImage : FileText;
      return (
        <div className="inline-flex max-w-full items-center gap-2 rounded-xl border border-line bg-surface px-2.5 py-1.5 text-[12.5px] shadow-item" title={b.mediaType}>
          <Glyph size={15} className="shrink-0 text-accent" />
          <span className="truncate font-medium">{b.name}</span>
          <span className="shrink-0 font-mono text-[11px] text-faint">{bytes(b.size)}</span>
        </div>
      );
    }
  }
}

const PAGE = 60;

export function Transcript({
  messages,
  selected,
  onToggle,
  renderMarkdown = false,
}: {
  messages: Message[];
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  renderMarkdown?: boolean;
}) {
  const [shown, setShown] = useState(PAGE);
  const visible = messages.length > shown ? messages.slice(0, shown) : messages;

  if (messages.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center p-8">
        <EmptyState icon={<MessagesSquare size={20} />} title="No messages" body="This session has no recorded conversation messages." />
      </div>
    );
  }

  return (
    <>
      <ol className={cx(renderMarkdown ? "space-y-5" : "space-y-3")}>
        {visible.map((m) => {
          const isSel = selected?.has(m.id);
          return (
            <li
              key={m.id + m.sourceId}
              className={cx(
                "flex gap-3 transition-colors [contain-intrinsic-size:auto_96px] [content-visibility:auto]",
                renderMarkdown ? "border-b border-line px-1 pb-5 last:border-b-0" : "rounded-xl border px-3.5 py-3",
                !renderMarkdown && (isSel ? "border-accent/50 bg-accent-soft/50" : "border-transparent"),
                !renderMarkdown && m.role === "user" && !isSel && "bg-surface-2",
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
                  <BlockView key={i} b={b} renderMarkdown={renderMarkdown} />
                ))}
              </div>
            </li>
          );
        })}
      </ol>
      {messages.length > shown && (
        <div className="mt-3 flex items-center justify-center gap-2">
          <span className="text-[12.5px] text-muted">
            Showing {shown} of {messages.length} messages
          </span>
          <Button size="sm" onClick={() => setShown((n) => n + PAGE * 4)}>Show more</Button>
          <Button size="sm" variant="ghost" onClick={() => setShown(messages.length)}>Show all</Button>
        </div>
      )}
    </>
  );
}
