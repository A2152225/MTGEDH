/**
 * triggers/card-draw.ts
 * 
 * Card draw trigger detection and processing.
 * Includes triggers that fire when cards are drawn.
 */

import type { GameContext } from "../../context.js";
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
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: "opponent_draws",
      effect: opponentDrawsMatch[1].trim(),
      mandatory: true,
    });
  }
  
  // Pattern: "Whenever a player draws a card" (except first each turn sometimes)
  const playerDrawsMatch = oracleText.match(/whenever a player draws (?:a card|cards?),?\s*([^.]+)/i);
  if (playerDrawsMatch) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: "player_draws",
      effect: playerDrawsMatch[1].trim(),
      mandatory: true,
    });
  }
  
  // Pattern: "Whenever you draw a card"
  const youDrawMatch = oracleText.match(/whenever you draw (?:a card|cards?),?\s*([^.]+)/i);
  if (youDrawMatch) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: "you_draw",
      effect: youDrawMatch[1].trim(),
      mandatory: true,
    });
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

      const needsThatPlayerRef = /\bthat player\b/i.test(interveningText);

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
