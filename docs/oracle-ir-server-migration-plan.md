# Oracle IR Server Migration Plan

**Purpose:** Plan the full supersession of handwritten spell/trigger/ability resolution with Oracle IR execution and the Effect Program orchestrator.

**Last updated:** 2026-06-11 (batch 175 — Inspiring Call antecedent "those creatures" + spell guardrail fix)  
**Owner:** Project maintainers  

> **New session?** Start at [Current status / session handoff](#current-status--session-handoff-2026-06-11) below. Batch 171–175 work is **uncommitted** locally.

**Rules for new work:** `.cursor/rules/oracle-ir-no-bespoke-handlers.mdc` — **no card-name routing**, **no new `KNOWN_*` table rows**; extend parser → executor → `applyOracleIRStepsOnServer` → resolution queue.

**Companion docs:**
- [oracle-automation-remaining-work.md](./oracle-automation-remaining-work.md) — rules-engine parser/executor gap closure (mostly complete)
- [oracle-automation-roadmap.md](./oracle-automation-roadmap.md) — historical milestone log
- [oracle-ir-gap-backlog.md](./oracle-ir-gap-backlog.md) — static parser backlog clusters

---

## Executive summary

The project has **three distinct layers**. Layers 1–2 are in strong shape; **Layer 3 (server integration) is only partially migrated**.

| Layer | What it is | Status |
|-------|------------|--------|
| **1 — Parse** | `parseOracleTextToIR` → `OracleEffectStep[]` | **Complete** for practical Commander scope (~30k cards, 0 non-joke IR gaps) |
| **2 — Execute** | `applyOracleIRStepsToGameState` in rules-engine | **Complete** in dry-run (assisted fixture): ~98%+ fully applied; remainder is expected `player_choice_required` |
| **3 — Integrate** | Server routes live gameplay through IR + resolution UI | **Partial** — activated abilities yes; spells/triggers still prefer handwritten paths |

**Goal:** Make Layer 3 match Layer 2 — every spell, trigger, and activated ability that parses and executes in the rules-engine should resolve through a **single server pipeline**, not parallel handwritten shims.

---

## Current status / session handoff (2026-06-11)

**Latest completed work:** Stack refactor **batch 175** — **Inspiring Call spell IR primary** now applies draw + indestructible end-to-end. Fixed `grant_temporary_ability` antecedent resolution (`lastAntecedentBattlefieldPermanentIds` from "for each" draw counts; "Those creatures" no longer mis-routed to static grant via overly broad `until end of turn` regex). Fixed `isOracleIrExecutionHandled` guardrail regression (uses `isOracleIrMandatoryExecutionComplete` + `hasUnqueuedPlayerChoiceGap`).

**Prior batch 174:** generic `add_counter` distribute execution; Court of Garenbrig upkeep; G1 triage partial.

**Git state:** ~60+ files modified, **no commits** unless explicitly requested.

### Batch 175 — Inspiring Call antecedent grants

| Area | Change | Key files |
|------|--------|-----------|
| **Execute** | Draw with `reference_amount` "for each …" records `lastAntecedentBattlefieldPermanentIds` | `oracleIRExecutorPlayerStepHandlers.ts`, `oracleIRExecutorForEachQuantity.ts`, `oracleIRExecutorModifyPtWhereMiscCounts.ts`, `oracleIRExecutorMainLoop.ts` |
| **Execute** | `grant_temporary_ability` "Those creatures" resolves antecedent IDs; static-grant fallback excludes antecedent plurals | `oracleIRExecutorBattlefieldStepHandlers.ts` |
| **Server** | Spell handled-check uses centralized wiring helpers | `oracleIrSpellExecution.ts` |
| **Tests** | IR-primary Inspiring Call regression; rules-engine indestructible step test | `inspiring-call-court-garenbrig.regression.test.ts`, `inspiringCall.test.ts` |

**Verify batch 175:**

```powershell
cd rules-engine
npx vitest run test/inspiringCall.test.ts test/oracleIRDistributeCounters.test.ts

cd ../server
npx vitest run tests/inspiring-call-court-garenbrig.regression.test.ts
npx vitest run tests/oracle-ir-activated-ability-guardrail.test.ts
npm run test:oracle-ir-migration
```

### Batch 174 — distribute counters (generic IR)

| Area | Change | Key files |
|------|--------|-----------|
| **Parse** | `add_counter` with `distribution: 'among'` for `distribute X counters among Y` | `oracleIR.ts`, `oracleIRParserSimpleActionClauses.ts` |
| **Execute** | Round-robin split across bound `chosenObjectIds`; sets `lastMovedBattlefieldPermanentIds` for `double_counters` tails | `oracleIRExecutorBattlefieldStepHandlers.ts` |
| **Server** | Counter doubling (Branching Evolution) via existing replacement sync after IR apply | `oracleIrServerZoneSync.ts` (`syncCounterReplacementEffectsAfterOracleIR`) |
| **Upkeep detection** | Removed card-specific `KNOWN_UPKEEP_CARDS["court of garenbrig"]`; generic upkeep regex owns detection | `upkeep-triggers.ts` |
| **Legacy retirement** | `applyRetiredTriggerLegacyDistributeCounters` → no-op | `oracleIrTriggerLegacyCounterHandlers.ts` |
| **Tests** | `rules-engine/test/oracleIRDistributeCounters.test.ts`, `server/tests/inspiring-call-court-garenbrig.regression.test.ts` (IR path), upkeep detection (no monarch bleed) | |

**Verify batch 174:**

```powershell
cd rules-engine
npx vitest run test/oracleIRDistributeCounters.test.ts

cd ../server
npx vitest run tests/inspiring-call-court-garenbrig.regression.test.ts
npx vitest run tests/upkeep-trigger-detection.unit.test.ts
```

**Not yet done (distribute follow-ups):**
- Player UI for **choosing how many counters** on each target when multiple legal splits exist (currently auto round-robin when targets are pre-bound on stack)
- Variable-amount distribute (`distribute a number of +1/+1 counters equal to … among any number of creatures you control`) — parse exists; executor needs reference-amount + unbounded target pool
- Stun counter / non-+1/+1 distribute families (e.g. Crashing Wave) — extend parser counter normalization + tests

### G1 game-log bugs — remaining for next session

| Issue | Status | Next step |
|-------|--------|-----------|
| **Court of Garenbrig** upkeep counters | **Fixed** (batch 174 IR) | Re-test in live game with Branching Evolution |
| **Inspiring Call** draw + indestructible | **Fixed** (batch 175 IR primary) | Legacy draw regex still present as fallback when primary OFF |
| **Roaming Throne** explore doubling | **Wired** (doubler on stack push) | Verify `chosenCreatureType` persisted on Roaming Throne at ETB; re-test explore |
| **Cryptoplasm** copy | **Investigate** | Optional upkeep was declined in G1 log — re-test on accept; `copy_permanent` IR + server sync |
| **Cavern / Three Tree City** type badge | **Investigate** | Client shows badge when `chosenCreatureType` set — check server ETB choice persistence (`creature-type.ts`) |
| **Bighorner Rancher** null priority | **Investigate** | G1 hang during Gwenna mana selection, not clearly Bighorner-specific |
| **Door of Destinies** partial IR tail | **Open** | All-or-nothing guard may need wiring expansion |

### Batch 173 — what landed (still relevant)

| Area | Change | Key files |
|------|--------|-----------|
| **Wiring centralization** | `oracleIrStepWiring.ts` — mandatory-step completeness, activated allowlists, queue-bridged player-choice handling | `oracleIrStepWiring.ts` |
| **Activated partial apply fix** | No step filtering; require full wiring; `handled:false` + legacy fallback on incomplete apply | `oracleIrAbilityExecution.ts` |
| **Spell/trigger completeness** | `isOracleIrExecutionHandled` checks mandatory steps; partial trigger apply logs warning | `oracleIrSpellExecution.ts`, `oracleIrTriggerExecution.ts` |
| **Fallback allowlist expansion** | Reanimation riders + combat/attach kinds in `ORACLE_IR_FALLBACK_STEP_KINDS` | `trigger-runtime-wiring.ts` |
| **Server sync bridges** | Haste clears summoning sickness; delayed exile + leave replacement fields | `oracleIrServerZoneSync.ts`, `oracleIRExecutorBattlefieldStepHandlers.ts` |
| **Inline activated text** | Single-line oracle keeps full multi-sentence effect after cost | `interaction.ts` (`extractActivatedAbilitiesFromText`) |
| **Tests** | `oracle-ir-step-wiring.test.ts`, Whip IR integration, activated guardrail source checks | `server/tests/` |

**Invariant:** Multi-step IR effects are **all-or-nothing** — partial apply never returns `handled:true`; legacy runs instead.

### Prior handoff (2026-06-10, batch 172)

**Completed work:** Stack refactor **batch 172** — exert attack-reward integration corridor is **green** (23/23 integration tests). Batch **171** fixed partial multi-step trigger fallthrough and impulse-exile bridging.

**Git state:** ~56 files modified, **no commits** unless explicitly requested. Largest diffs: legacy trigger handler gutting (`oracleIrTriggerLegacyRegexHandlers.ts`, `oracleIrTriggerLegacySingleEffectRegexBatch.ts`), `oracleIrServerZoneSync.ts` (+375 lines sync bridges), rules-engine executor/parser updates.

### Production vs test defaults

| Flag | Production default | Vitest default (`server/tests/vitest.setup.ts`) |
|------|-------------------|--------------------------------------------------|
| `ORACLE_IR_TRIGGER_PRIMARY` | **ON** (`oracleIrFeatureFlags.ts`) | **OFF** (`=0` in `beforeEach`) |
| `ORACLE_IR_SPELL_PRIMARY` | **ON** | **OFF** |

IR-primary integration tests **opt in** per test with `process.env.ORACLE_IR_TRIGGER_PRIMARY = '1'` (or spell equivalent). Legacy-path suites rely on the harness default OFF.

### Batch 172 — what landed

| Area | Change | Key files |
|------|--------|-----------|
| **Copy token IR** | Fixed `splitCopyTokenReference` regex to match singular **copy of** (was `copies?` only → missed `"copy of target creature…"`; Sandstorm root cause) | `rules-engine/src/oracleIRExecutorTokenStepHandlers.ts` |
| **Sandstorm tail guard** | When IR fallback creates tapped-attacking copy token, skip legacy `TappedAttackingCopyToken` handler (prevents double tokens when primary is OFF) | `stackExecuteTriggerEffectTailUtils.ts` |
| **IR fallback context** | Defending player via `targetOpponentId`; `targetPermanentId` + `chosenObjectIds` from trigger targets | `stackExecuteTriggerEffectIrFallbackUtils.ts`, `oracleIrStackContextUtils.ts` |
| **Server sync bridges** | `syncIrCopyTokenProvenanceFromOracleIRResult`, `syncIrAtNextEndStepTokenSacrificeFromOracleIRResult` after `applyOracleIRStepsOnServer` | `oracleIrServerZoneSync.ts` |
| **Glorybringer target** | `resolveSingleCreatureTargetId` uses `pickFromControllerPool()` for opponent/you-control variants | `rules-engine/src/oracleIRExecutorCreatureStepUtils.ts` |
| **Hydra Trainer pump** | Strip exert reminder + Adapt activated text from execution description (`+3/+3` not `+5/+5`) | `trigger-runtime-wiring.ts` (`normalizeTriggerEffectDescriptionForExecution`) |
| **Clockwork Droid** | Broader self-unblockable match; scry only if not already pending | `oracleIrTriggerLegacyCombatEvasionHandlers.ts` |
| **Routing helper** | `isTriggerEffectFullyIrWired()` — wiring check without primary flag; primary ownership delegates to it | `oracleIrTriggerLegacyRouting.ts` |

### Exert corridor — test matrix (batch 172)

Suite: `server/tests/exert-choice.integration.test.ts` (**23/23** as of 2026-06-10).

| Card / family | Batch 172 fix | Notes |
|---------------|---------------|-------|
| **Sandstorm Crasher** | Rules-engine `cop(?:y\|ies) of` regex + server tail guard + sync bridges | Was creating generic `"Token"` (copy path never entered). With `ORACLE_IR_TRIGGER_PRIMARY=0`, IR fallback creates token; legacy `TappedAttackingCopyToken` must **not** also run. |
| **Glorybringer** | `resolveSingleCreatureTargetId` → `pickFromControllerPool()` | Opponent-controlled non-Dragon filter. |
| **Hydra Trainer** | `normalizeTriggerEffectDescriptionForExecution()` strips Adapt + exert reminder | Without strip, IR parsed `+5/+5` from Adapt text bleed. Long-term: IR `modify_pt` should own counter math. |
| **Clockwork Droid** | Self-unblockable + scry in legacy handler; impulse bridge (171) | Scry only queued if not already pending. |
| **Anep, Vizier of Hazoret** | Impulse exile bridge (171) | `syncIrImpulseExileToPendingImpulseDraws`. |
| Other exert rewards | Unaffected / already green | Draw, pump, untap, damage watchers, equipment search, Devoted Crop-Mate GY, etc. |

Replay: `server/tests/exert-choice.replay.test.ts` — Sandstorm case passes with defending-player snapshot.

### Trigger resolution flow (exert reflexive — primary OFF)

Vitest default (`ORACLE_IR_TRIGGER_PRIMARY=0`) exercises **coexistence** of IR fallback + legacy regex. Production default is ON.

```
exert choice → reflexive trigger on stack → executeTriggerEffect
  1. oracleIrTriggerExecution (primary) → handled:false when primary OFF or not fully wired
  2. stackExecuteTriggerEffectLegacyBodyUtils (card-specific / early regex)
  3. stackExecuteTriggerEffectTailUtils:
       a. applyOracleIRFallbackForTriggeredEffect (uncategorized IR)
       b. if IR applied + Sandstorm pattern → return early (no legacy duplicate)
       c. if IR applied + isTriggerEffectOwnedByOracleIrPrimary → return early
       d. applyRetiredTriggerLegacy* regex batches
  4. applyOracleIRStepsOnServer sync hooks:
       syncIrCopyTokenProvenanceFromOracleIRResult
       syncIrAtNextEndStepTokenSacrificeFromOracleIRResult
       syncIrImpulseExileToPendingImpulseDraws
```

**Sandstorm pitfall (fixed):** `splitCopyTokenReference` used `/copies?/` which matches `copie`/`copies` but **not** singular `copy`. Parser emits `"copy of target creature you control"` → copy branch skipped → generic `"Token"`. Fix: `/cop(?:y|ies)/`.

### Batch 171 — recap (still relevant)

- Primary IR must **not** apply partial steps when legacy still needed (multi-step effects like Clockwork Droid).
- Tail uncategorized fallback short-circuits legacy regex only when effect is **fully** IR-owned (`isTriggerEffectOwnedByOracleIrPrimary`).
- `syncIrImpulseExileToPendingImpulseDraws` bridges IR `impulse_exile_top` → server `pendingImpulseDraws` (Anep exert, Clockwork scry path).

### Verify before starting next batch

```powershell
cd server
npx vitest run tests/exert-choice.integration.test.ts
npx vitest run tests/oracle-ir-trigger-primary.integration.test.ts
npx vitest run tests/exert-choice.replay.test.ts -t "Sandstorm"
npm run test:oracle-ir-migration   # broader migration suite when touching routing/sync
```

**Expected (2026-06-10):** exert 23/23, trigger-primary 4/4, Sandstorm replay pass.

### Uncommitted file manifest (batch 171–172, grouped)

| Group | Paths |
|-------|-------|
| **Trigger primary + routing** | `oracleIrTriggerExecution.ts`, `oracleIrTriggerLegacyRouting.ts`, `stackExecuteTriggerEffectUtils.ts`, `stackExecuteTriggerEffectTailUtils.ts`, `stackExecuteTriggerEffectIrFallbackUtils.ts`, `stackExecuteTriggerEffectLegacyBodyUtils.ts` |
| **Legacy handler retirement** | `oracleIrTriggerLegacy*.ts` (regex/combat/token/counter/mill/search/combined/single/late batches gutted) |
| **Server zone sync** | `oracleIrServerZoneSync.ts` (copy provenance, next-end-step sacrifice, impulse exile, temporary abilities bridge) |
| **Runtime wiring** | `trigger-runtime-wiring.ts`, `triggers/combat.ts`, `oracleIrTriggerUncategorizedFallback.ts` |
| **Rules-engine (batch 172 fixes)** | `oracleIRExecutorTokenStepHandlers.ts`, `oracleIRExecutorCreatureStepUtils.ts` |
| **Rules-engine (broader)** | `oracleIR.ts`, `oracleIRParserPostprocess.ts`, `oracleIRParserSimpleActionClauses.ts`, `oracleIRExecutorMainLoop.ts`, `oracleIRExecutorKeywordStepHandlers.ts`, … |
| **Spell-side retirement** | `oracleIrSpellExecution.ts`, `oracleIrSpellLegacyRouting.ts`, `stackResolveSpell*.ts`, `stackResolveInstantSorceryLegacyBodyUtils.ts` |
| **Tests** | `exert-choice.integration.test.ts` (green), `oracle-ir-trigger-primary.integration.test.ts`, `oracle-ir-trigger-legacy-*.test.ts`, `oracle-ir-spell-*.integration.test.ts`, `oracle-ir-legacy-forced.integration.test.ts` |

### Next session priorities (Phase 4 continuation)

1. **G1 verification pass** — re-run scenarios from game log with batch 174 fixes; file issues for Cryptoplasm, creature-type badge persistence, Bighorner/Gwenna priority hang.
2. **`grant_temporary_ability` wiring** — retire combat evasion legacy handlers; step-kind wiring in `oracleIrStepWiring.ts`.
3. **`modify_pt` counter-scaled pumps** — IR ownership for Hydra Trainer–style effects (drop description-normalization shim).
4. **Distribute-counter UI** — resolution queue step for player split when targets bound but split is ambiguous (optional; round-robin is acceptable MVP).
5. **Continue regex retirement** — grep `applyRetiredTriggerLegacy*`; gut bodies when IR + integration test green. **Never** add card-name rows to `KNOWN_*` tables (see `.cursor/rules/oracle-ir-no-bespoke-handlers.mdc`).
6. **Inspiring Call spell path** — ensure full multi-step IR applies under `ORACLE_IR_SPELL_PRIMARY=1`; then remove `stackResolveSpellLegacyRegexDrawUtils` draw fallback.
7. **Run migration suite** after routing/sync edits: `cd server ; npm run test:oracle-ir-migration`
8. **Uncommitted work** — all batch 171–174 changes are local only; no commits unless explicitly requested.

### Known invariants (do not break)

- **Double application:** IR fallback applied + legacy regex both running → duplicate tokens/effects. Use tail guards (`triggeredOracleIRApplied > 0` + pattern match) or `skipRetiredTriggerLegacyHandler` when IR owns the effect.
- **Partial multi-step:** Primary returns `handled: false` when not fully wired; tail fallback may apply step 1 only — legacy must still run for remaining steps unless `isTriggerEffectFullyIrWired` is true for the **whole** description.
- **Test harness:** Default `ORACLE_IR_TRIGGER_PRIMARY=0` means tail IR fallback + legacy coexist; guards must work in **both** primary-ON and primary-OFF modes.
- **Zone sync:** Never call `applyOracleIRStepsToGameState` directly on live `ctx.state` — always `applyOracleIRStepsOnServer` (hydrate + sync + queue prompts).

---

## Target end-state architecture

Every resolution event should follow one of two orchestration patterns:

### Pattern A — Direct Oracle IR (simple abilities, stack objects with pre-bound targets)

```
oracle text
  → parseOracleTextToIR
  → applyOracleIRStepsOnServer(ctx, state, steps, irCtx, options)
       → applyOracleIRStepsToGameState (haltOnPlayerChoiceRequired: true)
       → sync zones / mill replacements
       → queue*ChoicePromptsFromOracleIRResult (per gap)
  → resolution.ts handles prompts
  → maybeApplyOracleIrChoiceStepFromResolution / maybeResumeOracleIRStepsAfterResolution
  → tail steps continue until applied or fizzle
```

### Pattern B — Effect Program (multi-step choice chains, may-then-X, modal, fateseal/clash)

```
oracle text
  → buildEffectProgramsFromOracleText / buildEffectProgramFromOracleIR
  → startEffectProgramResolution (server)
       → runEffectProgram with createOracleIREffectProgramHandlers
       → queueEffectProgramChoice on pause
  → resolution.ts resumeEffectProgramResolution
       → bind choice → run tail → oracle_ir_step commands call applyOracleIRStepsOnServer
```

**Retire:** `categorizeSpell` fast-path, `executeSpellEffect` opcode dispatch for effects IR already handles, `executeTriggerEffect` regex corpus, and `applyOracleIRFallbackForUncategorizedSpell` (partial duplicate executor).

**Keep (for now):** Infrastructure opcodes that are not card text (mana payment, stack targeting legality, SBA ordering, replacement-effect framework). Card *effects* should not add new handwritten branches.

---

## Current server resolution map

### Entry points today

| Event | Primary path today | Oracle IR involvement |
|-------|-------------------|---------------------|
| **Activated ability** | `tryApplyOracleIRToActivatedAbility` | **Primary** — `applyOracleIRStepsOnServer` |
| **Optional may (game-actions)** | `queueMayAbilityStep` callback | Partial — single optional step via `applyOracleIRStepsOnServer` |
| **Spell resolves** | `categorizeSpell` → spec hydration → `executeSpellEffect` | **Fallback only** — `applyOracleIRFallbackForUncategorizedSpell` after spec miss |
| **Triggered ability** | `executeTriggerEffect` (~26k lines of matchers) | **Primary when `ORACLE_IR_TRIGGER_PRIMARY` ON** (production default); else **tail fallback** — `applyOracleIRFallbackForTriggeredEffect` → uncategorized fallback |
| **Optional trigger deferral** | Custom 2-step Effect Program (`stackResolveTriggeredAbilityOptionalUtils.ts`) | Effect Program for yes/no only; defers to stack re-push |
| **Planeswalker loyalty** | `tryResolvePlaneswalkerLoyaltyTemplate` (~100 template cases) | Separate system; not IR |
| **Supplemental spell riders** | `applySupplementalOracleIRForResolvedSpell` | Ad-hoc unknown-step handlers |

### Key files

| Role | Path |
|------|------|
| Stack / spell / trigger resolution (barrel) | `server/src/state/modules/stack.ts` (~130 lines, re-exports only) |
| Stack resolution shared types | `server/src/state/modules/stackResolveSharedTypes.ts` (continuation/result types for top-of-stack, instant/sorcery, trigger legacy body) |
| Top-of-stack orchestration | `server/src/state/modules/stackResolveTopOfStackUtils.ts` |
| Top-of-stack preface (pop/fizzle/mox) | `server/src/state/modules/stackResolveTopOfStackPrefaceUtils.ts` |
| Top-of-stack dispatch (ability/trigger/spell) | `server/src/state/modules/stackResolveTopOfStackDispatchUtils.ts` |
| Top-of-stack post-resolution (SBA) | `server/src/state/modules/stackResolveTopOfStackPostResolutionUtils.ts` |
| Trigger effect dispatch (orchestrator) | `server/src/state/modules/stackExecuteTriggerEffectUtils.ts` |
| Trigger legacy body (post-IR handlers) | `server/src/state/modules/stackExecuteTriggerEffectLegacyBodyUtils.ts` |
| Trigger legacy tail (IR fallback + regex) | `server/src/state/modules/stackExecuteTriggerEffectTailUtils.ts` |
| Trigger effect preface (pre-IR) | `server/src/state/modules/stackExecuteTriggerEffectPrefaceUtils.ts` |
| Trigger IR uncategorized fallback | `server/src/state/modules/stackExecuteTriggerEffectIrFallbackUtils.ts` |
| Trigger legacy routing / primary gate | `server/src/state/modules/oracleIrTriggerLegacyRouting.ts` |
| Trigger primary execution | `server/src/state/modules/oracleIrTriggerExecution.ts` |
| Trigger effect description normalize | `server/src/state/modules/trigger-runtime-wiring.ts` |
| Copy token step handlers (rules-engine) | `rules-engine/src/oracleIRExecutorTokenStepHandlers.ts` |
| Instant/sorcery orchestration | `server/src/state/modules/stackResolveInstantSorceryOrchestratorUtils.ts` |
| Instant/sorcery preface (IR + spec) | `server/src/state/modules/stackResolveInstantSorceryPrefaceUtils.ts` |
| Instant/sorcery legacy resolution | `server/src/state/modules/stackResolveInstantSorceryLegacyResolutionUtils.ts` |
| Permanent spell orchestration | `server/src/state/modules/stackResolvePermanentSpellOrchestratorUtils.ts` |
| Permanent spell post-entry (ETB/tribute/squad) | `server/src/state/modules/stackResolvePermanentSpellPostEntryUtils.ts` |
| Triggered ability deferrals | `server/src/state/modules/stackResolveTriggeredAbilityDeferralUtils.ts` |
| Triggered ability orchestration | `server/src/state/modules/stackResolveTriggeredAbilityOrchestratorUtils.ts` |
| Handwritten spell categorization | `server/src/rules-engine/targeting.ts` (`categorizeSpell`, ~4k lines) |
| IR server adapter + choice queues | `server/src/state/modules/oracleIrServerZoneSync.ts` |
| Activated ability early (fetch/cycling) | `server/src/state/modules/stackResolveAbilityEarlyHandlersUtils.ts` |
| Activated ability mid (fight/equip/etc.) | `server/src/state/modules/stackResolveAbilityMidHandlersUtils.ts` |
| Activated ability late (IR + deferrals) | `server/src/state/modules/stackResolveAbilityLateHandlersUtils.ts` |
| Activated ability barrel | `server/src/state/modules/stackResolveAbilityHandlersUtils.ts` |
| Activated ability IR gate | `server/src/state/modules/oracleIrAbilityExecution.ts` |
| Resolution UI + resume | `server/src/socket/resolution.ts` |
| Effect Program server glue | `server/src/state/effects/effectProgramResolutionService.ts`, `effectProgramQueueAdapter.ts` |
| Rules-engine executor | `rules-engine/src/oracleIRExecutor*.ts`, `oracleIRExecutorMainLoop.ts` |
| Effect Program builder/runner | `rules-engine/src/effectProgram.ts`, `effectProgramOracleRunner.ts` |
| PW loyalty templates | `server/src/state/planeswalker/templates/resolve.ts` |

---

## Canonical server API (already built)

### `applyOracleIRStepsOnServer`

Location: `server/src/state/modules/oracleIrServerZoneSync.ts`

Responsibilities:
1. Hydrate player zones from `GameContext`
2. Apply mill-replacement rewriting to steps
3. Run executor with `interactivePlayerChoices: true`, `haltOnPlayerChoiceRequired: true`
4. Sync zones back to context (graveyard diff, battlefield, etc.)
5. Enqueue resolution prompts for each `player_choice_required` automation gap

**Call sites today (production):**
- `oracleIrAbilityExecution.ts` — activated abilities (**primary**)
- `game-actions.ts` — optional may-step callback
- `stackExecuteTriggerEffectIrFallbackUtils.ts` — `unless_pays_mana` / `unless_pays_life` / `conditional` inside trigger uncategorized fallback
- `oracleIrUncategorizedSpellFallback.ts` — spell uncategorized fallback (via `stackResolveSpellUncategorizedUtils.ts`)

### Choice queue wiring (Phase 3 — R1)

| Step kind | Queue function | Resolution step type | Resume path | Integration test |
|-----------|----------------|---------------------|-------------|------------------|
| `scry`, `surveil` | `queueTopLibraryChoicePromptsFromOracleIRResult` | `SCRY` / `SURVEIL` | `maybeResumeOracleIRStepsAfterResolution` | (via compound-resume) |
| `unless_pays_mana`, `unless_pays_life` | `queueUnlessPayChoicePromptsFromOracleIRResult` | `UNLESS_PAY` | `resumeOracleIRUnlessPayFromResolution` | `oracle-ir-unless-pay.integration.test.ts` |
| `discard` (fixed + any_number) | `queueDiscardChoicePromptsFromOracleIRResult` | `DISCARD_SELECTION` | choice bind + resume | `oracle-ir-discard`, `oracle-ir-any-number-discard` |
| `proliferate` | `queueProliferateChoicePromptsFromOracleIRResult` | `TARGET_SELECTION` | choice bind + resume | `oracle-ir-proliferate` |
| `populate` | `queuePopulateChoicePromptsFromOracleIRResult` | `TARGET_SELECTION` | choice bind + resume | `oracle-ir-populate` |
| `explore` | `queueExploreChoicePromptsFromOracleIRResult` | `EXPLORE_DECISION` | choice bind + resume | `oracle-ir-explore` |
| `sacrifice` | `queueSacrificeChoicePromptsFromOracleIRResult` | `TARGET_SELECTION` | choice bind + resume | `oracle-ir-sacrifice` |
| `look_choose_from_top`, `look_select_top` | `queueLookChooseChoicePromptsFromOracleIRResult` | `LIBRARY_SEARCH` | validation-only in resolution; IR applies zones | `oracle-ir-look-choose` |
| `connive` | `queueConniveChoicePromptsFromOracleIRResult` | `DISCARD_SELECTION` | choice bind + resume | `oracle-ir-connive` |
| `player_choice` | `queuePlayerChoicePromptsFromOracleIRResult` | `OPTION_CHOICE` / `CREATURE_TYPE_CHOICE` | choice bind + resume | `oracle-ir-player-choice` |
| `add_mana` (any-color) | `queueAddManaChoicePromptsFromOracleIRResult` | `MANA_COLOR_SELECTION` | choice bind + resume | `oracle-ir-add-mana` |
| `fateseal`, `clash` | Effect Program (`startOracleEffectProgramOnServer`) | `PLAYER_CHOICE` → `FATESEAL` / `CLASH` | `resumeEffectProgramResolution` | `oracle-ir-fateseal-clash-effect-program` |
| `search_library` | `queueSearchLibraryChoicePromptsFromOracleIRResult` | `LIBRARY_SEARCH` | choice bind + resume | `oracle-ir-search-library` |
| `choose_pile` | `queueChoosePileChoicePromptsFromOracleIRResult` | `OPTION_CHOICE` | choice bind + resume | `oracle-ir-choose-pile` |
| `change_target` | `queueChangeTargetChoicePromptsFromOracleIRResult` | `OPTION_CHOICE` / `TARGET_SELECTION` | choice bind + resume | `oracle-ir-change-target` |
| `copy_permanent` (target selection) | `queueCopyPermanentChoicePromptsFromOracleIRResult` → `applyCopyPermanentTriggerStep` | `TARGET_SELECTION` (`self_become_copy_of_creature`) | resolution applies copy via `permanent-copy.ts` | `cryptoplasm-copy`, `oracle-ir-trigger-primary` |
| `add_mana` (distribution) | `queueAddManaChoicePromptsFromOracleIRResult` | `MANA_COLOR_SELECTION` (`distribution`) | choice bind + resume | `oracle-ir-add-mana-distribution` |

Resolution hooks (`resolution.ts`):
- `maybeApplyOracleIrChoiceStepFromResolution` — re-runs paused step with `chosenObjectIds` from `oracleIrChoiceStepJson`
- `maybeResumeOracleIRStepsAfterResolution` — continues `oracleIrResumeStepsJson` tail

Client UI: `DiscardSelectionModal`, `LibrarySearchModal`, `AnyColorManaModal`, explore/surveil/scry flows in `App.tsx`.

### Not yet wired via `oracleIrServerZoneSync` queues

These pause correctly in the **rules-engine** (and often in **Effect Program** tests) but lack direct server queue + resume wiring:

| Step / choice kind | Effect Program support | Server queue | Notes |
|--------------------|------------------------|--------------|-------|
| `choose_mode` | Yes (`buildEffectProgramFromOracleIR`) | Effect Program only | Modal spells need Pattern B end-to-end on server |
| `choose_opponent`, `choose_color`, `choose_creature_type`, `choose_card_name`, `choose_target_creature` | Yes (ORACLE_CHOICE_STEP_KINDS) | Partial / ad-hoc | Some flow through targeting UI before IR |
| `add_mana` + distribution / multi-color sequences | Yes | Partial | Single any-color wired; combination distribution via `selectionKind: distribution` |
| `ring_tempts_you`, `move_counters` | Executor yes | No | Deterministic or choice-heavy |
| `copy_spell`, `search_library` | Executor yes | No | Complex multi-phase |

---

## The handwritten fallback problem

### `applyOracleIRUncategorizedSpellFallback`

Location: `server/src/state/modules/oracleIrUncategorizedSpellFallback.ts`  
Entry: `stackResolveSpellUncategorizedUtils.ts` → `tryApplyInstantSorceryUncategorizedSpellFallback`

Called when:
- Spell has no `spellSpec` from `categorizeSpell`
- Trigger reaches tail of `executeTriggerEffect` without a handwritten match

**Design flaws relative to target architecture:**
1. **Re-implements executor** — per-step `switch` calling `executeSpellEffect` opcodes instead of one `applyOracleIRStepsOnServer` call
2. **Skips optional steps** — `if (step.optional) continue` (line ~6002) — blocks may-effects unless Effect Program handles them elsewhere
3. **Incomplete step coverage** — `default: break` for most IR step kinds not listed in the switch (~20 kinds handled vs 80+ in executor)
4. **Inconsistent choice handling** — scry/surveil queue via `executeSpellEffect({ kind: 'QueueScry' })` instead of IR halt/resume; duplicates resolution paths
5. **Only partial IR** — `unless_pays_*` / `conditional` delegate to `applyOracleIRStepsOnServer`; everything else is shim

**Handled in fallback switch today:** `tap_or_untap`, `exile_top`, `impulse_exile_top`, `add_mana`, `draw`, `scry`, `surveil`, `gain_life`, `lose_life`, `sacrifice`, `add_counter`, `deal_damage`, `prevent_damage`, `discard`, `mill`, `create_token`, `destroy`, `conditional`, `unless_pays_mana`, `unless_pays_life`.

### `executeTriggerEffect`

Location: `server/src/state/modules/stackExecuteTriggerEffectUtils.ts`  
IR tail fallback: `stackExecuteTriggerEffectIrFallbackUtils.ts` → `applyOracleIRFallbackForTriggeredEffect`
Runs **before** Oracle IR fallback. Legacy regex dispatch lives in `oracleIrTriggerLegacy*.ts` modules; `executeTriggerEffect` orchestrates them. Contains:
- Card-name-specific branches
- Graveyard permission riders
- Duplicated logic that IR executor already implements

**Migration rule:** New card behavior must **not** add branches here. Existing branches retire when IR + integration test proves parity.

### `categorizeSpell` + `executeSpellEffect`

Location: `targeting.ts` + `stackResolveInstantSorceryOrchestratorUtils.ts` (and spell sub-modules)

`categorizeSpell` pattern-matches simple single-clause spells (draw N, discard N, destroy all, counter target spell, etc.) into `SpellSpec` opcodes. `executeSpellEffect` dispatches ~30 opcode kinds (`DrawCards`, `QueueScry`, `DestroyPermanent`, …).

**Migration rule:** For each opcode family, prove IR applies the same state delta, then route spells through IR first and delete the opcode path when redundant.

### Planeswalker loyalty templates

Location: `server/src/state/planeswalker/templates/resolve.ts`

~100 template cases including `FALLBACK_MANUAL_RESOLUTION`. Long-term: parse loyalty abilities to IR + Effect Program like other activated abilities. Short-term: keep until IR path covers modal PW abilities reliably.

---

## Effect Program status

### Built in rules-engine

| Component | Path | Status |
|-----------|------|--------|
| Program builder | `rules-engine/src/effectProgram.ts` | Maps IR steps → choice/command/note steps |
| Oracle command runner | `rules-engine/src/effectProgramOracleRunner.ts` | `createOracleIREffectProgramHandlers`, special handlers for explore/proliferate/populate/clash/fateseal |
| Text → programs | `buildEffectProgramsFromOracleText` | One program per IR ability |
| Tests | `rules-engine/test/effectProgram.test.ts` | Broad coverage including discard, scry, unless-pay, modes |

### Wired on server

| Use case | Status |
|----------|--------|
| Optional triggered ability yes/no deferral | **Production** — custom 2-step program in `stackResolveTriggeredAbilityOptionalUtils.ts` |
| Full card / trigger / spell resolution | **Not production** — handlers exist but are not the primary resolver |
| Resolution resume | **Production** — `resumeEffectProgramResolution` in `resolution.ts` when `effectProgramPrompt: true` |

### Recommended unification

Use **Effect Program as the default orchestrator** for any ability with:
- Optional (`You may`) prefix
- Multiple sequential player choices
- Modal (`Choose one —`)
- Fateseal / clash subflows

Use **direct IR** for deterministic single-pass abilities (ETB draw, simple activated tap-draw, etc.).

---

## Metrics baseline (2026-06-10)

Regenerate after code changes:

```powershell
cd server
npm run executor:coverage
$env:EXECUTOR_COVERAGE_SCOPE="full_card"; npm run executor:coverage
npm run trigger:coverage
cd ..
npx tsx tools/oracle-ir-gap-audit.ts
```

### Parser gap audit (`tools/oracle-ir-gap-audit.ts`)

| Metric | Value |
|--------|------:|
| Unique cards parsed | 29,971 |
| Cards with gaps | 0 |
| Gap records | 0 |

### Full-card executor dry-run (`EXECUTOR_COVERAGE_SCOPE=full_card`, commander-legal, assisted fixture)

| Status | Count |
|--------|------:|
| Items scanned | 51,207 |
| `fully_applied` | 50,268 |
| `choice_required` | 935 |
| `partial` | 4 |
| `unsupported` | 0 |
| `ir_gap` | 0 |
| Parse→execute gap | 4 |

Top `choice_required` step kinds (expected UI pauses, not engine bugs):

| Step kind | Skip count |
|-----------|----------:|
| `scry` | 395 |
| `surveil` | 185 |
| `player_choice` | 137 |
| `conditional` | 120 |
| `discard` | 85 |

Report: `server/scripts/out/executor-coverage-audit.json`

### Trigger-effect corridor (see remaining-work doc)

Trigger effects: **100% assisted execution**, 0 parse→execute gaps (2026-06-09 baseline).

---

## Migration phases

### Phase 0 — Guardrails (ongoing)

**Objective:** Stop growth of handwritten resolution.

- [ ] CI rule / code review checklist: no new `executeTriggerEffect` regex branches; no new `categorizeSpell` patterns unless paired with IR migration ticket
- [ ] Require integration test for any new `queue*ChoicePrompts` wiring
- [ ] Document opcode → IR step kind mapping (see appendix)

**Exit:** Team agreement + lint/grep check in PR template.

---

### Phase 1 — Flip spell resolution order

**Objective:** Try IR first; handwritten only on explicit `unsupported` gap.

**Changes:**
1. In `resolveTopOfStack` (spell branch), before `categorizeSpell`:
   - Parse oracle text → steps
   - Call `applyOracleIRStepsOnServer` with full step list
   - If `appliedSteps.length > 0` OR resolution queue gained prompts OR `pendingOptionalSteps` → **done**
   - If all steps skipped with `unsupported_*` / `ir_gap` → fall through to legacy
2. `ORACLE_IR_SPELL_PRIMARY` defaults **on** via `oracleIrFeatureFlags.ts`; opt out with `ORACLE_IR_SPELL_PRIMARY=0` or `ORACLE_IR_SPELL_LEGACY=1`
3. Log divergence when legacy path would have produced different outcome (shadow mode first)

**Exit criteria:**
- ≥90% of commander-legal instants/sorceries resolve without hitting `categorizeSpell` in shadow logs
- No regressions in existing integration tests
- Duplicate application prevented (draw twice, double scry queue)

**Primary files:** `stackResolveTopOfStackUtils.ts`, `oracleIrServerZoneSync.ts`

---

### Phase 2 — Flip trigger resolution order

**Objective:** Replace `executeTriggerEffect` front matter with IR / Effect Program.

**Changes:**
1. At start of `executeTriggerEffect`:
   - Build Effect Program from trigger effect text (respect intervening-if)
   - `startEffectProgramResolution` with `createOracleIREffectProgramHandlers`
   - Return early on `waiting_for_choice` or `completed`
2. `ORACLE_IR_TRIGGER_PRIMARY` defaults **on** via `oracleIrFeatureFlags.ts`; opt out with `ORACLE_IR_TRIGGER_PRIMARY=0` or `ORACLE_IR_TRIGGER_LEGACY=1`
3. Move high-volume regex shortcuts (draw a card, lose X life) behind IR parity tests, then delete
4. Retire `applyOracleIRFallbackForTriggeredEffect` once primary path covers same cases

**Exit criteria:**
- Trigger coverage audit unchanged (0 parse→execute gaps)
- Integration tests for top ETB / dies / attack trigger families
- Measurable reduction in `executeTriggerEffect` line count

**Primary files:** `stackResolve*OrchestratorUtils.ts`, `stackExecuteTriggerEffectUtils.ts`, `effectProgramResolutionService.ts`, `triggered-abilities.ts`

---

### Phase 3 — Complete choice UI wiring (extend R1)

**Objective:** Every `player_choice_required` gap from executor has a server queue + client UI + resume path.

**Batch order (by dry-run volume × gameplay frequency):**

1. **Already done:** scry, surveil, unless-pay, discard, proliferate, populate, explore, sacrifice, look-choose, connive, player_choice, add_mana (any-color + distribution), fateseal, clash (Effect Program), search_library, choose_pile, change_target
2. **Effect Program + server:** `choose_mode` (modal spells / PW -1 abilities)
3. **Lower priority:** ring tempts, move_counters edge cases; choose_pile card movement via legacy split flow

**Per-step checklist:**
- [ ] `build*SelectionOptions` in executor (if not exists)
- [ ] `queue*ChoicePromptsFromOracleIRResult` or Effect Program choice request
- [ ] Resolution handler validates + binds selections
- [ ] `maybeApplyOracleIrChoiceStepFromResolution` / Effect Program resume
- [ ] Client modal or reuse existing component
- [ ] `server/tests/oracle-ir-*.integration.test.ts`

**Exit criteria:** Full-card `choice_required` items either resolve in UI or documented as AI-only / manual ack

---

### Phase 4 — Delete duplicate shims

**Objective:** Remove redundant code paths after parity proof.

**Progress (batch 172):** Exert attack-reward corridor validated end-to-end under test harness (primary OFF) and primary-ON suites. Copy-token `create_token` steps with `"copy of …"` hints now resolve correctly in rules-engine (regex fix). Remaining exert-adjacent legacy: `grant_temporary_ability` combat evasion handlers, counter-scaled `modify_pt` (see session handoff).

**Delete or gut:**
- `applyOracleIRFallbackForUncategorizedSpell` — replace with thin wrapper calling `applyOracleIRStepsOnServer`
- Redundant `categorizeSpell` patterns superseded by IR
- `executeSpellEffect` opcodes with IR equivalents (table in appendix)
- Handwritten trigger regex blocks covered by integration tests

**Keep until Phase 5:**
- Stack-targeting opcodes (`COUNTER_TARGET_SPELL`, `CounterSpell`)
- Infrastructure not expressible as card oracle text

**Exit criteria:**
- `stack.ts` remains a re-export barrel; orchestrator modules shrink as IR primary grows
- No duplicate scry/surveil/discard queue paths

---

### Phase 5 — Planeswalker + special systems

**Objective:** Migrate remaining non-IR systems.

- Planeswalker loyalty → IR + Effect Program (`buildEffectProgramsFromOracleText` per loyalty ability)
- Supplemental oracle (`applySupplementalOracleIRForResolvedSpell`) → parser postprocess
- Card-specific stack branches (Rite of Harmony, Divine Reckoning, Summons of Saruman) → IR or explicit `unknown` + manual ack

---

## Testing strategy

### Required per migration slice

| Level | Location | Purpose |
|-------|----------|---------|
| Unit | `rules-engine/test/oracleIRExecutor*.test.ts` | Step handler correctness |
| Effect Program | `rules-engine/test/effectProgram.test.ts` | Choice chain + command resume |
| Server integration | `server/tests/oracle-ir-*.integration.test.ts` | End-to-end queue + resume |
| Shadow comparison | New: optional dual-run logger | Legacy vs IR state diff on spell resolve |
| Coverage audit | `npm run executor:coverage` | No new parse→execute gaps |

### Integration test template

Follow existing tests (`oracle-ir-discard.integration.test.ts` pattern):
1. Setup game state via test harness
2. Apply IR or cast/resolv spell
3. Assert resolution queue step type + metadata
4. Submit response
5. Assert zone/life/hand changes + queue empty

---

## Risks and invariants

| Risk | Mitigation |
|------|------------|
| **Double application** (IR + legacy both run) | Primary-path flag; early return when IR applies anything; idempotent queue keys (`sourceId` dedup) |
| **Optional steps auto-skipped** | Always use Effect Program or `allowOptional: true` with may-choice; never `if (optional) continue` |
| **Zone desync** | Always go through `applyOracleIRStepsOnServer` (hydrate + sync), never raw executor on `ctx.state` |
| **Replay desync** | Persist `oracleIrChoiceStepJson`, `oracleIrResumeStepsJson`, Effect Program metadata on resolution events (`applyEvent.ts`) |
| **AI auto-pick divergence** | AI handlers in `resolution.ts` / `ai.ts` must mirror new step types |
| **Targeting before IR** | Pass `chosenObjectIds`, `targetPermanentId`, `targetPlayerId` into `buildOracleIRExecutionContext` from stack item targets |

### Must preserve

- Mill replacement effects (`applyMillReplacementEffectsToSteps`)
- `haltOnPlayerChoiceRequired: true` on server (never auto-pick in live games unless AI)
- `interactivePlayerChoices: true` in server context
- Compound resume (unless-pay → sacrifice → tail)

---

## Appendix A — Opcode → IR step mapping (for Phase 4 retirement)

| `executeSpellEffect` opcode | IR step kind(s) |
|----------------------------|-----------------|
| `DrawCards` | `draw` |
| `QueueScry` / `QueueSurveil` | `scry` / `surveil` |
| `GainLife` / `LoseLife` | `gain_life` / `lose_life` |
| `RequestDiscard` | `discard` |
| `MillCards` | `mill` |
| `DestroyPermanent` | `destroy` |
| `MoveToExile` | `move_zone` (exile) |
| `DamagePlayer` / `DamagePermanent` | `deal_damage` |
| `AddCountersPermanent` | `add_counter` |
| `CreateToken` | `create_token` |
| `TapPermanent` / `UntapPermanent` | `tap_or_untap` |
| `CounterSpell` | `counter_spell` |

Opcodes that remain infrastructure-heavy (defer): `Broadcast`, ward payment flows, X cost selection.

---

## Appendix B — Server integration checklist (copy per feature)

```
[ ] Parser produces expected step kind(s)
[ ] Executor dry-run: fully_applied OR choice_required (not unsupported)
[ ] applyOracleIRStepsOnServer applies / halts correctly
[ ] queue* OR Effect Program choice queued with oracleIrChoiceStepJson / bindingKey
[ ] resolution.ts validates response + resumes tail
[ ] Client UI collects selection
[ ] Replay events include resume metadata
[ ] AI resolution handler exists
[ ] server/tests/oracle-ir-<feature>.integration.test.ts
[ ] Shadow log: legacy path would not double-apply
```

---

## Appendix C — Immediate next actions (suggested sprint)

1. **Phase 1 shadow mode** — IR-first spell resolve with logging only
2. **Wire `choose_mode` on server** via Effect Program for top modal spells (Charms, Commands)
3. **Delete `if (optional) continue`** in uncategorized fallback; route optional through Effect Program
4. **Add connive + player_choice queues** (next highest dry-run volume after scry/surveil)
5. **Document parity tests** for top 20 `categorizeSpell` opcodes before deleting them

---

## Document maintenance

Update this file when:
- A new `queue*ChoicePrompts` function ships
- Spell/trigger primary path flips to IR
- A handwritten subsystem is deleted (record in changelog section below)
- Executor audit metrics shift materially

### Changelog

| Date | Change |
|------|--------|
| 2026-06-10 | Stack refactor batch 172: exert integration corridor green (23/23). **Rules-engine:** `splitCopyTokenReference` now matches singular **copy of** (Sandstorm was creating generic `"Token"`). **Server:** Sandstorm tail guard when IR fallback applies tapped-attacking copy; defending-player `targetOpponentId` binding; `syncIrCopyTokenProvenanceFromOracleIRResult` + `syncIrAtNextEndStepTokenSacrificeFromOracleIRResult`; Glorybringer `pickFromControllerPool` target resolution; Hydra Trainer exert description normalization (Adapt bleed); Clockwork Droid unblockable/scry; `isTriggerEffectFullyIrWired()` routing helper. |
| 2026-06-10 | Stack refactor batch 171: fixed partial multi-step trigger fallthrough — primary IR skips apply when effect is not fully owned; tail uncategorized fallback no longer short-circuits legacy regex when only partially applied; added `pendingImpulseDraws` bridge for IR `impulse_exile_top` (Clockwork Droid exert + Anep impulse). |
| 2026-06-10 | Stack refactor batch 170: trigger primary falls through when IR only partially applies non-owned multi-step effects; added server bridge from IR `temporaryEffects` to legacy `temporaryAbilities` (step kind wiring deferred). |
| 2026-06-11 | Stack refactor batch 169: wired `double_counters` IR fallback step kind; gutted double-+1/+1-on-self trigger regex handler; deferred `grant_temporary_ability` wiring pending server `temporaryAbilities` bridge (exert regressions). |
| 2026-06-11 | Stack refactor batch 168: gutted chosen-type mass +1/+1 counter and equipped-creature copy token trigger regex handlers (`add_counter`/`create_token` IR steps); removed batch calls; kept Elspeth two-counter Angel rider, optional hand-to-battlefield, and combat-context token bridges. |
| 2026-06-11 | Stack refactor batch 167: gutted trigger regex handlers for indestructible self-counter, untap/tap-all-lands, each-other-type +1/+1, and power-scaled mass +1/+1 (`add_counter`/`tap_or_untap` IR steps); removed batch calls; kept double-counters, Elspeth rider, and optional hand-to-battlefield bridges. |
| 2026-06-11 | Stack refactor batch 166: gutted target-player token creation and generic library search trigger regex handlers; removed batch calls; kept Protean Hulk and card-specific search bridges. |
| 2026-06-11 | Stack refactor batch 165: gutted late-batch target life/damage handler and inline simple counter/tap-target paths; kept devotion scaling counters and mass untap/control-change tap handlers. |
| 2026-06-11 | Stack refactor batch 164: gutted retired trigger combined handlers for counter-then-draw, deal-damage-each-opponent-and-gain-life, and counter-then-deal-damage; removed body/batch calls; kept custom-queue optional discard/sacrifice and effectData counter riders. |
| 2026-06-11 | Stack refactor batch 163: gutted retired trigger regex handlers for predefined artifact tokens and generic creature tokens (`create_token` IR step); removed batch calls; kept combat-context and target-player token handlers. |
| 2026-06-11 | Stack refactor batch 162: gutted retired trigger regex handlers for discard, deal-damage-each-opponent, life-loss variants, and simple +1/+1 counter patterns; removed batch calls; kept compound/specialized counter handlers (Elspeth Angel rider, power-based, etc.). |
| 2026-06-11 | Stack refactor batch 161: gutted retired trigger single-effect regex handlers for draw/gain/scry/mill (kept compound you-gain-that-much-life); removed batch calls; wired `shouldSkipTriggerUncategorizedFallback` in trigger uncategorized fallback entry. |
| 2026-06-11 | Stack refactor batch 160: removed retired simple spell draw/gain legacy regex handlers; kept compound draw/discard/treasure/wheel patterns; wired `shouldSkipSpellUncategorizedFallback` in uncategorized spell fallback entry. |
| 2026-06-11 | Stack refactor batch 159: retired `TARGET_CREATURE`/`TARGET_PERMANENT`/`TARGET_PLAYER` categorize ops; added `choose_target_creature` to runtime-wired fallback kinds; routing assertions (sacrifice-target parity already covered). |
| 2026-06-11 | Stack refactor batch 158: expanded `ORACLE_IR_FALLBACK_STEP_KINDS` for queued step kinds (`explore`, `connive`, `unless_pays_*`, `conditional`, `search_library`, look-choose, `choose_pile`, `change_target`) so IR primary ownership skips legacy body for those-only effects. |
| 2026-06-11 | Stack refactor batch 157: wired `blight` IR step kind with server `keywordBlight` TARGET_SELECTION bridge; retired all five `BLIGHT_*` categorize ops; production-default + legacy-forced spell/trigger blight parity; routing assertions. |
| 2026-06-11 | Stack refactor batch 156: wired `schedule_delayed_trigger` IR step kind with server `pendingFlickerReturns` bridge for delayed battlefield returns; retired `FLICKER_TARGET` categorize op (immediate flicker via `exile`+`move_zone`, delayed via `schedule_delayed_trigger`); production-default + legacy-forced spell parity; routing assertions. |
| 2026-06-10 | Stack refactor batch 155: extended `counter_spell` IR executor to counter stack abilities (not just spells); retired `COUNTER_TARGET_ABILITY` categorize op; production-default + legacy-forced spell parity; routing assertions. |
| 2026-06-10 | Stack refactor batch 154: retired `DESTROY_ALL_TARGET_PLAYER`/`EXILE_ALL_TARGET_PLAYER` categorize ops; production-default + legacy-forced spell/trigger scoped mass-destroy/exile parity; routing assertions. |
| 2026-06-10 | Stack refactor batch 153: wired `goad`/`proliferate`/`populate` IR step kinds; retired `SURVEIL_TARGET_PLAYER`, `GOAD_TARGET`, and mass tap/untap categorize ops; production-default + legacy-forced spell/trigger parity; routing assertions. |
| 2026-06-10 | Stack refactor batch 152: wired `investigate` IR step kind in fallback runtime wiring; retired scry/surveil each-player/each-opponent + `INVESTIGATE` categorize ops; production-default + legacy-forced spell/trigger parity; routing assertions. |
| 2026-06-10 | Stack refactor batch 151: retired `MILL_SELF` + draw-variant categorize ops (`DRAW_CARDS_EACH_OPPONENT`, `DRAW_CARDS_EACH_PLAYER`, `DRAW_TARGET_PLAYER`); production-default + legacy-forced spell draw/mill-self parity; routing assertions. |
| 2026-06-10 | `choose_pile` + `change_target` queue/resume wiring; `applyChangeTargetStep` replaces main-loop stub; `add_mana` added to halt set (distribution sequences). |
| 2026-06-10 | `search_library` halts when `matches.length > maxResults`; `queueSearchLibraryChoicePromptsFromOracleIRResult` + resume via `LIBRARY_SEARCH` / `oracleIrChoiceStepJson`. |
| 2026-06-10 | Fateseal/clash Effect Program server integration tests (`oracle-ir-fateseal-clash-effect-program`); spell/trigger primary paths already route these via `requiresEffectProgramOrchestration` + `startOracleEffectProgramOnServer`. |
| 2026-06-10 | Connive resume fix: `oracleIrTargetPermanentId` on queued discard step; connive integration test passes. `queueAddManaChoicePromptsFromOracleIRResult` wires any-color `add_mana` through `MANA_COLOR_SELECTION` + IR resume (skips legacy pool path when `oracleIrChoiceStepJson` set). |
| 2026-06-10 | Phase 3 batch: `queueConniveChoicePromptsFromOracleIRResult` + `queuePlayerChoicePromptsFromOracleIRResult`; connive draws before discard pause; player_choice letter/odd_even/card_type via OPTION/CREATURE_TYPE prompts. |
| 2026-06-10 | Phase 3 started: `oracleIrEffectProgramServer.ts` routes unresolved `choose_mode`/optional/fateseal/clash through Effect Program (`startOracleEffectProgramOnServer`); zone sync after EP runs in `effectProgramResolutionService`. |
| 2026-06-10 | Phase 2 started: `oracleIrTriggerExecution.ts` — IR-first trigger resolve with `ORACLE_IR_TRIGGER_PRIMARY` flag; shadow probe before `executeTriggerEffect` regex corpus. |
| 2026-06-10 | Phase 1 started: `oracleIrSpellExecution.ts` — IR-first spell resolve with `ORACLE_IR_SPELL_PRIMARY` flag; shadow probe logs when legacy would also match. Optional steps in uncategorized fallback delegate to `applyOracleIRStepsOnServer`. |
| 2026-06-10 | Stack refactor batch 150: retired `ADD_COUNTERS_EACH` categorize op (`add_counter` already wired); production-default + legacy-forced spell/trigger add-counter-each parity; routing assertions. |
| 2026-06-10 | Stack refactor batch 149: retired `ADD_COUNTERS_TARGET` categorize op (`add_counter` already wired); guard legacy target-buff regex against categorize double-apply; production-default + legacy-forced spell/trigger add-counter-target parity; routing assertions. |
| 2026-06-10 | Stack refactor batch 148: retired `TAP_TARGET`/`UNTAP_TARGET` categorize ops (`tap_or_untap` already wired); production-default + legacy-forced spell/trigger tap-target-creature parity; routing assertions. |
| 2026-06-10 | Stack refactor batch 147: wired `counter_spell` IR step kind; retired `COUNTER_TARGET_SPELL`; production-default + legacy-forced spell/trigger counter-target-spell parity; routing assertions. |
| 2026-06-10 | Stack refactor batch 146: wired `move_zone` IR step kind + `return` uncategorized prefilter; retired `BOUNCE_TARGET`; fixed stack target-legality bounce fizzle + sacrifice-target IR binding; production-default + legacy-forced spell/trigger bounce/graveyard-exile/sacrifice parity; routing assertions. |
| 2026-06-10 | Stack refactor batch 145: `EXILE_ALL`/`EXILE_TARGET` scoped variant coverage (opponents control, nonland permanent); spell/trigger primary + legacy-forced parity; routing assertions. |
| 2026-06-10 | Stack refactor batch 144: wired `exile` IR step kind + uncategorized prefilter; retired `EXILE_TARGET`/`EXILE_ALL` categorize ops; production-default + legacy-forced spell/trigger exile (target/all/each) parity; routing assertions. |
| 2026-06-10 | Stack refactor batch 143: retired `DESTROY_EACH`/`DESTROY_ALL` categorize ops; planeswalker-only `DAMAGE_EACH` variant coverage; production-default + legacy-forced spell/trigger mass-destroy parity; routing assertions. |
| 2026-06-10 | Stack refactor batch 142: `DAMAGE_EACH` scoped/multi-filter variant coverage (you control, opponents control, creature+planeswalker); spell/trigger primary + legacy-forced parity; routing assertions. |
| 2026-06-10 | Stack refactor batch 141: retired `DAMAGE_EACH` categorize op; production-default + legacy-forced spell/trigger each-creature damage; opponent-scoped `DAMAGE_TARGET` spell/trigger coverage; routing parity. |
| 2026-06-10 | Stack refactor batch 140: retired `ANY_TARGET_DAMAGE`/`DAMAGE_TARGET` categorize ops; production-default + legacy-forced spell/trigger creature-token and targeted-damage (any target + creature) coverage; routing parity. |
| 2026-06-10 | Stack refactor batch 139: retired `CREATE_TOKEN` + damage categorize ops (`DAMAGE_TARGET_PLAYER`/`DAMAGE_EACH_OPPONENT`/`DAMAGE_EACH_PLAYER`); production-default + legacy-forced spell/trigger create-token and deal-damage coverage; spell/trigger routing parity. |
| 2026-06-10 | Stack refactor batch 138: spell categorize-parity for each-opponent/each-player discard/mill; retired categorize-op documentation; stack orchestrator import guardrail; trigger legacy-parity each-player discard queue assertion. |
| 2026-06-10 | Stack refactor batch 137: legacy-forced each-player discard/mill trigger (IR uncategorized fallback) + spell (categorize) parity; trigger routing/handler-retirement each-player discard/mill coverage. |
| 2026-06-10 | Stack refactor batch 136: retired `DISCARD_EACH_OPPONENT`/`DISCARD_EACH_PLAYER`/`MILL_EACH_OPPONENT`/`MILL_EACH_PLAYER` spell categorize ops; multi-player discard queue via `collectDiscardSelectionOptionsForStep`; production-default each-player discard/mill trigger + spell coverage. |
| 2026-06-10 | Stack refactor batch 135: each-opponent discard/mill trigger + spell parity (production default + legacy forced); spell routing destroy/mill skip assertions; each-opponent categorize still legacy-only (`DISCARD_EACH_OPPONENT`/`MILL_EACH_OPPONENT` not retired). |
| 2026-06-10 | Stack refactor batch 134: production-default trigger destroy; legacy-forced trigger mill/destroy; trigger routing + handler retirement for destroy/mill. |
| 2026-06-10 | Stack refactor batch 133: discard `chosenObjectIds` hand-card filter in `applyDiscardStep`; `RequestDiscard` queues `DISCARD_SELECTION`; production-default trigger surveil/mill + spell discard/destroy/mill; legacy-forced trigger surveil + spell destroy/mill parity. |
| 2026-06-10 | Stack refactor batch 132: legacy modal gain-life resume (`mode_2`); legacy-forced scry/surveil/discard spell + trigger scry/discard; spell routing scry/surveil/discard parity; production-default trigger discard; discard hand-card filter + `RequestDiscard` resolution-queue bridge. |
| 2026-06-10 | Stack refactor batch 131: legacy unresolved modal at resolve time (`modalSpellResolve` MODE_SELECTION queue + resume); legacy-forced modal queue/resume integration tests; wired `resolution.ts` resume handler. |
| 2026-06-10 | Stack refactor batch 130: gain-life opcode matrix complete (`GAIN_LIFE_EACH_OPPONENT`/`GAIN_LIFE_EACH_PLAYER` retired ops); production-default + legacy-forced spell/trigger gain-life variants; trigger lose-life target-player parity. |
| 2026-06-10 | Stack refactor batch 129: `LOSE_LIFE_EACH_PLAYER` spell categorize-parity + routing; production-default/legacy-forced each-player and each-opponent lose-life spell/trigger coverage completes lose-life opcode matrix. |
| 2026-06-10 | Stack refactor batch 128: lose-life target/each-opponent spell categorize-parity + routing; production-default and legacy-forced trigger each-opponent lose-life; legacy modal `mode_2` gain-life + legacy spell lose-life target player. |
| 2026-06-10 | Stack refactor batch 127: legacy modal pre-select bridge (`stackResolveSpellLegacyModalUtils.ts`) when spell legacy forced; legacy-forced trigger lose-life + modal draw tests; trigger routing lose-life skip coverage. |
| 2026-06-10 | Stack refactor batch 126: `LOSE_LIFE` (+ target/each variants) in `ORACLE_IR_SPELL_RETIRED_CATEGORIZE_OPS`; spell legacy routing + categorize-parity lose-life coverage. |
| 2026-06-10 | Stack refactor batch 125: production-default spell lose-life; legacy-forced spell lose/gain-life + trigger gain-life; spell legacy gain-life regex when `ORACLE_IR_SPELL_PRIMARY=0`. |
| 2026-06-10 | Stack refactor batch 124: `oracle-ir-legacy-forced.integration.test.ts` (spell categorize + trigger regex draw when `ORACLE_IR_*_LEGACY=1`); production-default gain/lose-life spell/trigger coverage. |
| 2026-06-10 | Stack refactor batch 123: gain-life modal mode coverage under production default (spell + trigger, pre-select `mode_2` and EP resume); spell legacy draw regex still applies when `ORACLE_IR_SPELL_PRIMARY=0`. |
| 2026-06-10 | Stack refactor batch 122: production-default modal Effect Program resume (spell + trigger); `oracle-ir-trigger-modal-primary-default.integration.test.ts` for trigger modal pre-select, EP queue, and resume under cleared env. |
| 2026-06-10 | Stack refactor batch 121: `oracle-ir-modal-spell-primary-default.integration.test.ts` (production-default modal + Effect Program mode queue); inlined `skipRetired*` routing (removed redundant `shouldRetire*LegacyRegexHandlerForEffect` aliases). |
| 2026-06-10 | Stack refactor batch 120: removed dead `resolveSkipLegacySpellRegexHandlers` wrapper (body handlers self-guard via `skipRetiredSpellLegacyHandler`); synced monolithic trigger guardrail with body-utils extraction and ability handler options object. |
| 2026-06-10 | Stack refactor batch 119: trigger routing exports on stack barrel; scoped trigger guardrail test; spell body utils simplified (handlers self-guard, no redundant skip wrapper). |
| 2026-06-10 | Stack refactor batch 118: trigger primary-default integration test; `npm run test:oracle-ir-migration` script (19 files). |
| 2026-06-10 | Stack refactor batch 117: spell primary-default integration test; spell guardrail stack-barrel scan. |
| 2026-06-10 | Stack refactor batch 116: guards on copy-stack riders, `handleDispatch`, `executeInstantSorceryLegacyCategorizedSpell`; spell legacy guardrail test. |
| 2026-06-10 | Stack refactor batch 115: extended `skipRetiredSpellLegacyHandler` to library/control/removal/target-buff/post-categorize/multiplayer modules. |
| 2026-06-10 | Stack refactor batch 114: `skipRetiredSpellLegacyHandler`; defense-in-depth on draw/gain regex handlers; spell handler retirement unit test. |
| 2026-06-10 | Stack refactor batch 113: `shouldSkipLegacySpellBodyHandlers`; extracted `stackResolveInstantSorceryLegacyBodyUtils.ts`; structural preface vs body bypass. |
| 2026-06-10 | Stack refactor batch 112: spell IR primary defaults ON via `oracleIrFeatureFlags.ts`; opt-out with `ORACLE_IR_SPELL_PRIMARY=0` or `ORACLE_IR_SPELL_LEGACY=1`; vitest harness forces spell legacy off by default. |
| 2026-06-10 | Stack refactor batch 111: trigger IR primary defaults ON via `oracleIrFeatureFlags.ts`; opt-out with `ORACLE_IR_TRIGGER_PRIMARY=0` or `ORACLE_IR_TRIGGER_LEGACY=1`; vitest harness forces legacy off by default. |
| 2026-06-10 | Stack refactor batch 110: `shouldSkipLegacyTriggerBodyHandlers` bypasses legacy body regex chain when IR primary owns effect (after structural graveyard handlers); tail still runs copy bridge + parity logging. |
| 2026-06-10 | Stack refactor batch 109: extended `skipRetiredTriggerLegacyHandler` to preface (casting/graveyard permission), game-state hooks, desc-prep keyword grant, and single/late regex batch entry short-circuit. |
| 2026-06-10 | Stack refactor batch 108: extended `skipRetiredTriggerLegacyHandler` to resolution, graveyard, card-specific, timing, library, target-damage, self-reflexive, graveyard-zone, turn/zone, mana/combat, PT-mod, combat-damage, keyword, life/game, special-trigger, and sacrifice legacy modules. |
| 2026-06-10 | Stack refactor batch 107: extended `skipRetiredTriggerLegacyHandler` to remaining token attack/block/count variants, search reveal-until, counter inline batch, and combined-effect legacy handlers. |
| 2026-06-10 | Stack refactor batch 106: centralized `skipRetiredTriggerLegacyHandler` in routing; extended defense-in-depth to token/search/combat-evasion/tap-untap legacy handler modules. |
| 2026-06-10 | Stack refactor batch 105: extended `skipRetiredTriggerLegacyHandler` defense-in-depth to discard/mill/damage/counter/tap-land legacy regex handlers; batch call sites pass `sourceName` for routing checks. |
| 2026-06-10 | Stack refactor batch 104: defense-in-depth `shouldRetireTriggerLegacyRegexHandlerForEffect` on draw/gain-life/lose-life/scry legacy regex handlers; parity asserts `pendingScry` unused under IR primary. |
| 2026-06-10 | Stack refactor batch 103: `queueCopyPermanentChoicePromptsFromOracleIRResult` bridges skipped/pending `copy_permanent` steps to `trigger-copy-permanent.ts` during `applyOracleIRStepsOnServer`; primary-mode direct IR test for Cryptoplasm upkeep copy. |
| 2026-06-10 | Stack refactor batch 102: `copyPermanentTriggerStepNeedsTargetSelectionQueue`; IR trigger primary defers copy_permanent target selection to `trigger-copy-permanent.ts`; guardrails for `collectOracleEffectSteps` fragment-first order and always-on copy fallback tail. |
| 2026-06-10 | Stack refactor batch 101: `collectOracleEffectSteps` prefers trigger-fragment parsing (fixes Cryptoplasm `copy_permanent`); copy special handlers always run; tail always invokes IR fallback; vitest setup clears `ORACLE_IR_*_PRIMARY` between tests. |
| 2026-06-10 | Stack refactor batch 100: all server tests decoupled from stack barrel (57 files → concrete orchestrator imports); guardrail forbids test imports from `modules/stack`. |
| 2026-06-10 | Stack refactor batch 99: ability dispatch shares `StackActivatedAbilityHandlerContext`; ability handlers barrel re-exports context type; migration-suite tests + production guardrail for stack-barrel imports. |
| 2026-06-10 | Stack refactor batch 98: `replay.ts`, `state/index.ts`, `interaction.ts`, and `resolution.ts` decoupled from stack barrel (direct push/resolve/playLand/ETB/trigger imports). |
| 2026-06-10 | Stack refactor batch 97: `turn.ts`, `kynaiosChoice.ts`, and `applyEvent.ts` decoupled from stack barrel; skip removal riders when IR spell primary already handled; restored dropped day-night/turn-tracking helpers. |
| 2026-06-10 | Stack refactor batch 96: `categorizeSpell` suppresses retired opcodes under spell primary; `counters_tokens` imports ETB from `triggerEtbPermanentEffects` (not stack barrel). |
| 2026-06-10 | Stack refactor batch 95: restored `stack.ts` re-export barrel; `StackActivatedAbilityHandlerContext` for early/mid ability handlers. |
| 2026-06-10 | Stack refactor batch 94: `StackActivatedAbilityLateHandlerOptions` in shared types; late handler + dispatch use options object. |
| 2026-06-10 | Stack refactor batch 93: `ORACLE_IR_SPELL_RETIRED_STEP_KINDS` synced to runtime-wired fallback + optional step kinds (mirrors trigger batch 92). |
| 2026-06-10 | Stack refactor batch 92: `ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS` synced to runtime-wired fallback + optional trigger step kinds. |
| 2026-06-10 | Stack refactor batch 91: `TriggeredAbilityDeferralOptions` in shared types; deferral utils typed against shared contract. |
| 2026-06-10 | Stack refactor batch 90: permanent spell entry/post-entry types (`PermanentBattlefieldEntryOutcome`, `PermanentBattlefieldEntryOptions`, `PermanentSpellPostEntryOptions`) in shared types. |
| 2026-06-10 | Stack refactor batch 89: `InstantSorcerySpellShapeFlags` moved to `stackResolveSharedTypes.ts`; shape detector re-exports from shared types. |
| 2026-06-10 | Stack refactor batch 88: `InstantSorceryPrefaceContinuation` composes shape/outcome/metadata types; added `InstantSorceryOracleIrSpellOptions` + `InstantSorceryRemovalTargetMetadataOptions`. |
| 2026-06-10 | Stack refactor batch 87: `InstantSorceryOracleIrSpellOutcome` + `InstantSorceryRemovalTargetMetadata` moved to `stackResolveSharedTypes.ts`. |
| 2026-06-10 | Stack refactor batch 86: shared resolve option types (`InstantSorceryStackResolveOptions`, `PermanentSpellStackResolveOptions`, `TriggeredAbilityStackResolveOptions`); removed `ExecuteTriggerEffectForSpellFn` alias. |
| 2026-06-10 | Stack refactor batch 85: `TriggerEffectLegacyBodyContinuation` + `TriggerEffectLegacyBodyResult` moved to `stackResolveSharedTypes.ts`; tail imports shared types (not legacy body). |
| 2026-06-10 | Stack refactor batch 84: `InstantSorceryPrefaceContinuation` + `InstantSorceryPrefaceResult` moved to `stackResolveSharedTypes.ts`; legacy resolution imports shared types (not preface). |
| 2026-06-10 | Stack refactor batch 83: `ResolveTopOfStackContinuation` + `ResolveTopOfStackPrefaceResult` moved to `stackResolveSharedTypes.ts`; preface re-exports; dispatch imports shared types (not preface). |
