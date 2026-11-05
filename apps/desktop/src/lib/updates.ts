import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { platform as currentPlatform, type Platform } from "./platform";

export const APP_NAME = "Hopilo";
export const AUTHOR_NAME = "Toufiq Hasan Kiron";
export const AUTHOR_PORTFOLIO = "https://kiron.dev";
export const BUY_ME_A_COFFEE_URL = "https://buymeacoffee.com/_thk";
export const REPOSITORY_URL = "https://github.com/kiron0/hopilo";
export const ISSUES_URL = "https://github.com/kiron0/hopilo/issues/new";
export const RELEASES_URL = "https://github.com/kiron0/hopilo/releases";
export const RELEASES_LATEST_URL = "https://github.com/kiron0/hopilo/releases/latest";

export async function openExternal(url: string) {
  try {
    await openUrl(url);
    return;
  } catch {}
  try {
    await invoke("open_url", { url });
    return;
  } catch {}
  window.open(url, "_blank", "noopener,noreferrer");
}

export interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size?: number;
}

export interface GitHubRelease {
  tag_name: string;
  name?: string;
  body?: string;
  html_url: string;
  published_at?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: GitHubAsset[];
}

export type UpdateStatus = "idle" | "checking" | "available" | "upToDate" | "error";

export interface UpdateInfo {
  version: string;
  name?: string;
  releaseNotes?: string;
  publishedAt?: string;
  releaseUrl?: string;
  downloadUrl?: string;
  nativeUpdate?: Update;
}

export interface UpdateCheckResult {
  status: UpdateStatus;
  currentVersion: string;
  update?: UpdateInfo;
  error?: string;
}

export interface UpdateInstallProgress {
  phase: "downloading" | "installing";
  downloadedBytes: number;
  totalBytes?: number;
  percent?: number;
}

export async function checkInAppUpdate(currentVersion: string): Promise<UpdateCheckResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return {
      status: "error",
      currentVersion,
      error: "You are offline. Connect to the internet to check for updates.",
    };
  }

  try {
    const update = await check({ timeout: 15_000 });
    if (!update) return { status: "upToDate", currentVersion };

    return {
      status: "available",
      currentVersion,
      update: {
        version: update.version,
        name: `Hopilo ${update.version}`,
        releaseNotes: update.body,
        publishedAt: update.date,
        nativeUpdate: update,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const offline = typeof navigator !== "undefined" && !navigator.onLine;
    return {
      status: "error",
      currentVersion,
      error: offline || /network|offline|failed to fetch|timed? out|dns/i.test(message)
        ? "You are offline. Connect to the internet to check for updates."
        : `Could not check updates: ${message}`,
    };
  }
}

export async function installInAppUpdate(
  info: UpdateInfo,
  onProgress: (progress: UpdateInstallProgress) => void,
): Promise<void> {
  if (!info.nativeUpdate) throw new Error("The signed update package is unavailable. Check for updates again.");

  let downloadedBytes = 0;
  let totalBytes: number | undefined;
  const report = (event: DownloadEvent) => {
    if (event.event === "Started") {
      totalBytes = event.data.contentLength;
    } else if (event.event === "Progress") {
      downloadedBytes += event.data.chunkLength;
    }
    onProgress({
      phase: "downloading",
      downloadedBytes,
      totalBytes,
      percent: totalBytes ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : undefined,
    });
  };

  await info.nativeUpdate.download(report, { timeout: 10 * 60_000 });
  onProgress({ phase: "installing", downloadedBytes, totalBytes, percent: 100 });
  await info.nativeUpdate.install();
  await relaunch();
}

export function isNewerVersion(remote: string, current: string): boolean {
  const clean = (v: string) => v.replace(/^[^0-9]+/, "").split("-")[0];
  const rParts = clean(remote).split(".").map((n) => parseInt(n, 10) || 0);
  const cParts = clean(current).split(".").map((n) => parseInt(n, 10) || 0);

  for (let i = 0; i < Math.max(rParts.length, cParts.length); i++) {
    const r = rParts[i] ?? 0;
    const c = cParts[i] ?? 0;
    if (r > c) return true;
    if (r < c) return false;
  }
  return false;
}

const INSTALLER_SUFFIXES: Record<Platform, string[]> = {
  macos: [".dmg", "-macos.tar.gz", ".app.tar.gz"],
  windows: ["-setup.exe", ".msi", ".exe"],
  linux: [".appimage", ".deb", ".rpm"],
};

export function pickDownloadAsset(assets: GitHubAsset[] | undefined, os: Platform = currentPlatform): GitHubAsset | undefined {
  const list = (assets ?? []).filter((a) => !a.name.toLowerCase().includes("extension"));
  for (const suffix of INSTALLER_SUFFIXES[os]) {
    const hit = list.find((a) => a.name.toLowerCase().endsWith(suffix));
    if (hit) return hit;
  }
  return undefined;
}

export async function checkGitHubRelease(currentVersion: string): Promise<UpdateCheckResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return {
      status: "error",
      currentVersion,
      error: "You are offline. Connect to the internet to check for updates.",
    };
  }

  try {
    const res = await fetch("https://api.github.com/repos/kiron0/hopilo/releases/latest", {
      headers: {
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (res.status === 404) {
      return {
        status: "upToDate",
        currentVersion,
      };
    }

    if (!res.ok) {
      if (res.status === 403) {
        return {
          status: "error",
          currentVersion,
          error: "GitHub API rate limit reached. Check releases directly on GitHub.",
        };
      }
      return {
        status: "error",
        currentVersion,
        error: `Could not check updates (${res.status} ${res.statusText}).`,
      };
    }

    const data: GitHubRelease = await res.json();
    if (data.draft || data.prerelease) {
      return {
        status: "upToDate",
        currentVersion,
      };
    }

    const remoteVer = data.tag_name.replace(/^[vV]/, "").trim();
    if (isNewerVersion(remoteVer, currentVersion)) {
      const downloadUrl = pickDownloadAsset(data.assets)?.browser_download_url || data.html_url;

      return {
        status: "available",
        currentVersion,
        update: {
          version: remoteVer,
          name: data.name || data.tag_name,
          releaseNotes: data.body,
          publishedAt: data.published_at,
          releaseUrl: data.html_url,
          downloadUrl,
        },
      };
    }

    return {
      status: "upToDate",
      currentVersion,
    };
  } catch (e) {
    const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
    const msg = e instanceof Error ? e.message : String(e);
    const isNetworkErr = isOffline || /failed to fetch|networkerror|load failed|econnrefused|fetch failed/i.test(msg);
    return {
      status: "error",
      currentVersion,
      error: isNetworkErr
        ? "You are offline. Connect to the internet to check for updates."
        : `Could not check updates: ${msg}`,
    };
  }
}

