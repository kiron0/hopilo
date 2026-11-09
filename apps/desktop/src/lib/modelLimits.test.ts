import { describe, expect, it } from "vitest";
import { normalizeLimitCache } from "./modelLimits";
import { normalizeSettings } from "./hooks";
import { modelFor } from "./handoff";

describe("persistent model limits", () => {
  it("restores saved limits and destination choice after serialization", () => {
    const saved = { modelLimits: { sources: [{ id: "gpt-5", name: "OpenAI", url: "https://developers.openai.com/api/docs/models/gpt-5.md", status: "updated", checkedAt: "2026-11-09T00:00:00Z", updatedAt: "2026-11-09T00:00:00Z", error: null, models: [{ id: "chosen-model", window: 64_000 }] }] }, destinationModels: { "gpt-5": "chosen-model" } };
    const restored = normalizeSettings(JSON.parse(JSON.stringify(saved)));
    expect(modelFor("codex", restored.modelLimits, restored.destinationBudgets).window).toBe(64_000);
  });
  it("rejects corrupt cache values and retains bundled fallback", () => {
    expect(normalizeLimitCache(null)).toEqual({ version: 2, sources: [] });
    const bad = { sources: [{ id: "gpt-5", name: "OpenAI", url: "url", models: [{ id: "gpt-5", window: -1 }, { id: "gpt-5", window: 400_000, inputLimit: 500_000 }] }] };
    const cache = normalizeLimitCache(bad);
    expect(cache.sources[0].models).toEqual([]);
    expect(modelFor("codex", cache, { codex: { providerId: "openai", modelId: "gpt-5" } }).window).toBe(400_000);
  });
});

import { destinationConfig, normalizeDestinationBudgets, resolveDestinationModel, type LimitSource, type DestinationBudget } from "./modelLimits";

const source = (id: string, kind: LimitSource["kind"], window: number, extra: Partial<LimitSource> = {}): LimitSource => ({
  id, kind, name: id, url: `https://example.com/${id}`, status: "updated", checkedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), error: null,
  models: [{ providerId: "lab", id: "org/model-v2", window, inputLimit: window - 1000 }], ...extra,
});
const selection: DestinationBudget = { providerId: "lab", modelId: "org/model-v2" };

describe("destination model resolver", () => {
  it("resolves exact provider and model IDs without guessing aliases or generic agents", () => {
    const cache = { sources: [source("catalog", "catalog", 128000)] };
    expect(resolveDestinationModel("cursor", cache).window).toBeNull();
    expect(resolveDestinationModel("cursor", cache).provenance).toBe("unknown");
    expect(resolveDestinationModel("other", cache, { other: { ...selection, providerId: "different-host" } }).window).toBeNull();
    expect(resolveDestinationModel("other", cache, { other: { ...selection, modelId: "org/model" } }).window).toBeNull();
    expect(resolveDestinationModel("other", cache, { other: selection }).inputLimit).toBe(127000);
  });
  it("prefers fresh reported metadata, official supplements, then catalog; exposes conflicts", () => {
    const cache = { sources: [source("catalog", "catalog", 128000), source("official", "official", 64000), source("runtime", "reported", 32000)] };
    const m = resolveDestinationModel("other", cache, { other: selection });
    expect(m.provenance).toBe("reported");
    expect(m.window).toBe(31000);
    expect(m.available).toBe(25600);
    expect(m.conflicts).toBe(3);
    expect(resolveDestinationModel("other", { sources: cache.sources.slice(0, 2) }, { other: selection }).provenance).toBe("official");
  });
  it("uses fresh catalog over failed, old or removed official metadata", () => {
    const fresh = source("catalog", "catalog", 128000);
    for (const stale of [source("official", "official", 64000, { status: "failed" }), source("official", "official", 64000, { updatedAt: "2020-01-01" }), source("official", "official", 64000, { models: [{ providerId: "lab", id: "org/model-v2", window: 64000, stale: true }] })]) {
      expect(resolveDestinationModel("other", { sources: [stale, fresh] }, { other: selection }).provenance).toBe("catalog");
      expect(resolveDestinationModel("other", { sources: [stale] }, { other: selection }).stale).toBe(true);
    }
  });
  it("applies manual overrides, app caps and reserves without double reserving input caps", () => {
    const cache = { sources: [source("catalog", "catalog", 128000, { models: [{ providerId: "lab", id: "org/model-v2", window: 128000, inputLimit: 100000 }] })] };
    expect(resolveDestinationModel("other", cache, { other: selection }).available).toBe(100000);
    const configured = { ...selection, manualLimit: 64000, appLimit: 32000, reservePercent: 10, reserveTokens: 2000 };
    const m = resolveDestinationModel("other", cache, { other: configured });
    expect(m.provenance).toBe("manual"); expect(m.window).toBe(32000); expect(m.available).toBe(26800);
    expect(resolveDestinationModel("other", cache, { other: { ...configured, reserveTokens: 40000 } }).available).toBe(0);
  });
  it("keeps custom model unknown unless manually configured; uses exact bundled fallback only", () => {
    expect(resolveDestinationModel("codex").provenance).toBe("unknown");
    expect(resolveDestinationModel("codex", undefined, { codex: { providerId: "openai", modelId: "gpt-5" } }).provenance).toBe("bundled");
    expect(resolveDestinationModel("codex", undefined, { codex: { providerId: "openai", modelId: "future-model" } }).window).toBeNull();
    expect(resolveDestinationModel("other", undefined, { other: { providerId: "custom", modelId: "future", manualLimit: 96000 } }).available).toBe(76800);
  });
  it("migrates existing choices and validates imported settings", () => {
    const configs = normalizeDestinationBudgets({ other: { ...selection, manualLimit: -1, reservePercent: 200, reserveTokens: 0 } }, { "gpt-5": "chosen-model" });
    expect(destinationConfig("codex", configs).modelId).toBe("chosen-model");
    expect(configs.other.manualLimit).toBeUndefined(); expect(configs.other.reservePercent).toBe(20);
    expect(destinationConfig("goose", configs).modelId).toBe("");
  });
});
