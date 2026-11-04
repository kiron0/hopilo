import { lazy, Suspense, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { type Route, routeFrom, useApp } from "./lib/store";
import { useBootstrap } from "./lib/hooks";
import { useFileDrop } from "./lib/useFileDrop";
import { Shell } from "./components/Shell";
import { FileImportModal } from "./components/FileImport";
import { Home } from "./pages/Home";
import { Sessions } from "./pages/Sessions";
import { RouteSkeleton } from "./components/Skeletons";
import { ErrorBoundary } from "./components/ErrorBoundary";

const Browser = lazy(() => import("./pages/Browser").then((m) => ({ default: m.Browser })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
import { FileDown } from "./components/Icons";

function Page({ route }: { route: Route }) {
  switch (route.page) {
    case "home":
      return <Home />;
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

  if (!ready) return null;
  return (
    <>
      <Shell>
        <ErrorBoundary key={route.page} onHome={() => navigate({ page: "home" })}>
          <Suspense fallback={<RouteSkeleton page={route.page} />}>
            <Page route={route} />
          </Suspense>
        </ErrorBoundary>
      </Shell>
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
