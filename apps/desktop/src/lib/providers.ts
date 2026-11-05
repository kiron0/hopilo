export type ProviderKind = "chat" | "agent" | "local";
export type CaptureMethod = "auto" | "export" | "file" | "paste" | "none";

export interface Provider {
  id: string;
  label: string;
  kind: ProviderKind;
  color: string;
  capture: CaptureMethod;
  url?: string;
  hint: string;
}

const CHAT_HINT = "Open a new chat, paste, review, then send.";
const AGENT_HINT = "Start a new session in the project folder and paste as your first message.";

export const PROVIDERS: Provider[] = [
  { id: "claude", label: "Claude", kind: "chat", color: "#d97757", capture: "export", url: "https://claude.ai/new", hint: CHAT_HINT },
  { id: "gemini", label: "Gemini", kind: "chat", color: "#4285f4", capture: "paste", url: "https://gemini.google.com/app", hint: CHAT_HINT },
  { id: "grok", label: "Grok", kind: "chat", color: "#5b6170", capture: "paste", url: "https://grok.com/", hint: CHAT_HINT },
  { id: "deepseek", label: "DeepSeek", kind: "chat", color: "#4d6bfe", capture: "paste", url: "https://chat.deepseek.com/", hint: CHAT_HINT },
  { id: "perplexity", label: "Perplexity", kind: "chat", color: "#20808d", capture: "paste", url: "https://www.perplexity.ai/", hint: "Open a new thread, paste, review, then send." },

  { id: "antigravity", label: "Antigravity", kind: "agent", color: "#4285f4", capture: "auto", hint: "Start a session in Antigravity and paste as your first message." },
  { id: "claude-code", label: "Claude Code", kind: "agent", color: "#c96442", capture: "auto", hint: "Run `claude` in the project folder and paste as your first message." },
  { id: "codex", label: "Codex CLI", kind: "agent", color: "#0f8f6f", capture: "auto", hint: "Run `codex` in the project folder and paste as your first message." },
  { id: "cursor", label: "Cursor", kind: "agent", color: "#27272a", capture: "auto", hint: "Start a chat in Cursor and paste as your first message." },
  { id: "gemini-cli", label: "Gemini CLI", kind: "agent", color: "#3b78e7", capture: "auto", hint: "Run `gemini` in the project folder and paste as your first message." },
  { id: "opencode", label: "OpenCode", kind: "agent", color: "#6b7280", capture: "auto", hint: "Run `opencode` in the project folder and paste as your first message." },
  { id: "qwen-code", label: "Qwen Code", kind: "agent", color: "#615ced", capture: "auto", hint: "Run `qwen` in the project folder and paste as your first message." },
  { id: "zed", label: "Zed", kind: "agent", color: "#0751cf", capture: "auto", hint: "Start a chat in Zed and paste as your first message." },
  { id: "aider", label: "Aider", kind: "agent", color: "#14b8a6", capture: "file", hint: AGENT_HINT },

  { id: "clipboard", label: "Clipboard", kind: "local", color: "#8b5cf6", capture: "none", hint: "" },
  { id: "manual", label: "Note", kind: "local", color: "#64748b", capture: "none", hint: "" },
  { id: "file", label: "File", kind: "local", color: "#0ea5e9", capture: "none", hint: "" },
  { id: "other", label: "Other AI", kind: "chat", color: "#64748b", capture: "paste", hint: "Paste it or attach the exported file wherever you continue." },
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

export function provider(id: string): Provider {
  return BY_ID.get(id) ?? { id, label: id, kind: "chat", color: "#64748b", capture: "paste", hint: CHAT_HINT };
}

export const TARGETS = PROVIDERS.filter((p) => p.kind !== "local");

export const PASTE_SOURCES = PROVIDERS.filter((p) => p.kind !== "local" && p.capture !== "auto");

export const CAPTURE_LABEL: Record<CaptureMethod, string> = {
  auto: "Reads sessions automatically",
  export: "Import your data export, or paste",
  file: "Import its chat history file",
  paste: "Copy the chat, paste into Capture",
  none: "",
};
