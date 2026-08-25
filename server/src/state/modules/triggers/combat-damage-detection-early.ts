/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectCombatDamageTriggers early watcher patterns
 * Public: appendCombatDamageDetectionEarly
 */

import { timingTriggerEffect } from "./timing-effect-extraction.js";
import type { CombatDamageDetectionState } from "./combat-damage-detection-state.js";

export function appendCombatDamageDetectionEarly(state: CombatDamageDetectionState): void {
  const {
    triggers,
    oracleText,
    lowerOracle,
    cardName,
    permanentId,
    combatNameVariants,
  } = state;

  // "Whenever one or more creatures you control deal combat damage to a player" (batched trigger)
  // Examples: Professional Face-Breaker, Idol of Oblivion, etc.
  const opponentsDealtCombatDamageMatch = oracleText.match(
    /whenever your opponents are dealt combat damage,?\s*([^.]+)/i,
  );
  if (
    opponentsDealtCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'opponents_dealt_combat_damage')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentsDealtCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponents_dealt_combat_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const batchedCombatDamageMatch = oracleText.match(/when(?:ever)?\s+one\s+or\s+more\s+creatures\s+you\s+control\s+deal\s+combat\s+damage\s+to\s+(?:a\s+)?(?:player|an?\s+opponent),?\s*([^.]+)/i);
  if (batchedCombatDamageMatch && !triggers.some(t => t.triggerType === 'creatures_deal_combat_damage_batched')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creatures_deal_combat_damage_batched',
      description: timingTriggerEffect(oracleText, batchedCombatDamageMatch),
      effect: timingTriggerEffect(oracleText, batchedCombatDamageMatch),
      mandatory: true,
      batched: true,  // This trigger should only fire once per combat damage step if any creatures dealt damage
    });
  }

  const typedCreatureCombatDamageMatch = oracleText.match(
    /whenever an? (?:[\w]+\s+)+creature you control deals combat damage to (?:a player|an opponent),?\s*([^.]+)/i,
  );
  if (
    typedCreatureCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'typed_creature_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedCreatureCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_creature_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureCombatDamageToYouMatch = oracleText.match(
    /whenever a creature deals combat damage to you,?\s*([^.]+)/i,
  );
  if (
    creatureCombatDamageToYouMatch &&
    !triggers.some((t) => t.triggerType === 'creature_combat_damage_to_you')
  ) {
    const effectText = timingTriggerEffect(oracleText, creatureCombatDamageToYouMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_combat_damage_to_you',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const ringBearerCombatDamageMatch = oracleText.match(
    /whenever your ring-bearer deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    ringBearerCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'ring_bearer_combat_damage')
  ) {
    const effectText = timingTriggerEffect(oracleText, ringBearerCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'ring_bearer_combat_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anyCreatureCombatDamageToPlayerMatch = oracleText.match(
    /whenever a creature deals combat damage to (?:a )?player,?\s*([^.]+)/i,
  );
  if (
    anyCreatureCombatDamageToPlayerMatch &&
    !lowerOracle.includes('creature you control deals combat damage') &&
    !triggers.some((t) => t.triggerType === 'any_creature_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, anyCreatureCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'any_creature_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const controlledCreatureCombatDamageMatch = oracleText.match(
    /whenever a (?:[\w]+\s+)*creature you control deals combat damage to (?:a player|an opponent),?\s*([^.]+)/i,
  );
  if (
    controlledCreatureCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'controlled_creature_deals_combat_damage')
  ) {
    const effectText = timingTriggerEffect(oracleText, controlledCreatureCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'controlled_creature_deals_combat_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const controlledCreatureCombatDamageAnyMatch = oracleText.match(
    /whenever a (?:[\w]+\s+)*creature you control deals combat damage(?: during your turn)?(?! to),?\s*([^.]+)/i,
  );
  if (
    controlledCreatureCombatDamageAnyMatch &&
    !triggers.some((t) => t.triggerType === 'controlled_creature_deals_combat_damage_any')
  ) {
    const effectText = timingTriggerEffect(oracleText, controlledCreatureCombatDamageAnyMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'controlled_creature_deals_combat_damage_any',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const controlledCreatureCombatDamageToPlaneswalkerMatch = oracleText.match(
    /whenever a (?:[\w]+\s+)*creature you control deals combat damage to a planeswalker,?\s*([^.]+)/i,
  );
  if (
    controlledCreatureCombatDamageToPlaneswalkerMatch &&
    !triggers.some((t) => t.triggerType === 'controlled_creature_combat_damage_to_planeswalker')
  ) {
    const effectText = timingTriggerEffect(oracleText, controlledCreatureCombatDamageToPlaneswalkerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'controlled_creature_combat_damage_to_planeswalker',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const controlledCreatureCombatDamageToThatPlayerMatch = oracleText.match(
    /whenever a creature you control deals combat damage to that player(?: this turn)?,?\s*([^.]+)/i,
  );
  if (
    controlledCreatureCombatDamageToThatPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'controlled_creature_combat_damage_to_that_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, controlledCreatureCombatDamageToThatPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'controlled_creature_combat_damage_to_that_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const counterCreatureCombatDamageToPlayerMatch = oracleText.match(
    /whenever a creature you control with a \+1\/\+1 counter on it deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    counterCreatureCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'counter_creature_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, counterCreatureCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'counter_creature_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anyCounterCreatureCombatDamageToPlayerMatch = oracleText.match(
    /whenever a creature you control with a counter on it deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    anyCounterCreatureCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'any_counter_creature_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, anyCounterCreatureCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'any_counter_creature_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrAnotherTypedCombatDamageToPlayerMatch = oracleText.match(
    /whenever this creature or another ([\w]+) you control deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherTypedCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_typed_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherTypedCombatDamageToPlayerMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_typed_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedCreatureCombatDamageToPlayerNoControlMatch = oracleText.match(
    /whenever a ([\w]+(?: or [\w]+)?) deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    typedCreatureCombatDamageToPlayerNoControlMatch &&
    !lowerOracle.includes('you control') &&
    !triggers.some((t) => t.triggerType === 'typed_creature_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedCreatureCombatDamageToPlayerNoControlMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_creature_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedCreatureCombatDamageToPlayerMatch = oracleText.match(
    /whenever a ([\w]+(?: or [\w]+)?) you control deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    typedCreatureCombatDamageToPlayerMatch &&
    !lowerOracle.includes('creature you control deals combat damage') &&
    !triggers.some((t) => t.triggerType === 'typed_creature_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedCreatureCombatDamageToPlayerMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_creature_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const vehicleCombatDamageToPlayerMatch = oracleText.match(
    /whenever a vehicle you control deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    vehicleCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'vehicle_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, vehicleCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'vehicle_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const combatDamageToYourOpponentMatch = oracleText.match(
    /whenever a creature deals combat damage to one of your opponents,?\s*([^.]+)/i,
  );
  if (
    combatDamageToYourOpponentMatch &&
    !triggers.some((t) => t.triggerType === 'combat_damage_to_your_opponent')
  ) {
    const effectText = timingTriggerEffect(oracleText, combatDamageToYourOpponentMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'combat_damage_to_your_opponent',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const combatDamageToEnchantedPlayerMatch = oracleText.match(
    /whenever a creature deals combat damage to enchanted player,?\s*([^.]+)/i,
  );
  if (
    combatDamageToEnchantedPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'combat_damage_to_enchanted_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, combatDamageToEnchantedPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'combat_damage_to_enchanted_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thatCreatureCombatDamageToPlayerThisTurnMatch = oracleText.match(
    /when(?:ever)? that creature deals combat damage to (?:a player|an opponent) or (?:a )?planeswalker this turn,?\s*([^.]+)/i,
  );
  if (
    thatCreatureCombatDamageToPlayerThisTurnMatch &&
    !triggers.some((t) => t.triggerType === 'that_creature_combat_damage_to_player_or_planeswalker_this_turn')
  ) {
    const effectText = timingTriggerEffect(oracleText, thatCreatureCombatDamageToPlayerThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'that_creature_combat_damage_to_player_or_planeswalker_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thatCreatureCombatDamageToPlayerOnlyThisTurnMatch = oracleText.match(
    /when(?:ever)? that creature deals combat damage to a player this turn,?\s*([^.]+)/i,
  );
  if (
    thatCreatureCombatDamageToPlayerOnlyThisTurnMatch &&
    !triggers.some((t) => t.triggerType === 'that_creature_combat_damage_to_player_this_turn')
  ) {
    const effectText = timingTriggerEffect(oracleText, thatCreatureCombatDamageToPlayerOnlyThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'that_creature_combat_damage_to_player_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thatCreatureCombatDamageThisTurnMatch = oracleText.match(
    /whenever that creature deals combat damage this turn,?\s*([^.]+)/i,
  );
  if (
    thatCreatureCombatDamageThisTurnMatch &&
    !triggers.some((t) => t.triggerType === 'that_creature_combat_damage_this_turn')
  ) {
    const effectText = timingTriggerEffect(oracleText, thatCreatureCombatDamageThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'that_creature_combat_damage_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const deathtouchCombatDamageToPlayerMatch = oracleText.match(
    /whenever a creature you control with deathtouch deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    deathtouchCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'deathtouch_creature_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, deathtouchCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'deathtouch_creature_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const assassinCombatDamageToPlayerMatch = oracleText.match(
    /whenever an? ([\w]+) you control deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    assassinCombatDamageToPlayerMatch &&
    !lowerOracle.includes('creature you control deals combat damage') &&
    !triggers.some((t) => t.triggerType === 'typed_creature_combat_damage_to_player')
  ) {
    const typedSubject = String(assassinCombatDamageToPlayerMatch[1] || '').trim().toLowerCase();
    if (!['creature', 'vehicle', 'permanent'].includes(typedSubject)) {
      const effectText = timingTriggerEffect(oracleText, assassinCombatDamageToPlayerMatch, 2);
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'typed_creature_combat_damage_to_player',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const thatCreatureCombatDamageThisCombatMatch = oracleText.match(
    /whenever that creature deals combat damage to a player this combat,?\s*([^.]+)/i,
  );
  if (
    thatCreatureCombatDamageThisCombatMatch &&
    !triggers.some((t) => t.triggerType === 'that_creature_combat_damage_to_player_this_combat')
  ) {
    const effectText = timingTriggerEffect(oracleText, thatCreatureCombatDamageThisCombatMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'that_creature_combat_damage_to_player_this_combat',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const skulkCombatDamageMatch = oracleText.match(
    /whenever a creature with skulk deals combat damage to one of your opponents,?\s*([^.]+)/i,
  );
  if (skulkCombatDamageMatch && !triggers.some((t) => t.triggerType === 'skulk_creature_combat_damage_to_opponent')) {
    const effectText = timingTriggerEffect(oracleText, skulkCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'skulk_creature_combat_damage_to_opponent',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const faceDownCreaturesCombatDamageMatch = oracleText.match(
    /whenever one or more face-down creatures you control deal combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    faceDownCreaturesCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'face_down_creatures_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, faceDownCreaturesCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'face_down_creatures_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creaturesPlayerControlsCombatDamageToYouMatch = oracleText.match(
    /whenever one or more creatures a player controls deal combat damage to you,?\s*([^.]+)/i,
  );
  if (
    creaturesPlayerControlsCombatDamageToYouMatch &&
    !triggers.some((t) => t.triggerType === 'creatures_player_controls_combat_damage_to_you')
  ) {
    const effectText = timingTriggerEffect(oracleText, creaturesPlayerControlsCombatDamageToYouMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creatures_player_controls_combat_damage_to_you',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const otherNontokenCreaturesCombatDamageToPlayerMatch = oracleText.match(
    /whenever one or more other nontoken creatures you control deal combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    otherNontokenCreaturesCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'other_nontoken_creatures_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, otherNontokenCreaturesCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'other_nontoken_creatures_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedCreaturesCombatDamageToOpponentsMatch = oracleText.match(
    /whenever one or more ([\w]+(?: or [\w]+)*) you control deal combat damage to one or more of your opponents,?\s*([^.]+)/i,
  );
  if (
    typedCreaturesCombatDamageToOpponentsMatch &&
    !triggers.some((t) => t.triggerType === 'typed_creatures_combat_damage_to_opponents')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedCreaturesCombatDamageToOpponentsMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_creatures_combat_damage_to_opponents',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedOrEquippedCombatDamageToPlayerMatch = oracleText.match(
    new RegExp(
      `whenever (?:${combatNameVariants.join('|')}) or equipped creature deals combat damage to a player,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedOrEquippedCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_equipped_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrEquippedCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_equipped_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedSelfCombatDamageToPlayerMatch = oracleText.match(
    new RegExp(
      `when(?:ever)? (?:${combatNameVariants.join('|')}) deal(?:s)? combat damage to a player,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedSelfCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'named_self_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedSelfCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_self_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }
}
