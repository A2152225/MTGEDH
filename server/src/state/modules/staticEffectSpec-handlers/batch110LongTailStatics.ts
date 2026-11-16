// server/src/state/modules/staticEffectSpec-handlers/batch110LongTailStatics.ts
// B110 long-tail static specs. Public: parseBatch110LongTailStaticKind,
// pushBatch110LongTailStaticSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import {
  parseAlsoPTAndKeywordAtCreatureCount,
  parseCreaturesAttackingLastChosenPlayerPT,
  parseCreaturesYouControlPTWhereXIsEnteredThisTurn,
  parseCreaturesYouControlWithPlusCountersAreArtifacts,
  parseEachCreatureYouControlPTPerCounter,
  parseNonartifactCreaturesGetPT,
  parseSelfPTWhereXIsOtherCreaturesWithBasePower,
} from '../batch110Parsers.js';

export function parseBatch110LongTailStaticKind(oracle: string): string | null {
  if (parseEachCreatureYouControlPTPerCounter(oracle)) return 'pt_per_counter';
  if (parseSelfPTWhereXIsOtherCreaturesWithBasePower(oracle)) return 'other_base_power_pt';
  if (parseCreaturesYouControlPTWhereXIsEnteredThisTurn(oracle)) return 'entered_this_turn_pt';
  if (parseAlsoPTAndKeywordAtCreatureCount(oracle).length > 0) return 'also_pt_at_count';
  if (parseCreaturesYouControlWithPlusCountersAreArtifacts(oracle)) return 'plus_counters_are_artifacts';
  if (parseNonartifactCreaturesGetPT(oracle)) return 'nonartifact_pt';
  if (parseCreaturesAttackingLastChosenPlayerPT(oracle)) return 'attacking_chosen_player_pt';
  return null;
}

export function pushBatch110LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: BattlefieldPermanent,
  oracle: string,
): void {
  const text = String(oracle || '');
  if (!text.trim()) return;
  const kind = parseBatch110LongTailStaticKind(text);
  if (!kind) return;
  specs.push(buildSpec(source, `batch110-${kind}`, { kind: 'self' }, { abilities: [kind] } as any));
}
