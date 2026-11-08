import { afterEach, describe, expect, it, vi } from "vitest";
import { readCapped } from "../src/readCapped";
import { readFiles } from "../src/adapters/files";

afterEach(() => vi.unstubAllGlobals());

describe("file capture limits", () => {
  it("cancels a chunked response that exceeds the byte limit", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
      },
      cancel,
    });
    expect(await readCapped(new Response(stream), 5)).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });

  it("accepts exactly the limit across chunks", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4, 5]));
        controller.close();
      },
    });
    expect(await readCapped(new Response(stream), 5)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(stream.locked).toBe(false);
  });

  it("uses decoded byte sizes so base64 padding does not discard an in-budget file", async () => {
    vi.stubGlobal("location", { href: "https://claude.ai/chat/1", origin: "https://claude.ai" });
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("x")));
    vi.stubGlobal("fetch", fetchMock);
    const budget = { left: 1 };
    const files = await readFiles([{ name: "x.txt", url: "https://claude.ai/files/1" }], budget);
    expect(files[0].data).toBe("eA==");
    expect(budget.left).toBe(0);
  });

  it("keeps malformed URLs as missing files without aborting capture", async () => {
    vi.stubGlobal("location", { href: "https://claude.ai/chat/1", origin: "https://claude.ai" });
    const files = await readFiles([{ name: "bad.txt", url: "https://[" }], { left: 100 });
    expect(files).toEqual([{ name: "bad.txt", mediaType: "" }]);
  });
});
