import type { PromptStyle } from "./api";

export interface ModelLimit {
  providerId?: string; providerName?: string; id: string; name?: string;
  window: number; inputLimit?: number; outputLimit?: number; stale?: boolean;
}
export type SourceKind = "reported" | "official" | "catalog";
export interface ProviderChange { id: string; name: string; added: number; changed: number; removed: number; retained: number; invalid: number; models: number }
export interface LimitSource {
  id: string; name: string; url: string; kind?: SourceKind;
  status: "updated" | "unchanged" | "failed";
  checkedAt: string; updatedAt: string | null; error: string | null;
  etag?: string | null; lastModified?: string | null;
  providers?: ProviderChange[]; models: ModelLimit[];
}
export interface LimitCache { version?: number; sources: LimitSource[] }
export interface DestinationBudget {
  providerId: string; modelId: string;
  manualLimit?: number; appLimit?: number;
  reservePercent?: number; reserveTokens?: number;
}
export type DestinationBudgets = Record<string, DestinationBudget>;
export const LEGACY_PROVIDERS: Record<string, string> = { claude: "anthropic", "gpt-5": "openai", gemini: "google", deepseek: "deepseek", grok: "xai" };
const TARGET_FAMILY: Record<string, string> = { claude: "claude", "claude-code": "claude", codex: "gpt-5", gemini: "gemini", "gemini-cli": "gemini", antigravity: "gemini", deepseek: "deepseek", grok: "grok" };
// Explicit model IDs only. Generic agents have no guessed model/provider.
const BUNDLED: Record<string, number> = { "anthropic/claude-sonnet-4-5": 200_000, "openai/gpt-5": 400_000, "google/gemini-2.5-pro": 1_000_000, "deepseek/deepseek-chat": 128_000, "xai/grok-4": 256_000 };
export const validLimit = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 100_000_000;
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown, fallback = "") => typeof v === "string" ? v : fallback;
const date = (v: unknown): string | null => typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null;
const count = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0;
export function normalizeLimitCache(raw: unknown): LimitCache {
  const sources = record(raw).sources;
  if (!Array.isArray(sources)) return { version: 2, sources: [] };
  const seenSources = new Set<string>();
  return { version: 2, sources: sources.flatMap((value): LimitSource[] => {
    const s = record(value), id = text(s.id);
    if (!id || seenSources.has(id)) return [];
    seenSources.add(id);
    const seen = new Set<string>();
    const models: ModelLimit[] = Array.isArray(s.models) ? s.models.flatMap((value): ModelLimit[] => {
      const m = record(value), providerId = text(m.providerId, LEGACY_PROVIDERS[id]), modelId = text(m.id);
      if (!providerId || !modelId || providerId.length > 200 || modelId.length > 500 || !validLimit(m.window)
        || m.inputLimit != null && (!validLimit(m.inputLimit) || m.inputLimit > m.window)
        || m.outputLimit != null && !validLimit(m.outputLimit)) return [];
      const key = `${providerId}/${modelId}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ providerId, providerName: text(m.providerName) || text(s.name, providerId), id: modelId, name: text(m.name) || modelId, window: m.window,
        ...(m.inputLimit != null ? { inputLimit: m.inputLimit as number } : {}), ...(m.outputLimit != null ? { outputLimit: m.outputLimit as number } : {}), stale: m.stale === true }];
    }) : [];
    return [{ id, name: text(s.name, id), url: text(s.url), kind: s.kind === "reported" || s.kind === "catalog" ? s.kind : "official",
      status: s.status === "updated" || s.status === "unchanged" ? s.status : "failed", checkedAt: date(s.checkedAt) ?? "", updatedAt: date(s.updatedAt), error: typeof s.error === "string" ? s.error : null,
      etag: typeof s.etag === "string" ? s.etag : null, lastModified: typeof s.lastModified === "string" ? s.lastModified : null,
      providers: Array.isArray(s.providers) ? s.providers.map((value) => { const p = record(value); return { id: text(p.id), name: text(p.name), added: count(p.added), changed: count(p.changed), removed: count(p.removed), retained: count(p.retained), invalid: count(p.invalid), models: count(p.models) }; }) : [], models }];
  }) };
}
export function normalizeDestinationBudgets(raw: unknown, legacy?: unknown): DestinationBudgets {
  const out: DestinationBudgets = {};
  for (const [target, v] of Object.entries(record(legacy))) {
    const providerId = LEGACY_PROVIDERS[target];
    if (providerId && typeof v === "string") for (const [destination, family] of Object.entries({ ...TARGET_FAMILY, "copilot-cli": "gpt-5", "vscode-copilot": "gpt-5" })) {
      if (family === target) out[destination] = { providerId, modelId: v };
    }
  }
  for (const [target, value] of Object.entries(record(raw))) {
    const v = record(value);
    if (typeof v.providerId !== "string" || typeof v.modelId !== "string") continue;
    out[target] = { providerId: v.providerId, modelId: v.modelId,
      ...(validLimit(v.manualLimit) ? { manualLimit: v.manualLimit } : {}), ...(validLimit(v.appLimit) ? { appLimit: v.appLimit } : {}),
      reservePercent: typeof v.reservePercent === "number" && v.reservePercent >= 0 && v.reservePercent <= 90 ? v.reservePercent : 20,
      reserveTokens: typeof v.reserveTokens === "number" && Number.isSafeInteger(v.reserveTokens) && v.reserveTokens >= 0 && v.reserveTokens <= 100_000_000 ? v.reserveTokens : 0 };
  }
  return out;
}
export function destinationConfig(targetId: string, configs: DestinationBudgets = {}): DestinationBudget {
  if (configs[targetId]) return configs[targetId];
  return { providerId: "", modelId: "" };
}
export interface CatalogEntry extends ModelLimit { providerId: string; providerName: string; source: LimitSource }
export function catalogEntries(cache: LimitCache): CatalogEntry[] {
  return cache.sources.flatMap((source) => source.models.map((model) => ({ ...model, providerId: model.providerId ?? LEGACY_PROVIDERS[source.id] ?? "", providerName: model.providerName ?? source.name, source })));
}
export const isStale = (source: LimitSource, model: ModelLimit, now = Date.now()) => model.stale === true || source.status === "failed" || !source.updatedAt || now - Date.parse(source.updatedAt) > 30 * 86400_000;
export interface ResolvedModel {
  id: string; providerId: string; label: string; style: PromptStyle;
  window: number | null; available: number | null; inputLimit?: number; outputLimit?: number;
  provenance: "manual" | SourceKind | "bundled" | "unknown";
  sourceName: string; sourceUrl?: string; updatedAt?: string | null; stale: boolean; conflicts: number; reserve: number;
}
export function resolveDestinationModel(targetId: string, cache: LimitCache = { sources: [] }, configs: DestinationBudgets = {}): ResolvedModel {
  const c = destinationConfig(targetId, configs);
  const rank = (source: LimitSource) => source.kind === "reported" ? 0 : source.kind === "catalog" ? 2 : 1;
  const candidates = cache.sources.flatMap((source) => source.models.filter((m) => (m.providerId ?? LEGACY_PROVIDERS[source.id]) === c.providerId && m.id === c.modelId).map((model) => ({ source, model })));
  candidates.sort((a, b) => Number(isStale(a.source, a.model)) - Number(isStale(b.source, b.model)) || rank(a.source) - rank(b.source) || Date.parse(b.source.updatedAt ?? "") - Date.parse(a.source.updatedAt ?? ""));
  const match = candidates[0];
  const manual = validLimit(c.manualLimit);
  const context = manual ? c.manualLimit! : match?.model.window ?? BUNDLED[`${c.providerId}/${c.modelId}`] ?? null;
  const inputLimit = manual ? undefined : match?.model.inputLimit;
  const window = context === null ? null : Math.min(context, c.appLimit ?? Infinity, inputLimit ?? Infinity);
  const effectiveContext = context === null ? null : Math.min(context, c.appLimit ?? Infinity);
  const reserve = effectiveContext === null ? 0 : Math.ceil(effectiveContext * (c.reservePercent ?? 20) / 100) + (c.reserveTokens ?? 0);
  const available = effectiveContext === null ? null : Math.max(0, Math.min(effectiveContext - reserve, inputLimit ?? Infinity));
  const styleProvider = c.providerId || LEGACY_PROVIDERS[TARGET_FAMILY[targetId]];
  const provenance = manual ? "manual" : match ? match.source.kind ?? "official" : context === null ? "unknown" : "bundled";
  return { id: c.modelId, providerId: c.providerId, label: c.modelId || "No destination model selected",
    style: styleProvider === "anthropic" ? "xml" : styleProvider === "google" ? "contextFirst" : "markdown",
    window, available, inputLimit, outputLimit: match?.model.outputLimit, provenance,
    sourceName: manual ? "Manual override" : match?.source.name ?? (context === null ? "Unknown limit" : "Bundled estimate"),
    sourceUrl: match?.source.url, updatedAt: match?.source.updatedAt,
    stale: !manual && (match ? isStale(match.source, match.model) : context !== null),
    conflicts: new Set(candidates.map(({ model: m }) => `${m.window}/${m.inputLimit ?? ""}`)).size > 1 ? candidates.length : 0, reserve };
}
