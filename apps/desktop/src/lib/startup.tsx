import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";

export const STARTUP_TIMEOUT_MS = 8000;

type Startup = { begin: () => () => void; commit: (ready: boolean) => void };
const StartupContext = createContext<Startup | null>(null);

export function StartupProvider({ ready, onReady, children }: { ready: boolean; onReady: () => void; children: ReactNode }) {
  const pending = useRef(new Set<symbol>());
  const completed = useRef(false);
  const [revision, changed] = useReducer((n: number) => n + 1, 0);
  const [committed, commit] = useState(false);
  const begin = useCallback(() => {
    if (completed.current) return () => {};
    const token = Symbol();
    pending.current.add(token); changed();
    return () => { if (pending.current.delete(token) && !completed.current) changed(); };
  }, []);
  const value = useMemo(() => ({ begin, commit }), [begin]);
  useEffect(() => {
    if (!ready || !committed || completed.current || pending.current.size) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (pending.current.size || completed.current) return;
        completed.current = true;
        onReady();
      });
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [ready, committed, revision, onReady]);
  useEffect(() => {
    if (!ready || completed.current) return;
    const timer = setTimeout(() => {
      if (completed.current) return;
      completed.current = true;
      onReady();
    }, STARTUP_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [ready, onReady]);
  return <StartupContext.Provider value={value}>{children}</StartupContext.Provider>;
}
export function useStartupLoad(pending: boolean) {
  const startup = useContext(StartupContext);
  useLayoutEffect(() => pending ? startup?.begin() : undefined, [pending, startup]);
}
export function StartupPageReady() {
  const startup = useContext(StartupContext);
  useLayoutEffect(() => { startup?.commit(true); return () => startup?.commit(false); }, [startup]);
  return null;
}
