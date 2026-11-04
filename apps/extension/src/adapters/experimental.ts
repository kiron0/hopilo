import type { WebAdapter } from "./common";

const firstOf = <T extends Element>(doc: Document, selectors: string[]) => {
  for (const s of selectors) {
    const el = doc.querySelector<T & HTMLElement>(s);
    if (el) return el;
  }
  return null;
};

const stripTitle = (title: string, name: string) => title.replace(new RegExp(`\\s*[-|]\\s*${name}\\s*$`, "i"), "").replace(new RegExp(`^${name}$`, "i"), "");

export const deepseek: WebAdapter = {
  id: "deepseek",
  version: "0-experimental",
  hosts: ["chat.deepseek.com"],
  messages(doc) {
    const items = Array.from(doc.querySelectorAll(".ds-message, [data-testid='message'], [class*='message_']"));
    const top = items.filter((el) => !items.some((o) => o !== el && o.contains(el)));
    return top.map((el) => ({ el, role: el.querySelector(".ds-markdown") ? ("assistant" as const) : ("user" as const) }));
  },
  body(el, role) {
    return (role === "assistant" ? el.querySelector(".ds-markdown") : null) ?? el;
  },
  composer(doc) {
    return firstOf(doc, ["textarea#chat-input", "textarea[placeholder]", "textarea"]);
  },
  title(doc) {
    return stripTitle(doc.title, "DeepSeek");
  },
};

export const grok: WebAdapter = {
  id: "grok",
  version: "0-experimental",
  hosts: ["grok.com"],
  messages(doc) {
    return Array.from(doc.querySelectorAll(".message-bubble")).map((el) => ({
      el,
      role: el.closest(".items-end, [data-role='user']") ? ("user" as const) : ("assistant" as const),
    }));
  },
  body(el) {
    return el;
  },
  composer(doc) {
    return firstOf(doc, ["textarea[aria-label]", "div[contenteditable='true']", "textarea"]);
  },
  title(doc) {
    return stripTitle(doc.title, "Grok");
  },
};

export const perplexity: WebAdapter = {
  id: "perplexity",
  version: "0-experimental",
  hosts: ["www.perplexity.ai", "perplexity.ai"],
  messages(doc) {
    const all = Array.from(doc.querySelectorAll("h1[class*='query'], div[class*='group/query'], .prose"));
    const top = all.filter((el) => !all.some((o) => o !== el && o.contains(el)));
    return top.map((el) => ({ el, role: el.matches(".prose") ? ("assistant" as const) : ("user" as const) }));
  },
  body(el) {
    return el;
  },
  composer(doc) {
    return firstOf(doc, ["#ask-input[contenteditable='true']", "textarea[placeholder]", "div[contenteditable='true']", "textarea"]);
  },
  title(doc) {
    return stripTitle(doc.title, "Perplexity");
  },
};
