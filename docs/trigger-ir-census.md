# Trigger IR census (TRIGGER_PRIMARY coverage)

Generated 2026-11-16T11:54:49.607Z by `npm run census:triggers` (server/scripts/trigger-ir-census.ts).

A clause counts as IR when `parseTriggerClause` returns a condition and an effect.
A delayed or reflexive rider counts as that effect when the main clause text is empty.
Otherwise it falls back to the legacy family detectors. Unique Commander-legal oracle cards; each face scanned.

| Metric | Count |
|---|---|
| Commander-legal cards with trigger clauses | 12533 |
| Trigger clauses | 14359 |
| Parsed by trigger IR | 14359 (100.0%) |
| Legacy fallback | 0 (0.0%) |
| Reflexive/delayed riders excluded ("when you do", "next end step") | 350 |

## Top 30 legacy-fallback wordings (by cards affected)

| # | Trigger condition | Cards | Clauses | Examples |
|---|---|---|---|---|

## Before/after

| Round | Parsed by IR | Coverage | Legacy fallback |
|---|---|---|---|
| After round 8 | 12387 / 14016 | 88.4% | 1629 |
| After round 9 | 12445 / 14016 | 88.8% | 1571 |
| After round 10 | 12498 / 14016 | 89.2% | 1518 |
| After round 11 | 12542 / 14016 | 89.5% | 1474 |
| After round 12 | 12602 / 14016 | 89.9% | 1414 |
| After round 13 | 12658 / 14016 | 90.3% | 1358 |
| After round 14 | 12727 / 14016 | 90.8% | 1289 |
| After round 15 | 12810 / 14016 | 91.4% | 1206 |
| After round 16 | 13007 / 14016 | 92.8% | 1009 |
| After round 17 | 13016 / 14016 | 92.9% | 1000 |
| After round 20 | 13021 / 14016 | 92.9% | 995 |
| After round 21 | 13023 / 14016 | 92.9% | 993 |
| After round 22 | 13023 / 14016 | 92.9% | 993 |
| After round 23 | 13023 / 14016 | 92.9% | 993 |
| After round 24 | 13023 / 14016 | 92.9% | 993 |
| After round 25 | 13023 / 14016 | 92.9% | 993 |
| After round 27 (census rerun 2026-10-25) | 13023 / 14016 | 92.9% | 993 |
| After round 28 (census rerun 2026-10-25; runtime-only fixes, parser unchanged) | 13023 / 14016 | 92.9% | 993 |
| After round 66 (census rerun 2026-11-16) | 14328 / 14359 | 99.8% | 31 |
| After round 66 (room, power-up, phylactery, artifact tap) | 14333 / 14359 | 99.8% | 26 |
| After round 66 (doom counters, teamwork, tenuous truce) | 14336 / 14359 | 99.8% | 23 |
| After round 66 (toughness damage, mentor, scry to bottom) | 14339 / 14359 | 99.9% | 20 |
| After round 66 (chosen draw, spell damage to self, no contract) | 14342 / 14359 | 99.9% | 17 |
| After round 67 (last 17: thresholds, links, caused abilities) | 14359 / 14359 | 100.0% | 0 |

### Runtime buckets (round 17 audit)

"Parsed by IR" above includes wordings marked `legacyRuntimeOnly` (the IR matcher skips them). Each such clause and each unparsed clause was run through the 49 legacy `detect*Triggers` with its real card; it counts as legacy-verified only when a detector returns the entry AND the queueing getter accepts that triggerType (pass-through getter, explicit consumer/allowlist, or a behavioural death-trigger fire). IR runtime assumes the IR emitter for the event exists (not re-tested per clause).

| Round | IR runtime | Legacy runtime verified | Parsed, no runtime | Unparsed, legacy verified | Unparsed, no runtime |
|---|---|---|---|---|---|
| After round 16 | 12682 | 183 | 142 | 537 | 472 |
| After round 17 | 12715 | 180 | 121 | 533 | 467 |
| After round 18 (delta) | 12715 | 208 | 93 | 538 | 462 |
| After round 19 (delta, estimated) | 12716 | 220 | 81 | 538 | 461 |
| After round 20 (full rerun, 3 buckets) | 12720 | 301 (verified / no-runtime split not re-audited) | | 995 (legacy verified / no-runtime split not re-audited) | |
| After round 21 (full rerun, per-family re-split, detector-only) | 12720 | 262 | 41 | 697 | 296 |
| After round 22 (getter-accepted, strict) | 12720 | legacy+unparsed strict verified 665 of 993 (loose 695) | | | 328 unverified |
| After round 23 (delta, not rerun) | 12720 | strict 665 + Keranos/Primitive Etchings reveal_this_way 3 + opponent_casts_creature and transform confirmed real (spellCondition switch / processTransformTriggers) | | | about 325 unverified |
| After round 24 (delta, strict audit not rerun) | 12720 | round 23 delta + self_blocks_or_becomes_blocked confirmed real (combat.ts includes-check) + forced_discard Spiritual Focus wired | | | |
| After round 25 (strict audit recreated and rerun, substring type checks accepted) | 12720 | legacy+unparsed strict verified 580 of 993 (loose 679) | | | 413 unverified |
| After round 27 (delta, strict audit not rerun) | 12720 | round 25 + Lucky Clover / Chancellor copy triggers, Lozhan cast triggers wired | | | |
| After round 28 (delta, strict audit not rerun) | 12720 | round 27 + copy triggers now real stack triggers; spend-this-mana Dragon triggers (Scaled Nurturer, Orbs of Dragonkind) via requiresManaFromPermanentId; Wicked Role "put into a graveyard" self trigger; Pennant/Torque chosen-type ETB confirmed real | | | Pure Intentions spell-created discard delayed trigger still no runtime |
| After round 29 (delta, strict audit not rerun) | 12720 | round 28 + spell-created "this turn, whenever" trigger sources (Pure Intentions discard return) via turnScopedSpellTriggers | | | |

Round 25: the strict audit was recreated (the round 22 script was gone): all 47 exported detect*Trigger(s) functions in state/modules/triggers plus triggered-abilities.ts are called with each of the 993 legacyRuntimeOnly/unparsed clauses as its real card; loose = a returned trigger effect starts with the clause effect (first 12 chars); strict additionally needs, at some call site outside the definition (5000-char window), either no triggerType/timing filter, a literal comparison (===, !==, case) or a substring .includes() hit on that type, or a spellCondition dispatch. Strict 580 / loose 679 / unverified 413. Not directly comparable with round 22 (665/695/328): call-site scoping is stricter, and combat-damage variants checked via regex/startsWith are rejected (likely heuristic false negatives). Runtime added this round: "when you have N or less/more life" state triggers (lifeThresholdStateTriggers.ts, checked in the SBA pass, intervening-if rechecked; Opal Avenger), and spell-cast qualifiers "of the chosen type", "that has an Adventure", "Adventure [instant or sorcery] spell", "Adventure or Dragon spell" (spellCastQualifierTriggers.ts: Vanquisher's Banner no longer fires on any creature; Edgewall Innkeeper, Storyteller Pixie, Lucky Clover, Lozhan now gate/fire correctly).

Round 24: Najal (cost-gated next-cast rider) routed to the legacy pay prompt and the IR on_event next-cast step deferred to the server; "when you have N or less life" now reports triggerType life_threshold so the transform event no longer queues Opal Avenger; forced_discard (Spiritual Focus) fires on opponent-caused discards via causeControllerId.

Round 23: counters_put_on_target now filters by its subject (counterTargetSubject.ts: self names / ~ / this creature, another, type lists, colorless); reveal-the-first-draw this-way triggers fire from getCardDrawTriggers with the drawn card; Sword of Wealth and Power, Thunderclap Drake commander-cast count, Najal paid rider and next-cast replay events fixed. Tests: tests/round23-trigger-runtime.unit.test.ts. The strict audit was not rerun.

Round 21 row is a full rerun with the legacy and unparsed buckets re-split per family: every legacyRuntimeOnly or unparsed clause (riders skipped as in the census) is run, as a one-sentence card, through all 44 exported detect*Triggers functions of the coverage-audit detector modules; a clause counts as legacy-verified if a detector returns a trigger whose payload contains the start of the clause effect, or if its family is queued by a server hook from rounds 18-21 (self-discard, die roll, explores, loyalty, crew, play a land or cast a spell, saddles, connives incl. "when it connives this way", dies during combat, the Adversary pay-this-cost rider). Unlike the round 17 audit, the queueing-getter acceptance check is not applied, so the verified columns are an upper bound (the unparsed split especially: round 17 found 533 verified, this pass 697). Families re-split this round: Sengir "creature dealt damage by this creature this turn dies" (12+4, verified by tests/sengir-family.dealt-damage-dies.integration.test.ts), "when you next cast an instant or sorcery spell this turn" (copy count twice/three times and retargeting now read from the text), "when it connives this way" (now parsed legacyRuntimeOnly and queued by irEventWatchers). Top parsed-no-runtime families: at this turn's next end of combat (4), tap an untapped creature an opponent controls (3), spend this mana to cast a dragon spell (3), cast a creature spell that has an adventure (3), opponent is dealt noncombat damage (3), cast a spell of the chosen type (3).

Round 20 row is a full clause rerun (parseTriggerClause on every Commander-legal clause), split into IR runtime / parsed legacyRuntimeOnly / unparsed; the round 19 estimate collapses to 12716 / 301 / 999, so the rerun confirms it apart from round 20 work: "a spell that's white, blue, black, or red" and "a white, blue, black, or red spell" color lists now parse with every color (Questing Druid, Quirion Dryad; previously Quirion Dryad parsed with only white and a broken effect), and Cathedral Membrane / Mongrel Pack "dies during combat" moved from unparsed to parsed legacyRuntimeOnly with a combat-only runtime check. Tests: tests/trigger-ir-round20-combat.regression.test.ts.

Round 19 row is an estimated per-family delta on round 18, not a rerun: parsed (legacyRuntimeOnly) clauses now queued by server hooks with family tests in tests/trigger-ir-round19.regression.test.ts: play a land or cast a spell (land half) 7, saddles a Mount 2, connives 3 (irEventWatchers.ts). Metropolis Angel "attack with one or more creatures with counters on them" moved from unparsed to IR 1. Die-roll, discard-type, regeneration and leaves-this-turn work changes resolution or effect IR, not trigger clause buckets.

Round 18 row is a per-clause delta on the round 17 audit, not a full rerun: 33 clauses moved because a new event-specific emitter (server/src/state/modules/triggers/eventSpecificLegacyTriggers.ts) queues them, each family covered by a behavioural test on a real card (tests/trigger-ir-round18.regression.test.ts). Parsed (legacyRuntimeOnly): opponent-caused self-discard 8, self-discard 2, roll a N 5, creature you control explores 4, loyalty ability of planeswalker 4, crews a Vehicle 5. Unparsed: Bartered Cow self-discard 1, Nicanzil explores land/nonland 2, cast or cycle ~ (cycle half) 2. The clause-level parse split (13016 / 14016) is unchanged.

Round 9: Clue/Food/Blood/Cartouche/Shrine subjects, "each of your upkeeps/end steps", plural self-names ("~ enter", "~ attack"); turned_face_up, class_level, room_fully_unlocked and controls_none now run through IR emitters. Earlier-round rows were lost when the census script regenerated this file; the script does not keep this section, so re-add it after each run.

Round 22: the audit now applies a getter-acceptance check again: a detector result counts only if a caller of that detector outside its own module either does not filter on triggerType or compares the returned type. Strict verified 665 / loose 695 / unverified 328 of 993 legacy+unparsed clauses. Rejected types: counters_put_on_target (6), reveal_this_way (3), opponent_casts_creature, transform, forced_discard, self_blocks_or_becomes_blocked (2 each), and 13 singletons. Families wired this round: next-cast copy riders from permanent/loyalty abilities, X times / additional time copy counts, MV-capped next cast, "when you next cast a spell this turn" effect riders, opponent dealt noncombat damage, you tap an untapped creature an opponent controls.

## Rounds 30-31: turn-scoped "this turn, whenever" spell watchers

| Family | Status | Test |
|---|---|---|
| Dies (Death Frenzy) | runtime-verified | trigger-ir-round30-turn-scoped-families |
| Spell cast (Glimpse of Nature) | runtime-verified | trigger-ir-round30-turn-scoped-families |
| Attacks (Ondu Rising) | runtime-verified | trigger-ir-round31-turn-scoped-combat-life-mana |
| Blocks (Battle Cry) | runtime-verified | trigger-ir-round31-turn-scoped-combat-life-mana |
| Life gain (False Cure) | runtime-verified (gainer loses 2 per 1 gained) | trigger-ir-round32-turn-scoped-leftovers |
| Combat damage (Surge-style) | runtime-verified | trigger-ir-round31-turn-scoped-combat-life-mana |
| Land tapped for mana (High Tide, Bubbling Muck) | runtime-verified, all players (High Tide r31, Bubbling Muck r32) | trigger-ir-round32-turn-scoped-leftovers |
| Enters (Rite of Harmony) | handled by IR temporaryEtbTriggers; extractor skips | round30 no-double test |

## Round 32: turn-scoped leftovers

| Family | Status | Test |
|---|---|---|
| "N life for each 1 life/damage" reference quantity (False Cure) | fixed: oracleIRExecutorResolveQuantity per-one reference | trigger-ir-round32-turn-scoped-leftovers |
| Blocks with "its controller" subject (Mage Hunters' Onslaught, Noxious Assault) | fixed: blockingCreatureId bound as interveningIfSubjectPermanentId | trigger-ir-round32-turn-scoped-leftovers |
| Blocks by an opponent's creature (Benefactor's Draught) | runtime-verified | trigger-ir-round32-turn-scoped-leftovers |
| "Whenever you/a player tap(s) a <basic> for mana, add an additional {X}" (Molten Tide) | fixed: generic oracle parse manaAbilityOracleLandTapBonus | trigger-ir-round32-turn-scoped-leftovers |
| Dealt damage / "that creature" (Shriveling Rot, Arcbond, Glyph of Life) | runtime-verified (round 33) | trigger-ir-round33-turn-scoped-damage-unblocked |
| Attacks and isn't blocked (Gaze of Pain) | runtime-verified (round 33; second-sentence rider folded via foldPendingOptionalReflexiveRider in round 34) | trigger-ir-round33-turn-scoped-damage-unblocked |

## Round 33: turn-scoped damage, unblocked and census groups

| Group | Status | Test |
|---|---|---|
| Modal turn-scoped clauses (bullet prefix, only chosen modes register; Shriveling Rot) | runtime-verified | trigger-ir-round33-turn-scoped-damage-unblocked |
| Dealt damage, any creature, "it" = damaged creature (Shriveling Rot mode 1) | runtime-verified | trigger-ir-round33-turn-scoped-damage-unblocked |
| "That creature" dealt damage this turn (Arcbond) | runtime-verified (IR delayed path) | trigger-ir-round33-turn-scoped-damage-unblocked |
| Dealt damage by an attacking creature (Glyph of Life) | runtime-verified; source approximated as "damaged permanent is blocking" | trigger-ir-round33-turn-scoped-damage-unblocked |
| Attacks and isn't blocked, "it" = attacker (Gaze of Pain) | runtime-verified (trigger + binding) | trigger-ir-round33-turn-scoped-damage-unblocked |
| A player casts an instant or sorcery this turn (Bonus Round) | runtime-verified via opponent/any-player cast path | trigger-ir-round33-turn-scoped-damage-unblocked |
| A creature you control dies this turn (Waltz of Rage) | runtime-verified | trigger-ir-round33-turn-scoped-damage-unblocked |
| Nontoken creature you control dies this turn, effect ends in a quoted ability (Gnawing Crescendo) | runtime-verified | trigger-ir-round33-turn-scoped-damage-unblocked |
| Kicker-gated "If this spell was kicked, whenever ..." (Warhost's Frenzy) | runtime-verified (round 34) | trigger-ir-round34-damage-source-kicked-attack-watchers |
| Song of Blood / Indulge (attacks this turn), Harsh Justice | runtime-verified (round 34; Song's "this way" count tracked since round 35) | trigger-ir-round34-damage-source-kicked-attack-watchers |

## Round 34: damage source seam, Gaze rider, kicked/attack watchers

| Group | Status | Test |
|---|---|---|
| Real damage source on damage events (Glyph of Life "attacking creature" exact) | runtime-verified; generic seam damageEventSources.ts | trigger-ir-round34-damage-source-kicked-attack-watchers |
| Optional effect + "If you do" rider in IR may-choice (Gaze of Pain: assigns no combat damage) | runtime-verified; rider folded into effect text when main effect is optional/undecided | trigger-ir-round34-damage-source-kicked-attack-watchers |
| Kicker-gated turn-scoped trigger (Warhost's Frenzy) | runtime-verified | trigger-ir-round34-damage-source-kicked-attack-watchers |
| Attack watchers (Song of Blood, Indulge) | runtime-verified; Song "this way" count finalized lazily after the spell leaves the stack (round 35) | trigger-ir-round34-damage-source-kicked-attack-watchers |
| Combat damage "an attacking creature ... to you" (Harsh Justice) | runtime-verified; parser recipient filter damagedPlayer:'you' | trigger-ir-round34-damage-source-kicked-attack-watchers |
| Shriveling Rot mode 2 (dies this turn) | runtime-verified | trigger-ir-round34-damage-source-kicked-attack-watchers |

## Round 35

| Group | Status | Test |
|---|---|---|
| "for each [type] card milled/put into your graveyard this way" in turn-scoped triggers (Song of Blood) | runtime-verified; graveyard diff vs registration baseline, scales +X/+0, draw, gain/lose life | trigger-ir-round35-this-way-that-creature-combat |
| Bound "that creature/it deals (combat) damage ... this turn" on a targeted creature (Hunter's Insight, Fire Giant's Fury, Vigorous Charge kicked/unkicked) | runtime-verified; bound to first battlefield target, only seen by combat-damage queue; unqualified "deals combat damage" watched as player damage only | trigger-ir-round35-this-way-that-creature-combat |
| Forth Eorlingas! (monarch on combat damage) | runtime-verified | trigger-ir-round35-this-way-that-creature-combat |
| Touch of Moonglove | runtime-verified (death trigger fires from m1); effect text still carries a stray "this turn\n" prefix | trigger-ir-round35-this-way-that-creature-combat |
| Fire Giant's Fury "you may play those cards" | open | - |
| Vigorous Charge damage to creatures; Great Train Heist, Reckless Blaze, Ghired's Belligerence, Arcbond/Glyph (delayed registry) | open / handled elsewhere | - |

## Round 36

| Card | Status | Notes |
|---|---|---|
| Touch of Moonglove | fixed | death trigger text no longer carries a leading "this turn" (generic strip in collectDeathTriggerEffectText) |
| Vigorous Charge | fixed | bound unqualified "deals combat damage" = any recipient (rule 510); fires once per attacker with player+creature total. Supersedes the round-35 "damage to a player" assumption |
| Fire Giant's Fury | fixed | "until ..., you may play those cards" rider joins the trigger effect; "that many" bound to damage; play/cast permission no longer makes the trigger optional |
| Great Train Heist | partial | "to that player" bound to the targeted opponent (boundPlayerId). Known leak: spell resolution also runs the trigger sentence once (creates a Treasure at resolution) - resolution-side, not fixed |
| Reckless Blaze | fixed | "a creature you control dealt damage this way dies" via damage-snapshot diff (getDamageWayDiesSources) |
| Ghired's Belligerence | fixed (trigger) | same damage-this-way watcher; divided-damage prompt not exercised in test |
| Spiritualize, Samite Ministration | open | next census group |

## Round 37: Star Trek (trk/trc)

Census `--include-upcoming`: before cards=12496 clauses=14317 ir=13282 (92.8%) legacy=1035;
after cards=12496 clauses=14317 ir=13344 (93.2%) legacy=973. Trek trigger lines parsed: 4/44 before, 44/44 after.

- Creature types: 42 Trek races/roles plus 33 CR 205.3m (2026-09-25) types that were missing (Sorcerer, Spy, Synth, Toy, ...).
- Titled self short names ("Captain Archer", "Ensign Chekov", "Dr. McCoy", "Q") in the IR normalizer and in the legacy name regexes.
- `parseRound37TrekEvents.ts`: face a dilemma (`facesDilemma`), attack-while-total-power (`minTotalPower`), "this Spacecraft" self reference;
  the long tail (chosen name/number, charge counters first time, tap for {C}, Path of Ancestry, "dies during your turn", "... this turn" delayed wordings,
  Peace in Our Time, VAAx, Phlox counter filter, commander enters-or-attacks, enters-or-deals-combat-damage) is `legacyRuntimeOnly`.
- Runtime: `trekPlayerEventTriggers.ts` (dilemma count + triggers incl. Lorca from graveyard; battlefront count). Dilemmas are recorded on cast
  (modal or spree modes) and on modal IR triggers; activated-ability modes are not hooked yet.
- Total power N is checked as attackers are declared (`attack-watcher-queue` `you_attack` + `minTotalPower`).
- Turn-scoped "whenever ... this turn" sentences the registry owns no longer run at resolution (Great Train Heist Treasure leak).
- Skipping declare attackers keeps earlier combats' attacked players (battlefront across combats).

## Round 38

- Split `oracleIrTriggerExecution.ts` (40,248 -> 26,114 bytes); target binding moved to `oracleIrTriggerTargetBinding.ts`.
- Dilemmas: activated-ability mode choices (preselected and EffectProgram `mode_selection` prompts) now count as dilemmas faced, once per item.
- Lorca graveyard trigger verified end to end (pay {B} -> return to hand).
- Legacy runtime: "opponent draws a card during your turn" now gated on turn; typed counters ("charge") put on a self name or `this artifact/enchantment/land/spacecraft/vehicle` now trigger with the counter filter and first-time-each-turn flag.
- Census after: ir=13344 (93.2%), legacy=973 (runtime-only fixes; classification unchanged).
- Known gaps: chosen-name cast triggers (Kai Winn) still match any spell; intervening ifs "returned to your hand from the battlefield this turn", "Equipment or Spacecraft entered this turn", "attacked this turn" evaluate as unknown (kept).

## Round 39

- Census (--include-upcoming): cards=12496 clauses=14317 ir=13344 (93.2%) legacy=973 (unchanged; round focused on correctness).
- Kai Winn: "whenever an opponent casts a spell with the chosen name" now scoped to opponents and gated on permanent.chosenCardName (generic for any chosen-name cast trigger).
- Impulse play rider (impulsePlayRider.ts): "You may play that card this turn" follow-ups retained for counter-removed self triggers (Enterprise-D), shared with Fire Giant's Fury path.
- Intervening-if: Miles O'Brien (returned to hand from battlefield this turn), Sulu (subtype entered under your control this turn, falls through to subtype trackers), Targ Wrangler (attacked this turn; false when flag reset, null only when unknown).
- Unknown intervening-if clauses: the "if <words>" shorthand catch-all now returns FALLBACK; isInterveningIfSatisfied records state.unknownInterveningIfClauses and skips (policy 'skip', switchable to 'keep' via setUnknownInterveningIfPolicy). Umbrella null recognisers (defending player/enchanted/equipped/N or more...) still return null (fire) - next audit target.

## Round 40

- Census (--include-upcoming): ir=13348 (93.2%), legacy=969 (was 973).
- New `rules-engine/src/triggerCondition/parseRound40BatchedEvents.ts`: batched "one or more <plural> ... enter/attack/deal combat damage (to one or more players)" rewritten to singular and tagged `quantity: one_or_more`. Becomes tapped/blocked deliberately not handled (no runtime batching).
- New `server/src/state/modules/triggers/intervening-if-eval-attached-defender-clauses.ts`: real evaluation for defending-player (controls no X, more/fewer lands/creatures, more/fewer cards in hand) and enchanted/equipped host (power N+, tapped/untapped/attacking, colour, type or subtype).
- Umbrellas switched to unknown (FALLBACK_INTERVENING_IF): defending player, enchanted, equipped. Kept null (fire): it/they, N or more, at least N, spent/sacrificed, counters/this turn, because they are mostly event-context clauses (kicked, bargained, mana spent) and skipping them would drop legitimate triggers.
- Probe `server/scripts/intervening-if-unknown-probe.ts`: 16197 trigger lines, 1325 with intervening-if, 679 decided, 646 recognised-null, 38 unknown-skipped (36 distinct). Unknown residue: "isn't prepared", nearest-opponent/most-life combat damage, imprint counts, cast-from-elsewhere, modified creature died, etc. Largest null group: "if it was kicked" (65), "a player cast two or more spells last turn" (33).
- Tests: `server/tests/trigger-ir-round40.test.ts`.
## Round 41

- Census (--include-upcoming): ir=13370 (93.4%), legacy=947 (was 13348 / 969).
- New `server/src/state/modules/triggers/intervening-if-eval-round41-clauses.ts` (runs first in the intervening-if chain, decisive answers only):
  - "if it/this X was/wasn't kicked|bargained|evoked|dashed|blitzed|surged|emerged|foretold|prowled" from the triggering stack item or source permanent (flags, kicker counts, alternateCostId). Negatives: kicked when `castOptionsStamped`; bargained only when `bargainResolved` (positive-only contract kept).
  - "a player / an opponent / you cast N or more spells last turn" (per-player counts, else total < N -> false).
  - "you cast a spell from anywhere other than your hand this turn" (castSourceZone).
  - "all opponents were dealt combat damage this turn" (new turn-tagged `combatDamagedPlayersThisTurn`, recorded in turnCombatDamageAttackerLoop).
  - "a modified creature died under your control this turn" (new turn-tagged `modifiedCreaturesDiedThisTurn`, CR 700.9, recorded in countersTokensMoveToGraveyard).
- Permanent spells now carry kicked/bargained metadata onto the permanent (stackResolvePermanentCastMetadata).
- Trigger IR: subject qualifiers `modified`, "with power greater than its base power", "with a counter / one or more counters on it", non-legendary/basic/snow; batched and singular "attacks a player / an opponent", batched "deal combat damage", "with X counters on them".
- Intervening-if probe is static (no game state), so its counts are unchanged (679 decided / 646 null / 38 unknown); the new clauses are decided at runtime.
- Known gaps: "whenever a modified creature you control <verb>" (singular) stays on the Round16 legacy-only path; spell-cast long tail (with cascade/convoke/flash..., outlaw, during combat) unparsed.
- Tests: `server/tests/trigger-ir-round41.test.ts`.

## Round 42

- Singular "whenever a modified creature you control <verb>" now parses to IR (subject.modified) instead of legacy-only (parseRound16Events). Legacy `modified_creature_ltb` now requires the leaving creature to be modified (CR 700.9); it fired for any creature before.
- Cast long tail: "a spell with <keyword>" / "a creature spell with flying" (spell before with/without is dropped; keyword clause validated by parseSubjectPhrase). Added cast-time keywords cascade, convoke, delve, improvise, storm, ward, toxic, flashback, affinity.
- "outlaw" expands to Assassin / Mercenary / Pirate / Rogue / Warlock (any event).
- "during combat" sets `duringCombat`; the matcher fails only when context `inCombat === false`. The server IR emitter fills `inCombat` from state phase/step.
- Double-fire test (trigger-ir-round42-double-fire.test.ts): batched round-41 forms fire once; singular per creature; unmodified 0; dies and LTB once.
- Not done: "noncreature or Dragon spell"; plural "with power greater than their base power".
- Census (--include-upcoming): ir=13380 (93.5%), legacy=937 (was 13370 / 947).

## Round 43

- Generic "<type-negation> or <word> [tail]" subject split (parseSubjectPhrase `splitSubjectAlternatives`): "a noncreature or Dragon spell", "a nonartifact or Vehicle spell"; the shared tail (noun, controller) goes to both sides.
- "with power greater than their base power" (plural) now parses like the singular (`powerAboveBase`); batched attack fires once (double-fire test).
- Cast tail: "your third / fourth spell each turn" (ordinal; matched by spellOrdinal), "a spell that has <keyword>" (= with), "a spell from a graveyard" (castFromZone graveyard). No legacy handlers exist for these, so no double-fire.
- Remaining legacy list is a flat long tail (top family "when this case enters" 8 cards; rest at 2 cards or fewer).
- Not done: "a nonhuman or Zombie creature you control dies" (dies parser), "an attacking creature you control dies" (needs a last-known attacking flag).
- Census (--include-upcoming): ir=13391 (93.5%), legacy=926 (was 13380 / 937).

## Round 44

- Census (`--include-upcoming`): **13419 IR / 898 legacy** (93.7%), up from 13391 / 926.
- "When this Case enters" fix: the card-name variant `Case` was rewritten inside "this Case", giving "this this permanent". `selfNameNormalize.ts` now collapses `(this|the) this permanent` to `this permanent`.
- Non-X or Y subjects now work in the dies / enters / attacks parsers: `excludedWord` accepts unhyphenated creature-type negations (`nonhuman`, `nonzombie`), so e.g. "a nonhuman or Zombie creature you control dies" splits into alternatives.
- Attacking / blocking dies LKI: new filter field `combatRole` (`attacking` | `blocking`) and subject fields `attacking` / `blocking`. `permanentToTriggerMatch` copies combat status from the last-known battlefield object, so "an attacking creature you control dies" matches only creatures that were attacking.
- Self-name short form: two-word personal names (e.g. "DÃ¡in Ironfoot" -> "DÃ¡in") are now recognized as self references unless the first word is a creature type (e.g. "Goblin Guide"). Heuristic: newly parsed clauses not fully audited for false positives.
- Not done (need new emitters): coin-flip triggers, "a creature deals damage to you", "that's enchanted or equipped".
- Tests: `server/tests/trigger-ir-round44.test.ts`.

## Round 45

- Priority shifted to triggers that fire **0 times** today (no IR emitter and no working legacy/special path), not mere census-legacy lines that already have detectors.
- Inventory: `server/scripts/uncovered-triggers-inventory.ts` â†’ `D:/tmp/mtgpatch/uncovered_triggers.txt` (and `.json`). Includes printed clauses and quoted granted triggers; classifies on-cast self, discard-self look-back, Trek dilemma, delayed "next â€¦" riders, and seeded chosen-type/color detectors as covered.
- Uncovered before Round 45 fixes (after inventory refinements): **539 lines / 526 cards**. After fixes: **430 lines / 420 cards**.
- Families fixed (parse + match + emit / tests with fires-once check):
  - "Whenever an Aura becomes attached to this creature" (`attachedToSource`; aura attach now calls `processEquippedTriggers`).
  - "Whenever you cast â€¦ that targets only this creature" (`targets: self_only`).
  - "Whenever enchanted player casts â€¦" (`controller: enchanted_player`).
  - "Whenever you attack with your commander" â†’ one-or-more commanders you control attack.
- Census (`--include-upcoming`): **ir=13430 (93.8%), legacy=886** (was 13418 / 898).
- Top remaining uncovered (flat long tail): "discard â€¦ this way" (reflexive), each-player first main / combat on each opponent's turn (legacyRuntimeOnly with working legacy detectors â€” inventory still flags them), connive/mill/loyalty/adventure color-or, coin flip, saga final chapter, stickers/evidence/energy, etc.
- Tests: `server/tests/trigger-ir-round45.test.ts`. No UI changes.

## Round 46

- Inventory before: **430 / 420**. After: **363 / 354** (-67 / -66).
- tsc 32->31 (`target_lacks_keywords`).
- FP clear (legacy verified): each-player first main; combat on each opponent's turn. Special-runtime: discard-this-way / connive / mill.
- IR: coin win/lose, collect_evidence, place_sticker, get_energy, saga_final_chapter, Curse of Silence / Shaken Faith, targets permanents, sacrifice Treasure/Junk/during your turn.
- Tests: `server/tests/trigger-ir-round46.test.ts`. UI: none.

## Round 47

- Inventory before (R46 after): **363 lines / 354 cards**. After: **331 lines / 322 cards** (-32 / -32).
- coveredIr **13532** / coveredLegacy **1291** (was 13479 / 1312).
- tsc: **31** (baseline).
- Promoted Round-16 legacy stubs to real IR: chosen-color casts, blue-or-black (two-color) casts, Adventure creature spells (`hasAdventure`), loyalty activation (`activate_loyalty` emit on planeswalker activate).
- Also: `you or a permanent you control becomes the target` (`orControllerPlayer`); leave graveyard during your turn; `-N/-N` counter_placed; `this card` put into GY from library (`prepareSubjectPhrase`); activate nonmana of artifact/creature; next-cast delayed rider (inventory + drop legacyRuntimeOnly).
- Reveal-this-way marked special_runtime.
- Tests: `server/tests/trigger-ir-round47.test.ts` (7 fires-once). UI: none.
- Top remaining: put into a library from anywhere (2); becomes plotted (2); exile-from-hand-or-battlefield OR (2); then mostly 1-card families.
## Round 48

- Inventory before (R47 after): **331 lines / 322 cards**. After: **316 lines / 307 cards** (-15 / -15).
- coveredIr **13550** / coveredLegacy **1288** (was 13532 / 1291).
- tsc: **31**.
- New event `put_into_library` (+ emit on zone move to library); plot as `performs`/`plot`; Hero/Ranar exile OR via `fromZone: hand_or_battlefield` + `causedByYou`.
- Also: last intervention counter (`last_counter_removed`); artifact and/or creature leave GY; instant/sorcery **card**; noncreature, nonland comma; opponent owns; each other player draw step; attack-with without forcing you control; activate_targeting.
- Tests: `server/tests/trigger-ir-round48.test.ts` (5 fires-once). UI: none.
- Top remaining: all 1-card families (cast that spell, emerge sacrifice, first combat end, Jumblebones LTB, no counters, red creature or spell, reflexive sacrifice, same-name combat damage, ...).
## Round 49

- Inventory before (R48 after): **316 lines / 307 cards**. After: **297 lines / 288 cards** (-19 / -19).
- coveredIr **13570** / coveredLegacy **1287** (was 13550 / 1288).
- tsc: **31**.
- Generic near-misses: attack with six..ten or more; opponent/player `scries`→scry; `win a clash` performs; `you or another permanent` becomes target; crime/life/tokens `during your turn` / first-time; gain control `from another player`; put into GY without from / plural `graveyards`; second spell `during their turn`; enchanted-player postcombat/upkeeps; enchanted-controller draw step; passive `X is cast`; color-OR block partners (`green or white`); goaded `deal` combat damage to one of your opponents.
- Skipped (large / bespoke): cast that spell; emerge; first combat end; Jumblebones; no-counters state; red creature-or-spell damage; reflexive this-way; same-name; and/or exile; Wedding Ring; Bill Potts OR; spend-this-mana; craft; scry-bottom; that player's upkeep; hand-from-GY; loyalty-on-PWs; backup; etc. `win_clash` still needs win-specific clash emit wiring beyond parse/queue.
- Tests: `server/tests/trigger-ir-round49.test.ts` (5 fires-once). UI: none.
- Stayed off static/replacement files (statics worker active).
## Round 50

- Inventory before (R49 after): **297 lines / 288 cards**. After: **277 lines / 268 cards** (-20 / -20).
- coveredIr **13607** / coveredLegacy **1270** (was 13570 / 1287).
- **win_clash emit:** `applyClashStep` pushes winners to `state.pendingClashWins`; `bridgeGameStateOracleEffectsAfterOracleIR` drains them into `queueParsedKeywordAction(..., 'win_clash')`. Loss does not enqueue. E2E fires-once test covers apply → bridge → stack.
- Also: `whoseTurn: that_player`; loyalty `counter_placed`; you-put +N/+N counters (promoted off legacyRuntimeOnly); backup `abilityWord`; new cast `targets` relations; `activate_creature`; equipped block partner; passive combat damage to you; Bill Potts cast|activate OR; spend-this-mana IR (`requiresSourceMana`); scry-bottom marked `special_runtime`.
- tsc: our triggerCondition/match WIP errors fixed (added `thatPlayerId` / `referencedPlayerId` / `targetIsPlayer` on `TriggerMatchContext`). Server total currently **33** because the statics worker owns **+2** in `gameStateEffectsDamageSideEffects.ts` / `replacementEffectSpecDamageSideEffectTemplates.ts` — left untouched per stay-off rule.
- Tests: `server/tests/trigger-ir-round50.test.ts` (4). UI: none.
## Round 51

- Inventory before (R50 after): **277 lines / 268 cards**. After: **233 lines / 225 cards** (−44 / −43).
- coveredIr **13663** / coveredLegacy **1258** (was 13607 / 1270).
- tsc: **31** (baseline). `parseRound16Events.ts` syntax verified clean (`node --check` + import).
- Keyword `performs`: forage, investigate (+ first-time), give a gift, manifest dread, open/visit an Attraction.
- Also: gain life during your turn; discard nonland first-time; you and/or permanent becomes target; activated-ability target; creature with +1/+1 becomes target; cast targets creature you don't control; your commander combat damage; leave(s) BF (plural / during your turn / without dying); play Island; you-put any/loyalty/time/lore counters; enchanted land/Plains GY → dies; opponents dealt combat damage during your turn; excess damage; you turn face up; transforms into a type; exploits.
- special_runtime: tap-for-mana / tap for {C}, hand-from-GY, commander-to-CZ (plus restored on_cast_self / delayed_rider / dilemma / this-way / scry-bottom inventory marks).
- Skipped (bespoke): cast that spell; emerge; first combat end; Jumblebones; state triggers; Wedding Ring; craft; plan counters; Magmatic Galleon plural "your opponents control are dealt"; etc.
- Tests: `server/tests/trigger-ir-round51.test.ts` (4). UI: none.
- Stayed off statics worker files and UI attack-cost files.

## Round 52

- Inventory before (R51 after): **233 lines / 225 cards**. After: **188 lines / 183 cards** (-45 / -42).
- coveredIr **13725** / coveredLegacy **1241** (was 13663 / 1258).
- tsc: **31** (baseline).
- Generics + bespoke-with-hooks: put_into_library (already emit); emerge sacrifice (`whileCastingEmerge`); craft exile (`whileActivatingCraft`); first combat end (`firstCombat`); plan / nth +1/+1 counters through tenth (`counterOrdinal`); controls_none family (no creatures on BF, control N+, no counters, opp/you power-toughness, power >= N, N+ named counters e.g. tide); `phases_in` (incl. `this permanent or another`); `your opponents control` subject controller; are-dealt excess; become untapped (`~` -> this permanent); passive is sacrificed / is destroyed; cards are exiled; player puts Forest/etc.; legendary land or cast legendary spell; spend-this-mana -> commander; opponent `activates` deconjugation -> performs; that-player upkeeps (prior); attack exactly / typed (prior).
- **Truly infeasible this round** (no clean generic hook / need new emitters or delayed scheduling):
  - `when you cast that spell` / next-cast-of-type (contextual "that")
  - Jumblebones LTB (named one-off)
  - `whenever a red creature or spell deals damage` (dual subject creature|spell)
  - `whenever you attack with ~ and another legendary creature` (named + typed attack pair)
  - `whenever one or more opponents each lose exactly N life` (multi-player exact)
  - `at the beginning of the end step on your next turn` (delayed next-turn)
  - reflexive this-way / same-name combat / and-or exile / Wedding Ring named-artifact opponents / fought this way / chosen quality / Scout tribal batch / etc.
- Tests: `server/tests/trigger-ir-round52.test.ts` (4 fires-once). UI: none.
- Stayed off statics worker files and UI attack-cost files.

## Round 53

- Inventory before (R52 after): **188 lines / 183 cards**. After: **167 lines / 163 cards** (-21 / -20).
- coveredIr **13712** / coveredLegacy **1275** (was 13725 / 1241). (IR dip is expected: next-cast / that-spell / next-turn end-step riders now count as delayed_rider, not permanent IR emitters.)
- tsc: **31** (baseline).
- Reconsidered former "infeasible" with real hooks:
  - `when you cast that spell` -> spell_cast + `thatSpell` + `nextSpellThisTurn` (delayed rider)
  - `when you next cast ... (of that type) this turn` -> nextSpellThisTurn + `ofChosenType`
  - `at the beginning of the end step on your next turn` / that player's next end step / your next end step -> beginning_of_end_step + `delayedNextTurn`
  - `whenever a red creature or spell deals damage` -> deals_damage + color + `orSpellSubject`
  - `whenever one or more opponents each lose exactly N life` -> loses_life + exactLife + eachOpponent
- Also: Merry + another legendary attack; untap during your untap step; inventory delayed_rider / this-way expansions.
- **Still left (and why):**
  - Jumblebones LTB ? named one-off subject, no generic self-name hook on Ozox
  - same-name combat damage ? needs same-name comparator beyond IR subject filters
  - creatures you control and/or GY creature cards put into exile ? zone-OR dual subject
  - Wedding Ring (opponent who controls artifact named ~) ? named-control gate on draw/lifegain
  - attack with two or more non-~ ? self-exclusion batch attack
  - Millennium Calendar "when there are N" ? truncated / counter-state bespoke
  - Scout / Rabbit tribal batch one-offs ? subtype batch without generic emitter path yet
  - fought this way / this way reflexive leftovers ? need fight/reflexive watcher wiring
  - blocked by two or more / dealt-damage-this-turn block partners ? combat history gates
  - Bronze Bombshell ownership control change ? owner?controller state
  - chosen quality / chosen color most-common ? choice + board census
  - Enkira ~ and at least two Zombies ? named + count tribal attack
  - deathtouch blocks this / Hellish Rebuke caster / Kolaghan same-name GY / Pain Magnification N-from-source ? specialized combat/cast gates
  - Precursor Golem single golem target / Priority Boarding reveal-this-way / Ichneumon non-first-instant / Call to Arms color census / Chalice charge-count MV / etc. ? one-card specials
- Tests: `server/tests/trigger-ir-round53.test.ts` (4 fires-once). UI: none.
- Stayed off statics worker files.

## Round 54

- Inventory before (R53 after): **167 lines / 163 cards**. After: **138 lines / 135 cards** (-29 / -28).
- coveredIr **13741** / coveredLegacy **1275** (was 13712 / 1275).
- tsc: **31** (baseline).
- Generics requested:
  - same-name comparator (`sameNameAsSource`) ? Pirated Copy
  - zone-OR dual subject (`fromZone: battlefield_or_graveyard`) ? Kaya
  - self-exclusion attack batches (`excludeSourceFromAttackers` / non-this-permanent after self-normalize) ? Gideon
  - combat-history gates (`minBlockers`, `blockPartnerDealtDamageThisTurn`) ? Seifer, Giant Shark
  - fought-this-way promoted off Round-37 legacy stub ? T'Pring
  - ownership-state (`controllerNotOwner`) ? Bronze Bombshell
  - subtype batches (Scout/Pirate/Rogue; Rabbit/Bat/Bird/Mouse) ? Vaan, Valley Questcaller
- Also one-card / few-line specials: Enkira (~ + N subtype attackers), Mirror Shield (blocks-or-blocked-by-self), Wedding Ring named-control draw/lifegain, Jumblebones LTB, other-than-~ exile, Ainok self-and/or-commander, Tergrid sac|discard, lose the flip, no legendary Vampire, Pain Magnification min damage, first noncreature spell of turn, cast from not-hand, opp puts counters, play nonbasic, first-or-second draw, opponents attacked, same-name-as-GY cast.
- Tests: `server/tests/trigger-ir-round54.test.ts` (4 fires-once). UI: none.
- Stayed off statics worker files.

### Remaining (138/135) ? why still out

- Kai Winn chosen-name cast|activate ? choice + dual event (legacyRuntimeOnly)
- Millennium Calendar "when there are N" ? truncated counter-state
- Gollum chosen quality MV ? choice binding
- Hellish Rebuke damage to the player who cast ~ ? caster linkage
- Precursor Golem single golem target ? subtype-only single target
- Priority Boarding reveal-this-way MV < roll ? reflexive + compare
- Ichneumon non-first-instant-per-player ? per-player ordinal
- Call to Arms most-common-color census ? board-wide color tally
- Chalice MV = charge counters ? live counter read on source
- Pure Intentions discard-this-turn caused-by-opp ? turn-scoped cause
- Psychic Battle chooses targets ? choice event
- Surrak creature OR creature-spell becomes target ? permanent|stack OR
- Visit attractions roll / stickers / cumulative upkeep / prevented damage / named land ability / total power attack first-time / exiled-with play / chosen player loses / Redwing / equipment this way / attack-causes-trigger / fifth draw / unblocked attack you / no lands / natural N / bounce-to-hand / N damage to player / destroy noncreature ? one-off specials needing new emitters or deep context

## Round 55

- Inventory before (R54 after): **138 lines / 135 cards**. After: **92 lines / 89 cards** (-46 / -46).
- coveredIr **13798** / coveredLegacy **1264** (was 13741 / 1275).
- tsc: **31** (baseline).
- One-offs / remaining-list hits:
  - cumulative upkeep unpaid; damage prevented; total-power attack (+ trek promote); natural N die; no lands / empty hand / empty GY
  - bounce-to-hand (from battlefield); play card exiled with source; Chalice MV=charge counters; Ichneumon per-player first instant; Precursor Golem subtype-only target
  - fifth+ ordinal draw; unblocked attack you; source deals N+ damage; destroy noncreature by opp; ring-bearer; discard|mill; waterbend / art|name sticker / visit attractions
  - chosen/enchanted player loses game; Garruk loyalty max; charge-counter minimum; twelfth hour; last ore counter; exile from library and/or GY; fight|become blocked; Surrak creature|spell target
  - Kai Winn chosen-name cast|activate; Talion exact MV; Hellish Rebuke caster damage; primal mana spent; that-player next end step; Redwing named attacker
- Tests: `server/tests/trigger-ir-round55.test.ts` (4 fires-once). UI: none.
- Stayed off statics worker files.

### Remaining (92/89) ? why

- Millennium Calendar truncated "when there are N"
- Priority Boarding reveal-this-way MV < roll
- Call to Arms most-common-color census
- Pure Intentions turn-scoped opp-caused discard
- Psychic Battle chooses targets
- Skophos named-land ability target; Firebender attack-causes-trigger; Gimli ability resolves Nth time
- Arcee targets creatures or vehicles; Talion MV-without-number (chosen X); Tyvar mana ability resolves
- City in a Bottle Arabian Nights name set; Samite/Sacred Ground prevent/destroy-this-way
- Watcher of Hours remove time while exiled; Tameshi noncreature bounce
- Ceaseless Searblades activate Elemental; Loki player|permanent target; Coffin Queen untap|lose control OR
- Innocent Bystander dealt N+; Sower chosen players; Sharae tap opp creatures; Mangara chosen color; Sewer Nemesis chosen player casts
- Dark Depths no ice counters; Beast damage to owner; Tide of War creatures block; Vizier eternalize|embalm
- Inferno power becomes N this way; Smaug named noncombat; Strionic empty when/whenever/at stubs; Vraska token vs planeswalker

## Round 56

- Inventory before (R55 after): **92 lines / 89 cards**. After: **58 lines / 56 cards** (-34 / -33).
- coveredIr **13838** / coveredLegacy **1258** (was 13798 / 1264).
- tsc: **31** (baseline).
- Favored generics:
  - ability-resolves: Tyvar mana ability resolves; Gimli Nth resolve (`abilityResolves` / `resolveOrdinal`)
  - choice-gated: chosen player casts / damage to chosen players; chosen name + chosen MV promoted off Round-37 legacy; chosen-name first-time; Mangara chosen-color deals damage
  - reflexive this-way: Priority Boarding MV < roll (`manaValueLessThanResult`); Inferno power becomes N (`powerBecomes`); excess damage this way
  - typed bounce: Tameshi noncreature returned to hand (late bounce broadened + Round-56 stamp)
  - untap-or-lose-control OR: Coffin Queen (`becomes_untapped` + `pairedEvent: loses_control`)
  - Dark Depths named no-counters (`noCounters: ice`; Round-8 named-counter broaden)
  - copy-trigger stubs: lightweight `action: copy` / spellCopied when wording fits
- Also landed: damage to its owner; blocked by lesser power; player|permanent becomes target; dealt/deals N+ damage; activate artifact/elemental/ninjutsu/eternalize|embalm; Sharae tap-opp promote; aura-spell target; each postcombat main; opponents noncombat damage; plague-counter minimum
- Tests: `server/tests/trigger-ir-round56.test.ts` (4 fires-once). UI: none.
- Stayed off statics worker files.

### Remaining (58/56) ? why still out (true one-offs / new subsystems)

- Millennium Calendar truncated "when there are N" ? counter-state bespoke / truncated family key
- Call to Arms most-common-color among permanents ? board-wide color census
- Pure Intentions turn-scoped opp-caused discard ? delayed this-turn cause
- Psychic Battle player chooses targets ? choice event subsystem
- Skophos named-land ability target ? named source ability gate
- Firebender attack-causes-trigger ? meta trigger-on-trigger
- Arcee targets creatures or vehicles ? dual type target OR
- Talion MV-without-number (chosen X / power) ? dual chosen quality
- City in a Bottle Arabian Nights originally-printed set ? set metadata gate
- Samite / Judgment prevented-this-way; Sacred Ground land-to-GY caused by opp ? prevention / cause linkage
- Watcher of Hours remove time while exiled ? exile-zone counter remove
- Strionic empty when/whenever/at. stubs ? oracle fragment noise
- Circle of Confinement vampire same-name-as-exiled ? exile-set name compare
- Deep Gnome lands enter without being played ? unplayed enter gate
- Hidetsugu / Rowen / Explosion of Riches this-way riders ? delayed reflexive without shared watcher
- Shipwreck spirit|disturb discard OR; Harbin/Spinneret/Path of Mettle subtype or keyword attack batches
- War Doctor phase-out OR exile dual event; Thought Prison shares color or MV with exiled
- Paradox Haze first upkeep; Most Dangerous Gamer claim prize; Saproling kicks; Ketramose exile GY and/or BF
- There and Back Again named dies; Hostile Investigator multi-player discard; All-Out Assault next attack delayed
- Tetzin double-faced artifact; Eye of Singularity other-than-basic-land; Gonti spell they don't own
- Diabolic Servitude creature-put-with-this; Lurking Jackals / Transcendence life thresholds
- Sigurd lore counter on saga; Canal Courier attack different players; Ring tempts you
- Tenuous Truce enchanted opponent's end; Volo doesn't-share-type cast; Clandestine suspected
- City of Traitors play another land; Zidane gains control from you; Bomb Squad fuse counters
- Exterminator Magmarch single nonland permanent target; Sengir another player loses
- Floodgate has flying state; Evin multi-player sacrifice; Pyromancer's Goggles red spent-mana legacy
- Rewrite History creatures you control become tapped; Urza's Sylex exile from BF; Valor's Reach token+token attack
- Firesong white instant/sorcery causes lifegain ? cause-of-lifegain linkage

## Round 57

- Inventory before (R56 after): **58 lines / 56 cards**. After: **22 lines / 20 cards** (-36 / -36).
- coveredIr **13882** / coveredLegacy **1250** (was 13838 / 1258).
- tsc: **31** (baseline).
- Ordinary leftovers first:
  - life thresholds (Lurking Jackals / Transcendence)
  - has flying (Floodgate); ring tempts (Ringwraiths); suspected attack (Clandestine Meddler)
  - play another land (City of Traitors); gain-control-from-you (Zidane)
  - become-tapped batch (Rewrite History); exile from battlefield (Urza's Sylex)
  - token+token attack (Valor's Reach); another player loses (Sengir)
  - multi-player discard (Hostile Investigator) / sacrifice (Evin)
  - attack different players (Canal Courier); lore on Saga (Sigurd)
  - other-than-basic-land (Eye of Singularity); DFC artifact (Tetzin)
  - named dies (Smaug); next-attack delayed (All-Out Assault)
  - Gonti don't-own; Ketramose battlefield_or_graveyard; kicks (Saproling Infestation)
  - Shipwreck Spirit|disturb; Harbin/Spinneret subtype attack batches; Path keyword attack batch
  - War Doctor phase-out OR exile; Pyromancer's Goggles red spent-mana promoted off legacy
  - also: Tenuous Truce enchanted opponent end; Bomb Squad fuse; Magmarch single nonland target
- Then this-way riders: Hidetsugu exile this way; Rowen reveal basic this way; Explosion draw this way; Judgment/Samite prevented this way
- Tests: `server/tests/trigger-ir-round57.test.ts` (4 fires-once). UI: none.
- Stayed off statics worker files.

### Remaining (22/20) ? true subsystem / deep one-offs

- Millennium Calendar truncated "when there are N" ? counter-state bespoke / truncated key
- Call to Arms most-common-color census ? board-wide color tally
- Pure Intentions turn-scoped opp-caused discard ? delayed this-turn cause
- Psychic Battle player chooses targets ? choice-event subsystem
- Skophos named-land ability target ? named source ability gate
- Firebender attack-causes-trigger ? meta trigger-on-trigger
- Arcee creatures|vehicles target OR
- Talion MV-without-number (chosen X / power) ? dual chosen quality
- City in a Bottle Arabian Nights originally-printed set ? set metadata
- Sacred Ground land-to-GY caused by opp ? cause linkage
- Watcher of Hours remove time while exiled ? exile-zone counter remove
- Strionic empty when / whenever / at. stubs ? oracle fragment noise
- Circle of Confinement vampire same-name-as-exiled ? exile-set name compare
- Deep Gnome lands enter without being played ? unplayed-enter gate
- Thought Prison shares color or MV with exiled card ? exiled-card compare
- Paradox Haze enchanted player's first upkeep ? ordinal upkeep
- Most Dangerous Gamer claim prize ? attraction prize event
- Diabolic Servitude creature-put-with-this ? linked permanent dies
- Volo doesn't-share-type with BF or GY ? dual-zone type compare
- Firesong white I/S causes lifegain ? cause-of-lifegain linkage

## Round 58 (final sweep)

- Inventory before (R57 after): **22 lines / 20 cards**. After: **5 lines / 5 cards** (?17 / ?15).
- coveredIr **13896** / coveredLegacy **1250** (was 13882 / 1250). quotedClauses **483** (was 486; Strionic reminder stubs dropped).
- tsc: **31** (baseline).
- Strionic Resonator: confirmed oracle reminder `(A triggered ability uses the words "when," "whenever," or "at.")` ? quoted fragments are not real triggers. Filtered in `extractQuotedTriggers` / `consider` via trigger-word stub pattern.
- Tractable leftovers landed:
  - Arcee creatures|Vehicles target (`creature_or_vehicle_you_control`)
  - Paradox Haze first upkeep (`upkeepOrdinal: first`)
  - Deep Gnome lands enter without being played
  - Volo no-shared-type BF|GY
  - Thought Prison shares color or MV with exiled card
  - Circle Vampire same-name-as-exiled-with-source
  - Sacred Ground opp-caused land-to-GY
  - Diabolic Servitude linked creature dies
  - Firesong white I/S causes lifegain
  - Skophos named-land ability target (normalize-safe Labyrinth of Skophos)
  - Watcher remove time while exiled (IR, not legacy)
  - Talion MV|power|toughness equal chosen number
  - Pure Intentions opp-caused discard this turn
  - Most Dangerous Gamer claim attraction prize
- Tests: `server/tests/trigger-ir-round58.test.ts` (4 fires-once). UI: none.
- Stayed off statics worker files.

### Remaining (5/5) ? true bespoke / new subsystems

1. **The Millennium Calendar** ? "when there are N / 1,000 or more time counters on ~": truncated family key plus a high-threshold counter-state trigger that needs a dedicated counter-census state trigger (not a simple `counterMinimum` on enters).
2. **Call to Arms** ? "when the chosen color isn't the most common color among nontoken permanents the chosen player controls (or tied)": board-wide color-frequency census + chosen-color binding; needs a permanent color-tally watcher.
3. **Psychic Battle** ? "whenever a player chooses one or more targets": target-choice event subsystem (fires on declaring targets, with library-reveal contest); not spell_cast / becomes_target.
4. **Firebender Ascension** ? "whenever a creature you control attacking causes a triggered ability of that creature to trigger": meta trigger-on-trigger / cause-of-trigger watcher tied to attack declaration.
5. **City in a Bottle** ? "nontoken permanents with a name originally printed in the Arabian Nights expansion": set/printings metadata gate on the battlefield; needs oracle set-printing index, not type-line IR.

## Legacy r1 (already landed in 672a9cfa)

- Inventory before (R58 after): coveredLegacy **1250**. After r1: **1149** (later detector-hit inventory ended at **714** after r2).
- Promoted equipped/first-time/attacks-a-player, combat-death, dealt-damage dies, multi-die, from-exile cast, draw-count, chosen-type, and bare combat-damage families off `legacyRuntimeOnly`.
- Attack emission drops legacy duplicates when a printed IR line already queued the same effect.
- Tests: `server/tests/trigger-ir-legacy-r1.test.ts`. UI: none.

## Legacy r2 (already landed in 672a9cfa)

- Delayed_rider promotions: reflexive "when you/they do", next/that/your end step, that combat, next EOC, that-creature dies/leaves this turn, next-cast / that-spell, plus ETB+upkeep, enters-from-graveyard, attacks-this-turn, enchanted-or-equipped attacks.
- Delayed riders parse as IR but fail closed as permanent matchers (`delayedRider`); they are scheduled by the parent effect.
- Tests: `server/tests/trigger-ir-legacy-r2.test.ts`. UI: none.

## Round 60 / new Oracle cards (mbc, 2026-10-19)

- Inventory before (post r2 + refreshed Oracle): **9 lines / 9 cards** (the original 5 bespoke plus 4 new commander-legal mbc cards). After: **5 lines / 5 cards** (-4 / -4). The 5 remaining are still the bespoke set: Millennium Calendar, Call to Arms, Psychic Battle, Firebender Ascension, City in a Bottle.
- coveredIr **14604** / coveredLegacy **596** (was 14476 / 720). Official census: clauses **14359**, IR **13858** (96.5%), legacy fallback **501**.
- tsc: **0** (baseline; the old 31 errors were already cleared in later commits).
- New generics:
  - spend-this-mana "this turn" (The Unluckiest Planeswalker; extends the existing Dragon/instant parse).
  - "a spell or ability you control causes one or more cards to be exiled from an opponent's library" (`exiled`, `fromZone: library`, `zoneOwner: not_you`, `causedByYou`) - The Madcap Jester.
  - "a source you control deals (exactly N) damage to you" and optional paired "causes you to lose exactly N life" (`exactDamage` / `exactLife`) - Sahir, Visitor in Darkness, also covering Auntie Blyte-style deals-damage-to-you.
  - discard at random plus an optional random-action OR list (`atRandom`, `orEvents`) - Chira, All In.
- Tests: `server/tests/trigger-ir-round60.test.ts` (parse + fires-once). UI: none.
- Stayed off statics worker files and `triggerBecomesUnattached.ts`.

## Legacy r3

- Inventory before: coveredLegacy **720**. After: **596** (-124). coveredIr **14604** (was 14476).
- Families migrated (inventory first-detector counts):
  - on_cast_self **68 -> 0** (`cast_self` added to IR_EMITTED; existing on-cast emitter still fires once). Also parsed: from-hand / not-exile / while-you-control / and-attacks.
  - delayed_rider remainder **23 -> 16** (next upkeep fallback; generic "this way" riders that reparse).
  - etb **113 -> 100** (enters or deals combat damage; enters and sacrifice; enters this turn as delayed IR, not legacy self-ETB).
  - death **67 -> 60** (dies this turn delayed).
  - spellCast **75 -> 68** (promoted "play a land or cast a spell" off `legacyRuntimeOnly`; some related promotions).
  - combatDamage **83 -> 79** (source deals damage to you via the Round 60 generic).
  - attack **75 -> 75** (no net move this round; enters-or-combat-damage is ETB-primary).
  - special_runtime also dropped (**61 -> 48**) as overlapping this-way / delayed lines moved to IR.
- Tests: `server/tests/trigger-ir-legacy-r3.test.ts` (plus r1/r2 and spend-mana still pass). UI: none.
- Stayed off statics worker files and `triggerBecomesUnattached.ts`.

### Next legacy families (by lines, after r3)

1. etb (~100) - still mostly dual-event / this-way / named-enters leftovers.
2. combatDamage (~79) - specialized recipients and this-turn delayed damage.
3. attack (~75) - life-compare, exactly-N attackers, owned-but-not-controlled, etc.
4. spellCast (~68) - play-a-card, shrines (upkeep and color spell), this-way casts.
5. death (~60) - dies-or-exiled, put-into-GY-from-anywhere-or-BF, controls-no-other state.
6. special_runtime (~48), then abilityActivated (32), block (22), ltb (19), delayed_rider remainder (16), tap (17).

## Legacy r4

- Inventory before: coveredLegacy **596**. After: **469** (-127). coveredIr **14731** (was 14604).
- Official census: clauses **14359**, IR **13968** (97.3%), legacy fallback **391** (was 13858 / 96.5% / 501). Generated 2026-11-12, 2:56 PM America/New_York.
- tsc: **0** (server `-p server --noEmit`).
- Uncovered triggers unchanged: **5 lines / 5 cards** (Millennium Calendar, Call to Arms, Psychic Battle, Firebender Ascension, City in a Bottle).
- Families migrated (inventory first-detector counts):
  - etb **100 -> 46** (named self-ETB via short-name normalize; generic "enters and whenever/when/at the beginning of"; "enters or <event>"; enters tapped/untapped, during combat, from a zone).
  - combatDamage **79 -> 55** ("with a counter on it" rewrite; your commander deals combat damage; deals damage to you; deals combat damage during your turn; this-turn delayed damage riders).
  - attack **75 -> 62** (one or more creatures attack one of your opponents; an opponent attacks you with N or more creatures; enters-or-attacks / attacks-or-becomes-the-target combiners).
  - spellCast **68 -> 52** ("whenever you play a card"; shrine "upkeep and whenever you cast a COLOR spell"; Staff "cast a COLOR spell or a basic you control enters"; "when you cycle this card").
  - death **60 -> 51** ("when that creature dies" as delayedRider; "dies or is put into exile").
  - special_runtime also dropped slightly (**48 -> 45**); ltb **19 -> 15**, block **22 -> 20**.
- New generics / infrastructure:
  - Legendary short names: "X the Y" (Phage, Acererak, Samwise), "X of Y" / two-word-of (Kiora, Tivadar, Rosie Cotton, General Kudro).
  - Dual-event combiner with `pairedCondition` so the second half can have a different subject (life-gain half of "enters and whenever you gain life", spell half of play-a-card / shrine / staff). `collectMatchingParsedEventLines` matches the paired condition when the current event is the paired event.
  - `entersTapped` / `entersUntapped` checked on the entering subject (`TriggerMatchPermanent.tapped`).
- Tests: `server/tests/trigger-ir-legacy-r4.test.ts` (parse + fires-once; r1-r3 still pass). UI: none.
- Stayed off statics worker files, `client/`, and `triggerBecomesUnattached.ts`.

### Next legacy families (by lines, after r4)

1. attack (~62) - life-compare, attacks-alone, "you attack with...", opponent-attacks-planeswalker leftovers.
2. combatDamage (~55) - specialized recipients, pirate-batch damage, "or an instant or sorcery spell deals damage".
3. spellCast (~52) - mimics (both colors), modal/prepared/X-cost leftovers, this-turn delayed casts.
4. death (~51) - put-into-GY-from-anywhere-or-BF, dies-or-exile-while, controls-no-other state.
5. etb (~46) - turned-face-up, and/or-one-or-more, remaining this-way and qualified ETB.
6. special_runtime (~45), then abilityActivated (32), block (20), delayed_rider (16), tap (16), ltb (15).

## Legacy r5

- Inventory before: coveredLegacy **469**. After: **411** (-58). coveredIr **14789** (was 14731).
- Official census: clauses **14359**, IR **14024** (97.7%), legacy fallback **335** (was 13968 / 97.3% / 391). Generated 2026-11-12, 3:10 PM America/New_York.
- tsc: **0** (server `-p server --noEmit`).
- Uncovered triggers unchanged: **5 lines / 5 cards** (Millennium Calendar, Call to Arms, Psychic Battle, Firebender Ascension, City in a Bottle).
- Families migrated (inventory first-detector counts):
  - attack **62 -> 38** ("When/whenever you or a player attacks with N (or more) creatures"; "two or more creatures (you control) attack"; most life, monarch, more life than you; attacks a player alone).
  - spellCast **52 -> 38** (mimic "that's both COLOR and COLOR" via `colorsAll`; Bolas planeswalker; "when you cast your commander"; this-turn delayed casts; play a land or cast a spell from anywhere other than your hand).
  - combatDamage **55 -> 44** (instant or sorcery / a spell you control deals damage; a source deals damage to another player; one or more Pirates deal damage to a player).
  - etb **46 -> 39** ("this or another ... is turned face up"; enters while the source has a counter (`interveningIf`); "put onto the battlefield this way" as delayedRider).
  - death **51 -> 50** ("dies or is put into exile while its power is N or greater").
  - special_runtime also dropped slightly (**45 -> 44**). abilityActivated stayed at 32; rolls/dilemmas were not promoted without an IR emitter.
- New generics / infrastructure:
  - `parseSelfAndPlayerEvents` "you attack with N" now accepts When or Whenever.
  - `colorsAll` (AND) on the subject filter; `attackedPlayer` monarch / most_life / more_life_than_you; `attackedTargetType` battle / planeswalker; `attacksAlone`, `attacksPlayerAlone`, `exactAttackers`.
  - Attack match context now supplies `playerLives`, `monarchPlayerId`, `attackersAtDefender`, and battle/planeswalker target flags.
  - Printed `attacks` lines that parse as IR own the line even when this event does not match, so leftover "attacks," detectors cannot fire the qualifier as the effect.
- Tests: `server/tests/trigger-ir-legacy-r5.test.ts` (parse + fires-once; r1-r4 still pass). UI: none.
- Stayed off batch90 and the other statics files, mana/token replacement hooks, `client/`, and `triggerBecomesUnattached.ts`.

### Next legacy families (by lines, after r5)

1. death (~50) - put-into-GY-from-anywhere-or-BF, remaining dies-or-exile-while / controls-no-other state.
2. special_runtime (~44) / combatDamage (~44) - dilemma, discard-this-card, explores/connives, specialized damage recipients.
3. etb (~39) - remaining this-way, and/or-one-or-more, qualified ETB.
4. attack (~38) / spellCast (~38) - remaining alone/battle leftovers, modal/prepared/X-cost casts.
5. abilityActivated (32), then block (20), delayed_rider (16), tap (16), ltb (15).

## Legacy r6

- Inventory before: coveredLegacy **411**. After: **328** (-83). coveredIr **14872** (was 14789).
- Official census: clauses **14359**, IR **14066** (98.0%), legacy fallback **293** (was 14024 / 97.7% / 335). Generated 2026-11-12, 3:25 PM America/New_York.
- tsc: **0** (server `-p server --noEmit`).
- Uncovered triggers unchanged: **5 lines / 5 cards** (Millennium Calendar, Call to Arms, Psychic Battle, Firebender Ascension, City in a Bottle).
- Families migrated (inventory first-detector counts):
  - death **50 -> 36** (GY-from-BF-or-elsewhere / Ultron; dies-or-exile-from-BF; dies-or-library; dies-or-command-zone; "you control no other X" with excludeSource).
  - special_runtime **44 -> 17** (dilemmas, opponent-caused self-discard, explores including land/nonland, connives + this-way delayedRider).
  - abilityActivated **32 -> 3** (roll a N / N or M / N or higher / highest natural; crew / saddle-or-crew; opponent activates a non-mana ability; "when you pay this cost" as delayedRider). Remaining leftovers are boast, clash, and shuffle-library.
  - combatDamage **44 -> 39** (damage to a subtype; combat damage to a player or planeswalker; combat damage to a player or dies).
  - etb **39 -> 36** ("and/or one or more other enter"; remaining chosen-type / this-way leftovers).
  - attack **38 -> 35** ("you attack a player / an opponent / the player who has the initiative with one or more X"; attacks while you have the most life).
  - spellCast **38 -> 36** (cast a creature spell of the chosen type / that shares a creature type with the source).
- New generics / infrastructure:
  - `parseRound63Events.ts` hooked from the end of Round 62 (still before r13/r14/r16/r37 LEGACY_ONLY stubs).
  - Rolls, dilemmas, explores, connives, opponent-caused self-discard, crew/saddle, and opponent-activates emit through existing event hooks via `queueParsedActionTriggers` (`performs` / `discards`). Leftover regex paths drop a hit when IR already owns the printed line, so each line fires once.
  - New match fields: `minRoll`, `rollValues`, `highestNatural`, `exploredIsLand`, `sourceMostLife`, `notManaAbility`, `duringMainPhase`, `damageRecipientSubtypes`, `damageRecipient: player_or_planeswalker`, `fromZone: not_battlefield`, `attackedPlayer: initiative`. Context adds `dieSides`, `rollIndexThisTurn`, `revealedIsLand`, `damagedTypeLine`, `inMainPhase`, `isManaAbility`, `initiativePlayerId`.
- Tests: `server/tests/trigger-ir-legacy-r6.test.ts` (parse + fires-once; r1-r5 still pass). UI: none.
- Stayed off the statics files (B91 census classifier / replacement hooks), `client/`, and `triggerBecomesUnattached.ts`. Left ai-selfplay alone.

### Next legacy families (by lines, after r6)

1. combatDamage (~39) - specialized recipients, monarch/this-turn delayed damage, "or an instant or sorcery spell deals damage" leftovers.
2. etb (~36) / death (~36) / spellCast (~36) - remaining this-way and qualified ETB; named/power-death leftovers; modal/prepared/X-cost casts.
3. attack (~35) - remaining alone/battle/mentor/saddled/enchanted leftovers.
4. block (20) - blocks-or-becomes-blocked qualifiers.
5. special_runtime (~17), then tap (16), delayed_rider (16), ltb (15), beginCombat (11), dealtDamage (9). abilityActivated remainder is 3.

## Legacy r7

- Inventory before: coveredLegacy **328**. After: **172** (-156). coveredIr **15028** (was 14872). Under-200 goal met.
- Official census: clauses **14359**, IR **14192** (98.8%), legacy fallback **167** (was 14066 / 98.0% / 293). Generated 2026-11-12, 3:43 PM America/New_York.
- tsc: **0** (server `-p server --noEmit`).
- Uncovered triggers unchanged: **5 lines / 5 cards** (Millennium Calendar, Call to Arms, Psychic Battle, Firebender Ascension, City in a Bottle).
- Families migrated (inventory first-detector counts):
  - combatDamage **39 -> 22** (one or more deal damage; enchanted/renowned/keyword damage; qualified source-you-control damage; damage to you/this/enchanted planeswalker).
  - etb **36 -> 24** (chosen-type ETB; power=toughness / N/N / base power / toughness>power; this or another enters; Aura enters attached; enters not from GY or exile; land during your turn).
  - death **36 -> 24** (dies during your turn; one or more die; enchanted dies; GY from anywhere; this dies or another artifact GY).
  - spellCast **36 -> 13** (even/odd mana value; first/third spell; min targets; spell you do not own; adventure; from exile/GY; using mana from source; X in cost; Aura that targets).
  - attack **35 -> 14** (you attack initiative/enchanted/opponent/player; opponent-attacks variants; saddled; own but do not control; attacks a player and is not blocked; power=toughness / base P/T).
  - block **20 -> 8** (equipped/enchanted blocks or becomes blocked; blocks lesser power).
  - special_runtime **17 -> 5** (mana-tap land/forest/mountain parse-only; you tap an untapped opponent creature; becomes tapped during your turn).
  - abilityActivated **3 -> 0** (boast via performs/boast; clash-and-win via win_clash; shuffle its controller via shuffles_library).
  - also: tap **16 -> 10**, delayed_rider **16 -> 14**, cardDraw **8 -> 2**, beginCombat leftovers promoted (first main / opponent combat beginning). ltb stayed at 15.
- New generics / infrastructure:
  - `parseRound64Events.ts` hooked from the end of Round 63 (still before r13/r14/r16/r37 LEGACY_ONLY stubs).
  - Boast activations collect `performs`/`boast` in `triggerAbilityActivatedTriggers`. Clash reuses `queueParsedKeywordAction(..., 'win_clash')`. Shuffle-its-controller reuses `queueLibraryShuffleTriggers`. Mana-tap is parse-only so leftover tap-detection still fires once.
  - Spell-cast leftover is retired when IR owns the printed line, even when this event does not match (even mana value, first spell).
  - New match fields include `manaValueParity`, `exactColorCount`, `powerEqualsToughness`, `requiresSubjectSaddled`, `minSpellTargets`, phase/death `whoseTurn`, extra `damageRecipient` values, and `fromZone: not_graveyard_or_exile`. Context adds `saddled`, `isEnchanted`, `baseToughness`, `spellManaValue`, and tap `causeControllerId`.
- Tests: `server/tests/trigger-ir-legacy-r7.test.ts` (parse + fires-once; r1-r6 still pass). UI: none.
- Stayed off the statics files (B92), `client/`, and `triggerBecomesUnattached.ts`. Left ai-selfplay alone.

### Next legacy families (by lines, after r7)

1. death (~24) / etb (~24) - remaining combiners (attacks-or-dies, multi-type ETB lists, transforms).
2. combatDamage (~22) - chosen-name this-turn delayed, noncombat equal-to-toughness, "~ or an enchanted creature".
3. ltb (~15) - leaves or becomes untapped; named-or-another leaves.
4. delayed_rider (~14), attack (~14), spellCast (~13).
5. tap (10), dealtDamage (9), block (8), special_runtime (5), landfall (3).

## Legacy r8

Generated 2026-11-12, 4:06 PM America/New_York. ASCII only.

Goal: drive leftover families as close to 0 as cleanly possible (death/etb ~24, combatDamage ~22, ltb 15, delayed_rider 14, attack 14, spellCast 13, tap 10, dealtDamage 9, block 8, special_runtime 5, landfall 3), and add a generic granted-oracle trigger scan so quoted grants (Kosei, Endless Whispers, Aetherspark-style has "<trigger>") fire through IR exactly once and only while the grant applies.

- Inventory before (r7 after): coveredLegacy **172**. After: **64** (-108). coveredIr **15136** (was 15028).
- Official census: clauses **14359**, IR **14295** (99.6%), legacy fallback **64** (was 14192 / 98.8% / 167). Generated 2026-11-12, 3:58 PM America/New_York.
- tsc: **0** (`tsc -p server --noEmit`).
- Tests: `server/tests/trigger-ir-legacy-r8.test.ts` plus r1-r7, **62 passed**. No leftover vitest from this work. Left ai-selfplay alone. Stayed off B93/statics, UI draw/mulligan prompt files (including zonesDrawCards.ts), `client/`, and `triggerBecomesUnattached.ts`.
- Uncovered triggers unchanged: **5 lines / 5 cards** (Millennium Calendar, Call to Arms, Psychic Battle, Firebender Ascension, City in a Bottle).

### Families migrated (inventory first-detector counts, r7 after -> r8 after)

- death **24 -> 4**, etb **24 -> 11**, combatDamage **22 -> 9**, ltb **15 -> 3**.
- delayed_rider **14 -> 11**, attack **14 -> 7**, spellCast **13 -> 3**.
- tap **10 -> 4**, dealtDamage **9 -> 3**, block **8 -> 3**, special_runtime **5 -> 2**, landfall **3 -> 0** as a first family (a few still tagged landfall as a secondary detector).
- Also moved: cardDraw leftovers (except Booby Trap / Zurzoth parent), mill, transform (except Blightsower / Opal Avenger).

Round 65 (`parseRound65Events.ts` + `parseRound65Helpers.ts`) is hooked from the end of Round 64 (still before r13/r14/r16/r37 LEGACY_ONLY stubs). Generic promotions include power-or-toughness-lte dies, dies-during-your-turn, GY-from-battlefield owner/other/legendary filters, OR-type dies/ETB/attacks/damage lists, dual enters-or-dies / attacks-or-dies / transforms-or-enters-transformed, artifact/creature/enchantment ETB, entered-this-turn attacks/damage, exact-two-color and related spell-cast filters, LTB combiners, and delayed this-turn / this-way riders (fail closed on the permanent; parent effects schedule them).

### Granted-oracle trigger scan

- New `server/src/state/modules/triggers/grantedOracleTriggerScan.ts`: `grantedTriggerTextsForPermanent`, `oracleTextWithGrantedTriggers`, `withRecipientOnBattlefieldForGrantScan`.
- Unions statics-pipeline grants (`getContinuousGrantedAbilitiesForPermanent`, persisted, `grantedAbilities`) with a quoted-grant fallback extracted from battlefield oracles (`each creature has "..."`, `has/have "..."`, `as long as COND, NAME has "..."`, attached-has). Does not treat `with "..."` / `gains "..."` (token-create / one-shot) as continuous grants.
- Conditions checked: enchanted, equipped, has a counter, attached to a creature, your turn. Fail closed on unknown as-long-as parts.
- Hooked in `collectMatchingParsedEventLines` (before sentence split), leftover-detector oracle merge, death-text fragments, and a granted-only self-dies IR scan on the dying creature (printed self-dies stay with the live regex). Grants are appended only when they are not already a standalone newline sentence, so a self-grant is not dropped as a substring of the static line.
- Dying recipients are scanned from a last-known battlefield copy so `each creature has` grants still apply as they die.
- Tests: Kosei, Penitent Warlord fires combat-damage IR exactly once only while enchanted, equipped, and has a counter (0 if any condition is missing). Endless Whispers granted self-dies fires once while Endless Whispers is on the battlefield, and 0 after it leaves.

Death leftover is skipped when the source already has an IR-owned dies / put_into_graveyard line (except delayedRider / thisWay / sourceInGraveyard), including the genericDies path, so a filtered IR miss does not get replaced by an unfiltered leftover fire.

### What stays legacy, and why

Aim was as close to 0 as cleanly possible. The remaining **64** are left on leftover (or unparsed) rather than forced into parse-only IR that would retire leftover without a wired emitter or matcher.

State / count / life watchers (no IR state-trigger emitter): Phylactery Lich, Mazemind Tome, Opal Avenger.

Meta "entering causes a triggered ability to trigger": Aboleth Spawn, Strict Proctor.

`fights` has no IR emitter (`fights` is not in IR_EMITTED): Foe-Razer Regent.

Parent-scheduled delayed / this-way / this-combat riders whose mid-clause is unique (excess damage, milled/exiled/attached/put-onto-battlefield/remove-a-counter this way, "either of those creatures this combat"): Rhino's Rampage, Saruman of Many Colors, Thorin, Mountain-king, Augusta, Order Returned, Hans Eriksson, Gilgamesh, Master-at-Arms, Immard, the Stormcleaver, Love on the Battlefield, Lagrella, the Magpie, Galea, Kindler of Hope. Desert Warfare is a sacrifice + GY-from-hand-or-library combiner with a next-end-step rider.

GY-source watchers (IR emitters do not scan the graveyard; a parse would retire leftover and the line would never fire). Name-normalization also rewrites typal "Gate" in Gate Colossus to "this permanent": Gate Colossus.

Combat damage / dealt-damage lines with no matching IR emitter or only a half-parse: Zagras and Hooded Blightfang (damage to a planeswalker), Tephraderm (a spell deals damage to this), Imodane (single-target instant or sorcery damage), Taii Wakeen (noncombat damage equal to toughness), Archfiend of Spite (opponent source to this), Elesh Norn / Flameblade Angel ("to you or a permanent you control" - the permanent half has no existing rewrite target), The Thing (Heroes deal damage), Miss Highwater (player without a contract counter), The Raven's Warning (flying combat damage this turn delayed rider).

Highly unique attack / tap / block / spell / LTB one-offs: Tenuous Truce (you-or-they attack enchanted or a planeswalker), Balthier and Fran (Vehicle crewed by this this turn), Aegis of the Legion (mentors), Booby Trap (chosen player draws the chosen name), Imminent Doom (mana value equal to doom counters), Virtual Assistant (cast using teamwork), Faldorn (spell-from-exile or land-from-exile dual rewrite), Tunnel Ignus (second land under an opponent; matcher field not live on the landfall path), Fear of Sleep Paralysis (ETB and fully unlock a Room), Marvel Boy (ETB and activate a power-up), Share the Spoils (ETB and an opponent loses the game), Pick Up the Pace / Goro-Goro and Satoru (entered this turn - missing leading "a " in the attack pattern / leftover kept until the emitter passes enteredThisTurn), Attuma / Dollmaker's Shop (type attacks a player), Mazzy (enchanted creature attacks one of your opponents), Tui and La (plural become tapped after name-normalization), Darksteel Garrison (fortified land swallowed by the generic self-becomes-tapped rewrite), Powerleech / Artifact Possession (tap or activate without {T}), Extraction Integrant / Righteous Indignation / Zombie Boa (block this / block a color / chosen-color this turn), Lynde (a Curse is put into your graveyard), Zenos yae Galvus / Havengul Mystery (the chosen / put-with-this leaves), Ogre Geargrabber (lose control of that Equipment), Blightsower Thallid (transforms-into-name or dies), Extraplanar Lens (same name as the exiled card is tapped for mana), The Temporal Anchor (put cards on the bottom while scrying), Ezio (short name "Ezio" vs full card name).

Printed parent sentences that also contain a granted "When this dies" quote (inventory still flags the parent as death leftover; token/one-shot `gains "..."` is intentionally not a continuous grant): Clavileno, First of the Blessed; Rivaz of the Claw; Zurzoth, Chaos Rider. Muddle, the Ever-Changing trips an extra attack leftover from the myriad reminder on a spell-cast line.

### Next

The leftover 64 need either a wired emitter/matcher (GY-source, planeswalker damage, state triggers, fights, unlock-a-room) or a rewrite target that already parses without retiring leftover. Do not force them into IR until those paths fire exactly once. Uncovered 5 stay uncovered (no generic family without a new event hook).

## Legacy r9

Generated 2026-11-12, 4:22 PM America/New_York. ASCII only.

Final small round: complete r65 near-misses (identical reparse, missing leading "a " on entered-this-turn attacks, typal name-norm eating "Gate", GY-source ETB scan, dual-half rewrite failure), add fights to IR_EMITTED with an emitter, and promote damage half-parses where an emitter already exists. Only lines that fire exactly once were promoted.

- Inventory before (r8 after): coveredLegacy **64**. After: **53** (-11). coveredIr **15147** (was 15136).
- Official census: clauses **14359**, IR **14305** (99.6%), legacy fallback **54** (was 14295 / 99.6% / 64). Generated 2026-11-12, 4:22 PM America/New_York.
- tsc: **0** (`tsc -p server --noEmit`).
- Tests: `server/tests/trigger-ir-legacy-r9.test.ts` plus r1-r8, **69 passed**. No leftover vitest from this work. Left ai-selfplay alone. Stayed off B94/statics, UI replacement-order files (including the in-progress replacementBatch95CounterReplacements.ts), `client/`, and `triggerBecomesUnattached.ts`.
- Uncovered triggers unchanged: **5 lines / 5 cards** (Millennium Calendar, Call to Arms, Psychic Battle, Firebender Ascension, City in a Bottle).

### What was promoted

- Identical reparse: r64 `blocksSelf` now rewrites to `whenever a creature blocks` + `blockPartnerIsSource` (matcher fail-closed). r65 `dmgToPw` rewrites to combat damage to a player + `player_or_planeswalker`. r65 `selfBecomesTapped` no longer swallows typal phrases (`fortified land`) by treating them as a card name; it accepts `this permanent become[s] tapped` after name-norm (Tui and La).
- Entered-this-turn attacks: the r65 pattern now allows a leading `a ` (`whenever a creature you control that entered this turn attacks`). `permanentToTriggerMatch` copies `enteredThisTurn` from the permanent.
- Typal name-norm: `selfNameNormalize` no longer treats typal type words (land types including Gate, plus artifact/enchantment/spell/card types) as short personal names. `Gate Colossus` no longer rewrites `a Gate you control` to `a this permanent you control`.
- GY-source ETB: r65 `gateGy` rewrites to `a land you control enters`, stamps Gate `groups`/`subtypeGroups`, and sets `sourceInGraveyard`. `appendGraveyardSourceEtbParsedLines` scans graveyards on ETB and queues IR only when `sourceInGraveyard` matches. Landfall leftover is skipped when IR owns an enters/plays_land line so leftover cannot fire on the battlefield while the GY path is the real one.
- Dual-half rewrite: r61 `fromZone` no longer returns null and swallows later dual parses when the subject is `you cast a spell from exile or a land you control`. r62/r64 exile-or-land now rewrite to already-parsed `cast a spell` / `a land you control enters` with `castFromZone`/`fromZone: exile`, and only return when combineDual succeeds (Faldorn). Elesh Norn / Flameblade Angel: the working `deals damage to you` half is stamped `damageRecipient: you_or_permanent_you_control` instead of a failing second-half reparse. Noncombat and combat-to-player emitters pass `causeControllerId` and `damagedPermanentControllerId`. Leftover dealt-damage is skipped when IR owns the line.
- Fights: event `fights` added to the IR type and `IR_EMITTED`. r65 parses `whenever a creature you control fights`. `emitFightsTriggers` runs from `applyFightDamageBetweenCreatures` (every fight path) and queues once per fighting creature.

### What stays legacy, and why

coveredLegacy **53**. These were not force-promoted because there is no wired emitter/matcher that can fire them exactly once, or the wording is a unique one-off:

- State / life / counter watchers: Phylactery Lich, Mazemind Tome, Opal Avenger.
- Meta "entering / attacking causes a triggered ability to trigger": Aboleth Spawn, Strict Proctor, and Firebender Ascension (uncovered).
- Unique delayed / this-way / this-combat parent riders: Rhino's Rampage, Saruman of Many Colors, Thorin, Augusta, Hans Eriksson, Gilgamesh, Immard, Love on the Battlefield, Lagrella, Galea; Desert Warfare.
- Combat / dealt-damage with no matching watcher or only a unique filter: Zagras / Hooded Blightfang still wait on a planeswalker combat-damage *watcher* path (the dmgToPw parse now exists, but the existing combat emitter is source-side). Tephraderm (a spell deals damage to this), Imodane (single-target instant or sorcery), Taii Wakeen (noncombat equal to toughness), Archfiend of Spite (opponent source to this), The Thing (Heroes deal damage), Miss Highwater (no contract counter), The Raven's Warning (flying combat this turn), Ezio (short name vs full name), Goro-Goro and Satoru (entered this turn deal combat damage - attack path was promoted, the damage path was not fire-tested).
- Unique attack / tap / block / spell / LTB one-offs: Tenuous Truce, Balthier and Fran, Aegis of the Legion, Booby Trap, Imminent Doom, Virtual Assistant, Tunnel Ignus, Fear of Sleep Paralysis, Marvel Boy, Share the Spoils, Attuma, Dollmaker's Shop, Mazzy, Darksteel Garrison, Powerleech, Artifact Possession, Righteous Indignation, Zombie Boa, Lynde, Zenos, Havengul Mystery, Ogre Geargrabber, Blightsower Thallid, Extraplanar Lens, The Temporal Anchor.
- Printed parents that also contain a granted `When this dies` quote (`gains "..."` is not a continuous grant): Clavileno, Rivaz, Zurzoth. Muddle still trips an extra attack leftover from the myriad reminder.

### Next

The remaining 53 need emitters or matchers (state triggers, unique this-way riders, planeswalker-damage watchers, unlock-a-room, scry-bottom) before they can be promoted without retiring leftover. Uncovered 5 stay uncovered.
