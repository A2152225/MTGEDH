// server/src/state/modules/staticEffectSpec-handlers/batch102LongTailStatics.ts
// B102 long-tail statics. Public: parseBatch102LongTailStaticKind, pushBatch102LongTailStaticSpecs.

import type { StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import {
  parseSanctuaryBladeColorChoice,
  parseProtectionFromLastChosenColor,
  parseCreaturesWithoutFlyingDontUntap,
  parseArboriaAttackRestriction,
  parseIdrisExiledAbilitiesAndPump,
  parseGoblinsAndElementalsHaveMenace,
  parseNoblesAndLessonsHaveLifelink,
  parseEnchantedMinusXPowerFromControllerGy,
  parseOtherCreaturesGetMinusOneMinusOne,
  parseNamedPermanentCastLock,
  parseDomainLandwalk,
  parseBlockingOrBlockedHaveLifelink,
  parseDuringYourTurnBasePT,
  parseDivinityCounterIndestructible,
  parseCluesYouControlAreEquipment,
  parseCrewsUsingToughness,
  parseEnchantedCantBeBlockedIfGate,
  parseEnchantedIsFlagbearer,
  parseAttackingYourOpponentHasTrample,
  parseHexproofUnlessAttacking,
  parseEightCountersIsCreatureAnnihilator,
} from '../batch102Parsers.js';

export function parseBatch102LongTailStaticKind(oracle: string): string[] {
  const kinds: string[] = [];
  if (parseSanctuaryBladeColorChoice(oracle) || parseProtectionFromLastChosenColor(oracle)) kinds.push('protection-from-last-chosen-color');
  if (parseCreaturesWithoutFlyingDontUntap(oracle)) kinds.push('creatures-without-flying-dont-untap');
  if (parseArboriaAttackRestriction(oracle)) kinds.push('cant-attack-unless-cast-or-nontoken-last-turn');
  if (parseIdrisExiledAbilitiesAndPump(oracle)) kinds.push('exiled-card-abilities-and-mv-pump');
  if (parseGoblinsAndElementalsHaveMenace(oracle)) kinds.push('goblins-and-elementals-have-menace');
  if (parseNoblesAndLessonsHaveLifelink(oracle)) kinds.push('nobles-and-lessons-have-lifelink');
  if (parseEnchantedMinusXPowerFromControllerGy(oracle)) kinds.push('enchanted-minus-x-power-from-controller-gy');
  if (parseOtherCreaturesGetMinusOneMinusOne(oracle)) kinds.push('other-creatures-get-minus-1-minus-1');
  if (parseNamedPermanentCastLock(oracle)) kinds.push('cast-only-if-no-permanents-of-this-name');
  if (parseDomainLandwalk(oracle)) kinds.push('domain-landwalk');
  if (parseBlockingOrBlockedHaveLifelink(oracle)) kinds.push('blocking-or-blocked-have-lifelink');
  if (parseDuringYourTurnBasePT(oracle)) kinds.push('during-your-turn-base-pt');
  if (parseDivinityCounterIndestructible(oracle)) kinds.push('divinity-counter-indestructible');
  if (parseCluesYouControlAreEquipment(oracle)) kinds.push('clues-you-control-are-equipment');
  if (parseCrewsUsingToughness(oracle)) kinds.push('crews-vehicles-using-toughness');
  if (parseEnchantedCantBeBlockedIfGate(oracle)) kinds.push('enchanted-cant-be-blocked-if-gate');
  if (parseEnchantedIsFlagbearer(oracle)) kinds.push('enchanted-is-flagbearer');
  if (parseAttackingYourOpponentHasTrample(oracle)) kinds.push('attacking-your-opponent-has-trample');
  if (parseHexproofUnlessAttacking(oracle)) kinds.push('hexproof-unless-attacking');
  if (parseEightCountersIsCreatureAnnihilator(oracle)) kinds.push('eight-counters-creature-annihilator');
  return kinds;
}

export function pushBatch102LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: unknown,
  oracle: string,
): void {
  for (const kind of parseBatch102LongTailStaticKind(oracle)) {
    specs.push(buildSpec(
      source,
      kind,
      { kind: 'self' } as any,
      { abilities: [kind.replace(/-/g, '_')] } as any,
    ));
  }
}
