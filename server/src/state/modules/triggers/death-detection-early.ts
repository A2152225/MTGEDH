/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectDeathTriggers early pattern run
 * Public: appendDeathDetectionEarly
 */

import { timingTriggerEffect } from "./timing-effect-extraction.js";
import { ENTERS_OR_OTHER_EVENT_PREFIX } from "./enters-or-other-event-prefix.js";
import type { DeathDetectionState } from "./death-detection-state.js";

export function appendDeathDetectionEarly(state: DeathDetectionState): void {
  const {
    triggers,
    oracleText,
    lowerOracle,
    cardName,
    permanentId,
    dieNameVariants,
    dieSelfAlternatives,
  } = state;

  const attacksOrDiesPattern = new RegExp(
    `whenever\\s+(?:${dieSelfAlternatives.join('|')})\\s+attacks\\s+or\\s+dies,?\\s*([^.]+)`,
    'i',
  );
  const attacksOrDiesMatch = oracleText.match(attacksOrDiesPattern);
  if (attacksOrDiesMatch && !triggers.some((t) => t.triggerType === 'attacks_or_dies')) {
    const effectText = timingTriggerEffect(oracleText, attacksOrDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'attacks_or_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thatCreatureDiesMatch = oracleText.match(/when (?:that|target|the) creature dies(?: this turn)?,?\s*([^.]+)/i);
  if (thatCreatureDiesMatch && !triggers.some((t) => t.triggerType === 'that_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, thatCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'that_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const auraPutIntoGraveyardMatch = oracleText.match(
    /when this aura is put into (?:a |your )?graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (auraPutIntoGraveyardMatch && !triggers.some((t) => t.triggerType === 'aura_ltb')) {
    const effectText = timingTriggerEffect(oracleText, auraPutIntoGraveyardMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'aura_ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const entersOrDiesPattern = new RegExp(
    `when(?:ever)?\\s+(?:${dieSelfAlternatives.join('|')})\\s+enters(?: the battlefield)?\\s+or\\s+dies,?\\s*([^.]+)`,
    'i',
  );
  const entersOrDiesMatch = oracleText.match(entersOrDiesPattern);
  if (entersOrDiesMatch && !triggers.some((t) => t.triggerType === 'enters_or_dies')) {
    const effectText = timingTriggerEffect(oracleText, entersOrDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enters_or_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const selfDiesPattern = new RegExp(
    `when(?:ever)?\\s+(?:${dieSelfAlternatives.join('|')})\\s+die(?:s)?,?\\s*([^.]+)`,
    'i',
  );
  const diesMatch = oracleText.match(selfDiesPattern);
  if (diesMatch && !triggers.some(t => t.triggerType === 'dies')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'dies',
      description: timingTriggerEffect(oracleText, diesMatch),
      effect: timingTriggerEffect(oracleText, diesMatch),
      mandatory: true,
    });
  }

  const namedOrAnotherDiesPattern = new RegExp(
    `whenever\\s+(?:${dieNameVariants.join('|')})\\s+or\\s+another\\s+(?:[\\w\\s]+?\\s+)?creature(?:s)?(?:\\s+you\\s+control)?\\s+dies,?\\s*([^.]+)`,
    'i',
  );
  const namedOrAnotherDiesMatch = oracleText.match(namedOrAnotherDiesPattern);
  if (namedOrAnotherDiesMatch && !triggers.some((t) => t.triggerType === 'named_or_another_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, namedOrAnotherDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_another_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const putIntoGraveyardPattern = new RegExp(
    `when(?:ever)?\\s+(?:${dieSelfAlternatives.join('|')})\\s+${ENTERS_OR_OTHER_EVENT_PREFIX}(?:is )?put into (?:a |your |its owner's )?graveyard(?: from the battlefield|(?=\\s*,)),?\\s*([^.]+)`,
    'i',
  );
  const putIntoGraveyardMatch = oracleText.match(putIntoGraveyardPattern);
  if (putIntoGraveyardMatch && !triggers.some((trigger) => trigger.triggerType === 'dies')) {
    const effectText = timingTriggerEffect(oracleText, putIntoGraveyardMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const pronounGraveyardThisTurnMatch = oracleText.match(/when(?:ever)? it'?s put into (?:a )?graveyard this turn,?\s*([^.]+)/i);
  if (pronounGraveyardThisTurnMatch && !triggers.some((trigger) => trigger.triggerType === 'put_into_graveyard_this_turn')) {
    const effectText = timingTriggerEffect(oracleText, pronounGraveyardThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'put_into_graveyard_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const attachmentDiesPatterns = [
    /whenever (?:an )?enchanted (?:creature|permanent|land) dies,?\s*([^.]+)/i,
    /whenever equipped creature dies,?\s*([^.]+)/i,
    /when (?:an )?enchanted (?:creature|permanent|land) dies,?\s*([^.]+)/i,
    /when equipped creature dies,?\s*([^.]+)/i,
  ];
  for (const pattern of attachmentDiesPatterns) {
    const match = oracleText.match(pattern);
    if (!match) continue;
    const effectText = timingTriggerEffect(oracleText, match);
    if (!effectText || triggers.some((trigger) => trigger.effect === effectText && trigger.triggerType === 'attachment_dies')) {
      continue;
    }
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'attachment_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const dealtDamageDiesPattern = new RegExp(
    `when(?:ever)? (?:a |an )?creature(?: with flying)? dealt damage by (?:equipped creature|enchanted creature|${dieSelfAlternatives.join('|')}) this turn dies,?\\s*([^.]+)`,
    'i',
  );
  const dealtDamageDiesMatch = oracleText.match(dealtDamageDiesPattern);
  if (dealtDamageDiesMatch && !triggers.some((trigger) => trigger.triggerType === 'dealt_damage_dies')) {
    const effectText = timingTriggerEffect(oracleText, dealtDamageDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'dealt_damage_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }
  
  const enchantedPlayerNontokenCreatureDiesMatch = oracleText.match(
    /whenever a nontoken creature enchanted player controls dies,?\s*([^.]+)/i,
  );
  if (
    enchantedPlayerNontokenCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'enchanted_player_nontoken_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, enchantedPlayerNontokenCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enchanted_player_nontoken_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const genericCounterCreatureDiesMatch = oracleText.match(
    /whenever a creature you control with a counter on it dies,?\s*([^.]+)/i,
  );
  if (
    genericCounterCreatureDiesMatch &&
    !String(genericCounterCreatureDiesMatch[0] || '').toLowerCase().includes('+1/+1 counter') &&
    !triggers.some((t) => t.triggerType === 'counter_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, genericCounterCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'counter_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const counterCreatureDiesMatch = oracleText.match(
    /whenever a creature you control with a \+1\/\+1 counter on it dies,?\s*([^.]+)/i,
  );
  if (counterCreatureDiesMatch && !triggers.some((t) => t.triggerType === 'counter_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, counterCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'counter_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  // "Whenever/When a creature you control dies" - also handles "nontoken creature"
  const thisOrAnotherCreatureDiesAnyMatch = oracleText.match(
    /whenever this creature or another creature dies,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherCreatureDiesAnyMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_creature_dies_any')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherCreatureDiesAnyMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_creature_dies_any',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrAnotherCreatureDiesMatch = oracleText.match(
    /whenever this creature or another creature you control dies,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrAnotherTypedCreatureDiesMatch = oracleText.match(
    /whenever this creature or another ([\w]+(?: or [\w]+)*)(?: creature)? you control dies,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherTypedCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_typed_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherTypedCreatureDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_typed_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrAnotherPowerCreatureDiesMatch = oracleText.match(
    /whenever this creature or another creature you control with power (\d+) or greater dies,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherPowerCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_power_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherPowerCreatureDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_power_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrAnotherNontokenCreatureDiesMatch = oracleText.match(
    /whenever this creature or another nontoken creature you control dies,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherNontokenCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_nontoken_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherNontokenCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_nontoken_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedOrModifiedCreatureDiesMatch = oracleText.match(
    /whenever enchanted creature or another modified creature you control dies,?\s*([^.]+)/i,
  );
  if (
    enchantedOrModifiedCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'enchanted_or_modified_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, enchantedOrModifiedCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enchanted_or_modified_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedOrAnotherKeywordCreatureDiesPattern = new RegExp(
    `whenever\\s+(?:${dieNameVariants.join('|')}|this creature)\\s+or\\s+another\\s+creature\\s+you\\s+control\\s+with\\s+([\\w]+\\s+or\\s+[\\w]+|[\\w]+)\\s+dies,?\\s*([^.]+)`,
    'i',
  );
  const namedOrAnotherKeywordCreatureDiesMatch = oracleText.match(namedOrAnotherKeywordCreatureDiesPattern);
  if (
    namedOrAnotherKeywordCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_another_keyword_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrAnotherKeywordCreatureDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_another_keyword_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreOtherCreaturesOrArtifactsDieMatch = oracleText.match(
    /whenever one or more other creatures and\/or artifacts you control die,?\s*([^.]+)/i,
  );
  if (
    oneOrMoreOtherCreaturesOrArtifactsDieMatch &&
    !triggers.some((t) => t.triggerType === 'one_or_more_other_creatures_or_artifacts_die')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreOtherCreaturesOrArtifactsDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'one_or_more_other_creatures_or_artifacts_die',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrAnotherArtifactCreatureDiesMatch = oracleText.match(
    /whenever this creature or another artifact creature dies,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherArtifactCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_artifact_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherArtifactCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_artifact_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedEntersOrPlaneswalkerDiesMatch = oracleText.match(
    new RegExp(
      `whenever (?:${dieSelfAlternatives.join('|')}) enters or a planeswalker you control dies,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedEntersOrPlaneswalkerDiesMatch &&
    !triggers.some((t) => t.triggerType === 'named_enters_or_planeswalker_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedEntersOrPlaneswalkerDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_enters_or_planeswalker_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const planeswalkerYouControlDiesMatch = oracleText.match(
    /whenever a planeswalker you control dies,?\s*([^.]+)/i,
  );
  if (
    planeswalkerYouControlDiesMatch &&
    !triggers.some((t) => t.triggerType === 'planeswalker_you_control_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, planeswalkerYouControlDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'planeswalker_you_control_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedOrNontokenTypedCreatureDiesMatch = oracleText.match(
    new RegExp(
      `whenever (?:${dieSelfAlternatives.join('|')}) or another nontoken ([\\w]+(?: or [\\w]+)*) you control dies,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedOrNontokenTypedCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_nontoken_typed_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrNontokenTypedCreatureDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_nontoken_typed_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const bountyCounterCreatureDiesMatch = oracleText.match(
    /whenever a creature with a bounty counter on it dies,?\s*([^.]+)/i,
  );
  if (
    bountyCounterCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'bounty_counter_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, bountyCounterCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'bounty_counter_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureOrPlaneswalkerDiesMatch = oracleText.match(
    /whenever a creature or planeswalker you control dies,?\s*([^.]+)/i,
  );
  if (
    creatureOrPlaneswalkerDiesMatch &&
    !triggers.some((t) => t.triggerType === 'creature_or_planeswalker_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, creatureOrPlaneswalkerDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_or_planeswalker_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherCreatureOrPlaneswalkerDiesMatch = oracleText.match(
    /whenever another creature or planeswalker you control dies,?\s*([^.]+)/i,
  );
  if (
    anotherCreatureOrPlaneswalkerDiesMatch &&
    !triggers.some((t) => t.triggerType === 'another_creature_or_planeswalker_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherCreatureOrPlaneswalkerDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_creature_or_planeswalker_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrAnotherCreatureOrArtifactDiesMatch = oracleText.match(
    /whenever this creature or another creature or artifact you control dies,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherCreatureOrArtifactDiesMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_creature_or_artifact_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherCreatureOrArtifactDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_creature_or_artifact_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nonTypeCreatureYouControlDiesMatch = oracleText.match(
    /when(?:ever)? (?:another )?(?:a )?non-([\w]+) creature you control dies,?\s*([^.]+)/i,
  );
  if (
    nonTypeCreatureYouControlDiesMatch &&
    !triggers.some((t) => t.triggerType === 'non_type_creature_you_control_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, nonTypeCreatureYouControlDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'non_type_creature_you_control_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherCreatureWithDeathtouchDiesMatch = oracleText.match(
    /whenever another creature you control with deathtouch dies,?\s*([^.]+)/i,
  );
  if (
    anotherCreatureWithDeathtouchDiesMatch &&
    !triggers.some((t) => t.triggerType === 'another_creature_with_deathtouch_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherCreatureWithDeathtouchDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_creature_with_deathtouch_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherNontokenMultiTypedDiesMatch = oracleText.match(
    /whenever another nontoken ([\w]+ or [\w]+) you control dies,?\s*([^.]+)/i,
  );
  if (
    anotherNontokenMultiTypedDiesMatch &&
    !triggers.some((t) => t.triggerType === 'another_nontoken_multi_typed_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherNontokenMultiTypedDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_nontoken_multi_typed_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creaturePowerOrToughnessOrLessDiesMatch = oracleText.match(
    /whenever a creature you control with power or toughness (\d+) or less dies,?\s*([^.]+)/i,
  );
  if (
    creaturePowerOrToughnessOrLessDiesMatch &&
    !triggers.some((t) => t.triggerType === 'creature_power_or_toughness_or_less_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, creaturePowerOrToughnessOrLessDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_power_or_toughness_or_less_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentGreatestPowerCreatureDiesMatch = oracleText.match(
    /whenever a creature an opponent controls with the greatest power among creatures that player controls dies,?\s*([^.]+)/i,
  );
  if (
    opponentGreatestPowerCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'opponent_greatest_power_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentGreatestPowerCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_greatest_power_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const chosenTypeCreatureDiesMatch = oracleText.match(
    /whenever a creature of the chosen type dies,?\s*([^.]+)/i,
  );
  if (chosenTypeCreatureDiesMatch && !triggers.some((t) => t.triggerType === 'chosen_type_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, chosenTypeCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'chosen_type_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const notedTypeOpponentCreatureDiesMatch = oracleText.match(
    /whenever a creature an opponent controls of the noted type dies,?\s*([^.]+)/i,
  );
  if (
    notedTypeOpponentCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'noted_type_opponent_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, notedTypeOpponentCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'noted_type_opponent_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreAttackingCreaturesDieMatch = oracleText.match(
    /whenever one or more attacking creatures you control die,?\s*([^.]+)/i,
  );
  if (
    oneOrMoreAttackingCreaturesDieMatch &&
    !triggers.some((t) => t.triggerType === 'one_or_more_attacking_creatures_die')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreAttackingCreaturesDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'one_or_more_attacking_creatures_die',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherLegendaryPermanentGyFromBfMatch = oracleText.match(
    new RegExp(
      `whenever a legendary permanent other than (?:${dieNameVariants.join('|')}) is put into a graveyard from the battlefield,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    anotherLegendaryPermanentGyFromBfMatch &&
    !triggers.some((t) => t.triggerType === 'another_legendary_permanent_graveyard_from_battlefield')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherLegendaryPermanentGyFromBfMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_legendary_permanent_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedCreatureGyFromBfMatch = oracleText.match(
    /whenever a ([\w]+) you control is put into a graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (
    typedCreatureGyFromBfMatch &&
    !lowerOracle.includes('nontoken') &&
    !triggers.some((t) => t.triggerType === 'typed_creature_graveyard_from_battlefield')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedCreatureGyFromBfMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_creature_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherCreatureWithFlyingDiesMatch = oracleText.match(
    /whenever another creature you control with flying dies,?\s*([^.]+)/i,
  );
  if (
    anotherCreatureWithFlyingDiesMatch &&
    !triggers.some((t) => t.triggerType === 'another_creature_with_flying_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherCreatureWithFlyingDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_creature_with_flying_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentCreatureWithCounterDiesMatch = oracleText.match(
    /whenever a creature an opponent controls with a counter on it dies,?\s*([^.]+)/i,
  );
  if (
    opponentCreatureWithCounterDiesMatch &&
    !triggers.some((t) => t.triggerType === 'opponent_creature_with_counter_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentCreatureWithCounterDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_creature_with_counter_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nonblackCardPlayerGyMatch = oracleText.match(
    /whenever a nonblack card is put into a player's graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (nonblackCardPlayerGyMatch && !triggers.some((t) => t.triggerType === 'nonblack_card_player_graveyard_from_anywhere')) {
    const effectText = timingTriggerEffect(oracleText, nonblackCardPlayerGyMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'nonblack_card_player_graveyard_from_anywhere',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrAnotherNontokenTypedDiesMatch = oracleText.match(
    /whenever this creature or another nontoken ([\w]+) you control dies,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherNontokenTypedDiesMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_nontoken_typed_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherNontokenTypedDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_nontoken_typed_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrAnotherNontokenArtifactGyMatch = oracleText.match(
    /whenever this artifact or another nontoken artifact you control is put into a graveyard from the battlefield(?: or is put into exile from the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherNontokenArtifactGyMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_nontoken_artifact_graveyard')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherNontokenArtifactGyMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_nontoken_artifact_graveyard',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nontokenArtifactGyOrExileMatch = oracleText.match(
    /whenever this creature or another nontoken artifact you control is put into a graveyard from the battlefield or is put into exile from the battlefield,?\s*([^.]+)/i,
  );
  if (
    nontokenArtifactGyOrExileMatch &&
    !triggers.some((t) => t.triggerType === 'nontoken_artifact_graveyard_or_exile_from_battlefield')
  ) {
    const effectText = timingTriggerEffect(oracleText, nontokenArtifactGyOrExileMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'nontoken_artifact_graveyard_or_exile_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureWithShadowDiesMatch = oracleText.match(/whenever a creature with shadow dies,?\s*([^.]+)/i);
  if (creatureWithShadowDiesMatch && !triggers.some((t) => t.triggerType === 'creature_with_shadow_dies')) {
    const effectText = timingTriggerEffect(oracleText, creatureWithShadowDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_with_shadow_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const auraYouControlGyMatch = oracleText.match(
    /whenever an aura you control is put into your graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (auraYouControlGyMatch && !triggers.some((t) => t.triggerType === 'aura_you_control_graveyard_from_battlefield')) {
    const effectText = timingTriggerEffect(oracleText, auraYouControlGyMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'aura_you_control_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const attackingMultiTypedGyMatch = oracleText.match(
    /whenever an attacking ([\w]+) or ([\w]+) is put into your graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (attackingMultiTypedGyMatch && !triggers.some((t) => t.triggerType === 'attacking_multi_typed_graveyard_from_battlefield')) {
    const effectText = timingTriggerEffect(oracleText, attackingMultiTypedGyMatch, 3);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'attacking_multi_typed_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }
}
