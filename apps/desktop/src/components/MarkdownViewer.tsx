import { useMemo, useState, type ReactNode } from "react";
import { safeHref } from "../lib/url";
import { CheckIcon, Copy } from "./Icons";
import { cx } from "./ui";

type BlockToken =
  | { type: "heading"; level: number; text: string }
  | { type: "code"; lang: string; code: string }
  | { type: "alert"; kind: "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION"; content: string[] }
  | { type: "quote"; lines: string[] }
  | { type: "table"; headers: string[]; alignments: ("left" | "center" | "right")[]; rows: string[][] }
  | { type: "taskList"; items: { checked: boolean; text: string }[] }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "rule" }
  | { type: "blank" }
  | { type: "paragraph"; text: string };

function parseMarkdown(md: string): BlockToken[] {
  const lines = md.split("\n");
  const blocks: BlockToken[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      let emptyCount = 0;
      while (i < lines.length && !lines[i].trim()) {
        emptyCount++;
        i++;
      }
      if (blocks.length > 0 && emptyCount > 1) {
        for (let k = 1; k < emptyCount; k++) {
          blocks.push({ type: "blank" });
        }
      }
      continue;
    }

    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: "code", lang, code: codeLines.join("\n") });
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      const match = line.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        const level = match[1].length;
        const text = match[2].trim();
        blocks.push({ type: "heading", level, text });
        i++;
        continue;
      }
    }

    if (/^(\*{3,}|-{3,}|_{3,})$/.test(line.trim())) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }

    if (line.trim().startsWith(">")) {
      const first = line.trim().replace(/^>\s?/, "");
      const alertMatch = first.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
      if (alertMatch) {
        const kind = alertMatch[1].toUpperCase() as "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION";
        const contentLines: string[] = [];
        i++;
        while (i < lines.length && lines[i].trim().startsWith(">")) {
          contentLines.push(lines[i].trim().replace(/^>\s?/, ""));
          i++;
        }
        blocks.push({ type: "alert", kind, content: contentLines });
        continue;
      }

      const quoteLines: string[] = [first];
      i++;
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", lines: quoteLines });
      continue;
    }

    if (line.trim().startsWith("|") && line.trim().endsWith("|") && i + 1 < lines.length && lines[i + 1].includes("---")) {
      const headerRow = line
        .trim()
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      const sepRow = lines[i + 1]
        .trim()
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      const alignments = sepRow.map((s) => {
        if (s.startsWith(":") && s.endsWith(":")) return "center" as const;
        if (s.endsWith(":")) return "right" as const;
        return "left" as const;
      });

      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const row = lines[i]
          .trim()
          .slice(1, -1)
          .split("|")
          .map((c) => c.trim());
        rows.push(row);
        i++;
      }
      blocks.push({ type: "table", headers: headerRow, alignments, rows });
      continue;
    }

    if (/^-\s+\[[ xX]\]\s+/.test(line.trim())) {
      const items: { checked: boolean; text: string }[] = [];
      while (i < lines.length && /^-\s+\[[ xX]\]\s+/.test(lines[i].trim())) {
        const m = lines[i].trim().match(/^-\s+\[([ xX])\]\s+(.*)$/);
        if (m) {
          items.push({ checked: m[1].toLowerCase() === "x", text: m[2].trim() });
        }
        i++;
      }
      blocks.push({ type: "taskList", items });
      continue;
    }

    if (/^[-*+]\s+/.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }

    if (/^\d+\.\s+/.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", ordered: true, items });
      continue;
    }

    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith("```") &&
      !lines[i].trim().startsWith("#") &&
      !lines[i].trim().startsWith(">") &&
      !lines[i].trim().startsWith("|") &&
      !/^[-*+]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !/^(\*{3,}|-{3,}|_{3,})$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", text: paraLines.join("\n") });
  }

  return blocks;
}

function renderInline(text: string): ReactNode[] {
  if (!text) return [];

  const tokensRegex = /(`[^`]+`)|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(~~([^~]+)~~)|(\[([^\]]+)\]\(([^)]+)\))/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokensRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      const code = match[1].slice(1, -1);
      nodes.push(
        <code key={`code-${nodes.length}`} className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11.5px] font-medium text-accent">
          {code}
        </code>
      );
    } else if (match[2]) {
      nodes.push(<strong key={`b-${nodes.length}`} className="font-semibold text-ink">{match[3]}</strong>);
    } else if (match[4]) {
      nodes.push(<em key={`i-${nodes.length}`} className="italic">{match[5]}</em>);
    } else if (match[6]) {
      nodes.push(<del key={`del-${nodes.length}`} className="line-through text-muted">{match[7]}</del>);
    } else if (match[8]) {
      const label = match[9];
      const href = safeHref(match[10]);
      nodes.push(
        href ? (
          <a key={`a-${nodes.length}`} href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-accent underline underline-offset-2 hover:opacity-80">
            {label}
          </a>
        ) : (
          <span key={`a-${nodes.length}`} className="font-medium">
            {label}
          </span>
        )
      );
    }

    lastIndex = tokensRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function renderInlineContent(text: string): ReactNode[] {
  if (!text) return [];
  const lines = text.split("\n");
  const nodes: ReactNode[] = [];
  lines.forEach((line, idx) => {
    if (idx > 0) {
      nodes.push(<br key={`br-${idx}`} />);
    }
    if (line) {
      nodes.push(...renderInline(line));
    }
  });
  return nodes;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group relative my-3 overflow-hidden rounded-xl border border-line bg-surface-2">
      <div className="flex items-center justify-between border-b border-line bg-surface-2/80 px-3.5 py-1.5 text-[11px] font-mono text-faint">
        <span className="font-semibold uppercase tracking-wider text-muted">{lang || "text"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-sans text-muted transition hover:bg-surface hover:text-ink"
        >
          {copied ? <CheckIcon size={12} className="text-success" /> : <Copy size={12} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre data-selectable className="max-h-[500px] overflow-auto p-4 font-mono text-[12px] leading-relaxed text-ink whitespace-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const ALERT_CONFIG = {
  NOTE: { tone: "border-accent/40 bg-accent-soft/30 text-accent", label: "Note" },
  TIP: { tone: "border-success/40 bg-success-soft/30 text-success", label: "Tip" },
  IMPORTANT: { tone: "border-accent/50 bg-accent-soft/40 text-accent", label: "Important" },
  WARNING: { tone: "border-warning/40 bg-warning-soft/30 text-warning", label: "Warning" },
  CAUTION: { tone: "border-danger/40 bg-danger-soft/30 text-danger", label: "Caution" },
};

export function MarkdownBlock({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);

  return (
    <div className="text-[13px] leading-relaxed text-ink" data-selectable>
      {blocks.map((block, idx) => {
        switch (block.type) {
          case "paragraph":
            return (
              <p key={idx} className="mb-3 break-words leading-relaxed text-ink last:mb-0">
                {renderInlineContent(block.text)}
              </p>
            );

          case "blank":
            return <div key={idx} className="h-3.5" aria-hidden="true" />;

          case "heading": {
            const content = renderInlineContent(block.text);
            if (block.level === 1) return <h1 key={idx} className="mt-5 mb-2.5 text-lg font-bold text-ink first:mt-0">{content}</h1>;
            if (block.level === 2) return <h2 key={idx} className="mt-4 mb-2 text-base font-bold text-ink first:mt-0">{content}</h2>;
            if (block.level === 3) return <h3 key={idx} className="mt-3.5 mb-1.5 text-[14.5px] font-semibold text-ink first:mt-0">{content}</h3>;
            return <h4 key={idx} className="mt-3 mb-1 text-[13.5px] font-semibold text-ink first:mt-0">{content}</h4>;
          }

          case "code":
            return <CodeBlock key={idx} lang={block.lang} code={block.code} />;

          case "alert": {
            const cfg = ALERT_CONFIG[block.kind] || ALERT_CONFIG.NOTE;
            return (
              <div key={idx} className={cx("my-3 rounded-xl border p-3.5 text-[12.5px]", cfg.tone)}>
                <div className="font-semibold">{cfg.label}</div>
                <div className="mt-1.5 space-y-1 text-ink">
                  {block.content.map((c, cidx) => (
                    <div key={cidx}>{renderInlineContent(c)}</div>
                  ))}
                </div>
              </div>
            );
          }

          case "quote":
            return (
              <blockquote key={idx} className="my-3 border-l-2 border-accent/60 pl-3.5 italic text-muted">
                {block.lines.map((l, lidx) => (
                  <div key={lidx}>{renderInlineContent(l)}</div>
                ))}
              </blockquote>
            );

          case "table":
            return (
              <div key={idx} className="my-3 overflow-x-auto rounded-xl border border-line">
                <table className="w-full border-collapse text-left text-[12.5px]">
                  <thead className="border-b border-line bg-surface-2 font-semibold">
                    <tr>
                      {block.headers.map((h, hidx) => (
                        <th
                          key={hidx}
                          style={{ textAlign: block.alignments[hidx] || "left" }}
                          className="px-3.5 py-2 text-ink"
                        >
                          {renderInlineContent(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line bg-card">
                    {block.rows.map((r, ridx) => (
                      <tr key={ridx} className="hover:bg-surface-2/40">
                        {r.map((c, cidx) => (
                          <td
                            key={cidx}
                            style={{ textAlign: block.alignments[cidx] || "left" }}
                            className="px-3.5 py-2 text-muted"
                          >
                            {renderInlineContent(c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case "taskList":
            return (
              <ul key={idx} className="my-2.5 space-y-1.5 pl-1">
                {block.items.map((item, tidx) => (
                  <li key={tidx} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={item.checked}
                      readOnly
                      className="mt-1 h-3.5 w-3.5 rounded border-line text-accent"
                    />
                    <span className={cx(item.checked ? "text-faint line-through" : "text-ink")}>
                      {renderInlineContent(item.text)}
                    </span>
                  </li>
                ))}
              </ul>
            );

          case "list":
            if (block.ordered) {
              return (
                <ol key={idx} className="my-2.5 list-decimal space-y-1 pl-5 text-muted">
                  {block.items.map((li, lidx) => (
                    <li key={lidx} className="leading-relaxed">
                      {renderInlineContent(li)}
                    </li>
                  ))}
                </ol>
              );
            }
            return (
              <ul key={idx} className="my-2.5 list-disc space-y-1 pl-5 text-muted">
                {block.items.map((li, lidx) => (
                  <li key={lidx} className="leading-relaxed">
                    {renderInlineContent(li)}
                  </li>
                ))}
              </ul>
            );

          case "rule":
            return <hr key={idx} className="my-4 border-line" />;

          default:
            return null;
        }
      })}
    </div>
  );
}