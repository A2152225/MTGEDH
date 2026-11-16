/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: executePassPriority, executeDeclareAttackers, executeDeclareBlockers.
 *
 * Public entry symbols: executePassPriority, executeDeclareAttackers, executeDeclareBlockers.
 */
import { trimAssignmentsToMaximumBlockers } from "../combat-handlers/combatBatch30BlockLimits.js"; // B31
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { appendEvent } from "../../db/index.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import { isGameReplayLocked } from "../../gameRestoreState.js";
import { persistAndResolveTopOfStack, ensureGame, broadcastGame } from "../util.js";
import { runPostResolutionPermanentPromptChecks } from "../game-actions.js";
import { captureIdenticalTriggerRun, continueCapturedIdenticalTriggerRun } from "../identicalTriggerBulkResolve.js";
import { advanceStepPersistingEvent } from "../step-advance.js";
import { executeDeclareAttackers as executeCombatDeclareAttackers } from "../combat.js";
import { isCurrentlyCreature } from "../combat-handlers/combatLegalityGates.js";
import {
  findMustBeBlockedIfAbleViolation,
  resolveMustBeBlockedIfAbleAssignments,
} from "../combat-handlers/combatMustBeBlockedIfAble.js";
import {
  resolveForcedAttackerDeclarations,
} from "../combat-handlers/combatDeclareAttackersForceTapSupport.js";
import { collectMaxBlockersEachCombat } from "../../state/modules/staticEffectSpecAttackYouTax.js";
import { applyAIDeclareBlockersBlockTax } from "./aiPriorityPassCombatBlockTax.js";
import { ResolutionQueueManager } from "../../state/resolution/ResolutionQueueManager.js";
import { AI_REACTION_DELAY_MS } from "./aiConstants.js";
import { scheduleAIPriority } from "./aiScheduler.js";
import { isAIPlayer } from "./aiPlayerRegistry.js";
import { checkPendingModals } from "./aiGameCleanupHandlers.js";
import { unstickAiPassBlockedByCappedPrompts } from "./aiResolutionStepLoopBreak.js";
import {
  maybeForceUnstickAfterFailedResolve,
  maybeForceUnstickAfterStackSighting,
  tryResumeDeferredOracleIrStackSpellForAi,
} from "./aiStuckStackUnstick.js";

/**
 * Execute pass priority for AI
 */
export async function executePassPriority(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  options?: { allowActiveMainPhaseAutoAdvance?: boolean },
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  if (isGameReplayLocked(game, gameId)) {
    debug(2, '[AI] executePassPriority skipped during undo/restore replay', { gameId, playerId });
    return;
  }

  debug(1, '[AI] Passing priority:', { gameId, playerId });
  
  try {
    // Deferred IR spells (oracleIrDeferredFinalize) sit on the stack until the
    // choice queue empties. Cap/cancel can clear the queue without resume — unstick
    // Sylvan Offering-style MAIN1 loops before another pass round.
    if (tryResumeDeferredOracleIrStackSpellForAi(io, game, gameId)) {
      return;
    }

    let resolvedNow = false;
    let advanceStep = false;
    let changed = true;
    
    // Use game's pass priority method if available
    // Mark as auto-pass so that autoPassLoop runs and checks if other players can also auto-pass
    if (typeof (game as any).passPriority === 'function') {
      const result = (game as any).passPriority(playerId, true, options); // true = isAutoPass
      resolvedNow = result?.resolvedNow ?? false;
      advanceStep = result?.advanceStep ?? false;
      changed = result?.changed !== false;
    } else {
      // Fallback: advance priority manually
      const state = game.state;
      if (state && Array.isArray(state.players)) {
        const order = state.players.map((p: any) => p.id);
        const idx = order.indexOf(playerId);
        if (idx >= 0) {
          const nextPriority = order[(idx + 1) % order.length];
          (state as any).priority = nextPriority;
        }
      }
    }

    // Pass blocked (pending prompt / wrong priority): do not append another passPriority
    // event or keep scheduling a pass spin. Wake the seat that still has a prompt —
    // unless the only open prompts are AI soft-capped sources (Mirko END recreate),
    // which must be purged / force-advanced instead of re-waking forever.
    if (!changed) {
      debug(1, '[AI] passPriority made no change; skipping event/schedule spin', { gameId, playerId });
      try {
        if (await unstickAiPassBlockedByCappedPrompts(io, game, gameId, playerId)) {
          return;
        }
        if (await maybeForceUnstickAfterStackSighting(io, game, gameId, playerId)) {
          return;
        }
        const summary = ResolutionQueueManager.getPendingSummary(gameId);
        const pendingPlayer = Object.keys(summary?.pendingByPlayer || {}).find(
          (pid) => Number(summary.pendingByPlayer[pid] || 0) > 0,
        );
        if (pendingPlayer && isAIPlayer(gameId, pendingPlayer as PlayerID)) {
          scheduleAIPriority(io, gameId, pendingPlayer as PlayerID, AI_REACTION_DELAY_MS);
        } else if (game.state?.priority && isAIPlayer(gameId, game.state.priority)) {
          scheduleAIPriority(io, gameId, game.state.priority, AI_REACTION_DELAY_MS);
        }
      } catch (err) {
        debugWarn(1, '[AI] Failed to re-wake AI after blocked pass:', err);
      }
      return;
    }
    
    // Persist event
    try {
      await appendEvent(gameId, (game as any).seq || 0, 'passPriority', { playerId });
    } catch (e) {
      debugWarn(1, '[AI] Failed to persist passPriority event:', e);
    }

    // Same stack top across many passes (often deferred IR + flickering prompts).
    if (await maybeForceUnstickAfterStackSighting(io, game, gameId, playerId)) {
      return;
    }
    
    // If all players passed priority in succession, resolve the top of the stack
    if (resolvedNow) {
      debug(1, '[AI] All players passed priority, resolving top of stack');
      const stackBefore = Array.isArray(game.state?.stack) ? game.state.stack : [];
      const topIdBefore = stackBefore.length > 0
        ? String(stackBefore[stackBefore.length - 1]?.id || '').trim()
        : '';
      const identicalRun = captureIdenticalTriggerRun(game);
      if (persistAndResolveTopOfStack(game, gameId, { playerId })) {
        runPostResolutionPermanentPromptChecks(io, game, gameId);
        // The AI just chose to pass on this instance; carry that over to the identical rest.
        await continueCapturedIdenticalTriggerRun(io, game, gameId, identicalRun, undefined, String(playerId));
        debug(2, `[AI] Stack resolved for game ${gameId}`);
      }
      if (maybeForceUnstickAfterFailedResolve(io, game, gameId, playerId, topIdBefore)) {
        return;
      }
      // Choice queue may have emptied during resolve without finalize — try resume.
      if (tryResumeDeferredOracleIrStackSpellForAi(io, game, gameId)) {
        return;
      }
    }
    
    // If all players passed priority with empty stack, advance to next step
    // BUT: Do NOT advance if there are pending modals (e.g., library searches, color choices, creature type selections, Join Forces)
    // Human players need time to complete their modal interactions
    if (advanceStep) {
      const pendingCheck = checkPendingModals(game, gameId);
      if (pendingCheck.hasPending) {
        debug(1, `[AI] Cannot advance step - ${pendingCheck.reason}`);
      } else {
        debug(1, '[AI] All players passed priority with empty stack, advancing step');
        if (advanceStepPersistingEvent(io, game as any, gameId, { playerId, reason: 'allPlayersPassed' })) {
          debug(2, `[AI] Advanced to next step for game ${gameId}`);

          // Let the normal broadcast-driven AI/auto-pass flow handle any
          // later progression after this step settles.
          delete (game.state as any)._autoPassResult;
        }
      }
    }
    
    // Broadcast updated state. forceStateReplace so a client that already
    // accepted a higher seq still takes the AI pass / stack result.
    broadcastGame(io, game, gameId, { forceStateReplace: true });
    
    // Check if next player is also AI
    const nextPriority = (game.state as any)?.priority;
    if (nextPriority && isAIPlayer(gameId, nextPriority)) {
      // Small delay before AI acts
      scheduleAIPriority(io, gameId, nextPriority, AI_REACTION_DELAY_MS);
    }
    
  } catch (error) {
    debugError(1, '[AI] Error passing priority:', error);
  }
}

async function submitAIAttackerDeclarations(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  attackers: Array<{ creatureId: string; defendingPlayerId: string }>,
): Promise<void> {
  await executeCombatDeclareAttackers(
    io,
    gameId,
    playerId,
    attackers.map((attacker) => ({
      creatureId: attacker.creatureId,
      targetPlayerId: attacker.defendingPlayerId,
    })),
  );
  await executePassPriority(io, gameId, playerId);
}

/**
 * Execute declare attackers for AI.
 * Always prefer advancing the step: a rejected plan must fall back to forced-only
 * (goad / must-attack), never silent-return while holding priority (DECLARE_ATTACKERS
 * seq-freeze stalls under v2's wider attack sets + Crawlspace-style caps).
 */
export async function executeDeclareAttackers(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  attackers: Array<{ creatureId: string; defendingPlayerId: string }>
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;

  const forced = resolveForcedAttackerDeclarations(game, playerId);
  const forcedIds = new Set(forced.map((attacker) => attacker.creatureId));
  const seen = new Set<string>();
  const merged: Array<{ creatureId: string; defendingPlayerId: string }> = [];
  for (const attacker of forced) {
    if (seen.has(attacker.creatureId)) continue;
    seen.add(attacker.creatureId);
    merged.push(attacker);
  }
  for (const attacker of attackers) {
    if (!attacker?.creatureId || seen.has(attacker.creatureId)) continue;
    seen.add(attacker.creatureId);
    merged.push(attacker);
  }

  const battlefield = game.state?.battlefield || [];
  const dropped: string[] = [];
  // Never drop forced attackers — filtering them out caused GOAD_MUST_ATTACK after
  // a "safe" empty retry, then a silent return that froze DECLARE_ATTACKERS.
  const legal = merged.filter((attacker) => {
    if (forcedIds.has(attacker.creatureId)) return true;
    const perm = battlefield.find((entry: any) => entry?.id === attacker.creatureId && entry?.controller === playerId);
    if (perm && isCurrentlyCreature(perm, battlefield, playerId)) return true;
    dropped.push(attacker.creatureId);
    return false;
  });
  if (dropped.length > 0) {
    debugWarn(1, '[AI] Dropped attackers the server does not treat as creatures', {
      gameId,
      playerId,
      dropped,
    });
  }
  
  debug(1, '[AI] Declaring attackers:', { gameId, playerId, attackers: legal });
  
  const tryDeclare = async (
    next: Array<{ creatureId: string; defendingPlayerId: string }>,
    label: string,
  ): Promise<boolean> => {
    try {
      await submitAIAttackerDeclarations(io, gameId, playerId, next);
      return true;
    } catch (err) {
      debugWarn(1, `[AI] Attack declaration failed (${label})`, {
        gameId,
        playerId,
        code: String((err as any)?.code || ''),
        count: next.length,
      });
      return false;
    }
  };

  if (await tryDeclare(legal, 'planned')) return;

  // Cap / legality rejects (TOO_MANY_ATTACKERS, bad targets, …): shrink toward forced-only,
  // then toward empty. Never silent-return — that froze DECLARE_ATTACKERS (seq stagnant).
  debugWarn(1, '[AI] Attack plan rejected; shrinking toward forced-only/empty', {
    gameId,
    playerId,
    forcedCount: forced.length,
    plannedCount: legal.length,
  });

  const candidates: Array<Array<{ creatureId: string; defendingPlayerId: string }>> = [];
  const plannedIsForcedOnly =
    legal.length === forced.length
    && legal.every((a, i) => a.creatureId === forced[i]?.creatureId);
  if (forced.length > 0 && !plannedIsForcedOnly) candidates.push(forced);
  for (let n = forced.length - 1; n >= 1; n--) {
    candidates.push(forced.slice(0, n));
  }
  candidates.push([]);

  for (const candidate of candidates) {
    if (await tryDeclare(candidate, `fallback-${candidate.length}`)) return;
  }

  // Last resort: mark the seat declared and pass so the combat step can advance.
  // Prefer a soft rules break over a permanent DECLARE_ATTACKERS soft-lock.
  debugError(1, '[AI] All attack declare fallbacks failed; force-marking attackersDeclaredBy', {
    gameId,
    playerId,
  });
  try {
    const stateAny = game.state as any;
    stateAny.attackersDeclaredBy = Array.isArray(stateAny.attackersDeclaredBy)
      ? stateAny.attackersDeclaredBy
      : [];
    if (!stateAny.attackersDeclaredBy.includes(playerId)) {
      stateAny.attackersDeclaredBy.push(playerId);
    }
    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    broadcastGame(io, game, gameId);
    await executePassPriority(io, gameId, playerId);
  } catch (unstickErr) {
    debugError(1, '[AI] Force-mark declare attackers unstick failed; rescheduling', unstickErr);
    scheduleAIPriority(io, gameId, playerId, AI_REACTION_DELAY_MS);
  }
}

/**
 * Execute declare blockers for AI
 */
export async function executeDeclareBlockers(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  blockers: Array<{ blockerId: string; attackerId: string }>
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  
  debug(1, '[AI] Declaring blockers:', { gameId, playerId, blockers });
  
  try {
    const battlefield = game.state?.battlefield || [];
    const state = game.state as any;
    let assignments = Array.isArray(blockers) ? blockers : [];
    assignments = trimAssignmentsToMaximumBlockers(battlefield as any[], assignments); // B31 max blockers
    if (findMustBeBlockedIfAbleViolation({
      state,
      defendingPlayerId: playerId,
      assignments,
    })) {
      assignments = resolveMustBeBlockedIfAbleAssignments({
        state,
        defendingPlayerId: playerId,
        assignments,
      });
    }
    const mustBlockViolation = findMustBeBlockedIfAbleViolation({
      state,
      defendingPlayerId: playerId,
      assignments,
    });
    if (mustBlockViolation) {
      debugWarn(1, '[AI] Refusing declare blockers that leaves a must-be-blocked-if-able attacker unblocked:', {
        gameId,
        playerId,
        attackerIds: mustBlockViolation.attackerIds,
      });
      return;
    }

    const uniqueBlockerIds: string[] = [];
    const seenBlockerIds = new Set<string>();
    for (const assignment of assignments) {
      const blockerId = String(assignment?.blockerId || '').trim();
      if (!blockerId || seenBlockerIds.has(blockerId)) continue;
      seenBlockerIds.add(blockerId);
      uniqueBlockerIds.push(blockerId);
    }
    const globalBlockCap = collectMaxBlockersEachCombat(state);
    if (globalBlockCap.max != null && uniqueBlockerIds.length > globalBlockCap.max) {
      const keep = new Set(uniqueBlockerIds.slice(0, globalBlockCap.max));
      assignments = assignments.filter((assignment) =>
        keep.has(String(assignment?.blockerId || '').trim()),
      );
      const afterCapViolation = findMustBeBlockedIfAbleViolation({
        state,
        defendingPlayerId: playerId,
        assignments,
      });
      if (afterCapViolation) {
        debugWarn(1, '[AI] Refusing declare blockers that leaves a must-be-blocked-if-able attacker unblocked:', {
          gameId,
          playerId,
          attackerIds: afterCapViolation.attackerIds,
        });
        return;
      }
    }

    const taxResult = applyAIDeclareBlockersBlockTax({
      io,
      game,
      gameId,
      playerId,
      assignments,
    });
    if (!taxResult.ok) {
      return;
    }
    assignments = taxResult.assignments;

    // Apply blocker assignments to permanents
    for (const blocker of assignments) {
      const blockerCreature = battlefield.find((perm: any) => perm.id === blocker.blockerId);
      const attackerCreature = battlefield.find((perm: any) => perm.id === blocker.attackerId);
      
      if (blockerCreature && attackerCreature) {
        // Mark the blocker as blocking
        (blockerCreature as any).blocking = (blockerCreature as any).blocking || [];
        (blockerCreature as any).blocking.push(blocker.attackerId);

        // Mark the attacker as being blocked
        (attackerCreature as any).blockedBy = (attackerCreature as any).blockedBy || [];
        (attackerCreature as any).blockedBy.push(blocker.blockerId);
      }
    }
    
    // Mark that blockers have been declared for this player
    // This is CRITICAL to prevent infinite loop in checkPendingInteractions
    state.blockersDeclaredBy = state.blockersDeclaredBy || [];
    if (!state.blockersDeclaredBy.includes(playerId)) {
      state.blockersDeclaredBy.push(playerId);
      debug(1, `[AI] Marked blockers as declared for ${playerId}`);
    }
    {
      const { queueParsedAttacksUnblockedTriggersOnce } = await import("../../state/modules/triggers/combatBlockedIrTriggers.js");
      queueParsedAttacksUnblockedTriggersOnce(game as any, String(playerId), gameId);
    }
    
    // Call game method if it exists (for compatibility)
    if (typeof (game as any).declareBlockers === 'function') {
      (game as any).declareBlockers(playerId, assignments);
    }
    
    // Bump sequence number
    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    
    await appendEvent(gameId, (game as any).seq || 0, 'declareBlockers', { playerId, blockers: assignments });
    
    // Broadcast the blocker count
    const blockerCount = assignments.length;
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `AI declares ${blockerCount} blocker${blockerCount !== 1 ? "s" : ""}.`,
      ts: Date.now(),
    });
    
    broadcastGame(io, game, gameId);
    
    // After declaring blockers, pass priority to allow responses
    // (cast instants, activate abilities before combat damage)
    // The step will advance when all players pass priority in succession
    await executePassPriority(io, gameId, playerId);
    
  } catch (error) {
    debugError(1, '[AI] Error declaring blockers:', error);
    const state = game.state as any;
    const mustBlockViolation = findMustBeBlockedIfAbleViolation({
      state,
      defendingPlayerId: playerId,
      assignments: [],
    });
    // Stamp only when an empty declare would be legal. A lure leftover must
    // not be marked declared after an unexpected error.
    if (!mustBlockViolation) {
      state.blockersDeclaredBy = state.blockersDeclaredBy || [];
      if (!state.blockersDeclaredBy.includes(playerId)) {
        state.blockersDeclaredBy.push(playerId);
      }
    }
    await executePassPriority(io, gameId, playerId);
  }
}
