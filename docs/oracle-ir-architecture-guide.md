# MTGEDH Oracle IR Architecture & Execution Loop

**Version:** 2026-07-06 (copy-token except modifiers + oracle hydration; referenced-object pronouns)  
**Repository:** MTGEDH  
**Audience:** Contributors working on card behavior, server integration, or migration off legacy handlers

---

## 1. Purpose

Oracle IR (Intermediate Representation) is the project's canonical pipeline for turning **oracle text** into **game state changes**. The end goal is a single path:

```
oracle text → parse → OracleEffectStep[] → execute → server sync → resolution UI → resume
```

**Corpus status (2026-07-02):** Layers **1–2 are complete** for commander-legal scope. Layer **3 is beta-ready** — production runs IR-primary for spells, triggers, and activated abilities; migration bar **797/797**. Zone steps use the pre-commit transition pipeline and step ledger; legacy fallbacks remain as migration debt (Phase 4) but are gated when IR primary owns the effect.

**New cards not in the parser:** **Compiled overlays are the default ingestion path** (atomic native steps); the delta audit (`npm run oracle-ir:delta`) finds the gaps and emits the work queue — see §15 and [oracle-ir-track-e-remaining-work.md § Goal: Semantic atomic parsing](./oracle-ir-track-e-remaining-work.md#goal-semantic-atomic-parsing--seamless-effect-automation-new-cards).

---

## 2. Three layers

| Layer | Location | Responsibility | Status |
|-------|----------|----------------|--------|
| **1 — Parse** | `rules-engine/src/oracleIRParser.ts` | `parseOracleTextToIR()` → `OracleEffectStep[]`; overlay merge for gaps | ✅ Corpus green; overlay path for new cards |
| **2 — Execute** | `rules-engine/src/oracleIRExecutor.ts` | `applyOracleIRStepsToGameState()` dry-run | ✅ Green (full_card 100% assisted) |
| **3 — Integrate** | `server/src/state/modules/oracleIr*.ts` | Live state, queue prompts, resume, pre-commit transitions | ✅ Beta-ready (**797/797**); Phase 4 legacy debt remains |

**Never call** `applyOracleIRStepsToGameState` directly on live server state. Always use **`applyOracleIRStepsOnServer`**.

---

## 3. Core data types

### OracleEffectStep

Defined in `rules-engine/src/oracleIR.ts`. Each step is a typed instruction, e.g.:

- `draw`, `mill`, `discard`, `sacrifice`, `destroy`, `exile`
- `create_token`, `copy_permanent`, `add_counter`, `modify_pt`
- `tap_or_untap`, `gain_life`, `lose_life`, `deal_damage`
- `scry`, `surveil`, `look_select_top`, `search_library`
- `conditional`, `unless_pays_mana`, `unless_pays_life`
- `choose_mode`, `player_choice`, `copy_spell`, `fight`
- `unknown` (parser gap — must not return `handled: true` on server)

### OracleIRExecutionContext

Built via `buildOracleIRExecutionContext()` (`oracleIRExecutor.ts`). Carries:

- `controllerId`, `sourceId`, `sourceName`
- `chosenObjectIds`, `targetPermanentId`, `targetCreatureId`, `targetSpellId`, `xValue`
- `interactivePlayerChoices: true` on server
- **`stepLedger`** — `Map<stepIndex, RuntimeObjectSnapshot[]>` for "this way" reads (persisted on state as `oracleIrStepLedger` across resume)
- **`appliedStepKinds`** — tracks which step kind ran at each index
- **`currentStepIndex`** — set each main-loop iteration
- **`serverBridge`** — server-only; routes zone steps through `oracleIrTransitionPipeline.ts`
- **`transitionHaltState`** — deferred replacement choices halt execution until resolved

Runtime carry-over slots (`lastMovedCards`, `lastExiledCards`, etc.) remain for **dry-run / audit** paths without `serverBridge`. On server apply, bridged steps omit these after ledger commit (`skipLedgerFlush`).

### Referenced-object pronoun resolution (it / its / that creature's)

Oracle text often uses pronouns after a target or move step. IR maps these to **generic player selectors**, not card-name handlers:

| Oracle phrase | `OraclePlayerSelector` kind |
|---------------|----------------------------|
| `its controller`, `that creature's controller` | `controller_of_referenced_object` |
| `its owner`, `that card's owner` | `owner_of_referenced_object` |

**Resolution** (`oracleIRExecutorReferenceUtils.ts` → `resolveReferencedObject`):

1. Bound targets: `targetPermanentId`, `targetCreatureId`, `chosenObjectIds`, `lastReferencedPermanentId`
2. Object lookup in any zone via `findObjectByIdInState` (battlefield, stack, library, hand, graveyard, exile)
3. Moved/sacrificed snapshots: `lastMovedCards`, `lastSacrificedPermanents` (post-destroy/exile riders)
4. Trigger/ability source: `sourceId`; counterspell target: `targetSpellId` (top-level or `selectorContext`; server unless-pay queue uses `resolveOracleIrBoundTargetSpellId`)
5. Step ledger on server bridged zone steps: recent ledger snapshots (destroy/exile/sacrifice) when `lastMovedCards` is omitted after bridge
6. Explicit server binding: `selectorContext.targetPlayerId` (fallback only)
7. **Never** guess “the only opponent” in multiplayer

`owner_of_moved_cards` remains a **move_zone-only** selector (“under its owner's control” on `battlefieldController`). Its execution delegates to the same reference resolver for consistency.

**Server binding** — stack targets are normalized once via `inferOracleIrTargetBinding()` (`rules-engine/src/oracleIrTargetBinding.ts`):

- Battlefield permanent → `targetPermanentId` (+ `targetCreatureId` when type line is Creature)
- Player → `targetPlayerId` / `targetOpponentId`
- Stack spell → `targetSpellId`
- Card in graveyard/hand/exile/library → `chosenObjectIds` (resolver finds object by id)

Used by `oracleIrSpellExecution.ts`, `oracleIrAbilityExecution.ts`, `stackResolveSpellUncategorizedUtils.ts`, and trigger IR fallback (`stackExecuteTriggerEffectIrFallbackUtils.ts`). All paths should call `buildOracleIRExecutionContext(base, hint)` so bindings appear on both top-level ctx and `selectorContext`.

**Tests:** `rules-engine/test/referencedObjectPlayerResolution.test.ts`, `rules-engine/test/beastWithinTokenRider.test.ts`, `rules-engine/test/oracleIrTargetBinding.test.ts`, `rules-engine/test/counterspellUnlessPayBinding.test.ts`, `rules-engine/test/referencedPossessiveZoneRouting.test.ts`, `rules-engine/test/forEachOpponentExileRider.test.ts`, `rules-engine/test/forEachDestroyedThisWayTokenRider.test.ts`, `rules-engine/test/redSunTwilightForEachDestroyedCopy.test.ts`, `rules-engine/test/exiledZoneObjectStat.test.ts`, `server/tests/oracle-ir-referenced-object-spell.integration.test.ts`, `server/tests/per-opponent-target-selection.test.ts`, `server/tests/luminate-per-opponent-cast.integration.test.ts`, `server/tests/oracle-ir-removal-rider-spell.integration.test.ts`

**Legacy spell riders to retire** (semi-bespoke; same pronoun/binding fix covers most):

| Module | Examples | Retire when |
|--------|----------|-------------|
| `oracleIrSpellLegacyRemovalRiderUtils.ts` | Swords, Nature's Claim, Path to Exile, Fateful Absence, Get Lost | IR primary + integration tests (`oracle-ir-removal-rider-spell.integration.test.ts`); legacy riders run only when `!oracleIrSpellHandled` |
| `stackResolveSpellTargetMetadataUtils.ts` → `applyInstantSorceryItsControllerCreatesToken` | Beast Within, Assassin's Trophy | IR `create_token` + reference resolver; same `!oracleIrSpellHandled` gate |
| `planeswalker/templates/registry.ts` + `resolve.ts` | destroy/exile + its controller draw/lose/gain life | Same IR steps on spell path |
| `captureInstantSorceryRemovalTargetMetadata` | Pre-resolution target controller capture | Merged into `buildSpellIrContext` / IR ctx |

**Not in this cluster:** ~~graveyard-cast token replacement~~ (Increasing Devotion-style `create N of those tokens instead` when cast from graveyard — `oracleIRExecutorTokenStepHandlers.ts`, `oracleIRExecutorMainLoop.ts` conditional recurse). **Chaos Warp** and **Jaheira's Respite** now use generic shuffle/reveal/conditional ETB and where-X `search_library` spell IR (see `chaosWarpJaheiraSpellIr.test.ts`, `oracle-ir-chaos-jaheira.integration.test.ts`). **Entrapment Maneuver** now uses generic `sacrifice` + `create_token` (where X = that creature's toughness) via oracle IR `TARGET_SELECTION` resume — see `entrapmentSacrificeTokenAmount.test.ts`, `oracle-ir-removal-rider-spell.integration.test.ts`. For-each riders (Descent of the Dragons token copy, Luminate Primordial exile + life, Red Sun's Twilight for-each-destroyed copy + haste/exile) now use generic parse/execute paths — see `forEachDestroyedThisWayTokenRider.test.ts`, `forEachOpponentExileRider.test.ts`, `redSunTwilightForEachDestroyedCopy.test.ts`. Post-exile `object_stat` riders (`You gain life equal to its power` after `Exile target …`) resolve the referenced permanent from exile via `chosenObjectIds` when battlefield snapshots are gone — see `exiledZoneObjectStat.test.ts`. Per-opponent targeting (`for each opponent, up to one target … that player controls`) queues a single `TARGET_SELECTION` step with `perOpponent` metadata; `TargetSelectionModal` groups by opponent and `validatePerOpponentTargetSelections` enforces at-most-one-per-controller — see `per-opponent-target-selection.test.ts` and end-to-end cast flow in `luminate-per-opponent-cast.integration.test.ts`.

**Remaining gaps:** none in this referenced-object cluster.

### OracleIRExecutionResult

Returned after execution. Key fields:

- `appliedSteps` — steps that mutated state
- `skippedSteps` — with reason codes (`player_choice_required`, `unsupported_*`, etc.)
- `pendingOptionalSteps` / `pendingContinuationSteps` — tail waiting on choices
- `automationGaps` — structured skip reasons for server queue bridges
- `state` — mutated game state snapshot (includes persisted `oracleIrStepLedger` when present)

---

## 4. High-level architecture diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ORACLE TEXT (card)                               │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                    parseOracleTextToIR()  [rules-engine]
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    OracleEffectStep[] (IR program)                       │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          │                         │                         │
          ▼                         ▼                         ▼
   [Activated]              [Triggered]                 [Spell]
   ability stack            ability stack               spell stack
          │                         │                         │
          ▼                         ▼                         ▼
 tryApplyOracleIRTo      tryResolveTriggerViaOracleIR   tryResolveSpellViaOracleIR
 ActivatedAbility        [oracleIrTriggerExecution.ts]  [oracleIrSpellExecution.ts]
          │                         │                         │
          └─────────────────────────┼─────────────────────────┘
                                    │
                    applyOracleIRStepsOnServer()  [oracleIrServerZoneSync.ts]
                                    │
                    ┌───────────────┴───────────────┐
                    │ 1. hydrate zones from ctx     │
                    │ 2. create stepLedger + bridge │
                    │ 3. applyOracleIRStepsToGameState│
                    │    (per-step: propose →       │
                    │     intercept → commit →      │
                    │     flush/ledger record)      │
                    │ 4. sync zones back to ctx     │
                    │ 5. queue*ChoicePrompts*       │
                    │ 6. sync counters/tokens/delay │
                    └───────────────┬───────────────┘
                                    │
              player_choice_required? ──yes──► ResolutionQueueManager
                                    │              (resolution.ts)
                                    │                    │
                                    │                    ▼
                                    │            Client prompt (App.tsx)
                                    │                    │
                                    │                    ▼
                                    │         submitResolutionResponse
                                    │                    │
                                    │                    ▼
                                    │     maybeResumeOracleIRStepsAfterResolution
                                    │
                                    no
                                    ▼
                            Stack advances / SBA / broadcast
```

---

## 5. Production feature flags

File: `server/src/state/modules/oracleIrFeatureFlags.ts`

| Flag | Production default | Meaning |
|------|-------------------|---------|
| `ORACLE_IR_TRIGGER_PRIMARY` | **ON** | Try IR before trigger regex |
| `ORACLE_IR_SPELL_PRIMARY` | **ON** | Try IR before `categorizeSpell` |
| `ORACLE_IR_*_LEGACY=1` | off | Force legacy path |

Vitest defaults primary **OFF** (`server/tests/vitest.setup.ts`). Migration suite (`npm run test:oracle-ir-migration`) tests production defaults.

---

## 6. Execution loop (detailed)

### Phase A — Entry (stack resolution)

When a stack item resolves:

1. **Activated ability** → `tryApplyOracleIRToActivatedAbility` (`oracleIrAbilityExecution.ts`)
2. **Triggered ability** → `tryResolveTriggerViaOracleIR` (`oracleIrTriggerExecution.ts`)
3. **Instant/Sorcery** → `tryResolveSpellViaOracleIR` (`oracleIrSpellExecution.ts`)

Each entry point:

1. Extracts effect text (full clause for triggers — use `extractTriggerEffectAfterPrefix`)
2. Calls `parseOracleTextToIR(effectText, sourceName)`
3. Collects `OracleEffectStep[]` from parsed abilities
4. Checks **runtime wiring** via `oracleIrStepWiring.ts` (`isOracleEffectStepRuntimeWired`, `areAllOracleEffectStepsRuntimeWired`)

### Phase B — All-or-nothing gate

**Invariant:** Multi-step effects must complete mandatory steps or return `handled: false`.

`isOracleIrExecutionHandled()` / `isOracleIrMandatoryExecutionComplete()` verify:

- No `unknown` steps
- All mandatory steps applied OR bridged to resolution queue
- Optional steps either applied, queued, or correctly deferred to Effect Program

If incomplete → **legacy fallback runs** (regex / categorizeSpell). This is the primary double-application risk.

### Phase C — Server apply (`applyOracleIRStepsOnServer`)

File: `server/src/state/modules/oracleIrServerZoneSync.ts`

```
hydrateOracleIRPlayerZonesFromContext(ctx, state)
  → applyMillReplacementEffectsToSteps (optional)
  → createEmptyStepLedger(irCtx.stepLedger ?? state.oracleIrStepLedger)
  → createOracleIRServerExecutionBridge({ ledger, haltState })
  → applyOracleIRStepsToGameState(state, steps, { ...irCtx, stepLedger, serverBridge }, { haltOnPlayerChoiceRequired: true })
  → Object.assign(state, result.state)
  → enrichBattlefieldTokenImages
  → syncCounterReplacementEffectsAfterOracleIR
  → syncOracleIRPlayerZonesToContext
  → bridgeScheduleDelayedFlickerReturnsFromOracleIRResult
  → queue*ChoicePromptsFromOracleIRResult (per step kind)
  → syncIrCopyTokenProvenance / impulse exile / temporary abilities
```

### Step ledger & pre-commit transitions (Phases A–Z)

**Problem:** `lastMovedCards` / `lastExiledCards` on context are single-slot and unindexed; zone commits bypassed replacement rules.

**Solution:** Each zone-affecting step index gets immutable `RuntimeObjectSnapshot[]` captured at proposal time. Server path:

```
Step handler → build*Transitions() / lastMovedCards flush
  → serverBridge.proposeTransitions()
  → interceptOracleIRTransitions (evaluateReplacementEvent)
  → commitOracleIRTransitions (mutate state + merge ledger)
```

**Ledger reference convergence (Phase T):** `acquireStepLedgerForExecution()` reuses the same `stepLedger` Map passed to `serverBridge` — flush-path observations (`look_top`, `scry`, etc.) and bridged commits write to one Map.

**Bridged step kinds (server path, non-exhaustive):**

| Category | Step kinds |
|----------|------------|
| Removal | `exile`, `destroy`, `sacrifice`, `exile_top`, `impulse_exile_top`, `exile_named_cards_from_zones` |
| Hand/library | `discard`, `mill`, `draw`, `move_zone` |
| Look/search | `look_top`, `reveal_top`, `look_select_top`, `look_choose_from_top`, `search_library` (incl. split-destination) |
| Observation (choice-deferred) | `scry`, `surveil` — library-top snapshots flushed before SCRY/SURVEIL queue |
| Other | `deal_damage`, `add_counter`, `create_token` / `copy_permanent` (battlefield-entry) |

Later steps, `modify_pt` where-X, and conditionals read antecedents via `resolveThisWayTrait` / `oracleIRLedgerCardAccess.ts`, not runtime carry-over arrays.

**Post-Z (Phases AA–BB):** Post-Z compound-spell hardening **complete**. IR `LIBRARY_SEARCH` steps with `oracleIrChoiceStepJson` always resume through Oracle IR on `submitResolutionResponse` (split and single-destination). `librarySearchResolve` replay events emit when `persistLibrarySearchResolve` is set (split and non-split), including serialized step ledger for reconnect/replay. Cultivate-style `search_library` + `revealFound` binds and ledger-reads "revealed this way" antecedents for conditionals and where-X even after shuffle resume overwrites `appliedStepKinds`. "Searched library this way" conditionals use the same ledger fallback. Legacy tutor handlers skip when an IR-bridged library search is already queued. IR-bridged `SCRY` / `SURVEIL` steps attach `oracleIrChoiceStepJson`, resume IR after zone apply, continue compound steps, and persist ledger fields on `scryResolve` / `surveilResolve` replay events. Compound `scry` + `draw` spells (e.g. Opt) resume the draw through `oracleIrResumeStepsJson` after scry resolves; `resolveTopOfStack` on Opt queues the same IR scry path. Surveil compound + replay parity matches scry; Consider stack-resolve E2E completes the same way. Opt stack resolve persists `scryResolve` ledger for replay and scry-this-way where-X reads. Compound resume preserves absolute step indices (`scry` at 0, `draw` at 1) via `currentStepIndex` base offset and `resolveOracleIrChoiceStepIndex` / `resolveOracleIrContinuationStepIndex`; ledger snapshots for scry/surveil resolve events are taken before compound continuation runs. Consider `surveilResolve` ledger replay supports revealed-this-way reads; `oracleIrResumeStepsJson` is persisted on compound resolve events and restored as `oracleIrPendingResumeStepsJson` for `resumeOracleIrPendingCompoundStepsFromState` after reconnect. `processPendingOracleIrCompoundResume` auto-finishes pending compound steps after replay and on reconnect (join / stack resolve / resolution-step request). Auto-resume and live socket compound resolve append `drawCards` events (`oracleIrCompoundResume: true`, optional `drawnCardIds`) for event-log determinism; `drawCardsByIds` in `applyEvent(drawCards)` honors `drawnCardIds` for shuffled-library replay; `applyEvent(drawCards)` clears pending resume to avoid double-draw. `ResolutionQueueManager.beginReplay` / `endReplay` suppress transient queue enqueue during `replay()`; retarget prompts use `allowDuringReplay`. Chart a Course stack E2E (Phase AR): `resolveTopOfStack` under IR primary draws two synchronously, then queues `DISCARD_SELECTION` unless `attackedPlayersThisTurnByPlayer` is non-empty for the controller; discard prompts persist via `resolveTopOfStackPrompt` (Phase AS). Library-search compound draw (Phase AS): `handleLibrarySearchResponse` persists `drawCards` + `oracleIrResumeStepsJson` on `librarySearchResolve` with `libraryAfter` captured before compound resume; `applyEvent(librarySearchResolve)` restores pending compound resume for reconnect. Library-search compound reconnect (Phase AT): `resumeOracleIrPendingCompoundStepsFromState` and `replay()` auto-resume after `librarySearchResolve` mirror Opt/Consider scry/surveil paths. Big Score stack E2E (Phase AT): draw-then-create-token compound spells complete synchronously on `resolveTopOfStack`. joinGame compound resume (Phase AU): `processPendingOracleIrCompoundResume` on reconnect finishes pending library-search conditional draw. Wheel stack E2E (Phase AU): Reforge the Soul and Windfall resolve via IR primary on `resolveTopOfStack`. joinGame compound resume (Phase AU–AW): `processPendingOracleIrCompoundResume` on reconnect finishes pending library-search conditional draw, Opt `scryResolve` compound draw, and Consider `surveilResolve` compound draw. Echo of Eons stack E2E (Phase AV): shuffle-hand-graveyard-then-draw wheel completes on `resolveTopOfStack`. Inspiring Call stack E2E (Phase AW): draw-per-counter + indestructible grant completes on `resolveTopOfStack`. Chart a Course joinGame discard reconnect (Phase AX): `applyEvent(resolveTopOfStackPrompt)` restores queued discard; `joinGame` re-emits `resolutionStepPrompt` for socket completion. Scry-2 compound stack E2E (Phase AY): Preordain completes scry-then-draw on `resolveTopOfStack` with compound `drawCards` resume. Draw-then-scry stack E2E (Phase AY): Serum Visions draws synchronously then queues trailing scry 2. joinGame scry-2 compound resume (Phase AZ): Preordain compound draw finishes from `scryResolve` pending resume on reconnect. Serum Visions joinGame scry reconnect (Phase BA): trailing scry after draw-then-scry spell completes via `resolveTopOfStackPrompt` + `joinGame`. IR scry/surveil prompt persist (Phase BA): all IR-bridged scry/surveil queue steps append `resolveTopOfStackPrompt`. Opt/Consider prompt replay E2E (Phase BB): pre-response scry/surveil prompts replay from event log. Compound-spell matrix: architecture guide §12.

### Phase D — Resolution queue bridge

When executor returns `player_choice_required`, server functions enqueue `ResolutionStep` objects:

| IR step kind | Queue helper | Resolution type |
|--------------|--------------|-----------------|
| `scry`, `surveil` | `queueTopLibraryChoicePromptsFromOracleIRResult` | `SCRY` / `SURVEIL` |
| `unless_pays_mana/life` | `queueUnlessPayChoicePromptsFromOracleIRResult` | `UNLESS_PAY` |
| `discard` | `queueDiscardChoicePromptsFromOracleIRResult` | `DISCARD_SELECTION` |
| `sacrifice` | `queueSacrificeChoicePromptsFromOracleIRResult` | `TARGET_SELECTION` |
| `look_select_top` | `queueLookChooseChoicePromptsFromOracleIRResult` | `LIBRARY_SEARCH` |
| `search_library` | `queueSearchLibraryChoicePromptsFromOracleIRResult` | `LIBRARY_SEARCH` |
| `add_mana` | `queueAddManaChoicePromptsFromOracleIRResult` | `MANA_COLOR_SELECTION` |
| `player_choice` | `queuePlayerChoicePromptsFromOracleIRResult` | `OPTION_CHOICE` |
| `copy_permanent` | `queueCopyPermanentChoicePromptsFromOracleIRResult` | `TARGET_SELECTION` |
| `fateseal`, `clash` | Effect Program | `PLAYER_CHOICE` |

`ResolutionQueueManager` emits `resolutionStepPrompt` → client opens modal → `submitResolutionResponse` → `resolution.ts` resumes IR via `maybeResumeOracleIRStepsAfterResolution` or `maybeApplyOracleIrChoiceStepFromResolution`.

### Phase E — Effect Program (optional orchestrator)

For multi-choice chains (optional triggers, modals, fateseal/clash):

- Builder: `rules-engine/src/effectProgram.ts`
- Server start: `startOracleEffectProgramOnServer` (`oracleIrEffectProgramServer.ts`)
- Resume: `resumeEffectProgramResolution` (`effectProgramResolutionService.ts`)

**Production today:** optional trigger yes/no, fateseal/clash. **Not yet default** for modal spells (`choose_mode`).

### Phase F — Legacy fallback (migration debt)

If IR returns `handled: false`:

| Path | File | Risk |
|------|------|------|
| Trigger regex | `oracleIrTriggerLegacy*.ts` (31 modules) | Double apply if IR partially ran |
| Spell categorize | `targeting.ts` → `executeSpellEffect` | Parallel opcode dispatch |
| Uncategorized spell | `oracleIrUncategorizedSpellFallback.ts` | Partial IR re-implementation |
| Trigger IR tail | `stackExecuteTriggerEffectIrFallbackUtils.ts` | Second IR attempt |

**Migration rule:** No new card-name branches. Extend parser → executor → queue wiring instead.

---

## 7. Triggered abilities — full loop

```
Game event (ETB, attack, upkeep, tap, etc.)
    → detect*Triggers() in server/src/state/modules/triggers/
    → pushTriggeredAbility on stack (APNAP ordered)
    → stack resolves triggered ability
    → tryResolveTriggerViaOracleIR()
         ├─ requiresEffectProgramOrchestration? → startOracleEffectProgramOnServer
         ├─ parse + collectTriggerExecutionSteps()
         ├─ applyOracleIRStepsOnServer()
         └─ handled? → done : executeTriggerEffect() legacy regex
    → resolution prompts if queued
    → resume tail steps
    → broadcastGame
```

**Tap trigger batching:** `collectTapTriggersForTapEvent()` ensures "one or more X become tapped" fires once per event.

---

## 8. Activated abilities — full loop

```
Player activates (interaction.ts)
    → pay costs, targets selected
    → ability on stack
    → tryApplyOracleIRToActivatedAbility()
         ├─ collectActivatedAbilitySteps() — text after "{cost}:"
         ├─ isActivatedAbilityEffectFullyWired()
         └─ applyOracleIRStepsOnServer()
    → queue + resume as needed
```

Activated path is the **most complete** IR integration (primary, all-or-nothing, queue bridges).

---

## 9. Spells — full loop

```
Cast instant/sorcery → stack
    → tryResolveSpellViaOracleIR() [if ORACLE_IR_SPELL_PRIMARY]
         ├─ parse full oracle text
         ├─ applyOracleIRStepsOnServer()
         └─ handled? → done
    → else categorizeSpell() → SpellSpec opcodes → executeSpellEffect()
    → else oracleIrUncategorizedSpellFallback (partial IR switch)
```

---

## 10. Key files reference

| Concern | Path |
|---------|------|
| Parse | `rules-engine/src/oracleIRParser.ts` |
| IR types | `rules-engine/src/oracleIR.ts` |
| Execute | `rules-engine/src/oracleIRExecutor.ts` |
| Referenced-object resolution | `rules-engine/src/oracleIRExecutorReferenceUtils.ts` |
| Stack target binding | `rules-engine/src/oracleIrTargetBinding.ts` |
| Main loop | `rules-engine/src/oracleIRExecutorMainLoop.ts` |
| Step ledger | `rules-engine/src/oracleIRStepLedger.ts`, `oracleIRStepLedgerRuntime.ts` |
| This-way resolver | `rules-engine/src/oracleIRThisWayResolver.ts`, `oracleIRLedgerCardAccess.ts` |
| Pre-commit pipeline | `server/src/state/modules/oracleIrTransitionPipeline.ts` |
| Server apply + queue | `server/src/state/modules/oracleIrServerZoneSync.ts` |
| Step wiring / all-or-nothing | `server/src/state/modules/oracleIrStepWiring.ts` |
| Trigger IR entry | `server/src/state/modules/oracleIrTriggerExecution.ts` |
| Spell IR entry | `server/src/state/modules/oracleIrSpellExecution.ts` |
| Activated IR entry | `server/src/state/modules/oracleIrAbilityExecution.ts` |
| Effect Program server | `server/src/state/modules/oracleIrEffectProgramServer.ts` |
| Legacy routing | `server/src/state/modules/oracleIrTriggerLegacyRouting.ts` |
| Resolution socket | `server/src/socket/resolution.ts` |
| Feature flags | `server/src/state/modules/oracleIrFeatureFlags.ts` |
| Migration plan | `docs/oracle-ir-server-migration-plan.md` |
| Step ledger migration | `docs/oracle-ir-step-ledger-migration.md` |
| Interaction priorities | `docs/rules-interaction-priority-audit.md` |

---

## 11. Adding new behavior (required pattern)

1. **Parser** — add/adjust step in `oracleIRParser*.ts`; bind `thisWayAntecedentStepIndex` when multi-clause (see `oracleIRThisWayBinding.ts`)
2. **Executor** — handle step in `oracleIRExecutor*StepHandlers.ts`; emit transitions or `lastMovedCards` for flush
3. **Step ledger** — zone-affecting kinds: pre-commit bridge via `serverBridge` + ledger record; conditionals read ledger-first
4. **Wiring** — add step kind to `ORACLE_IR_FALLBACK_STEP_KINDS` or activated set in `trigger-runtime-wiring.ts`
5. **Server queue** — if step pauses: `queue*FromOracleIRResult` in `oracleIrServerZoneSync.ts` + resume hook in `resolution.ts`
6. **Integration test** — under `server/tests/oracle-ir-*.ts` with `ORACLE_IR_*_PRIMARY=1`; ledger unit tests under `rules-engine/test/oracleIR*.test.ts`
7. **Retire** — legacy regex handler if one existed; assert `isTriggerEffectFullyIrWired()`

**Forbidden:** card-name checks, new `KNOWN_*` table rows, bespoke `executeTriggerEffect` branches (see `.cursor/rules/oracle-ir-no-bespoke-handlers.mdc`).

---

## 12. Post-Z compound spell E2E matrix

Primary integration file: `server/tests/oracle-ir-scry-surveil.integration.test.ts` (migration suite). **43 tests** in that file; **701** in `npm run test:oracle-ir-migration`. Legend: **S** stack + socket, **R** replay / `applyEvent`, **C** reconnect / `processPendingOracleIrCompoundResume`, **J** `joinGame`.

| Spell / pattern | Steps | S | R | C | J |
|-----------------|-------|---|---|---|---|
| Opt | scry 1 → draw | ✓ | ✓ (prompt + scryResolve) | ✓ | ✓ |
| Consider | surveil 1 → draw | ✓ | ✓ (prompt + surveilResolve) | ✓ | ✓ |
| Preordain | scry 2 → draw | ✓ | ✓ (scryResolve) | — | ✓ |
| Serum Visions | draw → scry 2 | ✓ | ✓ (prompt) | — | ✓ |
| Chart a Course | draw 2 → unless-attack discard | ✓ | ✓ (prompt) | — | ✓ |
| Library-search conditional | search → if searched, draw | ✓ | ✓ | ✓ | ✓ |
| Big Score | draw 3 → create Treasures | ✓ | — | — | — |
| Inspiring Call | draw per +1/+1 → indestructible | ✓ | — | — | — |
| Reforge / Windfall / Echo | wheel (discard/shuffle/draw) | ✓ | — | — | — |
| Trigger compound scry/surveil | ETB-style clause + draw | ✓ (socket) | ✓ | — | — |

**Reconnect paths:** compound scry/surveil/library-search draws use `oracleIrPendingResumeStepsJson` + `processPendingOracleIrCompoundResume` on `joinGame`. Trailing prompts (discard, draw-then-scry) use `resolveTopOfStackPrompt` replay + `joinGame` `resolutionStepPrompt` re-emit.

**Remaining gaps (non-blocking):** wheel and token compound spells reconnect E2E.

**Post-Z status:** compound-spell hardening **complete** (Phases AA–BB). See `oracle-ir-step-ledger-migration.md` Post-Z section.

---

## 13. Verification

```powershell
cd server
npm run test:oracle-ir-migration    # 701 tests, production defaults

cd ../rules-engine
npx vitest run test/oracleIRStepLedger.test.ts test/oracleIRLedgerReferenceConvergence.test.ts test/oracleIRScrySurveilLedger.test.ts  # ledger smoke

cd ../server
npm run trigger:coverage              # detection gaps
npm run executor:coverage             # dry-run execution
```

---

## 14. Parallel server paths (outside IR)

Some live gameplay still bypasses `applyOracleIRStepsOnServer`:

| System | Server path | IR path | Notes |
|--------|-------------|---------|-------|
| **Combat damage** | `turn.ts` `dealCombatDamage` → `combat-damage-processing.ts` | `deal_damage` steps in `oracleIRExecutorDamageStepHandlers.ts` | Batch 280 unified infect/wither/poisonous on server. See [server-damage-processing-migration.md](./server-damage-processing-migration.md). |
| **State-based actions** | `counters_tokens.ts` `runSBA` | rules-engine SBA dry-run | Post-damage, post-proliferate, post-stack |

Long-term goal: delegate combat damage to rules-engine `executeCombatDamage` or route all damage through one module.

**Session handoff:** [oracle-ir-session-handoff.md](./oracle-ir-session-handoff.md)

---

## 15. Architecture direction (2026-07-02 review)

The pipeline in §1–§14 is confirmed as the end-state architecture. The review produced five standing decisions that shape all future work:

### 15.1 Overlay-first new-card ingestion

The regex parser (Layer 1) is a **frozen bootstrapping asset**: it earned the 47k-card corpus, but every extension risks regressing existing parses and its maintenance cost grows with its size. New/changed cards default to **compiled overlays** (reviewable JSON step programs, validated by the same executor dry-run). A parser batch is justified only when overlay clusters prove a phrasing recurs across many cards — and the redundant overlays are deleted after the batch lands. Decision tree: [track-e §C](./oracle-ir-track-e-remaining-work.md).

### 15.2 Delta CI (D1 — shipped)

`npm run oracle-ir:delta` (`server/scripts/oracle-delta-coverage-audit.ts`):

```
oracle-cards.json → per-card sha1(name + oracle text)
  → diff vs committed baseline (scripts/oracle-delta-baseline.json)
  → executor dry-run + trigger detection on NEW/CHANGED cards only
  → overlayWorkQueue (suggested action per gap reason)
  → non-zero exit on gaps (CI gate); --update-baseline accepts a green set
```

New-set support cost is now proportional to the **delta**, not the corpus.

### 15.3 Production gap telemetry (D2 — shipped)

`server/src/state/modules/oracleIrGapTelemetry.ts` records three event kinds, always on (independent of `DEBUG_STATE`), with counters + a 200-event ring buffer exposed at **`GET /api/oracle-ir/telemetry`**:

| Kind | Emitted when | Consumer |
|------|--------------|----------|
| `all_or_nothing_failure` | `logOracleIrAllOrNothingFailure` — IR attempted, gate failed | gap triage; legacy fallback may still cover it |
| `owned_but_unhandled` | IR primary owns text, did not apply, legacy path skipped (trigger tail / spell categorize gates) | **silent no-op risk — the highest-priority live signal** |
| `legacy_handled` | legacy handler executed while IR primary enabled (per handler family) | Phase 4 retirement triage (§15.4) |

### 15.4 Legacy retirement ratchet (Phase 4 / D3)

The dual execution path (IR primary + 86 `applyRetiredTriggerLegacy*` exports) is the main correctness risk for all-or-nothing and undo/replay. Two mechanisms make it shrink-only:

- `server/tests/oracle-ir-legacy-handler-ratchet.unit.test.ts` — fails if legacy handler export counts rise; slack check keeps ceilings honest after deletions.
- `legacy_handled` telemetry — after a soak, handlers whose families never fire are dead code; delete them evidence-driven instead of auditing 86 handlers speculatively.

### 15.5 Undo/replay divergence guardrail

Undo and server restart rebuild state by replaying the event log; that is only correct if every mutation flows through events **and** replay does not re-execute live handlers for already-resolved work.

**Stack replay contract (2026-07-06):**

| Event | Live play | Replay (`isReplaying`) |
|-------|-----------|------------------------|
| `pushTriggeredAbility` / `pushStack` | Push onto stack + persist event | Restore stack timing (push only) |
| `resolveTopOfStack` | Run `resolveTopOfStack()` (IR/legacy effects) | **Pop top stack item only** — outcomes come from `executeEffect` / `oracle_ir_execution` replay mutations |
| `executeEffect` + `oracleIrReplayMutation` | N/A (emitted after live IR) | Apply mutation; `consumeReplayedTriggeredAbilityStackItems` drops matching trigger |
| `moveResolvedInstantOrSorcery` | Spell leaves stack | Remove spell from stack by `cardId` |

After replay, `finalizeGameStateAfterReplay` → `scrubStaleReplayedStackAfterFullReplay` clears leftover `triggered_ability` items when the log does **not** end on a push (fixes 30+ phantom stack items after reconnect). Legit mid-game pending triggers are preserved when the log ends on `pushTriggeredAbility` / `pushStack`.

**Key files:** `applyEvent.ts` (`resolveTopOfStack`, `executeEffect`), `replay-prompt-cleanup.ts`, `effectProgramReplayMutationPersistence.ts`, `oracleIrTriggerExecution.ts` / `oracleIrSpellExecution.ts` (`isReplaying` early exit).

**Tests:** `stack-replay-accumulation.integration.test.ts`, `myrel-token-replay.integration.test.ts`, `resolve-top-of-stack.replay-side-effects.test.ts`, `server/tests/helpers/replayDivergence.ts`, `replay-divergence.guardrail.integration.test.ts`. Adopt opportunistically in socket integration tests that fully resolve an effect.

### 15.6 Generic choice primitives (D6 direction)

Server-side IR queues novel resolution steps faster than the client grows bespoke modals. Rather than mirroring each new `ResolutionStepType` with a new component, converge on generic primitives the client already renders — select-N-from-list (cards/permanents/players/options), order-list, yes/no, number pick — parameterized by the step payload. A new step kind should require **zero client work** unless it introduces a genuinely new interaction geometry.

### 15.7 Phase 5 ceiling

Continuous and replacement effects are the one class the step IR cannot express; they remain in scattered event-specific hooks. Design (declarative `StaticEffectSpec` / `ReplacementEffectSpec`, single replacement registry, derived-view statics): [oracle-ir-phase5-continuous-effects-design.md](./oracle-ir-phase5-continuous-effects-design.md).

---

## 16. Copy tokens, oracle hydration, and “except …” modifiers

~177 paper cards match `oracle:"copy of" oracle:"except"` on Scryfall — copies with replacements (nonlegendary, haste, P/T, colors, no mana cost, extra types). This is **generic oracle-driven behavior**, not per-card handlers.

### 16.1 Two token classes

| Class | Example | Oracle source |
|-------|---------|---------------|
| **Prototype token** | `Token Creature — Soldier` | Synthetic type line only; **no** full-card lookup |
| **Printed-card copy** | Helm of the Host, Feldon, Croaking Counterpart | Copy a real card; **must** hydrate `oracle_text` / abilities from `oracle-cards.json` or `lookupLocalCardByNameSync` |

Detection: `isCopyToken` / `isCopyOfPrintedCard` / type line does not start with `Token`.

### 16.2 Pipeline

```
effect or create_token.token hint (“copy of X, except …”)
  → extractCopyTokenExceptionFromEffect / splitCopyTokenReference (IR)
  → parseCopyTokenOverrides (shared/src/copyTokenOverrides.ts)
  → copy source card + hydrate if missing
  → applyCopyTokenOverrides
  → store permanent.copyTokenOverrides
  → reapplyStoredCopyTokenOverrides after later hydration (cardOracleHydration.ts)
```

**Canonical module:** `shared/src/copyTokenOverrides.ts` (+ `copyTokenUtils.ts` for `stripLegendaryFromTypeLine`).

**Server entry points:**

| Path | File |
|------|------|
| Equipment equipped-creature copy (Helm) | `oracleIrTriggerLegacyTokenHandlers.ts` → `createEquippedCreatureCopyTokenFromEquipment` |
| IR `create_token` copy steps | `oracleIRExecutorTokenStepHandlers.ts` → `createCopiedTokenPermanent` (imports shared parser) |
| Generic printed-card copies | `counters_tokens.ts` → `createCopyTokensOfCard(..., copyTokenOverrides?)` |
| Hydration safety net | `cardOracleHydration.ts` → `hydrateGameStateOracleText` at SBA / triggers / static sync |

### 16.3 Trigger effect text

Beginning-of-combat triggers must use **full oracle-derived** effect clauses (`timingTriggerEffect` / `extractTriggerEffectAfterPrefix`), not KNOWN-table shorthand. `detectBeginningOfCombatTriggers` in `triggered-abilities.ts` prefers oracle text over `KNOWN_BEGINNING_COMBAT_TRIGGERS` when both exist.

### 16.4 Tests

- `server/tests/copy-token-overrides.unit.test.ts` — Scryfall-style phrase matrix
- `server/tests/helm-of-the-host.begin-combat.test.ts` — nonlegendary + haste + hydration
- `server/tests/card-oracle-hydration.unit.test.ts` — hydrate + reapply overrides

### 16.5 Remaining work

- Retire `KNOWN_BEGINNING_COMBAT_TRIGGERS` shorthand where oracle detection suffices
- Audit IR-primary vs legacy fallback paths for the full Scryfall except-copy set
- Ensure all copy creation paths pass explicit `copyTokenOverrides` when effect text is available

---

*MTGEDH Oracle IR Architecture Guide — generated for contributor onboarding.*
