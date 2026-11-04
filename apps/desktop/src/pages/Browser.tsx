import { useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { AlertTriangle, CheckCircle2, CircleDashed, Copy, FolderOpen, RefreshCw } from "../components/Icons";
import { api, errorText } from "../lib/api";
import { relativeTime } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { provider } from "../lib/providers";
import { useApp } from "../lib/store";
import { Badge, Button, Card, Checkbox, ErrorNote, PageHeader, ProviderChip, SectionLabel } from "../components/ui";
import { RouteSkeleton } from "../components/Skeletons";

const WEB = ["chatgpt", "claude", "gemini", "deepseek", "grok", "perplexity"];
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

export function Browser() {
  const { data, error, loading, reload } = useLoad(() => api.browserStatus());
  const toast = useApp((s) => s.toast);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);

  if (error) return <ErrorNote text={error} />;
  if (loading && !data) return <RouteSkeleton page="browser" />;
  if (!data) return null;

  const installed = data.browsers.filter((b) => b.installed);
  const chosen = picked ?? new Set(installed.map((b) => b.id));
  const anyRegistered = data.browsers.some((b) => b.registered);
  const seen = !!data.lastSeen;

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
        subtitle="The Hopilo extension saves ChatGPT, Claude and Gemini chats (DeepSeek, Grok and Perplexity experimentally) as sessions, with their files, and puts a session into the message box as an unsent draft. It talks only to this app, on this computer."
        actions={<Button icon={<RefreshCw size={14} />} onClick={reload}>Refresh</Button>}
      />

      <Step n={1} title="Add the extension to your browser" done={seen}>
        <p className="text-muted">
          In Chrome, Edge, Brave or Arc: open <code className="font-mono text-[12px]">chrome://extensions</code>, turn on <b>Developer mode</b>, choose <b>Load unpacked</b> and select this folder.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code data-selectable className="max-w-full truncate rounded-xl border border-line bg-surface-2 px-3 py-1.5 font-mono text-[12px]">{data.extensionDir ?? "apps/extension/dist (run pnpm --filter @hopilo/extension build)"}</code>
          {data.extensionDir && (
            <>
              <Button size="sm" icon={<FolderOpen size={13} />} onClick={() => revealItemInDir(data.extensionDir!)}>Show folder</Button>
              <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => writeText(data.extensionDir!).then(() => toast({ kind: "success", text: "Folder path copied." }))}>Copy path</Button>
            </>
          )}
        </div>
        <p className="mt-2 font-mono text-[11px] text-faint">Extension ID {data.extensionId}</p>
        {data.firefoxExtensionDir && (
          <p className="mt-3 text-muted">
            Firefox 128 or newer: open <code className="font-mono text-[12px]">about:debugging#/runtime/this-firefox</code>, choose <b>Load Temporary Add-on</b> and pick <code className="font-mono text-[12px]">manifest.json</code> in{" "}
            <button type="button" className="text-accent hover:underline" onClick={() => revealItemInDir(data.firefoxExtensionDir!)}>
              the Firefox build folder
            </button>
            .
          </p>
        )}
      </Step>

      <Step n={2} title="Connect your browsers" done={anyRegistered}>
        {!data.hostBinaryExists && (
          <div className="mb-3 flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-[12.5px] text-warning">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> The bridge program wasn't found at {data.hostBinary}. Build it with <code className="font-mono">cargo build -p hopilo-native-host</code>.
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
                {!b.installed ? <Badge>Not installed</Badge> : b.registered ? <Badge tone="success"><CheckCircle2 size={11} /> Connected</Badge> : <Badge><CircleDashed size={11} /> Not connected</Badge>}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex gap-2">
          <Button variant="primary" busy={busy} disabled={!data.hostBinaryExists || chosen.size === 0} onClick={connect}>Connect</Button>
          {anyRegistered && (
            <Button
              variant="ghost"
              onClick={async () => {
                await api.unregisterBrowserHost(data.browsers.filter((b) => b.registered).map((b) => b.id));
                reload();
              }}
            >
              Disconnect all
            </Button>
          )}
        </div>
        <p className="mt-2 text-[12px] text-faint">Connecting writes one small file per browser that lets only the Hopilo extension start the bridge.</p>
      </Step>

      <Step n={3} title="Check it works" done={seen}>
        <p className="text-muted">
          {seen ? `Last heard from the extension ${relativeTime(data.lastSeen)}${data.extensionVersion ? ` (version ${data.extensionVersion})` : ""}.` : "Open a ChatGPT, Claude or Gemini chat and click the Hopilo toolbar icon. It will show “Connected”."}
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
    </div>
  );
}
