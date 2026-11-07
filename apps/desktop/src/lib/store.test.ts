import { describe, expect, it, vi } from "vitest";
import { isOwnListViewEcho, normalizeListView, routeFrom, useApp, type ListView } from "./store";

const base: ListView = {
  q: "",
  filter: "all",
  provider: "all",
  model: "all",
  resource: "all",
  page: 0,
  selected: ["keep-selection"],
  limit: "auto",
  hideUnanswered: false,
};

describe("normalizeListView", () => {
  it("hydrates persisted filters without losing transient selection", () => {
    const next = normalizeListView({ filter: "agents", provider: "codex", page: 2 }, base);
    expect(next.filter).toBe("agents");
    expect(next.provider).toBe("codex");
    expect(next.page).toBe(2);
    expect(next.selected).toEqual(["keep-selection"]);
  });

  it("rejects invalid persisted dropdown values", () => {
    const next = normalizeListView({ filter: "broken", resource: "broken", page: -4, limit: 0 }, base);
    expect(next).toEqual(base);
  });

  it("parses route strings correctly including compare and settings sections", () => {
    expect(routeFrom("compare")).toEqual({ page: "compare" });
    expect(routeFrom("compare:s1,s2")).toEqual({ page: "compare", a: "s1", b: "s2" });
    expect(routeFrom("settings:redaction")).toEqual({ page: "settings", section: "redaction" });
    expect(routeFrom("session:s123")).toEqual({ page: "sessions", id: "s123" });
    expect(routeFrom("unknown")).toEqual({ page: "overview" });
  });
});

vi.mock("./api", () => ({ api: { setSetting: vi.fn(() => Promise.resolve()) } }));

describe("list view persistence", () => {
  it("debounces writes and recognises its own echo regardless of key order", async () => {
    vi.useFakeTimers();
    const { api } = await import("./api");
    const setSetting = vi.mocked(api.setSetting);
    setSetting.mockClear();
    useApp.getState().setListView({ q: "a" });
    useApp.getState().setListView({ q: "ab" });
    useApp.getState().setListView({ q: "abc" });
    expect(setSetting).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(setSetting).toHaveBeenCalledTimes(1);
    const sent = setSetting.mock.calls[0][1] as Record<string, unknown>;
    expect(sent.q).toBe("abc");
    const reordered = Object.fromEntries(Object.entries(sent).reverse());
    expect(isOwnListViewEcho(reordered)).toBe(true);
    expect(isOwnListViewEcho({ ...sent, q: "other" })).toBe(false);
    vi.useRealTimers();
  });
});
