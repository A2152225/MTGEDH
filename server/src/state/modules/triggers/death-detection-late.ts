/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectDeathTriggers late pattern run
 * Public: appendDeathDetectionLate
 */

import { timingTriggerEffect } from "./timing-effect-extraction.js";
import { KNOWN_DEATH_TRIGGERS } from "./card-data-tables.js";
import type { DeathDetectionState } from "./death-detection-state.js";

export function appendDeathDetectionLate(state: DeathDetectionState): void {
  const {
    triggers,
    oracleText,
    lowerOracle,
    cardName,
    lowerName,
    permanentId,
    dieNameVariants,
    dieSelfAlternatives,
  } = state;

  const graveyardZoneDiesPattern = new RegExp(
    `whenever (?:a |an )?(?:[\\w]+\\s+)*creature (?:an opponent controls|you don't control) dies while (?:${dieNameVariants.join('|')}) is in your graveyard,?\\s*([^.]+)`,
    'i',
  );
  const graveyardZoneDiesMatch = oracleText.match(graveyardZoneDiesPattern);
  if (graveyardZoneDiesMatch && !triggers.some((t) => t.triggerType === 'graveyard_zone_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, graveyardZoneDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'graveyard_zone_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentArtifactGraveyardMatch = oracleText.match(
    /whenever an artifact an opponent controls is put into (?:a )?graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (
    opponentArtifactGraveyardMatch &&
    !triggers.some((t) => t.triggerType === 'opponent_artifact_graveyard')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentArtifactGraveyardMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_artifact_graveyard',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentDiesMatch = oracleText.match(/whenever (?:a|another) (?:nontoken )?creature (?:an opponent controls|you don't control) dies,?\s*([^.]+)/i);
  if (opponentDiesMatch && !triggers.some(t => t.triggerType === 'opponent_creature_dies')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_creature_dies',
      description: timingTriggerEffect(oracleText, opponentDiesMatch),
      effect: timingTriggerEffect(oracleText, opponentDiesMatch),
      mandatory: true,
    });
  }

  const oneOrMoreOtherCreaturesDieMatch = oracleText.match(/whenever one or more other creatures die,?\s*([^.]+)/i);
  if (
    oneOrMoreOtherCreaturesDieMatch &&
    !triggers.some((t) => t.triggerType === 'one_or_more_other_creatures_die')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreOtherCreaturesDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'one_or_more_other_creatures_die',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreAttackingLegendaryCreaturesDieMatch = oracleText.match(
    /whenever one or more other attacking legendary creatures you control die,?\s*([^.]+)/i,
  );
  if (
    oneOrMoreAttackingLegendaryCreaturesDieMatch &&
    !triggers.some((t) => t.triggerType === 'one_or_more_attacking_legendary_creatures_die')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreAttackingLegendaryCreaturesDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'one_or_more_attacking_legendary_creatures_die',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreArtifactCreaturesDieMatch = oracleText.match(
    /whenever one or more artifact creatures you control die,?\s*([^.]+)/i,
  );
  if (
    oneOrMoreArtifactCreaturesDieMatch &&
    !triggers.some((t) => t.triggerType === 'one_or_more_artifact_creatures_die')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreArtifactCreaturesDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'one_or_more_artifact_creatures_die',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherMultiTypedCreatureDiesMatch = oracleText.match(
    /whenever another ([\w]+) or ([\w]+) you control dies,?\s*([^.]+)/i,
  );
  if (
    anotherMultiTypedCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'another_multi_typed_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherMultiTypedCreatureDiesMatch, 3);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_multi_typed_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrATypedCreatureDiesMatch = oracleText.match(
    /whenever this creature or a ([\w]+) you control dies,?\s*([^.]+)/i,
  );
  if (
    thisOrATypedCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_a_typed_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrATypedCreatureDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_a_typed_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  // Delayed fight/spell follow-up: "When the creature an opponent controls dies this turn, ..."
  const opponentCreatureDiesThisTurnMatch = oracleText.match(
    /when(?:ever)? the creature an opponent controls dies this turn,?\s*([^.]+)/i,
  );
  if (
    opponentCreatureDiesThisTurnMatch
    && !triggers.some((t) => t.triggerType === 'opponent_creature_dies_this_turn')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentCreatureDiesThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_creature_dies_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const itDiesThisTurnMatch = oracleText.match(/when it dies this turn,?\s*([^.]+)/i);
  if (itDiesThisTurnMatch && !triggers.some((t) => t.triggerType === 'it_dies_this_turn')) {
    const effectText = timingTriggerEffect(oracleText, itDiesThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'it_dies_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const permanentYouDontControlDiesThisTurnMatch = oracleText.match(
    /when the permanent you don't control dies this turn,?\s*([^.]+)/i,
  );
  if (
    permanentYouDontControlDiesThisTurnMatch &&
    !triggers.some((t) => t.triggerType === 'permanent_you_dont_control_dies_this_turn')
  ) {
    const effectText = timingTriggerEffect(oracleText, permanentYouDontControlDiesThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'permanent_you_dont_control_dies_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nontokenCounterCreatureDiesMatch = oracleText.match(
    /whenever a nontoken creature you control with a \+1\/\+1 counter on it dies,?\s*([^.]+)/i,
  );
  if (
    nontokenCounterCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'nontoken_counter_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, nontokenCounterCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'nontoken_counter_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreControlledCreaturesDieMatch = oracleText.match(
    /whenever one or more creatures you control die,?\s*([^.]+)/i,
  );
  if (
    oneOrMoreControlledCreaturesDieMatch &&
    !lowerOracle.includes('one or more other creatures you control die') &&
    !triggers.some((t) => t.triggerType === 'one_or_more_controlled_creatures_die')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreControlledCreaturesDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'one_or_more_controlled_creatures_die',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreOtherControlledCreaturesDieMatch = oracleText.match(
    /whenever one or more other creatures you control die,?\s*([^.]+)/i,
  );
  if (
    oneOrMoreOtherControlledCreaturesDieMatch &&
    !triggers.some((t) => t.triggerType === 'one_or_more_other_controlled_creatures_die')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreOtherControlledCreaturesDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'one_or_more_other_controlled_creatures_die',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreNontokenControlledDieMatch = oracleText.match(
    /whenever one or more nontoken creatures you control die,?\s*([^.]+)/i,
  );
  if (
    oneOrMoreNontokenControlledDieMatch &&
    !triggers.some((t) => t.triggerType === 'one_or_more_nontoken_creatures_you_control_die')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreNontokenControlledDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'one_or_more_nontoken_creatures_you_control_die',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const cardPutIntoOpponentGyFromAnywhereMatch = oracleText.match(
    /whenever a card is put into an opponent's graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (
    cardPutIntoOpponentGyFromAnywhereMatch &&
    !triggers.some((t) => t.triggerType === 'card_put_into_opponent_graveyard_from_anywhere')
  ) {
    const effectText = timingTriggerEffect(oracleText, cardPutIntoOpponentGyFromAnywhereMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'card_put_into_opponent_graveyard_from_anywhere',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreNontokenCreaturesDieMatch = oracleText.match(/whenever one or more nontoken creatures die,?\s*([^.]+)/i);
  if (
    oneOrMoreNontokenCreaturesDieMatch &&
    !lowerOracle.includes('nontoken creatures you control die') &&
    !triggers.some((t) => t.triggerType === 'one_or_more_nontoken_creatures_die')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreNontokenCreaturesDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'one_or_more_nontoken_creatures_die',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreCreaturesDieMatch = oracleText.match(/whenever one or more creatures die,?\s*([^.]+)/i);
  if (
    oneOrMoreCreaturesDieMatch &&
    !lowerOracle.includes('one or more other creatures die') &&
    !lowerOracle.includes('one or more nontoken creatures die') &&
    !triggers.some((t) => t.triggerType === 'one_or_more_creatures_die')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreCreaturesDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'one_or_more_creatures_die',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const hauntsCreatureDiesMatch = oracleText.match(
    new RegExp(
      `when(?:ever)? (?:(?:${dieSelfAlternatives.join('|')}) enters(?: the battlefield)? or )?the creature (?:this card|it) haunts dies,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (hauntsCreatureDiesMatch && !triggers.some((t) => t.triggerType === 'haunts_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, hauntsCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'haunts_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const toughnessCreatureDiesMatch = oracleText.match(
    /whenever a creature you control with toughness (\d+) or greater dies,?\s*([^.]+)/i,
  );
  if (toughnessCreatureDiesMatch && !triggers.some((t) => t.triggerType === 'toughness_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, toughnessCreatureDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'toughness_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureCardsYourGyFromAnywhereMatch = oracleText.match(
    /whenever one or more creature cards are put into your graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (
    creatureCardsYourGyFromAnywhereMatch &&
    !triggers.some((t) => t.triggerType === 'creature_cards_your_graveyard_from_anywhere')
  ) {
    const effectText = timingTriggerEffect(oracleText, creatureCardsYourGyFromAnywhereMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_cards_your_graveyard_from_anywhere',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const landCardYourGyFromAnywhereMatch = oracleText.match(
    /whenever a land card is put into your graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (
    landCardYourGyFromAnywhereMatch &&
    !triggers.some((t) => t.triggerType === 'land_card_your_graveyard_from_anywhere')
  ) {
    const effectText = timingTriggerEffect(oracleText, landCardYourGyFromAnywhereMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'land_card_your_graveyard_from_anywhere',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const landCardGyFromAnywhereMatch = oracleText.match(
    /whenever a land card is put into a graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (
    landCardGyFromAnywhereMatch &&
    !lowerOracle.includes('put into your graveyard') &&
    !triggers.some((t) => t.triggerType === 'land_card_graveyard_from_anywhere')
  ) {
    const effectText = timingTriggerEffect(oracleText, landCardGyFromAnywhereMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'land_card_graveyard_from_anywhere',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const landCardsPutIntoGyFromAnywhereMatch = oracleText.match(
    /whenever one or more land cards are put into your graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (
    landCardsPutIntoGyFromAnywhereMatch &&
    !triggers.some((t) => t.triggerType === 'land_cards_put_into_graveyard_from_anywhere')
  ) {
    const effectText = timingTriggerEffect(oracleText, landCardsPutIntoGyFromAnywhereMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'land_cards_put_into_graveyard_from_anywhere',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const dealtDamageThisWayDiesMatch = oracleText.match(
    /when(?:ever)? a creature(?: you control)? dealt damage this way dies this turn,?\s*([^.]+)/i,
  );
  if (dealtDamageThisWayDiesMatch && !triggers.some((t) => t.triggerType === 'dealt_damage_this_way_dies')) {
    const effectText = timingTriggerEffect(oracleText, dealtDamageThisWayDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'dealt_damage_this_way_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const minusCounterCreatureDiesMatch = oracleText.match(
    /whenever a creature with a -1\/-1 counter on it dies,?\s*([^.]+)/i,
  );
  if (
    minusCounterCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'minus_counter_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, minusCounterCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'minus_counter_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const impostorCounterCreatureDiesMatch = oracleText.match(
    /whenever a creature you control with an impostor counter on it dies,?\s*([^.]+)/i,
  );
  if (
    impostorCounterCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'impostor_counter_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, impostorCounterCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'impostor_counter_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const attackingOrBlockingCreatureDiesMatch = oracleText.match(
    /whenever an attacking creature you control or a blocking creature an opponent controls dies,?\s*([^.]+)/i,
  );
  if (
    attackingOrBlockingCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'attacking_or_blocking_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, attackingOrBlockingCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'attacking_or_blocking_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentsCreaturesDieMatch = oracleText.match(
    /whenever one or more creatures your opponents control die,?\s*([^.]+)/i,
  );
  if (
    opponentsCreaturesDieMatch &&
    !triggers.some((t) => t.triggerType === 'opponents_creatures_die')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentsCreaturesDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponents_creatures_die',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const itDiesUnderYourControlThisTurnMatch = oracleText.match(
    /when it dies under your control this turn,?\s*([^.]+)/i,
  );
  if (
    itDiesUnderYourControlThisTurnMatch &&
    !triggers.some((t) => t.triggerType === 'it_dies_under_your_control_this_turn')
  ) {
    const effectText = timingTriggerEffect(oracleText, itDiesUnderYourControlThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'it_dies_under_your_control_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const whenYouDoPayCreateMatch = oracleText.match(
    /when you do, you may pay \{[^}]+\}\. if you do, create[^.]+/i,
  );
  if (
    whenYouDoPayCreateMatch &&
    !triggers.some((t) => t.triggerType === 'when_you_do_pay_create')
  ) {
    const effectText = timingTriggerEffect(oracleText, whenYouDoPayCreateMatch, 0);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'when_you_do_pay_create',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentMinusCounterCreatureDiesMatch = oracleText.match(
    /whenever a creature an opponent controls with a -1\/-1 counter on it dies,?\s*([^.]+)/i,
  );
  if (
    opponentMinusCounterCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'opponent_minus_counter_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentMinusCounterCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_minus_counter_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherTypedCreatureDiesMatch = oracleText.match(
    /whenever another ([\w]+) you control dies,?\s*([^.]+)/i,
  );
  if (
    anotherTypedCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'another_typed_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherTypedCreatureDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_typed_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedCreatureDiesMatch = oracleText.match(/whenever an? ([\w]+) you control dies,?\s*([^.]+)/i);
  const typedDieSubject = String(typedCreatureDiesMatch?.[1] || '').trim().toLowerCase();
  if (
    typedCreatureDiesMatch &&
    typedDieSubject !== 'creature' &&
    !lowerOracle.includes('creature you control dies') &&
    !triggers.some((t) => t.triggerType === 'typed_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedCreatureDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedArtifactGraveyardMatch = oracleText.match(
    /when enchanted artifact is put into (?:a )?graveyard,?\s*([^.]+)/i,
  );
  if (
    enchantedArtifactGraveyardMatch &&
    !triggers.some((t) => t.triggerType === 'enchanted_artifact_graveyard')
  ) {
    const effectText = timingTriggerEffect(oracleText, enchantedArtifactGraveyardMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enchanted_artifact_graveyard',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const cardPutIntoGyFromAnywhereMatch = oracleText.match(
    /when(?:ever)? a card is put into your graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (
    cardPutIntoGyFromAnywhereMatch &&
    !triggers.some((t) => t.triggerType === 'card_put_into_graveyard_from_anywhere')
  ) {
    const effectText = timingTriggerEffect(oracleText, cardPutIntoGyFromAnywhereMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'card_put_into_graveyard_from_anywhere',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }
  
  // ===== KNOWN CARDS TABLE (Optimization/Enhancement) =====
  // Use the table to handle special cases and provide enhanced metadata
  // Only add if not already detected dynamically
  for (const [knownName, info] of Object.entries(KNOWN_DEATH_TRIGGERS)) {
    if (lowerName.includes(knownName)) {
      const triggerType = info.triggerOn === 'controlled' ? 'creature_dies' 
        : info.triggerOn === 'any' ? 'any_creature_dies' 
        : info.triggerOn === 'opponent' ? 'opponent_creature_dies'
        : 'dies';
      
      // Only add if not already detected by dynamic pattern
      if (!triggers.some(t => t.triggerType === triggerType)) {
        triggers.push({
          permanentId,
          cardName,
          triggerType,
          description: info.effect,
          effect: info.effect,
          mandatory: true,
        });
      }
    }
  }
}
