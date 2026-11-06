import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { saveSetting, useBootstrap } from "../lib/hooks";
import { type Settings, useApp } from "../lib/store";
import { autostartLabel, isLinux, trayIconLabel, trayLabel } from "../lib/platform";
import { Button, Segmented, Toggle } from "../components/ui";
import { BackgroundLayer } from "../components/Flow";

export function Welcome() {
  const ready = useBootstrap();
  const settings = useApp((s) => s.settings);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const shown = useRef(false);
  const bg = settings.background ?? "mist";

  useEffect(() => {
    isEnabled().then(setAutostart).catch(() => setAutostart(null));
  }, []);

  useLayoutEffect(() => {
    if (!ready || shown.current || !root.current) return;
    shown.current = true;
    const height = root.current.getBoundingClientRect().height;
    invoke("app_ready", { height }).catch(() => undefined);
  }, [ready]);

  if (!ready) return null;

  const toggleAutostart = async (v: boolean) => {
    setAutostart(v);
    try {
      await (v ? enable() : disable());
    } catch {
      setAutostart(await isEnabled().catch(() => null));
    }
  };

  return (
    <div ref={root} className="app relative flex flex-col overflow-hidden px-[22px] pt-[22px] pb-[22px] text-ink min-h-full" data-bg={bg}>
      <BackgroundLayer />
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-8 z-10" />
      <header data-tauri-drag-region className="relative z-10 flex flex-col items-center gap-2.5 pb-5 text-center">
        <img src="/hopilo-mark.svg" alt="" draggable={false} className="pointer-events-none h-[58px] w-[58px] drop-shadow-[0_4px_10px_rgb(40_30_120/0.25)]" />
        <h1 className="font-display text-[20px] font-bold">Welcome to Hopilo</h1>
        <p className="max-w-[300px] text-[12.5px] text-muted">
          Every AI session in one place. Hopilo lives in the {trayLabel.toLowerCase()}: click its icon any time to copy a session or open the dashboard.
        </p>
      </header>

      <section className="relative z-10 space-y-2.5 rounded-xl border border-line bg-surface-2/50 p-3">
        <h2 className="text-[13px] font-semibold">Quick setup</h2>
        <Line label={autostartLabel}>
          <Toggle label={autostartLabel} checked={!!autostart} disabled={autostart === null} onChange={toggleAutostart} />
        </Line>
        {!isLinux && (
          <Line label="Icon click">
            <Segmented<Settings["trayClick"]>
              label={`${trayIconLabel} click`}
              className="shrink-0 [&>button]:whitespace-nowrap"
              value={settings.trayClick}
              onChange={(v) => saveSetting("trayClick", v)}
              options={[
                { value: "panel", label: "Quick Panel" },
                { value: "dashboard", label: "Dashboard" },
              ]}
            />
          </Line>
        )}
        <Line label="Appearance">
          <Segmented<Settings["theme"]>
            label="Appearance"
            className="shrink-0 [&>button]:whitespace-nowrap"
            value={settings.theme}
            onChange={(v) => saveSetting("theme", v)}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </Line>
      </section>

      <div className="relative z-10 mt-4">
        <Button variant="primary" className="w-full" onClick={() => invoke("finish_welcome").catch(() => undefined)}>
          Get Started
        </Button>
      </div>
      <p className="relative z-10 mt-2.5 text-center text-[11px] text-faint">Open Settings any time from the {trayIconLabel.toLowerCase()}.</p>
    </div>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3">
      <span className="whitespace-nowrap text-[12.5px]">{label}</span>
      {children}
    </div>
  );
}
