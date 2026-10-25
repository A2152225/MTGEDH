/**
 * turn-phases-handlers/turnPhaseEndStepTriggers.ts
 * Origin parent: server/src/state/modules/triggers/turn-phases.ts
 * Cluster moved: detectEndStepTriggers.
 * Public entry symbols: detectEndStepTriggers.
 */

import { timingTriggerEffect } from "../timing-effect-extraction.js";
import { KNOWN_END_STEP_TRIGGERS } from "../card-data-tables.js";
import type { EndStepTrigger } from "./turnPhaseTriggerTypes.js";
import { getActivePermanentCardFace } from "./turnPhaseActivePermanentFace.js";
import { detectRequiresChoice, detectAffectsAllPlayers } from "./turnPhaseEffectChoiceHelpers.js";
import { permanentHasTriggeredAbilities } from '../triggeredAbilitySuppression.js';

/**
 * Detect end step triggers from a card's oracle text
 * Uses dynamic regex-based detection to work with any card
 */
export function detectEndStepTriggers(card: any, permanent: any, gameState?: any): EndStepTrigger[] {
  if (!permanentHasTriggeredAbilities(permanent, gameState, { event: 'step' })) return []; // Humility / Torpor Orb gate
  const triggers: EndStepTrigger[] = [];
  const { cardName, oracleText } = getActivePermanentCardFace(card, permanent);
  const lowerName = cardName.toLowerCase();
  const lowerOracle = oracleText.toLowerCase();
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";

  for (const [knownName, info] of Object.entries(KNOWN_END_STEP_TRIGGERS)) {
    if (!lowerName.includes(knownName)) continue;

    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'end_step_effect',
      description: info.effect,
      effect: info.effect,
      mandatory: info.mandatory,
      requiresChoice: info.requiresChoice,
      modalOptions: Array.isArray(info.modalOptions) ? [...info.modalOptions] : undefined,
      affectsAllPlayers: info.affectsAllPlayers,
      triggersOnOpponentEndStep: info.triggersOnOpponentEndStep,
    });
    return triggers;
  }
  
  const enchantedOpponentEndStepMatch = oracleText.match(
    /at the beginning of enchanted opponent's end step,?\s*([^.]+)/i,
  );
  if (enchantedOpponentEndStepMatch) {
    const effect = timingTriggerEffect(oracleText, enchantedOpponentEndStepMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'end_step_effect',
      description: effect,
      effect: effect,
      mandatory: !effect.toLowerCase().includes('you may'),
      requiresChoice: detectRequiresChoice(effect),
      affectsAllPlayers: false,
      whoseTurn: 'enchanted_player',
    });
  }

  const enchantedPlayerEndStepMatch = oracleText.match(
    /at the beginning of enchanted player's end step,?\s*([^.]+)/i,
  );
  if (enchantedPlayerEndStepMatch) {
    const effect = timingTriggerEffect(oracleText, enchantedPlayerEndStepMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'end_step_effect',
      description: effect,
      effect: effect,
      mandatory: !effect.toLowerCase().includes('you may'),
      requiresChoice: detectRequiresChoice(effect),
      affectsAllPlayers: false,
      whoseTurn: 'enchanted_player',
    });
  }

  const monarchEndStepMatch = oracleText.match(
    /at the beginning of the monarch's end step,?\s*([^.]+)/i,
  );
  if (monarchEndStepMatch) {
    const effect = timingTriggerEffect(oracleText, monarchEndStepMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'end_step_effect',
      description: effect,
      effect: effect,
      mandatory: !effect.toLowerCase().includes('you may'),
      requiresChoice: detectRequiresChoice(effect),
      affectsAllPlayers: false,
      whoseTurn: 'monarch',
    });
  }

  const yourOpponentsEndStepMatch = oracleText.match(
    /at the beginning of your opponents['']? end step,?\s*([^.]+)/i,
  );
  if (yourOpponentsEndStepMatch) {
    const effect = timingTriggerEffect(oracleText, yourOpponentsEndStepMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'end_step_effect',
      description: effect,
      effect: effect,
      mandatory: !effect.toLowerCase().includes('you may'),
      triggersOnOpponentEndStep: true,
      requiresChoice: detectRequiresChoice(effect),
      affectsAllPlayers: detectAffectsAllPlayers(effect),
    });
  }

  // Every "each opponent's end step" ability is its own trigger (Keeper of the Accord has two).
  const opponentEndStepPattern = /at the beginning of each opponent['’']?s end step,?\s*([^.]+)/gi;
  const opponentEndStepMatches = [...String(oracleText || '').matchAll(opponentEndStepPattern)];
  if (opponentEndStepMatches.length > 0) {
    for (const opponentEndStepMatch of opponentEndStepMatches) {
      const effect = timingTriggerEffect(oracleText, opponentEndStepMatch);
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'end_step_effect',
        description: effect,
        effect: effect,
        mandatory: !effect.toLowerCase().includes('you may'),
        triggersOnOpponentEndStep: true,
        requiresChoice: detectRequiresChoice(effect),
        affectsAllPlayers: detectAffectsAllPlayers(effect),
      });
    }
    return triggers;
  }
  
  // Pattern for regular end step triggers: "At the beginning of your/each end step"
  // Match until the end of the sentence (period followed by space or end of string)
  const thatTurnEndStepMatch = oracleText.match(
    /\[?at the beginning of that turn's end step,?\s*([^\].]+)/i,
  );
  if (thatTurnEndStepMatch) {
    const effect = timingTriggerEffect(oracleText, thatTurnEndStepMatch).replace(/\]$/, '');
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'end_step_effect',
      description: effect,
      effect: effect,
      mandatory: !effect.toLowerCase().includes('you may'),
      requiresChoice: detectRequiresChoice(effect),
      affectsAllPlayers: false,
    });
  }

  // Repeating card triggers only. "the next" / "your next" end step is a delayed
  // trigger created by another resolving ability (CR 603.7), not this detector.
  const endStepMatch = oracleText.match(
    /at the beginning of (?:each(?: player's)?|your|the) end step,?\s*([^.]+\.?)/i,
  );
  if (endStepMatch) {
    const effect = timingTriggerEffect(oracleText, endStepMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'end_step_effect',
      description: effect,
      effect: effect,
      mandatory: !effect.toLowerCase().includes('you may'),
      requiresChoice: detectRequiresChoice(effect),
      affectsAllPlayers: detectAffectsAllPlayers(effect),
    });
  }
  
  return triggers;
}
