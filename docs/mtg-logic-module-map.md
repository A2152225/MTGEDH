# MTG logic module map

Finder for agents and humans: **which module owns which mechanic**, so nobody opens a 1 MB parent to answer "where does discard resume live?".

- Size ceiling and split rules: `.cursor/rules/typescript-max-40kb-split.mdc`
- Extraction playbook and paste prompts: `.cursor/skills/split-ts-module/SKILL.md`
- Current byte sizes: `node tools/ts-logic-file-sizes.mjs` (add `--all`, `--top N`, `--scope <dir>`, `--json`)

## How to update (required, ~5 lines per session)

At the **end of every extract session**, add or edit one row: new module, the parent it left, and its main exported entry points. Do not batch this up for later — a stale map sends the next agent back into the megafile.

This file is a stub seeded from the Campaign 0 inventory. Rows marked *(exports TBD)* get filled in by the session that next touches that module.

## Naming and barrels (summary)

| Layer | File | Job |
| --- | --- | --- |
| Public / compatibility barrel | `X.ts` (e.g. `resolution.ts`, `triggered-abilities.ts`) | Stable import path for sockets, GameManager, tests. Keeps `from "./resolution.js"` working. |
| Internal / agent TOC barrel | `X-handlers/index.ts` (e.g. `resolution-handlers/index.ts`) or the existing `triggers/index.ts` | Tiny named-re-export table of contents for extracted modules. |

**Never `X.ts` and `X/index.ts` in the same directory** — module resolution is ambiguous. The implementation folder gets a different name: `resolution-handlers/`, `game-actions-handlers/`, `triggers/`.

## Socket resolution

- Public barrel: `server/src/socket/resolution.ts` (~1034 KB, still holds four cores: `registerResolutionHandlers`, `handleStepResponse`, `handleTargetSelectionResponse`, `handleOptionChoiceResponse`)
- Runtime seam: `server/src/socket/resolutionHandlerDeps.ts` — `ResolutionHandlerDeps` / `createResolutionHandlerDeps` / `getResolutionHandlerDeps`. Extracted handlers are injected here; **extracted files must not import `resolution.ts`**.
- Pre-complete validation for extracted steps: `server/src/socket/resolutionRegisterPreCompleteValidationForExtractedSteps.ts` (37.5 KB — near ceiling, split validation rather than appending).
- New extracts go in `server/src/socket/resolution-handlers/` with a named re-export in `resolution-handlers/index.ts`. The 35 existing flat `resolution*.ts` siblings stay put until a dedicated move PR.

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

## Triggered abilities

- Public barrel: `server/src/state/modules/triggered-abilities.ts` (~677 KB — **not yet a barrel**).
- Internal TOC: `server/src/state/modules/triggers/index.ts` (6.4 KB). This folder is the schema; never add `triggeredAbilitiesXxx.ts` prefixes.
- **Known dual copies:** `detectDeathTriggers`, `detectETBTriggers`, `detectAttackTriggers` exist as large evolved bodies in the leftover monolith *and* as smaller/stale copies in `triggers/zone-changes.ts` and `triggers/combat.ts`. Merge into the folder module and re-export from the leftover; do not create a third copy.
- Folder members still over ceiling: `intervening-if.ts` (574.6 KB), `combat.ts` (127.2 KB), `card-data-tables.ts` (44.3 KB), `turn-phases.ts` (44.0 KB), `zone-changes.ts` (43.4 KB), `zone-change.ts` (40.3 KB). Folder membership is not a 40KB exemption.

## Oracle IR parser / postprocess (`rules-engine/src/`)

- `oracleIRParserPostprocess.ts` (1140.2 KB) already re-exports family siblings: `oracleIRParserPostprocessLookChooseFromTop.ts` (29.8 KB), `oracleIRParserPostprocessSearchLibraryLookSelectImpulse.ts` (29.7 KB), `oracleIRParserPostprocessBattlefieldEntryCounterAndDrawLife.ts` (17.6 KB), `oracleIRParserPostprocessAmongThemAndManaRestriction.ts` (12.5 KB). Siblings are near ceiling — add a new family file, do not append.
- `oracleIRParser.ts` (862.9 KB) — dense regex/literals, ~2.1k lines. Split by clause family into `oracleIRParser*Clauses.ts` siblings (`oracleIRParserSimpleActionClauses.ts` is already 211.9 KB and needs its own split).
- Keep the `oracleIRParser*` / `oracleIRExecutor*` prefixes. No folder move until a parent is already a thin barrel.

## Oracle IR executor (`rules-engine/src/`)

Largest first: `oracleIRExecutorMoveZoneStepHandlers.ts` (672.4 KB), `oracleIRExecutorBattlefieldStepHandlers.ts` (556.4 KB), `oracleIRExecutorZoneOps.ts` (408.0 KB), `oracleIRExecutorPlayerStepHandlers.ts` (307.9 KB), then `oracleIRExecutorMainLoop.ts` and conditional/special-target/token support. Split by step or op family; no `BatchNNN` / `Bulk` names.

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
| `triggered-abilities.ts` / `triggers/zone-changes.ts` | Self-ETB `detectETBTriggers` marks `mandatory: false` when the effect includes “you may” (Knight of the White Orchid land search). Dual copy: live path is the monolith; keep the folder module in sync. Self-and-other death (`this creature or another creature you control dies`) is queued from `appendDetectedSelfDeathTriggers` and the live self-dies scan, not a card-name handler. |
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
| `oracleIrServerZoneSync.ts` | After IR `create_token`, mirrors delayed cleanup into `pendingExileAtNextEndStep` / `pendingSacrificeAtNextEndStep` and stamps `tempAbilities` haste. |
| `triggerGameStateOracleBridgeUtils.ts` | After IR trigger apply, queues monarch / initiative / venture / city blessing / transform. `venture_into_dungeon` is deferred when `interactivePlayerChoices` so `resolveVentureProgress` can prompt and apply room effects. |
| `triggerVentureUtils.ts` | AFR dungeon enter/advance, Undercity, room-effect prompts. Entry: `resolveVentureProgress`. |
| `trigger-runtime-wiring.ts` | `ORACLE_IR_FALLBACK_STEP_KINDS` includes `grant_temporary_dies_trigger`, `take_initiative`, and `become_monarch`. Fallback prefilter also matches `put` / `onto the battlefield` (Reanimate-style zone changes), plus venture / initiative / monarch so those steps reach `applyOracleIRStepsOnServer`. `collectSpellResolutionEffectSteps` omits printed flashback/escape/retrace/jump-start/harmonize reminder grants so they do not leftover-queue and block `nextStep`. |
| `oracleIRExecutorExileGraveyardCardHandlers.ts` | Extracted from `oracleIRExecutorBattlefieldStepHandlers.ts`. `Exile target card from a graveyard` binds `chosenObjectIds` and moves the card to its owner's exile. Entry: `tryApplyExileTargetCardFromGraveyard`. |
| `oracleIRExecutorMoveZoneStepHandlers.ts` | `target card from a graveyard` is an explicit selector (not a pronoun). Bound-id lookup reads `state.zones` as well as `players[].graveyard` so cast-side Cremate/Vile Rebirth still resolve when only the dual-store zone map is populated. |
| `oracleIrServerZoneSync.ts` | `hydrateOracleIRPlayerZonesFromContext` copies graveyard/hand/exile from `state.zones` even when `ctx.libraries` is missing. |
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
| `oracleIrServerBlightPromptUtils.ts` | `oracleIrServerZoneSync.ts` blight TARGET_SELECTION queue + APNAP persist as `queuedResolutionSteps`. Entry: `queueBlightChoicePromptsFromOracleIRResult`. |
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

## Other server logic (no extract family yet)

`game-actions.ts` (816.0 KB) → create `game-actions-handlers/index.ts` on extract #1. Same for `interaction.ts` (621.6 KB) → `interaction-handlers/`, `ai.ts` (556.7 KB) → `ai-handlers/`, `applyEvent.ts` (741.5 KB) → `apply-event-handlers/`. Also oversized: `state/planeswalker/templates/resolve.ts` (512.3 KB), `oracleIrServerZoneSync.ts` (287.8 KB), `socket/util.ts` (285.7 KB), `state/modules/turn.ts` (282.8 KB), `socket/combat.ts` (187.5 KB), `socket/undo.ts`.

## Oracle IR parser postprocess extracts (`rules-engine/src/`)

| Module | Left | Entry |
| --- | --- | --- |
| `oracleIRParserPostprocessInsteadReplacementSteps.ts` | `oracleIRParserPostprocess.ts` / `oracleIRParser.ts` | `repairIntraAbilityInsteadConditionalSteps` — fold "create N of those tokens instead" into the base create |
| `oracleIRParserPostprocessQuotedAbilityRiders.ts` | `oracleIRParser.ts` | `extractQuotedAbilityRiderSteps` — lift quoted riders (Alaundo haste, Archangel would-lose, Combat Celebrant untap) and rewrite leftover unknown residuals |
| `oracleIRParserPostprocessCurrentBatchSurfaces.ts` | `oracleIRParser.ts` | `repairCurrentBatchSurfaceSteps` — restore executable step kinds swallowed by residual rewrites (connive reminders, compound player verbs, emblem nested steps, leading until-EOT pumps) |
| `oracleIRExecutorExileOneOfThemHandlers.ts` | `oracleIRExecutorSpecialTargetHandlers.ts` | `tryApplyExileOneOfThemLookedCards` — “exile one of them” after look_top; player choice when 2+ looked cards; ignore player ids on `chosenObjectIds` |

## Card data and SQLite connections (`server/src/services/`)

| Module | Owns |
| --- | --- |
| `localCardLookup.ts` | The `card_lookup` corpus connection, freshness check, and rebuild. `CARD_LOOKUP_SQLITE_FILE` picks the file; `CARD_LOOKUP_SQLITE_READONLY_FILE` names one path to open read-only with rebuild disabled. Entry points: `ensureLocalCardLookupIndexSync`, `lookupLocalCards`, `getLocalCardLookupDatabase`, `resetLocalCardLookupForTests`. |
| `oracleIrCompiledOverlayDatabase.ts` | The connection backing `oracle_ir_compiled_overlay`, the only table written at runtime. `ORACLE_IR_OVERLAY_SQLITE_FILE` moves overlays into their own database (tests use one per worker); unset, they stay in the card-lookup database. Entry points: `getCompiledOracleIROverlayDatabase`, `resetCompiledOracleIROverlayDatabaseForTests`. |
| `oracleIrCompiledOverlayStore.ts` | Overlay CRUD and envelope validation on top of that connection. |

Tests share the prebuilt 137 MB `server/data/card-lookup.sqlite` read-only rather than copying it per worker; see `server/tests/vitest.setup.ts`.

## Client (MTG logic only)

`client/src/utils/activatedAbilityParser.ts`, `client/src/utils/loopShortcuts.ts`, then `client/src/App.tsx` (388.5 KB — resolution prompts and socket dispatch only; UI chrome is out of scope).
