import type { WebAdapter } from "./common";

const USER = "[data-testid='user-message']";
const ASSISTANT = ".font-claude-response, .font-claude-message, [data-testid='assistant-message']";

export const claude: WebAdapter = {
  id: "claude",
  version: "1",
  hosts: ["claude.ai"],
  messages(doc) {
    const all = Array.from(doc.querySelectorAll(`${USER}, ${ASSISTANT}`));

    return all
      .filter((el) => !all.some((o) => o !== el && o.contains(el)))
      .map((el) => ({ el, role: el.matches(USER) ? ("user" as const) : ("assistant" as const) }));
  },
  body(el) {
    return el;
  },
  composer(doc) {
    return (
      doc.querySelector<HTMLElement>("[data-testid='chat-input'][contenteditable='true']") ??
      doc.querySelector<HTMLElement>("div.ProseMirror[contenteditable='true']") ??
      doc.querySelector<HTMLElement>("fieldset [contenteditable='true']")
    );
  },
  title(doc) {
    return doc.title.replace(/\s*[-|]\s*Claude\s*$/i, "").replace(/^Claude$/i, "");
  },
};
