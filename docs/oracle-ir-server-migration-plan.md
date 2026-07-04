# Oracle IR Server Migration Plan

**Purpose:** Plan the full supersession of handwritten spell/trigger/ability resolution with Oracle IR execution and the Effect Program orchestrator.

**Last updated:** 2026-07-02 (Layer 3 beta-ready — migration **797/797**; new-card overlay path documented)  
**Owner:** Project maintainers  

> **New session?** Read **[oracle-ir-session-handoff.md](./oracle-ir-session-handoff.md)** first, then **[oracle-ir-track-e-remaining-work.md](./oracle-ir-track-e-remaining-work.md)** for E9+ legacy retirement and the copy-paste starting prompt. Latest: **batch 469** (telemetry soak IR gaps); migration **811/811**.

**Rules for new work:** `.cursor/rules/oracle-ir-no-bespoke-handlers.mdc` — **no card-name routing**, **no new `KNOWN_*` table rows**; extend parser → executor → `applyOracleIRStepsOnServer` → resolution queue.

**Companion docs:**
- [oracle-automation-remaining-work.md](./oracle-automation-remaining-work.md) — rules-engine parser/executor gap closure (mostly complete)
- [oracle-automation-roadmap.md](./oracle-automation-roadmap.md) — historical milestone log
- [oracle-ir-gap-backlog.md](./oracle-ir-gap-backlog.md) — parser backlog + Track D/E status
- [oracle-ir-track-e-remaining-work.md](./oracle-ir-track-e-remaining-work.md) — **Track E** post–Track D executor gaps + starting prompt
- [oracle-ir-step-ledger-migration.md](./oracle-ir-step-ledger-migration.md) — step ledger, pre-commit transitions, "this way" memory
- [server-damage-processing-migration.md](./server-damage-processing-migration.md) — infect/wither/poisonous server bridge (batch 280)

---

## Executive summary

The project has **three distinct layers**. Layers 1–2 are **complete** for commander-legal scope; **Layer 3 is beta-ready** with ongoing Phase 4–5 cleanup.

| Layer | What it is | Status |
|-------|------------|--------|
| **1 — Parse** | `parseOracleTextToIR` → `OracleEffectStep[]` (+ compiled overlay merge for gaps) | **Complete** for corpus; **overlay path** for new/custom cards |
| **2 — Execute** | `applyOracleIRStepsToGameState` in rules-engine | **Complete** — `full_card`: **100%** assisted (47,514/47,514); parse→execute **0**; `ir_gap` **0** |
| **3 — Integrate** | Server routes live gameplay through IR + resolution UI | **Beta-ready** — **797/797** migration tests; IR primary on; legacy shims gated (Phase 4 deletion in progress) |

**Goal:** Make Layer 3 match Layer 2 for every effect that decomposes into wired atomic steps — including **new-set cards** via overlays or parser batches. See [oracle-ir-track-e-remaining-work.md § Goal: Semantic atomic parsing](./oracle-ir-track-e-remaining-work.md#goal-semantic-atomic-parsing--seamless-effect-automation-new-cards).

---

## Current status / session handoff (2026-06-29)

**Latest audit refresh:** Executor **47,514/47,514** assisted; trigger **15,741/15,741**; migration **752/752**. One optional E2 target cluster (Waterbender Ascension). See [oracle-ir-track-e-remaining-work.md](./oracle-ir-track-e-remaining-work.md).

**Prior completed arcs:** Track E2 (batch 398), Track D (368–380), E6 P0–P2, Station/Broodship (409–427), would-enter (431–435).

### Track E2 summary (2026-06-15)

| Metric | Post-397 | After batch 398 |
|--------|----------|-----------------|
| Parse→execute gaps | 13 | **0** |
| `partial` | 13 | **0** |
| Assisted (`full_card`) | 100% (47557/47570) | **100%** (47570/47570) |
| `ir_gap` | 0 | **0** |

**Next:** **Track E6 — Layer 3 server integration** (socket submit/resume gaps beyond P0–P2). Migration bar: `npm run test:oracle-ir-migration` (**764/764**). See [oracle-ir-track-e-remaining-work.md](./oracle-ir-track-e-remaining-work.md) next-batch table.

### Track D summary (2026-06-14)

| Metric | Before (post-367) | After batch 380 |
|--------|-------------------|-----------------|
| `unsupported_condition_clause` | 501 | **0** |
| Assisted (`full_card`) | ~98.0% | **98.4%** (47215/47969) |
| Parse→execute gaps | ~833+ | **622** (non-condition) |

Bulk modules: `oracleIRExecutorConditionalStepSupportBatch368Bulk.ts` … `Batch380Bulk.ts`. Tests: `oracleIRGapBatch368.test.ts` … `oracleIRGapBatch380.test.ts`.

**Next:** Track E — object selectors, targets, `ir_gap` parser gaps, amounts. Starting prompt in [oracle-ir-track-e-remaining-work.md](./oracle-ir-track-e-remaining-work.md).

---

## Current status / session handoff (2026-06-13 — archive)

**Latest completed work (2026-06-13):** **Batch 280** — server damage processing (infect / wither / poisonous / toxic). See [server-damage-processing-migration.md](./server-damage-processing-migration.md) and [oracle-ir-session-handoff.md](./oracle-ir-session-handoff.md).

- New bridge `server/src/state/modules/combat-damage-processing.ts` wired into live combat (`turn.ts` `dealCombatDamage`), fight, legacy spell damage, `dealDamage` events, damage-received reflect, proliferate+`runSBA`.
- **Rot Wolf pattern fixed:** infect → poison on players; infect/wither → -1/-1 on creatures (not marked damage).
- **Delayed dies triggers:** proliferate adds lethal -1/-1 → `runSBA` → `movePermanentToGraveyard` → dies abilities on stack.
- Tests: `server/tests/combat.infect-wither.test.ts` (6/6), `engine.damage.test.ts` (2/2).

**Prior batch 279:** G1 Merfolk commander live-play integration fixes:

- **Roaming Throne** counts as chosen creature type for tribal effects (+1/+1, Deeproot Pilgrimage tap, White Lotus mana).
- **Tap triggers** fire when creatures are tapped via abilities/costs (`tap-trigger-queue.ts`).
- **Thassa's Oracle** ETB queues library look/reorder (`look_select_top` → `LIBRARY_SEARCH`); devotion win unchanged (`tryResolveThassasOracleWin`).
- **Kynaios** land gifts run post-resolution ETB prompts; **Growing Rites** lookup fixed; **Cryptoplasm** reverts on bounce; **Eldrazi Monument** upkeep deduped.
- Also: sacrifice under summoning sickness (`canAct`), Rampant Growth deck import (`localCardLookup` schema v3), Sakura-Tribe Elder false ETB removed.

**Prior batch 278:** trigger `ir_gap` **20 → 0**; migration **649/649**; parse→execute **0**.

**Step ledger (Phases A–Z):** Zone-affecting IR steps on the server path use pre-commit transitions + indexed `stepLedger`. See [oracle-ir-step-ledger-migration.md](./oracle-ir-step-ledger-migration.md).

**Git state:** 100+ files modified across batches 264–280, **no commits** unless explicitly requested.

### Batch 280 — Server damage processing (infect / wither / poisonous)

| Area | Change | Key files |
|------|--------|-----------|
| **Shared bridge** | `applyPoisonCountersToPlayer`, `resolvePlayerDamage`, `applyCreatureDamageFromSource`, `inferInfectWitherFlags` | `combat-damage-processing.ts` |
| **Combat damage** | Live `dealCombatDamage` uses bridge; poison defeat at 10 | `turn.ts` |
| **Fight / spells / events** | Mutual fight + `DamagePlayer`/`DamagePermanent` + `dealDamage` auto-detect | `applyEvent.ts`, `executeSpellEffect.ts`, `replay.ts` |
| **Reflect / proliferate** | Damage-received uses source keywords; proliferate → `runSBA` | `triggers/damage-received.ts`, `applyEvent.ts` |

**Verify batch 280:**

```powershell
cd server
npx vitest run tests/combat.infect-wither.test.ts tests/engine.damage.test.ts
npm run test:oracle-ir-migration
```

**Not yet done (batch 280 follow-ups):**
- ~~Rot Wolf socket E2E~~ ✅
- ~~Audit `applyDamageToPermanentWithCounterEffects`~~ ✅
- ~~Client poison display contract~~ ✅ (`client/tests/poisonCounterDisplay.test.ts`)
- ~~First/double strike infect unit tests~~ ✅
- Deferred: delegate `dealCombatDamage` to rules-engine `executeCombatDamage`

### Batch 279 — G1 Merfolk integration (server Layer 3)

| Area | Change | Key files |
|------|--------|-----------|
| **Chosen type** | Shared `permanentHasCreatureType` honors “is the chosen type in addition to its other types” | `shared/src/creatureTypes.ts`, `creatureTypeNow.ts` |
| **Tap triggers** | Central `queueTapTriggersForTappedPermanents` after tap resolution | `tap-trigger-queue.ts`, `resolution.ts`, `interaction.ts` |
| **Thassa library** | Parser merge + `look_select_top` `library_top` + devotion `whereX`; server `LIBRARY_SEARCH` top/bottom | `oracleIRParserPostprocess.ts`, `oracleIRExecutorPlayerStepHandlers.ts`, `oracleIrServerZoneSync.ts` |
| **Kynaios / lookup / copy** | Land ETB prompts; art_series filter; copy revert on hand bounce | `kynaiosChoice.ts`, `localCardLookup.ts`, `permanent-copy.ts` |

**Verify batch 279:**

```powershell
cd server
npx vitest run tests/roaming-throne-chosen-type.unit.test.ts tests/g1-card-fixes.unit.test.ts tests/roaming-throne-trigger-doubling.integration.test.ts

cd ../rules-engine
npx vitest run test/oracleIRParser.test.ts -t "Thassa"

cd ../server
npm run test:oracle-ir-migration
```

**Not yet done (batch 279 follow-ups):**
- ~~Thassa `LIBRARY_SEARCH` socket integration test~~ ✅ (`thassa-oracle-etb.socket.integration.test.ts`)
- ~~Roaming Throne + Kumena +1/+1 socket test~~ ✅ (`roaming-throne-kumena-tribal.socket.integration.test.ts`)
- Eldrazi Monument indestructible cleanup after monument leaves (live retest)

### Batch 278 — trigger ir_gap closure

Keyword reminder grants, Triceraton compound buff, Heartmender `-1/-1` audit seeds. Trigger `ir_gap` **0**; assisted **100%** (15001/15001). Tests: `oracleIRGapBatch243.test.ts`.

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
- Branching Evolution doubling on distribute-among resume path covered by socket integration test (batch 234)

~~Player UI for choosing counter splits~~ **Done batch 232** (`CounterDistributionModal`, `counterDistributionUtils`, `sanitizeStepForClient` fields)

~~Court upkeep target → distribute queue/resume socket path~~ **Done batch 233** (`queueAddCounterTargetSelectionPromptsFromOracleIRResult`, target-selection IR resume, socket integration test)

~~Stun counter / non-+1/+1 distribute families (e.g. Crashing Wave) — extend parser counter normalization + tests~~ **Done batch 231** (target pool + queue/resume tests)

~~Variable-amount distribute (`distribute a number of +1/+1 counters equal to … among any number of creatures you control`) — parse exists; executor needs reference-amount + unbounded target pool~~ **Done batch 229–230** (auto-apply when total = targets; queue when total > bound targets)

~~`modify_pt` counter-scaled pumps~~ **Done batch 236** — Hydra Trainer exert reward applies via IR fallback + server PT sync; legacy counter-scaled regex skipped when fully wired.

~~Double target power until EOT~~ **Done batch 240** — parses as `modify_pt`; executor doubles via +currentPower/+0; legacy PT batch skipped when fully wired.

~~Other-creatures exert pump / double P&T / target can't block~~ **Done batch 241** — `other creatures you control` target resolution; double P&T via `modify_pt`; `cant_block` in fallback step kinds + prefilter.

~~Compound team `get +N/+N and gain keyword`~~ **Done batch 242** — clause splitter handles plural `get`/`gain`; bare trigger fragments; IR fallback applies both PT and keyword.

~~Each-creature / chosen-type mass pumps~~ **Done batch 243** — target resolution + chosen-type grant/PT; trigger fallback passes `chosenCreatureType`; keyword text cleanup.

~~Prefix team compound / team have / target-player mass pump~~ **Done batch 244** — duration-prefix team split; `have keyword` temporary grants; Velis Vel target-player resolution.

~~Each-other / those-creatures mass PT~~ **Done batch 245** — `each other creature you control` excludes source; `Those creatures` uses antecedent IDs; trigger fallback passes antecedent context.

~~Qualified mass PT / attacking creature pump~~ **Done batch 246** — attacking/subtype/token/qualified/non-color mass targets; `the creature that attacked` self pump; enchanted creature aura attachment.

~~Antecedent pronoun / global / opponent / blocking / chosen mass PT~~ **Done batch 247** — `they` antecedent; `each creature`; opponent creatures; blockers; chosen creature; compound `get + have`; prefix combat team pump.

~~Antecedent X pump / reference creature / mountains-scaled attacking~~ **Done batch 248** — `they get +X/+X where X`; that/equipped/enchanted creature bare parse; blocking fallback; Mountains where-X evaluator.

~~Team X / stampede compound X / global hand-scaled / flanking / counter-per-creature X~~ **Done batch 249** — bare trigger fragments for scaled team/global/each-creature PT; qualified target creature pumps; fallback + routing tests.

~~Per-target counter X / up-to-one target / unblocked attacking mass PT~~ **Done batch 250** — where-X re-eval per creature for "on it"; parse + resolve up-to-one-target and unblocked attacking pumps.

~~Multi-target PT / prefix self compound / asymmetric each +X/+0~~ **Done batch 251** — chosenObjectIds multi-target resolution; prefix self compound bare fragment; opponent hand-scaled -X/-X fallback tests.

~~Target-player mass / exact-count multi-target / scaled target bare fragments~~ **Done batch 252** — two-target chosenObjectIds; target-player +N/+N and +X/+X parse/execute; each-attacking counter X per creature; MODIFY_PT_TARGET_PATTERN target-player fix.

~~Chosen / blocking / another scaled PT / opponent -X/-0~~ **Done batch 253** — bare fragments for chosen creature, blockers, and another-target where-X; asymmetric opponent -X/-0; clause pattern for chosen/blocking selectors.

~~Greatest-power where-X fix / its power-toughness / reference+attacked+opponent scaled bare~~ **Done batch 254** — specialized extrema creatures fix; target its power/toughness eval; that/attacked/opponent where-X bare fragments.

~~Per-target its power/toughness where-X / asymmetric team +X/+0 / grant-keyword bare~~ **Done batch 255** — re-evaluate where-X per creature for `its power/toughness`; team +X/+0 bare fragment; target/team gain keyword bare fragments; readPermanentToughness in reference stats.

~~They/other asymmetric X / prefix-target scaled / expanded grant bare~~ **Done batch 256** — they +X/+0 and other-creatures scaled bare; prefix target +X/+X where-X; other/each/prefix-self grant bare fragments; each-attacking asymmetric X parse.

~~Prefix self scaled X / pronoun grants / qualified each-creature X~~ **Done batch 257** — prefix self +X/+X where-X bare; he/this-creature gain bare; each-with-qualifier counter X bare; full-parser misroute fix.

~~Reference grants / prefix team asymmetric X / opponent mass scaled bare~~ **Done batch 258** — that/enchanted/equipped grant bare; prefix team +X/+0 where-X; self suffix scaled; opponents/tokens/chosen-type mass X; power-qualified and blocking targets.

~~Don't-control mass / prefix-each / qualified fixed mass and grant~~ **Done batch 259** — each creature you don't control bare; prefix each-creature pumps; power-4+ and counter-qualified fixed mass; global flying mass; the creature reference; compound target grant+PT.

~~All don't-control mass / for-each scaler bare / per-target counter scaling~~ **Done batch 260** — all creatures you don't control bare; for-each reference_scaler bare fragments; per-target `on it` scaler re-evaluation.

~~Scaled for-each bare / global each-creature where-X / scaler-only +X execution~~ **Done batch 261** — +X/+X for-each bare fragments; each creature where-X bare; executor treats scaler + usesX without where-clause.

~~Prefix-each for-each / all-creatures for-each / static cost-reduction bare~~ **Done batch 262** — prefix each/team for-each and where-X bare; all creatures for-each bare; spell/activated cost-reduction bare via `grant_static_ability`.

~~Oketra exert `prevent_damage` → creature bridge~~ **Done batch 237** — self-target combat prevention parses as `grant_temporary_ability`; IR fallback + `syncIrTemporaryGrantEffectsToServerTemporaryAbilities` set `temporaryAbilities`; legacy self-prevent regex skips when fully wired.

~~`grant_temporary_ability` wiring~~ **Done batch 236–238** — IR fallback + temp-ability sync cover exert combat evasion (unblockable, scry, low-power, Oketra prevention); legacy combat evasion regex handlers skip when fully wired.

~~`modify_pt` team/target exert pumps~~ **Done batch 239** — bare trigger fragments + fallback prefilter; legacy PT batch skips when fully wired; mana batch skips reminder-text `add {r}` when fully wired.

~~Prefix-each for-each / all-creatures for-each / static cost-reduction bare~~ **Done batch 262** — prefix each/team for-each and where-X bare; all creatures for-each bare; spell/activated cost-reduction bare via `grant_static_ability`.

~~Opponent for-each / prefix-all for-each / extended static cost bare~~ **Done batch 263** — opponent mass/each for-each bare; prefix all/each-other for-each; this spell/ability and tax cost bare; fallback prefilter for cost more.

~~Opponent for-each / prefix-all for-each / extended static cost bare~~ **Done batch 263** — opponent mass/each for-each bare; prefix all/each-other for-each; this spell/ability and tax cost bare; fallback prefilter for cost more.

~~Opponent target/mass debuff / each-other-attacking / keyword grant bare~~ **Done batch 264** — fixed opponent target/mass debuff; each-other-attacking pump; global/all-other/typed team; self blocking for-each; controlled keyword grant bare.

~~Goad / Baeloth static enforcement~~ **Done (parallel track)** — server `getCurrentGoaders` → rules-engine `getGoadedBy`; skip-past-combat; goaded attacking/blocking death → Treasure; see `docs/GOAD_IMPLEMENTATION.md` and `docs/oracle-ir-session-handoff.md`.

### Batch 264 — opponent target/mass debuff, each-other-attacking, keyword grant bare

| Area | Change | Key files |
|------|--------|-----------|
| **Parser** | Opponent target/mass fixed debuff; each-other-attacking; global/all-other/typed team; self where-X no comma; optional target; controlled keyword grant | `oracleIRParserPostprocess.ts` |
| **Executor** | `all other creatures` and `other TYPEs you control` selectors | `oracleIRExecutorCreatureStepUtils.ts` |
| **Tests** | Each-other-attacking, opponent mass debuff, blocking scaler, keyword grant fallback | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 264:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

### Batch 265 — executor combat mass PT + source where-X

Probe (`executor:coverage` gaps-only) surfaced 13 `modify_pt` executor gaps; highest-impact cluster was combat team pumps with source-referenced X.

| Area | Change | Key files |
|------|--------|-----------|
| **Executor** | `other attacking creatures you control`; `each other creature you control with base power and toughness 1/1`; connive import fix | `oracleIRExecutorCreatureStepUtils.ts`, `oracleIRExecutorPlayerStepHandlers.ts` |
| **Where-X** | `counters on this permanent` / typed counters on this permanent read **source**, not first mass target | `oracleIRExecutorModifyPtWhereBoardStateCounts.ts` |
| **Parser** | Bare scaled: other-attacking-you-control, attacking-you-control X, base-1/1 team X | `oracleIRParserPostprocess.ts` |
| **Tests** | Qala-style counter X, Bess-style base-1/1 team pump | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 265:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

Migration suite baseline: **644 tests**.

### Batch 266 — tap-antecedent scaler + this-creature target fix

Probe target: `per_creature_tapped_this_way` (Siege Striker) and die-roll where-X (Velukan Dragon).

| Area | Change | Key files |
|------|--------|-----------|
| **Executor** | Tap count propagation; mass tap via `chosenObjectIds`; `this creature` resolves to `sourceId` not trigger `targetPermanentId` | `oracleIRExecutorBattlefieldStepHandlers.ts`, `oracleIRExecutorMainLoop.ts`, `oracleIRExecutorBattlefieldOps.ts`, `oracleIRExecutorCreatureStepUtils.ts` |
| **Where-X** | `x is the result minus N` for die rolls | `oracleIRExecutorModifyPtWhereMiscCounts.ts` |
| **Server** | `preserveTapScalerOrder` for optional tap + per-tapped pump compounds | `oracleIrUncategorizedSpellFallback.ts` |
| **Tests** | Siege Striker tap pump fallback; Velukan roll-die parse | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 266:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

Migration suite baseline: **645 tests**.

### Batch 267 — combat blocking mass PT + antecedent/global mass (12-item cluster)

Probe target: remaining `modify_pt` executor gaps + add_counter pronoun/named targets.

| Area | Change | Key files |
|------|--------|-----------|
| **Executor** | Combat-aware blocker resolution; `each of them`; `nonartifact creatures`; goblin scaler; attacking-you-control where-X; mutate count fields | `oracleIRExecutorCreatureStepUtils.ts`, `oracleIRExecutorModifyPtStepHandlers.ts`, `oracleIRExecutorModifyPtWhereControlledCounts.ts`, `oracleIRExecutorModifyPtWhereMiscCounts.ts` |
| **Parser** | Blocking-this-creature bare; nonartifact mass; each-of-them scaled/compound | `oracleIRParserPostprocess.ts` |
| **Counters** | him/her pronouns; source-name self target; other-target distribute | `oracleIRExecutorBattlefieldStepHandlers.ts` |
| **Tests** | Gap batch 232 + 3 fallback + routing | `oracleIRGapBatch232.test.ts`, `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 267:**

```powershell
cd rules-engine
npx vitest run test/oracleIRGapBatch232.test.ts test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

Migration suite baseline: **648 tests**.

### Batch 268 — add_counter X amounts + typed/distribute targets (12-item cluster)

Probe target: 21 `add_counter` unsupported_target gaps + remaining sparse `modify_pt` fixtures.

| Area | Change | Key files |
|------|--------|-----------|
| **Executor** | `resolveOracleQuantity` in `resolveAddCounterAmount`; distribute elves/commanders/other-target; `each of those permanents`; `target TYPE you control` bound resolution | `oracleIRExecutorBattlefieldStepHandlers.ts` |
| **Executor** | Aura `this creature`/`it` → enchanted creature host | `oracleIRExecutorCreatureStepUtils.ts` |
| **Tests** | Gap batch 233 + routing (+8) | `oracleIRGapBatch233.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 268:**

```powershell
cd rules-engine
npx vitest run test/oracleIRGapBatch233.test.ts test/oracleIRGapBatch232.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

Migration suite baseline: **648 tests**.

### Batch 269 — unsupported_condition_clause cluster (11-item)

Probe target: 18 `unsupported_condition_clause` executor skips.

| Area | Change | Key files |
|------|--------|-----------|
| **Executor** | Scaled unless-pay; library-search false default; graveyard/ETB/library-origin; discard-unless type checks | `oracleIRExecutorConditionalStepSupport.ts`, `oracleIRExecutorMainLoop.ts` |
| **Tests** | Gap batch 234 + routing (+4) | `oracleIRGapBatch234.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 269:**

```powershell
cd rules-engine
npx vitest run test/oracleIRGapBatch234.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
npx tsx scripts/executor-condition-gap-analysis.ts
```

Migration suite baseline: **648 tests**. Condition gaps: **3** remaining (cleared in batch 270).

### Batch 270 — selector + last condition clauses (14-item)

Probe targets: 11 `unsupported_selector` + 3 `unsupported_condition_clause` executor skips.

| Area | Change | Key files |
|------|--------|-----------|
| **Executor** | Early linked-exile bulk move_zone; among-those-cards MV; sacrificed-power land drop; stash gy exile; last unless/conditional clauses | `oracleIRExecutorMoveZoneStepHandlers.ts`, `oracleIRExecutorZoneOps.ts`, `oracleIRExecutorConditionalStepSupport.ts`, `oracleIRExecutionTypes.ts` |
| **Tests** | Gap batch 235 (11) | `oracleIRGapBatch235.test.ts` |

**Verify batch 270:**

```powershell
cd rules-engine
npx vitest run test/oracleIRGapBatch235.test.ts
cd ../server
npm run test:oracle-ir-migration
npx tsx scripts/executor-selector-gap-analysis.ts
npx tsx scripts/executor-condition-gap-analysis.ts
```

Migration suite baseline: **648 tests**. Selector gaps: **0**. Condition gaps: **0**.

### Batch 271 — audit enrichment + general executor gaps (17 → 10)

| Area | Change | Key files |
|------|--------|-----------|
| **Audit** | Elf distribute, that-land skip_untap, sacrifice choice bindings, modify_pt where-X fixtures, copy-token sources | `executor-coverage-audit.ts` |
| **Parser** | Each-player sacrifice; create-token copy residual | `oracleIRParserPostprocess.ts` |
| **Executor** | Elf distribute fallback; sacrificed ctx where-X; copy `instead`; tapped greatest-power ordering | `oracleIRExecutorBattlefieldStepHandlers.ts`, `oracleIRExecutorModifyPtWhere*.ts`, `oracleIRExecutorTokenStepHandlers.ts` |
| **Tests** | Gap batch 236 (10) | `oracleIRGapBatch236.test.ts` |

**Verify batch 271:**

```powershell
cd rules-engine
npx vitest run test/oracleIRGapBatch236.test.ts
cd ../server
npm run test:oracle-ir-migration
$env:EXECUTOR_COVERAGE_ONLY_GAPS='1'; npm run executor:coverage
npx tsx scripts/executor-general-gap-analysis.ts
```

Parse→execute gaps: **172 → 163**. General-gap clusters: **17 → 10**.

### Batch 272 — completed

1. Nested-step audit via `someOracleSteps`; each-player sacrifice per-seat fixtures; sacrificed snapshot dedupe; copy-it/that-creature/die-roll/delayed-token enrichments.
2. Executor each-player sacrifice picks; `lastCreatedTokenIds` from audit ctx.
3. Tests: `oracleIRGapBatch237.test.ts` (6). General-gap clusters **11 → 9**.

### Batch 273 — suggested next pass

1. Close remaining 9 general-gap clusters (multi-step create_token copy chains, Social Snub copy_spell path, X sacrifices, die-result modify_pt).
2. Re-run `executor:coverage` with `EXECUTOR_COVERAGE_ONLY_GAPS=1`.

See **`docs/oracle-ir-session-handoff.md`** for copy-paste continue prompt.

### Batch 263 — opponent for-each, prefix-all for-each, extended static cost bare

| Area | Change | Key files |
|------|--------|-----------|
| **Parser** | Opponent for-each; prefix-all/each-other for-each; extended static cost bare | `oracleIRParserPostprocess.ts` |
| **Server** | Fallback prefilter includes cost … more | `trigger-runtime-wiring.ts` |
| **Tests** | Opponent for-each, hand-scaled debuff, spell cost fallback | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 263:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

### Batch 262 — prefix-each for-each, all-creatures for-each, static cost-reduction bare

| Area | Change | Key files |
|------|--------|-----------|
| **Parser** | Prefix-each for-each/where-X; all-creatures for-each; static cost-reduction bare | `oracleIRParserPostprocess.ts` |
| **Tests** | Prefix-each team pump, all-creatures land-scaled, cost-reduction routing | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 262:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

### Batch 261 — scaled for-each bare, global each-creature where-X

| Area | Change | Key files |
|------|--------|-----------|
| **Parser** | Scaled for-each bare; global each-creature where-X | `oracleIRParserPostprocess.ts` |
| **Executor** | Scaler + usesX without where-clause uses base magnitude | `oracleIRExecutorModifyPtStepHandlers.ts` |
| **Tests** | Scaled for-each counter, global each-creature team X | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 261:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

### Batch 260 — all don't-control mass, for-each scaler bare, per-target counter scaling

| Area | Change | Key files |
|------|--------|-----------|
| **Parser** | All don't-control mass; for-each scaler bare via shared builder | `oracleIRParserPostprocess.ts` |
| **Executor** | Per-target reference scalers with `on it` (counters) | `oracleIRExecutorModifyPtStepHandlers.ts` |
| **Tests** | All-dont-control, for-each team, per-target counter scaler | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 260:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

### Batch 259 — don't-control mass, prefix-each, qualified fixed mass/grant

| Area | Change | Key files |
|------|--------|-----------|
| **Parser** | Don't-control mass; prefix-each; qualified fixed mass/grant; the creature; compound target | `oracleIRParserPostprocess.ts` |
| **Executor** | Don't-control, global qualified each, without-flying selectors | `oracleIRExecutorCreatureStepUtils.ts` |
| **Tests** | Dont-control hand-scaled, power-4+ team, prefix-each fallback | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 259:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

### Batch 258 — reference grants, prefix team asymmetric X, opponent mass scaled bare

| Area | Change | Key files |
|------|--------|-----------|
| **Parser** | Reference grant bare; prefix team asymmetric X; self suffix scaled; opponent/token/chosen-type mass X | `oracleIRParserPostprocess.ts` |
| **Executor** | Power-qualified targets; each opponent creature; blocking creatures | `oracleIRExecutorCreatureStepUtils.ts` |
| **Tests** | Reference grant, prefix team hand-scaled, power-qualified team, opponent mass fallback | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 258:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

### Batch 257 — prefix self scaled X, pronoun grants, qualified each-creature X

| Area | Change | Key files |
|------|--------|-----------|
| **Parser** | Prefix self scaled PT bare; pronoun/self grant bare; qualified each-creature where-X | `oracleIRParserPostprocess.ts` |
| **Executor** | Resolve `each creature you control with …` and +1/+1 counter qualifiers | `oracleIRExecutorCreatureStepUtils.ts` |
| **Tests** | Prefix self counter X, qualified counter-per-creature X, pronoun grant fallback | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 257:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

### Batch 256 — they/other asymmetric X, prefix-target scaled, expanded grant bare

| Area | Change | Key files |
|------|--------|-----------|
| **Parser** | Bare fragments for they/other asymmetric X, prefix-target scaled PT, other/each/prefix-self grants | `oracleIRParserPostprocess.ts` |
| **Parser** | Each-attacking asymmetric +X/+0 or +X/-X where-X | `oracleIRParserPostprocess.ts` |
| **Tests** | Its-toughness, each-attacking its-power, they/other/prefix fallback, expanded grants | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 256:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

### Batch 255 — per-target its P/T where-X, asymmetric team X, grant-keyword bare

| Area | Change | Key files |
|------|--------|-----------|
| **Executor** | Per-target where-X for `its power/toughness` (not only `on it`) | `oracleIRExecutorModifyPtStepHandlers.ts` |
| **Where eval** | `its toughness` uses `readPermanentToughness` | `oracleIRExecutorModifyPtWhereReferenceStats.ts` |
| **Parser** | Team +X/+0 bare fragment; target/team `gain keyword` bare fragments | `oracleIRParserPostprocess.ts` |
| **Tests** | Per-creature its-power execution, team +X/+0 fallback, grant menace/hexproof fallback | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 255:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

### Batch 254 — greatest-power fix, its P/T where-X, reference/attacked/opponent scaled bare

| Area | Change | Key files |
|------|--------|-----------|
| **Where eval** | Plain `creatures` extrema fix; `x is its power/toughness` uses target id | `oracleIRExecutorModifyPtWhereSpecializedExtrema.ts`, `oracleIRExecutorModifyPtWhereReferenceStats.ts` |
| **Parser** | Bare fragments for that/equipped/enchanted, attacked creature, opponent mass where-X | `oracleIRParserPostprocess.ts` |
| **Clause pattern** | `the creature that attacked` in modify_pt target pattern | `oracleIRParserModifyPtClauses.ts` |
| **Tests** | Greatest-power team pump, its-toughness target, attacked/that/opponent fallback | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 254:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

### Batch 253 — chosen, blocking, another-target scaled PT

| Area | Change | Key files |
|------|--------|-----------|
| **Parser** | Bare fragments for chosen/blocking/another where-X; opponent asymmetric -X/-0 | `oracleIRParserPostprocess.ts` |
| **Clause pattern** | `the chosen creature`, `each creature blocking it` in `MODIFY_PT_TARGET_PATTERN` | `oracleIRParserModifyPtClauses.ts` |
| **Tests** | Chosen, blocking hand-scaled, another-target counter X | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 253:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

### Batch 252 — target-player mass, exact-count multi-target, scaled target bare fragments

| Area | Change | Key files |
|------|--------|-----------|
| **Target resolution** | Exact-count `N target creatures` uses `chosenObjectIds`; exclude from generic single-target substring match | `oracleIRExecutorCreatureStepUtils.ts` |
| **Parser** | Bare fragments for target-player mass, exact-count multi-target, scaled target/opponent/each-attacking X | `oracleIRParserPostprocess.ts` |
| **Clause pattern** | `creatures target player controls` in `MODIFY_PT_TARGET_PATTERN` | `oracleIRParserModifyPtClauses.ts` |
| **Tests** | Target-player mass, two-target, each-attacking X, scaled target bare parse | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 252:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

### Batch 251 — multi-target PT, prefix self compound, asymmetric each +X/+0

| Area | Change | Key files |
|------|--------|-----------|
| **Target resolution** | Multi-target `one or two` / `up to N` / `any number of target creatures each` via `chosenObjectIds` | `oracleIRExecutorCreatureStepUtils.ts` |
| **Parser** | Prefix self compound; multi-target bare fragments; asymmetric `+X/+0` each-creature X | `oracleIRParserPostprocess.ts` |
| **Tests** | Multi-target, prefix self, opponent hand-scaled, each +X/+0 | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 251:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

### Batch 250 — per-target counter X, up-to-one target, unblocked attacking

| Area | Change | Key files |
|------|--------|-----------|
| **Executor** | Re-evaluate where-X per target when clause references "on it" | `oracleIRExecutorModifyPtStepHandlers.ts` |
| **Target resolution** | `unblocked attacking creatures` mass target | `oracleIRExecutorCreatureStepUtils.ts` |
| **Parser** | `up to one target creature gets`; unblocked attacking bare fragment; broaden modify_pt target pattern | `oracleIRParserPostprocess.ts`, `oracleIRParserModifyPtClauses.ts` |
| **Tests** | Per-target counter X, up-to-one-target, unblocked attacking, counters-on-permanents fallback | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 250:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

### Batch 249 — team X, stampede compound X, global/flanking/counter-scaled PT

| Area | Change | Key files |
|------|--------|-----------|
| **Parser** | Bare fragments for team X, stampede compound X, global hand-scaled, flanking mass, each-creature counter X, qualified target pumps | `oracleIRParserPostprocess.ts` |
| **Tests** | Bare parse, fallback apply, routing wiring | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 249:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

### Batch 248 — antecedent X pump, reference targets, mountains where-X

| Area | Change | Key files |
|------|--------|-----------|
| **Parser** | `they get +X/+X where X`; that/equipped/enchanted bare fragments; `they` in modify_pt target pattern | `oracleIRParserPostprocess.ts`, `oracleIRParserModifyPtClauses.ts` |
| **Target resolution** | equipped/that creature reference targets | `oracleIRExecutorCreatureStepUtils.ts` |
| **Where-X** | `x is the number of mountains you control` | `oracleIRExecutorModifyPtWhereBoardStateCounts.ts` |
| **Fallback prefilter** | Match `get +X/+X` temporary PT clauses | `trigger-runtime-wiring.ts` |
| **Tests** | They-X, blocking, attacking X/mountains, reference creature fallback | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 248:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

### Batch 247 — antecedent pronoun, global/opponent mass PT, compound have

| Area | Change | Key files |
|------|--------|-----------|
| **Target resolution** | `they`/`them`; `each creature`; opponent creatures; blockers; chosen creature; combat prefix strip | `oracleIRExecutorCreatureStepUtils.ts` |
| **Parser** | Bare fragments + compound `get + have`; prefix combat team pump | `oracleIRParserPostprocess.ts`, `oracleIRParserAbilityClauses.ts` |
| **Tests** | They/global/opponent/compound-have/chosen fallback | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 247:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

### Batch 246 — qualified mass PT and attacking creature pump

| Area | Change | Key files |
|------|--------|-----------|
| **Target resolution** | Attacking/subtype/token/qualified/non-color mass PT; attacked creature; enchanted creature | `oracleIRExecutorCreatureStepUtils.ts` |
| **Parser** | Bare trigger fragments for qualified mass PT and attacked creature | `oracleIRParserPostprocess.ts` |
| **Tests** | Attacking mass, Zombie mass, attacked creature fallback | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 246:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

### Batch 245 — each-other and antecedent mass PT

| Area | Change | Key files |
|------|--------|-----------|
| **Target resolution** | `each other creature you control`; `those creatures` antecedent set | `oracleIRExecutorCreatureStepUtils.ts` |
| **Parser** | Bare trigger fragments for each-other / those-creatures PT | `oracleIRParserPostprocess.ts` |
| **Fallback ctx** | `lastAntecedentBattlefieldPermanentIds` from `triggerItem` | `oracleIrStackContextUtils.ts`, `stackExecuteTriggerEffectIrFallbackUtils.ts`, `oracleIrUncategorizedSpellFallback.ts` |
| **Tests** | Each-other pump, those-creatures antecedent fallback | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 245:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

### Batch 244 — prefix team compound, team have, target-player pump

| Area | Change | Key files |
|------|--------|-----------|
| **Clause split** | Normalized sub-clauses; strip trailing periods from grant text | `oracleIRParserAbilityClauses.ts` |
| **Parser** | Prefix-duration PT targets; team `have keyword`; target-player compound bare fragments | `oracleIRParserModifyPtClauses.ts`, `oracleIRParserTemporaryAbilityClauses.ts`, `oracleIRParserPostprocess.ts` |
| **Target resolution** | `creatures target player controls` mass PT/grant | `oracleIRExecutorCreatureStepUtils.ts`, `oracleIRExecutorBattlefieldStepHandlers.ts` |
| **Trigger fallback** | Merge `targetPlayerId` into IR ctx from trigger item | `oracleIrUncategorizedSpellFallback.ts` |
| **Tests** | Prefix trample, team haste, Velis Vel fallback | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 244:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

### Batch 243 — each-creature and chosen-type mass pumps

| Area | Change | Key files |
|------|--------|-----------|
| **Target resolution** | `each creature you control`; chosen-type mass PT/grant filters | `oracleIRExecutorCreatureStepUtils.ts`, `oracleIRExecutorBattlefieldStepHandlers.ts` |
| **Parser** | Chosen-type / each-creature PT clauses; compound keyword strip | `oracleIRParserModifyPtClauses.ts`, `oracleIRParserPostprocess.ts` |
| **Trigger fallback** | Merge `chosenCreatureType` from trigger item into IR ctx | `oracleIrUncategorizedSpellFallback.ts` |
| **Tests** | Each-creature pump, chosen-type haste, clean flying grant | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 243:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

### Batch 242 — compound team PT+keyword split

| Area | Change | Key files |
|------|--------|-----------|
| **Clause split** | Plural `get`/`gain` compound PT+keyword; prefix-duration target hexproof | `oracleIRParserAbilityClauses.ts` |
| **Parser guard** | Temporary grant clause skips compound PT targets | `oracleIRParserTemporaryAbilityClauses.ts` |
| **Bare fragments** | Team/self/target compound PT+keyword trigger pairs | `oracleIRParserPostprocess.ts` |
| **Tests** | Compound team vigilance fallback + routing | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 242:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

### Batch 241 — other-creatures PT, double P/T, cant_block fallback

| Area | Change | Key files |
|------|--------|-----------|
| **Target resolution** | `other creatures you control` excludes source permanent | `oracleIRExecutorCreatureStepUtils.ts` |
| **Parser** | Double P&T → `modify_pt`; bare fragments for other-creatures pump, double P&T, target cant block | `oracleIRParserSimpleActionClauses.ts`, `oracleIRParserPostprocess.ts` |
| **Executor** | Double P&T applies +X/+Y at resolution | `oracleIRExecutorModifyPtStepHandlers.ts` |
| **Fallback** | `cant_block` step kind + `can't block` prefilter | `trigger-runtime-wiring.ts` |
| **Tests** | Other-creatures pump, double P&T, cant block fallback + routing | `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts`, `oracleIRTriggerPtBareParse.test.ts` |

**Verify batch 241:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

### Batch 240 — double power + self PT/grant fallback coverage

| Area | Change | Key files |
|------|--------|-----------|
| **Parser** | Double power → `modify_pt`; self PT + double-power bare fragments | `oracleIRParserSimpleActionClauses.ts`, `oracleIRParserPostprocess.ts` |
| **Executor** | `applyModifyPtStep` doubles power (+X/+0 at resolution) | `oracleIRExecutorModifyPtStepHandlers.ts` |
| **Fallback** | `double` prefilter token | `trigger-runtime-wiring.ts` |
| **Tests** | Self/team PT, double power, flying grant fallback + routing | `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts`, `oracleIRTriggerPtBareParse.test.ts` |

**Verify batch 240:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts
npm run test:oracle-ir-migration
```

### Batch 239 — PT modification legacy retirement

| Area | Change | Key files |
|------|--------|-----------|
| **Parser** | Team/target EOT `modify_pt` bare trigger fragments; parse order bare-before-platform-only | `oracleIRParserPostprocess.ts`, `trigger-runtime-wiring.ts` |
| **Fallback** | `gets? +N/+N` prefilter; reminder `add {mana}` skip when fully wired | `trigger-runtime-wiring.ts`, `oracleIrTriggerLegacyManaAndCombatHandlers.ts` |
| **Legacy retirement** | PT modification batch skips when `isTriggerEffectFullyIrWired` | `oracleIrTriggerLegacyPTModificationHandlers.ts` |
| **Tests** | Bare parse unit test; Glory-Bound/Tah-Crop/target PT fallback + routing | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 239:**

```powershell
cd rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/exert-choice.integration.test.ts tests/stack.generic-library-and-untap.regression.test.ts
npm run test:oracle-ir-migration
```

### Batch 238 — combat evasion legacy retirement

| Area | Change | Key files |
|------|--------|-----------|
| **Legacy retirement** | All combat evasion legacy handlers skip when `isTriggerEffectFullyIrWired` | `oracleIrTriggerLegacyCombatEvasionHandlers.ts` |
| **Tests** | Target + low-power IR fallback; legacy skip assertions; routing wiring | `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |

**Verify batch 238:**

```powershell
cd server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/exert-choice.integration.test.ts
npm run test:oracle-ir-migration
```

### Batch 237 — Oketra self combat prevention

| Area | Change | Key files |
|------|--------|-----------|
| **Parser** | Self-target `prevent all combat damage … to it this turn` → `grant_temporary_ability` | `oracleIRParserLifeAndCombatClauses.ts`, `oracleIRParserPostprocess.ts` |
| **Legacy retirement** | Self-prevent combat damage regex skips when fully wired | `oracleIrTriggerLegacyCombatEvasionHandlers.ts` |
| **Tests** | Parse unit test + Oketra IR fallback + routing wiring | `oracleIRSelfCombatPreventParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts` |

**Verify batch 237:**

```powershell
cd rules-engine
npx vitest run test/oracleIRSelfCombatPreventParse.test.ts
cd ../server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/exert-choice.integration.test.ts
npm run test:oracle-ir-migration
```

### Batch 236 — counter-scaled modify_pt + fallback fix

| Area | Change | Key files |
|------|--------|-----------|
| **Fallback execution** | Mandatory uncategorized batches force `allowOptional: false` | `oracleIrUncategorizedSpellFallback.ts` |
| **Server sync** | PT modifier sync always after IR apply | `oracleIrServerZoneSync.ts` |
| **Legacy retirement** | Counter-scaled +X/+X PT regex skips when fully wired; PT mod dedupe | `oracleIrTriggerLegacyPTModificationHandlers.ts` |
| **Tests** | Fallback + primary Hydra, migration gate +8 tests | `oracle-ir-trigger-combat-evasion-fallback.test.ts` |

**Verify batch 236:**

```powershell
cd server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/exert-choice.integration.test.ts
npm run test:oracle-ir-migration
```

### G1 game-log bugs — status (batch 235 + 279 + 280)

| Issue | Status | Coverage |
|-------|--------|----------|
| **Rot Wolf / infect / wither / poisonous** combat damage | **Fixed** (batch 280) | `combat.infect-wither.test.ts`; socket E2E **pending** |
| **Court of Garenbrig** upkeep counters + Branching Evolution | **Fixed** (batch 174/233/234) | `oracle-ir-court-garenbrig-counter-distribution.socket.integration.test.ts`, `inspiring-call-court-garenbrig.regression.test.ts` |
| **Inspiring Call** draw + indestructible | **Fixed** (batch 175) | `inspiring-call-court-garenbrig.regression.test.ts` |
| **Roaming Throne** explore doubling + ETB type | **Verified** | `roaming-throne-trigger-doubling.integration.test.ts`, `creature-type-etb-persistence.integration.test.ts` |
| **Roaming Throne** chosen type for tribal (+1/+1, Deeproot, mana) | **Fixed** (batch 279) | `roaming-throne-chosen-type.unit.test.ts`, `g1-card-fixes.unit.test.ts` |
| **Tap triggers** (Kumena → Surge Spanner / Deeproot) | **Fixed** (batch 279) | `g1-card-fixes.unit.test.ts`; live retest recommended |
| **Thassa's Oracle** library look/reorder | **Fixed** (batch 279) | `oracleIRParser.test.ts` (parse); socket E2E **pending** |
| **Kynaios** land ETB prompts (e.g. Cavern type choice) | **Fixed** (batch 279) | `kynaios-choice.replay.test.ts` pattern; live retest |
| **Growing Rites** art_series / empty oracle import | **Fixed** (batch 279) | `growing-rites.transform.regression.test.ts` |
| **Cryptoplasm** bounce reverts to original card | **Fixed** (batch 279) | `cryptoplasm-copy.integration.test.ts` (upkeep); bounce path unit-level |
| **Eldrazi Monument** duplicate upkeep | **Fixed** (batch 279) | `upkeep-triggers.ts` dedupe; indestructible cleanup **retest** |
| **White Lotus Tile** tribal mana counting | **Fixed** (batch 279) | `mana-abilities.ts`; live retest |
| **Cryptoplasm** optional upkeep copy | **Verified** | `cryptoplasm-copy.integration.test.ts` (accept + decline) |
| **Cavern / Three Tree City** type badge | **Verified** | `creature-type-etb-persistence.integration.test.ts` |
| **Gwenna** null priority during mana selection | **Verified** | `gwenna-mana-color-selection.integration.test.ts` |
| **Door of Destinies** charge counter on cast | **Verified** | `door-of-destinies-spell-cast.integration.test.ts`, `door-of-destinies-ir-primary.integration.test.ts` |

Restart server + hard-refresh client + re-import deck after batch 279–280. Live spot-checks still recommended for Thassa UI, tap-trigger chains, and Rot Wolf poison counters in client view.

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

1. **Thassa socket E2E** — ETB → `LIBRARY_SEARCH` (devotion X, put 0–1 on top, rest bottom random) → `tryResolveThassasOracleWin`.
2. **Roaming Throne tribal socket** — Kumena +1/+1 and Deeproot tap token with throne chosen Merfolk.
3. **G1 live retest** — tap chains, White Lotus mana, Kynaios Cavern, Eldrazi indestructible after monument leaves.
4. **Resume gap audit** — `EXECUTOR_COVERAGE_SCOPE=full_card` or `npx tsx scripts/_tmp-trigger-gap-clusters.ts` (trigger `ir_gap` already 0).
5. **Continue regex retirement** — grep `applyRetiredTriggerLegacy*`; gut when IR + integration green. **Never** card-name `KNOWN_*` rows (`.cursor/rules/oracle-ir-no-bespoke-handlers.mdc`).
6. **Run migration suite** after routing/sync edits: `cd server ; npm run test:oracle-ir-migration` (expect **649/649**).
7. **Uncommitted work** — batches 264–280 local only; no commits unless explicitly requested.

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

**Ratchet + telemetry (batch 466):** the legacy surface is now mechanically shrink-only — `server/tests/oracle-ir-legacy-handler-ratchet.unit.test.ts` fails if `applyRetiredTriggerLegacy*` / spell legacy export counts rise (ceilings 86 / 1; lower them when deleting). Deletion is **evidence-driven**: `legacy_handled` events from `oracleIrGapTelemetry` (`GET /api/oracle-ir/telemetry`) show which handler families still fire under IR primary in live play; families that never fire after a soak are dead code.

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
- **Continuous & replacement effects** — declarative `StaticEffectSpec` / `ReplacementEffectSpec` + single replacement registry; design: [oracle-ir-phase5-continuous-effects-design.md](./oracle-ir-phase5-continuous-effects-design.md)

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
