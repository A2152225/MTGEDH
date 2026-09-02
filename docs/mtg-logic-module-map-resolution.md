# MTG logic module map — socket resolution

Peeled from `docs/mtg-logic-module-map.md` (`## Socket resolution`).
Coordinator owns this file. Extract chats must not edit it — paste owed rows.

## Socket resolution

- Public barrel: `server/src/socket/resolution.ts` (`handleAIResolutionStep` is exported). Remaining cores: `handleAIResolutionStep`, `initializeAIResolutionHandler`, `initializePriorityResolutionHandler` (enters resolution mode on `hasPending`, not `pendingCount === 1`), `applyResolutionStepSideEffects`, plus AI library-chaos helpers. `handleStepResponse` / `handleTargetSelectionResponse` / `handleOptionChoiceResponse` / `registerResolutionHandlers` / `sanitizeStepForClient` live in `resolution-handlers/` (parent re-exports the last three).
- Runtime seam: `server/src/socket/resolutionHandlerDeps.ts` — `ResolutionHandlerDeps` / `createResolutionHandlerDeps` / `getResolutionHandlerDeps`. Extracted handlers are injected here; **extracted files must not import `resolution.ts`**.
- Internal TOC: `server/src/socket/resolution-handlers/index.ts` (named re-exports only).
- Pre-complete validation is split across siblings (do not append to a near-ceiling file):
  - `resolutionRegisterPreCompleteValidationForExtractedSteps.ts` — older extracted step types
  - `resolutionRegisterPreCompleteValidationForStepResponseClusters.ts` — explore / fight / tap-untap / counters / station / mana-color / phyrexian
  - `resolutionRegisterPreCompleteValidationForZoneSelectionSteps.ts` — discard, hand-to-bottom, graveyard, library search
  - `resolutionRegisterPreCompleteValidationForChoicePromptSteps.ts` — X, Kynaios, hideaway, devour, player choice, …
  - `resolutionRegisterPreCompleteValidationForModeAndTriggerSteps.ts` — MODE_SELECTION, TRIGGER_ORDER, OPENING_HAND_ACTIONS. MODE_SELECTION membership accepts `mode_N` as the Nth IR label (`Mode N`).
  - `resolutionRegisterPreCompleteValidationForOptionChoiceSteps.ts` — OPTION_CHOICE shape + pay-cost prompts (`validateLifePayment` passes `ctx` + `controllerId`)
  - `resolutionRegisterPreCompleteValidationForCostPaymentSteps.ts` — LIFE_PAYMENT, ADDITIONAL_COST_PAYMENT, SQUAD_COST_PAYMENT (`validateLifePayment` passes `ctx` + `pid`)
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
| `resolutionGraveyardSelectionApplyHandlers.ts` (39.9 KB), `resolutionGraveyardSelectionResumeHandlers.ts`, `resolutionGraveyardSelectionHelperUtils.ts` | Graveyard selection: apply vs resume phase split. GY→exile apply stamps `exiledWith` / `exiledWithSourceId` from `triggeredAbilitySourcePermanentId` via `exileWithSourceStamp.ts` (not stack-item `effectId`). Persist `confirmGraveyardTargets` carries `exiledWithSourceId` for replay. Triggered GY→exile with remaining effect text is **not** a concrete zone move (`isConcreteTriggeredGraveyardZoneMove`) so Hazel’s Food tail still runs through `executeTriggerEffect`. |
| `resolutionHideawayZoneDraftPermanentChoiceResponseHandlers.ts` | Hideaway / zone draft / permanent choice. Repeated zone draft honors `attachId` / `enchantedPlayerId` for Auras and Curses. |
| `resolutionJoinForcesTemptingOfferResponseHandlers.ts`, `resolutionJoinForcesTemptingZoneChoiceResponseHandlers.ts` | Join forces and tempting offer *(exports TBD)* |
| `resolutionKeywordChoiceHandlers.ts` (35.6 KB) | Keyword choices *(exports TBD)* |
| `resolutionLibrarySearchHandlers.ts`, `resolutionLibrarySearchStepUtils.ts`, `resolutionLibrarySearchOracleIrChoiceResume.ts`, `resolutionLibrarySearchOracleIrResumeUtils.ts`, `resolutionLibraryLookResponseHandlers.ts` | Library search / look, including Oracle IR resume (leaf-import example). `BOTTOM_ORDER` with `oracleIrChoiceStepJson` applies the IR remainder instead of pushing duplicate library cards. Warp World remainder after 903.9a must not re-run reveal/put (empty pending continuation). Remainder cards hydrate names/`image_uris`; client `ScrySurveilModal` bottom_order is a horizontal left→right reorder (`bottomOrderConfirm.ts`). `handleBottomOrderResponse` catches Oracle IR apply failures so a throw cannot leave Pass Priority stuck. |
| `resolutionModalChoiceResponseHandlers.ts` | Modal choices. Choose-one resume copies `triggeringStackItemId` / `effectData` / caster onto the synthetic trigger so “that spell” still binds. |
| `resolutionOptionChoiceEarlySpecialsPrefixHandlers.ts` (39.5 KB), `resolutionOptionChoiceEarlySpecialsConfirmCastPaymentHandlers.ts` (36.9 KB) | Early `handleOptionChoiceResponse` specials; try-handle boolean prefix pattern. ConfirmCastPayment reflexive consume `validateLifePayment` passes `ctx` + `controllerId`. Optional-payment path must not overwrite live `ctx.bumpSeq` with `game.bumpSeq` (that cycle blew the stack on shock-land pay-2-life). |
| `resolutionOptionChoiceSkipDrawReplacementHandlers.ts` | Island Sanctuary skip-draw OPTION_CHOICE (`tryHandleSkipDrawReplacementChoice`). |
| `resolutionOptionChoiceOpponentLibraryDrawReplacementHandlers.ts` | Shared Fate-family opponent-library draw replacement OPTION_CHOICE (`tryHandleOpponentLibraryDrawReplacementChoice`). |
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
| `lifePaymentResponseHandlers.ts` | LIFE_PAYMENT then resume captured cast. `validateLifePayment` passes `ctx` + `pid`. |
| `manaColorSelectionResponseHandlers.ts` | MANA_COLOR_SELECTION (distribution, Treasure provenance, deferred activation costs). |
| `resolutionManaPaymentApplication.ts` | Shared mana-payment appliers: `extractResolutionPaymentItems`, ward apply/validate, `applySelectedManaPaymentForResolutionCost`. |
| `manaPaymentChoicePrefixHandlers.ts` | MANA_PAYMENT_CHOICE ward / sacrifice-unless-pay prefix. Entry: `tryHandleManaPaymentChoiceWardAndSacrificePrefix`. |
| `manaPaymentChoiceActivationHandlers.ts` | MANA_PAYMENT_CHOICE activation-payment branch. Entry: `tryHandleManaPaymentChoiceActivation`. |
| `manaPaymentChoicePhyrexianHandlers.ts` | MANA_PAYMENT_CHOICE Phyrexian tail. Entry: `handleManaPaymentChoicePhyrexianActivation`. |
| `manaPaymentSpellCastResponseHandlers.ts` | MANA_PAYMENT_CHOICE spell-cast payment. Entry: `handleSpellPaymentChoiceResponse`. AI cancel (could not assemble payment) records `rememberAIFailedSpellCast` so `findCastableSpells` skips that card for the rest of the turn. |
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
| `targetSelectionScavengeAndCopyHandlers.ts` | Scavenge + become-a-copy. After applying the copy, `runSBA` so CR 704.5j covers legendary lands (Vesuva). |
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
| `optionChoiceLandEntryReplacementHandlers.ts` | Shock / reveal / land-sacrifice / Mox Diamond. `handleShockLandChoice` refuses `pay_2_life` via `canChooseShockLandPayLife`. |
| `optionChoiceWardPaymentHandlers.ts` | Ward pay-or-counter OPTION_CHOICE. |
| `optionChoicePayOrElseHandlers.ts` | Sacrifice-unless-pay, Force of Will pitch, opponent-may-pay. |
| `optionChoiceCastFromGraveyardPrompts.ts` | Play/cast from graveyard OPTION_CHOICE. |
| `optionChoiceCastFromExilePrompts.ts` | Cast-from-exile + Dance with Calamity. A generic “cast” choice that does not start a cast (no stack growth, card still in exile, no pending payment/target) is treated as the decline destination instead of re-queued, so Possibility Storm AI cannot loop `option_choice` forever. |
| `optionChoiceReflexiveExileWhenYouDoHandlers.ts` | Reflexive exile when-you-do that move then push. |
| `optionChoiceReflexiveWhenYouDoQueueHandlers.ts` | Reflexive when-you-do that only queue the follow-up. |
| `optionChoiceDungeonRoomPrompts.ts` | Dungeon room penalty / free-cast / Throne. |
| `optionChoiceVentureDungeonHandlers.ts` | Venture + `applyDungeonRoomEffectsWithDoubler`. |
| `optionChoiceSpellCopyPrompts.ts` | Resolved-spell copy keep/retarget. Fallback `stack.push` (no `applyEvent`) persists `namedSpellsCastThisGame`. |
| `optionChoiceMayRevealHandWinHandlers.ts` | OPTION_CHOICE resume for may-reveal four-zone named-copy win. Reveal is a chat note then stamp winner if the chooser owns a current-name copy in exile, hand, GY, and battlefield. Decline is a no-op. Entry: `handleMayRevealHandWinIfOwnNamedChoice`. |
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
| `aiHandAndDraftStepResponses.ts` | AI X / mana-color / hand-to-bottom / hideaway / draft. Auction Auras with multiple hosts send `{ cardId, attachId }`. |
| `resolutionAutoResolveGate.ts` | `shouldAutoResolveResolutionStep` — AI seats auto-answer STEP_ADDED prompts. Humans (including idle Smart Pass) keep a fresh per-step clock for APNAP choices such as Kynaios; timeout auto-completes those choices. Direct parent import. |
| `xValueSelectionResponseHandlers.ts` | X_VALUE_SELECTION (spell-cast X, delayed up-to-N draw, Blight X). On deps. Delayed `delayedDrawUpTo` draws the chosen 0..N. |
| `triggerOrderResponseHandlers.ts` | TRIGGER_ORDER. On deps. |
| `extortPaymentResponseHandlers.ts` | EXTORT_PAYMENT. On deps. Do not merge into `resolutionKeywordChoiceHandlers.ts`. |
| `mayAbilityAndOptionalTriggerHandlers.ts` | May-ability + optional triggered “you may” + auto-decline drain. On deps. |
| `mutateTargetSelectionResponseHandlers.ts` | MUTATE_TARGET_SELECTION then resume gated cast. On deps. |
| `spellCastPaymentResumeHandlers.ts` | `resumePlayerSpellCastAfterPayment` / `resumeAISpellCastAfterPayment`. |
| `targetSelectionResponseHandlers.ts` | Remaining TARGET_SELECTION dispatcher. Direct parent import. |
| `optionChoiceResponseHandlers.ts` | Remaining OPTION_CHOICE dispatcher. Direct parent import. |
| `stepResponseHandlers.ts` | `handleStepResponse` core. Direct parent import. After every step response (including shock / check-land), `processPendingOracleIrCompoundResume` drains leftover IR steps persisted when as-enters prompts grew the queue. |
| `registerResolutionHandlers.ts` | Socket register (query/submit/cancel/preference/disconnect). Parent re-export. |
| `sanitizeStepForClient.ts` | Client sanitizer. Copies `causeName` / `causeImage` / `causeLabel` from the triggering spell (or explicit step fields) so choose-one prompts can show what caused them. Does not send `triggerData`. Parent re-export. |
| `emitResolutionStepPrompt.ts` | Prompt emit. Parent re-export. |
| `resolutionStepTimeoutAndCancelHandlers.ts` | Per-step timeout, cancel side-effects, next-step emit. `scheduleResolutionStepTimeoutForGame(gameId, step)` starts/resets that step’s clock on STEP_ADDED so every APNAP seat gets a fresh timer when the effect is queued. Completing one step does not rewind the others. Kynaios / Join Forces / Tempting Offer time out into a default choice instead of marking the source broken. |
| `resolutionPriorityHandlerState.ts` | Shared `{ initialized, io }` for priority + timeout. |
| `effectProgramSpellColorChoiceFinalize.ts` | EffectProgram COLOR_CHOICE finalize after resume. |
| `attackCostPaymentBeforeCompleteHandlers.ts` | Attack-tax payment before complete (generic plus `{W/P}` via `attackCostPhyrexianPayment.ts`). |
| `blockCostPaymentBeforeCompleteHandlers.ts` | Block-tax payment before complete (Archangel of Tithes while attacking). |
| `rulesChoiceGroupResponseHandlers.ts` | Grouped rules-choice + selection-id extractors. |
| `spellPaymentPresentationSanitizeUtils.ts` | Mana-payment presentation hydration. |
| `panglacialSearchCastUtils.ts` | Panglacial castable-card helpers. |
| `panglacialSearchCastHandlers.ts` | `handlePanglacialWurmSearchCast`. |
