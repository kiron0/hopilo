import { useEffect, useState } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  CheckCircle2,
  CheckIcon,
  Coffee,
  ExternalLink,
  FolderOpen,
  Github,
  Heart,
  Loader2,
  RefreshCw,
  SparkIcon,
} from "../components/Icons";
import { SETTINGS_GROUPS, settingsGroupFor } from "../components/settingsNav";
import { api, errorText } from "../lib/api";
import { bytes } from "../lib/format";
import { saveSetting, useLoad } from "../lib/hooks";
import { useApp } from "../lib/store";
import {
  isMac,
  isLinux,
  isWindows,
  platformName,
  deviceNoun,
  fileManagerLabel,
  autostartLabel,
} from "../lib/platform";
import {
  AUTHOR_NAME,
  AUTHOR_PORTFOLIO,
  BUY_ME_A_COFFEE_URL,
  REPOSITORY_URL,
  ISSUES_URL,
  checkInAppUpdate,
  openExternal,
  type UpdateCheckResult,
} from "../lib/updates";
import { UpdateModal } from "../components/UpdateModal";
import { AlertDialog, Badge, Button, Card, PageHeader, SectionLabel, Segmented, Skeleton, TargetSelect, Toggle, cx } from "../components/ui";

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

function Group({ id, title, children }: { id: string; title?: string; children: React.ReactNode }) {
  return (
    <section id={`settings-${id}`} aria-label={title} className="scroll-mt-4 pb-6 last:pb-0">
      {title && <SectionLabel>{title}</SectionLabel>}
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
  const info = useLoad(() => api.appInfo(), [], { refreshOnChange: false });
  const stats = useLoad(() => api.stats());
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateCheckResult>({
    status: "idle",
    currentVersion: "",
  });
  const [showUpdateModal, setShowUpdateModal] = useState(false);

  useEffect(() => {
    isEnabled().then(setAutostart).catch(() => setAutostart(null));
  }, []);

  useEffect(() => {
    if (info.data?.version) {
      setUpdateState((prev) => ({ ...prev, currentVersion: info.data!.version }));
    }
  }, [info.data?.version]);

  const runUpdateCheck = async () => {
    setUpdateState((prev) => ({ ...prev, status: "checking" }));
    const ver = info.data?.version ?? (await api.appInfo().then((a) => a.version).catch(() => "0.0.0"));
    const res = await checkInAppUpdate(ver);
    setUpdateState(res);
    if (res.status === "available") {
      setShowUpdateModal(true);
    } else if (res.status === "upToDate") {
      toast({ kind: "success", text: `Hopilo is up to date (v${ver}).` });
    } else if (res.status === "error") {
      toast({ kind: "warning", text: res.error ?? "Could not check for updates." });
    }
  };

  const section = useApp((st) => (st.route.page === "settings" ? st.route.section : undefined));
  const tab = settingsGroupFor(section);
  useEffect(() => {
    requestAnimationFrame(() => {
      const target = section && document.getElementById(`settings-${section}`);
      if (target) target.scrollIntoView({ block: "start" });
      else document.querySelector(".cleanly-main")?.scrollTo({ top: 0 });
    });
  }, [section]);

  const subtitles: Record<typeof tab, string> = {
    general: "Startup and window behavior. Changes save immediately.",
    customize: "Window canvas, theme and animations, and what Copy puts on the clipboard. Changes save immediately.",
    sources: `Coding agents Hopilo reads on this ${deviceNoun}. Their files are only read, never changed.`,
    data: `What Hopilo can see and send, and the one folder on this ${deviceNoun} where your library lives.`,
    about: "Hopilo: every AI session in one place.",
  };

  return (
    <div className="space-y-4 pb-6">
      <PageHeader title={SETTINGS_GROUPS.find((g) => g.id === tab)?.label ?? "Settings"} subtitle={subtitles[tab]} />
      <div>
        {tab === "general" && (
        <Group id="general">
          <Row
            label={autostartLabel}
            hint={
              autostart === null
                ? "Not supported in this environment."
                : isMac
                ? "Start Hopilo in the menu bar when you log in."
                : isWindows
                ? "Start Hopilo in the system tray when you sign in to Windows."
                : "Start Hopilo in the system tray when you log in."
            }
          >
            <Toggle
              label={autostartLabel}
              checked={!!autostart}
              disabled={autostart === null}
              onChange={async (v) => {
                // Flip at once; turning it off removes the login item.
                setAutostart(v);
                try {
                  await (v ? enable() : disable());
                } catch (e) {
                  toast({ kind: "error", text: errorText(e) });
                  setAutostart(await isEnabled().catch(() => !v));
                }
              }}
            />
          </Row>
          {/* Linux trays only open their menu on click, so there is no click to configure. */}
          {!isLinux && (
            <Row
              label={isMac ? "Menu-bar icon click" : "System tray icon click"}
              hint={`Closing the dashboard keeps Hopilo running in the ${isMac ? "menu bar" : "system tray"}.`}
            >
              <Segmented
                label="Tray click"
                value={s.trayClick}
                onChange={(v) => saveSetting("trayClick", v)}
                options={[
                  { value: "panel", label: "Quick Panel" },
                  { value: "dashboard", label: "Dashboard" },
                ]}
              />
            </Row>
          )}
        </Group>
        )}

        {tab === "customize" && (
        <>
        <Group id="appearance" title="Appearance">
          <div className="py-3">
            <div>
              <div className="text-[13px] font-medium">Background</div>
              <div className="text-[12px] text-faint">The living canvas behind the dashboard and sidebar.</div>
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
            <div>
              <div className="text-[13px] font-medium">Theme</div>
              <div className="text-[12px] text-faint">{s.theme === "system" ? `Follows your ${platformName} appearance` : `Always ${s.theme}`}</div>
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

        <Group id="handoff" title="Copy">
          <Row label="Default destination">
            <TargetSelect value={s.defaultTarget} onChange={(v) => saveSetting("defaultTarget", v)} className="w-56" />
          </Row>
          <Row label="Tool activity" hint="How tool calls and outputs appear in copies.">
            <Segmented label="Tool activity" value={s.toolDetail} onChange={(v) => saveSetting("toolDetail", v)} options={[{ value: "truncated", label: "Trimmed" }, { value: "full", label: "Full" }, { value: "omit", label: "Leave out" }]} />
          </Row>
          <Row label="How much to include" hint="Full is everything; Balanced keeps every request and recent messages; Minimal is goal, latest exchange and key references. No AI is used: the levels are fixed rules.">
            <Segmented label="Default level" value={s.level} onChange={(v) => saveSetting("level", v)} options={[{ value: "full", label: "Full" }, { value: "balanced", label: "Balanced" }, { value: "minimal", label: "Minimal" }]} />
          </Row>
        </Group>
        </>
        )}

        {tab === "sources" && (
        <Group id="sources">
          {info.data?.adapters.map((a) => (
            <Row key={a.id} label={a.displayName} hint={a.roots.join(" · ")}>
              {a.available ? <Badge tone="success">Found</Badge> : <span className="text-[12.5px] text-faint">Not installed</span>}
            </Row>
          ))}
          <Row label="Web chats" hint="Claude, Gemini, DeepSeek, Grok and Perplexity, through the browser extension.">
            <Button size="sm" onClick={() => useApp.getState().navigate({ page: "browser" })}>Set up</Button>
          </Row>
        </Group>
        )}

        {tab === "data" && (
        <>
        <Group id="privacy" title="Privacy">
          <Row label="Network" hint="100% offline. No accounts, analytics, telemetry or AI calls. Only Check for Updates contacts GitHub, when you click it.">
            <span className="text-[12.5px] font-medium text-success">{`100% Offline · Nothing leaves your ${deviceNoun}`}</span>
          </Row>
          <Row label="Clipboard" hint="Read only when you save the clipboard as a session. Hopilo never submits a message: copies are drafts you paste yourself.">
            <span className="text-[12.5px] text-muted">On request</span>
          </Row>
          <Row label="Sensitive-data check" hint="Warns about keys, tokens and emails when you copy.">
            <span className="text-[12.5px] text-muted">Always on</span>
          </Row>
        </Group>

        <Group id="storage" title="Storage">
          <Row label="Data folder" hint={info.data?.dataDir}>
            <Button size="sm" icon={<FolderOpen size={13} />} disabled={!info.data} onClick={() => info.data && revealItemInDir(`${info.data.dataDir}/hopilo.db`)}>
              {`Show in ${fileManagerLabel}`}
            </Button>
          </Row>
          <Row label="Space used">
            {stats.data ? <span className="text-[12.5px] text-muted">{bytes(stats.data.storageBytes)}</span> : <Skeleton className="h-3 w-14" />}
          </Row>
          <Row label="Verify library" hint="Verifies the integrity of all saved files in your library.">
            <Button
              size="sm"
              disabled={verifying}
              icon={verifying ? <Loader2 size={13} className="animate-spin" /> : undefined}
              onClick={async () => {
                setVerifying(true);
                try {
                  const r = await api.auditLibrary();
                  const problems = [...r.versionProblems, ...r.attachmentProblems];
                  toast({
                    kind: problems.length || r.database !== "ok" ? "warning" : "success",
                    text: problems.length || r.database !== "ok"
                      ? `Found ${problems.length} problem(s): ${problems.slice(0, 3).join("; ")}${r.database !== "ok" ? `; status: ${r.database}` : ""}`
                      : `All good: library intact, all ${r.attachmentsChecked} saved files verified.`,
                  });
                } catch (e) {
                  toast({ kind: "error", text: `Could not verify the library: ${errorText(e)}` });
                } finally {
                  setVerifying(false);
                }
              }}
            >
              {verifying ? "Verifying…" : "Verify"}
            </Button>
          </Row>
          <Row label="Erase library" hint="Deletes every session, file and log in Hopilo. Coding-agent sessions come back from their files on the next check.">
            <Button
              size="sm"
              variant="danger"
              onClick={() => setConfirmErase(true)}
            >
              Erase…
            </Button>
          </Row>
        </Group>
        </>
        )}

        {tab === "about" && (
        <Group id="about">
          <div className="py-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-line bg-gradient-to-br from-accent-soft/30 via-surface to-surface p-4 shadow-item">
              <div className="flex items-center gap-3.5 min-w-0">
                <img
                  src="/hopilo-mark.svg"
                  alt="Hopilo"
                  className="h-12 w-12 shrink-0 drop-shadow-[0_4px_10px_rgb(40_30_120/0.2)]"
                  draggable={false}
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-[18px] font-bold tracking-tight">Hopilo</span>
                    <span className="rounded-full bg-accent-soft px-2.5 py-0.5 font-mono text-[10.5px] font-bold text-accent">
                      VERSION {info.data ? info.data.version : "…"}
                    </span>
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-500 border border-emerald-500/20">
                      100% OFFLINE
                    </span>
                  </div>
                  <div className="mt-0.5 text-[12px] text-muted">
                    Universal AI Session Handoff · 100% Offline & Local-First
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-faint">
                    {updateState.status === "checking" && (
                      <>
                        <Loader2 size={12} className="animate-spin text-accent" />
                        <span>Checking for updates…</span>
                      </>
                    )}
                    {updateState.status === "upToDate" && (
                      <>
                        <CheckCircle2 size={12} className="text-success" />
                        <span className="text-success">Up to date</span>
                      </>
                    )}
                    {updateState.status === "available" && (
                      <>
                        <SparkIcon size={12} className="text-accent" />
                        <span className="font-semibold text-accent">Version {updateState.update?.version} available</span>
                      </>
                    )}
                    {updateState.status === "error" && (
                      <>
                        <AlertTriangle size={12} className="text-warning" />
                        <span className="text-warning font-medium">
                          {updateState.error?.toLowerCase().includes("offline") ? "Offline · check paused" : "Check failed"}
                        </span>
                      </>
                    )}
                    {updateState.status === "idle" && (
                      <>
                        <CheckIcon size={12} className="text-muted" />
                        <span>Secure in-app updates</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {updateState.status === "available" ? (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<SparkIcon size={13} />}
                    onClick={() => setShowUpdateModal(true)}
                  >
                    View Update
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    busy={updateState.status === "checking"}
                    icon={<RefreshCw size={13} className={updateState.status === "checking" ? "animate-spin" : ""} />}
                    onClick={runUpdateCheck}
                  >
                    Check for Updates
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="py-4">
            <div className="mb-2.5 text-[11px] font-semibold tracking-wider text-faint uppercase">Why Hopilo</div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <div className="rounded-xl border border-line bg-card p-3 shadow-item">
                <div className="font-semibold text-[12.5px] flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <span>100% Offline</span>
                </div>
                <div className="mt-1 text-[11px] leading-relaxed text-muted">
                  Everything runs locally on your device with fast storage.
                </div>
              </div>
              <div className="rounded-xl border border-line bg-card p-3 shadow-item">
                <div className="font-semibold text-[12.5px]">100% Private</div>
                <div className="mt-1 text-[11px] leading-relaxed text-muted">
                  {`No accounts, no telemetry, stays on your ${deviceNoun}.`}
                </div>
              </div>
              <div className="rounded-xl border border-line bg-card p-3 shadow-item">
                <div className="font-semibold text-[12.5px]">Open & Documented</div>
                <div className="mt-1 text-[11px] leading-relaxed text-muted">
                  Open source with standard Markdown & .handoff files.
                </div>
              </div>
            </div>
          </div>

          <div className="py-4">
            <div className="mb-2.5 text-[11px] font-semibold tracking-wider text-faint uppercase">Resources & Support</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => openExternal(BUY_ME_A_COFFEE_URL)}
                className="group flex flex-col justify-between rounded-xl border border-line bg-card p-3.5 text-left shadow-item transition-all hover:-translate-y-0.5 hover:border-amber-400/50 hover:shadow-card cursor-pointer"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 transition-colors group-hover:bg-amber-500 group-hover:text-white">
                    <Coffee size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 font-semibold text-[13px]">
                      <span>Buy Me a Coffee</span>
                      <ExternalLink size={12} className="text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-muted">
                      Support independent open-source development.
                    </p>
                  </div>
                </div>
                <div className="mt-3 font-mono text-[11px] font-medium text-amber-600 dark:text-amber-400">
                  buymeacoffee.com/_thk
                </div>
              </button>

              <button
                type="button"
                onClick={() => openExternal(ISSUES_URL)}
                className="group flex flex-col justify-between rounded-xl border border-line bg-card p-3.5 text-left shadow-item transition-all hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-card cursor-pointer"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent transition-colors group-hover:bg-accent group-hover:text-white">
                    <Github size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 font-semibold text-[13px]">
                      <span>GitHub & Issues</span>
                      <ExternalLink size={12} className="text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-muted">
                      Report a bug, suggest features, or star the repo.
                    </p>
                  </div>
                </div>
                <div className="mt-3 font-mono text-[11px] font-medium text-accent">
                  github.com/kiron0/hopilo
                </div>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 py-3 text-[12px] text-muted border-t border-line">
            <div className="flex items-center gap-1.5">
              <span>Designed and built with</span>
              <Heart size={13} className="text-red-500 fill-red-500 inline" />
              <span>by</span>
              <button
                type="button"
                onClick={() => openExternal(AUTHOR_PORTFOLIO)}
                className="font-semibold text-ink underline decoration-line-strong underline-offset-2 transition-colors hover:text-accent cursor-pointer"
              >
                {AUTHOR_NAME}
              </button>
            </div>

            <div className="flex items-center gap-3 text-[11.5px]">
              <button
                type="button"
                onClick={() => openExternal(AUTHOR_PORTFOLIO)}
                className="text-muted transition-colors hover:text-ink cursor-pointer"
              >
                Portfolio
              </button>
              <span className="text-faint">•</span>
              <button
                type="button"
                onClick={() => openExternal(REPOSITORY_URL)}
                className="text-muted transition-colors hover:text-ink cursor-pointer"
              >
                GitHub
              </button>
              <span className="text-faint">•</span>
              <button
                type="button"
                onClick={() => openExternal(BUY_ME_A_COFFEE_URL)}
                className="text-muted transition-colors hover:text-ink cursor-pointer"
              >
                Buy Me a Coffee
              </button>
            </div>
          </div>
        </Group>
        )}
      </div>

      {showUpdateModal && updateState.update && (
        <UpdateModal
          update={updateState.update}
          currentVersion={info.data?.version ?? updateState.currentVersion}
          onClose={() => setShowUpdateModal(false)}
        />
      )}

      {confirmErase && (
        <AlertDialog
          title="Erase library"
          description="Erase every session, file and copy record in Hopilo? This cannot be undone. Your coding agents' own session files are not affected."
          confirmLabel="Erase library"
          destructive
          onClose={() => setConfirmErase(false)}
          onConfirm={async () => {
            try {
              await api.wipeLibrary();
              setConfirmErase(false);
              toast({ kind: "success", text: "Library erased." });
            } catch (e) {
              toast({ kind: "error", text: errorText(e) });
            }
          }}
        />
      )}
    </div>
  );
}
