import { HOST_NAME, type BgRequest } from "./protocol";

let seq = 0;

async function fetchFile(url: string, maxBytes: number) {
  const u = new URL(url);
  if (u.protocol !== "https:") return { ok: false };
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return { ok: false };
  const buf = await res.arrayBuffer();
  if (buf.byteLength > maxBytes) return { ok: false };
  const bytes = new Uint8Array(buf);
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
