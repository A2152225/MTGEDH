/**
 * socket/resolution-handlers/targetSelectionSpellCastPaymentHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleTargetSelectionResponse).
 * Cluster moved: the tail that runs once a spell's targets are locked in - the auto-unignore pass
 * (a permanent targeted by an opponent leaves that player's auto-pass ignore list) and the
 * spell-cast payment request (validate against the pending cast's legal targets, accumulate targets
 * across multiple queued target steps, add Strive cost per extra target, then queue the
 * MANA_PAYMENT_CHOICE per CR 601.2h).
 * Public entry symbols: applyAutoUnignoreForTargetedPermanents,
 * handleSpellCastPaymentTargetSelection.
 *
 * The payment branch always returned, so its call site is `handler(...); return;`. The auto-unignore
 * pass never returned and stays a plain statement in the parent.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { broadcastGame, emitToPlayer } from "../util.js";
import { maybeQueueDamageDivisionAfterSpellTargets } from "./queueDamageDivisionAfterSpellTargets.js";
import { queuePendingCastManaPaymentAfterTargets } from "./queuePendingCastManaPaymentAfterTargets.js";

/**
 * AUTO-UNIGNORE: Remove targeted permanents from ignore list.
 *
 * When a permanent becomes the target of an opponent's spell/ability, automatically remove it from
 * the ignore list so the player can respond.
 */
export function applyAutoUnignoreForTargetedPermanents(
  io: Server,
  game: any,
  gameId: string,
  response: ResolutionStepResponse,
): void {
  const pid = response.playerId;
  const selections = response.selections as string[];
  const stateAny = game.state as any;
  if (!stateAny.ignoredCardsForAutoPass) return;

  const battlefield = game.state.battlefield || [];

  for (const targetId of selections) {
    // Find the target permanent
    const targetPerm = battlefield.find((p: any) => p.id === targetId);
    if (!targetPerm) continue;

    // Check if this is a permanent controlled by another player
    const targetController = targetPerm.controller;
    if (targetController && targetController !== pid) {
      // Check if the target is in the controller's ignore list
      const controllerIgnored = stateAny.ignoredCardsForAutoPass[targetController];
      if (controllerIgnored && controllerIgnored[targetId]) {
        const cardName = controllerIgnored[targetId].cardName;
        delete controllerIgnored[targetId];

        debug(2, `[Resolution] Auto-unignored ${cardName} (${targetId}) - targeted by opponent's spell`);

        // Notify the controller that their card was auto-unignored
        emitToPlayer(io, targetController, "cardUnignoredAutomatically", {
          gameId,
          playerId: targetController,
          permanentId: targetId,
          cardName,
          reason: "targeted by opponent's spell or ability",
        });

        // Send updated ignored cards list to the controller
        const updatedList = Object.entries(controllerIgnored).map(([id, data]: [string, any]) => ({
          permanentId: id,
          cardName: data.cardName,
          imageUrl: data.imageUrl,
        }));

        emitToPlayer(io, targetController, "ignoredCardsUpdated", {
          gameId,
          playerId: targetController,
          ignoredCards: updatedList,
        });
      }
    }
  }
}

/**
 * SPELL CASTING TARGET SELECTION.
 *
 * When a spell requires targets and is being cast via Resolution Queue, we need to request payment
 * after targets are selected (MTG Rule 601.2h).
 */
export function handleSpellCastPaymentTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const pid = response.playerId;
  const selections = response.selections as string[];
  const spellCastContext = (step as any).spellCastContext;

  const { cardId, cardName, manaCost, effectId, oracleText, imageUrl } = spellCastContext;

  // Store targets with the pending cast for validation during payment
  const pendingCast = (game.state as any).pendingSpellCasts?.[effectId];
  if (pendingCast) {
    // Validate selected targets are valid
    const validTargetIds = pendingCast.validTargetIds || [];
    const validTargetSet = new Set(validTargetIds);
    const invalidTargets = selections.filter((t: string) => !validTargetSet.has(t));

    if (invalidTargets.length > 0) {
      debugWarn(1, `[Resolution] Invalid targets selected: ${invalidTargets.join(', ')} for ${cardName}`);

      // Clean up pending spell cast
      delete (game.state as any).pendingSpellCasts[effectId];

      // Emit error to player
      emitToPlayer(io, pid, "error", {
        code: "INVALID_TARGETS",
        message: `Invalid targets selected for ${cardName}. The targets don't meet the spell's requirements.`,
      });

      broadcastGame(io, game, gameId);
      return;
    }

    const existingTargets = Array.isArray(pendingCast.targets)
      ? pendingCast.targets.map((targetId: any) => String(targetId))
      : [];

    // Preserve target order across multiple queued target steps for the same spell.
    pendingCast.targets = [...existingTargets, ...selections.map((targetId: string) => String(targetId))];

    const remainingTargetSteps = ResolutionQueueManager
      .getStepsForPlayer(gameId, pid as any)
      .filter((queueStep: any) =>
        queueStep?.type === ResolutionStepType.TARGET_SELECTION &&
        String((queueStep as any)?.spellCastContext?.effectId || '') === String(effectId)
      );

    if (remainingTargetSteps.length > 0) {
      debug(2, `[Resolution] Stored ${selections.length} target(s) for ${cardName}; waiting on ${remainingTargetSteps.length} more target step(s)`);

      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }

      broadcastGame(io, game, gameId);
      return;
    }

    const finalTargets = Array.isArray(pendingCast.targets)
      ? pendingCast.targets.map((targetId: any) => String(targetId))
      : selections;

    if (maybeQueueDamageDivisionAfterSpellTargets({
      io,
      game,
      gameId,
      playerId: String(pid),
      pendingCast,
      spellCastContext,
      finalTargets,
    })) {
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      broadcastGame(io, game, gameId);
      return;
    }

    queuePendingCastManaPaymentAfterTargets({
      io,
      game,
      gameId,
      playerId: String(pid),
      pendingCast,
      spellCastContext,
      finalTargets,
    });
  } else {
    debugWarn(1, `[Resolution] No pending spell cast found for effectId: ${effectId}`);
  }

  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }

  broadcastGame(io, game, gameId);
}
