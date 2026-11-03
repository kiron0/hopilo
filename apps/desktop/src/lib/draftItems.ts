// Builder tiles for library items, shared without loading the Builder screen.
import type { Attachment } from "./api";
import { bytes } from "./format";
import type { DraftItem } from "./store";

export function attachmentDraftItem(a: Attachment): DraftItem {
  return {
    key: `attachment:${a.id}`,
    item: { kind: "attachment", id: a.id },
    label: a.fileName,
    meta: `${bytes(a.size)} · ${a.text != null ? "inlined as text" : "attach original at destination"}`,
    provider: "file",
  };
}
