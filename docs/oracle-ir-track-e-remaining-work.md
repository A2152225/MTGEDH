# Oracle IR Track E — Remaining Executor Work (Post–Track D)

**Purpose:** Continue Layer 2 (`full_card` scope) executor gap closure after **Track D** cleared all `unsupported_condition_clause` gaps.

**Last updated:** 2026-06-29 (audit refresh — Layer 2 **100%** assisted; migration **752/752**; 1 optional target polish gap)

**Read first:** [oracle-ir-session-handoff.md](./oracle-ir-session-handoff.md) · [oracle-ir-server-migration-plan.md](./oracle-ir-server-migration-plan.md) · `.cursor/rules/oracle-ir-no-bespoke-handlers.mdc`

---

## Audit refresh (2026-06-29)

Regenerated all coverage reports after batches 431–435 (would-enter arc).

| Audit | Result |
|-------|--------|
| **Executor** (`EXECUTOR_COVERAGE_SCOPE=full_card`) | **47,514** items on **29,614** cards — **100%** assisted (45,608 fully applied + 1,906 choice-required); parse→execute **0**; `partial` **0**; `ir_gap` **0** |
| **Trigger** (`npm run trigger:coverage`) | **15,741/15,741** fully covered; `not_detected` **0** |
| **Selector gaps** | **0** clusters (`executor-fullcard-selector-gap-analysis.ts`) |
| **Condition gaps** | **0** clusters (`executor-fullcard-condition-gap-analysis.ts`) |
| **Amount gaps** | **0** clusters (`executor-amount-gap-analysis.ts`) |
| **Target gaps** | **1** item / **1** cluster — `no_deterministic_target` on Waterbender Ascension (`grant_temporary_ability`: *target creature can't be blocked this turn*) |
| **Migration bar** | **752/752** (`npm run test:oracle-ir-migration`) |

Reports: `server/scripts/out/executor-coverage-audit.json`, `trigger-coverage-audit.json`, `executor-*-gap-analysis.json` (gitignored; regenerate locally).

**Optional polish (not blocking Layer 3):** wire pre-target resolution for Waterbender Ascension–style `grant_temporary_ability` on a targeted creature (E2 target hardening).

---

## Compiled Oracle IR overlays (2026-06-29)

Runtime path for **new/custom cards** when `parseOracleTextToIR` leaves `unknown` steps but wired verbs exist.

| Item | Status |
|------|--------|
| `rules-engine/src/oracleIRCompilerEnvelope.ts` — merge overlay into step collection | ✅ |
| SQLite `oracle_ir_compiled_overlay` + import/validate/probe scripts | ✅ |
| Server hook: `collectOracleEffectSteps` + spell/trigger/activated entrypoints | ✅ |
| Agent: `.github/agents/OracleIRCompiler.agent.md` | ✅ |
| Rule: `.cursor/rules/oracle-ir-compiled-overlay.mdc` | ✅ |
| Tests: `oracle-ir-compiled-overlay*.test.ts`, `oracle-ir-overlay-*.test.ts` | ✅ |

**Operator workflow (`cd server`):**

```powershell
npm run oracle-ir:overlay:probe -- --name "Card Name"
npm run oracle-ir:overlay:validate -- --file data/compiled-oracle-ir-overlays/<card>.json --compare-parser
npm run oracle-ir:overlay:import
```

Does **not** change Layer 2 audit metrics (corpus already 100% assisted). Use before parser batches for new oracle phrasing.

---

## Track E — batch 430 (final trigger coverage `not_detected` gaps)

| Item | Status |
|------|--------|
| Tribal `whenever a Human deals damage to you` in `detectDealtDamageTriggers` | ✅ |
| `explore-clash` keyword action + continuation preserved in effect normalization | ✅ |
| `if you win` continuation sentence in trigger effect extraction | ✅ |
| `not_detected` trigger gaps | **2 → 0** (15,741/15,741 fully covered) |
| Migration bar | **752/752** (unchanged) |

**Key files:** `triggered-abilities.ts`, `oracleReminderText.ts`, `triggerEffectTextExtraction.ts`, `trigger-coverage-audit.probe.unit.test.ts`

---

## Track E — batch 429 (support keyword ETB effect preservation)

| Item | Status |
|------|--------|
| `stripKeywordAbilitySuffixes` preserves standalone `support N` / `fabricate N` etc. as gameplay effects | ✅ |
| `detectETBTriggers` + trigger parser retain support ETB effects (Expedition Raptor cluster) | ✅ |
| `not_detected` trigger gaps | **12 → 2** (Mikaeus, Merfolk Surveyor remain) |
| Migration bar | **752/752** (unchanged) |

**Key files:** `oracleReminderText.ts`, `oracleReminderText.test.ts`, `trigger-coverage-audit.probe.unit.test.ts`

---

## Track E — batch 428 (trigger coverage audit probe metadata)

| Item | Status |
|------|--------|
| `buildAuditProbePermanent` seeds `chosenCreatureType` / land / card-name when oracle chooses | ✅ |
| `serverDetectsTrigger` + detector helpers use probe permanent instead of bare `FAKE_PERMANENT` | ✅ |
| `not_detected` trigger gaps | **15 → 12** (Door of Destinies, Reflections of Littjara, Chronicle of Victory no longer false negatives) |
| Migration bar | **752/752** (unchanged) |

**Key files:** `trigger-coverage-audit.ts`, `trigger-coverage-audit.probe.unit.test.ts`

---

## Track E — batch 404 (Layer 3 Kavaron threshold IR)

| Item | Status |
|------|--------|
| Full `12+ \|` line step collection on server | ✅ |
| Kavaron token + pump via `tryApplyOracleIRToActivatedAbility` | ✅ |
| Migration bar | **729/729** |

**Key files:** `oracleIrAbilityExecution.ts`, `oracle-ir-kavaron-threshold.integration.test.ts`

---

## Track E — batch 403 (Station threshold activated cost split)

| Item | Status |
|------|--------|
| `12+ \| {cost}:` → `stationChargeThreshold` + clean `cost` | ✅ |
| Die-roll `1-9 \|` bands not misclassified | ✅ |
| Migration bar | **726/726** |

**Key files:** `oracleTextParserKeywordCosts.ts`, `oracleTextParser.ts`, `oracleIR.ts`, `oracleIRGapBatch403.test.ts`

---

## Track E — batch 402 (Squad token metadata + Flash ordering)

| Item | Status |
|------|--------|
| Sicarian Infiltrator squad `create_token` with Flash line | ✅ |
| offset-1050 primary gaps test | ✅ |
| Migration bar | **726/726** |

**Key files:** `oracleIRParserPostprocess.ts`, `oracleIRGapBatch402.test.ts`

---

## Track E — batch 401 (parser, Station / EOE Planets)

| Item | Status |
|------|--------|
| Station vs `12+ \|` line split (Adagia) | ✅ |
| Station inner-colon parse (no spurious `create_token`) | ✅ |
| Kavaron inline threshold reminder (`It's an artifact creature at 12+`) | ✅ |
| Migration bar | **726/726** |

**Key files:** `oracleTextParserPreprocess.ts`, `oracleTextParserKeywordCosts.ts`, `oracleReminderText.ts`, `oracleIRParserPostprocess.ts`, `oracleIRGapBatch401.test.ts`

---

## Track D — completed (batches 368–380)

| Metric | Post-367 baseline | Final (batch 380) |
|--------|-------------------|-------------------|
| `unsupported_condition_clause` | 501 | **0** |
| Condition gap clusters | 501 | **0** |
| Assisted execution (`full_card`) | ~98.0% | **98.4%** (47215/47969) |
| Bulk modules | — | `Batch368Bulk` … `Batch380Bulk` |

**Architecture (unchanged):**

```
oracle text → parseOracleTextToIR → applyOracleIRStepsToGameState
  → evaluateConditionalWrapperCondition / evaluateExtendedConditionalClause
  → BatchNNNBulk handlers (+ unless inners in ConditionalStepSupport.ts)
  → audit enrich in executor-coverage-audit.ts
```

**Lessons from Track D (keep applying):**

- `modify_pt` / `conditional` use **inner** `condition.raw` — full-sentence extended stubs do not close modify_pt audit gaps.
- **Unless** steps gap on `unlessCondition.raw`, not the outer step raw (Tainted Specter).
- Audit enrich must set **ctx flags the handler reads** (`castAnotherInstantOrSorceryThisTurn`, `unlessPutCardOnTopOfLibraryChoice`, `lastSacrificedPermanents`, etc.).
- `evaluateExtendedConditionalClause` must pass `lastExcessDamageDealtThisWay` into bulk modules when destructuring params.

---

## Track E — current baseline (`full_card` audit)

Source: `EXECUTOR_COVERAGE_SCOPE=full_card npm run executor:coverage` (regenerated **2026-06-29**)  
Report: `server/scripts/out/executor-coverage-audit.json` (gitignored)

| Metric | Count |
|--------|------:|
| Cards / items scanned | 29,614 / **47,514** |
| Fully applied | **45,608** |
| Choice required (expected UI) | 1,906 |
| Parse→execute gaps | **0** |
| Assisted execution | **100%** (47,514/47,514) |
| `ir_gap` (unparsed step kind) | **0** |
| `unsupported` | 0 |
| `partial` | **0** |
| `no_steps` | 0 |

### Top skip reason codes (excluding expected UI)

| Priority | Reason code | Count | Track |
|----------|-------------|------:|-------|
| — | `player_choice_required` | 2,239 | Expected UI — not a bug |
| ~~E2~~ | ~~`no_deterministic_target`~~ | **1** | Optional polish — Waterbender Ascension cluster |
| ~~E2~~ | ~~`unsupported_target`~~ | **0** | **Done (batch 389)** |
| ~~E1~~ | ~~`unsupported_selector`~~ | **0** | **Done (batch 381 + 399 flicker)** |
| ~~E1b~~ | ~~`unsupported_object_selector`~~ | **0** | **Done (batch 382 parser prune)** |
| — | `impossible_action` | 6 | Copy-token / combat edge cases |
| ~~E4~~ | ~~`unknown_amount`~~ | **0** | **Done (prior batches; amount gap script empty)** |
| ~~E5~~ | ~~`unsupported_player_selector`~~ | **0** | **Done (prior batches)** |
| ~~D~~ | ~~`unsupported_condition_clause`~~ | **0** | **Done** |

### Top skipped step kinds (choice/UI concentration)

| Step kind | Skip count | Notes |
|-----------|----------:|-------|
| `discard` | 644 | Often choice + unless |
| `search_library` | 446 | Choice + search criteria |
| `scry` | 411 | Mostly `player_choice_required` |
| `move_zone` | 213 | Selectors + destinations |
| `surveil` | 193 | Choice |
| `create_token` | 167 | Choice / token params |
| `ring_tempts_you` | 44 | Choice |

### Full-card selector clusters — **0 gaps** (regenerated 2026-06-29)

`npx tsx scripts/executor-fullcard-selector-gap-analysis.ts` reports **0** `unsupported_selector` clusters. The list below is **historical** (pre-batch 381/399); do not treat as open work:

1. ~~`put this land onto the battlefield`~~ — Lotus Vale, Scorched Ruins
2. ~~`exile it from your graveyard`~~ — Leonardo da Vinci
3. ~~`put each of those cards into your hand instead`~~ — See the Truth
4. ~~`then put this land onto the battlefield`~~ — Sheltered Valley
5. ~~`return this creature to its owner's hand and manifest dread`~~ — Glitch Interpreter
6. ~~`exile that many cards from your graveyard instead`~~ — Nefarious Lich
7. ~~`put that card onto the battlefield … instead of into its owner's graveyard`~~ — Desertion

---

## Recommended Track E sub-tracks

| Track | Focus | Primary files | Gap script |
|-------|--------|---------------|------------|
| **E1 — Object selectors** | ~~`unsupported_object_selector`~~, move_zone `what` | `oracleIRParserPostprocess.ts`, move_zone handlers | `executor-fullcard-object-selector-gap-analysis.ts` (**0** clusters) |
| **E2 — Targets** | ~~bulk `no_deterministic_target`~~ — **1** optional cluster remains | `oracleIRExecutorBattlefieldStepHandlers.ts`, attach handlers | `executor-target-gap-analysis.ts` (**1** cluster — Waterbender Ascension) |
| **E3 — IR gaps** | ~~`ir_gap`~~ | `oracleIRParserPostprocess.ts`, `oracleIR.ts` step kinds | Audit JSON `status: ir_gap` → **0** |
| **E4 — Amounts** | ~~`unknown_amount`~~, ~~`unsupported_scaler`~~ | `oracleIRExecutorForEachQuantity.ts` | `executor-amount-gap-analysis.ts` (**0** clusters) |
| **E5 — Unless / discard** | Remaining discard unless shapes (choice/UI only) | `oracleIRExecutorConditionalStepSupport.ts` | Card probes |
| **E6 — Layer 3 server** ⭐ **NEXT** | Live spell/trigger routing, queue resume, Effect Program expansion | `oracleIrSpellExecution.ts`, `oracleIrStepWiring.ts`, `resolution.ts` | `npm run test:oracle-ir-migration` (**752/752**) |

**Layer 2 parse→execute is done.** Optional E2 polish: Waterbender Ascension targeted unblockable grant. Primary work remains **Layer 3** live-path patterns beyond completed E6 P0–P2.

---

## Batch workflow (Track E)

1. **Pick sub-track** from table above; read existing `server/scripts/out/*.json` before re-scanning.
2. **Probe** 1–3 cards with `server/scripts/_tmp-probe-*.ts` (delete after use).
3. **Implement** generic parser/executor fix (no card-name routing).
4. **Audit enrich** in `executor-coverage-audit.ts` if dry-run needs fixture seeds.
5. **Test:** `npx vitest run test/oracleIRGapBatchNNN.test.ts` (rules-engine) + targeted server tests if Layer 3 touched.
6. **Re-audit:**
   ```powershell
   cd server
   $env:EXECUTOR_COVERAGE_SCOPE='full_card'
   npm run executor:coverage
   npx tsx scripts/executor-fullcard-selector-gap-analysis.ts
   npx tsx scripts/executor-fullcard-condition-gap-analysis.ts   # should stay 0
   ```
7. **Update** [oracle-ir-session-handoff.md](./oracle-ir-session-handoff.md) with metrics and next targets.

---

## Validation commands

```powershell
# Layer 2 regression (trigger effects — must stay 100% assisted)
cd server
npm run test:oracle-ir-migration

# Full-card executor audit
$env:EXECUTOR_COVERAGE_SCOPE='full_card'
npm run executor:coverage

# Gap cluster reports (regenerate after changes)
npx tsx scripts/executor-fullcard-condition-gap-analysis.ts
npx tsx scripts/executor-fullcard-selector-gap-analysis.ts
npx tsx scripts/executor-general-gap-analysis.ts          # trigger_effects non-choice skips
npx tsx scripts/executor-target-gap-analysis.ts         # trigger target clusters
npx tsx scripts/executor-amount-gap-analysis.ts

# Batch unit tests (rules-engine)
cd ../rules-engine
npx vitest run test/oracleIRGapBatch380.test.ts
```

---

## Copy-paste starting prompt (next session — Track E6)

Use this verbatim (adjust pattern / card as needed):

```
Proceed with Oracle IR Track E6 — Layer 3 server integration (Phase D + E).

Context:
- Layer 2 full_card audit: **100% assisted** (47,514/47,514); parse→execute **0**; `partial` **0**; `ir_gap` **0**.
- Trigger audit: **15,741/15,741** fully covered; `not_detected` **0**.
- Optional E2 polish: **1** `no_deterministic_target` cluster (Waterbender Ascension — targeted unblockable grant).
- Layer 3 regression bar: `cd server && npm run test:oracle-ir-migration` (currently **752/752 pass**).
- Read docs/oracle-ir-track-e-remaining-work.md, docs/oracle-ir-session-handoff.md, docs/oracle-ir-server-migration-plan.md first.
- Rules: .cursor/rules/oracle-ir-no-bespoke-handlers.mdc — generic parser/executor/queue wiring only.

This session: wire one high-risk live pattern end-to-end on the server path (pick one):
- Targeted zone-change spells/triggers (destroy/exile/bounce/sacrifice/flicker) via move_zone queue resume, OR
- Compound library search (Green Sun's Twilight / Celestial Reunion X search), OR
- Reveal → player_choice → move chains (Kindred Summons pattern; batch398 helpers exist in rules-engine).

Workflow:
1. Run failing migration tests for the chosen pattern; identify where applyOracleIRStepsOnServer / resolution queue drops the ball.
2. Extend oracleIrStepWiring + resolution queue (or Effect Program) generically — no card-name handlers.
3. Add/adjust server integration test; re-run npm run test:oracle-ir-migration for the cluster.
4. Update docs/oracle-ir-session-handoff.md with pass count and next Layer 3 target.
Do not commit unless I ask.
```

---

## Layer 3 — primary track (Track E6)

Layer 2 dry-run is complete; **live gameplay is the bottleneck.** Continue per [oracle-ir-server-migration-plan.md](./oracle-ir-server-migration-plan.md):

| Priority | Pattern | Migration test cluster | Key files |
|----------|---------|------------------------|-----------|
| **P0** | Targeted zone change (destroy/exile/bounce/sacrifice/flicker) | ✅ **Done (E6 batch 1)** — card id in zone containers | `oracleIRExecutorBattlefieldOps.ts` |
| **P1** | Counter distribution modal | ✅ **Done (E6 batch 2)** — `COUNTER_DISTRIBUTION` when pre-targeted | `oracleIRExecutorBattlefieldStepHandlers.ts` |
| **P1** | Compound X library search | ✅ **Done (E6 batch 3)** — Celestial Reunion X `manaValueLte` | `oracleIRExecutorPlayerStepHandlers.ts` |
| **P2** | Attack → land-or-draw | ✅ **Done (E6 batch 3)** — no spurious `LIBRARY_SEARCH`; deferred draw sync | `oracleIrServerZoneSync.ts`, `oracleIrTriggerExecution.ts` |
| **P2** | Reveal → choose → move | ✅ **Done (E6 batch 4–10)** — spell + trigger direct IR; Kindred EP on spell + trigger paths | `oracleIrEffectProgramServer.ts`, `oracleIrTriggerExecution.ts`, `oracleIrServerZoneSync.ts` |

**Migration bar:** `npm run test:oracle-ir-migration` → **752/752 pass** (2026-06-29).

**Station/EOE Broodship arc (batches 409–427):** ✅ structured `additionalCost`, parser dedupe, durable round-trip, live IR mirror, replay + usage consumption, 3+ additional land threshold, EP mirror, generic discard/retrace durable tests, Adagia parser guard (`oracleIRGapBatch422`), EOT `this_turn` permission cleanup (batch 423), discard `sourceGrantedAdditionalCost` live cast path (batch 424), full event-log replay through sacrifice + mana payment (batch 425), request-cast Broodship test via IR activation (batch 426), static permission skip for activatable Station graveyard-cast lines (batch 427).

**Batch 428:** trigger coverage audit probe permanent (`chosenCreatureType` etc.) — `not_detected` **15 → 12**.

**Batch 429:** preserve standalone `support N` keyword actions in `normalizeGameplayEffectText` — `not_detected` **12 → 2**.

**Batch 430:** Mikaeus tribal deals-damage + Merfolk Surveyor explore-clash — `not_detected` **2 → 0** (trigger audit fully green).

**Batch 431:** generic land would-enter sacrifice replacement on server play-land path (Lotus Vale / Scorched Ruins) — `land-would-enter-replacement.ts`, resolution/replay/AI wiring.

**Batch 432:** Sheltered Valley named-sacrifice would-enter (auto-sacrifice other copies, then ETB) — no resolution queue.

**Batch 433:** Lotus Vale socket integration (`playLand` → `submitResolutionResponse`, accept + decline, event log).

**Batch 434:** Mox Diamond unified into `land-would-enter-replacement.ts` (parse/queue/resolve); `mox-diamond-choice.ts` shim.

**Batch 435:** Mox Diamond socket integration (`tryQueueWouldEnterDiscardLandBeforeStackResolve` → `submitResolutionResponse`, event log).

**Would-enter arc (431–435) complete.**

**Next (pick one):**
- **Layer 3** live-path patterns beyond E6 P0–P2 (per migration plan), or
- **Optional E2 polish:** Waterbender Ascension `grant_temporary_ability` with pre-selected target (1 cluster in `executor-target-gap-analysis.json`).
