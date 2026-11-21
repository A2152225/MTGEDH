/**
 * staticAbilities.ts
 *
 * Handles static abilities that create continuous effects on the battlefield.
 * These effects modify characteristics of permanents without using the stack.
 *
 * Examples:
 * - Crusade: White creatures get +1/+1
 * - Glorious Anthem: Creatures you control get +1/+1
 * - Honor of the Pure: White creatures you control get +1/+1
 * - Lord of Atlantis: Other Merfolk get +1/+1 and islandwalk
 *
 * Based on MTG Comprehensive Rules:
 * - Rule 604: Handling Static Abilities
 * - Rule 611: Continuous Effects
 * - Rule 613: Layer System
 */

import type { BattlefieldPermanent, GameState } from '../../shared/src';
import {
  applyStaticAbilitiesToBattlefield as applyStaticAbilitiesToBattlefieldImpl,
  collectStaticAbilities as collectStaticAbilitiesImpl,
} from './staticAbilitiesBattlefield';
import { calculateEffectivePT, matchesFilter } from './staticAbilitiesEvaluation';
import { parseStaticAbilities } from './staticAbilitiesParsing';
import {
  StaticEffectType,
  type StaticAbility,
  type StaticEffectFilter,
} from './staticAbilitiesShared';

export { calculateEffectivePT, matchesFilter } from './staticAbilitiesEvaluation';
export { parseStaticAbilities } from './staticAbilitiesParsing';
export {
  StaticEffectType,
  type StaticAbility,
  type StaticEffectFilter,
} from './staticAbilitiesShared';

export function collectStaticAbilities(
  battlefield: BattlefieldPermanent[],
  gameState?: GameState
): StaticAbility[] {
  return collectStaticAbilitiesImpl(battlefield, parseStaticAbilities, gameState);
}

/**
 * Apply static abilities to all permanents and return updated state.
 */
const STATIC_RESULT_CACHE_MAX = 8;
const staticResultCache = new Map<string, BattlefieldPermanent[]>();

function staticBattlefieldCacheKey(battlefield: BattlefieldPermanent[], gameState?: GameState): string {
  let key = String(battlefield.length);
  for (const perm of battlefield) {
    const card = perm?.card as { name?: string; power?: string; toughness?: string } | undefined;
    const counters = (perm as { counters?: Record<string, number> })?.counters;
    let counterKey = '';
    if (counters && typeof counters === 'object') {
      for (const name of Object.keys(counters)) counterKey += `${name}${counters[name]}`;
    }
    key += `|${perm?.id}:${perm?.controller}:${(perm as { tapped?: boolean })?.tapped ? 1 : 0}:${card?.name || ''}:${card?.power || ''}/${card?.toughness || ''}:${counterKey}:${(perm as { attachedTo?: string })?.attachedTo || ''}`;
  }
  const players = gameState?.players;
  if (players) {
    for (const player of players) {
      const gone = (player as { hasLost?: boolean; eliminated?: boolean }).hasLost
        || (player as { eliminated?: boolean }).eliminated;
      key += `#${player.id}:${gone ? 1 : 0}`;
    }
  }
  return key;
}

export function applyStaticAbilitiesToBattlefield(
  battlefield: BattlefieldPermanent[],
  gameState?: GameState
): BattlefieldPermanent[] {
  if (!Array.isArray(battlefield) || battlefield.length === 0) {
    return applyStaticAbilitiesToBattlefieldImpl(battlefield, parseStaticAbilities, gameState);
  }
  const key = staticBattlefieldCacheKey(battlefield, gameState);
  const hit = staticResultCache.get(key);
  if (hit) {
    staticResultCache.delete(key);
    staticResultCache.set(key, hit);
    return hit;
  }
  const result = applyStaticAbilitiesToBattlefieldImpl(battlefield, parseStaticAbilities, gameState);
  staticResultCache.set(key, result);
  while (staticResultCache.size > STATIC_RESULT_CACHE_MAX) {
    const oldest = staticResultCache.keys().next().value;
    if (oldest === undefined) break;
    staticResultCache.delete(oldest);
  }
  return result;
}

export default {
  parseStaticAbilities,
  matchesFilter,
  calculateEffectivePT,
  collectStaticAbilities,
  applyStaticAbilitiesToBattlefield,
};
