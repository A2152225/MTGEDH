# Oracle IR Step Ledger & Pre-Commit Transition Migration

**Version:** 2026-06-13  
**Status:** Complete (Phases A–Z). **Post-Z compound-spell hardening complete** (Phases AA–BB).
**Audience:** Contributors eliminating Layer 2/3 legacy fallbacks for "this way" memory, replacement effects, and static ETB rules

**Companion docs:**
- [oracle-ir-architecture-guide.md](./oracle-ir-architecture-guide.md) — three-layer overview
- [oracle-ir-server-migration-plan.md](./oracle-ir-server-migration-plan.md) — full Layer 3 supersession plan
- `.cursor/rules/oracle-ir-no-bespoke-handlers.mdc` — no card-name routing

---

## 1. Problem statement

Three patterns cause IR execution to return `handled: false` and fall into 31 legacy modules:

| Pattern | Symptom | Example |
|---------|---------|---------|
| **"This way" memory** | Later steps lose traits of objects moved earlier | Greatest power among creatures exiled this way (Astarion's Thirst) |
| **Replacement interception** | Zone changes commit before replacement rules run | Lotus Vale sacrifice-instead |
| **Static entry rules** | ETB modifiers only run on stack-resolve, not IR paths | Enters tapped (Authority of the Consuls) |

**Root cause:** `lastExiledCards` / `lastMovedCards` on `OracleIRExecutionContext` are single-slot, unindexed, and not snapshotted at pre-move time. Server `applyOracleIRStepsOnServer` calls `applyOracleIRStepsToGameState` which commits zones immediately without `replacement-effects.ts`.

---

## 2. Target architecture

```
oracle text → parse → OracleEffectStep[]
    → applyOracleIRStepsToGameState (step loop)
         ├─ proposeTransitions()     ← step handlers emit pending events
         ├─ interceptTransitions()   ← evaluateReplacementEvent (server)
         ├─ commitTransitions()      ← mutate state + merge stepLedger
         └─ resolveThisWayTrait()    ← later steps read stepLedger[antecedentIndex]
    → applyOracleIRStepsOnServer (queue bridges, zone sync)
```

**Invariant:** Multi-step effects remain all-or-nothing (`oracleIrStepWiring.ts`). Deferred replacement choices halt execution and queue resolution prompts.

---

## 3. Core types

Location: `rules-engine/src/oracleIRTransitionTypes.ts`

| Type | Purpose |
|------|---------|
| `RuntimeObjectSnapshot` | Immutable trait bundle at transition proposal time (LKI) |
| `RuntimeObjectZone` | Zone at snapshot time |
| `OracleIRTransitionKind` | `zone-change`, `battlefield-entry`, `damage`, etc. |
| `OracleIRPendingTransition` | Proposed mutation before commit |
| `ThisWayReference` | Parser-bound antecedent + trait + aggregation |
| `OracleIRServerExecutionBridge` | Server injection point for pre-commit pipeline |

Extended on `OracleIRExecutionContext`:

```typescript
readonly stepLedger: ReadonlyMap<number, readonly RuntimeObjectSnapshot[]>;
readonly currentStepIndex?: number;
readonly serverBridge?: OracleIRServerExecutionBridge;
```

---

## 4. Step ledger semantics

- **Key:** `stepIndex` (0-based index in the current `OracleEffectStep[]` program).
- **Value:** `RuntimeObjectSnapshot[]` — all objects whose characteristics were frozen when that step *proposed* affecting them.
- **Capture timing:** Before zone commit (while creature still on battlefield for P/T).
- **Immutability:** Append-only per step index; never mutate existing entries.
- **Resume:** Persist `oracleIrStepLedger` on game state across resolution prompts.

### Snapshot factory

`rules-engine/src/oracleIRSnapshotFactory.ts` — `snapshotObjectAtZone()` reuses `createLastKnownPermanentSnapshot` for battlefield objects.

### This-way resolver

`rules-engine/src/oracleIRThisWayResolver.ts` — `resolveThisWayTrait(ref, ctx)` reads `stepLedger.get(antecedentStepIndex)` with optional type/zone filters.

Parser field: `OracleEffectStep.thisWayAntecedentStepIndex` (bound by `oracleIRThisWayBinding.ts` for common multi-clause patterns). Fallback: `findAntecedentStepIndex(ctx, kind, beforeIndex)` scans backward.

---

## 5. Pre-commit transition pipeline

Location: `server/src/state/modules/oracleIrTransitionPipeline.ts`

```
Step handler
    → build*Transitions() / proposeBattlefieldEntryTransition()
    → interceptOracleIRTransitions(state, transitions)
         → evaluateReplacementEvent() per transition
         → applyReplacementToTransition() if applied
    → commitOracleIRTransitions(ctx, state, ready, ledger)
```

### Transition kinds requiring pre-commit (Phase B+)

| Step kind | Transition type |
|-----------|-----------------|
| `exile`, `destroy`, `sacrifice` | `zone-change` |
| `exile_top`, `impulse_exile_top` | `zone-change` |
| `move_zone`, `discard`, `mill` | `zone-change` |
| `create_token`, `copy_permanent` | `battlefield-entry` |
| `deal_damage` | `damage` |
| `draw` | `card-draw` |
| `add_counter` | `counter-placement` |
| `look_top`, `reveal_top` | `zone-change` (observation) |
| `scry`, `surveil` | `zone-change` (observation; choice-deferred flush) |

### Battlefield entry (static ETB)

`rules-engine/src/oracleIRBattlefieldEntryProposal.ts` — generic oracle-text patterns only:

- Self: `detectETBTappedPattern(oracle_text) === 'always'`
- Opponent control: `detectOpponentEntersTappedFromBattlefield()` — replaces card-name table in `triggerPermanentEntersTapped.ts`

Converge stack-resolve (`stackResolvePermanentEntryUtils.ts`) to call the same proposal helper.

---

## 6. Server apply loop changes

`applyOracleIRStepsOnServer` (`oracleIrServerZoneSync.ts`):

1. Initialize `ledger` from `irCtx.stepLedger` or empty `Map`.
2. Build `serverBridge` with `proposeTransitions` → intercept → commit.
3. Pass `{ ...irCtx, stepLedger: ledger, serverBridge }` to `applyOracleIRStepsToGameState`.
4. Persist `state.oracleIrStepLedger = ledger` for resume.

Dry-run / audit callers omit `serverBridge`; ledger still populated via direct step mutations.

---

## 7. Executor main loop changes

`oracleIRExecutorMainLoop.ts`:

1. Set `currentCtx.currentStepIndex = stepIndex` each iteration.
2. After zone-affecting steps, call `recordCardsToStepLedger()` to snapshot moved cards.
3. When `serverBridge` present, zone steps call `proposeTransitions` instead of direct mutation.
4. **Phase J:** `onApplied` receives `sanitizeBridgedStepCarryOver(result)` — when `skipLedgerFlush` is set (bridge pre-recorded ledger), strip `lastExiledCards` / `lastDiscardedCards` / `lastMilledCards` / `lastSacrificedPermanents` before updating `currentCtx` carry-over slots. `lastMovedCards` / `lastRevealedCards` are restored after sanitize so Warp World reveal→put keeps per-owner piles (omitting `lastMovedCards` reused shuffle leftovers and dropped shared Scryfall ids).

**Bridged carry-over helpers** (`oracleIRStepLedgerRuntime.ts`):

| Helper | When |
|--------|------|
| `omitBridgedStepCarryOver` | Handler sets `skipLedgerFlush` after bridge commit |
| `sanitizeBridgedStepCarryOver` | Main-loop `onApplied` — strips if `skipLedgerFlush` already on result |
| `bridgedZoneStepResult` | Zone handlers when `serverBridge` + `currentStepIndex` present |

**Interim bridge (Phase A–I):** Record ledger from `lastExiledCards` / `lastMovedCards` in `onApplied` callbacks while transition builders land in Phase B+.

---

## 8. Rollout phases

| Phase | Deliverable | Verification |
|-------|-------------|--------------|
| **A** | Types, snapshot factory, this-way resolver, ledger recording in main loop, modify_pt reads | `rules-engine/test/oracleIRStepLedger.test.ts` |
| **B** | Pre-commit `finalizeBattlefieldRemoval` bridge on destroy/exile/sacrifice; deferred replacement queue | `rules-engine/test/oracleIRZoneTransitionBridge.test.ts` |
| **C** | `resolveBattlefieldEntryModifiers` on create_token / move_zone → battlefield | `rules-engine/test/oracleIRBattlefieldEntry.test.ts` |
| **D** | Server bridge wired on server apply path; migration suite green | `npm run test:oracle-ir-migration` |
| **E** | Parser `thisWayAntecedentStepIndex`; ledger reads for discard/exile this-way counts | `rules-engine/test/oracleIRThisWayBinding.test.ts` |
| **F** | Pre-commit bridge for `discard` / `mill` hand→graveyard and library→graveyard | `rules-engine/test/oracleIRCardZoneTransitionBridge.test.ts` |
| **G** | Pre-commit bridge for `draw` (`card-draw`) and `deal_damage` (`damage`) | `rules-engine/test/oracleIRDrawTransitionBridge.test.ts`, `oracleIRDamageTransitionBridge.test.ts` |
| **H** | Non-battlefield `move_zone` zone-change bridge; `add_counter` counter-placement bridge | `rules-engine/test/oracleIRMoveZoneTransitionBridge.test.ts`, `oracleIRCounterPlacementBridge.test.ts` |
| **I** | Ledger-first "this way" reads; skip duplicate flush when bridge pre-recorded | `rules-engine/test/oracleIRLedgerShimRetirement.test.ts` |
| **J** | Bridged paths set `skipLedgerFlush` and omit runtime carry-over arrays; main loop sanitizes before ctx update | `rules-engine/test/oracleIRLedgerShimRetirement.test.ts` (omit/sanitize tests) |
| **K** | `exile_top` / `impulse_exile_top` library→exile pre-commit; sacrifice `lastSacrificedPermanents` carry-over retirement; ledger-first conditional "it was a …" reads | `rules-engine/test/oracleIRExileTopTransitionBridge.test.ts` |
| **L** | Ledger-first reads in `oracleIRExecutorConditionalStepSupportExtended` and `oracleIRExecutorSpecialTargetHandlers` | `rules-engine/test/oracleIRLedgerShimRetirement.test.ts` (extended conditional test) |
| **M** | Ledger-first reads in `oracleIRExecutorConditionalStepSupport`; migration doc + architecture guide closure | `rules-engine/test/oracleIRLedgerShimRetirement.test.ts` (wrapper conditional test) |
| **N** | `look_select_top` library→hand/graveyard pre-commit bridge; flush zone resolution for look/reveal steps; `lastMovedCards` carry-over on chosen cards | `rules-engine/test/oracleIRLookSelectTransitionBridge.test.ts` |
| **O** | `look_select_top` player-choice path bridged via shared `chosenObjectIds`; `look_choose_from_top` library→hand/exile pre-commit bridge | `rules-engine/test/oracleIRLookSelectTransitionBridge.test.ts`, `oracleIRLookChooseTransitionBridge.test.ts` |
| **P** | `look_top` / `reveal_top` ledger flush on server path (library-zone snapshots); `look_select_top` `library_top` pre-commit bridge; post-commit rest handling fix | `rules-engine/test/oracleIRLookRevealLedger.test.ts`, `oracleIRLookSelectTransitionBridge.test.ts` |
| **Q** | `search_library` library→hand/exile/graveyard/top/bottom pre-commit bridge; `lastMovedCards` carry-over; main-loop ctx update | `rules-engine/test/oracleIRSearchLibraryTransitionBridge.test.ts` |
| **R** | `search_library` → `battlefield` ETB pre-commit bridge; player-choice search path; battlefield flush zone mapping | `rules-engine/test/oracleIRSearchLibraryTransitionBridge.test.ts` |
| **S** | `exile_named_cards_from_zones` multi-zone→exile pre-commit bridge; `lastExiledCards` carry-over; main-loop ctx update | `rules-engine/test/oracleIRExileNamedTransitionBridge.test.ts` |
| **T** | Ledger reference convergence — `acquireStepLedgerForExecution` reuses `ctx.stepLedger` so flush + bridge share one Map | `rules-engine/test/oracleIRLedgerReferenceConvergence.test.ts` |
| **U** | `scry` / `surveil` library-top observation ledger on choice-deferred path; ledger-first scry where-X / for-each reads | `rules-engine/test/oracleIRScrySurveilLedger.test.ts` |
| **V** | `look_select_top` rest-of-library moves via `commitLookSelectRestZoneChanges` (graveyard + library reorder on server bridge) | `rules-engine/test/oracleIRLookSelectTransitionBridge.test.ts` |
| **W** | Split-destination `search_library` (Cultivate / Kodama's Reach) — `inferSplitLibrarySearchPlan` + bridged hand/ETB commits; resolution resumes via IR when `splitAssignments` present | `rules-engine/test/oracleIRSplitSearchLibraryTransitionBridge.test.ts` |
| **X** | `look_choose_from_top` rest-of-library → library bottom via `commitLookSelectRestZoneChanges` (`restLibraryPlacement: 'bottom'`); Kodama split-search E2E resolution test | `rules-engine/test/oracleIRLookChooseTransitionBridge.test.ts`, `server/tests/kodama-reach-oracle-ir-library-search.integration.test.ts` |
| **Y** | Antecedent kind alias expansion (`look` → `look_*` / `reveal_*`); `look_choose` / `look_select` rest-only bridge when no cards chosen | `rules-engine/test/oracleIRThisWayBinding.test.ts`, `oracleIRLookChooseTransitionBridge.test.ts` |
| **Z** | `commitLibraryTopObservation` pre-commit bridge for `look_top` / `reveal_top` / choice-deferred `scry` / `surveil`; split-search early-return on successful IR resume + `librarySearchResolve` persist when `persistLibrarySearchResolve` | `rules-engine/test/oracleIRLookRevealLedger.test.ts`, `oracleIRScrySurveilLedger.test.ts`, `server/tests/kodama-reach-oracle-ir-library-search.integration.test.ts`, `cultivate.library-search-replay.integration.test.ts` |
| **AA** | Generalize IR `LIBRARY_SEARCH` resume for any `oracleIrChoiceStepJson` (not split-only); `librarySearchResolve` persist on IR success; `search_library` binds "revealed this way"; cultivate replay in migration suite | `rules-engine/test/oracleIRThisWayBinding.test.ts`, `server/tests/kodama-reach-oracle-ir-library-search.integration.test.ts`, `server/tests/cultivate.library-search-replay.integration.test.ts` |
| **AB** | Skip legacy tutor enqueue whenever IR-bridged `LIBRARY_SEARCH` already queued (spell-primary-independent); "searched library this way" antecedent binding; cultivate queue-shape assertions + Kodama replay parity | `rules-engine/test/oracleIRThisWayBinding.test.ts`, `server/tests/cultivate.library-search-replay.integration.test.ts`, `server/tests/kodama-reach-oracle-ir-library-search.integration.test.ts` |
| **AC** | Ledger-first "revealed this way" reads include `search_library`; non-split IR `librarySearchResolve` socket persist + replay; `REVEALED_THIS_WAY_ANTECEDENT_KINDS` shared constant | `rules-engine/test/oracleIRThisWayBinding.test.ts`, `server/tests/oracle-ir-search-library.integration.test.ts` |
| **AD** | Ledger-first "searched library this way" conditionals via `SEARCHED_THIS_WAY_ANTECEDENT_KINDS`; conditional handler passes bound step; socket step-ledger parity on non-split search | `rules-engine/test/oracleIRThisWayBinding.test.ts`, `server/tests/oracle-ir-search-library.integration.test.ts` |
| **AE** | `librarySearchResolve` persists `oracleIrStepLedger` + `oracleIrAppliedStepKinds`; `applyEvent` restores ledger on replay for follow-up compound effects | `rules-engine/test/oracleIRStepLedger.test.ts`, `server/tests/cultivate.library-search-replay.integration.test.ts`, `server/tests/kodama-reach-oracle-ir-library-search.integration.test.ts`, `server/tests/oracle-ir-search-library.integration.test.ts` |
| **AF** | `isSearchedLibraryThisWayLedgerFirst` ledger-snapshot fallback when shuffle resume overwrites `appliedStepKinds`; live + replay compound conditional parity (Cultivate) | `rules-engine/test/oracleIRThisWayBinding.test.ts`, `server/tests/cultivate.library-search-replay.integration.test.ts` |
| **AG** | `isRevealedThisWayLedgerFirst` + extended conditional ledger reads; Cultivate live/replay `where X is the number of cards revealed this way` parity | `rules-engine/test/oracleIRThisWayBinding.test.ts`, `server/tests/cultivate.library-search-replay.integration.test.ts` |

### Post-migration notes

- **Server apply** (`serverBridge` present): zone steps propose transitions → replacement intercept → ledger commit; bridged paths set `skipLedgerFlush` and omit runtime carry-over arrays. The executor reuses `ctx.stepLedger` (same Map as `serverBridge`) via `acquireStepLedgerForExecution`.
- **Dry-run / audit** (no `serverBridge`): handlers may still populate `lastMovedCards` on results; main-loop flush records ledger from those fields.
- **New step kinds** with zone memory: add pre-commit bridge + `resolveAntecedent*` read via `oracleIRLedgerCardAccess.ts`; never add card-name routing.
- **This-way aliases:** `expandAntecedentStepKinds` maps abstract kinds (`look`, `reveal`, `exile`, …) to concrete step kinds for parse-time binding and runtime `appliedStepKinds` scans.
- **Library observation:** `commitLibraryTopObservation` records look/reveal/scry/surveil snapshots at proposal time without mutating zones.
- **Docs:** [oracle-ir-architecture-guide.md](./oracle-ir-architecture-guide.md) synced through Phase AN (step ledger section, context fields, verification).
- **Split search:** Multi-destination `search_library` uses `inferSplitLibrarySearchPlan` + `splitAssignments` in selector context; `handleLibrarySearchResponse` resumes IR when `oracleIrChoiceStepJson` is present. Split tutors always defer to player choice (even when `matches.length <= maxResults`) so uncategorized spell fallback cannot auto-apply lands before the resolution queue opens.
- **IR library search resume:** Any queued `LIBRARY_SEARCH` with `oracleIrChoiceStepJson` resumes via IR on response (split and non-split); legacy zone mutation is skipped when `search_library` applies. `librarySearchResolve` events persist on IR success when `persistLibrarySearchResolve` is set.
- **Revealed this way:** `search_library` (e.g. Cultivate reveal clause) binds antecedents for follow-up "revealed this way" steps alongside look/scry/surveil aliases.
- **Searched library this way:** `SEARCHED_THIS_WAY_ANTECEDENT_KINDS` drives ledger-first conditional evaluation (`isSearchedLibraryThisWayLedgerFirst`) alongside `searchedLibraryThisWay` runtime flag.
- **Legacy tutor guard:** `applyInstantSorceryLibrarySearchSpellHandlers` skips duplicate legacy enqueue when an IR-bridged `LIBRARY_SEARCH` step (`oracleIrChoiceStepJson`) is already queued — regardless of `ORACLE_IR_SPELL_PRIMARY`.
- **Revealed-this-way ledger reads:** `REVEALED_THIS_WAY_ANTECEDENT_KINDS` (`look`, `reveal`, `scry`, `surveil`, `search_library`) drives ledger-first where-X / for-each evaluators.
- **Non-split persist fix:** IR early-return `librarySearchResolve` persist guards `createdPermanentIds` when destination is `hand` (undefined battlefield ids must not throw inside the silent try/catch).
- **Step-ledger replay:** `librarySearchResolve` events include serialized `oracleIrStepLedger` / `oracleIrAppliedStepKinds`; `applyEvent` restores them so compound follow-ups can read "this way" memory after reconnect/replay. Ledger snapshot is taken after IR search resume and before compound `maybeResumeOracleIRStepsAfterResolution` so shuffle resume does not overwrite `search_library` in the persisted event.
- **Bridged applied kinds:** `trackAppliedStepKind` runs on every successful handler apply even when `skipLedgerFlush` is set (server-bridge paths previously skipped both).
- **Searched-library ledger fallback:** When compound resume overwrites `appliedStepKinds` with `shuffle_library`, `isSearchedLibraryThisWayLedgerFirst` still returns true if the step ledger has snapshots at the parser-bound search antecedent index.
- **Revealed-this-way ledger fallback:** `isRevealedThisWayLedgerFirst` / `collectRevealedThisWayCardsLedgerFirst` drive extended conditional reads and where-X counts from ledger when shuffle overwrote applied kinds.
- **Scry/surveil IR resume (Phase AH):** `queueTopLibraryChoicePromptsFromOracleIRResult` attaches `oracleIrChoiceStepJson`, persist flags, and controller/source metadata. `handleScryResponse` / `handleSurveilResponse` resume IR after zone apply, continue compound steps via `maybeResumeOracleIRStepsAfterResolution`, and persist ledger fields on `scryResolve` / `surveilResolve` events. `applyScryStep` / `applySurveilStep` complete with `scryResolutionComplete` / `surveilResolutionComplete` selector context (zones already applied by socket handler).
- **Compound scry→draw (Phase AI):** Queued `SCRY` steps carry `oracleIrResumeStepsJson` for trailing `draw`; socket `submitResolutionResponse` applies scry zones, resumes the halted scry step, then `maybeResumeOracleIRStepsAfterResolution` draws. Kodama split-search live/replay asserts `isSearchedLibraryThisWayLedgerFirst` + conditional evaluation parity (Cultivate-style, without reveal clause).
- **Stack-resolve E2E (Phase AJ):** `resolveTopOfStack` on Opt (`Scry 1. Draw a card.`) queues IR-bridged scry with compound `draw` resume; socket scry response completes the spell. Surveil compound `surveil` + `draw` and `surveilResolve` ledger persist/replay mirror scry coverage.
- **Consider + ledger replay (Phase AK):** `resolveTopOfStack` on Consider (`Surveil 1. Draw a card.`) mirrors Opt stack path. Opt stack resolve persists `scryResolve` ledger through the full spell chain; replay restores ledger and answers scry-this-way where-X (`looked at while scrying this way` → 1).
- **Compound step-index continuity (Phase AK fix):** `applyOracleIRStepsToGameStateImpl` honors `ctx.currentStepIndex` as a base offset so resumed `draw` records at index 1 after `scry` at 0. `resolveOracleIrChoiceStepIndex` / `resolveOracleIrContinuationStepIndex` in `oracleIrTransitionPipeline.ts` pick the correct absolute index when completing halted library choices vs resuming trailing steps.
- **Scry/surveil ledger snapshot timing (Phase AK fix):** `handleScryResponse` / `handleSurveilResponse` persist ledger fields captured after IR choice resume and **before** `maybeResumeOracleIRStepsAfterResolution` (compound draw must not overwrite `scry` / `surveil` in the `scryResolve` / `surveilResolve` event).
- **Consider surveilResolve ledger replay (Phase AL):** Consider stack resolve persists `surveilResolve` ledger + `oracleIrResumeStepsJson`; replay restores ledger and answers revealed-this-way where-X (`revealed this way` → 1).
- **Compound reconnect resume (Phase AL):** `scryResolve` / `surveilResolve` events persist `oracleIrResumeStepsJson` (+ controller/source metadata) alongside ledger fields; `applyEvent` restores `oracleIrPendingResumeStepsJson` on state; `resumeOracleIrPendingCompoundStepsFromState` completes trailing `draw` after reconnect/replay.
- **Auto compound resume (Phase AM):** `processPendingOracleIrCompoundResume` / `processPendingOracleIrCompoundResumeOnContext` finish pending compound IR steps after `replay()` completes and on `joinGame` / stack-resolve / `requestResolutionStep` paths (alongside existing `processPendingScry` migration). Trigger-queued compound scry (`Scry 1. Draw a card.`) carries `oracleIrResumeStepsJson` on the resolution step.
- **drawCards event persist (Phase AN):** `persistOracleIrCompoundResumeDrawCardsEvent` appends `drawCards` with `oracleIrCompoundResume: true` when auto-resume applies trailing draw steps; `applyEvent(drawCards)` clears `oracleIrPendingResume*` so full replay (`scryResolve` + `drawCards`) does not double-draw. `finalizeGameStateAfterReplay` runs after replay auto-resume and clears orphan pending-resume transient state.
- **Trigger compound socket E2E (Phase AN):** Trigger `Scry 1. Draw a card.` resolves via socket with `scryResolve` + `oracleIrResumeStepsJson` persist; replay auto-resumes draw and appends `drawCards`.
- **Live socket drawCards persist (Phase AO):** `handleScryResponse` / `handleSurveilResponse` append `drawCards` with `oracleIrCompoundResume: true` and `drawnCardIds` immediately after compound `maybeResumeOracleIRStepsAfterResolution` when `persistOracleIrScryResolve` / `persistOracleIrSurveilResolve` is set (mirrors reconnect auto-resume path).
- **drawnCardIds replay (Phase AO):** `drawCardsByIds` in `applyEvent(drawCards)` honors optional `drawnCardIds` for library-order-independent compound draw replay. `collectOracleIrCompoundDrawnCardIds` snapshots new hand cards after compound resume.
- **Trigger surveil compound socket E2E (Phase AO):** Trigger `Surveil 1. Draw a card.` live socket persists `surveilResolve` + `drawCards` with `drawnCardIds`; full replay restores hand/graveyard deterministically.
- **Unconditional compound drawCards persist (Phase AP):** `handleScryResponse` / `handleSurveilResponse` append `drawCards` whenever compound `maybeResumeOracleIRStepsAfterResolution` applies a draw — not only when `persistOracleIrScryResolve` / `persistOracleIrSurveilResolve` ledger flags are set.
- **Consider stack replay E2E (Phase AP):** Consider stack resolve persists live `drawCards` + `drawnCardIds`; full `surveilResolve` + `drawCards` replay uses id-based draw with shuffled library order.
- **Resolution queue replay suppression (Phase AP):** `ResolutionQueueManager.beginReplay` / `endReplay` suppress step enqueue during `replay()`; `finalizeGameStateAfterReplay` clears replay-transient queue state.
- **Opt stack shuffled-library replay (Phase AQ):** Opt stack socket persists live `scryResolve` + `drawCards` with `drawnCardIds`; full replay with reversed library order uses id-based draw.
- **Auto-resume drawnCardIds parity (Phase AQ):** `processPendingOracleIrCompoundResume` and `replay()` auto-resume append `drawCards` with `drawnCardIds` matching live socket compound resolve.
- **Replay cleanup in migration suite (Phase AQ):** `replay-resume-prompt-cleanup.unit.test.ts` wired into `npm run test:oracle-ir-migration`.
- **Chart a Course stack E2E (Phase AR):** `resolveTopOfStack` on Chart a Course under `ORACLE_IR_SPELL_PRIMARY` draws two cards synchronously, queues `DISCARD_SELECTION` when controller did not attack (`attackedPlayersThisTurnByPlayer` empty), and skips discard when controller attacked this turn; socket discard response completes the spell.
- **Architecture guide sync (Phase AR):** `oracle-ir-architecture-guide.md` Post-Z section updated through Phase AQ + Chart a Course stack coverage.
- **Library-search compound draw persist (Phase AS):** `handleLibrarySearchResponse` mirrors scry/surveil compound path — `persistOracleIrCompoundDrawAfterResolution`, `oracleIrResumeStepsJson` on `librarySearchResolve`, `remainingLibraryIds` snapshot **before** compound resume; `applyEvent(librarySearchResolve)` restores pending compound resume. Compound trailing steps persist as source events (`drawCards` + `drawnCardIds`, `shuffleLibrary` + `shuffledLibraryIds`).
- **Library-search compound draw stack E2E (Phase AS):** Stack spell (`search_library` + `If you searched your library this way, draw a card.`) completes via socket; `librarySearchResolve` + `drawCards` replay uses `drawnCardIds`.
- **Chart a Course discard prompt replay (Phase AS):** IR-bridged `DISCARD_SELECTION` steps emit `resolveTopOfStackPrompt`; replay restores queued discard with post-draw hand snapshot.
- **Library-search compound reconnect (Phase AT):** `librarySearchResolve` persists `oracleIrResumeStepsJson`; `applyEvent` + `resumeOracleIrPendingCompoundStepsFromState` / `replay()` auto-resume complete conditional draw after reconnect (parity with Opt/Consider scry/surveil).
- **Big Score stack E2E (Phase AT):** `resolveTopOfStack` on Big Score under IR primary draws three synchronously and creates two Treasure tokens.
- **joinGame compound resume (Phase AU):** `joinGame` calls `processPendingOracleIrCompoundResume` to finish library-search conditional draw after `librarySearchResolve` reconnect state (parity with Consider `processPendingOracleIrCompoundResume` path).
- **Wheel stack E2E (Phase AU):** `resolveTopOfStack` on Reforge the Soul and Windfall under IR primary discards each hand and draws the correct number of cards per player.
- **joinGame scry compound resume (Phase AV):** `joinGame` finishes Opt compound draw from `scryResolve` pending resume state (parity with library-search join path).
- **Echo of Eons stack E2E (Phase AV):** `resolveTopOfStack` shuffles each player's hand and graveyard into their library, then draws seven.
- **joinGame surveil compound resume (Phase AW):** `joinGame` finishes Consider compound draw from `surveilResolve` pending resume state (parity with Opt scry and library-search join paths).
- **Inspiring Call stack E2E (Phase AW):** `resolveTopOfStack` draws per +1/+1 creature and grants indestructible until end of turn under IR primary.
- **Chart a Course joinGame discard reconnect (Phase AX):** `resolveTopOfStackPrompt` replay restores IR-bridged `DISCARD_SELECTION`; `joinGame` re-emits `resolutionStepPrompt` and socket discard completes the spell.
- **Scry-2 compound stack E2E (Phase AY):** Preordain `resolveTopOfStack` queues IR scry 2 with compound draw resume; socket scry response completes via `drawCards` + `drawnCardIds`.
- **Draw-then-scry stack E2E (Phase AY):** Serum Visions (oracle: draw first, scry 2) draws synchronously then queues trailing IR scry without compound draw resume on the scry step.
- **joinGame scry-2 compound resume (Phase AZ):** `joinGame` finishes Preordain compound draw from `scryResolve` pending resume state (parity with Opt scry-1 join path).
- **Serum Visions joinGame scry reconnect (Phase BA):** `resolveTopOfStackPrompt` replay restores trailing scry after synchronous draw; `joinGame` re-emits `resolutionStepPrompt` and socket scry completes the spell.
- **Compound-spell E2E matrix (Phase BA):** `oracle-ir-architecture-guide.md` §12 documents stack/replay/reconnect/join coverage per spell pattern and remaining gaps.
- **IR scry/surveil prompt persist (Phase BA):** `queueTopLibraryChoicePromptsFromOracleIRResult` appends `resolveTopOfStackPrompt` for IR-bridged scry/surveil (parity with discard); enables Serum Visions joinGame reconnect and full replay of trailing library-top prompts.
- **Opt/Consider prompt replay E2E (Phase BB):** `resolveTopOfStackPrompt` replay restores queued IR scry/surveil with compound `oracleIrResumeStepsJson` before socket response.
- **Post-Z wrap-up (Phase BB):** compound-spell reconnect matrix in architecture guide §12; non-blocking gaps limited to wheel/token reconnect E2E.

---

## Post-Z compound-spell hardening (Phases AA–BB) — complete

Post-Z work hardened **compound spell** stack resolve, event-log persistence, replay, reconnect, and `joinGame` resume for IR-bridged scry/surveil/library-search/discard prompts. Primary integration coverage lives in `server/tests/oracle-ir-scry-surveil.integration.test.ts` (43 tests in that file; 701 in `npm run test:oracle-ir-migration`). See `docs/oracle-ir-architecture-guide.md` §12 for the spell-pattern matrix.

**Non-blocking follow-ups (outside Post-Z scope):** wheel/token compound reconnect E2E; broader executor/trigger coverage audits per `npm run executor:coverage` / `npm run trigger:coverage`.

---

## 9. File map

| Action | Path |
|--------|------|
| **Reference** | `docs/oracle-ir-step-ledger-migration.md` (this file) |
| **Types** | `rules-engine/src/oracleIRTransitionTypes.ts` |
| **Snapshot** | `rules-engine/src/oracleIRSnapshotFactory.ts` |
| **Ledger helpers** | `rules-engine/src/oracleIRStepLedger.ts` |
| **This-way resolver** | `rules-engine/src/oracleIRThisWayResolver.ts` |
| **This-way binding** | `rules-engine/src/oracleIRThisWayBinding.ts` |
| **Server bridge iface** | `rules-engine/src/oracleIRServerBridge.ts` |
| **ETB proposal** | `rules-engine/src/oracleIRBattlefieldEntryProposal.ts` |
| **ETB commit** | `rules-engine/src/oracleIRExecutorBattlefieldEntryCommit.ts` |
| **ETB counters detect** | `rules-engine/src/oracleIRDetectEntersWithCounters.ts` |
| **Context** | `rules-engine/src/oracleIRExecutionTypes.ts` |
| **Main loop** | `rules-engine/src/oracleIRExecutorMainLoop.ts` |
| **Modify PT** | `rules-engine/src/oracleIRExecutorModifyPtWhereExileAndCardStats.ts` |
| **Server pipeline** | `server/src/state/modules/oracleIrTransitionPipeline.ts` |
| **Server apply** | `server/src/state/modules/oracleIrServerZoneSync.ts` |
| **Converge (Phase C)** | `server/src/state/modules/triggerPermanentEntersTapped.ts` |
| **Card zone commit** | `rules-engine/src/oracleIRExecutorCardZoneTransitionCommit.ts` |
| **Draw commit** | `rules-engine/src/oracleIRExecutorDrawTransitionCommit.ts` |
| **Damage intercept** | `rules-engine/src/oracleIRExecutorDamageTransitionCommit.ts` |
| **Counter commit** | `rules-engine/src/oracleIRExecutorCounterPlacementCommit.ts` |
| **Ledger runtime** | `rules-engine/src/oracleIRStepLedgerRuntime.ts` |
| **Ledger card access** | `rules-engine/src/oracleIRLedgerCardAccess.ts` |
| **Effect builders** | `rules-engine/src/oracleIRExecutorEffectTransitionBuilders.ts` |
| **Tests** | `rules-engine/test/oracleIRStepLedger.test.ts`, `oracleIRZoneTransitionBridge.test.ts`, `oracleIRBattlefieldEntry.test.ts`, `oracleIRThisWayBinding.test.ts`, `oracleIRCardZoneTransitionBridge.test.ts`, `oracleIRMoveZoneTransitionBridge.test.ts`, `oracleIRCounterPlacementBridge.test.ts` |

---

## 10. Adding behavior (required pattern)

1. **Parser** — if step contains "this way", set `thisWayAntecedentStepIndex` when antecedent is unambiguous.
2. **Handler** — emit `OracleIRPendingTransition[]` with `snapshotSubjects` before commit.
3. **Server** — route through `interceptOracleIRTransitions` → `commitOracleIRTransitions`.
4. **Resolver** — use `resolveThisWayTrait` in amount/where-X evaluators, not `lastExiledCards`.
5. **Test** — assert outcomes via ledger reads, not legacy handler execution.

**Forbidden:** card-name checks, new `KNOWN_*` rows, scanning full oracle text in isolated trigger execution.

---

## 11. Verification

```powershell
cd rules-engine
npx vitest run test/oracleIRStepLedger.test.ts test/oracleIRZoneTransitionBridge.test.ts test/oracleIRBattlefieldEntry.test.ts test/oracleIRThisWayBinding.test.ts test/oracleIRCardZoneTransitionBridge.test.ts test/oracleIRDrawTransitionBridge.test.ts test/oracleIRDamageTransitionBridge.test.ts test/oracleIRMoveZoneTransitionBridge.test.ts test/oracleIRCounterPlacementBridge.test.ts test/oracleIRLedgerShimRetirement.test.ts test/oracleIRExileTopTransitionBridge.test.ts test/oracleIRLookSelectTransitionBridge.test.ts test/oracleIRLookChooseTransitionBridge.test.ts test/oracleIRLookRevealLedger.test.ts test/oracleIRSearchLibraryTransitionBridge.test.ts test/oracleIRExileNamedTransitionBridge.test.ts test/oracleIRLedgerReferenceConvergence.test.ts test/oracleIRScrySurveilLedger.test.ts test/oracleIRSplitSearchLibraryTransitionBridge.test.ts

cd ../server
npm run test:oracle-ir-migration
npm run executor:coverage
```

---

*Oracle IR Step Ledger Migration — reference for Layer 2/3 convergence.*
