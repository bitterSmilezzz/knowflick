import { PINYIN_DICT_RAW } from "./pinyinDict";

export interface PhoneticPair {
  full: string;
  initials: string;
}

const GB2312_TABLE: Array<[number, number, string]> = [
  [0xb0a1, 0xb0c4, "a"], [0xb0c5, 0xb2c0, "b"], [0xb2c1, 0xb4ed, "c"], [0xb4ee, 0xb6e9, "d"],
  [0xb6ea, 0xb7a1, "e"], [0xb7a2, 0xb8c0, "f"], [0xb8c1, 0xb9fd, "g"], [0xb9fe, 0xbbf6, "h"],
  [0xbbf7, 0xbfa5, "j"], [0xbfa6, 0xc0ab, "k"], [0xc0ac, 0xc2e7, "l"], [0xc2e8, 0xc4c2, "m"],
  [0xc4c3, 0xc5b5, "n"], [0xc5b6, 0xc5bd, "o"], [0xc5be, 0xc6d9, "p"], [0xc6da, 0xc8ba, "q"],
  [0xc8bb, 0xc8f5, "r"], [0xc8f6, 0xcbf9, "s"], [0xcbfa, 0xcdd9, "t"], [0xcdda, 0xcef3, "w"],
  [0xcef4, 0xd1b8, "x"], [0xd1b9, 0xd4d0, "y"], [0xd4d1, 0xd7f9, "z"],
];

const PINYIN_DICT = buildDict(PINYIN_DICT_RAW);
const cache = new Map<string, PhoneticPair>();

function buildDict(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const token of raw.split("|")) {
    const sep = token.indexOf(":");
    if (sep > 0) map.set(token.slice(0, sep), token.slice(sep + 1));
  }
  return map;
}

export function phonetics(text: string): PhoneticPair {
  if (!text) return { full: "", initials: "" };
  const cached = cache.get(text);
  if (cached) return cached;
  const full: string[] = [];
  const initials: string[] = [];
  for (const ch of text) {
    if (/[a-z]/i.test(ch) || /\d/.test(ch)) {
      const lower = ch.toLowerCase();
      full.push(lower);
      initials.push(lower);
      continue;
    }
    if (ch >= "\u4e00" && ch <= "\u9fff") {
      const py = PINYIN_DICT.get(ch);
      if (py) {
        full.push(py);
        initials.push(py[0] ?? "");
      } else {
        const init = gb2312Initial(ch);
        if (init) {
          full.push(init);
          initials.push(init);
        }
      }
    }
  }
  const pair = { full: full.join(""), initials: initials.join("") };
  cache.set(text, pair);
  return pair;
}

function gb2312Initial(ch: string): string | null {
  try {
    const bytes = new TextEncoder().encode(ch);
    if (bytes.length !== 3 && bytes.length !== 2) {
      // Node may encode CJK as UTF-8 (3 bytes) — use iconv-free fallback only for dict hits
      return null;
    }
    // Browser/Node UTF-8 path: skip GB2312 for unknown chars
    if (bytes.length === 3) return null;
    const code = (bytes[0] << 8) | bytes[1];
    for (const [start, end, letter] of GB2312_TABLE) {
      if (code >= start && code <= end) return letter;
    }
  } catch {
    return null;
  }
  return null;
}

export type PinyinQueryType = "pinyin_full" | "initials";

export function pinyinMatchShortText(text: string, pinyinQuery: string, queryType: PinyinQueryType): number {
  if (!pinyinQuery) return 0;
  const { full, initials } = phonetics(text);
  if (queryType === "pinyin_full") {
    if (pinyinQuery.length < 3) return 0;
    if (full === pinyinQuery) return 70;
    if (full.startsWith(pinyinQuery)) return 60;
    if (full.includes(pinyinQuery) && pinyinQuery.length >= 4) return 45;
    return 0;
  }
  if (pinyinQuery.length < 2) return 0;
  if (initials === pinyinQuery) return 65;
  if (initials.startsWith(pinyinQuery)) return 55;
  if (initials.includes(pinyinQuery) && pinyinQuery.length / initials.length >= 0.5) return 40;
  return 0;
}
