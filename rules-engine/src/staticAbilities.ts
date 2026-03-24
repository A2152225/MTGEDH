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

import type { BattlefieldPermanent } from '../../shared/src';
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
  battlefield: BattlefieldPermanent[]
): StaticAbility[] {
  return collectStaticAbilitiesImpl(battlefield, parseStaticAbilities);
}

/**
 * Apply static abilities to all permanents and return updated state.
 */
export function applyStaticAbilitiesToBattlefield(
  battlefield: BattlefieldPermanent[]
): BattlefieldPermanent[] {
  return applyStaticAbilitiesToBattlefieldImpl(battlefield, parseStaticAbilities);
}

export default {
  parseStaticAbilities,
  matchesFilter,
  calculateEffectivePT,
  collectStaticAbilities,
  applyStaticAbilitiesToBattlefield,
};
