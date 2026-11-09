export function structuredLanguage(text: string): "json" | "xml" | undefined {
  const start = text.trimStart();
  if ((start.startsWith("{") || start.startsWith("[")) && text.length <= 200_000) {
    try { const value: unknown = JSON.parse(text); if (value !== null && typeof value === "object") return "json"; } catch {}
  }
  if (start.startsWith("<?xml") || /^<[\w:-]+(?:\s[^<>]*|)\s*\/?\>/.test(start) && /(?:<\/[\w:-]+\s*>|\/>)/.test(text)) return "xml";
  return undefined;
}
interface MarkdownNode { type: string; value?: string; lang?: string; children?: MarkdownNode[] }
export function remarkMarkupCode() {
  return (tree: MarkdownNode) => {
    const walk = (parent: MarkdownNode) => {
      for (const node of parent.children ?? []) {
        if (node.type === "html" && node.value) {
          node.type = parent.type === "paragraph" ? "inlineCode" : "code";
          if (node.type === "code") node.lang = "xml";
        } else walk(node);
      }
    };
    walk(tree);
  };
}
