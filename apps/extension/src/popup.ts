// Toolbar popup: capture the open chat, or insert a pack as an unsent draft.
import type { CaptureReply, Draft, HostResponse, InsertReply, Level, PackSummary, PingReply, Provider, TabRequest } from "./protocol";

const NAMES: Record<Provider, string> = { chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini", deepseek: "DeepSeek (experimental)", grok: "Grok (experimental)", perplexity: "Perplexity (experimental)" };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function host<T>(body: Record<string, unknown>): Promise<HostResponse<T>> {
  return chrome.runtime.sendMessage({ kind: "host", body });
}

async function tab<T>(msg: TabRequest): Promise<T | null> {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!t?.id) return null;
  try {
    return await chrome.tabs.sendMessage(t.id, msg);
  } catch {
    return null; // no content script: not a supported chat page
  }
}

function status(text: string, tone: "ok" | "warn" | "err" | "info" = "info") {
  const el = $("status");
  el.textContent = text;
  el.dataset.tone = tone;
  el.hidden = !text;
}

function tokens(n: number) {
  return n < 1000 ? `~${n}` : `~${(n / 1000).toFixed(1)}k`;
}

let page: PingReply | null = null;
let picked: PackSummary | null = null;

async function init() {
  const hello = await host<{ version: string }>({ type: "hello", protocol: "1", extensionVersion: chrome.runtime.getManifest().version });
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
    $("site").textContent = `${NAMES[page.provider]} · ${page.messageCount} message${page.messageCount === 1 ? "" : "s"} visible`;
    cap.disabled = page.messageCount === 0;
  } else {
    $("site").textContent = "Open a ChatGPT, Claude, Gemini, DeepSeek, Grok or Perplexity chat to capture it.";
    cap.disabled = true;
  }

  const packs = await host<PackSummary[]>({ type: "pack.list" });
  const list = $("packs");
  list.replaceChildren();
  if (!packs.ok || packs.result.length === 0) {
    list.innerHTML = `<li class="empty">No packs yet. Build one in the Hopilo app.</li>`;
    return;
  }
  for (const p of packs.result) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pack";
    b.dataset.id = p.id;
    b.innerHTML = `<span class="t"></span><span class="m"></span>`;
    b.querySelector(".t")!.textContent = p.title;
    b.querySelector(".m")!.textContent = `v${p.version} · ${p.messageCount} msgs · ${tokens(p.tokenEstimate)} tokens`;
    b.addEventListener("click", () => choose(p));
    li.appendChild(b);
    list.appendChild(li);
  }
}

function choose(p: PackSummary) {
  picked = p;
  for (const el of document.querySelectorAll<HTMLButtonElement>(".pack")) el.setAttribute("aria-current", String(el.dataset.id === p.id));
  $("pick-title").textContent = p.title;
  $("insert-panel").hidden = false;
  $("insert").textContent = page?.composer && page.provider ? `Insert into ${NAMES[page.provider]} as draft` : "Copy draft";
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
    status("Already in Hopilo — nothing changed since the last capture.", "info");
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
  const d = await host<Draft>({ type: "pack.getDraft", packId: picked.id, version: picked.version, level });
  if (!d.ok) return status(d.error.message, "err");
  const warn = [d.result.findings ? `${d.result.findings} possible secret(s)` : "", d.result.missing ? `${d.result.missing} missing item(s)` : ""].filter(Boolean);
  let inserted = false;
  if (page?.composer && page.provider) {
    inserted = (await tab<InsertReply>({ kind: "insert", text: d.result.text }))?.ok ?? false;
  }
  if (!inserted) {
    await navigator.clipboard.writeText(d.result.text);
  }
  await host({ type: "handoff.record", packId: d.result.packId, version: d.result.version, target: page?.provider ?? "other", status: inserted ? "drafted" : "copied" });
  const tail = warn.length ? ` Check before sending: ${warn.join(", ")}.` : "";
  const files = d.result.attachManually.length ? ` Attach yourself: ${d.result.attachManually.join(", ")}.` : "";
  status(
    inserted
      ? `Draft inserted (${tokens(d.result.tokenEstimate)} tokens). Review it, then send.${tail}${files}`
      : `Copied to the clipboard instead — paste with ⌘V.${tail}${files}`,
    inserted ? "ok" : "warn",
  );
});

init();
