import { lazy, Suspense, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type Route, routeFrom, useApp } from "./lib/store";
import { ownWindowLabel, useBootstrap } from "./lib/hooks";
import { api, errorText, type BundleImport, type LatestCopied } from "./lib/api";
import { plural } from "./lib/format";
import { useFileDrop } from "./lib/useFileDrop";
import { Shell } from "./components/Shell";
import { FileImportModal } from "./components/FileImport";
import { Overview } from "./pages/Overview";
import { Sessions } from "./pages/Sessions";
import { RouteSkeleton } from "./components/Skeletons";
import { ErrorBoundary } from "./components/ErrorBoundary";

const Browser = lazy(() => import("./pages/Browser").then((m) => ({ default: m.Browser })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const Compare = lazy(() => import("./pages/Compare").then((m) => ({ default: m.Compare })));
import { FileDown } from "./components/Icons";

function Page({ route }: { route: Route }) {
  switch (route.page) {
    case "overview":
    case "home":
      return <Overview />;
    case "sessions":
      return <Sessions />;
    case "browser":
      return <Browser />;
    case "settings":
      return <Settings />;
    case "compare":
      return <Compare />;
  }
}

export function App() {
  const ready = useBootstrap();
  const route = useApp((s) => s.route);
  const navigate = useApp((s) => s.navigate);
  const [dropped, setDropped] = useState<string[] | null>(null);
  const hovering = useFileDrop((paths) => {
    const isBundle = (p: string) => /\.(hopilo|handoff)$/i.test(p);
    const bundles = paths.filter(isBundle);
    const rest = paths.filter((p) => !isBundle(p));
    if (bundles.length) void importBundles(bundles);
    if (rest.length) setDropped(rest);
  });
  const [hasBeenVisible, setHasBeenVisible] = useState(false);
  const [minDelayPassed, setMinDelayPassed] = useState(false);
  const [splashVisible, setSplashVisible] = useState(true);
  const [splashFading, setSplashFading] = useState(false);

  useEffect(() => {
    const markVisible = () => setHasBeenVisible(true);

    getCurrentWindow()
      .isVisible()
      .then((v) => {
        if (v) markVisible();
      })
      .catch(() => undefined);

    const label = ownWindowLabel();
    const unVis = listen<boolean>(
      "hopilo://visibility",
      ({ payload }) => {
        if (payload) markVisible();
      },
      label ? { target: label } : undefined,
    );

    const unFocus = getCurrentWindow().onFocusChanged(({ payload }) => {
      if (payload) markVisible();
    });

    const onDocVis = () => {
      if (document.visibilityState === "visible") markVisible();
    };
    document.addEventListener("visibilitychange", onDocVis);
    window.addEventListener("focus", markVisible);

    return () => {
      unVis.then((f) => f());
      unFocus.then((f) => f());
      document.removeEventListener("visibilitychange", onDocVis);
      window.removeEventListener("focus", markVisible);
    };
  }, []);

  useEffect(() => {
    if (!hasBeenVisible) return;
    const timer = setTimeout(() => setMinDelayPassed(true), 1500);
    return () => clearTimeout(timer);
  }, [hasBeenVisible]);

  useEffect(() => {
    if (!ready || !minDelayPassed) return;
    setSplashFading(true);
    const timer = setTimeout(() => setSplashVisible(false), 280);
    return () => clearTimeout(timer);
  }, [ready, minDelayPassed]);

  useEffect(() => {
    const label = ownWindowLabel();
    const un = listen<string>("hopilo://navigate", (e) => navigate(routeFrom(e.payload)), label ? { target: label } : undefined);
    const toast = useApp.getState().toast;
    const unLatest = listen<LatestCopied>("hopilo://latest-copied", ({ payload: p }) => {
      if (p.source === "tray" && !document.hasFocus()) return;
      if (!p.ok) {
        toast({ key: "latest", kind: p.title ? "error" : "info", text: p.error ?? "Couldn't copy the latest session." });
        return;
      }
      const extra = [p.findings ? plural(p.findings, "possible secret") + " left in" : "", p.missing ? `${p.missing} part(s) not captured` : ""].filter(Boolean).join(", ");
      toast({
        key: "latest",
        kind: extra ? "warning" : "success",
        text: `Copied latest session: ${p.title}${extra ? ` · ${extra}` : ""}`,
        action: p.id ? { label: "Open", run: () => useApp.getState().navigate({ page: "sessions", id: p.id! }) } : undefined,
      });
    });
    const unBundle = listen<BundleImport>("hopilo://bundle-imported", ({ payload: p }) => {
      if (p.errors.length && !p.ids.length) {
        toast({ kind: "error", text: `Couldn't import: ${p.errors[0]}` });
        return;
      }
      const first = p.ids[0];
      toast({
        kind: p.errors.length ? "warning" : "success",
        text: `Imported ${plural(p.ids.length, "session")} from ${plural(p.files, "bundle")}${p.errors.length ? ` · ${p.errors.length} failed` : ""}.`,
        action: first ? { label: "Open", run: () => useApp.getState().navigate({ page: "sessions", id: first }) } : undefined,
      });
    });
    return () => {
      un.then((f) => f());
      unLatest.then((f) => f());
      unBundle.then((f) => f());
    };
  }, [navigate]);

  const importBundles = async (paths: string[]) => {
    const toast = useApp.getState().toast;
    toast({ kind: "loading", text: `Importing ${paths.length === 1 ? "bundle" : `${paths.length} bundles`}…`, key: "bundle" });
    const ids: string[] = [];
    const errors: string[] = [];
    for (const p of paths) {
      try {
        ids.push(...(await api.importHandoffFile(p)));
      } catch (e) {
        errors.push(errorText(e));
      }
    }
    if (ids.length) {
      toast({
        key: "bundle",
        kind: errors.length ? "warning" : "success",
        text: `Imported ${plural(ids.length, "session")}${errors.length ? ` · ${errors.length} failed` : ""}.`,
        action: { label: "Open", run: () => useApp.getState().navigate({ page: "sessions", id: ids[0] }) },
      });
    } else if (errors.length) {
      toast({ key: "bundle", kind: "error", text: `Import failed: ${errors[0]}` });
    }
  };

  useEffect(() => {
    if (!ready) return;
    requestAnimationFrame(() => requestAnimationFrame(() => invoke("app_ready").catch(() => undefined)));
  }, [ready]);

  return (
    <>
      {splashVisible && (
        <div
          id="splash"
          className={splashFading ? "splash-fading" : ""}
          aria-hidden="true"
          style={{ display: "flex" }}
        >
          <div className="splash-glow" />
          <div className="splash-body">
            <div className="splash-mark-wrap">
              <div className="splash-mark-halo" />
              <img src="/hopilo-mark.svg" alt="" className="splash-icon" draggable={false} />
            </div>
            <div className="splash-brand">
              <span className="splash-title">Hopilo</span>
            </div>
            <div className="splash-loader" />
          </div>
        </div>
      )}
      {ready && (
        <Shell>
          <ErrorBoundary key={route.page} onOverview={() => navigate({ page: "overview" })}>
            <Suspense fallback={<RouteSkeleton page={route.page} />}>
              <Page route={route} />
            </Suspense>
          </ErrorBoundary>
        </Shell>
      )}
      {hovering && !dropped && (
        <div className="pointer-events-none fixed inset-3 z-40 flex items-center justify-center rounded-3xl border-2 border-dashed border-accent bg-accent-soft/80 backdrop-blur-sm">
          <div className="flex flex-col items-center text-accent">
            <FileDown size={28} />
            <div className="mt-2 text-[15px] font-semibold">Drop to add files</div>
            <div className="text-[12.5px] text-muted">{route.page === "sessions" && route.id ? "They join this session" : "They become a new session"}</div>
          </div>
        </div>
      )}
      {dropped && (
        <FileImportModal paths={dropped} session={route.page === "sessions" ? (route.id ?? null) : null} onClose={() => setDropped(null)} />
      )}
    </>
  );
}
