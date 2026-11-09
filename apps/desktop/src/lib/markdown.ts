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

interface Tree { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Tree[] }
const textOf = (node: Tree): string => node.value ?? node.children?.map(textOf).join("") ?? "";
export function scopedMarkdownIds(prefix: string) {
  return () => (tree: Tree) => {
    const used = new Set<string>();
    const ids = new Map<string, string>();
    const walk = (node: Tree, visit: (node: Tree) => void) => { visit(node); node.children?.forEach((child) => walk(child, visit)); };
    walk(tree, (node) => {
      if (node.type !== "element") return;
      node.properties ??= {};
      let id = typeof node.properties.id === "string" ? node.properties.id : "";
      if (!id && /^h[1-6]$/.test(node.tagName ?? "")) {
        const slug = textOf(node).toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-") || "section";
        id = slug;
        let suffix = 1;
        while (used.has(id)) id = `${slug}-${suffix++}`;
      }
      if (/^h[1-6]$/.test(node.tagName ?? "")) node.properties.tabIndex = -1;
      if (id) { used.add(id); ids.set(id, `${prefix}-${id}`); node.properties.id = `${prefix}-${id}`; }
    });
    walk(tree, (node) => {
      const p = node.properties;
      if (typeof p?.href === "string" && p.href.startsWith("#")) p.href = `#${ids.get(p.href.slice(1)) ?? `${prefix}-${p.href.slice(1)}`}`;
      if (Array.isArray(p?.ariaDescribedBy)) p.ariaDescribedBy = p.ariaDescribedBy.map((id) => ids.get(String(id)) ?? id);
    });
  };
}
