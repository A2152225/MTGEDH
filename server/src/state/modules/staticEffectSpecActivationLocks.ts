// Origin parent: server/src/state/modules/staticEffectSpec.ts
// Cluster: live consumers of StaticEffectSpec "{T}-cost can't be activated" grants
// (Katabatic Winds / Serra Bestiary). Parse lives in cantAttack / massCantAttack.
// Public entry symbols: permanentCannotActivateTapAbilities, abilityTextIncludesTapCost.

import type { BattlefieldPermanent } from '../../../../shared/src/index.js';
import { CANT_ACTIVATE_TAP_ABILITIES } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingCantAttack.js';
import { getContinuousGrantedAbilitiesForPermanent } from './staticEffectSpec.js';

export { CANT_ACTIVATE_TAP_ABILITIES };

export function abilityTextIncludesTapCost(text: string): boolean {
  return /\{T\}/i.test(String(text || ''));
}

export function permanentCannotActivateTapAbilities(
  permanent: BattlefieldPermanent | null | undefined,
  state: unknown,
): boolean {
  if (!permanent) return false;
  const granted = getContinuousGrantedAbilitiesForPermanent(permanent, state);
  return granted.includes(CANT_ACTIVATE_TAP_ABILITIES);
}
