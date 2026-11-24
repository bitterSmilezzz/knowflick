/**
 * 整理标签（B03）：把打错的标签一次改对。
 *
 * 标签是手打的，错一个字就得逐篇打开改；攒到几十篇之后「把 `工作` 都改成 `工作流`」
 * 成了不可能完成的手工活。这里给一个最小入口：选旧标签、填新名字、点重命名。
 *
 * 只用已有的标签做候选（不让用户对着空白框回忆拼写）；新名字在同篇已存在时由
 * 领域函数合并，界面如实说明「其中 N 篇与原标签合并」。
 */
import { useState } from "react";
import type { TagCount } from "../../domain/noteTags";
import { deleteConfirmLabels } from "./deleteConfirm";
import { useDeleteConfirm } from "./useDeleteConfirm";

export function TagAdmin({ tags, onRename, onDelete }: {
  tags: readonly TagCount[];
  /** 旧标签与新名字；不传就只列出来看。 */
  onRename?: (from: string, to: string) => void;
  /** 从库里所有笔记摘掉这个标签；不传就没有删除按钮。 */
  onDelete?: (tag: string) => void;
}): React.ReactElement | null {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // 批量改库是全库范围的写入：走项目统一的「点一下变确认、再点一次才执行」两步确认。
  const confirm = useDeleteConfirm((tag) => { onDelete?.(tag); });
  if (tags.length === 0) return null;
  const delLabels = from ? deleteConfirmLabels(`标签 ${from}`, confirm.isArmed(from)) : null;
  const canRename = from !== "" && to.trim() !== "";
  return (
    <details className="nv-tag-admin" aria-label="整理标签">
      <summary>{`整理标签（${tags.length} 个）`}</summary>
      <div className="nv-tag-admin-row">
        <select
          aria-label="选择要改名的标签"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        >
          <option value="">选择标签…</option>
          {tags.map((t) => (
            <option key={t.tag} value={t.tag}>{`${t.tag}（${t.count}）`}</option>
          ))}
        </select>
        <input
          aria-label="标签的新名字"
          placeholder="改成什么名字"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && canRename && onRename) onRename(from, to); }}
        />
        {onDelete && delLabels ? (
          <button
            type="button"
            className={confirm.isArmed(from) ? "ws-danger" : "ws-bordered"}
            aria-label={delLabels.ariaLabel}
            title={delLabels.title}
            onClick={() => confirm.request(from)}
          >
            {confirm.isArmed(from) ? "确认删除" : "删除标签"}
          </button>
        ) : null}
        {onRename ? (
          <button
            type="button"
            className="ws-bordered"
            disabled={!canRename}
            aria-label="重命名这个标签"
            onClick={() => onRename(from, to)}
          >
            重命名
          </button>
        ) : null}
      </div>
      <p className="ws-hint">只改标签本身，正文一个字都不动；新名字在同一篇里已经存在时会合并，不会留下两个同名标签。删除标签是把「这个标签」摘掉，不是删笔记。</p>
    </details>
  );
}
