// server/src/state/modules/staticEffectSpecR36Conditions.ts
// R36 static conditions (census attack/block-unless and conditional evasion long tail):
//   "there are five or more Islands on the battlefield" (Harbor Serpent)
//   "you control another creature with power 4 or greater" (Rhonas the Indomitable)
//   "you control more lands than defending player" (attack-time only, via the defender-conditioned gate)
//   "you control an Ashiok planeswalker" (Swimmer in Nightmares)
//   "you've cast a historic spell this turn" (Relic Runner)
//   target_lacks_keywords: "Creatures without flying or islandwalk ..." (Stormtide Leviathan), built by the mass parser.
// "You" is the evaluated permanent's controller, as in the R35 module.
// Public entry symbols: parseR36SelfCondition, evalR36StaticCondition.

import type { StaticEffectCondition } from './staticEffectSpecTypes.js';
import { getEffectivePower } from './goad-effects.js';
import { permanentMatchesScopeQualifier } from './staticEffectSpecScopeQualifier.js';

const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const num = (w: string): number | undefined => (/^\d+$/.test(w) ? Number(w) : WORDS[w]);

export function parseR36SelfCondition(raw: string): StaticEffectCondition | null {
  const c = String(raw || '').toLowerCase().replace(/\u2019/g, "'").trim().replace(/[.,]+$/, '');
  let m = c.match(/^there are (\w+) or more ([a-z]+?)s? on the battlefield$/);
  if (m && num(m[1]) !== undefined) return { kind: 'battlefield_type_count_at_least', cardType: m[2], amount: num(m[1]) } as any;
  m = c.match(/^you control another creature with power (\w+) or greater$/);
  if (m && num(m[1]) !== undefined) return { kind: 'controller_other_creature_power_at_least', amount: num(m[1]) } as any;
  m = c.match(/^you control more (land|creature|artifact|enchantment)s than defending player$/);
  if (m) return { kind: 'controller_more_than_defending', cardType: m[1] } as any;
  m = c.match(/^you control an? ([a-z]+) planeswalker$/);
  if (m) return { kind: 'controller_controls_words', words: [m[1], 'planeswalker'] } as any;
  m = c.match(/^you've cast an? ([a-z]+) spell this turn$/);
  if (m) return { kind: 'controller_cast_spell_matching_this_turn', match: m[1] } as any;
  return null;
}

function typeLine(p: any): string {
  return String(p?.card?.type_line || p?.type_line || '').toLowerCase();
}

const hasWord = (p: any, w: string): boolean => new RegExp('\\b' + w + 's?\\b').test(typeLine(p));

function defendingPlayerId(permanent: any, battlefield: readonly any[]): string {
  const target = String(permanent?.attacking || '').trim();
  if (!target) return '';
  const perm = battlefield.find((p) => String(p?.id || '') === target);
  return perm ? String(perm.controller || '') : target;
}

function spellMatches(entry: any, match: string): boolean {
  const tl = String(entry?.card?.type_line || entry?.type_line || entry?.typeLine || '').toLowerCase();
  if (match === 'historic') return /\b(?:legendary|artifact|saga)\b/.test(tl);
  if (match === 'multicolored') return (Array.isArray(entry?.card?.colors) ? entry.card.colors : []).length > 1;
  return new RegExp('\\b' + match + '\\b').test(tl);
}

/** Returns undefined for kinds this module does not own. */
export function evalR36StaticCondition(condition: any, permanent: any, battlefield: readonly any[], state?: unknown): boolean | undefined {
  const st: any = state || {};
  const controller = String(permanent?.controller || '');
  const live = battlefield.filter((p) => p && !p.phasedOut);
  switch (condition?.kind) {
    case 'battlefield_type_count_at_least':
      return live.filter((p) => hasWord(p, String(condition.cardType || ''))).length >= Number(condition.amount || 0);
    case 'controller_other_creature_power_at_least': {
      const id = String(permanent?.id || '');
      return live.some((p) => String(p.id || '') !== id && String(p.controller || '') === controller && /\bcreature\b/.test(typeLine(p))
        && getEffectivePower(p, state) >= Number(condition.amount || 0));
    }
    case 'controller_more_than_defending': {
      const defender = defendingPlayerId(permanent, battlefield);
      if (!defender) return false;
      const w = String(condition.cardType || '');
      const count = (who: string) => live.filter((p) => String(p.controller || '') === who && hasWord(p, w)).length;
      return count(controller) > count(defender);
    }
    case 'controller_controls_words': {
      const words: string[] = Array.isArray(condition.words) ? condition.words : [];
      return live.some((p) => String(p.controller || '') === controller && words.every((w) => hasWord(p, w)));
    }
    case 'controller_cast_spell_matching_this_turn': {
      const list: any[] = Array.isArray(st.spellsCastThisTurn) ? st.spellsCastThisTurn : [];
      return list.some((e) => String(e?.casterId ?? e?.playerId ?? e?.controller ?? '') === controller && spellMatches(e, String(condition.match || '')));
    }
    case 'target_lacks_keywords': {
      const kws: string[] = Array.isArray(condition.keywords) ? condition.keywords : [];
      return !kws.some((k) => permanentMatchesScopeQualifier(permanent, { keyword: k }));
    }
    default:
      return undefined;
  }
}
