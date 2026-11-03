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

/** Pack grid cards (Packs page). */
export function PackGridSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading packs">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} className="space-y-3 p-4">
          <Skeleton className="h-4" style={{ width: `${70 - i * 10}%` }} />
          <Skeleton className="h-3 w-1/3" />
          <div className="flex justify-between pt-1">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-3 w-14" />
          </div>
        </Card>
      ))}
    </div>
  );
}

/** Pack detail: title row, preview card on the left, side cards right. */
export function PackDetailSkeleton() {
  return (
    <div role="status" aria-label="Loading pack">
      <Skeleton className="mb-3 h-3 w-16" />
      <div className="mb-5 space-y-2.5">
        <Skeleton className="h-7 w-2/5 rounded-xl" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-8 rounded-md" />
          <Skeleton className="h-5 w-12 rounded-md" />
          <Skeleton className="h-5 w-56 rounded-md" />
        </div>
        <Skeleton className="h-6 w-40 rounded-full" />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-5">
        <div className="space-y-2.5">
          <div className="flex gap-2">
            <Skeleton className="h-8 w-52 rounded-full" />
            <Skeleton className="h-8 w-48 rounded-full" />
          </div>
          <Card className="overflow-hidden">
            <div className="border-b border-line px-4 py-2.5">
              <Skeleton className="h-3 w-1/3" />
            </div>
            <div className="space-y-2.5 px-4 py-4">
              {[92, 80, 86, 40, 74, 88, 60, 82, 30].map((w, i) => (
                <Skeleton key={i} className="h-3" style={{ width: `${w}%` }} />
              ))}
            </div>
          </Card>
        </div>
        <div className="space-y-5">
          {[150, 92, 120, 160].map((h, i) => (
            <div key={i} className="space-y-2.5">
              <Skeleton className="h-2.5 w-20" />
              <Card className="p-4" style={{ height: h }}>
                <Skeleton className="h-9 w-full rounded-full" />
              </Card>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Context Map canvas with bubbles and the action rail. */
export function MapSkeleton() {
  const spots = [
    { x: 30, y: 52, s: 120 },
    { x: 56, y: 30, s: 84 },
    { x: 62, y: 60, s: 100 },
    { x: 42, y: 72, s: 72 },
    { x: 72, y: 82, s: 80 },
  ];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_180px] gap-4" role="status" aria-label="Loading map">
      <Card className="card-soft relative h-[560px] overflow-hidden">
        {spots.map((p, i) => (
          <Skeleton key={i} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.s, height: p.s }} />
        ))}
      </Card>
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="flex-1 rounded-[22px]" />
        ))}
      </div>
    </div>
  );
}

/** Placeholder for each lazily loaded screen, matching its layout. */
export function RouteSkeleton({ page }: { page: Route["page"] }) {
  switch (page) {
    case "capture":
      return (
        <div className="space-y-7">
          <Header />
          <Card className="space-y-4 p-5">
            <div className="flex flex-wrap gap-2">
              {[86, 72, 76, 62, 92, 98, 140].map((w, i) => (
                <Skeleton key={i} className="h-8 rounded-full" style={{ width: w }} />
              ))}
            </div>
            <Skeleton className="h-9.5 w-full rounded-xl" />
            <Skeleton className="h-44 w-full rounded-xl" />
          </Card>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Card key={i} className="flex gap-3 p-4">
                <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="h-3 w-5/6" />
                </div>
              </Card>
            ))}
          </div>
        </div>
      );
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
    case "packs":
      return (
        <div>
          <Header actions={2} />
          <Skeleton className="mb-4 h-9.5 w-80 rounded-xl" />
          <PackGridSkeleton count={6} />
        </div>
      );
    case "map":
      return (
        <div>
          <Header actions={1} />
          <Skeleton className="mb-4 h-8 w-72 rounded-full" />
          <MapSkeleton />
        </div>
      );
    case "attachments":
      return (
        <div>
          <Header actions={2} />
          <ListSkeleton rows={5} buttons={2} />
        </div>
      );
    case "builder":
      return (
        <div>
          <Header actions={1} />
          <div className="grid grid-cols-[264px_minmax(0,1fr)_232px] gap-5">
            <div className="space-y-2.5">
              <Skeleton className="h-8 w-full rounded-full" />
              <Skeleton className="h-9.5 w-full rounded-xl" />
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-[300px] rounded-2xl" />
            <Card className="h-[420px] space-y-4 p-4">
              <Skeleton className="h-9.5 w-full rounded-xl" />
              <Skeleton className="h-24 w-full rounded-xl" />
            </Card>
          </div>
        </div>
      );
    case "handoff":
      return (
        <div>
          <Header />
          <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-5">
            <div className="space-y-4">
              <Card className="h-[150px] p-4" />
              <Card className="h-[420px] p-4" />
            </div>
            <div className="space-y-5">
              <Card className="h-[190px]" />
              <Card className="h-[140px]" />
              <Card className="h-[180px]" />
            </div>
          </div>
        </div>
      );
    case "agents":
      return (
        <div>
          <Header />
          <Skeleton className="mb-4 h-9 w-96 rounded-full" />
          <ListSkeleton rows={8} buttons={1} />
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
