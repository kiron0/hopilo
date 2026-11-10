import type { CatalogPage } from "./modelLimits";
import { invoke } from "@tauri-apps/api/core";

export type MdNode =
  | { t: "text"; v: string }
  | { t: "el"; tag: string; id?: string; class?: string; start?: number; align?: "left" | "center" | "right"; checked?: boolean; c: MdNode[] }
  | { t: "code"; lang: string; v: string }
  | { t: "icode"; v: string }
  | { t: "math"; display: boolean; v: string }
  | { t: "link"; href: string; title?: string; id?: string; c: MdNode[] }
  | { t: "img"; src: string; alt: string; title?: string }
  | { t: "br" };
export interface SyntaxToken { content: string; htmlStyle: Record<string, string> }

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
  manualMessageId?: string | null;
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

export interface SessionQuery {
  q?: string; filter?: string; provider?: string; model?: string; folder?: string;
  resource?: string; hideUnanswered?: boolean; offset?: number; limit?: number;
  ids?: string[]; exclude?: string[]; searchProviders?: string[]; since?: string; rowsOnly?: boolean;
}
export interface SessionPage {
  providerCounts: Record<string, number>; rows: SessionRow[]; total: number; offset: number; providers: string[]; models: string[]; folders: string[];
  counts: { hidden: number; total: number; pinned: number; agents: number; web: number; webToday: number; unanswered: number };
}

export interface Finding {
  kind: string;
  preview: string;
  location: string;
  fingerprint: string;
  count: number;
  custom: boolean;
}

export interface RuleError {
  name: string;
  error: string;
}

export type Intent = "continue" | "review" | "summary" | "debug" | "custom";
export type PromptStyle = "xml" | "markdown" | "contextFirst";
export type SessionOrder = "selected" | "chronological" | "researchFirst";

export interface CustomPattern {
  id: string;
  name: string;
  pattern: string;
  enabled: boolean;
}

export interface RedactionRules {
  patterns: CustomPattern[];
  keywords: string[];
  excludePaths: string[];
  disabledBuiltins: string[];
}

export interface RuleTest {
  matches: string[];
  error: string | null;
}

export interface CompareSide {
  id: string;
  title: string;
  provider: string;
  model: string | null;
  project: string | null;
  messageCount: number;
  userTurns: number;
  assistantTurns: number;
  toolCalls: number;
  toolErrors: number;
  tokenEstimate: number;
  startedAt: string | null;
  endedAt: string | null;
  editedFiles: string[];
  mentionedFiles: string[];
  commands: string[];
  errors: string[];
  firstRequest: string | null;
  finalReply: string | null;
}

export interface Comparison {
  a: CompareSide;
  b: CompareSide;
  sameProject: boolean;
  sharedEdits: string[];
  onlyAEdits: string[];
  onlyBEdits: string[];
  sharedCommands: string[];
  commonPrompts: number;
  divergeAt: number | null;
  aPromptAtDiverge: string | null;
  bPromptAtDiverge: string | null;
}

export interface LatestCopied {
  ok: boolean;
  title: string | null;
  id: string | null;
  findings: number;
  missing: number;
  error: string | null;
  source: "shortcut" | "tray" | "app";
}

export interface BundleImport {
  ids: string[];
  files: number;
  errors: string[];
}

export interface LevelStats {
  messageCount: number;
  tokenEstimate: number;
}

export interface HandoffPreflight {
  title: string;
  totalMessages: number;
  totalTokens: number;
  findings: Finding[];
  ruleErrors: RuleError[];
  excludedFiles: string[];
  sourceCount: number;
  full: LevelStats;
  balanced: LevelStats;
  minimal: LevelStats;
}

export interface MessageRef { sourceId: string; id: string }
export interface HandoffPreview { text: string; hash: string; tokenEstimate: number; messageCount: number; format: string; truncated?: boolean }
export interface BackupReport { createdAt: string; files: number; sessions: number; verified: boolean }
export interface BackupStatus { unlocked: boolean; directory: string | null; hours: number | null; lastResult: string | null }

export interface CopyOptions {
  selected?: MessageRef[];
  reviewed?: { format: string; hash: string };
  markdown?: boolean;
  target?: string;
  toolDetail?: ToolDetail;
  level?: Level;
  excludeSecrets?: boolean;
  intent?: Intent;
  instructions?: string;
  note?: string;
  style?: PromptStyle;
  order?: SessionOrder;
  ignore?: string[];
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
  kind: "text" | "image" | "pdf" | "html" | "audio" | "video" | "binary";
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

export interface AgentCliInfo {
  path: string | null;
  installed: boolean;
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
  permanentlyDeleteSessions: (ids: string[]) => invoke<void>("permanently_delete_sessions", { ids }),
  readFilePreview: (sha: string, offset: number, length: number) => invoke<ArrayBuffer>("read_file_preview", { sha, offset, length }),
  removeSessionFile: (id: string, messageId: string, sha: string, name: string) => invoke<void>("remove_session_file", { id, messageId, sha, name }),
  backupStatus: () => invoke<BackupStatus>("backup_status"),
  createBackup: (path: string, password: string) => invoke<BackupReport>("create_backup", { path, password }),
  verifyBackup: (path: string, password: string) => invoke<BackupReport>("verify_backup", { path, password }),
  restoreBackup: (path: string, password: string) => invoke<{ report: BackupReport; recoveryPath: string }>("restore_backup", { path, password }),
  unlockBackupSchedule: (directory: string, hours: number, password: string) => invoke<void>("unlock_backup_schedule", { directory, hours, password }),
  lockBackupSchedule: () => invoke<void>("lock_backup_schedule"),
  previewHandoff: (ids: string[], format: string, opts: CopyOptions) => invoke<HandoffPreview>("preview_handoff", { ids, format, opts }),
  handoffMessages: (ids: string[]) => invoke<Message[]>("handoff_messages", { ids }),
  appInfo: () => invoke<AppInfo>("app_info"),
  showMainWindow: (route?: string) => invoke<void>("show_main_window", { route }),
  quit: () => invoke<void>("quit_app"),

  syncSessions: () => invoke<SyncResult>("sync_sessions"),
  querySessions: (query: SessionQuery = {}) => invoke<SessionPage>("query_sessions", { query }),
  listHiddenSessions: () => invoke<SessionRow[]>("list_hidden_sessions"),
  restoreSession: (id: string) => invoke<void>("restore_session", { id }),
  getSession: (id: string) => invoke<SessionDetail>("get_session", { id }),
  updateSession: (id: string, patch: { title?: string; pinned?: boolean; tags?: string[] }) => invoke<void>("update_session", { id, patch }),

  removeSession: (id: string) => invoke<void>("remove_session", { id }),

  copySessions: (ids: string[], opts: CopyOptions = {}) => invoke<CopyOutcome>("copy_sessions", { ids, opts }),
  preflightHandoff: (ids: string[]) => invoke<HandoffPreflight>("preflight_handoff", { ids }),
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
  previewFile: (sha: string) => invoke<string>("preview_file", { sha }),

  listHandoffs: (limit?: number) => invoke<HandoffRow[]>("list_handoffs", { limit }),
  recentActivity: (limit?: number) => invoke<ActivityRow[]>("recent_activity", { limit }),
  stats: () => invoke<Stats>("stats"),
  search: (query: string) => invoke<SearchHit[]>("search", { query }),

  getSettings: () => invoke<Record<string, unknown>>("get_settings"),
  searchModelLimits: (query: string) => invoke<CatalogPage>("search_model_limits", { query }),
  syncModelLimits: () => invoke<CatalogPage>("sync_model_limits"),
  parseMarkdown: (text: string) => invoke<MdNode[] | null>("parse_markdown", { text }),
  highlightCode: (code: string, language: string) => invoke<SyntaxToken[][] | null>("highlight_code", { code, language }),
  setSetting: (key: string, value: unknown) => invoke<void>("set_setting", { key, value }),
  integrityCheck: () => invoke<string>("integrity_check"),
  auditLibrary: () => invoke<AuditReport>("audit_library"),
  wipeLibrary: () => invoke<void>("wipe_library"),

  compareSessions: (a: string, b: string) => invoke<Comparison>("compare_sessions", { a, b }),
  copyLatest: () => invoke<void>("copy_latest"),
  setGlobalShortcut: (accelerator: string | null) => invoke<void>("set_global_shortcut", { accelerator }),
  testRedactionRule: (pattern: string, keyword: boolean, sample: string) => invoke<RuleTest>("test_redaction_rule", { pattern, keyword, sample }),
  builtinRedactionKinds: () => invoke<string[]>("builtin_redaction_kinds"),

  browserStatus: () => invoke<BrowserStatus>("browser_status"),
  agentCliInfo: () => invoke<AgentCliInfo>("agent_cli_info"),
  registerBrowserHost: (ids: string[]) => invoke<string[]>("register_browser_host", { ids }),
  unregisterBrowserHost: (ids: string[]) => invoke<string[]>("unregister_browser_host", { ids }),
};

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
}
