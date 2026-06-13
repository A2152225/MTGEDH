# MTGEDH Oracle IR Architecture & Execution Loop

**Version:** 2026-06-13 (step ledger Phases A–Z)  
**Repository:** MTGEDH  
**Audience:** Contributors working on card behavior, server integration, or migration off legacy handlers

---

## 1. Purpose

Oracle IR (Intermediate Representation) is the project's canonical pipeline for turning **oracle text** into **game state changes**. The end goal is a single path:

```
oracle text → parse → OracleEffectStep[] → execute → server sync → resolution UI → resume
```

Today this pipeline is **complete in the rules-engine** (Layers 1–2) and **partially integrated on the server** (Layer 3). Production runs IR-primary for spells, triggers, and activated abilities. Zone-affecting steps on the server path increasingly use a **pre-commit transition pipeline** and indexed **step ledger** for "this way" memory and replacement interception; legacy fallbacks still run when IR returns incomplete.

---

## 2. Three layers

| Layer | Location | Responsibility | Status |
|-------|----------|----------------|--------|
| **1 — Parse** | `rules-engine/src/oracleIRParser.ts` | `parseOracleTextToIR()` → `OracleEffectStep[]` | Green (~30k cards) |
| **2 — Execute** | `rules-engine/src/oracleIRExecutor.ts` | `applyOracleIRStepsToGameState()` dry-run | Green (triggers 100% assisted) |
| **3 — Integrate** | `server/src/state/modules/oracleIr*.ts` | Live state, queue prompts, resume, pre-commit transitions | Partial (step ledger wired) |

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
- `chosenObjectIds`, `targetPermanentId`, `xValue`
- `interactivePlayerChoices: true` on server
- **`stepLedger`** — `Map<stepIndex, RuntimeObjectSnapshot[]>` for "this way" reads (persisted on state as `oracleIrStepLedger` across resume)
- **`appliedStepKinds`** — tracks which step kind ran at each index
- **`currentStepIndex`** — set each main-loop iteration
- **`serverBridge`** — server-only; routes zone steps through `oracleIrTransitionPipeline.ts`
- **`transitionHaltState`** — deferred replacement choices halt execution until resolved

Runtime carry-over slots (`lastMovedCards`, `lastExiledCards`, etc.) remain for **dry-run / audit** paths without `serverBridge`. On server apply, bridged steps omit these after ledger commit (`skipLedgerFlush`).

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

**Post-Z (Phases AA–AN):** IR `LIBRARY_SEARCH` steps with `oracleIrChoiceStepJson` always resume through Oracle IR on `submitResolutionResponse` (split and single-destination). `librarySearchResolve` replay events emit when `persistLibrarySearchResolve` is set (split and non-split), including serialized step ledger for reconnect/replay. Cultivate-style `search_library` + `revealFound` binds and ledger-reads "revealed this way" antecedents for conditionals and where-X even after shuffle resume overwrites `appliedStepKinds`. "Searched library this way" conditionals use the same ledger fallback. Legacy tutor handlers skip when an IR-bridged library search is already queued. IR-bridged `SCRY` / `SURVEIL` steps attach `oracleIrChoiceStepJson`, resume IR after zone apply, continue compound steps, and persist ledger fields on `scryResolve` / `surveilResolve` replay events. Compound `scry` + `draw` spells (e.g. Opt) resume the draw through `oracleIrResumeStepsJson` after scry resolves; `resolveTopOfStack` on Opt queues the same IR scry path. Surveil compound + replay parity matches scry; Consider stack-resolve E2E completes the same way. Opt stack resolve persists `scryResolve` ledger for replay and scry-this-way where-X reads. Compound resume preserves absolute step indices (`scry` at 0, `draw` at 1) via `currentStepIndex` base offset and `resolveOracleIrChoiceStepIndex` / `resolveOracleIrContinuationStepIndex`; ledger snapshots for scry/surveil resolve events are taken before compound continuation runs. Consider `surveilResolve` ledger replay supports revealed-this-way reads; `oracleIrResumeStepsJson` is persisted on compound resolve events and restored as `oracleIrPendingResumeStepsJson` for `resumeOracleIrPendingCompoundStepsFromState` after reconnect. `processPendingOracleIrCompoundResume` auto-finishes pending compound steps after replay and on reconnect (join / stack resolve / resolution-step request). Auto-resume appends `drawCards` events (`oracleIrCompoundResume`) for event-log determinism; `drawCards` replay clears pending resume to avoid double-draw.

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

## 12. Verification

```powershell
cd server
npm run test:oracle-ir-migration    # 651 tests, production defaults

cd ../rules-engine
npx vitest run test/oracleIRStepLedger.test.ts test/oracleIRLedgerReferenceConvergence.test.ts test/oracleIRScrySurveilLedger.test.ts  # ledger smoke

cd ../server
npm run trigger:coverage              # detection gaps
npm run executor:coverage             # dry-run execution
```

---

*MTGEDH Oracle IR Architecture Guide — generated for contributor onboarding.*
