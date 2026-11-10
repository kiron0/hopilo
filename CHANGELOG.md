# Changelog

All notable changes to Hopilo will be documented in this file.

## 0.1.6

### Added

- **Hopilo Agent CLI (`hopilo`)**: Dedicated command-line tool (`crates/agent-cli`) providing read-only access to Hopilo sessions for coding agents and terminal workflows. Supports `hopilo sessions` with project filtering, text search, limit controls, and `--json` output, as well as `hopilo handoff <session-id>...` with configurable detail levels (`minimal`, `balanced`, `full`).
- **Model Context Protocol (MCP) Server**: Run `hopilo mcp` to serve the Model Context Protocol over stdio for Claude Code, Cursor, Codex, and other MCP clients. Exposes `search_sessions` and `prepare_handoff` tools with the user's secret redaction rules applied automatically.
- **Agent Access Settings & Granular Controls**: Added **Settings › Agent access** with a master access toggle and configurable permission modes: allow agents to read "All" saved sessions or only "Selected" sessions via an interactive multi-filter session picker with pagination. Hidden sessions and files on disk outside the Hopilo library are never exposed.
- **One-Click Agent MCP Configuration**: Settings displays ready-to-copy configuration commands and JSON snippets for Claude Code (`claude mcp add hopilo -- ...`), Cursor, and Codex, automatically resolving the installed `hopilo` binary path.
- **Desktop Sidecar Packaging**: Tauri build pipeline and `scripts/sidecar.mjs` automatically compile and bundle the `hopilo-agent-cli` executable alongside the desktop application across macOS, Windows, and Linux.

### Changed

- **Modular Session Filters UI**: Refactored filter selectors, dropdown hooks, and search options into a shared `SessionFilters` component reused across the main Sessions explorer and Agent Access settings.
- **Documentation Cleanup**: Cleaned up outdated architectural draft specifications and internal audit notes across the repository.

## 0.1.5

### Added

- **Destination context window limits**: Size suggestions use 80% of the destination model's window, with built-in defaults per destination, a per-destination model picker and manual limits in **Settings › Model limits**.
- **Focused catalog refresh**: **Refresh catalog** keeps only the providers behind Hopilo's destinations (Anthropic, OpenAI, Google, GitHub Copilot, DeepSeek, xAI, Perplexity, Alibaba, Moonshot AI), about 200 models instead of nearly 9,000. Saved catalogs are trimmed to the same providers on load.
- **Offline model limit defaults**: Preconfigured offline limits for Perplexity (`sonar-pro`), Qwen Code (`qwen3-coder-plus`), and Kimi CLI (`kimi-k3.1-pro`).
- **In-app file previewer**: Built-in preview modal and components supporting multi-format files including PDF documents, audio and video playback, and formatted text/code files via bounded IPC chunk streaming.
- **Rich markdown, code syntax highlighting & Mermaid diagrams**: Enhanced markdown rendering with syntax-highlighted code blocks, copy actions, language tags, and interactive Mermaid diagram rendering across session transcripts and file previews.
- **Source capture timestamps**: Preserves and exposes the original `captured_at` timestamp when loading session sources from the database.
- **Markdown prose skeleton**: Added animated prose skeleton loading state while markdown content is being parsed and rendered.
- **Code syntax highlighting in file preview**: Supported syntax highlighting for standalone source code files in the file preview modal.
- **Encrypted library backups & retention**: Password-encrypted, authenticated `.hopilo-backup` archive creation and restoration with customizable background auto-backup schedules, retention policies, and integrity checks in **Settings › Backups**.
- **Cross-platform Node.js build & release tooling**: Migrated automation scripts to Node.js ESM (`scripts/build.mjs`, `scripts/bump-version.mjs`, `scripts/clean.mjs`, `scripts/ship.mjs`, `sidecar.mjs`), ensuring reliable build, versioning, and installation flows across macOS, Windows, and Linux.

### Fixed

- **Copilot default model**: GitHub Copilot CLI and VS Code Copilot default to the Copilot catalog model `github-copilot/gpt-5.6-sol` instead of an OpenAI ID Copilot does not list.
- **Sidebar zero-count badge suppression**: Hides the count badge on the right side of sidebar navigation items when the count is zero, showing numbers only when items are present.
- **Atomic file writes**: Backend commands use temporary file buffering and atomic replacement to prevent partial writes and corrupted states during unexpected interruptions.
- **WebGL context recovery**: Added WebGL context loss handling and automatic shader/canvas recreation in the animated header background (`Flow`), preventing black banners after system sleep or GPU resets.
- **Settings synchronization**: Reactive updates in React hooks ensure preference and configuration changes propagate immediately across windows, quick panel, and background workers.
- **Browser extension stream capping**: Added bounded reading for attachments and drafts in the browser extension to avoid high memory spikes and unresponsiveness on large payloads.
- **Vite bundle chunk size warnings**: Adjusted chunk size warning limits in Vite build configuration to accommodate rich syntax highlighting and diagram rendering bundles.

### Changed

- **Markdown and syntax highlighting in Rust**: A new `crates/rich` parses Markdown (pulldown-cmark, with GFM tables, task lists, footnotes and math) and highlights code (syntect) off the UI thread. This replaces react-markdown, remark, rehype and Shiki with its WebAssembly engine, shrinking the bundled UI from 16 MB to 12 MB and 276 files to 167; the app binary stays about the same size (34.8 MB) because the grammar pack moves into Rust. PowerShell code blocks now show as plain text.
- **Lighter fonts**: Only Latin and Latin Extended font subsets ship, and KaTeX loads WOFF2 only; other scripts use the system font.
- **Settings icons**: The Settings sidebar uses a gear for General, a palette for Customization and the coding-agent icon for Sources.
- **Optimized model limits caching**: Simplified destination model limits with indexed SQLite queries, local caching, and faster search retrieval.
- **Codebase comment cleanup**: Cleaned up internal commentary and developer comments across Rust crates, TypeScript modules, and release scripts.

## 0.1.4

### Added

- **macOS menu-bar popover notch & dynamic anchor arrow**: Quick panel features a unified SVG popover shape with smooth bezier shoulders and a rounded arrow tip pointing directly to the active menu-bar status item on macOS, with the animated mist background shader flowing seamlessly into the arrow.
- **Session pin indicators in Quick Panel**: Pinned sessions display a dedicated accent pin icon in the quick panel session list for immediate visual confirmation.
- **Session comparison view**: Compare two sessions side-by-side to inspect differing file edits, contrasting conclusions, and message/token statistics.
- **Handoff intents & model-specific formatting**: Configurable handoff goals (continue execution, peer review, executive summary, custom templates) with tailored prompt structures for target models like Claude and ChatGPT.
- **Custom privacy & secret redaction rules**: Add user-defined regex patterns, keyword blacklists, and file path exclusion rules with inline ignore controls in the preflight scan.
- **Instant global handoff shortcut**: Configured global keyboard shortcut (`Cmd+Shift+H` / `Ctrl+Shift+H`) to capture and copy the latest session to clipboard with tray feedback.
- **Standalone offline HTML export**: Export any session into a single-file, zero-dependency dark-themed HTML transcript with collapsible tool calls and syntax highlighting.
- **Searchable session picker & pagination**: Fast session selector modal with keyboard navigation, search filtering, pagination controls, and key-based toast tracking.
- **Animated splash screen and startup sequence**: Introduced a dedicated startup sequence and splash screen with animated brand mark, floating halo, glowing ambient pulse, and smooth fade-in reveal into the dashboard.
- **Dark mode animated header background**: Added a rich dark palette (`DARK_PLUME`) with deep indigo, purple, and midnight tones to the `Flow` component, enabling the animated background plume on the Overview header card in dark mode.
- **Automated signing build runner**: Added cross-platform build script `scripts/build.mjs` that automatically detects local updater signing keys, manages signing environment variables, and enables seamless local and CI builds.
- **Windows installer & high-DPI Linux icons**: Configured `installerIcon` for Windows NSIS so downloaded setup `.exe` files display the Hopilo icon in Windows Explorer, and added standard `64x64` and `512x512` icon assets to Linux AppImage and Debian packages.

### Fixed

- **Quick panel hook rendering crash**: Fixed a React Error Boundary crash (`Rendered more hooks than during previous render`) in the quick panel caused by hook definitions placed after conditional readiness checks.
- **Scrollable page bottom gap & sidebar alignment**: Standardized bottom padding across Overview, Settings, Browser, and Compare pages to 24px, perfectly matching the sidebar's bottom stats card and removing trailing whitespace gaps.
- **Full-height empty comparison state**: Wrapped the session comparison view in a full-height container so the empty state canvas fills the viewport consistently with the rest of the application.
- **Overview header plume overflow**: Bounded the animated background strictly within the header card using inherited border-radius, strict inset containment, `contain: paint`, and WebKit mask clipping, eliminating corner bleeding or blur spill into adjacent elements.
- **Secure file and bundle opening**: Library files matching executable extensions are revealed in the operating system's file manager rather than directly executed. Project directory bundles (`.app`, `.pkg`, `.workflow`) are revealed rather than launched when opened from the dashboard.
- **Export path privacy**: Strips machine-specific local paths from exported Context Packs so user file structures and usernames are never shared with external AI targets.
- **Extension message isolation**: Content scripts running in web pages are restricted to fetching requested drafts and recording completion status, preventing web pages from invoking library management commands.
- **Attachment collision & digest normalization**: Normalizes uppercase SHA-256 digests in attachments and writes temporary blob parts with process IDs to prevent write collisions between the desktop app and native browser host.
- **Unicode session title slicing**: Replaced byte slicing with unicode character iteration when deriving default session names in Antigravity and Claude Code adapters, preventing slice panics on multibyte characters.

### Changed

- **Desktop bundle code splitting & lazy loading**: Lazy-loaded the Command Palette on first demand and dynamically imported window surface roots (`QuickPanel`, `Welcome`, `App`), reducing initial script parse time and memory footprint.
- **Interactive cursor consistency**: Applied global pointer cursor styling across all interactive elements including buttons, tabs, switches, menu items, checkboxes, radio inputs, and clickable labels.
- **Solid dark theme overhaul**: Replaced glassy and translucent surfaces throughout the app with solid, high-contrast dark surfaces. Updates sidebar navigation items, bottom stats disk, quick panel, welcome window, settings swatches, bubble discs, buttons, and skeleton loaders.
- **Settings appearance thumbnails**: Hardcoded dark and system appearance preview swatches with authentic dark background styling regardless of the active app mode.

## 0.1.3

### Added

- **Settings… in the menu-bar menu**: Opens the dashboard straight to Settings.
- **Welcome window**: Shown once on first launch, near the top center of the screen you're on. It explains that Hopilo lives in the menu bar (system tray on Windows and Linux) and offers quick setup for launch at login, icon click, and appearance. **Get Started** opens the menu-bar panel.

### Fixed

- **Menu-bar app model**: Hopilo now lives in the menu bar (system tray on Windows and Linux). Launching it no longer opens the dashboard; open the dashboard or Settings from the menu-bar icon, and it always opens centered on the screen you're on. Closing the dashboard keeps Hopilo running in the menu bar or tray on every OS. On macOS the Dock icon appears only while the dashboard is open, and relaunching Hopilo from Finder or Spotlight shows the quick panel. Use **Quit Hopilo** to exit fully.
- **macOS launch permissions**: Automatic session sync no longer probes files inside protected Desktop, Documents, or Downloads folders, preventing Files & Folders prompts from blocking the dashboard.
- **Antigravity project grouping**: Sessions now derive their workspace from shared editor-document metadata, so files under paths such as `apps/desktop/src/pages` group under the `hopilo` project without triggering macOS protected-folder permission prompts.
- **Agent file capture and image gallery**: Antigravity now imports files from its `USER_INPUT.media` records instead of dropping them. Session images appear as gallery thumbnails and open in an in-app preview instead of the system image viewer.
- **Clean and ship scripts**: Cleanup now accepts native and cross-target bundle paths, while shipping regenerates the required sidecar before Rust validation. Root package version now stays synchronized during version bumps.
- **Only one Hopilo runs at a time**: Launching another copy (for example a GitHub release next to a local build) now shows the running Hopilo's menu-bar panel instead of adding a second icon. Launch at login now follows the copy you run, so an old install no longer starts at login. `ship.sh` stops every running copy by bundle id before installing, points launch at login to the new install, and warns about other installed copies.
- **Settings cleanup**: Removed display-only rows (closing behavior, Linux tray, delivery). Launch at login switches instantly, and turning it off removes the login item. Shortcut hints and tray wording now match each OS.
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

