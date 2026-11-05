import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownBlock } from "./MarkdownViewer";

describe("MarkdownBlock", () => {
  it("highlights fenced code and preserves coding-agent tags", () => {
    const html = renderToStaticMarkup(
      <MarkdownBlock
        text={'<environment_context>\n```ts\nconst answer: number = 42;\n```\n</environment_context>'}
      />,
    );

    expect(html).toContain('data-agent-tag="environment_context"');
    expect(html).toContain("hljs-keyword");
    expect(html).toContain("language-ts");
  });

  it("renders GFM tasks, tables, and alerts", () => {
    const html = renderToStaticMarkup(
      <MarkdownBlock
        text={'> [!WARNING]\n> Check this first.\n\n- [x] Done\n\n| Item | State |\n| --- | ---: |\n| Build | 1 |'}
      />,
    );

    expect(html).toContain("Warning");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<table");
    expect(html).not.toContain("[!WARNING]");
  });
});
