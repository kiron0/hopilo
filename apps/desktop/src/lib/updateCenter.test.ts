import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { check } from "@tauri-apps/plugin-updater";
import { api } from "./api";
import { useApp } from "./store";
import { CHECK_INTERVAL_MS, FAILURE_RETRY_MS, INITIAL_DELAY_MS, checkForUpdates, nextCheckDelay, shouldNotify, startUpdateScheduler, useUpdates } from "./updateCenter";

vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
}));

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  });
  vi.stubGlobal("navigator", { onLine: true });
  vi.spyOn(api, "appInfo").mockResolvedValue({ version: "0.1.0" } as Awaited<ReturnType<typeof api.appInfo>>);
  useUpdates.setState({ status: "idle", currentVersion: "", update: undefined, error: undefined, prepared: false, preparing: false, progress: null, modalOpen: false });
  useApp.getState().setSettings({ autoCheckUpdates: true, autoDownloadUpdates: false });
  vi.mocked(sendNotification).mockClear();
  vi.mocked(check).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const fakeUpdate = (version = "0.2.0") => {
  const download = vi.fn(async () => {});
  const install = vi.fn(async () => {});
  return { update: { version, body: "notes", date: "2026-11-11", download, install }, download, install };
};

describe("nextCheckDelay", () => {
  it("checks immediately the first time and waits the interval after a check", () => {
    expect(nextCheckDelay(1_000_000, null, null)).toBe(0);
    expect(nextCheckDelay(CHECK_INTERVAL_MS, CHECK_INTERVAL_MS - 1000, null)).toBe(CHECK_INTERVAL_MS - 1000);
    expect(nextCheckDelay(10 * CHECK_INTERVAL_MS, 1, null)).toBe(0);
  });

  it("retries sooner after a failed check", () => {
    const now = CHECK_INTERVAL_MS * 2;
    expect(nextCheckDelay(now, now - 1000, now - 1000)).toBe(FAILURE_RETRY_MS - 1000);
  });

  it("ignores timestamps from the future", () => {
    expect(nextCheckDelay(1000, 5000, 5000)).toBe(0);
  });
});

describe("background update checks", () => {
  it("notifies once per version when an update is available", async () => {
    vi.mocked(check).mockResolvedValue(fakeUpdate().update as never);
    await checkForUpdates(false);
    await vi.waitFor(() => expect(sendNotification).toHaveBeenCalledTimes(1));
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ title: "Hopilo 0.2.0 is available" }));
    expect(useUpdates.getState()).toMatchObject({ status: "available", modalOpen: false, prepared: false });
    expect(shouldNotify("available", "0.2.0")).toBe(false);
    await checkForUpdates(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("downloads in the background when enabled and announces a ready update", async () => {
    useApp.getState().setSettings({ autoDownloadUpdates: true });
    const { update, download, install } = fakeUpdate("0.3.0");
    vi.mocked(check).mockResolvedValue(update as never);
    await checkForUpdates(false);
    await vi.waitFor(() => expect(useUpdates.getState().prepared).toBe(true));
    expect(download).toHaveBeenCalledTimes(1);
    expect(install).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ title: "Hopilo 0.3.0 is ready" })));
  });

  it("opens the update dialog for a manual check instead of notifying", async () => {
    vi.mocked(check).mockResolvedValue(fakeUpdate().update as never);
    await checkForUpdates(true);
    expect(useUpdates.getState().modalOpen).toBe(true);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("waits while automatic checks are off and checks soon after they are turned on", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    useApp.getState().setSettings({ autoCheckUpdates: false });
    const stop = startUpdateScheduler();
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS + 1000);
    expect(check).not.toHaveBeenCalled();
    vi.mocked(check).mockResolvedValue(null as never);
    useApp.getState().setSettings({ autoCheckUpdates: true });
    await vi.advanceTimersByTimeAsync(1500);
    expect(check).toHaveBeenCalledTimes(1);
    expect(memory.get("hopilo.updates.lastCheck")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS / 2);
    expect(check).toHaveBeenCalledTimes(1);
    stop();
  });
});
