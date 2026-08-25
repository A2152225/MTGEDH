# MTG logic module map — socket resolution

Peeled from `docs/mtg-logic-module-map.md` (`## Socket resolution`).
Coordinator owns this file. Extract chats must not edit it — paste owed rows.

## Socket resolution

- Public barrel: `server/src/socket/resolution.ts` (**39.2 KB**, under ceiling). Remaining cores: `handleAIResolutionStep`, `initializeAIResolutionHandler`, `initializePriorityResolutionHandler`, `applyResolutionStepSideEffects`, plus AI library-chaos helpers. `handleStepResponse` / `handleTargetSelectionResponse` / `handleOptionChoiceResponse` / `registerResolutionHandlers` / `sanitizeStepForClient` live in `resolution-handlers/` (parent re-exports the last three).
- Runtime seam: `server/src/socket/resolutionHandlerDeps.ts` — `ResolutionHandlerDeps` / `createResolutionHandlerDeps` / `getResolutionHandlerDeps`. Extracted handlers are injected here; **extracted files must not import `resolution.ts`**.
- Internal TOC: `server/src/socket/resolution-handlers/index.ts` (named re-exports only).
- Pre-complete validation is split across siblings (do not append to a near-ceiling file):
  - `resolutionRegisterPreCompleteValidationForExtractedSteps.ts` — older extracted step types
  - `resolutionRegisterPreCompleteValidationForStepResponseClusters.ts` — explore / fight / tap-untap / counters / station / mana-color / phyrexian
  - `resolutionRegisterPreCompleteValidationForZoneSelectionSteps.ts` — discard, hand-to-bottom, graveyard, library search
  - `resolutionRegisterPreCompleteValidationForChoicePromptSteps.ts` — X, Kynaios, hideaway, devour, player choice, …
  - `resolutionRegisterPreCompleteValidationForModeAndTriggerSteps.ts` — MODE_SELECTION, TRIGGER_ORDER, OPENING_HAND_ACTIONS
  - `resolutionRegisterPreCompleteValidationForOptionChoiceSteps.ts` — OPTION_CHOICE shape + pay-cost prompts
  - `resolutionRegisterPreCompleteValidationForCostPaymentSteps.ts` — LIFE_PAYMENT, ADDITIONAL_COST_PAYMENT, SQUAD_COST_PAYMENT
  - `resolutionRegisterPreCompleteValidationForManaAndSacrificeSteps.ts` — MANA_PAYMENT_CHOICE, tap-cost, EXTORT, EXPLOIT
  - `resolutionRegisterPreCompleteValidationForTargetSelectionSteps.ts` — TARGET_SELECTION / MUTATE_TARGET_SELECTION
  - `resolutionRegisterPreCompleteValidationForActivationCostSteps.ts` — tap-other / discard / exile / sacrifice / blight as cost
- The 35 existing flat `resolution*.ts` siblings stay put until a dedicated move PR.

| Module (flat sibling, `server/src/socket/`) | Owns |
| --- | --- |
| `resolutionActivatedAbilityResponseHandlers.ts`, `resolutionActivatedAbilityTargetingUtils.ts` | Activated-ability responses and their target filtering *(exports TBD)* |
| `resolutionCascadeDanceDevourSuspendMorphResponseHandlers.ts` | Cascade / dance / devour / suspend / morph responses *(exports TBD)* |
| `resolutionColorTypeNameChoiceResponseHandlers.ts` | Color / type / card-name choices *(exports TBD)* |
| `resolutionCommanderZoneResponseHandlers.ts` | Commander zone-change prompts *(exports TBD)* |
| `resolutionDiscardResponseCoreHandlers.ts`, `resolutionDiscardActivationResumeHandlers.ts`, `resolutionDiscardTriggerUtils.ts` | Discard: apply core, activation resume, trigger utils (phase split example) *(exports TBD)* |
| `resolutionGraveyardSelectionApplyHandlers.ts` (39.9 KB), `resolutionGraveyardSelectionResumeHandlers.ts`, `resolutionGraveyardSelectionHelperUtils.ts` | Graveyard selection: apply vs resume phase split *(exports TBD)* |
| `resolutionHideawayZoneDraftPermanentChoiceResponseHandlers.ts` | Hideaway / zone draft / permanent choice *(exports TBD)* |
| `resolutionJoinForcesTemptingOfferResponseHandlers.ts`, `resolutionJoinForcesTemptingZoneChoiceResponseHandlers.ts` | Join forces and tempting offer *(exports TBD)* |
| `resolutionKeywordChoiceHandlers.ts` (35.6 KB) | Keyword choices *(exports TBD)* |
| `resolutionLibrarySearchHandlers.ts`, `resolutionLibrarySearchStepUtils.ts`, `resolutionLibrarySearchOracleIrChoiceResume.ts`, `resolutionLibrarySearchOracleIrResumeUtils.ts`, `resolutionLibraryLookResponseHandlers.ts` | Library search / look, including Oracle IR resume (leaf-import example) *(exports TBD)* |
| `resolutionModalChoiceResponseHandlers.ts` | Modal choices *(exports TBD)* |
| `resolutionOptionChoiceEarlySpecialsPrefixHandlers.ts` (39.5 KB), `resolutionOptionChoiceEarlySpecialsConfirmCastPaymentHandlers.ts` (36.9 KB) | Early `handleOptionChoiceResponse` specials; try-handle boolean prefix pattern *(exports TBD)* |
| `resolutionPaymentManaUtils.ts`, `resolutionWardUtils.ts` | Mana payment and ward helpers *(exports TBD)* |
| `resolutionProcessPendingHandlers.ts` | Pending-resolution processing *(exports TBD)* |
| `resolutionPutCardOntoBattlefieldUtils.ts`, `resolutionCloneQueuedPromptUtils.ts`, `resolutionStepTypeSpecificFieldsUtils.ts`, `resolutionSyntheticCastSocketUtils.ts` | Shared step/prompt utilities *(exports TBD)* |
| `resolutionScrySurveilResponseHandlers.ts` | Scry / surveil *(exports TBD)* |
| `resolutionVoteProliferateLimDulResponseHandlers.ts` | Vote / proliferate / Lim-Dûl *(exports TBD)* |

### `resolution-handlers/` (extracted from `resolution.ts`)

Internal TOC: `server/src/socket/resolution-handlers/index.ts`. Leaves must not import `resolution.ts` or the index.

| Module | Owns |
| --- | --- |
| `exploreDecisionResponseHandlers.ts` | EXPLORE_DECISION / BATCH_EXPLORE_DECISION. Entries: `handleExploreDecisionResponse`, `handleBatchExploreDecisionResponse`. |
| `fightTargetResponseHandlers.ts` | FIGHT_TARGET. Entry: `handleFightTargetResponse`. |
| `tapUntapTargetResponseHandlers.ts` | TAP_UNTAP_TARGET plus tap-another-permanent as cost. Entry: `handleTapUntapTargetResponse`. |
| `counterManipulationResponseHandlers.ts` | COUNTER_MOVEMENT / COUNTER_TARGET / COUNTER_DISTRIBUTION. |
| `stationCreatureSelectionResponseHandlers.ts` | STATION_CREATURE_SELECTION. |
| `lifePaymentResponseHandlers.ts` | LIFE_PAYMENT then resume captured cast. |
| `manaColorSelectionResponseHandlers.ts` | MANA_COLOR_SELECTION (distribution, Treasure provenance, deferred activation costs). |
| `resolutionManaPaymentApplication.ts` | Shared mana-payment appliers: `extractResolutionPaymentItems`, ward apply/validate, `applySelectedManaPaymentForResolutionCost`. |
| `manaPaymentChoicePrefixHandlers.ts` | MANA_PAYMENT_CHOICE ward / sacrifice-unless-pay prefix. Entry: `tryHandleManaPaymentChoiceWardAndSacrificePrefix`. |
| `manaPaymentChoiceActivationHandlers.ts` | MANA_PAYMENT_CHOICE activation-payment branch. Entry: `tryHandleManaPaymentChoiceActivation`. |
| `manaPaymentChoicePhyrexianHandlers.ts` | MANA_PAYMENT_CHOICE Phyrexian tail. Entry: `handleManaPaymentChoicePhyrexianActivation`. |
| `manaPaymentSpellCastResponseHandlers.ts` | MANA_PAYMENT_CHOICE spell-cast payment. Entry: `handleSpellPaymentChoiceResponse`. |
| `modeSelectionCastResumeHandlers.ts` | MODE_SELECTION modal/spree/tiered/overload cast resume. |
| `modeSelectionGenericChoiceHandlers.ts` | MODE_SELECTION generic pick + target recomputation. |
| `modeSelectionTargetOptionBuilders.ts` | Mode-aware target option/spec builders. |
| `additionalCostPaymentResponseHandlers.ts` | ADDITIONAL_COST_PAYMENT (discard/sacrifice/reveal/behold/teamwork). |
| `squadCostPaymentResponseHandlers.ts` | SQUAD_COST_PAYMENT. |
| `resolutionCounterRemovalPaymentSelection.ts` | Counter-removal cost parse/validate shared with pre-complete. |
| `resolutionPendingCastPaymentPrompt.ts` | Pending-cast payment prompt builders (`emitPendingCastPaymentIfNeeded`, …). |
| `targetSelectionSacrificeAbilityCostHandlers.ts` | Sacrifice permanents as activation cost. |
| `targetSelectionActivationCostPaymentHandlers.ts` | Remove-counters / return-to-hand as cost. |
| `targetSelectionBattlefieldAbilityHandlers.ts` | Equip / fortify / reconfigure continuation. |
| `targetSelectionBlightKeywordHandlers.ts` | Blight N as cost. Entry: `handleBlightKeywordTargetSelection`. |
| `targetSelectionWardPromptHandlers.ts` | Post-pass ward payment prompts. Entry: `maybeQueueWardPaymentPromptsForTargetSelection`. |
| `targetSelectionSacrificeFollowupHandlers.ts` | Sacrifice-then-benefit TARGET_SELECTION. |
| `targetSelectionGraveyardCastHandlers.ts` | Cast-from-graveyard continuations. |
| `targetSelectionScavengeAndCopyHandlers.ts` | Scavenge + become-a-copy. |
| `targetSelectionImmediateBattlefieldActions.ts` | `step.action` battlefield chain (soulbond, destroy, tap-or-untap, …). |
| `targetSelectionGraveyardCardActions.ts` | `step.action` GY card moves. |
| `targetSelectionSpellCastPaymentHandlers.ts` | Auto-unignore + CR 601.2h payment request. |
| `targetSelectionPlaneswalkerAndSoldierHandlers.ts` | Soldier Program counters + planeswalker loyalty. |
| `targetSelectionTapCostAndAttachHandlers.ts` | Tap-creatures-as-cost + attach Equipment. |
| `targetSelectionCrewAndEnlistHandlers.ts` | Crew + Enlist. |
| `targetSelectionDungeonRoomHandlers.ts` | Dungeon room sacrifice / creature effects. |
| `targetSelectionExertAndCopyRetargetHandlers.ts` | Exert reward + copy retarget. |
| `targetSelectionTriggeredAbilityTargetHandlers.ts` | Triggered-ability and damage-received targets. |
| `targetSelectionNonStackChoiceHandlers.ts` | Divine Reckoning, Grave Pact sacrifice, opponent selection. |
| `targetSelectionCancellationHandlers.ts` | Cancelled TARGET_SELECTION (ward / Blight / activation abort). |
| `targetSelectionOracleIrPromptHandlers.ts` | Oracle IR any-player-may + library-chaos TARGET_SELECTION. |
| `targetSelectionDistinctTargetUtils.ts` | `getFilteredValidTargetsForStep`, distinct-target helpers. |
| `resolutionOptionChoiceSelectionIds.ts` | Shared OPTION_CHOICE id extractors. |
| `optionChoiceLandEntryReplacementHandlers.ts` | Shock / reveal / land-sacrifice / Mox Diamond. |
| `optionChoiceWardPaymentHandlers.ts` | Ward pay-or-counter OPTION_CHOICE. |
| `optionChoicePayOrElseHandlers.ts` | Sacrifice-unless-pay, Force of Will pitch, opponent-may-pay. |
| `optionChoiceCastFromGraveyardPrompts.ts` | Play/cast from graveyard OPTION_CHOICE. |
| `optionChoiceCastFromExilePrompts.ts` | Cast-from-exile + Dance with Calamity. |
| `optionChoiceReflexiveExileWhenYouDoHandlers.ts` | Reflexive exile when-you-do that move then push. |
| `optionChoiceReflexiveWhenYouDoQueueHandlers.ts` | Reflexive when-you-do that only queue the follow-up. |
| `optionChoiceDungeonRoomPrompts.ts` | Dungeon room penalty / free-cast / Throne. |
| `optionChoiceVentureDungeonHandlers.ts` | Venture + `applyDungeonRoomEffectsWithDoubler`. |
| `optionChoiceSpellCopyPrompts.ts` | Resolved-spell copy keep/retarget. |
| `optionChoiceLookedAtCardsAndPileHandlers.ts` | Looked-at destination, pay-X-to-look, pile split. |
| `optionChoicePermanentAndHandCardPrompts.ts` | Own-card / own-permanent OPTION_CHOICE. |
| `optionChoiceCostPlanPrompts.ts` | Blight-or-pay + choose-discard-plan. |
| `optionChoiceChoosePlayerPrompts.ts` | Choose a player who then gets the real prompt. |
| `optionChoiceDiscardAndManaColorPrompts.ts` | Optional discard-then-draw + choose-mana-colors. |
| `optionChoiceExilePlayPermissionPrompts.ts` | Playable-from-exile grant + rebound. |
| `optionChoiceEtbAndCounterPlacementPrompts.ts` | ETB ability pick + multi-player counter placement. |
| `optionChoiceBoardActionPrompts.ts` | Tap-or-untap decision, Mox Diamond off the stack. |
| `preGameHandStepResponseHandlers.ts` | OPENING_HAND_ACTIONS + HAND_TO_BOTTOM. |
| `upkeepSacrificeResponseHandlers.ts` | UPKEEP_SACRIFICE. Entry: `handleUpkeepSacrificeResponse`. |
| `playerChoiceResponseHandlers.ts` | PLAYER_CHOICE. Entry: `handlePlayerChoiceResponse`. |
| `aiKeywordChoiceStepResponses.ts` | AI fabricate/exploit/backup/enlist/haunt/…. |
| `aiZoneSelectionStepResponses.ts` | AI library/graveyard/scry/surveil/discard. |
| `aiSimpleChoiceStepResponses.ts` | AI color/vote/clash/proliferate/riot/…. |
| `aiCostAndExploreStepResponses.ts` | AI station/life/explore/mode/squad/…. |
| `aiTargetSelectionStepResponses.ts` | AI fight/tap-untap/counters/mutate. |
| `aiHandAndDraftStepResponses.ts` | AI X / mana-color / hand-to-bottom / hideaway / draft. |
| `xValueSelectionResponseHandlers.ts` | X_VALUE_SELECTION (spell-cast X + Blight X). On deps. |
| `triggerOrderResponseHandlers.ts` | TRIGGER_ORDER. On deps. |
| `extortPaymentResponseHandlers.ts` | EXTORT_PAYMENT. On deps. Do not merge into `resolutionKeywordChoiceHandlers.ts`. |
| `mayAbilityAndOptionalTriggerHandlers.ts` | May-ability + optional triggered “you may” + auto-decline drain. On deps. |
| `mutateTargetSelectionResponseHandlers.ts` | MUTATE_TARGET_SELECTION then resume gated cast. On deps. |
| `spellCastPaymentResumeHandlers.ts` | `resumePlayerSpellCastAfterPayment` / `resumeAISpellCastAfterPayment`. |
| `targetSelectionResponseHandlers.ts` | Remaining TARGET_SELECTION dispatcher. Direct parent import. |
| `optionChoiceResponseHandlers.ts` | Remaining OPTION_CHOICE dispatcher. Direct parent import. |
| `stepResponseHandlers.ts` | `handleStepResponse` core. Direct parent import. |
| `registerResolutionHandlers.ts` | Socket register (query/submit/cancel/preference/disconnect). Parent re-export. |
| `sanitizeStepForClient.ts` | Client sanitizer. Parent re-export. |
| `emitResolutionStepPrompt.ts` | Prompt emit. Parent re-export. |
| `resolutionStepTimeoutAndCancelHandlers.ts` | Timeout, cancel side-effects, next-step emit. |
| `resolutionPriorityHandlerState.ts` | Shared `{ initialized, io }` for priority + timeout. |
| `effectProgramSpellColorChoiceFinalize.ts` | EffectProgram COLOR_CHOICE finalize after resume. |
| `attackCostPaymentBeforeCompleteHandlers.ts` | Attack-tax payment before complete. |
| `rulesChoiceGroupResponseHandlers.ts` | Grouped rules-choice + selection-id extractors. |
| `spellPaymentPresentationSanitizeUtils.ts` | Mana-payment presentation hydration. |
| `panglacialSearchCastUtils.ts` | Panglacial castable-card helpers. |
| `panglacialSearchCastHandlers.ts` | `handlePanglacialWurmSearchCast`. |
