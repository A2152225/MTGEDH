/**
 * server/src/socket/ai.ts
 * 
 * AI opponent integration for multiplayer games.
 * Handles AI player registration, decision-making, and action execution.
 * 
 * Key features:
 * - Auto-selects commander from deck based on legendary creature type
 * - Handles priority passing and turn progression
 * - Broadcasts state updates to all players
 */

import { randomBytes } from "crypto";
import type { Server, Socket } from "socket.io";
import { movePermanentToGraveyard } from "../state/modules/counters_tokens.js";
import { hydrateGameStateOracleText } from "../state/modules/cardOracleHydration.js";
import { AIEngine, AIStrategy, AIDecisionType, type AIDecisionContext, type AIPlayerConfig } from "../../../rules-engine/src/AIEngine.js";
import { inferAIStrategyFromDeckProfile } from "../../../rules-engine/src/aiEngineDeckSupport.js";
import {
  findAttackManaRetentionEquipmentAttachedTo,
  isAttackManaRetentionEquipmentText,
  isPowerScaledGreenManaAbilityText,
  readPermanentPower,
  scoreAttackManaEngineReconfigureTarget,
} from "../../../rules-engine/src/aiEngineManaPoolSupport.js";
import {
  isStationPermanentTypeLine,
  readStationChargeCreatureThresholdFromOracleText,
} from "../../../rules-engine/src/stationPermanentUtils.js";
import { cardAnalyzer, CardCategory, SynergyArchetype, type DeckArchetypeProfile } from "../../../rules-engine/src/CardAnalyzer.js";
import { calculateManaProduction, ensureGame, broadcastGame, getEffectivePower, getEffectiveToughness, getPlayerName, getOrInitManaPool, validateManaPayment, getMaxGenericManaAvailable, paymentActivationCostHasUnsupportedAdditionalCosts, parseRemoveCounterActivationCost, getPermanentCounterAmount, permanentHasManaBatteryCounterLoop, consumeManaFromPool, persistAndResolveTopOfStack } from "./util.js";
import { executeDeclareAttackers as executeCombatDeclareAttackers } from "./combat.js";
import { appendEvent, gameExistsInDb, isGameCreator } from "../db/index.js";
import { getDeck, listDecks } from "../db/decks.js";
import { parseDecklist } from "../services/scryfall.js";
import { resolveDeckList } from '../services/deckImport.js';
import type { PlayerID } from "../../../shared/src/types.js";
import { choosePBudgetModeSelections } from "../../../shared/src/modeSelectionPBudget.js";
import { parseNumberFromText, parseSacrificeCost } from "../../../shared/src/textUtils.js";
import { canPermanentBeTargetedByPlayer, categorizeSpell, evaluateTargeting, type SpellSpec, type TargetRef } from "../rules-engine/targeting.js";
import { GameManager } from "../GameManager.js";
import {
  getAvailableMana,
  parseManaCost,
  normalizeParsedManaCost,
  canPayManaCost,
  canPayManaCostWithAvailableSources,
  getTotalManaFromPool,
  parseHandCostFromManaAbilityCost,
  parseReturnToHandCostFromManaAbilityCost,
  type ParsedManaCost,
} from "../state/modules/mana-check.js";
import { canAct, canPlayLand, canRespond, getCastableCommanderCandidates, getCastableSpellCandidates, getPlayableLandCandidates, isCardPlayableAsLandFromHand, type SharedCommanderCastCandidate, type SharedPlayableLandCandidate, type SharedSpellSourceZone } from "../state/modules/can-respond.js";
import { cardGrantsNoMaximumHandSize } from "../state/modules/handSizeUtils.js";
import { applyCostAdjustmentToParsedCost, buildCostAdjustmentPlan } from "../state/modules/cost-adjustments.js";
import { canCastFromTop, canPlayLandsFromTop } from "../state/modules/game-state-effects.js";
import { getAvailableReflexiveManaAmountFromPool, parseReflexivePaymentChoiceAmount, permanentMatchesReflexiveSacrificeType } from "../state/modules/reflexive-triggers.js";
import { ResolutionQueueManager } from "../state/resolution/ResolutionQueueManager.js";
import { getPendingInteractions } from "../state/modules/turn.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";
import { resolveManaAbilityLifeEffect } from "../state/modules/mana-abilities-handlers/manaAbilitySelfDamage.js";
import { runSBA } from "../state/modules/counters_tokens.js";
import { movePermanentToHand } from "../state/modules/zones.js";
import { isOpeningHandBattlefieldCard } from "./opening-hand.js";
import { getDominantCreatureType } from "./creature-type.js";
import { handlePlayLandRequest, requestCastSpellForSocket, runPostResolutionPermanentPromptChecks, getEffectiveAdditionalCost, isPlayerCompletingSpellCast } from "./game-actions.js";
import { isSpellCastBoardContextUseful } from "./spellCastBoardContext.js";
import { buildCounterRemovalCostOptions } from "../state/modules/counter-removal-costs.js";
import { type AdditionalCostResult } from "./land-helpers.js";
import { advanceStepPersistingEvent } from "./step-advance.js";
import { tryAutoStartGameFromPreGame } from "./pregame-auto-start.js";
import { chooseAIReflexiveExileToOwnersGraveyardSelection } from "./aiReflexiveExileToOwnersGraveyardChoice.js";
import { syncPreparedPermanentAfterControlChange } from "../state/modules/prepared.js";
import { getOptionalPaymentValidationFailure } from "./optional-payment-prompts.js";
import { chooseDelayedDrawUpToCount } from "../state/modules/triggerDelayedDrawUpToUtils.js";
import {
  chooseMultikickerTimesForChargeInvest,
  expandManaCostWithMultikicker,
  isMultikickerChargeCounterManaInvest,
  parseMultikickerManaCost,
} from "../state/modules/multikickerCastUtils.js";
import {
  AI_FAST_CONTINUE_MS,
  AI_MANA_ABILITY_PATTERN,
  AI_MANA_COLOR_PRIORITY,
  AI_PASSIVE_STEP_DELAY_MS,
  AI_REACTION_DELAY_MS,
  AI_THINK_TIME_MS,
  COLOR_IDENTITY_MAP,
  MAX_LIBRARY_SEARCH_LIMIT,
} from "./ai-handlers/aiConstants.js";
import { getPersistedAIPlayerRuntimeData } from "./ai-handlers/aiPlayerRuntimeData.js";
import {
  autoSelectAICommander,
  getAILibraryCards,
} from "./ai-handlers/aiPregameHandlers.js";
import {
  calculateCardSynergyPressure,
  calculateCardThemeAlignment,
  ensureAIDeckProfile,
  getAIBattlefield,
  getAIHand,
  getAIPlayerLife,
  permanentHasLeaveBattlefieldExileReplacement,
  rehydrateCardsById,
  scoreCardForAIAcquisition,
  scoreHostileGraveyardCardDisruption,
  summarizeAIHandPlan,
} from "./ai-handlers/aiDeckProfileHandlers.js";
import {
  aiActionsInProgress,
  aiEngine,
  aiPlayers,
  clearScheduledAIAction,
  clearScheduledAIActionsForGame,
  getAIActionKey,
  getAIPendingSpellCastStatus,
  runExclusiveAIAction,
  scheduleAIGameFlow,
  scheduleAIPriority,
} from "./ai-handlers/aiScheduler.js";
import { handleAIGameFlow } from "./ai-handlers/aiGameFlowHandlers.js";
import { handleAIMulligan } from "./ai-handlers/aiMulliganHandlers.js";
import {
  getAIPlayers,
  isAIPlayer,
  registerAIPlayer,
  rehydrateAIGameRuntime,
  rehydrateAIPlayerRuntime,
  unregisterAIPlayer,
} from "./ai-handlers/aiPlayerRegistry.js";
import { registerAIHandlers as registerAIHandlersImpl } from "./ai-handlers/aiRegisterHandlers.js";
import {
  chooseAIAdministrativeConfirmSelection,
  chooseAICastFreePromptSelection,
  chooseAIDredgeDrawReplacementSelection,
  chooseAIExertChoiceSelection,
  chooseAIForbiddenOrchardTargetSelection,
  chooseAILandWouldEnterSacrificeSelection,
  chooseAIMdfcFaceSelection,
  chooseAIMiraclePromptSelection,
  chooseAIMoxDiamondSelection,
  chooseAIOpponentMayPaySelection,
  chooseAIPlayerForLookedAtCardsSelection,
  chooseAIRevealLandSelection,
  chooseAISpellAdditionalCostBlightOrPaySelection,
  chooseAISpellBottomRevealUntilNonlandSelection,
  chooseAIVentureOptionSelection,
  chooseAIZursWeirdingOpponentSelection,
  getAIParsedManaCostAmount,
} from "./ai-handlers/aiChoicePromptHandlers.js";
import {
  getPermanentCombatStats,
  getPermanentKeywordSet,
} from "./ai-handlers/aiPermanentCombatStats.js";
import {
  chooseAIGraveyardSelectionIds,
  chooseAIHideawayCardId,
  chooseAILibrarySearchCards,
  chooseAILibrarySearchResponse,
  chooseAIOptionalDiscardThenDrawSelection,
  chooseAIReflexiveFixedPaymentSelection,
  chooseAIReflexiveManaPaymentSelection,
  chooseAIReflexiveSacrificeSelection,
  chooseAIReturnControlledPermanentId,
  chooseAISacrificeAnotherPermanentForBenefitSelection,
  chooseAIScrySelection,
  chooseAIUpkeepSacrificeSelection,
  scoreGenericChoiceOption,
  scoreProtectedObjectForWard,
} from "./ai-handlers/aiZoneSearchChoiceHandlers.js";
import {
  chooseAIAttachEquipmentToPermanentChoiceSelection,
  chooseAIChooseDiscardPlanSelection,
  chooseAIChooseManaColorsSelection,
  chooseAIChoosePlayerForTwoPileSplitSelection,
  chooseAICopyRetargetSelection,
  chooseAIForceOfWillExileSelection,
  chooseAIGrantPlayableFromExileSelection,
  chooseAIKeywordCounterSelectionsForStep,
  chooseAILookedAtCardsDestinationSelection,
  chooseAIMoveChosenHandCardToLibrarySelection,
  chooseAIOptionalPaymentPromptSelection,
  chooseAIPayManaToLookAndChooseCardSelection,
  chooseAIPileFromSplitSelection,
  chooseAIPutFromHandSelectionsForStep,
  chooseAIReflexiveBoundGraveyardSelfExileSelection,
  chooseAIReflexiveConvertSelection,
  chooseAIReflexiveDiscardSelection,
  chooseAIReflexiveGraveyardExileSelection,
  chooseAIResolvedSpellCopySelection,
} from "./ai-handlers/aiPileAndKeywordChoiceHandlers.js";
import type {
  AIAbilityActivationSnapshot,
  AIActivatedAbilityResolverCandidate,
  AIResolvedActivatedAbilityAction,
} from "./ai-handlers/aiAbilityActivationTypes.js";
import {
  chooseAICardNameSelection,
  chooseAIPlayerChoiceId,
} from "./ai-handlers/aiPlayerCardNameChoiceHandlers.js";
import {
  chooseAITargetSelectionsForChoiceStep,
  chooseAITargetsForSpell,
  findZoneCardById,
} from "./ai-handlers/aiTargetChoiceHandlers.js";
import {
  chooseAIKynaiosChoiceSelection,
  chooseAIModeSelectionsForStep,
} from "./ai-handlers/aiModeChoiceHandlers.js";
import { chooseAIOptionSelectionsForStep } from "./ai-handlers/aiOptionChoiceHandlers.js";
import {
  checkPendingModals,
  cleanupGameAI,
  getPendingBlockerDeclaration,
} from "./ai-handlers/aiGameCleanupHandlers.js";
import {
  executeDeclareAttackers,
  executeDeclareBlockers,
  executePassPriority,
} from "./ai-handlers/aiPriorityPassCombatExecutors.js";
import {
  applyAIManaLifeLoss,
  canAIPayAdditionalCost,
  chooseAIManaColorForActivation,
  getAIManaProductionOptions,
  getManaProduction,
  hasCreatureSummoningSickness,
  hasManaAbility,
  scoreAISacrificePermanentForManaAbility,
} from "./ai-handlers/aiManaCostHelpers.js";
import { handleAIResolutionKeywordAndMiscSteps } from "./ai-handlers/aiResolutionKeywordAndMiscSteps.js";
import { handleAIResolutionPaymentAndTargetSteps } from "./ai-handlers/aiResolutionPaymentAndTargetSteps.js";
import { handleAIResolutionSearchAndNameSteps } from "./ai-handlers/aiResolutionSearchAndNameSteps.js";
import { handleAIResolutionTriggerAndChoiceSteps } from "./ai-handlers/aiResolutionTriggerAndChoiceSteps.js";
import { executeAdvanceStep, executeAIDecision } from "./ai-handlers/aiAdvanceAndDecisionExecutors.js";
import { executeAILegacyActivateAbility } from "./ai-handlers/aiLegacyActivateAbilityHandlers.js";
import {
  chooseAIReturnToHandPermanentForManaAbility,
  getAINonTapManaActionAmount,
  resolveAIPaymentManaAbilityId,
  selectAIManaRetentionActivationAction,
  selectAINonTapManaActivationAction,
  tryActivateAINonTapManaAbilityForSpellPaymentSimulation,
  tryAIManaBatteryColorFixForSpellPayment,
  tryAIManaBatteryColorFixForSpellPaymentSimulation,
} from "./ai-handlers/aiManaActivationHelpers.js";
import { snapshotAIAbilityActivationState } from "./ai-handlers/aiAbilityActivationSnapshot.js";
import {
  buildAIAvailableManaForSpellPayment,
  buildAISpellPaymentPlan,
  canAIAssembleSpellPaymentPlan,
  chooseAssembleableSpellXValueFromStep,
  chooseAISacrificePermanentForManaAbility,
  chooseAISacrificePermanentsForManaAbility,
  chooseAISpellPaymentSelections,
  cloneAISpellPaymentSimulationGame,
  getAINonTapManaAbilityCandidates,
} from "./ai-handlers/aiSpellPaymentPlanHelpers.js";
import { getPaymentSources } from "./ai-handlers/aiPaymentSources.js";
import { handleAIPriority } from "./ai-handlers/aiPriorityHandlers.js";
import { findCastableSpells } from "./ai-handlers/aiFindCastableSpells.js";
import {
  checkShouldTapLandsForManaRetention,
  executeAITapLandsForMana,
} from "./ai-handlers/aiLandTapHandlers.js";
import { executeAIPlayLand, handleBounceLandETB } from "./ai-handlers/aiLandPlayHandlers.js";
import {
  executeAIActivateAbility,
  isAIManaBatteryChargeInvestAction,
} from "./ai-handlers/aiActivateAbilityHandlers.js";
import {
  buildAIActivatedAbilityResolverCandidates,
  didAIAbilityActivationProgress,
  requestAISharedBattlefieldAbilityActivation,
  resolveAIActivatedAbilityId,
} from "./ai-handlers/aiActivatedAbilityResolver.js";
import { calculateSpellPriority } from "./ai-handlers/aiSpellPriority.js";
import {
  captureAICastControlFlowSnapshot,
  didAICastAttemptChangeControlFlow,
  enumerateAIActionCandidates,
  tryAIResponseActions,
  waitForAISharedCastToSettle,
} from "./ai-handlers/aiActionCandidateHandlers.js";
import {
  applyAISelectedLandFace,
  findCastableCommander,
  findPlayableLand,
  isAIFailedSpellCastCard,
  isCardAlreadyOnBattlefield,
  rememberAIFailedSpellCast,
} from "./ai-handlers/aiLandAuraCommander.js";
import { requestAISharedCast, requestAISharedLandPlay } from "./ai-handlers/aiSharedCastLand.js";
import type {
  AIActionCandidate,
  AIActionCandidateQuery,
  AIActivatedAbilityCandidate,
  AICastableCommanderCandidate,
  AICastableSpellCandidate,
  AICastAttemptDescriptor,
  AICastRequestSourceZone,
  AIPlayableLandCandidate,
  AISupportedCardSourceZone,
} from "./ai-handlers/aiActionCandidateTypes.js";
import { setAIHandlerDeps } from "./aiHandlerDeps.js";
import { stampPermanentEntryTimestamp } from '../../../rules-engine/src/permanentTimestamps.js';

export { autoSelectAICommander, handleAIGameFlow, handleAIMulligan };
export {
  getAIPlayers,
  isAIPlayer,
  registerAIPlayer,
  rehydrateAIGameRuntime,
  rehydrateAIPlayerRuntime,
  unregisterAIPlayer,
};
export { clearScheduledAIActionsForGame, scheduleAIGameFlow, scheduleAIPriority };
export {
  chooseAIGraveyardSelectionIds,
  chooseAIHideawayCardId,
  chooseAILibrarySearchCards,
  chooseAILibrarySearchResponse,
  chooseAIReturnControlledPermanentId,
  chooseAIScrySelection,
  chooseAIUpkeepSacrificeSelection,
};
export { chooseAICardNameSelection, chooseAIPlayerChoiceId };
export {
  chooseAITargetSelectionsForChoiceStep,
  chooseAITargetsForSpell,
};
export {
  chooseAIKynaiosChoiceSelection,
  chooseAIModeSelectionsForStep,
};
export { chooseAIOptionSelectionsForStep };
export { cleanupGameAI };
export { chooseAIManaColorForActivation };
export { canAIAssembleSpellPaymentPlan, chooseAISpellPaymentSelections };
export { handleAIPriority };
export { handleBounceLandETB };
export { rememberAIFailedSpellCast };

export function chooseAIXValueSelection(game: any, playerId: PlayerID, step: any): number {
  if (step?.delayedDrawUpTo === true) {
    return chooseDelayedDrawUpToCount(game, playerId, step);
  }
  return chooseAssembleableSpellXValueFromStep(game, playerId, step);
}


function getAIManaLifeEffect(card: any, producesColoredMana: boolean): { amount: number; isDamage: boolean } {
  return resolveManaAbilityLifeEffect({ card, producesColoredMana });
}













function getAIActionContext(game: any): any {
  return {
    state: game?.state,
    libraries: game?.libraries,
  };
}

function getAIPlayerLibraryCards(game: any, playerId: PlayerID): any[] {
  const libraries = game?.libraries;
  if (libraries && typeof libraries.get === 'function') {
    const library = libraries.get(playerId);
    if (Array.isArray(library)) {
      return library;
    }
  }

  const fallbackLibrary = game?.state?.zones?.[playerId]?.library;
  return Array.isArray(fallbackLibrary) ? fallbackLibrary : [];
}

function getAITopLibraryCard(game: any, playerId: PlayerID): any | null {
  const library = getAIPlayerLibraryCards(game, playerId);
  return library[0] ?? null;
}

function getAIAttackingPermanents(game: any): any[] {
  const state = game?.state;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const declaredAttackerIds = new Set(
    (Array.isArray(state?.declaredAttackers) ? state.declaredAttackers : [])
      .map((entry: any) => String(entry?.creatureId || entry?.attackerId || entry?.id || entry || '').trim())
      .filter(Boolean),
  );

  return battlefield.filter((permanent: any) => {
    const permanentId = String(permanent?.id || '').trim();
    return Boolean(permanent?.attacking)
      || Boolean(permanent?.isAttacking)
      || (permanentId && declaredAttackerIds.has(permanentId));
  });
}

export function isAISpellContextuallyUseful(game: any, playerId: PlayerID, card: any): boolean {
  return isSpellCastBoardContextUseful(game, playerId, card, {
    excludeCardId: card?.id ? String(card.id) : undefined,
  });
}

function getAISourceCards(game: any, playerId: PlayerID, sourceZone: AISupportedCardSourceZone): any[] {
  if (sourceZone === 'library') {
    return getAIPlayerLibraryCards(game, playerId);
  }

  if (sourceZone === 'exile') {
    const exile = game?.state?.zones?.[playerId]?.exile;
    return Array.isArray(exile) ? exile : [];
  }

  if (sourceZone === 'graveyard') {
    const graveyard = game?.state?.zones?.[playerId]?.graveyard;
    return Array.isArray(graveyard) ? graveyard : [];
  }

  const hand = game?.state?.zones?.[playerId]?.hand;
  return Array.isArray(hand) ? hand : [];
}

function calculateResponseSpellPriority(
  card: any,
  game: any,
  playerId: PlayerID,
  adjustedCost?: { generic: number; colors: Record<string, number> },
): number {
  let priority = calculateSpellPriority(card, game, playerId, adjustedCost);
  const oracleText = String(card?.oracle_text || '').toLowerCase();
  const typeLine = String(card?.type_line || '').toLowerCase();
  const stack = Array.isArray(game?.state?.stack) ? game.state.stack : [];

  const isUntargetedStackWipe =
    /\bexile all (?:other )?spells\b/.test(oracleText)
    || /\bcounter all (?:activated and triggered )?abilities\b/.test(oracleText);
  const hasOpponentStackObject = stack.some((item: any) => {
    const controller = String(item?.controller || item?.controllerId || '').trim();
    return controller.length > 0 && controller !== String(playerId);
  });

  if (oracleText.includes('counter target') && stack.length > 0 && hasOpponentStackObject) {
    priority += 120;
  }

  if (isUntargetedStackWipe && hasOpponentStackObject) {
    priority += 120;
  }

  if ((oracleText.includes('destroy') || oracleText.includes('exile')) && !isUntargetedStackWipe) {
    priority += 45;
  }

  if (typeLine.includes('creature') && (/\bflash\b/i.test(oracleText) || oracleText.includes('reach'))) {
    priority += 25;
  }

  if (oracleText.includes('draw') && oracleText.includes('card')) {
    priority -= 10;
  }

  return priority;
}

function getSpellCmc(cost: { generic: number; colors: Record<string, number> }): number {
  return Number(cost?.generic || 0) + Object.values(cost?.colors || {}).reduce((sum, value) => sum + Number(value || 0), 0);
}

function getAIAdjustedSpellCost(game: any, playerId: PlayerID, card: any): ParsedManaCost {
  const manaCost = String(card?.mana_cost || card?.manaCost || '').trim();
  const parsedCost = parseManaCost(manaCost);

  if (!manaCost) {
    return normalizeParsedManaCost(parsedCost);
  }

  return normalizeParsedManaCost(
    applyCostAdjustmentToParsedCost(parsedCost, buildCostAdjustmentPlan(game?.state, String(playerId), card)),
  );
}








/**
 * Check the maximum hand size for a player (considering "no maximum hand size" effects)
 */
function getAIMaxHandSize(game: any, playerId: PlayerID): number {
  const battlefield = game.state?.battlefield || [];
  
  // Check for permanents that grant "no maximum hand size"
  for (const perm of battlefield) {
    if (perm && perm.controller === playerId) {
      const oracle = (perm.card?.oracle_text || '').toLowerCase();
      if (oracle.includes('you have no maximum hand size')) {
        return Infinity;
      }
    }
  }
  
  return 7; // Default maximum hand size
}

/**
 * Check if AI needs to discard cards during cleanup
 */
function needsToDiscard(game: any, playerId: PlayerID): { needsDiscard: boolean; discardCount: number } {
  const zones = game.state?.zones?.[playerId];
  const handSize = zones?.handCount ?? (Array.isArray(zones?.hand) ? zones.hand.length : 0);
  const maxHandSize = getAIMaxHandSize(game, playerId);
  
  if (maxHandSize === Infinity) {
    return { needsDiscard: false, discardCount: 0 };
  }
  
  const discardCount = Math.max(0, handSize - maxHandSize);
  return { needsDiscard: discardCount > 0, discardCount };
}

/**
 * Choose cards for AI to discard - prioritizes keeping castable and valuable spells
 * 
 * Priority for KEEPING (higher score = keep):
 * - No-max-hand-size permanents (Reliquary Tower / Thought Vessel): +250
 * - Lands: +100 (always valuable)
 * - Castable spells (can be cast next turn): +50
 * - Removal spells: +30
 * - Creatures: +20
 * - Low-CMC spells: +10 - CMC (easier to cast)
 * 
 * The AI should discard high-CMC spells it can't cast rather than
 * castable spells, even if those spells are technically "better"
 */
export function chooseCardsToDiscard(game: any, playerId: PlayerID, discardCount: number): string[] {
  const zones = game.state?.zones?.[playerId];
  const hand = Array.isArray(zones?.hand) ? zones.hand : [];
  const profile = ensureAIDeckProfile(game, playerId);
  const battlefield = (game.state?.battlefield || []).filter((perm: any) => perm?.controller === playerId);
  
  if (hand.length <= discardCount) {
    return hand.map((c: any) => c.id);
  }
  
  // Calculate available mana to determine castability
  const manaPool = getAvailableMana(game.state, playerId);
  const totalAvailableMana = getTotalManaFromPool(manaPool);
  
  // Score cards - lower score = more likely to discard
  const scoredCards = hand.map((card: any) => {
    let score = 50; // Base score
    const typeLine = (card?.type_line || '').toLowerCase();
    const oracleText = (card?.oracle_text || '').toLowerCase();

    // Reliquary Tower / Thought Vessel / Spellbook beat cheap castable spells.
    if (cardGrantsNoMaximumHandSize(card)) {
      score += 250;
    }
    
    // Keep lands (highest priority among remaining cards)
    if (typeLine.includes('land')) {
      score += 100;
      return { card, score };
    }
    
    // Calculate CMC
    const adjustedCost = getAIAdjustedSpellCost(game, playerId, card);
    const cmc = getSpellCmc(adjustedCost);
    
    // CASTABILITY CHECK: Strongly prefer keeping castable spells
    // A spell is "castable" if the AI can afford it with current/potential mana
    // Add +2 mana buffer for "next turn" (likely land drop)
    const canCastSoon = cmc <= totalAvailableMana + 2;
    const canCastNow = canPayManaCostWithAvailableSources(
      game.state,
      playerId,
      adjustedCost,
      Infinity,
      card?.id ? { excludedHandCardIds: [String(card.id)] } : undefined,
    );
    
    if (canCastNow) {
      score += 60; // Can cast right now - definitely keep
    } else if (canCastSoon) {
      score += 40; // Can likely cast next turn - prefer to keep
    } else if (cmc > totalAvailableMana + 4) {
      score -= 30; // Very expensive spell we can't cast for a while - consider discarding
    }
    
    // Keep low-cost spells (easier to cast)
    score += Math.max(0, 10 - cmc);
    
    // Keep creatures (good for board presence)
    if (typeLine.includes('creature')) {
      score += 20;
    }
    
    // Keep removal spells (interaction is important)
    if (oracleText.includes('destroy') || oracleText.includes('exile')) {
      score += 30;
    }
    
    // Keep mana rocks/ramp (acceleration)
    if (typeLine.includes('artifact') && (oracleText.includes('add {') || oracleText.includes('add one mana'))) {
      score += 35;
    }
    
    // Keep card draw spells
    if (oracleText.includes('draw') && (oracleText.includes('card') || oracleText.includes('cards'))) {
      score += 25;
    }

    const synergyPressure = calculateCardSynergyPressure(card, hand, battlefield, playerId, profile);
    score += synergyPressure;

    const analysis = cardAnalyzer.analyzeCard(card);
    if (profile?.primaryArchetypes.includes(SynergyArchetype.COMBO) && analysis.comboPotential >= 7) {
      score += 25;
    }
    if (!canCastSoon && cmc >= 6 && synergyPressure < 8) {
      score -= 12;
    }
    
    return { card, score };
  });
  
  // Sort by score (ascending) - lowest scores first (to discard)
  scoredCards.sort((a: any, b: any) => a.score - b.score);
  
  // Return the IDs of the cards with lowest scores
  return scoredCards.slice(0, discardCount).map((sc: any) => sc.card.id);
}

function scoreAIRevealCostCard(card: any): number {
  const typeLine = String(card?.type_line || '').toLowerCase();
  const oracleText = String(card?.oracle_text || '').toLowerCase();
  const manaValue = Math.max(0, Number(card?.cmc ?? card?.manaValue ?? card?.mana_value ?? 0) || 0);
  let score = manaValue * 3;

  if (typeLine.includes('land')) score -= 20;
  if (typeLine.includes('planeswalker')) score += 30;
  if (typeLine.includes('battle')) score += 15;
  if (typeLine.includes('creature')) score += 5;
  if (typeLine.includes('legendary')) score += 5;
  if (/\b(draw|destroy|exile|counter target|extra turn|tutor|search your library)\b/i.test(oracleText)) score += 8;

  return score;
}

function chooseAIRevealCostCards(availableCards: any[], amount: number): string[] {
  return [...availableCards]
    .sort((left: any, right: any) => (
      scoreAIRevealCostCard(left) - scoreAIRevealCostCard(right) ||
      String(left?.name || '').localeCompare(String(right?.name || '')) ||
      String(left?.id || '').localeCompare(String(right?.id || ''))
    ))
    .slice(0, Math.max(0, amount))
    .map((entry: any) => String(entry?.id || ''))
    .filter(Boolean);
}

function chooseAIAdditionalCostCardIds(game: any, playerId: PlayerID, step: any, amount: number): string[] {
  const availableCards = Array.isArray(step?.availableCards) ? step.availableCards : [];
  const costType = String(step?.costType || 'discard');
  if (costType === 'reveal') {
    return chooseAIRevealCostCards(availableCards, amount);
  }

  const selected: string[] = [];
  if (costType === 'discard') {
    const legalIds = new Set(availableCards.map((entry: any) => String(entry?.id || '')).filter(Boolean));
    for (const cardId of chooseCardsToDiscard(game, playerId, availableCards.length)) {
      const normalizedId = String(cardId || '');
      if (legalIds.has(normalizedId) && !selected.includes(normalizedId)) selected.push(normalizedId);
      if (selected.length >= amount) return selected;
    }
  }

  for (const entry of availableCards) {
    const id = String(entry?.id || '');
    if (id && !selected.includes(id)) selected.push(id);
    if (selected.length >= amount) break;
  }
  return selected;
}



/**
 * Execute AI casting a spell
 */
async function executeAICastSpell(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  candidate: AICastableSpellCandidate,
): Promise<boolean> {
  const game = ensureGame(gameId);
  if (!game) return false;

  const card = candidate.card;
  const sourceZone = candidate.sourceZone;
  const faceIndex = candidate.faceIndex;
  
  debug(1, '[AI] Casting spell:', {
    gameId,
    playerId,
    cardName: candidate.castCard?.name || card?.name,
    sourceZone,
    faceIndex,
    cost: candidate.cost,
    timesKicked: candidate.timesKicked,
  });

  return requestAISharedCast(io, gameId, playerId, {
    cardId: String(card?.id || ''),
    cardName: candidate.castCard?.name || card?.name,
    sourceZone,
    faceIndex,
    timesKicked: candidate.timesKicked,
  });
}

/**
 * Execute AI commander cast from command zone
 * Handles command tax, mana payment, and putting commander on stack
 */
async function executeAICastCommander(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  candidate: AICastableCommanderCandidate,
): Promise<boolean> {
  const game = ensureGame(gameId);
  if (!game) return false;

  debug(1, '[AI] Casting commander from command zone:', {
    gameId,
    playerId,
    cardName: candidate.card?.name,
    cost: candidate.cost,
  });

  return requestAISharedCast(io, gameId, playerId, {
    cardId: String(candidate.card?.id || candidate.commanderId || ''),
    cardName: candidate.card?.name,
    sourceZone: 'command',
  });
}



/**
 * Resolve AI's spell from the stack
 * 
 * @deprecated This function is not used. Spell resolution happens through
 * executePassPriority() which calls game.resolveTopOfStack() when all players
 * pass priority in succession. This function is kept for reference but should
 * not be called.
 */
async function resolveAISpell(
  io: Server,
  gameId: string,
  playerId: PlayerID
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  
  const stack = game.state?.stack || [];
  if (stack.length === 0) return;
  
  // Get top of stack (last item)
  const topItem = stack[stack.length - 1] as any;
  if (!topItem || topItem.controller !== playerId) return;
  
  debug(1, '[AI] Resolving spell:', topItem.card?.name);
  
  try {
    // Remove from stack
    stack.pop();
    
    const card = topItem.card as any;
    if (!card) return;
    
    const typeLine = (card.type_line || '').toLowerCase();
    
    // Determine where to put the resolved card
    if (typeLine.includes('creature') || typeLine.includes('artifact') || 
        typeLine.includes('enchantment') || typeLine.includes('planeswalker')) {
      // Permanents go to battlefield
      game.state.battlefield = game.state.battlefield || [];
      const permanent = {
        id: `perm_${Date.now()}_${card.id}`,
        controller: playerId,
        owner: playerId,
        card: { ...card, zone: 'battlefield' },
        tapped: false,
        counters: {},
        // For creatures, track summoning sickness
        summoningSickness: typeLine.includes('creature'),
      };
      game.state.battlefield.push(permanent as any);
      stampPermanentEntryTimestamp(game.state, game.state.battlefield[game.state.battlefield.length - 1]);
      debug(1, '[AI] Permanent entered battlefield:', card.name);
    } else {
      // Instants and sorceries go to graveyard
      const zones = game.state?.zones?.[playerId];
      if (zones) {
        zones.graveyard = zones.graveyard || [];
        (zones.graveyard as any[]).push({ ...card, zone: 'graveyard' });
        zones.graveyardCount = (zones.graveyard as any[]).length;
      }
      debug(1, '[AI] Spell resolved to graveyard:', card.name);
    }
    
    // Bump sequence
    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    
    // Broadcast updated state
    broadcastGame(io, game, gameId);
    
  } catch (error) {
    debugError(1, '[AI] Error resolving spell:', error);
  }
}


/**
 * Handle AI Resolution Queue step responses
 * This handles trigger ordering, Kynaios choices, Entrapment Maneuver, and other player interactions
 */
export async function handleAIResolutionStep(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  step: any
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  
  debug(1, `[AI] Handling Resolution Queue step: ${step.type}`, { stepId: step.id });
  
  try {
    // Helper to create a properly typed response
    const createResponse = (selections: any, cancelled = false) => ({
      stepId: step.id,
      playerId,
      selections,
      cancelled,
      timestamp: Date.now(),
    });
    
    switch (step.type) {
      case 'trigger_order':
      case 'kynaios_choice':
      case 'target_selection':
      case 'mutate_target_selection':
      case 'option_choice':
      case 'modal_choice':
        await handleAIResolutionTriggerAndChoiceSteps(io, gameId, game, playerId, step, createResponse);
        break;


      case 'mode_selection':
      case 'graveyard_selection':
      case 'library_search':
      case 'player_choice':
      case 'color_choice':
      case 'creature_type_choice':
      case 'card_name_choice':
      case 'opening_hand_actions':
        await handleAIResolutionSearchAndNameSteps(io, gameId, game, playerId, step, createResponse);
        break;


      case 'x_value_selection':
      case 'mana_color_selection':
      case 'discard_selection':
      case 'scry':
      case 'surveil':
      case 'bottom_order':
      case 'lim_duls_vault':
      case 'dance_with_calamity':
      case 'dance_with_calamity_cast':
      case 'hand_to_bottom':
      case 'join_forces':
      case 'fight_target':
      case 'tap_untap_target':
      case 'counter_movement':
      case 'counter_target':
      case 'station_creature_selection':
      case 'life_payment':
      case 'additional_cost_payment':
      case 'squad_cost_payment':
        await handleAIResolutionPaymentAndTargetSteps(io, gameId, game, playerId, step, createResponse);
        break;


      case 'explore_decision':
      case 'batch_explore_decision':
      case 'mana_payment_choice':
      case 'tempting_offer':
      case 'activated_ability':
      case 'cascade':
      case 'ponder_effect':
      case 'devour_selection':
      case 'suspend_cast':
      case 'morph_turn_face_up':
      case 'proliferate':
      case 'fateseal':
      case 'clash':
      case 'vote':
      case 'two_pile_split':
      case 'riot_choice':
      case 'unleash_choice':
      case 'fabricate_choice':
      case 'tribute_choice':
      case 'extort_payment':
      case 'keyword_choice':
      case 'exploit_choice':
      case 'backup_choice':
      case 'mentor_target':
      case 'enlist_choice':
      case 'modular_choice':
      case 'soulshift_target':
      case 'haunt_target':
      case 'upkeep_sacrifice':
      case 'return_controlled_permanent_choice':
      case 'hideaway_choice':
        await handleAIResolutionKeywordAndMiscSteps(io, gameId, game, playerId, step, createResponse);
        break;

      
      default: {
        // For unknown step types, try to decline or provide empty response
        debug(1, `[AI] Unknown Resolution Queue step type: ${step.type}, attempting to skip`);
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse([]));
      }
    }

    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }

    broadcastGame(io, game, gameId);

  } catch (err) {
    debugError(1, `[AI] Error handling Resolution Queue step: ${step.type}`, err);
  }
}


export function registerAIHandlers(io: Server, socket: Socket): void {
  registerAIHandlersImpl(io, socket);
}



setAIHandlerDeps({
  handleAIGameFlow,
  handleAIPriority,
  handleAIResolutionStep,
  handleAIMulligan,
  isAIPlayer,
  chooseCardsToDiscard,
  scoreAISacrificePermanentForManaAbility,
  findZoneCardById,
  chooseAIManaColorForActivation,
  getAIAttackingPermanents,
  getPaymentSources,
  chooseAIXValueSelection,
  chooseAIAdditionalCostCardIds,
  chooseAISpellPaymentSelections,
  getAIManaLifeEffect,
  resolveAIActivatedAbilityId,
  chooseAISacrificePermanentForManaAbility,
  chooseAIReturnToHandPermanentForManaAbility,
  buildAIActivatedAbilityResolverCandidates,
  executeAIActivateAbility,
  cloneAISpellPaymentSimulationGame,
  buildAISpellPaymentPlan,
  chooseAISacrificePermanentsForManaAbility,
  buildAIAvailableManaForSpellPayment,
  getAINonTapManaAbilityCandidates,
  tryAIResponseActions,
  enumerateAIActionCandidates,
  captureAICastControlFlowSnapshot,
  didAICastAttemptChangeControlFlow,
  getAIActionContext,
  getAIMaxHandSize,
  checkShouldTapLandsForManaRetention,
  executeAITapLandsForMana,
  executeAIPlayLand,
  executeAICastSpell,
  executeAICastCommander,
  isAISpellContextuallyUseful,
  calculateResponseSpellPriority,
  isAIFailedSpellCastCard,
  calculateSpellPriority,
  getAISourceCards,
  applyAISelectedLandFace,
  requestAISharedLandPlay,
  didAIAbilityActivationProgress,
  requestAISharedBattlefieldAbilityActivation,
  getSpellCmc,
  findPlayableLand,
  findCastableCommander,
});




