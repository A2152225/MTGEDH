// server/src/state/modules/staticEffectSpecR35Conditions.ts
// R35 self-static conditions (census combat restriction long tail):
//   "defending player controls an untapped land" (Hazy Homunculus), "defending player has a rad counter" (Nightkin Ambusher)
//   "a player has no cards in hand" (Lupine Prototype), "you've cast two or more spells this turn" (Illvoi Infiltrator)
//   "you control no other creatures" (Jeskai Infiltrator)
//   Baeloth: target power less than the source's power.
// "You" is the evaluated permanent's controller (these phrases are only parsed for self-scoped statics),
// except target_power_less_than_source, which reads condition.sourcePermanentId.
// Public entry symbols: parseR35SelfCondition, evalR35StaticCondition.

import type { StaticEffectCondition } from './staticEffectSpecTypes.js';
import { getEffectivePower } from './goad-effects.js';
import { parseR36SelfCondition, evalR36StaticCondition } from './staticEffectSpecR36Conditions.js';

const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, no: 0 };
const num = (w: string): number | undefined => (/^\d+$/.test(w) ? Number(w) : WORDS[w]);

export function parseR35SelfCondition(raw: string): StaticEffectCondition | null {
  const c = String(raw || '').toLowerCase().replace(/\u2019/g, "'").trim().replace(/[.,]+$/, '');
  const r36 = parseR36SelfCondition(c);
  if (r36) return r36;
  let m = c.match(/^defending player controls an? (untapped |tapped )?([a-z]+(?: [a-z]+)?)$/);
  if (m) return { kind: 'defending_player_controls_matching', cardType: m[2], ...(m[1] ? { untapped: m[1].trim() === 'untapped', tapState: m[1].trim() } : {}) } as any;
  m = c.match(/^defending player has an? ([a-z]+) counters?$/);
  if (m) return { kind: 'defending_player_has_counter', counterType: m[1] } as any;
  m = c.match(/^a player has (no|\w+ or fewer) cards? in (?:their|his or her) hand$|^a player has (no) cards in hand$/);
  if (m) {
    const word = String(m[1] || m[2]).replace(/ or fewer$/, '');
    const amount = num(word);
    if (amount !== undefined) return { kind: 'any_player_hand_at_most', amount } as any;
  }
  m = c.match(/^you've cast (\w+) or more spells this turn$|^you've cast (another) spell this turn$/);
  if (m) {
    const amount = m[2] ? 2 : num(m[1]);
    if (amount !== undefined) return { kind: 'controller_spells_cast_this_turn_at_least', amount } as any;
  }
  // B72: Lyse Hext — "you've cast two or more noncreature spells this turn"
  m = c.match(/^you've cast (\w+) or more noncreature spells this turn$/);
  if (m) {
    const amount = num(m[1]);
    if (amount !== undefined) return { kind: 'controller_noncreature_spells_cast_at_least', amount } as any;
  }
  m = c.match(/^you control no other (creatures|artifacts|lands|enchantments|permanents)$/);
  if (m) return { kind: 'controller_controls_no_other', cardType: m[1].replace(/s$/, '') } as any;
  return null;
}

function typeLine(p: any): string {
  return String(p?.card?.type_line || p?.type_line || '').toLowerCase();
}

function defendingPlayerId(permanent: any, battlefield: readonly any[]): string {
  const target = String(permanent?.attacking || '').trim();
  if (!target) return '';
  const perm = battlefield.find((p) => String(p?.id || '') === target);
  return perm ? String(perm.controller || '') : target;
}

function playerCounters(state: any, id: string, kind: string): number {
  const player = (Array.isArray(state?.players) ? state.players : []).find((p: any) => String(p?.id || '') === id);
  const n = Number(state?.[kind + 'Counters']?.[id] ?? player?.counters?.[kind] ?? player?.[kind + 'Counters'] ?? state?.playerCounters?.[id]?.[kind]);
  return Number.isFinite(n) ? n : 0;
}

function handSize(state: any, id: string): number {
  const zone = state?.zones?.[id];
  if (typeof zone?.handCount === 'number') return zone.handCount;
  if (Array.isArray(zone?.hand)) return zone.hand.length;
  const player = (Array.isArray(state?.players) ? state.players : []).find((p: any) => String(p?.id || '') === id);
  return Array.isArray(player?.hand) ? player.hand.length : 0;
}

/** Returns undefined for kinds this module does not own. */
export function evalR35StaticCondition(condition: any, permanent: any, battlefield: readonly any[], state?: unknown): boolean | undefined {
  const st: any = state || {};
  const controller = String(permanent?.controller || '');
  switch (condition?.kind) {
    case 'defending_player_controls_matching': {
      const defender = defendingPlayerId(permanent, battlefield);
      if (!defender) return false;
      const words = String(condition.cardType || '').split(' ');
      return battlefield.some((p) => p && String(p.controller || '') === defender && words.every((w: string) => new RegExp('\\b' + w + 's?\\b').test(typeLine(p)))
        && (condition.tapState === 'untapped' ? !p.tapped : condition.tapState === 'tapped' ? !!p.tapped : true));
    }
    case 'defending_player_has_counter': {
      const defender = defendingPlayerId(permanent, battlefield);
      return !!defender && playerCounters(st, defender, String(condition.counterType || '')) > 0;
    }
    case 'any_player_hand_at_most': {
      const players: any[] = Array.isArray(st.players) ? st.players : [];
      return players.some((p) => p && !p.hasLost && handSize(st, String(p.id || '')) <= Number(condition.amount || 0));
    }
    case 'controller_spells_cast_this_turn_at_least': {
      const list: any[] = Array.isArray(st.spellsCastThisTurn) ? st.spellsCastThisTurn : [];
      const mine = list.filter((e) => String(e?.casterId ?? e?.playerId ?? e?.controllerId ?? e?.controller ?? '') === controller).length;
      return mine >= Number(condition.amount || 0);
    }
    case 'controller_controls_no_other': {
      const id = String(permanent?.id || '');
      const wanted = String(condition.cardType || 'permanent');
      return !battlefield.some((p) => p && !p.phasedOut && String(p.id || '') !== id && String(p.controller || '') === controller
        && (wanted === 'permanent' || new RegExp('\\b' + wanted + '\\b').test(typeLine(p))));
    }
    case 'target_power_less_than_source': {
      const source = battlefield.find((p) => String(p?.id || '') === String(condition.sourcePermanentId || ''));
      if (!source) return false;
      return getEffectivePower(permanent, state) < getEffectivePower(source, state);
    }
    default:
      return evalR36StaticCondition(condition, permanent, battlefield, state);
  }
}
