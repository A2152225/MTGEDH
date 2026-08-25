// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: remaining applyMoveZoneStep selector guards starting at const guardArgsTopCard
// through tryApplyMoveZoneGuardsFromGraveyardSelectors (first leftover inline selector:
// if (parsedCommandZonePermanent && step.to === 'hand')).
// Public entry symbol: tryApplyMoveZoneGuardsFromCommandZonePermanentToHand.

import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';
import type { GameState, PlayerID } from '../../shared/src';
import {
  exileAllMatchingFromGraveyard,
  exileRandomCardFromHand,
  exileUpToCountFromHand,
  findCardsExiledWithSource,
  moveAllMatchingFromExile,
  moveAllMatchingFromHand,
  moveTargetedCardFromExile,
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
  putAllMatchingFromExileOntoBattlefield,
  putAllMatchingFromExileOntoBattlefieldWithController,
  putAllMatchingFromGraveyardOntoBattlefield,
  putAllMatchingFromGraveyardOntoBattlefieldWithController,
  putAllMatchingFromHandOntoBattlefield,
  putAllMatchingFromHandOntoBattlefieldWithController,
  returnAllMatchingFromGraveyardToHand,
} from './oracleIRExecutorZoneOps';
import {
  buildNoOpOptionalSingleTargetResult,
  findBoundCardZoneLocation,
  getChosenObjectIds,
  getTargetPlayerId,
  isUpToOneTargetReference,
  resolveUniqueChosenGraveyardTargetId,
} from './oracleIRExecutorMoveZoneReferenceResolvers';
import {
  getLibraryPlacement,
  requiresExplicitControllerOverride,
} from './oracleIRExecutorMoveZoneContextualCardResolvers';
import { resolveReferencedPlayerZoneFromSuffix } from './oracleIRExecutorReferenceUtils';
import { buildAppliedResult } from './oracleIRExecutorMoveZoneStepResultBuilders';
import { tryApplyMoveZoneGuardsFromTopCardLibraryOwnerId } from './oracleIRExecutorMoveZoneGuardsTopCardLibraryOwnerId';
import { tryApplyMoveZoneGuardsFromThisPermanentAndTheExiledCard } from './oracleIRExecutorMoveZoneGuardsThisPermanentAndTheExiledCard';
import { tryApplyMoveZoneGuardsFromAnotherFromGraveyard } from './oracleIRExecutorMoveZoneGuardsAnotherFromGraveyard';
import { tryApplyMoveZoneGuardsFromThatPile } from './oracleIRExecutorMoveZoneGuardsThatPile';
import { tryApplyMoveZoneGuardsFromAnyNumberFromYourHandFaceDown } from './oracleIRExecutorMoveZoneGuardsAnyNumberFromYourHandFaceDown';
import { tryApplyMoveZoneGuardsFromCommandZonePermanent } from './oracleIRExecutorMoveZoneGuardsCommandZonePermanent';
import { tryApplyMoveZoneGuardsFromUpToCountTotalMvFromYourGraveyard } from './oracleIRExecutorMoveZoneGuardsUpToCountTotalMvFromYourGraveyard';
import { tryApplyMoveZoneGuardsFromAnyNumberCreaturesTotalPower } from './oracleIRExecutorMoveZoneGuardsAnyNumberCreaturesTotalPower';
import { tryApplyMoveZoneGuardsFromNonlandCardFromIt } from './oracleIRExecutorMoveZoneGuardsNonlandCardFromIt';
import { tryApplyMoveZoneGuardsFromUpToFromSingleGraveyard } from './oracleIRExecutorMoveZoneGuardsUpToFromSingleGraveyard';
import { tryApplyMoveZoneGuardsFromThatCardReference } from './oracleIRExecutorMoveZoneGuardsThatCardReference';
import { tryApplyMoveZoneGuardsFromCompoundExileItAndEachPlayerReturnGyCreatures } from './oracleIRExecutorMoveZoneGuardsCompoundExileItAndEachPlayerReturnGyCreatures';
import { tryApplyMoveZoneGuardsFromTypedCardsRevealedThisWay } from './oracleIRExecutorMoveZoneGuardsTypedCardsRevealedThisWay';
import { tryApplyMoveZoneGuardsFromTheRestToGraveyard } from './oracleIRExecutorMoveZoneGuardsTheRestToGraveyard';
import { tryApplyMoveZoneGuardsFromOneOfThemSplit } from './oracleIRExecutorMoveZoneGuardsOneOfThemSplit';
import { tryApplyMoveZoneGuardsFromSingleTargetFromTargetPlayerExile } from './oracleIRExecutorMoveZoneGuardsSingleTargetFromTargetPlayerExile';
import { tryApplyMoveZoneGuardsFromTargetCountFromGraveyard } from './oracleIRExecutorMoveZoneGuardsTargetCountFromGraveyard';
import { tryApplyMoveZoneGuardsFromBothCards } from './oracleIRExecutorMoveZoneGuardsBothCards';
import { tryApplyMoveZoneGuardsFromExileGySplitTwoPiles } from './oracleIRExecutorMoveZoneGuardsExileGySplitTwoPiles';
import { tryApplyMoveZoneGuardsFromGraveyardSelectors } from './oracleIRExecutorMoveZoneGuardsFromGraveyard';

export function tryApplyMoveZoneGuardsFromCommandZonePermanentToHand(args: MoveZoneGuardArgs): MoveZoneStepHandlerResult | undefined {
  const {
    state,
    step,
    ctx,
    runtime,
    log,
    controllerId,
    effectiveWithCounters,
    battlefieldEntryOverrides,
    finalizeAppliedResult,
    attachmentResolution,
    sourcePermanentPower,
    boundTargetObjectId,
    linkedSourceId,
    parsedOneOfThemSplit,
    parsedOnePileSplit,
    contextualBoundCardZone,
    sourceCardZone,
    whatText,
    contextualBoundCardIds,
    topCardLibraryOwnerId,
    bottomCardLibraryOwnerId,
    parsedDiceBracketIt,
    zoneQueries,
    referenceQueries,
  } = args;
  // Rebound locally: the each-player loops below reassign it and then return unconditionally,
  // so the caller never observes the intermediate states.
  let nextState = args.nextState;
  const {
    parsedCommandZonePermanent,
    parsedRandomCardFromReferencedPossessiveHand,
    parsedSingleTargetFromReferencedPossessiveGraveyard,
    parsedSingleTargetFromTargetPlayerGraveyard,
    parsedSingleTargetFromTargetPlayerHand,
    parsedSingleTargetFromReferencedPossessiveHand,
  } = args.zoneQueries;
  const {
    parsedAllCardsExiledWithIt,
    parsedEachPlayersGy,
    parsedEachPlayersExile,
    parsedCountCardsFromEachPlayersHand,
    parsedEachPlayersHand,
  } = args.referenceQueries;


  const guardArgsTopCard: MoveZoneGuardArgs = {
    state,
    step,
    ctx,
    runtime,
    nextState,
    log,
    controllerId,
    effectiveWithCounters,
    battlefieldEntryOverrides,
    finalizeAppliedResult,
    attachmentResolution,
    sourcePermanentPower,
    boundTargetObjectId,
    linkedSourceId,
    parsedOneOfThemSplit,
    parsedOnePileSplit,
    contextualBoundCardZone,
    sourceCardZone,
    whatText,
    contextualBoundCardIds,
    topCardLibraryOwnerId,
    bottomCardLibraryOwnerId,
    parsedDiceBracketIt,
    zoneQueries,
    referenceQueries,
  };
  const guardResultTopCard1 = tryApplyMoveZoneGuardsFromTopCardLibraryOwnerId(guardArgsTopCard);
  if (guardResultTopCard1) return guardResultTopCard1;

  const guardArgsThisPermanentAndTheExiledCard: MoveZoneGuardArgs = {
    state,
    step,
    ctx,
    runtime,
    nextState,
    log,
    controllerId,
    effectiveWithCounters,
    battlefieldEntryOverrides,
    finalizeAppliedResult,
    attachmentResolution,
    sourcePermanentPower,
    boundTargetObjectId,
    linkedSourceId,
    parsedOneOfThemSplit,
    parsedOnePileSplit,
    contextualBoundCardZone,
    sourceCardZone,
    whatText,
    contextualBoundCardIds,
    topCardLibraryOwnerId,
    bottomCardLibraryOwnerId,
    parsedDiceBracketIt,
    zoneQueries,
    referenceQueries,
  };
  const guardResultThisPermanentAndTheExiledCard1 = tryApplyMoveZoneGuardsFromThisPermanentAndTheExiledCard(guardArgsThisPermanentAndTheExiledCard);
  if (guardResultThisPermanentAndTheExiledCard1) return guardResultThisPermanentAndTheExiledCard1;
  const guardResultThisPermanentAndTheExiledCard2 = tryApplyMoveZoneGuardsFromAnotherFromGraveyard(guardArgsThisPermanentAndTheExiledCard);
  if (guardResultThisPermanentAndTheExiledCard2) return guardResultThisPermanentAndTheExiledCard2;
  const guardResultThisPermanentAndTheExiledCard3 = tryApplyMoveZoneGuardsFromThatPile(guardArgsThisPermanentAndTheExiledCard);
  if (guardResultThisPermanentAndTheExiledCard3) return guardResultThisPermanentAndTheExiledCard3;
  const guardResultThisPermanentAndTheExiledCard4 = tryApplyMoveZoneGuardsFromAnyNumberFromYourHandFaceDown(guardArgsThisPermanentAndTheExiledCard);
  if (guardResultThisPermanentAndTheExiledCard4) return guardResultThisPermanentAndTheExiledCard4;
  if (parsedCommandZonePermanent && step.to === 'hand') {
    const controllerPlayer = nextState.players.find(p => p.id === controllerId) as any;
    const commandZone = Array.isArray(controllerPlayer?.commandZone)
      ? [...controllerPlayer.commandZone]
      : Array.isArray(controllerPlayer?.command)
        ? [...controllerPlayer.command]
        : [];
    const sourceId = String(ctx.sourceId || '').trim();
    const preferred = getChosenObjectIds(ctx);
    const whatText = String((step.what as any)?.text || '').trim().toLowerCase();
    let card = commandZone.find((entry: any) => {
      const cardId = String(entry?.id || '').trim();
      if (whatText === 'this permanent') {
        return cardId === sourceId || cardId === 'cmd-source-self' || cardId.startsWith('cmd-source');
      }
      if (whatText === 'your commander' || whatText === 'a commander you own from the command zone') {
        return (
          (entry as any)?.isCommander === true ||
          (entry as any)?.commander === true ||
          /commander/i.test(String(entry?.type_line || entry?.card?.type_line || ''))
        );
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
    const hand = Array.isArray(controllerPlayer?.hand) ? [...controllerPlayer.hand] : [];
    const updatedPlayers = nextState.players.map(p =>
      p.id === controllerId
        ? ({
            ...(p as any),
            hand: [...hand, card],
            commandZone: kept,
            command: kept,
          } as any)
        : p
    );
    return buildAppliedResult({
      state: { ...nextState, players: updatedPlayers as any } as GameState,
      log: [`${controllerId} puts ${cardId} from command zone into hand`],
      lastMovedCards: [card],
    });
  }

  const guardArgs: MoveZoneGuardArgs = {
    state,
    step,
    ctx,
    runtime,
    nextState,
    log,
    controllerId,
    effectiveWithCounters,
    battlefieldEntryOverrides,
    finalizeAppliedResult,
    attachmentResolution,
    sourcePermanentPower,
    boundTargetObjectId,
    linkedSourceId,
    parsedOneOfThemSplit,
    parsedOnePileSplit,
    contextualBoundCardZone,
    sourceCardZone,
    whatText,
    contextualBoundCardIds,
    topCardLibraryOwnerId,
    bottomCardLibraryOwnerId,
    parsedDiceBracketIt,
    zoneQueries,
    referenceQueries,
  };
  const guardResult1 = tryApplyMoveZoneGuardsFromCommandZonePermanent(guardArgs);
  if (guardResult1) return guardResult1;
  const guardResult2 = tryApplyMoveZoneGuardsFromUpToCountTotalMvFromYourGraveyard(guardArgs);
  if (guardResult2) return guardResult2;
  const guardResult3 = tryApplyMoveZoneGuardsFromAnyNumberCreaturesTotalPower(guardArgs);
  if (guardResult3) return guardResult3;
  const guardResult4 = tryApplyMoveZoneGuardsFromNonlandCardFromIt(guardArgs);
  if (guardResult4) return guardResult4;
  const guardResult5 = tryApplyMoveZoneGuardsFromUpToFromSingleGraveyard(guardArgs);
  if (guardResult5) return guardResult5;
  const guardResult6 = tryApplyMoveZoneGuardsFromThatCardReference(guardArgs);
  if (guardResult6) return guardResult6;
  if (parsedRandomCardFromReferencedPossessiveHand && step.to === 'exile') {
    const whatText = String((step.what as any)?.text || step.raw || '');
    const referencedZone = resolveReferencedPlayerZoneFromSuffix(nextState, ctx, whatText);
    const targetPlayerId = String(referencedZone?.playerId || '').trim() as PlayerID;
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const result = exileRandomCardFromHand(nextState, targetPlayerId, getChosenObjectIds(ctx));
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`Exiled random hand card: ${step.raw}`],
      movedCards: result.movedCards,
    });
  }

  const guardArgsCompoundExile: MoveZoneGuardArgs = {
    state,
    step,
    ctx,
    runtime,
    nextState,
    log,
    controllerId,
    effectiveWithCounters,
    battlefieldEntryOverrides,
    finalizeAppliedResult,
    attachmentResolution,
    sourcePermanentPower,
    boundTargetObjectId,
    linkedSourceId,
    parsedOneOfThemSplit,
    parsedOnePileSplit,
    contextualBoundCardZone,
    sourceCardZone,
    whatText,
    contextualBoundCardIds,
    topCardLibraryOwnerId,
    bottomCardLibraryOwnerId,
    parsedDiceBracketIt,
    zoneQueries,
    referenceQueries,
  };
  const guardResultCompoundExile1 = tryApplyMoveZoneGuardsFromCompoundExileItAndEachPlayerReturnGyCreatures(guardArgsCompoundExile);
  if (guardResultCompoundExile1) return guardResultCompoundExile1;
  const guardResultCompoundExile2 = tryApplyMoveZoneGuardsFromTypedCardsRevealedThisWay(guardArgsCompoundExile);
  if (guardResultCompoundExile2) return guardResultCompoundExile2;
  const guardResultCompoundExile3 = tryApplyMoveZoneGuardsFromTheRestToGraveyard(guardArgsCompoundExile);
  if (guardResultCompoundExile3) return guardResultCompoundExile3;
  if (parsedAllCardsExiledWithIt) {
    const linkedSourceId = String(ctx.sourceId || '').trim();
    if (!linkedSourceId) {
      return {
        applied: false,
        message: `Skipped move zone (linked exile source unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const matches = findCardsExiledWithSource(nextState, linkedSourceId, { cardType: 'any' });
    if (matches.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No linked exiled cards matched: ${step.raw}`],
      });
    }

    let workingState = nextState;
    const combinedLog: string[] = [];
    let movedPermanentIds: string[] = [];
    for (const match of matches) {
      const result = moveTargetedCardFromExile(
        workingState,
        match.playerId,
        match.cardId,
        'any',
        step.to === 'battlefield' ? 'battlefield' : step.to,
        step.to === 'battlefield' && step.battlefieldController?.kind === 'you'
          ? controllerId
          : step.to === 'battlefield' && step.battlefieldController?.kind === 'owner_of_moved_cards'
            ? match.playerId
            : undefined,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        undefined,
        battlefieldEntryOverrides
      );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedPermanentIds = movedPermanentIds.concat(result.movedPermanentIds || []);
    }

    return buildAppliedResult({
      state: workingState,
      log: combinedLog,
      ...(movedPermanentIds.length > 0 ? { movedPermanentIds } : {}),
    });
  }

  const guardArgsOneOfThemSplit: MoveZoneGuardArgs = {
    state,
    step,
    ctx,
    runtime,
    nextState,
    log,
    controllerId,
    effectiveWithCounters,
    battlefieldEntryOverrides,
    finalizeAppliedResult,
    attachmentResolution,
    sourcePermanentPower,
    boundTargetObjectId,
    linkedSourceId,
    parsedOneOfThemSplit,
    parsedOnePileSplit,
    contextualBoundCardZone,
    sourceCardZone,
    whatText,
    contextualBoundCardIds,
    topCardLibraryOwnerId,
    bottomCardLibraryOwnerId,
    parsedDiceBracketIt,
    zoneQueries,
    referenceQueries,
  };
  const guardResultOneOfThemSplit1 = tryApplyMoveZoneGuardsFromOneOfThemSplit(guardArgsOneOfThemSplit);
  if (guardResultOneOfThemSplit1) return guardResultOneOfThemSplit1;
  if (parsedSingleTargetFromReferencedPossessiveGraveyard) {
    const whatText = String((step.what as any)?.text || step.raw || '');
    const referencedZone = resolveReferencedPlayerZoneFromSuffix(nextState, ctx, whatText);
    const targetPlayerId = String(referencedZone?.playerId || '').trim() as PlayerID;
    const targetObjectId =
      (targetPlayerId
        ? resolveUniqueChosenGraveyardTargetId(
            nextState,
            targetPlayerId,
            parsedSingleTargetFromReferencedPossessiveGraveyard,
            ctx,
            runtime,
            ctx.sourceName,
            sourcePermanentPower
          )
        : '') ||
      boundTargetObjectId;
    const libraryPlacement = getLibraryPlacement(step);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    if (!targetObjectId) {
      if (isUpToOneTargetReference(step.what)) return buildNoOpOptionalSingleTargetResult(nextState, step);
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield' && !(step.to === 'library' && libraryPlacement)) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (step.to === 'battlefield' && requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result = moveTargetedCardFromGraveyard(
      nextState,
      targetPlayerId,
      targetObjectId,
      parsedSingleTargetFromReferencedPossessiveGraveyard,
      step.to === 'library' ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom') : step.to,
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? targetPlayerId
          : controllerId
        : undefined,
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
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            targetPlayerId,
            zone: 'graveyard',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromTargetPlayerGraveyard) {
    const targetPlayerId = getTargetPlayerId(ctx);
    const targetObjectId =
      (targetPlayerId
        ? resolveUniqueChosenGraveyardTargetId(
            nextState,
            targetPlayerId,
            parsedSingleTargetFromTargetPlayerGraveyard,
            ctx,
            runtime,
            ctx.sourceName,
            sourcePermanentPower
          )
        : '') ||
      boundTargetObjectId;
    const libraryPlacement = getLibraryPlacement(step);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    if (!targetObjectId) {
      if (isUpToOneTargetReference(step.what)) return buildNoOpOptionalSingleTargetResult(nextState, step);
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield' && !(step.to === 'library' && libraryPlacement)) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (step.to === 'battlefield' && requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result = moveTargetedCardFromGraveyard(
      nextState,
      targetPlayerId,
      targetObjectId,
      parsedSingleTargetFromTargetPlayerGraveyard,
      step.to === 'library' ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom') : step.to,
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? targetPlayerId
          : controllerId
        : undefined,
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
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            targetPlayerId,
            zone: 'graveyard',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromTargetPlayerHand) {
    const targetPlayerId = getTargetPlayerId(ctx);
    const targetObjectId = boundTargetObjectId;
    if (!targetPlayerId || !targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'graveyard' && step.to !== 'exile' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (step.to === 'battlefield' && requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result = moveTargetedCardFromHand(
      nextState,
      targetPlayerId,
      targetObjectId,
      parsedSingleTargetFromTargetPlayerHand.cardType,
      step.to,
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? targetPlayerId
          : controllerId
        : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      battlefieldEntryOverrides
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            targetPlayerId,
            zone: 'hand',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromReferencedPossessiveHand) {
    const whatText = String((step.what as any)?.text || step.raw || '');
    const referencedZone = resolveReferencedPlayerZoneFromSuffix(nextState, ctx, whatText);
    const targetPlayerId = String(referencedZone?.playerId || '').trim() as PlayerID;
    const targetObjectId = boundTargetObjectId;
    if (!targetPlayerId || !targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'graveyard' && step.to !== 'exile' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (step.to === 'battlefield' && requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result = moveTargetedCardFromHand(
      nextState,
      targetPlayerId,
      targetObjectId,
      parsedSingleTargetFromReferencedPossessiveHand.cardType,
      step.to,
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? targetPlayerId
          : controllerId
        : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      battlefieldEntryOverrides
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            targetPlayerId,
            zone: 'hand',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  const guardArgsSingleTargetFromTargetPlayerExile: MoveZoneGuardArgs = {
    state,
    step,
    ctx,
    runtime,
    nextState,
    log,
    controllerId,
    effectiveWithCounters,
    battlefieldEntryOverrides,
    finalizeAppliedResult,
    attachmentResolution,
    sourcePermanentPower,
    boundTargetObjectId,
    linkedSourceId,
    parsedOneOfThemSplit,
    parsedOnePileSplit,
    contextualBoundCardZone,
    sourceCardZone,
    whatText,
    contextualBoundCardIds,
    topCardLibraryOwnerId,
    bottomCardLibraryOwnerId,
    parsedDiceBracketIt,
    zoneQueries,
    referenceQueries,
  };
  const guardResultSingleTargetFromTargetPlayerExile1 = tryApplyMoveZoneGuardsFromSingleTargetFromTargetPlayerExile(guardArgsSingleTargetFromTargetPlayerExile);
  if (guardResultSingleTargetFromTargetPlayerExile1) return guardResultSingleTargetFromTargetPlayerExile1;
  const guardResultSingleTargetFromTargetPlayerExile2 = tryApplyMoveZoneGuardsFromTargetCountFromGraveyard(guardArgsSingleTargetFromTargetPlayerExile);
  if (guardResultSingleTargetFromTargetPlayerExile2) return guardResultSingleTargetFromTargetPlayerExile2;
  const guardArgsBothCards: MoveZoneGuardArgs = {
    state,
    step,
    ctx,
    runtime,
    nextState,
    log,
    controllerId,
    effectiveWithCounters,
    battlefieldEntryOverrides,
    finalizeAppliedResult,
    attachmentResolution,
    sourcePermanentPower,
    boundTargetObjectId,
    linkedSourceId,
    parsedOneOfThemSplit,
    parsedOnePileSplit,
    contextualBoundCardZone,
    sourceCardZone,
    whatText,
    contextualBoundCardIds,
    topCardLibraryOwnerId,
    bottomCardLibraryOwnerId,
    parsedDiceBracketIt,
    zoneQueries,
    referenceQueries,
  };
  const guardResultBothCards1 = tryApplyMoveZoneGuardsFromBothCards(guardArgsBothCards);
  if (guardResultBothCards1) return guardResultBothCards1;
  const guardResultBothCards2 = tryApplyMoveZoneGuardsFromExileGySplitTwoPiles(guardArgsBothCards);
  if (guardResultBothCards2) return guardResultBothCards2;
  if (parsedEachPlayersGy) {
    if (step.to !== 'exile' && step.to !== 'hand' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const combinedMoved: any[] = [];
    for (const player of (nextState.players || []) as any[]) {
      const result =
        step.to === 'hand'
          ? returnAllMatchingFromGraveyardToHand(nextState, player.id, parsedEachPlayersGy.cardType)
          : step.to === 'battlefield'
            ? step.battlefieldController?.kind === 'you'
              ? putAllMatchingFromGraveyardOntoBattlefieldWithController(
                  nextState,
                  player.id,
                  controllerId,
                  parsedEachPlayersGy.cardType,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters
                )
              : putAllMatchingFromGraveyardOntoBattlefield(
                  nextState,
                  player.id,
                  parsedEachPlayersGy.cardType,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters
                )
            : exileAllMatchingFromGraveyard(nextState, player.id, parsedEachPlayersGy.cardType, {
                colorsAnyOf: parsedEachPlayersGy.colorsAnyOf,
                putIntoGraveyardThisTurn: parsedEachPlayersGy.putIntoGraveyardThisTurn,
                currentTurn: Number((nextState as any)?.turn ?? (ctx as any)?.currentTurn ?? 3),
              });
      nextState = result.state;
      log.push(...result.log);
      if ('moved' in result && Array.isArray(result.moved) && result.moved.length > 0) {
        combinedMoved.push(...result.moved);
      }
    }

    return buildAppliedResult({
      state: nextState,
      log,
      ...(combinedMoved.length > 0 ? { movedCards: combinedMoved } : {}),
    }, ctx);
  }

  if (parsedEachPlayersExile) {
    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    for (const player of (nextState.players || []) as any[]) {
      const result =
        step.to === 'hand'
          ? moveAllMatchingFromExile(nextState, player.id, parsedEachPlayersExile.cardType, 'hand')
          : step.to === 'graveyard'
            ? moveAllMatchingFromExile(nextState, player.id, parsedEachPlayersExile.cardType, 'graveyard')
            : step.battlefieldController?.kind === 'you'
              ? putAllMatchingFromExileOntoBattlefieldWithController(
                  nextState,
                  player.id,
                  controllerId,
                  parsedEachPlayersExile.cardType,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters
                )
              : putAllMatchingFromExileOntoBattlefield(
                  nextState,
                  player.id,
                  parsedEachPlayersExile.cardType,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters
                );
      nextState = result.state;
      log.push(...result.log);
    }

    return { applied: true, state: nextState, log };
  }

  if (parsedCountCardsFromEachPlayersHand && step.to === 'exile') {
    const preferredIds = getChosenObjectIds(ctx);
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedCards: any[] = [];
    for (const player of (workingState.players || []) as any[]) {
      const playerId = String(player?.id || '').trim() as PlayerID;
      if (!playerId) continue;
      const playerPreferred = preferredIds.filter(id => {
        const location = findBoundCardZoneLocation(workingState, id);
        return location?.zone === 'hand' && location.playerId === playerId;
      });
      const result = exileUpToCountFromHand(
        workingState,
        playerId,
        parsedCountCardsFromEachPlayersHand.count,
        parsedCountCardsFromEachPlayersHand.cardType,
        playerPreferred
      );
      workingState = result.state;
      combinedLog.push(...result.log);
      movedCards.push(...result.movedCards);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Each player exiled cards from hand: ${step.raw}`],
      movedCards,
    });
  }

  if (parsedEachPlayersHand) {
    if (step.to !== 'exile' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    for (const player of (nextState.players || []) as any[]) {
      const result =
        step.to === 'battlefield'
          ? step.battlefieldController?.kind === 'you'
          ? putAllMatchingFromHandOntoBattlefieldWithController(
                nextState,
                player.id,
                controllerId,
                parsedEachPlayersHand.cardType,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters
              )
            : putAllMatchingFromHandOntoBattlefield(
                nextState,
                player.id,
                parsedEachPlayersHand.cardType,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters
              )
          : moveAllMatchingFromHand(nextState, player.id, parsedEachPlayersHand.cardType, step.to);
      nextState = result.state;
      log.push(...result.log);
    }

    return { applied: true, state: nextState, log };
  }

  const guardArgsFromGraveyard: MoveZoneGuardArgs = {
    state,
    step,
    ctx,
    runtime,
    nextState,
    log,
    controllerId,
    effectiveWithCounters,
    battlefieldEntryOverrides,
    finalizeAppliedResult,
    attachmentResolution,
    sourcePermanentPower,
    boundTargetObjectId,
    linkedSourceId,
    parsedOneOfThemSplit,
    parsedOnePileSplit,
    contextualBoundCardZone,
    sourceCardZone,
    whatText,
    contextualBoundCardIds,
    topCardLibraryOwnerId,
    bottomCardLibraryOwnerId,
    parsedDiceBracketIt,
    zoneQueries,
    referenceQueries,
  };
  const guardResultFromGraveyard1 = tryApplyMoveZoneGuardsFromGraveyardSelectors(guardArgsFromGraveyard);
  if (guardResultFromGraveyard1) return guardResultFromGraveyard1;


  return undefined;
}
