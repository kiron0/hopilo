import { useEffect, useMemo, useState } from "react";
import {
  ChevronDownIcon,
  Copy,
  Download,
  GitMerge,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
} from "./Icons";
import { api, type Level, type PromptStyle, type SessionOrder } from "../lib/api";
import { copySessions, exportSessionsAs, FORMATS, type Format } from "../lib/actions";
import { plural, provider, tokens } from "../lib/format";
import { budget, fittingLevel, intentChoices, modelFor, resolveIntent, STYLES } from "../lib/handoff";
import { useLoad } from "../lib/hooks";
import { useApp } from "../lib/store";
import { target } from "../lib/targets";
import { Button, Checkbox, cx, Modal, Segmented, Skeleton, TargetSelect, TextArea } from "./ui";

const FORMAT_KEYS = Object.keys(FORMATS) as Format[];
const EXPORT_PICK_KEY = "hopilo.exportFormats";

function loadPicked(): Format[] {
  try {
    const raw = JSON.parse(localStorage.getItem(EXPORT_PICK_KEY) ?? "[]");
    const valid = Array.isArray(raw) ? FORMAT_KEYS.filter((f) => raw.includes(f)) : [];
    return valid.length ? valid : ["md"];
  } catch {
    return ["md"];
  }
}

function savePicked(f: Format[]) {
  try {
    localStorage.setItem(EXPORT_PICK_KEY, JSON.stringify(f));
  } catch {}
}

function FormatThumb({ format }: { format: Format }) {
  const line = "h-[3px] rounded-full bg-current opacity-25";
  return (
    <div aria-hidden className="relative mx-auto flex h-[54px] w-[44px] flex-col gap-[4px] rounded-[7px] border border-line bg-card px-[6px] pt-[7px] shadow-item">
      {format === "md" && (
        <>
          <div className="h-[3px] w-[70%] rounded-full bg-current opacity-60" />
          <div className={cx(line, "w-full")} />
          <div className={cx(line, "w-[85%]")} />
          <div className="flex gap-[2px]"><div className="h-[2.5px] w-[2.5px] rounded-full bg-current opacity-40" /><div className={cx(line, "w-[70%]")} /></div>
        </>
      )}
      {format === "txt" && [100, 92, 100, 74].map((w, i) => <div key={i} className={line} style={{ width: `${w}%` }} />)}
      {format === "html" && (
        <>
          <div className="flex gap-[2px]">{[0, 1, 2].map((i) => <div key={i} className="h-[3px] w-[3px] rounded-full bg-current opacity-40" />)}</div>
          <div className="h-[9px] w-full rounded-[2px] bg-current opacity-15" />
          <div className={cx(line, "w-[80%]")} />
          <div className="h-[6px] w-full rounded-[2px] border border-current opacity-30" />
        </>
      )}
      {format === "json" && (
        <div className="font-mono text-[6.5px] leading-[8px] opacity-60">
          {"{"}
          <div className="pl-[3px]">"id": …</div>
          <div className="pl-[3px]">"msgs": []</div>
          {"}"}
        </div>
      )}
      {format === "handoff" && (
        <>
          <div className="mx-auto h-[18px] w-[3px] bg-[repeating-linear-gradient(to_bottom,currentColor_0_3px,transparent_3px_6px)] opacity-40" />
          <div className="mx-auto h-[7px] w-[8px] rounded-[2px] border border-current opacity-50" />
        </>
      )}
      <span className="absolute -bottom-[6px] left-1/2 -translate-x-1/2 rounded-[4px] bg-surface-3 px-[4px] py-px font-mono text-[8.5px] font-semibold uppercase tracking-wide text-muted">
        .{FORMATS[format].ext}
      </span>
    </div>
  );
}

export type HandoffAction = "copy" | "copy-markdown" | "export";

export interface HandoffModalProps {
  ids: string[];
  action: HandoffAction;
  onClose: () => void;
  onSuccess?: () => void;
}

const ORDER_OPTIONS: { value: SessionOrder; label: string }[] = [
  { value: "selected", label: "As listed" },
  { value: "chronological", label: "Oldest first" },
  { value: "researchFirst", label: "Chats, then agents" },
];

function BudgetMeter({ used, window, label }: { used: number; window: number; label: string }) {
  const b = budget(used, window);
  const pct = Math.min(100, b.pct);
  const color = b.tone === "over" ? "bg-danger" : b.tone === "tight" ? "bg-warning" : "bg-success";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
        <span className="text-muted">
          <strong className="font-mono text-ink">~{tokens(used)}</strong> tokens · <strong className={cx("font-mono", b.tone === "over" ? "text-danger" : b.tone === "tight" ? "text-warning" : "text-success")}>{b.pct < 1 ? "<1" : Math.round(b.pct)}%</strong> of {label}
        </span>
        <span className="font-mono text-[10.5px] text-faint">{tokens(window)} window</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Context window used">
        <div className={cx("h-full rounded-full transition-[width] duration-300", color)} style={{ width: `${Math.max(pct, 1.5)}%` }} />
      </div>
    </div>
  );
}

export function HandoffModal({ ids, action, onClose, onSuccess }: HandoffModalProps) {
  const settings = useApp((s) => s.settings);
  const navigate = useApp((s) => s.navigate);
  const [level, setLevel] = useState<Level>(settings.level);
  const [targetId, setTargetId] = useState(settings.defaultTarget);
  const [intentKey, setIntentKey] = useState(settings.defaultIntent);
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [styleChoice, setStyleChoice] = useState<PromptStyle | "auto">(settings.promptStyle ?? "auto");
  const [advanced, setAdvanced] = useState(false);
  const [order, setOrder] = useState<SessionOrder>("selected");
  const [ordered, setOrdered] = useState<string[]>(ids);
  const [excludeSecrets, setExcludeSecrets] = useState(true);
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [showSecretDetails, setShowSecretDetails] = useState(false);
  const [picked, setPicked] = useState<Format[]>(loadPicked);
  const [busy, setBusy] = useState(false);

  const { data, loading, error } = useLoad(() => api.preflightHandoff(ids), [ids.join()]);
  const rows = useLoad(() => api.listSessions(), [], { refreshOnChange: false });
  const titles = useMemo(() => new Map((rows.data ?? []).map((r) => [r.id, r])), [rows.data]);

  const findings = data?.findings ?? [];
  const hasSecrets = findings.length > 0;
  const redactedCount = findings.filter((f) => !kept.has(f.fingerprint)).length;
  const multi = ids.length > 1;
  const isCopy = action === "copy";
  const showIntent = isCopy || (action === "export" && picked.includes("txt"));
  const choices = intentChoices(settings.handoffTemplates);
  const choice = resolveIntent(intentKey, settings.handoffTemplates);
  const model = modelFor(targetId);
  const style: PromptStyle = styleChoice === "auto" ? model.style : styleChoice;

  useEffect(() => {
    if (!choices.some((c) => c.key === intentKey)) setIntentKey("continue");
  }, [choices.length]);

  const toggleFormat = (f: Format) =>
    setPicked((p) => {
      const next = p.includes(f) ? p.filter((x) => x !== f) : FORMAT_KEYS.filter((x) => x === f || p.includes(x));
      savePicked(next);
      return next;
    });

  const fullTokens = data?.full.tokenEstimate || 1;
  const fullMsgs = data?.full.messageCount || 1;
  const noteTokens = Math.ceil(note.length / 4) + (choice.instructions ? Math.ceil(choice.instructions.length / 4) : 0);
  const levelTokens = (l: Level) => (data ? (l === "full" ? data.full : l === "balanced" ? data.balanced : data.minimal).tokenEstimate + noteTokens : 0);
  const used = levelTokens(level);
  const fit = data ? fittingLevel({ full: levelTokens("full"), balanced: levelTokens("balanced"), minimal: levelTokens("minimal") }, model.window) : null;
  const overBudget = !!data && budget(used, model.window).tone === "over";

  const conciseDelta = (lvl: Level) => {
    if (!data || lvl === "full") return null;
    const stats = lvl === "balanced" ? data.balanced : data.minimal;
    const tokPct = Math.max(0, Math.round((1 - stats.tokenEstimate / fullTokens) * 100));
    const msgPct = Math.max(0, Math.round((1 - stats.messageCount / fullMsgs) * 100));
    return { tokPct, msgPct };
  };

  const move = (i: number, dir: -1 | 1) =>
    setOrdered((list) => {
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const goSettings = (section: string) => {
    onClose();
    navigate({ page: "settings", section });
  };

  const handleExecute = async () => {
    setBusy(true);
    const sendIds = multi && order === "selected" ? ordered : ids;
    const common = {
      level,
      excludeSecrets,
      ignore: excludeSecrets ? [...kept] : [],
      order: multi ? order : undefined,
      intent: choice.intent,
      instructions: choice.instructions,
      note: note.trim() || undefined,
      style,
    };
    try {
      const out =
        action === "export"
          ? await exportSessionsAs(sendIds, picked, { ...common, target: targetId })
          : await copySessions(sendIds, { ...common, target: targetId, markdown: action === "copy-markdown" });
      if (out) {
        onSuccess?.();
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  const titleText =
    action === "copy"
      ? multi ? `Combine ${plural(ids.length, "session")}` : "Copy session"
      : action === "copy-markdown"
      ? multi ? `Copy ${plural(ids.length, "session")} as Markdown` : "Copy as Markdown"
      : multi ? `Export ${plural(ids.length, "session")}` : "Export session";

  const actionButtonLabel =
    action === "copy"
      ? `${multi ? "Copy combined pack" : "Copy"} for ${target(targetId).label}`
      : action === "copy-markdown"
      ? "Copy Markdown"
      : picked.length === 0
      ? "Export"
      : picked.length === 1
      ? `Export ${FORMATS[picked[0]].name}`
      : `Export ${picked.length} formats`;

  return (
    <Modal
      title={titleText}
      onClose={onClose}
      wide
      footer={(close) => (
        <>
          {data && action !== "export" && (
            <span className="mr-auto hidden font-mono text-[11px] text-faint sm:inline">~{tokens(used)} tokens · {style === "xml" ? "XML" : style === "markdown" ? "Markdown" : "Context first"}</span>
          )}
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={(action === "export" && picked.length === 0) || !!error}
            icon={action === "export" ? <Download size={14} /> : <Copy size={14} />}
            onClick={handleExecute}
          >
            {actionButtonLabel}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        {error && <div className="rounded-xl border border-danger/40 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div>}

        {action !== "copy-markdown" && (
          <div className="rounded-xl border border-line bg-surface-2 px-3.5 py-3 space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="text-[13px] font-semibold text-ink">{isCopy ? "Continue in" : "Written for"}</span>
                <p className="text-[11.5px] text-muted">Size check and prompt layout follow it automatically.</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <div className="w-52">
                  <TargetSelect value={targetId} onChange={setTargetId} />
                </div>
              </div>
            </div>
            {loading && !data ? <Skeleton className="h-6 w-full rounded" /> : data && <BudgetMeter used={used} window={model.window} label={model.label} />}
            {overBudget && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning-soft px-2.5 py-1.5 text-[11.5px] text-warning">
                <span>Leaves little room for a reply. {fit && fit !== level ? `${fit[0].toUpperCase()}${fit.slice(1)} fits comfortably.` : !fit ? "Even Minimal is large for this model." : ""}</span>
                {fit && fit !== level && (
                  <Button size="sm" variant="secondary" onClick={() => setLevel(fit)}>
                    Switch to {fit}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {showIntent && (
          <div>
            <div className="mb-2 flex items-center justify-between text-[12.5px]">
              <span className="font-semibold text-muted">What should the next AI do?</span>
              <button type="button" onClick={() => goSettings("templates")} className="inline-flex items-center gap-1 text-[11.5px] font-medium text-accent hover:underline">
                <Pencil size={11} /> {settings.handoffTemplates.length ? "Edit templates" : "Add your own"}
              </button>
            </div>
            <div role="radiogroup" aria-label="Handoff intent" className="flex flex-wrap gap-1.5">
              {choices.map((c) => {
                const on = c.key === choice.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    title={c.hint}
                    onClick={() => setIntentKey(c.key)}
                    className={cx(
                      "h-8 rounded-full border px-3 text-[12.5px] font-medium transition-colors",
                      on ? "border-accent bg-accent-soft text-accent-strong shadow-xs" : "border-line bg-card text-muted hover:border-line-strong hover:text-ink",
                    )}
                  >
                    {c.label}
                  </button>
                );
              })}
              <button
                type="button"
                aria-expanded={noteOpen}
                onClick={() => setNoteOpen((v) => !v)}
                className={cx("h-8 rounded-full border border-dashed px-3 text-[12.5px] font-medium transition-colors", note.trim() ? "border-accent text-accent" : "border-line-strong text-faint hover:text-ink")}
              >
                {note.trim() ? "Note added" : "+ Note"}
              </button>
            </div>
            <p className="mt-1.5 text-[11.5px] text-faint">{choice.hint}</p>
            {noteOpen && (
              <TextArea
                autoFocus
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything extra for the next AI, e.g. “use pnpm, not npm” or “focus on the auth flow”"
                className="mt-2 text-[12.5px]"
              />
            )}
          </div>
        )}

        {multi && action !== "copy-markdown" && (
          <div className="rounded-xl border border-line bg-surface-2 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                <GitMerge size={14} className="text-accent" /> Combined pack order
              </span>
              <Segmented label="Session order" value={order} onChange={setOrder} options={ORDER_OPTIONS} />
            </div>
            {order === "selected" ? (
              <ol className="space-y-1">
                {ordered.map((id, i) => {
                  const r = titles.get(id);
                  return (
                    <li key={id} className="flex items-center gap-2 rounded-lg bg-card px-2 py-1.5 text-[12px] shadow-item">
                      <span className="w-4 text-center font-mono text-[10.5px] text-faint">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate">{r?.title ?? id}</span>
                      <span className="hidden shrink-0 text-[11px] text-faint sm:inline">{r ? provider(r.provider).label : ""}</span>
                      <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-surface-2 hover:text-ink disabled:opacity-30">
                        <ChevronDownIcon size={13} className="rotate-180" />
                      </button>
                      <button type="button" aria-label="Move down" disabled={i === ordered.length - 1} onClick={() => move(i, 1)} className="flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-surface-2 hover:text-ink disabled:opacity-30">
                        <ChevronDownIcon size={13} />
                      </button>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-[11.5px] text-muted">
                {order === "chronological" ? "Sessions are laid out by when they started." : "Web chats and notes come first as research, then coding-agent transcripts."}
              </p>
            )}
            <p className="mt-2 text-[11px] text-faint">Shared files are included once, and an overview lists files that come up in more than one session.</p>
          </div>
        )}

        {action === "export" && (
          <div>
            <div className="mb-2 text-[12.5px] font-semibold text-muted">Choose export formats</div>
            <div role="group" aria-label="Formats" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {FORMAT_KEYS.map((f) => {
                const on = picked.includes(f);
                return (
                  <label
                    key={f}
                    className={cx(
                      "relative flex cursor-pointer flex-col items-center gap-2 rounded-xl border px-2 pb-2.5 pt-3 text-center transition-all",
                      on ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-surface text-faint hover:border-line-strong hover:bg-surface-2",
                    )}
                  >
                    <span className="absolute right-2 top-2 flex">
                      <Checkbox label={`Include ${FORMATS[f].name}`} checked={on} onChange={() => toggleFormat(f)} />
                    </span>
                    <FormatThumb format={f} />
                    <span className="mt-0.5 block">
                      <span className="block text-[12px] font-semibold text-ink">{FORMATS[f].name}</span>
                      <span className="block text-[10px] leading-tight text-faint">{FORMATS[f].hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between text-[12.5px]">
            <span className="font-semibold text-muted">How much to include</span>
            <span className="font-mono text-[11px] text-faint">{loading && !data ? "Calculating tokens…" : `Original: ~${tokens(fullTokens)} tokens`}</span>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {(
              [
                { key: "full" as Level, title: "Full", hint: "All requests, replies, and tool calls word-for-word", stats: data?.full },
                { key: "balanced" as Level, title: "Balanced", hint: "Recent exchange intact, earlier history summarized", stats: data?.balanced },
                { key: "minimal" as Level, title: "Minimal", hint: "Goal, latest exchange, and key references only", stats: data?.minimal },
              ] as const
            ).map((opt) => {
              const active = level === opt.key;
              const delta = conciseDelta(opt.key);
              const tooBig = !!data && action !== "copy-markdown" && budget(levelTokens(opt.key), model.window).tone === "over";
              return (
                <button
                  key={opt.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setLevel(opt.key)}
                  className={cx(
                    "flex cursor-pointer flex-col justify-between rounded-xl border p-3 text-left transition-all",
                    active ? "border-accent bg-accent-soft/70 text-ink shadow-xs" : "border-line bg-surface text-muted hover:border-line-strong hover:bg-surface-2/60",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className={cx("text-[13px] font-semibold", active ? "text-accent-strong" : "text-ink")}>{opt.title}</span>
                    {tooBig ? (
                      <span className="rounded-md bg-warning-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold text-warning">too big</span>
                    ) : delta ? (
                      <span className="rounded-md bg-success-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold text-success">-{delta.tokPct}% tokens</span>
                    ) : (
                      <span className="font-mono text-[10px] uppercase tracking-wider text-faint">complete</span>
                    )}
                  </div>

                  <div className="my-2 space-y-0.5">
                    {loading && !opt.stats ? (
                      <Skeleton className="h-4 w-24 rounded" />
                    ) : (
                      <div className="flex items-baseline gap-1.5 font-mono text-[12px] text-ink">
                        <strong>~{tokens(opt.stats?.tokenEstimate ?? 0)}</strong>
                        <span className="text-[11px] text-faint">tokens</span>
                        <span className="text-faint">·</span>
                        <span className="text-[11.5px]">{plural(opt.stats?.messageCount ?? 0, "msg")}</span>
                      </div>
                    )}
                    {delta && <div className="text-[11px] font-medium text-success">{delta.msgPct}% fewer messages</div>}
                  </div>

                  <p className="text-[11px] leading-snug text-faint">{opt.hint}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface-2 p-3.5">
          {loading && !data ? (
            <div className="flex items-center gap-3">
              <Skeleton className="h-5 w-5 rounded-full" />
              <div className="space-y-1">
                <Skeleton className="h-3.5 w-40 rounded" />
                <Skeleton className="h-3 w-56 rounded" />
              </div>
            </div>
          ) : hasSecrets ? (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-warning-soft text-warning">
                    <ShieldAlert size={14} />
                  </span>
                  <div>
                    <span className="text-[12.5px] font-semibold text-ink">{plural(findings.length, "possible secret")} found</span>
                    <span className="ml-2 text-[11px] text-faint">Keys, tokens, credentials and your own rules</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-1.5 text-[12px] font-medium text-ink">
                    <Checkbox label="Redact secrets" checked={excludeSecrets} onChange={() => setExcludeSecrets(!excludeSecrets)} />
                    <span>Redact</span>
                  </label>
                  <button
                    type="button"
                    aria-expanded={showSecretDetails}
                    onClick={() => setShowSecretDetails(!showSecretDetails)}
                    className="ml-1 inline-flex cursor-pointer items-center gap-0.5 text-[11px] font-medium text-accent hover:underline"
                  >
                    <span>{showSecretDetails ? "Hide" : "Review"}</span>
                    <ChevronDownIcon size={12} className={cx("transition-transform", showSecretDetails && "rotate-180")} />
                  </button>
                </div>
              </div>

              <div className="text-[11px] text-muted">
                {excludeSecrets ? (
                  <span className="font-medium text-success">
                    ✓ {redactedCount === findings.length ? "All" : `${redactedCount} of ${findings.length}`} will be masked as <code className="rounded bg-surface-3 px-1 py-0.5 text-[10.5px]">[REDACTED: Type]</code>
                    {kept.size > 0 && <span className="text-muted"> · {kept.size} kept as false positives</span>}
                  </span>
                ) : (
                  <span className="font-medium text-warning">⚠ Unredacted values will be included in the clipboard or file.</span>
                )}
              </div>

              {showSecretDetails && (
                <div className="mt-2 max-h-44 overflow-auto rounded-lg border border-line bg-card text-[11px]">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-card text-left text-[10.5px] uppercase tracking-wider text-faint">
                      <tr>
                        <th className="px-2 py-1 font-medium">Type</th>
                        <th className="px-2 py-1 font-medium">Value</th>
                        <th className="px-2 py-1 text-right font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {findings.map((f) => {
                        const keep = kept.has(f.fingerprint);
                        return (
                          <tr key={`${f.kind}-${f.fingerprint}`} className={keep ? "opacity-60" : undefined}>
                            <td className="px-2 py-1 font-medium text-ink">
                              {f.kind}
                              {f.custom && <span className="ml-1 rounded bg-accent-soft px-1 text-[9.5px] text-accent">rule</span>}
                            </td>
                            <td className="px-2 py-1 font-mono text-faint">
                              {f.preview}
                              {f.count > 1 && <span className="ml-1 text-[10px]">×{f.count}</span>}
                            </td>
                            <td className="px-2 py-1 text-right">
                              <button
                                type="button"
                                disabled={!excludeSecrets}
                                onClick={() =>
                                  setKept((s) => {
                                    const n = new Set(s);
                                    if (n.has(f.fingerprint)) n.delete(f.fingerprint);
                                    else n.add(f.fingerprint);
                                    return n;
                                  })
                                }
                                className={cx(
                                  "rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium disabled:opacity-40",
                                  keep ? "border-line text-muted hover:text-ink" : "border-success/40 bg-success-soft text-success",
                                )}
                                title={keep ? "Kept as-is for this copy. Click to redact." : "Will be redacted. Click to keep it (false positive)."}
                              >
                                {keep ? "Keep" : "Redact"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2.5 text-success">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-success-soft text-success">
                <ShieldCheck size={14} />
              </span>
              <div className="text-[12px]">
                <span className="font-semibold text-ink">No secrets detected</span>
                <span className="ml-2 text-[11px] text-faint">No keys, credentials or blocked keywords found.</span>
              </div>
            </div>
          )}
          {data && (data.excludedFiles.length > 0 || data.ruleErrors.length > 0) && (
            <div className="mt-2.5 space-y-1 border-t border-line pt-2 text-[11px]">
              {data.excludedFiles.length > 0 && (
                <div className="text-muted">
                  Left out by your exclusion rules: <span className="font-mono text-ink">{data.excludedFiles.slice(0, 4).join(", ")}{data.excludedFiles.length > 4 ? ` +${data.excludedFiles.length - 4}` : ""}</span>
                </div>
              )}
              {data.ruleErrors.map((e) => (
                <div key={e.name} className="text-warning">
                  Rule “{e.name}” is skipped: {e.error}
                </div>
              ))}
            </div>
          )}
          <button type="button" onClick={() => goSettings("redaction")} className="mt-2 text-[11px] font-medium text-accent hover:underline">
            Custom redaction rules…
          </button>
        </div>

        {(isCopy || (action === "export" && picked.includes("txt"))) && (
          <div>
            <button type="button" aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)} className="inline-flex items-center gap-1 text-[12px] font-medium text-muted hover:text-ink">
              <SlidersHorizontal size={12} /> Prompt layout: {styleChoice === "auto" ? `Auto (${STYLES.find((s) => s.value === model.style)?.label})` : STYLES.find((s) => s.value === styleChoice)?.label}
              <ChevronDownIcon size={12} className={cx("transition-transform", advanced && "rotate-180")} />
            </button>
            {advanced && (
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-4">
                {[{ value: "auto" as const, label: "Auto", hint: `Matches ${model.label}` }, ...STYLES].map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    aria-pressed={styleChoice === s.value}
                    onClick={() => setStyleChoice(s.value)}
                    className={cx(
                      "rounded-xl border p-2.5 text-left transition-colors",
                      styleChoice === s.value ? "border-accent bg-accent-soft/70" : "border-line bg-surface hover:border-line-strong",
                    )}
                  >
                    <div className="text-[12.5px] font-semibold text-ink">{s.label}</div>
                    <div className="mt-0.5 text-[10.5px] leading-snug text-faint">{s.hint}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
