import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import { parseMoveZoneWhatZoneQueries } from './oracleIRExecutorMoveZoneWhatParsersZoneQueries';
import { parseMoveZoneWhatReferenceQueries } from './oracleIRExecutorMoveZoneWhatParsersReferenceQueries';
import { buildMoveZoneBattlefieldEntryOverrides } from './oracleIRExecutorMoveZoneGuardArgs';
import { applyChosenMoveZoneDestination } from './oracleIRExecutorMoveZoneChosenDestination';
import { tryApplyMoveZoneGuardsFromOneOfThemSplit } from './oracleIRExecutorMoveZoneGuardsOneOfThemSplit';
import { tryApplyMoveZoneGuardsFromTopCardLibraryOwnerId } from './oracleIRExecutorMoveZoneGuardsTopCardLibraryOwnerId';
import { tryApplyMoveZoneGuardsFromDiceBracketIt } from './oracleIRExecutorMoveZoneGuardsDiceBracketIt';
import { tryApplyMoveZoneGuardsFromCommandZonePermanentToHand } from './oracleIRExecutorMoveZoneGuardsCommandZonePermanentToHand';
import { tryApplyMoveZoneGuardsUnsupportedSelectorEarlyOut } from './oracleIRExecutorMoveZoneGuardsUnsupportedSelectorEarlyOut';
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
  moveStepShufflesIntoLibrary,
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
import { tryApplyMoveZoneSeventhFromTop } from './oracleIRExecutorMoveZoneSeventhFromTop';
import { tryApplyMoveZoneStackSpellToExile } from './oracleIRExecutorMoveZoneStackSpellToExile';

export function applyMoveZoneStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ctx: OracleIRExecutionContext,
  runtime?: MoveZoneRuntime
): MoveZoneStepHandlerResult {
  step = applyChosenMoveZoneDestination(step, ctx);
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

  const seventhFromTopResult = tryApplyMoveZoneSeventhFromTop(state, step, ctx);
  if (seventhFromTopResult) return seventhFromTopResult;

  const stackSpellToExileResult = tryApplyMoveZoneStackSpellToExile(state, step, ctx);
  if (stackSpellToExileResult) return stackSpellToExileResult;

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

    if (conditionEvaluation === null || conditionEvaluation === false) {
      // Rider like "if a Hero enters this way" is applied after the move, not as a
      // pre-filter. An unrecognized rider must not skip the mandatory zone change.
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
            ? moveBattlefieldPermanentsByIdToOwnersHands(nextState, [directBattlefieldTargetId], ctx)
            : moveBattlefieldPermanentsByIdToOwnersLibraries(
                nextState,
                [directBattlefieldTargetId],
                directLibraryPlacement === 'top' ? 'top' : 'bottom',
                { shuffle: moveStepShufflesIntoLibrary(step) },
              );
        return finalizeAppliedResult(result);
      }
    }

    const selfBattlefieldPermanentId = resolveSelfBattlefieldPermanentId(nextState, whatText, ctx);
    if (selfBattlefieldPermanentId) {
      const result =
        step.to === 'hand'
          ? moveBattlefieldPermanentsByIdToOwnersHands(nextState, [selfBattlefieldPermanentId], ctx)
          : moveBattlefieldPermanentsByIdToOwnersLibraries(
              nextState,
              [selfBattlefieldPermanentId],
              directLibraryPlacement === 'top' ? 'top' : 'bottom',
              { shuffle: moveStepShufflesIntoLibrary(step) },
            );
      return finalizeAppliedResult(result);
    }

    if (String(whatText || '').trim().toLowerCase() === 'enchanted creature') {
      const enchantedPermanentId = resolveEnchantedCreaturePermanentId(nextState, ctx);
      if (enchantedPermanentId) {
        const result =
          step.to === 'hand'
            ? moveBattlefieldPermanentsByIdToOwnersHands(nextState, [enchantedPermanentId], ctx)
            : moveBattlefieldPermanentsByIdToOwnersLibraries(
                nextState,
                [enchantedPermanentId],
                directLibraryPlacement === 'top' ? 'top' : 'bottom',
                { shuffle: moveStepShufflesIntoLibrary(step) },
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
        const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds, ctx);
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
  // "those creature cards" / "those permanents" etc.: keep only matching types from the reveal pile.
  if (contextualBoundCardIds.length > 0) {
    const boundWhat = String((step.what as any)?.text || (step.what as any)?.raw || '')
      .replace(/\u2019/g, "'")
      .trim()
      .toLowerCase();
    const typeFilter = /\bcreature cards?\b|\bcreatures\b/.test(boundWhat)
      ? 'creature'
      : /\bpermanent cards?\b|\bpermanents\b/.test(boundWhat)
        ? 'permanent'
        : null;
    if (typeFilter) {
      const pile = [
        ...(Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []),
        ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
        ...(Array.isArray((ctx as any).lastRevealedCards) ? (ctx as any).lastRevealedCards : []),
      ];
      const byId = new Map<string, any>();
      for (const card of pile) {
        const id = String((card as any)?.id || '').trim();
        if (id && !byId.has(id)) byId.set(id, card);
      }
      contextualBoundCardIds = contextualBoundCardIds.filter((id) => {
        const card = byId.get(id);
        if (!card) {
          const location = findBoundCardZoneLocation(nextState, id);
          if (!location) return false;
          const player = (nextState.players || []).find((p: any) => p.id === location.playerId) as any;
          const zoneCards = location.zone === 'library'
            ? (Array.isArray(player?.library) ? player.library : [])
            : (Array.isArray(player?.[location.zone]) ? player[location.zone] : []);
          const found = zoneCards.find((entry: any) => String(entry?.id || '').trim() === id);
          if (!found) return false;
          const typeLine = String(found?.type_line || found?.card?.type_line || '').toLowerCase();
          return typeFilter === 'permanent'
            ? !/instant|sorcery/.test(typeLine)
            : typeLine.includes(typeFilter);
        }
        const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
        return typeFilter === 'permanent'
          ? !/instant|sorcery/.test(typeLine)
          : typeLine.includes(typeFilter);
      });
    }
  }
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
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
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
  const guardResultUnsupportedSelectorEarlyOut1 = tryApplyMoveZoneGuardsUnsupportedSelectorEarlyOut(guardArgsDiceBracketIt);
  if (guardResultUnsupportedSelectorEarlyOut1) return guardResultUnsupportedSelectorEarlyOut1;

  const guardResultCommandZonePermanentToHand1 = tryApplyMoveZoneGuardsFromCommandZonePermanentToHand(guardArgsDiceBracketIt);
  if (guardResultCommandZonePermanentToHand1) return guardResultCommandZonePermanentToHand1;


  return {
    applied: false,
    message: `Skipped move zone (unsupported selector): ${step.raw}`,
    reason: 'unsupported_selector',
  };
  } finally {
    setActiveMoveZoneStep(undefined);
  }
}
