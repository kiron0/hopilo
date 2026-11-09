import type { MdNode } from "../lib/api";

const el = (tag: string, c: MdNode[], extra: Partial<Extract<MdNode, { t: "el" }>> = {}): MdNode => ({ t: "el", tag, c, ...extra });

function inline(text: string): MdNode[] {
  const out: MdNode[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ t: "text", v: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: "icode", v: m[1] });
    else if (m[2] !== undefined) out.push(el("strong", inline(m[2])));
    else if (m[3] !== undefined) out.push(el("em", inline(m[3])));
    else out.push({ t: "link", href: m[5], c: inline(m[4]) });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

export function mockParseMarkdown(text: string): MdNode[] {
  const lines = text.split("\n");
  const out: MdNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^```(\S*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) body.push(lines[i]);
      out.push({ t: "code", lang: fence[1], v: body.join("\n") });
      i++;
    } else if (/^#{1,6}\s/.test(line)) {
      const level = line.indexOf(" ");
      out.push(el(`h${level}`, inline(line.slice(level + 1))));
      i++;
    } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: MdNode[] = [];
      for (; i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i]); i++) {
        const task = /^\s*(?:[-*]|\d+\.)\s\[( |x)\]\s(.*)$/.exec(lines[i]);
        items.push(task ? el("li", inline(task[2]), { checked: task[1] === "x", class: "task-list-item" }) : el("li", inline(lines[i].replace(/^\s*([-*]|\d+\.)\s/, ""))));
      }
      out.push(el(ordered ? "ol" : "ul", items));
    } else if (line.trim()) {
      const para: string[] = [];
      for (; i < lines.length && lines[i].trim() && !/^(```|#{1,6}\s|\s*([-*]|\d+\.)\s)/.test(lines[i]); i++) para.push(lines[i]);
      out.push(el("p", inline(para.join("\n"))));
    } else i++;
  }
  return out;
}
