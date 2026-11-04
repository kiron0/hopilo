import { adapterFor } from "./adapters";
import { capture, insertDraft } from "./adapters/common";
import type { CaptureReply, Draft, HostResponse, InsertReply, PingReply, TabRequest } from "./protocol";

const adapter = adapterFor(location.hostname);

function host<T>(body: Record<string, unknown>): Promise<HostResponse<T>> {
  return chrome.runtime.sendMessage({ kind: "host", body });
}

if (!(window as unknown as { __hopilo_injected?: boolean }).__hopilo_injected) {
  (window as unknown as { __hopilo_injected?: boolean }).__hopilo_injected = true;

  chrome.runtime.onMessage.addListener((msg: TabRequest, sender, reply) => {
    if (sender.id !== chrome.runtime.id || !adapter) return false;
    if (msg.kind === "ping") {
      reply({ provider: adapter.id, composer: !!adapter.composer(document), messageCount: adapter.messages(document).length } satisfies PingReply);
      return false;
    }
    if (msg.kind === "capture") {
      capture(adapter, document, { includeOlder: true })
        .then((payload) => reply({ ok: true, payload } satisfies CaptureReply))
        .catch((e) => reply({ ok: false, error: String(e) } satisfies CaptureReply));
      return true;
    }
    if (msg.kind === "insert") {
      const box = adapter.composer(document);
      if (!box) {
        reply({ ok: false, error: "Couldn't find the message box on this page." } satisfies InsertReply);
        return false;
      }
      reply({ ok: insertDraft(box, msg.text) } satisfies InsertReply);
      return false;
    }
    return false;
  });
}

const SESSION_REF = /^hopilo:\/\/session\/([0-9A-Za-z]{10,40})$/;

function overlay() {
  const hostEl = document.createElement("div");
  hostEl.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none;display:none";
  const shadow = hostEl.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      .zone{position:fixed;left:50%;bottom:120px;transform:translateX(-50%);padding:18px 26px;border-radius:22px;
        font:600 15px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#fff;
        background:linear-gradient(160deg,#5a63ff,#7b4fe0);box-shadow:0 18px 40px rgb(40 40 90/.35),inset 0 1px 1px rgb(255 255 255/.35);
        border:2px dashed rgb(255 255 255/.6);pointer-events:auto;text-align:center}
      .zone small{display:block;font-weight:400;opacity:.85;margin-top:4px}
      .toast{position:fixed;right:20px;bottom:20px;max-width:340px;padding:12px 16px;border-radius:16px;background:#1b1e29;color:#eef0f6;
        font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 18px 40px rgb(0 0 0/.35);pointer-events:auto}
    </style>
    <div class="zone" part="zone">Drop the session here<small>Hopilo inserts it as a draft. You review and send.</small></div>`;
  document.documentElement.appendChild(hostEl);
  const zone = shadow.querySelector<HTMLDivElement>(".zone")!;
  const toast = (text: string) => {
    const t = document.createElement("div");
    t.className = "toast";
    t.setAttribute("role", "status");
    t.textContent = text;
    shadow.appendChild(t);
    hostEl.style.display = "block";
    zone.style.display = "none";
    setTimeout(() => {
      t.remove();
      hostEl.style.display = "none";
      zone.style.display = "";
    }, 5000);
  };
  return { hostEl, zone, toast };
}

if (adapter) {
  const ui = overlay();
  let depth = 0;
  const hasText = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("text/plain");
  window.addEventListener("dragenter", (e) => {
    if (!hasText(e)) return;
    depth++;
    ui.hostEl.style.display = "block";
  });
  window.addEventListener("dragleave", () => {
    if (--depth <= 0) {
      depth = 0;
      ui.hostEl.style.display = "none";
    }
  });
  ui.zone.addEventListener("dragover", (e) => e.preventDefault());
  ui.zone.addEventListener("drop", async (e) => {
    e.preventDefault();
    depth = 0;
    ui.hostEl.style.display = "none";
    const ref = e.dataTransfer?.getData("text/plain").trim() ?? "";
    const m = ref.match(SESSION_REF);
    if (!m) return ui.toast("That isn't a Hopilo session. Drag a session from the Hopilo app.");
    const resp = await host<Draft>({ type: "session.getDraft", ids: [m[1]], level: "balanced" });
    if (!resp.ok) return ui.toast(resp.error.message);
    const box = adapter.composer(document);
    const ok = !!box && insertDraft(box, resp.result.text);
    await host({ type: "handoff.record", ids: resp.result.ids, target: adapter.id, status: ok ? "drafted" : "failed" });
    ui.toast(ok ? `Draft ready: “${resp.result.title}”. Review it, then send.` : "Couldn't insert here. Open the Hopilo extension to copy it instead.");
  });
  window.addEventListener("drop", () => {
    depth = 0;
    ui.hostEl.style.display = "none";
  });
}
