import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { ErrorBoundary } from "./components/ErrorBoundary";

if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window && (window as any).__TAURI_INTERNALS__?.invoke)) {
  const { installMockIpc } = await import("./dev/mockIpc");
  installMockIpc();
  (window as { __HOPILO_MOCK__?: boolean }).__HOPILO_MOCK__ = true;
}

const surface = new URLSearchParams(window.location.search).get("surface");
if (surface === "quick") document.body.classList.add("quick-surface");
if (surface === "welcome") document.body.classList.add("welcome-surface");

const Root =
  surface === "quick"
    ? (await import("./quick/QuickPanel")).QuickPanel
    : surface === "welcome"
      ? (await import("./welcome/Welcome")).Welcome
      : (await import("./App")).App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);
