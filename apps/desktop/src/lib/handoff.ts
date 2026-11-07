import type { Intent, Level, PromptStyle, RedactionRules } from "./api";
import type { HandoffTemplate } from "./store";

export interface IntentPreset {
  id: Exclude<Intent, "custom">;
  label: string;
  hint: string;
}

export const INTENTS: IntentPreset[] = [
  { id: "continue", label: "Continue", hint: "Resume from the exact stopping point" },
  { id: "review", label: "Review", hint: "Critique the previous agent's approach" },
  { id: "summary", label: "Summarize", hint: "Bulleted decisions, files and next steps" },
  { id: "debug", label: "Debug", hint: "Explain the root cause, then the smallest fix" },
];

export interface IntentChoice {
  key: string;
  label: string;
  hint: string;
  intent: Intent;
  instructions?: string;
  custom: boolean;
}

export function intentChoices(templates: HandoffTemplate[]): IntentChoice[] {
  return [
    ...INTENTS.map((i) => ({ key: i.id, label: i.label, hint: i.hint, intent: i.id as Intent, custom: false })),
    ...templates
      .filter((t) => t.text.trim())
      .map((t) => ({ key: t.id, label: t.name.trim() || "Untitled", hint: t.text.trim().slice(0, 140), intent: "custom" as Intent, instructions: t.text, custom: true })),
  ];
}

export function resolveIntent(key: string, templates: HandoffTemplate[]): IntentChoice {
  const all = intentChoices(templates);
  return all.find((c) => c.key === key) ?? all[0];
}

export interface ModelPreset {
  id: string;
  label: string;
  window: number;
  style: PromptStyle;
}

export const MODELS: ModelPreset[] = [
  { id: "claude", label: "Claude 200K", window: 200_000, style: "xml" },
  { id: "gpt-5", label: "GPT-5 400K", window: 400_000, style: "markdown" },
  { id: "gemini", label: "Gemini 1M", window: 1_000_000, style: "contextFirst" },
  { id: "deepseek", label: "DeepSeek 128K", window: 128_000, style: "markdown" },
  { id: "grok", label: "Grok 256K", window: 256_000, style: "markdown" },
];

const TARGET_MODEL: Record<string, string> = {
  claude: "claude",
  "claude-code": "claude",
  gemini: "gemini",
  "gemini-cli": "gemini",
  antigravity: "gemini",
  deepseek: "deepseek",
  grok: "grok",
  codex: "gpt-5",
  "copilot-cli": "gpt-5",
  "vscode-copilot": "gpt-5",
};

export function modelFor(targetId: string): ModelPreset {
  const id = TARGET_MODEL[targetId] ?? "claude";
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

export const STYLES: { value: PromptStyle; label: string; hint: string }[] = [
  { value: "xml", label: "XML tags", hint: "Transcript inside <previous_session> tags, your ask first. Suits Claude." },
  { value: "markdown", label: "Markdown", hint: "Plain headings with BEGIN/END markers. Suits GPT, DeepSeek and most others." },
  { value: "contextFirst", label: "Context first", hint: "Transcript first, your ask last. Suits very long contexts like Gemini." },
];

export type Budget = { tokens: number; window: number; pct: number; tone: "ok" | "tight" | "over" };

export function budget(tokens: number, window: number): Budget {
  const pct = window > 0 ? (tokens / window) * 100 : 0;
  return { tokens, window, pct, tone: pct >= 85 ? "over" : pct >= 50 ? "tight" : "ok" };
}

export function fittingLevel(stats: Record<Level, number>, window: number): Level | null {
  for (const l of ["full", "balanced", "minimal"] as Level[]) {
    if (stats[l] <= window * 0.8) return l;
  }
  return null;
}

export function normalizeRedaction(raw: unknown): RedactionRules {
  const r = raw && typeof raw === "object" ? (raw as Partial<RedactionRules>) : {};
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    patterns: Array.isArray(r.patterns)
      ? r.patterns
          .filter((p) => p && typeof p.pattern === "string")
          .map((p, i) => ({ id: p.id || `p${i}`, name: typeof p.name === "string" ? p.name : "", pattern: p.pattern, enabled: p.enabled !== false }))
      : [],
    keywords: strings(r.keywords),
    excludePaths: strings(r.excludePaths),
    disabledBuiltins: strings(r.disabledBuiltins),
  };
}

export function normalizeTemplates(raw: unknown): HandoffTemplate[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t) => t && typeof t === "object" && typeof t.id === "string")
    .map((t) => ({ id: t.id, name: typeof t.name === "string" ? t.name : "", text: typeof t.text === "string" ? t.text : "" }));
}

export function newId(prefix = "t") {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
