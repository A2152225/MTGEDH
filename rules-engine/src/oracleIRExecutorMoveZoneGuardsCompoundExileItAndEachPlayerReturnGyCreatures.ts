// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: the applyMoveZoneStep selector guards starting at if (parsedCompoundExileItAndEachPlayerReturnGyCreatures) {
// Public entry symbol: tryApplyMoveZoneGuardsFromCompoundExileItAndEachPlayerReturnGyCreatures.

import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';
import type { PlayerID } from '../../shared/src';
import { getCurrentTurnNumber } from './oracleIRExecutorPlayerUtils';
import { hasExecutorClass, getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { moveBattlefieldPermanentsByIdToOwnersHands } from './oracleIRExecutorBattlefieldOps';
import {
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
  moveTargetedCardFromExile,
  resolveFirstMatchingCardIdFromPlayerGraveyard,
  selectGraveyardCardIdsWithDifferentNames,
  putAllMatchingCriteriaFromGraveyardOntoBattlefield,
  cardMatchesMoveZoneSingleTargetCriteria,
  returnAllMatchingFromGraveyardToHand,
  cardMatchesType,
  createBattlefieldPermanentsFromCards,
  shuffleContextualCardsIntoLibrary,
  addBattlefieldPermanentsToState,
} from './oracleIRExecutorZoneOps';
import { findBoundCardZoneLocation, getChosenObjectIds, getTargetPlayerId } from './oracleIRExecutorMoveZoneReferenceResolvers';
import { moveContextualCardToDestination, moveContextualRestToLibraryBottom, resolveMoveZoneSingleTargetCriteriaWithX } from './oracleIRExecutorMoveZoneContextualCardResolvers';
import { buildAppliedResult } from './oracleIRExecutorMoveZoneStepResultBuilders';

export function tryApplyMoveZoneGuardsFromCompoundExileItAndEachPlayerReturnGyCreatures(args: MoveZoneGuardArgs): MoveZoneStepHandlerResult | undefined {
  const { state, step, ctx, runtime, nextState, log, controllerId, effectiveWithCounters, battlefieldEntryOverrides, finalizeAppliedResult } = args;
  const {
    parsedCompoundExileItAndEachPlayerReturnGyCreatures,
    parsedThoseCreatureCards,
  } = args.zoneQueries;
  const {
    parsedAnyNumberMountainsYouControl,
    parsedAnyNumberBasicLandSubtypeYouControl,
    parsedThoseLands,
    parsedAnyNumberFromYourGraveyard,
    parsedTheChosenCards,
    parsedOneOfTheChosenCards,
    parsedOtherChosenCards,
    parsedChosenCardsRestToLibrary,
    parsedEachPlayerGyNotPutThisWay,
    parsedShuffleTypedCardsOfThatType,
    parsedTopTypedCardFromTargetPlayerGy,
    parsedTopTypedCardFromYourGy,
    parsedEachCreatureMvXFromGy,
    parsedTypedCardFromTargetPlayerGy,
  } = args.referenceQueries;

  if (parsedCompoundExileItAndEachPlayerReturnGyCreatures) {
    let workingState = nextState;
    const combinedLog: string[] = [];
    const sourceId = String(ctx.sourceId || '').trim();
    for (const player of (workingState.players || []) as any[]) {
      const playerId = String(player?.id || '').trim() as PlayerID;
      if (!playerId) continue;
      const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
      const sourceGyCard = graveyard.find((card: any) => {
        const cardId = String(card?.id || '').trim();
        return (
          cardId === sourceId ||
          cardId === 'gy-source-self' ||
          cardId.startsWith('gy-source')
        );
      });
      const sourceGyCardId = String((sourceGyCard as any)?.id || '').trim();
      if (!sourceGyCardId || playerId !== controllerId) continue;
      const exileResult = moveTargetedCardFromGraveyard(
        workingState,
        playerId,
        sourceGyCardId,
        { cardType: 'any' },
        'exile'
      );
      if (exileResult.kind === 'applied') {
        workingState = exileResult.state;
        combinedLog.push(...(exileResult.log || []));
      }
      break;
    }
    for (const player of (workingState.players || []) as any[]) {
      const playerId = String(player?.id || '').trim() as PlayerID;
      if (!playerId) continue;
      const returnResult = returnAllMatchingFromGraveyardToHand(workingState, playerId, 'creature');
      workingState = returnResult.state;
      combinedLog.push(...returnResult.log);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Compound graveyard return: ${step.raw}`],
    });
  }

  if (
    parsedTypedCardFromTargetPlayerGy &&
    (step.to === 'hand' || step.to === 'exile' || step.to === 'battlefield')
  ) {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const cardId = resolveFirstMatchingCardIdFromPlayerGraveyard(
      nextState,
      targetPlayerId,
      [parsedTypedCardFromTargetPlayerGy],
      getChosenObjectIds(ctx)
    );
    if (!cardId) {
      return {
        applied: false,
        message: `Skipped move zone (target graveyard card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      targetPlayerId,
      cardId,
      parsedTypedCardFromTargetPlayerGy,
      step.to === 'exile' ? 'exile' : step.to === 'battlefield' ? 'battlefield' : 'hand',
      step.to === 'battlefield' ? targetPlayerId : undefined,
      step.entersTapped,
      step.entersFaceDown,
      step.withCounters
    );
    return result.kind === 'impossible'
      ? {
          applied: false,
          message: `Skipped move zone (target graveyard card unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        }
      : finalizeAppliedResult(result);
  }

  if (parsedAnyNumberBasicLandSubtypeYouControl && step.to === 'hand') {
    const subtype = parsedAnyNumberBasicLandSubtypeYouControl.subtype;
    const battlefield = [...((nextState.battlefield || []) as any[])];
    const matches = battlefield.filter(
      (perm: any) =>
        String(perm?.controller || '').trim() === controllerId &&
        cardMatchesType(perm?.card || perm, 'land') &&
        getExecutorTypeLineLower(perm?.card || perm).includes(subtype)
    );
    const movedIds = matches.map((perm: any) => String(perm?.id || '').trim()).filter(Boolean);
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, movedIds);
    return finalizeAppliedResult({
      applied: true,
      state: result.state,
      log:
        result.log.length > 0
          ? [`Returned ${movedIds.length} ${subtype}(s) to hand: ${step.raw}`, ...result.log]
          : [`Returned ${movedIds.length} ${subtype}(s) to hand: ${step.raw}`],
      lastMovedCards: matches.map((perm: any) => perm?.card || perm),
    });
  }

  if (parsedAnyNumberMountainsYouControl && step.to === 'hand') {
    const controllerPlayer = nextState.players.find(p => p.id === controllerId) as any;
    const hand = Array.isArray(controllerPlayer?.hand) ? [...controllerPlayer.hand] : [];
    const battlefield = [...((nextState.battlefield || []) as any[])];
    const mountains = battlefield.filter(
      (perm: any) =>
        String(perm?.controller || '').trim() === controllerId &&
        cardMatchesType(perm?.card || perm, 'land') &&
        getExecutorTypeLineLower(perm?.card || perm).includes('mountain')
    );
    const movedIds = mountains.map((perm: any) => String(perm?.id || '').trim()).filter(Boolean);
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, movedIds);
    return finalizeAppliedResult({
      applied: true,
      state: result.state,
      log:
        result.log.length > 0
          ? [`Returned ${movedIds.length} Mountain(s) to hand: ${step.raw}`, ...result.log]
          : [`Returned ${movedIds.length} Mountain(s) to hand: ${step.raw}`],
      lastMovedCards: mountains.map((perm: any) => perm?.card || perm),
    });
  }

  if (parsedThoseLands && step.to === 'hand') {
    const contextual = [
      ...(Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []),
      ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
    ];
    const seen = new Set<string>();
    const landIds: string[] = [];
    for (const card of contextual) {
      const cardId = String((card as any)?.id || '').trim();
      if (!cardId || seen.has(cardId)) continue;
      const perm = ((nextState.battlefield || []) as any[]).find(entry => String(entry?.id || '').trim() === cardId);
      if (!perm || !hasExecutorClass(perm as any, 'land')) continue;
      seen.add(cardId);
      landIds.push(cardId);
    }
    if (landIds.length === 0) {
      for (const perm of (nextState.battlefield || []) as any[]) {
        const permId = String(perm?.id || '').trim();
        if (!permId || seen.has(permId) || !hasExecutorClass(perm as any, 'land')) continue;
        seen.add(permId);
        landIds.push(permId);
      }
    }
    if (landIds.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No contextual lands: ${step.raw}`] });
    }
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, landIds);
    return finalizeAppliedResult(result);
  }

  if (parsedThoseCreatureCards && step.to === 'battlefield') {
    const contextual = [
      ...(Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []),
      ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
    ];
    const creatureCards = contextual.filter((card: any) => cardMatchesType(card, 'creature'));
    const seen = new Set<string>();
    const uniqueCards = creatureCards.filter((card: any) => {
      const cardId = String(card?.id || '').trim();
      if (!cardId || seen.has(cardId)) return false;
      seen.add(cardId);
      return true;
    });
    if (uniqueCards.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No contextual creature cards: ${step.raw}`] });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const card of uniqueCards) {
      const cardId = String((card as any)?.id || '').trim();
      const location = findBoundCardZoneLocation(workingState, cardId);
      const result = location
        ? location.zone === 'library'
          ? moveContextualCardToDestination(workingState, location, cardId, 'battlefield', {
              controllerId,
              ctx,
              cardType: 'creature',
              entersTapped: step.entersTapped,
              entersFaceDown: step.entersFaceDown,
              withCounters: effectiveWithCounters,
              battlefieldEntryOverrides,
            })
          : location.zone === 'graveyard'
            ? moveTargetedCardFromGraveyard(
                workingState,
                location.playerId,
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
              )
            : location.zone === 'hand'
              ? moveTargetedCardFromHand(
                  workingState,
                  location.playerId,
                  cardId,
                  'creature',
                  'battlefield',
                  controllerId,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters,
                  undefined,
                  battlefieldEntryOverrides
                )
              : moveTargetedCardFromExile(
                  workingState,
                  location.playerId,
                  cardId,
                  'creature',
                  'battlefield',
                  controllerId,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters,
                  undefined,
                  battlefieldEntryOverrides
                )
        : {
            kind: 'applied' as const,
            state: addBattlefieldPermanentsToState(
              workingState,
              createBattlefieldPermanentsFromCards(
                [card],
                controllerId,
                controllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                'library'
              )
            ),
            log: [`${controllerId} puts ${cardId} onto the battlefield from contextual cards`],
            movedPermanentIds: [],
          };
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...((result as any).movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved ${uniqueCards.length} creature card(s) to battlefield`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedTopTypedCardFromYourGy && step.to === 'battlefield') {
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
    const topMatch = [...graveyard].reverse().find((card: any) =>
      cardMatchesMoveZoneSingleTargetCriteria(card, parsedTopTypedCardFromYourGy)
    );
    const cardId = String((topMatch as any)?.id || '').trim();
    if (!cardId) {
      return {
        applied: false,
        message: `Skipped move zone (top graveyard card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      cardId,
      parsedTopTypedCardFromYourGy,
      'battlefield',
      controllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      undefined,
      undefined,
      battlefieldEntryOverrides
    );
    return result.kind === 'impossible'
      ? {
          applied: false,
          message: `Skipped move zone (top graveyard card unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        }
      : finalizeAppliedResult(result);
  }

  if (parsedAnyNumberFromYourGraveyard && step.to === 'battlefield') {
    const player = nextState.players.find((p) => p.id === controllerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    const preferredIds = getChosenObjectIds(ctx);
    const currentTurn = getCurrentTurnNumber(nextState);
    const cardIds = parsedAnyNumberFromYourGraveyard.differentNames
      ? selectGraveyardCardIdsWithDifferentNames(
          graveyard,
          parsedAnyNumberFromYourGraveyard,
          preferredIds,
          currentTurn
        )
      : graveyard
          .filter((card: any) => {
            const cardId = String(card?.id || '').trim();
            if (!cardId) return false;
            if (
              preferredIds.length > 0 &&
              !preferredIds.includes(cardId) &&
              !cardMatchesMoveZoneSingleTargetCriteria(card, parsedAnyNumberFromYourGraveyard, undefined, currentTurn)
            ) {
              return false;
            }
            return cardMatchesMoveZoneSingleTargetCriteria(card, parsedAnyNumberFromYourGraveyard, undefined, currentTurn);
          })
          .map((card: any) => String(card?.id || '').trim())
          .filter(Boolean)
          .filter((cardId) => preferredIds.length === 0 || preferredIds.includes(cardId));
    if (cardIds.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No matching graveyard cards: ${step.raw}`] });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    const bfController =
      step.battlefieldController?.kind === 'you' || step.battlefieldController?.kind === 'owner_of_moved_cards'
        ? controllerId
        : controllerId;
    for (const cardId of cardIds) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        controllerId,
        cardId,
        parsedAnyNumberFromYourGraveyard,
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
      log: combinedLog.length > 0 ? combinedLog : [`Returned any-number graveyard cards: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedEachCreatureMvXFromGy && step.to === 'battlefield') {
    const criteria = resolveMoveZoneSingleTargetCriteriaWithX(parsedEachCreatureMvXFromGy, ctx);
    const returnResult = putAllMatchingCriteriaFromGraveyardOntoBattlefield(
      nextState,
      controllerId,
      controllerId,
      criteria,
      [],
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters
    );
    return buildAppliedResult({
      state: returnResult.state,
      log: returnResult.log.length > 0 ? returnResult.log : [`Returned each creature MV X or less: ${step.raw}`],
      movedBattlefieldPermanentIds: returnResult.movedPermanentIds,
    });
  }

  if (parsedTopTypedCardFromTargetPlayerGy && step.to === 'battlefield') {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const player = nextState.players.find(p => p.id === targetPlayerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
    const topMatch = [...graveyard].reverse().find((card: any) =>
      cardMatchesMoveZoneSingleTargetCriteria(card, parsedTopTypedCardFromTargetPlayerGy)
    );
    const cardId = String((topMatch as any)?.id || '').trim();
    if (!cardId) {
      return {
        applied: false,
        message: `Skipped move zone (top graveyard card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      targetPlayerId,
      cardId,
      parsedTopTypedCardFromTargetPlayerGy,
      'battlefield',
      controllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      undefined,
      undefined,
      battlefieldEntryOverrides
    );
    return result.kind === 'impossible'
      ? {
          applied: false,
          message: `Skipped move zone (top graveyard card unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        }
      : finalizeAppliedResult(result);
  }

  if (parsedShuffleTypedCardsOfThatType && step.to === 'library') {
    const criteria = resolveMoveZoneSingleTargetCriteriaWithX(parsedShuffleTypedCardsOfThatType, ctx);
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
    const matching = graveyard.filter((card: any) => cardMatchesMoveZoneSingleTargetCriteria(card, criteria));
    if (matching.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No matching graveyard cards to shuffle: ${step.raw}`] });
    }
    const kept = graveyard.filter((card: any) => !matching.includes(card));
    const library = Array.isArray(player?.library) ? [...player.library, ...matching] : [...matching];
    const updatedPlayers = nextState.players.map(p =>
      p.id === controllerId ? ({ ...(p as any), graveyard: kept, library } as any) : p
    );
    return buildAppliedResult({
      state: { ...nextState, players: updatedPlayers as any },
      log: [`Shuffled ${matching.length} card(s) from graveyard into library: ${step.raw}`],
    });
  }

  if (parsedEachPlayerGyNotPutThisWay && step.to === 'battlefield') {
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const player of (workingState.players || []) as any[]) {
      const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
      for (const card of graveyard) {
        const cardId = String((card as any)?.id || '').trim();
        if (!cardId || !cardMatchesMoveZoneSingleTargetCriteria(card, parsedEachPlayerGyNotPutThisWay)) continue;
        const result = moveTargetedCardFromGraveyard(
          workingState,
          player.id,
          cardId,
          parsedEachPlayerGyNotPutThisWay,
          'battlefield',
          player.id,
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
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned each-player graveyard cards: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedOneOfTheChosenCards && step.to === 'battlefield') {
    const chosenIds = getChosenObjectIds(ctx);
    const cardId = chosenIds[0];
    if (!cardId) {
      return {
        applied: false,
        message: `Skipped move zone (no chosen card for battlefield): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const location = findBoundCardZoneLocation(nextState, cardId);
    if (!location) {
      return {
        applied: false,
        message: `Skipped move zone (chosen card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const result =
      location.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(
            nextState,
            location.playerId,
            cardId,
            { cardType: 'any' },
            'battlefield',
            controllerId,
            step.entersTapped,
            step.entersFaceDown,
            step.withCounters
          )
        : moveContextualCardToDestination(nextState, location, cardId, 'battlefield', {
            controllerId,
            ctx,
            cardType: 'any',
            entersTapped: step.entersTapped,
            entersFaceDown: step.entersFaceDown,
            withCounters: step.withCounters,
          });
    if (result.kind !== 'applied') {
      return {
        applied: false,
        message: `Skipped move zone (chosen card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return buildAppliedResult({ state: result.state, log: result.log });
  }

  if (parsedOtherChosenCards && step.to === 'hand') {
    const chosenIds = getChosenObjectIds(ctx).slice(1);
    if (chosenIds.length === 0) {
      return { applied: true, state: nextState, log: ['No other chosen cards to move to hand'] };
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of chosenIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const result =
        location.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(workingState, location.playerId, cardId, { cardType: 'any' }, 'hand')
          : location.zone === 'exile'
            ? moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'hand')
            : moveContextualCardToDestination(workingState, location, cardId, 'hand', {
                controllerId,
                cardType: 'any',
              });
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...result.log);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved other chosen cards to hand: ${step.raw}`],
    });
  }

  if ((parsedTheChosenCards || parsedChosenCardsRestToLibrary) && step.to === 'library') {
    const preferredIds = getChosenObjectIds(ctx);
    const matchingIds = preferredIds.filter(id => Boolean(findBoundCardZoneLocation(nextState, id)));
    if (matchingIds.length === 0) {
      return {
        applied: false,
        message: `Skipped move zone (chosen cards unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const shuffleResult = shuffleContextualCardsIntoLibrary(nextState, controllerId, matchingIds);
    return buildAppliedResult({
      state: shuffleResult.state,
      log: shuffleResult.log.length > 0 ? shuffleResult.log : [`Shuffled chosen cards into library: ${step.raw}`],
    });
  }

  if (parsedTheChosenCards && step.to === 'battlefield') {
    const preferredIds = getChosenObjectIds(ctx);
    const matchingIds = preferredIds.filter(id => Boolean(findBoundCardZoneLocation(nextState, id)));
    if (matchingIds.length === 0) {
      return {
        applied: false,
        message: `Skipped move zone (chosen cards unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedPermanentIds: string[] = [];
    const bfControllerId =
      step.battlefieldController?.kind === 'you'
        ? controllerId
        : step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? controllerId
          : controllerId;
    for (const cardId of matchingIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const result =
        location.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(
              workingState,
              location.playerId,
              cardId,
              { cardType: 'any' },
              'battlefield',
              bfControllerId,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              undefined,
              undefined,
              battlefieldEntryOverrides
            )
          : location.zone === 'hand'
            ? moveTargetedCardFromHand(
                workingState,
                location.playerId,
                cardId,
                'any',
                'battlefield',
                bfControllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                undefined,
                battlefieldEntryOverrides
              )
            : moveTargetedCardFromExile(
                workingState,
                location.playerId,
                cardId,
                'any',
                'battlefield',
                bfControllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                undefined,
                battlefieldEntryOverrides
              );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      if (Array.isArray((result as any).movedPermanentIds)) {
        movedPermanentIds.push(...((result as any).movedPermanentIds as string[]));
      }
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned chosen cards to battlefield: ${step.raw}`],
      ...(movedPermanentIds.length > 0 ? { movedPermanentIds } : {}),
    });
  }

  if ((parsedTheChosenCards || parsedChosenCardsRestToLibrary) && step.to === 'hand') {
    const preferredIds = getChosenObjectIds(ctx);
    const matchingIds = preferredIds.filter(id => Boolean(findBoundCardZoneLocation(nextState, id)));
    if (matchingIds.length === 0) {
      return {
        applied: false,
        message: `Skipped move zone (chosen cards unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedCardIds: string[] = [];
    for (const cardId of matchingIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const result =
        location.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(workingState, location.playerId, cardId, { cardType: 'any' }, 'hand')
          : location.zone === 'hand'
            ? { kind: 'applied' as const, state: workingState, log: [] }
            : moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'hand');
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedCardIds.push(cardId);
    }
    if (parsedChosenCardsRestToLibrary) {
      const restResult = moveContextualRestToLibraryBottom(workingState, controllerId, ctx, runtime, movedCardIds);
      workingState = restResult.state;
      combinedLog.push(...restResult.log);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved chosen cards: ${step.raw}`],
    });
  }


  return undefined;
}
