// Batch 112 long-tail static specs. Public: parseBatch112LongTailStaticKind,
// pushBatch112LongTailStaticSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import { parseBatch112StaticKind } from '../batch112Parsers.js';

export function parseBatch112LongTailStaticKind(oracle: string, cardName?: string): string | null {
  return parseBatch112StaticKind(oracle, cardName);
}

export function pushBatch112LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const kind = parseBatch112StaticKind(String(oracle || ''), String((perm as any)?.card?.name || source.sourceName || ''));
  if (!kind) return;
  specs.push(buildSpec(source, `batch112-${kind}`, { kind: 'self' }, { abilities: [kind] } as any));
}
