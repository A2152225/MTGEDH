/**
 * Payment-row overlay for battlefield basic-land-type grants.
 * Urborg / Yavimaya have no printed "{T}: Add"; the type they grant to every
 * land, including themselves, is the intrinsic mana ability.
 */

import type { BattlefieldPermanent, ManaColor } from '../../../shared/src';
import { grantedBasicLandTypesFromBattlefield } from '../../../shared/src/battlefieldBasicLandTypeGrants';
import { manaColorForBasicLandType } from '../../../shared/src/landTypes';
import type { ManaPaymentSource } from './manaUtils';

function grantedManaColors(
  perm: BattlefieldPermanent,
  battlefield: readonly BattlefieldPermanent[],
): ManaColor[] {
  const colors: ManaColor[] = [];
  for (const landType of grantedBasicLandTypesFromBattlefield(perm as any, battlefield as any)) {
    const color = manaColorForBasicLandType(landType);
    if (color && !colors.includes(color)) colors.push(color);
  }
  return colors;
}

function syntheticGrantedSource(perm: BattlefieldPermanent, colors: ManaColor[]): ManaPaymentSource {
  const permanentId = String(perm.id || '');
  const name = String(perm.card && 'name' in perm.card ? perm.card.name : 'Land');
  return {
    id: `${permanentId}::granted-basic-land`,
    sourcePermanentId: permanentId,
    abilityId: 'granted-basic-land',
    name,
    label: `Add ${colors.map((color) => `{${color}}`).join(' or ')}`,
    options: colors,
  };
}

function isSingleManaTapSource(source: ManaPaymentSource): boolean {
  if ((source.amount ?? 1) !== 1) return false;
  if (source.activationManaCost) return false;
  if (source.sacrificeCost) return false;
  if (source.consumable) return false;
  return true;
}

/**
 * Add intrinsic mana from "each/all lands are [basic type] in addition" effects.
 * One tap still produces one mana: granted colors join a lone single-mana row,
 * or become an alternate row when the land already has several abilities.
 */
export function withBattlefieldGrantedLandManaSources(
  perm: BattlefieldPermanent,
  battlefield: readonly BattlefieldPermanent[],
  sources: ManaPaymentSource[],
): ManaPaymentSource[] {
  const granted = grantedManaColors(perm, battlefield);
  if (granted.length === 0) return sources;

  const covered = new Set<ManaColor>();
  for (const source of sources) {
    for (const option of source.options || []) covered.add(option);
  }
  const missing = granted.filter((color) => !covered.has(color));
  if (missing.length === 0) return sources;

  if (sources.length === 0) {
    return [syntheticGrantedSource(perm, missing)];
  }

  if (sources.length === 1 && isSingleManaTapSource(sources[0])) {
    const existing = sources[0];
    const options = [...existing.options];
    for (const color of missing) {
      if (!options.includes(color)) options.push(color);
    }
    return [{ ...existing, options }];
  }

  return [...sources, syntheticGrantedSource(perm, missing)];
}
