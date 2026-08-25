// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: the applyMoveZoneStep selector guards starting at if (parsedUpToCountTotalMvFromYourGraveyard && step.to === 'battlefield') {
// Public entry symbol: tryApplyMoveZoneGuardsFromUpToCountTotalMvFromYourGraveyard.

import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';
import type { PlayerID } from '../../shared/src';
import { parseSimpleBattlefieldSelector } from './oracleIRExecutorBattlefieldParser';
import { hasExecutorClass } from './oracleIRExecutorPermanentUtils';
import {
  finalizeBattlefieldRemoval,
  moveBattlefieldPermanentsByIdToOwnersLibraries,
  moveBattlefieldPermanentsByIdToOwnersHands,
  permanentMatchesSelector,
  permanentMatchesType,
} from './oracleIRExecutorBattlefieldOps';
import {
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromExile,
  findCardsExiledWithSource,
  selectContextualCardsWithTotalManaValueLte,
  cardMatchesMoveZoneSingleTargetCriteria,
  moveTargetedCardFromHandToLibrary,
  cardHasCyclingAbility,
  exileCountFromTopOfLibrary,
  cardMatchesType,
} from './oracleIRExecutorZoneOps';
import {
  findBoundCardZoneLocation,
  getChosenObjectIds,
  getTargetObjectId,
  normalizeReferenceText,
  resolveUniqueChosenAnyGraveyardTargetId,
} from './oracleIRExecutorMoveZoneReferenceResolvers';
import { moveContextualCardToDestination, resolveOneOfThemCandidateCardIds } from './oracleIRExecutorMoveZoneContextualCardResolvers';
import { buildAppliedResult } from './oracleIRExecutorMoveZoneStepResultBuilders';

export function tryApplyMoveZoneGuardsFromUpToCountTotalMvFromYourGraveyard(args: MoveZoneGuardArgs): MoveZoneStepHandlerResult | undefined {
  const { state, step, ctx, runtime, nextState, log, controllerId, effectiveWithCounters, battlefieldEntryOverrides, finalizeAppliedResult, attachmentResolution } = args;
  const {
    parsedUpToCountTotalMvFromYourGraveyard,
    parsedUpToOneNonlandAmongThemRestLibraryBottom,
    parsedShuffleSourceAndTarget,
    parsedUpToXFromAmongExiled,
    parsedAnyNumberSaddledToHand,
    parsedUpToXOtherBfOrGy,
    parsedEachOpponentCreatureToughnessX,
    parsedEachCreaturePowerOfChosenQuality,
    parsedTopLibraryFaceDownPerOpponent,
    parsedAllNamedThisPermanent,
    parsedCreatureExiledWithVehicle,
    parsedAnyNumberCyclingPermanents,
  } = args.zoneQueries;
  const {
    parsedCreatureCardExiledWithSource,
    parsedCreatureCardExiledThisWay,
    parsedAllFromLibrary,
    parsedUpToTypedCardsFromAmongThem,
    parsedPutAllTypedAndFromAmongThem,
    parsedOneOnTopRestOnBottomLibrary,
  } = args.referenceQueries;

  if (parsedUpToCountTotalMvFromYourGraveyard && step.to === 'battlefield') {
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    const cardIds = selectContextualCardsWithTotalManaValueLte(
      graveyard,
      parsedUpToCountTotalMvFromYourGraveyard.cardType,
      parsedUpToCountTotalMvFromYourGraveyard.totalManaValueLte,
      parsedUpToCountTotalMvFromYourGraveyard.maxCount,
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
        { cardType: parsedUpToCountTotalMvFromYourGraveyard.cardType },
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
      log: combinedLog.length > 0 ? combinedLog : [`Returned graveyard cards: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedShuffleSourceAndTarget && step.to === 'library') {
    const sourceId = String(ctx.sourceId || '').trim();
    const targetId = String(ctx.targetCreatureId || ctx.targetPermanentId || '').trim();
    const ids = [sourceId, targetId].filter(Boolean);
    const result = moveBattlefieldPermanentsByIdToOwnersLibraries(nextState, ids, 'bottom');
    return finalizeAppliedResult(result);
  }

  if (parsedUpToXFromAmongExiled && step.to === 'hand') {
    const sourceId = String(ctx.sourceId || '').trim();
    const maxCount = Math.max(0, Number(ctx.xValue ?? ctx.referenceAmount ?? 3));
    const matches = findCardsExiledWithSource(nextState, sourceId, { cardType: 'any' });
    const preferred = getChosenObjectIds(ctx);
    let targetMatches = matches;
    if (preferred.length > 0) {
      targetMatches = matches.filter(match => preferred.includes(match.cardId));
      if (targetMatches.length === 0) targetMatches = matches;
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const match of targetMatches.slice(0, maxCount)) {
      const result = moveTargetedCardFromExile(workingState, match.playerId, match.cardId, 'any', 'hand');
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned exiled cards: ${step.raw}`],
    });
  }

  if (parsedAnyNumberSaddledToHand && step.to === 'hand') {
    const battlefield = [...((nextState.battlefield || []) as any[])];
    const currentTurn = Number((nextState as any).turnNumber ?? (nextState as any).turn ?? 0) || 0;
    const matches = battlefield.filter(
      perm =>
        hasExecutorClass(perm as any, 'creature') &&
        Number((perm as any)?.saddledThisTurn ?? (perm as any)?.saddledTurn) === currentTurn
    );
    const preferred = getChosenObjectIds(ctx);
    let targetIds = matches.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean);
    if (preferred.length > 0) {
      targetIds = targetIds.filter(id => preferred.includes(id));
      if (targetIds.length === 0) targetIds = matches.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean);
    }
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds);
    return finalizeAppliedResult(result);
  }

  if (parsedUpToXOtherBfOrGy && step.to === 'exile') {
    const rawWhat = String((step.what as any)?.text || '').trim().toLowerCase();
    const maxCount = /\bthree\b/.test(rawWhat)
      ? 3
      : Math.max(0, Number(ctx.xValue ?? ctx.referenceAmount ?? 3));
    const targetObjectId = getTargetObjectId(ctx);
    let workingState = nextState;
    const combinedLog: string[] = [];
    let moved = 0;
    if (targetObjectId && moved < maxCount) {
      const hasBf = ((workingState.battlefield || []) as any[]).some(
        perm => String((perm as any)?.id || '').trim() === targetObjectId
      );
      if (hasBf) {
        const battlefield = [...((workingState.battlefield || []) as any[])];
        const perm = battlefield.find(entry => String((entry as any)?.id || '').trim() === targetObjectId);
        if (perm) {
          const removedIds = new Set([targetObjectId]);
          const kept = battlefield.filter(entry => String((entry as any)?.id || '').trim() !== targetObjectId);
          const result = finalizeBattlefieldRemoval(workingState, [perm], removedIds, kept, 'exile', 'exiled');
          workingState = result.state;
          combinedLog.push(...result.log);
          moved += 1;
        }
      }
    }
    if (moved < maxCount) {
      const gyTargetId = resolveUniqueChosenAnyGraveyardTargetId(
        workingState,
        { cardType: 'creature' },
        ctx,
        runtime,
        ctx.sourceName
      );
      if (gyTargetId) {
        const location = findBoundCardZoneLocation(workingState, gyTargetId);
        if (location?.zone === 'graveyard') {
          const result = moveTargetedCardFromGraveyard(
            workingState,
            location.playerId,
            gyTargetId,
            { cardType: 'creature' },
            'exile'
          );
          if (result.kind === 'applied') {
            workingState = result.state;
            combinedLog.push(...(result.log || []));
          }
        }
      }
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Exiled battlefield/graveyard creatures: ${step.raw}`],
    });
  }

  if (parsedEachCreaturePowerOfChosenQuality && step.to === 'hand') {
    const chosenParity = String(ctx.selectorContext?.chosenOddEven || 'odd').trim().toLowerCase();
    if (chosenParity !== 'odd' && chosenParity !== 'even') {
      return {
        applied: false,
        message: `Skipped move zone (no deterministic parity choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    const readPower = (perm: any): number | null => {
      const power = Number(
        perm?.effectivePower ?? perm?.power ?? perm?.basePower ?? perm?.card?.power
      );
      return Number.isFinite(power) ? power : null;
    };
    const matches = ((nextState.battlefield || []) as any[]).filter((perm) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const power = readPower(perm);
      if (power === null) return false;
      const isEven = power % 2 === 0;
      return chosenParity === 'even' ? isEven : !isEven;
    });
    const result = moveBattlefieldPermanentsByIdToOwnersHands(
      nextState,
      matches.map((perm) => String((perm as any)?.id || '').trim()).filter(Boolean)
    );
    return finalizeAppliedResult(result);
  }

  if (parsedEachOpponentCreatureToughnessX && step.to === 'hand') {
    const islandCount = ((nextState.battlefield || []) as any[]).filter(perm => {
      if ((perm as any)?.controller !== controllerId) return false;
      const typeLine = String((perm as any)?.type_line || (perm as any)?.card?.type_line || '').toLowerCase();
      return typeLine.includes('land') && typeLine.includes('island');
    }).length;
    const toughnessCap = Math.max(0, islandCount || Number(ctx.referenceAmount ?? 3));
    const selector = parseSimpleBattlefieldSelector({
      kind: 'raw',
      text: 'each creature your opponents control',
    } as any);
    if (!selector) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const battlefield = [...((nextState.battlefield || []) as any[])];
    const matches = battlefield.filter(perm => {
      if (!permanentMatchesSelector(perm, selector, ctx)) return false;
      const toughness = Number((perm as any)?.toughness ?? (perm as any)?.card?.toughness);
      return Number.isFinite(toughness) && toughness <= toughnessCap;
    });
    const result = moveBattlefieldPermanentsByIdToOwnersHands(
      nextState,
      matches.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean)
    );
    return finalizeAppliedResult(result);
  }

  if (parsedTopLibraryFaceDownPerOpponent && step.to === 'exile') {
    const opponentCount = Math.max(1, Number(ctx.eachOfThoseOpponents?.length ?? 3));
    const result = exileCountFromTopOfLibrary(nextState, controllerId, opponentCount, true);
    return buildAppliedResult({ state: result.state, log: [...result.log] });
  }

  if (parsedAllNamedThisPermanent && step.to === 'battlefield') {
    const sourceName = normalizeReferenceText(ctx.sourceName);
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    const cardIds = graveyard
      .filter((card: any) => normalizeReferenceText(card?.name) === sourceName)
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean);
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of cardIds) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        controllerId,
        cardId,
        { cardType: 'any' },
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
      log: combinedLog.length > 0 ? combinedLog : [`Returned named cards: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedCreatureCardExiledWithSource && step.to === 'battlefield') {
    const sourceId = String(ctx.sourceId || '').trim();
    const matches = findCardsExiledWithSource(nextState, sourceId, {
      cardType: parsedCreatureCardExiledWithSource.cardType,
    });
    const preferred = getChosenObjectIds(ctx);
    const chosen =
      preferred.length > 0
        ? matches.find(match => preferred.includes(match.cardId)) || matches[0]
        : matches[0];
    if (!chosen) {
      return buildAppliedResult({ state: nextState, log: [`No creature exiled with source: ${step.raw}`] });
    }
    const result = moveTargetedCardFromExile(
      nextState,
      chosen.playerId,
      chosen.cardId,
      parsedCreatureCardExiledWithSource.cardType,
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
        message: `Skipped move zone (exiled creature unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedCreatureCardExiledThisWay && step.to === 'battlefield') {
    const exiledCards = [
      ...(Array.isArray(runtime?.lastExiledCards) ? runtime.lastExiledCards : []),
      ...(Array.isArray(ctx.lastExiledCards) ? ctx.lastExiledCards : []),
    ];
    const preferred = getChosenObjectIds(ctx);
    let chosenCardId = preferred.find(id => {
      const card = exiledCards.find((entry: any) => String(entry?.id || '').trim() === id);
      return card && cardMatchesType(card, 'creature');
    });
    if (!chosenCardId) {
      const firstCreature = exiledCards.find((card: any) => cardMatchesType(card, 'creature'));
      chosenCardId = String((firstCreature as any)?.id || '').trim();
    }
    if (!chosenCardId) {
      if (step.optional) {
        return buildAppliedResult({
          state: nextState,
          log: [`No creature card exiled this way: ${step.raw}`],
        });
      }
      return buildAppliedResult({
        state: nextState,
        log: [`No creature card exiled this way: ${step.raw}`],
      });
    }
    let ownerId = controllerId;
    for (const player of (nextState.players || []) as any[]) {
      const exile = Array.isArray(player?.exile) ? player.exile : [];
      if (exile.some((card: any) => String(card?.id || '').trim() === chosenCardId)) {
        ownerId = String(player?.id || controllerId).trim() as PlayerID;
        break;
      }
    }
    const result = moveTargetedCardFromExile(
      nextState,
      ownerId,
      chosenCardId,
      'creature',
      'battlefield',
      controllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      battlefieldEntryOverrides
    );
    if (result.kind === 'impossible') {
      if (step.optional) {
        return buildAppliedResult({
          state: nextState,
          log: [`Creature exiled this way unavailable: ${step.raw}`],
        });
      }
      return {
        applied: false,
        message: `Skipped move zone (exiled creature unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedAllFromLibrary && step.to === 'exile') {
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const library = Array.isArray(player?.library) ? [...player.library] : [];
    if (library.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No library cards to exile: ${step.raw}`] });
    }
    const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
    const movedCards = library.map((card: any) =>
      step.entersFaceDown ? { ...card, faceDown: true } : card
    );
    const updatedPlayers = nextState.players.map(p =>
      p.id === controllerId
        ? ({ ...(p as any), library: [], exile: [...exile, ...movedCards] } as any)
        : p
    );
    return buildAppliedResult({
      state: { ...(nextState as any), players: updatedPlayers as any } as any,
      log: [`${controllerId} exiles ${movedCards.length} card(s) from library`],
      movedCards,
    });
  }

  if (parsedUpToOneNonlandAmongThemRestLibraryBottom && step.to === 'exile') {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime);
    const nonlandIds = candidateIds.filter(cardId => {
      const location = findBoundCardZoneLocation(nextState, cardId);
      if (!location) return false;
      const player = nextState.players.find(p => p.id === location.playerId) as any;
      const zoneCards = Array.isArray(player?.[location.zone]) ? player[location.zone] : [];
      const card = zoneCards.find((entry: any) => String(entry?.id || '').trim() === cardId);
      return card && cardMatchesType(card, 'nonland');
    });
    const preferred = getChosenObjectIds(ctx).filter(id => nonlandIds.includes(id));
    const exiledId = preferred[0] || nonlandIds[0] || '';
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedCardIds: string[] = [];
    if (exiledId) {
      const location = findBoundCardZoneLocation(workingState, exiledId);
      if (location) {
        const result = moveContextualCardToDestination(workingState, location, exiledId, 'exile', {
          controllerId,
          cardType: 'nonland',
          ctx,
          stepKind: 'move_zone',
        });
        if (result.kind === 'applied') {
          workingState = result.state;
          combinedLog.push(...result.log);
          movedCardIds.push(exiledId);
        }
      }
    }
    const restIds = candidateIds.filter(id => id !== exiledId);
    for (const cardId of restIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const result = moveContextualCardToDestination(workingState, location, cardId, 'library_bottom', {
        controllerId,
        ctx,
        stepKind: 'move_zone',
      });
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...result.log);
    }
    return buildAppliedResult({
      state: workingState,
      log:
        combinedLog.length > 0
          ? combinedLog
          : [`Exiled up to one nonland among them and bottomed the rest: ${step.raw}`],
      ...(movedCardIds.length > 0 ? { lastMovedCards: movedCardIds.map(id => ({ id })) } : {}),
    });
  }

  if (parsedUpToTypedCardsFromAmongThem && step.to === 'hand') {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime);
    const preferred = getChosenObjectIds(ctx).filter(id => candidateIds.includes(id));
    const selectedIds = (preferred.length > 0 ? preferred : candidateIds).slice(
      0,
      parsedUpToTypedCardsFromAmongThem.maxCount
    );
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of selectedIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const result =
        location.zone === 'hand'
          ? { kind: 'applied' as const, state: workingState, log: [] as string[] }
          : location.zone === 'graveyard'
            ? moveTargetedCardFromGraveyard(
                workingState,
                location.playerId,
                cardId,
                { cardType: parsedUpToTypedCardsFromAmongThem.cardType },
                'hand'
              )
            : moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'hand');
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved contextual cards to hand: ${step.raw}`],
    });
  }

  if (parsedPutAllTypedAndFromAmongThem && step.to === 'hand') {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime);
    const preferred = getChosenObjectIds(ctx);
    const matchingIds = Array.from(
      new Set(
        candidateIds.filter(cardId => {
          const location = findBoundCardZoneLocation(nextState, cardId);
          if (!location) return false;
          let card: any = null;
          const player = nextState.players.find(p => p.id === location.playerId) as any;
          const zoneCards = Array.isArray(player?.[location.zone]) ? player[location.zone] : [];
          card = zoneCards.find((entry: any) => String(entry?.id || '').trim() === cardId);
          if (!card) return false;
          return parsedPutAllTypedAndFromAmongThem.criteriaAnyOf.some(criteria =>
            cardMatchesMoveZoneSingleTargetCriteria(card, criteria)
          );
        })
      )
    );
    const selectedIds =
      preferred.length > 0
        ? matchingIds.filter(id => preferred.includes(id)).length > 0
          ? matchingIds.filter(id => preferred.includes(id))
          : matchingIds
        : matchingIds;
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of selectedIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const result =
        location.zone === 'hand'
          ? { kind: 'applied' as const, state: workingState, log: [] as string[] }
          : location.zone === 'graveyard'
            ? moveTargetedCardFromGraveyard(workingState, location.playerId, cardId, { cardType: 'any' }, 'hand')
            : moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'hand');
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved typed among-them cards to hand: ${step.raw}`],
    });
  }

  if (parsedOneOnTopRestOnBottomLibrary && step.to === 'library') {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime);
    const preferred = getChosenObjectIds(ctx);
    const orderedIds =
      preferred.length > 0
        ? [...preferred.filter(id => candidateIds.includes(id)), ...candidateIds.filter(id => !preferred.includes(id))]
        : candidateIds;
    const topId = orderedIds[0];
    if (!topId) {
      return buildAppliedResult({ state: nextState, log: [`No among-them cards for library split: ${step.raw}`] });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of orderedIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const destination = cardId === topId ? 'library_top' : 'library_bottom';
      const result =
        location.zone === 'hand'
          ? moveTargetedCardFromHandToLibrary(
              workingState,
              location.playerId,
              cardId,
              destination === 'library_top' ? 'top' : 'bottom'
            )
          : location.zone === 'graveyard'
            ? moveTargetedCardFromGraveyard(workingState, location.playerId, cardId, { cardType: 'any' }, destination)
            : moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', destination);
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Split among-them cards between library top and bottom: ${step.raw}`],
    });
  }

  if (parsedCreatureExiledWithVehicle && step.to === 'battlefield') {
    const sourceId = String(ctx.sourceId || '').trim();
    const matches = findCardsExiledWithSource(nextState, sourceId, { cardType: 'creature' });
    const preferred = getChosenObjectIds(ctx);
    const chosen =
      preferred.length > 0
        ? matches.find(match => preferred.includes(match.cardId)) || matches[0]
        : matches[0];
    if (!chosen) {
      return buildAppliedResult({ state: nextState, log: [`No creature exiled with vehicle: ${step.raw}`] });
    }
    const result = moveTargetedCardFromExile(
      nextState,
      chosen.playerId,
      chosen.cardId,
      'creature',
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
        message: `Skipped move zone (exiled creature unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedAnyNumberCyclingPermanents && step.to === 'battlefield') {
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    const preferred = new Set(getChosenObjectIds(ctx));
    const cardIds = graveyard
      .filter((card: any) => {
        const cardId = String(card?.id || '').trim();
        if (!cardId) return false;
        if (preferred.size > 0 && !preferred.has(cardId)) return false;
        return cardHasCyclingAbility(card);
      })
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean);
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of cardIds) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        controllerId,
        cardId,
        { cardType: 'permanent' },
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
      log: combinedLog.length > 0 ? combinedLog : [`Returned cycling permanents: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }


  return undefined;
}
