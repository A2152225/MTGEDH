// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: the applyMoveZoneStep selector guards starting at if (parsedCommandZonePermanent && step.to === 'battlefield') {
// Public entry symbol: tryApplyMoveZoneGuardsFromCommandZonePermanent.

import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';
import type { GameState } from '../../shared/src';
import { hasExecutorClass, getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { moveBattlefieldPermanentsByIdToOwnersHands } from './oracleIRExecutorBattlefieldOps';
import {
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
  moveTargetedCardFromExile,
  resolveFirstMatchingCardIdFromPlayerGraveyard,
  cardMatchesMoveZoneSingleTargetCriteria,
  selectGraveyardCardsWithTotalManaValueLte,
  createBattlefieldPermanentsFromCards,
  addBattlefieldPermanentsToState,
} from './oracleIRExecutorZoneOps';
import { findBoundCardZoneLocation, getChosenObjectIds } from './oracleIRExecutorMoveZoneReferenceResolvers';
import {
  moveContextualCardToDestination,
  resolveAmongThemCriteriaWithX,
  resolveContextualCardIdsInZones,
  resolveMoveZoneSingleTargetCriteriaWithX,
  resolveOneOfThemCandidateCardIds,
} from './oracleIRExecutorMoveZoneContextualCardResolvers';
import { buildAppliedResult } from './oracleIRExecutorMoveZoneStepResultBuilders';

export function tryApplyMoveZoneGuardsFromCommandZonePermanent(args: MoveZoneGuardArgs): MoveZoneStepHandlerResult | undefined {
  const { state, step, ctx, runtime, nextState, log, controllerId, effectiveWithCounters, battlefieldEntryOverrides, finalizeAppliedResult } = args;
  const {
    parsedAnyNumberArtifactCreatureTotalMv,
    parsedCommandZonePermanent,
    parsedMyraExileInstantSorcery,
    parsedSharesTypeFromAmongThem,
    parsedSingleCardRevealedThisWay,
    parsedContextualThemSplit,
    parsedAnyNumberThosePermanentCards,
    parsedThemAntecedent,
    parsedReturnContextualThemToBattlefield,
    parsedUpToCreaturesExcludingTypeLineTerm,
    parsedSingleRevealedRestToGy,
  } = args.zoneQueries;

  if (parsedCommandZonePermanent && step.to === 'battlefield') {
    const controllerPlayer = nextState.players.find(p => p.id === controllerId) as any;
    const commandZone = Array.isArray(controllerPlayer?.commandZone)
      ? controllerPlayer.commandZone
      : Array.isArray(controllerPlayer?.command)
        ? controllerPlayer.command
        : [];
    const sourceId = String(ctx.sourceId || '').trim();
    const preferred = getChosenObjectIds(ctx);
    let card = commandZone.find((entry: any) => {
      const cardId = String(entry?.id || '').trim();
      if (String((step.what as any)?.text || '').trim().toLowerCase() === 'this permanent') {
        return cardId === sourceId || cardId === 'cmd-source-self' || cardId.startsWith('cmd-source');
      }
      return /commander/i.test(String(entry?.type_line || entry?.card?.type_line || ''));
    });
    if (!card && preferred.length > 0) {
      card = commandZone.find((entry: any) => preferred.includes(String(entry?.id || '').trim()));
    }
    if (!card) {
      return buildAppliedResult({ state: nextState, log: [`No command zone card: ${step.raw}`] });
    }
    const cardId = String((card as any)?.id || '').trim();
    const kept = commandZone.filter((entry: any) => String(entry?.id || '').trim() !== cardId);
    const newPermanents = createBattlefieldPermanentsFromCards(
      [card],
      controllerId,
      controllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      'command'
    );
    const updatedPlayers = nextState.players.map(p =>
      p.id === controllerId
        ? ({
            ...(p as any),
            commandZone: kept,
            command: kept,
          } as any)
        : p
    );
    return buildAppliedResult({
      state: addBattlefieldPermanentsToState(
        { ...nextState, players: updatedPlayers as any } as GameState,
        newPermanents
      ),
      log: [`${controllerId} puts ${cardId} from command zone onto the battlefield`],
      movedBattlefieldPermanentIds: newPermanents.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean),
    });
  }

  if (parsedMyraExileInstantSorcery && step.to === 'exile') {
    const effectiveCriteria = resolveMoveZoneSingleTargetCriteriaWithX(parsedMyraExileInstantSorcery, ctx);
    const cardId = resolveFirstMatchingCardIdFromPlayerGraveyard(
      nextState,
      controllerId,
      [effectiveCriteria],
      getChosenObjectIds(ctx)
    );
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No Myra graveyard match: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      cardId,
      effectiveCriteria,
      'exile'
    );
    return result.kind === 'impossible'
      ? buildAppliedResult({ state: nextState, log: [`Myra exile unavailable: ${step.raw}`] })
      : finalizeAppliedResult(result);
  }

  if (parsedSharesTypeFromAmongThem && (step.to === 'hand' || step.to === 'battlefield')) {
    const preferred = getChosenObjectIds(ctx);
    const contextualIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, [
      'library',
      'hand',
      'exile',
      'graveyard',
    ]);
    const cardId =
      preferred.find(id => contextualIds.includes(id)) ||
      contextualIds[0] ||
      '';
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No shared-type among-them card: ${step.raw}`] });
    }
    const location = findBoundCardZoneLocation(nextState, cardId);
    if (!location) {
      return buildAppliedResult({ state: nextState, log: [`Shared-type card unavailable: ${step.raw}`] });
    }
    const result =
      location.zone === 'hand' && step.to === 'hand'
        ? { kind: 'applied' as const, state: nextState, log: [] as string[] }
        : location.zone === 'hand'
        ? moveTargetedCardFromHand(nextState, location.playerId, cardId, 'any', 'battlefield', controllerId, step.entersTapped, step.entersFaceDown, effectiveWithCounters, undefined, battlefieldEntryOverrides)
        : location.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(nextState, location.playerId, cardId, { cardType: 'any' }, step.to === 'battlefield' ? 'battlefield' : 'hand', step.to === 'battlefield' ? controllerId : undefined, step.entersTapped, step.entersFaceDown, effectiveWithCounters, undefined, undefined, battlefieldEntryOverrides)
          : location.zone === 'library'
            ? (() => {
                const player = nextState.players.find(p => p.id === location.playerId) as any;
                const library = Array.isArray(player?.library) ? [...player.library] : [];
                const index = library.findIndex((card: any) => String(card?.id || '').trim() === cardId);
                if (index < 0) return { kind: 'impossible' as const };
                const [card] = library.splice(index, 1);
                if (step.to === 'battlefield') {
                  const hand = Array.isArray(player?.hand) ? [...player.hand, card] : [card];
                  const updatedPlayers = nextState.players.map(p =>
                    p.id === location.playerId ? ({ ...(p as any), library, hand } as any) : p
                  );
                  const handResult = moveTargetedCardFromHand(
                    { ...nextState, players: updatedPlayers as any } as GameState,
                    location.playerId,
                    cardId,
                    'any',
                    'battlefield',
                    controllerId,
                    step.entersTapped,
                    step.entersFaceDown,
                    effectiveWithCounters,
                    undefined,
                    battlefieldEntryOverrides
                  );
                  return handResult;
                }
                const hand = Array.isArray(player?.hand) ? [...player.hand, card] : [card];
                const updatedPlayers = nextState.players.map(p =>
                  p.id === location.playerId ? ({ ...(p as any), library, hand } as any) : p
                );
                return {
                  kind: 'applied' as const,
                  state: { ...nextState, players: updatedPlayers as any } as GameState,
                  log: [`${location.playerId} puts ${cardId} from library into hand`],
                };
              })()
            : moveTargetedCardFromExile(nextState, location.playerId, cardId, 'any', step.to === 'battlefield' ? 'battlefield' : 'hand', step.to === 'battlefield' ? controllerId : undefined, step.entersTapped, step.entersFaceDown, effectiveWithCounters, undefined, battlefieldEntryOverrides);
    return result.kind === 'impossible'
      ? buildAppliedResult({ state: nextState, log: [`Shared-type card unavailable: ${step.raw}`] })
      : finalizeAppliedResult(result);
  }

  if (parsedUpToCreaturesExcludingTypeLineTerm && step.to === 'hand') {
    const excludeTerm = parsedUpToCreaturesExcludingTypeLineTerm.excludeTypeLineTerm;
    const battlefield = ((nextState.battlefield || []) as any[]).filter(perm => {
      if (!hasExecutorClass(perm as any, 'creature')) return false;
      const typeLine = getExecutorTypeLineLower(perm);
      if (excludeTerm === 'black') {
        const colors = Array.isArray((perm as any)?.colors || (perm as any)?.card?.colors)
          ? ((perm as any)?.colors || (perm as any)?.card?.colors)
          : [];
        return !typeLine.includes('black') && !colors.map(String).includes('B');
      }
      return !typeLine.includes(excludeTerm);
    });
    const preferred = getChosenObjectIds(ctx);
    let targetIds = battlefield.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean);
    if (preferred.length > 0) {
      targetIds = targetIds.filter(id => preferred.includes(id));
      if (targetIds.length === 0) {
        targetIds = battlefield.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean);
      }
    }
    const result = moveBattlefieldPermanentsByIdToOwnersHands(
      nextState,
      targetIds.slice(0, parsedUpToCreaturesExcludingTypeLineTerm.count)
    );
    return finalizeAppliedResult(result);
  }

  if (parsedReturnContextualThemToBattlefield && step.to === 'battlefield') {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime);
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of candidateIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const ownerId = location.playerId;
      const result =
        location.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(
              workingState,
              location.playerId,
              cardId,
              { cardType: 'any' },
              'battlefield',
              ownerId,
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
                ownerId,
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
                ownerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
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
      log: combinedLog.length > 0 ? combinedLog : [`Returned contextual cards: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedThemAntecedent && step.to === 'battlefield') {
    const milledIds = Array.isArray(ctx.lastMilledCards)
      ? ctx.lastMilledCards.map((card: any) => String(card?.id || '').trim()).filter(Boolean)
      : [];
    const runtimeIds = Array.isArray(runtime?.lastMovedCards)
      ? runtime.lastMovedCards.map((card: any) => String(card?.id || '').trim()).filter(Boolean)
      : [];
    const candidateIds = Array.from(new Set([...milledIds, ...runtimeIds, ...getChosenObjectIds(ctx)]));
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of candidateIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location || location.zone !== 'graveyard') continue;
      const result = moveTargetedCardFromGraveyard(
        workingState,
        location.playerId,
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
      log: combinedLog.length > 0 ? combinedLog : [`Moved antecedent cards: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedAnyNumberThosePermanentCards && step.to === 'battlefield') {
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, ['exile', 'hand', 'graveyard']);
    const preferred = new Set(getChosenObjectIds(ctx));
    const cardIds =
      preferred.size > 0 ? candidateIds.filter(id => preferred.has(id)) : candidateIds;
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of cardIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const result =
        location.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(
              workingState,
              location.playerId,
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
            )
          : location.zone === 'hand'
            ? moveTargetedCardFromHand(
                workingState,
                location.playerId,
                cardId,
                'permanent',
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
                'permanent',
                'battlefield',
                controllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
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
      log: combinedLog.length > 0 ? combinedLog : [`Moved those permanent cards: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedContextualThemSplit) {
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, [
      'library',
      'graveyard',
      'hand',
      'exile',
    ]);
    if (candidateIds.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No contextual cards for them split: ${step.raw}`] });
    }
    const preferred = getChosenObjectIds(ctx).filter(id => candidateIds.includes(id));
    const orderedIds = preferred.length > 0 ? [...preferred, ...candidateIds.filter(id => !preferred.includes(id))] : candidateIds;
    let handIds: string[];
    let restIds: string[];
    if (parsedContextualThemSplit.kind === 'count_library_top_graveyard_rest') {
      const topCount = parsedContextualThemSplit.count;
      const topIds =
        preferred.length > 0
          ? preferred.slice(0, topCount)
          : orderedIds.slice(0, Math.min(topCount, orderedIds.length));
      const restIds = orderedIds.filter(id => !topIds.includes(id));
      let workingState = nextState;
      const combinedLog: string[] = [];
      for (const topId of topIds) {
        const topLocation = findBoundCardZoneLocation(workingState, topId);
        if (!topLocation) continue;
        const topResult = moveContextualCardToDestination(workingState, topLocation, topId, 'library_top', {
          controllerId,
        });
        if (topResult.kind !== 'applied') continue;
        workingState = topResult.state;
        combinedLog.push(...topResult.log);
      }
      for (const restId of restIds) {
        const restLocation = findBoundCardZoneLocation(workingState, restId);
        if (!restLocation) continue;
        const restResult = moveContextualCardToDestination(workingState, restLocation, restId, 'graveyard', {
          controllerId,
        });
        if (restResult.kind !== 'applied') continue;
        workingState = restResult.state;
        combinedLog.push(...restResult.log);
      }
      return buildAppliedResult({
        state: workingState,
        log:
          combinedLog.length > 0
            ? combinedLog
            : [`Split contextual them to library top and graveyard: ${step.raw}`],
      });
    }
    if (parsedContextualThemSplit.kind === 'any_number_graveyard_library_top') {
      const gyIds = preferred.length > 0 ? preferred : orderedIds.slice(0, Math.min(2, orderedIds.length));
      restIds = orderedIds.filter(id => !gyIds.includes(id));
      let workingState = nextState;
      const combinedLog: string[] = [];
      for (const gyId of gyIds) {
        const gyLocation = findBoundCardZoneLocation(workingState, gyId);
        if (!gyLocation) continue;
        const gyResult = moveContextualCardToDestination(workingState, gyLocation, gyId, 'graveyard', {
          controllerId,
        });
        if (gyResult.kind !== 'applied') continue;
        workingState = gyResult.state;
        combinedLog.push(...gyResult.log);
      }
      for (const restId of restIds) {
        const restLocation = findBoundCardZoneLocation(workingState, restId);
        if (!restLocation) continue;
        const restResult = moveContextualCardToDestination(workingState, restLocation, restId, 'library_top', {
          controllerId,
        });
        if (restResult.kind !== 'applied') continue;
        workingState = restResult.state;
        combinedLog.push(...restResult.log);
      }
      return buildAppliedResult({
        state: workingState,
        log: combinedLog.length > 0 ? combinedLog : [`Split contextual surveil them: ${step.raw}`],
      });
    }
    if (parsedContextualThemSplit.kind === 'any_number_hand_graveyard_rest') {
      handIds = preferred.length > 0 ? preferred : orderedIds.slice(0, Math.min(2, orderedIds.length));
      restIds = orderedIds.filter(id => !handIds.includes(id));
    } else if (parsedContextualThemSplit.kind === 'count_hand_only') {
      handIds = orderedIds.slice(0, parsedContextualThemSplit.count);
      restIds = [];
    } else {
      const handCount =
        parsedContextualThemSplit.kind === 'count_hand_graveyard_rest' ||
        parsedContextualThemSplit.kind === 'count_hand_library_bottom'
          ? parsedContextualThemSplit.count
          : 1;
      handIds = orderedIds.slice(0, handCount);
      restIds = orderedIds.slice(handCount);
    }
    const restDestination =
      parsedContextualThemSplit.kind === 'count_hand_library_bottom' ? 'library_bottom' : 'graveyard';

    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const handId of handIds) {
      const handLocation = findBoundCardZoneLocation(workingState, handId);
      if (!handLocation) continue;
      if (handLocation.zone === 'hand') continue;
      const handResult = moveContextualCardToDestination(workingState, handLocation, handId, 'hand', {
        controllerId,
      });
      if (handResult.kind !== 'applied') continue;
      workingState = handResult.state;
      combinedLog.push(...handResult.log);
    }
    for (const restId of restIds) {
      const restLocation = findBoundCardZoneLocation(workingState, restId);
      if (!restLocation) continue;
      const restResult = moveContextualCardToDestination(workingState, restLocation, restId, restDestination, {
        controllerId,
      });
      if (restResult.kind !== 'applied') continue;
      workingState = restResult.state;
      combinedLog.push(...restResult.log);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Split contextual them: ${step.raw}`],
    });
  }

  if (parsedSingleRevealedRestToGy && parsedSingleCardRevealedThisWay) {
    const effectiveCriteria = resolveAmongThemCriteriaWithX(parsedSingleCardRevealedThisWay, ctx);
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, ['exile', 'hand', 'graveyard']);
    const matchingIds = candidateIds.filter(cardId => {
      const location = findBoundCardZoneLocation(nextState, cardId);
      if (!location) return false;
      const player = nextState.players.find(p => p.id === location.playerId) as any;
      const zoneCards = Array.isArray(player?.[location.zone]) ? player[location.zone] : [];
      const card = zoneCards.find((entry: any) => String(entry?.id || '').trim() === cardId);
      return card && cardMatchesMoveZoneSingleTargetCriteria(card, effectiveCriteria);
    });
    const preferred = getChosenObjectIds(ctx);
    const handId = preferred.find(id => matchingIds.includes(id)) || matchingIds[0] || '';
    let workingState = nextState;
    const combinedLog: string[] = [];
    if (handId) {
      const location = findBoundCardZoneLocation(workingState, handId);
      if (location) {
        const handResult =
          location.zone === 'graveyard'
            ? moveTargetedCardFromGraveyard(workingState, location.playerId, handId, effectiveCriteria, 'hand')
            : location.zone === 'hand'
              ? { kind: 'applied' as const, state: workingState, log: [] }
              : moveTargetedCardFromExile(workingState, location.playerId, handId, effectiveCriteria.cardType, 'hand');
        if (handResult.kind === 'applied') {
          workingState = handResult.state;
          combinedLog.push(...(handResult.log || []));
        }
      }
    }
    for (const restId of candidateIds.filter(id => id !== handId)) {
      const restLocation = findBoundCardZoneLocation(workingState, restId);
      if (!restLocation) continue;
      const restResult =
        restLocation.zone === 'graveyard'
          ? { kind: 'applied' as const, state: workingState, log: [] }
          : restLocation.zone === 'hand'
            ? moveTargetedCardFromHand(workingState, restLocation.playerId, restId, 'any', 'graveyard')
            : moveTargetedCardFromExile(workingState, restLocation.playerId, restId, 'any', 'graveyard');
      if (restResult.kind !== 'applied') continue;
      workingState = restResult.state;
      combinedLog.push(...(restResult.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Split revealed-this-way card: ${step.raw}`],
    });
  }

  if (parsedAnyNumberArtifactCreatureTotalMv && step.to === 'battlefield') {
    const cardIds = selectGraveyardCardsWithTotalManaValueLte(
      nextState,
      controllerId,
      'creature',
      parsedAnyNumberArtifactCreatureTotalMv.totalManaValueLte,
      getChosenObjectIds(ctx)
    ).filter(cardId => {
      const player = nextState.players.find(p => p.id === controllerId) as any;
      const card = (Array.isArray(player?.graveyard) ? player.graveyard : []).find(
        (entry: any) => String(entry?.id || '').trim() === cardId
      );
      const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
      return typeLine.includes('artifact') && typeLine.includes('creature');
    });
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
      log: combinedLog.length > 0 ? combinedLog : [`Returned artifact creatures: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }


  return undefined;
}
