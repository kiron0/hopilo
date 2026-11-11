import { describe, expect, it } from "vitest";
import { splitForHighlight } from "./CodeBlock";
import { MAX_HIGHLIGHT_CODE, MAX_RICH_MARKDOWN, splitMarkdown } from "../lib/markdown";

describe("splitForHighlight", () => {
  it("keeps small code in one chunk", () => {
    expect(splitForHighlight('{\n  "a": 1\n}')).toEqual(['{\n  "a": 1\n}']);
  });

  it("splits large exports into chunks the highlighter accepts, without losing text", () => {
    const code = Array.from({ length: 5000 }, (_, i) => `  "line${i}": "${"x".repeat(60)}",`).join("\n");
    const chunks = splitForHighlight(code);
    expect(chunks.length).toBeGreaterThan(10);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_HIGHLIGHT_CODE);
      expect(chunk.split("\n").length).toBeLessThanOrEqual(1000);
    }
    expect(chunks.join("\n")).toBe(code);
  });
});

describe("splitMarkdown", () => {
  const message = (i: number) => `### Assistant ${i}\n\nSome reply text ${"word ".repeat(80)}\n\n\`\`\`ts\nconst a${i} = 1;\n\nconst b${i} = 2;\n\`\`\`\n`;

  it("leaves small documents whole", () => {
    expect(splitMarkdown("# Title\n\nbody")).toEqual(["# Title\n\nbody"]);
  });

  it("splits big sessions at blank lines outside code fences, without losing text", () => {
    const text = Array.from({ length: 600 }, (_, i) => message(i)).join("\n");
    const chunks = splitMarkdown(text, 20_000);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.join("\n")).toBe(text);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThan(MAX_RICH_MARKDOWN);
      expect((chunk.match(/^```/gm) ?? []).length % 2).toBe(0);
    }
  });

  it("never splits inside lists, indented continuations or quotes", () => {
    const item = (i: number) => `### Assistant ${i}\n\n1. first ${"x ".repeat(200)}\n\n    continued paragraph ${i}\n\n2. second\n\n> quote ${i}\n>\n> more\n\n- bullet\n\n  - nested\n`;
    const text = Array.from({ length: 400 }, (_, i) => item(i)).join("\n");
    const chunks = splitMarkdown(text, 5_000);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.join("\n")).toBe(text);
    for (const chunk of chunks.slice(1)) expect(chunk.startsWith("### Assistant")).toBe(true);
  });

  it("keeps a long fenced block in one piece", () => {
    const fence = "```\n" + Array.from({ length: 3000 }, (_, i) => `line ${i}`).join("\n\n") + "\n```";
    const chunks = splitMarkdown(`intro\n\n${fence}\n\nafter`, 1_000);
    expect(chunks.some((c) => c.includes("line 0") && c.includes("line 2999"))).toBe(true);
  });
});
