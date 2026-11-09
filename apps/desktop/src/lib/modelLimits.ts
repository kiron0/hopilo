import type { PromptStyle } from "./api";

export interface ModelLimit { providerId: string; providerName: string; id: string; name: string; window: number }
export interface CatalogPage { updatedAt: string | null; total: number; matches: number; models: ModelLimit[] }
export interface DestinationBudget { providerId: string; modelId: string; window?: number; manualLimit?: number }
export type DestinationBudgets = Record<string, DestinationBudget>;

export const HEADROOM = 0.8;

export const BUNDLED: ModelLimit[] = [
  { providerId: "anthropic", providerName: "Anthropic", id: "claude-opus-5-5", name: "Claude Opus 5.5", window: 1_000_000 },
  { providerId: "anthropic", providerName: "Anthropic", id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", window: 1_000_000 },
  { providerId: "anthropic", providerName: "Anthropic", id: "claude-haiku-5-5", name: "Claude Haiku 5.5", window: 1_000_000 },
  { providerId: "openai", providerName: "OpenAI", id: "gpt-5.6", name: "GPT-5.6", window: 922_000 },
  { providerId: "openai", providerName: "OpenAI", id: "gpt-5.3-codex", name: "GPT-5.3 Codex", window: 272_000 },
  { providerId: "openai", providerName: "OpenAI", id: "gpt-5", name: "GPT-5", window: 272_000 },
  { providerId: "google", providerName: "Google", id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview", window: 1_048_576 },
  { providerId: "google", providerName: "Google", id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", window: 1_048_576 },
  { providerId: "google", providerName: "Google", id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", window: 1_048_576 },
  { providerId: "deepseek", providerName: "DeepSeek", id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", window: 1_048_576 },
  { providerId: "deepseek", providerName: "DeepSeek", id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", window: 1_048_576 },
  { providerId: "xai", providerName: "xAI", id: "grok-4.7", name: "Grok 4.7", window: 500_000 },
];

const DEFAULTS: Record<string, string> = {
  claude: "anthropic/claude-sonnet-5-5", "claude-code": "anthropic/claude-sonnet-5-5",
  codex: "openai/gpt-5.6", "copilot-cli": "openai/gpt-5.6", "vscode-copilot": "openai/gpt-5.6",
  gemini: "google/gemini-3.1-pro-preview", "gemini-cli": "google/gemini-3.1-pro-preview", antigravity: "google/gemini-3.1-pro-preview",
  deepseek: "deepseek/deepseek-v4-pro", grok: "xai/grok-4.7",
};

export const validLimit = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 100_000_000;

export function normalizeDestinationBudgets(raw: unknown): DestinationBudgets {
  const out: DestinationBudgets = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [target, value] of Object.entries(raw as Record<string, unknown>)) {
    const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    if (typeof v.providerId !== "string" || typeof v.modelId !== "string") continue;
    out[target] = { providerId: v.providerId, modelId: v.modelId,
      ...(validLimit(v.window) ? { window: v.window } : {}), ...(validLimit(v.manualLimit) ? { manualLimit: v.manualLimit } : {}) };
  }
  return out;
}

export function bundledModel(providerId: string, modelId: string): ModelLimit | undefined {
  return BUNDLED.find((m) => m.providerId === providerId && m.id === modelId);
}

export function destinationConfig(targetId: string, configs: DestinationBudgets = {}): DestinationBudget {
  if (configs[targetId]) return configs[targetId];
  const [providerId, modelId] = DEFAULTS[targetId]?.split("/") ?? ["", ""];
  return { providerId, modelId, window: bundledModel(providerId, modelId)?.window };
}

export interface ResolvedModel {
  id: string; providerId: string; label: string; style: PromptStyle;
  window: number | null; available: number | null;
  source: "manual" | "selected" | "default" | "unknown"; sourceName: string;
}

export function resolveDestinationModel(targetId: string, configs: DestinationBudgets = {}): ResolvedModel {
  const configured = !!configs[targetId];
  const c = destinationConfig(targetId, configs);
  const window = c.manualLimit ?? c.window ?? bundledModel(c.providerId, c.modelId)?.window ?? null;
  const source = c.manualLimit ? "manual" : window === null ? "unknown" : configured ? "selected" : "default";
  return {
    id: c.modelId, providerId: c.providerId, label: c.modelId || "No destination model selected",
    style: c.providerId === "anthropic" ? "xml" : c.providerId === "google" ? "contextFirst" : "markdown",
    window, available: window === null ? null : Math.floor(window * HEADROOM), source,
    sourceName: { manual: "Manual limit", selected: "Chosen model", default: "Default model", unknown: "Unknown limit" }[source],
  };
}
