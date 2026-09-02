/**
 * Origin parent: oracleIRExecutorPlayerExploreLifeDrawSteps.ts / millPtTokenSteps
 * Cluster: “you may pay any amount of {E}” (Aether Spike / Galvanic Discharge).
 * Public: applyPayEnergyStep
 * Leaf must not import oracleIRExecutorMainLoop.ts or millPtTokenSteps.
 */

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { PlayerStepHandlerResult } from './oracleIRExecutorPlayerStepTypes';
import { adjustPlayerCounter, resolvePlayers } from './oracleIRExecutorPlayerUtils';

function readPlayerEnergy(state: GameState, playerId: PlayerID): number {
  const player = (state.players || []).find((entry) => String(entry?.id || '').trim() === String(playerId || '').trim()) as any;
  return Math.max(
    0,
    Math.floor(
      Number(
        (state as any)?.energy?.[playerId]
          ?? player?.energyCounters
          ?? player?.energy
          ?? player?.counters?.energy
          ?? 0,
      ) || 0,
    ),
  );
}

export function applyPayEnergyStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'pay_energy' }>,
  ctx: OracleIRExecutionContext,
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped pay-energy step (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          selectorKind: step.who.kind,
          candidateCount: players.length,
          energyAnyAmount: true,
        },
      },
    };
  }

  const payerId = players[0];
  const available = readPlayerEnergy(state, payerId);
  const stampedRaw = ctx.energyPaidThisWay;
  const stamped = stampedRaw === undefined || stampedRaw === null ? NaN : Number(stampedRaw);

  if (!Number.isFinite(stamped)) {
    return {
      applied: false,
      message: `Skipped pay-energy step (needs energy amount): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          payerId,
          energyAnyAmount: true,
          minEnergy: 0,
          maxEnergy: available,
        },
      },
    };
  }

  const payAmount = Math.max(0, Math.min(available, Math.floor(stamped)));
  if (payAmount <= 0) {
    return {
      applied: true,
      state,
      count: 0,
      log: [`Resolved pay-energy step (paid 0): ${step.raw}`],
    };
  }

  const result = adjustPlayerCounter(state, payerId, 'energy', -payAmount);
  if (!result.applied) {
    return {
      applied: false,
      message: result.log.join('\n') || `Skipped pay-energy step (failed to apply): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  return {
    applied: true,
    state: result.state,
    count: payAmount,
    log: [...result.log, `Resolved pay-energy step (paid ${payAmount}): ${step.raw}`],
  };
}
