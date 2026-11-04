import { useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { FolderOpen } from "lucide-react";
import { api, errorText } from "../lib/api";
import { bytes } from "../lib/format";
import { saveSetting, useLoad } from "../lib/hooks";
import { useApp } from "../lib/store";
import { Badge, Button, Card, PageHeader, Segmented, Skeleton, TargetSelect, Toggle } from "../components/ui";
import { PageToolbar } from "../components/PageSlots";
import { Select } from "../components/Select";

const SECTIONS = [
  { id: "general", title: "General" },
  { id: "appearance", title: "Appearance" },
  { id: "handoff", title: "Handoff" },
  { id: "privacy", title: "Privacy" },
  { id: "local-ai", title: "Local AI" },
  { id: "storage", title: "Storage" },
  { id: "about", title: "About" },
] as const;

/** One category: a label column on the left, its settings in a full-width card. */
function Group({ id, title, description, children }: { id: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <section id={`settings-${id}`} aria-labelledby={`settings-${id}-title`} className="grid scroll-mt-4 grid-cols-[200px_minmax(0,1fr)] gap-6 border-b border-line py-6 first:pt-1 last:border-0">
      <div>
        <h2 id={`settings-${id}-title`} className="font-display text-[15px] font-semibold">{title}</h2>
        <p className="mt-1 text-[12.5px] text-muted">{description}</p>
      </div>
      <Card className="divide-y divide-line px-5 py-1">{children}</Card>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{label}</div>
        {hint && <div className="text-[12px] text-faint">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Settings() {
  const s = useApp((st) => st.settings);
  const toast = useApp((st) => st.toast);
  const info = useLoad(() => api.appInfo());
  const stats = useLoad(() => api.stats());
  const ollama = useLoad(() => api.ollamaStatus());
  const [autostart, setAutostart] = useState<boolean | null>(null);

  useEffect(() => {
    isEnabled().then(setAutostart).catch(() => setAutostart(null));
  }, []);

  // Deep links such as the sidebar's library card open a specific section.
  const section = useApp((st) => (st.route.page === "settings" ? st.route.section : undefined));
  useEffect(() => {
    if (section) requestAnimationFrame(() => document.getElementById(`settings-${section}`)?.scrollIntoView({ block: "start" }));
  }, [section]);

  return (
    <div>
      <PageHeader title="Settings" subtitle="Changes save immediately." />
      <PageToolbar>
        <nav aria-label="Settings categories" className="flex flex-wrap gap-1.5">
          {SECTIONS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => document.getElementById(`settings-${c.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="h-7.5 rounded-full border border-line bg-card px-3 text-[12.5px] font-medium text-muted shadow-item transition-colors hover:text-ink"
            >
              {c.title}
            </button>
          ))}
        </nav>
      </PageToolbar>
      <div>
        <Group id="general" title="General" description="Startup and window behavior.">
          <Row label="Launch at login" hint="Off unless you turn it on.">
            <Toggle
              label="Launch at login"
              checked={!!autostart}
              onChange={async (v) => {
                try {
                  await (v ? enable() : disable());
                  setAutostart(await isEnabled());
                } catch (e) {
                  toast({ kind: "error", text: errorText(e) });
                }
              }}
            />
          </Row>
          <Row label="On launch, show" hint="The menu-bar icon is always available.">
            <Segmented label="On launch" value={s.startupSurface} onChange={(v) => saveSetting("startupSurface", v)} options={[{ value: "tray", label: "Menu bar only" }, { value: "home", label: "Dashboard" }]} />
          </Row>
          <Row label="Closing the window" hint="Hide keeps Hopilo in the menu bar.">
            <Segmented label="Close button" value={s.closeButton} onChange={(v) => saveSetting("closeButton", v)} options={[{ value: "hide", label: "Hide" }, { value: "quit", label: "Quit" }]} />
          </Row>
          <Row label="Drop Shelf stays on top" hint="Keep the small pack window above other apps while you switch between them.">
            <Toggle label="Drop Shelf stays on top" checked={s.shelfOnTop} onChange={(v) => saveSetting("shelfOnTop", v)} />
          </Row>
          <Row label="Menu-bar icon click">
            <Segmented label="Tray click" value={s.trayClick} onChange={(v) => saveSetting("trayClick", v)} options={[{ value: "panel", label: "Quick Panel" }, { value: "dashboard", label: "Dashboard" }]} />
          </Row>
        </Group>

        <Group id="appearance" title="Appearance" description="Light, dark or follow the system.">
          <Row label="Theme">
            <Segmented label="Theme" value={s.theme} onChange={(v) => saveSetting("theme", v)} options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
          </Row>
          <Row label="Reduce motion" hint="Also follows the system setting.">
            <Toggle label="Reduce motion" checked={s.motion === "reduced"} onChange={(v) => saveSetting("motion", v ? "reduced" : "system")} />
          </Row>
        </Group>

        <Group id="handoff" title="Handoff" description="Defaults for copy and export.">
          <Row label="Default destination">
            <TargetSelect value={s.defaultTarget} onChange={(v) => saveSetting("defaultTarget", v)} className="w-56" />
          </Row>
          <Row label="Tool activity" hint="How tool calls and outputs appear in handoffs.">
            <Segmented label="Tool activity" value={s.toolDetail} onChange={(v) => saveSetting("toolDetail", v)} options={[{ value: "truncated", label: "Trimmed" }, { value: "full", label: "Full" }, { value: "omit", label: "Leave out" }]} />
          </Row>
          <Row label="How much to include" hint="Full is everything; Balanced keeps every request and recent messages; Minimal is goal, latest exchange and key references.">
            <Segmented label="Default level" value={s.level} onChange={(v) => saveSetting("level", v)} options={[{ value: "full", label: "Full" }, { value: "balanced", label: "Balanced" }, { value: "minimal", label: "Minimal" }]} />
          </Row>
          <Row label="Delivery" hint="Copy and export only. Hopilo never submits a message.">
            <span className="text-[12.5px] text-muted">Draft only</span>
          </Row>
        </Group>

        <Group id="privacy" title="Privacy" description="What Hopilo can see and send.">
          <Row label="Network" hint="No accounts, analytics, telemetry or update checks. Optional Ollama runs on this computer only.">
            <span className="text-[12.5px] text-success">Nothing leaves your Mac</span>
          </Row>
          <Row label="Clipboard" hint="Read only when you choose Capture clipboard.">
            <span className="text-[12.5px] text-muted">On request</span>
          </Row>
          <Row label="Sensitive-data check" hint="Flags keys, tokens and emails in the preview before you share.">
            <span className="text-[12.5px] text-muted">Always on</span>
          </Row>
        </Group>

        <Group id="local-ai" title="Local AI (optional)" description="Write short summaries with Ollama running on this computer. Nothing leaves your Mac.">
          <Row label="Ollama" hint={ollama.data?.running ? `${ollama.data.models.length} model(s) installed` : "Not running. Install from ollama.com and start it to enable summaries."}>
            {ollama.data?.running ? <Badge tone="success">Running</Badge> : <Button size="sm" onClick={ollama.reload}>Check again</Button>}
          </Row>
          {ollama.data?.running && (
            <Row label="Model" hint="Used by “Write a summary” on a pack.">
              <div className="w-56">
                <Select
                  label="Ollama model"
                  value={s.ollamaModel}
                  onChange={(v) => saveSetting("ollamaModel", v)}
                  options={[{ value: "", label: "Off" }, ...ollama.data.models.map((m) => ({ value: m, label: m }))]}
                />
              </div>
            </Row>
          )}
        </Group>

        <Group id="storage" title="Storage" description="Your library lives in one folder on this Mac.">
          <Row label="Data folder" hint={info.data?.dataDir}>
            <Button size="sm" icon={<FolderOpen size={13} />} disabled={!info.data} onClick={() => info.data && revealItemInDir(`${info.data.dataDir}/hopilo.db`)}>
              Show
            </Button>
          </Row>
          <Row label="Space used">
            {stats.data ? <span className="text-[12.5px] text-muted">{bytes(stats.data.storageBytes)}</span> : <Skeleton className="h-3 w-14" />}
          </Row>
          <Row label="Verify library" hint="Re-checks every pack version and stored file against its fingerprint.">
            <Button
              size="sm"
              onClick={async () => {
                const r = await api.auditLibrary();
                const problems = [...r.versionProblems, ...r.attachmentProblems];
                toast({
                  kind: problems.length || r.database !== "ok" ? "warning" : "success",
                  text: problems.length || r.database !== "ok"
                    ? `Found ${problems.length} problem(s): ${problems.slice(0, 3).join("; ")}${r.database !== "ok" ? `; database: ${r.database}` : ""}`
                    : `All good: ${r.versionsChecked} versions and ${r.attachmentsChecked} files match their fingerprints.`,
                });
              }}
            >
              Verify
            </Button>
          </Row>
          <Row label="Erase library" hint="Deletes every capture, pack, file and log in Hopilo. Agent session files are not touched.">
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                if (!(await ask("Erase every capture, pack, file and handoff record in Hopilo? This cannot be undone. Your original agent session files are not affected.", { title: "Erase library", kind: "warning" }))) return;
                await api.wipeLibrary();
                toast({ kind: "success", text: "Library erased." });
              }}
            >
              Erase…
            </Button>
          </Row>
        </Group>

        <Group id="about" title="About" description="Hopilo — Universal AI Session Handoff.">
          <Row label="Version">
            {info.data ? <span className="font-mono text-[12.5px] text-muted">{info.data.version}</span> : <Skeleton className="h-3 w-12" />}
          </Row>
          <Row label="Pack format" hint="Context Pack schema 1.0.0 · .handoff archive v1">
            <span className="text-[12.5px] text-muted">Open, documented</span>
          </Row>
        </Group>
      </div>
    </div>
  );
}
