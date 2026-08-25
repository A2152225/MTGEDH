// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: the applyMoveZoneStep selector guards starting at if (parsedTheRestToGraveyard) {
// Public entry symbol: tryApplyMoveZoneGuardsFromTheRestToGraveyard.

import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';
import type { GameState } from '../../shared/src';
import {
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
  moveTargetedCardFromExile,
  resolveFirstMatchingCardIdFromPlayerGraveyard,
  resolveCardIdsFromAnyGraveyard,
  moveTargetedCardFromHandToLibrary,
} from './oracleIRExecutorZoneOps';
import { findBoundCardZoneLocation, getChosenObjectIds } from './oracleIRExecutorMoveZoneReferenceResolvers';
import { moveContextualCardToDestination, resolveContextualCardIdsInZones } from './oracleIRExecutorMoveZoneContextualCardResolvers';
import { buildAppliedResult } from './oracleIRExecutorMoveZoneStepResultBuilders';

export function tryApplyMoveZoneGuardsFromTheRestToGraveyard(args: MoveZoneGuardArgs): MoveZoneStepHandlerResult | undefined {
  const { state, step, ctx, runtime, nextState, log, controllerId, effectiveWithCounters, battlefieldEntryOverrides, finalizeAppliedResult, attachmentResolution } = args;
  const {
    parsedSameNamedFromYourGraveyard,
    parsedExileXTargetCreatureCardsFromGraveyards,
    parsedOneTwoOrThreeTargetCreatureCardsFromGraveyards,
  } = args.zoneQueries;
  const {
    parsedAnotherCardFromGraveyard,
    parsedOrTypedCardsFromGraveyard,
    parsedUpToFromGraveyards,
    parsedTheRestToGraveyard,
    parsedTheRestToLibrary,
    parsedTheRestToHand,
    parsedTheRestToBattlefield,
    parsedTheOtherToHand,
    parsedTheOtherToLibrary,
    parsedTheOtherToBattlefield,
    parsedThatCardReference,
    parsedThatCardToBattlefield,
    parsedLastChosenCard,
  } = args.referenceQueries;

  if (parsedTheRestToGraveyard) {
    const preferred = new Set(getChosenObjectIds(ctx).map(id => String(id || '').trim()).filter(Boolean));
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, [
      'library',
      'hand',
      'exile',
    ]).filter(cardId => !preferred.has(cardId));
    if (candidateIds.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No contextual cards matched the rest: ${step.raw}`],
      });
    }

    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of candidateIds) {
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
            : moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'graveyard');
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }

    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved the rest to graveyard: ${step.raw}`],
    });
  }

  if (parsedTheRestToBattlefield) {
    const contextualExiled = Array.isArray(ctx.lastExiledCards) ? [...ctx.lastExiledCards] : [];
    const preferred = new Set(getChosenObjectIds(ctx).map(id => String(id || '').trim()).filter(Boolean));
    const cardIds = contextualExiled
      .map((card: any) => String(card?.id || '').trim())
      .filter(id => id && !preferred.has(id));
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of cardIds) {
      const result = moveTargetedCardFromExile(workingState, controllerId, cardId, 'any', 'battlefield', controllerId);
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      const bfId = String((result as any).movedPermanentId || '').trim();
      if (bfId) movedBattlefieldIds.push(bfId);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved the rest to battlefield: ${step.raw}`],
      lastMovedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedTheRestToHand) {
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, [
      'library',
      'exile',
    ]);
    if (candidateIds.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No contextual cards matched the rest: ${step.raw}`],
      });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of candidateIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location || location.zone === 'hand') continue;
      const result =
        location.zone === 'library'
          ? moveContextualCardToDestination(workingState, location, cardId, 'hand', {
              controllerId,
              cardType: 'any',
            })
          : moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'hand');
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved the rest to hand: ${step.raw}`],
    });
  }

  if (parsedThatCardToBattlefield) {
    const preferredIds = getChosenObjectIds(ctx);
    const contextual = Array.isArray(runtime?.lastMovedCards) ? [...runtime.lastMovedCards] : [];
    const contextualIds = contextual
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean);
    const cardId =
      preferredIds.find(id => contextualIds.includes(id) || Boolean(findBoundCardZoneLocation(nextState, id))) ||
      contextualIds[0] ||
      preferredIds[0] ||
      String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim();
    const location = cardId ? findBoundCardZoneLocation(nextState, cardId) : null;
    if (!location) {
      return {
        applied: false,
        message: `Skipped move zone (that card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    // "under its owner's control" hands the permanent to the owner of the zone it came from, not to
    // the controller of the ability that returned it.
    const bfController = String(
      step.battlefieldController?.kind === 'owner_of_moved_cards' ? location.playerId : controllerId
    );
    const result =
      location.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(
            nextState,
            location.playerId,
            cardId,
            { cardType: 'any' },
            'battlefield',
            bfController,
            step.entersTapped,
            step.entersFaceDown,
            effectiveWithCounters,
            attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
            ctx.sourceName,
            battlefieldEntryOverrides
          )
        : location.zone === 'exile'
          ? moveTargetedCardFromExile(
              nextState,
              location.playerId,
              cardId,
              'any',
              'battlefield',
              bfController,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
              battlefieldEntryOverrides
            )
          : location.zone === 'library'
            ? moveContextualCardToDestination(nextState, location, cardId, 'battlefield', {
                controllerId: bfController,
                cardType: 'any',
                entersTapped: step.entersTapped,
                entersFaceDown: step.entersFaceDown,
                withCounters: effectiveWithCounters,
                battlefieldEntryOverrides,
                ctx,
                stepKind: step.kind,
              })
            : moveTargetedCardFromHand(
                nextState,
                location.playerId,
                cardId,
                'any',
                'battlefield',
                bfController,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
                battlefieldEntryOverrides
              );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (that card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result as any);
  }

  if (
    (parsedThatCardReference || /\bthat card\b/i.test(String((step.what as any)?.text || ''))) &&
    step.to === 'hand' &&
    !/\bonto the battlefield or into your hand\b/i.test(String(step.raw || '')) &&
    // In "all other cards with the same name as that card", "that card" names the target being
    // compared against rather than the thing being moved, so this catch-all would return only the
    // one target and drop the same-named cards the dedicated selector below collects.
    !parsedSameNamedFromYourGraveyard
  ) {
    const preferredIds = getChosenObjectIds(ctx);
    const contextual = Array.isArray(runtime?.lastMovedCards) ? [...runtime.lastMovedCards] : [];
    const contextualIds = contextual
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean);
    const cardId =
      preferredIds.find(id => contextualIds.includes(id) || Boolean(findBoundCardZoneLocation(nextState, id))) ||
      contextualIds[0] ||
      preferredIds[0] ||
      String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim();
    const location = cardId ? findBoundCardZoneLocation(nextState, cardId) : null;
    if (!location) {
      return buildAppliedResult({ state: nextState, log: [`No that-card reference available: ${step.raw}`] });
    }
    const result =
      location.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(nextState, location.playerId, cardId, { cardType: 'any' }, 'hand')
        : location.zone === 'exile'
          ? moveTargetedCardFromExile(nextState, location.playerId, cardId, 'any', 'hand')
          : location.zone === 'library'
            ? moveContextualCardToDestination(nextState, location, cardId, 'hand', {
                controllerId,
                cardType: 'any',
              })
            : { kind: 'applied' as const, state: nextState, log: [] as string[] };
    if (result.kind !== 'applied') {
      return buildAppliedResult({ state: nextState, log: [`That card unavailable: ${step.raw}`] });
    }
    return buildAppliedResult({ state: result.state, log: result.log || [`Returned that card to hand: ${step.raw}`] });
  }

  if (parsedTheOtherToBattlefield) {
    const preferredIds = getChosenObjectIds(ctx);
    const contextual = Array.isArray(runtime?.lastMovedCards) ? [...runtime.lastMovedCards] : [];
    const contextualIds = contextual
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean);
    const chosenId = preferredIds.find(id => contextualIds.includes(id)) || contextualIds[0] || '';
    const otherCard =
      contextual.find((card: any) => String(card?.id || '').trim() !== chosenId) || contextual[1] || contextual[0];
    const cardId = String(otherCard?.id || '').trim();
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No other contextual card: ${step.raw}`] });
    }
    const location = findBoundCardZoneLocation(nextState, cardId);
    if (!location) {
      return buildAppliedResult({ state: nextState, log: [`Other contextual card unavailable: ${step.raw}`] });
    }
    const bfController = String(step.battlefieldController?.kind === 'you' ? controllerId : controllerId);
    const result =
      location.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(
            nextState,
            location.playerId,
            cardId,
            { cardType: 'any' },
            'battlefield',
            bfController,
            step.entersTapped,
            step.entersFaceDown,
            effectiveWithCounters,
            undefined,
            undefined,
            battlefieldEntryOverrides
          )
        : location.zone === 'exile'
          ? moveTargetedCardFromExile(
              nextState,
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
            )
          : location.zone === 'hand'
            ? moveTargetedCardFromHand(
                nextState,
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
              )
            : moveContextualCardToDestination(nextState, location, cardId, 'battlefield', {
                controllerId: bfController,
                ctx,
                cardType: 'any',
                entersTapped: step.entersTapped,
                entersFaceDown: step.entersFaceDown,
                withCounters: effectiveWithCounters,
                battlefieldEntryOverrides,
              });
    if (result.kind !== 'applied') {
      return buildAppliedResult({ state: nextState, log: [`Other contextual card unavailable: ${step.raw}`] });
    }
    return buildAppliedResult({
      state: result.state,
      log: result.log || [`Returned the other to the battlefield: ${step.raw}`],
      movedBattlefieldPermanentIds: (result as any).movedPermanentIds,
    });
  }

  if (parsedTheOtherToLibrary) {
    const contextual = Array.isArray(runtime?.lastMovedCards) ? [...runtime.lastMovedCards] : [];
    const exiledIds = new Set(
      (Array.isArray(runtime?.lastExiledCards) ? runtime.lastExiledCards : [])
        .map((card: any) => String(card?.id || '').trim())
        .filter(Boolean)
    );
    const chosenId = String(
      (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds[0] : '') || ''
    ).trim();
    const otherCard =
      contextual.find((card: any) => {
        const cardId = String(card?.id || '').trim();
        return cardId && cardId !== chosenId && !exiledIds.has(cardId);
      }) ||
      contextual.find((card: any) => !exiledIds.has(String(card?.id || '').trim())) ||
      contextual[1] ||
      contextual[0];
    const cardId = String(otherCard?.id || '').trim();
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No other contextual card: ${step.raw}`] });
    }
    const location = findBoundCardZoneLocation(nextState, cardId);
    if (!location) {
      return {
        applied: false,
        message: `Skipped move zone (other contextual card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const result = moveContextualCardToDestination(nextState, location, cardId, 'library_bottom', {
      controllerId: location.playerId,
      cardType: 'any',
    });
    if (result.kind !== 'applied') {
      return {
        applied: false,
        message: `Skipped move zone (other contextual card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return buildAppliedResult({
      state: result.state,
      log: result.log || [`Moved the other to library bottom: ${step.raw}`],
    });
  }

  if (parsedTheOtherToHand) {
    const contextual = Array.isArray(runtime?.lastMovedCards)
      ? [...runtime.lastMovedCards]
      : Array.isArray(ctx.lastMovedCards)
        ? [...ctx.lastMovedCards]
        : [];
    const exiledIds = new Set(
      [
        ...(Array.isArray(runtime?.lastExiledCards) ? runtime.lastExiledCards : []),
        ...(Array.isArray(ctx.lastExiledCards) ? ctx.lastExiledCards : []),
      ]
        .map((card: any) => String(card?.id || '').trim())
        .filter(Boolean)
    );
    const otherCard =
      contextual.find((card: any) => !exiledIds.has(String(card?.id || '').trim())) ||
      contextual[1] ||
      contextual[0];
    const cardId = String(otherCard?.id || '').trim();
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No other contextual card: ${step.raw}`] });
    }
    const location = findBoundCardZoneLocation(nextState, cardId);
    if (!location) {
      return {
        applied: false,
        message: `Skipped move zone (other contextual card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const result =
      location.zone === 'library'
        ? moveContextualCardToDestination(nextState, location, cardId, 'hand', {
            controllerId,
            cardType: 'any',
          })
        : location.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(nextState, location.playerId, cardId, { cardType: 'any' }, 'hand')
        : location.zone === 'exile'
          ? moveTargetedCardFromExile(nextState, location.playerId, cardId, 'any', 'hand')
          : { kind: 'applied' as const, state: nextState, log: [] as string[] };
    if (result.kind !== 'applied') {
      return {
        applied: false,
        message: `Skipped move zone (other contextual card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return buildAppliedResult({ state: result.state, log: result.log || [`Moved the other to hand: ${step.raw}`] });
  }

  if (parsedLastChosenCard && step.to === 'hand') {
    const chosenIds = getChosenObjectIds(ctx);
    const contextual = [
      ...(Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []),
      ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
    ];
    const lastChosenId =
      chosenIds.length > 0
        ? String(chosenIds[chosenIds.length - 1] || '').trim()
        : contextual.length > 0
          ? String((contextual[contextual.length - 1] as any)?.id || '').trim()
          : '';
    if (!lastChosenId) {
      return {
        applied: false,
        message: `Skipped move zone (last chosen card unavailable): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const location = findBoundCardZoneLocation(nextState, lastChosenId);
    if (!location) {
      return {
        applied: false,
        message: `Skipped move zone (last chosen card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    if (location.zone === 'graveyard' && location.playerId !== controllerId) {
      const sourcePlayer = nextState.players.find((player) => player.id === location.playerId) as any;
      const targetPlayer = nextState.players.find((player) => player.id === controllerId) as any;
      if (!sourcePlayer || !targetPlayer) {
        return {
          applied: false,
          message: `Skipped move zone (last chosen card unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }
      const graveyard = Array.isArray(sourcePlayer.graveyard) ? [...sourcePlayer.graveyard] : [];
      const index = graveyard.findIndex((card: any) => String(card?.id || '').trim() === lastChosenId);
      if (index < 0) {
        return {
          applied: false,
          message: `Skipped move zone (last chosen card unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }
      const [card] = graveyard.splice(index, 1);
      const hand = Array.isArray(targetPlayer.hand) ? [...targetPlayer.hand, card] : [card];
      const updatedPlayers = nextState.players.map((player) => {
        if (player.id === location.playerId) return { ...(player as any), graveyard } as any;
        if (player.id === controllerId) return { ...(player as any), hand } as any;
        return player;
      });
      return buildAppliedResult({
        state: { ...nextState, players: updatedPlayers as any } as GameState,
        log: [`${controllerId} puts the last chosen card into their hand`],
      });
    }
    const result =
      location.zone === 'library'
        ? moveContextualCardToDestination(nextState, location, lastChosenId, 'hand', {
            controllerId,
            cardType: 'any',
          })
        : location.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(nextState, location.playerId, lastChosenId, { cardType: 'any' }, 'hand')
          : location.zone === 'exile'
            ? moveTargetedCardFromExile(nextState, location.playerId, lastChosenId, 'any', 'hand')
            : { kind: 'applied' as const, state: nextState, log: [] as string[] };
    if (result.kind !== 'applied') {
      return {
        applied: false,
        message: `Skipped move zone (last chosen card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return buildAppliedResult({
      state: result.state,
      log: result.log || [`Moved the last chosen card to hand: ${step.raw}`],
    });
  }

  if (parsedTheRestToLibrary) {
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, [
      'library',
      'hand',
      'exile',
    ]);
    if (candidateIds.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No contextual cards matched the rest: ${step.raw}`],
      });
    }

    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of candidateIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location || location.zone === 'graveyard') continue;
      const result =
        location.zone === 'hand'
          ? moveTargetedCardFromHandToLibrary(workingState, location.playerId, cardId, 'bottom')
          : moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'hand');
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      if (location.zone === 'exile') {
        const libraryResult = moveTargetedCardFromHandToLibrary(workingState, location.playerId, cardId, 'bottom');
        if (libraryResult.kind === 'applied') {
          workingState = libraryResult.state;
          combinedLog.push(...(libraryResult.log || []));
        }
      }
    }

    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Shuffled the rest into library: ${step.raw}`],
    });
  }

  if (parsedAnotherCardFromGraveyard && step.to === 'exile') {
    const matches = resolveCardIdsFromAnyGraveyard(
      nextState,
      parsedAnotherCardFromGraveyard.cardType,
      getChosenObjectIds(ctx),
      1
    );
    if (matches.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No graveyard card matched: ${step.raw}`],
      });
    }
    if (matches.length > 1) {
      return {
        applied: false,
        message: `Skipped move zone (graveyard target requires player choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    const match = matches[0];
    const result = moveTargetedCardFromGraveyard(
      nextState,
      match.playerId,
      match.cardId,
      { cardType: parsedAnotherCardFromGraveyard.cardType },
      'exile'
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (graveyard card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedOrTypedCardsFromGraveyard && step.to === 'hand') {
    const cardId = resolveFirstMatchingCardIdFromPlayerGraveyard(
      nextState,
      controllerId,
      parsedOrTypedCardsFromGraveyard.criteria,
      getChosenObjectIds(ctx)
    );
    if (!cardId) {
      return buildAppliedResult({
        state: nextState,
        log: [`No matching graveyard card: ${step.raw}`],
      });
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      cardId,
      { cardType: 'any' },
      'hand'
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (graveyard card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedOneTwoOrThreeTargetCreatureCardsFromGraveyards && step.to === 'battlefield') {
    const matches = resolveCardIdsFromAnyGraveyard(
      nextState,
      parsedOneTwoOrThreeTargetCreatureCardsFromGraveyards.cardType,
      getChosenObjectIds(ctx),
      parsedOneTwoOrThreeTargetCreatureCardsFromGraveyards.maxCount
    );
    if (matches.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No graveyard creature cards matched: ${step.raw}`] });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    const bfController = step.battlefieldController?.kind === 'you' ? controllerId : controllerId;
    for (const match of matches) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        match.playerId,
        match.cardId,
        { cardType: parsedOneTwoOrThreeTargetCreatureCardsFromGraveyards.cardType },
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
      log: combinedLog.length > 0 ? combinedLog : [`Returned creature cards from graveyards: ${step.raw}`],
      movedPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedExileXTargetCreatureCardsFromGraveyards && step.to === 'exile') {
    const exileCount = Math.max(0, Number(ctx.xValue) || 3);
    const matches = resolveCardIdsFromAnyGraveyard(
      nextState,
      parsedExileXTargetCreatureCardsFromGraveyards.cardType,
      getChosenObjectIds(ctx),
      exileCount
    );
    if (matches.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No graveyard cards matched: ${step.raw}`],
      });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const match of matches) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        match.playerId,
        match.cardId,
        { cardType: parsedExileXTargetCreatureCardsFromGraveyards.cardType },
        'exile'
      );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Exiled cards from graveyards: ${step.raw}`],
    });
  }

  if (parsedUpToFromGraveyards && step.to === 'battlefield') {
    const matches = resolveCardIdsFromAnyGraveyard(
      nextState,
      parsedUpToFromGraveyards.cardType,
      getChosenObjectIds(ctx),
      parsedUpToFromGraveyards.maxCount
    );
    if (matches.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No graveyard cards matched: ${step.raw}`] });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    const bfController = step.battlefieldController?.kind === 'you' ? controllerId : controllerId;
    for (const match of matches) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        match.playerId,
        match.cardId,
        { cardType: parsedUpToFromGraveyards.cardType },
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
      log: combinedLog.length > 0 ? combinedLog : [`Returned cards from graveyards: ${step.raw}`],
      movedPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedUpToFromGraveyards && step.to === 'exile') {
    const matches = resolveCardIdsFromAnyGraveyard(
      nextState,
      parsedUpToFromGraveyards.cardType,
      getChosenObjectIds(ctx),
      parsedUpToFromGraveyards.maxCount
    );
    if (matches.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No graveyard cards matched: ${step.raw}`],
      });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const match of matches) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        match.playerId,
        match.cardId,
        { cardType: parsedUpToFromGraveyards.cardType },
        'exile'
      );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Exiled cards from graveyards: ${step.raw}`],
    });
  }


  return undefined;
}
