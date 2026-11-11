import { useStartupLoad } from "./startup";
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, errorText, type SessionRow, type Stats } from "./api";
import { DEFAULT_SETTINGS, LIST_VIEW_KEY, isOwnListViewEcho, type AgentAccess, type ListView, type Settings, useApp } from "./store";
import { normalizeDestinationBudgets } from "./modelLimits";
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
    destinationBudgets: normalizeDestinationBudgets(merged.destinationBudgets),
    redaction: normalizeRedaction(merged.redaction),
    handoffTemplates: normalizeTemplates(merged.handoffTemplates),
    defaultIntent: typeof merged.defaultIntent === "string" && merged.defaultIntent ? merged.defaultIntent : "continue",
    globalShortcut: typeof merged.globalShortcut === "string" && merged.globalShortcut ? merged.globalShortcut : null,
    agentAccess: normalizeAgentAccess(merged.agentAccess),
    autoCheckUpdates: merged.autoCheckUpdates !== false,
    autoDownloadUpdates: merged.autoDownloadUpdates === true,
  };
}

export function normalizeAgentAccess(raw: unknown): AgentAccess {
  const r = raw && typeof raw === "object" ? (raw as Partial<AgentAccess>) : {};
  const ids = Array.isArray(r.sessions) ? r.sessions.filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9]{1,64}$/.test(id)) : [];
  return { enabled: r.enabled === true, mode: r.mode === "selected" ? "selected" : "all", sessions: [...new Set(ids)] };
}

function normalizeSetting(key: string, value: unknown): Partial<Settings> {
  if (key === "agentAccess") return { agentAccess: normalizeAgentAccess(value) };
  if (key === "destinationBudgets") return { destinationBudgets: normalizeDestinationBudgets(value) };
  if (key === "redaction") return { redaction: normalizeRedaction(value) };
  if (key === "handoffTemplates") return { handoffTemplates: normalizeTemplates(value) };
  return { [key]: value } as Partial<Settings>;
}

const queryCache = new Map<string, unknown>();
const cachedTicks = new Map<string, number>();
let cacheEpoch = 0;
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

export const MAX_CACHED_TRANSCRIPTS = 4;
const isTranscriptKey = (key: string) => key.startsWith('["session",');

function forget(key: string) {
  queryCache.delete(key);
  cachedTicks.delete(key);
}

function remember(key: string, value: unknown) {
  queryCache.delete(key);
  queryCache.set(key, value);
  cachedTicks.set(key, useApp.getState().tick);
  if (isTranscriptKey(key)) {
    const transcripts = [...queryCache.keys()].filter(isTranscriptKey);
    for (const old of transcripts.slice(0, Math.max(0, transcripts.length - MAX_CACHED_TRANSCRIPTS))) forget(old);
  }
  while (queryCache.size > MAX_CACHED_QUERIES) {
    const oldest = queryCache.keys().next().value;
    if (oldest === undefined) break;
    forget(oldest);
  }
}

let hoverPrefetch: ReturnType<typeof setTimeout> | undefined;

export function prefetchSoon<T>(loader: () => Promise<T>, query: QueryKey, delay = 150) {
  clearTimeout(hoverPrefetch);
  hoverPrefetch = setTimeout(() => {
    hoverPrefetch = undefined;
    prefetch(loader, query);
  }, delay);
}

export function cancelPrefetchSoon() {
  clearTimeout(hoverPrefetch);
  hoverPrefetch = undefined;
}

const cacheListeners = new Set<() => void>();

function isRow(item: unknown): item is SessionRow {
  return !!item && typeof item === "object" && typeof (item as SessionRow).id === "string" && "pinned" in (item as object);
}

export function patchCachedSession(id: string, patch: Partial<SessionRow>) {
  let before: boolean | undefined;
  const updates: [string, unknown][] = [];
  for (const [key, val] of queryCache) {
    const rows = Array.isArray(val) ? val : val && typeof val === "object" && "rows" in val && Array.isArray(val.rows) ? val.rows : null;
    if (rows) {
      const idx = rows.findIndex((item) => isRow(item) && item.id === id);
      if (idx < 0) continue;
      before ??= (rows[idx] as SessionRow).pinned;
      const next = rows.slice();
      next[idx] = { ...rows[idx], ...patch };
      updates.push([key, Array.isArray(val) ? next : { ...val as object, rows: next }]);
    } else if (val && typeof val === "object" && "row" in val && isRow((val as { row: unknown }).row) && (val as { row: SessionRow }).row.id === id) {
      const row = (val as { row: SessionRow }).row;
      before ??= row.pinned;
      updates.push([key, { ...val, row: { ...row, ...patch } }]);
    }
  }
  if (typeof patch.pinned === "boolean" && before !== undefined && before !== patch.pinned) {
    const diff = patch.pinned ? 1 : -1;
    for (const [key, val] of queryCache) {
      if (val && typeof val === "object" && !Array.isArray(val) && typeof (val as Stats).pinnedCount === "number") {
        updates.push([key, { ...val, pinnedCount: Math.max(0, (val as Stats).pinnedCount + diff) }]);
      }
    }
  }
  if (updates.length === 0) return;
  for (const [key, val] of updates) queryCache.set(key, val);
  for (const fn of cacheListeners) fn();
}

export function invalidateQuery() {
  cacheEpoch += 1;
  queryCache.clear();
  cachedTicks.clear();
  inflight.clear();
}

function request<T>(key: string, loader: () => Promise<T>, cache = true): Promise<T> {
  const tick = useApp.getState().tick;
  const epoch = cacheEpoch;
  const current = inflight.get(key);
  if (current && current.tick === tick) return current.promise as Promise<T>;
  const pending = Promise.resolve().then(loader)
    .then((data) => {
      if (cache && cacheEpoch === epoch && useApp.getState().tick === tick && inflight.get(key)?.promise === pending) remember(key, data);
      return data;
    })
    .finally(() => {
      if (inflight.get(key)?.promise === pending) inflight.delete(key);
    });
  inflight.set(key, { tick, promise: pending });
  return pending;
}

export type QueryKey = readonly [string, ...unknown[]];

export function readCached<T>(_loader: () => Promise<T>, query: QueryKey): T | undefined {
  return queryCache.get(JSON.stringify(query)) as T | undefined;
}

export function prefetch<T>(loader: () => Promise<T>, query: QueryKey) {
  const key = JSON.stringify(query);
  const tick = useApp.getState().tick;
  if (cachedTicks.get(key) === tick || inflight.get(key)?.tick === tick) return;
  request(key, loader).catch(() => undefined);
}

export function useLoad<T>(loader: () => Promise<T>, query: QueryKey, opts: { refreshOnChange?: boolean; cache?: boolean } = {}) {
  const libraryTick = useApp((s) => s.tick);

  const tick = opts.refreshOnChange === false ? 0 : libraryTick;
  const key = JSON.stringify(query);
  const cacheResult = opts.cache !== false;
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
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
    request(key, loaderRef.current, cacheResult)
      .then((d) => {
        if (n === seq.current) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => n === seq.current && setError(errorText(e)))
      .finally(() => n === seq.current && setLoading(false));

  }, [key, cacheResult]);
  useEffect(() => {
    reload();
    return () => {
      seq.current += 1;
    };
  }, [reload, tick]);
  useEffect(() => {
    const sync = () => {
      const cached = queryCache.get(key);
      if (cached !== undefined) setData(cached as T);
    };
    cacheListeners.add(sync);
    return () => {
      cacheListeners.delete(sync);
    };
  }, [key]);
  const changed = shownKey.current !== key;
  useStartupLoad(changed ? !queryCache.has(key) : loading && data === null);
  return { data: changed ? (queryCache.get(key) as T | undefined) ?? null : data, error: changed ? null : error, loading: changed ? !queryCache.has(key) : loading, reload };
}

const THEME_KEY = "hopilo.theme";
let nativeTheme: Settings["theme"] | undefined;

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
  if (native && s.theme !== nativeTheme) {
    nativeTheme = s.theme;
    getCurrentWindow().setTheme(s.theme === "system" ? null : s.theme).catch(() => {
      nativeTheme = undefined;
    });
  }
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
        .catch((e) => useApp.getState().toast({ key: "settings-load", kind: "error", text: `Couldn't load settings: ${errorText(e)}` }))
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
        if (savesInFlight.get(key)) return;
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
    if (!ready) return;
    applyAppearance(settings);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyAppearance(useApp.getState().settings);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [ready, settings.theme, settings.background, settings.motion]);

  return ready;
}

const SETTING_LABELS: Partial<Record<keyof Settings, string>> = {
  theme: "Theme",
  background: "Background",
  motion: "Motion",
  trayClick: "Tray click",
  toolDetail: "Tool activity",
  level: "Default level",
  defaultTarget: "Default destination",
  promptStyle: "Prompt layout",
  defaultIntent: "Default intent",
  handoffTemplates: "Templates",
  redaction: "Redaction rules",
  agentAccess: "Agent access",
  shortcutScope: "Shortcut scope",
  shortcutRedact: "Shortcut redaction",
  autoCheckUpdates: "Automatic update checks",
  autoDownloadUpdates: "Automatic update downloads",
};

const savesInFlight = new Map<string, number>();
const saveChains = new Map<string, Promise<unknown>>();

export async function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  const prev = useApp.getState().settings[key];
  useApp.getState().setSettings({ [key]: value } as Partial<Settings>);
  const label = SETTING_LABELS[key];
  savesInFlight.set(key, (savesInFlight.get(key) ?? 0) + 1);
  const write = (saveChains.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => api.setSetting(key, value));
  saveChains.set(key, write);
  try {
    await write;
    if (label) useApp.getState().toast({ key: "setting-saved", kind: "success", text: `${label} saved.` });
  } catch (e) {
    if (useApp.getState().settings[key] === value) useApp.getState().setSettings({ [key]: prev } as Partial<Settings>);
    useApp.getState().toast({ key: "setting-saved", kind: "error", text: `Couldn't save ${label?.toLowerCase() ?? "that setting"}: ${errorText(e)}` });
  } finally {
    const left = (savesInFlight.get(key) ?? 1) - 1;
    if (left > 0) savesInFlight.set(key, left);
    else {
      savesInFlight.delete(key);
      saveChains.delete(key);
    }
  }
}
