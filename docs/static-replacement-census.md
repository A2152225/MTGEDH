# Phase 5 static/replacement census (owned_but_unhandled)

Generated 2026-10-25T15:16:48.354Z by `npm run census:statics` (server/scripts/static-replacement-census.ts).

Candidate lines: Commander-legal permanent faces, reminder text stripped, lines that end in a period and are
not triggers, activated abilities, or keyword lists. A line is **declarative-handled** when
`parseStaticEffectSpecsFromOraclePermanent` or `collectReplacementEffectSpecsFromState` returns a spec for it alone.
Lines owned by another subsystem (cost modifiers, ETB-tapped/with-counters, cast permissions, etc.) are listed
separately and not counted as gaps. Remaining lines are `owned_but_unhandled` for Phase 5.

| Metric | Lines |
|---|---|
| Candidate static/replacement lines | 9909 |
| Declarative-handled | 2514 |
| Owned by another subsystem | 5525 |
| owned_but_unhandled (static) | 1638 |
| owned_but_unhandled (replacement) | 232 |

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
| 2026-10-25 09:30Z | 10491 | 2082 | 5470 | 2640 | 299 |
| 2026-10-25 09:36Z | 10491 | 2057 | 5529 | 2640 | 265 |
| 2026-10-25 09:39Z | 10491 | 2057 | 5529 | 2640 | 265 |
| 2026-10-25 09:42Z | 10491 | 2111 | 5474 | 2640 | 266 |
| 2026-10-25 10:07Z | 10491 | 2157 | 5474 | 2603 | 257 |
| 2026-10-25 10:07Z | 10491 | 2157 | 5474 | 2603 | 257 |
| 2026-10-25 10:07Z | 10491 | 2157 | 5474 | 2603 | 257 |
| 2026-10-25 10:08Z | 9909 | 2154 | 5319 | 2189 | 247 |
| 2026-10-25 10:09Z | 9909 | 2154 | 5319 | 2189 | 247 |
| 2026-10-25 10:11Z | 9909 | 2154 | 5319 | 2189 | 247 |
| 2026-10-25 10:25Z | 9909 | 2171 | 5335 | 2157 | 246 |
| 2026-10-25 10:25Z | 9909 | 2171 | 5335 | 2157 | 246 |
| 2026-10-25 10:28Z | 9909 | 2171 | 5345 | 2147 | 246 |
| 2026-10-25 10:40Z | 9909 | 2185 | 5345 | 2133 | 246 |
| 2026-10-25 10:41Z | 9909 | 2185 | 5345 | 2133 | 246 |
| 2026-10-25 10:41Z | 9909 | 2185 | 5345 | 2133 | 246 |
| 2026-10-25 10:50Z | 9909 | 2186 | 5345 | 2133 | 245 |
| 2026-10-25 10:50Z | 9909 | 2186 | 5345 | 2133 | 245 |
| 2026-10-25 10:52Z | 9909 | 2186 | 5345 | 2133 | 245 |
| 2026-10-25 11:12Z | 9909 | 2186 | 5359 | 2121 | 243 |
| 2026-10-25 11:32Z | 9909 | 2186 | 5391 | 2092 | 240 |
| 2026-10-25 11:57Z | 9909 | 2186 | 5393 | 2092 | 238 |
| 2026-10-25 12:14Z | 9909 | 2186 | 5419 | 2066 | 238 |
| 2026-10-25 12:36Z | 9909 | 2186 | 5427 | 2059 | 237 |
| 2026-10-25 12:55Z | 9909 | 2208 | 5444 | 2020 | 237 |
| 2026-10-25 13:12Z | 9909 | 2208 | 5444 | 2020 | 237 |
| 2026-10-25 13:14Z | 9909 | 2306 | 5444 | 1922 | 237 |
| 2026-10-25 13:20Z | 9909 | 2356 | 5461 | 1858 | 234 |
| B28 (end of batch) | 9909 | 2356 | 5461 | 1858 | 234 |
| 2026-10-25 13:31Z | 9909 | 2360 | 5461 | 1854 | 234 |
| 2026-10-25 13:51Z | 9909 | 2377 | 5480 | 1817 | 235 |
| 2026-10-25 13:52Z | 9909 | 2377 | 5480 | 1817 | 235 |
| B29 (end of batch) | 9909 | 2377 | 5480 | 1817 | 235 |
| 2026-10-25 13:54Z | 9909 | 2377 | 5480 | 1817 | 235 |
| 2026-10-25 14:00Z | 9909 | 2407 | 5507 | 1760 | 235 |
| B30 (end of batch) | 9909 | 2407 | 5507 | 1760 | 235 |
| 2026-10-25 14:07Z | 9909 | 2411 | 5507 | 1756 | 235 |
| 2026-10-25 14:16Z | 9909 | 2467 | 5514 | 1696 | 232 |
| 2026-10-25 14:17Z | 9909 | 2467 | 5514 | 1696 | 232 |
| B31 (end of batch) | 9909 | 2467 | 5514 | 1696 | 232 |
| 2026-10-25 14:17Z | 9909 | 2497 | 5514 | 1666 | 232 |
| 2026-10-25 14:44Z | 9909 | 2500 | 5514 | 1663 | 232 |
| 2026-10-25 14:45Z | 9909 | 2500 | 5514 | 1663 | 232 |
| B32 (end of batch) | 9909 | 2500 | 5514 | 1663 | 232 |
| 2026-10-25 14:46Z | 9909 | 2500 | 5514 | 1663 | 232 |
| 2026-10-25 14:49Z | 9909 | 2512 | 5514 | 1651 | 232 |
| 2026-10-25 14:51Z | 9909 | 2512 | 5514 | 1651 | 232 |
| 2026-10-25 15:02Z | 9909 | 2514 | 5525 | 1638 | 232 |
| B33 (end of batch) | 9909 | 2514 | 5525 | 1638 | 232 |
| 2026-10-25 15:14Z | 9909 | 2514 | 5525 | 1638 | 232 |
| 2026-10-25 15:15Z | 9909 | 2514 | 5525 | 1638 | 232 |
| 2026-10-25 15:16Z | 9909 | 2514 | 5525 | 1638 | 232 |
| 2026-10-25 15:16Z | 9909 | 2514 | 5525 | 1638 | 232 |
| 2026-10-25 15:16Z | 9909 | 2514 | 5525 | 1638 | 232 |

## Other subsystems

- enters tapped / with counters / as-enters choice: 1571
- attached host P/T or keyword grant (oracle reader): 751
- saga / modal bullet text: 589
- cost modification: 573
- cast/play permission: 291
- combat evasion / requirement (oracle reader): 269
- untap restriction / hand size (oracle reader): 198
- keyword with reminder (keywordAbilities/*): 124
- uncounterable / timing: 82
- blocker-quality evasion (combatQualifierBlockRestriction): 63
- commander / deck rules: 58
- partner family deck construction (partnerDeckValidation): 49
- mana ability text: 49
- variable P/T count (variablePTCalculator): 42
- enters prepared (prepared): 40
- control Aura layer 2 (staticEffectSpecAuraControl): 40
- attack needs defender land type (combatDefendingLandRestriction): 33
- power-only CDA (variablePowerOnlyCalculator): 30
- blocker capacity (combatBlockerCapacity): 30
- escape graveyard cast (interactionGraveyardCastExecution): 24
- paired P/T + quoted grants (PairedThresholdQuotedGrants): 24
- Theros god devotion type-loss (updateGodCreatureStatus): 22
- revealed hands/library top flags (revealedInformationFlags): 21
- casting limits (staticCastingRestrictions + OracleExtras): 19
- damage by toughness (turnCombatDamageByToughness): 17
- kicker incl. and/or two-cost kicker (kickerCostUtils): 15
- assign combat damage as though unblocked (combatAssignAsThoughUnblocked): 15
- multikicker (multikickerCastUtils): 15
- color can't-be-blocked-by (combatColorBlockRestriction): 14
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
- damage can't be prevented (gameStateEffectsMillDamage canDamageBePrevented): 4
- cast only if cast another spell this turn (castOnlyIfCastAnotherRestriction): 4
- enters under opponent control (triggers/control-change): 4
- graveyard targeting restriction (graveyardTargetingRestriction): 4
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
- lands are every basic land type (manaAbilityLandTypeModifiers): 3
- self unblockable while attacking alone (combatBatch25BlockRestrictions): 3
- extra vote (voteAdditionalVotes): 3
- extra turn skipped (replacementBatch16LongTail via nextTurn): 2
- land would enter: sacrifice lands instead (land-would-enter-replacement): 2
- granted vehicle crew N (crewGrantedVehicleCrew): 2
- empty-library draw: counters / skip instead (replacementBatch18DrawInstead): 2
- attack as though no defender, trailing/counter/type conditions (combatDefenderAttackPermission): 2
- extra Treasure (token template): 2
- source damage plus replacement (replacementBatch21DamageScaling): 2
- drawn-cards conditional unblockable (combatBatch28ConditionalUnblockable): 2
- prevent damage, remove +1/+1 counters [+ tokens/rad] (replacementBatch17DamagePrevention): 2
- creatures don't untap (turn-phases all_creatures untap prevention): 2
- attached block-only-flying (combatBatch30AttachedBlockRestrictions): 2
- sorcery-timing cast lock (opponentSorceryTimingLock): 2
- maximum blockers (combatBatch30BlockLimits): 2
- graveyard-count attack gate (combatBatch30AttackRestrictions): 2
- artifact and/or color block restriction (combatBatch31BlockRestrictions): 2
- non-subtype creatures can't attack (combatBatch33AttackRestrictions): 2
- damage becomes counters (damage side-effect template): 2
- opponent-turn cast lock (batch31CastLocks): 2
- block shadow as though (blockAsThoughShadow): 2
- opponents must attack (attackRestrictionText): 2
- opponent extra turn skipped (replacementBatch18ExtraTurnSkip via dropSkippedExtraTurns): 2
- attack last-turn attackers despite defender (combatDefenderAttackPermission): 1
- Fasting draw-step may-skip, OPTION_CHOICE (optionalDrawStepSkip): 1
- instant/sorcery damage cap (replacementBatch23DamageCap): 1
- block SUBTYPE as though reach (combatBatch26BlockRestrictions): 1
- prevent damage to you, counter on source (replacementBatch17DamagePrevention): 1
- prevent damage, put that many counters (replacementBatch17DamagePrevention): 1

## Top 1 unhandled families (by cards affected)

| # | Scope | Family | Cards | Example cards |
|---|---|---|---|---|
| 1 | static | COLOR legendary creatures you control have "…" (any legendary creatures can attack in a band as long as at lea | 5 | Cathedral of Serra; Mountain Stronghold; Adventurers' Guildhouse |
