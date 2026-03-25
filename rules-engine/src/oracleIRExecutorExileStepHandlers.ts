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
  isCardExiledWithSource,
} from './oracleIRExecutorPlayerUtils';
import { cardMatchesExileSelectorText } from './oracleIRExecutorZoneOps';

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

type ExilePermissionModifierApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
};

type ExilePermissionModifierSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason: 'failed_to_apply';
  readonly options?: {
    readonly classification?: 'invalid_input';
    readonly persist?: boolean;
  };
};

export type ExilePermissionModifierResult =
  | ExilePermissionModifierApplyResult
  | ExilePermissionModifierSkipResult;

type GrantExilePermissionResult = ExilePermissionModifierResult;

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

export function applyModifyExilePermissionsStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'modify_exile_permissions' }>,
  runtime: {
    readonly lastExiledCards?: readonly any[];
  },
  _ctx?: OracleIRExecutionContext
): ExilePermissionModifierResult {
  const lastExiledCards = Array.isArray(runtime.lastExiledCards) ? runtime.lastExiledCards : [];
  const exiledIds = new Set(
    lastExiledCards
      .map(card => String((card as any)?.id ?? (card as any)?.cardId ?? '').trim())
      .filter(Boolean)
  );

  if (step.scope !== 'last_exiled_cards' || exiledIds.size === 0) {
    return {
      applied: false,
      message: `Skipped exile permission modifier (no exiled cards in context): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  let changed = 0;
  const updatedPlayers = (state.players || []).map((player: any) => {
    const exile = Array.isArray(player?.exile) ? player.exile : [];
    if (exile.length === 0) return player;

    let playerChanged = false;
    const updatedExile = exile.map((card: any) => {
      const id = String(card?.id ?? card?.cardId ?? '').trim();
      if (!id || !exiledIds.has(id)) return card;
      playerChanged = true;
      changed += 1;
      return {
        ...card,
        ...(step.withoutPayingManaCost ? { withoutPayingManaCost: true } : {}),
      };
    });

    return playerChanged ? ({ ...player, exile: updatedExile } as any) : player;
  });

  return {
    applied: true,
    state: { ...(state as any), players: updatedPlayers as any } as any,
    log:
      changed > 0
        ? [`Updated exile permissions for ${changed} exiled card(s)`]
        : [`Updated no exile permissions: ${step.raw}`],
  };
}

function matchesGrantedExileSelector(card: any, what: any): boolean {
  const selectorText = String(what?.text || what?.raw || '').trim();
  return cardMatchesExileSelectorText(card, selectorText);
}

export function applyGrantExilePermissionStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_exile_permission' }>,
  ctx: OracleIRExecutionContext
): GrantExilePermissionResult {
  const grantedPlayers = resolvePlayers(state, step.who, ctx);
  const sourceRef = String(ctx.sourceId || ctx.sourceName || '').trim();
  if (grantedPlayers.length === 0 || !sourceRef || !step.linkedToSource) {
    return {
      applied: false,
      message: `Skipped exile permission grant (missing linked source/player): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const playableUntilTurn = getPlayableUntilTurnForImpulseDuration(state, step.duration);
  const stateAny: any = state as any;
  stateAny.playableFromExile = stateAny.playableFromExile || {};

  let granted = 0;
  const updatedPlayers = (state.players || []).map((player: any) => {
    const exile = Array.isArray(player?.exile) ? player.exile : [];
    if (exile.length === 0) return player;

    let playerChanged = false;
    const updatedExile = exile.map((card: any) => {
      if (!isCardExiledWithSource(card, sourceRef)) return card;
      if (!matchesGrantedExileSelector(card, step.what)) return card;

      const matchingGrantedPlayerId = grantedPlayers.find(playerId => {
        if (step.ownedByWho === 'granted_player') {
          const ownerId = String(card?.ownerId || card?.owner || card?.card?.ownerId || card?.card?.owner || player?.id || '').trim();
          return ownerId === String(playerId || '').trim();
        }
        return true;
      });
      if (!matchingGrantedPlayerId) return card;

      const id = String(card?.id ?? card?.cardId ?? '').trim();
      if (!id) return card;

      stateAny.playableFromExile[matchingGrantedPlayerId] = stateAny.playableFromExile[matchingGrantedPlayerId] || {};
      stateAny.playableFromExile[matchingGrantedPlayerId][id] = playableUntilTurn ?? Number.MAX_SAFE_INTEGER;
      granted += 1;
      playerChanged = true;
      return {
        ...card,
        canBePlayedBy: matchingGrantedPlayerId,
        playableUntilTurn: playableUntilTurn ?? Number.MAX_SAFE_INTEGER,
        ...(step.castedPermanentEntersWithCounters
          ? { entersBattlefieldWithCounters: { ...step.castedPermanentEntersWithCounters } }
          : {}),
      };
    });

    return playerChanged ? ({ ...player, exile: updatedExile } as any) : player;
  });

  return {
    applied: true,
    state: { ...(stateAny as any), players: updatedPlayers as any } as any,
    log:
      granted > 0
        ? [`Granted exile permission for ${granted} linked exiled card(s)`]
        : [`Granted no exile permissions: ${step.raw}`],
  };
}
