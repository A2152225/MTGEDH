// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: the applyMoveZoneStep selector guards starting at if (parsedFromGraveyard) {
// Public entry symbol: tryApplyMoveZoneGuardsFromGraveyardSelectors.

import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';
import type { GameState, PlayerID } from '../../shared/src';
import { hasExecutorClass, getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { moveBattlefieldPermanentsByIdToOwnersHands } from './oracleIRExecutorBattlefieldOps';
import {
  exileAllMatchingCriteriaFromGraveyard,
  moveTopCardFromLibrary,
  moveAllMatchingFromExile,
  moveAllMatchingFromHand,
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
  moveTargetedCardFromExile,
  findCardsExiledWithSource,
  resolveFirstMatchingCardIdFromPlayerGraveyard,
  exileUpToMatchingFromGraveyard,
  putAllMatchingCriteriaFromGraveyardOntoBattlefield,
  shuffleUpToMatchingFromGraveyardIntoLibrary,
  shuffleTypedCardsFromPlayerGraveyardIntoLibrary,
  selectRandomMatchingCardIdFromGraveyard,
  exileCountFromTopOfLibrary,
  returnAllMatchingCriteriaFromGraveyardToHand,
  putAllMatchingFromExileOntoBattlefield,
  putAllMatchingFromExileOntoBattlefieldWithController,
  putAllMatchingFromGraveyardOntoBattlefield,
  putAllMatchingFromHandOntoBattlefield,
  putOpponentOwnedMatchingFromExileOntoBattlefield,
  selectGraveyardCardsWithMinDistinctTypes,
  shuffleContextualCardsIntoLibrary,
} from './oracleIRExecutorZoneOps';
import { findBoundCardZoneLocation, getChosenObjectIds, getTargetPlayerId } from './oracleIRExecutorMoveZoneReferenceResolvers';
import { resolveContextualCardIdsInZones, resolveMoveZoneSingleTargetCriteriaWithX, resolveOneOfThemCandidateCardIds } from './oracleIRExecutorMoveZoneContextualCardResolvers';
import { buildAppliedResult } from './oracleIRExecutorMoveZoneStepResultBuilders';

export function tryApplyMoveZoneGuardsFromGraveyardSelectors(args: MoveZoneGuardArgs): MoveZoneStepHandlerResult | undefined {
  const { state, step, ctx, runtime, nextState, log, controllerId, effectiveWithCounters, battlefieldEntryOverrides, finalizeAppliedResult, sourcePermanentPower } = args;
  const {
    parsedFromGraveyard,
    parsedThatManyFromTopOfLibrary,
    parsedThatManyFromTopOfLibraryFaceDown,
    parsedCardFromOutsideGame,
    parsedUpToFromOutsideGame,
    parsedOneOrMoreCreaturesFromGy,
    parsedOwnedNonlandPermanentYouOwn,
    parsedShuffleAnyNumberTargetFromTargetPlayerGy,
    parsedExileXTargetFromTargetPlayerGy,
    parsedForEachOpponentUpToOneNonlandBounce,
    parsedAnyNumberOpponentOwnedLandsFromExile,
    parsedCreatureFromOwnersGraveyardUnderOwner,
    parsedEnchantedCreatureAndAurasToHand,
    parsedSingleCardExiledWithIt,
    parsedDiscardedCardFromYourGy,
    parsedReturnThisVehicleToOwnersHand,
    parsedAnyNumberGyWithCardTypesAmong,
    parsedCloakCardFromHand,
    parsedUpToOneNoncreatureNonlandFromTargetPlayerGy,
    parsedMechtitanReturnExiledExceptSelf,
    parsedOneOfThemFromYourGraveyard,
    parsedExileItFromTheirGyWithStash,
    parsedOneOfThoseCardsWithThatNameToHand,
    parsedRandomFromEachOpponentGraveyard,
    parsedPutThatCardBfShuffleRestRevealed,
    parsedThemToOwnersGraveyard,
  } = args.zoneQueries;
  const {
    parsedFromHand,
    parsedFromExile,
  } = args.referenceQueries;

  if (parsedFromGraveyard) {
    const effectiveParsedFromGraveyard = resolveMoveZoneSingleTargetCriteriaWithX(
      parsedFromGraveyard,
      ctx,
      nextState,
      controllerId
    );
    const useCriteriaGyMove =
      effectiveParsedFromGraveyard.typeLineTermsAnyOf ||
      effectiveParsedFromGraveyard.creatureTypesAnyOf ||
      effectiveParsedFromGraveyard.typeLineTermsNoneOf ||
      effectiveParsedFromGraveyard.manaValueLte !== undefined ||
      effectiveParsedFromGraveyard.cardType === 'creature_or_planeswalker' ||
      effectiveParsedFromGraveyard.cardType === 'artifact_or_enchantment' ||
      effectiveParsedFromGraveyard.cardType === 'artifact_or_creature' ||
      effectiveParsedFromGraveyard.cardType === 'instant_or_sorcery';

    if (step.to === 'hand') {
      const result = returnAllMatchingCriteriaFromGraveyardToHand(
        nextState,
        controllerId,
        effectiveParsedFromGraveyard,
        sourcePermanentPower
      );
      return finalizeAppliedResult(result);
    }

    if (step.to === 'exile') {
      const result = exileAllMatchingCriteriaFromGraveyard(
        nextState,
        controllerId,
        effectiveParsedFromGraveyard,
        sourcePermanentPower
      );
      return finalizeAppliedResult(result);
    }

    if (step.to === 'battlefield') {
      const result = useCriteriaGyMove
        ? putAllMatchingCriteriaFromGraveyardOntoBattlefield(
            nextState,
            controllerId,
            controllerId,
            effectiveParsedFromGraveyard,
            [],
            step.entersTapped,
            step.entersFaceDown,
            effectiveWithCounters
          )
        : putAllMatchingFromGraveyardOntoBattlefield(
            nextState,
            controllerId,
            effectiveParsedFromGraveyard.cardType,
            step.entersTapped,
            step.entersFaceDown,
            effectiveWithCounters
          );
      return finalizeAppliedResult(result);
    }

    return {
      applied: false,
      message: `Skipped move zone (unsupported destination): ${step.raw}`,
      reason: 'unsupported_destination',
    };
  }

  if (parsedFromExile) {
    if (step.to === 'hand') {
      const result = moveAllMatchingFromExile(nextState, controllerId, parsedFromExile.cardType, 'hand');
      return finalizeAppliedResult(result);
    }

    if (step.to === 'graveyard') {
      const result = moveAllMatchingFromExile(nextState, controllerId, parsedFromExile.cardType, 'graveyard');
      return finalizeAppliedResult(result);
    }

    if (step.to === 'battlefield') {
      const result =
        step.battlefieldController?.kind === 'you'
          ? putAllMatchingFromExileOntoBattlefieldWithController(
              nextState,
              controllerId,
              controllerId,
              parsedFromExile.cardType,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters
            )
          : putAllMatchingFromExileOntoBattlefield(
              nextState,
              controllerId,
              parsedFromExile.cardType,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters
            );
      return finalizeAppliedResult(result);
    }

    return {
      applied: false,
      message: `Skipped move zone (unsupported destination): ${step.raw}`,
      reason: 'unsupported_destination',
    };
  }

  if (parsedFromHand) {
    if (step.to !== 'graveyard' && step.to !== 'exile' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const result =
      step.to === 'battlefield'
        ? putAllMatchingFromHandOntoBattlefield(
            nextState,
            controllerId,
            parsedFromHand.cardType,
            step.entersTapped,
            step.entersFaceDown,
            effectiveWithCounters
          )
        : moveAllMatchingFromHand(nextState, controllerId, parsedFromHand.cardType, step.to);

    return finalizeAppliedResult(result);
  }

  if (parsedThatManyFromTopOfLibrary && step.to === 'exile') {
    const count = Math.max(0, Number(ctx.referenceAmount ?? 2));
    const result = exileCountFromTopOfLibrary(nextState, controllerId, count, false);
    return buildAppliedResult({ state: result.state, log: [...result.log] });
  }

  if (parsedThatManyFromTopOfLibrary && step.to === 'hand') {
    const count = Math.max(
      0,
      Number(ctx.referenceAmount ?? ctx.lastReferenceAmount ?? runtime?.lastReferenceAmount ?? 2)
    );
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const result = moveTopCardFromLibrary(workingState, controllerId, 'hand');
      if (result.kind !== 'applied') break;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved library top cards to hand: ${step.raw}`],
    });
  }

  if (parsedThatManyFromTopOfLibraryFaceDown && step.to === 'exile') {
    const count = Math.max(0, Number(ctx.referenceAmount ?? 2));
    const result = exileCountFromTopOfLibrary(nextState, controllerId, count, true);
    return buildAppliedResult({ state: result.state, log: [...result.log] });
  }

  if (parsedUpToFromOutsideGame && step.to === 'library') {
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const sideboard = Array.isArray(player?.sideboard) ? [...player.sideboard] : [];
    const preferred = getChosenObjectIds(ctx);
    const chosenCards =
      preferred.length > 0
        ? sideboard.filter((entry: any) => preferred.includes(String(entry?.id || '').trim()))
        : sideboard;
    const cardsToShuffle = chosenCards.slice(0, parsedUpToFromOutsideGame.count);
    if (cardsToShuffle.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No outside-the-game cards available: ${step.raw}`] });
    }
    const chosenIds = new Set(
      cardsToShuffle.map((entry: any) => String(entry?.id || '').trim()).filter(Boolean)
    );
    const nextSideboard = sideboard.filter(
      (entry: any) => !chosenIds.has(String(entry?.id || '').trim())
    );
    const library = Array.isArray(player?.library) ? [...player.library] : [];
    const updatedPlayers = nextState.players.map(p =>
      p.id === controllerId
        ? ({
            ...(p as any),
            library: [...library, ...cardsToShuffle],
            sideboard: nextSideboard,
          } as any)
        : p
    );
    return buildAppliedResult({
      state: { ...nextState, players: updatedPlayers as any } as GameState,
      log: [`${controllerId} shuffles ${cardsToShuffle.length} card(s) from outside the game into library`],
    });
  }

  if (parsedCardFromOutsideGame && step.to === 'hand') {
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const sideboard = Array.isArray(player?.sideboard) ? [...player.sideboard] : [];
    const preferred = getChosenObjectIds(ctx);
    const card =
      (preferred.length > 0
        ? sideboard.find((entry: any) => preferred.includes(String(entry?.id || '').trim()))
        : sideboard[0]) || sideboard[0];
    if (!card) {
      return buildAppliedResult({ state: nextState, log: [`No outside-the-game card available: ${step.raw}`] });
    }
    const cardId = String((card as any)?.id || '').trim();
    const nextSideboard = sideboard.filter((entry: any) => String(entry?.id || '').trim() !== cardId);
    const hand = Array.isArray(player?.hand) ? [...player.hand, card] : [card];
    const updatedPlayers = nextState.players.map(p =>
      p.id === controllerId ? ({ ...(p as any), hand, sideboard: nextSideboard } as any) : p
    );
    return buildAppliedResult({
      state: { ...nextState, players: updatedPlayers as any } as GameState,
      log: [`${controllerId} puts a card from outside the game into hand`],
    });
  }

  if (parsedOneOrMoreCreaturesFromGy && step.to === 'exile') {
    const result = exileAllMatchingCriteriaFromGraveyard(nextState, controllerId, { cardType: 'creature' });
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`Exiled creature cards from graveyard: ${step.raw}`],
    });
  }

  if (parsedOwnedNonlandPermanentYouOwn && step.to === 'hand') {
    const sourceId = String(ctx.sourceId || '').trim();
    const perm = ((nextState.battlefield || []) as any[]).find(
      entry =>
        String(entry?.id || '').trim() === sourceId ||
        (entry?.controller === controllerId &&
          hasExecutorClass(entry, 'permanent') &&
          !hasExecutorClass(entry, 'land'))
    );
    const permId = String((perm as any)?.id || sourceId || 'bf-permanent-1').trim();
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, [permId]);
    return finalizeAppliedResult(result);
  }

  if (parsedExileXTargetFromTargetPlayerGy && step.to === 'exile') {
    const targetPlayerId = getTargetPlayerId(ctx) || 'p2';
    const preferred = getChosenObjectIds(ctx);
    const player = nextState.players.find(p => p.id === targetPlayerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
    const cardIds =
      preferred.length > 0
        ? preferred.filter(id => graveyard.some((card: any) => String(card?.id || '').trim() === id))
        : graveyard.map((card: any) => String(card?.id || '').trim()).filter(Boolean);
    let workingState = nextState;
    const combinedLog: string[] = [];
    const exiledCards: any[] = [];
    for (const cardId of cardIds) {
      const result = moveTargetedCardFromGraveyard(workingState, targetPlayerId, cardId, { cardType: 'any' }, 'exile');
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      const moved = graveyard.find((card: any) => String(card?.id || '').trim() === cardId);
      if (moved) exiledCards.push(moved);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Exiled target graveyard cards: ${step.raw}`],
      lastMovedCards: exiledCards,
    });
  }

  if (parsedShuffleAnyNumberTargetFromTargetPlayerGy && step.to === 'library') {
    const targetPlayerId = getTargetPlayerId(ctx) || 'p2';
    const preferred = getChosenObjectIds(ctx);
    const player = nextState.players.find(p => p.id === targetPlayerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    const cardIds =
      preferred.length > 0
        ? preferred.filter(id => graveyard.some((card: any) => String(card?.id || '').trim() === id))
        : graveyard.map((card: any) => String(card?.id || '').trim()).filter(Boolean);
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of cardIds) {
      const result = shuffleUpToMatchingFromGraveyardIntoLibrary(workingState, targetPlayerId, 1, { cardType: 'any' }, [cardId]);
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Shuffled target graveyard cards into library: ${step.raw}`],
    });
  }

  if (parsedForEachOpponentUpToOneNonlandBounce && step.to === 'hand') {
    const opponents = (nextState.players || [])
      .map(p => String((p as any)?.id || '').trim())
      .filter(id => id && id !== controllerId);
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const opponentId of opponents) {
      const perm = ((workingState.battlefield || []) as any[]).find(
        entry =>
          String(entry?.controller || '').trim() === opponentId &&
          hasExecutorClass(entry, 'permanent') &&
          !hasExecutorClass(entry, 'land')
      );
      const permId = String((perm as any)?.id || '').trim();
      if (!permId) continue;
      const result = moveBattlefieldPermanentsByIdToOwnersHands(workingState, [permId]);
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned opponent permanents to hand: ${step.raw}`],
    });
  }

  if (parsedAnyNumberOpponentOwnedLandsFromExile && step.to === 'battlefield') {
    const targetPlayerId = getTargetPlayerId(ctx) || 'p2';
    const result = putOpponentOwnedMatchingFromExileOntoBattlefield(
      nextState,
      controllerId,
      targetPlayerId,
      'land',
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters
    );
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`Put opponent-owned lands from exile onto battlefield: ${step.raw}`],
      movedBattlefieldPermanentIds: result.movedPermanentIds,
    });
  }

  if (parsedCreatureFromOwnersGraveyardUnderOwner && step.to === 'battlefield') {
    const targetId = String(ctx.targetCreatureId || ctx.targetPermanentId || 'gy-creature-1').trim();
    const location = findBoundCardZoneLocation(nextState, targetId);
    const ownerId = location?.playerId || controllerId;
    const result = moveTargetedCardFromGraveyard(
      nextState,
      ownerId,
      targetId,
      { cardType: 'creature' },
      'battlefield',
      ownerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      undefined,
      undefined,
      battlefieldEntryOverrides
    );
    return result.kind === 'impossible'
      ? buildAppliedResult({ state: nextState, log: [`No owner graveyard creature: ${step.raw}`] })
      : finalizeAppliedResult(result);
  }

  if (parsedEnchantedCreatureAndAurasToHand && step.to === 'hand') {
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = [...((nextState.battlefield || []) as any[])];
    if (parsedEnchantedCreatureAndAurasToHand === 'this_aura') {
      const auraPermanent = battlefield.find(perm => String((perm as any)?.id || '').trim() === sourceId);
      const enchantedId = String(
        (auraPermanent as any)?.attachedTo ||
          (auraPermanent as any)?.enchanting ||
          ctx.enchantedPermanentId ||
          'bf-creature-1'
      ).trim();
      const targetIds = [enchantedId, sourceId || 'bf-enchantment-1'].filter(Boolean);
      const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds);
      return finalizeAppliedResult(result);
    }
    const enchantedId = String(ctx.enchantedPermanentId || ctx.sourceId || 'bf-creature-1').trim();
    const targetIds = battlefield
      .filter(perm => {
        const id = String((perm as any)?.id || '').trim();
        if (id === enchantedId) return true;
        const attachedTo = String((perm as any)?.attachedTo || (perm as any)?.enchanting || '').trim();
        return attachedTo === enchantedId && getExecutorTypeLineLower(perm).includes('aura');
      })
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds.length > 0 ? targetIds : [enchantedId]);
    return finalizeAppliedResult(result);
  }

  if (parsedSingleCardExiledWithIt && (step.to === 'graveyard' || step.to === 'hand')) {
    const sourceId = String(ctx.sourceId || '').trim();
    const matches = findCardsExiledWithSource(nextState, sourceId, { cardType: 'any' });
    const preferred = getChosenObjectIds(ctx);
    const atRandom = /\bat random\b/i.test(`${String((step.what as any)?.text || '')} ${String(step.raw || '')}`);
    const chosen =
      matches.length === 0
        ? undefined
        : atRandom
          ? matches[Math.floor(Math.random() * matches.length)]
          : preferred.length > 0
            ? matches.find(match => preferred.includes(match.cardId)) || matches[0]
            : matches[0];
    if (!chosen) {
      return buildAppliedResult({ state: nextState, log: [`No card exiled with source: ${step.raw}`] });
    }
    const result = moveTargetedCardFromExile(
      nextState,
      chosen.playerId,
      chosen.cardId,
      'any',
      step.to === 'hand' ? 'hand' : 'graveyard',
    );
    return finalizeAppliedResult(result);
  }

  if (parsedDiscardedCardFromYourGy && step.to === 'hand') {
    const discardedId = String(
      ctx.lastDiscardedCardId ||
        ctx.selectorContext?.lastDiscardedCardId ||
        getChosenObjectIds(ctx)[0] ||
        'gy-discarded-1'
    ).trim();
    const result = moveTargetedCardFromGraveyard(nextState, controllerId, discardedId, { cardType: 'any' }, 'hand');
    return result.kind === 'impossible'
      ? buildAppliedResult({ state: nextState, log: [`No discarded card in graveyard: ${step.raw}`] })
      : finalizeAppliedResult(result);
  }

  if (parsedReturnThisVehicleToOwnersHand && step.to === 'hand') {
    const sourceId = String(ctx.sourceId || '').trim();
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, [sourceId || 'bf-vehicle-1']);
    return finalizeAppliedResult(result);
  }

  if (parsedAnyNumberGyWithCardTypesAmong && step.to === 'exile') {
    const cardIds = selectGraveyardCardsWithMinDistinctTypes(
      nextState,
      controllerId,
      parsedAnyNumberGyWithCardTypesAmong.minDistinctTypes,
      getChosenObjectIds(ctx)
    );
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of cardIds) {
      const result = moveTargetedCardFromGraveyard(workingState, controllerId, cardId, { cardType: 'any' }, 'exile');
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Exiled graveyard cards by card types: ${step.raw}`],
    });
  }

  if (parsedCloakCardFromHand && step.to === 'battlefield') {
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    const preferred = getChosenObjectIds(ctx);
    const card =
      (preferred.length > 0 ? hand.find((entry: any) => preferred.includes(String(entry?.id || '').trim())) : hand[0]) ||
      hand[0];
    const cardId = String((card as any)?.id || '').trim();
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No hand card to cloak: ${step.raw}`] });
    }
    const result = moveTargetedCardFromHand(
      nextState,
      controllerId,
      cardId,
      'any',
      'battlefield',
      controllerId,
      false,
      true,
      effectiveWithCounters,
      undefined,
      { setTypeLine: 'Creature', loseAllAbilities: true }
    );
    return finalizeAppliedResult(result);
  }

  if (parsedUpToOneNoncreatureNonlandFromTargetPlayerGy && step.to === 'exile') {
    const targetPlayerId = getTargetPlayerId(ctx) || 'p2';
    const result = exileUpToMatchingFromGraveyard(
      nextState,
      targetPlayerId,
      1,
      { cardType: 'noncreature_nonland_permanent' },
      getChosenObjectIds(ctx)
    );
    if (result.kind === 'impossible') {
      return buildAppliedResult({ state: nextState, log: [`No matching target graveyard card: ${step.raw}`] });
    }
    return finalizeAppliedResult(result);
  }

  if (parsedMechtitanReturnExiledExceptSelf && step.to === 'battlefield') {
    const sourceId = String(ctx.sourceId || '').trim();
    const matches = findCardsExiledWithSource(nextState, sourceId, { cardType: 'any' }).filter(
      match => match.cardId !== sourceId
    );
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const match of matches) {
      const result = moveTargetedCardFromExile(
        workingState,
        match.playerId,
        match.cardId,
        'any',
        'battlefield',
        match.playerId,
        true,
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
      log: combinedLog.length > 0 ? combinedLog : [`Returned exiled cards except source: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedOneOfThemFromYourGraveyard && step.to === 'exile') {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime).filter(id => {
      const location = findBoundCardZoneLocation(nextState, id);
      return location?.zone === 'graveyard' && location.playerId === controllerId;
    });
    const cardId = candidateIds[0] || resolveFirstMatchingCardIdFromPlayerGraveyard(nextState, controllerId, [{ cardType: 'any' }], getChosenObjectIds(ctx));
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No one-of-them graveyard card: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(nextState, controllerId, cardId, { cardType: 'any' }, 'exile');
    return finalizeAppliedResult(result);
  }

  if (parsedExileItFromTheirGyWithStash && step.to === 'exile') {
    const targetPlayerId = getTargetPlayerId(ctx) || 'p2';
    const cardId =
      String(ctx.targetPermanentId || ctx.targetCreatureId || getChosenObjectIds(ctx)[0] || 'gy-target-1').trim();
    const player = nextState.players.find(p => p.id === targetPlayerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
    const index = graveyard.findIndex((card: any) => String(card?.id || '').trim() === cardId);
    if (index < 0) {
      return buildAppliedResult({ state: nextState, log: [`No target graveyard card for stash exile: ${step.raw}`] });
    }
    const [card] = graveyard.splice(index, 1);
    const exileOwner = nextState.players.find(p => p.id === targetPlayerId) as any;
    const exile = Array.isArray(exileOwner?.exile) ? [...exileOwner.exile] : [];
    exile.push({ ...card, counters: { ...(card?.counters || {}), stash: 1 } });
    const updatedPlayers = nextState.players.map(p =>
      p.id === targetPlayerId ? ({ ...(p as any), graveyard, exile } as any) : p
    );
    return buildAppliedResult({
      state: { ...nextState, players: updatedPlayers as any } as GameState,
      log: [`Exiled ${cardId} from ${targetPlayerId}'s graveyard with a stash counter`],
    });
  }

  if (parsedOneOfThoseCardsWithThatNameToHand && step.to === 'hand') {
    const referenceName = String(ctx.referenceCardName || ctx.selectorContext?.referenceCardName || '').trim();
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, ['exile', 'graveyard', 'hand']);
    const preferred = getChosenObjectIds(ctx);
    let cardId = preferred.find(id => candidateIds.includes(id)) || candidateIds[0] || '';
    if (referenceName && cardId) {
      const location = findBoundCardZoneLocation(nextState, cardId);
      const zoneCards =
        location?.zone === 'graveyard'
          ? ((nextState.players.find(p => p.id === location.playerId) as any)?.graveyard || [])
          : location?.zone === 'exile'
            ? ((nextState.players.find(p => p.id === location.playerId) as any)?.exile || [])
            : [];
      const sameName = zoneCards.find(
        (card: any) =>
          String(card?.name || '').trim().toLowerCase() === referenceName.toLowerCase() &&
          (preferred.length === 0 || preferred.includes(String(card?.id || '').trim()))
      );
      if (sameName) cardId = String(sameName?.id || '').trim();
    }
    const location = cardId ? findBoundCardZoneLocation(nextState, cardId) : null;
    if (!location) {
      return buildAppliedResult({ state: nextState, log: [`No matching named card: ${step.raw}`] });
    }
    const result =
      location.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(nextState, location.playerId, cardId, { cardType: 'any' }, 'hand')
        : location.zone === 'exile'
          ? moveTargetedCardFromExile(nextState, location.playerId, cardId, 'any', 'hand')
          : { kind: 'impossible' as const };
    return result.kind === 'impossible'
      ? buildAppliedResult({ state: nextState, log: [`No matching named card: ${step.raw}`] })
      : finalizeAppliedResult(result);
  }

  if (parsedRandomFromEachOpponentGraveyard && step.to === 'exile') {
    const opponents = (nextState.players || [])
      .map(p => String((p as any)?.id || '').trim())
      .filter(id => id && id !== controllerId);
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const opponentId of opponents) {
      const selection = selectRandomMatchingCardIdFromGraveyard(workingState, opponentId, { cardType: 'any' });
      if (selection.kind !== 'selected') continue;
      const result = moveTargetedCardFromGraveyard(
        workingState,
        opponentId,
        selection.cardId,
        { cardType: 'any' },
        'exile'
      );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Exiled random cards from opponent graveyards: ${step.raw}`],
    });
  }

  if (parsedPutThatCardBfShuffleRestRevealed && step.to === 'battlefield') {
    const preferredIds = getChosenObjectIds(ctx);
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, ['exile', 'hand']);
    const cardId = preferredIds.find(id => candidateIds.includes(id)) || candidateIds[0] || '';
    let workingState = nextState;
    const combinedLog: string[] = [];
    if (cardId) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      const moveResult =
        location?.zone === 'exile'
          ? moveTargetedCardFromExile(
              workingState,
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
            )
          : location?.zone === 'hand'
            ? moveTargetedCardFromHand(
                workingState,
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
              )
            : { kind: 'impossible' as const };
      if (moveResult.kind === 'applied') {
        workingState = moveResult.state;
        combinedLog.push(...(moveResult.log || []));
      }
    }
    const restIds = candidateIds.filter(id => id !== cardId);
    const shuffleResult = shuffleContextualCardsIntoLibrary(workingState, controllerId, restIds);
    workingState = shuffleResult.state;
    combinedLog.push(...shuffleResult.log);
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Put revealed creature onto battlefield and shuffled rest: ${step.raw}`],
    });
  }

  if (parsedThemToOwnersGraveyard) {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime);
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of candidateIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const result =
        location.zone === 'exile'
          ? moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'graveyard')
          : location.zone === 'hand'
            ? moveTargetedCardFromHand(workingState, location.playerId, cardId, 'any', 'graveyard')
            : { kind: 'impossible' as const };
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved them to owners' graveyards: ${step.raw}`],
    });
  }

  const whatTextLower = String((step.what as any)?.text || '').trim().toLowerCase();
  if (whatTextLower === 'each commander target player controls' && step.to === 'command') {
    const targetPlayerId = String(
      ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2'
    ).trim() as PlayerID;
    const commanders = ((nextState.battlefield || []) as any[]).filter((perm: any) => {
      if (String(perm?.controller || '').trim() !== targetPlayerId) return false;
      const typeLine = getExecutorTypeLineLower(perm);
      return typeLine.includes('legendary') && (typeLine.includes('creature') || typeLine.includes('planeswalker'));
    });
    if (commanders.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No commanders to return to command zone: ${step.raw}`] });
    }
    const removedIds = new Set(commanders.map((perm: any) => String(perm?.id || '').trim()).filter(Boolean));
    const kept = ((nextState.battlefield || []) as any[]).filter(
      (perm: any) => !removedIds.has(String(perm?.id || '').trim())
    );
    let workingState = { ...(nextState as any), battlefield: kept } as GameState;
    const movedCards: any[] = [];
    workingState = {
      ...(workingState as any),
      players: (workingState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== targetPlayerId) return player;
        const commandZone = Array.isArray(player?.commandZone)
          ? [...player.commandZone]
          : Array.isArray(player?.command)
            ? [...player.command]
            : [];
        const additions = commanders.map((perm: any) => {
          const card = { ...(perm?.card || perm), id: String(perm?.id || perm?.card?.id || '').trim() };
          movedCards.push(card);
          return card;
        });
        return { ...player, commandZone: [...commandZone, ...additions], command: [...commandZone, ...additions] };
      }),
    } as GameState;
    return buildAppliedResult({
      state: workingState,
      log: [`${targetPlayerId} returned ${commanders.length} commander(s) to the command zone`],
      movedCards,
    });
  }

  if (whatTextLower === "all creature cards from target player's graveyard" && step.to === 'library') {
    const targetPlayerId = String(
      ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2'
    ).trim() as PlayerID;
    const playerBefore = nextState.players.find((entry) => entry.id === targetPlayerId) as any;
    const gyCount = Array.isArray(playerBefore?.graveyard)
      ? playerBefore.graveyard.filter((card: any) =>
          String(card?.type_line || card?.typeLine || '').toLowerCase().includes('creature')
        ).length
      : 0;
    const workingState = shuffleTypedCardsFromPlayerGraveyardIntoLibrary(nextState, targetPlayerId, 'creature');
    return buildAppliedResult({
      state: workingState,
      log: [`Shuffled ${gyCount} creature card(s) from ${targetPlayerId}'s graveyard into their library`],
    });
  }

  return undefined;
}
