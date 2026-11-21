// server/src/state/modules/batch110Parsers.ts
// B110 oracle parsers. Public entry symbols are the parse* functions below.

import { memoOracleNormalize } from './oracleNormalizeMemo.js';

export function normalizeB110Oracle(text: string): string {
  return memoOracleNormalize('b110', text, undefined, () => normalizeB110OracleUncached(text));
}

function normalizeB110OracleUncached(text: string): string {
  return String(text || '')
    .replace(/\u2019/g, "'")
    .replace(/[A-Za-z][A-Za-z0-9' !-]{0,40}?\s+[—-]\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function n(text: string): string {
  return normalizeB110Oracle(text);
}

const WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function parseNum(raw: string): number {
  const key = String(raw || '').toLowerCase();
  if (key in WORDS) return WORDS[key];
  const value = parseInt(key, 10);
  return Number.isFinite(value) ? value : 0;
}

/** Clamavus: each creature you control gets PT for each counter of that kind on it. */
export function parseEachCreatureYouControlPTPerCounter(oracle: string): { power: number; toughness: number; counter: string } | null {
  const m = n(oracle).match(/each creature you control gets ([+-]\d+)\s*\/\s*([+-]\d+) for each (\+1\/\+1|[-+]?\d+\/[-+]?\d+) counters? on it/i);
  if (!m) return null;
  return { power: Number(m[1]), toughness: Number(m[2]), counter: m[3] };
}

/** Zinnia: self gets +X/+N where X is other creatures you control with base power N. */
export function parseSelfPTWhereXIsOtherCreaturesWithBasePower(oracle: string): { toughness: number; basePower: number } | null {
  const m = n(oracle).match(/gets \+x\/\+(\d+), where x is the number of other creatures you control with base power (\d+)/i);
  if (!m) return null;
  return { toughness: Number(m[1]), basePower: Number(m[2]) };
}

/** Kinbinding. */
export function parseCreaturesYouControlPTWhereXIsEnteredThisTurn(oracle: string): boolean {
  return /creatures you control get \+x\/\+x, where x is the number of creatures that entered the battlefield under your control this turn/i.test(n(oracle));
}

/** Jetmir-style "also get PT and have KEYWORD as long as you control N or more creatures." */
export function parseAlsoPTAndKeywordAtCreatureCount(oracle: string): Array<{ power: number; toughness: number; keyword: string; min: number }> {
  const out: Array<{ power: number; toughness: number; keyword: string; min: number }> = [];
  // Asked once per (permanent, keyword, source); the phrase check skips the regex for nearly every card.
  const normalized = n(oracle);
  if (!/creatures you control also get/i.test(normalized)) return out;
  const re = /creatures you control also get ([+-]\d+)\s*\/\s*([+-]\d+) and have (trample|double strike|vigilance|first strike|lifelink|menace|haste) as long as you control (\w+|\d+) or more creatures/gi;
  for (const m of normalized.matchAll(re)) {
    const min = parseNum(m[4]);
    if (min > 0) out.push({ power: Number(m[1]), toughness: Number(m[2]), keyword: m[3].toLowerCase(), min });
  }
  return out;
}

/** The Flesh Is Weak — type addition. */
export function parseCreaturesYouControlWithPlusCountersAreArtifacts(oracle: string): boolean {
  return /creatures you control with \+1\/\+1 counters on them are artifacts in addition to their other types/i.test(n(oracle));
}

/** The Flesh Is Weak — global anthem. Skips Common Cause's "as long as they all share a color" sentence. */
export function parseNonartifactCreaturesGetPT(oracle: string): { power: number; toughness: number } | null {
  const sentences = n(oracle).split(/(?<=\.)\s+/);
  for (const sentence of sentences.length ? sentences : [n(oracle)]) {
    if (/as long as they all share a color/i.test(sentence)) continue;
    const m = sentence.match(/nonartifact creatures get ([+-]\d+)\s*\/\s*([+-]\d+)/i);
    if (m) return { power: Number(m[1]), toughness: Number(m[2]) };
  }
  return null;
}

/** Beckoning Will-o'-Wisp. */
export function parseCreaturesAttackingLastChosenPlayerPT(oracle: string): { power: number; toughness: number } | null {
  const m = n(oracle).match(/creatures attacking the last chosen player get ([+-]\d+)\s*\/\s*([+-]\d+)/i);
  if (!m) return null;
  return { power: Number(m[1]), toughness: Number(m[2]) };
}
