import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CheckCheck, Copy, ExternalLink, FileDown, Send } from "../components/Icons";
import { api, type Level, type ToolDetail } from "../lib/api";
import { copyHandoff, exportPack } from "../lib/actions";
import { plural, relativeTime, sizeVerdict, tokens } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { useApp } from "../lib/store";
import { target } from "../lib/targets";
import { clip, PreviewWarnings } from "./Packs";
import { Badge, Button, Card, cx, EmptyState, PageHeader, SectionLabel, Segmented , ProviderChip, TargetSelect } from "../components/ui";
import { FillPage } from "../components/PageSlots";
import { Select } from "../components/Select";

const STATUS_TONE: Record<string, "accent" | "success" | "neutral"> = { copied: "accent", exported: "accent", sent: "success" };

export function Handoff() {
  const route = useApp((s) => s.route);
  const navigate = useApp((s) => s.navigate);
  const settings = useApp((s) => s.settings);
  const packs = useLoad(() => api.listPacks());
  const history = useLoad(() => api.listHandoffs(30));
  const [packId, setPackId] = useState<string | undefined>(route.page === "handoff" ? route.packId : undefined);
  const [targetId, setTargetId] = useState(settings.defaultTarget);
  const [toolDetail, setToolDetail] = useState<ToolDetail>(settings.toolDetail);
  const [level, setLevel] = useState<Level>(settings.level);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!packId && packs.data?.length) setPackId(packs.data.find((p) => !p.archived)?.id);
  }, [packs.data, packId]);
  useEffect(() => setCopied(false), [packId, targetId]);

  const pack = packs.data?.find((p) => p.id === packId);
  const preview = useLoad(() => (packId ? api.previewPack(packId, null, "prompt", toolDetail, level) : Promise.resolve(null)), [packId, toolDetail, level]);
  const t = target(targetId);

  if (packs.data && packs.data.length === 0)
    return (
      <div>
        <PageHeader title="Handoff" />
        <Card>
          <EmptyState icon={<Send size={20} />} title="Nothing to hand off yet" body="Build a pack first, or use Copy handoff on a coding-agent session." action={<Button variant="primary" onClick={() => navigate({ page: "sessions", tab: "agents" })}>Find a session</Button>} />
        </Card>
      </div>
    );

  return (
    <div>
      <PageHeader title="Handoff" subtitle="Review exactly what will be shared, then copy or export it. Hopilo never sends messages for you." />
      <FillPage>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] gap-5">
        <section className="flex min-h-0 min-w-0 flex-col gap-4">
          <Card className="grid shrink-0 grid-cols-2 gap-4 p-4">
            <div>
              <span className="mb-1 block text-[12px] font-medium text-muted">Context Pack</span>
              <Select
                label="Context Pack"
                value={packId ?? ""}
                onChange={setPackId}
                options={(packs.data ?? []).filter((p) => !p.archived).map((p) => ({ value: p.id, label: `${p.title} · v${p.latestVersion}`, icon: <ProviderChip id={p.providers[0] ?? "manual"} size={18} /> }))}
              />
            </div>
            <div>
              <span className="mb-1 block text-[12px] font-medium text-muted">Destination</span>
              <TargetSelect value={targetId} onChange={setTargetId} />
            </div>
            <div className="col-span-2 flex flex-wrap items-center justify-between gap-2">
              <Segmented label="How much to include" value={level} onChange={setLevel} options={[{ value: "full", label: "Full" }, { value: "balanced", label: "Balanced" }, { value: "minimal", label: "Minimal" }]} />
              <div className="flex items-center gap-2 text-[12px] text-muted">
                Tool activity
                <Segmented label="Tool activity" value={toolDetail} onChange={setToolDetail} options={[{ value: "truncated", label: "Trimmed" }, { value: "full", label: "Full" }, { value: "omit", label: "Leave out" }]} />
              </div>
              {preview.data && (
                <span className="flex items-center gap-2 text-[12px] text-muted">
                  {tokens(preview.data.tokenEstimate)} tokens <Badge tone={sizeVerdict(preview.data.tokenEstimate).tone}>{sizeVerdict(preview.data.tokenEstimate).text}</Badge>
                </span>
              )}
            </div>
          </Card>
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-line bg-surface-2 px-4 py-2 text-[12px] text-muted">Draft preview — exactly what will be copied</div>
            <pre data-selectable className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">{clip(preview.data?.text ?? "")}</pre>
          </Card>
        </section>

        <aside className="-mr-2 min-h-0 space-y-5 overflow-auto pr-2 pb-1">
          <section>
            <SectionLabel>Deliver</SectionLabel>
            <Card className="space-y-2.5 p-4">
              <Button
                variant="primary"
                className="w-full"
                icon={copied ? <CheckCheck size={14} /> : <Copy size={14} />}
                disabled={!pack}
                onClick={async () => {
                  if (!pack) return;
                  const ok = await copyHandoff(pack.id, pack.latestVersion, targetId, toolDetail, level);
                  setCopied(!!ok);
                }}
              >
                {copied ? "Copied — ready to paste" : "Copy handoff prompt"}
              </Button>
              {t.url && (
                <Button className="w-full" icon={<ExternalLink size={14} />} onClick={() => openUrl(t.url!)}>
                  Open {t.label}
                </Button>
              )}
              <Button className="w-full" icon={<FileDown size={14} />} disabled={!pack} onClick={() => pack && exportPack(pack.id, pack.latestVersion, "handoff", toolDetail, level)}>
                Export .handoff file
              </Button>
              <p className="text-[12px] text-muted">{t.hint}</p>
              {copied && pack && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full"
                  onClick={async () => {
                    await api.recordHandoff(pack.id, pack.latestVersion, targetId, "clipboard", "sent");
                    setCopied(false);
                  }}
                >
                  I sent it — mark as sent
                </Button>
              )}
            </Card>
          </section>
          <section>
            <SectionLabel>Before you share</SectionLabel>
            <Card className="p-4">{preview.data ? <PreviewWarnings preview={preview.data} /> : <div className="text-muted">Choose a pack.</div>}</Card>
          </section>
          <section>
            <SectionLabel>History</SectionLabel>
            <Card className="divide-y divide-line">
              {(history.data ?? []).length === 0 && <div className="px-4 py-4 text-center text-[12.5px] text-muted">No handoffs yet.</div>}
              {(history.data ?? []).slice(0, 10).map((h) => (
                <div key={h.id} className="flex items-center gap-2 px-3.5 py-2 text-[12.5px]">
                  <Badge tone={STATUS_TONE[h.status] ?? "neutral"} className="capitalize">{h.status}</Badge>
                  <div className={cx("min-w-0 flex-1 truncate")}>
                    {h.packTitle ?? "Deleted pack"} v{h.version} · {target(h.target).label}
                  </div>
                  <span className="shrink-0 text-faint">{relativeTime(h.createdAt)}</span>
                </div>
              ))}
            </Card>
            {pack && <div className="mt-2 text-[11.5px] text-faint">{plural(pack.messageCount, "message")} in the latest version.</div>}
          </section>
        </aside>
      </div>
      </FillPage>
    </div>
  );
}
