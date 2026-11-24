import { snippetFor } from "../../domain/noteSearchSnippet";

/**
 * 列表行的预览（R1）。搜索时显示**命中的那一段**并高亮命中词；没搜索就还是正文开头。
 *
 * 不搜索时不改口径——那时用户看的是「这篇大概讲什么」，开头比中段更有用。
 */
export function NoteSearchPreview({ body, query }: { body: string; query: string }): React.ReactElement {
  const snippet = query.trim() ? snippetFor(body, query) : null;
  if (!snippet) return <>{body.slice(0, 60) || "空笔记"}</>;
  return (
    <span className="nv-snippet">
      {snippet.before}
      <mark className="nv-snippet-hit">{snippet.match}</mark>
      {snippet.after}
    </span>
  );
}
