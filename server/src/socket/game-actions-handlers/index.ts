/**
 * Internal agent TOC for clusters extracted from server/src/socket/game-actions.ts.
 *
 * Named re-exports only - no implementations, no `export *`. The public
 * compatibility barrel stays `server/src/socket/game-actions.ts`; leaves in this
 * folder must never import it (nor this index).
 */

// Spell/ability cost reduction, static cost taxes, convoke availability, cost metadata shapes.
export {
  calculateConvokeOptions,
  calculateCostReduction,
  calculateStaticSourceGenericTax,
  createEmptyCostReduction,
  detectBanneretTypeReduction,
  extractCreatureTypes,
  getSharedStaticCostAdjustments,
} from "./gameActionsCastCostReduction.js";

// Mana-cost adjustment arithmetic, adjusted-cost rendering, payment/pending-cast payloads.
export {
  applyCostAdjustment,
  applyCostReduction,
  buildAlternateCastSpellManaCost,
  buildPaymentCostAdjustmentPayload,
  buildPaymentStepCostAdjustment,
  buildPendingCastCostMetadata,
  countXManaSymbols,
  expandManaCostWithChosenX,
  formatManaCostWithCostAdjustment,
  formatManaCostWithReduction,
  formatSpellAlternateCostWithReduction,
  GRAVEYARD_ALTERNATE_CAST_ABILITY_IDS,
  isGraveyardAlternateCastAbilityId,
} from "./gameActionsCastCostFormatting.js";

// Cast-spell payment source resolution: permanent refs, activation costs, produced mana, checkpoints.
export {
  addCastSpellManaTotals,
  calculateCastSpellPaymentManaDelta,
  cardCanSpendManaAsAnyType,
  CAST_SPELL_PAYMENT_MANA_KEYS,
  consumeExplicitSelectedCastSpellMana,
  getFloatingPaymentPoolKey,
  getPaymentActivationCostInfo,
  getPaymentItemProducedManaTotals,
  getSupportedPaymentActivationManaCost,
  normalizeParsedSpellCostForAnyTypeManaSpending,
  paymentManaAbilityGrantsCreatureSpellHasteUntilEndOfTurn,
  paymentSacrificeCandidateMatches,
  resolvePaymentManaAbilityActivationCost,
  resolveSpellPaymentPermanentId,
  restorePlayerCastSpellPaymentCheckpoint,
  snapshotCastSpellManaPool,
  validateCastSpellPaymentPermanentUsage,
} from "./gameActionsCastSpellPaymentSources.js";

// Keyword/haste grant resolution across oracle text, attachments and battlefield-wide effects.
export {
  creatureHasHaste,
  permanentHasKeyword,
  permanentHasSummoningSickness,
} from "./gameActionsPermanentKeywordGrants.js";

// Turn-flow socket handlers lifted out of registerGameActions.
export {
  handleClaimMyTurnRequest,
  handleNextStepRequest,
  handleNextTurnRequest,
  handleRandomizeStartingPlayerRequest,
  handleSkipToPhaseRequest,
} from "./gameActionsTurnFlowSocketHandlers.js";

// Pre-game socket handlers lifted out of registerGameActions: restart and mulligan actions.
export {
  handleKeepHandRequest,
  handleMulliganRequest,
  handleRestartGameClearRequest,
  handleRestartGameRequest,
  handleUnkeepHandRequest,
} from "./gameActionsPregameSocketHandlers.js";

// Life, mill, and house-rules socket handlers lifted out of registerGameActions.
export {
  handleAdjustLifeRequest,
  handleMillRequest,
  handleSetHouseRulesRequest,
  handleSetLifeRequest,
} from "./gameActionsLifeMillHouseRulesSocketHandlers.js";

// Equip-ability socket handler lifted out of registerGameActions.
export { handleEquipAbilityRequest } from "./gameActionsEquipAbilitySocketHandlers.js";

// Board-selection socket handlers lifted out of registerGameActions: graveyard, opponent, sacrifice, control.
export {
  handleChangePermanentControlRequest,
  handleGraveyardTargetsRequest,
  handleOpponentSelectionRequest,
  handleSacrificeSelectionRequest,
} from "./gameActionsBoardSelectionSocketHandlers.js";

// Hand-layout socket handlers lifted out of registerGameActions: shuffle, reorder, battlefield pos, turn direction.
export {
  handleReorderHandRequest,
  handleSetTurnDirectionRequest,
  handleShuffleHandRequest,
  handleUpdatePermanentPosRequest,
} from "./gameActionsHandLayoutSocketHandlers.js";

// Priority socket handlers lifted out of registerGameActions: passPriority and resolveAllTriggers.
export {
  handlePassPriorityRequest,
  handleResolveAllTriggersRequest,
} from "./gameActionsPrioritySocketHandlers.js";

// Foretell / phase-out socket handlers lifted out of registerGameActions.
export {
  handleCastForetoldRequest,
  handleForetellCardRequest,
  handlePhaseOutPermanentsRequest,
} from "./gameActionsForetellPhaseOutSocketHandlers.js";

// Concede and trigger-shortcut socket handlers lifted out of registerGameActions.
export {
  handleConcedeRequest,
  handleSetTriggerShortcutRequest,
} from "./gameActionsConcedeShortcutSocketHandlers.js";

// Complete-cast-spell socket handler lifted out of registerGameActions.
export { handleCompleteCastSpellRequest } from "./gameActionsCompleteCastSpellSocketHandlers.js";

// Request-cast-spell socket wrapper lifted out of registerGameActions.
export { handleRequestCastSpellRequest } from "./gameActionsRequestCastSpellSocketHandlers.js";

// Turning a cast request into the shared castable-spell candidate it refers to.
export {
  applySharedCandidateFreeCastIntent,
  applySharedGraveyardCandidateMetadata,
  buildManaCostStringFromParsedCost,
  getDelegatedGraveyardCastAbilityId,
  getRequestedSpellCastCandidate,
} from "./gameActionsRequestedSpellCastCandidate.js";

// Additional costs on top of mana cost: harmonize, squad, reveal.
export {
  calculateHarmonizeOptions,
  getEffectiveAdditionalCost,
  getPendingSquadTimesPaidFields,
  getRecordedSquadTimesPaid,
  getRevealAdditionalCostCards,
  getSquadAdditionalManaCost,
  getSquadDisplayedCost,
} from "./gameActionsAdditionalCastCosts.js";

// handleCastSpellFromHand additional-cost prompts: Bargain, Squad, Teamwork, Behold, discard, sacrifice, pay life.
export { tryPromptCastSpellAdditionalCostsFromHand } from "./gameActionsCastSpellFromHandAdditionalCosts.js";

// handleCastSpellFromHand cast-time targeting: Aura hosts, spell targets, validation before payment.
export { tryPromptCastSpellTargetsFromHand } from "./gameActionsCastSpellFromHandTargets.js";

// handleCastSpellFromHand cost assembly + Harmonize/Convoke before tapping mana sources.
export { tryAssembleCastSpellCostAndConvokeFromHand } from "./gameActionsCastSpellFromHandCostConvoke.js";

// handleCastSpellFromHand mana-source payment: tap/sacrifice permanents and snapshot haste bounds.
export { tryApplyCastSpellManaPaymentFromHand } from "./gameActionsCastSpellFromHandManaPayment.js";

// handleCastSpellFromHand pool consumption plus Treasure/snow provenance.
export { tryConsumeCastSpellManaFromHand } from "./gameActionsCastSpellFromHandConsumeMana.js";

// handleCastSpellFromHand persist appendEvent(castSpell) plus on-cast trigger glue.
export { persistAndProcessCastSpellFromHand } from "./gameActionsCastSpellFromHandPersistOnCast.js";

// handleCastSpellFromHand modal / overload / pay-X-life prompts before additional costs.
export { tryPromptCastSpellModalOverloadLifeFromHand } from "./gameActionsCastSpellFromHandModalOverloadLife.js";

// handleCastSpellFromHand Force of Will, flash grants, and Abundant Harvest choice.
export { tryPromptCastSpellForceFlashFromHand } from "./gameActionsCastSpellFromHandForceFlash.js";

// requestCastSpellForSocket no-target additional costs plus MANA_PAYMENT_CHOICE.
export { tryQueueRequestCastSpellNoTargetPayment } from "./gameActionsRequestCastSpellNoTargetPayment.js";

// requestCastSpellForSocket timing, candidate lookup, and source-zone gates.
export { tryResolveRequestCastSpellCandidateZone } from "./gameActionsRequestCastSpellCandidateZone.js";

// requestCastSpellForSocket sorcery-speed, Gift, modes, X, Miracle, Madness, Mutate.
export { tryPromptRequestCastSpellModes } from "./gameActionsRequestCastSpellModes.js";

// requestCastSpellForSocket Aura/target compute, forced Mutate, with-targets queue.
export { tryComputeRequestCastSpellTargets } from "./gameActionsRequestCastSpellTargets.js";

// handleCastSpellFromHand payload, priority, zone, and land/chosen-name gates.
export { tryResolveCastSpellFromHandFront } from "./gameActionsCastSpellFromHandFront.js";

// handleCastSpellFromHand applyEvent stack push plus legacy pushStack fallback.
export { tryPushCastSpellFromHandToStack } from "./gameActionsCastSpellFromHandStackPush.js";

// handleCastSpellFromHand leftover orchestrator (prompts, RulesBridge, persist).
export { handleCastSpellFromHandRequest } from "./gameActionsCastSpellFromHand.js";

// requestCastSpellForSocket with-targets additional costs plus TARGET_SELECTION.
export { tryQueueRequestCastSpellWithTargets } from "./gameActionsRequestCastSpellWithTargets.js";

// handleCastSpellFromHand stack-item stamping after applyEvent (converge/haste/snow/additional cost).
export { stampCastSpellStackItemFromHand } from "./gameActionsCastSpellFromHandStackStamp.js";

// Casting from the command zone or library, and keyword alternate-cost payment extras.
export {
  buildAlternateCostPaymentExtrasForCast,
  buildCommandZoneCastManaCost,
  buildCommandZonePaymentCostAdjustment,
  findCommandZoneCommanderCandidate,
  getPendingCastPaymentFields,
  validateLibrarySpellCastAccess,
} from "./gameActionsCommandZoneAndAlternateCastCosts.js";

// Shared leaf: reading a player's cards out of a given zone.
export {
  getPlayerCommandZoneCards,
  getPlayerLibraryCards,
  getPlayerSpellSourceCards,
  getTopLibraryCard,
} from "./gameActionsPlayerZoneCards.js";

// Playing a land: request handling, top-of-library permission, battlefield entry and its ETB shape.
export {
  finalizePlayedLand,
  getRequestedLandPlayCandidate,
  handlePlayLandRequest,
  validateTopOfLibraryLandAccess,
} from "./gameActionsPlayLandRequest.js";

// In-flight cast guard: completing-cast marker, timing checks, pending-step lookup/restore.
export {
  canCompleteSpellCastAtCurrentTiming,
  clearPlayerCompletingSpellCast,
  findPendingSpellCastStep,
  isPlayerCompletingSpellCast,
  isSpellAlreadyOnStackForPlayer,
  markPlayerCompletingSpellCast,
  processOracleIRInteractions,
  restoreSuspendedLibrarySearchStep,
} from "./gameActionsSpellCastLock.js";

// What is being cast and for how much: effective base cost, miracle, suspend, card faces.
export {
  checkAndPromptMiracle,
  checkMiracle,
  getSuspendCastInfo,
  resolveAdventureAwareFaceIndex,
  resolveEffectiveSpellBaseManaCost,
  resolveSelectedSpellCard,
  WUBRG_ALTERNATE_MANA_COST,
} from "./gameActionsCastFaceAndMiracleSelection.js";

// Cost and oracle text for chosen modes: modal, entwine, escalate, additional-cost, overload.
export {
  adjustModalSpellInfoForCurrentCast,
  appendManaCost,
  getEntwineCostForSelectedModes,
  getOracleTextForCastMode,
  getSpellModeAdditionalCost,
  repeatManaCost,
} from "./gameActionsModalCastModeCosts.js";

// Pre-game readiness: free-mulligan house rule, mulligan counts, all-players-ready checks.
export {
  calculateEffectiveMulliganCount,
  checkAllPlayersHaveDecks,
  checkAllPlayersKeptHands,
  shouldMulliganBeFree,
} from "./gameActionsMulliganReadinessChecks.js";

// Prompts raised as a permanent enters: creature type, color, player choice, ETB triggers.
export {
  checkColorChoiceForNewPermanents,
  checkCreatureTypeSelectionForNewPermanents,
  checkEnchantmentETBTriggers,
  checkPlayerSelectionForNewPermanents,
  runPostResolutionPermanentPromptChecks,
} from "./gameActionsPermanentEntryPrompts.js";

// Which spell-cast triggers a cast produces, plus their per-turn bookkeeping.
export {
  createSpellCastTriggerToken,
  getSpellCastTriggersForCard,
  hasSpellCastTriggerTriggeredThisTurn,
  markSpellCastTriggerTriggeredThisTurn,
  normalizeSpellCastSourceZone,
  recordSpellCastThisTurn,
  resolveSpellCastOptionalPaymentChoice,
} from "./gameActionsSpellCastTriggerDetection.js";

// Running those spell-cast triggers: APNAP order, intervening-if, IR vs legacy routing.
export {
  processOpponentSpellCastTriggersForCast,
  processSpellCastTriggersForCast,
} from "./gameActionsSpellCastTriggerProcessing.js";

// Spell copies (immediate + delayed), copy retargeting, heroic / targeted / untap cast triggers.
export {
  appendCopyTriggeredSpellResolveEvent,
  applyHeroicTrigger,
  applySpellCastUntapTrigger,
  buildSpellCopyRetargetValidTargetsFallback,
  cloneTriggeredSpellCopy,
  consumeDelayedSpellCopiesForCast,
  getHeroicTriggers,
  parseCastSpellPower,
  persistQueuedSpellCastStepContinuation,
  processHeroicTriggersForTargets,
  processTargetedTriggersForSpellTargets,
  resolveSpellCopyRetargetValidTargets,
} from "./gameActionsSpellCopyHeroicTriggers.js";

// Spell target lists, grouped target metadata and per-clause target selection prompts.
export {
  buildGroupedSpellTargetMetadata,
  buildSpellTargetListFromRequirements,
  buildSpellTargetSelectionClauses,
  mapSpellTargetRefToDisplay,
  resolveTargetCount,
  shouldPreferParsedTargetReqs,
} from "./gameActionsSpellTargetSelection.js";

// IR-primary cast-time targeting from parseTargetRequirements (no categorize opcode table).
export {
  deriveSpellSpecFromParsedTargetReqs,
  parsedTargetReqsCoverCastTargets,
  resolveCastSpellParsedTargeting,
} from "./gameActionsCastSpellParsedTargeting.js";
