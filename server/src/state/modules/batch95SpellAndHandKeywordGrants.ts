// server/src/state/modules/batch95SpellAndHandKeywordGrants.ts
// B95: one grant mechanism for "cards in your hand have KEYWORD" and
// "spells you cast have KEYWORD" (Lorehold miracle, Hatchery Sliver
// replicate, Jo Grant cycling, Silverquill casualty, Herigast emerge,
// Inspiring Statuary improvise, Ashling evoke, Elda demonstrate,
// Raiding Schemes conspire, Fblthp plot). Existing keyword handlers
// consult getGrantedSpellOrHandKeyword.
// Public: parseSpellOrHandKeywordGrants, cardMatchesKeywordGrantFilter,
// getGrantedSpellOrHandKeyword, collectSpellOrHandKeywordGrantsFromState.

import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import { getBatch103GrantedKeyword } from './batch103KeywordGrants.js';
import { getBatch104GrantedKeyword } from './batch104KeywordGrants.js';

export const SPELL_OR_HAND_GRANT_KEYWORDS = [
  'miracle', 'cycling', 'replicate', 'casualty', 'emerge', 'improvise', 'evoke', 'demonstrate', 'conspire', 'plot', 'ripple', 'warp', 'prowl',
] as const;

export type GrantedKeywordName = (typeof SPELL_OR_HAND_GRANT_KEYWORDS)[number];

export type KeywordGrantFilter = {
  words: string[];
  disjunctive: boolean;
  zone: 'hand' | 'cast' | 'cast_from_hand' | 'library_top';
  firstThisTurn?: boolean;
};

export type SpellOrHandKeywordGrant = {
  keyword: GrantedKeywordName;
  cost?: string;
  costEqualsManaCost?: boolean;
  numericValue?: number;
  filter: KeywordGrantFilter;
  sourceName?: string;
  sourcePermanentId?: string;
  sourceController?: string;
};

const KEYWORD_ALT = SPELL_OR_HAND_GRANT_KEYWORDS.join('|');
const COST_RE = '(?:\\s*((?:\\{[^}]+\\})+))?';
const VALUE_RE = '(?:\\s+(\\d+|one|two|three|four|five))?';
const QUAL = '((?:non)?[a-z]+(?:(?:\\s*,\\s*|\\s+and\\s+|\\s+or\\s+|\\s+)(?:non)?[a-z]+)*)';

const HAND_RE = new RegExp(`\\beach ${QUAL} cards? in your hand has (${KEYWORD_ALT})${COST_RE}${VALUE_RE}`, 'i');
const EACH_CAST_RE = new RegExp(`\\beach ${QUAL} spells? you cast has (${KEYWORD_ALT})${COST_RE}${VALUE_RE}`, 'i');
const HAVE_CAST_RE = new RegExp(`\\b${QUAL} spells you cast have (${KEYWORD_ALT})${COST_RE}${VALUE_RE}`, 'i');
const GAIN_AS_CAST_RE = new RegExp(`\\b${QUAL} (?:permanent )?spells you cast(?: from your hand)? gain (${KEYWORD_ALT})${COST_RE} as you cast them`, 'i');
const FIRST_CAST_RE = new RegExp(`\\bthe first ${QUAL} spells? you cast each turn has (${KEYWORD_ALT})${COST_RE}${VALUE_RE}`, 'i');
const TOP_PLOT_RE = /the top card of your library has plot(?:\.|$)/i;
const PLOT_FROM_TOP_RE = /you may plot (nonland )?cards from the top of your library/i;
const COST_EQ_MANA_RE = /the (miracle|cycling|replicate|casualty|emerge|improvise|evoke|demonstrate|conspire|plot) cost is equal to its mana cost/i;

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

const COLORS: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const CARD_TYPES = ['creature', 'artifact', 'enchantment', 'instant', 'sorcery', 'planeswalker', 'land', 'battle', 'kindred', 'legendary', 'permanent', 'historic', 'multicolored', 'colorless'];

function colorsOf(card: any): string[] {
  if (Array.isArray(card?.colors)) return card.colors.map((c: any) => String(c).toUpperCase());
  const cost = String(card?.mana_cost || card?.manaCost || '').toUpperCase();
  return ['W', 'U', 'B', 'R', 'G'].filter((c) => cost.includes(`{${c}}`) || cost.includes(c));
}

function isHistoric(card: any): boolean {
  const tl = String(card?.type_line || card?.typeLine || '').toLowerCase();
  return tl.includes('legendary') || tl.includes('artifact') || tl.includes('saga');
}

function isPermanentSpell(card: any): boolean {
  const tl = String(card?.type_line || card?.typeLine || '').toLowerCase();
  if (tl.includes('instant') || tl.includes('sorcery') || tl.includes('land')) return false;
  return /creature|artifact|enchantment|planeswalker|battle|kindred/.test(tl);
}

function wordMatches(word: string, card: any): boolean {
  const tl = String(card?.type_line || card?.typeLine || '').toLowerCase();
  const neg = word.startsWith('non');
  const base = neg ? word.slice(3).replace(/^-/, '') : word;
  let hit: boolean;
  if (base === 'historic') hit = isHistoric(card);
  else if (base === 'permanent') hit = isPermanentSpell(card);
  else if (base === 'multicolored') hit = colorsOf(card).length > 1;
  else if (base === 'colorless') hit = colorsOf(card).length === 0;
  else if (COLORS[base]) hit = colorsOf(card).includes(COLORS[base]);
  else if (base === 'land') hit = /\bland\b/.test(tl);
  else hit = new RegExp(`\\b${base.replace(/s$/, '')}s?\\b`).test(tl);
  return neg ? !hit : hit;
}

export function cardMatchesKeywordGrantFilter(card: any, filter: KeywordGrantFilter): boolean {
  if (!card || !filter) return false;
  if (!filter.words.length) return true;
  const results = filter.words.map((w) => wordMatches(w, card));
  return filter.disjunctive ? results.some(Boolean) : results.every(Boolean);
}

function parseQualifiers(raw: string): { words: string[]; disjunctive: boolean } {
  const qual = String(raw || '').trim().toLowerCase();
  if (!qual) return { words: [], disjunctive: false };
  const disjunctive = /\b(?:and|or)\b|,/.test(qual);
  const words = qual.split(/,|\band\b|\bor\b/).map((w) => w.trim()).filter(Boolean);
  // "nonlegendary creature" after split on and/or is a single phrase — split leftover spaces into ANDed tokens when not disjunctive? 
  // "nonlegendary creature" has no and/or, disjunctive false, but split gives one word "nonlegendary creature".
  // Split those into words that are each tested with every().
  const flattened = words.flatMap((w) => w.split(/\s+/).filter(Boolean));
  // "instant and sorcery" is disjunctive (either type). "nonlegendary creature" is conjunctive.
  return { words: flattened, disjunctive };
}

function costAndValue(costRaw: string | undefined, valueRaw: string | undefined, text: string, keyword: string): Pick<SpellOrHandKeywordGrant, 'cost' | 'costEqualsManaCost' | 'numericValue'> {
  const cost = String(costRaw || '').trim().toUpperCase();
  const valueWord = String(valueRaw || '').toLowerCase();
  const numericValue = valueWord ? (WORD_NUM[valueWord] ?? (parseInt(valueWord, 10) || undefined)) : undefined;
  const eq = new RegExp(`the ${keyword} cost is equal to its mana cost`, 'i').test(text);
  return {
    ...(cost ? { cost } : {}),
    ...(eq ? { costEqualsManaCost: true } : {}),
    ...(numericValue ? { numericValue } : {}),
  };
}

function pushGrant(
  out: SpellOrHandKeywordGrant[],
  keywordRaw: string,
  qualRaw: string,
  zone: KeywordGrantFilter['zone'],
  text: string,
  costRaw?: string,
  valueRaw?: string,
  extra?: Partial<KeywordGrantFilter>,
): void {
  const keyword = String(keywordRaw || '').toLowerCase() as GrantedKeywordName;
  if (!(SPELL_OR_HAND_GRANT_KEYWORDS as readonly string[]).includes(keyword)) return;
  const { words, disjunctive } = parseQualifiers(qualRaw);
  out.push({
    keyword,
    filter: { words, disjunctive, zone, ...extra },
    ...costAndValue(costRaw, valueRaw, text, keyword),
  });
}

export function parseSpellOrHandKeywordGrants(oracle: string): SpellOrHandKeywordGrant[] {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  const out: SpellOrHandKeywordGrant[] = [];
  const tryMatch = (re: RegExp, zone: KeywordGrantFilter['zone'], firstThisTurn = false) => {
    const m = text.match(re);
    if (!m) return;
    pushGrant(out, m[2], m[1], zone, text, m[3], m[4], firstThisTurn ? { firstThisTurn: true } : undefined);
  };
  tryMatch(HAND_RE, 'hand');
  tryMatch(EACH_CAST_RE, 'cast');
  tryMatch(HAVE_CAST_RE, 'cast');
  const gain = text.match(GAIN_AS_CAST_RE);
  if (gain) {
    const fromHand = /from your hand/.test(gain[0]);
    pushGrant(out, gain[2], gain[1], fromHand ? 'cast_from_hand' : 'cast', text, gain[3]);
  }
  tryMatch(FIRST_CAST_RE, 'cast', true);
  if (TOP_PLOT_RE.test(text) || PLOT_FROM_TOP_RE.test(text)) {
    const nonland = /nonland/.test(text);
    out.push({
      keyword: 'plot',
      filter: { words: nonland ? ['nonland'] : [], disjunctive: false, zone: 'library_top' },
      costEqualsManaCost: COST_EQ_MANA_RE.test(text) || true,
    });
  }
  // If a later sentence says the cost equals mana cost, stamp it on grants missing a cost.
  const eqKw = text.match(COST_EQ_MANA_RE);
  if (eqKw) {
    const kw = String(eqKw[1] || '').toLowerCase();
    for (const g of out) {
      if (g.keyword === kw && !g.cost) g.costEqualsManaCost = true;
    }
  }
  return out;
}

export function collectSpellOrHandKeywordGrantsFromState(state: any, playerId?: string): SpellOrHandKeywordGrant[] {
  const out: SpellOrHandKeywordGrant[] = [];
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const perm of battlefield) {
    if (!perm || perm.phasedOut === true || !perm.card) continue;
    const sourceController = String(perm.controller || '').trim();
    if (playerId && sourceController !== String(playerId)) continue;
    const sourcePermanentId = String(perm.id || '').trim();
    const sourceName = String(perm.card?.name || 'Unknown').trim();
    for (const grant of parseSpellOrHandKeywordGrants(readCardOracleText(perm.card))) {
      out.push({ ...grant, sourcePermanentId, sourceController, sourceName });
    }
  }
  return out;
}

function zoneAllows(grant: SpellOrHandKeywordGrant, requested?: KeywordGrantFilter['zone'] | 'any'): boolean {
  if (!requested || requested === 'any') return true;
  if (grant.filter.zone === requested) return true;
  if (requested === 'cast' && grant.filter.zone === 'cast_from_hand') return true;
  if (requested === 'hand' && grant.filter.zone === 'hand') return true;
  return false;
}

export function getGrantedSpellOrHandKeyword(
  state: any,
  playerId: string,
  card: any,
  keyword: GrantedKeywordName,
  opts?: { zone?: KeywordGrantFilter['zone'] | 'any'; fromZone?: string },
): SpellOrHandKeywordGrant | null {
  if (!card) return null;
  for (const grant of collectSpellOrHandKeywordGrantsFromState(state, playerId)) {
    if (grant.keyword !== keyword) continue;
    if (!zoneAllows(grant, opts?.zone)) continue;
    if (grant.filter.zone === 'cast_from_hand' && opts?.fromZone && opts.fromZone !== 'hand') continue;
    if (!cardMatchesKeywordGrantFilter(card, grant.filter)) continue;
    if (grant.filter.firstThisTurn) {
      const already = Number(state?.spellsCastThisTurn?.[playerId] || state?.players?.find?.((p: any) => p?.id === playerId)?.spellsCastThisTurn || 0);
      if (already > 0) continue;
    }
    const resolved: SpellOrHandKeywordGrant = { ...grant };
    if (resolved.costEqualsManaCost && !resolved.cost) {
      const mana = String(card?.mana_cost || card?.manaCost || '').trim();
      if (mana) resolved.cost = mana;
    }
    return resolved;
  }
  const fromB104 = getBatch104GrantedKeyword(state, playerId, card, keyword, opts as any);
  if (fromB104) return fromB104 as SpellOrHandKeywordGrant;
  const fromB103 = getBatch103GrantedKeyword(state, playerId, card, keyword, opts as any);
  if (fromB103) return fromB103 as SpellOrHandKeywordGrant;
  return null;
}
