// Extracted from oracleIRExecutorPlayerStepHandlers.ts.
// Cluster: applyLookChooseFromTopStep (+ exclusive
// buildLookChooseFromTopSelectionOptions, lookChooseFromTopRequiresPlayerChoice,
// resolveLookChooseAmount).
// Public entries: applyLookChooseFromTopStep, buildLookChooseFromTopSelectionOptions.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleClauseCondition, OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  commitCardZoneChanges,
  commitLookSelectRestZoneChanges,
} from './oracleIRExecutorCardZoneTransitionCommit';
import type { ModifyPtRuntime } from './oracleIRExecutorModifyPtStepHandlers';
import { evaluateModifyPtWhereX } from './oracleIRExecutorModifyPtWhereEvaluator';
import {
  buildLookChooseLibrarySearchFilter,
  parseLookChooseSelectionLimits,
} from './oracleIRExecutorPlayerLookChooseLimits';
import {
  cardMatchesLookChooseSelector,
  resolveLookChooseManaValueLimit,
} from './oracleIRExecutorPlayerLookChooseSelector';
import {
  getNormalizedChosenIds,
  shuffleArray,
  withDiscardLedgerFlags,
} from './oracleIRExecutorPlayerStepShared';
import type { PlayerStepHandlerResult } from './oracleIRExecutorPlayerStepTypes';
import {
  readPlayerZoneCards,
  resolvePlayers,
  resolveRevealUntilReferenceAmountForPlayer,
  writePlayerZoneCards,
} from './oracleIRExecutorPlayerUtils';
import { resolveOracleQuantity } from './oracleIRExecutorResolveQuantity';
import { usedOracleIrServerBridge } from './oracleIRStepLedgerRuntime';

export function buildLookChooseFromTopSelectionOptions(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'look_choose_from_top' }>,
  ctx: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime
): {
  readonly playerId: PlayerID;
  readonly lookedCount: number;
  readonly availableCards: readonly any[];
  readonly selectableCardIds: readonly string[];
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly destination: 'hand' | 'exile' | 'battlefield';
  readonly filter: ReturnType<typeof buildLookChooseLibrarySearchFilter>;
  readonly restOrder?: 'any';
  readonly contextValue?: number;
} | null {
  const amount = resolveLookChooseAmount(state, step, ctx, runtime);
  if (amount === null || amount <= 0) return null;

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) return null;

  const playerId = players[0];
  const player = state.players.find(entry => entry.id === playerId) as any;
  if (!player) return null;

  const library = Array.isArray(player.library) ? player.library : [];
  const lookedCount = Math.max(0, Math.min(library.length, amount | 0));
  if (lookedCount <= 0) return null;

  const lookedCards = library.slice(0, lookedCount);
  const chosenCreatureType = String(ctx.selectorContext?.chosenCreatureType || '').trim();
  const manaValueLimit = resolveLookChooseManaValueLimit(state, playerId, step.selectorText, ctx);
  const selectableCardIds = lookedCards
    .filter(card => cardMatchesLookChooseSelector(card, step.selectorText, manaValueLimit, chosenCreatureType))
    .map(card => String(card?.id || '').trim())
    .filter(Boolean);
  const limits = parseLookChooseSelectionLimits(step.selectorText, step.optional === true);
  const maxSelections = Math.min(limits.maxSelections, Math.max(selectableCardIds.length, limits.minSelections));

  return {
    playerId,
    lookedCount,
    availableCards: lookedCards,
    selectableCardIds,
    minSelections: limits.minSelections,
    maxSelections,
    destination: step.destination,
    filter: buildLookChooseLibrarySearchFilter(step.selectorText),
    ...(step.restOrder === 'any' ? { restOrder: 'any' as const } : {}),
    ...(step.destination === 'battlefield' && manaValueLimit !== null
      ? { contextValue: manaValueLimit }
      : {}),
  };
}

function lookChooseFromTopRequiresPlayerChoice(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'look_choose_from_top' }>,
  ctx: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime
): boolean {
  if (ctx.interactivePlayerChoices === false) return false;

  if (
    usedOracleIrServerBridge(ctx)
    && step.destination === 'battlefield'
    && step.amount?.kind === 'reference_amount'
  ) {
    const builtRevealUntil = buildLookChooseFromTopSelectionOptions(state, step, ctx, runtime);
    return Boolean(builtRevealUntil && builtRevealUntil.selectableCardIds.length > 0);
  }

  if (step.optional === true && ctx.deferOptionalLookChoices !== true) return false;
  const built = buildLookChooseFromTopSelectionOptions(state, step, ctx, runtime);
  if (!built) return false;
  if (built.selectableCardIds.length === 0) return false;

  const chosenLookedIds = getNormalizedChosenIds(ctx).filter((id) =>
    built.availableCards.some((card) => String(card?.id || '').trim() === id)
  );
  if (chosenLookedIds.length > 0) return false;

  if (step.optional === true) return true;
  return built.selectableCardIds.length > built.maxSelections;
}

export function resolveLookChooseAmount(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'look_choose_from_top' }>,
  ctx: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime
): number | null {
  if (step.amount.kind === 'reference_amount') {
    const players = resolvePlayers(state, step.who, ctx);
    if (players.length !== 1) return null;
    const untilReveal = resolveRevealUntilReferenceAmountForPlayer(
      state,
      players[0],
      step.amount,
      ctx,
    );
    return untilReveal?.count ?? null;
  }

  const resolved = resolveOracleQuantity(state, ctx.controllerId, step.amount, ctx, {
    runtime,
    whereX: (step as { whereX?: OracleClauseCondition }).whereX,
  });
  if (resolved !== null) return resolved;

  if (step.amount.kind !== 'x') return null;

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

export function applyLookChooseFromTopStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'look_choose_from_top' }>,
  ctx: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime
): PlayerStepHandlerResult {
  const amount = resolveLookChooseAmount(state, step, ctx, runtime);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped look-choose-from-top (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped look-choose-from-top (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  if (lookChooseFromTopRequiresPlayerChoice(state, step, ctx, runtime)) {
    return {
      applied: false,
      message: `Skipped look-choose-from-top (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const chosenIds = new Set(getNormalizedChosenIds(ctx));
  let nextState = state;
  const log: string[] = [];
  const movedCards: any[] = [];
  let ledgerRecordedViaBridge = false;
  const bridgeOptions = usedOracleIrServerBridge(ctx)
    ? { ctx, stepIndex: Number(ctx.currentStepIndex), stepKind: step.kind }
    : undefined;

  for (const playerId of players) {
    const player = nextState.players.find(entry => entry.id === playerId) as any;
    if (!player) {
      return {
        applied: false,
        message: `Skipped look-choose-from-top (player not found): ${step.raw}`,
        reason: 'failed_to_apply',
      };
    }

    const library = readPlayerZoneCards(nextState, playerId, player, 'library');
    const lookedCount = Math.max(0, Math.min(library.length, amount | 0));
    let lookedCards = library.slice(0, lookedCount);
    const chosenCards: any[] = [];
    const chosenCreatureType = String(ctx.selectorContext?.chosenCreatureType || '').trim();
    const manaValueLimit = resolveLookChooseManaValueLimit(nextState, playerId, step.selectorText, ctx);
    const nonMatchRest = (step as { nonMatchRest?: string }).nonMatchRest || 'library_bottom';

    if (chosenIds.size > 0) {
      for (const card of lookedCards) {
        const cardId = String(card?.id || '').trim();
        if (!cardId || !chosenIds.has(cardId)) continue;
        if (!cardMatchesLookChooseSelector(card, step.selectorText, manaValueLimit, chosenCreatureType)) continue;
        chosenCards.push(card);
      }
      const chosenCardIds = new Set(chosenCards.map(card => String(card?.id || '').trim()).filter(Boolean));
      lookedCards = lookedCards.filter(card => !chosenCardIds.has(String(card?.id || '').trim()));
    } else if (step.optional !== true || ctx.deferOptionalLookChoices !== true) {
      const chosenIndex = lookedCards.findIndex(
        card => cardMatchesLookChooseSelector(card, step.selectorText, manaValueLimit, chosenCreatureType),
      );
      if (chosenIndex >= 0) {
        chosenCards.push(lookedCards.splice(chosenIndex, 1)[0]);
      }
    }

    const restCards = [...lookedCards];

    if (
      chosenCards.length === 0
      && restCards.length > 0
      && nonMatchRest === 'library_top'
    ) {
      log.push(`${playerId} looks at ${lookedCount} card(s) and keeps them on top of their library`);
      continue;
    }
    const bottomedRest = step.restOrder === 'any' ? restCards : shuffleArray(restCards);
    const stepIndex = bridgeOptions?.stepIndex;
    const canBridgeZone = (step.destination === 'hand' || step.destination === 'exile' || step.destination === 'battlefield')
      && bridgeOptions?.ctx?.serverBridge
      && Number.isFinite(stepIndex);
    const canBridgeChosen = canBridgeZone && chosenCards.length > 0;

    const bridgeLookChooseRest = (): boolean => {
      if (!canBridgeZone || restCards.length === 0) return false;
      if (nonMatchRest === 'graveyard') {
        const restCommit = commitLookSelectRestZoneChanges({
          state: nextState,
          playerId,
          rest: restCards,
          destination: step.destination === 'exile' ? 'exile' : 'hand',
          restDestination: 'graveyard',
          restToTop: false,
          restRandomOrder: false,
          stepIndex: Number(stepIndex),
          stepKind: String(bridgeOptions?.stepKind || 'look_choose_from_top'),
          cause: 'oracle_ir:look_choose_from_top_non_match',
          ctx: bridgeOptions?.ctx,
        });
        if (restCommit.halted) return true;
        nextState = restCommit.state;
        movedCards.push(...restCards);
        if (restCommit.ledgerRecordedViaBridge) {
          ledgerRecordedViaBridge = true;
        }
        log.push(`${playerId} looks at ${lookedCount} card(s) and puts ${restCards.length} into their graveyard`);
        return true;
      }
      const restCommit = commitLookSelectRestZoneChanges({
        state: nextState,
        playerId,
        rest: restCards,
        destination: step.destination === 'exile' ? 'exile' : 'hand',
        restDestination: 'library',
        restLibraryPlacement: 'bottom',
        restRandomOrder: step.restOrder !== 'any',
        stepIndex: Number(stepIndex),
        stepKind: String(bridgeOptions?.stepKind || 'look_choose_from_top'),
        cause: 'oracle_ir:look_choose_from_top_rest',
        ctx: bridgeOptions?.ctx,
      });
      if (restCommit.halted) return true;
      nextState = restCommit.state;
      if (restCommit.ledgerRecordedViaBridge) {
        ledgerRecordedViaBridge = true;
      }
      return false;
    };

    if (canBridgeChosen) {
      const commitResult = commitCardZoneChanges({
        state: nextState,
        playerId,
        cards: chosenCards.map((card: any) => ({ ...card, ownerId: playerId, owner: playerId })),
        sourceZone: 'library',
        intendedDestination: step.destination === 'hand'
          ? 'hand'
          : step.destination === 'exile'
            ? 'exile'
            : 'battlefield',
        stepIndex: Number(stepIndex),
        stepKind: String(bridgeOptions?.stepKind || 'look_choose_from_top'),
        cause: 'oracle_ir:look_choose_from_top',
        ctx: bridgeOptions?.ctx,
      });
      if (commitResult.halted) {
        return withDiscardLedgerFlags({
          applied: true,
          state: nextState,
          log,
          ...(movedCards.length > 0 ? { lastMovedCards: movedCards } : {}),
        }, ledgerRecordedViaBridge);
      }

      nextState = commitResult.state;
      movedCards.push(...commitResult.movedCards);
      stampLookChooseExileGrantFlags(commitResult.movedCards, step, ctx);
      if (commitResult.ledgerRecordedViaBridge) {
        ledgerRecordedViaBridge = true;
      }

      if (bridgeLookChooseRest()) {
        return withDiscardLedgerFlags({
          applied: true,
          state: nextState,
          log,
          ...(movedCards.length > 0 ? { lastMovedCards: movedCards } : {}),
        }, ledgerRecordedViaBridge);
      }

      const actionText = commitResult.movedCards.length > 0
        ? `${step.destination === 'hand' ? `puts ${commitResult.movedCards.length} matching card(s) into their hand` : `exiles ${commitResult.movedCards.length} matching card(s)`}`
        : 'does not find a matching card';
      log.push(
        `${playerId} looks at ${lookedCount} card(s), ${actionText}, and puts ${bottomedRest.length} on the bottom of their library in ${step.restOrder === 'any' ? 'any' : 'a random'} order`
      );
      continue;
    }

    if (canBridgeZone && chosenCards.length === 0 && restCards.length > 0) {
      if (bridgeLookChooseRest()) {
        return withDiscardLedgerFlags({
          applied: true,
          state: nextState,
          log,
          ...(movedCards.length > 0 ? { lastMovedCards: movedCards } : {}),
        }, ledgerRecordedViaBridge);
      }

      log.push(
        `${playerId} looks at ${lookedCount} card(s), does not find a matching card, and puts ${bottomedRest.length} on the bottom of their library in ${step.restOrder === 'any' ? 'any' : 'a random'} order`
      );
      continue;
    }

    const hand = readPlayerZoneCards(nextState, playerId, player, 'hand');
    const exile = readPlayerZoneCards(nextState, playerId, player, 'exile');
    const graveyard = readPlayerZoneCards(nextState, playerId, player, 'graveyard');
    let nextHand = [...hand];
    let nextExile = [...exile];
    let nextGraveyard = [...graveyard];
    let nextLibrary = library.slice(lookedCount);

    for (const chosenCard of chosenCards) {
      movedCards.push(chosenCard);
      if (step.destination === 'hand') {
        nextHand.push(chosenCard);
      } else {
        nextExile.push(chosenCard);
      }
    }
    stampLookChooseExileGrantFlags(chosenCards, step, ctx);

    if (restCards.length > 0 && nonMatchRest === 'graveyard') {
      nextGraveyard.push(...restCards);
      movedCards.push(...restCards);
      writePlayerZoneCards(nextState, playerId, player, 'graveyard', nextGraveyard);
      writePlayerZoneCards(nextState, playerId, player, 'library', library.slice(lookedCount));
      writePlayerZoneCards(nextState, playerId, player, 'hand', nextHand);
      writePlayerZoneCards(nextState, playerId, player, 'exile', nextExile);
      log.push(`${playerId} looks at ${lookedCount} card(s) and puts ${restCards.length} into their graveyard`);
      continue;
    }

    nextLibrary = [...nextLibrary, ...bottomedRest];
    writePlayerZoneCards(nextState, playerId, player, 'library', nextLibrary);
    writePlayerZoneCards(nextState, playerId, player, 'hand', nextHand);
    writePlayerZoneCards(nextState, playerId, player, 'exile', nextExile);

    const actionText = chosenCards.length > 0
      ? `${step.destination === 'hand' ? `puts ${chosenCards.length} matching card(s) into their hand` : `exiles ${chosenCards.length} matching card(s)`}`
      : 'does not find a matching card';
    log.push(
      `${playerId} looks at ${lookedCount} card(s), ${actionText}, and puts ${bottomedRest.length} on the bottom of their library in ${step.restOrder === 'any' ? 'any' : 'a random'} order`
    );
  }

  return withDiscardLedgerFlags({
    applied: true,
    state: nextState,
    log,
    ...(movedCards.length > 0 ? { lastMovedCards: movedCards } : {}),
  }, ledgerRecordedViaBridge);
}

function stampLookChooseExileGrantFlags(
  cards: readonly any[],
  step: Extract<OracleEffectStep, { kind: 'look_choose_from_top' }>,
  ctx: OracleIRExecutionContext,
): void {
  if (step.destination !== 'exile') return;
  const raw = String(step.raw || '');
  const faceDown = /face down/i.test(raw);
  const grantPlay = /you may play the exiled card/i.test(raw);
  const anyMana = /mana as though it were mana of any/i.test(raw);
  if (!faceDown && !grantPlay && !anyMana) return;
  for (const card of cards) {
    if (!card || typeof card !== 'object') continue;
    if (faceDown) card.faceDown = true;
    if (grantPlay) card.canBePlayedBy = ctx.controllerId;
    if (anyMana) card.spendManaAsThoughAnyType = true;
  }
}
