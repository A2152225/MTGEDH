# Oracle Automation — Remaining Work

Living document. Update this file as gaps close and audits are re-run.

**Last updated: 2026-06-08** (parse→execute batch 54 — **684 gaps**)

## Quick start for a new session

1. Read this file for current metrics and priority order.
2. Re-run audits if code changed since the timestamp above:
   ```powershell
   cd server
   npm run executor:coverage
   npx tsx scripts/executor-selector-gap-analysis.ts
   npx tsx scripts/executor-target-gap-analysis.ts
   npx tsx scripts/executor-condition-gap-analysis.ts
   ```
3. JSON reports land in `server/scripts/out/` (**gitignored** — regenerate locally; do not expect them in git).
4. Trigger parse coverage (separate from executor): `npm run trigger:coverage`

---

## Audit baseline (executor coverage)

Source: `npm run executor:coverage --workspace=server`  
Report: `server/scripts/out/executor-coverage-audit.json`  
Scope: commander-legal **triggered-ability effects**, assisted fixture (pre-bound targets, `allowOptional=true`, auto first `choose_mode`)

| Metric | Baseline (2026-06-07) | Current (2026-06-08) |
|---:|---:|---:|
| Cards scanned | 29,614 | 29,614 |
| Trigger effects dry-run | 15,014 | 15,014 |
| IR gaps (`ir_gap`) | **0** | **0** |
| Fully applied | 10,502 (70.0%) → 11,050 (73.6%) | **12,969 (86.4%)** |
| Choice required (expected UI) | 956 (6.4%) → 1,122 (7.5%) | **1,376 (9.2%)** |
| Assisted execution rate | **76.3%** → **81.1%** | **95.4%** |
| Parse→execute gaps | 3,556 → 2,842 items | **684 items** |

### Status breakdown (current)

| Status | Count |
|---|---:|
| `fully_applied` | 12,969 |
| `choice_required` | 1,376 |
| `partial` | 594 |
| `unsupported` | 18 |
| `no_steps` | 72 |
| `impossible` | 0 |
| `ir_gap` | 0 |

### Top skip reason codes (current)

| Rank | Reason code | Baseline → Current |
|---:|---|---:|
| 1 | `player_choice_required` | 1,082 → **1,520** (expected UI; not a parse bug) |
| 2 | `failed_to_apply` | 99 → **2** |
| 3 | `impossible_action` | 72 → **0** |
| 4 | `unsupported_destination` | — → **5** |
| 5 | `unsupported_where_clause` | — → **8** |

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
| Target | `server/scripts/out/executor-target-gap-analysis.json` | **58** (57 `no_deterministic_target` + 1 `unsupported_target`) | 58 |
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

**Next focus:** parse→execute gaps (~684) — **`partial` (594)** silent skips (conditional branches, attach after gy-return, grant_graveyard_permission), **`no_steps` (72)**, **`unsupported` (18)** general clusters (madness `when you do`, gain_control player selectors, modify_damage, opponent-gy exile).

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

- [ ] Win effect cards (Laboratory Maniac, Thassa's Oracle)
- [ ] Copy zone movement SBA (704.5e)
- [ ] Same-controller trigger ordering UI (`ORDER_TRIGGERS`)
- [ ] Replacement-effect choice (`CHOOSE_REPLACEMENT`)

### 7. Full-card executor audit (not yet baselined)

- [ ] Run `EXECUTOR_COVERAGE_SCOPE=full_card` and add second baseline section

### 8. Static / activated ability gaps (outside trigger audit)

- [ ] Shock/check land “enters tapped unless …” (~100 cards, `oracle-ir-gap-audit`)
- [ ] Activated abilities, loyalty, equip, attractions `Visit —`

---

## Other docs (scope warning)

| Doc | Scope | Fresh? |
|---|---|---|
| **This file** | Parse→execute gaps on trigger effects | **Yes (2026-06-08)** |
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
- 2026-06-08: Closed selector batch 44 (`unsupported_selector` **36 → 0**, parse→execute gaps **1,149 → 1,118**, assisted **92.6%**, fully applied **12,442**). Final move_zone selector singletons: hand exile (time counters, colorless MV≥7, nonartifact/nonland, hand-or-GY), library-top reference exile, outside-game hand, compound reveal+shuffle, owner/control returns, linked exile, among-them gate/shares-type, each-opponent bounce, reference-count GY/hand patterns, cloak, stash exile; Thicket Elemental IR postprocess split.
