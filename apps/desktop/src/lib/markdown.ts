export const MAX_RICH_MARKDOWN = 200_000;
export const MAX_HIGHLIGHT_CODE = 40_000;
export const MAX_DIAGRAM_CODE = 12_000;

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
