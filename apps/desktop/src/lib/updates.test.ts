import { describe, expect, it } from "vitest";
import { isNewerVersion } from "./updates";

describe("isNewerVersion", () => {
  it("detects newer semantic versions", () => {
    expect(isNewerVersion("0.2.0", "0.1.0")).toBe(true);
    expect(isNewerVersion("0.1.1", "0.1.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("v1.2.3", "1.2.2")).toBe(true);
    expect(isNewerVersion("1.2.3-beta", "1.2.2")).toBe(true);
  });

  it("detects equal or older versions", () => {
    expect(isNewerVersion("0.1.0", "0.1.0")).toBe(false);
    expect(isNewerVersion("0.0.9", "0.1.0")).toBe(false);
    expect(isNewerVersion("v0.1.0", "0.1.0")).toBe(false);
    expect(isNewerVersion("1.0.0", "2.0.0")).toBe(false);
  });
});

