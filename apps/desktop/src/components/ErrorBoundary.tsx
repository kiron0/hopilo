import { Component, type ReactNode } from "react";
import { AlertTriangle } from "./Icons";
import { Button, Card } from "./ui";

const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|Failed to fetch|ChunkLoadError/i;
const RETRY_KEY = "hopilo.chunkRetry";

export class ErrorBoundary extends Component<{ children: ReactNode; onHome?: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (!CHUNK_ERROR.test(error.message)) return;

    let last = 0;
    try {
      last = Number(sessionStorage.getItem(RETRY_KEY) ?? 0);
      sessionStorage.setItem(RETRY_KEY, String(Date.now()));
    } catch {
      return;
    }
    if (Date.now() - last > 10_000) window.location.reload();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <Card className="mx-auto mt-10 max-w-lg p-6 text-center" role="alert">
        <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-warning-soft text-warning">
          <AlertTriangle size={20} />
        </span>
        <h2 className="font-semibold">This screen couldn't load</h2>
        <p className="mt-1 text-muted">Your library is safe. Reload to try again.</p>
        <p data-selectable className="mt-3 truncate font-mono text-[11.5px] text-faint">{error.message}</p>
        <div className="mt-5 flex justify-center gap-2">
          {this.props.onHome && (
            <Button
              onClick={() => {
                this.setState({ error: null });
                this.props.onHome?.();
              }}
            >
              Go to Home
            </Button>
          )}
          <Button variant="primary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </Card>
    );
  }
}
