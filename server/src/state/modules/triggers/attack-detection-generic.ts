/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectAttackTriggers generic whenever-~-attacks
 * Public: appendAttackDetectionGeneric
 */

import { timingTriggerEffect } from "./timing-effect-extraction.js";
import type { AttackDetectionState } from "./attack-detection-state.js";

export function appendAttackDetectionGeneric(state: AttackDetectionState): void {
  const {
    triggers,
    oracleText,
    lowerOracle,
    cardName,
    permanentId,
    controllerId,
    optionalManaPaymentPattern,
    attackNameVariants,
    findGenericAttackTriggerLine,
  } = state;

  // Generic "whenever ~ attacks"
  const attacksMatch = findGenericAttackTriggerLine();
  const genericAttackEffect = attacksMatch ? String(attacksMatch[1] || '').trim() : '';
  if (
    attacksMatch
    && !/^or blocks\b/i.test(genericAttackEffect)
    && !triggers.some(t => t.triggerType === 'attacks' || t.triggerType === 'battalion' || t.triggerType === 'attacks_or_blocks')
  ) {
    const effectText = timingTriggerEffect(oracleText, attacksMatch);
    
    // Check if this is an optional mana/energy payment trigger (e.g., Casal, Filigree Racer)
    // Pattern: "you may pay {X}. If/When you do, ..."
    const mayPayMatch = effectText.match(optionalManaPaymentPattern);
    
    if (mayPayMatch) {
      const paymentCost = String(mayPayMatch[1] || '').trim();
      const energyCost = (paymentCost.match(/\{e\}/gi) || []).length;
      // Optional mana/energy payment trigger
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'attacks',
        description: effectText,
        effect: timingTriggerEffect(oracleText, mayPayMatch, 2), // The effect after "If you do,"
        ...(energyCost > 0 ? { energyCost } : { manaCost: paymentCost }),
        mandatory: false, // Optional because of "may"
      } as any);
    } else {
      // Regular mandatory attack trigger
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'attacks',
        description: effectText,
        effect: effectText,
        mandatory: true,
      });
    }
  }
  
  const attackPayWhenYouDoMatch = oracleText.match(
    /whenever you attack,?\s*you may pay (\{[^}]+\}(?:\{[^}]+\})*)\.\s*when you do,?\s*([^.]+)/i,
  );
  if (attackPayWhenYouDoMatch && !triggers.some((t) => t.triggerType === 'when_you_do')) {
    const effectText = timingTriggerEffect(oracleText, attackPayWhenYouDoMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'when_you_do',
      description: effectText,
      effect: effectText,
      manaCost: String(attackPayWhenYouDoMatch[1] || '').trim(),
      mandatory: false,
    });
  }

  const commanderAttacksMatch = oracleText.match(
    /whenever your commander (?:enters(?: the battlefield)?\s+or\s+)?attacks,?\s*([^.]+)/i,
  );
  if (commanderAttacksMatch && !triggers.some((t) => t.triggerType === 'commander_attacks')) {
    const effectText = timingTriggerEffect(oracleText, commanderAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'commander_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const bossesAttackMatch = oracleText.match(/whenever the bosses attack,?\s*([^.]+)/i);
  if (bossesAttackMatch && !triggers.some((t) => t.triggerType === 'bosses_attack')) {
    const effectText = timingTriggerEffect(oracleText, bossesAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'bosses_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const ringBearerAttacksMatch = oracleText.match(/whenever your ring-bearer attacks,?\s*([^.]+)/i);
  if (ringBearerAttacksMatch && !triggers.some((t) => t.triggerType === 'ring_bearer_attacks')) {
    const effectText = timingTriggerEffect(oracleText, ringBearerAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'ring_bearer_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const youAttackMatch = oracleText.match(/whenever you attack,?\s*([^.]+)/i);
  if (youAttackMatch && !triggers.some((t) => t.triggerType === 'you_attack')) {
    const effectText = timingTriggerEffect(oracleText, youAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'you_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const selfEntersOrAttacksPattern = new RegExp(
    `whenever\\s+(?:~|this creature|this vehicle|(?:${attackNameVariants.join('|')}))\\s+enters(?: the battlefield)?\\s+or\\s+attacks,?\\s*([^.]+)`,
    'i',
  );

  const vehicleAttacksOrBlocksMatch = oracleText.match(/whenever this vehicle attacks or blocks,?\s*([^.]+)/i);
  if (vehicleAttacksOrBlocksMatch && !triggers.some((t) => t.triggerType === 'attacks_or_blocks')) {
    const effectText = timingTriggerEffect(oracleText, vehicleAttacksOrBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'attacks_or_blocks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const attacksOrDiesAttackMatch = oracleText.match(
    new RegExp(`whenever\\s+(?:~|this creature|this vehicle|(?:${attackNameVariants.join('|')}))\\s+attacks\\s+or\\s+dies,?\\s*([^.]+)`, 'i'),
  );
  if (attacksOrDiesAttackMatch && !triggers.some((t) => t.triggerType === 'attacks_or_dies')) {
    const effectText = timingTriggerEffect(oracleText, attacksOrDiesAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'attacks_or_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreModifiedCreaturesAttackMatch = oracleText.match(
    /whenever one or more modified creatures you control attack,?\s*([^.]+)/i,
  );
  if (
    oneOrMoreModifiedCreaturesAttackMatch &&
    !triggers.some((t) => t.triggerType === 'one_or_more_modified_creatures_attack')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreModifiedCreaturesAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'one_or_more_modified_creatures_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const trampleCreatureAttacksMatch = oracleText.match(
    /whenever a creature you control with trample attacks,?\s*([^.]+)/i,
  );
  if (trampleCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'trample_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, trampleCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'trample_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const attackInBandMatch = oracleText.match(
    /whenever two or more creatures you control attack in a band,?\s*([^.]+)/i,
  );
  if (attackInBandMatch && !triggers.some((t) => t.triggerType === 'attack_in_band')) {
    const effectText = timingTriggerEffect(oracleText, attackInBandMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'attack_in_band',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const youAttackWithExactlyTwoCreaturesMatch = oracleText.match(
    /when you attack with exactly two creatures,?\s*([^.]+)/i,
  );
  if (
    youAttackWithExactlyTwoCreaturesMatch &&
    !triggers.some((t) => t.triggerType === 'you_attack_with_exactly_two_creatures')
  ) {
    const effectText = timingTriggerEffect(oracleText, youAttackWithExactlyTwoCreaturesMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'you_attack_with_exactly_two_creatures',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const teamExactlyTwoCreaturesAttackMatch = oracleText.match(
    /whenever your team attacks with exactly two creatures,?\s*([^.]+)/i,
  );
  if (
    teamExactlyTwoCreaturesAttackMatch &&
    !triggers.some((t) => t.triggerType === 'team_exactly_two_creatures_attack')
  ) {
    const effectText = timingTriggerEffect(oracleText, teamExactlyTwoCreaturesAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'team_exactly_two_creatures_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const vehicleCrewedByNameAttacksMatch = oracleText.match(
    new RegExp(
      `whenever a vehicle crewed by (?:${attackNameVariants.join('|')}) this turn attacks,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    vehicleCrewedByNameAttacksMatch &&
    !triggers.some((t) => t.triggerType === 'vehicle_crewed_by_name_attacks')
  ) {
    const effectText = timingTriggerEffect(oracleText, vehicleCrewedByNameAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'vehicle_crewed_by_name_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneLandAttacksAnotherMatch = oracleText.match(/when one land attacks another,?\s*([^.]+)/i);
  if (oneLandAttacksAnotherMatch && !triggers.some((t) => t.triggerType === 'one_land_attacks_another')) {
    const effectText = timingTriggerEffect(oracleText, oneLandAttacksAnotherMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'one_land_attacks_another',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const revelerAttacksMatch = oracleText.match(/whenever a Reveler attacks,?\s*([^.]+)/i);
  if (revelerAttacksMatch && !triggers.some((t) => t.triggerType === 'reveler_attacks')) {
    const effectText = timingTriggerEffect(oracleText, revelerAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'reveler_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const allNonWallAttackMatch = oracleText.match(
    /whenever all non-Wall creatures you control attack,?\s*([^.]+)/i,
  );
  if (allNonWallAttackMatch && !triggers.some((t) => t.triggerType === 'all_non_wall_creatures_attack')) {
    const effectText = timingTriggerEffect(oracleText, allNonWallAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'all_non_wall_creatures_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisAndTypedAttackMatch = oracleText.match(
    /whenever this creature and at least one other ([\w]+) attack,?\s*([^.]+)/i,
  );
  if (thisAndTypedAttackMatch && !triggers.some((t) => t.triggerType === 'this_and_typed_creature_attack')) {
    const effectText = timingTriggerEffect(oracleText, thisAndTypedAttackMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'this_and_typed_creature_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nontokenCreatureAttacksMatch = oracleText.match(
    /whenever a nontoken creature(?: you control)? attacks,?\s*([^.]+)/i,
  );
  if (
    nontokenCreatureAttacksMatch &&
    !triggers.some((t) => t.triggerType === 'nontoken_creature_attacks')
  ) {
    const effectText = timingTriggerEffect(oracleText, nontokenCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'nontoken_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const itAttacksMatch = oracleText.match(/whenever it attacks,?\s*([^.]+)/i);
  if (itAttacksMatch && !triggers.some((t) => t.triggerType === 'it_attacks')) {
    const effectText = timingTriggerEffect(oracleText, itAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'it_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentsTwoOrMoreAttackMatch = oracleText.match(
    /whenever two or more creatures your opponents control attack,?\s*([^.]+)/i,
  );
  if (
    opponentsTwoOrMoreAttackMatch &&
    !triggers.some((t) => t.triggerType === 'opponents_two_or_more_creatures_attack')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentsTwoOrMoreAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'opponents_two_or_more_creatures_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherTypedCreatureAttacksMatch = oracleText.match(
    /whenever another ([\w]+) you control attacks,?\s*([^.]+)/i,
  );
  if (
    anotherTypedCreatureAttacksMatch &&
    !triggers.some((t) => t.triggerType === 'another_typed_creature_attacks')
  ) {
    const typedSubject = String(anotherTypedCreatureAttacksMatch[1] || '').trim().toLowerCase();
    if (!['creature', 'vehicle', 'permanent'].includes(typedSubject)) {
      const effectText = timingTriggerEffect(oracleText, anotherTypedCreatureAttacksMatch, 2);
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'another_typed_creature_attacks',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const modifiedCreatureAttacksMatch = oracleText.match(/whenever a modified creature you control attacks,?\s*([^.]+)/i);
  if (modifiedCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'modified_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, modifiedCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'modified_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  // Soulblade Corrupter: "Whenever a creature with a +1/+1 counter on it attacks one of your opponents"
  // Also covers "a creature you control with a +1/+1 counter on it attacks"
  const counterCreatureAttacksMatch = oracleText.match(
    /whenever a creature(?: you control)? with a \+1\/\+1 counter on it attacks(?:\s+(?:one of your opponents|an opponent|a player))?,?\s*([^.]+)/i,
  );
  if (counterCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'counter_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, counterCreatureAttacksMatch);
    const matchText = String(counterCreatureAttacksMatch[0] || '');
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'counter_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: /\ba creature you control\b/i.test(matchText),
      requiresOpponentDefender: /\battacks(?:\s+one of your opponents|\s+an opponent)/i.test(matchText),
    } as any);
  }

  const lowPowerCreatureAttacksMatch = oracleText.match(
    /whenever a creature you control with power (\d+) or less attacks,?\s*([^.]+)/i,
  );
  if (lowPowerCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'low_power_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, lowPowerCreatureAttacksMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'low_power_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      maxPower: parseInt(String(lowPowerCreatureAttacksMatch[1] || '0'), 10),
    } as any);
  }

  const typedAttacksAloneMatch = oracleText.match(
    /whenever a ([\w]+(?: or [\w]+)*) you control attacks alone,?\s*([^.]+)/i,
  );
  if (typedAttacksAloneMatch && !triggers.some((t) => t.triggerType === 'typed_attacks_alone')) {
    const effectText = timingTriggerEffect(oracleText, typedAttacksAloneMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'typed_attacks_alone',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureAttacksAloneMatch = oracleText.match(
    /whenever a creature you control attacks alone,?\s*([^.]+)/i,
  );
  if (creatureAttacksAloneMatch && !triggers.some((t) => t.triggerType === 'creature_attacks_alone')) {
    const effectText = timingTriggerEffect(oracleText, creatureAttacksAloneMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'creature_attacks_alone',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedPlayerAttackedMatch = oracleText.match(
    /whenever enchanted player is attacked,?\s*([^.]+)/i,
  );
  if (enchantedPlayerAttackedMatch && !triggers.some((t) => t.triggerType === 'enchanted_player_attacked')) {
    const effectText = timingTriggerEffect(oracleText, enchantedPlayerAttackedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'enchanted_player_attacked',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const curseAttackMatch = oracleText.match(
    /whenever a player attacks enchanted player with one or more creatures,?\s*([^.]+)/i,
  );
  if (curseAttackMatch && !triggers.some((t) => t.triggerType === 'curse_attack')) {
    const effectText = timingTriggerEffect(oracleText, curseAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'curse_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }
  const selfEntersOrAttacksMatch = oracleText.match(selfEntersOrAttacksPattern);
  if (selfEntersOrAttacksMatch && !triggers.some((t) => t.triggerType === 'self_enters_or_attacks')) {
    const effectText = timingTriggerEffect(oracleText, selfEntersOrAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'self_enters_or_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentCreatureAttacksMatch = oracleText.match(/whenever a creature an opponent controls attacks,?\s*([^.]+)/i);
  if (opponentCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'opponent_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, opponentCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'opponent_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const attacksOrBlocksMatch = oracleText.match(
    new RegExp(`when(?:ever)? (?:~|this creature|(?:${attackNameVariants.join('|')})) attacks or blocks,?\\s*([^.]+)`, 'i'),
  );
  if (attacksOrBlocksMatch && !triggers.some((t) => t.triggerType === 'attacks_or_blocks')) {
    const effectText = timingTriggerEffect(oracleText, attacksOrBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'attacks_or_blocks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anyCreatureAttacksOrBlocksMatch = oracleText.match(/whenever a creature attacks or blocks,?\s*([^.]+)/i);
  if (anyCreatureAttacksOrBlocksMatch && !triggers.some((t) => t.triggerType === 'any_creature_attacks_or_blocks')) {
    const effectText = timingTriggerEffect(oracleText, anyCreatureAttacksOrBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'any_creature_attacks_or_blocks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anyCreatureAttacksMatch = oracleText.match(/whenever a creature attacks(?! this turn)(?! or blocks),?\s*([^.]+)/i);
  if (
    anyCreatureAttacksMatch &&
    !triggers.some((t) => t.triggerType === 'any_creature_attacks' || t.triggerType === 'creature_attacks' || t.triggerType === 'creature_attacks_this_turn')
  ) {
    const effectText = timingTriggerEffect(oracleText, anyCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'any_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureAttacksThisTurnMatch = oracleText.match(/whenever a creature attacks this turn,?\s*([^.]+)/i);
  if (creatureAttacksThisTurnMatch && !triggers.some((t) => t.triggerType === 'creature_attacks_this_turn')) {
    const effectText = timingTriggerEffect(oracleText, creatureAttacksThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'creature_attacks_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: true,
    });
  }

  const anotherCreatureAttacksMatch = oracleText.match(/whenever another creature you control attacks,?\s*([^.]+)/i);
  if (anotherCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'another_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, anotherCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const equippedCreatureAttacksMatch = oracleText.match(
    /whenever an equipped creature you control attacks,?\s*([^.]+)/i,
  );
  if (equippedCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'equipped_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, equippedCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'equipped_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedSubtypeAttacksMatch = oracleText.match(
    /whenever an? ([\w]+(?: or [\w]+)*) you control attacks,?\s*([^.]+)/i,
  );
  const typedSubtypeExcluded = new Set([
    'creature',
    'nontoken',
    'modified',
    'permanent',
    'vehicle',
    'land',
    'player',
    'spell',
    'token',
  ]);
  if (
    typedSubtypeAttacksMatch &&
    !typedSubtypeExcluded.has(String(typedSubtypeAttacksMatch[1] || '').trim().toLowerCase()) &&
    !/\bcreature\b/i.test(String(typedSubtypeAttacksMatch[1] || '')) &&
    !triggers.some((t) => t.triggerType === 'typed_subtype_attacks')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedSubtypeAttacksMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'typed_subtype_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      requiredTypePhrase: String(typedSubtypeAttacksMatch[1] || '').trim(),
    } as any);
  }

  const typedCreatureAttacksMatch = oracleText.match(
    /whenever an? (?:[\w]+\s+)+creature you control attacks,?\s*([^.]+)/i,
  );
  if (
    typedCreatureAttacksMatch &&
    !lowerOracle.includes('a creature you control attacks') &&
    !lowerOracle.includes('nontoken creature you control attacks') &&
    !lowerOracle.includes('another creature you control attacks') &&
    !lowerOracle.includes('equipped creature you control attacks') &&
    !lowerOracle.includes('modified creature you control attacks') &&
    !triggers.some((t) => t.triggerType === 'typed_creature_attacks')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const deathtouchCreatureAttacksMatch = oracleText.match(
    /whenever a creature you control with deathtouch attacks,?\s*([^.]+)/i,
  );
  if (deathtouchCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'deathtouch_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, deathtouchCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'deathtouch_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const chosenNameCreatureAttacksMatch = oracleText.match(
    /whenever a creature you control with the chosen name attacks,?\s*([^.]+)/i,
  );
  if (chosenNameCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'chosen_name_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, chosenNameCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'chosen_name_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedAndOtherCreatureAttackMatch = oracleText.match(
    new RegExp(
      `whenever (?:${attackNameVariants.join('|')}) and at least (?:one|two|three|\\d+) other (?:creature|warrior)s? attack,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedAndOtherCreatureAttackMatch &&
    !triggers.some((t) => t.triggerType === 'named_and_other_creature_attack')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedAndOtherCreatureAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'named_and_other_creature_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedEnterOrAttackMatch = oracleText.match(
    new RegExp(`whenever (?:${attackNameVariants.join('|')}) enter or attack,?\\s*([^.]+)`, 'i'),
  );
  if (namedEnterOrAttackMatch && !triggers.some((t) => t.triggerType === 'named_enter_or_attack')) {
    const effectText = timingTriggerEffect(oracleText, namedEnterOrAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'named_enter_or_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

}
