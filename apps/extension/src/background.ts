// Relays requests to the native host. Content scripts cannot use native
// messaging directly (spec 10.4), so everything goes through here.
import { HOST_NAME, type BgRequest } from "./protocol";

let seq = 0;

chrome.runtime.onMessage.addListener((msg: BgRequest, sender, reply) => {
  // Only this extension's own pages and content scripts may call the host.
  if (sender.id !== chrome.runtime.id || msg?.kind !== "host") return false;
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
