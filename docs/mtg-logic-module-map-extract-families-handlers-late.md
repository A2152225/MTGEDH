# MTG logic module map — extract-family handler folders (late)

Peeled from `docs/mtg-logic-module-map-extract-families-handlers.md` starting at AutomationService.
Coordinator owns this file. Extract chats must not edit it — paste owed rows.

### `AutomationService-handlers/` (extracted from `AutomationService.ts`)

Public path stays `rules-engine/src/AutomationService.ts`. Leaves must not import the parent or the index. Never create `AutomationService/` beside `AutomationService.ts`. Dual-copy: leaf combat-damage API ≠ `combatDamageEnhanced.ts`.

| Module | Owns |
| --- | --- |
| `automationServiceDecisionTypes.ts` | `DecisionType`, `PendingDecision`, `DecisionOption`, `SelectionFilter`, `DecisionResult`, `AutomationContext`, `AutomationResult`. |
| `automationServiceCombatDamage.ts` | `calculateCombatDamage`, `applyCombatDamage`, `CombatDamageAssignment`, exclusive combat helpers. |
| `automationServiceTargetDecisionTypes.ts` | `TargetingSourceInfo`, `TargetDecisionZone`, `TargetDecisionConstraints`. |
| `automationServiceTargetDecisionBuilders.ts` | `requiresDecisionToResolve` plus target/mode/X builders (`parseTargetTypes`, `buildTargetDecisionOptions`, …). |

### `RulesEngineAdapter-handlers/` (extracted from `RulesEngineAdapter.ts`)

Public path stays `rules-engine/src/RulesEngineAdapter.ts`. Leaves must not import the parent or the index. Never create `RulesEngineAdapter/` beside `RulesEngineAdapter.ts`. Class methods in the parent are thin `.call(this)` wrappers. Sibling `rulesEngineAdapterStateSupport.ts`: `checkWinConditionsForState` applies Darksteel-style `immediate` oracle-scanner wins (and Felidar-style upkeep when `state.step` is upkeep). Last-player-standing unchanged. Hedron Alignment may-reveal still owed.

| Module | Owns |
| --- | --- |
| `adapterActivatedAbilityAdditionalCosts.ts` | Additional-cost resolve/pay (discard/tap/sac/counter/exile/reveal) + graveyard extras. |
| `adapterActionValidators.ts` | `validatePlayLand`, `validateSpellCast`, `validateAbilityActivation`. |
| `adapterCastSpellAction.ts` | `castSpellAction`. |
| `adapterResolveStackTop.ts` | `resolveStackTop`. |
| `adapterStateBasedActions.ts` | `checkStateBasedActions`. |
| `adapterActivateAbilityAction.ts` | `activateAbilityAction`. |
| `adapterPlayLandAction.ts` | `playLandAction`. |
| `adapterTargetingHelpers.ts` | Targeting colors / source info / selected-target legality. |
| `adapterCastSpellMetadata.ts` | Cast metadata (payment, counters, flash, immunity). |
| `adapterAdditionalCostParsers.ts` | Additional-cost eligibility + `parse*FromDescription`. |
| `adapterKeywordCostAndResolvedSpell.ts` | Buyback/replicate/disturb/rebound + resolved-spell zone moves. |
| `adapterExecuteAction.ts` | `executeAction`. |
| `adapterTapForManaAction.ts` | `tapForManaAction`. |
| `adapterHelmOfTheHostTrigger.ts` | `resolveHelmOfTheHostTrigger`. |
| `adapterBecameMonstrousTriggers.ts` | `processBecameMonstrousTriggers`. |
| `adapterLibrarySourceHelpers.ts` | `getCardTypes`, top-library land/spell, `findSourceZoneCard`. |
| `adapterManaCostParse.ts` | `parseManaCostString`, `canPayManaCostFromPool`. |
| `adapterTimingContext.ts` | `buildTimingContext`. |

### `CardAnalyzer-handlers/` (extracted from `CardAnalyzer.ts`)

Public path stays `rules-engine/src/CardAnalyzer.ts`. Leaves must not import the parent or the index. Never create `CardAnalyzer/` beside `CardAnalyzer.ts`. Class methods in the parent are thin `.call(this)` wrappers.

| Module | Owns |
| --- | --- |
| `cardAnalyzerPatterns.ts` | `PATTERNS` card-effect regex table. |
| `cardAnalyzerBeneficialDeathCards.ts` | `BENEFICIAL_DEATH_CARDS` death-payoff table. |
| `cardAnalyzerKnownCombos.ts` | `KNOWN_COMBOS` named combo-piece partners. |
| `cardAnalyzerTypes.ts` | `CardCategory`, `ThreatLevel`, `SynergyArchetype`, `CardAnalysis`, `CardEffectDetails`, `BattlefieldAnalysis`, `DeckArchetypeProfile`. |
| `cardAnalyzerAnalyzeDeck.ts` | `analyzeDeck`, `CardAnalyzerHost`. |

### `AIEngine-handlers/` (extracted from `AIEngine.ts`)

Public path stays `rules-engine/src/AIEngine.ts`. Leaves must not import the parent or the index. Never create `AIEngine/` beside `AIEngine.ts`. Class methods in the parent are thin `.call(this)` wrappers. Existing flat `aiEngine*.ts` siblings stay put — do not append. Dual-copy: `assessBattlefieldThreats` already lives in `aiEngineThreatSupport.ts`.

| Module | Owns |
| --- | --- |
| `aiEngineAnalyzeLibraryForPlanning.ts` | `analyzeLibraryForPlanning`, `AIEngineHost`. |
| `aiEngineActivatedAbilitySupport.ts` | Activated-ability detection, timing, heuristic value, `findBestActivatedAbility`. Includes opponent permanents with “any player may activate” (Xantcha `{3}` draw + controller loses 2). Skips hand-only “discard this card” abilities (`isHandOnlyDiscardThisCardActivatedAbility`). |

### `oracleTextParser-handlers/` (extracted from `oracleTextParser.ts`)

Public path stays `rules-engine/src/oracleTextParser.ts`. Leaves must not import the parent or the index. Never create `oracleTextParser/` beside `oracleTextParser.ts`. Runtime seam: `oracleTextParserHandlerDeps.ts`. Existing flat siblings `oracleTextParserPreprocess.ts`, `oracleTextParserSupport.ts`, `oracleTextParserKeywordCosts.ts`, `oracleTextParserKeywordActionAbilities.ts`, `oracleTextParserKeywordTriggers.ts` stay put.

| Module | Owns |
| --- | --- |
| `oracleTextParserTypes.ts` | `ParsedAbility`, `ChoiceRequirement`, `AbilityType`, `ParsedKeywordAction`, `OracleTextParseResult`. |
| `oracleTextParserTriggeredLineSplit.ts` | `stripLeadingTriggeredAbilityLabel`, `looksLikeCompleteTriggerCondition`, `splitMixedStandaloneAndTriggeredLine`, `splitRepeatedTriggeredLead`. |
| `oracleTextParserHandlerDeps.ts` | Runtime seam for parse helpers still in the parent. Entries: `setOracleTextParserHandlerDeps`, `getOracleTextParserHandlerDeps`. |
| `oracleTextParserParseActivatedAbility.ts` | `parseActivatedAbility`, `KEYWORD_COST_PATTERN`, `isGrantedQuotedActivatedAbilityLine`. |
| `oracleTextParserParseOracleText.ts` | `parseOracleText`, `parseKeywords`. |

### `triggeredAbilitiesEventDetection-handlers/` (extracted from `rules-engine/src/triggeredAbilitiesEventDetection.ts`)

Public path stays `rules-engine/src/triggeredAbilitiesEventDetection.ts` (**39.7 KB**). Internal TOC: `rules-engine/src/triggeredAbilitiesEventDetection-handlers/index.ts`. `detectTriggeredAbilityEvent` stays the exported dispatcher (leftover 39.5 KB if-chain + early `tryParse` call). Leaves must not import `triggeredAbilitiesEventDetection.ts` or the index. Never create `triggeredAbilitiesEventDetection/` beside the `.ts`. Dual-copy: server `detectETBTriggers` / `detectDeathTriggers` / `detectAttackTriggers` are different functions — do not merge.

| Module | Owns |
| --- | --- |
| `triggeredAbilitiesEventDetectionEarlyFamilies.ts` | Early `detectTriggeredAbilityEvent` if-chain (spell countered / beginning-of-main / first-spell / spell-cast). Entry: `tryParseTriggeredAbilityEventEarlyFamilies`. `undefined` = fall through. Do not import the parent. |

### `effectProgram-handlers/` (extracted from `effectProgram.ts`)

Public path stays `rules-engine/src/effectProgram.ts`. Leaves must not import the parent or the index. Never create `effectProgram/` beside `effectProgram.ts`.

| Module | Owns |
| --- | --- |
| `effectProgramTypes.ts` | Public Effect Program types/interfaces plus `ORACLE_CHOICE_STEP_KINDS` / `BASIC_LAND_TYPE_OPTIONS`. |
| `effectProgramAppendOracleStep.ts` | `buildEffectProgramFromOracleIR`, `appendOracleStepToEffectProgram`, and exclusive oracle-step choice helpers (choose-mode targets, choice-request builders, supported-choice guards, clash append, color/mode mappers). **33.9 KB** — do not append. |

### `effectProgramOracleRunner-handlers/` (extracted from `effectProgramOracleRunner.ts`)

Public path stays `rules-engine/src/effectProgramOracleRunner.ts`. Leaves must not import the parent or the index. Never create `effectProgramOracleRunner/` beside `effectProgramOracleRunner.ts`.

| Module | Owns |
| --- | --- |
| `effectProgramOracleRunnerChoiceNormalize.ts` | `normalizeChoiceResponseSelections`, `normalizeChoiceResponseSelection`. |
| `effectProgramOracleRunnerChoiceOptions.ts` | `hasNonEmptyChoiceOptions`, `inferOracleIRTargetTypes`, `buildOracleIRTargetSelectionOptions`, `buildOracleIRPlayerChoiceOptions`, `shouldOracleIRPlayerChoiceAllowSelf`. |
| `effectProgramOracleRunnerChoiceLookups.ts` | Populate/explore battlefield lookups: `resolvePopulatePlayerId`, `buildPopulateTargetChoiceOption`, `resolveExploreTargetId`, `findBattlefieldPermanent`, `readPermanentName`, `isLandCard`, `getCardTypeLine`. |
| `effectProgramOracleRunnerLibraryLookups.ts` | Top-library / fateseal lookups: `findFatesealTargetPlayerId`, `readFirstSelectionForBinding`, `normalizeSelectionIdList`, `getPlayerLibrary`, `resolveTopLibraryChoicePlayerId`, `normalizeTopLibraryPromptCard`, `quantityToStaticNumber`. |
| `effectProgramOracleRunnerClashLookups.ts` | `resolveClashPlayerId`, `findClashOpponentPlayerId`, `findClashTargetBindingKey`. |
| `effectProgramOracleRunnerBindingKeys.ts` | `DerivedOracleIRContextBindings`, `LAST_*` binding key constants. |
| `effectProgramOracleRunnerChoiceClassify.ts` | `classifyChoiceTarget`, `normalizeChosenManaSelection`. |
| `effectProgramOracleRunnerContextBindings.ts` | `createOracleIRContextWithEffectProgramBindings`, `createOracleIROptionsWithEffectProgramBindings`, `findSelectedModeIdsForCommand`, `readSelectedModeIdsForBinding`, `deriveOracleIRContextFromEffectProgramBindings`. |

### `actions/combat-handlers/` (extracted from `rules-engine/src/actions/combat.ts`)

Public path stays `rules-engine/src/actions/combat.ts`. Internal TOC: `rules-engine/src/actions/combat-handlers/index.ts`. Distinct from `server/src/socket/combat-handlers/`. Leaves must not import `actions/combat.ts` or the index. Never create `actions/combat/` beside `combat.ts`. Dual-copy: socket `combatLegalityGates.ts` `isCurrentlyCreature` / `canPermanentAttack`, AI `executeDeclareBlockers`, and `turn.ts` `dealCombatDamage` are different functions — do not merge.

| Module | Owns |
| --- | --- |
| `combatActionTypes.ts` | `AttackerDeclaration`, `BlockerDeclaration`, `DeclareAttackersAction`, `DeclareBlockersAction`, `CombatDamageAssignment`, `DealCombatDamageAction`. |
| `combatGoadPermanentLookup.ts` | `getPermanentForGoadAnalysis`. |
| `combatLegalityHelpers.ts` | `isCurrentlyCreature`, `hasDefender`, `canPermanentAttack`, `hasHaste`, `canPermanentBlock`, `checkEvasionAbilities`, `hasAbility`, `CombatValidationResult`. `hasHaste` ignores Other-[type] lord grants and self-stamped haste badges. |
| `combatPermanentPower.ts` | `getPermanentPower`. |
| `combatGoadHelpers.ts` | `buildProcessedBattlefieldForGoad`, `isGoaded`, `getGoadedBy`, `getGoadedAttackTargets`, `canGoadedCreatureAttack`. `buildProcessedBattlefieldForGoad` reuses `applyStaticAbilitiesToBattlefield`, which skips already-processed snapshots and batches identical token P/T (Myrel soldier swarms). |
| `combatGoadedAttackers.ts` | `getGoadedAttackers`. |
| `combatValidateDeclareAttackers.ts` | `validateDeclareAttackers`. Rejects defending players who have left the game (`playerIsLegalAttackTarget`); goad / must-attack opponent lists use the same living-player set. |

### `actions/triggersHandler-handlers/` (extracted from `rules-engine/src/actions/triggersHandler.ts`)

Public path stays `rules-engine/src/actions/triggersHandler.ts`. Internal TOC: `rules-engine/src/actions/triggersHandler-handlers/index.ts`. Leaves must not import `actions/triggersHandler.ts` or the index. Never create `actions/triggersHandler/` beside `triggersHandler.ts`. Dual-copy: server `detectETBTriggers` / `detectDeathTriggers` / `detectAttackTriggers` and `zoneChangeTracking.ts` `checkETBTriggers` / `checkDiesTriggers` are different functions — do not merge.

| Module | Owns |
| --- | --- |
| `triggersHandlerTypes.ts` | `TriggerResult`, `TriggerProcessingOptions`, step/ETB/landfall/dies/spell/draw/combat-damage/blocked option types, `DelayedTriggerEventCheck`, combat/attack/blocked assignment types. |
| `triggersHandlerStackItems.ts` | `getStackItems`. |
| `triggersHandlerFindTriggeredAbilities.ts` | `findTriggeredAbilities`. |
| `triggersHandlerCheckStepTriggers.ts` | `checkStepTriggers`. |

### `utils-handlers/` (extracted from `state/utils.ts`)

Public path stays `server/src/state/utils.ts`. Folder is `server/src/state/utils-handlers/` — not `socket/util-handlers/`. Leaves must not import `utils.ts` or the index. Never create `state/utils/` beside `utils.ts` (`state/utils/diff.ts` is unrelated).

| Module | Owns |
| --- | --- |
| `variablePTCalculator.ts` | Characteristic-defining `*/*` P/T. Entry: `calculateVariablePT`. |
| `ptTypeLineCreatureTypes.ts` | Type-line subtype split. Entry: `extractCreatureTypes` (was file-private). |
| `ptAttachedBonusParseHelpers.ts` | Attached P/T count/parse, set-base-P/T auras, Trepanation Blade predicates. Entries: `resolveSetBasePTFromAttachedAuras`, `isEquippedAttackRevealUntilLandPump`, `getEquippedAttackRevealPumpPowerPerCard`, `shouldUseAttachedBonusNameTable`, `parseStaticAttachedPTBonusFromOracle`, `resolveAttachedPTBonusFromOracle`. |
| `ptAttachedBonusNameTables.ts` | Legacy empty `EQUIPMENT_BONUSES` / `AURA_BONUSES`. |
| `ptEquipmentBonusCalculator.ts` | Attached equipment/aura P/T sum. Entry: `calculateEquipmentBonus`. |
| `ptAllBonusesCalculator.ts` | Combined P/T bonuses (lords, anthems, equipment, counters). Entry: `calculateAllPTBonuses`. |
| `ptAllBonusesWithSources.ts` | Tooltip source tracking. Entries: `calculateAllPTBonusesWithSources`, `calculateEquipmentBonusWithSources`, `PTBonusSource`, `PTBonusResult`. |

### `counters_tokens-handlers/` (extracted from `counters_tokens.ts`)

Public path stays `counters_tokens.ts`. Leaves must not import the parent or the index. Runtime seam: `countersTokensHandlerDeps.ts`.

| Module | Owns |
| --- | --- |
| `countersTokensDeathTriggerStack.ts` | `inferDeathTriggerStackMetadata`, `pushDeathTriggerOntoStack`, exclusive battlefield-return metadata helpers. |
| `countersTokensDeathTriggerKeywords.ts` | `getKeywordDeathTriggersForPermanent`, `mergeDeathTriggers`. |
| `countersTokensCreateToken.ts` | `createToken`, `createCopyTokensOfCard`, `CreateTokenOptions`. |
| `countersTokensMoveToGraveyard.ts` | `movePermanentToGraveyard` (token cease-to-exist still emits death triggers). |
| `countersTokensMoveToExile.ts` | `movePermanentToExile`. |
| `countersTokensStateBasedActions.ts` | `runSBA`, `resolveLegendRuleChoice`. After `applyStateBasedActions`, stamps Darksteel-style `immediate` oracle-scanner wins. Upkeep scanner stays on `turnActions`. |
| `countersTokensHandlerDeps.ts` | Runtime seam for `runSBA` / GY / counter-mod / battlefield-exit / god-status. |

### `zones-handlers/` (extracted from `zones.ts`)

Public path stays `zones.ts`. Leaves must not import the parent or the index. Never create `zones/` beside `zones.ts`. Dual-copy: `clearPreparedStateOnBattlefieldExit` also exists as a private function in `counters_tokens.ts` — do not merge. `moveRemovedPermanentToExile` ≠ `movePermanentToExile`.

| Module | Owns |
| --- | --- |
| `zonesClearPreparedOnBattlefieldExit.ts` | `clearPreparedStateOnBattlefieldExit` (soulbond unpair + prepared cleanup). |
| `zonesDrawReplacementZursQueue.ts` | `getOpponentsForPlayer`, `queueZursWeirdingOpponentStep`, `queueZursWeirdingDrawReplacementStep`. |
| `zonesDrawReplacementDredgeQueue.ts` | `queueDredgeDrawReplacementStep`. |
| `zonesDrawReplacementSkipDrawQueue.ts` | `queueSkipDrawReplacementStep`. |
| `zonesDrawReplacementSkipDrawApply.ts` | `applySkipDrawReplacementChoice` — skip stamps except-keywords lock; draw continues. |
| `zonesDrawReplacementOpponentLibraryExile.ts` | Shared Fate-family draw replacement: exile top of a chosen opponent's library face down. Entries: `exileTopOfOpponentLibraryFaceDown`, `applyOrQueueOpponentLibraryDrawReplacement`. Face-down look/play are keyed to that source permanent id (`playFromExileRequiresSourcePermanentId`): only the player whose draw was replaced may look, and bounce/flicker/recast of a new instance does not recast previously exiled cards. |
| `zonesDrawReplacementOpponentLibraryExileApply.ts` | `applyOpponentLibraryDrawReplacementChoice` — apply the chosen opponent, then continue remaining draws. |
| `zonesDrawCards.ts` | `DrawCardsOptions`, `persistDrawCardsEvent`, `drawCards`, `drawCardsByIds`, `processDrawTriggers`. `drawCards` / `drawCardsByIds` skip a library card whose `id` is already in that player's hand (replay ghost) and keep drawing. |
| `zonesProcessMillTriggers.ts` | `processMillTriggers`. |
| `zonesMovePermanentToLibrary.ts` | `movePermanentToLibrary`. |
| `zonesMovePermanentToHand.ts` | `movePermanentToHand`. |
| `zonesMoveRemovedPermanentToExile.ts` | `moveRemovedPermanentToExile`. |

### `graveyard-permissions-handlers/` (extracted from `graveyard-permissions.ts`)

Public path stays `graveyard-permissions.ts`. Leaves must not import the parent or the index. Never create `graveyard-permissions/` beside `graveyard-permissions.ts`. Runtime seam: `graveyardPermissionsHandlerDeps.ts`. Dual-copy: `oracleIRParserPostprocessGraveyardCastPermission` and `graveyardPermissionAdditionalCost` are different modules — do not merge.

| Module | Owns |
| --- | --- |
| `graveyardPermissionsTypes.ts` | Public GY-permission interfaces/aliases. |
| `graveyardPermissionsCardUtils.ts` | Shared card/text helpers (`normalizeText`, `getCardId`, …). |
| `graveyardPermissionsQualifierMatch.ts` | `qualifierMatchesCard`, `getCardColors`, `splitTypeWordList`. |
| `graveyardPermissionsNormalize.ts` | Cost-mode / duration normalizers. |
| `graveyardPermissionsZoneAccess.ts` | Graveyard collection / snapshot / find. |
| `graveyardPermissionsHandlerDeps.ts` | Runtime seam for `addGraveyardCastingPermission`. |
| `graveyardPermissionsMarkSourcePlayable.ts` | `markSourceCardPlayableFromGraveyardThisTurn`. |
| `graveyardPermissionsTemporaryPlayable.ts` | Temporary playable-from-GY grant. |
| `graveyardPermissionsPlayableFromText.ts` | `applyPlayableFromGraveyardPermissionFromText`. |
| `graveyardPermissionsKeywordCost.ts` | Granted-keyword cost + escape counters. |
| `graveyardPermissionsKeywordGrantHelpers.ts` | Temporary keyword-grant lookup / target selection. |
| `graveyardPermissionsStripGenericCast.ts` | Escape strips companion generic GY-cast permission. |
| `graveyardPermissionsTemporaryKeywordGrant.ts` | `addTemporaryGraveyardKeywordGrant`. |
| `graveyardPermissionsKeywordGrantFromText.ts` | `applyTemporaryGraveyardKeywordGrantFromText`. |

### `keyword-trigger-handlers/` (extracted from `keyword-handlers.ts`)

Public path stays `keyword-handlers.ts`. Leaves must not import the parent or the index. Never create `keyword-handlers/` beside `keyword-handlers.ts`. Dual-copy: 2-arg `permanentHasKeyword` ≠ 4-arg `gameActionsPermanentKeywordGrants`.

| Module | Owns |
| --- | --- |
| `keywordTriggerTypes.ts` | `KeywordTriggerResult`, `KeywordTriggerContext`. |
| `keywordTriggerPermanentLookup.ts` | 2-arg `permanentHasKeyword`, `getPermanentKeywords` (oracle-text detect; distinct from 4-arg grants). |
| `keywordTriggerAttackHandlers.ts` | Combat lookup helpers plus attack-trigger `handleProwess` through `handleEnlist`. |

### `keyword-detection-handlers/` (extracted from `keyword-detection.ts`)

Public path stays `keyword-detection.ts`. Leaves must not import the parent or the index. Never create `keyword-detection/` beside `keyword-detection.ts`. Dual-copy: `detectKeywords` is consumed by `keyword-handlers.ts` / `keyword-trigger-handlers` — do not create a third copy. `status-keyword-detection.ts` is a different leftover detector.

| Module | Owns |
| --- | --- |
| `keywordDetectionTypes.ts` | `KeywordCategory`, `KeywordTiming`, `DetectedKeyword`, `KeywordDetectionResult`, `KeywordPattern`. |
| `keywordDetectionTriggeredPatterns.ts` | `TRIGGERED_KEYWORD_PATTERNS` regex table. |

### `triggerEtbEntryEffects-handlers/` (extracted from `triggerEtbEntryEffects.ts`)

Public path stays `triggerEtbEntryEffects.ts`. Leaves must not import the parent or the index. Never create `triggerEtbEntryEffects/` beside `triggerEtbEntryEffects.ts`. Dual-copy: `persistTriggeredAbilityPush` here ≠ `combatDeclareBlockersRequest.ts`. Sibling `triggerEtbGraveyardTargetPrompt.ts` is a prior extract, not in this folder.

| Module | Owns |
| --- | --- |
| `triggerEtbPersistTriggeredAbility.ts` | Event-log persist for a pushed triggered-ability stack item. Entry: `persistTriggeredAbilityPush`. |
| `triggerEtbTypedPermanentMatch.ts` | Typed/chosen-type ETB predicates and stack-item build. Entries: `shouldQueueChosenTypeCreatureEtbTrigger`, `tryBuildTypedPermanentEtbStackItem`, `matchesRequiredTypePhrase`, `TYPED_PERMANENT_ETB_REQUIRED_TYPE`. |
| `triggerEtbBattlefieldEntryTracking.ts` | Entered-this-turn counters for intervening-if. Entry: `recordBattlefieldEntryTurnTracking`. |
| `triggerEtbTemporaryEntryTriggers.ts` | This-turn temporary ETB triggers. Entries: `addTemporaryEtbTrigger`, `clearTemporaryEtbTriggers`, `queueTemporaryEtbTriggersForEntry`. |
| `triggerEtbTokenEntryEffects.ts` | Token battlefield-entry ETB (self + other permanents). Entry: `triggerETBEffectsForToken`. |
| `triggerEtbQueueSelfTriggers.ts` | Self-ETB when a permanent enters. Entry: `queueSelfETBTriggersForPermanent`. |

### `stackResolvePermanentEntryUtils-handlers/` (extracted from `stackResolvePermanentEntryUtils.ts`)

Public path stays `stackResolvePermanentEntryUtils.ts`. Leaves must not import the parent or the index. Never create `stackResolvePermanentEntryUtils/` beside the `.ts`. Parent keeps a thin `queueMutateTriggeredAbilities` wrapper. Spell-resolution entry calls `applyTriggeredReanimationEntryRiders` (`triggerReanimationRiders.ts`); modal choose-one oracle is not auto-applied as a keyword grant (Kogla and Yidaro).

| Module | Owns |
| --- | --- |
| `queueMutateTriggeredAbilities.ts` | Queue mutate triggered abilities from mutated-stack cards plus `detectMutateTriggers`. Exclusive helper `buildFullTriggeredAbilityText`. |

### `dungeon-effects-handlers/` (extracted from `dungeon-effects.ts`)

Public path stays `dungeon-effects.ts`. Leaves must not import `dungeon-effects.ts` or the index. Never create `dungeon-effects/` beside `dungeon-effects.ts`.

| Module | Owns |
| --- | --- |
| `dungeonRoomCardHelpers.ts` | `DungeonRoomExecuteEffectPayload`, library clone/get/top helpers, pending dungeon-room card ids, `getLibraryCardChoiceEntries`, `shuffleCardsInPlace`. |
| `dungeonRoomTokenEffects.ts` | `buildDungeonRoomTokenPayloads`, `applyAutomaticDungeonRoomTokenEffects`. |

### `executeSpellEffect-handlers/` (extracted from `executeSpellEffect.ts`)

Public path stays `executeSpellEffect.ts`. Internal TOC: `executeSpellEffect-handlers/index.ts`. Leaves must not import `executeSpellEffect.ts` or the index. Never create `executeSpellEffect/` beside `executeSpellEffect.ts`. Flat sibling `executeSpellEffectMillCards.ts` (MillCards case) is a prior extract, not in the handlers folder.

| Module | Owns |
| --- | --- |
| `executeSpellEffectCore.ts` | Legacy spell-effect switch. Entry: `executeSpellEffect`. **35.2 KB** — do not append. |
| `executeSpellEffectFlickerHelpers.ts` | Flicker return-at normalize/schedule and exile-to-battlefield return. Entries: `normalizeFlickerReturnAt`, `scheduleExiledCardReturnToBattlefield`, `returnExiledCardToBattlefield`, `resolveFlickerReturnAfterExile`. |

### `upkeep-triggers-handlers/` (extracted from `upkeep-triggers.ts`)

Public path stays `server/src/state/modules/upkeep-triggers.ts`. Leaves must not import the parent or the index. Never create `upkeep-triggers/` beside `upkeep-triggers.ts`. Dual-copy: none — `detectUpkeepTriggers` / `UpkeepTrigger` lived only in this parent.

| Module | Owns |
| --- | --- |
| `upkeepTriggerDetectHelpers.ts` | `UpkeepTrigger` plus exclusive detect helpers: `normalizeUpkeepEffectText`, `hasMatchingUpkeepEffect`, `isSacrificeCreatureOrSelfOracle`. |
| `upkeepMarkerHelpers.ts` | Echo/control upkeep marker lookup. Entry: `getLastUpkeepMarker`. |
| `upkeepEchoHelpers.ts` | Echo cost fires on the control-change upkeep. Entry: `shouldTriggerEcho`. |
| `upkeepTriggerDetect.ts` | Oracle-text upkeep trigger detection. Entry: `detectUpkeepTriggers`. Optional `state` merges granted quotes (Tavern Brawler / Plague Sliver / Noble Heritage). |

### `triggerReflexiveWhenYouDoQueueUtils-handlers/` (extracted from `triggerReflexiveWhenYouDoQueueUtils.ts`)

Public path stays `triggerReflexiveWhenYouDoQueueUtils.ts`. Leaves must not import the parent or the index. Never create `triggerReflexiveWhenYouDoQueueUtils/` beside the `.ts`. Flat sibling `triggerReflexiveBoundSelfExilePreludeUtils.ts` stays put.

| Module | Owns |
| --- | --- |
| `maybeQueueReflexiveAnyAmountManaPayment.ts` | Queues CR 603.12 “you may pay any amount of mana. If you do” reflexive `OPTION_CHOICE`. Entry: `maybeQueueReflexiveAnyAmountManaPayment`. |

### `replacementEffectSpec-handlers/` (extracted from `replacementEffectSpec.ts`)

Public path stays `replacementEffectSpec.ts`. Leaves must not import the parent or the index. Existing mechanic row for CR 616.1a leave-battlefield / finality stays — that logic is still in the parent builtins.

| Module | Owns |
| --- | --- |
| `replacementEffectSpecTypes.ts` | `ReplacementEffectSpec` + per-event match interfaces. |
| `replacementEffectSpecOracleTextUtils.ts` | `normalizeOraclePatternText`, `readCardOracleText`. |
| `replacementEffectSpecLifeGainOracleTemplates.ts` | Life-gain oracle templates + collect. Includes enchanted-player / singular-opponent can't-gain; excludes this-turn / until-EOT activations. |
| `replacementEffectSpecLifeGainMatch.ts` | Shared life-gain match overlay helpers. |
| `replacementEffectSpecLifeLossOracleTemplates.ts` | Bloodletter-class “would lose life … lose twice that much instead” (`life-loss` event, controller’s turn). Wound Reflection is an end-step trigger, not this. |
| `replacementEffectSpecCounterOracleTemplates.ts` | Counter templates + collect. |
| `replacementEffectSpecLibrarySearchOracleTemplates.ts` | Library-search templates + collect. |
| `replacementEffectSpecDamageOracleTemplates.ts` | Damage templates, prevent-all-but parsers, emblem sources, `overlaySpecsMatchDamage`. |
| `replacementEffectSpecDrawOracleTemplates.ts` | Draw templates + collect. Includes Island Sanctuary optional skip-draw during the draw step, and Shared Fate-family “exile top of a chosen opponent's library face down instead of drawing”. |
| `replacementEffectSpecTokenOracleTemplates.ts` | Token templates + collect. |
| `replacementEffectSpecMillOracleTemplates.ts` | Mill templates + collect. |
| `replacementEffectSpecZoneChangeOracleTemplates.ts` | Oracle zone-change templates + collect. |
| `replacementEffectSpecLoseGameOracleTemplates.ts` | Can't-lose / can't-win / 0-life exemption / empty-library draw-win. `collectOraclePatternLoseGameReplacementSpecsFromState`. |
| `replacementEffectSpecLifeFloorDamageOracleTemplates.ts` | Worship / Fortune Thief life-floor damage replacements. Parse + collect; live cap apply is `detectDamageReplacementEffects` plus `replacementEffectsDamageLifeFloor.ts`. |

### `replacement-effects` siblings

`replacement-effects.ts` has no `*-handlers/` folder yet. Leaves must not import the parent.

| Module | Owns |
| --- | --- |
| `replacementEffectsDamageLifeFloor.ts` | Player-damage `floorLifeAt` caps for `evaluateDamageReplacementEvent`. Filters `detectDamageReplacementEffects` to `type: 'cap'` so combat's `calculateModifiedDamage` then shield eval does not double-apply Furnace/Gisela. Entry: `applyPlayerDamageLifeFloorCaps`. |

### `staticEffectSpec-handlers/` (extracted from `staticEffectSpecOracleParsing.ts`)

Public path stays `staticEffectSpec.ts` / `staticEffectSpecOracleParsing.ts`. Never create `staticEffectSpec/` beside `staticEffectSpec.ts`. Leaves must not import the parent or this index. `staticEffectSpecConditionEval.ts` owns `specMatchesStaticCondition` (unknown kinds do not grant; attacking / ring-bearer / threshold / equipped / `source_controller_attacked_this_turn` / `source_in_graveyard` / `target_has_keyword` / `target_lacks_keyword` / `target_lacks_all_keywords` / `target_power_greater_than_source_controller_hand_size` / `target_power_at_most` / `target_has_creature_type` / `target_lacks_creature_type` / `target_is_commander` / `target_owned_by_source_controller` / `target_has_type` / `target_is_outlaw` / `target_is_colorless` / `target_is_multicolored` / `target_is_modified` / `target_has_mana_color_and_lacks_keyword` / `target_enchanted_by_aura_you_control` / `source_is_untapped` / `source_is_attacking` / `source_controller_has_citys_blessing` / `target_is_historic` / `target_is_historic_during_source_controller_turn` / `target_has_mana_ability`). Extra `spec.conditions` must all match with `condition`. Keyword with/without conditions take an optional layer-6 resolver (printed + unconditional grants, then `removeAbilities`). `staticEffectSpecActivationLocks.ts` honors `"can't activate tap abilities"` at activate / tap / mana / AI. `staticEffectSpecAttackYouTax.ts` collects pillowfort `attackYouTaxGeneric` / `attackYouProhibited` / except-keyword stamps for live declare (per attacker) plus `blockTaxGeneric`. `staticEffectSpecAttackYouTaxPhyrexian.ts` collects `{W/P}`. `staticEffectSpecAttackTaxThisTurn.ts` collects War Tax stamps. `staticEffectSpecTypes.ts` holds declarative spec types (re-exported from `staticEffectSpec.ts`). `staticEffectSpecCopyExiledActivated.ts` expands `copyActivatedFromExiledWithCardType` from `exiledWithSourceId` / `exiledWith` cards in `zones[].exile`, `players[].exile`, and the source permanent’s `exiledCards` bag. GY→exile provenance stamps live in `exileWithSourceStamp.ts`.

| Module | Owns |
| --- | --- |
| `staticEffectSpecOracleParseHelpers.ts` | Ability tails, buffs, `buildSpec`. `{T}: Add {G} or {W}` collects both tap_for colors. `{T}, Pay 1 life: Add any color` and quoted ability text are grants. Keywords inside quotes are not static keyword grants (Agent of the Shadow Thieves until-EOT deathtouch). Numeric `afflict N` / `toxic N` / `fabricate N` / `outlast {N}`. `ABILITY_WORDS` includes riot / exalted / skulk / intimidate / myriad / wither / fear / horsemanship / prowess / training / evolve / dethrone / unleash / melee / exploit / extort. `parseLordCreatureType` uses `normalizeCreatureTypeWord` (Elves/Dwarves/Mice). |
| `staticEffectSpecOracleParsingTypedAndKeywordLords.ts` | Artifact/enchantment/land creature lords (`target_has_type`), outlaw designation lords (`target_is_outlaw`), nontoken/attacking “have” grants, color/colorless/multicolored other-creature anthems, permanents/artifacts/enchantments you control have (`other_permanents_you_control`), modified/equipped/enchanted have. Entry: `pushTypedAndKeywordLordSpecs`. |
| `staticEffectSpecOracleParsingQuotedNumericBasePT.ts` | Quoted have-grants (Phenax / Slivers / Forgotten Monument / Grothama / All-type including **all creatures/artifacts/enchantments** / Non-Type / commander-you-own / **Elves you control** / **permanents you control**), city's blessing anthems, historic-during-your-turn, characteristic-setting base P/T + type additions (`other_all_creatures`), mana-ability creature anthems, copy activated abilities of cards exiled with the source. Entry: `pushQuotedNumericAndBasePTLordSpecs`. |
| `staticEffectSpecOracleParsingGraveyardLandKeywords.ts` | GY + basic-land-type keyword grants (Anger / Wonder family). |
| `staticEffectSpecOracleParsingAsLongAsAndPolarity.ts` | Player hexproof; you-and-type; you/planeswalkers/other-creatures hexproof (Shalai wording); other/opponent P/T. |
| `staticEffectSpecOracleParsingManaAbilityGrants.ts` | Lands/creatures tap-for-mana grants. GY-gated “as long as this card is in your graveyard, lands you control have `{T}: Add {G} or {W}`” (Riftstone Portal) uses `source_in_graveyard`. |
| `staticEffectSpecOracleParsingTapUntapAbilityGrants.ts` | Tapped/untapped creature keyword grants (`target_is_tapped` / `target_is_untapped`; Saryth). |
| `staticEffectSpecOracleParsingMustBeBlocked.ts` | Host grants: `all_able_creatures_must_block` vs `must_be_blocked_if_able`. Same-sentence `has first strike` included (Masamune `target_is_attacking` / Indrik Umbra). List leftovers + Frodo / threshold / Enkira. Raid / “if you attacked this turn” → `source_controller_attacked_this_turn`. Other unexpressible as-long-as still fail closed. Channel “this turn” is not a static. Idle Masamune first strike is no longer leaked by parent `attachment-keyword-host` (`shared/src/attachmentKeywordGrants.ts` gates `is` attacking / `, it has` tails). |
| `staticEffectSpecOracleParsingMustBeBlockedByType.ts` | Typed “must be blocked by a creature with [keyword] if able” → `must_be_blocked_by_<keyword>` host grant. Channel / this turn / raid skipped. Entry: `pushMustBeBlockedByTypeSpecs`. |
| `staticEffectSpecOracleParsingCantAttack.ts` | Host combat locks: Pacifism / Bound in Silence `can't attack` / `can't block`. Same-sentence `{T}`-cost activation lock (`can't activate tap abilities`; Serra Bestiary). Skips this-turn, pillowfort unless-pay, and “can't attack you”. Live declare uses `combatLegalityGates`; tap lock via `staticEffectSpecActivationLocks.ts`. Entry: `pushCantAttackBlockSpecs`. |
| `staticEffectSpecOracleParsingMassCantAttack.ts` | Mass combat locks: Moat without-keyword, Katabatic with-keyword attack/block/`{T}`, Ensnaring Bridge power vs hand, Peacekeeper all creatures, type-you-control (Doomed Artisan). Entry: `pushMassCantAttackBlockSpecs`. Conditions: `target_has_keyword` / `target_lacks_keyword` / `target_power_greater_than_source_controller_hand_size` (evaluated with layer-6 grants then `removeAbilities`). Pillowfort tax is a sibling parser, not `can't attack`. |
| `staticEffectSpecOracleParsingAttackYouTax.ts` | Pillowfort tax `{N}/{X}` plus `attackYouTaxPhyrexian` `{W/P}` plus Nils `counters_on_target` `{X}` plus `attackYouProhibited` (Elephant Grass, Blazing Archon, Form of the Dragon, Sandwurm, Reverence, Combat Calligrapher, Vow host, Teferi's Moat, Eriette, Island Sanctuary `target_lacks_all_keywords`). Crawlspace / Silent Arbiter caps. Archangel `blockTaxGeneric`. Onakke `attackPlaneswalkerYouControlTaxGeneric`. Heat Wave `blockTaxLife` / `cantBlockCreaturesYouControl`. Static this-turn skipped; applied War Tax is `staticEffectSpecAttackTaxThisTurn.ts`; applied War Cadence is `staticEffectSpecBlockTaxThisTurn.ts`. Collectors: `staticEffectSpecAttackYouTax.ts`, `staticEffectSpecAttackYouTaxPhyrexian.ts`. Attacker-self Whipgrass grant: `shared/src/combatAttackerSelfTax.ts`. Live: `combatDeclareAttackersRequest.ts`, `attackCostPhyrexianPayment.ts`, `combatLegalityGates.ts` (`blockerCantBlockCreaturesYouControl`). AI caps: `combatDeclareAttackersExecute.ts`, `aiPriorityPassCombatExecutors.ts`. AI block tax: `aiPriorityPassCombatBlockTax.ts`. |
| `staticEffectSpecOracleParsingLoseKeywords.ts` | Opponent lose-keyword (`removeAbilities`); all-creatures lose (Gravity Sphere / Mystic Decree); Glaring Spotlight you-control as-though; Nowhere to Run global as-though (`asThoughNoAbilities` including `'ward'` for “Ward abilities of those creatures don't trigger”); Kaya opponent permanents. Until-EOT activations and until-EOT mass lose skipped. Humility lose-all skipped. |
