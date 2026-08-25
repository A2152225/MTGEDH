/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectCombatDamageTriggers late/defender/noncombat patterns
 * Public: appendCombatDamageDetectionLate
 */

import { timingTriggerEffect } from "./timing-effect-extraction.js";
import type { CombatDamageDetectionState } from "./combat-damage-detection-state.js";

export function appendCombatDamageDetectionLate(state: CombatDamageDetectionState): void {
  const {
    triggers,
    oracleText,
    lowerOracle,
    cardName,
    permanentId,
    combatNameVariants,
    combatDamageSubject,
  } = state;

  // Ms. Marvel, Elastic Ally — singular creature with power > base power
  const singularPowerAboveBaseCombatDamageMatch = oracleText.match(
    /whenever a creature you control with power greater than its base power deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    singularPowerAboveBaseCombatDamageMatch
    && !triggers.some((t) => t.triggerType === 'power_above_base_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, singularPowerAboveBaseCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'power_above_base_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  // Delayed/reflexive: "whenever any of those creatures deals combat damage to a player"
  const thoseCreaturesCombatDamageMatch = oracleText.match(
    /whenever any of those creatures deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    thoseCreaturesCombatDamageMatch
    && !triggers.some((t) => t.triggerType === 'those_creatures_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, thoseCreaturesCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'those_creatures_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const trampleCreaturesCombatDamageToPlayerMatch = oracleText.match(
    /whenever one or more creatures you control with trample deal combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    trampleCreaturesCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'trample_creatures_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, trampleCreaturesCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'trample_creatures_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const chosenNameCombatDamageThisTurnMatch = oracleText.match(
    /whenever a creature with the chosen name deals combat damage to a player this turn,?\s*([^.]+)/i,
  );
  if (
    chosenNameCombatDamageThisTurnMatch &&
    !triggers.some((t) => t.triggerType === 'chosen_name_combat_damage_to_player_this_turn')
  ) {
    const effectText = timingTriggerEffect(oracleText, chosenNameCombatDamageThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'chosen_name_combat_damage_to_player_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedOrEnchantedCombatDamageToPlayerPattern = new RegExp(
    `whenever\\s+(?:${combatNameVariants.join('|')})\\s+or\\s+an\\s+enchanted\\s+creature\\s+you\\s+control\\s+deals\\s+combat\\s+damage\\s+to\\s+a\\s+player,?\\s*([^.]+)`,
    'i',
  );
  const namedOrEnchantedCombatDamageToPlayerMatch = oracleText.match(namedOrEnchantedCombatDamageToPlayerPattern);
  if (
    namedOrEnchantedCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_enchanted_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrEnchantedCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_enchanted_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const sourceDamageToOpponentMatch = oracleText.match(
    /whenever a source you control deals damage to an opponent,?\s*([^.]+)/i,
  );
  if (
    sourceDamageToOpponentMatch &&
    !triggers.some((t) => t.triggerType === 'source_damage_to_opponent')
  ) {
    const effectText = timingTriggerEffect(oracleText, sourceDamageToOpponentMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'source_damage_to_opponent',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const sourceDamageToAnotherPlayerMatch = oracleText.match(
    /whenever a source you control deals damage to another player,?\s*([^.]+)/i,
  );
  if (
    sourceDamageToAnotherPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'source_damage_to_another_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, sourceDamageToAnotherPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'source_damage_to_another_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const sourceDamageToYouMatch = oracleText.match(
    /whenever a source you control deals damage to you,?\s*([^.]+)/i,
  );
  if (
    sourceDamageToYouMatch &&
    !triggers.some((t) => t.triggerType === 'source_damage_to_you')
  ) {
    const effectText = timingTriggerEffect(oracleText, sourceDamageToYouMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'source_damage_to_you',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const lowPowerCreatureCombatDamageToPlayerMatch = oracleText.match(
    /whenever a creature you control with power (\d+) or less deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    lowPowerCreatureCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'low_power_creature_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, lowPowerCreatureCombatDamageToPlayerMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'low_power_creature_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creaturesWithCountersCombatDamageMatch = oracleText.match(
    /whenever one or more creatures you control with counters on them deal combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    creaturesWithCountersCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'creatures_with_counters_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, creaturesWithCountersCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creatures_with_counters_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      batched: true,
    });
  }

  const commanderYouControlCombatDamageToOpponentMatch = oracleText.match(
    /whenever a commander you control deals combat damage to an opponent,?\s*([^.]+)/i,
  );
  if (
    commanderYouControlCombatDamageToOpponentMatch &&
    !triggers.some((t) => t.triggerType === 'commander_you_control_combat_damage_to_opponent')
  ) {
    const effectText = timingTriggerEffect(oracleText, commanderYouControlCombatDamageToOpponentMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'commander_you_control_combat_damage_to_opponent',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const commanderCombatDamageToPlayerMatch = oracleText.match(
    /when (?:your )?commander deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    commanderCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'commander_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, commanderCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'commander_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentDealtCombatDamageByYourCreaturesMatch = oracleText.match(
    /whenever an opponent is dealt combat damage by one or more creatures you control,?\s*([^.]+)/i,
  );
  if (
    opponentDealtCombatDamageByYourCreaturesMatch &&
    !triggers.some((t) => t.triggerType === 'opponent_dealt_combat_damage_by_your_creatures')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentDealtCombatDamageByYourCreaturesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_dealt_combat_damage_by_your_creatures',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const chosenNameCombatDamageMatch = oracleText.match(
    /whenever a creature you control with the chosen name deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    chosenNameCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'chosen_name_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, chosenNameCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'chosen_name_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const faceUpCreatureCombatDamageMatch = oracleText.match(
    /whenever a creature you control that was turned face up this turn deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    faceUpCreatureCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'face_up_creature_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, faceUpCreatureCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'face_up_creature_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const sourceOtherThanSelfDamageToOpponentMatch = oracleText.match(
    /whenever a source you control other than this artifact deals damage to an opponent,?\s*([^.]+)/i,
  );
  if (
    sourceOtherThanSelfDamageToOpponentMatch &&
    !triggers.some((t) => t.triggerType === 'source_other_than_self_damage_to_opponent')
  ) {
    const effectText = timingTriggerEffect(oracleText, sourceOtherThanSelfDamageToOpponentMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'source_other_than_self_damage_to_opponent',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const noncreatureSourceDealsDamageMatch = oracleText.match(
    /whenever a noncreature source you control deals damage,?\s*([^.]+)/i,
  );
  if (noncreatureSourceDealsDamageMatch && !triggers.some((t) => t.triggerType === 'noncreature_source_deals_damage')) {
    const effectText = timingTriggerEffect(oracleText, noncreatureSourceDealsDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'noncreature_source_deals_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const flyingCreaturesCombatDamageToPlayerMatch = oracleText.match(
    /whenever one or more creatures you control with flying deal combat damage to a player(?: this turn)?,?\s*([^.]+)/i,
  );
  if (
    flyingCreaturesCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'flying_creatures_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, flyingCreaturesCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'flying_creatures_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const controlledCreatureCombatDamageToCreatureMatch = oracleText.match(
    /whenever a (?:[\w]+\s+)*creature you control deals combat damage to a creature,?\s*([^.]+)/i,
  );
  if (
    controlledCreatureCombatDamageToCreatureMatch &&
    !triggers.some((t) => t.triggerType === 'controlled_creature_combat_damage_to_creature')
  ) {
    const effectText = timingTriggerEffect(oracleText, controlledCreatureCombatDamageToCreatureMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'controlled_creature_combat_damage_to_creature',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const selfOrEquippedCombatDamageToPlayerMatch = oracleText.match(
    /whenever (?:~|this creature) or equipped creature deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    selfOrEquippedCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'self_or_equipped_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, selfOrEquippedCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'self_or_equipped_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedCreaturesCombatDamageMatch = oracleText.match(
    /whenever one or more ([\w]+(?: or [\w]+)*) (?:creatures )?you control deal combat damage to (?:a player|an opponent)(?: or battle)?,?\s*([^.]+)/i,
  );
  if (
    typedCreaturesCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'typed_creatures_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedCreaturesCombatDamageMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_creatures_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      batched: true,
    });
  }

  const batchedCombatDamageToPlayersMatch = oracleText.match(
    /whenever one or more creatures you control deal combat damage to one or more players(?: this turn)?,?\s*([^.]+)/i,
  );
  if (
    batchedCombatDamageToPlayersMatch &&
    !triggers.some((t) => t.triggerType === 'batched_combat_damage_to_players')
  ) {
    const effectText = timingTriggerEffect(oracleText, batchedCombatDamageToPlayersMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'batched_combat_damage_to_players',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      batched: true,
    });
  }

  // "When/Whenever you're dealt combat damage" detection
  const youAreDealtCombatDamageMatch = oracleText.match(/when(?:ever)?\s+you(?:'re| are)\s+dealt\s+combat\s+damage,?\s*([^.]+)/i);
  if (youAreDealtCombatDamageMatch && !triggers.some(t => t.triggerType === 'you_are_dealt_combat_damage')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'you_are_dealt_combat_damage',
      description: timingTriggerEffect(oracleText, youAreDealtCombatDamageMatch),
      effect: timingTriggerEffect(oracleText, youAreDealtCombatDamageMatch),
      mandatory: true,
    });
  }

  const youAreDealtDamageMatch = oracleText.match(/when(?:ever)?\s+you(?:'re| are)\s+dealt\s+damage,?\s*([^.]+)/i);
  if (youAreDealtDamageMatch && !triggers.some(t => t.triggerType === 'you_are_dealt_damage')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'you_are_dealt_damage',
      description: timingTriggerEffect(oracleText, youAreDealtDamageMatch),
      effect: timingTriggerEffect(oracleText, youAreDealtDamageMatch),
      mandatory: true,
    });
  }

  // "Whenever one or more creatures deal combat damage to you" (batched defender trigger)
  const creaturesDealCombatDamageToYouMatch = oracleText.match(/whenever\s+one\s+or\s+more\s+creatures\s+deal\s+combat\s+damage\s+to\s+you,?\s*([^.]+)/i);
  if (creaturesDealCombatDamageToYouMatch && !triggers.some(t => t.triggerType === 'creatures_deal_combat_damage_to_you_batched')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creatures_deal_combat_damage_to_you_batched',
      description: timingTriggerEffect(oracleText, creaturesDealCombatDamageToYouMatch),
      effect: timingTriggerEffect(oracleText, creaturesDealCombatDamageToYouMatch),
      mandatory: true,
      batched: true,
    });
  }
  
  const enchantedCreatureYouControlCombatDamageMatch = oracleText.match(
    /whenever an enchanted creature you control deals combat damage to (?:a player|an opponent),?\s*([^.]+)/i,
  );
  if (
    enchantedCreatureYouControlCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'enchanted_creature_controlled_combat_damage')
  ) {
    const effectText = timingTriggerEffect(oracleText, enchantedCreatureYouControlCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enchanted_creature_controlled_combat_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const combatDamageToCreatureMatch = oracleText.match(
    new RegExp(`whenever ${combatDamageSubject}\\s+deals combat damage to a creature,?\\s*([^.]+)`, 'i'),
  );
  if (combatDamageToCreatureMatch && !triggers.some((t) => t.triggerType === 'deals_combat_damage_to_creature')) {
    const effectText = timingTriggerEffect(oracleText, combatDamageToCreatureMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'deals_combat_damage_to_creature',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const equippedAnyCombatDamageMatch = oracleText.match(
    /whenever equipped creature deals combat damage(?! to),?\s*([^.]+)/i,
  );
  if (equippedAnyCombatDamageMatch && !triggers.some((t) => t.triggerType === 'equipment_combat_damage')) {
    const effectText = timingTriggerEffect(oracleText, equippedAnyCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'equipment_combat_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedDefendingPlayerDamageMatch = oracleText.match(
    /whenever enchanted creature deals combat damage to defending player,?\s*([^.]+)/i,
  );
  if (enchantedDefendingPlayerDamageMatch && !triggers.some((t) => t.triggerType === 'aura_combat_damage')) {
    const effectText = timingTriggerEffect(oracleText, enchantedDefendingPlayerDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'aura_combat_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedCreatureCombatDamageMatch = oracleText.match(
    /when(?:ever)?\s+enchanted creature deals (?:combat )?damage to (?:a player|an opponent),?\s*([^.]+)/i,
  );
  if (enchantedCreatureCombatDamageMatch && !triggers.some((t) => t.triggerType === 'deals_combat_damage' || t.triggerType === 'aura_combat_damage')) {
    const effectText = timingTriggerEffect(oracleText, enchantedCreatureCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'aura_combat_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const targetCreatureDealsDamageMatch = oracleText.match(
    /whenever target creature deals (?:combat )?damage,?\s*([^.]+)/i,
  );
  if (targetCreatureDealsDamageMatch && !triggers.some((t) => t.triggerType === 'target_creature_deals_damage')) {
    const effectText = timingTriggerEffect(oracleText, targetCreatureDealsDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'target_creature_deals_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedDealDamageToPlayerMatch = oracleText.match(
    /whenever one or more ([\w]+(?: or [\w]+)*) you control deal damage to a player,?\s*([^.]+)/i,
  );
  if (typedDealDamageToPlayerMatch && !triggers.some((t) => t.triggerType === 'typed_deal_damage_to_player')) {
    const effectText = timingTriggerEffect(oracleText, typedDealDamageToPlayerMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_deal_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedDealDamageNoControlMatch = oracleText.match(
    /whenever a ([\w]+) deals damage,?\s*([^.]+)/i,
  );
  if (
    typedDealDamageNoControlMatch &&
    !lowerOracle.includes('you control') &&
    !triggers.some((t) => t.triggerType === 'typed_deal_damage')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedDealDamageNoControlMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_deal_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedDealDamageToOpponentsMatch = oracleText.match(
    /whenever one or more ([\w]+(?: or [\w]+)*) you control deal damage to your opponents,?\s*([^.]+)/i,
  );
  if (typedDealDamageToOpponentsMatch && !triggers.some((t) => t.triggerType === 'typed_deal_damage_to_opponents')) {
    const effectText = timingTriggerEffect(oracleText, typedDealDamageToOpponentsMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_deal_damage_to_opponents',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedDealDamageToCreatureMatch = oracleText.match(
    /whenever an? ([\w]+) you control deals damage to a creature,?\s*([^.]+)/i,
  );
  if (typedDealDamageToCreatureMatch && !triggers.some((t) => t.triggerType === 'typed_deal_damage_to_creature')) {
    const effectText = timingTriggerEffect(oracleText, typedDealDamageToCreatureMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_deal_damage_to_creature',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const spellYouControlDealsDamagePatterns = [
    /whenever a spell you control deals damage,?\s*([^.]+)/gi,
    /when a spell you control deals damage,?\s*([^.]+)/gi,
  ];
  for (const pattern of spellYouControlDealsDamagePatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = timingTriggerEffect(oracleText, match);
      if (!effectText || triggers.some((t) => t.triggerType === 'spell_you_control_deals_damage' && t.effect === effectText)) {
        continue;
      }
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'spell_you_control_deals_damage',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  // "When/Whenever ~ deals damage to a player" (includes combat and non-combat)
  const damagePlayerMatch = oracleText.match(
    new RegExp(`when(?:ever)?\\s+(?:~|this creature|this vehicle|(?:${combatNameVariants.join('|')})|enchanted creature|equipped creature)\\s+deals\\s+damage\\s+to\\s+(?:a\\s+)?(?:player|an?\\s+opponent),?\\s*([^.]+)`, 'i'),
  );
  if (damagePlayerMatch && !triggers.some(t => t.triggerType === 'deals_combat_damage' || t.triggerType === 'deals_damage')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'deals_damage',
      description: timingTriggerEffect(oracleText, damagePlayerMatch),
      effect: timingTriggerEffect(oracleText, damagePlayerMatch),
      mandatory: true,
    });
  }

  const dealsDamageMatch = oracleText.match(
    new RegExp(`whenever\\s+${combatDamageSubject}\\s+deals damage,?\\s*([^.]+)`, 'i'),
  );
  if (dealsDamageMatch && !triggers.some((t) => t.triggerType === 'deals_damage')) {
    const effectText = timingTriggerEffect(oracleText, dealsDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'deals_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }
}
