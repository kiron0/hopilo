import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { Button, Skeleton } from "./ui";
import { errorText } from "../lib/api";
GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfPreview({ url, thumbnail = false }: { url: string; thumbnail?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const base = `${import.meta.env.BASE_URL}pdfjs/`;
    const task = getDocument({ url, cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/`, maxImageSize: 16_000_000, canvasMaxAreaInBytes: 64_000_000 });
    setDoc(null); setPage(1); setError(""); setLoading(true);
    task.promise.then((value) => { if (active) setDoc(value); }).catch((e) => { if (active) { setError(errorText(e)); setLoading(false); } });
    return () => { active = false; void task.destroy(); };
  }, [url]);
  useEffect(() => {
    if (!doc || !canvas.current) return;
    let active = true; let render: RenderTask | undefined;
    setLoading(true);
    doc.getPage(page).then(async (pdfPage) => {
      if (!active || !canvas.current) return;
      const natural = pdfPage.getViewport({ scale: 1 });
      const width = thumbnail ? 400 : Math.min(1800, Math.max(320, canvas.current.parentElement?.clientWidth ?? 850) * zoom);
      const scale = Math.min(width / natural.width, 4096 / natural.height, Math.sqrt(8_000_000 / (natural.width * natural.height)));
      const viewport = pdfPage.getViewport({ scale });
      canvas.current.width = Math.ceil(viewport.width); canvas.current.height = Math.ceil(viewport.height);
      render = pdfPage.render({ canvas: canvas.current, viewport });
      await render.promise;
      if (active) setLoading(false);
    }).catch((e) => { if (active) { setError(errorText(e)); setLoading(false); } });
    return () => { active = false; render?.cancel(); };
  }, [doc, page, zoom, thumbnail]);
  return <div className="flex h-full w-full min-h-0 flex-col items-center gap-2">
    {!thumbnail && <div className="flex flex-wrap items-center justify-center gap-3 p-2">
      <Button size="sm" disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>Previous page</Button>
      <span role="status" className="text-[12px]">Page {page} of {doc?.numPages ?? "…"}</span>
      <Button size="sm" disabled={loading || !doc || page >= doc.numPages} onClick={() => setPage(page + 1)}>Next page</Button>
      <Button size="sm" disabled={zoom <= .5} onClick={() => setZoom(zoom - .25)}>Zoom out</Button>
      <Button size="sm" disabled={zoom >= 2} onClick={() => setZoom(zoom + .25)}>Zoom in</Button>
    </div>}
    
    {error && <p role="alert" className="p-3 text-[12px] text-danger">{thumbnail ? "PDF" : `Could not render PDF: ${error}`}</p>}
    <div className="relative w-full min-h-0 flex-1 overflow-auto text-center">{loading && <div className="absolute inset-0 z-10 bg-surface-2 p-2" role="status" aria-label="Rendering PDF"><Skeleton className="h-full w-full rounded-xl" /></div>}<canvas ref={canvas} aria-label={thumbnail ? "PDF first page" : `PDF page ${page}`} className={thumbnail ? "mx-auto max-w-full" : "mx-auto bg-white shadow-item"} /></div>
  </div>;
}
