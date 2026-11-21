export const SEARCH_HISTORY_LIMIT = 8;

export function parseSearchHistory(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}

export function encodeSearchHistory(history: string[]): string {
  return JSON.stringify(history);
}

/** Strict form used by backups so malformed history is reported instead of exported as empty. */
export function validateSearchHistorySnapshot(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("搜索历史快照格式无效");
  if (value.length > SEARCH_HISTORY_LIMIT) throw new Error(`搜索历史快照超过上限 ${SEARCH_HISTORY_LIMIT} 条`);
  const seen = new Set<string>();
  const history: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim() || item !== item.trim()) {
      throw new Error("搜索历史快照格式无效");
    }
    if (seen.has(item)) throw new Error("搜索历史快照包含重复条目");
    seen.add(item);
    history.push(item);
  }
  return history;
}

/** Preserve local LRU order; append imported terms that fit and report all omitted terms. */
export function mergeSearchHistory(
  existingValue: unknown,
  importedValue: unknown,
): { history: string[]; added: number; skipped: number; alreadyPresent: number; overLimit: number } {
  const existing = validateSearchHistorySnapshot(existingValue);
  const imported = validateSearchHistorySnapshot(importedValue);
  const history = [...existing];
  const seen = new Set(existing);
  let added = 0;
  let skipped = 0;
  let alreadyPresent = 0;
  let overLimit = 0;
  for (const query of imported) {
    if (seen.has(query)) {
      skipped++;
      alreadyPresent++;
      continue;
    }
    if (history.length >= SEARCH_HISTORY_LIMIT) {
      skipped++;
      overLimit++;
      continue;
    }
    history.push(query);
    seen.add(query);
    added++;
  }
  return { history, added, skipped, alreadyPresent, overLimit };
}

/** LRU，上限 8 条，与 `CardStorage.saveSearchHistory` 一致。 */
export function pushSearchHistory(history: string[], query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return history;
  return [trimmed, ...history.filter((item) => item !== trimmed)].slice(0, SEARCH_HISTORY_LIMIT);
}

export function removeSearchHistory(history: string[], query: string): string[] {
  return history.filter((item) => item !== query);
}
