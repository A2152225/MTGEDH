
export {
  applyGlobalImpulseUpgrades,
  mergeRevealFollowupAbilities,
  mergeSearchLibraryPutOnTopFollowupAbilities,
  mergeSearchLibraryToHandFollowupAbilities,
  mergeSearchLibraryShuffleFollowupAbilities,
  expandRepeatThisProcessOnceAbilities,
  mergeLookSelectTopFollowupAbilities
} from './oracleIRParserPostprocessSearchLibraryLookSelectImpulse';

export {
  pruneRedundantSurveilReminderSteps,
  mergeLookChooseFromTopAbilities,
  pruneThassaOracleWinGrantAbilities,
  mergeConditionalLookChooseFromTopAbilities,
  mergeTopLibraryBottomRandomTailAbilities,
} from './oracleIRParserPostprocessLookChooseFromTop';

export {
  enrichConditionalAmongThemHandRestAbilities,
  upgradeXAtLeastAlternateMoveDestinations,
  splitCompoundChosenCardsMoveZoneAbilities,
  mergeChooseCreatureTypePrefixAbilities,
  lowerAmongThemChoosePlayerChoiceAbilities,
  mergeAddManaRestrictionFollowupAbilities,
} from './oracleIRParserPostprocessAmongThemAndManaRestriction';

export {
  pruneRedundantProliferateReminderUnknownAbilities,
  expandRepeatedProliferateUnknownAbilities,
  clearKeywordActionRepetitionReplacementSteps,
} from './oracleIRParserPostprocessRepeatedProliferate';
import {
  counterRecordFromAddCounterStep,
  parseBattlefieldEntryCounterFollowupStep,
  parseDynamicCounterRider,
  stripMalformedDynamicWithCounters,
  parseSimpleCounterTailStep,
  parseLifeTailStep,
  splitExileAndCounterRiderStep,
  splitCounterAndDrawStep,
  splitLifeAndDrawStep,
  splitGainLifeAndDrawStep,
  splitDrawAndLifeStep,
} from './oracleIRParserPostprocessBattlefieldEntryCounterAndDrawLife';

export {
  counterRecordFromAddCounterStep,
  parseBattlefieldEntryCounterFollowupStep,
  parseDynamicCounterRider,
  stripMalformedDynamicWithCounters,
  parseSimpleCounterTailStep,
  parseLifeTailStep,
  splitExileAndCounterRiderStep,
  splitCounterAndDrawStep,
  splitLifeAndDrawStep,
  splitGainLifeAndDrawStep,
  splitDrawAndLifeStep,
};


export {
  enrichAnnihilatorGrantMetadataAbilities,
  enrichWardGrantMetadataAbilities,
} from './oracleIRParserPostprocessKeywordStaticGrantSteps';

export { parseBareTriggerEffectFragmentSteps } from './oracleIRParserPostprocessBareTriggerFragmentSteps';



export {
  expandActivatedAbilityCostReductionStaticAbilities,
  recoverDroppedActivationCostReductionStaticAbilities,
} from './oracleIRParserPostprocessActivationCostReductionStatics';

export { expandStandaloneStaticKeywordAbilities } from './oracleIRParserPostprocessStructuredTriggerResidualChain';



export { expandDynamicCounterRiderAbilities } from './oracleIRParserPostprocessDynamicCounterRiders';


export {
  repairQuotedStaticGrantAbilities,
  lowerCurrentResidualUnknownAbilities,
  collapseFlipCoinLifeStakesAbilities,
} from './oracleIRParserPostprocessResidualUnknownLowering';
export {
  expandStandaloneTopLibraryInfoAbilities,
  expandCastWithoutPayingFallbackAbilities,
  expandStandaloneKeywordCostAbilities,
  expandHideawayReminderAbilities,
  mergeKinshipRevealConditionalAbilities,
  bindImmediateTopLibraryReferenceFollowups,
} from './oracleIRParserPostprocessBattlefieldEntryAndTopLibraryFollowups';

export {
  mergeConditionalMoveZoneCounterFollowupAbilities,
  mergeBattlefieldEntryCharacteristicFollowupAbilities,
  mergeBattlefieldEntryAuraRewriteFollowupAbilities,
  upgradeExiledThisWayReturnMoveZoneSteps,
  upgradeReanimationHasteGrantSteps,
  upgradeCounteredSpellLibraryTopReplacementSteps,
  upgradeSpryAndMightyCompoundSteps,
  upgradeThoseCardsBattlefieldInsteadOfHandSteps,
  upgradeMoveZoneSelectorGapSteps,
  pruneBatch382MisparseExecutableSteps,
  expandDeterministicMoveZoneFollowupAbilities,
} from './oracleIRParserPostprocessMoveZoneFollowupUpgrades';
export {
  expandMoveZoneCopiedSpellAbilities,
  mergeDanglingCopySpellAbilities,
  expandMoveZoneHasteFollowupAbilities,
  expandLandAnimationUnknownAbilities,
  expandConditionalLookTopChooseOneToHandRestToGraveyardAbilities,
} from './oracleIRParserPostprocessMoveZoneCopyAndLandAnimationExpansions';

export {
  expandTapMatchingPermanentCountAbilities,
  expandSimpleConditionalUnknownAbilities,
  wrapIfYouDoConditionOnParsedAbilities,
  expandYouMayTransformIfYouDoAbilities,
  expandOtherwiseConditionalUnknownAbilities,
} from './oracleIRParserPostprocessDeterministicBodyAndConditionalExpansions';
export {
  upgradeConditionalIfYouDoImpulseAbilities,
  expandUnlessSacrificeAbilities,
} from './oracleIRParserPostprocessUnlessSacrificeConditionals';

export {
  expandExilePermissionUnknownAbilities,
  expandPayManaUnknownAbilities,
  expandBlightPrefixAbilities,
  expandGraveyardPermissionModifierUnknownAbilities,
} from './oracleIRParserPostprocessExileAndGraveyardPermissionModifiers';

export {
  restoreGrantedGraveyardAdditionalCostModifierRawAbilities,
  expandGraveyardAdditionalCostPermissionAbilities,
  expandKeywordManaCostGraveyardPermissionAbilities,
  expandDisturbKeywordAbilities,
  expandKeywordAdditionalCostGraveyardPermissionAbilities,
  expandUnearthKeywordAbilities,
} from './oracleIRParserPostprocessGraveyardAdditionalCostPermission';

export {
  pruneMorphReminderAbilities,
  pruneForetellReminderAbilities,
  upgradeManifestDreadGrantAbilities,
  pruneRedundantFaceDownReminderUnknownAbilities,
  pruneConvokeReminderAbilities,
  pruneCascadeReminderAbilities,
  pruneKickerReminderAbilities,
  pruneRedundantCascadeReminderUnknownAbilities,
  pruneRedundantPrototypeReminderUnknownAbilities,
  pruneRedundantBackupReminderUnknownAbilities,
  pruneCumulativeUpkeepReminderAbilities,
  pruneSoulbondReminderAbilities,
  pruneExtortReminderAbilities,
  pruneFirebendingReminderAbilities,
  pruneReadAheadReminderAbilities,
  pruneRedundantWaterbendReminderUnknownAbilities,
  pruneRedundantEarthbendReminderUnknownAbilities,
  pruneRedundantAirbendReminderUnknownAbilities,
  pruneMadnessReminderAbilities,
  pruneCleaveReminderAbilities,
  pruneCipherReminderAbilities,
  pruneRedundantAttackRequirementAbilities,
  pruneRedundantSpellCantBeCounteredAbilities,
} from './oracleIRParserPostprocessKeywordReminderPrunes';

export {
  expandFutureSpellEffectUnknownAbilities,
  pruneRedundantArtifactTokenReminderUnknownAbilities,
  pruneRedundantTokenDesignationReminderUnknownAbilities,
  pruneRedundantEldraziTokenManaReminderUnknownAbilities,
  pruneRedundantDecayedReminderUnknownAbilities,
  pruneRedundantEnchantAttachmentReminderUnknownAbilities,
  pruneRedundantProtectionAuraReminderUnknownAbilities,
  pruneRedundantHiddenAgendaRevealUnknownAbilities,
  pruneRedundantTimingRulesReminderUnknownAbilities,
} from './oracleIRParserPostprocessFutureSpellAndTokenReminderPrunes';
export { pruneRedundantTriggerEffectFragmentUnknownAbilities } from './oracleIRParserPostprocessTriggerEffectFragmentPrunes';
export {
  pruneRedundantCrewReminderAbilities,
  pruneRedundantChampionReminderAbilities,
  pruneLateKeywordReminderOnlyAbilities,
} from './oracleIRParserPostprocessCrewChampionLateKeywordPrunes';

export {
  isExternallyHandledOracleFragmentText,
  createExternallyHandledOracleFragmentGrantStep,
  pruneCurrentBatchReminderUnknownAbilities,
} from './oracleIRParserPostprocessReminderPlatformTextPredicates';
export {
  repairSubjectlessDrawAfterZoneShuffleAbilities,
  pruneRedundantVanishingReminderAbilities,
  pruneRedundantModularReminderAbilities,
  pruneRedundantBandingReminderUnknownAbilities,
  pruneExternallyHandledStaticUnknownAbilities,
  pruneExternallyHandledTemporaryLandBonusUnknownSteps,
  pruneRedundantTriggerRestrictionUnknownAbilities,
  pruneRedundantPhasingReminderUnknownAbilities,
  pruneRedundantStillLandUnknownAbilities,
} from './oracleIRParserPostprocessVanishingModularStaticPrunes';
export {
  pruneRedundantClashReminderUnknownAbilities,
  pruneRedundantScryReminderUnknownAbilities,
  pruneRedundantLookTopReorderUnknownAbilities,
  pruneRedundantExploreReminderAbilities,
  pruneMalformedExploreReminderMoveZoneSteps,
  pruneRedundantBestowReminderUnknownAbilities,
  lowerSelfEntryCounterReplacementAbilities,
  pruneRedundantEntersTappedReplacementUnknownAbilities,
  pruneRedundantInfectKeywordUnknownAbilities,
  pruneRedundantCoinFlipLeadUnknownAbilities,
  pruneRedundantLandwalkKeywordUnknownAbilities,
} from './oracleIRParserPostprocessClashScryExploreReminderPrunes';
export {
  expandScavengeKeywordAbilities,
  expandEmbalmKeywordAbilities,
  expandEternalizeKeywordAbilities,
  expandTransmuteKeywordAbilities,
  expandTypecyclingKeywordAbilities,
  expandTransfigureKeywordAbilities,
  expandEncoreKeywordAbilities,
  expandMyriadKeywordAbilities,
  expandMobilizeKeywordAbilities,
} from './oracleIRParserPostprocessGraveyardKeywordExpansions';

export {
  expandTokenCreationReplacementUnknownAbilities,
  annotateTokenCreationMetadataAbilities,
} from './oracleIRParserPostprocessTokenCreationMetadata';

export {
  annotateDrawMetadataAbilities,
  annotateLifeMetadataAbilities,
  annotateDestroyMetadataAbilities,
} from './oracleIRParserPostprocessDrawLifeDestroyMetadata';

export {
  annotateCounterMetadataAbilities,
  annotateSacrificeMetadataAbilities,
  annotateDamageMetadataAbilities,
} from './oracleIRParserPostprocessSacrificeCounterDamageMetadata';

export {
  pruneStaticMyriadReminderTailAbilities,
  expandParadigmKeywordAbilities,
  pruneDuplicateGraveyardReminderAbilities,
  pruneEquipmentBleedSteps,
  pruneIndestructibleDestroyReminderSteps,
  mergeConditionalGraveyardReminderFollowupAbilities,
  mergeExilePermissionCastCounterFollowupAbilities,
  expandMixedBattlefieldAndGraveyardExileAbilities,
  expandCompoundMoveZoneAbilities,
  expandChoiceUnknownAbilities,
  expandChosenColorProtectionAbilities,
} from './oracleIRParserPostprocessCompoundMoveZoneAndChoiceExpansions';

export {
  expandCopySpellUnknownAbilities,
  mergeChangeTargetRestrictionFollowupAbilities,
  pruneRedundantCastAdditionalCostUnknownAbilities,
  expandCopyChapterAbilityUnknownAbilities,
} from './oracleIRParserPostprocessCopySpellUnknownSteps';

export {
  mergeDieRollResultTableAbilities,
  mergeSagaChapterCopyFollowupAbilities,
  mergeCopyChapterAbilityFollowupAbilities,
  expandCopyPermanentUnknownAbilities,
  expandPreventDamageUnknownAbilities,
  expandWinLossUnknownAbilities,
  expandLeaveBattlefieldReplacementUnknownAbilities,
} from './oracleIRParserPostprocessDieRollAndReplacementExpansions';


export {
  expandGraveyardPermissionUnknownAbilities,
  expandGraveyardOrExilePermissionAbilities,
  expandFreeGraveyardCastPermissionAbilities,
} from './oracleIRParserPostprocessGraveyardCastPermission';

export {
  lowerAmassReminderAbilities,
  pruneRedundantAmassSubtypeReminderUnknownAbilities,
  lowerDiscoverKeywordAbilities,
  pruneRedundantDiscoverReminderUnknownAbilities,
  lowerConniveKeywordAbilities,
  lowerRecruitKeywordAbilities,
} from './oracleIRParserPostprocessAmassDiscoverConniveRecruitKeywords';
export {
  expandKeywordActionUnknownAbilities,
  expandTurnScopedStaticKeywordAbilities,
} from './oracleIRParserPostprocessKeywordActionUnknownSteps';
export {
  mergeDestroyCantRegenerateFollowupAbilities,
  expandVoteChoiceCountAbilities,
  pruneRedundantSpellTimingRestrictionUnknownAbilities,
  pruneRedundantActivationRestrictionUnknownAbilities,
  pruneRedundantXCantBeZeroUnknownAbilities,
  pruneRedundantStationChargeCounterReminderUnknownAbilities,
  pruneRedundantHandRevealDiscardChoiceUnknownAbilities,
  pruneRedundantBuybackCostReminderUnknownAbilities,
  pruneRedundantAnyPlayerMayActivateUnknownAbilities,
  pruneRedundantImpulseCleanupUnknownAbilities,
  mergeDeterministicKeywordFollowupAbilities,
  mergeDeterministicGraveyardPermissionFollowupAbilities,
  convertReminderSelfExilePermissionAbilities,
  expandMoveZoneAttachUnknownAbilities,
  expandCreateEmblemUnknownAbilities,
} from './oracleIRParserPostprocessVoteRestrictionAndEmblemExpansions';
export {
  repairSplitChooseModeBulletSteps,
  repairSplitChooseModeBulletAbilities,
  repairMoveZoneSelectorSteps,
  repairThatPlayerHandBottomThenDrawSteps,
  repairGraveyardChooseThenReturnSteps,
  repairCompoundExileLookSteps,
  repairEventideDrawLoseLifeSteps,
  repairRandomChooseModeSagaAbilities,
  repairMonarchInsteadConditionalAbilities,
  repairAdjacentSpellInsteadConditionalAbilities,
  repairTargetPlayerDrawThenDiscardSteps,
  repairRevealHandChooseFromItDiscardSteps,
  repairGapClosureAbilitySteps,
  pruneIgnorableEffectReminderUnknownSteps,
} from './oracleIRParserPostprocessGapClosureStepRepairs';
