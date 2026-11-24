import type { BulkReplaceHit } from "../../domain/noteBulkReplace";
import { bulkReplaceTotals } from "../../domain/noteBulkReplace";

/**
 * 批量替换的预览清单（B01）。
 *
 * 以前只在 confirm 里说「改 12 篇 37 处」——用户没法判断搜的是不是自己想的那个词，
 * 也没有机会在写库前逐篇看一眼。这里把命中摊开：每篇一行，带第一处上下文。
 *
 * 确认与执行仍由调用方负责：这个组件只显示与回调，不自己写库。
 */
export function BulkReplacePreview({ hits, query, onConfirm, onCancel }: {
  hits: readonly BulkReplaceHit[];
  query: string;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement | null {
  if (hits.length === 0) return null;
  const totals = bulkReplaceTotals(hits);
  return (
    <div className="nv-bulk-replace" role="dialog" aria-label="批量替换预览">
      <p className="nv-bulk-replace-head">
        {`将在 ${totals.notes} 篇笔记里替换 ${totals.matches} 处「${query}」。每篇生成一次修订，可逐篇回退。`}
      </p>
      <ul className="nv-bulk-replace-list">
        {hits.map((hit) => (
          <li key={hit.id}>
            <span className="nv-bulk-replace-title">{`《${hit.title}》`}</span>
            <span className="nv-bulk-replace-count">{`${hit.count} 处`}</span>
            {hit.snippet ? (
              <span className="nv-bulk-replace-snippet">
                {hit.snippet.before}
                <mark className="nv-snippet-hit">{hit.snippet.match}</mark>
                {hit.snippet.after}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="nv-bulk-replace-actions">
        <button type="button" className="ws-primary" onClick={onConfirm}>确认替换</button>
        <button type="button" className="ws-bordered" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
