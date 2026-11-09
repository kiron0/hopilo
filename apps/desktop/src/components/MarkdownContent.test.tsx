import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MarkdownContent, { MarkdownTree } from "./MarkdownContent";
import { markdownImage, markdownLink, MAX_RICH_MARKDOWN } from "../lib/markdown";
import { api, type MdNode } from "../lib/api";
import { highlightCode } from "../lib/codeHighlight";

const t = (v: string): MdNode => ({ t: "text", v });
const el = (tag: string, c: MdNode[], extra: Record<string, unknown> = {}): MdNode => ({ t: "el", tag, c, ...extra });
const tree = (nodes: MdNode[], prefix = "md-a") => renderToStaticMarkup(<MarkdownTree nodes={nodes} prefix={prefix} onOpen={() => {}} />);

describe("Markdown tree renderer", () => {
  it("renders tables, tasks, lists, strikeout and footnotes from the Rust tree", () => {
    const html = tree([
      el("h1", [t("Title")], { id: "title" }),
      el("table", [el("thead", [el("tr", [el("th", [t("Name")]), el("th", [t("Value")], { align: "right" })])]), el("tbody", [el("tr", [el("td", [t("Test")]), el("td", [t("42")], { align: "right" })])])]),
      el("ul", [el("li", [t("Done")], { checked: true, class: "task-list-item" }), el("li", [t("Pending")], { checked: false, class: "task-list-item" })], { class: "contains-task-list" }),
      el("p", [el("del", [t("removed")]), t(" "), el("strong", [t("strong")]), t(" "), { t: "icode", v: "inline" }, t(" "), { t: "link", href: "https://example.com", c: [t("https://example.com")] }]),
      el("section", [el("ol", [el("li", [el("p", [t("Footnote text")])], { id: "fn-one" })])], { class: "footnotes" }),
    ]);
    for (const expected of ['<h1 id="md-a-title" tabindex="-1">', '<div class="markdown-table-scroll"', 'text-align:right', 'type="checkbox"', 'checked=""', '<del>removed</del>', '<strong>strong</strong>', '<code>inline</code>', 'href="https://example.com"', 'id="md-a-fn-one"', 'Footnote text']) expect(html).toContain(expected);
  });
  it("renders inline and display math with accessible MathML", () => {
    const html = tree([el("p", [{ t: "math", display: false, v: "x^2" }]), { t: "math", display: true, v: "\\frac{a}{b}" }]);
    expect(html).toContain('class="katex"'); expect(html).toContain("katex-display"); expect(html).toContain("<math"); expect(html).toContain("<mfrac>");
  });
  it("keeps unsafe URLs inert and never auto-loads remote images", () => {
    const html = tree([el("p", [{ t: "link", href: "javascript:alert%281%29", c: [t("bad")] }, { t: "img", src: "https://example.com/pixel.png", alt: "tracking" }])]);
    expect(html).not.toContain('href="javascript:'); expect(html).not.toContain("<img");
    expect(html).toContain("not loaded automatically"); expect(html).toContain("Open image: tracking");
    for (const unsafe of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "//example.com", "https://user:pass@example.com"]) expect(markdownLink(unsafe)).toBeUndefined();
    expect(markdownImage("data:image/svg+xml;base64,PHN2Zz4=")).toBeUndefined(); expect(markdownImage("data:image/png;base64,aGVsbG8=")).toBeDefined();
    expect(tree([el("script", [t("alert(1)")])])).not.toContain("<script");
  });
  it("scopes ids and in-page links to each message", () => {
    const nodes = [el("h1", [t("Same")], { id: "same" }), el("p", [{ t: "link", href: "#same", c: [t("Jump")] }, el("sup", [{ t: "link", href: "#fn-n", id: "fnref-n-1", c: [t("1")] }])]), el("section", [el("ol", [el("li", [t("Note")], { id: "fn-n" })])], { class: "footnotes" })];
    const html = tree(nodes, "md-a") + tree(nodes, "md-b");
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const target of [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])) expect(ids).toContain(target);
  });
  it("preserves fenced and markup code content with copy/wrap/line controls", () => {
    const html = tree([{ t: "code", lang: "typescript", v: 'const x = "<script>";' }, { t: "code", lang: "xml", v: '<context version="1">' }]);
    expect(html).toContain("typescript code"); expect(html).toContain("Copy code"); expect(html).toContain("Wrap"); expect(html).toContain("Lines");
    expect(html).toContain("const x = &quot;&lt;script&gt;&quot;;"); expect(html).toContain('aria-label="xml code"'); expect(html).not.toContain("<context");
  });
});

describe("Markdown content", () => {
  it("shows very large Markdown as source without calling Rust", () => {
    const parse = vi.spyOn(api, "parseMarkdown");
    const html = renderToStaticMarkup(<MarkdownContent text={"# Title\n" + "x".repeat(MAX_RICH_MARKDOWN) + "\nEND"} />);
    expect(html).toContain("Large document shown as source"); expect(html).toContain("END"); expect(html).not.toContain("<h1");
    expect(parse).not.toHaveBeenCalled();
  });
});

describe("code highlighting", () => {
  it("skips plain text and oversized code without calling Rust", async () => {
    const call = vi.spyOn(api, "highlightCode").mockResolvedValue([[{ content: "x", htmlStyle: {} }]]);
    expect(await highlightCode("hello", "text")).toBeNull();
    expect(await highlightCode("x".repeat(40001), "js")).toBeNull();
    expect(call).not.toHaveBeenCalled();
    expect(await highlightCode("const a = 1", "ts")).toEqual([[{ content: "x", htmlStyle: {} }]]);
    expect(await highlightCode("const a = 1", "ts")).toEqual([[{ content: "x", htmlStyle: {} }]]);
    expect(call).toHaveBeenCalledTimes(1);
  });
});
