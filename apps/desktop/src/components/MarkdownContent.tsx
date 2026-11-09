import { remarkMarkupCode } from "../lib/structuredText";
import { lazy, memo, Suspense, useId, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { markdownImage, markdownLink, MAX_RICH_MARKDOWN, scopedMarkdownIds } from "../lib/markdown";
import { openExternal } from "../lib/updates";
import { CodeBlock } from "./CodeBlock";
import "katex/dist/katex.min.css";

const MermaidBlock = lazy(() => import("./MermaidBlock"));

function MarkdownContent({ text, className = "" }: { text: string; className?: string }) {
  const prefix = `md-${useId().replace(/[^a-z0-9]/gi, "")}`;
  const scopeIds = useMemo(() => scopedMarkdownIds(prefix), [prefix]);
  const [error, setError] = useState("");
  const open = (href: string) => { setError(""); void openExternal(href).catch(() => setError("Could not open link.")); };
  const components: Components = {
    a: ({ href, children, ...props }) => {
      const safe = href && markdownLink(href);
      if (!safe) return <span title="Link target unavailable in local preview">{children}</span>;
      return <a href={safe} id={props.id} aria-label={props["aria-label"]} aria-describedby={props["aria-describedby"]} title={props.title} rel="noopener noreferrer" onClick={(e) => {
        e.preventDefault();
        if (safe.startsWith("#")) {
          const target = document.getElementById(safe.slice(1));
          target?.scrollIntoView({ block: "nearest", behavior: "auto" });
          if (target instanceof HTMLElement) target.focus({ preventScroll: true });
        } else open(safe);
      }}>{children}</a>;
    },
    img: ({ src, alt }) => {
      const url = typeof src === "string" ? src : "";
      const embedded = markdownImage(url);
      if (embedded) return <img src={embedded} alt={alt ?? ""} loading="lazy" decoding="async" />;
      const external = markdownLink(url);
      return <span className="markdown-image-placeholder">{external ? <button type="button" onClick={() => open(external)}>Open image: {alt || "External image"}</button> : <span>Image: {alt || "Unavailable in local preview"}</span>}<span className="text-faint"> · not loaded automatically</span></span>;
    },
    table: ({ children }) => <div className="markdown-table-scroll" tabIndex={0} role="region" aria-label="Markdown table"><table>{children}</table></div>,
    pre: ({ node, children }) => {
      const code = node?.children.find((n) => n.type === "element" && n.tagName === "code");
      if (code?.type !== "element") return <pre>{children}</pre>;
      const classes = Array.isArray(code.properties.className) ? code.properties.className : [];
      const language = String(classes.find((c) => String(c).startsWith("language-")) ?? "").replace(/^language-/, "") || "text";
      const value = code.children.map((n) => n.type === "text" ? n.value : "").join("");
      if (language.toLowerCase() === "mermaid") return <Suspense fallback={<CodeBlock code={value} language="mermaid" />}><MermaidBlock code={value} /></Suspense>;
      return <CodeBlock code={value} language={language} />;
    },
  };
  if (text.length > MAX_RICH_MARKDOWN) return <div><p role="status" className="mb-2 text-[12px] text-muted">Large document shown as source to keep the preview responsive. All loaded text remains available.</p><pre data-selectable className="whitespace-pre-wrap break-words font-mono text-[12px]">{text}</pre></div>;
  return <div className={`markdown-body ${className}`} data-selectable>
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, remarkMarkupCode]} rehypePlugins={[scopeIds, [rehypeKatex, { throwOnError: false, trust: false, strict: "ignore", maxExpand: 1000, maxSize: 20 }]]} components={components} urlTransform={(url, key) => key === "src" ? markdownImage(url) ?? markdownLink(url) ?? "" : markdownLink(url) ?? ""}>{text}</ReactMarkdown>
    {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
  </div>;
}
export default memo(MarkdownContent);
