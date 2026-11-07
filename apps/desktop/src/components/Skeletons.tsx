import type { Route } from "../lib/store";
import { Card, cx, Skeleton } from "./ui";
import { PageHeaderSlot, PageToolbar } from "./PageSlots";

function Header({ actions = 0, title = "w-48" }: { actions?: number; title?: string }) {
  return (
    <PageHeaderSlot>
      <div className="flex items-end justify-between gap-4">
        <div className="w-full max-w-xl space-y-2.5">
          <Skeleton className={cx("h-7 rounded-xl", title)} />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
        <div className="flex gap-2">
          {Array.from({ length: actions }, (_, i) => (
            <Skeleton key={i} className="h-9 w-20 rounded-full" />
          ))}
        </div>
      </div>
    </PageHeaderSlot>
  );
}

export function RowSkeleton({ buttons = 1, badge = 30, i = 0, check = false }: { buttons?: number; badge?: number; i?: number; check?: boolean }) {
  return (
    <div className={cx("flex items-center gap-3 px-4", check ? "py-2.5" : "py-3")}>
      {check && <Skeleton className="h-4 w-4 shrink-0 rounded-[5px]" />}
      <Skeleton className="shrink-0 rounded-[10px]" style={{ width: badge, height: badge }} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3.5" style={{ width: `${58 - (i % 4) * 8}%` }} />
        <Skeleton className="h-2.5" style={{ width: `${34 + (i % 3) * 6}%` }} />
      </div>
      {Array.from({ length: buttons }, (_, k) => (
        <Skeleton key={k} className={cx("h-7.5 rounded-full", check ? "w-[74px]" : k === buttons - 1 ? "w-20" : "w-24")} />
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

export function SessionListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden" role="status" aria-label="Loading sessions">
      <div className="min-h-0 flex-1 divide-y divide-line overflow-hidden">
        {Array.from({ length: rows }, (_, i) => (
          <RowSkeleton key={i} i={i} check />
        ))}
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-line bg-surface-2 px-4 py-2.5">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-9 w-40 rounded-full" />
      </div>
    </Card>
  );
}

export function SessionPageSkeleton() {
  return (
    <div className="page-fill" role="status" aria-label="Loading session">
      <Header actions={0} title="w-80" />
      <PageToolbar>
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-9.5 w-52 rounded-xl" />
        <Skeleton className="h-8 w-[196px] rounded-full" />
        <Skeleton className="h-9 w-20 rounded-full" />
        <div className="flex-1" />
        <Skeleton className="h-7.5 w-28 rounded-full" />
        <Skeleton className="h-7.5 w-20 rounded-full" />
        <Skeleton className="h-7.5 w-24 rounded-full" />
      </PageToolbar>
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-line px-4 py-2.5">
          <Skeleton className="h-8 w-[178px] rounded-full" />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden p-5">
          <TranscriptSkeleton count={5} />
        </div>
      </Card>
    </div>
  );
}

export function CompareSkeleton({ withHeader = false }: { withHeader?: boolean }) {
  return (
    <div className="space-y-4" role="status" aria-label="Loading comparison">
      {withHeader && <Header actions={2} />}
      {withHeader && (
        <Card className="grid grid-cols-1 items-center gap-2 p-3.5 md:grid-cols-[1fr_auto_1fr]">
          <Skeleton className="h-10 rounded-xl" />
          <Skeleton className="h-8 w-16 rounded-full" />
          <Skeleton className="h-10 rounded-xl" />
        </Card>
      )}
      <Card className="space-y-3 p-4">
        <div className="flex gap-2">
          {[28, 32, 36].map((w) => (
            <Skeleton key={w} className="h-6 rounded-full" style={{ width: `${w * 4}px` }} />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      </Card>
      <Card className="space-y-2.5 p-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="grid grid-cols-[1fr_110px_1fr] items-center gap-3">
            <Skeleton className="h-1.5 rounded-full" style={{ marginLeft: `${20 + (i % 3) * 15}%` }} />
            <Skeleton className="mx-auto h-3 w-16" />
            <Skeleton className="h-1.5 rounded-full" style={{ marginRight: `${10 + (i % 4) * 12}%` }} />
          </div>
        ))}
      </Card>
      <Card className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2 rounded-xl border border-line p-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-2.5 w-11/12" />
            <Skeleton className="h-2.5 w-3/4" />
          </div>
        ))}
      </Card>
    </div>
  );
}

export function SettingsRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} role="status" aria-label="Loading" className="flex min-h-14 items-center justify-between gap-6 py-3">
          <div className="space-y-1.5">
            <Skeleton className="h-3.5" style={{ width: `${110 + (i % 3) * 22}px` }} />
            <Skeleton className="h-2.5 w-52" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </>
  );
}

export function RouteSkeleton({ page }: { page: Route["page"] }) {
  switch (page) {
    case "sessions":
      return (
        <div className="page-fill">
          <Header actions={1} />
          <PageToolbar>
            <Skeleton className="h-9.5 flex-1 rounded-full" />
            <Skeleton className="h-8 w-[372px] rounded-full" />
            <Skeleton className="h-9 w-9 rounded-full" />
          </PageToolbar>
          <SessionListSkeleton />
        </div>
      );
    case "browser":
      return (
        <div className="space-y-4" role="status" aria-label="Loading">
          <Header actions={1} />
          {[0, 1, 2].map((i) => (
            <Card key={i} className="p-5">
              <div className="flex items-center gap-3">
                <Skeleton className="h-7 w-7 rounded-full" />
                <Skeleton className="h-4 w-56" />
              </div>
              <div className="mt-3 space-y-2 pl-10">
                <Skeleton className="h-3 w-11/12" />
                {i < 2 && <Skeleton className="h-3 w-2/3" />}
                {i === 1 && <Skeleton className="mt-3 h-24 w-full rounded-2xl" />}
              </div>
            </Card>
          ))}
          <Skeleton className="h-2.5 w-24" />
          <ListSkeleton rows={6} />
        </div>
      );
    case "settings":
      return (
        <div role="status" aria-label="Loading settings">
          <Header />
          <div>
            <div>
              <Card className="divide-y divide-line px-5 py-1">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="flex min-h-14 items-center justify-between gap-6 py-3">
                    <div className="space-y-1.5">
                      <Skeleton className="h-3.5 w-32" />
                      <Skeleton className="h-2.5 w-52" />
                    </div>
                    <Skeleton className="h-8 w-40 rounded-full" />
                  </div>
                ))}
              </Card>
            </div>
          </div>
        </div>
      );
    case "compare":
      return <CompareSkeleton withHeader />;
    default:
      return <Header />;
  }
}
