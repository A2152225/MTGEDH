# Oracle IR Server Migration Plan

**Purpose:** Plan the full supersession of handwritten spell/trigger/ability resolution with Oracle IR execution and the Effect Program orchestrator.

**Last updated:** 2026-06-10  
**Owner:** Project maintainers  
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
| **Triggered ability** | `executeTriggerEffect` (~26k lines of matchers) | **Tail fallback** — `applyOracleIRFallbackForTriggeredEffect` → same uncategorized fallback |
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
2. Feature flag: `ORACLE_IR_SPELL_PRIMARY=1` for gradual rollout
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
2. Move high-volume regex shortcuts (draw a card, lose X life) behind IR parity tests, then delete
3. Retire `applyOracleIRFallbackForTriggeredEffect` once primary path covers same cases

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
| 2026-06-10 | `choose_pile` + `change_target` queue/resume wiring; `applyChangeTargetStep` replaces main-loop stub; `add_mana` added to halt set (distribution sequences). |
| 2026-06-10 | `search_library` halts when `matches.length > maxResults`; `queueSearchLibraryChoicePromptsFromOracleIRResult` + resume via `LIBRARY_SEARCH` / `oracleIrChoiceStepJson`. |
| 2026-06-10 | Fateseal/clash Effect Program server integration tests (`oracle-ir-fateseal-clash-effect-program`); spell/trigger primary paths already route these via `requiresEffectProgramOrchestration` + `startOracleEffectProgramOnServer`. |
| 2026-06-10 | Connive resume fix: `oracleIrTargetPermanentId` on queued discard step; connive integration test passes. `queueAddManaChoicePromptsFromOracleIRResult` wires any-color `add_mana` through `MANA_COLOR_SELECTION` + IR resume (skips legacy pool path when `oracleIrChoiceStepJson` set). |
| 2026-06-10 | Phase 3 batch: `queueConniveChoicePromptsFromOracleIRResult` + `queuePlayerChoicePromptsFromOracleIRResult`; connive draws before discard pause; player_choice letter/odd_even/card_type via OPTION/CREATURE_TYPE prompts. |
| 2026-06-10 | Phase 3 started: `oracleIrEffectProgramServer.ts` routes unresolved `choose_mode`/optional/fateseal/clash through Effect Program (`startOracleEffectProgramOnServer`); zone sync after EP runs in `effectProgramResolutionService`. |
| 2026-06-10 | Phase 2 started: `oracleIrTriggerExecution.ts` — IR-first trigger resolve with `ORACLE_IR_TRIGGER_PRIMARY` flag; shadow probe before `executeTriggerEffect` regex corpus. |
| 2026-06-10 | Phase 1 started: `oracleIrSpellExecution.ts` — IR-first spell resolve with `ORACLE_IR_SPELL_PRIMARY` flag; shadow probe logs when legacy would also match. Optional steps in uncategorized fallback delegate to `applyOracleIRStepsOnServer`. |
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
