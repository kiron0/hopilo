// Shared user actions (copy, export, import) used by pages and the Quick Panel.
import { open, save } from "@tauri-apps/plugin-dialog";
import { api, errorText, type CopyOutcome, type Level, type ToolDetail } from "./api";
import { useApp } from "./store";
import { target } from "./targets";

const toast = (...a: Parameters<ReturnType<typeof useApp.getState>["toast"]>) => useApp.getState().toast(...a);

/** Copy the handoff prompt and log it as "copied" — never as delivered.
 *  Rendering, the clipboard write and the record happen in one Rust call. */
export async function copyHandoff(packId: string, version: number, targetId: string, toolDetail: ToolDetail, level: Level = "full") {
  try {
    const out = await api.copyPack(packId, version, { target: targetId, toolDetail, level });
    const t = target(out.target);
    toast({ kind: "success", text: `Copied for ${t.label}. ${t.hint}` });
    reviewNudge(out);
    return out;
  } catch (e) {
    toast({ kind: "error", text: `Copy failed: ${errorText(e)}` });
    return null;
  }
}

export async function copyMarkdown(packId: string, version: number, toolDetail: ToolDetail, level: Level = "full") {
  try {
    await api.copyPack(packId, version, { markdown: true, toolDetail, level });
    toast({ kind: "success", text: "Markdown copied to the clipboard." });
  } catch (e) {
    toast({ kind: "error", text: `Copy failed: ${errorText(e)}` });
  }
}

/** After a copy, point at anything worth a look before sending. */
function reviewNudge(out: CopyOutcome) {
  if (!out.missing && !out.findings) return;
  const bits = [];
  if (out.missing) bits.push(`${out.missing} missing item(s)`);
  if (out.findings) bits.push(`${out.findings} possible secret(s)`);
  toast({
    kind: "warning",
    text: `Review before sending: ${bits.join(" and ")}.`,
    action: { label: "Review", run: () => useApp.getState().navigate({ page: "packs", packId: out.packId }) },
  });
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

/** One-time clipboard import (CAP-04), read in Rust. No background monitoring. */
export async function captureClipboard() {
  try {
    const out = await api.captureClipboard();
    toast({
      kind: out.duplicateOf ? "info" : "success",
      text: out.duplicateOf ? "That text is already in your library." : `Captured ${out.chars.toLocaleString()} characters from the clipboard.`,
    });
    return out;
  } catch (e) {
    toast({ kind: "warning", text: errorText(e) });
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
 *  copy its handoff prompt with the saved defaults — one Rust call. */
export async function quickHandoff(adapter: string, path: string) {
  try {
    const out = await api.quickHandoff(adapter, path);
    toast({ kind: "success", text: `Copied “${out.title}” for ${target(out.target).label}. ${target(out.target).hint}` });
    reviewNudge(out);
    return out;
  } catch (e) {
    toast({ kind: "error", text: `Handoff failed: ${errorText(e)}` });
    return null;
  }
}
