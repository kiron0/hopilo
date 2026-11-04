import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "./Icons";
import { useApp } from "../lib/store";
import { cx } from "./ui";

const ICONS = { success: CheckCircle2, info: Info, warning: AlertTriangle, error: XCircle };
const TONES = { success: "text-success", info: "text-accent", warning: "text-warning", error: "text-danger" };

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismiss);
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div key={t.id} role={t.kind === "error" ? "alert" : "status"} className="animate-pop pointer-events-auto flex items-start gap-2.5 rounded-xl border border-line bg-surface px-3.5 py-3 shadow-pop">
            <Icon size={16} className={cx("mt-0.5 shrink-0", TONES[t.kind])} />
            <div className="min-w-0 flex-1 text-[12.5px] break-words" data-selectable>
              {t.text}
              {t.action && (
                <button type="button" className="ml-2 font-medium text-accent hover:underline" onClick={() => { t.action!.run(); dismiss(t.id); }}>
                  {t.action.label}
                </button>
              )}
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="text-faint hover:text-ink">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
