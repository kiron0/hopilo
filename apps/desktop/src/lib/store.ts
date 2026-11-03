// App-wide UI state: navigation, the Builder draft, toasts and settings.
import { create } from "zustand";
import type { BuildItem } from "./api";

export type Route =
  | { page: "dashboard" }
  | { page: "capture" }
  | { page: "sessions"; tab?: "agents" | "library"; sourceId?: string }
  | { page: "packs"; packId?: string; version?: number }
  | { page: "attachments" }
  | { page: "builder" }
  | { page: "handoff"; packId?: string }
  | { page: "agents" }
  | { page: "browser" }
  | { page: "map" }
  | { page: "settings"; section?: string };

/** One tile on the Builder canvas. `label` and `meta` are display-only. */
export interface DraftItem {
  key: string;
  item: BuildItem;
  label: string;
  meta: string;
  provider: string;
  /** Total messages in the source, for "n of m selected". */
  total?: number;
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
  ollamaModel: string;
  /** Keep the Drop Shelf above other windows. */
  shelfOnTop: boolean;
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
  ollamaModel: "",
  shelfOnTop: false,
  defaultTarget: "chatgpt",
  onboarded: false,
};

interface State {
  route: Route;
  navigate: (r: Route) => void;
  draft: { packId: string | null; title: string; note: string; items: DraftItem[] };
  setDraft: (d: Partial<State["draft"]>) => void;
  addToDraft: (items: DraftItem[]) => number;
  removeFromDraft: (key: string) => void;
  clearDraft: () => void;
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
  route: { page: "dashboard" },
  navigate: (route) => set({ route }),
  draft: { packId: null, title: "", note: "", items: [] },
  setDraft: (d) => set({ draft: { ...get().draft, ...d } }),
  addToDraft: (items) => {
    const existing = new Set(get().draft.items.map((i) => i.key));
    const fresh = items.filter((i) => !existing.has(i.key));
    set({ draft: { ...get().draft, items: [...get().draft.items, ...fresh] } });
    return fresh.length;
  },
  removeFromDraft: (key) => set({ draft: { ...get().draft, items: get().draft.items.filter((i) => i.key !== key) } }),
  clearDraft: () => set({ draft: { packId: null, title: "", note: "", items: [] } }),
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
