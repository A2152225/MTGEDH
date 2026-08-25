// Extracted from oracleIRExecutorPlayerStepHandlers.ts.
// Cluster: buildLookSelectTopSelectionOptions, resolveLookSelectAmount,
// lookSelectTopRequiresPlayerChoice.
// Public entries: buildLookSelectTopSelectionOptions, resolveLookSelectAmount,
// lookSelectTopRequiresPlayerChoice.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { ModifyPtRuntime } from './oracleIRExecutorModifyPtStepHandlers';
import { evaluateModifyPtWhereX } from './oracleIRExecutorModifyPtWhereEvaluator';
import { getNormalizedChosenIds } from './oracleIRExecutorPlayerStepShared';
import { quantityToNumber, resolvePlayers } from './oracleIRExecutorPlayerUtils';
import { resolveOracleQuantity } from './oracleIRExecutorResolveQuantity';

export function buildLookSelectTopSelectionOptions(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'look_select_top' }>,
  ctx: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime
): {
  readonly playerId: PlayerID;
  readonly lookedCount: number;
  readonly chooseCount: number;
  readonly chooseMin: number;
  readonly availableCards: readonly any[];
  readonly destination: 'hand' | 'graveyard' | 'library_top';
  readonly restDestination: 'graveyard' | 'library';
  readonly restToTop: boolean;
  readonly restRandomOrder: boolean;
} | null {
  const amount = resolveLookSelectAmount(state, step, ctx, runtime);
  if (amount === null) return null;

  const chooseMax = quantityToNumber(step.choose, ctx);
  if (chooseMax === null) return null;

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) return null;

  const playerId = players[0];
  const player = state.players.find(entry => entry.id === playerId) as any;
  if (!player) return null;

  const library = Array.isArray(player.library) ? player.library : [];
  const lookedCount = Math.max(0, Math.min(library.length, amount | 0));
  const chooseCount = Math.max(0, Math.min(lookedCount, chooseMax | 0));
  const chooseMin = Math.max(0, Math.min(chooseCount, step.chooseMin ?? (step.optional ? 0 : chooseCount)));

  return {
    playerId,
    lookedCount,
    chooseCount,
    chooseMin,
    availableCards: library.slice(0, lookedCount),
    destination: step.destination,
    restDestination: step.restDestination,
    restToTop: Boolean(step.restToTop),
    restRandomOrder: Boolean(step.restRandomOrder),
  };
}

export function resolveLookSelectAmount(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'look_select_top' }>,
  ctx: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime
): number | null {
  const resolved = resolveOracleQuantity(state, ctx.controllerId, step.amount, ctx, {
    whereX: step.whereX,
    runtime,
  });
  if (resolved !== null) return resolved;

  if (step.amount.kind !== 'x') {
    return quantityToNumber(step.amount, ctx);
  }

  const raw = String(step.raw || '').trim();
  const whereMatch = raw.match(/\bwhere\s+x\s+is\s+(.+?)(?:\.\s|$)/i);
  if (!whereMatch) return null;

  const evaluated = evaluateModifyPtWhereX(
    state,
    ctx.controllerId,
    `X is ${String(whereMatch[1] || '').trim()}`,
    undefined,
    ctx,
    runtime
  );
  return evaluated === null ? null : Math.max(0, evaluated);
}

export function lookSelectTopRequiresPlayerChoice(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'look_select_top' }>,
  ctx: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime
): boolean {
  if (ctx.interactivePlayerChoices === false) return false;
  if (getNormalizedChosenIds(ctx).length > 0) return false;
  const built = buildLookSelectTopSelectionOptions(state, step, ctx, runtime);
  if (!built) return false;
  if (built.lookedCount <= 0) return false;
  if (built.chooseMin < built.chooseCount) return true;
  if (step.destination === 'library_top') return built.lookedCount > 0;
  return built.lookedCount > built.chooseCount;
}
