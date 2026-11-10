# Phase 5 static/replacement census (owned_but_unhandled)

Generated 2026-11-10T03:06:27.120Z by `npm run census:statics` (server/scripts/static-replacement-census.ts).

Candidate lines: Commander-legal permanent faces, reminder text stripped, lines that end in a period and are
not triggers, activated abilities, or keyword lists. A line is **declarative-handled** when
`parseStaticEffectSpecsFromOraclePermanent` or `collectReplacementEffectSpecsFromState` returns a spec for it alone.
Lines owned by another subsystem (cost modifiers, ETB-tapped/with-counters, cast permissions, etc.) are listed
separately and not counted as gaps. Remaining lines are `owned_but_unhandled` for Phase 5.

| Metric | Lines |
|---|---|
| Candidate static/replacement lines | 9904 |
| Declarative-handled | 2722 |
| Owned by another subsystem | 6473 |
| owned_but_unhandled (static) | 536 |
| owned_but_unhandled (replacement) | 173 |

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
| 2026-11-02 09:43Z | 9904 | 2665 | 5706 | 1303 | 230 |
| B43 (end of batch) | 9904 | 2665 | 5706 | 1303 | 230 |
| 2026-11-02 09:44Z | 9904 | 2665 | 5706 | 1303 | 230 |
| B44 R32 Trek statics (upcoming incl: 10082/2714/5823/1309/236) | 9904 | 2665 | 5706 | 1303 | 230 |
| 2026-11-02 10:01Z | 9904 | 2665 | 5710 | 1299 | 230 |
| B44 (end of batch) | 9904 | 2665 | 5710 | 1299 | 230 |
| B45 R33 control/static (upcoming incl: 10082/2716/5827/1305/234) | 9904 | 2665 | 5710 | 1299 | 230 |
| B46 R34 control/static (upcoming incl: 10082/2738/5827/1283/234) | 9904 | 2686 | 5710 | 1278 | 230 |
| 2026-11-02 10:13Z | 9904 | 2665 | 5710 | 1299 | 230 |
| 2026-11-02 10:14Z | 9904 | 2665 | 5710 | 1299 | 230 |
| 2026-11-02 10:18Z | 9904 | 2686 | 5710 | 1278 | 230 |
| 2026-11-02 10:20Z | 9904 | 2686 | 5710 | 1278 | 230 |
| B45 (end of batch) | 9904 | 2686 | 5710 | 1278 | 230 |
| 2026-11-02 10:35Z | 9904 | 2686 | 5710 | 1278 | 230 |
| 2026-11-02 10:50Z | 9904 | 2716 | 5714 | 1244 | 230 |
| B46 (end of batch) | 9904 | 2716 | 5714 | 1244 | 230 |
| 2026-11-02 12:08Z | 9904 | 2716 | 5724 | 1234 | 230 |
| B47 (end of batch) | 9904 | 2716 | 5724 | 1234 | 230 |
| 2026-11-02 12:09Z | 9904 | 2716 | 5724 | 1234 | 230 |
| 2026-11-02 12:09Z | 9904 | 2716 | 5724 | 1234 | 230 |
| 2026-11-02 12:14Z | 9904 | 2716 | 5725 | 1233 | 230 |
| 2026-11-02 12:15Z | 9904 | 2716 | 5725 | 1233 | 230 |
| 2026-11-02 12:15Z | 9904 | 2716 | 5726 | 1232 | 230 |
| B48 (end of batch) | 9904 | 2716 | 5726 | 1232 | 230 |
| 2026-11-02 12:17Z | 9904 | 2716 | 5726 | 1232 | 230 |
| 2026-11-02 12:29Z | 9904 | 2716 | 5734 | 1228 | 226 |
| B49 (end of batch) | 9904 | 2716 | 5734 | 1228 | 226 |
| 2026-11-02 12:44Z | 9904 | 2715 | 5795 | 1168 | 226 |
| B50 (end of batch) | 9904 | 2715 | 5795 | 1168 | 226 |
| 2026-11-02 12:54Z | 9904 | 2715 | 5795 | 1168 | 226 |
| B51 (end of batch) | 9904 | 2715 | 5795 | 1168 | 226 |
| 2026-11-02 13:05Z | 9904 | 2726 | 5798 | 1154 | 226 |
| B52 (end of batch) | 9904 | 2726 | 5798 | 1154 | 226 |
| 2026-11-09 09:32Z | 9904 | 2754 | 5823 | 1101 | 226 |
| B53 (end of batch) | 9904 | 2754 | 5823 | 1101 | 226 |
| 2026-11-09 09:36Z | 9904 | 2754 | 5828 | 1096 | 226 |
| B54 (end of batch) | 9904 | 2754 | 5828 | 1096 | 226 |
| 2026-11-09 09:44Z | 9904 | 2754 | 5839 | 1087 | 224 |
| B55 (end of batch) | 9904 | 2754 | 5839 | 1087 | 224 |
| B56 (end of batch)* | 9904 | 2757 | 5848 | 1075 | 224 |
| 2026-11-09 10:02Z | 9904 | 2757 | 5847 | 1076 | 224 |
| 2026-11-09 10:02Z | 9904 | 2757 | 5847 | 1076 | 224 |
| 2026-11-09 10:03Z | 9904 | 2757 | 5847 | 1076 | 224 |
| 2026-11-09 10:09Z | 9904 | 2757 | 5856 | 1068 | 223 |
| B57 (end of batch) | 9904 | 2757 | 5857 | 1068 | 222 |
| 2026-11-09 10:10Z | 9904 | 2757 | 5857 | 1068 | 222 |
| 2026-11-09 10:26Z | 9904 | 2765 | 5861 | 1059 | 219 |
| B58 (end of batch) | 9904 | 2765 | 5861 | 1059 | 219 |
| 2026-11-09 10:34Z | 9904 | 2775 | 5911 | 1001 | 217 |
| B59 (end of batch) | 9904 | 2775 | 5911 | 1001 | 217 |
| B60 (end of batch) | 9904 | 2785 | 5924 | 979 | 216 |
| B61 (end of batch) | 9904 | 2787 | 5929 | 972 | 216 |
| B62 (end of batch) | 9904 | 2789 | 5941 | 958 | 216 |
| B63 (end of batch) | 9904 | 2789 | 5955 | 948 | 212 |
| B64 (end of batch) | 9904 | 2787 | 5970 | 948 | 199 |
| B65 (end of batch) | 9904 | 2788 | 5980 | 940 | 196 |
| B66 (end of batch) | 9904 | 2788 | 5984 | 938 | 194 |
| 2026-11-09 10:48Z | 9904 | 2785 | 5922 | 981 | 216 |
| 2026-11-09 10:51Z | 9904 | 2785 | 5924 | 979 | 216 |
| 2026-11-09 11:07Z | 9904 | 2787 | 5929 | 972 | 216 |
| 2026-11-09 11:20Z | 9904 | 2789 | 5941 | 958 | 216 |
| 2026-11-09 11:31Z | 9904 | 2789 | 5955 | 948 | 212 |
| 2026-11-09 20:18Z | 9904 | 2787 | 5970 | 948 | 199 |
| 2026-11-09 20:28Z | 9904 | 2788 | 5980 | 940 | 196 |
| 2026-11-09 20:32Z | 9904 | 2788 | 5984 | 938 | 194 |
| 2026-11-09 20:40Z | 9904 | 2716 | 6104 | 891 | 193 |
| 2026-11-09 20:41Z | 9904 | 2730 | 6090 | 891 | 193 |
| 2026-11-09 20:46Z | 9904 | 2730 | 6117 | 864 | 193 |
| B68 (end of batch) | 9904 | 2730 | 6117 | 864 | 193 |
| 2026-11-09 20:54Z | 9904 | 2733 | 6134 | 844 | 193 |
| B69 (end of batch) | 9904 | 2733 | 6134 | 844 | 193 |
| 2026-11-09 20:55Z | 9904 | 2733 | 6134 | 844 | 193 |
| 2026-11-09 20:59Z | 9904 | 2733 | 6174 | 811 | 186 |
| 2026-11-09 21:05Z | 9904 | 2736 | 6217 | 769 | 182 |
| 2026-11-09 21:12Z | 9904 | 2737 | 6230 | 756 | 181 |
| 2026-11-09 21:13Z | 9904 | 2737 | 6232 | 754 | 181 |
| 2026-11-09 21:14Z | 9904 | 2737 | 6233 | 753 | 181 |
| 2026-11-09 21:19Z | 9904 | 2731 | 6251 | 741 | 181 |
| 2026-11-09 21:23Z | 9904 | 2730 | 6279 | 714 | 181 |
| 2026-11-09 21:29Z | 9904 | 2730 | 6289 | 705 | 180 |
| 2026-11-09 21:36Z | 9904 | 2732 | 6312 | 681 | 179 |
| 2026-11-09 21:40Z | 9904 | 2732 | 6320 | 673 | 179 |
| 2026-11-10 01:31Z | 9904 | 2732 | 6320 | 673 | 179 |
| 2026-11-10 01:35Z | 9904 | 2732 | 6333 | 660 | 179 |
| 2026-11-10 01:35Z | 9904 | 2732 | 6333 | 660 | 179 |
| 2026-11-10 01:40Z | 9904 | 2731 | 6350 | 645 | 178 |
| 2026-11-10 01:49Z | 9904 | 2731 | 6350 | 645 | 178 |
| 2026-11-10 01:54Z | 9904 | 2727 | 6376 | 624 | 177 |
| 2026-11-10 02:00Z | 9904 | 2730 | 6395 | 604 | 175 |
| 2026-11-10 02:06Z | 9904 | 2723 | 6435 | 573 | 173 |
| 2026-11-10 03:00Z | 9904 | 2721 | 6455 | 555 | 173 |
| 2026-11-10 03:06Z | 9904 | 2722 | 6473 | 536 | 173 |

## Other subsystems

- enters tapped / with counters / as-enters choice: 1569
- attached host P/T or keyword grant (oracle reader): 751
- saga / modal bullet text: 588
- cost modification: 580
- cast/play permission: 290
- combat evasion / requirement (oracle reader): 269
- untap restriction / hand size (oracle reader): 197
- keyword with reminder (keywordAbilities/*): 124
- uncounterable / timing: 82
- all creature-type have keyword (typedAndKeywordLords): 64
- blocker-quality evasion (combatQualifierBlockRestriction): 63
- d20 result band line (oracle IR die_roll_results via oracleIRParserDieRollInlineBandTables): 61
- commander / deck rules: 58
- partner family deck construction (partnerDeckValidation): 49
- mana ability text: 49
- sticker ability sheet (stickers / Un-set): 43
- variable P/T count (variablePTCalculator): 42
- enters prepared (prepared): 40
- control Aura layer 2 (staticEffectSpecAuraControl): 40
- copy entry exceptions (copyEntryExceptions): 37
- trigger doubling (trigger-doublers): 33
- attack needs defender land type (combatDefendingLandRestriction): 33
- power-only CDA (variablePowerOnlyCalculator): 30
- blocker capacity (combatBlockerCapacity): 30
- escape graveyard cast (interactionGraveyardCastExecution): 24
- paired P/T + quoted grants (PairedThresholdQuotedGrants): 24
- Theros god devotion type-loss (updateGodCreatureStatus): 22
- revealed hands/library top flags (revealedInformationFlags): 21
- generic count CDA (variablePTGenericCountCDA): 21
- Visit ability word (Attraction visit trigger): 21
- casting limits (staticCastingRestrictions + OracleExtras): 19
- damage by toughness (turnCombatDamageByToughness): 17
- kicker incl. and/or two-cost kicker (kickerCostUtils): 15
- assign combat damage as though unblocked (combatAssignAsThoughUnblocked): 15
- multikicker (multikickerCastUtils): 15
- color can't-be-blocked-by (combatColorBlockRestriction): 14
- cumulative upkeep non-mana (cumulativeUpkeep): 14
- control-type self keywords (batch82LongTailStatics): 14
- borrowed activated abilities (staticEffectSpecBorrowedActivated): 13
- Case to-solve condition (caseSolve): 13
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
- land animation aura (attachedTypeSettingStamp / setBasePT / attachedExtras): 10
- Companion deck restriction (companion): 10
- attached unblockable (combatBatch28ConditionalUnblockable): 9
- attached/except color block restriction (combatExceptColorBlockRestriction): 9
- ability-word bang trigger (when/whenever/at): 9
- amplify N (amplifyEntry): 9
- assist (assistPayment): 9
- must block each combat (combatMustBlockEachCombat): 9
- draft-only text (not applicable to constructed play): 9
- cumulative upkeep pay life / mana (cumulativeUpkeepPayment): 9
- variable P/T graveyard/artifact count (variablePTCalculator): 8
- legend rule exemption (legendRuleExemptions): 8
- minimum blockers (combatMinimumBlockers): 8
- protection from the chosen color (combat-mechanics getPermanentProtections): 8
- monstrous self keyword (conditionalSelfGrants): 8
- attack as though no defender, global/self/conditional (combatDefenderAttackPermission): 7
- cant attack alone (combatBatch53AttackAlone): 7
- equipped for-each source counters (batch73LongTailStatics): 7
- attached activation lock (staticActivationLockFromAttachments): 7
- aura P/T + goad (goad-effects / calculateAllPTBonuses): 7
- untap step cap N TYPE (untapStepLimits): 6
- entering doesn't cause abilities to trigger (triggeredAbilitySuppression): 6
- qualified untap prohibition tail (untapQualifierProhibitions): 6
- chosen-name activation lock (chosen-name-restrictions): 6
- Descend ability word trigger (not as-long-as static): 6
- chosen type in addition (creatureTypeNow): 6
- equipment attached self pump (countedPT): 6
- attached land type set (manaAbilityLandTypeModifiers): 6
- self unblockable except by flying/reach (combatBatch25BlockRestrictions): 6
- control-count attack/block gate (combatBatch33AttackRestrictions): 6
- morph/megamorph/disguise turn-face-up cost (faceDownCasting): 6
- self unblockable while defender controls TYPE (combatDefenderControlsUnblockable): 5
- spell convoke grant template (spellConvokeGrantTemplate): 5
- chosen-name cast lock (chosen-name-restrictions): 5
- COLOR creatures / basic lands don't untap (turn-phases detectDoesntUntapEffects filters): 5
- evoke exile-a-card cost + evoke sacrifice (evokeKeyword): 5
- variable P/T color permanent count (variableColorPermanentCount): 5
- exiled-card name cast lock (exiledCardNameCastLock): 5
- discard-to-battlefield replacement (discardToBattlefieldReplacement): 5
- qualified untap prohibition (untapQualifierProhibitions): 5
- damage can't be prevented (gameStateEffectsMillDamage canDamageBePrevented): 4
- cast only if cast another spell this turn (castOnlyIfCastAnotherRestriction): 4
- clone entry copy (asEntersCopyChoice): 4
- enters under opponent control (triggers/control-change): 4
- group untap during each other player's untap step (turnPhaseUntapStepEffects): 4
- graveyard targeting restriction (graveyardTargetingRestriction): 4
- battlefield cast restriction tail (castRestrictionTailFamilies): 4
- firebending X (attack-detection resolveFirebendingAmount): 4
- self shuffle-into-library replacement (replacementEffectSpec): 4
- gift keyword (keywordAbilities/gift): 4
- colour-sourced targeting restriction (colorSourceTargetingRestriction): 4
- other subtype-or anthem (batch65LongTailStatics): 4
- enters untapped override (landsEnterUntappedOverride): 4
- attached P/T and loses flying (permanentKeywordAbilities): 4
- crew/saddle as though power were N greater (crewSaddlePowerBonus): 4
- untap during each other player's untap step (turnPhaseUntapStepEffects): 4
- prevent all combat damage to self (prevention / replacementBatch64): 4
- commanders you control keywords (batch79LongTailStatics): 4
- is also creature types (intrinsicAlsoCreatureTypes): 4
- static convoke grant (casting-modifiers): 3
- group untap on other turns (turnPhaseUntapStepEffects): 3
- cowards can't block warriors (combatDefenderAttackPermission): 3
- players can't draw cards (playersCantDrawCards): 3
- attacker/blocker self-tax aura or printed (combatAttackerSelfTax): 3
- noncombat damage to opponents +N / double (replacementBatch16LongTail damage templates): 3
- can't cast during your first turns (firstTurnsCastRestriction): 3
- flagbearer targeting requirement (flagbearerTargeting): 3
- reveal first draw each turn (firstDrawRevealStatic): 3
- own graveyard -> exile from anywhere (zone-change template): 3
- morph/disguise non-mana or mixed turn-face-up cost (turnFaceUpCostComponents): 3
- per-draw replacement: skip / exile face up / graveyard return / opponent redirect (replacementBatch19DrawInstead): 3
- self power block evasion (batch74LongTailStatics): 3
- type creatures source-counter anthem (batch79LongTailStatics): 3
- spell lifelink grant (spellLifelinkGrant): 3
- printed self attack/block tax (combatAttackerSelfTax): 3
- hexproof until dealt combat damage (selfStateGrants): 3
- zone cast lock (batch31CastLocks): 3
- enchanted/fortified land keywords (attachmentKeywordGrants): 3
- "~ is all colors" CDA (selfAllColorsCDA via getEffectiveColors): 3
- activate abilities as though haste (gameActionsPermanentKeywordGrants): 3
- regenerate instead of destroy (replacementBatch16LongTail): 3
- dice advantage (dieRollAdvantage): 3
- equip sacrifice cost (targetSelectionEquipSacrificeCost): 3
- pregame commander color (commanderPregameColorChoice): 3
- lands are every basic land type (manaAbilityLandTypeModifiers): 3
- hand larger than opponents self pump (conditionalSelfGrants): 3
- subtype you-control power CDA (variablePowerOnly): 3
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
- counters remain across zones (zoneRetainedCounters): 2
- self cast restriction land/life this turn (castRestrictionTailFamilies): 2
- global permanent colour set (globalColorSetting): 2
- attack only nearest opponent in chosen direction (mysticBarrierAttackDirection): 2
- graveyard encore grant (graveyardEncoreGrants): 2
- cant become untapped on enchanted host (untapQualifierProhibitions): 2
- hand foretell grant (foretellGrants): 2
- extra Treasure (token template): 2
- source damage plus replacement (replacementBatch21DamageScaling): 2
- draw-per-turn cap (playersCantDrawCards): 2
- drawn-cards conditional unblockable (combatBatch28ConditionalUnblockable): 2
- counters put this turn self keyword (batch62LongTailStatics): 2
- players who chose war/peace anthem (playerChoseWarPeaceAnthems): 2
- food or golem creature anthem (batch62LongTailStatics): 2
- prevent damage, remove +1/+1 counters [+ tokens/rad] (replacementBatch17DamagePrevention): 2
- creatures don't untap (turn-phases all_creatures untap prevention): 2
- power equal multi-subtype count (variablePowerOnlyCalculator): 2
- echo non-mana cost (echoNonManaCost): 2
- self grant after committing a crime (conditionalSelfGrants): 2
- noncombat damage prevent + life/counters follow-up (replacementBatch18NoncombatPrevention): 2
- CDA life paid on entry (asEntersPayAnyLife): 2
- attached block-only-flying (combatBatch30AttachedBlockRestrictions): 2
- graveyard escape grant (graveyard-permissions): 2
- split color creatures on battlefield CDA (variablePowerOnlyCalculator): 2
- all GY where-x attached (countedPT): 2
- sorcery-timing cast lock (opponentSorceryTimingLock): 2
- equip energy or life cost (equip cost): 2
- self keyword while type card in GY (conditionalSelfGrants): 2
- maximum blockers (combatBatch30BlockLimits): 2
- control-type quoted self ability (batch84LongTailStatics): 2
- graveyard-count attack gate (combatBatch30AttackRestrictions): 2
- artifact and/or color block restriction (combatBatch31BlockRestrictions): 2
- suspend keyword (suspendCard / turnStepUpkeep): 2
- can't be blocked except by defender/walls (evasion): 2
- non-subtype creatures can't attack (combatBatch33AttackRestrictions): 2
- COLOR creatures can't attack unless controller sacrifices a land (attackCostPermanentPayment): 2
- zone enter lock (batch31CastLocks): 2
- damage becomes counters (damage side-effect template): 2
- opponent-turn cast lock (batch31CastLocks): 2
- instant/sorcery GY self pump (batch80LongTailStatics): 2
- self cast prohibition (playerActionProhibitions): 2
- attached opponent-targeting protection (permanentTargeting): 2
- exact counter self P/T (conditionalSelfGrants): 2
- draft-only (Conspiracy draft matters; no in-game effect): 2
- lesson GY keyword (batch78LongTailStatics): 2
- turned face up counters (turnFaceUpCounterPlacement): 2
- already-attacked-player attack gate (combatBatch37Restrictions): 2
- named attacks each combat (attackRequirement): 2
- counter placement restriction (counterPlacementRestrictions): 2
- additional land each player (calculateMaxLandsPerTurn): 2
- creature cards zone enter lock (batch31CastLocks): 2
- power-gated team blocker cap (combatBatch30BlockLimits): 2
- counter ignore defender (batch82LongTailStatics): 2
- instant/sorcery spell keywords (batch82LongTailStatics): 2
- share-type attached pump (batch82LongTailStatics): 2
- block shadow as though (blockAsThoughShadow): 2
- self damage unpreventable (canDamageBePrevented): 2
- aura-spell target restriction (auraSpellTargetRestriction): 2
- opponents must attack (attackRestrictionText): 2
- CDA all hands count (variablePTCalculator): 2
- team counter-kind placement ban (counterPlacementRestrictions): 2
- enchanted destroy -> sacrifice aura + indestructible (enchantedPermanentDestroyReplacement): 2
- keyword-qualified block evasion (combatQualifierBlockRestriction): 2
- self creature-cast prohibition (playerActionProhibitions): 2
- opponent extra turn skipped (replacementBatch18ExtraTurnSkip via dropSkippedExtraTurns): 2
- graveyard scavenge grant (graveyardScavengeGrants): 2
- equip discard cost (targetSelectionEquipDiscardCost): 2
- defender permission after a type entered this turn (combatDefenderAttackPermission): 2
- opponent-caused sacrifice protection (sacrificeCauseProtection): 2
- global flying block-only-flying (combatBatch36Restrictions): 2
- noncombat damage becomes counters on opponent creature (Soul-Scar Mage): 1
- must attack unless you control another Ally (attackRequirementTextExtras): 1
- explore-again replacement (keywordActionRepetition): 1
- alternative equip cost choice (targetSelectionEquipAlternativeCost): 1
- storage matrix untap choice (untapTypeChoiceRestriction): 1
- control-type attack gate (combatBatch36Restrictions): 1
- nonbasic land untap prohibition (untapQualifierProhibitions): 1
- creatures with keyword cant attack you or block your creatures (AttackYouTax): 1
- triggered abilities cant sacrifice/exile your creature tokens (tokenSacrificeExileLock): 1
- attack last-turn attackers despite defender (combatDefenderAttackPermission): 1
- land play restriction (landPlayRestrictionFamilies): 1
- granted rebound (spellReboundGrant): 1
- attached enchantment type set (attachedTypeSettingStamp): 1
- clone enter as Doctor from GY this turn (asEntersCopyChoice): 1
- spells have split second if artifact mana spent (shadowSplitSecondGrant): 1
- Fasting draw-step may-skip, OPTION_CHOICE (optionalDrawStepSkip): 1
- sagas you control have read ahead (triggerSagaEntryChapters): 1
- wall-only target restriction (wallOnlyTargetRestriction): 1
- equipped creatures during your turn keyword grant (TypedAndKeywordLords): 1
- instant/sorcery damage cap (replacementBatch23DamageCap): 1
- off-battlefield CDA creature types (offBattlefieldCda): 1
- must attack + cannot attack owner or owner planeswalkers (attackRestrictionText): 1
- planeswalk replacement (planechase / planar deck): 1
- scoped grant with trailing as-long-as condition (staticEffectSpecOracleParsingConditionalScopedGrants): 1
- creatures attacking enchanted player have keywords (target_is_attacking_enchanted_player): 1
- self can't attack unless return TYPE to hand (attackCostPermanentPayment): 1
- hand cycling grant (handCyclingGrants): 1
- as-attached name+type choose (Psychic Paper): 1
- protection from the chosen player (combat-mechanics getPermanentProtections): 1
- block SUBTYPE as though reach (combatBatch26BlockRestrictions): 1
- draft-only reveal card pool (Conspiracy draft): 1
- echo cost equals life total (echo keyword): 1
- creatures you control with no abilities can't be blocked by creatures with abilities (combatNoAbilitiesBlockRestriction): 1
- player protection from chosen name (Runed Halo): 1
- lands lose non-mana abilities (Blood Sun): 1
- mobilize X from GY creature count (mobilize keyword): 1
- sticker kicker on creature spells (sticker kicker): 1
- as-though haste unless entered this turn (creatureHasHaste): 1
- graveyard-top creature text copy (gyTopTextCopyStatic): 1
- same-name nonbasic land play lock (landPlaySameNameRestriction): 1
- land type setting chosen basics (manaAbilityLandTypeSettingOracle): 1
- devotion increase each color/combo (devotionBonusStatic): 1
- attack/block tap-creature cost (attackBlockTapCost): 1
- equipment you control have equip cost (equipmentEquipCostGrants): 1
- equipped base P/T equal life (batch62LongTailStatics): 1
- counters put this turn creature lord (batch62LongTailStatics): 1
- untapped prevent N creature combat damage to you (replacementBatch63): 1
- combat damage prevent and shuffle into library (replacementBatch63): 1
- quest-counter attack trigger (trigger): 1
- creatures attacking last chosen player have keywords (batch63AttackChosenPlayerGrants): 1
- commander spells have cascade (cascadeCastGrants): 1
- tokens plus a mutagen token (replacementEffectSpecTokenOracleTemplates): 1
- self infect while opponent poisoned (opponent_poison_at_least): 1
- mounts and vehicles hexproof during turn (batch62LongTailStatics): 1
- land creature or land entered this turn self (controller_land_creature_or_land_entered_this_turn): 1
- draw exile library face down (replacementBatch19DrawInstead): 1
- loyalty threshold creature CDA (batch63LoyaltyCdaStatics): 1
- cards in graveyards lose all abilities (gyLoseAllAbilitiesStatic): 1
- discarded this turn alternate cast cost (casting-modifiers): 1
- chosen-color instant/sorcery damage redirect to controller (replacementBatch66): 1
- enchanted permanent is legendary (attachedExtras): 1
- equip alternate pay or remove counter (equip cost): 1
- max attackers against source permanent (batch65LongTailStatics): 1
- your-turn mountains where-x pump (batch68LongTailStatics): 1
- self P/T during turns other than yours (batch65LongTailStatics): 1
- spell damage to you or another prevent (replacementBatch64): 1
- spell damage to opponent plus N (replacementBatch64): 1
- creatures with counters damage double (replacementBatch65): 1
- as you cascade put land from exile (Averna cascade): 1
- prevent damage to you, counter on source (replacementBatch17DamagePrevention): 1
- each card-type creature has keywords (typedAndKeywordLords): 1
- power-at-most creatures block evasion (batch66LongTailStatics): 1
- other type attack each combat if able (batch66LongTailStatics): 1
- instant/sorcery storm grant (stormCastGrants): 1
- self cascade if graveyard card types (cascadeCastGrants): 1
- self every nonbasic land type (batch69LongTailStatics): 1
- N-headed coin first flip comes up heads (coin flip): 1
- self keyword after attacking a battle (conditionalSelfGrants): 1
- owned off-battlefield vampire madness grant (Falkenrath Gorger): 1
- opponent type can't block and can't attack you (batch69LongTailStatics): 1
- hand size equal to counters on source (handSizeStaticModifiers): 1
- nongreen source targeting restriction (colorSourceTargetingRestriction): 1
- protection from own colors (batch68LongTailStatics): 1
- learn instead return from GY (Retriever Phoenix): 1
- non-horror slime base P/T (batch68LongTailStatics): 1
- tokens plus a frog creature token (replacementEffectSpecTokenOracleTemplates): 1
- chosen-type creatures on battlefield CDA (variablePowerOnlyCalculator): 1
- off-battlefield creature flash grant (offBattlefieldFlashGrants): 1
- CDA forests sacrificed as entered (Wood Elemental): 1
- borrow last chosen exiled card abilities (Koh): 1
- graveyard sneak grant (graveyard-permissions): 1
- basic land type mana remaps (Reality Twist): 1
- self haste while no opponent controls colored creatures (conditionalSelfGrants): 1
- instant/sorcery from hand cascade grant (cascadeCastGrants): 1
- power equal +1/+1 counters on lands CDA (variablePowerOnlyCalculator): 1
- draw from exiled pile instead (Parallel Thoughts): 1
- lethal damage by power not toughness (Zilortha combat): 1
- morph sacrifice cost (morph keyword): 1
- as turned face up attach aura (morph / manifest): 1
- enchanted artifact becomes creature P/T = MV (batch70LongTailStatics): 1
- prevent damage to opponent, each opponent mills (gameStateEffectsMillDamage): 1
- permanents can't phase in (phasing lock): 1
- self keyword while desert on board or in GY (conditionalSelfGrants): 1
- chosen player damage double (replacementBatch64): 1
- cast target must be tapped (Enthralling Hold): 1
- first historic spell has convoke (convoke grant): 1
- oil-counter creature anthem (batch69LongTailStatics): 1
- type spells have freerunning (freerunning grant): 1
- self can't block high power unless pay (combat tax): 1
- noncreature artifacts become MV creatures (Titania's Song): 1
- spell damage prevent N globally (replacementBatch64): 1
- top library creature color anthem (Crown of Convergence): 1
- basic land mana N times (mana replacement): 1
- other transformed permanents keyword lord (batch70LongTailStatics): 1
- damage prevent and give control (Kharn): 1
- self pump+keyword while life AND opponent life (conditionalSelfGrants): 1
- saga spells have replicate equal mana cost (replicateCastUtils): 1
- opponents without flying/reach can't block low power (Sidar Kondo): 1
- madness pay N colorless (madness keyword): 1
- enchanted player damage double (replacementBatch64): 1
- equipment attach toughness gate (equipment restriction): 1
- enchanted or equipped creature-token anthem (batch70LongTailStatics): 1
- protection from exiled card types (Mirror Golem): 1
- hand slivercycling grant (handCyclingGrants): 1
- untapped guardian of noncreature artifacts (Guardian Beast): 1
- opponent who cast can't attack (Angelic Arbiter): 1
- first tokens become copies of equipped (Mirrormind Crown): 1
- counters among creatures as-though no defender (Backstreet Bruiser): 1
- most permanents cast/play lock (Damping Engine): 1
- damage becomes sacrifice permanents (Dralnu): 1
- opponent-source damage to you prevent N (replacementBatch64): 1
- enter as copy of any equipment (asEntersCopyChoice): 1
- chosen-type creature trigger doubler (trigger-doublers): 1
- self pump per noncreature nonland in GY (countedPT): 1
- players can't pay life or sacrifice creatures to cast/activate (Angel of Jubilation): 1
- attacking +X lands defending player (Elturel Survivors): 1
- empty library base P/T + keywords (batch71LongTailStatics): 1
- power = N plus opponent GY card types CDA (variablePTControlledCountCDA): 1
- type you control combat damage mills player (gameStateEffectsMillDamage): 1
- instant/sorcery GY threshold self pump (batch71LongTailStatics): 1
- during end step warrior tokens can't be sacrificed (Zurgo): 1
- aura+equipment attached count + ward (countedPT): 1
- wizard you control damage double (replacementBatch64): 1
- protection from colors among permanents (batch71LongTailStatics): 1
- equip remove charge counter (equip cost): 1
- self pump while controlling leveled creature (batch71LongTailStatics): 1
- zombies and/or tokens anthem (batch71LongTailStatics): 1
- opponent discard to top of library (Nephalia Academy): 1
- equip pay life per hand card (equip cost): 1
- all creatures -X hand size (batch71LongTailStatics): 1
- graveyard unearth grant (graveyard-permissions): 1
- each legendary creature anthem (batch71LongTailStatics): 1
- same-name nontoken creature anthem (Mirror Box): 1
- ice-counter permanents are snow (batch71LongTailStatics): 1
- non-human werewolves can't transform (Immerwolf): 1
- warp pay life cost (warp keyword): 1
- blocking creatures +N per source counters (Crescendo): 1
- prevent damage, put that many counters (replacementBatch17DamagePrevention): 1
- self -N per chosen player hand (Nyxathid): 1
- copy spell plus one additional (Twinning Staff): 1
- face-down enchanted can't turn face up (Unable to Scream): 1
- self pump per cycling card in GY (Vile Manifestation): 1
- gold-counter wall + defender (batch71LongTailStatics): 1
- equipped +X from counters on equipment (batch71LongTailStatics): 1
- enchanted color loses all abilities (Ray of Frost): 1
- during turn self + enchantment creatures keywords (Yuna): 1
- creatures attacking you P/T (batch71LongTailStatics): 1
- chosen player reveals draws (Booby Trap): 1
- delirium as-though no defender (Geist): 1
- can't be target of COLOR or COLOR opponent spells (Fiendslayer): 1
- planeswalkers ignore 0 loyalty (Sanctum Lurker): 1
- enchanted -X/-Y snow lands (Snowblind): 1
- land mana produces only {M} (Contamination): 1
- can't attack unless control knight or soldier (War Falcon): 1
- red spell damage plus N (replacementBatch64): 1
- equip pay life (equipNonManaCosts): 1
- draw from bottom of library (River Song): 1
- players keep unspent mana (Upwelling): 1
- battlefield-has combat lock (selfCombatConditions): 1
- modified as-though no defender (combatDefenderAttackPermission): 1
- power = creatures with keyword CDA (variablePowerOnlyCalculator): 1
- basic land controller shroud (batch73LongTailStatics): 1
- self+enchanted dual count anthem (batch74LongTailStatics): 1
- lands you control are basic (batch73LongTailStatics): 1
- named creature anthem (batch72LongTailStatics): 1
- token isn't legendary (batch72LongTailStatics): 1
- another source you control damage plus N (replacementBatch64): 1
- mounts/vehicles haste (batch72LongTailStatics): 1
- nonland permanents chosen color set (batch73LongTailStatics): 1
- exiled card types self pump (batch73LongTailStatics): 1
- red source damage to player plus N (replacementBatch65): 1
- power = nonbasic lands opponents control CDA (variablePowerOnlyCalculator): 1
- opponents must attack with at least N (attackRequirement): 1
- noncreature spells cast keyword (conditionalSelfGrants): 1
- graveyard unearth grant creatures (graveyard-permissions): 1
- oil/counter at-most keywords (selfCounterThreshold): 1
- legendary where-x anthem (batch73LongTailStatics): 1
- P/T = spirits and/or enchantments CDA (variablePTCalculator): 1
- players can't cast during combat (staticCastingRestrictions): 1
- power = colorless creatures CDA (variablePowerOnlyCalculator): 1
- other colorless bloodthirst (batch74LongTailStatics): 1
- can't be equipped (batch73LongTailStatics): 1
- can't be targeted unless attacked/blocked (targeting): 1
- on-battlefield also land (batch74LongTailStatics): 1
- graveyard retrace grant (graveyard-permissions): 1
- graveyard jump-start exactly-N-colors (graveyard-permissions): 1
- enchanted can't attack or block (batch74LongTailStatics): 1
- non-phyrexian per-turn cast cap (staticCastingRestrictions): 1
- chroma mana-symbol anthem (batch74LongTailStatics): 1
- equip as though instant (equipTiming): 1
- threshold type anthem (batch74LongTailStatics): 1
- power = opponents' type CDA (variablePowerOnlyCalculator): 1
- chosen player hand size set (handSizeStaticModifiers): 1
- named equipment indestructible (batch75LongTailStatics): 1
- enchanted as-though no defender (combatDefenderAttackPermission): 1
- noncreature artifacts MV creatures (batch75LongTailStatics): 1
- self combat lock power at least (selfCombatConditions): 1
- greatest GY power self pump (batch75LongTailStatics): 1
- other named-creature self anthem (batch75LongTailStatics): 1
- visited attraction indestructible (batch75LongTailStatics): 1
- attached otherwise type PT (conditionalAttachedPT): 1
- modified quoted self ability (batch84LongTailStatics): 1
- self ability target lock (batch80LongTailStatics): 1
- opponents can't cast COLOR creature spells (staticCastingRestrictions): 1
- equipment attach power gate (equipmentAttachPowerGate): 1
- except by artifact creatures (combatBatch31): 1
- control enchanted enchantment (auraControl): 1
- except by vehicles (combatBatch31): 1
- vehicles you control anthem (batch76LongTailStatics): 1
- unspent mana self pump (batch77LongTailStatics): 1
- metalcraft self animate (batch76LongTailStatics): 1
- self+enchanted all-GY creature pump (batch76LongTailStatics): 1
- artifact-or-enchantment self keyword (conditionalSelfGrants): 1
- other villains are heroes (batch77LongTailStatics): 1
- non-aura enchantments MV creatures (layer4TypeSetting): 1
- lands no longer snow (effectiveSnowSupertype): 1
- other modular grant (batch77LongTailStatics): 1
- defending player artifacts unblockable (combatBatch25): 1
- each player additional land (landPlay): 1
- another type-or-type self pump (conditionalSelfGrants): 1
- delirium opponent hand size (handSizeStaticModifiers): 1
- enduring story attack-you tax (attackYouTax): 1
- enchanted flying/reach block + hexproof (batch77LongTailStatics): 1
- exact named legend exemption (legendRuleExemptions): 1
- other named creature buff+keywords (batch76LongTailStatics): 1
- off-turn artifact animate (batch78LongTailStatics): 1
- instant and sorcery GY keywords (batch78LongTailStatics): 1
- equipped except by subtype (batch78LongTailStatics): 1
- tapped source attack-you cap (attackYouTax): 1
- cast only if creature died (castRestriction): 1
- other without counter outlast (batch78LongTailStatics): 1
- equipped creatures anthem (batch78LongTailStatics): 1
- dice-rolled self keyword (batch79LongTailStatics): 1
- any GY size self pump (batch78LongTailStatics): 1
- cast instant/sorcery self keyword (batch78LongTailStatics): 1
- enchanted player spell cap (staticCastingRestrictions): 1
- own-turn cast/activate only (staticCastingRestrictions): 1
- no-counter self pump+keyword (conditionalSelfGrants): 1
- can't cast permanent spells (staticCastingRestrictions): 1
- enchanted counters-on-others pump (countedPT): 1
- enchanted phasing except-by-type (batch79LongTailStatics): 1
- must be blocked by exactly N (batch82LongTailStatics): 1
- cast only if snow land (castRestriction): 1
- counter-gated max blockers (combatBatch30): 1
- type can't be blocked except by type (combatBatch79): 1
- every-N graveyard self pump (batch79LongTailStatics): 1
- combat damage can't be prevented (damageCannotBePrevented): 1
- untapped attacking-you PT (batch80LongTailStatics): 1
- colors among permanents power CDA (variablePowerOnly): 1
- block shadow as though (combatLandwalkOverrides): 1
- legendary type self pump (conditionalSelfGrants): 1
- max speed combat lock (selfCombatConditions): 1
- attacking creature token keywords (batch80LongTailStatics): 1
- yasharn pay-life/sacrifice lock (Angel of Jubilation family): 1
- enchanted permanent phasing (batch80LongTailStatics): 1
- snow land self keyword (batch80LongTailStatics): 1
- opponent owns exile self pump (batch80LongTailStatics): 1
- base power/toughness attached count (countedPT): 1
- counters-on-them keywords (qualifiedScopes): 1
- enchanted spell target lock (batch80LongTailStatics): 1
- named count animate vehicle (batch82LongTailStatics): 1
- flanking have flanking (batch82LongTailStatics): 1
- colors among permanents self pump (countedPT): 1
- even mana value cast lock (castRestrictionTail): 1
- even mana value block lock (batch82LongTailStatics): 1
- own-turn cast only (castRestrictionTail): 1
- N plus color creatures toughness CDA (variablePowerOnly): 1
- enchanted player creatures anthem (batch81LongTailStatics): 1
- multi-type creature anthem (batch81LongTailStatics): 1
- another creature entered self pump (conditionalSelfGrants): 1
- opponent empty hand self pump (conditionalSelfGrants): 1
- metalcraft equip {0} (hasMetalcraft): 1
- forests on battlefield power CDA (variablePowerOnly): 1
- chosen player creatures CDA (variablePTControlledCountCDA): 1
- self can't be sacrificed (batch81LongTailStatics): 1
- chosen creature pump (batch84LongTailStatics): 1
- aspect of wolf half forests (batch84LongTailStatics): 1
- lands are deserts (batch82LongTailStatics): 1
- named creatures nontoken-color conditional (batch81LongTailStatics): 1
- opponents hands self pump (countedPT): 1
- noncreature GY/exile cast lock (castRestrictionTail): 1
- nongreen opponent target lock (batch82LongTailStatics): 1
- self ignore defender after I/S (batch81LongTailStatics): 1
- your-turn attacking creatures anthem (batch81LongTailStatics): 1
- host GY where-x attached (countedPT): 1
- protection from chosen card type (batch84LongTailStatics): 1
- counter combat lock (batch81LongTailStatics): 1
- exiled card mana value CDA (variablePTControlledCountCDA): 1
- type ignore defender (batch81LongTailStatics): 1
- greatest MV among artifacts self pump (countedPT): 1
- enchanted creature-and-or-vehicle pump (batch83LongTailStatics): 1
- chosen-number noncreature cast lock (castRestrictionTail): 1
- control N/N attack lock (selfCombatConditions): 1
- power or less unblockable (batch83LongTailStatics): 1
- your-turn planeswalker creature (batch84LongTailStatics): 1
- lavinia lands cast lock (castRestrictionTail): 1
- creature-with-counter self pump (conditionalSelfGrants): 1
- noncreature nonland GY power CDA (variablePowerOnly): 1
- other flying you-control self pump (countedPT): 1
- creature+planeswalker GY self pump (countedPT): 1
- your-turn equipped self keywords (batch82LongTailStatics): 1
- players can't cycle (cycleRestrictionFamilies): 1
- permanent-cards GY where-x attached (countedPT): 1
- untapped noncreature artifact keywords (batch83LongTailStatics): 1
- cards drawn this turn anthem (countedPT): 1
- menace creatures min blockers (batch76LongTailStatics): 1
- saga lore self keywords (batch77LongTailStatics): 1
- sacrificed permanent self pump (conditionalSelfGrants): 1
- battlefield counter self keywords (batch76LongTailStatics): 1
- chosen PW type hexproof (batch77LongTailStatics): 1
- nonlegendary artifact creature keywords (batch83LongTailStatics): 1
- entered-this-turn you-control keywords (batch83LongTailStatics): 1
- untapped not-attacking anthem (batch82LongTailStatics): 1
- basic land subtype animate (layer4TypeSetting): 1
- chroma mana-symbol P/T CDA (variablePTControlledCountCDA): 1
- strange new worlds count basis (trekCountBases): 1
- prevent damage to you and mill (replacementBatch17DamagePrevention): 1
- lands can't enter (batch31CastLocks): 1
- type-or self pump (conditionalSelfGrants): 1
- cards you own in exile CDA (variablePTControlledCountCDA): 1
- prevent damage to you and exile from graveyard (replacementBatch17DamagePrevention): 1
- reveal-until-kind draw replacement (zonesDrawReplacementRevealUntilKind): 1
- alternative reconfigure cost choice (targetSelectionEquipAlternativeCost): 1

## Top 40 unhandled families (by cards affected)

| # | Scope | Family | Cards | Example cards |
|---|---|---|---|---|
| 1 | static | as long as ~ is enchanted, equipped, and has a counter on it, ~ has "…" | 1 | Kosei, Penitent Warlord |
| 2 | static | ~ attacks an opponent with the most life among your opponents each combat if able unless you control a creatur | 1 | Galactus, Devourer of Worlds |
| 3 | static | create N treasure tokens, then sacrifice ~ and open an attraction | 1 | Pick-a-Beeble |
| 4 | static | spend only mana produced by creatures to cast this spell | 1 | Myr Superion |
| 5 | replacement | if you would create a fish token, create a ±N/±N COLOR shark creature token instead | 1 | Fisher's Talent |
| 6 | replacement | if you would create a shark token, create an ±N/±N COLOR octopus creature token instead | 1 | Fisher's Talent |
| 7 | static | as ~ transforms into ~, attach it to a player | 1 | Curse of Leeches // Leeching Lurker |
| 8 | replacement | if you would scry a number of cards, scry that many cards plus N instead | 1 | Kenessos, Priest of Thassa |
| 9 | replacement | if a creature an opponent controls would die, instead exile it and put a number of ±N/±N counters equal to tha | 1 | Ravenous Slime |
| 10 | replacement | if you would proliferate, proliferate twice instead | 1 | Tekuthal, Inquiry Dominus |
| 11 | replacement | if you would lose the game, instead exile ~ and your life total becomes equal to your starting life total | 1 | Exquisite Archangel |
| 12 | replacement | if you would draw a card while your library has no cards in it, instead return a creature card from your grave | 1 | Out of the Tombs |
| 13 | static | each creature has "…" | 1 | Endless Whispers |
| 14 | static | COLOR creatures have "…" | 1 | Breath of Dreams |
| 15 | replacement | if you would draw a card, reveal the top card of your library instead | 1 | Enduring Renewal |
| 16 | static | as long as ~ is attached to a creature, ~ can't be attacked and has "…" | 1 | The Aetherspark |
| 17 | replacement | if a source would deal damage to a player, you may prevent x of that damage, where x is the number of clerics  | 1 | Battletide Alchemist |
| 18 | replacement | if combat damage would be dealt to ~, prevent that damage and exile that many cards from the top of your libra | 1 | Gloom Surgeon |
| 19 | static | each human creature you control has "…" | 1 | Titan of Eternal Fire |
| 20 | replacement | during your turn, as long as you haven't activated an exhaust ability this turn, you may activate exhaust abil | 1 | Elvish Refueler |
| 21 | replacement | if a rigger you control would assemble a contraption, it assembles N contraptions instead | 1 | Steamflogger Boss |
| 22 | static | any time you could mulligan and this card is in your hand, you may exile all the cards from your hand, then dr | 1 | Serum Powder |
| 23 | replacement | if a noncreature source you control would deal damage to a creature, battle, or opponent, it deals that much d | 1 | Invasion of Regatha // Disciples of the Inferno |
| 24 | static | if ~ is unblocked, you may have it assign its combat damage to a creature defending player controls | 1 | Cunning Giant |
| 25 | replacement | prevent all damage that would be dealt to a creature by another creature if they share a color | 1 | Well-Laid Plans |
| 26 | static | nitro-N — whenever ~ attacks, you may sacrifice an artifact | 1 | Ace, Fearless Rebel |
| 27 | replacement | if you would draw a card, look at the top N cards of your library instead | 1 | Tomorrow, Azami's Familiar |
| 28 | replacement | the first time you would draw a card each turn except the first card you draw during each of your draw steps,  | 1 | Reed Richards, Smartest Man |
| 29 | static | bestow—{M}, collect evidence N | 1 | Detective's Phoenix |
| 30 | static | each creature spell you cast with mana value N or greater has blitz | 1 | Henzie "Toolbox" Torre |
| 31 | replacement | if a creature dealt damage this turn by a source you controlled would die, exile it instead | 1 | Kumano Faces Kakkazan // Etching of Kumano |
| 32 | static | other zombies have "…" | 1 | Zombie Master |
| 33 | replacement | if a modular triggered ability would put N or more ±N/±N counters on a creature you control, that many plus N  | 1 | Zabaz, the Glimmerwasp |
| 34 | static | commander creatures you own have menace and "…" (a creature with menace can't be blocked except by N or more c | 1 | Criminal Past |
| 35 | static | enchanted creature gets ±N/±N for each name sticker on ~ with N or fewer letters | 1 | Last Voyage of the _____ |
| 36 | static | sliver spells you cast have cascade | 1 | The First Sliver |
| 37 | static | vibro-shock gauntlets — when ~ enters, he deals N damage to target creature and N damage to that creature's co | 1 | Shocker, Unshakable |
| 38 | replacement | if ~ would die, return it to its owner's hand instead | 1 | Firestorm Phoenix |
| 39 | static | creatures that attacked during their controller's last turn can't attack | 1 | Halls of Mist |
| 40 | replacement | as long as you have N or fewer cards in hand, if you would draw N or more cards, you draw that many cards plus | 1 | Quantum Riddler |
