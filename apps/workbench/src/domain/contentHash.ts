/**
 * 内容指纹：用来判断「这条内容库里是不是已经有了」。
 *
 * 为什么不用 crypto.subtle：它是异步的，而调用点（导入、新建素材）都在
 * 同步构造对象的位置，为了一个去重判断把整条路径改成 async 不值得。
 * 这里用 FNV-1a 32 位：足够区分正常内容，纯 JS、确定性强、可单测。
 *
 * 注意它**不是**密码学哈希——只用来去重，不用于完整性校验。
 */
export function contentHashOf(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    // FNV 质数 16777619，用移位避免大整数乘法溢出。
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return `${normalized.length.toString(36)}-${hash.toString(36)}`;
}

/** 从一批已有素材里收集指纹，用于导入时的「已存在」判断。 */
export function existingHashes(materials: Array<{ contentHash?: string | null }>): Set<string> {
  const set = new Set<string>();
  for (const material of materials) {
    if (material.contentHash) set.add(material.contentHash);
  }
  return set;
}

/**
 * 一批已有素材的「已存在」判定键。
 *
 * 除了正文指纹，还要包含图片的 `文件名 + 字节数`：图片内容不进文本指纹，
 * 否则第二次拖同一个文件会因为库里只留了 contentHash 而再进来一份。
 * 键格式 `image:<fileName>:<bytes>` 与导入时保持一致。
 */
export function existingKeys(materials: Array<{ sourceType?: string; contentHash?: string | null; mediaSizeBytes?: number; metadataJson?: string }>): Set<string> {
  const keys = existingHashes(materials);
  for (const material of materials) {
    if (material.sourceType !== "image") continue;
    try {
      const meta = JSON.parse(material.metadataJson ?? "{}") as { fileName?: unknown };
      if (typeof meta.fileName === "string" && meta.fileName) {
        keys.add(`image:${meta.fileName}:${material.mediaSizeBytes ?? 0}`);
      }
    } catch { /* 坏元数据时只是跳过图片判重，不影响正文指纹 */ }
  }
  return keys;
}
