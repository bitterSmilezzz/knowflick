/**
 * KnowFlick 本地知识库的纯逻辑层（被 server.mjs 与 test.mjs 共用）。
 *
 * 设计边界：
 * - **只读** cards.json；写操作一律进 staged_cards.json，由 App 的「导入归档数据」人工确认。
 *   暂存文件刻意做成与 cards.json 同构的卡片数组，所以**不需要改 App 就能用现有导入界面**。
 * - 零第三方依赖：这台机器在中国大陆网络下，npm 安装与供应链都不可靠，手写反而更稳。
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export const DEFAULT_APP_DIR = path.join(
  process.env.HOME ?? "",
  "Library",
  "Application Support",
  "KnowFlick",
);

const MAX_FILE_BYTES = 64 * 1024 * 1024;

// ---------------------------------------------------------------- 读取

function readJsonArray(file) {
  const stat = fs.statSync(file);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`卡片文件过大（${stat.size} 字节），拒绝读取：${file}`);
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${file} 不是卡片数组`);
  return parsed;
}

export function loadLibrary({ appDir = DEFAULT_APP_DIR, cardsFile, taxonomyFile } = {}) {
  const cardsPath = cardsFile ?? path.join(appDir, "cards.json");
  if (!fs.existsSync(cardsPath)) {
    throw new Error(`找不到卡片库：${cardsPath}。请先在 KnowFlick 里生成/导入内容，或用 --cards 指定路径。`);
  }
  const taxonomyPath =
    taxonomyFile ?? fileURLToPath(new URL("../../shared/assets/taxonomy_map.json", import.meta.url));
  const taxonomy = fs.existsSync(taxonomyPath) ? JSON.parse(fs.readFileSync(taxonomyPath, "utf8")) : { subjects: [], legacyCategoryMap: {} };
  return {
    cards: readJsonArray(cardsPath),
    cardsPath,
    stagedPath: path.join(path.dirname(cardsPath), "staged_cards.json"),
    taxonomy,
    taxonomyPath: fs.existsSync(taxonomyPath) ? taxonomyPath : null,
  };
}

// 每次请求只 stat；内容或文件身份变化时才重新解析与构建索引。
export function createLibraryReader(options = {}) {
  const cardsPath = options.cardsFile ?? path.join(options.appDir ?? DEFAULT_APP_DIR, "cards.json");
  const taxonomyPath = options.taxonomyFile ?? fileURLToPath(new URL("../../shared/assets/taxonomy_map.json", import.meta.url));
  const stamp = (file, optional = false) => {
    try {
      const stat = fs.statSync(file, { bigint: true });
      return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
    } catch (error) {
      if (optional && error.code === "ENOENT") return "missing";
      throw error;
    }
  };
  const version = () => `${stamp(cardsPath)}|${stamp(taxonomyPath, true)}`;
  let cached;
  let cachedVersion;
  return () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = version();
      if (cached && before === cachedVersion) return cached;
      const next = loadLibrary({ ...options, cardsFile: cardsPath, taxonomyFile: taxonomyPath });
      if (before !== version()) continue;
      // 失败不更新版本；下次请求会重试，不会悄悄返回旧数据。
      cached = next;
      cachedVersion = before;
      return cached;
    }
    throw new Error("卡库正在更新，请重试");
  };
}

// ---------------------------------------------------------------- 学科派生

export function indexTaxonomy(taxonomy) {
  const subjects = new Map();
  for (const subject of taxonomy.subjects ?? []) {
    subjects.set(subject.slug, {
      name: subject.name,
      tracks: subject.tracks ?? [],
      branches: new Map((subject.branches ?? []).map((branch) => [branch.slug, branch.name])),
    });
  }
  return { subjects, legacy: taxonomy.legacyCategoryMap ?? {}, levels: taxonomy.levels ?? {} };
}

/** 显式学科字段优先，缺失时按旧 category 派生（与双端 SubjectRegistry 同一规则） */
export function deriveTaxonomy(card, index) {
  const mapping = index.legacy[card.category ?? ""] ?? {};
  const subject = card.subject ?? mapping.subject ?? null;
  return {
    subject,
    branch: card.branch ?? mapping.branch ?? null,
    level: typeof card.level === "number" ? card.level : null,
    track: card.track ?? mapping.track ?? null,
    orderKey: card.orderKey ?? null,
  };
}

export function subjectName(index, slug) {
  if (!slug) return "未分级";
  return index.subjects.get(slug)?.name ?? slug;
}

export function levelName(index, level) {
  if (typeof level !== "number") return "未分级";
  const name = index.levels[String(level)];
  return name ? `L${level} ${name}` : `L${level}`;
}

// ---------------------------------------------------------------- 检索
//
// 与 App 内 KnowledgeSearchEngine 同一思路（多字段加权 + 中文 N-Gram），
// 但**不是等价实现**：这里求的是「Agent 能按意思找到那张卡」，不追求逐分一致。

const STOP_WORDS = new Set(["的", "了", "是", "在", "和", "与", "或", "就", "也", "都", "而", "及", "a", "an", "the", "of", "to", "and", "is", "are", "in", "on"]);

export function tokenize(text) {
  const lower = String(text ?? "").toLowerCase();
  const terms = new Set();
  for (const token of lower.split(/[^a-z0-9]+/)) {
    if (token.length >= 2 && !STOP_WORDS.has(token)) terms.add(token);
  }
  for (const cjk of lower.match(/[一-龥]+/g) ?? []) {
    for (let i = 0; i + 1 < cjk.length; i += 1) {
      const gram = cjk[i] + cjk[i + 1];
      if (!STOP_WORDS.has(gram)) terms.add(gram);
    }
    for (let i = 0; i + 2 < cjk.length; i += 1) terms.add(cjk[i] + cjk[i + 1] + cjk[i + 2]);
  }
  return terms;
}

function buildProfile(cards) {
  return cards.map((card) => {
    const headline = tokenize(card.headline);
    const summary = tokenize(card.summary);
    const details = tokenize(card.details);
    const category = tokenize(card.category);
    return { card, headline, summary, details, category, text: `${card.headline ?? ""} ${card.summary ?? ""} ${card.details ?? ""}` };
  });
}

export function createSearcher(cards) {
  const profiles = buildProfile(cards);
  const documentCount = Math.max(1, profiles.length);
  const docFreq = new Map();
  for (const profile of profiles) {
    const seen = new Set([...profile.headline, ...profile.summary, ...profile.details, ...profile.category]);
    for (const term of seen) docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
  }
  const idf = (term) => Math.log(1 + documentCount / (1 + (docFreq.get(term) ?? 0)));

  return function search(query, limit = 8) {
    const terms = [...tokenize(query)];
    if (terms.length === 0) return [];
    const trimmed = String(query).trim().toLowerCase();
    const scored = [];
    for (const profile of profiles) {
      let score = 0;
      for (const term of terms) {
        const weight = idf(term);
        if (profile.headline.has(term)) score += weight * 3;
        if (profile.category.has(term)) score += weight * 2;
        if (profile.summary.has(term)) score += weight * 1.6;
        if (profile.details.has(term)) score += weight * 0.9;
      }
      if (trimmed.length >= 2 && profile.text.toLowerCase().includes(trimmed)) score += 4;
      if (score > 0) {
        score /= 1 + Math.log1p(profile.details.size) / 40;   // 长文不靠堆词取胜
        scored.push({ profile, score });
      }
    }
    scored.sort((a, b) => (b.score - a.score) || a.profile.card.headline.localeCompare(b.profile.card.headline));
    return scored.slice(0, Math.max(1, limit)).map(({ profile, score }) => ({
      id: profile.card.id,
      headline: profile.card.headline,
      category: profile.card.category,
      summary: profile.card.summary,
      score: Math.round(score * 1000) / 1000,
      snippet: profile.card.summary || profile.text.slice(0, 120),
    }));
  };
}

// ---------------------------------------------------------------- 地图与路径

export function browseMap(library) {
  const index = indexTaxonomy(library.taxonomy);
  const groups = new Map();
  for (const card of library.cards) {
    const taxonomy = deriveTaxonomy(card, index);
    const slug = taxonomy.subject;
    if (!groups.has(slug)) groups.set(slug, { slug, name: subjectName(index, slug), cards: 0, seen: 0, mastered: 0, branches: new Map() });
    const group = groups.get(slug);
    group.cards += 1;
    if (card.seenAt) group.seen += 1;
    if ((card.masteryLevel ?? 0) >= 2) group.mastered += 1;
    const branchKey = taxonomy.branch ?? "—";
    if (!group.branches.has(branchKey)) {
      group.branches.set(branchKey, {
        slug: taxonomy.branch,
        name: taxonomy.branch ? index.subjects.get(slug)?.branches.get(taxonomy.branch) ?? taxonomy.branch : "未分分支",
        cards: 0,
        seen: 0,
        levels: new Map(),
      });
    }
    const branch = group.branches.get(branchKey);
    branch.cards += 1;
    if (card.seenAt) branch.seen += 1;
    const level = taxonomy.level ?? 0;
    branch.levels.set(level, (branch.levels.get(level) ?? 0) + 1);
  }

  return [...groups.values()]
    .sort((a, b) => (a.slug === null) - (b.slug === null) || b.cards - a.cards)
    .map((group) => ({
      subject: group.slug,
      name: group.name,
      cards: group.cards,
      seen: group.seen,
      mastered: group.mastered,
      branches: [...group.branches.values()]
        .sort((a, b) => b.cards - a.cards)
        .map((branch) => ({
          branch: branch.slug,
          name: branch.name,
          cards: branch.cards,
          seen: branch.seen,
          levels: [...branch.levels.entries()].sort((a, b) => a[0] - b[0]).map(([level, count]) => ({ level: level || null, levelName: levelName(index, level || null), count })),
        })),
    }));
}

export function learningPath(library, { subject, branch = null, level = null, includeSeen = true, limit = 50 } = {}) {
  const index = indexTaxonomy(library.taxonomy);
  const matched = library.cards.filter((card) => {
    const taxonomy = deriveTaxonomy(card, index);
    if (taxonomy.subject !== subject) return false;
    if (branch !== null && taxonomy.branch !== branch) return false;
    if (level !== null && taxonomy.level !== level) return false;
    if (!includeSeen && card.seenAt) return false;
    return true;
  });
  // 顺序 = orderKey（导入时的原始推进顺序）；缺 orderKey 的按标题兜底，保证稳定可复现
  matched.sort((a, b) => {
    const left = a.orderKey ?? "";
    const right = b.orderKey ?? "";
    if (left !== right) return left < right ? -1 : 1;
    return String(a.headline).localeCompare(String(b.headline));
  });
  return matched.slice(0, Math.max(1, limit)).map((card, position) => ({
    position: position + 1,
    id: card.id,
    headline: card.headline,
    orderKey: card.orderKey ?? null,
    level: deriveTaxonomy(card, index).level,
    levelName: levelName(index, deriveTaxonomy(card, index).level),
    seen: Boolean(card.seenAt),
    masteryLevel: card.masteryLevel ?? 0,
  }));
}

export function stats(library) {
  const index = indexTaxonomy(library.taxonomy);
  const bySubject = new Map();
  let seen = 0;
  let mastered = 0;
  let favorites = 0;
  let graded = 0;
  for (const card of library.cards) {
    const slug = deriveTaxonomy(card, index).subject;   // null = 未分级，与 kf_browse_map 同一口径
    if (!bySubject.has(slug)) bySubject.set(slug, { cards: 0, seen: 0, mastered: 0 });
    const row = bySubject.get(slug);
    row.cards += 1;
    if (card.seenAt) { row.seen += 1; seen += 1; }
    if ((card.masteryLevel ?? 0) >= 2) { row.mastered += 1; mastered += 1; }
    if (card.isFavorite) favorites += 1;
    if ((card.reviewCount ?? 0) > 0) graded += 1;
  }
  return {
    cards: library.cards.length,
    seen,
    mastered,
    favorites,
    reviewed: graded,
    ungraded: library.cards.filter((card) => !deriveTaxonomy(card, index).subject).length,
    bySubject: [...bySubject.entries()]
      .map(([slug, row]) => ({
        subject: slug,
        name: subjectName(index, slug),
        ...row,
      }))
      // 与 kf_browse_map 同序：未分级永远排最后，Agent 读两个工具时看到的顺序一致
      .sort((a, b) => (a.subject === null) - (b.subject === null) || b.cards - a.cards || a.name.localeCompare(b.name)),
  };
}

// ---------------------------------------------------------------- 暂存写入

export function validateStaged(card, index) {
  const issues = [];
  if (!card || typeof card !== "object" || Array.isArray(card)) return ["卡片必须是 JSON 对象"];
  for (const field of ["headline", "summary", "details", "category", "subject", "branch", "track", "orderKey"]) {
    if (card[field] !== undefined && typeof card[field] !== "string") issues.push(`${field} 必须是字符串`);
  }
  if (card.links !== undefined && (!Array.isArray(card.links) || card.links.some((link) =>
    !link || typeof link.title !== "string" || !link.title.trim() || typeof link.url !== "string" || !link.url.trim()
  ))) issues.push("links 必须是包含非空 title/url 字符串的数组");
  if (!String(card.headline ?? "").trim()) issues.push("headline 不能为空");
  if (!String(card.summary ?? "").trim()) issues.push("summary 不能为空");
  if (!String(card.details ?? "").trim()) issues.push("details 不能为空");
  if (card.subject && !index.subjects.has(card.subject)) issues.push(`未知学科 ${card.subject}`);
  if (card.branch) {
    const spec = index.subjects.get(card.subject);
    if (!spec) issues.push("写 branch 必须同时给出合法 subject");
    else if (!spec.branches.has(card.branch)) issues.push(`学科 ${card.subject} 没有分支 ${card.branch}`);
  }
  if (card.level !== undefined && !(Number.isInteger(card.level) && card.level >= 1 && card.level <= 5)) {
    issues.push("level 必须是 1..5 的整数");
  }
  return issues;
}

/**
 * 追加到 staged_cards.json（与 cards.json 同构的卡片数组）。
 * App 侧「导入归档数据」可直接吃这个文件——所以整条链路不需要改 App 就能闭环。
 */
export function stageCard(library, input, index = indexTaxonomy(library.taxonomy)) {
  const inputIssues = validateStaged(input, index);
  if (inputIssues.length) return { ok: false, issues: inputIssues };
  const card = {
    category: input.category ?? subjectName(index, input.subject),
    headline: String(input.headline ?? "").trim(),
    summary: String(input.summary ?? "").trim(),
    details: String(input.details ?? "").trim(),
    links: Array.isArray(input.links) ? input.links.filter((link) => link && link.title && link.url) : [],
    source: "ai",
    createdAt: new Date().toISOString(),
    ...(input.subject ? { subject: input.subject } : {}),
    ...(input.branch ? { branch: input.branch } : {}),
    ...(input.level !== undefined ? { level: input.level } : {}),
    ...(input.track ? { track: input.track } : {}),
    ...(input.orderKey ? { orderKey: input.orderKey } : {}),
  };
  const issues = validateStaged(card, index);
  if (issues.length) return { ok: false, issues };

  // realpath 统一通过目录别名访问的写者；锁覆盖读取、去重与替换整个事务。
  const stagedPath = path.join(fs.realpathSync(path.dirname(library.stagedPath)), path.basename(library.stagedPath));
  const lockPath = `${stagedPath}.lock`;
  const deadline = Date.now() + 2000;
  let lock;
  while (lock === undefined) {
    try {
      lock = fs.openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error(`暂存队列正被占用，请重试；若写入进程已异常退出，请确认所有写入进程停止后移除锁：${lockPath}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  const temporary = `${stagedPath}.${randomUUID()}.tmp`;
  try {
    const queue = fs.existsSync(stagedPath) ? readJsonArray(stagedPath) : [];
    const normalized = card.headline.replace(/\s+/g, "").toLowerCase();
    if (queue.some((existing) => String(existing.headline ?? "").replace(/\s+/g, "").toLowerCase() === normalized)) {
      return { ok: false, issues: ["暂存队列里已有同标题卡片"], position: queue.length + 1 };
    }
    queue.push(card);
    const data = JSON.stringify(queue, null, 2);
    if (Buffer.byteLength(data) > MAX_FILE_BYTES) throw new Error("暂存队列超过 64 MiB，请先导入或整理队列");
    const fd = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, stagedPath);
    return { ok: true, position: queue.length, stagedPath: library.stagedPath, headline: card.headline };
  } finally {
    try {
      fs.rmSync(temporary, { force: true });
    } finally {
      fs.closeSync(lock);
      fs.unlinkSync(lockPath);
    }
  }
}
