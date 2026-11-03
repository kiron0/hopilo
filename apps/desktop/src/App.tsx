import { lazy, Suspense, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { type Route, useApp } from "./lib/store";
import { useBootstrap } from "./lib/hooks";
import { useFileDrop } from "./lib/useFileDrop";
import { Shell } from "./components/Shell";
import { FileImportModal } from "./components/FileImport";
import { Dashboard } from "./pages/Dashboard";
import { attachmentDraftItem } from "./lib/draftItems";
import { RouteSkeleton } from "./components/Skeletons";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Home loads with the app; other screens load on first visit and are then
// cached by the browser, keeping startup light.
const QuickCapture = lazy(() => import("./pages/QuickCapture").then((m) => ({ default: m.QuickCapture })));
const Sessions = lazy(() => import("./pages/Sessions").then((m) => ({ default: m.Sessions })));
const Packs = lazy(() => import("./pages/Packs").then((m) => ({ default: m.Packs })));
const Attachments = lazy(() => import("./pages/Attachments").then((m) => ({ default: m.Attachments })));
const Builder = lazy(() => import("./pages/Builder").then((m) => ({ default: m.Builder })));
const Handoff = lazy(() => import("./pages/Handoff").then((m) => ({ default: m.Handoff })));
const Agents = lazy(() => import("./pages/Agents").then((m) => ({ default: m.Agents })));
const Browser = lazy(() => import("./pages/Browser").then((m) => ({ default: m.Browser })));
const ContextMap = lazy(() => import("./pages/ContextMap").then((m) => ({ default: m.ContextMap })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
import { FileDown } from "lucide-react";

function Page({ route }: { route: Route }) {
  switch (route.page) {
    case "dashboard":
      return <Dashboard />;
    case "capture":
      return <QuickCapture />;
    case "sessions":
      return <Sessions />;
    case "packs":
      return <Packs />;
    case "attachments":
      return <Attachments />;
    case "builder":
      return <Builder />;
    case "handoff":
      return <Handoff />;
    case "agents":
      return <Agents />;
    case "browser":
      return <Browser />;
    case "map":
      return <ContextMap />;
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
    const un = listen<string>("hopilo://navigate", (e) => navigate({ page: e.payload } as Route));
    return () => {
      un.then((f) => f());
    };
  }, [navigate]);

  // Ask the shell to show the window only once real content has painted.
  useEffect(() => {
    if (!ready) return;
    requestAnimationFrame(() => requestAnimationFrame(() => invoke("app_ready").catch(() => undefined)));
  }, [ready]);

  if (!ready) return null;
  return (
    <>
      <Shell>
        <ErrorBoundary key={route.page} onHome={() => navigate({ page: "dashboard" })}>
          <Suspense fallback={<RouteSkeleton page={route.page} />}>
            <Page route={route} />
          </Suspense>
        </ErrorBoundary>
      </Shell>
      {hovering && !dropped && (
        <div className="pointer-events-none fixed inset-3 z-40 flex items-center justify-center rounded-3xl border-2 border-dashed border-accent bg-accent-soft/80 backdrop-blur-sm">
          <div className="flex flex-col items-center text-accent">
            <FileDown size={28} />
            <div className="mt-2 text-[15px] font-semibold">Drop to review and import</div>
            <div className="text-[12.5px] text-muted">{route.page === "builder" ? "Files will be added to this pack" : "Files go to your library"}</div>
          </div>
        </div>
      )}
      {dropped && (
        <FileImportModal
          paths={dropped}
          onClose={() => setDropped(null)}
          onImported={(atts) => {
            if (useApp.getState().route.page === "builder") useApp.getState().addToDraft(atts.map(attachmentDraftItem));
          }}
        />
      )}
    </>
  );
}
