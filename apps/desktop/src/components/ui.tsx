import { type ButtonHTMLAttributes, createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CaptureStatus } from "../lib/api";
import { provider } from "../lib/format";
import { TARGETS as TARGET_LIST } from "../lib/providers";
import { CheckIcon, SearchIcon, AlertTriangle, CheckCircle2, CircleDashed, Loader2, X, XCircle, ArrowLeft, ArrowRight } from "./Icons";
import { ProviderLogo } from "./ProviderLogos";
import { Select, type SelectOption } from "./Select";
import { PageHeaderSlot } from "./PageSlots";

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
    <PageHeaderSlot>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-[24px] font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 max-w-2xl text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </PageHeaderSlot>
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

export function ProviderBadge({ id, size = 30 }: { id: string; size?: number }) {
  const p = provider(id);
  const logoSize = Math.max(12, Math.round(size * 0.58));
  const isAgy = id === "antigravity";
  return (
    <span
      aria-hidden
      className={cx(
        "flex shrink-0 items-center justify-center rounded-[9px] font-display text-[11px] font-semibold text-white shadow-card overflow-hidden",
        isAgy && "relative border border-white/10"
      )}
      style={{
        width: size,
        height: size,
        background: isAgy
          ? "radial-gradient(circle at 50% 25%, #23252d 0%, #111216 100%)"
          : `linear-gradient(140deg, ${p.color}, color-mix(in oklab, ${p.color} 70%, black))`
      }}
      title={p.label}
    >
      {isAgy && (
        <svg className="absolute inset-0 h-full w-full pointer-events-none" viewBox="0 0 30 30" fill="none">
          <path d="M0 6h30M0 12h30M0 18h30M0 24h30M6 0v30M12 0v30M18 0v30M24 0v30" stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
        </svg>
      )}
      <ProviderLogo id={id} size={logoSize} fallback={p.label.replace(/[^A-Za-z]/g, "").slice(0, 1)} />
    </span>
  );
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
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("seg", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, className, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; className?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      disabled={disabled}
      aria-checked={checked}
      aria-label={label}
      className={cx("toggle", disabled && "opacity-40 pointer-events-none", className)}
      onClick={() => onChange(!checked)}
    />
  );
}

export function SearchField({ value, onChange, label, placeholder, className, autoFocus }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; className?: string; autoFocus?: boolean }) {
  return (
    <label className={cx("flex h-9 min-w-0 items-center gap-2 rounded-full border border-line bg-card px-3 text-faint shadow-item transition-colors focus-within:border-accent", className)}>
      <SearchIcon size={14} />
      <input
        type="search"
        autoFocus={autoFocus}
        aria-label={label}
        placeholder={placeholder ?? label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && value && (e.stopPropagation(), onChange(""))}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" aria-label="Clear" onClick={() => onChange("")} className="flex h-5 w-5 items-center justify-center rounded-full text-faint hover:bg-surface-3 hover:text-ink">
          <X size={12} />
        </button>
      )}
    </label>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 flex items-baseline justify-between gap-2 text-[12px] font-medium text-muted">
        {label}
        {hint && <span className="font-normal text-faint">{hint}</span>}
      </span>
      {children}
    </label>
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

export const ModalCloseContext = createContext<(() => void) | null>(null);
export function useModalClose() {
  return useContext(ModalCloseContext);
}

export function Modal({
  open = true,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open?: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode | ((close: () => void) => ReactNode);
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const [active, setActive] = useState(open);

  useEffect(() => {
    if (open) {
      setActive(true);
      setClosing(false);
    } else if (active && !closing) {
      setClosing(true);
      const timer = setTimeout(() => {
        setActive(false);
        setClosing(false);
      }, 130);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => {
      onClose();
      setActive(false);
      setClosing(false);
    }, 130);
  }, [closing, onClose]);

  const closeRef = useRef(requestClose);
  useEffect(() => {
    closeRef.current = requestClose;
  }, [requestClose]);

  useEffect(() => {
    if (!active) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return closeRef.current();

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
  }, [active]);

  if (!active || typeof document === "undefined") return null;

  const renderedFooter = typeof footer === "function" ? footer(requestClose) : footer;

  return createPortal(
    <ModalCloseContext.Provider value={requestClose}>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
        <div
          className={cx(
            "fixed inset-0 bg-black/40 backdrop-blur-sm",
            closing ? "modal-backdrop-out" : "modal-backdrop-in"
          )}
          onMouseDown={requestClose}
        />
        <div
          ref={ref}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onMouseDown={(e) => e.stopPropagation()}
          className={cx(
            "relative z-10 flex max-h-full w-full flex-col rounded-[22px] border border-line bg-surface shadow-pop outline-none",
            closing ? "modal-dialog-out" : "modal-dialog-in",
            wide ? "max-w-3xl" : "max-w-lg"
          )}
        >
          <div className="flex items-center justify-between px-6 pt-5 pb-2">
            <h2 className="font-semibold">{title}</h2>
            <IconButton label="Close" onClick={requestClose}>
              <X size={16} />
            </IconButton>
          </div>
          <div className="min-h-0 overflow-auto px-6 py-2">{children}</div>
          {renderedFooter && <div className="flex justify-end gap-2 px-6 pt-2 pb-5">{renderedFooter}</div>}
        </div>
      </div>
    </ModalCloseContext.Provider>,
    document.body
  );
}

export interface AlertDialogProps {
  open?: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  icon?: ReactNode;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  loading?: boolean;
}

export function AlertDialog({
  open = true,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = true,
  icon,
  onConfirm,
  onClose,
  loading = false,
}: AlertDialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [active, setActive] = useState(open);

  useEffect(() => {
    if (open) {
      setActive(true);
      setClosing(false);
    } else if (active && !closing) {
      setClosing(true);
      const timer = setTimeout(() => {
        setActive(false);
        setClosing(false);
      }, 130);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const isSpinning = busy || loading;

  const requestClose = useCallback(() => {
    if (isSpinning || closing) return;
    setClosing(true);
    setTimeout(() => {
      onClose();
      setActive(false);
      setClosing(false);
    }, 130);
  }, [isSpinning, closing, onClose]);

  const closeRef = useRef(requestClose);
  const spinningRef = useRef(isSpinning);
  useEffect(() => {
    closeRef.current = requestClose;
    spinningRef.current = isSpinning;
  }, [requestClose, isSpinning]);

  useEffect(() => {
    if (!active) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !spinningRef.current) return closeRef.current();
      if (e.key !== "Tab" || !ref.current) return;
      const items = Array.from(
        ref.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), [tabindex]:not([tabindex='-1'])"
        )
      );
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
  }, [active]);

  if (!active || typeof document === "undefined") return null;

  const handleConfirm = async () => {
    try {
      setBusy(true);
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div
        className={cx(
          "fixed inset-0 bg-black/40 backdrop-blur-sm",
          closing ? "modal-backdrop-out" : "modal-backdrop-in"
        )}
        onMouseDown={() => {
          if (!isSpinning) requestClose();
        }}
      />
      <div
        ref={ref}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={cx(
          "relative z-10 flex max-h-full w-full max-w-md flex-col rounded-[22px] border border-line bg-surface shadow-pop outline-none overflow-hidden",
          closing ? "modal-dialog-out" : "modal-dialog-in"
        )}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-1">
          <div className="flex items-center gap-2.5">
            {icon ? (
              <span className={cx("flex h-7 w-7 items-center justify-center rounded-lg", destructive ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent")}>
                {icon}
              </span>
            ) : destructive ? (
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-danger-soft text-danger">
                <AlertTriangle size={15} />
              </span>
            ) : null}
            <h2 className="font-semibold text-[15px]">{title}</h2>
          </div>
          <IconButton label="Close" onClick={requestClose} disabled={isSpinning}>
            <X size={16} />
          </IconButton>
        </div>

        <div className="px-6 py-2.5 text-[13.5px] leading-relaxed text-muted">
          {description}
        </div>

        <div className="flex justify-end gap-2.5 px-6 pt-2 pb-5">
          <Button variant="secondary" onClick={requestClose} disabled={isSpinning}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            onClick={handleConfirm}
            busy={isSpinning}
            autoFocus
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

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

export { ProviderLogo } from "./ProviderLogos";

export function ProviderChip({ id, size = 20 }: { id: string; size?: number }) {
  const p = provider(id);
  const logoSize = Math.max(10, Math.round(size * 0.62));
  const isAgy = id === "antigravity";
  return (
    <span
      aria-hidden
      className={cx(
        "flex shrink-0 items-center justify-center rounded-[6px] font-display text-[9.5px] font-semibold text-white overflow-hidden",
        isAgy && "relative border border-white/10"
      )}
      style={{
        width: size,
        height: size,
        background: isAgy
          ? "radial-gradient(circle at 50% 25%, #23252d 0%, #111216 100%)"
          : `linear-gradient(160deg, ${p.color}, color-mix(in oklab, ${p.color} 68%, black))`
      }}
      title={p.label}
    >
      {isAgy && (
        <svg className="absolute inset-0 h-full w-full pointer-events-none" viewBox="0 0 20 20" fill="none">
          <path d="M0 5h20M0 10h20M0 15h20M5 0v20M10 0v20M15 0v20" stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
        </svg>
      )}
      <ProviderLogo id={id} size={logoSize} fallback={p.label.replace(/[^A-Za-z]/g, "").slice(0, 1)} />
    </span>
  );
}

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

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={cx("skeleton block", className)} style={style} />;
}

export function useFitRows<T extends HTMLElement>(rowHeight: number, min = 10) {
  const [el, ref] = useState<T | null>(null);
  const [rows, setRows] = useState(min);
  useEffect(() => {
    if (!el) return;
    const measure = () => {
      const first = el.querySelector<HTMLElement>("[data-fit-row]");
      const h = first?.offsetHeight || rowHeight;
      setRows(Math.max(min, Math.floor((el.clientHeight - 2) / h)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, rowHeight, min]);
  return [ref, rows] as const;
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  noun = "item",
  limitOptions,
  currentLimit,
  onLimitChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  noun?: string;
  limitOptions?: readonly (number | "auto")[];
  currentLimit?: number | "auto";
  onLimitChange?: (limit: number | "auto") => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = page * pageSize + 1;
  const to = Math.min(total, from + pageSize - 1);
  const around = [...new Set([0, page - 1, page, page + 1, pages - 1])].filter((p) => p >= 0 && p < pages).sort((a, b) => a - b);
  const btn = "flex h-8 min-w-8 items-center justify-center rounded-full px-2 font-mono text-[12px] transition-colors disabled:pointer-events-none disabled:opacity-40";
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center gap-3">
      <span className="font-mono text-[11.5px] text-faint">
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()} {total === 1 ? noun : `${noun}s`}
      </span>
      {limitOptions && onLimitChange && (
        <div className="flex items-center gap-1.5 pl-1 text-[11.5px] text-faint">
          <span>Limit:</span>
          <div className="flex items-center rounded-full border border-line bg-card p-0.5 shadow-item">
            {limitOptions.map((opt) => {
              const active = currentLimit === opt;
              return (
                <button
                  key={String(opt)}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onLimitChange(opt)}
                  className={cx(
                    "flex h-6.5 items-center justify-center rounded-full px-2 font-mono text-[11px] transition-colors",
                    active ? "bg-surface font-semibold text-ink shadow-item" : "text-muted hover:bg-surface-3 hover:text-ink"
                  )}
                >
                  {opt === "auto" ? "Auto" : opt}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex-1" />
      <div className="flex items-center gap-0.5 rounded-full border border-line bg-card p-0.5 shadow-item">
        <button type="button" aria-label="Previous page" disabled={page === 0} onClick={() => onPage(page - 1)} className={cx(btn, "text-muted hover:bg-surface-3 hover:text-ink")}>
          <ArrowLeft size={14} />
        </button>
        {around.map((p, i) => (
          <span key={p} className="flex items-center">
            {i > 0 && p - around[i - 1] > 1 && <span className="px-1 text-faint">…</span>}
            <button
              type="button"
              aria-label={`Page ${p + 1}`}
              aria-current={p === page ? "page" : undefined}
              onClick={() => onPage(p)}
              className={cx(btn, p === page ? "bg-surface font-semibold text-ink shadow-item" : "text-muted hover:bg-surface-3 hover:text-ink")}
            >
              {p + 1}
            </button>
          </span>
        ))}
        <button type="button" aria-label="Next page" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} className={cx(btn, "text-muted hover:bg-surface-3 hover:text-ink")}>
          <ArrowRight size={14} />
        </button>
      </div>
    </nav>
  );
}
