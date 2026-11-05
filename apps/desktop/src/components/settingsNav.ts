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
  sources: "sources",
  data: "data",
  privacy: "data",
  storage: "data",
  about: "about",
};

export function settingsGroupFor(section: string | undefined): SettingsGroup {
  return (section && SECTION_GROUP[section]) || "general";
}
