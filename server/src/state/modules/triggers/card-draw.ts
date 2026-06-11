/**
 * triggers/card-draw.ts
 * 
 * Card draw trigger detection and processing.
 * Includes triggers that fire when cards are drawn.
 */

import type { GameContext } from "../../context.js";
import { timingTriggerEffect } from './timing-effect-extraction.js';
import { isInterveningIfSatisfied } from "./intervening-if.js";

export interface CardDrawTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: "opponent_draws" | "player_draws" | "you_draw";
  effect: string;
  mandatory: boolean;
}

/**
 * Detect card draw triggers from a permanents oracle text
 * Handles patterns like:
 * - "Whenever an opponent draws a card, they lose 1 life" (Nekusar)
 * - "Whenever a player draws a card, that player discards a card" (Notion Thief reverse)
 * - "Whenever you draw a card, you gain 1 life" (various)
 */
export function detectCardDrawTriggers(card: any, permanent: any): CardDrawTrigger[] {
  const triggers: CardDrawTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // Pattern: "Whenever an opponent draws a card"
  const opponentDrawsMatch = oracleText.match(/whenever an opponent draws (?:a card|cards?),?\s*([^.]+)/i);
  if (opponentDrawsMatch) {
    const effect = timingTriggerEffect(oracleText, opponentDrawsMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: "opponent_draws",
      effect,
      mandatory: !/^you may\b/i.test(effect),
    });
  }
  
  // Pattern: "Whenever a player draws a card" (except first each turn sometimes)
  const playerDrawsMatch = oracleText.match(/whenever a player draws (?:a card|cards?),?\s*([^.]+)/i);
  if (playerDrawsMatch) {
    const effect = timingTriggerEffect(oracleText, playerDrawsMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: "player_draws",
      effect,
      mandatory: !/^you may\b/i.test(effect),
    });
  }
  
  const enchantedOpponentDrawsMatch = oracleText.match(/whenever enchanted opponent draws (?:a card|cards?),?\s*([^.]+)/i);
  if (enchantedOpponentDrawsMatch && !triggers.some((t) => (t as any).triggerType === 'enchanted_opponent_draws')) {
    const effect = timingTriggerEffect(oracleText, enchantedOpponentDrawsMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'enchanted_opponent_draws' as any,
      effect,
      mandatory: !/^you may\b/i.test(effect),
    });
  }

  const enchantedPlayerDrawsMatch = oracleText.match(/whenever enchanted player draws (?:a card|cards?),?\s*([^.]+)/i);
  if (enchantedPlayerDrawsMatch && !triggers.some((t) => (t as any).triggerType === 'enchanted_player_draws')) {
    const effect = timingTriggerEffect(oracleText, enchantedPlayerDrawsMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'enchanted_player_draws' as any,
      effect,
      mandatory: !/^you may\b/i.test(effect),
    });
  }

  const chosenPlayerDrawsChosenNameMatch = oracleText.match(
    /when the chosen player draws a card with the chosen name,?\s*([^.]+)/i,
  );
  if (chosenPlayerDrawsChosenNameMatch && !triggers.some((t) => (t as any).triggerType === 'chosen_player_draws_chosen_name')) {
    const effect = timingTriggerEffect(oracleText, chosenPlayerDrawsChosenNameMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'chosen_player_draws_chosen_name' as any,
      effect,
      mandatory: !/^you may\b/i.test(effect),
    });
  }

  const opponentFirstCardEachTurnMatch = oracleText.match(
    /whenever an opponent draws their first card each turn,?\s*([^.]+)/i,
  );
  if (opponentFirstCardEachTurnMatch && !triggers.some((t) => (t as any).triggerType === 'opponent_draws_first_card_each_turn')) {
    const effect = timingTriggerEffect(oracleText, opponentFirstCardEachTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'opponent_draws_first_card_each_turn' as any,
      effect,
      mandatory: !/^you may\b/i.test(effect),
    });
  }

  const secondCardDrawPatterns = [
    /whenever a player draws their second card each turn,?\s*([^.]+)/gi,
    /whenever a player draws their second card during their turn,?\s*([^.]+)/gi,
    /whenever (?:an opponent|you) draws (?:your |their )?second card each turn,?\s*([^.]+)/gi,
    /when(?:ever)? you draw your second card each turn,?\s*([^.]+)/gi,
    /when(?:ever)? you draw your third card in a turn,?\s*([^.]+)/gi,
  ];
  for (const pattern of secondCardDrawPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effect = timingTriggerEffect(oracleText, match);
      if (!effect || triggers.some((trigger) => trigger.effect === effect)) continue;
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'player_draws',
        effect,
        mandatory: !/^you may\b/i.test(effect),
      });
    }
  }

  // Pattern: "Whenever you draw a card"
  const youDrawMatch = oracleText.match(/whenever you draw (?:a card|cards?),?\s*([^.]+)/i);
  if (youDrawMatch) {
    const effect = timingTriggerEffect(oracleText, youDrawMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: "you_draw",
      effect,
      mandatory: !/^you may\b/i.test(effect),
    });
  }

  const revealCreatureThisWayMatch = oracleText.match(/when you reveal a creature card this way,?\s*([^.]+)/i);
  if (revealCreatureThisWayMatch && !triggers.some((t) => t.triggerType === 'reveal_creature_this_way')) {
    const effect = timingTriggerEffect(oracleText, revealCreatureThisWayMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'reveal_creature_this_way',
      effect,
      mandatory: !/^you may\b/i.test(effect),
    });
  }

  const revealThisWayPatterns = [
    /whenever you reveal a (land|nonland) card this way,?\s*([^.]+)/gi,
    /when you reveal a (land|nonland) card this way,?\s*([^.]+)/gi,
  ];
  for (const revealThisWayPattern of revealThisWayPatterns) {
    let revealMatch: RegExpExecArray | null;
    while ((revealMatch = revealThisWayPattern.exec(oracleText)) !== null) {
      const effect = timingTriggerEffect(oracleText, revealMatch, 2);
      if (!effect || triggers.some((trigger) => trigger.effect === effect)) continue;
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'reveal_this_way',
        effect,
        mandatory: !/^you may\b/i.test(effect),
      });
    }
  }
  
  return triggers;
}

/**
 * Get all card draw triggers that should fire when a player draws a card
 */
export function getCardDrawTriggers(
  ctx: GameContext,
  drawingPlayerId: string,
  controllerId?: string
): CardDrawTrigger[] {
  const triggers: CardDrawTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const permController = permanent.controller;
    const permTriggers = detectCardDrawTriggers(permanent.card, permanent);
    
    for (const trigger of permTriggers) {
      // Intervening-if (Rule 603.4): if the condition is false at the time the trigger
      // would trigger, the ability does not trigger and should not be put on the stack.
      // If the condition is unrecognized, keep the trigger (conservative fallback).
      const raw = String(trigger.effect || '').trim();
      let interveningText = raw;
      if (interveningText && !/^(?:when|whenever|at)\b/i.test(interveningText)) {
        switch (trigger.triggerType) {
          case 'opponent_draws':
            interveningText = `Whenever an opponent draws a card, ${interveningText}`;
            break;
          case 'player_draws':
            interveningText = `Whenever a player draws a card, ${interveningText}`;
            break;
          case 'you_draw':
            interveningText = `Whenever you draw a card, ${interveningText}`;
            break;
        }
      }

      const needsThatPlayerRef = /\bthat player\b/i.test(interveningText) || /\btheir\b/i.test(interveningText);

      const ok = isInterveningIfSatisfied(
        ctx,
        trigger.controllerId || permController,
        interveningText,
        permanent,
        needsThatPlayerRef
          ? {
              thatPlayerId: drawingPlayerId,
              referencedPlayerId: drawingPlayerId,
              theirPlayerId: drawingPlayerId,
            }
          : undefined
      );
      if (ok === false) continue;

      // Check if this trigger applies
      switch (trigger.triggerType) {
        case "opponent_draws":
          // Triggers when an opponent of the permanents controller draws
          if (drawingPlayerId !== permController) {
            triggers.push({ ...trigger, controllerId: permController });
          }
          break;
        case "player_draws":
          // Triggers for any player drawing
          triggers.push({ ...trigger, controllerId: permController });
          break;
        case "you_draw":
          // Triggers when the permanents controller draws
          if (drawingPlayerId === permController) {
            triggers.push({ ...trigger, controllerId: permController });
          }
          break;
      }
    }
  }
  
  return triggers;
}
