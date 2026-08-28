import type { Server, Socket } from "socket.io";
import type { PlayerID, BattlefieldPermanent } from "../../../shared/src/index.js";
import crypto from "crypto";
import { ensureGame, appendGameEvent, broadcastGame, getPlayerName, emitToPlayer, broadcastManaPoolUpdate, getEffectivePower, getEffectiveToughness, parseManaCost, getOrInitManaPool, calculateTotalAvailableMana, validateManaPayment, consumeManaFromPool, calculateManaProduction, recordTreasureManaProduced, recordCreatureSpellHasteManaProduced, recordManaProducedByPermanentSource, validateAndConsumeManaCostFromPool, clearHumanAutoPassPauseOnAction, resolveClientStyleManaAbilityById, addRestrictedManaToPool } from "./util";
import { syncDerivedContinuousEffects } from "../state/modules/staticEffectSpec.js";
import { permanentCannotActivateTapAbilities } from "../state/modules/staticEffectSpecActivationLocks.js";
import { appendEvent } from "../db";
import { games } from "./socket.js";
import { 
  permanentHasCreatureType,
  findPermanentsWithCreatureType 
} from "../../../shared/src/creatureTypes";
import { parseSacrificeCost, type SacrificeType } from "../../../shared/src/textUtils";
import { parseEquipAbilitiesFromOracle, permanentMatchesEquipQualifier } from "../../../shared/src/equipAbilities.js";
import { getAttachmentGrantedActivatedAbilityTexts } from "../../../shared/src/attachmentAbilityGrants.js";
import { abilityAllowsAnyPlayerActivation } from "../../../shared/src/anyPlayerActivatedAbility.js";
import { hydratePermanentCardOracleInPlace } from "../state/modules/cardOracleHydration.js";
import { isSacrificeCreatureOfChosenTypeCost } from "../state/modules/chosen-creature-type.js";
import { adjustActivationManaCostForPayment, isActivatedManaAbilityText } from "../state/modules/ability-cost-adjustments.js";
import { permanentHasCreatureTypeNow } from "../state/creatureTypeNow.js";
import { getLandfallTriggers, getETBTriggersForPermanent, getLoyaltyActivationLimit, detectUtilityLandAbility } from "../state/modules/triggered-abilities";
import { cardFromHideawayToHand, clearStoredHideawayCard } from "../state/modules/hideawayExile.js";
import { movePermanentToGraveyard, trackPermanentSacrificedThisTurn } from "../state/modules/counters_tokens.js";
import { sacrificePermanent } from "../state/modules/upkeep-triggers.js";
import { queueTapTriggersForTappedPermanents } from "../state/modules/tap-trigger-queue.js";
import {
  resolveGroupedPermanentRef,
  parseGroupedPermanentRef,
  getTokenGroupMembers,
} from "./tokenGroupResolve.js";
import { queueSacrificeTriggers } from "../state/modules/triggers/sacrifice.js";
import { queueSelfETBTriggersForPermanent, triggerETBEffectsForToken } from "../state/modules/triggerEtbEntryEffects.js";
import { triggerETBEffectsForPermanent } from "../state/modules/triggerEtbPermanentEffects.js";
import { checkOpponentHasMoreLands } from "../state/modules/stackLandCountUtils.js";
import { recordCardLeftGraveyardThisTurn } from "../state/modules/turn-tracking.js";
import { pushCardToPlayerGraveyardWithReplacements } from "../state/modules/graveyardEntryUtils.js";
import { 
  getManaAbilitiesForPermanent, 
  getManaMultiplier, 
  getExtraManaProduction, 
  getDevotionManaAmount, 
  getCreatureCountManaAmount,
  detectManaModifiers,
  getCommanderColorIdentity,
  resolvePermanentChosenColorSymbol,
  parseManaSpendRestrictionFromOracle,
} from "../state/modules/mana-abilities";
import {
  buildAnyCombinationManaSelectionFields,
  buildManaProductionColorSelectionFields,
  hasPendingManaColorSelectionForPermanent,
  isCombinationOrAnyColorManaField,
  resolveAllowedColorsForCombinationMana,
} from "../state/modules/manaColorSelectionStepUtils.js";
import { canPayManaCost, canPayManaCostWithAvailableSources, getAvailableMana } from "../state/modules/mana-check.js";
import { cardManaValue, exchangePermanentOracleText, parsePT, parseWordNumber } from "../state/utils";
import { buildEmbalmOrEternalizeTokenPermanent } from "../state/modules/graveyard-tokens.js";
import { ResolutionQueueManager, ResolutionStepType, createResolutionStep } from "../state/resolution/index.js";
import { resolveStationChargeCounterEffectText, isStationPermanentTypeLine } from "../state/modules/oracleIrAbilityExecution.js";
import {
  readStationChargeCreatureThresholdFromOracleText,
  isActivatableStationThresholdEffect,
  isOnceDuringEachOfYourTurnActivatedEffect,
  hasUsedOnceDuringEachActivatedAbilityThisTurn,
  hasOncePerTurnActivatedAbilityPendingOnStack,
  isRecognizedActivatedAbilityCostText,
} from "../../../rules-engine/src/stationPermanentUtils.js";
import { parseStationAbilities } from "../utils/stationParser.js";
import { parseUpgradeAbilities as parseCreatureUpgradeAbilities } from "../../../rules-engine/src/creatureUpgradeAbilities";
import { getActivatedAbilityConfig } from "../../../rules-engine/src/cards/activatedAbilityCards.js";
import { isAIPlayer } from "./ai.js";
import { inferSplitLibrarySearchPlan } from "../../../rules-engine/src/oracleIRSplitLibrarySearch.js";
import { creatureHasHaste } from "./game-actions.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";
import { filterLibraryCardsForSearch } from "./library-search.js";
import { pushWheneverYouExertTriggersOntoStack } from "./exert-triggers.js";
import { registerManaHandlers } from "./mana-handlers.js";
import { canPermanentBeTargetedByPlayer, matchesGraveyardCardTargetType as matchesSharedGraveyardCardTargetType, normalizeRequirementTargetType, parseAbilityTargeting, parseTargetRequirements, selectionRequiresSharedCardType } from "../rules-engine/targeting.js";
import { requestPlayerSelection } from "./player-selection.js";
import { serializeAbilityActivatedTriggeredStackItem, triggerAbilityActivatedTriggers } from "../state/modules/triggers/ability-activated.js";
import { isCreatureNow } from "../state/creatureTypeNow.js";
import { countArtifacts, getActiveAbilityConditions } from "../state/modules/game-state-effects.js";
import { detectActivatedAbilityConditionRequirement, type ActivatedAbilityConditionRequirement } from "../state/modules/activated-ability-conditions.js";
import { detectActivationTimingRestriction, isActivatedAbilityTimingLegal } from "../state/modules/activation-timing.js";
import { buildCastFromGraveyardCard, buildGraveyardCastingPermissionId, getGrantedCastFromGraveyardKeywordInfo, getGrantedEmbalmInfo, getGrantedFlashbackInfo, getGrantedUnearthInfo, getPrintedSelfCastPermissionInfo, getPrintedUnearthInfo } from "../state/modules/graveyard-permissions.js";
import { detectAdditionalCost } from "./land-helpers.js";
import {
  hasActivatedExhaustAbility,
  isExhaustAbilityText,
  markExhaustAbilityActivated,
} from '../state/modules/keywordActivationState.js';
import {
  applyPowerUpEnteredThisTurnDiscount,
  applyPowerUpActivationCostReductions,
  hasUsedPowerUpAbility,
  markPowerUpAbilityUsed,
  parsePowerUpActivatedAbility,
} from "../state/modules/marvelMechanicsHelpers.js";
import {
  detectTutorEffect,
  getUpgradedCreatureTypes,
  parseSearchCriteria,
  type TutorInfo,
} from "./interaction-handlers/interactionTutorSearchCriteriaParsing.js";
import {
  getAnyColorBonusManaAmount,
  getChosenTypeManaSelectionFields,
  queueAnyColorBonusManaSelection,
  resolveManaAbilityActivationShape,
} from "./interaction-handlers/interactionManaAbilityActivationShape.js";
import {
  enforceSorcerySpeedGraveyardAbility,
  getBattlefieldActivationTimingRestrictionError,
  getExplicitGraveyardActivationCost,
  getKeywordGraveyardActivationManaCost,
  isBattlefieldSorcerySpeedWindow,
  markCardLeftGraveyardLive,
  queueSelfEtbForLiveGraveyardEntry,
} from "./interaction-handlers/interactionGraveyardCastCostAndTimingRules.js";
import {
  calculateInteractionManaPoolDelta,
  matchesParsedGraveyardCardTargetType,
  persistQueuedBattlefieldAbilityStepActivation,
  persistQueuedGraveyardAbilityStepActivation,
  snapshotInteractionManaPool,
} from "./interaction-handlers/interactionActivationEventPersistence.js";
import { getCyclingDefinitionForActivation } from "./interaction-handlers/interactionCyclingActivationDefinitions.js";
import {
  continueCastFromGraveyardAbility,
  createEncoreToken,
  getEncoreTargetPlayerIds,
  getNextEndStepFireTurnNumber,
} from "./interaction-handlers/interactionGraveyardCastExecution.js";
import {
  SPECIAL_LAND_ABILITIES,
  WORD_TO_NUMBER,
  evaluateHideawayActivationCondition,
  getLifePaymentForActivationCost,
} from "./interaction-handlers/interactionSpecialLandAndHideaway.js";
import {
  handleBeginBatchExploreRequest,
  handleBeginExploreRequest,
} from "./interaction-handlers/interactionExploreSocketHandlers.js";
import { handleLibrarySearchRequest } from "./interaction-handlers/interactionLibrarySearchSocketHandlers.js";
import { handleGraveyardViewRequest } from "./interaction-handlers/interactionGraveyardViewSocketHandlers.js";
import {
  handleBulkTapPermanentsForManaRequest,
  handleUntapPermanentRequest,
} from "./interaction-handlers/interactionBulkTapUntapSocketHandlers.js";
import { handleActivateGraveyardAbilityRequest } from "./interaction-handlers/interactionGraveyardAbilitySocketHandlers.js";
import type { ActivateBattlefieldAbilityContext } from "./interaction-handlers/interactionActivateBattlefieldAbilityContext.js";
import { tryHandleActivateSpecialLand } from "./interaction-handlers/interactionActivateSpecialLand.js";
import { tryHandleActivateFetchLand } from "./interaction-handlers/interactionActivateFetchLand.js";
import { tryHandleActivateSacrificeDraw } from "./interaction-handlers/interactionActivateSacrificeDraw.js";
import { tryHandleActivateEquipFortifyReconfigure } from "./interaction-handlers/interactionActivateEquipFortifyReconfigure.js";
import { tryHandleActivateGrantFightCounterTap } from "./interaction-handlers/interactionActivateGrantFightCounterTap.js";
import { tryHandleActivateCrewStation } from "./interaction-handlers/interactionActivateCrewStation.js";
import { tryHandleActivateLevelOutlastUpgrade } from "./interaction-handlers/interactionActivateLevelOutlastUpgrade.js";
import { tryHandleActivatePlaneswalker } from "./interaction-handlers/interactionActivatePlaneswalker.js";
import {
  trySetupActivateBattlefieldAbilityParse,
  type ActivateBattlefieldAbilityParseState,
} from "./interaction-handlers/interactionActivateBattlefieldAbilityParseSetup.js";
import { tryHandleActivateGenericNonMana } from "./interaction-handlers/interactionActivateGenericNonMana.js";
import { tryHandleActivateGenericMana } from "./interaction-handlers/interactionActivateGenericMana.js";
import { applyActivateBattlefieldAbilityPersist } from "./interaction-handlers/interactionActivateBattlefieldAbilityPersist.js";
import type {
  ActivateGenericAbilityExtras,
  ActivateGenericAbilityMutationState,
} from "./interaction-handlers/interactionActivateGenericAbilityState.js";
import { tryHandleActivateSacrificeCostPrompt } from "./interaction-handlers/interactionActivateSacrificeCostPrompt.js";
import { tryHandleActivatePayLifeExileCounters } from "./interaction-handlers/interactionActivatePayLifeExileCounters.js";
import {
  persistAbilityActivatedTriggerPushes,
  isSplitSecondLockActive,
  costRequiresSelfExert,
  buildActivatedAbilityOracleTextForStack,
  getActivatedAbilityConditionErrorPayload,
  getManaAbilityLifeEffect,
  resolveThresholdRestrictedActivatedAbility,
  parseStationThreshold,
  parseTapUntapAbilityText,
  parseActivationCost,
  payBattlefieldAbilityManaCostOrQueue,
  queueCounterTargetStepForBattlefieldAbility,
  extractActivatedAbilitiesFromText,
  getActivatedAbilityScopeText,
  generateId,
  findUntappedPermanentsWithCreatureType,
  normalizeSelectedXValue,
  applyXValueToText,
} from "./interaction-handlers/interactionActivateBattlefieldAbilityHelpers.js";
import { tryHandleActivateMana } from "./interaction-handlers/interactionActivateMana.js";
import { tryHandleActivateCostPromptTapBlight } from "./interaction-handlers/interactionActivateCostPromptTapBlight.js";
import { handleTapPermanentRequest } from "./interaction-handlers/interactionTapPermanentSocketHandlers.js";
import { registerReplacementAndCyclingSocketHandlers } from "./interaction-handlers/interactionReplacementAndCyclingSocketHandlers.js";
import { tryHandleActivateCostPromptDiscardExileHand } from "./interaction-handlers/interactionActivateCostPromptDiscardExileHand.js";
import {
  handleExchangeTextBoxesRequest,
  handleSacrificePermanentRequest,
} from "./interaction-handlers/interactionExchangeSacrificeSocketHandlers.js";

// Public/compatibility re-exports: these moved to interaction-handlers/ but the
// stable import path stays socket/interaction.js.
export { detectTutorEffect, parseSearchCriteria };
export type { TutorInfo };
export { resolveManaAbilityActivationShape };
export { finalizeGraveyardSpellCast, continueCastFromGraveyardAbility } from "./interaction-handlers/interactionGraveyardCastExecution.js";

export {
  parseTapUntapAbilityText,
  queueCounterTargetStepForBattlefieldAbility,
  getActivatedAbilityScopeText,
  buildActivatedAbilityOracleTextForStack,
};


export function registerInteractionHandlers(io: Server, socket: Socket) {
  // Scry: Peek and reorder library cards
  // Legacy scry handlers removed - now using resolution queue system
  // See processPendingScry() in resolution.ts
  
  // surveilResolve continued from removed handler (keeping for any remaining references)
  // TODO: Clean up after verifying no dependencies

  // Legacy confirmPonder handler removed - now handled via Resolution Queue.
  // See processPendingPonder() and handlePonderEffectResponse() in resolution.ts.

  const ensureInRoomAndSeated = (gameId: unknown): { gameId: string; game: any; pid: string } | undefined => {
    const pid = socket.data.playerId as string | undefined;
    const socketIsSpectator = !!(
      (socket.data as any)?.spectator || (socket.data as any)?.isSpectator
    );
    if (!pid || socketIsSpectator) return;

    if (!gameId || typeof gameId !== 'string') return;

    if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return;
    }

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit?.('error', { code: 'GAME_NOT_FOUND', message: 'Game not found' });
      return;
    }

    try {
      const seated = Array.isArray((game.state as any)?.players)
        ? (game.state as any).players.some((p: any) => p?.id === pid && !p?.spectator && !p?.isSpectator)
        : false;
      if (!seated) {
        socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
        return;
      }
    } catch {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return;
    }

    return { gameId, game, pid };
  };


  // Explore: Reveal top card, if land put in hand, else +1/+1 counter and may put in graveyard
  socket.on("beginExplore", (payload?: { gameId?: unknown; permanentId?: unknown }) =>
    handleBeginExploreRequest(io, socket, ensureInRoomAndSeated, payload));

  // Batch Explore: Handle multiple creatures exploring at once (e.g., Hakbal triggers)
  // NOTE: This implementation peeks at the top card multiple times (once in beginBatchExplore
  // and once in the Resolution Queue response handler). This is acceptable because
  // peekTopN doesn't modify the library - it only reveals what's there. The actual card
  // movement happens when the Resolution Queue step is completed via applyEvent("exploreResolve").
  socket.on("beginBatchExplore", (payload?: { gameId?: unknown; permanentIds?: unknown }) =>
    handleBeginBatchExploreRequest(io, socket, ensureInRoomAndSeated, payload));

  // Request full library for searching (tutor effect)
  socket.on("requestLibrarySearch", (payload?: {
    gameId?: unknown;
    title?: unknown;
    description?: unknown;
    filter?: any;
    maxSelections?: unknown;
    moveTo?: unknown;
    shuffleAfter?: unknown;
  }) => handleLibrarySearchRequest(io, socket, payload));

  // Handle graveyard ability activation
  socket.on("activateGraveyardAbility", (payload?: { gameId?: unknown; cardId?: unknown; abilityId?: unknown; targets?: unknown; xValue?: unknown }) =>
    handleActivateGraveyardAbilityRequest(
      io,
      socket,
      ensureInRoomAndSeated,
      generateId,
      isSplitSecondLockActive,
      findUntappedPermanentsWithCreatureType,
      payload,
    ));
  
  // Get graveyard contents for viewing
  socket.on("requestGraveyardView", (payload?: { gameId?: unknown; targetPlayerId?: unknown }) =>
    handleGraveyardViewRequest(io, socket, payload));

  // Tap a permanent on the battlefield
  socket.on("tapPermanent", (payload?: { gameId?: unknown; permanentId?: unknown }) =>
    handleTapPermanentRequest(io, socket, ensureInRoomAndSeated, payload));

  /**
   * Bulk-tap many permanents for mana in one action (Cryptolith Rite token swarms, etc.).
   * Queues a single color / distribution prompt when abilities produce any color.
   */
  socket.on("bulkTapPermanentsForMana", (payload?: { gameId?: unknown; permanentIds?: unknown; count?: unknown }) =>
    handleBulkTapPermanentsForManaRequest(io, socket, ensureInRoomAndSeated, payload));

  // Untap a permanent on the battlefield
  socket.on("untapPermanent", (payload?: { gameId?: unknown; permanentId?: unknown }) =>
    handleUntapPermanentRequest(io, socket, ensureInRoomAndSeated, payload));

  // Exchange oracle text boxes between two permanents (text-changing effects)
  socket.on("exchangeTextBoxes", (payload?: { gameId?: unknown; sourcePermanentId?: unknown; targetPermanentId?: unknown }) =>
    handleExchangeTextBoxesRequest(io, socket, ensureInRoomAndSeated, payload));

  socket.on("sacrificePermanent", (payload?: { gameId?: unknown; permanentId?: unknown }) =>
    handleSacrificePermanentRequest(io, socket, ensureInRoomAndSeated, payload));

  // Activate a battlefield ability (fetch lands, mana abilities, etc.)
  socket.on(
    "activateBattlefieldAbility",
    async (payload?: { gameId?: unknown; permanentId?: unknown; abilityId?: unknown; xValue?: unknown }) => {
    const gameIdRaw = payload?.gameId;
    const permanentIdRaw = payload?.permanentId;
    const abilityId = payload?.abilityId;
    const selectedXValue = normalizeSelectedXValue(payload?.xValue);

    debug(1, `[activateBattlefieldAbility] received permanentId=${String(permanentIdRaw)} abilityId=${String(abilityId)} gameId=${String(gameIdRaw)}`);

    if (typeof permanentIdRaw !== "string") {
      debugWarn(1, `[activateBattlefieldAbility] rejected: permanentId is not a string (${typeof permanentIdRaw})`);
      return;
    }

    let permanentId: string = permanentIdRaw;

    const ctx = ensureInRoomAndSeated(gameIdRaw);
    if (!ctx) return;

    const { gameId, game, pid } = ctx;

    // Validate abilityId is provided
    if (!abilityId || typeof abilityId !== "string") {
      socket.emit("error", {
        code: "INVALID_ABILITY",
        message: "Ability ID is required",
      });
      return;
    }

    const splitSecondLockActive = isSplitSecondLockActive(game.state);
    const battlefield = game.state?.battlefield || [];

    // Emit may send group_* / *_virtual_N ids for TokenOptimization stacks.
    // Resolve to a real battlefield permanent before looking up / tapping.
    const resolvedPermanentId =
      resolveGroupedPermanentRef(game, pid as any, String(permanentId)) || String(permanentId);
    
    const permIndex = battlefield.findIndex((p: any) => p?.id === resolvedPermanentId);
    if (permIndex === -1) {
      socket.emit("error", {
        code: "PERMANENT_NOT_FOUND",
        message: "Permanent not found or not controlled by you",
      });
      return;
    }
    
    const permanent = battlefield[permIndex];
    hydratePermanentCardOracleInPlace(permanent);
    permanentId = String(permanent.id);
    const card = (permanent as any).card;
    const cardName = card?.name || "Unknown";
    const oracleText = (card?.oracle_text || "").toLowerCase();
    const typeLine = (card?.type_line || "").toLowerCase();
    clearHumanAutoPassPauseOnAction(game as any, pid, 'activateBattlefieldAbility', true);
    const grantedAbilityMatch = String(abilityId || '').match(/-granted-(\d+)$/i);
    let scopedAbilityText = '';
    let scopedAbilityFullText = '';
    if (grantedAbilityMatch) {
      const grantedIndex = Number.parseInt(grantedAbilityMatch[1] || '0', 10) || 0;
      const grantedTexts = getAttachmentGrantedActivatedAbilityTexts(permanent, battlefield);
      // Also allow persisted granted activated lines
      const persisted = Array.isArray((permanent as any).grantedAbilities)
        ? (permanent as any).grantedAbilities
            .map((entry: unknown) => String(entry || '').trim())
            .filter((entry: string) => entry.includes(':'))
        : [];
      const allGranted = [...grantedTexts];
      for (const entry of persisted) {
        if (!allGranted.some((g) => g.toLowerCase() === entry.toLowerCase())) {
          allGranted.push(entry);
        }
      }
      const grantedLine = String(allGranted[grantedIndex] || '').trim();
      scopedAbilityText = grantedLine.includes(':')
        ? grantedLine.slice(grantedLine.indexOf(':') + 1).trim()
        : grantedLine;
      scopedAbilityFullText = grantedLine || scopedAbilityText;
    } else {
      const scopedActivatedAbility = getActivatedAbilityScopeText(oracleText, abilityId);
      scopedAbilityText = String(scopedActivatedAbility.abilityText || '').trim();
      scopedAbilityFullText = String(scopedActivatedAbility.fullAbilityText || scopedAbilityText || oracleText || '').trim();
    }
    const isGenericActivatedAbilityId = /-ability-(\d+)$/i.test(abilityId) || /-granted-(\d+)$/i.test(abilityId);

    if (
      String(permanent.controller || '') !== String(pid)
      && !abilityAllowsAnyPlayerActivation({
        scopedAbilityText: scopedAbilityFullText,
        cardOracleText: card?.oracle_text,
      })
    ) {
      socket.emit("error", {
        code: "PERMANENT_NOT_FOUND",
        message: "Permanent not found or not controlled by you",
      });
      return;
    }

    const activateCtx: ActivateBattlefieldAbilityContext = {
      io,
      socket,
      game,
      gameId,
      pid,
      permanentId,
      abilityId,
      selectedXValue,
      splitSecondLockActive,
      battlefield,
      permIndex,
      permanent,
      card,
      cardName,
      oracleText,
      typeLine,
      scopedAbilityText,
      scopedAbilityFullText,
      isGenericActivatedAbilityId,
    };

    const { isAbilityActivationProhibitedByChosenName } = await import('../state/modules/chosen-name-restrictions.js');
    
    if (await tryHandleActivateSpecialLand(activateCtx)) return;

    if (await tryHandleActivateFetchLand(activateCtx)) return;

    if (await tryHandleActivateSacrificeDraw(activateCtx)) return;

    if (await tryHandleActivateEquipFortifyReconfigure(activateCtx)) return;

    
    if (await tryHandleActivateGrantFightCounterTap(
      activateCtx,
      parseActivationCost,
      parseTapUntapAbilityText,
      payBattlefieldAbilityManaCostOrQueue,
      queueCounterTargetStepForBattlefieldAbility,
      costRequiresSelfExert,
    )) return;

    if (await tryHandleActivateCrewStation(activateCtx, parseStationThreshold)) return;

    
    if (await tryHandleActivateLevelOutlastUpgrade(activateCtx, persistAbilityActivatedTriggerPushes)) return;

    if (await tryHandleActivateMana(activateCtx, getManaAbilityLifeEffect, getActivatedAbilityConditionErrorPayload)) return;

    
    if (await tryHandleActivatePlaneswalker(activateCtx, persistAbilityActivatedTriggerPushes)) return;

    const parsedActivateAbility: ActivateBattlefieldAbilityParseState = {
      abilityText: "",
      requiresTap: false,
      requiresUntap: false,
      manaCost: "",
      requiresSelfExert: false,
      sacrificeType: null,
      sacrificeSubtype: undefined,
      sacrificeCount: 1,
      mustBeOther: false,
      isPowerUpActivation: false,
      powerUpAbilityIndex: -1,
      selectedAbilityIndex: 0,
      selectedAbilityFullText: "",
      selectedAbilityOracleLine: "",
      isExhaustActivation: false,
      abilityConditionText: "",
      isBoastAbility: false,
      oncePerTurnActivatedEffect: "",
    };
    if (trySetupActivateBattlefieldAbilityParse(activateCtx, parsedActivateAbility)) return;
    let {
      abilityText,
      requiresTap,
      requiresUntap,
      manaCost,
      requiresSelfExert,
      sacrificeType,
      sacrificeSubtype,
      sacrificeCount,
      mustBeOther,
      isPowerUpActivation,
      powerUpAbilityIndex,
      selectedAbilityIndex,
      selectedAbilityFullText,
      selectedAbilityOracleLine,
      isExhaustActivation,
      abilityConditionText,
      isBoastAbility,
      oncePerTurnActivatedEffect,
    } = parsedActivateAbility;


    if (await tryHandleActivateCostPromptTapBlight(activateCtx, manaCost, abilityText, requiresTap, abilityConditionText)) return;

    
    if (await tryHandleActivateSacrificeCostPrompt(
      activateCtx,
      manaCost,
      abilityText,
      requiresTap,
      abilityConditionText,
      selectedAbilityFullText,
      selectedAbilityOracleLine,
      sacrificeType,
      sacrificeSubtype,
      buildActivatedAbilityOracleTextForStack,
    )) return;

    // Track any permanents we tap as part of paying this activation's costs.
    // This is persisted into the activateBattlefieldAbility event for replay determinism.
    const tappedPermanentsForCost: string[] = [];

    // Track any permanents we sacrifice as part of paying this activation's costs.
    // Persisted into activateBattlefieldAbility for deterministic replay.
    const sacrificedPermanentsForCost: string[] = [];

    // Track life paid as part of paying this activation's costs.
    // Persisted into activateBattlefieldAbility for deterministic replay.
    let pendingLifePaymentForCost = 0;

    // Track non-cost life loss tied to mana production itself (for example,
    // Mana Confluence or City of Brass style effects) so shared AI/player
    // activations apply the same side effects.
    let pendingManaLifeLossAmount = 0;
    let pendingManaLifeLossIsDamage = false;
    let manaGrantsCreatureSpellHasteUntilEndOfTurn = false;
    const recordedAddedMana: Record<string, number> = {};
    const recordAddedMana = (poolKey: string, amount: number) => {
      if (!poolKey) return;
      const numericAmount = Number(amount || 0);
      if (!Number.isFinite(numericAmount) || numericAmount === 0) return;
      recordedAddedMana[poolKey] = Number(recordedAddedMana[poolKey] || 0) + numericAmount;
    };

    // Track any counters removed as part of paying this activation's costs.
    // Persisted into activateBattlefieldAbility for deterministic replay.
    const removedCountersForCost: Array<{ permanentId: string; counterType: string; count: number }> = [];

    // Defer applying counter removal until we're sure this activation completes.
    // (If we remove counters and later fail mana payment, we'd corrupt state.)
    const pendingCounterRemovals: Array<{ counterType: string; count: number }> = [];

    const activationCostState = {
      manaCost,
      pendingLifePaymentForCost,
      pendingCounterRemovals,
    };
    if (await tryHandleActivatePayLifeExileCounters(
      activateCtx,
      activationCostState,
      abilityText,
      requiresTap,
      abilityConditionText,
    )) return;
    manaCost = activationCostState.manaCost;
    pendingLifePaymentForCost = activationCostState.pendingLifePaymentForCost;

    const pendingSpellCardIdForCostSelection = (() => {
      const pendingSpellCasts = Object.values((((game.state as any)?.pendingSpellCasts) || {})) as any[];
      const pendingCast = pendingSpellCasts.find((entry: any) => String(entry?.playerId || '') === String(pid || ''));
      return String(pendingCast?.cardId || '').trim();
    })();

    if (await tryHandleActivateCostPromptDiscardExileHand(activateCtx, manaCost, abilityText, requiresTap, abilityConditionText, pendingSpellCardIdForCostSelection, applyXValueToText, buildActivatedAbilityOracleTextForStack, selectedAbilityFullText, selectedAbilityOracleLine, tappedPermanentsForCost, sacrificeType, sacrificeSubtype, sacrificeCount, mustBeOther)) return;

    const resolvedAbilityText = applyXValueToText(abilityText, selectedXValue);
    const resolvedActivatedAbilityText = applyXValueToText(
      buildActivatedAbilityOracleTextForStack({
        selectedAbilityFullText,
        selectedAbilityOracleLine,
        abilityConditionText,
        manaCost,
        abilityText,
      }),
      selectedXValue,
    );

    
    // Check if this is a mana ability (doesn't use the stack)
    // Mana abilities are abilities that produce mana and don't target
    // IMPORTANT: Check the specific ability text, NOT the entire oracle text
    // This fixes cards like Herd Heirloom which have both mana AND non-mana tap abilities
    // 
    // Per MTG Rule 605.1a, a mana ability is an activated ability that:
    // - Could add mana to a player's mana pool when it resolves
    // - Isn't a loyalty ability (checked earlier)
    // - Doesn't target
    // 
    // Pattern matches:
    // - "Add {W}", "Add {G}{G}", "Add {R} or {W}", etc. (specific mana symbols including {C} for colorless)
    // - "Add one mana", "Add two mana", etc.
    // - "Add mana of any color", "Add any color"
    // - "Add X mana" (variable mana)
    // - "Add an amount of {G}" (Karametra's Acolyte, etc.)
    // - "Add X mana in any combination" (Selvala, Nykthos, etc.)
    // Note: Also matches Talisman pattern: "{T}: Add {R} or {W}. This artifact deals 1 damage to you."
    // Captured when a non-mana activation pushes a stack item so the trailing
    // activateBattlefieldAbility event can rebuild that exact stack identity on replay.
    let persistedStackItemId: string | undefined;

    let isManaAbility = /add\s+(\{[wubrgc]\}(?:\s+or\s+\{[wubrgc]\})?|\{[wubrgc]\}\{[wubrgc]\}|(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+mana(?:\s+of\s+(?:the\s+chosen\s+colou?r|any(?:\s+one)?\s+colou?r))?|mana of any|any color|[xX] mana|an amount of|mana in any combination)/i.test(abilityText) && 
                          !/target/i.test(abilityText);
    // Restore/replay can leave basic lands without oracle_text. The client still
    // sends `-ability-0`; type-line native mana must still tap immediately.
    if (!isManaAbility && !String(abilityText || '').trim()) {
      const nativeManaAbilities = getManaAbilitiesForPermanent(game.state, permanent, pid);
      if (nativeManaAbilities.length > 0) {
        isManaAbility = true;
        if (!requiresTap) requiresTap = true;
      }
    }

    // Chosen-name activation restrictions (e.g., Pithing Needle / Phyrexian Revoker)
    // Important: we check after identifying whether THIS specific activation is a mana ability,
    // so "unless they're mana abilities" is respected.
    const activationRestriction = isAbilityActivationProhibitedByChosenName(game.state, pid as any, cardName, isManaAbility);
    if (activationRestriction.prohibited) {
      const blocker = activationRestriction.by?.sourceName || 'an effect';
      socket.emit('error', {
        code: 'CANNOT_ACTIVATE_CHOSEN_NAME',
        message: `Activated abilities of sources named "${cardName}" can't be activated (${blocker} chose that name).`,
      });
      return;
    }

    if (requiresTap && permanentCannotActivateTapAbilities(permanent, game.state)) {
      socket.emit('error', {
        code: 'CANNOT_ACTIVATE_TAP_ABILITY',
        message: `${cardName}'s activated abilities with {T} in their costs can't be activated.`,
      });
      return;
    }

    const genericMut: ActivateGenericAbilityMutationState = {
      pendingLifePaymentForCost,
      pendingManaLifeLossAmount,
      pendingManaLifeLossIsDamage,
      manaGrantsCreatureSpellHasteUntilEndOfTurn,
      persistedStackItemId,
      tappedPermanentsForCost,
      sacrificedPermanentsForCost,
      recordedAddedMana,
      removedCountersForCost,
      pendingCounterRemovals,
    };
    const genericExtras: ActivateGenericAbilityExtras = {
      abilityText,
      requiresTap,
      requiresUntap,
      manaCost: manaCost || "",
      requiresSelfExert,
      sacrificeType,
      sacrificeSubtype,
      isPowerUpActivation,
      powerUpAbilityIndex,
      selectedAbilityIndex,
      selectedAbilityFullText,
      selectedAbilityOracleLine,
      isExhaustActivation,
      isBoastAbility,
      oncePerTurnActivatedEffect,
      resolvedAbilityText,
      resolvedActivatedAbilityText,
    };
    
    if (!isManaAbility) {
      if (await tryHandleActivateGenericNonMana(activateCtx, genericMut, genericExtras)) return;
    } else {
      if (await tryHandleActivateGenericMana(activateCtx, genericMut, genericExtras, recordAddedMana)) return;
    }
    
    await applyActivateBattlefieldAbilityPersist(activateCtx, genericMut, genericExtras, isManaAbility);
  });



  // ========================================================================
  // Entrapment Maneuver sacrifice prompts use generic Oracle IR TARGET_SELECTION via oracleIrServerZoneSync.
  // ========================================================================

  // ========================================================================
  // NOTE: The legacy targetSelectionConfirm and targetSelectionCancel handlers 
  // have been removed. Target selection is now handled by the Resolution Queue
  // system via submitResolutionResponse and cancelResolutionStep.
  // See resolution.ts handleTargetSelectionResponse for the new implementation.
  // ========================================================================

  // ========================================================================
  // NOTE: The legacy perOpponentTargetSelectionConfirm handler has been removed.
  // Per-opponent targeting is now handled by the Resolution Queue system
  // via submitResolutionResponse. See resolution.ts handleTargetSelectionResponse.
  // ========================================================================

  // ============================================================================
  // Phyrexian Mana Payment Choice
  // ============================================================================

  // Legacy phyrexianManaConfirm handler removed - now using resolution queue system
  // See resolution.ts MANA_PAYMENT_CHOICE handling

  // ============================================================================
  // NOTE: The legacy sacrificeSelected handler has been removed.
  // Sacrifice selection is now handled by the Resolution Queue system:
  // - UPKEEP_SACRIFICE (edict style: sacrifice 1 creature)
  // - TARGET_SELECTION with sacrificeSelection metadata (sacrifice N permanents of a given type)
  // See resolution.ts handleTargetSelectionResponse.
  // ============================================================================

  // ============================================================================
  // Mana Pool Manipulation (moved to mana-handlers.ts)
  // ============================================================================
  
  // Register mana pool manipulation handlers from separate module
  registerManaHandlers(io, socket);

  registerReplacementAndCyclingSocketHandlers(io, socket);

}
