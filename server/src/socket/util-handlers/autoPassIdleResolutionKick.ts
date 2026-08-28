/**
 * socket/util-handlers/autoPassIdleResolutionKick.ts
 *
 * Origin parent: server/src/socket/util-handlers/checkAndTriggerAutoPass.ts.
 * Cluster moved: when auto-pass is blocked by a pending non-payment prompt,
 * auto-answer that prompt for AI seats that missed STEP_ADDED. Humans keep the
 * per-step choice clock (Kynaios) instead of being auto-picked immediately.
 * Public entry symbols: kickIdleAutoPassPendingResolutionSteps.
 *
 * Must not import util.ts. Dynamic-imports resolution.ts to apply side effects.
 */

import type { Server } from "socket.io";
import type { InMemoryGame } from "../../state/types.js";
import { ResolutionQueueManager } from "../../state/resolution/ResolutionQueueManager.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { shouldAutoResolveResolutionStep } from "../resolution-handlers/resolutionAutoResolveGate.js";

const kicksInFlight = new Set<string>();

function isUnresolvedStep(step: any): boolean {
  const status = String(step?.status || '').toLowerCase();
  return Boolean(step) && status !== 'completed' && status !== 'cancelled';
}

/**
 * Auto-complete one pending resolution step owned by an AI seat.
 * Human APNAP choices wait for a click or the per-step timeout.
 */
export function kickIdleAutoPassPendingResolutionSteps(
  io: Server,
  game: InMemoryGame,
  gameId: string,
): void {
  const normalizedGameId = String(gameId || '').trim();
  if (!normalizedGameId || kicksInFlight.has(normalizedGameId)) return;

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
