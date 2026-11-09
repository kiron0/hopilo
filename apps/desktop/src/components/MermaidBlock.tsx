import { useEffect, useId, useState } from "react";
import { MAX_DIAGRAM_CODE } from "../lib/markdown";
import { usePreviewVisible, CodeBlock } from "./CodeBlock";
import { Button } from "./ui";

let renderQueue: Promise<unknown> = Promise.resolve();
async function diagramSvg(id: string, code: string, dark: boolean) {
  const job = renderQueue.catch(() => undefined).then(async () => {
    const [{ default: mermaid }, { default: purify }] = await Promise.all([import("mermaid"), import("dompurify")]);
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default", htmlLabels: false,
      flowchart: { htmlLabels: false }, maxTextSize: MAX_DIAGRAM_CODE, maxEdges: 200, suppressErrorRendering: true,
      secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "maxEdges", "suppressErrorRendering", "htmlLabels", "flowchart", "theme", "themeVariables", "themeCSS", "fontFamily", "layout"] });
    const { svg } = await mermaid.render(id, code);
    return purify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ["style"], FORBID_TAGS: ["foreignObject", "image", "a", "script"], FORBID_ATTR: ["href", "xlink:href", "onload", "onclick"] });
  });
  renderQueue = job;
  return job;
}
export default function MermaidBlock({ code }: { code: string }) {
  const id = `diagram-${useId().replace(/[^a-z0-9]/gi, "")}`;
  const { ref, visible } = usePreviewVisible();
  const [dark, setDark] = useState(document.documentElement.dataset.theme === "dark");
  const [result, setResult] = useState<{ code: string; dark: boolean; svg: string } | null>(null);
  const [error, setError] = useState("");
  const [source, setSource] = useState(false);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => setDark(document.documentElement.dataset.theme === "dark"));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || code.length > MAX_DIAGRAM_CODE) return;
    let live = true; setError("");
    diagramSvg(id, code, dark).then((svg) => { if (live) setResult({ code, dark, svg }); }).catch(() => { if (live) setError("Diagram could not be rendered. Source remains available."); });
    return () => { live = false; };
  }, [id, code, dark, visible]);
  const svg = result?.code === code && result.dark === dark ? result.svg : "";
  const diagramDocument = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;background:${dark ? "#171b25" : "#fff"}}svg{display:block;width:100%;max-width:none!important;height:auto}</style></head><body>${svg}</body></html>`;
  return <div ref={ref} className="markdown-diagram not-prose">
    <div className="markdown-code-toolbar"><span className="mr-auto text-[12px] text-muted">Mermaid diagram</span><Button size="sm" variant="ghost" disabled={zoom <= .5} aria-label="Zoom diagram out" onClick={() => setZoom((z) => Math.max(.5, z - .25))}>−</Button><span className="text-[12px]">{Math.round(zoom * 100)}%</span><Button size="sm" variant="ghost" disabled={zoom >= 3} aria-label="Zoom diagram in" onClick={() => setZoom((z) => Math.min(3, z + .25))}>+</Button><Button size="sm" variant="ghost" aria-pressed={source} onClick={() => setSource(!source)}>{source ? "Diagram" : "Diagram source"}</Button></div>
    {source || error || code.length > MAX_DIAGRAM_CODE ? <>{(error || code.length > MAX_DIAGRAM_CODE) && <p role="status" className="px-3 py-2 text-[12px] text-muted">{error || "Large diagram shown as source to keep the preview responsive."}</p>}<CodeBlock code={code} language="mermaid" /></> : svg ? <div className="markdown-diagram-canvas"><iframe sandbox="" referrerPolicy="no-referrer" title="Rendered Mermaid diagram" srcDoc={diagramDocument} style={{ width: `${zoom * 100}%`, minWidth: `${zoom * 100}%`, height: `${Math.min(600, 360 * zoom)}px`, border: 0 }} /></div> : <p role="status" className="p-4 text-[12px] text-muted">Rendering diagram…</p>}
  </div>;
}
