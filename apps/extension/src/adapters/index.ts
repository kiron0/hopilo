import { chatgpt } from "./chatgpt";
import { claude } from "./claude";
import type { WebAdapter } from "./common";
import { gemini } from "./gemini";
import { deepseek, grok, perplexity } from "./experimental";

export const ADAPTERS: WebAdapter[] = [chatgpt, claude, gemini, deepseek, grok, perplexity];

export function adapterFor(hostname: string): WebAdapter | null {
  return ADAPTERS.find((a) => a.hosts.includes(hostname)) ?? null;
}
