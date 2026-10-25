/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectLTBTriggers
 * Public: detectLTBTriggers
 */

import { stripReminderParentheticals } from "../../../../../rules-engine/src/oracleReminderText.js";
import { buildCardNameRegexAlternatives } from "./cardNameRegexAlternatives.js";
import { mergeDetectorOracleWithContinuousGrants } from "./detectorGrantedOracle.js";
import type { TriggeredAbility } from "./detectorTriggeredAbility.js";
import { LTB_STATIC_ALTERNATIVES } from "./etb-detection-helpers.js";
import { timingTriggerEffect } from "./timing-effect-extraction.js";
import { permanentHasTriggeredAbilities } from './triggeredAbilitySuppression.js';

/**
 * Detect leaves-the-battlefield triggers from a card's oracle text.
 */
export function detectLTBTriggers(card: any, permanent?: any, gameState?: any): TriggeredAbility[] {
  if (!permanentHasTriggeredAbilities(permanent, gameState, { event: 'ltb' })) return []; // Humility / Torpor Orb gate
  const triggers: TriggeredAbility[] = [];
  // Detector regexes scan raw oracle text. Remove only recognized keyword
  // reminders first so a reminder's "when/whenever" cannot become a trigger.
  const merged = mergeDetectorOracleWithContinuousGrants(
    String(card?.oracle_text || ''),
    permanent,
    gameState,
  );
  const oracleText = stripReminderParentheticals(merged.oracleText);
  const lowerOracle = oracleText.toLowerCase();
  const cardName = String(card?.name || 'Unknown');
  const permanentId = permanent?.id || '';
  const ltbAlternatives = [...LTB_STATIC_ALTERNATIVES, ...buildCardNameRegexAlternatives(cardName)];

  const selfLeavesPattern = new RegExp(
    `when(?:ever)?\\s+(?:${ltbAlternatives.join('|')})\\s+leaves(?: the battlefield)?,?\\s*([^.]+)`,
    'i',
  );
  const selfLeavesMatch = oracleText.match(selfLeavesPattern);
  if (selfLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'ltb')) {
    const effectText = timingTriggerEffect(oracleText, selfLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      requiresChoice: effectText.toLowerCase().includes('you may'),
    });
  }

  const ltbAlternativesForEntersOrLeaves = [...LTB_STATIC_ALTERNATIVES, ...buildCardNameRegexAlternatives(cardName)];
  const selfEntersOrLeavesLtbPattern = new RegExp(
    `when(?:ever)?\\s+(?:${ltbAlternativesForEntersOrLeaves.join('|')})\\s+enters or leaves(?: the battlefield)?,?\\s*([^.]+)`,
    'i',
  );
  const selfEntersOrLeavesLtbMatch = oracleText.match(selfEntersOrLeavesLtbPattern);
  if (selfEntersOrLeavesLtbMatch && !triggers.some((trigger) => trigger.triggerType === 'self_enters_or_leaves')) {
    const effectText = timingTriggerEffect(oracleText, selfEntersOrLeavesLtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'self_enters_or_leaves',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const entersOrLeavesMatch = oracleText.match(
    /whenever (?:a |an )?permanent enters or leaves(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (entersOrLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'enters_or_leaves')) {
    const effectText = timingTriggerEffect(oracleText, entersOrLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enters_or_leaves',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anyPermanentLeavesMatch = oracleText.match(
    /whenever a permanent leaves(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    anyPermanentLeavesMatch &&
    !lowerOracle.includes('permanent you control leaves') &&
    !lowerOracle.includes('another permanent leaves') &&
    !triggers.some((trigger) => trigger.triggerType === 'any_permanent_ltb')
  ) {
    const effectText = timingTriggerEffect(oracleText, anyPermanentLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'any_permanent_ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const phasesOutOrLeavesMatch = oracleText.match(
    /when this creature phases out or leaves the battlefield,?\s*([^.]+)/i,
  );
  if (phasesOutOrLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'phases_out_or_leaves')) {
    const effectText = timingTriggerEffect(oracleText, phasesOutOrLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'phases_out_or_leaves',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherCreatureYouControlLeavesMatch = oracleText.match(
    /when another creature you control leaves the battlefield,?\s*([^.]+)/i,
  );
  if (
    anotherCreatureYouControlLeavesMatch &&
    !triggers.some((trigger) => trigger.triggerType === 'another_creature_you_control_leaves')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherCreatureYouControlLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_creature_you_control_leaves',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const targetedCreatureLeavesThisTurnMatch = oracleText.match(
    /when the targeted creature leaves the battlefield this turn,?\s*([^.]+)/i,
  );
  if (
    targetedCreatureLeavesThisTurnMatch &&
    !triggers.some((trigger) => trigger.triggerType === 'targeted_creature_leaves_this_turn')
  ) {
    const effectText = timingTriggerEffect(oracleText, targetedCreatureLeavesThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'targeted_creature_leaves_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const headLeavesMatch = oracleText.match(/when a Head leaves the battlefield,?\s*([^.]+)/i);
  if (headLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'head_leaves_battlefield')) {
    const effectText = timingTriggerEffect(oracleText, headLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'head_leaves_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedUntappedOrLeavesMatch = oracleText.match(
    new RegExp(
      `when (?:${ltbAlternatives.join('|')}) becomes untapped or leaves the battlefield,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (namedUntappedOrLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'named_untapped_or_leaves')) {
    const effectText = timingTriggerEffect(oracleText, namedUntappedOrLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_untapped_or_leaves',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const commanderLeavesMatch = oracleText.match(/when your commander leaves the battlefield,?\s*([^.]+)/i);
  if (commanderLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'commander_leaves')) {
    const effectText = timingTriggerEffect(oracleText, commanderLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'commander_leaves',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const tokenLeavesMatch = oracleText.match(/whenever a token you control leaves the battlefield,?\s*([^.]+)/i);
  if (tokenLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'token_ltb')) {
    const effectText = timingTriggerEffect(oracleText, tokenLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'token_ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureTokenLeavesMatch = oracleText.match(
    /whenever a creature token(?: you control)? leaves the battlefield,?\s*([^.]+)/i,
  );
  if (creatureTokenLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'creature_token_ltb')) {
    const effectText = timingTriggerEffect(oracleText, creatureTokenLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_token_ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedOrAnotherCreatureLeavesPattern = new RegExp(
    `whenever\\s+(?:${ltbAlternatives.join('|')})\\s+or\\s+another\\s+(?:nontoken\\s+)?creature\\s+you\\s+control\\s+leaves(?: the battlefield)?,?\\s*([^.]+)`,
    'i',
  );
  const thatTokenLeavesMatch = oracleText.match(
    /when that token leaves the battlefield,?\s*([^.]+)/i,
  );
  if (
    thatTokenLeavesMatch &&
    !triggers.some((trigger) => trigger.triggerType === 'that_token_leaves')
  ) {
    const effectText = timingTriggerEffect(oracleText, thatTokenLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'that_token_leaves',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const mysteryPutOntoBattlefieldLeavesMatch = oracleText.match(
    new RegExp(
      `when the creature put onto the battlefield with (?:${ltbAlternatives.join('|')}) leaves the battlefield,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    mysteryPutOntoBattlefieldLeavesMatch &&
    !triggers.some((trigger) => trigger.triggerType === 'mystery_put_creature_leaves')
  ) {
    const effectText = timingTriggerEffect(oracleText, mysteryPutOntoBattlefieldLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'mystery_put_creature_leaves',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedOrAnotherCreatureLeavesMatch = oracleText.match(namedOrAnotherCreatureLeavesPattern);
  if (namedOrAnotherCreatureLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'named_or_another_creature_ltb')) {
    const effectText = timingTriggerEffect(oracleText, namedOrAnotherCreatureLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_another_creature_ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const modifiedCreatureLeavesMatch = oracleText.match(
    /whenever a modified creature you control leaves the battlefield,?\s*([^.]+)/i,
  );
  if (modifiedCreatureLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'modified_creature_ltb')) {
    const effectText = timingTriggerEffect(oracleText, modifiedCreatureLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'modified_creature_ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const controlledLeavesMatch = oracleText.match(
    /whenever (?:a|another) (?:nontoken )?permanent you control leaves(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (controlledLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'controlled_ltb')) {
    const effectText = timingTriggerEffect(oracleText, controlledLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'controlled_ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const counterCreatureLeavesMatch = oracleText.match(
    /whenever a creature you control with a \+1\/\+1 counter on it leaves the battlefield,?\s*([^.]+)/i,
  );
  if (counterCreatureLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'counter_creature_ltb')) {
    const effectText = timingTriggerEffect(oracleText, counterCreatureLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'counter_creature_ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const gainControlMatch = oracleText.match(/whenever you gain control of (?:a |an )?([^,]+),?\s*([^.]+)/i);
  if (gainControlMatch && !triggers.some((trigger) => trigger.triggerType === 'gain_control')) {
    const effectText = timingTriggerEffect(oracleText, gainControlMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'gain_control',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const loseControlGenericMatch = oracleText.match(/whenever you lose control of (?:a |an )?([^,]+),?\s*([^.]+)/i);
  if (loseControlGenericMatch && !triggers.some((trigger) => trigger.triggerType === 'lose_control_generic')) {
    const effectText = timingTriggerEffect(oracleText, loseControlGenericMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'lose_control_generic',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const loseControlThatMatch = oracleText.match(/when(?:ever)? you lose control of that ([^,]+),?\s*([^.]+)/i);
  if (loseControlThatMatch && !triggers.some((trigger) => trigger.triggerType === 'lose_control_that')) {
    const effectText = timingTriggerEffect(oracleText, loseControlThatMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'lose_control_that',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const loseControlMatch = oracleText.match(/when you lose control of this (artifact|enchantment|permanent),?\s*([^.]+)/i);
  if (loseControlMatch && !triggers.some((trigger) => trigger.triggerType === 'lose_control')) {
    const effectText = timingTriggerEffect(oracleText, loseControlMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'lose_control',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherPermanentLeavesMatch = oracleText.match(
    /whenever another (?:[\w]+\s+)?permanent leaves(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    anotherPermanentLeavesMatch &&
    !lowerOracle.includes('permanent you control leaves') &&
    !triggers.some((trigger) => trigger.triggerType === 'another_permanent_ltb')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherPermanentLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_permanent_ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureLeavesMatch = oracleText.match(
    /whenever (?:a|another) (?:nontoken )?creature (?:you control )?leaves(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    creatureLeavesMatch &&
    !lowerOracle.includes('permanent you control leaves') &&
    !triggers.some((trigger) => trigger.triggerType === 'creature_ltb')
  ) {
    const effectText = timingTriggerEffect(oracleText, creatureLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const chosenCreatureLeavesMatch = oracleText.match(
    /when(?:ever)? (?:the chosen|that) creature leaves(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (chosenCreatureLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'chosen_creature_ltb')) {
    const effectText = timingTriggerEffect(oracleText, chosenCreatureLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'chosen_creature_ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const attachmentLeavesPatterns = [
    /when(?:ever)? enchanted creature leaves(?: the battlefield)?,?\s*([^.]+)/i,
    /when(?:ever)? equipped creature leaves(?: the battlefield)?,?\s*([^.]+)/i,
    /when(?:ever)? enchanted permanent leaves(?: the battlefield)?,?\s*([^.]+)/i,
  ];
  for (const pattern of attachmentLeavesPatterns) {
    const match = oracleText.match(pattern);
    if (!match) continue;
    const effectText = timingTriggerEffect(oracleText, match);
    if (!effectText || triggers.some((trigger) => trigger.triggerType === 'attachment_ltb' && trigger.effect === effectText)) {
      continue;
    }
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'attachment_ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  return triggers;
}
