// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: the applyMoveZoneStep selector guards starting at if (parsedAnyNumberCreaturesTotalPower && step.to === 'battlefield') {
// Public entry symbol: tryApplyMoveZoneGuardsFromAnyNumberCreaturesTotalPower.

import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';
import { parseSimpleBattlefieldSelector } from './oracleIRExecutorBattlefieldParser';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { hasExecutorClass } from './oracleIRExecutorPermanentUtils';
import { bounceMatchingBattlefieldPermanentsToOwnersHands, moveBattlefieldPermanentsByIdToOwnersHands } from './oracleIRExecutorBattlefieldOps';
import {
  exileUpToOneEachCardTypeFromGraveyard,
  moveTopCardFromLibrary,
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
  moveTargetedCardFromExile,
  findCardsExiledWithSource,
  resolveFirstMatchingCardIdFromPlayerGraveyard,
  exileUpToMatchingFromGraveyard,
  findAllExiledCardsWithCounter,
  resolveTypedCardIdFromPlayerZone,
  moveCountFromHandToLibrary,
  selectRandomMatchingCardIdFromGraveyard,
  exileRandomCardFromHand,
  selectGraveyardCreatureCardsWithTotalPowerLte,
  cardMatchesType,
} from './oracleIRExecutorZoneOps';
import { findBoundCardZoneLocation, getChosenObjectIds, getTargetPlayerId } from './oracleIRExecutorMoveZoneReferenceResolvers';
import { getLibraryPlacement, resolveContextualCardIdsInZones } from './oracleIRExecutorMoveZoneContextualCardResolvers';
import { buildAppliedResult } from './oracleIRExecutorMoveZoneStepResultBuilders';

export function tryApplyMoveZoneGuardsFromAnyNumberCreaturesTotalPower(args: MoveZoneGuardArgs): MoveZoneStepHandlerResult | undefined {
  const { state, step, ctx, runtime, nextState, log, controllerId, effectiveWithCounters, battlefieldEntryOverrides, finalizeAppliedResult, attachmentResolution, sourcePermanentPower } = args;
  const {
    parsedAllOtherTappedCreatures,
    parsedAllTappedCreatures,
    parsedHalfCreaturesTheyControl,
    parsedCompoundOpponentRandomExile,
  } = args.zoneQueries;
  const {
    parsedAnyNumberCreaturesTotalPower,
    parsedUpToThatManyFromTheirGy,
    parsedUpToOneEachCardTypeFromBoundGy,
    parsedCreatureFromCardsMilledThisWay,
    parsedCreatureHandOrCommandLesserMv,
    parsedSingleCardFromHand,
    parsedThemFromGraveyard,
    parsedTheCardsExiledWithIt,
    parsedAllCardsTheyExiledThisWay,
    parsedAllExiledWithThisPermanent,
    parsedAllExiledWithNamedSource,
    parsedAllExiledCardsWithCounter,
    parsedCountExiledWithSource,
  } = args.referenceQueries;

  if (parsedAnyNumberCreaturesTotalPower && step.to === 'battlefield') {
    const totalPowerLte =
      parsedAnyNumberCreaturesTotalPower.totalPowerLte === -1
        ? Math.max(0, sourcePermanentPower ?? Number(ctx.referenceAmount ?? 3))
        : parsedAnyNumberCreaturesTotalPower.totalPowerLte;
    const cardIds = selectGraveyardCreatureCardsWithTotalPowerLte(
      nextState,
      controllerId,
      totalPowerLte,
      getChosenObjectIds(ctx)
    );
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of cardIds) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        controllerId,
        cardId,
        { cardType: 'creature' },
        'battlefield',
        controllerId,
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
      log: combinedLog.length > 0 ? combinedLog : [`Returned creatures by total power: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedUpToThatManyFromTheirGy && step.to === 'exile') {
    const targetPlayerId = getTargetPlayerId(ctx);
    const dynamicMaxCount = Math.max(0, Number(ctx.referenceAmount ?? 2));
    const result = exileUpToMatchingFromGraveyard(
      nextState,
      targetPlayerId,
      dynamicMaxCount,
      parsedUpToThatManyFromTheirGy.criteria,
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
      return buildAppliedResult({ state: nextState, log: [`No matching graveyard cards: ${step.raw}`] });
    }
    return finalizeAppliedResult(result);
  }

  if (parsedAllOtherTappedCreatures && step.to === 'hand') {
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = [...((nextState.battlefield || []) as any[])];
    const targetIds = battlefield
      .filter(perm => {
        const id = String((perm as any)?.id || '').trim();
        if (!id || id === sourceId) return false;
        if (!(perm as any)?.tapped) return false;
        return hasExecutorClass(perm as any, 'creature');
      })
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds);
    return finalizeAppliedResult(result);
  }

  if (parsedHalfCreaturesTheyControl && step.to === 'hand') {
    const targetPlayerId = getTargetPlayerId(ctx) || controllerId;
    const creatures = ((nextState.battlefield || []) as any[])
      .filter(perm => {
        if (!hasExecutorClass(perm as any, 'creature')) return false;
        return String((perm as any)?.controller || '').trim() === targetPlayerId;
      })
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    const bounceCount = Math.ceil(creatures.length / 2);
    if (bounceCount <= 0) {
      return buildAppliedResult({ state: nextState, log: [`No creatures to return: ${step.raw}`] });
    }
    const preferred = getChosenObjectIds(ctx).filter(id => creatures.includes(id));
    const bounceIds =
      preferred.length >= bounceCount ? preferred.slice(0, bounceCount) : creatures.slice(0, bounceCount);
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, bounceIds);
    return finalizeAppliedResult(result);
  }

  if (parsedAllTappedCreatures && step.to === 'hand') {
    const selector = parseSimpleBattlefieldSelector({
      kind: 'raw',
      text: 'all tapped creatures',
    } as any);
    if (!selector) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const result = bounceMatchingBattlefieldPermanentsToOwnersHands(nextState, selector, ctx);
    return finalizeAppliedResult(result);
  }

  if (parsedCompoundOpponentRandomExile && step.to === 'exile') {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedCards: any[] = [];
    const topResult = moveTopCardFromLibrary(workingState, targetPlayerId, 'exile');
    if (topResult.kind === 'applied') {
      workingState = topResult.state;
      combinedLog.push(...topResult.log);
      movedCards.push(...(topResult.movedCards || []));
    }
    const gySelection = selectRandomMatchingCardIdFromGraveyard(workingState, targetPlayerId, { cardType: 'any' });
    if (gySelection.kind === 'selected') {
      const gyResult = moveTargetedCardFromGraveyard(
        workingState,
        targetPlayerId,
        gySelection.cardId,
        { cardType: 'any' },
        'exile'
      );
      if (gyResult.kind === 'applied') {
        workingState = gyResult.state;
        combinedLog.push(...(gyResult.log || []));
        if (Array.isArray(gyResult.movedCards)) movedCards.push(...gyResult.movedCards);
      }
    }
    const handResult = exileRandomCardFromHand(workingState, targetPlayerId, getChosenObjectIds(ctx));
    workingState = handResult.state;
    combinedLog.push(...handResult.log);
    movedCards.push(...handResult.movedCards);
    return finalizeAppliedResult({ state: workingState, log: combinedLog, movedCards });
  }

  if (parsedUpToOneEachCardTypeFromBoundGy && step.to === 'exile') {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const result = exileUpToOneEachCardTypeFromGraveyard(
      nextState,
      targetPlayerId,
      getChosenObjectIds(ctx)
    );
    return finalizeAppliedResult(result);
  }

  if (
    parsedCreatureFromCardsMilledThisWay &&
    (step.to === 'hand' || step.to === 'exile')
  ) {
    const cardId = resolveFirstMatchingCardIdFromPlayerGraveyard(
      nextState,
      controllerId,
      [{ cardType: parsedCreatureFromCardsMilledThisWay.cardType }],
      getChosenObjectIds(ctx)
    );
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No milled-this-way creature: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      cardId,
      { cardType: parsedCreatureFromCardsMilledThisWay.cardType },
      step.to
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (milled card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedCreatureHandOrCommandLesserMv && step.to === 'battlefield') {
    const referenceMv = Math.max(0, Number(ctx.spellManaValue ?? ctx.referenceAmount ?? 3));
    const preferredIds = getChosenObjectIds(ctx);
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    const match = hand.find((card: any) => {
      const cardId = String(card?.id || '').trim();
      if (!cardId || !cardMatchesType(card, parsedCreatureHandOrCommandLesserMv.cardType)) return false;
      if (preferredIds.length > 0 && !preferredIds.includes(cardId)) return false;
      const mv = getCardManaValue(card);
      return mv !== null && mv < referenceMv;
    }) || hand.find((card: any) => {
      const mv = getCardManaValue(card);
      return cardMatchesType(card, parsedCreatureHandOrCommandLesserMv.cardType) && mv !== null && mv < referenceMv;
    });
    const cardId = String((match as any)?.id || '').trim();
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No lesser-MV creature in hand: ${step.raw}`] });
    }
    const result = moveTargetedCardFromHand(
      nextState,
      controllerId,
      cardId,
      parsedCreatureHandOrCommandLesserMv.cardType,
      'battlefield',
      controllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      battlefieldEntryOverrides
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (hand creature unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedSingleCardFromHand && step.to === 'exile') {
    const preferredIds = getChosenObjectIds(ctx);
    const cardId = resolveTypedCardIdFromPlayerZone(
      nextState,
      controllerId,
      'hand',
      parsedSingleCardFromHand.cardType,
      preferredIds
    );
    if (!cardId) {
      return {
        applied: false,
        message: `Skipped move zone (hand card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const entersFaceDown = /\bface\s+down\b/i.test(String(step.raw || '')) || Boolean(step.entersFaceDown);
    const result = moveTargetedCardFromHand(
      nextState,
      controllerId,
      cardId,
      parsedSingleCardFromHand.cardType,
      'exile',
      undefined,
      false,
      entersFaceDown
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (hand card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedSingleCardFromHand && step.to === 'library' && getLibraryPlacement(step)) {
    const preferredIds = getChosenObjectIds(ctx);
    const result = moveCountFromHandToLibrary(
      nextState,
      controllerId,
      1,
      getLibraryPlacement(step) === 'top' ? 'top' : 'bottom',
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
      return {
        applied: false,
        message: `Skipped move zone (hand card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return buildAppliedResult({ state: result.state, log: result.log });
  }

  if (parsedThemFromGraveyard && step.to === 'exile') {
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, ['graveyard']);
    if (candidateIds.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No contextual graveyard cards: ${step.raw}`] });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of candidateIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location || location.zone !== 'graveyard') continue;
      const result = moveTargetedCardFromGraveyard(workingState, location.playerId, cardId, { cardType: 'any' }, 'exile');
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Exiled contextual graveyard cards: ${step.raw}`],
    });
  }

  if (
    parsedCountExiledWithSource &&
    step.to === 'battlefield'
  ) {
    const sourceId = String(ctx.sourceId || '').trim();
    if (!sourceId) {
      return {
        applied: false,
        message: `Skipped move zone (linked exile source unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const matches = findCardsExiledWithSource(nextState, sourceId, {
      cardType: parsedCountExiledWithSource.cardType,
    });
    if (matches.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No cards exiled with source: ${step.raw}`] });
    }
    const preferredIds = getChosenObjectIds(ctx);
    const selectedIds = (
      preferredIds.length > 0
        ? preferredIds.filter((id) => matches.some((match) => match.cardId === id))
        : matches.map((match) => match.cardId)
    ).slice(0, parsedCountExiledWithSource.count);
    const selectedSet = new Set(selectedIds);
    let workingState = nextState;
    const combinedLog: string[] = [];
    let movedPermanentIds: string[] = [];
    for (const match of matches) {
      if (!selectedSet.has(match.cardId)) continue;
      const battlefieldControllerId =
        step.battlefieldController?.kind === 'owner_of_moved_cards' ? match.playerId : controllerId;
      const result = moveTargetedCardFromExile(
        workingState,
        match.playerId,
        match.cardId,
        parsedCountExiledWithSource.cardType,
        'battlefield',
        battlefieldControllerId,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        undefined,
        battlefieldEntryOverrides
      );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedPermanentIds = movedPermanentIds.concat((result as any).movedPermanentIds || []);
    }
    if (parsedCountExiledWithSource.withRestToOwnersLibraryBottom) {
      const remaining = findCardsExiledWithSource(workingState, sourceId, {
        cardType: parsedCountExiledWithSource.cardType,
      });
      for (const match of remaining) {
        const result = moveTargetedCardFromExile(
          workingState,
          match.playerId,
          match.cardId,
          parsedCountExiledWithSource.cardType,
          'library_bottom'
        );
        if (result.kind !== 'applied') continue;
        workingState = result.state;
        combinedLog.push(...(result.log || []));
      }
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved counted exiled-with cards: ${step.raw}`],
      ...(movedPermanentIds.length > 0 ? { movedPermanentIds } : {}),
    });
  }

  if (
    parsedAllExiledCardsWithCounter &&
    (step.to === 'hand' || step.to === 'graveyard' || step.to === 'battlefield' || step.to === 'library')
  ) {
    const matches = findAllExiledCardsWithCounter(
      nextState,
      parsedAllExiledCardsWithCounter.counterName,
      parsedAllExiledCardsWithCounter.controllerOwned ? controllerId : undefined
    );
    if (matches.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No exiled cards with ${parsedAllExiledCardsWithCounter.counterName} counters: ${step.raw}`],
      });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedCards: any[] = [];
    let movedPermanentIds: string[] = [];
    for (const match of matches) {
      const battlefieldControllerId =
        step.battlefieldController?.kind === 'owner_of_moved_cards' ? match.playerId : controllerId;
      const result =
        step.to === 'hand'
          ? moveTargetedCardFromExile(workingState, match.playerId, match.cardId, 'any', 'hand')
          : step.to === 'battlefield'
            ? moveTargetedCardFromExile(
                workingState,
                match.playerId,
                match.cardId,
                'any',
                'battlefield',
                battlefieldControllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                undefined,
                battlefieldEntryOverrides
              )
            : moveTargetedCardFromExile(workingState, match.playerId, match.cardId, 'any', 'graveyard');
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      if (Array.isArray((result as any).movedCards)) movedCards.push(...(result as any).movedCards);
      movedPermanentIds = movedPermanentIds.concat((result as any).movedPermanentIds || []);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved exiled cards with counters: ${step.raw}`],
      ...(movedCards.length > 0 ? { movedCards } : {}),
      ...(movedPermanentIds.length > 0 ? { movedPermanentIds } : {}),
    });
  }

  if (
    parsedAllExiledWithNamedSource &&
    (step.to === 'hand' || step.to === 'graveyard' || step.to === 'battlefield' || step.to === 'library')
  ) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourceName = String(ctx.sourceName || '').trim().toLowerCase();
    const namedSource = String(parsedAllExiledWithNamedSource || '').trim().toLowerCase();
    const namesMatch =
      Boolean(sourceName) &&
      (sourceName === namedSource ||
        sourceName.startsWith(namedSource) ||
        namedSource.startsWith(sourceName));
    if (!sourceId || !namesMatch) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const matches = findCardsExiledWithSource(nextState, sourceId, { cardType: 'any' });
    if (matches.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No cards exiled with source: ${step.raw}`] });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedCards: any[] = [];
    let movedPermanentIds: string[] = [];
    for (const match of matches) {
      const battlefieldControllerId =
        step.battlefieldController?.kind === 'owner_of_moved_cards' ? match.playerId : controllerId;
      const result =
        step.to === 'hand'
          ? moveTargetedCardFromExile(workingState, match.playerId, match.cardId, 'any', 'hand')
          : step.to === 'battlefield'
            ? moveTargetedCardFromExile(
                workingState,
                match.playerId,
                match.cardId,
                'any',
                'battlefield',
                battlefieldControllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                undefined,
                battlefieldEntryOverrides
              )
            : moveTargetedCardFromExile(workingState, match.playerId, match.cardId, 'any', 'graveyard');
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      if (Array.isArray((result as any).movedCards)) movedCards.push(...(result as any).movedCards);
      movedPermanentIds = movedPermanentIds.concat((result as any).movedPermanentIds || []);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved cards exiled with source: ${step.raw}`],
      ...(movedCards.length > 0 ? { movedCards } : {}),
      ...(movedPermanentIds.length > 0 ? { movedPermanentIds } : {}),
    });
  }

  if (
    parsedAllCardsTheyExiledThisWay &&
    (step.to === 'battlefield' || step.to === 'hand' || step.to === 'graveyard')
  ) {
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, ['exile']);
    if (candidateIds.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No cards exiled this way: ${step.raw}`] });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    let movedPermanentIds: string[] = [];
    for (const cardId of candidateIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location || location.zone !== 'exile') continue;
      const battlefieldControllerId =
        step.battlefieldController?.kind === 'owner_of_moved_cards' ? location.playerId : controllerId;
      const result =
        step.to === 'hand'
          ? moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'hand')
          : step.to === 'battlefield'
            ? moveTargetedCardFromExile(
                workingState,
                location.playerId,
                cardId,
                'any',
                'battlefield',
                battlefieldControllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                undefined,
                battlefieldEntryOverrides
              )
            : moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'graveyard');
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedPermanentIds = movedPermanentIds.concat((result as any).movedPermanentIds || []);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved cards they exiled this way: ${step.raw}`],
      ...(movedPermanentIds.length > 0 ? { movedPermanentIds } : {}),
    });
  }

  if (
    (parsedTheCardsExiledWithIt || parsedAllExiledWithThisPermanent) &&
    (step.to === 'hand' || step.to === 'graveyard' || step.to === 'battlefield')
  ) {
    const sourceId = String(ctx.sourceId || '').trim();
    const exiledCriteria = parsedAllExiledWithThisPermanent || { cardType: 'any' as const };
    let matches = findCardsExiledWithSource(nextState, sourceId, { cardType: exiledCriteria.cardType });
    if (parsedAllExiledWithThisPermanent?.excludeCreatureCards) {
      matches = matches.filter(match => {
        const player = nextState.players.find(p => p.id === match.playerId) as any;
        const exile = Array.isArray(player?.exile) ? player.exile : [];
        const card = exile.find((entry: any) => String(entry?.id || '').trim() === match.cardId);
        return card ? !cardMatchesType(card, 'creature') : true;
      });
    }
    if (matches.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No cards exiled with source: ${step.raw}`] });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    let movedPermanentIds: string[] = [];
    for (const match of matches) {
      const battlefieldControllerId =
        step.battlefieldController?.kind === 'owner_of_moved_cards' ? match.playerId : controllerId;
      const result =
        step.to === 'hand'
          ? moveTargetedCardFromExile(workingState, match.playerId, match.cardId, 'any', 'hand')
          : step.to === 'battlefield'
            ? moveTargetedCardFromExile(
                workingState,
                match.playerId,
                match.cardId,
                'any',
                'battlefield',
                battlefieldControllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                undefined,
                battlefieldEntryOverrides
              )
            : moveTargetedCardFromExile(workingState, match.playerId, match.cardId, 'any', 'graveyard');
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedPermanentIds = movedPermanentIds.concat((result as any).movedPermanentIds || []);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved cards exiled with source: ${step.raw}`],
      ...(movedPermanentIds.length > 0 ? { movedPermanentIds } : {}),
    });
  }


  return undefined;
}
