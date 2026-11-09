import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QuickPanel } from "./QuickPanel";

const state = vi.hoisted(() => ({ ready: false }));
vi.mock("../lib/hooks", () => ({ useBootstrap: () => state.ready, useDebouncedValue: (value: string) => value, useLoad: () => ({ data: { rows: [] }, loading: false, reload: vi.fn() }) }));
vi.mock("../components/Flow", () => ({ BackgroundLayer: () => null }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onFocusChanged: async () => () => {}, hide: vi.fn() }) }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("keeps the panel shell mounted during bootstrap, then tracks its actual outline size", async () => {
  const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
  for (const key of ["window", "document", "HTMLElement", "Element", "Node", "Event"] as const) vi.stubGlobal(key, window[key]);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let resize = () => {};
  const observe = vi.fn(); const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe = observe; disconnect = disconnect; });
  let width = 448;
  Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { configurable: true, get: () => width });
  Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 610 });
  const host = document.getElementById("root")!; const root = createRoot(host);
  try {
    state.ready = false;
    await act(async () => root.render(<QuickPanel />));
    expect(observe).toHaveBeenCalledOnce();
    expect(host.querySelector(".quick-shell")).not.toBeNull();
    state.ready = true;
    await act(async () => root.render(<QuickPanel />));
    expect(observe).toHaveBeenCalledTimes(2);
    width = 500;
    await act(async () => resize());
    const outline = host.querySelector("svg path")!.getAttribute("d");
    expect(outline).toContain("500");
    expect(host.querySelector("svg[style*='drop-shadow']")).toBeNull();
  } finally { await act(async () => root.unmount()); }
  expect(disconnect).toHaveBeenCalledTimes(2);
});
