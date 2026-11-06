import { HOST_NAME, type BgRequest } from "./protocol";

let seq = 0;

const MAX_FETCH_BYTES = 20 * 1024 * 1024;

const CONTENT_SCRIPT_TYPES = new Set(["session.getDraft", "handoff.record"]);

function hostAllowed(u: URL): boolean {
  const patterns = chrome.runtime.getManifest().host_permissions ?? [];
  return patterns.some((p: string) => {
    const m = /^https:\/\/(\*\.)?([^/]+)\//.exec(p);
    if (!m) return false;
    return m[1] ? u.hostname === m[2] || u.hostname.endsWith(`.${m[2]}`) : u.hostname === m[2];
  });
}

async function readCapped(res: Response, limit: number): Promise<Uint8Array | null> {
  if (!res.body) {
    const buf = await res.arrayBuffer();
    return buf.byteLength > limit ? null : new Uint8Array(buf);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

async function fetchFile(url: string, maxBytes: number) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false };
  }
  if (u.protocol !== "https:" || !hostAllowed(u)) return { ok: false };
  const limit = Math.min(Math.max(0, Number(maxBytes) || 0), MAX_FETCH_BYTES);
  const res = await fetch(u.href, { credentials: "include" });
  if (!res.ok) return { ok: false };
  try {
    const final = new URL(res.url || u.href);
    if (final.protocol !== "https:" || !hostAllowed(final)) return { ok: false };
  } catch {
    return { ok: false };
  }
  const declared = Number(res.headers.get("content-length"));
  if (declared > limit) return { ok: false };
  const bytes = await readCapped(res, limit);
  if (!bytes) return { ok: false };
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { ok: true, data: btoa(bin), mediaType: res.headers.get("content-type")?.split(";")[0] ?? "" };
}

chrome.runtime.onMessage.addListener((msg: BgRequest, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (msg?.kind === "fetch") {

    if (!sender.tab) return false;
    fetchFile(msg.url, msg.maxBytes).then(reply, () => reply({ ok: false }));
    return true;
  }

  if (msg?.kind !== "host") return false;
  if (sender.tab && !CONTENT_SCRIPT_TYPES.has(String(msg.body?.type))) {
    reply({ requestId: "", ok: false, error: { code: "forbidden", message: "Not allowed from a web page." } });
    return false;
  }
  const body = { ...msg.body, requestId: `${Date.now()}-${++seq}` };
  chrome.runtime.sendNativeMessage(HOST_NAME, body, (resp) => {
    const err = chrome.runtime.lastError;
    if (err) {
      reply({ requestId: body.requestId, ok: false, error: { code: "not_connected", message: err.message ?? "Hopilo is not connected." } });
    } else {
      reply(resp);
    }
  });
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  if (!chrome.scripting) return;
  for (const cs of chrome.runtime.getManifest().content_scripts ?? []) {
    for (const match of cs.matches ?? []) {
      const tabs = await chrome.tabs.query({ url: match });
      for (const t of tabs) {
        if (t.id) {
          chrome.scripting.executeScript({
            target: { tabId: t.id },
            files: cs.js ?? ["content.js"],
          }).catch(() => {});
        }
      }
    }
  }
});
