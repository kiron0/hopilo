import { chatgpt } from "./chatgpt";
import { claude } from "./claude";
import type { WebAdapter } from "./common";
import { gemini } from "./gemini";
import { deepseek, grok, perplexity } from "./experimental";

export const ADAPTERS: WebAdapter[] = [chatgpt, claude, gemini, deepseek, grok, perplexity];

export function adapterFor(hostname: string): WebAdapter | null {
  const norm = (hostname || "").toLowerCase().trim();
  const withoutWww = norm.replace(/^www\./, "");
  return (
    ADAPTERS.find(
      (a) =>
        a.hosts.includes(norm) ||
        a.hosts.includes(withoutWww) ||
        a.hosts.some((h) => h.replace(/^www\./, "") === withoutWww)
    ) ?? null
  );
}
