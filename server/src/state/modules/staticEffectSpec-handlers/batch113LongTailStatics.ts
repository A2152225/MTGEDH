// Batch 113 leftover static specs. Public: pushBatch113LongTailStaticSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import { parseBatch113StaticKind } from '../batch113Remaining.js';

export function pushBatch113LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const kind = parseBatch113StaticKind(String(oracle || ''));
  if (!kind) return;
  specs.push(buildSpec(source, `batch113-${kind}`, { kind: 'self' }, { abilities: [kind] } as any));
}
