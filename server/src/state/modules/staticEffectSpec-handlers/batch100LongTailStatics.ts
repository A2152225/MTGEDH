// server/src/state/modules/staticEffectSpec-handlers/batch100LongTailStatics.ts
// B100 long-tail statics: Stasis skip-untap, Tomik land targeting / GY play
// lock, Arvinox isn't-a-creature-unless, Platypus-Bear lesson-GY defender
// exception, Sulu station/crew multiplier, Tapestry station-with-toughness,
// Tyvar/Thousand-Year Elixir activate-as-though-haste.
// Public: parseBatch100LongTailStaticKind, pushBatch100LongTailStaticSpecs,
//   parsers re-exported from batch100CombatAndKeywords.

import type { StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import {
  parsePlayersSkipUntapSteps,
  parseTomikLandProtection,
  parseIsntCreatureUnlessDontOwn,
  parseLessonGraveyardNoDefender,
  parseStationCrewPowerTripled,
  parseStationWithToughnessWhenGreater,
  parseActivateAsThoughHaste,
  parseMoreLandsThanAttackingPlayerToBlock,
  parseAnnihilatorXFromCounters,
} from '../batch100CombatAndKeywords.js';

export function parseBatch100LongTailStaticKind(oracle: string): string[] {
  const kinds: string[] = [];
  if (parsePlayersSkipUntapSteps(oracle)) kinds.push('players-skip-untap-steps');
  if (parseTomikLandProtection(oracle)) kinds.push('lands-untargetable-and-opponents-cant-play-from-graveyards');
  if (parseIsntCreatureUnlessDontOwn(oracle)) kinds.push('isnt-creature-unless-control-permanents-you-dont-own');
  if (parseLessonGraveyardNoDefender(oracle)) kinds.push('can-attack-as-though-no-defender-if-lesson-in-graveyard');
  if (parseStationCrewPowerTripled(oracle)) kinds.push('stations-and-crews-as-though-power-tripled');
  if (parseStationWithToughnessWhenGreater(oracle)) kinds.push('station-using-toughness-when-greater-than-power');
  if (parseActivateAsThoughHaste(oracle)) kinds.push('activate-abilities-as-though-had-haste');
  if (parseMoreLandsThanAttackingPlayerToBlock(oracle)) kinds.push('cant-block-unless-more-lands-than-attacking-player');
  if (parseAnnihilatorXFromCounters(oracle)) kinds.push('annihilator-x-from-p1p1-counters');
  return kinds;
}

export function pushBatch100LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: unknown,
  oracle: string,
): void {
  for (const kind of parseBatch100LongTailStaticKind(oracle)) {
    specs.push(buildSpec(
      source,
      kind,
      { kind: 'self' } as any,
      { abilities: [kind.replace(/-/g, '_')] } as any,
    ));
  }
}
