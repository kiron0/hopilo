import { api, type Attachment } from "./api";

export type FileKind = "image" | "pdf" | "html" | "audio" | "video" | "text" | "binary";
const MIME: Record<string, string> = { pdf: "application/pdf", html: "text/html", htm: "text/html", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", ogg: "audio/ogg", opus: "audio/ogg", mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", ogv: "video/ogg" };
const TEXT = new Set(["txt", "md", "markdown", "json", "jsonl", "csv", "tsv", "log", "xml", "css", "js", "jsx", "ts", "tsx", "py", "rs", "go", "sh", "sql", "toml", "yaml", "yml", "ini", "svg"]);
export function previewMime(file: Attachment) {
  const ext = file.fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? file.mediaType ?? "application/octet-stream";
}
export function fileKind(file: Attachment): FileKind {
  const mime = previewMime(file).toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/html" || mime === "application/xhtml+xml") return "html";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (file.text != null || mime.startsWith("text/") || TEXT.has(file.fileName.split(".").pop()?.toLowerCase() ?? "") || /json|xml/.test(mime)) return "text";
  return "binary";
}
export async function loadFilePreview(file: Attachment, signal: AbortSignal, limit = 64 * 1024 * 1024, clip = false): Promise<Blob> {
  const chunks: ArrayBuffer[] = [];
  const size = 1024 * 1024;
  let offset = 0;
  while (true) {
    signal.throwIfAborted();
    if (clip && offset === limit) break;
    const chunk = await api.readFilePreview(file.sha256, offset, Math.min(size, limit - offset + (clip ? 0 : 1)));
    signal.throwIfAborted();
    if (chunk.byteLength > size || offset + chunk.byteLength > limit) throw new Error(`Preview exceeds ${limit / 1024 / 1024} MiB.`);
    chunks.push(chunk); offset += chunk.byteLength;
    if (chunk.byteLength < size) break;
  }
  return new Blob(chunks, { type: previewMime(file) });
}

export function safeHtmlPreview(raw: string): string {
  const template = document.createElement("template");
  template.innerHTML = raw;
  const content = template.content;
  content.querySelectorAll("script,iframe,frame,frameset,object,embed,base,meta,link,form,svg,math,portal").forEach((el) => el.remove());
  const allowed = new Set(["class", "id", "style", "title", "alt", "width", "height", "colspan", "rowspan", "scope", "dir", "lang", "role"]);
  content.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const safeImage = el.tagName.toLowerCase() === "img" && name === "src" && /^data:image\/(png|jpeg|gif|webp|avif);base64,/i.test(attr.value);
      const anchor = name === "href" && /^#[\w-]+$/.test(attr.value);
      if (!allowed.has(name) && !name.startsWith("aria-") && !safeImage && !anchor) el.removeAttribute(attr.name);
    }
  });
  const wrapper = document.createElement("div");
  wrapper.append(content);
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"><style>body{margin:20px;overflow-wrap:anywhere;font:15px/1.5 system-ui}img{max-width:100%}</style></head><body>${wrapper.innerHTML}</body></html>`;
}
