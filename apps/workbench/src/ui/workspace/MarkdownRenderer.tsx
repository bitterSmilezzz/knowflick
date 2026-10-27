import React from "react";

/** 库内附件相对路径（media/<kind>/<uuid>.<ext>）——正文里引用附件只认这一种来源。 */
const MEDIA_PATH_RE = /^media\/(audio|image|ink)\/[A-Za-z0-9._-]+$/;

/**
 * 格式化行内元素（加粗、行内代码、超链接、库内附件图片）
 *
 * `resolveAttachment` 可选：给了且路径合法才渲染 <img>，否则回退为纯文本——
 * 拒绝外链图片（与下方链接的安全口径一致：非 http/https 不给可执行导航），
 * 也拒绝任何非 media/ 路径，避免被用来探测文件系统。
 */
function renderInline(
  text: string,
  resolveAttachment?: (path: string) => string | null,
  onOpenNote?: (noteId: string) => void
): React.ReactNode {
  // 正则匹配: **bold**, `code`, [label](url), ![alt](media/...)
  const regex = /(!\[[^\]]*\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(regex);

  return parts.map((part, idx) => {
    const image = part.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) {
      const [, alt, target] = image;
      const mediaPath = target.trim();
      if (!resolveAttachment || !MEDIA_PATH_RE.test(mediaPath)) return <span key={idx}>{alt || mediaPath}</span>;
      const url = resolveAttachment(mediaPath);
      if (!url) return <span key={idx}>{`附件缺失：${mediaPath}`}</span>;
      return <img key={idx} src={url} alt={alt || mediaPath} className="ws-md-image" />;
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return <code key={idx}>{part.slice(1, -1)}</code>;
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      // 库内笔记引用（T13/G01）：knowflick://note/<id> 是应用内部导航，
      // 交给调用方处理——外链协议仍然只放行 http/https（导入的邮件里
      // 可能有任意 scheme 的链接，不能给它们可执行导航）。
      if (linkMatch[2].startsWith("knowflick://note/") && onOpenNote) {
        const noteId = linkMatch[2].slice("knowflick://note/".length);
        return (
          <button
            key={idx}
            type="button"
            className="ws-md-note-link"
            onClick={() => onOpenNote(noteId)}
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
export function MarkdownRenderer({ text, resolveAttachment, onOpenNote }: {
  text: string;
  /** 给了才把正文里的 `![](media/…)` 渲染成 <img>（见 renderInline 的安全口径）。 */
  resolveAttachment?: (path: string) => string | null;
  /** 给了才把 `knowflick://note/<id>` 渲染成可点的内部链接（T13/G01）。 */
  onOpenNote?: (noteId: string) => void;
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
        ? <h2 key={`heading-${i}`}>{renderInline(heading[2], resolveAttachment, onOpenNote)}</h2>
        : <h3 key={`heading-${i}`}>{renderInline(heading[2], resolveAttachment, onOpenNote)}</h3>);
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
          <p>{renderInline(quoteLines.join(" "), resolveAttachment, onOpenNote)}</p>
        </blockquote>
      );
      continue;
    }

    // 4. 无序列表 - 或 *
    if (/^[-*]\s+/.test(trimmed)) {
      const listItems: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        listItems.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`}>
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInline(item, resolveAttachment, onOpenNote)}</li>
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
            <li key={idx}>{renderInline(item, resolveAttachment, onOpenNote)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // 6. 普通段落
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
    elements.push(<p key={`p-${i}`}>{renderInline(paraLines.join("\n"), resolveAttachment, onOpenNote)}</p>);
  }

  return <div className="ws-prose">{elements}</div>;
}
