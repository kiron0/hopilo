import { describe, expect, it } from "vitest";
import { normalizeSettings } from "./hooks";
import { normalizeDestinationBudgets, resolveDestinationModel } from "./modelLimits";

describe("destination model limits", () => {
  it("uses built-in defaults for known destinations and unknown for others", () => {
    expect(resolveDestinationModel("codex")).toMatchObject({ providerId: "openai", id: "gpt-5.6", window: 922_000, available: 737_600, source: "default" });
    expect(resolveDestinationModel("claude-code").style).toBe("xml");
    expect(resolveDestinationModel("gemini").style).toBe("contextFirst");
    expect(resolveDestinationModel("cursor")).toMatchObject({ window: null, available: null, source: "unknown" });
  });
  it("maps every supported destination provider to a bundled default", () => {
    expect(resolveDestinationModel("copilot-cli")).toMatchObject({ providerId: "github-copilot", id: "gpt-5.6-sol", window: 922_000, source: "default" });
    expect(resolveDestinationModel("vscode-copilot").providerId).toBe("github-copilot");
    expect(resolveDestinationModel("perplexity")).toMatchObject({ providerId: "perplexity", id: "sonar-pro", window: 200_000 });
    expect(resolveDestinationModel("qwen-code")).toMatchObject({ providerId: "alibaba", id: "qwen3-coder-plus", window: 1_048_576 });
    expect(resolveDestinationModel("kimi-cli")).toMatchObject({ providerId: "moonshotai", id: "kimi-k3.1-pro", window: 1_048_576 });
  });
  it("prefers manual limit, then saved window, then bundled limit", () => {
    expect(resolveDestinationModel("other", { other: { providerId: "lab", modelId: "m", window: 100_000 } })).toMatchObject({ window: 100_000, available: 80_000, source: "selected" });
    expect(resolveDestinationModel("other", { other: { providerId: "lab", modelId: "m", window: 100_000, manualLimit: 50_000 } })).toMatchObject({ window: 50_000, source: "manual" });
    expect(resolveDestinationModel("other", { other: { providerId: "openai", modelId: "gpt-5" } }).window).toBe(272_000);
    expect(resolveDestinationModel("other", { other: { providerId: "lab", modelId: "future" } }).source).toBe("unknown");
  });
  it("drops invalid saved values and survives serialization", () => {
    const configs = normalizeDestinationBudgets({ a: { providerId: "x", modelId: "y", window: -1, manualLimit: 1.5 }, b: { providerId: 1 }, c: "bad" });
    expect(configs).toEqual({ a: { providerId: "x", modelId: "y" } });
    const restored = normalizeSettings(JSON.parse(JSON.stringify({ destinationBudgets: { codex: { providerId: "lab", modelId: "m", window: 64_000 } } })));
    expect(resolveDestinationModel("codex", restored.destinationBudgets).window).toBe(64_000);
  });
});
