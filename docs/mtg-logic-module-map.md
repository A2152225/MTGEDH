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
- Folder members under ceiling: `turn-phases.ts` is **37.4 KB** (done). `zone-change.ts` is **32.3 KB** (done). `card-data-tables.ts` is **39.1 KB** (done). `combat.ts` is **30.1 KB** (done). `intervening-if.ts` is **12.6 KB** (done). `zone-changes.ts` is now ~1.9 KB (re-export barrel).

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
| `card-data-tables.ts` | Public `KNOWN_*` trigger lookup tables. `KNOWN_TAP_UNTAP_ABILITIES` re-exported from `card-data-tables-handlers/`. **39.1 KB** (done). Never create `card-data-tables/` beside the `.ts`. Extract existing tables only — do not add card-name rows. |
| `card-data-tables-handlers/index.ts` | Internal TOC barrel. Named re-exports only. Leaves must not import the parent or this index. |
| `card-data-tables-handlers/cardDataTablesTapUntapAbilities.ts` | From `card-data-tables.ts`. `KNOWN_TAP_UNTAP_ABILITIES`. Parent re-exports. |
| `zone-change.ts` | Public exile-from-battlefield get/queue, put-into-graveyard-from-anywhere, left-graveyard. **32.3 KB** (done). Distinct from `zone-changes.ts` (death/ETB/attack barrel). Never create `triggers/zone-change/` beside the `.ts`. |
| `zone-change-handlers/index.ts` | Internal TOC for extracts from `triggers/zone-change.ts`. Named re-exports only. Leaves must not import the parent or this index. |
| `zone-change-handlers/exileFromBattlefieldDetection.ts` | From `triggers/zone-change.ts`. `ExiledFromBattlefieldTrigger`, `detectExiledFromBattlefieldTriggers`. Parent re-exports. Distinct from death/ETB/attack. |
| `turn-phases.ts` | Public turn-phase detectors/emitters. **37.4 KB** (done). `EndStepTrigger` and `detectEndStepTriggers` re-exported from `turn-phases-handlers/`. Never create `turn-phases/` beside the `.ts`. |
| `turn-phases-handlers/index.ts` | Internal TOC barrel. Named re-exports only. Leaves must not import the parent or this index. |
| `turn-phases-handlers/turnPhaseTriggerTypes.ts` | From `turn-phases.ts`. `EndStepTrigger`. Parent re-exports. |
| `turn-phases-handlers/turnPhaseActivePermanentFace.ts` | From `turn-phases.ts`. `getActivePermanentCardFace`. |
| `turn-phases-handlers/turnPhaseEffectChoiceHelpers.ts` | From `turn-phases.ts`. `detectRequiresChoice`, `detectAffectsAllPlayers`. |
| `turn-phases-handlers/turnPhaseEndStepTriggers.ts` | From `turn-phases.ts`. `detectEndStepTriggers`. Parent re-exports. |

## Oracle IR parser / postprocess (`rules-engine/src/`)

- `oracleIRParserPostprocess.ts` is a **12.5 KB barrel** (named re-exports + a few leftover imports). All `oracleIRParserPostprocess*.ts` siblings are under the ceiling (largest: `oracleIRParserPostprocessGapClosureStepRepairs.ts` at 37.0 KB). Add a new family file; do not append to a sibling near 36–40 KB.
- `oracleIRParser.ts` is a **0.1 KB barrel**: `export { parseOracleTextToIR } from './oracleIRParserParseOracleTextToIR'`.
- `oracleIR.ts` is a **1.0 KB barrel**: re-exports shared types + `OracleEffectStep` (`A | B | C`) plus leftover `OracleIRAbility` / `OracleIRResult`. Never create `oracleIR/` beside `oracleIR.ts`.
- Keep the `oracleIRParser*` / `oracleIRExecutor*` prefixes. No folder move until a parent is already a thin barrel.
- `oracleIRParserEffectImpulsePermission.ts` is a **26.7 KB** dispatcher (`parseEffectLevelImpulsePermissionClause` leftover early / from-among if-chain + late `tryParse` call). `oracleIRParserLifeAndCombatClauses.ts` is a **0.1 KB barrel** (`tryParseLifeAndCombatClause`; existing BOM kept — do not add another). `oracleIRParserUtils.ts` is a **28.2 KB** dispatcher (`parseQuantity` leftover numeric / late-reference if-chain + `parsePlayerSelector` / `splitIntoClauses` / `normalizeClauseForParse`). `oracleIRParserStaticAbilityClauses.ts` is a **33.1 KB** dispatcher (`tryParseStaticAbilityGrantClause` leftover if-chain + re-export of `tryParseRulesTextClause`). `oracleIRParserSimpleActionClauses.ts` is a **4.0 KB** dispatcher (`tryParseSimpleActionClause` + family `tryX`).

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
| `oracleIRParserEffectImpulsePermission-handlers/index.ts` | `oracleIRParserEffectImpulsePermission.ts` | Internal TOC barrel. Named re-exports only. Never create `oracleIRParserEffectImpulsePermission/` beside the `.ts`. |
| `oracleIRParserEffectImpulsePermission-handlers/oracleIRParserEffectImpulsePermissionLateDurations.ts` | `oracleIRParserEffectImpulsePermission.ts` | Late next-turn / until-end / remains-exiled if-chain of `parseEffectLevelImpulsePermissionClause`. `undefined` = fall through. Do not import the parent. |
| `oracleIRParserStaticAbilityClauses-handlers/oracleIRParserStaticAbilityGrantParseUtils.ts` | `oracleIRParserStaticAbilityClauses.ts` | `WithMeta` plus keyword-list, signed P/T, and graveyard grant parse helpers. |
| `oracleIRParserStaticAbilityClauses-handlers/oracleIRParserStaticAbilityGrantEarlyClauses.ts` | `oracleIRParserStaticAbilityClauses.ts` | First if-chain of `tryParseStaticAbilityGrantClause` (permission / P/T / quoted grant). `undefined` = fall through; `null` = abort the whole grant parse. Do not import the parent. |
| `oracleIRParserStaticAbilityClauses-handlers/oracleIRParserStaticAbilityRulesTextClause.ts` | `oracleIRParserStaticAbilityClauses.ts` | `tryParseRulesTextClause` (parent re-exports). |
| `oracleIRParserLifeAndCombatClauses-handlers/oracleIRParserLifeAndCombatParseUtils.ts` | `oracleIRParserLifeAndCombatClauses.ts` | `parseDamageAmount`, `parseLifeChangeAmount`, damage-clause subject/amount patterns, `isDamageAmountDescriptor`, `shouldSkipGenericDamageSource`, `normalizeDamageClauseForParse`. Do not import the parent. |
| `oracleIRParserLifeAndCombatClauses-handlers/oracleIRParserLifeAndCombatClause.ts` | `oracleIRParserLifeAndCombatClauses.ts` | `tryParseLifeAndCombatClause` (parent re-exports). **33.0 KB** — do not append. Never create `oracleIRParserLifeAndCombatClauses/` beside the `.ts`. |
| `oracleIRParserUtils-handlers/oracleIRParserUtilsQuantityEarlyReferences.ts` | `oracleIRParserUtils.ts` | First if-chain of `parseQuantity` (reference-amount / object-stat / phrase). Recursion is a `parseRest` callback — do not import the parent. `null` = fall through. |
| `oracleIR-handlers/oracleIRSharedTypes.ts` | `oracleIR.ts` | `OracleQuantity`, `OraclePlayerSelector`, `OracleObjectSelector`, `OracleScaler`, `OracleClauseCondition`, `OracleGraveyardAdditionalCost`, `OracleBattlefieldObjectCondition`, `OracleZone`. |
| `oracleIR-handlers/oracleIREffectStepA.ts` | `oracleIR.ts` | `OracleEffectStepA` (`grant_next_spell_cost_reduction` … `fateseal`). Nested `steps` use the full `OracleEffectStep` alias. Do not import the parent or index. |
| `oracleIR-handlers/oracleIREffectStepB.ts` | `oracleIR.ts` | `OracleEffectStepB` (`learn` … `prevent_damage`). |
| `oracleIR-handlers/oracleIREffectStepC.ts` | `oracleIR.ts` | `OracleEffectStepC` (`damage_cant_be_prevented` … `unknown`). |
| `oracleIR-handlers/oracleIREffectStep.ts` | `oracleIR.ts` | Public `OracleEffectStep` alias (`A \| B \| C`). Parent re-exports. |

Guard-run hoists out of `parseCurrentResidualUnknownStep` live in `oracleIRParserPostprocessResidual*Guards.ts` (static grant, entry/permission, text/catalog, combat/counter/payment, perpetual/secret, reflexive, mana/phasing/attach, number-change/group P/T, named-mode search, attacker/token, self-ref/library-order, ward/evidence). `parseStructuredTriggerResidualGrant` lives in `oracleIRParserPostprocessTriggerResidual*Pt*.ts`. Reminder/platform text is `oracleIRParserPostprocessCurrentBatchReminder*.ts`.

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
| `triggerEtbGraveyardTargetPrompt.ts` | Extracted from `triggerEtbEntryEffects.ts`. Self-ETB graveyard target prompt. `you may cast target … from your graveyard` uses destination `cast` plus `triggeredAbilityCastFromGraveyard`. Entry: `queueSelfEtbGraveyardTargetPrompt`. Parent `triggerEtbEntryEffects.ts` is now a **2.9 KB** re-export barrel (`triggerEtbEntryEffects-handlers/`). |
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
| `graveyard-permissions-handlers/graveyardPermissionsStripGenericCast.ts` (`stripGenericGraveyardCastPermissionForCard`) | Escape grants strip the companion generic GY-cast permission (first-class + this-turn durable). Cleanup of the keyword grant strips it again so reminder-text cast windows do not outlive escape. Public path still re-exports from `graveyard-permissions.ts`. |
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
| `state/planeswalker/templates/registry.ts` | **2.1 KB** | `templates/registry-handlers/index.ts` | Under ceiling. `getPlaneswalkerTemplateMatch` is a 4-phase dispatcher plus `allowFallback`. Never create `templates/registry/`. Distinct from `templates/resolve-handlers/`. |
| `state/modules/oracleIrServerZoneSync.ts` | **29.4 KB** | `oracleIrServerZoneSync-handlers/index.ts` | Under ceiling. Remaining in parent: optional-payment resume + compound resume (`resolveOracleIrOptionalPaymentPromptFromResolution`). |
| `socket/util.ts` | **13.7 KB** | `util-handlers/index.ts` | Under ceiling. `calculateManaProduction` is a dispatcher over `tryCalculateManaProduction*` leaves. |
| `state/utils.ts` | **35.3 KB** | `utils-handlers/index.ts` | Under ceiling. Public path stays `utils.ts`. Never create `state/utils/` beside `utils.ts` (`state/utils/diff.ts` is unrelated). Life-gain (`applyLifeGain` / `triggerLifeGainEffects`) still in parent. Distinct from `socket/util-handlers/`. |
| `state/modules/turn.ts` | **38.8 KB** | `turn-handlers/index.ts` | Under ceiling. `nextStep()` / `nextTurn()` / `dealCombatDamage()` stay as dispatchers. |
| `socket/combat.ts` | **28.5 KB** | `combat-handlers/index.ts` | Under ceiling. `registerCombatHandlers` stays a real function (preview, skip, apply/clear control, `declareControlledBlockers`). Never create `socket/combat/`. |
| `rules-engine/src/actions/combat.ts` | **36.6 KB** | `actions/combat-handlers/index.ts` | Under ceiling (near warning). Remaining: blocker capacity, `getLegalAttackers` / `getLegalBlockers`, `executeDeclareAttackers`, `validateDeclareBlockers` / `executeDeclareBlockers`, `executeCombatDamage`. Never create `actions/combat/` beside `combat.ts`. Distinct from `socket/combat-handlers/`. Dual-copy: socket `isCurrentlyCreature` / `canPermanentAttack`, AI `executeDeclareBlockers`, and `turn.ts` `dealCombatDamage` are different functions — do not merge. |
| `rules-engine/src/actions/triggersHandler.ts` | **39.0 KB** | `actions/triggersHandler-handlers/index.ts` | Under ceiling (~1 KB headroom). Remaining: `findCardInPlayersGraveyards` / `buildObjectTypeTokens` / `looksLikeSelfDiesTrigger`; `processTriggers` / `processTriggersAutoOracle`; `checkETBTriggers`, `checkDiesTriggers`, `checkDelayedEventTriggers`, `checkTribalCastTriggers`, `checkLandfallTriggers`, `checkSpellCastTriggers`, `checkDrawTriggers`, `checkAttackTriggers`, `checkAttacksAloneTriggers`, `checkCombatDamageToPlayerTriggers`, `checkBecomesBlockedTriggers`. Never create `actions/triggersHandler/` beside `triggersHandler.ts`. Dual-copy: server `detectETBTriggers` / `detectDeathTriggers` / `detectAttackTriggers` and `zoneChangeTracking.ts` `checkETBTriggers` / `checkDiesTriggers` are different functions — do not merge. Further additions need a sibling, not the parent. |
| `socket/deck.ts` | **36.0 KB** | `deck-handlers/index.ts` | Under ceiling (near warning). `registerDeckHandlers` stays a real function (CRUD / candidates / can-import-without-wipe). `handleImportWipeConfirmVote` stays exported from the parent. Never create `socket/deck/`. |
| `socket/join.ts` | **38.4 KB** | `join-handlers/index.ts` | Under ceiling. `registerJoinHandlers` stays a real function (`joinGame` / `requestState`). Never create `socket/join/`. Dual-copy: join’s larger `ensureStateZonesForPlayers` / `defaultPlayerZones` live in `join-handlers/joinEnsureStateZones.ts`; a smaller pair remains in `util-handlers/playerStateZones.ts` — do not merge in a split. |
| `socket/undo.ts` | ~39.7 KB | `undo-handlers/index.ts` | Under ceiling (~260 B headroom). Further additions need a new sibling, not the parent. |
| `state/modules/can-respond.ts` | **34.2 KB** | `can-respond-handlers/index.ts` | Under ceiling. Never create `can-respond/` beside `can-respond.ts`. |
| `rules-engine/targeting.ts` | **34.9 KB** | `targeting-handlers/index.ts` | Under ceiling. `categorizeSpellWithoutPrimaryRetirement` is a dispatcher over `tryCategorize…`. Never create `targeting/` beside `targeting.ts`. |
| `rules-engine/staticEffects.ts` | **28.9 KB** | `staticEffects-handlers/index.ts` | Under ceiling. `computeContinuousEffects` stays the exported dispatcher (init, hexproof/anthems/ability grants, chosen-type/color, global type-additions). Never create `staticEffects/` beside `staticEffects.ts`. |
| `rules-engine/src/AutomationService.ts` | **28.9 KB** | `AutomationService-handlers/index.ts` | Under ceiling. Remaining: `autoTapForMana`, `hasAvailableActions`, `processTriggeredAbilities` + `matchTrigger`, `runAutomation`, SBA/untap/draw/cleanup. Never create `AutomationService/` beside `AutomationService.ts`. Dual-copy: leaf `calculateCombatDamage`/`applyCombatDamage` (GameState automation API, index aliases `autoCalculateCombatDamage` / `autoApplyCombatDamage`) ≠ `combatDamageEnhanced.ts` `calculateCombatDamage`. |
| `rules-engine/src/RulesEngineAdapter.ts` | **39.3 KB** | `RulesEngineAdapter-handlers/index.ts` | Under ceiling (~690 B headroom). Class stays; methods are thin `.call(this)` wrappers. Remaining real bodies: event wiring, `initializeGame` / `validateAction`, combat-declare validation, delayed dies/control-loss, pass-priority / mulligan / empty-pools, leftover SBA/win/death shims. Never create `RulesEngineAdapter/` beside `RulesEngineAdapter.ts`. Further additions need a sibling, not the parent. |
| `rules-engine/src/CardAnalyzer.ts` | **33.9 KB** | `CardAnalyzer-handlers/index.ts` | Under ceiling. Public path stays `CardAnalyzer.ts`. Class stays; `analyzeDeck` is a thin `.call(this)` wrapper. Remaining real bodies: `analyzeCard`, `analyzeBattlefield`, synergy/sacrifice helpers, private categorize/details/threat/combo/removal. Never create `CardAnalyzer/` beside `CardAnalyzer.ts`. |
| `rules-engine/src/AIEngine.ts` | **38.1 KB** | `AIEngine-handlers/index.ts` | Under ceiling. Public path stays `AIEngine.ts`. Class stays; `analyzeLibraryForPlanning` is a thin `.call(this)` wrapper. Remaining real bodies: registry/history, `findHandSynergies`, `selectRemovalTarget`, `evaluateSymmetricEffect`, `selectSacrificeTarget`, `detectOpponentCombo`, `makeDecision` dispatcher. Existing flat `aiEngine*.ts` siblings stay put — do not append. Never create `AIEngine/` beside `AIEngine.ts`. Dual-copy: `assessBattlefieldThreats` already lives in `aiEngineThreatSupport.ts`. |
| `rules-engine/src/oracleTextParser.ts` | **33.0 KB** | `oracleTextParser-handlers/index.ts` | Under ceiling. Remaining: `parseTriggeredAbility`, `parseReplacementEffect`, `parseKeywordActions`, spell-instruction predicates (`isSpellInstructionLineInner` / `isSpellInstructionLine`), `parseDelayedTrigger`, `hasTriggeredAbility` / `hasActivatedAbility` / `hasReplacementEffect`. Never create `oracleTextParser/` beside `oracleTextParser.ts`. Runtime seam: `oracleTextParserHandlerDeps.ts`. Existing flat siblings `oracleTextParserPreprocess.ts`, `oracleTextParserSupport.ts`, `oracleTextParserKeywordCosts.ts`, `oracleTextParserKeywordActionAbilities.ts`, `oracleTextParserKeywordTriggers.ts` stay put. |
| `rules-engine/src/triggeredAbilitiesEventDetection.ts` | **39.7 KB** | `triggeredAbilitiesEventDetection-handlers/index.ts` | Under ceiling (~325 B headroom). `detectTriggeredAbilityEvent` stays the exported dispatcher (leftover 39.5 KB if-chain + early `tryParse` call). Never create `triggeredAbilitiesEventDetection/` beside the `.ts`. Dual-copy: server `detectETBTriggers` / `detectDeathTriggers` / `detectAttackTriggers` are different functions — do not merge. Further additions need a sibling, not the parent. |
| `rules-engine/src/effectProgram.ts` | **23.0 KB** | `effectProgram-handlers/index.ts` | Under ceiling. Remaining: `createEffectProgramRuntime`, `bindEffectProgramChoiceResponse`, `createChoiceEventFromEffectProgramChoiceRequest`, `runEffectProgram`, plus choice-payload coercers and run-loop helpers. Never create `effectProgram/` beside `effectProgram.ts`. `effectProgramAppendOracleStep.ts` is **33.9 KB** — do not append. |
| `rules-engine/src/effectProgramOracleRunner.ts` | **38.8 KB** | `effectProgramOracleRunner-handlers/index.ts` | Under ceiling. Remaining: `createOracleIRCommandHandler`, graveyard-permission apply, `createOracleIREffectProgramHandlers`, `createOracleIRChoiceEvent` (10.2 KB), `buildEffectProgramsFromOracleText`, apply-* choice commands (top-library / explore / proliferate / clash / populate). Never create `effectProgramOracleRunner/` beside `effectProgramOracleRunner.ts`. |
| `state/modules/game-state-effects.ts` | **5.2 KB** | `game-state-effects-handlers/index.ts` | Under ceiling (re-export barrel). Never create `game-state-effects/` beside `game-state-effects.ts`. `WinCondition` here is the card-effect table type, not `triggers/win-conditions.ts`. |
| `state/modules/mana-abilities.ts` | **38.4 KB** | `mana-abilities-handlers/index.ts` | Under ceiling. Remaining: `getManaMultiplier`, `getExtraManaProduction`, devotion cluster, `getCreatureCountManaAmount`, `getThroneOfEldraineManaTaps`, `requiresManaColorChoice`. Never create `mana-abilities/` beside `mana-abilities.ts`. Dual-copy: leftover `calculateDevotion` / `getDevotionManaAmount` ≠ `triggers/devotion.ts`. |
| `state/modules/mana-check.ts` | **3.6 KB** | `mana-check-handlers/index.ts` | Under ceiling (re-export barrel). Remaining: `buildNormalizedManaPaymentModel`. Never create `mana-check/` beside `mana-check.ts`. `manaCheckExactSources.ts` is **34.6 KB** — do not append. |
| `state/modules/counters_tokens.ts` | **24.6 KB** | `counters_tokens-handlers/index.ts` | Under ceiling. Public path stays `counters_tokens.ts`. Runtime seam: `countersTokensHandlerDeps.ts`. Remaining: counter placement, `destroyPermanent` / `removePermanent`, devotion / god status, `applyEngineEffects`. Never create `counters_tokens/` beside `counters_tokens.ts`. Dual-copy: leftover `calculateDevotion` also exists in `mana-abilities.ts`, `triggers/devotion.ts`, and `gameStateEffectsBattlefieldQueries.ts` — do not merge in a split. |
| `state/modules/zones.ts` | **35.7 KB** | `zones-handlers/index.ts` | Under ceiling. Remaining: import/shuffle, Zur's/dredge apply + `findDredgeAmount`, hand/library utilities (`moveHandToLibrary`, peek/select/reorder, scry/surveil/explore/search, put-on-library), `reconcileZonesConsistency`, `applyPreGameReset`. Never create `zones/` beside `zones.ts`. Dual-copy: leftover `clearPreparedStateOnBattlefieldExit` also exists as a private function in `counters_tokens.ts` — do not merge in a split. `moveRemovedPermanentToExile` ≠ `counters_tokens` `movePermanentToExile`. |
| `state/modules/graveyard-permissions.ts` | **36.8 KB** | `graveyard-permissions-handlers/index.ts` | Under ceiling (near warning). Remaining: static-source permissions, `addGraveyardCastingPermission`, durable conversion, printed self-cast, `findGrantedKeywordInfo`. Never create `graveyard-permissions/` beside `graveyard-permissions.ts`. Dual-copy: `oracleIRParserPostprocessGraveyardCastPermission` and `graveyardPermissionAdditionalCost` are different modules — do not merge. |
| `state/modules/keyword-handlers.ts` | **38.6 KB** | `keyword-trigger-handlers/index.ts` | Under ceiling. `processKeywordTrigger` stays a real switch dispatcher. Never create `keyword-handlers/` beside `keyword-handlers.ts`. Dual-copy: 2-arg `permanentHasKeyword` ≠ 4-arg `gameActionsPermanentKeywordGrants`. |
| `state/modules/keyword-detection.ts` | **31.9 KB** | `keyword-detection-handlers/index.ts` | Under ceiling. Public path stays `keyword-detection.ts`. Remaining: STATIC / REPLACEMENT / KEYWORD_ACTION pattern tables, `detectKeywords`, `battlefieldGrantsRiotToPermanent`, timing/filter helpers. Never create `keyword-detection/` beside `keyword-detection.ts`. Dual-copy: `detectKeywords` is consumed by `keyword-handlers.ts` / `keyword-trigger-handlers` — do not create a third copy. `status-keyword-detection.ts` is a different leftover detector. |
| `state/modules/triggerEtbEntryEffects.ts` | **2.9 KB** | `triggerEtbEntryEffects-handlers/index.ts` | Under ceiling (re-export barrel). Never create `triggerEtbEntryEffects/` beside `triggerEtbEntryEffects.ts`. Dual-copy: `persistTriggeredAbilityPush` here ≠ `combatDeclareBlockersRequest.ts`. Sibling `triggerEtbGraveyardTargetPrompt.ts` is a prior extract, not in the handlers folder. |
| `state/modules/stackResolvePermanentEntryUtils.ts` | **34.0 KB** | `stackResolvePermanentEntryUtils-handlers/index.ts` | Under ceiling. Remaining: loyalty helpers, thin `queueMutateTriggeredAbilities` wrapper, `resolvePermanentSpellBattlefieldEntry` (28.8 KB). Never create `stackResolvePermanentEntryUtils/` beside the `.ts`. |
| `state/modules/dungeon-effects.ts` | **33.6 KB** | `dungeon-effects-handlers/index.ts` | Under ceiling. Remaining: scry/library-search helpers, `applyLifeChange`, choice-entry builders, `applyDungeonTargetCreatureEffect` / `applyDungeonTargetPlayerEffect` / `applyAutomaticDungeonRoomEffect`, `buildDungeonRoomPenaltyFollowUpStep`, `buildDungeonRoomPromptSteps` / `buildDungeonRoomPromptStep`. Never create `dungeon-effects/` beside `dungeon-effects.ts`. |
| `state/modules/executeSpellEffect.ts` | **3.0 KB** | `executeSpellEffect-handlers/index.ts` | Under ceiling. Public path stays `executeSpellEffect.ts` with thin wrappers for `executeSpellEffect`, `scheduleExiledCardReturnToBattlefield`, `returnExiledCardToBattlefield`. Never create `executeSpellEffect/` beside `executeSpellEffect.ts`. Flat sibling `executeSpellEffectMillCards.ts` stays put. Existing BOM kept — do not add another. |
| `state/modules/upkeep-triggers.ts` | **19.0 KB** | `upkeep-triggers-handlers/index.ts` | Under ceiling. Remaining: `recordUpkeepBegan`, `stampPermanentControlEntryForEcho`, saga lore helpers, `getUpkeepTriggersForPlayer`, age/fade/time/echo/lore counters, `sacrificePermanent`, `checkSagaSacrifice`, `autoProcessCumulativeUpkeepMana`. Never create `upkeep-triggers/` beside `upkeep-triggers.ts`. Dual-copy: none — `detectUpkeepTriggers` / `UpkeepTrigger` lived only in this parent. |
| `state/modules/triggerReflexiveWhenYouDoQueueUtils.ts` | **37.7 KB** | `triggerReflexiveWhenYouDoQueueUtils-handlers/index.ts` | Under ceiling. Remaining: other `maybeQueue*` families, `tryDeferReflexiveWhenYouDoTriggers`, `queueOracleIrReflexiveWhenYouDoFollowups`. Never create `triggerReflexiveWhenYouDoQueueUtils/` beside the `.ts`. Flat sibling `triggerReflexiveBoundSelfExilePreludeUtils.ts` stays put. |
| `state/modules/replacementEffectSpec.ts` | **39.5 KB** | `replacementEffectSpec-handlers/index.ts` | Under ceiling (~516 B headroom). Remaining: builtins, intrinsic shuffle-into-library, overlay match/summarize, `evaluateReplacementEffectSpec`, dredge. Never create `replacementEffectSpec/` beside `replacementEffectSpec.ts`. Further additions need a sibling, not the parent. |

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
| `combat-handlers/combatDeclareAttackersForceTapSupport.ts` | `socket/combat.ts` | Exert/enlist enqueue, goad status, forced-attack check, tap-on-attack triggers. |
| `combat-handlers/combatDeclareAttackersExecute.ts` | `socket/combat.ts` | `executeDeclareAttackers` (AI / paid-attack / resolution-queue path). |
| `combat-handlers/combatControlState.ts` | `socket/combat.ts` | `getCombatControl` / `setCombatControl`. |
| `combat-handlers/combatDeclareAttackersRequest.ts` | `socket/combat.ts` | `handleDeclareAttackers`. |
| `combat-handlers/combatDeclareControlledAttackersRequest.ts` | `socket/combat.ts` | `handleDeclareControlledAttackers`. |
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

### `targeting-handlers/` (extracted from `targeting.ts`)

Public path stays `targeting.ts`. Leaves must not import `targeting.ts` or the index. Never create `targeting/` beside `targeting.ts`. `categorizeSpellWithoutPrimaryRetirement` keeps the exported dispatcher: normalize oracle, suppress exile/counter-all-spells, then `tryCategorize…` (`null` = fall through).

| Module | Owns |
| --- | --- |
| `targetingSpellSpecTypes.ts` | `SpellOp`, `SpellSpec`, filters/restrictions. |
| `targetingCategorizeCountUtils.ts` | `parseCountWord`, `titleCaseWords`. |
| `targetingCategorizePermanentFilter.ts` | `detectCategorizePermanentFilter`. |
| `targetingParseTargetRequirements.ts` | `parseTargetRequirements`, `matchesGraveyardCardTargetType`, `requiresTargeting`, `GroupedTargetRequirement`. |
| `targetingCategorizeStackCounterSimpleTemplates.ts` | Stack/counter/simple templates. |
| `targetingCategorizeScryMillMassRemoval.ts` | Scry/mill/mass-removal templates. |
| `targetingCategorizeDamageFlickerRestrictions.ts` | Damage/flicker/restriction templates. |
| `targetingCategorizeTapBounceGenericTargets.ts` | Tap/bounce/generic-target templates. |

### `staticEffects-handlers/` (extracted from `staticEffects.ts`)

Public path stays `staticEffects.ts`. Leaves must not import `staticEffects.ts` or the index. Never create `staticEffects/` beside `staticEffects.ts`. `computeContinuousEffects` keeps the exported dispatcher: init + hexproof/anthems/ability grants/chosen-type-color/global type-additions, then `applyMonumentLordAndSharedTypeEffects` for the monument/lord/shared-type phase.

| Module | Owns |
| --- | --- |
| `staticEffectsKnownCards.ts` | `KNOWN_STATIC_EFFECT_CARDS` (extracted as-is; unused by computeContinuousEffects). |
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
| `gameStateEffectsWinLose.ts` | Win / lose / can't-lose, life change, empty-library draw, ascend. |
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

### `AutomationService-handlers/` (extracted from `AutomationService.ts`)

Public path stays `rules-engine/src/AutomationService.ts`. Leaves must not import the parent or the index. Never create `AutomationService/` beside `AutomationService.ts`. Dual-copy: leaf combat-damage API ≠ `combatDamageEnhanced.ts`.

| Module | Owns |
| --- | --- |
| `automationServiceDecisionTypes.ts` | `DecisionType`, `PendingDecision`, `DecisionOption`, `SelectionFilter`, `DecisionResult`, `AutomationContext`, `AutomationResult`. |
| `automationServiceCombatDamage.ts` | `calculateCombatDamage`, `applyCombatDamage`, `CombatDamageAssignment`, exclusive combat helpers. |
| `automationServiceTargetDecisionTypes.ts` | `TargetingSourceInfo`, `TargetDecisionZone`, `TargetDecisionConstraints`. |
| `automationServiceTargetDecisionBuilders.ts` | `requiresDecisionToResolve` plus target/mode/X builders (`parseTargetTypes`, `buildTargetDecisionOptions`, …). |

### `RulesEngineAdapter-handlers/` (extracted from `RulesEngineAdapter.ts`)

Public path stays `rules-engine/src/RulesEngineAdapter.ts`. Leaves must not import the parent or the index. Never create `RulesEngineAdapter/` beside `RulesEngineAdapter.ts`. Class methods in the parent are thin `.call(this)` wrappers.

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
| `combatLegalityHelpers.ts` | `isCurrentlyCreature`, `hasDefender`, `canPermanentAttack`, `hasHaste`, `canPermanentBlock`, `checkEvasionAbilities`, `hasAbility`, `CombatValidationResult`. |
| `combatPermanentPower.ts` | `getPermanentPower`. |
| `combatGoadHelpers.ts` | `buildProcessedBattlefieldForGoad`, `isGoaded`, `getGoadedBy`, `getGoadedAttackTargets`, `canGoadedCreatureAttack`. |
| `combatGoadedAttackers.ts` | `getGoadedAttackers`. |
| `combatValidateDeclareAttackers.ts` | `validateDeclareAttackers`. |

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
| `countersTokensStateBasedActions.ts` | `runSBA`, `resolveLegendRuleChoice`. |
| `countersTokensHandlerDeps.ts` | Runtime seam for `runSBA` / GY / counter-mod / battlefield-exit / god-status. |

### `zones-handlers/` (extracted from `zones.ts`)

Public path stays `zones.ts`. Leaves must not import the parent or the index. Never create `zones/` beside `zones.ts`. Dual-copy: `clearPreparedStateOnBattlefieldExit` also exists as a private function in `counters_tokens.ts` — do not merge. `moveRemovedPermanentToExile` ≠ `movePermanentToExile`.

| Module | Owns |
| --- | --- |
| `zonesClearPreparedOnBattlefieldExit.ts` | `clearPreparedStateOnBattlefieldExit` (soulbond unpair + prepared cleanup). |
| `zonesDrawReplacementZursQueue.ts` | `getOpponentsForPlayer`, `queueZursWeirdingOpponentStep`, `queueZursWeirdingDrawReplacementStep`. |
| `zonesDrawReplacementDredgeQueue.ts` | `queueDredgeDrawReplacementStep`. |
| `zonesDrawCards.ts` | `DrawCardsOptions`, `persistDrawCardsEvent`, `drawCards`, `drawCardsByIds`, `processDrawTriggers`. |
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

Public path stays `stackResolvePermanentEntryUtils.ts`. Leaves must not import the parent or the index. Never create `stackResolvePermanentEntryUtils/` beside the `.ts`. Parent keeps a thin `queueMutateTriggeredAbilities` wrapper.

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
| `upkeepTriggerDetect.ts` | Oracle-text upkeep trigger detection. Entry: `detectUpkeepTriggers`. |

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
| `replacementEffectSpecLifeGainOracleTemplates.ts` | Life-gain oracle templates + `collectOraclePatternLifeGainReplacementSpecsFromState`. |
| `replacementEffectSpecCounterOracleTemplates.ts` | Counter templates + collect. |
| `replacementEffectSpecLibrarySearchOracleTemplates.ts` | Library-search templates + collect. |
| `replacementEffectSpecDamageOracleTemplates.ts` | Damage templates, prevent-all-but parsers, emblem sources, `overlaySpecsMatchDamage`. |
| `replacementEffectSpecDrawOracleTemplates.ts` | Draw templates + collect. |
| `replacementEffectSpecTokenOracleTemplates.ts` | Token templates + collect. |
| `replacementEffectSpecMillOracleTemplates.ts` | Mill templates + collect. |
| `replacementEffectSpecZoneChangeOracleTemplates.ts` | Oracle zone-change templates + collect. |

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
| `oracleIRExecutorExileLookedContextualHandlers.ts` | From `oracleIRExecutorSpecialTargetHandlers.ts`. `tryApplyExileLookedContextualStep`. |
| `oracleIRExecutorExilePileCounterAndTargetedHandlers.ts` | From `oracleIRExecutorSpecialTargetHandlers.ts`. `tryApplyExilePileCounterAndTargetedStep`. |

## Card data and SQLite connections (`server/src/services/`)

| Module | Owns |
| --- | --- |
| `localCardLookup.ts` | The `card_lookup` corpus connection, freshness check, and rebuild. `CARD_LOOKUP_SQLITE_FILE` picks the file; `CARD_LOOKUP_SQLITE_READONLY_FILE` names one path to open read-only with rebuild disabled. Entry points: `ensureLocalCardLookupIndexSync`, `lookupLocalCards`, `getLocalCardLookupDatabase`, `resetLocalCardLookupForTests`. |
| `oracleIrCompiledOverlayDatabase.ts` | The connection backing `oracle_ir_compiled_overlay`, the only table written at runtime. `ORACLE_IR_OVERLAY_SQLITE_FILE` moves overlays into their own database (tests use one per worker); unset, they stay in the card-lookup database. Entry points: `getCompiledOracleIROverlayDatabase`, `resetCompiledOracleIROverlayDatabaseForTests`. |
| `oracleIrCompiledOverlayStore.ts` | Overlay CRUD and envelope validation on top of that connection. |

Tests share the prebuilt 137 MB `server/data/card-lookup.sqlite` read-only rather than copying it per worker; see `server/tests/vitest.setup.ts`.

## Client (MTG logic only)

`client/src/utils/activatedAbilityParser.ts`, `client/src/utils/loopShortcuts.ts`, then `client/src/App.tsx` (388.5 KB — resolution prompts and socket dispatch only; UI chrome is out of scope).
