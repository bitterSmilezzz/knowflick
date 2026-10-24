import type { KnowledgeCard, ScienceLink } from "./card";

export function attributeImportedCards(
  sourceURL: string,
  pageURL: string,
  siteName: string,
  cards: KnowledgeCard[],
): KnowledgeCard[] {
  const sourceLink = { title: siteName || pageURL, url: pageURL };
  const urls = new Set([sourceURL, sourceLink.url]);
  return cards.map((card) => ({
    ...card,
    source: "imported" as const,
    links: [sourceLink, ...card.links.filter((link) => !urls.has(link.url))],
  }));
}

const MAX_TEXT_CHARACTERS = 4000;
const SCAN_STOP_CHARACTERS = MAX_TEXT_CHARACTERS * 3;
const MIN_LINE_CHARACTERS = 4;
const JUNK_TOKEN_MAX_LINE_CHARACTERS = 48;
const META_LINE_CHARACTERS = 160;
// 嗅探 `<meta charset>` 的窗口（字节）。三处实现必须一致：这里、Kotlin 的 `WebClipEngine.kt`
// 与 Tauri 壳的 `http.rs`；`tools/check_clip_parity.py` 会比对。规范要求编码声明落在前 1024 字节内。
const META_SNIFF_BYTES = 1024;

const DROP_TAGS = new Set([
  "script", "style", "noscript", "template", "svg", "canvas", "iframe",
  "video", "audio", "object", "embed", "track", "map", "form", "input",
  "select", "option", "textarea", "button", "label", "nav", "header",
  "footer", "aside", "dialog", "head",
]);
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "param", "source", "track", "wbr",
]);
const BLOCK_TAGS = new Set([
  "p", "div", "li", "ul", "ol", "dl", "dd", "dt", "h1", "h2", "h3", "h4",
  "h5", "h6", "article", "section", "main", "aside", "blockquote", "pre",
  "figure", "figcaption", "table", "thead", "tbody", "tr", "td", "th", "br",
]);
const SEMANTIC = new Set(["article", "main"]);
const HINTS = ["articlebody", "article-body", "article-content", "post-content", "entry-content", "rich_text", "rich-text", "markdown-body", "main-content", "article", "content", "post", "entry", "story"];
const VETOES = ["comment", "sidebar", "side-bar", "footer", "header", "nav", "menu", "share", "related", "recommend", "promo", "advert", "breadcrumb", "pagination", "search", "toolbar", "tags", "reply", "vote", "toc"];
const JUNK = ["版权所有", "保留所有权利", "未经授权", "未经许可", "转载至", "文章来源", "登录查看", "扫码下载", "app下载", "关注我们", "扫码关注", "分享到", "打赏", "相关推荐", "相关阅读", "下一篇", "上一篇", "返回列表", "返回顶部", "阅读原文", "查看原文", "订阅本文", "评论区", "cookie", "隐私政策", "用户协议", "登录", "注册", "广告", "javascript", "copyright", "all rights reserved", "privacy", "terms of", "sign in", "log in", "subscribe", "newsletter", "advertisement", "enable javascript"];
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", thinsp: " ", ensp: " ", emsp: " ",
  copy: "©", reg: "®", trade: "™", hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", middot: "·", bull: "•", deg: "°", plusmn: "±",
  times: "×", divide: "÷", frac12: "½", sect: "§", eacute: "é", egrave: "è", agrave: "à",
  ccedil: "ç", uuml: "ü", ouml: "ö", auml: "ä", szlig: "ß",
};

export interface ClipLink {
  scheme: string;
  userInfo: string | null;
  host: string;
  port: string;
  rest: string;
  origin: string;
  absolute: string;
}

export interface ClipDigest {
  sourceURL: string;
  pageURL: string;
  title: string;
  siteName: string;
  description: string;
  text: string;
  truncated: boolean;
  aiNote: string;
  sourceLink: ScienceLink;
  attributing: (cards: KnowledgeCard[]) => KnowledgeCard[];
}

export class ClipError extends Error {
  constructor(
    readonly code: string,
    readonly detail = "",
  ) {
    super(detail ? `${code}：${detail}` : code);
  }
}

export function validatedLink(raw: string): ClipLink {
  const trimmed = raw.trim();
  if (!trimmed) throw new ClipError("链接为空");
  const explicit = explicitNonHttp(trimmed);
  if (explicit) throw new ClipError("只支持 http/https", explicit);
  const candidate = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  const link = parseLink(candidate);
  if (!link) throw new ClipError("无法识别这个链接");
  if (link.scheme !== "http" && link.scheme !== "https") throw new ClipError("只支持 http/https", link.scheme);
  if (!link.host) throw new ClipError("链接缺少域名");
  if (link.userInfo) throw new ClipError("链接里带有账号密码，已拒绝");
  return link;
}

function explicitNonHttp(text: string): string | null {
  const colon = text.indexOf(":");
  if (colon <= 0) return null;
  const head = text.slice(0, colon);
  if (head.includes("/")) return null;
  if (![...head].every((ch) => /[A-Za-z0-9+.-]/.test(ch))) return null;
  const tail = text.slice(colon + 1);
  if (tail.startsWith("//")) return null;
  if (tail && /\d/.test(tail[0] ?? "") && (head.includes(".") || head.toLowerCase() === "localhost")) return null;
  const lowered = head.toLowerCase();
  return lowered === "http" || lowered === "https" ? null : lowered;
}

export function parseLink(text: string): ClipLink | null {
  const schemeEnd = text.indexOf("://");
  if (schemeEnd <= 0) return null;
  const scheme = text.slice(0, schemeEnd).toLowerCase();
  if (!scheme || !/[A-Za-z]/.test(scheme[0] ?? "")) return null;
  const start = schemeEnd + 3;
  let authorityEnd = text.length;
  for (let k = start; k < text.length; k += 1) {
    if (text[k] === "/" || text[k] === "?" || text[k] === "#") {
      authorityEnd = k;
      break;
    }
  }
  const authority = text.slice(start, authorityEnd);
  const at = authority.lastIndexOf("@");
  const userInfo = at >= 0 ? authority.slice(0, at) : null;
  const hostPort = at >= 0 ? authority.slice(at + 1) : authority;
  const colon = hostPort.lastIndexOf(":");
  const host = (colon >= 0 ? hostPort.slice(0, colon) : hostPort).toLowerCase();
  const port = colon >= 0 ? hostPort.slice(colon + 1) : "";
  const rest = text.slice(authorityEnd);
  const origin = `${scheme}://${host}${port ? `:${port}` : ""}`;
  return { scheme, userInfo, host, port, rest, origin, absolute: origin + rest };
}

export function firstURL(text: string): string | null {
  const tokens = text.split(/[ \t\n\r<>"'()[\],;{}|]/);
  const trailing = new Set([".", "。", "，", ",", "、", "！", "?", "”", "»", ")", "]", "}", ":"]);
  for (let token of tokens) {
    while (token && trailing.has(token.at(-1) ?? "")) token = token.slice(0, -1);
    const lowered = token.toLowerCase();
    if (lowered.startsWith("http://") || lowered.startsWith("https://")) return token;
  }
  return null;
}

export function resolveHref(href: string, base: ClipLink): string {
  const trimmed = href.trim();
  if (!trimmed) return base.absolute;
  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith("http://") || lowered.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("//")) return `${base.scheme}:${trimmed}`;
  if (trimmed.startsWith("/")) return base.origin + trimmed;
  const queryCut = [...trimmed].findIndex((ch) => ch === "?" || ch === "#");
  const pathPart = queryCut < 0 ? trimmed : trimmed.slice(0, queryCut);
  const suffix = queryCut < 0 ? "" : trimmed.slice(queryCut);
  const baseDir = base.rest.includes("/") ? base.rest.slice(0, base.rest.lastIndexOf("/")) : "";
  return `${base.origin}${baseDir}/${pathPart}${suffix}`;
}

export function decodeEntities(raw: string): string {
  if (!raw.includes("&")) return raw;
  let out = "";
  let i = 0;
  while (i < raw.length) {
    if (raw[i] !== "&") {
      const code = raw.charCodeAt(i);
      if ((code >= 0x20 || raw[i] === "\n") && !invisible(raw[i] ?? "")) out += raw[i];
      i += 1;
      continue;
    }
    let j = i + 1;
    let body = "";
    let terminated = false;
    while (j < raw.length && body.length < 12) {
      const b = raw[j] ?? "";
      if (b === ";") {
        terminated = true;
        break;
      }
      if (b === "&" || b === "<" || b === " " || b === "\n") break;
      body += b;
      j += 1;
    }
    if (!terminated || !body) {
      out += "&";
      i += 1;
      continue;
    }
    if (body.startsWith("#")) {
      const hex = body.length > 1 && (body[1] === "x" || body[1] === "X");
      const digits = hex ? body.slice(2) : body.slice(1);
      const value = Number.parseInt(digits, hex ? 16 : 10);
      if (Number.isFinite(value) && (value === 0x0a || value >= 0x20) && value <= 0x10ffff) {
        const decoded = String.fromCodePoint(value);
        if (!invisible(decoded)) out += decoded;
      }
      i = j + 1;
      continue;
    }
    const key = body.toLowerCase();
    if (key === "shy") {
      i = j + 1;
      continue;
    }
    const mapped = NAMED[key];
    if (mapped) {
      out += mapped;
      i = j + 1;
      continue;
    }
    out += "&";
    i += 1;
  }
  return out;
}

export function singleLine(raw: string): string {
  const collapsed = raw.replaceAll("\u00A0", " ").trim().split(/\s+/).join(" ");
  return collapsed.slice(0, META_LINE_CHARACTERS);
}

export function charsetFromContentType(contentType: string | null | undefined): string | null {
  return contentType ? charsetValue(contentType) : null;
}

export function charsetFromHead(head: string): string | null {
  for (const candidate of head.toLowerCase().split("meta")) {
    const value = charsetValue(candidate);
    if (value) return value;
  }
  return null;
}

function charsetValue(text: string): string | null {
  const lowered = text.toLowerCase();
  const at = lowered.indexOf("charset");
  if (at < 0) return null;
  let i = at + "charset".length;
  const skip = () => {
    while (i < lowered.length && (lowered[i] === " " || lowered[i] === "\t" || lowered[i] === "\n")) i += 1;
  };
  skip();
  if (i >= lowered.length || lowered[i] !== "=") return null;
  i += 1;
  skip();
  if (i >= lowered.length) return null;
  const quote = lowered[i] === "\"" || lowered[i] === "'" ? lowered[i] : null;
  if (quote) i += 1;
  let value = "";
  while (i < lowered.length) {
    const c = lowered[i] ?? "";
    if (quote) {
      if (c === quote) break;
    } else if (";,\"'> \t\n".includes(c)) break;
    value += c;
    i += 1;
  }
  return value.trim() || null;
}

export function decodeHTML(bytes: Uint8Array, contentType: string | null): string {
  const head = new TextDecoder("iso-8859-1").decode(bytes.subarray(0, Math.min(META_SNIFF_BYTES, bytes.length)));
  const name = charsetFromContentType(contentType) ?? charsetFromHead(head);
  if (name) {
    try {
      return new TextDecoder(name).decode(bytes);
    } catch {
      /* fall through */
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

export function digest(html: string, sourceURL: string): ClipDigest | null {
  const link = validatedLink(sourceURL.includes("://") ? sourceURL : `https://${sourceURL}`);
  return digestLink(html, link);
}

function digestLink(html: string, base: ClipLink): ClipDigest | null {
  const bytes = new TextEncoder().encode(html);
  if (bytes.length > 4_000_000) return null;
  const out = new TextCollector(SCAN_STOP_CHARACTERS);
  const frames: string[] = [];
  const open: Candidate[] = [];
  const candidates: Candidate[] = [];
  let dropDepth = 0;
  let capturingTitle = false;
  let rawTitle = "";
  let canonical: string | null = null;
  let ogTitle = "";
  let siteName = "";
  let pageDescription = "";
  let i = 0;
  const decoder = new TextDecoder("utf-8");
  while (i < bytes.length) {
    if (bytes[i] !== 0x3c) {
      let end = i;
      while (end < bytes.length && bytes[end] !== 0x3c) end += 1;
      const chunk = decodeEntities(decoder.decode(bytes.subarray(i, end)));
      if (capturingTitle) {
        const piece = singleLine(chunk);
        if (piece.length > rawTitle.length) rawTitle = piece;
      } else if (dropDepth === 0) out.append(chunk);
      i = end;
      continue;
    }
    if (startsWith(bytes, i, "<!--")) {
      const close = indexOfByte(bytes, i + 4, 0x3e);
      if (close < 0) break;
      i = close + 1;
      continue;
    }
    if (startsWith(bytes, i, "<!") || startsWith(bytes, i, "<?")) {
      const close = indexOfByte(bytes, i + 2, 0x3e);
      if (close < 0) break;
      i = close + 1;
      continue;
    }
    const tag = parseTag(bytes, i, decoder);
    if (!tag) break;
    i = tag.nextIndex;
    if (out.hitLimit) break;
    if (tag.isClosing) {
      if (tag.name === "title") capturingTitle = false;
      const depth = frames.lastIndexOf(tag.name);
      if (depth >= 0) {
        while (frames.length > depth) {
          const popped = frames.pop() ?? "";
          if (DROP_TAGS.has(popped)) dropDepth -= 1;
          if (open.at(-1)?.tag === popped) {
            const top = open.pop();
            if (top && !top.vetoed) {
              top.end = out.count;
              candidates.push(top);
            }
          }
        }
      }
      continue;
    }
    const isVoid = VOID_TAGS.has(tag.name);
    if (!isVoid) frames.push(tag.name);
    if (DROP_TAGS.has(tag.name) && !isVoid && !tag.selfClosing) dropDepth += 1;
    if (tag.name === "title" && !isVoid && !tag.selfClosing) {
      capturingTitle = true;
      continue;
    }
    if (tag.name === "meta" || tag.name === "link") {
      const rel = (tag.attributes.rel ?? "").toLowerCase();
      if (tag.name === "link" && rel === "canonical" && tag.attributes.href) canonical = resolveHref(tag.attributes.href, base);
      const key = (tag.attributes.property ?? tag.attributes.name ?? "").toLowerCase();
      const value = tag.attributes.content ?? "";
      if (key === "og:title" && value.length > ogTitle.length) ogTitle = value;
      if (key === "og:site_name" && !siteName) siteName = value;
      if ((key === "og:description" || key === "description" || key === "twitter:description") && value.length > pageDescription.length) {
        pageDescription = value;
      }
      continue;
    }
    if (BLOCK_TAGS.has(tag.name)) out.newline();
    if (!isVoid && !tag.selfClosing) {
      const lowered = `${tag.attributes.id ?? ""} ${tag.attributes.class ?? ""}`.toLowerCase();
      if (SEMANTIC.has(tag.name) || HINTS.some((hint) => lowered.includes(hint))) {
        open.push({ tag: tag.name, start: out.count, end: 0, vetoed: VETOES.some((word) => lowered.includes(word)) });
      }
    }
  }
  while (open.length) {
    const top = open.pop();
    if (top && !top.vetoed) {
      top.end = out.count;
      candidates.push(top);
    }
  }
  const finalized = finalizeText(chooseText(candidates, out.text));
  if (!finalized.text) return null;
  const title = singleLine(rawTitle).length >= singleLine(ogTitle).length ? singleLine(rawTitle) : singleLine(ogTitle);
  const site = singleLine(siteName) || base.host.replace(/^www\./, "");
  const pageURL = canonical ?? base.absolute;
  const sourceURL = base.absolute;
  const sourceLink = { title: site || pageURL, url: pageURL };
  const text = finalized.text;
  const description = singleLine(pageDescription);
  return {
    sourceURL,
    pageURL,
    title,
    siteName: site,
    description,
    text,
    truncated: finalized.truncated,
    get aiNote() {
      return `${title ? `标题：${title}\n` : ""}${description ? `网页摘要：${description}\n` : ""}来源：${pageURL}\n\n${text}`;
    },
    sourceLink,
    attributing(cards) {
      return attributeImportedCards(sourceURL, pageURL, site, cards);
    },
  };
}

interface Candidate {
  tag: string;
  start: number;
  end: number;
  vetoed: boolean;
}

function chooseText(candidates: Candidate[], full: string): string {
  const best = candidates.reduce<Candidate | null>((winner, item) => {
    const length = Math.max(0, item.end - item.start);
    const bestLength = winner ? Math.max(0, winner.end - winner.start) : -1;
    return length > bestLength ? item : winner;
  }, null);
  if (!best) return full;
  const length = Math.max(0, best.end - best.start);
  if (length <= 0) return full;
  const boosted = length * (SEMANTIC.has(best.tag) ? 2 : 1);
  if (boosted * 2 < full.length) return full;
  return full.slice(Math.min(best.start, full.length), Math.min(best.end, full.length));
}

function finalizeText(raw: string): { text: string; truncated: boolean } {
  const kept = raw.split(/[\n\r]/).map((line) => line.trim()).filter((line) => line.length >= MIN_LINE_CHARACTERS && !isJunk(line));
  let result = "";
  let used = 0;
  for (const line of kept) {
    const cost = line.length + (result ? 1 : 0);
    if (used + cost > MAX_TEXT_CHARACTERS) {
      return { text: result || line.slice(0, MAX_TEXT_CHARACTERS), truncated: true };
    }
    result = result ? `${result}\n${line}` : line;
    used += cost;
  }
  return { text: result, truncated: false };
}

function isJunk(line: string): boolean {
  if (line.length > JUNK_TOKEN_MAX_LINE_CHARACTERS) return false;
  const lowered = line.toLowerCase();
  return JUNK.some((token) => lowered.includes(token));
}

class TextCollector {
  private buffer = "";
  count = 0;
  hitLimit = false;
  private pendingSpace = false;
  private sawNewline = false;
  constructor(private readonly limit: number) {}
  get text() { return this.buffer; }
  append(chunk: string) {
    for (const c of chunk) {
      if (c === "\n") {
        this.sawNewline = true;
        this.pendingSpace = true;
        continue;
      }
      if (c === " " || c === "\t" || c === "\r" || c === "\u000C" || c === "\u00A0") {
        this.pendingSpace = true;
        continue;
      }
      const code = c.charCodeAt(0);
      if (code <= 0x1f) continue;
      if (invisible(c)) continue;
      this.flushSpace();
      if (this.count >= this.limit) {
        this.hitLimit = true;
        return;
      }
      this.buffer += c;
      this.count += 1;
    }
  }
  newline() {
    this.flushSpace();
    if (this.count >= this.limit) {
      this.hitLimit = true;
      return;
    }
    if (this.buffer.endsWith("\n")) return;
    this.buffer += "\n";
    this.count += 1;
    this.sawNewline = false;
    this.pendingSpace = false;
  }
  private flushSpace() {
    if (!this.pendingSpace) return;
    this.pendingSpace = false;
    const separator = this.sawNewline ? "\n" : " ";
    this.sawNewline = false;
    if (this.count === 0 || this.buffer.endsWith("\n")) return;
    if (this.count >= this.limit) {
      this.hitLimit = true;
      return;
    }
    this.buffer += separator;
    this.count += 1;
  }
}

function invisible(c: string): boolean {
  const code = c.charCodeAt(0);
  return code === 0xad || (code >= 0x200b && code <= 0x200f) || code === 0x2028 || code === 0x2029 || (code >= 0x202a && code <= 0x202e) || code === 0xfeff;
}

interface ParsedTag {
  name: string;
  attributes: Record<string, string>;
  selfClosing: boolean;
  isClosing: boolean;
  nextIndex: number;
}

function parseTag(bytes: Uint8Array, start: number, decoder: TextDecoder): ParsedTag | null {
  let i = start + 1;
  let isClosing = false;
  if (bytes[i] === 0x2f) {
    isClosing = true;
    i += 1;
  }
  if (i >= bytes.length || !asciiLetter(bytes[i] ?? 0)) return null;
  const nameBytes: number[] = [];
  while (i < bytes.length && asciiName(bytes[i] ?? 0)) {
    nameBytes.push(lowerAscii(bytes[i] ?? 0));
    i += 1;
  }
  const name = decoder.decode(Uint8Array.from(nameBytes));
  const attributes: Record<string, string> = {};
  let selfClosing = false;
  while (i < bytes.length) {
    const c = bytes[i] ?? 0;
    if (c === 0x3e) return { name, attributes, selfClosing, isClosing, nextIndex: i + 1 };
    if (c === 0x2f) {
      selfClosing = true;
      i += 1;
      continue;
    }
    if (asciiSpace(c)) {
      i += 1;
      continue;
    }
    const keyBytes: number[] = [];
    while (i < bytes.length) {
      const b = bytes[i] ?? 0;
      if (b === 0x3d || b === 0x3e || b === 0x2f || asciiSpace(b)) break;
      keyBytes.push(lowerAscii(b));
      i += 1;
    }
    if (!keyBytes.length) {
      i += 1;
      continue;
    }
    const key = decoder.decode(Uint8Array.from(keyBytes));
    let k = i;
    while (k < bytes.length && asciiSpace(bytes[k] ?? 0)) k += 1;
    if (k >= bytes.length || bytes[k] !== 0x3d) {
      attributes[key] = "";
      i = k > i ? k : i + 1;
      continue;
    }
    i = k + 1;
    while (i < bytes.length && asciiSpace(bytes[i] ?? 0)) i += 1;
    if (i >= bytes.length) break;
    const valueBytes: number[] = [];
    const quote = bytes[i] ?? 0;
    if (quote === 0x22 || quote === 0x27) {
      i += 1;
      while (i < bytes.length && bytes[i] !== quote) {
        valueBytes.push(bytes[i] ?? 0);
        i += 1;
      }
      i += 1;
    } else {
      while (i < bytes.length && bytes[i] !== 0x3e && !asciiSpace(bytes[i] ?? 0)) {
        valueBytes.push(bytes[i] ?? 0);
        i += 1;
      }
    }
    attributes[key] = decodeEntities(decoder.decode(Uint8Array.from(valueBytes)));
  }
  return { name, attributes, selfClosing, isClosing, nextIndex: bytes.length };
}

function startsWith(bytes: Uint8Array, at: number, prefix: string): boolean {
  const p = new TextEncoder().encode(prefix);
  if (at + p.length > bytes.length) return false;
  return p.every((byte, index) => bytes[at + index] === byte);
}

function indexOfByte(bytes: Uint8Array, from: number, target: number): number {
  for (let i = Math.max(0, from); i < bytes.length; i += 1) if (bytes[i] === target) return i;
  return -1;
}

function asciiLetter(b: number): boolean {
  return (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a);
}
function asciiName(b: number): boolean {
  return asciiLetter(b) || (b >= 0x30 && b <= 0x39) || b === 0x2d || b === 0x3a || b === 0x2e;
}
function asciiSpace(v: number): boolean {
  return v === 0x20 || v === 0x09 || v === 0x0a || v === 0x0d || v === 0x0c;
}
function lowerAscii(b: number): number {
  return b >= 0x41 && b <= 0x5a ? b + 32 : b;
}
