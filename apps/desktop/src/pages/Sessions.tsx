import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bot, Download, Hammer, MessagesSquare, RefreshCw, Search, Trash2 } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import { api, errorText, type DiscoveredRow, type SourceRow } from "../lib/api";
import { basename, bytes, plural, provider, relativeTime, tokens } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { type DraftItem, useApp } from "../lib/store";
import { CopyHandoffButton } from "./Dashboard";
import { Transcript } from "../components/Transcript";
import { ListSkeleton, TranscriptSkeleton } from "../components/Skeletons";
import { Badge, Button, Card, cx, EmptyState, ErrorNote, PageHeader, ProviderDot, ProviderTag, Segmented, Skeleton, StatusBadge, TextInput } from "../components/ui";

export function sourceDraftItem(r: { id: string; title: string; provider: string; messageCount: number }, messageIds?: string[]): DraftItem {
  return {
    key: `source:${r.id}`,
    item: { kind: "source", id: r.id, messageIds: messageIds ?? null },
    label: r.title,
    meta: messageIds ? `${messageIds.length} of ${plural(r.messageCount, "message")}` : plural(r.messageCount, "message"),
    provider: r.provider,
    total: r.messageCount,
  };
}

function AgentSessions() {
  const { data, error, loading, reload } = useLoad(() => api.discoverSessions());
  const toast = useApp((s) => s.toast);
  const addToDraft = useApp((s) => s.addToDraft);
  const navigate = useApp((s) => s.navigate);
  const [q, setQ] = useState("");
  const [adapter, setAdapter] = useState<"all" | "claude-code" | "codex" | "gemini-cli" | "opencode" | "qwen-code">("all");
  const [busy, setBusy] = useState<string | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter(
      (r) =>
        (adapter === "all" || r.adapter === adapter) &&
        (!needle || r.title.toLowerCase().includes(needle) || (r.project ?? "").toLowerCase().includes(needle)),
    );
  }, [data, q, adapter]);

  const capture = async (r: DiscoveredRow, thenBuild: boolean) => {
    setBusy(r.path);
    try {
      const out = await api.importSession(r.adapter, r.path);
      if (thenBuild) {
        const { source, messages } = await api.getSource(out.sourceId);
        const n = addToDraft([sourceDraftItem({ id: out.sourceId, title: source.title, provider: source.provider, messageCount: messages.length })]);
        toast({ kind: "success", text: n ? `Added “${source.title}” to the Builder.` : "Already in the Builder.", action: { label: "Open Builder", run: () => navigate({ page: "builder" }) } });
      } else {
        toast({
          kind: out.duplicateOf ? "info" : "success",
          text: out.duplicateOf ? "No changes since the last capture — kept the existing copy." : `Captured “${r.title}”. The original file was not modified.`,
          action: { label: "View", run: () => navigate({ page: "sessions", tab: "library", sourceId: out.sourceId }) },
        });
      }
    } catch (e) {
      toast({ kind: "error", text: `Capture failed: ${errorText(e)}` });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <TextInput aria-label="Filter sessions" placeholder="Filter by title or project" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>
        <Segmented
          label="Agent"
          value={adapter}
          onChange={setAdapter}
          options={[
            { value: "all", label: "All" },
            { value: "claude-code", label: "Claude Code" },
            { value: "codex", label: "Codex" },
            { value: "gemini-cli", label: "Gemini CLI" },
            { value: "opencode", label: "OpenCode" },
            { value: "qwen-code", label: "Qwen Code" },
          ]}
        />
        <Button icon={<RefreshCw size={14} />} onClick={reload} busy={loading && !!data}>
          Rescan
        </Button>
      </div>
      {error && <ErrorNote text={error} />}
      {loading && !data && <ListSkeleton rows={8} buttons={3} label="Scanning local agent folders" />}
      {data && rows.length === 0 && (
        <Card>
          <EmptyState icon={<Bot size={20} />} title="No sessions found" body="Hopilo looks where Claude Code, Codex, Gemini CLI and OpenCode keep their sessions. They appear here after you use those tools." />
        </Card>
      )}
      {rows.length > 0 && (
        <Card className="divide-y divide-line">
          {rows.map((r) => (
            <div key={r.path} className="flex items-center gap-3 px-4 py-3">
              <ProviderDot id={r.adapter} size={9} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{r.title}</span>
                  {r.importedSourceId && !r.changedSinceImport && <Badge tone="success">Captured</Badge>}
                  {r.changedSinceImport && <Badge tone="warning">New activity since capture</Badge>}
                </div>
                <div className="mt-0.5 truncate text-[12px] text-faint" title={r.path}>
                  {provider(r.adapter).label} · {basename(r.project) || "no project"} {r.model ? `· ${r.model}` : ""} · {plural(r.messageCount, "turn")} · {bytes(r.sizeBytes)} · {relativeTime(r.modifiedAt)}
                </div>
              </div>
              <Button size="sm" variant="ghost" icon={<Hammer size={13} />} busy={busy === r.path} onClick={() => capture(r, true)}>
                Add to Builder
              </Button>
              <Button size="sm" icon={<Download size={13} />} onClick={() => capture(r, false)} disabled={busy === r.path}>
                {r.importedSourceId ? "Re-capture" : "Capture"}
              </Button>
              <CopyHandoffButton row={r} variant="secondary" />
            </div>
          ))}
        </Card>
      )}
      <p className="text-[12px] text-faint">
        Session files are opened read-only. Hidden reasoning and injected system context are left out and counted in each capture's record.
      </p>
    </div>
  );
}

function SourceDetail({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const { data, error, loading } = useLoad(() => api.getSource(id), [id]);
  const addToDraft = useApp((s) => s.addToDraft);
  const navigate = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelecting(false);
    setSelected(new Set());
  }, [id]);

  if (loading && !data)
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-3/5" />
          <Skeleton className="h-3 w-4/5" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-40 rounded-full" />
          <Skeleton className="h-9 w-36 rounded-full" />
        </div>
        <TranscriptSkeleton count={5} />
      </div>
    );
  if (error) return <ErrorNote text={error} />;
  if (!data) return null;
  const { source, messages, tokenEstimate } = data;
  const row = { id, title: source.title, provider: source.provider, messageCount: messages.length };

  const add = (ids?: string[]) => {
    const n = addToDraft([sourceDraftItem(row, ids)]);
    toast({ kind: "success", text: n ? "Added to the Builder." : "Already in the Builder — remove it there to change the selection.", action: { label: "Open Builder", run: () => navigate({ page: "builder" }) } });
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[16px] font-semibold" data-selectable>{source.title}</h2>
          <StatusBadge status={source.captureStatus} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
          <ProviderTag id={source.provider} />
          {source.project && <span title={source.project}>· {basename(source.project)}</span>}
          {source.model && <span>· {source.model}</span>}
          <span>· {plural(messages.length, "message")}</span>
          <span>· {tokens(tokenEstimate)} tokens (estimate)</span>
          <span>· captured {relativeTime(source.capturedAt)}</span>
        </div>
      </div>

      {(source.missingItems.length > 0 || source.omitted.length > 0) && (
        <Card className="space-y-1.5 p-3 text-[12.5px]">
          {source.missingItems.map((m) => (
            <div key={m} className="flex items-start gap-2 text-warning">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {m}
            </div>
          ))}
          {source.omitted.map((o) => (
            <div key={o.what} className="text-muted">
              Not included: {o.count} × {o.what}
            </div>
          ))}
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {!selecting ? (
          <>
            <Button variant="primary" icon={<Hammer size={14} />} onClick={() => add()}>
              Add all to Builder
            </Button>
            <Button onClick={() => setSelecting(true)}>Select messages…</Button>
          </>
        ) : (
          <>
            <Button variant="primary" disabled={selected.size === 0} onClick={() => add(messages.filter((m) => selected.has(m.id)).map((m) => m.id))}>
              Add {selected.size} selected
            </Button>
            <Button variant="ghost" onClick={() => setSelected(new Set(messages.map((m) => m.id)))}>Select all</Button>
            <Button variant="ghost" onClick={() => setSelected(new Set(messages.filter((m) => m.role === "user" || (m.role === "assistant" && m.blocks.some((b) => b.type === "text"))).map((m) => m.id)))}>
              Conversation only
            </Button>
            <Button variant="ghost" onClick={() => { setSelecting(false); setSelected(new Set()); }}>Cancel</Button>
          </>
        )}
        <div className="flex-1" />
        <Button
          variant="danger"
          icon={<Trash2 size={14} />}
          onClick={async () => {
            if (!(await ask(`Delete the capture “${source.title}” from your library? Packs built from it keep their own copy. The original session file is not touched.`, { title: "Delete capture", kind: "warning" }))) return;
            await api.deleteSource(id);
            onDeleted();
          }}
        >
          Delete
        </Button>
      </div>

      <Transcript
        messages={messages}
        selected={selecting ? selected : undefined}
        onToggle={
          selecting
            ? (mid) => {
                const next = new Set(selected);
                if (next.has(mid)) next.delete(mid);
                else next.add(mid);
                setSelected(next);
              }
            : undefined
        }
      />
    </div>
  );
}

function CapturedSessions({ initial }: { initial?: string }) {
  const { data, error, loading } = useLoad(() => api.listSources());
  const [active, setActive] = useState<string | undefined>(initial);
  const [q, setQ] = useState("");
  useEffect(() => setActive(initial), [initial]);
  useEffect(() => {
    if (!active && data?.length) setActive(data[0].id);
  }, [data, active]);

  const rows = (data ?? []).filter((r: SourceRow) => !q.trim() || r.title.toLowerCase().includes(q.trim().toLowerCase()));

  if (loading && !data)
    return (
      <div className="grid min-h-[520px] grid-cols-[300px_minmax(0,1fr)] gap-4" role="status" aria-label="Loading captures">
        <div className="space-y-2">
          <Skeleton className="h-9.5 w-full rounded-xl" />
          <Card className="divide-y divide-line">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="space-y-1.5 px-3.5 py-2.5">
                <Skeleton className="h-3.5" style={{ width: `${80 - (i % 3) * 12}%` }} />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
            ))}
          </Card>
        </div>
        <Card className="p-5">
          <TranscriptSkeleton count={5} />
        </Card>
      </div>
    );
  if (error) return <ErrorNote text={error} />;
  if (data && data.length === 0)
    return (
      <Card>
        <EmptyState icon={<MessagesSquare size={20} />} title="No captures yet" body="Capture a local agent session, clipboard text or a note. It shows up here, unchanged, for review." />
      </Card>
    );

  return (
    <div className="grid min-h-[520px] grid-cols-[300px_minmax(0,1fr)] gap-4">
      <div className="flex flex-col gap-2">
        <TextInput aria-label="Filter captures" placeholder="Filter captures" value={q} onChange={(e) => setQ(e.target.value)} />
        <Card className="flex-1 divide-y divide-line overflow-auto">
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-current={active === r.id}
              onClick={() => setActive(r.id)}
              className={cx("block w-full px-3.5 py-2.5 text-left", active === r.id ? "bg-accent-soft" : "hover:bg-surface-2")}
            >
              <div className="truncate font-medium">{r.title}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-faint">
                <ProviderDot id={r.provider} size={7} /> {provider(r.provider).label} · {r.messageCount} msgs · {relativeTime(r.capturedAt)}
                {r.captureStatus !== "complete" && <AlertTriangle size={11} className="text-warning" aria-label="Partial capture" />}
              </div>
            </button>
          ))}
        </Card>
      </div>
      <Card className="min-w-0 overflow-auto p-5">{active ? <SourceDetail id={active} onDeleted={() => setActive(undefined)} /> : <div className="text-muted">Select a capture.</div>}</Card>
    </div>
  );
}

export function Sessions() {
  const route = useApp((s) => s.route);
  const navigate = useApp((s) => s.navigate);
  const tab = route.page === "sessions" ? (route.tab ?? (route.sourceId ? "library" : "agents")) : "agents";
  const sourceId = route.page === "sessions" ? route.sourceId : undefined;
  return (
    <div>
      <PageHeader
        title="Sessions"
        subtitle="Coding-agent sessions found on this Mac, and everything you have captured."
        actions={
          <Segmented
            label="View"
            value={tab}
            onChange={(t) => navigate({ page: "sessions", tab: t })}
            options={[
              { value: "agents", label: "Local agents" },
              { value: "library", label: "Captured" },
            ]}
          />
        }
      />
      {tab === "agents" ? <AgentSessions /> : <CapturedSessions initial={sourceId} />}
    </div>
  );
}
