# MTG logic module map — Oracle IR executor

Peeled from `docs/mtg-logic-module-map.md` (`## Oracle IR executor`).
Coordinator owns this file. Extract chats must not edit it — paste owed rows.

## Oracle IR executor (`rules-engine/src/`)

All listed executor parents are under the ceiling. `oracleIRExecutorModifyPtStepHandlers.ts` is **25.4 KB** (done). `oracleIRExecutorDamageStepHandlers.ts` is **28.3 KB** (done). `oracleIRExecutorCreatureStepUtils.ts` is **14.0 KB** (done). `oracleIRExecutorTokenStepHandlers.ts` is **25.0 KB** (done). `oracleIRExecutorPlayerUtils.ts` is **38.2 KB** (done). `oracleIRExecutorSpecialTargetHandlers.ts` is **2.8 KB** (done; thin barrel). `oracleIRExecutorConditionalStepSupport.ts` is **5.7 KB** (done). `oracleIRExecutorConditionalStepSupportExtended.ts` is **15.9 KB** (done). `oracleIRExecutorMoveZoneStepHandlers.ts` is **31.9 KB** (done). `oracleIRExecutorPlayerStepHandlers.ts` is **33.6 KB** (done). `oracleIRExecutorMainLoop.ts` is **29.4 KB** (done; `applyOracleIRStepsToGameStateImpl` is the switch dispatcher). `oracleIRExecutorBattlefieldStepHandlers.ts` is **34.7 KB** (done). `oracleIRExecutorZoneOps.ts` is **20.2 KB** (done). Split by step or op family; no `BatchNNN` / `Bulk` names. No `*-handlers/` folder until a parent is already a thin barrel.

### `oracleIRExecutorMoveZone*` (extracted from `applyMoveZoneStep`)

Public API unchanged: parent still exports `applyMoveZoneStep` / `MoveZoneStepHandlerResult`. Guard chains take `MoveZoneGuardArgs` and return a result or `undefined` (fall through). Do not import the parent from a leaf.

| Module | Owns |
| --- | --- |
| `oracleIRExecutorMoveZoneWhatParsersZoneQueries.ts` | Zone / target / count selector parse prologue. |
| `oracleIRExecutorMoveZoneWhatParsersReferenceQueries.ts` | Contextual / revealed / milled / per-player-zone selectors. |
| `oracleIRExecutorMoveZoneGuardArgs.ts` | `MoveZoneGuardArgs`, `MoveZoneFinalizeAppliedResult`, `buildMoveZoneBattlefieldEntryOverrides`. |
| `oracleIRExecutorMoveZoneStepTypes.ts` / `…ReferenceResolvers.ts` / `…ContextualCardResolvers.ts` / `…StepResultBuilders.ts` / `…LinkedExileProjection.ts` / `…PermanentSelectors.ts` / `…EarlyGuardSteps.ts` / `…LibraryPlacementChoice.ts` | Shared plumbing for the move-zone apply. |
| `oracleIRExecutorMoveZoneGuards<FirstSelector>.ts` | Contiguous guard runs named after the first selector they test (`CommandZonePermanent`, `FromGraveyard`, `ThatPile`, …). Entry: `tryApplyMoveZoneGuardsFromX(args)`. |
| `oracleIRExecutorMoveZoneGuardsDiceBracketIt.ts` | Head-of-chain guards from `parsedDiceBracketIt` through self-battlefield `whatText` / `sourceCardZone`. Entry: `tryApplyMoveZoneGuardsFromDiceBracketIt`. |
| `oracleIRExecutorMoveZoneGuardsTopCardLibraryOwnerId.ts` | Top/bottom library-owner moves and `contextualBoundCardIds` multi-card move. Entry: `tryApplyMoveZoneGuardsFromTopCardLibraryOwnerId`. |
| `oracleIRExecutorMoveZoneGuardsOneOfThemSplit.ts` | Second chain: `parsedOneOfThemSplit` / `parsedOnePileSplit` / `contextualBoundCardZone` / `sourceCardZone` plus following graveyard / hand-gy selectors. Entry: `tryApplyMoveZoneGuardsFromOneOfThemSplit`. |
| `oracleIRExecutorMoveZoneGuardsCommandZonePermanentToHand.ts` | Remaining inline guard-arg builds + leftover selector runs (first leftover: `parsedCommandZonePermanent && step.to === 'hand'`). Entry: `tryApplyMoveZoneGuardsFromCommandZonePermanentToHand`. **34.1 KB** — do not append. |
| `oracleIRExecutorMoveZoneGuardsUnsupportedSelectorEarlyOut.ts` | All-selector unsupported early-out. Returns the skip result or `undefined`. Not named `GuardsFromGraveyard`. |

Parent is **31.9 KB**. Leftover: `finalizeAppliedResult` prologue (closes over mutable `nextState` / `effectiveBattlefieldAdd*`). `MoveZoneGuardArgs` already carries the extra locals from these chains.

### `oracleIRExecutorZoneOps*` (extracted from `oracleIRExecutorZoneOps.ts`)

| Module | Owns |
| --- | --- |
| `oracleIRExecutorZoneOpsCardTypeMatchers.ts` | Simple card-type parsing and matching. Entries: `SimpleCardType`, `parseSimpleCardTypeFromText`, `cardMatchesType`, `cardMatchesTotalPowerToughnessLte`. Parent re-exports the public API. |
| `oracleIRExecutorZoneOpsShuffleIntoLibrary.ts` | Shuffle-all / typed cards from a player's graveyard into their library. Entries: `parseMoveZoneShuffleAllFromYourGraveyardIntoLibrary`, `shufflePlayerGraveyardIntoLibrary`, `shuffleTypedCardsFromPlayerGraveyardIntoLibrary`. Parent re-exports the public API. |

### `oracleIRExecutorPlayerUtils*` (extracted from `oracleIRExecutorPlayerUtils.ts`)

Public API unchanged: parent re-exports. Do not import the parent from a leaf. Parent is **38.2 KB** (under ceiling). Leftover: graveyard/exile permission markers, vote/quantity helpers, mill-until / reveal-until, draw / exile-top, shuffle-rest / library-bottom, `adjustLife`, `adjustPlayerCounter`, mill. Pre-existing dual copy: `isThatOwnerOrControllerSelector` / `isThoseOpponentsSelector` also live in `oracleIRParserUtils.ts`.

| Module | Owns |
| --- | --- |
| `oracleIRExecutorPlayerResolvePlayers.ts` | `resolvePlayers`, `resolvePlayersFromDamageTarget`, `countControlledLands`, `listEligibleChooseOpponentIds`, `isThatOwnerOrControllerSelector`, `isThoseOpponentsSelector`. |
| `oracleIRExecutorPlayerImpulsePermissionMarkers.ts` | `applyImpulsePermissionMarkers`. |
| `oracleIRExecutorPlayerZoneAccess.ts` | `readPlayerZoneCards`, `writePlayerZoneCards`, `getCurrentTurnNumber`, `stampCardPutIntoGraveyardThisTurn`, `stampCardsPutIntoGraveyardThisTurn`. |
| `oracleIRExecutorPlayerLookSelectTop.ts` | `lookSelectTopCardsForPlayer`. |
| `oracleIRExecutorPlayerCardInspect.ts` | `normalizeOracleText`, `getCardTypeLineLower`. |
| `oracleIRExecutorPlayerExileUntilAmount.ts` | `resolveUnknownExileUntilAmountForPlayer`, `getCardTypesFromTypeLine`, `getCardManaValue`. |
| `oracleIRExecutorPlayerDiscardCards.ts` | `discardCardsForPlayer`, `discardSpecificCardsForPlayer`. |
| `oracleIRExecutorPlayerAddManaToPool.ts` | `addManaToPoolForPlayer`. |

### `oracleIRExecutorCreatureStepUtils-handlers/` (extracted from `oracleIRExecutorCreatureStepUtils.ts`)

Public API unchanged: parent re-exports. Do not import the parent from a leaf. Parent is **14.0 KB** (done). Leftover: temporary P/T (`applyTemporaryPowerToughnessModifier`, `applyTemporarySetBasePowerToughness`, `applyTemporarySwitchPowerToughness`), goad (`resolveGoadTargetCreatureIds`, `applyGoadToCreatures`), `countControlledByClass`, `normalizeControlledClassKey`. Never create `oracleIRExecutorCreatureStepUtils/` beside the `.ts`.

| Module | Owns |
| --- | --- |
| `oracleIRExecutorCreatureBattlefieldLookup.ts` | `getProcessedBattlefield`, `readPermanentPower`, `readPermanentToughness`, `permanentIsCreature`, `isMassTapOrUntapSelectorText`, `permanentHasSubtype`, `getSourceBattlefieldPermanent`, `getControlledPermanents`. |
| `oracleIRExecutorCreatureBattlefieldHelpers.ts` | `readPowerForComparison`, `readToughnessForComparison`, `readCreatureStatForComparison`, `isAttackingPermanent`, `resolveBlockersOfPermanent`, `resolveBlockingCreatureIds`, `isUnblockedAttackingPermanent`, `permanentHasKeyword`. |
| `oracleIRExecutorCreatureSingleTarget.ts` | `resolveSingleCreatureTargetId`, `resolveMentorTargetCreatureIdFromBattlefield`, `resolveCreatureExtremaQualifiedTargetIdFromBattlefield`, `resolveBolsterTargetCreatureIdFromBattlefield`, `resolveTrepanationBoostTargetCreatureId`. |
| `oracleIRExecutorCreatureTargetIds.ts` | `resolveCreatureTargetIds` (plus private `permanentMatchesControlledQualifier` / `readBaseStatForQualifier`). |

### `oracleIRExecutorModifyPtStepHandlers-handlers/` (extracted from `oracleIRExecutorModifyPtStepHandlers.ts`)

Public API unchanged: parent still exports `applyModifyPtStep`, `applyModifyPtPerRevealedStep`, `applySetBasePtStep`, `applySwitchPowerToughnessStep`, `ModifyPtRuntime`, `ModifyPtStepHandlerResult`. Do not import the parent from a leaf. Parent is **25.4 KB** (done). Leftover: `applyModifyPtStep`, `applyModifyPtPerRevealedStep`, `applySetBasePtStep`, `applySwitchPowerToughnessStep`, local step-result types. Never create `oracleIRExecutorModifyPtStepHandlers/` beside the `.ts`.

| Module | Owns |
| --- | --- |
| `oracleIRExecutorModifyPtStepTypes.ts` | `ModifyPtRuntime`. Parent re-exports. |
| `oracleIRExecutorModifyPtScalerCountHelpers.ts` | `countAttackingCreaturesMatching`, `countCreaturesBlockedByTarget`, `countCreaturesBlockingTarget`, `countBasicLandTypesAmongLandsYouControl`, `countArtifactsYouControl`, `countOtherAttackingAurochs`, `countControlledCreaturesWithSubtype`, `countPartyCreatures`, `countBloodTokensForPlayer`. |
| `oracleIRExecutorModifyPtReferenceScaler.ts` | `resolveReferenceScalerScale`. |

### `oracleIRExecutorDamageStepHandlers-handlers/` (extracted from `oracleIRExecutorDamageStepHandlers.ts`)

Public API unchanged: parent re-exports. Do not import the parent from a leaf. Parent is **28.3 KB** (done). Leftover: deal-damage apply (`applyDealDamageStep`) and amount/source/battlefield helpers, `applyDamageCantBePreventedStep`. Never create `oracleIRExecutorDamageStepHandlers/` beside the `.ts`.

| Module | Owns |
| --- | --- |
| `oracleIRExecutorDamagePreventionStepTypes.ts` | `PreventDamageStepHandlerResult` plus private prevention apply/skip types. Parent re-exports. |
| `oracleIRExecutorDamagePermanentTarget.ts` | `resolveSinglePermanentDamageTargetId`. |
| `oracleIRExecutorDamagePreventionLookups.ts` | `resolvePreventionRecipientPermanentId`, `resolvePreventionTargetSourceId`, `findSourceObject`. |
| `oracleIRExecutorPreventDamageStep.ts` | `applyPreventDamageStep`. Parent re-exports. |

### `oracleIRExecutorToken*` (extracted from `applyCreateTokenStep`)

Parent `oracleIRExecutorTokenStepHandlers.ts` is **25.0 KB** (done). Leftover: `applyCreateTokenStep` dispatcher, `scheduleTokenCleanup`, and for-each copy/create `tryApply*` helpers. Public API unchanged: parent still exports `applyCreateTokenStep` / `TokenStepHandlerResult`. Do not import the parent from a leaf.

| Module | Owns |
| --- | --- |
| `oracleIRExecutorTokenCopySource.ts` | Copy-token source resolution and exclusive copy helpers. Entries: `resolveCopyTokenSource`, `createCopiedTokenPermanent`, `splitCopyTokenReference`, `typeLineHasWord`, `findSourceObjectByIdAcrossState`, `normalizeReferenceText`. **35.4 KB** — do not append. |
| `oracleIRExecutorTokenBlockingEntry.ts` | Stamp created tokens as blocking a creature. Entries: `applyBlockingEntryToCreatedTokens`, `resolveBlockTargetPermanentId`. |
| `oracleIRExecutorTokenBattlefieldAdd.ts` | Amount resolution, those-referenced copies, and battlefield add. Entries: `addTokensToBattlefield`, `resolveTokenAmount`, `resolveTokenCreationSpecsForReplacementEffects`. **36.4 KB** — do not append. |

### `oracleIRExecutorSpecialTarget*` (extracted from `trySpecial*`)

Parent is a **2.8 KB** barrel: `trySpecialExileStep` dispatches Batch386–389 then `tryApplyExileLookedContextualStep` / `tryApplyExilePileCounterAndTargetedStep`; other `trySpecial*` are re-exports. No `*-handlers/` folder. Existing Batch386–391 siblings stay. Do not create new `BatchNNN` / `Bulk` names.

| Module | Owns |
| --- | --- |
| `oracleIRExecutorSpecialTargetOps.ts` | `SpecialTargetStepResult`, normalize helpers, `collectBoundIds`, exile ops. |
| `oracleIRExecutorSpecialTargetResolve.ts` | `resolveSourcePermanent`, `resolveEnchantedHost`, `resolveContextualCreature`. |
| `oracleIRExecutorExileLookedContextualHandlers.ts` | `tryApplyExileLookedContextualStep` (looked/contextual, top mill, mass nontoken, “the rest”). |
| `oracleIRExecutorExilePileCounterAndTargetedHandlers.ts` | `tryApplyExilePileCounterAndTargetedStep` (face-down piles, source counters, until-leaves, targeted). |
| `oracleIRExecutorSpecialTargetDestroyHandlers.ts` | `trySpecialDestroyStep`. |
| `oracleIRExecutorSpecialTargetAddRemoveCounterHandlers.ts` | `trySpecialAddCounterStep`, `trySpecialRemoveCounterStep`. |
| `oracleIRExecutorSpecialTargetRegenerateDamageHandlers.ts` | `trySpecialRegenerateStep`, `trySpecialDealDamageStep`, `trySpecialPreventDamageStep`. |
| `oracleIRExecutorSpecialTargetDoubleCountersHandlers.ts` | `trySpecialDoubleCountersStep`. |
| `oracleIRExecutorSpecialTargetSacrificeHandlers.ts` | `trySpecialSacrificeStep`. |
| `oracleIRExecutorSpecialTargetCopyPermanentHandlers.ts` | `trySpecialCopyPermanentStep`. |
| `oracleIRExecutorSpecialTargetCombatStatusHandlers.ts` | exert / turn-face-down / tap-or-untap / force-block / suspect. |
| `oracleIRExecutorSpecialTargetMoveCountersHandlers.ts` | `trySpecialMoveCountersStep`, `trySpecialScheduleDelayedBattlefieldActionStep`. |

### `oracleIRExecutorConditionalStep*` (extracted from `evaluateConditionalWrapperCondition`)

Parent is a **5.7 KB** dispatcher: unless-kind + if/as_long_as normalize, then `tryEvaluate…` fall-throughs. Leaves return `boolean | null | undefined` (`undefined` = family did not match; `null` = matched but unevaluable). Recursion is `params.evaluateRecursive`. No leaf imports the public parent. `oracleIRExecutorConditionalStepSupportHelpers.ts` is **38.6 KB** — do not append.

| Module | Owns |
| --- | --- |
| `oracleIRExecutorConditionalStepSupportHelpers.ts` | Shared types + helpers (`ConditionalCondition`, `resolveUnlessPayInnerCondition`, …). |
| `oracleIRExecutorConditionalStepUnlessPay.ts` | `tryEvaluateConditionalUnlessPayYouDoOtherwise` (unless-pay, you-do/otherwise, enters-this-way, lands, first-combat). |
| `oracleIRExecutorConditionalStepCreaturesDied.ts` | `tryEvaluateConditionalCreaturesDiedThisTurn` (died, suspected, attacking, hand-size, legendary). |
| `oracleIRExecutorConditionalStepKicked.ts` | `tryEvaluateConditionalKicked` (kicked, composite and/or, graveyard-there-are). |
| `oracleIRExecutorConditionalStepYouHaveGraveyard.ts` | `tryEvaluateConditionalYouHaveGraveyard` (you-have-graveyard, entered-from, vote, mana-spent). |

### `oracleIRExecutorConditionalStepExtended*` (extracted from `evaluateExtendedConditionalClause`)

Parent is a **15.9 KB** dispatcher: `thisWay` → `would` → existing `evaluateBatch368–380` → `tryEvaluate…` fall-throughs. Leaves return `boolean | null`. `oracleIRExecutorConditionalStepExtendedClauseHelpers.ts` is **35.5 KB** — do not append. Do not create new `BatchNNN` / `Bulk` names.

| Module | Owns |
| --- | --- |
| `oracleIRExecutorConditionalStepExtendedTypes.ts` | `ExtendedConditionalParams`, `LastActionOutcome`, `EXILE_THIS_WAY_STEP_KINDS`. |
| `oracleIRExecutorConditionalStepExtendedClauseHelpers.ts` | Shared helpers including `getControlledTypeEnteredThisTurnCount`. |
| `oracleIRExecutorConditionalStepExtendedThisWay.ts` | `evaluateThisWayClause`. |
| `oracleIRExecutorConditionalStepExtendedWarriorDamage.ts` | `tryEvaluateExtendedWarriorDamageClause` (warrior damage through surge-cost-paid). |
| `oracleIRExecutorConditionalStepExtendedProwl.ts` | `tryEvaluateExtendedProwlClause` (prowl through graveyard-has-flying). |
| `oracleIRExecutorConditionalStepExtendedLessonCard.ts` | `tryEvaluateExtendedLessonCardClause` (lesson in graveyard …). |
| `oracleIRExecutorConditionalStepExtendedCycledCard.ts` | `tryEvaluateExtendedCycledCardClause`. |
| `oracleIRExecutorConditionalStepExtendedVotedChoice.ts` | `tryEvaluateExtendedVotedChoiceClause`. |
| `oracleIRExecutorConditionalStepExtendedCommanderControl.ts` | `tryEvaluateExtendedCommanderControlClause`. |

### `oracleIRExecutorBattlefield*` (extracted from `oracleIRExecutorBattlefieldStepHandlers.ts`)

Parent is a **34.7 KB** barrel. Keep the `oracleIRExecutorBattlefield*` prefix. No `*-handlers/` folder. `applyGrantTemporaryAbilityStep` was **not** moved whole: early cases vs remaining body. `applyAddCounterStep` stays in the parent.

| Module | Owns |
| --- | --- |
| `oracleIRExecutorBattlefieldCantAttackStep.ts` | `applyCantAttackStep` |
| `oracleIRExecutorBattlefieldTapUntapSteps.ts` | tap / skip / optional untap |
| `oracleIRExecutorBattlefieldDoubleMoveCountersSteps.ts` | double / move counters |
| `oracleIRExecutorBattlefieldExchangeAndCopySteps.ts` | exchange control, copy permanent |
| `oracleIRExecutorBattlefieldCantActivateAbilitiesStep.ts` | `applyCantActivateAbilitiesStep` |
| `oracleIRExecutorBattlefieldGrantStaticAbilityStep.ts` | `applyGrantStaticAbilityStep` |
| `oracleIRExecutorBattlefieldGrantTemporaryTargetText.ts` | infer/normalize grant target text |
| `oracleIRExecutorBattlefieldGrantTemporaryAbilityEarlyCases.ts` / `…GrantTemporaryAbilityStep.ts` | grant-temporary split |
| `oracleIRExecutorBattlefieldDestroyTargets.ts` / `…DestroyStep.ts` | destroy targeting + step |
| `oracleIRExecutorBattlefieldBendAndAnimateSteps.ts` | airbend, earthbend, animate |
| `oracleIRExecutorBattlefieldExileStep.ts` | exile step + zone/stack/metadata helper siblings |
| `oracleIRExecutorBattlefieldSacrificeSteps.ts` | sacrifice apply + helper siblings (`…SacrificeWhat.ts` already existed) |
| `oracleIRExecutorBattlefieldDelayedBattlefieldActionStep.ts` | delayed battlefield action + helper siblings |
| `oracleIRExecutorBattlefieldRemoveCounterStep.ts` | remove-counter targets + step |
| `oracleIRExecutorBattlefieldAddCounterAmount.ts` / `…AddCounterDistribute.ts` | add-counter helpers (`applyAddCounterStep` still in the parent) |

### `oracleIRExecutorMainLoop*` (extracted from `applyOracleIRStepsToGameStateImpl`)

Parent is a **29.4 KB** dispatcher. Each family returns `result | undefined` (undefined = fall through). Leaves must not import `oracleIRExecutorMainLoop.ts`.

| Module | Entry |
| --- | --- |
| `oracleIRExecutorMainLoopStepTypes.ts` | `RecurseExecutor`, `MainLoopStepFamilyCtx` |
| `oracleIRExecutorMainLoopCounterSpellStep.ts` | `applyCounterSpellStep`, `isPlayerStillInGame` |
| `oracleIRExecutorMainLoopExileRestrictionSteps.ts` | `tryApplyMainLoopExileRestrictionSteps` |
| `oracleIRExecutorMainLoopCoinDieDrawSteps.ts` | `tryApplyMainLoopCoinDieDrawSteps` |
| `oracleIRExecutorMainLoopLibraryTurnControlSteps.ts` | `tryApplyMainLoopLibraryTurnControlSteps` |
| `oracleIRExecutorMainLoopChoiceKeywordLookSteps.ts` | `tryApplyMainLoopChoiceKeywordLookSteps` |
| `oracleIRExecutorMainLoopMillPtTokenSteps.ts` | `tryApplyMainLoopMillPtTokenSteps` |
| `oracleIRExecutorMainLoopCopyDestroySteps.ts` | `tryApplyMainLoopCopyDestroySteps` |
| `oracleIRExecutorMainLoopLateSteps.ts` | `tryApplyMainLoopLateSteps`. **Ledger:** a successful `conditional` records inner/else `appliedSteps` only; push the wrapper iff that branch applied nothing. Do not always append `'conditional'` after inner steps (31-test regression after the MainLoop split). Court of Ambition discarded/no-life-loss asserts `['unless_discards']`, not the wrapper. |
