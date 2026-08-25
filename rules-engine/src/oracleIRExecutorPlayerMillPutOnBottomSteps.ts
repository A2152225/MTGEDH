// Extracted from oracleIRExecutorPlayerStepHandlers.ts.
// Cluster: applyPutOnBottomStep, applyMillStep.
// Public entries: applyPutOnBottomStep, applyMillStep.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { OracleIRReplayMutation } from './oracleIRReplayMutations';
import {
  buildPlayerZoneBridgeOptions,
  shuffleArray,
  withDiscardLedgerFlags,
} from './oracleIRExecutorPlayerStepShared';
import type { PlayerStepHandlerResult } from './oracleIRExecutorPlayerStepTypes';
import {
  millCardsForPlayer,
  resolvePlayers,
  resolveUnknownMillUntilAmountForPlayer,
} from './oracleIRExecutorPlayerUtils';
import { resolveOracleQuantity } from './oracleIRExecutorResolveQuantity';

export function applyPutOnBottomStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'put_on_bottom' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped put-on-bottom (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const whatText = step.what.kind === 'raw' ? String(step.what.text || '').trim().toLowerCase() : '';
  let nextState = state;
  const log: string[] = [];

  for (const playerId of players) {
    const player = nextState.players.find(entry => entry.id === playerId) as any;
    if (!player) {
      return {
        applied: false,
        message: `Skipped put-on-bottom (player not found): ${step.raw}`,
        reason: 'failed_to_apply',
      };
    }

    const library = Array.isArray(player.library) ? [...player.library] : [];
    const handIds = new Set(
      (Array.isArray(player.hand) ? player.hand : [])
        .map((card: any) => String(card?.id || '').trim())
        .filter(Boolean)
    );
    let restCards: any[] = [];

    if (whatText === 'the rest' || whatText === 'the rest of the cards') {
      const movedCards = Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : [];
      const movedIds = new Set(movedCards.map((card: any) => String(card?.id || '').trim()).filter(Boolean));
      if (movedIds.size > 0) {
        restCards = library.filter((card: any) => {
          const cardId = String(card?.id || '').trim();
          return movedIds.has(cardId) && !handIds.has(cardId);
        });
      } else {
        restCards = library.slice(0, Math.max(0, library.length - handIds.size));
      }
    } else {
      return {
        applied: false,
        message: `Skipped put-on-bottom (unsupported object selector): ${step.raw}`,
        reason: 'unsupported_object_selector',
      };
    }

    const remainingLibrary = library.filter((card: any) => !restCards.includes(card));
    const orderedRest = step.order === 'random' ? shuffleArray(restCards) : restCards;
    const updatedPlayers = nextState.players.map(entry => {
      if (entry.id !== playerId) return entry;
      return {
        ...(entry as any),
        library: [...remainingLibrary, ...orderedRest],
      } as any;
    });
    nextState = { ...nextState, players: updatedPlayers as any };
    log.push(`${playerId} put ${orderedRest.length} card(s) on the bottom of their library`);
  }

  return {
    applied: true,
    state: nextState,
    log,
  };
}

export function applyMillStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'mill' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  let players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0 && (/that player mills/i.test(String(step.raw || '')) || step.who?.kind === 'target_player')) {
    const boundPlayerId = String(
      ctx.targetPlayerId ||
        ctx.selectorContext?.targetPlayerId ||
        ctx.selectorContext?.targetOpponentId ||
        ''
    ).trim() as PlayerID;
    if (boundPlayerId && (state.players || []).some((player: any) => String(player?.id || '').trim() === boundPlayerId)) {
      players = [boundPlayerId];
    }
  }
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped mill (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const millCountByPlayer = new Map<PlayerID, number>();
  for (const playerId of players) {
    const millStep = step as Extract<OracleEffectStep, { kind: 'mill' }>;
    const ctxForPlayer: OracleIRExecutionContext = {
      ...ctx,
      selectorContext: {
        ...(ctx.selectorContext || {}),
        targetPlayerId: playerId,
      },
    };
    const resolvedCount =
      resolveOracleQuantity(state, ctx.controllerId, millStep.amount, ctxForPlayer, {
        whereX: millStep.whereX,
      }) ??
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
  const lastMilledCards: any[] = [];
  const bridgeOptions = buildPlayerZoneBridgeOptions(ctx, 'mill');
  let ledgerRecordedViaBridge = false;
  for (const playerId of players) {
    const amount = millCountByPlayer.get(playerId) ?? 0;
    const result = millCardsForPlayer(nextState, playerId, amount, bridgeOptions);
    if (result.halted) {
      return withDiscardLedgerFlags({
        applied: true,
        state: nextState,
        log,
      });
    }
    nextState = result.state;
    log.push(...result.log);
    if (result.ledgerRecordedViaBridge) ledgerRecordedViaBridge = true;
    nextState = result.state;
    log.push(...result.log);
    if (Array.isArray(result.milledCards) && result.milledCards.length > 0) {
      lastMilledCards.push(...result.milledCards);
    }
  }

  const unknownRaw = String((step.amount as any)?.raw || '').toLowerCase();
  const isRevealThisWay =
    step.amount.kind === 'reveal_until_land' ||
    (step.amount.kind === 'unknown' && unknownRaw.includes('reveal a land card'));
  const lastRevealedCardCount = isRevealThisWay
    ? Array.from(millCountByPlayer.values()).reduce((sum, count) => sum + (Number(count) || 0), 0)
    : undefined;
  const replayMutations: OracleIRReplayMutation[] = Array.from(millCountByPlayer.entries())
    .filter(([, count]) => Number(count) > 0)
    .map(([playerId, count]) => ({ kind: 'mill', playerId, count: Number(count) }));

  return withDiscardLedgerFlags({
    applied: true,
    state: nextState,
    log,
    lastRevealedCardCount,
    ...(lastMilledCards.length > 0 ? { lastMilledCards } : {}),
    ...(replayMutations.length > 0 ? { replayMutations } : {}),
  }, ledgerRecordedViaBridge);
}
