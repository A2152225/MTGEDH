// Extracted from oracleIRExecutorPlayerStepHandlers.ts.
// Cluster: applySurveilStep, applyLookSelectTopStep, applyLookTopStep, applyRevealTopStep.
// Public entries: applySurveilStep, applyLookSelectTopStep, applyLookTopStep, applyRevealTopStep.

import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { commitLibraryTopObservation } from './oracleIRExecutorCardZoneTransitionCommit';
import type { ModifyPtRuntime } from './oracleIRExecutorModifyPtStepHandlers';
import {
  lookSelectTopRequiresPlayerChoice,
  resolveLookSelectAmount,
} from './oracleIRExecutorPlayerLookSelectTopOptions';
import {
  getNormalizedChosenIds,
  resolveStepAmountForPlayer,
  withDiscardLedgerFlags,
} from './oracleIRExecutorPlayerStepShared';
import type { PlayerStepHandlerResult } from './oracleIRExecutorPlayerStepTypes';
import {
  collectTopLibraryObservationForPlayers,
  lookSelectTopCardsForPlayer,
  quantityToNumber,
  readPlayerZoneCards,
  resolvePlayers,
  resolveRevealUntilReferenceAmountForPlayer,
} from './oracleIRExecutorPlayerUtils';
import { resolveThatManyRevealAmountForPlayer } from './oracleIRExecutorRevealThatManyAmount';
import { resolveOracleQuantity } from './oracleIRExecutorResolveQuantity';
import { usedOracleIrServerBridge } from './oracleIRStepLedgerRuntime';

export function applySurveilStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'surveil' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped surveil (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const amount = resolveStepAmountForPlayer(
    state,
    ctx.controllerId,
    step.amount,
    ctx,
    players[0],
    { whereX: step.whereX },
  );
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped surveil (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  if (amount <= 0) {
    return {
      applied: true,
      state,
      log: [`Surveil ${amount} (no-op): ${step.raw}`],
    };
  }

  if (ctx.selectorContext?.surveilResolutionComplete === true) {
    const keepTopOrder = Array.isArray(ctx.selectorContext?.keepTopOrder)
      ? ctx.selectorContext.keepTopOrder
      : [];
    const toGraveyard = Array.isArray(ctx.selectorContext?.toGraveyard)
      ? ctx.selectorContext.toGraveyard
      : [];
    const lookedCount = keepTopOrder.length + toGraveyard.length;
    return {
      applied: true,
      state,
      log: [`Surveil ${lookedCount} (resolution applied): ${step.raw}`],
      skipLedgerFlush: true,
    };
  }

  const { cards: observedCards } = collectTopLibraryObservationForPlayers(state, players, amount);
  const observationCarryOver = observedCards.length > 0 ? { lastMovedCards: observedCards } : {};
  let ledgerRecordedViaBridge = false;
  const bridgeOptions = usedOracleIrServerBridge(ctx)
    ? { ctx, stepIndex: Number(ctx.currentStepIndex), stepKind: step.kind }
    : undefined;

  const wouldNeedChoice = players.some(playerId => {
    const player = state.players.find(p => p.id === playerId) as any;
    const libraryLength = Array.isArray(player?.library) ? player.library.length : 0;
    return libraryLength > 0;
  });

  if (wouldNeedChoice) {
    if (bridgeOptions && observedCards.length > 0 && Number.isFinite(bridgeOptions.stepIndex)) {
      const observation = commitLibraryTopObservation({
        playerId: ctx.controllerId,
        cards: observedCards,
        stepIndex: Number(bridgeOptions.stepIndex),
        stepKind: String(bridgeOptions.stepKind || 'surveil'),
        cause: 'oracle_ir:surveil',
        ctx: bridgeOptions.ctx,
      });
      if (observation.halted) {
        return withDiscardLedgerFlags({
          applied: true,
          state,
          log: [`Surveil ${amount} halted for replacement: ${step.raw}`],
        }, ledgerRecordedViaBridge);
      }
      if (observation.ledgerRecordedViaBridge) {
        ledgerRecordedViaBridge = true;
      }
    }
    return withDiscardLedgerFlags({
      applied: false,
      message: `Skipped surveil (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
      ...observationCarryOver,
    }, ledgerRecordedViaBridge);
  }

  return {
    applied: true,
    state,
    log: [`Surveil ${amount} (no cards in library): ${step.raw}`],
  };
}

export function applyLookSelectTopStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'look_select_top' }>,
  ctx: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime
): PlayerStepHandlerResult {
  const amount = resolveLookSelectAmount(state, step, ctx, runtime);
  const choose = quantityToNumber(step.choose, ctx);
  if (amount === null || choose === null) {
    return {
      applied: false,
      message: `Skipped look-select-top (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped look-select-top (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  if (lookSelectTopRequiresPlayerChoice(state, step, ctx, runtime)) {
    return {
      applied: false,
      message: `Skipped look-select-top (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const chosenObjectIds = getNormalizedChosenIds(ctx);
  let nextState = state;
  const log: string[] = [];
  const chosenCards: any[] = [];
  let ledgerRecordedViaBridge = false;
  const bridgeOptions = usedOracleIrServerBridge(ctx)
    ? { ctx, stepIndex: Number(ctx.currentStepIndex), stepKind: step.kind }
    : undefined;

  for (const playerId of players) {
    const result = lookSelectTopCardsForPlayer(
      nextState,
      playerId,
      amount,
      choose,
      step.destination,
      step.restDestination,
      Boolean(step.restToTop),
      Boolean(step.restRandomOrder),
      bridgeOptions,
      chosenObjectIds,
    );
    if ((result as { halted?: boolean }).halted) {
      return withDiscardLedgerFlags({
        applied: true,
        state: nextState,
        log,
        ...(chosenCards.length > 0 ? { lastMovedCards: chosenCards } : {}),
      }, ledgerRecordedViaBridge);
    }
    nextState = result.state;
    log.push(...result.log);
    if (Array.isArray(result.chosen) && result.chosen.length > 0) {
      chosenCards.push(...result.chosen);
    }
    if ((result as { ledgerRecordedViaBridge?: boolean }).ledgerRecordedViaBridge) {
      ledgerRecordedViaBridge = true;
    }
  }

  return withDiscardLedgerFlags({
    applied: true,
    state: nextState,
    log,
    ...(chosenCards.length > 0 ? { lastMovedCards: chosenCards } : {}),
  }, ledgerRecordedViaBridge);
}

export function applyLookTopStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'look_top' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const amount = resolveOracleQuantity(state, ctx.controllerId, step.amount, ctx, {
    whereX: step.whereX,
  });
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped look-top (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped look-top (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const log: string[] = [];
  const lastMovedCards: any[] = [];
  let ledgerRecordedViaBridge = false;
  const bridgeOptions = usedOracleIrServerBridge(ctx)
    ? { ctx, stepIndex: Number(ctx.currentStepIndex), stepKind: step.kind }
    : undefined;

  for (const playerId of players) {
    const player = state.players.find(entry => entry.id === playerId) as any;
    const library = Array.isArray(player?.library) ? player.library : [];
    const looked = Math.max(0, Math.min(library.length, amount | 0));
    if (looked > 0) {
      lastMovedCards.push(...library.slice(0, looked));
    }
    log.push(`${playerId} looks at the top ${looked} card(s) of their library`);
  }

  if (bridgeOptions && lastMovedCards.length > 0 && Number.isFinite(bridgeOptions.stepIndex)) {
    const observation = commitLibraryTopObservation({
      playerId: ctx.controllerId,
      cards: lastMovedCards,
      stepIndex: Number(bridgeOptions.stepIndex),
      stepKind: String(bridgeOptions.stepKind || 'look_top'),
      cause: 'oracle_ir:look_top',
      ctx: bridgeOptions.ctx,
    });
    if (observation.halted) {
      return withDiscardLedgerFlags({
        applied: true,
        state,
        log,
        ...(players.length === 1 ? { lastTopLibraryOwnerId: players[0] } : {}),
      }, ledgerRecordedViaBridge);
    }
    if (observation.ledgerRecordedViaBridge) {
      ledgerRecordedViaBridge = true;
    }
  }

  return withDiscardLedgerFlags({
    applied: true,
    state,
    log,
    ...(players.length === 1 ? { lastTopLibraryOwnerId: players[0] } : {}),
    ...(lastMovedCards.length > 0 ? { lastMovedCards } : {}),
  }, ledgerRecordedViaBridge);
}

export function applyRevealTopStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'reveal_top' }>,
  ctx: OracleIRExecutionContext,
  lastMovedCountByPlayer?: Readonly<Record<string, number>>,
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped reveal-top (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const log: string[] = [];
  let totalRevealed = 0;
  const revealedCards: any[] = [];
  let ledgerRecordedViaBridge = false;
  const bridgeOptions = usedOracleIrServerBridge(ctx)
    ? { ctx, stepIndex: Number(ctx.currentStepIndex), stepKind: step.kind }
    : undefined;

  for (const playerId of players) {
    const untilReveal = resolveRevealUntilReferenceAmountForPlayer(state, playerId, step.amount, ctx);
    if (untilReveal) {
      totalRevealed += untilReveal.count;
      revealedCards.push(
        ...untilReveal.cards.map((card: any) => ({
          ...card,
          owner: card?.owner ?? playerId,
          ownerId: card?.ownerId ?? playerId,
        }))
      );
      const revealedNames = untilReveal.cards
        .map((card: any) => String(card?.name || 'unknown card').trim() || 'unknown card');
      log.push(
        revealedNames.length > 0
          ? `${playerId} reveals ${revealedNames.join(', ')}`
          : `${playerId} reveals no cards from the top of their library`
      );
      continue;
    }

    const thatManyAmount = resolveThatManyRevealAmountForPlayer({
      playerId,
      amount: step.amount,
      stepRaw: step.raw,
      ctx,
      lastMovedCountByPlayer,
    });
    const amount =
      typeof thatManyAmount === 'number' && Number.isFinite(thatManyAmount)
        ? thatManyAmount
        : resolveOracleQuantity(state, ctx.controllerId, step.amount, ctx, {
            whereX: step.whereX,
          });
    if (amount === null) {
      return {
        applied: false,
        message: `Skipped reveal-top (unknown amount): ${step.raw}`,
        reason: 'unknown_amount',
        options: { classification: 'ambiguous' },
      };
    }

    const player = state.players.find(entry => entry.id === playerId) as any;
    const library = readPlayerZoneCards(state, playerId, player, 'library');
    const revealedCount = Math.max(0, Math.min(library.length, amount | 0));
    totalRevealed += revealedCount;
    if (revealedCount > 0) {
      revealedCards.push(
        ...library.slice(0, revealedCount).map((card: any) => ({
          ...card,
          owner: card?.owner ?? playerId,
          ownerId: card?.ownerId ?? playerId,
        }))
      );
    }
    const revealedNames = library
      .slice(0, revealedCount)
      .map((card: any) => String(card?.name || 'unknown card').trim() || 'unknown card');
    log.push(
      revealedCount > 0
        ? `${playerId} reveals ${revealedNames.join(', ')}`
        : `${playerId} reveals no cards from the top of their library`
    );
  }

  if (bridgeOptions && revealedCards.length > 0 && Number.isFinite(bridgeOptions.stepIndex)) {
    for (const playerId of players) {
      const playerRevealed = revealedCards.filter((card: any) => {
        const ownerId = String(card?.owner || card?.ownerId || playerId).trim();
        return ownerId === playerId;
      });
      if (playerRevealed.length === 0 && players.length === 1) {
        playerRevealed.push(...revealedCards);
      }
      if (playerRevealed.length === 0) continue;
      const observation = commitLibraryTopObservation({
        playerId,
        cards: playerRevealed,
        stepIndex: Number(bridgeOptions.stepIndex),
        stepKind: String(bridgeOptions.stepKind || 'reveal_top'),
        cause: 'oracle_ir:reveal_top',
        ctx: bridgeOptions.ctx,
      });
      if (observation.halted) {
        return withDiscardLedgerFlags({
          applied: true,
          state,
          log,
          lastRevealedCardCount: totalRevealed,
          ...(revealedCards.length > 0 ? { lastMovedCards: revealedCards, lastRevealedCards: revealedCards } : {}),
          ...(players.length === 1 ? { lastTopLibraryOwnerId: players[0] } : {}),
        }, ledgerRecordedViaBridge);
      }
      if (observation.ledgerRecordedViaBridge) {
        ledgerRecordedViaBridge = true;
      }
    }
  }

  return withDiscardLedgerFlags({
    applied: true,
    state,
    log,
    lastRevealedCardCount: totalRevealed,
    ...(revealedCards.length > 0 ? { lastMovedCards: revealedCards, lastRevealedCards: revealedCards } : {}),
    ...(players.length === 1 ? { lastTopLibraryOwnerId: players[0] } : {}),
  }, ledgerRecordedViaBridge);
}
