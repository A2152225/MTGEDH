/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: AIEngine singleton, per-game AI player map, scheduled
 * gameFlow/priority timers, pending-spell-cast status, and runExclusiveAIAction.
 *
 * Public entry symbols: aiEngine, aiPlayers, aiActionsInProgress, getAIActionKey,
 * clearScheduledAIAction, clearScheduledAIActionsForGame, scheduleAIGameFlow,
 * scheduleAIPriority, getAIPendingSpellCastStatus, runExclusiveAIAction.
 */
import type { Server } from "socket.io";
import { AIEngine, type AIPlayerConfig } from "../../../../rules-engine/src/AIEngine.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { ResolutionQueueManager } from "../../state/resolution/ResolutionQueueManager.js";
import { debug, debugError } from "../../utils/debug.js";
import { getAIHandlerDeps } from "../aiHandlerDeps.js";
import { AI_REACTION_DELAY_MS } from "./aiConstants.js";

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
    const { handleAIGameFlow, handleAIPriority } = getAIHandlerDeps();
    const invoke = kind === 'gameFlow' ? handleAIGameFlow : handleAIPriority;
    void invoke(io, gameId, playerId).catch((err) => debugError(1, err));
  }, Math.max(0, delayMs));

  aiScheduledActions.set(key, {
    kind,
    timer,
    runAt,
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

export async function runExclusiveAIAction(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  kind: AIScheduledActionKind,
  action: () => Promise<void>,
): Promise<void> {
  const key = getAIActionKey(gameId, playerId);
  if (aiActionsInProgress.has(key)) {
    debug(2, `[AI] ${kind} already in progress, scheduling follow-up`, { gameId, playerId });
    scheduleAIActionInternal(io, gameId, playerId, kind, 25);
    return;
  }

  aiActionsInProgress.add(key);
  try {
    await action();
  } finally {
    aiActionsInProgress.delete(key);
  }
}
