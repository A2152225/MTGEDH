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

Round 25: the strict audit was recreated (the round 22 script was gone): all 47 exported detect*Trigger(s) functions in state/modules/triggers plus triggered-abilities.ts are called with each of the 993 legacyRuntimeOnly/unparsed clauses as its real card; loose = a returned trigger effect starts with the clause effect (first 12 chars); strict additionally needs, at some call site outside the definition (5000-char window), either no triggerType/timing filter, a literal comparison (===, !==, case) or a substring .includes() hit on that type, or a spellCondition dispatch. Strict 580 / loose 679 / unverified 413. Not directly comparable with round 22 (665/695/328): call-site scoping is stricter, and combat-damage variants checked via regex/startsWith are rejected (likely heuristic false negatives). Runtime added this round: "when you have N or less/more life" state triggers (lifeThresholdStateTriggers.ts, checked in the SBA pass, intervening-if rechecked; Opal Avenger), and spell-cast qualifiers "of the chosen type", "that has an Adventure", "Adventure [instant or sorcery] spell", "Adventure or Dragon spell" (spellCastQualifierTriggers.ts: Vanquisher's Banner no longer fires on any creature; Edgewall Innkeeper, Storyteller Pixie, Lucky Clover, Lozhan now gate/fire correctly).

Round 24: Najal (cost-gated next-cast rider) routed to the legacy pay prompt and the IR on_event next-cast step deferred to the server; "when you have N or less life" now reports triggerType life_threshold so the transform event no longer queues Opal Avenger; forced_discard (Spiritual Focus) fires on opponent-caused discards via causeControllerId.

Round 23: counters_put_on_target now filters by its subject (counterTargetSubject.ts: self names / ~ / this creature, another, type lists, colorless); reveal-the-first-draw this-way triggers fire from getCardDrawTriggers with the drawn card; Sword of Wealth and Power, Thunderclap Drake commander-cast count, Najal paid rider and next-cast replay events fixed. Tests: tests/round23-trigger-runtime.unit.test.ts. The strict audit was not rerun.

Round 21 row is a full rerun with the legacy and unparsed buckets re-split per family: every legacyRuntimeOnly or unparsed clause (riders skipped as in the census) is run, as a one-sentence card, through all 44 exported detect*Triggers functions of the coverage-audit detector modules; a clause counts as legacy-verified if a detector returns a trigger whose payload contains the start of the clause effect, or if its family is queued by a server hook from rounds 18-21 (self-discard, die roll, explores, loyalty, crew, play a land or cast a spell, saddles, connives incl. "when it connives this way", dies during combat, the Adversary pay-this-cost rider). Unlike the round 17 audit, the queueing-getter acceptance check is not applied, so the verified columns are an upper bound (the unparsed split especially: round 17 found 533 verified, this pass 697). Families re-split this round: Sengir "creature dealt damage by this creature this turn dies" (12+4, verified by tests/sengir-family.dealt-damage-dies.integration.test.ts), "when you next cast an instant or sorcery spell this turn" (copy count twice/three times and retargeting now read from the text), "when it connives this way" (now parsed legacyRuntimeOnly and queued by irEventWatchers). Top parsed-no-runtime families: at this turn's next end of combat (4), tap an untapped creature an opponent controls (3), spend this mana to cast a dragon spell (3), cast a creature spell that has an adventure (3), opponent is dealt noncombat damage (3), cast a spell of the chosen type (3).

Round 20 row is a full clause rerun (parseTriggerClause on every Commander-legal clause), split into IR runtime / parsed legacyRuntimeOnly / unparsed; the round 19 estimate collapses to 12716 / 301 / 999, so the rerun confirms it apart from round 20 work: "a spell that's white, blue, black, or red" and "a white, blue, black, or red spell" color lists now parse with every color (Questing Druid, Quirion Dryad; previously Quirion Dryad parsed with only white and a broken effect), and Cathedral Membrane / Mongrel Pack "dies during combat" moved from unparsed to parsed legacyRuntimeOnly with a combat-only runtime check. Tests: tests/trigger-ir-round20-combat.regression.test.ts.

Round 19 row is an estimated per-family delta on round 18, not a rerun: parsed (legacyRuntimeOnly) clauses now queued by server hooks with family tests in tests/trigger-ir-round19.regression.test.ts: play a land or cast a spell (land half) 7, saddles a Mount 2, connives 3 (irEventWatchers.ts). Metropolis Angel "attack with one or more creatures with counters on them" moved from unparsed to IR 1. Die-roll, discard-type, regeneration and leaves-this-turn work changes resolution or effect IR, not trigger clause buckets.

Round 18 row is a per-clause delta on the round 17 audit, not a full rerun: 33 clauses moved because a new event-specific emitter (server/src/state/modules/triggers/eventSpecificLegacyTriggers.ts) queues them, each family covered by a behavioural test on a real card (tests/trigger-ir-round18.regression.test.ts). Parsed (legacyRuntimeOnly): opponent-caused self-discard 8, self-discard 2, roll a N 5, creature you control explores 4, loyalty ability of planeswalker 4, crews a Vehicle 5. Unparsed: Bartered Cow self-discard 1, Nicanzil explores land/nonland 2, cast or cycle ~ (cycle half) 2. The clause-level parse split (13016 / 14016) is unchanged.

Round 9: Clue/Food/Blood/Cartouche/Shrine subjects, "each of your upkeeps/end steps", plural self-names ("~ enter", "~ attack"); turned_face_up, class_level, room_fully_unlocked and controls_none now run through IR emitters. Earlier-round rows were lost when the census script regenerated this file; the script does not keep this section, so re-add it after each run.

Round 22: the audit now applies a getter-acceptance check again: a detector result counts only if a caller of that detector outside its own module either does not filter on triggerType or compares the returned type. Strict verified 665 / loose 695 / unverified 328 of 993 legacy+unparsed clauses. Rejected types: counters_put_on_target (6), reveal_this_way (3), opponent_casts_creature, transform, forced_discard, self_blocks_or_becomes_blocked (2 each), and 13 singletons. Families wired this round: next-cast copy riders from permanent/loyalty abilities, X times / additional time copy counts, MV-capped next cast, "when you next cast a spell this turn" effect riders, opponent dealt noncombat damage, you tap an untapped creature an opponent controls.
