# Rules Interaction Priority Audit

**Purpose:** Separate **“can we read the card?”** (parse/execute dry-run) from **“does live play behave correctly?”** (Layer 3 integration). Use this doc to decide what to push first.

**Last updated:** 2026-06-12  
**Audience:** Maintainers deciding between parser batches vs integration/socket/UI work  
**Companion docs:**
- End-state architecture: [oracle-ir-server-migration-plan.md](./oracle-ir-server-migration-plan.md)
- Parser/executor metrics: [oracle-automation-remaining-work.md](./oracle-automation-remaining-work.md)
- Live-play session fixes: [oracle-ir-session-handoff.md](./oracle-ir-session-handoff.md)
- Card-family checklist (older): [full-game-card-support-todo.md](./full-game-card-support-todo.md)

---

## Executive summary

| Question | Answer |
|----------|--------|
| Is parsing the bottleneck? | **No.** ~30k cards parse; trigger `ir_gap` = **0**; assisted trigger dry-run = **100%** (15,012 effects). |
| Is dry-run execution the bottleneck? | **Mostly no.** Trigger-assisted fixture: **0** parse→execute gaps. Full-card scope: **~99.6%** assisted (4 partial fixtures remain per migration plan). |
| What actually breaks games? | **Layer 3** — server routing, event batching, resolution queue/UI, legacy fallbacks running alongside IR, and systems that never touch IR at all (combat declare path, mana module, planeswalker templates). |
| Should we keep doing parser batches first? | **Only when** they unblock a **known live failure** or a **server queue wiring** gap. Otherwise prioritize integration + retire parallel paths. |

**Rule of thumb:** A card is not “supported” until a human (or socket integration test) can complete the interaction through the same path production uses — not because `applyOracleIRStepsToGameState` succeeded in a fixture.

---

## Definition of done (interaction-level)

Borrowed from [full-game-card-support-todo.md](./full-game-card-support-todo.md) § Done Criteria — still the right bar:

1. Oracle text verified from local index / Scryfall (not training data).
2. Rules-engine can parse **and** execute the effect clause (or the effect is intentionally non-IR, e.g. planeswalker loyalty template).
3. **Server live runtime** resolves through the production path (`ORACLE_IR_*_PRIMARY` defaults ON).
4. Player choices use **ResolutionQueueManager** (+ client prompt handlers in `App.tsx`) — no orphan `pending*` socket state.
5. AI can legally complete or decline without corrupting state.
6. UI shows cost estimates, prompts, and outcomes clearly enough for real play.
7. Replay persists enough to reconstruct the result.
8. Focused test: accept, decline, no-legal-targets, replay where applicable.

---

## Three-layer status (2026-06-12)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ LAYER 1 — Parse (rules-engine)              GREEN  (~30k cards, 0 gaps) │
├─────────────────────────────────────────────────────────────────────────┤
│ LAYER 2 — Execute dry-run (rules-engine)    GREEN  (triggers 100% assist)│
│                                             ~GREEN (full_card 99.6%)    │
├─────────────────────────────────────────────────────────────────────────┤
│ LAYER 3 — Server integrate + live play      PARTIAL ← prioritize here   │
│   • IR primary ON in production                                           │
│   • Legacy spell categorize + trigger regex still active on miss        │
│   • Effect Program not default for modal/multi-choice spells              │
│   • Some IR step kinds lack server queue + resume                         │
│   • Parallel combat/mana/pillowfort paths outside IR                    │
└─────────────────────────────────────────────────────────────────────────┘
```

**Production flags** (`server/src/state/modules/oracleIrFeatureFlags.ts`):

| Flag | Production | Vitest default (`server/tests/vitest.setup.ts`) |
|------|------------|--------------------------------------------------|
| `ORACLE_IR_TRIGGER_PRIMARY` | **ON** | **OFF** |
| `ORACLE_IR_SPELL_PRIMARY` | **ON** | **OFF** |

Most of the ~6k+ server tests exercise **legacy coexistence**, not production IR-primary behavior. The migration gate (`npm run test:oracle-ir-migration`, **649 tests**) reflects production defaults.

---

## What is implemented properly (live play)

These systems are **production-viable** with tests and/or recent live validation. Gaps are edge cases, not “system missing.”

| System | Status | Key integration |
|--------|--------|-----------------|
| **Activated abilities** | Strong | IR primary: `oracleIrAbilityExecution.ts` → `applyOracleIRStepsOnServer` |
| **Turn / phases / cleanup** | Strong | `server/src/state/modules/turn.ts`, step-entry trigger persistence |
| **State-based actions** | Strong | `counters_tokens.ts` (`runSBA`), post-stack and post-damage |
| **Replacement effects (leave BF)** | Strong | Shared helpers + `leave-battlefield-replacement.integration.test.ts` |
| **Combat damage + batching** | Strong | APNAP combat triggers in `turn.ts` / `combat.ts` |
| **Goad** | Strong | `goad-effects.ts` + rules-engine `getGoadedBy` |
| **Exert corridor** | Strong | `exert-choice.integration.test.ts` (23/23) |
| **Resolution queue (core)** | Strong | `resolution/`, `socket/resolution.ts` — discard, target, scry, unless-pay, etc. |
| **Tap trigger plumbing** | Good (recent) | `tap-trigger-queue.ts` + `collectTapTriggersForTapEvent` batching for “one or more” |
| **Token creation + doublers** | Good | IR + `replacement-effects.ts` / `oracleIrServerZoneSync.ts` |
| **Graveyard permission windows** | Good | `full-game-card-support-todo.md` §1–3 largely closed |
| **Chosen creature type (ETB + tribal)** | Good | `shared/src/creatureTypes.ts`, batch 279 |

---

## What is NOT implemented properly (high risk)

These cause the bugs users actually see. Ordered by **impact on real games**.

### P0 — Wrong behavior / silent failure / game stall

| Issue | Why it happens | Push first |
|-------|----------------|------------|
| **IR partial apply → legacy also runs** | Multi-step IR returns `handled:false` but tail/regex still fires → **double tokens/effects** | Enforce all-or-nothing in `oracleIrTriggerExecution.ts` / `oracleIrStepWiring.ts`; extend tail guards |
| **Legacy trigger regex corpus (31 modules)** | `oracleIrTriggerLegacy*.ts` still runs on IR miss in production | Retire handlers where `isTriggerEffectFullyIrWired()`; grep `applyRetiredTriggerLegacy*` |
| **Spell uncategorized fallback** | `oracleIrUncategorizedSpellFallback.ts` re-implements ~20 step kinds instead of full IR resume | Route misses through `applyOracleIRStepsOnServer` only |
| **Modal / `choose_mode` spells** | Effect Program parses; server default path still categorize/legacy | Pattern B: EP primary for modals on server (`effectProgramResolutionService.ts`) |
| **Combat declare path parallel to IR** | `combat.ts` inline declare + bespoke pillowfort regex (not `pillowfortEffects.ts`) | Unify attack tax; expose cost via view |
| **Planeswalker loyalty** | ~100-case template resolver, non-IR | Lower priority unless loyalty bugs reported; document as intentional non-IR |

### P1 — Generic interaction plumbing (unlocks many cards)

| Issue | Gap | Key files |
|-------|-----|-----------|
| **Event batching** | “One or more X” triggers must fire **once per event**, not per permanent | `collectTapTriggersForTapEvent`, combat damage batching pattern in `turn.ts` — **extend pattern** to other batch events |
| **IR step → server queue** | Executor pauses; server never prompts | See migration plan table ~1158–1194: `copy_spell`, `move_counters`, `ring_tempts_you`, distribution `add_mana` |
| **Effect Program resume** | Multi-choice chains stall if EP step not surfaced | `oracleIrTriggerExecution.ts` `waitingForChoice` must return `handled:true` (Surgespanner class) |
| **Trigger detection gaps** | 15 triggers `not_detected` in trigger coverage (e.g. cast-to-modify-type) | `trigger-coverage-audit.ts` — Door of Destinies, Reflections of Littjara |
| **Replacement player choice** | `CHOOSE_REPLACEMENT` UI open | `oracle-automation-remaining-work.md` §6 |
| **Same-controller trigger order** | `ORDER_TRIGGERS` UI open | ibid. |

### P2 — Live-play verification debt (code may be fixed; play unproven)

From batch 279 / G1 — **socket E2E or live retest required**:

| Card / interaction | Code status | Missing verification |
|--------------------|-------------|-------------------|
| Thassa's Oracle library reorder | IR + `LIBRARY_SEARCH` wired | Socket integration test |
| Roaming Throne + Kumena +1/+1 | Chosen type should work | Socket tribal test |
| Deeproot Pilgrimage (attack batch) | Batched in `collectTapTriggersForTapEvent` | Live retest with doublers |
| Windborn Muse attack tax | Server payment + client estimate | Live retest after pillowfort unify |
| Eldrazi Monument | Upkeep deduped | Indestructible static cleanup after monument leaves |
| Master of the Wild Hunt tap | Parser gap: divided retaliate damage (`unknown-step`) | IR parser + activated server path |
| Auto-pass / floating mana | Prior fixes | Live retest |

### P3 — Parser work that does NOT unblock live play (deprioritize)

| Item | Notes |
|------|-------|
| More `ir_gap` closure on static text | Full-card `ir_gap` already **0** |
| Shock lands “enters tapped unless…” (~100 cards) | Separate static parser backlog; rarely blocks Commander sessions |
| Attractions Visit, equip variants | Documented open in `oracle-automation-remaining-work.md` §8 |

---

## Parallel paths = technical debt AND bug source

When two pipelines can resolve the same effect, players get wrong outcomes. Known parallel stacks:

```
Oracle text
    ├─► [PRIMARY] applyOracleIRStepsOnServer (oracleIrServerZoneSync.ts)
    │       └─► Resolution queue prompts → resume
    │
    ├─► [SPELL FALLBACK] categorizeSpell → executeSpellEffect (targeting.ts)
    │       └─► oracleIrUncategorizedSpellFallback.ts (partial IR re-impl)
    │
    └─► [TRIGGER FALLBACK] executeTriggerEffect regex (oracleIrTriggerLegacy*.ts)
            └─► stackExecuteTriggerEffectIrFallbackUtils.ts (tail)
```

**Retirement criterion:** `isTriggerEffectFullyIrWired()` / `isOracleIrExecutionHandled()` true **and** socket integration test under production flags.

**Do not add:** new `KNOWN_*` table rows, card-name routing, or per-card socket handlers (see `.cursor/rules/oracle-ir-no-bespoke-handlers.mdc`).

---

## Trigger coverage snapshot (2026-06-12)

Command: `cd server && npm run trigger:coverage`

| Metric | Value |
|--------|------|
| Cards scanned | 30,814 |
| Triggers parsed | 15,741 |
| `fully_covered` | 15,726 |
| `not_detected` | **15** |
| `effect_ir_gap` | **0** |

Top undetected cast pattern: `you cast a spell` modifiers (Door of Destinies, Reflections of Littjara, Chronicle of Victory) — **detection** issue, not executor.

---

## Recommended work order (push this first)

### Sprint A — Prove Layer 3 (1–2 sessions)

Stop parser batches unless tied to a row below.

1. **Thassa's Oracle socket test** — ETB → `LIBRARY_SEARCH` → reorder → devotion win  
2. **Roaming Throne + Kumena/Deeproot socket test** — tribal + tap batch + doubler  
3. **Live G1 retest checklist** (handoff doc) after server restart  
4. **Windborn Muse / pillowfort** — server uses `rules-engine/src/pillowfortEffects.ts`; client reads tax from view (delete triplicate regex)

### Sprint B — Close the fallback hazard (ongoing)

1. Pick top **live-reported** trigger family still hitting legacy regex (grep server logs / user reports)  
2. Wire IR fully + add `isTriggerEffectFullyIrWired` retirement + migration test  
3. Repeat — goal: shrink `oracleIrTriggerLegacy*.ts` call surface

### Sprint C — Modal / Effect Program on server

1. `choose_mode` end-to-end for modal spells (not EP-only in tests)  
2. Ensure `waitingForChoice` never falls through to legacy (optional triggers, Surgespanner-style)

### Sprint D — Event-model correctness

1. Audit other **“one or more”** event types (damage, die, mill batch) for per-item over-firing  
2. Mirror `collectTapTriggersForTapEvent` pattern where needed

### Sprint E — Detection gaps (only when cards matter in play)

1. Fix 15 `not_detected` triggers from `trigger-coverage-audit.json`  
2. Master of the Wild Hunt activated: parser gap on divided fight-back + server activated resume

---

## What continuing “migration efforts” would and would NOT fix

| User-visible bug class | Would migration alone fix it? |
|------------------------|----------------------------|
| Deeproot firing per attacker | **No** — needs event batching (now fixed generically) |
| Windborn Muse no tax UI | **No** — needs view/combat integration |
| Surgespanner no bounce UI | **Partially** — EP `waitingForChoice` server flag |
| MOTWH upkeep | **Likely yes** — generic upkeep + IR token create (if trigger fires) |
| MOTWH tap fight | **Not yet** — parser `unknown-step` on retaliate clause |
| Double tokens (Sandstorm class) | **Partially** — needs tail guards + no partial `handled:true` |
| Modal spell wrong mode | **Not until** EP is server-primary for modals |

**Conclusion:** Migration (Layer 3) is the right direction, but **integration batches** (279-style) outperform **parser batches** (278-style) for playability right now.

---

## Verification commands

```powershell
# Production-default IR gate (649 tests)
cd D:\Git\MTGEDH\server
npm run test:oracle-ir-migration

# G1 / tribal / tap batch regressions
npx vitest run tests/g1-card-fixes.unit.test.ts tests/roaming-throne-chosen-type.unit.test.ts tests/attack-cost-payment.resolution-queue.integration.test.ts

# Trigger detection (not executor)
npm run trigger:coverage

# Full-card executor gaps (slow — run overnight or scoped)
$env:EXECUTOR_COVERAGE_ONLY_GAPS='1'
$env:EXECUTOR_COVERAGE_SCOPE='full_card'
npm run executor:coverage
```

Reports: `server/scripts/out/*.json` (gitignored — regenerate locally).

---

## Document maintenance

Update this file when:

1. A **live-play bug** is fixed — move from P2 → “implemented properly” or close item  
2. A **socket integration test** lands — check off verification column  
3. A **legacy handler module** is retired — update parallel-path diagram  
4. Trigger coverage `not_detected` count changes materially  

Do **not** duplicate parser metrics here — link to `oracle-automation-remaining-work.md` instead.
