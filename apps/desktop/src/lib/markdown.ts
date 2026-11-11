export const MAX_RICH_MARKDOWN = 200_000;
export const MAX_HIGHLIGHT_CODE = 40_000;
export const MAX_DIAGRAM_CODE = 12_000;
export const MARKDOWN_CHUNK = 40_000;

export function splitMarkdown(text: string, target = MARKDOWN_CHUNK): string[] {
  if (text.length <= target) return [text];
  const lines = text.split("\n");
  const offsets = [0];
  for (const line of lines) offsets.push(offsets[offsets.length - 1] + line.length + 1);
  const chunks: string[] = [];
  let start = 0;
  let fallback = -1;
  let fence: string | null = null;
  const cut = (at: number) => {
    chunks.push(lines.slice(start, at).join("\n"));
    start = at;
    fallback = -1;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const size = offsets[i] - offsets[start];
    if (!fence && i > start && size >= target && lines[i - 1].trim() === "") {
      if (/^#{1,6}\s/.test(line)) cut(i);
      else if (fallback < 0 && /^[A-Za-z]/.test(line) && !/^\[[^\]]+\]:/.test(line)) fallback = i;
    }
    if (fallback > start && offsets[i] - offsets[start] >= target * 3) cut(fallback);
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    }
  }
  if (start < lines.length) chunks.push(lines.slice(start).join("\n"));
  return chunks;
}

export function markdownLink(url: string): string | undefined {
  if (/^#[^\s]*$/.test(url)) return url;
  if (/^(https?:\/\/|mailto:)/i.test(url)) {
    try { const parsed = new URL(url); if (!parsed.username && !parsed.password) return url; } catch {}
  }
  return undefined;
}
export function markdownImage(url: string): string | undefined {
  return url.length <= 2_000_000 && /^data:image\/(?:png|jpeg|webp|gif|avif);base64,[a-z0-9+/=\s]+$/i.test(url) ? url : undefined;
}
