import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const stackSource = readFileSync(join(serverRoot, 'src/state/modules/stack.ts'), 'utf8');
const handlersSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrTriggerLegacyRegexHandlers.ts'),
  'utf8',
);
const searchHandlersSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrTriggerLegacySearchHandlers.ts'),
  'utf8',
);
const resolutionHandlersSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrTriggerLegacyResolutionHandlers.ts'),
  'utf8',
);
const tokenHandlersSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrTriggerLegacyTokenHandlers.ts'),
  'utf8',
);
const combinedHandlersPath = join(serverRoot, 'src/state/modules/oracleIrTriggerLegacyCombinedHandlers.ts');
const combinedHandlersSource = existsSync(combinedHandlersPath)
  ? readFileSync(combinedHandlersPath, 'utf8')
  : '';
const cardSpecificHandlersSource = '';
const stackSpecialTriggerHandlersSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackSpecialTriggerHandlers.ts'),
  'utf8',
);
const timingHandlersPath = join(serverRoot, 'src/state/modules/oracleIrTriggerLegacyTimingHandlers.ts');
const timingHandlersSource = existsSync(timingHandlersPath)
  ? readFileSync(timingHandlersPath, 'utf8')
  : '';
const keywordHandlersSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrTriggerLegacyKeywordHandlers.ts'),
  'utf8',
);
const lifeAndGameHandlersSourceExists = existsSync(
  join(serverRoot, 'src/state/modules/oracleIrTriggerLegacyLifeAndGameHandlers.ts'),
);
const turnAndZoneHandlersSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrTriggerLegacyTurnAndZoneHandlers.ts'),
  'utf8',
);
const gameStateHooksSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrTriggerLegacyGameStateHooks.ts'),
  'utf8',
);
const graveyardHandlersSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrTriggerLegacyGraveyardHandlers.ts'),
  'utf8',
);
const triggerEtbPermanentEffectsSource = readFileSync(
  join(serverRoot, 'src/state/modules/triggerEtbPermanentEffects.ts'),
  'utf8',
);
const delayedCleanupHandlersSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrTriggerLegacyDelayedCleanupHandlers.ts'),
  'utf8',
);
const libraryHandlersSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrTriggerLegacyLibraryHandlers.ts'),
  'utf8',
);
const sacrificeHandlersSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrTriggerLegacySacrificeHandlers.ts'),
  'utf8',
);
const prefaceHandlersSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrTriggerLegacyPrefaceHandlers.ts'),
  'utf8',
);
const descPrepHandlersSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrTriggerLegacyDescPrepHandlers.ts'),
  'utf8',
);
const counterHandlersSource = '';
const singleEffectRegexBatchSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrTriggerLegacySingleEffectRegexBatch.ts'),
  'utf8',
);
const countersTokensSource = readFileSync(
  join(serverRoot, 'src/state/modules/counters_tokens.ts'),
  'utf8',
);
const triggerLifeDamageUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/triggerLifeDamageUtils.ts'),
  'utf8',
);
const triggerLibraryMillUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/triggerLibraryMillUtils.ts'),
  'utf8',
);
const triggerLibrarySearchUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/triggerLibrarySearchUtils.ts'),
  'utf8',
);
const triggerVentureUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/triggerVentureUtils.ts'),
  'utf8',
);
const triggerPlayableFromExileUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/triggerPlayableFromExileUtils.ts'),
  'utf8',
);
const executeSpellEffectSource = readFileSync(
  join(serverRoot, 'src/state/modules/executeSpellEffect.ts'),
  'utf8',
);
const detectEntersWithCountersSource = readFileSync(
  join(serverRoot, 'src/state/modules/detectEntersWithCounters.ts'),
  'utf8',
);
const spellLegacyTokenUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrSpellLegacyTokenUtils.ts'),
  'utf8',
);
const spellLegacySupplementalSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrSpellLegacySupplemental.ts'),
  'utf8',
);
const triggerPermanentEntersTappedSource = readFileSync(
  join(serverRoot, 'src/state/modules/triggerPermanentEntersTapped.ts'),
  'utf8',
);
const spellLegacyTargetBuffUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrSpellLegacyTargetBuffUtils.ts'),
  'utf8',
);
const stackContextUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrStackContextUtils.ts'),
  'utf8',
);
const spellLegacyDispatchUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrSpellLegacyDispatchUtils.ts'),
  'utf8',
);
const spellLegacyTutorUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrSpellLegacyTutorUtils.ts'),
  'utf8',
);
const kindredRevealUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrSpellLegacyKindredRevealUtils.ts'),
  'utf8',
);
const reflexiveWhenYouDoQueueSource = readFileSync(
  join(serverRoot, 'src/state/modules/triggerReflexiveWhenYouDoQueueUtils.ts'),
  'utf8',
);
const dayNightSource = readFileSync(
  join(serverRoot, 'src/state/modules/day-night.ts'),
  'utf8',
);
const optionalPaymentQueueSource = readFileSync(
  join(serverRoot, 'src/state/modules/triggerOptionalPaymentQueueUtils.ts'),
  'utf8',
);
const summonsUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrSpellLegacySummonsUtils.ts'),
  'utf8',
);
const librarySelectionUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrSpellLegacyLibrarySelectionUtils.ts'),
  'utf8',
);
const abilityCopyUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/triggerAbilityCopyUtils.ts'),
  'utf8',
);
const chosenTypeSpellUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/triggerChosenTypeSpellUtils.ts'),
  'utf8',
);
const creatureEntryHasteUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/creatureEntryHasteUtils.ts'),
  'utf8',
);
const spellLegacyChoiceBatchUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/spellLegacyChoiceBatchUtils.ts'),
  'utf8',
);
const tributeChoiceUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/triggerTributeChoiceUtils.ts'),
  'utf8',
);
const artifactTokenUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrSpellLegacyArtifactTokenUtils.ts'),
  'utf8',
);
const stackManifestUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackManifestUtils.ts'),
  'utf8',
);
const stackExileUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackExileUtils.ts'),
  'utf8',
);
const removalRiderUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrSpellLegacyRemovalRiderUtils.ts'),
  'utf8',
);
const spellShapeUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrSpellLegacySpellShapeUtils.ts'),
  'utf8',
);
const stackLandCountUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackLandCountUtils.ts'),
  'utf8',
);
const stackTargetLegalityUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackTargetLegalityUtils.ts'),
  'utf8',
);
const specialSpellRiderUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrSpellLegacySpecialSpellRiderUtils.ts'),
  'utf8',
);
const stackReplayUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackReplayUtils.ts'),
  'utf8',
);
const stackPlayLandUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackPlayLandUtils.ts'),
  'utf8',
);
const stackCastSpellUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackCastSpellUtils.ts'),
  'utf8',
);
const stackPushUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackPushUtils.ts'),
  'utf8',
);
const stackResolveEffectiveCardUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveEffectiveCardUtils.ts'),
  'utf8',
);
const stackResolveAbilityHandlersUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveAbilityHandlersUtils.ts'),
  'utf8',
);
const stackResolveAbilityEarlyHandlersUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveAbilityEarlyHandlersUtils.ts'),
  'utf8',
);
const stackResolveAbilityMidHandlersUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveAbilityMidHandlersUtils.ts'),
  'utf8',
);
const stackResolveAbilityLateHandlersUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveAbilityLateHandlersUtils.ts'),
  'utf8',
);
const stackResolveSpellZoneUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveSpellZoneUtils.ts'),
  'utf8',
);
const stackResolveSpellCopyChoiceUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveSpellCopyChoiceUtils.ts'),
  'utf8',
);
const stackResolveSpellChoiceUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveSpellChoiceUtils.ts'),
  'utf8',
);
const stackResolveSpellAcademicProbationUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveSpellAcademicProbationUtils.ts'),
  'utf8',
);
const stackResolveSpellSpecialCaseUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveSpellSpecialCaseUtils.ts'),
  'utf8',
);
const stackResolveSpellTargetMetadataUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveSpellTargetMetadataUtils.ts'),
  'utf8',
);
const stackResolveSpellOracleIrUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveSpellOracleIrUtils.ts'),
  'utf8',
);
const oracleIrSpellLegacySpellShapeUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrSpellLegacySpellShapeUtils.ts'),
  'utf8',
);
const stackResolveSpellLegacySpecUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveSpellLegacySpecUtils.ts'),
  'utf8',
);
const stackResolveSpellUncategorizedUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveSpellUncategorizedUtils.ts'),
  'utf8',
);
const stackResolveSpellGraveyardAutomationUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveSpellGraveyardAutomationUtils.ts'),
  'utf8',
);
const stackResolveSpellPostCategorizeRidersUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveSpellPostCategorizeRidersUtils.ts'),
  'utf8',
);
const stackResolveSpellLegacyRegexDrawUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveSpellLegacyRegexDrawUtils.ts'),
  'utf8',
);
const stackResolveSpellControlChangeUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveSpellControlChangeUtils.ts'),
  'utf8',
);
const stackResolveSpellLibraryHandlersUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveSpellLibraryHandlersUtils.ts'),
  'utf8',
);
const stackResolveSpellMultiplayerPromptUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveSpellMultiplayerPromptUtils.ts'),
  'utf8',
);
const stackResolveSpellLibraryTopPromptUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveSpellLibraryTopPromptUtils.ts'),
  'utf8',
);
const stackResolveInstantSorceryOrchestratorUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveInstantSorceryOrchestratorUtils.ts'),
  'utf8',
);
const stackResolveInstantSorceryPrefaceUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveInstantSorceryPrefaceUtils.ts'),
  'utf8',
);
const stackResolveInstantSorceryLegacyResolutionUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveInstantSorceryLegacyResolutionUtils.ts'),
  'utf8',
);
const stackResolveInstantSorceryLegacyBodyUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveInstantSorceryLegacyBodyUtils.ts'),
  'utf8',
);
const oracleIrUncategorizedSpellFallbackSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrUncategorizedSpellFallback.ts'),
  'utf8',
);
const stackResolvePermanentEtbChoiceUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolvePermanentEtbChoiceUtils.ts'),
  'utf8',
);
const stackResolvePermanentEtbTriggerUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolvePermanentEtbTriggerUtils.ts'),
  'utf8',
);
const stackResolvePermanentEntryUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolvePermanentEntryUtils.ts'),
  'utf8',
);
const stackResolvePermanentSquadUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolvePermanentSquadUtils.ts'),
  'utf8',
);
const stackResolveTriggeredAbilityInterveningIfUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveTriggeredAbilityInterveningIfUtils.ts'),
  'utf8',
);
const stackResolveTriggeredAbilityOptionalUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveTriggeredAbilityOptionalUtils.ts'),
  'utf8',
);
const stackResolveTriggeredAbilitySpecialPromptUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveTriggeredAbilitySpecialPromptUtils.ts'),
  'utf8',
);
const stackResolveTriggeredAbilityTargetPromptUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveTriggeredAbilityTargetPromptUtils.ts'),
  'utf8',
);
const stackResolveTriggeredAbilityChosenTypeUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveTriggeredAbilityChosenTypeUtils.ts'),
  'utf8',
);
const stackResolveTriggeredAbilityOrchestratorUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveTriggeredAbilityOrchestratorUtils.ts'),
  'utf8',
);
const stackExecuteTriggerEffectUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackExecuteTriggerEffectUtils.ts'),
  'utf8',
);
const stackExecuteTriggerEffectIrFallbackUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackExecuteTriggerEffectIrFallbackUtils.ts'),
  'utf8',
);
const oracleIrTriggerUncategorizedFallbackSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrTriggerUncategorizedFallback.ts'),
  'utf8',
);
const oracleIrTriggerLegacyRoutingSource = readFileSync(
  join(serverRoot, 'src/state/modules/oracleIrTriggerLegacyRouting.ts'),
  'utf8',
);
const stackExecuteTriggerEffectPrefaceUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackExecuteTriggerEffectPrefaceUtils.ts'),
  'utf8',
);
const stackExecuteTriggerEffectLegacyBodyUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackExecuteTriggerEffectLegacyBodyUtils.ts'),
  'utf8',
);
const stackExecuteTriggerEffectTailUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackExecuteTriggerEffectTailUtils.ts'),
  'utf8',
);
const applyEventSource = readFileSync(
  join(serverRoot, 'src/state/modules/applyEvent.ts'),
  'utf8',
);
const gameActionsSource = readFileSync(
  join(serverRoot, 'src/socket/game-actions.ts'),
  'utf8',
);
const combatSource = readFileSync(
  join(serverRoot, 'src/socket/combat.ts'),
  'utf8',
);
const exertTriggersSource = readFileSync(
  join(serverRoot, 'src/socket/exert-triggers.ts'),
  'utf8',
);
const stackResolveTopOfStackUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveTopOfStackUtils.ts'),
  'utf8',
);
const stackResolveTopOfStackPrefaceUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveTopOfStackPrefaceUtils.ts'),
  'utf8',
);
const stackResolveSharedTypesSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveSharedTypes.ts'),
  'utf8',
);
const stackResolveTopOfStackDispatchUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveTopOfStackDispatchUtils.ts'),
  'utf8',
);
const stackResolvePermanentSpellOrchestratorUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolvePermanentSpellOrchestratorUtils.ts'),
  'utf8',
);
const stackResolvePermanentSpellPostEntryUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolvePermanentSpellPostEntryUtils.ts'),
  'utf8',
);
const stackResolvePermanentSpellTypeUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolvePermanentSpellTypeUtils.ts'),
  'utf8',
);
const stackResolveTriggeredAbilityDeferralUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveTriggeredAbilityDeferralUtils.ts'),
  'utf8',
);
const stackResolveTopOfStackPostResolutionUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveTopOfStackPostResolutionUtils.ts'),
  'utf8',
);
const stackResolveSpellLateRidersUtilsSource = readFileSync(
  join(serverRoot, 'src/state/modules/stackResolveSpellLateRidersUtils.ts'),
  'utf8',
);
const turnTrackingSource = readFileSync(
  join(serverRoot, 'src/state/modules/turn-tracking.ts'),
  'utf8',
);
const turnSource = readFileSync(
  join(serverRoot, 'src/state/modules/turn.ts'),
  'utf8',
);
const kynaiosChoiceSource = readFileSync(
  join(serverRoot, 'src/state/resolution/handlers/kynaiosChoice.ts'),
  'utf8',
);

/**
 * Retired trigger regex handlers must live in oracleIrTriggerLegacyRegexHandlers.ts,
 * not be reintroduced inline in executeTriggerEffect.
 */
const RETIRED_INLINE_MARKERS = [
  'const targetLosesYouGainMatch',
  'const eachDrawMatch',
  'const dealsToEachOpponentMatch',
  'const discardOpponentsMatch',
  'const opponentsLoseMatch',
  'const scryMatch = desc.match(/scry',
  'const drawMatch = desc.match(/draw (?:a card',
  'const mayGainLifeMatch',
  'const creatureControllerLosesMatch',
  'const dealEachOpponentAndGainLifeMatch',
  'const lifeAndEnergyMatch',
  'const energyMatch = desc.match(/you get',
  'const eachOpponentDrawsMatch',
  'const counterAndDealsOpponentDamageMatch',
  'const putThatManyCountersOnSelfMatch',
  'const tokenMatch = desc.match(/you get',
  'const targetDrawMatch',
  'const counterFromAmongMatch',
  'const untapAllControlledLands = desc.includes',
  'const twoCountersMatch',
  'const counterOnEachOtherTypeMatch',
  'const counterOnSelfMatch = desc.match',
  'const lootStyleTopLibraryMatch',
  'const eachPlayerCountersPattern',
  'const proteanHulkMatch',
  'const searchLibraryMatch',
  'const putFromHandPattern',
  'const targetPlayerTokenMatch',
  'const predefinedTokenMatch',
  'const createTokenMatch',
  'const millOpponentsMatch',
  'const createTokens = triggerValue.createTokens',
  'const thatPermanentControllerMillsMatch',
  'const millTargetPlayerMatch',
  'const targetCreatureCantBeBlockedMatch',
  'const selfCantBeBlockedMatch',
  'const selfPreventCombatDamageMatch',
  'const selfCantBeBlockedByLowPowerMatch',
  'desc.includes(\'equipped creature\') || desc.includes(\'equipped permanent\')',
  'const counterThenDrawMatch',
  'const optionalDiscardThenDrawMatch',
  'const sacrificeAnotherPermanentForBenefitMatch',
  'const createXTokensPattern',
  'triggerValue.countType',
  'join_forces_attack',
  'noOpponentHasMoreLife',
  'let humanCount = 0',
  'let goblinCount = 0',
  'let soldierCount = 0',
  'desc.includes(\'reveal cards from the top of your library until you reveal an equipment card\')',
  'const untapAllCreatureTypeMatch',
  'darien, king of kjeldor',
  'let opponentCreatureCount = 0',
  'number of creatures on the battlefield',
  'function parseTokenCreation',
  'function createTokenFromSpec',
  'processKeywordTriggers(keywordCtx, timing)',
  'const detectedKeywords = detectKeywords(oracleText, cardNameForKeyword)',
  '/^curse defending player/i.test(desc)',
  '/then, if you have 1,000 or more life, you lose the game/i.test(desc)',
  'sourcePermanent.upkeepEffectDoubling = true',
  '/you and that player may each put a permanent card from your hand onto the battlefield/i.test(desc)',
  'take an extra turn after this one',
  'gain control of target opponent',
  'selfExileCreateTokenMatch',
  'initiativeTriggeredThisEffect',
  "resolveVentureProgress(ctx, controller, sourceName, triggerSourceId, 'dungeon')",
  'attach\\s+(?:it|this\\s+(?:equipment|artifact)|~)\\s+to\\s+target\\s+creature\\s+you\\s+control',
  'exile the top two cards of your library',
  'discardTriggeredCastFromGraveyard',
  'thatPlayerSacrificesAndLosesMatch',
  'each merfolk you control explores',
  "venser's journal",
  'chosenTypeTopReveal',
  "desc === 'sacrifice this creature'",
  "triggerTypeFromTrigger === 'rebound'",
  "triggerTypeFromTrigger === 'paradigm'",
  'elixir of immortality',
  'isUpkeepSacrificeTrigger',
  'addsLoyaltyCounters',
  'tryApplyCastingModifierGrantsFromText(state, controller, description',
  'applyGraveyardPermissionEffectsFromText(ctx, controller, sourceName, description',
  'const devotionCounterMatch = desc.match(/put (?:a number of|x)',
  'const putCounterOnTargetMatch = desc.match(/put (?:a|an|one',
  'const selfGetsMatch =',
  'const creatureGetsMatch = desc.match(/(?:until end of turn',
  'desc.includes(\'untap all other creatures you control\') && !desc.includes(\'combat phase\')',
  'const targetLosesMatch = desc.match(/target (?:player|opponent) loses',
  'const dealsTargetDamageMatch = desc.match(/deals?',
  'const linkedExileMatch = desc.match(/exile (?:target |that )?',
  'const exileTopCardMatch = desc.match(/exile the top card of your library',
  'const dynamicPowerManaMatch = desc.match(/add an amount of',
  'const addManaMatch = desc.match(/add (\\{[^}]+\\}',
  'desc.includes(\'proliferate\')',
  'const graveyardToLibraryMatch = desc.match(/put target',
  'function resolveBoundGraveyardReturnEffect',
  'boundGraveyardCardId = String((triggerItem as any).boundGraveyardCardId',
  'function scheduleDelayedGraveyardReturn(',
  'function turnReturnedPermanentFaceUp(',
  'function applyBattlefieldReturnCharacteristicMetadata(',
  'function markPermanentEnteredFromZone(',
  'function scheduleDelayedDrawAtNextUpkeep(',
  'function parseBattlefieldCounterClause(',
  'function addCreatureType(',
  'function getTriggerSourcePermanent(',
  'function buildInterveningIfSubjectSnapshot(',
  'function buildTriggerSourcePermanentSnapshot(',
  'function resolveTriggeredAbilityTargetPlayerId(',
  'function resolvePreparedTargetPermanent(',
  'function maybeApplyPreparedStateChange(',
  'function parsePreparedConditionCountToken(',
  'function getPreparedHandCount(',
  'function isPreparedStateChangeConditionSatisfied(',
  'function queueExploreDecisionStep(',
  'export function queueSelfETBTriggersForPermanent(',
  'export function triggerETBEffectsForToken(',
  'function persistTriggeredAbilityPush(',
  'function buildTriggeredAbilityGraveyardValidTargets(',
  'export function inferTriggeredAbilityTargetMetadata(',
  'function appendQueuedResolutionPromptEvent(',
] as const;

describe('oracle IR trigger legacy guardrail', () => {
  it('keeps retired trigger regex handlers out of stack.ts', () => {
    for (const marker of RETIRED_INLINE_MARKERS) {
      expect(stackSource.includes(marker)).toBe(false);
    }
  });

  it('defines retired trigger regex handlers in the legacy module', () => {
    expect(handlersSource.includes('applyRetiredTriggerLegacyDrawAndLifeCombinedEffects')).toBe(false);
    expect(handlersSource.includes('applyRetiredTriggerLegacyEnergyEffects')).toBe(false);
    expect(handlersSource.includes('applyRetiredTriggerLegacyPutThatManyCountersOnSelf')).toBe(false);
    expect(handlersSource.includes('applyRetiredTriggerLegacyTokenCounters')).toBe(false);
    expect(handlersSource.includes('applyRetiredTriggerLegacyElspethCounterFromAmong')).toBe(false);
    expect(handlersSource.includes('applyRetiredTriggerLegacyTwoPlusOneCountersOnTarget')).toBe(false);
    expect(handlersSource.includes('applyRetiredTriggerLegacyLootStyleTopLibrary')).toBe(false);
    expect(handlersSource.includes('applyRetiredTriggerLegacyEachPlayerCounterPlacement')).toBe(false);
    expect(searchHandlersSource.includes('applyRetiredTriggerLegacyProteanHulkSearch')).toBe(false);
    expect(searchHandlersSource.includes('applyRetiredTriggerLegacyGenericSearchLibrary')).toBe(false);
    expect(resolutionHandlersSource.includes('applyRetiredTriggerLegacyKynaiosLandDrawChoice')).toBe(false);
    expect(resolutionHandlersSource.includes('applyRetiredTriggerLegacyBelbePortalPutFromHand')).toBe(false);
    expect(resolutionHandlersSource.includes('applyRetiredTriggerLegacyPutCreatureFromHandOntoBattlefield')).toBe(false);
    expect(tokenHandlersSource.includes('applyRetiredTriggerLegacyCreateCreatureToken')).toBe(false);
    expect(tokenHandlersSource.includes('applyRetiredTriggerLegacyPredefinedArtifactTokens')).toBe(false);
    expect(tokenHandlersSource.includes('applyRetiredTriggerLegacyAttackTriggerCreateCreatureToken')).toBe(false);
    expect(tokenHandlersSource.includes('applyRetiredTriggerLegacyBlockTriggerCreateCreatureToken')).toBe(false);
    expect(tokenHandlersSource.includes('applyRetiredTriggerLegacyEquippedCreatureCopyToken')).toBe(false);
    expect(singleEffectRegexBatchSource.includes('applyRetiredTriggerLegacyTargetCreatureCantBeBlocked')).toBe(false);
    expect(singleEffectRegexBatchSource.includes('applyRetiredTriggerLegacySelfCantBeBlocked')).toBe(false);
    expect(singleEffectRegexBatchSource.includes('applyRetiredTriggerLegacyTwoPlusOneCountersOnTarget')).toBe(false);
    expect(tokenHandlersSource.includes('applyRetiredTriggerLegacyAttackCountBasedCreateCreatureToken')).toBe(false);
    expect(tokenHandlersSource.includes('applyRetiredTriggerLegacyCreateXTokensByControlledTypeCount')).toBe(false);
    expect(combinedHandlersSource.includes('applyRetiredTriggerLegacyOptionalDiscardThenDraw')).toBe(false);
    expect(combinedHandlersSource.includes('applyRetiredTriggerLegacySacrificeAnotherPermanentForBenefit')).toBe(false);
    expect(searchHandlersSource.includes('applyRetiredTriggerLegacyRevealUntilEquipment')).toBe(false);
    expect(resolutionHandlersSource.includes('applyRetiredTriggerLegacyJoinForcesAttack')).toBe(false);
    expect(cardSpecificHandlersSource.includes('applyRetiredTriggerLegacyAgentOfShadowThievesAttack')).toBe(false);
    expect(tokenHandlersSource.includes('applyRetiredTriggerLegacyTypedCountTokenFallbacks')).toBe(false);
    expect(timingHandlersSource.includes('applyRetiredTriggerLegacyDelayedDrawAtNextUpkeep')).toBe(false);
    expect(timingHandlersSource.includes('applyRetiredTriggerLegacyUntapAllCreatureType')).toBe(false);
    expect(cardSpecificHandlersSource.includes('applyRetiredTriggerLegacyDarienDamageTokens')).toBe(false);
    expect(tokenHandlersSource.includes('applyRetiredTriggerLegacyDeployToTheFrontTokens')).toBe(false);
    expect(tokenHandlersSource.includes('applyRetiredTriggerLegacyCallTheCoppercoatsTokens')).toBe(false);
    expect(keywordHandlersSource.includes('applyRetiredTriggerLegacyKeywordTriggerFallback')).toBe(true);
    expect(cardSpecificHandlersSource.includes('applyRetiredTriggerLegacyCurseDefendingPlayer')).toBe(false);
    expect(lifeAndGameHandlersSourceExists).toBe(false);
    expect(resolutionHandlersSource.includes('applyRetiredTriggerLegacyBothPlayersPutPermanentFromHand')).toBe(false);
    expect(turnAndZoneHandlersSource.includes('applyRetiredTriggerLegacyExtraTurnAfterThisOne')).toBe(false);
    expect(turnAndZoneHandlersSource.includes('applyRetiredTriggerLegacyExileTargetPlayerGraveyard')).toBe(false);
    expect(turnAndZoneHandlersSource.includes('applyRetiredTriggerLegacyExileTopTwoPlayableChoice')).toBe(false);
    expect(gameStateHooksSource.includes('applyRetiredTriggerLegacyGameStateOracleHooks')).toBe(true);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacyAttachToTargetCreatureYouControl')).toBe(false);
    expect(graveyardHandlersSource.includes('applyRetiredTriggerLegacyDiscardTriggeredCastFromGraveyard')).toBe(true);
    expect(graveyardHandlersSource.includes('applyRetiredTriggerLegacyBoundGraveyardReturnEffect')).toBe(true);
    expect(delayedCleanupHandlersSource.includes('applyRetiredTriggerLegacyDelayedCleanupTriggers')).toBe(true);
    expect(libraryHandlersSource.includes('applyRetiredTriggerLegacyChosenTypeTopCardReveal')).toBe(false);
    expect(cardSpecificHandlersSource.includes('applyRetiredTriggerLegacyEachMerfolkExplores')).toBe(false);
    expect(combinedHandlersSource.includes('applyRetiredTriggerLegacyPutLandFromHand')).toBe(false);
    expect(combinedHandlersSource.includes('applyRetiredTriggerLegacyThatPlayerSacrificesAndLosesLife')).toBe(false);
    expect(stackSpecialTriggerHandlersSource.includes('applyStackReboundTrigger')).toBe(true);
    expect(stackSpecialTriggerHandlersSource.includes('applyStackParadigmTrigger')).toBe(true);
    expect(sacrificeHandlersSource.includes('applyRetiredTriggerLegacyUpkeepSacrificeCreatureOrSelf')).toBe(true);
    expect(cardSpecificHandlersSource.includes('applyRetiredTriggerLegacyElixirOfImmortality')).toBe(false);
    expect(prefaceHandlersSource.includes('applyRetiredTriggerLegacyPlaneswalkerLoyaltyCounters')).toBe(true);
    expect(descPrepHandlersSource.includes('stripTriggerLegacyInterveningIfPrefix')).toBe(true);
    expect(combinedHandlersSource.includes('applyRetiredTriggerLegacyCombinedEffectsRegexBatch')).toBe(false);
    expect(combinedHandlersSource.includes('combinedEffectsHit(')).toBe(false);
    expect(combinedHandlersSource.includes("'you_gain_that_much_life'")).toBe(false);
    expect(counterHandlersSource.includes('applyRetiredTriggerLegacyChosenTypeCounterEachCreature')).toBe(false);
    expect(tokenHandlersSource.includes('applyRetiredTriggerLegacyInterveningSubjectCopyToken')).toBe(false);
    expect(tokenHandlersSource.includes('applyRetiredTriggerLegacyTappedAttackingCopyToken')).toBe(false);
    expect(singleEffectRegexBatchSource.includes('applyRetiredTriggerLegacySingleEffectRegexBatch')).toBe(true);
  });

  it('routes stack.ts through extracted legacy handler imports', () => {
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacySingleEffectRegexBatch')).toBe(false);
    expect(stackExecuteTriggerEffectTailUtilsSource.includes('applyRetiredTriggerLegacySingleEffectRegexBatch')).toBe(true);
    expect(stackExecuteTriggerEffectTailUtilsSource.includes('applyRetiredTriggerLegacyLateEffectRegexBatch')).toBe(false);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacyAttackTriggerCreateCreatureToken')).toBe(false);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacyBlockTriggerCreateCreatureToken')).toBe(false);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacyAttackCountBasedCreateCreatureToken')).toBe(false);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacyCounterThenDraw')).toBe(false);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacyOptionalDiscardThenDraw')).toBe(false);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacySacrificeAnotherPermanentForBenefit')).toBe(false);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacyRevealUntilEquipment')).toBe(false);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacyJoinForcesAttack')).toBe(false);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacyAgentOfShadowThievesAttack')).toBe(false);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacyDelayedDrawAtNextUpkeep')).toBe(false);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacyUntapAllCreatureType')).toBe(false);
    expect(stackExecuteTriggerEffectUtilsSource.includes('applyRetiredTriggerLegacyExtraTurnAfterThisOne')).toBe(false);
    expect(stackExecuteTriggerEffectPrefaceUtilsSource.includes('applyRetiredTriggerLegacyExtraTurnAfterThisOne')).toBe(false);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacyExileTargetPlayerGraveyard')).toBe(false);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacyExileTopTwoPlayableChoice')).toBe(false);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacyGameStateOracleHooks')).toBe(true);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacySelfExileCreateToken')).toBe(false);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacyAttachToTargetCreatureYouControl')).toBe(false);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacyDiscardTriggeredCastFromGraveyard')).toBe(true);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacyBoundGraveyardReturnEffect')).toBe(true);
    expect(stackExecuteTriggerEffectUtilsSource.includes('applyRetiredTriggerLegacyDelayedCleanupTriggers')).toBe(false);
    expect(stackExecuteTriggerEffectPrefaceUtilsSource.includes('applyRetiredTriggerLegacyDelayedCleanupTriggers')).toBe(true);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacyChosenTypeTopCardReveal')).toBe(false);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacyEachMerfolkExplores')).toBe(false);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacyThatPlayerSacrificesAndLosesLife')).toBe(false);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacyHandSizeLifeGain')).toBe(false);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacyReboundTrigger')).toBe(false);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacySacrificeThisCreature')).toBe(false);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacyUpkeepSacrificeCreatureOrSelf')).toBe(true);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('applyRetiredTriggerLegacyElixirOfImmortality')).toBe(false);
    expect(stackExecuteTriggerEffectPrefaceUtilsSource.includes('applyRetiredTriggerLegacyPlaneswalkerLoyaltyCounters')).toBe(true);
    expect(stackExecuteTriggerEffectPrefaceUtilsSource.includes('applyRetiredTriggerLegacyDelayedCleanupTriggers')).toBe(true);
    expect(stackExecuteTriggerEffectUtilsSource.includes('applyRetiredTriggerLegacyPlaneswalkerLoyaltyCounters')).toBe(false);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('stripTriggerLegacyInterveningIfPrefix')).toBe(true);
    expect(stackExecuteTriggerEffectTailUtilsSource.includes('legacyTailHandled(combinedEffectsHit)')).toBe(false);
    expect(stackExecuteTriggerEffectTailUtilsSource.includes('isTriggerEffectFullyIrWired(descriptionForOracleFallback')).toBe(true);
    expect(stackExecuteTriggerEffectTailUtilsSource.includes('getTriggerSourcePermanent(state, triggerItem)')).toBe(true);
    expect(stackExecuteTriggerEffectTailUtilsSource.includes("from './triggerPreparedStateUtils.js'")).toBe(true);
    expect(stackExecuteTriggerEffectUtilsSource.includes('applyRetiredTriggerLegacyCombinedEffectsRegexBatch')).toBe(false);
    expect(stackExecuteTriggerEffectUtilsSource.includes('applyRetiredTriggerLegacyAttackTriggerCreateCreatureToken')).toBe(false);
    expect(stackSource.includes("from './stackExecuteTriggerEffectUtils.js'")).toBe(true);
    expect(stackSource.includes('applyRetiredTriggerLegacySingleEffectRegexBatch')).toBe(false);
    expect(tokenHandlersSource.includes("from './triggerEtbEntryEffects.js'")).toBe(true);
    expect(cardSpecificHandlersSource.includes("from './triggerExploreUtils.js'")).toBe(false);
    expect(graveyardHandlersSource.includes("from './triggerEtbPermanentBridge.js'")).toBe(true);
    expect(delayedCleanupHandlersSource.includes("from './triggerEtbPermanentBridge.js'")).toBe(true);
    expect(combinedHandlersSource.includes("from '../creatureTypeNow.js'")).toBe(false);
    expect(descPrepHandlersSource.includes("from './triggerReanimationRiders.js'")).toBe(false);
    expect(stackSpecialTriggerHandlersSource.includes("from './triggerCastFromExileUtils.js'")).toBe(true);
    expect(combinedHandlersSource.includes("from './resolutionPromptEvents.js'")).toBe(false);
    expect(graveyardHandlersSource.includes("from './resolutionPromptEvents.js'")).toBe(true);
    expect(searchHandlersSource.includes("from './resolutionPromptEvents.js'")).toBe(false);
    expect(stackSource.includes("from './triggerReanimationRiders.js'")).toBe(true);
    expect(combinedHandlersSource.includes("from './triggerLandPlayPromptUtils.js'")).toBe(false);
    expect(keywordHandlersSource.includes("from './triggerKeywordChoiceUtils.js'")).toBe(true);
    expect(resolutionHandlersSource.includes("from './triggerLandPlayPromptUtils.js'")).toBe(false);
    expect(stackSource.includes("from './triggerKeywordChoiceUtils.js'")).toBe(true);
    expect(triggerEtbPermanentEffectsSource.includes('export function triggerETBEffectsForPermanent')).toBe(true);
    expect(triggerEtbPermanentEffectsSource.includes('export function queueSupportedETBKeywordChoices')).toBe(true);
    expect(triggerEtbPermanentEffectsSource.includes("from './triggerKeywordChoiceUtils.js'")).toBe(true);
    expect(stackSource.includes("from './triggerEtbPermanentEffects.js'")).toBe(true);
    expect(stackSource.includes('registerTriggerETBEffectsForPermanent')).toBe(false);
    expect(countersTokensSource.includes('triggerEtbPermanentEffects.js')).toBe(true);
    expect(countersTokensSource.includes("require('./stack.js')")).toBe(false);
    expect(triggerLifeDamageUtilsSource.includes('export function modifyTriggerEffectLife')).toBe(true);
    expect(triggerLifeDamageUtilsSource.includes('export function queueDealsDamageToPlayerTriggersFromPermanent')).toBe(true);
    expect(handlersSource.includes("from './triggerLifeDamageUtils.js'")).toBe(true);
    expect(stackSource.includes('function queueDealsDamageToPlayerTriggersFromPermanent')).toBe(false);
    expect(stackSource.includes("from './triggerLifeDamageUtils.js'")).toBe(true);
    expect(tokenHandlersSource.includes("from './triggerMyriadTokenUtils.js'")).toBe(false);
    expect(tokenHandlersSource.includes("from './counters_tokens.js'")).toBe(false);
    expect(counterHandlersSource.includes("from './triggerChosenTypeCounterUtils.js'")).toBe(false);
    expect(stackSource.includes('function applyMyriadTokenCopies')).toBe(false);
    expect(stackSource.includes('function resolveChosenTypeCounterEachCreature')).toBe(false);
    expect(singleEffectRegexBatchSource.includes('readonly executeSpellEffect')).toBe(false);
    expect(singleEffectRegexBatchSource.includes('readonly resolveChosenTypeCounterEachCreature')).toBe(false);
    expect(singleEffectRegexBatchSource.includes('readonly enqueueLibrarySearch')).toBe(false);
    expect(triggerLibraryMillUtilsSource.includes('export function millCardsFromLibrary')).toBe(true);
    expect(triggerLibrarySearchUtilsSource.includes('export function enqueueLibrarySearchStep')).toBe(true);
    expect(libraryHandlersSource.includes("from './triggerLibraryMillUtils.js'")).toBe(false);
    expect(libraryHandlersSource.includes("from '../../socket/may-ability-prompts.js'")).toBe(false);
    expect(searchHandlersSource.includes("from './triggerLibrarySearchUtils.js'")).toBe(true);
    expect(combinedHandlersSource.includes("from './triggers/life-loss.js'")).toBe(false);
    expect(stackSpecialTriggerHandlersSource.includes("from '../../socket/may-ability-prompts.js'")).toBe(true);
    expect(stackSource.includes('function millCardsFromLibrary')).toBe(false);
    expect(stackSource.includes('function enqueueLibrarySearchStep')).toBe(false);
    expect(stackSource.includes("from './triggerLibraryMillUtils.js'")).toBe(true);
    expect(stackSource.includes("from './triggerLibrarySearchUtils.js'")).toBe(true);
    expect(triggerVentureUtilsSource.includes('export function resolveVentureProgress')).toBe(true);
    expect(triggerVentureUtilsSource.includes('export function queueInitiativeVentureTrigger')).toBe(true);
    expect(gameStateHooksSource.includes("from './triggerVentureUtils.js'")).toBe(true);
    expect(stackSpecialTriggerHandlersSource.includes("from './counters_tokens.js'")).toBe(false);
    expect(stackSpecialTriggerHandlersSource.includes("from './prepared.js'")).toBe(false);
    expect(sacrificeHandlersSource.includes("from './upkeep-triggers.js'")).toBe(true);
    expect(cardSpecificHandlersSource.includes("from './zone-manipulation.js'")).toBe(false);
    expect(stackSource.includes('function resolveVentureProgress')).toBe(false);
    expect(stackSource.includes('function queueInitiativeVentureTrigger')).toBe(false);
    expect(stackSource.includes("from './triggerVentureUtils.js'")).toBe(true);
    expect(triggerPlayableFromExileUtilsSource.includes('export function queuePlayableFromExileChoiceStep')).toBe(true);
    expect(cardSpecificHandlersSource.includes("from './counters_tokens.js'")).toBe(false);
    expect(stackSource.includes('function queuePlayableFromExileChoiceStep')).toBe(false);
    expect(stackSource.includes("from './triggerPlayableFromExileUtils.js'")).toBe(true);
    expect(executeSpellEffectSource.includes('export function executeSpellEffect')).toBe(true);
    expect(executeSpellEffectSource.includes('export function scheduleExiledCardReturnToBattlefield')).toBe(true);
    expect(detectEntersWithCountersSource.includes('export function detectEntersWithCounters')).toBe(true);
    expect(stackSource.includes('function executeSpellEffect')).toBe(false);
    expect(stackSource.includes("from './executeSpellEffect.js'")).toBe(true);
    expect(stackSource.includes("from './detectEntersWithCounters.js'")).toBe(true);
    expect(spellLegacyTokenUtilsSource.includes('export function parseSpellLegacyTokenCreation')).toBe(true);
    expect(spellLegacyTokenUtilsSource.includes('export function createSpellLegacyTokenFromSpec')).toBe(true);
    expect(stackSource.includes('function parseTokenCreation')).toBe(false);
    expect(stackSource.includes("from './oracleIrSpellLegacyTokenUtils.js'") || stackSource.includes('from "./oracleIrSpellLegacyTokenUtils.js"')).toBe(true);
    expect(turnSource.includes('detectEntersWithCounters.js')).toBe(true);
    expect(turnSource.includes('triggerEtbEntryEffects.js')).toBe(true);
    expect(turnSource.includes('triggerEtbPermanentEffects.js')).toBe(true);
    expect(turnSource.includes('from "./stack.js"')).toBe(false);
    expect(kynaiosChoiceSource.includes('detectEntersWithCounters.js')).toBe(true);
    expect(kynaiosChoiceSource.includes('triggerEtbPermanentEffects.js')).toBe(true);
    expect(kynaiosChoiceSource.includes('triggerEtbEntryEffects.js')).toBe(true);
    expect(spellLegacySupplementalSource.includes('export function normalizeOracleResolutionText')).toBe(true);
    expect(spellLegacySupplementalSource.includes('export function applySupplementalOracleIRForResolvedSpell')).toBe(true);
    expect(stackSource.includes('function applySupplementalOracleIRForResolvedSpell')).toBe(false);
    expect(stackSource.includes('function normalizeOracleResolutionText')).toBe(false);
    expect(stackSource.includes("from './oracleIrSpellLegacySupplemental.js'") || stackSource.includes('from "./oracleIrSpellLegacySupplemental.js"')).toBe(false);
    expect(stackResolveSpellLegacySpecUtilsSource.includes("from './oracleIrSpellLegacySupplemental.js'") || stackResolveSpellLegacySpecUtilsSource.includes('from "./oracleIrSpellLegacySupplemental.js"')).toBe(true);
    expect(triggerPermanentEntersTappedSource.includes('export function checkPermanentEntersTapped')).toBe(true);
    expect(triggerPermanentEntersTappedSource.includes('export function checkCreatureEntersTapped')).toBe(true);
    expect(stackSource.includes('function checkPermanentEntersTapped')).toBe(false);
    expect(stackSource.includes('function checkCreatureEntersTapped')).toBe(false);
    expect(stackSource.includes("from './triggerPermanentEntersTapped.js'") || stackSource.includes('from "./triggerPermanentEntersTapped.js"')).toBe(true);
    expect(kynaiosChoiceSource.includes('triggerPermanentEntersTapped.js')).toBe(true);
    expect(kynaiosChoiceSource.includes("from '../../modules/stack.js'")).toBe(false);
    expect(spellLegacyTargetBuffUtilsSource.includes('export function applySimpleTargetedTemporarySpellEffects')).toBe(true);
    expect(spellLegacyTargetBuffUtilsSource.includes('export function splitGrantedTemporaryAbilities')).toBe(true);
    expect(stackSource.includes('function applySimpleTargetedTemporarySpellEffects')).toBe(false);
    expect(stackSource.includes('function splitGrantedTemporaryAbilities')).toBe(false);
    expect(stackSource.includes("from './oracleIrSpellLegacyTargetBuffUtils.js'") || stackSource.includes('from "./oracleIrSpellLegacyTargetBuffUtils.js"')).toBe(false);
    expect(stackResolveInstantSorceryLegacyBodyUtilsSource.includes("from './oracleIrSpellLegacyTargetBuffUtils.js'") || stackResolveInstantSorceryLegacyBodyUtilsSource.includes('from "./oracleIrSpellLegacyTargetBuffUtils.js"')).toBe(true);
    expect(stackContextUtilsSource.includes('export function buildStackOracleIRContext')).toBe(true);
    expect(stackContextUtilsSource.includes('export function resolveOracleQuantityToNumber')).toBe(true);
    expect(stackContextUtilsSource.includes('export function resolveOracleWhoToPlayerIds')).toBe(true);
    expect(stackSource.includes('function buildStackOracleIRContext')).toBe(false);
    expect(stackExecuteTriggerEffectUtilsSource.includes("from './oracleIrStackContextUtils.js'") || stackExecuteTriggerEffectUtilsSource.includes('from "./oracleIrStackContextUtils.js"')).toBe(false);
    expect(stackExecuteTriggerEffectIrFallbackUtilsSource.includes("from './oracleIrStackContextUtils.js'") || stackExecuteTriggerEffectIrFallbackUtilsSource.includes('from "./oracleIrStackContextUtils.js"')).toBe(true);
    expect(spellLegacyDispatchUtilsSource.includes('export function handleDispatch')).toBe(true);
    expect(stackSource.includes('function handleDispatch')).toBe(false);
    expect(stackSource.includes('function evaluateMetalcraft')).toBe(false);
    expect(stackSource.includes("from './oracleIrSpellLegacyDispatchUtils.js'") || stackSource.includes('from "./oracleIrSpellLegacyDispatchUtils.js"')).toBe(false);
    expect(stackResolveInstantSorceryLegacyBodyUtilsSource.includes("from './oracleIrSpellLegacyDispatchUtils.js'") || stackResolveInstantSorceryLegacyBodyUtilsSource.includes('from "./oracleIrSpellLegacyDispatchUtils.js"')).toBe(true);
    expect(spellLegacyTutorUtilsSource.includes('export function detectTutorSpell')).toBe(true);
    expect(spellLegacyTutorUtilsSource.includes('export function parseLibrarySearchFilter')).toBe(true);
    expect(spellLegacyTutorUtilsSource.includes('export function resolveCelestialReunionLibrarySearch')).toBe(true);
    expect(stackSource.includes('function detectTutorSpell')).toBe(false);
    expect(stackSource.includes('function parseLibrarySearchFilter')).toBe(false);
    expect(stackSource.includes('function applyOracleIRTapOrUntapStep')).toBe(false);
    expect(stackSource.includes('function applyOracleIRExileTopStep')).toBe(false);
    expect(stackSource.includes("from './oracleIrSpellLegacyTutorUtils.js'") || stackSource.includes('from "./oracleIrSpellLegacyTutorUtils.js"')).toBe(false);
    expect(stackResolveSpellLibraryHandlersUtilsSource.includes("from './oracleIrSpellLegacyTutorUtils.js'") || stackResolveSpellLibraryHandlersUtilsSource.includes('from "./oracleIrSpellLegacyTutorUtils.js"')).toBe(true);
    expect(kindredRevealUtilsSource.includes('export function resolveKindredSummonsFromLibrary')).toBe(true);
    expect(kindredRevealUtilsSource.includes('export function detectRevealUntilHandSpell')).toBe(true);
    expect(kindredRevealUtilsSource.includes('export function summarizeLibraryCard')).toBe(true);
    expect(stackSource.includes('function resolveKindredSummonsFromLibrary')).toBe(false);
    expect(stackSource.includes('function detectRevealUntilHandSpell')).toBe(false);
    expect(stackSource.includes("from './oracleIrSpellLegacyKindredRevealUtils.js'") || stackSource.includes('from "./oracleIrSpellLegacyKindredRevealUtils.js"')).toBe(false);
    expect(stackResolveSpellLibraryHandlersUtilsSource.includes("from './oracleIrSpellLegacyKindredRevealUtils.js'") || stackResolveSpellLibraryHandlersUtilsSource.includes('from "./oracleIrSpellLegacyKindredRevealUtils.js"')).toBe(true);
    expect(dayNightSource.includes('export function applyExplicitDayNightChangeFromText')).toBe(true);
    expect(stackSource.includes('function applyExplicitDayNightChangeFromText')).toBe(false);
    expect(stackResolveTopOfStackPrefaceUtilsSource.includes('applyExplicitDayNightChangeFromText')).toBe(true);
    expect(stackResolveTopOfStackPrefaceUtilsSource.includes('resolveStackItemEffectiveCard(item, card)')).toBe(true);
    expect(stackResolveTopOfStackPrefaceUtilsSource.includes('shouldFizzleStackSpellForMissingTargets')).toBe(true);
    expect(stackResolveTopOfStackPrefaceUtilsSource.includes('hasWouldEnterDiscardLandReplacement')).toBe(true);
    expect(stackResolveTopOfStackPrefaceUtilsSource.includes('queueWouldEnterDiscardLandChoiceForStackItem')).toBe(true);
    expect(stackResolveTopOfStackUtilsSource.includes('applyExplicitDayNightChangeFromText')).toBe(false);
    expect(stackResolveTopOfStackUtilsSource.includes('tryPrepareResolveTopOfStackContext(ctx')).toBe(true);
    expect(stackResolveTopOfStackUtilsSource.includes('tryDispatchResolvedStackItem(ctx')).toBe(true);
    expect(stackResolveTopOfStackDispatchUtilsSource.includes('export function tryDispatchResolvedStackItem')).toBe(true);
    expect(reflexiveWhenYouDoQueueSource.includes('export function tryDeferReflexiveWhenYouDoTriggers')).toBe(true);
    expect(stackSource.includes('function maybeQueueReflexiveAnyAmountManaPayment')).toBe(false);
    expect(stackSource.includes('function maybeQueueReflexiveSacrificeWhenYouDo')).toBe(false);
    expect(stackResolveTriggeredAbilityDeferralUtilsSource.includes("from './triggerReflexiveWhenYouDoQueueUtils.js'") || stackResolveTriggeredAbilityDeferralUtilsSource.includes('from "./triggerReflexiveWhenYouDoQueueUtils.js"')).toBe(true);
    expect(stackResolveTriggeredAbilityDeferralUtilsSource.includes('tryDeferReflexiveWhenYouDoTriggers')).toBe(true);
    expect(optionalPaymentQueueSource.includes('export function tryDeferOptionalTriggerPaymentPrompts')).toBe(true);
    expect(stackSource.includes('function maybeQueueOpponentMayPaySpellCastTrigger')).toBe(false);
    expect(stackSource.includes('function maybeQueueEchoTriggeredAbility')).toBe(false);
    expect(stackResolveTriggeredAbilityDeferralUtilsSource.includes("from './triggerOptionalPaymentQueueUtils.js'") || stackResolveTriggeredAbilityDeferralUtilsSource.includes('from "./triggerOptionalPaymentQueueUtils.js"')).toBe(true);
    expect(stackResolveTriggeredAbilityDeferralUtilsSource.includes('tryDeferOptionalTriggerPaymentPrompts')).toBe(true);
    expect(summonsUtilsSource.includes('export function applySummonsOfSarumanEffect')).toBe(true);
    expect(stackSource.includes('function applySummonsOfSarumanEffect')).toBe(false);
    expect(stackResolveSpellSpecialCaseUtilsSource.includes("from './oracleIrSpellLegacySummonsUtils.js'") || stackResolveSpellSpecialCaseUtilsSource.includes('from "./oracleIrSpellLegacySummonsUtils.js"')).toBe(true);
    expect(librarySelectionUtilsSource.includes('export function queueTopLibraryToHandSelectionPrompt')).toBe(true);
    expect(librarySelectionUtilsSource.includes('export function queueChosenTypeTopLibraryRevealPrompt')).toBe(true);
    expect(librarySelectionUtilsSource.includes('export function queueTopLibraryExileSelectionPrompt')).toBe(true);
    expect(stackSource.includes('function queueTopLibraryToHandSelectionPrompt')).toBe(false);
    expect(stackSource.includes('function queueTopLibraryExileSelectionPrompt')).toBe(false);
    expect(
      stackResolveSpellLibraryTopPromptUtilsSource.includes("from './oracleIrSpellLegacyLibrarySelectionUtils.js'")
      || stackResolveSpellLibraryTopPromptUtilsSource.includes('from "./oracleIrSpellLegacyLibrarySelectionUtils.js"'),
    ).toBe(true);
    expect(abilityCopyUtilsSource.includes('export function tryDeferCopyTriggeredAbilityPrompts')).toBe(true);
    expect(abilityCopyUtilsSource.includes('export function cloneStackItemForAbilityCopy')).toBe(true);
    expect(stackSource.includes('function cloneStackItemForAbilityCopy')).toBe(false);
    expect(stackSource.includes('OPTIONAL_COPY_ABILITY_PAYMENT_PATTERN')).toBe(false);
    expect(stackResolveTriggeredAbilityDeferralUtilsSource.includes("from './triggerAbilityCopyUtils.js'") || stackResolveTriggeredAbilityDeferralUtilsSource.includes('from "./triggerAbilityCopyUtils.js"')).toBe(true);
    expect(stackResolveTriggeredAbilityDeferralUtilsSource.includes('tryDeferCopyTriggeredAbilityPrompts')).toBe(true);
    expect(chosenTypeSpellUtilsSource.includes('export function applyMetallicMimicEntryBonus')).toBe(true);
    expect(chosenTypeSpellUtilsSource.includes('export function resolveChosenTypeDrawPerCreature')).toBe(true);
    expect(stackSource.includes('function applyMetallicMimicEntryBonus')).toBe(false);
    expect(stackResolveTriggeredAbilityChosenTypeUtilsSource.includes("from './triggerChosenTypeSpellUtils.js'") || stackResolveTriggeredAbilityChosenTypeUtilsSource.includes('from "./triggerChosenTypeSpellUtils.js"')).toBe(true);
    expect(creatureEntryHasteUtilsSource.includes('export function creatureWillHaveHaste')).toBe(true);
    expect(stackSource.includes('function extractCreatureTypes')).toBe(false);
    expect(stackSource.includes('function creatureWillHaveHaste')).toBe(false);
    expect(stackSource.includes("from './creatureEntryHasteUtils.js'") || stackSource.includes('from "./creatureEntryHasteUtils.js"')).toBe(true);
    expect(spellLegacyChoiceBatchUtilsSource.includes('export function createDivineReckoningChoiceBatch')).toBe(true);
    expect(spellLegacyChoiceBatchUtilsSource.includes('export function applyPrisonersDilemmaBatchResult')).toBe(true);
    expect(stackSource.includes('function createDivineReckoningChoiceBatch')).toBe(false);
    expect(stackSource.includes('function computePrisonersDilemmaDamage')).toBe(false);
    expect(stackSource.includes("from './spellLegacyChoiceBatchUtils.js'") || stackSource.includes('from "./spellLegacyChoiceBatchUtils.js"')).toBe(true);
    expect(tributeChoiceUtilsSource.includes('export function queueTributeChoiceOnEntry')).toBe(true);
    expect(stackSource.includes('function queueTributeChoiceOnEntry')).toBe(false);
    expect(stackSource.includes("from './triggerTributeChoiceUtils.js'") || stackSource.includes('from "./triggerTributeChoiceUtils.js"')).toBe(true);
    expect(artifactTokenUtilsSource.includes('export function parseCommonArtifactTokenOptions')).toBe(true);
    expect(stackSource.includes('function parseCommonArtifactTokenOptions')).toBe(false);
    expect(stackSource.includes("from './oracleIrSpellLegacyArtifactTokenUtils.js'") || stackSource.includes('from "./oracleIrSpellLegacyArtifactTokenUtils.js"')).toBe(true);
    expect(artifactTokenUtilsSource.includes('export function createTreasureToken')).toBe(true);
    expect(stackSource.includes('function createTreasureToken')).toBe(false);
    expect(spellLegacyTokenUtilsSource.includes('export function createBeastToken')).toBe(true);
    expect(stackSource.includes('function createBeastToken')).toBe(false);
    expect(stackSource.includes("from './oracleIrSpellLegacyTokenUtils.js'") || stackSource.includes('from "./oracleIrSpellLegacyTokenUtils.js"')).toBe(true);
    expect(stackManifestUtilsSource.includes('export function manifestCard')).toBe(true);
    expect(stackSource.includes('function manifestCard')).toBe(false);
    expect(stackSource.includes("from './stackManifestUtils.js'") || stackSource.includes('from "./stackManifestUtils.js"')).toBe(true);
    expect(stackExileUtilsSource.includes('export function exileEntireStack')).toBe(true);
    expect(stackSource.includes('function exileEntireStack')).toBe(false);
    expect(stackSource.includes("from './stackExileUtils.js'") || stackSource.includes('from "./stackExileUtils.js"')).toBe(true);
    expect(stackSource.includes('function resolveDealDamageTargetToPlayerIds')).toBe(false);
    expect(stackSource.includes('function parseDeterministicManaToPool')).toBe(false);
    expect(artifactTokenUtilsSource.includes('export const PREDEFINED_TRIGGER_ARTIFACT_TOKEN_KINDS')).toBe(true);
    expect(artifactTokenUtilsSource.includes('export function resolveCommonArtifactTokenKind')).toBe(true);
    expect(tokenHandlersSource.includes('PREDEFINED_ARTIFACT_TOKEN_TYPES')).toBe(false);
    expect(tokenHandlersSource.includes("from './oracleIrSpellLegacyArtifactTokenUtils.js'") || tokenHandlersSource.includes('from "./oracleIrSpellLegacyArtifactTokenUtils.js"')).toBe(false);
    expect(removalRiderUtilsSource.includes('export function applySpellLegacyRemovalArtifactRiders')).toBe(true);
    expect(stackSource.includes('function isFatefulAbsence')).toBe(false);
    expect(stackSource.includes('function isGetLost')).toBe(false);
    expect(stackSource.includes("from './oracleIrSpellLegacyRemovalRiderUtils.js'") || stackSource.includes('from "./oracleIrSpellLegacyRemovalRiderUtils.js"')).toBe(true);
    expect(stackSource.includes('applySpellLegacyRemovalArtifactRiders')).toBe(true);
    expect(removalRiderUtilsSource.includes('export function isNaturesClaimRemovalRider')).toBe(true);
    expect(removalRiderUtilsSource.includes('export function applyNaturesClaimLifeRider')).toBe(true);
    expect(stackSource.includes('const isNaturesClaim =')).toBe(false);
    expect(stackSource.includes("[resolveTopOfStack] Nature's Claim:")).toBe(false);
    expect(spellShapeUtilsSource.includes('export function isExtraTurnSpell')).toBe(true);
    expect(spellShapeUtilsSource.includes('export function getPonderConfig')).toBe(true);
    expect(spellShapeUtilsSource.includes('export function parseNumberWord')).toBe(true);
    expect(stackSource.includes('function isExtraTurnSpell')).toBe(false);
    expect(stackSource.includes('function getPonderConfig')).toBe(false);
    expect(stackSource.includes('function parseNumberWord')).toBe(false);
    expect(stackSource.includes("from './oracleIrSpellLegacySpellShapeUtils.js'") || stackSource.includes('from "./oracleIrSpellLegacySpellShapeUtils.js"')).toBe(true);
    expect(removalRiderUtilsSource.includes('export function applySpellLegacyRemovalRiders')).toBe(true);
    expect(removalRiderUtilsSource.includes('export function applyPathToExileBasicLandSearch')).toBe(true);
    expect(removalRiderUtilsSource.includes('export function applyEntrapmentManeuverSacrificePrompt')).toBe(true);
    expect(removalRiderUtilsSource.includes('export function shouldCaptureRemovalTargetControllerMetadata')).toBe(true);
    expect(stackSource.includes('function checkOpponentHasMoreLands')).toBe(false);
    expect(stackSource.includes('const isPathToExile =')).toBe(false);
    expect(stackSource.includes('const isEntrapmentManeuver =')).toBe(false);
    expect(stackSource.includes('applySpellLegacyRemovalRiders')).toBe(true);
    expect(stackSource.includes("from './stackLandCountUtils.js'") || stackSource.includes('from "./stackLandCountUtils.js"')).toBe(true);
    expect(stackLandCountUtilsSource.includes('export function checkOpponentHasMoreLands')).toBe(true);
    expect(stackTargetLegalityUtilsSource.includes('export function shouldFizzleStackSpellForMissingTargets')).toBe(true);
    expect(stackTargetLegalityUtilsSource.includes('export function moveFizzledStackSpellCard')).toBe(true);
    expect(stackSource.includes('function shouldFizzleStackSpellForMissingTargets')).toBe(false);
    expect(stackSource.includes('function moveFizzledStackSpellCard')).toBe(false);
    expect(stackSource.includes("from './stackTargetLegalityUtils.js'") || stackSource.includes('from "./stackTargetLegalityUtils.js"')).toBe(true);
    expect(specialSpellRiderUtilsSource.includes('export function applySpellLegacySpecialSpellRiders')).toBe(true);
    expect(specialSpellRiderUtilsSource.includes('export function applyJaheirasRespiteLibrarySearch')).toBe(true);
    expect(specialSpellRiderUtilsSource.includes('export function applyChaosWarpEffect')).toBe(true);
    expect(stackSource.includes('const isJaheirasRespite =')).toBe(false);
    expect(stackSource.includes('const isChaosWarp =')).toBe(false);
    expect(stackSource.includes('[resolveTopOfStack] Chaos Warp:')).toBe(false);
    expect(stackSource.includes('applySpellLegacySpecialSpellRiders')).toBe(true);
    expect(stackSource.includes("from './oracleIrSpellLegacySpecialSpellRiderUtils.js'") || stackSource.includes('from "./oracleIrSpellLegacySpecialSpellRiderUtils.js"')).toBe(true);
    expect(stackReplayUtilsSource.includes('export function repairReplayCardSourceZones')).toBe(true);
    expect(stackSource.includes('function repairReplayCardSourceZones')).toBe(false);
    expect(stackSource.includes("from './stackReplayUtils.js'") || stackSource.includes('from "./stackReplayUtils.js"')).toBe(true);
    expect(stackPlayLandUtilsSource.includes('export function playLand')).toBe(true);
    expect(stackSource.includes('export function playLand')).toBe(false);
    expect(stackSource.includes("from './stackPlayLandUtils.js'") || stackSource.includes('from "./stackPlayLandUtils.js"')).toBe(true);
    expect(stackCastSpellUtilsSource.includes('export function castSpell')).toBe(true);
    expect(stackSource.includes('export function castSpell')).toBe(false);
    expect(stackSource.includes("from './stackCastSpellUtils.js'") || stackSource.includes('from "./stackCastSpellUtils.js"')).toBe(true);
    expect(stackSource.includes('function getPermanentSpellTypeWords')).toBe(false);
    expect(stackSource.includes('function recordGraveyardPermanentTypesCastThisTurn')).toBe(false);
    expect(stackPushUtilsSource.includes('export function pushStack')).toBe(true);
    expect(stackPushUtilsSource.includes('export function popStackItem')).toBe(true);
    expect(stackSource.includes('export function pushStack')).toBe(false);
    expect(stackSource.includes('function popStackItem')).toBe(false);
    expect(stackSource.includes("from './stackPushUtils.js'") || stackSource.includes('from "./stackPushUtils.js"')).toBe(true);
    expect(turnTrackingSource.includes('export function recordGraveyardPermanentTypesCastThisTurn')).toBe(true);
    expect(turnTrackingSource.includes('export function recordCommittedCrimeThisTurn')).toBe(true);
    expect(stackCastSpellUtilsSource.includes('function getPermanentSpellTypeWords')).toBe(false);
    expect(stackCastSpellUtilsSource.includes("from './turn-tracking.js'") || stackCastSpellUtilsSource.includes('from "./turn-tracking.js"')).toBe(true);
    expect(stackResolveEffectiveCardUtilsSource.includes('export function resolveStackItemEffectiveCard')).toBe(true);
    expect(stackResolveTopOfStackPrefaceUtilsSource.includes('resolveStackItemEffectiveCard(item, card)')).toBe(true);
    expect(stackResolveTopOfStackUtilsSource.includes('resolveStackItemEffectiveCard(item, card)')).toBe(false);
    expect(stackSource.includes('let effectiveTypeLine = card?.type_line')).toBe(false);
    expect(stackSource.includes('[resolveTopOfStack] Transform DFC')).toBe(false);
    expect(stackSource.includes('function resolveStackItemEffectiveCard')).toBe(false);
    expect(stackSource.includes("from './stackResolveEffectiveCardUtils.js'") || stackSource.includes('from "./stackResolveEffectiveCardUtils.js"')).toBe(true);
    expect(stackResolveAbilityHandlersUtilsSource.includes('tryResolveStackActivatedAbilityEarlyHandlers')).toBe(true);
    expect(stackResolveAbilityEarlyHandlersUtilsSource.includes('export function tryResolveStackActivatedAbilityEarlyHandlers')).toBe(true);
    expect(stackResolveAbilityEarlyHandlersUtilsSource.includes("abilityType === 'fetch-land'")).toBe(true);
    expect(stackResolveAbilityEarlyHandlersUtilsSource.includes("abilityType === 'cycling'")).toBe(true);
    expect(stackResolveAbilityHandlersUtilsSource.includes("abilityType === 'fight'")).toBe(false);
    expect(stackResolveAbilityMidHandlersUtilsSource.includes("abilityType === 'fight'")).toBe(true);
    expect(stackResolveAbilityMidHandlersUtilsSource.includes("abilityType === 'equip'")).toBe(true);
    expect(stackResolveAbilityMidHandlersUtilsSource.includes("abilityType === 'fortify'")).toBe(true);
    expect(stackResolveAbilityMidHandlersUtilsSource.includes('export function tryResolveStackActivatedAbilityMidHandlers')).toBe(true);
    expect(stackResolveAbilityLateHandlersUtilsSource.includes('export function tryResolveStackActivatedAbilityLateHandlers')).toBe(true);
    expect(stackResolveAbilityLateHandlersUtilsSource.includes('tryApplyOracleIRToActivatedAbility(ctx')).toBe(true);
    expect(stackResolveAbilityLateHandlersUtilsSource.includes('isEquipmentAttachAbility')).toBe(true);
    expect(stackSource.includes('isEquipmentAttachAbility')).toBe(false);
    expect(stackSource.includes('tryApplyOracleIRToActivatedAbility(ctx')).toBe(false);
    expect(stackSource.includes("from './stackResolveAbilityHandlersUtils.js'") || stackSource.includes('from "./stackResolveAbilityHandlersUtils.js"')).toBe(true);
    expect(stackResolveTopOfStackDispatchUtilsSource.includes('tryResolveStackActivatedAbilityLateHandlers(ctx, {')).toBe(true);
    expect(stackResolveTopOfStackDispatchUtilsSource.includes('executeTriggerEffect')).toBe(true);
    expect(stackResolveTopOfStackUtilsSource.includes('tryResolveStackActivatedAbilityLateHandlers(ctx, item, controller, targets, { executeTriggerEffect })')).toBe(false);
    expect(stackResolveSpellZoneUtilsSource.includes('export function moveResolvedInstantOrSorceryAfterResolution')).toBe(true);
    expect(stackResolveSpellZoneUtilsSource.includes('export function finalizeResolvedInstantOrSorceryResolution')).toBe(true);
    expect(stackResolveSpellZoneUtilsSource.includes('export function tryResolveApproachOfTheSecondSunAfterEffects')).toBe(true);
    expect(stackResolveInstantSorceryOrchestratorUtilsSource.includes('export function resolveInstantOrSorceryStackItem')).toBe(true);
    expect(stackResolveTopOfStackDispatchUtilsSource.includes('resolveInstantOrSorceryStackItem(ctx')).toBe(true);
    expect(stackResolveTopOfStackUtilsSource.includes('resolveInstantOrSorceryStackItem(ctx')).toBe(false);
    expect(stackResolveInstantSorceryOrchestratorUtilsSource.includes('tryResolveInstantSorceryPreface(ctx')).toBe(true);
    expect(stackResolveInstantSorceryOrchestratorUtilsSource.includes('tryResolveInstantSorceryLegacyResolution(ctx')).toBe(true);
    expect(stackResolveInstantSorceryLegacyResolutionUtilsSource.includes('finalizeResolvedInstantOrSorceryResolution(ctx')).toBe(true);
    expect(stackResolveInstantSorceryOrchestratorUtilsSource.includes('finalizeResolvedInstantOrSorceryResolution(ctx')).toBe(false);
    expect(stackSource.includes('finalizeResolvedInstantOrSorceryResolution(ctx')).toBe(false);
    expect(stackSource.includes('approachCastHistory')).toBe(false);
    expect(stackResolveSpellCopyChoiceUtilsSource.includes('export function wasSpellCastFromGraveyard')).toBe(true);
    expect(stackResolveSpellCopyChoiceUtilsSource.includes('export function buildResolvedSpellCopySnapshot')).toBe(true);
    expect(stackSource.includes('function wasSpellCastFromGraveyard')).toBe(false);
    expect(stackSource.includes('function buildResolvedSpellCopySnapshot')).toBe(false);
    expect(stackSource.includes('moveResolvedInstantOrSorceryAfterResolution(ctx')).toBe(false);
    expect(stackResolveSpellChoiceUtilsSource.includes('export function tryResolveInstantSorceryPreResolutionChoices')).toBe(true);
    expect(stackResolveInstantSorceryPrefaceUtilsSource.includes('tryResolveInstantSorceryPreResolutionChoices(ctx')).toBe(true);
    expect(stackSource.includes('tryResolveInstantSorceryPreResolutionChoices(ctx')).toBe(false);
    expect(stackSource.includes('spellColorChoicePattern')).toBe(false);
    expect(stackSource.includes('hasCreatureTypeChoiceSpell')).toBe(false);
    expect(stackSource.includes('protection from the chosen colou?r')).toBe(false);
    expect(stackResolveSpellAcademicProbationUtilsSource.includes('export function tryResolveAcademicProbationSpellEffects')).toBe(true);
    expect(stackResolveInstantSorceryPrefaceUtilsSource.includes('tryResolveAcademicProbationSpellEffects(ctx')).toBe(true);
    expect(stackSource.includes('tryResolveAcademicProbationSpellEffects(ctx')).toBe(false);
    expect(stackSource.includes('isAcademicProbation')).toBe(false);
    expect(stackSource.includes('untilNextTurnSpellNameCastRestrictions')).toBe(false);
    expect(stackResolveInstantSorceryPrefaceUtilsSource.includes('detectInstantSorcerySpellShapeFlags(')).toBe(true);
    expect(stackSource.includes('detectInstantSorcerySpellShapeFlags(')).toBe(false);
    expect(stackSource.includes('whenever a creature or enchantment you control enters this turn')).toBe(false);
    expect(stackResolveSpellSpecialCaseUtilsSource.includes('export function applyInstantSorcerySpecialCaseSpellEffects')).toBe(true);
    expect(stackResolveInstantSorceryLegacyResolutionUtilsSource.includes('applyInstantSorcerySpecialCaseSpellEffects(ctx')).toBe(true);
    expect(stackSource.includes('applyInstantSorcerySpecialCaseSpellEffects(ctx')).toBe(false);
    expect(stackSource.includes('createDivineReckoningChoiceBatch(')).toBe(false);
    expect(stackSource.includes('createPrisonersDilemmaChoiceBatch(')).toBe(false);
    expect(stackSource.includes('addTemporaryEtbTrigger(state')).toBe(false);
    expect(stackResolveSpellSpecialCaseUtilsSource.includes('export function applyInstantSorceryNibelheimAflameEffect')).toBe(true);
    expect(
      stackResolveInstantSorceryLegacyResolutionUtilsSource.includes('tryApplyInstantSorceryUncategorizedSpellFallback(ctx')
      || stackResolveInstantSorceryLegacyBodyUtilsSource.includes('applyInstantSorceryNibelheimAflameEffect(ctx'),
    ).toBe(true);
    expect(
      oracleIrUncategorizedSpellFallbackSource.includes('applyInstantSorceryNibelheimAflameEffect(ctx')
      || stackResolveInstantSorceryLegacyBodyUtilsSource.includes('applyInstantSorceryNibelheimAflameEffect(ctx'),
    ).toBe(true);
    expect(stackSource.includes('applyInstantSorceryNibelheimAflameEffect(ctx')).toBe(false);
    expect(stackSource.includes('isNibelheimAflameStyleSweep =')).toBe(false);
    expect(stackSource.includes('creaturesDamagedByThisCreatureThisTurn')).toBe(false);
    expect(stackResolveSpellTargetMetadataUtilsSource.includes('export function captureInstantSorceryRemovalTargetMetadata')).toBe(true);
    expect(stackResolveSpellTargetMetadataUtilsSource.includes('export function applyInstantSorceryItsControllerCreatesToken')).toBe(true);
    expect(stackResolveInstantSorceryPrefaceUtilsSource.includes('captureInstantSorceryRemovalTargetMetadata(ctx')).toBe(true);
    expect(stackSource.includes('captureInstantSorceryRemovalTargetMetadata(ctx')).toBe(false);
    expect(stackResolveInstantSorceryPrefaceUtilsSource.includes('tryResolveInstantSorceryOracleIrSpell(ctx')).toBe(true);
    expect(stackSource.includes('tryResolveInstantSorceryOracleIrSpell(ctx')).toBe(false);
    expect(stackSource.includes('tryResolveSpellViaOracleIR(ctx')).toBe(false);
    expect(stackResolveSpellOracleIrUtilsSource.includes('export function tryResolveInstantSorceryOracleIrSpell')).toBe(true);
    expect(stackResolveSharedTypesSource.includes('export type InstantSorceryOracleIrSpellOutcome')).toBe(true);
    expect(stackResolveSharedTypesSource.includes('export type InstantSorceryRemovalTargetMetadata')).toBe(true);
    expect(stackResolveSpellOracleIrUtilsSource.includes('export type InstantSorceryOracleIrSpellOutcome =')).toBe(false);
    expect(stackResolveSpellTargetMetadataUtilsSource.includes('export type InstantSorceryRemovalTargetMetadata =')).toBe(false);
    expect(stackResolveSpellOracleIrUtilsSource.includes("from './stackResolveSharedTypes.js'") || stackResolveSpellOracleIrUtilsSource.includes('from "./stackResolveSharedTypes.js"')).toBe(true);
    expect(stackResolveSpellTargetMetadataUtilsSource.includes("from './stackResolveSharedTypes.js'") || stackResolveSpellTargetMetadataUtilsSource.includes('from "./stackResolveSharedTypes.js"')).toBe(true);
    expect(stackResolveSharedTypesSource.includes('export type InstantSorceryPrefaceSpellShapeFields')).toBe(true);
    expect(stackResolveSharedTypesSource.includes('export type InstantSorcerySpellShapeFlags')).toBe(true);
    expect(stackResolveSharedTypesSource.includes("from './oracleIrSpellLegacySpellShapeUtils.js'")).toBe(false);
    expect(oracleIrSpellLegacySpellShapeUtilsSource.includes('export type InstantSorcerySpellShapeFlags =')).toBe(false);
    expect(oracleIrSpellLegacySpellShapeUtilsSource.includes("from './stackResolveSharedTypes.js'") || oracleIrSpellLegacySpellShapeUtilsSource.includes('from "./stackResolveSharedTypes.js"')).toBe(true);
    expect(stackResolveSharedTypesSource.includes('InstantSorceryOracleIrSpellOutcome &')).toBe(true);
    expect(stackResolveSharedTypesSource.includes('InstantSorceryRemovalTargetMetadata')).toBe(true);
    expect(stackResolveSharedTypesSource.includes('export type InstantSorceryOracleIrSpellOptions')).toBe(true);
    expect(stackResolveSharedTypesSource.includes('export type InstantSorceryRemovalTargetMetadataOptions')).toBe(true);
    expect(stackResolveSpellOracleIrUtilsSource.includes('options: InstantSorceryOracleIrSpellOptions')).toBe(true);
    expect(stackResolveSpellTargetMetadataUtilsSource.includes('options: InstantSorceryRemovalTargetMetadataOptions')).toBe(true);
    expect(stackResolveInstantSorceryPrefaceUtilsSource.includes('...oracleIrSpellOutcome')).toBe(true);
    expect(stackResolveInstantSorceryPrefaceUtilsSource.includes('...removalTargetMetadata')).toBe(true);
    expect(stackResolveSpellLegacySpecUtilsSource.includes('export function executeInstantSorceryLegacyCategorizedSpell')).toBe(true);
    expect(stackResolveInstantSorceryPrefaceUtilsSource.includes('executeInstantSorceryLegacyCategorizedSpell(ctx')).toBe(true);
    expect(stackSource.includes('executeInstantSorceryLegacyCategorizedSpell(ctx')).toBe(false);
    expect(stackSource.includes('resolveSpell(')).toBe(false);
    expect(stackSource.includes('detectSpellLandBonus(')).toBe(false);
    expect(stackSource.includes('applySupplementalOracleIRForResolvedSpell(')).toBe(false);
    expect(stackResolveSpellUncategorizedUtilsSource.includes('export function tryApplyInstantSorceryUncategorizedSpellFallback')).toBe(true);
    expect(stackResolveInstantSorceryLegacyResolutionUtilsSource.includes('tryApplyInstantSorceryUncategorizedSpellFallback(ctx')).toBe(true);
    expect(stackSource.includes('tryApplyInstantSorceryUncategorizedSpellFallback(ctx')).toBe(false);
    expect(stackSource.includes('applyOracleIRUncategorizedSpellFallback(')).toBe(false);
    expect(stackResolveSpellGraveyardAutomationUtilsSource.includes('export function resolveInstantSorceryGraveyardEffectiveOracleText')).toBe(true);
    expect(stackResolveSpellGraveyardAutomationUtilsSource.includes('export function applyInstantSorceryGraveyardZoneChangeAutomation')).toBe(true);
    expect(stackResolveInstantSorceryLegacyResolutionUtilsSource.includes('applyInstantSorceryGraveyardZoneChangeAutomation(ctx')).toBe(true);
    expect(stackSource.includes('applyInstantSorceryGraveyardZoneChangeAutomation(ctx')).toBe(false);
    expect(stackSource.includes('graveyardSelectedModeDescriptions')).toBe(false);
    expect(stackSource.includes('KEYWORD_GRANT_VOCAB')).toBe(false);
    expect(stackSource.includes('hasSpellMastery(ctx')).toBe(false);
    expect(stackResolveSpellPostCategorizeRidersUtilsSource.includes('export function applyInstantSorceryCopyStackSpellRiders')).toBe(true);
    expect(stackResolveSpellPostCategorizeRidersUtilsSource.includes('export function applyInstantSorceryFracturedIdentityAndFallbackRiders')).toBe(true);
    expect(stackResolveInstantSorceryLegacyResolutionUtilsSource.includes('applyInstantSorceryCopyStackSpellRiders(ctx')).toBe(true);
    expect(stackResolveInstantSorceryLegacyBodyUtilsSource.includes('applyInstantSorceryFracturedIdentityAndFallbackRiders(ctx')).toBe(true);
    expect(stackSource.includes('applyInstantSorceryCopyStackSpellRiders(ctx')).toBe(false);
    expect(stackSource.includes('applyInstantSorceryFracturedIdentityAndFallbackRiders(ctx')).toBe(false);
    expect(stackSource.includes('isFracturedIdentity')).toBe(false);
    expect(stackSource.includes('conditionalWipeMatch')).toBe(false);
    expect(stackSource.includes('parseSpellLegacyTokenCreation(')).toBe(false);
    expect(stackSource.includes('copy target instant or sorcery spell you control')).toBe(false);
    expect(stackResolveSpellLegacyRegexDrawUtilsSource.includes('export function applyLegacySpellRegexDrawHandlers')).toBe(true);
    expect(stackResolveSpellLegacyRegexDrawUtilsSource.includes('export function applyLegacySpellRegexLifeGainHandler')).toBe(false);
    expect(stackResolveInstantSorceryLegacyBodyUtilsSource.includes('applyLegacySpellRegexDrawHandlers(ctx')).toBe(true);
    expect(stackResolveInstantSorceryLegacyBodyUtilsSource.includes('applyLegacySpellRegexLifeGainHandler(ctx')).toBe(false);
    expect(stackSource.includes('applyLegacySpellRegexDrawHandlers(ctx')).toBe(false);
    expect(stackSource.includes('lifeGainMatch')).toBe(false);
    expect(stackSource.includes('shuffleHandAndGraveyardWheelMatch')).toBe(false);
    expect(stackResolveSpellControlChangeUtilsSource.includes('export function applyInstantSorceryControlChangeAndMassZoneEffects')).toBe(true);
    expect(stackResolveInstantSorceryLegacyBodyUtilsSource.includes('applyInstantSorceryControlChangeAndMassZoneEffects(ctx')).toBe(true);
    expect(stackSource.includes('applyInstantSorceryControlChangeAndMassZoneEffects(ctx')).toBe(false);
    expect(stackSource.includes('massBounceFilter')).toBe(false);
    expect(stackSource.includes('hasExchangeCreaturesEffect')).toBe(false);
    expect(stackSource.includes('function buildPermanentTokenCopy')).toBe(false);
    expect(stackResolveSpellLibraryHandlersUtilsSource.includes('export function applyInstantSorceryTokenForEachCreatureHandler')).toBe(true);
    expect(stackResolveSpellLibraryHandlersUtilsSource.includes('export function applyInstantSorceryLibrarySearchSpellHandlers')).toBe(true);
    expect(stackResolveInstantSorceryLegacyBodyUtilsSource.includes('applyInstantSorceryTokenForEachCreatureHandler(ctx')).toBe(true);
    expect(stackResolveInstantSorceryLegacyBodyUtilsSource.includes('applyInstantSorceryLibrarySearchSpellHandlers(ctx')).toBe(true);
    expect(stackSource.includes('applyInstantSorceryTokenForEachCreatureHandler(ctx')).toBe(false);
    expect(stackSource.includes('applyInstantSorceryLibrarySearchSpellHandlers(ctx')).toBe(false);
    expect(stackResolveSpellLateRidersUtilsSource.includes('export function applyInstantSorcerySpecialAndRemovalRiders')).toBe(true);
    expect(stackResolveInstantSorceryLegacyBodyUtilsSource.includes('applyInstantSorcerySpecialAndRemovalRiders(ctx')).toBe(true);
    expect(stackSource.includes('applySpellLegacySpecialSpellRiders(ctx')).toBe(false);
    expect(stackSource.includes('applySpellLegacyRemovalRiders(ctx')).toBe(false);
    expect(stackSource.includes('tokenForEachCreaturePattern')).toBe(false);
    expect(stackSource.includes('isTraverseOutlands')).toBe(false);
    expect(stackSource.includes('isGiftOfEstates')).toBe(false);
    expect(stackSource.includes('detectTutorSpell(')).toBe(false);
    expect(stackResolveSpellMultiplayerPromptUtilsSource.includes('export function applyInstantSorceryJoinForcesAndTemptingOfferHandlers')).toBe(true);
    expect(stackResolveSpellLibraryTopPromptUtilsSource.includes('export function applyInstantSorceryLibraryTopCardPromptHandlers')).toBe(true);
    expect(stackResolveInstantSorceryLegacyBodyUtilsSource.includes('applyInstantSorceryJoinForcesAndTemptingOfferHandlers(ctx')).toBe(true);
    expect(stackResolveInstantSorceryLegacyBodyUtilsSource.includes('applyInstantSorceryLibraryTopCardPromptHandlers(ctx')).toBe(true);
    expect(stackResolveInstantSorceryLegacyResolutionUtilsSource.includes('tryApplyInstantSorceryLegacyBodyHandlers(')).toBe(true);
    expect(stackSource.includes('applyInstantSorceryJoinForcesAndTemptingOfferHandlers(ctx')).toBe(false);
    expect(stackSource.includes('applyInstantSorceryLibraryTopCardPromptHandlers(ctx')).toBe(false);
    expect(stackSource.includes('isJoinForcesSpell(')).toBe(false);
    expect(stackSource.includes('isTemptingOfferSpell(')).toBe(false);
    expect(stackSource.includes('isPonderStyleSpell(')).toBe(false);
    expect(stackSource.includes('genesis wave')).toBe(false);
    expect(stackSource.includes('function getRecordedManaSpentTotal')).toBe(false);
    expect(stackSource.includes('layout === \'adventure\' && wasAdventure')).toBe(false);
    expect(stackSource.includes('reboundPending: true')).toBe(false);
    expect(stackSource.includes('export { moveResolvedInstantOrSorceryAfterResolution')).toBe(true);
    expect(stackSource.includes('import { finalizeResolvedInstantOrSorceryResolution')).toBe(false);
    expect(stackResolveInstantSorceryLegacyResolutionUtilsSource.includes("from './stackResolveSpellZoneUtils.js'") || stackResolveInstantSorceryLegacyResolutionUtilsSource.includes('from "./stackResolveSpellZoneUtils.js"')).toBe(true);
    expect(stackSource.includes("from './stackResolveInstantSorceryPrefaceUtils.js'") || stackSource.includes('from "./stackResolveInstantSorceryPrefaceUtils.js"')).toBe(true);
    expect(stackSource.includes("from './stackResolveInstantSorceryLegacyResolutionUtils.js'") || stackSource.includes('from "./stackResolveInstantSorceryLegacyResolutionUtils.js"')).toBe(true);
    expect(stackSource.includes("from './stackResolveInstantSorceryOrchestratorUtils.js'") || stackSource.includes('from "./stackResolveInstantSorceryOrchestratorUtils.js"')).toBe(true);
    expect(stackResolvePermanentEtbChoiceUtilsSource.includes('export function queuePermanentAsEntersBattlefieldChoiceSteps')).toBe(true);
    expect(stackResolvePermanentSpellPostEntryUtilsSource.includes('queuePermanentAsEntersBattlefieldChoiceSteps(ctx')).toBe(true);
    expect(stackSource.includes('colorChoicePattern')).toBe(false);
    expect(stackSource.includes('creatureTypePattern')).toBe(false);
    expect(stackSource.includes('ResolutionStepType.DEVOUR_SELECTION')).toBe(false);
    expect(stackSource.includes('pendingControlChange')).toBe(false);
    expect(stackResolvePermanentEtbChoiceUtilsSource.includes('ResolutionStepType.DEVOUR_SELECTION')).toBe(true);
    expect(stackResolvePermanentEtbChoiceUtilsSource.includes('detectControlChangeEffects(')).toBe(true);
    expect(stackResolvePermanentEtbTriggerUtilsSource.includes('export function queuePermanentEntersBattlefieldTriggerStackItems')).toBe(true);
    expect(stackResolvePermanentSpellPostEntryUtilsSource.includes('queuePermanentEntersBattlefieldTriggerStackItems(ctx')).toBe(true);
    expect(stackSource.includes('selfETBTriggerTypes')).toBe(false);
    expect(stackSource.includes('getETBTriggersForPermanent(')).toBe(false);
    expect(stackSource.includes('function matchesColorRestriction')).toBe(false);
    expect(stackResolvePermanentEtbTriggerUtilsSource.includes('getETBTriggersForPermanent(')).toBe(true);
    expect(stackResolvePermanentEtbTriggerUtilsSource.includes('orderTriggersByAPNAP(')).toBe(true);
    expect(stackResolvePermanentEtbTriggerUtilsSource.includes('job_select')).toBe(true);
    expect(stackResolvePermanentEntryUtilsSource.includes('export function resolvePermanentSpellBattlefieldEntry')).toBe(true);
    expect(stackResolvePermanentSpellOrchestratorUtilsSource.includes('resolvePermanentSpellBattlefieldEntry(ctx')).toBe(true);
    expect(stackSource.includes('resolvePermanentSpellBattlefieldEntry(ctx')).toBe(false);
    expect(stackSource.includes('isMutatingSpell')).toBe(false);
    expect(stackSource.includes('createMutatedPermanent(')).toBe(false);
    expect(stackSource.includes('function queueMutateTriggeredAbilities')).toBe(false);
    expect(stackResolvePermanentEntryUtilsSource.includes('queueMutateTriggeredAbilities(')).toBe(true);
    expect(stackResolvePermanentSquadUtilsSource.includes('export function applyPermanentSquadTokenCopiesOnEntry')).toBe(true);
    expect(stackResolvePermanentSpellPostEntryUtilsSource.includes('applyPermanentSquadTokenCopiesOnEntry(ctx')).toBe(true);
    expect(stackSource.includes('applyPermanentSquadTokenCopiesOnEntry(ctx')).toBe(false);
    expect(stackResolvePermanentSpellTypeUtilsSource.includes('export function isPermanentTypeLine')).toBe(true);
    expect(stackResolvePermanentSpellOrchestratorUtilsSource.includes('function isPermanentTypeLine')).toBe(false);
    expect(stackResolvePermanentSpellPostEntryUtilsSource.includes('export function applyPermanentSpellPostEntrySteps')).toBe(true);
    expect(stackResolvePermanentSpellOrchestratorUtilsSource.includes('applyPermanentSpellPostEntrySteps(ctx')).toBe(true);
    expect(stackSource.includes("from './stackResolvePermanentSpellPostEntryUtils.js'") || stackSource.includes('from "./stackResolvePermanentSpellPostEntryUtils.js"')).toBe(true);
    expect(stackSource.includes('squadTimesPaid')).toBe(false);
    expect(stackResolveTriggeredAbilityInterveningIfUtilsSource.includes('export function trySkipTriggeredAbilityForUnmetInterveningIf')).toBe(true);
    expect(stackResolveTriggeredAbilityDeferralUtilsSource.includes('trySkipTriggeredAbilityForUnmetInterveningIf(ctx')).toBe(true);
    expect(stackResolveTriggeredAbilityOrchestratorUtilsSource.includes('trySkipTriggeredAbilityForUnmetInterveningIf(ctx')).toBe(false);
    expect(stackResolveTriggeredAbilityDeferralUtilsSource.includes('export function tryDeferTriggeredAbilityBeforeExecution')).toBe(true);
    expect(stackResolveTriggeredAbilityOrchestratorUtilsSource.includes('tryDeferTriggeredAbilityBeforeExecution(ctx')).toBe(true);
    expect(stackSource.includes("from './stackResolveTriggeredAbilityDeferralUtils.js'") || stackSource.includes('from "./stackResolveTriggeredAbilityDeferralUtils.js"')).toBe(true);
    expect(stackSource.includes('isInterveningIfSatisfied(')).toBe(false);
    expect(stackResolveTriggeredAbilityOptionalUtilsSource.includes('export function queueOptionalTriggeredAbilityEffectProgram')).toBe(true);
    expect(stackResolveTriggeredAbilityOptionalUtilsSource.includes('export function tryDeferOptionalTriggeredAbilityMayDecision')).toBe(true);
    expect(stackResolveTriggeredAbilityDeferralUtilsSource.includes('tryDeferOptionalTriggeredAbilityMayDecision(ctx')).toBe(true);
    expect(stackResolveTriggeredAbilityOrchestratorUtilsSource.includes('tryDeferOptionalTriggeredAbilityMayDecision(ctx')).toBe(false);
    expect(stackSource.includes('function queueOptionalTriggeredAbilityEffectProgram')).toBe(false);
    expect(stackResolveTriggeredAbilitySpecialPromptUtilsSource.includes('export function tryDeferTriggeredAbilitySpecialPrompts')).toBe(true);
    expect(stackResolveTriggeredAbilityDeferralUtilsSource.includes('tryDeferTriggeredAbilitySpecialPrompts(ctx')).toBe(true);
    expect(stackResolveTriggeredAbilityOrchestratorUtilsSource.includes('tryDeferTriggeredAbilitySpecialPrompts(ctx')).toBe(false);
    expect(stackSource.includes("triggerType === 'etb_bounce_land'")).toBe(false);
    expect(stackSource.includes("triggerType === 'hideaway_etb'")).toBe(false);
    expect(stackResolveTriggeredAbilitySpecialPromptUtilsSource.includes('soldier military program')).toBe(true);
    expect(stackResolveTriggeredAbilityTargetPromptUtilsSource.includes('export function tryDeferTriggeredAbilityTargetSelection')).toBe(true);
    expect(stackResolveTriggeredAbilityDeferralUtilsSource.includes('tryDeferTriggeredAbilityTargetSelection(ctx')).toBe(true);
    expect(stackResolveTriggeredAbilityOrchestratorUtilsSource.includes('tryDeferTriggeredAbilityTargetSelection(ctx')).toBe(false);
    expect(stackSource.includes('function matchesTriggeredBattlefieldTarget')).toBe(false);
    expect(stackSource.includes('function matchesTriggeredGraveyardTarget')).toBe(false);
    expect(stackResolveTriggeredAbilityTargetPromptUtilsSource.includes('PERMANENT_TRIGGER_TARGET_TYPES')).toBe(true);
    expect(stackResolveTriggeredAbilityTargetPromptUtilsSource.includes('matchesTriggeredGraveyardTarget(')).toBe(true);
    expect(stackResolveTriggeredAbilityChosenTypeUtilsSource.includes('export function tryResolveTriggeredAbilityChosenTypeEffects')).toBe(true);
    expect(stackResolveTriggeredAbilityOrchestratorUtilsSource.includes('export function resolveTriggeredAbilityStackItem')).toBe(true);
    expect(stackResolveTopOfStackDispatchUtilsSource.includes('resolveTriggeredAbilityStackItem(ctx')).toBe(true);
    expect(stackResolveTopOfStackUtilsSource.includes('resolveTriggeredAbilityStackItem(ctx')).toBe(false);
    expect(stackSource.includes('trySkipTriggeredAbilityForUnmetInterveningIf(ctx')).toBe(false);
    expect(stackSource.includes('parseChosenTypeCounterEachCreatureEffect(')).toBe(false);
    expect(stackSource.includes('export function executeTriggerEffect')).toBe(false);
    expect(stackExecuteTriggerEffectUtilsSource.includes('export function executeTriggerEffect')).toBe(true);
    expect(stackExecuteTriggerEffectUtilsSource.includes('tryApplyTriggerEffectLegacyBodyHandlers(')).toBe(true);
    expect(stackExecuteTriggerEffectUtilsSource.includes('tryApplyTriggerEffectLegacyTailHandlers(')).toBe(true);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('export function tryApplyTriggerEffectLegacyBodyHandlers')).toBe(true);
    expect(stackExecuteTriggerEffectTailUtilsSource.includes('export function tryApplyTriggerEffectLegacyTailHandlers')).toBe(true);
    expect(stackExecuteTriggerEffectTailUtilsSource.includes('shouldSkipLegacyTriggerRegexHandlers')).toBe(true);
    expect(stackExecuteTriggerEffectTailUtilsSource.includes('skipLegacyRegexTail')).toBe(true);
    expect(stackExecuteTriggerEffectTailUtilsSource.includes('shouldSkipTriggerUncategorizedFallback')).toBe(true);
    expect(stackExecuteTriggerEffectTailUtilsSource.includes('skipUncategorizedSpellFallback')).toBe(true);
    expect(stackExecuteTriggerEffectIrFallbackUtilsSource.includes('applyTriggerIrSpecialHandlersOnly')).toBe(true);
    expect(stackExecuteTriggerEffectIrFallbackUtilsSource.includes('skipUncategorizedSpellFallback')).toBe(true);
    expect(oracleIrTriggerUncategorizedFallbackSource.includes('export function applyTriggerIrSpecialHandlersOnly')).toBe(true);
    expect(stackExecuteTriggerEffectUtilsSource.includes('applyRetiredTriggerLegacyCombinedEffectsRegexBatch(')).toBe(false);
    expect(stackExecuteTriggerEffectUtilsSource.includes('tryResolveTriggerViaOracleIR(ctx')).toBe(true);
    expect(stackExecuteTriggerEffectUtilsSource.includes('applyStackReboundTrigger(')).toBe(true);
    expect(stackExecuteTriggerEffectUtilsSource.includes('applyStackParadigmTrigger(')).toBe(true);
    expect(stackExecuteTriggerEffectUtilsSource.indexOf('applyStackReboundTrigger({')).toBeLessThan(
      stackExecuteTriggerEffectUtilsSource.indexOf('const triggerIrOutcome = tryResolveTriggerViaOracleIR'),
    );
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('shouldSkipLegacyTriggerBodyHandlers')).toBe(true);
    expect(stackExecuteTriggerEffectUtilsSource.includes('function applyOracleIRFallbackForTriggeredEffect')).toBe(false);
    expect(stackExecuteTriggerEffectUtilsSource.includes("from './stackExecuteTriggerEffectIrFallbackUtils.js'") || stackExecuteTriggerEffectUtilsSource.includes('from "./stackExecuteTriggerEffectIrFallbackUtils.js"')).toBe(false);
    expect(stackExecuteTriggerEffectTailUtilsSource.includes("from './stackExecuteTriggerEffectIrFallbackUtils.js'") || stackExecuteTriggerEffectTailUtilsSource.includes('from "./stackExecuteTriggerEffectIrFallbackUtils.js"')).toBe(true);
    expect(stackExecuteTriggerEffectIrFallbackUtilsSource.includes('export function applyOracleIRFallbackForTriggeredEffect')).toBe(true);
    expect(stackExecuteTriggerEffectIrFallbackUtilsSource.includes('applyOracleIRTriggerUncategorizedFallback(')).toBe(true);
    expect(stackSource.includes("from './stackExecuteTriggerEffectIrFallbackUtils.js'") || stackSource.includes('from "./stackExecuteTriggerEffectIrFallbackUtils.js"')).toBe(true);
    expect(applyEventSource.includes('from "./stack"')).toBe(false);
    expect(applyEventSource.includes('from "./stack.js"')).toBe(false);
    expect(applyEventSource.includes("from './stackCastSpellUtils.js'") || applyEventSource.includes('from "./stackCastSpellUtils.js"')).toBe(true);
    expect(applyEventSource.includes("from './stackResolveTopOfStackUtils.js'") || applyEventSource.includes('from "./stackResolveTopOfStackUtils.js"')).toBe(true);
    expect(gameActionsSource.includes('from "../state/modules/stack.js"')).toBe(false);
    expect(combatSource.includes('from "../state/modules/stack.js"')).toBe(false);
    expect(exertTriggersSource.includes("from '../state/modules/stack.js'")).toBe(false);
    expect(gameActionsSource.includes('inferTriggeredAbilityTargetMetadata')).toBe(true);
    expect(stackExecuteTriggerEffectPrefaceUtilsSource.includes('export function tryApplyTriggerEffectPrefaceHandlers')).toBe(true);
    expect(stackExecuteTriggerEffectUtilsSource.includes('tryApplyTriggerEffectPrefaceHandlers(')).toBe(true);
    expect(stackExecuteTriggerEffectUtilsSource.includes('prefaceResult.handled')).toBe(true);
    expect(stackSource.includes("from './stackExecuteTriggerEffectPrefaceUtils.js'") || stackSource.includes('from "./stackExecuteTriggerEffectPrefaceUtils.js"')).toBe(true);
    expect(stackSource.includes("from './stackExecuteTriggerEffectLegacyBodyUtils.js'") || stackSource.includes('from "./stackExecuteTriggerEffectLegacyBodyUtils.js"')).toBe(true);
    expect(stackSource.includes("from './stackExecuteTriggerEffectTailUtils.js'") || stackSource.includes('from "./stackExecuteTriggerEffectTailUtils.js"')).toBe(true);
    expect(stackResolveTopOfStackDispatchUtilsSource.includes('resolvePermanentSpellStackItem(ctx')).toBe(true);
    expect(stackResolveTopOfStackDispatchUtilsSource.includes("permanentOutcome === 'mutate'")).toBe(true);
    expect(stackResolveTopOfStackDispatchUtilsSource.includes('finalizeResolveTopOfStackAfterEffects(ctx)')).toBe(true);
    expect(stackResolveTopOfStackUtilsSource.includes('finalizeResolveTopOfStackAfterEffects(ctx)')).toBe(true);
    expect(stackResolveTopOfStackUtilsSource.includes('export function resolveTopOfStack')).toBe(true);
    expect(stackResolveTopOfStackPrefaceUtilsSource.includes('export function tryPrepareResolveTopOfStackContext')).toBe(true);
    expect(stackSource.includes('export function resolveTopOfStack')).toBe(false);
    expect(stackSource.includes("from './stackResolveTopOfStackUtils.js'")).toBe(true);
    expect(stackSource.includes("from './stackResolveTopOfStackPrefaceUtils.js'") || stackSource.includes('from "./stackResolveTopOfStackPrefaceUtils.js"')).toBe(true);
    expect(stackResolveSharedTypesSource.includes('export type ExecuteTriggerEffectFn')).toBe(true);
    expect(stackResolveSharedTypesSource.includes('export type ResolveTopOfStackContinuation')).toBe(true);
    expect(stackResolveSharedTypesSource.includes('export type ResolveTopOfStackPrefaceResult')).toBe(true);
    expect(stackResolveTopOfStackPrefaceUtilsSource.includes('export type ResolveTopOfStackContinuation =')).toBe(false);
    expect(stackResolveTopOfStackPrefaceUtilsSource.includes("from './stackResolveSharedTypes.js'") || stackResolveTopOfStackPrefaceUtilsSource.includes('from "./stackResolveSharedTypes.js"')).toBe(true);
    expect(stackResolveTopOfStackDispatchUtilsSource.includes("from './stackResolveSharedTypes.js'") || stackResolveTopOfStackDispatchUtilsSource.includes('from "./stackResolveSharedTypes.js"')).toBe(true);
    expect(stackResolveTopOfStackDispatchUtilsSource.includes("from './stackResolveTopOfStackPrefaceUtils.js'")).toBe(false);
    expect(stackResolveSharedTypesSource.includes('export type InstantSorceryPrefaceContinuation')).toBe(true);
    expect(stackResolveSharedTypesSource.includes('export type InstantSorceryPrefaceResult')).toBe(true);
    expect(stackResolveInstantSorceryPrefaceUtilsSource.includes('export type InstantSorceryPrefaceContinuation =')).toBe(false);
    expect(stackResolveInstantSorceryPrefaceUtilsSource.includes("from './stackResolveSharedTypes.js'") || stackResolveInstantSorceryPrefaceUtilsSource.includes('from "./stackResolveSharedTypes.js"')).toBe(true);
    expect(stackResolveInstantSorceryLegacyResolutionUtilsSource.includes("from './stackResolveSharedTypes.js'") || stackResolveInstantSorceryLegacyResolutionUtilsSource.includes('from "./stackResolveSharedTypes.js"')).toBe(true);
    expect(stackResolveInstantSorceryLegacyResolutionUtilsSource.includes("from './stackResolveInstantSorceryPrefaceUtils.js'")).toBe(false);
    expect(stackResolveSharedTypesSource.includes('export type TriggerEffectLegacyBodyContinuation')).toBe(true);
    expect(stackResolveSharedTypesSource.includes('export type TriggerEffectLegacyBodyResult')).toBe(true);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('export type TriggerEffectLegacyBodyContinuation =')).toBe(false);
    expect(stackExecuteTriggerEffectLegacyBodyUtilsSource.includes("from './stackResolveSharedTypes.js'") || stackExecuteTriggerEffectLegacyBodyUtilsSource.includes('from "./stackResolveSharedTypes.js"')).toBe(true);
    expect(stackExecuteTriggerEffectTailUtilsSource.includes("from './stackResolveSharedTypes.js'") || stackExecuteTriggerEffectTailUtilsSource.includes('from "./stackResolveSharedTypes.js"')).toBe(true);
    expect(stackExecuteTriggerEffectTailUtilsSource.includes("from './stackExecuteTriggerEffectLegacyBodyUtils.js'")).toBe(false);
    expect(stackResolveSharedTypesSource.includes('export type InstantSorceryStackResolveOptions')).toBe(true);
    expect(stackResolveSharedTypesSource.includes('export type InstantSorceryPrefaceOptions')).toBe(true);
    expect(stackResolveSharedTypesSource.includes('export type PermanentSpellStackResolveOptions')).toBe(true);
    expect(stackResolveSharedTypesSource.includes('export type TriggeredAbilityStackResolveOptions')).toBe(true);
    expect(stackResolveInstantSorceryOrchestratorUtilsSource.includes('options: InstantSorceryStackResolveOptions')).toBe(true);
    expect(stackResolveInstantSorceryPrefaceUtilsSource.includes('options: InstantSorceryPrefaceOptions')).toBe(true);
    expect(stackResolveInstantSorceryLegacyResolutionUtilsSource.includes('options: InstantSorceryStackResolveOptions')).toBe(true);
    expect(stackResolvePermanentSpellOrchestratorUtilsSource.includes('options: PermanentSpellStackResolveOptions')).toBe(true);
    expect(stackResolveTriggeredAbilityOrchestratorUtilsSource.includes('options: TriggeredAbilityStackResolveOptions')).toBe(true);
    expect(stackResolveTriggeredAbilityOrchestratorUtilsSource.includes('export type { ExecuteTriggerEffectFn }')).toBe(false);
    expect(stackResolveSpellGraveyardAutomationUtilsSource.includes('ExecuteTriggerEffectForSpellFn')).toBe(false);
    expect(stackResolveSharedTypesSource.includes('export type StackActivatedAbilityLateHandlerDeps')).toBe(true);
    expect(stackResolveInstantSorceryOrchestratorUtilsSource.includes('export type ExecuteTriggerEffectFn =')).toBe(false);
    expect(stackResolveInstantSorceryOrchestratorUtilsSource.includes("from './stackResolveSharedTypes.js'") || stackResolveInstantSorceryOrchestratorUtilsSource.includes('from "./stackResolveSharedTypes.js"')).toBe(true);
    expect(stackResolveTriggeredAbilityOrchestratorUtilsSource.includes("from './stackResolveInstantSorceryOrchestratorUtils.js'")).toBe(false);
    expect(stackResolveTriggeredAbilityDeferralUtilsSource.includes("from './stackResolveSharedTypes.js'") || stackResolveTriggeredAbilityDeferralUtilsSource.includes('from "./stackResolveSharedTypes.js"')).toBe(true);
    expect(stackResolveSharedTypesSource.includes('export type TriggeredAbilityDeferralOptions')).toBe(true);
    expect(stackResolveTriggeredAbilityDeferralUtilsSource.includes('options: TriggeredAbilityDeferralOptions')).toBe(true);
    expect(oracleIrTriggerLegacyRoutingSource.includes('...ORACLE_IR_FALLBACK_STEP_KINDS')).toBe(true);
    expect(oracleIrTriggerLegacyRoutingSource.includes('...TRIGGER_OPTIONAL_RUNTIME_STEP_KINDS')).toBe(true);
    expect(oracleIrTriggerLegacyRoutingSource.includes("from './trigger-runtime-wiring.js'") || oracleIrTriggerLegacyRoutingSource.includes('from "./trigger-runtime-wiring.js"')).toBe(true);
    expect(stackSource.includes("from './stackResolveSharedTypes.js'") || stackSource.includes('from "./stackResolveSharedTypes.js"')).toBe(true);
    expect(stackResolvePermanentSpellOrchestratorUtilsSource.includes('export function resolvePermanentSpellStackItem')).toBe(true);
    expect(stackResolveSharedTypesSource.includes('export type PermanentBattlefieldEntryOutcome')).toBe(true);
    expect(stackResolveSharedTypesSource.includes('export type PermanentBattlefieldEntryOptions')).toBe(true);
    expect(stackResolveSharedTypesSource.includes('export type PermanentSpellPostEntryOptions')).toBe(true);
    expect(stackResolvePermanentEntryUtilsSource.includes('export type PermanentBattlefieldEntryOutcome =')).toBe(false);
    expect(stackResolvePermanentEntryUtilsSource.includes("from './stackResolveSharedTypes.js'") || stackResolvePermanentEntryUtilsSource.includes('from "./stackResolveSharedTypes.js"')).toBe(true);
    expect(stackResolvePermanentSpellPostEntryUtilsSource.includes('options: PermanentSpellPostEntryOptions')).toBe(true);
    expect(stackResolvePermanentSpellOrchestratorUtilsSource.includes('...entryOptions')).toBe(true);
    expect(stackResolveTopOfStackPostResolutionUtilsSource.includes('export function finalizeResolveTopOfStackAfterEffects')).toBe(true);
    expect(stackResolveTopOfStackPostResolutionUtilsSource.includes('runSBA(ctx)')).toBe(true);
    expect(stackSource.includes('function isPermanentTypeLine')).toBe(false);
    expect(stackSource.includes('runSBA(ctx)')).toBe(false);
    expect(stackSource.includes("from './stackResolveAbilityHandlersUtils.js'") || stackSource.includes('from "./stackResolveAbilityHandlersUtils.js"')).toBe(true);
  });
});
