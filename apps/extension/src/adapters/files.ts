// Files and images shared in a chat message: find them in the page, then
// read their bytes so the capture carries the files, not just their names.
import type { CapturedFile } from "../protocol";

export interface FileRef {
  name: string;
  /** Where the bytes can be read; absent for chips that show only a name. */
  url?: string;
  mediaType?: string;
}

/** Per-file and per-capture limits (decoded bytes). */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 32 * 1024 * 1024;

const FILE_LINK = /\/(files?|download|attachments?|uploads?)\/|\.(pdf|png|jpe?g|gif|webp|csv|txt|md|json|docx?|xlsx?|pptx?|zip)(\?|$)/i;
const CHIP = "[data-testid*='file' i], [data-testid*='attachment' i], [class*='attachment' i], [class*='file-preview' i], [class*='file-thumbnail' i]";

function baseName(url: string): string {
  try {
    const u = new URL(url, location.href);
    const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
    return last.includes(".") ? last : "";
  } catch {
    return "";
  }
}

function chipName(el: Element): string {
  const label = el.getAttribute("title") || el.getAttribute("aria-label") || el.textContent || "";
  return label.replace(/\s+/g, " ").trim().split(" · ")[0].slice(0, 120);
}

/** Generic finder: images users shared, download links and file chips in a
 *  message. Avatars, icons and controls are skipped. */
export function findFiles(message: Element): FileRef[] {
  const out: FileRef[] = [];
  const seen = new Set<string>();
  const add = (ref: FileRef) => {
    const key = ref.url ?? `name:${ref.name}`;
    if (!ref.name || seen.has(key)) return;
    seen.add(key);
    out.push(ref);
  };

  for (const img of Array.from(message.querySelectorAll("img"))) {
    if (img.closest("button, svg, [role='button'], nav, header")) continue;
    const alt = (img.getAttribute("alt") ?? "").toLowerCase();
    if (/avatar|icon|logo|favicon|profile/.test(alt)) continue;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (w && h && (w < 48 || h < 48)) continue;
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith("data:image/svg")) continue;
    add({ name: img.getAttribute("alt")?.trim() || baseName(src) || `image-${out.length + 1}`, url: src });
  }

  for (const a of Array.from(message.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = a.href;
    if (!href || href.startsWith("javascript:")) continue;
    if (a.hasAttribute("download") || FILE_LINK.test(href)) {
      add({ name: a.getAttribute("download") || chipName(a) || baseName(href) || "file", url: href });
    }
  }

  for (const chip of Array.from(message.querySelectorAll(CHIP))) {
    if (chip.querySelector("img, a[href]")) continue; // already covered above
    const name = chipName(chip);
    if (name) add({ name });
  }
  return out;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Read a file's bytes. Page-local URLs (blob:, data:, same origin) are read
 *  here; other hosts go through the extension's background worker, which has
 *  host permission for the chat sites' file servers. */
async function readBytes(url: string): Promise<{ data: string; mediaType: string } | null> {
  const local = url.startsWith("blob:") || url.startsWith("data:") || new URL(url, location.href).origin === location.origin;
  if (local) {
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return null;
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > MAX_FILE_BYTES) return null;
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_FILE_BYTES) return null;
      return { data: toBase64(buf), mediaType: res.headers.get("content-type")?.split(";")[0] ?? "" };
    } catch {
      // fall through to the background worker
    }
  }
  try {
    const r = await chrome.runtime.sendMessage({ kind: "fetch", url, maxBytes: MAX_FILE_BYTES });
    return r?.ok ? { data: r.data, mediaType: r.mediaType ?? "" } : null;
  } catch {
    return null;
  }
}

/** Resolve refs into captured files. Files that can't be read keep their
 *  name (no data), so the library records them as not recovered. */
export async function readFiles(refs: FileRef[], budget: { left: number }): Promise<CapturedFile[]> {
  const out: CapturedFile[] = [];
  for (const ref of refs) {
    const got = ref.url && budget.left > 0 ? await readBytes(ref.url) : null;
    const size = got ? Math.floor((got.data.length * 3) / 4) : 0;
    if (got && size <= budget.left) {
      budget.left -= size;
      out.push({ name: ref.name, mediaType: got.mediaType || ref.mediaType || "", data: got.data });
    } else {
      out.push({ name: ref.name, mediaType: ref.mediaType ?? "" });
    }
  }
  return out;
}
