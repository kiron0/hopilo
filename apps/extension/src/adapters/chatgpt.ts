import type { WebAdapter } from "./common";

export const chatgpt: WebAdapter = {
  id: "chatgpt",
  version: "1",
  hosts: ["chatgpt.com", "chat.openai.com"],
  messages(doc) {
    const items = Array.from(
      doc.querySelectorAll("[data-message-role], [data-message-author-role]")
    );

    if (items.length > 0) {
      return items
        .map((el) => {
          const role = el.getAttribute("data-message-role") || el.getAttribute("data-message-author-role");
          return { el, role };
        })
        .filter((m): m is { el: Element; role: "user" | "assistant" } => m.role === "user" || m.role === "assistant");
    }

    const turns = Array.from(
      doc.querySelectorAll("article[data-testid^='conversation-turn-'], [data-turn], [data-user-message-bubble], [data-assistant-markdown]")
    );
    const top = turns.filter((el) => !turns.some((o) => o !== el && o.contains(el)));
    return top
      .map((el) => {
        const isAssistant = !!el.querySelector("[data-assistant-markdown], .markdown") || el.hasAttribute("data-assistant-markdown");
        return { el, role: isAssistant ? ("assistant" as const) : ("user" as const) };
      })
      .filter((m) => (m.el.textContent?.trim().length ?? 0) > 0);
  },
  body(el, role) {
    if (role === "assistant") {
      return (
        el.querySelector("[data-assistant-markdown]") ??
        el.querySelector("[data-assistant-markdown-root]") ??
        el.querySelector(".markdown") ??
        el
      );
    }
    return (
      el.querySelector("[data-user-message-bubble]") ??
      el.querySelector("[data-user-message-copy]") ??
      el.querySelector(".whitespace-pre-wrap") ??
      el
    );
  },
  composer(doc) {
    return (
      doc.querySelector<HTMLElement>("#prompt-textarea[contenteditable='true']") ??
      doc.querySelector<HTMLElement>("#prompt-textarea") ??
      doc.querySelector<HTMLElement>("form [contenteditable='true']") ??
      doc.querySelector<HTMLElement>("form textarea") ??
      doc.querySelector<HTMLElement>("textarea[placeholder]") ??
      doc.querySelector<HTMLElement>("textarea")
    );
  },
  title(doc) {
    const raw = doc.title
      .replace(/\s*[-|]\s*ChatGPT\s*$/i, "")
      .replace(/^ChatGPT[:\s].*$/i, "")
      .replace(/^ChatGPT$/i, "")
      .trim();
    if (raw) return raw;
    const firstUser = doc.querySelector(
      "[data-message-role='user'], [data-message-author-role='user'], [data-user-message-bubble]"
    );
    if (firstUser) {
      const text = firstUser.textContent?.trim().slice(0, 80);
      if (text) return text;
    }
    return "ChatGPT conversation";
  },
};
