import { describe, expect, it } from "vitest";
import { budget, fittingLevel, intentChoices, modelFor, normalizeRedaction, normalizeTemplates, resolveIntent } from "./handoff";

describe("handoff helpers", () => {
  it("maps targets to model presets", () => {
    expect(modelFor("claude-code").window).toBe(1_000_000);
    expect(modelFor("gemini", { gemini: { providerId: "google", modelId: "gemini-2.5-pro" } }).style).toBe("contextFirst");
    expect(modelFor("codex", { codex: { providerId: "openai", modelId: "gpt-5" } }).window).toBe(272_000);
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

