import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

const now = Date.now();
const ago = (min: number) => new Date(now - min * 60_000).toISOString();

const session = (id: string, provider: string, kind: string, title: string, min: number, extra: Record<string, unknown> = {}) => ({
  id,
  kind,
  provider,
  title,
  origin: kind === "local-agent" ? `/mock/${id}.jsonl` : null,
  project: kind === "local-agent" ? "/work/devdock" : null,
  model: provider === "codex" ? "gpt-5.5-codex" : provider === "claude-code" ? "claude-opus-4-5" : null,
  updatedAt: ago(min),
  captureStatus: "complete",
  messageCount: 42,
  tokenEstimate: 18_400,
  missingCount: 0,
  fileCount: 0,
  pinned: false,
  tags: [] as string[],
  lastCopiedAt: null as string | null,
  ...extra,
});

const SESSIONS = [
  session("s1", "claude-code", "local-agent", "DevDock architecture review", 2, { pinned: true, fileCount: 2, tags: ["backend"], lastCopiedAt: ago(10) }),
  session("s2", "codex", "local-agent", "Add pagination to GET /v1/orders", 90, { captureStatus: "partial", missingCount: 1 }),
  session("s3", "antigravity", "local-agent", "Hopilo architecture review", 300, { fileCount: 1 }),
  session("s4", "claude", "browser-chat", "Auth migration decisions", 60 * 26),
  session("s5", "deepseek", "manual", "Pricing model brainstorm", 60 * 30),
  session("s6", "gemini-cli", "local-agent", "Why does the build fail on CI?", 60 * 40),
  session("s7", "claude", "chat-export", "Trip planning", 60 * 50),
  ...Array.from({ length: 9 }, (_, i) => session(`cc${i}`, "claude-code", "local-agent", `Claude Code session ${i + 2}`, 60 * 60 + i * 60, { project: "/work/hopilo" })),
];

const MESSAGES = [
  { id: "m1", sourceId: "s1", role: "user", createdAt: ago(30), blocks: [{ type: "text", text: "Review the SwiftUI architecture in `Sources/DevDock` and list risks." }] },
  { id: "m2", sourceId: "s1", role: "assistant", createdAt: ago(29), blocks: [{ type: "text", text: "I'll read the module layout first." }, { type: "toolCall", name: "Bash", input: '{\n  "command": "ls Sources/DevDock"\n}' }] },
  { id: "m3", sourceId: "s1", role: "tool", createdAt: ago(29), blocks: [{ type: "toolResult", name: "Bash", output: "App/\nFeatures/\nServices/", isError: false }] },
];

export function installMockIpc() {
  mockWindows("main");

  const delay = Number(new URLSearchParams(location.search).get("mockDelay") ?? 0);
  const pins = new Map<string, boolean>();
  mockIPC(async (cmd, args) => {
    const a = (args ?? {}) as Record<string, any>;
    if (delay && cmd !== "get_settings" && !cmd.startsWith("plugin:")) await new Promise((r) => setTimeout(r, delay));
    switch (cmd) {
      case "get_settings":
        return { onboarded: false };
      case "stats":
        return { sourceCount: SESSIONS.length, pinnedCount: 1, attachmentCount: 3, providerCount: 6, capturesToday: 1, handoffsTotal: 8, handoffsToday: 2, lastCaptureAt: ago(2), lastHandoff: null, storageBytes: 3_400_000 };
      case "sync_sessions":
        return { added: 0, updated: 0, failed: 0, found: SESSIONS.length, busy: false };
      case "list_sessions":
        return SESSIONS.map((r) => ({ ...r, pinned: pins.get(r.id) ?? r.pinned })).sort((x, y) => Number(y.pinned) - Number(x.pinned));
      case "update_session":
        if (typeof a.patch?.pinned === "boolean") pins.set(a.id, a.patch.pinned);
        return null;
      case "preflight_handoff":
        return {
          title: "DevDock architecture review",
          totalMessages: 42,
          totalTokens: 182_400,
          findings: [
            { kind: "Anthropic API key", preview: "sk-a••••••••", location: "m2", fingerprint: "aa11", count: 2, custom: false },
            { kind: "Email address", preview: "kiro••••••••", location: "m3", fingerprint: "bb22", count: 1, custom: false },
            { kind: "Internal token", preview: "acme••••••••", location: "m3", fingerprint: "cc33", count: 1, custom: true },
          ],
          ruleErrors: [],
          excludedFiles: ["server.pem"],
          sourceCount: (a.ids ?? []).length || 1,
          full: { messageCount: 42, tokenEstimate: 182_400 },
          balanced: { messageCount: 18, tokenEstimate: 61_200 },
          minimal: { messageCount: 3, tokenEstimate: 4_900 },
        };
      case "builtin_redaction_kinds":
        return ["Private key", "Anthropic API key", "OpenAI-style API key", "GitHub token", "AWS access key", "Google API key", "Slack token", "JWT", "Connection string", "Secret assignment", "Email address"];
      case "test_redaction_rule": {
        try {
          const re = new RegExp(a.pattern, "g");
          return { matches: String(a.sample ?? "").match(re) ?? [], error: null };
        } catch (e) {
          return { matches: [], error: String(e) };
        }
      }
      case "set_global_shortcut":
      case "copy_latest":
        return null;
      case "compare_sessions": {
        const side = (id: string, title: string, provider: string, extra: Record<string, unknown>) => ({
          id, title, provider, model: provider === "codex" ? "gpt-5.5-codex" : "claude-opus-4-5", project: "/work/devdock",
          messageCount: 42, userTurns: 6, assistantTurns: 14, toolCalls: 31, toolErrors: 2, tokenEstimate: 18_400,
          startedAt: ago(180), endedAt: ago(90), editedFiles: ["src/api/orders.ts", "src/db/query.ts"], mentionedFiles: ["src/api/orders.ts", "package.json"],
          commands: ["pnpm test", "pnpm lint"], errors: ["TypeError: cursor is undefined"], firstRequest: "Add cursor pagination to GET /v1/orders.", finalReply: "Done. Cursor pagination is in place and tests pass.", ...extra,
        });
        return {
          a: side(a.a, "Add pagination to GET /v1/orders", "claude-code", {}),
          b: side(a.b, "Pagination attempt (Codex)", "codex", { toolCalls: 18, toolErrors: 0, editedFiles: ["src/api/orders.ts", "src/api/paginate.ts"], commands: ["pnpm test", "pnpm vitest run orders"], errors: [], finalReply: "Implemented offset pagination with a helper." }),
          sameProject: true, sharedEdits: ["src/api/orders.ts"], onlyAEdits: ["src/db/query.ts"], onlyBEdits: ["src/api/paginate.ts"], sharedCommands: ["pnpm test"],
          commonPrompts: 2, divergeAt: 2, aPromptAtDiverge: "Use cursors, not offsets.", bPromptAtDiverge: "Keep it simple, offsets are fine.",
        };
      }
      case "get_session":
        return {
          row: SESSIONS[0],
          source: { sourceId: "s1", kind: "local-agent", provider: "claude-code", title: "DevDock architecture review", origin: "/mock/s1.jsonl", project: "/work/devdock", model: "claude-opus-4-5", capturedAt: ago(2), captureStatus: "complete", missingItems: [], omitted: [{ what: "hidden reasoning (thinking) blocks", count: 37 }] },
          messages: [...MESSAGES, { id: "m4", sourceId: "s1", role: "user", createdAt: ago(20), blocks: [{ type: "file", name: "diagram.png", mediaType: "image/png", sha256: "f1", size: 182_000 }] }],
          files: [
            { id: "a1", fileName: "diagram.png", mediaType: "image/png", size: 182_000, sha256: "f1", originPath: null, text: null },
            { id: "a2", fileName: "requirements.md", mediaType: "text/markdown", size: 4200, sha256: "f2", originPath: null, text: "# Req" },
          ],
          tokenEstimate: 18_400,
        };
      case "copy_sessions":
        return { ids: ["s1"], title: "DevDock architecture review", target: "claude", tokenEstimate: 18_400, missing: 0, findings: 1, attach: ["diagram.png"] };
      case "capture_clipboard":
        return { sourceId: "s9", duplicateOf: null, chars: 1240 };
      case "list_handoffs":
        return [{ id: "h1", packId: "s1", packTitle: "DevDock architecture review", version: 0, target: "claude", method: "clipboard", status: "copied", createdAt: ago(5) }];
      case "list_chat_export":
        return { provider: "claude", conversations: [{ id: "c1", title: "Postgres index advice", updatedAt: ago(3000), messageCount: 2 }] };
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
          adapters: { claude: { adapterVersion: "claude-web@1", ok: true, messageCount: 42, detail: null, testedAt: ago(3) }, gemini: { adapterVersion: "gemini-web@1", ok: true, messageCount: 12, detail: null, testedAt: ago(15) } },
        };
      case "app_info":
        return { version: "0.1.0", dataDir: "~/Library/Application Support/io.coreify.hopilo", platform: "macos", adapters: [{ id: "antigravity", displayName: "Antigravity", roots: ["~/.gemini/antigravity/brain"], available: true }, { id: "claude-code", displayName: "Claude Code", roots: ["~/.claude/projects"], available: true }, { id: "codex", displayName: "Codex CLI", roots: ["~/.codex/sessions"], available: true }, { id: "gemini-cli", displayName: "Gemini CLI", roots: ["~/.gemini/tmp"], available: true }, { id: "opencode", displayName: "OpenCode", roots: ["~/.local/share/opencode"], available: true }] };
      case "plugin:event|listen":
        return 1;
      default:
        return null;
    }
  });
}
