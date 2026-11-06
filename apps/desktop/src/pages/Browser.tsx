import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Download, ExternalLink, RefreshCw } from "../components/Icons";
import { RELEASES_LATEST_URL, RELEASES_URL, openExternal } from "../lib/updates";
import { api, errorText } from "../lib/api";
import { relativeTime } from "../lib/format";
import { isWindowShown, useLoad } from "../lib/hooks";
import { provider } from "../lib/providers";
import { useApp } from "../lib/store";
import { AlertDialog, Badge, Button, Card, Checkbox, ErrorNote, PageHeader, ProviderChip, SectionLabel } from "../components/ui";
import { RouteSkeleton } from "../components/Skeletons";

const WEB = ["claude", "gemini", "deepseek", "grok", "perplexity"];
const EXPERIMENTAL = new Set(["deepseek", "grok", "perplexity"]);

function Step({ n, title, children, done }: { n: number; title: string; children: React.ReactNode; done?: boolean }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <span className={`flex h-8 w-8 items-center justify-center rounded-full font-mono text-[12px] font-semibold ${done ? "bg-success-soft text-success" : "bg-accent-soft text-accent"}`}>
          {done ? <CheckCircle2 size={16} /> : n}
        </span>
        <h2 className="text-[15px] font-semibold">{title}</h2>
      </div>
      <div className="mt-3 pl-11">{children}</div>
    </Card>
  );
}

function releaseAsset(browser: "chrome" | "firefox", version: string | undefined) {
  const v = version ?? "0.1.0";
  const name = `hopilo-extension-${browser}-${v}.zip`;
  const url = version ? `${RELEASES_URL}/download/v${version}/${name}` : `${RELEASES_LATEST_URL}/download/${name}`;
  return { name, url };
}

function ReleaseSteps({ version, extensionId }: { version: string | undefined; extensionId: string }) {
  const chrome = releaseAsset("chrome", version);
  const firefox = releaseAsset("firefox", version);
  const code = "font-mono text-[12px]";
  return (
    <div className="space-y-3 text-muted">
      <ol className="list-decimal space-y-1.5 pl-4 marker:text-faint">
        <li>
          Download <code className={code}>{chrome.name}</code> from the GitHub release that matches this app.
        </li>
        <li>Unzip it into a folder you'll keep. The browser loads the extension from that folder, so don't delete it.</li>
        <li>
          In Chrome, Edge, Brave or Arc: open <code className={code}>chrome://extensions</code>, turn on <b>Developer mode</b>, choose <b>Load unpacked</b> and select the unzipped folder.
        </li>
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" icon={<Download size={13} />} onClick={() => openExternal(chrome.url)}>
          Download for Chrome
        </Button>
        <Button size="sm" icon={<Download size={13} />} onClick={() => openExternal(firefox.url)}>
          Download for Firefox
        </Button>
        <Button size="sm" variant="ghost" icon={<ExternalLink size={13} />} onClick={() => openExternal(version ? `${RELEASES_URL}/tag/v${version}` : RELEASES_LATEST_URL)}>
          Open release page
        </Button>
      </div>
      <p>
        Firefox 128 or newer: download the Firefox build, open <code className={code}>about:debugging#/runtime/this-firefox</code>, choose <b>Load Temporary Add-on</b> and pick the downloaded <code className={code}>.zip</code>.
      </p>
      <p className="font-mono text-[11px] text-faint">Extension ID {extensionId}</p>
    </div>
  );
}

export function Browser() {
  const { data, error, loading, reload } = useLoad(() => api.browserStatus(), [], { refreshOnChange: false });
  const version = useLoad(() => api.appInfo(), [], { refreshOnChange: false }).data?.version;
  const toast = useApp((s) => s.toast);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => {
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    const timer = setInterval(() => {
      if (!document.hidden && isWindowShown()) reload();
    }, 30000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, [reload]);

  if (error) return <ErrorNote text={error} />;
  if (loading && !data) return <RouteSkeleton page="browser" />;
  if (!data) return null;

  const installed = data.browsers.filter((b) => b.installed);
  const chosen = picked ?? new Set(installed.map((b) => b.id));
  const anyRegistered = data.browsers.some((b) => b.registered);
  const CONNECTED_WINDOW_MS = 10 * 60 * 1000;
  const lastSeenTs = data.lastSeen ? new Date(data.lastSeen).getTime() : 0;
  const isConnected = anyRegistered && !!data.lastSeen && !isNaN(lastSeenTs) && Date.now() - lastSeenTs < CONNECTED_WINDOW_MS;

  const connect = async () => {
    setBusy(true);
    try {
      const names = await api.registerBrowserHost([...chosen]);
      toast({ kind: "success", text: names.length ? `Connected ${names.join(", ")}. Reopen the extension panel to use it.` : "No browsers selected." });
      reload();
    } catch (e) {
      toast({ kind: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pb-6">
      <PageHeader
        title="Browser"
        subtitle="The Hopilo extension saves Claude and Gemini chats (DeepSeek, Grok and Perplexity experimentally) as sessions, with their files, and puts a session into the message box as an unsent draft. It communicates 100% offline directly with this app."
        actions={<Button icon={<RefreshCw size={14} />} onClick={reload}>Refresh</Button>}
      />

      <Step n={1} title="Add the extension to your browser" done={isConnected}>
        {isConnected && !showInstructions ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-success/30 bg-success-soft px-2.5 py-1 text-[12px] font-medium text-success">
                  <CheckCircle2 size={13} /> Extension connected
                </span>
                {data.extensionVersion && (
                  <span className="text-[12.5px] text-muted">v{data.extensionVersion}</span>
                )}
                {data.lastSeen && (
                  <span className="text-[12px] text-faint">· active {relativeTime(data.lastSeen)}</span>
                )}
              </div>
              <Button size="sm" variant="ghost" onClick={() => setShowInstructions(true)}>
                Reinstall or add to another browser
              </Button>
            </div>
            <p className="font-mono text-[11px] text-faint">Extension ID {data.extensionId}</p>
          </div>
        ) : (
          <>
            {isConnected ? (
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[12px] text-muted">Setup instructions</span>
                <Button size="sm" variant="ghost" onClick={() => setShowInstructions(false)}>
                  Hide instructions
                </Button>
              </div>
            ) : data.lastSeen ? (
              <div className="mb-3 flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-[12.5px] text-muted">
                <CircleDashed size={14} className="shrink-0 text-faint" />
                <span>
                  Not connected right now (last active {relativeTime(data.lastSeen)}). Open the Hopilo extension in your browser to reconnect, or download below.
                </span>
              </div>
            ) : null}
            <ReleaseSteps version={version} extensionId={data.extensionId} />
          </>
        )}
      </Step>

      <Step n={2} title="Connect your browsers" done={anyRegistered}>
        {!data.hostBinaryExists && (
          <div className="mb-3 flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-[12.5px] text-warning">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> The companion bridge was not found at {data.hostBinary}. Please reinstall or update Hopilo.
          </div>
        )}
        {data.browsers.length === 0 ? (
          <p className="text-muted">Browser connection isn't supported on this system yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {data.browsers.map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <Checkbox
                  label={`Connect ${b.name}`}
                  disabled={!b.installed}
                  checked={b.installed && chosen.has(b.id)}
                  onChange={() => {
                    const n = new Set(chosen);
                    if (n.has(b.id)) n.delete(b.id);
                    else n.add(b.id);
                    setPicked(n);
                  }}
                />
                <span className="flex-1 font-medium">{b.name}</span>
                {!b.installed ? (
                  <Badge>Not installed</Badge>
                ) : b.registered && isConnected ? (
                  <Badge tone="success"><CheckCircle2 size={11} /> Connected</Badge>
                ) : b.registered ? (
                  <Badge tone="neutral"><CircleDashed size={11} /> Host registered</Badge>
                ) : (
                  <Badge><CircleDashed size={11} /> Not registered</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex gap-2">
          <Button variant="primary" busy={busy} disabled={!data.hostBinaryExists || chosen.size === 0} onClick={connect}>Connect</Button>
          {anyRegistered && (
            <Button
              variant="ghost"
              onClick={() => setConfirmDisconnect(true)}
            >
              Disconnect all
            </Button>
          )}
        </div>
        <p className="mt-2 text-[12px] text-faint">Connecting allows only the Hopilo extension to communicate securely with the desktop app.</p>
      </Step>

      <Step n={3} title="Check it works" done={isConnected}>
        <p className="text-muted">
          {isConnected
            ? `Active now · last heard from extension ${relativeTime(data.lastSeen)}${data.extensionVersion ? ` (v${data.extensionVersion})` : ""}.`
            : data.lastSeen
            ? `Not active right now. Last heard from the extension ${relativeTime(data.lastSeen)}. Open the Hopilo extension icon in your browser to reconnect.`
            : "Open a Claude or Gemini chat and click the Hopilo toolbar icon. It will show “Connected”."}
        </p>
      </Step>

      <section>
        <SectionLabel>Site support</SectionLabel>
        <Card className="divide-y divide-line">
          {WEB.map((id) => {
            const r = data.adapters[id];
            return (
              <div key={id} className="flex items-center gap-3 px-4 py-3">
                <ProviderChip id={id} size={26} />
                <div className="w-40 font-medium">
                  {provider(id).label}
                  {EXPERIMENTAL.has(id) && <span className="ml-1.5 text-[11px] font-normal text-warning">experimental</span>}
                </div>
                <div className="min-w-0 flex-1 text-[12.5px] text-muted">
                  {r ? `Last capture ${relativeTime(r.testedAt)} · ${r.messageCount} messages · ${r.adapterVersion ?? "unknown version"}${r.detail ? ` · ${r.detail}` : ""}` : "Not tried yet"}
                </div>
                {r ? r.ok ? <Badge tone="success">Working</Badge> : <Badge tone="warning">Problem</Badge> : <Badge>Untested</Badge>}
              </div>
            );
          })}
        </Card>
        <p className="mt-2 text-[12px] text-faint">
          Sites change their pages often. If a capture or insert fails, the extension says so and copies the draft to your clipboard instead.
        </p>
      </section>

      {confirmDisconnect && (
        <AlertDialog
          title="Disconnect all browsers"
          description="Disconnect all registered browsers from Hopilo? You can reconnect them anytime."
          confirmLabel="Disconnect all"
          destructive
          onClose={() => setConfirmDisconnect(false)}
          onConfirm={async () => {
            try {
              await api.unregisterBrowserHost(data.browsers.filter((b) => b.registered).map((b) => b.id));
              toast({ kind: "success", text: "Disconnected all browsers." });
              setConfirmDisconnect(false);
            } catch (e) {
              toast({ kind: "error", text: `Could not disconnect: ${errorText(e)}` });
            }
            reload();
          }}
        />
      )}
    </div>
  );
}
