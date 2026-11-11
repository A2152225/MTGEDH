/**
 * Origin parent: server/src/socket/ai-handlers/aiPriorityPassCombatExecutors.ts
 *
 * Cluster moved: soft-unstick for stack tops that survive repeated all-pass resolves
 * (Sylvan Offering / oracleIrDeferredFinalize after capped player_choice cancels).
 *
 * Public entry symbols: tryResumeDeferredOracleIrStackSpellForAi,
 * noteAiFailedStackResolve, forceUnstickAiStuckStackTop.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { maybeResumeDeferredOracleIrStackSpellOnGame } from "../../state/modules/oracleIrDeferredStackFinalize.js";
import { ResolutionQueueManager } from "../../state/resolution/ResolutionQueueManager.js";
import { broadcastGame } from "../util.js";
import { debugWarn } from "../../utils/debug.js";
import { AI_REACTION_DELAY_MS } from "./aiConstants.js";
import { scheduleAIPriority } from "./aiScheduler.js";
import { isAIPlayer } from "./aiPlayerRegistry.js";

const MAX_FAILED_RESOLVES_BEFORE_FORCE = 2;
/** Same stack top still present across this many pass attempts (pending flicker can
 *  prevent all-pass / resolvedNow, so failed-resolve counts never climb). */
const MAX_STACK_TOP_SIGHTINGS_BEFORE_FORCE = 6;

function stackTopId(game: any): string {
  const stack = Array.isArray(game?.state?.stack) ? game.state.stack : [];
  if (stack.length === 0) return '';
  return String(stack[stack.length - 1]?.id || '').trim();
}

/** When the resolution queue is empty but a deferred IR spell is still on top, resume finalize. */
export function tryResumeDeferredOracleIrStackSpellForAi(
  io: Server,
  game: any,
  gameId: string,
): boolean {
  if (!game?.state) return false;
  const topIdBefore = stackTopId(game);
  if (!topIdBefore) return false;

  const top = game.state.stack[game.state.stack.length - 1];
  if (top?.oracleIrDeferredFinalize !== true) return false;

  let pendingCount = 0;
  try {
    pendingCount = ResolutionQueueManager.getPendingSummary(gameId).pendingCount || 0;
  } catch {
    pendingCount = 0;
  }
  if (pendingCount > 0) return false;

  try {
    maybeResumeDeferredOracleIrStackSpellOnGame(game, gameId);
  } catch (err) {
    debugWarn(1, '[AI] Deferred oracle-IR stack resume failed:', err);
    return false;
  }

  const topIdAfter = stackTopId(game);
  if (topIdAfter === topIdBefore && (game.state.stack?.length || 0) > 0) {
    return false;
  }

  debugWarn(1, '[AI] Resumed deferred oracle-IR stack finalize after empty queue', {
    gameId,
    topIdBefore,
    topIdAfter: topIdAfter || null,
  });
  broadcastGame(io, game, gameId, { forceStateReplace: true });
  const nextPriority = (game.state as any)?.priority;
  if (nextPriority && isAIPlayer(gameId, nextPriority)) {
    scheduleAIPriority(io, gameId, nextPriority, AI_REACTION_DELAY_MS);
  }
  return true;
}

/** Count an all-pass resolve that left the same stack top in place. */
export function noteAiFailedStackResolve(game: any, topId: string): number {
  if (!game?.state || !topId) return 0;
  const counts = ((game.state as any)._aiStuckStackResolveCounts ||= {}) as Record<string, number>;
  counts[topId] = Number(counts[topId] || 0) + 1;
  return counts[topId];
}

/**
 * After repeated failed resolves of the same top (usually deferred IR + cancelled
 * choice), force one more resolve / resume; if that fails, pop the stuck item so
 * priority can continue. Phase 0 soft-stall escape — not a rules-perfect fizzle.
 */
export function forceUnstickAiStuckStackTop(
  io: Server,
  game: any,
  gameId: string,
  playerId: PlayerID,
  topId: string,
): boolean {
  if (!game?.state || !topId) return false;
  if (stackTopId(game) !== topId) return false;

  const top = game.state.stack?.[game.state.stack.length - 1];
  const deferred = top?.oracleIrDeferredFinalize === true;
  debugWarn(1, '[AI] Forcing unstick of repeated failed stack top', {
    gameId,
    playerId,
    topId,
    name: top?.card?.name || top?.sourceName || top?.name,
    deferred,
    type: top?.type,
  });

  // Deferred IR only: one resume attempt. Avoid re-entering persistAndResolve
  // here — a wedged resolve can burn the whole AI tick before the hard pop.
  if (deferred) {
    try {
      maybeResumeDeferredOracleIrStackSpellOnGame(game, gameId);
    } catch (err) {
      debugWarn(1, '[AI] Force resume of stuck deferred stack top failed:', err);
    }
    if (stackTopId(game) !== topId) {
      delete (game.state as any)._aiStuckStackResolveCounts?.[topId];
      delete (game.state as any)._aiStuckStackSightingCounts?.[topId];
      broadcastGame(io, game, gameId, { forceStateReplace: true });
      const nextPriority = (game.state as any)?.priority;
      if (nextPriority && isAIPlayer(gameId, nextPriority)) {
        scheduleAIPriority(io, gameId, nextPriority, AI_REACTION_DELAY_MS);
      }
      return true;
    }
  }

  // Hard pop — Phase 0 soft-stall escape when resolve itself is the hang.
  try {
    const stack = game.state.stack as any[];
    const idx = stack.findIndex((e) => String(e?.id || '') === topId);
    if (idx >= 0) {
      const [removed] = stack.splice(idx, 1);
      const controller = String(removed?.controller || playerId);
      const card = removed?.card;
      if (card && removed?.type !== 'triggered_ability' && game.state.zones?.[controller]) {
        const z = game.state.zones[controller];
        z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
        z.graveyard.push({ ...card, zone: 'graveyard' });
        z.graveyardCount = z.graveyard.length;
      }
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    }
  } catch (err) {
    debugWarn(1, '[AI] Force-pop of stuck stack top failed:', err);
    return false;
  }

  delete (game.state as any)._aiStuckStackResolveCounts?.[topId];
  delete (game.state as any)._aiStuckStackSightingCounts?.[topId];
  broadcastGame(io, game, gameId, { forceStateReplace: true });
  const nextPriority = (game.state as any)?.priority || game.state.turnPlayer;
  if (nextPriority && isAIPlayer(gameId, nextPriority)) {
    scheduleAIPriority(io, gameId, nextPriority as PlayerID, AI_REACTION_DELAY_MS);
  }
  return true;
}

export function maybeForceUnstickAfterFailedResolve(
  io: Server,
  game: any,
  gameId: string,
  playerId: PlayerID,
  topIdBefore: string,
): boolean {
  if (!topIdBefore) return false;
  if (stackTopId(game) !== topIdBefore) {
    delete (game.state as any)?._aiStuckStackResolveCounts?.[topIdBefore];
    delete (game.state as any)?._aiStuckStackSightingCounts?.[topIdBefore];
    return false;
  }
  const fails = noteAiFailedStackResolve(game, topIdBefore);
  if (fails < MAX_FAILED_RESOLVES_BEFORE_FORCE) return false;
  return forceUnstickAiStuckStackTop(io, game, gameId, playerId, topIdBefore);
}

/**
 * When a targeted trigger is already on the stack, skip response scanning and
 * pass so resolve can run. Returns true if the caller should return from priority.
 */
export async function tryPassOnStackedTargetedTrigger(
  io: Server,
  game: any,
  gameId: string,
  playerId: PlayerID,
  executePassPriority: (
    io: Server,
    gameId: string,
    playerId: PlayerID,
    options?: { allowActiveMainPhaseAutoAdvance?: boolean },
  ) => Promise<void>,
): Promise<boolean> {
  const stackArr = Array.isArray(game?.state?.stack) ? game.state.stack : [];
  if (stackArr.length === 0) return false;
  const top = stackArr[stackArr.length - 1];
  const topType = String(top?.type || '');
  const hasTargets = Array.isArray(top?.targets) && top.targets.length > 0;
  if (topType !== 'triggered_ability' || !hasTargets) return false;
  debugWarn(1, '[AI] Stacked targeted trigger — passing without response scan', {
    gameId,
    playerId,
    sourceName: top?.sourceName || top?.card?.name,
  });
  await executePassPriority(io, gameId, playerId);
  return true;
}

/**
 * Call on every AI pass while a stack top remains. Pending-prompt flicker can
 * block all-pass forever; sightings still climb and force a clear.
 */
export async function maybeForceUnstickAfterStackSighting(
  io: Server,
  game: any,
  gameId: string,
  playerId: PlayerID,
): Promise<boolean> {
  if (tryResumeDeferredOracleIrStackSpellForAi(io, game, gameId)) {
    return true;
  }
  const topId = stackTopId(game);
  if (!topId) return false;
  const sightings = ((game.state as any)._aiStuckStackSightingCounts ||= {}) as Record<string, number>;
  sightings[topId] = Number(sightings[topId] || 0) + 1;
  if (sightings[topId] < MAX_STACK_TOP_SIGHTINGS_BEFORE_FORCE) return false;
  return forceUnstickAiStuckStackTop(io, game, gameId, playerId, topId);
}
