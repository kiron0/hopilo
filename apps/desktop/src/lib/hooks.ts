import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, errorText } from "./api";
import { DEFAULT_SETTINGS, type Settings, useApp } from "./store";

/** Last result per query, shared by every screen and window session, so a
 *  revisited screen paints instantly and refreshes in the background. */
const queryCache = new Map<string, unknown>();

/** Warm the cache for a `useLoad` call before its screen opens (e.g. on
 *  hover), so the screen paints with data instead of a skeleton. Pass the
 *  same loader shape and deps the screen uses. */
export function prefetch<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const key = loader.toString() + JSON.stringify(deps);
  if (queryCache.has(key) || inflight.has(key)) return;
  inflight.add(key);
  loader()
    .then((d) => queryCache.set(key, d))
    .catch(() => undefined)
    .finally(() => inflight.delete(key));
}
const inflight = new Set<string>();

/** Load data, reloading whenever the library changes. Cached results show
 *  immediately (stale-while-revalidate); `loading` is true only when there is
 *  nothing to show yet. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = [], opts: { refreshOnChange?: boolean } = {}) {
  const libraryTick = useApp((s) => s.tick);
  // Some data (e.g. the agent-folder scan) doesn't change with the library;
  // skipping those reloads avoids needless disk scans after every edit.
  const tick = opts.refreshOnChange === false ? 0 : libraryTick;
  const key = loader.toString() + JSON.stringify(deps);
  const [data, setData] = useState<T | null>(() => (queryCache.get(key) as T | undefined) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !queryCache.has(key));
  const seq = useRef(0);
  const reload = useCallback(() => {
    const n = ++seq.current;
    const cached = queryCache.get(key) as T | undefined;
    if (cached !== undefined) setData(cached);
    setLoading(cached === undefined);
    loader()
      .then((d) => {
        queryCache.set(key, d);
        if (n === seq.current) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => n === seq.current && setError(errorText(e)))
      .finally(() => n === seq.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(reload, [reload, tick]);
  return { data, error, loading, reload };
}

const THEME_KEY = "hopilo.theme";

/** Resolve and apply light/dark and motion. Also sets the native window
 *  theme so the title bar and traffic lights match the chosen theme rather
 *  than the system one. */
function applyAppearance(s: Settings) {
  const dark = s.theme === "dark" || (s.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.style.colorScheme = dark ? "dark" : "light";
  // theme-init.js painted a plain background before CSS loaded; CSS owns it now.
  root.style.background = "";
  root.dataset.motion = s.motion;
  const native = "__TAURI_INTERNALS__" in window && !(window as { __HOPILO_MOCK__?: boolean }).__HOPILO_MOCK__;
  try {
    localStorage.setItem(THEME_KEY, JSON.stringify({ theme: s.theme }));
  } catch {
    // Storage can be unavailable; the theme still applies for this session.
  }
  if (native) getCurrentWindow().setTheme(s.theme === "system" ? null : s.theme).catch(() => undefined);
}


/** Load settings, apply theme and keep in sync with other windows. */
export function useBootstrap() {
  const setSettings = useApp((s) => s.setSettings);
  const bump = useApp((s) => s.bump);
  const settings = useApp((s) => s.settings);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const load = () =>
      api
        .getSettings()
        .then((raw) => setSettings({ ...DEFAULT_SETTINGS, ...(raw as Partial<Settings>) }))
        .finally(() => setReady(true));
    load();
    const un1 = listen("hopilo://library-changed", () => bump());
    const un2 = listen("hopilo://settings-changed", () => load());
    return () => {
      un1.then((f) => f());
      un2.then((f) => f());
    };
  }, [setSettings, bump]);

  useEffect(() => {
    applyAppearance(settings);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyAppearance(useApp.getState().settings);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [settings]);

  return ready;
}

export async function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  useApp.getState().setSettings({ [key]: value } as Partial<Settings>);
  await api.setSetting(key, value);
}
