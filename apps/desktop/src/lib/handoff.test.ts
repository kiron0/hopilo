import { describe, expect, it } from "vitest";
import { budget, fittingLevel, intentChoices, modelFor, normalizeRedaction, normalizeTemplates, resolveIntent } from "./handoff";

describe("handoff helpers", () => {
  it("maps targets to model presets", () => {
    expect(modelFor("claude-code").window).toBeNull();
    expect(modelFor("gemini", undefined, { gemini: { providerId: "google", modelId: "gemini-2.5-pro" } }).style).toBe("contextFirst");
    expect(modelFor("codex", undefined, { codex: { providerId: "openai", modelId: "gpt-5" } }).window).toBe(400_000);
    expect(modelFor("unknown-tool").window).toBeNull();
  });

  it("grades budget and picks the largest level that fits", () => {
    expect(budget(10_000, 200_000).tone).toBe("ok");
    expect(budget(120_000, 200_000).tone).toBe("tight");
    expect(budget(190_000, 200_000).tone).toBe("over");
    expect(fittingLevel({ full: 300_000, balanced: 90_000, minimal: 5_000 }, 128_000)).toBe("balanced");
    expect(fittingLevel({ full: 300_000, balanced: 290_000, minimal: 200_000 }, 128_000)).toBeNull();
  });

  it("lists built-in intents then non-empty templates", () => {
    const t = [
      { id: "t1", name: "Tests", text: "Write tests" },
      { id: "t2", name: "Empty", text: "  " },
    ];
    const keys = intentChoices(t).map((c) => c.key);
    expect(keys).toEqual(["continue", "review", "summary", "debug", "t1"]);
    expect(resolveIntent("t1", t).instructions).toBe("Write tests");
    expect(resolveIntent("gone", t).key).toBe("continue");
  });

  it("normalizes stored rules and templates defensively", () => {
    expect(normalizeRedaction(null)).toEqual({ patterns: [], keywords: [], excludePaths: [], disabledBuiltins: [] });
    const r = normalizeRedaction({ patterns: [{ name: "x", pattern: "a+" }, { bad: 1 }], keywords: ["k", 3] });
    expect(r.patterns).toHaveLength(1);
    expect(r.patterns[0].enabled).toBe(true);
    expect(r.keywords).toEqual(["k"]);
    expect(normalizeTemplates([{ id: "a", name: 1 }, "x"])).toEqual([{ id: "a", name: "", text: "" }]);
  });
});

describe("synced destination budgets", () => {
  const cache = { sources: [{ id: "gpt-5", name: "OpenAI", url: "https://developers.openai.com/api/docs/models/gpt-5.md", status: "updated" as const, checkedAt: "2026-11-09", updatedAt: "2026-11-09", error: null, models: [{ id: "gpt-5", window: 400_000, inputLimit: 272_000 }, { id: "chosen-model", window: 100_000 }] }] };
  it("uses saved input cap offline, including after failed refresh", () => {
    expect(modelFor("codex", cache, { codex: { providerId: "openai", modelId: "gpt-5" } }).window).toBe(272_000);
    expect(modelFor("codex", { sources: [{ ...cache.sources[0], status: "failed", error: "Offline" }] }, { codex: { providerId: "openai", modelId: "gpt-5" } }).window).toBe(272_000);
  });
  it("uses explicit destination model, falls back if absent", () => {
    expect(modelFor("codex", cache, { codex: { providerId: "openai", modelId: "chosen-model" } }).window).toBe(100_000);
    expect(modelFor("codex", cache, { codex: { providerId: "openai", modelId: "missing" } }).window).toBeNull();
    expect(modelFor("claude-code", cache).window).toBeNull();
  });
});
