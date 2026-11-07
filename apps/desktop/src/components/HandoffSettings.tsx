import { useEffect, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { api, errorText, type CustomPattern, type RedactionRules, type RuleTest } from "../lib/api";
import { INTENTS, intentChoices, newId } from "../lib/handoff";
import { saveSetting, useDebouncedValue } from "../lib/hooks";
import { isMac } from "../lib/platform";
import { type HandoffTemplate, useApp } from "../lib/store";
import { Copy, Plus, Trash2, X } from "./Icons";
import { Select } from "./Select";
import { Button, cx, Kbd, Segmented, Skeleton, TextArea, TextInput, Toggle } from "./ui";

function Row({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{label}</div>
        {hint && <div className="text-[12px] text-faint">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const SUGGESTED_SHORTCUT = "Control+Alt+H";

const KEY_NAMES: Record<string, string> = {
  Command: "⌘",
  CommandOrControl: isMac ? "⌘" : "Ctrl",
  Control: isMac ? "⌃" : "Ctrl",
  Alt: isMac ? "⌥" : "Alt",
  Shift: isMac ? "⇧" : "Shift",
  Super: "Win",
};

export function prettyShortcut(accel: string): string[] {
  return accel.split("+").map((k) => KEY_NAMES[k] ?? k);
}

function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  const named: Record<string, string> = { Space: "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Backquote: "`", Minus: "-", Equal: "=", Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Backslash: "\\" };
  return named[code] ?? null;
}

export function acceleratorFrom(e: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "code">): string | null {
  const key = keyFromCode(e.code);
  if (!key) return null;
  const mods: string[] = [];
  if (e.metaKey) mods.push(isMac ? "Command" : "Super");
  if (e.ctrlKey) mods.push("Control");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (!mods.some((m) => m !== "Shift")) return null;
  return [...mods, key].join("+");
}

export function ShortcutSettings() {
  const s = useApp((st) => st.settings);
  const toast = useApp((st) => st.toast);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);

  const apply = async (accel: string | null) => {
    setBusy(true);
    toast({ key: "shortcut", kind: "loading", text: accel ? "Registering the shortcut…" : "Turning the shortcut off…" });
    try {
      await api.setGlobalShortcut(accel);
      useApp.getState().setSettings({ globalShortcut: accel });
      toast({ key: "shortcut", kind: "success", text: accel ? `Shortcut set: ${prettyShortcut(accel).join(isMac ? "" : "+")}` : "Shortcut turned off." });
    } catch (e) {
      toast({ key: "shortcut", kind: "error", text: `${errorText(e)}. Another app may already use it; try a different combination.` });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(false);
        return;
      }
      const accel = acceleratorFrom(e);
      if (accel) {
        setRecording(false);
        void apply(accel);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording]);

  return (
    <>
      <Row
        label="Copy latest session shortcut"
        hint="Works from any app: copies your most recent session with your default intent and level, then flashes the menu bar."
      >
        <div className="flex items-center gap-2">
          <button
            ref={btn}
            type="button"
            disabled={busy}
            onClick={() => setRecording((r) => !r)}
            onBlur={() => setRecording(false)}
            className={cx(
              "flex h-8.5 min-w-36 items-center justify-center gap-1 rounded-xl border px-3 text-[12.5px] font-medium shadow-item transition-colors",
              recording ? "border-accent bg-accent-soft text-accent" : "border-line bg-card text-ink hover:border-line-strong",
            )}
          >
            {recording ? "Press keys… (Esc cancels)" : s.globalShortcut ? prettyShortcut(s.globalShortcut).map((k) => <Kbd key={k}>{k}</Kbd>) : "Record shortcut"}
          </button>
          {s.globalShortcut ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => apply(null)}>
              Turn off
            </Button>
          ) : (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => apply(SUGGESTED_SHORTCUT)} title="Use the suggested shortcut">
              Use {prettyShortcut(SUGGESTED_SHORTCUT).join(isMac ? "" : "+")}
            </Button>
          )}
        </div>
      </Row>
      <Row label="Which session" hint="“Latest” is the session whose agent wrote to it most recently.">
        <Segmented label="Shortcut scope" value={s.shortcutScope} onChange={(v) => saveSetting("shortcutScope", v)} options={[{ value: "any", label: "Any session" }, { value: "agents", label: "Coding agents only" }]} />
      </Row>
      <Row label="Redact secrets on shortcut copies" hint="Masks keys, tokens and your custom rules, since there's no preview step.">
        <Toggle label="Redact secrets on shortcut copies" checked={s.shortcutRedact} onChange={(v) => saveSetting("shortcutRedact", v)} />
      </Row>
    </>
  );
}

export function TemplateSettings() {
  const s = useApp((st) => st.settings);
  const [drafts, setDrafts] = useState<HandoffTemplate[]>(s.handoffTemplates);
  const dirty = useRef(false);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  useEffect(() => {
    if (!dirty.current) setDrafts(s.handoffTemplates);
  }, [s.handoffTemplates]);
  useEffect(
    () => () => {
      if (dirty.current) void saveSetting("handoffTemplates", draftsRef.current);
    },
    [],
  );

  const commit = (next: HandoffTemplate[]) => {
    dirty.current = false;
    setDrafts(next);
    void saveSetting("handoffTemplates", next);
    if (!intentChoices(next).some((c) => c.key === s.defaultIntent)) void saveSetting("defaultIntent", "continue");
  };
  const edit = (id: string, patch: Partial<HandoffTemplate>) => {
    dirty.current = true;
    setDrafts((d) => d.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const choices = intentChoices(drafts);
  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-6">
        <div>
          <div className="text-[13px] font-medium">Default intent</div>
          <div className="text-[12px] text-faint">Preselected in Copy, and used by the shortcut and the tray’s “Copy latest session”.</div>
        </div>
        <div className="w-52 shrink-0">
          <Select label="Default intent" value={s.defaultIntent} onChange={(v) => saveSetting("defaultIntent", v)} options={choices.map((c) => ({ value: c.key, label: c.label, group: c.custom ? "Your templates" : "Built in" }))} />
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <div>
          <div className="text-[13px] font-medium">Your templates</div>
          <div className="text-[12px] text-faint">
            Recurring instructions that replace the built-in ask. Use <code className="rounded bg-surface-3 px-1 text-[11px]">{"{title}"}</code> and <code className="rounded bg-surface-3 px-1 text-[11px]">{"{sessions}"}</code> as placeholders.
          </div>
        </div>
        <Button size="sm" icon={<Plus size={13} />} onClick={() => commit([...drafts, { id: newId(), name: "New template", text: "" }])}>
          Add template
        </Button>
      </div>
      {drafts.length === 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[
            { name: "Write tests", text: "Read the session below, then write focused tests for the code it changed in {title}. Cover edge cases it missed. Don't change behavior." },
            { name: "Port to another stack", text: "Using the session below as the spec, re-implement the same feature in our other codebase. List what maps one-to-one and what needs a different approach first." },
            { name: "Security pass", text: "Audit the changes made in the session below for security issues: injection, secrets, auth, unsafe file or shell use. Rank findings by severity." },
          ].map((t) => (
            <button key={t.name} type="button" onClick={() => commit([...drafts, { id: newId(), ...t }])} className="h-8 rounded-full border border-dashed border-line-strong px-3 text-[12px] text-muted hover:border-accent hover:text-accent">
              + {t.name}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-3 space-y-2.5">
          {drafts.map((t) => (
            <div key={t.id} className="rounded-xl border border-line bg-surface p-3">
              <div className="flex items-center gap-2">
                <TextInput aria-label="Template name" value={t.name} onChange={(e) => edit(t.id, { name: e.target.value })} onBlur={() => commit(drafts)} className="h-8 text-[12.5px] font-medium" />
                <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => commit(drafts.filter((x) => x.id !== t.id))} aria-label={`Delete ${t.name}`}>
                  Delete
                </Button>
              </div>
              <TextArea
                aria-label="Template instructions"
                rows={3}
                value={t.text}
                onChange={(e) => edit(t.id, { text: e.target.value })}
                onBlur={() => commit(drafts)}
                placeholder="What should the next AI do with the session?"
                className="mt-2 text-[12.5px]"
              />
              {!t.text.trim() && <div className="mt-1 text-[11px] text-warning">Empty templates don’t show up in Copy.</div>}
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 text-[11.5px] text-faint">Built in: {INTENTS.map((i) => `${i.label} (${i.hint.toLowerCase()})`).join(" · ")}.</div>
    </div>
  );
}

function ChipInput({ label, values, onChange, placeholder, suggestions = [] }: { label: string; values: string[]; onChange: (v: string[]) => void; placeholder: string; suggestions?: string[] }) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const v = raw.trim();
    if (!v || values.includes(v)) return;
    onChange([...values, v]);
  };
  return (
    <div>
      <div className="flex min-h-9.5 flex-wrap items-center gap-1.5 rounded-xl border border-line bg-card px-2 py-1.5 shadow-item focus-within:border-accent">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[11.5px] text-ink">
            {v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="text-faint hover:text-danger">
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          aria-label={label}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(text);
              setText("");
            } else if (e.key === "Backspace" && !text && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => {
            add(text);
            setText("");
          }}
          placeholder={values.length ? "" : placeholder}
          className="min-w-32 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
        />
      </div>
      {suggestions.filter((x) => !values.includes(x)).length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {suggestions
            .filter((x) => !values.includes(x))
            .map((x) => (
              <button key={x} type="button" onClick={() => add(x)} className="rounded-md border border-dashed border-line-strong px-1.5 py-0.5 font-mono text-[11px] text-faint hover:border-accent hover:text-accent">
                + {x}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function PatternRow({ p, sample, onChange, onDelete }: { p: CustomPattern; sample: string; onChange: (patch: Partial<CustomPattern>) => void; onDelete: () => void }) {
  const pattern = useDebouncedValue(p.pattern, 250);
  const text = useDebouncedValue(sample, 250);
  const [test, setTest] = useState<RuleTest | null>(null);
  useEffect(() => {
    let live = true;
    if (!pattern.trim()) {
      setTest(null);
      return;
    }
    api
      .testRedactionRule(pattern, false, text)
      .then((r) => live && setTest(r))
      .catch(() => live && setTest(null));
    return () => {
      live = false;
    };
  }, [pattern, text]);
  return (
    <div className={cx("rounded-xl border bg-surface p-2.5", test?.error ? "border-danger/40" : "border-line")}>
      <div className="flex items-center gap-2">
        <Toggle label={`Enable ${p.name || "pattern"}`} checked={p.enabled} onChange={(v) => onChange({ enabled: v })} />
        <div className="w-44 shrink-0">
          <TextInput aria-label="Rule name" value={p.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Name, e.g. Internal token" className="h-8 text-[12.5px]" />
        </div>
        <div className="min-w-0 flex-1">
          <TextInput aria-label="Regular expression" value={p.pattern} onChange={(e) => onChange({ pattern: e.target.value })} placeholder="Regular expression, e.g. acme_[a-z0-9]{24}" className="h-8 font-mono text-[12px]" spellCheck={false} />
        </div>
        <button type="button" aria-label={`Delete ${p.name || "pattern"}`} onClick={onDelete} className="flex h-8 w-8 items-center justify-center rounded-lg text-faint hover:bg-surface-2 hover:text-danger">
          <Trash2 size={14} />
        </button>
      </div>
      {test && (
        <div className={cx("mt-1.5 pl-12 text-[11px]", test.error ? "text-danger" : test.matches.length ? "text-success" : "text-faint")}>
          {test.error
            ? test.error
            : test.matches.length
            ? `Matches ${test.matches.length} in the sample: ${test.matches.slice(0, 3).map((m) => (m.length > 24 ? `${m.slice(0, 24)}…` : m)).join(", ")}`
            : sample.trim()
            ? "No match in the sample"
            : "Valid. Paste sample text below to try it."}
        </div>
      )}
    </div>
  );
}

const PATTERN_PRESETS: Omit<CustomPattern, "id" | "enabled">[] = [
  { name: "Internal URL", pattern: String.raw`https?://[a-z0-9.-]+\.(?:internal|corp|local|lan)\b[^\s'"]*` },
  { name: "Staging host", pattern: String.raw`\b[a-z0-9-]+\.staging\.[a-z0-9.-]+\b` },
  { name: "Stripe key", pattern: String.raw`\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}` },
  { name: "IPv4 address", pattern: String.raw`\b(?:\d{1,3}\.){3}\d{1,3}\b` },
];

export function RedactionSettings() {
  const saved = useApp((st) => st.settings.redaction);
  const toast = useApp((st) => st.toast);
  const [rules, setRules] = useState<RedactionRules>(saved);
  const [sample, setSample] = useState("");
  const [builtins, setBuiltins] = useState<string[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const local = useRef(false);
  const latest = useRef(saved);

  useEffect(() => {
    if (!local.current) {
      latest.current = saved;
      setRules(saved);
    }
  }, [saved]);
  useEffect(() => {
    api.builtinRedactionKinds().then((k) => setBuiltins(Array.isArray(k) ? k : [])).catch(() => setBuiltins([]));
  }, []);
  useEffect(
    () => () => {
      if (local.current) {
        window.clearTimeout(timer.current);
        void saveSetting("redaction", latest.current);
      }
    },
    [],
  );

  const change = (fn: (r: RedactionRules) => RedactionRules) => {
    local.current = true;
    const next = fn(latest.current);
    latest.current = next;
    setRules(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      local.current = false;
      void saveSetting("redaction", latest.current);
    }, 400);
  };
  const update = (next: Partial<RedactionRules>) => change((r) => ({ ...r, ...next }));
  const patch = (id: string, p: Partial<CustomPattern>) => change((r) => ({ ...r, patterns: r.patterns.map((x) => (x.id === id ? { ...x, ...p } : x)) }));

  return (
    <div className="space-y-5 py-4">
      <section>
        <div className="text-[13px] font-medium">Built-in detectors</div>
        <div className="mb-2 text-[12px] text-faint">Turn off a detector that keeps flagging things you don’t consider secret.</div>
        <div className="flex flex-wrap gap-1.5">
          {builtins.length === 0 && [72, 96, 120, 88, 104].map((w) => <Skeleton key={w} className="h-7.5 rounded-full" style={{ width: w }} />)}
          {builtins.map((k) => {
            const on = !rules.disabledBuiltins.includes(k);
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => change((r) => ({ ...r, disabledBuiltins: on ? [...r.disabledBuiltins, k] : r.disabledBuiltins.filter((x) => x !== k) }))}
                className={cx("h-7.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors", on ? "border-success/40 bg-success-soft text-success" : "border-line bg-card text-faint line-through")}
              >
                {k}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-medium">Custom patterns</div>
            <div className="text-[12px] text-faint">Regular expressions for internal tokens, connection strings or hosts. Checked live as you type.</div>
          </div>
          <Button size="sm" icon={<Plus size={13} />} onClick={() => change((r) => ({ ...r, patterns: [...r.patterns, { id: newId("p"), name: "", pattern: "", enabled: true }] }))}>
            Add pattern
          </Button>
        </div>
        <div className="mt-2 space-y-2">
          {rules.patterns.map((p) => (
            <PatternRow key={p.id} p={p} sample={sample} onChange={(x) => patch(p.id, x)} onDelete={() => change((r) => ({ ...r, patterns: r.patterns.filter((x) => x.id !== p.id) }))} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {PATTERN_PRESETS.filter((pp) => !rules.patterns.some((p) => p.pattern === pp.pattern)).map((pp) => (
            <button
              key={pp.name}
              type="button"
              onClick={() => change((r) => ({ ...r, patterns: [...r.patterns, { id: newId("p"), enabled: true, ...pp }] }))}
              className="rounded-md border border-dashed border-line-strong px-1.5 py-0.5 text-[11px] text-faint hover:border-accent hover:text-accent"
            >
              + {pp.name}
            </button>
          ))}
        </div>
        {rules.patterns.length > 0 && (
          <TextArea rows={2} value={sample} onChange={(e) => setSample(e.target.value)} placeholder="Paste sample text to test your patterns (never saved)" className="mt-2 font-mono text-[12px]" spellCheck={false} />
        )}
      </section>

      <section>
        <div className="text-[13px] font-medium">Blocked keywords</div>
        <div className="mb-2 text-[12px] text-faint">Project codenames, client names or anything else to mask. Case-insensitive, whole words. Press Enter to add.</div>
        <ChipInput label="Blocked keywords" values={rules.keywords} onChange={(keywords) => update({ keywords })} placeholder="e.g. Project Falcon" />
      </section>

      <section>
        <div className="text-[13px] font-medium">Never include these files</div>
        <div className="mb-2 text-[12px] text-faint">
          Attachments matching these patterns are left out of every copy and export. <code className="rounded bg-surface-3 px-1 text-[11px]">*</code> matches within a folder, <code className="rounded bg-surface-3 px-1 text-[11px]">**</code> across folders.
        </div>
        <ChipInput
          label="Excluded file patterns"
          values={rules.excludePaths}
          onChange={(excludePaths) => update({ excludePaths })}
          placeholder="e.g. *.pem"
          suggestions={["*.pem", "*.key", "*.p12", ".env*", "*.env", "id_rsa*", "**/secrets/**"]}
        />
      </section>

      <div className="flex items-center justify-between border-t border-line pt-3 text-[11.5px] text-faint">
        <span>Rules apply to Copy, Export, the shortcut and the tray. Everything is checked on this device.</span>
        <Button
          size="sm"
          variant="ghost"
          icon={<Copy size={12} />}
          onClick={() => {
            writeText(JSON.stringify(rules, null, 2))
              .then(() => toast({ kind: "success", text: "Rules copied as JSON, ready to share with your team." }))
              .catch((e) => toast({ kind: "error", text: errorText(e) }));
          }}
        >
          Copy rules
        </Button>
      </div>
    </div>
  );
}
