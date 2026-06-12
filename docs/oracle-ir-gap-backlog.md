# Oracle IR Gap Backlog

Refreshed from `tools/oracle-ir-gap-audit.ts` against `oracle-cards.json` and `AtomicCards.json`.

## Current Audit Snapshot

- Unique cards parsed: 29,971
- Cards with gaps: 0
- Gap records: 0
- Report artifact: `tools/oracle-ir-gap-audit.json`

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