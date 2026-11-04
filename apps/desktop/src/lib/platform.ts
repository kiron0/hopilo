// Platform detection and OS-specific vocabulary and features.

export type Platform = "macos" | "windows" | "linux";

export function detectPlatform(): Platform {
  if (typeof navigator !== "undefined") {
    const ua = navigator.userAgent.toLowerCase();
    const plat = (navigator as unknown as { platform?: string }).platform?.toLowerCase() || "";
    if (ua.includes("mac") || plat.includes("mac")) return "macos";
    if (ua.includes("win") || plat.includes("win")) return "windows";
    if (ua.includes("linux") || plat.includes("linux")) return "linux";
  }
  return "macos";
}

export const platform: Platform = detectPlatform();
export const isMac = platform === "macos";
export const isWindows = platform === "windows";
export const isLinux = platform === "linux";

export const platformName = isMac ? "macOS" : isWindows ? "Windows" : "Linux";
export const deviceNoun = isMac ? "Mac" : isWindows ? "PC" : "computer";
export const modKey = isMac ? "⌘" : "Ctrl";
export const altKey = isMac ? "⌥" : "Alt";
export const trayLabel = isMac ? "Menu bar" : "System tray";
export const trayIconLabel = isMac ? "Menu-bar icon" : "System tray icon";
export const fileManagerLabel = isMac ? "Finder" : isWindows ? "File Explorer" : "File Manager";
export const autostartLabel = isMac ? "Launch at login" : isWindows ? "Start with Windows" : "Launch on startup";

