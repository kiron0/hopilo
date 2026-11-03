// Browser-only preview: when the UI runs outside Tauri (plain `pnpm dev` in a
// browser), answer IPC calls with sample data so screens can be reviewed.
// Never loaded inside the desktop app.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

const now = Date.now();
const ago = (min: number) => new Date(now - min * 60_000).toISOString();

const source = (id: string, provider: string, title: string, min: number, status = "complete", missing = 0) => ({
  id,
  kind: provider === "clipboard" ? "clipboard" : "local-agent",
  provider,
  title,
  origin: null,
  project: "/work/devdock",
  model: provider === "codex" ? "gpt-5.5-codex" : "claude-opus-4-5",
  capturedAt: ago(min),
  captureStatus: status,
  messageCount: 42,
  tokenEstimate: 18_400,
  missingCount: missing,
});

const SOURCES = [
  source("s1", "claude-code", "DevDock architecture review", 2),
  source("s2", "codex", "Add pagination to GET /v1/orders", 90, "partial", 1),
  source("s3", "clipboard", "Auth migration decisions", 60 * 26),
  { ...source("s4", "deepseek", "Pricing model brainstorm", 60 * 30), kind: "manual" },
  { ...source("s5", "chatgpt", "Postgres index advice", 60 * 50), kind: "chat-export" },
];

const PACKS = [
  { id: "p1", title: "DevDock architecture handoff", createdAt: ago(10), updatedAt: ago(2), favorite: true, pinned: true, archived: false, latestVersion: 3, messageCount: 58, tokenEstimate: 22_000, providers: ["claude-code", "codex"], attachmentCount: 2, tags: ["backend"] },
  { id: "p2", title: "API strategy", createdAt: ago(1500), updatedAt: ago(1440), favorite: false, pinned: false, archived: false, latestVersion: 1, messageCount: 12, tokenEstimate: 4_100, providers: ["clipboard"], attachmentCount: 0, tags: [] },
  { id: "p3", title: "Auth migration — QA", createdAt: ago(400), updatedAt: ago(300), favorite: false, pinned: false, archived: false, latestVersion: 1, messageCount: 18, tokenEstimate: 6_200, providers: ["gemini-cli"], attachmentCount: 1, tags: ["qa"] },
  { id: "p4", title: "Pricing model brainstorm", createdAt: ago(2400), updatedAt: ago(2300), favorite: false, pinned: false, archived: false, latestVersion: 2, messageCount: 34, tokenEstimate: 11_000, providers: ["deepseek"], attachmentCount: 0, tags: [] },
  { id: "p5", title: "Trust score fixes", createdAt: ago(900), updatedAt: ago(800), favorite: false, pinned: false, archived: false, latestVersion: 4, messageCount: 140, tokenEstimate: 48_000, providers: ["opencode"], attachmentCount: 3, tags: ["backend"] },
];

const DISCOVERED = [
  { adapter: "claude-code", path: "/mock/a.jsonl", sessionId: "a", title: "Fix the failing login test", project: "/work/demo-app", model: "claude-opus-4-5", modifiedAt: ago(4), sizeBytes: 482_000, messageCount: 96, importedSourceId: null, importedAt: null, changedSinceImport: false },
  { adapter: "codex", path: "/mock/b.jsonl", sessionId: "b", title: "Add pagination to GET /v1/orders", project: "/work/api", model: "gpt-5.5-codex", modifiedAt: ago(95), sizeBytes: 120_000, messageCount: 31, importedSourceId: "s2", importedAt: ago(90), changedSinceImport: true },
  { adapter: "gemini-cli", path: "/mock/c.jsonl", sessionId: "c", title: "Why does the build fail on CI?", project: "/work/killx", model: "gemini-3-pro", modifiedAt: ago(300), sizeBytes: 40_000, messageCount: 12, importedSourceId: null, importedAt: null, changedSinceImport: false },
  { adapter: "opencode", path: "/mock/opencode.db#ses_1", sessionId: "ses_1", title: "Fix trust score", project: "/work/ext", model: "glm-5.2", modifiedAt: ago(900), sizeBytes: 9_000_000, messageCount: 140, importedSourceId: null, importedAt: null, changedSinceImport: false },
  ...Array.from({ length: 9 }, (_, i) => ({ adapter: "claude-code", path: `/mock/cc${i}.jsonl`, sessionId: `cc${i}`, title: `Claude Code session ${i + 2}`, project: "/work/hopilo", model: "claude-opus-4-5", modifiedAt: ago(1000 + i * 60), sizeBytes: 90_000, messageCount: 20 + i, importedSourceId: null, importedAt: null, changedSinceImport: false })),
];

const MESSAGES = [
  { id: "m1", sourceId: "s1", role: "user", createdAt: ago(30), blocks: [{ type: "text", text: "Review the SwiftUI architecture in `Sources/DevDock` and list risks." }] },
  { id: "m2", sourceId: "s1", role: "assistant", createdAt: ago(29), blocks: [{ type: "text", text: "I'll read the module layout first." }, { type: "toolCall", name: "Bash", input: '{\n  "command": "ls Sources/DevDock"\n}' }] },
  { id: "m3", sourceId: "s1", role: "tool", createdAt: ago(29), blocks: [{ type: "toolResult", name: "Bash", output: "App/\nFeatures/\nServices/", isError: false }] },
];

const PREVIEW = {
  text: "I'm continuing work that started in another AI session…\n\n<context_pack>\n# DevDock architecture handoff\n…\n</context_pack>",
  tokenEstimate: 22_000,
  findings: [{ kind: "Email address", preview: "dev@••••••••", location: "m1" }],
  missing: [{ source: "Add pagination", item: "1 compaction(s): earlier history is stored encrypted or summarized by Codex and could not be recovered" }],
  omitted: [{ source: "DevDock", item: "37 × hidden reasoning (thinking) blocks" }],
  attachManually: ["diagram.png"],
  unavailable: [],
  messageCount: 58,
};

export function installMockIpc() {
  mockWindows("main");
  // `?mockDelay=1500` slows every call so loading states can be inspected.
  const delay = Number(new URLSearchParams(location.search).get("mockDelay") ?? 0);
  mockIPC(async (cmd) => {
    if (delay && cmd !== "get_settings" && !cmd.startsWith("plugin:")) await new Promise((r) => setTimeout(r, delay));
    switch (cmd) {
      case "get_settings":
        return { onboarded: false };
      case "stats":
        return { sourceCount: 3, packCount: 2, attachmentCount: 2, providerCount: 3, capturesToday: 1, handoffsTotal: 8, handoffsToday: 2, lastCaptureAt: ago(2), lastHandoff: { id: "h1", packId: "p1", packTitle: "DevDock architecture handoff", version: 3, target: "chatgpt", method: "clipboard", status: "copied", createdAt: ago(5) }, storageBytes: 3_400_000 };
      case "list_sources":
        return SOURCES;
      case "discover_sessions":
        return DISCOVERED;
      case "list_packs":
        return PACKS;
      case "list_attachments":
        return [{ id: "a1", fileName: "requirements.md", mediaType: "text/markdown", size: 4200, sha256: "5c12ab34cd56ef7890", originPath: null, text: "# Req" }];
      case "get_source":
        return { source: { sourceId: "s1", kind: "local-agent", provider: "claude-code", title: "DevDock architecture review", origin: null, project: "/work/devdock", model: "claude-opus-4-5", capturedAt: ago(2), captureStatus: "complete", missingItems: [], omitted: [{ what: "hidden reasoning (thinking) blocks", count: 37 }] }, messages: MESSAGES, tokenEstimate: 18_400 };
      case "get_pack":
        return { pack: { schemaVersion: "1.0.0", packId: "p1", title: "DevDock architecture handoff", version: 3, createdAt: ago(2), mode: "full", sources: [], messages: MESSAGES, context: { note: null }, attachments: [], tags: [] }, versions: [3, 2, 1].map((v) => ({ version: v, createdAt: ago(v * 30), label: v === 1 ? null : "Edited in Builder", mode: "full", messageCount: 58, tokenEstimate: 22_000, contentHash: "abc" })) };
      case "preview_pack":
        return PREVIEW;
      case "list_handoffs":
        return [{ id: "h1", packId: "p1", packTitle: "DevDock architecture handoff", version: 3, target: "chatgpt", method: "clipboard", status: "copied", createdAt: ago(5) }];
      case "list_chat_export":
        return { provider: "chatgpt", conversations: [{ id: "c1", title: "Postgres index advice", updatedAt: ago(3000), messageCount: 2 }] };
      case "browser_status":
        return {
          extensionId: "fgddcclgflboboacjmfdkkpgdbaolleo",
          extensionDir: "/work/hopilo/apps/extension/dist",
          hostBinary: "/work/hopilo/target/debug/hopilo-native-host",
          hostBinaryExists: true,
          browsers: [
            { id: "chrome", name: "Google Chrome", installed: true, registered: true, manifestPath: "" },
            { id: "edge", name: "Microsoft Edge", installed: false, registered: false, manifestPath: "" },
            { id: "brave", name: "Brave", installed: true, registered: false, manifestPath: "" },
          ],
          lastSeen: ago(3),
          extensionVersion: "0.1.0",
          adapters: { claude: { adapterVersion: "claude-web@1", ok: true, messageCount: 42, detail: null, testedAt: ago(3) }, chatgpt: { adapterVersion: "chatgpt-web@1", ok: false, messageCount: 0, detail: "No messages were found on this page.", testedAt: ago(60) } },
        };
      case "ollama_status":
        return { running: true, models: ["llama3.2:3b", "qwen2.5:7b"] };
      case "pack_relations":
        return [
          { fromPack: "p1", fromVersion: 3, fromTitle: "DevDock architecture handoff", toPack: "p3", toVersion: 1, toTitle: "Auth migration — QA", kind: "split", createdAt: ago(400) },
          { fromPack: "p5", fromVersion: 4, fromTitle: "Trust score fixes", toPack: "p1", toVersion: 2, toTitle: "DevDock architecture handoff", kind: "merged", createdAt: ago(300) },
        ];
      case "diff_versions":
        return { fromVersion: 2, toVersion: 3, added: [{ id: "m9", role: "user", preview: "Add a /health route" }], removed: [], changed: [{ id: "m2", role: "assistant", preview: "I'll read the module layout first." }], unchanged: 56, sourcesAdded: ["Fix trust score"], sourcesRemoved: [], filesAdded: [], filesRemoved: [], noteBefore: null, noteAfter: "Focus on the auth service first.", titleBefore: null, titleAfter: null };
      case "app_info":
        return { version: "0.1.0", dataDir: "~/Library/Application Support/dev.hopilo.desktop", platform: "macos", adapters: [{ id: "claude-code", displayName: "Claude Code", roots: ["~/.claude/projects"], available: true }, { id: "codex", displayName: "Codex CLI", roots: ["~/.codex/sessions"], available: true }, { id: "gemini-cli", displayName: "Gemini CLI", roots: ["~/.gemini/tmp"], available: true }, { id: "opencode", displayName: "OpenCode", roots: ["~/.local/share/opencode"], available: true }] };
      case "plugin:event|listen":
        return 1;
      default:
        return null;
    }
  });
}
