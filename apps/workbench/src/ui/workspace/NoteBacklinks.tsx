import type { NoteBacklink } from "../../domain/noteBacklink";

/**
 * 反向链接列表（B04）：谁引用了当前这篇。
 *
 * 抽成组件是为了能被单独渲染断言——这条链路（正文里有没有引用 → 列表渲不渲染）
 * 放在笔记页里测，要先铺一堆会话与列表状态，容易测成「环境不对」而不是「功能不对」。
 */
export function NoteBacklinks({ links, onOpen }: {
  links: readonly NoteBacklink[];
  onOpen: (noteId: string) => void;
}): React.ReactElement | null {
  if (links.length === 0) return null;
  return (
    <div className="nv-backlinks" aria-label="反向链接">
      <span className="nv-kbs-label">{`被引用（${links.length}）：`}</span>
      {links.map((link) => (
        <button
          key={link.noteId}
          type="button"
          className="nv-backlink"
          title={link.snippet || "打开引用它的那篇"}
          onClick={() => onOpen(link.noteId)}
        >
          {`《${link.title}》${link.archived ? "（已归档）" : ""}`}
        </button>
      ))}
    </div>
  );
}
