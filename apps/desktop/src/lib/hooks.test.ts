import { beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateQuery, patchCachedSession, prefetch, readCached } from "./hooks";
import type { SessionRow, Stats } from "./api";
import { useApp } from "./store";

const mockSession = (id: string, pinned = false): SessionRow => ({
  id,
  kind: "local-agent",
  provider: "claude-code",
  title: `Session ${id}`,
  origin: null,
  project: "/test",
  model: "claude",
  updatedAt: "2026-11-07T00:00:00Z",
  captureStatus: "complete",
  messageCount: 5,
  tokenEstimate: 500,
  missingCount: 0,
  fileCount: 0,
  pinned,
  tags: [],
  lastCopiedAt: null,
  hidden: false,
  replyCount: 2,
});

const listLoader = () => Promise.resolve([mockSession("s1"), mockSession("s2")]);
const detailLoader = () => Promise.resolve({ row: mockSession("s2"), messages: [] });
const statsLoader = () => Promise.resolve({ pinnedCount: 0 } as Stats);
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(invalidateQuery);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("cache request races", () => {
  it("ignores a response started before explicit invalidation", async () => {
    const old = deferred<string>();
    const fresh = deferred<string>();
    const loader = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    prefetch(loader);
    await flush();
    invalidateQuery();
    prefetch(loader);
    await flush();
    fresh.resolve("fresh");
    await flush();
    old.resolve("old");
    await flush();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(readCached(loader)).toBe("fresh");
  });

  it("does not repopulate an empty cache from an old library generation", async () => {
    const old = deferred<string>();
    const loader = () => old.promise;
    prefetch(loader);
    await flush();
    useApp.getState().bump();
    old.resolve("deleted session");
    await flush();
    expect(readCached(loader)).toBeUndefined();
  });

  it("deduplicates requests but refreshes cached prefetch after library changes", async () => {
    const loader = vi.fn().mockResolvedValueOnce("old").mockResolvedValueOnce("fresh");
    prefetch(loader);
    prefetch(loader);
    await flush();
    expect(loader).toHaveBeenCalledTimes(1);
    useApp.getState().bump();
    prefetch(loader);
    prefetch(loader);
    await flush();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(readCached(loader)).toBe("fresh");
  });
});

describe("cache patching", () => {
  it("patches lists, details and pinned count once per real change", async () => {
    invalidateQuery();
    prefetch(listLoader);
    prefetch(detailLoader);
    prefetch(statsLoader);
    await flush();

    patchCachedSession("s2", { pinned: true });
    patchCachedSession("s2", { pinned: true });
    patchCachedSession("s2", { title: "Updated S2" });

    const list = readCached(listLoader)!;
    expect(list.map((r) => r.id)).toEqual(["s1", "s2"]);
    expect(list[1]).toMatchObject({ pinned: true, title: "Updated S2" });
    expect(readCached(detailLoader)!.row).toMatchObject({ pinned: true, title: "Updated S2" });
    expect(readCached(statsLoader)!.pinnedCount).toBe(1);

    patchCachedSession("s2", { pinned: false });
    expect(readCached(statsLoader)!.pinnedCount).toBe(0);

    patchCachedSession("missing", { pinned: true });
    expect(readCached(statsLoader)!.pinnedCount).toBe(0);
    invalidateQuery();
    expect(readCached(listLoader)).toBeUndefined();
  });
});
