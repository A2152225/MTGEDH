// server/src/state/modules/staticEffectSpec-handlers/batch105LongTailStatics.ts
// B105 long-tail statics. Public: parseBatch105LongTailStaticKind, pushBatch105LongTailStaticSpecs.

import type { StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import {
  parseAreEquipmentInAdditionAndHaveQuoted,
  parseOpponentCreaturesAllAttackIfAble,
  parseCreaturesYouControlWithKeywordHaveQuotedActivated,
  parseAsHistoricPermanentYouControlEntersBecomes,
  parseGraveyardCardsHaveFlashbackEqualToManaCost,
  parseDuringCombatCantCastInstantsOrActivateNonMana,
  parseGetsPTAndKeywordWhenLifeGreaterThanStarting,
  parseAdditionalPTWhenLifeAtLeastNGreaterThanStarting,
  parseHasHasteAndWardAsLongAsCast,
  parseTheMonarchControlsEnchanted,
  parseEnchantedAttacksEachCombatIfAbleAndCantAttackYou,
  parsePowerEqualToGreatestMvAmongNoncreaturePermanentsAndGy,
  parseCantBeBlockedIfTypeEnteredThisTurn,
  parsePowerEqualToPermanentCardsInGyToughnessPlusOne,
  parseAurasAttachedToPermanentsYouControlHaveUmbraArmor,
  parseSubtypeYouControlGetPTForEachOtherAndCantBeBlockedByMono,
  parseCreaturesAttackingYourOpponentsHaveDoubleStrike,
  parseCreaturesLoseAllAbilities,
  parseOpponentsCantCastSpellsWithChosenName,
  parseCantAttackOrBlockUnlessCreatureDiedUnderYourControl,
  parseCreaturesCantBlock,
  parseGyCreatureCardsOfTypesHaveUnearth,
  parseOpponentWhoControlsMoreTypeCantCastOrPlay,
  parseGetsPTForEachColorPermanentOpponentsControlWithThreshold,
} from '../batch105Parsers.js';

export function parseBatch105LongTailStaticKind(oracle: string): string[] {
  const kinds: string[] = [];
  if (parseAreEquipmentInAdditionAndHaveQuoted(oracle)) kinds.push('are-equipment-in-addition-and-have-quoted');
  if (parseOpponentCreaturesAllAttackIfAble(oracle)) kinds.push('opponent-creatures-all-attack-if-able');
  if (parseCreaturesYouControlWithKeywordHaveQuotedActivated(oracle)) kinds.push('creatures-you-control-with-keyword-have-quoted');
  if (parseAsHistoricPermanentYouControlEntersBecomes(oracle)) kinds.push('historic-permanent-enters-becomes-creature');
  if (parseGraveyardCardsHaveFlashbackEqualToManaCost(oracle)) kinds.push('graveyard-cards-have-flashback-equal-to-mana-cost');
  if (parseDuringCombatCantCastInstantsOrActivateNonMana(oracle)) kinds.push('during-combat-cant-cast-instants-or-activate-nonmana');
  if (parseGetsPTAndKeywordWhenLifeGreaterThanStarting(oracle)) kinds.push('gets-pt-and-keyword-when-life-greater-than-starting');
  if (parseAdditionalPTWhenLifeAtLeastNGreaterThanStarting(oracle)) kinds.push('additional-pt-when-life-at-least-n-greater-than-starting');
  if (parseHasHasteAndWardAsLongAsCast(oracle)) kinds.push('has-haste-and-ward-as-long-as-cast');
  if (parseTheMonarchControlsEnchanted(oracle)) kinds.push('the-monarch-controls-enchanted');
  if (parseEnchantedAttacksEachCombatIfAbleAndCantAttackYou(oracle)) kinds.push('enchanted-attacks-each-combat-and-cant-attack-you');
  if (parsePowerEqualToGreatestMvAmongNoncreaturePermanentsAndGy(oracle)) kinds.push('power-equal-greatest-mv-noncreature-permanents-and-gy');
  if (parseCantBeBlockedIfTypeEnteredThisTurn(oracle)) kinds.push('cant-be-blocked-if-type-entered-this-turn');
  if (parsePowerEqualToPermanentCardsInGyToughnessPlusOne(oracle)) kinds.push('power-permanent-cards-in-gy-toughness-plus-one');
  if (parseAurasAttachedToPermanentsYouControlHaveUmbraArmor(oracle)) kinds.push('auras-you-control-attached-have-umbra-armor');
  if (parseSubtypeYouControlGetPTForEachOtherAndCantBeBlockedByMono(oracle)) kinds.push('subtype-you-control-pt-for-each-other-and-cant-be-blocked-by-mono');
  if (parseCreaturesAttackingYourOpponentsHaveDoubleStrike(oracle)) kinds.push('creatures-attacking-your-opponents-have-double-strike');
  if (parseCreaturesLoseAllAbilities(oracle)) kinds.push('creatures-lose-all-abilities');
  if (parseOpponentsCantCastSpellsWithChosenName(oracle)) kinds.push('opponents-cant-cast-spells-with-chosen-name');
  if (parseCantAttackOrBlockUnlessCreatureDiedUnderYourControl(oracle)) kinds.push('cant-attack-or-block-unless-creature-died-under-your-control');
  if (parseCreaturesCantBlock(oracle)) kinds.push('creatures-cant-block');
  if (parseGyCreatureCardsOfTypesHaveUnearth(oracle)) kinds.push('gy-creature-cards-of-types-have-unearth');
  if (parseOpponentWhoControlsMoreTypeCantCastOrPlay(oracle).length > 0) kinds.push('opponent-who-controls-more-type-cant-cast-or-play');
  if (parseGetsPTForEachColorPermanentOpponentsControlWithThreshold(oracle)) kinds.push('gets-pt-for-each-color-permanent-opponents-control-threshold');
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

export function pushBatch105LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: unknown,
  oracle: string,
): void {
  const rec = perm as { attachedTo?: string; controller?: string } | undefined;

  const equipment = parseAreEquipmentInAdditionAndHaveQuoted(oracle);
  if (equipment) {
    const qualifier: any = {};
    if (equipment.excludedTypeWords.includes('creature')) qualifier.nonCreature = true;
    if (equipment.excludedTypeWords.includes('equipment')) qualifier.nonEquipment = true;
    specs.push(buildSpec(
      source,
      'are-equipment-in-addition-and-have-quoted',
      { kind: 'all', type: equipment.type, controller: 'you', qualifier } as any,
      { typeAdditions: ['Equipment'], abilities: [equipment.fragment] } as any,
    ));
  }

  const quoted = parseCreaturesYouControlWithKeywordHaveQuotedActivated(oracle);
  if (quoted) {
    specs.push(buildSpec(
      source,
      'creatures-you-control-with-keyword-have-quoted',
      { kind: 'creatures_you_control', qualifier: { keyword: quoted.keyword } } as any,
      { abilities: [quoted.ability] } as any,
    ));
  }

  if (parseEnchantedAttacksEachCombatIfAbleAndCantAttackYou(oracle)) {
    pushHostGrant(specs, source, rec, 'enchanted-attacks-each-combat-and-cant-attack-you', {
      abilities: ['attacks each combat if able', "can't attack you"],
    });
  }

  if (parseAurasAttachedToPermanentsYouControlHaveUmbraArmor(oracle)) {
    specs.push(buildSpec(
      source,
      'auras-you-control-attached-have-umbra-armor',
      { kind: 'auras_attached_to_permanents_you_control' } as any,
      { abilities: ['umbra armor'] } as any,
    ));
  }

  if (parseCreaturesAttackingYourOpponentsHaveDoubleStrike(oracle)) {
    specs.push(buildSpec(
      source,
      'creatures-attacking-your-opponents-have-double-strike',
      { kind: 'creatures_attacking_your_opponents' } as any,
      { abilities: ['double strike'] } as any,
    ));
  }

  const skipFallback = new Set([
    'are-equipment-in-addition-and-have-quoted',
    'creatures-you-control-with-keyword-have-quoted',
    'enchanted-attacks-each-combat-and-cant-attack-you',
    'auras-you-control-attached-have-umbra-armor',
    'creatures-attacking-your-opponents-have-double-strike',
  ]);
  for (const kind of parseBatch105LongTailStaticKind(oracle)) {
    if (skipFallback.has(kind)) continue;
    specs.push(buildSpec(
      source,
      kind,
      { kind: 'self' } as any,
      { abilities: [kind.replace(/-/g, '_')] } as any,
    ));
  }
}
