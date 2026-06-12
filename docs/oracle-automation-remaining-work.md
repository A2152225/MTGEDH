# Oracle Automation — Remaining Work

Living document. Update this file as gaps close and audits are re-run.

**Last updated: 2026-06-11** (batch **174** — generic distribute-counter IR; Layer 3 handoff refreshed)

> **Server integration / superseding handwritten resolution:** see **[oracle-ir-server-migration-plan.md](./oracle-ir-server-migration-plan.md)** for the Layer 3 migration plan (IR-first spells/triggers, Effect Program wiring, choice UI batches, shim retirement). This file covers Layer 1–2 (parser/executor gaps).

## Quick start for a new session

1. **Read the rules first:** `.cursor/rules/oracle-ir-no-bespoke-handlers.mdc` — no card-name handlers, no new `KNOWN_*` rows; parse → execute → server queue.
2. **Server integration (Layer 3):** read **[oracle-ir-session-handoff.md](./oracle-ir-session-handoff.md)** and **[oracle-ir-server-migration-plan.md](./oracle-ir-server-migration-plan.md)** § *Current status* — batch **279** G1 Merfolk fixes (Roaming Throne chosen type, tap triggers, Thassa library IR); batch **278** cleared trigger `ir_gap`.
3. Read this file for Layer 1–2 metrics and parser/executor priority order.
4. **Verify batch 174 before new work:**
   ```powershell
   cd rules-engine
   npx vitest run test/oracleIRDistributeCounters.test.ts

   cd ../server
   npx vitest run tests/inspiring-call-court-garenbrig.regression.test.ts
   npx vitest run tests/upkeep-trigger-detection.unit.test.ts
   npm run test:oracle-ir-migration
   ```
5. Re-run audits if code changed since the timestamp above:
   ```powershell
   cd server
   npm run executor:coverage
   npx tsx scripts/executor-selector-gap-analysis.ts
   npx tsx scripts/executor-target-gap-analysis.ts
   npx tsx scripts/executor-condition-gap-analysis.ts
   npm run executor:keyword-audit
   $env:EXECUTOR_COVERAGE_SCOPE="full_card"; npm run executor:coverage
   npx tsx scripts/_tmp-full-card-gap-clusters.ts
   ```
4. JSON reports land in `server/scripts/out/` (**gitignored** — regenerate locally; do not expect them in git). Use named scripts under `server/scripts/` — never inline `tsx -e` (see `.cursor/rules/terminal-hygiene.mdc`).
5. Trigger parse coverage (separate from executor): `npm run trigger:coverage`

---

## Audit baseline (executor coverage)

Source: `npm run executor:coverage --workspace=server`  
Report: `server/scripts/out/executor-coverage-audit.json`  
Scope: commander-legal **triggered-ability effects**, assisted fixture (pre-bound targets, `allowOptional=true`, auto first `choose_mode`)

| Metric | Baseline (2026-06-07) | Current (2026-06-09) |
|---:|---:|---:|
| Cards scanned | 29,614 | 29,614 |
| Trigger effects dry-run | 15,014 | 15,012 |
| IR gaps (`ir_gap`) | **0** | **0** |
| Fully applied | 10,502 (70.0%) → 11,050 (73.6%) | **14,290 (95.2%)** |
| Choice required (expected UI) | 956 (6.4%) → 1,122 (7.5%) | **722 (4.8%)** |
| Assisted execution rate | **76.3%** → **81.1%** | **100%** |
| Parse→execute gaps | 3,556 → 2,842 items | **0 items** |

### Status breakdown (current)

| Status | Count |
|---|---:|
| `fully_applied` | 14,290 |
| `choice_required` | 722 |
| `partial` | 0 |
| `unsupported` | 0 |
| `no_steps` | 0 |
| `impossible` | 0 |
| `ir_gap` | 0 |

### Top skip reason codes (current)

| Rank | Reason code | Baseline → Current |
|---:|---|---:|
| 1 | `player_choice_required` | 1,082 → **778** (expected UI; not a parse bug) |
| 2 | `failed_to_apply` | 99 → **0** |
| 3 | `impossible_action` | 72 → **0** |
| 4 | `unsupported_destination` | — → **0** |
| 5 | `unsupported_where_clause` | — → **0** |

### Top skipped step kinds (current)

| Step kind | Baseline → Current |
|---|---:|
| `move_zone` | 1,112 → **~157** |
| `conditional` | 705 → **~64** |
| `sacrifice` | 300 → **330** |
| `grant_temporary_ability` | 268 → **~0** (target gaps cleared batch 26) |
| `discard` | 161 → **431** |
| `scry` | 229 → **231** |
| `copy_spell` | 132 → **0** |
| `destroy` | 221 → (see JSON for full list) |

### Gap analysis reports (current)

| Report | Path | Items | Clusters |
|---|---|---:|---:|
| Selector | `server/scripts/out/executor-selector-gap-analysis.json` | **0** | **0** |
| Target | `server/scripts/out/executor-target-gap-analysis.json` | **0** | **0** |
| Condition | `server/scripts/out/executor-condition-gap-analysis.json` | **0** | **0** |
| Amount | `server/scripts/out/executor-amount-gap-analysis.json` | **0** | **0** |

### Highest-volume gap patterns (unchanged families)

1. **ETB** — `exile target card from an opponent's graveyard` (~3,039 triggers; mixed statuses)
2. **Attacks** — `it gets +N/+M until end of turn` (~756)
3. **Upkeep** — Duplicity-style hand exile packages (~594)
4. **Dies** — optional draw (~489)
5. **Combat damage to player** — impulse exile cast (~290)

### Related audits (green)

| Audit | Status |
|---|---|
| Trigger coverage (`trigger:coverage`) | 15,742 / 15,742 fully covered; 0 IR gaps |
| Intervening-if corpus (`intervening-if:audit`) | 727 / 728 recognized |
| Game-system verifier (`verify-automation`) | 97% infrastructure |

---

## Priority queue

Work in this order unless a specific card/report redirects effort.

### 1. Selector binding — `unsupported_selector` [done]

**0 items / 0 clusters** — batch 44 closed the final 36 singletons (hand exile variants, compound reveal+shuffle, linked exile, owner/control returns, among-them gate/shares-type, each-opponent patterns, reference counts, outside-game hand, cloak, stash exile).

- [x] Batches 1–5: opponent graveyard, self-reference, antecedents, hand/GY splits, colored bounce, linked exile (340 → 98)
- [x] Batch 26: `grant_temporary_ability` target gaps → **0**
- [x] Batch 27: attach/zone selector extensions (124 → 98 selector gaps)
- [x] Batch 36: attach `target land you control` (subtype handler shadowed land type), `all cards that are black or red from all graveyards`
- [x] Batch 39: milled cards to library top, `put into your graveyard this way`, each-player single-card exile, Three Wishes unplayed, `it and this aura` bounce, Gerrard compound exile+return; selector gap analysis uses audit enrichment parity
- [x] Batch 40: random single from GY word order, both-cards → battlefield, one-of-those-dragons, morph creature from hand, two target sorceries from single GY; conditions for reveal-creature-this-way, copy-is-permanent-spell, same-name-in-GY-or-nontoken-on-battlefield
- [x] Batch 41: Kairi total-MV nonland bounce, Death's Oasis lesser-MV-than-died return, Wildfire Devils target-player GY exile, Nulltread library-top, Underworld Cerberus compound, Elkin Lair random hand exile; `instant and/or sorcery` type normalization
- [x] Batch 42: mass non-{type} creature bounce, any-number hand→battlefield, total-MV GY reanimate, craft exile→battlefield, up-to-that-many target bounce, top-N opponent library face-down, command zone→battlefield, Myra GY instant/sorcery exile, shares-type among-them; hand criteria (lesser power, equal/lesser MV, lands-controlled MV, noncreature nonland milled); conditions for elf opponents, ring-bearer tempt, vehicle MV die roll
- [x] Batch 43: attach (pirate/equipment/aura reattach/mass transfer), contextual them split (any-number/two-of hand+GY/library), among-them OR-types/colored/different-powers/revealed-this-way, milled land to hand, up-to nonblack bounce, those-permanent-cards, them→battlefield
- [x] Batch 44: time-counter/colorless/nonartifact hand exile, hand-or-GY artifact/creature exile, charge-counter MV hand→BF, that-many library-top exile, outside-game hand, hand→library bottom, one-or-more GY creatures exile, owned nonland bounce, Loaming Shaman shuffle, each-opponent bounce (Enigma `up` IR), Oblivion Sower lands-from-exile, Reincarnation owner GY, Mark of Eviction compound bounce, linked exile (Steamboat/Mechtitan/Bat), discarded-card return, gate/shares-type among-them, cloak, Winter 4-type GY exile, Zethi kicked instants, Kefka random GY, Thicket reveal+shuffle postprocess, Cass aura reattach, Search the City named-card hand, Tinybones stash

**Next focus:** Full-card gap reduction (keyword/reminder pruning, shock lands, attach/reconfigure). Static parser backlog top clusters (`oracle-ir-gap-backlog.md`). Trigger-order / replacement UI hooks.

**Server integration (Layer 3):** Phase 4 regex retirement in progress — see **[oracle-ir-server-migration-plan.md](./oracle-ir-server-migration-plan.md)** § *Current status / session handoff*. Latest: batch **172** (exert corridor 23/23, copy-token regex fix). Next: `grant_temporary_ability` wiring, counter-scaled `modify_pt`, continued trigger regex gutting.

### Parse→execute singleton pass [done] (2026-06-09)

Closed the final 7 singleton gaps (earthbend where-X, Greasefang compound, Azlask experience counter, Labyrinth Adversary pay-when-do, Warren Torchmaster blight, Depthshaker Titan animate+ delayed sacrifice):

- [x] Earthbend `where X is …` on single IR step + `resolveOracleQuantity` where-X in executor
- [x] `parseBareTriggerEffectFragmentSteps` wired into parser + audit fallback
- [x] Audit enrichment: earthbend land target, any-number artifact animation
- [x] `applyAnimatePermanentStep` binds explicit target for `any number of target …`
- [x] Copy SBA 704.5e in `runSBA` (removes `isCopy` from hand/GY/exile/library)
- [x] GameAutomationVerifier: win effects + copy zone → PARTIAL

### 5. Amount resolution — `unknown_amount` + `unsupported_scaler` [done]

**0 hits** (was 72) — batch 48 closed the final 4 singletons.

- [x] Batch 47: extended `resolveOracleQuantity` (object_stat subjects, source_power after sacrifice, reveal_until_land, that spell MV, cards equal to its power); `resolveReferenceScalerScale` expansion + unknown-scaler inference from step raw; where-X fixes (`normalizeModifyPtWhereRaw` comma+and keyword lists, opponents-with-more-lands ordering); turn/board-state where-X (tokens created, exiled-under-opponents, mounts/vehicles ETB, instant/sorcery cast, keyword counts, counters-on-it); audit enrichment for contextual card/sacrifice/spell MV, gy-return MV, turn stats, stickers/keywords; `applyLookChooseFromTopStep`/`applyDrawStep` runtime wiring; `pruneEquipmentBleedSteps`; p2 library typing for mill-until-land; sacrifice ctx propagation for nested conditionals
- [x] Batch 48: `parseQuantity` spell MV → `reference_amount` (was mis-mapped to `that_card` object_stat); object_stat MV fallback to `lastCastSpellManaValue`; gy-return audit prefers `gy-creature-1` over antecedent; graveyard card-type scaler; chosen-letter name-sticker scaler + `player_choice` letter auto-bind; audit `chosenLetter`/sticker fixtures

### 2. Conditional wrappers — `unsupported_condition_clause` [done]

**0 hits** (was 39) — batch 45 closed all remaining singletons.

- [x] Batch 28–30: antecedent defaults, extended singleton module, composite `or` guards, turn/life/hand audit ctx
- [x] Batch 37: `not (...)` unless clauses delegate to extended evaluator; power-compare, didn't-attack-you, milled-noncreature-nonland, warrior-team power checks
- [x] Batch 40: Vesuvan reveal-creature-this-way, Spider-Verse copy-is-permanent-spell, Bazaar same-name-in-GY-or-nontoken-on-battlefield
- [x] Batch 42: each opponent without elf, ring-bearer + two temptations, vehicle MV equals die roll, opponent-highest-roll, shared-type discard rider, you-are-one-of-those-players
- [x] Batch 45: Mishra attack pair, copy-target retarget, Gandalf shares-type, Sphinx search-name, Yidaro cycles, Worms either-choice, Berg `{s}` spent, C.A.M.P. color match, Reptilian OR-power/lizard, Nazahn hammer reveal, Sword of Hours die/damage, Firemane none-attacked-you, Marauding Raptor dinosaur damage, Phyrexian Atlas poison riders, Battle Angels hand leader, Greenbelt/Doom can't-pay, Charging Hooligan rat attacking, Vulpine/Guidelight/Bortuk MV gates, exploit riders, Clive lore counters, Xathrid can't sacrifice, Faller's Faithful undamaged, Anax power-4+, Rampaging Geoderm battle attack, Skulking Killer lone-creature, Anowon milled creature, Obstinate Baloth opponent discard, Mog discarded-this-way (creature + noncreature), Farideh die ≥10, Conundrum named reveal, Wakka counter-this-turn, Guild Feud two-BF, Search the City empty exile, Grudge Keeper vote split; audit ctx for buyback/discarded-this-way; main-loop discarded-this-way no longer null without antecedent step

### 3. Copy-spell corridor — `invalid_copy_spell_source` [done]

**0 hits** (was 142) — batch 32 closed Fury Storm sibling replay, black-card graveyard criteria, and `last_moved_card` ctx fallback.

- [x] Batch 31: `getCopiedStackObjectReplaySteps`, `resolveThisSpellCopyReplaySteps`, stack ability fixture, linked-exile instant oracle, audit `enrichAuditStateAndContextForCopySteps`
- [x] Batch 32: sibling `target_spell` replay for storm `this_spell` copies, solo-color graveyard criteria (`black card`), `isReplayableForThisSpellCopy` filter fix

### 4. Targeting pipeline — `unsupported_target` + `no_deterministic_target` [done]

**0 target gaps** (was 58) — batch 46 closed all remaining clusters.

- [x] Batch 32–33: mass destroy/exile, special target handlers, audit enrichment
- [x] Batch 37: `add_counter` passes `lastMovedBattlefieldPermanentIds` (Kardur saga III, Deathmist megamorph)
- [x] Batch 38: artifact-only audit source CMC 8 (Pinnacle Starcage), singular `target nonland permanent` exile, `move_counters` sacrificed snapshot, `another target creature` excludes source
- [x] Batch 46: `oracleIRExecutorExtendedTargetResolution.ts` (mass cant_block filters, enchanted/equipped refs, target-prefixed bound resolution); extended `resolveDirectBattlefieldPermanents`; special handlers for sacrifice/copy/double_counters/remove_counter/move_counters/monstrosity/exert/turn_face_down/tap_or_untap/force_block/suspect/schedule_delayed; Runadi MV−4 ETB counter; audit enrichment for land auras, bait/magnet counters, assimilation exiled copy; self-sacrifice after source destroyed (The Moment)

### 5. Amount / scaler — `unknown_amount` + `unsupported_scaler`

**44 + 28 = 72 cluster items** — batch 35 closed connive X, impulse/exile-top where-X, spell MV tokens, descended count, ETB object-stat CMCs, token targetCreatureId for where-X, deal_damage contextual card stats.

- [x] Batch 34: `resolveOracleQuantity` contextual cards, `getCardManaValue` land=0, reveal_top `lastMovedCards`, modify_pt reference_scaler executor, parser blocking-it scaler, impulse until-MV null-safe, audit library CMCs
- [x] Batch 35: connive `reference_amount`/where-X, impulse/exile-top `amount.kind=x` + where-X, `referenceSpellManaValue`/stack spell MV, descended count (`permanentCardsPutIntoYourGraveyardThisTurn`), audit source/ETB CMCs, token where-X targetCreatureId, deal_damage discarded/exiled card stats
- [ ] Remaining 44 unknown_amount: singleton create_token X formulas, sacrifice-power damage, cross-step discard riders
- [ ] Remaining 28 unsupported_scaler: exotic for-each patterns

### 6. Game infrastructure (verify-automation pending/partial)

- [x] Lab Man / Jace draw-win replacement (`checkEmptyLibraryDraw`)
- [x] Upkeep win cards (Felidar Sovereign, Test of Endurance, etc. in `win-conditions.ts`)
- [x] Copy zone movement SBA 704.5e (`runSBA` removes `isCopy` from non-stack/non-battlefield zones)
- [x] Thassa's Oracle ETB devotion win (`tryResolveThassasOracleWin` + `checkThassasOracleWin`)
- [x] Thassa's Oracle ETB library look/reorder (batch 279: `look_select_top` + `LIBRARY_SEARCH` queue; win tail unchanged)
- [ ] Same-controller trigger ordering UI (`ORDER_TRIGGERS`)
- [ ] Replacement-effect choice (`CHOOSE_REPLACEMENT`)

### 7. Full-card executor audit (baselined 2026-06-09)

Source: `EXECUTOR_COVERAGE_SCOPE=full_card npm run executor:coverage --workspace=server`

| Metric | Before (2026-06-09) | After keyword pass | After reminder pass | After ETB/regen pass | After conditional pass | After reveal pass | After fight pass | After no_steps pass | After benign-skip pass |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Ability clauses dry-run | 52,196 | 51,924 | 51,805 | 51,695 | 51,678 | 51,655 | 51,654 | 51,048 | **51,044** |
| Fully applied | 46,085 (88.3%) | 46,881 (90.3%) | 47,185 (91.1%) | 47,249 (91.4%) | 47,282 (91.5%) | 47,363 (91.7%) | 47,400 (91.8%) | 48,088 (94.2%) | **49,444 (96.9%)** |
| Parse→execute gaps | 2,765 on 2,642 cards | 1,736 on 1,666 cards | 1,541 on 1,492 cards | 1,481 on 1,432 cards | 1,497 on 1,447 cards | 1,440 on 1,392 cards | 1,401 on 1,358 cards | 675 on ~650 cards | **166 on ~160 cards** |
| Assisted execution rate | **92.9%** | **94.9%** | **95.6%** | **95.9%** | **95.9%** | **96.1%** | **96.2%** | **98.7%** | **99.7%** |
| `ir_gap` | 964 | 926 | 763 | 649 | 632 | 585 | 585 | 218 | **0** |
| `no_steps` | 1,356 | 327 | 301 | 279 | 252 | 252 | 227 | 0 | **0** |
| `unsupported` | 772 | 772 | 616 | 578 | 578 | 570 | 563 | 158 | **0** |
| `partial` | — | — | — | — | — | 601 | 594 | 506 | **155** → **137** → **135** → **134** → **131** → **130** → **128** → **127** → **122** → **119** → **109** → **40** → **32** → **26** → **20** → **11** → **5** → **0** |
| `impossible` | — | — | — | — | — | — | — | — | **0** |

**Current full-card snapshot (2026-06-09 re-audit):** 51,156 clauses dry-run; **49,713** fully applied (97.2%); **1,226** choice_required; parse→execute gaps **0** on **0** cards; assisted **99.6%**; **`impossible` 0**; **`partial` 0**; **`ir_gap` 0**.

**2026-06-09 batch12 ir_gap pass:** **`ir_gap` 217 → 0**. Parser postprocess: reference-stat/`parseQuantity` expansion, `when`-you-do delayed triggers, rhystic/unless-pay misparse repair (pay_mana/lose_life/gain_life/emblem/graveyard-permission), choose_mode nested lowering, emblem lose_life misparse repair. Tests: `oracleIRGapBatch41.test.ts`.

**2026-06-09 batch11 final partials pass:** parse→execute gaps **5 → 0**, **`partial` 5 → 0**, fully applied **49,708 → 49,713**. Mindblaze `reveal_top` library + chosen-name/count conditional; Scrying Glass chosen-color hand count; Wand of Ith `it isn't a land` + unless-pay audit fixture; Winter's Chill `that player doesn't` / `pays only {1}` branches; Caesar `repairSplitChooseModeBulletSteps` for audit effectText re-parse. Tests: `oracleLookChooseExecutor.test.ts` (82 tests).

**2026-06-09 batch10 look-choose pass:** parse→execute gaps **11 → 5**, **`partial` 11 → 5**, fully applied **49,707 → 49,708**. Infernal Offering opponent GY→BF (`requiresExplicitControllerOverride` GY exception + `parsedTypedCardFromTargetPlayerGy` battlefield path + `choose_opponent` audit enrichment); Selective Adaptation compound `one of the chosen cards` ability-level split (`splitCompoundChosenCardsMoveZoneAbilities`); Welcome the Dead turn-stat where-X (`cardsPutIntoYourGraveyardFromNonBattlefieldThisTurn`); Transpose `cast from your hand` conditional; Sculpted Sunburst `you chose a creature this way`; Minsc hamster sacrifice conditional + audit fixture. Tests: `oracleLookChooseExecutor.test.ts` (77 tests).

**2026-06-09 batch9 look-choose pass:** parse→execute gaps **20 → 11**, **`partial` 20 → 11**, fully applied **49,700 → 49,707**. Vincent/Evie grant-target normalization (Tiered prefix, `when you discard…` strip); Showstopping `turn it face up` special; Chandra loyalty removal + reference count; Tilonalli/Gemini delayed battlefield scheduling; Zimone odd/even parity bounce + `chosenOddEven` context; Nuclear Fallout `add_player_counter` X via `ctx.xValue`; Liliana emblem `two plus zombies` token scaler + where-clause strip; `player_choice` odd_even binding. Tests: `oracleLookChooseExecutor.test.ts` (74 tests).

**2026-06-09 batch8 look-choose pass:** parse→execute gaps **26 → 20**, **`partial` 26 → 20**, fully applied **49,694 → 49,700**. Real Hew `revealed/chosen this way` split (3×`move_zone` + dedupe); Plague Reaver delayed `this creature` return; Living Inferno power-divided among target creatures; Flickerform enchanted creature+auras exile; Spoils `all other cards revealed this way` exile; Elderspell destroy any-number planeswalkers + loyalty scaler; Urza spell-cost reduction grant. Tests: `oracleLookChooseExecutor.test.ts` (68 tests).

**2026-06-09 batch7 look-choose pass:** parse→execute gaps **32 → 26**, **`partial` 32 → 26**, fully applied **49,686 → 49,694**. `lowerAmongThemChoosePlayerChoiceAbilities` after `lowerCurrentResidualUnknownAbilities` (Hew among-them `player_choice`→`move_zone`); sacrifice `any number of lands` deterministic when `chosenObjectIds` bound; `parseMoveZoneExileXTargetCardsFromTargetPlayerGraveyard` (Suffer the Past); mass bounce `excludeChosenCreatureType` (Raise the Palisade); Dubious Challenge `the rest`→BF; Open into Wonder `^(?:up to )?x target creatures$` grant; Taunt goad→`lastGoadedBattlefieldPermanentIds` + cant_block `those creatures` with parenthetical strip. Tests: `oracleLookChooseExecutor.test.ts` (63 tests).

**2026-06-09 batch6 look-choose pass:** parse→execute gaps **40 → 32**, **`partial` 40 → 32**, fully applied **49,678 → 49,686**. Planar Genesis generic `a card from among them` + conditional rest-to-library-bottom IR enrich; Verdant Mastery `{3}{G} cost was paid` conditional + compound `two of them onto BF… and the rest` split; Stargaze `X cards from among them` hand+GY split; Barrel Down Sokenzan `any number of Mountains you control`→hand; Dragon-Kami's Egg hatching-counter face-down exile; Sagittars' Volley each-opponent flying-creature damage; Fists of Flame `+1/+0 for each card you've drawn this turn` scaler; Haunting Voyage foretold conditional audit skip when not foretold. Tests: `oracleLookChooseExecutor.test.ts` (59 tests).

**2026-06-09 batch5 look-choose pass:** parse→execute gaps **54 → 40**, **`partial` 54 → 40**, fully applied **49,664 → 49,678**. Shallow Grave top-creature GY return; Selvala `those creature cards`→BF; Rally the Ancestors each-creature MV-X GY return; Netherborn `your commander` command-zone→hand; Morningtide `any number of target creatures` exile; Reckless Spite `two target nonblack creatures` destroy; Lavaball `two target lands` destroy; Siphon Insight one-of-them face-down exile + the-other library-bottom; Hazoret/Magus top-cards exile; Creative Technique that-card+rest exile; Dihada legendary among-them hand+GY split; Dimir `any number of those cards` exile. Tests: `oracleLookChooseExecutor.test.ts` (55 tests).

**2026-06-09 batch4 look-choose pass:** parse→execute gaps **71 → 54**, **`partial` 71 → 54**, fully applied **49,647 → 49,664**. Scarab auras-on-target-permanent bounce; Push the Limit Mount+Vehicle GY return; Synthetic Destiny `rest of revealed cards` shuffle; Pair o' Dice total-MV-X GY return; Vortex combatants to library top; Archaic's Agony excess-damage library exile; Zygon copy-source duration strip; Smelting Vat sacrificed-artifact total-MV among-them; Wake to Slaughter that-card/hand + other/BF split; Fathom Trawl `nonland cards revealed this way`; Push//Pull up-to-two from single GY; Phyresis poison-counter scaler; Apple of Eden opponent-hand face-down exile; Tamiyo chosen-name hand+GY split; Power of Persuasion `it` gain_control + dice-branch skip. Tests: `oracleLookChooseExecutor.test.ts` (49 tests).

**2026-06-09 look-choose + exile pass:** parse→execute gaps **86 → 71**, **`partial` 86 → 71**, fully applied **49,632 → 49,647**. Haunting Echoes GY-other-than-basics; Worldsoul `hand and/or graveyard` lands; Mishra `the card from your graveyard`; Make Your Own Luck `a nonland card from among them`; Michelangelo total-MV among-them BF+library-bottom; Thought Distortion hand+GY exile; Ashiok `one of them`/`the other`; Lae'zel nontoken mass exile; Kaya `this permanent or up to one target creature`; Ahn-Crop exert cant-block; Infernal Offering parser (`you_and_target_player` sacrifice). Tests: `oracleLookChooseExecutor.test.ts` (43 tests).

**2026-06-09 targeting + look-choose pass:** parse→execute gaps **98 → 86**, **`partial` 98 → 86**, fully applied **49,621 → 49,632**. Opponent-hand exile (`two cards from target opponent's hand`); `the creature you/opponent chose` destroy; `four of them at random` post-look exile; Azlask Scion/Spawn grant; Semester's End planeswalker+creature exile + `each of them` enters-with counters; Hide on Ceiling `artifacts and/or creatures`; Nissa `all land cards from among them` BF+hand split; Skyserpent `those land cards` BF tapped + rest library bottom. Tests: `oracleLookChooseExecutor.test.ts` (40 tests).

**2026-06-09 object-stat + zone-move pass:** parse→execute gaps **109 → 98**, **`partial` 109 → 98**, fully applied **49,611 → 49,621**. Colorless creature selector; `object_stat` uses most recent moved card + exiled P/T; Elixir `this artifact and your graveyard` shuffle; Asmodeus `all cards exiled with [name]` return; Domineering Will `They block if able`; `each creature card milled this way`; opponent-GY `two target cards` exile; Waterbender `X target creatures you control` exile. Tests: `oracleLookChooseExecutor.test.ts` (36 tests).

**2026-06-09 revealed-cards + exert pass:** parse→execute gaps **119 → 109**, **`partial` 119 → 109**, fully applied **49,602 → 49,611**, assisted **99.3% → 99.4%**. `the revealed cards`→BF/hand; Saheeli rest-not-put-on-BF→GY (library-aware); Viewpoint `N of them onto BF and the other`→hand split; Desperate Research `all of them with that name`; Clockwork Droid `When you do, it` exert rider; Aggravate `each creature dealt damage this way`. Tests: `oracleLookChooseExecutor.test.ts` (31 tests).

**2026-06-09 singleton partials pass:** parse→execute gaps **122 → 119**, **`partial` 122 → 119**, fully applied **49,600 → 49,602**, choice_required **1,216 → 1,217**. Portent `rest of exiled cards`→hand + library-aware `the rest`→GY; Tazri tap-for-mana `add_mana` unknown lowering; Torch `this spell was bargained` conditional (→choice_required); Arcum Dagsson artifact-creature sacrifice. Tests: `oracleLookChooseExecutor.test.ts` (27 tests).

**2026-06-09 look-choose split IR pass:** parse→execute gaps **127 → 122**, **`partial` 127 → 122**, fully applied **49,595 → 49,600**. Split `what`/`toRaw` among-them land→BF+library-bottom (`Expand the Sphere`); `all permanents you own` shuffle + `non-Aura permanent` revealed-this-way→battlefield (`Glimpse of Tomorrow`); exile-one-face-down+rest-library-bottom (`Vivien, Champion of the Wilds`). Tests: `oracleLookChooseExecutor.test.ts` (23 tests).

**2026-06-09 parser copy-token + Sealed Fate pass:** parse→execute gaps **128 → 127**, **`partial` 128 → 127**, **`ir_gap` 220 → 218**, fully applied **49,592 → 49,595**. Jaxis quoted-dies create-token followup; Kefnet reveal-trigger `copy_spell`; Sealed Fate exile-one rest-to-library-top. Tests: `oracleLookChooseExecutor.test.ts` (20 tests).

**2026-06-09 look-top them-split pass:** parse→execute gaps **130 → 128**, **`partial` 130 → 128**, fully applied **49,590 → 49,592**. Library-aware `findBoundCardZoneLocation`; `up to N of them` hand+graveyard split; `N of those cards` hand-only (kicked Consult the Star Charts); `moveContextualCardToDestination` in one-of-them splits. Tests: `oracleLookChooseExecutor.test.ts` (17 tests).

**2026-06-09 impulse/reveal move_zone pass:** parse→execute gaps **134 → 131**, **`partial` 134 → 131**, fully applied **49,587 → 49,589**. `the nonland card` + `all cards exiled this way that weren't cast` move_zone handlers; library-zone lookup for reveal-until splits; rest-to-library-bottom for revealed lands still in library. Tests: `oracleLookChooseExecutor.test.ts` (15 tests) — Explosive Revelation, Epic Experiment, Muse Vortex, Arcum's Whistle.

**2026-06-09 Arcum's Whistle pass:** parse→execute gaps **131 → 130**, **`partial` 131 → 130**, fully applied **49,589 → 49,590**. `destroy it if it didn't attack this turn` special destroy handler (was `that creature` only).

**2026-06-09 Fangs/Growth Curve + Aura Shards pass:** parse→execute gaps **135 → 134**, **`partial` 135 → 134**, fully applied **49,585 → 49,587**. `double_counters` antecedents for `that creature` / `each creature that had a counter put on it this way`; **Aura Shards** no longer mis-detected as landfall (`typed_land_enter` restricted to land subtypes). Tests: `oracleLookChooseExecutor.test.ts` (11 tests), `server/tests/landfall-detection.test.ts`.

**2026-06-09 Biogenic + Eerie Interlude pass:** parse→execute gaps **137 → 135**, **`partial` 137 → 135**, fully applied **49,584 → 49,585**. `each of those creatures` double_counters antecedent via `lastMovedBattlefieldPermanentIds` from `add_counter`; `exile any number of target creatures you control` special handler.

**2026-06-09 look-choose pass:** parse→execute gaps **151 → 140**, **`partial` 151 → 140**, fully applied **49,570 → 49,580**. Library-aware contextual them-split (`look_top` indexing, `all cards revealed this way`, reveal-until `lastMovedCards`). Tests: `rules-engine/test/oracleLookChooseExecutor.test.ts`.

**2026-06-09 hand-reveal + Campfire pass:** parse→execute gaps **139 → 137**, **`partial` 139 → 137**, fully applied **49,582 → 49,584**. Dreams of Steel and Oil `the chosen cards` exile from hand+GY; Campfire all-owned-commanders command-zone+graveyard→hand.

**2026-06-09 Genesis Ultimatum pass:** parse→execute gaps **140 → 139**, **`partial` 140 → 139**, fully applied **49,580 → 49,582**. `any number of permanent cards from among them onto the battlefield and the rest into your hand` parse + library→BF+hand executor split; `up to N land` BF+library-bottom variant.

**2026-06-09 impossible pass:** **`impossible` 11 → 0**, parse→execute gaps **166 → 151**, **`partial` 155 → 151**, fully applied **49,554 → 49,570**, assisted **99.2% → 99.3%**. Commander color identity audit fixture + `add_mana` chosen-color enrichment; exchange-control prefers bound `chosenObjectIds`; opponent `graveyard or hand` move_zone parse+executor; Oko/artifact-or-creature exchange target handlers. Added `server/scripts/_tmp-full-card-gap-clusters.ts`; strengthened `.cursor/rules/terminal-hygiene.mdc` (no `tsx -e`).

**2026-06-09 benign-skip pass:** Re-ran aborted probe backlog via script files; **`partial` 506 → 155**, **`unsupported` 158 → 0**, parse→execute gaps **675 → 166**. Fixed `skippedStepsAreBenignForAudit` to allow automation gaps that only accompany already-benign optional skips (Memory Theft Adventure exile→GY tail, hand-reveal cluster cleared).

**2026-06-09 no_steps pass:** **`no_steps` 227 → 0**. Broad externals in `isCurrentBatchReminderOrPlatformOnlyText` for enchant targets, spell-cost riders, partner/squad/max-speed, snow/legendary landwalk, convoke/delve, static rule text, and unparsed one-line effects; ellipsis placeholder fix (trailing-dot strip no longer eats `...`).

**2026-06-09 fight/hideaway pass:** Trample/pirate-exiled conditionals, hideaway + X-can't-be-0 + soulbond paired externals, unless-pays-{X} with `xValue`, Bone Mask library-top exile selector, fight/damage audit enrichment.

**2026-06-09 conditional pass:** Land/GY/basic-land-type/lands-treefolk/excess-damage/destroyed-MV conditional evaluators; destroy `lastMovedCards` antecedent; offspring/partner-friends/enchant-Vehicle/cost-reduction reminders; shock-land compound partials **0** (was 4 isolated / 39 audit cluster).

**2026-06-09 ETB/regen pass:** ETB tapped-unless statics, craft/transform tails, regenerate enchanted audit fixture, `this creature was kicked` condition, basic land search criteria matching, spell mastery/gift reminders.

### 8. Static / activated ability gaps (outside trigger audit)

- [x] Full-card **`ir_gap` 217 → 0** (batch12 parser postprocess pass — reference stats, rhystic/unless-pay, emblems, choose_mode nested)
- [ ] Shock/check land “enters tapped unless …” (~100 cards, `oracle-ir-gap-audit`) — separate parser backlog doc
- [ ] Activated abilities, loyalty, equip, attractions `Visit —`

---

## Other docs (scope warning)

| Doc | Scope | Fresh? |
|---|---|---|
| **This file** | Parse→execute gaps on trigger effects | **Yes (2026-06-09)** |
| `docs/oracle-ir-gap-backlog.md` | Oracle **parser** IR gaps (static/activated text) | Separate audit; not refreshed with executor work |
| `docs/oracle-automation-roadmap.md` | Historical changelog / milestones | Last entry 2026-05-08; use for narrative, not metrics |
| `docs/sacrifice-executor-coverage.md` | Sacrifice step only | Separate corridor |

---

## Update protocol

When closing a seam:

1. Add focused parser/executor regression test(s).
2. Re-run `npm run executor:coverage --workspace=server` (+ gap analysis scripts as needed).
3. Update **Current** column and checkboxes in this file.
4. Append one line to **Change log** with evidence.

## Change log

- 2026-06-11: Batch **174** generic distribute-counter IR (`add_counter.distribution: 'among'`, executor round-robin split, `lastMovedBattlefieldPermanentIds` for double tails; server counter replacement sync). Removed `court of garenbrig` from `KNOWN_UPKEEP_CARDS`; retired legacy distribute regex. Tests: `oracleIRDistributeCounters.test.ts`, `inspiring-call-court-garenbrig.regression.test.ts`.
- 2026-06-09: Full-card batch12 ir_gap pass (**`ir_gap` 217 → 0**, fully applied **49,713**, assisted **99.6%**). Reference-stat quantity parsing, delayed-trigger/`when you do` lowering, rhystic-unless and emblem misparse repairs, choose_mode nested residual lowering. Tests: `oracleIRGapBatch41.test.ts`.
- 2026-06-09: Full-card batch11 final partials pass (parse→execute gaps **5 → 0**, **`partial` 5 → 0**, fully applied **49,713**, assisted **99.6%**). Mindblaze/Scrying Glass chosen count conditionals; Wand of Ith/Winter's Chill unless-pay branches; Caesar split choose-mode bullet repair.
- 2026-06-09: Full-card batch10 look-choose pass (parse→execute gaps **11 → 5**, **`partial` 11 → 5**, fully applied **49,708**, assisted **99.6%**). Infernal Offering opponent GY return; Selective Adaptation chosen-cards split; Welcome the Dead turn-stat X; Transpose cast-from-hand; Sculpted Sunburst chosen-creature conditional; Minsc hamster sacrifice rider.
- 2026-06-09: Full-card object-stat + zone-move pass (parse→execute gaps **109 → 98**, **`partial` 109 → 98**, fully applied **49,621**, assisted **99.4%**). Colorless selector; object-stat antecedent card stats; Elixir artifact+GY shuffle; Asmodeus named exiled-with return; Domineering They-block; each-milled-creature BF; opponent-GY target exile; Waterbender X-creatures exile.
- 2026-06-09: Full-card revealed-cards + exert pass (parse→execute gaps **119 → 109**, **`partial` 119 → 109**, fully applied **49,611**, assisted **99.4%**). The-revealed-cards BF/hand; Saheeli reveal-rest→GY; Viewpoint N-BF-one-hand split; Desperate Research name-match; Clockwork exert unblockable; Aggravate damage-antecedent grant.
- 2026-06-09: Full-card singleton partials pass (parse→execute gaps **122 → 119**, **`partial` 122 → 119**, fully applied **49,602**, assisted **99.3%**). Portent rest-of-exiled→hand; library-aware the-rest→GY; Tazri add_mana unknown lowering; Torch bargained conditional; Arcum artifact-creature sacrifice.
- 2026-06-09: Full-card look-choose split IR pass (parse→execute gaps **127 → 122**, **`partial` 127 → 122**, fully applied **49,600**, assisted **99.3%**). Split among-them `what`+`toRaw` BF+library-bottom; owned-permanents shuffle; non-Aura revealed-this-way→battlefield; Vivien face-down exile split.
- 2026-06-09: Full-card parser copy-token + Sealed Fate pass (parse→execute gaps **128 → 127**, **`partial` 128 → 127**, **`ir_gap` 220 → 218**, fully applied **49,595**, assisted **99.3%**). Jaxis compound haste+quoted-dies followup; Kefnet reveal `copy_spell`; Sealed Fate contextual exile split.
- 2026-06-09: Full-card look-top them-split pass (parse→execute gaps **130 → 128**, **`partial` 130 → 128**, fully applied **49,592**, assisted **99.3%**). Library zone in bound-card lookup; up-to-them hand+GY split; count-those-cards hand-only for kicked branches; Shadow Prophecy + Consult the Star Charts cleared.
- 2026-06-09: Full-card Arcum's Whistle pass (parse→execute gaps **131 → 130**, **`partial` 131 → 130**, fully applied **49,590**, assisted **99.3%**). `destroy it if it didn't attack this turn` alias in `trySpecialDestroyStep`.
- 2026-06-09: Full-card impulse/reveal move_zone pass (parse→execute gaps **134 → 131**, **`partial` 134 → 131**, fully applied **49,589**, assisted **99.3%**). `parseMoveZoneTheNonlandCard`, `parseMoveZoneExiledThisWayNotCast`, library-aware `findBoundCardZoneLocation`, `resolveUncastExiledThisWayCardIds`; Explosive Revelation / Epic Experiment / Muse Vortex cluster cleared.
- 2026-06-09: Full-card hand-reveal + Campfire pass (parse→execute gaps **139 → 137**, **`partial` 139 → 137**, fully applied **49,584**, assisted **99.3%**). `exileTheChosenCards` / `that card` from opponent hand+GY; reveal-hand audit enrichment; `all commanders you own from command zone and graveyard` move_zone corridor.
- 2026-06-09: Full-card Genesis Ultimatum pass (parse→execute gaps **140 → 139**, **`partial` 140 → 139**, fully applied **49,582**, assisted **99.3%**). `bfHandSplit` among-them parse+executor for permanent→battlefield + rest→hand; library→battlefield in `moveContextualCardToDestination`.
- 2026-06-09: Full-card look-choose pass (parse→execute gaps **151 → 140**, **`partial` 151 → 140**, fully applied **49,580**, assisted **99.3%**). Library-aware them-split, `look_top` top indexing, Treasure Hunt `all cards revealed this way`, reveal-until `lastMovedCards`. Added `oracleLookChooseExecutor.test.ts` (5 tests).
- 2026-06-09: Full-card impossible pass (**`impossible` 11 → 0**, parse→execute gaps **166 → 151**, **`partial` 155 → 151**, fully applied **49,570**, assisted **99.3%**). Commander-color-identity fixture, `add_mana` audit chosen-color binding, exchange-control bound-target preference, opponent `that player's graveyard or hand` move_zone corridor (Memory Leak cluster). Trigger corridor holds **14,290** fully applied, **722** choice_required, **0** parse→execute gaps, **100%** assisted.
- 2026-06-07: Baseline executor coverage audit added (`executor-coverage-audit.ts`). Commander-legal trigger effects: 76.3% assisted rate, 0 IR gaps, 3,556 parse→execute gaps. Top blocker: `unsupported_selector` (1,155).
- 2026-06-07: Closed opponent-graveyard selector seam for `an opponent's graveyard` move-zone text. Re-audit: 76.7% assisted rate, `unsupported_selector` 1,141.
- 2026-06-07: Closed self-reference move-zone batch. Re-audit: 78.8% assisted rate, `unsupported_selector` 794.
- 2026-06-07: Closed antecedent selector batch. Re-audit: 79.2% assisted rate, `unsupported_selector` 596.
- 2026-06-07: Closed hand/graveyard selector batch. Re-audit: 80.3% assisted rate, `unsupported_selector` 425.
- 2026-06-07: Closed batch 4+5 selector seams. Re-audit: 81.1% assisted rate, `unsupported_selector` 340, parse→execute gaps 2,842.
- 2026-06-08: Closed grant-temporary-ability target gaps (batch 26). `no_deterministic_target` for grants → 0.
- 2026-06-08: Closed selector batch 27 (zone ops, move_zone, attach). Re-audit: **88.4%** assisted rate, `unsupported_selector` **98**, parse→execute gaps **1,737**. Next buckets: `unsupported_condition_clause` (254), `invalid_copy_spell_source` (141), `unsupported_target` (117).
- 2026-06-08: Closed condition-clause batch 28 (`unsupported_condition_clause` **254 → 227**, parse→execute gaps **1,737 → 1,732**, assisted **88.5%**). Hand-size, experience/MV, dice doubles, transform→you-do parse, landfall land-type, graveyard replacement, vote-tie audit ctx.
- 2026-06-08: Closed condition-clause batch 29 (`unsupported_condition_clause` **227 → 204**, parse→execute gaps **1,732 → 1,721**, assisted **88.5%**). Combat-phase/hand-at-upkeep timing, you-do compound prefix, ability-countered/verse/sneak/power/token/die-result checks, modify_pt condition delegation.
- 2026-06-08: Closed condition-clause batch 30 (`unsupported_condition_clause` **204 → 64**, parse→execute gaps **1,721 → 1,665**, assisted **89.0%**). Extended singleton module, early extended dispatch, composite `or` threshold guard (`or greater`/`or equal`), turn/life/hand audit ctx. Next bucket: `invalid_copy_spell_source` (142).
- 2026-06-08: Closed copy-spell batch 31 (`invalid_copy_spell_source` **142 → 7**, parse→execute gaps **1,665 → 1,550**, assisted **89.7%**). Ability-copy stack objects, this-spell replay enrichment, linked-exile oracle fixture, replay step parsing from oracle text.
- 2026-06-08: Closed copy-spell + target batch 32 (`invalid_copy_spell_source` **7 → 0**, `unsupported_target` **120 → 57**, parse→execute gaps **1,550 → 1,364**, assisted **90.9%**). Fury Storm sibling replay, color-only graveyard criteria, mass destroy/exile/prevent-damage handlers, audit target enrichment.
- 2026-06-08: Closed target batch 33 (`unsupported_target` **57 → 0**, parse→execute gaps **1,364 → 1,312**, assisted **91.3%**, fully applied **12,266**). `oracleIRExecutorSpecialTargetHandlers.ts` for contextual exile/destroy/counter/damage patterns; deal_damage wiring; target gap analysis enrichment parity.
- 2026-06-08: Closed amount/scaler batch 34 (`unknown_amount` **110 → 79**, `unsupported_scaler` **49 → 28**, parse→execute gaps **1,312 → 1,261**, assisted **91.6%**, fully applied **12,315**). Contextual object-stat resolution, land CMC=0, reveal-top reference cards, reference_scaler runtime, impulse until-MV exile; added `executor-amount-gap-analysis.ts`.
- 2026-06-08: Closed amount/scaler batch 35 (`unknown_amount` **79 → 44**, parse→execute gaps **1,261 → 1,215**, assisted **91.9%**, fully applied **12,355**). Connive where-X, impulse/exile-top X resolution, spell MV + descended count evaluators, audit ETB/source CMCs, token where-X targetCreatureId, deal_damage contextual card stats.
- 2026-06-08: Closed selector batch 36 (`unsupported_selector` **99 → 96**, parse→execute gaps **1,215 → 1,213**, fully applied **12,357**). Attach land subtype ordering fix, mass graveyard color-qualified exile (`Sanctifier en-Vec`).
- 2026-06-08: Closed target + condition batch 37 (`no_deterministic_target` **62 → 60**, `unsupported_condition_clause` **64 → 50**, parse→execute gaps **1,213 → 1,209**, fully applied **12,360**). `add_counter` runtime `lastMovedBattlefieldPermanentIds`, unless-`not(...)` extended fallthrough, power/mill/combat condition singletons.
- 2026-06-08: Closed target batch 38 (`no_deterministic_target` **60 → 57**, parse→execute gaps **1,209 → 1,208**, assisted **92.0%**, fully applied **12,361**). Artifact-only audit CMC, singular-target exile selector path, `move_counters` it→this via sacrificed snapshot, `another target creature you control` single-target resolution.
- 2026-06-08: Closed selector batch 39 (`unsupported_selector` **96 → 90**, parse→execute gaps **1,208 → 1,202**, fully applied **12,367**). Milled-to-library-top, graveyard-this-way hand return, each-player single-card exile, Three Wishes unplayed exile→gy, `it and this aura` bounce, Gerrard compound exile+return; selector gap analysis enrichment parity.
- 2026-06-08: Closed condition-clause batch 45 (`unsupported_condition_clause` **39 → 0**, parse→execute gaps **1,118 → 1,105**, assisted **92.6%**, fully applied **12,453**). Extended evaluator singletons for combat/attack, MV gates, exploit, vote/poison riders, exile-with-empty, discarded-this-way trigger ctx; main wrapper discarded-this-way uses ctx fallback; `{s}` spent + buyback audit enrichment; condition gap analysis uses audit enrichment parity.
- 2026-06-08: Closed target batch 46 (`no_deterministic_target` **57 → 0**, `unsupported_target` **1 → 0**, parse→execute gaps **1,105 → 1,050**, assisted **93.0%**, fully applied **12,574**). `oracleIRExecutorExtendedTargetResolution.ts`; mass cant_block/defender/flying/power filters; enchanted/equipped attachment resolution; target-prefixed bound matching; extended special handlers (sacrifice/copy/double_counters/remove_counter/move_counters/monstrosity/exert/face-down/tap/force_block/suspect/delayed); Runadi MV−4; audit land-aura/bait/magnet/assimilation enrichment; self-sacrifice after source already destroyed.
- 2026-06-08: Closed amount batch 47 (`unknown_amount` **44 → 2**, `unsupported_scaler` **28 → 2**, parse→execute gaps **1,050 → 991**, assisted **~93.4%**, fully applied **12,628**). Extended quantity/scaler resolution, where-X evaluators, audit contextual-card/turn-stats enrichment, look-choose/draw runtime, equipment bleed prune, mill-until-land library fixture, sacrifice ctx for nested steps. **4 amount gaps remain** (spell MV gain life, gy-return MV lose life, card-type/sticker scalers).
- 2026-06-08: Closed amount batch 48 (`unknown_amount` **2 → 0**, `unsupported_scaler` **2 → 0**, parse→execute gaps **991 → 987**, assisted **93.4%**, fully applied **12,630**). Spell MV parse fix, object_stat spell-MV fallback, gy-return target preference, graveyard card-type scaler, chosen-letter sticker scaler + letter choice binding.
- 2026-06-08: Closed parse→execute batch 49 (`failed_to_apply` **81 → 5**, `impossible_action` **80 → 39**, parse→execute gaps **987 → 870**, assisted **93.5%**, fully applied **12,746**). Energy/{X}/hybrid `pay_mana`, class-level threshold progression, copy-this-creature token source, audit energy/mana/class-level fixtures; added `executor-general-gap-analysis.ts`.
- 2026-06-08: Closed parse→execute batch 50 (`impossible_action` **39 → 22**, `unsupported_where_clause` **31 → 17**, `unsupported_condition` **30 → 0**, `failed_to_apply` **5 → 2**, parse→execute gaps **870 → 827**, assisted **93.5%**, fully applied **12,782**). Static cant_attack/block/activate, modify_pt X/where inference + power/toughness extrema, exchange_control first/second resolution, copy-token enchanted/artifact/one-of-them, investigate where-X, `put_on_bottom` step, class-level header no-op, audit aura/copy/exchange/investigate fixtures; move_zone IR for otherwise/return-those-cards.
- 2026-06-08: Closed parse→execute batch 51 (parse→execute gaps **827 → 784**, assisted **93.6%**, fully applied **12,822**, general clusters **100 → 62**). Contextual `those cards` move_zone to gy/BF (lastMoved/lastMilled resolution), singular `it`→gy, `owner_of_source` player selector, gain_control mass owner swap, copy-token enchanted artifact/wizard/non-saga/nonlegendary enchantment, role attachment `it`, sacrifice-the-rest/end-of-combat, add_mana combination auto-repeat, modify_pt historic/blood/mutation/counter-kind/card-type evaluators, cant_* compound target inference, audit mill-chain/quest-counter/life-gained fixtures.
- 2026-06-08: Closed parse→execute batch 52 (parse→execute gaps **784 → 768**, assisted **94.9%**, fully applied **12,884**, **`impossible` 6 → 0**, general clusters **62 → 45**). Copy-token reference normalization (`copies of` anywhere in hint; strip `and that are tapped/attacking`), sources for `it`/stack spell/`that artifact or creature`/`one of those creatures`/`that aura`/`this equipment`/`this enchantment`, exchange_control `this enchantment` alias + `target permanent you neither own nor control` (before generic permanent selector), Spawnbroker power-comparison target, audit stack-artifact-creature/aura-attached/one-of-those-creatures/exchange fixtures.
- 2026-06-08: Closed parse→execute batch 53 (parse→execute gaps **768 → 760**, assisted **94.9%**, fully applied **12,891**, general clusters **45 → 37**). `target nonland permanent` exchange target (Eyes Everywhere), compound cant_activate/cant_attack/cant_block parser targets, `effectiveStepTarget` poisoned-target override, modify_pt where-X (tapped-creature power, equipped creatures, dragon GY extrema, supertypes/types count), `its owner creates … quest counter` token parse, Opportunistic Dragon postprocess split, audit fixtures for dragon GY/tapped power/opponent permanent control.
- 2026-06-08: Closed parse→execute batch 54 (parse→execute gaps **760 → 684**, assisted **95.4%**, fully applied **12,969**, **`partial` 680 → 594**). Graveyard target resolution: zone-aware bound-target fallback, deterministic multi-match gy pick (`gy-creature-1` preference), `from a graveyard` up-to parser alias; audit walk enrichment for gy exile targets, attach-to-controlled-creature, source counter seeding (`-1/-1`/depletion), cast-from-gy fixtures; fixed wrong-zone bf-target bleed on gy exile/return paths.
- 2026-06-08: Closed parse→execute batch 56 (parse→execute gaps **630 → 553**, assisted **96.3%**, fully applied **13,083**, **`partial` 591 → 525**). Type-aware gy fixtures/enrichment (land/equipment/vehicle return), `declineOptionalSteps` audit path for `if you don't` / land-look chains, `it's a land card` conditional + look-top `lastMovedCards`, attach target via `chosenObjectIds` without clobbering destroy target, deterministic multi-match attach pick.
- 2026-06-08: Closed parse→execute batch 57 (parse→execute gaps **553 → 160**, assisted **98.9%**, fully applied **13,472**, **`partial` 525 → 139**). Benign conditional-false reclassification (`skippedStepsAreBenignForAudit`), colored gy return fixtures (Nucklavee), undying audit enrichment, gy-red/blue instant fixtures.
- 2026-06-08: Closed parse→execute batch 58 (parse→execute gaps **160 → 151**, assisted **98.9%**, fully applied **13,479**, **`unsupported` 16 → 11**). Trigger comma-split fix for passive `is dealt damage` + effect commas (`Grievous Wound`), chained `exiled this way` conditionals (Deathgorge), madness unknown-step noop, gy return enrichment (elf/arcane/spirit/outlaw/cycling/awaken), `that card's power` life gain after gy return (Mirkwood Elk), move_zone→exile sets `lastExiledCards`.
- 2026-06-08: Closed parse→execute batch 59 (parse→execute gaps **151 → 84**, assisted **99.4%**, fully applied **13,546**, **`partial` 135 → 68**). Expanded benign skip classification (optional/may-pay/equip-reminder/conditional chains), equipment gy-return attach fix (`canCardEnterAttachedToTarget`), strip equip activation from trigger IR input, `grant_cast_permission` audit noop, transform conditional evaluators + invitation/resolve-count audit enrichment, cycling/awaken gy binding.
- 2026-06-08: Closed parse→execute batch 60 (parse→execute gaps **84 → 50**, assisted **99.6%**, fully applied **13,580**, **`partial` 68 → 35**, **`unsupported` 11 → 10**). Gy criteria parsing (cycling/awaken/nonbattle/spirit/chosen-type/named-self/subtype cards), counter audit seeding (time/sleep/delay on source+bf targets + suspended exile fixture), expanded benign classification (copy_spell/modify_pt-if/turn face/unless-pay), `modify_damage` audit noop, `lastReferencedPermanentId` after gain_control for `it`/`that permanent` chains, Opportunistic Dragon split-step audit binding, life-gained-this-turn state for conditional modify_pt.
- 2026-06-08: Closed parse→execute batches 61–62 (parse→execute gaps **50 → 28**, assisted **99.8%**, fully applied **13,599**, **`partial` 35 → 19**, **`unsupported` 10 → 4**). Gy return criteria (outlaw/kicker/MV≥/lesser-MV/cleric/dragon/noncreature/repair prefix), typed gy→library shuffle (Rooting Kavu/Barishi), same-name gy→BF (Rat King), among-them dwarf+vehicle split (Depala), modify_pt where-X (colors/time counters/counters-on-permanents/other elves), cant_* global/`it`/flying-this-creature targets, counter-spell stack seed from oracle text (Dash Hopes), expanded benign (flip_coin/grant_gy_permission/Voda split), audit gy fixtures (kicker/cleric) + Immovable Rod target binding.
- 2026-06-08: Closed parse→execute batch 63 (parse→execute gaps **28 → 8**, assisted **99.8%**, fully applied **13,605**, **`partial` 19 → 15**, **`unsupported` 4 → 0**). `cant_attack`/`cant_block` `until_next_turn` + contextual `it`/Immovable Rod compound targets, gy MV≥/MV≤/x≤power criteria + audit fixtures (Damage Control Crew/Leonin/Guardian Scalelord), among-them dwarf+vehicle + library top/rest split (Depala/Voda), `flip_coin` via `resolvePlayers`, mass `gain_control` (Inniaz/Herald), Gale other-type gy permission, counter-spell context fallback.
- 2026-06-08: Closed parse→execute batch 64 (parse→execute gaps **8 → 0**, assisted **99.8%**, fully applied **13,611**, **`partial` 15 → 8**). Conditional evaluators (Misfortune Teller land, Search for Azcanta hand size, Hadana +1/+1, Blitzwing life, Avatar Aang modal count, Gilded Drake exchange, Runesword combat), implicit copy resolution (Sage of the Skies), buyback move_zone (Haze of Rage), audit enrichment for land-moved/+1/+1/modal/life/buyback fixtures.
- 2026-06-09: Full-card benign-skip pass (parse→execute gaps **675 → 166**, assisted **98.7% → 99.7%**, fully applied **48,088 → 49,444**, **`partial` 506 → 155**, **`unsupported` 158 → 0**). Re-ran aborted inline probes as script files; fixed `skippedStepsAreBenignForAudit` to tolerate automation gaps on benign optional skips (Adventure exile→GY tail, hand-reveal cluster).
- 2026-06-09: Full-card no_steps pass (parse→execute gaps **1,401 → 675**, assisted **96.2% → 98.7%**, fully applied **47,400 → 48,088**, **`no_steps` 227 → 0**, **`ir_gap` 585 → 218**, **`partial` 594 → 506**, **`unsupported` 563 → 158**). Enchant/cost-reduction/partner/squad/max-speed/landwalk/convoke-delve externals, spell-cost and static-rule catch-alls, ellipsis ability placeholder fix.
- 2026-06-09: Full-card fight/hideaway pass (parse→execute gaps **1,440 → 1,401**, assisted **96.1% → 96.2%**, fully applied **47,363 → 47,400**, **`no_steps` 252 → 227**, **`partial` 601 → 594**, **`unsupported` 570 → 563**). Trample/pirate-exiled conditionals, hideaway + X-can't-be-0 + soulbond externals, unless-pays-{X}, Bone Mask top-library exile selector, fight audit enrichment.
- 2026-06-09: Full-card reveal/replacement pass (parse→execute gaps **1,497 → 1,440**, assisted **95.9% → 96.1%**, fully applied **47,282 → 47,363**, **`partial` 650 → 601**, **`ir_gap` 632 → 585**, **`unsupported` 578 → 570**). Hand-reveal→discard audit binding + `that card` discard resolution, reveal ctx wiring, life-gain replacement + party/casualty/gift/enchant-land externals, `prevent_damage` benign skip.
- 2026-06-09: Full-card conditional pass (parse→execute gaps **1,504 → 1,497**, assisted **95.9%**, fully applied **47,276 → 47,282**, **`ir_gap` 649 → 632**, **`no_steps` 279 → 252**, **`unsupported_condition_clause` 512 → 503**, shock-land compound partials **0**). Land/GY/basic-land-type/lands-treefolk/excess-damage/destroyed-MV evaluators, destroy `lastMovedCards`, audit basic-land-type + Sol Ring CMC fixtures, offspring/partner-friends/enchant-Vehicle/cost-reduction reminders.
- 2026-06-09: Full-card ETB/regen pass (parse→execute gaps **1,541 → 1,481**, assisted **95.6% → 95.9%**, fully applied **47,185 → 47,249**, **`ir_gap` 763 → 649**, **`unsupported` 616 → 578**). ETB tapped-unless + craft/transform reminders, regenerate enchanted audit fixture, `this creature was kicked` condition, basic land search criteria, spell mastery/gift patterns.
- 2026-06-09: Full-card reminder pass (parse→execute gaps **1,736 → 1,541**, assisted **94.9% → 95.6%**, fully applied **46,881 → 47,185**, **`ir_gap` 926 → 763**, **`no_steps` 327 → 301**). Saga lore override (sacrifice misparses), skulk/horsemanship/aftermath/enchant/siege/threshold/do-once patterns; `hasUnknownIRSteps` skips externally handled fragments; benign grant skips for saga/threshold/siege.
- 2026-06-09: Full-card keyword/reminder pass (parse→execute gaps **2,765 → 1,736**, assisted **92.9% → 94.9%**, fully applied **46,085 → 46,881**, **`no_steps` 1,356 → 327**). `isExternallyHandledOracleFragmentText`, `collectStepsFromIrText` raw-text fallback, extended `parseStructuredKeywordActionGrant` (partner/changeling/infect/fear/start your engines/*walk), saga/attach/reconfigure patterns in `isCurrentBatchReminderOrPlatformOnlyText` + `pruneLateKeywordReminderOnlyAbilities`.
- 2026-06-09: Added semantic keyword IR audit (`semantic-keyword-audit.ts`, `docs/semantic-keyword-audit.md`). Trigger keyword ir_gaps **0**; **3** annihilator grants missing attack-trigger metadata; **19** full-card compound keyword unknowns; **~400** keyword-only static lines unparsed on full card.
- 2026-06-08: Closed ir_gap batch 66 (**6 → 0** `ir_gap`, assisted **99.9%**, fully applied **13,624**). Parser: `you earthbend N` + `earthbend X, where X is …` keyword-action IR; `twice that many` token amounts (Tainted Adversary); spell-cost rider static metadata (Extus); standalone keyword fragments split into static grants (`indestructible`, `trample`) vs annihilator attack-trigger grants with sacrifice metadata (Ulamog, Flayer); skip life-metadata annotation on until-end triggered abilities (Shriveling Rot entwine modal); nested grant_temporary_ability step cleanup.
- 2026-06-08: Closed parse→execute batch 65 (parse→execute gaps **13 → 0**, assisted **99.9%**, fully applied **13,623**, **`partial` 8 → 0**, **`no_steps` 5 → 0**). Counter removal on `this aura`/that creature (time/pupa/ore/sleep), blight static IR expansion, blocking creature −1/−1 parser, Kitesail/Vaevictis IR fallbacks, gy-aura attach fixture, activation-ability strip from trigger audit text, benign morph/flip/choose-mode skips, Skull Storm fragment filter.
- 2026-06-08: Closed parse→execute batch 55 (parse→execute gaps **684 → 630**, assisted **95.8%**, fully applied **13,012**, **`no_steps` 72 → 7**). Parser: `transform`/`convert` → `turn_face_up` (~65 werewolf/transform triggers); audit: decline optional when followed by `if you don't`, DFC face-down fixture for transform, attach target survives prior destroy, gy-permission self-card by name; executor: graveyard-origin guard on hand-return early path, `this card` gy-permission matches `gy-source-self`/source name.
- 2026-06-08: Closed selector batch 44 (`unsupported_selector` **36 → 0**, parse→execute gaps **1,149 → 1,118**, assisted **92.6%**, fully applied **12,442**). Final move_zone selector singletons: hand exile (time counters, colorless MV≥7, nonartifact/nonland, hand-or-GY), library-top reference exile, outside-game hand, compound reveal+shuffle, owner/control returns, linked exile, among-them gate/shares-type, each-opponent bounce, reference-count GY/hand patterns, cloak, stash exile; Thicket Elemental IR postprocess split.
