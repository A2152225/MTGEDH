// server/src/state/modules/staticEffectSpec-handlers/batch103LongTailStatics.ts
// B103 long-tail statics. Public: parseBatch103LongTailStaticKind, pushBatch103LongTailStaticSpecs.

import type { StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import { parseCasualtyX } from '../batch101Parsers.js';
import {
  parseDefensiveFormation,
  parseTwelfthDoctorDemonstrate,
  parseOffBattlefieldSpellsAndPermanentsColorless,
  parseNonlandPermanentsYouControlAreColor,
  parseSpellsYouCastHaveRipple,
  parseHandCardsHaveWarp,
  parseCombatDamageCantBePrevented,
} from '../batch103Parsers.js';

export function parseBatch103LongTailStaticKind(oracle: string): string[] {
  const kinds: string[] = [];
  if (parseDefensiveFormation(oracle)) kinds.push('defender-assigns-combat-damage');
  if (parseCasualtyX(oracle)) kinds.push('casualty-x');
  if (parseTwelfthDoctorDemonstrate(oracle)) kinds.push('first-nonhand-spell-has-demonstrate');
  if (parseOffBattlefieldSpellsAndPermanentsColorless(oracle)) kinds.push('off-battlefield-spells-permanents-colorless');
  if (parseNonlandPermanentsYouControlAreColor(oracle)) kinds.push('nonland-permanents-you-control-are-color');
  if (parseSpellsYouCastHaveRipple(oracle)) kinds.push('spells-you-cast-have-ripple');
  if (parseHandCardsHaveWarp(oracle)) kinds.push('hand-cards-have-warp');
  if (parseCombatDamageCantBePrevented(oracle)) kinds.push('combat-damage-by-your-creatures-cant-be-prevented');
  return kinds;
}

export function pushBatch103LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: unknown,
  oracle: string,
): void {
  for (const kind of parseBatch103LongTailStaticKind(oracle)) {
    specs.push(buildSpec(
      source,
      kind,
      { kind: 'self' } as any,
      { abilities: [kind.replace(/-/g, '_')] } as any,
    ));
  }
}
