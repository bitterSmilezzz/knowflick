import type { MailDigestSource } from "../../domain/mail";
import type { RawMaterial } from "../../shell/store";

/** The source list is persisted with the digest, rather than inferred from current selection. */
export function MailDigestSources({ sources, materials, onOpenMaterial }: {
  sources: MailDigestSource[];
  materials: RawMaterial[];
  onOpenMaterial: (id: string) => void;
}) {
  if (!sources.length) return null;
  return <section className="mail-digest-sources" aria-label="摘要来源邮件">
    <h3>来源邮件</h3>
    <ol>
      {sources.map((source, index) => {
        const available = materials.some(m => m.id === source.materialId && m.sourceType === "email");
        return <li key={source.materialId} className="mail-digest-source" data-mail-source={source.materialId}>
          <div><strong>[邮件 {index + 1}] {source.subject || "（无主题）"}</strong>
            <span>{source.from}{source.date ? ` · ${source.date}` : ""}</span>
            {!available && <span>原邮件已不在当前库中</span>}
          </div>
          <button type="button" className="ws-bordered" disabled={!available} aria-label={`查看原邮件：${source.subject || "无主题"}`} onClick={() => onOpenMaterial(source.materialId)}>查看原邮件</button>
        </li>;
      })}
    </ol>
  </section>;
}
