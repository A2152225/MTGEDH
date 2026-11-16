// server/src/state/modules/staticEffectSpec-handlers/batch91LongTailStatics.ts
// B91 long-tail statics: Henzie Toolbox Torre blitz grant (census + parse).
// Apply path lives in batch91BlitzCastGrants.ts (alternate-cost hook).

import type { StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { parseBatch91BlitzGrantSentence } from '../batch91BlitzCastGrants.js';

type Source = {
  sourcePermanentId: string;
  sourceController: string;
  sourceName: string;
};

function buildSpec(source: Source, idSuffix: string, scope: any, grant: any): StaticEffectSpec {
  return {
    id: `${source.sourcePermanentId}:${idSuffix}`,
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
    scope,
    grant,
  } as StaticEffectSpec;
}

export function parseBatch91StaticBlitzGrant(oracle: string): { minManaValue: number } | undefined {
  return parseBatch91BlitzGrantSentence(oracle);
}

export function pushBatch91LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: Source,
  _perm: unknown,
  oracle: string,
): void {
  const grant = parseBatch91StaticBlitzGrant(oracle);
  if (!grant) return;
  specs.push(buildSpec(
    source,
    'creature-spells-mv-has-blitz',
    { kind: 'controller' },
    {
      kind: 'granted_alternate_cost_on_cast',
      keyword: 'blitz',
      minManaValue: grant.minManaValue,
      costEqualsManaCost: true,
      spellType: 'creature',
    },
  ));
}
