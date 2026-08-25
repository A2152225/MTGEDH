/**
 * socket/resolution-handlers/spellCastPaymentResumeHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (payment completion resume).
 * Cluster moved: createSyntheticAIGameActionSocket, didQueuedSpellCastComplete,
 * withTemporaryCastingPriorityForPaymentCompletion, resumeAISpellCastAfterPayment,
 * resumePlayerSpellCastAfterPayment.
 * Public entry symbols: resumePlayerSpellCastAfterPayment, resumeAISpellCastAfterPayment,
 * withTemporaryCastingPriorityForPaymentCompletion.
 *
 * Wired as a leaf imported by resolution.ts and mutate handlers. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import {
  applySelectedManaPaymentForResolutionCost,
  applyWardManaPaymentSelection,
  validateWardManaPaymentSelection,
} from "./resolutionManaPaymentApplication.js";
import { registerGameActions } from "../game-actions.js";
import { createForwardingGameActionSocket } from "../resolutionSyntheticCastSocketUtils.js";
import { ensureGame } from "../util.js";

function createSyntheticAIGameActionSocket(gameId: string, playerId: string): { socket: any; handlers: Map<string, (...args: any[]) => any> } {
  const handlers = new Map<string, (...args: any[]) => any>();
  const socket: any = {
    data: { gameId, playerId },
    rooms: new Set([gameId]),
    emit: (_event: string, _payload: any) => {
      // AI uses server-side completion directly; client-facing emits are ignored here.
    },
    on: (event: string, handler: (...args: any[]) => any) => {
      handlers.set(event, handler);
      return socket;
    },
  };

  return { socket, handlers };
}

function didQueuedSpellCastComplete(game: any, playerId: string, cardId: string): boolean {
  const stack = Array.isArray(game?.state?.stack) ? game.state.stack : [];
  const onStack = stack.some((item: any) =>
    String(item?.controller || '') === String(playerId) &&
    String(item?.card?.id || item?.cardId || '') === String(cardId),
  );
  if (onStack) return true;

  const hand = game?.state?.zones?.[playerId]?.hand;
  if (Array.isArray(hand)) {
    return !hand.some((card: any) => String(card?.id || '') === String(cardId));
  }

  return false;
}

export async function withTemporaryCastingPriorityForPaymentCompletion(
  gameId: string,
  playerId: string,
  cardId: string,
  action: () => Promise<void>,
): Promise<boolean> {
  const game = ensureGame(gameId);
  const stateAny = (game?.state as any) || {};
  const priorPriority = stateAny.priority;
  const grantedTemporaryPriority = Boolean(game && priorPriority !== playerId);

  // Always lock payment-resume casts. Mid-cast broadcasts / autopass can otherwise move
  // priority to an opponent during async gaps and abort with CAST_TIMING_LOST, then
  // empty-stack autopass advances the turn (e.g. main → combat during loop shortcuts).
  stateAny._paymentResumeCastLock = {
    playerId: String(playerId),
    cardId: String(cardId),
    priorPriority: priorPriority ?? null,
  };

  if (grantedTemporaryPriority) {
    stateAny.priority = playerId;
  }

  try {
    await action();
  } finally {
    if (stateAny._paymentResumeCastLock?.playerId === String(playerId)
      && stateAny._paymentResumeCastLock?.cardId === String(cardId)) {
      delete stateAny._paymentResumeCastLock;
    }

    if (!didQueuedSpellCastComplete(game, playerId, cardId)) {
      // Keep priority with the caster. Restoring a raced opponent priority lets AI
      // autopass the empty stack and skip the rest of the player's main phase.
      stateAny.priority = playerId;
      stateAny.priorityPassedBy = new Set<string>();
    }
  }

  return Boolean(game && didQueuedSpellCastComplete(game, playerId, cardId));
}

export async function resumeAISpellCastAfterPayment(
  io: Server,
  gameId: string,
  playerId: string,
  payload: {
    cardId: string;
    effectId?: string;
    targets?: any[];
    payment?: any[];
    xValue?: number;
    alternateCostId?: string;
    convokeTappedCreatures?: string[];
    harmonizeTappedCreatureId?: string;
    sneakReturnedCreatureId?: string;
  },
): Promise<boolean> {
  return withTemporaryCastingPriorityForPaymentCompletion(
    gameId,
    playerId,
    payload.cardId,
    async () => {
      const { socket, handlers } = createSyntheticAIGameActionSocket(gameId, playerId);
      registerGameActions(io, socket as any);

      const completeCastSpell = handlers.get('completeCastSpell');
      if (typeof completeCastSpell !== 'function') {
        throw new Error('Synthetic AI socket missing completeCastSpell handler');
      }

      await completeCastSpell({
        gameId,
        cardId: payload.cardId,
        effectId: payload.effectId,
        targets: payload.targets,
        payment: payload.payment,
        xValue: payload.xValue,
        alternateCostId: payload.alternateCostId,
        convokeTappedCreatures: payload.convokeTappedCreatures,
        harmonizeTappedCreatureId: payload.harmonizeTappedCreatureId,
        sneakReturnedCreatureId: payload.sneakReturnedCreatureId,
      });
    },
  );
}

export async function resumePlayerSpellCastAfterPayment(
  io: Server,
  gameId: string,
  playerId: string,
  payload: {
    cardId: string;
    effectId?: string;
    targets?: any[];
    payment?: any[];
    xValue?: number;
    alternateCostId?: string;
    convokeTappedCreatures?: string[];
    harmonizeTappedCreatureId?: string;
    sneakReturnedCreatureId?: string;
  },
): Promise<boolean> {
  return withTemporaryCastingPriorityForPaymentCompletion(
    gameId,
    playerId,
    payload.cardId,
    async () => {
      const { socket, handlers } = createForwardingGameActionSocket(io, gameId, playerId);
      registerGameActions(io, socket as any);

      const completeCastSpell = handlers.get('completeCastSpell');
      if (typeof completeCastSpell !== 'function') {
        throw new Error('Synthetic player socket missing completeCastSpell handler');
      }

      await completeCastSpell({
        gameId,
        cardId: payload.cardId,
        effectId: payload.effectId,
        targets: payload.targets,
        payment: payload.payment,
        xValue: payload.xValue,
        alternateCostId: payload.alternateCostId,
        convokeTappedCreatures: payload.convokeTappedCreatures,
        harmonizeTappedCreatureId: payload.harmonizeTappedCreatureId,
        sneakReturnedCreatureId: payload.sneakReturnedCreatureId,
      });
    },
  );
}
