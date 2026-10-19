import React from "react";

/**
 * 格式化行内元素（加粗、行内代码、超链接）
 */
function renderInline(text: string): React.ReactNode {
  // 正则匹配: **bold**, `code`, [label](url)
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(regex);

  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return <code key={idx}>{part.slice(1, -1)}</code>;
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
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
export function MarkdownRenderer({ text }: { text: string }): React.ReactElement {
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

    // 2. 标题 #, ##, ###
    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match) {
      elements.push(<h2 key={`h1-${i}`}>{renderInline(h1Match[1])}</h2>);
      i++;
      continue;
    }
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      elements.push(<h2 key={`h2-${i}`}>{renderInline(h2Match[1])}</h2>);
      i++;
      continue;
    }
    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match) {
      elements.push(<h3 key={`h3-${i}`}>{renderInline(h3Match[1])}</h3>);
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
          <p>{renderInline(quoteLines.join(" "))}</p>
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
            <li key={idx}>{renderInline(item)}</li>
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
            <li key={idx}>{renderInline(item)}</li>
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
      !lines[i].trim().startsWith("#") &&
      !lines[i].trim().startsWith(">") &&
      !lines[i].trim().startsWith("```") &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    elements.push(<p key={`p-${i}`}>{renderInline(paraLines.join("\n"))}</p>);
  }

  return <div className="ws-prose">{elements}</div>;
}
