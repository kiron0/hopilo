// Shared user actions (copy, export, import) used by pages and the Quick Panel.
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api, errorText, type Level, type ToolDetail } from "./api";
import { useApp } from "./store";
import { target } from "./targets";

const toast = (...a: Parameters<ReturnType<typeof useApp.getState>["toast"]>) => useApp.getState().toast(...a);

/** Copy the handoff prompt and log it as "copied" — never as delivered. */
export async function copyHandoff(packId: string, version: number, targetId: string, toolDetail: ToolDetail, level: Level = "full") {
  try {
    const p = await api.previewPack(packId, version, "prompt", toolDetail, level);
    await writeText(p.text);
    await api.recordHandoff(packId, version, targetId, "clipboard", "copied");
    const t = target(targetId);
    toast({ kind: "success", text: `Copied for ${t.label}. ${t.hint}` });
    return p;
  } catch (e) {
    toast({ kind: "error", text: `Copy failed: ${errorText(e)}` });
    return null;
  }
}

export async function copyMarkdown(packId: string, version: number, toolDetail: ToolDetail, level: Level = "full") {
  try {
    const p = await api.previewPack(packId, version, "markdown", toolDetail, level);
    await writeText(p.text);
    await api.recordHandoff(packId, version, "other", "clipboard-markdown", "copied");
    toast({ kind: "success", text: "Markdown copied to the clipboard." });
  } catch (e) {
    toast({ kind: "error", text: `Copy failed: ${errorText(e)}` });
  }
}

const FORMATS: Record<string, { name: string; ext: string }> = {
  md: { name: "Markdown", ext: "md" },
  txt: { name: "Handoff prompt", ext: "txt" },
  json: { name: "Context Pack JSON", ext: "json" },
  handoff: { name: "Hopilo archive", ext: "handoff" },
};

export async function exportPack(packId: string, version: number, format: keyof typeof FORMATS, toolDetail: ToolDetail, level: Level = "full") {
  const f = FORMATS[format];
  try {
    const suggested = await api.suggestExportName(packId, version, f.ext);
    const path = await save({ defaultPath: suggested, filters: [{ name: f.name, extensions: [f.ext] }] });
    if (!path) return null;
    const written = await api.exportPack(packId, version, format, path, toolDetail, level);
    toast({ kind: "success", text: `Exported ${f.name} to ${written}` });
    return written;
  } catch (e) {
    toast({ kind: "error", text: `Export failed: ${errorText(e)}` });
    return null;
  }
}

/** One-time clipboard import (CAP-04). No background clipboard monitoring. */
export async function captureClipboard() {
  try {
    const text = await readText();
    if (!text?.trim()) {
      toast({ kind: "warning", text: "The clipboard has no text to capture." });
      return null;
    }
    const out = await api.importText(text, "clipboard");
    toast({
      kind: out.duplicateOf ? "info" : "success",
      text: out.duplicateOf ? "That text is already in your library." : `Captured ${text.length.toLocaleString()} characters from the clipboard.`,
    });
    return out;
  } catch (e) {
    toast({ kind: "error", text: `Clipboard capture failed: ${errorText(e)}` });
    return null;
  }
}

export async function pickFiles(directory = false): Promise<string[]> {
  const res = await open({ multiple: true, directory });
  if (!res) return [];
  return Array.isArray(res) ? res : [res];
}

export async function importPackFile() {
  const res = await open({ multiple: false, filters: [{ name: "Context Pack", extensions: ["handoff", "json"] }] });
  if (!res || Array.isArray(res)) return null;
  try {
    const pack = await api.importPackFile(res);
    toast({ kind: "success", text: `Imported “${pack.title}”.` });
    return pack;
  } catch (e) {
    toast({ kind: "error", text: `Import failed: ${errorText(e)}` });
    return null;
  }
}

/** Flow B in one step: capture a local agent session, build a Full pack and
 *  copy its handoff prompt. Returns the new pack. */
export async function quickHandoff(adapter: string, path: string) {
  const { settings } = useApp.getState();
  try {
    const pack = await api.quickPackFromSession(adapter, path);
    const p = await copyHandoff(pack.packId, pack.version, settings.defaultTarget, settings.toolDetail, settings.level);
    if (p && (p.missing.length > 0 || p.findings.length > 0)) {
      const bits = [];
      if (p.missing.length) bits.push(`${p.missing.length} missing item(s)`);
      if (p.findings.length) bits.push(`${p.findings.length} possible secret(s)`);
      toast({
        kind: "warning",
        text: `Review before sending: ${bits.join(" and ")}.`,
        action: { label: "Review", run: () => useApp.getState().navigate({ page: "packs", packId: pack.packId }) },
      });
    }
    return pack;
  } catch (e) {
    toast({ kind: "error", text: `Handoff failed: ${errorText(e)}` });
    return null;
  }
}
