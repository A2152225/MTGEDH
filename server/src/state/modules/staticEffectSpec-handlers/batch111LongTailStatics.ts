// Batch 111 long-tail static specs. Public: parseBatch111LongTailStaticKind,
// pushBatch111LongTailStaticSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import { parseBatch111StaticKind } from '../batch111Parsers.js';

export function parseBatch111LongTailStaticKind(oracle: string, cardName?: string): string | null {
  return parseBatch111StaticKind(oracle, cardName);
}

export function pushBatch111LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const text = String(oracle || '');
  if (!text.trim()) return;
  const kind = parseBatch111StaticKind(text, String((perm as any)?.card?.name || source.sourceName || ''));
  if (!kind) return;
  specs.push(buildSpec(source, `batch111-${kind}`, { kind: 'self' }, { abilities: [kind] } as any));
}
