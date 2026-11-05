import { PROTOCOL } from "./protocol";
import type { CaptureReply, Draft, HostResponse, InsertReply, Level, PingReply, SessionSummary, Provider, TabRequest } from "./protocol";
import { adapterFor } from "./adapters";

const NAMES: Record<Provider, string> = { claude: "Claude", gemini: "Gemini", deepseek: "DeepSeek (experimental)", grok: "Grok (experimental)", perplexity: "Perplexity (experimental)" };

const SESSION_ICON = `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path class="duo" d="M4 10a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-3 2.5V17a2 2 0 0 1-2-2z"/><path d="M8.5 8V6a2 2 0 0 1 2-2H18a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1v2.2"/><path d="M4 10a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-3 2.5V17a2 2 0 0 1-2-2z"/></svg>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function host<T>(body: Record<string, unknown>): Promise<HostResponse<T>> {
  return chrome.runtime.sendMessage({ kind: "host", body });
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  try {
    const [t1] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (t1?.id) return t1;
  } catch {}
  try {
    const [t2] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (t2?.id) return t2;
  } catch {}
  try {
    const tabs = await chrome.tabs.query({ active: true });
    if (tabs.length > 0 && tabs[0]?.id) return tabs[0];
  } catch {}
  return null;
}

async function tab<T>(msg: TabRequest): Promise<T | null> {
  const t = await getActiveTab();
  if (!t?.id) return null;
  try {
    return await chrome.tabs.sendMessage(t.id, msg);
  } catch {
    if (t.url) {
      try {
        const u = new URL(t.url);
        if (adapterFor(u.hostname) && chrome.scripting) {
          await chrome.scripting.executeScript({
            target: { tabId: t.id },
            files: ["content.js"],
          });
          await new Promise((r) => setTimeout(r, 120));
          return await chrome.tabs.sendMessage(t.id, msg);
        }
      } catch {
        return null;
      }
    }
    return null;
  }
}

function status(text: string, tone: "ok" | "warn" | "err" | "info" = "info") {
  const el = $("status");
  el.textContent = text;
  el.dataset.tone = tone;
  el.hidden = !text;
}

function ago(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(min) || min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 60 * 24) return `${Math.round(min / 60)} h ago`;
  const days = Math.round(min / 60 / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function tokens(n: number) {
  return n < 1000 ? `~${n}` : `~${(n / 1000).toFixed(1)}k`;
}

let page: PingReply | null = null;
let picked: SessionSummary | null = null;

async function init() {
  const hello = await host<{ version: string }>({ type: "hello", protocol: PROTOCOL, extensionVersion: chrome.runtime.getManifest().version });
  const dot = $("conn");
  if (!hello.ok) {
    dot.dataset.state = "off";
    $("conn-label").textContent = "Not connected";
    $("setup").hidden = false;
    $("main").hidden = true;
    return;
  }
  dot.dataset.state = "on";
  $("conn-label").textContent = `Connected to Hopilo ${hello.result.version}`;

  page = await tab<PingReply>({ kind: "ping" });
  const cap = $<HTMLButtonElement>("capture");
  if (page?.provider) {
    $("site").textContent = page.messageCount > 0 ? `${NAMES[page.provider]} · ${page.messageCount} message${page.messageCount === 1 ? "" : "s"} visible` : `${NAMES[page.provider]} · ready to capture`;
    cap.disabled = false;
  } else {
    const t = await getActiveTab();
    let fallbackAdapter = null;
    if (t?.url) {
      try {
        fallbackAdapter = adapterFor(new URL(t.url).hostname);
      } catch {}
    }
    if (fallbackAdapter) {
      page = { provider: fallbackAdapter.id, composer: true, messageCount: 1 };
      $("site").textContent = `${NAMES[fallbackAdapter.id]} · ready to capture`;
      cap.disabled = false;
    } else {
      $("site").textContent = "Open a Claude, Gemini, DeepSeek, Grok or Perplexity chat to capture it.";
      cap.disabled = true;
    }
  }

  const sessions = await host<SessionSummary[]>({ type: "session.list" });
  const list = $("sessions");
  list.replaceChildren();
  if (!sessions.ok || sessions.result.length === 0) {
    list.innerHTML = `<li class="empty">No sessions yet. Capture a chat above, or open the Hopilo app.</li>`;
    return;
  }
  for (const p of sessions.result) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pack";
    b.dataset.id = p.id;
    b.innerHTML = `${SESSION_ICON}<span class="txt"><span class="t"></span><span class="m"></span></span>`;
    b.querySelector(".t")!.textContent = p.title;
    b.querySelector(".m")!.textContent = [p.provider, `${p.messageCount} msgs`, p.fileCount ? `${p.fileCount} files` : "", `${tokens(p.tokenEstimate)} tokens`, ago(p.updatedAt)].filter(Boolean).join(" · ");
    b.addEventListener("click", () => choose(p));
    li.appendChild(b);
    list.appendChild(li);
  }
}

function choose(p: SessionSummary) {
  picked = p;
  for (const el of document.querySelectorAll<HTMLButtonElement>(".pack")) el.setAttribute("aria-current", String(el.dataset.id === p.id));
  $("pick-title").textContent = p.title;
  $("insert-panel").hidden = false;
  $("insert-label").textContent = page?.composer && page.provider ? `Insert into ${NAMES[page.provider]} as draft` : "Copy draft";
  $("insert-panel").scrollIntoView({ block: "nearest" });
}

$("capture").addEventListener("click", async () => {
  const btn = $<HTMLButtonElement>("capture");
  btn.disabled = true;
  status("Reading the conversation… older messages may take a few seconds.");
  const res = await tab<CaptureReply>({ kind: "capture" });
  if (!res?.ok || !res.payload || !page?.provider) {
    status(res?.error ?? "Couldn't read this page.", "err");
    await host({ type: "adapter.report", provider: page?.provider, ok: false, detail: res?.error ?? "capture failed" });
    btn.disabled = false;
    return;
  }
  const saved = await host<{ sourceId: string; duplicateOf: string | null; messageCount: number; status: string }>({
    type: "capture.import",
    provider: page.provider,
    payload: res.payload,
  });
  await host({ type: "adapter.report", provider: page.provider, adapterVersion: res.payload.adapterVersion, ok: saved.ok, messageCount: res.payload.messages.length });
  if (!saved.ok) {
    status(saved.error.message, "err");
  } else if (saved.result.duplicateOf) {
    status("Already in Hopilo: nothing changed since the last capture.", "info");
  } else if (saved.result.status === "partial") {
    status(`Saved ${saved.result.messageCount} messages, but some may be missing: ${res.payload.missing.join("; ")}`, "warn");
  } else {
    status(`Saved all ${saved.result.messageCount} messages to Hopilo.`, "ok");
  }
  btn.disabled = false;
});

$("insert").addEventListener("click", async () => {
  if (!picked) return;
  const level = (document.querySelector<HTMLInputElement>("input[name=level]:checked")?.value ?? "balanced") as Level;
  status("Preparing draft…");
  const d = await host<Draft>({ type: "session.getDraft", ids: [picked.id], level });
  if (!d.ok) return status(d.error.message, "err");
  const warn = [d.result.findings ? `${d.result.findings} possible secret(s)` : "", d.result.missing ? `${d.result.missing} missing item(s)` : ""].filter(Boolean);
  let inserted = false;
  if (page?.composer && page.provider) {
    inserted = (await tab<InsertReply>({ kind: "insert", text: d.result.text }))?.ok ?? false;
  }
  if (!inserted) {
    await navigator.clipboard.writeText(d.result.text);
  }
  await host({ type: "handoff.record", ids: d.result.ids, target: page?.provider ?? "other", status: inserted ? "drafted" : "copied" });
  const tail = warn.length ? ` Check before sending: ${warn.join(", ")}.` : "";
  const files = d.result.attachManually.length ? ` Attach yourself: ${d.result.attachManually.join(", ")}.` : "";
  status(
    inserted
      ? `Draft inserted (${tokens(d.result.tokenEstimate)} tokens). Review it, then send.${tail}${files}`
      : `Copied to the clipboard instead. Paste with ⌘V.${tail}${files}`,
    inserted ? "ok" : "warn",
  );
});

init();
