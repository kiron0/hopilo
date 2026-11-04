// App-wide UI state: navigation, toasts and settings.
import { create } from "zustand";

/** Sessions is home; `id` opens one session. */
export type Route = { page: "sessions"; id?: string } | { page: "browser" } | { page: "settings"; section?: string };

/** Map a route name sent by the shell or Quick Panel (e.g. "settings"). */
export function routeFrom(name: string): Route {
  if (name === "browser") return { page: "browser" };
  if (name === "settings") return { page: "settings" };
  if (name.startsWith("session:")) return { page: "sessions", id: name.slice(8) };
  return { page: "sessions" };
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
}

let toastId = 0;

export const useApp = create<State>((set, get) => ({
  route: { page: "sessions" },
  navigate: (route) => set({ route }),
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
}));
