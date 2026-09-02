// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: the applyMoveZoneStep selector guards starting at if (parsedAnotherFromGraveyard && step.to === 'exile') {
// Public entry symbol: tryApplyMoveZoneGuardsFromAnotherFromGraveyard.

import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';
import type { GameState, PlayerID } from '../../shared/src';
import { finalizeBattlefieldRemoval } from './oracleIRExecutorBattlefieldOps';
import {
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
  moveTargetedCardFromExile,
  exileUpToMatchingFromGraveyard,
  cardMatchesMoveZoneSingleTargetCriteria,
  exileAnotherMatchingCardFromYourGraveyard,
  returnUpToMatchingFromGraveyardToHand,
  shuffleUpToMatchingFromGraveyardIntoLibrary,
  putUpToMatchingFromGraveyardOntoBattlefieldWithController,
  exileCountFromBottomOfLibrary,
  cardMatchesType,
  shuffleContextualCardsIntoLibrary,
} from './oracleIRExecutorZoneOps';
import {
  findBoundCardZoneLocation,
  chosenObjectIdsAreMatchingCardSelection,
  getChosenObjectIds,
  getTargetObjectId,
  getTargetPlayerId,
  ownerIdFromMovedCardSnapshots,
  resolveUniqueChosenAnyGraveyardTargetId,
} from './oracleIRExecutorMoveZoneReferenceResolvers';
import {
  getLibraryPlacement,
  moveContextualCardToDestination,
  resolveContextualCardIdsInZones,
  resolveMoveZoneSingleTargetCriteriaWithX,
} from './oracleIRExecutorMoveZoneContextualCardResolvers';
import { buildAppliedResult, shuffleCardArray } from './oracleIRExecutorMoveZoneStepResultBuilders';
import { readPlayerZoneCards, writePlayerZoneCards } from './oracleIRExecutorPlayerUtils';
import { resolveRevealedThisWayCardPile } from './oracleIRLedgerCardAccess';
import {
  orderRestIdsForLibraryBottom,
  parseWarpWorldSelectorMaps,
  trySkipRevealedThisWayRestAnyOrder,
} from './oracleIRExecutorWarpWorldInteractive';

export function tryApplyMoveZoneGuardsFromAnotherFromGraveyard(args: MoveZoneGuardArgs): MoveZoneStepHandlerResult | undefined {
  const { state, step, ctx, runtime, nextState, log, controllerId, effectiveWithCounters, battlefieldEntryOverrides, finalizeAppliedResult, attachmentResolution } = args;
  const {
    parsedUpToTargetCountFromGraveyard,
    parsedUpToTargetCountFromHand,
    parsedUpToTargetCountFromTargetPlayerGraveyard,
    parsedMostVotesCards,
    parsedThatManyFromBottomOfLibrary,
    parsedUpToOneOtherTargetCreatureBfOrGy,
    parsedAllOtherCardsRevealedThisWay,
    parsedTheRevealedCards,
    parsedAllOfThemWithThatName,
    parsedAnyNumberCardsFromYourHand,
  } = args.zoneQueries;
  const {
    parsedAnotherFromGraveyard,
  } = args.referenceQueries;

  if (parsedAnotherFromGraveyard && step.to === 'exile') {
    const excludeIds = Array.from(
      new Set([String(ctx.sourceId || '').trim(), 'gy-source-self'].filter(Boolean))
    );
    const result = exileAnotherMatchingCardFromYourGraveyard(
      nextState,
      controllerId,
      parsedAnotherFromGraveyard,
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
      log: result.log.length > 0 ? result.log : [`Exiled another graveyard card: ${step.raw}`],
    });
  }

  if (parsedUpToTargetCountFromHand && step.to === 'battlefield') {
    const preferredIds = getChosenObjectIds(ctx);
    const dynamicMaxCount = parsedUpToTargetCountFromHand.useXValue
      ? Math.max(0, Number(ctx.xValue ?? ctx.referenceAmount ?? 3))
      : parsedUpToTargetCountFromHand.maxCount;
    const effectiveCriteria = resolveMoveZoneSingleTargetCriteriaWithX(
      parsedUpToTargetCountFromHand.criteria,
      ctx,
      nextState,
      controllerId
    );
    const player = nextState.players.find((entry) => entry.id === controllerId) as any;
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    const matchingIds = hand
      .filter((card: any) => cardMatchesMoveZoneSingleTargetCriteria(card, effectiveCriteria))
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean);
    if (!chosenObjectIdsAreMatchingCardSelection(ctx, matchingIds)) {
      if (matchingIds.length === 0 || dynamicMaxCount <= 0) {
        return buildAppliedResult({ state: nextState, log: [`No matching hand cards: ${step.raw}`] });
      }
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    const preferred = preferredIds.filter((id) => matchingIds.includes(id));
    const selectedIds = preferred.slice(0, dynamicMaxCount);
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of selectedIds) {
      const result = moveTargetedCardFromHand(
        workingState,
        controllerId,
        cardId,
        effectiveCriteria.cardType,
        'battlefield',
        controllerId,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
        battlefieldEntryOverrides
      );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    if (selectedIds.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No matching hand cards: ${step.raw}`] });
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved cards from hand: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedAnyNumberCardsFromYourHand && step.to === 'battlefield') {
    const player = nextState.players.find((entry) => entry.id === controllerId) as any;
    const hand = Array.isArray(player?.hand) ? [...player.hand] : [];
    const matchingCards = hand.filter((card: any) => {
      const cardId = String(card?.id || '').trim();
      return Boolean(cardId && cardMatchesType(card, parsedAnyNumberCardsFromYourHand.cardType));
    });
    const matchingIds = matchingCards.map((card: any) => String(card?.id || '').trim()).filter(Boolean);
    if (!chosenObjectIdsAreMatchingCardSelection(ctx, matchingIds)) {
      if (matchingCards.length === 0) {
        return buildAppliedResult({ state: nextState, log: [`No matching hand cards: ${step.raw}`] });
      }
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    const preferred = new Set(getChosenObjectIds(ctx).map((id) => String(id || '').trim()).filter(Boolean));
    const cardIds = matchingCards
      .filter((card: any) => preferred.has(String(card?.id || '').trim()))
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean);
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of cardIds) {
      const result = moveTargetedCardFromHand(
        workingState,
        controllerId,
        cardId,
        parsedAnyNumberCardsFromYourHand.cardType,
        'battlefield',
        controllerId,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
        battlefieldEntryOverrides
      );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved cards from hand: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedUpToTargetCountFromGraveyard) {
    const preferredIds = getChosenObjectIds(ctx);
    const dynamicMaxCount = parsedUpToTargetCountFromGraveyard.useXValue
      ? Math.max(0, Number(ctx.xValue ?? ctx.referenceAmount ?? 3))
      : parsedUpToTargetCountFromGraveyard.useReferenceAmount
        ? Math.max(0, Number(ctx.referenceAmount ?? 2))
        : parsedUpToTargetCountFromGraveyard.maxCount;
    const effectiveCriteria = resolveMoveZoneSingleTargetCriteriaWithX(
      parsedUpToTargetCountFromGraveyard.criteria,
      ctx
    );
    if (step.to === 'hand') {
      const result = returnUpToMatchingFromGraveyardToHand(
        nextState,
        controllerId,
        dynamicMaxCount,
        effectiveCriteria,
        preferredIds
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
          log: [`No matching graveyard cards: ${step.raw}`],
        });
      }
      return finalizeAppliedResult(result);
    }

    if (step.to === 'battlefield') {
      const result = putUpToMatchingFromGraveyardOntoBattlefieldWithController(
        nextState,
        controllerId,
        controllerId,
        dynamicMaxCount,
        effectiveCriteria,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
        preferredIds
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
          log: [`No matching graveyard cards: ${step.raw}`],
        });
      }
      return finalizeAppliedResult(result);
    }

    if (step.to === 'exile') {
      const result = exileUpToMatchingFromGraveyard(
        nextState,
        controllerId,
        dynamicMaxCount,
        effectiveCriteria,
        preferredIds
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
        log: [`No matching graveyard cards: ${step.raw}`],
      });
    }
    return finalizeAppliedResult(result);
    }

    if (step.to === 'library') {
      const result = shuffleUpToMatchingFromGraveyardIntoLibrary(
        nextState,
        controllerId,
        dynamicMaxCount,
        effectiveCriteria,
        preferredIds
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
          log: [`No matching graveyard cards: ${step.raw}`],
        });
      }
      return finalizeAppliedResult(result);
    }
  }

  if (parsedUpToTargetCountFromTargetPlayerGraveyard && step.to === 'exile') {
    const targetPlayerId = getTargetPlayerId(ctx);
    const preferredIds = getChosenObjectIds(ctx);
    const result = exileUpToMatchingFromGraveyard(
      nextState,
      targetPlayerId,
      parsedUpToTargetCountFromTargetPlayerGraveyard.maxCount,
      parsedUpToTargetCountFromTargetPlayerGraveyard.criteria,
      preferredIds
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
      return buildAppliedResult({ state: nextState, log: [`No matching graveyard cards: ${step.raw}`] });
    }
    return finalizeAppliedResult(result);
  }

  if (parsedUpToTargetCountFromTargetPlayerGraveyard && step.to === 'library') {
    const targetPlayerId = getTargetPlayerId(ctx);
    const preferredIds = getChosenObjectIds(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const result = shuffleUpToMatchingFromGraveyardIntoLibrary(
      nextState,
      targetPlayerId,
      parsedUpToTargetCountFromTargetPlayerGraveyard.maxCount,
      parsedUpToTargetCountFromTargetPlayerGraveyard.criteria,
      preferredIds
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
      return buildAppliedResult({ state: nextState, log: [`No matching graveyard cards: ${step.raw}`] });
    }
    return finalizeAppliedResult(result);
  }

  if (parsedMostVotesCards && step.to === 'hand') {
    const preferredIds = getChosenObjectIds(ctx);
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of preferredIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const result =
        location.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(workingState, location.playerId, cardId, { cardType: 'any' }, 'hand')
          : location.zone === 'exile'
            ? moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'hand')
            : location.zone === 'hand'
              ? { kind: 'applied' as const, state: workingState, log: [] as string[], movedCards: [] as any[] }
              : { kind: 'impossible' as const };
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned vote-winning cards: ${step.raw}`],
    });
  }

  if (parsedThatManyFromBottomOfLibrary && step.to === 'exile') {
    const count = Math.max(0, Number(ctx.referenceAmount ?? 2));
    const result = exileCountFromBottomOfLibrary(nextState, controllerId, count);
    return buildAppliedResult({ state: result.state, log: [...result.log] });
  }

  if (parsedUpToOneOtherTargetCreatureBfOrGy && step.to === 'exile') {
    const targetObjectId = getTargetObjectId(ctx);
    const hasBattlefieldTarget = targetObjectId
      ? ((nextState.battlefield || []) as any[]).some(perm => String((perm as any)?.id || '').trim() === targetObjectId)
      : false;
    if (hasBattlefieldTarget && targetObjectId) {
      const battlefield = [...((nextState.battlefield || []) as any[])];
      const perm = battlefield.find(entry => String((entry as any)?.id || '').trim() === targetObjectId);
      if (perm) {
        const removedIds = new Set([targetObjectId]);
        const kept = battlefield.filter(entry => String((entry as any)?.id || '').trim() !== targetObjectId);
        const result = finalizeBattlefieldRemoval(nextState, [perm], removedIds, kept, 'exile', 'exiled');
        return buildAppliedResult({ state: result.state, log: result.log });
      }
    }
    const gyTargetId = resolveUniqueChosenAnyGraveyardTargetId(
      nextState,
      { cardType: 'creature' },
      ctx,
      runtime,
      ctx.sourceName
    );
    if (gyTargetId) {
      const location = findBoundCardZoneLocation(nextState, gyTargetId);
      if (location?.zone === 'graveyard') {
        const result = moveTargetedCardFromGraveyard(
          nextState,
          location.playerId,
          gyTargetId,
          { cardType: 'creature' },
          'exile'
        );
        return finalizeAppliedResult(result);
      }
    }
    return buildAppliedResult({ state: nextState, log: [`No Savior target available: ${step.raw}`] });
  }

  if (parsedAllOtherCardsRevealedThisWay && (step.to === 'graveyard' || step.to === 'library')) {
    const preferredIds = new Set(getChosenObjectIds(ctx));
    const movedBattlefieldIds = new Set(
      (Array.isArray(ctx.lastMovedBattlefieldPermanentIds) ? ctx.lastMovedBattlefieldPermanentIds : [])
        .map(id => String(id || '').trim())
        .filter(Boolean)
    );
    const revealedPile = resolveRevealedThisWayCardPile(ctx, step);
    const remainderMovedCards = revealedPile.length > 0
      ? revealedPile
      : Array.isArray(runtime?.lastMovedCards)
        ? runtime.lastMovedCards
        : ctx.lastMovedCards;
    const restIds = (() => {
      if (revealedPile.length > 0) {
        const ids: string[] = [];
        for (const card of revealedPile) {
          const cardId = String(card?.id || '').trim();
          if (!cardId) continue;
          const ownerId = String(card?.owner || card?.ownerId || '').trim();
          const location = findBoundCardZoneLocation(nextState, cardId, ownerId || undefined);
          if (!location || location.zone === 'hand') continue;
          ids.push(cardId);
        }
        return ids;
      }
      const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, [
        'library',
        'exile',
        'hand',
        'graveyard',
      ]);
      return candidateIds.filter(
        (id) => !preferredIds.has(id) && !movedBattlefieldIds.has(id),
      );
    })();
    let workingState = nextState;
    const combinedLog: string[] = [];
    if (step.to === 'library') {
      const placement = getLibraryPlacement(step) || 'bottom';
      const randomOrder =
        step.order === 'random' || /\bin a random order\b/i.test(String(step.raw || ''));
      const remainderSkip = trySkipRevealedThisWayRestAnyOrder({
        state: nextState,
        ctx,
        restIds,
        stepOrder: randomOrder ? 'random' : step.order,
        stepRaw: String(step.raw || ''),
      });
      if (remainderSkip) return remainderSkip;
      const maps = parseWarpWorldSelectorMaps(ctx);

      const remainderIdsByOwnerInLibrary = new Map<string, string[]>();
      const remainderIdsByOwnerOutsideLibrary = new Map<string, string[]>();
      const remainingHints = Array.isArray(remainderMovedCards) ? [...remainderMovedCards] : [];
      for (const cardId of restIds) {
        const hintIdx = remainingHints.findIndex(
          (card: any) => String(card?.id || '').trim() === String(cardId || '').trim(),
        );
        const hint = hintIdx >= 0 ? remainingHints.splice(hintIdx, 1)[0] : undefined;
        const location = findBoundCardZoneLocation(
          workingState,
          cardId,
          String(hint?.owner || hint?.ownerId || '').trim()
            || ownerIdFromMovedCardSnapshots(remainderMovedCards, cardId),
        );
        if (!location) continue;
        // A same-id copy still in hand is not the revealed library leftover.
        if (location.zone === 'hand') continue;
        const bucket =
          location.zone === 'library' ? remainderIdsByOwnerInLibrary : remainderIdsByOwnerOutsideLibrary;
        const existing = bucket.get(location.playerId) || [];
        existing.push(cardId);
        bucket.set(location.playerId, existing);
      }

      for (const [playerId, ids] of remainderIdsByOwnerInLibrary.entries()) {
        const player = workingState.players.find((entry: any) => entry.id === playerId) as any;
        if (!player) continue;
        const wanted = new Set(ids);
        const library = readPlayerZoneCards(workingState, playerId as PlayerID, player, 'library');
        const remainderCards = library.filter((card: any) => wanted.has(String(card?.id || '').trim()));
        const keptLibrary = library.filter((card: any) => !wanted.has(String(card?.id || '').trim()));
        let orderedRemainder = remainderCards;
        if (randomOrder) {
          orderedRemainder = shuffleCardArray(remainderCards);
        } else if ((maps.libraryBottomOrderByPlayer[playerId] || []).length > 0) {
          const byId = new Map(
            remainderCards.map((card: any) => [String(card?.id || '').trim(), card] as const),
          );
          orderedRemainder = orderRestIdsForLibraryBottom(
            workingState,
            ids,
            maps.libraryBottomOrderByPlayer,
            step.order,
            remainderMovedCards,
          )
            .map((id) => byId.get(id))
            .filter(Boolean);
        }
        const nextLibrary =
          placement === 'top' ? [...orderedRemainder, ...keptLibrary] : [...keptLibrary, ...orderedRemainder];
        writePlayerZoneCards(workingState, playerId as PlayerID, player, 'library', nextLibrary);
        combinedLog.push(`${playerId} put ${ids.length} revealed card(s) on the ${placement} of their library`);
      }

      for (const [playerId, ids] of remainderIdsByOwnerOutsideLibrary.entries()) {
        const shuffleResult = shuffleContextualCardsIntoLibrary(workingState, playerId as PlayerID, ids);
        workingState = shuffleResult.state;
        combinedLog.push(...shuffleResult.log);
      }

      return buildAppliedResult({
        state: workingState,
        log:
          combinedLog.length > 0
            ? combinedLog
            : [`Put other revealed cards on the ${placement} of libraries: ${step.raw}`],
      });
    }
    for (const cardId of restIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const result =
        location.zone === 'library'
          ? moveContextualCardToDestination(workingState, location, cardId, 'graveyard', {
              controllerId,
              cardType: 'any',
            })
          : location.zone === 'hand'
            ? moveTargetedCardFromHand(workingState, location.playerId, cardId, 'any', 'graveyard')
            : location.zone === 'exile'
              ? moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'graveyard')
              : { kind: 'impossible' as const };
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved other revealed cards to graveyard: ${step.raw}`],
    });
  }

  if (parsedTheRevealedCards && (step.to === 'hand' || step.to === 'battlefield' || step.to === 'graveyard')) {
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, [
      'library',
      'exile',
      'hand',
      ...(step.to === 'graveyard' ? (['graveyard'] as const) : []),
    ]);
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of candidateIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      if (step.to === 'hand' && location.zone === 'hand') continue;
      if (step.to === 'graveyard' && location.zone === 'graveyard') continue;
      if (step.to === 'hand' && location.zone === 'hand') continue;
      const result =
        location.zone === 'library'
          ? moveContextualCardToDestination(workingState, location, cardId, step.to, {
              controllerId,
              ctx,
              cardType: 'any',
              entersTapped: step.entersTapped,
              entersFaceDown: step.entersFaceDown,
              withCounters: effectiveWithCounters,
              battlefieldEntryOverrides,
            })
          : location.zone === 'exile'
            ? moveTargetedCardFromExile(
                workingState,
                location.playerId,
                cardId,
                'any',
                step.to,
                step.to === 'battlefield' ? controllerId : undefined,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                undefined,
                battlefieldEntryOverrides
              )
            : location.zone === 'hand'
              ? moveTargetedCardFromHand(
                  workingState,
                  location.playerId,
                  cardId,
                  'any',
                  step.to === 'battlefield' ? 'battlefield' : 'graveyard',
                  step.to === 'battlefield' ? controllerId : undefined,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters,
                  undefined,
                  battlefieldEntryOverrides
                )
              : { kind: 'impossible' as const };
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...((result as any).movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log:
        combinedLog.length > 0
          ? combinedLog
          : [`Moved revealed cards to ${step.to}: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds.length > 0 ? movedBattlefieldIds : undefined,
    });
  }

  if (parsedAllOfThemWithThatName && step.to === 'hand') {
    const chosenName = String(
      ctx.selectorContext?.chosenCardName || ctx.chosenCardName || ctx.lastChosenCardName || ''
    )
      .trim()
      .toLowerCase();
    const restToGraveyard = /\bgraveyard\b/i.test(String(step.toRaw || step.raw || ''));
    const candidateIds = resolveContextualCardIdsInZones(
      nextState,
      ctx,
      runtime,
      restToGraveyard ? ['library', 'exile', 'hand', 'graveyard'] : ['library', 'exile', 'hand']
    );
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedToHandIds = new Set<string>();
    for (const cardId of candidateIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const player = workingState.players.find(p => p.id === location.playerId) as any;
      const zoneCards = Array.isArray(player?.[location.zone]) ? player[location.zone] : [];
      const card = zoneCards.find((entry: any) => String(entry?.id || '').trim() === cardId);
      const cardName = String((card as any)?.name || (card as any)?.card?.name || '')
        .trim()
        .toLowerCase();
      if (chosenName && cardName && cardName !== chosenName) continue;
      const result =
        location.zone === 'library'
          ? moveContextualCardToDestination(workingState, location, cardId, 'hand', {
              controllerId,
              cardType: 'any',
            })
          : location.zone === 'exile'
            ? moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'hand')
            : location.zone === 'graveyard'
              ? moveTargetedCardFromGraveyard(workingState, location.playerId, cardId, { cardType: 'any' }, 'hand')
              : location.zone === 'hand'
                ? { kind: 'applied' as const, state: workingState, log: [] }
                : { kind: 'impossible' as const };
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedToHandIds.add(cardId);
    }
    if (restToGraveyard) {
      for (const cardId of candidateIds) {
        if (movedToHandIds.has(cardId)) continue;
        const location = findBoundCardZoneLocation(workingState, cardId);
        if (!location || location.zone === 'graveyard') continue;
        const result =
          location.zone === 'library'
            ? moveContextualCardToDestination(workingState, location, cardId, 'graveyard', {
                controllerId,
                cardType: 'any',
              })
            : location.zone === 'hand'
              ? moveTargetedCardFromHand(workingState, location.playerId, cardId, 'any', 'graveyard')
              : location.zone === 'exile'
                ? moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'graveyard')
                : { kind: 'impossible' as const };
        if (result.kind !== 'applied') continue;
        workingState = result.state;
        combinedLog.push(...(result.log || []));
      }
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved matching-name cards to hand: ${step.raw}`],
    });
  }


  return undefined;
}
