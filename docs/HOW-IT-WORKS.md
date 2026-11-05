# How Hopilo works

Hopilo is a Tauri 2 desktop app (Rust core, React UI) plus a browser extension. Everything stays on your machine: the library is a SQLite file, agent folders are only ever read, and the only network request the app makes is the update check you start from Settings.

## Layout

```text
crates/core          types, rendering (handoff prompt / Markdown), secret scan
crates/adapters      session readers for every coding agent, chat-export parsers
crates/pack-format   .md / .json / .txt exports and .handoff archives
crates/database      SQLite library: sessions, files, copy history, full-text search
crates/native-host   stdio bridge the browser extension talks to
apps/desktop         Tauri shell (src-tauri) and React UI (src)
apps/extension       Chromium MV3 / Firefox extension
assets/              logo sources and icon renderer
```

## Session sources

Each agent is an adapter (`crates/adapters`) that lists sessions under its folders and turns one into normalized messages. Files are opened read-only; SQLite stores are opened with `SQLITE_OPEN_READ_ONLY`.

| Agent | Where Hopilo looks (macOS paths; Linux and Windows equivalents are checked too) |
| --- | --- |
| Claude Code | `~/.claude/projects`, `~/.config/claude/projects`, `$CLAUDE_CONFIG_DIR` |
| Codex CLI | `~/.codex/sessions`, `~/.codex/archived_sessions` (`.jsonl` and zstd `.jsonl.zst`), titles from `session_index.jsonl`, `$CODEX_HOME` |
| Gemini CLI / Qwen Code | `~/.gemini/tmp`, `~/.qwen/tmp` |
| Antigravity | `~/.gemini/antigravity`, `antigravity-ide` and `antigravity-cli` brain folders |
| OpenCode | `~/.local/share/opencode/opencode.db` (both the `session` and the newer `session_v2` stores) |
| Cursor | `Cursor/User/globalStorage/state.vscdb` (legacy inline chats and the current per-message records) |
| Cursor CLI | `~/.cursor/chats/*/*/store.db` |
| VS Code Copilot Chat | `Code`, `Code - Insiders`, `VSCodium`: `workspaceStorage/*/chatSessions`, `globalStorage/emptyWindowChatSessions` |
| GitHub Copilot CLI | `~/.copilot/session-state`, `~/.copilot/history-session-state` |
| Cline, Roo Code, Kilo Code | `globalStorage/<extension>/tasks` in any VS Code-family editor, `~/.cline/data/tasks` |
| Factory Droid, Pi, Kimi CLI, Goose | `~/.factory/sessions`, `~/.pi/agent/sessions`, `~/.kimi/sessions`, `~/.local/share/goose/sessions` |
| Zed | `Zed/threads/threads.db` |
| Aider | `.aider.chat.history.md`, imported from **Add** |

What a reader leaves out (hidden reasoning, injected system reminders, sub-agent side chains) is counted and shown on the session, never silently dropped. A session that was only partly recoverable is marked **Partial** with the reason.

## Sync

Sync runs at launch, whenever a Hopilo window gains focus, and from the refresh button on **Sessions**.

1. Each source root is fingerprinted (file names, sizes, modification times). Unchanged roots reuse the last listing.
2. Inside a changed root, only files whose size or modification time changed are parsed again, spread over all CPU cores. A warm sync of ~1,200 sessions takes tens of milliseconds.
3. The same conversation found under two roots (for example Antigravity's app and IDE builds) is listed once, keeping the newest copy.
4. New or changed sessions are written to the library. The list fills in while a long first import runs instead of waiting for it to finish.

Background syncs skip if one is already running; the refresh button waits for it, checks again, and reports what changed. A title you set yourself is kept when the agent's file changes.

## Library

`~/Library/Application Support/io.coreify.hopilo/` (or the platform equivalent) holds `hopilo.db` and an `attachments/` folder addressed by SHA-256. Commands that read or render large sessions run off the UI thread, and **Settings › Verify** runs on its own read-only connection so the app stays responsive. Before a schema migration the library is copied to `hopilo.db.before-vN`; only the newest copy is kept.

## Copying and exports

Copy renders a session into one handoff message for the AI you continue in. **Full**, **Balanced** and **Minimal** are fixed rules, not a summarizing model. Tool output can be kept, trimmed or left out. Every copy is scanned for likely secrets (keys, tokens, emails) and warns before you paste. Exports: `.md`, `.txt`, `.json`, and `.handoff` (a zip with the normalized conversation, its files and SHA-256 checksums, verified on import).

## Browser extension

The extension saves ChatGPT, Claude and Gemini chats (DeepSeek, Grok and Perplexity experimentally) and can insert a session into a chat box as an unsent draft. It talks only to `hopilo-native-host`, a small bridge shipped inside the app bundle and registered per browser from **Browser › Connect**. The bridge accepts messages only from Hopilo's extension ID.

## Build and release

Rust (stable), Node 22+, pnpm 10.

```bash
pnpm install
pnpm dev          # desktop app (Tauri + Vite); also builds the bridge sidecar
pnpm test         # Rust + desktop tests
pnpm typecheck
pnpm build        # release bundle for this machine
```

`apps/desktop/scripts/sidecar.mjs` builds `hopilo-native-host` and places it in `src-tauri/binaries/` for Tauri's `externalBin` (a lipo'd universal binary for `universal-apple-darwin`).

Extension: `pnpm --filter @hopilo/extension build`, then load `apps/extension/dist` unpacked in Chrome (or `dist-firefox` as a temporary add-on in Firefox).

Icons: edit the SVGs in `assets/logo/`, run `python3 assets/make_icons.py` (needs `cargo install resvg`), then `pnpm --dir apps/desktop tauri icon assets/hopilo-icon-1024.png`.

CI (`.github/workflows/ci.yml`) runs clippy with warnings denied, all Rust tests on macOS and Linux, and typecheck, tests and builds for the desktop UI and the extension. Running the **Release** workflow (manual dispatch, `.github/workflows/release.yml`) builds macOS (universal), Linux and Windows bundles and the extension archives.
