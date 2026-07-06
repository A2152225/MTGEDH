/**
 * Re-export barrel for stack resolution. Production code imports orchestrator
 * modules directly; this file preserves the public surface for external callers.
 */
export { executeTriggerEffect } from './stackExecuteTriggerEffectUtils.js';
export { tryApplyTriggerEffectPrefaceHandlers } from './stackExecuteTriggerEffectPrefaceUtils.js';
export { tryApplyTriggerEffectLegacyBodyHandlers } from './stackExecuteTriggerEffectLegacyBodyUtils.js';
export { tryApplyTriggerEffectLegacyTailHandlers } from './stackExecuteTriggerEffectTailUtils.js';
export { applyOracleIRFallbackForTriggeredEffect } from './stackExecuteTriggerEffectIrFallbackUtils.js';
export {
  isTriggerEffectOwnedByOracleIrPrimary,
  shouldSkipLegacyTriggerBodyHandlers,
  shouldSkipLegacyTriggerRegexHandlers,
  skipRetiredTriggerLegacyHandler,
} from './oracleIrTriggerLegacyRouting.js';
export { resolveTopOfStack } from './stackResolveTopOfStackUtils.js';
export type {
  ExecuteTriggerEffectFn,
  InstantSorceryOracleIrSpellOptions,
  InstantSorceryOracleIrSpellOutcome,
  InstantSorceryPrefaceContinuation,
  InstantSorceryPrefaceOptions,
  InstantSorceryPrefaceResult,
  InstantSorceryPrefaceSpellShapeFields,
  InstantSorceryRemovalTargetMetadata,
  InstantSorceryRemovalTargetMetadataOptions,
  InstantSorcerySpellShapeFlags,
  InstantSorceryStackResolveOptions,
  PermanentBattlefieldEntryOptions,
  PermanentBattlefieldEntryOutcome,
  PermanentSpellPostEntryOptions,
  PermanentSpellStackResolveOptions,
  ResolveTopOfStackContinuation,
  ResolveTopOfStackPrefaceResult,
  StackActivatedAbilityHandlerContext,
  StackActivatedAbilityLateHandlerDeps,
  StackActivatedAbilityLateHandlerOptions,
  TriggeredAbilityDeferralOptions,
  TriggeredAbilityStackResolveOptions,
  TriggerEffectLegacyBodyContinuation,
  TriggerEffectLegacyBodyResult,
} from './stackResolveSharedTypes.js';
export { tryPrepareResolveTopOfStackContext } from './stackResolveTopOfStackPrefaceUtils.js';
export { tryDispatchResolvedStackItem } from './stackResolveTopOfStackDispatchUtils.js';
export { resolvePermanentSpellStackItem } from './stackResolvePermanentSpellOrchestratorUtils.js';
export { isPermanentTypeLine } from './stackResolvePermanentSpellTypeUtils.js';
export { applyPermanentSpellPostEntrySteps } from './stackResolvePermanentSpellPostEntryUtils.js';
export { finalizeResolveTopOfStackAfterEffects } from './stackResolveTopOfStackPostResolutionUtils.js';

export {
  applyPermanentBecomeCopyOfTargetPermanent,
  applyPermanentBecomeCopyOfCardData,
  findExiledCardById,
} from './permanent-copy.js';
export {
  buildInterveningIfSubjectSnapshot,
  buildTriggerSourcePermanentSnapshot,
  getTriggerSourcePermanent,
  resolvePreparedTargetPermanent,
  resolveTriggeredAbilityTargetPlayerId,
} from './triggerSourceUtils.js';
export {
  addTemporaryEtbTrigger,
  clearTemporaryEtbTriggers,
  queueSelfETBTriggersForPermanent,
  triggerETBEffectsForToken,
} from './triggerEtbEntryEffects.js';
export { inferTriggeredAbilityTargetMetadata } from './inferTriggeredAbilityTargetMetadata.js';
export { appendQueuedResolutionPromptEvent, queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';
export { queueLandPlayFromHandPrompt } from './triggerLandPlayPromptUtils.js';
export { enqueueSupportedKeywordChoiceStep } from './triggerKeywordChoiceUtils.js';
export { applyTriggeredReanimationEntryRiders, applyPermanentKeywordGrantFromText } from './triggerReanimationRiders.js';
export { attachEquipmentToCreature } from './triggerEquipmentUtils.js';
export { triggerETBEffectsForPermanent } from './triggerEtbPermanentEffects.js';
export { queueDealsDamageToPlayerTriggersFromPermanent } from './triggerLifeDamageUtils.js';
export { buildMyriadTokenCopy, applyMyriadTokenCopies } from './triggerMyriadTokenUtils.js';
export { resolveChosenTypeCounterEachCreature } from './triggerChosenTypeCounterUtils.js';
export { millCardsFromLibrary, getOrCreatePlayerZones } from './triggerLibraryMillUtils.js';
export { enqueueLibrarySearchStep } from './triggerLibrarySearchUtils.js';
export { queueInitiativeVentureTrigger, resolveVentureProgress } from './triggerVentureUtils.js';
export { queuePlayableFromExileChoiceStep } from './triggerPlayableFromExileUtils.js';
export { executeSpellEffect, scheduleExiledCardReturnToBattlefield, returnExiledCardToBattlefield } from './executeSpellEffect.js';
export { detectEntersWithCounters } from './detectEntersWithCounters.js';
export { checkPermanentEntersTapped, checkCreatureEntersTapped } from './triggerPermanentEntersTapped.js';
export { creatureWillHaveHaste } from './creatureEntryHasteUtils.js';
export {
  applyDivineReckoningBatchResult,
  applyPrisonersDilemmaBatchResult,
  clearDivineReckoningChoiceBatch,
  clearPrisonersDilemmaChoiceBatch,
  computePrisonersDilemmaDamage,
  createDivineReckoningChoiceBatch,
  createPrisonersDilemmaChoiceBatch,
  recordDivineReckoningChoice,
  recordPrisonersDilemmaChoice,
} from './spellLegacyChoiceBatchUtils.js';
export { queueTributeChoiceOnEntry } from './triggerTributeChoiceUtils.js';
export { parseCommonArtifactTokenOptions, createTreasureToken } from './oracleIrSpellLegacyArtifactTokenUtils.js';
export { createBeastToken } from './oracleIrSpellLegacyTokenUtils.js';
export { applySpellLegacyRemovalArtifactRiders, applySpellLegacyRemovalRiders } from './oracleIrSpellLegacyRemovalRiderUtils.js';
export { checkOpponentHasMoreLands } from './stackLandCountUtils.js';
export {
  moveFizzledStackSpellCard,
  shouldFizzleStackSpellForMissingTargets,
} from './stackTargetLegalityUtils.js';
export { applySpellLegacySpecialSpellRiders } from './oracleIrSpellLegacySpecialSpellRiderUtils.js';
export { repairReplayCardSourceZones } from './stackReplayUtils.js';
export { playLand } from './stackPlayLandUtils.js';
export { castSpell } from './stackCastSpellUtils.js';
export { pushStack } from './stackPushUtils.js';
export { resolveStackItemEffectiveCard } from './stackResolveEffectiveCardUtils.js';
export { tryResolveStackActivatedAbilityEarlyHandlers, tryResolveStackActivatedAbilityMidHandlers, tryResolveStackActivatedAbilityLateHandlers } from './stackResolveAbilityHandlersUtils.js';
export { tryResolveInstantSorceryPreResolutionChoices } from './stackResolveSpellChoiceUtils.js';
export { tryResolveAcademicProbationSpellEffects } from './stackResolveSpellAcademicProbationUtils.js';
export { applyInstantSorcerySpecialCaseSpellEffects, applyInstantSorceryNibelheimAflameEffect } from './stackResolveSpellSpecialCaseUtils.js';
export { captureInstantSorceryRemovalTargetMetadata } from './stackResolveSpellTargetMetadataUtils.js';
export { tryResolveInstantSorceryOracleIrSpell } from './stackResolveSpellOracleIrUtils.js';
export { executeInstantSorceryLegacyCategorizedSpell } from './stackResolveSpellLegacySpecUtils.js';
export { tryApplyInstantSorceryUncategorizedSpellFallback } from './stackResolveSpellUncategorizedUtils.js';
export {
  resolveInstantSorceryGraveyardEffectiveOracleText,
  applyInstantSorceryGraveyardZoneChangeAutomation,
} from './stackResolveSpellGraveyardAutomationUtils.js';
export {
  applyInstantSorceryCopyStackSpellRiders,
  applyInstantSorceryFracturedIdentityAndFallbackRiders,
  applyInstantSorceryPostCategorizeSpellRiders,
} from './stackResolveSpellPostCategorizeRidersUtils.js';
export {
  logLegacySpellRegexPrimaryMiss,
} from './stackResolveSpellLegacyRegexDrawUtils.js';
export { applyInstantSorceryControlChangeAndMassZoneEffects } from './stackResolveSpellControlChangeUtils.js';
export {
  applyInstantSorceryTokenForEachCreatureHandler,
  applyInstantSorceryLibrarySearchSpellHandlers,
} from './stackResolveSpellLibraryHandlersUtils.js';
export { applyInstantSorceryJoinForcesAndTemptingOfferHandlers } from './stackResolveSpellMultiplayerPromptUtils.js';
export { applyInstantSorceryLibraryTopCardPromptHandlers } from './stackResolveSpellLibraryTopPromptUtils.js';
export { applyInstantSorcerySpecialAndRemovalRiders } from './stackResolveSpellLateRidersUtils.js';
export { resolveInstantOrSorceryStackItem } from './stackResolveInstantSorceryOrchestratorUtils.js';
export { tryResolveInstantSorceryPreface } from './stackResolveInstantSorceryPrefaceUtils.js';
export { tryResolveInstantSorceryLegacyResolution } from './stackResolveInstantSorceryLegacyResolutionUtils.js';
export { tryApplyInstantSorceryLegacyBodyHandlers } from './stackResolveInstantSorceryLegacyBodyUtils.js';
export { resolveTriggeredAbilityStackItem } from './stackResolveTriggeredAbilityOrchestratorUtils.js';
export { tryDeferTriggeredAbilityBeforeExecution } from './stackResolveTriggeredAbilityDeferralUtils.js';
export { tryResolveTriggeredAbilityChosenTypeEffects } from './stackResolveTriggeredAbilityChosenTypeUtils.js';
export { queuePermanentAsEntersBattlefieldChoiceSteps } from './stackResolvePermanentEtbChoiceUtils.js';
export { queuePermanentEntersBattlefieldTriggerStackItems } from './stackResolvePermanentEtbTriggerUtils.js';
export { resolvePermanentSpellBattlefieldEntry } from './stackResolvePermanentEntryUtils.js';
export { applyPermanentSquadTokenCopiesOnEntry } from './stackResolvePermanentSquadUtils.js';
export { trySkipTriggeredAbilityForUnmetInterveningIf } from './stackResolveTriggeredAbilityInterveningIfUtils.js';
export { queueOptionalTriggeredAbilityEffectProgram, tryDeferOptionalTriggeredAbilityMayDecision } from './stackResolveTriggeredAbilityOptionalUtils.js';
export { tryDeferTriggeredAbilitySpecialPrompts } from './stackResolveTriggeredAbilitySpecialPromptUtils.js';
export { tryDeferTriggeredAbilityTargetSelection } from './stackResolveTriggeredAbilityTargetPromptUtils.js';
export { moveResolvedInstantOrSorceryAfterResolution, finalizeResolvedInstantOrSorceryResolution, tryResolveApproachOfTheSecondSunAfterEffects } from './stackResolveSpellZoneUtils.js';
export {
  wasSpellCastFromGraveyard,
  buildResolvedSpellCopySnapshot,
  shouldQueueResolvedSpellCopyChoice,
  queueResolvedSpellCopyChoice,
} from './stackResolveSpellCopyChoiceUtils.js';
export {
  detectTopCardsToExileSelectionSpell,
  detectTopCardsToHandSelectionSpell,
  getPonderConfig,
  isDanceWithCalamitySpell,
  isExtraTurnSpell,
  isJoinForcesSpell,
  isLimDulsVaultSpell,
  isPonderStyleSpell,
  isTemptingOfferSpell,
  parseNumberWord,
  detectInstantSorcerySpellShapeFlags,
  shouldSkipLegacySpellCategorizationForInstantSorcery,
} from './oracleIrSpellLegacySpellShapeUtils.js';
export {
  isSpellEffectOwnedByOracleIrPrimary,
  shouldSkipLegacySpellBodyHandlers,
  shouldSkipLegacySpellRegexHandlers,
  skipRetiredSpellLegacyHandler,
} from './oracleIrSpellLegacyRouting.js';
export { manifestCard } from './stackManifestUtils.js';
export { exileEntireStack } from './stackExileUtils.js';
