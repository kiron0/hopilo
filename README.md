<p align="center">
  <img src="assets/hopilo-icon-1024.png" width="96" height="96" alt="Hopilo icon" />
</p>

<h1 align="center">Hopilo</h1>

<p align="center">
  <strong>Universal AI Session Handoff · Offline by Default & Local-First</strong><br />
  Every AI session in one place, with its files. Copy any of them, ready to paste into another AI.
</p>

<p align="center">
  <a href="https://github.com/kiron0/hopilo/actions/workflows/ci.yml"><img src="https://github.com/kiron0/hopilo/actions/workflows/ci.yml/badge.svg" alt="CI Status" /></a>
  <img src="https://img.shields.io/badge/Offline%20by%20Default-Local--First-22c55e" alt="Offline by default" />
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
- Previews images, PDFs, HTML and text inside Hopilo, with audio/video players and type-specific file cards. File menus offer Open, Download, Details and Delete for Hopilo-added files.
- Deletes individual or selected Hidden sessions from Hopilo, with confirmation. Sync can import them again while their configured agent source still exists.
- Previews the exact handoff text after selection and redaction. Keep individual messages and review changes before copying or exporting.
- Creates and verifies password-encrypted library backups from **Settings → Privacy & data**. Schedule local backups while Hopilo is running; unlock the schedule each app run.
- Lives in the menu bar: tap a recent session to copy it, or **Copy latest session** without opening anything.
- **Offline by Default & Local-First**: agent folders are only read locally, all your data stays stored on your device, and nothing is ever uploaded or synced to the cloud. Network access happens only when you click **Check for Updates** or **Sync limits**; model-limit sync downloads the models.dev catalog and public provider documentation.

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

### Sync context limits

Open **Settings → Customization → Model limits → Sync limits** while online.
Hopilo downloads the full [models.dev](https://models.dev) community catalog,
plus official documentation supplements from Anthropic, OpenAI, Google,
DeepSeek and xAI. Catalog providers and models are discovered from data, so new
entries do not need an app release. The catalog is community-maintained, not an
official universal source; its provenance is shown separately from official specs.
No API key is needed. No session content is sent. Sync runs only on request.

Parsed metadata and the sync report are saved in the local settings database and
work offline after restart. Conditional HTTP requests use ETag/Last-Modified when
available. Failed or malformed responses retain prior data. Removed models remain
available as stale records. The report lists added, changed, removed, retained and
invalid records by provider, source errors, check dates and successful sync dates.
Only models with valid text-output context limits are included; catalogs are not
exhaustive and API limits can differ from app/plan limits.

Choose any destination, search providers/models, then **Save destination budget**.
Lookup uses the exact provider and model ID, including version suffixes. No app name is used to guess a model;
unconfigured destinations show an unknown limit. A custom model can use a manual limit; unknown limits
stay explicitly unknown. Legacy saved model choices are migrated.

Resolution prefers a manual override, then fresh imported runtime metadata,
fresh official supplements, fresh catalog metadata, stale saved metadata, an exact
bundled-model estimate, or unknown. Reports imported by the user are labelled as
user-supplied, not independently verified official metadata. Conflicting sources
and stale metadata are surfaced. An app/plan cap can reduce any known limit.
Budgets reserve 20% by default, configurable as a percentage plus fixed tokens,
and respect separate published input caps. The reserve covers system prompts,
tools and replies; it does not attempt to predict the destination app's overhead.

**Import metadata** accepts a downloaded models.dev `api.json` for offline setup,
or a runtime report in this format (provider/model IDs must be explicit):

```json
{"models":[{"providerId":"my-provider","id":"my-model","window":128000,"inputLimit":120000}]}
```

Import validates before saving. Sync/import is serialized across windows. The
current official supplements cover Anthropic's comparison table, GPT-5, Gemini
2.5 Pro, DeepSeek's model table and xAI's text model table; the catalog provides
broad coverage beyond those supplements. Metadata older than 30 days, failed
sources and removed records are marked stale. Automatic live-agent metadata
collection is not performed; runtime metadata can be imported explicitly.
