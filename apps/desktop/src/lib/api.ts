// Typed wrappers over the Tauri commands in src-tauri/src/commands.rs.
import { invoke } from "@tauri-apps/api/core";

export type Role = "user" | "assistant" | "system" | "tool";
export type CaptureStatus = "complete" | "partial" | "unsupported" | "permissions-needed" | "failed";
export type Mode = "full" | "selected";
export type ToolDetail = "full" | "truncated" | "omit";
export type Level = "full" | "balanced" | "minimal";

export type Block =
  | { type: "text"; text: string }
  | { type: "toolCall"; name: string; input: string }
  | { type: "toolResult"; name: string | null; output: string; isError: boolean }
  | { type: "missing"; description: string }
  | { type: "file"; name: string; mediaType: string; sha256: string; size: number };

export interface Message {
  id: string;
  sourceId: string;
  role: Role;
  createdAt: string | null;
  blocks: Block[];
}

export interface OmittedCount {
  what: string;
  count: number;
}

export interface Source {
  sourceId: string;
  kind: string;
  provider: string;
  title: string;
  origin: string | null;
  project: string | null;
  model: string | null;
  capturedAt: string;
  captureStatus: CaptureStatus;
  missingItems: string[];
  omitted: OmittedCount[];
}

export interface Attachment {
  id: string;
  fileName: string;
  mediaType: string;
  size: number;
  sha256: string;
  originPath: string | null;
  text: string | null;
}

export interface Pack {
  schemaVersion: string;
  packId: string;
  title: string;
  version: number;
  createdAt: string;
  mode: Mode;
  sources: Source[];
  messages: Message[];
  context: { note: string | null };
  attachments: Attachment[];
  tags: string[];
}

export interface AdapterInfo {
  id: string;
  displayName: string;
  roots: string[];
  available: boolean;
}

export interface AppInfo {
  version: string;
  dataDir: string;
  platform: string;
  adapters: AdapterInfo[];
}

export interface DiscoveredRow {
  adapter: string;
  path: string;
  sessionId: string;
  title: string;
  project: string | null;
  model: string | null;
  modifiedAt: string;
  sizeBytes: number;
  messageCount: number;
  importedSourceId: string | null;
  importedAt: string | null;
  changedSinceImport: boolean;
}

export interface SourceRow {
  id: string;
  kind: string;
  provider: string;
  title: string;
  origin: string | null;
  project: string | null;
  model: string | null;
  capturedAt: string;
  captureStatus: CaptureStatus;
  messageCount: number;
  tokenEstimate: number;
  missingCount: number;
}

export interface CopyOutcome {
  packId: string;
  version: number;
  title: string;
  target: string;
  tokenEstimate: number;
  missing: number;
  findings: number;
}

export interface ImportOutcome {
  sourceId: string;
  duplicateOf: string | null;
}

export interface FilePreflight {
  path: string;
  name: string;
  size: number;
  mediaType: string;
  kind: "text" | "image" | "pdf" | "binary";
  accepted: boolean;
  duplicate: boolean;
  warnings: string[];
  error: string | null;
}

export interface PackRow {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  favorite: boolean;
  pinned: boolean;
  archived: boolean;
  latestVersion: number;
  messageCount: number;
  tokenEstimate: number;
  providers: string[];
  attachmentCount: number;
  tags: string[];
}

export interface RelationRow {
  fromPack: string;
  fromVersion: number | null;
  fromTitle: string | null;
  toPack: string;
  toVersion: number | null;
  toTitle: string | null;
  kind: "merged" | "split" | "duplicated";
  createdAt: string;
}

export interface MessageChange {
  id: string;
  role: Role;
  preview: string;
}

export interface PackDiff {
  fromVersion: number;
  toVersion: number;
  added: MessageChange[];
  removed: MessageChange[];
  changed: MessageChange[];
  unchanged: number;
  sourcesAdded: string[];
  sourcesRemoved: string[];
  filesAdded: string[];
  filesRemoved: string[];
  noteBefore: string | null;
  noteAfter: string | null;
  titleBefore: string | null;
  titleAfter: string | null;
}

export interface AuditReport {
  database: string;
  versionsChecked: number;
  versionProblems: string[];
  attachmentsChecked: number;
  attachmentProblems: string[];
}

export interface VersionRow {
  version: number;
  createdAt: string;
  label: string | null;
  mode: Mode;
  messageCount: number;
  tokenEstimate: number;
  contentHash: string;
}

export interface Finding {
  kind: string;
  preview: string;
  location: string;
}

export interface Preview {
  text: string;
  tokenEstimate: number;
  findings: Finding[];
  missing: { source: string; item: string }[];
  omitted: { source: string; item: string }[];
  attachManually: string[];
  unavailable: string[];
  messageCount: number;
}

export interface HandoffRow {
  id: string;
  packId: string;
  packTitle: string | null;
  version: number;
  target: string;
  method: string;
  status: string;
  createdAt: string;
}

export interface ActivityRow {
  kind: string;
  refId: string | null;
  detail: string;
  createdAt: string;
}

export interface Stats {
  sourceCount: number;
  packCount: number;
  attachmentCount: number;
  providerCount: number;
  capturesToday: number;
  handoffsTotal: number;
  handoffsToday: number;
  lastCaptureAt: string | null;
  lastHandoff: HandoffRow | null;
  storageBytes: number;
}

export interface SearchHit {
  kind: "source" | "pack" | "attachment";
  refId: string;
  title: string;
  snippet: string;
}

export type BuildItem =
  | { kind: "source"; id: string; messageIds?: string[] | null }
  | { kind: "attachment"; id: string }
  | { kind: "pack"; id: string; version?: number | null };

export interface BuildRequest {
  packId?: string | null;
  title: string;
  items: BuildItem[];
  note?: string | null;
  tags?: string[];
  label?: string | null;
}

export interface BrowserTarget {
  id: string;
  name: string;
  installed: boolean;
  registered: boolean;
  manifestPath: string;
}

export interface AdapterReport {
  adapterVersion: string | null;
  ok: boolean;
  messageCount: number;
  detail: string | null;
  testedAt: string;
}

export interface BrowserStatus {
  extensionId: string;
  extensionDir: string | null;
  firefoxExtensionDir: string | null;
  hostBinary: string | null;
  hostBinaryExists: boolean;
  browsers: BrowserTarget[];
  lastSeen: string | null;
  extensionVersion: string | null;
  adapters: Record<string, AdapterReport>;
}

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  showMainWindow: (route?: string) => invoke<void>("show_main_window", { route }),
  quit: () => invoke<void>("quit_app"),

  discoverSessions: () => invoke<DiscoveredRow[]>("discover_sessions"),
  importSession: (adapter: string, path: string) => invoke<ImportOutcome>("import_session", { adapter, path }),
  importText: (text: string, kind: "clipboard" | "manual", title?: string, label?: string) =>
    invoke<ImportOutcome>("import_text", { text, kind, title, label }),

  listChatExport: (path: string) =>
    invoke<{ provider: string; conversations: { id: string; title: string; updatedAt: string; messageCount: number }[] }>("list_chat_export", { path }),
  importChatExport: (path: string, ids: string[]) => invoke<ImportOutcome[]>("import_chat_export", { path, ids }),

  listSources: () => invoke<SourceRow[]>("list_sources"),
  getSource: (id: string) =>
    invoke<{ source: Source; messages: Message[]; tokenEstimate: number }>("get_source", { id }),
  deleteSource: (id: string) => invoke<void>("delete_source", { id }),

  preflightFiles: (paths: string[]) => invoke<{ files: FilePreflight[]; notes: string[] }>("preflight_files", { paths }),
  importFiles: (paths: string[]) => invoke<{ attachments: Attachment[]; errors: string[] }>("import_files", { paths }),
  listAttachments: () => invoke<Attachment[]>("list_attachments"),
  deleteAttachment: (id: string) => invoke<void>("delete_attachment", { id }),

  buildPack: (req: BuildRequest) => invoke<Pack>("build_pack", { req }),
  quickPackFromSession: (adapter: string, path: string) => invoke<Pack>("quick_pack_from_session", { adapter, path }),
  /** Render + clipboard + handoff record, all in Rust. Omitted options use the saved defaults. */
  copyPack: (id: string, version?: number | null, opts: { markdown?: boolean; target?: string; toolDetail?: ToolDetail; level?: Level } = {}) =>
    invoke<CopyOutcome>("copy_pack", { id, version, ...opts }),
  /** Capture a local agent session, build a pack and copy its handoff, in one call. */
  quickHandoff: (adapter: string, path: string) => invoke<CopyOutcome>("quick_handoff", { adapter, path }),
  /** Read the clipboard once and save it to the library. */
  captureClipboard: () => invoke<ImportOutcome & { chars: number }>("capture_clipboard"),
  listPacks: () => invoke<PackRow[]>("list_packs"),
  getPack: (id: string, version?: number | null) => invoke<{ pack: Pack; versions: VersionRow[] }>("get_pack", { id, version }),
  updatePack: (id: string, patch: { title?: string; favorite?: boolean; pinned?: boolean; archived?: boolean }) =>
    invoke<void>("update_pack", { id, patch }),
  deletePack: (id: string) => invoke<void>("delete_pack", { id }),
  duplicatePack: (id: string) => invoke<Pack>("duplicate_pack", { id }),
  restoreVersion: (id: string, version: number) => invoke<Pack>("restore_version", { id, version }),

  previewPack: (id: string, version: number | null, view: "markdown" | "prompt", toolDetail: ToolDetail, level: Level = "full") =>
    invoke<Preview>("preview_pack", { id, version, view, toolDetail, level }),
  suggestExportName: (id: string, version: number | null, ext: string) =>
    invoke<string>("suggest_export_name", { id, version, ext }),
  exportPack: (id: string, version: number | null, format: string, path: string, toolDetail: ToolDetail, level: Level = "full") =>
    invoke<string>("export_pack", { id, version, format, path, toolDetail, level }),
  importPackFile: (path: string) => invoke<Pack>("import_pack_file", { path }),
  recordHandoff: (packId: string, version: number, target: string, method: string, status: string) =>
    invoke<string>("record_handoff", { packId, version, target, method, status }),
  listHandoffs: (limit?: number) => invoke<HandoffRow[]>("list_handoffs", { limit }),
  recentActivity: (limit?: number) => invoke<ActivityRow[]>("recent_activity", { limit }),
  stats: () => invoke<Stats>("stats"),
  search: (query: string) => invoke<SearchHit[]>("search", { query }),

  getSettings: () => invoke<Record<string, unknown>>("get_settings"),
  setSetting: (key: string, value: unknown) => invoke<void>("set_setting", { key, value }),
  integrityCheck: () => invoke<string>("integrity_check"),
  wipeLibrary: () => invoke<void>("wipe_library"),

  browserStatus: () => invoke<BrowserStatus>("browser_status"),
  registerBrowserHost: (ids: string[]) => invoke<string[]>("register_browser_host", { ids }),
  unregisterBrowserHost: (ids: string[]) => invoke<string[]>("unregister_browser_host", { ids }),
  ollamaStatus: () => invoke<{ running: boolean; models: string[] }>("ollama_status"),
  ollamaSummarize: (id: string, version: number | null, model: string) => invoke<string>("ollama_summarize", { id, version, model }),

  diffVersions: (id: string, from: number, to: number) => invoke<PackDiff>("diff_versions", { id, from, to }),
  packRelations: (id?: string | null) => invoke<RelationRow[]>("pack_relations", { id: id ?? null }),
  setPackTags: (id: string, tags: string[]) => invoke<void>("set_pack_tags", { id, tags }),
  splitPack: (id: string, version: number | null, messageIds: string[], title: string) => invoke<Pack>("split_pack", { id, version, messageIds, title }),
  mergePacks: (ids: string[], title: string) => invoke<{ pack: Pack; duplicatesRemoved: number; notesCombined: number }>("merge_packs", { ids, title }),
  pullNewMessages: (id: string) => invoke<{ added: number; pack: Pack | null; skipped: string[] }>("pull_new_messages", { id }),
  auditLibrary: () => invoke<AuditReport>("audit_library"),
  importAiderHistory: (path: string) => invoke<ImportOutcome>("import_aider_history", { path }),
  openDropShelf: (packId: string) => invoke<void>("open_drop_shelf", { packId }),
  closeDropShelf: () => invoke<void>("close_drop_shelf"),
};

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
