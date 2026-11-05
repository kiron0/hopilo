import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

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
  releaseUrl: string;
  downloadUrl?: string;
}

export interface UpdateCheckResult {
  status: UpdateStatus;
  currentVersion: string;
  update?: UpdateInfo;
  error?: string;
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

export async function checkGitHubRelease(currentVersion: string = "0.1.0"): Promise<UpdateCheckResult> {
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
      const dmgAsset = data.assets?.find((a) => a.name.toLowerCase().endsWith(".dmg"));
      const zipAsset = data.assets?.find((a) => a.name.toLowerCase().endsWith(".zip"));
      const downloadUrl = (dmgAsset || zipAsset)?.browser_download_url || data.html_url;

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

