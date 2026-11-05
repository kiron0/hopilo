import { describe, expect, it, vi } from "vitest";
import { relaunch } from "@tauri-apps/plugin-process";
import { checkGitHubRelease, installInAppUpdate, isNewerVersion, pickDownloadAsset, type UpdateInfo } from "./updates";

vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

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


describe("pickDownloadAsset", () => {
  const assets = [
    { name: "hopilo-extension-chrome-0.2.0.zip", browser_download_url: "ext" },
    { name: "Hopilo_0.2.0_x64-setup.exe", browser_download_url: "win" },
    { name: "Hopilo_0.2.0_amd64.AppImage", browser_download_url: "linux" },
    { name: "Hopilo_0.2.0_aarch64.dmg", browser_download_url: "mac" },
  ];

  it("returns the installer for the running OS", () => {
    expect(pickDownloadAsset(assets, "macos")?.browser_download_url).toBe("mac");
    expect(pickDownloadAsset(assets, "windows")?.browser_download_url).toBe("win");
    expect(pickDownloadAsset(assets, "linux")?.browser_download_url).toBe("linux");
  });

  it("never offers the extension zip or another OS build", () => {
    expect(pickDownloadAsset([assets[0], assets[1]], "macos")).toBeUndefined();
  });
});

describe("installInAppUpdate", () => {
  it("reports native download progress, installs, and relaunches", async () => {
    const install = vi.fn();
    const download = vi.fn(async (onEvent: (event: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 40 } });
      onEvent({ event: "Progress", data: { chunkLength: 60 } });
      onEvent({ event: "Finished" });
    });
    const progress: { phase: string; percent?: number }[] = [];
    const update = {
      version: "0.2.0",
      nativeUpdate: { download, install } as unknown as UpdateInfo["nativeUpdate"],
    };

    await installInAppUpdate(update, (event) => progress.push(event));

    expect(download).toHaveBeenCalledOnce();
    expect(install).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
    expect(progress).toContainEqual(expect.objectContaining({ phase: "downloading", percent: 40 }));
    expect(progress.at(-1)).toEqual(expect.objectContaining({ phase: "installing", percent: 100 }));
  });
});
