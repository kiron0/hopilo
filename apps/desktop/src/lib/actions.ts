import { open, save } from "@tauri-apps/plugin-dialog";
import { api, errorText, type CopyOptions, type CopyOutcome } from "./api";
import { useApp } from "./store";
import { target } from "./targets";

const toast = (...a: Parameters<ReturnType<typeof useApp.getState>["toast"]>) => useApp.getState().toast(...a);

export async function copySessions(ids: string[], opts: CopyOptions = {}) {
  try {
    const out = await api.copySessions(ids, opts);
    if (opts.markdown) toast({ kind: "success", text: "Markdown copied." });
    else toast({ kind: "success", text: `Copied for ${target(out.target).label}. ${target(out.target).hint}` });
    checkNudge(out);
    return out;
  } catch (e) {
    toast({ kind: "error", text: `Copy failed: ${errorText(e)}` });
    return null;
  }
}

function checkNudge(out: CopyOutcome) {
  const bits = [];
  if (out.attach.length) bits.push(`attach ${out.attach.length === 1 ? out.attach[0] : `${out.attach.length} files`} yourself`);
  if (out.missing) bits.push(`${out.missing} part(s) couldn't be captured`);
  if (out.findings) bits.push(`${out.findings} possible secret(s) inside`);
  if (!bits.length) return;
  const one = out.ids.length === 1 ? out.ids[0] : null;
  toast({
    kind: "warning",
    text: `Before sending: ${bits.join(", ")}.`,
    action: one ? { label: "Open", run: () => useApp.getState().navigate({ page: "sessions", id: one }) } : undefined,
  });
}

export const FORMATS = {
  md: { name: "Markdown", ext: "md", hint: "Readable transcript" },
  txt: { name: "Prompt text", ext: "txt", hint: "Same as Copy" },
  json: { name: "JSON", ext: "json", hint: "Structured data" },
  handoff: { name: "Hopilo archive", ext: "handoff", hint: "Includes the files" },
} as const;
export type Format = keyof typeof FORMATS;

export async function exportSessions(ids: string[], format: Format, opts: CopyOptions = {}) {
  const f = FORMATS[format];
  try {
    const suggested = await api.suggestExportName(ids, f.ext);
    const path = await save({ defaultPath: suggested, filters: [{ name: f.name, extensions: [f.ext] }] });
    if (!path) return null;
    const written = await api.exportSessions(ids, format, path, opts);
    toast({ kind: "success", text: `Saved ${f.name} to ${written}` });
    return written;
  } catch (e) {
    toast({ kind: "error", text: `Export failed: ${errorText(e)}` });
    return null;
  }
}

export async function exportSessionsAs(ids: string[], formats: Format[], opts: CopyOptions = {}) {
  if (formats.length === 1) return exportSessions(ids, formats[0], opts);
  try {
    const suggested = await api.suggestExportName(ids, "zip");
    const path = await save({ defaultPath: suggested, filters: [{ name: "Zip archive", extensions: ["zip"] }] });
    if (!path) return null;
    const written = await api.exportSessionsZip(ids, formats, path, opts);
    toast({ kind: "success", text: `Saved ${formats.length} formats to ${written}` });
    return written;
  } catch (e) {
    toast({ kind: "error", text: `Export failed: ${errorText(e)}` });
    return null;
  }
}

export async function captureClipboard() {
  try {
    const out = await api.captureClipboard();
    toast({
      kind: out.duplicateOf ? "info" : "success",
      text: out.duplicateOf ? "That text is already saved." : `Saved ${out.chars.toLocaleString()} characters from the clipboard.`,
      action: { label: "Open", run: () => useApp.getState().navigate({ page: "sessions", id: out.sourceId }) },
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

export async function importHandoffFile() {
  const res = await open({ multiple: false, filters: [{ name: "Hopilo export", extensions: ["handoff", "json"] }] });
  if (!res || Array.isArray(res)) return null;
  try {
    const ids = await api.importHandoffFile(res);
    toast({ kind: "success", text: `Imported ${ids.length} session${ids.length === 1 ? "" : "s"}.` });
    return ids;
  } catch (e) {
    toast({ kind: "error", text: `Import failed: ${errorText(e)}` });
    return null;
  }
}

export async function saveFileAs(sha: string, name: string) {
  const path = await save({ defaultPath: name });
  if (!path) return;
  try {
    await api.saveFile(sha, path);
    toast({ kind: "success", text: `Saved ${name}.` });
  } catch (e) {
    toast({ kind: "error", text: errorText(e) });
  }
}
