import { useEffect, useState } from "react";
import type { MaterialAttachment } from "./bindings/knowflick.local/workbench-go/internal/library/models";
import { ListMaterialAttachments } from "./bindings/knowflick.local/workbench-go/previewservice";

type Props = {
  generation: number;
  busy: boolean;
  onInsert: (path: string, title: string) => void;
};

export function NoteAttachmentPicker({ generation, busy, onInsert }: Props) {
  const [items, setItems] = useState<MaterialAttachment[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void ListMaterialAttachments(generation)
      .then((attachments: MaterialAttachment[]) => { if (active) setItems(attachments); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [generation]);

  if (failed) return <p className="preview-error" role="alert">无法读取素材附件</p>;
  if (!items) return <p className="preview-meta" role="status">正在读取素材附件…</p>;
  if (items.length === 0) return null;

  return <select
    className="preview-attachment-picker"
    aria-label="插入素材附件"
    value=""
    disabled={busy}
    onChange={(event) => {
      const attachment = items.find((item) => item.path === event.currentTarget.value);
      if (attachment) onInsert(attachment.path, attachment.title);
    }}
  >
    <option value="">插入素材附件…</option>
    {items.map(({ path, title }) => <option key={path} value={path}>{title.trim() || path}</option>)}
  </select>;
}
