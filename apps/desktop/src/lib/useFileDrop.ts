import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/** Native OS file drops onto the window (Tauri delivers paths, not bytes). */
export function useFileDrop(onDrop: (paths: string[]) => void, enabled = true) {
  const [hovering, setHovering] = useState(false);
  const handler = useRef(onDrop);
  handler.current = onDrop;
  useEffect(() => {
    if (!enabled) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWebview()
      .onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "enter" || p.type === "over") setHovering(true);
        else if (p.type === "leave") setHovering(false);
        else if (p.type === "drop") {
          setHovering(false);
          if (p.paths.length) handler.current(p.paths);
        }
      })
      .then((f) => {
        if (cancelled) f();
        else unlisten = f;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled]);
  return hovering;
}
