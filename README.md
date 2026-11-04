# Hopilo

Move an AI conversation from one tool to another. Hopilo turns a chat or coding-agent session into a reviewable **Context Pack**, then copies it ready to paste into the next AI.

Local-first: no accounts, no network, and it never sends a message for you.

## Use

- **Menu bar** — one tap copies a handoff for a recent agent session or pack. Right-click › *Copy handoff for latest session* does it without opening anything.
- **Dashboard** — browse sessions, build packs from sessions, files and notes, review and export (`.md`, `.json`, `.txt`, `.handoff`).
- **Browser extension** — capture ChatGPT, Claude and Gemini chats, and insert a pack as an unsent draft.

Reads Claude Code, Codex CLI, Gemini CLI, OpenCode and Qwen Code sessions (read-only), plus ChatGPT and Claude data exports.

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
crates/database      SQLite library
crates/native-host   browser bridge
apps/desktop         Tauri shell (src-tauri) + React UI (src)
apps/extension       Chromium MV3 extension
assets/              logo sources and icon renderer
```

Full spec: [Hopilo_Product_Specification.md](Hopilo_Product_Specification.md).
