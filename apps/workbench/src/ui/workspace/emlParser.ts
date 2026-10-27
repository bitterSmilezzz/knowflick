/**
 * `.eml` 邮件文件解析。
 *
 * 用户从邮箱把邮件导出成文件后，导回知识库是「数据完全归你所有」的自然一环。
 * 真实 `.eml` 的复杂度集中在 MIME 上：
 *   - `multipart/*` 嵌套（alternative / mixed / related）
 *   - 正文编码：base64、quoted-printable、7bit/8bit
 *   - 字符集声明在 `Content-Type; charset=`，正文可能是 UTF-8 / GBK / ISO-8859-1
 *   - 主题可能用 RFC 2047 编码（`=?UTF-8?B?...?=`）
 *
 * 目标不是完整实现 RFC 5322，而是把**能救回来的内容救回来**：
 * 坏掉的附件、坏的编码不该让整封邮件消失。
 */

/** 一封解析出来的邮件。 */
export interface ParsedEmail {
  from: string;
  to: string;
  subject: string;
  date: string;
  messageId: string;
  /** 正文（纯文本优先；只有 HTML 时取 HTML 里剥出来的文字）。 */
  text: string;
  /** 附件文件名。 */
  attachments: string[];
}

interface Header {
  name: string;
  value: string;
}

interface Part {
  headers: Header[];
  body: string;
  /** 原始字节（base64 附件要用）。 */
  raw: Uint8Array;
}

/** 拆出头部与正文（第一个空行分隔）。 */
function splitHeadBody(raw: string): { head: string; body: string } {
  const idx = raw.indexOf("\r\n\r\n");
  if (idx >= 0) {
    return { head: raw.slice(0, idx), body: raw.slice(idx + 4) };
  }
  const lf = raw.indexOf("\n\n");
  if (lf >= 0) {
    return { head: raw.slice(0, lf), body: raw.slice(lf + 2) };
  }
  return { head: raw, body: "" };
}

/** 解析头部行；支持折行（以空白开头的续行）。 */
function parseHeaders(head: string): Header[] {
  const lines = head.split(/\r?\n/);
  const headers: Header[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && headers.length > 0) {
      headers[headers.length - 1].value += " " + line.trim();
      continue;
    }
    const at = line.indexOf(":");
    if (at <= 0) continue;
    headers.push({ name: line.slice(0, at).trim().toLowerCase(), value: line.slice(at + 1).trim() });
  }
  return headers;
}

function headerValue(headers: Header[], name: string): string {
  return headers.find((h) => h.name === name)?.value ?? "";
}

/** Content-Type 的参数（charset / boundary）。 */
function contentTypeParams(value: string): Record<string, string> {
  const params: Record<string, string> = {};
  const re = /;\s*([\w-]+)\s*=\s*("([^"]*)"|([^;]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    params[m[1].toLowerCase()] = (m[3] ?? m[4] ?? "").trim();
  }
  return params;
}

/**
 * 解 quoted-printable。
 *
 * `=XX` 是**字节**值（不是 Unicode 码点），所以结果按 latin1 逐字节存，
 * 之后交给 decodeBytes 按邮件声明的字符集解读。
 */
function decodeQuotedPrintable(text: string): string {
  return text
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** latin1 字符串 → 字节。 */
function latin1Bytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

/** 解 base64（忽略换行与非法字符），返回字节。 */
function decodeBase64Bytes(text: string): Uint8Array {
  const cleaned = text.replace(/[^A-Za-z0-9+/=]/g, "");
  try {
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return new Uint8Array(0);
  }
}

/** RFC 2047 编码的单词解码（`=?UTF-8?B?...?=` / `=?UTF-8?Q?...?=`）。 */
function decodeEncodedWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset: string, kind: string, payload: string) => {
    // 两种编码解出来的都必须是**字节**——base64 直接解字节，
    // quoted-printable 的 =XX 是字节值（之前按字符处理，解出来是乱码）。
    const bytes = kind.toUpperCase() === "B"
      ? decodeBase64Bytes(payload)
      : latin1Bytes(decodeQuotedPrintable(payload.replace(/_/g, " ")));
    if (bytes.length === 0) return "";
    return decodeBytes(bytes, charset);
  });
}

/** 用指定字符集解码字节。 */
function decodeBytes(bytes: Uint8Array, charset: string): string {
  const name = charset.trim().toLowerCase().replace(/^["']|["']$/g, "");
  if (!name || name === "utf-8" || name === "utf8") return new TextDecoder("utf-8").decode(bytes);
  try {
    return new TextDecoder(name).decode(bytes);
  } catch {
    // 不认识的字符集：先按 UTF-8 试，坏了再退回 latin1（至少不是乱码方块）
    const utf8 = new TextDecoder("utf-8").decode(bytes);
    return utf8.includes("�") ? new TextDecoder("latin1").decode(bytes) : utf8;
  }
}

/** 剥 HTML 标签，保留可读文字。 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 拆出一个 multipart 的各个子部分。 */
function splitMultipart(body: string, boundary: string): string[] {
  const marker = `--${boundary}`;
  const parts: string[] = [];
  const chunks = body.split(marker);
  for (const chunk of chunks) {
    if (!chunk.trim() || chunk.trim() === "--") continue;
    parts.push(chunk.replace(/^\r?\n/, "").replace(/\r?\n$/, ""));
  }
  return parts;
}

/** 解析一个部分（可能是 multipart，递归）。 */
function parsePart(raw: string, depth = 0): Part[] {
  if (depth > 5) return [];
  const { head, body } = splitHeadBody(raw);
  const headers = parseHeaders(head);
  const contentType = headerValue(headers, "content-type") || "text/plain";
  const params = contentTypeParams(contentType);
  const mime = contentType.split(";")[0].trim().toLowerCase();

  if (mime.startsWith("multipart/") && params.boundary) {
    const out: Part[] = [];
    for (const child of splitMultipart(body, params.boundary)) {
      out.push(...parsePart(child, depth + 1));
    }
    return out;
  }

  return [{ headers, body, raw: new TextEncoder().encode(body) }];
}

/** 解一个部分的正文。 */
function partText(part: Part): string {
  const encoding = headerValue(part.headers, "content-transfer-encoding").trim().toLowerCase();
  const contentType = headerValue(part.headers, "content-type") || "text/plain";
  const charset = contentTypeParams(contentType).charset || "utf-8";
  if (encoding === "base64") {
    const bytes = decodeBase64Bytes(part.body);
    return bytes.length ? decodeBytes(bytes, charset) : "";
  }
  if (encoding === "quoted-printable") {
    return decodeBytes(latin1Bytes(decodeQuotedPrintable(part.body)), charset);
  }
  return decodeBytes(new TextEncoder().encode(part.body), charset);
}

/**
 * 解析 `.eml` 文件。
 *
 * 任何一处坏掉都不该让整封邮件消失：拿不到正文就至少给标题，
 * 拿不到标题就用「（无主题）」。
 */
export function parseEml(raw: string): ParsedEmail {
  const { head, body } = splitHeadBody(raw);
  const headers = parseHeaders(head);
  const from = decodeEncodedWords(headerValue(headers, "from"));
  const to = decodeEncodedWords(headerValue(headers, "to"));
  const subject = decodeEncodedWords(headerValue(headers, "subject")) || "（无主题）";
  const date = headerValue(headers, "date");
  const messageId = headerValue(headers, "message-id");

  const parts = parsePart(raw);
  let text = "";
  let html = "";
  const attachments: string[] = [];

  for (const part of parts) {
    const contentType = (headerValue(part.headers, "content-type") || "text/plain").toLowerCase();
    const mime = contentType.split(";")[0].trim();
    const disposition = headerValue(part.headers, "content-disposition").toLowerCase();
    const filenameMatch = /filename\s*=\s*("([^"]*)"|([^;]+))/i.exec(contentType + ";" + disposition);
    const filename = filenameMatch ? (filenameMatch[2] ?? filenameMatch[3] ?? "").trim() : "";

    if (disposition.includes("attachment") || (mime !== "text/plain" && mime !== "text/html")) {
      if (filename) attachments.push(filename);
      continue;
    }
    if (mime === "text/html") {
      if (!html) html = partText(part);
    } else if (!text) {
      text = partText(part);
    }
  }

  if (!text && html) text = htmlToText(html);
  if (!text) {
    // 兜底：把整封邮件当纯文本看一遍，至少能捞到正文
    const rawBody = body.trim();
    text = rawBody && !rawBody.startsWith("--") ? htmlToText(rawBody) : "";
  }

  return { from, to, subject, date, messageId, text: text.trim(), attachments };
}
