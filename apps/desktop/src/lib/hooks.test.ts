import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CACHED_TRANSCRIPTS, cancelPrefetchSoon, invalidateQuery, patchCachedSession, prefetch, prefetchSoon, readCached } from "./hooks";
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
  it("isolates identical loader closures using explicit session keys", async () => {
    const loader = (id: string) => () => Promise.resolve(id);
    const a = loader("a"); const b = loader("b");
    prefetch(a, ["session", "a"]); prefetch(b, ["session", "b"]);
    await flush();
    expect(readCached(a, ["session", "a"])).toBe("a");
    expect(readCached(b, ["session", "b"])).toBe("b");
  });
  it("ignores a response started before explicit invalidation", async () => {
    const old = deferred<string>();
    const fresh = deferred<string>();
    const loader = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    prefetch(loader, ["test"]);
    await flush();
    invalidateQuery();
    prefetch(loader, ["test"]);
    await flush();
    fresh.resolve("fresh");
    await flush();
    old.resolve("old");
    await flush();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(readCached(loader, ["test"])).toBe("fresh");
  });

  it("does not repopulate an empty cache from an old library generation", async () => {
    const old = deferred<string>();
    const loader = () => old.promise;
    prefetch(loader, ["test"]);
    await flush();
    useApp.getState().bump();
    old.resolve("deleted session");
    await flush();
    expect(readCached(loader, ["test"])).toBeUndefined();
  });

  it("deduplicates requests but refreshes cached prefetch after library changes", async () => {
    const loader = vi.fn().mockResolvedValueOnce("old").mockResolvedValueOnce("fresh");
    prefetch(loader, ["test"]);
    prefetch(loader, ["test"]);
    await flush();
    expect(loader).toHaveBeenCalledTimes(1);
    useApp.getState().bump();
    prefetch(loader, ["test"]);
    prefetch(loader, ["test"]);
    await flush();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(readCached(loader, ["test"])).toBe("fresh");
  });
});

describe("cache patching", () => {
  it("patches lists, details and pinned count once per real change", async () => {
    invalidateQuery();
    prefetch(listLoader, ["sessions"]);
    prefetch(detailLoader, ["detail"]);
    prefetch(statsLoader, ["stats"]);
    await flush();

    patchCachedSession("s2", { pinned: true });
    patchCachedSession("s2", { pinned: true });
    patchCachedSession("s2", { title: "Updated S2" });

    const list = readCached(listLoader, ["sessions"])!;
    expect(list.map((r) => r.id)).toEqual(["s1", "s2"]);
    expect(list[1]).toMatchObject({ pinned: true, title: "Updated S2" });
    expect(readCached(detailLoader, ["detail"])!.row).toMatchObject({ pinned: true, title: "Updated S2" });
    expect(readCached(statsLoader, ["stats"])!.pinnedCount).toBe(1);

    patchCachedSession("s2", { pinned: false });
    expect(readCached(statsLoader, ["stats"])!.pinnedCount).toBe(0);

    patchCachedSession("missing", { pinned: true });
    expect(readCached(statsLoader, ["stats"])!.pinnedCount).toBe(0);
    invalidateQuery();
    expect(readCached(listLoader, ["sessions"])).toBeUndefined();
  });
});

describe("transcript cache bounds", () => {
  it("keeps only the most recent transcripts while leaving other queries", async () => {
    prefetch(listLoader, ["sessions"]);
    for (let i = 0; i < MAX_CACHED_TRANSCRIPTS + 3; i++) prefetch(() => Promise.resolve(`t${i}`), ["session", `id${i}`]);
    await flush();
    const kept = Array.from({ length: MAX_CACHED_TRANSCRIPTS + 3 }, (_, i) => readCached(() => Promise.resolve(""), ["session", `id${i}`]));
    expect(kept.filter((v) => v !== undefined)).toHaveLength(MAX_CACHED_TRANSCRIPTS);
    expect(kept.at(-1)).toBe(`t${MAX_CACHED_TRANSCRIPTS + 2}`);
    expect(kept[0]).toBeUndefined();
    expect(readCached(listLoader, ["sessions"])).toBeDefined();
  });

  it("only prefetches the row the pointer settles on", async () => {
    vi.useFakeTimers();
    try {
      const a = vi.fn(() => Promise.resolve("a"));
      const b = vi.fn(() => Promise.resolve("b"));
      const c = vi.fn(() => Promise.resolve("c"));
      prefetchSoon(a, ["session", "a"]);
      prefetchSoon(b, ["session", "b"]);
      await vi.advanceTimersByTimeAsync(200);
      prefetchSoon(c, ["session", "c"]);
      cancelPrefetchSoon();
      await vi.advanceTimersByTimeAsync(200);
      expect(a).not.toHaveBeenCalled();
      expect(b).toHaveBeenCalledTimes(1);
      expect(c).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
