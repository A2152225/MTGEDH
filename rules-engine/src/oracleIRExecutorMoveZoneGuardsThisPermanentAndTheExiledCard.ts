// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: the applyMoveZoneStep selector guards starting at if (parsedThisPermanentAndTheExiledCard && step.to === 'hand') {
// Public entry symbol: tryApplyMoveZoneGuardsFromThisPermanentAndTheExiledCard.

import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';
import type { GameState } from '../../shared/src';
import { getCardManaValue, readPlayerZoneCards } from './oracleIRExecutorPlayerUtils';
import { moveBattlefieldPermanentsByIdToOwnersHands } from './oracleIRExecutorBattlefieldOps';
import {
  moveTargetedCardFromHand,
  moveTargetedCardFromExile,
  findCardsExiledWithSource,
  shuffleSelectedCardsFromHandIntoLibrary,
  cardMatchesMoveZoneSingleTargetCriteria,
  moveCountFromHandToLibrary,
  moveOpponentOwnedCardsFromExileToGraveyards,
  moveAnotherMatchingCardFromYourGraveyard,
} from './oracleIRExecutorZoneOps';
import { getChosenObjectIds, getTargetPlayerId } from './oracleIRExecutorMoveZoneReferenceResolvers';
import { getLibraryPlacement, resolveMoveZoneSingleTargetCriteriaWithX } from './oracleIRExecutorMoveZoneContextualCardResolvers';
import { buildAppliedResult } from './oracleIRExecutorMoveZoneStepResultBuilders';

export function tryApplyMoveZoneGuardsFromThisPermanentAndTheExiledCard(args: MoveZoneGuardArgs): MoveZoneStepHandlerResult | undefined {
  const { state, step, ctx, runtime, nextState, log, controllerId, effectiveWithCounters, battlefieldEntryOverrides, finalizeAppliedResult, attachmentResolution, sourcePermanentPower, linkedSourceId } = args;
  const {
    parsedTypedCardFromYourHand,
    parsedTheCardsFromYourHand,
    parsedTheCardsFromTargetOpponentHand,
    parsedCountFromHand,
    parsedAnyNumberCardsFromYourHand,
  } = args.zoneQueries;
  const {
    parsedAnotherFromGraveyard,
    parsedOpponentOwnedFromExile,
    parsedSingleTargetFromLinkedExile,
    parsedTheExiledCard,
    parsedThisPermanentAndTheExiledCard,
    parsedAllFromLinkedExile,
  } = args.referenceQueries;

  if (parsedThisPermanentAndTheExiledCard && step.to === 'hand') {
    if (!linkedSourceId) {
      return {
        applied: false,
        message: `Skipped move zone (linked source unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const sourceOnBattlefield = ((workingState.battlefield || []) as any[]).some(
      perm => String(perm?.id || '').trim() === linkedSourceId
    );
    if (sourceOnBattlefield) {
      const bounceResult = moveBattlefieldPermanentsByIdToOwnersHands(workingState, [linkedSourceId]);
      workingState = bounceResult.state;
      combinedLog.push(...(bounceResult.log || []));
    }
    const exiledMatches = findCardsExiledWithSource(workingState, linkedSourceId, { cardType: 'any' });
    const chosenObjectIds = getChosenObjectIds(ctx);
    const selectedMatch =
      chosenObjectIds.length > 0
        ? exiledMatches.find(match => chosenObjectIds.includes(match.cardId)) || exiledMatches[0]
        : exiledMatches.length === 1
          ? exiledMatches[0]
          : undefined;
    if (selectedMatch) {
      const exileResult = moveTargetedCardFromExile(
        workingState,
        selectedMatch.playerId,
        selectedMatch.cardId,
        'any',
        'hand'
      );
      if (exileResult.kind === 'applied') {
        workingState = exileResult.state;
        combinedLog.push(...(exileResult.log || []));
      }
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned saga and exiled card to hand: ${step.raw}`],
    });
  }

  if (parsedTheExiledCard) {
    if (!linkedSourceId) {
      return {
        applied: false,
        message: `Skipped move zone (linked exile source unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const matches = findCardsExiledWithSource(nextState, linkedSourceId, parsedTheExiledCard);
    if (matches.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No linked exiled cards matched: ${step.raw}`],
      });
    }

    const chosenObjectIds = getChosenObjectIds(ctx);
    const selectedMatches =
      chosenObjectIds.length > 0
        ? matches.filter(match => chosenObjectIds.includes(match.cardId))
        : matches.length === 1
          ? matches
          : matches;

    if (selectedMatches.length !== 1) {
      return {
        applied: false,
        message: `Skipped move zone (linked exile target requires player choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: {
          classification: 'player_choice',
          metadata: {
            availableLinkedExileTargets: matches.map(match => match.cardId),
          },
        },
      };
    }

    const match = selectedMatches[0];
    const result = moveTargetedCardFromExile(
      nextState,
      match.playerId,
      match.cardId,
      parsedTheExiledCard.cardType,
      step.to === 'battlefield' ? 'battlefield' : step.to,
      step.to === 'battlefield' && step.battlefieldController?.kind === 'you'
        ? controllerId
        : step.to === 'battlefield' && step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? match.playerId
          : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      undefined,
      battlefieldEntryOverrides
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (linked exiled card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromLinkedExile || parsedAllFromLinkedExile) {
    if (!linkedSourceId) {
      return {
        applied: false,
        message: `Skipped move zone (linked exile source unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const rawCriteria = parsedSingleTargetFromLinkedExile || parsedAllFromLinkedExile!;
    const criteria = resolveMoveZoneSingleTargetCriteriaWithX(rawCriteria, ctx);
    const matches = findCardsExiledWithSource(nextState, linkedSourceId, criteria);
    if (matches.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No linked exiled cards matched: ${step.raw}`],
      });
    }

    const chosenObjectIds = getChosenObjectIds(ctx);
    const selectedMatches =
      parsedSingleTargetFromLinkedExile
        ? (() => {
            if (chosenObjectIds.length > 0) {
              const explicit = matches.filter(match => chosenObjectIds.includes(match.cardId));
              return explicit.length === 1 ? explicit : explicit;
            }
            return matches.length === 1 ? matches : matches;
          })()
        : matches;

    if (parsedSingleTargetFromLinkedExile && selectedMatches.length !== 1) {
      return {
        applied: false,
        message: `Skipped move zone (linked exile target requires player choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: {
          classification: 'player_choice',
          metadata: {
            availableLinkedExileTargets: matches.map(match => match.cardId),
          },
        },
      };
    }

    let workingState = nextState;
    const combinedLog: string[] = [];
    let movedPermanentIds: string[] = [];
    for (const match of selectedMatches) {
      const result = moveTargetedCardFromExile(
        workingState,
        match.playerId,
        match.cardId,
        criteria.cardType,
        step.to === 'battlefield' ? 'battlefield' : step.to,
        step.to === 'battlefield' && step.battlefieldController?.kind === 'you' ? controllerId : undefined,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        undefined,
        battlefieldEntryOverrides
      );
      if (result.kind !== 'applied') {
        return {
          applied: false,
          message: `Skipped move zone (linked exiled card unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedPermanentIds = movedPermanentIds.concat(result.movedPermanentIds || []);
    }

    return buildAppliedResult({
      state: workingState,
      log: combinedLog,
      ...(movedPermanentIds.length > 0 ? { movedPermanentIds } : {}),
    });
  }

  if (parsedTypedCardFromYourHand) {
    const preferredIds = getChosenObjectIds(ctx);
    const effectiveCriteria = resolveMoveZoneSingleTargetCriteriaWithX(
      parsedTypedCardFromYourHand,
      ctx,
      nextState,
      controllerId
    );
    const refId = String(
      ctx.targetCreatureId || ctx.targetPermanentId || ctx.sourceId || ''
    ).trim();
    const refPerm = refId
      ? ((nextState.battlefield || []) as any[]).find(perm => String((perm as any)?.id || '').trim() === refId)
      : undefined;
    const referenceManaValue = refPerm ? getCardManaValue((refPerm as any)?.card || refPerm) : null;
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
    const matches = hand.filter((card: any) => {
      const cardId = String(card?.id || '').trim();
      if (!cardId) return false;
      if (
        !cardMatchesMoveZoneSingleTargetCriteria(
          card,
          effectiveCriteria,
          undefined,
          undefined,
          sourcePermanentPower,
          referenceManaValue ?? undefined
        )
      ) {
        return false;
      }
      if (preferred.size > 0 && !preferred.has(cardId)) return false;
      return true;
    });
    const relaxed =
      matches.length === 0 && preferred.size > 0
        ? hand.filter(
            (card: any) =>
              preferred.has(String(card?.id || '').trim()) &&
              cardMatchesMoveZoneSingleTargetCriteria(
                card,
                effectiveCriteria,
                undefined,
                undefined,
                sourcePermanentPower,
                referenceManaValue ?? undefined
              )
          )
        : matches;
    const selectableMatches = relaxed.length > 0 ? relaxed : matches;
    if (
      ctx.interactivePlayerChoices === true
      && preferred.size === 0
      && selectableMatches.length > 0
    ) {
      return {
        applied: false,
        message: `Hand card selection requires player choice: ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    const cardId = String((relaxed[0] as any)?.id || '').trim();
    if (!cardId) {
      return {
        applied: false,
        message: `Skipped move zone (typed hand card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    if (step.to === 'battlefield') {
      const result = moveTargetedCardFromHand(
        nextState,
        controllerId,
        cardId,
        effectiveCriteria.cardType,
        'battlefield',
        step.battlefieldController?.kind === 'owner_of_moved_cards' ? controllerId : controllerId,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
        battlefieldEntryOverrides
      );
      if (result.kind === 'impossible') {
        return {
          applied: false,
          message: `Skipped move zone (typed hand card unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }
      return finalizeAppliedResult(result);
    }

    if (step.to === 'graveyard' || step.to === 'exile') {
      const player = nextState.players.find(p => p.id === controllerId) as any;
      const hand = Array.isArray(player?.hand) ? player.hand : [];
      const card = hand.find((entry: any) => String(entry?.id || '').trim() === cardId);
      const mv = card ? getCardManaValue(card) : null;
      const result = moveTargetedCardFromHand(
        nextState,
        controllerId,
        cardId,
        effectiveCriteria.cardType,
        step.to
      );
      if (result.kind === 'impossible') {
        return {
          applied: false,
          message: `Skipped move zone (typed hand card unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }
      if (effectiveCriteria.timeCountersEqualManaValue && mv !== null && result.kind === 'applied') {
        const updatedPlayers = result.state.players.map(p => {
          if (p.id !== controllerId) return p;
          const exile = Array.isArray((p as any)?.exile) ? [...(p as any).exile] : [];
          const updatedExile = exile.map((entry: any) =>
            String(entry?.id || '').trim() === cardId
              ? { ...entry, counters: { ...(entry?.counters || {}), time: mv } }
              : entry
          );
          return { ...(p as any), exile: updatedExile } as any;
        });
        return finalizeAppliedResult({ ...result, state: { ...result.state, players: updatedPlayers as any } as GameState });
      }
      return finalizeAppliedResult(result);
    }

    return {
      applied: false,
      message: `Skipped move zone (unsupported destination): ${step.raw}`,
      reason: 'unsupported_destination',
    };
  }

  if (parsedAnyNumberCardsFromYourHand && step.to === 'library') {
    const result = shuffleSelectedCardsFromHandIntoLibrary(
      nextState,
      controllerId,
      getChosenObjectIds(ctx)
    );
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`Shuffled cards from hand into library: ${step.raw}`],
    });
  }

  if (parsedTheCardsFromYourHand && step.to === 'library') {
    const placement = getLibraryPlacement(step) || 'bottom';
    const handOwnerId =
      parsedTheCardsFromYourHand.possessive === 'their'
        ? (getTargetPlayerId(ctx) || controllerId)
        : controllerId;
    const player = nextState.players.find((p) => p.id === handOwnerId) as any;
    const hand = readPlayerZoneCards(nextState, handOwnerId, player, 'hand');
    if (hand.length === 0) {
      return buildAppliedResult(
        {
          state: nextState,
          log: [`No hand cards to move: ${step.raw}`],
          lastMovedCards: [],
          lastReferenceAmount: 0,
          fromZone: 'hand',
          toZone: 'library',
        },
        ctx,
      );
    }
    const result = moveCountFromHandToLibrary(
      nextState,
      handOwnerId,
      hand.length,
      placement === 'top' ? 'top' : 'bottom',
      getChosenObjectIds(ctx),
    );
    if (result.kind === 'player_choice_required') {
      // "in any order" — auto-apply current hand order when no explicit choice ids were provided.
      const auto = moveCountFromHandToLibrary(
        nextState,
        handOwnerId,
        hand.length,
        placement === 'top' ? 'top' : 'bottom',
        hand.map((card: any) => String(card?.id || '').trim()).filter(Boolean),
      );
      if (auto.kind !== 'applied') {
        return {
          applied: false,
          message: `Skipped move zone (needs player card selection): ${step.raw}`,
          reason: 'player_choice_required',
          options: { classification: 'player_choice' },
        };
      }
      return buildAppliedResult(
        {
          state: auto.state,
          log: auto.log.length > 0 ? auto.log : [`Put hand on library ${placement}: ${step.raw}`],
          lastMovedCards: auto.movedCards,
          lastReferenceAmount: auto.movedCards.length,
          fromZone: 'hand',
          toZone: 'library',
        },
        ctx,
      );
    }
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (not enough hand cards): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return buildAppliedResult(
      {
        state: result.state,
        log: result.log.length > 0 ? result.log : [`Put hand on library ${placement}: ${step.raw}`],
        lastMovedCards: result.movedCards,
        lastReferenceAmount: result.movedCards.length,
        fromZone: 'hand',
        toZone: 'library',
      },
      ctx,
    );
  }

  if (
    parsedTheCardsFromTargetOpponentHand &&
    step.to === 'library'
  ) {
    const placement = getLibraryPlacement(step) || 'top';
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const player = nextState.players.find(p => p.id === targetPlayerId) as any;
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    if (hand.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No hand cards to move: ${step.raw}`],
        lastMovedCards: [],
        lastReferenceAmount: 0,
        fromZone: 'hand',
        toZone: 'library',
      }, ctx);
    }
    const result = moveCountFromHandToLibrary(
      nextState,
      targetPlayerId,
      hand.length,
      placement === 'bottom' ? 'bottom' : 'top',
      getChosenObjectIds(ctx)
    );
    if (result.kind === 'player_choice_required') {
      const auto = moveCountFromHandToLibrary(
        nextState,
        targetPlayerId,
        hand.length,
        placement === 'bottom' ? 'bottom' : 'top',
        hand.map((card: any) => String(card?.id || '').trim()).filter(Boolean),
      );
      if (auto.kind !== 'applied') {
        return {
          applied: false,
          message: `Skipped move zone (needs player card selection): ${step.raw}`,
          reason: 'player_choice_required',
          options: { classification: 'player_choice' },
        };
      }
      return buildAppliedResult({
        state: auto.state,
        log: auto.log.length > 0 ? auto.log : [`Moved hand to library ${placement}: ${step.raw}`],
        lastMovedCards: auto.movedCards,
        lastReferenceAmount: auto.movedCards.length,
        fromZone: 'hand',
        toZone: 'library',
      }, ctx);
    }
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (not enough hand cards): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`Moved hand to library ${placement}: ${step.raw}`],
      lastMovedCards: result.movedCards,
      lastReferenceAmount: result.movedCards.length,
      fromZone: 'hand',
      toZone: 'library',
    }, ctx);
  }

  if (parsedCountFromHand?.topOrBottomBoth && step.to === 'library') {
    const placement =
      String((ctx as any).libraryPlacement || (ctx as any).selectorContext?.libraryPlacement || '')
        .trim()
        .toLowerCase() === 'top'
        ? 'top'
        : 'bottom';
    const result = moveCountFromHandToLibrary(
      nextState,
      controllerId,
      parsedCountFromHand.count,
      placement,
      getChosenObjectIds(ctx)
    );
    if (result.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (not enough hand cards): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`Moved cards from hand to library ${placement}: ${step.raw}`],
    });
  }

  if (parsedCountFromHand && step.to === 'library' && getLibraryPlacement(step) === 'top') {
    const result = moveCountFromHandToLibrary(
      nextState,
      controllerId,
      parsedCountFromHand.count,
      'top',
      getChosenObjectIds(ctx)
    );
    if (result.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (not enough hand cards): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`Moved cards from hand to library top: ${step.raw}`],
    });
  }

  if (parsedCountFromHand && step.to === 'library' && getLibraryPlacement(step) === 'bottom') {
    const result = moveCountFromHandToLibrary(
      nextState,
      controllerId,
      parsedCountFromHand.count,
      'bottom',
      getChosenObjectIds(ctx)
    );
    if (result.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (not enough hand cards): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`Moved cards from hand to library bottom: ${step.raw}`],
    });
  }

  if (parsedOpponentOwnedFromExile && step.to === 'graveyard') {
    const result = moveOpponentOwnedCardsFromExileToGraveyards(
      nextState,
      controllerId,
      parsedOpponentOwnedFromExile.count,
      getChosenObjectIds(ctx)
    );
    if (result.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (result.kind === 'impossible') {
      return buildAppliedResult({
        state: nextState,
        log: [`No opponent-owned exile cards matched: ${step.raw}`],
      });
    }
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`Moved opponent-owned exile cards to graveyards: ${step.raw}`],
    });
  }

  if (parsedAnotherFromGraveyard && step.to === 'hand') {
    const excludeIds = Array.from(
      new Set(
        [
          ...(Array.isArray(ctx.lastMovedCards)
            ? ctx.lastMovedCards.map((card: any) => String(card?.id || '').trim())
            : []),
          ...(Array.isArray(runtime?.lastMovedCards)
            ? runtime.lastMovedCards.map((card: any) => String(card?.id || '').trim())
            : []),
          ...(Array.isArray(ctx.movedBattlefieldPermanentIds) ? ctx.movedBattlefieldPermanentIds : []),
        ].filter(Boolean)
      )
    );
    const result = moveAnotherMatchingCardFromYourGraveyard(
      nextState,
      controllerId,
      parsedAnotherFromGraveyard,
      'hand',
      excludeIds,
      getChosenObjectIds(ctx)
    );
    if (result.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (result.kind === 'impossible') {
      return buildAppliedResult({
        state: nextState,
        log: [`No other graveyard card matched: ${step.raw}`],
      });
    }
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`Returned another graveyard card to hand: ${step.raw}`],
    });
  }

  if (parsedAnotherFromGraveyard && step.to === 'battlefield') {
    const excludeIds = Array.from(
      new Set(
        [
          ...(Array.isArray(ctx.lastMovedCards)
            ? ctx.lastMovedCards.map((card: any) => String(card?.id || '').trim())
            : []),
          ...(Array.isArray(runtime?.lastMovedCards)
            ? runtime.lastMovedCards.map((card: any) => String(card?.id || '').trim())
            : []),
        ].filter(Boolean)
      )
    );
    const result = moveAnotherMatchingCardFromYourGraveyard(
      nextState,
      controllerId,
      parsedAnotherFromGraveyard,
      'battlefield',
      excludeIds,
      getChosenObjectIds(ctx)
    );
    if (result.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (result.kind === 'impossible') {
      return buildAppliedResult({
        state: nextState,
        log: [`No other graveyard card matched: ${step.raw}`],
      });
    }
    return finalizeAppliedResult(result as any);
  }


  return undefined;
}
