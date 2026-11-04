// Messages between the extension and the Hopilo native host
// (crates/native-host). Page content is always treated as data.

export const HOST_NAME = "dev.hopilo.host";
export const PROTOCOL = "1";

export type Provider = "chatgpt" | "claude" | "gemini" | "deepseek" | "grok" | "perplexity";
export type Level = "balanced" | "full" | "minimal";

export interface CapturedMessage {
  role: "user" | "assistant";
  text: string;
  createdAt?: string | null;
  /** Files and images shared in this message. */
  files?: CapturedFile[];
}

export interface CapturedFile {
  name: string;
  mediaType: string;
  /** Base64 bytes; absent when the file was shown but couldn't be read. */
  data?: string;
}

export interface CapturePayload {
  title: string;
  url: string;
  messages: CapturedMessage[];
  status: "complete" | "partial";
  missing: string[];
  adapterVersion: string;
}

export interface PackSummary {
  id: string;
  title: string;
  version: number;
  messageCount: number;
  tokenEstimate: number;
  providers: string[];
}

export interface Draft {
  packId: string;
  version: number;
  title: string;
  text: string;
  tokenEstimate: number;
  findings: number;
  missing: number;
  attachManually: string[];
}

export type HostResponse<T> = { requestId: string; ok: true; result: T } | { requestId: string; ok: false; error: { code: string; message: string } };

/** Popup / content script to background. */
export type BgRequest = { kind: "host"; body: Record<string, unknown> } | { kind: "fetch"; url: string; maxBytes: number };

/** Popup to content script. */
export type TabRequest =
  | { kind: "ping" }
  | { kind: "capture" }
  | { kind: "insert"; text: string };

export interface PingReply {
  provider: Provider | null;
  composer: boolean;
  messageCount: number;
}

export interface CaptureReply {
  ok: boolean;
  payload?: CapturePayload;
  error?: string;
}

export interface InsertReply {
  ok: boolean;
  error?: string;
}
