/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: AIEngine singleton, per-game AI player map, scheduled
 * gameFlow/priority timers, pending-spell-cast status, and runExclusiveAIAction.
 *
 * Public entry symbols: aiEngine, aiPlayers, aiActionsInProgress, getAIActionKey,
 * clearScheduledAIAction, clearScheduledAIActionsForGame, scheduleAIGameFlow,
 * scheduleAIPriority, getAIPendingSpellCastStatus, runExclusiveAIAction,
 * resetAIActionLocksForTests, getAIActionGenerationForTests.
 */
import type { Server } from "socket.io";
import { clearTimeout as nodeClearTimeout, setTimeout as nodeSetTimeout } from "node:timers";
import { AIEngine, type AIPlayerConfig } from "../../../../rules-engine/src/AIEngine.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { ResolutionQueueManager } from "../../state/resolution/ResolutionQueueManager.js";
import { isGameRestoring } from "../../gameRestoreState.js";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import { getAIHandlerDeps } from "../aiHandlerDeps.js";
import { AI_EXCLUSIVE_ACTION_TIMEOUT_MS, AI_REACTION_DELAY_MS } from "./aiConstants.js";
import { noteGameStallAiFailure, observeGameStallAiActionById } from "../../state/modules/gameStall/gameStallDetector.js";

// Singleton AI Engine instance
export const aiEngine = new AIEngine();

// Track AI players per game
export const aiPlayers = new Map<string, Map<PlayerID, AIPlayerConfig>>();

type AIScheduledActionKind = 'gameFlow' | 'priority';

type AIScheduledAction = {
  kind: AIScheduledActionKind;
  timer: ReturnType<typeof setTimeout>;
  runAt: number;
};

const aiScheduledActions = new Map<string, AIScheduledAction>();
export const aiActionsInProgress = new Set<string>();

export function getAIActionKey(gameId: string, playerId: PlayerID): string {
  return `${gameId}:${String(playerId)}`;
}

export function clearScheduledAIAction(gameId: string, playerId: PlayerID): void {
  const key = getAIActionKey(gameId, playerId);
  const existing = aiScheduledActions.get(key);
  if (existing) {
    clearTimeout(existing.timer);
    aiScheduledActions.delete(key);
  }
}

export function clearScheduledAIActionsForGame(gameId: string): void {
  for (const [key, existing] of aiScheduledActions.entries()) {
    if (!key.startsWith(`${gameId}:`)) continue;
    clearTimeout(existing.timer);
    aiScheduledActions.delete(key);
  }
}

function scheduleAIActionInternal(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  kind: AIScheduledActionKind,
  delayMs: number,
): void {
  if (isGameRestoring(gameId)) return;
  const key = getAIActionKey(gameId, playerId);
  const runAt = Date.now() + Math.max(0, delayMs);
  const existing = aiScheduledActions.get(key);

  if (existing && existing.runAt <= runAt) {
    return;
  }

  if (existing) {
    clearTimeout(existing.timer);
  }

  const timer = setTimeout(() => {
    aiScheduledActions.delete(key);
    if (isGameRestoring(gameId)) return;
    const { handleAIGameFlow, handleAIPriority } = getAIHandlerDeps();
    const invoke = kind === 'gameFlow' ? handleAIGameFlow : handleAIPriority;
    void invoke(io, gameId, playerId).catch((err) => debugError(1, err));
  }, Math.max(0, delayMs));

  aiScheduledActions.set(key, {
    kind,
    timer,
    runAt,
  });

  if (kind === 'priority' && delayMs > 0) {
    requestAIFastPassPrecheck(io, gameId, playerId);
  }
}

const fastPassPrechecksInFlight = new Set<string>();

/**
 * Pacing applies only before real actions. If the AI holding priority would just pass, pull its
 * scheduled priority run forward to 0ms. Runs on setImmediate (never synchronously) so a chain
 * of AIs passing in a row stays a sequence of short event-loop turns, not a deep call stack.
 */
function requestAIFastPassPrecheck(io: Server, gameId: string, playerId: PlayerID): void {
  const key = getAIActionKey(gameId, playerId);
  if (fastPassPrechecksInFlight.has(key)) return;
  fastPassPrechecksInFlight.add(key);
  setImmediate(() => {
    void (async () => {
      try {
        const pending = aiScheduledActions.get(key);
        if (!pending || pending.kind !== 'priority' || pending.runAt <= Date.now()) return;
        if (aiActionsInProgress.has(key) || isGameRestoring(gameId)) return;
        const { aiPriorityWillPass } = await import("./aiFastPassPrecheck.js");
        if (!(await aiPriorityWillPass(gameId, playerId))) return;
        const still = aiScheduledActions.get(key);
        if (!still || still.kind !== 'priority') return;
        debug(2, '[AI] fast pass: no action to take, running priority without pacing delay', { gameId, playerId });
        scheduleAIActionInternal(io, gameId, playerId, 'priority', 0);
      } catch (err) {
        debugWarn(2, '[AI] fast-pass precheck errored; keeping normal pacing', err);
      } finally {
        fastPassPrechecksInFlight.delete(key);
      }
    })();
  });
}

export function scheduleAIGameFlow(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  delayMs: number = AI_REACTION_DELAY_MS,
): void {
  scheduleAIActionInternal(io, gameId, playerId, 'gameFlow', delayMs);
}

export function scheduleAIPriority(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  delayMs: number = AI_REACTION_DELAY_MS,
): void {
  scheduleAIActionInternal(io, gameId, playerId, 'priority', delayMs);
}

export function getAIPendingSpellCastStatus(gameId: string, game: any, playerId: PlayerID): {
  effectIds: string[];
  trackedEffectIds: string[];
  orphanedEffectIds: string[];
} {
  const pendingSpellCasts = (game?.state as any)?.pendingSpellCasts || {};
  const effectIds = Object.keys(pendingSpellCasts).filter(
    (effectId) => pendingSpellCasts[effectId]?.playerId === playerId,
  );

  if (effectIds.length === 0) {
    return {
      effectIds: [],
      trackedEffectIds: [],
      orphanedEffectIds: [],
    };
  }

  const queue = ResolutionQueueManager.getQueue(gameId);
  const queueSteps = Array.isArray(queue?.steps) ? queue.steps : [];
  const pendingTargets = ((game?.state as any)?.pendingTargets || {}) as Record<string, unknown>;

  const trackedEffectIds = effectIds.filter((effectId) => {
    if (pendingTargets[effectId]) {
      return true;
    }

    return queueSteps.some((step: any) =>
      String(step?.effectId || '') === effectId ||
      String(step?.sourceId || '') === effectId ||
      String(step?.spellCastContext?.effectId || '') === effectId,
    );
  });

  return {
    effectIds,
    trackedEffectIds,
    orphanedEffectIds: effectIds.filter((effectId) => !trackedEffectIds.includes(effectId)),
  };
}

/** Per-seat generation so a timed-out action cannot clear a newer seat's in-progress lock. */
const aiActionGenerations = new Map<string, number>();

export function getAIActionGenerationForTests(gameId: string, playerId: PlayerID): number {
  return aiActionGenerations.get(getAIActionKey(gameId, playerId)) || 0;
}

export function resetAIActionLocksForTests(): void {
  aiActionsInProgress.clear();
  aiActionGenerations.clear();
}

export async function runExclusiveAIAction(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  kind: AIScheduledActionKind,
  action: () => Promise<void>,
  options?: { readonly timeoutMs?: number },
): Promise<void> {
  const key = getAIActionKey(gameId, playerId);
  if (aiActionsInProgress.has(key)) {
    debug(2, `[AI] ${kind} already in progress, scheduling follow-up`, { gameId, playerId });
    scheduleAIActionInternal(io, gameId, playerId, kind, 25);
    return;
  }

  const generation = (aiActionGenerations.get(key) || 0) + 1;
  aiActionGenerations.set(key, generation);
  aiActionsInProgress.add(key);
  let aiActionError: unknown;
  let timedOut = false;
  const timeoutMs = Math.max(
    1_000,
    Number(options?.timeoutMs ?? AI_EXCLUSIVE_ACTION_TIMEOUT_MS) || AI_EXCLUSIVE_ACTION_TIMEOUT_MS,
  );

  // Use node:timers (not globalThis.setTimeout) so vitest spies that stub the global
  // for AI scheduling drains cannot instantly fire this hang-safety timeout.
  let timeoutHandle: ReturnType<typeof nodeSetTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = nodeSetTimeout(() => {
      timedOut = true;
      reject(new Error(`AI ${kind} action timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timeoutHandle.unref?.();
  });

  try {
    await Promise.race([action(), timeoutPromise]);
  } catch (err) {
    aiActionError = err;
    if (timedOut) {
      // Invalidate this generation so a late-finishing action cannot clear a newer lock.
      aiActionGenerations.set(key, generation + 1);
      aiActionsInProgress.delete(key);
      debugWarn(1, `[AI] ${kind} exclusive action timed out; releasing lock and bailing`, {
        gameId,
        playerId,
        timeoutMs,
      });
      noteGameStallAiFailure(gameId, playerId, err, `runExclusiveAIAction:${kind}:timeout`);
      try {
        // Dynamic import avoids a static cycle with aiPriorityPassCombatExecutors -> aiScheduler.
        const passMod = await import("./aiPriorityPassCombatExecutors.js");
        await passMod.executePassPriority(io, gameId, playerId, { allowActiveMainPhaseAutoAdvance: true });
      } catch (passErr) {
        debugWarn(1, '[AI] Timeout bail pass failed; scheduling priority follow-up', passErr);
        scheduleAIActionInternal(io, gameId, playerId, kind, 25);
      }
    } else {
      throw err;
    }
  } finally {
    if (timeoutHandle) nodeClearTimeout(timeoutHandle);
    if (aiActionGenerations.get(key) === generation) {
      aiActionsInProgress.delete(key);
    }
    // Game-stall detector: one observation per AI action (see state/modules/gameStall).
    observeGameStallAiActionById(gameId, String(playerId), kind, aiActionError);
  }
}
