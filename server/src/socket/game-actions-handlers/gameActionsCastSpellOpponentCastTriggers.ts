/**
 * Opponent spell-cast triggers (Esper Sentinel, Rhystic Study, Mystic Remora) queued when a
 * spell is cast from hand. Origin parent: gameActionsCastSpellFromHandPersistOnCast.ts
 * persistAndProcessCastSpellFromHand (split out for size; behavior unchanged).
 */

import type { Server } from "socket.io";
import { isInterveningIfSatisfied } from "../../state/modules/triggers/intervening-if";
import { getOpponentSpellCastTriggers, spellOrdinalForCaster } from "../../state/modules/triggers/index.js";
import { orderTriggersByAPNAP } from "../../state/modules/triggers/ordering.js";
import { debug, debugWarn } from "../../utils/debug.js";
import type { SpellCastSourceZone } from "./gameActionsCastCostReduction.js";
import { cloneTriggeringStackItemSnapshot, findTriggeringSpellOnStack } from "../../state/modules/triggerCastSpellStackBinding.js";

export function queueOpponentSpellCastTriggersForCast(args: {
  io: Server;
  game: any;
  gameId: string;
  playerId: string;
  cardId: string;
  cardInHand: any;
  castSourceZone: SpellCastSourceZone;
  persistTriggeredAbilityPush: (payload: Record<string, unknown>, reason: string) => void;
}): void {
  const { io, game, gameId, playerId, cardId, cardInHand, castSourceZone, persistTriggeredAbilityPush } = args;
  try {
    const allPlayerIds = (game.state?.players || []).map((p: any) => p.id);
    const battlefield = game.state?.battlefield || [];
    const ctxForInterveningIf = { state: game.state } as any;
    const opponentCastStackArr: any[] = Array.isArray((game.state as any)?.stack) ? (game.state as any).stack : [];
    const boundCastSpell = findTriggeringSpellOnStack(game.state, {
      triggeringPlayer: playerId,
      effectData: {
        casterId: playerId,
        triggeringSpell: {
          id: cardId,
          name: cardInHand?.name,
        },
      },
    }, { casterId: playerId, cardId: String(cardId || '') });
    let opponentCastTriggeringStackItemId = String(boundCastSpell?.id || '');
    if (!opponentCastTriggeringStackItemId) {
      for (let i = opponentCastStackArr.length - 1; i >= 0; i--) {
        const item = opponentCastStackArr[i];
        if (!item || String(item.controller || '') !== String(playerId)) continue;
        if (String(item.type || '').trim().toLowerCase() === 'triggered_ability') continue;
        if (String(item?.card?.id || '') === String(cardId)) {
          opponentCastTriggeringStackItemId = String(item.id || '');
          break;
        }
      }
    }
    const opponentCastTriggeringStackItem = boundCastSpell
      || opponentCastStackArr.find((item: any) => item && String(item.id || '') === opponentCastTriggeringStackItemId)
      || null;
    const opponentCastTriggeringStackItemSnapshot = cloneTriggeringStackItemSnapshot(opponentCastTriggeringStackItem);
    
    // Track if this is the first noncreature spell the caster has cast this turn
    const spellTypeLine = (cardInHand?.type_line || '').toLowerCase();
    const isNoncreatureSpell = !spellTypeLine.includes('creature');
    
    // Check noncreature spells cast this turn by this player
    const noncreatureSpellsThisTurn = (game.state?.noncreatureSpellsCastThisTurn || {})[playerId] || 0;
    const isFirstNoncreatureThisTurn = isNoncreatureSpell && noncreatureSpellsThisTurn === 0;
    
    // Increment counter if this is a noncreature spell
    if (isNoncreatureSpell) {
      game.state.noncreatureSpellsCastThisTurn = game.state.noncreatureSpellsCastThisTurn || {};
      game.state.noncreatureSpellsCastThisTurn[playerId] = noncreatureSpellsThisTurn + 1;
    }
    
    const opponentTriggers = orderTriggersByAPNAP(
      { state: game.state } as any,
      getOpponentSpellCastTriggers(
        battlefield,
        playerId, // The caster (opponent to the trigger controllers)
        cardInHand,
        allPlayerIds,
        isFirstNoncreatureThisTurn,
        castSourceZone,
        spellOrdinalForCaster(game.state, playerId, cardInHand),
      ),
    );
    
    for (const trigger of opponentTriggers) {
      // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
      const raw = String(trigger.description || (trigger as any).effect || "").trim();
      let triggerText = raw;
      if (triggerText && !/^(?:when|whenever|at)\b/i.test(triggerText)) {
        triggerText = `Whenever an opponent casts a spell, ${triggerText}`;
      }
      const casterId = String((trigger as any).casterId || playerId || '').trim();
      const sourcePerm = (game.state?.battlefield || []).find((p: any) => p && p.id === (trigger as any).permanentId);
      const needsThatPlayerRef = /\bthat player\b/i.test(triggerText);
      const wantsHandCast = /\bfrom (?:their|your|his or her) hand\b/i.test(triggerText);
      if (wantsHandCast && castSourceZone && castSourceZone !== 'hand') {
        debug(2, `[castSpellFromHand] Skipping opponent spell trigger: ${trigger.cardName} (spell was not cast from hand)`);
        continue;
      }
      const ok = isInterveningIfSatisfied(
        ctxForInterveningIf,
        String(trigger.controllerId),
        triggerText,
        sourcePerm,
        needsThatPlayerRef && casterId
          ? {
              thatPlayerId: casterId,
              referencedPlayerId: casterId,
              theirPlayerId: casterId,
            }
          : undefined
      );
      if (ok === false) {
        debug(2, `[castSpellFromHand] Skipping opponent spell trigger due to unmet intervening-if: ${trigger.cardName} - ${triggerText}`);
        continue;
      }

      debug(2, `[castSpellFromHand] Opponent spell trigger: ${trigger.cardName} - ${trigger.description}`);
      
      // Push the trigger to the stack for resolution
      // The trigger's controller can choose to draw a card unless the caster pays
      game.state.stack = game.state.stack || [];
      const triggerId = `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      
      const stackItem: any = {
        id: triggerId,
        type: 'triggered_ability',
        controller: trigger.controllerId, // The Esper Sentinel/Rhystic Study controller
        source: trigger.permanentId,
        permanentId: trigger.permanentId,
        sourceName: trigger.cardName,
        description: trigger.description,
        effect: (trigger as any).effect || trigger.benefitIfNotPaid || trigger.description,
        triggerType: trigger.triggerType,
        mandatory: trigger.mandatory,
        // Context for resolution-time checks and pronoun binding (e.g., "that player")
        targetPlayer: String((trigger as any).casterId || playerId || ''),
        triggeringPlayer: String((trigger as any).casterId || playerId || ''),
        ...(opponentCastTriggeringStackItemId ? { triggeringStackItemId: opponentCastTriggeringStackItemId } : null),
        ...(castSourceZone ? { triggeringSpellCastSourceZone: castSourceZone } : null),
        effectData: {
          casterId: trigger.casterId,
          ...(castSourceZone ? { castSourceZone, sourceCastZone: castSourceZone } : null),
          ...(opponentCastTriggeringStackItemId ? { triggeringStackItemId: opponentCastTriggeringStackItemId } : null),
          triggeringSpell: {
            id: cardInHand?.id,
            name: cardInHand?.name,
            type_line: cardInHand?.type_line,
            ...(castSourceZone ? { castSourceZone } : null),
          },
          ...(opponentCastTriggeringStackItemSnapshot ? { triggeringSpellStackItem: opponentCastTriggeringStackItemSnapshot } : null),
          paymentCost: trigger.paymentCost,
          paymentAmount: trigger.paymentAmount,
          benefitIfNotPaid: trigger.benefitIfNotPaid,
        },
      };
      game.state.stack.push(stackItem);

      persistTriggeredAbilityPush({
        triggerId,
        sourceId: trigger.permanentId,
        permanentId: trigger.permanentId,
        sourceName: trigger.cardName,
        controllerId: trigger.controllerId,
        description: trigger.description,
        triggerType: trigger.triggerType,
        effect: (trigger as any).effect || trigger.description,
        mandatory: trigger.mandatory,
        targetPlayer: stackItem.targetPlayer,
        triggeringPlayer: stackItem.triggeringPlayer,
        ...(opponentCastTriggeringStackItemId ? { triggeringStackItemId: opponentCastTriggeringStackItemId } : null),
        ...(castSourceZone ? { triggeringSpellCastSourceZone: castSourceZone } : null),
        effectData: stackItem.effectData,
      }, 'opponent spell-cast');
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${trigger.cardName} triggers (${trigger.description}).`,
        ts: Date.now(),
      });
    }
  } catch (err) {
    debugWarn(1, '[castSpellFromHand] Failed to process opponent spell triggers:', err);
  }
}
