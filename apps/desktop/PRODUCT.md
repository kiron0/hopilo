# Product

## Platform

web

(Tauri 2 desktop app rendering a React web UI. macOS first: the design follows Mac conventions such as the menu-bar icon and Quick Panel. Windows and Linux must work but may look plainer.)

## Users

Developers who move coding work between AI tools — Claude Code, Codex CLI, Gemini CLI, OpenCode, Cursor and similar agents, plus chat apps such as ChatGPT, Claude, Gemini, Grok and DeepSeek. Typical moment: they hit a usage limit or want a second opinion mid-task and need the next AI to pick up the project without re-explaining the goal, decisions, errors, file paths and next steps. The UI may assume developer vocabulary (session, project folder, tool call, repo), but every screen should still be quick to understand.

## Product Purpose

Hopilo captures the user-visible context of work in one AI tool and turns it into a portable, reviewable Context Pack that can be continued in another. Success: the user continues in a different AI without retyping project history, and trusts what was transferred because they could see every message, what was missing, and any secrets before sharing.

## Positioning

Local-first and verifiable rather than a black-box summary: raw sessions are read read-only and kept unchanged, packs are deterministic and versioned, missing or omitted content is stated explicitly, and Hopilo never sends a message for the user — it copies or exports a draft and the user presses send.

## Operating Context

- Lives in the macOS menu bar; the Quick Panel handles one-tap "copy handoff" for a recent session, the full window handles review, building and history.
- Reads local agent session stores: `~/.claude/projects`, `~/.codex/sessions`, `~/.gemini/tmp`, `~/.local/share/opencode/opencode.db`.
- Imports ChatGPT and Claude.ai account data exports; other chat apps come in by copy and paste.
- Delivery is clipboard or file (`.md`, `.json`, prompt `.txt`, `.handoff` archive). Opening a destination never claims delivery.
- Product specification: `../../Hopilo_Product_Specification.md` (phased roadmap: browser extension, summarizers, Context Map, Drop Shelf, CLI/MCP, team sharing come later).

## Capabilities and Constraints

- Distribution: free and open source. Open decision: which license (crates currently say `UNLICENSED`).
- No accounts, analytics, telemetry or network requests; captures happen only on an explicit user action — no background clipboard or window watching.
- Agent session files and exports are never modified. Immutable pack versions; restoring creates a new version.
- The Quick Panel and Drop Shelf are transparent windows (for rounded corners), which needs Tauri `macOSPrivateApi`; that excludes a Mac App Store build. No vibrancy/glass is used.
- Terminology: Session (a conversation found or captured), Capture (bringing one in), Pack / Context Pack (shareable bundle with versions), Handoff (copy or export to continue elsewhere).
- Production bundle identifier: `io.coreify.hopilo`.

## Brand Commitments

- Name written exactly "Hopilo" (pronounced HOP-ee-lo). Promise: "Keep your context moving." Subtitle: "Universal AI Session Handoff."
- App icon direction from the spec: rounded square, blue-to-indigo/violet, two message bubbles joined by transfer arrows. The current icon in `../../assets/` is a placeholder.
- Third-party provider names are identity labels only; no provider logos are used.

## Evidence on Hand

None yet: no users, testimonials, benchmarks or press. Do not fabricate any. Real local session data exists only on the developer's machine and must not be shipped as sample content.

## Product Principles

1. Show exactly what will be shared before it is shared; never a summary the user cannot check.
2. The user sends; Hopilo prepares. Copied and exported are never reported as delivered.
3. Say what is missing or left out, every time.
4. Everything works offline and stays on the device unless the user exports it.
5. Fast path first: one action from "I hit a limit" to "ready to paste".

## Accessibility & Inclusion

Every primary workflow must work without drag and drop (keyboard equivalents), respect reduced motion, keep visible focus, and meet WCAG AA contrast in light and dark.
