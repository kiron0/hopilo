import type { WebAdapter } from "./common";

export const chatgpt: WebAdapter = {
  id: "chatgpt",
  version: "1",
  hosts: ["chatgpt.com", "chat.openai.com"],
  messages(doc) {
    return Array.from(doc.querySelectorAll("[data-message-author-role]"))
      .map((el) => ({ el, role: el.getAttribute("data-message-author-role") }))
      .filter((m): m is { el: Element; role: "user" | "assistant" } => m.role === "user" || m.role === "assistant");
  },
  body(el, role) {
    return (role === "assistant" ? el.querySelector(".markdown") : el.querySelector(".whitespace-pre-wrap")) ?? el;
  },
  composer(doc) {
    return (
      doc.querySelector<HTMLElement>("#prompt-textarea[contenteditable='true']") ??
      doc.querySelector<HTMLElement>("#prompt-textarea") ??
      doc.querySelector<HTMLElement>("form [contenteditable='true']") ??
      doc.querySelector<HTMLElement>("form textarea")
    );
  },
  title(doc) {
    return doc.title.replace(/\s*[-|]\s*ChatGPT\s*$/i, "").replace(/^ChatGPT$/i, "");
  },
};
