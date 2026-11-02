# Phase 5 static/replacement census (owned_but_unhandled)

Generated 2026-11-02T07:21:20.520Z by `npm run census:statics` (server/scripts/static-replacement-census.ts).

Candidate lines: Commander-legal permanent faces, reminder text stripped, lines that end in a period and are
not triggers, activated abilities, or keyword lists. A line is **declarative-handled** when
`parseStaticEffectSpecsFromOraclePermanent` or `collectReplacementEffectSpecsFromState` returns a spec for it alone.
Lines owned by another subsystem (cost modifiers, ETB-tapped/with-counters, cast permissions, etc.) are listed
separately and not counted as gaps. Remaining lines are `owned_but_unhandled` for Phase 5.

| Metric | Lines |
|---|---|
| Candidate static/replacement lines | 9904 |
| Declarative-handled | 2662 |
| Owned by another subsystem | 5693 |
| owned_but_unhandled (static) | 1319 |
| owned_but_unhandled (replacement) | 230 |

## Run history

| Run (UTC) | Candidates | Handled | Other subsystems | Unhandled static | Unhandled replacement |
|---|---|---|---|---|---|
| B4 (end of batch) | 10552 | 1817 | 5023 | 3243 | 469 |
| B5 (end of batch) | 10491 | 1862 | 4964 | 3240 | 425 |
| B6 (end of batch) | 10491 | 1891 | 5023 | 3211 | 366 |
| B7 (end of batch) | 10491 | 1874 | 5186 | 3066 | 365 |
| B8 (end of batch) | 10491 | 1820 | 5248 | 3058 | 365 |
| B9 (end of batch) | 10491 | 1937 | 5290 | 2903 | 361 |
| B10 (end of batch) | 10491 | 1991 | 5283 | 2861 | 356 |
| B11 (end of batch) | 10491 | 1914 | 5393 | 2834 | 350 |
| B12 (end of batch) | 10491 | 1914 | 5402 | 2825 | 350 |
| B13 (end of batch) | 10491 | 1921 | 5412 | 2808 | 350 |
| B14 (end of batch) | 10491 | 1931 | 5426 | 2784 | 350 |
| B15 (end of batch) | 10491 | 2009 | 5442 | 2710 | 330 |
| B16 (end of batch) | 10491 | 2064 | 5465 | 2658 | 304 |
| B17 (end of batch) | 10491 | 2069 | 5470 | 2653 | 299 |
| B18 (end of batch) | 10491 | 2111 | 5474 | 2640 | 266 |
| B19 (end of batch) | 9909 | 2154 | 5319 | 2189 | 247 |
| B20 (end of batch) | 9909 | 2171 | 5345 | 2147 | 246 |
| B21 (end of batch) | 9909 | 2186 | 5345 | 2133 | 245 |
| B22 (end of batch) | 9909 | 2186 | 5359 | 2121 | 243 |
| B23 (end of batch) | 9909 | 2186 | 5391 | 2092 | 240 |
| B24 (end of batch) | 9909 | 2186 | 5393 | 2092 | 238 |
| B25 (end of batch) | 9909 | 2186 | 5419 | 2066 | 238 |
| B26 (end of batch) | 9909 | 2186 | 5427 | 2059 | 237 |
| B27 (end of batch) | 9909 | 2208 | 5444 | 2020 | 237 |
| 2026-10-25 09:12Z | 10491 | 2069 | 5465 | 2653 | 304 |
| 2026-10-25 09:27Z | 10491 | 2082 | 5470 | 2640 | 299 |
| 2026-10-25 09:36Z | 10491 | 2057 | 5529 | 2640 | 265 |
| 2026-10-25 09:42Z | 10491 | 2111 | 5474 | 2640 | 266 |
| 2026-10-25 10:07Z | 10491 | 2157 | 5474 | 2603 | 257 |
| 2026-10-25 10:08Z | 9909 | 2154 | 5319 | 2189 | 247 |
| 2026-10-25 10:25Z | 9909 | 2171 | 5335 | 2157 | 246 |
| 2026-10-25 10:28Z | 9909 | 2171 | 5345 | 2147 | 246 |
| 2026-10-25 10:40Z | 9909 | 2185 | 5345 | 2133 | 246 |
| 2026-10-25 10:50Z | 9909 | 2186 | 5345 | 2133 | 245 |
| 2026-10-25 11:12Z | 9909 | 2186 | 5359 | 2121 | 243 |
| 2026-10-25 11:32Z | 9909 | 2186 | 5391 | 2092 | 240 |
| 2026-10-25 11:57Z | 9909 | 2186 | 5393 | 2092 | 238 |
| 2026-10-25 12:14Z | 9909 | 2186 | 5419 | 2066 | 238 |
| 2026-10-25 12:36Z | 9909 | 2186 | 5427 | 2059 | 237 |
| 2026-10-25 12:55Z | 9909 | 2208 | 5444 | 2020 | 237 |
| 2026-10-25 13:14Z | 9909 | 2306 | 5444 | 1922 | 237 |
| 2026-10-25 13:20Z | 9909 | 2356 | 5461 | 1858 | 234 |
| B28 (end of batch) | 9909 | 2356 | 5461 | 1858 | 234 |
| 2026-10-25 13:31Z | 9909 | 2360 | 5461 | 1854 | 234 |
| 2026-10-25 13:51Z | 9909 | 2377 | 5480 | 1817 | 235 |
| B29 (end of batch) | 9909 | 2377 | 5480 | 1817 | 235 |
| 2026-10-25 14:00Z | 9909 | 2407 | 5507 | 1760 | 235 |
| B30 (end of batch) | 9909 | 2407 | 5507 | 1760 | 235 |
| 2026-10-25 14:07Z | 9909 | 2411 | 5507 | 1756 | 235 |
| 2026-10-25 14:16Z | 9909 | 2467 | 5514 | 1696 | 232 |
| B31 (end of batch) | 9909 | 2467 | 5514 | 1696 | 232 |
| 2026-10-25 14:17Z | 9909 | 2497 | 5514 | 1666 | 232 |
| 2026-10-25 14:44Z | 9909 | 2500 | 5514 | 1663 | 232 |
| B32 (end of batch) | 9909 | 2500 | 5514 | 1663 | 232 |
| 2026-10-25 14:49Z | 9909 | 2512 | 5514 | 1651 | 232 |
| 2026-10-25 15:02Z | 9909 | 2514 | 5525 | 1638 | 232 |
| B33 (end of batch) | 9909 | 2514 | 5525 | 1638 | 232 |
| 2026-11-02 02:56Z | 9909 | 2555 | 5571 | 1551 | 232 |
| B34 (end of batch) | 9909 | 2555 | 5571 | 1551 | 232 |
| 2026-11-02 03:01Z | 9909 | 2559 | 5581 | 1537 | 232 |
| 2026-11-02 03:36Z | 9909 | 2562 | 5581 | 1534 | 232 |
| B35 (end of batch) | 9909 | 2562 | 5581 | 1534 | 232 |
| 2026-11-02 03:40Z | 9909 | 2562 | 5585 | 1530 | 232 |
| B36 (end of batch) | 9909 | 2562 | 5585 | 1530 | 232 |
| 2026-11-02 03:45Z | 9909 | 2590 | 5585 | 1502 | 232 |
| 2026-11-02 03:50Z | 9909 | 2590 | 5592 | 1495 | 232 |
| B37 (end of batch) | 9909 | 2590 | 5592 | 1495 | 232 |
| 2026-11-02 03:58Z | 9909 | 2603 | 5592 | 1482 | 232 |
| 2026-11-02 04:16Z | 9909 | 2603 | 5599 | 1475 | 232 |
| B38 (end of batch) | 9909 | 2603 | 5599 | 1475 | 232 |
| 2026-11-02 04:35Z | 9909 | 2621 | 5599 | 1457 | 232 |
| 2026-11-02 04:43Z | 9909 | 2621 | 5602 | 1454 | 232 |
| B39 (end of batch) | 9909 | 2621 | 5602 | 1454 | 232 |
| 2026-11-02 04:46Z | 9909 | 2643 | 5602 | 1432 | 232 |
| 2026-11-02 04:54Z | 9909 | 2651 | 5602 | 1424 | 232 |
| 2026-11-02 05:05Z | 9909 | 2665 | 5602 | 1410 | 232 |
| 2026-11-02 05:18Z | 9909 | 2663 | 5643 | 1371 | 232 |
| 2026-11-02 05:27Z | 9909 | 2663 | 5645 | 1369 | 232 |
| B40 (end of batch) | 9909 | 2663 | 5645 | 1369 | 232 |
| 2026-11-02 05:30Z | 9909 | 2663 | 5651 | 1363 | 232 |
| 2026-11-02 05:41Z | 9909 | 2667 | 5651 | 1359 | 232 |
| 2026-11-02 05:47Z | 9909 | 2662 | 5666 | 1349 | 232 |
| 2026-11-02 06:00Z | 9909 | 2663 | 5679 | 1335 | 232 |
| 2026-11-02 06:07Z | 9909 | 2659 | 5687 | 1331 | 232 |
| 2026-11-02 06:26Z | 9909 | 2659 | 5691 | 1328 | 231 |
| B41 (end of batch) | 9909 | 2659 | 5691 | 1328 | 231 |
| 2026-11-02 06:42Z | 9909 | 2659 | 5691 | 1328 | 231 |
| 2026-11-02 07:21Z | 9904 | 2662 | 5693 | 1319 | 230 |
| B42 (end of batch) | 9904 | 2662 | 5693 | 1319 | 230 |

## Other subsystems

- enters tapped / with counters / as-enters choice: 1569
- attached host P/T or keyword grant (oracle reader): 751
- saga / modal bullet text: 588
- cost modification: 573
- cast/play permission: 291
- combat evasion / requirement (oracle reader): 269
- untap restriction / hand size (oracle reader): 197
- keyword with reminder (keywordAbilities/*): 124
- uncounterable / timing: 82
- blocker-quality evasion (combatQualifierBlockRestriction): 63
- commander / deck rules: 58
- partner family deck construction (partnerDeckValidation): 49
- mana ability text: 49
- variable P/T count (variablePTCalculator): 42
- enters prepared (prepared): 40
- control Aura layer 2 (staticEffectSpecAuraControl): 40
- copy entry exceptions (copyEntryExceptions): 35
- trigger doubling (trigger-doublers): 33
- attack needs defender land type (combatDefendingLandRestriction): 33
- power-only CDA (variablePowerOnlyCalculator): 30
- blocker capacity (combatBlockerCapacity): 30
- escape graveyard cast (interactionGraveyardCastExecution): 24
- paired P/T + quoted grants (PairedThresholdQuotedGrants): 24
- Theros god devotion type-loss (updateGodCreatureStatus): 22
- revealed hands/library top flags (revealedInformationFlags): 21
- generic count CDA (variablePTGenericCountCDA): 21
- casting limits (staticCastingRestrictions + OracleExtras): 19
- damage by toughness (turnCombatDamageByToughness): 17
- kicker incl. and/or two-cost kicker (kickerCostUtils): 15
- assign combat damage as though unblocked (combatAssignAsThoughUnblocked): 15
- multikicker (multikickerCastUtils): 15
- color can't-be-blocked-by (combatColorBlockRestriction): 14
- borrowed activated abilities (staticEffectSpecBorrowedActivated): 13
- maximum hand size set/increase/reduce (handSizeStaticModifiers): 13
- skip draw step (turnStepDrawTurnAction): 13
- planeswalker loyalty / saga / class: 12
- escape entry counters (detectEntersWithCounters): 12
- must attack each combat (attackRequirementTextExtras): 12
- creature tokens you control have keyword (combat-mechanics token lord grants): 11
- mana retention (turnManaRetentionOracle): 10
- day/night on enter (day-night ensureInitial): 10
- planeswalker quoted loyalty grants (planeswalkerGrantedLoyaltyAbilities): 10
- global activation lock (staticActivationLockFromAttachments): 10
- landwalk blockable-as-though (combatLandwalkOverrides): 10
- attached unblockable (combatBatch28ConditionalUnblockable): 9
- attached/except color block restriction (combatExceptColorBlockRestriction): 9
- amplify N (amplifyEntry): 9
- assist (assistPayment): 9
- must block each combat (combatMustBlockEachCombat): 9
- draft-only text (not applicable to constructed play): 9
- cumulative upkeep pay life / mana (cumulativeUpkeepPayment): 9
- variable P/T graveyard/artifact count (variablePTCalculator): 8
- minimum blockers (combatMinimumBlockers): 8
- protection from the chosen color (combat-mechanics getPermanentProtections): 8
- attack as though no defender, global/self/conditional (combatDefenderAttackPermission): 7
- attached activation lock (staticActivationLockFromAttachments): 7
- aura P/T + goad (goad-effects / calculateAllPTBonuses): 7
- untap step cap N TYPE (untapStepLimits): 6
- entering doesn't cause abilities to trigger (triggeredAbilitySuppression): 6
- chosen-name activation lock (chosen-name-restrictions): 6
- chosen type in addition (creatureTypeNow): 6
- attached land type set (manaAbilityLandTypeModifiers): 6
- self unblockable except by flying/reach (combatBatch25BlockRestrictions): 6
- control-count attack/block gate (combatBatch33AttackRestrictions): 6
- morph/megamorph/disguise turn-face-up cost (faceDownCasting): 6
- chosen-name cast lock (chosen-name-restrictions): 5
- COLOR creatures / basic lands don't untap (turn-phases detectDoesntUntapEffects filters): 5
- evoke exile-a-card cost + evoke sacrifice (evokeKeyword): 5
- variable P/T color permanent count (variableColorPermanentCount): 5
- exiled-card name cast lock (exiledCardNameCastLock): 5
- discard-to-battlefield replacement (discardToBattlefieldReplacement): 5
- qualified untap prohibition (untapQualifierProhibitions): 5
- damage can't be prevented (gameStateEffectsMillDamage canDamageBePrevented): 4
- cast only if cast another spell this turn (castOnlyIfCastAnotherRestriction): 4
- enters under opponent control (triggers/control-change): 4
- graveyard targeting restriction (graveyardTargetingRestriction): 4
- firebending X (attack-detection resolveFirebendingAmount): 4
- self shuffle-into-library replacement (replacementEffectSpec): 4
- colour-sourced targeting restriction (colorSourceTargetingRestriction): 4
- attached P/T and loses flying (permanentKeywordAbilities): 4
- crew/saddle as though power were N greater (crewSaddlePowerBonus): 4
- untap during each other player's untap step (turnPhaseUntapStepEffects): 4
- self unblockable while defender controls TYPE (combatDefenderControlsUnblockable): 4
- static convoke grant (casting-modifiers): 3
- cowards can't block warriors (combatDefenderAttackPermission): 3
- players can't draw cards (playersCantDrawCards): 3
- noncombat damage to opponents +N / double (replacementBatch16LongTail damage templates): 3
- can't cast during your first turns (firstTurnsCastRestriction): 3
- flagbearer targeting requirement (flagbearerTargeting): 3
- enters untapped override (landsEnterUntappedOverride): 3
- own graveyard -> exile from anywhere (zone-change template): 3
- morph/disguise non-mana or mixed turn-face-up cost (turnFaceUpCostComponents): 3
- per-draw replacement: skip / exile face up / graveyard return / opponent redirect (replacementBatch19DrawInstead): 3
- spell lifelink grant (spellLifelinkGrant): 3
- clone entry copy (asEntersCopyChoice): 3
- zone cast lock (batch31CastLocks): 3
- "~ is all colors" CDA (selfAllColorsCDA via getEffectiveColors): 3
- activate abilities as though haste (gameActionsPermanentKeywordGrants): 3
- regenerate instead of destroy (replacementBatch16LongTail): 3
- dice advantage (dieRollAdvantage): 3
- equip sacrifice cost (targetSelectionEquipSacrificeCost): 3
- pregame commander color (commanderPregameColorChoice): 3
- lands are every basic land type (manaAbilityLandTypeModifiers): 3
- cast-this-turn attack gate (combatBatch34AttackRestrictions): 3
- graveyard keyword non-mana cost (graveyardKeywordNonManaCost): 3
- land play prohibition (playerActionProhibitions): 3
- self unblockable while attacking alone (combatBatch25BlockRestrictions): 3
- extra vote (voteAdditionalVotes): 3
- extra turn skipped (replacementBatch16LongTail via nextTurn): 2
- land would enter: sacrifice lands instead (land-would-enter-replacement): 2
- granted vehicle crew N (crewGrantedVehicleCrew): 2
- empty-library draw: counters / skip instead (replacementBatch18DrawInstead): 2
- attack as though no defender, trailing/counter/type conditions (combatDefenderAttackPermission): 2
- hand foretell grant (foretellGrants): 2
- extra Treasure (token template): 2
- source damage plus replacement (replacementBatch21DamageScaling): 2
- drawn-cards conditional unblockable (combatBatch28ConditionalUnblockable): 2
- prevent damage, remove +1/+1 counters [+ tokens/rad] (replacementBatch17DamagePrevention): 2
- creatures don't untap (turn-phases all_creatures untap prevention): 2
- echo non-mana cost (echoNonManaCost): 2
- CDA life paid on entry (asEntersPayAnyLife): 2
- attached block-only-flying (combatBatch30AttachedBlockRestrictions): 2
- sorcery-timing cast lock (opponentSorceryTimingLock): 2
- maximum blockers (combatBatch30BlockLimits): 2
- graveyard-count attack gate (combatBatch30AttackRestrictions): 2
- artifact and/or color block restriction (combatBatch31BlockRestrictions): 2
- non-subtype creatures can't attack (combatBatch33AttackRestrictions): 2
- damage becomes counters (damage side-effect template): 2
- opponent-turn cast lock (batch31CastLocks): 2
- self cast prohibition (playerActionProhibitions): 2
- attached opponent-targeting protection (permanentTargeting): 2
- already-attacked-player attack gate (combatBatch37Restrictions): 2
- counter placement restriction (counterPlacementRestrictions): 2
- additional land each player (calculateMaxLandsPerTurn): 2
- power-gated team blocker cap (combatBatch30BlockLimits): 2
- block shadow as though (blockAsThoughShadow): 2
- self damage unpreventable (canDamageBePrevented): 2
- aura-spell target restriction (auraSpellTargetRestriction): 2
- opponents must attack (attackRestrictionText): 2
- CDA all hands count (variablePTCalculator): 2
- team counter-kind placement ban (counterPlacementRestrictions): 2
- keyword-qualified block evasion (combatQualifierBlockRestriction): 2
- self creature-cast prohibition (playerActionProhibitions): 2
- opponent extra turn skipped (replacementBatch18ExtraTurnSkip via dropSkippedExtraTurns): 2
- graveyard scavenge grant (graveyardScavengeGrants): 2
- equip discard cost (targetSelectionEquipDiscardCost): 2
- opponent-caused sacrifice protection (sacrificeCauseProtection): 2
- global flying block-only-flying (combatBatch36Restrictions): 2
- alternative equip cost choice (targetSelectionEquipAlternativeCost): 1
- color convoke grant (convokeColorGrants): 1
- control-type attack gate (combatBatch36Restrictions): 1
- nonbasic land untap prohibition (untapQualifierProhibitions): 1
- attack last-turn attackers despite defender (combatDefenderAttackPermission): 1
- Fasting draw-step may-skip, OPTION_CHOICE (optionalDrawStepSkip): 1
- instant/sorcery damage cap (replacementBatch23DamageCap): 1
- block SUBTYPE as though reach (combatBatch26BlockRestrictions): 1
- prevent damage to you, counter on source (replacementBatch17DamagePrevention): 1
- prevent damage, put that many counters (replacementBatch17DamagePrevention): 1
- equip pay life (equipNonManaCosts): 1
- strange new worlds count basis (trekCountBases): 1
- reveal-until-kind draw replacement (zonesDrawReplacementRevealUntilKind): 1
- alternative reconfigure cost choice (targetSelectionEquipAlternativeCost): 1

## Top 40 unhandled families (by cards affected)

| # | Scope | Family | Cards | Example cards |
|---|---|---|---|---|
| 1 | static | gift a card (you may promise an opponent a gift as you cast this spell | 2 | Scrapshooter; Kitnap |
| 2 | static | suspend x—{M}{M}{M} | 2 | Benalish Commander; Aeon Chronicler |
| 3 | static | the "…" doesn't apply to permanents you control | 2 | Mirror Box; Sakashima of a Thousand Faces |
| 4 | static | N—N / create N treasure tokens | 2 | Treasure Chest; Hoarding Ogre |
| 5 | static | COLOR creatures can't attack unless their controller sacrifices a land of their choice for each COLOR creature | 2 | Flooded Woodlands; Reclamation |
| 6 | static | during the draft, you may turn this card face down | 2 | Illusionary Informant; Whispergear Sneak |
| 7 | static | N—N / create a ±N/±N COLOR goblin creature token | 2 | Goblin Morningstar; Swarming Goblins |
| 8 | static | as ~ is turned face up, put N ±N/±N counters on it | 2 | Hooded Hydra; Bubble Smuggler |
| 9 | static | N—N / create N of those tokens | 2 | Swarming Goblins; Delina, Wild Mage |
| 10 | static | creatures you control get ±N/±N until end of turn | 2 | Roller Coaster; Kiddie Coaster |
| 11 | replacement | if enchanted land would be destroyed, instead sacrifice ~ and that land gains indestructible until end of turn | 2 | Harmonious Emergence; Crackling Emergence |
| 12 | replacement | as long as an artifact entered the battlefield under your control this turn, ~ can attack as though it didn't  | 2 | Mechan Shieldmate; Shipwreck Sentry |
| 13 | static | lands don't untap during their controllers' untap steps | 2 | Hokori, Dust Drinker; Rising Waters |
| 14 | static | reveal the first card you draw each turn | 2 | Primitive Etchings; Rowen |
| 15 | replacement | if a source you control would deal noncombat damage to a creature an opponent controls, put that many ±N/±N co | 1 | Soul-Scar Mage |
| 16 | static | animal may-ham — other spiders, boars, bats, bears, birds, cats, dogs, frogs, jackals, lizards, mice, otters,  | 1 | Spider-Ham, Peter Porker |
| 17 | static | each creature you control can't be blocked as long as defending player controls an artifact land | 1 | Tanglewalker |
| 18 | static | ~ attacks each combat if able unless you control another ally | 1 | Reckless Cohort |
| 19 | replacement | if a creature you control would explore, instead it explores, then it explores again | 1 | Topography Tracker |
| 20 | static | the first instant or sorcery spell you cast each turn costs {M} (or {M}) less to cast for each land you contro | 1 | Eluge, the Shoreless Sea |
| 21 | static | as long as ~ is enchanted, it has "…" | 1 | Freewind Equenaut |
| 22 | static | as long as ~ is untapped, each player chooses artifact, creature, or land during their untap step | 1 | Storage Matrix |
| 23 | static | ~ can't be blocked by creatures that don't have a name | 1 | Pompous Gadabout |
| 24 | static | noncreature spells you cast from exile have convoke | 1 | Party Thrasher |
| 25 | static | untap all creatures you control during each other player's untap step | 1 | Drumbellower |
| 26 | static | N—N / each player sacrifices a permanent of their choice | 1 | Earth-Cult Elemental |
| 27 | static | N—N / each opponent sacrifices a permanent of their choice | 1 | Earth-Cult Elemental |
| 28 | static | N / each opponent sacrifices N permanents of their choice | 1 | Earth-Cult Elemental |
| 29 | static | each creature you control but don't own gets ±N/±N, has menace and deathtouch, and is a pirate in addition to  | 1 | Don Andres, the Renegade |
| 30 | static | {M}{M}{M}{M} — whenever ~ attacks, you gain N life and draw a card | 1 | Playable Delusionary Hydra |
| 31 | static | descend N — as long as there are N or more permanent cards in your graveyard, ~ gets ±N/±N and has trample | 1 | Akawalli, the Seething Tower |
| 32 | static | descend N — as long as there are eight or more permanent cards in your graveyard, ~ gets an additional ±N/±N a | 1 | Akawalli, the Seething Tower |
| 33 | static | goaded creatures your opponents control can't block | 1 | Bothersome Quasit |
| 34 | static | creatures with flying can't attack you or block creatures you control | 1 | Storm, Windrider |
| 35 | static | the "…" doesn't apply to creature tokens you control | 1 | The Master, Multiplied |
| 36 | static | triggered abilities you control can't cause you to sacrifice or exile creature tokens you control | 1 | The Master, Multiplied |
| 37 | static | ~ can't attack or block unless it has an even number of counters on it | 1 | Sab-Sunen, Luxa Embodied |
| 38 | static | counters remain on ~ as it moves to any zone other than a player's hand or library | 1 | Skullbriar, the Walking Grave |
| 39 | static | ~ can't attack alone unless he has a ±N/±N counter on him | 1 | Pipsqueak, Rebel Strongarm |
| 40 | static | enchanted creature gets ±N/±N for each of its colors | 1 | Blessing of the Nephilim |
