/**
 * CR 700.5: generic "your devotion to <colors>" oracle phrases.
 * Parses the color list (one or more colors, "and"/comma separated) and
 * threshold clauses ("is seven or greater", "is less than five"), and
 * evaluates them through countDevotionAmongPermanents so hybrid ({R/W},
 * {2/W}) and Phyrexian ({W/P}) symbols count once per symbol.
 */
import { countDevotionAmongPermanents } from './devotionCount.js';

const COLOR_NAME_TO_CODE: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

const COLOR_NAME = '(?:white|blue|black|red|green)';
const COLOR_LIST = `${COLOR_NAME}(?:(?:,\\s*(?:and\\s+)?|\\s+and\\s+)${COLOR_NAME})*`;
const DEVOTION_REFERENCE_RE = new RegExp(`\\byour\\s+devotion\\s+to\\s+(${COLOR_LIST})\\b`, 'i');

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
};

export function parseDevotionColorList(phrase: string): string[] {
  const out: string[] = [];
  for (const word of String(phrase || '').toLowerCase().split(/[^a-z]+/)) {
    const code = COLOR_NAME_TO_CODE[word];
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

/** Colors named by the first "your devotion to ..." phrase in text, or null. */
export function parseDevotionReference(text: string): string[] | null {
  const match = String(text || '').match(DEVOTION_REFERENCE_RE);
  if (!match) return null;
  const colors = parseDevotionColorList(match[1]);
  return colors.length > 0 ? colors : null;
}

/** Devotion amount for a bare reference ("your devotion to black", "x is your devotion to ..."). */
export function evaluateDevotionReference(
  permanents: readonly any[],
  playerId: string,
  text: string,
): number | null {
  const trimmed = String(text || '').trim().toLowerCase().replace(/[.]$/, '');
  if (!new RegExp(`^(?:x is )?your devotion to ${COLOR_LIST}$`, 'i').test(trimmed)) return null;
  const colors = parseDevotionReference(trimmed);
  return colors ? countDevotionAmongPermanents(permanents, playerId, colors) : null;
}

export type DevotionThreshold = {
  colors: string[];
  comparison: 'at_least' | 'less_than' | 'at_most' | 'greater_than';
  amount: number;
};

function parseCount(raw: string): number | null {
  const v = String(raw || '').trim().toLowerCase();
  if (/^\d+$/.test(v)) return Number(v);
  return v in NUMBER_WORDS ? NUMBER_WORDS[v] : null;
}

/** "your devotion to X [and Y] is N or greater / less than N / N or less / greater than N". */
export function parseDevotionThreshold(text: string): DevotionThreshold | null {
  const re = new RegExp(
    `your\\s+devotion\\s+to\\s+(${COLOR_LIST})\\s+is\\s+(?:(less|greater|more)\\s+than\\s+(\\w+)|(\\w+)\\s+or\\s+(greater|more|less|fewer))`,
    'i',
  );
  const m = String(text || '').match(re);
  if (!m) return null;
  const colors = parseDevotionColorList(m[1]);
  if (colors.length === 0) return null;
  if (m[2]) {
    const amount = parseCount(m[3]);
    if (amount === null) return null;
    return { colors, comparison: m[2].toLowerCase() === 'less' ? 'less_than' : 'greater_than', amount };
  }
  const amount = parseCount(m[4]);
  if (amount === null) return null;
  const dir = m[5].toLowerCase();
  return { colors, comparison: dir === 'less' || dir === 'fewer' ? 'at_most' : 'at_least', amount };
}

export function evaluateDevotionThreshold(
  permanents: readonly any[],
  playerId: string,
  text: string,
): boolean | null {
  const parsed = parseDevotionThreshold(text);
  if (!parsed) return null;
  const devotion = countDevotionAmongPermanents(permanents, playerId, parsed.colors);
  switch (parsed.comparison) {
    case 'at_least': return devotion >= parsed.amount;
    case 'greater_than': return devotion > parsed.amount;
    case 'less_than': return devotion < parsed.amount;
    case 'at_most': return devotion <= parsed.amount;
  }
}
