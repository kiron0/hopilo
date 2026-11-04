# Hopilo

Every AI session in one app. Hopilo keeps your conversations from coding agents and chat apps, with the files shared in them, and copies any of them, ready to paste into another AI.

Local-first: no accounts, no network, no AI inside the app, and it never sends a message for you.

## Use

- **Sessions**: Claude Code, Codex CLI, Gemini CLI, OpenCode and Qwen Code sessions appear on their own and stay in step with their files (read-only). Web chats come in through the extension; pasted text, ChatGPT/Claude data exports, files and `.handoff` archives through **Add**.
- **Copy**: one click puts a session on the clipboard for the AI you continue in. Pick Full, Balanced or Minimal (fixed rules, no summarizing model). Select several sessions to copy them together, or export `.md`, `.json`, `.txt` or `.handoff` (with files).
- **Menu bar**: tap a recent session to copy it. Right-click › *Copy latest session* does it without opening anything.
- **Browser extension**: save ChatGPT, Claude and Gemini chats (DeepSeek, Grok and Perplexity experimentally) with their files, and insert a session into the chat box as an unsent draft.

## Develop

Rust (stable), Node 22+, pnpm 10.

```bash
pnpm install
pnpm dev          # desktop app (Tauri + Vite)
pnpm test         # Rust + frontend tests
pnpm typecheck
```

Extension: `pnpm --filter @hopilo/extension build`, load `apps/extension/dist` unpacked in Chrome, then Hopilo › Browser › Connect.

Icons: edit the SVGs in `assets/logo/`, run `python3 assets/make_icons.py` (needs `cargo install resvg`), then `pnpm --dir apps/desktop tauri icon assets/hopilo-icon-1024.png`.

## Layout

```text
crates/core          types, rendering, secret scan
crates/adapters      session readers and chat-export parsers
crates/pack-format   exports and .handoff archives
crates/database      SQLite library (sessions, files, copy history)
crates/native-host   browser bridge
apps/desktop         Tauri shell (src-tauri) + React UI (src)
apps/extension       Chromium MV3 extension
assets/              logo sources and icon renderer
```

Full spec: [Hopilo_Product_Specification.md](Hopilo_Product_Specification.md).
