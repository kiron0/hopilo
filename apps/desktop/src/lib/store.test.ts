import { describe, expect, it } from "vitest";
import { normalizeListView, type ListView } from "./store";

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
});
