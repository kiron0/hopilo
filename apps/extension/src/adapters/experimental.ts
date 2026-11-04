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
    const markdowns = Array.from(doc.querySelectorAll(".ds-markdown, [class*='ds-markdown']"));
    if (markdowns.length > 0) {
      let cur: Element | null = markdowns[0].parentElement;
      let listContainer: Element | null = null;
      while (cur && cur !== doc.body && cur !== doc.documentElement) {
        if (cur.children.length > 1) {
          const mdCount = cur.querySelectorAll(".ds-markdown, [class*='ds-markdown']").length;
          if (mdCount === markdowns.length) {
            listContainer = cur;
            break;
          }
        }
        cur = cur.parentElement;
      }

      if (listContainer) {
        const turns: { el: Element; role: "user" | "assistant" }[] = [];
        for (const child of Array.from(listContainer.children)) {
          const text = child.textContent?.trim() ?? "";
          if (!text) continue;
          const md = child.querySelector(".ds-markdown, [class*='ds-markdown']") ?? (child.classList.contains("ds-markdown") ? child : null);
          if (md) {
            turns.push({ el: child, role: "assistant" });
          } else {
            turns.push({ el: child, role: "user" });
          }
        }
        if (turns.length > 0) return turns;
      }
    }

    const items = Array.from(
      doc.querySelectorAll(".ds-message, [data-testid='message'], [class*='message_'], [class*='chat-item'], [class*='fbb7'], .ds-markdown")
    );
    const top = items.filter((el) => !items.some((o) => o !== el && o.contains(el)));
    return top.map((el) => ({
      el,
      role: el.querySelector(".ds-markdown, [class*='ds-markdown']") || el.matches(".ds-markdown, [class*='ds-markdown']")
        ? ("assistant" as const)
        : ("user" as const),
    }));
  },
  body(el, role) {
    if (role === "assistant") {
      return el.querySelector(".ds-markdown, [class*='ds-markdown']") ?? el;
    }
    return (
      el.querySelector("[class*='fbb7'], [class*='user'], p, div") ??
      el
    );
  },
  composer(doc) {
    return firstOf(doc, ["textarea#chat-input", "textarea[placeholder]", "textarea"]);
  },
  title(doc) {
    const raw = stripTitle(doc.title, "DeepSeek");
    if (raw && !/^Into the Unknown$/i.test(raw)) return raw;
    const firstUser = doc.querySelector("[class*='fbb7'], [class*='user']");
    if (firstUser) {
      const text = firstUser.textContent?.trim().slice(0, 80);
      if (text) return text;
    }
    return "DeepSeek conversation";
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
