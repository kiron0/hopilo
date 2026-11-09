import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "./Icons";
import { cx } from "./ui";

export function ActionMenu({ label, items }: { label: string; items: { label: string; icon: ReactNode; danger?: boolean; onSelect: () => void }[] }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const close = (focus = false) => { setPosition(null); if (focus) trigger.current?.focus(); };
  const open = () => {
    const rect = trigger.current?.getBoundingClientRect(); if (!rect) return;
    const height = items.length * 40 + 12;
    setPosition({ left: Math.max(8, Math.min(rect.right - 190, window.innerWidth - 198)), top: Math.max(8, rect.bottom + height > window.innerHeight ? rect.top - height : rect.bottom + 4) });
  };
  useLayoutEffect(() => { if (position) menu.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, [position]);
  useEffect(() => {
    if (!position) return;
    const outside = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) close(); };
    const hide = () => close();
    document.addEventListener("mousedown", outside); window.addEventListener("resize", hide); window.addEventListener("scroll", hide, true);
    return () => { document.removeEventListener("mousedown", outside); window.removeEventListener("resize", hide); window.removeEventListener("scroll", hide, true); };
  }, [position]);
  return <>
    <button ref={trigger} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={!!position} onClick={() => position ? close() : open()}
      onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); open(); } }}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"><MoreHorizontal size={16} /></button>
    {position && createPortal(<div ref={menu} role="menu" aria-label={label} className="fixed z-[70] w-[190px] rounded-xl border border-line bg-surface p-1.5 shadow-pop" style={position}
      onKeyDown={(e) => {
        const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
        if (e.key === "Tab") close();
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          buttons[e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (current + (e.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length]?.focus();
        }
      }}>
      {items.map((item) => <button key={item.label} role="menuitem" type="button" className={cx("flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] hover:bg-surface-2 focus:bg-surface-2", item.danger && "text-danger")}
        onClick={() => { close(true); item.onSelect(); }}>{item.icon}{item.label}</button>)}
    </div>, document.body)}
  </>;
}
