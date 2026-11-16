// server/src/state/modules/batch103KeywordGrants.ts
// B103 spell/hand keyword grants that the B95 "each/has" patterns miss:
// "spells you cast have ripple N" is already in B95 once 'ripple' is in the
// keyword list; "artifact cards and COLOR creature cards in your hand have
// warp {cost}" is collected here. Public: getBatch103GrantedKeyword.

import { parseHandCardsHaveWarp, parseSpellsYouCastHaveRipple } from './batch103Parsers.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

function colorsOf(card: any): string[] {
  if (Array.isArray(card?.colors)) return card.colors.map((c: any) => String(c).toUpperCase());
  const cost = String(card?.mana_cost || card?.manaCost || '').toUpperCase();
  return ['W', 'U', 'B', 'R', 'G'].filter((c) => cost.includes(`{${c}}`) || cost.includes(c));
}

function typeLine(card: any): string {
  return String(card?.type_line || card?.typeLine || '').toLowerCase();
}

const COLOR_WORDS: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

function warpFilterMatches(oracle: string, card: any): boolean {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  const m = text.match(/artifact cards and (white|blue|black|red|green) creature cards in your hand have warp/i);
  if (!m) {
    return parseHandCardsHaveWarp(text) != null && /\bartifact\b/.test(typeLine(card));
  }
  const color = COLOR_WORDS[m[1].toLowerCase()];
  const tl = typeLine(card);
  if (/\bartifact\b/.test(tl)) return true;
  if (/\bcreature\b/.test(tl) && color && colorsOf(card).includes(color)) return true;
  return false;
}

export function getBatch103GrantedKeyword(
  state: any,
  playerId: string,
  card: any,
  keyword: string,
  opts?: { zone?: string; fromZone?: string },
): { keyword: string; cost?: string; numericValue?: number; sourcePermanentId?: string; sourceController?: string; sourceName?: string; filter: { words: string[]; disjunctive: boolean; zone: string } } | null {
  if (!card || !state) return null;
  const pid = String(playerId || '');
  const battlefield: any[] = Array.isArray(state.battlefield) ? state.battlefield : [];
  for (const perm of battlefield) {
    if (!perm || perm.phasedOut === true || !perm.card) continue;
    if (String(perm.controller || '') !== pid) continue;
    const oracle = readCardOracleText(perm.card);
    const source = {
      sourcePermanentId: String(perm.id || ''),
      sourceController: pid,
      sourceName: String(perm.card?.name || ''),
    };
    if (keyword === 'ripple') {
      const n = parseSpellsYouCastHaveRipple(oracle);
      if (n && (!opts?.zone || opts.zone === 'any' || opts.zone === 'cast')) {
        return { keyword: 'ripple', numericValue: n, filter: { words: [], disjunctive: false, zone: 'cast' }, ...source };
      }
    }
    if (keyword === 'warp') {
      const warp = parseHandCardsHaveWarp(oracle);
      if (warp && warpFilterMatches(oracle, card) && (!opts?.zone || opts.zone === 'any' || opts.zone === 'hand')) {
        return { keyword: 'warp', cost: warp.cost, filter: { words: [], disjunctive: true, zone: 'hand' }, ...source };
      }
    }
  }
  return null;
}
