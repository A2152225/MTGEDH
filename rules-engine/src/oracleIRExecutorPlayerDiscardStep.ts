// Extracted from oracleIRExecutorPlayerStepHandlers.ts.
// Cluster: discardSelectorRequiresPlayerChoice, handCardMatchesDiscardTarget,
// buildDiscardSelectionOptionsForPlayer, collectDiscardSelectionOptionsForStep,
// buildDiscardSelectionOptions, applyDiscardStep.
// Public entries: discardSelectorRequiresPlayerChoice,
// buildDiscardSelectionOptionsForPlayer, collectDiscardSelectionOptionsForStep,
// buildDiscardSelectionOptions, applyDiscardStep.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep, OracleObjectSelector } from './oracleIR';
import { evaluateOracleStepUnlessCondition } from './oracleIRExecutorConditionalStepSupport';
import { cardMatchesLookChooseSelector } from './oracleIRExecutorPlayerLookChooseSelector';
import { getColorsFromObject } from './oracleIRExecutorManaUtils';
import {
  buildPlayerZoneBridgeOptions,
  filterChosenHandCardIds,
  getNormalizedChosenIds,
  resolveStepAmountForPlayer,
  withDiscardLedgerFlags,
} from './oracleIRExecutorPlayerStepShared';
import type { PlayerStepHandlerResult } from './oracleIRExecutorPlayerStepTypes';
import {
  discardCardsForPlayer,
  discardSpecificCardsForPlayer,
  quantityToNumber,
  resolvePlayers,
} from './oracleIRExecutorPlayerUtils';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';

export function discardSelectorRequiresPlayerChoice(
  step: Extract<OracleEffectStep, { kind: 'discard' }>,
): boolean {
  if ((step.amount as any)?.kind === 'any_number') return true;
  if ((step.amount as any)?.kind === 'all') return false;
  if (step.target) return true;

  const amountRaw = String((step.amount as any)?.raw || '').trim().toLowerCase();
  if (
    (step.amount as any)?.kind === 'reference_amount' &&
    /card with that name/.test(amountRaw)
  ) {
    return true;
  }

  const staticAmount = quantityToNumber(step.amount);
  return staticAmount === null || staticAmount > 0;
}

function cardMatchesChosenColorForDiscard(card: any, chosenColor: string): boolean {
  const normalized = String(chosenColor || '').trim().toLowerCase();
  if (!normalized) return false;
  const letterMap: Record<string, string> = {
    white: 'W',
    blue: 'U',
    black: 'B',
    red: 'R',
    green: 'G',
    w: 'W',
    u: 'U',
    b: 'B',
    r: 'R',
    g: 'G',
  };
  const letter = letterMap[normalized] || normalized.slice(0, 1).toUpperCase();
  return getColorsFromObject(card).some((entry) => String(entry || '').trim().toUpperCase() === letter);
}

function handCardMatchesDiscardTarget(
  card: any,
  target: OracleObjectSelector | undefined,
  ctx?: OracleIRExecutionContext,
): boolean {
  if (!target) return true;
  const text = String((target as any)?.text || (target as any)?.raw || '').trim();
  if (!text) return true;
  const normalized = text
    .replace(/^any number of\s+/i, '')
    .replace(/\s+cards?$/i, '')
    .trim();
  if (!normalized) return true;
  const chosenType = String(
    ctx?.selectorContext?.chosenCreatureType || (ctx as { chosenCreatureType?: string }).chosenCreatureType || '',
  ).trim();
  const chosenColor = String(
    ctx?.selectorContext?.chosenColor || (ctx as { chosenColor?: string }).chosenColor || '',
  ).trim();
  if (/of that color/i.test(text)) {
    return Boolean(chosenColor) && cardMatchesChosenColorForDiscard(card, chosenColor);
  }
  return cardMatchesLookChooseSelector(card, normalized, null, chosenType);
}

export function buildDiscardSelectionOptionsForPlayer(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'discard' }>,
  ctx: OracleIRExecutionContext,
  playerId: PlayerID,
): {
  readonly playerId: PlayerID;
  readonly options: readonly { id: string; label: string; description?: string; imageUrl?: string }[];
  readonly discardCount: number;
  readonly minDiscardCount?: number;
  readonly maxDiscardCount?: number;
  readonly anyNumberDiscard?: boolean;
  readonly currentHandSize: number;
  readonly maxHandSize: number;
} | null {
  const player = state.players.find((candidate) => candidate.id === playerId) as any;
  const hand = Array.isArray(player?.hand) ? player.hand : [];
  if (hand.length === 0) return null;

  const eligibleHand = step.target
    ? hand.filter((card: any) => handCardMatchesDiscardTarget(card, step.target, ctx))
    : hand;

  const options = eligibleHand
    .map((card: any) => {
      const id = String(card?.id || card?.card?.id || '').trim();
      if (!id) return null;
      const name = String(card?.name || card?.card?.name || 'Unknown').trim() || 'Unknown';
      return {
        id,
        label: name,
        description: name,
        imageUrl: card?.imageUrl || card?.image_url || card?.image_uris?.normal || card?.card?.image_uris?.normal,
      };
    })
    .filter((option): option is NonNullable<typeof option> => Boolean(option));

  if ((step.amount as any)?.kind === 'any_number') {
    if (options.length === 0) return null;
    return {
      playerId,
      options,
      discardCount: 0,
      minDiscardCount: 0,
      maxDiscardCount: options.length,
      anyNumberDiscard: true,
      currentHandSize: hand.length,
      maxHandSize: 0,
    };
  }

  if (options.length === 0) return null;

  const amount = resolveStepAmountForPlayer(
    state,
    ctx.controllerId,
    step.amount,
    ctx,
    playerId,
    { whereX: step.whereX },
  );
  if (amount === null || amount <= 0) return null;

  const discardCount = Math.min(Math.max(0, amount | 0), options.length);
  if (options.length <= discardCount) return null;

  return {
    playerId,
    options,
    discardCount,
    currentHandSize: options.length,
    maxHandSize: Math.max(0, options.length - discardCount),
  };
}

export function collectDiscardSelectionOptionsForStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'discard' }>,
  ctx: OracleIRExecutionContext,
): Array<NonNullable<ReturnType<typeof buildDiscardSelectionOptionsForPlayer>>> {
  const players = resolvePlayers(state, step.who, ctx);
  return players
    .map((playerId) => buildDiscardSelectionOptionsForPlayer(state, step, ctx, playerId))
    .filter((built): built is NonNullable<typeof built> => Boolean(built));
}

export function buildDiscardSelectionOptions(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'discard' }>,
  ctx: OracleIRExecutionContext,
): {
  readonly playerId: PlayerID;
  readonly options: readonly { id: string; label: string; description?: string; imageUrl?: string }[];
  readonly discardCount: number;
  readonly minDiscardCount?: number;
  readonly maxDiscardCount?: number;
  readonly anyNumberDiscard?: boolean;
  readonly currentHandSize: number;
  readonly maxHandSize: number;
} | null {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) return null;

  return buildDiscardSelectionOptionsForPlayer(state, step, ctx, players[0]);
}

export function applyDiscardStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'discard' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const bridgeOptions = buildPlayerZoneBridgeOptions(ctx, 'discard');
  const unlessCondition = step.unlessCondition;
  if (unlessCondition) {
    const unlessResult = evaluateOracleStepUnlessCondition(unlessCondition, state, ctx);
    if (unlessResult === true) {
      return {
        applied: true,
        state,
        log: [`Skipped discard (${unlessCondition.raw}): ${step.raw}`],
        lastDiscardedCardCount: 0,
        lastDiscardedCards: [],
      };
    }
    if (unlessResult === null) {
      return {
        applied: false,
        message: `Skipped discard (unsupported unless condition): ${step.raw}`,
        reason: 'unsupported_condition_clause',
      };
    }
  }

  if ((step.amount as any)?.kind === 'any_number') {
    const players = resolvePlayers(state, step.who, ctx);
    if (players.length === 0) {
      return {
        applied: false,
        message: `Skipped discard (unsupported player selector): ${step.raw}`,
        reason: 'unsupported_player_selector',
      };
    }

    const chosenIds = getNormalizedChosenIds(ctx);
    if (chosenIds.length === 0) {
      if (ctx.interactivePlayerChoices) {
        const built = buildDiscardSelectionOptions(state, step, ctx);
        if (!built || built.options.length === 0) {
          return {
            applied: true,
            state,
            log: [`${players[0]} discards 0 card(s): ${step.raw}`],
            lastDiscardedCardCount: 0,
            lastDiscardedCards: [],
          };
        }
      }
      return {
        applied: false,
        message: `Skipped discard (requires any-number card choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: {
          classification: 'player_choice',
          metadata: { minCards: 0, maxCards: Math.max(...players.map((playerId) => {
            const player = state.players.find(p => p.id === playerId) as any;
            return Array.isArray(player?.hand) ? player.hand.length : 0;
          }), 0) },
        },
      };
    }

    if (players.length !== 1) {
      return {
        applied: false,
        message: `Skipped discard (requires deterministic player binding): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }

    const validIds = new Set(
      (Array.isArray((state.players.find(p => p.id === players[0]) as any)?.hand)
        ? (state.players.find(p => p.id === players[0]) as any).hand
        : [])
        .filter((card: any) => handCardMatchesDiscardTarget(card, step.target, ctx))
        .map((card: any) => String(card?.id || '').trim())
        .filter(Boolean)
    );
    const filteredChosenIds = chosenIds.filter(id => validIds.has(id));

    const result = discardSpecificCardsForPlayer(state, players[0], filteredChosenIds, bridgeOptions);
    if (!result.applied) {
      return {
        applied: false,
        message: `Skipped discard (chosen card unavailable): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { persist: false },
      };
    }
    if (result.halted) {
      return withDiscardLedgerFlags({
        applied: true,
        state,
        log: [],
        lastDiscardedCardCount: 0,
        lastDiscardedCards: [],
      });
    }

    return withDiscardLedgerFlags({
      applied: true,
      state: result.state,
      log: result.log,
      lastDiscardedCardCount: result.discardedCount,
      lastGreatestDiscardedCardCount: result.discardedCount,
      lastDiscardedCards: result.discardedCards,
      lastMovedCards: result.discardedCards,
    }, result.ledgerRecordedViaBridge);
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped discard (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  if (step.amount.kind === 'all') {
    let nextState = state;
    const log: string[] = [];
    let totalDiscarded = 0;
    const allDiscarded: any[] = [];
    let ledgerRecordedViaBridge = false;
    for (const playerId of players) {
      const player = nextState.players.find((entry) => entry.id === playerId) as any;
      const hand = Array.isArray(player?.hand) ? [...player.hand] : [];
      const matching = step.target
        ? hand.filter((card: any) => handCardMatchesDiscardTarget(card, step.target, ctx))
        : hand;
      if (matching.length === 0) continue;
      const result = discardSpecificCardsForPlayer(
        nextState,
        playerId,
        matching.map((card: any) => String(card?.id || '').trim()).filter(Boolean),
        bridgeOptions
      );
      if (!result.applied) {
        return {
          applied: false,
          message: `Skipped discard (failed to apply): ${step.raw}`,
          reason: 'failed_to_apply',
        };
      }
      nextState = result.state;
      log.push(...result.log);
      totalDiscarded += result.discardedCount;
      allDiscarded.push(...result.discardedCards);
      if (result.ledgerRecordedViaBridge) ledgerRecordedViaBridge = true;
    }
    return withDiscardLedgerFlags(
      {
        applied: true,
        state: nextState,
        log,
        lastDiscardedCardCount: totalDiscarded,
        lastDiscardedCards: allDiscarded,
        lastMovedCards: allDiscarded,
      },
      ledgerRecordedViaBridge
    );
  }

  if (/discard your hand/i.test(String(step.raw || ''))) {
    let nextState = state;
    const log: string[] = [];
    let totalDiscarded = 0;
    const allDiscarded: any[] = [];
    let ledgerRecordedViaBridge = false;
    for (const playerId of players) {
      const player = nextState.players.find((entry) => entry.id === playerId) as any;
      const hand = Array.isArray(player?.hand) ? [...player.hand] : [];
      if (hand.length === 0) continue;
      const result = discardSpecificCardsForPlayer(
        nextState,
        playerId,
        hand.map((card: any) => String(card?.id || '').trim()).filter(Boolean),
        bridgeOptions
      );
      if (!result.applied) {
        return {
          applied: false,
          message: `Skipped discard (failed to apply): ${step.raw}`,
          reason: 'failed_to_apply',
        };
      }
      nextState = result.state;
      log.push(...result.log);
      totalDiscarded += result.discardedCount;
      allDiscarded.push(...result.discardedCards);
      if (result.ledgerRecordedViaBridge) ledgerRecordedViaBridge = true;
    }
    return withDiscardLedgerFlags(
      {
        applied: true,
        state: nextState,
        log,
        lastDiscardedCardCount: totalDiscarded,
        lastDiscardedCards: allDiscarded,
        lastMovedCards: allDiscarded,
      },
      ledgerRecordedViaBridge
    );
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
      message: `Skipped discard (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const amountRaw = String((step.amount as any)?.raw || '').trim().toLowerCase();
  if (
    (step.amount as any)?.kind === 'reference_amount' &&
    /card with that name/.test(amountRaw)
  ) {
    if (players.length !== 1) {
      return {
        applied: false,
        message: `Skipped discard (requires deterministic player binding): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }

    const chosenName = String(ctx.selectorContext?.chosenCardName || '').trim().toLowerCase();
    if (!chosenName) {
      return {
        applied: false,
        message: `Skipped discard (requires chosen card name): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }

    const player = state.players.find((p) => p.id === players[0]) as any;
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    const nameMatches = hand.filter(
      (card: any) => String(card?.name || card?.card?.name || '').trim().toLowerCase() === chosenName
    );
    if (nameMatches.length === 0) {
      return {
        applied: false,
        message: `Skipped discard (no card with chosen name in hand): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    if (nameMatches.length === 1) {
      const result = discardSpecificCardsForPlayer(state, players[0], [
        String(nameMatches[0]?.id || '').trim(),
      ].filter(Boolean), bridgeOptions);
      if (!result.applied) {
        return {
          applied: false,
          message: `Skipped discard (chosen card unavailable): ${step.raw}`,
          reason: 'failed_to_apply',
          options: { persist: false },
        };
      }
      if (result.halted) {
        return withDiscardLedgerFlags({
          applied: true,
          state,
          log: [],
          lastDiscardedCardCount: 0,
          lastDiscardedCards: [],
        });
      }
      return withDiscardLedgerFlags({
        applied: true,
        state: result.state,
        log: result.log,
        lastDiscardedCardCount: result.discardedCount,
        lastGreatestDiscardedCardCount: result.discardedCount,
        lastDiscardedCards: result.discardedCards,
        lastMovedCards: result.discardedCards,
      }, result.ledgerRecordedViaBridge);
    }

    return {
      applied: false,
      message: `Skipped discard (requires chosen card binding): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  if (step.target) {
    if (players.length !== 1) {
      return {
        applied: false,
        message: `Skipped discard (requires deterministic player binding): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }

    let chosenIds = getNormalizedChosenIds(ctx);
    chosenIds = filterChosenHandCardIds(state, players[0], chosenIds);
    const targetText = String((step.target as any)?.text || '').trim().toLowerCase();
    if (
      chosenIds.length !== Math.max(0, amount | 0) &&
      /^(?:that card|it)$/.test(targetText)
    ) {
      const chosenName = String(ctx.selectorContext?.chosenCardName || '').trim().toLowerCase();
      if (chosenName) {
        const player = state.players.find((p) => p.id === players[0]) as any;
        const hand = Array.isArray(player?.hand) ? player.hand : [];
        const nameMatches = hand.filter(
          (card: any) => String(card?.name || card?.card?.name || '').trim().toLowerCase() === chosenName
        );
        if (nameMatches.length === 1) {
          chosenIds = [String(nameMatches[0]?.id || '').trim()].filter(Boolean);
        }
      }
    }
    if (chosenIds.length !== Math.max(0, amount | 0)) {
      return {
        applied: false,
        message: `Skipped discard (requires chosen card binding): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }

    const result = discardSpecificCardsForPlayer(state, players[0], chosenIds, bridgeOptions);
    if (!result.applied) {
      return {
        applied: false,
        message: `Skipped discard (chosen card unavailable): ${step.raw}`,
        reason: 'failed_to_apply',
        options: {
          persist: false,
          metadata: {
            missingCardIds: [...result.missingCardIds],
          },
        },
      };
    }
    if (result.halted) {
      return withDiscardLedgerFlags({
        applied: true,
        state,
        log: [],
        lastDiscardedCardCount: 0,
        lastDiscardedCards: [],
      });
    }

    return withDiscardLedgerFlags({
      applied: true,
      state: result.state,
      log: result.log,
      lastDiscardedCardCount: result.discardedCount,
      lastGreatestDiscardedCardCount: result.discardedCount,
      lastDiscardedCards: result.discardedCards,
      lastMovedCards: result.discardedCards,
    }, result.ledgerRecordedViaBridge);
  }

  let chosenIds = getNormalizedChosenIds(ctx);
  if (players.length === 1) {
    chosenIds = filterChosenHandCardIds(state, players[0], chosenIds);
  }
  if (chosenIds.length === Math.max(0, amount | 0)) {
    if (players.length !== 1) {
      return {
        applied: false,
        message: `Skipped discard (requires deterministic player binding): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }

    const result = discardSpecificCardsForPlayer(state, players[0], chosenIds, bridgeOptions);
    if (!result.applied) {
      return {
        applied: false,
        message: `Skipped discard (chosen card unavailable): ${step.raw}`,
        reason: 'failed_to_apply',
        options: {
          persist: false,
          metadata: {
            missingCardIds: [...result.missingCardIds],
          },
        },
      };
    }
    if (result.halted) {
      return withDiscardLedgerFlags({
        applied: true,
        state,
        log: [],
        lastDiscardedCardCount: 0,
        lastDiscardedCards: [],
      });
    }

    return withDiscardLedgerFlags({
      applied: true,
      state: result.state,
      log: result.log,
      lastDiscardedCardCount: result.discardedCount,
      lastGreatestDiscardedCardCount: result.discardedCount,
      lastDiscardedCards: result.discardedCards,
      lastMovedCards: result.discardedCards,
    }, result.ledgerRecordedViaBridge);
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
  let greatestDiscarded = 0;
  const discardedCards: any[] = [];
  let ledgerRecordedViaBridge = false;
  for (const playerId of players) {
    const result = discardCardsForPlayer(nextState, playerId, amount, bridgeOptions);
    if (result.halted) {
      return withDiscardLedgerFlags({
        applied: true,
        state: nextState,
        log,
        lastDiscardedCardCount: 0,
        lastDiscardedCards: [],
      });
    }
    nextState = result.state;
    const discardedCount = Math.max(0, Number(result.discardedCount) || 0);
    totalDiscarded += discardedCount;
    greatestDiscarded = Math.max(greatestDiscarded, discardedCount);
    if (result.ledgerRecordedViaBridge) ledgerRecordedViaBridge = true;
    if (Array.isArray(result.discardedCards)) discardedCards.push(...result.discardedCards);
    log.push(...result.log);
  }

  return withDiscardLedgerFlags({
    applied: true,
    state: nextState,
    log,
    lastDiscardedCardCount: totalDiscarded,
    lastGreatestDiscardedCardCount: greatestDiscarded,
    lastDiscardedCards: discardedCards,
    lastMovedCards: discardedCards,
  }, ledgerRecordedViaBridge);
}
