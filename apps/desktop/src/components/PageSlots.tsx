// Page chrome slots. Each page's header and footer render (via portal) into
// fixed areas of the Shell, so only the content between them scrolls.
import { createContext, type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";

type Slots = { header: HTMLElement | null; footer: HTMLElement | null };

export const PageSlotsContext = createContext<Slots>({ header: null, footer: null });

/** Renders children into the Shell's fixed header area. Outside the Shell
 *  (no slot yet, or another surface) it renders in place. */
export function PageHeaderSlot({ children }: { children: ReactNode }) {
  const { header } = useContext(PageSlotsContext);
  return header ? createPortal(<div>{children}</div>, header) : <div className="mb-6">{children}</div>;
}

/** Filter/search row pinned under the page header; it never scrolls away. */
export function PageToolbar({ children, className }: { children: ReactNode; className?: string }) {
  const { header } = useContext(PageSlotsContext);
  const bar = <div className={`page-toolbar flex flex-wrap items-center gap-2${className ? ` ${className}` : ""}`}>{children}</div>;
  return header ? createPortal(bar, header) : <div className="mb-4">{bar}</div>;
}

/** Renders children into the Shell's fixed footer area. */
export function PageFooter({ children }: { children: ReactNode }) {
  const { footer } = useContext(PageSlotsContext);
  return footer ? createPortal(<div className="page-footer-bar">{children}</div>, footer) : <>{children}</>;
}

/** Wrap a page whose main content is one or more boxes that should fill the
 *  available height; the boxes then scroll internally instead of the page. */
export function FillPage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`page-fill${className ? ` ${className}` : ""}`}>{children}</div>;
}
