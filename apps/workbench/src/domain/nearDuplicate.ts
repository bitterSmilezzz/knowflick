/**
 * 文字近似的重复候选（C04，R2）。
 *
 * 语义（契约 docs/NOTES_MODEL.md 与产品重规划）：
 * - **字节完全相同**的由 contentHash 在导入时自动跳过——不是这里的职责；
 * - **文字近似**的用规范化指纹做**候选**，显示差异，**由用户决定**；
 *   两个相似观点可能时间、立场或项目不同，语义近似不自动删除；
 * - 每条候选保留双方的独立出处。
 *
 * 规范化指纹（simhash 风格）：大小写、空白、标点不影响；词袋哈希加权。
 * 候选判定用汉明距离——不是「相同」，是「很像，请用户看一眼」。
 */

const FNV_OFFSET = 0x811c9dc5;

/** 一元词 + 相邻二元词的哈希特征（中文无分词也有效：二元覆盖相邻字对）。 */
function tokenHashes(text: string): Map<number, number> {
  const weights = new Map<number, number>();
  const bump = (hash: number) => weights.set(hash, (weights.get(hash) ?? 0) + 1);
  const bumpWord = (word: string) => {
    let hash = FNV_OFFSET;
    for (let i = 0; i < word.length; i++) {
      hash ^= word.charCodeAt(i);
      hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
    }
    bump(hash);
  };
  const tokens = text
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  for (const token of tokens) {
    bumpWord(token);
    // 中文按二元切（相邻两字），英文单 TOKEN 已足够
    if (/[\u4e00-\u9fff]/.test(token) && token.length > 1) {
      for (let i = 0; i < token.length - 1; i++) bumpWord(token.slice(i, i + 2));
    }
  }
  return weights;
}

/** 64 位 simhash（两个 32 位拼合，字符串表示）。 */
export function similarityFingerprint(text: string): string {
  const weights = tokenHashes(text);
  if (weights.size === 0) return "";
  const bits: boolean[] = new Array(64).fill(false);
  for (let bit = 0; bit < 64; bit++) {
    let weighted = 0;
    for (const [hash, count] of weights) {
      if ((hash >>> bit % 32) & 1) weighted += count;
      else weighted -= count;
    }
    bits[bit] = weighted > 0;
  }
  const hex = (from: number) => {
    let value = 0;
    for (let i = 0; i < 16; i++) if (bits[from + i]) value |= 1 << i;
    return value.toString(16).padStart(4, "0");
  };
  return hex(0) + hex(16) + hex(32) + hex(48);
}

/** 汉明距离：0 = 指纹相同，越大越不像。 */
export function hammingDistance(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { distance += x & 1; x >>= 1; }
  }
  return distance;
}

export interface DuplicateCandidate {
  id: string;
  title: string;
  distance: number;
}

/**
 * 从已有条目里找出某篇正文的近似重复候选。
 * 阈值：汉明距离 ≤ 12（64 位指纹的 ~19%）——经验值，测试钉住
 * 「改写少量措辞会命中、完全不同的话题不会」。
 */
export const NEAR_DUPLICATE_DISTANCE = 12;

export function findNearDuplicates(
  body: string,
  existing: Array<{ id: string; title: string; body: string }>
): DuplicateCandidate[] {
  const fingerprint = similarityFingerprint(body);
  if (!fingerprint) return [];
  const out: DuplicateCandidate[] = [];
  for (const item of existing) {
    const other = similarityFingerprint(item.body);
    if (!other) continue;
    const distance = hammingDistance(fingerprint, other);
    if (distance <= NEAR_DUPLICATE_DISTANCE) {
      out.push({ id: item.id, title: item.title, distance });
    }
  }
  return out.sort((a, b) => a.distance - b.distance);
}
