import type { KnowledgeCard } from "./card";
import { themeKeyForCard } from "./cardTheme";

const SALT = "_knowflick_salt_v4";

/** 64-bit FNV-1a，与 Kotlin [CardArrange.deterministicHash] 一致 */
export function deterministicHash(text: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash;
}

export function hashIndex(text: string, poolSize: number): number {
  const mask = 0xffffffffffffffffn;
  const unsigned = deterministicHash(text) & mask;
  return Number(unsigned % BigInt(poolSize));
}

export function arrange(
  cards: KnowledgeCard[],
  minDistance = 5,
  avoidingTopKey: string | null = null,
  keyFor: (card: KnowledgeCard) => string = themeKeyForCard,
): KnowledgeCard[] {
  if (cards.length <= 1) return cards;
  const remaining = [...cards].sort((a, b) => {
    const left = deterministicHash(a.headline + SALT);
    const right = deterministicHash(b.headline + SALT);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const result: KnowledgeCard[] = [];
  const lastSeenPos = new Map<string, number>();
  if (avoidingTopKey) lastSeenPos.set(avoidingTopKey, -1);
  let currentIndex = 0;
  while (remaining.length > 0) {
    let bestCandidateIdx = 0;
    let maxDist = Number.MIN_SAFE_INTEGER;
    for (let i = 0; i < remaining.length; i += 1) {
      const key = keyFor(remaining[i]!);
      const lastPos = lastSeenPos.get(key) ?? -999_999;
      const dist = currentIndex - lastPos;
      if (dist >= minDistance) {
        bestCandidateIdx = i;
        break;
      }
      if (dist > maxDist) {
        maxDist = dist;
        bestCandidateIdx = i;
      }
    }
    const chosen = remaining[bestCandidateIdx]!;
    const last = remaining.pop()!;
    if (bestCandidateIdx !== remaining.length) remaining[bestCandidateIdx] = last;
    result.push(chosen);
    lastSeenPos.set(keyFor(chosen), currentIndex);
    currentIndex += 1;
  }
  return result;
}
