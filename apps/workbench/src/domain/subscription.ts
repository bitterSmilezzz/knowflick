/**
 * 订阅源（主动收集 · Layer 1 入口）
 * 对应 DATA_MODEL_SECOND_BRAIN.md §4 的 `subscriptions` 表：
 * `type` 取值 'rss' | 'github_release' | 'github_trending' | 'tech_board'。
 *
 * 这里只做纯函数：解析 feed、算下次到期、生成去重键。
 * 真正的网络抓取走宿主已有的 `fetch_clip`（Rust reqwest，有 URL 白名单与体积上限）。
 */

export type SubscriptionType = "rss" | "github_release" | "github_trending" | "tech_board";

export interface Subscription {
  id: string;
  type: SubscriptionType;
  title: string;
  targetUrl: string;
  intervalMinutes: number;
  lastPolledAt: number | null;
  isActive: boolean;
  createdAt: number;
}

export interface FeedItem {
  /** 稳定标识，用于同一订阅内去重（RSS 用 guid/link，GitHub 用 tag_name）。 */
  key: string;
  title: string;
  url: string;
  /** 正文：RSS 优先 content:encoded / description；GitHub 用 release body。 */
  text: string;
  publishedAt: number | null;
}

export const SUBSCRIPTION_TYPE_LABELS: Record<SubscriptionType, string> = {
  rss: "RSS / Atom 订阅",
  github_release: "GitHub 仓库 Release",
  github_trending: "GitHub 趋势仓库",
  tech_board: "技术社区热榜",
};

/** 每种订阅类型期望的目标串形状（用于输入校验与提示）。 */
export const SUBSCRIPTION_TARGET_HINTS: Record<SubscriptionType, string> = {
  rss: "https://example.com/feed.xml",
  github_release: "owner/repo，例如 rust-lang/rust",
  github_trending: "语言，例如 rust（留空表示全部语言）",
  tech_board: "板块 URL",
};

export const DEFAULT_INTERVAL_MINUTES = 360;

/** 把用户输入的目标串按类型归一化；非法输入抛错而不是静默接受。 */
export function normalizeTarget(type: SubscriptionType, raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("请填写订阅目标");
  switch (type) {
    case "rss":
    case "tech_board": {
      let parsed: URL;
      try {
        parsed = new URL(trimmed);
      } catch {
        throw new Error("订阅地址需要是完整的 http/https 链接");
      }
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("订阅地址只支持 http/https");
      if (parsed.username || parsed.password) throw new Error("订阅地址里不能带账号密码");
      return parsed.toString();
    }
    case "github_release": {
      const cleaned = trimmed.replace(/^https?:\/\/github\.com\//i, "").replace(/\/+$/, "");
      const parts = cleaned.split("/").filter(Boolean);
      if (parts.length !== 2) throw new Error("GitHub 仓库请写成 owner/repo");
      if (!/^[\w.-]+$/.test(parts[0]) || !/^[\w.-]+$/.test(parts[1])) throw new Error("仓库名含有非法字符");
      return `${parts[0]}/${parts[1]}`;
    }
    case "github_trending": {
      if (!/^[a-z0-9+#.-]*$/i.test(trimmed)) throw new Error("语言名只能包含字母、数字与 + # . -");
      return trimmed.toLowerCase();
    }
    default:
      return trimmed;
  }
}

/** 该订阅现在是否到了该抓取的时间。 */
export function isDue(sub: Subscription, now = Date.now()): boolean {
  if (!sub.isActive) return false;
  if (!sub.lastPolledAt) return true;
  return now - sub.lastPolledAt >= sub.intervalMinutes * 60_000;
}

/** 下一次到期时间戳（未激活或从未抓取时返回 null，表示「随时可抓」）。 */
export function nextPollAt(sub: Subscription): number | null {
  if (!sub.isActive) return null;
  if (!sub.lastPolledAt) return null;
  return sub.lastPolledAt + sub.intervalMinutes * 60_000;
}

function decodeEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function stripTags(raw: string): string {
  return decodeEntities(raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

function firstTag(block: string, tag: string): string | null {
  // 允许带 CDATA，也允许带属性（例如 <link href="..."/>）。
  const cdata = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, "i").exec(block);
  if (cdata) return stripTags(cdata[1]);
  const plain = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  if (plain) return stripTags(plain[1]);
  return null;
}

function parseDate(raw: string | null): number | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 解析 RSS 2.0 / Atom。
 *
 * 用手写正则而不是引入 XML 解析器：feed 结构简单、且这里必须零依赖，
 * 解析失败的条目跳过而不是整体报错——一个坏条目不该让整次订阅抓取作废。
 */
export function parseFeed(xml: string, baseUrl = ""): FeedItem[] {
  const items: FeedItem[] = [];
  // 真实 feed 里的链接常是相对的（/posts/2）。直接存成素材的「原文链接」，
  // 用户点开会指向无效地址。用 feed 自身的地址补全。
  const base = baseUrl ? safeBase(baseUrl) : null;

  // RSS 2.0
  const rssBlocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  for (const block of rssBlocks) {
    const title = firstTag(block, "title");
    const rawLink = firstTag(block, "link") ?? firstTag(block, "guid");
    const link = rawLink ? absolutize(rawLink, base) : null;
    if (!title || !link) continue;
    const guid = firstTag(block, "guid");
    const body =
      firstTag(block, "content:encoded") ??
      firstTag(block, "description") ??
      firstTag(block, "summary") ??
      "";
    const publishedAt = parseDate(firstTag(block, "pubDate") ?? firstTag(block, "published"));
    items.push({ key: guid ?? link, title, url: link, text: body, publishedAt });
  }

  // Atom
  if (items.length === 0) {
    const entries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
    for (const block of entries) {
      const title = firstTag(block, "title");
      const id = firstTag(block, "id");
      const href = /<link[^>]*href="([^"]+)"/i.exec(block)?.[1] ?? null;
      const link = href ? absolutize(decodeEntities(href), base) : id;
      if (!title || !link) continue;
      const body = firstTag(block, "content") ?? firstTag(block, "summary") ?? "";
      const publishedAt = parseDate(firstTag(block, "updated") ?? firstTag(block, "published"));
      items.push({ key: id ?? link, title, url: link, text: body, publishedAt });
    }
  }

  return items;
}

/** 取 feed 地址的 origin（协议 + 主机 + 端口），用于补全相对链接。 */
function safeBase(feedUrl: string): string | null {
  try {
    const url = new URL(feedUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** 把相对链接补成绝对链接；已经是绝对的、或补不了就原样返回。 */
function absolutize(link: string, base: string | null): string {
  const trimmed = link.trim();
  if (!trimmed || !base) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return `${base.split(":")[0]}:${trimmed}`;
  if (trimmed.startsWith("/")) return `${base}${trimmed}`;
  return `${base}/${trimmed}`;
}

interface GithubRelease {
  tag_name?: string;
  name?: string | null;
  body?: string | null;
  html_url?: string;
  published_at?: string | null;
}

/** 解析 GitHub `/repos/{owner}/{repo}/releases` 的 JSON 数组。 */
export function parseGithubReleases(json: string, repo: string): FeedItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("GitHub 返回的不是合法 JSON，可能触发了速率限制");
  }
  if (!Array.isArray(parsed)) throw new Error("GitHub 返回结构不是 Release 数组");

  const items: FeedItem[] = [];
  for (const entry of parsed as GithubRelease[]) {
    const tag = entry?.tag_name?.trim();
    if (!tag) continue;
    const title = entry?.name?.trim() || tag;
    items.push({
      key: `${repo}@${tag}`,
      title: `${repo} ${title}`,
      url: entry?.html_url ?? `https://github.com/${repo}/releases/tag/${tag}`,
      text: entry?.body?.trim() || `${repo} 发布 ${tag}`,
      publishedAt: parseDate(entry?.published_at ?? null),
    });
  }
  return items;
}

interface GithubRepo {
  full_name?: string;
  html_url?: string;
  description?: string | null;
  stargazers_count?: number;
  language?: string | null;
}

/** 解析 GitHub search / trending 结果里的仓库数组。 */
export function parseGithubTrending(json: string): FeedItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("GitHub 返回的不是合法 JSON");
  }
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { items?: unknown }).items)
      ? ((parsed as { items: unknown[] }).items)
      : null;
  if (!list) throw new Error("GitHub 返回结构里没有仓库列表");

  const items: FeedItem[] = [];
  for (const entry of list as GithubRepo[]) {
    const fullName = entry?.full_name?.trim();
    if (!fullName) continue;
    const stars = typeof entry.stargazers_count === "number" ? entry.stargazers_count : null;
    const meta = [
      entry?.language ? `语言 ${entry.language}` : null,
      stars !== null ? `${stars} stars` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    items.push({
      key: fullName,
      title: fullName,
      url: entry?.html_url ?? `https://github.com/${fullName}`,
      text: [entry?.description ?? "", meta].filter(Boolean).join("\n\n"),
      publishedAt: null,
    });
  }
  return items;
}

/** 按订阅类型决定用哪个解析器。 */
export function parseSubscriptionPayload(
  sub: Pick<Subscription, "type" | "targetUrl">,
  payload: string
): FeedItem[] {
  switch (sub.type) {
    case "rss":
    case "tech_board":
      return parseFeed(payload, sub.targetUrl);
    case "github_release":
      return parseGithubReleases(payload, sub.targetUrl);
    case "github_trending":
      return parseGithubTrending(payload);
    default:
      return [];
  }
}

/** 各类型实际要请求的 URL（GitHub 走公开 API，其余原样）。 */
export function requestUrlFor(sub: Pick<Subscription, "type" | "targetUrl">): string {
  switch (sub.type) {
    case "github_release":
      return `https://api.github.com/repos/${sub.targetUrl}/releases?per_page=10`;
    case "github_trending":
      return sub.targetUrl
        ? `https://api.github.com/search/repositories?q=language:${encodeURIComponent(
            sub.targetUrl
          )}&sort=stars&order=desc&per_page=10`
        : "https://api.github.com/search/repositories?q=stars:%3E10000&sort=stars&order=desc&per_page=10";
    default:
      return sub.targetUrl;
  }
}

/** 订阅创建时的默认值。 */
export function makeSubscription(input: {
  type: SubscriptionType;
  title: string;
  target: string;
  intervalMinutes?: number;
}): Subscription {
  const title = input.title.trim();
  if (!title) throw new Error("请填写订阅名称");
  const interval = input.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES;
  if (!Number.isFinite(interval) || interval < 15) throw new Error("轮询间隔至少 15 分钟");
  return {
    id: crypto.randomUUID(),
    type: input.type,
    title,
    targetUrl: normalizeTarget(input.type, input.target),
    intervalMinutes: Math.round(interval),
    lastPolledAt: null,
    isActive: true,
    createdAt: Date.now(),
  };
}

/**
 * 把解析出的条目转成待入库的素材，并按来源链接去重。
 *
 * 去重键用 `url`：同一条订阅反复抓取时，已经存在的条目不该再进收件箱。
 * 返回的 `skipped` 让界面能说清「这次为什么只新增了 N 条」。
 */
export function itemsToMaterials(
  items: FeedItem[],
  existingUrls: Iterable<string>,
  sub: Pick<Subscription, "id" | "title" | "type">,
  now = Date.now()
): { materials: Array<{ title: string; text: string; url: string; metadataJson: string }>; skipped: number } {
  const known = new Set<string>();
  for (const url of existingUrls) {
    const trimmed = (url || "").trim();
    if (trimmed) known.add(trimmed);
  }

  const materials: Array<{ title: string; text: string; url: string; metadataJson: string }> = [];
  let skipped = 0;
  for (const item of items) {
    const url = item.url.trim();
    if (!url) {
      skipped++;
      continue;
    }
    if (known.has(url)) {
      skipped++;
      continue;
    }
    known.add(url);
    materials.push({
      title: item.title.trim() || url,
      text: (item.text || item.title).trim() || url,
      url,
      metadataJson: JSON.stringify({
        subscriptionId: sub.id,
        subscriptionTitle: sub.title,
        subscriptionType: sub.type,
        fetchedAt: now,
      }),
    });
  }
  return { materials, skipped };
}
