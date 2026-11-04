import { createContext, type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";

type Slots = { header: HTMLElement | null; footer: HTMLElement | null };

export const PageSlotsContext = createContext<Slots>({ header: null, footer: null });

export function PageHeaderSlot({ children }: { children: ReactNode }) {
  const { header } = useContext(PageSlotsContext);
  return header ? createPortal(<div>{children}</div>, header) : <div className="mb-6">{children}</div>;
}

export function PageToolbar({ children, className }: { children: ReactNode; className?: string }) {
  const { header } = useContext(PageSlotsContext);
  const bar = <div className={`page-toolbar flex flex-wrap items-center gap-2${className ? ` ${className}` : ""}`}>{children}</div>;
  return header ? createPortal(bar, header) : <div className="mb-4">{bar}</div>;
}

export function PageFooter({ children }: { children: ReactNode }) {
  const { footer } = useContext(PageSlotsContext);
  return footer ? createPortal(<div className="page-footer-bar">{children}</div>, footer) : <>{children}</>;
}

export function FillPage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`page-fill${className ? ` ${className}` : ""}`}>{children}</div>;
}
