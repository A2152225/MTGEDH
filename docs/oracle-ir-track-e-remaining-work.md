# Oracle IR Track E — Remaining Executor Work (Post–Track D)

**Purpose:** Continue Layer 2 (`full_card` scope) executor gap closure after **Track D** cleared all `unsupported_condition_clause` gaps.

**Last updated:** 2026-06-15 (post batch 397 E2 — parse→execute **13**, `partial` **13**, `ir_gap` **0**)

**Read first:** [oracle-ir-session-handoff.md](./oracle-ir-session-handoff.md) · [oracle-ir-server-migration-plan.md](./oracle-ir-server-migration-plan.md) · `.cursor/rules/oracle-ir-no-bespoke-handlers.mdc`

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

Source: `EXECUTOR_COVERAGE_SCOPE=full_card npm run executor:coverage`  
Report: `server/scripts/out/executor-coverage-audit.json` (regenerate locally; gitignored)

| Metric | Count |
|--------|------:|
| Cards / items scanned | 29,614 / 47,570 |
| Fully applied | 45,473 |
| Choice required (expected UI) | 2,084 |
| Parse→execute gaps | **13** items on **13** cards |
| Assisted execution | **100%** (47557/47570) |
| `ir_gap` (unparsed step kind) | **0** |
| `unsupported` | 0 |
| `partial` | 13 |
| `no_steps` | 0 |

### Top skip reason codes (excluding expected UI)

| Priority | Reason code | Count | Track |
|----------|-------------|------:|-------|
| — | `player_choice_required` | 2,336 | Expected UI — not a bug |
| ~~E2~~ | ~~`no_deterministic_target`~~ | **0** | **Done (batch 389)** |
| ~~E1~~ | ~~`unsupported_selector`~~ | **0** | **Done (batch 381)** |
| ~~E1b~~ | ~~`unsupported_object_selector`~~ | **0** | **Done (batch 382 parser prune)** |
| ~~E2~~ | ~~`unsupported_target`~~ | **0** | **Done (batch 389)** |
| — | `impossible_action` | 6 | Copy-token / combat edge cases |
| **E4** | `unknown_amount` | 6 | Amount / reference_amount |
| **E5** | `unsupported_player_selector` | 2 | `who` parsing |
| ~~D~~ | ~~`unsupported_condition_clause`~~ | **0** | **Done** |

### Top skipped step kinds (where gaps concentrate)

| Step kind | Skip count | Notes |
|-----------|----------:|-------|
| `discard` | 649 | Often choice + unless; some fixture gaps |
| `search_library` | 441 | Choice + search criteria |
| `scry` | 412 | Mostly `player_choice_required` |
| `move_zone` | 223 | Selectors + destinations |
| `surveil` | 193 | Choice |
| `sacrifice` | 176 | who/what + choice |

### Full-card selector clusters (8 items / 7 clusters)

From `npx tsx scripts/executor-fullcard-selector-gap-analysis.ts`:

1. `put this land onto the battlefield` — Lotus Vale, Scorched Ruins
2. `exile it from your graveyard` — Leonardo da Vinci
3. `put each of those cards into your hand instead` — See the Truth
4. `then put this land onto the battlefield` — Sheltered Valley
5. `return this creature to its owner's hand and manifest dread` — Glitch Interpreter
6. `exile that many cards from your graveyard instead` — Nefarious Lich
7. `put that card onto the battlefield … instead of into its owner's graveyard` — Desertion

---

## Recommended Track E sub-tracks

| Track | Focus | Primary files | Gap script |
|-------|--------|---------------|------------|
| **E1 — Object selectors** | ~~`unsupported_object_selector`~~, move_zone `what` | `oracleIRParserPostprocess.ts` (`pruneBatch382MisparseExecutableSteps`), move_zone handlers | `executor-fullcard-object-selector-gap-analysis.ts` (**0** clusters) |
| **E2 — Targets** | `no_deterministic_target`, `unsupported_target` | `oracleIRExecutorBattlefieldStepHandlers.ts`, attach handlers, audit enrich | `_tmp-fullcard-target-gap-analysis.ts` → promote; **162** items / **168** clusters (regenerate) |
| **E3 — IR gaps** | 132 `ir_gap` items | `oracleIRParserPostprocess.ts`, `oracleIR.ts` step kinds | Filter audit JSON by `status: ir_gap` |
| **E4 — Amounts** | `unknown_amount`, `unsupported_scaler` | `oracleIRExecutorForEachQuantity.ts`, amount eval in step handlers | `executor-amount-gap-analysis.ts` (trigger scope); extend for full_card |
| **E5 — Unless / discard** | Remaining discard unless shapes | `oracleIRExecutorConditionalStepSupport.ts` (`resolveUnlessPayInnerCondition`) | Card probes |
| **E6 — Layer 3 server** | Live spell/trigger routing | `oracleIrSpellExecution.ts`, `resolution.ts`, Effect Program | `npm run test:oracle-ir-migration` |

**Do not** reopen Track D patterns for Track E — use step-kind handlers, parser extensions, and target/selector resolution instead of new `Batch381Bulk` condition modules unless a gap is genuinely `unsupported_condition_clause`.

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

## Copy-paste starting prompt (next session)

Use this verbatim (adjust batch number / sub-track as needed):

```
Proceed with Oracle IR Track E — full_card executor gap closure.

Context:
- Track D (batches 368–380) cleared ALL unsupported_condition_clause gaps (501 → 0).
- Current full_card audit: 99.9% assisted (47746/47783); **28** parse→execute gaps; **9** `ir_gap`; **27** `partial`.
- Top non-UI reason codes: no_deterministic_target (98), unsupported_target (70), unknown_amount (22).
- unsupported_object_selector: **0** (batch 382 parser prune).
- ir_gap: 105 (parser/step-kind gaps).
- Read docs/oracle-ir-track-e-remaining-work.md and docs/oracle-ir-session-handoff.md first.
- Rules: .cursor/rules/oracle-ir-no-bespoke-handlers.mdc — generic parser/executor only, no card-name handlers.

This session: Track E1 — object selector / move_zone batch (target ~36 clusters or all 7 fullcard selector clusters + top unsupported_object_selector from audit).

Workflow:
1. Read server/scripts/out/executor-coverage-audit.json and executor-fullcard-selector-gap-analysis.json (regenerate if stale).
2. Implement generic fixes in parser/executor (oracleIRExecutorMoveZoneStepHandlers, oracleIRExecutorZoneOps, parser postprocess as needed).
3. Add audit enrich fixtures in executor-coverage-audit.ts where dry-run needs seeds.
4. Add rules-engine tests oracleIRGapBatch381.test.ts (behavior outcomes, not legacy routing).
5. Re-run EXECUTOR_COVERAGE_SCOPE=full_card npm run executor:coverage and gap analysis scripts.
6. Update docs/oracle-ir-session-handoff.md with metrics and next targets.
Do not commit unless I ask.
```

---

## Layer 3 reminder (parallel track)

Layer 2 dry-run success does not automatically mean live server behavior. Continue Layer 3 work per [oracle-ir-server-migration-plan.md](./oracle-ir-server-migration-plan.md):

- IR-primary spell/trigger resolution through `applyOracleIRStepsOnServer` + resolution queue
- Effect Program multi-choice chains
- Retire handwritten shims when IR path is all-or-nothing
- Socket integration tests for high-risk patterns (combat damage, library search, tribal triggers)
