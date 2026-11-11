import { structuredLanguage } from "../lib/structuredText";
import { CodeBlock, LargeCodeBlock, usePreviewVisible } from "./CodeBlock";
import { Component, lazy, memo, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MARKDOWN_CHUNK, splitMarkdown } from "../lib/markdown";
import { Button, ProseSkeleton, Segmented } from "./ui";
const MarkdownContent = lazy(() => import("./MarkdownContent"));

class PreviewBoundary extends Component<{ text: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: { text: string }) { if (previous.text !== this.props.text && this.state.failed) this.setState({ failed: false }); }
  render() { return this.state.failed ? <div><p role="status" className="mb-2 text-[12px] text-muted">Rich preview unavailable. Source remains readable.</p><pre className="whitespace-pre-wrap break-words font-mono text-[12px]" data-selectable>{this.props.text}</pre></div> : this.props.children; }
}
function MarkdownChunk({ text, className }: { text: string; className: string }) {
  const { ref, visible } = usePreviewVisible();
  if (!visible) {
    const lines = Math.min(400, text.split("\n").length);
    return <div ref={ref} aria-hidden="true" style={{ minHeight: `${Math.max(48, lines * 14)}px` }} />;
  }
  return <PreviewBoundary text={text}><Suspense fallback={<ProseSkeleton text={text} />}><MarkdownContent text={text} className={className} /></Suspense></PreviewBoundary>;
}

function ChunkedMarkdown({ text, className }: { text: string; className: string }) {
  const chunks = useMemo(() => splitMarkdown(text), [text]);
  return <div className="min-w-0">{chunks.map((chunk, i) => <MarkdownChunk key={i} text={chunk} className={className} />)}</div>;
}

export const MarkdownPreview = memo(function MarkdownPreview({ text, className = "" }: { text: string; className?: string }) {
  const language = useMemo(() => structuredLanguage(text), [text]);
  if (language) return text.length > MARKDOWN_CHUNK ? <LargeCodeBlock code={text} language={language} /> : <CodeBlock code={text} language={language} />;
  if (text.length > MARKDOWN_CHUNK) return <ChunkedMarkdown text={text} className={className} />;
  return <PreviewBoundary text={text}><Suspense fallback={<ProseSkeleton text={text} />}><MarkdownContent text={text} className={className} /></Suspense></PreviewBoundary>;
});

export function MarkdownViewer({ text, initialMode = "preview", sourceLabel = "Markdown source" }: { text: string; initialMode?: "preview" | "source"; sourceLabel?: string }) {
  const [mode, setMode] = useState(initialMode);
  const [outline, setOutline] = useState(false);
  const [headings, setHeadings] = useState<{ id: string; text: string }[]>([]);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode !== "preview" || !body.current) return;
    const refresh = () => {
      const next = [...(body.current?.querySelectorAll<HTMLHeadingElement>("h1[id], h2[id], h3[id]") ?? [])].map((h) => ({ id: h.id, text: h.textContent ?? "" }));
      setHeadings((old) => JSON.stringify(old) === JSON.stringify(next) ? old : next);
    };
    refresh();
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(refresh);
    observer.observe(body.current, { subtree: true, childList: true });
    return () => observer.disconnect();
  }, [text, mode]);
  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center gap-2"><Segmented label="Markdown view" value={mode} onChange={setMode} options={[{ value: "preview", label: "Preview" }, { value: "source", label: "Source" }]} />{mode === "preview" && <Button size="sm" variant="ghost" aria-expanded={outline} onClick={() => setOutline(!outline)}>Contents</Button>}</div>
    {mode === "source" ? <textarea aria-label={sourceLabel} readOnly value={text} rows={12} data-selectable className="w-full resize-y rounded-xl border border-line bg-card p-3 font-mono text-[12px] leading-relaxed text-ink" /> : <>
      {outline && <nav aria-label="Markdown contents" className="max-h-48 space-y-1 overflow-auto rounded-lg border border-line p-3 text-[12px]">{headings.length ? headings.map((h) => <button key={h.id} type="button" className="block w-full truncate text-left text-accent hover:underline" onClick={() => { const target = document.getElementById(h.id); target?.scrollIntoView({ block: "nearest" }); target?.focus({ preventScroll: true }); }}>{h.text}</button>) : <p className="text-muted">No headings in this document.</p>}</nav>}
      <div ref={body}><MarkdownPreview text={text} /></div>
    </>}
  </div>;
}
