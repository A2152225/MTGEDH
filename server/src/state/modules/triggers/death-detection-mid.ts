/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectDeathTriggers mid pattern run
 * Public: appendDeathDetectionMid
 */

import { timingTriggerEffect } from "./timing-effect-extraction.js";
import type { DeathDetectionState } from "./death-detection-state.js";

export function appendDeathDetectionMid(state: DeathDetectionState): void {
  const {
    triggers,
    oracleText,
    lowerOracle,
    cardName,
    permanentId,
    dieNameVariants,
    dieSelfAlternatives,
  } = state;

  const permanentCardsYourGyWhileMatch = oracleText.match(
    /whenever one or more permanent cards are put into your graveyard from anywhere while [^,]+,?\s*([^.]+)/i,
  );
  if (permanentCardsYourGyWhileMatch && !triggers.some((t) => t.triggerType === 'permanent_cards_your_graveyard_while_condition')) {
    const effectText = timingTriggerEffect(oracleText, permanentCardsYourGyWhileMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'permanent_cards_your_graveyard_while_condition',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherCreatureYouOwnDiesMatch = oracleText.match(
    /whenever another creature you own dies,?\s*([^.]+)/i,
  );
  if (anotherCreatureYouOwnDiesMatch && !triggers.some((t) => t.triggerType === 'another_creature_you_own_dies')) {
    const effectText = timingTriggerEffect(oracleText, anotherCreatureYouOwnDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_creature_you_own_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const rollThirdDieMatch = oracleText.match(/whenever you roll your third die each turn,?\s*([^.]+)/i);
  if (rollThirdDieMatch && !triggers.some((t) => t.triggerType === 'roll_third_die_each_turn')) {
    const effectText = timingTriggerEffect(oracleText, rollThirdDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'roll_third_die_each_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentDrawsFirstCardMatch = oracleText.match(
    /whenever an opponent draws their first card each turn,?\s*([^.]+)/i,
  );
  if (opponentDrawsFirstCardMatch && !triggers.some((t) => t.triggerType === 'opponent_draws_first_card_each_turn')) {
    const effectText = timingTriggerEffect(oracleText, opponentDrawsFirstCardMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_draws_first_card_each_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const zombieOrMutantDiesMatch = oracleText.match(/whenever a ([\w]+) or ([\w]+) you control dies,?\s*([^.]+)/i);
  if (
    zombieOrMutantDiesMatch &&
    !triggers.some((t) => t.triggerType === 'multi_typed_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, zombieOrMutantDiesMatch, 3);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'multi_typed_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const foodGyFromBfMatch = oracleText.match(/whenever a food is put into a graveyard from the battlefield,?\s*([^.]+)/i);
  if (foodGyFromBfMatch && !triggers.some((t) => t.triggerType === 'food_graveyard_from_battlefield')) {
    const effectText = timingTriggerEffect(oracleText, foodGyFromBfMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'food_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureTokenDiesMatch = oracleText.match(/whenever a creature token dies,?\s*([^.]+)/i);
  if (creatureTokenDiesMatch && !triggers.some((t) => t.triggerType === 'creature_token_dies')) {
    const effectText = timingTriggerEffect(oracleText, creatureTokenDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_token_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const permanentOwnedByAnotherPlayerGyMatch = oracleText.match(
    /whenever a permanent owned by another player is put into a graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (
    permanentOwnedByAnotherPlayerGyMatch &&
    !triggers.some((t) => t.triggerType === 'permanent_owned_by_another_player_graveyard_from_battlefield')
  ) {
    const effectText = timingTriggerEffect(oracleText, permanentOwnedByAnotherPlayerGyMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'permanent_owned_by_another_player_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureWithCountersDiesMatch = oracleText.match(
    /whenever a creature you control with one or more counters on it dies,?\s*([^.]+)/i,
  );
  if (
    creatureWithCountersDiesMatch &&
    !triggers.some((t) => t.triggerType === 'creature_with_counters_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, creatureWithCountersDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_with_counters_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const equippedCreatureYouControlDiesMatch = oracleText.match(
    /whenever an equipped creature you control dies,?\s*([^.]+)/i,
  );
  if (
    equippedCreatureYouControlDiesMatch &&
    !triggers.some((t) => t.triggerType === 'equipped_creature_you_control_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, equippedCreatureYouControlDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'equipped_creature_you_control_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const heroesControlCreatureDiesMatch = oracleText.match(
    /whenever a creature the heroes control dies,?\s*([^.]+)/i,
  );
  if (heroesControlCreatureDiesMatch && !triggers.some((t) => t.triggerType === 'heroes_control_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, heroesControlCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'heroes_control_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const bossesControlCreatureDiesMatch = oracleText.match(
    /whenever a creature the bosses control dies,?\s*([^.]+)/i,
  );
  if (bossesControlCreatureDiesMatch && !triggers.some((t) => t.triggerType === 'bosses_control_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, bossesControlCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'bosses_control_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherCardGyFromAnywhereMatch = oracleText.match(
    /whenever another card is put into a graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (
    anotherCardGyFromAnywhereMatch &&
    !triggers.some((t) => t.triggerType === 'another_card_graveyard_from_anywhere')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherCardGyFromAnywhereMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_card_graveyard_from_anywhere',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherGoblinGyFromBfMatch = oracleText.match(
    /whenever another Goblin you control is put into a graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (
    anotherGoblinGyFromBfMatch &&
    !triggers.some((t) => t.triggerType === 'another_goblin_graveyard_from_battlefield')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherGoblinGyFromBfMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_goblin_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOfEnchantedCreaturesDiesMatch = oracleText.match(/when one of the enchanted creatures dies,?\s*([^.]+)/i);
  if (
    oneOfEnchantedCreaturesDiesMatch &&
    !triggers.some((t) => t.triggerType === 'one_of_enchanted_creatures_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOfEnchantedCreaturesDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'one_of_enchanted_creatures_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const birdYourGyFromBfMatch = oracleText.match(
    /whenever a Bird is put into your graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (birdYourGyFromBfMatch && !triggers.some((t) => t.triggerType === 'bird_your_graveyard_from_battlefield')) {
    const effectText = timingTriggerEffect(oracleText, birdYourGyFromBfMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'bird_your_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const chosenPermanentGyFromBfMatch = oracleText.match(
    /when the chosen permanent is put into a graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (chosenPermanentGyFromBfMatch && !triggers.some((t) => t.triggerType === 'chosen_permanent_graveyard_from_battlefield')) {
    const effectText = timingTriggerEffect(oracleText, chosenPermanentGyFromBfMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'chosen_permanent_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureDontOwnDiesMatch = oracleText.match(
    /whenever a creature you control but don't own dies,?\s*([^.]+)/i,
  );
  if (creatureDontOwnDiesMatch && !triggers.some((t) => t.triggerType === 'creature_you_control_dont_own_dies')) {
    const effectText = timingTriggerEffect(oracleText, creatureDontOwnDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_you_control_dont_own_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantmentOrNonlandGyMatch = oracleText.match(
    /whenever this enchantment or another nonland permanent you control is put into a graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (enchantmentOrNonlandGyMatch && !triggers.some((t) => t.triggerType === 'enchantment_or_nonland_graveyard_from_battlefield')) {
    const effectText = timingTriggerEffect(oracleText, enchantmentOrNonlandGyMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enchantment_or_nonland_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const auraOrEquipmentGyMatch = oracleText.match(
    /whenever an Aura or Equipment you control is put into a graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (auraOrEquipmentGyMatch && !triggers.some((t) => t.triggerType === 'aura_or_equipment_graveyard_from_battlefield')) {
    const effectText = timingTriggerEffect(oracleText, auraOrEquipmentGyMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'aura_or_equipment_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const spiderDealtDamageCreatureDiesMatch = oracleText.match(
    /whenever another creature dealt damage this turn by a Spider you controlled dies,?\s*([^.]+)/i,
  );
  if (
    spiderDealtDamageCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'spider_dealt_damage_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, spiderDealtDamageCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'spider_dealt_damage_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const spiritOrDisturbGyMatch = oracleText.match(
    /whenever a Spirit card or a card with disturb is put into your graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (spiritOrDisturbGyMatch && !triggers.some((t) => t.triggerType === 'spirit_or_disturb_your_graveyard_from_anywhere')) {
    const effectText = timingTriggerEffect(oracleText, spiritOrDisturbGyMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'spirit_or_disturb_your_graveyard_from_anywhere',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureCardYourGyFromAnywhereMatch = oracleText.match(
    /whenever a creature card is put into your graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (
    creatureCardYourGyFromAnywhereMatch &&
    !triggers.some((t) => t.triggerType === 'creature_card_your_graveyard_from_anywhere')
  ) {
    const effectText = timingTriggerEffect(oracleText, creatureCardYourGyFromAnywhereMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_card_your_graveyard_from_anywhere',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const blackCardOpponentGyMatch = oracleText.match(
    /whenever a black card is put into an opponent's graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (blackCardOpponentGyMatch && !triggers.some((t) => t.triggerType === 'black_card_opponent_graveyard_from_anywhere')) {
    const effectText = timingTriggerEffect(oracleText, blackCardOpponentGyMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'black_card_opponent_graveyard_from_anywhere',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedOrAnotherTypedDiesPattern = new RegExp(
    `whenever\\s+(?:${dieNameVariants.join('|')}|this creature)\\s+or\\s+another\\s+(?:nontoken\\s+)?([\\w]+)\\s+you\\s+control\\s+dies,?\\s*([^.]+)`,
    'i',
  );
  const namedOrAnotherTypedDiesMatch = oracleText.match(namedOrAnotherTypedDiesPattern);
  if (
    namedOrAnotherTypedDiesMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_another_typed_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrAnotherTypedDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_another_typed_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrAnotherTypedDiesNoControlMatch = oracleText.match(
    /whenever this creature or another ([\w]+) dies,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherTypedDiesNoControlMatch &&
    !lowerOracle.includes('you control') &&
    !triggers.some((t) => t.triggerType === 'this_or_another_typed_creature_dies_any')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherTypedDiesNoControlMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_typed_creature_dies_any',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nontokenTypedDiesMatch = oracleText.match(
    /whenever (?:a |an )?nontoken ([\w]+) you control dies,?\s*([^.]+)/i,
  );
  if (nontokenTypedDiesMatch && !triggers.some((t) => t.triggerType === 'nontoken_typed_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, nontokenTypedDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'nontoken_typed_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherNontokenTypedDiesMatch = oracleText.match(
    /whenever another nontoken ([\w]+) you control dies,?\s*([^.]+)/i,
  );
  if (anotherNontokenTypedDiesMatch && !triggers.some((t) => t.triggerType === 'another_nontoken_typed_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, anotherNontokenTypedDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_nontoken_typed_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedEntersOrAnotherNontokenTypedDiesMatch = oracleText.match(
    new RegExp(
      `whenever (?:${dieSelfAlternatives.join('|')}) enters or another nontoken ([\\w]+) you control dies,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedEntersOrAnotherNontokenTypedDiesMatch &&
    !triggers.some((t) => t.triggerType === 'named_enters_or_another_nontoken_typed_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedEntersOrAnotherNontokenTypedDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_enters_or_another_nontoken_typed_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const flyingCreatureDiesMatch = oracleText.match(
    /whenever a creature with flying dies,?\s*([^.]+)/i,
  );
  if (flyingCreatureDiesMatch && !triggers.some((t) => t.triggerType === 'flying_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, flyingCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'flying_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreOtherTypedDieMatch = oracleText.match(
    /whenever one or more other ([\w]+(?: or [\w]+)*) you control die,?\s*([^.]+)/i,
  );
  if (oneOrMoreOtherTypedDieMatch && !triggers.some((t) => t.triggerType === 'one_or_more_other_typed_die')) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreOtherTypedDieMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'one_or_more_other_typed_die',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nontokenNonTypeCreatureDiesMatch = oracleText.match(
    /whenever a nontoken, non-([\w]+) creature you control dies,?\s*([^.]+)/i,
  );
  if (nontokenNonTypeCreatureDiesMatch && !triggers.some((t) => t.triggerType === 'nontoken_non_type_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, nontokenNonTypeCreatureDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'nontoken_non_type_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureWithoutFlyingDiesMatch = oracleText.match(
    /whenever a creature you control without flying dies,?\s*([^.]+)/i,
  );
  if (creatureWithoutFlyingDiesMatch && !triggers.some((t) => t.triggerType === 'creature_without_flying_dies')) {
    const effectText = timingTriggerEffect(oracleText, creatureWithoutFlyingDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_without_flying_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const faceDownCreatureDiesMatch = oracleText.match(
    /whenever a face-down creature you control dies,?\s*([^.]+)/i,
  );
  if (faceDownCreatureDiesMatch && !triggers.some((t) => t.triggerType === 'face_down_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, faceDownCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'face_down_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const targetCreatureOtherThanSelfDiesThisTurnMatch = oracleText.match(
    /when target creature other than this creature dies this turn,?\s*([^.]+)/i,
  );
  if (
    targetCreatureOtherThanSelfDiesThisTurnMatch &&
    !triggers.some((t) => t.triggerType === 'target_creature_other_than_self_dies_this_turn')
  ) {
    const effectText = timingTriggerEffect(oracleText, targetCreatureOtherThanSelfDiesThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'target_creature_other_than_self_dies_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureOpponentGraveyardFromBattlefieldMatch = oracleText.match(
    /when a creature is put into an opponent's graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (
    creatureOpponentGraveyardFromBattlefieldMatch &&
    !triggers.some((t) => t.triggerType === 'creature_opponent_graveyard_from_battlefield')
  ) {
    const effectText = timingTriggerEffect(oracleText, creatureOpponentGraveyardFromBattlefieldMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_opponent_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nontokenTypedGraveyardFromBattlefieldMatch = oracleText.match(
    /whenever another nontoken ([\w]+) is put into your graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (
    nontokenTypedGraveyardFromBattlefieldMatch &&
    !triggers.some((t) => t.triggerType === 'nontoken_typed_graveyard_from_battlefield')
  ) {
    const effectText = timingTriggerEffect(oracleText, nontokenTypedGraveyardFromBattlefieldMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'nontoken_typed_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedPermanentCardYourGyNotBattlefieldMatch = oracleText.match(
    /whenever a ([\w]+) permanent card is put into your graveyard from anywhere other than the battlefield,?\s*([^.]+)/i,
  );
  if (
    typedPermanentCardYourGyNotBattlefieldMatch &&
    !triggers.some((t) => t.triggerType === 'typed_permanent_card_your_graveyard_not_battlefield')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedPermanentCardYourGyNotBattlefieldMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_permanent_card_your_graveyard_not_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherCreatureOrArtifactDiesMatch = oracleText.match(
    /whenever another creature or artifact you control dies,?\s*([^.]+)/i,
  );
  if (
    anotherCreatureOrArtifactDiesMatch &&
    !triggers.some((t) => t.triggerType === 'another_creature_or_artifact_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherCreatureOrArtifactDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_creature_or_artifact_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherCommanderDiesMatch = oracleText.match(
    /whenever another [Cc]ommander dies,?\s*([^.]+)/i,
  );
  if (anotherCommanderDiesMatch && !triggers.some((t) => t.triggerType === 'another_commander_dies')) {
    const effectText = timingTriggerEffect(oracleText, anotherCommanderDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_commander_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const fromAnywhereGraveyardPattern = new RegExp(
    `when(?:ever)?\\s+(?:${dieSelfAlternatives.join('|')}|(?:${dieNameVariants.join('|')}))\\s+(?:is )?put into (?:a |your |its owner'?s )?graveyard from anywhere,?\\s*([^.]+)`,
    'i',
  );
  const fromAnywhereGraveyardMatch = oracleText.match(fromAnywhereGraveyardPattern);
  if (fromAnywhereGraveyardMatch && !triggers.some((t) => t.triggerType === 'put_into_graveyard_from_anywhere')) {
    const effectText = timingTriggerEffect(oracleText, fromAnywhereGraveyardMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'put_into_graveyard_from_anywhere',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const controlledDiesMatch = oracleText.match(/when(?:ever)? (?:a|another) (?:[\w]+\s+)*(?:nontoken\s+)?creature you control dies,?\s*([^.]+)/i);
  if (controlledDiesMatch && !triggers.some(t => t.triggerType === 'creature_dies')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_dies',
      description: timingTriggerEffect(oracleText, controlledDiesMatch),
      effect: timingTriggerEffect(oracleText, controlledDiesMatch),
      mandatory: true,
    });
  }

  const attackingCreatureDiesMatch = oracleText.match(
    /whenever an attacking creature(?: you control)? dies,?\s*([^.]+)/i,
  );
  if (attackingCreatureDiesMatch && !triggers.some((t) => t.triggerType === 'attacking_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, attackingCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'attacking_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherControlledEntersOrDiesMatch = oracleText.match(
    /whenever another creature you control enters or dies,?\s*([^.]+)/i,
  );
  if (
    anotherControlledEntersOrDiesMatch &&
    !triggers.some((t) => t.triggerType === 'another_controlled_enters_or_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherControlledEntersOrDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_controlled_enters_or_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const entersOrAnotherCreatureDiesPattern = new RegExp(
    `whenever\\s+(?:${dieSelfAlternatives.join('|')})\\s+enters(?: the battlefield)?\\s+or\\s+another\\s+creature\\s+dies,?\\s*([^.]+)`,
    'i',
  );
  const entersOrAnotherCreatureDiesMatch = oracleText.match(entersOrAnotherCreatureDiesPattern);
  if (
    entersOrAnotherCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'enters_or_another_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, entersOrAnotherCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enters_or_another_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }
  
  // "Whenever/When a creature dies" (any creature)
  const anyDiesMatch = oracleText.match(/when(?:ever)? (?:a|another) (?:[\w]+\s+)*(?:nontoken\s+)?creature dies,?\s*([^.]+)/i);
  if (anyDiesMatch && 
      !lowerOracle.includes('creature you control dies') && 
      !lowerOracle.includes('creature an opponent controls dies') &&
      !lowerOracle.includes("creature you don't control dies") &&
      !triggers.some(t => t.triggerType === 'any_creature_dies')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'any_creature_dies',
      description: timingTriggerEffect(oracleText, anyDiesMatch),
      effect: timingTriggerEffect(oracleText, anyDiesMatch),
      mandatory: true,
    });
  }
  
  // "Whenever a creature an opponent controls dies" or "Whenever a creature you don't control dies"
  const putIntoGraveyardFromBattlefieldMatch = oracleText.match(
    /when(?:ever)? (?:a|an|another) (?:[\w]+\s+)*(?:artifact|creature|enchantment|permanent|land)(?: you control)?(?: or (?:artifact|creature) you control)? is put into (?:a |your |its owner's )?graveyard from the battlefield,?\s*([^.]+)/i,
  );
  const anotherControlledArtifactOrCreatureGraveyardMatch = oracleText.match(
    /whenever another (?:artifact or creature|creature or artifact) you control is put into (?:a |your |its owner's )?graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (
    anotherControlledArtifactOrCreatureGraveyardMatch &&
    !triggers.some((t) => t.triggerType === 'another_controlled_artifact_or_creature_graveyard')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherControlledArtifactOrCreatureGraveyardMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_controlled_artifact_or_creature_graveyard',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }
  const anyEnchantmentGraveyardMatch = oracleText.match(
    /whenever an enchantment is put into (?:a |your |its owner's )?graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (
    anyEnchantmentGraveyardMatch &&
    !lowerOracle.includes('enchantment you control is put') &&
    !triggers.some((t) => t.triggerType === 'any_enchantment_graveyard')
  ) {
    const effectText = timingTriggerEffect(oracleText, anyEnchantmentGraveyardMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'any_enchantment_graveyard',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }
  const anotherArtifactOrCreatureGraveyardMatch = oracleText.match(
    /whenever another (?:artifact or creature|creature or artifact) is put into (?:a |your |its owner's )?graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (
    anotherArtifactOrCreatureGraveyardMatch &&
    !triggers.some((t) => t.triggerType === 'another_artifact_or_creature_graveyard')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherArtifactOrCreatureGraveyardMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_artifact_or_creature_graveyard',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }
  if (putIntoGraveyardFromBattlefieldMatch && !triggers.some((t) => t.triggerType === 'put_into_graveyard_from_battlefield')) {
    const effectText = timingTriggerEffect(oracleText, putIntoGraveyardFromBattlefieldMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'put_into_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const legendaryOpponentDiesMatch = oracleText.match(
    /when a legendary creature an opponent controls dies,?\s*([^.]+)/i,
  );
  if (legendaryOpponentDiesMatch && !triggers.some((t) => t.triggerType === 'legendary_opponent_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, legendaryOpponentDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'legendary_opponent_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const controlNoneSacrificePattern = new RegExp(
    `when you control no ([^,]+),?\\s*sacrifice (?:${dieSelfAlternatives.join('|')})`,
    'i',
  );
  const controlNoneSacrificeMatch = oracleText.match(controlNoneSacrificePattern);
  if (controlNoneSacrificeMatch && !triggers.some((t) => t.triggerType === 'control_none_sacrifice')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'control_none_sacrifice',
      description: String(controlNoneSacrificeMatch[0] || '').trim(),
      effect: String(controlNoneSacrificeMatch[0] || '').trim(),
      mandatory: true,
    });
  }
}
