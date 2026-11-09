import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { api, type Message } from "../lib/api";
import { ExportImportModal } from "./ExportImport";
import { Transcript } from "./Transcript";
import { useApp } from "../lib/store";
import { Sessions } from "../pages/Sessions";
import { Flow } from "./Flow";

const events = vi.hoisted(() => ({ visibility: null as null | ((event: { payload: boolean }) => void) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (_name, callback) => {
  events.visibility = callback;
  return () => { events.visibility = null; };
}) }));

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
  for (const key of ["window", "document", "HTMLElement", "Element", "Node", "Event", "HTMLInputElement", "HTMLTextAreaElement"] as const) {
    vi.stubGlobal(key, window[key]);
  }
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.getElementById("root")!;
  root = createRoot(host);
  useApp.setState({ toasts: [] });
});
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text)!;
const click = async (el: Element) => act(async () => { el.dispatchEvent(new window.Event("click", { bubbles: true })); });
const conversations = Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, title: `Chat ${i}`, messageCount: 2, updatedAt: "2026-11-08T00:00:00Z" }));

describe("chat export UI flow", () => {
  it("pages chats, preserves selections across pages, imports only selected IDs", async () => {
    vi.spyOn(api, "listChatExport").mockResolvedValue({ provider: "chatgpt", conversations });
    const imported = vi.spyOn(api, "importChatExport").mockResolvedValue([{ sourceId: "saved", duplicateOf: null }]);
    const close = vi.fn();
    await act(async () => root.render(<ExportImportModal path="/fixture/conversations.json" onClose={close} />));
    expect(document.querySelectorAll("li")).toHaveLength(25);
    await click(document.querySelector('[aria-label="Import Chat 0"]')!);
    const next = document.querySelector('button[aria-label="Next page"]');
    expect(next).not.toBeNull();
    await click(next!);
    await click(document.querySelector('[aria-label="Import Chat 25"]')!);
    await click(button("Import 2 conversations"));
    expect(imported).toHaveBeenCalledWith("/fixture/conversations.json", ["c0", "c25"]);
    expect(close).toHaveBeenCalledOnce();
    expect(useApp.getState().toasts.some((t) => t.text.includes("Imported 1"))).toBe(true);
  });
  it("shows read failure without enabling import", async () => {
    vi.spyOn(api, "listChatExport").mockRejectedValue(new Error("Invalid export JSON"));
    await act(async () => root.render(<ExportImportModal path="/bad.json" onClose={vi.fn()} />));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Invalid export JSON");
    expect([...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Import "))?.disabled).toBe(true);
  });
  it("keeps failed import selected for retry and reports duplicate imports", async () => {
    vi.spyOn(api, "listChatExport").mockResolvedValue({ provider: "chatgpt", conversations: conversations.slice(0, 1) });
    const imported = vi.spyOn(api, "importChatExport").mockRejectedValueOnce("Library busy").mockResolvedValueOnce([{ sourceId: "saved", duplicateOf: "saved" }]);
    const close = vi.fn();
    await act(async () => root.render(<ExportImportModal path="/fixture.json" onClose={close} />));
    await click(document.querySelector('[aria-label="Import Chat 0"]')!);
    await click(button("Import 1 conversation"));
    expect(close).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Library busy");
    await click(button("Import 1 conversation"));
    expect(imported).toHaveBeenCalledTimes(2);
    expect(useApp.getState().toasts.some((t) => t.text.includes("1 already saved"))).toBe(true);
  });
});

describe("long transcript flow", () => {
  it("automatically appends messages and preserves earlier turns, then reveals deep search hits", async () => {
    const messages: Message[] = Array.from({ length: 125 }, (_, i) => ({ id: `m${i}`, sourceId: "s", role: "user", createdAt: null, blocks: [{ type: "text", text: `Message ${i}` }] }));
    let intersect: (entries: { isIntersecting: boolean }[]) => void = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: typeof intersect) { intersect = callback; }
      observe() {} disconnect = disconnect;
    });
    await act(async () => root.render(<Transcript messages={messages} />));
    expect(document.querySelectorAll("li")).toHaveLength(40);
    await act(async () => intersect([{ isIntersecting: true }]));
    expect(document.querySelectorAll("li")).toHaveLength(80);
    expect(document.getElementById("msg-m0")).not.toBeNull();
    await click(button("Load more messages"));
    expect(document.querySelectorAll("li")).toHaveLength(120);
    await act(async () => root.render(<Transcript messages={messages} activeMessageId="m124" />));
    expect(document.getElementById("msg-m124")).not.toBeNull();
    expect(document.querySelectorAll("li")).toHaveLength(125);
    expect(button("Load more messages")).toBeUndefined();
    expect(disconnect).toHaveBeenCalled();
  });
  it("offers load-more when automatic intersection observation is unavailable", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const messages: Message[] = Array.from({ length: 45 }, (_, i) => ({ id: `m${i}`, sourceId: "s", role: "user", createdAt: null, blocks: [{ type: "text", text: String(i) }] }));
    await act(async () => root.render(<Transcript messages={messages} />));
    await click(button("Load more messages"));
    expect(document.querySelectorAll("li")).toHaveLength(45);
    expect(document.querySelector('[aria-label="Transcript pages"]')).toBeNull();
  });
  it("bounds highlight nodes while preserving a late active match", async () => {
    const messages: Message[] = [{ id: "m", sourceId: "s", role: "user", createdAt: null, blocks: [{ type: "text", text: "x".repeat(100_000) }] }];
    await act(async () => root.render(<Transcript messages={messages} searchQuery="x" activeMatchId="m-0-1500" />));
    expect(document.querySelectorAll("mark").length).toBeLessThanOrEqual(100);
    expect(document.getElementById("match-m-0-1500")).not.toBeNull();
    expect(host.querySelector("ol")?.textContent).toContain("x".repeat(100));
  });
});

describe("GPU lifecycle flow", () => {
  it("pauses native/document-hidden windows, resumes visibility, releases resources", async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { frames.set(++frameId, fn); return frameId; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    let motionChange = () => {};
    const motionQuery = { matches: false, addEventListener: (_name: string, fn: () => void) => { motionChange = fn; }, removeEventListener: vi.fn() };
    window.matchMedia = vi.fn((query: string) => query.includes("reduced-motion") ? motionQuery : { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const methods = new Map<PropertyKey, ReturnType<typeof vi.fn>>();
    const gl = new Proxy({}, { get: (_target, key) => {
      if (!methods.has(key)) methods.set(key, vi.fn(() => key === "getShaderParameter" || key === "getProgramParameter" ? true : key === "isContextLost" ? false : key === "getExtension" ? null : {}));
      return methods.get(key);
    } });
    Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => gl });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    useApp.setState({ settings: { ...useApp.getState().settings, motion: "system" } });
    await act(async () => root.render(<Flow mode="mist" />));
    const draw = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn(1000)); };
    draw();
    expect(methods.get("drawArrays")).toHaveBeenCalledOnce();
    expect(frames.size).toBe(1);
    events.visibility?.({ payload: false });
    expect(frames.size).toBe(0);
    events.visibility?.({ payload: true });
    expect(frames.size).toBe(1);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new window.Event("visibilitychange"));
    expect(frames.size).toBe(0);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    motionQuery.matches = true;
    motionChange();
    draw();
    expect(frames.size).toBe(0);
    expect(methods.get("drawArrays")).toHaveBeenCalledTimes(2);
    await act(async () => root.render(null));
    expect(methods.get("deleteShader")).toHaveBeenCalledTimes(2);
    expect(methods.get("deleteProgram")).toHaveBeenCalledOnce();
    expect(events.visibility).toBeNull();
  });
});


describe("library selection flow", () => {
  it("retains cross-page selections while paging controls remain available", async () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({ id: `s${i}`, kind: "manual", provider: "manual", title: `Session ${i}`, origin: null, project: null, model: null,
      updatedAt: "2026-11-08T00:00:00Z", captureStatus: "complete" as const, messageCount: 2, replyCount: 1, tokenEstimate: 10,
      missingCount: 0, fileCount: 0, pinned: false, tags: [], lastCopiedAt: null }));
    useApp.setState({ route: { page: "sessions" }, listView: { q: "", filter: "all", provider: "all", model: "all", resource: "all", page: 0, selected: [], limit: 10, hideUnanswered: false } });
    vi.spyOn(api, "syncSessions").mockResolvedValue({ added: 0, updated: 0, failed: 0, found: 0, busy: false });
    vi.spyOn(api, "setSetting").mockResolvedValue();
    vi.spyOn(api, "querySessions").mockImplementation(async (query = {}) => ({ rows: rows.slice(query.offset ?? 0, (query.offset ?? 0) + 10), total: 21, offset: query.offset ?? 0,
      providers: ["manual"], providerCounts: { manual: 21 }, models: ["__unknown"], folders: [], counts: { hidden: 0, total: 21, pinned: 0, agents: 0, web: 0, webToday: 0, unanswered: 0 } }));
    await act(async () => root.render(<Sessions />));
    await click(document.querySelector('[aria-label="Select Session 0"]')!);
    await click(document.querySelector('[aria-label="Next page"]')!);
    await click(document.querySelector('[aria-label="Select Session 10"]')!);
    expect(useApp.getState().listView.selected).toEqual(["s0", "s10"]);
    expect(button("Copy combined")).toBeDefined();
  });
});

it("preserves cached startup appearance until saved settings load", async () => {
  const { useBootstrap } = await import("../lib/hooks");
  const { DEFAULT_SETTINGS } = await import("../lib/store");
  useApp.setState({ settings: { ...DEFAULT_SETTINGS, theme: "light" } });
  document.documentElement.dataset.theme = "dark";
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  let resolveSettings: (value: Record<string, unknown>) => void = () => {};
  vi.spyOn(api, "getSettings").mockReturnValue(new Promise((resolve) => { resolveSettings = resolve; }));
  function BootstrapProbe() { return <div>{useBootstrap() ? "Ready" : "Loading"}</div>; }
  await act(async () => root.render(<BootstrapProbe />));
  expect(host.textContent).toBe("Loading");
  expect(document.documentElement.dataset.theme).toBe("dark");
  await act(async () => resolveSettings({ theme: "light" }));
  expect(host.textContent).toBe("Ready");
  expect(document.documentElement.dataset.theme).toBe("light");
});
