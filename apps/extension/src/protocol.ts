export const HOST_NAME = "dev.hopilo.host";
export const PROTOCOL = "2";

export type Provider = "chatgpt" | "claude" | "gemini" | "deepseek" | "grok" | "perplexity";
export type Level = "balanced" | "full" | "minimal";

export interface CapturedMessage {
  role: "user" | "assistant";
  text: string;
  createdAt?: string | null;

  files?: CapturedFile[];
}

export interface CapturedFile {
  name: string;
  mediaType: string;

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

export interface SessionSummary {
  id: string;
  title: string;
  provider: string;
  messageCount: number;
  tokenEstimate: number;
  fileCount: number;
  updatedAt: string;
  pinned: boolean;
}

export interface Draft {
  ids: string[];
  title: string;
  text: string;
  tokenEstimate: number;
  findings: number;
  missing: number;
  attachManually: string[];
}

export type HostResponse<T> = { requestId: string; ok: true; result: T } | { requestId: string; ok: false; error: { code: string; message: string } };

export type BgRequest = { kind: "host"; body: Record<string, unknown> } | { kind: "fetch"; url: string; maxBytes: number };

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
