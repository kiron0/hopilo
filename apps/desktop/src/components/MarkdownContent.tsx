import { createElement, lazy, memo, Suspense, useEffect, useId, useState, type ReactNode } from "react";
import katex from "katex";
import { api, type MdNode } from "../lib/api";
import { markdownImage, markdownLink, MAX_RICH_MARKDOWN } from "../lib/markdown";
import { openExternal } from "../lib/updates";
import { CodeBlock } from "./CodeBlock";
import { ProseSkeleton } from "./ui";
import "katex/dist/katex.min.css";

const MermaidBlock = lazy(() => import("./MermaidBlock"));

const TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "em", "strong", "del", "sup", "sub", "hr", "section", "div"]);

function mathHtml(v: string, display: boolean) {
  try { return katex.renderToString(v, { displayMode: display, throwOnError: false, trust: false, strict: "ignore", maxExpand: 1000, maxSize: 20, output: "htmlAndMathml" }); }
  catch { return null; }
}

function SourceFallback({ text, note }: { text: string; note: string }) {
  return <div><p role="status" className="mb-2 text-[12px] text-muted">{note}</p><pre data-selectable className="whitespace-pre-wrap break-words font-mono text-[12px]">{text}</pre></div>;
}

export function MarkdownTree({ nodes, prefix, onOpen }: { nodes: MdNode[]; prefix: string; onOpen: (href: string) => void }) {
  const scoped = (id?: string) => id ? `${prefix}-${id}` : undefined;
  const render = (list: MdNode[]): ReactNode[] => list.map((node, i) => {
    switch (node.t) {
      case "text": return node.v;
      case "br": return <br key={i} />;
      case "icode": return <code key={i}>{node.v}</code>;
      case "math": {
        const html = mathHtml(node.v, node.display);
        if (html === null) return <code key={i}>{node.v}</code>;
        return node.display ? <span key={i} className="math math-display block" dangerouslySetInnerHTML={{ __html: html }} /> : <span key={i} className="math math-inline" dangerouslySetInnerHTML={{ __html: html }} />;
      }
      case "code":
        if (node.lang.toLowerCase() === "mermaid") return <Suspense key={i} fallback={<CodeBlock code={node.v} language="mermaid" />}><MermaidBlock code={node.v} /></Suspense>;
        return <CodeBlock key={i} code={node.v} language={node.lang || "text"} />;
      case "img": {
        const embedded = markdownImage(node.src);
        if (embedded) return <img key={i} src={embedded} alt={node.alt} title={node.title} loading="lazy" decoding="async" />;
        const external = markdownLink(node.src);
        return <span key={i} className="markdown-image-placeholder">{external ? <button type="button" onClick={() => onOpen(external)}>Open image: {node.alt || "External image"}</button> : <span>Image: {node.alt || "Unavailable in local preview"}</span>}<span className="text-faint"> · not loaded automatically</span></span>;
      }
      case "link": {
        const safe = markdownLink(node.href);
        const children = render(node.c);
        if (!safe) return <span key={i} title="Link target unavailable in local preview">{children}</span>;
        const href = safe.startsWith("#") ? `#${prefix}-${safe.slice(1)}` : safe;
        return <a key={i} href={href} id={scoped(node.id)} title={node.title} rel="noopener noreferrer" onClick={(e) => {
          e.preventDefault();
          if (href.startsWith("#")) {
            const target = document.getElementById(href.slice(1));
            target?.scrollIntoView({ block: "nearest", behavior: "auto" });
            if (target instanceof HTMLElement) target.focus({ preventScroll: true });
          } else onOpen(href);
        }}>{children}</a>;
      }
      case "el": {
        if (!TAGS.has(node.tag)) return <span key={i}>{render(node.c)}</span>;
        const children = render(node.c);
        if (node.tag === "table") return <div key={i} className="markdown-table-scroll" tabIndex={0} role="region" aria-label="Markdown table"><table>{children}</table></div>;
        if (node.tag === "li" && node.checked !== undefined) return <li key={i} className={node.class}><input type="checkbox" disabled checked={node.checked} readOnly />{children}</li>;
        const heading = /^h[1-6]$/.test(node.tag);
        return createElement(node.tag, {
          key: i,
          id: scoped(node.id),
          className: node.class,
          start: node.start,
          tabIndex: heading ? -1 : undefined,
          style: node.align ? { textAlign: node.align } : undefined,
        }, ...(children.length ? [children] : []));
      }
    }
  });
  return <>{render(nodes)}</>;
}

const parsedCache = new Map<string, Promise<MdNode[] | null>>();

function parseCached(text: string): Promise<MdNode[] | null> {
  let pending = parsedCache.get(text);
  if (!pending) {
    if (parsedCache.size >= 48) parsedCache.delete(parsedCache.keys().next().value!);
    pending = api.parseMarkdown(text);
    parsedCache.set(text, pending);
    pending.catch(() => parsedCache.delete(text));
  }
  return pending;
}

function MarkdownContent({ text, className = "" }: { text: string; className?: string }) {
  const prefix = `md-${useId().replace(/[^a-z0-9]/gi, "")}`;
  const [parsed, setParsed] = useState<{ text: string; nodes: MdNode[] | null } | null>(null);
  const [error, setError] = useState("");
  const tooLarge = text.length > MAX_RICH_MARKDOWN;
  useEffect(() => {
    if (tooLarge) return;
    let live = true;
    parseCached(text).then((nodes) => { if (live) setParsed({ text, nodes }); }).catch(() => { if (live) setParsed({ text, nodes: null }); });
    return () => { live = false; };
  }, [text, tooLarge]);
  const open = (href: string) => { setError(""); void openExternal(href).catch(() => setError("Could not open link.")); };
  if (tooLarge) return <SourceFallback text={text} note="Large document shown as source to keep the preview responsive. All loaded text remains available." />;
  const current = parsed?.text === text ? parsed : null;
  if (current && !current.nodes) return <SourceFallback text={text} note="Rich preview unavailable. Source remains readable." />;
  if (!current) return <ProseSkeleton text={text} />;
  return <div className={`markdown-body ${className}`} data-selectable>
    {current.nodes && <MarkdownTree nodes={current.nodes} prefix={prefix} onOpen={open} />}
    {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
  </div>;
}
export default memo(MarkdownContent);
