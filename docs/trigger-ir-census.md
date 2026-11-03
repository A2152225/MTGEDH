# Trigger IR census (TRIGGER_PRIMARY coverage)

Generated 2026-10-25T15:14:48.953Z by `npm run census:triggers` (server/scripts/trigger-ir-census.ts).

A clause counts as IR when `parseTriggerClause` returns a condition and an effect; otherwise
it falls back to the legacy family detectors. Unique Commander-legal oracle cards; each face scanned.

| Metric | Count |
|---|---|
| Commander-legal cards with trigger clauses | 12223 |
| Trigger clauses | 14016 |
| Parsed by trigger IR | 13023 (92.9%) |
| Legacy fallback | 993 (7.1%) |
| Reflexive/delayed riders excluded ("when you do", "next end step") | 343 |

## Top 30 legacy-fallback wordings (by cards affected)

| # | Trigger condition | Cards | Clauses | Examples |
|---|---|---|---|---|
| 1 | whenever you cast a permanent spell using mana produced by ~ | 2 | 2 | The Everflowing Well // The Myriad Pools; Brass's Tunnel-Grinder // Tecutlan, the Searing Rift |
| 2 | when you next cast an instant or sorcery spell with mana value N or less this turn | 2 | 2 | Gadwick's First Duel; Dual Strike |
| 3 | whenever another artifact is put into your graveyard from the battlefield or an artifact card is put into your graveyard from anywhere other than the battlefield | 2 | 2 | Ultron the Annihilator; Ultron's Auxiliary |
| 4 | whenever a creature you control deals combat damage to a player this turn | 2 | 2 | The Girl in the Fireplace; Surge to Victory |
| 5 | whenever you cast a spell that has convoke | 2 | 2 | Joyful Stormsculptor; Saint Traft and Rem Karolus |
| 6 | whenever you cast an instant or sorcery spell that targets only this creature | 2 | 2 | Reflective Golem; Beamsplitter Mage |
| 7 | whenever this creature or another creature you control is turned face up | 2 | 2 | Printlifter Ooze; Experiment Twelve |
| 8 | whenever a creature deals damage to you | 2 | 2 | Aurification; No Mercy |
| 9 | whenever you reveal an instant or sorcery card this way | 2 | 2 | God-Eternal Kefnet; Inquisitor Eisenhorn |
| 10 | whenever you gain or lose life during your turn | 2 | 2 | Wax-Wane Witness; Moonstone Harbinger |
| 11 | when damage is prevented this way | 2 | 2 | New Way Forward; Phyrexian Vindicator |
| 12 | whenever that creature deals combat damage to a player this turn | 2 | 2 | Azra Oddsmaker; Captain Howler, Sea Scourge |
| 13 | whenever two or more creatures you control attack a player | 2 | 2 | Landroval, Horizon Witness; Horn of the Mark |
| 14 | whenever an opponent draws a card except the first one they draw in each of their draw steps | 2 | 2 | Leela, Sevateem Warrior; Xyris, the Writhing Storm |
| 15 | whenever a player wins a coin flip | 2 | 2 | Zndrsplt, Eye of Wisdom; Okaun, Eye of Chaos |
| 16 | whenever a creature you control that's enchanted or equipped attacks | 2 | 2 | Dogmeat, Ever Loyal; Reyav, Master Smith |
| 17 | whenever you cast your third spell each turn | 2 | 2 | Emeritus of Conflict // Lightning Bolt; Captain Ripley Vance |
| 18 | when this creature has flying | 2 | 2 | Student of Elements // Tobita, Master of Winds; Floodgate |
| 19 | when this artifact enters and when you sacrifice it | 2 | 2 | Carrot Cake; Heaped Harvest |
| 20 | whenever the final chapter ability of a saga you control resolves | 2 | 2 | Narci, Fable Singer; Tom Bombadil |
| 21 | whenever a source an opponent controls deals damage to you or a permanent you control | 2 | 2 | Elesh Norn // The Argent Etchings; Flameblade Angel |
| 22 | whenever you attack with your commander | 2 | 2 | W'Kabi, Shield of the Nation; Jocasta, Automaton Avenger |
| 23 | whenever one or more cards are put into a library from anywhere | 2 | 2 | Wan Shi Tong, All-Knowing; Dutiful Knowledge Seeker |
| 24 | whenever you or a permanent you control becomes the target of a spell or ability an opponent controls | 2 | 2 | Rayne, Academy Chancellor; Parnesse, the Subtle Brush |
| 25 | when this card becomes plotted | 2 | 2 | Longhorn Sharpshooter; Aloe Alchemist |
| 26 | whenever you play a card | 2 | 2 | Null Profusion; Recycle |
| 27 | when you have N or more life | 2 | 2 | Rune-Tail, Kitsune Ascendant // Rune-Tail's Essence; Transcendence |
| 28 | whenever this creature attacks the player with the most life or tied for most life | 2 | 2 | Preacher of the Schism; Undercover Butler |
| 29 | whenever one or more creatures you control deal combat damage to one or more players | 2 | 2 | The Destined Thief; Contaminant Grafter |
| 30 | when enchanted creature attacks or blocks | 2 | 2 | Primal Cocoon; Cunning |

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
- Self-name short form: two-word personal names (e.g. "Dáin Ironfoot" -> "Dáin") are now recognized as self references unless the first word is a creature type (e.g. "Goblin Guide"). Heuristic: newly parsed clauses not fully audited for false positives.
- Not done (need new emitters): coin-flip triggers, "a creature deals damage to you", "that's enchanted or equipped".
- Tests: `server/tests/trigger-ir-round44.test.ts`.
