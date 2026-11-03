// Gemini (gemini.google.com). Angular custom elements user-query and
// model-response hold each turn.
import type { WebAdapter } from "./common";

export const gemini: WebAdapter = {
  id: "gemini",
  version: "1",
  hosts: ["gemini.google.com"],
  messages(doc) {
    return Array.from(doc.querySelectorAll("user-query, model-response")).map((el) => ({
      el,
      role: el.tagName.toLowerCase() === "user-query" ? ("user" as const) : ("assistant" as const),
    }));
  },
  body(el, role) {
    return (role === "user" ? el.querySelector(".query-text") : el.querySelector("message-content, .markdown")) ?? el;
  },
  composer(doc) {
    return (
      doc.querySelector<HTMLElement>("rich-textarea .ql-editor[contenteditable='true']") ??
      doc.querySelector<HTMLElement>("div[contenteditable='true'][role='textbox']")
    );
  },
  title(doc) {
    const active = doc.querySelector(".conversation.selected .conversation-title, [aria-current='page'] .conversation-title");
    return active?.textContent?.trim() || doc.title.replace(/\s*[-|]\s*Gemini\s*$/i, "").replace(/^(Google )?Gemini$/i, "");
  },
};
