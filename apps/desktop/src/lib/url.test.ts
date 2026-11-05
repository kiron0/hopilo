import { describe, expect, it } from "vitest";
import { safeHref } from "./url";

describe("safeHref", () => {
  it("keeps web and mail links", () => {
    expect(safeHref("https://example.com/docs")).toBe("https://example.com/docs");
    expect(safeHref("http://example.com")).toBe("http://example.com");
    expect(safeHref("mailto:hi@example.com")).toBe("mailto:hi@example.com");
  });

  it("rejects executable and local schemes", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeHref("file:///etc/passwd")).toBeUndefined();
    expect(safeHref("/settings")).toBeUndefined();
    expect(safeHref("")).toBeUndefined();
  });
});
