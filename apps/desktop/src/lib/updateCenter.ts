import { create } from "zustand";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { relaunch } from "@tauri-apps/plugin-process";
import { api } from "./api";
import { useApp } from "./store";
import { checkInAppUpdate, installInAppUpdate, type UpdateInfo, type UpdateInstallProgress, type UpdateStatus } from "./updates";

export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const FAILURE_RETRY_MS = 30 * 60 * 1000;
export const INITIAL_DELAY_MS = 20 * 1000;
const DISABLED_POLL_MS = 60 * 60 * 1000;
const LAST_CHECK_KEY = "hopilo.updates.lastCheck";
const LAST_FAILURE_KEY = "hopilo.updates.lastFailure";
const NOTIFIED_KEY = "hopilo.updates.notified";

export interface UpdateCenterState {
  status: UpdateStatus;
  currentVersion: string;
  update?: UpdateInfo;
  error?: string;
  prepared: boolean;
  preparing: boolean;
  progress: UpdateInstallProgress | null;
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
}

export const useUpdates = create<UpdateCenterState>((set) => ({
  status: "idle",
  currentVersion: "",
  prepared: false,
  preparing: false,
  progress: null,
  modalOpen: false,
  openModal: () => set({ modalOpen: true }),
  closeModal: () => set({ modalOpen: false }),
}));

function readNumber(key: string): number | null {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeValue(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

export function nextCheckDelay(now: number, lastCheck: number | null, lastFailure: number | null): number {
  let delay = lastCheck && lastCheck <= now ? Math.max(0, CHECK_INTERVAL_MS - (now - lastCheck)) : 0;
  if (lastFailure && lastFailure <= now) delay = Math.min(delay, Math.max(0, FAILURE_RETRY_MS - (now - lastFailure)));
  return delay;
}

export function shouldNotify(kind: "available" | "ready", version: string): boolean {
  try {
    return localStorage.getItem(NOTIFIED_KEY) !== `${kind}:${version}`;
  } catch {
    return true;
  }
}

async function notify(kind: "available" | "ready", version: string) {
  if (!shouldNotify(kind, version)) return;
  writeValue(NOTIFIED_KEY, `${kind}:${version}`);
  const title = kind === "ready" ? `Hopilo ${version} is ready` : `Hopilo ${version} is available`;
  const body = kind === "ready"
    ? "Open Hopilo and choose Restart to Update to finish installing."
    : "Open Hopilo › Settings › About to install it.";
  useApp.getState().toast({
    key: "update-available",
    kind: "info",
    text: title + (kind === "ready" ? ". Restart to finish installing." : "."),
    action: { label: kind === "ready" ? "Restart" : "View", run: () => (kind === "ready" ? void restartToUpdate() : useUpdates.getState().openModal()) },
  });
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) sendNotification({ title, body });
  } catch {}
}

async function currentVersion(): Promise<string> {
  const known = useUpdates.getState().currentVersion;
  if (known) return known;
  const version = await api.appInfo().then((a) => a.version).catch(() => "0.0.0");
  useUpdates.setState({ currentVersion: version });
  return version;
}

let checking: Promise<boolean> | null = null;

export function checkForUpdates(userInitiated: boolean): Promise<boolean> {
  if (checking) return checking;
  checking = (async () => {
    useUpdates.setState({ status: "checking", error: undefined });
    const version = await currentVersion();
    const res = await checkInAppUpdate(version);
    const prev = useUpdates.getState();
    const same = !!res.update && prev.update?.version === res.update.version && prev.prepared;
    useUpdates.setState({
      status: res.status,
      currentVersion: res.currentVersion || version,
      update: same ? prev.update : res.update,
      error: res.error,
      prepared: same,
    });
    if (res.status === "available" && res.update) {
      if (userInitiated) useUpdates.getState().openModal();
      else void handleBackgroundUpdate();
    }
    return res.status !== "error";
  })().finally(() => {
    checking = null;
  });
  return checking;
}

async function handleBackgroundUpdate() {
  const state = useUpdates.getState();
  const update = state.update;
  if (!update) return;
  if (state.prepared) {
    void notify("ready", update.version);
    return;
  }
  if (!useApp.getState().settings.autoDownloadUpdates || !update.nativeUpdate) {
    void notify("available", update.version);
    return;
  }
  if (state.preparing) return;
  useUpdates.setState({ preparing: true, progress: null });
  try {
    await installInAppUpdate(update, (progress) => useUpdates.setState({ progress }), { downloadOnly: true });
    if (useUpdates.getState().update?.version !== update.version) return;
    useUpdates.setState({ prepared: true });
    void notify("ready", update.version);
  } catch {
    void notify("available", update.version);
  } finally {
    useUpdates.setState({ preparing: false, progress: null });
  }
}

export async function restartToUpdate() {
  const { update, prepared } = useUpdates.getState();
  if (!update?.nativeUpdate || !prepared) {
    useUpdates.getState().openModal();
    return;
  }
  try {
    await update.nativeUpdate.install();
    await relaunch();
  } catch (e) {
    useUpdates.setState({ prepared: false, error: e instanceof Error ? e.message : String(e) });
    useUpdates.getState().openModal();
  }
}

let started = false;

export function startUpdateScheduler(): () => void {
  if (started) return () => {};
  started = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const schedule = (ms: number) => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, ms);
  };
  const tick = async () => {
    if (stopped) return;
    if (!useApp.getState().settings.autoCheckUpdates) {
      schedule(DISABLED_POLL_MS);
      return;
    }
    const now = Date.now();
    const delay = nextCheckDelay(now, readNumber(LAST_CHECK_KEY), readNumber(LAST_FAILURE_KEY));
    if (delay > 0) {
      schedule(Math.min(delay, DISABLED_POLL_MS));
      return;
    }
    writeValue(LAST_CHECK_KEY, String(now));
    const ok = await checkForUpdates(false);
    writeValue(LAST_FAILURE_KEY, ok ? null : String(Date.now()));
    schedule(ok ? CHECK_INTERVAL_MS : FAILURE_RETRY_MS);
  };
  const unsub = useApp.subscribe((s, prev) => {
    if (s.settings.autoCheckUpdates && !prev.settings.autoCheckUpdates) schedule(1000);
    if (s.settings.autoDownloadUpdates && !prev.settings.autoDownloadUpdates && useUpdates.getState().status === "available") void handleBackgroundUpdate();
  });
  const online = () => {
    if (readNumber(LAST_FAILURE_KEY)) schedule(5000);
  };
  window.addEventListener("online", online);
  schedule(INITIAL_DELAY_MS);
  return () => {
    stopped = true;
    started = false;
    if (timer) clearTimeout(timer);
    unsub();
    window.removeEventListener("online", online);
  };
}
