import { useEffect, useState } from "react";
import { api, errorText } from "../lib/api";
import { useDebouncedValue } from "../lib/hooks";
import { BUNDLED, resolveDestinationModel, validLimit, type CatalogPage, type DestinationBudget, type ModelLimit } from "../lib/modelLimits";
import { TARGETS } from "../lib/providers";
import { useApp } from "../lib/store";
import { Loader2, RefreshCw } from "./Icons";
import { Select } from "./Select";
import { Button, TextInput } from "./ui";

const fmt = (value: number | null) => value === null ? "Unknown" : value.toLocaleString();

async function saveBudget(targetId: string, budget: DestinationBudget | null) {
  const next = { ...useApp.getState().settings.destinationBudgets };
  if (budget) next[targetId] = budget;
  else delete next[targetId];
  await api.setSetting("destinationBudgets", next);
  useApp.getState().setSettings({ destinationBudgets: next });
}

function bundledMatches(query: string): ModelLimit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return BUNDLED.filter((m) => terms.every((t) => `${m.providerId}/${m.id} ${m.name} ${m.providerName}`.toLowerCase().includes(t)));
}

function DestinationEditor({ targetId, catalog }: { targetId: string; catalog: CatalogPage | null }) {
  const configs = useApp((s) => s.settings.destinationBudgets);
  const model = resolveDestinationModel(targetId, configs);
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 150);
  const [results, setResults] = useState<ModelLimit[]>(BUNDLED);
  const [manual, setManual] = useState(String(configs[targetId]?.manualLimit ?? ""));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!catalog?.total) { setResults(bundledMatches(debounced)); return; }
    let active = true;
    api.searchModelLimits(debounced).then((page) => { if (active) setResults(page.models); }).catch((e) => { if (active) setError(errorText(e)); });
    return () => { active = false; };
  }, [debounced, catalog]);
  const save = async (budget: DestinationBudget | null, done: string) => {
    setError(""); setMessage("");
    try { await saveBudget(targetId, budget); setMessage(done); }
    catch (e) { setError(`Could not save: ${errorText(e)}`); }
  };
  const saveManual = () => {
    const limit = manual.trim() ? Number(manual) : undefined;
    if (limit !== undefined && !validLimit(limit)) { setError("Limit must be a whole token count between 1 and 100,000,000."); return; }
    void save({ providerId: model.providerId, modelId: model.id, window: model.source === "manual" ? configs[targetId]?.window : model.window ?? undefined, manualLimit: limit }, "Limit saved.");
  };
  return <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-3.5">
    <div className="space-y-1 text-[12px] text-muted" aria-live="polite">
      <p className="break-all font-medium text-ink">{model.providerId ? `${model.providerId}/` : ""}{model.label}</p>
      <p>{fmt(model.window)} token context · {fmt(model.available)} used for size suggestions · {model.sourceName}</p>
      {model.source === "unknown" && <p className="text-warning">Unknown limit. Choose a model or enter a limit.</p>}
    </div>
    <label className="block text-[12px] font-medium">Find model<TextInput type="text" aria-label="Find destination model" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search model name or ID" className="mt-1" /></label>
    <div className="max-h-64 overflow-auto rounded-lg border border-line bg-card" aria-label="Matching destination models">
      {results.map((m) => <button key={`${m.providerId}/${m.id}`} type="button" aria-label={`Use ${m.providerId}/${m.id}`} aria-pressed={model.id === m.id && model.providerId === m.providerId} onClick={() => { setManual(""); void save({ providerId: m.providerId, modelId: m.id, window: m.window }, `Using ${m.name}.`); }} className="flex w-full flex-wrap items-center justify-between gap-1 border-b border-line px-3 py-2 text-left text-[12px] last:border-0 hover:bg-accent-soft aria-pressed:bg-accent-soft">
        <span className="min-w-0 break-all">{m.providerId}/{m.id}</span>
        <span className="font-mono text-muted">{fmt(m.window)}</span>
      </button>)}
      {!results.length && <p className="px-3 py-4 text-[12px] text-muted">No matching models. Refresh the catalog or enter a limit below.</p>}
    </div>
    <div className="flex flex-wrap items-end gap-2">
      <label className="block text-[12px] font-medium">Manual context limit<TextInput type="text" aria-label="Manual context limit" inputMode="numeric" value={manual} onChange={(e) => { setManual(e.target.value); setMessage(""); }} className="mt-1 w-44" placeholder="Use model limit" /></label>
      <Button size="sm" onClick={saveManual}>Save limit</Button>
      {configs[targetId] && <Button size="sm" variant="secondary" onClick={() => { setManual(""); void save(null, "Using the default model."); }}>Use default</Button>}
      <span role="status" className="text-[12px] text-success">{message}</span>
    </div>
    {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
  </div>;
}

export function ModelLimitSettings() {
  const defaultTarget = useApp((s) => s.settings.defaultTarget);
  const [targetId, setTargetId] = useState(defaultTarget);
  const [catalog, setCatalog] = useState<CatalogPage | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { api.searchModelLimits("").then(setCatalog).catch(() => setCatalog(null)); }, []);
  const sync = async () => {
    if (syncing) return;
    setSyncing(true); setError("");
    try { setCatalog(await api.syncModelLimits()); }
    catch (e) { setError(`Could not refresh: ${errorText(e)}. The saved catalog is unchanged.`); }
    finally { setSyncing(false); }
  };
  return <div className="space-y-4 py-4" aria-busy={syncing}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-xl"><div className="text-[13px] font-medium">Context window limits</div>
        <p className="mt-1 text-[12px] text-faint">Size suggestions use 80% of the destination model's context window. Common models are built in. Refresh loads models.dev limits only for the providers behind your destinations; no chats or keys are sent.</p>
      </div>
      <Button size="sm" disabled={syncing} onClick={() => void sync()} icon={syncing ? <Loader2 aria-hidden size={14} className="animate-spin" /> : <RefreshCw aria-hidden size={14} />}>{syncing ? "Refreshing…" : "Refresh catalog"}</Button>
    </div>
    <div role="status" aria-live="polite" className="text-[12px] text-muted">{catalog?.total ? `${catalog.total.toLocaleString()} models · updated ${catalog.updatedAt ? new Date(catalog.updatedAt).toLocaleString() : "unknown"}` : `${BUNDLED.length} built-in models · catalog not downloaded`}</div>
    {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    <div className="space-y-2"><div className="text-[13px] font-medium">Destination model</div><div className="max-w-sm"><Select label="Budget destination" value={targetId} onChange={setTargetId} options={TARGETS.map((t) => ({ value: t.id, label: t.label }))} /></div>
      <DestinationEditor key={targetId} targetId={targetId} catalog={catalog} />
    </div>
  </div>;
}
