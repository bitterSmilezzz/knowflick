import { useState } from "react";
import type { ArchivePreview, RestoreStrategy } from "../domain/archive";

export function ImportRestoreSheet({
  preview,
  onConfirm,
  onClose,
}: {
  preview: ArchivePreview;
  onConfirm: (strategy: RestoreStrategy) => void;
  onClose: () => void;
}) {
  const [strategy, setStrategy] = useState<RestoreStrategy>("merge");
  const topCategories = Object.entries(preview.categoriesSummary)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal import-restore" onClick={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <h1>导入归档</h1>
          <button type="button" onClick={onClose}>取消</button>
        </header>
        <p className="hint">{preview.filename}{preview.isZipArchive ? " · ZIP 备份" : " · JSON"}</p>
        <ul className="import-stats">
          <li>共 {preview.totalCards} 张</li>
          <li>已浏览 {preview.readCards}</li>
          <li>收藏 {preview.favoritedCards}</li>
          {preview.settingsJson ? <li>含 settings.json</li> : null}
        </ul>
        {topCategories.length > 0 ? (
          <p className="hint">分类：{topCategories.map(([name, count]) => `${name} ${count}`).join(" · ")}</p>
        ) : null}
        <div className="import-strategy">
          <label className={`strategy-card${strategy === "merge" ? " on" : ""}`}>
            <input type="radio" name="restore" checked={strategy === "merge"} onChange={() => setStrategy("merge")} />
            <strong>增量合并（推荐）</strong>
            <span>按 id / 标题匹配合并，保留本机学习进度</span>
          </label>
          <label className={`strategy-card${strategy === "overwrite" ? " on" : ""}`}>
            <input type="radio" name="restore" checked={strategy === "overwrite"} onChange={() => setStrategy("overwrite")} />
            <strong>全量覆盖</strong>
            <span>用归档替换当前卡库{preview.settingsJson ? "，并写入归档中的 settings" : ""}</span>
          </label>
        </div>
        <div className="actions">
          <button type="button" className="primary" onClick={() => onConfirm(strategy)}>确认导入</button>
        </div>
      </section>
    </div>
  );
}
