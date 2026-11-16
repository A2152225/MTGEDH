// server/src/state/modules/staticEffectSpec-handlers/batch106LongTailStatics.ts
// B106 long-tail static specs. Public: parseBatch106LongTailStaticKind, pushBatch106LongTailStaticSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import {
  parseYouHaveHexproof,
  parseCreaturesYouControlWithPlusCountersCopyExiledActivated,
  parseHasEachActivatedAbilityOfCraftExiledCards,
  parseEnchantedCreatureGetsPTAndHasAfterlife,
  parseGyCardsHaveEncore,
  parseGetsPlusXPowerGreatestGyCreaturePower,
  parsePowerToughnessEqualToTotalPowerOfCraftExiled,
  parsePowerToughnessEqualToColorsAmongCraftExiled,
  parsePowerToughnessEqualToTwentyMinusHighestLife,
  parsePowerToughnessEqualToNonbasicLandsChosenPlayerControls,
  parsePowerEqualToInstantAndSorceryYouOwnInExileAndGy,
  parseEachPlayerSkipsTheirUntapStep,
  parseNonlandPermanentsYouControlAreEnchantmentsInAddition,
  parseGetsPlusOneForEachOtherSameName,
  parseCreaturesOfTypeGetPTPerCounterOnThem,
  parseCreaturesYouDontControlGetPTPerCounterOnThem,
  parseEnchantedCanAttackAsThoughItDidntHaveDefender,
  parseAllCreaturesAttackEnchantedControllerIfAble,
  parseCreaturesYouControlCantAttackExceptNamedAndArtifact,
  parseCreaturesWithNamedCountersAttackEachCombatIfAble,
  parseHasFlyingEtcAsLongAsCraftExiledCardHasKeyword,
  parseSpendManaAsAnyToActivateCreatureAbilities,
} from '../batch106Parsers.js';

export function parseBatch106LongTailStaticKind(oracle: string): string | null {
  if (parseYouHaveHexproof(oracle)) return 'you_have_hexproof';
  if (parseCreaturesYouControlWithPlusCountersCopyExiledActivated(oracle)) return 'plus_counter_creatures_copy_exiled_activated';
  if (parseHasEachActivatedAbilityOfCraftExiledCards(oracle)) return 'craft_exiled_activated';
  if (parseEnchantedCreatureGetsPTAndHasAfterlife(oracle)) return 'enchanted_pt_afterlife';
  if (parseGyCardsHaveEncore(oracle)) return 'gy_cards_have_encore';
  if (parseGetsPlusXPowerGreatestGyCreaturePower(oracle)) return 'plus_x_greatest_gy_creature_power';
  if (parsePowerToughnessEqualToTotalPowerOfCraftExiled(oracle)) return 'cda_total_power_craft_exiled';
  if (parsePowerToughnessEqualToColorsAmongCraftExiled(oracle)) return 'cda_colors_craft_exiled';
  if (parsePowerToughnessEqualToTwentyMinusHighestLife(oracle)) return 'cda_20_minus_highest_life';
  if (parsePowerToughnessEqualToNonbasicLandsChosenPlayerControls(oracle)) return 'cda_nonbasic_lands_chosen_player';
  if (parsePowerEqualToInstantAndSorceryYouOwnInExileAndGy(oracle)) return 'cda_instant_sorcery_exile_gy';
  if (parseEachPlayerSkipsTheirUntapStep(oracle)) return 'skip_untap_step';
  if (parseNonlandPermanentsYouControlAreEnchantmentsInAddition(oracle)) return 'nonland_are_enchantments';
  if (parseGetsPlusOneForEachOtherSameName(oracle)) return 'plus_one_other_same_name';
  if (parseCreaturesOfTypeGetPTPerCounterOnThem(oracle)) return 'type_pt_per_counter';
  if (parseCreaturesYouDontControlGetPTPerCounterOnThem(oracle)) return 'opp_pt_per_counter';
  if (parseEnchantedCanAttackAsThoughItDidntHaveDefender(oracle)) return 'enchanted_attack_as_though_no_defender';
  if (parseAllCreaturesAttackEnchantedControllerIfAble(oracle)) return 'all_attack_enchanted_controller';
  if (parseCreaturesYouControlCantAttackExceptNamedAndArtifact(oracle)) return 'cant_attack_except_named_and_artifact';
  if (parseCreaturesWithNamedCountersAttackEachCombatIfAble(oracle)) return 'named_counter_must_attack';
  if (parseHasFlyingEtcAsLongAsCraftExiledCardHasKeyword(oracle)) return 'craft_exiled_keyword_copy';
  if (parseSpendManaAsAnyToActivateCreatureAbilities(oracle)) return 'spend_mana_as_any_activate_creatures';
  return null;
}

export function pushBatch106LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const text = String(oracle || '');
  if (!text.trim()) return;

  if (parseYouHaveHexproof(text)) {
    specs.push(buildSpec(source, 'you-have-hexproof', { kind: 'player_you' }, { abilities: ['hexproof'] }));
  }

  const copyExiled = parseCreaturesYouControlWithPlusCountersCopyExiledActivated(text);
  if (copyExiled) {
    specs.push(buildSpec(
      source,
      'plus-counter-creatures-copy-exiled-activated',
      { kind: 'creatures_you_control', qualifier: { counter: '+1/+1' } } as any,
      { copyActivatedFromExiledWithCardType: copyExiled.cardType } as any,
    ));
  }

  if (parseHasEachActivatedAbilityOfCraftExiledCards(text)) {
    specs.push(buildSpec(source, 'craft-exiled-activated', { kind: 'self' }, { abilities: ['craft_exiled_activated'] } as any));
  }

  const afterlife = parseEnchantedCreatureGetsPTAndHasAfterlife(text);
  if (afterlife) {
    const hostId = String((perm as any)?.attachedTo || '').trim();
    const hostSource = hostId
      ? { ...source, sourcePermanentId: hostId }
      : source;
    specs.push(buildSpec(
      hostSource,
      'enchanted-pt-afterlife',
      { kind: 'self' },
      { power: afterlife.power, toughness: afterlife.toughness, abilities: [`afterlife ${afterlife.afterlife}`] },
    ));
  }

  const encore = parseGyCardsHaveEncore(text);
  if (encore) {
    specs.push(buildSpec(source, 'gy-cards-have-encore', { kind: 'self' }, {
      abilities: ['graveyard_encore'],
    } as any));
  }

  if (parseGetsPlusXPowerGreatestGyCreaturePower(text)) {
    specs.push(buildSpec(source, 'plus-x-greatest-gy-creature-power', { kind: 'self' }, { abilities: ['plus_x_greatest_gy_power'] } as any));
  }

  if (parsePowerToughnessEqualToTotalPowerOfCraftExiled(text)
    || parsePowerToughnessEqualToColorsAmongCraftExiled(text)
    || parsePowerToughnessEqualToTwentyMinusHighestLife(text)
    || parsePowerToughnessEqualToNonbasicLandsChosenPlayerControls(text)
    || parsePowerEqualToInstantAndSorceryYouOwnInExileAndGy(text)) {
    specs.push(buildSpec(source, 'batch106-cda', { kind: 'self' }, { abilities: ['variable_pt_cda'] } as any));
  }

  if (parseEachPlayerSkipsTheirUntapStep(text)) {
    specs.push(buildSpec(source, 'skip-untap-step', { kind: 'self' }, { abilities: ['players_skip_untap_step'] } as any));
  }

  if (parseNonlandPermanentsYouControlAreEnchantmentsInAddition(text)) {
    specs.push(buildSpec(
      source,
      'nonland-are-enchantments',
      { kind: 'permanents_you_control', qualifier: { nonType: 'land' } } as any,
      { typeAdditions: ['Enchantment'] },
    ));
  }

  if (parseGetsPlusOneForEachOtherSameName(text)) {
    specs.push(buildSpec(source, 'plus-one-other-same-name', { kind: 'self' }, { abilities: ['plus_one_other_same_name'] } as any));
  }

  const typal = parseCreaturesOfTypeGetPTPerCounterOnThem(text);
  if (typal) {
    specs.push(buildSpec(
      source,
      'type-pt-per-counter',
      { kind: 'creatures_you_control', creatureType: typal.typeWord } as any,
      { abilities: ['pt_per_counter_on_them'] } as any,
    ));
  }

  const opp = parseCreaturesYouDontControlGetPTPerCounterOnThem(text);
  if (opp) {
    specs.push(buildSpec(
      source,
      'opp-pt-per-counter',
      { kind: 'opponent_creatures' },
      { abilities: ['pt_per_counter_on_them'] } as any,
    ));
  }

  if (parseEnchantedCanAttackAsThoughItDidntHaveDefender(text)) {
    const hostId = String((perm as any)?.attachedTo || '').trim();
    const hostSource = hostId ? { ...source, sourcePermanentId: hostId } : source;
    specs.push(buildSpec(hostSource, 'attack-as-though-no-defender', { kind: 'self' }, { abilities: ['can_attack_as_though_no_defender'] } as any));
  }

  if (parseAllCreaturesAttackEnchantedControllerIfAble(text)) {
    specs.push(buildSpec(source, 'all-attack-enchanted-controller', { kind: 'all_creatures' }, { abilities: ['attacks_each_combat_if_able'] } as any));
  }

  if (parseCreaturesYouControlCantAttackExceptNamedAndArtifact(text)) {
    specs.push(buildSpec(source, 'cant-attack-except-named-and-artifact', { kind: 'creatures_you_control' }, { abilities: ["can't attack"] } as any));
  }

  const magnet = parseCreaturesWithNamedCountersAttackEachCombatIfAble(text);
  if (magnet) {
    specs.push(buildSpec(
      source,
      'named-counter-must-attack',
      { kind: 'all_creatures', qualifier: { counter: magnet.counter } } as any,
      { abilities: ['attacks_each_combat_if_able'] } as any,
    ));
  }

  if (parseHasFlyingEtcAsLongAsCraftExiledCardHasKeyword(text)) {
    specs.push(buildSpec(source, 'craft-exiled-keyword-copy', { kind: 'self' }, { abilities: ['craft_exiled_keywords'] } as any));
  }

  if (parseSpendManaAsAnyToActivateCreatureAbilities(text)) {
    specs.push(buildSpec(source, 'spend-mana-as-any-activate-creatures', { kind: 'player_you' }, { abilities: ['spend_mana_as_any_to_activate_creatures'] } as any));
  }
}
