import { useEffect, useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { api, errorText, type SessionRow } from "../lib/api";
import { plural, provider, relativeTime } from "../lib/format";
import { saveSetting, useDebouncedValue, useLoad } from "../lib/hooks";
import { useApp, type AgentAccess, type SessionFilter } from "../lib/store";
import { X } from "./Icons";
import { FilterSelect, RESOURCE_OPTIONS, SESSION_FILTERS, useModelOptions, useProviderOptions } from "./SessionFilters";
import { Button, Card, Checkbox, ErrorNote, Pagination, ProviderBadge, SearchField, Segmented, Skeleton, Toggle, cx } from "./ui";

const quote = (path: string) => (/[\s"']/.test(path) ? `"${path.replace(/"/g, '\\"')}"` : path);
const SHOW_OPTIONS = [...SESSION_FILTERS.filter((f) => f.value !== "hidden"), { value: "selected", label: "Selected only" }];
type Show = Exclude<SessionFilter, "hidden"> | "selected";

function SessionPicker({ access, save, liveCount }: { access: AgentAccess; save: (next: AgentAccess) => void; liveCount: number }) {
  const [q, setQ] = useState("");
  const query = useDebouncedValue(q).trim();
  const [show, setShow] = useState<Show>("all");
  const [tool, setTool] = useState("all");
  const [model, setModel] = useState("all");
  const [resource, setResource] = useState("all");
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(25);
  const chosen = useMemo(() => new Set(access.sessions), [access.sessions]);
  const request = {
    q: query, filter: show === "selected" ? "all" : show, provider: tool, model, resource,
    ids: show === "selected" ? access.sessions : undefined, offset: page * limit, limit,
  };
  const { data, error, loading } = useLoad(() => api.querySessions(request), ["agent-access-sessions", request]);
  const providerOptions = useProviderOptions(data?.providers, tool);
  const modelOptions = useModelOptions(data?.models, model);
  const rows = data?.rows ?? [];
  const reset = (fn: () => void) => { fn(); setPage(0); };
  const filtered = q || show !== "all" || tool !== "all" || model !== "all" || resource !== "all";
  const set = (ids: string[], on: boolean) => {
    const next = new Set(chosen);
    for (const id of ids) on ? next.add(id) : next.delete(id);
    save({ ...access, sessions: [...next] });
  };
  const pageIds = rows.map((r) => r.id);
  const pageAll = pageIds.length > 0 && pageIds.every((id) => chosen.has(id));
  const meta = (r: SessionRow) => [provider(r.provider).label, r.project, r.model, relativeTime(r.updatedAt)].filter(Boolean).join(" · ");
  return <div className="space-y-2.5" aria-label="Choose sessions">
    <div className="flex w-full items-center gap-2">
      <SearchField label="Search sessions" placeholder="Search title, folder, tool, model or tag" value={q} onChange={(v) => reset(() => setQ(v))} className="min-w-0 flex-1" />
      {filtered && <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => reset(() => { setQ(""); setShow("all"); setTool("all"); setModel("all"); setResource("all"); })}>Clear filters</Button>}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <FilterSelect label="Show sessions" value={show} options={SHOW_OPTIONS} onChange={(v) => reset(() => setShow(v as Show))} className="w-36" />
      <FilterSelect label="Filter by tool" value={tool} options={providerOptions} onChange={(v) => reset(() => setTool(v))} className="w-44" />
      <FilterSelect label="Filter by model" value={model} options={modelOptions} onChange={(v) => reset(() => setModel(v))} className="w-40" />
      <FilterSelect label="Filter by resources" value={resource} options={RESOURCE_OPTIONS} onChange={(v) => reset(() => setResource(v))} className="w-38" />
    </div>
    {error && <ErrorNote text={error} />}
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="flex items-center gap-3 border-b border-line bg-surface-2 px-3 py-2">
        <Checkbox label="Select every session on this page" checked={pageAll} disabled={!rows.length} onChange={() => set(pageIds, !pageAll)} />
        <span className="flex-1 text-[12px] font-medium text-muted">{plural(liveCount, "session")} selected</span>
        {access.sessions.length > 0 && <Button size="sm" variant="ghost" onClick={() => save({ ...access, sessions: [] })}>Clear selection</Button>}
      </div>
      {loading && !data ? <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-11 w-full rounded-xl" />)}</div>
        : rows.length === 0 ? <p className="px-3 py-6 text-center text-[12px] text-faint">{show === "selected" && !access.sessions.length ? "Nothing selected yet." : filtered ? "No matching sessions." : "No saved sessions yet."}</p>
        : <ul className="max-h-96 divide-y divide-line overflow-y-auto" aria-label="Sessions">
          {rows.map((r) => <li key={r.id}>
            <label className={cx("flex cursor-pointer items-center gap-3 px-3 py-2", chosen.has(r.id) ? "bg-accent-soft/60" : "hover:bg-surface-2/60")}>
              <Checkbox label={r.title} checked={chosen.has(r.id)} onChange={() => set([r.id], !chosen.has(r.id))} />
              <ProviderBadge id={r.provider} size={26} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium">{r.title}</span>
                <span className="block truncate font-mono text-[11px] text-faint">{meta(r)}</span>
              </span>
            </label>
          </li>)}
        </ul>}
      {data && <div className="border-t border-line bg-surface-2 px-3 py-2">
        <Pagination page={Math.floor((data.offset ?? 0) / limit)} pageSize={limit} total={data.total} onPage={setPage} noun="session"
          limitOptions={[10, 25, 50, 100] as const} currentLimit={limit} onLimitChange={(l) => { setLimit(l === "auto" ? 25 : l); setPage(0); }} />
      </div>}
    </div>
  </div>;
}

export function AgentAccessSettings() {
  const access = useApp((st) => st.settings.agentAccess);
  const info = useLoad(() => api.agentCliInfo(), ["agent-cli-info"]);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(""), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  const save = (next: AgentAccess) => { setError(""); void saveSetting("agentAccess", next).catch((e) => setError(errorText(e))); };
  const on = access.enabled;
  const picking = on && access.mode === "selected";
  const selectedKey = access.sessions.join(",");
  const live = useLoad(() => (picking && access.sessions.length ? api.querySessions({ ids: access.sessions, limit: 1, rowsOnly: true }) : Promise.resolve(null)), ["agent-access-selected-count", picking, selectedKey]);
  const liveCount = access.sessions.length ? live.data?.total ?? access.sessions.length : 0;
  const bin = info.data?.path ? quote(info.data.path) : "hopilo-cli";
  const commands = [
    { label: "Claude Code", text: `claude mcp add hopilo -- ${bin} mcp` },
    { label: "Codex, Cursor and other MCP clients", text: JSON.stringify({ mcpServers: { hopilo: { command: info.data?.path ?? "hopilo-cli", args: ["mcp"] } } }, null, 2) },
  ];
  const copy = async (label: string, text: string) => {
    try { await writeText(text); setCopied(label); } catch (e) { setError(errorText(e)); }
  };
  return <Card className="space-y-4 p-5" aria-label="Agent access">
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="font-semibold">Let agents read saved sessions</h2>
        <p className="mt-1 text-[12px] text-muted">Coding agents can search the sessions saved in Hopilo and read redacted handoffs. They cannot read your project files, change anything, or see hidden sessions. Nothing leaves this computer.</p>
      </div>
      <Toggle label="Allow agent access" checked={on} onChange={(enabled) => save({ ...access, enabled })} />
    </div>
    {error && <p role="alert" className="text-danger">{error}</p>}
    <fieldset disabled={!on} aria-disabled={!on} className={cx("m-0 min-w-0 space-y-4 border-0 p-0", !on && "pointer-events-none select-none opacity-50")}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-semibold">Sessions agents can read</h3>
            <p className="text-[12px] text-faint">{!on ? "Agent access is off. Agents get nothing." : access.mode === "all" ? "Every saved session, including ones saved later. Hidden sessions are never shared." : liveCount ? `Only the ${plural(liveCount, "session")} you select below.` : "Nothing selected yet, so agents get nothing."}</p>
          </div>
          <Segmented label="Sessions agents can read" value={access.mode} onChange={(mode) => save({ ...access, mode })} options={[{ value: "all", label: "All" }, { value: "selected", label: "Selected" }]} />
        </div>
        {picking && <SessionPicker access={access} save={save} liveCount={liveCount} />}
      </div>
      <div className="space-y-2 border-t border-line pt-4">
        <h3 className="text-[13px] font-semibold">Connect an agent</h3>
        <p className="text-[12px] text-muted">Nothing to install. The <code>hopilo-cli</code> command ships inside Hopilo; agents start it from the path below over MCP, the same way they run any local tool. Paste one of these into your agent's setup once.</p>
        {info.data && !info.data.installed && <p role="status" className="text-[12px] text-warning">The hopilo-cli command was not found next to the app. Rebuild Hopilo (cargo build -p hopilo-agent-cli).</p>}
        {commands.map((c) => <div key={c.label} className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-muted">{c.label}</span>
            <Button size="sm" variant="ghost" onClick={() => void copy(c.label, c.text)}>{copied === c.label ? "Copied" : "Copy"}</Button>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-xl border border-line bg-surface-2 px-3 py-2 text-[12px]">{c.text}</pre>
        </div>)}
      </div>
    </fieldset>
  </Card>;
}
