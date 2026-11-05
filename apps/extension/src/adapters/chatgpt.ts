import type { WebAdapter } from "./common";

function isVisible(el: HTMLElement): boolean {
  if (typeof el.checkVisibility === "function") {
    try {
      if (!el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) return false;
    } catch {
      if (!el.checkVisibility()) return false;
    }
  }
  if (el.closest("[aria-hidden='true'], [hidden], [inert]")) return false;
  let p: HTMLElement | null = el;
  while (p && p !== el.ownerDocument?.body && p !== el.ownerDocument?.documentElement) {
    const style = p.getAttribute("style") ?? "";
    if (/display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style)) return false;
    if (p.hasAttribute("hidden") || p.getAttribute("aria-hidden") === "true" || p.hasAttribute("inert")) return false;
    p = p.parentElement;
  }
  return true;
}

function findActiveComposer(doc: Document): HTMLElement | null {
  const selectors = [
    "#prompt-textarea[contenteditable='true']",
    "#prompt-textarea",
    "#mobile-composer-prompt",
    "div[contenteditable='true'][data-placeholder]",
    "form [contenteditable='true']",
    "form textarea",
    "textarea[placeholder]",
    "textarea",
  ];
  for (const sel of selectors) {
    const list = Array.from(doc.querySelectorAll<HTMLElement>(sel)).filter(isVisible);
    if (list.length > 0) return list[list.length - 1];
  }
  return null;
}

function activeRoot(doc: Document): HTMLElement {
  const composer = findActiveComposer(doc);
  if (composer) {
    const main = composer.closest<HTMLElement>("main");
    if (main && isVisible(main)) return main;
  }
  const mains = Array.from(doc.querySelectorAll<HTMLElement>("main")).filter(isVisible);
  if (mains.length > 0) return mains[mains.length - 1];
  return (doc.querySelector<HTMLElement>("main") ?? doc.body ?? doc.documentElement) as HTMLElement;
}

function extractTurnIndex(testid: string | null): number | null {
  if (!testid) return null;
  const m = testid.match(/conversation-turn-(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function detectTurnRole(el: HTMLElement, index: number, prevRole: "user" | "assistant" | null): "user" | "assistant" {
  const selfRole = el.getAttribute("data-message-role") || el.getAttribute("data-message-author-role");
  if (selfRole === "user" || selfRole === "assistant") return selfRole;

  const innerRoleEl = el.querySelector("[data-message-author-role], [data-message-role]");
  if (innerRoleEl) {
    const r = innerRoleEl.getAttribute("data-message-author-role") || innerRoleEl.getAttribute("data-message-role");
    if (r === "user" || r === "assistant") return r;
  }

  const hasUserMarker = !!el.querySelector(
    "[data-user-message-bubble], [data-testid='user-message'], [data-user-message-copy], [data-message-author-role='user']"
  );
  const hasAsstMarker = !!el.querySelector(
    "[data-assistant-markdown], [data-assistant-markdown-root], .agent-turn, .markdown, .prose, [data-message-author-role='assistant']"
  );

  if (hasUserMarker && !hasAsstMarker) return "user";
  if (hasAsstMarker && !hasUserMarker) return "assistant";

  const heading = (
    el.querySelector("h1, h2, h3, h4, h5, h6, .sr-only, [data-testid='conversation-turn-role']")?.textContent ?? ""
  ).toLowerCase();
  if (heading.includes("you")) return "user";
  if (heading.includes("chatgpt") || heading.includes("assistant") || heading.includes("thought")) return "assistant";

  if (hasAsstMarker) return "assistant";
  if (hasUserMarker) return "user";

  if (el.querySelector("pre, code, table")) return "assistant";
  if (el.querySelector(".whitespace-pre-wrap, .whitespace-break-spaces")) return "user";

  if (prevRole) return prevRole === "user" ? "assistant" : "user";
  return index % 2 === 0 ? "user" : "assistant";
}

export const chatgpt: WebAdapter = {
  id: "chatgpt",
  version: "1",
  hosts: ["chatgpt.com", "www.chatgpt.com", "chat.openai.com", "www.chat.openai.com"],
  messages(doc) {
    const root = activeRoot(doc);

    const rawTurns = Array.from(
      root.querySelectorAll<HTMLElement>("[data-testid^='conversation-turn-'], article, [data-turn]")
    ).filter(isVisible);

    if (rawTurns.length > 0) {
      const topTurns = rawTurns.filter((el) => !rawTurns.some((o) => o !== el && o.contains(el)));
      let startIndex = 0;
      for (let i = 1; i < topTurns.length; i++) {
        const prevIdx = extractTurnIndex(topTurns[i - 1].getAttribute("data-testid"));
        const currIdx = extractTurnIndex(topTurns[i].getAttribute("data-testid"));
        if (prevIdx !== null && currIdx !== null && currIdx <= prevIdx) {
          startIndex = i;
        }
      }
      const activeTurns = topTurns.slice(startIndex);
      let prevRole: "user" | "assistant" | null = null;
      const items: { el: HTMLElement; role: "user" | "assistant" }[] = [];
      for (let i = 0; i < activeTurns.length; i++) {
        const el = activeTurns[i];
        const role = detectTurnRole(el, i, prevRole);
        prevRole = role;
        const hasContent = (el.textContent?.trim().length ?? 0) > 0 || el.querySelector("img, [data-file-name]") !== null;
        if (hasContent) {
          items.push({ el, role });
        }
      }
      if (items.length > 0) return items;
    }

    const roleItems = Array.from(
      root.querySelectorAll<HTMLElement>(
        "[data-message-role='user'], [data-message-role='assistant'], [data-message-author-role='user'], [data-message-author-role='assistant']"
      )
    ).filter(isVisible);

    if (roleItems.length > 0) {
      const top = roleItems.filter((el) => !roleItems.some((o) => o !== el && o.contains(el)));
      const items = top
        .map((el) => {
          const role = (el.getAttribute("data-message-role") || el.getAttribute("data-message-author-role")) as "user" | "assistant";
          return { el, role };
        })
        .filter((m) => (m.el.textContent?.trim().length ?? 0) > 0);
      if (items.some((m) => m.role === "assistant") || items.length > 0) return items;
    }

    const bubbles = Array.from(
      root.querySelectorAll<HTMLElement>("[data-user-message-bubble], [data-assistant-markdown], .markdown")
    ).filter(isVisible);
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
      if (el.matches("[data-assistant-markdown], [data-assistant-markdown-root], [data-message-content], .markdown, .prose")) {
        return el;
      }
      return (
        el.querySelector("[data-assistant-markdown]") ??
        el.querySelector("[data-assistant-markdown-root]") ??
        el.querySelector("[data-message-content]") ??
        el.querySelector(".markdown") ??
        el.querySelector(".prose") ??
        el.querySelector(".agent-turn") ??
        el
      );
    }
    if (el.matches("[data-user-message-bubble], [data-user-message-copy], [data-message-content], .whitespace-pre-wrap, .whitespace-break-spaces")) {
      return el;
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
    return findActiveComposer(doc);
  },
  title(doc) {
    const raw = doc.title
      .replace(/\s*[-|]\s*ChatGPT\s*$/i, "")
      .replace(/^ChatGPT[:\s].*$/i, "")
      .replace(/^ChatGPT$/i, "")
      .trim();
    if (raw) return raw;
    const msgs = chatgpt.messages(doc);
    const firstUser = msgs.find((m) => m.role === "user");
    if (firstUser) {
      const text = firstUser.el.textContent?.trim().slice(0, 80);
      if (text) return text;
    }
    return "ChatGPT conversation";
  },
};
