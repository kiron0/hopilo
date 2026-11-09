import { useMemo, useRef, useState } from "react";
import { api, errorText } from "../lib/api";
import { catalogEntries, destinationConfig, isStale, normalizeLimitCache, resolveDestinationModel, validLimit, type DestinationBudget, type LimitCache } from "../lib/modelLimits";
import { TARGETS } from "../lib/providers";
import { useApp } from "../lib/store";
import { openExternal } from "../lib/updates";
import { Loader2, RefreshCw } from "./Icons";
import { Select } from "./Select";
import { Button, TextInput } from "./ui";

const date = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Never";
const fmt = (value: number | null) => value === null ? "Unknown" : value.toLocaleString();

function DestinationEditor({ targetId }: { targetId: string }) {
  const cache = useApp((s) => s.settings.modelLimits);
  const configs = useApp((s) => s.settings.destinationBudgets);
  const saved = destinationConfig(targetId, configs);
  const [draft, setDraft] = useState(saved);
  const [manual, setManual] = useState(String(saved.manualLimit ?? ""));
  const [appCap, setAppCap] = useState(String(saved.appLimit ?? ""));
  const [percent, setPercent] = useState(String(saved.reservePercent ?? 20));
  const [reserved, setReserved] = useState(String(saved.reserveTokens ?? 0));
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const entries = useMemo(() => {
    const rank = { reported: 0, official: 1, catalog: 2 };
    const records = catalogEntries(cache).sort((a, b) => Number(isStale(a.source, a)) - Number(isStale(b.source, b)) || rank[a.source.kind ?? "official"] - rank[b.source.kind ?? "official"]);
    const unique = new Map<string, typeof records[number]>();
    for (const m of records) if (!unique.has(`${m.providerId}/${m.id}`)) unique.set(`${m.providerId}/${m.id}`, m);
    return [...unique.values()];
  }, [cache]);
  const providers = useMemo(() => [...new Map(entries.map((m) => [m.providerId, m.providerName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [entries]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((m) => (!draft.providerId || m.providerId === draft.providerId) && `${m.id} ${m.name ?? ""} ${m.providerName}`.toLowerCase().includes(q));
  }, [entries, draft.providerId, query]);
  const evidence = entries.length ? catalogEntries(cache).filter((m) => m.providerId === draft.providerId && m.id === draft.modelId) : [];
  const candidate: DestinationBudget = { ...draft,
    manualLimit: manual ? Number(manual) : undefined, appLimit: appCap ? Number(appCap) : undefined,
    reservePercent: Number(percent), reserveTokens: Number(reserved) };
  const preview = resolveDestinationModel(targetId, cache, { [targetId]: candidate });
  const set = (next: Partial<DestinationBudget>) => { setDraft((d) => ({ ...d, ...next })); setMessage(""); setError(""); };
  const apply = async () => {
    setError(""); setMessage("");
    if (!draft.providerId.trim() || !draft.modelId.trim() || draft.providerId.length > 200 || draft.modelId.length > 500) { setError("Enter a provider ID and destination model ID."); return; }
    if (manual && !validLimit(Number(manual)) || appCap && !validLimit(Number(appCap))) { setError("Limits must be whole token counts between 1 and 100,000,000."); return; }
    if (!percent.trim() || !Number.isFinite(Number(percent)) || Number(percent) < 0 || Number(percent) > 90 || !reserved.trim() || !Number.isSafeInteger(Number(reserved)) || Number(reserved) < 0 || Number(reserved) > 100_000_000) { setError("Reserve must be 0–90% plus 0–100,000,000 whole tokens."); return; }
    setBusy(true);
    const next = { ...useApp.getState().settings.destinationBudgets, [targetId]: { ...candidate, providerId: draft.providerId.trim(), modelId: draft.modelId.trim() } };
    try { await api.setSetting("destinationBudgets", next); useApp.getState().setSettings({ destinationBudgets: next }); setMessage("Destination budget saved."); }
    catch (e) { setError(`Could not save destination budget: ${errorText(e)}`); }
    finally { setBusy(false); }
  };
  return <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-3.5">
    <div className="grid gap-3 sm:grid-cols-2">
      <div><div className="mb-1 text-[12px] font-medium">Provider</div><Select label="Catalog provider" value={draft.providerId} onChange={(providerId) => { set({ providerId, modelId: "", manualLimit: undefined, appLimit: undefined }); setManual(""); setAppCap(""); }} options={[
        { value: "", label: "All providers" }, ...(!providers.some(([id]) => id === draft.providerId) && draft.providerId ? [{ value: draft.providerId, label: draft.providerId }] : []), ...providers.map(([value, label]) => ({ value, label })),
      ]} /></div>
      <label className="block text-[12px] font-medium">Find model<TextInput type="text" aria-label="Find destination model" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search model name or ID" className="mt-1" /></label>
    </div>
    <div className="max-h-64 overflow-auto rounded-lg border border-line bg-card" aria-label="Matching destination models">
      {filtered.slice(0, 40).map((m) => <button key={`${m.providerId}/${m.id}`} type="button" aria-label={`Use ${m.providerId}/${m.id}`} aria-pressed={draft.modelId === m.id && draft.providerId === m.providerId} onClick={() => { set({ providerId: m.providerId, modelId: m.id }); setManual(""); setAppCap(""); }} className="flex w-full flex-wrap items-center justify-between gap-1 border-b border-line px-3 py-2 text-left text-[12px] last:border-0 hover:bg-accent-soft aria-pressed:bg-accent-soft">
        <span className="min-w-0 break-all">{m.providerId}/{m.id}<span className="ml-2 text-faint">{m.source.kind === "official" || !m.source.kind ? "Official supplement" : m.source.kind === "reported" ? "Imported report" : "Community catalog"}{isStale(m.source, m) ? " · stale" : ""}</span></span>
        <span className="font-mono text-muted">{fmt(m.window)}</span>
      </button>)}
      {!filtered.length && <p className="px-3 py-4 text-[12px] text-muted">No matching models. Try another provider or search, sync the catalog, or enter a custom model below.</p>}
    </div>
    <p className="text-[12px] text-faint">Showing {Math.min(40, filtered.length)} of {filtered.length.toLocaleString()} matches. Narrow search to see more. Model choice applies to this destination only.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-[12px] font-medium">Provider ID<TextInput type="text" aria-label="Destination provider ID" value={draft.providerId} onChange={(e) => { set({ providerId: e.target.value }); setManual(""); setAppCap(""); }} className="mt-1" placeholder="e.g. openai" /></label>
      <label className="block text-[12px] font-medium">Model ID<TextInput type="text" aria-label="Destination model ID" value={draft.modelId} onChange={(e) => { set({ modelId: e.target.value }); setManual(""); setAppCap(""); }} className="mt-1" placeholder="Exact ID, including any version suffix" /></label>
    </div>
    <details><summary className="cursor-pointer text-[12px] font-medium text-muted">Custom limits, app/plan cap and reserve</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-[12px]">Manual context limit<TextInput type="text" aria-label="Manual context limit" inputMode="numeric" value={manual} onChange={(e) => { setManual(e.target.value); setMessage(""); }} className="mt-1" placeholder="Use model metadata" /></label>
        <label className="block text-[12px]">App or plan cap<TextInput type="text" aria-label="App or plan cap" inputMode="numeric" value={appCap} onChange={(e) => { setAppCap(e.target.value); setMessage(""); }} className="mt-1" placeholder="No additional cap" /></label>
        <label className="block text-[12px]">Reserve percent<TextInput type="text" aria-label="Reserve percent" inputMode="decimal" value={percent} onChange={(e) => { setPercent(e.target.value); setMessage(""); }} className="mt-1" /></label>
        <label className="block text-[12px]">Additional reserved tokens<TextInput type="text" aria-label="Additional reserved tokens" inputMode="numeric" value={reserved} onChange={(e) => { setReserved(e.target.value); setMessage(""); }} className="mt-1" /></label>
      </div>
      <p className="mt-2 text-[12px] text-faint">Manual limit overrides metadata. App/plan cap can only reduce it. Reserve leaves room for system prompts, tools and replies; published input caps also apply.</p>
    </details>
    <div className="space-y-1 text-[12px] text-muted" aria-live="polite">
      <p className="break-all font-medium text-ink">{preview.providerId ? `${preview.providerId}/` : ""}{preview.label}</p>
      <p>{fmt(preview.window)} token limit · {fmt(preview.available)} available after reserve{preview.inputLimit ? ` · input cap ${fmt(preview.inputLimit)}` : ""}</p>
      <p>{preview.sourceName}{preview.stale ? " · stale / unverified" : ""}{preview.updatedAt ? ` · ${date(preview.updatedAt)}` : ""}</p>
      {preview.provenance === "unknown" && <p className="text-warning">Unknown model limit. Enter a manual limit or import metadata before relying on size suggestions.</p>}
      {preview.conflicts > 0 && <p className="text-warning">Sources disagree. Fresh reported metadata takes priority, then official supplements, then catalog; stale entries are fallback only.</p>}
      {preview.available === 0 && <p className="text-warning">Reserve consumes the entire budget. Reduce reserve or increase the limit.</p>}
    </div>
    {!!evidence.length && <details className="text-[12px] text-muted"><summary className="cursor-pointer">Model evidence ({evidence.length} sources)</summary><ul className="mt-2 space-y-2">{evidence.map((m) => <li key={m.source.id} className="rounded-lg border border-line p-2">
      <p className="font-medium">{m.source.name}{isStale(m.source, m) ? " · stale" : ""}</p>
      <p>{fmt(m.window)} context · {m.inputLimit ? `${fmt(m.inputLimit)} input cap` : "Input cap not published"}{m.outputLimit ? ` · ${fmt(m.outputLimit)} max output` : ""}</p>
      <p>Last verified/imported: {date(m.source.updatedAt)}</p>
    </li>)}</ul></details>}
    <div className="flex flex-wrap items-center gap-3"><Button size="sm" disabled={busy} onClick={apply}>{busy ? "Saving…" : "Save destination budget"}</Button><span role="status" className="text-[12px] text-success">{message}</span></div>
    {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
  </div>;
}

export function ModelLimitSettings() {
  const cache = useApp((s) => s.settings.modelLimits);
  const defaultTarget = useApp((s) => s.settings.defaultTarget);
  const [targetId, setTargetId] = useState(defaultTarget);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const entries = useMemo(() => catalogEntries(cache), [cache]);
  const providerCount = new Set(entries.map((m) => m.providerId)).size;
  const modelCount = new Set(entries.map((m) => `${m.providerId}/${m.id}`)).size;
  const run = async (action: () => Promise<LimitCache>) => {
    if (lock.current) return;
    lock.current = true; setSyncing(true); setError("");
    try { useApp.getState().setSettings({ modelLimits: normalizeLimitCache(await action()) }); }
    catch (e) { setError(`Could not sync or save limits: ${errorText(e)}. Previous limits are still available.`); }
    finally { lock.current = false; setSyncing(false); }
  };
  const counts = (status: string) => cache.sources.filter((s) => s.status === status).length;
  return <div className="space-y-4 py-4" aria-busy={syncing}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-xl"><div className="text-[13px] font-medium">Context window limits</div>
        <p className="mt-1 text-[12px] text-faint">Sync the full models.dev community catalog plus available official supplements. New catalog providers and models appear without an app update. Coverage is broad, not exhaustive; provenance stays visible.</p>
        <p className="mt-1 text-[12px] text-faint">Internet is needed only during sync. Saved metadata works offline after restart. No chats or API keys are sent. API limits can differ from app and plan limits.</p>
      </div>
      <div className="flex flex-wrap gap-2"><Button size="sm" disabled={syncing} onClick={() => run(() => api.syncModelLimits())} icon={syncing ? <Loader2 aria-hidden size={14} className="animate-spin" /> : <RefreshCw aria-hidden size={14} />}>{syncing ? "Syncing…" : "Sync limits"}</Button>
        <Button size="sm" disabled={syncing} onClick={() => file.current?.click()}>Import metadata</Button>
        <input ref={file} aria-label="Import model metadata JSON" type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} onChange={(e) => { const selected = e.target.files?.[0]; e.target.value = ""; if (selected) void run(async () => { if (selected.size > 32 * 1024 * 1024) throw new Error("Metadata exceeds 32 MiB limit"); return api.importModelLimits(await selected.text()); }); }} />
      </div>
    </div>
    <div role="status" aria-live="polite" className="text-[12px] text-muted">{syncing ? "Updating model metadata…" : cache.sources.length ? `${counts("updated")} sources updated · ${counts("unchanged")} unchanged · ${counts("failed")} failed. Saved on this device.` : "Not synced. Explicit bundled models have estimates; other limits remain unknown."} {providerCount.toLocaleString()} providers · {modelCount.toLocaleString()} saved model IDs.</div>
    {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    <div className="space-y-2"><div className="text-[13px] font-medium">Destination budget</div><div className="max-w-sm"><Select label="Budget destination" value={targetId} onChange={setTargetId} options={TARGETS.map((t) => ({ value: t.id, label: t.label }))} /></div>
      <p className="text-[12px] text-faint">Choose where you will continue, then its exact model. The source chat’s model is never used to guess the destination.</p>
      <DestinationEditor key={targetId} targetId={targetId} />
    </div>
    <details><summary className="cursor-pointer text-[13px] font-medium">Sync report · sources and provider changes</summary>
      <div className="mt-3 divide-y divide-line">{cache.sources.map((source) => <div key={source.id} className="space-y-1 py-3 text-[12px]">
        <div className="font-medium">{source.name} · {source.status}{source.status === "failed" ? " · saved limits retained" : ""}</div>
        <p className="text-faint">Checked {date(source.checkedAt)} · Last success {date(source.updatedAt)} · {source.models.length.toLocaleString()} saved records</p>
        {source.url.startsWith("https://") && <button type="button" className="break-all text-left text-accent hover:underline" onClick={() => void openExternal(source.url)}>{source.url}</button>}
        {source.error && <p className="break-words text-warning">{source.error}</p>}
        {!!source.providers?.length && <details><summary className="cursor-pointer text-muted">Provider changes ({source.providers.length})</summary><div className="mt-2 overflow-auto"><table className="w-full text-left text-[12px]"><thead><tr>{["Provider", "Models", "Added", "Changed", "Removed", "Retained stale", "Invalid"].map((label) => <th key={label} scope="col" className="whitespace-nowrap px-2 py-1 font-medium">{label}</th>)}</tr></thead><tbody>{source.providers.map((p) => <tr key={p.id}><th scope="row" className="px-2 py-1 font-normal">{p.name || p.id}</th>{[p.models, p.added, p.changed, p.removed, p.retained, p.invalid].map((n, i) => <td key={i} className="px-2 py-1 font-mono">{n}</td>)}</tr>)}</tbody></table></div></details>}
      </div>)}</div>
      {!cache.sources.length && <p className="mt-2 text-[12px] text-muted">Sync or import metadata to see source results.</p>}
    </details>
    <details className="text-[12px] text-muted"><summary className="cursor-pointer">Offline import format and resolution rules</summary>
      <p className="mt-2">Import a models.dev api.json file, or a runtime metadata report with exact provider/model IDs. Imported reports are user-supplied, not independently verified official specs.</p>
      <pre className="mt-2 overflow-auto rounded-lg bg-surface-2 p-3 text-[12px]">{'{"models":[{"providerId":"my-provider","id":"my-model","window":128000,"inputLimit":120000}]}'}</pre>
      <p className="mt-2">Priority: manual override → fresh imported runtime report → fresh official supplement → fresh catalog → stale saved metadata → exact bundled estimate → unknown. An app/plan cap can reduce any known limit. Removed models remain available as stale records. No automatic refresh runs.</p>
    </details>
  </div>;
}
