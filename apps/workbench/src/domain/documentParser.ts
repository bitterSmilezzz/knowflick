/**
 * 本地文档解析引擎 (Document Parser)
 * 纯本地离线解析 Markdown、TXT、DOCX、PDF 的纯文本与标题层级
 * 零第三方重量级依赖，利用 Web 标准 DecompressionStream
 */

export interface ParsedDocument {
  title: string;
  markdown: string;
  wordCount: number;
  sections: Array<{ title: string; content: string }>;
}

/**
 * 解析本地文件（Markdown, TXT, DOCX, PDF）
 */
export async function parseDocumentFile(
  name: string,
  buffer: ArrayBuffer
): Promise<ParsedDocument> {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const baseTitle = name.replace(/\.[^/.]+$/, "");

  if (ext === "md" || ext === "markdown" || ext === "txt") {
    const text = new TextDecoder("utf-8").decode(buffer);
    return parseMarkdownOrText(baseTitle, text);
  }

  if (ext === "docx") {
    return parseDocxBuffer(baseTitle, buffer);
  }

  if (ext === "pdf") {
    return parsePdfBuffer(baseTitle, buffer);
  }

  if (ext === "pptx") {
    return parsePptxBuffer(baseTitle, buffer);
  }

  if (ext === "doc" || ext === "ppt" || ext === "xls") {
    throw new Error(`.${ext} 是旧版二进制格式，请另存为 .${ext}x 后再导入`);
  }

  throw new Error(`不支持的文件格式: .${ext}，当前支持 .md, .txt, .docx, .pptx, .pdf 与图片`);
}

/**
 * 解析纯文本或 Markdown
 */
export function parseMarkdownOrText(fallbackTitle: string, text: string): ParsedDocument {
  const lines = text.split(/\r?\n/);
  let title = fallbackTitle;
  
  // 尝试从首行一级标题获取标题
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      title = trimmed.replace(/^#\s+/, "").trim() || fallbackTitle;
      break;
    }
  }

  const sections: Array<{ title: string; content: string }> = [];
  let currentSectionTitle = title;
  let currentLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^#{1,3}\s+(.+)$/);
    if (match) {
      if (currentLines.length > 0) {
        sections.push({
          title: currentSectionTitle,
          content: currentLines.join("\n").trim(),
        });
        currentLines = [];
      }
      currentSectionTitle = match[1].trim();
    }
    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    sections.push({
      title: currentSectionTitle,
      content: currentLines.join("\n").trim(),
    });
  }

  const cleanMd = text.trim();
  return {
    title,
    markdown: cleanMd,
    wordCount: countWords(cleanMd),
    sections: sections.length > 0 ? sections : [{ title, content: cleanMd }],
  };
}

/**
 * 解析 DOCX 文件（读取 ZIP 中的 word/document.xml）
 */
export async function parseDocxBuffer(
  fallbackTitle: string,
  buffer: ArrayBuffer
): Promise<ParsedDocument> {
  const bytes = new Uint8Array(buffer);
  const xml = await extractFileFromZip(bytes, "word/document.xml");
  if (!xml) {
    throw new Error("无法读取 DOCX 内容：压缩包中缺少 word/document.xml");
  }

  return parseDocxXml(fallbackTitle, xml);
}

/**
 * 从 ZIP 字节流中解压指定文件名（纯原生实现）
 */
export async function extractFileFromZip(
  bytes: Uint8Array,
  targetPath: string
): Promise<string | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  while (offset + 30 <= bytes.byteLength) {
    const sig = view.getUint32(offset, true);
    // Local file header signature 0x04034b50 ("PK\x03\x04")
    if (sig === 0x04034b50) {
      const compression = view.getUint16(offset + 8, true);
      const compressedSize = view.getUint32(offset + 18, true);
      const fileNameLen = view.getUint16(offset + 26, true);
      const extraFieldLen = view.getUint16(offset + 28, true);

      const fileNameBytes = bytes.subarray(offset + 30, offset + 30 + fileNameLen);
      const fileName = new TextDecoder("utf-8").decode(fileNameBytes);

      const dataOffset = offset + 30 + fileNameLen + extraFieldLen;
      if (fileName === targetPath) {
        const compressedData = bytes.subarray(dataOffset, dataOffset + compressedSize);
        if (compression === 0) {
          // Stored (no compression)
          return new TextDecoder("utf-8").decode(compressedData);
        } else if (compression === 8) {
          // Deflate
          return await decompressDeflateRaw(compressedData);
        } else {
          throw new Error(`不支持的 ZIP 压缩方式: ${compression}`);
        }
      }

      offset = dataOffset + compressedSize;
    } else if (sig === 0x02014b50 || sig === 0x06054b50) {
      // Central directory header / End of central directory
      break;
    } else {
      offset++;
    }
  }

  return null;
}

/**
 * 列出 ZIP 里所有条目名（只读本地文件头，够用于 pptx 的 slide 枚举）。
 *
 * 单独写一个而不是复用 extractFileFromZip：后者只找一个固定路径，
 * pptx 的幻灯片文件名是 slide1.xml / slide2.xml … 需要先知道有哪些。
 */
export function listZipEntries(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const names: string[] = [];
  let offset = 0;
  while (offset + 30 <= bytes.byteLength) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) {
      if (sig === 0x02014b50 || sig === 0x06054b50) break;
      offset++;
      continue;
    }
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLen = view.getUint16(offset + 26, true);
    const extraFieldLen = view.getUint16(offset + 28, true);
    const name = new TextDecoder("utf-8").decode(bytes.subarray(offset + 30, offset + 30 + fileNameLen));
    names.push(name);
    offset += 30 + fileNameLen + extraFieldLen + compressedSize;
  }
  return names;
}

/**
 * 解析 PPTX：按页码取每页的文本，拼成带页标题的 Markdown。
 *
 * 只取文字（`<a:t>` 里的 run），不还原版式、图形与备注——
 * 目标是「能搜到、能被 AI 提炼」，不是还原幻灯片。
 */
export async function parsePptxBuffer(
  fallbackTitle: string,
  buffer: ArrayBuffer
): Promise<ParsedDocument> {
  const bytes = new Uint8Array(buffer);
  const entries = listZipEntries(bytes);
  const slides = entries
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      return na - nb;
    });
  if (slides.length === 0) {
    throw new Error("无法读取 PPTX 内容：压缩包中找不到幻灯片");
  }

  const sections: Array<{ title: string; content: string }> = [];
  for (const [index, path] of slides.entries()) {
    const xml = await extractFileFromZip(bytes, path);
    if (!xml) continue;
    const text = Array.from(xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g))
      .map(match => decodeXmlEntities(match[1]).trim())
      .filter(Boolean)
      .join("\n");
    if (!text) continue;
    sections.push({ title: `第 ${index + 1} 页`, content: text });
  }
  if (sections.length === 0) {
    throw new Error("这份 PPTX 里没有可提取的文字（可能全是图片）");
  }
  const title = sections[0].content.split("\n")[0]?.slice(0, 80) || fallbackTitle;
  const markdown = sections.map(section => `## ${section.title}\n\n${section.content}`).join("\n\n");
  return { title, markdown, wordCount: countWords(markdown), sections };
}

/** 还原 XML 文本里的常见实体，避免把 &amp; 原样显示给用户。 */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

/**
 * 使用 Web 标准 DecompressionStream 解压 raw deflate 数据
 */
async function decompressDeflateRaw(data: Uint8Array): Promise<string> {
  // If DecompressionStream supports "deflate-raw", use it
  try {
    const stream = new Response(new Blob([data as unknown as BlobPart])).body;
    if (stream && typeof DecompressionStream !== "undefined") {
      const decompressed = stream.pipeThrough(new DecompressionStream("deflate-raw"));
      return await new Response(decompressed).text();
    }
  } catch {
    // fallback if deflate-raw header needed
  }

  // Fallback: wrap with standard zlib header if needed
  try {
    const stream = new Response(new Blob([data as unknown as BlobPart])).body;
    if (stream && typeof DecompressionStream !== "undefined") {
      const decompressed = stream.pipeThrough(new DecompressionStream("deflate"));
      return await new Response(decompressed).text();
    }
  } catch (err) {
    throw new Error(`解压失败: ${String(err)}`);
  }

  throw new Error("当前环境不支持 DecompressionStream");
}

/**
 * 将 Word XML 转换为 Markdown 与层级小节
 */
export function parseDocxXml(fallbackTitle: string, xml: string): ParsedDocument {
  // 简易正则解析 XML 段落 <w:p>
  const paragraphs: Array<{ text: string; headingLevel: number }> = [];
  const pRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let pMatch: RegExpExecArray | null;

  while ((pMatch = pRegex.exec(xml)) !== null) {
    const pContent = pMatch[1];
    
    // 检查是否包含标题样式
    let headingLevel = 0;
    const styleMatch = pContent.match(/<w:pStyle\s+w:val="([^"]+)"/i);
    if (styleMatch) {
      const val = styleMatch[1].toLowerCase();
      if (val.includes("heading1") || val === "1") headingLevel = 1;
      else if (val.includes("heading2") || val === "2") headingLevel = 2;
      else if (val.includes("heading3") || val === "3") headingLevel = 3;
    }

    // 提取文字 <w:t>
    const tRegex = /<w:t\b[^>]*>([^<]*)<\/w:t>/g;
    let tMatch: RegExpExecArray | null;
    let pText = "";
    while ((tMatch = tRegex.exec(pContent)) !== null) {
      pText += tMatch[1];
    }

    const trimmed = pText.trim();
    if (trimmed) {
      paragraphs.push({ text: trimmed, headingLevel });
    }
  }

  let title = fallbackTitle;
  const mdLines: string[] = [];
  const sections: Array<{ title: string; content: string }> = [];
  let currentSectionTitle = title;
  let currentSectionLines: string[] = [];

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    if (i === 0 && p.headingLevel > 0) {
      title = p.text;
    }

    if (p.headingLevel > 0) {
      if (currentSectionLines.length > 0) {
        sections.push({
          title: currentSectionTitle,
          content: currentSectionLines.join("\n\n").trim(),
        });
        currentSectionLines = [];
      }
      currentSectionTitle = p.text;
      const prefix = "#".repeat(p.headingLevel);
      mdLines.push(`${prefix} ${p.text}`);
    } else {
      mdLines.push(p.text);
      currentSectionLines.push(p.text);
    }
  }

  if (currentSectionLines.length > 0) {
    sections.push({
      title: currentSectionTitle,
      content: currentSectionLines.join("\n\n").trim(),
    });
  }

  const markdown = mdLines.join("\n\n").trim();
  return {
    title,
    markdown,
    wordCount: countWords(markdown),
    sections: sections.length > 0 ? sections : [{ title, content: markdown }],
  };
}

/**
 * 解析 PDF 二进制文本
 */
export function parsePdfBuffer(fallbackTitle: string, buffer: ArrayBuffer): ParsedDocument {
  const bytes = new Uint8Array(buffer);
  const textRaw = new TextDecoder("latin1").decode(bytes);

  // 提取 PDF stream 内容与文本字符
  const textChunks: string[] = [];
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let streamMatch: RegExpExecArray | null;

  while ((streamMatch = streamRegex.exec(textRaw)) !== null) {
    const rawStream = streamMatch[1];
    // 提取纯文本字符串: (Text) Tj 或者 [(T) 10 (ext)] TJ
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let match: RegExpExecArray | null;
    while ((match = tjRegex.exec(rawStream)) !== null) {
      textChunks.push(decodePdfString(match[1]));
    }

    const arrayRegex = /\[([^\]]+)\]\s*TJ/g;
    let arrMatch: RegExpExecArray | null;
    while ((arrMatch = arrayRegex.exec(rawStream)) !== null) {
      const inner = arrMatch[1];
      const strParts = inner.match(/\(([^)]*)\)/g);
      if (strParts) {
        const joined = strParts.map(s => decodePdfString(s.slice(1, -1))).join("");
        textChunks.push(joined);
      }
    }
  }

  let extracted = textChunks.join(" ").replace(/\s+/g, " ").trim();
  if (!extracted) {
    // 降级兜底：全文查找可打印 ASCII / UTF-8 片段
    const asciiMatches = textRaw.match(/[\w\s.,;:!?'"()\u4e00-\u9fa5]{4,}/g);
    if (asciiMatches) {
      extracted = asciiMatches.join(" ").replace(/\s+/g, " ").trim();
    }
  }

  const markdown = extracted || "（PDF 未包含可提取的纯文本流，可能是扫描件或受密码保护）";
  const title = fallbackTitle;

  return {
    title,
    markdown,
    wordCount: countWords(markdown),
    sections: [{ title, content: markdown }],
  };
}

function decodePdfString(str: string): string {
  return str
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

function countWords(str: string): number {
  return str.replace(/\s+/g, "").length;
}
