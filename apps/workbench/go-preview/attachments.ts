import { useEffect, useMemo, useState } from "react";
import { attachmentKindOf } from "../src/domain/attachmentKind";
import { parseInk } from "../src/domain/ink";
import { mediaMimeOfExtension } from "../src/domain/mediaMime";
import { base64ToBytes } from "../src/shell/base64";
import type { AttachmentPayload } from "../src/ui/workspace/AttachmentView";
import { ReadAttachment } from "./bindings/knowflick.local/workbench-go/previewservice";

type AttachmentScope = { generation: number; references: string };

type LoadedAttachments = {
  scope: AttachmentScope;
  payloads: Map<string, AttachmentPayload>;
};

// references 是以换行分隔的库内路径。正文变化时，只有路径变化才重新读取附件。
export function useAttachments(generation: number, references: string) {
  const [loaded, setLoaded] = useState<LoadedAttachments | null>(null);
  const scope = useMemo(() => ({ generation, references }), [generation, references]);

  useEffect(() => {
    const { generation, references } = scope;
    if (!references) return;
    let active = true;
    const urls: string[] = [];

    async function load() {
      const payloads = new Map<string, AttachmentPayload>();
      for (const path of references.split("\n")) {
        const kind = attachmentKindOf(path);
        if (!kind) continue;
        try {
          const encoded = await ReadAttachment(generation, path);
          if (!active) return;
          const bytes = base64ToBytes(encoded);
          if (kind === "ink") {
            const doc = parseInk(JSON.parse(new TextDecoder().decode(bytes)));
            payloads.set(path, { kind, doc });
          } else {
            const extension = path.slice(path.lastIndexOf(".") + 1);
            const type = mediaMimeOfExtension(extension) ?? "application/octet-stream";
            const url = URL.createObjectURL(new Blob([bytes], { type }));
            urls.push(url);
            payloads.set(path, { kind, url });
          }
        } catch {
          // 无法读取或解析的附件由调用方显示缺失提示。
        }
      }
      if (active) setLoaded({ scope, payloads });
    }

    void load();
    return () => {
      active = false;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [scope]);

  return loaded?.scope === scope ? loaded.payloads : null;
}
