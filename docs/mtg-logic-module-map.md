# MTG logic module map

Finder for agents and humans: **which module owns which mechanic**, so nobody opens a 1 MB parent to answer "where does discard resume live?".

- Size ceiling and split rules: `.cursor/rules/typescript-max-40kb-split.mdc`
- Extraction playbook and paste prompts: `.cursor/skills/split-ts-module/SKILL.md`
- Current byte sizes: `node tools/ts-logic-file-sizes.mjs` (add `--all`, `--top N`, `--scope <dir>`, `--json`)

## How to update

**Solo extract:** at the end of the session, add or edit one row: new module, the parent it left, and its main exported entry points.

**Parallel wave (I–P, I2–P2, …):** extract chats must **not** edit this file. They paste **owed rows** in the wrap-up. The coordinator chat merges those rows after the parent is done (or after a safe abort). Do not copy them by hand into a second extract prompt.

This file tracks extract families from the Campaign 0 inventory plus Campaigns A–H and later waves. Rows marked *(exports TBD)* get filled in by the session that next touches that module.

## Naming and barrels (summary)

| Layer | File | Job |
| --- | --- | --- |
| Public / compatibility barrel | `X.ts` (e.g. `resolution.ts`, `triggered-abilities.ts`) | Stable import path for sockets, GameManager, tests. Keeps `from "./resolution.js"` working. |
| Internal / agent TOC barrel | `X-handlers/index.ts` (e.g. `resolution-handlers/index.ts`) or the existing `triggers/index.ts` | Tiny named-re-export table of contents for extracted modules. |

**Never `X.ts` and `X/index.ts` in the same directory** — module resolution is ambiguous. The implementation folder gets a different name: `resolution-handlers/`, `game-actions-handlers/`, `triggers/`.

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

## Triggered abilities

- Public leftover: `server/src/state/modules/triggered-abilities.ts` (**35.8 KB**, under ceiling). Remaining unique detectors (`analyzeCardTriggers`, `detectDiscardTriggers`, `detectTargetedTriggers`) can move later.
- Internal TOC: `server/src/state/modules/triggers/index.ts`. This folder is the schema; never add `triggeredAbilitiesXxx.ts` prefixes.
- **Death / ETB dual copies reconciled:** leftover `detectDeathTriggers` / `detectETBTriggers` / `getETBTriggersForPermanent` re-export from `triggers/zone-changes.ts`, which re-exports the live bodies in `death-detection.ts` / `etb-detection.ts`. **One** `export function` each. Do not create a third copy.
- **Death emission dual copies reconciled:** leftover `getDeathTriggers` / `getDeathTriggersForCreature` / `processUndyingPersist` / `getPlayersWhoMustSacrifice` re-export from `zone-changes.js`; live bodies in `death-emission.ts` (+ helpers). **One** `export function` each.
- **ETB untap / auto-sacrifice dual copies reconciled:** leftover `detectETBUntapEffects` / `getETBUntapEffects` / `applyETBUntapEffect` / `checkETBAutoSacrifice` re-export from `zone-changes.js`; live bodies in `etb-untap.ts`. **One** `export function` each.
- **Attack dual copies reconciled:** leftover `detectAttackTriggers` re-exports from `triggers/zone-changes.js`; live body in `attack-detection.ts` (+ generic/watchers/state). `combat.ts` re-exports the leaf. **One** `export function`.
- **`getAttackTriggersForCreatures` dual copies reconciled:** live body in `attack-triggers-for-creatures.ts` (production combat implementation; leftover simpler copy replaced). `combat.ts` and leftover re-export. **One** `export function`.
- Folder members still over ceiling: `card-data-tables.ts` (44.3 KB), `turn-phases.ts` (45.4 KB), `zone-change.ts` (40.5 KB). `combat.ts` is **30.1 KB** (done). `intervening-if.ts` is **12.6 KB** (done). `zone-changes.ts` is now ~1.9 KB (re-export barrel).

| Module (`triggers/`) | Owns |
| --- | --- |
| `detectorTriggeredAbility.ts` | Leftover detector `TriggeredAbility` wire type (distinct from skinny `triggers/types.ts`). |
| `cardNameRegexAlternatives.ts` | Card-name regex variants for detectors. Entry: `buildCardNameRegexAlternatives`. |
| `enters-or-other-event-prefix.ts` | Compound "enters or \<event\>" prefix. Entry: `ENTERS_OR_OTHER_EVENT_PREFIX`. |
| `death-detection.ts` (+ `death-detection-early/mid/late/state.ts`) | `detectDeathTriggers`. Pattern runs mutate shared `DeathDetectionState`. |
| `death-emission.ts` | Leftover-merged death emission: `getDeathTriggers`, `getDeathTriggersForCreature`, `processUndyingPersist`, `getPlayersWhoMustSacrifice`. Re-exported through `zone-changes.ts` and leftover. |
| `death-emission-helpers.ts` | Leftover-rich `DeathTriggerResult` plus detector-to-emitter adapters used by `getDeathTriggers`. |
| `etb-detection.ts` (+ `etb-detection-early/mid/late/helpers/state.ts`) | `detectETBTriggers`, `getETBTriggersForPermanent` (detector wire type, not skinny). |
| `hideaway-ability.ts` | `detectHideawayAbility`. |
| `detect-target-type.ts` | `detectTargetType`. |
| `etb-untap.ts` | Leftover-merged ETB untap + auto-sacrifice: `detectETBUntapEffects`, `getETBUntapEffects`, `applyETBUntapEffect`, `checkETBAutoSacrifice`, `ETBUntapEffect`. Re-exported through `zone-changes.ts` and leftover. |
| `attack-detection.ts` (+ generic/watchers/reflexive/state) | Live `detectAttackTriggers`. Leftover and `combat.ts` re-export. Reflexive `when you do` / `when they do` / exert riders are detection-only (`isReflexiveDelayedDoTriggerType`); combat does not auto-queue them on declare attackers. |
| `ltb-detection.ts` | Leftover LTB detector. |
| `ability-activated-detection.ts` | Leftover ability-activated **detection** (not emission `ability-activated.ts`). |
| `combat-damage-detection.ts` (+ early/mid/late/state) | Leftover combat-damage detect. `combat.ts` re-exports. |
| `tap-detection.ts` | Leftover tap detect. `tap-untap.ts` re-exports. |
| `spell-cast-detection.ts` (+ mid/late/state/helpers/effect-text/trigger-type) | Leftover `detectSpellCastTriggers`. Also `spell-cast-get-triggers.ts`, `spell-cast-untap-detection.ts`. |
| `planeswalker-loyalty.ts` / `special-card-effect-tables.ts` / `static-special-effect-detectors.ts` / `mimic-vat-modal-and-storm.ts` | Leftover unique bottom tables/detectors. |
| `dealt-damage-detection.ts` / `status-keyword-detection.ts` / `status-event-detection.ts` / `returned-to-hand-detection.ts` | Leftover unique detectors. |
| `block-detection.ts` + `block-trigger-type.ts` | Leftover `detectBlockTriggers`. |
| `untap-detection.ts` | Leftover untap detect. Folder `tap-untap.ts` may still have a copy — dual-copy grep before deleting. |
| `attachment-attack-detection.ts` | Live attachment-attack detect/get. `combat.ts` re-exports (combat copy deleted). |
| `attack-triggers-for-creatures.ts` | Live `getAttackTriggersForCreatures` (production body from `combat.ts`; leftover dual-copy replaced). `combat.ts` and leftover re-export. |
| `enchanted-by-aura.ts` | From `combat.ts`. `isEnchantedByAuraYouControl`. |
| `combat-triggered-ability.ts` | From `combat.ts`. `CombatTriggeredAbility`. |
| `trigger-doublers.ts` | From `combat.ts`. `detectTriggerDoublers`, `applyTriggerDoublers`, `pushTriggerDoublerCopies`, `playerHasDungeonRoomAbilityDoubler`, `TriggerDoublerEventContext`. |
| `attack-watcher-queue.ts` | From `combat.ts`. `planAttackWatcherQueue`, `isAttackWatcherTriggerType`. |
| `combat-attack-trigger-helpers.ts` | From `combat.ts`. `mergeCombatTriggerValue`, `extractCommanderOwnedGrantedAbilityTexts`. |

## Oracle IR parser / postprocess (`rules-engine/src/`)

- `oracleIRParserPostprocess.ts` is a **12.5 KB barrel** (named re-exports + a few leftover imports). All `oracleIRParserPostprocess*.ts` siblings are under the ceiling (largest: `oracleIRParserPostprocessGapClosureStepRepairs.ts` at 37.0 KB). Add a new family file; do not append to a sibling near 36–40 KB.
- `oracleIRParser.ts` is a **0.1 KB barrel**: `export { parseOracleTextToIR } from './oracleIRParserParseOracleTextToIR'`.
- Keep the `oracleIRParser*` / `oracleIRExecutor*` prefixes. No folder move until a parent is already a thin barrel.
- Pre-existing oversized clause files still need their own split: `oracleIRParserStaticAbilityClauses.ts` (67.2 KB), `oracleIRParserUtils.ts` (55.1 KB), `oracleIRParserEffectImpulsePermission.ts` (47.3 KB), `oracleIRParserLifeAndCombatClauses.ts` (44.3 KB). `oracleIRParserSimpleActionClauses.ts` is a **4.0 KB** dispatcher (`tryParseSimpleActionClause` + family `tryX`).

| Module | Left | Entry |
| --- | --- | --- |
| `oracleIRParserEffectClauseToStep.ts` | `oracleIRParser.ts` | `parseEffectClauseToStep` |
| `oracleIRParserAbilityMerges.ts` | `oracleIRParser.ts` | `mergeSplitChooseModeParsedAbilities` |
| `oracleIRParserImpulseExileTop.ts` | `oracleIRParser.ts` | impulse-exile-top parse (was a closure of `parseAbilityToIRAbility`) |
| `oracleIRParserExileTopOnlyLegacy.ts` | `oracleIRParser.ts` | exile-top-only legacy parse |
| `oracleIRParserAbilityToIR.ts` | `oracleIRParser.ts` | `parseAbilityToIRAbility` (takes `parseOracleTextToIR` as a parameter — do not import the public parent) |
| `oracleIRParserParseOracleTextToIR.ts` | `oracleIRParser.ts` | `parseOracleTextToIR` |
| `oracleIRParserParseOracleTextToIRLatePasses.ts` | `oracleIRParser.ts` | late passes of `parseOracleTextToIR` |
| `oracleIRParserSimpleActionHelpers.ts` / `…EarlyClauses.ts` / `…AddManaChoice.ts` / `…DrawTurn.ts` / `…CounterSearch.ts` / `…DiscardVote.ts` | `oracleIRParserSimpleActionClauses.ts` | Family `tryX` runs of `tryParseSimpleActionClause`. Leaves take parse args; null = fall through. Recursion is a `parseRest` callback — do not import the parent. |

Guard-run hoists out of `parseCurrentResidualUnknownStep` live in `oracleIRParserPostprocessResidual*Guards.ts` (static grant, entry/permission, text/catalog, combat/counter/payment, perpetual/secret, reflexive, mana/phasing/attach, number-change/group P/T, named-mode search, attacker/token, self-ref/library-order, ward/evidence). `parseStructuredTriggerResidualGrant` lives in `oracleIRParserPostprocessTriggerResidual*Pt*.ts`. Reminder/platform text is `oracleIRParserPostprocessCurrentBatchReminder*.ts`.

## Oracle IR executor (`rules-engine/src/`)

Still over ceiling, largest first: `oracleIRExecutorSpecialTargetHandlers.ts` (143.6 KB), `oracleIRExecutorConditionalStepSupport.ts` (133.8 KB), `oracleIRExecutorMoveZoneStepHandlers.ts` (71.7 KB). `oracleIRExecutorPlayerStepHandlers.ts` is **33.6 KB** (done). `oracleIRExecutorMainLoop.ts` is **29.4 KB** (done; `applyOracleIRStepsToGameStateImpl` is the switch dispatcher). `oracleIRExecutorBattlefieldStepHandlers.ts` is **34.7 KB** (done). `oracleIRExecutorZoneOps.ts` is **20.2 KB** (done). Split by step or op family; no `BatchNNN` / `Bulk` names. No `*-handlers/` folder until a parent is already a thin barrel.

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

Remaining in the parent (~71.7 KB): `finalizeAppliedResult` prologue (closes over mutable `nextState` / `effectiveBattlefieldAdd*`) plus the all-selector unsupported early-out (cannot be named `GuardsFromGraveyard` — that sibling already exists). `MoveZoneGuardArgs` already carries the extra locals from these chains.

### `oracleIRExecutorZoneOps*` (extracted from `oracleIRExecutorZoneOps.ts`)

| Module | Owns |
| --- | --- |
| `oracleIRExecutorZoneOpsCardTypeMatchers.ts` | Simple card-type parsing and matching. Entries: `SimpleCardType`, `parseSimpleCardTypeFromText`, `cardMatchesType`, `cardMatchesTotalPowerToughnessLte`. Parent re-exports the public API. |
| `oracleIRExecutorZoneOpsShuffleIntoLibrary.ts` | Shuffle-all / typed cards from a player's graveyard into their library. Entries: `parseMoveZoneShuffleAllFromYourGraveyardIntoLibrary`, `shufflePlayerGraveyardIntoLibrary`, `shuffleTypedCardsFromPlayerGraveyardIntoLibrary`. Parent re-exports the public API. |

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
| `oracleIRExecutorMainLoopLateSteps.ts` | `tryApplyMainLoopLateSteps` |

## Server spell routing (`server/src/state/modules/`)

| Module | Owns |
| --- | --- |
| `stackResolveSpellUncategorizedUtils.ts` | Uncategorized instant/sorcery IR fallback. Deleted `resolveSpell` ops (`DESTROY_ALL`, `DRAW_CARDS`, …) still categorize when `ORACLE_IR_SPELL_PRIMARY=0`; fallback must apply those IR steps or the spell no-ops. Entry: `tryApplyInstantSorceryUncategorizedSpellFallback`. |
| `applyEventResolveSpellDeletedOpEffects.ts` | Extracted from `applyEvent.ts`. Replay/`applyEvent({ type: 'resolveSpell' })` still carries deleted categorize specs; `resolveSpell()` returns []. Rebuilds `DamagePlayer`/`DamagePermanent` so Mindskinner replacements still apply. Entry: `effectsFromDeletedResolveSpellSpec`. |
| `oracleIrTransitionPipeline.ts` | IR `deal_damage` transitions call `resolveOpponentDirectedDamage` so prevent-and-mill replacements (Mindskinner) apply and mill via the real `GameContext` libraries map. Commander-zone replacement on exile stamps linked-exile / flicker follow-up via `commanderExileFollowup.ts`. |
| `commanderExileFollowup.ts` | Infer `linkedExileData` / `flickerReturnData` for deferred commander exile choices from source oracle, unique linked-exile permanents, or pending return steps. |
| `triggerKeywordFallbackUtils.ts` | Isolated effect clauses still skip unrelated static keywords (Prowess). If the clause is the expanded text of a card keyword (Soulshift → return a Spirit), or is only an event stub (`enters the battlefield`), that keyword path still runs. |
| `triggerLifeDamageUtils.ts` | Generic `deals N damage to each opponent` (`tryApplyEachOpponentDamageTrigger`) and `deals N damage to target / any target / that player` (`tryApplyTargetedDamageFromEffectText`). Targeted path marks `damageThisTurn` on permanents and queues `deals_damage` player triggers. Used from executeTriggerEffect and the IR trigger fallback when `ORACLE_IR_TRIGGER_PRIMARY=0`. |
| `oracleIrPostApplyTriggerEmission.ts` | After IR `deal_damage` life loss, record `damageTakenThisTurnByPlayer` and queue source `deals_damage` player triggers (`queueDealsDamageToPlayerTriggersFromPermanent`). After IR `mill`, emit `processMillTriggers` for new non-hand graveyard cards. |
| `oracleIrTriggerExecution.ts` / `stackExecuteTriggerEffectIrFallbackUtils.ts` | Bind trigger `effectData.lifePaid` into IR `referenceAmount` after `lifeLost` so “put that many … counters” (Font of Agonies) resolves the paid amount. |
| `tap-trigger-queue.ts` | Optional “becomes tapped” triggers go straight onto the stack. Resolve-time optional deferral owns the single may prompt (no `may-ability-prompts` import). |
| `triggered-abilities.ts` / `triggers/zone-changes.ts` | Self-ETB `detectETBTriggers` marks `mandatory: false` when the effect includes “you may” (Knight of the White Orchid land search). Live detector is `triggers/etb-detection.ts` (re-exported through zone-changes + leftover). Self-and-other death (`this creature or another creature you control dies`) is queued from `appendDetectedSelfDeathTriggers` and the live self-dies scan, not a card-name handler. |
| `oracleIrAbilityExecution.ts` (`tryApplyStationChargeCountersViaOracleIR`) | If IR mutates charge counters but all-or-nothing reports unhandled (or throws after the mutation), treat the mutation as handled so the legacy station path does not add the same counters again. |
| `oracleIRExecutorResolveQuantity.ts` (`object_stat` / `it` / power) | Station `equal to its power` uses `stationedCreaturePower` before the spacecraft/planet source P/T. Hydrated Station permanents often have a printed power that is not the tapped creature. |
| `counters_tokens.ts` (`movePermanentToGraveyard`) | `token-ceases-to-exist` replacements still fall through to death-trigger emission. Tokens die (CR 700.4) even though they never reach the graveyard. |
| `triggerLibraryMillUtils.ts` (`millCardsFromLibrary`) | An empty `ctx.libraries` Map does not wipe or starve a populated `state.zones[player].library`. Mill from the zone store and sync the Map. |
| `game-state-effects.ts` (`applyCombatDamageReplacement`) | Uses `detectCombatDamageReplacement` so granted/temporary “prevent combat damage, each draw half” abilities (Sokrates) apply, not only battlefield-wide mill replacements. |
| `socket/util.ts` (`LAND_PLAY_AUTOMATION_SUPPRESSION_MS`) | Manual land play suppresses broadcast auto-pass for 1500ms. |
| `stackResolveSpellLegacySpecUtils.ts` (`applyLegacyResolvedSpellRiders`) | Deleted categorize ops (e.g. `COUNTER_TARGET_SPELL`) still run mill / exile-until / free-cast riders. Counter itself is IR/other-path; Tibalt-style follow-up is not. |
| `game-actions.ts` (`detectBanneretTypeReduction`) | `{Type} spells and {Type} spells you cast cost {N} less` applies from oracle text, not a Banneret name check. |
| `triggers/mill.ts` | `whenever … mills …` uses a greedy `([^,]+)` condition so “one or more creature cards,” does not collapse to `o`. Entry: `detectMillTriggers`. |
| `triggers/zone-change.ts` | “a card is put into [someone's] graveyard from anywhere” needs a space before `graveyard`. Compound Syr Konrad lines classify scope from the put-into head, not the leftover “leaves your graveyard” clause. |
| `resolutionGraveyardSelectionTriggerExecute.ts` | Trigger GY selections with no concrete zone destination apply via `executeTriggerEffect` (keyword grants). Hand/battlefield/library/exile and delayed returns stay on the apply+persist path. Entry: `tryApplyTriggeredAbilityGraveyardSelectionViaExecute`. |
| `triggers/combat.ts` | `KNOWN_ATTACK_TRIGGERS` is an optimization cache only. Optional may-pay attack lines (`you may pay {…}. If/When you do`) skip the table so generic parsing keeps `manaCost`/`energyCost` and `mandatory: false` (Casal, Filigree Racer). |
| `stackResolveTriggeredAbilityTargetPromptUtils.ts` | Graveyard trigger targets stamp `triggeredAbilityGraveyardSelection`. Return-to-zone also stamps `triggeredAbilityGraveyardChoice` for live-stack assign. Grants with no zone destination apply via `executeTriggerEffect`. Concrete hand/battlefield/library/exile and delayed returns use the apply+persist path. |
| `stackExecuteTriggerEffectUtils.ts` | Isolated “gains jump-start/flashback until end of turn” still applies when IR trigger primary is off. Isolated “the next spell you cast this turn has convoke” (Wand of the Worldsoul) applies via `tryApplyCastingModifierGrantsFromText`. |
| `stackResolveTopOfStackDispatchUtils.ts` | Routes popped stack items. Instant/sorcery success now calls `finalizeResolveTopOfStackAfterEffects` (SBA) the same way permanents already did. |
| `stackExecuteTriggerChosenTypeUtils.ts` | Chosen-type trigger presets (copy+haste+exile, look/reveal to hand, draw-per-creature). Reads `chosenCreatureType` from the source permanent when the trigger item omits it. |
| `triggerChosenTypeCopyTokenUtils.ts` | Generic “copy of that creature / haste / exile next end step” rider. Entry: `tryResolveCopyThatCreatureHasteExile`. |
| `triggerChosenTypeSpellUtils.ts` | Chosen-type draw-per-creature and Herald’s Horn–style top-card reveal to hand. |
| `oracleIrServerZoneSync-handlers/oracleIrServerPostExecutionStateSync.ts` | After IR `create_token`, mirrors delayed cleanup into `pendingExileAtNextEndStep` / `pendingSacrificeAtNextEndStep` and stamps `tempAbilities` haste. |
| `triggerGameStateOracleBridgeUtils.ts` | After IR trigger apply, queues monarch / initiative / venture / city blessing / transform. `venture_into_dungeon` is deferred when `interactivePlayerChoices` so `resolveVentureProgress` can prompt and apply room effects. |
| `triggerVentureUtils.ts` | AFR dungeon enter/advance, Undercity, room-effect prompts. Entry: `resolveVentureProgress`. |
| `trigger-runtime-wiring.ts` | `ORACLE_IR_FALLBACK_STEP_KINDS` includes `grant_temporary_dies_trigger`, `take_initiative`, and `become_monarch`. Fallback prefilter also matches `put` / `onto the battlefield` (Reanimate-style zone changes), plus venture / initiative / monarch so those steps reach `applyOracleIRStepsOnServer`. `collectSpellResolutionEffectSteps` omits printed flashback/escape/retrace/jump-start/harmonize reminder grants so they do not leftover-queue and block `nextStep`. |
| `oracleIRExecutorExileGraveyardCardHandlers.ts` | Extracted from `oracleIRExecutorBattlefieldStepHandlers.ts`. `Exile target card from a graveyard` binds `chosenObjectIds` and moves the card to its owner's exile. Entry: `tryApplyExileTargetCardFromGraveyard`. |
| `oracleIRExecutorBattlefieldSacrificeWhat.ts` | Extracted from `oracleIRExecutorBattlefieldStepHandlers.ts`. Sacrifice-what parsers: `parseSacrificeWhat`, `extractSacrificeWhatText`, `sacrificeSelectorRequiresPlayerChoice`, `buildSacrificeTargetSelectionOptions`. |
| `oracleIRExecutorBattlefieldPhaseCombatAuraSteps.ts` | Extracted from `oracleIRExecutorBattlefieldStepHandlers.ts`. Remove-from-combat, phase-out, put-sticker, assign-no-combat-damage, become-aura, tap-matching-permanents. Entries: `applyRemoveFromCombatStep`, `applyPhaseOutStep`, `applyPutStickerStep`, `applyAssignNoCombatDamageStep`, `applyBecomeAuraStep`, `applyTapMatchingPermanentsStep`. |
| `oracleIRExecutorMoveZoneStepHandlers.ts` | `target card from a graveyard` is an explicit selector (not a pronoun). Bound-id lookup reads `state.zones` as well as `players[].graveyard` so cast-side Cremate/Vile Rebirth still resolve when only the dual-store zone map is populated. |
| `oracleIrServerZoneSync-handlers/oracleIrServerZoneHydrateDelayedBridges.ts` | `hydrateOracleIRPlayerZonesFromContext` copies graveyard/hand/exile from `state.zones` even when `ctx.libraries` is missing. |
| `stackResolveSpellGraveyardAutomationUtils.ts` | Cast-side GY automation skips `Exile … from a graveyard` sentences; IR already applied those clauses. Return/put reanimate riders still run. |
| `triggerEtbGraveyardTargetPrompt.ts` | Extracted from `triggerEtbEntryEffects.ts`. Self-ETB graveyard target prompt. `you may cast target … from your graveyard` uses destination `cast` plus `triggeredAbilityCastFromGraveyard`. Entry: `queueSelfEtbGraveyardTargetPrompt`. |
| `oracleIRExecutorBoundSelfCreatureTarget.ts` | `oracleIRExecutorCreatureStepUtils.resolveSingleCreatureTargetId` | `resolveBoundSelfOrSourceCreatureTargetId` — “this creature” / “this permanent” falls back to bound `targetPermanentId` when `sourceId` is not the affected creature (connive, explore). |
| `oracleIRExecutorPlayerStepHandlers.ts` (`applyRetainManaStep`) | Duration-limited `retain_mana` (Tanuki / Birgi / firebending) writes `temporaryRetainedMana` only. Do not stamp pool-wide `doesNotEmpty` or expired combat/EOT mana survives `clearManaPool`. |
| `oracleIRExecutorPlayerStepHandlers.ts` (`applyScryStep`) | Scry N still requires a player-choice gap when the library is empty so the server can queue printed `scryCount`. |
| `oracleIRExecutorPlayerStepHandlers.ts` (`applyShuffleLibraryStep`) | Optional shuffle stays a player choice when `interactivePlayerChoices` is on. Do not auto-shuffle before a Ponder-style reorder prompt. |
| `triggerOptionalPaymentQueueUtils.ts` | Optional “you may pay {C}. If you do” resume. Inferred target metadata must not overwrite bound stack fields (`battlefieldGrantedTypes`, `targetDestination`) with `undefined`. When IR trigger primary owns the effect, skip the legacy mana-payment prompt so Effect Program presents the may (Agrus Kos). |
| `triggerReflexiveWhenYouDoQueueUtils.ts` | Same IR-ownership skip for fixed “you may pay {C}. If you do” reflexives so stack resolve does not intercept Agrus / copy-ability mays. |
| `resolutionGraveyardSelectionApplyHandlers.ts` | If `triggeredAbilityGraveyardChoice` cannot find the popped trigger, fall through and apply the destination move (resolve-then-choose). |
| `oracleIRExecutorCopySpellSupport.ts` | `copy_spell` `last_moved_card` hydrates from the step ledger / `selectorContext.chosenObjectIds` when the server bridge strips `lastMovedCards`. Entry: `resolveCopiedSpellSourceCards`. Optional copies write playable `isCopy` cards into both `players[].exile` and `state.zones`. |
| `oracleIrServerCopySpellSync.ts` | After optional `copy_spell`, queues cast-from-exile prompts for the created copies. Entry: `queueCastableCopiedSpellPromptsFromOracleIRResult`. Graveyard “copy that spell twice instead” lives here (`shouldDoubleCopyWhenCastFromGraveyard`), not the legacy rider. |
| `stackResolveSpellPostCategorizeRidersUtils.ts` (`applyInstantSorceryCopyStackSpellRiders`) | Returns early when IR already emits `copy_spell` so Increasing Vengeance flashback does not create four copies. |
| `triggered-abilities.ts` (`detectSpellCastTriggers` untyped loop) | Untyped "whenever you cast a spell" must skip zone-qualified clauses (`from anywhere other than your hand`, exile/GY/library) and leftover `that targets …` heroic effects. |
| `castIntent.ts` | `buildPersistedSacrificedPermanentFields` snapshots deferred additional-cost sacrifices onto `castSpell` before live code clears `pendingAdditionalCostSacrificeIds`. |
| `socket/util.ts` (`checkAndTriggerAI`) | In-game broadcasts schedule `scheduleAIPriority`. `scheduleAIGameFlow` is only for pre-game commander/mulligan. Stacking both added a second 300ms hop. |
| `socket/ai.ts` (`handleAIGameFlow`) | After the gameFlow delay, in-game priority is scheduled at 0ms — do not add another `AI_REACTION_DELAY_MS`. |
| `game-actions.ts` (`requestCastSpellForSocket`) | Sneak timing uses `canCastWithSneakAtCurrentTiming` so DECLARE_BLOCKERS sneak casts are not rejected as sorcery-speed. Same helper already gates `castSpellFromHand`. |
| `counters_tokens.ts` (`resolveLegendRuleChoice`) | CR 704.5j queues `OPTION_CHOICE` with `legendRuleChoice`. Do not auto-pick except replay fallback. |
| `oracleIRExecutorCreatureStepUtils.ts` (`isMassTapOrUntapSelectorText`) | Mass tap/untap (`all`/`each`/`every`, no `target`) still applies when no permanents match so later `add_extra_combat` is not all-or-nothing refused. |
| `triggerLifeDamageUtils.ts` (`tryApplyEachOpponentDamageTrigger`) | After “deals N damage to each opponent”, also apply a same-clause “you gain N life” rider. Do not return after damage only. |
| `oracleIrUncategorizedSpellFallback.ts` (`collectSpellSteps`) | Ability/trigger fallback uses `collectOracleEffectSteps`, not spell-only filtering that drops `add_extra_combat` from Combat Celebrant fragments. |
| `triggerReflexiveWhenYouDoQueueUtils.ts` (`maybeQueueReflexiveDiscardWhenYouDo`) | “You may discard a card. If you do, …” is CR 603.12 reflexive (ask → discard → followup), not optionalDiscardThenDrawChoice. |
| `commander.ts` (`setCommander`) | Opening-draw safety net is only `pre_game` / empty / `pre-game`. Do not use `phase.includes('pre')` — that also matches `precombatMain`. |
| `resolutionGraveyardSelectionResumeHandlers.ts` | GY→battlefield trigger returns apply haste/exile riders for both Choice and Selection stamps. |
| `triggerGameStateOracleBridgeUtils.ts` | IR `win_game` also stamps `gameOver` (executor only sets `winner` / `status`). |
| `triggerWinGameUtils.ts` | Legacy trigger execute for leftover “you win the game” when IR trigger primary is off. Entry: `tryApplyWinTheGameFromTriggerText`. |
| `castSpellPaymentSelectionUtils.ts` | Explicit `__pool__:color` picks stay exclusive; leftover pool only fills remainder when no floating refs were selected. Non-tap sacrifice outlets (Altar) may appear on multiple payment lines. Entries: `castSpellPaymentHasExplicitFloatingRefs`, `addUnselectedFloatingPoolRemainder`, `reserveCastSpellPaymentPermanentId`. |
| `executeSpellEffectMillCards.ts` | `executeSpellEffect.ts` MillCards case. Persists optional `reason` on `mill` events. Entry: `applyMillCardsSpellEffect`. |
| `triggerReflexiveBoundSelfExilePreludeUtils.ts` | `triggerReflexiveWhenYouDoQueueUtils.ts` each-player mill prelude before then-self-exile. Stamps `reason: reflexive_bound_graveyard_self_exile_prelude`. Entry: `executeReflexiveBoundSelfExilePrelude`. |
| `oracleIrServerPromptResumeUtils.ts` | `oracleIrServerZoneSync.ts` resume-metadata / choice-gap helpers. Entries: `attachOracleIrResumeMetadata`, `findSkippedOracleStep`, `isOracleIrPlayerChoiceGap`, `normalizeTopLibraryPromptCard`. |
| `oracleIrServerScrySurveilPromptUtils.ts` | `oracleIrServerZoneSync.ts` scry/surveil prompt queue. Empty-library scry still queues printed `scryCount`. Entry: `queueTopLibraryChoicePromptsFromOracleIRResult`. |
| `oracleIrServerZoneSync-handlers/oracleIrServerLibrarySearchLookChoosePilePrompts.ts` | `oracleIrServerZoneSync.ts` LIBRARY_SEARCH / TWO_PILE_SPLIT / OPTION_CHOICE queues for `look_choose_from_top`, `look_select_top`, `search_library`, `choose_pile`. Entries: `queueLookChooseChoicePromptsFromOracleIRResult`, `queueSearchLibraryChoicePromptsFromOracleIRResult`, `queueChoosePileChoicePromptsFromOracleIRResult`. |
| `oracleIrServerBlightPromptUtils.ts` | `oracleIrServerZoneSync.ts` blight TARGET_SELECTION queue + APNAP persist as `queuedResolutionSteps`. Entry: `queueBlightChoicePromptsFromOracleIRResult`. |
| `oracleIrServerZoneSync-handlers/oracleIrServerVoteJoinForcesPrompts.ts` | `oracleIrServerZoneSync.ts` JOIN_FORCES / VOTE prompt queues. Entries: `queueJoinForcesPromptsFromOracleIRResult`, `queueVotePromptsFromOracleIRResult`. |
| `oracleIrEffectProgramServer.ts` | Spell-resolution Effect Program choice steps stamp `spellId` from the stack item and `sourceId` from the card instance. Waiting spell choices re-push the popped stack item so `applyEvent(colorChoice)` can stamp `chosenColor`. |
| `stackResolveSpellChoiceUtils.ts` | After that stamp, EP-owned “choose a color + rider” spells finish on the existing-color path and do not start a second Effect Program. |
| `ResolutionQueueManager.addStep` / `applyEvent.ts` (`kynaiosChoiceInitiated`) | Restored APNAP Kynaios steps use `allowDuringReplay` + `skipEmit` so live `STEP_ADDED` handlers cannot auto-complete the controller’s pending choice. `createResolutionStep` keeps a provided `id`. |
| `stackResolveAbilityLateHandlersUtils.ts` | After IR resolves an activated ability, still apply `applyTemporaryGraveyardKeywordGrantFromText` so “gains escape until end of turn” is an escape grant, not only generic GY permission. |
| `graveyard-permissions.ts` (`stripGenericGraveyardCastPermissionForCard`) | Escape grants strip the companion generic GY-cast permission (first-class + this-turn durable). Cleanup of the keyword grant strips it again so reminder-text cast windows do not outlive escape. |
| `triggerLifeDamageUtils.ts` (`tryApplyEachOpponentDamageTrigger`) | Same-clause riders after “deals N damage to each opponent”: life gain, and “put a +1/+1 counter on ~” (not “target”). |
| `socket/resolution.ts` | Re-exports `persistResolutionPaymentManaMutations` from `resolutionPaymentManaUtils.ts` for persist tests. |
| `stackResolveTriggeredAbilityTargetPromptUtils.ts` | Mentor triggers own `MENTOR_TARGET`. Do not defer them as generic `TARGET_SELECTION`. |
| `oracleIRExecutorImpulseExileFaceDown.ts` | Face-down exile_top / impulse_exile_top stamps `faceDown`, `canBeExaminedBy` (controller), and flexible any-type mana. `look … then exile` is a seed for impulse upgrade. |
| `stackResolvePermanentEntryUtils.ts` (`getEnteringPlaneswalkerLoyaltyValue`) | “loyalty counters … equal to your life total” uses the controller’s life. Self “if it would leave the battlefield, exile it instead” stamps `leaveBattlefieldReplacementDestination`. |
| `triggerUntapAllUtils.ts` | Generic “untap all lands/creatures/permanents you control” trigger execute (Bear Umbra granted attack text). Same-clause “tap all lands that player / defending player / they control” uses the combat-damage player on the stack item (Nature's Will). Entry: `tryApplyUntapAllYouControlTrigger`. |
| `triggerTakeExtraTurnUtils.ts` | Isolated “take an extra turn after this one” trigger execute when IR primary is off (Regenerations Restored reflexive). Entry: `tryApplyTakeExtraTurnFromTriggerText`. |
| `oracleIRParserPostprocessRepeatedProliferate.ts` | `proliferate twice` / `then proliferate again` expand, including nested `if you do` conditionals and misparsed `grant_static_ability`. Also reminder prune + Tekuthal replacement clear. |
| `replacementEffectSpec.ts` | CR 616.1a: leave-battlefield exile-instead and finality self-replacements run before the commander zone-change choice. |
| `stackResolveAbilityLateHandlersUtils.ts` | Text-driven activated exchange/donate mutates the live battlefield. Skip Oracle IR afterwards so the same swap is not applied twice. |
| `aiReflexiveExileToOwnersGraveyardChoice.ts` | AI ask-stage routing for “put N cards from exile into owners’ graveyards. If/When you do”. Entry: `chooseAIReflexiveExileToOwnersGraveyardSelection`. |
| `socket/ai.ts` (`handleAIResolutionStep`) | After completeStep, run `applyResolutionStepSideEffects` for planeswalker `TARGET_SELECTION` (loyalty + stack) and `LIBRARY_SEARCH` (fetchland put). Same path as a human response. |
| `oracleIRExecutorResolveQuantity.ts` (`object_stat` power) | `readPermanentPower` already includes +1/+1 and −1/−1. Do not add those counters again (Archdruid's Charm deals current power, not printed + 2×counters). |
| `triggerKeywordFallbackUtils.ts` | Isolated keyword-effect paraphrases (dethrone/training stack descriptions) still run the keyword handler when `triggerType` already names that keyword. |
| `oracleIRExecutorLibrarySearchCardUtils.ts` | Library search matches the front face only (CR 709.2 / 711.1c). `up to two basic land cards` requires Basic + Land, so DFC land backs (Growing Rites) are not hits. `Forest cards` matches the Forest subtype, not the phrase in the type line. Entries: `withLibrarySearchFrontFace`, `parseBasicLandLibrarySearchCriteria`, `parseLandTypeLibrarySearchCriteria`, `resolvePlayerLibraryCardsForSearch`. |
| `oracleIRExecutorPlayerStepHandlers.ts` (`applySearchLibraryStep`) | `up to N` library searches always require a player choice when any cards match — do not auto-take exactly N hits. |
| `oracleIRExecutorPlayerStepHandlers.ts` (`applyScryStep`) | Empty-library Scry N is a no-op (same as surveil). Do not queue a prompt or block later instructions (`scry 1 and you gain 1 life`). |
| `stackResolveTriggeredAbilityTargetPromptUtils.ts` | Return-to-zone GY prompts stamp both `triggeredAbilityGraveyardChoice` (live-stack assign) and `triggeredAbilityGraveyardSelection` (resolve-then-choose apply, e.g. Ratchet). Free-cast and keyword grants keep Selection only. |
| `requestCastSpellTimingGate.ts` | `requestCastSpell` sorcery-speed flash grants, including `canCastFromTop().grantsFlash` (Elsha / durable top-library). Entry: `requestCastSpellGrantsFlash`. |
| `resolutionWardUtils.ts` | Ward on pending casts when `state.stack` is missing. Entry: `resolveWardCasterForTargetSelection`. |
| `stackResolveInstantSorceryLegacyBodyUtils.ts` | Skip special/removal riders when uncategorized IR fallback already applied (destroy + “its controller gains N life”). |
| `triggers/turn-phases.ts` / `phaseSkipUtils.ts` | Additional-draw-only draw-step effects (Howling Mine / Immortal Sun) apply via `calculateAdditionalDraws` and are not a phase-skip DRAW stop. |
| `socket/library-search.ts` (`filterLibraryCardsForSearch`) | Type filters use `getLibrarySearchTypeLine`, not the combined DFC `type_line`. |
| `resolutionPaymentManaUtils.ts` | Equip/activation payment taps and pool deltas persist as discrete `permanent_tapped` / `removeManaFromPool` events (`paymentMutationsPersistedSeparately`). Replay those, not fields on the queued activate event. |
| `game-actions.ts` (`queueSelfEtbBattlefieldTutorSearch`) | Forest/battlefield self-ETB tutors are owned by stack ETB + IR `search_library`. Do not queue a second LIBRARY_SEARCH from `finalizePlayedLand`. |
| `oracleIRParserZoneAndRemovalActions.ts` (`parseMoveZoneBattlefieldAttachment`) | `move_zone` `battlefieldAttachedTo` also captures a named host. Source-name wording is rewritten to `this permanent` before parse. |
| `oracleIRExecutorMoveZoneStepHandlers.ts` (`resolveBattlefieldAttachment`) | `this permanent` / other self refs attach to `sourceId`. A leftover named host that is not the source still moves the Aura and leaves it unattached. |
| `oracleIrTriggerExecution.ts` / `stackExecuteTriggerEffectIrFallbackUtils.ts` | Bind `effectData.untappedPermanentId` / `untappedPermanentController` so “that permanent's controller mills” hits the untapped permanent's controller. |
| `oracleIrStackContextUtils.ts` (`buildStackOracleIRContext`) | Accepts `sourceName` so fallback attach/name matching sees the trigger source. |
| `triggerReflexiveWhenYouDoQueueUtils.ts` (`maybeQueueReflexiveSacrificeWhenYouDo`) | When IR trigger primary owns the text, skip the legacy sacrifice/decline prompt so Effect Program presents yes/no. |

## Other server logic (extract families started)

`replay-coverage.meta.test.ts` scans `applyEvent.ts` **and** `apply-event-handlers/*.ts` for `e.type` case bodies.

| Parent | Size now | Internal TOC | Notes |
| --- | --- | --- | --- |
| `socket/game-actions.ts` | **25.3 KB** | `game-actions-handlers/index.ts` | Under ceiling. `requestCastSpellForSocket` is a 4.8 KB orchestrator over candidate/zone, modes, and target-compute leaves. `registerGameActions` is the room guard plus `socket.on` one-liners. Never create `socket/game-actions/`. |
| `socket/interaction.ts` | **34.1 KB** | `interaction-handlers/index.ts` | Under ceiling. `registerInteractionHandlers` stays a real function. `activateBattlefieldAbility` is a family dispatcher (`tryHandleActivate*` / parse-setup / `isManaAbility` detect / generic non-mana or mana / persist). Never create `socket/interaction/`. |
| `socket/ai.ts` | **35.2 KB** | `ai-handlers/index.ts` | Under ceiling. `registerAIHandlers` stays a real wrapper. `handleAIResolutionStep` is a dispatcher. Never create `socket/ai/`. |
| `state/modules/applyEvent.ts` | **14.2 KB** | `apply-event-handlers/index.ts` | Done under ceiling. Family dispatch: `if (applyXEvents(ctx, e)) return;`. Leaves must not import `applyEvent.ts`. `reset`/`skip`/`unskip`/`remove` live in `applyEventLifecycleResetHandlers.ts`. |
| `state/planeswalker/templates/resolve.ts` | **5.1 KB** | `templates/resolve-handlers/index.ts` | Under ceiling. `tryResolvePlaneswalkerLoyaltyTemplate` is a case-family dispatcher. Never create `templates/resolve/`. |
| `state/modules/oracleIrServerZoneSync.ts` | **29.4 KB** | `oracleIrServerZoneSync-handlers/index.ts` | Under ceiling. Remaining in parent: optional-payment resume + compound resume (`resolveOracleIrOptionalPaymentPromptFromResolution`). |
| `socket/util.ts` | **13.7 KB** | `util-handlers/index.ts` | Under ceiling. `calculateManaProduction` is a dispatcher over `tryCalculateManaProduction*` leaves. |
| `state/modules/turn.ts` | **38.8 KB** | `turn-handlers/index.ts` | Under ceiling. `nextStep()` / `nextTurn()` / `dealCombatDamage()` stay as dispatchers. |
| `socket/combat.ts` | 104.4 KB | `combat-handlers/index.ts` | Declare-attackers support helpers extracted. Next: `handleDeclareAttackers`. No combat-damage-assignment cluster in this file. |
| `socket/undo.ts` | ~39.7 KB | `undo-handlers/index.ts` | Under ceiling (~260 B headroom). Further additions need a new sibling, not the parent. |
| `state/modules/can-respond.ts` | **34.2 KB** | `can-respond-handlers/index.ts` | Under ceiling. Never create `can-respond/` beside `can-respond.ts`. |

### `game-actions-handlers/` (extracted from `game-actions.ts`)

Public path stays `game-actions.ts` (`export { … } from "./game-actions-handlers/…"`). Leaves must not import the parent or the index.

| Module | Owns |
| --- | --- |
| `gameActionsCastCostReduction.ts` | Battlefield/static spell cost reduction, generic taxes, convoke, cost metadata types. |
| `gameActionsCastCostFormatting.ts` | Mana-cost adjustment arithmetic, adjusted-cost rendering, payment/pending-cast payloads. |
| `gameActionsPermanentKeywordGrants.ts` | 4-arg keyword/haste grants + summoning sickness (distinct from 2-arg `keyword-handlers.ts`). |
| `gameActionsCastSpellPaymentSources.ts` | Cast-spell payment sources: permanent refs, mana-ability costs, produced mana, checkpoints. |
| `gameActionsSpellTargetSelection.ts` | Spell target lists, grouped metadata, per-clause TARGET_SELECTION. |
| `gameActionsSpellCopyHeroicTriggers.ts` | Spell copies, copy retargeting, heroic / targeted / untap cast triggers. |
| `gameActionsSpellCastTriggerDetection.ts` | Which spell-cast triggers a cast produces; once-per-turn bookkeeping. |
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
| `gameActionsCastSpellFromHandAdditionalCosts.ts` | `handleCastSpellFromHand` additional-cost prompts (Bargain, evidence, Teamwork, Behold, discard, sacrifice, pay life, Squad) before targeting. |
| `gameActionsCastSpellFromHandTargets.ts` | Cast-time targeting (CR 601.2c): Aura hosts, spell targets, validation. |
| `gameActionsCastSpellFromHandCostConvoke.ts` | Cost assembly (alt costs, X, reductions) plus Harmonize/Convoke and the payment checkpoint. |
| `gameActionsCastSpellFromHandManaPayment.ts` | Mana-source payment: tap/sacrifice permanents, floating-pool picks, haste snapshots. |
| `gameActionsCastSpellFromHandConsumeMana.ts` | Pool consumption plus Treasure/snow provenance and converge. |
| `gameActionsCastSpellFromHandPersistOnCast.ts` | Persist `castSpell` plus on-cast trigger glue and pending cascade/scry. |
| `gameActionsCastSpellFromHandModalOverloadLife.ts` | Modal / overload / pay-X-life prompts before additional costs. |
| `gameActionsCastSpellFromHandForceFlash.ts` | Force of Will, flash/timing grants, Abundant Harvest choice. |
| `gameActionsRequestCastSpellNoTargetPayment.ts` | `requestCastSpellForSocket` no-target additional costs + mana payment queue. |
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
| `interactionActivatePlaneswalker.ts` | `tryHandleActivatePlaneswalker`. |
| `interactionActivateSacrificeCostPrompt.ts` | `tryHandleActivateSacrificeCostPrompt`. |
| `interactionActivatePayLifeExileCounters.ts` | `tryHandleActivatePayLifeExileCounters`. |
| `interactionActivateBattlefieldAbilityHelpers.ts` | Shared activate helpers (`persistAbilityActivatedTriggerPushes`, `parseStationThreshold`, `applyXValueToText`, `extractActivatedAbilitiesFromText`, …). |
| `interactionReplacementAndCyclingSocketHandlers.ts` | Replacement-effect ordering + cycling sockets. |
| `interactionActivateBattlefieldAbilityParseSetup.ts` | `trySetupActivateBattlefieldAbilityParse`, `ActivateBattlefieldAbilityParseState` (cost/sacrifice/power-up/exhaust/timing/boast setup). Returns true on error (parent return). |
| `interactionActivateGenericAbilityState.ts` | `ActivateGenericAbilityMutationState`, `ActivateGenericAbilityExtras` (primitives copied back; arrays/objects mutate in place). |
| `interactionActivateGenericNonMana.ts` | `tryHandleActivateGenericNonMana` (stack, tutors, targeting). **34.8 KB** — do not append. |
| `interactionActivateGenericMana.ts` | `tryHandleActivateGenericMana` (immediate mana production). |
| `interactionActivateBattlefieldAbilityPersist.ts` | `applyActivateBattlefieldAbilityPersist` (bumpSeq, deferred costs, replay events). Runs after both generic branches. |

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

### `apply-event-handlers/` (extracted from `applyEvent.ts`)

Family dispatch in the parent: `if (applyXEvents(ctx, e)) return;`. `activateBattlefieldAbility` is split: cost replay → `applyEventActivateBattlefieldAbilityCostReplay.ts`, stack rebuild → `applyEventActivateBattlefieldAbilityStackReplay.ts`, wrapper + leftover `cascadeResolve` → `applyEventActivateBattlefieldAbilityEvents.ts`. See `apply-event-handlers/index.ts` for the full named TOC (lobby, commander/counters/damage, stack, cast, combat, mana, activations, choices, dungeon/vote, attachments, …).

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
| `turn-handlers/turnStepCleanup.ts` | `state/modules/turn.ts` | Cleanup-step body from `nextStep()`: discard-to-hand-size, Sundial pause, Rule 514.2 damage clear, until-end-of-turn expiry. Entry: `runTurnStepCleanup`. |
| `turn-handlers/turnStepUpkeep.ts` | `state/modules/turn.ts` | Upkeep-step body from `nextStep()`: delayed upkeep dequeues, initiative venture, cumulative upkeep mana, suspend, rebound, beginning-of-upkeep triggers. Entry: `runTurnStepUpkeep`. |
| `combat-handlers/combatLegalityGates.ts` | `socket/combat.ts` | `isCurrentlyCreature`, attack/block legality, temporary combat restriction texts. |
| `combat-handlers/combatDeclareBlockersRequest.ts` | `socket/combat.ts` | `handleDeclareBlockers`; declare-blockers chat; battlefield name lookup; `persistTriggeredAbilityPush`. |
| `combat-handlers/combatDeclareAttackersSupport.ts` | `socket/combat.ts` | Declare-attackers chat; defender-id resolution; owner-attack restriction predicates; optional attack-trigger mana/energy payment (`resolveAttackTriggerManaPaymentChoice`); `processAttackTriggersAfterDeclaration`. |
| `undo-handlers/undoBoundaryPlanning.ts` | `socket/undo.ts` | Semantic action counting, boundary keys/snapshots/history, smart undo counts. |
| `undo-handlers/undoTurnPhaseTargets.ts` | `socket/undo.ts` | Earlier turn/phase/step jump targets. Entries: `listUndoTurnPhaseTargets`, `resolveUndoToTurnPhaseCount`. |
| `oracleIrServerZoneSync-handlers/oracleIrServerPostExecutionStateSync.ts` | `oracleIrServerZoneSync.ts` | Post-IR mirroring: GY→exile provenance, copy-token, prepared, linked exiles, reanimation, EOT token sacrifice/exile, impulse draws, temp abilities / P/T. |
| `oracleIrServerZoneSync-handlers/oracleIrServerLibrarySearchLookChoosePilePrompts.ts` | `oracleIrServerZoneSync.ts` | Look-choose / search-library / choose-pile prompt builders. |
| `oracleIrServerZoneSync-handlers/oracleIrServerVoteJoinForcesPrompts.ts` | `oracleIrServerZoneSync.ts` | JOIN_FORCES / VOTE prompt queues. Entries: `queueJoinForcesPromptsFromOracleIRResult`, `queueVotePromptsFromOracleIRResult`. |
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

## Oracle IR parser postprocess extracts (`rules-engine/src/`)

`oracleIRParserPostprocess.ts` is the public barrel. Family siblings (all under 40 KB):

| Module | Owns |
| --- | --- |
| `oracleIRParserPostprocessGraveyardCastPermission.ts` | GY-cast permission expansions. |
| `oracleIRParserPostprocessDrawDiscardStepSplitters.ts` | Draw/discard compound splitters. |
| `oracleIRParserPostprocessLifeDestroyLibrarySearchSteps.ts` | Life / destroy / library-search step repairs. |
| `oracleIRParserPostprocessKeywordStaticGrantSteps.ts` | Keyword static grants (annihilator/ward metadata). |
| `oracleIRParserPostprocessGraveyardAdditionalCostPermission.ts` | GY additional-cost permission. |
| `oracleIRParserPostprocessExileAndGraveyardPermissionModifiers.ts` | Exile/GY permission modifiers. |
| `oracleIRParserPostprocessCopySpellTailHelpers.ts` / `…CopySpellUnknownSteps.ts` | Copy-spell tail + unknown-step lowering. |
| `oracleIRParserPostprocessKeywordReminderPrunes.ts` | Keyword reminder prunes. |
| `oracleIRParserPostprocessGraveyardKeywordExpansions.ts` | GY keyword expansions. |
| `oracleIRParserPostprocessTokenCreationMetadata.ts` | Token-create metadata. |
| `oracleIRParserPostprocessUnlessSacrificeConditionals.ts` | Unless-sacrifice conditionals. |
| `oracleIRParserPostprocessDrawLifeDestroyMetadata.ts` | Draw/life/destroy metadata. |
| `oracleIRParserPostprocessSacrificeCounterDamageMetadata.ts` | Sacrifice/counter/damage metadata. |
| `oracleIRParserPostprocessDieRollAndReplacementExpansions.ts` | Die-roll + replacement expansions. |
| `oracleIRParserPostprocessBattlefieldEntryAndTopLibraryFollowups.ts` | Battlefield-entry + top-library follow-ups. |
| `oracleIRParserPostprocessCompoundMoveZoneAndChoiceExpansions.ts` | Compound move-zone + choice expansions. |
| `oracleIRParserPostprocessVoteRestrictionAndEmblemExpansions.ts` | Vote restriction + emblem expansions. |
| `oracleIRParserPostprocessGapClosureStepRepairs.ts` | Gap-closure step repairs (37 KB — do not append). |
| `oracleIRParserPostprocessDiscardMillLifeStepSplitters.ts` | Discard/mill/life splitters. |
| `oracleIRParserPostprocessDynamicCounterRiders.ts` | Dynamic counter riders. |
| `oracleIRParserPostprocessMoveZoneCopyAndLandAnimationExpansions.ts` | Move-zone copy + land-animation expansions. |
| `oracleIRParserPostprocessKeywordActionUnknownSteps.ts` | Keyword-action unknown-step lowering. |
| `oracleIRParserPostprocessAmassDiscoverConniveRecruitKeywords.ts` | Amass / discover / connive / recruit. |
| `oracleIRParserPostprocessClashScryExploreReminderPrunes.ts` | Clash/scry/explore reminder prunes. |
| `oracleIRParserPostprocessVanishingModularStaticPrunes.ts` | Vanishing/modular static prunes. |
| `oracleIRParserPostprocessReminderPlatformTextPredicates.ts` | Reminder/platform-only text predicates. |
| `oracleIRParserPostprocessCrewChampionLateKeywordPrunes.ts` | Crew/champion late keyword prunes. |
| `oracleIRParserPostprocessTriggerEffectFragmentPrunes.ts` | Trigger-effect fragment prunes. |
| `oracleIRParserPostprocessFutureSpellAndTokenReminderPrunes.ts` | Future-spell / token reminder prunes. |
| `oracleIRParserPostprocessDeterministicBodyAndConditionalExpansions.ts` | Deterministic body + conditional expansions. |
| `oracleIRParserPostprocessResidualUnknownLowering.ts` | Residual unknown-step lowering (head/tail of the elephant). |
| `oracleIRParserPostprocessInsteadReplacementSteps.ts` | `repairIntraAbilityInsteadConditionalSteps` — fold "create N of those tokens instead" into the base create. |
| `oracleIRParserPostprocessQuotedAbilityRiders.ts` | `extractQuotedAbilityRiderSteps` — lift quoted riders and rewrite leftover unknown residuals. |
| `oracleIRParserPostprocessCurrentBatchSurfaces.ts` | `repairCurrentBatchSurfaceSteps` — restore executable step kinds swallowed by residual rewrites. |
| `oracleIRExecutorExileOneOfThemHandlers.ts` | From `oracleIRExecutorSpecialTargetHandlers.ts`. `tryApplyExileOneOfThemLookedCards`. |

## Card data and SQLite connections (`server/src/services/`)

| Module | Owns |
| --- | --- |
| `localCardLookup.ts` | The `card_lookup` corpus connection, freshness check, and rebuild. `CARD_LOOKUP_SQLITE_FILE` picks the file; `CARD_LOOKUP_SQLITE_READONLY_FILE` names one path to open read-only with rebuild disabled. Entry points: `ensureLocalCardLookupIndexSync`, `lookupLocalCards`, `getLocalCardLookupDatabase`, `resetLocalCardLookupForTests`. |
| `oracleIrCompiledOverlayDatabase.ts` | The connection backing `oracle_ir_compiled_overlay`, the only table written at runtime. `ORACLE_IR_OVERLAY_SQLITE_FILE` moves overlays into their own database (tests use one per worker); unset, they stay in the card-lookup database. Entry points: `getCompiledOracleIROverlayDatabase`, `resetCompiledOracleIROverlayDatabaseForTests`. |
| `oracleIrCompiledOverlayStore.ts` | Overlay CRUD and envelope validation on top of that connection. |

Tests share the prebuilt 137 MB `server/data/card-lookup.sqlite` read-only rather than copying it per worker; see `server/tests/vitest.setup.ts`.

## Client (MTG logic only)

`client/src/utils/activatedAbilityParser.ts`, `client/src/utils/loopShortcuts.ts`, then `client/src/App.tsx` (388.5 KB — resolution prompts and socket dispatch only; UI chrome is out of scope).
