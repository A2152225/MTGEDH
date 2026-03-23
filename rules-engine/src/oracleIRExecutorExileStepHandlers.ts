import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  applyImpulsePermissionMarkers,
  exileTopCardsForPlayer,
  getPlayableUntilTurnForImpulseDuration,
  quantityToNumber,
  resolvePlayers,
  resolveUnknownExileUntilAmountForPlayer,
  putSpecificExiledCardsOnLibraryBottom,
  shouldReturnUncastExiledToBottom,
  shouldShuffleRestIntoLibrary,
  splitExiledForShuffleRest,
} from './oracleIRExecutorPlayerUtils';

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly lastExiledCardCount: number;
  readonly lastExiledCards: readonly any[];
};

type StepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason: 'unsupported_player_selector' | 'unknown_amount' | 'missing_permission';
  readonly options?: {
    readonly classification?: 'ambiguous';
  };
};

export type ExileTopStepHandlerResult = StepApplyResult | StepSkipResult;

function resolveExileCounts(
  state: GameState,
  players: readonly PlayerID[],
  amount: any,
  ctx: OracleIRExecutionContext
): Map<PlayerID, number> | null {
  const exileCountByPlayer = new Map<PlayerID, number>();
  for (const playerId of players) {
    const resolvedCount =
      quantityToNumber(amount) ??
      resolveUnknownExileUntilAmountForPlayer(state, playerId, amount, ctx);
    if (resolvedCount === null) return null;
    exileCountByPlayer.set(playerId, resolvedCount);
  }
  return exileCountByPlayer;
}

export function applyExileTopStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'exile_top' }>,
  ctx: OracleIRExecutionContext
): ExileTopStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped exile top (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const exileCountByPlayer = resolveExileCounts(state, players, step.amount, ctx);
  if (!exileCountByPlayer) {
    return {
      applied: false,
      message: `Skipped exile top (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  let nextState = state;
  let totalExiled = 0;
  const exiledCardsThisStep: any[] = [];
  const log: string[] = [];

  for (const playerId of players) {
    const amount = exileCountByPlayer.get(playerId) ?? 0;
    const result = exileTopCardsForPlayer(nextState, playerId, amount);
    nextState = result.state;
    totalExiled += Math.max(0, result.exiled.length | 0);
    exiledCardsThisStep.push(...(result.exiled as any[]));
    log.push(...result.log);
  }

  return {
    applied: true,
    state: nextState,
    log,
    lastExiledCardCount: totalExiled,
    lastExiledCards: exiledCardsThisStep,
  };
}

export function applyImpulseExileTopStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'impulse_exile_top' }>,
  ctx: OracleIRExecutionContext
): ExileTopStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped impulse exile top (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const exileCountByPlayer = resolveExileCounts(state, players, step.amount, ctx);
  if (!exileCountByPlayer) {
    return {
      applied: false,
      message: `Skipped impulse exile top (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const permission = step.permission as 'play' | 'cast' | undefined;
  if (!permission) {
    return {
      applied: false,
      message: `Skipped impulse exile top (missing permission): ${step.raw}`,
      reason: 'missing_permission',
    };
  }

  const playableUntilTurn = getPlayableUntilTurnForImpulseDuration(state, step.duration);
  const condition = step.condition;
  const exiledBy = ctx.sourceName;
  const returnUncastToBottom = shouldReturnUncastExiledToBottom(step as any);
  const shuffleRestIntoLibrary = shouldShuffleRestIntoLibrary(step as any);

  let nextState = state;
  let totalExiled = 0;
  const exiledCardsThisStep: any[] = [];
  const log: string[] = [];

  for (const playerId of players) {
    const amount = exileCountByPlayer.get(playerId) ?? 0;
    const result = exileTopCardsForPlayer(nextState, playerId, amount);
    nextState = result.state;
    totalExiled += Math.max(0, result.exiled.length | 0);
    exiledCardsThisStep.push(...(result.exiled as any[]));
    log.push(...result.log);

    const markerResult = applyImpulsePermissionMarkers(nextState, playerId, result.exiled, {
      permission,
      playableUntilTurn,
      condition,
      exiledBy,
    });
    nextState = markerResult.state;
    if (markerResult.granted > 0) {
      log.push(`${playerId} may ${permission === 'play' ? 'play' : 'cast'} ${markerResult.granted} exiled card(s)`);
    }

    if (shuffleRestIntoLibrary && result.exiled.length > 0) {
      const split = splitExiledForShuffleRest(step as any, result.exiled);
      if (split.returnToLibrary.length > 0) {
        const shuffledRestResult = putSpecificExiledCardsOnLibraryBottom(nextState, playerId, split.returnToLibrary);
        nextState = shuffledRestResult.state;
        log.push(...shuffledRestResult.log);
      }
    }

    if (returnUncastToBottom && result.exiled.length > 0) {
      const bottomResult = putSpecificExiledCardsOnLibraryBottom(nextState, playerId, result.exiled);
      nextState = bottomResult.state;
      log.push(...bottomResult.log);
    }
  }

  return {
    applied: true,
    state: nextState,
    log,
    lastExiledCardCount: totalExiled,
    lastExiledCards: exiledCardsThisStep,
  };
}
