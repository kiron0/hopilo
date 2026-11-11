import { open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, errorText, type CopyOptions, type CopyOutcome } from "./api";
import { track, useApp } from "./store";
import { target } from "./targets";

const toast = (...a: Parameters<ReturnType<typeof useApp.getState>["toast"]>) => useApp.getState().toast(...a);

export async function copySessions(ids: string[], opts: CopyOptions = {}) {
  const out = await track(api.copySessions(ids, opts), {
    key: "copy",
    pending: ids.length > 1 ? `Combining ${ids.length} sessions…` : "Preparing the copy…",
    success: (o) => (opts.markdown ? "Markdown copied." : `Copied for ${target(o.target).label}. ${target(o.target).hint}`),
    error: "Copy failed",
  });
  if (out) checkNudge(out);
  return out;
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
  html: { name: "Web page", ext: "html", hint: "Offline, shareable viewer" },
  json: { name: "JSON", ext: "json", hint: "Structured data" },
  handoff: { name: "Hopilo bundle", ext: "hopilo", hint: "Opens in Hopilo, with files" },
} as const;
export type Format = keyof typeof FORMATS;

export async function exportSessions(ids: string[], format: Format, opts: CopyOptions = {}) {
  const f = FORMATS[format];
  try {
    const suggested = await api.suggestExportName(ids, f.ext);
    const path = await save({ defaultPath: suggested, filters: [{ name: f.name, extensions: [f.ext] }] });
    if (!path) return null;
    return await track(api.exportSessions(ids, format, path, opts), {
      key: "export",
      pending: `Exporting ${f.name}…`,
      success: (written) => ({ kind: "success", text: `Saved ${f.name} to ${written}`, action: { label: "Show", run: () => revealItemInDir(written).catch(() => undefined) } }),
      error: "Export failed",
    });
  } catch (e) {
    toast({ kind: "error", text: `Export failed: ${errorText(e)}` });
    return null;
  }
}

export function zipSummary(formats: number, files: number, missingFiles: number) {
  const parts = [`${formats} ${formats === 1 ? "format" : "formats"}`];
  if (files) parts.push(`${files} ${files === 1 ? "file" : "files"}`);
  const missing = missingFiles ? ` · ${missingFiles} ${missingFiles === 1 ? "file" : "files"} unavailable` : "";
  return `${parts.join(" and ")}${missing}`;
}

export async function exportSessionsAs(ids: string[], formats: Format[], opts: CopyOptions = {}, includeFiles = false) {
  if (formats.length === 1 && !includeFiles) return exportSessions(ids, formats[0], opts);
  try {
    const suggested = await api.suggestExportName(ids, "zip");
    const path = await save({ defaultPath: suggested, filters: [{ name: "Zip archive", extensions: ["zip"] }] });
    if (!path) return null;
    const out = await track(api.exportSessionsZip(ids, formats, path, opts, includeFiles), {
      key: "export",
      pending: includeFiles ? "Exporting with files…" : `Exporting ${formats.length} formats…`,
      success: (z) => ({
        kind: z.missingFiles ? "warning" : "success",
        text: `Saved ${zipSummary(formats.length, z.files, z.missingFiles)} to ${z.path}`,
        action: { label: "Show", run: () => revealItemInDir(z.path).catch(() => undefined) },
      }),
      error: "Export failed",
    });
    return out ? out.path : null;
  } catch (e) {
    toast({ kind: "error", text: `Export failed: ${errorText(e)}` });
    return null;
  }
}

export async function captureClipboard() {
  try {
    toast({ kind: "loading", text: "Reading the clipboard…", key: "capture" });
    const out = await api.captureClipboard();
    toast({
      key: "capture",
      kind: out.duplicateOf ? "info" : "success",
      text: out.duplicateOf ? "That text is already saved." : `Saved ${out.chars.toLocaleString()} characters from the clipboard.`,
      action: { label: "Open", run: () => useApp.getState().navigate({ page: "sessions", id: out.sourceId }) },
    });
    return out;
  } catch (e) {
    toast({ key: "capture", kind: "warning", text: errorText(e) });
    return null;
  }
}

export async function pickFiles(directory = false): Promise<string[]> {
  const res = await open({ multiple: true, directory });
  if (!res) return [];
  return Array.isArray(res) ? res : [res];
}

export async function importHandoffFile() {
  const res = await open({ multiple: false, filters: [{ name: "Hopilo bundle or export", extensions: ["hopilo", "handoff", "json"] }] });
  if (!res || Array.isArray(res)) return null;
  try {
    toast({ kind: "loading", text: "Importing…", key: "import" });
    const ids = await api.importHandoffFile(res);
    const first = ids[0];
    toast({
      key: "import",
      kind: "success",
      text: `Imported ${ids.length} session${ids.length === 1 ? "" : "s"}.`,
      action: first ? { label: "Open", run: () => useApp.getState().navigate({ page: "sessions", id: first }) } : undefined,
    });
    return ids;
  } catch (e) {
    toast({ key: "import", kind: "error", text: `Import failed: ${errorText(e)}` });
    return null;
  }
}

export async function saveFileAs(sha: string, name: string) {
  const path = await save({ defaultPath: name });
  if (!path) return;
  await track(api.saveFile(sha, path), { key: `save-${sha}`, pending: `Saving ${name}…`, success: `Saved ${name}.`, error: `Couldn't save ${name}` });
}
