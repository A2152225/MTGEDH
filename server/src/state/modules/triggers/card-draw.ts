/**
 * triggers/card-draw.ts
 * 
 * Card draw trigger detection and processing.
 * Includes triggers that fire when cards are drawn.
 */

import type { GameContext } from "../../context.js";
import { timingTriggerEffect } from './timing-effect-extraction.js';
import { isInterveningIfSatisfied } from "./intervening-if.js";
import { collectMatchingParsedEventLines, parsedEffectDuplicates, sameTriggerSource } from "./triggerConditionFamilyMatch.js";
import { dropTriggersFromAbilitylessSources, permanentHasTriggeredAbilities } from './triggeredAbilitySuppression.js';

export interface CardDrawTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType:
    | "opponent_draws"
    | "player_draws"
    | "you_draw"
    | "reveal_creature_this_way"
    | "reveal_this_way";
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
export function detectCardDrawTriggers(card: any, permanent: any, gameState?: any): CardDrawTrigger[] {
  if (!permanentHasTriggeredAbilities(permanent, gameState, { event: 'draw' })) return []; // Humility / Torpor Orb gate
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

  // "first/second card each turn" is emitted from the trigger IR (ordinal draws_card) in
  // getCardDrawTriggers; only the wordings the IR does not parse stay here, gated by draw number.
  const secondCardDrawPatterns: Array<[RegExp, number, boolean]> = [
    [/whenever a player draws their second card during their turn,?\s*([^.]+)/gi, 2, true],
    [/when(?:ever)? you draw your third card in a turn,?\s*([^.]+)/gi, 3, false],
  ];
  for (const [pattern, drawOrdinal, duringOwnTurn] of secondCardDrawPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effect = timingTriggerEffect(oracleText, match);
      if (!effect || triggers.some((trigger) => trigger.effect === effect)) continue;
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: /^when(?:ever)? you\b/i.test(match[0]) ? 'you_draw' : 'player_draws',
        effect,
        mandatory: !/^you may\b/i.test(effect),
        drawOrdinal,
        ...(duringOwnTurn ? { duringOwnTurn } : {}),
      } as any);
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

  const revealCreatureThisWayMatch = oracleText.match(/when(?:ever)? you reveal a creature card this way,?\s*([^.]+)/i);
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
 * Keranos / Primitive Etchings: "Reveal the first card you draw [on each of your turns | each turn].
 * Whenever you reveal a land/nonland/creature card this way, ..."
 */
function revealedFirstDrawMatches(ctx: GameContext, permanent: any, trigger: CardDrawTrigger, drawingPlayerId: string, permController: string, drawNumber: number | undefined, drawnCard: any): boolean {
  if (String(drawingPlayerId) !== String(permController) || drawNumber !== 1 || !drawnCard) return false;
  const oracle = String(permanent?.card?.oracle_text || '').toLowerCase();
  const reveal = /reveal the first card you draw (on each of your turns|each turn)/.exec(oracle);
  if (!reveal) return false;
  if (reveal[1] === 'on each of your turns' && String((ctx.state as any)?.turnPlayer || (ctx.state as any)?.activePlayer || '') !== String(drawingPlayerId)) return false;
  const typeLine = String(drawnCard?.type_line || drawnCard?.card?.type_line || '').toLowerCase();
  if (trigger.triggerType === 'reveal_creature_this_way') return typeLine.includes('creature');
  const effect = String(trigger.effect || '').toLowerCase();
  const kind = new RegExp('reveal an? (land|nonland) card this way,?\\s*' + effect.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).exec(oracle);
  const isLand = typeLine.includes('land');
  if (!kind) return false;
  return kind[1] === 'land' ? isLand : !isLand;
}

/**
 * Get all card draw triggers that should fire when a player draws a card
 */
export function getCardDrawTriggers(
  ctx: GameContext,
  drawingPlayerId: string,
  controllerId?: string,
  /** 1-based count of this draw among the player's draws this turn ("second card each turn"). */
  drawNumber?: number,
  /** The card just drawn, for "reveal the first card you draw ... whenever you reveal a land card this way". */
  drawnCard?: any,
): CardDrawTrigger[] {
  const triggers: CardDrawTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const permController = permanent.controller;
    const permTriggers = detectCardDrawTriggers(permanent.card, permanent, (ctx as any)?.state);
    
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

      const drawOrdinal = Number((trigger as any).drawOrdinal || 0);
      if (drawOrdinal > 0 && drawNumber !== drawOrdinal) continue;
      if ((trigger as any).duringOwnTurn && String((ctx.state as any)?.turnPlayer || (ctx.state as any)?.activePlayer || '') !== String(drawingPlayerId)) continue;

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
        case 'reveal_this_way':
        case 'reveal_creature_this_way':
          if (revealedFirstDrawMatches(ctx, permanent, trigger, drawingPlayerId, permController, drawNumber, drawnCard)) {
            triggers.push({ ...trigger, controllerId: permController });
          }
          break;
      }
    }

    for (const line of collectMatchingParsedEventLines({
      ctx,
      oracleText: String(permanent.card.oracle_text || ''),
      event: 'draws_card',
      subjectPermanent: { id: '', typeLine: '', controllerId: drawingPlayerId },
      subjectControllerId: drawingPlayerId,
      sourcePermanent: permanent,
      spellOrdinal: drawNumber,
    })) {
      // This emitter runs per card drawn; "draw one or more cards" is batched and stays legacy-owned.
      if (line.condition?.quantity === 'one_or_more') continue;
      const normalized = line.effect.toLowerCase();
      if (triggers.some((existing) => (
        sameTriggerSource(existing, permanent)
        && parsedEffectDuplicates(existing.effect || '', line)
      ))) continue;
      const controller = line.condition?.alternatives[0]?.controller;
      const triggerType = controller === 'you' ? 'you_draw' : controller === 'not_you' ? 'opponent_draws' : 'player_draws';
      if (triggerType === 'you_draw' && drawingPlayerId !== permController) continue;
      if (triggerType === 'opponent_draws' && drawingPlayerId === permController) continue;
      triggers.push({
        permanentId: String(permanent.id || ''),
        cardName: String(permanent.card?.name || 'Unknown'),
        controllerId: permController,
        triggerType,
        effect: line.effect,
        mandatory: !/\byou may\b/i.test(line.effect),
      });
    }
  }
  
  return dropTriggersFromAbilitylessSources(triggers, ctx.state, (t: any) => String(t?.permanentId || ''), { event: 'draw' });
}
