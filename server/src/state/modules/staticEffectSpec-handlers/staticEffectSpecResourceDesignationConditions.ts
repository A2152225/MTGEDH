// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecResourceDesignationConditions.ts
// Static conditions read from player resources / designations rather than permanents:
// "as long as you have N or more unspent mana" (Ozai) and "as long as you have an enduring story"
// (Storied). Ported off the legacy regex static scan so they run through StaticEffectSpec.
// Public entry symbols: parseResourceDesignationCondition, evalResourceDesignationCondition.

import { getTotalManaFromPool } from '../mana-check.js';

const COUNT_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

type ResourceCondition =
  | { kind: 'source_controller_unspent_mana_at_least'; amount: number }
  | { kind: 'source_controller_has_enduring_story' };

/** Map a normalized "as long as" phrase to a resource/designation condition, or null. */
export function parseResourceDesignationCondition(phrase: string): ResourceCondition | null {
  const c = String(phrase || '').toLowerCase().trim().replace(/[.,]+$/, '');
  const mana = c.match(/^you have (\w+) or more unspent mana$/);
  if (mana) {
    const word = mana[1];
    const amount = /^\d+$/.test(word) ? Number(word) : COUNT_WORDS[word];
    return amount === undefined ? null : { kind: 'source_controller_unspent_mana_at_least', amount };
  }
  if (/^you have an enduring story$/.test(c)) return { kind: 'source_controller_has_enduring_story' };
  return null;
}

/** Undefined = not a kind this module owns. */
export function evalResourceDesignationCondition(
  condition: { kind?: string; amount?: number },
  controller: string,
  state: any,
): boolean | undefined {
  switch (condition.kind) {
    case 'source_controller_unspent_mana_at_least': {
      const pool = state?.manaPool?.[controller] || {};
      return getTotalManaFromPool(pool) >= Number(condition.amount || 0);
    }
    case 'source_controller_has_enduring_story':
      return Boolean(state?.enduringStory?.[controller]);
    default:
      return undefined;
  }
}
