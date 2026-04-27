import type { ExtraTurnEffect, GameState, PlayerID, SkipNextDrawStepEffect } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { resolvePlayers } from './oracleIRExecutorPlayerUtils';

type ExtraCombatEffect = {
  readonly source?: string;
  readonly untapAttackers?: boolean;
  readonly followedByAdditionalMain?: boolean;
  readonly createdAt?: number;
};

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

export function applyTakeExtraTurn(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'take_extra_turn' }>,
  ctx: OracleIRExecutionContext
): TurnStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped take-extra-turn (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const existingExtraTurns = Array.isArray((state as any).extraTurns)
    ? ([...(state as any).extraTurns] as ExtraTurnEffect[])
    : [];
  const nextExtraTurns = [...existingExtraTurns];
  const afterTurnNumber = Number((state as any).turn || 0);
  const createdAt = Date.now();
  const source = String(ctx.sourceName || ctx.sourceId || '').trim();

  for (const playerId of players) {
    nextExtraTurns.unshift({
      playerId: playerId as PlayerID,
      afterTurnNumber,
      ...(source ? { source } : {}),
      createdAt,
    });
  }

  return {
    applied: true,
    state: {
      ...(state as any),
      extraTurns: nextExtraTurns,
    } as GameState,
    log: players.map((playerId: string) => `${playerId} takes an extra turn after this one`),
  };
}

export function applyAddExtraCombat(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'add_extra_combat' }>,
  ctx: OracleIRExecutionContext
): TurnStepHandlerResult {
  const existingExtraCombats = Array.isArray((state as any).extraCombats)
    ? ([...(state as any).extraCombats] as ExtraCombatEffect[])
    : [];
  const source = String(ctx.sourceName || ctx.sourceId || '').trim();
  const extraCombat: ExtraCombatEffect = {
    ...(source ? { source } : {}),
    ...(step.followedByAdditionalMain === true ? { followedByAdditionalMain: true } : {}),
    createdAt: Date.now(),
  };

  return {
    applied: true,
    state: {
      ...(state as any),
      extraCombats: [...existingExtraCombats, extraCombat],
    } as GameState,
    log: [`Added an additional combat phase${step.followedByAdditionalMain ? ' followed by an additional main phase' : ''}`],
  };
}
