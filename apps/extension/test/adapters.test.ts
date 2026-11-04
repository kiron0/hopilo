import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { chatgpt } from "../src/adapters/chatgpt";
import { claude } from "../src/adapters/claude";
import { capture, insertDraft, toMarkdown } from "../src/adapters/common";
import { gemini } from "../src/adapters/gemini";
import { adapterFor } from "../src/adapters";

const load = (name: string) => parseHTML(readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), "utf8")).document as unknown as Document;

describe("web adapters", () => {
  it("picks the adapter by host", () => {
    expect(adapterFor("chatgpt.com")?.id).toBe("chatgpt");
    expect(adapterFor("claude.ai")?.id).toBe("claude");
    expect(adapterFor("gemini.google.com")?.id).toBe("gemini");
    expect(adapterFor("example.com")).toBeNull();
  });

  it("ChatGPT: roles, code fences, links, title", async () => {
    const doc = load("chatgpt");
    const p = await capture(chatgpt, doc, { includeOlder: false });
    expect(p.title).toBe("Postgres index advice");
    expect(p.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(p.messages[0].text).toBe("Which index for `WHERE user_id = $1`?");
    const a = p.messages[1].text;
    expect(a).toContain("Use a **composite** index:");
    expect(a).toContain("```sql\nCREATE INDEX ON orders (user_id, created_at);\n```");
    expect(a).not.toContain("Copy code");
    expect(a).toContain("[docs](https://www.postgresql.org/docs/)");
    expect(p.status).toBe("complete");
    expect(p.adapterVersion).toBe("chatgpt-web@1");
  });

  it("ChatGPT modern: data-message-role, user bubble, assistant markdown", async () => {
    const doc = load("chatgpt_modern");
    const p = await capture(chatgpt, doc, { includeOlder: false });
    expect(p.title).toBe("Quantum computing explained");
    expect(p.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(p.messages[0].text).toBe("Explain quantum computing in one sentence.");
    expect(p.messages[1].text).toContain("Quantum computing uses principles of quantum mechanics");
    expect(chatgpt.composer(doc)?.tagName).toBe("TEXTAREA");
  });

  it("Claude: nested reply containers counted once", async () => {
    const p = await capture(claude, load("claude"), { includeOlder: false });
    expect(p.title).toBe("Release checklist");
    expect(p.messages).toHaveLength(2);
    expect(p.messages[1].text).toBe("1. Bump version\n2. Tag release");
  });

  it("Gemini: title from sidebar, tables kept", async () => {
    const p = await capture(gemini, load("gemini"), { includeOlder: false });
    expect(p.title).toBe("CI build failure");
    expect(p.messages[0]).toEqual({ role: "user", text: "Why does the build fail on CI?" });
    expect(p.messages[1].text).toContain("| Step | Command |");
    expect(p.messages[1].text).toContain("| 1 | pnpm install |");
  });

  it("finds each composer", () => {
    expect(chatgpt.composer(load("chatgpt"))?.id).toBe("prompt-textarea");
    expect(claude.composer(load("claude"))?.className).toContain("ProseMirror");
    expect(gemini.composer(load("gemini"))?.className).toContain("ql-editor");
  });

  it("inserts into a textarea without submitting", () => {
    const { document } = parseHTML("<form><textarea>hi</textarea></form>");
    let submitted = false;
    document.querySelector("form")!.addEventListener("submit", () => (submitted = true));
    const ta = document.querySelector("textarea") as unknown as HTMLElement;
    expect(insertDraft(ta, "Context pack text")).toBe(true);
    expect((ta as unknown as HTMLTextAreaElement).value).toBe("hi\n\nContext pack text");
    expect(submitted).toBe(false);
  });

  it("markdown keeps nested list indentation", () => {
    const { document } = parseHTML("<div><ul><li>a<ul><li>b</li></ul></li></ul></div>");
    expect(toMarkdown(document.querySelector("div") as unknown as Element)).toBe("- a\n  - b");
  });
});

describe("experimental adapters", () => {
  it("Grok: roles from bubble alignment", async () => {
    const { grok } = await import("../src/adapters/experimental");
    const p = await capture(grok, load("grok"), { includeOlder: false });
    expect(p.title).toBe("Rust lifetimes");
    expect(p.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(p.messages[0].text).toBe("Explain `'a` here");
    expect(p.adapterVersion).toBe("grok-web@0-experimental");
  });

  it("known hosts route to experimental adapters", () => {
    expect(adapterFor("chat.deepseek.com")?.id).toBe("deepseek");
    expect(adapterFor("www.perplexity.ai")?.id).toBe("perplexity");
  });

  it("DeepSeek: turns from ds-markdown list container", async () => {
    const { deepseek } = await import("../src/adapters/experimental");
    const doc = load("deepseek");
    const p = await capture(deepseek, doc, { includeOlder: false });
    expect(p.title).toBe("Explain Rust ownership");
    expect(p.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(p.messages[0].text).toBe("What is ownership in Rust?");
    expect(p.messages[1].text).toContain("Each value has an owner.");
    expect(p.status).toBe("complete");
    expect(p.adapterVersion).toBe("deepseek-web@0-experimental");
  });
});
