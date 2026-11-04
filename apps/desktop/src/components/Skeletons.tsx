// Loading placeholders shaped like the real screens, so nothing jumps when
// data arrives. Each mirrors the grid, card sizes and row structure of the
// component it stands in for.
import type { Route } from "../lib/store";
import { Card, cx, Skeleton } from "./ui";

function Header({ actions = 0 }: { actions?: number }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div className="w-full max-w-xl space-y-2.5">
        <Skeleton className="h-7 w-48 rounded-xl" />
        <Skeleton className="h-3.5 w-4/5" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: actions }, (_, i) => (
          <Skeleton key={i} className="h-9 w-28 rounded-full" />
        ))}
      </div>
    </div>
  );
}

/** A row like the app's list rows: badge, two lines, trailing buttons. */
export function RowSkeleton({ buttons = 1, badge = 30, i = 0 }: { buttons?: number; badge?: number; i?: number }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Skeleton className="shrink-0 rounded-[10px]" style={{ width: badge, height: badge }} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3.5" style={{ width: `${58 - (i % 4) * 8}%` }} />
        <Skeleton className="h-2.5" style={{ width: `${34 + (i % 3) * 6}%` }} />
      </div>
      {Array.from({ length: buttons }, (_, k) => (
        <Skeleton key={k} className={cx("h-7.5 rounded-full", k === buttons - 1 ? "w-28" : "w-24")} />
      ))}
    </div>
  );
}

export function ListSkeleton({ rows = 6, buttons = 1, label = "Loading" }: { rows?: number; buttons?: number; label?: string }) {
  return (
    <Card className="divide-y divide-line" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <RowSkeleton key={i} i={i} buttons={buttons} />
      ))}
    </Card>
  );
}

/** Transcript: alternating message blocks with role label and text lines. */
export function TranscriptSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading messages">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={cx("space-y-2 rounded-xl px-3.5 py-3", i % 2 === 0 && "bg-surface-2")}>
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="h-3.5 w-11/12" />
          <Skeleton className="h-3.5" style={{ width: `${70 - i * 9}%` }} />
        </div>
      ))}
    </div>
  );
}




/** Placeholder for each lazily loaded screen, matching its layout. */
export function RouteSkeleton({ page }: { page: Route["page"] }) {
  switch (page) {
    case "sessions":
      return (
        <div>
          <Header actions={1} />
          <div className="mb-4 flex gap-2">
            <Skeleton className="h-9.5 flex-1 rounded-xl" />
            <Skeleton className="h-9 w-80 rounded-full" />
            <Skeleton className="h-9 w-24 rounded-full" />
          </div>
          <ListSkeleton rows={8} buttons={3} />
        </div>
      );
    case "browser":
      return (
        <div className="space-y-4">
          <Header actions={1} />
          {[150, 260, 90].map((h, i) => (
            <Card key={i} className="p-5" style={{ height: h }}>
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-4 w-56" />
              </div>
            </Card>
          ))}
        </div>
      );
    case "settings":
      return (
        <div>
          <Header />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {[260, 150, 240, 200, 220, 120].map((h, i) => (
              <Card key={i} className="space-y-3 p-5" style={{ height: h }}>
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-2/3" />
              </Card>
            ))}
          </div>
        </div>
      );
    default:
      return <Header />;
  }
}
