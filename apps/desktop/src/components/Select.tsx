import { type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronDownIcon } from "./Icons";

export interface SelectOption {
  value: string;
  label: string;
  group?: string;
  icon?: ReactNode;
}

export function Select({
  value,
  onChange,
  options,
  label,
  emptyLabel = "None",
  className = "",
  size = "md",
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  label: string;

  emptyLabel?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; up: boolean; maxHeight: number } | null>(null);
  const typed = useRef({ text: "", at: 0 });

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = options[selectedIndex];

  const place = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const margin = 8;
    const below = window.innerHeight - r.bottom - margin;
    const above = r.top - margin;
    const wanted = Math.min(320, options.length * 36 + 16);
    const up = below < wanted && above > below;
    const width = Math.min(Math.max(r.width, 220), window.innerWidth - margin * 2);
    const left = Math.min(Math.max(r.left, margin), window.innerWidth - width - margin);
    setRect({ left, top: up ? r.top : r.bottom, width, up, maxHeight: Math.max(120, Math.min(320, (up ? above : below) - 6)) });
  }, [options.length]);

  const openList = () => {
    place();
    setActive(Math.max(0, selectedIndex));
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  const choose = (i: number) => {
    const o = options[i];
    if (o) onChange(o.value);
    close();
  };

  useLayoutEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!open || !list || !el) return;
    if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop - 6;
    else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight + 6;
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!listRef.current?.contains(t) && !triggerRef.current?.contains(t)) close(false);
    };

    const onScroll = (e: Event) => {
      if (listRef.current?.contains(e.target as Node)) return;
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) close(false);
      else place();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    const last = options.length - 1;
    if (e.key === "ArrowDown") setActive((a) => Math.min(last, a + 1));
    else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(last);
    else if (e.key === "Enter" || e.key === " ") choose(active);
    else if (e.key === "Escape" || e.key === "Tab") return close(e.key === "Escape");
    else if (e.key.length === 1) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at > 700 ? "" : typed.current.text) + e.key.toLowerCase(), at: now };
      const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text));
      if (hit >= 0) setActive(hit);
      return;
    } else return;
    e.preventDefault();
  };

  const rows = useMemo(() => {
    const out: ({ kind: "group"; label: string } | { kind: "option"; o: SelectOption; i: number })[] = [];
    let g: string | undefined;
    options.forEach((o, i) => {
      if (o.group && o.group !== g) out.push({ kind: "group", label: o.group });
      g = o.group;
      out.push({ kind: "option", o, i });
    });
    return out;
  }, [options]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKey}
        className={`flex w-full items-center gap-2 rounded-xl border border-line bg-card pr-2.5 pl-3 text-left shadow-item transition-colors hover:border-line-strong ${size === "sm" ? "h-8 text-[12.5px]" : "h-9.5 text-[13.5px]"} ${open ? "border-accent" : ""} ${className}`}
      >
        {selected?.icon && <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-muted">{selected.icon}</span>}
        <span className={`min-w-0 flex-1 truncate ${selected ? "text-ink" : "text-faint"}`}>{selected?.label ?? emptyLabel}</span>
        <ChevronDownIcon size={15} className={`shrink-0 text-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={listRef}
            id={`${id}-list`}
            role="listbox"
            aria-label={label}
            className="animate-pop fixed z-[80] overflow-auto overscroll-contain rounded-2xl border border-line bg-surface p-1.5 shadow-pop"
            style={{ left: rect.left, width: rect.width, maxHeight: rect.maxHeight, ...(rect.up ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.top + 6 }) }}
            onKeyDown={onKey}
          >
            {rows.map((r, k) =>
              r.kind === "group" ? (
                <div key={`g${k}`} className="label-mono px-2.5 pt-2 pb-1 text-faint">
                  {r.label}
                </div>
              ) : (
                <div
                  key={r.o.value}
                  id={`${id}-${r.i}`}
                  data-index={r.i}
                  role="option"
                  aria-selected={r.o.value === value}
                  onMouseEnter={() => setActive(r.i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(r.i)}
                  className={`flex h-9 items-center gap-2.5 rounded-xl px-2.5 text-[13px] ${r.i === active ? "bg-accent-soft text-ink" : "text-muted"}`}
                >
                  {r.o.icon && <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-muted">{r.o.icon}</span>}
                  <span className="min-w-0 flex-1 truncate">{r.o.label}</span>
                  {r.o.value === value && <CheckIcon size={14} className="text-accent" />}
                </div>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
