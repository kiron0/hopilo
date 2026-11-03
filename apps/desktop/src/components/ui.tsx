import { type ButtonHTMLAttributes, type ReactNode, useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, X, XCircle } from "lucide-react";
import type { CaptureStatus } from "../lib/api";
import { provider } from "../lib/format";
import { TARGETS as TARGET_LIST } from "../lib/providers";
import { CheckIcon } from "./Icons";
import { Select, type SelectOption } from "./Select";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  busy,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; icon?: ReactNode; busy?: boolean }) {
  const styles: Record<Variant, string> = {
    primary:
      "bg-brand text-white shadow-brand hover:brightness-110 active:brightness-95",
    secondary: "bg-surface text-ink border border-line shadow-item hover:border-line-strong active:bg-surface-2",
    ghost: "text-muted hover:text-ink hover:bg-surface-3",
    danger: "bg-surface text-danger border border-line shadow-item hover:bg-danger-soft",
  };
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-[filter,background-color,border-color,transform] active:scale-[0.98] disabled:opacity-45 disabled:pointer-events-none",
        size === "sm" ? "h-7.5 px-3 text-[12.5px]" : "h-9 px-4 text-[13px]",
        styles[variant],
        className,
      )}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx("inline-flex h-8 w-8 items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface-3 hover:text-ink", className)}
    >
      {children}
    </button>
  );
}

export function Card({ children, className, ...rest }: { children?: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cx("card", className)}>
      {children}
    </div>
  );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <h2 className="label-mono text-faint">{children}</h2>
      {right}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-[24px] font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "accent" | "success" | "warning" | "danger"; className?: string }) {
  const tones = {
    neutral: "bg-surface-3 text-muted",
    accent: "bg-accent-soft text-accent",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium", tones[tone], className)}>{children}</span>;
}

const STATUS: Record<CaptureStatus, { label: string; tone: "success" | "warning" | "danger" | "neutral"; Icon: typeof CheckCircle2 }> = {
  complete: { label: "Complete", tone: "success", Icon: CheckCircle2 },
  partial: { label: "Partial", tone: "warning", Icon: AlertTriangle },
  unsupported: { label: "Unsupported", tone: "neutral", Icon: CircleDashed },
  "permissions-needed": { label: "Permission needed", tone: "warning", Icon: AlertTriangle },
  failed: { label: "Failed", tone: "danger", Icon: XCircle },
};

export function StatusBadge({ status }: { status: CaptureStatus }) {
  const s = STATUS[status] ?? STATUS.unsupported;
  return (
    <Badge tone={s.tone}>
      <s.Icon size={12} aria-hidden />
      {s.label}
    </Badge>
  );
}

export function ProviderDot({ id, size = 8 }: { id: string; size?: number }) {
  return <span aria-hidden className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: provider(id).color }} />;
}

export function ProviderTag({ id }: { id: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px] text-muted">
      <ProviderDot id={id} />
      {provider(id).label}
    </span>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-surface-3 text-muted">{icon}</div>
      <div className="font-semibold">{title}</div>
      <div className="mt-1 max-w-sm text-muted">{body}</div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border border-line bg-surface-3/70 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "h-7 rounded-full px-3 text-[12.5px] font-medium transition-colors",
            value === o.value ? "bg-surface font-semibold text-ink shadow-item" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx("relative h-5.5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-accent" : "bg-line-strong")}
    >
      <span className={cx("absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-all", checked ? "left-4" : "left-0.5")} />
    </button>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        "h-9.5 w-full rounded-xl border border-line bg-card px-3 text-[13.5px] text-ink shadow-item placeholder:text-faint focus:border-accent focus:outline-none",
        props.className,
      )}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cx(
        "w-full rounded-xl border border-line bg-card px-3 py-2.5 text-[13.5px] text-ink shadow-item placeholder:text-faint focus:border-accent focus:outline-none",
        props.className,
      )}
    />
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      // Keep Tab inside the dialog.
      if (e.key !== "Tab" || !ref.current) return;
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea, select, [href], [tabindex]:not([tabindex='-1'])"));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={cx("animate-pop flex max-h-full w-full flex-col rounded-[22px] border border-line bg-surface shadow-pop outline-none", wide ? "max-w-3xl" : "max-w-lg")}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="min-h-0 overflow-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Generic loading block (skeleton lines); keeps call sites simple. */
export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-3 py-6">
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-3.5 w-11/12" />
      <Skeleton className="h-3.5 w-4/5" />
      <Skeleton className="h-3.5 w-2/3" />
    </div>
  );
}

export function ErrorNote({ text }: { text: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft px-3.5 py-2.5 text-danger">
      <XCircle size={16} className="mt-0.5 shrink-0" />
      <span data-selectable>{text}</span>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-line bg-surface-2 px-1.5 py-px font-mono text-[10.5px] text-muted">{children}</kbd>;
}

/** Grouped picker for the place to continue (chat apps vs coding tools). */
export function TargetSelect({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const options: SelectOption[] = TARGET_LIST.filter((t) => t.id !== "other")
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "chat" ? -1 : 1))
    .map((t) => ({
      value: t.id,
      label: t.label,
      group: t.kind === "chat" ? "Chat apps" : "Coding agents & editors",
      icon: <ProviderChip id={t.id} />,
    }));
  return <Select label="Continue in" value={value} onChange={onChange} options={options} className={className} />;
}

/** Small rounded provider initial, in the provider's color. */
export function ProviderChip({ id, size = 20 }: { id: string; size?: number }) {
  const p = provider(id);
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-[7px] font-display text-[9.5px] font-semibold text-white"
      style={{ width: size, height: size, background: `linear-gradient(160deg, ${p.color}, color-mix(in oklab, ${p.color} 68%, black))` }}
    >
      {p.label.replace(/[^A-Za-z]/g, "").slice(0, 1)}
    </span>
  );
}

/** Themed checkbox: native input for semantics, drawn box for looks. */
export function Checkbox({ checked, onChange, label, className, disabled }: { checked: boolean; onChange: () => void; label: string; className?: string; disabled?: boolean }) {
  return (
    <span className={cx("relative inline-flex h-[18px] w-[18px] shrink-0", className)}>
      <input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={onChange} className="peer absolute inset-0 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed" />
      <span
        aria-hidden
        className={cx(
          "pointer-events-none flex h-full w-full items-center justify-center rounded-[6px] border transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)]",
          checked ? "bg-brand border-transparent text-white" : "border-line-strong bg-surface",
          disabled && "opacity-40",
        )}
      >
        {checked && <CheckIcon size={12} />}
      </span>
    </span>
  );
}

/** Loading placeholder with a light sweep. */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={cx("skeleton block", className)} style={style} />;
}

