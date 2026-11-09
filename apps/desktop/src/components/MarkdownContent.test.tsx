import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MarkdownContent from "./MarkdownContent";
import { markdownImage, markdownLink, MAX_RICH_MARKDOWN } from "../lib/markdown";
import { highlightCode } from "../lib/codeHighlight";

const render = (text: string) => renderToStaticMarkup(<MarkdownContent text={text} />);

describe("shared Markdown renderer", () => {
  it("renders GFM tables, tasks, nested lists, links, strikeout and footnotes", () => {
    const html = render('# Title\n\n| Name | Value |\n| --- | ---: |\n| Test | 42 |\n\n- [x] Done\n- [ ] Pending\n  - Child\n\n~~removed~~ **strong** `inline` https://example.com\n\nReference[^one].\n\n[^one]: Footnote text');
    for (const expected of ['<h1', '<table>', 'type="checkbox"', 'checked=""', '<del>removed</del>', '<strong>strong</strong>', '<code>inline</code>', 'href="https://example.com"', 'Footnote text']) expect(html).toContain(expected);
  });
  it("renders inline and display math with accessible MathML", () => {
    const html = render('Inline $x^2$.\n\n$$\n\\frac{a}{b}\n$$');
    expect(html).toContain('class="katex"'); expect(html).toContain('katex-display'); expect(html).toContain('<math'); expect(html).toContain('<mfrac>');
  });
  it("keeps raw HTML and unsafe URLs inert; remote images never auto-load", () => {
    const html = render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert%281%29)\n\n![tracking](https://example.com/pixel.png)');
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<img'); expect(html).not.toContain('href="javascript:');
    expect(html).toContain('not loaded automatically'); expect(html).toContain('Open image: tracking');
    for (const unsafe of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', '//example.com', 'https://user:pass@example.com']) expect(markdownLink(unsafe)).toBeUndefined();
    expect(markdownImage('data:image/svg+xml;base64,PHN2Zz4=')).toBeUndefined(); expect(markdownImage('data:image/png;base64,aGVsbG8=')).toBeDefined();
  });
  it("scopes duplicate headings and footnotes to each message", () => {
    const html = renderToStaticMarkup(<><MarkdownContent text={'# Same\n\n# Same\n\n[Jump](#same)\n\nNote[^n].\n\n[^n]: Footnote'} /><MarkdownContent text={'# Same\n\nNote[^n].\n\n[^n]: Other footnote'} /></>);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const links = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    for (const target of links) expect(ids).toContain(target);
  });
  it("shows very large Markdown as source, without truncating loaded text", () => {
    const html = render('# Title\n' + 'x'.repeat(MAX_RICH_MARKDOWN) + '\nEND');
    expect(html).toContain('Large document shown as source'); expect(html).toContain('END'); expect(html).not.toContain('<h1');
  });
  it("preserves fenced code content and offers copy/wrap/line controls", () => {
    const html = render('```typescript\nconst x = "<script>";\n```');
    expect(html).toContain('typescript code'); expect(html).toContain('Copy code'); expect(html).toContain('Wrap'); expect(html).toContain('Lines');
    expect(html).toContain('const x = &quot;&lt;script&gt;&quot;;');
  });
});

describe("Shiki highlighting", () => {
  it("highlights actual TypeScript and Rust grammars with light/dark token colors", async () => {
    for (const [language, source] of [['ts', 'const answer: number = 42;'], ['rs', 'fn main() { println!("hello"); }']]) {
      const tokens = await highlightCode(source, language);
      expect(tokens?.flat().map((t) => t.content).join('')).toBe(source);
      expect(tokens?.flat().some((t) => t.htmlStyle?.['--shiki-light'] && t.htmlStyle?.['--shiki-dark'])).toBe(true);
    }
  });
  it("falls back for unknown grammars and oversized code", async () => {
    expect(await highlightCode('hello', 'imaginary-language')).toBeNull(); expect(await highlightCode('x'.repeat(40001), 'js')).toBeNull();
  });
});


it("highlights bare XML markup inside Markdown without executing it", () => {
  const xml = '<context version="1">\n<goal>Continue</goal>\n</context>';
  const html = render('## Context\n\n' + xml);
  expect(html).toContain('aria-label="xml code"');
  expect(html).toContain('&lt;context');
  expect(html).not.toContain('<context');
});
it("supports XML and JSON syntax grammars", async () => {
  for (const [language, source] of [['xml', '<context id="1">hello</context>'], ['json', '{"command":"echo hello"}']]) {
    const tokens = await highlightCode(source, language);
    expect(tokens?.flat().map((t) => t.content).join('')).toBe(source);
    expect(tokens?.flat().some((t) => t.htmlStyle?.['--shiki-light'])).toBe(true);
  }
});
