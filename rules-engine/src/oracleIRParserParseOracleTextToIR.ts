// Extracted from rules-engine/src/oracleIRParser.ts (chat B 40KB split campaign).
//
// Extracted from oracleIRParser.ts: the public parseOracleTextToIR pipeline.
//
// Public entry points:
//   parseOracleTextToIR

import type { OracleEffectStep, OracleIRAbility, OracleIRResult } from './oracleIR';
import { applyParseOracleTextToIRLatePasses } from './oracleIRParserParseOracleTextToIRLatePasses';
import {
  mergeAdditionalCombatContinuationAbilities,
  mergeSplitChooseModeParsedAbilities,
} from './oracleIRParserAbilityMerges';
import { parseAbilityToIRAbility as parseAbilityToIRAbilityFromModule } from './oracleIRParserAbilityToIR';
import { foldUnlessPaysMayPayOrFollowups } from './oracleIRParserPostprocessUnlessPaysMayPayOrFollowups';
import { expandChaosZoneTemplateAbilities } from './oracleIRParserChaosZoneTemplates';
import { mergeRevealTopShareTypeMayCastAbilities } from './oracleIRParserRevealTopShareTypeMayCast';
import {
  annotateCounterMetadataAbilities,
  annotateDamageMetadataAbilities,
  annotateDestroyMetadataAbilities,
  annotateDrawMetadataAbilities,
  annotateLifeMetadataAbilities,
  annotateSacrificeMetadataAbilities,
  annotateTokenCreationMetadataAbilities,
  applyGlobalImpulseUpgrades,
  bindImmediateTopLibraryReferenceFollowups,
  clearKeywordActionRepetitionReplacementSteps,
  collapseFlipCoinLifeStakesAbilities,
  convertReminderSelfExilePermissionAbilities,
  enrichAnnihilatorGrantMetadataAbilities,
  enrichConditionalAmongThemHandRestAbilities,
  enrichWardGrantMetadataAbilities,
  expandActivatedAbilityCostReductionStaticAbilities,
  expandBlightPrefixAbilities,
  expandCastWithoutPayingFallbackAbilities,
  expandChoiceUnknownAbilities,
  expandChosenColorProtectionAbilities,
  expandCompoundMoveZoneAbilities,
  expandConditionalLookTopChooseOneToHandRestToGraveyardAbilities,
  expandCopyChapterAbilityUnknownAbilities,
  expandCopyPermanentUnknownAbilities,
  expandCopySpellUnknownAbilities,
  expandCreateEmblemUnknownAbilities,
  expandDeterministicMoveZoneFollowupAbilities,
  expandDisturbKeywordAbilities,
  expandDynamicCounterRiderAbilities,
  expandEmbalmKeywordAbilities,
  expandEncoreKeywordAbilities,
  expandEternalizeKeywordAbilities,
  expandExilePermissionUnknownAbilities,
  expandFreeGraveyardCastPermissionAbilities,
  expandFutureSpellEffectUnknownAbilities,
  expandGraveyardAdditionalCostPermissionAbilities,
  expandGraveyardOrExilePermissionAbilities,
  expandGraveyardPermissionModifierUnknownAbilities,
  expandGraveyardPermissionUnknownAbilities,
  expandHideawayReminderAbilities,
  expandKeywordActionUnknownAbilities,
  expandKeywordAdditionalCostGraveyardPermissionAbilities,
  expandKeywordManaCostGraveyardPermissionAbilities,
  expandLandAnimationUnknownAbilities,
  expandLeaveBattlefieldReplacementUnknownAbilities,
  expandMixedBattlefieldAndGraveyardExileAbilities,
  expandMobilizeKeywordAbilities,
  expandMoveZoneAttachUnknownAbilities,
  expandMoveZoneCopiedSpellAbilities,
  expandMoveZoneHasteFollowupAbilities,
  expandMyriadKeywordAbilities,
  expandOtherwiseConditionalUnknownAbilities,
  expandParadigmKeywordAbilities,
  expandPayManaUnknownAbilities,
  expandPreventDamageUnknownAbilities,
  expandRepeatedProliferateUnknownAbilities,
  expandScavengeKeywordAbilities,
  expandSimpleConditionalUnknownAbilities,
  expandStandaloneKeywordCostAbilities,
  expandStandaloneStaticKeywordAbilities,
  expandStandaloneTopLibraryInfoAbilities,
  expandTapMatchingPermanentCountAbilities,
  expandTokenCreationReplacementUnknownAbilities,
  expandTransfigureKeywordAbilities,
  expandTransmuteKeywordAbilities,
  expandTurnScopedStaticKeywordAbilities,
  expandTypecyclingKeywordAbilities,
  expandUnearthKeywordAbilities,
  expandUnlessSacrificeAbilities,
  expandVoteChoiceCountAbilities,
  expandWinLossUnknownAbilities,
  expandYouMayTransformIfYouDoAbilities,
  lowerAmassReminderAbilities,
  lowerAmongThemChoosePlayerChoiceAbilities,
  lowerConniveKeywordAbilities,
  lowerCurrentResidualUnknownAbilities,
  lowerDiscoverKeywordAbilities,
  lowerRecruitKeywordAbilities,
  lowerSelfEntryCounterReplacementAbilities,
  mergeAddManaRestrictionFollowupAbilities,
  mergeBattlefieldEntryAuraRewriteFollowupAbilities,
  mergeBattlefieldEntryCharacteristicFollowupAbilities,
  mergeChooseCreatureTypePrefixAbilities,
  mergeConditionalGraveyardReminderFollowupAbilities,
  mergeConditionalLookChooseFromTopAbilities,
  mergeConditionalMoveZoneCounterFollowupAbilities,
  mergeCopyChapterAbilityFollowupAbilities,
  mergeDanglingCopySpellAbilities,
  mergeDestroyCantRegenerateFollowupAbilities,
  mergeDeterministicGraveyardPermissionFollowupAbilities,
  mergeDeterministicKeywordFollowupAbilities,
  mergeDieRollResultTableAbilities,
  mergeExilePermissionCastCounterFollowupAbilities,
  mergeKinshipRevealConditionalAbilities,
  mergeLookChooseFromTopAbilities,
  mergeLookSelectTopFollowupAbilities,
  mergeRevealFollowupAbilities,
  mergeSagaChapterCopyFollowupAbilities,
  mergeSearchLibraryPutOnTopFollowupAbilities,
  mergeSearchLibraryShuffleFollowupAbilities,
  mergeSearchLibraryToHandFollowupAbilities,
  mergeTopLibraryBottomRandomTailAbilities,
  parseBareTriggerEffectFragmentSteps,
  pruneBatch382MisparseExecutableSteps,
  pruneCascadeReminderAbilities,
  pruneCipherReminderAbilities,
  pruneCleaveReminderAbilities,
  pruneConvokeReminderAbilities,
  pruneCumulativeUpkeepReminderAbilities,
  pruneCurrentBatchReminderUnknownAbilities,
  pruneDuplicateGraveyardReminderAbilities,
  pruneEquipmentBleedSteps,
  pruneExternallyHandledStaticUnknownAbilities,
  pruneExternallyHandledTemporaryLandBonusUnknownSteps,
  pruneExtortReminderAbilities,
  pruneFirebendingReminderAbilities,
  pruneForetellReminderAbilities,
  pruneIndestructibleDestroyReminderSteps,
  pruneKickerReminderAbilities,
  pruneLateKeywordReminderOnlyAbilities,
  pruneMadnessReminderAbilities,
  pruneMalformedExploreReminderMoveZoneSteps,
  pruneMorphReminderAbilities,
  pruneReadAheadReminderAbilities,
  pruneRedundantActivationRestrictionUnknownAbilities,
  pruneRedundantAirbendReminderUnknownAbilities,
  pruneRedundantAmassSubtypeReminderUnknownAbilities,
  pruneRedundantAnyPlayerMayActivateUnknownAbilities,
  pruneRedundantArtifactTokenReminderUnknownAbilities,
  pruneRedundantAttackRequirementAbilities,
  pruneRedundantBackupReminderUnknownAbilities,
  pruneRedundantBandingReminderUnknownAbilities,
  pruneRedundantBestowReminderUnknownAbilities,
  pruneRedundantBuybackCostReminderUnknownAbilities,
  pruneRedundantCascadeReminderUnknownAbilities,
  pruneRedundantCastAdditionalCostUnknownAbilities,
  pruneRedundantChampionReminderAbilities,
  pruneRedundantClashReminderUnknownAbilities,
  pruneRedundantCoinFlipLeadUnknownAbilities,
  pruneRedundantCrewReminderAbilities,
  pruneRedundantDecayedReminderUnknownAbilities,
  pruneRedundantDiscoverReminderUnknownAbilities,
  pruneRedundantEarthbendReminderUnknownAbilities,
  pruneRedundantEldraziTokenManaReminderUnknownAbilities,
  pruneRedundantEnchantAttachmentReminderUnknownAbilities,
  pruneRedundantEntersTappedReplacementUnknownAbilities,
  pruneRedundantExploreReminderAbilities,
  pruneRedundantFaceDownReminderUnknownAbilities,
  pruneRedundantHandRevealDiscardChoiceUnknownAbilities,
  pruneRedundantHiddenAgendaRevealUnknownAbilities,
  pruneRedundantImpulseCleanupUnknownAbilities,
  pruneRedundantInfectKeywordUnknownAbilities,
  pruneRedundantLandwalkKeywordUnknownAbilities,
  pruneRedundantLookTopReorderUnknownAbilities,
  pruneRedundantModularReminderAbilities,
  pruneRedundantPhasingReminderUnknownAbilities,
  pruneRedundantProliferateReminderUnknownAbilities,
  pruneRedundantProtectionAuraReminderUnknownAbilities,
  pruneRedundantPrototypeReminderUnknownAbilities,
  pruneRedundantScryReminderUnknownAbilities,
  pruneRedundantSpellCantBeCounteredAbilities,
  pruneRedundantSpellTimingRestrictionUnknownAbilities,
  pruneRedundantStationChargeCounterReminderUnknownAbilities,
  pruneRedundantStillLandUnknownAbilities,
  pruneRedundantSurveilReminderSteps,
  pruneRedundantTimingRulesReminderUnknownAbilities,
  pruneRedundantTokenDesignationReminderUnknownAbilities,
  pruneRedundantTriggerEffectFragmentUnknownAbilities,
  pruneRedundantTriggerRestrictionUnknownAbilities,
  pruneRedundantVanishingReminderAbilities,
  pruneRedundantWaterbendReminderUnknownAbilities,
  pruneRedundantXCantBeZeroUnknownAbilities,
  pruneSoulbondReminderAbilities,
  pruneStaticMyriadReminderTailAbilities,
  pruneThassaOracleWinGrantAbilities,
  repairGapClosureAbilitySteps,
  repairMonarchInsteadConditionalAbilities,
  repairQuotedStaticGrantAbilities,
  repairRandomChooseModeSagaAbilities,
  repairSplitChooseModeBulletAbilities,
  repairSubjectlessDrawAfterZoneShuffleAbilities,
  restoreGrantedGraveyardAdditionalCostModifierRawAbilities,
  splitCompoundChosenCardsMoveZoneAbilities,
  upgradeConditionalIfYouDoImpulseAbilities,
  upgradeCounteredSpellLibraryTopReplacementSteps,
  upgradeExiledThisWayReturnMoveZoneSteps,
  upgradeManifestDreadGrantAbilities,
  upgradeMoveZoneSelectorGapSteps,
  upgradeReanimationHasteGrantSteps,
  upgradeSpryAndMightyCompoundSteps,
  upgradeThoseCardsBattlefieldInsteadOfHandSteps,
  upgradeXAtLeastAlternateMoveDestinations,
  wrapIfYouDoConditionOnParsedAbilities,
} from './oracleIRParserPostprocess';
import {
  repairIntraAbilityInsteadConditionalSteps,
} from './oracleIRParserPostprocessInsteadReplacementSteps';
import { extractQuotedAbilityRiderSteps } from './oracleIRParserPostprocessQuotedAbilityRiders';
import { normalizeOracleText } from './oracleIRParserUtils';
import { normalizeOracleForParsing } from './oracleReminderText';
import type { OracleTextParseResult, ParsedAbility } from './oracleTextParser';
import { parseOracleText } from './oracleTextParser';

function parseAbilityToIRAbility(ability: ParsedAbility, cardName?: string): OracleIRAbility {
  return parseAbilityToIRAbilityFromModule(ability, cardName, parseOracleTextToIR);
}

export function parseOracleTextToIR(oracleText: string, cardName?: string): OracleIRResult {
  const normalizedOracleText = normalizeOracleText(oracleText);
  const needsGameplayPreNormalize = /\b(?:you may cast either half|that door unlocks on the battlefield)\b/i.test(normalizedOracleText)
    || /\(as a siege enters\b/i.test(normalizedOracleText)
    || /\([^)]*(?:this creature|this card|it's an artifact|it's an enchantment|it's an creature)\b[^)]*\)/i.test(normalizedOracleText);
  const parsingOracleText = needsGameplayPreNormalize
    ? (normalizeOracleForParsing(normalizedOracleText) || normalizedOracleText)
    : normalizedOracleText;
  const preserveChapterRetargetUnknown = /\b(?:i|ii|iii|iv|v)\s+—\s+until\s+end\s+of\s+turn,\s+whenever\s+you\s+cast\s+an\s+instant\s+or\s+sorcery\s+spell,\s+copy\s+it\.\s+you\s+may\s+choose\s+new\s+targets\s+for\s+the\s+copy\.?\s*$/i.test(parsingOracleText);
  const parsed: OracleTextParseResult = mergeSplitChooseModeParsedAbilities(
    parseOracleText(parsingOracleText, cardName)
  );

  let abilities = parsed.abilities.map(ability => parseAbilityToIRAbility(ability, cardName));
  abilities = mergeAdditionalCombatContinuationAbilities(abilities);
  abilities = expandActivatedAbilityCostReductionStaticAbilities(abilities);
  abilities = applyGlobalImpulseUpgrades(abilities, normalizedOracleText);
  abilities = mergeDieRollResultTableAbilities(abilities);
  abilities = mergeRevealFollowupAbilities(abilities);
  abilities = mergeSearchLibraryToHandFollowupAbilities(abilities);
  abilities = mergeSearchLibraryPutOnTopFollowupAbilities(abilities);
  abilities = mergeLookChooseFromTopAbilities(abilities);
  abilities = mergeConditionalLookChooseFromTopAbilities(abilities);
  abilities = mergeAddManaRestrictionFollowupAbilities(abilities);
  abilities = mergeTopLibraryBottomRandomTailAbilities(abilities);
  abilities = enrichConditionalAmongThemHandRestAbilities(abilities);
  abilities = lowerAmongThemChoosePlayerChoiceAbilities(abilities);
  abilities = mergeLookChooseFromTopAbilities(abilities);
  abilities = mergeLookSelectTopFollowupAbilities(abilities);
  abilities = pruneRedundantSurveilReminderSteps(abilities);
  abilities = expandStandaloneTopLibraryInfoAbilities(abilities);
  abilities = mergeLookChooseFromTopAbilities(abilities);
  abilities = expandHideawayReminderAbilities(abilities);
  abilities = bindImmediateTopLibraryReferenceFollowups(abilities);
  abilities = mergeCopyChapterAbilityFollowupAbilities(abilities);
  abilities = expandConditionalLookTopChooseOneToHandRestToGraveyardAbilities(abilities);
  abilities = mergeConditionalMoveZoneCounterFollowupAbilities(abilities);
  abilities = expandDynamicCounterRiderAbilities(abilities);
  abilities = mergeBattlefieldEntryCharacteristicFollowupAbilities(abilities);
  abilities = mergeBattlefieldEntryAuraRewriteFollowupAbilities(abilities);
  abilities = expandLandAnimationUnknownAbilities(abilities);
  abilities = expandDeterministicMoveZoneFollowupAbilities(abilities);
  abilities = upgradeExiledThisWayReturnMoveZoneSteps(abilities);
  abilities = upgradeReanimationHasteGrantSteps(abilities);
  abilities = upgradeCounteredSpellLibraryTopReplacementSteps(abilities);
  abilities = upgradeSpryAndMightyCompoundSteps(abilities);
  abilities = upgradeThoseCardsBattlefieldInsteadOfHandSteps(abilities);
  abilities = upgradeMoveZoneSelectorGapSteps(abilities);
  abilities = pruneBatch382MisparseExecutableSteps(abilities);
  abilities = expandMoveZoneCopiedSpellAbilities(abilities);
  abilities = expandMixedBattlefieldAndGraveyardExileAbilities(abilities);
  abilities = expandCompoundMoveZoneAbilities(abilities);
  abilities = expandPayManaUnknownAbilities(abilities);
  abilities = expandChoiceUnknownAbilities(abilities);
  abilities = expandChosenColorProtectionAbilities(abilities);
  abilities = expandCopyChapterAbilityUnknownAbilities(abilities);
  abilities = expandLeaveBattlefieldReplacementUnknownAbilities(abilities);
  abilities = expandCopySpellUnknownAbilities(abilities);
  abilities = expandCopyPermanentUnknownAbilities(abilities);
  abilities = expandPreventDamageUnknownAbilities(abilities);
  abilities = expandWinLossUnknownAbilities(abilities);
  abilities = expandTapMatchingPermanentCountAbilities(abilities);
  abilities = expandYouMayTransformIfYouDoAbilities(abilities);
  abilities = wrapIfYouDoConditionOnParsedAbilities(abilities);
  abilities = expandSimpleConditionalUnknownAbilities(abilities);
  abilities = foldUnlessPaysMayPayOrFollowups(abilities);
  abilities = mergeKinshipRevealConditionalAbilities(abilities);
  abilities = expandCopySpellUnknownAbilities(abilities);
  abilities = mergeDanglingCopySpellAbilities(abilities);
  abilities = upgradeConditionalIfYouDoImpulseAbilities(abilities);
  abilities = expandUnlessSacrificeAbilities(abilities);
  abilities = expandOtherwiseConditionalUnknownAbilities(abilities);
  abilities = mergeRevealTopShareTypeMayCastAbilities(abilities);
  abilities = expandExilePermissionUnknownAbilities(abilities);
  abilities = expandTokenCreationReplacementUnknownAbilities(abilities);
  abilities = expandGraveyardPermissionUnknownAbilities(abilities);
  abilities = expandFreeGraveyardCastPermissionAbilities(abilities);
  abilities = expandGraveyardOrExilePermissionAbilities(abilities);
  abilities = expandGraveyardAdditionalCostPermissionAbilities(abilities);
  abilities = expandGraveyardPermissionModifierUnknownAbilities(abilities);
  abilities = expandKeywordAdditionalCostGraveyardPermissionAbilities(abilities);
  abilities = expandKeywordManaCostGraveyardPermissionAbilities(abilities);
  abilities = expandDisturbKeywordAbilities(abilities);
  abilities = expandUnearthKeywordAbilities(abilities);
  abilities = pruneConvokeReminderAbilities(abilities);
  abilities = pruneKickerReminderAbilities(abilities);
  abilities = pruneCascadeReminderAbilities(abilities);
  abilities = pruneRedundantCascadeReminderUnknownAbilities(abilities);
  abilities = pruneRedundantBackupReminderUnknownAbilities(abilities);
  abilities = pruneCumulativeUpkeepReminderAbilities(abilities);
  abilities = pruneRedundantPrototypeReminderUnknownAbilities(abilities);
  abilities = pruneFirebendingReminderAbilities(abilities);
  abilities = pruneReadAheadReminderAbilities(abilities);
  abilities = pruneSoulbondReminderAbilities(abilities);
  abilities = pruneExtortReminderAbilities(abilities);
  abilities = pruneMadnessReminderAbilities(abilities);
  abilities = pruneCleaveReminderAbilities(abilities);
  abilities = pruneCipherReminderAbilities(abilities);
  abilities = pruneForetellReminderAbilities(abilities);
  abilities = pruneMorphReminderAbilities(abilities);
  abilities = upgradeManifestDreadGrantAbilities(abilities);
  abilities = pruneRedundantFaceDownReminderUnknownAbilities(abilities);
  abilities = pruneRedundantAttackRequirementAbilities(abilities);
  abilities = pruneRedundantCrewReminderAbilities(abilities);
  abilities = pruneRedundantChampionReminderAbilities(abilities);
  abilities = pruneRedundantArtifactTokenReminderUnknownAbilities(abilities);
  abilities = pruneRedundantTokenDesignationReminderUnknownAbilities(abilities);
  abilities = pruneRedundantDecayedReminderUnknownAbilities(abilities);
  abilities = pruneRedundantEldraziTokenManaReminderUnknownAbilities(abilities);
  abilities = pruneRedundantEnchantAttachmentReminderUnknownAbilities(abilities);
  abilities = pruneRedundantProtectionAuraReminderUnknownAbilities(abilities);
  abilities = pruneRedundantHiddenAgendaRevealUnknownAbilities(abilities);
  abilities = pruneRedundantTimingRulesReminderUnknownAbilities(abilities);
  abilities = pruneRedundantSpellCantBeCounteredAbilities(abilities);
  abilities = expandFutureSpellEffectUnknownAbilities(abilities);
  abilities = pruneRedundantTriggerRestrictionUnknownAbilities(abilities);
  abilities = pruneRedundantStillLandUnknownAbilities(abilities);
  abilities = pruneRedundantPhasingReminderUnknownAbilities(abilities);
  abilities = expandRepeatedProliferateUnknownAbilities(abilities);
  abilities = pruneRedundantProliferateReminderUnknownAbilities(abilities);
  abilities = pruneRedundantLookTopReorderUnknownAbilities(abilities);
  abilities = mergeAddManaRestrictionFollowupAbilities(abilities);
  abilities = pruneRedundantClashReminderUnknownAbilities(abilities);
  abilities = pruneRedundantScryReminderUnknownAbilities(abilities);
  abilities = pruneRedundantBestowReminderUnknownAbilities(abilities);
  abilities = lowerSelfEntryCounterReplacementAbilities(abilities);
  abilities = pruneRedundantEntersTappedReplacementUnknownAbilities(abilities);
  abilities = pruneRedundantInfectKeywordUnknownAbilities(abilities);
  abilities = pruneRedundantCoinFlipLeadUnknownAbilities(abilities);
  abilities = pruneRedundantLandwalkKeywordUnknownAbilities(abilities);
  abilities = expandScavengeKeywordAbilities(abilities);
  abilities = expandTypecyclingKeywordAbilities(abilities);
  abilities = expandTransfigureKeywordAbilities(abilities);
  abilities = expandTransmuteKeywordAbilities(abilities);
  abilities = expandEncoreKeywordAbilities(abilities);
  abilities = expandMyriadKeywordAbilities(abilities);
  abilities = pruneStaticMyriadReminderTailAbilities(abilities);
  abilities = expandMobilizeKeywordAbilities(abilities);
  abilities = expandParadigmKeywordAbilities(abilities);
  abilities = expandEmbalmKeywordAbilities(abilities);
  abilities = expandEternalizeKeywordAbilities(abilities);
  abilities = pruneDuplicateGraveyardReminderAbilities(abilities);
  abilities = pruneEquipmentBleedSteps(abilities);
  abilities = pruneIndestructibleDestroyReminderSteps(abilities);
  abilities = convertReminderSelfExilePermissionAbilities(abilities);
  abilities = mergeConditionalGraveyardReminderFollowupAbilities(abilities);
  abilities = mergeExilePermissionCastCounterFollowupAbilities(abilities);
  abilities = mergeDeterministicGraveyardPermissionFollowupAbilities(abilities);
  abilities = restoreGrantedGraveyardAdditionalCostModifierRawAbilities(abilities);
  abilities = mergeBattlefieldEntryCharacteristicFollowupAbilities(abilities);
  abilities = mergeBattlefieldEntryAuraRewriteFollowupAbilities(abilities);
  abilities = expandMoveZoneHasteFollowupAbilities(abilities);
  abilities = lowerAmassReminderAbilities(abilities);
  abilities = pruneRedundantAmassSubtypeReminderUnknownAbilities(abilities);
  abilities = lowerConniveKeywordAbilities(abilities);
  abilities = lowerRecruitKeywordAbilities(abilities);
  abilities = lowerDiscoverKeywordAbilities(abilities);
  abilities = pruneRedundantDiscoverReminderUnknownAbilities(abilities);
  abilities = expandKeywordActionUnknownAbilities(abilities);
  abilities = expandTurnScopedStaticKeywordAbilities(abilities);
  abilities = pruneExternallyHandledTemporaryLandBonusUnknownSteps(abilities);
  abilities = pruneRedundantExploreReminderAbilities(abilities);
  abilities = pruneMalformedExploreReminderMoveZoneSteps(abilities);
  abilities = pruneRedundantAirbendReminderUnknownAbilities(abilities);
  abilities = pruneRedundantEarthbendReminderUnknownAbilities(abilities);
  abilities = pruneRedundantWaterbendReminderUnknownAbilities(abilities);
  abilities = mergeDestroyCantRegenerateFollowupAbilities(abilities);
  abilities = expandVoteChoiceCountAbilities(abilities);
  abilities = pruneRedundantSpellTimingRestrictionUnknownAbilities(abilities);
  abilities = pruneRedundantActivationRestrictionUnknownAbilities(abilities);
  abilities = pruneRedundantXCantBeZeroUnknownAbilities(abilities);
  abilities = pruneRedundantHandRevealDiscardChoiceUnknownAbilities(abilities);
  abilities = pruneRedundantStationChargeCounterReminderUnknownAbilities(abilities);
  abilities = pruneRedundantVanishingReminderAbilities(abilities);
  abilities = pruneRedundantModularReminderAbilities(abilities);
  abilities = pruneRedundantBandingReminderUnknownAbilities(abilities);
  abilities = pruneRedundantBuybackCostReminderUnknownAbilities(abilities);
  abilities = pruneRedundantCastAdditionalCostUnknownAbilities(abilities);
  abilities = pruneRedundantAnyPlayerMayActivateUnknownAbilities(abilities);
  abilities = mergeDeterministicKeywordFollowupAbilities(abilities);
  abilities = mergeSagaChapterCopyFollowupAbilities(abilities);
  abilities = pruneRedundantImpulseCleanupUnknownAbilities(abilities);
  abilities = expandMoveZoneAttachUnknownAbilities(abilities);
  abilities = expandLandAnimationUnknownAbilities(abilities);
  abilities = expandCreateEmblemUnknownAbilities(abilities, cardName);
  abilities = mergeDieRollResultTableAbilities(abilities);
  abilities = annotateTokenCreationMetadataAbilities(abilities, normalizedOracleText);
  abilities = annotateDamageMetadataAbilities(abilities);
  abilities = annotateDrawMetadataAbilities(abilities);
  abilities = annotateLifeMetadataAbilities(abilities);
  abilities = annotateDestroyMetadataAbilities(abilities);
  abilities = annotateCounterMetadataAbilities(abilities);
  abilities = annotateSacrificeMetadataAbilities(abilities);
  abilities = upgradeManifestDreadGrantAbilities(abilities);
  abilities = pruneRedundantFaceDownReminderUnknownAbilities(abilities);
  abilities = expandRepeatedProliferateUnknownAbilities(abilities);
  abilities = pruneRedundantProliferateReminderUnknownAbilities(abilities);
  abilities = clearKeywordActionRepetitionReplacementSteps(abilities);
  abilities = expandStandaloneStaticKeywordAbilities(abilities);
  abilities = expandActivatedAbilityCostReductionStaticAbilities(abilities);
  abilities = pruneExternallyHandledStaticUnknownAbilities(abilities);
  abilities = repairSubjectlessDrawAfterZoneShuffleAbilities(abilities);
  abilities = mergeConditionalLookChooseFromTopAbilities(abilities);
  abilities = mergeLookChooseFromTopAbilities(abilities);
  abilities = lowerAmongThemChoosePlayerChoiceAbilities(abilities);
  abilities = pruneCurrentBatchReminderUnknownAbilities(abilities);
  abilities = pruneLateKeywordReminderOnlyAbilities(abilities);
  abilities = expandStandaloneKeywordCostAbilities(abilities, normalizedOracleText);
  abilities = expandCastWithoutPayingFallbackAbilities(abilities, normalizedOracleText);
  abilities = repairQuotedStaticGrantAbilities(abilities);
  abilities = expandChaosZoneTemplateAbilities(abilities, normalizedOracleText);
  abilities = lowerCurrentResidualUnknownAbilities(abilities);
  abilities = clearKeywordActionRepetitionReplacementSteps(abilities);
  abilities = pruneRedundantProliferateReminderUnknownAbilities(abilities);
  abilities = collapseFlipCoinLifeStakesAbilities(abilities);
  abilities = pruneThassaOracleWinGrantAbilities(abilities);
  abilities = pruneCurrentBatchReminderUnknownAbilities(abilities);
  abilities = pruneBatch382MisparseExecutableSteps(abilities);
  abilities = lowerAmongThemChoosePlayerChoiceAbilities(abilities);
  abilities = mergeChooseCreatureTypePrefixAbilities(abilities);
  abilities = splitCompoundChosenCardsMoveZoneAbilities(abilities);
  abilities = upgradeXAtLeastAlternateMoveDestinations(abilities);
  abilities = repairSplitChooseModeBulletAbilities(abilities);
  abilities = repairGapClosureAbilitySteps(abilities);
  abilities = mergeSearchLibraryShuffleFollowupAbilities(abilities);
  abilities = repairRandomChooseModeSagaAbilities(abilities);
  abilities = repairMonarchInsteadConditionalAbilities(abilities);
  abilities = repairIntraAbilityInsteadConditionalSteps(abilities);
  abilities = extractQuotedAbilityRiderSteps(abilities);
  abilities = enrichAnnihilatorGrantMetadataAbilities(abilities);
  abilities = enrichWardGrantMetadataAbilities(abilities);
  abilities = pruneRedundantTriggerEffectFragmentUnknownAbilities(abilities);
  abilities = abilities.map((ability) => {
    const steps = ability.steps || [];
    if (steps.length > 0 && steps.some((step) => step.kind !== 'unknown')) return ability;
    const fragment = parseBareTriggerEffectFragmentSteps(
      String(ability.effectText || (ability as { text?: string }).text || '')
    );
    if (!fragment || fragment.length === 0) return ability;
    return { ...ability, steps: [...fragment] };
  });
  if (preserveChapterRetargetUnknown) {
    abilities = abilities.map((ability) => ({
      ...ability,
      steps: ability.steps.map((step) => {
        if (
          step.kind === 'grant_static_ability' &&
          String((step.target as any)?.text || '') === 'pass37 residual' &&
          /^i{2,4}\s*-\s*until\s+end\s+of\s+turn,\s+whenever\s+you\s+cast\s+an\s+instant\s+or\s+sorcery\s+spell,\s+copy\s+it\.\s+you\s+may\s+choose\s+new\s+targets\s+for\s+the\s+copy$/i.test(String(step.raw || '').trim())
        ) {
          return { kind: 'unknown', raw: step.raw, ...(step.sequence ? { sequence: step.sequence } : {}) } as OracleEffectStep;
        }
        return step;
      }),
    }));
  }
  abilities = expandGraveyardPermissionUnknownAbilities(abilities);
  abilities = mergeDeterministicGraveyardPermissionFollowupAbilities(abilities);
  abilities = restoreGrantedGraveyardAdditionalCostModifierRawAbilities(abilities);
  abilities = lowerAmassReminderAbilities(abilities);
  abilities = pruneRedundantBestowReminderUnknownAbilities(abilities);
  abilities = pruneRedundantAirbendReminderUnknownAbilities(abilities);
  abilities = pruneRedundantEarthbendReminderUnknownAbilities(abilities);
  abilities = pruneRedundantWaterbendReminderUnknownAbilities(abilities);
  abilities = annotateTokenCreationMetadataAbilities(abilities, normalizedOracleText);
  abilities = annotateDamageMetadataAbilities(abilities);
  abilities = annotateDrawMetadataAbilities(abilities);
  abilities = annotateLifeMetadataAbilities(abilities);
  abilities = annotateDestroyMetadataAbilities(abilities);
  abilities = expandBlightPrefixAbilities(abilities);
  abilities = annotateCounterMetadataAbilities(abilities);
  abilities = annotateSacrificeMetadataAbilities(abilities);
  abilities = applyParseOracleTextToIRLatePasses({
    abilities,
    normalizedOracleText,
    parsingOracleText,
    cardName,
    parsed,
    parseOracleTextToIR,
  });


  return {
    normalizedOracleText,
    abilities,
    keywords: parsed.keywords,
  };
}
