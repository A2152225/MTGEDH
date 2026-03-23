import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { ModifyPtRuntime } from './oracleIRExecutorModifyPtStepHandlers';
import {
  addManaToPoolForPlayer,
  adjustLife,
  discardCardsForPlayer,
  drawCardsForPlayer,
  millCardsForPlayer,
  quantityToNumber,
  resolvePlayers,
  resolveUnknownMillUntilAmountForPlayer,
} from './oracleIRExecutorPlayerUtils';

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly lastScryLookedAtCount?: number;
  readonly lastDiscardedCardCount?: number;
  readonly lastRevealedCardCount?: number;
};

type StepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason: 'unknown_amount' | 'unsupported_player_selector' | 'player_choice_required' | 'failed_to_apply';
  readonly options?: {
    readonly classification?: 'ambiguous' | 'player_choice';
    readonly metadata?: Record<string, string | number | boolean | readonly string[]>;
  };
};

export type PlayerStepHandlerResult = StepApplyResult | StepSkipResult;

function resolveVariableAmount(
  state: GameState,
  controllerId: PlayerID,
  amount: Extract<OracleEffectStep, { kind: 'gain_life' | 'lose_life' }>['amount'],
  ctx: OracleIRExecutionContext,
  runtime: ModifyPtRuntime | undefined,
  evaluateWhereX?: (
    state: GameState,
    controllerId: PlayerID,
    whereRaw: string,
    targetCreatureId?: string,
    ctx?: OracleIRExecutionContext,
    runtime?: ModifyPtRuntime
  ) => number | null
): number | null {
  const numericAmount = quantityToNumber(amount);
  if (numericAmount !== null) return numericAmount;
  if (amount.kind !== 'unknown' || !evaluateWhereX) return null;

  const raw = String(amount.raw || '').trim().replace(/^equal to\s+/i, '').trim();
  if (!raw) return null;

  const evaluated = evaluateWhereX(state, controllerId, `X is ${raw}`, undefined, ctx, runtime);
  if (evaluated !== null) return evaluated;

  const sacrificed = Array.isArray(runtime?.lastSacrificedPermanents) ? runtime.lastSacrificedPermanents : [];
  if (sacrificed.length === 1) {
    const snapshot = sacrificed[0] as any;
    const lowerRaw = raw.toLowerCase();
    const readFinite = (value: unknown): number | null => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    if (/^(?:the sacrificed|that) creature's power$/.test(lowerRaw)) return readFinite(snapshot?.power);
    if (/^(?:the sacrificed|that) creature's toughness$/.test(lowerRaw)) return readFinite(snapshot?.toughness);
    if (/^(?:the sacrificed|that) creature's mana value$/.test(lowerRaw)) return readFinite(snapshot?.manaValue);
  }

  return null;
}

export function applyScryStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'scry' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const amount = quantityToNumber(step.amount);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped scry (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped scry (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  if (amount <= 0) {
    return {
      applied: true,
      state,
      log: [`Scry ${amount} (no-op): ${step.raw}`],
      lastScryLookedAtCount: 0,
    };
  }

  const wouldNeedChoice = players.some(playerId => {
    const player = state.players.find(p => p.id === playerId) as any;
    const libraryLength = Array.isArray(player?.library) ? player.library.length : 0;
    return libraryLength > 0;
  });

  if (wouldNeedChoice) {
    return {
      applied: false,
      message: `Skipped scry (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  return {
    applied: true,
    state,
    log: [`Scry ${amount} (no cards in library): ${step.raw}`],
    lastScryLookedAtCount: 0,
  };
}

export function applySurveilStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'surveil' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const amount = quantityToNumber(step.amount);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped surveil (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped surveil (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  if (amount <= 0) {
    return {
      applied: true,
      state,
      log: [`Surveil ${amount} (no-op): ${step.raw}`],
    };
  }

  const wouldNeedChoice = players.some(playerId => {
    const player = state.players.find(p => p.id === playerId) as any;
    const libraryLength = Array.isArray(player?.library) ? player.library.length : 0;
    return libraryLength > 0;
  });

  if (wouldNeedChoice) {
    return {
      applied: false,
      message: `Skipped surveil (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  return {
    applied: true,
    state,
    log: [`Surveil ${amount} (no cards in library): ${step.raw}`],
  };
}

export function applyMillStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'mill' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped mill (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const millCountByPlayer = new Map<PlayerID, number>();
  for (const playerId of players) {
    const resolvedCount =
      quantityToNumber(step.amount) ??
      resolveUnknownMillUntilAmountForPlayer(state, playerId, step.amount);
    if (resolvedCount === null) {
      return {
        applied: false,
        message: `Skipped mill (unknown amount): ${step.raw}`,
        reason: 'unknown_amount',
        options: { classification: 'ambiguous' },
      };
    }
    millCountByPlayer.set(playerId, resolvedCount);
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    const amount = millCountByPlayer.get(playerId) ?? 0;
    const result = millCardsForPlayer(nextState, playerId, amount);
    nextState = result.state;
    log.push(...result.log);
  }

  const unknownRaw = String((step.amount as any)?.raw || '').toLowerCase();
  const isRevealThisWay = step.amount.kind === 'unknown' && unknownRaw.includes('reveal a land card');
  const lastRevealedCardCount = isRevealThisWay
    ? Array.from(millCountByPlayer.values()).reduce((sum, count) => sum + (Number(count) || 0), 0)
    : undefined;

  return {
    applied: true,
    state: nextState,
    log,
    lastRevealedCardCount,
  };
}

export function applyDiscardStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'discard' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const amount = quantityToNumber(step.amount);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped discard (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped discard (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const wouldNeedChoice = players.some(playerId => {
    const player = state.players.find(p => p.id === playerId) as any;
    const handLength = Array.isArray(player?.hand) ? player.hand.length : 0;
    return handLength > Math.max(0, amount | 0);
  });

  if (wouldNeedChoice) {
    return {
      applied: false,
      message: `Skipped discard (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  let nextState = state;
  const log: string[] = [];
  let totalDiscarded = 0;
  for (const playerId of players) {
    const result = discardCardsForPlayer(nextState, playerId, amount);
    nextState = result.state;
    totalDiscarded += Math.max(0, Number(result.discardedCount) || 0);
    log.push(...result.log);
  }

  return {
    applied: true,
    state: nextState,
    log,
    lastDiscardedCardCount: totalDiscarded,
  };
}

export function applyGainLifeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'gain_life' }>,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID,
  runtime?: ModifyPtRuntime,
  evaluateWhereX?: (
    state: GameState,
    controllerId: PlayerID,
    whereRaw: string,
    targetCreatureId?: string,
    ctx?: OracleIRExecutionContext,
    runtime?: ModifyPtRuntime
  ) => number | null
): PlayerStepHandlerResult {
  const amount = resolveVariableAmount(state, controllerId, step.amount, ctx, runtime, evaluateWhereX);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped life gain (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped life gain (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    const result = adjustLife(nextState, playerId, amount);
    nextState = result.state;
    log.push(...result.log);
  }

  return { applied: true, state: nextState, log };
}

export function applyLoseLifeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'lose_life' }>,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID,
  runtime?: ModifyPtRuntime,
  evaluateWhereX?: (
    state: GameState,
    controllerId: PlayerID,
    whereRaw: string,
    targetCreatureId?: string,
    ctx?: OracleIRExecutionContext,
    runtime?: ModifyPtRuntime
  ) => number | null
): PlayerStepHandlerResult {
  const amount = resolveVariableAmount(state, controllerId, step.amount, ctx, runtime, evaluateWhereX);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped life loss (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped life loss (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    const result = adjustLife(nextState, playerId, -amount);
    nextState = result.state;
    log.push(...result.log);
  }

  return { applied: true, state: nextState, log };
}

export function applyDrawStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'draw' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const amount = quantityToNumber(step.amount);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped draw (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped draw (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    const result = drawCardsForPlayer(nextState, playerId, amount);
    nextState = result.state;
    log.push(...result.log);
  }

  return { applied: true, state: nextState, log };
}

export function applyAddManaStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'add_mana' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped add mana (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    const result = addManaToPoolForPlayer(nextState, playerId, step.mana);
    log.push(...result.log);
    if (!result.applied) {
      return {
        applied: false,
        message: log.join('\n') || `Skipped add mana (failed to apply): ${step.raw}`,
        reason: 'failed_to_apply',
        options: {
          metadata: log.length > 0 ? { log } : undefined,
        },
      };
    }
    nextState = result.state;
  }

  return { applied: true, state: nextState, log };
}
