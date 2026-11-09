export const markdownSample = String.raw`# Markdown reader

Readable AI transcripts with **bold**, *emphasis*, ~~strikethrough~~ and \`inline code\`.

## Structured output

| Feature | Status |
| :--- | :---: |
| Tables and tasks | Ready |
| Code and math | Ready |

- [x] Preserve original source
- [x] Work offline
- [ ] Review the result

> Notes stay readable in both themes.

## Code

\`\`\`typescript
interface Session { id: string; title: string }
const recent = (items: Session[]) => items.slice(0, 10);
console.log(recent([{ id: "s1", title: "Markdown preview" }]));
\`\`\`

## XML

<context version="1">
  <goal>Continue with the reviewed session</goal>
</context>

## Math

Inline $E = mc^2$, plus a display formula:

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$

## Diagram

\`\`\`mermaid
flowchart LR
  A[Read session] --> B[Review preview]
  B --> C[Copy source]
\`\`\`

A footnote stays scoped to this message.[^source]

[^source]: Preview controls never change copied or exported Markdown.
`.replace(/\\`/g, "`");
