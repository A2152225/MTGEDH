// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: the applyMoveZoneStep selector guards starting at if (parsedDiceBracketIt && (step.to === 'library' || step.to === 'hand')) {
// Public entry symbol: tryApplyMoveZoneGuardsFromDiceBracketIt.

import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';
import type { GameState, PlayerID } from '../../shared/src';
import { moveBattlefieldPermanentsByIdToOwnersLibraries, moveBattlefieldPermanentsByIdToOwnersHands } from './oracleIRExecutorBattlefieldOps';
import {
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
  moveTargetedCardFromExile,
  parseMoveZoneTheCardFromYourGraveyard,
  parseMoveZoneUpToXLandsFromHandAndOrGraveyard,
  parseMoveZoneTypedCardFromAmongThem,
  shuffleSourcePermanentAndGraveyardIntoLibrary,
  cardMatchesMoveZoneSingleTargetCriteria,
  shufflePlayerHandAndGraveyardIntoLibrary,
  shufflePlayerGraveyardIntoLibrary,
  shuffleTypedCardsFromPlayerGraveyardIntoLibrary,
  cardMatchesType,
  parseMoveZoneExileItFromTheirGraveyardWithStash,
} from './oracleIRExecutorZoneOps';
import { findBoundCardZoneLocation, getChosenObjectIds, getTargetPlayerId } from './oracleIRExecutorMoveZoneReferenceResolvers';
import {
  getLibraryPlacement,
  getSacrificedCreaturePowerFromCtx,
  moveContextualCardToDestination,
  resolveAmongThemCriteriaWithX,
  resolveContextualCardIdsInZones,
} from './oracleIRExecutorMoveZoneContextualCardResolvers';
import { buildAppliedResult, shuffleCardArray } from './oracleIRExecutorMoveZoneStepResultBuilders';
import { tryApplyMoveZoneLinkedExileBulkStep } from './oracleIRExecutorMoveZoneLinkedExileProjection';
import { isSelfBattlefieldReference, resolveSelfBattlefieldPermanentId } from './oracleIRExecutorMoveZonePermanentSelectors';

export function tryApplyMoveZoneGuardsFromDiceBracketIt(args: MoveZoneGuardArgs): MoveZoneStepHandlerResult | undefined {
  const { state, step, ctx, runtime, nextState, log, controllerId, effectiveWithCounters, battlefieldEntryOverrides, finalizeAppliedResult, attachmentResolution, boundTargetObjectId, sourceCardZone, whatText, parsedDiceBracketIt } = args;
  const {
    parsedShuffleGyIntoLibrary,
    parsedYourGraveyardAndHand,
    parsedAllPermanentsYouOwn,
  } = args.zoneQueries;
  const {
    parsedShuffleSourceArtifactAndGraveyard,
  } = args.referenceQueries;

  if (parsedDiceBracketIt && (step.to === 'library' || step.to === 'hand')) {
    const targetId =
      boundTargetObjectId ||
      String(
        ctx.targetCreatureId ||
          ctx.selectorContext?.targetCreatureId ||
          ctx.selectorContext?.combatOpponentCreatureId ||
          'bf-opponent-creature'
      ).trim();
    const targetIsOnBattlefield = ((nextState.battlefield || []) as any[]).some(
      (permanent: any) => String(permanent?.id || '').trim() === targetId,
    );
    if (targetIsOnBattlefield) {
      if (step.to === 'hand') {
        const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, [targetId]);
        return finalizeAppliedResult(result);
      }
      const placement = getLibraryPlacement(step) || 'bottom';
      const result = moveBattlefieldPermanentsByIdToOwnersLibraries(nextState, [targetId], placement || 'bottom');
      return finalizeAppliedResult({
        applied: true,
        state: result.state,
        log: result.log.length > 0 ? result.log : [`Moved target to library: ${step.raw}`],
      });
    }
  }

  if (parsedAllPermanentsYouOwn && step.to === 'library') {
    const eachOwnerOwnsTheirOwn =
      parsedAllPermanentsYouOwn === 'they_own' || step.who?.kind === 'each_player';
    const playerIds: PlayerID[] = eachOwnerOwnsTheirOwn
      ? ((nextState.players || []) as any[])
          .map((player: any) => String(player?.id || '').trim())
          .filter(Boolean)
      : [controllerId];

    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedCardSnapshots: any[] = [];
    const movedCountByPlayer: Record<string, number> = {};

    for (const playerId of playerIds) {
      const ownedPermanents = ((workingState.battlefield || []) as any[]).filter(
        (perm: any) => String(perm?.owner || perm?.ownerId || '').trim() === playerId
      );
      const totalOwnedCount = ownedPermanents.length;
      movedCountByPlayer[playerId] = totalOwnedCount;

      const allOwnedIds = ownedPermanents
        .map((perm: any) => String(perm?.id || '').trim())
        .filter(Boolean);

      for (const perm of ownedPermanents) {
        if ((perm as any)?.isToken === true) continue;
        movedCardSnapshots.push({
          ...((perm as any)?.card || {}),
          id: String((perm as any)?.id || (perm as any)?.card?.id || '').trim(),
          owner: playerId,
          ownerId: playerId,
        });
      }

      if (allOwnedIds.length > 0) {
        // Tokens cease to exist rather than entering the library; the helper already
        // skips writing token cards into the library while still clearing them from
        // the battlefield when their id is included here.
        const moveResult = moveBattlefieldPermanentsByIdToOwnersLibraries(workingState, allOwnedIds, 'bottom');
        workingState = moveResult.state;
        combinedLog.push(...moveResult.log);
      }

      const player = workingState.players.find((entry: any) => entry.id === playerId) as any;
      if (player) {
        const library = shuffleCardArray(Array.isArray(player.library) ? player.library : []);
        workingState = {
          ...(workingState as any),
          players: workingState.players.map((entry: any) =>
            entry.id === playerId ? { ...entry, library } : entry
          ),
        } as GameState;
      }

      combinedLog.push(`${playerId} shuffled ${totalOwnedCount} owned permanent(s) into their library`);
    }

    const totalMovedCount = Object.values(movedCountByPlayer).reduce((sum, count) => sum + count, 0);
    const singlePlayerAmount = playerIds.length === 1 ? movedCountByPlayer[playerIds[0]] ?? 0 : totalMovedCount;

    return buildAppliedResult(
      {
        state: workingState,
        log:
          combinedLog.length > 0
            ? combinedLog
            : [`Shuffled owned permanents into library: ${step.raw}`],
        movedCards: movedCardSnapshots,
        lastReferenceAmount: singlePlayerAmount,
        lastMovedCountByPlayer: movedCountByPlayer,
        fromZone: 'battlefield',
        toZone: 'library',
      },
      ctx,
    );
  }

  if (parsedShuffleSourceArtifactAndGraveyard && step.to === 'library') {
    const sourceId = String(ctx.sourceId || '').trim();
    return finalizeAppliedResult({
      applied: true,
      state: shuffleSourcePermanentAndGraveyardIntoLibrary(nextState, controllerId, sourceId),
      log: [`Shuffled source permanent and graveyard into library: ${step.raw}`],
    });
  }

  if (parsedYourGraveyardAndHand && step.to === 'library') {
    const result = shufflePlayerHandAndGraveyardIntoLibrary(nextState, controllerId);
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`Shuffled hand and graveyard into library: ${step.raw}`],
    });
  }

  if (parsedShuffleGyIntoLibrary && step.to === 'library') {
    if (typeof parsedShuffleGyIntoLibrary === 'object' && parsedShuffleGyIntoLibrary.cardType) {
      return finalizeAppliedResult({
        applied: true,
        state: shuffleTypedCardsFromPlayerGraveyardIntoLibrary(
          nextState,
          controllerId,
          parsedShuffleGyIntoLibrary.cardType
        ),
        log: [`Shuffled typed graveyard cards into library: ${step.raw}`],
      });
    }
    return finalizeAppliedResult({
      applied: true,
      state: shufflePlayerGraveyardIntoLibrary(nextState, controllerId),
      log: [`Shuffled graveyard into library: ${step.raw}`],
    });
  }

  const linkedExileBulkEarly = tryApplyMoveZoneLinkedExileBulkStep({
    nextState,
    step,
    ctx,
    controllerId,
    effectiveWithCounters,
    battlefieldEntryOverrides,
    finalizeAppliedResult,
  });
  if (linkedExileBulkEarly) return linkedExileBulkEarly;

  if (parseMoveZoneTheCardFromYourGraveyard(step.what as any) && step.to === 'battlefield') {
    const preferredIds = getChosenObjectIds(ctx);
    const cardId =
      preferredIds.find(id => {
        const player = nextState.players.find(p => p.id === controllerId) as any;
        const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
        return graveyard.some((card: any) => String(card?.id || '').trim() === id);
      }) ||
      (() => {
        const player = nextState.players.find(p => p.id === controllerId) as any;
        const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
        return String(graveyard[0]?.id || '').trim() || undefined;
      })();
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No graveyard card to return: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
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

  if (parseMoveZoneExileItFromTheirGraveyardWithStash(step.what as any) && step.to === 'exile') {
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

  const parsedAmongThoseCardsEarly = parseMoveZoneTypedCardFromAmongThem(step.what as any, step);
  const amongThoseCardsSingleBfOnly =
    parsedAmongThoseCardsEarly &&
    step.to === 'battlefield' &&
    parsedAmongThoseCardsEarly.maxCount !== -1 &&
    !parsedAmongThoseCardsEarly.anyNumber &&
    !parsedAmongThoseCardsEarly.bfLibraryBottomSplit &&
    !parsedAmongThoseCardsEarly.bfHandSplit &&
    !parsedAmongThoseCardsEarly.handGySplit;
  if (amongThoseCardsSingleBfOnly) {
    const effectiveCriteria = resolveAmongThemCriteriaWithX(parsedAmongThoseCardsEarly, ctx, nextState, runtime);
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, [
      'library',
      'exile',
      'hand',
      'graveyard',
    ]);
    const matchingIds = candidateIds.filter(cardId => {
      const location = findBoundCardZoneLocation(nextState, cardId);
      if (!location) return false;
      const player = nextState.players.find(p => p.id === location.playerId) as any;
      const zoneCards = Array.isArray(player?.[location.zone]) ? player[location.zone] : [];
      const card = zoneCards.find((entry: any) => String(entry?.id || '').trim() === cardId);
      return card && cardMatchesMoveZoneSingleTargetCriteria(card, effectiveCriteria);
    });
    const preferred = getChosenObjectIds(ctx);
    const cardId = preferred.find(id => matchingIds.includes(id)) || matchingIds[0] || '';
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No matching among-those-cards target: ${step.raw}`] });
    }
    const location = findBoundCardZoneLocation(nextState, cardId);
    if (!location) {
      return buildAppliedResult({ state: nextState, log: [`No matching among-those-cards target: ${step.raw}`] });
    }
    const result =
      location.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(
            nextState,
            location.playerId,
            cardId,
            effectiveCriteria,
            'battlefield',
            controllerId,
            step.entersTapped,
            step.entersFaceDown,
            effectiveWithCounters,
            undefined,
            undefined,
            battlefieldEntryOverrides,
            undefined,
            { ctx, stepKind: 'move_zone' }
          )
        : moveContextualCardToDestination(nextState, location, cardId, 'battlefield', {
            controllerId,
            ctx,
            cardType: effectiveCriteria.cardType,
            entersTapped: step.entersTapped,
            entersFaceDown: step.entersFaceDown,
            withCounters: effectiveWithCounters,
            battlefieldEntryOverrides,
          });
    if (result.kind === 'halted') {
      return { applied: true, state: nextState, log: [] };
    }
    if (result.kind === 'impossible') {
      return buildAppliedResult({ state: nextState, log: [`Among-those-cards target unavailable: ${step.raw}`] });
    }
    return finalizeAppliedResult(result);
  }

  const parsedUpToLandsHandEarly = parseMoveZoneUpToXLandsFromHandAndOrGraveyard(step.what as any);
  if (parsedUpToLandsHandEarly && step.to === 'battlefield') {
    const maxCount = parsedUpToLandsHandEarly.xReferenceSacrificedCreaturePower
      ? Math.max(0, getSacrificedCreaturePowerFromCtx(ctx, runtime) ?? Number(ctx.xValue ?? ctx.referenceAmount ?? 0))
      : Math.max(0, Number(ctx.xValue ?? ctx.referenceAmount ?? 1));
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const hand = Array.isArray(player?.hand) ? [...player.hand] : [];
    const graveyard = parsedUpToLandsHandEarly.fromHandOnly
      ? []
      : Array.isArray(player?.graveyard)
        ? [...player.graveyard]
        : [];
    const preferred = new Set(getChosenObjectIds(ctx).map(id => String(id || '').trim()).filter(Boolean));
    const landIds: string[] = [];
    for (const card of [...hand, ...graveyard]) {
      if (landIds.length >= maxCount) break;
      const cardId = String(card?.id || '').trim();
      if (!cardId || !cardMatchesType(card, 'land')) continue;
      if (preferred.size > 0 && !preferred.has(cardId)) continue;
      if (!landIds.includes(cardId)) landIds.push(cardId);
    }
    if (preferred.size > 0 && landIds.length === 0) {
      for (const card of [...hand, ...graveyard]) {
        if (landIds.length >= maxCount) break;
        const cardId = String(card?.id || '').trim();
        if (!cardId || !cardMatchesType(card, 'land') || landIds.includes(cardId)) continue;
        landIds.push(cardId);
      }
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    let movedBattlefieldIds: string[] = [];
    const entersTapped =
      step.entersTapped === true || /\btapped\b/i.test(String(step.toRaw || step.raw || ''));
    for (const cardId of landIds) {
      const fromHand = hand.some((card: any) => String(card?.id || '').trim() === cardId);
      const result = fromHand
        ? moveTargetedCardFromHand(
            workingState,
            controllerId,
            cardId,
            'land',
            'battlefield',
            controllerId,
            entersTapped,
            step.entersFaceDown,
            effectiveWithCounters,
            undefined,
            battlefieldEntryOverrides
          )
        : moveTargetedCardFromGraveyard(
            workingState,
            controllerId,
            cardId,
            { cardType: 'land' },
            'battlefield',
            controllerId,
            entersTapped,
            step.entersFaceDown,
            effectiveWithCounters,
            undefined,
            undefined,
            battlefieldEntryOverrides
          );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds = movedBattlefieldIds.concat(result.movedPermanentIds || []);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved land cards from hand: ${step.raw}`],
      ...(movedBattlefieldIds.length > 0 ? { movedBattlefieldPermanentIds: movedBattlefieldIds } : {}),
    });
  }

  if (step.to === 'battlefield' && isSelfBattlefieldReference(whatText)) {
    const selfBattlefieldPermanentId = resolveSelfBattlefieldPermanentId(nextState, whatText, ctx);
    if (selfBattlefieldPermanentId) {
      return buildAppliedResult({
        state: nextState,
        log: [`Self permanent on battlefield: ${step.raw}`],
        movedBattlefieldPermanentIds: [selfBattlefieldPermanentId],
      });
    }
    if (sourceCardZone) {
      const battlefieldControllerId =
        step.battlefieldController?.kind === 'you' ? controllerId : sourceCardZone.playerId;
      const sourceToBattlefieldResult =
        sourceCardZone.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(
              nextState,
              sourceCardZone.playerId,
              sourceCardZone.cardId,
              { cardType: 'any' },
              'battlefield',
              battlefieldControllerId,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
              undefined,
              battlefieldEntryOverrides
            )
          : sourceCardZone.zone === 'hand'
            ? moveTargetedCardFromHand(
                nextState,
                sourceCardZone.playerId,
                sourceCardZone.cardId,
                'any',
                'battlefield',
                battlefieldControllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
                battlefieldEntryOverrides
              )
            : moveTargetedCardFromExile(
                nextState,
                sourceCardZone.playerId,
                sourceCardZone.cardId,
                'any',
                'battlefield',
                battlefieldControllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
                battlefieldEntryOverrides
              );
      if (sourceToBattlefieldResult.kind === 'applied') {
        return finalizeAppliedResult(sourceToBattlefieldResult);
      }
    }
  }


  return undefined;
}
