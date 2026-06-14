# Oracle IR Session Handoff

Last updated: 2026-06-14 (Track D complete; Track E — see [oracle-ir-track-e-remaining-work.md](./oracle-ir-track-e-remaining-work.md))

## Next session

**Track D is done** (`unsupported_condition_clause` **0**). Continue **Track E** — targets, object selectors, `ir_gap`, amounts. Full baseline and copy-paste prompt: **[oracle-ir-track-e-remaining-work.md](./oracle-ir-track-e-remaining-work.md)**.

Quick metrics (`full_card` audit 2026-06-14): assisted **98.4%** (47215/47969); parse→execute gaps **622**; top codes: `no_deterministic_target` (190), `unsupported_object_selector` (162), `unsupported_target` (99).

## What was completed this session

### Track D — Executor gap closure (batch 380 — final 27 clusters) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | Remaining 27 handlers: Oscorp Mayhem discard, Impromptu Raid, Foundry Helix artifact, Teferi ETB-as-creature, Cinder Cloud white death, Nasty End legendary, Dose main phase, Rith excess damage, Kazuul defending player, Jared all-colors, Barrin hand-from-BF, Creakwood elf/-1/-1, Invoke Despair they can't, Unforge equipment, Grinning Totem unplayed, Jadar no decayed, Chain Veil loyalty, Haphazard aim, Tainted Specter discard-this-way, Book life loss, Agni Kai fight excess, Prisoner's silence/snitch, Ayara +1/+1, Polis monstrous, Test of Endurance 50 life + more | `oracleIRExecutorConditionalStepSupportBatch380Bulk.ts` |
| **Unless inner** | Tainted Specter `they put a card from their hand on top of their library` | `oracleIRExecutorConditionalStepSupport.ts` |
| **Extended** | Tainted Specter full-sentence parser stub; batch380 wiring | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Audit fixtures** | Full batch380 cluster enrich block + unless put-on-top choice | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch380.test.ts` (3) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **27 → 0**; assisted **98.4%** (47214/47969) | `executor-coverage-audit.json` |
| **Gap analysis** | **0** gap items / **0** unique clusters | `executor-fullcard-condition-gap-analysis.json` |

**Track D condition-clause backlog: cleared.** Remaining executor gaps are other reason codes (targets, selectors, amounts, etc.).

**Cumulative from post-367 baseline (501): −501 condition-clause gaps** across batches 368–380 + cleanup.

### Track D — Executor gap closure (batch 379 — 36 clusters mega-batch) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | ~36 handlers: Breathless Knight GY entry, Filigree blue/black, Vault votes, Evolving Adaptive P/T, Land Grant hand, Deicide God, Taigam attack, Lightning Phoenix damage, Gore Vassal toughness, Urborg nonblack, Recalibrate discard, Wall damage, Defense of Heart creatures, Earthbind flying, Kellan Scout, Nimble Trapfinder party, Bottle-Cap excess permanent, Wisecrack attacking, Invert the Skies {G}/{U}, Wilhelt decayed, Runaway Steam-Kin counters, Might Makes Right power tie, Syrix gy leave, Magnanimous MV, Conduit no cast, Desertion counter, Triskaidekaphile 13 hand, Rite +1/+1 had, Pulse life, Dauthi replacement, Sandstalker blue/black spell, Cobra Trap destroy, Avacyn madness, Gunner enchanted/equipped, Gisela/Bruna meld + more | `oracleIRExecutorConditionalStepSupportBatch379Bulk.ts` |
| **Extended** | Invert the Skies compound modify_pt stub; Kellan Scout parser stub; batch379 wiring | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Audit fixtures** | Full batch379 cluster enrich block | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch379.test.ts` (4) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **63 → 27** (−36); assisted **98.4%** (47195/47969) | `executor-coverage-audit.json` |
| **Gap analysis** | **25** gap items / **27** unique clusters | `executor-fullcard-condition-gap-analysis.json` |

**Next batch 380 targets** (post-379 — run gap analysis for fresh list):
1. `you discarded it this turn` (Oscorp Industries / Mayhem)
2. `it isn't a creature card` (Impromptu Raid)
3. `the sacrificed permanent was an artifact` (Foundry Helix)
4. `it enters as a creature` (Teferi's Time Twist)
5. `a white creature dies this way` (Cinder Cloud)
6. `the sacrificed creature was legendary` (Nasty End)
7. `it isn't your main phase` (Dose of Dawnglow)
8. `a creature or planeswalker an opponent controlled was dealt excess damage this turn` (Rith)

**Cumulative from post-367 baseline (501): −474 gaps** across batches 368–379 + cleanup.

### Track D — Executor gap closure (batch 378 — 36 clusters mega-batch) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | ~36 handlers: quest present tense (`it has four or more`), Burrog/Savage modify_pt inners, Cut Propulsion flying, Once Upon a Time first spell, Breena opponent life, Artificer's Hex equipment, Spiders-Man web-slinging, Reaper hand size, Archive Trap search, Soulflayer delve flying, Lumengrid artifact discard, Bloodchief life/quest, Spire guess, Valakut exiled cards, Baba Lysaga card types, Sidequest creature death, Nefarious Lich damage redirect, Queen Marchesa monarch, Foreboding omen, Botanical Brawler first +1/+1, Hellish Vehicle, Warren Goblin, Ingenious Mastery alt cost, Dreampod enchanted, Necromancer zombie discard, Ashnod sacrifice-to-activate, Rowan draws, Rekindled empty hand, Mirkwood not attacking you, Urza meld, Thirsting Axe combat damage, Barren Glory composite, Ravenous Trap GY cards + more | `oracleIRExecutorConditionalStepSupportBatch378Bulk.ts` |
| **Extended** | batch378 wiring (after batch377); Burrog/Savage now handled via inner-clause bulk, not full-sentence stubs | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Audit fixtures** | Full batch378 cluster enrich block (incl. modify_pt inners, quest on source, meld pair, composite Barren Glory) | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch378.test.ts` (4) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **100 → 63** (−37); assisted **98.3%** (47167/47969) | `executor-coverage-audit.json` |
| **Gap analysis** | **61** gap items / **63** unique clusters | `executor-fullcard-condition-gap-analysis.json` |

**Next batch 379 targets** (post-378 — run gap analysis for fresh list):
1. `that creature entered from a graveyard or you cast it from a graveyard` (Breathless Knight)
2. `that permanent was blue or black` (Filigree Fracture)
3. `no creature got votes` (Vault 11: Voter's Dilemma)
4. `that creature has greater power or toughness than this creature` (Evolving Adaptive)
5. `you have no land cards in hand` (Land Grant)
6. `the exiled card is a God card` (Deicide)
7. `this permanent attacked this turn` (Taigam, Ojutai Master)
8. `an opponent was dealt 3 or more damage this turn` (Lightning Phoenix)

**Cumulative from post-367 baseline (501): −438 gaps** across batches 368–378 + cleanup.

### Track D — Executor gap closure (batch 377 — 36 clusters mega-batch) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | ~36 handlers: Desperate Plea sacrifice power, Peer Pressure type count, Barrin's Unmaking color mode, Razor Pendulum life, Azor's Gateway exiled MVs, Otherworldly Escort not Spirit, Wumpus {C}, Paragon 3-color activate, Darigaaz egg, outlaw/saproling-adjacent, Guiding Spirit gy top, Airbender quest, Balance of Power hand, Ever-Watching attack, Riders attacked, Septic poison, Naktamun hand, Waking the Trolls lands, Needlebite life gain, Scrying Glass reveal, Portent protect, Kodama/Beseech cast path, Fractal/Security/Lunar, Lux 30 counters, Wave combat damage, Massacre toughness, Sygg life loss, Master of the Hunt wolves, Impending Disaster lands, Glitch face-down + more | `oracleIRExecutorConditionalStepSupportBatch377Bulk.ts` |
| **Audit fix** | Rush `{E}{E}` unless enrich on `unlessCondition.raw` (`you pay {E}{E}`) | `executor-coverage-audit.ts` |
| **Extended** | Burrog Barrage / Savage Swipe compound modify_pt stubs; batch377 wiring | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Audit fixtures** | Full batch377 cluster enrich block | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch377.test.ts` (4) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **132 → 100** (−32); assisted **98.3%** (47134/47969) | `executor-coverage-audit.json` |
| **Gap analysis** | **97** gap items / **99** unique clusters | `executor-fullcard-condition-gap-analysis.json` |

**Next batch 378 targets** (post-377 — run gap analysis for fresh list):
1. `it has four or more quest counters on it` (Firebender/Waterbender Ascension — present tense vs batch377 past)
2. Burrog Barrage / Savage Swipe compound modify_pt (inline condition on step)
3. `that creature has flying` (Cut Propulsion)
4. `this spell is the first spell you've cast this game` (Once Upon a Time)
5. `that opponent has more life than another of your opponents` (Breena)
6. `enchanted Equipment is attached to a creature` (Artificer's Hex)
7. `they were cast using web-slinging` (Spiders-Man)
8. `defending player has two or fewer cards in hand` (Reaper of Night)

**Cumulative from post-367 baseline (501): −401 gaps** across batches 368–377 + cleanup.

### Track D — Executor gap closure (batch 376 — 36 clusters mega-batch) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | ~36 handlers: historic, Biblioplex land creature, Opal Palace commander mana, Titan Hunter, Thoughtbound Primoc, Sentinel's Mark, Guildmages' Forum multicolor, Vikya excess damage, Elanor Food, Cosmic Rebirth MV, modal costs ({1}{B}/{3}{G}/{2}{R}{R}), time counters, combat phase, Imaginary Pet hand, bidding, madness, Sidar Jabari, Kitsune auras, werewolf damage, Multiple Choice X, toxic enchanted, Bankbuster vehicle, Ultros 8 mana, Proft draws, Deadly Brew sacrifice, Galadriel elf ETB, Thallid saproling, Grisly noncombat, Celestial Reunion, Kaito, Lightning Coils + more | `oracleIRExecutorConditionalStepSupportBatch376Bulk.ts` |
| **Batch375 fix** | `it had mana value 3 or less` zone lookup (Consuming Ashes audit) | `oracleIRExecutorConditionalStepSupportBatch375Bulk.ts` |
| **Unless inners** | Skullscorch deal-damage; Liberty Prime / Rush `{E}{E}` energy | `oracleIRExecutorConditionalStepSupport.ts` |
| **Extended** | Parser-gap stubs for Rush of Inspiration + Skullscorch full unless; batch376 wiring; `lastExcessDamageDealtThisWay` destructuring | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Audit fixtures** | Full batch376 cluster enrich block | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch376.test.ts` (4) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **169 → 132** (−37); assisted **98.2%** (47105/47969) | `executor-coverage-audit.json` |
| **Gap analysis** | **129** gap items / **132** unique clusters | `executor-fullcard-condition-gap-analysis.json` |

**Next batch 377 targets** (post-376 — run gap analysis for fresh list):
1. `Draw two cards. Then discard a card at random unless you pay {E}{E}` (Rush of Inspiration — parser unless shape)
2. `its power is less than or equal to the sacrificed creature's power` (Desperate Plea)
3. `you control more creatures of that type than each other player` (Peer Pressure)
4. `that permanent shares a color with the most common color…` (Barrin's Unmaking)
5. `that player has 5 or less life` (Razor Pendulum)
6. `cards with five or more different mana values are exiled with this permanent` (Azor's Gateway)
7. `it's not a Spirit` (Otherworldly Escort)
8. `{C} wasn't spent to cast it` (Wumpus Aberration)

**Cumulative from post-367 baseline (501): −369 gaps** across batches 368–376 + cleanup.

### Track D — Executor gap closure (batch 375 — 36 clusters mega-batch) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | ~36 handlers: Graf Rats meld, Tyrannic War `{X}`, Squall chosen number, Lifecraft/Dual-Sun counters, Chance Encounter luck, Feast/Tunnel/Galadriel/Turf War, Ventifact/Witch's Oven/Mask, Wonderscape unless, Break Out/Rhino/discarded/Clowning/Galvanize/Battle of Wits, Sundering/Agadeem/monarch/Shadowbane/devotion, Consuming/Candles/Grab/Mother Lode/Profane, Adaptive/Ob Nixilis/Brimaz/Raggadragga/Arclight/Spellpyre + Sarulf audit | `oracleIRExecutorConditionalStepSupportBatch375Bulk.ts` |
| **Unless inner** | `that land had a nonbasic land type` (Wonderscape Sage) | `oracleIRExecutorConditionalStepSupport.ts` |
| **Extended** | Wonderscape draw-step parser stub; batch375 wiring | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Audit fixtures** | Full batch375 cluster enrich block | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch375.test.ts` (4) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **206 → 169** (−37); assisted **98.1%** (47069/47969) | `executor-coverage-audit.json` |
| **Gap analysis** | **166** gap items / **169** unique clusters | `executor-fullcard-condition-gap-analysis.json` |

**Next batch 376 targets** (post-375 — run gap analysis for fresh list):
1. `it was historic` (Curator's Ward)
2. `this land isn't a creature` (Great Hall of the Biblioplex)
3. `you spend this mana to cast your commander` (Opal Palace)
4. `no creatures died this turn` (Titan Hunter)
5. `a player controls more Wizards than each other player` (Thoughtbound Primoc)
6. `that mana is spent on a multicolored creature spell` (Guildmages' Forum)
7. `excess damage was dealt to a creature this way` (Vikya)
8. `you sacrificed a Food this turn` (Elanor Gardner)

**Cumulative from post-367 baseline (501): −332 gaps** across batches 368–375 + cleanup.

### Track D — Executor gap closure (batch 374 — 36 clusters mega-batch) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | ~36 handlers + audit fixtures: Unnerving Assault stub, draft/convergence, Deathbringer/Tablet/Invasion/Guildsworn/Satoru/Dega, Fiery Gambit flips, angel/mana riders, Happily Ever After, Kami/Puppeteer/Dart, Historian/Lesson, kicked/shadowborn, quest/Bane/vehicle/Firkraag/heads, land discard/judgment/inferno/luminarch, infect/Hurkyl/wingsmith/sacrifice/exile/delay/milled/human/blocked + more | `oracleIRExecutorConditionalStepSupportBatch374Bulk.ts` |
| **Extended** | Unnerving Assault parser-gap stub; improved `thisWay` exiled-creature + milled-share-type; batch374 wiring | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Audit fixtures** | Full batch374 cluster enrich block (incl. batch373 handlers missing fixtures) | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch374.test.ts` (4) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **263 → 206** (−57); assisted **98.1%** (47037/47969) | `executor-coverage-audit.json` |
| **Gap analysis** | **203** gap items / **206** unique clusters (post-audit; Unnerving compound `{U}/{R}` fix applied after) | `executor-fullcard-condition-gap-analysis.json` |

**Next batch 375 targets** (post-374 gap analysis — run `executor-fullcard-condition-gap-analysis.ts` for fresh list):
1. Remaining count-1 clusters from gap analysis tail (compound/modal/parser gaps)
2. `you both own and control this creature and a creature named Midnight Scavengers` (Graf Rats meld)
3. `its mana cost contains {X}` (First Tyrannic War saga)
4. `any of those creatures have power or toughness equal to the chosen number` (Squall)
5. `this enchantment has ten or more luck counters on it` (Chance Encounter)
6. `you chose a creature other than Galadriel as your Ring-bearer`
7. `that player controls one or more lands with contested counters on them` (Turf War)

**Cumulative from post-367 baseline (501): −295 gaps** across batches 368–374 + cleanup.

### Track D — Batch 373 cleanup (post-mega-batch tighten) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Unless inner routing** | Early `resolveUnlessPayInnerCondition` for parser `kind:'if'` unless inners (`you waterbend {2}`, historic exile, land bounce) | `oracleIRExecutorConditionalStepSupport.ts` |
| **Ref/subject lookup** | Hand/graveyard/exile/library + `lastMovedCards` fallback for `getReferencedObject` / `getConditionalSubjectCard` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Exile priority** | Player-zone `that card` exile before stack spell when chosen hand card bound (Soul Search) | `oracleIRExecutorBattlefieldStepHandlers.ts` |
| **Mana value** | Zone lookup fallback when exiled card lacks inline `cmc` | `oracleIRExecutorConditionalStepSupportBatch372Bulk.ts` |
| **Audit fixtures** | `needsRevealExileChain`; fewer-creatures enrich preserves life totals; unless/discard/move_zone enrich gate | `executor-coverage-audit.ts` |
| **Re-audit** | `unsupported_condition_clause` **271 → 263** (−8); assisted **98.0%** (46986/47969) | `executor-coverage-audit.json` |
| **Gap analysis** | **259** gap items / **264** unique clusters | `executor-fullcard-condition-gap-analysis.json` |

**Closed in cleanup:** Waterbending Lesson, Urza's Tome, Tragic Lesson (unless inners); Guardian Project (name uniqueness); Sold Out / Meticulous Excavation (target ctx); Soul Search (exile + MV); Timely Reinforcements (life comparison).

**Next batch 374 targets** (post-cleanup gap analysis):
1. Unnerving Assault compound `{U}/{R}` (top cluster — parser)
2. Animus of Predation draft clause
3. Deathbringer Regent cast-from-hand + creature count
4. Tablet of the Guilds chosen-colors check
5. Invasion of Fiora combat-damage-since-last-turn
6. Guildsworn Prowler `it wasn't blocking`
7. Satoru `none of them were cast or no mana was spent`
8. Dega Sanctuary black/red permanent composite

**Cumulative from post-367 baseline (501): −238 gaps** across batches 368–373 + cleanup.

### Track D — Executor gap closure (batch 373 — 36 clusters mega-batch) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | ~36 handlers: rampage, Timely Reinforcements, Sokenzan hand leader, dragon mana, exiled-with-it, Gleeful/Fang/Honorable/Slingbow/Anchor/Inferno/Avatar/Journey/Dust Stalker/Relic Runner/Sold Out/Swashbuckler/Teachings/Chirography/Blasphemous/unearth/Wolverine/Prodigy/Phoenix Fleet/Wild Dogs/Sigil Captain + more | `oracleIRExecutorConditionalStepSupportBatch373Bulk.ts` |
| **Audit fix** | Widened condition enrich to `modify_pt`, `draw`, `destroy`, `exile` steps (closes Wolf Strike parser-gap cluster) | `executor-coverage-audit.ts` |
| **Extended** | batch373 wiring | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch373.test.ts` (4) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **306 → 271** (−35); assisted **97.9%** (46978/47969) | `executor-coverage-audit.json` |
| **Gap analysis** | **267** gap items / **272** unique clusters | `executor-fullcard-condition-gap-analysis.json` |

*(Superseded by cleanup re-audit above: 263 / 259 items / 264 clusters.)*

### Track D — Executor gap closure (batch 372 — 36 clusters mega-batch) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | ~45 handlers: enlisted/warp/defending-hand/no-LTB/named-spells/guardian-project/first-strike/revival/delirium/growth/Fang-meld/council-votes/parser full-text stubs, plus clusters 38–49 (arrowhead, Nissa, Ertai, River Song, Cryptolith, Dance with Calamity, Oloro, Portcullis, zombie combat, enchanted, freerunning, Visions) | `oracleIRExecutorConditionalStepSupportBatch372Bulk.ts` |
| **Main** | `you do and your opponent guessed wrong` (Liar's Pendulum composite) | `oracleIRExecutorConditionalStepSupport.ts` |
| **Extended** | `would be destroyed`, `would counter a spell`, `would cause you to draw`; batch372 wiring | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Audit fixtures** | Full batch372 cluster enrich block | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch372.test.ts` (4) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **349 → 306** (−43); assisted **97.9%** (46947/47969) | `executor-coverage-audit.json` |
| **Gap analysis** | **301** gap items / **307** unique clusters | `executor-fullcard-condition-gap-analysis.json` |

### Track D — Executor gap closure (batch 371 — 36 clusters mega-batch) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | ~35 handlers: power thresholds, damage taken, white permanents, opponent ETB, Edgar lookup, land counts, second spell, wolves/werewolves, hand size, anticognition GY, avatar lands, tapped/suspected/warp/madness, sanctuary colors, etc. | `oracleIRExecutorConditionalStepSupportBatch371Bulk.ts` |
| **Main** | `it was attacking` lastMovedCards fallback; didn't enter BF; no indestructible counter; not suspected | `oracleIRExecutorConditionalStepSupport.ts` |
| **Extended** | thisWay: instant/flash exiled, instant/sorcery discarded, {E} paid, nonland return, excess damage; `would lose life`; `this spell's surge cost`; batch371 wiring | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Audit fixtures** | Full batch371 cluster enrich block | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch371.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **389 → 349** (−40); assisted **97.8%** (46912/47969) | `executor-coverage-audit.json` |

**Cumulative from post-367 baseline (501): −195 gaps** across batches 368–372.

### Track D — Executor gap closure (batch 370 — 36 clusters mega-batch) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | ~30 handlers: compound X+destroy, O-Kagachi attack, Tithe lands, tomb dungeon, another-subtype generic, mana-from-creatures, instant/sorcery cast, soul MV, suspected sacrifice, enchanted untapped/red, etc. | `oracleIRExecutorConditionalStepSupportBatch370Bulk.ts` |
| **Main** | `it isn't a token`, `he/she was cast`, `his sneak cost`, parseSmallNumberWord 13–20, blue/black OR guard | `oracleIRExecutorConditionalStepSupport.ts` |
| **Extended** | `would mill` stub; `it's not that player's turn`; batch370 wiring | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Audit fixtures** | Full batch370 cluster enrich block | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch370.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **433 → 389** (−44); assisted **97.7%** (46877/47969) | `executor-coverage-audit.json` |

**Next batch 371 targets** (count-1 clusters from post-370 gap analysis):
1. `it was attacking` (Desculpting Blast — parser/audit alignment)
2. `that creature's power is 4 or greater` (Aradesh follow-on)
3. `a +1/+1 counter was put on a permanent under your control this turn` (Fairgrounds Trumpeter)
4. `you were dealt 4 or more damage this turn` (Boarded Window)
5. `this creature didn't enter the battlefield this turn` (Cactuar)
6. `all nonland permanents you control are white` (Zealots en-Dal)
7. `a creature entered the battlefield under an opponent's control this turn` (Lictor)
8. `an instant card or a card with flash is exiled this way` (Check for Traps)
9. `Edgar is in the command zone or on the battlefield` (Edgar Markov)

(Top cluster remains Unnerving Assault compound `{U}/{R}` — parser batch. Parser gaps: Wolf Strike, Waterbending Lesson, Faerie Fencing full-effect-as-condition.)

### Track D — Executor gap closure (batch 369 — 36 clusters mega-batch) ✅

Parallel sub-agents researched clusters 2–37 (skipped Unnerving Assault compound #1). New bulk module + audit fixtures for batch368 carryover gaps.

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | ~26 new handlers: life thresholds, drizzt/source power, land GY, defending player scans, wall-only blocking, type/color OR clauses, draw count, initiative disjunction, spectacle, mana ability tracker, etc. | `oracleIRExecutorConditionalStepSupportBatch369Bulk.ts` |
| **Extended** | `a creature card is put into a graveyard this way`; batch369 wiring | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Main guards** | splitComposite OR/AND exceptions (green/white, goblin or orc, initiative, wall blocking); initiative disjunction handler | `oracleIRExecutorConditionalStepSupport.ts` |
| **Audit fixtures** | Batch368 carryover + all batch369 clusters | `executor-coverage-audit.ts` |
| **Tests** | `oracleIRGapBatch369.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **467 → 433** (−34); assisted **97.6%** (46835/47969) | `executor-coverage-audit.json` |

**Next batch 370 targets** (count-1 clusters from post-369 gap analysis):
1. `X is 5 or more, for each artifact destroyed this way` (Red Sun's Twilight — compound AND)
2. `that player attacked you during their last turn` (O-Kagachi)
3. `you win, at the beginning of your next main phase` (Scattering Stroke)
4. `target opponent controls more lands than you` (Tithe)
5. `you haven't completed Tomb of Annihilation` (Acererak)
6. `that library contains exactly the chosen number of cards with the chosen name` (Mindblaze)
7. `it enlisted a creature this combat` (Aradesh)
8. `it isn't a token` (Gruff Triplets)
9. `you control another Spirit` (Apothecary Geist)

(Top cluster remains Unnerving Assault compound `{U}/{R}` — parser batch.)

### Track D — Executor gap closure (batch 368 — 36 clusters mega-batch) ✅

Parallel sub-agents researched 36 count-1 clusters; implementation landed in a dedicated bulk module plus main/extended splitComposite guards.

| Item | Change | Key files |
|------|--------|-----------|
| **Bulk module** | ~30 generic handlers: mana spend `{W}{U}`/`{U}{B}`, Padeem MV tie, mining counters, ETB counts, starting life, sacrifice color, wasn't-subtype, meld, islands, snow, Grim Reminder spell-name (approx), etc. | `oracleIRExecutorConditionalStepSupportBatch368Bulk.ts` |
| **Main guards** | splitCompositeCondition exceptions (god/demigod, Padeem MV, spider-man non-hand, etc.); graveyard count; `no player does`; sacrificed color; wasn't-subtype; snow top-card | `oracleIRExecutorConditionalStepSupport.ts` |
| **Extended wiring** | Early call to `evaluateBatch368BulkConditionalClause` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Regression fix** | Restored accidentally dropped `you do` handler (had caused audit spike to 1433) | Main |
| **Tests** | `oracleIRGapBatch368.test.ts` (7) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **501 → 467** (−34); assisted **97.6%** (46806/47969) | `executor-coverage-audit.json` |

**Still open from batch 368 scope** (audit fixtures or per-opponent wiring):
- Unnerving Assault compound `{U}/{R}` (parser batch — skipped)
- Grim Reminder per-opponent filter (`each opponent who cast…`) — boolean stub only
- A few count-1 clusters still in gap analysis (Assassin attack, legendary sacrifice, nonred damage, etc.) — verify audit fixtures vs handler exact-match

**Next batch 369 targets** (count-1 clusters from post-368 gap analysis):
1. `each opponent who cast a spell this turn with the same name as that card` (Grim Reminder — per-opponent)
2. `they were attacked this turn by an Assassin you controlled` (Ramses)
3. `the sacrificed artifact was legendary` (Splitting the Powerstone)
4. `a nonred permanent is dealt damage this way` (Redcap Melee)
5. `your life total is less than 7` (Elderscale Wurm)
6. `it had power greater than Drizzt's power` (Drizzt Do'Urden)
7. `a land you controlled was put into a graveyard from the battlefield this turn` (The Lady of Otaria)
8. `defending player controls no Walls` (Siege Dragon)
9. `you have exactly 13 life` (Jerren)

(Top cluster remains Unnerving Assault compound `{U}/{R} was spent` — parser/evaluator batch.)

### Track D — Executor gap closure (batch 367 — 9 clusters) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Modified creature** | `it's modified` via counters + equipment + controller-owned auras | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **No subtype** | Generic `you control no {subtype}s` (Stenchskipper / Goblins) | Extended |
| **GY from BF this turn** | `an artifact or creature was put into a graveyard from the battlefield this turn` state flag | Extended + splitCompositeCondition guard |
| **No colored mana** | `no colored mana was spent to cast it` via `manaSpentBreakdown` / `manaColorsSpent` | Extended |
| **She was** | `she was a nonland creature` pronoun + type descriptor | Extended |
| **Mad Dog composite** | `this creature didn't attack or come under your control this turn` + splitCompositeCondition guard | Main |
| **Mutate on cast** | `it has mutate` via stack spell oracle/keywords | Extended |
| **White or blue** | `you control a white or blue permanent` color scan + splitCompositeCondition guard | Extended |
| **Not kicked (creature)** | `this creature wasn't kicked` added to existing negated-kick block | Main |
| **Tests** | `oracleIRGapBatch367.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **514 → 501** (−13); assisted **97.5%** (46774/47969) | `executor-coverage-audit.json` |

**Next batch 368 targets** — ✅ completed in mega-batch 368 (see above).

~~1. `the token is an Aura` (Yenna, Redtooth Regent)~~
2. `{W}{U} was spent to cast this spell` (Mythos of Vadrok)
3. `eight or more cards are in your graveyard` (Sidequest: Card Collection)
4. `you control the artifact with the greatest mana value or tied for the greatest mana value` (Padeem)
5. `there are no mining counters on this land` (Gemstone Mine)
6. `three or more artifacts entered the battlefield under your control this turn` (Malcator)
7. `your life total is less than your starting life total` (Resolute Archangel)
8. `the sacrificed creature was black` (Lyzolda)
9. `it wasn't a Demon` (Infernal Vessel)

(Top cluster remains Unnerving Assault compound `{U}/{R} was spent` — parser/evaluator batch.)

### Track D — Executor gap closure (batch 366) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Its vs self stats** | `its power is greater than this creature's power or its toughness is greater than this creature's toughness` (extends evolve-style handler; entering creature via `targetPermanentId`) | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Dethrone attack target** | `it's attacking the player with the most life or tied for most life` via source `defendingPlayerId` vs max player life | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Unattacked opponent** | `that player has another opponent who isn't being attacked` via `attackingPlayerId` + combat attack map (false in 1v1) | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch366.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **517 → 514** (−3); assisted **97.5%** (46760/47969) | `executor-coverage-audit.json` |

**Next batch 367 targets** (count-1 clusters from post-366 gap analysis):
1. ~~`it's modified`~~ ✅ batch 367
2. ~~`you control no Goblins`~~ ✅ batch 367
3. ~~`an artifact or creature was put into a graveyard from the battlefield this turn`~~ ✅ batch 367
4. ~~`no colored mana was spent to cast it`~~ ✅ batch 367
5. ~~`she was a nonland creature`~~ ✅ batch 367
6. ~~`this creature didn't attack or come under your control this turn`~~ ✅ batch 367
7. ~~`it has mutate`~~ ✅ batch 367
8. ~~`you control a white or blue permanent`~~ ✅ batch 367
9. ~~`this creature wasn't kicked`~~ ✅ batch 367

(Top cluster remains Unnerving Assault compound `{U}/{R} was spent` — parser/evaluator batch.)

### Track D — Executor gap closure (batch 365) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Life paid activate** | `life was paid to activate it` via ctx flag + stack `Pay N life:` cost parse (null for `or` / `may pay` costs) | `oracleIRExecutorConditionalStepSupport.ts` |
| **Named workers** | Generic `you control creatures named X and Y` on controlled creature names | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Graveyard entry** | `they entered or were cast from a graveyard` via `thoseCreatureIds` + `enteredFromZone`; **splitCompositeCondition** exception so ` or ` does not decompose the clause | `oracleIRExecutorConditionalStepSupport.ts` |
| **Tests** | `oracleIRGapBatch365.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **521 → 517** (−4); assisted **97.5%** (46758/47969) | `executor-coverage-audit.json` |

**Next batch 366 targets** (count-1 clusters from post-365 gap analysis):
1. ~~`its power is greater than this creature's power or its toughness is greater than this creature's toughness`~~ ✅ batch 366
2. ~~`it's attacking the player with the most life or tied for most life`~~ ✅ batch 366
3. ~~`that player has another opponent who isn't being attacked`~~ ✅ batch 366

(Top cluster remains Unnerving Assault compound `{U}/{R} was spent` — parser/evaluator batch.)

### Track D — Executor gap closure (batch 364) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Warrior damage source** | `any of that damage was dealt by a Warrior` via `damageIncludedWarriorSource` + source id/type lookup | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Permanent entered** | `this permanent entered this turn` via source `enteredThisTurn` (mirrors creature variant) | `oracleIRExecutorConditionalStepSupport.ts` |
| **Another +1/+1 counter** | `you control another creature with a +1/+1 counter on it` excludes source, checks counters | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch364.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **524 → 521** (−3); assisted **97.5%** (46754/47969) | `executor-coverage-audit.json` |

**Next batch 365 targets** (count-1 clusters from post-364 gap analysis):
1. ~~`life was paid to activate it`~~ ✅ batch 365
2. ~~`you control creatures named Mine Worker and Tower Worker`~~ ✅ batch 365
3. ~~`they entered or were cast from a graveyard`~~ ✅ batch 365

(Top cluster remains Unnerving Assault compound `{U}/{R} was spent` — parser/evaluator batch.)

### Track D — Executor gap closure (batch 363) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Prevented creature source** | `damage from a creature source is prevented this way` via ctx flags + prevent_damage antecedent + source type | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Prevented noncreature source** | `damage from a noncreature source is prevented this way` (exact-match; avoids `noncreature` ⊃ `creature` substring bug) | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Kicked twice** | `it was kicked twice` via `resolveKickedTwiceStatus` (count ≥2 / `wasKickedTwice`; replay-safe null) | `oracleIRExecutorConditionalStepSupport.ts` |
| **Tests** | `oracleIRGapBatch363.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **527 → 524** (−3); assisted **97.5%** (46751/47969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batch 362) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Thopter-only self** | Generic `you control no {subtype}s other than this creature` (excludes source) | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Opponent discard** | `an opponent discarded a card this turn` via `discardedCardThisTurn` map | `oracleIRExecutorConditionalStepSupport.ts` |
| **Two players lost** | `two or more players have lost the game` via `playersLostCount` / `hasLost` / `inactive` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch362.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **530 → 527** (−3); assisted **97.5%** (46749/47969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batch 361) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Treasure activate** | `mana from a Treasure was spent to activate this ability` via stack provenance + `treasureManaSpentToActivateThisTurn` + ctx | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Most lands (each other)** | `that player controls more lands than each other player` via per-player land counts vs `that player` | `oracleIRExecutorConditionalStepSupport.ts` |
| **Tests** | `oracleIRGapBatch361.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **534 → 530** (−4); assisted **97.5%** (46746/47969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batch 360) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Exiled with source** | `a card is exiled with it` via `countExiledCardsWithSource`, permanent exile arrays, `linkedExiles` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Single target** | `it has a single target` via stack `targets` / `targetId` count | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Sacrificed subtype** | Generic `the sacrificed creature was a {subtype}` (replaces hamster-only) | `oracleIRExecutorConditionalStepSupport.ts` |
| **Nonbasic land** | `that land was nonbasic` on referenced/moved land type-line | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch360.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **542 → 534** (−8); assisted **97.4%** (46741/47969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batch 359) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Excess damage this turn** | `that creature was dealt excess damage this turn` via `excessDamageThisTurnByCreatureId` / permanent flags | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Renowned (positive)** | `it's renowned` / `this creature is renowned` on source `renowned` flag | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Another high-power creature** | Generic `you control another creature with power N or greater` excluding `sourceId` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Treasure cast this spell** | Extended `mana from a Treasure was spent to cast this spell` via stack + `treasureManaSpentToCastThisTurn` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch359.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **551 → 542** (−9); assisted **97.4%** (46734/47969) | `executor-coverage-audit.json` |

**Next batch 360 targets** (count-2 clusters from post-359 gap analysis):
1. `a card is exiled with it`
2. `it has a single target`
3. `the sacrificed creature was a Human`
4. `that land was nonbasic`

### Track D — Executor gap closure (batch 358) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Cast both types** | `you've cast both a creature spell and a noncreature spell this turn` via spell log + count maps | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Enchanted power threshold** | Generic `enchanted creature's power is N or greater` via aura `attachedTo` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Underpay cast** | `the amount of mana spent to cast it was less than its mana value` via `getCastManaSpendSource` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Creature damage this way** | `a creature is dealt damage this way` antecedent + `lastDamagedCards` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch358.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **559 → 551** (−8); assisted **97.4%** (46725/47969) | `executor-coverage-audit.json` |

**Next batch 359 targets** (count-2 clusters from post-358 gap analysis):
1. `that creature was dealt excess damage this turn`
2. `it's renowned`
3. `you control another creature with power 4 or greater`
4. `mana from a Treasure was spent to cast this spell`

### Track D — Executor gap closure (batch 357) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Same name as permanent** | `it has the same name as a permanent` compares referenced/moved card name to battlefield | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Clues sacrificed** | Generic `you sacrificed N or more Clues this turn` via `cluesSacrificedThisTurn` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Prowl paid** | `its prowl cost was paid` / `this spell's prowl cost was paid` (mirror surge) | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Lesson in graveyard** | `there's a Lesson card in your graveyard` type-line scan | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch357.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **569 → 559** (−10); assisted **97.4%** (46717/47969) | `executor-coverage-audit.json` |

**Next batch 358 targets** (count-2 clusters from post-357 gap analysis):
1. `you've cast both a creature spell and a noncreature spell this turn`
2. `enchanted creature's power is 4 or greater`
3. `the amount of mana spent to cast it was less than its mana value`
4. `a creature is dealt damage this way`

### Track D — Executor gap closure (batch 356) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Same-color mana spent** | Generic `(\{[wubrgcs]\})+ was spent to cast it` via `getCastManaSpendSource` + `getAmountOfSpecificManaSymbolSpent` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Type ETB this turn** | Extended `a/an/another {type} entered the battlefield under your control this turn` + per-type turn counters | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Target has toxic** | `that creature has toxic` keyword check on target permanent | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Another creature ETB** | `another` article excludes `sourceId` from entered-this-turn count | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch356.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **592 → 569** (−23); assisted **97.4%** (46708/47969) | `executor-coverage-audit.json` |

**Next batch 357 targets** (count-2 clusters from post-356 gap analysis):
1. `it has the same name as a permanent`
2. `you sacrificed three or more Clues this turn`
3. `its prowl cost was paid`
4. `there's a Lesson card in your graveyard`

### Track D — Executor gap closure (batch 355) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **That-player land/creature lead** | Generic `that player controls more {creatures\|lands} than you` via `targetPlayerId` + battlefield counts | `oracleIRExecutorConditionalStepSupport.ts` |
| **Low hand threshold** | Generic `you have fewer than N cards in hand` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Surge paid** | `its surge cost was paid` on source/stack spell (`alternateCostId`, `surgeCostWasPaid`) | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Counter placed this turn** | `you put a counter on a creature this turn` via `putCounterOnCreatureThisTurn[controllerId]` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch355.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **603 → 592** (−11); assisted **97.3%** (46685/47969) | `executor-coverage-audit.json` |

**Next batch 356 targets** (count-2 clusters from post-355 gap analysis):
1. `{R}{R} was spent to cast it` / `{G}{G} was spent to cast it` (color-mana-spent-on-cast family)
2. `an artifact entered the battlefield under your control this turn`
3. `that creature has toxic`
4. `another creature entered the battlefield under your control this turn`

### Track D — Executor gap closure (batch 354) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **No attack global** | `no creatures attacked this turn` via `creaturesAttackedThisTurn` / battlefield scan | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **No damage yet** | `it hasn't dealt damage yet` on source permanent | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Second land** | `that player had another land enter… this turn` via `landsEnteredBattlefieldThisTurn` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Opponent damage** | `this creature dealt damage to an opponent this turn` via `creaturesThatDealtDamageToPlayer` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch354.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **611 → 603** (−8); assisted **97.3%** (46674/47969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batch 348) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Specific kicker cost** | `(it\|this spell\|this creature) was kicked with its … kicker` via `resolveKickedStatus` | `oracleIRExecutorConditionalStepSupport.ts` |
| **Creature subtype** | Generic `this creature is a {subtype}` type-line check | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **GY entry antecedent** | `one or more of them entered from a graveyard or was cast from a graveyard` | `oracleIRExecutorConditionalStepSupport.ts` |
| **Life vs starting** | Generic `you have at least N life more than your starting life total` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch348.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **680 → 653** (−27); assisted **97.2%** (46624/47969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batch 347) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Dragon beheld** | Generic `a {quality} was beheld` via `beheldQuality` ctx | `oracleIRExecutionTypes.ts`, `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **No artifacts** | `you control no artifacts` via `countControlledMatchingDescriptor` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **No battlefield creatures** | Global `no creatures are on the battlefield` scan | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Not a token** | `it's not a token` on referenced permanent | `oracleIRExecutorConditionalStepSupport.ts` |
| **Tests** | `oracleIRGapBatch347.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **692 → 680** (−12); assisted **97.1%** (46599/47969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batch 346) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Opponent life lead** | `an opponent has more life than you` existence check | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Empty target hand** | `that player has no cards in hand` via `targetPlayerId` | `oracleIRExecutorConditionalStepSupport.ts` |
| **No attack this turn** | `this creature didn't attack this turn` on source permanent | `oracleIRExecutorConditionalStepSupport.ts` |
| **Team another subtype** | Generic `your team controls another {subtype}` + `getTeamPlayerIds` | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch346.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **704 → 692** (−12); assisted **97.1%** (46588/47969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batch 345) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Non-hand cast** | `this spell was cast from anywhere other than your hand` via `castFromZone !== 'hand'` | `oracleIRExecutorConditionalStepSupport.ts` |
| **Zero mana cast** | `noManaSpentToCast` ctx + `no mana was spent to cast it` evaluator | `oracleIRExecutionTypes.ts`, `oracleIRExecutorConditionalStepSupport.ts` |
| **Would lose game** | `would lose the game` in would-clause + explicit `wouldLoseTheGame` ctx | `oracleIRExecutorConditionalStepSupportExtended.ts`, `oracleIRExecutorConditionalStepSupport.ts` |
| **No untapped lands** | Controller land tap scan | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Tests** | `oracleIRGapBatch345.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **717 → 704** (−13); assisted **97.1%** (46576/47969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batch 344) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Creature-mana spend** | `manaSpentOnCreatureSpell` ctx + `that mana is spent on a creature spell` evaluator | `oracleIRExecutionTypes.ts`, `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Seven+ cards in hand** | Generic `you have N or more cards in hand` threshold matcher | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Life lead vs opponent** | `you have more life than an opponent` existence check | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **No monarch** | `there is no monarch` negates `state.monarch` | `oracleIRExecutorConditionalStepSupport.ts` |
| **Tests** | `oracleIRGapBatch344.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **730 → 717** (−13); assisted **97.1%** (46566/47969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batch 343) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Creature cast this way** | `creatureSpellCastThisWay` ctx + `you cast a creature spell this way` evaluator | `oracleIRExecutionTypes.ts`, `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Untapped source** | `this creature is untapped` / `this permanent is untapped` (generalized from artifact) | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Hand lead vs each opponent** | `youHaveMoreCardsInHandThanEachOpponent` | `oracleIRExecutorConditionalStepSupport.ts` |
| **Had counters** | `it had one or more counters on it` on referenced permanent | `oracleIRExecutorConditionalStepSupport.ts` |
| **Tests** | `oracleIRGapBatch343.test.ts` (5) | rules-engine |
| **Re-audit** | `unsupported_condition_clause` **742 → 730** (−12); assisted **97.0%** (46553/47969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batch 342) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Withdraw** | `another target X` bounce + `parseMoveZoneUnlessPaysManaFromStepText` skip when paid | `oracleIRExecutorZoneOps.ts`, `oracleIRExecutorMoveZoneStepHandlers.ts` |
| **Hibernation** | `parseMoveZoneAllColoredPermanentsToHand`; basic land subtype color inference in `collectCardColors` | `oracleIRExecutorZoneOps.ts`, `oracleIRExecutorMoveZoneStepHandlers.ts` |
| **Dakra Mystic** | `parsedTheRevealedCards` graveyard destination | `oracleIRExecutorMoveZoneStepHandlers.ts` |
| **Tests** | `oracleIRGapBatch306.test.ts` (7) | rules-engine |
| **Re-audit** | `unsupported_selector` **113 → 110** (−3); assisted **96.7%** (46,402/47,969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batch 305) ✅

| Item | Change | Key files |
|------|--------|-----------|
| **Storm the Festival** | `up to two permanent cards with mana value N or less from among them` → `bfLibraryBottomSplit` | `oracleIRExecutorZoneOps.ts` |
| **Mind Roots** | `parseMoveZoneAllCardsDiscardedThisWay` + BF tapped handler; audit GY fixtures | `oracleIRExecutorZoneOps.ts`, `oracleIRExecutorMoveZoneStepHandlers.ts`, `executor-coverage-audit.ts` |
| **Teferi, Temporal Pilgrim** | `parseMoveZoneOpponentChoicePermanentToHand` + opponent BF bounce | `oracleIRExecutorZoneOps.ts`, `oracleIRExecutorMoveZoneStepHandlers.ts` |
| **Tests** | `oracleIRGapBatch305.test.ts` (6) | rules-engine |
| **Re-audit** | `unsupported_selector` **116 → 113** (−3); assisted **96.7%** (46,398/47,969) | `executor-coverage-audit.json` |

### Track D — Executor gap closure (batches 300–304) ✅

| Metric | Value |
|--------|-------|
| `unsupported_selector` | **135 → 110** (−25 across batches 300–306) |
| `unsupported_condition_clause` | **785** (unchanged) |
| `ir_gap` | **132** |
| Assisted (`full_card`) | **96.7%** (46,402 / 47,969) |
| Parse→execute gaps | **1,435** items on **1,390** cards |

Latest batch files: `oracleIRGapBatch300.test.ts` … `oracleIRGapBatch306.test.ts`. All uncommitted.

### Track D — Executor gap closure (batch 281–282) ✅ partial

| Item | Change | Key files |
|------|--------|-----------|
| **Full-card condition cluster script** | `executor-fullcard-condition-gap-analysis.ts` | server/scripts |
| **Full-card selector cluster script** | `executor-fullcard-selector-gap-analysis.ts` (top: `move_zone` partial GY/library split, 59) | server/scripts |
| **Condition evaluators (281–282)** | Werewolf/day-night, cast/descend/tribute, adaptive P/T, depletion/ki/legendary/vote riders, `it was a creature`, hand-size/activate-count/suspended | `oracleIRExecutorConditionalStepSupportExtended.ts`, `oracleIRExecutorConditionalStepSupport.ts` |
| **Audit fixture** | `spellsCastLastTurn*`, vote results, ki counters, second legendary, activate/GY-turn flags | `executor-coverage-audit.ts` |
| **Re-audit** | `unsupported_condition_clause` **1139 → 787**, assisted **96.3%**, parse→execute gaps **1982 → 1637** | `executor-coverage-audit.json` |
| **Tests** | `oracleIRGapBatch281.test.ts` (3), `oracleIRGapBatch282.test.ts` (2) | rules-engine |

Trigger-effect scope condition/selector gaps remain **0**.

### Track C — Deck edit verified ✅ (prior turn)

Deck edit was already implemented in `DeckManagerModal.tsx` (local `beginEditLocal`/`saveLocal`, server `beginEditServer`/`updateServerDeck` via socket + REST). Added socket integration coverage:

| Item | Change | Key files |
|------|--------|-----------|
| **updateSavedDeck** | Happy-path + not-in-room auth tests | `saved-decks.update.integration.test.ts` |

### Full-card executor gap batch ✅

| Item | Change | Key files |
|------|--------|-----------|
| **ETB tapped audit noise** | Skip benign replacement metadata (`tapped`, `tapped unless …`); dry-run full-card abilities using parsed `ability.steps` | `executor-coverage-audit.ts` |
| **Devoid parser** | Bare `Devoid` → `grant_static_ability` keyword grant | `oracleIRParserPostprocess.ts` |
| **Conditional executor crash** | `cardsMatchDescriptor` accepts single card objects (audit dry-run no longer throws) | `oracleIRExecutorConditionalStepSupportExtended.ts` |
| **Re-audit** | `full_card` scope: **ir_gap 778 → 132**, assisted **95.6%** (45,856/47,970); flashback reminder lines now `fully_applied` | `server/scripts/out/executor-coverage-audit.json` |

### Tracks A + B complete — damage follow-up + G1 socket tests (prior turn)

| Item | Change | Key files |
|------|--------|-----------|
| **Client poison UI contract** | `getDisplayedPoisonCount` mirrors `TableLayout` / `App.tsx` `poisonCounters` lookup | `client/tests/poisonCounterDisplay.test.ts` |
| **First/double strike infect** | First-strike and double-strike infect poison sequencing unit tests | `combat.infect-wither.test.ts` |
| **Thassa ETB socket** | Effect-program may-choice → devotion library look; `look_select_top` → `LIBRARY_SEARCH` socket resume | `thassa-oracle-etb.socket.integration.test.ts` |
| **Roaming Throne + Kumena** | Kumena +1/+1 targets throne with chosen Merfolk via socket activation | `roaming-throne-kumena-tribal.socket.integration.test.ts` |
| **Executor gap audit** | Reviewed `server/scripts/out/executor-coverage-audit.json` (`full_card`, 2026-06-13): **833** parse→execute gaps (**778** `ir_gap`, **211** unsupported) | no code change |

### Batch 280 follow-up — Rot Wolf socket E2E + damage call-site audit

| Item | Change | Key files |
|------|--------|-----------|
| **Rot Wolf socket E2E** | `declareAttackers` socket → combat damage → `viewFor.poisonCounters` (2 poison, no life loss) | `combat.infect-wither.socket.integration.test.ts` |
| **Unit test view sync** | Rot Wolf unit test asserts `viewFor.poisonCounters` matches `state.poisonCounters` | `combat.infect-wither.test.ts` |
| **X-cost AoE damage** | Crypt Rats-style `{X}: … each creature and each player` uses `applyCreatureDamageFromSource` + `resolvePlayerDamage` | `x-activated-abilities.ts` |
| **Nibelheim Aflame sweep** | Sweep damage from targeted creature uses source-aware bridge | `stackResolveSpellSpecialCaseUtils.ts` |

### Batch 280 — Server damage processing (infect / wither / poisonous)

**Root cause:** Live combat used bespoke `dealCombatDamage` in `turn.ts` (life loss + marked damage) instead of `rules-engine/src/damageProcessing.ts`. Rot Wolf and similar cards had no effect on poison or -1/-1 counters.

**Fix:** New shared bridge `server/src/state/modules/combat-damage-processing.ts` wired into combat, fight, legacy spell damage, `dealDamage` events, damage-received triggers, proliferate+SBA.

| Area | Change | Key files |
|------|--------|-----------|
| **Combat damage** | Infect → poison; poisonous/toxic on combat; infect/wither → -1/-1 on creatures | `turn.ts`, `combat-damage-processing.ts` |
| **Fight** | Mutual damage respects infect/wither on both creatures | `applyEvent.ts`, `stackResolveAbilityMidHandlersUtils.ts`, `planeswalker/templates/resolve.ts` |
| **Spell / ability damage** | `DamagePlayer` / `DamagePermanent` use shared bridge | `executeSpellEffect.ts`, `applyEvent.ts` |
| **`dealDamage` events** | Auto-detect infect/wither from `sourcePermanentId`; player targets | `applyEvent.ts`, `replay.ts` |
| **Damage-received** | Boros Reckoner-style reflect uses source keywords | `triggers/damage-received.ts` |
| **Proliferate** | `updateCounters` + **`runSBA`** after proliferate (delayed dies triggers) | `applyEvent.ts` |
| **Poison defeat** | `syncLifeAndCheckDefeat` checks 10+ poison | `turn.ts` |
| **Tests** | 6 cases including Rot Wolf, fight, auto-detect, proliferate→Blood Artist | `server/tests/combat.infect-wither.test.ts` |

**Detailed reference:** [server-damage-processing-migration.md](./server-damage-processing-migration.md)

### Batch 279 — G1 Merfolk commander live-play fixes (prior session, still uncommitted)

| Issue | Fix | Key files |
|-------|-----|-----------|
| **Roaming Throne chosen type** | Throne counts as chosen subtype for tribal effects | `shared/src/creatureTypes.ts`, `creatureTypeNow.ts` |
| **Tap triggers** | `queueTapTriggersForTappedPermanents` after tap costs | `tap-trigger-queue.ts`, `resolution.ts` |
| **Thassa's Oracle ETB** | `look_select_top` + `LIBRARY_SEARCH` queue | `oracleIRParserPostprocess.ts`, `oracleIrServerZoneSync.ts` |
| **Kynaios / lookup / copy** | Land ETB prompts; art_series filter; Cryptoplasm revert | `kynaiosChoice.ts`, `localCardLookup.ts`, `permanent-copy.ts` |
| **Sacrifice under summoning sickness** | `hasSacrificePrefixActivatedAbility` in `canAct` | `can-respond.ts`, `socket/util.ts` |
| **Rampant Growth import** | Standalone sorcery beats fuse face alias | `localCardLookup.ts` (`schemaVersion` 3) |
| **Sakura-Tribe Elder false ETB** | Removed bespoke table row; sacrifice guard | `card-data-tables.ts`, `triggered-abilities.ts` |

### Carried over from prior sessions (still uncommitted)

- Batches 264–278 (trigger `ir_gap` closure, step ledger Phases A–Z)
- Goad/Baeloth parallel track (`docs/GOAD_IMPLEMENTATION.md`)
- Client: import warning contrast, deck editing (local + server)

**Nothing committed** unless explicitly requested.

## Key files touched (batch 280)

| Area | Paths |
|------|-------|
| Damage bridge | `server/src/state/modules/combat-damage-processing.ts` |
| Combat | `server/src/state/modules/turn.ts` |
| Events / replay | `server/src/state/modules/applyEvent.ts`, `replay.ts` |
| Spells | `server/src/state/modules/executeSpellEffect.ts` |
| Fight / reflect | `stackResolveAbilityMidHandlersUtils.ts`, `triggers/damage-received.ts`, `planeswalker/templates/resolve.ts` |
| Tests | `server/tests/combat.infect-wither.test.ts` |
| Docs | `docs/server-damage-processing-migration.md` |

## Validation commands

```powershell
# Batch 280 — infect/wither/poisonous
cd D:\Git\MTGEDH\server
npx vitest run tests/combat.infect-wither.test.ts tests/combat.infect-wither.socket.integration.test.ts tests/engine.damage.test.ts

# Batch 279 + G1 socket follow-ups
npx vitest run tests/thassa-oracle-etb.socket.integration.test.ts tests/roaming-throne-kumena-tribal.socket.integration.test.ts

# Client poison display contract
cd D:\Git\MTGEDH\client
npx vitest run tests/poisonCounterDisplay.test.ts

# Batch 279 — G1 fixes
npx vitest run tests/roaming-throne-chosen-type.unit.test.ts tests/g1-card-fixes.unit.test.ts tests/sakura-tribe-etb.regression.test.ts tests/deck-import.local-index.test.ts tests/can-respond.test.ts

# Migration gate + latest gap batch
npm run test:oracle-ir-migration
cd D:\Git\MTGEDH\rules-engine
npx vitest run test/oracleIRGapBatch306.test.ts

# Re-audit after gap batch work
cd D:\Git\MTGEDH\server
$env:EXECUTOR_COVERAGE_SCOPE='full_card'; npm run executor:coverage
npx tsx scripts/executor-fullcard-selector-gap-analysis.ts
```

Expected: `combat.infect-wither.test.ts` **8/8**; `combat.infect-wither.socket.integration.test.ts` **1/1**; `thassa-oracle-etb.socket.integration.test.ts` **2/2**; `roaming-throne-kumena-tribal.socket.integration.test.ts` **1/1**; `poisonCounterDisplay.test.ts` **3/3**; migration suite **701/701**.

## Open / not verified in live play

| Item | Notes |
|------|-------|
| Rot Wolf poison in **client UI** | Display contract tested; manual prod UI spot-check optional |
| Eldrazi Monument indestructible cleanup | Batch 279 dedupe; retest live |
| `dealCombatDamage` → rules-engine delegation | Optional long-term refactor (deferred) |
| Executor `ir_gap` clusters | **132** `ir_gap`; **653** `unsupported_condition_clause`; **0** `unsupported_selector`; parse→execute gaps **1,213** (`full_card`, post batch 348) |

## Next session priorities

Pick one track:

### Track A — Damage processing follow-up ✅
1. ~~Socket E2E: Rot Wolf → poison counters visible in client~~ ✅
2. ~~Audit `applyDamageToPermanentWithCounterEffects` without source~~ ✅
3. ~~Client poison display contract~~ ✅ (`poisonCounterDisplay.test.ts`)
4. ~~First/double strike infect sequencing~~ ✅ (unit tests)
5. Deferred: delegate `dealCombatDamage` to rules-engine `executeCombatDamage`

### Track B — Oracle IR / G1 resume ✅
1. ~~Thassa socket integration test~~ ✅ (`thassa-oracle-etb.socket.integration.test.ts`)
2. ~~Roaming Throne + Kumena socket tribal test~~ ✅ (`roaming-throne-kumena-tribal.socket.integration.test.ts`)
3. ~~Executor gap audit (`full_card`)~~ ✅ reviewed `executor-coverage-audit.json` (833 parse→execute gaps)

### Track C — Client / deck ✅
1. ~~Deck edit flows in standalone builder~~ ✅ (already implemented; `saved-decks.update.integration.test.ts` added)
2. Import warning banner (done); verify contrast in prod build

### Track D — Executor gap closure (next)
1. **`unsupported_selector` (0)** — cleared batch 339 ✅
2. **`unsupported_condition_clause` (603)** — see `executor-fullcard-condition-gap-analysis.json` (batch 355 targets below)
3. Shock/check land ETB choice prompts in live play

**Batch 355 probe clusters** (post-354 condition gap analysis):
- **That player controls more lands than you** — Keeper of the Accord / Archaeomancer's Map
- **You have fewer than seven cards in hand** — Kozilek, the Great Distortion / Damia, Sage of Stone
- **Its surge cost was paid** — Reckless Bushwhacker / Tyrant of Valakut
- **You put a counter on a creature this turn** — Lord Jyscal Guado / Lasting Tarfire

#### Batch 354 (no attack / no damage yet / second land / opponent damage)
- Evaluators: `no creatures attacked this turn` via `creaturesAttackedThisTurn` + battlefield scan; `it hasn't dealt damage yet` on source; `that player had another land enter…` via `landsEnteredBattlefieldThisTurn`; `this creature dealt damage to an opponent this turn` via `creaturesThatDealtDamageToPlayer`
- Audit enrich: empty attack tracking; `hasDealtDamage: false`; `landsEnteredBattlefieldThisTurn.p2: 2`; damage tracker on source
- Tests: `rules-engine/test/oracleIRGapBatch354.test.ts`
- Audit: `unsupported_condition_clause` **611 → 603** (−8); assisted **97.3%** (46674/47969); Cinderhorn/Keldon, Karakyk/Palladia, Tunnel/Conundrum, Dervish/Outlaw clusters cleared

**Batch 354 probe clusters** (post-353 condition gap analysis — cleared):
- **No creatures attacked this turn** — Charging Cinderhorn / Keldon Twilight
- **It hasn't dealt damage yet** — Karakyk Guardian / Palladia-Mors, the Ruiner
- **That player had another land enter the battlefield under their control this turn** — Tunnel Ignus / Confounding Conundrum
- **This creature dealt damage to an opponent this turn** — Whirling Dervish / Dunerider Outlaw

#### Batch 353 (life loss threshold / enchant+equip / exiled type match / no tapped lands)
- Evaluators: generic `a player lost N or more life this turn`; `it was enchanted or equipped` on antecedent; `it shares a card type with the exiled card` via `findExiledCardWithSource` + `cardsShareCardType`; `you control no tapped lands` (inverse of no untapped lands)
- Audit enrich: `lifeLostThisTurn.p2: 5`; died creature `wasEnchanted`/`attachedEquipment`; exiled card + matching stack spell; untapped land only
- Tests: `rules-engine/test/oracleIRGapBatch353.test.ts`
- Audit: `unsupported_condition_clause` **619 → 611** (−8); assisted **97.3%** (46666/47969); Y'shtola/Knight, Koll/Cass, Cemetery cards, Nantuko/Martyr clusters cleared

**Batch 353 probe clusters** (post-352 condition gap analysis — cleared):
- **A player lost 4 or more life this turn** — Y'shtola, Night's Blessed / Knight of the Ebon Legion
- **It was enchanted or equipped** — Koll, the Forgemaster / Cass, Hand of Vengeance
- **It shares a card type with the exiled card** — Cemetery Protector / Cemetery Gatekeeper
- **You control no tapped lands** — Nantuko Shaman / Martyr's Soul

#### Batch 352 (no attack / damage threshold / no creatures / attack group)
- Evaluators: `you didn't attack with a creature this turn` → `!controllerAttackedThisTurn`; generic `N or more damage was dealt to it this turn`; `you control no creatures`; `N or more of those creatures are attacking you and/or planeswalkers you control` via `thoseCreatureIds` + attack targets
- Audit enrich: clear p1 attackers; died creature `damageThisTurn: 4`; strip p1 creatures; attack group fixtures with PW + two attackers targeting you/PW
- Tests: `rules-engine/test/oracleIRGapBatch352.test.ts`
- Audit: `unsupported_condition_clause` **627 → 619** (−8); assisted **97.3%** (46658/47969); Curious Obsession/See Red, Zubera, Promise/Thran Quarry, Tomik/Mangara clusters cleared

**Batch 352 probe clusters** (post-351 condition gap analysis — cleared):
- **You didn't attack with a creature this turn** — Curious Obsession / See Red
- **4 or more damage was dealt to it this turn** — Burning-Eye Zubera / Rushing-Tide Zubera
- **You control no creatures** — Promise of Tomorrow / Thran Quarry
- **Two or more of those creatures are attacking you and/or planeswalkers you control** — Tomik, Wielder of Law / Mangara, the Diplomat

#### Batch 351 (counters on permanent / non-attacker tap / exile cast / command zone presence)
- Evaluators: `this permanent has counters on it` on source; `it isn't being declared as an attacker` via `attackersDeclaredThisCombatByPlayer`; `this spell was cast from exile` via `castFromZone`; `this permanent is in the command zone or on the battlefield` via battlefield + `collectCommandZoneObjects`
- Audit enrich: `bf-source` counters; opponent tapped creature + empty attacker list; `castFromZone: exile`; command zone metadata for `bf-source`
- Tests: `rules-engine/test/oracleIRGapBatch351.test.ts`
- Audit: `unsupported_condition_clause` **635 → 627** (−8); assisted **97.3%** (46650/47969); Denry Klin/Ozolith, Verity Circle/Rhoda, Delayed Blast Fireball/Holy, Inalla/Arahbo clusters cleared

**Batch 351 probe clusters** (post-350 condition gap analysis — cleared):
- **This permanent has counters on it** — The Ozolith / Denry Klin, Editor in Chief
- **It isn't being declared as an attacker** — Verity Circle / Rhoda, Geist Avenger
- **This spell was cast from exile** — Ultimate Magic: Holy / Delayed Blast Fireball
- **This permanent is in the command zone or on the battlefield** — Inalla, Archmage Ritualist / Arahbo, Roar of the World

#### Batch 350 (minus counter / life lost last turn / not your turn / equipped)
- Evaluators: `it had a -1/-1 counter on it` via antecedent cards + `getCounterCountOnObject`; `you lost life last turn` → `lifeLostLastTurn*` maps; `it's not your turn` via `activePlayerIndex`; `it's equipped` via `isEquipped` / `attachedEquipment`
- Audit enrich: died creature `-1/-1` in `lastMovedCards`; `lifeLostLastTurnByPlayerCounts.p1`; `activePlayerIndex: 1`; `isEquipped` on source/target permanents
- Tests: `rules-engine/test/oracleIRGapBatch350.test.ts`
- Audit: `unsupported_condition_clause` **643 → 635** (−8); assisted **97.2%** (46642/47969); Retched Wretch, First Response, Zealous Display, Tetsuo/Awaken clusters cleared

**Batch 350 probe clusters** (post-349 condition gap analysis — cleared):
- **It had a -1/-1 counter on it** — Retched Wretch / Blowfly Infestation
- **You lost life last turn** — First Response / Paladin of Atonement
- **It's not your turn** — Zealous Display / Lighthouse Chronologist
- **It's equipped** — Tetsuo, Imperial Champion / Awaken the Sleeper

#### Batch 349 (kicked spell / human subtype / uncast / planeswalker ETB this turn)
- Evaluators: `that spell was kicked` (stack spell via `resolveKickedStatus`); generic `it was a {subtype}`; `it wasn't cast` / `it was not cast`; `a {type} entered the battlefield under your control this turn` → `{type}EnteredThisTurn[controllerId]`
- Audit enrich: stack spell `wasKicked`; human `lastMovedCards` fixture; `wasCast: false` + `enteredFromZone: library`; `planeswalkerEnteredThisTurn.p1`
- Tests: `rules-engine/test/oracleIRGapBatch349.test.ts`
- Audit: `unsupported_condition_clause` **653 → 643** (−10); assisted **97.2%** (46634/47969); Hallar, Slayer's Plate, Rapid Augmenter, Oath of Liliana/Chandra clusters cleared

**Batch 349 probe clusters** (post-348 condition gap analysis — cleared):
- **That spell was kicked** — Hallar, the Firefletcher / Bloodstone Goblin
- **It was a Human** — Slayer's Plate / Avacyn's Collar
- **It wasn't cast** — Rapid Augmenter / Preston, the Vanisher
- **A planeswalker entered the battlefield under your control this turn** — Oath of Liliana / Oath of Chandra

#### Batch 283 (surveil reminder selector cluster)
- Parser: merge `look_top` + `move_zone` (GY + rest on top) → `look_select_top`; prune redundant reminder steps when ability has `surveil`
- Tests: `rules-engine/test/oracleIRGapBatch283.test.ts`
- Audit: `unsupported_selector` **318 → 259**; surveil disposal cluster **59 → 0**

#### Batch 284 (manifest dread selector cluster)
- Parser: upgrade `grant_static_ability` manifest dread → `manifest_dread`; prune reminder `look_top`/`move_zone` tail; early-parse `manifest dread twice`
- Tests: `rules-engine/test/oracleIRGapBatch284.test.ts`
- Audit: `unsupported_selector` **259 → 255**; manifest face-down split cluster **3 → 0**

#### Batch 285 (return X from graveyard + Living End)
- Executor: `parseMoveZoneUpToTargetCountFromYourGraveyard` matches `x target … from your graveyard`; `parseMoveZoneAllCardsTheyExiledThisWay` + antecedent `lastMovedCards` carry-over from each-player GY exile
- Tests: `rules-engine/test/oracleIRGapBatch285.test.ts`
- Audit: `unsupported_selector` **255 → 239**; return-X creature GY clusters **6 → 0**, Living End chain **3 → 0**

#### Batch 286 (Island bounce + artifact/enchantment GY + X-target bounce)
- Battlefield parser: basic land subtype selectors (`Islands you control` → `typeLineTermsAnyOf: ['island']`)
- Executor: `parseMoveZoneAllFromYourGraveyard` handles `all artifact and enchantment cards`; `parseMoveZoneCountTargetBattlefieldBounce` matches bare `X target creatures`
- Tests: `rules-engine/test/oracleIRGapBatch286.test.ts`
- Audit: `unsupported_selector` **239 → 227** (−12); Gush/Ensnare Island bounce, Brilliant Restoration, Aether Tide clusters cleared

#### Batch 287 (opponent GY return + chosen shuffle + Lapse + nonland bounce)
- Executor: exclude graveyard selectors from battlefield-bounce parser; `target nonland permanents` in up-to bounce; shuffle `the chosen cards` into library; `that spell` → library top on counter; `getTargetPlayerId` falls back to `ctx.targetPlayerId`
- Parser: `upgradeCounteredSpellLibraryTopReplacementSteps`; `pruneMalformedExploreReminderMoveZoneSteps` (Jadelight/Glowcap)
- Audit enrich: opponent GY return + chosen-cards shuffle fixtures
- Tests: `rules-engine/test/oracleIRGapBatch287.test.ts`
- Audit: `unsupported_selector` **227 → 214** (−13)

#### Batch 288 (unearth + multicolored GY + hand exile + Sweep Plains)
- Executor: `the card` contextual reference; `multicoloredOnly` criteria; `parseMoveZoneCountCardsFromTargetPlayersHand`; `parseMoveZoneAlternateCostColorCardFromYourHand`; `parseMoveZoneAnyNumberBasicLandSubtypeYouControlToHand` (Plains sweep)
- Audit enrich: unearth creature, multicolored GY card, opponent hand cards, alt-cost colored hand card, Plains fixtures
- Tests: `rules-engine/test/oracleIRGapBatch288.test.ts`
- Audit: `unsupported_selector` **214 → 196** (−18)

#### Batch 289 (bounce variants + alt-cost count + compound GY + nonblue + Disappear + Foggy Swamp)
- Executor: bare `any number of` / `one or two` battlefield bounce selectors; `all nonblue` mass bounce via `excludeCardColor`; counted alt-cost colored hand exile (`two white cards`); triple compound GY return (`artifact, enchantment, and planeswalker`); `enchanted creature and this Aura`; `X target creature cards from graveyards` exile; exclude `from graveyards` in bounce parser
- Audit enrich: `gy-planeswalker-1` fixture; counted alt-cost hand cards; planeswalker GY target inference
- Tests: `rules-engine/test/oracleIRGapBatch289.test.ts`
- Audit: `unsupported_selector` **196 → 183** (−13); Sunscour, Scapegoat, Counterintelligence, Triumphant Reckoning, Inundate, Disappear, Onakke Oathkeeper, Foggy Swamp Visions clusters cleared

#### Batch 290 (milled-this-way + adventure + Wave Goodbye + Grimoire + Identity Crisis + Collected Company)
- Executor: `a/an X card milled this way` hand path; `all cards that have an Adventure from among the milled cards`; `each creature without a +1/+1 counter` mass bounce; `the other one` contextual hand (extends `isTheOtherReference`); `all cards from target player's hand and graveyard`; per-card `mana value N or less` among-them BF/library-bottom split
- Audit enrich: land milled-this-way, adventure milled cards, creatures with/without +1/+1, Grimoire top-two GY pair, Identity Crisis target zones, Collected Company library among-them
- Tests: `rules-engine/test/oracleIRGapBatch290.test.ts`
- Audit: `unsupported_selector` **183 → 175** (−8); Sparring Dummy, Beluna, Wave Goodbye, Phyrexian Grimoire, Identity Crisis, Collected Company clusters cleared

#### Batch 291 (Tamiyo MV-X GY + opponent choice GY + Soulquake + chosen pile + Tazri milled activated)
- Executor: `parseMoveZoneSingleTargetCriteria` fixes `nonland permanent card with mana value X`; `parseMoveZoneOpponentChoiceFromTargetPlayersGraveyard`; `parseMoveZoneCompoundBattlefieldAndGraveyardMassReturn`; `parseMoveZoneCardFromChosenPile`; `parseMoveZoneAllNonManaActivatedCreaturesFromMilledCards` + `cardHasNonManaActivatedAbility`
- Audit enrich: Tamiyo GY artifact + xValue; opponent-choice GY creature; Soulquake BF+GY fixtures; chosen-pile library card; milled activated/non-activated creatures
- Tests: `rules-engine/test/oracleIRGapBatch291.test.ts`
- Audit: `unsupported_selector` **175 → 170** (−5); Tamiyo, Visions of Dread, Soulquake, Truth or Tale, Tazri clusters cleared

#### Batch 292 (Cry of the Carnarium + Memory Theft + Aether Burst + Nissa hand/GY)
- Parser: `inferZoneFromDestination` prefers `onto the battlefield` over incidental `hand` in toRaw (Nissa −5 fix)
- Executor: `parseMoveZoneAllFromEachPlayersGraveyard` supports `in all graveyards` + `were put there from the battlefield this turn`; `up to X target` bounce; `parseMoveZoneAdventureCardThatPlayerOwnsFromExile`; `parseMoveZoneTypedCardFromHandOrGraveyard` lands-MV + raw step fallback; `exileAllMatchingFromGraveyard` putIntoGraveyardThisTurn filter
- Audit enrich: Carnarium GY-this-turn creatures; Memory Theft adventure in opponent exile; Aether Burst BF targets + xValue; Nissa lands + GY creature
- Tests: `rules-engine/test/oracleIRGapBatch292.test.ts`
- Audit: `unsupported_selector` **170 → 166** (−4); Cry of the Carnarium, Memory Theft, Aether Burst, Nissa clusters cleared

#### Batch 294 (Angrath Pirate GY + Reap X random + Shoal MV-X alt cost)
- Executor: `parseMoveZoneRandomSingleFromYourGraveyard` X-count + embedded `Return X cards at random`; `parseMoveZoneAlternateCostColorCardFromYourHand` `with mana value X` + `resolveMoveZoneSingleTargetCriteriaWithX` in alt-cost handler
- Audit enrich: `gy-pirate-1` fixture + pirate GY target inference; alt-cost hand cards seeded with `cmc` when MV-X
- Tests: `rules-engine/test/oracleIRGapBatch294.test.ts`
- Audit: `unsupported_selector` **161 → 154** (−7); Angrath, Reap the Past, Disrupting/Nourishing/Sickening Shoal clusters cleared (Coiling Rebirth was audit-fixture-only)

#### Batch 295 (Coiling GY fix + Pull face-up exile + Paradoxical bounce + Hallowed flicker)
- Executor: `resolveUniqueChosenGraveyardTargetId` only excludes `lastMovedCards` no longer in GY; `parseMoveZoneTargetFaceUpExiledCard` + cross-player face-up exile lookup; `parseMoveZoneCountTargetBattlefieldBounce` nonland/nontoken any-number; battlefield `nontokenOnly` selector; `it entered under your control` conditional for flicker counters
- Audit enrich: face-up exile target; flicker `lastMovedCards` + exile fixture; nonland nontoken bounce targets
- Tests: `rules-engine/test/oracleIRGapBatch295.test.ts`
- Audit: `unsupported_selector` **154 → 150** (−4); assisted **96.7%**; Coiling Rebirth, Pull from Eternity, Paradoxical Outcome, Hallowed Respite clusters cleared

#### Batch 296 (surveil GY split + Snow Hound bounce + Rats' Feast X GY + Narfi each-GY exile)
- Executor: `getContextualThemSplitKind` `any_number_graveyard_library_top` for surveil disposal (`to=graveyard`, rest library top); `parseMoveZoneThisCreatureAndTargetYouControl` + colored BF selector bounce; `parseMoveZoneCountTargetCardsFromSingleGraveyard` `useXValue` for `X target cards from a single graveyard`; `parseMoveZoneSingleCardFromEachPlayersGraveyard` `each graveyard` + `creature or planeswalker` compound type
- Audit enrich: library-top surveil fixtures (`lastMovedCards`); Snow Hound `bf-source` + blue creature; Rats' Feast single-GY + `xValue`; Narfi per-player GY creature/PW cards
- Tests: `rules-engine/test/oracleIRGapBatch296.test.ts`
- Audit: `unsupported_selector` **150 → 145** (−5); assisted **96.7%**; Candlestick, Snow Hound, Rats' Feast, King Narfi's Betrayal clusters cleared

#### Batch 297 (historic hand→BF + random them return + flashback GY exile + all library exile)
- Executor: `parseMoveZoneSingleTargetCriteria`/`parseMoveZoneTypedCardFromYourHand` `historic permanent` + `requiresHistoric`; `parseMoveZoneCountOfThemAtRandom` contextual shuffle return; `parseMoveZoneAllFromTargetPlayersGraveyard` `requiresFlashback` + `cardHasFlashbackAbility`; `parseMoveZoneAllFromYourLibrary` accepts `all the cards`
- Audit enrich: historic hand card; Sinister Waltz 3-creature GY fixture; Tombfire p2 flashback GY + `targetPlayerId`; Mirror of Fate library cards
- Tests: `rules-engine/test/oracleIRGapBatch297.test.ts`
- Audit: `unsupported_selector` **145 → 141** (−4); assisted **96.7%**; Thran Temporal Gateway, Sinister Waltz, Tombfire, Mirror of Fate clusters cleared

#### Batch 298 (Aberrant multi-GY return + Ghastly face-down pile + Kayla up-to-X among-them)
- Executor: `parseMoveZoneOneTwoOrThreeTargetCreatureCardsFromGraveyards`; `parseMoveZoneAllFromTargetPlayersGraveyard` face-down pile + `shuffleExiledPile`; `parseAmongThemTypeConstraints` compound `and/or`; `parseMoveZoneTypedCardFromAmongThem` `up to x … from among them` (`maxCount: -1`, `manaValueLte`); skip `parsedAmongThoseCardsEarly` single-card BF shortcut when `maxCount === -1` (Kayla multi-move)
- Audit enrich: Aberrant multi-GY creature targets; Ghastly p2 GY + `targetPlayerId`; Kayla library-top + `lastMovedCards` + `xValue`
- Tests: `rules-engine/test/oracleIRGapBatch298.test.ts`
- Audit: `unsupported_selector` **141 → 138** (−3); assisted **96.7%**; Aberrant Return, Ghastly Conscription, Kayla's Reconstruction clusters cleared

#### Batch 299 (that pile GY + Turntimber among-them + Aura Finesse attach)
- Executor: `parsedThatPile` graveyard destination from exile; `parseAmongThemSplitFromMoveZoneParts` `a creature card from among them` + `bfLibraryBottomSplit`; conditional `that card has mana value N or less`; attach resolver `target aura you control`
- Audit enrich: Abstract Performance exile pile + `chosenObjectIds`; Turntimber library-top + `lastMovedCards`; Aura Finesse aura/creature attach targets
- Tests: `rules-engine/test/oracleIRGapBatch299.test.ts`
- Audit: `unsupported_selector` **138 → 135** (−3); assisted **96.7%**; Abstract Performance, Turntimber Symbiosis, Aura Finesse clusters cleared

#### Batch 300 (GY creature/planeswalker MV X + Belbe chosen-type hand)
- Executor: `parseMoveZoneAllFromYourGraveyard` explicit `all creature and planeswalker … mana value X`; `parseStaticManaValueLteConstraint` compound types + `x`; `parseMoveZoneSingleTypedCardFromYourGraveyard` non-target single GY card; `parseMoveZoneTypedCardFromYourHand` `creature card of the chosen type`; `parsedFromGraveyard` criteria BF put with X resolution
- Audit enrich: creature/planeswalker GY fixtures + `xValue` + `chosenObjectIds`; Belbe hand Elf + `chosenCreatureType`
- Tests: `rules-engine/test/oracleIRGapBatch300.test.ts`
- Audit: `unsupported_selector` **135 → 130** (−5); assisted **96.7%**; Ascend from Avernus, Blood on the Snow, Belbe's Portal clusters cleared

#### Batch 301 (Dragon named exile + Aetherspouts attacking + Split GY piles)
- Parser: explicit `for each attacking creature, its owner puts…`; fix possessive `'s` regex false match on `its`
- Executor: `parseMoveZoneThisCardAndNamedCardsFromYourGraveyard`; `parseMoveZoneEachAttackingCreature`; `parseMoveZoneExileUpToTargetPermanentsFromGySplitTwoPiles`
- Audit enrich: Dragon's Approach named GY fixtures + `sourceId`; Aetherspouts attacking BF permanent; Split the Spoils GY permanents + `chosenObjectIds`
- Tests: `rules-engine/test/oracleIRGapBatch301.test.ts`
- Audit: `unsupported_selector` **130 → 127** (−3); assisted **96.7%**; Dragon's Approach, Aetherspouts, Split the Spoils clusters cleared

#### Batch 302 (each-player hand count + adventure GY + exiled-with creature)
- Executor: `requiresAdventure` criteria + `card that has an adventure`; `parseMoveZoneCountCardsFromEachPlayersHand` + `exileUpToCountFromHand`; `each creature card exiled with this artifact` in `parseMoveZoneAllExiledWithThisPermanent`
- Audit enrich: Mind Swords multi-player hand + `chosenObjectIds`; Edgewall adventure GY card; Ghost Vacuum exiled-with creature fixtures + `sourceId`
- Tests: `rules-engine/test/oracleIRGapBatch302.test.ts`
- Audit: `unsupported_selector` **127 → 122** (−5); assisted **96.7%**; Mind Swords, Edgewall Inn, Ghost Vacuum clusters cleared

#### Batch 303 (aegis exile return + up-to-one milled enchant + sorcery GY audit)
- Executor: `parseMoveZoneAllExiledCardsWithCounter` + `findAllExiledCardsWithCounter`; `up to one {type} card milled this way` in `parseMoveZoneAllCardsMilledThisWay` (`maxCount: 1`)
- Audit enrich: Livio aegis-counter exile fixtures; Terra milled enchantment GY + `lastMilledCards`; Mirari sorcery `inferGraveyardTargetIdFromWhatText` → `gy-red-sorcery-1`
- Tests: `rules-engine/test/oracleIRGapBatch303.test.ts`
- Audit: `unsupported_selector` **122 → 119** (−3); assisted **96.7%**; Livio, Terra/Esper Terra, The Mirari Conjecture clusters cleared

#### Batch 304 (any-number different names GY / count exiled-with saga / each GY-this-way)
- Executor: `parseMoveZoneAnyNumberFromYourGraveyard` + `differentNames` + `selectGraveyardCardIdsWithDifferentNames`; `parseMoveZoneCountCardsExiledWithThisPermanent` + rest-to-owners-library; `each card put into a graveyard this way` in `parseMoveZoneCardPutIntoGraveyardThisWay`; `moveTargetedCardFromExile` library_top/bottom support
- Audit enrich: Eerie GY permanents + `chosenObjectIds`; Vault 13 exiled-with saga fixtures + `sourceId`; Sorin `putIntoGraveyardTurn` GY cards
- Tests: `rules-engine/test/oracleIRGapBatch304.test.ts`
- Audit: `unsupported_selector` **119 → 116** (−3); assisted **96.7%**; Eerie Ultimatum, Vault 13, Sorin Lord of Innistrad clusters cleared

#### Batch 305 (permanent among-them MV / discarded-this-way land / opponent choice bounce)
- Executor: `up to N permanent cards with mana value X or less from among them` → `bfLibraryBottomSplit`; `parseMoveZoneAllCardsDiscardedThisWay` + BF tapped handler; `parseMoveZoneOpponentChoicePermanentToHand` + opponent permanent bounce
- Audit enrich: Storm library-top + `lastMovedCards`; Mind Roots `lastDiscardedCards` + p2 GY land; Teferi opponent BF permanent + `targetPlayerId`
- Tests: `rules-engine/test/oracleIRGapBatch305.test.ts`
- Audit: `unsupported_selector` **116 → 113** (−3); assisted **96.7%**; Storm the Festival, Mind Roots, Teferi Temporal Pilgrim clusters cleared

#### Batch 306 (another unless-pays / all colored permanents / revealed to GY)
- Executor: `another target X` in `parseMoveZoneCountTargetBattlefieldBounce`; `parseMoveZoneUnlessPaysManaFromStepText`; `parseMoveZoneAllColoredPermanentsToHand`; basic land color inference in `collectCardColors`; `parsedTheRevealedCards` graveyard path
- Audit enrich: Withdraw BF creatures + `unlessPaysManaChoice`; Hibernation green/blue BF fixtures; Dakra `lastMovedCards` library-top reveal
- Tests: `rules-engine/test/oracleIRGapBatch306.test.ts`
- Audit: `unsupported_selector` **113 → 110** (−3); assisted **96.7%**; Withdraw, Hibernation, Dakra Mystic clusters cleared

#### Batch 307 (hand face-down exile / destroyed-this-way GY return / compound mass exile)
- Executor: `parseMoveZoneAnyNumberFromYourHandFaceDown` + face-down `exileUpToCountFromHand`; `lastReferenceAmount` carry-over for `that many cards from the top of your library` → hand; `parseMoveZoneAllCardsDestroyedThisWayFromYourGraveyard`; `parseMoveZoneCompoundArtifactCreatureLandGyHandsExile`
- Audit enrich: Scroll Rack hand + library-top fixtures + `referenceAmount`; Cleansing Meditation `lastMovedCards` GY fixtures; Decree BF/GY/hand multi-player fixtures
- Tests: `rules-engine/test/oracleIRGapBatch307.test.ts`
- Audit: `unsupported_selector` **110 → 106** (−4); assisted **96.7%** (46405/47969); Scroll Rack (2 clusters), Cleansing Meditation, Decree of Annihilation cleared

#### Batch 308 (opponent hand to library top / GY put-there-this-turn / or-type milled to BF)
- Executor: `parseMoveZoneTheCardsFromTargetOpponentHand` + opponent all-hand library-top move; existing `parseMoveZoneSingleTargetFromAGraveyard` audit enrich for put-there-this-turn; comma-or fix in `parseAmongMilledOrTypeClause` + battlefield handler for or-type milled cards
- Audit enrich: Head Games p2 hand + `targetPlayerId`; Abyssal Harvester `putIntoGraveyardTurn: 3` + `chosenObjectIds`; Bramble milled GY fixtures + `lastMilledCards`
- Tests: `rules-engine/test/oracleIRGapBatch308.test.ts`
- Audit: `unsupported_selector` **106 → 103** (−3); assisted **96.7%** (46408/47969); Head Games, Abyssal Harvester, Bramble Familiar // Fetch Quest clusters cleared

#### Batch 309 (hand+GY shuffle / saga+exiled to hand / up-to-X permanent GY)
- Executor: `parseMoveZoneYourGraveyardAndHand` + `shufflePlayerHandAndGraveyardIntoLibrary`; `parseMoveZoneThisPermanentAndTheExiledCard` + saga bounce + linked exile return; `up to x … cards from your graveyard` branch in `parseMoveZoneUpToTargetCountFromYourGraveyard`
- Audit enrich: Trenzalore hand+GY fixtures; Aesir saga BF + linked exile card + `sourceId`; Uncle's Musings GY permanents + `xValue: 3` + `chosenObjectIds`
- Tests: `rules-engine/test/oracleIRGapBatch309.test.ts`
- Audit: `unsupported_selector` **103 → 100** (−3); assisted **96.8%** (46411/47969); Trenzalore Clocktower, The Aesir Escape Valhalla, Uncle's Musings clusters cleared

#### Batch 310 (any-number target bounce / GY-this-way return / each creature GY+finality)
- Executor: generic `any number of target X` in `parseMoveZoneCountTargetBattlefieldBounce`; passive `a … card put into your graveyard this way` in `parseMoveZoneCardPutIntoGraveyardThisWay` + `lastMovedCards` BF handler; `each … from your graveyard` in `parseMoveZoneAllFromYourGraveyard`
- Audit enrich: Kiora's BF enchantments + `chosenObjectIds`; Starfall `lastMovedCards` GY creature; Shilgengar GY creature fixtures
- Tests: `rules-engine/test/oracleIRGapBatch310.test.ts`
- Audit: `unsupported_selector` **100 → 91** (−9); assisted **96.8%** (46420/47969); Kiora's Dismissal, Starfall Invocation, Shilgengar clusters cleared (+6 bonus clusters from generic any-number-target bounce)

#### Batch 311 (untyped single-GY exile / all commanders CZ→BF / all attacking bounce)
- Executor: untyped `N target cards from a single graveyard` in `parseMoveZoneCountTargetCardsFromSingleGraveyard`; `parseMoveZoneAllCommandersFromCommandZone` + all-players CZ→BF handler; `all attacking creatures` in `parseMoveZoneEachAttackingCreature` + hand bounce handler
- Audit enrich: Pestilent Cauldron GY fixtures + `chosenObjectIds`; Tevesh p1/p2 command zone commanders; Aetherize attacking BF fixtures
- Tests: `rules-engine/test/oracleIRGapBatch311.test.ts`
- Audit: `unsupported_selector` **91 → 88** (−3); assisted **96.8%** (46423/47969); Pestilent Cauldron // Restorative Burst, Tevesh Szat, Aetherize clusters cleared

#### Batch 312 (one-or-two nonland bounce / power-GTE among-them BF+library / target library exile)
- Executor: `one or two target nonland permanents` in `parseMoveZoneCountTargetBattlefieldBounce`; `powerGte` + `a creature card with power N or greater from among them` + `bfLibraryBottomSplit` in `parseMoveZoneTypedCardFromAmongThem`; `parseMoveZoneAllFromTargetPlayersLibrary` + `moveAllMatchingFromLibrary`
- Audit enrich: Wanderwine BF nonland fixtures + `chosenObjectIds`; Mayael library-top `lastMovedCards` + power-6 creature choice; Jace p2 library + `targetPlayerId`
- Tests: `rules-engine/test/oracleIRGapBatch312.test.ts`
- Audit: `unsupported_selector` **88 → 85** (−3); assisted **96.8%** (46426/47969); Wanderwine Farewell, Mayael the Anima, Jace the Mind Sculptor clusters cleared

#### Batch 313 (artifact+all-GY exile / hand top-or-bottom both / gy+bf dual return)
- Executor: `parseMoveZoneThisArtifactAndAllCardsFromAllGraveyards` + source BF exile + all-GY exile; `topOrBottomBoth` in `parseMoveZoneCountFromYourHand` + library placement handler; `parseMoveZoneTargetCreatureFromGraveyardAndTargetCreatureOnBattlefield` + dual hand return
- Audit enrich: Silent Gravestone BF source + multi-player GY; Dream Cache hand fixtures + `libraryPlacement: bottom`; Rise // Fall GY creature + BF creature + `chosenObjectIds`
- Tests: `rules-engine/test/oracleIRGapBatch313.test.ts`
- Audit: `unsupported_selector` **85 → 82** (−3); assisted **96.8%** (46429/47969); Silent Gravestone, Dream Cache, Rise // Fall clusters cleared

#### Batch 314 (GY target return / opponent-choice from your GY)
- Executor: `parseMoveZoneOpponentChoiceFromTargetPlayersGraveyard` regex extended for `an opponent's choice from your graveyard` + `fromHandOrGraveyardOwner`; hand/battlefield handlers use controller GY when owner is controller; `tap_matching_permanents` merges `chosenObjectIds` instead of replacing (fixes When-you-do + GY return chains)
- Audit enrich: Tasigur p1 GY fixtures + opponent `chosenObjectIds`; `needsTargetFromYourGraveyard` (nested-step aware) for Myr + creature-mv≤3 return patterns
- Tests: `rules-engine/test/oracleIRGapBatch314.test.ts`
- Audit: `unsupported_selector` **82 → 80** (−2); assisted **96.8%** (46431/47969); Meanders Guide, Myr Reservoir, Tasigur clusters cleared

#### Batch 315 (mass BF+GY exile / any-number hand shuffle / chosen-type X bounce)
- Executor: `parseMoveZoneCompoundBattlefieldAndGraveyardMassReturn` extended for mv≤3 creatures+planeswalkers BF+all-GYs exile; `parseMoveZoneAnyNumberCardsFromYourHand` + `shuffleSelectedCardsFromHandIntoLibrary`; `usesChosenCreatureType` on `SimpleBattlefieldSelector` + `permanentMatchesSelector` for X target creatures of chosen type
- Audit enrich: Shadows' Verdict BF+GY fixtures; Credit Voucher hand fixtures + `chosenObjectIds`; Selective Snare Elf/Goblin BF + `chosenCreatureType` + `xValue`
- Tests: `rules-engine/test/oracleIRGapBatch315.test.ts`
- Audit: `unsupported_selector` **80 → 76** (−4); assisted **96.8%** (46435/47969); Shadows' Verdict, Credit Voucher, Selective Snare clusters cleared

#### Batch 316 (all creature tokens bounce / multicolored GY return / owner library choice)
- Executor: `parseMoveZoneAllCreatureTokens` + `tokenOnly` on `SimpleBattlefieldSelector`; `parseStaticManaValueLteConstraint` for `multicolored permanent` + mv≤N; `parseMoveZoneTargetCreatureOwnerLibraryChoice` (matches from `step.raw` when `what.text` is truncated)
- Audit enrich: `needsMulticoloredFromGraveyard` nested-step aware + Empyrean Eagle GY fixture + `chosenObjectIds`; `needsAllCreatureTokensBounce` token BF fixtures; `needsTargetCreatureOwnerLibraryChoice` + `bf-audit-ice-target` + `libraryPlacement`
- Tests: `rules-engine/test/oracleIRGapBatch316.test.ts`
- Audit: `unsupported_selector` **76 → 73** (−3); assisted **96.8%** (46438/47969); Perplexing Test, Obscura Charm, Ice Magic clusters cleared

#### Batch 317 (noncreature nonland among-them BF / this card + target land GY / unearth return)
- Executor: generic `up to N TYPE cards with mana value X or less from among them` in `parseAmongThemSplitFromMoveZoneParts`; `parseMoveZoneThisCardAndTargetFromYourGraveyard` + dual GY→BF tapped handler
- Audit enrich: United Battlefront library `lastMovedCards` + chosen artifact/enchantment; Sandman self+land GY fixtures + `sourceId`/`sourceName`; Salvation Colossus `needsReturnThisCardFromGraveyardToBattlefield` self GY fixture
- Tests: `rules-engine/test/oracleIRGapBatch317.test.ts`
- Audit: `unsupported_selector` **73 → 70** (−3); assisted **96.8%** (46440/47969); United Battlefront, Sandman, Salvation Colossus clusters cleared

#### Batch 318 (counted target GY return / aura reattach / mass noncreature nonland bounce)
- Executor: `parseMoveZoneCountFromYourGraveyard` for `N target cards from your graveyard`; `returnExactMatchingFromGraveyardToHand` honors `chosenObjectIds`; `parseMoveZoneAllNoncreatureNonlandPermanentsToHand`; attach resolver for `target Aura attached to a permanent` + host-aware `another permanent with the same controller`
- Audit enrich: Restock GY fixtures + 2 chosen ids; Filter Out artifact/enchantment/creature BF fixtures; Simic Guildmage host/target/aura BF fixtures
- Tests: `rules-engine/test/oracleIRGapBatch318.test.ts`
- Audit: `unsupported_selector` **70 → 67** (−3); assisted **96.8%** (46443/47969); Restock, Simic Guildmage, Filter Out clusters cleared

#### Batch 319 (snow among-them / all tapped bounce / GY or flashback exile return)
- Executor: `parseAmongThemTypeConstraints` snow permanent (`typeLineTermsAnyOf: ['snow']`); `parseMoveZoneAllTappedCreatures` + `parseSimpleBattlefieldSelector` tapped-in-remainder fix; `parseMoveZoneSingleTargetInstantOrSorceryFromGraveyardOrOwnedFlashbackExile` + GY-first then owned flashback exile handler
- Audit enrich: Glacial Revelation `lastMovedCards` snow/non-snow + chosen snow ids; Time of Ice tapped/untapped BF fixtures; Sorceress's Schemes GY instant + owned exile flashback + `chosenObjectIds`
- Tests: `rules-engine/test/oracleIRGapBatch319.test.ts`
- Audit: `unsupported_selector` **67 → 64** (−3); assisted **96.8%** (46443/47969); Glacial Revelation, Time of Ice, Sorceress's Schemes clusters cleared

#### Batch 320 (half creatures bounce / up-to-X single GY exile / that-card BF + rest GY)
- Executor: `parseMoveZoneHalfCreaturesTheyControlRoundedUp` + ceil-half bounce handler; `parseMoveZoneCountTargetCardsFromSingleGraveyard` extended for `up to X target cards from a single graveyard`; `parsedThatCardToBattlefield` handler + `parsedTheRestToGraveyard` excludes `chosenObjectIds`; postprocess split for `put that card onto the battlefield and the rest into your graveyard`
- Audit enrich: Split the Party p2 BF creatures + `targetPlayerId`; Martyr of Bones GY fixtures + `xValue`; Animal Magnetism `lastMovedCards` + chosen creature id
- Tests: `rules-engine/test/oracleIRGapBatch320.test.ts`
- Audit: `unsupported_selector` **64 → 61** (−3); assisted **96.8%** (46446/47969); Split the Party, Martyr of Bones, Animal Magnetism clusters cleared

#### Batch 321 (bottom library to GY / up-to-five creature GY exile)
- Executor: `moveBottomCardFromLibrary` + `parseMoveZoneBottomCardFromLibrary` + bottom-library owner resolver; `parseMoveZoneUpToTargetCardsFromGraveyards` extended for typed `up to N target TYPE cards from graveyards`
- Audit enrich: Cellar Door p2 library bottom fixture + `targetPlayerId`; Grenzo controller library bottom fixture; Boneyard Parley GY creature fixtures + chosen ids
- Tests: `rules-engine/test/oracleIRGapBatch321.test.ts`
- Audit: `unsupported_selector` **61 → 58** (−3); assisted **96.8%** (46449/47969); Cellar Door, Grenzo, Dungeon Warden, Boneyard Parley (exile step) clusters cleared

#### Batch 322 (Boneyard Parley pile / Trial // Error combat bounce / Planar Overlay those lands)
- Parser postprocess: split Boneyard Parley compound into `all cards from the pile of your choice` → battlefield + `the rest` → owners' graveyards
- Executor: `parseMoveZoneAllCardsFromPileOfYourChoice` + chosen-pile exile→BF handler; `parseMoveZoneAllCreaturesBlockingOrBlockedByTargetCreature` + combat bounce (excludes target); `parseMoveZoneThoseLands` + contextual land bounce; `resolveCreaturesBlockingOrBlockedByTarget` helper
- Audit enrich: Boneyard Parley exile pile fixtures + `lastExiledCards`/`chosenObjectIds`; Trial // Error blocking/blocker BF fixtures + `targetCreatureId`; Planar Overlay land BF fixtures + `lastMovedCards`
- Tests: `rules-engine/test/oracleIRGapBatch322.test.ts`
- Audit: `unsupported_selector` **58 → 55** (−3); assisted **96.8%** (46452/47969); Boneyard Parley (pile step), Trial // Error, Planar Overlay clusters cleared

#### Batch 323 (planeswalker MV X from GY / graveyards-this-way return / this permanent when token dies)
- Executor: existing `parseMoveZoneSingleTargetFromYourGraveyard` path for Confront the Past (audit enrich only); `parseMoveZoneUpToCreatureCardsPutIntoGraveyardsThisWay` + multi-GY return handler; `inferPreferredSourceCardZones` extended for `return this permanent … to the battlefield` (Tatsumasa uses existing `sourceCardZone` handler)
- Audit enrich: Confront the Past GY planeswalker + `xValue`/`chosenObjectIds`; Danse Macabre sacrificed creature fixtures + `lastMovedCards`/`lastSacrificedPermanents`; Tatsumasa source permanent in GY + `sourceId`/`sourceName`
- Tests: `rules-engine/test/oracleIRGapBatch323.test.ts`
- Audit: `unsupported_selector` **55 → 52** (−3); assisted **96.8%** (46455/47969); Confront the Past, Danse Macabre, Tatsumasa clusters cleared

#### Batch 324 (Cryptic Gateway hand put / Worldfire hands+GY exile / Restore the Peace damage bounce)
- Executor: `parseMoveZoneCreatureFromHandSharingTypeWithEachTappedThisWay` + `lastTappedMatchingPermanentIds` type-matching hand→BF handler; `parseMoveZoneAllCardsFromAllHandsAndGraveyards` + mass hand/GY exile handler; `parseMoveZoneEachCreatureThatDealtDamageThisTurn` + `dealtDamageThisTurn` bounce handler
- Audit enrich: Cryptic Gateway tapped goblin BF fixtures + hand goblin + `lastTappedMatchingPermanentIds`; Worldfire hand/GY fixtures per player; Restore the Peace `dealtDamageThisTurn` creature fixture
- Tests: `rules-engine/test/oracleIRGapBatch324.test.ts`
- Audit: `unsupported_selector` **52 → 49** (−3); assisted **96.8%** (46457/47969); Cryptic Gateway, Worldfire, Restore the Peace clusters cleared

#### Batch 325 (target Dinosaur from GY / two creature cards from hand / lowest toughness bounce)
- Executor: existing `parseMoveZoneSingleTargetFromYourGraveyard` for Atzocan Seer (audit enrich only); `parseMoveZoneCountTypedCards` + count-limited hand→BF handler; `parseMoveZoneCreatureYouDontControlLowestToughness` + lowest-toughness opponent bounce handler
- Audit enrich: Atzocan Seer GY Dinosaur + `chosenObjectIds`; See the Unwritten hand creature fixtures + two chosen ids; Bounce Chamber opponent BF toughness fixtures + `bf-bc-low` chosen id
- Tests: `rules-engine/test/oracleIRGapBatch325.test.ts`
- Audit: `unsupported_selector` **49 → 46** (−3); assisted **96.9%** (46461/47969); Atzocan Seer, See the Unwritten, Bounce Chamber clusters cleared

#### Batch 326 (that-many GY creatures to BF / sea-type exclusion bounce / opponents hand+GY exile)
- Executor: `parseMoveZoneThatManyCreatureCardsFromYourGraveyard` + reference-count GY→BF handler; `parseMoveZoneEachCreatureExcludingListedTypes` + type-exclusion bounce handler (`permanentHasAnyListedCreatureType`); `parseMoveZoneAllCardsFromAllOpponentsHandsAndGraveyards` + opponents-only hand/GY exile handler
- Audit enrich: Lich-Knights GY creature fixtures + `referenceAmount`/chosen ids; Summon Leviathan kraken/merfolk/human BF fixtures; Ashiok opponent hand/GY fixtures (controller hand preserved)
- Tests: `rules-engine/test/oracleIRGapBatch326.test.ts`
- Audit: `unsupported_selector` **46 → 43** (−3); assisted **96.9%** (46464/47969); Lich-Knights' Conquest, Summon: Leviathan, Ashiok, Nightmare Weaver clusters cleared

#### Batch 327 (hand creature total P+T put / same-name mass exile / among-them exile rest bottom)
- Executor: `parseMoveZoneCreatureHandTotalPowerToughnessLte` + `cardMatchesTotalPowerToughnessLte` optional hand→BF handler; `parseMoveZoneTargetNonlandSameNameMassExile` + `exileAllSameNamedCardsFromAllGraveyards` + same-named BF exile handler; `parseMoveZoneUpToOneNonlandAmongThemRestLibraryBottom` + contextual among-them exile/rest-bottom handler; `moveContextualCardToDestination` library→exile support
- Audit enrich: Meek Attack hand small/big creature fixtures + chosen id; Moratorium Stone Lightning Bolt GY/BF fixtures across players + chosen target id; Duelist's Flame library reveal fixtures + `lastMovedCards`/chosen nonland id
- Tests: `rules-engine/test/oracleIRGapBatch327.test.ts`
- Audit: `unsupported_selector` **43 → 40** (−3); assisted **96.9%** (46467/47969); Meek Attack, Moratorium Stone, Duelist's Flame clusters cleared

#### Batch 348 (specific kicker / warrior subtype / gy entry / life vs starting)
- Evaluators: `was kicked with its … kicker`; `this creature is a {subtype}`; graveyard entry antecedent; `you have at least N life more than your starting life total`
- Audit enrich: wasKicked source; warrior source type_line; gy-entry antecedent fixtures; p1 life 55 + startingLife 40
- Tests: `rules-engine/test/oracleIRGapBatch348.test.ts`
- Audit: `unsupported_condition_clause` **680 → 653** (−27); assisted **97.2%** (46624/47969); Sunscape Battlemage, Ascendant Spirit, Kotis, Angel of Destiny clusters cleared (+ `that spell was kicked` side effect)

#### Batch 347 (dragon beheld / no artifacts / no creatures / not a token)
- Evaluators: generic `a {quality} was beheld` + `beheldQuality`; `you control no artifacts`; `no creatures are on the battlefield`; `it's not a token`
- Context: `beheldQuality` on execution context
- Audit enrich: dragon beheld flag; strip controller artifacts; strip all creatures; nontoken target fixture
- Tests: `rules-engine/test/oracleIRGapBatch347.test.ts`
- Audit: `unsupported_condition_clause` **692 → 680** (−12); assisted **97.1%** (46599/47969); Osseous Exhale, Tezzeret's Ambition, Pyrohemia, Life of the Party clusters cleared

#### Batch 346 (opponent life lead / empty hand / no attack / team warrior)
- Evaluators: `an opponent has more life than you`; `that player has no cards in hand`; `this creature didn't attack this turn`; generic `your team controls another {subtype}` + `getTeamPlayerIds`
- Audit enrich: p2 higher life; p2 empty hand + target id; source `attackedThisTurn: false`; source + ally warrior fixtures
- Tests: `rules-engine/test/oracleIRGapBatch346.test.ts`
- Audit: `unsupported_condition_clause` **704 → 692** (−12); assisted **97.1%** (46588/47969); Linvala, Asylum Visitor, Erg Raiders, Sickle Dancer clusters cleared

#### Batch 345 (non-hand cast / zero mana / would-lose / no untapped lands)
- Evaluators: `this spell was cast from anywhere other than your hand`; `noManaSpentToCast`; `would lose the game` + `wouldLoseTheGame`; `you control no untapped lands`
- Context: `noManaSpentToCast`, `wouldLoseTheGame` on execution context
- Audit enrich: `castFromZone: graveyard`; zero-mana flag; would-lose flag; tap all controller lands
- Tests: `rules-engine/test/oracleIRGapBatch345.test.ts`
- Audit: `unsupported_condition_clause` **717 → 704** (−13); assisted **97.1%** (46576/47969); Otterball Antics, Vexing Bauble, Exquisite Archangel, Well of Life clusters cleared

#### Batch 344 (creature-mana spend / seven-card hand / life lead / no monarch)
- Evaluators: `manaSpentOnCreatureSpell`; generic `you have N or more cards in hand`; `you have more life than an opponent`; `there is no monarch`
- Context: `manaSpentOnCreatureSpell` on execution context
- Audit enrich: creature-mana flag; 7-card hand fixture; p1 life > p2/p3; clear `monarch`
- Tests: `rules-engine/test/oracleIRGapBatch344.test.ts`
- Audit: `unsupported_condition_clause` **730 → 717** (−13); assisted **97.1%** (46566/47969); Generator Servant, Kiyomaro, Glorious Enforcer, Crown of Gondor clusters cleared

#### Batch 343 (creature-cast-this-way / untapped source / hand lead / had counters)
- Evaluators: `creatureSpellCastThisWay` + `you cast a creature spell this way`; `this creature is untapped`; `youHaveMoreCardsInHandThanEachOpponent`; `it had one or more counters on it`
- Context: `creatureSpellCastThisWay` on execution context
- Audit enrich: creature-cast-this-way flags; untapped source fixture; hand-size lead (p1 > p2/p3); countered creature target id
- Tests: `rules-engine/test/oracleIRGapBatch343.test.ts`
- Audit: `unsupported_condition_clause` **742 → 730** (−12); assisted **97.0%** (46553/47969); Alaundo, Reveille Squad, Death of a Thousand Stings, Nikara clusters cleared

#### Batch 342 (was-cast / crime / legendary / ring-bearer choice)
- Evaluators: `it was cast` via `wasCast`/`castFromZone`; `you've committed a crime this turn` via `committedCrimeThisTurn`; `it's legendary` on target permanent; `you chose a creature other than this permanent as your Ring-bearer` via `chosenRingBearerId`
- Context: `wasCast`, `chosenRingBearerId` on execution context
- Audit enrich: cast/hand fixtures; crime turn flag; legendary target id; alternate ring-bearer id on player + ctx
- Tests: `rules-engine/test/oracleIRGapBatch342.test.ts`
- Audit: `unsupported_condition_clause` **754 → 742** (−12); assisted **97.0%** (46542/47969); Wedding Ring, Servant of the Stinger, Gimli's Fury, Aragorn clusters cleared

#### Batch 341 (would-enter land / no time counters / not cast from hand / gained-or-lost life)
- Evaluators: `would enter` in `evaluateWouldReplacementClause`; generic `it had no … counters on it` (time/+1/+1); `you didn't cast it from your hand` via `castFromZone`; `you gained or lost life this turn` with composite-or guard in `splitCompositeCondition`
- Audit enrich: `castFromZone: graveyard` for not-from-hand ETB; `lifeGainedThisTurn` seed for gained-or-lost-life end-step triggers
- Tests: `rules-engine/test/oracleIRGapBatch341.test.ts`
- Audit: `unsupported_condition_clause` **766 → 754** (−12); assisted **97.0%** (46530/47969); Lotus Vale, Deadly Grub, Phage, Starlit Soothsayer clusters cleared

#### Batch 340 (mana-ability copy / cast-this-way / dragon-cast / additional-cost / dies-this-way)
- Evaluators: `it isn't a mana ability`; `you cast a spell this way` + `that creature dies this way` in `evaluateThisWayClause`; dragon-cast + mana-ability in extended evaluators; `this spell's additional cost was paid` in wrapper
- Context: `activatedAbilityIsManaAbility`, `spellCastThisWay`, `revealedDragonAsCast`, `controlledDragonAsCast`, `creatureDiedThisWay` on execution context
- Audit enrich: conditional fixtures for all five cluster patterns in `enrichAuditStateAndContextForTargets`
- Tests: `rules-engine/test/oracleIRGapBatch340.test.ts`
- Audit: `unsupported_condition_clause` **785 → 766** (−19); assisted **97.0%** (46521/47969); top count-4 clusters cleared (Bracers/Rings, Noctis cast-this-way, Dragon cast rider, Spirit Water additional cost)

#### Batch 339 (Serene permanent+GY shuffle / Research outside game / Blood another GY / Command attacking bounce)
- Parser: `parseMoveZoneThisPermanentAndUpToTargetFromSingleGraveyard`; `parseMoveZoneUpToCountCardsYouOwnFromOutsideGame`; `one or two target` in `parseMoveZoneCountTargetBattlefieldBounce`; `attackingOnly` in `parseSimpleBattlefieldSelector`
- Executor: permanent+single-GY library shuffle; sideboard→library shuffle; `moveAnotherMatchingCardFromYourGraveyard` hand path (excludes `lastMovedCards`); attacking-creature bounce via count-target handler
- Audit enrich: Serene BF source + GY fixtures; Research sideboard fixtures; Blood dual GY + `lastMovedCards`; Command attacking BF fixtures
- Tests: `rules-engine/test/oracleIRGapBatch339.test.ts`
- Audit: `unsupported_selector` **4 → 0** (−4); assisted **96.9%** (46504/47969); **full_card selector gaps cleared**

#### Batch 338 (Rowan library-top/GY split / Ramosian rebel GY return / Vivien any-number milled)
- Parser: `count_library_top_graveyard_rest` in `parseMoveZoneContextualThemSplit`; subtype+permanent MV-lte in `parseStaticManaValueLteConstraint`; `any number of … milled this way` in `parseMoveZoneAllCardsMilledThisWay`
- Executor: contextual them split handler (up to N to library top, rest to GY); multi-card milled-this-way hand path when `anyNumber`
- Audit enrich: Rowan looked-at library fixtures + chosen top ids; Ramosian rebel GY fixture; Vivien milled creature fixtures + `lastMilledCards`
- Tests: `rules-engine/test/oracleIRGapBatch338.test.ts`
- Audit: `unsupported_selector` **7 → 4** (−3); assisted **96.9%** (46501/47969); Rowan's Grim Search, Ramosian Revivalist, Vivien on the Hunt clusters cleared

#### Batch 337 (Shrouded Lore last-chosen / Liliana GY creatures to BF / Codsworth aura-or-equipment attach)
- Parser: `parseMoveZoneLastChosenCard` for `the last chosen card`; extended `parseMoveZoneUpToTargetCardsFromGraveyards` for `up to N typed cards from graveyards` (non-target)
- Executor: `parsedLastChosenCard` cross-player steal (opponent GY → controller hand); `parsedUpToFromGraveyards` battlefield path (was exile-only); combined `target Aura or Equipment you control` in `resolveAttachmentPermanentIds`
- Audit enrich: Shrouded Lore opponent GY discard + `lastMovedCards`/chosen id; Liliana GY creature fixtures + two chosen ids; Codsworth BF equipment + creature fixtures
- Tests: `rules-engine/test/oracleIRGapBatch337.test.ts`
- Audit: `unsupported_selector` **10 → 7** (−3); assisted **96.9%** (46498/47969); Shrouded Lore, Liliana, the Necromancer, Codsworth, Handy Helper clusters cleared

#### Batch 336 (Reenact GY-this-turn / Hurkyl owned artifacts / Back for Seconds BF-instead)
- Parser: `parseMoveZoneSingleTargetFromAGraveyard` accepts `in a graveyard`; `parseMoveZoneAllTypedCardsTargetPlayerOwns`; `one of those cards with mana value N or less` among-them; postprocess upgrade for BF-instead-of-hand optional clause
- Executor: `returnAllOwnedMatchingCardsToPlayerHand` (battlefield + all zones by owner); among-them single-card path already uses full criteria
- Audit enrich: Reenact GY instant + `putIntoGraveyardTurn`; Hurkyl p2 BF/GY artifacts + `targetPlayerId`; Back for Seconds returned GY creatures + `lastMovedCards`
- Tests: `rules-engine/test/oracleIRGapBatch336.test.ts`
- Audit: `unsupported_selector` **13 → 10** (−3); assisted **96.9%** (46495/47969); Reenact the Crime, Hurkyl's Recall, Back for Seconds clusters cleared

#### Batch 335 (Niko foretell GY / Ballad historic among-them / Leonardo one-or-two GY)
- Parser: `requiresForetell` + `cardHasForetellAbility` in `parseMoveZoneSingleTargetCriteria`; `historic` in `parseAmongThemTypeConstraints`; `one or two target` + `each with mana value` in `parseMoveZoneUpToTargetCountFromYourGraveyard` / `parseStaticManaValueLteConstraint`
- Executor: among-them single-card GY path passes full `effectiveCriteria` (historic/foretell matching)
- Audit enrich: Niko GY foretell fixture; Ballad milled historic/nonhistoric GY fixtures + `lastMovedCards`; Leonardo GY creature fixtures + two chosen ids
- Tests: `rules-engine/test/oracleIRGapBatch335.test.ts`
- Audit: `unsupported_selector` **17 → 13** (−4); assisted **96.9%** (46492/47969); Niko Defies Destiny, Ballad of the Black Flag, Leonardo's Technique clusters cleared (+ Trystan's Command side effect)

#### Batch 334 (Recommission ETB counters / Patron hand lands / Tezzeret face-down hand)
- Parser: `parseMoveZoneUpToTargetCountFromYourHand`; `parseMoveZoneAnyNumberCardsFromYourHand` battlefield handler; `a creature enters this way` condition for `withCountersCondition`
- Audit enrich: Recommission GY creature fixture; Patron hand land fixtures; Tezzeret hand face-down fixtures
- Tests: `rules-engine/test/oracleIRGapBatch334.test.ts`
- Audit: `unsupported_selector` **22 → 17** (−5); assisted **96.9%** (46488/47969); Recommission, Patron of the Moon, Tezzeret, Cruel Machinist clusters cleared

#### Batch 333 (Bound color-X GY return / Northampton linked exile / Deploy Gatewatch among-them split)
- Parser: `parseMoveZoneUpToTargetCountFromYourGraveyard` for bare `up to x cards from your graveyard`; `parseMoveZoneSingleTargetFromLinkedExile` + `parseMoveZoneAllFromLinkedExile` accept `this land`; `buildAmongThemBattlefieldLibraryBottomCriteria` for generic `up to N typed cards from among them`
- Audit enrich: Bound sacrificed 2-color creature + `xValue: 2` + GY fixtures; Northampton land source + linked exile creature; Deploy library top planeswalkers + `lastMovedCards`
- Tests: `rules-engine/test/oracleIRGapBatch333.test.ts`
- Audit: `unsupported_selector` **25 → 22** (−3); assisted **96.9%** (46482/47969); Bound // Determined, Northampton Farm, Deploy the Gatewatch clusters cleared

#### Batch 332 (Nahiri GY exile / Five Doctors battlefield / Lady Sun dual bounce)
- Parser: `upgradeThoseCardsBattlefieldInsteadOfHandSteps` maps kicked `put those cards onto the battlefield instead of putting them into your hand` → `what: those cards`, `to: battlefield`
- Executor: `parseMoveZoneThisPermanentAndAnotherTargetCreature` + dual bounce handler; `creature_or_equipment` + `manaValueLtReferenceLoyalty` in `parseMoveZoneSingleTargetCriteria` / `resolveMoveZoneSingleTargetCriteriaWithX`
- Audit enrich: Nahiri planeswalker + GY fixtures; Five Doctors hand fixtures + `lastMovedCards`; Lady Sun source/target BF; copy-of-it enrich preserves prior `chosenObjectIds`
- Tests: `rules-engine/test/oracleIRGapBatch332.test.ts`
- Audit: `unsupported_selector` **28 → 25** (−3); assisted **96.9%** (46480/47969); Nahiri, The Five Doctors, Lady Sun clusters cleared

#### Batch 331 (chosen-this-way return / dual-target bounce / countered spell library bottom)
- Executor: `parseMoveZoneTypedCardFromAmongThem` extended for `each card chosen this way`; `parseMoveZoneThisCreatureAndAnotherTargetCreature` + dual bounce handler; `upgradeCounteredSpellLibraryTopReplacementSteps` extended for `put it on the bottom of its owner's library instead of` → `that spell` + library bottom
- Audit enrich: Rejoin the Fight controller GY chosen creature fixtures; Coastal Wizard source/target BF + `targetCreatureId`; countered-spell library bottom stack fixtures (extended predicate)
- Tests: `rules-engine/test/oracleIRGapBatch331.test.ts`
- Audit: `unsupported_selector` **31 → 28** (−3); assisted **96.9%** (46477/47969); Rejoin the Fight, Coastal Wizard, Spell Crumple clusters cleared

**Do not commit** unless asked.

---

## Copy-paste prompt for next session

```
Continue MTGEDH Track D Oracle IR executor gap closure — post batch 354 (full_card scope).

Read first: docs/oracle-ir-session-handoff.md, docs/oracle-ir-server-migration-plan.md § Current status.
Rules: .cursor/rules/oracle-ir-no-bespoke-handlers.mdc (generic parser/executor only; no card-name handlers).

Current metrics (full_card, post batch 354):
- unsupported_selector: 0 (cleared batch 339)
- unsupported_condition_clause: 603 (572 unique clusters)
- ir_gap: 132
- Assisted: 97.3% (46674/47969)
- All batches 264–354 uncommitted unless user asks to commit

Next batch (355) — condition clusters from executor-fullcard-condition-gap-analysis.json:
1. that player controls more lands than you — Keeper of the Accord / Archaeomancer's Map
2. you have fewer than seven cards in hand — Kozilek, the Great Distortion / Damia, Sage of Stone
3. its surge cost was paid — Reckless Bushwhacker / Tyrant of Valakut
4. you put a counter on a creature this turn — Lord Jyscal Guado / Lasting Tarfire

Workflow per batch:
1. npx tsx scripts/executor-fullcard-condition-gap-analysis.ts (or read server/scripts/out/executor-fullcard-condition-gap-analysis.json)
2. server/scripts/_tmp-probe-batchNNN.ts probe (delete after batch)
3. Generic evaluators in rules-engine/src/oracleIRExecutorConditionalStepSupport*.ts; audit enrich in server/scripts/executor-coverage-audit.ts
4. rules-engine/test/oracleIRGapBatchNNN.test.ts (≈5–6 tests)
5. npx vitest run test/oracleIRGapBatchNNN.test.ts
6. EXECUTOR_COVERAGE_SCOPE=full_card npm run executor:coverage
7. npx tsx scripts/executor-fullcard-condition-gap-analysis.ts
8. Update docs/oracle-ir-session-handoff.md
9. Do not commit unless asked

Key paths:
- Condition evaluators: rules-engine/src/oracleIRExecutorConditionalStepSupport.ts, oracleIRExecutorConditionalStepSupportExtended.ts
- Audit: server/scripts/executor-coverage-audit.ts
- Gap scripts: server/scripts/executor-fullcard-condition-gap-analysis.ts
```
