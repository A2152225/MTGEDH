// server/src/state/modules/staticEffectSpec-handlers/batch104LongTailStatics.ts
// B104 long-tail statics. Public: parseBatch104LongTailStaticKind, pushBatch104LongTailStaticSpecs.

import type { StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import {
  parseChosenQualityManaValueHaste,
  parseEnchantedCreatureHasPoisonous,
  parseOpponentsCreaturesAreIllusionAndSacrifice,
  parseCannotChooseUntappedPermanentAsTarget,
  parseCantBeBlockedUnlessDefenderControlsNSharingType,
  parsePlayersCantUntapMoreThanNNonbasicLands,
  parseGetsPTForEachGraveyardWithNCards,
  parseEnchantedArtifactCantAttackBlockOrActivate,
  parseCantBeBlockedIfPowerIsNOrLess,
  parseGetsPTForEachAuraYouControlAttachedToCreature,
  parseGetsPTAsLongAsOpponentControlsNonbasicLand,
  parseAllNonlandPermanentsAreLegendary,
  parseLandsYouControlAreTheChosenType,
  parsePlayersCantCastSpellsOfTheChosenType,
  parseNonlandCardsInHandHaveMiracle,
  parseLandCardsInGraveyardHaveDredge,
  parseExactlyNColorSpellsHaveReplicate,
  parseTypeSpellsYouCastHaveProwl,
  parseNontokenCreaturesYouControlHaveRiot,
  parseCreaturesYouControlButDontOwnAreType,
  parseEnchantedHasBasePowerAndQuoted,
} from '../batch104Parsers.js';

export function parseBatch104LongTailStaticKind(oracle: string): string[] {
  const kinds: string[] = [];
  if (parseChosenQualityManaValueHaste(oracle)) kinds.push('chosen-quality-mana-value-haste');
  if (parseEnchantedCreatureHasPoisonous(oracle) != null) kinds.push('enchanted-creature-has-poisonous');
  if (parseOpponentsCreaturesAreIllusionAndSacrifice(oracle)) kinds.push('opponents-creatures-illusion-sacrifice');
  if (parseCannotChooseUntappedPermanentAsTarget(oracle)) kinds.push('cannot-target-untapped-as-cast');
  if (parseCantBeBlockedUnlessDefenderControlsNSharingType(oracle) != null) kinds.push('cant-be-blocked-unless-defender-shares-type');
  if (parsePlayersCantUntapMoreThanNNonbasicLands(oracle) != null) kinds.push('cant-untap-more-than-n-nonbasic-lands');
  if (parseGetsPTForEachGraveyardWithNCards(oracle)) kinds.push('gets-pt-for-each-graveyard-with-n-cards');
  if (parseEnchantedArtifactCantAttackBlockOrActivate(oracle)) kinds.push('enchanted-artifact-cant-attack-block-or-activate');
  if (parseCantBeBlockedIfPowerIsNOrLess(oracle) != null) kinds.push('cant-be-blocked-if-power-n-or-less');
  if (parseGetsPTForEachAuraYouControlAttachedToCreature(oracle)) kinds.push('enchanted-gets-pt-per-aura-on-a-creature');
  if (parseGetsPTAsLongAsOpponentControlsNonbasicLand(oracle)) kinds.push('gets-pt-if-opponent-controls-nonbasic-land');
  if (parseAllNonlandPermanentsAreLegendary(oracle)) kinds.push('all-nonland-permanents-are-legendary');
  if (parseLandsYouControlAreTheChosenType(oracle)) kinds.push('lands-you-control-are-the-chosen-type');
  if (parsePlayersCantCastSpellsOfTheChosenType(oracle)) kinds.push('players-cant-cast-spells-of-the-chosen-type');
  if (parseNonlandCardsInHandHaveMiracle(oracle)) kinds.push('nonland-cards-in-hand-have-miracle');
  if (parseLandCardsInGraveyardHaveDredge(oracle) != null) kinds.push('land-cards-in-graveyard-have-dredge');
  if (parseExactlyNColorSpellsHaveReplicate(oracle)) kinds.push('exactly-n-color-spells-have-replicate');
  if (parseTypeSpellsYouCastHaveProwl(oracle)) kinds.push('type-spells-you-cast-have-prowl');
  if (parseNontokenCreaturesYouControlHaveRiot(oracle)) kinds.push('nontoken-creatures-you-control-have-riot');
  if (parseCreaturesYouControlButDontOwnAreType(oracle)) kinds.push('creatures-you-control-but-dont-own-are-type');
  if (parseEnchantedHasBasePowerAndQuoted(oracle)) kinds.push('enchanted-has-base-power-and-quoted');
  return kinds;
}

function pushHostGrant(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: any,
  idSuffix: string,
  grant: any,
): void {
  const hostId = String(perm?.attachedTo || '').trim();
  if (!hostId) return;
  specs.push({
    ...buildSpec(source, idSuffix, { kind: 'self' } as any, grant),
    sourcePermanentId: hostId,
    scope: { kind: 'self' } as any,
  });
}

export function pushBatch104LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: unknown,
  oracle: string,
): void {
  const rec = perm as { attachedTo?: string; chosenBasicLandType?: string; card?: { chosenBasicLandType?: string } } | undefined;
  const poisonous = parseEnchantedCreatureHasPoisonous(oracle);
  if (poisonous != null) {
    pushHostGrant(specs, source, rec, 'enchanted-poisonous', { abilities: [`poisonous ${poisonous}`] });
  }
  const illusion = parseOpponentsCreaturesAreIllusionAndSacrifice(oracle);
  if (illusion) {
    specs.push(buildSpec(
      source,
      'opponents-creatures-illusion-sacrifice',
      { kind: 'opponent_creatures' } as any,
      { typeAdditions: ['Illusion'], abilities: [illusion] } as any,
    ));
  }
  if (parseAllNonlandPermanentsAreLegendary(oracle)) {
    specs.push(buildSpec(
      source,
      'all-nonland-permanents-are-legendary',
      { kind: 'all_permanents', qualifier: { nonType: 'land' } } as any,
      { typeAdditions: ['Legendary'] } as any,
    ));
  }
  if (parseLandsYouControlAreTheChosenType(oracle)) {
    const chosen = String(rec?.chosenBasicLandType || rec?.card?.chosenBasicLandType || '').trim();
    if (chosen) {
      specs.push(buildSpec(
        source,
        'lands-you-control-are-the-chosen-type',
        { kind: 'lands_you_control' } as any,
        { typeAdditions: [chosen] } as any,
      ));
    }
  }
  if (parseNontokenCreaturesYouControlHaveRiot(oracle)) {
    specs.push(buildSpec(
      source,
      'nontoken-creatures-you-control-have-riot',
      { kind: 'creatures_you_control', qualifier: { token: false } } as any,
      { abilities: ['riot'] } as any,
    ));
  }
  const baseQuoted = parseEnchantedHasBasePowerAndQuoted(oracle);
  if (baseQuoted) {
    pushHostGrant(specs, source, rec, 'enchanted-base-power-and-quoted', {
      setPower: baseQuoted.power,
      abilities: [baseQuoted.quoted],
    });
  }

  for (const kind of parseBatch104LongTailStaticKind(oracle)) {
    if (
      kind === 'opponents-creatures-illusion-sacrifice'
      || kind === 'all-nonland-permanents-are-legendary'
      || (kind === 'lands-you-control-are-the-chosen-type' && String(rec?.chosenBasicLandType || rec?.card?.chosenBasicLandType || '').trim() !== '')
      || kind === 'nontoken-creatures-you-control-have-riot'
      || kind === 'enchanted-creature-has-poisonous'
      || kind === 'enchanted-has-base-power-and-quoted'
    ) {
      continue;
    }
    specs.push(buildSpec(
      source,
      kind,
      { kind: 'self' } as any,
      { abilities: [kind.replace(/-/g, '_')] } as any,
    ));
  }
}
