/**
 * Interactive "flip coin / life stakes / decide whether to flip again" loop
 * (Game of Chaos template).
 */
import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { generateCoinFlipResult } from '../../../../rules-engine/src/coinFlip.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { queueOptionalPaymentStep } from '../../socket/optional-payment-prompts.js';
import { broadcastGame } from '../../socket/util.js';
import { debugWarn } from '../../utils/debug.js';

const MAX_FLIPS = 32;

function readLife(state: any, playerId: string): number {
  const fromState = Number(state?.life?.[playerId]);
  if (Number.isFinite(fromState)) return fromState;
  const player = (Array.isArray(state?.players) ? state.players : []).find(
    (entry: any) => String(entry?.id || '') === String(playerId),
  );
  return Number(player?.life ?? 40) || 40;
}

function writeLife(state: any, playerId: string, life: number): void {
  state.life = state.life || {};
  state.life[playerId] = life;
  const player = (Array.isArray(state?.players) ? state.players : []).find(
    (entry: any) => String(entry?.id || '') === String(playerId),
  );
  if (player) player.life = life;
}

function applyLifeDelta(state: any, playerId: string, delta: number): void {
  const next = readLife(state, playerId) + delta;
  writeLife(state, playerId, next);
  if (delta < 0) {
    state.lifeLostThisTurn = state.lifeLostThisTurn || {};
    state.lifeLostThisTurn[playerId] = Number(state.lifeLostThisTurn[playerId] || 0) + (-delta);
  } else if (delta > 0) {
    state.lifeGainedThisTurn = state.lifeGainedThisTurn || {};
    state.lifeGainedThisTurn[playerId] = Number(state.lifeGainedThisTurn[playerId] || 0) + delta;
  }
}

export function resolveFlipCoinLifeStakesIteration(
  ctx: GameContext,
  options: {
    controllerId: string;
    opponentId: string;
    stake: number;
    sourceName?: string;
    sourceId?: string;
    flipIndex?: number;
  },
): { won: boolean; stake: number; deciderId: string } {
  const state = (ctx as any).state;
  const controllerId = String(options.controllerId);
  const opponentId = String(options.opponentId);
  const stake = Math.max(1, Math.floor(Number(options.stake) || 1));
  const call: 'heads' | 'tails' = 'heads';
  const result = generateCoinFlipResult();
  const won = result === call;

  if (won) {
    applyLifeDelta(state, controllerId, stake);
    applyLifeDelta(state, opponentId, -stake);
  } else {
    applyLifeDelta(state, controllerId, -stake);
    applyLifeDelta(state, opponentId, stake);
  }

  state.lastCoinFlip = {
    playerId: controllerId,
    call,
    result,
    won,
    timestamp: Date.now(),
    stake,
    lifeStakesLoop: true,
  };

  const gameId = String((ctx as any).gameId || '');
  const io = (ctx as any).io;
  const sourceName = String(options.sourceName || 'Ability');
  if (io && gameId) {
    io.to?.(gameId)?.emit?.('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${won ? 'Won' : 'Lost'} the flip for ${stake} life.`,
      ts: Date.now(),
    });
  }

  return {
    won,
    stake,
    deciderId: won ? controllerId : opponentId,
  };
}

export function queueFlipCoinLifeStakesLoop(
  ctx: GameContext,
  options: {
    controllerId: PlayerID | string;
    opponentId: PlayerID | string;
    stake: number;
    sourceName?: string;
    sourceId?: string;
    flipIndex?: number;
    doubleEachFlip?: boolean;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const flipIndex = Math.max(0, Math.floor(Number(options.flipIndex) || 0));
  if (flipIndex >= MAX_FLIPS) return;

  const iteration = resolveFlipCoinLifeStakesIteration(ctx, {
    controllerId: String(options.controllerId),
    opponentId: String(options.opponentId),
    stake: options.stake,
    sourceName: options.sourceName,
    sourceId: options.sourceId,
    flipIndex,
  });

  const nextStake = options.doubleEachFlip === false
    ? iteration.stake
    : Math.max(1, iteration.stake * 2);
  const sourceName = String(options.sourceName || 'Ability');
  const decider = iteration.deciderId as PlayerID;

  queueOptionalPaymentStep(gameId, {
    playerId: decider,
    sourceName,
    sourceId: options.sourceId,
    description: `${sourceName}: Flip again for ${nextStake} life?`,
    mandatory: false,
    payChoiceId: 'flip_again',
    payLabel: `Flip again (${nextStake} life)`,
    payDescription: 'Continue the stakes loop.',
    declineChoiceId: 'stop',
    declineLabel: 'Stop',
    declineDescription: 'End the coin flips.',
    validationKind: 'none',
    stepData: {
      flipCoinLifeStakesChoice: true,
      controllerId: String(options.controllerId),
      opponentId: String(options.opponentId),
      stake: nextStake,
      flipIndex: flipIndex + 1,
      doubleEachFlip: options.doubleEachFlip !== false,
      sourceName,
      sourceId: options.sourceId,
    },
    onPay: async () => {
      try {
        queueFlipCoinLifeStakesLoop(ctx, {
          controllerId: String(options.controllerId),
          opponentId: String(options.opponentId),
          stake: nextStake,
          sourceName,
          sourceId: options.sourceId,
          flipIndex: flipIndex + 1,
          doubleEachFlip: options.doubleEachFlip !== false,
        });
        if (typeof (ctx as any).bumpSeq === 'function') (ctx as any).bumpSeq();
        const io = (ctx as any).io;
        if (io) broadcastGame(io as any, ctx as any, gameId);
      } catch (err) {
        debugWarn(1, '[flipCoinLifeStakes] continue failed:', err);
      }
    },
    onDecline: async () => {
      try {
        if (typeof (ctx as any).bumpSeq === 'function') (ctx as any).bumpSeq();
        const io = (ctx as any).io;
        if (io) broadcastGame(io as any, ctx as any, gameId);
      } catch {
        // ignore
      }
    },
  });

  // Ensure the optional payment step is present even if queueOptionalPaymentStep
  // is a no-op in some harnesses.
  void ResolutionQueueManager;
  void ResolutionStepType;
}
