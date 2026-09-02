// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: the applyMoveZoneStep selector guards starting at if (parsedExileGySplitTwoPiles && step.to === 'exile') {
// Public entry symbol: tryApplyMoveZoneGuardsFromExileGySplitTwoPiles.

import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';
import type { PlayerID } from '../../shared/src';
import { moveBattlefieldPermanentsByIdToOwnersLibraries, moveBattlefieldPermanentsByIdToOwnersHands } from './oracleIRExecutorBattlefieldOps';
import {
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromExile,
  resolveFirstMatchingCardIdFromPlayerGraveyard,
  exileUpToMatchingFromGraveyard,
  resolveUncastExiledThisWayCardIds,
  exileOneMatchingCardFromEachPlayersGraveyard,
  putOneMatchingCardFromEachOpponentsGraveyardOntoBattlefield,
  putAllMatchingCriteriaFromGraveyardOntoBattlefield,
  moveUnplayedExileCardsToGraveyard,
  cardMatchesMoveZoneSingleTargetCriteria,
  resolveCardIdsFromAnyGraveyard,
  moveTargetedCardFromHandToLibrary,
  selectGraveyardCardsWithTotalManaValueLte,
  cardMatchesType,
} from './oracleIRExecutorZoneOps';
import type { BoundCardZoneLocation } from './oracleIRExecutorMoveZoneStepTypes';
import { findBoundCardZoneLocation, getChosenObjectIds } from './oracleIRExecutorMoveZoneReferenceResolvers';
import {
  getLibraryPlacement,
  moveContextualCardToDestination,
  resolveCreaturesBlockingOrBlockedBySource,
  resolveCreaturesBlockingOrBlockedByTarget,
} from './oracleIRExecutorMoveZoneContextualCardResolvers';
import { annotateExiledCardsWithSource, buildAppliedResult } from './oracleIRExecutorMoveZoneStepResultBuilders';

export function tryApplyMoveZoneGuardsFromExileGySplitTwoPiles(args: MoveZoneGuardArgs): MoveZoneStepHandlerResult | undefined {
  const { state, step, ctx, runtime, nextState, log, controllerId, effectiveWithCounters, battlefieldEntryOverrides, finalizeAppliedResult, attachmentResolution } = args;
  const {
    parsedAllCreaturesBlockingOrBlockedByTargetCreature,
    parsedSingleCardFromEachPlayersGy,
    parsedPutIntoGraveyardThisWay,
    parsedUpToCreatureCardsPutIntoGraveyardsThisWay,
    parsedThoseCardsNotPlayed,
    parsedTheNonlandCard,
    parsedTheNonlandCardRestToLibrary,
    parsedExiledThisWayNotCast,
    parsedReturnItAndSelf,
    parsedCompoundExileItAndReturnGy,
    parsedCountTargetFromSingleGraveyard,
    parsedThisPermanentAndUpToFromSingleGy,
    parsedThisCreatureAndCombatantsToLibraryTop,
    parsedExileGySplitTwoPiles,
    parsedAnyNumberCardsTotalMvXFromGy,
  } = args.referenceQueries;

  if (parsedExileGySplitTwoPiles && step.to === 'exile') {
    const result = exileUpToMatchingFromGraveyard(
      nextState,
      controllerId,
      parsedExileGySplitTwoPiles.maxCount,
      { cardType: 'permanent' },
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
      return buildAppliedResult({ state: nextState, log: [`No matching graveyard permanents to exile: ${step.raw}`] });
    }
    const playerAfter = result.state.players.find(p => p.id === controllerId) as any;
    const exile = Array.isArray(playerAfter?.exile) ? playerAfter.exile : [];
    const movedCards = exile.slice(-Math.min(parsedExileGySplitTwoPiles.maxCount, exile.length));
    const annotated = annotateExiledCardsWithSource({ state: result.state, movedCards, ctx });
    return buildAppliedResult({
      state: annotated.state,
      log:
        result.log.length > 0
          ? [...result.log, `Separated ${movedCards.length} exiled card(s) into two piles`]
          : [`Exiled graveyard permanents into two piles: ${step.raw}`],
      movedCards: annotated.movedCards,
    });
  }

  if (parsedAllCreaturesBlockingOrBlockedByTargetCreature && step.to === 'hand') {
    const targetId = String(
      ctx.targetCreatureId || ctx.selectorContext?.targetCreatureId || ctx.targetPermanentId || ''
    ).trim();
    const targetIds = resolveCreaturesBlockingOrBlockedByTarget(nextState, targetId);
    if (targetIds.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No creatures blocking or blocked by target: ${step.raw}`],
      });
    }
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds);
    return finalizeAppliedResult(result);
  }

  if (parsedThisCreatureAndCombatantsToLibraryTop && step.to === 'library' && getLibraryPlacement(step) === 'top') {
    const sourceId = String(ctx.sourceId || ctx.targetCreatureId || 'bf-source').trim();
    const targetIds = resolveCreaturesBlockingOrBlockedBySource(nextState, sourceId);
    const result = moveBattlefieldPermanentsByIdToOwnersLibraries(nextState, targetIds, 'top');
    return finalizeAppliedResult(result);
  }

  if (parsedAnyNumberCardsTotalMvXFromGy && step.to === 'hand') {
    const totalMv = Math.max(0, Number(ctx.xValue ?? ctx.referenceAmount ?? 7));
    const cardIds = selectGraveyardCardsWithTotalManaValueLte(
      nextState,
      controllerId,
      'any',
      totalMv,
      getChosenObjectIds(ctx)
    );
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of cardIds) {
      const result = moveTargetedCardFromGraveyard(workingState, controllerId, cardId, { cardType: 'any' }, 'hand');
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned cards with total MV ${totalMv} or less: ${step.raw}`],
    });
  }

  if (parsedThisPermanentAndUpToFromSingleGy && step.to === 'library') {
    const sourceId = String(ctx.sourceId || '').trim();
    let workingState = nextState;
    const combinedLog: string[] = [];
    if (sourceId) {
      const sourceResult = moveBattlefieldPermanentsByIdToOwnersLibraries(workingState, [sourceId], 'bottom');
      workingState = sourceResult.state;
      combinedLog.push(...(sourceResult.log || []));
    }
    const matches = resolveCardIdsFromAnyGraveyard(
      workingState,
      parsedThisPermanentAndUpToFromSingleGy.cardType,
      getChosenObjectIds(ctx),
      parsedThisPermanentAndUpToFromSingleGy.count
    );
    if (matches.length === 0) {
      return buildAppliedResult({
        state: workingState,
        log: combinedLog.length > 0 ? combinedLog : [`No graveyard cards matched: ${step.raw}`],
      });
    }
    const playerIds = new Set(matches.map(match => match.playerId));
    if (playerIds.size > 1) {
      return {
        applied: false,
        message: `Skipped move zone (single graveyard constraint): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    for (const match of matches.slice(0, parsedThisPermanentAndUpToFromSingleGy.count)) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        match.playerId,
        match.cardId,
        { cardType: parsedThisPermanentAndUpToFromSingleGy.cardType },
        'library_bottom'
      );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log:
        combinedLog.length > 0
          ? combinedLog
          : [`Shuffled permanent and graveyard cards into libraries: ${step.raw}`],
    });
  }

  if (parsedCountTargetFromSingleGraveyard && step.to === 'battlefield') {
    const targetCount = parsedCountTargetFromSingleGraveyard.useXValue
      ? Math.max(0, Number(ctx.xValue ?? ctx.referenceAmount ?? 3))
      : parsedCountTargetFromSingleGraveyard.count;
    const matches = resolveCardIdsFromAnyGraveyard(
      nextState,
      parsedCountTargetFromSingleGraveyard.cardType,
      getChosenObjectIds(ctx),
      targetCount
    );
    if (matches.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No graveyard cards matched: ${step.raw}`] });
    }
    const playerIds = new Set(matches.map(match => match.playerId));
    if (playerIds.size > 1) {
      return {
        applied: false,
        message: `Skipped move zone (single graveyard constraint): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    const limit = parsedCountTargetFromSingleGraveyard.upTo
      ? targetCount
      : targetCount;
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    const bfController = String(step.battlefieldController?.kind === 'you' ? controllerId : controllerId);
    for (const match of matches.slice(0, limit)) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        match.playerId,
        match.cardId,
        { cardType: parsedCountTargetFromSingleGraveyard.cardType },
        'battlefield',
        bfController,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        undefined,
        undefined,
        battlefieldEntryOverrides
      );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned cards from a single graveyard: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedCountTargetFromSingleGraveyard && step.to === 'exile') {
    const exileCount = parsedCountTargetFromSingleGraveyard.useXValue
      ? Math.max(0, Number(ctx.xValue ?? ctx.referenceAmount ?? 3))
      : parsedCountTargetFromSingleGraveyard.count;
    const matches = resolveCardIdsFromAnyGraveyard(
      nextState,
      parsedCountTargetFromSingleGraveyard.cardType,
      getChosenObjectIds(ctx),
      exileCount
    );
    if (matches.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No graveyard cards matched: ${step.raw}`] });
    }
    const playerIds = new Set(matches.map(match => match.playerId));
    if (playerIds.size > 1) {
      return {
        applied: false,
        message: `Skipped move zone (single graveyard constraint): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const match of matches.slice(0, exileCount)) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        match.playerId,
        match.cardId,
        { cardType: parsedCountTargetFromSingleGraveyard.cardType },
        'exile'
      );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Exiled cards from a single graveyard: ${step.raw}`],
    });
  }

  if (parsedCompoundExileItAndReturnGy) {
    let workingState = nextState;
    const combinedLog: string[] = [];
    const sourceId = String(ctx.sourceId || '').trim();
    const controllerPlayer = workingState.players.find(p => p.id === controllerId) as any;
    const graveyard = Array.isArray(controllerPlayer?.graveyard) ? controllerPlayer.graveyard : [];
    const sourceGyCard = graveyard.find((card: any) => {
      const cardId = String(card?.id || '').trim();
      return cardId === sourceId || cardId === 'gy-source-self' || cardId.startsWith('gy-source');
    });
    const sourceGyCardId = String((sourceGyCard as any)?.id || '').trim();
    if (sourceGyCardId) {
      const exileResult = moveTargetedCardFromGraveyard(
        workingState,
        controllerId,
        sourceGyCardId,
        { cardType: 'any' },
        'exile'
      );
      if (exileResult.kind === 'applied') {
        workingState = exileResult.state;
        combinedLog.push(...(exileResult.log || []));
      }
    }
    const returnResult = putAllMatchingCriteriaFromGraveyardOntoBattlefield(
      workingState,
      controllerId,
      controllerId,
      parsedCompoundExileItAndReturnGy,
      sourceGyCardId ? [sourceGyCardId] : [],
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters
    );
    return buildAppliedResult({
      state: returnResult.state,
      log: [...combinedLog, ...returnResult.log],
      movedPermanentIds: returnResult.movedPermanentIds,
    });
  }

  if (parsedReturnItAndSelf && step.to === 'hand') {
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = (nextState.battlefield || []) as any[];
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId)
      : undefined;
    const attachedToId = String(
      (sourcePermanent as any)?.attachedTo ||
        ctx.targetCreatureId ||
        ctx.targetPermanentId ||
        ctx.selectorContext?.targetCreatureId ||
        ''
    ).trim();
    const targetIds = Array.from(new Set([attachedToId, sourceId].filter(Boolean)));
    if (targetIds.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No permanents to return: ${step.raw}`] });
    }
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds);
    return finalizeAppliedResult(result);
  }

  if (parsedUpToCreatureCardsPutIntoGraveyardsThisWay && step.to === 'battlefield') {
    const { maxCount, cardType } = parsedUpToCreatureCardsPutIntoGraveyardsThisWay;
    const thisWayIds = new Set(
      [
        ...(Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []),
        ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
        ...(Array.isArray(runtime?.lastSacrificedPermanents) ? runtime.lastSacrificedPermanents : []),
        ...(Array.isArray((ctx as any).lastSacrificedPermanents) ? (ctx as any).lastSacrificedPermanents : []),
      ]
        .map((card: any) => String(card?.id || '').trim())
        .filter(Boolean)
    );
    const preferred = getChosenObjectIds(ctx);
    const matches: Array<{ readonly playerId: PlayerID; readonly cardId: string }> = [];
    for (const player of nextState.players || []) {
      const playerId = String((player as any)?.id || '').trim() as PlayerID;
      if (!playerId) continue;
      const graveyard = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
      for (const card of graveyard) {
        const cardId = String((card as any)?.id || '').trim();
        if (!cardId) continue;
        if (thisWayIds.size > 0 && !thisWayIds.has(cardId)) continue;
        if (!cardMatchesType(card, cardType)) continue;
        matches.push({ playerId, cardId });
      }
    }
    const orderedIds = [
      ...preferred.filter(id => matches.some(match => match.cardId === id)),
      ...matches.map(match => match.cardId).filter(id => !preferred.includes(id)),
    ];
    const uniqueIds = Array.from(new Set(orderedIds)).slice(0, maxCount);
    if (uniqueIds.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No creature cards put into graveyards this way: ${step.raw}`],
      });
    }
    const bfController =
      step.battlefieldController?.kind === 'you'
        ? controllerId
        : controllerId;
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of uniqueIds) {
      const match = matches.find(entry => entry.cardId === cardId);
      if (!match) continue;
      const result = moveTargetedCardFromGraveyard(
        workingState,
        match.playerId,
        cardId,
        { cardType },
        'battlefield',
        bfController,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
        ctx.sourceName,
        battlefieldEntryOverrides
      );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      const bfId = String((result as any).movedPermanentId || '').trim();
      if (bfId) movedBattlefieldIds.push(bfId);
    }
    return buildAppliedResult({
      state: workingState,
      log:
        combinedLog.length > 0
          ? combinedLog
          : [`Returned up to ${maxCount} graveyard-this-way creature cards: ${step.raw}`],
      lastMovedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (
    parsedPutIntoGraveyardThisWay &&
    step.to === 'battlefield' &&
    !/^each card put into a graveyard this way$/i.test(String((step.what as any)?.text || ''))
  ) {
    const destroyedCards = Array.isArray(runtime?.lastMovedCards)
      ? runtime.lastMovedCards
      : Array.isArray(ctx.lastMovedCards)
        ? ctx.lastMovedCards
        : [];
    const destroyedIds = new Set(
      destroyedCards.map((card: any) => String(card?.id || '').trim()).filter(Boolean)
    );
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    const preferred = getChosenObjectIds(ctx);
    const currentTurn = Number((nextState as any).turnNumber ?? (nextState as any).turn ?? 0) || 0;
    const candidates = graveyard.filter((card: any) => {
      const cardId = String(card?.id || '').trim();
      if (!cardId) return false;
      if (destroyedIds.size > 0 && !destroyedIds.has(cardId)) return false;
      return cardMatchesMoveZoneSingleTargetCriteria(
        card,
        parsedPutIntoGraveyardThisWay,
        ctx.sourceName,
        currentTurn
      );
    });
    const cardId =
      preferred.find(id => candidates.some((card: any) => String(card?.id || '').trim() === id)) ||
      String((candidates[0] as any)?.id || '').trim();
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No graveyard-this-way card to return: ${step.raw}`] });
    }
    const battlefieldControllerId =
      step.battlefieldController?.kind === 'you'
        ? controllerId
        : step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? controllerId
          : controllerId;
    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      cardId,
      parsedPutIntoGraveyardThisWay,
      'battlefield',
      battlefieldControllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      ctx.sourceName,
      battlefieldEntryOverrides
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (graveyard-this-way card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (
    parsedPutIntoGraveyardThisWay &&
    step.to === 'battlefield' &&
    /^each card put into a graveyard this way$/i.test(String((step.what as any)?.text || ''))
  ) {
    const returnResult = putAllMatchingCriteriaFromGraveyardOntoBattlefield(
      nextState,
      controllerId,
      step.battlefieldController?.kind === 'you' ? controllerId : controllerId,
      parsedPutIntoGraveyardThisWay,
      [],
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters
    );
    return buildAppliedResult({
      state: returnResult.state,
      log: returnResult.log.length > 0 ? returnResult.log : [`Returned graveyard-this-way cards: ${step.raw}`],
      movedBattlefieldPermanentIds: returnResult.movedPermanentIds,
    });
  }

  if (
    parsedPutIntoGraveyardThisWay &&
    step.to === 'hand' &&
    !/^each card put into a graveyard this way$/i.test(String((step.what as any)?.text || ''))
  ) {
    const preferredIds = getChosenObjectIds(ctx);
    const cardId = resolveFirstMatchingCardIdFromPlayerGraveyard(
      nextState,
      controllerId,
      [parsedPutIntoGraveyardThisWay],
      preferredIds
    );
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No matching graveyard-this-way card: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      cardId,
      parsedPutIntoGraveyardThisWay,
      'hand'
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (graveyard-this-way card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedThoseCardsNotPlayed && step.to === 'graveyard') {
    const result = moveUnplayedExileCardsToGraveyard(nextState, controllerId);
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`No unplayed wish cards: ${step.raw}`],
      movedCards: result.movedCards,
    });
  }

  if ((parsedTheNonlandCard || parsedTheNonlandCardRestToLibrary) && step.to === 'hand') {
    const movedCards = Array.isArray(runtime?.lastMovedCards)
      ? runtime.lastMovedCards
      : Array.isArray(ctx.lastMovedCards)
        ? ctx.lastMovedCards
        : [];
    let nonlandCardId: string | undefined;
    for (let index = movedCards.length - 1; index >= 0; index -= 1) {
      const card = movedCards[index] as any;
      const cardId = String(card?.id || '').trim();
      if (!cardId || cardMatchesType(card, 'land')) continue;
      nonlandCardId = cardId;
      break;
    }
    if (!nonlandCardId) {
      return buildAppliedResult({
        state: nextState,
        log: [`No nonland card in reveal context: ${step.raw}`],
      });
    }
    const libraryLocation: BoundCardZoneLocation = { playerId: controllerId, zone: 'library' };
    const libraryHasNonland = ((nextState.players || []).find((p) => p.id === controllerId) as any)?.library?.some(
      (card: any) => String(card?.id || '').trim() === nonlandCardId
    );
    const location = libraryHasNonland ? libraryLocation : findBoundCardZoneLocation(nextState, nonlandCardId);
    if (!location) {
      return {
        applied: false,
        message: `Skipped move zone (nonland reveal card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const moveResult =
      location.zone === 'library'
        ? moveContextualCardToDestination(nextState, location, nonlandCardId, 'hand', {
            controllerId,
            cardType: 'nonland',
          })
        : location.zone === 'hand'
          ? { kind: 'applied' as const, state: nextState, log: [] as string[] }
          : location.zone === 'graveyard'
            ? moveTargetedCardFromGraveyard(nextState, location.playerId, nonlandCardId, { cardType: 'nonland' }, 'hand')
            : moveTargetedCardFromExile(nextState, location.playerId, nonlandCardId, 'nonland', 'hand');
    if (moveResult.kind !== 'applied') {
      return {
        applied: false,
        message: `Skipped move zone (nonland reveal card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    let workingState = moveResult.state;
    const combinedLog = [...(moveResult.log || [])];
    if (parsedTheNonlandCardRestToLibrary) {
      for (const card of movedCards) {
        const cardId = String((card as any)?.id || '').trim();
        if (!cardId || cardId === nonlandCardId) continue;
        const restResult = moveContextualCardToDestination(workingState, libraryLocation, cardId, 'library_bottom', {
          controllerId,
        });
        if (restResult.kind !== 'applied') continue;
        workingState = restResult.state;
        combinedLog.push(...restResult.log);
      }
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved nonland card to hand: ${step.raw}`],
    });
  }

  if (parsedExiledThisWayNotCast && (step.to === 'graveyard' || step.to === 'hand' || step.to === 'library')) {
    const exiledSnapshot = Array.isArray(runtime?.lastExiledCards)
      ? runtime.lastExiledCards
      : Array.isArray(ctx.lastExiledCards)
        ? ctx.lastExiledCards
        : [];
    const matchingIds = resolveUncastExiledThisWayCardIds(
      nextState,
      controllerId,
      exiledSnapshot,
      parsedExiledThisWayNotCast
    );
    if (matchingIds.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No uncast exiled-this-way cards: ${step.raw}`],
      });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedCardIds: string[] = [];
    for (const cardId of matchingIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location || location.zone !== 'exile') continue;
      const result = moveTargetedCardFromExile(
        workingState,
        location.playerId,
        cardId,
        parsedExiledThisWayNotCast.cardType === 'instant_or_sorcery' ? 'instant_or_sorcery' : 'any',
        step.to === 'library' ? 'hand' : step.to
      );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedCardIds.push(cardId);
      if (step.to === 'library') {
        const libraryResult = moveTargetedCardFromHandToLibrary(workingState, location.playerId, cardId, 'bottom');
        if (libraryResult.kind === 'applied') {
          workingState = libraryResult.state;
          combinedLog.push(...(libraryResult.log || []));
        }
      }
    }
    if (parsedExiledThisWayNotCast.withRestToLibraryBottom) {
      const restIds = resolveUncastExiledThisWayCardIds(nextState, controllerId, exiledSnapshot, {
        cardType: 'any',
        withRestToLibraryBottom: false,
      }).filter((id) => !movedCardIds.includes(id));
      for (const cardId of restIds) {
        const location = findBoundCardZoneLocation(workingState, cardId);
        if (!location || location.zone !== 'exile') continue;
        const toHand = moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'hand');
        if (toHand.kind !== 'applied') continue;
        workingState = toHand.state;
        combinedLog.push(...(toHand.log || []));
        const libraryResult = moveTargetedCardFromHandToLibrary(workingState, location.playerId, cardId, 'bottom');
        if (libraryResult.kind === 'applied') {
          workingState = libraryResult.state;
          combinedLog.push(...(libraryResult.log || []));
        }
      }
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved uncast exiled-this-way cards: ${step.raw}`],
    });
  }

  if (parsedSingleCardFromEachPlayersGy && step.to === 'exile') {
    const result = exileOneMatchingCardFromEachPlayersGraveyard(
      nextState,
      parsedSingleCardFromEachPlayersGy,
      getChosenObjectIds(ctx)
    );
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`No graveyard cards to exile: ${step.raw}`],
    });
  }

  if (parsedSingleCardFromEachPlayersGy && step.to === 'battlefield') {
    const result = putOneMatchingCardFromEachOpponentsGraveyardOntoBattlefield(
      nextState,
      controllerId,
      parsedSingleCardFromEachPlayersGy,
      getChosenObjectIds(ctx),
      step.entersTapped,
      step.entersFaceDown,
      step.withCounters,
    );
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`No graveyard cards to put onto the battlefield: ${step.raw}`],
    });
  }


  return undefined;
}
