import {
  Children,
  cloneElement,
  isValidElement,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { safeHref } from "../lib/url";
import { CheckIcon, Copy } from "./Icons";
import { cx } from "./ui";

const AGENT_TAGS = new Set([
  "additional_data",
  "agent",
  "analysis",
  "attached_files",
  "command-args",
  "command-message",
  "command-name",
  "commentary",
  "context",
  "developer",
  "env",
  "environment_context",
  "file",
  "final",
  "function_call",
  "function_result",
  "instructions",
  "permissions",
  "project_layout",
  "rules",
  "skill",
  "subagent",
  "summary",
  "system-reminder",
  "system_instruction",
  "task",
  "tool_call",
  "tool_result",
  "user_info",
  "user_instructions",
]);

const ALERT_CONFIG = {
  NOTE: { tone: "border-accent/40 bg-accent-soft/30 text-accent", label: "Note" },
  TIP: { tone: "border-success/40 bg-success-soft/30 text-success", label: "Tip" },
  IMPORTANT: { tone: "border-accent/50 bg-accent-soft/40 text-accent", label: "Important" },
  WARNING: { tone: "border-warning/40 bg-warning-soft/30 text-warning", label: "Warning" },
  CAUTION: { tone: "border-danger/40 bg-danger-soft/30 text-danger", label: "Caution" },
} as const;

type AlertKind = keyof typeof ALERT_CONFIG;
type MarkdownElementProps<T extends keyof React.JSX.IntrinsicElements> = ComponentPropsWithoutRef<T> & { node?: unknown };

function agentTagName(value: string): string | undefined {
  const match = value.trim().match(/^<\/?([A-Za-z][\w:.-]*)(?:\s[^<>]*)?>$/);
  const name = match?.[1].toLowerCase();
  return name && AGENT_TAGS.has(name) ? name : undefined;
}

function decorateAgentTags(markdown: string): string {
  let fenced = false;
  let fenceChar = "";

  return markdown
    .split("\n")
    .map((line) => {
      const fence = line.match(/^\s*(`{3,}|~{3,})/);
      if (fence) {
        const char = fence[1][0];
        if (!fenced) {
          fenced = true;
          fenceChar = char;
        } else if (char === fenceChar) {
          fenced = false;
          fenceChar = "";
        }
        return line;
      }
      if (fenced) return line;

      return line.replace(/<\/?([A-Za-z][\w:.-]*)(?:\s[^<>]*?)?>/g, (tag, name: string, offset: number) => {
        if (!AGENT_TAGS.has(name.toLowerCase())) return tag;
        if (line[offset - 1] === "`" && line[offset + tag.length] === "`") return tag;
        return `\`${tag.replaceAll("`", "&#96;")}\``;
      });
    })
    .join("\n");
}

function plainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return plainText(node.props.children);
  return "";
}

function stripAlertMarker(node: ReactNode): ReactNode {
  let stripped = false;
  const visit = (value: ReactNode): ReactNode => {
    if (typeof value === "string") {
      if (stripped) return value;
      const next = value.replace(/^\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i, "");
      if (next !== value) stripped = true;
      return next;
    }
    if (Array.isArray(value)) return value.map(visit);
    if (isValidElement<{ children?: ReactNode }>(value)) {
      return cloneElement(value, undefined, visit(value.props.children));
    }
    return value;
  };
  return visit(node);
}

function safeImageSrc(raw?: string): string | undefined {
  if (!raw) return undefined;
  const href = safeHref(raw);
  return href?.startsWith("http://") || href?.startsWith("https://") ? href : undefined;
}

function CodeBlock({ lang, code, children }: { lang: string; code: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="group relative my-3 overflow-hidden rounded-xl border border-line bg-surface-2">
      <div className="flex min-h-8 items-center justify-between border-b border-line bg-surface-2/80 px-3.5 text-[11px] font-mono text-faint">
        <span className="font-semibold uppercase tracking-wider text-muted">{lang || "text"}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Copy ${lang || "text"} code`}
          className="flex min-h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-sans text-muted transition-colors hover:bg-surface hover:text-ink active:bg-surface-3"
        >
          {copied ? <CheckIcon size={12} className="text-success" /> : <Copy size={12} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre data-selectable className="markdown-code max-h-[500px] overflow-auto p-4 font-mono text-[12px] leading-relaxed whitespace-pre text-ink">
        {children}
      </pre>
    </div>
  );
}

function CodePre({ children }: MarkdownElementProps<"pre">) {
  const child = Children.only(children) as ReactElement<{ className?: string; children?: ReactNode }>;
  const language = child.props.className?.match(/(?:^|\s)language-([^\s]+)/)?.[1] ?? "";
  const code = plainText(child.props.children).replace(/\n$/, "");
  return <CodeBlock lang={language} code={code}>{child}</CodeBlock>;
}

function MarkdownCode({ className, children, node: _node, ...props }: MarkdownElementProps<"code">) {
  const value = plainText(children);
  const tag = agentTagName(value);
  const block = className?.includes("language-") || className?.includes("hljs");
  if (block) {
    return <code {...props} className={cx("font-mono", className)}>{children}</code>;
  }
  return (
    <code
      {...props}
      data-agent-tag={tag || undefined}
      title={tag ? "Coding-agent context tag" : undefined}
      className={cx(
        "rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11.5px] font-medium text-accent",
        tag && "agent-tag",
        tag && ["tool_call", "tool_result", "function_call", "function_result"].includes(tag) && "agent-tag-tool",
        tag && ["permissions", "instructions", "user_instructions", "developer", "skill"].includes(tag) && "agent-tag-instruction",
      )}
    >
      {children}
    </code>
  );
}

function MarkdownQuote({ children, node: _node, ...props }: MarkdownElementProps<"blockquote">) {
  const match = plainText(children).trimStart().match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
  if (match) {
    const kind = match[1].toUpperCase() as AlertKind;
    const cfg = ALERT_CONFIG[kind];
    return (
      <aside className={cx("my-3 rounded-xl border p-3.5 text-[12.5px] not-italic", cfg.tone)}>
        <div className="font-semibold">{cfg.label}</div>
        <div className="mt-1.5 text-ink">{stripAlertMarker(children)}</div>
      </aside>
    );
  }
  return (
    <blockquote {...props} className="my-3 border-l-2 border-accent/60 pl-3.5 text-muted">
      {children}
    </blockquote>
  );
}

export function MarkdownBlock({ text }: { text: string }) {
  const markdown = useMemo(() => decorateAgentTags(text), [text]);

  return (
    <div className="markdown-body text-[13px] leading-relaxed text-ink" data-selectable>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          a: ({ href, children, node: _node, ...props }) => {
            const safe = href ? safeHref(href) : undefined;
            return safe ? (
              <a {...props} href={safe} target="_blank" rel="noopener noreferrer" className="font-medium text-accent underline underline-offset-2 hover:opacity-80">
                {children}
              </a>
            ) : <span className="font-medium">{children}</span>;
          },
          blockquote: MarkdownQuote,
          code: MarkdownCode,
          del: ({ children }) => <del className="text-muted line-through">{children}</del>,
          em: ({ children }) => <em className="italic">{children}</em>,
          h1: ({ children }) => <h1 className="mt-5 mb-2.5 text-lg font-bold text-ink first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-4 mb-2 text-base font-bold text-ink first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-3.5 mb-1.5 text-[14.5px] font-semibold text-ink first:mt-0">{children}</h3>,
          h4: ({ children }) => <h4 className="mt-3 mb-1 text-[13.5px] font-semibold text-ink first:mt-0">{children}</h4>,
          h5: ({ children }) => <h5 className="mt-3 mb-1 text-[13px] font-semibold text-ink first:mt-0">{children}</h5>,
          h6: ({ children }) => <h6 className="mt-3 mb-1 text-[12.5px] font-semibold uppercase tracking-wide text-muted first:mt-0">{children}</h6>,
          hr: () => <hr className="my-4 border-line" />,
          img: ({ src, alt }) => {
            const safe = safeImageSrc(src);
            return safe ? (
              <img src={safe} alt={alt || ""} loading="lazy" className="my-3 max-h-[420px] max-w-full rounded-xl border border-line object-contain" />
            ) : <span className="text-muted">{alt || "Image"}</span>;
          },
          input: ({ node: _node, ...props }) => <input {...props} readOnly className="mr-2 size-3.5 rounded border-line accent-[var(--accent)]" />,
          li: ({ children }) => <li className="my-1 leading-relaxed marker:text-faint">{children}</li>,
          ol: ({ children, start }) => <ol start={start} className="my-2.5 list-decimal space-y-0.5 pl-5 text-muted">{children}</ol>,
          p: ({ children }) => <p className="mb-3 break-words leading-relaxed text-ink last:mb-0">{children}</p>,
          pre: CodePre,
          strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-xl border border-line">
              <table className="w-full border-collapse text-left text-[12.5px]">{children}</table>
            </div>
          ),
          tbody: ({ children }) => <tbody className="divide-y divide-line bg-card">{children}</tbody>,
          td: ({ children, style }) => <td style={style} className="px-3.5 py-2 align-top text-muted">{children}</td>,
          th: ({ children, style }) => <th style={style} className="px-3.5 py-2 font-semibold text-ink">{children}</th>,
          thead: ({ children }) => <thead className="border-b border-line bg-surface-2">{children}</thead>,
          tr: ({ children }) => <tr className="transition-colors hover:bg-surface-2/40">{children}</tr>,
          ul: ({ children, className }) => (
            <ul className={cx("my-2.5 space-y-0.5 pl-5 text-muted", className?.includes("contains-task-list") ? "list-none pl-1" : "list-disc")}>{children}</ul>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
