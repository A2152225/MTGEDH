/**
 * socket/util-handlers/autoPassIdleResolutionKick.ts
 *
 * Origin parent: server/src/socket/util-handlers/checkAndTriggerAutoPass.ts.
 * Cluster moved: when auto-pass is blocked by a pending non-payment prompt,
 * drop steps owned by seats that are not in the current player list, then
 * auto-answer leftover AI seats that missed STEP_ADDED. Humans keep the
 * per-step choice clock (Kynaios) instead of being auto-picked immediately.
 * Public entry symbols: kickIdleAutoPassPendingResolutionSteps.
 *
 * Must not import util.ts. Dynamic-imports resolution.ts to apply side effects.
 */

import type { Server } from "socket.io";
import type { InMemoryGame } from "../../state/types.js";
import { ResolutionQueueManager } from "../../state/resolution/ResolutionQueueManager.js";
import { playerCannotReceivePriority } from "../../state/modules/priorityEligibility.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { shouldAutoResolveResolutionStep } from "../resolution-handlers/resolutionAutoResolveGate.js";

const kicksInFlight = new Set<string>();

function isUnresolvedStep(step: any): boolean {
  const status = String(step?.status || '').toLowerCase();
  return Boolean(step) && status !== 'completed' && status !== 'cancelled';
}

function eligibilityContext(game: InMemoryGame) {
  return {
    state: game.state,
    inactive: (game as any).inactive,
    libraries: (game as any).libraries,
    commandZone: (game as any).commandZone,
  };
}

function cancelPendingStepsForIneligiblePlayers(game: InMemoryGame, gameId: string): number {
  const queue = ResolutionQueueManager.getQueue(gameId);
  const ctx = eligibilityContext(game);
  const players = Array.isArray(game.state?.players) ? game.state.players : [];
  let cancelled = 0;
  for (const step of [...(queue?.steps || [])]) {
    if (!isUnresolvedStep(step)) continue;
    const playerId = String(step?.playerId || '').trim();
    if (!playerId) {
      const cancelledStep = ResolutionQueueManager.cancelStep(gameId, step.id);
      if (cancelledStep) {
        cancelled += 1;
        debug(2, '[autoPassIdleResolutionKick] Cancelled pending step with no owner:', {
          gameId,
          stepType: step.type,
          stepId: step.id,
        });
      }
      continue;
    }
    const player = players.find((entry: any) => String(entry?.id || '') === playerId);
    if (!player || !playerCannotReceivePriority(player, ctx)) continue;
    const cancelledStep = ResolutionQueueManager.cancelStep(gameId, step.id);
    if (cancelledStep) {
      cancelled += 1;
      debug(2, '[autoPassIdleResolutionKick] Cancelled pending step for ineligible seat:', {
        gameId,
        playerId: playerId || '(none)',
        stepType: step.type,
        stepId: step.id,
      });
    }
  }
  return cancelled;
}

/**
 * Auto-complete one pending resolution step owned by an AI seat.
 * Human APNAP choices wait for a click or the per-step timeout.
 * Seats that are not in the current player list (spectator / no deck /
 * eliminated) do not keep the queue blocked.
 */
export function kickIdleAutoPassPendingResolutionSteps(
  io: Server,
  game: InMemoryGame,
  gameId: string,
): void {
  const normalizedGameId = String(gameId || '').trim();
  if (!normalizedGameId) return;

  cancelPendingStepsForIneligiblePlayers(game, normalizedGameId);
  if (kicksInFlight.has(normalizedGameId)) return;

  const queue = ResolutionQueueManager.getQueue(normalizedGameId);
  const idleStep = (queue?.steps || []).find((step: any) => {
    if (!isUnresolvedStep(step)) return false;
    const playerId = String(step?.playerId || '').trim();
    if (!playerId) return false;
    return shouldAutoResolveResolutionStep(game, playerId);
  });
  if (!idleStep) return;

  kicksInFlight.add(normalizedGameId);
  debug(2, '[autoPassIdleResolutionKick] Auto-resolving pending step for idle auto-pass player:', {
    gameId: normalizedGameId,
    playerId: idleStep.playerId,
    stepType: idleStep.type,
    stepId: idleStep.id,
  });

  void import('../resolution.js').then(async (resolutionModule) => {
    try {
      if (typeof resolutionModule.handleAIResolutionStep === 'function') {
        await resolutionModule.handleAIResolutionStep(io, normalizedGameId, idleStep);
      }
    } catch (err) {
      debugWarn(1, '[autoPassIdleResolutionKick] Failed to auto-resolve pending step:', err);
    } finally {
      kicksInFlight.delete(normalizedGameId);
    }
  }).catch((err) => {
    kicksInFlight.delete(normalizedGameId);
    debugWarn(1, '[autoPassIdleResolutionKick] Failed to load resolution handler:', err);
  });
}
