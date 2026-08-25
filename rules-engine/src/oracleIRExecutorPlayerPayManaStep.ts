// Extracted from oracleIRExecutorPlayerStepHandlers.ts.
// Cluster: applyPayManaStep.
// Public entries: applyPayManaStep.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  parseEnergyCostAmount,
  parseSupportedManaCostString,
} from './oracleIRExecutorPlayerGraveyardPermissionHelpers';
import type { PlayerStepHandlerResult } from './oracleIRExecutorPlayerStepTypes';
import { adjustPlayerCounter, resolvePlayers } from './oracleIRExecutorPlayerUtils';
import { payManaCost } from './spellCasting';
import { createEmptyManaPool } from './types/mana';

export function applyPayManaStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'pay_mana' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  let effectiveStep = step;
  let players = resolvePlayers(state, step.who, ctx);
  if (
    players.length === 0 &&
    (String((step.who as any)?.kind || '') === 'unknown' || !step.who) &&
    /^when you do,\s+you may pay\b/i.test(String(step.raw || ''))
  ) {
    effectiveStep = { ...step, who: { kind: 'you' } };
    players = resolvePlayers(state, effectiveStep.who, ctx);
  }
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped pay mana (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const energyCost = parseEnergyCostAmount(effectiveStep.mana);
  const manaCost = parseSupportedManaCostString(effectiveStep.mana, Number(ctx.xValue));
  if (energyCost <= 0 && !manaCost) {
    return {
      applied: false,
      message: `Skipped pay mana (unsupported mana cost): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'ambiguous' },
    };
  }

  if (step.optional && ctx?.interactivePlayerChoices) {
    return {
      applied: false,
      message: `Deferred optional mana payment (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: { manaCost: step.mana },
      },
    };
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    if (energyCost > 0) {
      const player = (nextState.players || []).find((entry) => entry?.id === playerId) as any;
      const currentEnergy = Math.max(
        0,
        Number(player?.energyCounters ?? player?.energy ?? player?.counters?.energy ?? 0) || 0
      );
      if (currentEnergy < energyCost) {
        return {
          applied: false,
          message: `Skipped pay mana (cannot pay ${step.mana}): ${step.raw}`,
          reason: 'failed_to_apply',
          options: {
            classification: 'invalid_input',
            persist: false,
          },
        };
      }
      const energyResult = adjustPlayerCounter(nextState, playerId, 'energy', -energyCost);
      if (!energyResult.applied) {
        return {
          applied: false,
          message: `Skipped pay mana (cannot pay ${step.mana}): ${step.raw}`,
          reason: 'failed_to_apply',
          options: {
            classification: 'invalid_input',
            persist: false,
          },
        };
      }
      nextState = energyResult.state;
      log.push(...energyResult.log);
    }

    if (manaCost) {
      const manaPoolRecord: Record<PlayerID, any> = { ...((((nextState as any).manaPool || {}) as any) || {}) };
      const currentPool = manaPoolRecord[playerId] || createEmptyManaPool();
      const payment = payManaCost(currentPool, manaCost);
      if (!payment.success || !payment.remainingPool) {
        return {
          applied: false,
          message: `Skipped pay mana (cannot pay ${step.mana}): ${step.raw}`,
          reason: 'failed_to_apply',
          options: {
            classification: 'invalid_input',
            persist: false,
          },
        };
      }

      manaPoolRecord[playerId] = payment.remainingPool;
      nextState = { ...(nextState as any), manaPool: manaPoolRecord } as any;
      log.push(`${playerId} pays ${step.mana}`);
    } else if (energyCost > 0) {
      log.push(`${playerId} pays ${step.mana}`);
    }
  }

  return {
    applied: true,
    state: nextState,
    log,
  };
}

