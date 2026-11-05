import type { WebAdapter } from "./common";

export const chatgpt: WebAdapter = {
  id: "chatgpt",
  version: "1",
  hosts: ["chatgpt.com", "www.chatgpt.com", "chat.openai.com", "www.chat.openai.com"],
  messages(doc) {
    const roleItems = Array.from(
      doc.querySelectorAll<HTMLElement>(
        "[data-message-role='user'], [data-message-role='assistant'], [data-message-author-role='user'], [data-message-author-role='assistant']"
      )
    );
    if (roleItems.length > 0) {
      const top = roleItems.filter((el) => !roleItems.some((o) => o !== el && o.contains(el)));
      const items = top
        .map((el) => {
          const role = (el.getAttribute("data-message-role") || el.getAttribute("data-message-author-role")) as "user" | "assistant";
          return { el, role };
        })
        .filter((m) => (m.el.textContent?.trim().length ?? 0) > 0);
      if (items.length > 0) return items;
    }

    const turns = Array.from(
      doc.querySelectorAll<HTMLElement>(
        "[data-testid^='conversation-turn-'], article, [data-turn], [data-message-id]"
      )
    );
    if (turns.length > 0) {
      const topTurns = turns.filter((el) => !turns.some((o) => o !== el && o.contains(el)));
      const items = topTurns
        .map((el) => {
          const roleAttr = el.getAttribute("data-message-role") || el.getAttribute("data-message-author-role");
          if (roleAttr === "user" || roleAttr === "assistant") {
            const role: "user" | "assistant" = roleAttr;
            return { el, role };
          }
          const userSub = el.querySelector("[data-message-author-role='user'], [data-user-message-bubble], [data-testid='user-message']");
          const asstSub = el.querySelector("[data-message-author-role='assistant'], [data-assistant-markdown], .markdown, .prose");
          let role: "user" | "assistant" = "user";
          if (asstSub && !userSub) role = "assistant";
          else if (userSub) role = "user";
          else {
            const heading = el.querySelector("h5, h6, .sr-only")?.textContent?.toLowerCase() ?? "";
            if (heading.includes("chatgpt") || heading.includes("assistant")) role = "assistant";
            else if (heading.includes("you")) role = "user";
            else if (el.querySelector(".markdown, pre, code")) role = "assistant";
          }
          return { el, role };
        })
        .filter((m) => (m.el.textContent?.trim().length ?? 0) > 0);
      if (items.length > 0) return items;
    }

    const bubbles = Array.from(
      doc.querySelectorAll<HTMLElement>("[data-user-message-bubble], [data-assistant-markdown], .markdown")
    );
    const topBubbles = bubbles.filter((el) => !bubbles.some((o) => o !== el && o.contains(el)));
    return topBubbles
      .map((el) => {
        const isAsst = el.hasAttribute("data-assistant-markdown") || el.classList.contains("markdown");
        const role: "user" | "assistant" = isAsst ? "assistant" : "user";
        return { el, role };
      })
      .filter((m) => (m.el.textContent?.trim().length ?? 0) > 0);
  },
  body(el, role) {
    if (role === "assistant") {
      return (
        el.querySelector("[data-assistant-markdown]") ??
        el.querySelector("[data-assistant-markdown-root]") ??
        el.querySelector("[data-message-content]") ??
        el.querySelector(".markdown") ??
        el.querySelector(".prose") ??
        el
      );
    }
    return (
      el.querySelector("[data-user-message-bubble]") ??
      el.querySelector("[data-user-message-copy]") ??
      el.querySelector("[data-message-content]") ??
      el.querySelector(".whitespace-pre-wrap") ??
      el.querySelector(".whitespace-break-spaces") ??
      el
    );
  },
  composer(doc) {
    return (
      doc.querySelector<HTMLElement>("#prompt-textarea[contenteditable='true']") ??
      doc.querySelector<HTMLElement>("#prompt-textarea") ??
      doc.querySelector<HTMLElement>("#mobile-composer-prompt") ??
      doc.querySelector<HTMLElement>("div[contenteditable='true'][data-placeholder]") ??
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
