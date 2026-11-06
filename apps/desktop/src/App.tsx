import { lazy, Suspense, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type Route, routeFrom, useApp } from "./lib/store";
import { useBootstrap } from "./lib/hooks";
import { useFileDrop } from "./lib/useFileDrop";
import { Shell } from "./components/Shell";
import { FileImportModal } from "./components/FileImport";
import { Overview } from "./pages/Overview";
import { Sessions } from "./pages/Sessions";
import { RouteSkeleton } from "./components/Skeletons";
import { ErrorBoundary } from "./components/ErrorBoundary";

const Browser = lazy(() => import("./pages/Browser").then((m) => ({ default: m.Browser })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
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
  }
}

export function App() {
  const ready = useBootstrap();
  const route = useApp((s) => s.route);
  const navigate = useApp((s) => s.navigate);
  const [dropped, setDropped] = useState<string[] | null>(null);
  const hovering = useFileDrop((paths) => setDropped(paths));
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

    const unVis = listen<boolean>("hopilo://visibility", ({ payload }) => {
      if (payload) markVisible();
    });

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
    const un = listen<string>("hopilo://navigate", (e) => navigate(routeFrom(e.payload)));
    return () => {
      un.then((f) => f());
    };
  }, [navigate]);

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
