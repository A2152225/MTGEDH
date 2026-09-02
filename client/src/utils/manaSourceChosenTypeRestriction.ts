// Origin parent: client/src/utils/manaSourceBuilder.ts
// Cluster moved: chosen-type spend restriction overlay for inline mana abilities
//   (Cavern of Souls / Unclaimed Territory any-color vs unrestricted {C}).
// Public entry symbols: resolveInlineManaAbilitySpendRestriction,
//   inlineManaAbilityGrantsUncounterableChosenTypeCast.

import {
  chosenTypeManaAbilityGrantsUncounterableCast,
  getChosenTypeManaSpendRestriction,
  isAnyColorManaAbility,
} from '../../../shared/src/chosenTypeManaSpendRestriction';
import { parseManaSpendRestrictionFromOracleText } from './manaUtils';

export function resolveInlineManaAbilitySpendRestriction(
  perm: { chosenCreatureType?: string; card?: { oracle_text?: string } },
  ability: { id?: string; effect?: string; description?: string },
): { restriction: string; restrictedTo?: string } | undefined {
  const oracle = String(perm?.card?.oracle_text || '');
  const chosenType = getChosenTypeManaSpendRestriction(perm, oracle);
  if (chosenType && isAnyColorManaAbility(ability)) {
    return chosenType;
  }
  return parseManaSpendRestrictionFromOracleText(
    [String(ability.effect || ''), String(ability.description || ''), oracle].join('\n'),
  ) || undefined;
}

export function inlineManaAbilityGrantsUncounterableChosenTypeCast(
  perm: { chosenCreatureType?: string; card?: { oracle_text?: string } },
  ability: { id?: string; effect?: string; description?: string },
): boolean {
  if (!isAnyColorManaAbility(ability)) return false;
  const oracle = String(perm?.card?.oracle_text || '');
  if (!getChosenTypeManaSpendRestriction(perm, oracle)) return false;
  return chosenTypeManaAbilityGrantsUncounterableCast(oracle);
}
