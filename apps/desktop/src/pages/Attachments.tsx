import { useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { FilePlus2, FolderPlus, Hammer, Paperclip, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { pickFiles } from "../lib/actions";
import { bytes } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { useApp } from "../lib/store";
import { attachmentDraftItem } from "./Builder";
import { FileImportModal } from "../components/FileImport";
import { ListSkeleton } from "../components/Skeletons";
import { Badge, Button, Card, EmptyState, ErrorNote, IconButton, PageHeader } from "../components/ui";

export function Attachments() {
  const { data, error, loading } = useLoad(() => api.listAttachments());
  const addToDraft = useApp((s) => s.addToDraft);
  const toast = useApp((s) => s.toast);
  const navigate = useApp((s) => s.navigate);
  const [paths, setPaths] = useState<string[] | null>(null);

  return (
    <div>
      <PageHeader
        title="Attachments"
        subtitle="Files you've added. Text files are inlined into handoffs; images, PDFs and other files are listed for you to attach."
        actions={
          <>
            <Button icon={<FolderPlus size={14} />} onClick={async () => { const p = await pickFiles(true); if (p.length) setPaths(p); }}>Add folder</Button>
            <Button variant="primary" icon={<FilePlus2 size={14} />} onClick={async () => { const p = await pickFiles(); if (p.length) setPaths(p); }}>Add files</Button>
          </>
        }
      />
      {error && <ErrorNote text={error} />}
      {loading && !data && <ListSkeleton rows={5} buttons={2} label="Loading files" />}
      {data && data.length === 0 && (
        <Card>
          <EmptyState icon={<Paperclip size={20} />} title="No files yet" body="Drop files anywhere in this window, or choose them. You'll review each file before it's stored." />
        </Card>
      )}
      {data && data.length > 0 && (
        <Card className="divide-y divide-line">
          {data.map((a) => (
            <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
              <Paperclip size={15} className="text-faint" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium" title={a.originPath ?? undefined}>{a.fileName}</div>
                <div className="truncate text-[12px] text-faint">
                  {bytes(a.size)} · {a.mediaType} · sha256 <span className="font-mono">{a.sha256.slice(0, 12)}</span>
                </div>
              </div>
              {a.text != null ? <Badge tone="success">Inlined as text</Badge> : <Badge tone="warning">Attach original</Badge>}
              <Button
                size="sm"
                variant="ghost"
                icon={<Hammer size={13} />}
                onClick={() => {
                  const n = addToDraft([attachmentDraftItem(a)]);
                  toast({ kind: n ? "success" : "info", text: n ? `Added ${a.fileName} to the Builder.` : "Already in the Builder.", action: { label: "Open Builder", run: () => navigate({ page: "builder" }) } });
                }}
              >
                Add to Builder
              </Button>
              <IconButton
                label={`Delete ${a.fileName}`}
                onClick={async () => {
                  if (await ask(`Remove ${a.fileName} from your library? Packs that list it will show it as unavailable.`, { title: "Delete file", kind: "warning" })) await api.deleteAttachment(a.id);
                }}
              >
                <Trash2 size={14} />
              </IconButton>
            </div>
          ))}
        </Card>
      )}
      {paths && <FileImportModal paths={paths} onClose={() => setPaths(null)} />}
    </div>
  );
}
