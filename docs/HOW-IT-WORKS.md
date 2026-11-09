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

The copy/export dialog opens an **Exact preview** using the same backend preparation and renderer as the output. **Select messages** keeps individual turns, identified by both source and message ID; files referenced only by removed turns are removed too. The preview updates after options settle, and Copy/Export waits for it. A SHA-256 check rejects execution when the reviewed text has changed. Token counts remain estimates. Preview text is capped at 4 MiB; choose fewer sessions/messages or a shorter text level for larger handoffs. JSON and bundles preserve the selected normalized turns independently of the text level; bundle preview shows normalized JSON, not the ZIP bytes or binary contents. The HTML viewer honors text level and tool-detail settings, and includes handoff notes.

## Conversation and files

Conversations load 40 turns initially and append 40 more as you scroll. **Load more messages** also works with keyboard navigation or when intersection observation is unavailable. Earlier turns stay mounted; deep-search navigation expands through the matching turn. Text highlighting remains bounded, and content visibility reduces painting for offscreen messages. Very deep jumps can still mount many turns.

The **Files** tab uses type-specific cards/icons. Images show local thumbnails; PDFs render a first page through the bundled PDF.js engine; HTML gets a sandboxed static thumbnail. Audio/video show their own icons and open with native webview player controls. Click a card or **⋯ → Open** to preview inside Hopilo. PDFs have page and zoom controls, text is readable in-app, and unsupported binary types show a hex prefix. No preview action launches another application. **⋯ → Download** opens a save dialog; **Details** shows metadata. PDF.js, its worker, fonts, character maps and decoder assets ship locally and use no CDN.

Preview reads use bounded 1 MiB IPC chunks from regular, hash-named files in library attachment storage. Full image/PDF/media previews cap at 64 MiB; thumbnails cap at 8 MiB, text/HTML show at most 2 MiB, and binary previews show 4 KiB. Offscreen thumbnail viewers unload; object URLs, PDF workers/render tasks and media sources are released when closed. Media codecs depend on the platform webview; unsupported formats show an in-app error. Password-protected PDFs currently report the PDF engine's password-required error. HTML is static: an opaque sandbox and restrictive content policy disable scripts, forms, network resources and external navigation; active elements/attributes are stripped before rendering. See [iframe sandbox behavior](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox) and [PDF.js rendering examples](https://mozilla.github.io/pdf.js/examples/).

**⋯ → Delete** appears only for files recorded as added through Hopilo **Add files**. Backend ownership checks are independent of hashes and filenames. Deletion clears the matching upload reference, removes its message when empty, and refreshes counts/search/export data. Other files, original files, shared blobs, other sessions and saved snapshots stay intact. Recorded manual uploads survive sync. Older files without recorded ownership remain protected because their origin cannot be reliably inferred.

In **Hidden**, use a row's **Permanently delete** button, open a hidden session and use its delete action, or select sessions across pages and use **Permanently delete N sessions**. Confirmation explains that the operation cannot be undone. The backend validates the entire hidden-only batch before deleting anything, then commits atomically. Original agent files, shared blobs and saved snapshots remain. Deletion removes the stored session from Hopilo. If its configured agent source still exists, the next sync can discover and import it again. With no available/configured source there is nothing to re-import. To stop a session returning, remove its original source yourself or disable/remove the source configuration; Hopilo never deletes original agent files. Earlier sync-block records are discarded during migration.

## Encrypted library backups

Open **Settings → Privacy & data → Encrypted library backups**. Enter and repeat a password of at least 12 characters, then **Create encrypted backup** to save a `.hbackup` file. It includes a consistent SQLite snapshot (sessions, history and settings), plus all content-addressed attachment blobs, including blobs retained by immutable snapshots. It does not include original agent folders, separate recovery backups or native browser-registration files.

To restore, choose a backup, enter its password and click **Verify backup**. Restore becomes available after verification. Confirming restore re-verifies the file, then saves and verifies an encrypted recovery backup in the library's `recovery/` folder using that same password before replacing the DB. The result shows the recovery path. Attachment blobs are copied before the SQLite online restore, old blobs are retained, settings reload, and any backup schedule locks. A saved shortcut that cannot register on this machine is cleared. Quit other Hopilo instances before restoring. Supported older DB schemas migrate in a private temporary copy; newer schemas are rejected. Source agent files remain untouched and subsequent syncs can refresh their sessions again.

For scheduling, choose an existing writable local folder, an interval of 1–168 hours, enter/repeat the password and click **Unlock schedule**. The first backup is due immediately (checked every 30 seconds), then repeats at the interval while this app process stays open. There is no closed-app background service. Folder and interval persist; the password stays in memory for this app run and is dropped on **Lock schedule**, restore or process exit. Use **Refresh status** to see the latest scheduled result. Backups use unique filenames and are retained until you remove them yourself; plan destination space accordingly.

Format version 1 uses a 32-byte random salt, PBKDF2-HMAC-SHA256 (600,000 iterations) and AES-256-GCM from `ring`. Independently authenticated 1 MiB records bind the header, sequence index and length; an authenticated terminal record rejects truncation, reordering and appended bytes. The encrypted ZIP manifest records SHA-256 hashes and sizes. Verification checks safe paths, duplicates, limits, every checksum, attachment references, SQLite integrity and foreign keys. Limits: 20 GiB of decrypted archive/extracted content and 200,000 ZIP entries. Creation verifies the complete encrypted artifact before atomically replacing the destination. Temporary plaintext uses private temporary storage and is removed on normal completion; a process or machine crash can leave temporary files behind. The active library itself remains ordinary local SQLite/files. Keep the password safely: Hopilo cannot recover it.

## Browser extension

### Import ChatGPT or Claude account data

Open **Sessions › Add › Import ChatGPT / Claude data**. Select your account export `.zip` or its `conversations.json`, select conversations across pages, then click **Import**. The original export is only read. Already saved conversations are reused. ChatGPT imports follow the active conversation branch; unavailable attachments are marked as missing.

Account exports are streamed one conversation at a time (1 GiB total input limit). Individual documents, decompressed records and selected import batches are limited to 64 MiB; split larger selections into smaller batches. Import lists show 25 conversations per page, transcripts append 40 messages at a time, and deep search reveals the matching turn.

The extension saves Claude and Gemini chats (DeepSeek, Grok and Perplexity experimentally) and can insert a session into a chat box as an unsent draft. ChatGPT conversations are supported through account data export imports; the extension currently has no ChatGPT adapter. It talks only to `hopilo-native-host`, a small bridge shipped inside the app bundle and registered per browser from **Browser › Connect**. The bridge accepts messages only from Hopilo's extension ID.

The quick panel keeps its clipped popover shape and transparent gutter. Its outer SVG has no drop-shadow, the shell has no box-shadow, and native window shadows are disabled in configuration and reasserted off before showing. Resize observation starts after bootstrap mounts the panel so the clip follows its actual dimensions. Inner control/logo shadows remain inside the panel.

## In-app updates

**Settings › About › Check for Updates** reads the signed `latest.json` manifest from the newest GitHub Release. When an update is available, Hopilo downloads it in the app, shows progress, verifies the Tauri signature, installs it and restarts. GitHub hosts the files but users are not sent to the browser.

The public verification key is pinned in `apps/desktop/src-tauri/tauri.conf.json`. The matching private key is local at `apps/desktop/.tauri/hopilo.key`, is ignored by Git, and must be backed up securely. Before publishing, add its full contents as the `TAURI_SIGNING_PRIVATE_KEY` repository secret:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < apps/desktop/.tauri/hopilo.key
```

Losing or replacing that key prevents installed copies from accepting future updates. The release workflow signs the platform updater artifacts, publishes them with `latest.json`, and fails if an artifact or signature is missing.

## Build and release

Rust (stable), Node 22+, pnpm 10.

```bash
pnpm install
pnpm dev          # desktop app (Tauri + Vite); also builds the bridge sidecar
pnpm test         # Rust + desktop tests
pnpm typecheck
pnpm build        # release bundle for this machine
pnpm clean        # remove generated bundles; keep dependencies, keys and app data
pnpm ship         # verify, build, stop, install and relaunch native bundle for this OS
```

`pnpm ship` follows the QuitX local-release loop. It detects macOS, Linux or Windows, selects that OS's `.app`, `.AppImage` or NSIS installer, stops the current Hopilo process, replaces only the installed application, launches the new build and verifies the process started. It never removes Hopilo's app-data directory, so the SQLite library and settings survive reinstall/update.

`apps/desktop/scripts/sidecar.mjs` builds `hopilo-native-host` and places it in `src-tauri/binaries/` for Tauri's `externalBin` (a lipo'd universal binary for `universal-apple-darwin`).

Extension: `pnpm --filter @hopilo/extension build`, then load `apps/extension/dist` unpacked in Chrome (or `dist-firefox` as a temporary add-on in Firefox).

Icons: edit the SVGs in `assets/logo/`, run `python3 assets/make_icons.py` (needs `cargo install resvg`), then `pnpm --dir apps/desktop tauri icon assets/hopilo-icon-1024.png`.

CI (`.github/workflows/ci.yml`) runs clippy with warnings denied, all Rust tests on macOS and Linux, and typecheck, tests and builds for the desktop UI and the extension. Running the **Release** workflow (manual dispatch, `.github/workflows/release.yml`) builds signed macOS (universal), Linux and Windows updater bundles, publishes `latest.json`, and builds the extension archives.

File thumbnails use type-specific icons and local image/PDF/HTML previews (up to 8 MiB), plus silent video frames (up to 64 MiB). File bodies and media remain behind a fixed-size skeleton until loaded/decoded; failures show an error or type fallback. Full media previews stay local and keep playback controls. Password inputs in encrypted-backup settings include independent accessible Show/Hide toggles; visibility does not change or persist the password.
