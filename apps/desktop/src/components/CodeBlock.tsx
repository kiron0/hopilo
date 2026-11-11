import { useEffect, useMemo, useRef, useState, type CSSProperties, type Ref } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { highlightCode } from "../lib/codeHighlight";
import { MAX_HIGHLIGHT_CODE } from "../lib/markdown";
import { errorText, type SyntaxToken } from "../lib/api";
import { Button, cx } from "./ui";

export function usePreviewVisible() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (visible || !ref.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) { setVisible(true); observer.disconnect(); } }, { rootMargin: "200px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible]);
  return { ref, visible };
}
export function CodeBlock({ code, language = "text" }: { code: string; language?: string }) {
  const { ref, visible } = usePreviewVisible();
  const [highlighted, setHighlighted] = useState<{ key: string; tokens: Awaited<ReturnType<typeof highlightCode>> } | null>(null);
  const [wrap, setWrap] = useState(false);
  const [numbers, setNumbers] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const key = `${language}\0${code}`;
  useEffect(() => {
    if (!visible || !language || /^(text|txt|plain|plaintext)$/i.test(language) || code.length > MAX_HIGHLIGHT_CODE) return;
    let live = true;
    import("../lib/codeHighlight").then((m) => m.highlightCode(code, language)).then((tokens) => { if (live) setHighlighted({ key, tokens }); }).catch(() => {});
    return () => { live = false; };
  }, [code, language, visible, key]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    setCopying(true); setError("");
    try { await writeText(code); setCopied(true); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 1800); }
    catch (e) { setError(`Could not copy code: ${errorText(e)}`); }
    finally { setCopying(false); }
  };
  const tokens = highlighted?.key === key ? highlighted.tokens : null;
  const lines = code.split("\n");
  return <div ref={ref} className="markdown-code-block not-prose">
    <div className="markdown-code-toolbar"><span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted">{language || "text"}</span>
      <Button size="sm" variant="ghost" aria-pressed={numbers} onClick={() => setNumbers(!numbers)}>Lines</Button>
      <Button size="sm" variant="ghost" aria-pressed={wrap} onClick={() => setWrap(!wrap)}>Wrap</Button>
      <Button size="sm" variant="ghost" disabled={copying} onClick={copy}>{copied ? "Copied" : "Copy code"}</Button>
    </div>
    <pre tabIndex={0} aria-label={`${language} code`} className={cx(wrap && "code-wrap")} data-selectable><code>{tokens ? tokens.map((line, i) => <span className="code-line" key={i}>{numbers && <span className="code-line-number" aria-hidden="true">{i + 1}</span>}{line.map((token, j) => <span key={j} className="syntax-token" style={token.htmlStyle as CSSProperties}>{token.content}</span>)}{i < tokens.length - 1 ? "\n" : ""}</span>) : numbers ? lines.map((line, i) => <span className="code-line" key={i}><span className="code-line-number" aria-hidden="true">{i + 1}</span>{line}{i < lines.length - 1 ? "\n" : ""}</span>) : code}</code></pre>
    {error && <p role="alert" className="px-3 py-2 text-[12px] text-danger">{error}</p>}
  </div>;
}

const CHUNK_LINES = 400;
const CHUNK_CHARS = 30_000;

export function splitForHighlight(code: string): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const line of code.split("\n")) {
    if (current.length && (current.length >= CHUNK_LINES || size + line.length + 1 > CHUNK_CHARS)) {
      chunks.push(current.join("\n"));
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.length + 1;
  }
  chunks.push(current.join("\n"));
  return chunks;
}

function HighlightChunk({ code, language }: { code: string; language: string }) {
  const { ref, visible } = usePreviewVisible();
  const [result, setResult] = useState<{ code: string; tokens: SyntaxToken[][] | null } | null>(null);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    import("../lib/codeHighlight").then((m) => m.highlightCode(code, language)).then((tokens) => { if (live) setResult({ code, tokens }); }).catch(() => {});
    return () => { live = false; };
  }, [code, language, visible]);
  const tokens = result?.code === code ? result.tokens : null;
  return <span ref={ref as unknown as Ref<HTMLSpanElement>} className="block">{tokens ? tokens.map((line, i) => <span key={i}>{line.map((token, j) => <span key={j} className="syntax-token" style={token.htmlStyle as CSSProperties}>{token.content}</span>)}{i < tokens.length - 1 ? "\n" : ""}</span>) : code}</span>;
}

export function LargeCodeBlock({ code, language }: { code: string; language: string }) {
  const chunks = useMemo(() => splitForHighlight(code), [code]);
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    setError("");
    try { await writeText(code); setCopied(true); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 1800); }
    catch (e) { setError(`Could not copy code: ${errorText(e)}`); }
  };
  return <div className="markdown-code-block not-prose">
    <div className="markdown-code-toolbar"><span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted">{language}</span>
      <Button size="sm" variant="ghost" aria-pressed={wrap} onClick={() => setWrap(!wrap)}>Wrap</Button>
      <Button size="sm" variant="ghost" onClick={copy}>{copied ? "Copied" : "Copy code"}</Button>
    </div>
    <pre tabIndex={0} aria-label={`${language} code`} className={cx(wrap && "code-wrap")} data-selectable><code>{chunks.map((chunk, i) => <HighlightChunk key={i} code={chunk} language={language} />)}</code></pre>
    {error && <p role="alert" className="px-3 py-2 text-[12px] text-danger">{error}</p>}
  </div>;
}
