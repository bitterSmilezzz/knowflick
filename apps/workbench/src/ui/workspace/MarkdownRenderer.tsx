import React from "react";
import { parseReferenceUri, type ReferenceSourceKind } from "../../domain/noteReference";
import { attachmentKindOf } from "../../domain/attachmentKind";
import { AttachmentView, type AttachmentPayload } from "./AttachmentView";

type OpenReference = (id: string, kind: ReferenceSourceKind) => void;

/**
 * 格式化行内元素（加粗、行内代码、超链接、库内附件图片）
 *
 * `resolveAttachment` 可选：给了且路径合法才渲染 <img>，否则回退为纯文本——
 * 拒绝外链图片（与下方链接的安全口径一致：非 http/https 不给可执行导航），
 * 也拒绝任何非 media/ 路径，避免被用来探测文件系统。
 */
function renderInline(
  text: string,
  resolveAttachment?: (path: string) => AttachmentPayload | null,
  onOpenReference?: OpenReference
): React.ReactNode {
  // 正则匹配: **bold**, `code`, [label](url), ![alt](media/...)
  const regex = /(!\[[^\]]*\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(regex);

  return parts.map((part, idx) => {
    const image = part.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) {
      const [, alt, target] = image;
      const mediaPath = target.trim();
      // 只有库内相对路径才算附件：外链与路径穿越一律当普通文本（否则能用正文探测文件系统）。
      if (!resolveAttachment || !attachmentKindOf(mediaPath)) return <span key={idx}>{alt || mediaPath}</span>;
      const payload = resolveAttachment(mediaPath);
      if (!payload) return <span key={idx}>{`附件缺失：${mediaPath}`}</span>;
      return <AttachmentView key={idx} payload={payload} alt={alt || mediaPath} />;
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return <code key={idx}>{part.slice(1, -1)}</code>;
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      // 与引用检查共用解析器，内容指纹不参与原件定位。
      const reference = parseReferenceUri(linkMatch[2]);
      if (reference && onOpenReference) {
        return (
          <button
            key={idx}
            type="button"
            className="ws-md-note-link"
            onClick={() => onOpenReference(reference.id, reference.kind)}
          >
            {linkMatch[1]}
          </button>
        );
      }
      // Imported mail and AI summaries can contain arbitrary Markdown links.
      // Render unsupported schemes as text instead of executable navigation.
      try {
        if (!["https:", "http:"].includes(new URL(linkMatch[2]).protocol)) return <span key={idx}>{linkMatch[1]}</span>;
      } catch { return <span key={idx}>{linkMatch[1]}</span>; }
      return (
        <a key={idx} href={linkMatch[2]} target="_blank" rel="noreferrer">
          {linkMatch[1]}
        </a>
      );
    }
    return part;
  });
}

/**
 * 结构化轻量 Markdown 渲染器 (纯 React 节点，免 XSS 风险)
 */
export function MarkdownRenderer({ text, resolveAttachment, onOpenReference, onToggleTodo }: {
  text: string;
  /** 给了才把正文里的 `![](media/…)` 渲染成附件（见 renderInline 的安全口径）。 */
  /** 返回按种类的载荷：图片/录音给 URL，笔迹给解析后的文档。 */
  resolveAttachment?: (path: string) => AttachmentPayload | null;
  /** 允许在正文中打开库内笔记或素材。 */
  onOpenReference?: OpenReference;
  /**
   * 勾选正文里的待办。给了才把 `- [ ]` 渲染成可点的复选框——
   * 没有它的地方（邮件摘要、阅读面板）待办只读，避免「看起来能点却点不动」。
   */
  onToggleTodo?: (line: number) => void;
}): React.ReactElement {
  if (!text) return <div className="ws-prose" />;

  const lines = text.split(/\r?\n/);
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // 1. 代码块 ```
    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <pre key={`code-${i}`}>
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // Consume all Markdown heading levels (including indented headings), so
    // unsupported '#' lines cannot stall the paragraph parser at the same index.
    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      elements.push(heading[1].length <= 2
        ? <h2 key={`heading-${i}`}>{renderInline(heading[2], resolveAttachment, onOpenReference)}</h2>
        : <h3 key={`heading-${i}`}>{renderInline(heading[2], resolveAttachment, onOpenReference)}</h3>);
      i++;
      continue;
    }
    // 3. 引用块 >
    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      elements.push(
        <blockquote key={`quote-${i}`}>
          <p>{renderInline(quoteLines.join(" "), resolveAttachment, onOpenReference)}</p>
        </blockquote>
      );
      continue;
    }

    // 4. 无序列表 - 或 *（含待办：`- [ ]` / `- [x]`）
    if (/^[-*]\s+/.test(trimmed)) {
      const listItems: { text: string; line: number; todo: boolean; done: boolean }[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        const raw = lines[i];
        const stripped = raw.trim().replace(/^[-*]\s+/, "");
        const todo = stripped.match(/^\[([ xX])\]\s+(.*)$/);
        listItems.push({
          text: todo ? todo[2] : stripped,
          line: i,
          todo: !!todo,
          done: !!todo && todo[1].toLowerCase() === "x",
        });
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`}>
          {listItems.map((item, idx) => (
            <li key={idx} className={item.todo ? "ws-md-todo" : undefined}>
              {item.todo ? (
                <label className="ws-md-todo-label">
                  <input
                    type="checkbox"
                    checked={item.done}
                    // 没有 onToggleTodo 时保持只读：可点的复选框点不动比不可点更糟。
                    readOnly={!onToggleTodo}
                    disabled={!onToggleTodo}
                    aria-label={item.text}
                    onChange={() => onToggleTodo?.(item.line)}
                  />
                  <span className={item.done ? "ws-md-todo-text ws-md-todo-done" : "ws-md-todo-text"}>
                    {renderInline(item.text, resolveAttachment, onOpenReference)}
                  </span>
                </label>
              ) : (
                renderInline(item.text, resolveAttachment, onOpenReference)
              )}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // 5. 有序列表 1.
    if (/^\d+\.\s+/.test(trimmed)) {
      const listItems: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        listItems.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`}>
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInline(item, resolveAttachment, onOpenReference)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // 6. 表格：表头行 + 分隔行（`| --- |`）。列数不齐时按表头补齐——
    // 少一列的单元格在渲染时会被丢掉，用户看不出自己漏填了。
    if (/^\|.*\|\s*$/.test(trimmed) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1].trim())) {
      const splitRow = (row: string) =>
        row.trim().replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      const header = splitRow(trimmed);
      const columns = header.length;
      i += 2;
      const bodyRows: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i].trim())) {
        const cells = splitRow(lines[i].trim());
        while (cells.length < columns) cells.push("");
        bodyRows.push(cells.slice(0, columns));
        i++;
      }
      elements.push(
        <table key={`table-${i}`} className="ws-md-table">
          <thead>
            <tr>
              {header.map((cell, idx) => (
                <th key={idx}>{renderInline(cell, resolveAttachment, onOpenReference)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bodyRows.map((row, ridx) => (
              <tr key={ridx}>
                {row.map((cell, cidx) => (
                  <td key={cidx}>{renderInline(cell, resolveAttachment, onOpenReference)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
      continue;
    }

    // 7. 普通段落
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,6}\s+\S/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith(">") &&
      !lines[i].trim().startsWith("```") &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    elements.push(<p key={`p-${i}`}>{renderInline(paraLines.join("\n"), resolveAttachment, onOpenReference)}</p>);
  }

  return <div className="ws-prose">{elements}</div>;
}
