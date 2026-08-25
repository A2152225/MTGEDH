// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: the applyMoveZoneStep selector guards starting at if (parsedUpToFromSingleGraveyard && step.to === 'exile') {
// Public entry symbol: tryApplyMoveZoneGuardsFromUpToFromSingleGraveyard.

import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';
import type { PlayerID } from '../../shared/src';
import { hasExecutorClass } from './oracleIRExecutorPermanentUtils';
import { finalizeBattlefieldRemoval, moveBattlefieldPermanentsByIdToOwnersHands } from './oracleIRExecutorBattlefieldOps';
import {
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromExile,
  cardHasAdventureCharacteristics,
  cardHasNonManaActivatedAbility,
  cardMatchesMoveZoneSingleTargetCriteria,
  type MoveZoneSingleTargetCriteria,
  resolveCardIdsFromAnyGraveyard,
  cardMatchesType,
} from './oracleIRExecutorZoneOps';
import {
  findBoundCardZoneLocation,
  getChosenObjectIds,
  getTargetPlayerId,
  resolveUniqueChosenGraveyardTargetId,
} from './oracleIRExecutorMoveZoneReferenceResolvers';
import { moveContextualCardToDestination, resolveContextualCardIdsInZones } from './oracleIRExecutorMoveZoneContextualCardResolvers';
import { buildAppliedResult } from './oracleIRExecutorMoveZoneStepResultBuilders';

export function tryApplyMoveZoneGuardsFromUpToFromSingleGraveyard(args: MoveZoneGuardArgs): MoveZoneStepHandlerResult | undefined {
  const { state, step, ctx, runtime, nextState, log, controllerId, effectiveWithCounters, battlefieldEntryOverrides, finalizeAppliedResult, attachmentResolution, sourcePermanentPower } = args;
  const {
    parsedUpToFromSingleGraveyard,
    parsedAllCardsMilledThisWay,
    parsedAllCardsDiscardedThisWay,
    parsedOpponentChoicePermanentToHand,
    parsedAllAdventureCardsFromMilledCards,
    parsedAllNonManaActivatedCreaturesFromMilledCards,
    parsedCardFromChosenPile,
    parsedAllCardsFromPileOfYourChoice,
    parsedOpponentChoiceFromTargetPlayerGy,
    parsedCompoundBattlefieldAndGraveyardMassReturn,
  } = args.referenceQueries;

  if (parsedUpToFromSingleGraveyard && step.to === 'exile') {
    const matches = resolveCardIdsFromAnyGraveyard(
      nextState,
      parsedUpToFromSingleGraveyard.cardType,
      getChosenObjectIds(ctx),
      parsedUpToFromSingleGraveyard.maxCount
    );
    if (matches.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No graveyard cards matched: ${step.raw}`],
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
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedCards: any[] = [];
    for (const match of matches) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        match.playerId,
        match.cardId,
        { cardType: parsedUpToFromSingleGraveyard.cardType },
        'exile'
      );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedCards.push(...(result.movedCards || []));
    }
    return finalizeAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Exiled cards from a single graveyard: ${step.raw}`],
      movedCards,
    });
  }

  if (parsedAllCardsMilledThisWay && step.to === 'hand') {
    const milledCards = Array.isArray(runtime?.lastMilledCards)
      ? runtime.lastMilledCards
      : Array.isArray(ctx.lastMilledCards)
        ? ctx.lastMilledCards
        : [];
    const preferredIds = getChosenObjectIds(ctx);
    const candidateIds = milledCards
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean)
      .filter(cardId => {
        const player = nextState.players.find(p => p.id === controllerId) as any;
        const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
        const card = graveyard.find((entry: any) => String(entry?.id || '').trim() === cardId);
        return (
          card &&
          cardMatchesMoveZoneSingleTargetCriteria(card, { cardType: parsedAllCardsMilledThisWay.cardType })
        );
      });
    if (parsedAllCardsMilledThisWay.anyNumber) {
      const idsToMove =
        preferredIds.length > 0
          ? preferredIds.filter(id => candidateIds.includes(id))
          : candidateIds;
      if (idsToMove.length === 0) {
        if (step.optional || parsedAllCardsMilledThisWay.anyNumber) {
          return buildAppliedResult({ state: nextState, log: [`Skipped optional milled-this-way hand: ${step.raw}`] });
        }
        return buildAppliedResult({ state: nextState, log: [`No milled-this-way card for hand: ${step.raw}`] });
      }
      let workingState = nextState;
      const combinedLog: string[] = [];
      for (const cardId of idsToMove) {
        const result = moveTargetedCardFromGraveyard(
          workingState,
          controllerId,
          cardId,
          { cardType: parsedAllCardsMilledThisWay.cardType },
          'hand'
        );
        if (result.kind !== 'applied') continue;
        workingState = result.state;
        combinedLog.push(...(result.log || []));
      }
      return buildAppliedResult({
        state: workingState,
        log: combinedLog.length > 0 ? combinedLog : [`Moved milled-this-way cards to hand: ${step.raw}`],
      });
    }
    const limitedCandidateIds =
      parsedAllCardsMilledThisWay.maxCount && parsedAllCardsMilledThisWay.maxCount > 0
        ? candidateIds.slice(0, parsedAllCardsMilledThisWay.maxCount)
        : candidateIds;
    const cardId =
      preferredIds.find(id => limitedCandidateIds.includes(id)) || limitedCandidateIds[0] || '';
    if (!cardId) {
      if (step.optional || parsedAllCardsMilledThisWay.maxCount) {
        return buildAppliedResult({ state: nextState, log: [`Skipped optional milled-this-way hand: ${step.raw}`] });
      }
      return buildAppliedResult({ state: nextState, log: [`No milled-this-way card for hand: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      cardId,
      { cardType: parsedAllCardsMilledThisWay.cardType },
      'hand'
    );
    return result.kind === 'impossible'
      ? buildAppliedResult({ state: nextState, log: [`No milled-this-way card for hand: ${step.raw}`] })
      : finalizeAppliedResult(result);
  }

  if (parsedCompoundBattlefieldAndGraveyardMassReturn && step.to === 'exile') {
    const criteria: import('./oracleIRExecutorZoneOps').MoveZoneSingleTargetCriteria = {
      cardType: parsedCompoundBattlefieldAndGraveyardMassReturn.cardType,
      ...(parsedCompoundBattlefieldAndGraveyardMassReturn.manaValueLte !== undefined
        ? { manaValueLte: parsedCompoundBattlefieldAndGraveyardMassReturn.manaValueLte }
        : {}),
    };
    let workingState = nextState;
    const combinedLog: string[] = [];
    const battlefield = [...((workingState.battlefield || []) as any[])];
    const toRemove = battlefield.filter(perm =>
      cardMatchesMoveZoneSingleTargetCriteria(perm as any, criteria)
    );
    if (toRemove.length > 0) {
      const removedIds = new Set(
        toRemove.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean)
      );
      const kept = battlefield.filter(
        perm => !removedIds.has(String((perm as any)?.id || '').trim())
      );
      const bfResult = finalizeBattlefieldRemoval(workingState, toRemove, removedIds, kept, 'exile', 'exiled');
      workingState = bfResult.state;
      combinedLog.push(...bfResult.log);
    }
    for (const player of (workingState.players || []) as any[]) {
      const playerId = String(player?.id || '').trim() as PlayerID;
      if (!playerId) continue;
      const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
      for (const card of graveyard) {
        const cardId = String((card as any)?.id || '').trim();
        if (!cardId || !cardMatchesMoveZoneSingleTargetCriteria(card, criteria)) continue;
        const result = moveTargetedCardFromGraveyard(workingState, playerId, cardId, criteria, 'exile');
        if (result.kind !== 'applied') continue;
        workingState = result.state;
        combinedLog.push(...(result.log || []));
      }
    }
    return buildAppliedResult({
      state: workingState,
      log:
        combinedLog.length > 0
          ? combinedLog
          : [`Exiled matching battlefield and graveyard cards: ${step.raw}`],
    });
  }

  if (parsedCompoundBattlefieldAndGraveyardMassReturn && step.to === 'hand') {
    const battlefieldCreatureIds = ((nextState.battlefield || []) as any[])
      .filter(perm => hasExecutorClass(perm as any, 'creature'))
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    let workingState = nextState;
    const combinedLog: string[] = [];
    if (battlefieldCreatureIds.length > 0) {
      const bfResult = moveBattlefieldPermanentsByIdToOwnersHands(workingState, battlefieldCreatureIds);
      workingState = bfResult.state;
      combinedLog.push(...(bfResult.log || []));
    }
    for (const player of workingState.players || []) {
      const playerId = String((player as any)?.id || '').trim() as PlayerID;
      if (!playerId) continue;
      const graveyard = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
      for (const card of graveyard) {
        const cardId = String((card as any)?.id || '').trim();
        if (!cardId || !cardMatchesType(card, 'creature')) continue;
        const result = moveTargetedCardFromGraveyard(
          workingState,
          playerId,
          cardId,
          { cardType: 'creature' },
          'hand'
        );
        if (result.kind !== 'applied') continue;
        workingState = result.state;
        combinedLog.push(...(result.log || []));
      }
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned battlefield and graveyard creatures: ${step.raw}`],
    });
  }

  if (parsedAllCardsFromPileOfYourChoice && step.to === 'battlefield') {
    const exiledCards = [
      ...(Array.isArray(runtime?.lastExiledCards) ? runtime.lastExiledCards : []),
      ...(Array.isArray(ctx.lastExiledCards) ? ctx.lastExiledCards : []),
      ...(Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []),
      ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
    ];
    const chosenIds = new Set(getChosenObjectIds(ctx).map(id => String(id || '').trim()).filter(Boolean));
    const seen = new Set<string>();
    const pileCards = exiledCards.filter((card: any) => {
      const cardId = String(card?.id || '').trim();
      if (!cardId || seen.has(cardId)) return false;
      if (chosenIds.size > 0 && !chosenIds.has(cardId)) return false;
      const location = findBoundCardZoneLocation(nextState, cardId);
      if (!location || location.zone !== 'exile') return false;
      seen.add(cardId);
      return true;
    });
    if (pileCards.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No cards from chosen pile: ${step.raw}`] });
    }
    const bfController = String(step.battlefieldController?.kind === 'you' ? controllerId : controllerId);
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const card of pileCards) {
      const cardId = String((card as any)?.id || '').trim();
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location || location.zone !== 'exile') continue;
      const result = moveTargetedCardFromExile(
        workingState,
        location.playerId,
        cardId,
        'any',
        'battlefield',
        bfController,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        undefined,
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
          : [`Put all cards from chosen pile onto the battlefield: ${step.raw}`],
      lastMovedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedCardFromChosenPile && step.to === 'hand') {
    const preferredIds = getChosenObjectIds(ctx);
    const cardId =
      preferredIds.find(id => Boolean(findBoundCardZoneLocation(nextState, id))) ||
      resolveContextualCardIdsInZones(nextState, ctx, runtime, ['library', 'exile', 'hand'])[0] ||
      '';
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No card from chosen pile: ${step.raw}`] });
    }
    const location = findBoundCardZoneLocation(nextState, cardId);
    if (!location) {
      return {
        applied: false,
        message: `Skipped move zone (chosen pile card unavailable): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const result =
      location.zone === 'library'
        ? moveContextualCardToDestination(nextState, location, cardId, 'hand', { controllerId, cardType: 'any' })
        : location.zone === 'exile'
          ? moveTargetedCardFromExile(nextState, location.playerId, cardId, 'any', 'hand')
          : location.zone === 'graveyard'
            ? moveTargetedCardFromGraveyard(nextState, location.playerId, cardId, { cardType: 'any' }, 'hand')
            : { kind: 'applied' as const, state: nextState, log: [] as string[] };
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (chosen pile card unavailable): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    return finalizeAppliedResult(result as any);
  }

  if (parsedOpponentChoiceFromTargetPlayerGy && step.to === 'hand') {
    const graveyardOwnerId =
      parsedOpponentChoiceFromTargetPlayerGy.fromHandOrGraveyardOwner === 'controller'
        ? controllerId
        : getTargetPlayerId(ctx) || controllerId;
    const targetObjectId =
      resolveUniqueChosenGraveyardTargetId(
        nextState,
        graveyardOwnerId,
        parsedOpponentChoiceFromTargetPlayerGy,
        ctx,
        runtime,
        ctx.sourceName,
        sourcePermanentPower
      ) ||
      getChosenObjectIds(ctx).find(id => {
        const player = nextState.players.find(p => p.id === graveyardOwnerId) as any;
        const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
        const card = graveyard.find((entry: any) => String(entry?.id || '').trim() === id);
        return (
          card &&
          cardMatchesMoveZoneSingleTargetCriteria(
            card,
            parsedOpponentChoiceFromTargetPlayerGy,
            ctx.sourceName,
            undefined,
            sourcePermanentPower
          )
        );
      }) ||
      '';
    if (!targetObjectId) {
      return buildAppliedResult({ state: nextState, log: [`No opponent-choice graveyard card: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      graveyardOwnerId,
      targetObjectId,
      parsedOpponentChoiceFromTargetPlayerGy,
      'hand'
    );
    return result.kind === 'impossible'
      ? buildAppliedResult({ state: nextState, log: [`No opponent-choice graveyard card: ${step.raw}`] })
      : finalizeAppliedResult(result);
  }

  if (parsedOpponentChoiceFromTargetPlayerGy && step.to === 'battlefield') {
    const graveyardOwnerId =
      parsedOpponentChoiceFromTargetPlayerGy.fromHandOrGraveyardOwner === 'controller'
        ? controllerId
        : getTargetPlayerId(ctx);
    if (!graveyardOwnerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const targetObjectId =
      resolveUniqueChosenGraveyardTargetId(
        nextState,
        graveyardOwnerId,
        parsedOpponentChoiceFromTargetPlayerGy,
        ctx,
        runtime,
        ctx.sourceName,
        sourcePermanentPower
      ) || getChosenObjectIds(ctx).find(id => {
        const player = nextState.players.find(p => p.id === graveyardOwnerId) as any;
        const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
        return graveyard.some((card: any) => String(card?.id || '').trim() === id);
      });
    if (!targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      graveyardOwnerId,
      targetObjectId,
      parsedOpponentChoiceFromTargetPlayerGy,
      'battlefield',
      step.battlefieldController?.kind === 'owner_of_moved_cards' ? graveyardOwnerId : controllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      undefined,
      battlefieldEntryOverrides,
      sourcePermanentPower
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedAllNonManaActivatedCreaturesFromMilledCards && step.to === 'hand') {
    const milledCards = Array.isArray(runtime?.lastMilledCards)
      ? runtime.lastMilledCards
      : Array.isArray(ctx.lastMilledCards)
        ? ctx.lastMilledCards
        : [];
    const preferredIds = getChosenObjectIds(ctx);
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const milledCard of milledCards) {
      if (!cardMatchesType(milledCard, 'creature') || !cardHasNonManaActivatedAbility(milledCard)) continue;
      const cardId = String((milledCard as any)?.id || '').trim();
      if (!cardId) continue;
      if (preferredIds.length > 0 && !preferredIds.includes(cardId)) continue;
      const player = workingState.players.find(p => p.id === controllerId) as any;
      const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
      if (!graveyard.some((entry: any) => String(entry?.id || '').trim() === cardId)) continue;
      const result = moveTargetedCardFromGraveyard(workingState, controllerId, cardId, { cardType: 'creature' }, 'hand');
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved non-mana activated creatures from milled cards: ${step.raw}`],
    });
  }

  if (parsedAllAdventureCardsFromMilledCards && step.to === 'hand') {
    const milledCards = Array.isArray(runtime?.lastMilledCards)
      ? runtime.lastMilledCards
      : Array.isArray(ctx.lastMilledCards)
        ? ctx.lastMilledCards
        : [];
    const preferredIds = getChosenObjectIds(ctx);
    let workingState = nextState;
    const combinedLog: string[] = [];
    let movedCount = 0;
    for (const milledCard of milledCards) {
      if (!cardHasAdventureCharacteristics(milledCard)) continue;
      const cardId = String((milledCard as any)?.id || '').trim();
      if (!cardId) continue;
      if (preferredIds.length > 0 && !preferredIds.includes(cardId)) continue;
      const player = workingState.players.find(p => p.id === controllerId) as any;
      const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
      if (!graveyard.some((entry: any) => String(entry?.id || '').trim() === cardId)) continue;
      const result = moveTargetedCardFromGraveyard(workingState, controllerId, cardId, { cardType: 'any' }, 'hand');
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedCount += 1;
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved adventure cards from milled cards: ${step.raw}`],
    });
  }

  if (parsedAllCardsMilledThisWay && step.to === 'battlefield') {
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, ['graveyard']).filter(cardId => {
      const player = nextState.players.find(p => p.id === controllerId) as any;
      const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
      const card = graveyard.find((entry: any) => String(entry?.id || '').trim() === cardId);
      return card && cardMatchesMoveZoneSingleTargetCriteria(card, { cardType: parsedAllCardsMilledThisWay.cardType });
    });
    if (candidateIds.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No milled-this-way cards: ${step.raw}`] });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    const limitedCandidateIds =
      parsedAllCardsMilledThisWay.maxCount && parsedAllCardsMilledThisWay.maxCount > 0
        ? candidateIds.slice(0, parsedAllCardsMilledThisWay.maxCount)
        : candidateIds;
    for (const cardId of limitedCandidateIds) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        controllerId,
        cardId,
        { cardType: parsedAllCardsMilledThisWay.cardType },
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
      log: combinedLog.length > 0 ? combinedLog : [`Moved milled-this-way cards: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedAllCardsDiscardedThisWay && step.to === 'battlefield') {
    const discardedCards = Array.isArray(runtime?.lastDiscardedCards)
      ? runtime.lastDiscardedCards
      : Array.isArray(ctx.lastDiscardedCards)
        ? ctx.lastDiscardedCards
        : [];
    const preferredIds = getChosenObjectIds(ctx);
    const candidateEntries: Array<{ playerId: PlayerID; cardId: string }> = [];
    for (const discardedCard of discardedCards) {
      const cardId = String((discardedCard as any)?.id || '').trim();
      if (!cardId) continue;
      for (const player of nextState.players || []) {
        const playerId = String((player as any)?.id || '').trim() as PlayerID;
        if (!playerId) continue;
        const graveyard = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
        const card = graveyard.find((entry: any) => String(entry?.id || '').trim() === cardId);
        if (
          card &&
          cardMatchesMoveZoneSingleTargetCriteria(card, { cardType: parsedAllCardsDiscardedThisWay.cardType })
        ) {
          candidateEntries.push({ playerId, cardId });
          break;
        }
      }
    }
    const limitedEntries =
      parsedAllCardsDiscardedThisWay.maxCount && parsedAllCardsDiscardedThisWay.maxCount > 0
        ? candidateEntries.slice(0, parsedAllCardsDiscardedThisWay.maxCount)
        : candidateEntries;
    const chosenEntry =
      limitedEntries.find(entry => preferredIds.includes(entry.cardId)) || limitedEntries[0] || null;
    if (!chosenEntry) {
      if (step.optional || parsedAllCardsDiscardedThisWay.maxCount) {
        return buildAppliedResult({ state: nextState, log: [`Skipped optional discarded-this-way: ${step.raw}`] });
      }
      return buildAppliedResult({ state: nextState, log: [`No discarded-this-way card for battlefield: ${step.raw}`] });
    }
    const battlefieldControllerId =
      step.battlefieldController?.kind === 'you'
        ? controllerId
        : step.battlefieldController?.kind === 'target_player' ||
            step.battlefieldController?.kind === 'target_opponent'
          ? getTargetPlayerId(ctx) || controllerId
          : controllerId;
    const result = moveTargetedCardFromGraveyard(
      nextState,
      chosenEntry.playerId,
      chosenEntry.cardId,
      { cardType: parsedAllCardsDiscardedThisWay.cardType },
      'battlefield',
      battlefieldControllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      undefined,
      undefined,
      battlefieldEntryOverrides
    );
    return result.kind === 'impossible'
      ? buildAppliedResult({ state: nextState, log: [`No discarded-this-way card for battlefield: ${step.raw}`] })
      : finalizeAppliedResult(result);
  }

  if (parsedOpponentChoicePermanentToHand && step.to === 'hand') {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const preferred = getChosenObjectIds(ctx);
    const battlefield = ((nextState.battlefield || []) as any[]).filter(
      perm => String(perm?.controller || '').trim() === targetPlayerId
    );
    let targetIds = battlefield
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    if (preferred.length > 0) {
      const preferredMatches = targetIds.filter(id => preferred.includes(id));
      if (preferredMatches.length > 0) {
        targetIds = preferredMatches;
      }
    }
    if (targetIds.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No opponent permanent to return: ${step.raw}`] });
    }
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, [targetIds[0]]);
    return finalizeAppliedResult(result);
  }


  return undefined;
}
