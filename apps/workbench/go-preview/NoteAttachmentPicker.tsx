import { useEffect, useState } from "react";
import type { MaterialAttachment } from "./bindings/knowflick.local/workbench-go/internal/library/models";
import { ListMaterialAttachments } from "./bindings/knowflick.local/workbench-go/previewservice";

type Props = {
  generation: number;
  busy: boolean;
  onAddFile: (file: File) => void;
  onInsert: (path: string, title: string) => void;
};

export function NoteAttachmentPicker({ generation, busy, onAddFile, onInsert }: Props) {
  const [items, setItems] = useState<MaterialAttachment[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void ListMaterialAttachments(generation)
      .then((attachments: MaterialAttachment[] | null) => { if (active) setItems(attachments ?? []); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [generation]);

  return <>
    <label>
      添加图片或音频附件
      <input type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.heic,.heif,.webm,.ogg,.m4a,.wav" disabled={busy}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onAddFile(file);
        }} />
    </label>
    {failed && <p className="preview-error" role="alert">无法读取素材附件</p>}
    {!failed && !items && <p className="preview-meta" role="status">正在读取素材附件…</p>}
    {!!items?.length && <select
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
    </select>}
  </>;
}
