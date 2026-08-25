// server/src/state/modules/oracleIrServerZoneSync-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/state/modules/oracleIrServerZoneSync.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays server/src/state/modules/oracleIrServerZoneSync.ts.

// Post-execution mirroring of an Oracle IR result back onto server game state:
// exile provenance, copy-token provenance, prepared state, linked exiles,
// reanimation riders, end-step token sacrifice/exile scheduling, impulse draws,
// temporary granted abilities, and temporary P/T modifiers.
export {
  syncIrGraveyardExilesToSourcePermanentExiledCards,
  syncIrCopyTokenProvenanceFromOracleIRResult,
  syncIrPreparedStateFromOracleIRResult,
  syncIrLinkedExilesFromOracleIRResult,
  syncIrReanimationRidersFromOracleIRResult,
  syncIrAtNextEndStepTokenSacrificeFromOracleIRResult,
  syncIrImpulseExileToPendingImpulseDraws,
  syncIrTemporaryGrantEffectsToServerTemporaryAbilities,
  syncIrPowerToughnessModifiersToTemporaryPTMods,
} from "./oracleIrServerPostExecutionStateSync.js";

// LIBRARY_SEARCH / TWO_PILE_SPLIT / OPTION_CHOICE queues for look-choose-from-top,
// look-select-top, search-library, and choose-pile automation gaps.
export {
  queueLookChooseChoicePromptsFromOracleIRResult,
  queueSearchLibraryChoicePromptsFromOracleIRResult,
  queueChoosePileChoicePromptsFromOracleIRResult,
} from "./oracleIrServerLibrarySearchLookChoosePilePrompts.js";

// JOIN_FORCES / VOTE queues for join-forces contribution and council-vote
// automation gaps.
export {
  queueJoinForcesPromptsFromOracleIRResult,
  queueVotePromptsFromOracleIRResult,
} from "./oracleIrServerVoteJoinForcesPrompts.js";

// TAP_UNTAP_TARGET queues for tap-or-untap and tap-matching-permanents
// automation gaps.
export {
  queueTapMatchingPermanentsChoicePromptsFromOracleIRResult,
  queueTapOrUntapChoicePromptsFromOracleIRResult,
} from "./oracleIrServerTapUntapChoicePrompts.js";

// EXPLORE_DECISION / TARGET_SELECTION queues for explore, populate, and
// change-target automation gaps.
export {
  queueExploreChoicePromptsFromOracleIRResult,
  queuePopulateChoicePromptsFromOracleIRResult,
  queueChangeTargetChoicePromptsFromOracleIRResult,
} from "./oracleIrServerExplorePopulateChangeTargetPrompts.js";

// Repeated-zone-draft / separate-into-piles / library-chaos-exchange queues.
export {
  queueRepeatedZoneDraftChoicePromptFromOracleIRResult,
  queueSeparateIntoPilesPromptsFromOracleIRResult,
  bridgeLibraryChaosExchangeFromOracleIRResult,
} from "./oracleIrServerZoneDraftPilesChaosPrompts.js";

// Copy-permanent and move-zone TARGET_SELECTION / LIBRARY_SEARCH queues.
export {
  queueCopyPermanentChoicePromptsFromOracleIRResult,
  queueMoveZoneChoicePromptsFromOracleIRResult,
  queueMoveZoneDestinationChoicePromptsFromOracleIRResult,
} from "./oracleIrServerCopyPermanentMoveZonePrompts.js";

// Impulse-exile play, discover cast-or-hand, and GY-cast permission sync.
export {
  collectGrantGraveyardPermissionModifyMetadata,
  resolveGrantGraveyardCastChoiceCard,
  syncGraveyardCastFreeExilePermissionsFromOracleIR,
  syncImpulseExilePlayPermissionsToState,
  queueChooseOneImpulseExilePlayPromptsFromOracleIRResult,
  queueDiscoverCastOrHandPromptsFromOracleIRResult,
} from "./oracleIrServerImpulseDiscoverGyPermissionPrompts.js";

// Optional-step choice prompts and optional life-payment helpers.
export {
  applyOracleIrOptionalLifePayment,
  resolveOptionalPayLifeAmount,
  queueOptionalStepChoicePromptsFromOracleIRResult,
} from "./oracleIrServerOptionalStepChoicePrompts.js";

// Unqueued continuation persist and next-spell cost-reduction sync.
export {
  persistUnqueuedPendingContinuationFromOracleIRResult,
  syncNextSpellCostReductionFromOracleIRResult,
} from "./oracleIrServerPendingContinuationAndCostReduction.js";

// UNLESS_PAY choice queues.
export { queueUnlessPayChoicePromptsFromOracleIRResult } from "./oracleIrServerUnlessPayChoicePrompts.js";

// Add-mana color and add-counter / counter-distribution TARGET_SELECTION queues.
export {
  poolKeyToManaSymbol,
  buildChosenManaFromDistribution,
  queueAddManaChoicePromptsFromOracleIRResult,
  queueAddCounterTargetSelectionPromptsFromOracleIRResult,
  queueCounterDistributionPromptsFromOracleIRResult,
} from "./oracleIrServerManaCounterChoicePrompts.js";

// Connive, among-them player choice, and pending-discard sync.
export {
  queueConniveChoicePromptsFromOracleIRResult,
  queuePlayerChoicePromptsFromOracleIRResult,
  syncIrPendingDiscardFromOracleIRResult,
} from "./oracleIrServerConnivePlayerChoicePrompts.js";

// Land-from-hand / both-players-put-permanent prompts.
export {
  queueControllerMayPutLandFromHandPromptsFromOracleIRResult,
  queueEachPlayerMayPutLandFromHandPromptsFromOracleIRResult,
  queueBothPlayersMayPutPermanentFromHandPromptsFromOracleIRResult,
} from "./oracleIrServerLandFromHandPrompts.js";

// Discard and proliferate choice queues.
export {
  queueDiscardChoicePromptsFromOracleIRResult,
  queueProliferateChoicePromptsFromOracleIRResult,
} from "./oracleIrServerDiscardProliferatePrompts.js";

// Redistribute-life and flip-coin life-stakes queues.
export {
  queueRedistributeLifeTotalsPromptsFromOracleIRResult,
  queueFlipCoinLifeStakesPromptsFromOracleIRResult,
} from "./oracleIrServerLifeFlipCoinPrompts.js";

// Player-zone hydrate/sync, delayed flicker/draw bridges.
export {
  enrichBattlefieldTokenImages,
  buildShadowProbeContext,
  hydrateOracleIRPlayerZonesFromContext,
  snapshotGraveyardCardIds,
  snapshotExileCardIds,
  bridgeScheduleDelayedDrawAtNextUpkeepFromOracleIRResult,
  bridgeScheduleDelayedFlickerReturnsFromOracleIRResult,
  syncOracleIRPlayerZonesToContext,
  syncAllOracleIRPlayerZonesAfterResolution,
} from "./oracleIrServerZoneHydrateDelayedBridges.js";

// Mill replacement, counter replacement, prepared-copy sync.
export {
  snapshotBattlefieldControllers,
  snapshotBattlefieldCounters,
  syncCounterReplacementEffectsAfterOracleIR,
  syncPreparedCopiesAfterBattlefieldControllerChanges,
  syncPreparedCopiesFromControlChangeEffects,
  applyMillReplacementEffectsToSteps,
} from "./oracleIrServerMillCounterPreparedSync.js";

// applyOracleIRStepsOnServer plus the sacrifice trampoline it uses.
export { applyOracleIRStepsOnServer } from "./oracleIrServerApplyOnServer.js";
export { bindQueueSacrificeChoicePromptsFromOracleIRResult } from "./oracleIrServerApplyDeps.js";

// Sacrifice prompts, unless-pay/discard resume, remaining-step resume, choice apply.
export {
  extractOracleIrSelectionIds,
  maybeApplyOracleIrChoiceStepFromResolution,
  resumeOracleIRRemainingStepsFromResolution,
  resumeOracleIRStepWithChoiceFromResolution,
  resumeOracleIRUnlessDiscardsFromResolution,
  resumeOracleIRUnlessPayFromResolution,
} from "./oracleIrServerResumeAndChoiceApply.js";

// Any-player-may payment parse/queue/resume.
export {
  parseAnyPlayerMayPaymentJson,
  resumeAnyPlayerMayAfterChoice,
  maybeQueueAnyPlayerMayPaymentSelection,
  resolveOracleIrAnyPlayerMayPaymentSelectionFromResolution,
} from "./oracleIrServerAnyPlayerMayPrompts.js";
