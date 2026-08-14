import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  applyImpulsePermissionMarkers,
  exileTopCardsForPlayer,
  getCardManaValue,
  getCardTypeLineLower,
  getPlayableUntilTurnForImpulseDuration,
  impulseExileTopIsDiscoverCastOrHand,
  impulseExileTopRequiresChooseOne,
  normalizeOracleText,
  quantityToNumber,
  resolvePlayers,
  resolveUnknownExileUntilAmountForPlayer,
  putSpecificExiledCardsOnLibraryBottom,
  shouldReturnUncastExiledToBottom,
  shouldShuffleRestIntoLibrary,
  stampExiledCardsForDeferredChoice,
  splitExiledForShuffleRest,
  isCardExiledWithSource,
} from './oracleIRExecutorPlayerUtils';
import { cardMatchesExileSelectorText } from './oracleIRExecutorZoneOps';
import { evaluateModifyPtWhereX } from './oracleIRExecutorModifyPtWhereEvaluator';
import { resolveOracleQuantity } from './oracleIRExecutorResolveQuantity';
import type { ModifyPtRuntime } from './oracleIRExecutorModifyPtStepHandlers';
import type { PlayerZoneChangeBridgeContext } from './oracleIRExecutorCardZoneTransitionCommit';
import {
  omitBridgedStepCarryOver,
  usedOracleIrServerBridge,
} from './oracleIRStepLedgerRuntime';
import { collectExiledCardsLedgerFirst } from './oracleIRLedgerCardAccess';

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly lastExiledCardCount: number;
  readonly lastExiledCards: readonly any[];
  readonly skipLedgerFlush?: boolean;
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

function resolveDiscoverManaValueThreshold(
  amount: any,
  ctx: OracleIRExecutionContext,
  state: GameState,
  playerId: PlayerID,
): number | null {
  if (amount?.kind === 'until_nonland_mana_value_lte') {
    const value = Number(amount.value);
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
  }

  if (amount?.kind === 'object_stat') {
    const resolved = resolveOracleQuantity(state, playerId, amount, ctx);
    return resolved == null ? null : Math.max(0, Math.floor(resolved));
  }

  if (amount?.kind !== 'reference_amount' && amount?.kind !== 'unknown' && amount?.kind !== 'x') {
    return null;
  }

  const raw = normalizeOracleText(String((amount as any)?.raw || ''));
  if (amount?.kind === 'x' || /mana value x or less/i.test(raw) || /with that mana value or less/i.test(raw)) {
    const xValue = Number(ctx.xValue);
    if (Number.isFinite(xValue)) return Math.max(0, Math.floor(xValue));
  }

  const creatureStatMatch = raw.match(/mana value that creature(?:'|’)?s (power|toughness) or less/i);
  if (creatureStatMatch) {
    const stat = String(creatureStatMatch[1] || '').toLowerCase() === 'power' ? 'power' : 'toughness';
    const resolved = resolveOracleQuantity(
      state,
      playerId,
      { kind: 'object_stat', subject: 'that_creature', stat },
      ctx,
    );
    return resolved == null ? null : Math.max(0, Math.floor(resolved));
  }

  return null;
}

function coerceDiscoverImpulseAmount(
  amount: any,
  ctx: OracleIRExecutionContext,
  state: GameState,
  playerId: PlayerID,
): any {
  if (amount?.kind === 'until_nonland_mana_value_lte') return amount;
  const threshold = resolveDiscoverManaValueThreshold(amount, ctx, state, playerId);
  if (threshold == null) return amount;
  return { kind: 'until_nonland_mana_value_lte', value: threshold };
}

function resolveExileCounts(
  state: GameState,
  players: readonly PlayerID[],
  amount: any,
  ctx: OracleIRExecutionContext,
  options?: { readonly rawHint?: string; readonly runtime?: ModifyPtRuntime }
): Map<PlayerID, number> | null {
  const exileCountByPlayer = new Map<PlayerID, number>();
  for (const playerId of players) {
    if (amount?.kind === 'x') {
      const xFromCtx = Number(ctx.xValue);
      if (Number.isFinite(xFromCtx)) {
        exileCountByPlayer.set(playerId, Math.max(0, Math.floor(xFromCtx)));
        continue;
      }
      const whereMatch = String(options?.rawHint || '').match(/\bwhere\s+x\s+is\s+(.+)$/i);
      if (whereMatch) {
        const evaluated = evaluateModifyPtWhereX(
          state,
          playerId,
          `X is ${String(whereMatch[1] || '').trim()}`,
          undefined,
          ctx,
          options?.runtime
        );
        if (evaluated !== null) {
          exileCountByPlayer.set(playerId, evaluated);
          continue;
        }
      }
      return null;
    }

    if (amount?.kind === 'until_nonland_mana_value_lte') {
      const player = state.players.find(p => p.id === playerId) as any;
      if (!player) return null;
      const library: any[] = Array.isArray(player.library) ? player.library : [];
      const threshold = Math.max(0, Number(amount.value) || 0);
      let resolvedCount = library.length;
      for (let index = 0; index < library.length; index += 1) {
        const typeLine = getCardTypeLineLower(library[index]);
        if (!typeLine) return null;
        if (typeLine.includes('land')) continue;
        const manaValue = getCardManaValue(library[index]);
        if (manaValue === null) {
          resolvedCount = index + 1;
          break;
        }
        if (manaValue <= threshold) {
          resolvedCount = index + 1;
          break;
        }
      }
      exileCountByPlayer.set(playerId, resolvedCount);
      continue;
    }

    const resolvedCount =
      quantityToNumber(amount, ctx) ??
      resolveUnknownExileUntilAmountForPlayer(state, playerId, amount, ctx);
    if (resolvedCount === null) return null;
    exileCountByPlayer.set(playerId, resolvedCount);
  }
  return exileCountByPlayer;
}

function buildExileTopBridgeOptions(
  ctx: OracleIRExecutionContext,
  stepKind: string,
): PlayerZoneChangeBridgeContext | undefined {
  if (!usedOracleIrServerBridge(ctx)) return undefined;
  return {
    ctx,
    stepIndex: Number(ctx.currentStepIndex),
    stepKind,
  };
}

function withExileTopLedgerFlags<T extends Record<string, unknown>>(
  result: T,
  ledgerRecordedViaBridge?: boolean,
): T & { skipLedgerFlush?: boolean } {
  return omitBridgedStepCarryOver(result, { ledgerRecordedViaBridge });
}

export function applyExileTopStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'exile_top' }>,
  ctx: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime
): ExileTopStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped exile top (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const exileCountByPlayer = resolveExileCounts(state, players, step.amount, ctx, { rawHint: step.raw, runtime });
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
  let ledgerRecordedViaBridge = false;
  const bridgeOptions = buildExileTopBridgeOptions(ctx, step.kind);

  for (const playerId of players) {
    const amount = exileCountByPlayer.get(playerId) ?? 0;
    const result = exileTopCardsForPlayer(nextState, playerId, amount, bridgeOptions);
    if (result.halted) {
      return withExileTopLedgerFlags({
        applied: true,
        state: nextState,
        log,
        lastExiledCardCount: totalExiled,
        lastExiledCards: exiledCardsThisStep,
      }, ledgerRecordedViaBridge);
    }
    nextState = result.state;
    totalExiled += Math.max(0, result.exiled.length | 0);
    exiledCardsThisStep.push(...(result.exiled as any[]));
    log.push(...result.log);
    if (result.ledgerRecordedViaBridge) ledgerRecordedViaBridge = true;
  }

  return withExileTopLedgerFlags({
    applied: true,
    state: nextState,
    log,
    lastExiledCardCount: totalExiled,
    lastExiledCards: exiledCardsThisStep,
  }, ledgerRecordedViaBridge);
}

export function applyImpulseExileTopStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'impulse_exile_top' }>,
  ctx: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime
): ExileTopStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped impulse exile top (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const coercedAmount = coerceDiscoverImpulseAmount(step.amount, ctx, state, players[0] as PlayerID);
  const impulseStep = coercedAmount === step.amount ? step : { ...step, amount: coercedAmount };
  const exileCountByPlayer = resolveExileCounts(state, players, impulseStep.amount, ctx, { rawHint: step.raw, runtime });
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
  const returnUncastToBottom = shouldReturnUncastExiledToBottom(impulseStep as any);
  const shuffleRestIntoLibrary = shouldShuffleRestIntoLibrary(impulseStep as any);
  const requiresChooseOne = impulseExileTopRequiresChooseOne(impulseStep);
  const spendManaAsThoughAnyType = /mana of any type can be spent to cast those spells/i.test(String(step.raw || ''));
  const permissionRecipientForWho = (libraryOwnerId: PlayerID): PlayerID => {
    const whoKind = String((step.who as any)?.kind || '').trim();
    if (whoKind === 'each_player' || whoKind === 'each_opponent') {
      return String(ctx.controllerId || libraryOwnerId) as PlayerID;
    }
    return libraryOwnerId;
  };

  let nextState = state;
  let totalExiled = 0;
  const exiledCardsThisStep: any[] = [];
  const log: string[] = [];
  let ledgerRecordedViaBridge = false;
  const bridgeOptions = buildExileTopBridgeOptions(ctx, step.kind);

  for (const playerId of players) {
    const amount = exileCountByPlayer.get(playerId) ?? 0;
    const result = exileTopCardsForPlayer(nextState, playerId, amount, bridgeOptions);
    if (result.halted) {
      return withExileTopLedgerFlags({
        applied: true,
        state: nextState,
        log,
        lastExiledCardCount: totalExiled,
        lastExiledCards: exiledCardsThisStep,
      }, ledgerRecordedViaBridge);
    }
    nextState = result.state;
    totalExiled += Math.max(0, result.exiled.length | 0);
    log.push(...result.log);
    if (result.ledgerRecordedViaBridge) ledgerRecordedViaBridge = true;

    let keptExiled = result.exiled as any[];
    if (shuffleRestIntoLibrary && result.exiled.length > 0) {
      const split = splitExiledForShuffleRest(impulseStep as any, result.exiled);
      if (split.returnToLibrary.length > 0) {
        const shuffledRestResult = putSpecificExiledCardsOnLibraryBottom(nextState, playerId, split.returnToLibrary);
        nextState = shuffledRestResult.state;
        log.push(...shuffledRestResult.log);
      }
      keptExiled = [...split.keepExiled];
    }

    if (!requiresChooseOne || keptExiled.length <= 1) {
      const markerResult = applyImpulsePermissionMarkers(nextState, playerId, keptExiled, {
        permission,
        playableUntilTurn,
        condition,
        exiledBy,
        permissionRecipient: permissionRecipientForWho(playerId),
        ...(spendManaAsThoughAnyType ? { spendManaAsThoughAnyType: true } : {}),
        ...(impulseExileTopIsDiscoverCastOrHand(impulseStep) ? { withoutPayingManaCost: true } : {}),
      });
      nextState = markerResult.state;
      if (markerResult.granted > 0) {
        log.push(`${permissionRecipientForWho(playerId)} may ${permission === 'play' ? 'play' : 'cast'} ${markerResult.granted} exiled card(s)`);
      }
    } else {
      nextState = stampExiledCardsForDeferredChoice(nextState, playerId, keptExiled, String(exiledBy || '').trim());
    }

    if (returnUncastToBottom && result.exiled.length > 0) {
      const bottomResult = putSpecificExiledCardsOnLibraryBottom(nextState, playerId, result.exiled);
      nextState = bottomResult.state;
      log.push(...bottomResult.log);
    }

    exiledCardsThisStep.push(...keptExiled);
  }

  return withExileTopLedgerFlags({
    applied: true,
    state: nextState,
    log,
    lastExiledCardCount: totalExiled,
    lastExiledCards: exiledCardsThisStep,
  }, ledgerRecordedViaBridge);
}

export function applyModifyExilePermissionsStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'modify_exile_permissions' }>,
  runtime: {
    readonly lastExiledCards?: readonly any[];
  },
  ctx?: OracleIRExecutionContext
): ExilePermissionModifierResult {
  const lastExiledCards = ctx
    ? collectExiledCardsLedgerFirst(ctx, runtime)
    : (Array.isArray(runtime.lastExiledCards) ? runtime.lastExiledCards : []);
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
  const patchExileCard = (card: any): any => {
    const id = String(card?.id ?? card?.cardId ?? '').trim();
    if (!id || !exiledIds.has(id)) return card;
    changed += 1;
    return {
      ...card,
      ...(step.withoutPayingManaCost ? { withoutPayingManaCost: true, castWithoutPayingManaCost: true } : {}),
    };
  };

  const updatedPlayers = (state.players || []).map((player: any) => {
    const exile = Array.isArray(player?.exile) ? player.exile : [];
    if (exile.length === 0) return player;

    let playerChanged = false;
    const updatedExile = exile.map((card: any) => {
      const nextCard = patchExileCard(card);
      if (nextCard !== card) playerChanged = true;
      return nextCard;
    });

    return playerChanged ? ({ ...player, exile: updatedExile } as any) : player;
  });

  const stateAny: any = { ...(state as any), players: updatedPlayers as any };
  const zones = stateAny.zones && typeof stateAny.zones === 'object' ? { ...stateAny.zones } : {};
  let zonesChanged = false;
  for (const zoneOwnerId of Object.keys(zones)) {
    const exile = Array.isArray(zones[zoneOwnerId]?.exile) ? zones[zoneOwnerId].exile : [];
    if (exile.length === 0) continue;
    let zoneChanged = false;
    const updatedExile = exile.map((card: any) => {
      const nextCard = patchExileCard(card);
      if (nextCard !== card) zoneChanged = true;
      return nextCard;
    });
    if (zoneChanged) {
      zonesChanged = true;
      zones[zoneOwnerId] = {
        ...zones[zoneOwnerId],
        exile: updatedExile,
      };
    }
  }
  if (zonesChanged) {
    stateAny.zones = zones;
  }

  return {
    applied: true,
    state: stateAny as GameState,
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
  const sourceId = String(ctx.sourceId || '').trim();
  const selectorText = String((step.what as any)?.text || (step.what as any)?.raw || '').trim().toLowerCase();
  const selfSelector = /^(?:this card|this spell|this permanent|this creature|it)$/.test(selectorText);

  if (grantedPlayers.length === 0 || (step.linkedToSource && !sourceRef)) {
    return {
      applied: false,
      message: `Skipped exile permission grant (missing source/player): ${step.raw}`,
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
      const cardId = String(card?.id ?? card?.cardId ?? '').trim();
      if (step.linkedToSource) {
        if (!isCardExiledWithSource(card, sourceRef)) return card;
        if (!matchesGrantedExileSelector(card, step.what)) return card;
      } else if (selfSelector) {
        if (!sourceId || cardId !== sourceId) return card;
      } else if (!matchesGrantedExileSelector(card, step.what)) {
        return card;
      }

      const matchingGrantedPlayerId = grantedPlayers.find(playerId => {
        if (step.ownedByWho === 'granted_player') {
          const ownerId = String(card?.ownerId || card?.owner || card?.card?.ownerId || card?.card?.owner || player?.id || '').trim();
          return ownerId === String(playerId || '').trim();
        }
        return true;
      });
      if (!matchingGrantedPlayerId) return card;

      const id = cardId;
      if (!id) return card;

      stateAny.playableFromExile[matchingGrantedPlayerId] = stateAny.playableFromExile[matchingGrantedPlayerId] || {};
      stateAny.playableFromExile[matchingGrantedPlayerId][id] = playableUntilTurn ?? Number.MAX_SAFE_INTEGER;
      granted += 1;
      playerChanged = true;
      return {
        ...card,
        canBePlayedBy: matchingGrantedPlayerId,
        playableUntilTurn: playableUntilTurn ?? Number.MAX_SAFE_INTEGER,
        ...(step.withoutPayingManaCost ? { withoutPayingManaCost: true } : {}),
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
