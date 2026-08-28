// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: the applyMoveZoneStep selector guards starting at if (parsedAnyNumberFromYourHandFaceDown && step.to === 'exile') {
// Public entry symbol: tryApplyMoveZoneGuardsFromAnyNumberFromYourHandFaceDown.

import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';
import type { GameState, PlayerID } from '../../shared/src';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { finalizeBattlefieldRemoval, moveBattlefieldPermanentsByIdToOwnersHands } from './oracleIRExecutorBattlefieldOps';
import {
  exileAllMatchingFromGraveyard,
  moveTopCardFromLibrary,
  moveAllMatchingFromHand,
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
  moveTargetedCardFromExile,
  findCardsExiledWithSource,
  exileUpToCountFromHand,
  resolveCardIdsFromAnyGraveyard,
  exileAllSpellsAndAbilitiesFromStack,
  exileAllSameNamedCardsFromAllGraveyards,
  selectGraveyardCreaturesWithTotalManaValueLteFromPlayers,
  cardMatchesType,
  createBattlefieldPermanentsFromCards,
  addBattlefieldPermanentsToState,
} from './oracleIRExecutorZoneOps';
import {
  chosenObjectIdsAreMatchingCardSelection,
  getChosenObjectIds,
  getOpponents,
  getTargetPlayerId,
} from './oracleIRExecutorMoveZoneReferenceResolvers';
import { buildAppliedResult } from './oracleIRExecutorMoveZoneStepResultBuilders';

export function tryApplyMoveZoneGuardsFromAnyNumberFromYourHandFaceDown(args: MoveZoneGuardArgs): MoveZoneStepHandlerResult | undefined {
  const { state, step, ctx, runtime, nextState, log, controllerId, effectiveWithCounters, battlefieldEntryOverrides, finalizeAppliedResult, attachmentResolution } = args;
  const {
    parsedThisArtifactAndAllGraveyards,
    parsedAnyNumberFromYourHand,
    parsedAnyNumberFromYourHandFaceDown,
    parsedAllCardsDestroyedThisWayFromYourGraveyard,
    parsedCompoundArtifactCreatureLandGyHandsExile,
    parsedAllCardsFromAllHandsAndGraveyards,
    parsedAllCardsFromAllOpponentsHandsAndGraveyards,
    parsedTargetNonlandSameNameMassExile,
    parsedAllSpellsAndAbilitiesFromStackIncludingThis,
    parsedTotalMvCreaturesFromGraveyards,
    parsedCraftExiledCard,
    parsedUpToReferenceCountTargetPermanents,
    parsedTopCardsFromTargetPlayerLibrary,
    parsedAllCommandersCommandZoneGy,
    parsedAllCommandersFromCommandZone,
  } = args.zoneQueries;

  if (parsedAnyNumberFromYourHandFaceDown && step.to === 'exile') {
    const preferred = getChosenObjectIds(ctx);
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    const maxCount =
      preferred.length > 0
        ? preferred.filter(id => hand.some((card: any) => String(card?.id || '').trim() === id)).length
        : hand.length;
    const result = exileUpToCountFromHand(
      nextState,
      controllerId,
      maxCount,
      parsedAnyNumberFromYourHandFaceDown.cardType,
      preferred,
      true
    );
    if (result.movedCards.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No hand cards to exile face down: ${step.raw}`] });
    }
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`Exiled hand cards face down: ${step.raw}`],
      lastMovedCards: [...result.movedCards],
      lastReferenceAmount: result.movedCards.length,
    });
  }

  if (parsedAllCardsDestroyedThisWayFromYourGraveyard && step.to === 'battlefield') {
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
    const toReturn = graveyard.filter((card: any) => destroyedIds.has(String(card?.id || '').trim()));
    if (toReturn.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No destroyed-this-way cards in graveyard: ${step.raw}`] });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const card of toReturn) {
      const cardId = String((card as any)?.id || '').trim();
      if (!cardId) continue;
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
      log: combinedLog.length > 0 ? combinedLog : [`Returned destroyed-this-way cards: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedThisArtifactAndAllGraveyards && step.to === 'exile') {
    let workingState = nextState;
    const combinedLog: string[] = [];
    const sourceId = String(ctx.sourceId || '').trim();
    if (sourceId) {
      const battlefield = [...((workingState.battlefield || []) as any[])];
      const perm = battlefield.find(entry => String((entry as any)?.id || '').trim() === sourceId);
      if (perm) {
        const removedIds = new Set([sourceId]);
        const kept = battlefield.filter(entry => String((entry as any)?.id || '').trim() !== sourceId);
        const bfResult = finalizeBattlefieldRemoval(workingState, [perm], removedIds, kept, 'exile', 'exiled');
        workingState = bfResult.state;
        combinedLog.push(...bfResult.log);
      }
    }
    for (const player of (workingState.players || []) as any[]) {
      const playerId = String(player?.id || '').trim() as PlayerID;
      if (!playerId) continue;
      const gyResult = exileAllMatchingFromGraveyard(workingState, playerId, 'any');
      workingState = gyResult.state;
      combinedLog.push(...gyResult.log);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Exiled source artifact and all graveyard cards: ${step.raw}`],
    });
  }

  if (parsedAllCardsFromAllOpponentsHandsAndGraveyards && step.to === 'exile') {
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const player of getOpponents(workingState, controllerId)) {
      const playerId = String(player?.id || '').trim() as PlayerID;
      if (!playerId) continue;
      const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
      if (graveyard.length > 0) {
        const exile = Array.isArray(player.exile) ? [...player.exile] : [];
        const updatedPlayers = workingState.players.map(p =>
          p.id === playerId ? ({ ...(p as any), graveyard: [], exile: [...exile, ...graveyard] } as any) : p
        );
        workingState = { ...workingState, players: updatedPlayers as any } as GameState;
        combinedLog.push(`${playerId} exiles ${graveyard.length} card(s) from graveyard`);
      }
      const handResult = moveAllMatchingFromHand(workingState, playerId, 'any', 'exile');
      workingState = handResult.state;
      combinedLog.push(...handResult.log);
    }
    return buildAppliedResult({
      state: workingState,
      log:
        combinedLog.length > 0
          ? combinedLog
          : [`Exiled all cards from opponents' hands and graveyards: ${step.raw}`],
    });
  }

  if (parsedTargetNonlandSameNameMassExile && step.to === 'exile') {
    const preferred = getChosenObjectIds(ctx);
    const matches = resolveCardIdsFromAnyGraveyard(nextState, 'nonland', preferred, 1);
    if (matches.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No target nonland card in graveyard: ${step.raw}`],
      });
    }
    const { playerId, cardId } = matches[0];
    const player = nextState.players.find(p => p.id === playerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    const targetCard = graveyard.find((card: any) => String(card?.id || '').trim() === cardId);
    const targetName = String((targetCard as any)?.name || '').trim();
    if (!targetName) {
      return buildAppliedResult({
        state: nextState,
        log: [`Target card has no name: ${step.raw}`],
      });
    }

    let workingState = nextState;
    const combinedLog: string[] = [];
    const gyResult = exileAllSameNamedCardsFromAllGraveyards(workingState, targetName);
    workingState = gyResult.state;
    combinedLog.push(...gyResult.log);

    const battlefield = [...((workingState.battlefield || []) as any[])];
    const toRemove = battlefield.filter((perm: any) => {
      const permName = String(perm?.name || perm?.card?.name || '')
        .replace(/\u2019/g, "'")
        .toLowerCase()
        .replace(/[.\s]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      return permName === gyResult.normalizedTargetName;
    });
    if (toRemove.length > 0) {
      const removedIds = new Set(
        toRemove.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean)
      );
      const kept = battlefield.filter(perm => !removedIds.has(String((perm as any)?.id || '').trim()));
      const bfResult = finalizeBattlefieldRemoval(workingState, toRemove, removedIds, kept, 'exile', 'exiled');
      workingState = bfResult.state;
      combinedLog.push(...bfResult.log);
    }

    return buildAppliedResult({
      state: workingState,
      log:
        combinedLog.length > 0
          ? combinedLog
          : [`Exiled target and same-named cards/permanents: ${step.raw}`],
    });
  }

  if (parsedAllSpellsAndAbilitiesFromStackIncludingThis && step.to === 'exile') {
    const result = exileAllSpellsAndAbilitiesFromStack(nextState, ctx);
    return buildAppliedResult({
      state: result.state,
      log:
        result.log.length > 0
          ? [...result.log]
          : [`No spells or abilities on the stack to exile: ${step.raw}`],
    });
  }

  if (parsedAllCardsFromAllHandsAndGraveyards && step.to === 'exile') {
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const player of (workingState.players || []) as any[]) {
      const playerId = String(player?.id || '').trim() as PlayerID;
      if (!playerId) continue;
      const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
      if (graveyard.length > 0) {
        const exile = Array.isArray(player.exile) ? [...player.exile] : [];
        const updatedPlayers = workingState.players.map(p =>
          p.id === playerId ? ({ ...(p as any), graveyard: [], exile: [...exile, ...graveyard] } as any) : p
        );
        workingState = { ...workingState, players: updatedPlayers as any } as GameState;
        combinedLog.push(`${playerId} exiles ${graveyard.length} card(s) from graveyard`);
      }
      const handResult = moveAllMatchingFromHand(workingState, playerId, 'any', 'exile');
      workingState = handResult.state;
      combinedLog.push(...handResult.log);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Exiled all cards from all hands and graveyards: ${step.raw}`],
    });
  }

  if (parsedCompoundArtifactCreatureLandGyHandsExile && step.to === 'exile') {
    let workingState = nextState;
    const combinedLog: string[] = [];
    const battlefield = [...((workingState.battlefield || []) as any[])];
    const toRemove = battlefield.filter(perm => {
      const typeLine = getExecutorTypeLineLower(perm as any);
      return typeLine.includes('artifact') || typeLine.includes('creature') || typeLine.includes('land');
    });
    if (toRemove.length > 0) {
      const removedIds = new Set(toRemove.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean));
      const kept = battlefield.filter(perm => !removedIds.has(String((perm as any)?.id || '').trim()));
      const bfResult = finalizeBattlefieldRemoval(workingState, toRemove, removedIds, kept, 'exile', 'exiled');
      workingState = bfResult.state;
      combinedLog.push(...bfResult.log);
    }
    for (const player of (workingState.players || []) as any[]) {
      const playerId = String(player?.id || '').trim() as PlayerID;
      if (!playerId) continue;
      const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
      if (graveyard.length > 0) {
        const exile = Array.isArray(player.exile) ? [...player.exile] : [];
        const updatedPlayers = workingState.players.map(p =>
          p.id === playerId ? ({ ...(p as any), graveyard: [], exile: [...exile, ...graveyard] } as any) : p
        );
        workingState = { ...workingState, players: updatedPlayers as any } as GameState;
        combinedLog.push(`${playerId} exiles ${graveyard.length} card(s) from graveyard`);
      }
      const handResult = moveAllMatchingFromHand(workingState, playerId, 'any', 'exile');
      workingState = handResult.state;
      combinedLog.push(...handResult.log);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Mass exiled battlefield/graveyard/hand cards: ${step.raw}`],
    });
  }

  if (parsedAnyNumberFromYourHand && step.to === 'battlefield') {
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const hand = Array.isArray(player?.hand) ? [...player.hand] : [];
    const matchingCards = hand.filter((card: any) => {
      const cardId = String(card?.id || '').trim();
      return Boolean(cardId && cardMatchesType(card, parsedAnyNumberFromYourHand.cardType));
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
    const preferred = new Set(getChosenObjectIds(ctx).map(id => String(id || '').trim()).filter(Boolean));
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
        parsedAnyNumberFromYourHand.cardType,
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

  if (parsedTotalMvCreaturesFromGraveyards && step.to === 'battlefield') {
    const totalMv = Math.max(0, Number(ctx.xValue ?? ctx.referenceAmount ?? 6));
    const playerIds = parsedTotalMvCreaturesFromGraveyards.fromTargetPlayerOnly
      ? [getTargetPlayerId(ctx)].filter(Boolean)
      : (nextState.players || []).map((player: any) => String(player?.id || '').trim()).filter(Boolean);
    const selections = selectGraveyardCreaturesWithTotalManaValueLteFromPlayers(
      nextState,
      playerIds as PlayerID[],
      totalMv,
      getChosenObjectIds(ctx)
    );
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const selection of selections) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        selection.playerId,
        selection.cardId,
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
      log: combinedLog.length > 0 ? combinedLog : [`Reanimated creatures: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedCraftExiledCard && step.to === 'battlefield') {
    const sourceId = String(ctx.sourceId || '').trim();
    const matches = findCardsExiledWithSource(nextState, sourceId, parsedCraftExiledCard);
    const preferred = getChosenObjectIds(ctx);
    let match = matches.find(entry => preferred.includes(entry.cardId)) || matches[0];
    if (!match) {
      return buildAppliedResult({ state: nextState, log: [`No crafted exile card: ${step.raw}`] });
    }
    const result = moveTargetedCardFromExile(
      nextState,
      match.playerId,
      match.cardId,
      parsedCraftExiledCard.cardType,
      'battlefield',
      controllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters
    );
    if (result.kind === 'impossible') {
      return buildAppliedResult({ state: nextState, log: [`Crafted exile card unavailable: ${step.raw}`] });
    }
    return finalizeAppliedResult(result);
  }

  if (parsedUpToReferenceCountTargetPermanents && step.to === 'hand') {
    const targetPlayerId = getTargetPlayerId(ctx);
    const maxCount = Math.max(0, Number(ctx.referenceAmount ?? 2));
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const preferred = getChosenObjectIds(ctx);
    const battlefield = ((nextState.battlefield || []) as any[]).filter(
      perm => perm?.controller === targetPlayerId
    );
    let targetIds = battlefield.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean);
    if (preferred.length > 0) {
      targetIds = targetIds.filter(id => preferred.includes(id));
      if (targetIds.length === 0) {
        targetIds = battlefield.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean);
      }
    }
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds.slice(0, maxCount));
    return finalizeAppliedResult(result);
  }

  if (parsedTopCardsFromTargetPlayerLibrary && step.to === 'battlefield') {
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
    const movedBattlefieldIds: string[] = [];
    for (let index = 0; index < parsedTopCardsFromTargetPlayerLibrary.count; index += 1) {
      const result = moveTopCardFromLibrary(
        workingState,
        targetPlayerId,
        'battlefield',
        controllerId,
        step.entersTapped,
        true,
        effectiveWithCounters,
        attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
        battlefieldEntryOverrides
      );
      if (result.kind !== 'applied') break;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved library top cards: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedAllCommandersFromCommandZone && step.to === 'battlefield') {
    const battlefieldControllerId =
      step.battlefieldController?.kind === 'you' ? controllerId : controllerId;
    const isCommanderCard = (card: any): boolean => {
      if ((card as any)?.isCommander === true || (card as any)?.commander === true) return true;
      const typeLine = getExecutorTypeLineLower(card);
      return (
        typeLine.includes('legendary') &&
        (typeLine.includes('creature') || typeLine.includes('planeswalker') || typeLine.includes('background'))
      );
    };
    const commandZoneRemovals = new Map<string, Set<string>>();
    const commanderEntries: Array<{ readonly ownerId: PlayerID; readonly card: any }> = [];
    for (const player of nextState.players || []) {
      const playerId = String((player as any)?.id || '').trim() as PlayerID;
      if (!playerId) continue;
      const commandZone = Array.isArray((player as any)?.commandZone)
        ? [...(player as any).commandZone]
        : Array.isArray((player as any)?.command)
          ? [...(player as any).command]
          : [];
      for (const card of commandZone) {
        if (!isCommanderCard(card)) continue;
        const cardId = String((card as any)?.id || '').trim();
        if (!cardId) continue;
        commanderEntries.push({ ownerId: playerId, card });
        if (!commandZoneRemovals.has(playerId)) commandZoneRemovals.set(playerId, new Set());
        commandZoneRemovals.get(playerId)!.add(cardId);
      }
    }
    if (commanderEntries.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No commanders in command zone: ${step.raw}`] });
    }
    const newPermanents = commanderEntries.flatMap(entry =>
      createBattlefieldPermanentsFromCards(
        [entry.card],
        entry.ownerId,
        battlefieldControllerId,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        'command'
      )
    );
    const updatedPlayers = (nextState.players || []).map(player => {
      const playerId = String((player as any)?.id || '').trim();
      const removedIds = commandZoneRemovals.get(playerId);
      if (!removedIds || removedIds.size === 0) return player;
      const commandZone = Array.isArray((player as any)?.commandZone)
        ? [...(player as any).commandZone]
        : Array.isArray((player as any)?.command)
          ? [...(player as any).command]
          : [];
      const kept = commandZone.filter(
        (card: any) => !removedIds.has(String((card as any)?.id || '').trim())
      );
      return { ...(player as any), commandZone: kept, command: kept };
    });
    return buildAppliedResult({
      state: addBattlefieldPermanentsToState(
        { ...nextState, players: updatedPlayers as any } as GameState,
        newPermanents
      ),
      log: [`${controllerId} puts ${commanderEntries.length} commander(s) from command zone onto the battlefield`],
      movedBattlefieldPermanentIds: newPermanents
        .map(perm => String((perm as any)?.id || '').trim())
        .filter(Boolean),
    });
  }

  if (parsedAllCommandersCommandZoneGy && step.to === 'hand') {
    const controllerPlayer = nextState.players.find(p => p.id === controllerId) as any;
    const commandZone = Array.isArray(controllerPlayer?.commandZone)
      ? [...controllerPlayer.commandZone]
      : Array.isArray(controllerPlayer?.command)
        ? [...controllerPlayer.command]
        : [];
    const graveyard = Array.isArray(controllerPlayer?.graveyard) ? [...controllerPlayer.graveyard] : [];
    const isCommanderCard = (card: any): boolean => {
      if ((card as any)?.isCommander === true || (card as any)?.commander === true) return true;
      const typeLine = getExecutorTypeLineLower(card);
      return (
        typeLine.includes('legendary') &&
        (typeLine.includes('creature') || typeLine.includes('planeswalker') || typeLine.includes('background'))
      );
    };
    const commanderCards = [
      ...commandZone.filter(isCommanderCard),
      ...graveyard.filter(isCommanderCard),
    ];
    const movedIds = new Set(
      commanderCards.map(card => String((card as any)?.id || '').trim()).filter(Boolean)
    );
    const hand = Array.isArray(controllerPlayer?.hand) ? [...controllerPlayer.hand] : [];
    const updatedHand = [...hand, ...commanderCards];
    const updatedCommandZone = commandZone.filter(
      card => !movedIds.has(String((card as any)?.id || '').trim())
    );
    const updatedGraveyard = graveyard.filter(
      card => !movedIds.has(String((card as any)?.id || '').trim())
    );
    const updatedPlayers = nextState.players.map(p =>
      p.id === controllerId
        ? ({
            ...(p as any),
            hand: updatedHand,
            commandZone: updatedCommandZone,
            command: updatedCommandZone,
            graveyard: updatedGraveyard,
          } as any)
        : p
    );
    return buildAppliedResult({
      state: { ...nextState, players: updatedPlayers as any } as GameState,
      log: [`${controllerId} puts ${commanderCards.length} commander(s) into hand from command zone and graveyard`],
      lastMovedCards: commanderCards,
    });
  }


  return undefined;
}
