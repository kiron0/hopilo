// App-wide UI state: navigation, toasts and settings.
import { create } from "zustand";

export type SessionFilter = "all" | "agents" | "web" | "added" | "pinned";

/** `id` opens one session; `filter` opens the list with that filter. */
export type Route =
  | { page: "home" }
  | { page: "sessions"; id?: string; filter?: SessionFilter }
  | { page: "browser" }
  | { page: "settings"; section?: string };

/** Map a route name sent by the shell or Quick Panel (e.g. "settings"). */
export function routeFrom(name: string): Route {
  if (name === "browser") return { page: "browser" };
  if (name === "settings") return { page: "settings" };
  if (name === "sessions") return { page: "sessions" };
  if (name.startsWith("session:")) return { page: "sessions", id: name.slice(8) };
  return { page: "home" };
}

/** The session list's search, filter, page and selection. Kept here so
 *  opening a session and coming back restores the list exactly. */
export interface ListView {
  q: string;
  filter: SessionFilter;
  page: number;
  selected: string[];
}

export interface Toast {
  id: number;
  kind: "success" | "info" | "warning" | "error";
  text: string;
  action?: { label: string; run: () => void };
}

export interface Settings {
  theme: "system" | "light" | "dark";
  motion: "system" | "reduced";
  startupSurface: "tray" | "home";
  closeButton: "hide" | "quit";
  trayClick: "panel" | "dashboard";
  toolDetail: "full" | "truncated" | "omit";
  /** How much of the conversation a handoff carries by default. */
  level: "full" | "balanced" | "minimal";
  defaultTarget: string;
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  motion: "system",
  startupSurface: "tray",
  closeButton: "hide",
  trayClick: "panel",
  toolDetail: "truncated",
  level: "full",
  defaultTarget: "chatgpt",
  onboarded: false,
};

interface State {
  route: Route;
  navigate: (r: Route) => void;
  toasts: Toast[];
  toast: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
  settings: Settings;
  setSettings: (s: Partial<Settings>) => void;
  /** Bumped whenever the library changes, to trigger reloads. */
  tick: number;
  bump: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (o: boolean) => void;
  listView: ListView;
  setListView: (v: Partial<ListView>) => void;
}

let toastId = 0;

export const useApp = create<State>((set, get) => ({
  route: { page: "home" },
  navigate: (route) => {
    // A filter in the route (e.g. from a Home tile) resets the list to it.
    if (route.page === "sessions" && route.filter) set({ listView: { ...get().listView, filter: route.filter, page: 0, q: "" } });
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
  listView: { q: "", filter: "all", page: 0, selected: [] },
  setListView: (v) => set({ listView: { ...get().listView, ...v } }),
}));
