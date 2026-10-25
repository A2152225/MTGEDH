// server/src/socket/combat-handlers/combatAttackTriggerManaPayment.ts
// Origin parent: combatDeclareAttackersSupport.ts (moved verbatim in Batch 25 to keep it under 40KB).
// Cluster: optional attack-trigger mana/energy payment (pushPaid + resolveAttackTriggerManaPaymentChoice).
// Public entry symbols: PendingAttackTriggerManaPayment, formatEnergyCost, trimReminderText,
//   resolveAttackTriggerManaPaymentChoice. Re-exported by combatDeclareAttackersSupport.
// Leaf: must not import combatDeclareAttackersSupport.ts.

import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { transformPermanentToFace } from "../../state/modules/day-night.js";
import { inferTriggeredAbilityTargetMetadata } from "../../state/modules/inferTriggeredAbilityTargetMetadata.js";
import { broadcastGame, emitToPlayer, getPlayerName, payManaCostWithAvailableSources } from "../util.js";
import { persistTriggeredAbilityPush } from "./combatDeclareBlockersRequest.js";
import { debug } from "../../utils/debug.js";
import { getEnergyCount, spendEnergyCounters } from "../../state/utils.js";

export type PendingAttackTriggerManaPayment = {
  permanentId: string;
  cardName: string;
  effect?: string;
  manaCost: string;
  energyCost?: number;
  description?: string;
};

export function formatEnergyCost(amount: number): string {
  return amount > 0 ? '{E}'.repeat(amount) : '';
}

export function trimReminderText(text: string): string {
  return String(text || '').replace(/\s*\([^)]*\)\s*$/i, '').trim();
}

// Batch 24 import kept local to the restriction hook.
function pushPaidAttackTriggerEffectOntoStack(
  game: any,
  gameId: string,
  playerId: PlayerID,
  pendingTrigger: PendingAttackTriggerManaPayment
): boolean {
  const effectText = trimReminderText(String(pendingTrigger.effect || ''));
  if (!effectText || !/\btarget\b/i.test(effectText)) {
    return false;
  }

  const battlefield = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
  const sourcePerm = battlefield.find((p: any) => String(p?.id || '') === String(pendingTrigger.permanentId || ''));
  const targetMetadata = inferTriggeredAbilityTargetMetadata(effectText, {
    gameState: game.state,
    controllerId: String(playerId),
    sourceName: String(pendingTrigger.cardName || sourcePerm?.card?.name || ''),
    sourcePermanent: sourcePerm,
  } as any);

  const triggerId = `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const stackItem: any = {
    id: triggerId,
    type: 'triggered_ability',
    controller: playerId,
    source: pendingTrigger.permanentId,
    permanentId: pendingTrigger.permanentId,
    sourceName: pendingTrigger.cardName,
    description: effectText,
    effect: effectText,
    triggerType: 'reflexive_attack_payment',
    mandatory: true,
    ...(targetMetadata.requiresTarget ? { requiresTarget: true, needsTargetSelection: true } : null),
    ...(targetMetadata.targetType ? { targetType: targetMetadata.targetType } : null),
    ...(targetMetadata.targetCombatRole ? { targetCombatRole: targetMetadata.targetCombatRole } : null),
    ...(targetMetadata.targetConstraint ? { targetConstraint: targetMetadata.targetConstraint } : null),
    ...(targetMetadata.targetZone ? { targetZone: targetMetadata.targetZone } : null),
    ...(targetMetadata.targetDestination ? { targetDestination: targetMetadata.targetDestination } : null),
    ...(targetMetadata.targetGraveyardScope ? { targetGraveyardScope: targetMetadata.targetGraveyardScope } : null),
    ...(targetMetadata.destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
    ...(targetMetadata.battlefieldControllerMode ? { battlefieldControllerMode: targetMetadata.battlefieldControllerMode } : null),
    ...(targetMetadata.battlefieldCounters ? { battlefieldCounters: targetMetadata.battlefieldCounters } : null),
    ...(targetMetadata.targetAction ? { targetAction: targetMetadata.targetAction } : null),
    ...(Array.isArray(targetMetadata.targetFilterTypes) ? { targetFilterTypes: targetMetadata.targetFilterTypes } : null),
    ...(Array.isArray(targetMetadata.targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords: targetMetadata.targetFilterRequiredTypeWords } : null),
    ...(Array.isArray(targetMetadata.targetFilterExcludeTypes) ? { targetFilterExcludeTypes: targetMetadata.targetFilterExcludeTypes } : null),
    ...(targetMetadata.targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
    ...(typeof targetMetadata.targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue: targetMetadata.targetFilterExactManaValue } : null),
    ...(typeof targetMetadata.targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue: targetMetadata.targetFilterMinManaValue } : null),
    ...(typeof targetMetadata.targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue: targetMetadata.targetFilterMaxManaValue } : null),
    ...(typeof targetMetadata.targetTotalPowerLimit === 'number' ? { targetTotalPowerLimit: targetMetadata.targetTotalPowerLimit } : null),
    ...(targetMetadata.targetCastWithoutPayingManaCost === true ? { targetCastWithoutPayingManaCost: true } : null),
    ...(targetMetadata.targetCastIsOptional === true ? { targetCastIsOptional: true } : null),
    ...(typeof targetMetadata.minTargets === 'number' ? { minTargets: targetMetadata.minTargets } : null),
    ...(typeof targetMetadata.maxTargets === 'number' ? { maxTargets: targetMetadata.maxTargets } : null),
  };

  game.state.stack = Array.isArray(game.state.stack) ? game.state.stack : [];
  game.state.stack.push(stackItem);
  persistTriggeredAbilityPush(gameId, game, {
    triggerId,
    sourceId: pendingTrigger.permanentId,
    permanentId: pendingTrigger.permanentId,
    sourceName: pendingTrigger.cardName,
    controllerId: playerId,
    description: effectText,
    effect: effectText,
    triggerType: 'reflexive_attack_payment',
    mandatory: true,
    ...(targetMetadata.requiresTarget ? { requiresTarget: true, needsTargetSelection: true } : null),
    ...(targetMetadata.targetType ? { targetType: targetMetadata.targetType } : null),
    ...(targetMetadata.targetCombatRole ? { targetCombatRole: targetMetadata.targetCombatRole } : null),
    ...(targetMetadata.targetConstraint ? { targetConstraint: targetMetadata.targetConstraint } : null),
    ...(targetMetadata.targetZone ? { targetZone: targetMetadata.targetZone } : null),
    ...(targetMetadata.targetDestination ? { targetDestination: targetMetadata.targetDestination } : null),
    ...(targetMetadata.targetGraveyardScope ? { targetGraveyardScope: targetMetadata.targetGraveyardScope } : null),
    ...(Array.isArray(targetMetadata.targetFilterTypes) ? { targetFilterTypes: targetMetadata.targetFilterTypes } : null),
    ...(Array.isArray(targetMetadata.targetFilterExcludeTypes) ? { targetFilterExcludeTypes: targetMetadata.targetFilterExcludeTypes } : null),
    ...(typeof targetMetadata.minTargets === 'number' ? { minTargets: targetMetadata.minTargets } : null),
    ...(typeof targetMetadata.maxTargets === 'number' ? { maxTargets: targetMetadata.maxTargets } : null),
  }, `paid attack trigger ${pendingTrigger.cardName}`);

  return true;
}

export function resolveAttackTriggerManaPaymentChoice(
  io: Server,
  game: any,
  gameId: string,
  playerId: PlayerID,
  pendingTrigger: PendingAttackTriggerManaPayment,
  payMana: boolean
): void {
  const { permanentId, cardName, effect, manaCost } = pendingTrigger;
  const energyCost = Number(pendingTrigger.energyCost || 0);
  const displayedCost = energyCost > 0 ? formatEnergyCost(energyCost) : manaCost;

  if (payMana) {
    if (energyCost > 0) {
      const availableEnergy = getEnergyCount(game.state, String(playerId));
      if (availableEnergy < energyCost || !spendEnergyCounters(game.state, String(playerId), energyCost)) {
        emitToPlayer(io, playerId, "error", {
          code: "INSUFFICIENT_ENERGY",
          message: `Cannot pay ${displayedCost}: need ${energyCost} energy, but only ${availableEnergy} available.`,
        });

        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} couldn't pay ${displayedCost} for ${cardName}'s trigger.`,
          ts: Date.now(),
        });

        if (typeof (game as any).bumpSeq === "function") {
          (game as any).bumpSeq();
        }
        broadcastGame(io, game, gameId);
        return;
      }
    } else {
      const payment = payManaCostWithAvailableSources(game.state, playerId, manaCost);
      const validationError = payment.ok ? null : payment.error || 'Insufficient mana.';
      if (validationError) {
        emitToPlayer(io, playerId, "error", {
          code: "INSUFFICIENT_MANA",
          message: `Cannot pay ${manaCost}: ${validationError}`,
        });

        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} couldn't pay ${manaCost} for ${cardName}'s trigger.`,
          ts: Date.now(),
        });

        if (typeof (game as any).bumpSeq === "function") {
          (game as any).bumpSeq();
        }
        broadcastGame(io, game, gameId);
        return;
      }
    }
    const battlefield = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
    const permanent = battlefield.find((p: any) => String(p?.id || '') === String(permanentId || ''));
    const cardFaces = Array.isArray(permanent?.card?.card_faces) ? permanent.card.card_faces : [];
    const shouldTransform =
      Boolean(permanent) &&
      cardFaces.length >= 2 &&
      /transform/i.test(String(effect || ''));

    if (shouldTransform) {
      const frontFaceName = String(cardFaces[0]?.name || '').trim().toLowerCase();
      const currentFaceName = String(permanent?.card?.name || '').trim().toLowerCase();
      const wasTransformed = Boolean(frontFaceName) && currentFaceName !== frontFaceName;
      const newFaceIndex = wasTransformed ? 0 : 1;
      const newFace = cardFaces[newFaceIndex];

      if (newFace) {
        transformPermanentToFace(permanent, newFaceIndex, ((game as any).ctx || game) as any);
        if ('mana_cost' in newFace) {
          permanent.card.mana_cost = newFace.mana_cost;
        }
        if ('colors' in newFace) {
          permanent.card.colors = newFace.colors;
        }

        const newName = String(newFace.name || '');
        if (newName.toLowerCase().includes('pathbreaker owlbear')) {
          const legendaryCreatures = battlefield.filter(
            (p: any) =>
              p?.controller === playerId &&
              p?.id !== permanentId &&
              String(p?.card?.type_line || '').toLowerCase().includes('legendary') &&
              String(p?.card?.type_line || '').toLowerCase().includes('creature')
          );

          for (const creature of legendaryCreatures) {
            const existingModifiers = Array.isArray(creature.modifiers) ? creature.modifiers : [];
            creature.modifiers = [
              ...existingModifiers,
              {
                type: 'pt_buff',
                sourceId: permanentId,
                power: 2,
                toughness: 2,
                keywords: ['Trample'],
                duration: 'end_of_turn',
                appliedAt: Date.now(),
              } as any,
            ];
          }

          if (legendaryCreatures.length > 0) {
            io.to(gameId).emit('chat', {
              id: `m_${Date.now()}`,
              gameId,
              from: 'system',
              message: `\ud83d\udc3b ${newName}: ${legendaryCreatures.length} legendary creature${legendaryCreatures.length > 1 ? 's' : ''} get +2/+2 and gain trample until end of turn!`,
              ts: Date.now(),
            });
          }
        }

        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `\ud83d\udcb0 ${getPlayerName(game, playerId)} paid ${manaCost}. ${cardName} transforms into ${newFace.name}!`,
          ts: Date.now(),
        });
      }
    }

    const pushedPaidEffect = pushPaidAttackTriggerEffectOntoStack(game, gameId, playerId, pendingTrigger);
    if (pushedPaidEffect) {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, playerId)} paid ${displayedCost} for ${cardName}.`,
        ts: Date.now(),
      });
    }

    // Bump sequence and broadcast
    if (typeof (game as any).bumpSeq === "function") {
      (game as any).bumpSeq();
    }
    broadcastGame(io, game, gameId);

    debug(2, `[combat] ${playerId} paid ${displayedCost} for ${cardName}'s attack trigger`);
    return;
  }

  // Player chose not to pay
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${getPlayerName(game, playerId)} declined to pay ${displayedCost} for ${cardName}'s trigger.`,
    ts: Date.now(),
  });

  if (typeof (game as any).bumpSeq === "function") {
    (game as any).bumpSeq();
  }
  broadcastGame(io, game, gameId);

  debug(2, `[combat] ${playerId} declined to pay for ${cardName}'s attack trigger`);
}
