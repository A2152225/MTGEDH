/**
 * Origin parent: server/src/socket/ai-handlers/aiPriorityHandlers.ts
 *
 * Cluster moved: token-swarm / huge-battlefield priority short-circuit used by
 * handleAIPriority so response enumeration and combat planners cannot burn a
 * full harness tick (Borg / Goblin Storm gate stalls 144/192/210/233/298).
 *
 * Public entry symbols: isSwarmBattlefield, tryAISwarmBoardShortCircuit.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { ResolutionQueueManager } from "../../state/resolution/ResolutionQueueManager.js";
import { debug } from "../../utils/debug.js";
import { handleAiPendingResolutionStepWithLoopBreak } from "./aiResolutionStepLoopBreak.js";

/** Battlefield size where full response/combat scans regularly exceed the 180s tick wall. */
export const SWARM_BATTLEFIELD_BF = 80;

export function isSwarmBattlefield(game: any): boolean {
  const bf = Array.isArray(game?.state?.battlefield) ? game.state.battlefield.length : 0;
  return bf >= SWARM_BATTLEFIELD_BF;
}

type SwarmShortCircuitDeps = {
  executePassPriority: (
    io: Server,
    gameId: string,
    playerId: PlayerID,
    options?: { allowActiveMainPhaseAutoAdvance?: boolean },
  ) => Promise<void>;
  executeDeclareAttackers: (
    io: Server,
    gameId: string,
    playerId: PlayerID,
    attackers: Array<{ creatureId: string; defendingPlayerId: string }>,
  ) => Promise<void>;
  executeDeclareBlockers: (
    io: Server,
    gameId: string,
    playerId: PlayerID,
    blockers: Array<{ blockerId: string; attackerId: string }>,
  ) => Promise<void>;
  executeAdvanceStep: (
    io: Server,
    gameId: string,
    playerId: PlayerID,
  ) => Promise<void>;
  handleAIResolutionStep: (
    io: Server,
    gameId: string,
    playerId: PlayerID,
    step: any,
  ) => Promise<void>;
};

/**
 * On huge boards: answer our own prompts, otherwise only pass / empty-declare /
 * advance. Skips response candidate enumeration and combat planners that are
 * O(tokens²) against swarm engines.
 *
 * @returns true when the caller should return from handleAIPriority.
 */
export async function tryAISwarmBoardShortCircuit(
  io: Server,
  game: any,
  gameId: string,
  playerId: PlayerID,
  deps: SwarmShortCircuitDeps,
): Promise<boolean> {
  if (!isSwarmBattlefield(game)) return false;

  const state = game.state;
  const phase = String(state?.phase || '').toLowerCase();
  const step = String(state?.step || '').toLowerCase();
  const stackLen = Array.isArray(state?.stack) ? state.stack.length : 0;
  const stackEmpty = stackLen === 0;
  const isAITurn = String(state?.turnPlayer || '') === String(playerId);
  const hasPriority = String(state?.priority || '') === String(playerId);

  // Own prompts always win — color_choice on Borg Incursion must not sit behind
  // attack planning when 400 tokens are already on the board.
  if (ResolutionQueueManager.playerHasPendingSteps(gameId, playerId)) {
    const queue = ResolutionQueueManager.getQueue(gameId);
    const aiStep = (queue?.steps || []).find((s: any) =>
      String(s?.playerId || '') === String(playerId)
      && String(s?.status || '').toLowerCase() !== 'completed'
      && String(s?.status || '').toLowerCase() !== 'cancelled'
    );
    if (aiStep) {
      debug(1, '[AI] swarm short-circuit: resolving pending step', {
        gameId,
        playerId,
        stepType: aiStep.type,
        bf: Array.isArray(state?.battlefield) ? state.battlefield.length : 0,
      });
      await handleAiPendingResolutionStepWithLoopBreak(
        io,
        game,
        gameId,
        playerId,
        aiStep,
        deps.handleAIResolutionStep,
        deps.executePassPriority,
      );
      return true;
    }
  }

  // CLEANUP withholds priority (Rule 514.1). Returning false here while the caller
  // always early-returned after the short-circuit left swarm boards stuck forever
  // (stallcheck s47#143: CLEANUP priority=null bf>=80, empty stack).
  // With a non-empty stack (Rule 514.3) we must pass — advancing over stack objects
  // soft-locked s49#262 (Undead Alchemist on swarm CLEANUP).
  if (step.includes('cleanup') && isAITurn) {
    if (!stackEmpty) {
      if (!hasPriority) {
        state.priority = state.turnPlayer || playerId;
        (state as any).priorityPassedBy = new Set();
      }
      debug(1, '[AI] swarm short-circuit: CLEANUP pass with stack', {
        gameId,
        playerId,
        stackLen,
        bf: Array.isArray(state?.battlefield) ? state.battlefield.length : 0,
      });
      await deps.executePassPriority(io, gameId, playerId, { allowActiveMainPhaseAutoAdvance: true });
      return true;
    }
    debug(1, '[AI] swarm short-circuit: CLEANUP advance without priority', {
      gameId,
      playerId,
      bf: Array.isArray(state?.battlefield) ? state.battlefield.length : 0,
      hasPriority,
    });
    await deps.executeAdvanceStep(io, gameId, playerId);
    return true;
  }

  if (!hasPriority) return false;

  // Stacked spells/abilities on a swarm board: never enumerate responses.
  if (!stackEmpty) {
    debug(1, '[AI] swarm short-circuit: pass with stack', {
      gameId,
      playerId,
      stackLen,
      bf: Array.isArray(state?.battlefield) ? state.battlefield.length : 0,
    });
    await deps.executePassPriority(io, gameId, playerId, { allowActiveMainPhaseAutoAdvance: true });
    return true;
  }

  if (phase === 'combat' || phase.includes('combat')) {
    if (step.includes('attackers') && isAITurn) {
      debug(1, '[AI] swarm short-circuit: empty attack declare', { gameId, playerId });
      await deps.executeDeclareAttackers(io, gameId, playerId, []);
      return true;
    }
    if (step.includes('blockers')) {
      debug(1, '[AI] swarm short-circuit: empty block declare', { gameId, playerId });
      await deps.executeDeclareBlockers(io, gameId, playerId, []);
      return true;
    }
    await deps.executePassPriority(io, gameId, playerId, { allowActiveMainPhaseAutoAdvance: true });
    return true;
  }

  if (phase === 'beginning' || phase.includes('begin')) {
    const normalized = step.toLowerCase();
    if (normalized === 'untap' && isAITurn) {
      await deps.executeAdvanceStep(io, gameId, playerId);
      return true;
    }
    await deps.executePassPriority(io, gameId, playerId, { allowActiveMainPhaseAutoAdvance: true });
    return true;
  }

  if (phase === 'ending' || phase === 'end' || step.includes('cleanup')) {
    if (step.includes('cleanup') && isAITurn) {
      await deps.executeAdvanceStep(io, gameId, playerId);
      return true;
    }
    await deps.executePassPriority(io, gameId, playerId, { allowActiveMainPhaseAutoAdvance: true });
    return true;
  }

  // Main phases: pass — land/spell loops on 400+ permanents are not worth the tick.
  if (phase.includes('main') || step.includes('main')) {
    debug(1, '[AI] swarm short-circuit: main-phase pass', { gameId, playerId });
    await deps.executePassPriority(io, gameId, playerId, { allowActiveMainPhaseAutoAdvance: true });
    return true;
  }

  await deps.executePassPriority(io, gameId, playerId, { allowActiveMainPhaseAutoAdvance: true });
  return true;
}
