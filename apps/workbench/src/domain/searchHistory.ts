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

/** LRU，上限 8 条，与 `CardStorage.saveSearchHistory` 一致。 */
export function pushSearchHistory(history: string[], query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return history;
  return [trimmed, ...history.filter((item) => item !== trimmed)].slice(0, SEARCH_HISTORY_LIMIT);
}

export function removeSearchHistory(history: string[], query: string): string[] {
  return history.filter((item) => item !== query);
}
