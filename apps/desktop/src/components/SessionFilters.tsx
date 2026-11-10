import { useMemo } from "react";
import { Bot, FileText, Globe, MessagesSquare, Paperclip, Pin, Plus, RotateCcw, SparkIcon, ToolsIcon, X } from "./Icons";
import { ProviderLogo } from "./ProviderLogos";
import { Select, type SelectOption } from "./Select";
import { provider } from "../lib/format";
import { TARGETS } from "../lib/targets";

export const SESSION_FILTERS: SelectOption[] = [
  { value: "all", label: "All", icon: <MessagesSquare size={14} className="text-muted" /> },
  { value: "agents", label: "Coding agents", icon: <Bot size={14} className="text-muted" /> },
  { value: "web", label: "Web chats", icon: <Globe size={14} className="text-muted" /> },
  { value: "added", label: "Added", icon: <Plus size={14} className="text-muted" /> },
  { value: "pinned", label: "Pinned", icon: <Pin size={14} filled className="text-accent fill-accent" /> },
  { value: "hidden", label: "Hidden", icon: <RotateCcw size={14} className="text-muted" /> },
];

export const RESOURCE_OPTIONS: SelectOption[] = [
  { value: "all", label: "All resources", icon: <Paperclip size={14} className="text-muted" /> },
  { value: "with-files", label: "With files", icon: <FileText size={14} className="text-muted" /> },
  { value: "without-files", label: "Without files", icon: <X size={14} className="text-muted" /> },
];

export function FilterSelect({ label, value, options, onChange, className = "w-36" }: { label: string; value: string; options: SelectOption[]; onChange: (value: string) => void; className?: string }) {
  return <div className={`shrink-0 ${className}`}><Select size="sm" label={label} value={value} options={options} onChange={onChange} /></div>;
}

export function useProviderOptions(providers: string[] | undefined, current: string): SelectOption[] {
  return useMemo<SelectOption[]>(() => {
    const list: SelectOption[] = [{ value: "all", label: "All tools", icon: <ToolsIcon size={14} className="text-muted" /> }];
    const targets = TARGETS.filter((t) => t.id !== "other")
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "chat" ? -1 : 1))
      .map((t) => ({
        value: t.id,
        label: t.label,
        group: t.kind === "chat" ? "Chat apps" : "Coding agents & editors",
        icon: <ProviderLogo id={t.id} size={14} className="text-muted" monochrome />,
      }));
    list.push(...targets);
    const known = new Set(TARGETS.map((t) => t.id));
    const extra = new Set((providers ?? []).filter((id) => id && !known.has(id)));
    if (current !== "all" && !known.has(current)) extra.add(current);
    for (const id of [...extra].sort()) {
      list.push({
        value: id,
        label: provider(id).label,
        group: "Other tools",
        icon: <ProviderLogo id={id} size={14} className="text-muted" monochrome />,
      });
    }
    return list;
  }, [providers, current]);
}

export function useModelOptions(models: string[] | undefined, current: string): SelectOption[] {
  return useMemo<SelectOption[]>(() => {
    const set = new Set(models ?? []);
    if (current !== "all") set.add(current);
    return [
      { value: "all", label: "All models", icon: <SparkIcon size={14} className="text-muted" /> },
      ...[...set].sort((a, b) => a.localeCompare(b)).map((model) => ({
        value: model,
        label: model === "__unknown" ? "Unknown model" : model,
        icon: <Bot size={14} className="text-muted" />,
      })),
    ];
  }, [models, current]);
}
