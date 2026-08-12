# Oracle IR Session Handoff

Last updated: 2026-08-12 (Season `{P}` client budget UX + spell-static EDH triage clean)

> **Cost reducers / alternate costs** (separate workstream): see [`docs/cost-reduction-handoff.md`](cost-reduction-handoff.md).

## Next session prompt (copy-paste)

```
Continue MTGEDH Oracle IR migration — post Season {P} UX + spell-static triage.

Read first:
- docs/oracle-ir-session-handoff.md (this prompt)
- docs/oracle-ir-track-e-remaining-work.md (§ IR live-readiness Aug 2026, D6)
- .cursor/rules/oracle-ir-no-bespoke-handlers.mdc

Done recently:
- Season {P}: pBudget/pCost/canRepeatModes on MODE_SELECTION → ModalSpellSelectionModal budget UX
  shared/src/modeSelectionPBudget.ts; server validate + AI greedy fill
- Spell-static audit: edhHitCount 0; remainder Un-set only (hitCount ~3 after noise filter)
- Prior: vote/end_combat Layer 3; Spree/Tiered resolve scope; spell-static typing

Verify:
cd server ; npx vitest run tests/mode-selection-p-budget.unit.test.ts tests/oracle-prompt-context.test.ts tests/ai-mode-selection.test.ts --pool=threads --maxWorkers=1
cd ../client ; npx vitest run tests/modalSpellPBudget.test.ts

Next work (priority):
1. Live EDH telemetry soak after real games; triage owned_but_unhandled
2. Continuous-effect depth / remaining IR gaps from telemetry
3. Optional: Un-set die-band IR (Goblin Tutor / Six-Sided Die) only if digital Un-set play is desired
```

## Session 2026-08-12 (PM) — Season `{P}` UX + spell-static triage

| Area | Outcome | Key files / tests |
|------|---------|-------------------|
| **Season `{P}` D6** | Cast MODE_SELECTION carries `pBudget` / `pCost` / `canRepeatModes`; client modal spends budget with ± repeats; server validates; AI fills greedily | `shared/src/modeSelectionPBudget.ts`, `ModalSpellSelectionModal.tsx`, `game-actions.ts`, `resolution.ts`, `ai.ts` |
| **Spell-static triage** | **edhHitCount 0**; audit noise skips physical Un-set + short die-face lines; remaining hits Un-set only | `spell-static-drop-audit.ts` |

## Session 2026-08-12 — IR live-readiness (spell-static → vote)

| Area | Outcome | Key files / tests |
|------|---------|-------------------|
| **Spell-static typing** | Instant/sorcery effects typed SPELL for collection; audit EDH hits **0** | `oracleTextParser.ts`, `spell-static-drop-audit.ts` |
| **Spree/Tiered scope** | Cast + IR resolve share `getSelectedAdditionalCostOracleText` | `additionalCostModeOracleText.ts` |
| **Season `{P}` / Urza** | `pBudget` choose_mode; no outer mode duplication | `oracleIRChooseModeUrzaSeason.test.ts` |
| **`end_combat_phase` + `vote`** | Parse/execute + server VOTE APNAP resume; voter-relative ballots; halt so draw/damage tails resume; `combat: undefined` for Object.assign sync | `oracleIREndCombatAndVote.test.ts`, `oracle-ir-vote-end-combat.integration.test.ts` |
| **Docs** | Migration plan + Track E + this handoff updated | `oracle-ir-*-*.md` |

**Still open (superseded PM session):** Season `{P}` client UX + EDH spell-static triage done below; live telemetry soak remains.

## Session 2026-07-07 (PM) — Delta→probe workflow + dynamic lords

| Area | Outcome | Key files / tests |
|------|---------|-------------------|
| **Dynamic lords** | Coat of Arms / Sliver Legion via `countBasis` declarative specs | `staticEffectSpec.ts`, `staticEffectSpecOracleParsing.ts` — **29/29** |
| **Overlay workflow** | `npm run oracle-ir:delta:probe` batches probes from `overlayWorkQueue` | `oracle-delta-probe-gaps.ts`, `probeCompiledOracleIrOverlayCore.ts` — **2/2** probe unit tests |
| **Delta audit** | **0** changed cards | `npm run oracle-ir:delta` |

## Session 2026-07-07 — Graveyard-permission IR + migration stable

| Area | Outcome | Key files / tests |
|------|---------|-------------------|
| **Graveyard cast permission** | Horde/Magus/Mishra/Ignite/Lidless Gaze fixes; **32/32** integration | `oracleIrServerZoneSync.ts`, `oracleIRParserPostprocess.ts`, `oracleIRExecutorExileStepHandlers.ts` |
| **Play-land GY permission** | **18/18** + effect-program **1/1** | `play-land.graveyard-permission.integration.test.ts` |
| **Kethis activated grant** | Full oracle parse for `grant_graveyard_permission` cost context | `oracleIrAbilityExecution.ts` |
| **Migration bar** | **889/889** (123 files); legacy triage soak **0 exports** | `npm run test:oracle-ir-migration`, `oracle-ir:legacy-triage:soak` |
| **Delta audit** | **0 changed cards** | `npm run oracle-ir:delta` |
| **Static effects** | **27/27** declarative specs + gap telemetry **4/4** | `staticEffectSpec.ts`, `oracle-ir-continuous-effect-gap-telemetry.unit.test.ts` |

**Still legacy-only:** some targeting hexproof edge cases in `triggered-abilities.ts`.

## Session 2026-07-06 — Phase 5.2 graveyard replacements + D6 UX

| Area | Outcome | Key files / tests |
|------|---------|-------------------|
| **Replacement registry (5.2)** | Oracle-pattern specs: `graveyard-to-exile-from-anywhere`, `creature-die-exile-instead`; intrinsic self-shuffle from moving object's oracle text | `replacementEffectSpec.ts` — 21/21 `replacement-effect-spec.unit.test.ts` |
| **Graveyard-entry wiring** | `tryApplyDeclarativeGraveyardDestinationReplacement` routes library shuffle + exile via `evaluateReplacementEvent` | `zone-manipulation.ts`, `graveyardEntryUtils.ts`, `counters_tokens.ts` |
| **Rest in Peace on discard** | Cards exiled instead of entering graveyard when RIP on battlefield | `graveyard-self-shuffle-replacement.unit.test.ts` (7/7) |
| **D6 library_search UX** | Exile destination, graveyard-origin titles, optional `minSelections` Skip/Continue | `resolutionChoicePrimitives.ts`, `LibrarySearchModal.tsx`, `App.tsx` — client 6/6 |
| **Optional tutor bridge** | `optional_step_requires_player_choice` queues `LIBRARY_SEARCH` (Fierce Empath) | `oracleIrServerZoneSync.ts` — `isOracleIrPlayerChoiceGap()` across 17 bridge fns |
| **God-Pharaoh optional exile** | Optional begin-combat graveyard exile via `move_zone` → `LIBRARY_SEARCH` | `god-pharaohs-gift.begin-combat.integration.test.ts` (4/4) |
| **D3 ratchet** | `TRIGGER_LEGACY_EXPORT_CEILING = 0` | `oracle-ir-legacy-handler-ratchet.unit.test.ts` |
| **Migration bar** | **873/873** (122 files) | `npm run test:oracle-ir-migration` |

**Not yet wired:** `removePermanent` still calls `getCounterLeaveBattlefieldReplacement` directly — candidate for same declarative path.

## Previous session prompt (copy-token + God-Pharaoh)

```
Track E9 / D3 legacy handler retirement — continue from batch 531.

Current metrics (verify at session start):
- TRIGGER_LEGACY_EXPORT_CEILING = 14 (oracle-ir-legacy-handler-ratchet.unit.test.ts)
- npm run oracle-ir:legacy-triage:soak:forced — expect 126/126
- npm run test:oracle-ir-migration — expect 811/811; telemetry 0 under IR primary
- Latest snapshot: server/scripts/out/telemetry-snapshot-post531.json

Replay/undo (UPDATED 2026-07-06 — stack pop + stale scrub; see §15.5 architecture guide):
- pushTriggeredAbility + executeEffect + resolveTopOfStack replay contract
- consumeReplayedTriggeredAbilityStackItems, scrubStaleReplayedStackAfterFullReplay
- isReplaying guards on oracleIrTriggerExecution / oracleIrSpellExecution
- Tests: myrel-token-replay, stack-replay-accumulation, resolve-top-of-stack.replay-side-effects
- Prior: drawCards, shuffleLibrary, moveResolvedInstantOrSorcery, replayMutations pipeline (batch 508–514)
- Guardrail: tests/helpers/replayDivergence.ts + replay-divergence.guardrail + Kodama/Cultivate/Opt adoption
- Key files: replay-prompt-cleanup.ts, applyEvent.ts, effectProgramReplayMutationPersistence.ts

Stub modules (safe cleanup when touching nearby code):
- oracleIrTriggerLegacySearchHandlers.ts — empty after batch 531 (re-exports EnqueueLibrarySearchStepFn only)
- oracleIrTriggerLegacyResolutionHandlers.ts — empty after batch 529
- oracleIrTriggerLegacySingleEffectRegexBatch.ts — empty shell (returns false); delete with last wired handler

Remaining 14 applyRetiredTriggerLegacy* exports (body/preface — next deletion candidates):
1. applyRetiredTriggerLegacyChosenTypeTopCardReveal / RevealTopCreatureOfChosenType — probe look_choose_from_top + LIBRARY_SEARCH
2. applyRetiredTriggerLegacyDiscardTriggeredCastFromGraveyard / TargetedPlayFromGraveyard / BoundGraveyardReturnEffect — graveyard IR + cast permission
3. applyRetiredTriggerLegacyUpkeepSacrificeCreatureOrSelf — sacrifice + conditional (batch 522 pattern)
4. applyRetiredTriggerLegacyGainControlOfTargetOpponent — gain_control step
5. applyRetiredTriggerLegacyGameStateOracleHooks — game-state side effects; probe before delete
6. applyRetiredTriggerLegacyPlaneswalkerLoyaltyCounters / CastingModifierGrants / GraveyardPermissionEffects — preface handlers in stackExecuteTriggerEffectUtils tail
7. applyRetiredTriggerLegacyKeywordTriggerFallback — keyword trigger fallback table
8. applyRetiredTriggerLegacyDelayedCleanupTriggers — delayed trigger cleanup
9. applyRetiredTriggerLegacySingleEffectRegexBatch — delete module when all inner handlers gone

Patterns to reuse (recent batches):
- OPTIONAL_NO_CHOICE_KINDS: move_zone, look_choose_from_top, look_select_top (avoid Effect Program yes/no swallowing library bridges)
- Hakbal / land-or-draw: queueControllerLandPlayOrDrawPrompt when pendingContinuationSteps has conditional "you don't" → draw (batch 521)
- Sacrifice + continuation: zero legal targets → resume pendingContinuationSteps immediately (batch 522)
- Reveal-until-equipment: look_choose_from_top + legacy LIBRARY_SEARCH attach path (batch 531)

Hakbal sanity (verified 2026-07-05): npx vitest run tests/hakbal.attack-land-play.integration.test.ts tests/hakbal.begin-combat-explore.integration.test.ts — 3/3; attack ability fully IR-wired under ORACLE_IR_TRIGGER_PRIMARY=1.

Per batch workflow:
cd server
# 1. Probe IR: collectOracleEffectSteps + isTriggerEffectFullyIrWired; fix parser/executor/bridge gaps first
# 2. Delete handler + wiring; lower ratchet; update guardrail
npx vitest run tests/oracle-ir-legacy-handler-ratchet.unit.test.ts tests/oracle-ir-trigger-legacy-guardrail.test.ts
npm run oracle-ir:legacy-triage:soak:forced
$env:ORACLE_IR_WRITE_TELEMETRY_SNAPSHOT='D:\Git\MTGEDH\server\scripts\out\telemetry-snapshot-post532.json'
npm run test:oracle-ir-migration

Architecture: no bespoke card-name handlers; delete legacy only with triage/IR proof; full trigger effect text via extractTriggerEffectAfterPrefix.
See .cursor/rules/oracle-ir-no-bespoke-handlers.mdc
```

## E9 batches 507–531 (summary)

| Batch | Deleted / focus | Ratchet | Notes |
|-------|-----------------|--------|-------|
| **507** | Copy-token / attack-trigger token / lose-game handlers (already removed prior session) | — | Handoff candidates were stale |
| **508** | Compound scry/surveil draw persistence + replayMutations | 37→36 | Migration **812/812**; `telemetry-snapshot-post508.json` |
| **509** | `LateEffectRegexBatch` no-op stub | 37→36 | Forced soak 126/126 |
| **510** | `SelfExileCreateToken` | 36→35 | Kept attach handler (fixed batch 511) |
| **511** | `AttachToTargetCreatureYouControl` | 35→34 | Bare conditional attach fragments |
| **512** | `InterveningSubjectKeywordGrant` | 34→33 | Chainer haste; interveningIfSubjectPermanentId wiring |
| **513** | `OptionalDiscardThenDraw`; Archfiend `exilePermanent` replay | 33→32 | Compound optional discard via option_choice |
| **514** | Kodama replay fidelity (library search + compound shuffle) | — | No handler delete; 811/811 stable |
| **515** | `SacrificeAnotherPermanentForBenefit` | 32→31 | Effect Program optional sacrifice path |
| **516–519** | Token counter / bare trigger fragments (see transcript) | 31→26 | Energy sync, token counters, etc. |
| **520** | `EnergyEffects` | 26→25 | `parseBareEnergyGainSteps`; state.energy sync |
| **521** | `PutLandFromHand` | 25→24 | Hakbal draw fallback via `pendingContinuationSteps` conditional |
| **522** | `ThatPlayerSacrificesAndLosesLife`; removed `CombinedHandlers` module | 24→23 | Zero-target sacrifice → resume continuation |
| **523** | `ElspethCounterFromAmong` | 23→22 | Keyword counter-from-among → MODAL_CHOICE bridge |
| **524** | `EachPlayerCounterPlacement` | 22→21 | Agitator Ant → counterPlacementTrigger APNAP |
| **525** | `LootStyleTopLibrary` | 21→20 | look_choose_from_top in OPTIONAL_NO_CHOICE_KINDS |
| **526** | `KynaiosLandDrawChoice` | 20→19 | Each-player land-or-draw batch already IR-owned |
| **527** | `ProteanHulkSearch` | 19→18 | any_number library search + MV cap |
| **528** | `PutCreatureFromHandOntoBattlefield` | 18→17 | Optional move_zone → LIBRARY_SEARCH |
| **529** | `BelbePortalPutFromHand`; resolution handlers module empty | 17→16 | usesChosenCreatureType filtering |
| **530** | `GenericSearchLibrary` | 16→15 | Basic-land tutor IR; Fierce Empath regression |
| **531** | `RevealUntilEquipment` | 15→14 | Reveal-until + attach via LIBRARY_SEARCH; search handlers stub | **Migration 811/811**; `telemetry-snapshot-post531.json` |

**Hakbal verification (2026-07-05):** Both abilities IR-wired — attack (`move_zone` + conditional draw) and begin-combat explore (`explore` APANAP). Tests 3/3 green; one migration flake (809/811) superseded by reruns.

## Replay / undo migration (batch 508 — complete)

| Deliverable | Detail |
|-------------|--------|
| **IR replayMutations pipeline** | mill, drawCards (+ drawnCardIds), shuffleLibrary (+ shuffledLibraryIds), adjustLife, createToken, discardEffect, putCardFromHandOntoBattlefield, effectProgramZoneMove |
| **Spell finalize event** | `moveResolvedInstantOrSorcery` — stack → graveyard/exile on replay without re-running IR |
| **Library search persist** | `remainingLibraryIds` captured **before** compound resume; trailing shuffle/draw via source events + causal reorder in `toReplayEvents` |
| **Legacy snapshot removal** | New persist paths use source fields; `libraryAfter` replay only when key explicitly present (`eventHasOwnField`) |
| **Guardrail adoption** | `replay-divergence.guardrail`, `oracle-ir-deferred-finalize.replay`, Cultivate/Kodama library search, Opt scry+draw |
| **Docs** | `oracle-ir-step-ledger-migration.md` Phase AS updated (no new `libraryAfter`) |

**Intentionally unchanged (live sync only, not replay events):** in-memory zone snapshots in `applyOracleIRStepsOnServer` (`graveyardBefore`, `exileBefore`, etc.); `handIdsBefore` compound-draw fallback when replayMutations lacks drawCards.

## New-card automation (read this for set releases)

**Goal:** Semantic **atomic** `OracleEffectStep` programs for cards not yet in the parser corpus, with live automation and choices only where oracle requires them.

| Status | Detail |
|--------|--------|
| **Corpus (L1–L2)** | ✅ 47,514/47,514 assisted; triggers 15,741/15,741 |
| **Live path (L3)** | ✅ IR primary on; migration tests + replay guardrail |
| **Gap path** | ✅ Compiled overlays + `@OracleIRCompiler` — **default ingestion path** (overlay-first, §C inverted) |
| **Delta CI (D1)** | ✅ `npm run oracle-ir:delta` — hash-baseline diff → audit delta cards only → `overlayWorkQueue` → CI exit code |
| **Gap telemetry (D2)** | ✅ `oracleIrGapTelemetry.ts` + `GET /api/oracle-ir/telemetry` — all-or-nothing / owned-but-unhandled / legacy-handled |
| **Still needed** | New-keyword onboarding (**B1–B8**), Phase 4 legacy deletion (ratcheted), Phase 5 continuous/replacement design ([design doc](./oracle-ir-phase5-continuous-effects-design.md)) |

Full checklist, decision tree, and task IDs **A–E**: [oracle-ir-track-e-remaining-work.md § Goal: Semantic atomic parsing](./oracle-ir-track-e-remaining-work.md#goal-semantic-atomic-parsing--seamless-effect-automation-new-cards). Architecture direction: [oracle-ir-architecture-guide.md §15](./oracle-ir-architecture-guide.md).

```powershell
cd server
npm run card-lookup:refresh
npm run oracle-ir:delta                          # audit new/changed cards vs baseline
npm run oracle-ir:overlay:probe -- --name "Card Name"
npm run oracle-ir:delta -- --update-baseline     # accept green delta
```

## Next session

**E9 batch 469 done** (telemetry soak IR gap fixes — conditional / scry+draw / station):

| Gap | Fix | Key files |
|-----|-----|-----------|
| **Prepared conditional** (Scheming Silvertongue, Eccentric Pestfinder, Emeritus) | Outer `conditional` step now counts as applied when condition evaluates true or false (was missing from `appliedSteps`, tripping all-or-nothing) | `rules-engine/src/oracleIRExecutorMainLoop.ts` |
| **Opt/Consider scry+draw** | `drawEffectSynced()` treats queue-bridged scry/surveil + draw as deferred (draw resumes via `oracleIrResumeStepsJson`) | `server/src/state/modules/oracleIrTriggerExecution.ts` |
| **Spacecraft station `add_counter`** | `this spacecraft` added to self-target references (Planet already had `this planet`) | `rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.ts` |
| **Station threshold / `stationed`** | Re-fetch station permanent after IR counter apply (stale reference skipped threshold when IR succeeded) | `server/src/socket/resolution.ts` |
| **Broodship graveyard cast** | Same conditional wrapper fix; inner `grant_graveyard_permission` + `modify_graveyard_permissions` now satisfy all-or-nothing | (same MainLoop change) |

**Targeted tests:** **60/60** green — `prepared.trigger-primary`, `oracle-ir-scry-surveil`, `oracle-ir-station-charge-counters`, `oracle-ir-broodship-graveyard-cast.socket`.

**E9 batch 468 done** (D3 evidence-driven legacy deletion start + D6 generic choice primitives):

| Deliverable | Detail |
|-------------|--------|
| **D3 deletion** | Removed **10** dead exports (orphan files, unreachable stubs, wired no-ops); ratchet **86 → 76**; triage uses **transitive closure** from execution roots (initial “38 orphaned” count was wrong) |
| **D3 triage tooling** | `npm run oracle-ir:legacy-triage` + `oracle-ir:legacy-triage:soak`; JSONL append in `oracleIrGapTelemetry.ts` survives `resetOracleIrGapTelemetry()` in unit tests |
| **D6 primitives** | `client/src/utils/resolutionChoicePrimitives.ts` + `client/tests/resolutionChoicePrimitives.test.ts` (5 tests); `App.tsx` wired |
**E9 batch 471 (spell categorize suppression + forced-legacy soak tooling):**

| Gap | Fix | Verification |
|-----|-----|--------------|
| **Spell IR owns but fails** | `stackResolveSpellOracleIrUtils.ts` skips `categorizeSpell` when IR owns spell (no false `legacy_handled`) | spell retirement + gap telemetry tests |
| **Forced-legacy soak** | `oracle-ir-legacy-triage-soak.ts --legacy` runs 126-test legacy subset | `telemetry-snapshot-legacy-forced.json` |
| **Note on D3 telemetry** | `recordLegacyTriggerHandled` only fires when IR primary is ON (by design); forced-legacy soak will not populate `legacy_handled` | triage-forced: 0 legacy_handled |

**Migration soak (post-471, 2026-07-03):** **811/811** green; telemetry **0 events** (clean integration soak after unit-test isolation + batches 469–471). Snapshot: `scripts/out/telemetry-snapshot-post471.json`. Compare: pre-469 **34** → post-471 **0**.

**E9 batch 472 (soak hygiene):**

| Gap | Fix | Verification |
|-----|-----|--------------|
| **Unit-test soak pollution** | `oracle-ir-gap-telemetry.unit.test.ts` + handler-retirement tail tests unset `ORACLE_IR_WRITE_TELEMETRY_SNAPSHOT` during fixture runs | post-471 soak **0** events |

**E9 batch 470 (post-soak hardening):**

| Gap | Fix | Verification |
|-----|-----|--------------|
| **Telemetry snapshot empty JSON** | `vitest.setup.ts` afterAll writes aggregate from `.jsonl` append log | post-469 snapshot has 15 events |
| **Modal `choose_mode` + draw text** | `drawEffectSynced` skips library check when modal branch has no applied/pending `draw` | `oracle-ir-trigger-modal-primary-default.integration.test.ts` (6/6) |
| **Scry/surveil compound (belt)** | `drawEffectSynced` also accepts pending draw + deferred scry/surveil without queue bridge | targeted regression 62/62 |

**E9 batch 473 (forced-legacy soak telemetry):**

| Deliverable | Detail |
|-------------|--------|
| **`ORACLE_IR_GAP_TELEMETRY_LEGACY_SOAK`** | Records `legacy_handled` when IR primary is off (forced-legacy regression soak) |
| **`npm run oracle-ir:legacy-triage:soak:forced`** | 126 tests, ~33s; snapshot `telemetry-snapshot-legacy-forced.json` |
| **Forced soak signal** | **60** `legacy_handled` (56 spell categorize, 4 trigger `legacy_body`/`legacy_tail`) — proves legacy regression paths still work; **not** deletion candidates while forced-legacy tests exist |
| **Migration soak (post-471)** | **0** events under IR primary — integration gaps cleared |

## Next session prompt (copy-paste)

**Superseded 2026-07-05 — use the prompt at the top of this file (batch 531 → 532).**

<details>
<summary>Archived prompt (batch 506)</summary>

```
Track E9 / D3 legacy handler retirement — continue from batch 506.

Current metrics:
- TRIGGER_LEGACY_EXPORT_CEILING = 43 (forced legacy soak 126/126; migration 812/812; telemetry 0)
- Rebound/Paradigm moved to stackSpecialTriggerHandlers.ts (not legacy exports)
- All session deferred items from batch 505 are resolved

Architecture: no bespoke card-name handlers; delete legacy only with triage/IR proof; full trigger effect text via extractTriggerEffectAfterPrefix.

Next deletion candidates (forced-legacy triage / late-effect batch):
1. applyRetiredTriggerLegacyInterveningSubjectCopyToken — interveningIfSubjectPermanentId + copy token; probe IR copy_token/create_token
2. applyRetiredTriggerLegacyTappedAttackingCopyToken — attack trigger copy token pattern
3. applyRetiredTriggerLegacyAttackTriggerCreateCreatureToken / BlockTrigger / AttackCountBased — structured triggerType paths; may need stack metadata bridge like rebound
4. applyRetiredTriggerLegacyLoseGameReplacement — probe conditional/replacement IR
5. grant_exile_permission for rebound effect text (optional IR path; stack handler already primary)

Verification per batch:
cd server
npx vitest run tests/oracle-ir-legacy-handler-ratchet.unit.test.ts tests/oracle-ir-trigger-legacy-guardrail.test.ts
npm run oracle-ir:legacy-triage:soak:forced
$env:ORACLE_IR_WRITE_TELEMETRY_SNAPSHOT='D:\Git\MTGEDH\server\scripts\out\telemetry-snapshot-post507.json'
npm run test:oracle-ir-migration

cd rules-engine
npx vitest run test/<new-executor-test>.test.ts
```

</details>

**E9 batch 506 (D3 — deferred items closure):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted** | `TypedCountTokenFallbacks`, `AgentOfShadowThievesAttack`, legacy `ReboundTrigger`/`ParadigmTrigger` exports |
| **Wired** | Self-ref mask for create-token clauses; `no opponent has more life than that player` conditional; `Human Soldier` catalog entry; `stackSpecialTriggerHandlers.ts` for rebound/paradigm before IR |
| **Evidence** | `oracleTextParserPreprocess.test.ts`, `oracleIRExecutorCreateXControlledType.test.ts`, `oracleIRExecutorAgentShadowThieves.test.ts`, `rebound-may-ability.integration.test.ts`, `paradigm.integration.test.ts` |
| **Ratchet** | **47 → 43** |
| **Forced legacy soak** | **126/126**; **43** exports |

**E9 batch 505 (D3 — CreateXTokensByControlledTypeCount deletion):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted** | `applyRetiredTriggerLegacyCreateXTokensByControlledTypeCount` |
| **Wired** | Existing `create_token` + where-X = number of {type} you control |
| **Evidence** | `oracleIRExecutorCreateXControlledType.test.ts` (Krenko Goblin, Myrel Soldier artifact) |
| **Ratchet** | **48 → 47** |
| **Forced legacy soak** | **126/126**; **47** exports |
| **Migration soak (post-505)** | **812/812** green (same post-500 telemetry snapshot; **0 events**) |

**E9 batch 504 (D3 — CallTheCoppercoatsTokens deletion):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted** | `applyRetiredTriggerLegacyCallTheCoppercoatsTokens` |
| **Wired** | Where-X evaluator: `X is the number of creatures target opponents control` (uses `chosenObjectIds` / `eachOfThoseOpponents`; falls back to all opponents) |
| **Evidence** | `oracleIRExecutorCallTheCoppercoats.test.ts` |
| **Ratchet** | **49 → 48** |
| **Forced legacy soak** | **126/126**; **48** exports |
| **Migration soak (post-504)** | **812/812** green (re-run after Windows OOM crash; telemetry **0 events** on post-500 snapshot) |

**E9 batch 503 (D3 — DeployToTheFrontTokens deletion):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted** | `applyRetiredTriggerLegacyDeployToTheFrontTokens` |
| **Wired** | Existing `create_token` with `amount: x` and where-X = creatures on battlefield |
| **Evidence** | `oracleIRExecutorDeployToTheFront.test.ts`, `stack.regressions.effects.test.ts` Deploy case |
| **Ratchet** | **50 → 49** |
| **Forced legacy soak** | **126/126**; **49** exports |

**E9 batch 502 (D3 — DarienDamageTokens deletion):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted** | `applyRetiredTriggerLegacyDarienDamageTokens` |
| **Wired** | Optional `create_token` with `reference_amount` ("that many"); `damageAmount` bridged to `referenceAmount` in trigger IR context |
| **Evidence** | `oracleIRExecutorDarienDamageTokens.test.ts`, `combat-damage-to-you.regression.integration.test.ts` under IR primary |
| **Ratchet** | **51 → 50** |
| **Migration soak (post-502)** | pending re-run (prior soak crashed mid-suite on Windows) |
| **Forced legacy soak** | **126/126**; **50** exports |

**E9 batch 501 (D3 — BothPlayersPutPermanentFromHand deletion):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted** | `applyRetiredTriggerLegacyBothPlayersPutPermanentFromHand` |
| **Wired** | `move_zone` executor defers optional permanent-from-hand; `queueBothPlayersMayPutPermanentFromHandPromptsFromOracleIRResult` queues KYNAIOS land-play prompts for controller + target player |
| **Evidence** | `oracleIRExecutorBothPlayersPutPermanent.test.ts`, `both-players-put-permanent-oracle-ir.integration.test.ts` |
| **Ratchet** | **52 → 51** |
| **Migration soak (post-501)** | **812/812** green; telemetry **0 events** → `telemetry-snapshot-post501.json` |
| **Forced legacy soak** | **126/126**; **51** exports |

**E9 batch 500 (D3 — CurseDefendingPlayer deletion):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted** | `applyRetiredTriggerLegacyCurseDefendingPlayer` |
| **Wired** | `create_token` executor recognizes `Curse enchantment token attached to defending player`; sets `enchantedPlayerId`/`attachedTo` from defending-player selector context |
| **Evidence** | `oracleIRExecutorCurseDefendingPlayer.test.ts`, routing/guardrail/ratchet tests |
| **Ratchet** | **53 → 52** |
| **Migration soak (post-500)** | **812/812** green; telemetry **0 events** → `telemetry-snapshot-post500.json` |
| **Forced legacy soak** | **126/126**; **52** exports |

**E9 batch 499 (D3 — ElixirOfImmortality deletion):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted** | `applyRetiredTriggerLegacyElixirOfImmortality` |
| **Wired** | Existing `gain_life` + `move_zone` (`shuffleSourcePermanentAndGraveyardIntoLibrary`) on activated-ability IR path |
| **Evidence** | `oracleIRExecutorElixirShuffle.test.ts`, `elixir-of-immortality-oracle-ir.integration.test.ts` |
| **Ratchet** | **54 → 53** |
| **Migration soak (post-499)** | **812/812** green; telemetry **0 events** → `telemetry-snapshot-post499.json` |
| **Forced legacy soak** | **126/126**; **53** exports |

**E9 batch 498 (D3 — EachMerfolkExplores deletion):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted** | `applyRetiredTriggerLegacyEachMerfolkExplores` |
| **Wired** | `resolveCreatureTargetIds` handles `each {subtype} you control`; `applyExploreStep` APANAP via `remainingPermanentIds` metadata; server explore bridge passes chain to `EXPLORE_DECISION` |
| **Evidence** | `oracleIRExecutorEachSubtypeExplore.test.ts`, `hakbal.begin-combat-explore.integration.test.ts` under IR primary |
| **Ratchet** | **55 → 54** |
| **Migration soak (post-498)** | **812/812** green; telemetry **0 events** → `telemetry-snapshot-post498.json` |
| **Forced legacy soak** | **126/126**; **54** exports |

**E9 batch 497 (D3 — DelayedDrawAtNextUpkeep deletion):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted** | `applyRetiredTriggerLegacyDelayedDrawAtNextUpkeep` (+ `oracleIrTriggerLegacyTimingHandlers.ts` module) |
| **Wired** | `bridgeScheduleDelayedDrawAtNextUpkeepFromOracleIRResult` maps `schedule_delayed_trigger` (`next_upkeep` + draw) → `scheduleDelayedDrawAtNextUpkeep`; `look_top` added to fallback kinds for Mishra's Bauble compounds |
| **Evidence** | `delayed-upkeep-draw.integration.test.ts`, routing/guardrail/ratchet tests |
| **Ratchet** | **56 → 55** |
| **Migration soak (post-497)** | **812/812** green; telemetry **0 events** → `telemetry-snapshot-post497.json` |
| **Forced legacy soak** | **126/126**; **55** exports |

**E9 batch 496 (D3 — UntapAllCreatureType deletion):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted** | `applyRetiredTriggerLegacyUntapAllCreatureType` |
| **Wired** | `trySpecialTapOrUntapStep` handles `untap all {creature subtype} you control` via `permanentHasCreatureType` |
| **Evidence** | `oracleIRExecutorUntapSubtype.test.ts`, routing/wiring tests |
| **Ratchet** | **57 → 56** |
| **Migration soak (post-496)** | **812/812** green; telemetry **0 events** → `telemetry-snapshot-post496.json` |
| **Forced legacy soak** | **126/126**; **56** exports |

**E9 batch 495 (D3 — CombatDamageDrawEffects deletion):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted** | `applyRetiredTriggerLegacyCombatDamageDrawEffects` (+ module) |
| **Wired** | `oracleIRExecutorCombatDamageCounts.ts` resolves opponent/player combat-damage reference amounts; parser attaches shared `whereX` on draw+lose compounds |
| **Evidence** | `oracleIRExecutorCombatDamageDraw.test.ts`, `postcombat-main.combat-damage.regression.integration.test.ts` under IR primary |
| **Ratchet** | **58 → 57** |
| **Migration soak (post-495)** | **811/811** green; telemetry **0 events** → `telemetry-snapshot-post495.json` |
| **Forced legacy soak** | **126/126**; **57** exports |

**E9 batch 494 (D3 — AttackingPlayerGainsControlOfArtifact deletion):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted** | `applyRetiredTriggerLegacyAttackingPlayerGainsControlOfArtifact` |
| **Wired** | Bare fragment → `gain_control` (`what: this artifact`, `newController: target_player`); executor transfers `ctx.sourceId` to `attackingPlayerId` and untaps |
| **Evidence** | `trigger-runtime-wiring.unit.test.ts`, `oracleIRExecutorGainControlAttackingPlayer.test.ts`, `combat-damage-to-you.regression.integration.test.ts` (Contested Game Ball) |
| **Ratchet** | **59 → 58** |
| **Migration soak (post-494)** | **810/810** green; telemetry **0 events** → `telemetry-snapshot-post494.json` |
| **Forced legacy soak** | **126/126**; **58** exports |

**E9 batch 493 (D3 — SacrificeThisCreature deletion):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted** | `applyRetiredTriggerLegacySacrificeThisCreature` |
| **Evidence** | `isTriggerEffectFullyIrWired` for `sacrifice this creature`; IR `sacrifice` step binds `this creature` via `sourceId` |
| **Ratchet** | **60 → 59** |
| **Migration soak (post-493)** | **809/809** green; telemetry **0 events** → `telemetry-snapshot-post493.json` |

**E9 batch 492 (D3 — ThousandLife + UpkeepEffectDoubling deletion):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted** | `applyRetiredTriggerLegacyThousandLifeLoseGame`, `applyRetiredTriggerLegacyUpkeepEffectDoubling` |
| **Wired** | `lose_game` in `ORACLE_IR_FALLBACK_STEP_KINDS`; thousand-life clause → `conditional` + inner `lose_game` |
| **Executor** | `you have N or more life` condition in `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Evidence** | `oracleIRExecutor.test.ts` conditional lose_game cases; routing tests |
| **Ratchet** | **62 → 60** |
| **Migration soak (post-492)** | **809/809** green; telemetry **0 events** → `telemetry-snapshot-post492.json` |

**E9 batch 491 (D3 — ExileTopTwoPlayableChoice deletion):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted** | `applyRetiredTriggerLegacyExileTopTwoPlayableChoice` |
| **Evidence** | `isTriggerEffectFullyIrWired` for `impulse_exile_top` (Anep exert + planeswalker "this turn" variants); Anep integration/replay tests |
| **Parser fix** | Combat Celebrant combined untap+extra-combat now splits to `tap_or_untap` + `add_extra_combat` (regression from batch 487 mana/combat deletion) |
| **Ratchet** | **63 → 62** |
| **Migration soak (post-491)** | **809/809** green; telemetry **0 events** → `telemetry-snapshot-post491.json` |

**E9 batch 490 (D3 — HandSizeLifeGain deletion + hand-size reference_amount executor):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted** | `applyRetiredTriggerLegacyHandSizeLifeGain` |
| **Executor** | `tryResolveForEachReferenceAmount` resolves hand-size and Ivory Tower "above N" gain_life amounts |
| **Evidence** | `rules-engine/test/oracleQuantityResolve.test.ts`; Venser/Ivory stack regressions under IR primary |
| **Ratchet** | **64 → 63** |
| **Migration soak (post-490)** | **809/809** green; telemetry **0 events** → `telemetry-snapshot-post490.json` |

**E9 batch 489 (D3 — counter inline batch deletion):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted** | `oracleIrTriggerLegacyCounterHandlers.ts` / `applyRetiredTriggerLegacyCounterInlineBatch` |
| **Evidence** | `isTriggerEffectFullyIrWired` for devotion-scaled and artifact-count `add_counter` clauses |
| **Ratchet** | **65 → 64** |
| **Migration soak (post-489)** | **809/809** green; telemetry **0 events** → `telemetry-snapshot-post489.json` |

**E9 batch 488 (D3 — ExtraTurnAfterThisOne preface handler deletion):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted** | `applyRetiredTriggerLegacyExtraTurnAfterThisOne` from `oracleIrTriggerLegacyTurnAndZoneHandlers.ts` + preface dispatch |
| **Evidence** | `take_extra_turn` in `ORACLE_IR_FALLBACK_STEP_KINDS`; `isTriggerEffectFullyIrWired` for Time Warp clause |
| **Ratchet** | **66 → 65** |
| **Emrakul integration** | Test opts into `ORACLE_IR_TRIGGER_PRIMARY=1` (legacy preface was only path under default-off vitest) |
| **Migration soak (post-488)** | **809/809** green; telemetry **0 events** → `telemetry-snapshot-post488.json` |
| **Forced-legacy soak** | **126/126**; **56** `legacy_handled`; **65** exports |

**E9 batch 487 (D3 — mana/combat batch deletion + add_extra_combat wiring):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted** | `oracleIrTriggerLegacyManaAndCombatHandlers.ts` / `applyRetiredTriggerLegacyManaAndCombatBatch` |
| **Wired** | `add_extra_combat`, `take_extra_turn` in `ORACLE_IR_FALLBACK_STEP_KINDS` |
| **Evidence** | Combat Celebrant exert integration; `isTriggerEffectFullyIrWired` for extra-combat clauses |
| **Ratchet** | **67 → 66** |
| **Step-wiring test** | Negative case uses `venture_into_dungeon` (still unwired); added positive case for `take_extra_turn` |
| **Migration soak (post-487)** | **809/809** green; telemetry **0 events** → `telemetry-snapshot-post487.json` |
| **Forced-legacy soak** | **126/126**; **56** `legacy_handled`; **66** exports |

**E9 batch 486 (D3 — mana/combat batch partial deletion):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted clauses** | proliferate, add_mana, dynamic_power_mana, draw-trigger damage, that_player_adds_mana, deals_damage_to_that_player, graveyard_to_library |
| **Retained** | `extra_combat_phase` / `extra_combat_phase_skip` (`add_extra_combat` not trigger-runtime-wired) |
| **Evidence** | `isTriggerEffectFullyIrWired` probe + `oracle-ir-proliferate.integration.test.ts`; forced triage **0** mana/combat handler hits |
| **Oracle hydration** | `resolveTriggerStackItemEffectText` hydrates truncated fragments from permanent/card oracle (replaces Kynaios name guard) |
| **Ratchet** | unchanged at **67** (same export, fewer clauses) |

**E9 batch 485 (D3 — full graveyard zone-change batch deletion):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted** | `oracleIrTriggerLegacyGraveyardZoneHandlers.ts` / `applyRetiredTriggerLegacyGraveyardZoneChangeBatch` (all remaining clauses) |
| **Evidence** | `isTriggerEffectFullyIrWired` for exile-from-graveyard, reanimation, exile_top, linked exile, Whip-style delayed exile, aura attach, cast-from-graveyard copy |
| **Routing** | Added graveyard zone-change patterns to `oracle-ir-trigger-legacy-routing.test.ts` |
| **Live soak tooling** | `scripts/oracle-ir-telemetry-fetch.ts` → `GET /api/oracle-ir/telemetry` |
| **Ratchet** | **68 → 67** |
| **Migration soak (post-485)** | **806/807** green (1 pre-existing Kynaios flake); telemetry **0 events** → `telemetry-snapshot-post485.json` |
| **Kynaios + Keen-Eyed fixes** | Generic oracle hydration in `resolveTriggerStackItemEffectText` (permanent → card lookup); graveyard→exile IR sync restores `permanent.exiledCards` ledger |
| **Forced-legacy soak** | **126/126**; **56** `legacy_handled`; **`firedLegacyHandlers` → 0** (no graveyard batch hits) |
| **Live beta soak** | Fetched from local server: **0 events** → `telemetry-snapshot-live-beta.json` (no beta traffic yet) |

**E9 batch 484 (D3 — simple zone-change graveyard clause deletion):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted clauses** | `$destroy_target`, `$exile_target_creature`, `$bounce_target` from graveyard batch |
| **Deleted export** | `applyRetiredTriggerLegacyExileTargetPlayerGraveyard` (body handler) |
| **Tail fix** | Short-circuit late batch when IR fallback applied fully-wired text (forced-legacy path) |
| **Evidence** | destroy/exile/move_zone IR-wired; forced-legacy integration tests route via IR fallback |
| **Ratchet** | **69 → 68** |

**E9 batch 483 (D3 — tap/untap inline batch deletion + gain_control wiring):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted** | `oracleIrTriggerLegacyTapUntapHandlers.ts` / `applyRetiredTriggerLegacyTapUntapInlineBatch` |
| **Wired** | `isSupportedGainControlTriggerPattern` for each-player owned creature/permanent control (`gain_control` step) |
| **Evidence** | Executor + `syncPreparedCopiesAfterBattlefieldControllerChanges`; routing + runtime wiring tests |
| **Ratchet** | **70 → 69** |

**E9 batch 482 (D3 — untap inline branch deletion):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted clauses** | `untap_other_creatures_you_control`, `untap_all_creatures_you_control` from tap/untap inline batch |
| **Retained** | `each_player_gains_control_owned_creatures` (`gain_control` not IR-wired) |
| **Evidence** | `isTriggerEffectFullyIrWired` for plain + compound exert untap clauses (`tap_or_untap`); IR tail fallback covers forced-legacy path |
| **Ratchet** | unchanged at **70** (same export, fewer clauses) |

**E9 batch 481 (combined regex `$clause` telemetry):**

| Deliverable | Detail |
|-------------|--------|
| **Telemetry** | `applyRetiredTriggerLegacyCombinedEffectsRegexBatch$you_gain_that_much_life`, `$put_that_many_counters_on_self` |
| **Tail dispatch** | `legacyTailHandled(combinedEffectsHit)` passes clause tag to triage |
| **Routing** | Documented `untap all * creatures you control` as IR-wired (`tap_or_untap`); `each player gains control…` still not wired |

**E9 batch 480 (D3 — two +1/+1 counter-on-target handler deletion):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted** | `applyRetiredTriggerLegacyTwoPlusOneCountersOnTarget` (+ Elspeth Angel/flying helpers) |
| **Evidence** | `isTriggerEffectFullyIrWired` for plain, Angel, and multi-step forge-room clauses (`add_counter` + `grant_*`) |
| **Ratchet** | **71 → 70** |

**E9 batch 479 (D3 — PT modification batch deletion):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted** | `applyRetiredTriggerLegacyPTModificationBatch` (+ file `oracleIrTriggerLegacyPTModificationHandlers.ts`) |
| **Evidence** | Batch skipped when `isTriggerEffectFullyIrWired`; IR fallback tests cover modify_pt / grant_temporary_ability |
| **Ratchet** | **72 → 71** |

**E9 batch 478 (D3 pilot — combat evasion handler deletion):**

| Deliverable | Detail |
|-------------|--------|
| **Deleted 4 exports** | `applyRetiredTriggerLegacyTargetCreatureCantBeBlocked`, `SelfCantBeBlocked`, `SelfPreventCombatDamage`, `SelfCantBeBlockedByLowPower` |
| **Evidence** | `isTriggerEffectFullyIrWired` + routing tests; legacy handlers were no-ops for wired text |
| **Ratchet** | **76 → 72** (`TRIGGER_LEGACY_EXPORT_CEILING`) |
| **File removed** | `oracleIrTriggerLegacyCombatEvasionHandlers.ts` |

**Next candidates:**

1. **D3 batch 8** — next late-effect regex batch families from forced-legacy triage (token inline, combined, etc.).
2. **Live EDH beta soak** — run manual games on beta, then `npx tsx scripts/oracle-ir-telemetry-fetch.ts --url <beta-host>/api/oracle-ir/telemetry` and triage.

**✅ 5 migration failures root-caused and fixed (2026-07-02):** the Marvel/E9 arc introduced **deferred spell finalize** (`oracleIrDeferredFinalize` in `stackResolveInstantSorceryLegacyResolutionUtils.ts`): when an IR-handled spell queues resolution steps, the item is re-pushed onto the stack and the finalize (stack pop + spell → graveyard) runs only after the queue empties — per CR 608.2m, matching the Consider/teamwork expectations. The 5 failing tests encoded the *old* immediate-finalize semantics and had two real gaps:

1. **Stranded stack items** — `maybeResumeDeferredOracleIrStackSpell` was only wired into a few handlers (discard/scry/surveil/optional-payment), so LIBRARY_SEARCH and EP-choice responses never finalized the deferred spell. Fixed by calling it centrally after `handleStepResponse` in both `submitResolutionResponse` and the AI resolution path (`socket/resolution.ts`).
2. **IR re-execution hazard** — the deferred second pass re-ran `tryResolveInstantSorceryOracleIrSpell` whenever the queue was non-empty. The preface (`stackResolveInstantSorceryPrefaceUtils.ts`) now short-circuits *any* `oracleIrDeferredFinalize` item so IR steps can never double-apply.

Test expectations updated to the CR-correct semantics: Chart a Course graveyard order is now `['draw-1','chart_1']` (discard lands during resolution, spell after); Kindred Summons / Green Sun's Twilight assert the deferred item stays on the stack (`toHaveLength(1)` + `oracleIrDeferredFinalize`) while the choice is pending. Migration suite: **795/795** (the only 2 fails in a full run were first-test-per-file 30s warm-up timeouts; both pass solo).

Also: many first-tests-per-file exceed the 5s default timeout under full-suite load (module warm-up) — run the suite with `--testTimeout=30000` (and `--maxWorkers=1`) until tightened.

**Marvel mechanics (Teamwork / Power-up / Preparation)** — core + Layer 3 sockets done. See [marvel-mechanics-handoff.md](./marvel-mechanics-handoff.md).

| Bar | Result |
|-----|--------|
| Executor (`full_card`) | **47,514/47,514** assisted — parse→execute **0**, `partial` **0**, `ir_gap` **0** |
| Trigger coverage | **15,741/15,741** fully covered — `not_detected` **0** |
| Selector / condition / amount / target gaps | **0** clusters each |
| Migration | **807/807** (`npm run test:oracle-ir-migration`) |

### Layer 3 — completed beta-prep (batches 445–453)

| Batch | Pattern | Key deliverable |
|-------|---------|-----------------|
| 445–449 | Socket arc | Trigger reveal, scry/surveil, unless-pay, prepared trigger, compound resume |
| 450 | Legacy categorize gate | `shouldSkipLegacySpellCategorizeExecution` + wheel/counter unit guardrails |
| 451 | Wheel reconnect E2E | Reforge/Windfall/Echo/Big Score/Inspiring Call `joinGame` zones |
| 452 | Unless-pay zone sync | Graveyard sync without `ctx.libraries`; `syncAllOracleIRPlayerZonesAfterResolution` |
| 453 | Prepared cast socket | Exile copy `requestCastSpellForSocket` + mana payment |
| 454 | Scry/surveil legacy categorize | `SCRY`/`SURVEIL` categorize no-op guardrails; deleted `applyRetiredTriggerLegacyScry` stub |
| 455–457 | Trigger draw stub deletion | Dead `return false` regex stubs removed; wheel + counter-then-draw cleanup |
| 458 | Overlay migration gate | `oracle-ir-compiled-overlay*.integration` in migration suite |
| 459 | Optional discard trigger socket (legacy) | `optional-discard-then-draw.trigger.socket` under `ORACLE_IR_TRIGGER_LEGACY=1` |
| E8 460–461 | Effect Program sockets | `oracle-ir-fateseal-clash.socket`, `oracle-ir-choose-mode-effect-program.socket` |
| 462 | Clash EP socket | `oracle-ir-fateseal-clash.socket` — `CLASH` resume via `submitResolutionResponse` |
| 463 | Optional discard IR-primary socket | `optional-discard-then-draw.trigger.socket` — IR `OPTION_CHOICE` decline |
| 464 | Draw-then-discard spell guardrail | Chart a Course no-op under `ORACLE_IR_SPELL_PRIMARY=1` |
| 465 | Optional discard IR parity | `oracle-ir-trigger-legacy-parity` — IR path vs legacy `optionalDiscardThenDrawChoice` |

```powershell
cd server
npm run test:oracle-ir-migration   # 797 tests; run with --maxWorkers=1 if timeouts
npx vitest run tests/oracle-ir-wheel-reconnect.integration.test.ts tests/oracle-ir-unless-pay.socket.integration.test.ts tests/prepared.cast.socket.integration.test.ts --pool=threads --maxWorkers=1
```

Use `@OracleIRCompiler` (`.github/agents/OracleIRCompiler.agent.md`) to compile overlays, then:

```powershell
cd server
npm run oracle-ir:overlay:probe -- --name "Card Name"
npm run oracle-ir:overlay:validate -- --file data/compiled-oracle-ir-overlays/<card>.json --compare-parser
npm run oracle-ir:overlay:import
```

Overlays live in `server/data/compiled-oracle-ir-overlays/` (`*.example.json` templates are skipped on import). Runtime lookup: `oracle_ir_compiled_overlay` SQLite table + `collectOracleEffectSteps` overlay hook.

## What was completed this session

### Marvel mechanics — Teamwork / Power-up / Preparation (2026-06-29) ✅

| Area | Outcome |
|------|---------|
| **Teamwork** | Cast additional-cost queue + stack metadata; IR `teamworkChooseBoth` / `teamworkWasPaid` |
| **Power-up** | Activate path discounts (118.7), once-per tracking, static reductions; Thanos odd/even destroy IR |
| **Preparation** | IR `becomes prepared` → server `setPermanentPrepared`; handCount-safe zone sync; 10/10 integration tests |
| **Tests** | `marvel-mechanics.test.ts` 10/10; `prepared.integration.test.ts` 10/10; rules-engine Marvel IR 4/4 |

Handoff: [marvel-mechanics-handoff.md](./marvel-mechanics-handoff.md)

### Audit refresh (2026-06-29) ✅

| Command | Outcome |
|---------|---------|
| `EXECUTOR_COVERAGE_SCOPE=full_card npm run executor:coverage` | 29,614 cards; 45,608 fully applied + 1,906 choice-required |
| `npm run trigger:coverage` | 15,741 triggers; 0 gaps |
| `executor-fullcard-selector-gap-analysis.ts` | 0 clusters |
| `executor-fullcard-condition-gap-analysis.ts` | 0 clusters |
| `executor-general-gap-analysis.ts` | 1 `no_deterministic_target` (Waterbender Ascension) |
| `executor-target-gap-analysis.ts` | 1 cluster |
| `executor-amount-gap-analysis.ts` | 0 clusters |
| `npm run test:oracle-ir-migration` | **752/752** |

Reports written to `server/scripts/out/*.json` (gitignored).

### Track E — batch 435: Mox Diamond socket integration ✅

| Item | Change | Key files / tests |
|------|--------|-------------------|
| **Socket flow** | `tryQueueWouldEnterDiscardLandBeforeStackResolve` → `submitResolutionResponse` | `mox-diamond-would-enter.socket.integration.test.ts` |
| **Paths** | Discard land → ETB; decline → graveyard | same |
| **Event log** | `moxDiamondChoice` persisted on accept | same |
| **Migration bar** | **752/752** (unchanged) | `npm run test:oracle-ir-migration` |

### Track E — batch 434: Mox Diamond → shared would-enter module ✅

| Item | Change | Key files / tests |
|------|--------|-------------------|
| **Parser** | `parseWouldEnterDiscardLandFromHandReplacement` — generic artifact discard-land | `land-would-enter-replacement.ts` |
| **Queue** | `queueWouldEnterDiscardLandChoiceForStackItem` | same |
| **Resolve** | `resolveWouldEnterDiscardLandChoice` — shared resolution + replay | `resolution.ts`, `applyEvent.ts` |
| **Shim** | `mox-diamond-choice.ts` re-exports for back-compat | `mox-diamond-choice.ts` |
| **Tests** | generic artifact oracle + existing mox replay/auto-pass | `land-would-enter-sacrifice.integration.test.ts` |
| **Migration bar** | **752/752** (unchanged) | `npm run test:oracle-ir-migration` |

### Track E — batch 433: Lotus Vale socket integration ✅

| Item | Change | Key files / tests |
|------|--------|-------------------|
| **Socket flow** | `playLand` defers ETB; `submitResolutionResponse` sacrifices 2 lands or declines | `land-would-enter-sacrifice.socket.integration.test.ts` |
| **Event log** | `landWouldEnterSacrificeChoice` persisted on accept | same |
| **Migration bar** | **752/752** (unchanged) | `npm run test:oracle-ir-migration` |

### Track E — batch 432: Sheltered Valley named-sacrifice would-enter ✅

| Item | Change | Key files / tests |
|------|--------|-------------------|
| **Parser** | `parseLandWouldEnterNamedSacrificeReplacement` — sacrifice each other permanent named X | `land-would-enter-replacement.ts` |
| **Auto apply** | `tryApplyLandWouldEnterNamedSacrificeReplacement` on play-land (no queue) | `stackPlayLandUtils.ts` |
| **Lotus polish** | Optional `the battlefield` in sacrifice-lands regex; untapped only in prompt when required | `land-would-enter-replacement.ts` |
| **Tests** | solo ETB + sacrifice-other-copy | `land-would-enter-sacrifice.integration.test.ts` |
| **Migration bar** | **752/752** (unchanged) | `npm run test:oracle-ir-migration` |

### Track E — batch 431: generic land would-enter sacrifice replacement ✅

| Item | Change | Key files / tests |
|------|--------|-------------------|
| **Parser** | `parseLandWouldEnterSacrificeReplacement` — `sacrifice two untapped lands instead` | `land-would-enter-replacement.ts` |
| **Play land defer** | `tryDeferPlayLandForWouldEnterReplacement` before battlefield entry | `stackPlayLandUtils.ts` |
| **Resolution** | `landWouldEnterSacrificeChoice` handler + OPTION_CHOICE validation | `resolution.ts` |
| **Replay** | `landWouldEnterSacrificeChoice` applyEvent + replay coverage meta | `applyEvent.ts`, `replay-coverage.meta.test.ts` |
| **AI** | `chooseAILandWouldEnterSacrificeSelection` | `ai.ts` |
| **Tests** | defer / accept / decline + replay semantics | `land-would-enter-sacrifice.integration.test.ts`, `land-would-enter-sacrifice.replay.test.ts` |
| **Migration bar** | **752/752** (unchanged) | `npm run test:oracle-ir-migration` |

### Track E — batch 430: final trigger `not_detected` gaps ✅

| Item | Change | Key files / tests |
|------|--------|-------------------|
| **Tribal deals damage** | `whenever a ([\w]+) deals damage to you` pattern in `detectDealtDamageTriggers` | `triggered-abilities.ts` |
| **explore-clash** | `KEYWORD_ACTION_WITH_CONTINUATION` + standalone `explore-clash` guard in effect normalizer | `oracleReminderText.ts` |
| **Effect extraction** | `if you win` as continuation sentence | `triggerEffectTextExtraction.ts` |
| **Metrics** | `not_detected` **2 → 0**; `fully_covered` **15,741** | `npm run trigger:coverage` |
| **Migration bar** | **752/752** (unchanged) | `trigger-coverage-audit.probe.unit.test.ts` |

### Track E — batch 429: support keyword ETB effect preservation ✅

| Item | Change | Key files / tests |
|------|--------|-------------------|
| **Keyword actions** | `STANDALONE_KEYWORD_ACTION_EFFECT` guard in `stripKeywordAbilitySuffixes` — `support 2` no longer treated as reminder suffix | `oracleReminderText.ts` |
| **ETB detection** | `detectETBTriggers` + parser retain support effects; audit `not_detected` **12 → 2** | `triggered-abilities.ts` (via shared normalizer), `oracleReminderText.test.ts` |
| **Regression** | Expedition Raptor ETB + Door chosen-type cast in audit probe tests | `trigger-coverage-audit.probe.unit.test.ts` |
| **Migration bar** | **752/752** (unchanged) | `server/package.json` |

### Track E — batch 428: trigger coverage audit probe metadata ✅

| Item | Change | Key files / tests |
|------|--------|-------------------|
| **Probe permanent** | `buildAuditProbePermanent` sets `chosenCreatureType` / `chosenLandType` / `chosenCardName` from oracle text | `trigger-coverage-audit.ts` |
| **Detector wiring** | `serverDetectsTrigger`, `getDetectorResultsForEvent`, `anyServerTriggerDetectorMatches` use probe permanent | same |
| **Regression** | Door of Destinies chosen-type cast trigger detected in audit | `trigger-coverage-audit.probe.unit.test.ts` |
| **Metrics** | `not_detected` trigger gaps **15 → 12** (Door, Reflections of Littjara, Chronicle of Victory fixed) | `npm run trigger:coverage` |
| **Migration bar** | **752/752** (unchanged) | `server/package.json` |

### Track E — batch 427: Station activatable graveyard-cast static gate ✅

| Item | Change | Key files / tests |
|------|--------|-------------------|
| **Static skip** | `isActivatableStationGraveyardPermissionLine` excludes Broodship-style once-per-turn graveyard cast from static permission synthesis and `getSpecificSpellFromGraveyardPermission` scan | `graveyard-permissions.ts`, `can-respond.ts` |
| **Regression** | Serra Paragon static grants unchanged; no candidates until IR activation | `durable-permissions.test.ts`, `oracle-ir-broodship-graveyard-cast.socket.integration.test.ts` |
| **Migration bar** | **752/752** (+1 test) | `server/package.json` |

### Track E — batch 426: request-cast Broodship IR activation alignment ✅

| Item | Change | Key files / tests |
|------|--------|-------------------|
| **IR activation** | Broodship test activates 8+ graveyard-cast ability before cast candidates / `requestCastSpell` (Chainer pattern) | `request-cast.graveyard-permission.integration.test.ts` |
| **Permission asserts** | `this_turn` first-class + durable `additionalCost: { sacrifice, land }` after IR resolve | same |
| **Migration bar** | **751/751** (unchanged) | `server/package.json` |

### Track E — batch 425: Broodship full event-log replay ✅

| Item | Change | Key files / tests |
|------|--------|-------------------|
| **Full replay** | `activateBattlefieldAbility` → sacrifice `castSpellContinuation` → mana `castSpellContinuation` → `castSpell` events replay sacrifice, mana payment, and graveyard cast | `oracle-ir-broodship-graveyard-cast.socket.integration.test.ts` |
| **Stack resolution** | Post-replay `resolveTopOfStack` loop (same pattern as `cast-from-graveyard.graveyard-replay.integration.test.ts`) — `castSpell` is persisted, resolution is not | test only |
| **Migration bar** | **751/751** (+1 test) | `server/package.json` |

### Track E — batch 424: discard `sourceGrantedAdditionalCost` live cast path ✅

| Item | Change | Key files / tests |
|------|--------|-------------------|
| **Cast candidates** | Structured `additionalCost: { type: 'discard' }` on durable graveyard permissions surfaces `sourceGrantedAdditionalCost` (Six land-filter + Kess any-card) | `can-respond.ts`, `durable-permissions.test.ts` |
| **Live cast** | `requestCastSpell` queues `ADDITIONAL_COST_PAYMENT` / `costType: 'discard'` from candidate metadata | `game-actions.ts`, `request-cast.graveyard-permission.integration.test.ts` |
| **Static Kess** | Full oracle discard clause parsed onto cast candidates via static permission scan | `can-respond.test.ts` |
| **Migration bar** | **750/750** (unchanged) | `server/package.json` |

### Track E — batch 423: Broodship EOT graveyard-permission cleanup ✅

| Item | Change | Key files / tests |
|------|--------|-------------------|
| **EOT symmetry** | `clearTemporaryPlayableFromGraveyardPermissions` already clears first-class `this_turn`/`end_of_turn` permissions and durable `graveyard_permission` mirror via `clearTemporaryDurableGraveyardPermissions` during cleanup | `graveyard-permissions.ts`, `turn.ts` |
| **Integration** | Live Broodship IR activation → cleanup step → activated `this_turn` permission id gone from both stores | `oracle-ir-broodship-graveyard-cast.socket.integration.test.ts` |
| **Migration bar** | **750/750** (+1) | `server/package.json` |

### Track E — batches 419–422: Broodship arc completion ✅

| Batch | Item | Key files / tests |
|-------|------|-------------------|
| **419** | Replay `castSpellContinuation` sacrifice step with durable `additionalCost` | `oracle-ir-broodship-graveyard-cast.socket.integration.test.ts` |
| **420** | Full cast completes; second graveyard cast blocked (`castFromGraveyardThisTurn`) | same |
| **421** | `mirrorGraveyardCastingPermissionsToDurable` on EP `applyRunResultState` | `effectProgramResolutionService.ts`, `effect-program-graveyard-mirror.unit.test.ts` |
| **3+ land** | Station threshold-aware `calculateMaxLandsPerTurn` (skip Exploration partial-name false positive) | `game-state-effects.ts`, `oracle-ir-station-multi-threshold.integration.test.ts` |
| **Generic** | Six retrace + Kess discard `additionalCost` durable restore | `durable-permissions.test.ts` |
| **422** | Adagia Station/`12+` create_token boundary regression guard | `oracleIRGapBatch422.test.ts` |

### Track E — batches 415–418 (prior in arc): structured graveyard additionalCost ✅

| Batch | Item | Key files |
|-------|------|-----------|
| **415** | `GraveyardCastingPermissionAdditionalCost` + `oracleGraveyardAdditionalCostToSerializable` | `graveyard-permissions.ts`, `graveyardPermissionAdditionalCost.ts` |
| **416** | Parser dedupe of redundant grant/modify `raw` | `oracleIRParserPostprocess.ts` |
| **417** | Durable round-trip for `sourceText` + `additionalCost` | `durable-permissions.ts` |
| **418** | Live IR → durable mirror on `applyOracleIRStepsOnServer` | `oracleIrServerZoneSync.ts` |

### Track E — Layer 3 batch 404: Kavaron threshold IR execution ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Step collection** | `collectActivatedAbilitySteps` parses full `N+ \|` lines via IR (no first-colon strip) | `oracleIrAbilityExecution.ts` |
| **Threshold helper** | `readStationChargeThresholdFromActivatedOracleText` for stack/activation metadata | same |
| **Integration** | Kavaron 12+ token + pump via `tryApplyOracleIRToActivatedAbility` | `oracle-ir-kavaron-threshold.integration.test.ts` |
| **Migration bar** | **729/729** (+3) | `server/package.json` |

### Track E — Layer 2 batch 403: Station threshold activated costs ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Cost split** | `12+ \| {cost}:` → `stationChargeThreshold: 12`, `cost: '{cost}'`, effect unchanged | `oracleTextParserKeywordCosts.ts`, `oracleTextParser.ts` |
| **IR field** | `OracleIRAbility.stationChargeThreshold` carried from parser | `oracleIR.ts`, `oracleIRParser.ts` |
| **Tests** | Adagia + Kavaron threshold lines; die-roll bands excluded | `oracleIRGapBatch403.test.ts` |

### Track E — Layer 2 batch 402: Squad token metadata with Flash ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Fallback target** | Squad `create_token` metadata prefers ETB triggered abilities over Flash/Vigilance static lines | `oracleIRParserPostprocess.ts` |
| **Keyword expand guard** | `expandStandaloneStaticKeywordAbilities` skips abilities that already carry nested `create_token` metadata | same |
| **Regression** | `oracleIRCurrentBatch.test.ts` offset-1050 primary gaps green (Sicarian Infiltrator) | `oracleIRGapBatch402.test.ts` |

### Track E — Layer 2 batch 401: Station ability boundaries ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Line split** | `12+ \| {cost}:` threshold activations no longer merge onto Station reminder lines | `oracleTextParserPreprocess.ts` |
| **Station parse** | Dedicated `parseStationKeywordActivatedAbility` before generic colon split; strips inline threshold/sorcery reminders from effect | `oracleTextParserKeywordCosts.ts`, `oracleTextParser.ts` |
| **Reminder strip guard** | `normalizeOracleForParsing` preserves `Station (Tap …: …)` gameplay parens (Kavaron inline `It's an artifact creature at 12+`) | `oracleReminderText.ts` |
| **Prune fix** | Station charge-counter dedupe applies to `keyword` abilities; keeps `add_counter` when threshold reminder is inline | `oracleIRParserPostprocess.ts` |
| **Tests** | Adagia + Kavaron Station/`12+` separation; reminder normalization | `oracleIRGapBatch401.test.ts`, `oracleReminderText.test.ts` |

### Track E — Layer 2 batch 400: Station charge counters on Planet ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Self target** | `this Planet` resolves as source permanent for counter placement | `oracleIRExecutorBattlefieldStepHandlers.ts` |
| **Dynamic amount** | `object_stat` power + `equal to its power` falls back to `referenceAmount` / `stationedCreaturePower` | `oracleIRExecutorResolveQuantity.ts` |
| **Audit enrich** | Seeds stationed creature power for Planet charge-counter dry-runs | `executor-coverage-audit.ts` |
| **Audit** | Last non-choice skip cleared (`unsupported_target` **0**) | `executor-coverage-audit.json` |
| **Test** | `oracleIRGapBatch400.test.ts` | rules-engine |

### Track E — Layer 2 batch 399: flicker `those cards` return ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Exile ledger ids** | `exileBattlefieldPermanents` records zone card ids in `lastExiledCards`/`lastMovedCards` (matches exile zone containers) | `oracleIRExecutorSpecialTargetHandlers.ts`, `oracleIRExecutorBattlefieldOps.ts` |
| **Contextual filter** | `contextualBoundCardIds` no longer wiped when audit `chosenObjectIds` use permanent ids | `oracleIRExecutorMoveZoneStepHandlers.ts` |
| **Audit** | Displace / Illusionist's Stratagem flicker chain fully applied; **0** parse→execute gaps | `executor-coverage-audit.json` |
| **Test** | `oracleIRGapBatch399.test.ts` — exile up to two → return those cards | rules-engine |

### Track E6 — Layer 3 batch 14: trigger uncategorized spell fallback retirement ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Tail shim skip** | When `shouldSkipTriggerUncategorizedFallback`, skip `applyOracleIRUncategorizedSpellFallback`; retain copy/explore/equipped-token special handlers only | `stackExecuteTriggerEffectTailUtils.ts`, `stackExecuteTriggerEffectIrFallbackUtils.ts`, `oracleIrTriggerUncategorizedFallback.ts` |
| **Special-handler export** | `applyTriggerIrSpecialHandlersOnly` for IR-owned tail path without spell fallback | `oracleIrTriggerUncategorizedFallback.ts` |
| **Tests** | Tail skip unit test + guardrail wiring for uncategorized fallback skip | `oracle-ir-trigger-legacy-handler-retirement.unit.test.ts`, `oracle-ir-trigger-legacy-guardrail.test.ts` |
| **Migration suite** | **726/726 pass** (+1) | server tests |

### Track E6 — Layer 3 batch 13: trigger compound Effect Program expansion ✅

| Item | Change | Key files |
|------|--------|-----------|
| **EP gate expansion** | `requiresCoreEffectProgramOrchestration` routes `choose_color`, `choose_card_name`, and `choose_opponent` + follow-up compounds through Effect Program (same pattern as `choose_creature_type`) | `oracleIrEffectProgramServer.ts` |
| **Preset bindings** | EP initial bindings now preset `choose_color`, `choose_card_name`, and `choose_opponent` from IR context | same |
| **Live trigger tests** | `tryResolveTriggerViaOracleIR` end-to-end for color→mana, opponent→draw, and fateseal compounds | `oracle-ir-trigger-compound-effect-program.integration.test.ts` |
| **Migration suite** | **725/725 pass** (+8); fateseal/clash EP tests added to migration bar | `server/package.json`, server tests |

### Track E6 — Layer 3 batch 12: trigger legacy tail regex retirement ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Tail regex skip** | When `shouldSkipLegacyTriggerRegexHandlers`, skip combined/single/late legacy regex batches; IR uncategorized fallback + prepared-state tail retained | `stackExecuteTriggerEffectTailUtils.ts` |
| **Tests** | Tail skip unit test when IR owns draw text | `oracle-ir-trigger-legacy-handler-retirement.unit.test.ts` |
| **Migration suite** | **717/717 pass** (+1) | server tests |

### Track E6 — Layer 3 batch 11: trigger legacy orchestration retirement ✅

| Item | Change | Key files |
|------|--------|-----------|
| **IR-first dispatch** | `tryResolveTriggerViaOracleIR` runs before legacy create-token/keyword pre-hooks (matches spell stack order) | `stackExecuteTriggerEffectUtils.ts` |
| **Body handler skip** | `shouldSkipLegacyTriggerBodyHandlers` wired — fully IR-wired effects bypass legacy body chain; tail fallback retained | `stackExecuteTriggerEffectLegacyBodyUtils.ts` |
| **Guardrail** | Source-order assertion IR before legacy create-token | `oracle-ir-trigger-legacy-guardrail.test.ts` |
| **Migration suite** | **716/716 pass** (unchanged count) | server tests |

### Track E6 — Layer 3 batch 10: trigger compound live-path integration ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Trigger Green Sun resume** | `tryResolveTriggerViaOracleIR` → LIBRARY_SEARCH → resume puts chosen card in hand | `oracle-ir-reveal-player-choice.integration.test.ts` |
| **Trigger Kindred EP** | `choose_creature_type` compounds route through Effect Program on trigger path; CREATURE_TYPE_CHOICE + resume completes reveal-until | `oracle-ir-kindred-summons.integration.test.ts` |
| **Migration suite** | **716/716 pass** (+3) | server tests |

### Track E6 — Layer 3 batch 9: trigger Effect Program gate ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Trigger EP gate** | `requiresTriggerEffectProgramOrchestration` — same direct-IR gate as spells; reveal/player_choice/move compounds no longer route through in-memory EP on trigger path | `oracleIrEffectProgramServer.ts`, `oracleIrTriggerExecution.ts` |
| **Shared core gate** | `requiresCoreEffectProgramOrchestration` + spell/trigger aliases | `oracleIrEffectProgramServer.ts` |
| **Trigger LIBRARY_SEARCH** | `tryResolveTriggerViaOracleIR` queues among-them search for Green Sun effect text (no `effectProgramPrompt`) | `oracle-ir-reveal-player-choice.integration.test.ts` |
| **Migration suite** | **713/713 pass** (+2) | server tests |

### Track E6 — Layer 3 batch 8: compound reveal→choice stack path ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Spell EP gate** | `requiresSpellEffectProgramOrchestration` — direct IR for reveal/player_choice/move compounds; EP kept for modal, Kindred, fateseal/clash | `oracleIrEffectProgramServer.ts`, `oracleIrSpellExecution.ts` |
| **Green Sun stack path** | `resolveTopOfStack` queues LIBRARY_SEARCH (not silent EP completion); resume to hand | `oracle-ir-reveal-player-choice.integration.test.ts` |
| **EP step carry-over** (batch 7 carry) | `lastMovedCards` / `lastRevealedCardCount` across EP oracle_ir commands | `effectProgramOracleRunner.ts`, `oracleIRExecutorMainLoop.ts` |
| **Migration suite** | **711/711 pass** (+3) | server tests |

### Track E6 — Layer 3 batch 7: Kindred Summons live stack path ✅

| Item | Change | Key files |
|------|--------|-----------|
| **`reveal_top` runtime wiring** | Added to `ORACLE_IR_FALLBACK_STEP_KINDS` so spell primary owns Kindred Summons | `trigger-runtime-wiring.ts` |
| **Legacy pre-resolution skip** | Skip legacy `CREATURE_TYPE_CHOICE` when Effect Program orchestrates (choose_creature_type + follow-ups) | `stackResolveSpellChoiceUtils.ts` |
| **Spell EP waitingForChoice** | Return `handled: true` when Effect Program queues choice (align with trigger path) | `oracleIrSpellExecution.ts` |
| **Legacy Kindred skip** | Skip `resolveKindredSummonsFromLibrary` when IR primary owns spell | `stackResolveSpellChoiceUtils.ts` |
| **EP step carry-over** | Propagate `lastMovedCards` / `lastRevealedCardCount` across Effect Program oracle_ir commands | `effectProgramOracleRunner.ts`, `oracleIRExecutorMainLoop.ts` |
| **EP zone sync** | Sync full library arrays into `zones[player].library` after Effect Program | `effectProgramResolutionService.ts` |
| **Migration suite** | **708/708 pass** (+3); stack resolveTopOfStack → CREATURE_TYPE_CHOICE → resume | `oracle-ir-kindred-summons.integration.test.ts` |

### Track E6 — Layer 3 batch 6: Green Sun's Twilight X≥5 alternate ✅

| Item | Change | Key files |
|------|--------|-----------|
| **X≥5 alternate IR** | `xAtLeastAlternate` on reveal→choose→move steps; battlefield-or-hand when X≥5 | `oracleIRParserPostprocess.ts`, `oracleIR.ts` |
| **Destination choice** | Executor + `moveZoneDestination` selector context | `oracleIRExecutorMoveZoneStepHandlers.ts`, `oracleIRExecutionTypes.ts` |
| **Server queue/resume** | OPTION_CHOICE after LIBRARY_SEARCH when X≥5; persist `oracleIrXValue` on resume | `oracleIrServerZoneSync.ts` |
| **Migration suite** | **705/705 pass** (+1); X=5 battlefield integration test | `oracle-ir-reveal-player-choice.integration.test.ts` |

| Item | Change | Key files |
|------|--------|-----------|
| **Reveal until X of chosen type** | `resolveRevealUntilReferenceAmountForPlayer` handles Kindred Summons amount + chosen type | `oracleIRExecutorPlayerUtils.ts` |
| **Ability merge** | `mergeChooseCreatureTypePrefixAbilities` merges split choose + reveal steps | `oracleIRParserPostprocess.ts` |
| **Ledger contextual ids** | `resolveContextualCardIdsInZones` falls back to step ledger when bridge strips carry-over | `oracleIRExecutorMoveZoneStepHandlers.ts` |
| **Green Sun resume rider** | Drop bogus `pass36` grant_static from parser + resume filter | `oracleIRParserPostprocess.ts`, `oracleIrServerZoneSync.ts` |
| **Migration suite** | **704/704 pass** (+2); `oracle-ir-kindred-summons.integration.test.ts` | server tests |

### Track E6 — Layer 3 batch 4: reveal → choose → move (Green Sun's Twilight) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **"Those cards" move from library** | Contextual bound-card handler moves library-zone cards via `moveContextualCardToDestination` (was falling through to exile mover) | `oracleIRExecutorMoveZoneStepHandlers.ts` |
| **Chosen subset** | Filter contextual bound ids by `chosenObjectIds` when antecedent pool is full reveal set | same |
| **Rest to bottom** | Rest pool reads step ledger when runtime `lastMovedCards` absent on IR resume | same |
| **Server queue bridge** | Among-them `LIBRARY_SEARCH` + resume with `chosenObjectIds`; ledger at queue time | `oracleIrServerZoneSync.ts`, `oracleIRLedgerCardAccess.ts` |
| **Migration suite** | **702/702 pass** (+1); `oracle-ir-reveal-player-choice.integration.test.ts` | server tests |

### Track E6 — Layer 3 batch 3: Hakbal + Celestial Reunion ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Celestial Reunion X** | Resolve `manaValueLte: -1` from `xValue` before library search filter | `oracleIRExecutorPlayerStepHandlers.ts` |
| **Hakbal land-play** | Skip `LIBRARY_SEARCH` bridge for hand→battlefield optional land steps; defer draw sync when KYNAIOS queued | `oracleIrServerZoneSync.ts`, `oracleIrTriggerExecution.ts` |
| **Migration suite** | **701/701 pass** (+7 from 694) | server tests |

### Track E6 — Layer 3 batch 2: counter distribution ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Counter distribution** | Always queue `COUNTER_DISTRIBUTION` when split needs player choice (even with pre-bound targets) | `oracleIRExecutorBattlefieldStepHandlers.ts` |
| **Migration suite** | **698/701 pass** (+4) | server tests |

### Track E6 — Layer 3 batch 1: zone-change card id ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Partial → 0** | Remaining 13 library/reveal/compound clusters closed via executor fixes + audit benign/enrich (batch398 fixtures) | `executor-coverage-audit.ts`, parser/executor |
| **Layer 3 helpers** | `buildPlayerChoiceAmongThemSelectionOptions`, `buildMoveZoneSelectionOptions` for reveal→choice→move and GY chain heads | `oracleIRExecutorPlayerStepHandlers.ts` |
| **Tests** | `oracleIRGapBatch398.test.ts` (2) | rules-engine |
| **Re-audit** | parse→execute **13 → 0**; `partial` **13 → 0**; assisted **100%** (47570/47570) | `executor-coverage-audit.json` |
| **Migration suite** | `npm run test:oracle-ir-migration` — **670/701 pass**, 31 Layer 3 gaps exposed | server tests |

**Next:** Track E6 — targeted zone-change queue resume (P0), then compound library search / reveal chains.

### Track E2 — Parse→execute + remaining IR gap (batch 397) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Spry and Mighty** | Move `upgradeSpryAndMightyCompoundSteps` to end of parse pipeline (late re-split fix) | `oracleIRParser.ts`, `oracleIRParserPostprocess.ts` |
| **Generic remove_counter** | Resolve `counter` → first counter on target; prefer explicit `targetPermanentId` over polluted `chosenObjectIds` | `oracleIRExecutorBattlefieldStepHandlers.ts` |
| **Audit fixtures** | Batch396 no longer injects Spry `chosenObjectIds` on unrelated remove-counter clusters | `executor-coverage-audit.ts` |
| **Reminder pruning** | `pruneIgnorableEffectReminderUnknownSteps` (food/treasure/airbend/snow/ETB unless/token metadata) | `oracleIRParserPostprocess.ts` |
| **IR fragments** | Oko −2/−0, blight 1, land ETB unless; ignorable snow/airbend/station/planet/token metadata | `oracleIRParserPostprocess.ts`, `trigger-coverage-audit.ts` |
| **Benign audit** | Expanded `isBenignFullCardAbilityMetadata`, `skippedStepIsBenignForAudit`, `unsupportedStepIsBenignForAudit` | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch397.test.ts` (2) | rules-engine |
| **Re-audit** | parse→execute **28 → 13**; assisted **100%** | `executor-coverage-audit.json` |

**Next batch targets:** remaining **13** `partial` (library reveal / emblem / gy chains).

### Track E2 — Parse→execute + remaining IR gap (batch 396) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **remove_counter** | `reference_amount` resolution; bound `target creature`; `it`→source for prevent-and-remove fragments | `oracleIRExecutorBattlefieldStepHandlers.ts` |
| **Memory Lapse** | Countered spell GY→library top when stack empty; audit stack fixture `type: 'spell'` | `oracleIRExecutorMoveZoneStepHandlers.ts`, `executor-coverage-audit.ts` |
| **Triple damage** | `triple that` unknown/reference amount in damage + quantity resolution | `oracleIRExecutorDamageStepHandlers.ts`, `oracleIRExecutorResolveQuantity.ts` |
| **Player choice** | Auto-bind `chosenObjectIds` for “choose exactly N creatures” in audit | `oracleIRExecutorMainLoop.ts` |
| **Spry and Mighty** | Repair split trample draw step; compound step postprocess | `oracleIRParserPostprocess.ts`, `oracleIRParser.ts` |
| **IR fragments** | `draw a card.`, menace line, protection-from-each-color | `oracleIRParserPostprocess.ts` |
| **Benign metadata** | Alternate costs, ETB counter choice, prevent+remove one counter | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch396.test.ts` (6) | rules-engine |
| **Re-audit** | parse→execute **67 → 28**; assisted **99.9%** | `executor-coverage-audit.json` |

**Next batch targets:** remaining **28** parse→execute, **9** `ir_gap`, **27** `partial`.

### Track E3 — IR gap keyword / fragment clusters (batch 395) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Keyword statics** | Haunt, Provoke standalone → `grant_static_ability`; prepared entry; keyword-only static clause routing | `oracleIRParserStaticAbilityClauses.ts`, `oracleIRParserPostprocess.ts` |
| **Transform costs** | More Than Meets the Eye / Recover / champion / echo / bloodthirst / commander ninjutsu / freerunning → structured keyword grants | `oracleIRParserPostprocess.ts` |
| **Replacement fragments** | Standalone `prevent that damage` → `prevent_damage`; opponent-control fragment metadata | `oracleIRParserPostprocess.ts` |
| **Audit ignorable** | Batch395 compound prevent/ETB/counter fragments in `isIgnorableUnknownIrGap` | `trigger-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch395.test.ts` (4) | rules-engine |
| **Re-audit** | `ir_gap` **105 → 11** (−94); assisted **99.8%** | `executor-coverage-audit.json` |

**Next batch targets:** remaining **11** `ir_gap`, parse→execute gaps (67), general gaps (4).

### Track E2 — General parse→execute clusters (batch 394) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **create_token** | Contextual copy sources (exiled/moved/destroyed); Mirror Match attacking copies; owner_of_moved_cards via ctx; exiled-with before target-copy | `oracleIRExecutorTokenStepHandlers.ts` |
| **exchange_control** | Creature-filtered chosen IDs for first/second target | `oracleIRExecutorBattlefieldStepHandlers.ts` |
| **gain_control** | Turf War contested-land transfer + untap | `oracleIRExecutorBattlefieldStepHandlers.ts` |
| **mill** | Delirium `that player mills` preserves opponents; target_player fallback | `oracleIRExecutorPlayerStepHandlers.ts`, `executor-coverage-audit.ts` |
| **deal_damage** | Destroyed-creature power for conditional Kaervek/Cinder Cloud; object_stat source+creature's power | `oracleIRExecutorSpecialTargetHandlersBatch391Bulk.ts`, `oracleIRExecutorResolveQuantity.ts` |
| **copy_spell** | Instant/sorcery replay fallback when oracle text missing on moved card | `oracleIRExecutorCopySpellSupport.ts` |
| **modify_pt** | Quest-counter on-this-permanent via condition.raw | `oracleIRExecutorModifyPtStepHandlers.ts` |
| **Audit enrich** | Batch394 fixtures; step-based quest fixtures; delirium preserves p2–p4; final oracle-text fixture pass | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch394.test.ts` (3) | rules-engine |
| **Re-audit** | gaps **54 → 38** (−16); assisted **99.7%** | `executor-coverage-audit.json` |
| **Gap analysis** | General items **16 → 0** (−16) | `executor-fullcard-general-gap-analysis.json` |

**Next batch targets:** **E3** `ir_gap` (105), remaining parse→execute gaps (38).

### Track E2 — General parse→execute clusters (batch 393) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **move_zone** | `command` destination allowed; target-player gy→library; early commander→command zone | `oracleIRExecutorMoveZoneStepHandlers.ts` |
| **shuffle_library** | `that player shuffles` fallback + soft apply when player record missing | `oracleIRExecutorPlayerStepHandlers.ts` |
| **draw / amounts** | `the_milled_card` object_stat via `lastMilledCards` | `oracleIRExecutorResolveQuantity.ts`, `oracleIRExecutorPlayerStepHandlers.ts` |
| **modify_pt** | xValue fallback before unsupported where-clause | `oracleIRExecutorModifyPtStepHandlers.ts` |
| **deal_damage** | creature's controller + creature power bulk patterns | `oracleIRExecutorSpecialTargetHandlersBatch391Bulk.ts` |
| **create_token** | chosen-name / exiled-with copy sources; owner_of_source from moved cards | `oracleIRExecutorTokenStepHandlers.ts`, `oracleIRExecutorPlayerUtils.ts` |
| **grant_gy_permission** | each permanent type selector | `oracleIRExecutorPlayerStepHandlers.ts` |
| **resolvePlayers** | `ctx.targetPlayerId` binding for target_player | `oracleIRExecutorPlayerUtils.ts` |
| **Audit enrich** | batch393 fixtures; delirium shuffle / milled-card oracle hooks | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch393.test.ts` (3) | rules-engine |
| **Re-audit** | gaps **62 → 54** (−8); assisted **99.7%** | `executor-coverage-audit.json` |
| **Gap analysis** | General items **28 → 16** (−12) | `executor-fullcard-general-gap-analysis.json` |

**Next batch targets:** copy-token edge cases (6), `unknown_amount` (6), player selectors (2), then **E3** `ir_gap` (105).

### Track E2 — General parse→execute clusters (batch 392) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **add_mana** | Combination default/truncate for audit `{R}` / `{W}{W}{W}`; two-mana any-combination-of-colors | `oracleIRExecutorPlayerStepHandlers.ts`, `executor-coverage-audit.ts` |
| **move_zone** | Gy-return `lastMovedCards` MV enrich; command zone / Repopulate / top-or-bottom library; another-permanent gy→bf; return-it bf | `oracleIRExecutorMoveZoneStepHandlers.ts`, `oracleIRExecutorZoneOps.ts` |
| **deal_damage** | Early fight dispatch before amount; spell-power / creature-power / card MV bulk | `oracleIRExecutorDamageStepHandlers.ts`, `oracleIRExecutorSpecialTargetHandlersBatch391Bulk.ts` |
| **modify_pt** | Double P/T; tribal chosen type; Forest+trample scaler strip; quest counters | `oracleIRExecutorModifyPtStepHandlers.ts` |
| **gain_control** | Each-player / until-EOT / equipment / creature-type patterns | `oracleIRExecutorBattlefieldStepHandlers.ts` |
| **lose_life / discard** | Sacrificed-permanent MV; each discard their hands; owner_of_moved_cards tokens | `oracleIRExecutorPlayerStepHandlers.ts`, `oracleIRExecutorPlayerUtils.ts`, `oracleIRExecutorTokenStepHandlers.ts` |
| **where-X / tokens** | nontoken died, Treasure created, rad counters, vehicles+equipment, opponents power 4+ | `oracleIRExecutorModifyPtWhereTurnStats.ts`, `oracleIRExecutorModifyPtWhereBoardStateCounts.ts` |
| **conditional ctx** | Pass `lastMovedCards` into nested conditional recurse | `oracleIRExecutorMainLoop.ts` |
| **Audit enrich** | Batch392 fixtures; one-or-fewer-cards hand keeps p2; gy-antecedent cmc | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch392.test.ts` (3) | rules-engine |
| **Re-audit** | gaps **93 → 62** (−31); assisted **99.7%** | `executor-coverage-audit.json` |
| **Gap analysis** | General items **59 → 28** (−31) | `executor-fullcard-general-gap-analysis.json` |

**Next batch targets:** copy-token edge cases (10 `impossible_action`), `unknown_amount` (7), `unsupported_player_selector` (4), then **E3** `ir_gap` (105).

### Track E2 — General parse→execute clusters (batch 391) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **create_token** | OR-type copy reference matching (`artifact or creature`); sacrificed-creature copy source; that-creature MV token amounts | `oracleIRExecutorTokenStepHandlers.ts` |
| **modify_pt** | Scalers: each of its colors, Forest, Plains returned, nonbasic land defending player, +1/+1 removed, creature sacrificed, Treasure mana; where-X: sacrificed enchantment MV, hand-size, returned-card toughness | `oracleIRExecutorModifyPtStepHandlers.ts`, `oracleIRExecutorModifyPtWherePlayerAndReferenceState.ts` |
| **deal_damage** | Fight / defending-player / those-creatures power; batch391 bulk | `oracleIRExecutorDamageStepHandlers.ts`, `oracleIRExecutorSpecialTargetHandlersBatch391Bulk.ts` |
| **draw / gain_life / discard** | Milled-card MV draw; sacrificed-enchantment MV life; discard-your-hand | `oracleIRExecutorPlayerStepHandlers.ts` |
| **add_mana** | X combination padding; `{B}` or `{G}` for-each choice | `oracleIRExecutorPlayerStepHandlers.ts` |
| **prevent_damage** | Target-creature X fallback when recipient binding present | `oracleIRExecutorDamageStepHandlers.ts` |
| **grant_graveyard_permission** | Merfolk/Druid dual-type; cards with retrace | `oracleIRExecutorPlayerStepHandlers.ts` |
| **Audit enrich** | Batch391 fixtures (copy targets, fight, scalers, sacrificed/milled context) | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch391.test.ts` (3) | rules-engine |
| **Re-audit** | gaps **122 → 93** (−29); assisted **99.8%**; `unsupported_scaler` **8 → 1** | `executor-coverage-audit.json` |
| **Gap analysis** | General items **89 → 59** (−30) | `executor-fullcard-general-gap-analysis.json` |

**Next batch targets:** `unknown_amount` (18), copy-token edge cases (13 `impossible_action`), `unsupported_player_selector` (12), then **E3** `ir_gap` (105).

### Track E2 — General parse→execute clusters (batch 390) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **modify_pt** | `it`→sourceId fallback; zero-scale blocking/other-goblin still applies; `blockedBy` on permanent; other-subtype-you-control scaler | `oracleIRExecutorModifyPtStepHandlers.ts` |
| **create_token** | Populate/copy reminder resolves `creature token you control` on battlefield | `oracleIRExecutorTokenStepHandlers.ts` |
| **add_mana** | Commander color identity audit fixtures | `executor-coverage-audit.ts` |
| **prevent_damage** | `Prevent the next X damage…` uses `ctx.xValue`; player-target X prevention | `oracleIRExecutorDamageStepHandlers.ts` |
| **gain_life** | `that card's mana value` from contextual moved/revealed cards | `oracleIRExecutorPlayerStepHandlers.ts` |
| **grant_graveyard_permission** | `Zombie spells` / `legendary card` selector criteria | `oracleIRExecutorPlayerStepHandlers.ts` |
| **paradigm** | Registered as applied (no longer `unsupported_step`) | `oracleIRExecutorMainLoop.ts` |
| **Audit enrich** | Batch390 fixtures (commander identity, blocking, tokens, revealed card, X) | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch390.test.ts` (3) | rules-engine |
| **Re-audit** | gaps **195 → 122** (−73); assisted **99.5%**; `no_applicable_targets` **38 → 2**; `unsupported_step` **5 → 0** | `executor-coverage-audit.json` |
| **Gap analysis** | General items **166 → 89** (−77) | `executor-fullcard-general-gap-analysis.json` |

**Next batch targets:** `unknown_amount` (21), copy-token target patterns (25 `impossible_action`), `unsupported_player_selector` (12), `unsupported_scaler` (8).

### Track E2 — Target clusters (batch 389 mega-batch) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk handlers** | Exile void counter (Dauthi); destroy Equipment / enchantment-that-player-controls (Unforge, Polis Crusher); sacrifice target-opponent creature (Invoke Despair); copy source-becomes-copy (Oko); deal_damage self-power + attached-creature (Cut Propulsion, Wisecrack, Unforge) | `oracleIRExecutorSpecialTargetHandlersBatch389Bulk.ts` |
| **Battlefield steps** | Kulrath opponent+counter cant_attack/cant_block; Magistrate's Veto white/blue cant_block; Sierra quest-counter modify_pt early return fix | `oracleIRExecutorBattlefieldStepHandlers.ts`, `oracleIRExecutorModifyPtStepHandlers.ts` |
| **Audit enrich** | 10 batch389 tail predicates (void exile, Kulrath, Oko copy, Magistrate, Invoke Despair, Unforge, Wisecrack wording) | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch389.test.ts` (3) | rules-engine |
| **Re-audit** | gaps **238 → 195** (−43); target gaps **47 → 0**; assisted **99.4%** (47481/47781) | `executor-coverage-audit.json` |
| **Gap analysis** | Target **0** items / **0** clusters (was 47/49) | `executor-fullcard-target-gap-analysis.json` |

**Next batch E2 targets:** non-target parse→execute gaps (195 items), `ir_gap` step kinds, `unknown_amount` clusters.

### Track E2 — Target clusters (batch 388 mega-batch) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk handlers** | Exile/destroy/sacrifice/copy/remove_counter: Delay suspend-exile, Hunting Kavu, Golden Throne, Ghostly Flicker, Into the Core, Profane Procession, Cloud's Limit Break, Deadeye Harpooner, Violent Ultimatum, Blow Your House Down, Myrkul/Social Snub sacrifice, Mizzium/Mirror of Forebears/Thespian's Stage/Ever-Changing Dane copy, Jhoira/Ashling counters | `oracleIRExecutorSpecialTargetHandlersBatch388Bulk.ts` |
| **Battlefield steps** | Mana Vapors skip untap; Flash/Wave/Kujata/Mark cant_block; during-your-turn equipped/commander/historic/outlaw grants; Flamebreak regen; Wrecking Ball/Legolas/Bilbo grants; Genju enchanted Forest/Mountain animate; Mark force_block; Katsumasa set_base_pt antecedent | `oracleIRExecutorBattlefieldStepHandlers.ts`, `oracleIRExecutorModifyPtStepHandlers.ts`, `oracleIRExecutorSpecialTargetHandlers.ts` |
| **Parser prune** | Llanowar Reborn move-counter parenthetical; Muddle end-of-combat token exile parenthetical | `oracleIRParserPostprocess.ts` |
| **Audit enrich** | 38 batch388 predicates (skip untap, cant_block, grant, copy, destroy, exile, sacrifice, force_block, animate, remove_counter) | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch388.test.ts` (3) | rules-engine |
| **Re-audit** | gaps **276 → 238** (−38); `no_deterministic_target` **53 → 26**; `unsupported_target` **36 → 23**; assisted **99.3%** (47438/47781) | `executor-coverage-audit.json` |
| **Gap analysis** | Target **47** items / **49** clusters (was 87/89) | `executor-fullcard-target-gap-analysis.json` |

**Next batch E2 targets:** equipped-creature static grants (Brotherhood Regalia), monocolored/allies cant restrictions, multi-target destroy/exile (two creatures/artifacts), copy-with-graveyard-X, remaining 49 clusters from target gap JSON.

### Track E2 — Target clusters (batch 387 mega-batch) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk handlers** | Exile/destroy/sacrifice/copy clusters: Topple greatest-power, Mangara compound, Another Round, Unpredictable Cyclone, Darkness Crystal, Sarulf MV exile, Quag Feast, Ouphe Vandals, Hex six, Consign to Dust; Shattergang/Skull Storm/Nahiri/Winnowing sacrifice; Mirrorform/True Polymorph/Animus copy | `oracleIRExecutorSpecialTargetHandlersBatch387Bulk.ts` |
| **Battlefield steps** | Flying/sculpture/bribery/spirit-enchanted/nonartifact cant restrictions; Secret Tunnel/Zurgo/Heroic Charge grants; Edifice compound; Combat Celebrant tap; Daghatar move counters; Die Young `{E}` modify_pt; Katsumasa set_base_pt; Hivis optional untap name match; equipped_creature fallback | `oracleIRExecutorBattlefieldStepHandlers.ts`, `oracleIRExecutorModifyPtStepHandlers.ts`, `oracleIRExecutorCreatureStepUtils.ts`, `oracleIRExecutorSpecialTargetHandlers.ts` |
| **Parser prune** | `exile it instead.)` parenthetical misparse | `oracleIRParserPostprocess.ts` |
| **Audit enrich** | Extended batch383 fixtures + 35 batch387 predicates (flying/sculpture/bribery/aura-host/shared-type/memory exile) | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch387.test.ts` (3) | rules-engine |
| **Re-audit** | gaps **309 → 276** (−33); `no_deterministic_target` **80 → 53**; `unsupported_target` **48 → 36**; assisted **99.2%** (47400/47781) | `executor-coverage-audit.json` |
| **Gap analysis** | Target **87** items / **89** clusters (was 122/128) | `executor-fullcard-target-gap-analysis.json` |

**Next batch E2 targets:** grant_temporary_ability “during your turn” / equipped clusters, multi-target destroy/exile, copy-with-exception text, remaining 89 clusters from target gap JSON.

### Track E2 — Target clusters (batch 386 mega-batch) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk handlers** | ~20+ cluster patterns: Carrionette unless-exile, Gwen Stacy saga graveyards, Fall of Impostor, Nicol Bolas library trim, Mindbreak Trap spells, Phyrexian Furnace bottom GY, Exquisite Archangel, Calamity MV exile, Everything Comes to Dust convoke exception, Guile spell exile; Overload/Price of Glory/Cleansing/indestructible/Wall of Vipers destroy; Full Moon's Rise werewolf regenerate; Thunderwave unchosen damage; Dust of Moments / Price of Betrayal / Timecrafting remove counter; Shapesharer copy; Rubblebelt suspect | `oracleIRExecutorSpecialTargetHandlersBatch386Bulk.ts`, `oracleIRExecutorSpecialTargetHandlers.ts` |
| **Battlefield steps** | `{S}`/`{E}`/result counter amounts; Aurification parenthetical cant_attack; enchanted/non-flying/beasts cant_block; annihilator grant; Dovin Baan cant_activate; luck counters; commander block restore | `oracleIRExecutorBattlefieldStepHandlers.ts` |
| **Target resolution** | `that creature` antecedent ids; Gatewatch loyalty move fallback; Faerie audit fixture merge (no BF wipe) | `oracleIRExecutorCreatureStepUtils.ts`, `oracleIRExecutorSpecialTargetHandlers.ts`, `executor-coverage-audit.ts` |
| **Audit enrich** | Extended batch383 fixtures + 24 batch386 predicates (PW/beacon/werewolf/shapeshifter/beast/convoke/time counters) | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch386.test.ts` (3) | rules-engine |
| **Re-audit** | gaps **348 → 309** (−39); `no_deterministic_target` **98 → 80**; `unsupported_target` **70 → 48**; assisted **99.1%** (47367/47781) | `executor-coverage-audit.json` |
| **Gap analysis** | Target **122** items / **128** clusters (was 161/168) | `executor-fullcard-target-gap-analysis.json` |

**Next batch E2 targets:** Die Young `{E}` modify_pt, static type-based cant_attack/cant_block (Katabatic Winds, Doomed Artisan), compound exile (Topple, Mangara), remaining single-count clusters from target gap JSON.

### Track E2 — Target clusters (batch 385) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Executor** | Fixed `applyExileStep` battlefield ref + normalized-target regexes; copy-permanent MV=X land; Siege Dragon non-flying damage; Eternal Wanderer / Visions sacrifice; Astarion/Drizzt reference counters; commander counters; Gideon compound exile; Wear Down destroy; Refraction Trap prevent; Gatewatch loyalty move; Quicksilver flood remove; Alaundo time counters; Oracle en-Vec cant_attack compound | `oracleIRExecutorBattlefieldStepHandlers.ts`, `oracleIRExecutorSpecialTargetHandlers.ts` |
| **Audit enrich** | Extended batch383 target fixtures (source PW, commander, artifacts, land, attacker, exiled power, p1 exile time counters) + 18 new cluster predicates | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch385.test.ts` (3) | rules-engine |
| **Re-audit** | gaps **362 → 348** (−14); `no_deterministic_target` **109 → 98**; `unsupported_target` **74 → 70**; assisted **99.1%** (47328/47781) | `executor-coverage-audit.json` |
| **Gap analysis** | Target **161** items / **168** clusters (was 176/183) | `executor-fullcard-target-gap-analysis.json` |

**Next batch E2 targets:** modify_pt `{E}`/Faerie Fencing, Carrionette unless-exile, Settle the Wreckage attacking exile, regenerate werewolf mass, remaining single-count clusters from target gap JSON.

### Track E2 — Target clusters (batch 384) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Parser postprocess** | Extended `isBatch382MisparseExecutableStep`: `(Those creatures can't attack` in cant_block/cant_attack block; duplicate optional Swamp sacrifice prune; Viper's Kiss compound static | `oracleIRParserPostprocess.ts` |
| **Executor** | Distribute counters `{S}` amount + bound chosen IDs; Exhaustion skip untap; other-creatures cant_attack; any-number/damaged/MV/toughness cant_block; destroy chosen permanents / two artifacts; double counters each-of-them; those-creatures lifelink; planeswalker loyalty counters; Gideon compound exile; attacking creatures exile; saga graveyard exile; Karn exile-the-other + silver counter | `oracleIRExecutorBattlefieldStepHandlers.ts`, `oracleIRExecutorSpecialTargetHandlers.ts` |
| **Audit enrich** | Extended batch383 target fixtures: distribute/skip untap/exile-the-other/destroy chosen/double counters patterns + snow/x ctx | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch384.test.ts` (3) | rules-engine |
| **Re-audit** | gaps **374 → 362** (−12); `no_deterministic_target` **120 → 109**; `unsupported_target` **76 → 74**; assisted **99.0%** (47314/47781) | `executor-coverage-audit.json` |
| **Gap analysis** | Target **176** items / **183** clusters (was 189/197) | `executor-fullcard-target-gap-analysis.json` |

**Next batch E2 targets:** copy_permanent with X, contextual sacrifice each opponent, Siege Dragon deal_damage, Aurification parenthetical cant_attack prune, remaining single-count clusters from target gap JSON.

### Track E2 — Target clusters (batch 383) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Parser postprocess** | Extended `pruneBatch382MisparseExecutableSteps`: awaken `{4}{U}` parentheticals (regex fix), Gelid Shackles truncated-target compound static, Mythos those-permanents bleed, regen reminder on damage | `oracleIRParserPostprocess.ts` |
| **Executor** | Black/goaded/otherwise cant_block; flying/islandwalk cant_attack; those-permanents cant_activate; any-number destroy + two enchantments; counters-on-it; player graveyard exile; those-creatures skip untap; damaged-creature regen restriction | `oracleIRExecutorBattlefieldStepHandlers.ts` |
| **Audit enrich** | Batch383 target fixture block (bound creatures, enchantments, goaded, GY, contextual ids) | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch383.test.ts` (3) | rules-engine |
| **Re-audit** | gaps **409 → 374** (−35); `no_deterministic_target` **153 → 120**; assisted **99.0%** (47302/47781) | `executor-coverage-audit.json` |

**Next batch E2 targets:** contextual exile/destroy (`exile the other`, saga chapters), copy_permanent with X, distribute counters, remaining single-count clusters from target gap JSON.

### Track E2 — Parser prune + target clusters (batch 382) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Parser postprocess** | `pruneBatch382MisparseExecutableSteps`: saga `Sacrifice after [IVXLCDM].)` lore tails; alternate-cost sacrifice lines; parenthetical cant_block/cant_attack reminders; flashback `Then exile it.)`; threshold static bleed; awaken parentheticals | `oracleIRParserPostprocess.ts`, `oracleIRParser.ts` (early + late pass) |
| **Executor** | Mass `creatures can't block this turn`; mass `creatures can't be blocked this turn`; non-subtype `Non-X creatures you control can't attack`; `destroy the rest` / `the chosen creatures` contextual destroy | `oracleIRExecutorBattlefieldStepHandlers.ts` |
| **Tests** | `oracleIRGapBatch382.test.ts` (4) | rules-engine |
| **Re-audit** | `unsupported_object_selector` **162 → 0**; gaps **618 → 409** (−209); assisted **98.9%** (47267/47781) | `executor-coverage-audit.json` |
| **Gap analysis** | Object selector **0/0**; target **224** items / **226** clusters | `executor-fullcard-object-selector-gap-analysis.json`, `executor-fullcard-target-gap-analysis.json` |

**Next batch E2 targets:** Awaken parentheticals (6+), Gelid Shackles compound static, `Black creatures can't block`, contextual `otherwise` cant_block, top `unsupported_target` destroy/exile clusters from target gap JSON.

### Track E1 — Object selector / move_zone (batch 381) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Parser postprocess** | `upgradeMoveZoneSelectorGapSteps`: Desertion counter→BF replacement, Leonardo `it` exile, See the Truth `each of those cards`, Nefarious `that many` GY exile, Glitch return+manifest split | `oracleIRParserPostprocess.ts`, `oracleIRParser.ts` |
| **Executor** | Self-reference→battlefield; `each of those cards` + library zone; `lastDiscardedCards` in contextual card resolution; reference-amount GY exile count | `oracleIRExecutorMoveZoneStepHandlers.ts`, `oracleIRExecutorZoneOps.ts` |
| **Audit fixtures** | Leonardo artifact in GY; Desertion countered creature; Nefarious damage `referenceAmount`; Glitch no-face-down keeps source on BF | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch381.test.ts` (3) | rules-engine |
| **Re-audit** | `unsupported_selector` **8 → 0**; assisted **98.4%** (47219/47969); gaps **622 → 618** | `executor-coverage-audit.json` |
| **Gap analysis** | Selector clusters **0** / **0**; condition clusters stay **0** | `executor-fullcard-selector-gap-analysis.json` |

**Next batch E2 targets:** top `no_deterministic_target` / `unsupported_target` clusters from audit JSON (attach/battlefield target resolution + enrich).

### Track D — Executor gap closure (batch 380 — final 27 clusters) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | Remaining 27 handlers: Oscorp Mayhem discard, Impromptu Raid, Foundry Helix artifact, Teferi ETB-as-creature, Cinder Cloud white death, Nasty End legendary, Dose main phase, Rith excess damage, Kazuul defending player, Jared all-colors, Barrin hand-from-BF, Creakwood elf/-1/-1, Invoke Despair they can't, Unforge equipment, Grinning Totem unplayed, Jadar no decayed, Chain Veil loyalty, Haphazard aim, Tainted Specter discard-this-way, Book life loss, Agni Kai fight excess, Prisoner's silence/snitch, Ayara +1/+1, Polis monstrous, Test of Endurance 50 life + more | `oracleIRExecutorConditionalStepSupportBatch380Bulk.ts` |
| **Unless inner** | Tainted Specter `they put a card from their hand on top of their library` | `oracleIRExecutorConditionalStepSupport.ts` |
| **Extended** | Tainted Specter full-sentence parser stub; batch380 wiring | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Audit fixtures** | Full batch380 cluster enrich block + unless put-on-top choice | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch380.test.ts` (3) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **27 → 0**; assisted **98.4%** (47214/47969) | `executor-coverage-audit.json` |
| **Gap analysis** | **0** gap items / **0** unique clusters | `executor-fullcard-condition-gap-analysis.json` |

**Track D condition-clause backlog: cleared.** Remaining executor gaps are other reason codes (targets, selectors, amounts, etc.).

**Cumulative from post-367 baseline (501): −501 condition-clause gaps** across batches 368–380 + cleanup.

### Track D — Executor gap closure (batch 379 — 36 clusters mega-batch) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | ~36 handlers: Breathless Knight GY entry, Filigree blue/black, Vault votes, Evolving Adaptive P/T, Land Grant hand, Deicide God, Taigam attack, Lightning Phoenix damage, Gore Vassal toughness, Urborg nonblack, Recalibrate discard, Wall damage, Defense of Heart creatures, Earthbind flying, Kellan Scout, Nimble Trapfinder party, Bottle-Cap excess permanent, Wisecrack attacking, Invert the Skies {G}/{U}, Wilhelt decayed, Runaway Steam-Kin counters, Might Makes Right power tie, Syrix gy leave, Magnanimous MV, Conduit no cast, Desertion counter, Triskaidekaphile 13 hand, Rite +1/+1 had, Pulse life, Dauthi replacement, Sandstalker blue/black spell, Cobra Trap destroy, Avacyn madness, Gunner enchanted/equipped, Gisela/Bruna meld + more | `oracleIRExecutorConditionalStepSupportBatch379Bulk.ts` |
| **Extended** | Invert the Skies compound modify_pt stub; Kellan Scout parser stub; batch379 wiring | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Audit fixtures** | Full batch379 cluster enrich block | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch379.test.ts` (4) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **63 → 27** (−36); assisted **98.4%** (47195/47969) | `executor-coverage-audit.json` |
| **Gap analysis** | **25** gap items / **27** unique clusters | `executor-fullcard-condition-gap-analysis.json` |

**Next batch 380 targets** (post-379 — run gap analysis for fresh list):
1. `you discarded it this turn` (Oscorp Industries / Mayhem)
2. `it isn't a creature card` (Impromptu Raid)
3. `the sacrificed permanent was an artifact` (Foundry Helix)
4. `it enters as a creature` (Teferi's Time Twist)
5. `a white creature dies this way` (Cinder Cloud)
6. `the sacrificed creature was legendary` (Nasty End)
7. `it isn't your main phase` (Dose of Dawnglow)
8. `a creature or planeswalker an opponent controlled was dealt excess damage this turn` (Rith)

**Cumulative from post-367 baseline (501): −474 gaps** across batches 368–379 + cleanup.

### Track D — Executor gap closure (batch 378 — 36 clusters mega-batch) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | ~36 handlers: quest present tense (`it has four or more`), Burrog/Savage modify_pt inners, Cut Propulsion flying, Once Upon a Time first spell, Breena opponent life, Artificer's Hex equipment, Spiders-Man web-slinging, Reaper hand size, Archive Trap search, Soulflayer delve flying, Lumengrid artifact discard, Bloodchief life/quest, Spire guess, Valakut exiled cards, Baba Lysaga card types, Sidequest creature death, Nefarious Lich damage redirect, Queen Marchesa monarch, Foreboding omen, Botanical Brawler first +1/+1, Hellish Vehicle, Warren Goblin, Ingenious Mastery alt cost, Dreampod enchanted, Necromancer zombie discard, Ashnod sacrifice-to-activate, Rowan draws, Rekindled empty hand, Mirkwood not attacking you, Urza meld, Thirsting Axe combat damage, Barren Glory composite, Ravenous Trap GY cards + more | `oracleIRExecutorConditionalStepSupportBatch378Bulk.ts` |
| **Extended** | batch378 wiring (after batch377); Burrog/Savage now handled via inner-clause bulk, not full-sentence stubs | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Audit fixtures** | Full batch378 cluster enrich block (incl. modify_pt inners, quest on source, meld pair, composite Barren Glory) | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch378.test.ts` (4) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **100 → 63** (−37); assisted **98.3%** (47167/47969) | `executor-coverage-audit.json` |
| **Gap analysis** | **61** gap items / **63** unique clusters | `executor-fullcard-condition-gap-analysis.json` |

**Next batch 379 targets** (post-378 — run gap analysis for fresh list):
1. `that creature entered from a graveyard or you cast it from a graveyard` (Breathless Knight)
2. `that permanent was blue or black` (Filigree Fracture)
3. `no creature got votes` (Vault 11: Voter's Dilemma)
4. `that creature has greater power or toughness than this creature` (Evolving Adaptive)
5. `you have no land cards in hand` (Land Grant)
6. `the exiled card is a God card` (Deicide)
7. `this permanent attacked this turn` (Taigam, Ojutai Master)
8. `an opponent was dealt 3 or more damage this turn` (Lightning Phoenix)

**Cumulative from post-367 baseline (501): −438 gaps** across batches 368–378 + cleanup.

### Track D — Executor gap closure (batch 377 — 36 clusters mega-batch) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | ~36 handlers: Desperate Plea sacrifice power, Peer Pressure type count, Barrin's Unmaking color mode, Razor Pendulum life, Azor's Gateway exiled MVs, Otherworldly Escort not Spirit, Wumpus {C}, Paragon 3-color activate, Darigaaz egg, outlaw/saproling-adjacent, Guiding Spirit gy top, Airbender quest, Balance of Power hand, Ever-Watching attack, Riders attacked, Septic poison, Naktamun hand, Waking the Trolls lands, Needlebite life gain, Scrying Glass reveal, Portent protect, Kodama/Beseech cast path, Fractal/Security/Lunar, Lux 30 counters, Wave combat damage, Massacre toughness, Sygg life loss, Master of the Hunt wolves, Impending Disaster lands, Glitch face-down + more | `oracleIRExecutorConditionalStepSupportBatch377Bulk.ts` |
| **Audit fix** | Rush `{E}{E}` unless enrich on `unlessCondition.raw` (`you pay {E}{E}`) | `executor-coverage-audit.ts` |
| **Extended** | Burrog Barrage / Savage Swipe compound modify_pt stubs; batch377 wiring | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Audit fixtures** | Full batch377 cluster enrich block | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch377.test.ts` (4) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **132 → 100** (−32); assisted **98.3%** (47134/47969) | `executor-coverage-audit.json` |
| **Gap analysis** | **97** gap items / **99** unique clusters | `executor-fullcard-condition-gap-analysis.json` |

**Next batch 378 targets** (post-377 — run gap analysis for fresh list):
1. `it has four or more quest counters on it` (Firebender/Waterbender Ascension — present tense vs batch377 past)
2. Burrog Barrage / Savage Swipe compound modify_pt (inline condition on step)
3. `that creature has flying` (Cut Propulsion)
4. `this spell is the first spell you've cast this game` (Once Upon a Time)
5. `that opponent has more life than another of your opponents` (Breena)
6. `enchanted Equipment is attached to a creature` (Artificer's Hex)
7. `they were cast using web-slinging` (Spiders-Man)
8. `defending player has two or fewer cards in hand` (Reaper of Night)

**Cumulative from post-367 baseline (501): −401 gaps** across batches 368–377 + cleanup.

### Track D — Executor gap closure (batch 376 — 36 clusters mega-batch) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | ~36 handlers: historic, Biblioplex land creature, Opal Palace commander mana, Titan Hunter, Thoughtbound Primoc, Sentinel's Mark, Guildmages' Forum multicolor, Vikya excess damage, Elanor Food, Cosmic Rebirth MV, modal costs ({1}{B}/{3}{G}/{2}{R}{R}), time counters, combat phase, Imaginary Pet hand, bidding, madness, Sidar Jabari, Kitsune auras, werewolf damage, Multiple Choice X, toxic enchanted, Bankbuster vehicle, Ultros 8 mana, Proft draws, Deadly Brew sacrifice, Galadriel elf ETB, Thallid saproling, Grisly noncombat, Celestial Reunion, Kaito, Lightning Coils + more | `oracleIRExecutorConditionalStepSupportBatch376Bulk.ts` |
| **Batch375 fix** | `it had mana value 3 or less` zone lookup (Consuming Ashes audit) | `oracleIRExecutorConditionalStepSupportBatch375Bulk.ts` |
| **Unless inners** | Skullscorch deal-damage; Liberty Prime / Rush `{E}{E}` energy | `oracleIRExecutorConditionalStepSupport.ts` |
| **Extended** | Parser-gap stubs for Rush of Inspiration + Skullscorch full unless; batch376 wiring; `lastExcessDamageDealtThisWay` destructuring | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Audit fixtures** | Full batch376 cluster enrich block | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch376.test.ts` (4) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **169 → 132** (−37); assisted **98.2%** (47105/47969) | `executor-coverage-audit.json` |
| **Gap analysis** | **129** gap items / **132** unique clusters | `executor-fullcard-condition-gap-analysis.json` |

**Next batch 377 targets** (post-376 — run gap analysis for fresh list):
1. `Draw two cards. Then discard a card at random unless you pay {E}{E}` (Rush of Inspiration — parser unless shape)
2. `its power is less than or equal to the sacrificed creature's power` (Desperate Plea)
3. `you control more creatures of that type than each other player` (Peer Pressure)
4. `that permanent shares a color with the most common color…` (Barrin's Unmaking)
5. `that player has 5 or less life` (Razor Pendulum)
6. `cards with five or more different mana values are exiled with this permanent` (Azor's Gateway)
7. `it's not a Spirit` (Otherworldly Escort)
8. `{C} wasn't spent to cast it` (Wumpus Aberration)

**Cumulative from post-367 baseline (501): −369 gaps** across batches 368–376 + cleanup.

### Track D — Executor gap closure (batch 375 — 36 clusters mega-batch) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | ~36 handlers: Graf Rats meld, Tyrannic War `{X}`, Squall chosen number, Lifecraft/Dual-Sun counters, Chance Encounter luck, Feast/Tunnel/Galadriel/Turf War, Ventifact/Witch's Oven/Mask, Wonderscape unless, Break Out/Rhino/discarded/Clowning/Galvanize/Battle of Wits, Sundering/Agadeem/monarch/Shadowbane/devotion, Consuming/Candles/Grab/Mother Lode/Profane, Adaptive/Ob Nixilis/Brimaz/Raggadragga/Arclight/Spellpyre + Sarulf audit | `oracleIRExecutorConditionalStepSupportBatch375Bulk.ts` |
| **Unless inner** | `that land had a nonbasic land type` (Wonderscape Sage) | `oracleIRExecutorConditionalStepSupport.ts` |
| **Extended** | Wonderscape draw-step parser stub; batch375 wiring | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Audit fixtures** | Full batch375 cluster enrich block | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch375.test.ts` (4) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **206 → 169** (−37); assisted **98.1%** (47069/47969) | `executor-coverage-audit.json` |
| **Gap analysis** | **166** gap items / **169** unique clusters | `executor-fullcard-condition-gap-analysis.json` |

**Next batch 376 targets** (post-375 — run gap analysis for fresh list):
1. `it was historic` (Curator's Ward)
2. `this land isn't a creature` (Great Hall of the Biblioplex)
3. `you spend this mana to cast your commander` (Opal Palace)
4. `no creatures died this turn` (Titan Hunter)
5. `a player controls more Wizards than each other player` (Thoughtbound Primoc)
6. `that mana is spent on a multicolored creature spell` (Guildmages' Forum)
7. `excess damage was dealt to a creature this way` (Vikya)
8. `you sacrificed a Food this turn` (Elanor Gardner)

**Cumulative from post-367 baseline (501): −332 gaps** across batches 368–375 + cleanup.

### Track D — Executor gap closure (batch 374 — 36 clusters mega-batch) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | ~36 handlers + audit fixtures: Unnerving Assault stub, draft/convergence, Deathbringer/Tablet/Invasion/Guildsworn/Satoru/Dega, Fiery Gambit flips, angel/mana riders, Happily Ever After, Kami/Puppeteer/Dart, Historian/Lesson, kicked/shadowborn, quest/Bane/vehicle/Firkraag/heads, land discard/judgment/inferno/luminarch, infect/Hurkyl/wingsmith/sacrifice/exile/delay/milled/human/blocked + more | `oracleIRExecutorConditionalStepSupportBatch374Bulk.ts` |
| **Extended** | Unnerving Assault parser-gap stub; improved `thisWay` exiled-creature + milled-share-type; batch374 wiring | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Audit fixtures** | Full batch374 cluster enrich block (incl. batch373 handlers missing fixtures) | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch374.test.ts` (4) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **263 → 206** (−57); assisted **98.1%** (47037/47969) | `executor-coverage-audit.json` |
| **Gap analysis** | **203** gap items / **206** unique clusters (post-audit; Unnerving compound `{U}/{R}` fix applied after) | `executor-fullcard-condition-gap-analysis.json` |

**Next batch 375 targets** (post-374 gap analysis — run `executor-fullcard-condition-gap-analysis.ts` for fresh list):
1. Remaining count-1 clusters from gap analysis tail (compound/modal/parser gaps)
2. `you both own and control this creature and a creature named Midnight Scavengers` (Graf Rats meld)
3. `its mana cost contains {X}` (First Tyrannic War saga)
4. `any of those creatures have power or toughness equal to the chosen number` (Squall)
5. `this enchantment has ten or more luck counters on it` (Chance Encounter)
6. `you chose a creature other than Galadriel as your Ring-bearer`
7. `that player controls one or more lands with contested counters on them` (Turf War)

**Cumulative from post-367 baseline (501): −295 gaps** across batches 368–374 + cleanup.

### Track D — Batch 373 cleanup (post-mega-batch tighten) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Unless inner routing** | Early `resolveUnlessPayInnerCondition` for parser `kind:'if'` unless inners (`you waterbend {2}`, historic exile, land bounce) | `oracleIRExecutorConditionalStepSupport.ts` |
| **Ref/subject lookup** | Hand/graveyard/exile/library + `lastMovedCards` fallback for `getReferencedObject` / `getConditionalSubjectCard` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Exile priority** | Player-zone `that card` exile before stack spell when chosen hand card bound (Soul Search) | `oracleIRExecutorBattlefieldStepHandlers.ts` |
| **Mana value** | Zone lookup fallback when exiled card lacks inline `cmc` | `oracleIRExecutorConditionalStepSupportBatch372Bulk.ts` |
| **Audit fixtures** | `needsRevealExileChain`; fewer-creatures enrich preserves life totals; unless/discard/move_zone enrich gate | `executor-coverage-audit.ts` |
| **Re-audit** | `unsupported_condition_clause` **271 → 263** (−8); assisted **98.0%** (46986/47969) | `executor-coverage-audit.json` |
| **Gap analysis** | **259** gap items / **264** unique clusters | `executor-fullcard-condition-gap-analysis.json` |

**Closed in cleanup:** Waterbending Lesson, Urza's Tome, Tragic Lesson (unless inners); Guardian Project (name uniqueness); Sold Out / Meticulous Excavation (target ctx); Soul Search (exile + MV); Timely Reinforcements (life comparison).

**Next batch 374 targets** (post-cleanup gap analysis):
1. Unnerving Assault compound `{U}/{R}` (top cluster — parser)
2. Animus of Predation draft clause
3. Deathbringer Regent cast-from-hand + creature count
4. Tablet of the Guilds chosen-colors check
5. Invasion of Fiora combat-damage-since-last-turn
6. Guildsworn Prowler `it wasn't blocking`
7. Satoru `none of them were cast or no mana was spent`
8. Dega Sanctuary black/red permanent composite

**Cumulative from post-367 baseline (501): −238 gaps** across batches 368–373 + cleanup.

### Track D — Executor gap closure (batch 373 — 36 clusters mega-batch) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | ~36 handlers: rampage, Timely Reinforcements, Sokenzan hand leader, dragon mana, exiled-with-it, Gleeful/Fang/Honorable/Slingbow/Anchor/Inferno/Avatar/Journey/Dust Stalker/Relic Runner/Sold Out/Swashbuckler/Teachings/Chirography/Blasphemous/unearth/Wolverine/Prodigy/Phoenix Fleet/Wild Dogs/Sigil Captain + more | `oracleIRExecutorConditionalStepSupportBatch373Bulk.ts` |
| **Audit fix** | Widened condition enrich to `modify_pt`, `draw`, `destroy`, `exile` steps (closes Wolf Strike parser-gap cluster) | `executor-coverage-audit.ts` |
| **Extended** | batch373 wiring | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch373.test.ts` (4) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **306 → 271** (−35); assisted **97.9%** (46978/47969) | `executor-coverage-audit.json` |
| **Gap analysis** | **267** gap items / **272** unique clusters | `executor-fullcard-condition-gap-analysis.json` |

*(Superseded by cleanup re-audit above: 263 / 259 items / 264 clusters.)*

### Track D — Executor gap closure (batch 372 — 36 clusters mega-batch) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | ~45 handlers: enlisted/warp/defending-hand/no-LTB/named-spells/guardian-project/first-strike/revival/delirium/growth/Fang-meld/council-votes/parser full-text stubs, plus clusters 38–49 (arrowhead, Nissa, Ertai, River Song, Cryptolith, Dance with Calamity, Oloro, Portcullis, zombie combat, enchanted, freerunning, Visions) | `oracleIRExecutorConditionalStepSupportBatch372Bulk.ts` |
| **Main** | `you do and your opponent guessed wrong` (Liar's Pendulum composite) | `oracleIRExecutorConditionalStepSupport.ts` |
| **Extended** | `would be destroyed`, `would counter a spell`, `would cause you to draw`; batch372 wiring | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Audit fixtures** | Full batch372 cluster enrich block | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch372.test.ts` (4) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **349 → 306** (−43); assisted **97.9%** (46947/47969) | `executor-coverage-audit.json` |
| **Gap analysis** | **301** gap items / **307** unique clusters | `executor-fullcard-condition-gap-analysis.json` |

### Track D — Executor gap closure (batch 371 — 36 clusters mega-batch) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | ~35 handlers: power thresholds, damage taken, white permanents, opponent ETB, Edgar lookup, land counts, second spell, wolves/werewolves, hand size, anticognition GY, avatar lands, tapped/suspected/warp/madness, sanctuary colors, etc. | `oracleIRExecutorConditionalStepSupportBatch371Bulk.ts` |
| **Main** | `it was attacking` lastMovedCards fallback; didn't enter BF; no indestructible counter; not suspected | `oracleIRExecutorConditionalStepSupport.ts` |
| **Extended** | thisWay: instant/flash exiled, instant/sorcery discarded, {E} paid, nonland return, excess damage; `would lose life`; `this spell's surge cost`; batch371 wiring | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Audit fixtures** | Full batch371 cluster enrich block | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch371.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **389 → 349** (−40); assisted **97.8%** (46912/47969) | `executor-coverage-audit.json` |

**Cumulative from post-367 baseline (501): −195 gaps** across batches 368–372.

### Track D — Executor gap closure (batch 370 — 36 clusters mega-batch) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | ~30 handlers: compound X+destroy, O-Kagachi attack, Tithe lands, tomb dungeon, another-subtype generic, mana-from-creatures, instant/sorcery cast, soul MV, suspected sacrifice, enchanted untapped/red, etc. | `oracleIRExecutorConditionalStepSupportBatch370Bulk.ts` |
| **Main** | `it isn't a token`, `he/she was cast`, `his sneak cost`, parseSmallNumberWord 13–20, blue/black OR guard | `oracleIRExecutorConditionalStepSupport.ts` |
| **Extended** | `would mill` stub; `it's not that player's turn`; batch370 wiring | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Audit fixtures** | Full batch370 cluster enrich block | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch370.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **433 → 389** (−44); assisted **97.7%** (46877/47969) | `executor-coverage-audit.json` |

**Next batch 371 targets** (count-1 clusters from post-370 gap analysis):
1. `it was attacking` (Desculpting Blast — parser/audit alignment)
2. `that creature's power is 4 or greater` (Aradesh follow-on)
3. `a +1/+1 counter was put on a permanent under your control this turn` (Fairgrounds Trumpeter)
4. `you were dealt 4 or more damage this turn` (Boarded Window)
5. `this creature didn't enter the battlefield this turn` (Cactuar)
6. `all nonland permanents you control are white` (Zealots en-Dal)
7. `a creature entered the battlefield under an opponent's control this turn` (Lictor)
8. `an instant card or a card with flash is exiled this way` (Check for Traps)
9. `Edgar is in the command zone or on the battlefield` (Edgar Markov)

(Top cluster remains Unnerving Assault compound `{U}/{R}` — parser batch. Parser gaps: Wolf Strike, Waterbending Lesson, Faerie Fencing full-effect-as-condition.)

### Track D — Executor gap closure (batch 369 — 36 clusters mega-batch) ✅

Parallel sub-agents researched clusters 2–37 (skipped Unnerving Assault compound #1). New bulk module + audit fixtures for batch368 carryover gaps.

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | ~26 new handlers: life thresholds, drizzt/source power, land GY, defending player scans, wall-only blocking, type/color OR clauses, draw count, initiative disjunction, spectacle, mana ability tracker, etc. | `oracleIRExecutorConditionalStepSupportBatch369Bulk.ts` |
| **Extended** | `a creature card is put into a graveyard this way`; batch369 wiring | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Main guards** | splitComposite OR/AND exceptions (green/white, goblin or orc, initiative, wall blocking); initiative disjunction handler | `oracleIRExecutorConditionalStepSupport.ts` |
| **Audit fixtures** | Batch368 carryover + all batch369 clusters | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch369.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **467 → 433** (−34); assisted **97.6%** (46835/47969) | `executor-coverage-audit.json` |

**Next batch 370 targets** (count-1 clusters from post-369 gap analysis):
1. `X is 5 or more, for each artifact destroyed this way` (Red Sun's Twilight — compound AND)
2. `that player attacked you during their last turn` (O-Kagachi)
3. `you win, at the beginning of your next main phase` (Scattering Stroke)
4. `target opponent controls more lands than you` (Tithe)
5. `you haven't completed Tomb of Annihilation` (Acererak)
6. `that library contains exactly the chosen number of cards with the chosen name` (Mindblaze)
7. `it enlisted a creature this combat` (Aradesh)
8. `it isn't a token` (Gruff Triplets)
9. `you control another Spirit` (Apothecary Geist)

(Top cluster remains Unnerving Assault compound `{U}/{R}` — parser batch.)

### Track D — Executor gap closure (batch 368 — 36 clusters mega-batch) ✅

Parallel sub-agents researched 36 count-1 clusters; implementation landed in a dedicated bulk module plus main/extended splitComposite guards.

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | ~30 generic handlers: mana spend `{W}{U}`/`{U}{B}`, Padeem MV tie, mining counters, ETB counts, starting life, sacrifice color, wasn't-subtype, meld, islands, snow, Grim Reminder spell-name (approx), etc. | `oracleIRExecutorConditionalStepSupportBatch368Bulk.ts` |
| **Main guards** | splitCompositeCondition exceptions (god/demigod, Padeem MV, spider-man non-hand, etc.); graveyard count; `no player does`; sacrificed color; wasn't-subtype; snow top-card | `oracleIRExecutorConditionalStepSupport.ts` |
| **Extended wiring** | Early call to `evaluateBatch368BulkConditionalClause` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Regression fix** | Restored accidentally dropped `you do` handler (had caused audit spike to 1433) | Main |
| **Tests** | `oracleIRGapBatch368.test.ts` (7) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **501 → 467** (−34); assisted **97.6%** (46806/47969) | `executor-coverage-audit.json` |

**Still open from batch 368 scope** (audit fixtures or per-opponent wiring):
- Unnerving Assault compound `{U}/{R}` (parser batch — skipped)
- Grim Reminder per-opponent filter (`each opponent who cast…`) — boolean stub only
- A few count-1 clusters still in gap analysis (Assassin attack, legendary sacrifice, nonred damage, etc.) — verify audit fixtures vs handler exact-match

**Next batch 369 targets** (count-1 clusters from post-368 gap analysis):
1. `each opponent who cast a spell this turn with the same name as that card` (Grim Reminder — per-opponent)
2. `they were attacked this turn by an Assassin you controlled` (Ramses)
3. `the sacrificed artifact was legendary` (Splitting the Powerstone)
4. `a nonred permanent is dealt damage this way` (Redcap Melee)
5. `your life total is less than 7` (Elderscale Wurm)
6. `it had power greater than Drizzt's power` (Drizzt Do'Urden)
7. `a land you controlled was put into a graveyard from the battlefield this turn` (The Lady of Otaria)
8. `defending player controls no Walls` (Siege Dragon)
9. `you have exactly 13 life` (Jerren)

(Top cluster remains Unnerving Assault compound `{U}/{R} was spent` — parser/evaluator batch.)

### Track D — Executor gap closure (batch 367 — 9 clusters) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Modified creature** | `it's modified` via counters + equipment + controller-owned auras | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **No subtype** | Generic `you control no {subtype}s` (Stenchskipper / Goblins) | Extended |
| **GY from BF this turn** | `an artifact or creature was put into a graveyard from the battlefield this turn` state flag | Extended + splitCompositeCondition guard |
| **No colored mana** | `no colored mana was spent to cast it` via `manaSpentBreakdown` / `manaColorsSpent` | Extended |
| **She was** | `she was a nonland creature` pronoun + type descriptor | Extended |
| **Mad Dog composite** | `this creature didn't attack or come under your control this turn` + splitCompositeCondition guard | Main |
| **Mutate on cast** | `it has mutate` via stack spell oracle/keywords | Extended |
| **White or blue** | `you control a white or blue permanent` color scan + splitCompositeCondition guard | Extended |
| **Not kicked (creature)** | `this creature wasn't kicked` added to existing negated-kick block | Main |
| **Tests** | `oracleIRGapBatch367.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **514 → 501** (−13); assisted **97.5%** (46774/47969) | `executor-coverage-audit.json` |

**Next batch 368 targets** — ✅ completed in mega-batch 368 (see above).

~~1. `the token is an Aura` (Yenna, Redtooth Regent)~~
2. `{W}{U} was spent to cast this spell` (Mythos of Vadrok)
3. `eight or more cards are in your graveyard` (Sidequest: Card Collection)
4. `you control the artifact with the greatest mana value or tied for the greatest mana value` (Padeem)
5. `there are no mining counters on this land` (Gemstone Mine)
6. `three or more artifacts entered the battlefield under your control this turn` (Malcator)
7. `your life total is less than your starting life total` (Resolute Archangel)
8. `the sacrificed creature was black` (Lyzolda)
9. `it wasn't a Demon` (Infernal Vessel)

(Top cluster remains Unnerving Assault compound `{U}/{R} was spent` — parser/evaluator batch.)

### Track D — Executor gap closure (batch 366) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Its vs self stats** | `its power is greater than this creature's power or its toughness is greater than this creature's toughness` (extends evolve-style handler; entering creature via `targetPermanentId`) | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Dethrone attack target** | `it's attacking the player with the most life or tied for most life` via source `defendingPlayerId` vs max player life | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Unattacked opponent** | `that player has another opponent who isn't being attacked` via `attackingPlayerId` + combat attack map (false in 1v1) | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch366.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **517 → 514** (−3); assisted **97.5%** (46760/47969) | `executor-coverage-audit.json` |

**Next batch 367 targets** (count-1 clusters from post-366 gap analysis):
1. ~~`it's modified`~~ ✅ batch 367
2. ~~`you control no Goblins`~~ ✅ batch 367
3. ~~`an artifact or creature was put into a graveyard from the battlefield this turn`~~ ✅ batch 367
4. ~~`no colored mana was spent to cast it`~~ ✅ batch 367
5. ~~`she was a nonland creature`~~ ✅ batch 367
6. ~~`this creature didn't attack or come under your control this turn`~~ ✅ batch 367
7. ~~`it has mutate`~~ ✅ batch 367
8. ~~`you control a white or blue permanent`~~ ✅ batch 367
9. ~~`this creature wasn't kicked`~~ ✅ batch 367

(Top cluster remains Unnerving Assault compound `{U}/{R} was spent` — parser/evaluator batch.)

### Track D — Executor gap closure (batch 365) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Life paid activate** | `life was paid to activate it` via ctx flag + stack `Pay N life:` cost parse (null for `or` / `may pay` costs) | `oracleIRExecutorConditionalStepSupport.ts` |
| **Named workers** | Generic `you control creatures named X and Y` on controlled creature names | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Graveyard entry** | `they entered or were cast from a graveyard` via `thoseCreatureIds` + `enteredFromZone`; **splitCompositeCondition** exception so ` or ` does not decompose the clause | `oracleIRExecutorConditionalStepSupport.ts` |
| **Tests** | `oracleIRGapBatch365.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **521 → 517** (−4); assisted **97.5%** (46758/47969) | `executor-coverage-audit.json` |

**Next batch 366 targets** (count-1 clusters from post-365 gap analysis):
1. ~~`its power is greater than this creature's power or its toughness is greater than this creature's toughness`~~ ✅ batch 366
2. ~~`it's attacking the player with the most life or tied for most life`~~ ✅ batch 366
3. ~~`that player has another opponent who isn't being attacked`~~ ✅ batch 366

(Top cluster remains Unnerving Assault compound `{U}/{R} was spent` — parser/evaluator batch.)

### Track D — Executor gap closure (batch 364) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Warrior damage source** | `any of that damage was dealt by a Warrior` via `damageIncludedWarriorSource` + source id/type lookup | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Permanent entered** | `this permanent entered this turn` via source `enteredThisTurn` (mirrors creature variant) | `oracleIRExecutorConditionalStepSupport.ts` |
| **Another +1/+1 counter** | `you control another creature with a +1/+1 counter on it` excludes source, checks counters | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch364.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **524 → 521** (−3); assisted **97.5%** (46754/47969) | `executor-coverage-audit.json` |

**Next batch 365 targets** (count-1 clusters from post-364 gap analysis):
1. ~~`life was paid to activate it`~~ ✅ batch 365
2. ~~`you control creatures named Mine Worker and Tower Worker`~~ ✅ batch 365
3. ~~`they entered or were cast from a graveyard`~~ ✅ batch 365

(Top cluster remains Unnerving Assault compound `{U}/{R} was spent` — parser/evaluator batch.)

### Track D — Executor gap closure (batch 363) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Prevented creature source** | `damage from a creature source is prevented this way` via ctx flags + prevent_damage antecedent + source type | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Prevented noncreature source** | `damage from a noncreature source is prevented this way` (exact-match; avoids `noncreature` ⊃ `creature` substring bug) | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Kicked twice** | `it was kicked twice` via `resolveKickedTwiceStatus` (count ≥2 / `wasKickedTwice`; replay-safe null) | `oracleIRExecutorConditionalStepSupport.ts` |
| **Tests** | `oracleIRGapBatch363.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **527 → 524** (−3); assisted **97.5%** (46751/47969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batch 362) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Thopter-only self** | Generic `you control no {subtype}s other than this creature` (excludes source) | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Opponent discard** | `an opponent discarded a card this turn` via `discardedCardThisTurn` map | `oracleIRExecutorConditionalStepSupport.ts` |
| **Two players lost** | `two or more players have lost the game` via `playersLostCount` / `hasLost` / `inactive` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch362.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **530 → 527** (−3); assisted **97.5%** (46749/47969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batch 361) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Treasure activate** | `mana from a Treasure was spent to activate this ability` via stack provenance + `treasureManaSpentToActivateThisTurn` + ctx | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Most lands (each other)** | `that player controls more lands than each other player` via per-player land counts vs `that player` | `oracleIRExecutorConditionalStepSupport.ts` |
| **Tests** | `oracleIRGapBatch361.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **534 → 530** (−4); assisted **97.5%** (46746/47969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batch 360) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Exiled with source** | `a card is exiled with it` via `countExiledCardsWithSource`, permanent exile arrays, `linkedExiles` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Single target** | `it has a single target` via stack `targets` / `targetId` count | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Sacrificed subtype** | Generic `the sacrificed creature was a {subtype}` (replaces hamster-only) | `oracleIRExecutorConditionalStepSupport.ts` |
| **Nonbasic land** | `that land was nonbasic` on referenced/moved land type-line | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch360.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **542 → 534** (−8); assisted **97.4%** (46741/47969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batch 359) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Excess damage this turn** | `that creature was dealt excess damage this turn` via `excessDamageThisTurnByCreatureId` / permanent flags | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Renowned (positive)** | `it's renowned` / `this creature is renowned` on source `renowned` flag | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Another high-power creature** | Generic `you control another creature with power N or greater` excluding `sourceId` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Treasure cast this spell** | Extended `mana from a Treasure was spent to cast this spell` via stack + `treasureManaSpentToCastThisTurn` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch359.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **551 → 542** (−9); assisted **97.4%** (46734/47969) | `executor-coverage-audit.json` |

**Next batch 360 targets** (count-2 clusters from post-359 gap analysis):
1. `a card is exiled with it`
2. `it has a single target`
3. `the sacrificed creature was a Human`
4. `that land was nonbasic`

### Track D — Executor gap closure (batch 358) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Cast both types** | `you've cast both a creature spell and a noncreature spell this turn` via spell log + count maps | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Enchanted power threshold** | Generic `enchanted creature's power is N or greater` via aura `attachedTo` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Underpay cast** | `the amount of mana spent to cast it was less than its mana value` via `getCastManaSpendSource` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Creature damage this way** | `a creature is dealt damage this way` antecedent + `lastDamagedCards` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch358.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **559 → 551** (−8); assisted **97.4%** (46725/47969) | `executor-coverage-audit.json` |

**Next batch 359 targets** (count-2 clusters from post-358 gap analysis):
1. `that creature was dealt excess damage this turn`
2. `it's renowned`
3. `you control another creature with power 4 or greater`
4. `mana from a Treasure was spent to cast this spell`

### Track D — Executor gap closure (batch 357) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Same name as permanent** | `it has the same name as a permanent` compares referenced/moved card name to battlefield | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Clues sacrificed** | Generic `you sacrificed N or more Clues this turn` via `cluesSacrificedThisTurn` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Prowl paid** | `its prowl cost was paid` / `this spell's prowl cost was paid` (mirror surge) | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Lesson in graveyard** | `there's a Lesson card in your graveyard` type-line scan | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch357.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **569 → 559** (−10); assisted **97.4%** (46717/47969) | `executor-coverage-audit.json` |

**Next batch 358 targets** (count-2 clusters from post-357 gap analysis):
1. `you've cast both a creature spell and a noncreature spell this turn`
2. `enchanted creature's power is 4 or greater`
3. `the amount of mana spent to cast it was less than its mana value`
4. `a creature is dealt damage this way`

### Track D — Executor gap closure (batch 356) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Same-color mana spent** | Generic `(\{[wubrgcs]\})+ was spent to cast it` via `getCastManaSpendSource` + `getAmountOfSpecificManaSymbolSpent` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Type ETB this turn** | Extended `a/an/another {type} entered the battlefield under your control this turn` + per-type turn counters | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Target has toxic** | `that creature has toxic` keyword check on target permanent | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Another creature ETB** | `another` article excludes `sourceId` from entered-this-turn count | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch356.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **592 → 569** (−23); assisted **97.4%** (46708/47969) | `executor-coverage-audit.json` |

**Next batch 357 targets** (count-2 clusters from post-356 gap analysis):
1. `it has the same name as a permanent`
2. `you sacrificed three or more Clues this turn`
3. `its prowl cost was paid`
4. `there's a Lesson card in your graveyard`

### Track D — Executor gap closure (batch 355) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **That-player land/creature lead** | Generic `that player controls more {creatures\|lands} than you` via `targetPlayerId` + battlefield counts | `oracleIRExecutorConditionalStepSupport.ts` |
| **Low hand threshold** | Generic `you have fewer than N cards in hand` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Surge paid** | `its surge cost was paid` on source/stack spell (`alternateCostId`, `surgeCostWasPaid`) | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Counter placed this turn** | `you put a counter on a creature this turn` via `putCounterOnCreatureThisTurn[controllerId]` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch355.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **603 → 592** (−11); assisted **97.3%** (46685/47969) | `executor-coverage-audit.json` |

**Next batch 356 targets** (count-2 clusters from post-355 gap analysis):
1. `{R}{R} was spent to cast it` / `{G}{G} was spent to cast it` (color-mana-spent-on-cast family)
2. `an artifact entered the battlefield under your control this turn`
3. `that creature has toxic`
4. `another creature entered the battlefield under your control this turn`

### Track D — Executor gap closure (batch 354) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **No attack global** | `no creatures attacked this turn` via `creaturesAttackedThisTurn` / battlefield scan | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **No damage yet** | `it hasn't dealt damage yet` on source permanent | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Second land** | `that player had another land enter… this turn` via `landsEnteredBattlefieldThisTurn` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Opponent damage** | `this creature dealt damage to an opponent this turn` via `creaturesThatDealtDamageToPlayer` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch354.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **611 → 603** (−8); assisted **97.3%** (46674/47969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batch 348) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Specific kicker cost** | `(it\|this spell\|this creature) was kicked with its … kicker` via `resolveKickedStatus` | `oracleIRExecutorConditionalStepSupport.ts` |
| **Creature subtype** | Generic `this creature is a {subtype}` type-line check | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **GY entry antecedent** | `one or more of them entered from a graveyard or was cast from a graveyard` | `oracleIRExecutorConditionalStepSupport.ts` |
| **Life vs starting** | Generic `you have at least N life more than your starting life total` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch348.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **680 → 653** (−27); assisted **97.2%** (46624/47969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batch 347) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Dragon beheld** | Generic `a {quality} was beheld` via `beheldQuality` ctx | `oracleIRExecutionTypes.ts`, `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **No artifacts** | `you control no artifacts` via `countControlledMatchingDescriptor` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **No battlefield creatures** | Global `no creatures are on the battlefield` scan | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Not a token** | `it's not a token` on referenced permanent | `oracleIRExecutorConditionalStepSupport.ts` |
| **Tests** | `oracleIRGapBatch347.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **692 → 680** (−12); assisted **97.1%** (46599/47969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batch 346) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Opponent life lead** | `an opponent has more life than you` existence check | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Empty target hand** | `that player has no cards in hand` via `targetPlayerId` | `oracleIRExecutorConditionalStepSupport.ts` |
| **No attack this turn** | `this creature didn't attack this turn` on source permanent | `oracleIRExecutorConditionalStepSupport.ts` |
| **Team another subtype** | Generic `your team controls another {subtype}` + `getTeamPlayerIds` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch346.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **704 → 692** (−12); assisted **97.1%** (46588/47969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batch 345) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Non-hand cast** | `this spell was cast from anywhere other than your hand` via `castFromZone !== 'hand'` | `oracleIRExecutorConditionalStepSupport.ts` |
| **Zero mana cast** | `noManaSpentToCast` ctx + `no mana was spent to cast it` evaluator | `oracleIRExecutionTypes.ts`, `oracleIRExecutorConditionalStepSupport.ts` |
| **Would lose game** | `would lose the game` in would-clause + explicit `wouldLoseTheGame` ctx | `oracleIRExecutorConditionalStepSupportExtended.ts`, `oracleIRExecutorConditionalStepSupport.ts` |
| **No untapped lands** | Controller land tap scan | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch345.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **717 → 704** (−13); assisted **97.1%** (46576/47969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batch 344) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Creature-mana spend** | `manaSpentOnCreatureSpell` ctx + `that mana is spent on a creature spell` evaluator | `oracleIRExecutionTypes.ts`, `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Seven+ cards in hand** | Generic `you have N or more cards in hand` threshold matcher | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Life lead vs opponent** | `you have more life than an opponent` existence check | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **No monarch** | `there is no monarch` negates `state.monarch` | `oracleIRExecutorConditionalStepSupport.ts` |
| **Tests** | `oracleIRGapBatch344.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **730 → 717** (−13); assisted **97.1%** (46566/47969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batch 343) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Creature cast this way** | `creatureSpellCastThisWay` ctx + `you cast a creature spell this way` evaluator | `oracleIRExecutionTypes.ts`, `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Untapped source** | `this creature is untapped` / `this permanent is untapped` (generalized from artifact) | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Hand lead vs each opponent** | `youHaveMoreCardsInHandThanEachOpponent` | `oracleIRExecutorConditionalStepSupport.ts` |
| **Had counters** | `it had one or more counters on it` on referenced permanent | `oracleIRExecutorConditionalStepSupport.ts` |
| **Tests** | `oracleIRGapBatch343.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **742 → 730** (−12); assisted **97.0%** (46553/47969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batch 342) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Withdraw** | `another target X` bounce + `parseMoveZoneUnlessPaysManaFromStepText` skip when paid | `oracleIRExecutorZoneOps.ts`, `oracleIRExecutorMoveZoneStepHandlers.ts` |
| **Hibernation** | `parseMoveZoneAllColoredPermanentsToHand`; basic land subtype color inference in `collectCardColors` | `oracleIRExecutorZoneOps.ts`, `oracleIRExecutorMoveZoneStepHandlers.ts` |
| **Dakra Mystic** | `parsedTheRevealedCards` graveyard destination | `oracleIRExecutorMoveZoneStepHandlers.ts` |
| **Tests** | `oracleIRGapBatch306.test.ts` (7) | rules-engine |
| **Re-audit** | `unsupported_selector` **113 → 110** (−3); assisted **96.7%** (46,402/47,969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batch 305) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Storm the Festival** | `up to two permanent cards with mana value N or less from among them` → `bfLibraryBottomSplit` | `oracleIRExecutorZoneOps.ts` |
| **Mind Roots** | `parseMoveZoneAllCardsDiscardedThisWay` + BF tapped handler; audit GY fixtures | `oracleIRExecutorZoneOps.ts`, `oracleIRExecutorMoveZoneStepHandlers.ts`, `executor-coverage-audit.ts` |
| **Teferi, Temporal Pilgrim** | `parseMoveZoneOpponentChoicePermanentToHand` + opponent BF bounce | `oracleIRExecutorZoneOps.ts`, `oracleIRExecutorMoveZoneStepHandlers.ts` |
| **Tests** | `oracleIRGapBatch305.test.ts` (6) | rules-engine |
| **Re-audit** | `unsupported_selector` **116 → 113** (−3); assisted **96.7%** (46,398/47,969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batches 300–304) ✅

| Metric | Value |
|--------|-------|
| `unsupported_selector` | **135 → 110** (−25 across batches 300–306) |
| `unsupported_condition_clause` | **785** (unchanged) |
| `ir_gap` | **132** |
| Assisted (`full_card`) | **96.7%** (46,402 / 47,969) |
| Parse→execute gaps | **1,435** items on **1,390** cards |

Latest batch files: `oracleIRGapBatch300.test.ts` … `oracleIRGapBatch306.test.ts`. All uncommitted.

### Track D — Executor gap closure (batch 281–282) ✅ partial

| Item | Change | Key files |
|------|--------|-----------|
| **Full-card condition cluster script** | `executor-fullcard-condition-gap-analysis.ts` | server/scripts |
| **Full-card selector cluster script** | `executor-fullcard-selector-gap-analysis.ts` (top: `move_zone` partial GY/library split, 59) | server/scripts |
| **Condition evaluators (281–282)** | Werewolf/day-night, cast/descend/tribute, adaptive P/T, depletion/ki/legendary/vote riders, `it was a creature`, hand-size/activate-count/suspended | `oracleIRExecutorConditionalStepSupportExtended.ts`, `oracleIRExecutorConditionalStepSupport.ts` |
| **Audit fixture** | `spellsCastLastTurn*`, vote results, ki counters, second legendary, activate/GY-turn flags | `executor-coverage-audit.ts` |
| **Re-audit** | `unsupported_condition_clause` **1139 → 787**, assisted **96.3%**, parse→execute gaps **1982 → 1637** | `executor-coverage-audit.json` |
| **Tests** | `oracleIRGapBatch281.test.ts` (3), `oracleIRGapBatch282.test.ts` (2) | rules-engine |

Trigger-effect scope condition/selector gaps remain **0**.

### Track C — Deck edit verified ✅ (prior turn)

Deck edit was already implemented in `DeckManagerModal.tsx` (local `beginEditLocal`/`saveLocal`, server `beginEditServer`/`updateServerDeck` via socket + REST). Added socket integration coverage:

| Item | Change | Key files |
|------|--------|-----------|
| **updateSavedDeck** | Happy-path + not-in-room auth tests | `saved-decks.update.integration.test.ts` |

### Full-card executor gap batch ✅

| Item | Change | Key files |
|------|--------|-----------|
| **ETB tapped audit noise** | Skip benign replacement metadata (`tapped`, `tapped unless …`); dry-run full-card abilities using parsed `ability.steps` | `executor-coverage-audit.ts` |
| **Devoid parser** | Bare `Devoid` → `grant_static_ability` keyword grant | `oracleIRParserPostprocess.ts` |
| **Conditional executor crash** | `cardsMatchDescriptor` accepts single card objects (audit dry-run no longer throws) | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Re-audit** | `full_card` scope: **ir_gap 778 → 132**, assisted **95.6%** (45,856/47,970); flashback reminder lines now `fully_applied` | `server/scripts/out/executor-coverage-audit.json` |

### Tracks A + B complete — damage follow-up + G1 socket tests (prior turn)

| Item | Change | Key files |
|------|--------|-----------|
| **Client poison UI contract** | `getDisplayedPoisonCount` mirrors `TableLayout` / `App.tsx` `poisonCounters` lookup | `client/tests/poisonCounterDisplay.test.ts` |
| **First/double strike infect** | First-strike and double-strike infect poison sequencing unit tests | `combat.infect-wither.test.ts` |
| **Thassa ETB socket** | Effect-program may-choice → devotion library look; `look_select_top` → `LIBRARY_SEARCH` socket resume | `thassa-oracle-etb.socket.integration.test.ts` |
| **Roaming Throne + Kumena** | Kumena +1/+1 targets throne with chosen Merfolk via socket activation | `roaming-throne-kumena-tribal.socket.integration.test.ts` |
| **Executor gap audit** | Reviewed `server/scripts/out/executor-coverage-audit.json` (`full_card`, 2026-06-13): **833** parse→execute gaps (**778** `ir_gap`, **211** unsupported) | no code change |

### Batch 280 follow-up — Rot Wolf socket E2E + damage call-site audit

| Item | Change | Key files |
|------|--------|-----------|
| **Rot Wolf socket E2E** | `declareAttackers` socket → combat damage → `viewFor.poisonCounters` (2 poison, no life loss) | `combat.infect-wither.socket.integration.test.ts` |
| **Unit test view sync** | Rot Wolf unit test asserts `viewFor.poisonCounters` matches `state.poisonCounters` | `combat.infect-wither.test.ts` |
| **X-cost AoE damage** | Crypt Rats-style `{X}: … each creature and each player` uses `applyCreatureDamageFromSource` + `resolvePlayerDamage` | `x-activated-abilities.ts` |
| **Nibelheim Aflame sweep** | Sweep damage from targeted creature uses source-aware bridge | `stackResolveSpellSpecialCaseUtils.ts` |

### Batch 280 — Server damage processing (infect / wither / poisonous)

**Root cause:** Live combat used bespoke `dealCombatDamage` in `turn.ts` (life loss + marked damage) instead of `rules-engine/src/damageProcessing.ts`. Rot Wolf and similar cards had no effect on poison or -1/-1 counters.

**Fix:** New shared bridge `server/src/state/modules/combat-damage-processing.ts` wired into combat, fight, legacy spell damage, `dealDamage` events, damage-received triggers, proliferate+SBA.

| Area | Change | Key files |
|------|--------|-----------|
| **Combat damage** | Infect → poison; poisonous/toxic on combat; infect/wither → -1/-1 on creatures | `turn.ts`, `combat-damage-processing.ts` |
| **Fight** | Mutual damage respects infect/wither on both creatures | `applyEvent.ts`, `stackResolveAbilityMidHandlersUtils.ts`, `planeswalker/templates/resolve.ts` |
| **Spell / ability damage** | `DamagePlayer` / `DamagePermanent` use shared bridge | `executeSpellEffect.ts`, `applyEvent.ts` |
| **`dealDamage` events** | Auto-detect infect/wither from `sourcePermanentId`; player targets | `applyEvent.ts`, `replay.ts` |
| **Damage-received** | Boros Reckoner-style reflect uses source keywords | `triggers/damage-received.ts` |
| **Proliferate** | `updateCounters` + **`runSBA`** after proliferate (delayed dies triggers) | `applyEvent.ts` |
| **Poison defeat** | `syncLifeAndCheckDefeat` checks 10+ poison | `turn.ts` |
| **Tests** | 6 cases including Rot Wolf, fight, auto-detect, proliferate→Blood Artist | `server/tests/combat.infect-wither.test.ts` |

**Detailed reference:** [server-damage-processing-migration.md](./server-damage-processing-migration.md)

### Batch 279 — G1 Merfolk commander live-play fixes (prior session, still uncommitted)

| Issue | Fix | Key files |
|-------|-----|-----------|
| **Roaming Throne chosen type** | Throne counts as chosen subtype for tribal effects | `shared/src/creatureTypes.ts`, `creatureTypeNow.ts` |
| **Tap triggers** | `queueTapTriggersForTappedPermanents` after tap costs | `tap-trigger-queue.ts`, `resolution.ts` |
| **Thassa's Oracle ETB** | `look_select_top` + `LIBRARY_SEARCH` queue | `oracleIRParserPostprocess.ts`, `oracleIrServerZoneSync.ts` |
| **Kynaios / lookup / copy** | Land ETB prompts; art_series filter; Cryptoplasm revert | `kynaiosChoice.ts`, `localCardLookup.ts`, `permanent-copy.ts` |
| **Sacrifice under summoning sickness** | `hasSacrificePrefixActivatedAbility` in `canAct` | `can-respond.ts`, `socket/util.ts` |
| **Rampant Growth import** | Standalone sorcery beats fuse face alias | `localCardLookup.ts` (`schemaVersion` 3) |
| **Sakura-Tribe Elder false ETB** | Removed bespoke table row; sacrifice guard | `card-data-tables.ts`, `triggered-abilities.ts` |

### Carried over from prior sessions (still uncommitted)

- Batches 264–278 (trigger `ir_gap` closure, step ledger Phases A–Z)
- Goad/Baeloth parallel track (`docs/GOAD_IMPLEMENTATION.md`)
- Client: import warning contrast, deck editing (local + server)

**Nothing committed** unless explicitly requested.

## Key files touched (batch 280)

| Area | Paths |
|------|-------|
| Damage bridge | `server/src/state/modules/combat-damage-processing.ts` |
| Combat | `server/src/state/modules/turn.ts` |
| Events / replay | `server/src/state/modules/applyEvent.ts`, `replay.ts` |
| Spells | `server/src/state/modules/executeSpellEffect.ts` |
| Fight / reflect | `stackResolveAbilityMidHandlersUtils.ts`, `triggers/damage-received.ts`, `planeswalker/templates/resolve.ts` |
| Tests | `server/tests/combat.infect-wither.test.ts` |
| Docs | `docs/server-damage-processing-migration.md` |

## Validation commands

```powershell
# Batch 280 — infect/wither/poisonous
cd D:\Git\MTGEDH\server
npx vitest run tests/combat.infect-wither.test.ts tests/combat.infect-wither.socket.integration.test.ts tests/engine.damage.test.ts

# Batch 279 + G1 socket follow-ups
npx vitest run tests/thassa-oracle-etb.socket.integration.test.ts tests/roaming-throne-kumena-tribal.socket.integration.test.ts

# Client poison display contract
cd D:\Git\MTGEDH\client
npx vitest run tests/poisonCounterDisplay.test.ts

# Batch 279 — G1 fixes
npx vitest run tests/roaming-throne-chosen-type.unit.test.ts tests/g1-card-fixes.unit.test.ts tests/sakura-tribe-etb.regression.test.ts tests/deck-import.local-index.test.ts tests/can-respond.test.ts

# Migration gate + latest gap batch
npm run test:oracle-ir-migration
cd D:\Git\MTGEDH\rules-engine
npx vitest run test/oracleIRGapBatch306.test.ts

# Re-audit after gap batch work
cd D:\Git\MTGEDH\server
$env:EXECUTOR_COVERAGE_SCOPE='full_card'; npm run executor:coverage
npx tsx scripts/executor-fullcard-selector-gap-analysis.ts
```

Expected: `combat.infect-wither.test.ts` **8/8**; `combat.infect-wither.socket.integration.test.ts` **1/1**; `thassa-oracle-etb.socket.integration.test.ts` **2/2**; `roaming-throne-kumena-tribal.socket.integration.test.ts` **1/1**; `poisonCounterDisplay.test.ts` **3/3**; migration suite **704/704**.

## Open / not verified in live play

| Item | Notes |
|------|-------|
| Rot Wolf poison in **client UI** | Display contract tested; manual prod UI spot-check optional |
| Eldrazi Monument indestructible cleanup | Batch 279 dedupe; retest live |
| `dealCombatDamage` → rules-engine delegation | Optional long-term refactor (deferred) |
| Executor `ir_gap` clusters | **132** `ir_gap`; **653** `unsupported_condition_clause`; **0** `unsupported_selector`; parse→execute gaps **1,213** (`full_card`, post batch 348) |

## Next session priorities

Pick one track:

### Track A — Damage processing follow-up ✅
1. ~~Socket E2E: Rot Wolf → poison counters visible in client~~ ✅
2. ~~Audit `applyDamageToPermanentWithCounterEffects` without source~~ ✅
3. ~~Client poison display contract~~ ✅ (`poisonCounterDisplay.test.ts`)
4. ~~First/double strike infect sequencing~~ ✅ (unit tests)
5. Deferred: delegate `dealCombatDamage` to rules-engine `executeCombatDamage`

### Track B — Oracle IR / G1 resume ✅
1. ~~Thassa socket integration test~~ ✅ (`thassa-oracle-etb.socket.integration.test.ts`)
2. ~~Roaming Throne + Kumena socket tribal test~~ ✅ (`roaming-throne-kumena-tribal.socket.integration.test.ts`)
3. ~~Executor gap audit (`full_card`)~~ ✅ reviewed `executor-coverage-audit.json` (833 parse→execute gaps)

### Track C — Client / deck ✅
1. ~~Deck edit flows in standalone builder~~ ✅ (already implemented; `saved-decks.update.integration.test.ts` added)
2. Import warning banner (done); verify contrast in prod build

### Track D — Executor gap closure (next)
1. **`unsupported_selector` (0)** — cleared batch 339 ✅
2. **`unsupported_condition_clause` (603)** — see `executor-fullcard-condition-gap-analysis.json` (batch 355 targets below)
3. Shock/check land ETB choice prompts in live play

**Batch 355 probe clusters** (post-354 condition gap analysis):
- **That player controls more lands than you** — Keeper of the Accord / Archaeomancer's Map
- **You have fewer than seven cards in hand** — Kozilek, the Great Distortion / Damia, Sage of Stone
- **Its surge cost was paid** — Reckless Bushwhacker / Tyrant of Valakut
- **You put a counter on a creature this turn** — Lord Jyscal Guado / Lasting Tarfire

#### Batch 354 (no attack / no damage yet / second land / opponent damage)
- Evaluators: `no creatures attacked this turn` via `creaturesAttackedThisTurn` + battlefield scan; `it hasn't dealt damage yet` on source; `that player had another land enter…` via `landsEnteredBattlefieldThisTurn`; `this creature dealt damage to an opponent this turn` via `creaturesThatDealtDamageToPlayer`
- Audit enrich: empty attack tracking; `hasDealtDamage: false`; `landsEnteredBattlefieldThisTurn.p2: 2`; damage tracker on source
- Tests: `rules-engine/test/oracleIRGapBatch354.test.ts`
- Audit: `unsupported_condition_clause` **611 → 603** (−8); assisted **97.3%** (46674/47969); Cinderhorn/Keldon, Karakyk/Palladia, Tunnel/Conundrum, Dervish/Outlaw clusters cleared

**Batch 354 probe clusters** (post-353 condition gap analysis — cleared):
- **No creatures attacked this turn** — Charging Cinderhorn / Keldon Twilight
- **It hasn't dealt damage yet** — Karakyk Guardian / Palladia-Mors, the Ruiner
- **That player had another land enter the battlefield under their control this turn** — Tunnel Ignus / Confounding Conundrum
- **This creature dealt damage to an opponent this turn** — Whirling Dervish / Dunerider Outlaw

#### Batch 353 (life loss threshold / enchant+equip / exiled type match / no tapped lands)
- Evaluators: generic `a player lost N or more life this turn`; `it was enchanted or equipped` on antecedent; `it shares a card type with the exiled card` via `findExiledCardWithSource` + `cardsShareCardType`; `you control no tapped lands` (inverse of no untapped lands)
- Audit enrich: `lifeLostThisTurn.p2: 5`; died creature `wasEnchanted`/`attachedEquipment`; exiled card + matching stack spell; untapped land only
- Tests: `rules-engine/test/oracleIRGapBatch353.test.ts`
- Audit: `unsupported_condition_clause` **619 → 611** (−8); assisted **97.3%** (46666/47969); Y'shtola/Knight, Koll/Cass, Cemetery cards, Nantuko/Martyr clusters cleared

**Batch 353 probe clusters** (post-352 condition gap analysis — cleared):
- **A player lost 4 or more life this turn** — Y'shtola, Night's Blessed / Knight of the Ebon Legion
- **It was enchanted or equipped** — Koll, the Forgemaster / Cass, Hand of Vengeance
- **It shares a card type with the exiled card** — Cemetery Protector / Cemetery Gatekeeper
- **You control no tapped lands** — Nantuko Shaman / Martyr's Soul

#### Batch 352 (no attack / damage threshold / no creatures / attack group)
- Evaluators: `you didn't attack with a creature this turn` → `!controllerAttackedThisTurn`; generic `N or more damage was dealt to it this turn`; `you control no creatures`; `N or more of those creatures are attacking you and/or planeswalkers you control` via `thoseCreatureIds` + attack targets
- Audit enrich: clear p1 attackers; died creature `damageThisTurn: 4`; strip p1 creatures; attack group fixtures with PW + two attackers targeting you/PW
- Tests: `rules-engine/test/oracleIRGapBatch352.test.ts`
- Audit: `unsupported_condition_clause` **627 → 619** (−8); assisted **97.3%** (46658/47969); Curious Obsession/See Red, Zubera, Promise/Thran Quarry, Tomik/Mangara clusters cleared

**Batch 352 probe clusters** (post-351 condition gap analysis — cleared):
- **You didn't attack with a creature this turn** — Curious Obsession / See Red
- **4 or more damage was dealt to it this turn** — Burning-Eye Zubera / Rushing-Tide Zubera
- **You control no creatures** — Promise of Tomorrow / Thran Quarry
- **Two or more of those creatures are attacking you and/or planeswalkers you control** — Tomik, Wielder of Law / Mangara, the Diplomat

#### Batch 351 (counters on permanent / non-attacker tap / exile cast / command zone presence)
- Evaluators: `this permanent has counters on it` on source; `it isn't being declared as an attacker` via `attackersDeclaredThisCombatByPlayer`; `this spell was cast from exile` via `castFromZone`; `this permanent is in the command zone or on the battlefield` via battlefield + `collectCommandZoneObjects`
- Audit enrich: `bf-source` counters; opponent tapped creature + empty attacker list; `castFromZone: exile`; command zone metadata for `bf-source`
- Tests: `rules-engine/test/oracleIRGapBatch351.test.ts`
- Audit: `unsupported_condition_clause` **635 → 627** (−8); assisted **97.3%** (46650/47969); Denry Klin/Ozolith, Verity Circle/Rhoda, Delayed Blast Fireball/Holy, Inalla/Arahbo clusters cleared

**Batch 351 probe clusters** (post-350 condition gap analysis — cleared):
- **This permanent has counters on it** — The Ozolith / Denry Klin, Editor in Chief
- **It isn't being declared as an attacker** — Verity Circle / Rhoda, Geist Avenger
- **This spell was cast from exile** — Ultimate Magic: Holy / Delayed Blast Fireball
- **This permanent is in the command zone or on the battlefield** — Inalla, Archmage Ritualist / Arahbo, Roar of the World

#### Batch 350 (minus counter / life lost last turn / not your turn / equipped)
- Evaluators: `it had a -1/-1 counter on it` via antecedent cards + `getCounterCountOnObject`; `you lost life last turn` → `lifeLostLastTurn*` maps; `it's not your turn` via `activePlayerIndex`; `it's equipped` via `isEquipped` / `attachedEquipment`
- Audit enrich: died creature `-1/-1` in `lastMovedCards`; `lifeLostLastTurnByPlayerCounts.p1`; `activePlayerIndex: 1`; `isEquipped` on source/target permanents
- Tests: `rules-engine/test/oracleIRGapBatch350.test.ts`
- Audit: `unsupported_condition_clause` **643 → 635** (−8); assisted **97.2%** (46642/47969); Retched Wretch, First Response, Zealous Display, Tetsuo/Awaken clusters cleared

**Batch 350 probe clusters** (post-349 condition gap analysis — cleared):
- **It had a -1/-1 counter on it** — Retched Wretch / Blowfly Infestation
- **You lost life last turn** — First Response / Paladin of Atonement
- **It's not your turn** — Zealous Display / Lighthouse Chronologist
- **It's equipped** — Tetsuo, Imperial Champion / Awaken the Sleeper

#### Batch 349 (kicked spell / human subtype / uncast / planeswalker ETB this turn)
- Evaluators: `that spell was kicked` (stack spell via `resolveKickedStatus`); generic `it was a {subtype}`; `it wasn't cast` / `it was not cast`; `a {type} entered the battlefield under your control this turn` → `{type}EnteredThisTurn[controllerId]`
- Audit enrich: stack spell `wasKicked`; human `lastMovedCards` fixture; `wasCast: false` + `enteredFromZone: library`; `planeswalkerEnteredThisTurn.p1`
- Tests: `rules-engine/test/oracleIRGapBatch349.test.ts`
- Audit: `unsupported_condition_clause` **653 → 643** (−10); assisted **97.2%** (46634/47969); Hallar, Slayer's Plate, Rapid Augmenter, Oath of Liliana/Chandra clusters cleared

**Batch 349 probe clusters** (post-348 condition gap analysis — cleared):
- **That spell was kicked** — Hallar, the Firefletcher / Bloodstone Goblin
- **It was a Human** — Slayer's Plate / Avacyn's Collar
- **It wasn't cast** — Rapid Augmenter / Preston, the Vanisher
- **A planeswalker entered the battlefield under your control this turn** — Oath of Liliana / Oath of Chandra

#### Batch 283 (surveil reminder selector cluster)
- Parser: merge `look_top` + `move_zone` (GY + rest on top) → `look_select_top`; prune redundant reminder steps when ability has `surveil`
- Tests: `rules-engine/test/oracleIRGapBatch283.test.ts`
- Audit: `unsupported_selector` **318 → 259**; surveil disposal cluster **59 → 0**

#### Batch 284 (manifest dread selector cluster)
- Parser: upgrade `grant_static_ability` manifest dread → `manifest_dread`; prune reminder `look_top`/`move_zone` tail; early-parse `manifest dread twice`
- Tests: `rules-engine/test/oracleIRGapBatch284.test.ts`
- Audit: `unsupported_selector` **259 → 255**; manifest face-down split cluster **3 → 0**

#### Batch 285 (return X from graveyard + Living End)
- Executor: `parseMoveZoneUpToTargetCountFromYourGraveyard` matches `x target … from your graveyard`; `parseMoveZoneAllCardsTheyExiledThisWay` + antecedent `lastMovedCards` carry-over from each-player GY exile
- Tests: `rules-engine/test/oracleIRGapBatch285.test.ts`
- Audit: `unsupported_selector` **255 → 239**; return-X creature GY clusters **6 → 0**, Living End chain **3 → 0**

#### Batch 286 (Island bounce + artifact/enchantment GY + X-target bounce)
- Battlefield parser: basic land subtype selectors (`Islands you control` → `typeLineTermsAnyOf: ['island']`)
- Executor: `parseMoveZoneAllFromYourGraveyard` handles `all artifact and enchantment cards`; `parseMoveZoneCountTargetBattlefieldBounce` matches bare `X target creatures`
- Tests: `rules-engine/test/oracleIRGapBatch286.test.ts`
- Audit: `unsupported_selector` **239 → 227** (−12); Gush/Ensnare Island bounce, Brilliant Restoration, Aether Tide clusters cleared

#### Batch 287 (opponent GY return + chosen shuffle + Lapse + nonland bounce)
- Executor: exclude graveyard selectors from battlefield-bounce parser; `target nonland permanents` in up-to bounce; shuffle `the chosen cards` into library; `that spell` → library top on counter; `getTargetPlayerId` falls back to `ctx.targetPlayerId`
- Parser: `upgradeCounteredSpellLibraryTopReplacementSteps`; `pruneMalformedExploreReminderMoveZoneSteps` (Jadelight/Glowcap)
- Audit enrich: opponent GY return + chosen-cards shuffle fixtures
- Tests: `rules-engine/test/oracleIRGapBatch287.test.ts`
- Audit: `unsupported_selector` **227 → 214** (−13)

#### Batch 288 (unearth + multicolored GY + hand exile + Sweep Plains)
- Executor: `the card` contextual reference; `multicoloredOnly` criteria; `parseMoveZoneCountCardsFromTargetPlayersHand`; `parseMoveZoneAlternateCostColorCardFromYourHand`; `parseMoveZoneAnyNumberBasicLandSubtypeYouControlToHand` (Plains sweep)
- Audit enrich: unearth creature, multicolored GY card, opponent hand cards, alt-cost colored hand card, Plains fixtures
- Tests: `rules-engine/test/oracleIRGapBatch288.test.ts`
- Audit: `unsupported_selector` **214 → 196** (−18)

#### Batch 289 (bounce variants + alt-cost count + compound GY + nonblue + Disappear + Foggy Swamp)
- Executor: bare `any number of` / `one or two` battlefield bounce selectors; `all nonblue` mass bounce via `excludeCardColor`; counted alt-cost colored hand exile (`two white cards`); triple compound GY return (`artifact, enchantment, and planeswalker`); `enchanted creature and this Aura`; `X target creature cards from graveyards` exile; exclude `from graveyards` in bounce parser
- Audit enrich: `gy-planeswalker-1` fixture; counted alt-cost hand cards; planeswalker GY target inference
- Tests: `rules-engine/test/oracleIRGapBatch289.test.ts`
- Audit: `unsupported_selector` **196 → 183** (−13); Sunscour, Scapegoat, Counterintelligence, Triumphant Reckoning, Inundate, Disappear, Onakke Oathkeeper, Foggy Swamp Visions clusters cleared

#### Batch 290 (milled-this-way + adventure + Wave Goodbye + Grimoire + Identity Crisis + Collected Company)
- Executor: `a/an X card milled this way` hand path; `all cards that have an Adventure from among the milled cards`; `each creature without a +1/+1 counter` mass bounce; `the other one` contextual hand (extends `isTheOtherReference`); `all cards from target player's hand and graveyard`; per-card `mana value N or less` among-them BF/library-bottom split
- Audit enrich: land milled-this-way, adventure milled cards, creatures with/without +1/+1, Grimoire top-two GY pair, Identity Crisis target zones, Collected Company library among-them
- Tests: `rules-engine/test/oracleIRGapBatch290.test.ts`
- Audit: `unsupported_selector` **183 → 175** (−8); Sparring Dummy, Beluna, Wave Goodbye, Phyrexian Grimoire, Identity Crisis, Collected Company clusters cleared

#### Batch 291 (Tamiyo MV-X GY + opponent choice GY + Soulquake + chosen pile + Tazri milled activated)
- Executor: `parseMoveZoneSingleTargetCriteria` fixes `nonland permanent card with mana value X`; `parseMoveZoneOpponentChoiceFromTargetPlayersGraveyard`; `parseMoveZoneCompoundBattlefieldAndGraveyardMassReturn`; `parseMoveZoneCardFromChosenPile`; `parseMoveZoneAllNonManaActivatedCreaturesFromMilledCards` + `cardHasNonManaActivatedAbility`
- Audit enrich: Tamiyo GY artifact + xValue; opponent-choice GY creature; Soulquake BF+GY fixtures; chosen-pile library card; milled activated/non-activated creatures
- Tests: `rules-engine/test/oracleIRGapBatch291.test.ts`
- Audit: `unsupported_selector` **175 → 170** (−5); Tamiyo, Visions of Dread, Soulquake, Truth or Tale, Tazri clusters cleared

#### Batch 292 (Cry of the Carnarium + Memory Theft + Aether Burst + Nissa hand/GY)
- Parser: `inferZoneFromDestination` prefers `onto the battlefield` over incidental `hand` in toRaw (Nissa −5 fix)
- Executor: `parseMoveZoneAllFromEachPlayersGraveyard` supports `in all graveyards` + `were put there from the battlefield this turn`; `up to X target` bounce; `parseMoveZoneAdventureCardThatPlayerOwnsFromExile`; `parseMoveZoneTypedCardFromHandOrGraveyard` lands-MV + raw step fallback; `exileAllMatchingFromGraveyard` putIntoGraveyardThisTurn filter
- Audit enrich: Carnarium GY-this-turn creatures; Memory Theft adventure in opponent exile; Aether Burst BF targets + xValue; Nissa lands + GY creature
- Tests: `rules-engine/test/oracleIRGapBatch292.test.ts`
- Audit: `unsupported_selector` **170 → 166** (−4); Cry of the Carnarium, Memory Theft, Aether Burst, Nissa clusters cleared

#### Batch 294 (Angrath Pirate GY + Reap X random + Shoal MV-X alt cost)
- Executor: `parseMoveZoneRandomSingleFromYourGraveyard` X-count + embedded `Return X cards at random`; `parseMoveZoneAlternateCostColorCardFromYourHand` `with mana value X` + `resolveMoveZoneSingleTargetCriteriaWithX` in alt-cost handler
- Audit enrich: `gy-pirate-1` fixture + pirate GY target inference; alt-cost hand cards seeded with `cmc` when MV-X
- Tests: `rules-engine/test/oracleIRGapBatch294.test.ts`
- Audit: `unsupported_selector` **161 → 154** (−7); Angrath, Reap the Past, Disrupting/Nourishing/Sickening Shoal clusters cleared (Coiling Rebirth was audit-fixture-only)

#### Batch 295 (Coiling GY fix + Pull face-up exile + Paradoxical bounce + Hallowed flicker)
- Executor: `resolveUniqueChosenGraveyardTargetId` only excludes `lastMovedCards` no longer in GY; `parseMoveZoneTargetFaceUpExiledCard` + cross-player face-up exile lookup; `parseMoveZoneCountTargetBattlefieldBounce` nonland/nontoken any-number; battlefield `nontokenOnly` selector; `it entered under your control` conditional for flicker counters
- Audit enrich: face-up exile target; flicker `lastMovedCards` + exile fixture; nonland nontoken bounce targets
- Tests: `rules-engine/test/oracleIRGapBatch295.test.ts`
- Audit: `unsupported_selector` **154 → 150** (−4); assisted **96.7%**; Coiling Rebirth, Pull from Eternity, Paradoxical Outcome, Hallowed Respite clusters cleared

#### Batch 296 (surveil GY split + Snow Hound bounce + Rats' Feast X GY + Narfi each-GY exile)
- Executor: `getContextualThemSplitKind` `any_number_graveyard_library_top` for surveil disposal (`to=graveyard`, rest library top); `parseMoveZoneThisCreatureAndTargetYouControl` + colored BF selector bounce; `parseMoveZoneCountTargetCardsFromSingleGraveyard` `useXValue` for `X target cards from a single graveyard`; `parseMoveZoneSingleCardFromEachPlayersGraveyard` `each graveyard` + `creature or planeswalker` compound type
- Audit enrich: library-top surveil fixtures (`lastMovedCards`); Snow Hound `bf-source` + blue creature; Rats' Feast single-GY + `xValue`; Narfi per-player GY creature/PW cards
- Tests: `rules-engine/test/oracleIRGapBatch296.test.ts`
- Audit: `unsupported_selector` **150 → 145** (−5); assisted **96.7%**; Candlestick, Snow Hound, Rats' Feast, King Narfi's Betrayal clusters cleared

#### Batch 297 (historic hand→BF + random them return + flashback GY exile + all library exile)
- Executor: `parseMoveZoneSingleTargetCriteria`/`parseMoveZoneTypedCardFromYourHand` `historic permanent` + `requiresHistoric`; `parseMoveZoneCountOfThemAtRandom` contextual shuffle return; `parseMoveZoneAllFromTargetPlayersGraveyard` `requiresFlashback` + `cardHasFlashbackAbility`; `parseMoveZoneAllFromYourLibrary` accepts `all the cards`
- Audit enrich: historic hand card; Sinister Waltz 3-creature GY fixture; Tombfire p2 flashback GY + `targetPlayerId`; Mirror of Fate library cards
- Tests: `rules-engine/test/oracleIRGapBatch297.test.ts`
- Audit: `unsupported_selector` **145 → 141** (−4); assisted **96.7%**; Thran Temporal Gateway, Sinister Waltz, Tombfire, Mirror of Fate clusters cleared

#### Batch 298 (Aberrant multi-GY return + Ghastly face-down pile + Kayla up-to-X among-them)
- Executor: `parseMoveZoneOneTwoOrThreeTargetCreatureCardsFromGraveyards`; `parseMoveZoneAllFromTargetPlayersGraveyard` face-down pile + `shuffleExiledPile`; `parseAmongThemTypeConstraints` compound `and/or`; `parseMoveZoneTypedCardFromAmongThem` `up to x … from among them` (`maxCount: -1`, `manaValueLte`); skip `parsedAmongThoseCardsEarly` single-card BF shortcut when `maxCount === -1` (Kayla multi-move)
- Audit enrich: Aberrant multi-GY creature targets; Ghastly p2 GY + `targetPlayerId`; Kayla library-top + `lastMovedCards` + `xValue`
- Tests: `rules-engine/test/oracleIRGapBatch298.test.ts`
- Audit: `unsupported_selector` **141 → 138** (−3); assisted **96.7%**; Aberrant Return, Ghastly Conscription, Kayla's Reconstruction clusters cleared

#### Batch 299 (that pile GY + Turntimber among-them + Aura Finesse attach)
- Executor: `parsedThatPile` graveyard destination from exile; `parseAmongThemSplitFromMoveZoneParts` `a creature card from among them` + `bfLibraryBottomSplit`; conditional `that card has mana value N or less`; attach resolver `target aura you control`
- Audit enrich: Abstract Performance exile pile + `chosenObjectIds`; Turntimber library-top + `lastMovedCards`; Aura Finesse aura/creature attach targets
- Tests: `rules-engine/test/oracleIRGapBatch299.test.ts`
- Audit: `unsupported_selector` **138 → 135** (−3); assisted **96.7%**; Abstract Performance, Turntimber Symbiosis, Aura Finesse clusters cleared

#### Batch 300 (GY creature/planeswalker MV X + Belbe chosen-type hand)
- Executor: `parseMoveZoneAllFromYourGraveyard` explicit `all creature and planeswalker … mana value X`; `parseStaticManaValueLteConstraint` compound types + `x`; `parseMoveZoneSingleTypedCardFromYourGraveyard` non-target single GY card; `parseMoveZoneTypedCardFromYourHand` `creature card of the chosen type`; `parsedFromGraveyard` criteria BF put with X resolution
- Audit enrich: creature/planeswalker GY fixtures + `xValue` + `chosenObjectIds`; Belbe hand Elf + `chosenCreatureType`
- Tests: `rules-engine/test/oracleIRGapBatch300.test.ts`
- Audit: `unsupported_selector` **135 → 130** (−5); assisted **96.7%**; Ascend from Avernus, Blood on the Snow, Belbe's Portal clusters cleared

#### Batch 301 (Dragon named exile + Aetherspouts attacking + Split GY piles)
- Parser: explicit `for each attacking creature, its owner puts…`; fix possessive `'s` regex false match on `its`
- Executor: `parseMoveZoneThisCardAndNamedCardsFromYourGraveyard`; `parseMoveZoneEachAttackingCreature`; `parseMoveZoneExileUpToTargetPermanentsFromGySplitTwoPiles`
- Audit enrich: Dragon's Approach named GY fixtures + `sourceId`; Aetherspouts attacking BF permanent; Split the Spoils GY permanents + `chosenObjectIds`
- Tests: `rules-engine/test/oracleIRGapBatch301.test.ts`
- Audit: `unsupported_selector` **130 → 127** (−3); assisted **96.7%**; Dragon's Approach, Aetherspouts, Split the Spoils clusters cleared

#### Batch 302 (each-player hand count + adventure GY + exiled-with creature)
- Executor: `requiresAdventure` criteria + `card that has an adventure`; `parseMoveZoneCountCardsFromEachPlayersHand` + `exileUpToCountFromHand`; `each creature card exiled with this artifact` in `parseMoveZoneAllExiledWithThisPermanent`
- Audit enrich: Mind Swords multi-player hand + `chosenObjectIds`; Edgewall adventure GY card; Ghost Vacuum exiled-with creature fixtures + `sourceId`
- Tests: `rules-engine/test/oracleIRGapBatch302.test.ts`
- Audit: `unsupported_selector` **127 → 122** (−5); assisted **96.7%**; Mind Swords, Edgewall Inn, Ghost Vacuum clusters cleared

#### Batch 303 (aegis exile return + up-to-one milled enchant + sorcery GY audit)
- Executor: `parseMoveZoneAllExiledCardsWithCounter` + `findAllExiledCardsWithCounter`; `up to one {type} card milled this way` in `parseMoveZoneAllCardsMilledThisWay` (`maxCount: 1`)
- Audit enrich: Livio aegis-counter exile fixtures; Terra milled enchantment GY + `lastMilledCards`; Mirari sorcery `inferGraveyardTargetIdFromWhatText` → `gy-red-sorcery-1`
- Tests: `rules-engine/test/oracleIRGapBatch303.test.ts`
- Audit: `unsupported_selector` **122 → 119** (−3); assisted **96.7%**; Livio, Terra/Esper Terra, The Mirari Conjecture clusters cleared

#### Batch 304 (any-number different names GY / count exiled-with saga / each GY-this-way)
- Executor: `parseMoveZoneAnyNumberFromYourGraveyard` + `differentNames` + `selectGraveyardCardIdsWithDifferentNames`; `parseMoveZoneCountCardsExiledWithThisPermanent` + rest-to-owners-library; `each card put into a graveyard this way` in `parseMoveZoneCardPutIntoGraveyardThisWay`; `moveTargetedCardFromExile` library_top/bottom support
- Audit enrich: Eerie GY permanents + `chosenObjectIds`; Vault 13 exiled-with saga fixtures + `sourceId`; Sorin `putIntoGraveyardTurn` GY cards
- Tests: `rules-engine/test/oracleIRGapBatch304.test.ts`
- Audit: `unsupported_selector` **119 → 116** (−3); assisted **96.7%**; Eerie Ultimatum, Vault 13, Sorin Lord of Innistrad clusters cleared

#### Batch 305 (permanent among-them MV / discarded-this-way land / opponent choice bounce)
- Executor: `up to N permanent cards with mana value X or less from among them` → `bfLibraryBottomSplit`; `parseMoveZoneAllCardsDiscardedThisWay` + BF tapped handler; `parseMoveZoneOpponentChoicePermanentToHand` + opponent permanent bounce
- Audit enrich: Storm library-top + `lastMovedCards`; Mind Roots `lastDiscardedCards` + p2 GY land; Teferi opponent BF permanent + `targetPlayerId`
- Tests: `rules-engine/test/oracleIRGapBatch305.test.ts`
- Audit: `unsupported_selector` **116 → 113** (−3); assisted **96.7%**; Storm the Festival, Mind Roots, Teferi Temporal Pilgrim clusters cleared

#### Batch 306 (another unless-pays / all colored permanents / revealed to GY)
- Executor: `another target X` in `parseMoveZoneCountTargetBattlefieldBounce`; `parseMoveZoneUnlessPaysManaFromStepText`; `parseMoveZoneAllColoredPermanentsToHand`; basic land color inference in `collectCardColors`; `parsedTheRevealedCards` graveyard path
- Audit enrich: Withdraw BF creatures + `unlessPaysManaChoice`; Hibernation green/blue BF fixtures; Dakra `lastMovedCards` library-top reveal
- Tests: `rules-engine/test/oracleIRGapBatch306.test.ts`
- Audit: `unsupported_selector` **113 → 110** (−3); assisted **96.7%**; Withdraw, Hibernation, Dakra Mystic clusters cleared

#### Batch 307 (hand face-down exile / destroyed-this-way GY return / compound mass exile)
- Executor: `parseMoveZoneAnyNumberFromYourHandFaceDown` + face-down `exileUpToCountFromHand`; `lastReferenceAmount` carry-over for `that many cards from the top of your library` → hand; `parseMoveZoneAllCardsDestroyedThisWayFromYourGraveyard`; `parseMoveZoneCompoundArtifactCreatureLandGyHandsExile`
- Audit enrich: Scroll Rack hand + library-top fixtures + `referenceAmount`; Cleansing Meditation `lastMovedCards` GY fixtures; Decree BF/GY/hand multi-player fixtures
- Tests: `rules-engine/test/oracleIRGapBatch307.test.ts`
- Audit: `unsupported_selector` **110 → 106** (−4); assisted **96.7%** (46405/47969); Scroll Rack (2 clusters), Cleansing Meditation, Decree of Annihilation cleared

#### Batch 308 (opponent hand to library top / GY put-there-this-turn / or-type milled to BF)
- Executor: `parseMoveZoneTheCardsFromTargetOpponentHand` + opponent all-hand library-top move; existing `parseMoveZoneSingleTargetFromAGraveyard` audit enrich for put-there-this-turn; comma-or fix in `parseAmongMilledOrTypeClause` + battlefield handler for or-type milled cards
- Audit enrich: Head Games p2 hand + `targetPlayerId`; Abyssal Harvester `putIntoGraveyardTurn: 3` + `chosenObjectIds`; Bramble milled GY fixtures + `lastMilledCards`
- Tests: `rules-engine/test/oracleIRGapBatch308.test.ts`
- Audit: `unsupported_selector` **106 → 103** (−3); assisted **96.7%** (46408/47969); Head Games, Abyssal Harvester, Bramble Familiar // Fetch Quest clusters cleared

#### Batch 309 (hand+GY shuffle / saga+exiled to hand / up-to-X permanent GY)
- Executor: `parseMoveZoneYourGraveyardAndHand` + `shufflePlayerHandAndGraveyardIntoLibrary`; `parseMoveZoneThisPermanentAndTheExiledCard` + saga bounce + linked exile return; `up to x … cards from your graveyard` branch in `parseMoveZoneUpToTargetCountFromYourGraveyard`
- Audit enrich: Trenzalore hand+GY fixtures; Aesir saga BF + linked exile card + `sourceId`; Uncle's Musings GY permanents + `xValue: 3` + `chosenObjectIds`
- Tests: `rules-engine/test/oracleIRGapBatch309.test.ts`
- Audit: `unsupported_selector` **103 → 100** (−3); assisted **96.8%** (46411/47969); Trenzalore Clocktower, The Aesir Escape Valhalla, Uncle's Musings clusters cleared

#### Batch 310 (any-number target bounce / GY-this-way return / each creature GY+finality)
- Executor: generic `any number of target X` in `parseMoveZoneCountTargetBattlefieldBounce`; passive `a … card put into your graveyard this way` in `parseMoveZoneCardPutIntoGraveyardThisWay` + `lastMovedCards` BF handler; `each … from your graveyard` in `parseMoveZoneAllFromYourGraveyard`
- Audit enrich: Kiora's BF enchantments + `chosenObjectIds`; Starfall `lastMovedCards` GY creature; Shilgengar GY creature fixtures
- Tests: `rules-engine/test/oracleIRGapBatch310.test.ts`
- Audit: `unsupported_selector` **100 → 91** (−9); assisted **96.8%** (46420/47969); Kiora's Dismissal, Starfall Invocation, Shilgengar clusters cleared (+6 bonus clusters from generic any-number-target bounce)

#### Batch 311 (untyped single-GY exile / all commanders CZ→BF / all attacking bounce)
- Executor: untyped `N target cards from a single graveyard` in `parseMoveZoneCountTargetCardsFromSingleGraveyard`; `parseMoveZoneAllCommandersFromCommandZone` + all-players CZ→BF handler; `all attacking creatures` in `parseMoveZoneEachAttackingCreature` + hand bounce handler
- Audit enrich: Pestilent Cauldron GY fixtures + `chosenObjectIds`; Tevesh p1/p2 command zone commanders; Aetherize attacking BF fixtures
- Tests: `rules-engine/test/oracleIRGapBatch311.test.ts`
- Audit: `unsupported_selector` **91 → 88** (−3); assisted **96.8%** (46423/47969); Pestilent Cauldron // Restorative Burst, Tevesh Szat, Aetherize clusters cleared

#### Batch 312 (one-or-two nonland bounce / power-GTE among-them BF+library / target library exile)
- Executor: `one or two target nonland permanents` in `parseMoveZoneCountTargetBattlefieldBounce`; `powerGte` + `a creature card with power N or greater from among them` + `bfLibraryBottomSplit` in `parseMoveZoneTypedCardFromAmongThem`; `parseMoveZoneAllFromTargetPlayersLibrary` + `moveAllMatchingFromLibrary`
- Audit enrich: Wanderwine BF nonland fixtures + `chosenObjectIds`; Mayael library-top `lastMovedCards` + power-6 creature choice; Jace p2 library + `targetPlayerId`
- Tests: `rules-engine/test/oracleIRGapBatch312.test.ts`
- Audit: `unsupported_selector` **88 → 85** (−3); assisted **96.8%** (46426/47969); Wanderwine Farewell, Mayael the Anima, Jace the Mind Sculptor clusters cleared

#### Batch 313 (artifact+all-GY exile / hand top-or-bottom both / gy+bf dual return)
- Executor: `parseMoveZoneThisArtifactAndAllCardsFromAllGraveyards` + source BF exile + all-GY exile; `topOrBottomBoth` in `parseMoveZoneCountFromYourHand` + library placement handler; `parseMoveZoneTargetCreatureFromGraveyardAndTargetCreatureOnBattlefield` + dual hand return
- Audit enrich: Silent Gravestone BF source + multi-player GY; Dream Cache hand fixtures + `libraryPlacement: bottom`; Rise // Fall GY creature + BF creature + `chosenObjectIds`
- Tests: `rules-engine/test/oracleIRGapBatch313.test.ts`
- Audit: `unsupported_selector` **85 → 82** (−3); assisted **96.8%** (46429/47969); Silent Gravestone, Dream Cache, Rise // Fall clusters cleared

#### Batch 314 (GY target return / opponent-choice from your GY)
- Executor: `parseMoveZoneOpponentChoiceFromTargetPlayersGraveyard` regex extended for `an opponent's choice from your graveyard` + `fromHandOrGraveyardOwner`; hand/battlefield handlers use controller GY when owner is controller; `tap_matching_permanents` merges `chosenObjectIds` instead of replacing (fixes When-you-do + GY return chains)
- Audit enrich: Tasigur p1 GY fixtures + opponent `chosenObjectIds`; `needsTargetFromYourGraveyard` (nested-step aware) for Myr + creature-mv≤3 return patterns
- Tests: `rules-engine/test/oracleIRGapBatch314.test.ts`
- Audit: `unsupported_selector` **82 → 80** (−2); assisted **96.8%** (46431/47969); Meanders Guide, Myr Reservoir, Tasigur clusters cleared

#### Batch 315 (mass BF+GY exile / any-number hand shuffle / chosen-type X bounce)
- Executor: `parseMoveZoneCompoundBattlefieldAndGraveyardMassReturn` extended for mv≤3 creatures+planeswalkers BF+all-GYs exile; `parseMoveZoneAnyNumberCardsFromYourHand` + `shuffleSelectedCardsFromHandIntoLibrary`; `usesChosenCreatureType` on `SimpleBattlefieldSelector` + `permanentMatchesSelector` for X target creatures of chosen type
- Audit enrich: Shadows' Verdict BF+GY fixtures; Credit Voucher hand fixtures + `chosenObjectIds`; Selective Snare Elf/Goblin BF + `chosenCreatureType` + `xValue`
- Tests: `rules-engine/test/oracleIRGapBatch315.test.ts`
- Audit: `unsupported_selector` **80 → 76** (−4); assisted **96.8%** (46435/47969); Shadows' Verdict, Credit Voucher, Selective Snare clusters cleared

#### Batch 316 (all creature tokens bounce / multicolored GY return / owner library choice)
- Executor: `parseMoveZoneAllCreatureTokens` + `tokenOnly` on `SimpleBattlefieldSelector`; `parseStaticManaValueLteConstraint` for `multicolored permanent` + mv≤N; `parseMoveZoneTargetCreatureOwnerLibraryChoice` (matches from `step.raw` when `what.text` is truncated)
- Audit enrich: `needsMulticoloredFromGraveyard` nested-step aware + Empyrean Eagle GY fixture + `chosenObjectIds`; `needsAllCreatureTokensBounce` token BF fixtures; `needsTargetCreatureOwnerLibraryChoice` + `bf-audit-ice-target` + `libraryPlacement`
- Tests: `rules-engine/test/oracleIRGapBatch316.test.ts`
- Audit: `unsupported_selector` **76 → 73** (−3); assisted **96.8%** (46438/47969); Perplexing Test, Obscura Charm, Ice Magic clusters cleared

#### Batch 317 (noncreature nonland among-them BF / this card + target land GY / unearth return)
- Executor: generic `up to N TYPE cards with mana value X or less from among them` in `parseAmongThemSplitFromMoveZoneParts`; `parseMoveZoneThisCardAndTargetFromYourGraveyard` + dual GY→BF tapped handler
- Audit enrich: United Battlefront library `lastMovedCards` + chosen artifact/enchantment; Sandman self+land GY fixtures + `sourceId`/`sourceName`; Salvation Colossus `needsReturnThisCardFromGraveyardToBattlefield` self GY fixture
- Tests: `rules-engine/test/oracleIRGapBatch317.test.ts`
- Audit: `unsupported_selector` **73 → 70** (−3); assisted **96.8%** (46440/47969); United Battlefront, Sandman, Salvation Colossus clusters cleared

#### Batch 318 (counted target GY return / aura reattach / mass noncreature nonland bounce)
- Executor: `parseMoveZoneCountFromYourGraveyard` for `N target cards from your graveyard`; `returnExactMatchingFromGraveyardToHand` honors `chosenObjectIds`; `parseMoveZoneAllNoncreatureNonlandPermanentsToHand`; attach resolver for `target Aura attached to a permanent` + host-aware `another permanent with the same controller`
- Audit enrich: Restock GY fixtures + 2 chosen ids; Filter Out artifact/enchantment/creature BF fixtures; Simic Guildmage host/target/aura BF fixtures
- Tests: `rules-engine/test/oracleIRGapBatch318.test.ts`
- Audit: `unsupported_selector` **70 → 67** (−3); assisted **96.8%** (46443/47969); Restock, Simic Guildmage, Filter Out clusters cleared

#### Batch 319 (snow among-them / all tapped bounce / GY or flashback exile return)
- Executor: `parseAmongThemTypeConstraints` snow permanent (`typeLineTermsAnyOf: ['snow']`); `parseMoveZoneAllTappedCreatures` + `parseSimpleBattlefieldSelector` tapped-in-remainder fix; `parseMoveZoneSingleTargetInstantOrSorceryFromGraveyardOrOwnedFlashbackExile` + GY-first then owned flashback exile handler
- Audit enrich: Glacial Revelation `lastMovedCards` snow/non-snow + chosen snow ids; Time of Ice tapped/untapped BF fixtures; Sorceress's Schemes GY instant + owned exile flashback + `chosenObjectIds`
- Tests: `rules-engine/test/oracleIRGapBatch319.test.ts`
- Audit: `unsupported_selector` **67 → 64** (−3); assisted **96.8%** (46443/47969); Glacial Revelation, Time of Ice, Sorceress's Schemes clusters cleared

#### Batch 320 (half creatures bounce / up-to-X single GY exile / that-card BF + rest GY)
- Executor: `parseMoveZoneHalfCreaturesTheyControlRoundedUp` + ceil-half bounce handler; `parseMoveZoneCountTargetCardsFromSingleGraveyard` extended for `up to X target cards from a single graveyard`; `parsedThatCardToBattlefield` handler + `parsedTheRestToGraveyard` excludes `chosenObjectIds`; postprocess split for `put that card onto the battlefield and the rest into your graveyard`
- Audit enrich: Split the Party p2 BF creatures + `targetPlayerId`; Martyr of Bones GY fixtures + `xValue`; Animal Magnetism `lastMovedCards` + chosen creature id
- Tests: `rules-engine/test/oracleIRGapBatch320.test.ts`
- Audit: `unsupported_selector` **64 → 61** (−3); assisted **96.8%** (46446/47969); Split the Party, Martyr of Bones, Animal Magnetism clusters cleared

#### Batch 321 (bottom library to GY / up-to-five creature GY exile)
- Executor: `moveBottomCardFromLibrary` + `parseMoveZoneBottomCardFromLibrary` + bottom-library owner resolver; `parseMoveZoneUpToTargetCardsFromGraveyards` extended for typed `up to N target TYPE cards from graveyards`
- Audit enrich: Cellar Door p2 library bottom fixture + `targetPlayerId`; Grenzo controller library bottom fixture; Boneyard Parley GY creature fixtures + chosen ids
- Tests: `rules-engine/test/oracleIRGapBatch321.test.ts`
- Audit: `unsupported_selector` **61 → 58** (−3); assisted **96.8%** (46449/47969); Cellar Door, Grenzo, Dungeon Warden, Boneyard Parley (exile step) clusters cleared

#### Batch 322 (Boneyard Parley pile / Trial // Error combat bounce / Planar Overlay those lands)
- Parser postprocess: split Boneyard Parley compound into `all cards from the pile of your choice` → battlefield + `the rest` → owners' graveyards
- Executor: `parseMoveZoneAllCardsFromPileOfYourChoice` + chosen-pile exile→BF handler; `parseMoveZoneAllCreaturesBlockingOrBlockedByTargetCreature` + combat bounce (excludes target); `parseMoveZoneThoseLands` + contextual land bounce; `resolveCreaturesBlockingOrBlockedByTarget` helper
- Audit enrich: Boneyard Parley exile pile fixtures + `lastExiledCards`/`chosenObjectIds`; Trial // Error blocking/blocker BF fixtures + `targetCreatureId`; Planar Overlay land BF fixtures + `lastMovedCards`
- Tests: `rules-engine/test/oracleIRGapBatch322.test.ts`
- Audit: `unsupported_selector` **58 → 55** (−3); assisted **96.8%** (46452/47969); Boneyard Parley (pile step), Trial // Error, Planar Overlay clusters cleared

#### Batch 323 (planeswalker MV X from GY / graveyards-this-way return / this permanent when token dies)
- Executor: existing `parseMoveZoneSingleTargetFromYourGraveyard` path for Confront the Past (audit enrich only); `parseMoveZoneUpToCreatureCardsPutIntoGraveyardsThisWay` + multi-GY return handler; `inferPreferredSourceCardZones` extended for `return this permanent … to the battlefield` (Tatsumasa uses existing `sourceCardZone` handler)
- Audit enrich: Confront the Past GY planeswalker + `xValue`/`chosenObjectIds`; Danse Macabre sacrificed creature fixtures + `lastMovedCards`/`lastSacrificedPermanents`; Tatsumasa source permanent in GY + `sourceId`/`sourceName`
- Tests: `rules-engine/test/oracleIRGapBatch323.test.ts`
- Audit: `unsupported_selector` **55 → 52** (−3); assisted **96.8%** (46455/47969); Confront the Past, Danse Macabre, Tatsumasa clusters cleared

#### Batch 324 (Cryptic Gateway hand put / Worldfire hands+GY exile / Restore the Peace damage bounce)
- Executor: `parseMoveZoneCreatureFromHandSharingTypeWithEachTappedThisWay` + `lastTappedMatchingPermanentIds` type-matching hand→BF handler; `parseMoveZoneAllCardsFromAllHandsAndGraveyards` + mass hand/GY exile handler; `parseMoveZoneEachCreatureThatDealtDamageThisTurn` + `dealtDamageThisTurn` bounce handler
- Audit enrich: Cryptic Gateway tapped goblin BF fixtures + hand goblin + `lastTappedMatchingPermanentIds`; Worldfire hand/GY fixtures per player; Restore the Peace `dealtDamageThisTurn` creature fixture
- Tests: `rules-engine/test/oracleIRGapBatch324.test.ts`
- Audit: `unsupported_selector` **52 → 49** (−3); assisted **96.8%** (46457/47969); Cryptic Gateway, Worldfire, Restore the Peace clusters cleared

#### Batch 325 (target Dinosaur from GY / two creature cards from hand / lowest toughness bounce)
- Executor: existing `parseMoveZoneSingleTargetFromYourGraveyard` for Atzocan Seer (audit enrich only); `parseMoveZoneCountTypedCards` + count-limited hand→BF handler; `parseMoveZoneCreatureYouDontControlLowestToughness` + lowest-toughness opponent bounce handler
- Audit enrich: Atzocan Seer GY Dinosaur + `chosenObjectIds`; See the Unwritten hand creature fixtures + two chosen ids; Bounce Chamber opponent BF toughness fixtures + `bf-bc-low` chosen id
- Tests: `rules-engine/test/oracleIRGapBatch325.test.ts`
- Audit: `unsupported_selector` **49 → 46** (−3); assisted **96.9%** (46461/47969); Atzocan Seer, See the Unwritten, Bounce Chamber clusters cleared

#### Batch 326 (that-many GY creatures to BF / sea-type exclusion bounce / opponents hand+GY exile)
- Executor: `parseMoveZoneThatManyCreatureCardsFromYourGraveyard` + reference-count GY→BF handler; `parseMoveZoneEachCreatureExcludingListedTypes` + type-exclusion bounce handler (`permanentHasAnyListedCreatureType`); `parseMoveZoneAllCardsFromAllOpponentsHandsAndGraveyards` + opponents-only hand/GY exile handler
- Audit enrich: Lich-Knights GY creature fixtures + `referenceAmount`/chosen ids; Summon Leviathan kraken/merfolk/human BF fixtures; Ashiok opponent hand/GY fixtures (controller hand preserved)
- Tests: `rules-engine/test/oracleIRGapBatch326.test.ts`
- Audit: `unsupported_selector` **46 → 43** (−3); assisted **96.9%** (46464/47969); Lich-Knights' Conquest, Summon: Leviathan, Ashiok, Nightmare Weaver clusters cleared

#### Batch 327 (hand creature total P+T put / same-name mass exile / among-them exile rest bottom)
- Executor: `parseMoveZoneCreatureHandTotalPowerToughnessLte` + `cardMatchesTotalPowerToughnessLte` optional hand→BF handler; `parseMoveZoneTargetNonlandSameNameMassExile` + `exileAllSameNamedCardsFromAllGraveyards` + same-named BF exile handler; `parseMoveZoneUpToOneNonlandAmongThemRestLibraryBottom` + contextual among-them exile/rest-bottom handler; `moveContextualCardToDestination` library→exile support
- Audit enrich: Meek Attack hand small/big creature fixtures + chosen id; Moratorium Stone Lightning Bolt GY/BF fixtures across players + chosen target id; Duelist's Flame library reveal fixtures + `lastMovedCards`/chosen nonland id
- Tests: `rules-engine/test/oracleIRGapBatch327.test.ts`
- Audit: `unsupported_selector` **43 → 40** (−3); assisted **96.9%** (46467/47969); Meek Attack, Moratorium Stone, Duelist's Flame clusters cleared

#### Batch 348 (specific kicker / warrior subtype / gy entry / life vs starting)
- Evaluators: `was kicked with its … kicker`; `this creature is a {subtype}`; graveyard entry antecedent; `you have at least N life more than your starting life total`
- Audit enrich: wasKicked source; warrior source type_line; gy-entry antecedent fixtures; p1 life 55 + startingLife 40
- Tests: `rules-engine/test/oracleIRGapBatch348.test.ts`
- Audit: `unsupported_condition_clause` **680 → 653** (−27); assisted **97.2%** (46624/47969); Sunscape Battlemage, Ascendant Spirit, Kotis, Angel of Destiny clusters cleared (+ `that spell was kicked` side effect)

#### Batch 347 (dragon beheld / no artifacts / no creatures / not a token)
- Evaluators: generic `a {quality} was beheld` + `beheldQuality`; `you control no artifacts`; `no creatures are on the battlefield`; `it's not a token`
- Context: `beheldQuality` on execution context
- Audit enrich: dragon beheld flag; strip controller artifacts; strip all creatures; nontoken target fixture
- Tests: `rules-engine/test/oracleIRGapBatch347.test.ts`
- Audit: `unsupported_condition_clause` **692 → 680** (−12); assisted **97.1%** (46599/47969); Osseous Exhale, Tezzeret's Ambition, Pyrohemia, Life of the Party clusters cleared

#### Batch 346 (opponent life lead / empty hand / no attack / team warrior)
- Evaluators: `an opponent has more life than you`; `that player has no cards in hand`; `this creature didn't attack this turn`; generic `your team controls another {subtype}` + `getTeamPlayerIds`
- Audit enrich: p2 higher life; p2 empty hand + target id; source `attackedThisTurn: false`; source + ally warrior fixtures
- Tests: `rules-engine/test/oracleIRGapBatch346.test.ts`
- Audit: `unsupported_condition_clause` **704 → 692** (−12); assisted **97.1%** (46588/47969); Linvala, Asylum Visitor, Erg Raiders, Sickle Dancer clusters cleared

#### Batch 345 (non-hand cast / zero mana / would-lose / no untapped lands)
- Evaluators: `this spell was cast from anywhere other than your hand`; `noManaSpentToCast`; `would lose the game` + `wouldLoseTheGame`; `you control no untapped lands`
- Context: `noManaSpentToCast`, `wouldLoseTheGame` on execution context
- Audit enrich: `castFromZone: graveyard`; zero-mana flag; would-lose flag; tap all controller lands
- Tests: `rules-engine/test/oracleIRGapBatch345.test.ts`
- Audit: `unsupported_condition_clause` **717 → 704** (−13); assisted **97.1%** (46576/47969); Otterball Antics, Vexing Bauble, Exquisite Archangel, Well of Life clusters cleared

#### Batch 344 (creature-mana spend / seven-card hand / life lead / no monarch)
- Evaluators: `manaSpentOnCreatureSpell`; generic `you have N or more cards in hand`; `you have more life than an opponent`; `there is no monarch`
- Context: `manaSpentOnCreatureSpell` on execution context
- Audit enrich: creature-mana flag; 7-card hand fixture; p1 life > p2/p3; clear `monarch`
- Tests: `rules-engine/test/oracleIRGapBatch344.test.ts`
- Audit: `unsupported_condition_clause` **730 → 717** (−13); assisted **97.1%** (46566/47969); Generator Servant, Kiyomaro, Glorious Enforcer, Crown of Gondor clusters cleared

#### Batch 343 (creature-cast-this-way / untapped source / hand lead / had counters)
- Evaluators: `creatureSpellCastThisWay` + `you cast a creature spell this way`; `this creature is untapped`; `youHaveMoreCardsInHandThanEachOpponent`; `it had one or more counters on it`
- Context: `creatureSpellCastThisWay` on execution context
- Audit enrich: creature-cast-this-way flags; untapped source fixture; hand-size lead (p1 > p2/p3); countered creature target id
- Tests: `rules-engine/test/oracleIRGapBatch343.test.ts`
- Audit: `unsupported_condition_clause` **742 → 730** (−12); assisted **97.0%** (46553/47969); Alaundo, Reveille Squad, Death of a Thousand Stings, Nikara clusters cleared

#### Batch 342 (was-cast / crime / legendary / ring-bearer choice)
- Evaluators: `it was cast` via `wasCast`/`castFromZone`; `you've committed a crime this turn` via `committedCrimeThisTurn`; `it's legendary` on target permanent; `you chose a creature other than this permanent as your Ring-bearer` via `chosenRingBearerId`
- Context: `wasCast`, `chosenRingBearerId` on execution context
- Audit enrich: cast/hand fixtures; crime turn flag; legendary target id; alternate ring-bearer id on player + ctx
- Tests: `rules-engine/test/oracleIRGapBatch342.test.ts`
- Audit: `unsupported_condition_clause` **754 → 742** (−12); assisted **97.0%** (46542/47969); Wedding Ring, Servant of the Stinger, Gimli's Fury, Aragorn clusters cleared

#### Batch 341 (would-enter land / no time counters / not cast from hand / gained-or-lost life)
- Evaluators: `would enter` in `evaluateWouldReplacementClause`; generic `it had no … counters on it` (time/+1/+1); `you didn't cast it from your hand` via `castFromZone`; `you gained or lost life this turn` with composite-or guard in `splitCompositeCondition`
- Audit enrich: `castFromZone: graveyard` for not-from-hand ETB; `lifeGainedThisTurn` seed for gained-or-lost-life end-step triggers
- Tests: `rules-engine/test/oracleIRGapBatch341.test.ts`
- Audit: `unsupported_condition_clause` **766 → 754** (−12); assisted **97.0%** (46530/47969); Lotus Vale, Deadly Grub, Phage, Starlit Soothsayer clusters cleared

#### Batch 340 (mana-ability copy / cast-this-way / dragon-cast / additional-cost / dies-this-way)
- Evaluators: `it isn't a mana ability`; `you cast a spell this way` + `that creature dies this way` in `evaluateThisWayClause`; dragon-cast + mana-ability in extended evaluators; `this spell's additional cost was paid` in wrapper
- Context: `activatedAbilityIsManaAbility`, `spellCastThisWay`, `revealedDragonAsCast`, `controlledDragonAsCast`, `creatureDiedThisWay` on execution context
- Audit enrich: conditional fixtures for all five cluster patterns in `enrichAuditStateAndContextForTargets`
- Tests: `rules-engine/test/oracleIRGapBatch340.test.ts`
- Audit: `unsupported_condition_clause` **785 → 766** (−19); assisted **97.0%** (46521/47969); top count-4 clusters cleared (Bracers/Rings, Noctis cast-this-way, Dragon cast rider, Spirit Water additional cost)

#### Batch 339 (Serene permanent+GY shuffle / Research outside game / Blood another GY / Command attacking bounce)
- Parser: `parseMoveZoneThisPermanentAndUpToTargetFromSingleGraveyard`; `parseMoveZoneUpToCountCardsYouOwnFromOutsideGame`; `one or two target` in `parseMoveZoneCountTargetBattlefieldBounce`; `attackingOnly` in `parseSimpleBattlefieldSelector`
- Executor: permanent+single-GY library shuffle; sideboard→library shuffle; `moveAnotherMatchingCardFromYourGraveyard` hand path (excludes `lastMovedCards`); attacking-creature bounce via count-target handler
- Audit enrich: Serene BF source + GY fixtures; Research sideboard fixtures; Blood dual GY + `lastMovedCards`; Command attacking BF fixtures
- Tests: `rules-engine/test/oracleIRGapBatch339.test.ts`
- Audit: `unsupported_selector` **4 → 0** (−4); assisted **96.9%** (46504/47969); **full_card selector gaps cleared**

#### Batch 338 (Rowan library-top/GY split / Ramosian rebel GY return / Vivien any-number milled)
- Parser: `count_library_top_graveyard_rest` in `parseMoveZoneContextualThemSplit`; subtype+permanent MV-lte in `parseStaticManaValueLteConstraint`; `any number of … milled this way` in `parseMoveZoneAllCardsMilledThisWay`
- Executor: contextual them split handler (up to N to library top, rest to GY); multi-card milled-this-way hand path when `anyNumber`
- Audit enrich: Rowan looked-at library fixtures + chosen top ids; Ramosian rebel GY fixture; Vivien milled creature fixtures + `lastMilledCards`
- Tests: `rules-engine/test/oracleIRGapBatch338.test.ts`
- Audit: `unsupported_selector` **7 → 4** (−3); assisted **96.9%** (46501/47969); Rowan's Grim Search, Ramosian Revivalist, Vivien on the Hunt clusters cleared

#### Batch 337 (Shrouded Lore last-chosen / Liliana GY creatures to BF / Codsworth aura-or-equipment attach)
- Parser: `parseMoveZoneLastChosenCard` for `the last chosen card`; extended `parseMoveZoneUpToTargetCardsFromGraveyards` for `up to N typed cards from graveyards` (non-target)
- Executor: `parsedLastChosenCard` cross-player steal (opponent GY → controller hand); `parsedUpToFromGraveyards` battlefield path (was exile-only); combined `target Aura or Equipment you control` in `resolveAttachmentPermanentIds`
- Audit enrich: Shrouded Lore opponent GY discard + `lastMovedCards`/chosen id; Liliana GY creature fixtures + two chosen ids; Codsworth BF equipment + creature fixtures
- Tests: `rules-engine/test/oracleIRGapBatch337.test.ts`
- Audit: `unsupported_selector` **10 → 7** (−3); assisted **96.9%** (46498/47969); Shrouded Lore, Liliana, the Necromancer, Codsworth, Handy Helper clusters cleared

#### Batch 336 (Reenact GY-this-turn / Hurkyl owned artifacts / Back for Seconds BF-instead)
- Parser: `parseMoveZoneSingleTargetFromAGraveyard` accepts `in a graveyard`; `parseMoveZoneAllTypedCardsTargetPlayerOwns`; `one of those cards with mana value N or less` among-them; postprocess upgrade for BF-instead-of-hand optional clause
- Executor: `returnAllOwnedMatchingCardsToPlayerHand` (battlefield + all zones by owner); among-them single-card path already uses full criteria
- Audit enrich: Reenact GY instant + `putIntoGraveyardTurn`; Hurkyl p2 BF/GY artifacts + `targetPlayerId`; Back for Seconds returned GY creatures + `lastMovedCards`
- Tests: `rules-engine/test/oracleIRGapBatch336.test.ts`
- Audit: `unsupported_selector` **13 → 10** (−3); assisted **96.9%** (46495/47969); Reenact the Crime, Hurkyl's Recall, Back for Seconds clusters cleared

#### Batch 335 (Niko foretell GY / Ballad historic among-them / Leonardo one-or-two GY)
- Parser: `requiresForetell` + `cardHasForetellAbility` in `parseMoveZoneSingleTargetCriteria`; `historic` in `parseAmongThemTypeConstraints`; `one or two target` + `each with mana value` in `parseMoveZoneUpToTargetCountFromYourGraveyard` / `parseStaticManaValueLteConstraint`
- Executor: among-them single-card GY path passes full `effectiveCriteria` (historic/foretell matching)
- Audit enrich: Niko GY foretell fixture; Ballad milled historic/nonhistoric GY fixtures + `lastMovedCards`; Leonardo GY creature fixtures + two chosen ids
- Tests: `rules-engine/test/oracleIRGapBatch335.test.ts`
- Audit: `unsupported_selector` **17 → 13** (−4); assisted **96.9%** (46492/47969); Niko Defies Destiny, Ballad of the Black Flag, Leonardo's Technique clusters cleared (+ Trystan's Command side effect)

#### Batch 334 (Recommission ETB counters / Patron hand lands / Tezzeret face-down hand)
- Parser: `parseMoveZoneUpToTargetCountFromYourHand`; `parseMoveZoneAnyNumberCardsFromYourHand` battlefield handler; `a creature enters this way` condition for `withCountersCondition`
- Audit enrich: Recommission GY creature fixture; Patron hand land fixtures; Tezzeret hand face-down fixtures
- Tests: `rules-engine/test/oracleIRGapBatch334.test.ts`
- Audit: `unsupported_selector` **22 → 17** (−5); assisted **96.9%** (46488/47969); Recommission, Patron of the Moon, Tezzeret, Cruel Machinist clusters cleared

#### Batch 333 (Bound color-X GY return / Northampton linked exile / Deploy Gatewatch among-them split)
- Parser: `parseMoveZoneUpToTargetCountFromYourGraveyard` for bare `up to x cards from your graveyard`; `parseMoveZoneSingleTargetFromLinkedExile` + `parseMoveZoneAllFromLinkedExile` accept `this land`; `buildAmongThemBattlefieldLibraryBottomCriteria` for generic `up to N typed cards from among them`
- Audit enrich: Bound sacrificed 2-color creature + `xValue: 2` + GY fixtures; Northampton land source + linked exile creature; Deploy library top planeswalkers + `lastMovedCards`
- Tests: `rules-engine/test/oracleIRGapBatch333.test.ts`
- Audit: `unsupported_selector` **25 → 22** (−3); assisted **96.9%** (46482/47969); Bound // Determined, Northampton Farm, Deploy the Gatewatch clusters cleared

#### Batch 332 (Nahiri GY exile / Five Doctors battlefield / Lady Sun dual bounce)
- Parser: `upgradeThoseCardsBattlefieldInsteadOfHandSteps` maps kicked `put those cards onto the battlefield instead of putting them into your hand` → `what: those cards`, `to: battlefield`
- Executor: `parseMoveZoneThisPermanentAndAnotherTargetCreature` + dual bounce handler; `creature_or_equipment` + `manaValueLtReferenceLoyalty` in `parseMoveZoneSingleTargetCriteria` / `resolveMoveZoneSingleTargetCriteriaWithX`
- Audit enrich: Nahiri planeswalker + GY fixtures; Five Doctors hand fixtures + `lastMovedCards`; Lady Sun source/target BF; copy-of-it enrich preserves prior `chosenObjectIds`
- Tests: `rules-engine/test/oracleIRGapBatch332.test.ts`
- Audit: `unsupported_selector` **28 → 25** (−3); assisted **96.9%** (46480/47969); Nahiri, The Five Doctors, Lady Sun clusters cleared

#### Batch 331 (chosen-this-way return / dual-target bounce / countered spell library bottom)
- Executor: `parseMoveZoneTypedCardFromAmongThem` extended for `each card chosen this way`; `parseMoveZoneThisCreatureAndAnotherTargetCreature` + dual bounce handler; `upgradeCounteredSpellLibraryTopReplacementSteps` extended for `put it on the bottom of its owner's library instead of` → `that spell` + library bottom
- Audit enrich: Rejoin the Fight controller GY chosen creature fixtures; Coastal Wizard source/target BF + `targetCreatureId`; countered-spell library bottom stack fixtures (extended predicate)
- Tests: `rules-engine/test/oracleIRGapBatch331.test.ts`
- Audit: `unsupported_selector` **31 → 28** (−3); assisted **96.9%** (46477/47969); Rejoin the Fight, Coastal Wizard, Spell Crumple clusters cleared

**Do not commit** unless asked.

---

## Copy-paste prompt for next session

```
Continue MTGEDH Oracle IR Track E9 — post batch 469 (telemetry soak gap fixes + D3 legacy retirement).

Read first:
- docs/oracle-ir-session-handoff.md (§ Next session — batches 467–469)
- docs/oracle-ir-track-e-remaining-work.md (§ D3, D6, E9+)
- .cursor/rules/oracle-ir-no-bespoke-handlers.mdc

Current status (2026-07-03):
- Migration: 811/811 green (npm run test:oracle-ir-migration, ~13 min; do NOT pass duplicate --pool=threads)
- Legacy ratchet: 76 wired applyRetiredTriggerLegacy* exports (oracle-ir-legacy-handler-ratchet.unit.test.ts)
- D6: client resolutionChoicePrimitives shipped (number_choice → X modal; options[] fallback)
- Batch 469: conditional appliedSteps, scry/surveil+draw deferral, this spacecraft target, station threshold re-fetch
- Pre-469 soak: 34 telemetry events (22 all_or_nothing_failure, 10 owned_but_unhandled, 2 legacy_handled)
- Triage: 76 wired / 0 orphaned (transitive closure from stackExecuteTriggerEffect* roots)

Priority 1 — Re-run telemetry soak and compare:
  cd server
  $env:ORACLE_IR_WRITE_TELEMETRY_SNAPSHOT='D:\Git\MTGEDH\server\scripts\out\telemetry-snapshot-post469.json'
  npm run test:oracle-ir-migration
  npm run oracle-ir:legacy-triage -- --snapshot scripts/out/telemetry-snapshot-post469.json
  Compare event counts vs pre-469 (expect fewer all_or_nothing_failure / owned_but_unhandled).

Priority 2 — Continue D3 evidence-driven legacy deletion:
  - Only delete handlers whose legacy_family NEVER appears in legacy_handled telemetry after soak
  - Optional richer signal: ORACLE_IR_TRIGGER_LEGACY=1 forced migration subset before triage
  - npm run oracle-ir:legacy-triage:soak
  - Lower ratchet ceiling after each deletion batch; never delete without triage proof

Priority 3 — Remaining owned_but_unhandled triage:
  - Spell path: stackResolveSpellOracleIrUtils.ts (IR primary owns spell but categorize fallback)
  - Trigger tail: stackExecuteTriggerEffectTailUtils.ts
  - Fix generic IR gaps; no new card-name handlers

Targeted regression (after changes):
  npx vitest run tests/prepared.trigger-primary.integration.test.ts tests/oracle-ir-scry-surveil.integration.test.ts tests/oracle-ir-station-charge-counters.integration.test.ts tests/oracle-ir-broodship-graveyard-cast.socket.integration.test.ts tests/oracle-ir-legacy-handler-ratchet.unit.test.ts --pool=threads --maxWorkers=1

Key paths:
- All-or-nothing / telemetry: server/src/state/modules/oracleIrStepWiring.ts, oracleIrGapTelemetry.ts
- Conditional executor: rules-engine/src/oracleIRExecutorMainLoop.ts (case 'conditional')
- Legacy triage: server/scripts/oracle-ir-legacy-triage.ts, oracle-ir-legacy-triage-soak.ts
- Station IR: server/src/state/modules/oracleIrAbilityExecution.ts (tryApplyStationChargeCountersViaOracleIR)
- Draw deferral: server/src/state/modules/oracleIrTriggerExecution.ts (drawEffectSynced)

Do not commit unless asked. Windows: chain with ; not &&.
```
