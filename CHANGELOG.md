# Changelog

All notable changes to Hopilo will be documented in this file.

## 0.1.1

### Fixed

- **Handoff preview freeze**: Opening the handoff preview locked the library twice on the same thread and could hang the app. Rendering now runs outside the library lock.
- **Window close and tray click settings**: "Quit on close" and "Tray click opens dashboard" were ignored while a background sync was running. Settings are now read from an in-memory copy.
- **Search results**: Session search no longer drops matches when files or older packs fill the first results.
- **Restored sessions in search**: Sessions restored from Hidden, or brought back by importing a `.handoff` file, are searchable again and index every block, not only plain text.
- **Update downloads**: The update dialog now offers the installer for your operating system (`.dmg`, `.exe`/`.msi`, `.AppImage`/`.deb`) and never the browser-extension zip.
- **Session list filters**: Typing quickly in the search box no longer loses characters; list-view settings are saved after a short pause instead of on every keystroke.
- **Overview stats**: "Last capture" ignores hidden sessions, matching the other counts.
- **Duplicate files in folder imports**: A file picked both directly and through its folder is imported once.

### Security

- Library attachments are stored only under their verified SHA-256; a forged checksum can no longer pick the file name on disk.
- `open_url` opens only `http`, `https` and `mailto` links; `open_folder` opens folders only.
- Files opened from the library get names that are safe on Windows as well as macOS and Linux.
- The browser extension downloads chat files only from the sites it already has access to, with a 20 MB cap.
- The native messaging host replaces replies larger than the 1 MB browser limit with a clear error instead of dropping the connection.

### Changed

- The Browser page stops polling the connection status while the window is hidden.
- Root `pnpm test` and `pnpm typecheck` now cover the browser extension too.

## 0.1.0

### Added

- **Multi-Agent Coding Workspace**: Unified session explorer and manager for agent conversations across Claude Code, Gemini CLI, Cursor, Zed, Codex, Aider, OpenCode, and Antigravity.
- **Native Browser Extension**: In-browser capture and draft composer for Claude, Gemini, DeepSeek, Grok, and Perplexity web chats with local native messaging bridge.
- **Hidden Sessions & Safe Removal**: Soft-hide agent sessions from Hopilo without deleting filesystem files, with full restore capabilities and dedicated hidden session filtering.
- **Rich Markdown Viewer**: Built-in markdown renderer with syntax-highlighted code blocks, copy actions, GitHub-style alerts, task lists, and full line-break preservation.
- **Cross-Platform Desktop App**: High-performance Tauri v2 desktop application with system dark mode, keyboard navigation, and local SQLite search.
- **Bespoke App Iconography**: Signature duotone icons with glowing accent accents matching Hopilo's native design system.

### Fixed

- **Browser Extension Connection Accuracy**: Real-time heartbeat detection ensuring the app only displays "Connected" when the extension is actively communicating.
- **External Link Navigation**: Reliable system browser URL opening for updates, downloads, and external documentation.
- **Markdown Line Gap & Next Line**: Preserved paragraph line gaps and single line breaks across markdown messages and lists.

### Changed

- **Clean Open Source License**: Released under the Apache-2.0 license with standardized package metadata.

