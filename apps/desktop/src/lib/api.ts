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

export interface SessionRow {
  id: string;

  kind: string;
  provider: string;
  title: string;
  origin: string | null;
  project: string | null;
  model: string | null;
  updatedAt: string;
  captureStatus: CaptureStatus;
  messageCount: number;
  replyCount: number;
  tokenEstimate: number;
  missingCount: number;
  fileCount: number;
  pinned: boolean;
  tags: string[];
  lastCopiedAt: string | null;
  hidden?: boolean;
}

export interface SessionDetail {
  row: SessionRow;
  source: Source;
  messages: Message[];
  files: Attachment[];
  tokenEstimate: number;
}

export interface CopyOptions {

  markdown?: boolean;
  target?: string;
  toolDetail?: ToolDetail;
  level?: Level;
}

export interface CopyOutcome {
  ids: string[];
  title: string;
  target: string;
  tokenEstimate: number;
  missing: number;
  findings: number;

  attach: string[];
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

export interface AuditReport {
  database: string;
  versionsChecked: number;
  versionProblems: string[];
  attachmentsChecked: number;
  attachmentProblems: string[];
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
  pinnedCount: number;
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
  kind: "source";
  refId: string;
  title: string;
  snippet: string;
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

export interface SyncResult {
  added: number;
  updated: number;
  failed: number;
  found: number;
  busy: boolean;
}

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  showMainWindow: (route?: string) => invoke<void>("show_main_window", { route }),
  quit: () => invoke<void>("quit_app"),

  syncSessions: () => invoke<SyncResult>("sync_sessions"),
  listSessions: () => invoke<SessionRow[]>("list_sessions"),
  listHiddenSessions: () => invoke<SessionRow[]>("list_hidden_sessions"),
  restoreSession: (id: string) => invoke<void>("restore_session", { id }),
  getSession: (id: string) => invoke<SessionDetail>("get_session", { id }),
  updateSession: (id: string, patch: { title?: string; pinned?: boolean; tags?: string[] }) => invoke<void>("update_session", { id, patch }),

  removeSession: (id: string) => invoke<void>("remove_session", { id }),

  copySessions: (ids: string[], opts: CopyOptions = {}) => invoke<CopyOutcome>("copy_sessions", { ids, opts }),
  suggestExportName: (ids: string[], ext: string) => invoke<string>("suggest_export_name", { ids, ext }),
  exportSessions: (ids: string[], format: string, path: string, opts: CopyOptions = {}) => invoke<string>("export_sessions", { ids, format, path, opts }),
  exportSessionsZip: (ids: string[], formats: string[], path: string, opts: CopyOptions = {}) =>
    invoke<string>("export_sessions_zip", { ids, formats, path, opts }),

  importText: (text: string, kind: "clipboard" | "manual", title?: string, label?: string) =>
    invoke<ImportOutcome>("import_text", { text, kind, title, label }),

  captureClipboard: () => invoke<ImportOutcome & { chars: number }>("capture_clipboard"),
  listChatExport: (path: string) =>
    invoke<{ provider: string; conversations: { id: string; title: string; updatedAt: string; messageCount: number }[] }>("list_chat_export", { path }),
  importChatExport: (path: string, ids: string[]) => invoke<ImportOutcome[]>("import_chat_export", { path, ids }),
  importAiderHistory: (path: string) => invoke<ImportOutcome>("import_aider_history", { path }),
  importHandoffFile: (path: string) => invoke<string[]>("import_handoff_file", { path }),

  preflightFiles: (paths: string[]) => invoke<{ files: FilePreflight[]; notes: string[] }>("preflight_files", { paths }),

  addFiles: (session: string | null, paths: string[]) => invoke<{ sessionId: string | null; added: number; errors: string[] }>("add_files", { session, paths }),
  openFile: (sha: string) => invoke<void>("open_file", { sha }),
  openFolder: (path: string) => invoke<void>("open_folder", { path }),
  saveFile: (sha: string, path: string) => invoke<string>("save_file", { sha, path }),

  listHandoffs: (limit?: number) => invoke<HandoffRow[]>("list_handoffs", { limit }),
  recentActivity: (limit?: number) => invoke<ActivityRow[]>("recent_activity", { limit }),
  stats: () => invoke<Stats>("stats"),
  search: (query: string) => invoke<SearchHit[]>("search", { query }),

  getSettings: () => invoke<Record<string, unknown>>("get_settings"),
  setSetting: (key: string, value: unknown) => invoke<void>("set_setting", { key, value }),
  integrityCheck: () => invoke<string>("integrity_check"),
  auditLibrary: () => invoke<AuditReport>("audit_library"),
  wipeLibrary: () => invoke<void>("wipe_library"),

  browserStatus: () => invoke<BrowserStatus>("browser_status"),
  registerBrowserHost: (ids: string[]) => invoke<string[]>("register_browser_host", { ids }),
  unregisterBrowserHost: (ids: string[]) => invoke<string[]>("unregister_browser_host", { ids }),
};

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
