import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { Attachment } from "../lib/api";
import { errorText } from "../lib/api";
import { fileKind, loadFilePreview, safeHtmlPreview, type FileKind } from "../lib/filePreview";
import { File, FileImage, FilePdf, FileCode, FileAudio, FileVideo, FileText } from "./Icons";
import { Modal, Skeleton } from "./ui";
const PdfPreview = lazy(() => import("./PdfPreview"));
export const fileGlyph = (kind: FileKind) => ({ image: FileImage, pdf: FilePdf, html: FileCode, audio: FileAudio, video: FileVideo, text: FileText, binary: File })[kind];

function usePreview(file: Attachment, enabled: boolean, thumbnail: boolean) {
  const requestKey = JSON.stringify([file.sha256, file.fileName, file.mediaType, file.size, enabled, thumbnail]);
  const shownKey = useRef("");
  const [url, setUrl] = useState(""); const [text, setText] = useState(""); const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    shownKey.current = requestKey;
    if (!enabled) return;
    const abort = new AbortController(); let objectUrl = "";
    setUrl(""); setText(""); setError(""); setLoading(true);
    const kind = fileKind(file);
    const clip = ["text", "html", "binary"].includes(kind);
    const limit = kind === "binary" ? 4096 : clip ? (thumbnail ? 200_000 : 2 * 1024 * 1024) : (thumbnail && kind !== "video" ? 8 : 64) * 1024 * 1024;
    loadFilePreview(file, abort.signal, limit, clip).then(async (blob) => {
      if (abort.signal.aborted) return;
      if (kind === "text" || kind === "html") {
        const raw = await blob.slice(0, thumbnail ? 200_000 : 2 * 1024 * 1024).text();
        if (abort.signal.aborted) return;
        setText(kind === "html" ? safeHtmlPreview(raw) : raw + (file.size > 2 * 1024 * 1024 ? "\n[Preview limited to first 2 MiB]" : ""));
      } else if (kind === "binary") {
        const bytes = new Uint8Array(await blob.slice(0, 4096).arrayBuffer());
        if (abort.signal.aborted) return;
        setText(Array.from({ length: Math.ceil(bytes.length / 16) }, (_, row) => `${(row * 16).toString(16).padStart(8, "0")}  ${[...bytes.slice(row * 16, row * 16 + 16)].map((byte) => byte.toString(16).padStart(2, "0")).join(" ")}`).join("\n"));
      } else {
        objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
      }
    }).catch((e) => { if (!abort.signal.aborted) setError(errorText(e)); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file.sha256, file.fileName, file.mediaType, file.size, enabled, thumbnail]);
  return shownKey.current !== requestKey || !enabled ? { url: "", text: "", error: "", loading: true } : { url, text, error, loading };
}

export function PreviewSkeleton() {
  return <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface-2 p-4" role="status" aria-label="Loading file preview"><Skeleton className="h-full w-full rounded-xl" /></div>;
}

export function FileThumbnail({ file, near }: { file: Attachment; near: boolean }) {
  const kind = fileKind(file); const Glyph = fileGlyph(kind);
  const supported = ["image", "pdf", "html", "video"].includes(kind) && file.size <= (kind === "video" ? 64 : 8) * 1024 * 1024;
  const enabled = near && supported;
  const preview = usePreview(file, enabled, true);
  const [decoded, setDecoded] = useState(""); const [failed, setFailed] = useState("");
  const identity = `${file.sha256}:${preview.url}:${preview.text}`;
  const loaded = () => setDecoded(identity);
  const fail = () => setFailed(identity);
  const error = !!preview.error || failed === identity;
  const waiting = supported && !error && (!enabled || preview.loading || (kind !== "pdf" && decoded !== identity));
  const fallback = <div className="flex max-w-full flex-col items-center gap-3 p-5"><Glyph size={40} className="text-accent" /><span className="truncate text-[12px] uppercase text-muted">{kind === "binary" ? file.fileName.split(".").pop() : kind}</span>{kind === "text" && file.text && <span className="line-clamp-3 whitespace-pre-wrap font-mono text-[11px] text-faint">{file.text.slice(0, 240)}</span>}{error && <span className="text-[11px] text-faint">Preview unavailable</span>}</div>;
  return <div className="pointer-events-none relative flex h-full w-full flex-col items-center justify-center overflow-hidden" aria-hidden="true">
    {waiting && <PreviewSkeleton />}
    {enabled && !error && preview.url && kind === "image" ? <img src={preview.url} alt="" className="h-full w-full object-cover" onLoad={loaded} onError={fail} />
      : enabled && !error && preview.url && kind === "video" ? <video src={preview.url} muted playsInline preload="auto" className="h-full w-full object-cover" onLoadedMetadata={(e) => { const video = e.currentTarget; if (Number.isFinite(video.duration) && video.duration > .1) video.currentTime = Math.min(1, video.duration / 4); }} onLoadedData={loaded} onSeeked={loaded} onError={fail} />
      : enabled && !error && preview.url && kind === "pdf" ? <Suspense fallback={<PreviewSkeleton />}><PdfPreview url={preview.url} thumbnail /></Suspense>
      : enabled && !error && preview.text && kind === "html" ? <iframe sandbox="" tabIndex={-1} referrerPolicy="no-referrer" title={`${file.fileName} thumbnail`} srcDoc={preview.text} className="h-full w-full border-0 bg-white" onLoad={loaded} onError={fail} />
      : !waiting && fallback}
  </div>;
}

export function FilePreview({ file, onClose }: { file: Attachment; onClose: () => void }) {
  const kind = fileKind(file); const preview = usePreview(file, true, false); const [mediaError, setMediaError] = useState(false);
  const [decoded, setDecoded] = useState("");
  const media = useRef<HTMLMediaElement | null>(null);
  useEffect(() => {
    const node = media.current;
    return () => { if (node) { node.pause?.(); node.removeAttribute("src"); node.load?.(); } };
  }, [preview.url]);
  return <Modal title={`Preview · ${file.fileName}`} wide onClose={onClose}>
    <div className="relative flex h-[65vh] min-h-60 flex-col items-center justify-center overflow-auto rounded-xl bg-surface-2 p-2" aria-label={`File preview: ${file.fileName}`}>
      {!preview.error && !mediaError && (preview.loading || (["image", "video", "audio", "html"].includes(kind) && decoded !== (preview.url || preview.text))) && <PreviewSkeleton />}
      {preview.error && <p role="alert" className="p-4 text-danger">{preview.error}</p>}
      {kind === "image" && preview.url && <img src={preview.url} alt={file.fileName} className="max-h-full max-w-full object-contain" onLoad={() => setDecoded(preview.url)} onError={() => setMediaError(true)} />}
      {kind === "pdf" && preview.url && <Suspense fallback={<PreviewSkeleton />}><PdfPreview url={preview.url} /></Suspense>}
      {kind === "html" && preview.text && <iframe title={`HTML preview: ${file.fileName}`} sandbox="" referrerPolicy="no-referrer" srcDoc={preview.text} onLoad={() => setDecoded(preview.text)} className="h-full w-full border-0 bg-white" />}
      {kind === "video" && preview.url && <video ref={(node) => { media.current = node; }} src={preview.url} controls playsInline preload="auto" aria-label={file.fileName} className="max-h-full w-full" onLoadedData={() => setDecoded(preview.url)} onError={() => setMediaError(true)} />}
      {kind === "audio" && preview.url && <audio onLoadedMetadata={() => setDecoded(preview.url)} ref={(node) => { media.current = node; }} src={preview.url} controls preload="auto" aria-label={file.fileName} className="w-full" onLoadedData={() => setDecoded(preview.url)} onError={() => setMediaError(true)} />}
      {(kind === "text" || kind === "binary") && !preview.loading && !preview.error && <div className="h-full w-full overflow-auto p-3">{kind === "binary" && <p className="mb-3 text-[12px] text-muted">Binary preview · first 4 KiB</p>}<pre className="whitespace-pre-wrap break-all font-mono text-[12px]" data-selectable>{preview.text || "Empty file"}</pre></div>}
      {mediaError && <p role="alert" className="p-3 text-danger">This file format or codec cannot be decoded by this app's webview.</p>}
    </div>
    {kind === "html" && <p className="mt-2 text-[12px] text-muted">Local preview. Scripts, forms, external links and network resources are disabled.</p>}
  </Modal>;
}
