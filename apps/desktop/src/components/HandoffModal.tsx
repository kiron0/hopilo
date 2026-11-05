import { useState } from "react";
import {
  ChevronDownIcon,
  Copy,
  Download,
  ShieldAlert,
  ShieldCheck,
} from "./Icons";
import { api, type Level } from "../lib/api";
import { copySessions, exportSessionsAs, FORMATS, type Format } from "../lib/actions";
import { plural, tokens } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { useApp } from "../lib/store";
import { target } from "../lib/targets";
import { Button, Checkbox, cx, Modal, Skeleton, TargetSelect } from "./ui";

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
  initialLevel?: Level;
  onClose: () => void;
  onSuccess?: () => void;
}

export function HandoffModal({
  ids,
  action,
  initialLevel,
  onClose,
  onSuccess,
}: HandoffModalProps) {
  const settings = useApp((s) => s.settings);
  const [level, setLevel] = useState<Level>(initialLevel || settings.level);
  const [targetId, setTargetId] = useState(settings.defaultTarget);
  const [excludeSecrets, setExcludeSecrets] = useState(true);
  const [showSecretDetails, setShowSecretDetails] = useState(false);
  const [picked, setPicked] = useState<Format[]>(loadPicked);
  const [busy, setBusy] = useState(false);

  const { data, loading } = useLoad(() => api.preflightHandoff(ids), [ids.join()]);

  const findings = data?.findings ?? [];
  const hasSecrets = findings.length > 0;

  const toggleFormat = (f: Format) =>
    setPicked((p) => {
      const next = p.includes(f) ? p.filter((x) => x !== f) : FORMAT_KEYS.filter((x) => x === f || p.includes(x));
      savePicked(next);
      return next;
    });

  const fullTokens = data?.full.tokenEstimate || 1;
  const fullMsgs = data?.full.messageCount || 1;

  const conciseDelta = (lvl: Level) => {
    if (!data) return null;
    const stats = lvl === "full" ? data.full : lvl === "balanced" ? data.balanced : data.minimal;
    if (lvl === "full") return null;
    const tokPct = Math.max(0, Math.round((1 - stats.tokenEstimate / fullTokens) * 100));
    const msgPct = Math.max(0, Math.round((1 - stats.messageCount / fullMsgs) * 100));
    return { tokPct, msgPct };
  };

  const handleExecute = async () => {
    setBusy(true);
    try {
      if (action === "copy") {
        const out = await copySessions(ids, { target: targetId, level, excludeSecrets });
        if (out) {
          onSuccess?.();
          onClose();
        }
      } else if (action === "copy-markdown") {
        const out = await copySessions(ids, { target: targetId, level, markdown: true, excludeSecrets });
        if (out) {
          onSuccess?.();
          onClose();
        }
      } else {
        const out = await exportSessionsAs(ids, picked, { level, excludeSecrets });
        if (out) {
          onSuccess?.();
          onClose();
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const titleText =
    action === "copy"
      ? ids.length > 1
        ? `Copy ${plural(ids.length, "session")}`
        : "Copy session"
      : action === "copy-markdown"
      ? ids.length > 1
        ? `Copy ${plural(ids.length, "session")} as Markdown`
        : "Copy as Markdown"
      : ids.length > 1
      ? `Export ${plural(ids.length, "session")}`
      : "Export session";

  const actionButtonLabel =
    action === "copy"
      ? `Copy for ${target(targetId).label}`
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
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={action === "export" && picked.length === 0}
            icon={action === "export" ? <Download size={14} /> : <Copy size={14} />}
            onClick={handleExecute}
          >
            {actionButtonLabel}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        {action === "copy" && (
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-line bg-surface-2/40 px-3.5 py-2.5">
            <div>
              <span className="text-[13px] font-semibold text-ink">Continue in target</span>
              <p className="text-[11.5px] text-muted">Hopilo will format the prompt pack for this assistant.</p>
            </div>
            <div className="w-52 shrink-0">
              <TargetSelect value={targetId} onChange={setTargetId} />
            </div>
          </div>
        )}

        {action === "export" && (
          <div>
            <div className="mb-2 text-[12.5px] font-semibold text-muted">Choose export formats</div>
            <div role="group" aria-label="Formats" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
                      <span className="text-[10px] text-faint leading-tight block">{FORMATS[f].hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between text-[12.5px]">
            <span className="font-semibold text-muted">How much to include (Conciseness)</span>
            <span className="font-mono text-[11px] text-faint">
              {loading ? "Calculating tokens…" : `Original: ~${tokens(fullTokens)} tokens`}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {(
              [
                {
                  key: "full" as Level,
                  title: "Full",
                  hint: "All requests, replies, and tool calls word-for-word",
                  stats: data?.full,
                },
                {
                  key: "balanced" as Level,
                  title: "Balanced",
                  hint: "Recent exchange intact, earlier history summarized",
                  stats: data?.balanced,
                },
                {
                  key: "minimal" as Level,
                  title: "Minimal",
                  hint: "Goal, latest exchange, and key references only",
                  stats: data?.minimal,
                },
              ] as const
            ).map((opt) => {
              const active = level === opt.key;
              const delta = conciseDelta(opt.key);
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setLevel(opt.key)}
                  className={cx(
                    "flex flex-col justify-between rounded-xl border p-3 text-left transition-all cursor-pointer",
                    active
                      ? "border-accent bg-accent-soft/70 text-ink shadow-xs"
                      : "border-line bg-surface text-muted hover:border-line-strong hover:bg-surface-2/60",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className={cx("font-semibold text-[13px]", active ? "text-accent-strong" : "text-ink")}>
                      {opt.title}
                    </span>
                    {delta ? (
                      <span className="rounded-md bg-success-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold text-success">
                        -{delta.tokPct}% tokens
                      </span>
                    ) : (
                      <span className="font-mono text-[10px] text-faint uppercase tracking-wider">
                        complete
                      </span>
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
                    {delta && (
                      <div className="text-[11px] font-medium text-success">
                        {delta.msgPct}% fewer messages concised
                      </div>
                    )}
                  </div>

                  <p className="text-[11px] leading-snug text-faint">{opt.hint}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface-2/40 p-3.5">
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
                    <span className="text-[12.5px] font-semibold text-ink">
                      {plural(findings.length, "possible secret")} detected
                    </span>
                    <span className="ml-2 text-[11px] text-faint">
                      (API keys, tokens, or credentials)
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 cursor-pointer text-[12px] font-medium text-ink">
                    <Checkbox
                      label="Exclude secrets"
                      checked={excludeSecrets}
                      onChange={() => setExcludeSecrets(!excludeSecrets)}
                    />
                    <span>Exclude secrets</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowSecretDetails(!showSecretDetails)}
                    className="inline-flex items-center gap-0.5 text-[11px] font-medium text-accent hover:underline cursor-pointer ml-1"
                  >
                    <span>{showSecretDetails ? "Hide" : "Details"}</span>
                    <ChevronDownIcon size={12} className={cx("transition-transform", showSecretDetails && "rotate-180")} />
                  </button>
                </div>
              </div>

              <div className="text-[11px] text-muted">
                {excludeSecrets ? (
                  <span className="text-success font-medium">
                    ✓ Clean: Credentials will be masked as <code className="rounded bg-surface-3 px-1 py-0.5 text-[10.5px]">[REDACTED: Type]</code>.
                  </span>
                ) : (
                  <span className="text-warning font-medium">
                    ⚠ Warning: Unredacted credentials will be included in the clipboard/file.
                  </span>
                )}
              </div>

              {showSecretDetails && (
                <div className="mt-2 max-h-36 overflow-auto rounded-lg border border-line bg-card p-2 text-[11px]">
                  <ul className="divide-y divide-line">
                    {findings.map((f, i) => (
                      <li key={i} className="flex items-center justify-between py-1 px-1">
                        <span className="font-medium text-ink">{f.kind}</span>
                        <span className="font-mono text-faint">{f.preview}</span>
                      </li>
                    ))}
                  </ul>
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
                <span className="ml-2 text-faint text-[11px]">No API keys, passwords, or credentials found in this session.</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
