import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import { parseMoveZoneWhatZoneQueries } from './oracleIRExecutorMoveZoneWhatParsersZoneQueries';
import { parseMoveZoneWhatReferenceQueries } from './oracleIRExecutorMoveZoneWhatParsersReferenceQueries';
import { buildMoveZoneBattlefieldEntryOverrides } from './oracleIRExecutorMoveZoneGuardArgs';
import { tryApplyMoveZoneGuardsFromOneOfThemSplit } from './oracleIRExecutorMoveZoneGuardsOneOfThemSplit';
import { tryApplyMoveZoneGuardsFromTopCardLibraryOwnerId } from './oracleIRExecutorMoveZoneGuardsTopCardLibraryOwnerId';
import { tryApplyMoveZoneGuardsFromDiceBracketIt } from './oracleIRExecutorMoveZoneGuardsDiceBracketIt';
import { tryApplyMoveZoneGuardsFromGraveyardSelectors } from './oracleIRExecutorMoveZoneGuardsFromGraveyard';
import { tryApplyMoveZoneGuardsFromThisPermanentAndTheExiledCard } from './oracleIRExecutorMoveZoneGuardsThisPermanentAndTheExiledCard';
import { tryApplyMoveZoneGuardsFromAnotherFromGraveyard } from './oracleIRExecutorMoveZoneGuardsAnotherFromGraveyard';
import { tryApplyMoveZoneGuardsFromThatPile } from './oracleIRExecutorMoveZoneGuardsThatPile';
import { tryApplyMoveZoneGuardsFromAnyNumberFromYourHandFaceDown } from './oracleIRExecutorMoveZoneGuardsAnyNumberFromYourHandFaceDown';
import { tryApplyMoveZoneGuardsFromSingleTargetFromTargetPlayerExile } from './oracleIRExecutorMoveZoneGuardsSingleTargetFromTargetPlayerExile';
import { tryApplyMoveZoneGuardsFromTargetCountFromGraveyard } from './oracleIRExecutorMoveZoneGuardsTargetCountFromGraveyard';
import { tryApplyMoveZoneGuardsFromBothCards } from './oracleIRExecutorMoveZoneGuardsBothCards';
import { tryApplyMoveZoneGuardsFromExileGySplitTwoPiles } from './oracleIRExecutorMoveZoneGuardsExileGySplitTwoPiles';
import { tryApplyMoveZoneGuardsFromCompoundExileItAndEachPlayerReturnGyCreatures } from './oracleIRExecutorMoveZoneGuardsCompoundExileItAndEachPlayerReturnGyCreatures';
import { tryApplyMoveZoneGuardsFromTypedCardsRevealedThisWay } from './oracleIRExecutorMoveZoneGuardsTypedCardsRevealedThisWay';
import { tryApplyMoveZoneGuardsFromTheRestToGraveyard } from './oracleIRExecutorMoveZoneGuardsTheRestToGraveyard';
import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';
import { tryApplyMoveZoneGuardsFromCommandZonePermanent } from './oracleIRExecutorMoveZoneGuardsCommandZonePermanent';
import { tryApplyMoveZoneGuardsFromUpToCountTotalMvFromYourGraveyard } from './oracleIRExecutorMoveZoneGuardsUpToCountTotalMvFromYourGraveyard';
import { tryApplyMoveZoneGuardsFromAnyNumberCreaturesTotalPower } from './oracleIRExecutorMoveZoneGuardsAnyNumberCreaturesTotalPower';
import { tryApplyMoveZoneGuardsFromNonlandCardFromIt } from './oracleIRExecutorMoveZoneGuardsNonlandCardFromIt';
import { tryApplyMoveZoneGuardsFromUpToFromSingleGraveyard } from './oracleIRExecutorMoveZoneGuardsUpToFromSingleGraveyard';
import { tryApplyMoveZoneGuardsFromThatCardReference } from './oracleIRExecutorMoveZoneGuardsThatCardReference';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  collectMostRecentLedgerCards,
  collectRevealedThisWayCardsLedgerFirst,
} from './oracleIRLedgerCardAccess';
import { parseSimpleBattlefieldSelector } from './oracleIRExecutorBattlefieldParser';
import { isUndecidedLibraryPlacementChoice } from './oracleIRExecutorMoveZoneLibraryPlacementChoice';
import {
} from './oracleIRExecutorPlayerUtils';
import { resolveReferencedPlayerZone, resolveReferencedPlayerZoneFromSuffix } from './oracleIRExecutorReferenceUtils';
import { evaluateConditionalWrapperCondition } from './oracleIRExecutorConditionalStepSupport';
import {
  getExecutorTypeLineLower,
} from './oracleIRExecutorPermanentUtils';
import {
  moveBattlefieldPermanentsByIdToOwnersLibraries,
  moveBattlefieldPermanentsByIdToOwnersHands,
  permanentMatchesSelector,
} from './oracleIRExecutorBattlefieldOps';
import type { OracleIrBattlefieldEntryContext } from './oracleIRExecutorBattlefieldEntryCommit';
import {
  exileAllMatchingFromGraveyard,
  moveAllMatchingFromExile,
  moveAllMatchingFromHand,
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
  moveTargetedCardFromExile,
  findCardsExiledWithSource,
  exileUpToCountFromHand,
  parseMoveZoneBottomCardFromLibrary,
  type AmongThemMoveCriteria,
  type SimpleCardType,
  shuffleCardsFromHandIntoLibrary,
  exileRandomCardFromHand,
  parseMoveZoneContextualThemSplit,
  putAllMatchingFromExileOntoBattlefield,
  putAllMatchingFromExileOntoBattlefieldWithController,
  putAllMatchingFromGraveyardOntoBattlefield,
  putAllMatchingFromGraveyardOntoBattlefieldWithController,
  putAllMatchingFromHandOntoBattlefield,
  putAllMatchingFromHandOntoBattlefieldWithController,
  returnAllMatchingFromGraveyardToHand,
} from './oracleIRExecutorZoneOps';

import type {
  MoveZoneRuntime,
  MoveZoneStepHandlerResult,
  StepApplyResult,
} from './oracleIRExecutorMoveZoneStepTypes';

export type { MoveZoneStepHandlerResult };

import {
  buildNoOpOptionalSingleTargetResult,
  collectSourceCardZoneMatches,
  findBoundCardZoneLocation,
  getBottomCardLibraryOwnerId,
  getBoundTargetObjectId,
  getChosenObjectIds,
  getControllerId,
  getSourcePermanentLoyalty,
  getSourcePermanentPower,
  getTargetObjectId,
  getTargetPlayerId,
  getTopCardLibraryOwnerId,
  inferPreferredSourceCardZones,
  isAnotherTargetReference,
  isContextualBoundCardReference,
  isContextualBoundCardsReference,
  isSourcePermanentOnBattlefield,
  isUpToOneTargetReference,
  pickDeterministicGraveyardTargetId,
  readPlayerOrZoneCards,
  resolveEnchantedCreaturePermanentId,
  resolveSourceCardZoneLocation,
  resolveUniqueChosenGraveyardTargetId,
} from './oracleIRExecutorMoveZoneReferenceResolvers';

import {
  getLibraryPlacement,
  getOneOfThemSplitKind,
  getOnePileSplitKind,
  isOnePileReference,
  isOneReference,
  requiresExplicitControllerOverride,
  resolveContextualBoundCardZone,
  resolveContextualCardIdsInZones,
  resolveContextualRestPoolIdsInZones,
  type ContextualThemSplitKind,
  type OneOfThemSplitKind,
  type OnePileSplitKind,
} from './oracleIRExecutorMoveZoneContextualCardResolvers';

import {
  annotateExiledCardsWithSource,
  buildAppliedResult,
  setActiveMoveZoneStep,
} from './oracleIRExecutorMoveZoneStepResultBuilders';

import {
  projectLinkedExileStaticText,
} from './oracleIRExecutorMoveZoneLinkedExileProjection';

import {
  applyBattlefieldEntryCharacteristicsToState,
  isSelfBattlefieldReference,
  resolveBattlefieldAttachment,
  resolveSelfBattlefieldPermanentId,
} from './oracleIRExecutorMoveZonePermanentSelectors';

import { tryApplyMoveZoneEarlyGuardSteps } from './oracleIRExecutorMoveZoneEarlyGuardSteps';

export function applyMoveZoneStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ctx: OracleIRExecutionContext,
  runtime?: MoveZoneRuntime
): MoveZoneStepHandlerResult {
  if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'graveyard' && step.to !== 'battlefield' && step.to !== 'library' && step.to !== 'command') {
    return {
      applied: false,
      message: `Skipped move zone (unsupported destination): ${step.raw}`,
      reason: 'unsupported_destination',
    };
  }

  setActiveMoveZoneStep(step);
  try {

  const earlyGuardResult = tryApplyMoveZoneEarlyGuardSteps(state, step, ctx);
  if (earlyGuardResult) return earlyGuardResult;

  let nextState = state;
  const log: string[] = [];
  const controllerId = getControllerId(ctx);
  let effectiveWithCounters = step.withCounters;
  let effectiveBattlefieldAddTypes = step.battlefieldAddTypes;
  let effectiveBattlefieldAddColors = step.battlefieldAddColors;
  const battlefieldEntryOverrides = buildMoveZoneBattlefieldEntryOverrides(step);

  if (step.withCounters && step.withCountersCondition) {
    const conditionEvaluation = evaluateConditionalWrapperCondition({
      condition: step.withCountersCondition,
      nextState,
      controllerId,
      ctx,
      lastActionOutcome: null,
      lastMovedCards: Array.isArray(runtime?.lastMovedCards)
        ? runtime.lastMovedCards
        : Array.isArray(ctx.lastMovedCards)
          ? ctx.lastMovedCards
          : undefined,
      step,
    });

    if (conditionEvaluation === null) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported condition): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (conditionEvaluation === false) {
      effectiveWithCounters = undefined;
    }
  }

  if ((step.battlefieldAddTypes || step.battlefieldAddColors) && step.battlefieldCharacteristicsCondition) {
    const conditionEvaluation = evaluateConditionalWrapperCondition({
      condition: step.battlefieldCharacteristicsCondition,
      nextState,
      controllerId,
      ctx,
      lastActionOutcome: null,
    });

    if (conditionEvaluation === null) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported battlefield-entry characteristic condition): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (conditionEvaluation === false) {
      effectiveBattlefieldAddTypes = undefined;
      effectiveBattlefieldAddColors = undefined;
    }
  }

  const finalizeAppliedResult = (result:
    | {
        readonly kind?: 'applied';
        readonly applied?: true;
        readonly state: GameState;
        readonly log: readonly string[];
        readonly movedCards?: readonly any[];
        readonly movedPermanentIds?: readonly string[];
        readonly movedBattlefieldPermanentIds?: readonly string[];
        readonly lastMovedBattlefieldPermanentIds?: readonly string[];
        readonly lastMovedCards?: readonly any[];
      }
    | { readonly kind: 'halted' | 'impossible' | 'player_choice_required' }
  ): StepApplyResult => {
    if (!('state' in result)) {
      return buildAppliedResult({ state: nextState, log: [] }, ctx);
    }
    let finalizedState =
      step.to === 'battlefield'
        ? applyBattlefieldEntryCharacteristicsToState(
            result.state,
            result.movedPermanentIds,
            effectiveBattlefieldAddTypes,
            effectiveBattlefieldAddColors
          )
        : result.state;
    let nextMovedCards = result.movedCards;

    if (step.to === 'exile') {
      const annotated = annotateExiledCardsWithSource({
        state: finalizedState,
        movedCards: result.movedCards,
        ctx,
      });
      finalizedState = annotated.state;
      nextMovedCards = annotated.movedCards;
      finalizedState = projectLinkedExileStaticText({
        state: finalizedState,
        movedCards: nextMovedCards,
        ctx,
      });
    }

    return buildAppliedResult({ ...result, state: finalizedState, movedCards: nextMovedCards }, ctx);
  };

  const attachmentResolution = resolveBattlefieldAttachment(nextState, step, ctx);

  if (attachmentResolution.kind === 'unsupported') {
    return {
      applied: false,
      message: `Skipped move zone (unsupported attachment target): ${step.raw}`,
      reason: 'unsupported_selector',
    };
  }

  if (attachmentResolution.kind === 'player_choice_required') {
    return {
      applied: false,
      message: `Skipped move zone (needs player attachment choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          destination: step.to,
          attachmentSelector: attachmentResolution.selector,
        },
      },
    };
  }

  if (attachmentResolution.kind === 'impossible') {
    return {
      applied: false,
      message: `Skipped move zone (attachment target unavailable): ${step.raw}`,
      reason: 'impossible_action',
      options: {
        persist: false,
        metadata: {
          destination: step.to,
          attachmentSelector: attachmentResolution.selector,
        },
      },
    };
  }

  const whatTextCommander = String((step.what as any)?.text || '').trim().toLowerCase();
  if (whatTextCommander === 'each commander target player controls' && step.to === 'command') {
    const targetPlayerId = getTargetPlayerId(ctx) || ('p2' as PlayerID);
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

  if (((step.to === 'hand') || step.to === 'library') && (step.what as any)?.kind === 'raw') {
    const whatText = String((step.what as any).text || '').trim();
    const referencesGraveyardCardOrigin =
      /\bfrom (?:your|a|an|target(?: player'?s| opponent'?s)?|their|each player'?s) graveyard\b/i.test(
        whatText
      ) || /\b(?:target|up to (?:one|two|three|\w+)) (?:[\w/-]+\s+)*cards? from graveyards?\b/i.test(
        whatText.toLowerCase()
      );
    const directBattlefieldTargetIdEarly = getTargetObjectId(ctx);
    const directLibraryPlacement =
      step.to === 'library'
        ? getLibraryPlacement(step) || (directBattlefieldTargetIdEarly ? 'bottom' : '')
        : '';
    const directBattlefieldTargetId = getTargetObjectId(ctx);
    const battlefieldTargetLikeReference =
      !referencesGraveyardCardOrigin &&
      (/^(?:up to one\s+)?(?:(?:another|other)\s+)?target\b/i.test(whatText) ||
        /^(?:it|him|her|that card|that creature|that permanent)$/i.test(whatText));
    if (directBattlefieldTargetId && battlefieldTargetLikeReference) {
      const hasDirectBattlefieldTarget = ((nextState.battlefield || []) as any[]).some(
        perm => String((perm as any)?.id || '').trim() === directBattlefieldTargetId
      );
      if (hasDirectBattlefieldTarget) {
        const result =
          step.to === 'hand'
            ? moveBattlefieldPermanentsByIdToOwnersHands(nextState, [directBattlefieldTargetId])
            : moveBattlefieldPermanentsByIdToOwnersLibraries(
                nextState,
                [directBattlefieldTargetId],
                directLibraryPlacement === 'top' ? 'top' : 'bottom'
              );
        return finalizeAppliedResult(result);
      }
    }

    const selfBattlefieldPermanentId = resolveSelfBattlefieldPermanentId(nextState, whatText, ctx);
    if (selfBattlefieldPermanentId) {
      const result =
        step.to === 'hand'
          ? moveBattlefieldPermanentsByIdToOwnersHands(nextState, [selfBattlefieldPermanentId])
          : moveBattlefieldPermanentsByIdToOwnersLibraries(
              nextState,
              [selfBattlefieldPermanentId],
              directLibraryPlacement === 'top' ? 'top' : 'bottom'
            );
      return finalizeAppliedResult(result);
    }

    if (String(whatText || '').trim().toLowerCase() === 'enchanted creature') {
      const enchantedPermanentId = resolveEnchantedCreaturePermanentId(nextState, ctx);
      if (enchantedPermanentId) {
        const result =
          step.to === 'hand'
            ? moveBattlefieldPermanentsByIdToOwnersHands(nextState, [enchantedPermanentId])
            : moveBattlefieldPermanentsByIdToOwnersLibraries(
                nextState,
                [enchantedPermanentId],
                directLibraryPlacement === 'top' ? 'top' : 'bottom'
              );
        return finalizeAppliedResult(result);
      }
    }

    if (
      step.to === 'hand' &&
      whatText &&
      !isSelfBattlefieldReference(whatText) &&
      !/\b(from|card|cards)\b/i.test(whatText)
    ) {
      const selector = parseSimpleBattlefieldSelector(step.what as any);
      if (selector) {
        const battlefield = [...((nextState.battlefield || []) as any[])];
        const matches = battlefield.filter(perm => permanentMatchesSelector(perm, selector, ctx));
        const preferred = getChosenObjectIds(ctx);
        let targetIds = matches.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean);
        if (/^(?:a|an)\s+/i.test(whatText) && targetIds.length > 1) {
          const preferredMatches = targetIds.filter(id => preferred.includes(id));
          targetIds = preferredMatches.length > 0 ? preferredMatches.slice(0, 1) : targetIds.slice(0, 1);
        }
        const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds);
        return finalizeAppliedResult(result);
      }
    }
  }

  const zoneQueries = parseMoveZoneWhatZoneQueries(step);
  const referenceQueries = parseMoveZoneWhatReferenceQueries(step);
  const {
    parsedFromGraveyard,
    parsedShuffleGyIntoLibrary,
    parsedYourGraveyardAndHand,
    parsedCountFromGraveyard,
    parsedTargetCountFromGraveyard,
    parsedCountCardsFromTargetPlayerHand,
    parsedAlternateCostColorFromHand,
    parsedSingleTargetFromAnyGraveyard,
    parsedSingleTargetFromTargetPlayerGraveyard,
    parsedSingleTargetFromReferencedPossessiveGraveyard,
    parsedSingleTargetFromReferencedPossessiveHand,
    parsedRandomCardFromReferencedPossessiveHand,
    parsedSingleTargetFromTargetPlayerHand,
    parsedSingleTargetFromTargetPlayerExile,
    parsedSingleTargetFromYourGraveyard,
    parsedRandomSingleFromYourGraveyard,
    parsedSameNamedFromYourGraveyard,
    parsedSingleTargetFromYourHand,
    parsedTypedCardFromYourHand,
    parsedTheCardsFromYourHand,
    parsedTheCardsFromTargetOpponentHand,
    parsedCardFromAGraveyard,
    parsedTargetCreatureGyAndBf,
    parsedThisArtifactAndAllGraveyards,
    parsedCountFromHand,
    parsedUpToTargetCountFromGraveyard,
    parsedUpToTargetCountFromHand,
    parsedUpToTargetCountFromTargetPlayerGraveyard,
    parsedMostVotesCards,
    parsedThatManyFromBottomOfLibrary,
    parsedThatManyFromTopOfLibrary,
    parsedThatManyFromTopOfLibraryFaceDown,
    parsedCardFromOutsideGame,
    parsedUpToFromOutsideGame,
    parsedOneOrMoreCreaturesFromGy,
    parsedOwnedNonlandPermanentYouOwn,
    parsedAllPermanentsYouOwn,
    parsedShuffleAnyNumberTargetFromTargetPlayerGy,
    parsedExileXTargetFromTargetPlayerGy,
    parsedForEachOpponentUpToOneNonlandBounce,
    parsedAnyNumberOpponentOwnedLandsFromExile,
    parsedCreatureFromOwnersGraveyardUnderOwner,
    parsedEnchantedCreatureAndAurasToHand,
    parsedExileXTargetCreatureCardsFromGraveyards,
    parsedOneTwoOrThreeTargetCreatureCardsFromGraveyards,
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
    parsedUpToOneOtherTargetCreatureBfOrGy,
    parsedAllOtherCardsRevealedThisWay,
    parsedTheRevealedCards,
    parsedAllOfThemWithThatName,
    parsedThatPile,
    parsedAllCreaturesOfThatColor,
    parsedTargetCreatureMilledThisTurn,
    parsedCountTargetBattlefieldBounce,
    parsedAllOtherTappedCreatures,
    parsedAllTappedCreatures,
    parsedHalfCreaturesTheyControl,
    parsedInstantOrSorceryGyOrFlashbackExile,
    parsedCompoundOpponentRandomExile,
    parsedUpToCountOfThem,
    parsedUpToThatManyInstantOrSorcery,
    parsedAnyNumberArtifactCreatureTotalMv,
    parsedUpToCountTotalMvFromYourGraveyard,
    parsedAnyNumberTargetNonlandTotalMv,
    parsedCreatureYouControl,
    parsedLesserMvThanDiedFromGy,
    parsedRandomCardFromTargetPlayerHand,
    parsedCompoundExileItAndEachPlayerReturnGyCreatures,
    parsedMassBattlefieldCreatureBounce,
    parsedAllColoredPermanentsToHand,
    parsedAllNoncreatureNonlandPermanentsToHand,
    parsedUnlessPaysManaFromStep,
    parsedAnyNumberFromYourHand,
    parsedAnyNumberCardsFromYourHand,
    parsedAnyNumberFromYourHandFaceDown,
    parsedAllCardsDestroyedThisWayFromYourGraveyard,
    parsedCompoundArtifactCreatureLandGyHandsExile,
    parsedAllCardsFromAllHandsAndGraveyards,
    parsedCreatureFromHandSharingTypeWithEachTappedThisWay,
    parsedEachCreatureThatDealtDamageThisTurn,
    parsedCountTypedCards,
    parsedCreatureYouDontControlLowestToughness,
    parsedThatManyCreatureCardsFromYourGraveyard,
    parsedEachCreatureExcludingListedTypes,
    parsedAllCardsFromAllOpponentsHandsAndGraveyards,
    parsedCreatureHandTotalPowerToughnessLte,
    parsedTargetNonlandSameNameMassExile,
    parsedUpToOneNonlandAmongThemRestLibraryBottom,
    parsedAllSpellsAndAbilitiesFromStackIncludingThis,
    parsedAnyNumberDistinctManaValuesFromYourGraveyard,
    parsedTotalMvCreaturesFromGraveyards,
    parsedCraftExiledCard,
    parsedUpToReferenceCountTargetPermanents,
    parsedTopCardsFromTargetPlayerLibrary,
    parsedAllCommandersCommandZoneGy,
    parsedAllCommandersFromCommandZone,
    parsedCommandZonePermanent,
    parsedMyraExileInstantSorcery,
    parsedSharesTypeFromAmongThem,
    parsedSingleCardRevealedThisWay,
    parsedContextualThemSplit,
    parsedAnyNumberThosePermanentCards,
    parsedThoseCreatureCards,
    parsedThemAntecedent,
    parsedReturnContextualThemToBattlefield,
    parsedUpToCreaturesExcludingTypeLineTerm,
    parsedSingleRevealedRestToGy,
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
  } = zoneQueries;
  const {
    parsedAnyNumberCreaturesTotalPower,
    parsedUpToThatManyFromTheirGy,
    parsedUpToOneEachCardTypeFromBoundGy,
    parsedCreatureFromCardsMilledThisWay,
    parsedCreatureHandOrCommandLesserMv,
    parsedOneOfThemBfTappedOtherHand,
    parsedOneOfThemToGraveyard,
    parsedOneOfThemToBattlefield,
    parsedAnotherFromGraveyard,
    parsedAnotherCardFromGraveyard,
    parsedOrTypedCardsFromGraveyard,
    parsedCardFromTargetPlayerHand,
    parsedOpponentOwnedFromExile,
    parsedSingleCardFromHand,
    parsedThemFromGraveyard,
    parsedTheCardsExiledWithIt,
    parsedAllCardsTheyExiledThisWay,
    parsedNonlandCardFromIt,
    parsedThisCardFromExile,
    parsedThatSpell,
    parsedThisSpellBuybackToHand,
    parsedUpToBattlefieldBounce,
    parsedCardFromAmongThoseCards,
    parsedAllExiledWithThisPermanent,
    parsedCreatureCardExiledWithSource,
    parsedCreatureCardExiledThisWay,
    parsedAllFromLibrary,
    parsedCountOfThemAtRandom,
    parsedUpToTypedCardsFromAmongThem,
    parsedPutAllTypedAndFromAmongThem,
    parsedOneOnTopRestOnBottomLibrary,
    parsedOneOfThemToHand,
    parsedTypedCardFromYourGraveyard,
    parsedOneOfThemHandBounce,
    parsedUpToFromSingleGraveyard,
    parsedUpToFromGraveyards,
    parsedAllCardsExiledWithIt,
    parsedTheRestToGraveyard,
    parsedTheRestToLibrary,
    parsedTheRestToHand,
    parsedTheRestToBattlefield,
    parsedTheOtherToHand,
    parsedTheOtherToLibrary,
    parsedTheOtherToBattlefield,
    parsedRestOfExiledCards,
    parsedTypedCardFromAmongThem,
    parsedAnyNumberMountainsYouControl,
    parsedAnyNumberBasicLandSubtypeYouControl,
    parsedReturnThisCardAndUpToOneOther,
    parsedRevealedThisWayRest,
    parsedAllCardsMilledThisWay,
    parsedAllCardsDiscardedThisWay,
    parsedOpponentChoicePermanentToHand,
    parsedAllAdventureCardsFromMilledCards,
    parsedAllNonManaActivatedCreaturesFromMilledCards,
    parsedCardFromChosenPile,
    parsedAllCardsFromPileOfYourChoice,
    parsedAllCreaturesBlockingOrBlockedByTargetCreature,
    parsedThoseLands,
    parsedOpponentChoiceFromTargetPlayerGy,
    parsedCompoundBattlefieldAndGraveyardMassReturn,
    parsedShuffleSourceArtifactAndGraveyard,
    parsedAllExiledWithNamedSource,
    parsedAllExiledCardsWithCounter,
    parsedAnyNumberFromYourGraveyard,
    parsedCountExiledWithSource,
    parsedThatCardReference,
    parsedThatCardToBattlefield,
    parsedTypedCardFromHandOrGraveyard,
    parsedAdventureCardThatPlayerOwnsFromExile,
    parsedMvLessThanReferenceFromHand,
    parsedAmongThemRestToLibrary,
    parsedTypedCardsRevealedThisWay,
    parsedRevealedThisWayRestToLibrary,
    parsedTheChosenCards,
    parsedOneOfTheChosenCards,
    parsedLastChosenCard,
    parsedOtherChosenCards,
    parsedChosenCardsRestToLibrary,
    parsedEachPlayerGyNotPutThisWay,
    parsedShuffleTypedCardsOfThatType,
    parsedTopTypedCardFromTargetPlayerGy,
    parsedTopTypedCardFromYourGy,
    parsedEachCreatureMvXFromGy,
    parsedTypedCardFromTargetPlayerGy,
    parsedTypedCardFromAmongMilledCards,
    parsedAnyNumberAurasFromYourGy,
    parsedNamedCardReference,
    parsedSingleTargetFromYourExile,
    parsedSingleTargetFromLinkedExile,
    parsedTheExiledCard,
    parsedThisPermanentAndTheExiledCard,
    parsedTargetFaceUpExiledCard,
    parsedFromHand,
    parsedFromExile,
    parsedAllFromLinkedExile,
    parsedEachPlayersGy,
    parsedSingleCardFromEachPlayersGy,
    parsedThisCreatureAndTargetYouControl,
    parsedThisCreatureAndAnotherTargetCreature,
    parsedThisPermanentAndAnotherTargetCreature,
    parsedPutIntoGraveyardThisWay,
    parsedUpToCreatureCardsPutIntoGraveyardsThisWay,
    parsedThoseCardsNotPlayed,
    parsedTheNonlandCard,
    parsedTheNonlandCardRestToLibrary,
    parsedExiledThisWayNotCast,
    parsedReturnItAndSelf,
    parsedCompoundExileItAndReturnGy,
    parsedBothCards,
    parsedOneOfThoseDragons,
    parsedMorphCreatureFromHand,
    parsedCountTargetFromSingleGraveyard,
    parsedThisPermanentAndUpToFromSingleGy,
    parsedAurasAttachedToTargetPermanentYouOwn,
    parsedThisCreatureAndCombatantsToLibraryTop,
    parsedEachAttackingCreature,
    parsedAllCreatureTokens,
    parsedTargetCreatureOwnerLibraryChoice,
    parsedThisCardAndNamedFromGy,
    parsedThisCardAndTargetFromGy,
    parsedExileGySplitTwoPiles,
    parsedAnyNumberCardsTotalMvXFromGy,
    parsedEachPlayersHand,
    parsedCountCardsFromEachPlayersHand,
    parsedEachPlayersExile,
    parsedEachOpponentsGy,
    parsedEachOpponentsHand,
    parsedEachOpponentsExile,
    parsedTargetPlayerHand,
    parsedAllTypedCardsTargetPlayerOwns,
    parsedTargetPlayerLibrary,
    parsedTargetPlayerExile,
    parsedTargetPlayerGy,
    parsedTargetPlayerHandAndGy,
    parsedTheCardFromYourGraveyard,
    parsedUpToXLandsHandGy,
  } = referenceQueries;
  const boundTargetObjectId = getBoundTargetObjectId(ctx, step, runtime);
  const sourcePermanentPower = getSourcePermanentPower(nextState, ctx);
  const contextualBoundCardIdsRaw = isContextualBoundCardsReference(step.what as any)
    ? resolveContextualCardIdsInZones(nextState, ctx, runtime, ['library', 'graveyard', 'hand', 'exile'])
    : [];
  let contextualBoundCardIds = contextualBoundCardIdsRaw;
  if (contextualBoundCardIds.length > 0) {
    const preferredIds = getChosenObjectIds(ctx);
    if (preferredIds.length > 0) {
      const preferred = new Set(preferredIds);
      const filtered = contextualBoundCardIds.filter((id) => preferred.has(id));
      if (filtered.length > 0) {
        contextualBoundCardIds = filtered;
      } else {
        const fromPreferred = preferredIds.filter((id) => Boolean(findBoundCardZoneLocation(nextState, id)));
        if (fromPreferred.length > 0) {
          contextualBoundCardIds = fromPreferred;
        }
      }
    }
  }
  const parsedOneOfThemSplit = getOneOfThemSplitKind(step);
  const parsedOnePileSplit = getOnePileSplitKind(step);
  // No branch below can settle "on your choice of the top or bottom" - the position is chosen on
  // resolution, so skip and let the resolution queue prompt rather than defaulting to top.
  if (isUndecidedLibraryPlacementChoice(step, ctx)) {
    return {
      applied: false,
      message: `Skipped move zone (library placement is a player choice): ${step.raw}`,
      reason: 'unsupported_destination',
    };
  }

  const contextualBoundCardZone = resolveContextualBoundCardZone(nextState, step, ctx, runtime);
  const sourceCardZone = resolveSourceCardZoneLocation(nextState, step.what as any, ctx, step.raw);
  const topCardLibraryOwnerId = getTopCardLibraryOwnerId(nextState, (step as any)?.what, ctx);
  const bottomCardLibraryOwnerId = getBottomCardLibraryOwnerId((step as any)?.what, ctx);
  const whatText = String((step.what as any)?.text || '').trim();
  const parsedDiceBracketIt =
    /^\d+(?:\s*-\s*\d+)?\s*\|\s*it$/i.test(whatText) || /^it$/i.test(whatText);
  const linkedSourceId = String(ctx.sourceId || '').trim();

  const guardArgsDiceBracketIt: MoveZoneGuardArgs = {
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
  const guardResultDiceBracketIt1 = tryApplyMoveZoneGuardsFromDiceBracketIt(guardArgsDiceBracketIt);
  if (guardResultDiceBracketIt1) return guardResultDiceBracketIt1;
  if (
    !parsedFromGraveyard &&
    !parsedShuffleSourceArtifactAndGraveyard &&
    !parsedShuffleGyIntoLibrary &&
    !parsedYourGraveyardAndHand &&
    !parsedCountFromGraveyard &&
    !parsedTargetCountFromGraveyard &&
    !parsedCountCardsFromTargetPlayerHand &&
    !parsedAlternateCostColorFromHand &&
    !parsedSingleTargetFromAnyGraveyard &&
    !parsedSingleTargetFromTargetPlayerGraveyard &&
    !parsedSingleTargetFromReferencedPossessiveGraveyard &&
    !parsedSingleTargetFromReferencedPossessiveHand &&
    !parsedRandomCardFromReferencedPossessiveHand &&
    !parsedSingleTargetFromTargetPlayerHand &&
    !parsedSingleTargetFromTargetPlayerExile &&
    !parsedSingleTargetFromYourGraveyard &&
    !parsedInstantOrSorceryGyOrFlashbackExile &&
    !parsedRandomSingleFromYourGraveyard &&
    !parsedSameNamedFromYourGraveyard &&
    !parsedSingleTargetFromYourHand &&
    !parsedTypedCardFromYourHand &&
    !parsedTheCardsFromYourHand &&
    !parsedTheCardsFromTargetOpponentHand &&
    !parsedCardFromAGraveyard &&
    !parsedTargetCreatureGyAndBf &&
    !parsedThisArtifactAndAllGraveyards &&
    !parsedCountFromHand &&
    !parsedUpToTargetCountFromGraveyard &&
    !parsedUpToTargetCountFromHand &&
    !parsedUpToTargetCountFromTargetPlayerGraveyard &&
    !parsedMostVotesCards &&
    !parsedThatManyFromBottomOfLibrary &&
    !parsedThatManyFromTopOfLibrary &&
    !parsedThatManyFromTopOfLibraryFaceDown &&
    !parsedCardFromOutsideGame &&
    !parsedUpToFromOutsideGame &&
    !parsedOneOrMoreCreaturesFromGy &&
    !parsedOwnedNonlandPermanentYouOwn &&
    !parsedShuffleAnyNumberTargetFromTargetPlayerGy &&
    !parsedExileXTargetFromTargetPlayerGy &&
    !parsedForEachOpponentUpToOneNonlandBounce &&
    !parsedAnyNumberOpponentOwnedLandsFromExile &&
    !parsedCreatureFromOwnersGraveyardUnderOwner &&
    !parsedEnchantedCreatureAndAurasToHand &&
    !parsedExileXTargetCreatureCardsFromGraveyards &&
    !parsedOneTwoOrThreeTargetCreatureCardsFromGraveyards &&
    !parsedSingleCardExiledWithIt &&
    !parsedDiscardedCardFromYourGy &&
    !parsedReturnThisVehicleToOwnersHand &&
    !parsedAnyNumberGyWithCardTypesAmong &&
    !parsedCloakCardFromHand &&
    !parsedUpToOneNoncreatureNonlandFromTargetPlayerGy &&
    !parsedMechtitanReturnExiledExceptSelf &&
    !parsedOneOfThemFromYourGraveyard &&
    !parsedExileItFromTheirGyWithStash &&
    !parsedOneOfThoseCardsWithThatNameToHand &&
    !parsedRandomFromEachOpponentGraveyard &&
    !parsedPutThatCardBfShuffleRestRevealed &&
    !parsedThemToOwnersGraveyard &&
    !parsedUpToOneOtherTargetCreatureBfOrGy &&
    !parsedAllOtherCardsRevealedThisWay &&
    !parsedTheRevealedCards &&
    !parsedAllOfThemWithThatName &&
    !parsedThatPile &&
    !parsedAllCreaturesOfThatColor &&
    !parsedTargetCreatureMilledThisTurn &&
    !parsedCountTargetBattlefieldBounce &&
    !parsedAllOtherTappedCreatures &&
    !parsedAllTappedCreatures &&
    !parsedHalfCreaturesTheyControl &&
    !parsedCompoundOpponentRandomExile &&
    !parsedUpToCountOfThem &&
    !parsedUpToThatManyInstantOrSorcery &&
    !parsedAnyNumberArtifactCreatureTotalMv &&
    !parsedAnyNumberTargetNonlandTotalMv &&
    !parsedCreatureYouControl &&
    !parsedLesserMvThanDiedFromGy &&
    !parsedRandomCardFromTargetPlayerHand &&
    !parsedCompoundExileItAndEachPlayerReturnGyCreatures &&
    !parsedMassBattlefieldCreatureBounce &&
    !parsedAllColoredPermanentsToHand &&
    !parsedAllNoncreatureNonlandPermanentsToHand &&
    !parsedAnyNumberFromYourHand &&
    !parsedAnyNumberCardsFromYourHand &&
    !parsedAnyNumberFromYourHandFaceDown &&
    !parsedAllCardsDestroyedThisWayFromYourGraveyard &&
    !parsedCompoundArtifactCreatureLandGyHandsExile &&
    !parsedAllCardsFromAllHandsAndGraveyards &&
    !parsedCreatureFromHandSharingTypeWithEachTappedThisWay &&
    !parsedEachCreatureThatDealtDamageThisTurn &&
    !parsedCountTypedCards &&
    !parsedCreatureYouDontControlLowestToughness &&
    !parsedThatManyCreatureCardsFromYourGraveyard &&
    !parsedEachCreatureExcludingListedTypes &&
    !parsedAllCardsFromAllOpponentsHandsAndGraveyards &&
    !parsedCreatureHandTotalPowerToughnessLte &&
    !parsedTargetNonlandSameNameMassExile &&
    !parsedUpToOneNonlandAmongThemRestLibraryBottom &&
    !parsedAllSpellsAndAbilitiesFromStackIncludingThis &&
    !parsedAnyNumberDistinctManaValuesFromYourGraveyard &&
    !parsedTotalMvCreaturesFromGraveyards &&
    !parsedCraftExiledCard &&
    !parsedUpToReferenceCountTargetPermanents &&
    !parsedTopCardsFromTargetPlayerLibrary &&
    !parsedAllCommandersCommandZoneGy &&
    !parsedAllCommandersFromCommandZone &&
    !parsedCommandZonePermanent &&
    !parsedMyraExileInstantSorcery &&
    !parsedSharesTypeFromAmongThem &&
    !parsedSingleCardRevealedThisWay &&
    !parsedContextualThemSplit &&
    !parsedAnyNumberThosePermanentCards &&
    !parsedThoseCreatureCards &&
    !parsedAnyNumberMountainsYouControl &&
    !parsedAnyNumberBasicLandSubtypeYouControl &&
    !parsedThemAntecedent &&
    !parsedReturnContextualThemToBattlefield &&
    !parsedUpToCreaturesExcludingTypeLineTerm &&
    !parsedSingleRevealedRestToGy &&
    !parsedShuffleSourceAndTarget &&
    !parsedUpToXFromAmongExiled &&
    !parsedAnyNumberSaddledToHand &&
    !parsedUpToXOtherBfOrGy &&
    !parsedEachOpponentCreatureToughnessX &&
    !parsedEachCreaturePowerOfChosenQuality &&
    !parsedTopLibraryFaceDownPerOpponent &&
    !parsedAllNamedThisPermanent &&
    !parsedCreatureExiledWithVehicle &&
    !parsedAnyNumberCyclingPermanents &&
    !parsedAnyNumberCreaturesTotalPower &&
    !parsedUpToThatManyFromTheirGy &&
    !parsedUpToOneEachCardTypeFromBoundGy &&
    !parsedCreatureFromCardsMilledThisWay &&
    !parsedCreatureHandOrCommandLesserMv &&
    !parsedOneOfThemBfTappedOtherHand &&
    !parsedOneOfThemToGraveyard &&
    !parsedOneOfThemToBattlefield &&
    !parsedCountOfThemAtRandom &&
    !parsedAnotherFromGraveyard &&
    !parsedAnotherCardFromGraveyard &&
    !parsedOrTypedCardsFromGraveyard &&
    !parsedCardFromTargetPlayerHand &&
    !parsedOpponentOwnedFromExile &&
    !parsedSingleCardFromHand &&
    !parsedThemFromGraveyard &&
    !parsedTheCardsExiledWithIt &&
    !parsedAllCardsTheyExiledThisWay &&
    !parsedNonlandCardFromIt &&
    !parsedThisCardFromExile &&
    !parsedThatSpell &&
    !parsedThisSpellBuybackToHand &&
    !parsedUpToBattlefieldBounce &&
    !parsedCardFromAmongThoseCards &&
    !parsedAllExiledWithThisPermanent &&
    !parsedCreatureCardExiledWithSource &&
    !parsedCreatureCardExiledThisWay &&
    !parsedAllFromLibrary &&
    !parsedUpToTypedCardsFromAmongThem &&
    !parsedPutAllTypedAndFromAmongThem &&
    !parsedOneOnTopRestOnBottomLibrary &&
    !parsedOneOfThemToHand &&
    !parsedTypedCardFromYourGraveyard &&
    !parsedOneOfThemHandBounce &&
    !parsedUpToFromSingleGraveyard &&
    !parsedUpToFromGraveyards &&
    !parsedAllCardsExiledWithIt &&
    !parsedTheRestToGraveyard &&
    !parsedTheRestToLibrary &&
    !parsedRestOfExiledCards &&
    !parsedTypedCardFromAmongThem &&
    !parsedReturnThisCardAndUpToOneOther &&
    !parsedRevealedThisWayRest &&
    !parsedAllCardsMilledThisWay &&
    !parsedAllCardsDiscardedThisWay &&
    !parsedOpponentChoicePermanentToHand &&
    !parsedAllAdventureCardsFromMilledCards &&
    !parsedAllNonManaActivatedCreaturesFromMilledCards &&
    !parsedCardFromChosenPile &&
    !parsedAllCardsFromPileOfYourChoice &&
    !parsedAllCreaturesBlockingOrBlockedByTargetCreature &&
    !parsedThoseLands &&
    !parsedOpponentChoiceFromTargetPlayerGy &&
    !parsedCompoundBattlefieldAndGraveyardMassReturn &&
    !parsedShuffleSourceArtifactAndGraveyard &&
    !parsedAllExiledWithNamedSource &&
    !parsedAllExiledCardsWithCounter &&
    !parsedAnyNumberFromYourGraveyard &&
    !parsedCountExiledWithSource &&
    !parsedThatCardReference &&
    !parsedTypedCardFromHandOrGraveyard &&
    !parsedAdventureCardThatPlayerOwnsFromExile &&
    !parsedMvLessThanReferenceFromHand &&
    !parsedAmongThemRestToLibrary &&
    !parsedTypedCardsRevealedThisWay &&
    !parsedRevealedThisWayRestToLibrary &&
    !parsedTheChosenCards &&
    !parsedOneOfTheChosenCards &&
    !parsedLastChosenCard &&
    !parsedOtherChosenCards &&
    !parsedChosenCardsRestToLibrary &&
    !parsedEachPlayerGyNotPutThisWay &&
    !parsedShuffleTypedCardsOfThatType &&
    !parsedTopTypedCardFromTargetPlayerGy &&
    !parsedTypedCardFromTargetPlayerGy &&
    !parsedTypedCardFromAmongMilledCards &&
    !parsedAnyNumberAurasFromYourGy &&
    !parsedNamedCardReference &&
    !parsedSingleTargetFromYourExile &&
    !parsedSingleTargetFromLinkedExile &&
    !parsedTheExiledCard &&
    !parsedThisPermanentAndTheExiledCard &&
    !parsedTargetFaceUpExiledCard &&
    !parsedOneOfThemSplit &&
    !parsedOnePileSplit &&
    !parsedFromHand &&
    !parsedFromExile &&
    !parsedAllFromLinkedExile &&
    !parsedEachPlayersGy &&
    !parsedSingleCardFromEachPlayersGy &&
    !parsedThisCreatureAndTargetYouControl &&
    !parsedThisCreatureAndAnotherTargetCreature &&
    !parsedThisPermanentAndAnotherTargetCreature &&
    !parsedPutIntoGraveyardThisWay &&
    !parsedUpToCreatureCardsPutIntoGraveyardsThisWay &&
    !parsedThoseCardsNotPlayed &&
    !parsedTheNonlandCard &&
    !parsedTheNonlandCardRestToLibrary &&
    !parsedExiledThisWayNotCast &&
    !parsedReturnItAndSelf &&
    !parsedCompoundExileItAndReturnGy &&
    !parsedBothCards &&
    !parsedOneOfThoseDragons &&
    !parsedMorphCreatureFromHand &&
    !parsedCountTargetFromSingleGraveyard &&
    !parsedThisPermanentAndUpToFromSingleGy &&
    !parsedEachPlayersHand &&
    !parsedCountCardsFromEachPlayersHand &&
    !parsedEachPlayersExile &&
    !parsedEachOpponentsGy &&
    !parsedEachOpponentsHand &&
    !parsedEachOpponentsExile &&
    !parsedTargetPlayerHand &&
    !parsedAllTypedCardsTargetPlayerOwns &&
    !parsedTargetPlayerLibrary &&
    !parsedTargetPlayerExile &&
    !parsedTargetPlayerGy &&
    !parsedTargetPlayerHandAndGy &&
    !parsedTheCardFromYourGraveyard &&
    !parsedUpToXLandsHandGy &&
    !parsedTheRestToHand &&
    !parsedTheRestToBattlefield &&
    !parsedTheOtherToHand &&
    !parsedTheOtherToLibrary &&
    !parsedTheOtherToBattlefield &&
    !parsedThatCardToBattlefield &&
    !parsedTopTypedCardFromYourGy &&
    !parsedEachCreatureMvXFromGy &&
    !parsedAurasAttachedToTargetPermanentYouOwn &&
    !parsedThisCreatureAndCombatantsToLibraryTop &&
    !parsedEachAttackingCreature &&
    !parsedAllCreatureTokens &&
    !parsedTargetCreatureOwnerLibraryChoice &&
    !parsedThisCardAndNamedFromGy &&
    !parsedThisCardAndTargetFromGy &&
    !parsedExileGySplitTwoPiles &&
    !parsedAnyNumberCardsTotalMvXFromGy &&
    contextualBoundCardIds.length === 0 &&
    !contextualBoundCardZone &&
    !sourceCardZone &&
    !topCardLibraryOwnerId &&
    !bottomCardLibraryOwnerId
  ) {
    return {
      applied: false,
      message: `Skipped move zone (unsupported selector): ${step.raw}`,
      reason: 'unsupported_selector',
    };
  }

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

  return {
    applied: false,
    message: `Skipped move zone (unsupported selector): ${step.raw}`,
    reason: 'unsupported_selector',
  };
  } finally {
    setActiveMoveZoneStep(undefined);
  }
}
