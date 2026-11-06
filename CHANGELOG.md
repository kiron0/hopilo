# Changelog

All notable changes to Hopilo will be documented in this file.

## 0.1.3

### Added

- **Settings… in the menu-bar menu**: Opens the dashboard straight to Settings.

### Fixed

- **Menu-bar app model**: Hopilo now lives in the menu bar (system tray on Windows and Linux). Launching it no longer opens the dashboard, except once on first launch as a welcome; open the dashboard or Settings from the menu-bar icon. On macOS the Dock icon appears only while the dashboard is open, and relaunching Hopilo from Finder or Spotlight shows the quick panel. Use **Quit Hopilo** to exit fully.
- **macOS launch permissions**: Automatic session sync no longer probes files inside protected Desktop, Documents, or Downloads folders, preventing Files & Folders prompts from blocking the dashboard.
- **Antigravity project grouping**: Sessions now derive their workspace from shared editor-document metadata, so files under paths such as `apps/desktop/src/pages` group under the `hopilo` project without triggering macOS protected-folder permission prompts.
- **Agent file capture and image gallery**: Antigravity now imports files from its `USER_INPUT.media` records instead of dropping them. Session images appear as gallery thumbnails and open in an in-app preview instead of the system image viewer.
- **Clean and ship scripts**: Cleanup now accepts native and cross-target bundle paths, while shipping regenerates the required sidecar before Rust validation. Root package version now stays synchronized during version bumps.
- **Faster, safer library access**: Checking dropped files no longer locks the library while each file is read and hashed. Library stats use indexed queries instead of scanning tables and the attachments folder. Stored-file commands reject anything but a SHA-256 name. Hidden windows hold refreshes until shown, and refreshes no longer reuse a request started before the change.
- **Browser file downloads**: The extension stops reading a file as soon as it passes the size limit, even when the server sends no size.
- **Passwordless local installs**: Local shipping installs macOS builds under the user Applications folder and Windows NSIS builds per-user, avoiding administrator-password and UAC prompts.

### Changed

- **Quick panel footer redesign**: Redesigned "Open Hopilo" and "Quit" into a cohesive toolbar docked at the bottom of the card with solid surfaces and balanced spacing, eliminating transparent backgrounds and awkward layout gaps.
- **Copy controls**: Session details now keep target and conciseness controls inside the Copy modal, which opens with the defaults saved in Settings while remaining editable for that copy.
- **Smoother interface and lower background usage**: Duplicate data loads are coalesced, focus syncs are throttled, file previews load near the viewport, transcript search work is delayed until typing pauses, and animated backgrounds pause while hidden and render at a lower frame rate.
- **Stable navigation and loading**: Removed staggered page reveals and route-shell remounts, moved fitted-row measurement before paint, and kept browser/app metadata from reloading after unrelated library changes.
- **Debounced search**: Session lists, conversation transcripts, quick panel, imports, and command palette now delay expensive filtering or database searches until typing pauses.

## 0.1.2

### Added

- **In-App Updater**: Integrated Tauri updater plugin for automated background update checks, download progress tracking, and signed in-app installations.
- **Automated Release Workflows**: Added updater manifest generation (`latest.json`), signing pipeline, and release staging scripts.

### Changed

- **Streamlined Update Dialog**: Removed release notes and changelog display from the update modal to keep update alerts clean, lightweight, and focused on download and install status.

### Fixed

- **Windows console-window loop**: Browser status checks now run Windows Registry commands with `CREATE_NO_WINDOW`, preventing repeated console windows when opening or revisiting sidebar pages.

## 0.1.1

### Added

- **Handoff preflight analysis & secret redaction**: Interactive copy and export dialog that scans transcripts for API keys and credentials, supports secret exclusion and redaction, and displays real-time token and message conciseness across Full, Balanced, and Minimal levels.
- **Folder grouping & open folder**: Sessions grouped by workspace folder include an "Open folder" button and a folder checkbox to select or deselect the whole project group.
- **Infinite scroll transcript**: Transcripts load continuously as you scroll with collapsible tool calls and thoughts, removing pagination buttons and layout jumps.
- **Session grouping and layout options**: Multi-mode grouping by folder, provider, date, or model, with view options and layout choices saved across restarts.
- **Windows native host registration**: Windows Registry integration registers the native messaging host for Chrome and Edge with automated Windows CI release support.
- **Monochrome provider filter icons**: Session list tool filter dropdown uses monochrome provider icons while retaining brand colors elsewhere in the app.
- **Overview skeleton loaders**: Stat cards display theme-safe skeleton loading states while initial data is being fetched.

### Fixed

- **Handoff preview freeze**: Opening the handoff preview locked the library twice on the same thread and could hang the app. Rendering now runs outside the library lock.
- **Antigravity session location**: Workspace root detection places Antigravity sessions in their project folder instead of the `pages/` directory.
- **Window close and tray click settings**: "Quit on close" and "Tray click opens dashboard" were ignored while a background sync was running. Settings are now read from an in-memory copy.
- **Search results**: Session search no longer drops matches when files or older packs fill the first results.
- **Restored sessions in search**: Sessions restored from Hidden, or brought back by importing a `.handoff` file, are searchable again and index every block, not only plain text.
- **Update downloads**: The update dialog now offers the installer for your operating system (`.dmg`, `.exe`/`.msi`, `.AppImage`/`.deb`) and never the browser-extension zip.
- **Session list filters**: Typing quickly in the search box no longer loses characters; list-view settings are saved after a short pause instead of on every keystroke.
- **Overview stats**: "Last capture" ignores hidden sessions, matching the other counts.
- **Duplicate files in folder imports**: A file picked both directly and through its folder is imported once.
- **Windows compilation under strict warnings**: Test expansion variables are underscored to satisfy compiler checks under `-D warnings` on Windows.

### Security

- Library attachments are stored only under their verified SHA-256; a forged checksum can no longer pick the file name on disk.
- `open_url` opens only `http`, `https` and `mailto` links; `open_folder` opens folders only.
- Files opened from the library get names that are safe on Windows as well as macOS and Linux.
- The browser extension downloads chat files only from the sites it already has access to, with a 20 MB cap.
- The native messaging host replaces replies larger than the 1 MB browser limit with a clear error instead of dropping the connection.

### Changed

- **Native transcript rendering**: Removed markdown parsing dependencies in favor of lightweight native text rendering for faster scrolling and smaller bundle size.
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

