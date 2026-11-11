/**
 * Origin parent: server/src/socket/ai-handlers/aiPriorityHandlers.ts
 * Cluster: cleanup-step AI actions (Rule 514.1 auto-advance + Rule 514.3 stack resolve).
 * Public: tryHandleAiCleanupStep.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { ResolutionQueueManager } from "../../state/resolution/ResolutionQueueManager.js";
import { debug } from "../../utils/debug.js";
import { executeAdvanceStep } from "./aiAdvanceAndDecisionExecutors.js";

type CleanupPassPriority = (
  io: Server,
  gameId: string,
  playerId: PlayerID,
  options?: { allowActiveMainPhaseAutoAdvance?: boolean },
) => Promise<void>;

type CleanupResolveStep = (
  io: Server,
  gameId: string,
  playerId: PlayerID,
  step: any,
) => Promise<void>;

/**
 * Returns true when cleanup was fully handled (caller should return from priority).
 */
export async function tryHandleAiCleanupStep(
  io: Server,
  game: any,
  gameId: string,
  playerId: PlayerID,
  opts: {
    isAITurn: boolean;
    hasPriority: boolean;
    handleAIResolutionStep: CleanupResolveStep;
    executePassPriority: CleanupPassPriority;
  },
): Promise<boolean> {
  const step = String((game?.state as any)?.step || '').toLowerCase();
  if (!(step.includes('cleanup') || step === 'cleanup')) return false;

  debug(1, '[AI] Cleanup step - handling automatic cleanup actions (Rule 514.1)');
  const stackLen = Array.isArray(game.state?.stack) ? game.state.stack.length : 0;
  const { isAITurn, hasPriority, handleAIResolutionStep, executePassPriority } = opts;

  if (isAITurn) {
    const processingCleanup = (game.state as any)._aiProcessingCleanup?.[playerId];
    if (processingCleanup) {
      debug(1, '[AI] Cleanup step - already processing cleanup for this AI, skipping to prevent double-execution');
      return true;
    }

    (game.state as any)._aiProcessingCleanup = (game.state as any)._aiProcessingCleanup || {};
    (game.state as any)._aiProcessingCleanup[playerId] = true;

    try {
      const queue = ResolutionQueueManager.getQueue(gameId);
      const aiStep = queue?.steps?.find((s: any) => s?.playerId === playerId);
      if (aiStep) {
        debug(1, `[AI] Cleanup step - resolving queued step: ${aiStep.type}`);
        await handleAIResolutionStep(io, gameId, playerId, aiStep);
        if ((game.state as any)._aiProcessingCleanup) {
          delete (game.state as any)._aiProcessingCleanup[playerId];
        }
        return true;
      }
    } catch {
      // Best-effort only
    }

    if (stackLen > 0) {
      if (!game.state.priority) {
        game.state.priority = game.state.turnPlayer || playerId;
        (game.state as any).priorityPassedBy = new Set();
      }
      debug(1, '[AI] Cleanup step - stack non-empty (Rule 514.3); passing to resolve', {
        stackLen,
        priority: game.state.priority,
      });
      if ((game.state as any)._aiProcessingCleanup) {
        delete (game.state as any)._aiProcessingCleanup[playerId];
      }
      await executePassPriority(io, gameId, playerId);
      return true;
    }

    debug(1, '[AI] Cleanup step - no discard needed, auto-advancing');
    await executeAdvanceStep(io, gameId, playerId);
    if ((game.state as any)._aiProcessingCleanup) {
      delete (game.state as any)._aiProcessingCleanup[playerId];
    }
    return true;
  }

  // After 514.3 stack resolution, priority can be left on a non-turn seat while the
  // stack is empty. That seat used to skip cleanup, so the turn never advanced.
  if (hasPriority) {
    if (stackLen > 0) {
      debug(1, '[AI] Cleanup step - off-turn but has 514.3 priority; passing');
      await executePassPriority(io, gameId, playerId);
      return true;
    }
    debug(1, '[AI] Cleanup step - off-turn priority with empty stack; advancing');
    await executeAdvanceStep(io, gameId, playerId);
    return true;
  }

  debug(1, '[AI] Cleanup step - not AI turn, skipping');
  return true;
}
