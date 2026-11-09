// server/src/state/modules/staticEffectSpec-handlers/batch63LongTailStatics.ts
// B63 static long-tail entry: loyalty CDA, attacking-last-chosen grants, Yixlid marker.
// Public: pushBatch63LongTailStaticSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectSpec } from '../staticEffectSpecTypes.js';
import type { StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import { buildSpec } from './staticEffectSpecOracleParseHelpers.js';
import { pushLoyaltyThresholdCreatureCdaSpecs } from './batch63LoyaltyCdaStatics.js';
import { pushCreaturesAttackingLastChosenPlayerGrantSpecs } from './batch63AttackChosenPlayerGrants.js';
import { oracleHasGyLoseAllAbilities } from '../gyLoseAllAbilitiesStatic.js';

export function pushBatch63LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushLoyaltyThresholdCreatureCdaSpecs(specs, source, oracle);
  pushCreaturesAttackingLastChosenPlayerGrantSpecs(specs, source, oracle);
  if (oracleHasGyLoseAllAbilities(oracle)) {
    // Marker so line-alone census counts declarative-handled; effect applied via gyLoseAllAbilitiesStatic.
    specs.push(buildSpec(
      source,
      'gy-lose-all-abilities',
      { kind: 'self' },
      { removeAbilities: ['*'] } as any,
    ));
  }
}
