/**
 * Origin parent: server/src/socket/ai-handlers/aiPaymentSources.ts
 *
 * Cluster moved: prefer Cavern-style uncounterable chosen-type any-color mana
 * when the spell is a creature of the chosen type. `{C}` on the same land is
 * unrestricted and must not get this boost.
 *
 * Public entry symbols: spendRestrictionGrantsUncounterableChosenTypeCast,
 *   AI_UNCOUNTERABLE_CHOSEN_TYPE_COLOR_SCORE,
 *   AI_UNCOUNTERABLE_CHOSEN_TYPE_GENERIC_SCORE.
 */

import { chosenTypeManaAbilityGrantsUncounterableCast } from '../../../../shared/src/chosenTypeManaSpendRestriction.js';
import {
  restrictedManaSpendRestrictionAllowsPurpose,
  type RestrictedManaSpendPurpose,
} from '../util.js';
import type { ManaRestrictionType } from '../../../../shared/src/types.js';

/** Beats a basic land on the color pass (Forest ~60 vs Cavern any-color ~25). */
export const AI_UNCOUNTERABLE_CHOSEN_TYPE_COLOR_SCORE = 40;
/** Beats unrestricted `{C}` generic scoring (`+50` unrestricted + `+10` C ≈ 200). */
export const AI_UNCOUNTERABLE_CHOSEN_TYPE_GENERIC_SCORE = 80;

export function spendRestrictionGrantsUncounterableChosenTypeCast(
  spendRestriction: { restriction: ManaRestrictionType; restrictedTo?: string } | null | undefined,
  permanent: { card?: { oracle_text?: string } } | null | undefined,
  purpose?: RestrictedManaSpendPurpose,
): boolean {
  if (!purpose || !spendRestriction?.restriction) return false;
  if (!restrictedManaSpendRestrictionAllowsPurpose(spendRestriction, purpose)) return false;
  return chosenTypeManaAbilityGrantsUncounterableCast(String(permanent?.card?.oracle_text || ''));
}
