import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act, lazy, StrictMode, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { STARTUP_TIMEOUT_MS, StartupPageReady, StartupProvider } from "./startup";
import { invalidateQuery, prefetch, useLoad } from "./hooks";
import { useApp } from "./store";

let root: Root;
let frames: Map<number, FrameRequestCallback>;
let nextFrame = 0;
beforeEach(() => {
  const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
  Object.assign(globalThis, { window, document: window.document });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = new Map();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { frames.set(++nextFrame, fn); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  invalidateQuery();
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const paint = async () => act(async () => { const current = [...frames.values()]; frames.clear(); current.forEach((fn) => fn(0)); });
const paintReady = async () => { await paint(); await paint(); };
function QueryPage({ loader, id = "initial-session" }: { loader: () => Promise<string>; id?: string }) {
  const { data, loading, error } = useLoad(loader, [id]);
  return <div>{loading ? "Loading session" : error ? "Load failed" : data}</div>;
}

describe("readiness-driven startup", () => {
  it("dismisses after a timeout when a startup load never settles", async () => {
    vi.useFakeTimers();
    try {
      const ready = vi.fn();
      await act(async () => root.render(<StartupProvider ready onReady={ready}><QueryPage loader={() => new Promise(() => {})} /><StartupPageReady /></StartupProvider>));
      await paintReady(); expect(ready).not.toHaveBeenCalled();
      await act(async () => { vi.advanceTimersByTime(STARTUP_TIMEOUT_MS); });
      expect(ready).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it("waits for settings and actual session data, then finishes without a minimum delay", async () => {
    let resolve!: (value: string) => void;
    const promise = new Promise<string>((done) => { resolve = done; });
    const loader = () => promise;
    const ready = vi.fn();
    const view = (settingsReady: boolean) => <StartupProvider ready={settingsReady} onReady={ready}><QueryPage loader={loader} /><StartupPageReady /></StartupProvider>;
    await act(async () => root.render(view(false)));
    await paintReady(); expect(ready).not.toHaveBeenCalled();
    await act(async () => root.render(view(true)));
    await paintReady(); expect(ready).not.toHaveBeenCalled();
    await act(async () => resolve("Loaded session"));
    await paintReady(); expect(ready).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain("Loaded session");
    await act(async () => root.render(<StartupProvider ready onReady={ready}><QueryPage id="later" loader={() => new Promise(() => {})} /><StartupPageReady /></StartupProvider>));
    await paintReady(); expect(ready).toHaveBeenCalledOnce();
  });
  it("waits for lazy route mount under StrictMode", async () => {
    let mount!: (value: { default: () => React.JSX.Element }) => void;
    const Page = lazy(() => new Promise<{ default: () => React.JSX.Element }>((resolve) => { mount = resolve; }));
    const ready = vi.fn();
    await act(async () => root.render(<StrictMode><StartupProvider ready onReady={ready}><Suspense fallback={<div>Loading route</div>}><Page /><StartupPageReady /></Suspense></StartupProvider></StrictMode>));
    await paintReady(); expect(ready).not.toHaveBeenCalled();
    await act(async () => mount({ default: () => <div>Route mounted</div> }));
    await paintReady(); expect(ready).toHaveBeenCalledOnce();
  });
  it("dismisses on load failure so the error state remains accessible", async () => {
    let fail!: (e: Error) => void;
    const promise = new Promise<string>((_, reject) => { fail = reject; });
    const ready = vi.fn();
    await act(async () => root.render(<StartupProvider ready onReady={ready}><QueryPage loader={() => promise} /><StartupPageReady /></StartupProvider>));
    await act(async () => fail(new Error("Read failed")));
    await paintReady(); expect(ready).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain("Load failed");
  });
  it("releases abandoned requests when their page unmounts", async () => {
    const ready = vi.fn();
    await act(async () => root.render(<StartupProvider ready onReady={ready}><QueryPage loader={() => new Promise(() => {})} /><StartupPageReady /></StartupProvider>));
    await act(async () => root.render(<StartupProvider ready onReady={ready}><div>New page</div><StartupPageReady /></StartupProvider>));
    await paintReady(); expect(ready).toHaveBeenCalledOnce();
  });
});

describe("useLoad cache freshness", () => {
  it("reuses a fresh prefetch on mount and refetches after the library changes", async () => {
    const loader = vi.fn(() => Promise.resolve("Prefetched session"));
    prefetch(loader, ["fresh"]);
    await act(async () => { await Promise.resolve(); });
    await act(async () => root.render(<StartupProvider ready onReady={() => undefined}><QueryPage id="fresh" loader={loader} /></StartupProvider>));
    expect(document.body.textContent).toContain("Prefetched session");
    expect(loader).toHaveBeenCalledOnce();
    await act(async () => useApp.getState().bump());
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
