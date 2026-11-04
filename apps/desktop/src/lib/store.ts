import { create } from "zustand";

export type SessionFilter = "all" | "agents" | "web" | "added" | "pinned";

export type Route =
  | { page: "overview" }
  | { page: "home" }
  | { page: "sessions"; id?: string; filter?: SessionFilter }
  | { page: "browser" }
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
  background?: "mist" | "grid" | "dots" | "grain";
  motion: "system" | "reduced";
  startupSurface: "tray" | "overview" | "home";
  closeButton: "hide" | "quit";
  trayClick: "panel" | "dashboard";
  toolDetail: "full" | "truncated" | "omit";

  level: "full" | "balanced" | "minimal";
  defaultTarget: string;
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  background: "mist",
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

  tick: number;
  bump: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (o: boolean) => void;
  listView: ListView;
  setListView: (v: Partial<ListView>) => void;
}

let toastId = 0;

export const useApp = create<State>((set, get) => ({
  route: { page: "overview" },
  navigate: (route) => {

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
