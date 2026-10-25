// Origin parent: server/src/state/modules/staticEffectSpec.ts
// Cluster: live consumers of StaticEffectSpec "{T}-cost can't be activated" grants
// (Katabatic Winds / Serra Bestiary). Parse lives in cantAttack / massCantAttack.
// Public entry symbols: permanentCannotActivateTapAbilities, abilityTextIncludesTapCost.

import type { BattlefieldPermanent } from '../../../../shared/src/index.js';
import { CANT_ACTIVATE_TAP_ABILITIES } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingCantAttack.js';
import { getContinuousGrantedAbilitiesForPermanent } from './staticEffectSpec.js';
import { permanentLosesAllAbilities } from '../../../../rules-engine/src/permanentKeywordAbilities.js';

export { CANT_ACTIVATE_TAP_ABILITIES };

export function abilityTextIncludesTapCost(text: string): boolean {
  return /\{T\}/i.test(String(text || ''));
}

/**
 * Humility-style layer 6 loss: a permanent that "loses all abilities" can't activate
 * the abilities printed on it. Abilities granted to it (not in its printed text) still work.
 */
export function permanentLostPrintedActivatedAbility(
  permanent: BattlefieldPermanent | null | undefined,
  state: unknown,
  abilityText: string,
): boolean {
  const text = String(abilityText || '').trim().toLowerCase();
  if (!permanent || !text) return false;
  const printed = String((permanent as any)?.card?.oracle_text || '').toLowerCase();
  if (!printed.includes(text.slice(0, Math.min(text.length, 40)))) return false;
  const battlefield = Array.isArray((state as any)?.battlefield) ? (state as any).battlefield : [];
  const isMana = /\badd\b/i.test(text);
  if (!isMana && permanentLosesNonManaAbilities(permanent, battlefield)) return true;
  if (isMana && permanentLosesNonManaAbilities(permanent, battlefield)) return false;
  return permanentLosesAllAbilities(permanent, battlefield);
}

const NONMANA_LOSS_RE = /(?:^|[.\n]\s*)(?:all |each )?(lands|creatures|artifacts|enchantments|permanents)( you control| your opponents control)? lose all abilities except mana abilities/i;

/** Blood Sun (CR 613.1f): "All lands lose all abilities except mana abilities." */
export function permanentLosesNonManaAbilities(permanent: any, battlefield: readonly any[]): boolean {
  const typeLine = String(permanent?.typeSetOverride?.typeLine || permanent?.card?.type_line || '').toLowerCase();
  return (battlefield || []).some((source: any) => {
    if (!source?.card || source.phasedOut) return false;
    const m = NONMANA_LOSS_RE.exec(String(source.card.oracle_text || ''));
    if (!m) return false;
    const kind = m[1].toLowerCase().replace(/s$/, '');
    if (kind !== 'permanent' && !typeLine.includes(kind) && !(kind === 'creature' && permanent?.isCreature === true)) return false;
    const same = String(source.controller || '') === String(permanent?.controller || '');
    if (/you control/i.test(m[2] || '') && !same) return false;
    if (/opponents/i.test(m[2] || '') && same) return false;
    return true;
  });
}

export function permanentCannotActivateTapAbilities(
  permanent: BattlefieldPermanent | null | undefined,
  state: unknown,
): boolean {
  if (!permanent) return false;
  const granted = getContinuousGrantedAbilitiesForPermanent(permanent, state);
  return granted.includes(CANT_ACTIVATE_TAP_ABILITIES);
}
