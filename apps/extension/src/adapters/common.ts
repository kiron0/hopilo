// Shared helpers for provider adapters: DOM to Markdown, loading older
// messages, and inserting a draft into a composer without sending it.
import type { CapturedMessage, CapturePayload, Provider } from "../protocol";

export interface WebAdapter {
  id: Provider;
  version: string;
  hosts: string[];
  /** Message elements in document order, with their role. */
  messages(doc: Document): { role: "user" | "assistant"; el: Element }[];
  /** The element whose text is the message body. */
  body(el: Element, role: "user" | "assistant"): Element;
  composer(doc: Document): HTMLElement | null;
  title(doc: Document): string;
}

const SKIP = new Set(["BUTTON", "SVG", "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "INPUT", "TEXTAREA"]);
const BLOCKS = new Set(["P", "DIV", "SECTION", "ARTICLE", "BLOCKQUOTE", "UL", "OL", "TABLE", "H1", "H2", "H3", "H4", "H5", "H6", "PRE", "HR", "FIGURE"]);

function fence(code: string): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((m) => m.length));
  return "`".repeat(Math.max(3, longest + 1));
}

function codeLanguage(pre: Element): string {
  const code = pre.querySelector("code");
  const cls = `${code?.className ?? ""} ${pre.className}`;
  const m = cls.match(/language-([\w+#.-]+)/);
  return m ? m[1] : "";
}

/** Convert rendered chat HTML into Markdown that keeps code, lists, links
 *  and tables. Copy buttons and other controls are dropped. */
export function toMarkdown(root: Element): string {
  const out: string[] = [];
  const walk = (node: Node, listDepth: number): string => {
    if (node.nodeType === 3) return (node.textContent ?? "").replace(/\s+/g, " ");
    if (node.nodeType !== 1) return "";
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (SKIP.has(tag) || el.getAttribute("aria-hidden") === "true" || el.classList.contains("sr-only")) return "";
    const kids = () => Array.from(el.childNodes).map((c) => walk(c, listDepth)).join("");
    switch (tag) {
      case "BR":
        return "\n";
      case "PRE": {
        const code = (el.querySelector("code") ?? el).textContent ?? "";
        const f = fence(code);
        return `\n\n${f}${codeLanguage(el)}\n${code.replace(/\n$/, "")}\n${f}\n\n`;
      }
      case "CODE":
        return `\`${el.textContent ?? ""}\``;
      case "STRONG":
      case "B":
        return `**${kids().trim()}**`;
      case "EM":
      case "I":
        return `*${kids().trim()}*`;
      case "A": {
        const href = el.getAttribute("href") ?? "";
        const text = kids().trim();
        return href.startsWith("http") && text && text !== href ? `[${text}](${href})` : text || href;
      }
      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6":
        return `\n\n${"#".repeat(Number(tag[1]))} ${kids().trim()}\n\n`;
      case "LI": {
        const parent = el.parentElement?.tagName.toUpperCase();
        const index = parent === "OL" ? `${Array.from(el.parentElement!.children).indexOf(el) + 1}.` : "-";
        const indent = "  ".repeat(Math.max(0, listDepth - 1));
        // Nested lists and paragraphs inside an item stay attached to it.
        return `\n${indent}${index} ${kids().trim().replace(/\n{2,}/g, "\n")}`;
      }
      case "UL":
      case "OL":
        return `\n${Array.from(el.childNodes).map((c) => walk(c, listDepth + 1)).join("")}\n\n`;
      case "TR":
        return `\n| ${Array.from(el.children).map((c) => walk(c, listDepth).trim().replace(/\|/g, "\\|")).join(" | ")} |`;
      case "THEAD": {
        const cols = el.querySelector("tr")?.children.length ?? 0;
        return `${kids()}\n|${" --- |".repeat(cols)}`;
      }
      case "TABLE":
        return `\n\n${kids().trim()}\n\n`;
      case "HR":
        return "\n\n---\n\n";
      case "IMG":
        return el.getAttribute("alt") ? `[image: ${el.getAttribute("alt")}]` : "[image]";
      default:
        return BLOCKS.has(tag) ? `\n\n${kids()}\n\n` : kids();
    }
  };
  out.push(walk(root, 0));
  return out
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function scrollParent(el: Element | null): HTMLElement | null {
  let cur = el?.parentElement ?? null;
  while (cur) {
    const s = getComputedStyle(cur);
    if (/(auto|scroll)/.test(s.overflowY) && cur.scrollHeight > cur.clientHeight) return cur;
    cur = cur.parentElement;
  }
  return (document.scrollingElement as HTMLElement) ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Scroll to the top until no more older messages load (CAP-09). Returns
 *  false if the time limit was hit while messages were still appearing. */
export async function loadOlder(adapter: WebAdapter, doc: Document, timeoutMs = 20000): Promise<boolean> {
  const first = adapter.messages(doc)[0]?.el ?? null;
  const box = scrollParent(first);
  if (!box) return true;
  const restore = box.scrollTop;
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  let stable = 0;
  while (Date.now() < deadline) {
    const n = adapter.messages(doc).length;
    if (n === last) {
      if (++stable >= 2) break;
    } else stable = 0;
    last = n;
    box.scrollTop = 0;
    await sleep(700);
  }
  const finished = stable >= 2;
  box.scrollTop = restore;
  return finished;
}

function pageUrl(doc: Document): string {
  const loc = doc.defaultView?.location ?? globalThis.location;
  return loc ? loc.origin + loc.pathname : "";
}

export async function capture(adapter: WebAdapter, doc: Document, opts: { includeOlder: boolean }): Promise<CapturePayload> {
  const missing: string[] = [];
  if (opts.includeOlder && !(await loadOlder(adapter, doc))) {
    missing.push("Older messages were still loading when the time limit was reached");
  }
  const messages: CapturedMessage[] = [];
  let unreadable = 0;
  for (const { role, el } of adapter.messages(doc)) {
    const text = toMarkdown(adapter.body(el, role));
    if (text) messages.push({ role, text });
    else unreadable++;
  }
  if (unreadable) missing.push(`${unreadable} message(s) had no readable text (images, files or widgets)`);
  const files = doc.querySelectorAll("[data-testid*='file'], [class*='attachment']").length;
  if (files) missing.push("Files or images shared in the chat are not included — attach them yourself");
  return {
    title: adapter.title(doc).trim() || `${adapter.id} conversation`,
    url: pageUrl(doc),
    messages,
    status: missing.length ? "partial" : "complete",
    missing,
    adapterVersion: `${adapter.id}-web@${adapter.version}`,
  };
}

/** Put text into the composer as an unsent draft (OUT-04). Never presses
 *  Enter or clicks send. Returns true only if the text is visibly there. */
export function insertDraft(target: HTMLElement, text: string): boolean {
  target.focus();
  if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
    const field = target as HTMLTextAreaElement;
    // Use the prototype's setter so React-controlled inputs see the change.
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set;
    const next = field.value ? `${field.value}\n\n${text}` : text;
    if (setter) setter.call(field, next);
    else field.value = next;
    field.dispatchEvent(new (field.ownerDocument.defaultView?.Event ?? Event)("input", { bubbles: true }));
    return field.value.includes(text.slice(0, 40));
  }
  // Rich editors (ProseMirror, Quill): place the caret at the end, then use
  // the editor's own text-insertion path so its state stays consistent.
  const sel = target.ownerDocument.getSelection();
  if (sel) {
    const range = target.ownerDocument.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  let ok = false;
  try {
    ok = target.ownerDocument.execCommand("insertText", false, text);
  } catch {
    ok = false;
  }
  if (!ok || !(target.textContent ?? "").includes(text.slice(0, 40).trim())) {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }
  const probe = text.replace(/\s+/g, " ").slice(0, 40).trim();
  return (target.textContent ?? "").replace(/\s+/g, " ").includes(probe);
}
