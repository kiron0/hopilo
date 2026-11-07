import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, errorText } from "./api";
import { DEFAULT_SETTINGS, LIST_VIEW_KEY, isOwnListViewEcho, type ListView, type Settings, useApp } from "./store";
import { normalizeRedaction, normalizeTemplates } from "./handoff";

export function ownWindowLabel(): string | undefined {
  try {
    return getCurrentWindow().label;
  } catch {
    return undefined;
  }
}

export function normalizeSettings(raw: Record<string, unknown>): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...(raw as Partial<Settings>) };
  return {
    ...merged,
    redaction: normalizeRedaction(merged.redaction),
    handoffTemplates: normalizeTemplates(merged.handoffTemplates),
    defaultIntent: typeof merged.defaultIntent === "string" && merged.defaultIntent ? merged.defaultIntent : "continue",
    globalShortcut: typeof merged.globalShortcut === "string" && merged.globalShortcut ? merged.globalShortcut : null,
  };
}

function normalizeSetting(key: string, value: unknown): Partial<Settings> {
  if (key === "redaction") return { redaction: normalizeRedaction(value) };
  if (key === "handoffTemplates") return { handoffTemplates: normalizeTemplates(value) };
  return { [key]: value } as Partial<Settings>;
}

const queryCache = new Map<string, unknown>();
const MAX_CACHED_QUERIES = 24;
const inflight = new Map<string, { tick: number; promise: Promise<unknown> }>();

let windowShown = true;
export const isWindowShown = () => windowShown;

export function useDebouncedValue<T>(value: T, delay = 150) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function remember(key: string, value: unknown) {
  queryCache.delete(key);
  queryCache.set(key, value);
  while (queryCache.size > MAX_CACHED_QUERIES) {
    const oldest = queryCache.keys().next().value;
    if (oldest === undefined) break;
    queryCache.delete(oldest);
  }
}

function request<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const tick = useApp.getState().tick;
  const current = inflight.get(key);
  if (current && current.tick === tick) return current.promise as Promise<T>;
  const pending = loader()
    .then((data) => {
      if (useApp.getState().tick === tick || !queryCache.has(key)) remember(key, data);
      return data;
    })
    .finally(() => {
      if (inflight.get(key)?.promise === pending) inflight.delete(key);
    });
  inflight.set(key, { tick, promise: pending });
  return pending;
}

export function prefetch<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const key = loader.toString() + JSON.stringify(deps);
  if (queryCache.has(key) || inflight.has(key)) return;
  request(key, loader).catch(() => undefined);
}

export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = [], opts: { refreshOnChange?: boolean } = {}) {
  const libraryTick = useApp((s) => s.tick);

  const tick = opts.refreshOnChange === false ? 0 : libraryTick;
  const key = loader.toString() + JSON.stringify(deps);
  const [data, setData] = useState<T | null>(() => (queryCache.get(key) as T | undefined) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !queryCache.has(key));
  const seq = useRef(0);
  const shownKey = useRef(key);
  const reload = useCallback(() => {
    const n = ++seq.current;
    const cached = queryCache.get(key) as T | undefined;
    if (cached !== undefined) setData(cached);
    else if (shownKey.current !== key) setData(null);
    shownKey.current = key;
    setError(null);
    setLoading(cached === undefined);
    request(key, loader)
      .then((d) => {
        if (n === seq.current) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => n === seq.current && setError(errorText(e)))
      .finally(() => n === seq.current && setLoading(false));

  }, [key]);
  useEffect(() => {
    reload();
    return () => {
      seq.current += 1;
    };
  }, [reload, tick]);
  return { data, error, loading, reload };
}

const THEME_KEY = "hopilo.theme";

function applyAppearance(s: Settings) {
  const dark = s.theme === "dark" || (s.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.bg = s.background || "mist";
  root.style.colorScheme = dark ? "dark" : "light";

  root.style.background = "";
  root.dataset.motion = s.motion;
  const native = "__TAURI_INTERNALS__" in window && !(window as { __HOPILO_MOCK__?: boolean }).__HOPILO_MOCK__;
  try {
    localStorage.setItem(THEME_KEY, JSON.stringify({ theme: s.theme }));
  } catch {

  }
  if (native) getCurrentWindow().setTheme(s.theme === "system" ? null : s.theme).catch(() => undefined);
}

export function useBootstrap() {
  const setSettings = useApp((s) => s.setSettings);
  const hydrateListView = useApp((s) => s.hydrateListView);
  const bump = useApp((s) => s.bump);
  const settings = useApp((s) => s.settings);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const load = () =>
      api
        .getSettings()
        .then((raw) => {
          setSettings(normalizeSettings(raw));
          const savedList = raw[LIST_VIEW_KEY];
          if (savedList && typeof savedList === "object") {
            hydrateListView(savedList as Partial<ListView>);
          }
        })
        .finally(() => setReady(true));
    load();
    let dirty = false;
    let timer: number | undefined;
    const flush = () => {
      timer = undefined;
      if (!windowShown) return;
      dirty = false;
      bump();
    };
    const schedule = () => {
      dirty = true;
      if (windowShown && timer === undefined) timer = window.setTimeout(flush, 120);
    };
    const native = "__TAURI_INTERNALS__" in window && !(window as { __HOPILO_MOCK__?: boolean }).__HOPILO_MOCK__;
    if (native) {
      getCurrentWindow()
        .isVisible()
        .then((v) => {
          windowShown = v;
          if (v && dirty) schedule();
        })
        .catch(() => undefined);
    }
    const un1 = listen("hopilo://library-changed", schedule);
    const label = ownWindowLabel();
    const un3 = listen<boolean>(
      "hopilo://visibility",
      ({ payload }) => {
        windowShown = payload !== false;
        if (windowShown) schedule();
      },
      label ? { target: label } : undefined,
    );
    const un2 = listen<[string, unknown]>("hopilo://settings-changed", ({ payload }) => {
      if (!Array.isArray(payload) || typeof payload[0] !== "string") return;
      const [key, value] = payload;
      if (key === LIST_VIEW_KEY && value && typeof value === "object") {
        if (!isOwnListViewEcho(value)) hydrateListView(value as Partial<ListView>);
      } else if (key in DEFAULT_SETTINGS) {
        setSettings(normalizeSetting(key, value));
      } else {
        load();
      }
    });
    return () => {
      window.clearTimeout(timer);
      un1.then((f) => f());
      un2.then((f) => f());
      un3.then((f) => f());
    };
  }, [setSettings, hydrateListView, bump]);

  useEffect(() => {
    applyAppearance(settings);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyAppearance(useApp.getState().settings);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [settings.theme, settings.background, settings.motion]);

  return ready;
}

export async function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  const prev = useApp.getState().settings[key];
  useApp.getState().setSettings({ [key]: value } as Partial<Settings>);
  try {
    await api.setSetting(key, value);
  } catch (e) {
    useApp.getState().setSettings({ [key]: prev } as Partial<Settings>);
    useApp.getState().toast({ kind: "error", text: `Couldn't save that setting: ${errorText(e)}` });
  }
}
