import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { QuickPanel } from "./quick/QuickPanel";
import { ErrorBoundary } from "./components/ErrorBoundary";

if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window && (window as any).__TAURI_INTERNALS__?.invoke)) {
  const { installMockIpc } = await import("./dev/mockIpc");
  installMockIpc();
  (window as { __HOPILO_MOCK__?: boolean }).__HOPILO_MOCK__ = true;
}

const surface = new URLSearchParams(window.location.search).get("surface");
if (surface === "quick") document.body.classList.add("quick-surface");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>{surface === "quick" ? <QuickPanel /> : <App />}</ErrorBoundary>
  </StrictMode>,
);
