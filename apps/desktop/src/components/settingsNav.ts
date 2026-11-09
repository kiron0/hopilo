import { deviceNoun } from "../lib/platform";
import type { ReactNode } from "react";
import { Boxes, Info, Pencil, Power, ShieldCheck, type IconProps } from "./Icons";

export type SettingsGroup = "general" | "customize" | "sources" | "data" | "about";

export const SETTINGS_GROUPS: { id: SettingsGroup; label: string; icon: (p: IconProps) => ReactNode }[] = [
  { id: "general", label: "General", icon: Power },
  { id: "customize", label: "Customization", icon: Pencil },
  { id: "sources", label: "Sources", icon: Boxes },
  { id: "data", label: "Privacy & data", icon: ShieldCheck },
  { id: "about", label: "About", icon: Info },
];

const SECTION_GROUP: Record<string, SettingsGroup> = {
  general: "general",
  customize: "customize",
  appearance: "customize",
  handoff: "customize",
  "model-limits": "customize",
  templates: "customize",
  shortcut: "general",
  redaction: "data",
  sources: "sources",
  data: "data",
  privacy: "data",
  storage: "data",
  about: "about",
};

export function settingsGroupFor(section: string | undefined): SettingsGroup {
  return (section && SECTION_GROUP[section]) || "general";
}

export const SETTINGS_SUBTITLES: Record<SettingsGroup, string> = {
  general: "Startup and window behavior. Changes save immediately.",
  customize: "Window canvas, theme and animations, and what Copy puts on the clipboard. Changes save immediately.",
  sources: `Coding agents Hopilo reads on this ${deviceNoun}. Their files are only read, never changed.`,
  data: `What Hopilo can see and send, and the one folder on this ${deviceNoun} where your library lives.`,
  about: "Hopilo: every AI session in one place.",
};
