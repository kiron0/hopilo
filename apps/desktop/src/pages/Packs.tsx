import { useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  RefreshCw,
  PanelBottom,
  Scissors,
  Tag,
  GitBranch,
  Archive,
  ArrowLeft,
  Boxes,
  Copy,
  CopyPlus,
  FileDown,
  FileUp,
  History,
  Info,
  Pencil,
  Pin,
  Send,
  ShieldAlert,
  Star,
  Trash2,
} from "lucide-react";
import { api, errorText, type Level, type PackRow, type ToolDetail } from "../lib/api";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { copyHandoff, copyMarkdown, exportPack, importPackFile } from "../lib/actions";
import { plural, provider, relativeTime, sizeVerdict, tokens } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { useApp } from "../lib/store";
import { packDraftItem } from "./Builder";
import { Transcript } from "../components/Transcript";
import { PackDetailSkeleton, PackGridSkeleton } from "../components/Skeletons";
import { Badge, Button, Card, cx, SearchField, EmptyState, ErrorNote, IconButton, Modal, PageHeader, ProviderDot, SectionLabel, Segmented, Spinner, TextInput, Toggle , TargetSelect } from "../components/ui";
import { FillPage, PageHeaderSlot, PageToolbar } from "../components/PageSlots";

/** Very large previews are shortened on screen only; copy and export always
 *  use the full text. */
const PREVIEW_LIMIT = 200_000;
export function clip(text: string) {
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}\n\n[… preview shortened — copy or export includes all ${text.length.toLocaleString()} characters]` : text;
}

export function PreviewWarnings({ preview }: { preview: import("../lib/api").Preview }) {
  const { missing, omitted, findings, attachManually, unavailable } = preview;
  if (!missing.length && !omitted.length && !findings.length && !attachManually.length && !unavailable.length)
    return <div className="text-[12.5px] text-success">Nothing missing. No sensitive patterns found.</div>;
  return (
    <div className="space-y-3 text-[12.5px]">
      {findings.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-1.5 font-medium text-danger">
            <ShieldAlert size={13} /> Possible sensitive data ({findings.length})
          </div>
          <ul className="space-y-0.5 text-muted">
            {findings.slice(0, 8).map((f, i) => (
              <li key={i}>
                {f.kind}: <code className="font-mono text-[11.5px]">{f.preview}</code>
              </li>
            ))}
            {findings.length > 8 && <li>…and {findings.length - 8} more</li>}
          </ul>
          <div className="mt-1 text-faint">Review before sharing. Hopilo does not redact automatically.</div>
        </div>
      )}
      {missing.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-1.5 font-medium text-warning">
            <AlertTriangle size={13} /> Missing from the capture
          </div>
          <ul className="space-y-0.5 text-muted">
            {missing.map((m, i) => (
              <li key={i}>{m.item}</li>
            ))}
          </ul>
        </div>
      )}
      {(attachManually.length > 0 || unavailable.length > 0) && (
        <div>
          <div className="mb-1 font-medium text-warning">Files to attach yourself</div>
          <ul className="space-y-0.5 text-muted">
            {attachManually.map((n) => (
              <li key={n}>{n}{unavailable.includes(n) ? " — original no longer in library" : ""}</li>
            ))}
          </ul>
        </div>
      )}
      {omitted.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-1.5 font-medium text-muted">
            <Info size={13} /> Deliberately not included
          </div>
          <ul className="space-y-0.5 text-faint">
            {omitted.map((m, i) => (
              <li key={i}>{m.item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PackDetail({ id, initialVersion }: { id: string; initialVersion?: number }) {
  const navigate = useApp((s) => s.navigate);
  const setDraft = useApp((s) => s.setDraft);
  const settings = useApp((s) => s.settings);
  const toast = useApp((s) => s.toast);
  const [version, setVersion] = useState<number | undefined>(initialVersion);
  const [view, setView] = useState<"prompt" | "markdown">("prompt");
  const [toolDetail, setToolDetail] = useState<ToolDetail>(settings.toolDetail);
  const [level, setLevel] = useState<Level>(settings.level);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [comparing, setComparing] = useState<{ from: number; to: number } | null>(null);
  const [targetId, setTargetId] = useState(settings.defaultTarget);
  const [renaming, setRenaming] = useState<string | null>(null);

  const detail = useLoad(() => api.getPack(id, version ?? null), [id, version]);
  const preview = useLoad(() => api.previewPack(id, version ?? null, view, toolDetail, level), [id, version, view, toolDetail, level]);
  const rows = useLoad(() => api.listPacks());
  const row = rows.data?.find((r) => r.id === id);

  useEffect(() => setVersion(initialVersion), [id, initialVersion]);

  if (detail.error) return <ErrorNote text={detail.error} />;
  if (!detail.data) return <PackDetailSkeleton />;
  const { pack, versions } = detail.data;
  const latest = versions[0]?.version ?? pack.version;
  const isLatest = pack.version === latest;

  return (
    <FillPage>
      <PageHeaderSlot>
      <button type="button" onClick={() => navigate({ page: "packs" })} className="mb-3 flex items-center gap-1 text-[12.5px] text-muted hover:text-ink">
        <ArrowLeft size={14} /> All packs
      </button>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {renaming !== null ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await api.updatePack(id, { title: renaming });
                setRenaming(null);
              }}
            >
              <TextInput autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} onBlur={() => setRenaming(null)} className="h-9 w-[420px] text-[18px] font-semibold" aria-label="Pack title" />
            </form>
          ) : (
            <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight">
              <span className="truncate" data-selectable>{pack.title}</span>
              <IconButton label="Rename" onClick={() => setRenaming(pack.title)}>
                <Pencil size={14} />
              </IconButton>
            </h1>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
            <Badge tone="accent">v{pack.version}</Badge>
            <Badge>{pack.mode === "selected" ? "Selected" : "Full"}</Badge>
            {pack.sources.map((s) => (
              <span key={s.sourceId} className="inline-flex items-center gap-1">
                <ProviderDot id={s.provider} size={7} /> {provider(s.provider).label}
              </span>
            ))}
            <span>· {plural(pack.messages.length, "message")}</span>
            {pack.attachments.length > 0 && <span>· {plural(pack.attachments.length, "file")}</span>}
            <span>· created {relativeTime(pack.createdAt)}</span>
          </div>
          <TagEditor id={id} tags={row?.tags ?? []} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label={row?.favorite ? "Unfavorite" : "Favorite"} onClick={() => api.updatePack(id, { favorite: !row?.favorite })}>
            <Star size={15} className={row?.favorite ? "fill-current text-warning" : ""} />
          </IconButton>
          <IconButton label={row?.pinned ? "Unpin" : "Pin"} onClick={() => api.updatePack(id, { pinned: !row?.pinned })}>
            <Pin size={15} className={row?.pinned ? "fill-current text-accent" : ""} />
          </IconButton>
          <IconButton label={row?.archived ? "Restore from archive" : "Archive"} onClick={() => api.updatePack(id, { archived: !row?.archived })}>
            <Archive size={15} className={row?.archived ? "text-accent" : ""} />
          </IconButton>
          {pack.sources.some((x) => x.kind === "local-agent") && (
            <IconButton
              label="Pull new messages from the original sessions"
              onClick={async () => {
                try {
                  const r = await api.pullNewMessages(id);
                  if (r.added && r.pack) {
                    setVersion(undefined);
                    toast({ kind: "success", text: `Added ${plural(r.added, "new message")} as v${r.pack.version}.` });
                  } else {
                    toast({ kind: "info", text: "No new messages since this version." });
                  }
                  if (r.skipped.length) toast({ kind: "warning", text: `Couldn't check: ${r.skipped.join(", ")}` });
                } catch (e) {
                  toast({ kind: "error", text: errorText(e) });
                }
              }}
            >
              <RefreshCw size={15} />
            </IconButton>
          )}
          <IconButton label="Put on the Drop Shelf" onClick={() => api.openDropShelf(id).catch((e) => toast({ kind: "error", text: errorText(e) }))}>
            <PanelBottom size={15} />
          </IconButton>
          <IconButton label="Split selected messages into a new pack" onClick={() => setSplitting(true)}>
            <Scissors size={15} />
          </IconButton>
          <IconButton
            label="Duplicate"
            onClick={async () => {
              const p = await api.duplicatePack(id);
              navigate({ page: "packs", packId: p.packId });
            }}
          >
            <CopyPlus size={15} />
          </IconButton>
          <IconButton
            label="Delete pack"
            onClick={async () => {
              if (!(await ask(`Delete “${pack.title}” and all ${versions.length} version(s)? Captured sessions stay in your library.`, { title: "Delete pack", kind: "warning" }))) return;
              await api.deletePack(id);
              navigate({ page: "packs" });
            }}
          >
            <Trash2 size={15} />
          </IconButton>
        </div>
      </div>
      </PageHeaderSlot>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] gap-5">
        <section aria-label="Preview" className="flex min-h-0 min-w-0 flex-col">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <Segmented
              label="How much to include"
              value={level}
              onChange={setLevel}
              options={[
                { value: "full", label: "Full" },
                { value: "balanced", label: "Balanced" },
                { value: "minimal", label: "Minimal" },
              ]}
            />
            <Segmented
              label="Preview"
              value={view}
              onChange={setView}
              options={[
                { value: "prompt", label: "Handoff prompt" },
                { value: "markdown", label: "Markdown" },
              ]}
            />
            <div className="flex items-center gap-2 text-[12px] text-muted">
              Tool activity
              <Segmented
                label="Tool activity"
                value={toolDetail}
                onChange={setToolDetail}
                options={[
                  { value: "truncated", label: "Trimmed" },
                  { value: "full", label: "Full" },
                  { value: "omit", label: "Leave out" },
                ]}
              />
            </div>
          </div>
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center justify-between border-b border-line bg-surface-2 px-4 py-2 text-[12px] text-muted">
              <span className="flex items-center gap-2">
                {preview.data ? `${tokens(preview.data.tokenEstimate)} tokens (estimate) · ${plural(preview.data.messageCount, "message")}` : "Rendering…"}
                {preview.data && <Badge tone={sizeVerdict(preview.data.tokenEstimate).tone}>{sizeVerdict(preview.data.tokenEstimate).text}</Badge>}
              </span>
              {!isLatest && <Badge tone="warning">Viewing an older version</Badge>}
            </div>
            <pre data-selectable className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
              {preview.error ? preview.error : clip(preview.data?.text ?? "")}
            </pre>
          </Card>
        </section>

        <aside className="-mr-2 min-h-0 space-y-5 overflow-auto pr-2 pb-1">
          <section aria-label="Hand off">
            <SectionLabel>Hand off</SectionLabel>
            <Card className="space-y-3 p-4">
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-muted">Continue in</span>
                <TargetSelect value={targetId} onChange={setTargetId} />
              </label>
              <Button variant="primary" className="w-full" icon={<Copy size={14} />} onClick={() => copyHandoff(id, pack.version, targetId, toolDetail, level)}>
                Copy handoff prompt
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" onClick={() => copyMarkdown(id, pack.version, toolDetail, level)}>Copy Markdown</Button>
                <Button size="sm" icon={<Send size={13} />} onClick={() => navigate({ page: "handoff", packId: id })}>Review…</Button>
              </div>
              <div className="text-[11.5px] text-faint">Copied text is never sent for you. Paste it, review it, then send.</div>
            </Card>
          </section>

          <section aria-label="Export">
            <SectionLabel>Export</SectionLabel>
            <Card className="grid grid-cols-2 gap-2 p-3">
              <Button size="sm" icon={<FileDown size={13} />} onClick={() => exportPack(id, pack.version, "md", toolDetail, level)}>.md</Button>
              <Button size="sm" icon={<FileDown size={13} />} onClick={() => exportPack(id, pack.version, "json", toolDetail, level)}>.json</Button>
              <Button size="sm" icon={<FileDown size={13} />} onClick={() => exportPack(id, pack.version, "txt", toolDetail, level)}>Prompt .txt</Button>
              <Button size="sm" icon={<FileDown size={13} />} onClick={() => exportPack(id, pack.version, "handoff", toolDetail, level)}>.handoff</Button>
            </Card>
          </section>

          <section aria-label="Review">
            <SectionLabel>Before you share</SectionLabel>
            <Card className="p-4">{preview.data ? <PreviewWarnings preview={preview.data} /> : <div className="text-muted">Checking…</div>}</Card>
          </section>

          {settings.ollamaModel && (
            <section aria-label="Local AI summary">
              <SectionLabel>Local AI summary</SectionLabel>
              <Card className="space-y-2 p-4">
                <p className="text-[12.5px] text-muted">Ask {settings.ollamaModel} (Ollama, on this computer) for a short brief. Check it against the transcript before using it.</p>
                <Button
                  size="sm"
                  busy={summarizing}
                  onClick={async () => {
                    setSummarizing(true);
                    try {
                      setSummary(await api.ollamaSummarize(id, pack.version, settings.ollamaModel));
                    } catch (e) {
                      toast({ kind: "error", text: errorText(e) });
                    } finally {
                      setSummarizing(false);
                    }
                  }}
                >
                  Write a summary
                </Button>
              </Card>
            </section>
          )}

          <section aria-label="Versions">
            <SectionLabel
              right={
                <button
                  type="button"
                  className="text-[12px] text-accent hover:underline"
                  onClick={() => {
                    setDraft({ packId: id, title: pack.title, note: "", items: [{ ...packDraftItem(row ?? ({ id, title: pack.title, latestVersion: latest, messageCount: pack.messages.length, providers: pack.sources.map((s) => s.provider) } as PackRow)), label: `${pack.title} (current content)` }] });
                    navigate({ page: "builder" });
                  }}
                >
                  Add to this pack…
                </button>
              }
            >
              Versions
            </SectionLabel>
            <Card className="divide-y divide-line">
              {versions.map((v) => (
                <div key={v.version} className={cx("flex items-center gap-2 px-3.5 py-2.5", v.version === pack.version && "bg-accent-soft/60")}>
                  <History size={13} className="text-faint" />
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setVersion(v.version)}>
                    <div className="text-[13px] font-medium">
                      v{v.version} <span className="font-normal text-faint">· {v.label ?? (v.version === 1 ? "Created" : "Saved")}</span>
                    </div>
                    <div className="text-[11.5px] text-faint">
                      {relativeTime(v.createdAt)} · {v.messageCount} msgs · {tokens(v.tokenEstimate)}
                    </div>
                  </button>
                  {v.version !== pack.version && (
                    <Button size="sm" variant="ghost" onClick={() => setComparing({ from: Math.min(v.version, pack.version), to: Math.max(v.version, pack.version) })}>
                      Compare
                    </Button>
                  )}
                  {v.version !== latest && v.version === pack.version && (
                    <Button
                      size="sm"
                      onClick={async () => {
                        try {
                          const p = await api.restoreVersion(id, v.version);
                          setVersion(undefined);
                          toast({ kind: "success", text: `Restored v${v.version} as v${p.version}. Nothing was overwritten.` });
                        } catch (e) {
                          toast({ kind: "error", text: errorText(e) });
                        }
                      }}
                    >
                      Restore
                    </Button>
                  )}
                </div>
              ))}
            </Card>
          </section>
          <RelatedPacks id={id} />
        </aside>
      </div>
      {splitting && <SplitModal packId={id} version={pack.version} messages={pack.messages} title={pack.title} onClose={() => setSplitting(false)} />}
      {comparing && <DiffModal packId={id} from={comparing.from} to={comparing.to} onClose={() => setComparing(null)} />}
      {summary !== null && (
        <Modal
          title="AI-written summary — check before using"
          onClose={() => setSummary(null)}
          wide
          footer={
            <>
              <Button variant="ghost" onClick={() => setSummary(null)}>Discard</Button>
              <Button onClick={() => writeText(summary).then(() => toast({ kind: "success", text: "Summary copied." }))}>Copy</Button>
              <Button
                variant="primary"
                onClick={async () => {
                  const p = await api.buildPack({ packId: id, title: pack.title, note: summary, items: [{ kind: "pack", id, version: pack.version }], label: "Added local AI summary" });
                  setSummary(null);
                  setVersion(undefined);
                  toast({ kind: "success", text: `Saved as v${p.version} with the summary as a note. The transcript is unchanged.` });
                }}
              >
                Save as note in a new version
              </Button>
            </>
          }
        >
          <div className="mb-3 flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-[12.5px] text-warning">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> Written by a local model. It can leave things out or get details wrong — compare it with the transcript.
          </div>
          <pre data-selectable className="max-h-[50vh] overflow-auto font-sans text-[13px] whitespace-pre-wrap">{summary}</pre>
        </Modal>
      )}
    </FillPage>
  );
}

export function Packs() {
  const route = useApp((s) => s.route);
  const navigate = useApp((s) => s.navigate);
  const packId = route.page === "packs" ? route.packId : undefined;
  const version = route.page === "packs" ? route.version : undefined;
  const { data, error, loading } = useLoad(() => api.listPacks());
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [tag, setTag] = useState("");

  if (packId) return <PackDetail id={packId} initialVersion={version} />;

  const rows = (data ?? []).filter((p) => (showArchived ? p.archived : !p.archived) && (!tag || p.tags.includes(tag)) && (!q.trim() || p.title.toLowerCase().includes(q.trim().toLowerCase())));
  const allTags = [...new Set((data ?? []).flatMap((p) => p.tags))].sort();

  return (
    <div>
      <PageHeader
        title="Packs"
        subtitle="A pack is a ready-to-share bundle of conversations, files and notes. Every save keeps the earlier versions."
        actions={
          <>
            <Button icon={<FileUp size={14} />} onClick={async () => { const p = await importPackFile(); if (p) navigate({ page: "packs", packId: p.packId }); }}>
              Import .handoff
            </Button>
            <Button variant="primary" onClick={() => navigate({ page: "builder" })}>New pack</Button>
          </>
        }
      />
      <PageToolbar className="gap-3">
        <SearchField label="Filter packs" value={q} onChange={setQ} className="w-72" />
        <label className="flex items-center gap-2 text-[12.5px] text-muted">
          <Toggle checked={showArchived} onChange={setShowArchived} label="Show archived" /> Archived
        </label>
        {allTags.map((t) => (
          <button key={t} type="button" aria-pressed={tag === t} onClick={() => setTag(tag === t ? "" : t)} className={cx("h-7 rounded-full border px-3 text-[12px]", tag === t ? "border-accent bg-accent-soft font-semibold" : "border-line text-muted hover:text-ink")}>
            #{t}
          </button>
        ))}
      </PageToolbar>
      {error && <ErrorNote text={error} />}
      {loading && !data && <PackGridSkeleton count={6} />}
      {data && rows.length === 0 && (
        <Card>
          <EmptyState
            icon={<Boxes size={20} />}
            title={showArchived ? "No archived packs" : "No packs yet"}
            body="Build one from captured sessions, or use Copy handoff on a coding-agent session to make one in a single step."
            action={<Button variant="primary" onClick={() => navigate({ page: "builder" })}>Open Builder</Button>}
          />
        </Card>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((p) => (
          <Card
            key={p.id}
            className="transition-shadow hover:shadow-pop"
            draggable
            onDragStart={(e) => {
              // Dropping this on a ChatGPT/Claude/Gemini tab with the Hopilo
              // extension inserts the pack as a draft.
              e.dataTransfer.setData("text/plain", `hopilo://pack/${p.id}@${p.latestVersion}`);
              e.dataTransfer.effectAllowed = "copy";
            }}
          >
            <button type="button" className="block w-full p-4 text-left" onClick={() => navigate({ page: "packs", packId: p.id })}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 truncate font-semibold">{p.title}</div>
                {p.pinned && <Pin size={13} className="mt-0.5 fill-current text-accent" aria-label="Pinned" />}
                {p.favorite && <Star size={13} className="mt-0.5 fill-current text-warning" aria-label="Favorite" />}
              </div>
              <div className="mt-2 flex items-center gap-2">
                {p.providers.map((pr) => (
                  <span key={pr} className="inline-flex items-center gap-1 text-[12px] text-muted">
                    <ProviderDot id={pr} size={7} /> {provider(pr).label}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between text-[12px] text-faint">
                <span>
                  v{p.latestVersion} · {p.messageCount} msgs · {tokens(p.tokenEstimate)}
                  {p.attachmentCount > 0 && ` · ${p.attachmentCount} files`}
                </span>
                <span>{relativeTime(p.updatedAt)}</span>
              </div>
            </button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function TagEditor({ id, tags }: { id: string; tags: string[] }) {
  const [value, setValue] = useState("");
  const save = (next: string[]) => api.setPackTags(id, next);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <Tag size={13} className="text-faint" aria-hidden />
      {tags.map((t) => (
        <span key={t} className="inline-flex h-6 items-center gap-1 rounded-full border border-line bg-surface pr-1 pl-2.5 text-[12px]">
          #{t}
          <button type="button" aria-label={`Remove tag ${t}`} className="flex h-4 w-4 items-center justify-center rounded-full text-faint hover:bg-surface-3 hover:text-ink" onClick={() => save(tags.filter((x) => x !== t))}>
            ×
          </button>
        </span>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) save([...tags, value.trim()]);
          setValue("");
        }}
      >
        <label className="flex h-6 items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 text-[12px] text-faint focus-within:border-accent">
          <span aria-hidden>#</span>
          <input
            aria-label="Add a tag, then press Return"
            title="Add a tag, then press Return"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-20 bg-transparent text-ink focus:outline-none"
          />
        </label>
      </form>
    </div>
  );
}

const RELATION_TEXT = {
  merged: ["Merged from", "Merged into"],
  split: ["Split from", "Split into"],
  duplicated: ["Copied from", "Copied to"],
} as const;

function RelatedPacks({ id }: { id: string }) {
  const navigate = useApp((s) => s.navigate);
  const { data } = useLoad(() => api.packRelations(id), [id]);
  if (!data?.length) return null;
  return (
    <section aria-label="Related packs">
      <SectionLabel>Related</SectionLabel>
      <Card className="divide-y divide-line">
        {data.map((r, i) => {
          const incoming = r.toPack === id;
          const other = incoming ? { id: r.fromPack, title: r.fromTitle, v: r.fromVersion } : { id: r.toPack, title: r.toTitle, v: r.toVersion };
          const label = RELATION_TEXT[r.kind]?.[incoming ? 0 : 1] ?? r.kind;
          return (
            <button key={i} type="button" disabled={!other.title} onClick={() => navigate({ page: "packs", packId: other.id })} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left hover:bg-surface-2 disabled:opacity-60">
              <GitBranch size={13} className="shrink-0 text-faint" />
              <span className="min-w-0 flex-1">
                <span className="block text-[11.5px] text-faint">{label}</span>
                <span className="block truncate text-[13px] font-medium">{other.title ?? "A deleted pack"}{other.v ? ` · v${other.v}` : ""}</span>
              </span>
            </button>
          );
        })}
      </Card>
    </section>
  );
}

function SplitModal({ packId, version, messages, title, onClose }: { packId: string; version: number; messages: import("../lib/api").Message[]; title: string; onClose: () => void }) {
  const navigate = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [name, setName] = useState(`${title} (part)`);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Split into a new pack"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="mr-auto self-center text-[12.5px] text-muted">{picked.size} of {messages.length} messages chosen</span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={picked.size === 0}
            icon={<Scissors size={14} />}
            onClick={async () => {
              setBusy(true);
              try {
                const p = await api.splitPack(packId, version, messages.filter((m) => picked.has(m.id)).map((m) => m.id), name);
                toast({ kind: "success", text: `Created “${p.title}”. The original pack is unchanged.` });
                onClose();
                navigate({ page: "packs", packId: p.packId });
              } catch (e) {
                toast({ kind: "error", text: errorText(e) });
              } finally {
                setBusy(false);
              }
            }}
          >
            Create pack
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-muted">New pack title</span>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(messages.map((m) => m.id)))}>Select all</Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Select none</Button>
        </div>
        <div className="max-h-[52vh] overflow-auto pr-1">
          <Transcript
            messages={messages}
            selected={picked}
            onToggle={(mid) => {
              const n = new Set(picked);
              if (n.has(mid)) n.delete(mid);
              else n.add(mid);
              setPicked(n);
            }}
          />
        </div>
      </div>
    </Modal>
  );
}

function DiffModal({ packId, from, to, onClose }: { packId: string; from: number; to: number; onClose: () => void }) {
  const { data, error } = useLoad(() => api.diffVersions(packId, from, to), [packId, from, to]);
  const Group = ({ label, tone, items }: { label: string; tone: "success" | "danger" | "warning"; items: { key: string; text: string }[] }) =>
    items.length ? (
      <div>
        <div className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold">
          <Badge tone={tone}>{items.length}</Badge> {label}
        </div>
        <ul className="space-y-1">
          {items.map((it) => (
            <li key={it.key} className="truncate rounded-lg bg-surface-2 px-3 py-1.5 text-[12.5px]" data-selectable>
              {it.text}
            </li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <Modal title={`What changed from v${from} to v${to}`} onClose={onClose} wide footer={<Button onClick={onClose}>Done</Button>}>
      {error && <ErrorNote text={error} />}
      {!data && !error && <Spinner />}
      {data && (
        <div className="space-y-4">
          <p className="text-muted">{data.unchanged} message(s) unchanged.</p>
          <Group label="Messages added" tone="success" items={data.added.map((m) => ({ key: `a${m.id}`, text: `${m.role}: ${m.preview}` }))} />
          <Group label="Messages changed" tone="warning" items={data.changed.map((m) => ({ key: `c${m.id}`, text: `${m.role}: ${m.preview}` }))} />
          <Group label="Messages removed" tone="danger" items={data.removed.map((m) => ({ key: `r${m.id}`, text: `${m.role}: ${m.preview}` }))} />
          <Group label="Sources added" tone="success" items={data.sourcesAdded.map((t, i) => ({ key: `sa${i}`, text: t }))} />
          <Group label="Sources removed" tone="danger" items={data.sourcesRemoved.map((t, i) => ({ key: `sr${i}`, text: t }))} />
          <Group label="Files added" tone="success" items={data.filesAdded.map((t, i) => ({ key: `fa${i}`, text: t }))} />
          <Group label="Files removed" tone="danger" items={data.filesRemoved.map((t, i) => ({ key: `fr${i}`, text: t }))} />
          {(data.noteBefore !== null || data.noteAfter !== null) && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-[12px] font-semibold text-muted">Note before</div>
                <pre data-selectable className="rounded-xl bg-danger-soft/60 p-3 font-sans text-[12.5px] whitespace-pre-wrap">{data.noteBefore ?? "(none)"}</pre>
              </div>
              <div>
                <div className="mb-1 text-[12px] font-semibold text-muted">Note after</div>
                <pre data-selectable className="rounded-xl bg-success-soft/60 p-3 font-sans text-[12.5px] whitespace-pre-wrap">{data.noteAfter ?? "(none)"}</pre>
              </div>
            </div>
          )}
          {data.titleBefore !== null && <p className="text-[12.5px] text-muted">Title changed from “{data.titleBefore}” to “{data.titleAfter}”.</p>}
          {!data.added.length && !data.changed.length && !data.removed.length && !data.sourcesAdded.length && !data.sourcesRemoved.length && !data.filesAdded.length && !data.filesRemoved.length && data.noteBefore === null && data.noteAfter === null && (
            <p className="text-success">These versions have the same content.</p>
          )}
        </div>
      )}
    </Modal>
  );
}
