/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectAttackTriggers whenever-creature-attacks watchers
 * Public: appendAttackDetectionWatchers
 */

import { timingTriggerEffect } from "./timing-effect-extraction.js";
import type { AttackDetectionState } from "./attack-detection-state.js";

export function appendAttackDetectionWatchers(state: AttackDetectionState): void {
  const {
    triggers,
    oracleText,
    lowerOracle,
    cardName,
    permanentId,
    controllerId,
    attackNameVariants,
  } = state;

  // "Whenever/When a creature you control attacks"
  const creatureAttacksMatch = oracleText.match(/when(?:ever)? a creature you control attacks,?\s*([^.]+)/i);
  if (creatureAttacksMatch) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_attacks',
      description: timingTriggerEffect(oracleText, creatureAttacksMatch),
      effect: timingTriggerEffect(oracleText, creatureAttacksMatch),
      mandatory: true,
    });
  }

  const chosenTypeAttackMatch = oracleText.match(
    /whenever a creature you control of the chosen type enters or attacks,?\s*([^.]+)/i
  );
  if (chosenTypeAttackMatch && !triggers.some((t) => t.triggerType === 'chosen_type_creature_etb_or_attack')) {
    const effectText = timingTriggerEffect(oracleText, chosenTypeAttackMatch);
    if (effectText) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'chosen_type_creature_etb_or_attack',
        description: effectText,
        effect: effectText,
        mandatory: true,
      });
    }
  }

  const commanderYouControlEtbOrAttackMatch = oracleText.match(
    /whenever a commander you control enters or attacks,?\s*([^.]+)/i,
  );
  if (
    commanderYouControlEtbOrAttackMatch &&
    !triggers.some((t) => t.triggerType === 'commander_you_control_etb_or_attack')
  ) {
    const effectText = timingTriggerEffect(oracleText, commanderYouControlEtbOrAttackMatch);
    if (effectText) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'commander_you_control_etb_or_attack',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const typedTokenPowerOrGreaterAttacksMatch = oracleText.match(
    /whenever an? ([\w-]+) token you control with power (\d+) or greater attacks,?\s*([^.]+)/i,
  );
  if (
    typedTokenPowerOrGreaterAttacksMatch &&
    !triggers.some((t) => t.triggerType === 'typed_token_power_or_greater_attacks')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedTokenPowerOrGreaterAttacksMatch, 3);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'typed_token_power_or_greater_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      requiredTypePhrase: String(typedTokenPowerOrGreaterAttacksMatch[1] || '').trim(),
      minPower: parseInt(String(typedTokenPowerOrGreaterAttacksMatch[2] || '0'), 10),
    } as any);
  }

  const thatCreatureAttacksMatch = oracleText.match(/whenever that creature attacks,?\s*([^.]+)/i);
  if (thatCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'that_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, thatCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'that_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const selfOrEnchantedAttacksMatch = oracleText.match(
    /whenever this creature or enchanted creature attacks,?\s*([^.]+)/i,
  );
  if (
    selfOrEnchantedAttacksMatch &&
    !triggers.some((t) => t.triggerType === 'self_or_enchanted_attacks')
  ) {
    const effectText = timingTriggerEffect(oracleText, selfOrEnchantedAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'self_or_enchanted_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const whenVehicleAttacksMatch = oracleText.match(/when a vehicle you control attacks,?\s*([^.]+)/i);
  if (
    whenVehicleAttacksMatch &&
    !triggers.some((t) => t.triggerType === 'when_vehicle_attacks')
  ) {
    const effectText = timingTriggerEffect(oracleText, whenVehicleAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'when_vehicle_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisTokenAttacksMatch = oracleText.match(/when(?:ever)? this token attacks,?\s*([^.]+)/i);
  if (thisTokenAttacksMatch && !triggers.some((t) => t.triggerType === 'this_token_attacks')) {
    const effectText = timingTriggerEffect(oracleText, thisTokenAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'this_token_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const flyingOrHasteAttacksMatch = oracleText.match(
    /whenever a creature you control with flying and\/or haste attacks,?\s*([^.]+)/i,
  );
  if (
    flyingOrHasteAttacksMatch &&
    !triggers.some((t) => t.triggerType === 'flying_or_haste_attacks')
  ) {
    const effectText = timingTriggerEffect(oracleText, flyingOrHasteAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'flying_or_haste_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    } as any);
  }

  const powerEqualsToughnessAttacksMatch = oracleText.match(
    /whenever a creature you control with power equal to its toughness attacks,?\s*([^.]+)/i,
  );
  if (
    powerEqualsToughnessAttacksMatch &&
    !triggers.some((t) => t.triggerType === 'power_equals_toughness_attacks')
  ) {
    const effectText = timingTriggerEffect(oracleText, powerEqualsToughnessAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'power_equals_toughness_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    } as any);
  }

  const vehicleAttacksMatch = oracleText.match(/whenever a vehicle you control attacks,?\s*([^.]+)/i);
  if (vehicleAttacksMatch && !triggers.some((t) => t.triggerType === 'vehicle_attacks')) {
    const effectText = timingTriggerEffect(oracleText, vehicleAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'vehicle_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentAttacksWithCreaturesMatch = oracleText.match(
    /whenever an opponent attacks with (?:one or more )?creatures,?\s*([^.]+)/i,
  );
  if (
    opponentAttacksWithCreaturesMatch &&
    !triggers.some((t) => t.triggerType === 'opponent_attacks_with_creatures' || t.triggerType === 'opponent_attacks_with_one_or_more_creatures')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentAttacksWithCreaturesMatch);
    const triggerType = /one or more creatures/i.test(String(opponentAttacksWithCreaturesMatch[0] || ''))
      ? 'opponent_attacks_with_one_or_more_creatures'
      : 'opponent_attacks_with_creatures';
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const targetAttacksUnblockedMatch = oracleText.match(
    /when(?:ever)?(?: this turn, )? target creature you control attacks and isn't blocked,?\s*([^.]+)/i,
  );
  if (
    targetAttacksUnblockedMatch &&
    !triggers.some((t) => t.triggerType === 'target_creature_attacks_unblocked')
  ) {
    const effectText = timingTriggerEffect(oracleText, targetAttacksUnblockedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'target_creature_attacks_unblocked',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreTypedAttackMatch = oracleText.match(
    /whenever one or more ([\w]+(?: or [\w]+)*) you control attack,?\s*([^.]+)/i,
  );
  if (
    oneOrMoreTypedAttackMatch &&
    !triggers.some((t) => t.triggerType === 'one_or_more_typed_attack')
  ) {
    const requiredTypePhrase = String(oneOrMoreTypedAttackMatch[1] || '').trim();
    if (!/^(?:creatures?|permanents?|tokens?)$/i.test(requiredTypePhrase)) {
      const effectText = timingTriggerEffect(oracleText, oneOrMoreTypedAttackMatch, 2);
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'one_or_more_typed_attack',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
        requiredTypePhrase,
      } as any);
    }
  }

  const creatureAttacksYouOrPlaneswalkerMatch = oracleText.match(
    /when(?:ever)? a creature attacks you or a planeswalker you control,?\s*([^.]+)/i,
  );
  if (
    creatureAttacksYouOrPlaneswalkerMatch &&
    !triggers.some((t) => t.triggerType === 'creature_attacks_you_or_planeswalker')
  ) {
    const effectText = timingTriggerEffect(oracleText, creatureAttacksYouOrPlaneswalkerMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'creature_attacks_you_or_planeswalker',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const toxicCreatureAttacksMatch = oracleText.match(
    /whenever another creature you control with toxic attacks,?\s*([^.]+)/i,
  );
  if (toxicCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'toxic_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, toxicCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'toxic_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    } as any);
  }

  const twoOrMoreCreaturesAttackMatch = oracleText.match(
    /whenever two or more creatures attack,?\s*([^.]+)/i,
  );
  if (twoOrMoreCreaturesAttackMatch && !triggers.some((t) => t.triggerType === 'two_or_more_creatures_attack')) {
    const effectText = timingTriggerEffect(oracleText, twoOrMoreCreaturesAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'two_or_more_creatures_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreNontokenTypedAttackMatch = oracleText.match(
    /whenever one or more nontoken ([\w]+(?: or [\w]+)*) you control attack,?\s*([^.]+)/i,
  );
  if (
    oneOrMoreNontokenTypedAttackMatch &&
    !triggers.some((t) => t.triggerType === 'one_or_more_nontoken_typed_attack')
  ) {
    const requiredTypePhrase = String(oneOrMoreNontokenTypedAttackMatch[1] || '').trim();
    if (!/^(?:creatures?|permanents?|tokens?)$/i.test(requiredTypePhrase)) {
      const effectText = timingTriggerEffect(oracleText, oneOrMoreNontokenTypedAttackMatch, 2);
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'one_or_more_nontoken_typed_attack',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
        requiredTypePhrase,
      } as any);
    }
  }

  const oneOrMoreArtifactCreaturesAttackMatch = oracleText.match(
    /whenever one or more artifact creatures you control attack,?\s*([^.]+)/i,
  );
  if (
    oneOrMoreArtifactCreaturesAttackMatch &&
    !triggers.some((t) => t.triggerType === 'one_or_more_artifact_creatures_attack')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreArtifactCreaturesAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'one_or_more_artifact_creatures_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const equippedCreatureOtherThanSelfAttacksOrDiesMatch = oracleText.match(
    new RegExp(
      `whenever an equipped creature you control other than (?:${attackNameVariants.join('|')}) attacks or dies,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    equippedCreatureOtherThanSelfAttacksOrDiesMatch &&
    !triggers.some((t) => t.triggerType === 'equipped_creature_other_than_self_attacks_or_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, equippedCreatureOtherThanSelfAttacksOrDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'equipped_creature_other_than_self_attacks_or_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nonToyCreaturesAttackPlayerMatch = oracleText.match(
    /whenever one or more non-Toy creatures you control attack a player,?\s*([^.]+)/i,
  );
  if (
    nonToyCreaturesAttackPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'non_toy_creatures_attack_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, nonToyCreaturesAttackPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'non_toy_creatures_attack_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedOrEquippedAttacksMatch = oracleText.match(
    /whenever a creature you control that's enchanted or equipped attacks,?\s*([^.]+)/i,
  );
  if (
    enchantedOrEquippedAttacksMatch &&
    !triggers.some((t) => t.triggerType === 'enchanted_or_equipped_creature_attacks')
  ) {
    const effectText = timingTriggerEffect(oracleText, enchantedOrEquippedAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'enchanted_or_equipped_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedAndHumanAttackMatch = oracleText.match(
    new RegExp(
      `whenever (?:${attackNameVariants.join('|')}) and at least one Human attack,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedAndHumanAttackMatch &&
    !triggers.some((t) => t.triggerType === 'named_and_human_attack')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedAndHumanAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'named_and_human_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const attackEnchantedOpponentSacrificeMatch = oracleText.match(
    /when you attack enchanted opponent or a planeswalker they control or when they attack you or a planeswalker you control,?\s*([^.]+)/i,
  );
  if (
    attackEnchantedOpponentSacrificeMatch &&
    !triggers.some((t) => t.triggerType === 'attack_enchanted_opponent_sacrifice')
  ) {
    const effectText = timingTriggerEffect(oracleText, attackEnchantedOpponentSacrificeMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'attack_enchanted_opponent_sacrifice',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const twoOrMoreAttackPlayerMatch = oracleText.match(
    /whenever two or more creatures you control attack a player,?\s*([^.]+)/i,
  );
  if (
    twoOrMoreAttackPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'two_or_more_creatures_attack_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, twoOrMoreAttackPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'two_or_more_creatures_attack_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const playerAttacksMatch = oracleText.match(
    /whenever a player attacks(?! one of your opponents| you),?\s*([^.]+)/i,
  );
  if (playerAttacksMatch && !triggers.some((t) => t.triggerType === 'player_attacks')) {
    const effectText = timingTriggerEffect(oracleText, playerAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'player_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedAttacksThisTurnMatch = oracleText.match(
    /whenever a ([\w]+) attacks this turn,?\s*([^.]+)/i,
  );
  if (typedAttacksThisTurnMatch && !triggers.some((t) => t.triggerType === 'typed_attacks_this_turn')) {
    const effectText = timingTriggerEffect(oracleText, typedAttacksThisTurnMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'typed_attacks_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const playerAttacksYouMatch = oracleText.match(/whenever a player attacks you,?\s*([^.]+)/i);
  if (playerAttacksYouMatch && !triggers.some((t) => t.triggerType === 'player_attacks_you')) {
    const effectText = timingTriggerEffect(oracleText, playerAttacksYouMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'player_attacks_you',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const playerAttacksYourOpponentMatch = oracleText.match(
    /whenever a player attacks one of your opponents,?\s*([^.]+)/i,
  );
  if (
    playerAttacksYourOpponentMatch &&
    !triggers.some((t) => t.triggerType === 'player_attacks_your_opponent')
  ) {
    const effectText = timingTriggerEffect(oracleText, playerAttacksYourOpponentMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'player_attacks_your_opponent',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentAttacksYouMatch = oracleText.match(/whenever an opponent attacks you,?\s*([^.]+)/i);
  if (opponentAttacksYouMatch && !triggers.some((t) => t.triggerType === 'opponent_attacks_you')) {
    const effectText = timingTriggerEffect(oracleText, opponentAttacksYouMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'opponent_attacks_you',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreEnchantedByAuraAttackMatch = oracleText.match(
    /whenever one or more creatures that are enchanted by an aura you control attack,?\s*([^.]+)/i,
  );
  if (
    oneOrMoreEnchantedByAuraAttackMatch &&
    !triggers.some((t) => t.triggerType === 'one_or_more_enchanted_by_aura_you_control_attack')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreEnchantedByAuraAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'one_or_more_enchanted_by_aura_you_control_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      batched: true,
    });
  }

  const oneOrMoreAttackMatch = oracleText.match(
    /whenever one or more creatures(?: you control)? attack(?! you),?\s*([^.]+)/i,
  );
  if (oneOrMoreAttackMatch && !triggers.some((t) => t.triggerType === 'one_or_more_creatures_attack')) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'one_or_more_creatures_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: /\byou control\b/i.test(String(oneOrMoreAttackMatch[0] || '')),
    } as any);
  }

  const oneOrMoreAttackYouMatch = oracleText.match(/whenever one or more creatures attack you,?\s*([^.]+)/i);
  if (oneOrMoreAttackYouMatch && !triggers.some((t) => t.triggerType === 'one_or_more_creatures_attack_you')) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreAttackYouMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'one_or_more_creatures_attack_you',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const noFlyingAttacksYouMatch = oracleText.match(
    /whenever a creature without flying attacks you(?: or a planeswalker you control)?,?\s*([^.]+)/i,
  );
  if (noFlyingAttacksYouMatch && !triggers.some((t) => t.triggerType === 'creature_without_flying_attacks_you')) {
    const effectText = timingTriggerEffect(oracleText, noFlyingAttacksYouMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'creature_without_flying_attacks_you',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const powerAttacksYouMatch = oracleText.match(
    /whenever a creature with power (\d+) or greater attacks you,?\s*([^.]+)/i,
  );
  if (powerAttacksYouMatch && !triggers.some((t) => t.triggerType === 'power_creature_attacks_you')) {
    const effectText = timingTriggerEffect(oracleText, powerAttacksYouMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'power_creature_attacks_you',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const youAttackWithTwoMatch = oracleText.match(/whenever you attack with two or more creatures,?\s*([^.]+)/i);
  if (youAttackWithTwoMatch && !triggers.some((t) => t.triggerType === 'you_attack_with_two_or_more')) {
    const effectText = timingTriggerEffect(oracleText, youAttackWithTwoMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'you_attack_with_two_or_more',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const uncontrolledAttacksMatch = oracleText.match(
    /whenever a creature you don't control attacks(?: a player| an opponent)?,?\s*([^.]+)/i,
  );
  if (uncontrolledAttacksMatch && !triggers.some((t) => t.triggerType === 'uncontrolled_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, uncontrolledAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'uncontrolled_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const attacksBattleMatch = oracleText.match(/whenever a creature attacks a battle,?\s*([^.]+)/i);
  if (attacksBattleMatch && !triggers.some((t) => t.triggerType === 'creature_attacks_battle')) {
    const effectText = timingTriggerEffect(oracleText, attacksBattleMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'creature_attacks_battle',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const attacksPlaneswalkerMatch = oracleText.match(/whenever a creature attacks a planeswalker,?\s*([^.]+)/i);
  if (attacksPlaneswalkerMatch && !triggers.some((t) => t.triggerType === 'creature_attacks_planeswalker')) {
    const effectText = timingTriggerEffect(oracleText, attacksPlaneswalkerMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'creature_attacks_planeswalker',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const multiTypedCreatureAttacksAnyMatch = oracleText.match(
    /when(?:ever)? a ([\w]+(?:, [\w]+)+, or [\w]+) attacks,?\s*([^.]+)/i,
  );
  if (
    multiTypedCreatureAttacksAnyMatch &&
    !lowerOracle.includes('you control') &&
    !triggers.some((t) => t.triggerType === 'multi_typed_creature_attacks_any')
  ) {
    const effectText = timingTriggerEffect(oracleText, multiTypedCreatureAttacksAnyMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'multi_typed_creature_attacks_any',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      requiredTypePhrase: String(multiTypedCreatureAttacksAnyMatch[1] || '').trim(),
    } as any);
  }

  const reachCreatureAttacksMatch = oracleText.match(
    /whenever a creature you control with reach attacks,?\s*([^.]+)/i,
  );
  if (reachCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'reach_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, reachCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'reach_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    } as any);
  }

  const magnetCounterCreatureAttacksMatch = oracleText.match(
    /when(?:ever)? a creature with a magnet counter on it attacks,?\s*([^.]+)/i,
  );
  if (
    magnetCounterCreatureAttacksMatch &&
    !triggers.some((t) => t.triggerType === 'magnet_counter_creature_attacks')
  ) {
    const effectText = timingTriggerEffect(oracleText, magnetCounterCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'magnet_counter_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentAttacksBareMatch = oracleText.match(
    /whenever an opponent attacks(?:,|\s+if\b)/i,
  );
  if (
    opponentAttacksBareMatch &&
    !lowerOracle.includes('opponent attacks you') &&
    !lowerOracle.includes('opponent attacks with') &&
    !triggers.some((t) => t.triggerType === 'opponent_attacks')
  ) {
    const fullMatch = oracleText.match(/whenever an opponent attacks,?\s*([^.]+)/i);
    if (fullMatch) {
      const effectText = timingTriggerEffect(oracleText, fullMatch);
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'opponent_attacks',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const multiTypedYouControlAttacksMatch = oracleText.match(
    /whenever an? ([\w]+(?:, [\w]+)+, or [\w]+) you control attacks,?\s*([^.]+)/i,
  );
  if (
    multiTypedYouControlAttacksMatch &&
    !triggers.some((t) => t.triggerType === 'multi_typed_you_control_attacks')
  ) {
    const effectText = timingTriggerEffect(oracleText, multiTypedYouControlAttacksMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'multi_typed_you_control_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      requiredTypePhrase: String(multiTypedYouControlAttacksMatch[1] || '').trim(),
    } as any);
  }

  const youAttackWithThreeOrMoreMatch = oracleText.match(
    /when you attack with three or more creatures,?\s*([^.]+)/i,
  );
  if (
    youAttackWithThreeOrMoreMatch &&
    !triggers.some((t) => t.triggerType === 'you_attack_with_three_or_more_creatures')
  ) {
    const effectText = timingTriggerEffect(oracleText, youAttackWithThreeOrMoreMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'you_attack_with_three_or_more_creatures',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const legendaryAttacksUnblockedMatch = oracleText.match(
    /when a legendary creature you control attacks and isn't blocked,?\s*([^.]+)/i,
  );
  if (
    legendaryAttacksUnblockedMatch &&
    !triggers.some((t) => t.triggerType === 'legendary_creature_attacks_unblocked')
  ) {
    const effectText = timingTriggerEffect(oracleText, legendaryAttacksUnblockedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'legendary_creature_attacks_unblocked',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const spacecraftAttacksMatch = oracleText.match(/whenever this (?:Spacecraft|spacecraft) attacks,?\s*([^.]+)/i);
  if (spacecraftAttacksMatch && !triggers.some((t) => t.triggerType === 'spacecraft_attacks')) {
    const effectText = timingTriggerEffect(oracleText, spacecraftAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'spacecraft_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisAndOtherCreatureTokenAttackMatch = oracleText.match(
    /whenever this creature and at least one other creature token attack,?\s*([^.]+)/i,
  );
  if (
    thisAndOtherCreatureTokenAttackMatch &&
    !triggers.some((t) => t.triggerType === 'this_and_other_creature_token_attack')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisAndOtherCreatureTokenAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'this_and_other_creature_token_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedCreatureAttacksOpponentsMatch = oracleText.match(
    /whenever an enchanted creature attacks one of your opponents,?\s*([^.]+)/i,
  );
  if (
    enchantedCreatureAttacksOpponentsMatch &&
    !triggers.some((t) => t.triggerType === 'enchanted_creature_attacks_opponents')
  ) {
    const effectText = timingTriggerEffect(oracleText, enchantedCreatureAttacksOpponentsMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'enchanted_creature_attacks_opponents',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrCommanderAttacksAloneMatch = oracleText.match(
    /whenever this creature or a commander you control attacks alone,?\s*([^.]+)/i,
  );
  if (
    thisOrCommanderAttacksAloneMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_commander_attacks_alone')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrCommanderAttacksAloneMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'this_or_commander_attacks_alone',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const hasteCreatureAttacksMatch = oracleText.match(
    /whenever a creature you control with haste attacks,?\s*([^.]+)/i,
  );
  if (hasteCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'haste_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, hasteCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'haste_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    } as any);
  }

  const threeOrMoreFlyingAttackMatch = oracleText.match(
    /whenever three or more creatures you control with flying attack,?\s*([^.]+)/i,
  );
  if (threeOrMoreFlyingAttackMatch && !triggers.some((t) => t.triggerType === 'three_or_more_flying_creatures_attack')) {
    const effectText = timingTriggerEffect(oracleText, threeOrMoreFlyingAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'three_or_more_flying_creatures_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const flyingAttacksMatch = oracleText.match(
    /whenever a creature(?: you control)? with flying attacks,?\s*([^.]+)/i,
  );
  if (flyingAttacksMatch && !triggers.some((t) => t.triggerType === 'flying_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, flyingAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'flying_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: /\ba creature you control\b/i.test(String(flyingAttacksMatch[0] || '')),
    } as any);
  }

  const playerAttacksWithPattern = /whenever (?:a|another) player attacks with (?:\w+|\d+) or more creatures,?\s*([^.]+)/gi;
  let playerAttacksWithMatch: RegExpExecArray | null;
  while ((playerAttacksWithMatch = playerAttacksWithPattern.exec(oracleText)) !== null) {
    const effectText = timingTriggerEffect(oracleText, playerAttacksWithMatch);
    if (!effectText) continue;
    if (triggers.some((t) => String(t.effect || '').trim().toLowerCase() === effectText.toLowerCase())) continue;
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'player_attacks_with_creatures',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }
  
  // Join Forces attack trigger (Mana-Charged Dragon)
  // "Whenever ~ attacks, starting with you, each player may pay any amount of mana"
  if (lowerOracle.includes('join forces') && 
      lowerOracle.includes('whenever') && 
      lowerOracle.includes('attacks')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'join_forces_attack',
      description: 'Join forces - each player may pay any amount of mana',
      effect: oracleText,
      mandatory: true,
      value: {
        isJoinForces: true,
      },
    });
  }
}
