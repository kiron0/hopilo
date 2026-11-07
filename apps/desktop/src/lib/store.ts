import { create } from "zustand";
import { api, type PromptStyle, type RedactionRules } from "./api";

export type SessionFilter = "all" | "agents" | "web" | "added" | "pinned" | "hidden";

export type Route =
  | { page: "overview" }
  | { page: "home" }
  | { page: "sessions"; id?: string; filter?: SessionFilter }
  | { page: "browser" }
  | { page: "compare"; a?: string; b?: string }
  | { page: "settings"; section?: string };

export function routeFrom(name: string): Route {
  if (name === "browser") return { page: "browser" };
  if (name === "settings") return { page: "settings" };
  if (name === "sessions") return { page: "sessions" };
  if (name.startsWith("session:")) return { page: "sessions", id: name.slice(8) };
  return { page: "overview" };
}

export interface ListView {
  q: string;
  filter: SessionFilter;
  provider: string;
  model: string;
  resource: "all" | "with-files" | "without-files";
  page: number;
  selected: string[];
  limit: number | "auto";
  hideUnanswered: boolean;
}

export const LIST_VIEW_KEY = "hopilo.listView";
const DEFAULT_LIST_VIEW: ListView = {
  q: "",
  filter: "all",
  provider: "all",
  model: "all",
  resource: "all",
  page: 0,
  selected: [],
  limit: "auto",
  hideUnanswered: false,
};

const SESSION_FILTERS = new Set<SessionFilter>(["all", "agents", "web", "added", "pinned", "hidden"]);
const RESOURCE_FILTERS = new Set<ListView["resource"]>(["all", "with-files", "without-files"]);

export function normalizeListView(raw: unknown, base: ListView = DEFAULT_LIST_VIEW): ListView {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const selected = Array.isArray(value.selected)
    ? [...new Set(value.selected.filter((id): id is string => typeof id === "string"))]
    : base.selected;
  const limit = value.limit === "auto" || (typeof value.limit === "number" && Number.isInteger(value.limit) && value.limit > 0)
    ? value.limit
    : base.limit;
  return {
    q: typeof value.q === "string" ? value.q : base.q,
    filter: typeof value.filter === "string" && SESSION_FILTERS.has(value.filter as SessionFilter) ? value.filter as SessionFilter : base.filter,
    provider: typeof value.provider === "string" ? value.provider : base.provider,
    model: typeof value.model === "string" ? value.model : base.model,
    resource: typeof value.resource === "string" && RESOURCE_FILTERS.has(value.resource as ListView["resource"])
      ? value.resource as ListView["resource"]
      : base.resource,
    page: typeof value.page === "number" && Number.isInteger(value.page) && value.page >= 0 ? value.page : base.page,
    selected,
    limit,
    hideUnanswered: typeof value.hideUnanswered === "boolean" ? value.hideUnanswered : base.hideUnanswered,
  };
}

function loadListView(): ListView {
  if (typeof localStorage === "undefined") return DEFAULT_LIST_VIEW;
  try {
    const saved = JSON.parse(localStorage.getItem(LIST_VIEW_KEY) ?? "{}");
    return normalizeListView({ ...saved, selected: [] });
  } catch {
    return DEFAULT_LIST_VIEW;
  }
}

const PERSIST_DELAY_MS = 400;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
const pendingEchoes: string[] = [];

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function isOwnListViewEcho(value: unknown): boolean {
  const i = pendingEchoes.indexOf(canonical(value));
  if (i < 0) return false;
  pendingEchoes.splice(0, i + 1);
  return true;
}

function saveListView(v: ListView) {
  const { selected: _, ...rest } = v;
  const json = JSON.stringify(rest);
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(LIST_VIEW_KEY, json);
  } catch {}
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    pendingEchoes.push(canonical(rest));
    if (pendingEchoes.length > 8) pendingEchoes.shift();
    api.setSetting(LIST_VIEW_KEY, rest).catch(() => {});
  }, PERSIST_DELAY_MS);
}

export interface Toast {
  id: number;
  kind: "success" | "info" | "warning" | "error";
  text: string;
  action?: { label: string; run: () => void };
}

export interface Settings {
  theme: "system" | "light" | "dark";
  background?: "mist" | "grid" | "dots" | "grain";
  motion: "system" | "reduced";
  trayClick: "panel" | "dashboard";
  toolDetail: "full" | "truncated" | "omit";
  sessionLayout: "list" | "thumbnails";
  sessionGroup: "none" | "folder" | "provider" | "model";

  level: "full" | "balanced" | "minimal";
  defaultTarget: string;
  onboarded: boolean;
  bannerDismissedAt?: number;
  defaultIntent: string;
  handoffTemplates: HandoffTemplate[];
  promptStyle: PromptStyle | null;
  redaction: RedactionRules;
  globalShortcut: string | null;
  shortcutScope: "any" | "agents";
  shortcutRedact: boolean;
}

export interface HandoffTemplate {
  id: string;
  name: string;
  text: string;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  background: "mist",
  motion: "system",
  trayClick: "panel",
  toolDetail: "truncated",
  sessionLayout: "list",
  sessionGroup: "none",
  level: "full",
  defaultTarget: "claude",
  onboarded: false,
  defaultIntent: "continue",
  handoffTemplates: [],
  promptStyle: null,
  redaction: { patterns: [], keywords: [], excludePaths: [], disabledBuiltins: [] },
  globalShortcut: null,
  shortcutScope: "any",
  shortcutRedact: true,
};

interface State {
  route: Route;
  lastAppRoute: Route;
  navigate: (r: Route) => void;
  toasts: Toast[];
  toast: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
  settings: Settings;
  setSettings: (s: Partial<Settings>) => void;

  tick: number;
  bump: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (o: boolean) => void;
  listView: ListView;
  setListView: (v: Partial<ListView>) => void;
  hydrateListView: (v: Partial<ListView>) => void;
}

let toastId = 0;

export const useApp = create<State>((set, get) => ({
  route: { page: "overview" },
  lastAppRoute: { page: "overview" },
  navigate: (route) => {
    const prev = get().route;
    if (route.page === "settings" && prev.page !== "settings") set({ lastAppRoute: prev });

    if (route.page === "sessions" && route.filter) get().setListView({ filter: route.filter, page: 0, q: "" });
    set({ route });
  },
  toasts: [],
  toast: (t) => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { ...t, id }] });
    setTimeout(() => get().dismiss(id), t.kind === "error" ? 8000 : 4500);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  settings: DEFAULT_SETTINGS,
  setSettings: (s) => set({ settings: { ...get().settings, ...s } }),
  tick: 0,
  bump: () => set({ tick: get().tick + 1 }),
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  listView: loadListView(),
  setListView: (v) => {
    const listView = normalizeListView(v, get().listView);
    saveListView(listView);
    set({ listView });
  },
  hydrateListView: (v) => set({ listView: normalizeListView(v, get().listView) }),
}));
