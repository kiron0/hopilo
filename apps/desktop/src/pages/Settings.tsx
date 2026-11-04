import { useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { FolderOpen } from "../components/Icons";
import { api, errorText } from "../lib/api";
import { bytes } from "../lib/format";
import { saveSetting, useLoad } from "../lib/hooks";
import { useApp } from "../lib/store";
import { Badge, Button, Card, PageHeader, Segmented, Skeleton, TargetSelect, Toggle, cx } from "../components/ui";

const BACKGROUNDS: { value: "mist" | "grid" | "dots" | "grain"; label: string }[] = [
  { value: "mist", label: "Mist" },
  { value: "grid", label: "Grid" },
  { value: "dots", label: "Dots" },
  { value: "grain", label: "Grain" },
];

const THEMES: { value: "light" | "dark" | "system"; label: string; swatchClass: string }[] = [
  { value: "light", label: "Light", swatchClass: "theme-light" },
  { value: "dark", label: "Dark", swatchClass: "theme-dark" },
  { value: "system", label: "System", swatchClass: "theme-system" },
];

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
    <div className="space-y-4 pb-6">
      <PageHeader title="Settings" subtitle="Changes save immediately." />
      <div className="sy-stagger">
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
          <Row label="Menu-bar icon click">
            <Segmented label="Tray click" value={s.trayClick} onChange={(v) => saveSetting("trayClick", v)} options={[{ value: "panel", label: "Quick Panel" }, { value: "dashboard", label: "Dashboard" }]} />
          </Row>
        </Group>

        <Group id="appearance" title="Appearance" description="Window canvas, theme, and animations.">
          <div className="py-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] font-medium">Background</div>
                <div className="text-[12px] text-faint">The living canvas behind the dashboard and sidebar.</div>
              </div>
              <Segmented
                label="Background"
                value={s.background || "mist"}
                onChange={(v) => saveSetting("background", v)}
                options={BACKGROUNDS}
              />
            </div>
            <div className="sy-swatches mt-3" aria-label="Background swatches">
              {BACKGROUNDS.map((b) => (
                <button
                  key={b.value}
                  type="button"
                  className={cx("sy-swatch", b.value)}
                  aria-pressed={(s.background || "mist") === b.value}
                  onClick={() => saveSetting("background", b.value)}
                >
                  <span>{b.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="py-3 border-t border-line">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] font-medium">Theme</div>
                <div className="text-[12px] text-faint">{s.theme === "system" ? "Follows your macOS appearance" : `Always ${s.theme}`}</div>
              </div>
              <Segmented
                label="Theme"
                value={s.theme}
                onChange={(v) => saveSetting("theme", v)}
                options={THEMES}
              />
            </div>
            <div className="grid grid-cols-3 gap-2.5 mt-3" aria-label="Theme swatches">
              {THEMES.map((th) => (
                <button
                  key={th.value}
                  type="button"
                  className={cx("sy-swatch", th.swatchClass)}
                  aria-pressed={s.theme === th.value}
                  onClick={() => saveSetting("theme", th.value)}
                >
                  <span>{th.label}</span>
                </button>
              ))}
            </div>
          </div>

          <Row label="Reduce motion" hint="Disables background wandering and smooth rises. Also follows system.">
            <Toggle label="Reduce motion" checked={s.motion === "reduced"} onChange={(v) => saveSetting("motion", v ? "reduced" : "system")} />
          </Row>
        </Group>

        <Group id="handoff" title="Copy" description="What Copy puts on the clipboard. No AI is used: the levels are fixed rules.">
          <Row label="Default destination">
            <TargetSelect value={s.defaultTarget} onChange={(v) => saveSetting("defaultTarget", v)} className="w-56" />
          </Row>
          <Row label="Tool activity" hint="How tool calls and outputs appear in copies.">
            <Segmented label="Tool activity" value={s.toolDetail} onChange={(v) => saveSetting("toolDetail", v)} options={[{ value: "truncated", label: "Trimmed" }, { value: "full", label: "Full" }, { value: "omit", label: "Leave out" }]} />
          </Row>
          <Row label="How much to include" hint="Full is everything; Balanced keeps every request and recent messages; Minimal is goal, latest exchange and key references.">
            <Segmented label="Default level" value={s.level} onChange={(v) => saveSetting("level", v)} options={[{ value: "full", label: "Full" }, { value: "balanced", label: "Balanced" }, { value: "minimal", label: "Minimal" }]} />
          </Row>
          <Row label="Delivery" hint="Copy and export only. Hopilo never submits a message.">
            <span className="text-[12.5px] text-muted">Draft only</span>
          </Row>
        </Group>

        <Group id="sources" title="Sources" description="Coding agents Hopilo reads on this Mac. Their files are only read, never changed.">
          {info.data?.adapters.map((a) => (
            <Row key={a.id} label={a.displayName} hint={a.roots.join(" · ")}>
              {a.available ? <Badge tone="success">Found</Badge> : <span className="text-[12.5px] text-faint">Not installed</span>}
            </Row>
          ))}
          <Row label="Web chats" hint="ChatGPT, Claude, Gemini, DeepSeek, Grok and Perplexity, through the browser extension.">
            <Button size="sm" onClick={() => useApp.getState().navigate({ page: "browser" })}>Set up</Button>
          </Row>
        </Group>

        <Group id="privacy" title="Privacy" description="What Hopilo can see and send.">
          <Row label="Network" hint="No accounts, analytics, telemetry, AI calls or update checks.">
            <span className="text-[12.5px] text-success">Nothing leaves your Mac</span>
          </Row>
          <Row label="Clipboard" hint="Read only when you choose Clipboard in Add.">
            <span className="text-[12.5px] text-muted">On request</span>
          </Row>
          <Row label="Sensitive-data check" hint="Warns about keys, tokens and emails when you copy.">
            <span className="text-[12.5px] text-muted">Always on</span>
          </Row>
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
          <Row label="Verify library" hint="Re-checks every stored file against its fingerprint.">
            <Button
              size="sm"
              onClick={async () => {
                const r = await api.auditLibrary();
                const problems = [...r.versionProblems, ...r.attachmentProblems];
                toast({
                  kind: problems.length || r.database !== "ok" ? "warning" : "success",
                  text: problems.length || r.database !== "ok"
                    ? `Found ${problems.length} problem(s): ${problems.slice(0, 3).join("; ")}${r.database !== "ok" ? `; database: ${r.database}` : ""}`
                    : `All good: ${r.attachmentsChecked} files match their fingerprints.`,
                });
              }}
            >
              Verify
            </Button>
          </Row>
          <Row label="Erase library" hint="Deletes every session, file and log in Hopilo. Coding-agent sessions come back from their files on the next check.">
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                if (!(await ask("Erase every session, file and copy record in Hopilo? This cannot be undone. Your coding agents' own session files are not affected.", { title: "Erase library", kind: "warning" }))) return;
                await api.wipeLibrary();
                toast({ kind: "success", text: "Library erased." });
              }}
            >
              Erase…
            </Button>
          </Row>
        </Group>

        <Group id="about" title="About" description="Hopilo: every AI session in one place.">
          <Row label="Version">
            {info.data ? <span className="font-mono text-[12.5px] text-muted">{info.data.version}</span> : <Skeleton className="h-3 w-12" />}
          </Row>
          <Row label="Export format" hint="Markdown, JSON and the .handoff archive (v1)">
            <span className="text-[12.5px] text-muted">Open, documented</span>
          </Row>
        </Group>
      </div>
    </div>
  );
}
