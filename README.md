<p align="center">
  <img src="assets/hopilo-icon-1024.png" width="96" height="96" alt="Hopilo icon" />
</p>

<h1 align="center">Hopilo</h1>

<p align="center">
  <strong>Universal AI Session Handoff · 100% Offline & Local-First</strong><br />
  Every AI session in one place, with its files. Copy any of them, ready to paste into another AI.
</p>

<p align="center">
  <a href="https://github.com/kiron0/hopilo/actions/workflows/ci.yml"><img src="https://github.com/kiron0/hopilo/actions/workflows/ci.yml/badge.svg" alt="CI Status" /></a>
  <img src="https://img.shields.io/badge/100%25%20Offline-Local--First-22c55e" alt="100% Offline" />
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-black?logo=tauri" alt="macOS, Windows, Linux" />
  <img src="https://img.shields.io/badge/Rust-stable-orange?logo=rust" alt="Rust" />
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri" alt="Tauri 2" />
</p>

<p align="center">
  <a href="https://github.com/kiron0/hopilo/releases/latest">
    <img src="https://img.shields.io/github/v/release/kiron0/hopilo?label=Download%20Hopilo&style=for-the-badge&color=6D5BF5&labelColor=1a1a1a" alt="Download Hopilo" height="38" />
  </a>
</p>

---

<p align="center">
  <img src="docs/screenshots/overview.jpg" width="100%" alt="Hopilo overview: 1,227 sessions from Codex, Antigravity, VS Code Copilot, Claude Code, OpenCode and Zed" />
</p>

## Features

- Finds sessions from Claude Code, Codex CLI, Gemini CLI, Qwen Code, Antigravity, Cursor and Cursor CLI, VS Code Copilot Chat, Copilot CLI, Cline, Roo Code, Kilo Code, Factory Droid, Pi, Kimi CLI, Goose, OpenCode and Zed, and keeps them in step with their files.
- Copies any session as one handoff message for the AI you continue in: Full, Balanced or Minimal, by fixed rules, with no summarizing model.
- Combines several sessions into one copy, or exports `.md`, `.txt`, `.json` or `.handoff` (with files and checksums).
- Saves Claude and Gemini web chats with the browser extension (DeepSeek, Grok and Perplexity experimentally) and inserts a session into a chat box as an unsent draft. ChatGPT conversations can be imported from account data exports.
- Imports pasted text, ChatGPT and Claude data exports, Aider history, files and `.handoff` archives.
- Warns about keys, tokens and emails before you paste anything.
- Lives in the menu bar: tap a recent session to copy it, or **Copy latest session** without opening anything.
- **100% Offline & Local-First**: agent folders are only read locally, all your data stays stored on your device, and nothing is ever uploaded or synced to the cloud. The only network touchpoint is the manual **Check for Updates** button.

## How it works

Session sources and their paths, sync, the library, exports, the browser bridge, and how to build and release live in [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md).

## Install

Get the latest build from [Releases](https://github.com/kiron0/hopilo/releases/latest).

**macOS**

1. Open the `.dmg` and drag **Hopilo** into Applications.
2. Open Hopilo. If macOS says it can't verify the app, go to **System Settings › Privacy & Security** and click **Open Anyway**.
3. Hopilo starts in the menu bar. Click its icon, or set **Settings › On launch, show** to **Overview** to open the window at launch.

**Windows**: run the `.msi` or `.exe` installer. If SmartScreen appears, choose **More info › Run anyway**.

**Linux**: install the `.deb`, or mark the `.AppImage` executable and run it.

**Browser extension** (optional): unzip `hopilo-extension-chrome-<version>.zip` from the same release, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the folder. Then in Hopilo open **Browser › Connect**. Firefox: load `hopilo-extension-firefox-<version>.zip` from `about:debugging`.

More in [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md#build-and-release).

Support development: [Buy me a coffee](https://buymeacoffee.com/_thk).

## License

Licensed under the [Apache License, Version 2.0](LICENSE).

© [Toufiq Hasan Kiron](https://github.com/kiron0). All rights reserved.
