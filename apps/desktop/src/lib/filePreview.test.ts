import { describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { api, type Attachment } from "./api";
import { codeLanguage, fileKind, loadFilePreview, safeHtmlPreview } from "./filePreview";
const file: Attachment = { id: "a", fileName: "test.bin", sha256: "sha", size: 10, mediaType: "application/octet-stream", text: null, originPath: null };
it("recognizes PDF/HTML/audio/video even when old metadata says binary", () => {
  for (const [name, kind] of [["test.pdf", "pdf"], ["test.HTML", "html"], ["song.mp3", "audio"], ["clip.mov", "video"], ["code.ts", "text"]]) expect(fileKind({ ...file, fileName: name })).toBe(kind);
});
it("strips HTML capabilities, network references and embedded browsing contexts", () => {
  const { document } = parseHTML("<html></html>"); vi.stubGlobal("document", document);
  const safe = safeHtmlPreview('<script>alert(1)</script><meta http-equiv="refresh" content="0;url=https://evil.test"><base href="https://evil.test"><iframe src="https://evil.test"></iframe><form action="ipc:">secret</form><a href="https://evil.test" onclick="bad()">Link</a><img src="https://evil.test/track" onerror="bad()"><h1>Hello</h1><svg onload="bad()"></svg>');
  expect(safe).toContain("<h1>Hello</h1>");
  for (const value of ["evil.test", "onclick", "onerror", "<script", "<iframe", "<form", "<svg", "http-equiv=\"refresh\""]) expect(safe).not.toContain(value);
  expect(safe).toContain("default-src 'none'"); expect(safe).toContain("form-action 'none'");
  vi.unstubAllGlobals();
});
describe("code file language", () => {
  it("maps source files to a highlight language and leaves plain text alone", () => {
    const cases: [string, string | undefined][] = [["src/App.TSX", "tsx"], ["main.rs", "rs"], ["build/Dockerfile", "dockerfile"], ["Makefile", "makefile"], ["notes.txt", undefined], ["README", undefined]];
    for (const [name, language] of cases) expect(codeLanguage(name)).toBe(language);
    expect(fileKind({ id: "1", fileName: "Main.kt", mediaType: "application/octet-stream", sha256: "x", size: 1, originPath: null, text: null })).toBe("text");
  });
});

describe("bounded preview loading", () => {
  it("clips text/binary prefixes and aborts without another IPC request", async () => {
    const read = vi.spyOn(api, "readFilePreview").mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer);
    const abort = new AbortController();
    expect((await loadFilePreview(file, abort.signal, 4, true)).size).toBe(4);
    abort.abort();
    await expect(loadFilePreview(file, abort.signal)).rejects.toThrow();
    expect(read).toHaveBeenCalledTimes(1); read.mockRestore();
  });
  it("rejects oversized responses", async () => {
    const read = vi.spyOn(api, "readFilePreview").mockResolvedValue(new Uint8Array(9).buffer);
    await expect(loadFilePreview(file, new AbortController().signal, 8)).rejects.toThrow("Preview exceeds"); read.mockRestore();
  });
});
