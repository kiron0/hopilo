import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { api, type Attachment, type Message, type SessionRow } from "../lib/api";
import { invalidateQuery, normalizeAgentAccess } from "../lib/hooks";
import { DEFAULT_SETTINGS, useApp } from "../lib/store";
import { HandoffModal } from "./HandoffModal";
import { BackupSettings } from "./BackupSettings";
import { AgentAccessSettings } from "./AgentAccessSettings";
import { SETTINGS_GROUPS, SETTINGS_SECTIONS, settingsGroupFor } from "./settingsNav";
import { Sessions } from "../pages/Sessions";
import { open, save } from "@tauri-apps/plugin-dialog";

await vi.hoisted(async () => {
  const { parseHTML } = await import("linkedom");
  const { window } = parseHTML("<html><body></body></html>");
  Object.assign(globalThis, { window, document: window.document });
  Object.defineProperty(window.document, "oninput", { value: null, configurable: true });
});

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn(), readText: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
let root: Root;
beforeEach(() => {
  const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
  for (const key of ["window", "document", "HTMLElement", "Element", "Node", "Event", "HTMLInputElement", "HTMLTextAreaElement"] as const) vi.stubGlobal(key, window[key]);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, right: 200, top: 0, bottom: 30, width: 200, height: 30, x: 0, y: 0, toJSON: () => ({}) });
  window.innerWidth = 1200; window.innerHeight = 800;
  Object.defineProperty(window.HTMLTextAreaElement.prototype, "defaultValue", {
    configurable: true, get() { return this.textContent; }, set(value) { this.textContent = String(value); },
  });
  invalidateQuery();
  useApp.setState({ settings: { ...DEFAULT_SETTINGS }, route: { page: "sessions" }, toasts: [] });
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text)!;
const click = async (el: Element) => act(async () => { el.dispatchEvent(new window.Event("click", { bubbles: true })); });
const finalPreviewText = () => document.querySelector<HTMLTextAreaElement>('[aria-label="Final handoff preview"]')?.value ?? document.querySelector('[aria-label="Exact handoff preview"] pre code')?.textContent;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 230)); });
const type = async (input: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
});
const row = (id: string): SessionRow => ({ id, title: `Session ${id}`, provider: "manual", kind: "manual", origin: null, project: null, model: null, captureStatus: "complete", updatedAt: "2026-11-09T00:00:00Z", messageCount: 1, replyCount: 0, tokenEstimate: 4, missingCount: 0, fileCount: 0, pinned: false, tags: [], lastCopiedAt: null });
const messages: Message[] = ["a", "b"].map((sourceId) => ({ id: "same", sourceId, role: "user", createdAt: null, blocks: [{ type: "text", text: `Message ${sourceId}` }] }));
function mockHandoff() {
  vi.spyOn(api, "querySessions").mockResolvedValue({ rows: [row("a"), row("b")], total: 2, offset: 0, providers: [], providerCounts: {}, models: [], folders: [], counts: { hidden: 0, total: 2, pinned: 0, agents: 0, web: 0, webToday: 0, unanswered: 0 } });
  vi.spyOn(api, "preflightHandoff").mockResolvedValue({ title: "Project", sourceCount: 2, totalMessages: 2, totalTokens: 8, findings: [], excludedFiles: [], ruleErrors: [], full: { messageCount: 2, tokenEstimate: 8 }, balanced: { messageCount: 2, tokenEstimate: 8 }, minimal: { messageCount: 2, tokenEstimate: 8 } });
  vi.spyOn(api, "handoffMessages").mockResolvedValue(messages);
  return vi.spyOn(api, "previewHandoff").mockImplementation(async (_ids, format, opts = {}) => {
    if (opts.selected?.length === 0) throw new Error("Choose at least one message");
    const text = (opts.selected ?? messages).map((m) => m.sourceId).join(",");
    return { text: `Final: ${text}`, hash: `hash-${text}`, format, tokenEstimate: 4, messageCount: opts.selected?.length ?? 2 };
  });
}

describe("exact handoff flow", () => {
  it("selects by source plus message ID, waits for preview, sends reviewed options", async () => {
    const preview = mockHandoff();
    const copy = vi.spyOn(api, "copySessions").mockResolvedValue({ ids: ["a", "b"], title: "Project", target: "claude", tokenEstimate: 4, missing: 0, findings: 0, attach: [] });
    const close = vi.fn();
    await act(async () => root.render(<HandoffModal ids={["a", "b"]} action="copy" onClose={close} />));
    expect(finalPreviewText()).toBe("Final: a,b");
    await click(button("Select messages"));
    await click(document.querySelectorAll('[aria-label="Include User message"]')[1]);
    expect(button("Copy combined pack for Claude").disabled).toBe(true);
    await settle();
    expect(preview.mock.calls.at(-1)?.[2]?.selected).toEqual([{ sourceId: "a", id: "same" }]);
    expect(finalPreviewText()).toBe("Final: a");
    await click(button("Copy combined pack for Claude"));
    expect(copy.mock.calls[0][1]).toMatchObject({ selected: [{ sourceId: "a", id: "same" }], reviewed: { format: "txt", hash: "hash-a" } });
    expect(close).toHaveBeenCalledOnce();
  });
  it("blocks empty selections and failed previews, retains dialog after stale-review failure", async () => {
    mockHandoff();
    const copy = vi.spyOn(api, "copySessions").mockRejectedValue(new Error("Session changed since preview"));
    const close = vi.fn();
    await act(async () => root.render(<HandoffModal ids={["a"]} action="copy-markdown" onClose={close} />));
    await click(button("Select messages"));
    await click(button("Clear selection"));
    await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Choose at least one message");
    expect(button("Copy Markdown").disabled).toBe(true);
    await click(button("Keep all messages")); await settle();
    await click(button("Copy Markdown"));
    expect(copy).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
    expect(useApp.getState().toasts.some((toast) => toast.text.includes("Session changed"))).toBe(true);
  });
});

describe("backup flow", () => {
  it("keeps restore disabled until verification; exposes saved locked schedule", async () => {
    vi.spyOn(api, "backupStatus").mockResolvedValue({ unlocked: false, directory: "/backups", hours: 24, lastResult: null });
    vi.mocked(open).mockResolvedValueOnce("/backups/library.hbackup");
    await act(async () => root.render(<BackupSettings />));
    expect([...document.querySelectorAll<HTMLInputElement>('input')].some((input) => input.value === "/backups")).toBe(true);
    expect(button("Unlock schedule").disabled).toBe(true);
    await click(button("Choose backup to verify / restore"));
    expect(button("Restore verified backup…").disabled).toBe(true);
    expect(button("Verify backup").disabled).toBe(true);
    expect(document.body.textContent).toContain("Unlock once per app run");
  });
  it("creates verified backups, unlocks schedule, verifies before confirmed restore", async () => {
    const status = { unlocked: false, directory: "/backups", hours: 24, lastResult: null };
    vi.spyOn(api, "backupStatus").mockImplementation(async () => ({ ...status }));
    const report = { verified: true, sessions: 3, files: 2, createdAt: "2026-11-09T00:00:00Z" };
    const create = vi.spyOn(api, "createBackup").mockResolvedValue(report);
    const unlock = vi.spyOn(api, "unlockBackupSchedule").mockImplementation(async () => { status.unlocked = true; });
    const verify = vi.spyOn(api, "verifyBackup").mockRejectedValueOnce(new Error("Wrong password or damaged backup")).mockResolvedValue(report);
    const restore = vi.spyOn(api, "restoreBackup").mockRejectedValueOnce(new Error("Recovery destination is full")).mockResolvedValue({ report, recoveryPath: "/recovery/before-restore.hbackup" });
    vi.mocked(save).mockResolvedValueOnce("/backups/new.hbackup");
    vi.mocked(open).mockResolvedValueOnce("/backups/old.hbackup");
    await act(async () => root.render(<BackupSettings />));
    const passwords = () => [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')];
    await type(passwords()[0], "long test password"); await type(passwords()[1], "long test password");
    expect(button("Create encrypted backup").disabled).toBe(false);
    await click(button("Create encrypted backup"));
    expect(create).toHaveBeenCalledWith("/backups/new.hbackup", "long test password");
    expect(passwords().every((input) => input.value === "")).toBe(true);
    await type(passwords()[0], "long test password"); await type(passwords()[1], "long test password");
    await click(button("Unlock schedule"));
    expect(unlock).toHaveBeenCalledWith("/backups", 24, "long test password");
    expect(button("Lock schedule").disabled).toBe(false);
    await click(button("Choose backup to verify / restore"));
    await type(passwords()[0], "long test password");
    await click(button("Verify backup"));
    expect(button("Restore verified backup…").disabled).toBe(true);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Wrong password");
    await click(button("Verify backup"));
    expect(verify).toHaveBeenCalledTimes(2);
    await click(button("Restore verified backup…"));
    expect(restore).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    await click(button("Restore library"));
    expect(restore).toHaveBeenCalledWith("/backups/old.hbackup", "long test password");
    expect(document.querySelector('[role="alertdialog"] [role="alert"]')?.textContent).toBe("Recovery destination is full");
    await click(button("Restore library"));
    expect(restore).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("Recovery backup: /recovery/before-restore.hbackup");
  });
});

describe("session file cards", () => {
  it("uses cards for every file, guards native files, retries removal, refreshes its message", async () => {
    const added: Attachment = { id: "added", fileName: "notes.txt", mediaType: "text/plain", size: 12, sha256: "added-sha", originPath: null, text: "local notes", manualMessageId: "upload" };
    const captured: Attachment = { id: "native", fileName: "source.png", mediaType: "image/png", size: 10, sha256: "native-sha", originPath: null, text: null, manualMessageId: null };
    const msg: Message = { id: "upload", sourceId: "a", role: "user", createdAt: null, blocks: [{ type: "file", name: added.fileName, mediaType: added.mediaType, sha256: added.sha256, size: added.size }] };
    let removed = false;
    useApp.setState({ route: { page: "sessions", id: "a" } });
    vi.spyOn(api, "getSession").mockImplementation(async () => ({ row: { ...row("a"), messageCount: removed ? 1 : 2 }, source: { sourceId: "a", title: "Session a", provider: "manual", kind: "manual", origin: null, project: null, model: null, capturedAt: "2026-11-09T00:00:00Z", captureStatus: "complete", omitted: [], missingItems: [] }, messages: removed ? [messages[0]] : [messages[0], msg], files: removed ? [captured] : [captured, added], tokenEstimate: 10 }));
    vi.spyOn(api, "readFilePreview").mockResolvedValue(new TextEncoder().encode("local notes").buffer);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const openFile = vi.spyOn(api, "openFile").mockResolvedValue();
    const remove = vi.spyOn(api, "removeSessionFile").mockRejectedValueOnce(new Error("Library busy")).mockImplementation(async () => { removed = true; });
    await act(async () => root.render(<Sessions />));
    const viewControl = document.querySelector('[aria-label="Transcript view"]')!;
    expect(viewControl.parentElement?.querySelector('[aria-label="View"]')).not.toBeNull();
    expect(document.getElementById("msg-upload")?.contains(viewControl)).toBe(false);
    await click([...viewControl.querySelectorAll('[role="radio"]')].find((el) => el.textContent === "Source")!);
    expect(viewControl.querySelector('[aria-checked="true"]')?.textContent).toBe("Source");
    const inlineFile = document.querySelector('#msg-upload [aria-label="Preview notes.txt"]')!;
    expect(inlineFile.querySelector('[aria-hidden="true"]')).not.toBeNull();
    await click(inlineFile);
    expect(document.querySelector('[aria-label="File preview: notes.txt"]')?.textContent).toContain("local notes");
    await click(document.querySelector('[role="dialog"] button[aria-label="Close"]')!);
    await settle();
    await click(button("Files (2)"));
    expect(document.querySelector('[aria-label="Transcript view"]')).toBeNull();
    expect(document.querySelectorAll('[aria-label="Session files"] > li')).toHaveLength(2);
    expect(document.querySelector('[aria-label="Remove source.png"]')).toBeNull();
    await click(document.querySelector('[aria-label="Actions for notes.txt"]')!);
    expect(document.querySelector('[role="menu"]')?.textContent).toContain("OpenDownloadDetailsDelete");
    await click(button("Open"));
    expect(document.querySelector('[aria-label="File preview: notes.txt"]')?.textContent).toContain("local notes");
    expect(openFile).not.toHaveBeenCalled();
    await click(document.querySelector('[role="dialog"] button[aria-label="Close"]')!);
    await settle();
    await click(document.querySelector('[aria-label="Actions for notes.txt"]')!);
    await click(button("Delete"));
    expect(remove).not.toHaveBeenCalled();
    await click(button("Delete file"));
    expect(document.querySelector('[role="alertdialog"] [role="alert"]')?.textContent).toBe("Library busy");
    await click(button("Delete file"));
    expect(remove).toHaveBeenLastCalledWith("a", "upload", "added-sha", "notes.txt");
    expect(document.querySelectorAll('[aria-label="Session files"] > li')).toHaveLength(1);
    await click(button("Conversation"));
    expect(document.querySelector('[aria-label="Transcript view"] [aria-checked="true"]')?.textContent).toBe("Source");
    expect(document.getElementById("msg-upload")).toBeNull();
    expect(document.getElementById("msg-same")).not.toBeNull();
  });
});

describe("Hidden permanent deletion", () => {
  it("supports single cancellation and a cross-page atomic batch with retry", async () => {
    const all = Array.from({ length: 12 }, (_, i) => ({ ...row(`h${i}`), hidden: true, kind: "local-agent", origin: `/hidden/${i}` }));
    const deleted = new Set<string>();
    useApp.setState({ route: { page: "sessions", filter: "hidden" }, listView: { q: "", filter: "hidden", provider: "all", model: "all", resource: "all", page: 0, selected: [], limit: 10, hideUnanswered: false } });
    vi.spyOn(api, "syncSessions").mockResolvedValue({ added: 0, updated: 0, failed: 0, found: 12, busy: false });
    vi.spyOn(api, "setSetting").mockResolvedValue();
    vi.spyOn(api, "querySessions").mockImplementation(async (query = {}) => {
      const rows = all.filter((r) => !deleted.has(r.id));
      const offset = Math.min(query.offset ?? 0, Math.floor(Math.max(0, rows.length - 1) / 10) * 10);
      return { rows: rows.slice(offset, offset + 10), offset, total: rows.length, providers: [], providerCounts: {}, models: [], folders: [], counts: { hidden: 0, total: 0, pinned: 0, agents: 0, web: 0, webToday: 0, unanswered: 0 } };
    });
    const purge = vi.spyOn(api, "permanentlyDeleteSessions").mockRejectedValueOnce(new Error("Library busy")).mockImplementation(async (ids) => { ids.forEach((id) => deleted.add(id)); });
    await act(async () => root.render(<Sessions />));
    await click(document.querySelector('[aria-label="Permanently delete Session h0"]')!);
    expect(purge).not.toHaveBeenCalled();
    await click(button("Cancel")); await settle();
    await click(document.querySelector('[aria-label="Select Session h0"]')!);
    await click(document.querySelector('[aria-label="Next page"]')!);
    await click(document.querySelector('[aria-label="Select Session h10"]')!);
    await click(button("Permanently delete 2 sessions"));
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("cannot be undone");
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("sync can import these sessions again");
    await click(button("Permanently delete"));
    expect(document.querySelector('[role="alertdialog"] [role="alert"]')?.textContent).toBe("Library busy");
    await click(button("Permanently delete"));
    expect(purge).toHaveBeenLastCalledWith(["h0", "h10"]);
    expect(useApp.getState().listView.selected).toEqual([]);
    expect(document.querySelector('[aria-label="Select Session h0"]')).toBeNull();
  });
});

describe("in-app media and HTML previews", () => {
  for (const kind of ["audio", "video"] as const) it(`provides ${kind} controls and releases its object URL on close`, async () => {
    const { FilePreview } = await import("./FilePreview");
    vi.spyOn(api, "readFilePreview").mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:media-preview");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const file: Attachment = { id: "media", fileName: kind === "audio" ? "sound.wav" : "clip.mp4", sha256: "media-sha", mediaType: `${kind}/test`, size: 3, text: null, originPath: null };
    await act(async () => root.render(<FilePreview file={file} onClose={vi.fn()} />));
    const player = document.querySelector(kind);
    expect(player?.getAttribute("src")).toBe("blob:media-preview");
    expect(player?.hasAttribute("controls")).toBe(true);
    await act(async () => root.render(null));
    expect(revoke).toHaveBeenCalledWith("blob:media-preview");
  });
  it("renders HTML in an opaque sandbox with scripts and outbound links removed", async () => {
    const { FilePreview } = await import("./FilePreview");
    vi.spyOn(api, "readFilePreview").mockResolvedValue(new TextEncoder().encode('<h1>Report</h1><script>bad()</script><a href="https://evil.test">Link</a>').buffer);
    const file: Attachment = { id: "html", fileName: "report.html", sha256: "html-sha", mediaType: "text/html", size: 100, text: null, originPath: null };
    await act(async () => root.render(<FilePreview file={file} onClose={vi.fn()} />));
    const frame = document.querySelector("iframe");
    expect(frame?.getAttribute("sandbox")).toBe("");
    const src = [...(frame?.attributes ?? [])].find((attr) => attr.name.toLowerCase() === "srcdoc")?.value;
    expect(src).toContain("<h1>Report</h1>");
    expect(src).not.toContain("bad()"); expect(src).not.toContain("evil.test");
  });
});

it("shows and hides backup passwords without changing their values", async () => {
  vi.spyOn(api, "backupStatus").mockResolvedValue({ unlocked: false, directory: null, hours: 24, lastResult: null });
  await act(async () => root.render(<BackupSettings />));
  const input = document.querySelector<HTMLInputElement>('[aria-label="Backup password"]')!;
  expect(input.placeholder).toBe("Enter backup password");
  await type(input, "secret test password");
  await click(document.querySelector('[aria-label="Show backup password"]')!);
  expect(input.type).toBe("text");
  expect(input.value).toBe("secret test password");
  expect(document.querySelector('[aria-label="Hide backup password"]')?.getAttribute("aria-pressed")).toBe("true");
  await click(document.querySelector('[aria-label="Hide backup password"]')!);
  expect(input.type).toBe("password");
  expect(input.value).toBe("secret test password");
});

it("never renders previous query data while a new query is loading", async () => {
  const { useLoad } = await import("../lib/hooks");
  let finish: (value: string) => void = () => {};
  const second = new Promise<string>((resolve) => { finish = resolve; });
  const frames: string[] = [];
  function Probe({ id }: { id: string }) {
    const result = useLoad(() => id === "a" ? Promise.resolve("Session A") : second, ["loading-test", id]);
    const content = result.data ?? "Skeleton";
    frames.push(`${id}:${content}`);
    return <div>{content}</div>;
  }
  await act(async () => root.render(<Probe id="a" />));
  expect(document.body.textContent).toContain("Session A");
  await act(async () => root.render(<Probe id="b" />));
  expect(frames).not.toContain("b:Session A");
  expect(document.body.textContent).toContain("Skeleton");
  await act(async () => finish("Session B"));
  expect(document.body.textContent).toContain("Session B");
});

it("keeps video thumbnail skeleton until a local frame is decoded; falls back on codec errors", async () => {
  const { FileThumbnail } = await import("./FilePreview");
  vi.spyOn(api, "readFilePreview").mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
  vi.stubGlobal("URL", { createObjectURL: () => "blob:video-preview", revokeObjectURL: vi.fn() });
  const file: Attachment = { id: "video", sha256: "video", fileName: "demo.mp4", mediaType: "video/mp4", size: 3, originPath: null, text: null };
  await act(async () => root.render(<FileThumbnail file={file} near={false} />));
  expect(document.querySelector('[aria-label="Loading file preview"]')).not.toBeNull();
  expect(api.readFilePreview).not.toHaveBeenCalled();
  await act(async () => root.render(<FileThumbnail file={file} near />));
  const video = document.querySelector("video")!;
  expect(video.getAttribute("src")).toBe("blob:video-preview");
  expect(document.querySelector('[aria-label="Loading file preview"]')).not.toBeNull();
  await act(async () => video.dispatchEvent(new window.Event("loadeddata")));
  expect(document.querySelector('[aria-label="Loading file preview"]')).toBeNull();
  await act(async () => video.dispatchEvent(new window.Event("error")));
  expect(document.body.textContent).toContain("Preview unavailable");
});

it("switches export preview to prompt text when intent changes, then sends the reviewed intent", async () => {
  vi.stubGlobal("localStorage", { getItem: () => '["md","txt"]', setItem: vi.fn() });
  const preview = mockHandoff();
  preview.mockImplementation(async (_ids, format, opts = {}) => ({ text: `${format}: ${opts.intent}`, hash: `${format}-${opts.intent}`, format, tokenEstimate: 4, messageCount: 2 }));
  const exported = vi.spyOn(api, "exportSessionsZip").mockResolvedValue({ path: "/tmp/export.zip", files: 0, missingFiles: 0 });
  vi.spyOn(api, "suggestExportName").mockResolvedValue("export.zip");
  vi.mocked(save).mockResolvedValue("/tmp/export.zip");
  await act(async () => root.render(<HandoffModal ids={["a"]} action="export" onClose={vi.fn()} />));
  const text = finalPreviewText;
  expect(text()).toBe("md: continue");
  await click(button("Review"));
  expect(button("Export 2 formats").disabled).toBe(true);
  await settle();
  expect(preview.mock.calls.at(-1)?.slice(1, 2)).toEqual(["txt"]);
  expect(text()).toBe("txt: review");
  await click(button("Export 2 formats"));
  expect(exported).toHaveBeenCalled();
  expect(exported.mock.calls[0][3]).toMatchObject({ intent: "review", reviewed: { format: "txt", hash: "txt-review" } });
  expect(exported.mock.calls[0][4]).toBe(false);
});

describe("model limit settings", () => {
  const page = (n: number, updatedAt: string | null = "2026-11-09T00:00:00Z") => ({ updatedAt, total: n, matches: n, models: Array.from({ length: Math.min(n, 40) }, (_, i) => ({ providerId: "new-provider", providerName: "New", id: `org/model-${i}`, name: `Model ${i}`, window: 64000 })) });
  it("works offline with built-in models and saves a chosen model", async () => {
    const { ModelLimitSettings } = await import("./ModelLimitSettings");
    useApp.getState().setSettings({ defaultTarget: "codex", destinationBudgets: {} });
    vi.spyOn(api, "searchModelLimits").mockResolvedValue(page(0, null));
    const saved = vi.spyOn(api, "setSetting").mockResolvedValue();
    await act(async () => root.render(<ModelLimitSettings />));
    expect(document.body.textContent).toContain("catalog not downloaded");
    expect(document.body.textContent).toContain("Default model");
    await type(document.querySelector('[aria-label="Find destination model"]')!, "codex");
    await settle();
    await click(document.querySelector('[aria-label="Use openai/gpt-5.3-codex"]')!);
    expect(saved).toHaveBeenCalledWith("destinationBudgets", { codex: { providerId: "openai", modelId: "gpt-5.3-codex", window: 272000 } });
    expect(document.body.textContent).toContain("217,600 used for size suggestions");
  });

  it("refreshes only on click, searches the saved catalog and keeps it on failure", async () => {
    const { ModelLimitSettings } = await import("./ModelLimitSettings");
    useApp.getState().setSettings({ defaultTarget: "other", destinationBudgets: {} });
    const search = vi.spyOn(api, "searchModelLimits").mockResolvedValue(page(0, null));
    const sync = vi.spyOn(api, "syncModelLimits").mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(page(100));
    await act(async () => root.render(<ModelLimitSettings />));
    expect(sync).not.toHaveBeenCalled();
    await click(button("Refresh catalog"));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("saved catalog is unchanged");
    search.mockResolvedValue(page(100));
    await click(button("Refresh catalog"));
    await settle();
    expect(document.body.textContent).toContain("100 models");
    expect(document.querySelectorAll('[aria-label^="Use new-provider/"]').length).toBe(40);
  });

  it("validates manual limits and preserves config on save failure", async () => {
    const { ModelLimitSettings } = await import("./ModelLimitSettings");
    useApp.getState().setSettings({ defaultTarget: "claude", destinationBudgets: { claude: { providerId: "anthropic", modelId: "claude-sonnet-5-5", window: 1_000_000 } } });
    vi.spyOn(api, "searchModelLimits").mockResolvedValue(page(0, null));
    const original = useApp.getState().settings.destinationBudgets;
    const saved = vi.spyOn(api, "setSetting").mockRejectedValue(new Error("disk full"));
    await act(async () => root.render(<ModelLimitSettings />));
    await type(document.querySelector('[aria-label="Manual context limit"]')!, "-1");
    await click(button("Save limit"));
    expect(saved).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Limit must be a whole token count");
    await type(document.querySelector('[aria-label="Manual context limit"]')!, "64000");
    await click(button("Save limit"));
    expect(document.body.textContent).toContain("disk full");
    expect(useApp.getState().settings.destinationBudgets).toEqual(original);
  });
});


describe("Markdown reader controls", () => {
  it("copies exact code while wrap and line numbers only change presentation", async () => {
    const { CodeBlock } = await import("./CodeBlock");
    const code = "first line\n  second line\n";
    vi.mocked(writeText).mockResolvedValue();
    await act(async () => root.render(<CodeBlock code={code} />));
    await click(button("Wrap"));
    await click(button("Lines"));
    expect(document.querySelector("pre")?.className).toContain("code-wrap");
    expect(document.querySelectorAll(".code-line-number").length).toBe(3);
    await click(button("Copy code"));
    expect(writeText).toHaveBeenCalledWith(code);
    expect(button("Copied")).toBeDefined();
  });
  it("reports clipboard errors without discarding code", async () => {
    const { CodeBlock } = await import("./CodeBlock");
    vi.mocked(writeText).mockRejectedValue(new Error("Clipboard unavailable"));
    await act(async () => root.render(<CodeBlock code="keep me" />));
    await click(button("Copy code"));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Clipboard unavailable");
    expect(document.querySelector("pre")?.textContent).toBe("keep me");
  });
  it("preserves exact source through preview/source switching", async () => {
    const { MarkdownViewer } = await import("./MarkdownPreview");
    const text = "# Exact source\n\n- [x] Keep formatting\n";
    await act(async () => root.render(<MarkdownViewer text={text} initialMode="source" sourceLabel="Exact Markdown" />));
    expect(document.querySelector("textarea")?.value).toBe(text);
    await click(document.querySelector('[role="radio"][aria-checked="false"]')!);
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    await click([...document.querySelectorAll('[role="radio"]')].find((el) => el.textContent === "Source")!);
    expect(document.querySelector("textarea")?.value).toBe(text);
  });
  it("keeps original search match IDs when Markdown is enabled", async () => {
    const { Transcript } = await import("./Transcript");
    const messages: Message[] = [{ id: "reader-test", sourceId: "source", role: "assistant", createdAt: null, blocks: [{ type: "text", text: "# heading\n\n**needle**" }] }];
    await act(async () => root.render(<Transcript messages={messages} searchQuery="needle" activeMatchId="reader-test-0-0" activeMessageId="reader-test" />));
    expect(document.getElementById("match-reader-test-0-0")?.textContent).toBe("needle");
    expect(document.body.textContent).toContain("Search shows source");
    expect(document.querySelector("h1")).toBeNull();
  });
});


describe("structured code previews", () => {
  it("previews XML without a fence and preserves its exact source", async () => {
    const { MarkdownPreview } = await import("./MarkdownPreview");
    const { StructuredTextViewer } = await import("./StructuredTextViewer");
    const text = '<context version="1">\n  <goal>Keep &amp; preserve</goal>\n</context>';
    await act(async () => root.render(<MarkdownPreview text={text} />));
    expect(document.querySelector('[aria-label="xml code"]')?.textContent).toBe(text);
    expect(document.querySelector("context")).toBeNull();
    await act(async () => root.render(<StructuredTextViewer text={text} language="xml" sourceLabel="XML source" />));
    expect(document.querySelector('[aria-label="xml code"]')).not.toBeNull();
    await click([...document.querySelectorAll('[role="radio"]')].find((el) => el.textContent === "Source")!);
    expect(document.querySelector<HTMLTextAreaElement>('[aria-label="XML source"]')?.value).toBe(text);
  });
  it("shows tool-call JSON as code and preserves search match IDs", async () => {
    const { Transcript } = await import("./Transcript");
    const text = '{"command":"echo needle"}';
    const messages: Message[] = [{ id: "tool-test", sourceId: "s1", role: "assistant", createdAt: null, blocks: [{ type: "toolCall", name: "Bash", input: text }] }];
    await act(async () => root.render(<Transcript messages={messages} />));
    await click([...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Tool call · Bash"))!);
    expect(document.querySelector('[aria-label="json code"]')?.textContent).toBe(text);
    await act(async () => root.render(<Transcript messages={messages} searchQuery="needle" activeMatchId="tool-test-0-body-0" />));
    expect(document.getElementById("match-tool-test-0-body-0")?.textContent).toBe("needle");
  });
});

describe("agent access settings", () => {
  const counts = (total: number) => ({ hidden: 0, total, pinned: 0, agents: 0, web: 0, webToday: 0, unanswered: 0 });
  const boxes = () => [...document.querySelectorAll<HTMLInputElement>('[aria-label="Sessions"] input[type="checkbox"]')];
  const fieldset = () => document.querySelector("fieldset")!;
  function mockLibrary(all: SessionRow[]) {
    return vi.spyOn(api, "querySessions").mockImplementation(async (q = {}) => {
      let hits = all.filter((r) => !q.q || r.title.toLowerCase().includes(q.q.toLowerCase()));
      if (q.ids) hits = hits.filter((r) => q.ids!.includes(r.id));
      if (q.provider && q.provider !== "all") hits = hits.filter((r) => r.provider === q.provider);
      const offset = q.offset ?? 0;
      return { rows: hits.slice(offset, offset + (q.limit ?? 50)), total: hits.length, offset, providers: ["manual", "codex"], providerCounts: {}, models: ["m1"], folders: [], counts: counts(all.length) };
    });
  }
  it("disables the whole section while off and shows no list in All mode", async () => {
    vi.spyOn(api, "agentCliInfo").mockResolvedValue({ path: "/Apps/Hopilo App/hopilo", installed: true });
    mockLibrary([row("a"), row("b")]);
    const saved = vi.spyOn(api, "setSetting").mockResolvedValue(undefined);
    await act(async () => root.render(<AgentAccessSettings />));
    await settle();
    expect(fieldset().hasAttribute("disabled")).toBe(true);
    expect(fieldset().textContent).toContain("Connect an agent");
    expect(document.body.textContent).toContain("Agent access is off. Agents get nothing.");
    expect(document.querySelector('[aria-label="Choose sessions"]')).toBeNull();
    await click(document.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Allow agent access"]')!);
    expect(saved).toHaveBeenLastCalledWith("agentAccess", { enabled: true, mode: "all", sessions: [] });
    expect(fieldset().hasAttribute("disabled")).toBe(false);
    expect(document.body.textContent).toContain("Every saved session, including ones saved later.");
    expect(document.querySelector('[aria-label="Choose sessions"]')).toBeNull();
    await click(button("Copy"));
    expect(vi.mocked(writeText)).toHaveBeenCalledWith('claude mcp add hopilo -- "/Apps/Hopilo App/hopilo" mcp');
  });
  it("in Selected mode, lists sessions with filters and pages, and saves the chosen ones", async () => {
    vi.spyOn(api, "agentCliInfo").mockResolvedValue({ path: null, installed: false });
    const all = Array.from({ length: 30 }, (_, i) => ({ ...row(`s${i}`), provider: i % 2 ? "codex" : "manual" }));
    const query = mockLibrary(all);
    const saved = vi.spyOn(api, "setSetting").mockResolvedValue(undefined);
    useApp.setState({ settings: { ...DEFAULT_SETTINGS, agentAccess: { enabled: true, mode: "all", sessions: [] } } });
    await act(async () => root.render(<AgentAccessSettings />));
    await settle();
    await click(button("Selected"));
    await settle();
    expect(saved).toHaveBeenLastCalledWith("agentAccess", { enabled: true, mode: "selected", sessions: [] });
    expect(document.body.textContent).toContain("Nothing selected yet, so agents get nothing.");
    expect(document.querySelector('[aria-label="Choose sessions"]')).not.toBeNull();
    for (const label of ["Show sessions", "Filter by tool", "Filter by model", "Filter by resources"]) expect(document.body.innerHTML).toContain(label);
    expect(boxes()).toHaveLength(25);
    expect(boxes().every((b) => !b.checked)).toBe(true);
    await act(async () => { boxes()[0].click(); });
    expect(saved).toHaveBeenLastCalledWith("agentAccess", { enabled: true, mode: "selected", sessions: ["s0"] });
    expect(document.body.textContent).toContain("Only the 1 session you select below.");
    await act(async () => { document.querySelector<HTMLInputElement>('input[aria-label="Select every session on this page"]')!.click(); });
    expect(useApp.getState().settings.agentAccess.sessions).toHaveLength(25);
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Page 2"]')!);
    await settle();
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 25, limit: 25 }));
    expect(boxes()).toHaveLength(5);
    await type(document.querySelector<HTMLInputElement>('input[aria-label="Search sessions"]')!, "s1");
    await settle();
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ q: "s1", offset: 0 }));
    await click(button("Clear selection"));
    expect(saved).toHaveBeenLastCalledWith("agentAccess", { enabled: true, mode: "selected", sessions: [] });
    expect(document.body.textContent).toContain("The hopilo command was not found");
  });
  it("normalizes stored agent access", () => {
    expect(normalizeAgentAccess(null)).toEqual({ enabled: false, mode: "all", sessions: [] });
    expect(normalizeAgentAccess({ enabled: "yes", mode: "odd", sessions: ["abc", "../x", 3, "abc"] })).toEqual({ enabled: false, mode: "all", sessions: ["abc"] });
    expect(normalizeAgentAccess({ enabled: true, mode: "selected", sessions: [] })).toEqual({ enabled: true, mode: "selected", sessions: [] });
  });
});

describe("settings navigation", () => {
  it("maps every section and legacy link to a tab", () => {
    for (const sec of SETTINGS_SECTIONS) expect(settingsGroupFor(sec.id)).toBe(sec.group);
    for (const g of SETTINGS_GROUPS) expect(settingsGroupFor(g.id)).toBe(g.id);
    expect(settingsGroupFor("customize")).toBe("appearance");
    expect(settingsGroupFor("data")).toBe("privacy");
    expect(settingsGroupFor("redaction")).toBe("privacy");
    expect(settingsGroupFor("storage")).toBe("library");
    expect(settingsGroupFor("unknown")).toBe("general");
  });
});
