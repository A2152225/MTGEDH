# MTG logic module map — extract-family handler folders

Peeled from `docs/mtg-logic-module-map-extract-families.md`.
Coordinator owns this file. Extract chats must not edit it — paste owed rows.

### `game-actions-handlers/` (extracted from `game-actions.ts`)

Public path stays `game-actions.ts` (`export { … } from "./game-actions-handlers/…"`). Leaves must not import the parent or the index.

| Module | Owns |
| --- | --- |
| `gameActionsCastCostReduction.ts` | Battlefield/static spell cost reduction, generic taxes, convoke, cost metadata types. |
| `gameActionsCastCostFormatting.ts` | Mana-cost adjustment arithmetic, adjusted-cost rendering, payment/pending-cast payloads. |
| `gameActionsPermanentKeywordGrants.ts` | 4-arg keyword/haste grants + summoning sickness (distinct from 2-arg `keyword-handlers.ts`). |
| `gameActionsCastSpellPaymentSources.ts` | Cast-spell payment sources: permanent refs, mana-ability costs, produced mana, checkpoints. |
| `gameActionsSpellTargetSelection.ts` | Spell target lists, grouped metadata, per-clause TARGET_SELECTION. Player candidates go through `canPlayerBeTargetedByPlayer`. Battlefield candidates also filter `has_keyword` / power-toughness from parsed reqs. `shouldPreferParsedTargetReqs` re-exports from `gameActionsCastSpellParsedTargeting.ts`; per-clause prompts go through `resolveCastSpellParsedTargeting`. |
| `gameActionsCastSpellParsedTargeting.ts` | IR-primary cast-time targeting from `parseTargetRequirements`. Copies `targetRestriction` / `statRequirement` / `creatureRestriction` onto derived SpellSpec. IR-off still categorizes. Public: `resolveCastSpellParsedTargeting`, `deriveSpellSpecFromParsedTargetReqs`, `parsedTargetReqsCoverCastTargets`, `shouldPreferParsedTargetReqs`. |
| `gameActionsSpellCopyHeroicTriggers.ts` | Spell copies, copy retargeting, heroic / targeted / untap cast triggers. Copy-retarget player lists use `canPlayerBeTargetedByPlayer`. |
| `gameActionsSpellCastTriggerDetection.ts` | Which spell-cast triggers a cast produces; once-per-turn bookkeeping. `recordSpellCastThisTurn` persists `namedSpellsCastThisGame` `{name,id}` via `persistNamedSpellCastThisGame`. GY replay, replay `castSpell`, and `copyStackItem` also call the helper. Live persistOnCast still goes through `recordSpellCastThisTurn` only. |
| `gameActionsSpellCastTriggerProcessing.ts` | Run those triggers: APNAP, intervening-if, IR vs legacy, step queueing. |
| `gameActionsMulliganReadinessChecks.ts` | Free-mulligan house rule, mulligan counts, all-players-ready. |
| `gameActionsPermanentEntryPrompts.ts` | Creature-type / color / player / enchantment ETB prompts as a permanent enters. |
| `gameActionsSpellCastLock.ts` | Completing-cast marker, payment-resume lock, pending-step lookup/restore. Dynamic `import('../resolution.js')`. |
| `gameActionsCastFaceAndMiracleSelection.ts` | Effective base cost, miracle, suspend, card-face / adventure. |
| `gameActionsModalCastModeCosts.ts` | Modal / entwine / escalate / additional-cost / overload cost+text. |
| `gameActionsPlayerZoneCards.ts` | Shared leaf: library / command-zone / spell-source card reads. |
| `gameActionsPlayLandRequest.ts` | Play-land request, top-of-library permission, land ETB shape. |
| `gameActionsRequestedSpellCastCandidate.ts` | Resolve a cast request to a shared castable-spell candidate. |
| `gameActionsAdditionalCastCosts.ts` | Harmonize, squad, reveal additional costs. |
| `gameActionsCommandZoneAndAlternateCastCosts.ts` | Command-zone candidates + tax, keyword alternate-cost extras, library cast access. |
| `gameActionsSocketRoomGuard.ts` | Shared `EnsureInGameRoom` type for extracted socket handlers. |
| `gameActionsTurnFlowSocketHandlers.ts` | `claimMyTurn`, `randomizeStartingPlayer`, `nextTurn`, `nextStep`, `skipToPhase`. |
| `gameActionsPregameSocketHandlers.ts` | `restartGame`, `restartGameClear`, `keepHand`, `unkeepHand`, `mulligan`. |
| `gameActionsLifeMillHouseRulesSocketHandlers.ts` | Life / mill / house-rules socket handlers: `adjustLife`, `setLife`, `mill`, `setHouseRules`. |
| `gameActionsEquipAbilitySocketHandlers.ts` | Equip-ability socket handler lifted out of `registerGameActions`: valid-target prompt, metalcraft cost reduction, mana payment, stack activation. Entry: `handleEquipAbilityRequest`. |
| `gameActionsCastSpellFromHandAdditionalCosts.ts` | `handleCastSpellFromHand` additional-cost prompts (Bargain, evidence, Teamwork, Behold, discard, sacrifice, pay life, Squad) before targeting. Pay-life consults `canPlayerPayLife`. |
| `gameActionsCastSpellFromHandTargets.ts` | Cast-time targeting (CR 601.2c): Aura hosts, spell targets, validation. |
| `gameActionsCastSpellFromHandCostConvoke.ts` | Cost assembly (alt costs, X, reductions) plus Harmonize/Convoke and the payment checkpoint. |
| `gameActionsCastSpellFromHandManaPayment.ts` | Mana-source payment: tap/sacrifice permanents, floating-pool picks, haste snapshots. |
| `gameActionsCastSpellFromHandConsumeMana.ts` | Pool consumption plus Treasure/snow provenance and converge. |
| `gameActionsCastSpellFromHandPersistOnCast.ts` | Persist `castSpell` plus on-cast trigger glue and pending cascade/scry. |
| `gameActionsCastSpellFromHandModalOverloadLife.ts` | Modal / overload / pay-X-life prompts before additional costs. Provided-life `validateLifePayment` and queued `getMaxPayableLife` pass `ctx` + `playerId`. |
| `gameActionsCastSpellFromHandForceFlash.ts` | Force of Will, flash/timing grants, Abundant Harvest choice. |
| `gameActionsRequestCastSpellNoTargetPayment.ts` | `requestCastSpellForSocket` no-target additional costs + mana payment queue. Pay-life consults `canPlayerPayLife`. |
| `gameActionsRequestCastSpellWithTargets.ts` | `requestCastSpellForSocket` with-target additional costs + `TARGET_SELECTION` (near ceiling — do not append). |
| `gameActionsCastSpellFromHandStackStamp.ts` | Stamp stack item after `applyEvent` (converge, haste, cavern, snow, additional cost). |
| `gameActionsRequestCastSpellCandidateZone.ts` | `requestCastSpellForSocket` timing, candidate lookup, and source-zone gates (CR 601.2a). |
| `gameActionsRequestCastSpellModes.ts` | Sorcery-speed gate, Gift, modes/X/Miracle/Madness/Mutate cost overrides (CR 601.2b). |
| `gameActionsRequestCastSpellTargets.ts` | Aura/target compute, forced Mutate, then with-targets `TARGET_SELECTION` queue (CR 601.2c). |
| `gameActionsCastSpellFromHandFront.ts` | `handleCastSpellFromHand` payload, priority, zone, land/chosen-name gates. |
| `gameActionsCastSpellFromHandStackPush.ts` | applyEvent stack push + verify, plus legacy `pushStack` fallback (CR 601.2i). |
| `gameActionsCastSpellFromHand.ts` | Leftover `handleCastSpellFromHand` orchestrator (prompts, RulesBridge/suspend, persist). Parent keeps a thin wrapper. |

### `interaction-handlers/` (extracted from `interaction.ts`)

| Module | Owns |
| --- | --- |
| `interactionTutorSearchCriteriaParsing.ts` | `detectTutorEffect`, `parseSearchCriteria`, `TutorInfo`, creature-type tables. |
| `interactionManaAbilityActivationShape.ts` | `resolveManaAbilityActivationShape` + any-color bonus queueing. |
| `interactionGraveyardCastCostAndTimingRules.ts` | Flashback/jump-start/retrace/escape/disturb cost + timing guards. |
| `interactionGraveyardSpellCastTargeting.ts` | Graveyard-cast stack card, aura restrictions, TARGET_SELECTION queue. |
| `interactionCyclingActivationDefinitions.ts` | Cycling / typecycling → activation definitions. |
| `interactionActivationEventPersistence.ts` | `activateBattlefieldAbility` / `activateGraveyardAbility` replay-event persistence. |
| `interactionGraveyardCastExecution.ts` | `finalizeGraveyardSpellCast` / `continueCastFromGraveyardAbility` (graveyard-zone spell-cast apply vs resume) plus encore helpers. |
| `interactionSpecialLandAndHideaway.ts` | `SPECIAL_LAND_ABILITIES` (hybrid/storage/animate/hideaway lands), `evaluateHideawayActivationCondition`, `WORD_TO_NUMBER`, `getLifePaymentForActivationCost`. |
| `interactionRoomAndBattlefield.ts` | `getBattlefield`, `EnsureInRoomAndSeated`. |
| `interactionExploreSocketHandlers.ts` | `beginExplore` / `beginBatchExplore`. |
| `interactionLibrarySearchSocketHandlers.ts` | `requestLibrarySearch` + search-restriction helpers. |
| `interactionGraveyardViewSocketHandlers.ts` | `requestGraveyardView`. |
| `interactionBulkTapUntapSocketHandlers.ts` | `bulkTapPermanentsForMana` / `untapPermanent`. |
| `interactionTapPermanentSocketHandlers.ts` | `tapPermanent`. |
| `interactionExchangeSacrificeSocketHandlers.ts` | `exchangeTextBoxes` / `sacrificePermanent`. |
| `interactionGraveyardAbilitySocketHandlers.ts` | `activateGraveyardAbility` (own leaf, near ceiling). |
| `interactionActivateBattlefieldAbilityContext.ts` | shared `activateCtx` type. |
| `interactionActivateEquipFortifyReconfigure.ts` | `tryHandleActivateEquipFortifyReconfigure`. |
| `interactionActivateCrewStation.ts` | `tryHandleActivateCrewStation`. |
| `interactionActivateMana.ts` | `tryHandleActivateMana`. |
| `interactionActivateCostPromptTapBlight.ts` | `tryHandleActivateCostPromptTapBlight`. |
| `interactionActivateCostPromptDiscardExileHand.ts` | `tryHandleActivateCostPromptDiscardExileHand` (near ceiling — do not append). |
| `interactionActivateSpecialLand.ts` | `tryHandleActivateSpecialLand` (hybrid/storage/animate/hideaway). |
| `interactionActivateFetchLand.ts` | `tryHandleActivateFetchLand`. |
| `interactionActivateSacrificeDraw.ts` | `tryHandleActivateSacrificeDraw`. |
| `interactionActivateGrantFightCounterTap.ts` | `tryHandleActivateGrantFightCounterTap`. |
| `interactionActivateLevelOutlastUpgrade.ts` | `tryHandleActivateLevelOutlastUpgrade`. |
| `interactionActivatePlaneswalker.ts` | `tryHandleActivatePlaneswalker`. Loyalty player/`any` lists use `canPlayerBeTargetedByPlayer`. |
| `interactionActivateSacrificeCostPrompt.ts` | `tryHandleActivateSacrificeCostPrompt`. |
| `interactionActivatePayLifeExileCounters.ts` | `tryHandleActivatePayLifeExileCounters`. |
| `interactionActivateBattlefieldAbilityHelpers.ts` | Shared activate helpers (`persistAbilityActivatedTriggerPushes`, `parseStationThreshold`, `applyXValueToText`, `extractActivatedAbilitiesFromText`, …). |
| `interactionReplacementAndCyclingSocketHandlers.ts` | Replacement-effect ordering + cycling sockets. |
| `interactionActivateBattlefieldAbilityParseSetup.ts` | `trySetupActivateBattlefieldAbilityParse`, `ActivateBattlefieldAbilityParseState` (cost/sacrifice/power-up/exhaust/timing/boast setup). Returns true on error (parent return). |
| `interactionActivateGenericAbilityState.ts` | `ActivateGenericAbilityMutationState`, `ActivateGenericAbilityExtras` (primitives copied back; arrays/objects mutate in place). |
| `interactionActivateGenericNonMana.ts` | `tryHandleActivateGenericNonMana` (stack, tutors, targeting). **34.8 KB** — do not append. |
| `interactionActivateGenericMana.ts` | `tryHandleActivateGenericMana` (immediate mana production). |
| `interactionActivateBattlefieldAbilityPersist.ts` | `applyActivateBattlefieldAbilityPersist` (bumpSeq, deferred costs, replay events). Runs after both generic branches. |

### `deck-handlers/` (extracted from `deck.ts`)

Public path stays `socket/deck.ts`. Leaves must not import `deck.ts` or the index. Never create `socket/deck/`. `registerDeckHandlers` stays a real function.

| Module | Owns |
| --- | --- |
| `deckImportConfirmState.ts` | `PendingConfirm`, `pendingImportConfirmations`, `toImportBufferCard`, `makeImportConfirmId`, `isSocketInGameRoom`, `canModifySavedDeck`, `cancelImportWipeConfirmResolutionSteps`. |
| `deckImportConfirmHelpers.ts` | Confirm broadcast/cancel, initial-draw flags, snapshot restore, transient-zone clear, `getActivePlayerIds`, `suggestCommanderNames`. |
| `deckImportResolutionSupport.ts` | `MIN_PRECON_DECK_SIZE`, `generateUniqueCardInstanceId`, `createDeckResolutionStatusReporter`, `enqueueImportWipeConfirmToResolutionQueue`. |
| `deckApplyConfirmedImport.ts` | `applyConfirmedImport`. |
| `deckImportDeckSocketHandlers.ts` | `registerImportDeckHandler`. |
| `deckUseSavedDeckSocketHandlers.ts` | `registerUseSavedDeckHandler`. |
| `deckImportPreconDeckSocketHandlers.ts` | `registerImportPreconDeckHandler`. |
| `deckImportDeckFromUrlSocketHandlers.ts` | `registerImportDeckFromUrlHandler`. |

### `join-handlers/` (extracted from `join.ts`)

Public path stays `socket/join.ts`. Leaves must not import `join.ts` or the index. Never create `socket/join/`. `registerJoinHandlers` stays a real function. Dual-copy: a smaller `defaultPlayerZones` / `ensureStateZonesForPlayers` remains in `util-handlers/playerStateZones.ts` — do not merge in a split.

| Module | Owns |
| --- | --- |
| `joinEnsureStateZones.ts` | `defaultPlayerZones`, `ensureStateZonesForPlayers` (join-local zone + intervening-if tracker seed). |

### `ai-handlers/` (extracted from `ai.ts`)

Public path stays `ai.ts`. Leaves must not import `ai.ts` or the index. Never create `socket/ai/`. `aiHandlerDeps.ts` is the injection seam if present. Choice/resolution leaves from Chat Q: `ai*ChoiceHandlers.ts`, `aiResolution*Steps.ts`, `aiPregameHandlers.ts`, `aiRegisterHandlers.ts`. See `ai-handlers/index.ts` for the full TOC.

| Module | Owns |
| --- | --- |
| `aiManaActivationHelpers.ts` | Indented mana/payment/activation helpers (`resolveAIPaymentManaAbilityId`, non-tap mana, battery color-fix). |
| `aiAbilityActivationSnapshot.ts` | Short `snapshotAIAbilityActivationState` only. |
| `aiSpellPaymentPlanHelpers.ts` | Spell-payment plan, sacrifice-for-mana, `canAIAssembleSpellPaymentPlan`, `chooseAISpellPaymentSelections`. |
| `aiPaymentSources.ts` | `getPaymentSources` plus top-level payment-source support helpers. |
| `aiActionCandidateTypes.ts` | Action-candidate type aliases. |
| `aiPriorityHandlers.ts` | `handleAIPriority`. |
| `aiFindCastableSpells.ts` | `findCastableSpells`. |
| `aiLandTapHandlers.ts` | Mana-retention land tapping. |
| `aiLandPlayHandlers.ts` | Shock/bounce helpers, `executeAIPlayLand`, `handleBounceLandETB`. |
| `aiActivateAbilityHandlers.ts` | `executeAIActivateAbility`, mana-battery charge-invest predicate. |
| `aiActivatedAbilityResolver.ts` | Ability-id resolution, `didAIAbilityActivationProgress`, shared battlefield activation request. |
| `aiSpellPriority.ts` | `calculateSpellPriority`. |
| `aiActionCandidateHandlers.ts` | Enumeration, mana-payment plan, response-window actions. |
| `aiLandAuraCommander.ts` | Playable-land lookup, aura targeting, `findCastableCommander`, failed-cast memory. |
| `aiSharedCastLand.ts` | `requestAISharedCast`, `requestAISharedLandPlay`. |
| `aiMayRevealHandWinChoiceHandlers.ts` | Reveal if `playerOwnsNamedCardInFourWinZones`, else decline. Entry: `chooseAIMayRevealHandWinIfOwnNamedSelection`. |

### `registry-handlers/` (extracted from `registry.ts`)

Public path stays `state/planeswalker/templates/registry.ts`. Folder is `templates/registry-handlers/` — not `templates/resolve-handlers/`. Leaves must not import `registry.ts` or the index. Never create `templates/registry/`.

| Module | Owns |
| --- | --- |
| `planeswalkerTemplateDrawExileLookRegexes.ts` | Draw / exile-top / look-at-top / discard-draw loyalty regex tables. Breadcrumb: `DRAW_SELF_REGEXES`. |
| `planeswalkerTemplateDamageDestroyEmblemRegexes.ts` | Damage / destroy / emblem / mill / targeted-pump regex tables. |
| `planeswalkerTemplatePumpHandCounterManaRegexes.ts` | Creature-pump / put-from-hand / counters / mana regex tables. |
| `planeswalkerTemplateControlSearchNamedDamageRegexes.ts` | Control / fight / library-search / named-damage regex tables. |
| `planeswalkerTemplateMatchDrawExileSearch.ts` | First matcher if-chain. Entry: `tryMatchPlaneswalkerTemplateDrawExileSearch`. |
| `planeswalkerTemplateMatchLookDraftPerpetual.ts` | Search / look / draft / perpetual if-chain. Entry: `tryMatchPlaneswalkerTemplateLookDraftPerpetual`. |
| `planeswalkerTemplateMatchPumpLifeCreate.ts` | Pump / life / create-token mid-chain. Entry: `tryMatchPlaneswalkerTemplatePumpLifeCreate`. |
| `planeswalkerTemplateMatchControlFightNamedDamage.ts` | Control / fight / named-damage late-chain. Entry: `tryMatchPlaneswalkerTemplateControlFightNamedDamage`. |

### `apply-event-handlers/` (extracted from `applyEvent.ts`)

Family dispatch in the parent: `if (applyXEvents(ctx, e)) return;`. `activateBattlefieldAbility` is split: cost replay → `applyEventActivateBattlefieldAbilityCostReplay.ts`, stack rebuild → `applyEventActivateBattlefieldAbilityStackReplay.ts`, wrapper + leftover `cascadeResolve` → `applyEventActivateBattlefieldAbilityEvents.ts`. See `apply-event-handlers/index.ts` for the full named TOC (lobby, commander/counters/damage, stack, cast, combat, mana, activations, choices, dungeon/vote, attachments, …). Divine/Prisoner choice+batch (`applyEventDungeonVoteEvents.ts`) call `maybeResumeDeferredOracleIrStackSpell` after the queue empties. GY-cast stack flags and stale `graveyard_selection` cleanup live in `applyEventCastSpellEvents.ts` / `applyEventReflexivePromptEvents.ts` / `applyEventStackCoreEvents.ts` with `stackReplayUtils.ts`.

### `util-handlers/` / `turn-handlers/` / `combat-handlers/` / `undo-handlers/` / `oracleIrServerZoneSync-handlers/`

| Module | Left | Owns |
| --- | --- | --- |
| `util-handlers/manaColorConstants.ts` | `socket/util.ts` | `MANA_COLOR_NAMES` / `MANA_COLORS` / `MANA_COLOR_KEYS` / `getManaColorName`. |
| `util-handlers/manaPoolStateOperations.ts` | `socket/util.ts` | Pool accessors, retention, phase-end drain, clears, totals, `validateManaPayment`. |
| `util-handlers/manaProvenanceLowerBounds.ts` | `socket/util.ts` | Treasure / creature-spell-haste / per-permanent-source provenance lower bounds. |
| `util-handlers/manaRestrictedPoolOperations.ts` | `socket/util.ts` | Restricted mana pool entries, doesn’t-empty flags, totals including restricted, `RestrictedManaSpendPurpose` / `canUseRestrictedMana`, floating `__pool__:` payment helpers. |
| `util-handlers/calculateManaProduction.ts` | `socket/util.ts` | Dispatcher: land/basic → dynamic → creature power → storage/battery → bonuses/total. |
| `util-handlers/tryCalculateManaProductionLandBasic.ts` (and Dynamic / CreaturePower / StorageBattery / BonusesAndTotal) | `socket/util.ts` | Ability-family runs of `calculateManaProduction`. |
| `turn-handlers/pendingDelayedTriggerDequeues.ts` | `state/modules/turn.ts` | Drain `state.pending*` delayed schedules at step boundaries. |
| `turn-handlers/turnStepCleanup.ts` | `state/modules/turn.ts` | Cleanup-step body from `nextStep()`: discard-to-hand-size, Sundial pause, Rule 514.2 damage clear, until-end-of-turn expiry including `lastingEffects.protectionKeywordOverride` and this-turn `preventLifeGain`. Rest-of-game `preventLifeGain` (`duration: 'game'`) stays. Entry: `runTurnStepCleanup`. |
| `turn-handlers/turnStepUpkeep.ts` | `state/modules/turn.ts` | Upkeep-step body from `nextStep()`: delayed upkeep dequeues, initiative venture, cumulative upkeep mana, suspend, rebound, beginning-of-upkeep triggers. Entry: `runTurnStepUpkeep`. |
| `turn-handlers/turnExpiredUntilNextTurnEffects.ts` | `state/modules/turn.ts` | `removeExpiredUntilNextTurnEffects` at next-turn start. Also drops until-next-turn `staticAbilityGrantEffects` / grant bags when `turnApplied` is earlier than the controller’s current turn. |
| `combat-handlers/combatLegalityGates.ts` | `socket/combat.ts` | `isCurrentlyCreature`, attack/block legality, temporary combat restriction texts. |
| `combat-handlers/combatDeclareBlockersRequest.ts` | `socket/combat.ts` | `handleDeclareBlockers`; declare-blockers chat; battlefield name lookup; `persistTriggeredAbilityPush`. Wires `findMustBeBlockedIfAbleViolation`. |
| `combat-handlers/combatMustBeBlockedIfAble.ts` | `socket/combat.ts` | Derived lure grants: `all_able_creatures_must_block` vs `must_be_blocked_if_able`, plus typed `must_be_blocked_by_<keyword>`. Skip illegal only when a legal (keyword) blocker is unused. Human declare, skip, and AI empty `[]` share `findMustBeBlockedIfAbleViolation`. |
| `combat-handlers/combatDeclareAttackersSupport.ts` | `socket/combat.ts` | Declare-attackers chat; defender-id resolution; owner-attack restriction predicates; optional attack-trigger mana/energy payment (`resolveAttackTriggerManaPaymentChoice`); `processAttackTriggersAfterDeclaration`. |
| `nearestOpponentDirectionAttackRestriction.ts` | `state/modules/` (combat) | Generic until-next-turn “nearest opponent in chosen direction” attack lock (Teyo −2 oracle). Battles legal only if locked opponent is protector/defending player. Entries: `parseNearestOpponentDirectionAttackLock`, `getNearestOpponentInChosenDirection`, `getNearestOpponentDirectionAllowedDefenderId`, `getNearestOpponentDirectionAttackViolation`. Wired from declare-attackers request/execute/force-tap. |
| `combat-handlers/combatDeclareAttackersForceTapSupport.ts` | `socket/combat.ts` | Exert/enlist enqueue, goad status, forced-attack check, tap-on-attack triggers. |
| `combat-handlers/combatDeclareAttackersExecute.ts` | `socket/combat.ts` | `executeDeclareAttackers` (AI / paid-attack / resolution-queue path). |
| `combat-handlers/combatControlState.ts` | `socket/combat.ts` | `getCombatControl` / `setCombatControl`. |
| `combat-handlers/combatDeclareAttackersRequest.ts` | `socket/combat.ts` | `handleDeclareAttackers`. |
| `combat-handlers/combatDeclareControlledAttackersRequest.ts` | `socket/combat.ts` | `handleDeclareControlledAttackers`. |
| `undo-handlers/undoBoundaryPlanning.ts` | `socket/undo.ts` | Semantic action counting, boundary keys/snapshots/history, smart undo counts. |
| `undo-handlers/undoTurnPhaseTargets.ts` | `socket/undo.ts` | Earlier turn/phase/step jump targets. Entries: `listUndoTurnPhaseTargets`, `resolveUndoToTurnPhaseCount`. |
| `oracleIrServerZoneSync-handlers/oracleIrServerPostExecutionStateSync.ts` | `oracleIrServerZoneSync.ts` | Post-IR mirroring: GY→exile provenance, copy-token, prepared, linked exiles, reanimation, EOT token sacrifice/exile, impulse draws, temp abilities / P/T. After `create_token`, mirrors except-copy `grantedAbilities` into `pendingSacrificeAtNextEndStep` / haste `tempAbilities`. Stamps `turnApplied` on until-next-turn `staticAbilityGrantEffects` / grant bags. |
| `oracleIrServerZoneSync-handlers/oracleIrServerLibrarySearchLookChoosePilePrompts.ts` | `oracleIrServerZoneSync.ts` | Look-choose / search-library / choose-pile prompt builders. SPELL_PRIMARY=1 `look_select_top` dest=`library_top` reorder-all queues `PONDER_EFFECT` (Ponder/Index). `nonMatchRest: 'graveyard'` (Genesis Wave) puts only selectable permanents in `availableCards`; look-at-then-battlefield rest-bottom (Loot) keeps the full looked slice in `availableCards` plus `nonSelectableCards`. |
| `oracleIrServerZoneSync-handlers/oracleIrServerVoteJoinForcesPrompts.ts` | `oracleIrServerZoneSync.ts` | JOIN_FORCES / VOTE prompt queues. Entries: `queueJoinForcesPromptsFromOracleIRResult`, `queueVotePromptsFromOracleIRResult`. |
| `oracleIrServerZoneSync-handlers/oracleIrServerChoiceFamilyPrompts.ts` | `oracleIrServerZoneSync.ts` | IR-primary queues for `each_player_choose_then_destroy_rest` / `secret_opponent_choice_damage` / `may_cast_from_among` onto existing TARGET_SELECTION / secret OPTION_CHOICE / GRAVEYARD_SELECTION. Divine/Prisoner go through `oracleIrServerChooseDestroyRestSecretDamagePrompts.ts`. Optional mill-from-among (Summons) stays GRAVEYARD_SELECTION — Effect Program `OPTIONAL_NO_CHOICE_KINDS` skips Yes/No. Also queues Reveal/Decline OPTION_CHOICE for `may_reveal_hand_then_win_if_own_named_in_zones`. |
| `oracleIrServerZoneSync-handlers/oracleIrServerTapUntapChoicePrompts.ts` | `oracleIrServerZoneSync.ts` | TAP_UNTAP_TARGET queues for tap-or-untap and tap-matching-permanents. |
| `oracleIrServerZoneSync-handlers/oracleIrServerExplorePopulateChangeTargetPrompts.ts` | `oracleIrServerZoneSync.ts` | Explore / populate / change-target queues. |
| `oracleIrServerZoneSync-handlers/oracleIrServerImpulseDiscoverGyPermissionPrompts.ts` | `oracleIrServerZoneSync.ts` | GY-cast permission, impulse-exile play, discover cast-or-hand. |
| `oracleIrServerZoneSync-handlers/oracleIrServerCopyPermanentMoveZonePrompts.ts` | `oracleIrServerZoneSync.ts` | Copy-permanent + move-zone queues. |
| `oracleIrServerZoneSync-handlers/oracleIrServerZoneDraftPilesChaosPrompts.ts` | `oracleIrServerZoneSync.ts` | Repeated-zone-draft, separate-into-piles, library-chaos. |
| `oracleIrServerZoneSync-handlers/oracleIrServerOptionalStepChoicePrompts.ts` | `oracleIrServerZoneSync.ts` | Optional-step queue + optional life-payment helpers. |
| `oracleIrServerZoneSync-handlers/oracleIrServerPendingContinuationAndCostReduction.ts` | `oracleIrServerZoneSync.ts` | Unqueued continuation persist + next-spell cost reduction. |
| `oracleIrServerZoneSync-handlers/oracleIrServerUnlessPayChoicePrompts.ts` | `oracleIrServerZoneSync.ts` | UNLESS_PAY choice queues. |
| `oracleIrServerZoneSync-handlers/oracleIrServerManaCounterChoicePrompts.ts` | `oracleIrServerZoneSync.ts` | Add-mana, add-counter target, counter-distribution. |
| `oracleIrServerZoneSync-handlers/oracleIrServerConnivePlayerChoicePrompts.ts` | `oracleIrServerZoneSync.ts` | Connive / player-choice / pending-discard. |
| `oracleIrServerZoneSync-handlers/oracleIrServerLandFromHandPrompts.ts` | `oracleIrServerZoneSync.ts` | Controller / each-player / both-players land-from-hand. |
| `oracleIrServerZoneSync-handlers/oracleIrServerDiscardProliferatePrompts.ts` | `oracleIrServerZoneSync.ts` | Discard + proliferate queues. |
| `oracleIrServerZoneSync-handlers/oracleIrServerLifeFlipCoinPrompts.ts` | `oracleIrServerZoneSync.ts` | Redistribute life + flip-coin life stakes. |
| `oracleIrServerZoneSync-handlers/oracleIrServerZoneHydrateDelayedBridges.ts` | `oracleIrServerZoneSync.ts` | Hydrate/sync zones, delayed flicker/draw, `syncAllOracleIRPlayerZonesAfterResolution`. |
| `oracleIrServerZoneSync-handlers/oracleIrServerMillCounterPreparedSync.ts` | `oracleIrServerZoneSync.ts` | Mill replacement, counter replacement, prepared-copy sync. |
| `oracleIrServerZoneSync-handlers/oracleIrServerApplyDeps.ts` | `oracleIrServerZoneSync.ts` | Sacrifice trampoline + `bindQueueSacrificeChoicePromptsFromOracleIRResult`. |
| `oracleIrServerZoneSync-handlers/oracleIrServerApplyOnServer.ts` | `oracleIrServerZoneSync.ts` | `applyOracleIRStepsOnServer`. Imports PostExecutionStateSync directly, not the index. |
| `oracleIrServerZoneSync-handlers/oracleIrServerResumeAndChoiceApply.ts` | `oracleIrServerZoneSync.ts` | Sacrifice queue, unless-discard/pay resume, remaining-steps resume, choice apply. |
| `oracleIrServerZoneSync-handlers/oracleIrServerAnyPlayerMayPrompts.ts` | `oracleIrServerZoneSync.ts` | Any-player-may parse/queue/resume. |

### `targeting-handlers/` (extracted from `targeting.ts`)

Public path stays `targeting.ts`. Leaves must not import `targeting.ts` or the index. Never create `targeting/` beside `targeting.ts`. `categorizeSpellWithoutPrimaryRetirement` keeps the exported dispatcher: normalize oracle, suppress exile/counter-all-spells, then `tryCategorize…` (`null` = fall through). IR-primary live cast targeting does **not** call it — see `gameActionsCastSpellParsedTargeting.ts` and `target-availability.ts`. Categorize remains for tests and `ORACLE_IR_SPELL_PRIMARY=0`.

| Module | Owns |
| --- | --- |
| `targetingSpellSpecTypes.ts` | `SpellOp`, `SpellSpec`, filters/restrictions. `StatRequirement.orStat` for compound power-or-toughness. |
| `targetingCategorizeCountUtils.ts` | `parseCountWord`, `titleCaseWords`. |
| `targetingCategorizePermanentFilter.ts` | `detectCategorizePermanentFilter`. |
| `targetingParseTargetRequirements.ts` | `parseTargetRequirements`, `matchesGraveyardCardTargetType`, `requiresTargeting`, `GroupedTargetRequirement`. Comma/or multi-type lists (Atraxa's Fall). Attaches `targetRestriction` / `statRequirement` / `creatureRestriction` from the sibling. |
| `targetingParseTargetRequirementRestrictions.ts` | SpellSpec-aligned `has_keyword` / power-toughness / tapped-untapped / attacked-blocked / entered / damage-this-turn / active-player plus compound `orStat` for IR-primary lists. Matcher takes optional caster id. Public: `parseTargetRequirementStatKeywordFilters`, `stripTargetTypeRestrictionSuffix`, `attachParsedTargetRequirementStatKeywordFilters`, `permanentMatchesTargetRequirementStatKeywordFilters`. |
| `targetingCategorizeStackCounterSimpleTemplates.ts` | Stack/counter/simple templates. |
| `targetingCategorizeScryMillMassRemoval.ts` | Scry/mill/mass-removal templates. |
| `targetingCategorizeDamageFlickerRestrictions.ts` | Damage/flicker/restriction templates. |
| `targetingCategorizeTapBounceGenericTargets.ts` | Tap/bounce/generic-target templates. |
| `targetingProtectionKeywordStaticOverride.ts` | Lose vs as-though hexproof (`protectionKeywordIgnoredForTargeting`, `protectionKeywordIgnoredForPlayerTargeting`). Archetype global lose; Spotlight controller-only creatures; Nowhere to Run every player; Kaya opponent permanents + `player_opponents`. `asThoughAbilitySuppressedForTarget` skips ward when `asThoughNoAbilities` lists `'ward'`. Until-EOT `lastingEffects.protectionKeywordOverride` (Detection Tower as-though / Arcane Lighthouse lose). |
| `targetingPlayerProtectionKeyword.ts` | `canPlayerBeTargetedByPlayer`. Wired in `evaluateTargeting`, cast-time lists, copy-retarget fallback, activation player lists (`buildActivatedAbilityValidTargets`, generic non-mana, planeswalker loyalty). Until-EOT Detection Tower player as-though uses `lastingEffects.protectionKeywordOverride`. |

### `staticEffects-handlers/` (extracted from `staticEffects.ts`)

Public path stays `staticEffects.ts`. Leaves must not import `staticEffects.ts` or the index. Never create `staticEffects/` beside `staticEffects.ts`. `computeContinuousEffects` keeps the exported dispatcher: init + hexproof/anthems/ability grants/chosen-type-color/global type-additions, then `applyMonumentLordAndSharedTypeEffects` for the monument/lord/shared-type phase.

| Module | Owns |
| --- | --- |
| `staticEffectsKnownCards.ts` | `KNOWN_STATIC_EFFECT_CARDS` emptied leftover re-export; unused by `computeContinuousEffects`. Behavior is oracle `StaticEffectSpec`. |
| `staticEffectsScanHelpers.ts` | Parse/battlefield helpers plus `EffectAggregate` / `ContinuousEffectResult`. Entries: `COLOR_WORDS`, `parseCardCountWord`, `parseBuffSegment`, `resolveGrantedAbilities`, `isCreature`, `isLegendaryCreature`, `isColor`, `creatureHasManaColor`, `hasCreatureType`, `countOtherCreaturesSharingType`, `permanentCountsForControlTypeCondition`, `CREATURE_TYPES`, `GLOBAL_TYPE_ADDITIONS`. |
| `staticEffectsMonumentLordAndSharedType.ts` | Monument + creature-type lord + nonblack/nonhuman + Coat of Arms + Sliver Legion phase. Entry: `applyMonumentLordAndSharedTypeEffects`. |

### `game-state-effects-handlers/` (extracted from `game-state-effects.ts`)

Public path stays `game-state-effects.ts` (re-export barrel). Leaves must not import the parent or the index. Never create `game-state-effects/` beside `game-state-effects.ts`. Dual-copy: `WinCondition` in `triggers/win-conditions.ts` is a different type (game-result) — do not merge.

| Module | Owns |
| --- | --- |
| `gameStateEffectsBattlefieldQueries.ts` | Phased-out-aware battlefield queries (creature count, devotion). |
| `gameStateEffectsReplacementApply.ts` | 616.1 replacement order, detect, and apply (damage/life/counters/tokens/mill). |
| `gameStateEffectsAbilityConditions.ts` | Metalcraft / threshold / delirium / coven / `getActiveAbilityConditions`. |
| `gameStateEffectsTokenSubtype.ts` | Treasure / artifact token subtype checks. |
| `gameStateEffectsWinConditionOraclePatterns.ts` | Oracle-pattern “you win the game” scanner (upkeep / end-step / Thassa / then-if / state-trigger). Maze's End unique-name win and Approach same-name-cast-this-game are IR, not this scan. Hedron Alignment may-reveal is not auto-scanned. Rules-engine adapter: `stateBasedActionsOracleScannerWins.ts`. |
| `gameStateEffectsWinConditionStateTriggerThenIf.ts` | State-trigger counter wins (`immediate`); then-if / compound intervening-if; same-name / different-name tribe counts. Rules-engine `checkWinConditions` and live `runSBA` dispatch `immediate`. Upkeep scanner stays on `turnActions`. |
| `gameStateEffectsLifeModifierOraclePatterns.ts` | Oracle-pattern life restrictions + ReplacementEffectSpec life-gain/life-loss collect/apply. No `LIFE_MODIFIERS` name table. Teferi's Protection uses `playerProtection.lifeCannotChange`. Wound Reflection is an end-step trigger. Bloodletter doubles via `life-loss` specs. `detectLifeModifiers` / `canGainLife` also honor `lastingEffects.preventLifeGain` this-turn stamps. |
| `gameStateEffectsWinLose.ts` | Win / lose / can't-lose, empty-library draw, ascend. `checkImmediateWinConditions` (Darksteel-style) re-exported from `game-state-effects.ts`. Re-exports life-modifier helpers from `gameStateEffectsLifeModifierOraclePatterns.ts`. |
| `gameStateEffectsLandPlayDraw.ts` | Additional land drops, temporary land bonuses, additional draws. |
| `gameStateEffectsTopLibrary.ts` | Top-of-library look/play/cast, `recalculatePlayerEffects`. |
| `gameStateEffectsMillDamage.ts` | Combat mill replacements, modified damage, `applyCombatDamageReplacement`. |

### `mana-abilities-handlers/` (extracted from `mana-abilities.ts`)

Public path stays `mana-abilities.ts`. Leaves must not import `mana-abilities.ts` or the index. Never create `mana-abilities/` beside `mana-abilities.ts`. Dual-copy: leftover `calculateDevotion` / `getDevotionManaAmount` differ from `triggers/devotion.ts` — do not merge.

| Module | Owns |
| --- | --- |
| `manaAbilityLandTypeModifiers.ts` | `ManaAbility` / `ManaModifier`, basic-land-type helpers, `KNOWN_MANA_MODIFIERS`, `detectManaModifiers`, `getEffectiveBasicLandTypes`. |
| `manaAbilityColorRestrictionUtils.ts` | Chosen-color, Mox Amber, spend-restriction, power-threshold, commander identity, opponent-land colors; exclusive helpers for `getManaAbilitiesForPermanent`. |
| `manaAbilitiesForPermanent.ts` | `getManaAbilitiesForPermanent`. |

### `mana-check-handlers/` (extracted from `mana-check.ts`)

Public path stays `mana-check.ts`. Leaves must not import `mana-check.ts` or the index. Never create `mana-check/` beside `mana-check.ts`.

| Module | Owns |
| --- | --- |
| `manaCheckActivationGate.ts` | `canCountPermanentManaAbilities` (metalcraft / threshold gate). |
| `manaCheckPaymentTypes.ts` | `PHYREXIAN_LIFE_COST`, `ParsedManaCost`, `NormalizedManaPaymentModel`. |
| `manaCheckOracleText.ts` | `stripReminderTextFromOracle`. |
| `manaCheckSimplePool.ts` | `getEmptyManaPool`, `getManaPoolFromState`, `SIMPLE_MANA_KEYS`, exact-source types, simple-pool arithmetic. |
| `manaCheckRemoveCounterCost.ts` | Self-remove-counter parse and permanent counter budgets. |
| `manaCheckCostedTapFilter.ts` | `filterOutCostedTapMatches`. |
| `manaCheckPermanentColors.ts` | `getOpponentPermanentColors`, `getControlledPermanentColors`. |
| `manaCheckAvailableMana.ts` | `getAvailableMana`. |
| `manaCheckParseManaCost.ts` | `parseManaCost`, `normalizeParsedManaCost`, `stringifyParsedManaCost`. |
| `manaCheckScalingExactOptions.ts` | `buildScalingManaExactOptions`. |
| `manaCheckAbilityCostParsers.ts` | Hand / life / return-to-hand mana-ability cost parsers. |
| `manaCheckExactSources.ts` | Non-tap, battery color-fix, spend, produced-mana, `buildExactManaSources`. **34.6 KB** — do not append. |
| `manaCheckCanPayManaCost.ts` | `getTotalManaFromPool`, `canPayManaCost`, `getMaxXValue`. |
| `manaCheckCanPayWithSources.ts` | `canPayManaCostWithAvailableSources`, `getPlayerLifeTotal`. |

Later handler folders (AutomationService through replacementEffectSpec) live in
[`docs/mtg-logic-module-map-extract-families-handlers-late.md`](mtg-logic-module-map-extract-families-handlers-late.md).
