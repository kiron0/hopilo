import { describe, expect, it, vi } from "vitest";
import { checkGitHubRelease, isNewerVersion } from "./updates";

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

describe("checkGitHubRelease offline error handling", () => {
  it("returns proper error when network fetch fails", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    try {
      const res = await checkGitHubRelease("0.1.0");
      expect(res.status).toBe("error");
      expect(res.error).toBe("You are offline. Connect to the internet to check for updates.");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

