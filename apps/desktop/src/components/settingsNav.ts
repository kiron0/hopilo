import { deviceNoun } from "../lib/platform";
import type { ReactNode } from "react";
import { Archive, Bot, Gear, Info, Palette, SendIcon, ShieldCheck, ToolsIcon, type IconProps } from "./Icons";

export type SettingsGroup = "general" | "appearance" | "handoff" | "sources" | "privacy" | "agents" | "library" | "about";

export const SETTINGS_GROUPS: { id: SettingsGroup; label: string; icon: (p: IconProps) => ReactNode }[] = [
  { id: "general", label: "General", icon: Gear },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "handoff", label: "Copy & handoff", icon: SendIcon },
  { id: "sources", label: "Sources", icon: Bot },
  { id: "privacy", label: "Privacy", icon: ShieldCheck },
  { id: "agents", label: "Agent access", icon: ToolsIcon },
  { id: "library", label: "Backup & storage", icon: Archive },
  { id: "about", label: "About", icon: Info },
];

export const SETTINGS_SECTIONS: { id: string; label: string; group: SettingsGroup; keywords: string }[] = [
  { id: "general", label: "Startup and window", group: "general", keywords: "launch login autostart tray dock window" },
  { id: "shortcut", label: "Global shortcut", group: "general", keywords: "hotkey keyboard copy latest" },
  { id: "appearance", label: "Theme and background", group: "appearance", keywords: "dark light theme background motion animation" },
  { id: "handoff", label: "Copy defaults", group: "handoff", keywords: "destination tool activity level prompt layout" },
  { id: "templates", label: "Handoff intents", group: "handoff", keywords: "templates continue review debug custom" },
  { id: "model-limits", label: "Model limits", group: "handoff", keywords: "context window tokens budget catalog" },
  { id: "sources", label: "Coding agents and web chats", group: "sources", keywords: "adapters claude code codex cursor browser extension" },
  { id: "privacy", label: "Privacy overview", group: "privacy", keywords: "network offline clipboard sensitive" },
  { id: "redaction", label: "Redaction rules", group: "privacy", keywords: "secrets keywords patterns exclude files" },
  { id: "agents", label: "Agent access", group: "agents", keywords: "mcp cli hopilo command coding agents folders" },
  { id: "backups", label: "Encrypted backups", group: "library", keywords: "backup restore schedule password hbackup" },
  { id: "storage", label: "Storage", group: "library", keywords: "data folder space verify erase library" },
  { id: "about", label: "About Hopilo", group: "about", keywords: "version updates github support" },
];

const LEGACY: Record<string, SettingsGroup> = { customize: "appearance", data: "privacy" };

const SECTION_GROUP: Record<string, SettingsGroup> = {
  ...LEGACY,
  ...Object.fromEntries(SETTINGS_GROUPS.map((g) => [g.id, g.id])),
  ...Object.fromEntries(SETTINGS_SECTIONS.map((s) => [s.id, s.group])),
};

export function settingsGroupFor(section: string | undefined): SettingsGroup {
  return (section && SECTION_GROUP[section]) || "general";
}

export const SETTINGS_SUBTITLES: Record<SettingsGroup, string> = {
  general: "Startup and window behavior, and the global shortcut. Changes save immediately.",
  appearance: "Window canvas, theme and animations. Changes save immediately.",
  handoff: "What Copy puts on the clipboard, handoff intents and destination context limits.",
  sources: `Coding agents Hopilo reads on this ${deviceNoun}. Their files are only read, never changed.`,
  privacy: "What Hopilo can see and send, and the rules that hide sensitive text in copies and exports.",
  agents: `Let coding agents on this ${deviceNoun} read your sessions through the hopilo command or MCP.`,
  library: `Encrypted backups and the one folder on this ${deviceNoun} where your library lives.`,
  about: "Hopilo: every AI session in one place.",
};
