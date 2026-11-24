/**
 * 多平台链接嗅探与结构化解析器 (Sniffer Pipeline)
 * 针对 GitHub、Bilibili 与通用网页进行精准嗅探与信息抽取
 */

export interface SniffedResult {
  platform: "github" | "bilibili" | "generic";
  title: string;
  summary: string;
  content: string;
  author?: string;
  sourceUrl: string;
  tags: string[];
}

/**
 * 识别 URL 类型
 */
export function identifyPlatform(url: string): "github" | "bilibili" | "generic" {
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.toLowerCase();
    if (host.includes("github.com")) return "github";
    if (host.includes("bilibili.com") || host.includes("b23.tv")) return "bilibili";
    return "generic";
  } catch {
    return "generic";
  }
}

/**
 * 解析 GitHub URL 中的 owner 和 repo
 */
export function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  try {
    const parsed = new URL(url.trim());
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return { owner: parts[0], repo: parts[1] };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 解析 Bilibili URL 中的 BVID
 */
export function parseBilibiliBvid(url: string): string | null {
  try {
    const match = url.match(/\/video\/(BV[a-zA-Z0-9]+)/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * 将 GitHub API 返回的数据格式化为知识素材
 */
export function formatGitHubPayload(
  url: string,
  apiJson: {
    name?: string;
    description?: string;
    stargazers_count?: number;
    language?: string;
    html_url?: string;
    owner?: { login?: string };
  },
  readmeMarkdown?: string
): SniffedResult {
  const name = apiJson.name || "未命名仓库";
  const desc = apiJson.description || "暂无描述";
  const stars = apiJson.stargazers_count ?? 0;
  const lang = apiJson.language || "开源项目";
  const owner = apiJson.owner?.login || "开发者";

  const title = `GitHub: ${owner}/${name} (★${stars})`;
  const summary = `【${lang}】${desc}`;
  const readmeSnippet = readmeMarkdown
    ? `\n\n### README 节选\n${readmeMarkdown.substring(0, 3000)}`
    : "";

  const content = `# ${name}\n\n> ${desc}\n\n- **作者**: ${owner}\n- **Stars**: ${stars}\n- **主要语言**: ${lang}\n- **地址**: ${apiJson.html_url || url}${readmeSnippet}`;

  const tags = ["GitHub", "开源项目"];
  if (lang && lang !== "开源项目") tags.push(lang);

  return {
    platform: "github",
    title,
    summary,
    content,
    author: owner,
    sourceUrl: apiJson.html_url || url,
    tags,
  };
}

/**
 * 将 Bilibili API 返回的数据格式化为知识素材
 */
export function formatBilibiliPayload(
  url: string,
  apiJson: {
    title?: string;
    desc?: string;
    owner?: { name?: string };
    duration?: number;
    bvid?: string;
  }
): SniffedResult {
  const title = apiJson.title || "Bilibili 视频";
  const desc = apiJson.desc || "暂无简介";
  const author = apiJson.owner?.name || "UP 主";
  const bvid = apiJson.bvid || "";

  const summary = `UP主: ${author} · 简介: ${desc.substring(0, 150)}`;
  const content = `# ${title}\n\n- **UP主**: ${author}\n- **BV号**: ${bvid}\n- **链接**: ${url}\n\n### 视频简介\n${desc}`;

  return {
    platform: "bilibili",
    title: `B站: ${title}`,
    summary,
    content,
    author,
    sourceUrl: url,
    tags: ["B站", "视频学习"],
  };
}
