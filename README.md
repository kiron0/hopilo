# Hopilo

Universal AI Session Handoff — *Keep your context moving.*

Hopilo captures the user-visible context of work in one AI tool and turns it into a portable, reviewable **Context Pack** you can continue with in another. It is local-first: no accounts, no network requests, and it never sends a message for you.

See [Hopilo_Product_Specification.md](Hopilo_Product_Specification.md) for the full product specification.

## Status: Phase 1 (local-first MVP), macOS first

Built so far:

- **Tray / menu-bar app** with a Quick Panel (capture clipboard, continue a recent coding-agent session, copy a recent pack) and a full dashboard window.
- **Local agent readers** (read-only): Claude Code (`~/.claude/projects`), Codex CLI (`~/.codex/sessions`), Gemini CLI (`~/.gemini/tmp`) and OpenCode (`~/.local/share/opencode/opencode.db`, opened read-only). Hidden reasoning, injected system context and sub-agent messages are left out and counted; compacted/encrypted history is reported as missing.
- **Chat app data exports**: import selected conversations from a ChatGPT or Claude.ai export (`.zip` or `conversations.json`).
- **30+ AI tools as destinations** (ChatGPT, Claude, Gemini, Grok, DeepSeek, Perplexity, Copilot, Le Chat, Meta AI, Qwen, Kimi, Z.ai, Cursor, Windsurf, GitHub Copilot, Antigravity, Kiro, Trae and more), and pasted chats can be tagged with the AI they came from.
- **Manual, clipboard and file/folder import** with a preflight review (type, size, duplicates, credential-file warnings) before anything is stored.
- **Local library**: SQLite + FTS5 search, content-addressed attachment store, duplicate detection.
- **Builder**: drag sessions, packs and files onto a canvas (keyboard-accessible), reorder, add notes, choose specific messages (Selected mode), save immutable versions.
- **Packs & Versions**: preview as handoff prompt or Markdown, sensitive-data warnings, missing-item report, restore any version as a new version, duplicate, archive, pin.
- **Handoff**: copy a destination-ready prompt (recorded as *copied*, never *delivered*), open the destination, export `.md`, `.json`, prompt `.txt`, or a verified `.handoff` archive; import `.handoff`/`.json` back.
- **Menu-bar panel and Drop Shelf** use transparent windows for native-style rounded corners, which needs Tauri's `macOSPrivateApi` (fine for direct downloads, not allowed in the Mac App Store).
- **Settings**: launch at login, startup surface, close-to-tray, tray click, theme, defaults, storage tools.

## Phase 2: browser capture and draft injection

- **Extension** (`apps/extension`, Manifest V3, Chromium browsers): captures ChatGPT, Claude and Gemini conversations (code blocks, lists, links and tables kept as Markdown), scrolls up to load older messages, and reports a capture as *partial* when anything may be missing. The popup inserts a pack into the open chat's message box as an **unsent draft**; if that fails it copies to the clipboard instead. Packs dragged from the Hopilo app onto a supported chat show a **Drop Context Here** zone.
- **Native messaging host** (`crates/native-host`, binary `hopilo-native-host`): length-prefixed JSON over stdio, serves only the pinned extension ID `fgddcclgflboboacjmfdkkpgdbaolleo`, and writes to the same local library.
- **Desktop › Browser** page: connect Chrome, Chrome Beta, Chromium, Edge, Brave, Arc or Vivaldi (writes one host manifest per browser), plus extension status and per-site health.
- **Context levels**: Full, Balanced (every request word for word, earlier replies shortened, the last 12 messages in full, key references) and Minimal (goal, latest exchange, key references). All extracted, never generated.
- **Size guide** on every preview, and optional **Ollama** summaries (local only) that are saved as a note in a new version, never replacing the transcript.

Load the extension: `pnpm --filter @hopilo/extension build`, then `chrome://extensions` › Developer mode › Load unpacked › `apps/extension/dist`. Then Hopilo › Browser › Connect.

Not yet: Firefox, Windows host registration, bundling `hopilo-native-host` inside the installed app, Context Map, Drop Shelf, CLI/MCP, packaging tests (Phases 3–4).

## Layout

```text
crates/core          domain types, deterministic Markdown/prompt rendering, secret scan
crates/adapters      read-only session readers (Claude Code, Codex, Gemini CLI, OpenCode) and chat-export parsers
crates/pack-format   Markdown/JSON export, .handoff archive write/verify/read
crates/database      SQLite migrations, library, versions, search
crates/native-host   browser bridge (native messaging host)
apps/extension       Chromium MV3 extension (capture + draft injection)
apps/desktop         Tauri 2 shell (src-tauri) + React/TypeScript UI (src)
fixtures/            anonymized session fixtures used by tests
assets/              placeholder icon source and generator
```

## Develop

Requirements: Rust (stable), Node 22+, pnpm 10.

```bash
pnpm install
pnpm dev          # runs the desktop app (Tauri + Vite)
pnpm test         # cargo tests + frontend unit tests
pnpm typecheck
```

Opening `http://localhost:1420` in a normal browser while `pnpm dev` runs shows the UI with sample data (dev-only IPC mock in `apps/desktop/src/dev`).

Library data lives in the OS app-data folder (`~/Library/Application Support/dev.hopilo.desktop` on macOS).

## Notes

- `dev.hopilo.desktop` is an illustrative identifier, not a registered domain.
- The app icon in `assets/` is an original placeholder drawn to the spec's direction; replace it with the production icon.
- The name "Hopilo" still needs trademark, domain and store-name clearance.
