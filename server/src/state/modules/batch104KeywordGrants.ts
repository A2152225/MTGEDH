// server/src/state/modules/batch104KeywordGrants.ts
// B104 spell/hand/graveyard keyword grants the B95 "each/has" patterns miss:
// nonland hand miracle, exactly-N-color replicate, type-prowl, and GY-land
// dredge. Public: getBatch104GrantedKeyword.

import {
  parseNonlandCardsInHandHaveMiracle,
  parseLandCardsInGraveyardHaveDredge,
  parseExactlyNColorSpellsHaveReplicate,
  parseTypeSpellsYouCastHaveProwl,
} from './batch104Parsers.js';
import { readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

function colorsOf(card: any): string[] {
  if (Array.isArray(card?.colors)) return card.colors.map((c: any) => String(c).toUpperCase());
  const cost = String(card?.mana_cost || card?.manaCost || '').toUpperCase();
  return ['W', 'U', 'B', 'R', 'G'].filter((c) => cost.includes(`{${c}}`) || cost.includes(c));
}

function typeLine(card: any): string {
  return String(card?.type_line || card?.typeLine || '').toLowerCase();
}

function isNonland(card: any): boolean {
  return !/\bland\b/.test(typeLine(card));
}

export function getBatch104GrantedKeyword(
  state: any,
  playerId: string,
  card: any,
  keyword: string,
  opts?: { zone?: string; fromZone?: string },
): { keyword: string; cost?: string; numericValue?: number; sourcePermanentId?: string; sourceController?: string; sourceName?: string; filter: { words: string[]; disjunctive: boolean; zone: string } } | null {
  if (!card || !state) return null;
  const pid = String(playerId || '');
  const battlefield: any[] = Array.isArray(state.battlefield) ? state.battlefield : [];
  const zone = String(opts?.zone || opts?.fromZone || '');
  for (const perm of battlefield) {
    if (!perm || perm.phasedOut === true || !perm.card) continue;
    if (String(perm.controller || '') !== pid) continue;
    const oracle = readCardOracleText(perm.card);
    const source = {
      sourcePermanentId: String(perm.id || ''),
      sourceController: pid,
      sourceName: String(perm.card?.name || ''),
    };
    if (keyword === 'miracle') {
      const cost = parseNonlandCardsInHandHaveMiracle(oracle);
      if (cost && isNonland(card) && (!zone || zone === 'any' || zone === 'hand')) {
        return { keyword: 'miracle', cost, filter: { words: ['nonland'], disjunctive: false, zone: 'hand' }, ...source };
      }
    }
    if (keyword === 'replicate') {
      const parsed = parseExactlyNColorSpellsHaveReplicate(oracle);
      if (parsed && colorsOf(card).length === parsed.colors && (!zone || zone === 'any' || zone === 'cast')) {
        return { keyword: 'replicate', cost: parsed.cost, filter: { words: [], disjunctive: false, zone: 'cast' }, ...source };
      }
    }
    if (keyword === 'prowl') {
      const parsed = parseTypeSpellsYouCastHaveProwl(oracle);
      if (parsed && new RegExp('\\b' + parsed.typeWord.replace(/s$/, '') + 's?\\b').test(typeLine(card))
        && (!zone || zone === 'any' || zone === 'cast')) {
        return { keyword: 'prowl', cost: parsed.cost, filter: { words: [parsed.typeWord], disjunctive: false, zone: 'cast' }, ...source };
      }
    }
    if (keyword === 'dredge') {
      const n = parseLandCardsInGraveyardHaveDredge(oracle);
      if (n && /\bland\b/.test(typeLine(card)) && (!zone || zone === 'any' || zone === 'graveyard')) {
        return { keyword: 'dredge', numericValue: n, filter: { words: ['land'], disjunctive: false, zone: 'graveyard' }, ...source };
      }
    }
  }
  return null;
}
