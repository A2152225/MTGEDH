// server/src/state/modules/staticEffectSpecOpponentStateConditions.ts
// R24 census tail: "as long as" phrases about opponents' life / board and typed graveyard cards.
//   "an opponent has 10 or less life" (Guul Draz Vampire)            -> opponent_life_at_most
//   "your opponents control no creatures" (Erebos's Titan),
//   "no opponent controls a creature" (Vexing Beetle)                 -> no_opponent_controls_matching
//   "there is a land card in your graveyard" (Murasa Behemoth),
//   "there are two or more instant cards in your graveyard"           -> controller_graveyard_type_at_least
//   "Max speed — this creature gets +1/+2" (Walking Sarcophagus)   -> controller_speed_at_least
// Public entry symbols: parseOpponentStateCondition, evalOpponentStateCondition.

import type { StaticEffectCondition } from './staticEffectSpecTypes.js';
import { isCreatureTypeWord } from '../../../../shared/src/creatureTypes.js';
import { opponentControlsMatching } from './staticEffectSpecOpponentControlsCondition.js';

const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };
const num = (w: string): number | undefined => (/^\d+$/.test(w) ? Number(w) : NUM[w]);
const singular = (w: string): string => w.replace(/ies$/, 'y').replace(/s$/, '');

export function parseOpponentStateCondition(raw: string): StaticEffectCondition | null {
  const c = String(raw || '').toLowerCase().replace(/\u2019/g, "'").trim().replace(/[.,]+$/, '');
  let m = c.match(/^an opponent has (\w+) or less life$/);
  if (m && num(m[1]) !== undefined) return { kind: 'opponent_life_at_most', amount: num(m[1]) } as any;
  m = c.match(/^(?:your opponents control no|no opponent controls an?|no opponents control any) ([a-z]+?)s?$/);
  if (m) return { kind: 'no_opponent_controls_matching', cardType: singular(m[1]) } as any;
  m = c.match(/^a library has (\w+) or fewer cards in it$/);
  if (m && num(m[1]) !== undefined) return { kind: 'any_library_at_most', amount: num(m[1]) } as any;
  if (/^an opponent's life total is less than half (?:their|his or her) starting life total$/.test(c)) return { kind: 'opponent_life_below_half_starting' } as any;
  m = c.match(/^an opponent has (\w+) or more poison counters$/);
  if (m && num(m[1]) !== undefined) return { kind: 'opponent_poison_at_least', amount: num(m[1]) } as any;
  m = c.match(/^you control exactly (\w+) creatures?$/);
  if (m && num(m[1]) !== undefined) return { kind: 'controller_creature_count_exactly', amount: num(m[1]) } as any;
  // "has defender as long as it's a Wall" (Mistform Wall).
  m = c.match(/^(?:it|this creature|~)(?:'s| is) an? ([a-z]+)$/);
  if (m && isCreatureTypeWord(m[1][0].toUpperCase() + m[1].slice(1))) return { kind: 'target_has_creature_type', creatureType: m[1] } as any;
  m = c.match(/^there (?:is|are) (\w+)( or more)? ([a-z]+) cards? in your graveyard$/);
  if (m && num(m[1]) !== undefined && (m[2] || num(m[1]) === 1)) return { kind: 'controller_graveyard_type_at_least', cardType: m[3], amount: num(m[1]) } as any;
  return null;
}

function lifeOf(state: any, pid: string): number | undefined {
  const fromMap = state?.life?.[pid];
  if (typeof fromMap === 'number') return fromMap;
  const p = (state?.players || []).find((x: any) => String(x?.id || '') === pid);
  return typeof p?.life === 'number' ? p.life : undefined;
}

/** Returns undefined for kinds this module does not own. */
export function evalOpponentStateCondition(condition: { kind?: string; cardType?: string; amount?: number }, controller: string, battlefield: readonly any[], state: any): boolean | undefined {
  switch (condition.kind) {
    case 'opponent_life_at_most':
      return (state?.players || []).some((p: any) => {
        const id = String(p?.id || '');
        if (!id || id === controller || p?.hasLost || p?.eliminated) return false;
        const life = lifeOf(state, id);
        return typeof life === 'number' && life <= Number(condition.amount || 0);
      });
    case 'no_opponent_controls_matching':
      return !!controller && !opponentControlsMatching({ cardType: condition.cardType }, controller, battlefield as any, state);
    case 'controller_graveyard_type_at_least': {
      const gy = state?.zones?.[controller]?.graveyard;
      const re = new RegExp('\\b' + String(condition.cardType || '') + '\\b');
      const n = Array.isArray(gy) ? gy.filter((card: any) => re.test(String(card?.type_line || card?.card?.type_line || '').toLowerCase())).length : 0;
      return n >= Number(condition.amount || 1);
    }
    case 'any_library_at_most':
      return (state?.players || []).some((p: any) => {
        const z = state?.zones?.[String(p?.id || '')];
        const n = Array.isArray(z?.library) ? z.library.length : Number(z?.libraryCount);
        return Number.isFinite(n) && n <= Number(condition.amount || 0);
      });
    case 'opponent_life_below_half_starting': {
      const start = Number(state?.startingLife ?? 40);
      return (state?.players || []).some((p: any) => {
        const id = String(p?.id || ''); if (!id || id === controller || p?.hasLost) return false;
        const life = lifeOf(state, id); return typeof life === 'number' && life < start / 2;
      });
    }
    case 'opponent_poison_at_least':
      return (state?.players || []).some((p: any) => {
        const id = String(p?.id || ''); if (!id || id === controller) return false;
        return Number(state?.poisonCounters?.[id] ?? p?.counters?.poison ?? p?.poison ?? 0) >= Number(condition.amount || 0);
      });
    case 'controller_creature_count_exactly':
      return battlefield.filter((p: any) => String(p?.controller || '') === controller && !p?.phasedOut
        && /\bcreature\b/i.test(String(p?.typeSetOverride?.typeLine || p?.card?.type_line || ''))).length === Number(condition.amount);
    case 'controller_speed_at_least':
      return Number(state?.speed?.[controller] || 0) >= Number(condition.amount || 4);
    default:
      return undefined;
  }
}
