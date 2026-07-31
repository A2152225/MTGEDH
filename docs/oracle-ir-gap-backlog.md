# Oracle IR Gap Backlog

Refreshed from `tools/oracle-ir-gap-audit.ts` against `oracle-cards.json` and `AtomicCards.json`.

## Current Audit Snapshot (2026-06-14)

- Unique cards parsed: 29,971
- Parser gap records (tools audit): **0**
- Trigger `ir_gap`: **0** (batch 278)
- Trigger parse→execute gaps: **0**
- **`full_card` executor:** **622** parse→execute gaps; **`unsupported_condition_clause`: 0** (Track D batches 368–380 ✅)

**Next work:** [oracle-ir-track-e-remaining-work.md](./oracle-ir-track-e-remaining-work.md) — targets, object selectors, `ir_gap` (132), amounts.

---

## Completed — Track D (condition clauses, batches 368–380)

All `unsupported_condition_clause` gaps closed: **501 → 0**. Bulk modules `Batch368Bulk` … `Batch380Bulk`; unless inners for Rush `{E}{E}`, Tainted Specter put-on-top, etc.

Validation:

1. `npx tsx scripts/executor-fullcard-condition-gap-analysis.ts` — **0** items
2. `$env:EXECUTOR_COVERAGE_SCOPE='full_card'; npm run executor:coverage` — no `unsupported_condition_clause` in top reason codes
3. `npx vitest run test/oracleIRGapBatch380.test.ts` (rules-engine)

---

## Completed In This Pass (Tracks A + B — 2026-06-13)

**Track A:** client poison display contract; first/double-strike infect unit tests; damage call-site audit complete.

**Track B:** `thassa-oracle-etb.socket.integration.test.ts` (2 tests); `roaming-throne-kumena-tribal.socket.integration.test.ts`; executor `full_card` audit reviewed (**833** parse→execute gaps, snapshot 2026-06-13).

**Verify:** see `docs/oracle-ir-session-handoff.md` validation commands.

---

## Completed In This Pass (batch 280 follow-up — damage socket E2E + call-site audit)

1. **Socket E2E:** `combat.infect-wither.socket.integration.test.ts` — Rot Wolf `declareAttackers` → 2 poison in `viewFor.poisonCounters`.
2. **Call-site audit:** `x-activated-abilities.ts` (Crypt Rats X AoE), `stackResolveSpellSpecialCaseUtils.ts` (Nibelheim Aflame sweep) now use `combat-damage-processing.ts`. Remaining raw `applyDamageToPermanentWithCounterEffects` are intentional no-source fallbacks.

**Verify:** `npx vitest run tests/combat.infect-wither.test.ts tests/combat.infect-wither.socket.integration.test.ts tests/engine.damage.test.ts`

**Next:** Prod client poison UI; or resume batch 279 tribal/Thassa socket tests.

---

## Completed In This Pass (batch 280 — server damage processing)

Parallel server path fix (not Oracle IR parser work). Live combat used bespoke `dealCombatDamage` that ignored infect/wither/poisonous. See [server-damage-processing-migration.md](./server-damage-processing-migration.md).

1. **New bridge:** `server/src/state/modules/combat-damage-processing.ts` — poison sync, player/creature damage with keyword awareness, fight helper, auto-detect for `dealDamage` events.
2. **Wired paths:** `turn.ts` combat, fight (`applyEvent.ts`, stack mid-handlers, planeswalker templates), spell damage (`executeSpellEffect.ts`), `dealDamage` events + replay, damage-received reflect, proliferate+`runSBA`.
3. **Tests:** `combat.infect-wither.test.ts` (6) — Rot Wolf poison, infect/wither combat, infect fight, auto-detect, proliferate→dies trigger.

Validation:

1. `npx vitest run tests/combat.infect-wither.test.ts tests/combat.infect-wither.socket.integration.test.ts tests/engine.damage.test.ts` (server)
2. `npm run test:oracle-ir-migration` — **701/701**

**Next:** Prod client poison UI; or resume batch 279 tribal/Thassa socket tests.

## Completed In This Pass (batch 279 — G1 Merfolk integration)

Server integration fixes from live G1 play (not a parser-gap audit batch). See `docs/oracle-ir-session-handoff.md` for full detail.

1. **Roaming Throne chosen type:** `permanentAddsChosenCreatureTypeToSelf` + `permanentHasCreatureType` in shared; tap triggers and IR subtype checks use `permanentHasCreatureTypeNow`; excludes Cavern of Souls-style “as … enters” lands.
2. **Tap trigger queue:** extracted `queueTapTriggersForTappedPermanents`; wired in resolution tap-other cost path and `interaction.tapPermanent`.
3. **Thassa's Oracle library effect:** `look_top` + put-one-on-top/rest-random-bottom → `look_select_top` (`destination: library_top`, `whereX` devotion, `chooseMin: 0`); `pruneThassaOracleWinGrantAbilities`; executor + `LIBRARY_SEARCH` (`destination: top`, `remainderRandomOrder`); win via existing `tryResolveThassasOracleWin`.
4. **Kynaios land ETB:** `runPostResolutionPermanentPromptChecks` after land gift.
5. **Growing Rites:** skip `art_series` in local card lookup (`schemaVersion` 2).
6. **Cryptoplasm:** `revertCopyPermanentToOriginal` on bounce to hand.
7. **Eldrazi Monument:** ~~skip duplicate generic upkeep sacrifice detection when `KNOWN_UPKEEP_CARDS` matched~~ — obsolete; `KNOWN_UPKEEP_CARDS` retired. Dedupe is via `sacrifice_creature_or_self` typing + normalized oracle-clause matching in `upkeep-triggers.ts`.
8. **White Lotus Tile:** tribal mana common-type counting via `chosenCreatureType`.
9. **Tests:** `roaming-throne-chosen-type.unit.test.ts`, `g1-card-fixes.unit.test.ts`, Thassa parser test in `oracleIRParser.test.ts`.

Validation:

1. `npx vitest run tests/roaming-throne-chosen-type.unit.test.ts tests/g1-card-fixes.unit.test.ts` (server)
2. `npx vitest run test/oracleIRParser.test.ts -t "Thassa"` (rules-engine)
3. `npm run test:oracle-ir-migration` — **649/649**

**Next:** Thassa socket E2E; Roaming Throne + Kumena tribal socket test; resume `full_card` executor audit or trigger detector gaps.

## Completed In This Pass (batch 278)

1. **Parser:** trailing keyword reminders (`persist`, `undying`, `rebound`, `afterlife N`, `storm`) → `grant_static_ability` via `parseStructuredKeywordActionGrant`; pruned as redundant unknown trigger fragments.
2. **Parser:** `{subtype} you control other than this creature get +N/+N and gain {keyword} until end of turn` compound buff (Triceraton Commander).
3. **Audit:** matching ignorable unknown gaps for the same keyword reminders; seed `-1/-1` on each controlled creature fixture for `remove a -1/-1 counter from each creature you control` (Heartmender).
4. **Tests:** `oracleIRGapBatch243.test.ts` (4).

Validation:

1. `npx vitest run test/oracleIRGapBatch243.test.ts` (rules-engine) — **4/4**
2. `npm run test:oracle-ir-migration` — **648/648**
3. Trigger `ir_gap` items **20 → 0**; parse→execute gaps remain **0**
4. `npx tsx scripts/executor-general-gap-analysis.ts` — **0** clusters

## Completed In This Pass (batch 277)

1. **Executor:** zero-delta `modify_pt` with resolved where-X (e.g. die roll 1 with "result minus 1") counts as applied no-op instead of `no_applicable_targets` — fixes flaky Velukan Dragon audit partials.
2. **Tests:** `oracleIRGapBatch242.test.ts` (2): die-roll +0/+0 no-op; mill-then-prevent combat damage when land milled.

Validation:

1. `npx vitest run test/oracleIRGapBatch242.test.ts` (rules-engine) — **2/2**
2. `npm run test:oracle-ir-migration` — **648/648**
3. Trigger parse→execute gaps **1 → 0**
4. `npx tsx scripts/executor-general-gap-analysis.ts` — **0** clusters

## Completed In This Pass (batch 276)

1. **Audit enrichment:** `remove_counter` binds contextual targets (`that creature` → opponent creature; `another target creature you control` → `bf-creature-2`; `target creature you control` → `bf-creature-1`) and seeds required counters on the bound permanent.
2. **Audit enrichment:** self-referential `counter_spell` (`counter this permanent`) places the casting spell on stack as `stack-source-spell-1` so `counter target spell` retains a separate stack target.
3. **Executor:** `applyCounterSpellStep` resolves `this permanent` / `this spell` counters against `ctx.sourceId` (or source name) instead of `targetSpellId`.
4. **Tests:** `oracleIRGapBatch241.test.ts` (3).

Validation:

1. `npx vitest run test/oracleIRGapBatch241.test.ts` (rules-engine) — **3/3**
2. `npm run test:oracle-ir-migration` — **648/648**
3. Trigger parse→execute gaps **4 → 1** (remaining: blocks-trigger mill+conditional partial — Loafing Giant pattern)
4. `npx tsx scripts/executor-general-gap-analysis.ts` — **0** clusters

## Completed In This Pass (batch 275)

1. **Connive:** ignore polluted `chosenObjectIds` unless they match the conniving player's hand and exact discard count.
2. **Library search:** filter bound ids to search matches before auto-picking; fixes basic-plains partial gaps.
3. **Parser:** bare trigger fragment `destroy it` / `destroy them`.
4. **Executor:** contextual `it`/`them` destroy targets via `buildContextualBattlefieldTargetIds`; audit enrichment for destroy-it triggers.
5. **Tests:** `oracleIRGapBatch240.test.ts` (3).

Validation:

1. `npx vitest run test/oracleIRGapBatch240.test.ts` (rules-engine) — **3/3**
2. `npm run test:oracle-ir-migration` — **648/648**
3. Trigger parse→execute gaps **150 → 4** (batch 276 cleared the last four)
4. `npx tsx scripts/executor-general-gap-analysis.ts` — **0** clusters

## Completed In This Pass (batch 274)

1. **Audit enrichment:** generic sacrifice-subtype fixtures (food/blood/homunculus/egg/powerstone/basic lands); each-opponent creature seats; optional sacrifice decline when followed by `if you do`.
2. **Parser/executor:** `parseSacrificeWhat` greatest-power controlled creatures; plural basic lands as `land` subtype; count-mode sacrifice auto-picks unique max-power creature per seat.
3. **Conditional:** generic `if you can't` antecedent evaluation (failed vs applied prior step).
4. **Tests:** `oracleIRGapBatch239.test.ts` (6).

Validation:

1. `npx vitest run test/oracleIRGapBatch239.test.ts test/oracleIRGapBatch238.test.ts` (rules-engine) — **10/10**
2. `npm run test:oracle-ir-migration` — **648/648**
3. `npx tsx scripts/executor-general-gap-analysis.ts` — **15 → 0** clusters

## Completed In This Pass (batch 273)

1. **Copy/sacrifice chains:** delayed copy-it snapshot; attached aura/equipment copy loop; `that creature` after die roll; Faerie `except` copy reference; non-demon sacrifice subtype; each-other-opponent copy; Social Snub optional copy + each-player sacrifice audit decline.
2. **Executor:** variable-X each-player sacrifice; twin `lastCreatedTokenIds` targeting.
3. **Tests:** `oracleIRGapBatch238.test.ts` (4).

Validation: general-gap clusters **9 → 0** (pre-batch-274 baseline); migration **648/648**.

## Completed In This Pass (batch 272)

1. **Audit enrichment:** `someOracleSteps` for nested conditional steps; each-player sacrifice fixtures for all table seats; sacrificed-permanent snapshots (typeLine/manaValue); copy-it/that-creature references; each-other-opponent attacking copies; delayed `those tokens` sacrifice; die-roll where-X state; optional nonland sacrifice binding for Shadow-style chains.
2. **Executor:** each-player sacrifice picks one creature per player (non-source fallback); deduped `lastSacrificedPermanents` for where-X and lose_life amounts; `lastCreatedTokenIds` seeded from audit ctx.
3. **Tests:** `oracleIRGapBatch237.test.ts` (6).

Validation:

1. `npx vitest run test/oracleIRGapBatch237.test.ts test/oracleIRGapBatch236.test.ts test/oracleIRGapBatch235.test.ts` (rules-engine) — **27/27**
2. `npm run test:oracle-ir-migration` — **648/648**
3. `npx tsx scripts/executor-general-gap-analysis.ts` — **11 → 9** clusters (cleared Shadow lose_life, Tip the Scales where-X, bulk each-player sacrifice, Velukan die-roll)

## Completed In This Pass (batch 271)

1. **Audit enrichment:** distribute among target elves; skip_next_untap `that land`; each-player sacrifice choice bindings; modify_pt where-X (devotion/red mana/oil/mutated/tapped opponent); sacrificed-permanent references; create_token copy fixture context.
2. **Parser:** each-player sacrifice no longer platform-only; residual `create token that's a copy of` step.
3. **Executor:** elf distribute bound-ID fallback; ctx `lastSacrificedPermanents` in where-X; copy `instead` suffix; tapped-opponent greatest-power where-X ordering.
4. **Tests:** `oracleIRGapBatch236.test.ts` (10).

Validation:

1. `npx vitest run test/oracleIRGapBatch236.test.ts` (rules-engine)
2. `npm run test:oracle-ir-migration` — **648/648**
3. `npm run executor:coverage` with `EXECUTOR_COVERAGE_ONLY_GAPS=1` — parse→execute gaps **172 → 163**
4. `npx tsx scripts/executor-general-gap-analysis.ts` — **17 → 10** clusters

## Completed In This Pass (batch 270)

1. **Linked-exile bulk move_zone (11 selector gaps):** early `tryApplyMoveZoneLinkedExileBulkStep` for `all cards exiled with it/this permanent`, Mechtitan except-self, chosen-card gy return, among-those-cards MV+X, up-to-X lands from hand (sacrificed power), stash exile from opponent gy.
2. **Condition clauses (3 remaining):** Katara `her additional cost was paid` (waterbend/optional cost); Oblivious Bookworm face-down ETB / turned face-up; Doom Foretold `that player can't` sacrifice.
3. **Tests:** `oracleIRGapBatch235.test.ts` (11 execution).

Validation:

1. `npx vitest run test/oracleIRGapBatch235.test.ts` (rules-engine)
2. `npm run test:oracle-ir-migration` — **648/648**
3. `npx tsx scripts/executor-selector-gap-analysis.ts` — **11 → 0** `unsupported_selector` items
4. `npx tsx scripts/executor-condition-gap-analysis.ts` — **3 → 0** `unsupported_condition_clause` items

Probe notes: executor selector + condition dry-run gaps cleared. Next batch: re-run `npm run executor:coverage` with `EXECUTOR_COVERAGE_ONLY_GAPS=1` for next top cluster.

## Completed In This Pass (batch 269)

1. **Scaled unless-pay:** `not (you pay {1} for each card in your hand/+1/+1 counter on it/other creature you control)` via `resolveUnlessPayScalerMultiplier`; main loop queues `player_choice_required` instead of unsupported.
2. **Library-search antecedent:** `you search your library this way` defaults false when search skipped; `searchedLibraryThisWay: false` on failed search.
3. **State/count conditions:** `a graveyard has twenty or more cards in it`; `this creature entered this turn`; `it entered from your library or was cast from your library`.
4. **Discard unless:** `they/you discard a nonland/pirate/artifact card`; `you control another creature with power 2 or less`.
5. **Tests:** `oracleIRGapBatch234.test.ts` (11 execution), routing (+4 patterns).

## Completed In This Pass (batch 268)

1. **X counter amounts:** `resolveAddCounterAmount` delegates to `resolveOracleQuantity` so `amount.kind === 'x'` uses `ctx.xValue` (fixes 11 add_counter probe cases).
2. **Typed counter targets:** `target land you control` bound resolution; `enchanted permanent` / `that creature` / `this permanent` / `it` via existing attached/contextual paths once amount resolves.
3. **Distribute counters:** `target elves` subtype filter; `other target creatures you control` early path via `resolveCreatureTargetIds`; `it and any number of commanders` compound targets.
4. **Antecedent counters:** `each of those permanents` uses `lastAntecedentBattlefieldPermanentIds`.
5. **Power-scaled counters:** `object_stat` amounts (e.g. this permanent's power → another target creature) via `resolveOracleQuantity`.
6. **Mass PT (already wired):** `creatures you control with power 4 or greater`; `each creature you control with a counter on it` — confirmed execution paths in `resolveCreatureTargetIds`.
7. **Aura self-pump:** `this creature`/`it` on aura source resolves to enchanted creature when host is a creature.
8. **Tests:** `oracleIRGapBatch233.test.ts` (12 execution), routing (+8 patterns).

Validation:

1. `npx vitest run test/oracleIRGapBatch233.test.ts test/oracleIRGapBatch232.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration` — **648/648**

Probe notes: all 11 batch-268 add_counter probes apply; remaining modify_pt probe failures are sparse-fixture no-ops (no qualifying creatures / aura on land). Next batch: `unsupported_condition_clause` cluster or player-choice multi-target mass PT.

## Completed In This Pass (batch 267)

1. **Combat blocking mass PT:** `each creature blocking it/this creature` and `blocking creatures` resolve via `combat.blockers` + `blockedBy`; bare parser covers `this creature` variant.
2. **Antecedent mass PT:** `each of them` uses `lastAntecedentBattlefieldPermanentIds`; bare scaled + compound PT+keyword (`+X/+X and gains vigilance`).
3. **Global mass PT:** `nonartifact creatures` parser + executor target resolution.
4. **Where-X / scalers:** `x is the number of attacking creatures you control`; mutate count reads `mutationCount`/`mutateCount`; `per_goblin_you_control` scaler.
5. **Counter targets:** `him`/`her` pronouns; source card name as self target (e.g. Nev); `other target creatures you control` distribute resolution.
6. **Tests:** `oracleIRGapBatch232.test.ts` (8 execution), bare parse (+1), fallback (+3), routing wiring (+7 patterns).

Validation:

1. `npx vitest run test/oracleIRGapBatch232.test.ts test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration` — **648/648**

Probe notes: executor gaps down to 222 parse→execute (from 225). Next batch: add_counter typed targets (`enchanted permanent`, `that creature`), conditional upkeep compounds, or player-choice Sigardian-style multi-target.

## Completed In This Pass (batch 266)

1. **Tap-antecedent scaler:** `per_creature_tapped_this_way` reads `lastTappedMatchingPermanentCount` from preceding `tap_or_untap`; main loop propagates tap count across compound steps.
2. **Mass tap resolution:** `any number of untapped creatures you control` uses `chosenObjectIds`; mass tap bypasses single `targetPermanentId` shortcut.
3. **Server fallback ordering:** `preserveTapScalerOrder` runs optional tap + scaled self pump in one `applyOracleIRStepsOnServer` call (`hasTapAntecedentScalerDependency`).
4. **This-creature target fix:** `resolveSingleCreatureTargetId` no longer maps `this creature` / `it` to trigger `targetPermanentId` (Siege Striker pump lands on source).
5. **Die-roll where-X:** `x is the result minus N` for roll-die self pumps (Velukan Dragon pattern).
6. **Tests:** tap-any-number → per-tapped self pump (parse + fallback + routing); roll-die result-minus-one self +X/+0.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine) — **47/47**
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts` — **79/79**
3. `npm run test:oracle-ir-migration` — **645/645**

Probe notes: remaining `modify_pt` gaps include player-choice multi-target (Sigardian Zealot) and sparse X=0 fixtures. Next batch: Sigardian Zealot player-choice mass PT or conditional/upkeep compounds.

## Completed In This Pass (batch 265)

1. **Executor import fix:** `resolveSingleCreatureTargetId` import restored in `oracleIRExecutorPlayerStepHandlers.ts` (unblocks `executor:coverage` / connive dry-run).
2. **Other-attacking-you-control mass PT:** executor selector `other attacking creatures you control`; bare scaled `+X/+0` fragment; source-referenced where-X (`counters on this permanent`) reads source not first pump target.
3. **Attacking-you-control scaled X bare:** `attacking creatures you control get +X/+0 where X is …` bare fragment (mountain-scaled team pumps).
4. **Base 1/1 qualified team pump:** executor `each other creature you control with base power and toughness 1/1`; bare `+X/+X where X is +1/+1 counters on this permanent`.
5. **Tests:** parse + execution (`oracleIRTriggerPtBareParse.test.ts`), fallback (`oracle-ir-trigger-combat-evasion-fallback.test.ts`), routing wiring.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration` — **644/644**

Probe notes (executor:coverage, gaps-only): 13 remaining `modify_pt` parse→execute gaps are mostly X=0 no-ops in sparse fixtures or context-dependent scalers (`per_creature_tapped_this_way`, player-choice Sigardian Zealot). Next batch should target those or non-PT skip kinds (discard/scry choice_required is expected UI).

## Completed In This Pass (goad / Baeloth — parallel track, not Oracle IR batch)

1. **Unified server goad detection:** `getCurrentGoaders` / `isCreatureGoaded` delegate to rules-engine `getGoadedBy` (keyword goad, static Baeloth, attached “is goaded”, legacy replay map).
2. **Skip-past-combat enforcement:** `skipToPhase` uses `getCurrentGoaders` so Baeloth static goad blocks skipping declare attackers.
3. **Death trigger clause matching:** `whenever a goaded attacking or blocking creature dies` in `getDeathTriggers` / `deathTriggerClauseMatchesDyingCreature`.
4. **Tests:** `tests/goad-static-death.unit.test.ts`, `tests/goad-baeloth.integration.test.ts`.
5. **Docs:** `docs/GOAD_IMPLEMENTATION.md` refreshed.

Validation:

1. `cd server ; npx vitest run tests/goad-static-death.unit.test.ts tests/goad-baeloth.integration.test.ts`
2. `cd rules-engine ; npx vitest run test/goad.test.ts test/goad-ai-integration.test.ts`

## Completed In This Pass (batch 264)

1. **Opponent target/mass fixed debuff bare:** `target creature an opponent controls gets …` and `creatures your opponents control get …`.
2. **Combat mass bare:** `each other attacking creature gets …`; self `it gets … for each creature blocking it`.
3. **Global/other bare:** `all creatures get …`, `all other creatures get …`, `other TYPEs you control get …`.
4. **Self where-X no comma:** `this creature gets +X/+X until end of turn where X is …`.
5. **Optional target debuff:** `you may have target creature get …`.
6. **Controlled keyword grant bare:** `target/another target creature you control gains … until end of turn`.
7. **Executor:** `all other creatures` and `other TYPEs you control` selector resolution.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 263)

1. **Opponent for-each bare:** `each opponent's creatures get … for each …` and `each creature an opponent controls gets … for each …` (fixed and scaled X).
2. **Prefix-all / prefix-each-other for-each bare:** `until end of turn, all creatures get … for each …` and `each other creature you control gets … for each …`.
3. **Extended static cost bare:** this spell/ability, first instant/sorcery each turn, opponent spell tax, dash/equip/power-up, activated abilities cost more.
4. **Fallback prefilter:** matches `cost … more` in addition to `cost … less`.
5. **Tests:** opponent for-each execution, opponent hand-scaled debuff, spell cost reduction fallback + routing wiring.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 262)

1. **Prefix-each scaled/for-each bare:** `until end of turn, each creature … gets +X/+X where X is …` and `… for each …` on global/team selectors.
2. **All-creatures for-each bare:** `all creatures get +N/+N until end of turn for each …` (fixed and scaled X).
3. **Static cost-reduction bare:** spells you cast/control and activated abilities cost less fragments route to `grant_static_ability`.
4. **Tests:** prefix-each for-each, all-creatures land-scaled, cost-reduction bare + fallback + routing wiring.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 261)

1. **Scaled for-each bare fragments:** `gets +X/+X until end of turn for each …` on team/each/target selectors.
2. **Global each-creature where-X bare:** `each creature gets +X/+X until end of turn, where X is …`.
3. **Executor:** `+X/+X for each` scalers no longer require a where-clause (base magnitude scales by reference scaler).
4. **Tests:** scaled for-each counter pump, global each-creature team-count X, fallback + routing wiring.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 260)

1. **All don't-control mass PT:** bare fragments for `all creatures you don't control get …` (fixed and scaled X).
2. **For-each scaler bare fragments:** generic `gets +N/+N until end of turn for each …` on team/each/target/global selectors.
3. **Per-target for-each counter scaling:** `for each +1/+1 counter on it` re-evaluates per pumped creature (not global).
4. **Tests:** all-dont-control debuff, for-each team pump, per-target counter scaler, fallback + routing wiring.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 259)

1. **Don't-control mass PT:** bare fragments for `each creature you don't control gets …` (fixed and scaled X).
2. **Prefix-each / global qualified mass:** `until end of turn, each creature … gets +N/+N`; `each creature with flying gets …`.
3. **Qualified fixed mass/grant:** `each creature you control with … gets +N/+N` and `… gains …`; `creatures you control without flying`.
4. **Reference/compound target:** `the creature gets …`; `target creature gains X and gets +N/+N`.
5. **Executor:** resolves don't-control, global qualified each, and without-flying selectors.
6. **Tests:** dont-control hand-scaled debuff, power-4+ team pump, prefix-each fallback, routing wiring.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 258)

1. **Reference creature grant bare:** `that/enchanted/equipped creature gains … until end of turn`.
2. **Prefix team asymmetric scaled PT:** `until end of turn, creatures you control get +X/+0, where X is …` (fixes grant-only misroute).
3. **Self suffix scaled PT:** `it gets +X/+X until end of turn, where X is …`.
4. **Opponent/token/chosen-type mass scaled bare:** opponents control, tokens, chosen type where-X fragments.
5. **Qualified mass bare + executor:** reordered `creatures with power 4 or greater you control`; `each creature an opponent controls`; `blocking creatures`; power-threshold qualifiers.
6. **Tests:** reference grant, prefix team hand-scaled, self suffix counter X, power-qualified team pump, opponent mass fallback, routing wiring.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 257)

1. **Prefix self scaled PT:** bare fragment for `until end of turn, it gets +X/+X, where X is …` (fixes full-parser misroute to grant-only).
2. **Pronoun/self grant bare:** `he gains …` and `this creature gains … until end of turn`.
3. **Qualified each-creature scaled PT:** `each creature you control with … gets +X/+X where X is … on it`.
4. **Target resolution:** `each creature you control with a +1/+1 counter on it` resolves in modify_pt executor.
5. **Tests:** prefix self counter X execution, qualified counter-per-creature X, pronoun grant fallback, routing wiring.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 256)

1. **They/other asymmetric scaled PT:** bare fragments for `they get +X/+0 where X is …` and `other creatures you control get +X/+X where X is …`.
2. **Prefix-target scaled PT:** bare fragment for `until end of turn, target creature gets +X/+X, where X is …`.
3. **Expanded grant bare fragments:** `other creatures you control gain …`, `each creature you control gains …`, and `until end of turn, it gains …`.
4. **Each-attacking asymmetric X:** bare parse accepts +X/+0 and +X/-X where-clauses.
5. **Tests:** its-toughness and each-attacking its-power execution; they/other/prefix fallback; expanded grant fallback; routing wiring.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 255)

1. **Per-target its power/toughness where-X:** mass pumps like `each creature you control gets +X/+X, where X is its power` re-evaluate X per target (same seam as `on it` counters).
2. **Reference stats:** `x is its toughness` uses `readPermanentToughness` (includes counters and effective stats).
3. **Asymmetric team +X/+0 bare fragment:** `creatures you control get +X/+0 where X is …`.
4. **Grant-keyword bare fragments:** `creatures you control gain …` and `target creature gains … until end of turn`.
5. **Tests:** per-creature its-power execution, team hand-scaled +X/+0 fallback, menace/hexproof grant fallback, routing wiring.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 254)

1. **Greatest-power where-X fix:** `x is the greatest power among creatures you control` no longer mis-parsed as a creature subtype in specialized extrema evaluation.
2. **Target its power/toughness:** `x is its power/toughness` resolves from the pumped target, not only the source.
3. **Reference / attacked / opponent scaled bare fragments:** `that/equipped/enchanted creature`, `the creature that attacked`, and `each opponent's creatures` where-X bare parse.
4. **Clause pattern:** `the creature that attacked` in `MODIFY_PT_TARGET_PATTERN`.
5. **Tests:** greatest-power execution, its-toughness target scaling, fallback (attacked, that-creature, opponent hand-scaled), routing wiring.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 253)

1. **Chosen / blocking / another scaled PT:** bare fragments for `the chosen creature`, `each creature blocking it`, and `another target creature` +X/+X (or -X/-X / -X/-0) where-clauses.
2. **Opponent asymmetric -X/-0:** opponent-target scaled bare fragment accepts fixed toughness (not only symmetric -X/-X).
3. **Clause pattern:** `the chosen creature` and `each creature blocking it` in `MODIFY_PT_TARGET_PATTERN`.
4. **Tests:** bare parse + execution, fallback apply (chosen, blocking hand-scaled, another-target counter X), routing wiring.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 252)

1. **Exact-count multi-target PT:** `two target creatures get +N/+N` (and one/three/four/five/N) resolve all `chosenObjectIds`; bare trigger fragment; no longer mis-resolved via generic `target creature` substring match.
2. **Target-player mass PT:** bare fragments for `creatures target player controls get +N/+N` and scaled `+X/+X where X is …`; `MODIFY_PT_TARGET_PATTERN` includes target-player mass selector (fixes grant_static_ability mis-parse).
3. **Scaled target bare fragments:** target / you-control / opponent-control `-X/-X` and `+X/+X`; each-attacking counter-scaled `+X/+X where X is counters on it`.
4. **Tests:** bare parse + execution, fallback apply (target-player mass, two-target, each-attacking X), routing wiring.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 251)

1. **Multi-target PT pumps:** `one or two target creatures`, `up to N target creatures`, and `any number of target creatures each` resolve all `chosenObjectIds` instead of only the first target.
2. **Prefix self compound:** bare fragment for `until end of turn, it gets +N/+N and gains X`.
3. **Asymmetric each-creature X:** bare fragment supports `each creature you control gets +X/+0 where X is counters on it`.
4. **Tests:** multi-target execution/fallback, prefix self compound, opponent hand-scaled -X/-X, each-creature +X/+0.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 250)

1. **Per-target where-X on "it":** `each creature you control gets +X/+X where X is counters on it` re-evaluates X per creature instead of using the first target only.
2. **Up-to-one target pump:** bare fragment + `MODIFY_PT_TARGET_PATTERN` for `up to one target creature gets +N/+N`.
3. **Unblocked attacking mass PT:** target resolution for `unblocked attacking creatures`; bare fragment.
4. **Tests:** per-target counter execution, up-to-one-target fallback, unblocked attacking fallback, counters-on-permanents target X, routing wiring.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 249)

1. **Team X pumps:** bare fragments for `creatures you control get +X/+X where X is …` (creature count, greatest power).
2. **Stampede compound X:** prefix `gain trample and get +X/+X where X is greatest power` bare fragment (grant then modify_pt).
3. **Global hand-scaled PT:** bare fragment for `all creatures get -X/-0 where X is cards in your hand`.
4. **Flanking mass PT:** bare fragment for `all attacking creatures with flanking get +N/+N`.
5. **Per-creature counter X:** bare fragment for `each creature you control gets +X/+X where X is +1/+1 counters on it`.
6. **Qualified target pumps:** bare fragments for `another target creature gets` and `target creature you control gets`.
7. **Tests:** bare parse, fallback apply, routing wiring.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 248)

1. **Antecedent X pump:** `they get +X/+X until end of turn, where X is …` parses as `modify_pt` (not static grant); bare fragment + `they` in modify_pt target pattern.
2. **Reference creature pumps:** bare fragments for `that creature`, `equipped creature`, `enchanted creature`; executor resolves equipped via attachment and that creature via trigger target id.
3. **Blocking mass PT:** fallback test for `each creature blocking it gets -N/-N` with `blockedBy` combat state.
4. **Mountains-scaled attacking pump:** `where X is the number of Mountains you control` evaluator; attacking mass +X/+0 execution.
5. **Fallback prefilter:** extended to match `get +X/+X` (not only numeric `+N/+N`) so X-scaled trigger PT reaches uncategorized IR fallback.
6. **Tests:** bare parse, fallback apply, routing wiring.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 247)

1. **Antecedent pronoun PT:** `they get +N/+N until end of turn` resolves via antecedent IDs (same as `those creatures`).
2. **Global / opponent mass PT:** `each creature gets +N/+N`; `each opponent's creatures get -N/-N`.
3. **Blocking / chosen targets:** `each creature blocking it gets +N/+N` via source `blockedBy`; `the chosen creature gets +N/+N` via `chosenObjectIds`.
4. **Compound `get + have`:** `creatures you control get +N/+N and have trample` splits to `modify_pt` + `grant_temporary_ability`.
5. **Prefix combat team pump:** `until end of combat, creatures you control get +N/+N until end of turn` bare fragment + target prefix strip.
6. **Tests:** bare parse, fallback apply (they/global/opponent/compound-have/chosen), routing wiring.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 246)

1. **Qualified mass PT targets:** attacking creatures, creature tokens, subtype (`Zombie creatures`), `creatures you control with flying`, and `non-Red creatures` resolve in `resolveCreatureTargetIds`.
2. **Attacking creature self pump:** `the creature that attacked gets +N/+N` parses and resolves to the attacking source.
3. **Enchanted creature:** `enchanted creature` PT resolves via aura `attachedTo`/`enchanting`.
4. **Tests:** bare parse, attacking/subtype/attacked-creature fallback, routing wiring.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 245)

1. **Each-other mass PT:** `each other creature you control gets +N/+N until end of turn` resolves via `resolveCreatureTargetIds` (excludes source); bare trigger fragment.
2. **Antecedent mass PT:** `Those creatures get +N/+N until end of turn` resolves via `lastAntecedentBattlefieldPermanentIds`; trigger fallback passes antecedent IDs from `triggerItem`.
3. **Tests:** bare parse, fallback apply (each-other + those-creatures), routing wiring.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 244)

1. **Prefix team compound:** `until end of turn, creatures you control get +N/+N and gain X` splits/applies; clause splitter emits normalized sub-clauses with `until end of turn` suffix.
2. **Team `have keyword`:** `creatures you control have haste until end of turn` → `grant_temporary_ability` (not static).
3. **Target-player mass pump:** Shields-of-Velis-Vel pattern splits PT+grant; `creatures target player controls` resolves via `targetPlayerId`.
4. **Parser cleanup:** strip leading duration prefix from modify_pt targets; non-keyword grants use `effectText`.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 243)

1. **Mass target resolution:** `each creature you control` aliases to controlled creatures; `creatures you control of the chosen type` filters by `chosenCreatureType` in `resolveCreatureTargetIds`.
2. **Chosen-type compound pumps:** parser + bare fragments split PT+keyword; grant mass-target handler recognizes chosen-type selector; trigger fallback merges `chosenCreatureType` from `triggerItem` into IR execution context.
3. **Keyword grant cleanup:** compound bare fragments strip trailing `until end of turn` from keyword lists (fixes `flying until end of turn` stored as ability text).
4. **Tests:** each-creature pump, chosen-type haste compound, clean target flying grant; routing wiring.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 242)

1. **Compound team PT+keyword split:** `creatures you control get +N/+N and gain X until end of turn` splits into `modify_pt` + `grant_temporary_ability` via `splitConservativeModifyPtTemporaryAbilityClause` (`get`/`gain` plural forms); temporary grant parser rejects compound PT targets.
2. **Bare trigger fragments:** compound team/self/target PT+keyword pairs in `parseStructuredTriggerResidualGrant`.
3. **Prefix duration:** `until end of turn, target creature gets +N/+N and gains X` splits without trailing `until end of turn`.
4. **Tests:** compound team vigilance bare parse, fallback apply, routing wiring.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 241)

1. **Other-creatures PT target resolution:** `resolveCreatureTargetIds` handles `other creatures you control` (excludes source); bare fragment in `parseStructuredTriggerResidualGrant`.
2. **Double P/T execution:** `double … power and toughness until end of turn` parses as `modify_pt`; executor applies +currentPower/+currentToughness at resolution.
3. **`cant_block` fallback wiring:** added to `ORACLE_IR_FALLBACK_STEP_KINDS`; prefilter includes `can't block`; bare fragment for `target creature can't block this turn`.
4. **Tests:** other-creatures pump, double P/T, target cant block fallback; routing wiring; bare parse extended.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 240)

1. **Double power IR execution:** `double … power until end of turn` parses as `modify_pt` (not static `grant_temporary_ability`); executor applies +X/+0 where X is current power at resolution.
2. **Self PT bare parse:** `it/he/she gets +N/+N until end of turn` and bare `double target creature's power until end of turn` in `parseStructuredTriggerResidualGrant`.
3. **Fallback prefilter:** includes `double` so double-power triggers reach IR fallback when primary is OFF.
4. **Tests:** self +2/+2, team +1/+0, double target power, and self flying fallback; routing wiring for flying, +1/+0, double power; bare parse unit test extended.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 239)

1. **Trigger PT bare parse:** `creatures you control get +N/+N until end of turn` and `target creature gets +N/+N until end of turn` parse as `modify_pt` in `parseStructuredTriggerResidualGrant`; `parseTriggerEffectSteps` tries bare fragments before `isExternallyHandledOracleFragmentText`.
2. **Fallback prefilter:** `wouldOracleIRFallbackPrefilterMatch` includes `gets? +N/+N` so team/target exert pumps reach IR fallback when primary is OFF.
3. **Legacy retirement:** `applyRetiredTriggerLegacyPTModificationBatch` skips when `isTriggerEffectFullyIrWired`; `applyRetiredTriggerLegacyManaAndCombatBatch` skips reminder-text `add {r}…` when fully wired (extra-combat and other batch handlers unchanged).
4. **Tests:** `rules-engine/test/oracleIRTriggerPtBareParse.test.ts`; Tah-Crop team pump + target +2/+2 fallback; routing `modify_pt` assertions; legacy PT batch skip test.

Validation:

1. `npx vitest run test/oracleIRTriggerPtBareParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/exert-choice.integration.test.ts tests/stack.generic-library-and-untap.regression.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 238)

1. **Combat evasion legacy retirement:** All four `oracleIrTriggerLegacyCombatEvasionHandlers` skip when `isTriggerEffectFullyIrWired` (target unblockable, self unblockable + scry, self combat prevention, low-power unblockable) — IR fallback owns the effect when primary is OFF.
2. **Fallback coverage:** Integration tests for target unblockable and Trueheart Twins low-power self unblockable via `applyOracleIRFallbackForTriggeredEffect`.
3. **Exert scry assertions:** Clockwork Droid exert/replay tests expect IR `SCRY` resolution steps (with library seeded) instead of legacy `pendingScry`.
4. **Routing assertions:** `isTriggerEffectFullyIrWired` + `collectOracleEffectSteps` for target and low-power exert reward text.

Validation:

1. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/exert-choice.integration.test.ts`
2. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 237)

1. **Oketra self combat prevention parse:** `prevent all combat damage that would be dealt to it this turn` now parses as `grant_temporary_ability` (not `grant_static_ability`) in life/combat clauses, bare trigger fragments, and residual unknown-step postprocess.
2. **Legacy retirement:** `applyRetiredTriggerLegacySelfPreventCombatDamage` skips when `isTriggerEffectFullyIrWired` — IR fallback owns the effect when primary is OFF.
3. **Tests:** `rules-engine/test/oracleIRSelfCombatPreventParse.test.ts`; Oketra fallback case in `oracle-ir-trigger-combat-evasion-fallback.test.ts`; routing wiring assertions for Oketra.

Validation:

1. `npx vitest run test/oracleIRSelfCombatPreventParse.test.ts` (rules-engine)
2. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/exert-choice.integration.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 236)

1. **Trigger fallback mandatory execution fix:** `applyOracleIRUncategorizedSpellFallback` no longer lets trigger `allowOptional: true` override mandatory-step batches — counter-scaled `modify_pt` (Hydra Trainer exert) now applies through tail IR fallback when primary is OFF.
2. **PT modifier server sync:** `syncIrPowerToughnessModifiersToTemporaryPTMods` runs for all IR apply paths (not only trigger-primary ON), bridging rules-engine `modifiers` → server `temporaryPTMods`.
3. **Counter-scaled legacy retirement:** `applyRetiredTriggerLegacyPTModificationBatch` skips counter-scaled +X/+X when `isTriggerEffectFullyIrWired`; legacy `pushTemporaryPTMod` dedupes same-source EOT mods to avoid double-apply when IR + legacy both run.
4. **Tests:** `oracle-ir-trigger-combat-evasion-fallback.test.ts` (Hydra counter-scaled + Clockwork scry queue), primary-mode Hydra test, routing wiring assertions; added to migration gate.

Validation:

1. `npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/exert-choice.integration.test.ts`
2. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 235)

1. **G1 verification sweep:** Re-ran Gwenna mana selection, Door of Destinies IR primary, creature-type ETB persistence, Roaming Throne doubling, and Cryptoplasm copy corridors — all green.
2. **Migration gate expansion:** Added `oracle-ir-counter-distribution.integration.test.ts`, `oracle-ir-court-garenbrig-counter-distribution.socket.integration.test.ts`, and `door-of-destinies-ir-primary.integration.test.ts` to `npm run test:oracle-ir-migration`.
3. **G1 status doc sync:** Migration plan table updated — open G1 log items now marked verified-by-test where integration coverage exists.

Validation:

1. `npx vitest run tests/gwenna-mana-color-selection.integration.test.ts tests/door-of-destinies-ir-primary.integration.test.ts tests/creature-type-etb-persistence.integration.test.ts tests/roaming-throne-trigger-doubling.integration.test.ts tests/cryptoplasm-copy.integration.test.ts`
2. `npx vitest run tests/oracle-ir-court-garenbrig-counter-distribution.socket.integration.test.ts tests/oracle-ir-counter-distribution.integration.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 234)

1. **Counter replacement sync fix:** `syncCounterReplacementEffectsAfterOracleIR` applies replacement bonus deltas (+1 when doubling) without revert-to-zero; defers SBA during replacement sync so multi-target distribute + Branching Evolution no longer 0/0-kills unprinted-P/T creatures mid-batch.
2. **Branching Evolution socket E2E:** resume tests for Court upkeep target pick → doubled 2+2 counters (direct `maybeApply` + full socket `submitResolutionResponse` path).
3. **Roaming Throne ETB persistence:** `creature-type-etb-persistence.integration.test.ts` covers chosen creature type surviving trigger doubling.

Validation:

1. `npx vitest run tests/oracle-ir-court-garenbrig-counter-distribution.socket.integration.test.ts`
2. `npx vitest run tests/creature-type-etb-persistence.integration.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 233)

1. **Distribute target queue bridge:** `queueAddCounterTargetSelectionPromptsFromOracleIRResult` queues `TARGET_SELECTION` when distribute-among `add_counter` steps have no bound targets (`no_deterministic_target`).
2. **Target-selection resume fix:** `maybeApplyOracleIrChoiceStepFromResolution` treats array target picks separately from counter-distribution object payloads; `handleTargetSelectionResponse` resumes Oracle IR steps with `oracleIrChoiceStepJson`.
3. **Socket E2E:** `oracle-ir-court-garenbrig-counter-distribution.socket.integration.test.ts` covers Court upkeep target pick → auto 1+1 split, and three-counter split → `counter_distribution` prompt → resume.

Validation:

1. `npx vitest run tests/oracle-ir-court-garenbrig-counter-distribution.socket.integration.test.ts`
2. `npx vitest run tests/oracle-ir-counter-distribution.integration.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 232)

1. **CounterDistributionModal UX:** extracted validation helpers to `client/src/utils/counterDistributionUtils.ts`, reset distribution state when a new prompt opens, and added client unit tests.
2. **Client payload contract:** `getTypeSpecificFields` now emits `counter_distribution` modal fields; integration test asserts `sanitizeStepForClient` shape.
3. **Cryptoplasm corridor:** existing `cryptoplasm-copy.integration.test.ts` G1 resolution E2E covers optional accept/decline (no code changes required).

Validation:

1. `npm run test:vitest --prefix client` (or `cd client ; npx vitest run tests/counterDistributionUtils.test.ts`)
2. `npx vitest run tests/oracle-ir-counter-distribution.integration.test.ts tests/cryptoplasm-copy.integration.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 231)

1. **Stun counter distribute targets:** `resolveDistributeAmongTargetIds` now resolves `tapped creatures your opponents control` pools for distribute-among steps (Crashing Wave corridor).
2. **Tests:** `oracleIRGapBatch231.test.ts` (deterministic split, player choice, preselected split) and stun queue/resume case in `oracle-ir-counter-distribution.integration.test.ts`.

Validation:

1. `npx vitest run test/oracleIRGapBatch231.test.ts`
2. `npx vitest run tests/oracle-ir-counter-distribution.integration.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 230)

1. **Variable-amount distribute queue corridor:** verified end-to-end that reference-amount distribute (`equal to the number of creatures you control`) queues `COUNTER_DISTRIBUTION` when resolved total exceeds bound target count, then resumes with chosen split.
2. **Test coverage:** `oracleIRGapBatch230.test.ts` (parse + executor gap metadata) and third case in `oracle-ir-counter-distribution.integration.test.ts` (server queue + resume).

Validation:

1. `npx vitest run test/oracleIRGapBatch230.test.ts`
2. `npx vitest run tests/oracle-ir-counter-distribution.integration.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 229)

1. **Partner-with placeholder orphan:** `Partner with [name]` template fragment pruned via `isOrphanReminderOnlyAbilityText`.
2. **Server variable distribute:** `oracle-ir-counter-distribution.integration.test.ts` covers reference-amount distribute auto-applying on server when total equals bound target count (no `COUNTER_DISTRIBUTION` queue).

Validation:

1. `npx vitest run test/oracleIRGapBatch229.test.ts`
2. `npx vitest run tests/oracle-ir-counter-distribution.integration.test.ts`
3. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 228)

1. **Keyword reminder executable shells:** extended platform-reminder-only step pruning to cover `conditional` (madness discard-into-exile reminder), `grant_graveyard_permission`, and `modify_graveyard_permissions`; added orphan patterns for flashback self-cast / `Then exile it` split tails.
2. **Regression coverage:** Faithless Looting flashback wiring and fastland enters-tapped replacements unchanged.

Validation:

1. `npx vitest run test/oracleIRGapBatch228.test.ts`
2. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 227)

1. **Platform-only executable shells:** standalone fragments that matched `isCurrentBatchReminderOrPlatformOnlyText` but still emitted `grant_static_ability`, `grant_exile_permission`, or `draw` steps are now pruned when every step is platform-reminder-only (copy-without-pay tail, spend-mana restrictions, additional draw reminder, activated-cost reminder).
2. **Full-card regressions:** Psionic Ritual-style copy replay and Mystic Forge look-top static abilities unchanged.

Validation:

1. `npx vitest run test/oracleIRGapBatch227.test.ts`
2. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 226)

1. **Platform reminder orphan leaks:** `If you cast a card this way, you still pay its costs`, bare `Spend this mana only to cast spells`, mill keyword reminder, and `Damage causes loss of life` pruned via `isOrphanReminderOnlyAbilityText`.
2. **Platform matcher fix:** `if you cast a spell this way` matcher now accepts `card` as well as `spell`; added bare `spend this mana only to cast spells` platform-only pattern.

Validation:

1. `npx vitest run test/oracleIRGapBatch226.test.ts`
2. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 225)

1. **Otherwise tail orphans:** standalone `Otherwise, put it into your hand/graveyard` (and optional graveyard variant) pruned via `isOrphanReminderOnlyAbilityText` so split reminder tails do not emit spurious `move_zone` ability shells.
2. **Stale audit gaps already closed:** full-card probes confirm `look_hand`, `reveal_until`, reveal-top-put-hand compounds, and Meren-style conditionals parse without unknown steps.

Validation:

1. `npx vitest run test/oracleIRGapBatch225.test.ts`
2. `npm run test:oracle-ir-migration`

## Completed In This Pass (batch 224)

1. **Enters-tapped replacement regression:** `abilityEffectText` now prefers parsed `effect` over full `text` for replacement abilities; simple self `enters tapped` replacements short-circuit to `steps: []` with normalized `effectText` (`tapped`, `tapped unless …`).
2. **Fastland false prune:** removed `this land/permanent enters tapped unless` from platform-only reminder matcher (batch 223 overreach) so conditional tap lands stay as replacement abilities.
3. **Orphan `that much`:** standalone fragment pruned via `isOrphanReminderOnlyAbilityText`.

Validation:

1. `npx vitest run test/oracleIRGapBatch224.test.ts`
2. `npx vitest run test/oracleIRParser.test.ts -t "enters-tapped"`

## Completed In This Pass (batch 223)

The following high-frequency orphan reminder fragments were added to residual/ orphan pruning:

1. `This ability triggers only once each turn`
2. `It's still a land`
3. `Put the rest on the bottom of your library in a random order`
4. `When you do, cast it for its madness cost or put it into your graveyard.)`
5. `then put any number of them on the bottom and the rest on top in any order.)`
6. `then shuffle.)` / `then give each another counter of each kind already there.)`
7. Expanded orphan list for convoke inner text, vehicle/token tails, copy-retarget tails (batch 222 carryover)

Validation completed:

1. `npx vitest run test/oracleIRGapBatch223.test.ts`
2. `npm run test:oracle-ir-migration` — 553/553

## Completed In This Pass (batch 42)

The following high-frequency seams were implemented and dropped out of the refreshed top-gap list:

1. Gift promise rider `draw a card before its other effects`
2. Quoted static grants like `Other blue creatures you control have "Whenever…"`
3. Orphan `Visit —` attraction headers before `choose_mode`
4. `You draw two cards, lose 2 life` comma compounds
5. `Target player discards X cards at random`
6. `Teamwork N (...)` additional-cost reminder text
7. `While each one is exiled, its owner may cast it for {2}...` impulse riders
8. `You gain N life for each creature tapped this way`
9. Reveal-or-pay additional cost tails misparsed as `pay_mana.who`

Validation completed:

1. `npx vitest run test/oracleIRGapBatch42.test.ts`

## Next Ranked Todo

Most ranked orphan fragments through batch 226 are now pruned or wired (0 unknown-step gaps in the refreshed audit). Remaining work is card-behavior integration and executor coverage, not standalone fragment shells.

Stale ranked list (pre-batch 223–226, for reference):

1. `You may choose new targets for the copy`: 100 — pruned batch 223
2. `Each creature you tap while casting this spell pays for {1} or one mana of that creature's color.)`: 99
3. `This ability triggers only once each turn`: 96
4. `It's an artifact with "{2}, Sacrifice this token: Draw a card.")`: 95
5. `This Vehicle becomes an artifact creature until end of turn.)`: 94
6. `It's still a land`: 86
7. `This spell can't be countered`: 86
8. `Put the rest on the bottom of your library in a random order`: 75
9. `then give each another counter of each kind already there.)`: 68
10. `When you do, cast it for its madness cost or put it into your graveyard.)`: 59
11. `As an additional cost to cast this spell, sacrifice a creature`: 53
12. `then put any number of them on the bottom and the rest on top in any order.)`: 49
13. `Choose one or both -`: 48
14. `Enchanted creature doesn't untap during its controller's untap step`: 46
15. `that much` fragment: 44
16. `then shuffle.)`: 44
17. `You may look at the top card of your library any time`: 44
18. `Look at the top three cards of your library`: 42
19. `This artifact enters tapped`: 42
20. `You may choose new targets for the copies`: 42

## Notes

The audit filter was tightened in this pass to exclude reminder-keyword noise, `This land enters tapped`, `Partner (...)`, `Changeling (...)`, and plain `This creature can't block`, which are already handled elsewhere or are not actionable Oracle IR execution gaps.