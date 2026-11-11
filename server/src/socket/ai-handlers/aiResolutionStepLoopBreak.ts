/**
 * Origin parent: server/src/socket/ai-handlers/aiPriorityHandlers.ts
 *
 * Cluster moved: resolution-step soft-cap / turn-scoped source block that stops
 * Mirko-style library_search recreate loops from freezing END (seq tens of thousands).
 *
 * Public entry symbols: makeAiResolutionStepCapKey, takeAiResolutionStepCapSlot,
 * shouldSoftCapAiAutoResolveStep, isAiBlockedResolutionStep,
 * purgeAiBlockedResolutionSteps, breakAiCappedAutoResolveStep,
 * handleAiPendingResolutionStepWithLoopBreak, unstickAiPassBlockedByCappedPrompts.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { ResolutionQueueManager } from "../../state/resolution/ResolutionQueueManager.js";
import { maybeResumeDeferredOracleIrStackSpellOnGame } from "../../state/modules/oracleIrDeferredStackFinalize.js";
import { advanceStepPersistingEvent } from "../step-advance.js";
import { broadcastGame } from "../util.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { AI_REACTION_DELAY_MS } from "./aiConstants.js";
import { scheduleAIPriority } from "./aiScheduler.js";
import { isAIPlayer } from "./aiPlayerRegistry.js";
import { rememberAIFailedSpellCast } from "./aiLandAuraCommander.js";

const MAX_SAME_PROMPT_PER_TURN = 2;
const MAX_PURGE_ROUNDS = 4;

/** Step types whose STEP_ADDED auto-resolve historically bypassed the priority soft-cap. */
const STEP_ADDED_SOFT_CAP_TYPES = new Set([
  'library_search',
  'graveyard_selection',
  'target_selection',
  'x_value_selection',
]);

export function makeAiResolutionStepCapKey(
  playerId: string,
  turnNumber: number,
  stepType: string,
  sourceKey: string,
): string {
  return `${playerId}:${turnNumber}:${stepType}:${sourceKey}`;
}

function stepSourceKey(step: any): string {
  return String(step?.sourceName || step?.cardName || step?.spellCardId || '');
}

function stepCapKeyFor(game: any, playerId: string, step: any): string {
  const turnNumber = Number((game?.state as any)?.turnNumber || 0);
  return makeAiResolutionStepCapKey(
    playerId,
    turnNumber,
    String(step?.type || ''),
    stepSourceKey(step),
  );
}

/**
 * Shared soft-cap for resolution prompts answered via STEP_ADDED auto-resolve
 * (bypasses handleAiPendingResolutionStepWithLoopBreak) and the priority path.
 * Returns 'block' once this seat has already answered the same source/type
 * MAX_SAME_PROMPT_PER_TURN times this turn (Heliod X / Mirko library_search /
 * Taste of Death target_selection recreate storms).
 *
 * Idempotent per step.id so a STEP_ADDED early-gate and a builder can both call
 * this without double-counting the same prompt instance.
 */
export function takeAiResolutionStepCapSlot(
  game: any,
  playerId: string,
  step: any,
): 'answer' | 'block' {
  if (!game?.state || !step) return 'answer';
  const stepCapKey = stepCapKeyFor(game, playerId, step);
  const stepCounts = ((game.state as any)._aiResolutionStepCounts ||= {}) as Record<string, number>;
  const blockedSources = ((game.state as any)._aiBlockedResolutionSources ||= {}) as Record<string, boolean>;
  if (blockedSources[stepCapKey]) return 'block';

  const stepId = String(step?.id || '').trim();
  const seenIds = ((game.state as any)._aiResolutionCapSeenStepIds ||= {}) as Record<string, true>;
  if (stepId && seenIds[stepId]) {
    return 'answer';
  }
  if (stepId) seenIds[stepId] = true;

  const taken = Number(stepCounts[stepCapKey] || 0);
  if (taken >= MAX_SAME_PROMPT_PER_TURN) {
    blockedSources[stepCapKey] = true;
    return 'block';
  }
  stepCounts[stepCapKey] = taken + 1;
  return 'answer';
}

export function shouldSoftCapAiAutoResolveStep(step: any): boolean {
  return STEP_ADDED_SOFT_CAP_TYPES.has(String(step?.type || ''));
}

export function isAiBlockedResolutionStep(game: any, step: any): boolean {
  if (!game?.state || !step) return false;
  const playerId = String(step.playerId || '');
  if (!playerId) return false;
  const blocked = (game.state as any)._aiBlockedResolutionSources as Record<string, boolean> | undefined;
  if (!blocked) return false;
  return blocked[stepCapKeyFor(game, playerId, step)] === true;
}

function listPendingSteps(gameId: string): any[] {
  try {
    const queue = ResolutionQueueManager.getQueue(gameId);
    return (queue?.steps || []).filter((s: any) =>
      s && String(s?.status || '').toLowerCase() !== 'cancelled'
      && String(s?.status || '').toLowerCase() !== 'completed'
    );
  } catch {
    return [];
  }
}

/** Cancel every pending step whose source was soft-capped for this turn. */
export function purgeAiBlockedResolutionSteps(game: any, gameId: string): number {
  if (!game?.state) return 0;
  let cancelled = 0;
  for (let round = 0; round < MAX_PURGE_ROUNDS; round++) {
    const pending = listPendingSteps(gameId);
    const blocked = pending.filter((s) => isAiBlockedResolutionStep(game, s));
    if (blocked.length === 0) break;
    for (const stuck of blocked) {
      try {
        ResolutionQueueManager.cancelStep(gameId, stuck.id);
        cancelled += 1;
      } catch (err) {
        debugWarn(1, '[AI] Failed to cancel blocked resolution step:', err);
      }
    }
  }
  return cancelled;
}

function isEmptyStackForCapForceAdvance(game: any): boolean {
  const stackLen = Array.isArray(game?.state?.stack) ? game.state.stack.length : 0;
  // Empty-stack only. Formerly limited to beginning/ending; MAIN1 target_selection
  // recreate storms (Taste of Death) need the same force-advance escape.
  return stackLen === 0;
}

function cancelMatchingSourcePrompts(
  gameId: string,
  playerId: string,
  stepType: string,
  sourceKey: string,
): number {
  let cancelled = 0;
  const matching = listPendingSteps(gameId).filter((s: any) =>
    s?.playerId === playerId
    && String(s?.type || '') === stepType
    && stepSourceKey(s) === sourceKey
  );
  for (const stuck of matching) {
    ResolutionQueueManager.cancelStep(gameId, stuck.id);
    cancelled += 1;
  }
  return cancelled;
}

async function forceAdvanceAfterCappedPrompts(
  io: Server,
  game: any,
  gameId: string,
  playerId: PlayerID,
  reason: string,
): Promise<boolean> {
  if (!isEmptyStackForCapForceAdvance(game)) return false;
  // Only force-advance when every remaining prompt is a capped AI source (or none).
  const remaining = listPendingSteps(gameId);
  if (remaining.some((s) => !isAiBlockedResolutionStep(game, s))) return false;
  purgeAiBlockedResolutionSteps(game, gameId);
  if (listPendingSteps(gameId).length > 0) return false;

  debugWarn(1, `[AI] Force-advancing after capped prompt loop (${reason})`, {
    gameId,
    playerId,
    phase: game.state?.phase,
    step: (game.state as any)?.step,
  });
  const advanced = Boolean(advanceStepPersistingEvent(io, game, gameId, {
    playerId,
    reason: 'aiCappedResolutionLoop',
    isAI: true,
  }));
  if (advanced) {
    delete (game.state as any)._autoPassResult;
    broadcastGame(io, game, gameId, { forceStateReplace: true });
  }
  return advanced;
}

/**
 * Soft-stall escape when takeAiResolutionStepCapSlot returns 'block'.
 * Cancels matching prompts (no completeStep), remembers failed casts, purges
 * blocked recreates, force-advances empty-stack phases (incl. MAIN1), and wakes
 * the AI seat.
 */
export async function breakAiCappedAutoResolveStep(
  io: Server,
  game: any,
  gameId: string,
  step: any,
  reason: string = 'auto-resolve-cap',
): Promise<boolean> {
  const playerId = String(step?.playerId || '') as PlayerID;
  const sourceKey = stepSourceKey(step);
  const stepType = String(step?.type || '');
  if (!playerId || !stepType) return false;

  const stepCapKey = stepCapKeyFor(game, playerId, step);
  const blockedSources = ((game.state as any)._aiBlockedResolutionSources ||= {}) as Record<string, boolean>;
  blockedSources[stepCapKey] = true;

  const spellCardId = String(
    (step as any)?.spellCardId || (step as any)?.sourceId || '',
  ).trim();
  if (spellCardId) {
    rememberAIFailedSpellCast(game, playerId, spellCardId);
  }

  debugWarn(1, `[AI] ${reason}`, {
    gameId,
    playerId,
    stepType,
    stepId: step?.id,
    sourceKey,
    spellCardId: spellCardId || null,
  });

  try {
    cancelMatchingSourcePrompts(gameId, playerId, stepType, sourceKey);
    purgeAiBlockedResolutionSteps(game, gameId);
    maybeResumeDeferredOracleIrStackSpellOnGame(game, gameId);
  } catch (capErr) {
    debugWarn(1, '[AI] Cancel of capped auto-resolve step failed:', capErr);
  }

  let advanced = false;
  if (await forceAdvanceAfterCappedPrompts(io, game, gameId, playerId, reason)) {
    advanced = true;
  }

  // Wake priority/turn seat (capped prompt may be off-turn, e.g. Taste of Death).
  const wakeId = String(
    (game.state as any)?.priority || (game.state as any)?.turnPlayer || playerId,
  );
  if (wakeId && isAIPlayer(gameId, wakeId)) {
    scheduleAIPriority(io, gameId, wakeId, AI_REACTION_DELAY_MS);
  } else if (playerId !== wakeId && isAIPlayer(gameId, playerId)) {
    scheduleAIPriority(io, gameId, playerId, AI_REACTION_DELAY_MS);
  }
  return advanced;
}

/**
 * Resolve-or-break a pending resolution step for this AI seat.
 * Returns true when the caller should return from handleAIPriority (follow-up already
 * scheduled, or the loop was broken without a reschedule).
 */
export async function handleAiPendingResolutionStepWithLoopBreak(
  io: Server,
  game: any,
  gameId: string,
  playerId: PlayerID,
  aiStep: any,
  handleAIResolutionStep: (
    io: Server,
    gameId: string,
    playerId: PlayerID,
    step: any,
  ) => Promise<void>,
  executePassPriority: (
    io: Server,
    gameId: string,
    playerId: PlayerID,
    options?: { allowActiveMainPhaseAutoAdvance?: boolean },
  ) => Promise<void>,
): Promise<boolean> {
  const stepCapKey = stepCapKeyFor(game, playerId, aiStep);
  const stepCounts = ((game.state as any)._aiResolutionStepCounts ||= {}) as Record<string, number>;
  const taken = Number(stepCounts[stepCapKey] || 0);

  if (takeAiResolutionStepCapSlot(game, playerId, aiStep) === 'block') {
    await breakAiCappedAutoResolveStep(
      io,
      game,
      gameId,
      aiStep,
      'Resolution-step cap reached; blocking source for this turn',
    );
    if (game.state.priority === playerId) {
      await executePassPriority(io, gameId, playerId, { allowActiveMainPhaseAutoAdvance: true });
    }
    return true;
  }

  debug(1, '[AI] AI player has pending resolution steps, resolving before priority:', {
    gameId,
    playerId,
    stepType: aiStep.type,
    stepId: aiStep.id,
    taken,
  });
  await handleAIResolutionStep(io, gameId, playerId, aiStep);
  scheduleAIPriority(io, gameId, playerId, AI_REACTION_DELAY_MS);
  return true;
}

/**
 * passPriority returned changed:false because a capped prompt is still open.
 * Purge blocked prompts and optionally force-advance quiet phases so seats stop
 * re-waking each other forever.
 *
 * @returns true if the caller should return without the normal pending-player wake.
 */
export async function unstickAiPassBlockedByCappedPrompts(
  io: Server,
  game: any,
  gameId: string,
  playerId: PlayerID,
): Promise<boolean> {
  const before = listPendingSteps(gameId);
  if (before.length === 0) return false;

  const anyBlocked = before.some((s) => isAiBlockedResolutionStep(game, s));
  if (!anyBlocked) return false;

  const purged = purgeAiBlockedResolutionSteps(game, gameId);
  debug(1, '[AI] Purged blocked resolution steps after changed:false pass', {
    gameId,
    playerId,
    purged,
    remaining: listPendingSteps(gameId).length,
  });

  if (await forceAdvanceAfterCappedPrompts(io, game, gameId, playerId, 'pass-changed-false')) {
    const nextPriority = (game.state as any)?.priority;
    if (nextPriority && isAIPlayer(gameId, nextPriority)) {
      scheduleAIPriority(io, gameId, nextPriority, AI_REACTION_DELAY_MS);
    }
    return true;
  }

  // If only blocked sources remain (or none), do not wake the capped seat again.
  const remaining = listPendingSteps(gameId);
  if (remaining.length === 0 || remaining.every((s) => isAiBlockedResolutionStep(game, s))) {
    purgeAiBlockedResolutionSteps(game, gameId);
    return true;
  }
  return false;
}
