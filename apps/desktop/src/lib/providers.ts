// Every AI tool Hopilo knows about, as a source of context and as a place to
// continue. `capture` says how context gets out of the tool today:
//   auto   – Hopilo reads the tool's local session files (read-only)
//   export – import the account data export the provider emails you
//   paste  – copy the chat in the tool and paste it into Quick Capture
// Opening a destination never sends anything; the user pastes and sends.

export type ProviderKind = "chat" | "agent" | "local";
export type CaptureMethod = "auto" | "export" | "file" | "paste" | "none";

export interface Provider {
  id: string;
  label: string;
  kind: ProviderKind;
  color: string;
  capture: CaptureMethod;
  /** Web address to open when continuing there. */
  url?: string;
  /** How to continue in this tool, shown after copying. */
  hint: string;
}

const CHAT_HINT = "Open a new chat, paste, review, then send.";
const AGENT_HINT = "Start a new session in the project folder and paste as your first message.";
const IDE_HINT = "Open the AI chat panel in your project and paste as the first message.";

export const PROVIDERS: Provider[] = [
  // Web chat apps
  { id: "chatgpt", label: "ChatGPT", kind: "chat", color: "#10a37f", capture: "export", url: "https://chatgpt.com/", hint: CHAT_HINT },
  { id: "claude", label: "Claude", kind: "chat", color: "#d97757", capture: "export", url: "https://claude.ai/new", hint: CHAT_HINT },
  { id: "gemini", label: "Gemini", kind: "chat", color: "#4285f4", capture: "paste", url: "https://gemini.google.com/app", hint: CHAT_HINT },
  { id: "grok", label: "Grok", kind: "chat", color: "#5b6170", capture: "paste", url: "https://grok.com/", hint: CHAT_HINT },
  { id: "deepseek", label: "DeepSeek", kind: "chat", color: "#4d6bfe", capture: "paste", url: "https://chat.deepseek.com/", hint: CHAT_HINT },
  { id: "perplexity", label: "Perplexity", kind: "chat", color: "#20808d", capture: "paste", url: "https://www.perplexity.ai/", hint: "Open a new thread, paste, review, then send." },
  { id: "copilot", label: "Microsoft Copilot", kind: "chat", color: "#0078d4", capture: "paste", url: "https://copilot.microsoft.com/", hint: CHAT_HINT },
  { id: "mistral", label: "Le Chat (Mistral)", kind: "chat", color: "#fa520f", capture: "paste", url: "https://chat.mistral.ai/chat", hint: CHAT_HINT },
  { id: "meta-ai", label: "Meta AI", kind: "chat", color: "#0866ff", capture: "paste", url: "https://www.meta.ai/", hint: CHAT_HINT },
  { id: "qwen", label: "Qwen Chat", kind: "chat", color: "#615ced", capture: "paste", url: "https://chat.qwen.ai/", hint: CHAT_HINT },
  { id: "kimi", label: "Kimi", kind: "chat", color: "#2f3542", capture: "paste", url: "https://www.kimi.com/", hint: CHAT_HINT },
  { id: "glm", label: "Z.ai (GLM)", kind: "chat", color: "#3d5afe", capture: "paste", url: "https://chat.z.ai/", hint: CHAT_HINT },
  { id: "ai-studio", label: "Google AI Studio", kind: "chat", color: "#1a73e8", capture: "paste", url: "https://aistudio.google.com/", hint: "Start a new prompt, paste, review, then run." },
  { id: "notebooklm", label: "NotebookLM", kind: "chat", color: "#5f6368", capture: "paste", url: "https://notebooklm.google.com/", hint: "Add the exported .md file as a source." },
  { id: "poe", label: "Poe", kind: "chat", color: "#5d5cde", capture: "paste", url: "https://poe.com/", hint: CHAT_HINT },
  { id: "huggingchat", label: "HuggingChat", kind: "chat", color: "#e8a300", capture: "paste", url: "https://huggingface.co/chat/", hint: CHAT_HINT },

  // Coding agents and AI editors
  { id: "claude-code", label: "Claude Code", kind: "agent", color: "#c96442", capture: "auto", hint: "Run `claude` in the project folder and paste as your first message." },
  { id: "codex", label: "Codex CLI", kind: "agent", color: "#0f8f6f", capture: "auto", hint: "Run `codex` in the project folder and paste as your first message." },
  { id: "gemini-cli", label: "Gemini CLI", kind: "agent", color: "#3b78e7", capture: "auto", hint: "Run `gemini` in the project folder and paste as your first message." },
  { id: "opencode", label: "OpenCode", kind: "agent", color: "#6b7280", capture: "auto", hint: "Run `opencode` in the project folder and paste as your first message." },
  { id: "cursor", label: "Cursor", kind: "agent", color: "#3f3f46", capture: "paste", hint: IDE_HINT },
  { id: "windsurf", label: "Windsurf", kind: "agent", color: "#0ea5a4", capture: "paste", hint: IDE_HINT },
  { id: "github-copilot", label: "GitHub Copilot Chat", kind: "agent", color: "#8957e5", capture: "paste", hint: IDE_HINT },
  { id: "antigravity", label: "Antigravity", kind: "agent", color: "#4f7cff", capture: "paste", hint: IDE_HINT },
  { id: "kiro", label: "Kiro", kind: "agent", color: "#7c4dff", capture: "paste", hint: IDE_HINT },
  { id: "trae", label: "Trae", kind: "agent", color: "#ff4d4f", capture: "paste", hint: IDE_HINT },
  { id: "cline", label: "Cline", kind: "agent", color: "#64748b", capture: "paste", hint: IDE_HINT },
  { id: "continue", label: "Continue", kind: "agent", color: "#475569", capture: "paste", hint: IDE_HINT },
  { id: "aider", label: "Aider", kind: "agent", color: "#14b8a6", capture: "file", hint: AGENT_HINT },
  { id: "zed", label: "Zed", kind: "agent", color: "#0751cf", capture: "paste", hint: IDE_HINT },
  { id: "qwen-code", label: "Qwen Code", kind: "agent", color: "#615ced", capture: "auto", hint: "Run `qwen` in the project folder and paste as your first message." },

  // Hopilo's own source kinds
  { id: "clipboard", label: "Clipboard", kind: "local", color: "#8b5cf6", capture: "none", hint: "" },
  { id: "manual", label: "Note", kind: "local", color: "#64748b", capture: "none", hint: "" },
  { id: "file", label: "File", kind: "local", color: "#0ea5e9", capture: "none", hint: "" },
  { id: "other", label: "Other AI", kind: "chat", color: "#64748b", capture: "paste", hint: "Paste it or attach the exported file wherever you continue." },
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

export function provider(id: string): Provider {
  return BY_ID.get(id) ?? { id, label: id, kind: "chat", color: "#64748b", capture: "paste", hint: CHAT_HINT };
}

/** Places to continue (handoff destinations). */
export const TARGETS = PROVIDERS.filter((p) => p.kind !== "local");

/** Labels a pasted note can be tagged with. */
export const PASTE_SOURCES = PROVIDERS.filter((p) => p.kind !== "local" && p.capture !== "auto");

export const CAPTURE_LABEL: Record<CaptureMethod, string> = {
  auto: "Reads sessions automatically",
  export: "Import your data export, or paste",
  file: "Import its chat history file",
  paste: "Copy the chat, paste into Capture",
  none: "",
};
