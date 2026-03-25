import type { GameState, PlayerID, SkipNextDrawStepEffect } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { resolvePlayers } from './oracleIRExecutorPlayerUtils';

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
};

type StepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason: 'unsupported_player_selector';
};

export type TurnStepHandlerResult = StepApplyResult | StepSkipResult;

export function applySkipNextDrawStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'skip_next_draw_step' }>,
  ctx: OracleIRExecutionContext
): TurnStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped skip-next-draw-step (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const existingEffects = Array.isArray((state as any).skipNextDrawStepEffects)
    ? ([...(state as any).skipNextDrawStepEffects] as SkipNextDrawStepEffect[])
    : [];
  const nextEffects = [...existingEffects];

  for (const playerId of players) {
    nextEffects.push({
      id: `skip-draw-${String(ctx.sourceId || ctx.sourceName || playerId)}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      playerId: playerId as PlayerID,
      ...(ctx.sourceId ? { sourceId: ctx.sourceId } : {}),
      ...(ctx.sourceName ? { sourceName: ctx.sourceName } : {}),
      remainingSkips: 1,
    });
  }

  return {
    applied: true,
    state: {
      ...(state as any),
      skipNextDrawStepEffects: nextEffects,
    } as GameState,
    log: players.map((playerId: string) => `${playerId} skips their next draw step`),
  };
}
