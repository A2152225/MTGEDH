# Oracle Automation Next 200

Generated: `2026-04-06T08:25:47.586Z`
Source: `oracle-cards.json`
Scope: black-border paper-card automation candidates ordered by seam priority. The queue exhausts the active graveyard / recursion seam first, then spills into the next highest-population seams.

Queued items: `200`

Grant review note: when Oracle text contains quoted text like `gains "..."`, treat the quoted text as a granted effect to model separately from the host card's own effect text.

## Queue Rules

- Ordered by family priority first, then by EDHREC rank, then by card name.
- Cards are deduped by `oracle_id`, so multi-print duplicates do not crowd out breadth.
- This queue is intentionally seam-priority driven: graveyard/recursion work comes first, then the generator rolls into broader high-population seams like token creation, direct damage, draw, sacrifice, counters, and search effects.
- Nim Deathmantle-style payment + return + attach recursion is explicitly kept in the queue even when the family is small.

## Family Summary

| Family | Category | Queued | Available | Notes |
|---|---|---:|---:|---|
| Dynamic Graveyard Mana-Value Reanimation | Near-Term Graveyard Move-Zone | 1 | 1 | High-yield follow-up to the new static mana-value cap support; keep runtime-dependent caps explicit and conservative. |
| Counter-Bearing Graveyard Reanimation | Near-Term Graveyard Move-Zone | 3 | 3 | Extends the current with-counters support to more real-card variants, especially where extra legality or follow-up state matters. |
| Exact-Target Reanimation Under Your Control | Near-Term Graveyard Move-Zone | 26 | 29 | Broadens the exact-target graveyard move family with remaining qualifiers, riders, and follow-up text. |
| Exact-Target Reanimation Under Owner Control | Near-Term Graveyard Move-Zone | 1 | 1 | Small but important owner-control corner for deterministic reanimation. |
| Exact-Target Graveyard To Hand | Near-Term Graveyard Move-Zone | 9 | 9 | Useful parity family for real recursion spells that still need variant coverage and corpus locks. |
| Exact-Target Graveyard To Library | Near-Term Graveyard Move-Zone | 15 | 15 | Covers top/bottom placement variants that reuse current exact-target graveyard selectors. |
| Exact-Target Graveyard Exile | Near-Term Graveyard Move-Zone | 109 | 110 | Large real-card family that benefits from variant locks and remaining qualifier coverage. |
| Your Graveyard To Hand | Near-Term Graveyard Move-Zone | 36 | 340 | High-volume self-recursion family; good for tightening direct target binding and context-driven return paths. |
| Dies Triggers Returning The Card To Battlefield | Contextual Graveyard Recursion | 0 | 40 | Needs stronger antecedent binding from the dying object into the follow-up move-zone action. |
| Dies Triggers Returning The Card To Hand | Contextual Graveyard Recursion | 0 | 22 | Similar contextual binding seam, but with hand destination instead of battlefield. |
| Pay-To-Return Deathmantle-Style Recursion | Contextual Graveyard Recursion | 0 | 3 | Includes Nim Deathmantle-style payment + return + attachment bundles. |
| Entered Or Cast From Graveyard Checks | Graveyard Context / Conditional | 0 | 7 | Good follow-up once provenance is threaded more broadly across server and rules-engine paths. |
| Leave-Battlefield Exile Replacement Riders | Graveyard Context / Conditional | 0 | 4 | Important support glue for temporary recursion families such as unearth and similar reanimation effects. |
| Cast From Graveyard Permission Windows | Graveyard Permission / Replacement | 0 | 392 | Useful for later test runs because these create lots of visible automation gaps when not modeled cleanly. |
| Play From Graveyard Permission Windows | Graveyard Permission / Replacement | 0 | 27 | Covers lands and mixed play-permission text from graveyard. |
| Flashback Cards | Graveyard Permission / Replacement | 0 | 220 | Stable, populous graveyard-casting family to validate once permission windows and replacement text are tightened. |
| Unearth Cards | Graveyard Permission / Replacement | 0 | 60 | Pairs graveyard reanimation with the leave-battlefield exile replacement rider. |
| Escape And Similar Graveyard Alternate Costs | Graveyard Permission / Replacement | 0 | 108 | Includes escape-style casting/replay from graveyard with additional costs or modifiers. |
| Token Creation | High-Population Follow-On Seams | 0 | 3264 | Large practical seam spanning straightforward token creation, tapped/token modifier variants, and delayed cleanup follow-ups. |
| Direct Damage And Damage-Based Follow-Ups | High-Population Follow-On Seams | 0 | 2550 | Covers direct damage sentences, symmetric sweepers, and that-much/excess-damage follow-up families. |
| Draw And Draw-Scaling Effects | High-Population Follow-On Seams | 0 | 3626 | Dense seam for raw draw, target draw, each-player draw, and draw-scaling follow-up text. |
| Sacrifice And Sacrifice Follow-Up Effects | High-Population Follow-On Seams | 0 | 3677 | Useful after the graveyard slice because it overlaps strongly with death/reanimation bookkeeping and delayed cleanup. |
| +1/+1 Counter Placement And Counter Scaling | High-Population Follow-On Seams | 0 | 3724 | Large seam with lots of deterministic counter placement, ETB modifiers, and count-based follow-up clauses. |
| Life Gain And Life Loss | High-Population Follow-On Seams | 0 | 2342 | Dense practical seam for gain/lose life, target-player life swings, and equal-to/reference clauses. |
| Targeted Destroy Effects | High-Population Follow-On Seams | 0 | 1160 | Broad removal seam that tends to be straightforward once target binding and rider text are preserved. |
| Library Search And Tutor Effects | High-Population Follow-On Seams | 0 | 1004 | Large queue for search workflows, especially once resolution-queue driven player choice paths are tightened further. |
| Bounce And Return-To-Hand Effects | High-Population Follow-On Seams | 0 | 715 | Captures both battlefield bounce and zone-return effects that tend to be good deterministic automation candidates. |
| Discard Effects | High-Population Follow-On Seams | 0 | 2005 | Useful for queueing both deterministic discard counts and player-choice discard families for later resolution support. |
| Scry / Surveil / Topdeck Manipulation | High-Population Follow-On Seams | 0 | 995 | Good post-graveyard seam because it is common, visible in tests, and already has some queue-backed infrastructure on the server side. |
| Tap / Untap Effects | High-Population Follow-On Seams | 0 | 609 | Broad tactical seam with many deterministic single-target and each-target templates. |
| Counterspell And Stack Interaction | High-Population Follow-On Seams | 0 | 291 | Queue for explicit spell/ability countering and related stack-target clauses. |
| Mill Effects | High-Population Follow-On Seams | 0 | 510 | Smaller but clean seam for library-to-graveyard movement and count scaling. |
| Impulse Exile Permission Windows | High-Population Follow-On Seams | 0 | 262 | Natural next seam after graveyard and cast-from-zone work; high visibility in actual gameplay and already partially automated. |
| Fight And Bite-Style Combat Resolution | High-Population Follow-On Seams | 0 | 127 | Smaller seam, but useful for concrete combat-automation expansion after damage families are mined. |
| Goad And Attack-Pressure Effects | High-Population Follow-On Seams | 0 | 150 | Included as a modest spillover seam once higher-volume deterministic text families are exhausted. |

## Ordered Queue

### Dynamic Graveyard Mana-Value Reanimation

1. Narset, Enlightened Exile (EDHREC 4958) - Whenever Narset attacks, exile target noncreature, nonland card with mana value less than Narset's power from a graveyard and copy it.
### Counter-Bearing Graveyard Reanimation

2. From the Catacombs (EDHREC 7668) - Put target creature card from a graveyard onto the battlefield under your control with a corpse counter on it.
3. Coalstoke Gearhulk (EDHREC 8921) - When this creature enters, put target creature card with mana value 4 or less from a graveyard onto the battlefield under your control with a finality counter on it.
4. Necromantic Summons (EDHREC 17789) - Put target creature card from a graveyard onto the battlefield under your control. Spell mastery — If there are two or more instant and/or sorcery cards in your graveyard, that creature enters with two additional +1/+...
### Exact-Target Reanimation Under Your Control

5. Reanimate (EDHREC 59) - Put target creature card from a graveyard onto the battlefield under your control.
6. Necromancy (EDHREC 938) - When this enchantment enters, if it's on the battlefield, it becomes an Aura with "enchant creature put onto the battlefield with Necromancy." Put target creature card from a graveyard onto the battlefield under your control and attach this enchantment to it.
7. Portal to Phyrexia (EDHREC 1056) - At the beginning of your upkeep, put target creature card from a graveyard onto the battlefield under your control.
8. Junji, the Midnight Sky (EDHREC 1183) - • Put target non-Dragon creature card from a graveyard onto the battlefield under your control.
9. The Eldest Reborn (EDHREC 1794) - III — Put target creature or planeswalker card from a graveyard onto the battlefield under your control.
10. The Cruelty of Gix (EDHREC 3753) - III — Put target creature card from a graveyard onto the battlefield under your control.
11. Beacon of Unrest (EDHREC 4130) - Put target artifact or creature card from a graveyard onto the battlefield under your control.
12. Vat Emergence (EDHREC 4602) - Put target creature card from a graveyard onto the battlefield under your control.
13. Chainer, Dementia Master (EDHREC 5019) - {B}{B}{B}, Pay 3 life: Put target creature card from a graveyard onto the battlefield under your control.
14. Liliana, Waker of the Dead (EDHREC 5456) - −7: You get an emblem with "At the beginning of combat on your turn, put target creature card from a graveyard onto the battlefield under your control.
15. Staff of Eden, Vault's Key (EDHREC 5726) - When Staff of Eden enters, put target legendary permanent card not named Staff of Eden, Vault's Key from a graveyard onto the battlefield under your control.
16. Too Greedily, Too Deep (EDHREC 7095) - Put target creature card from a graveyard onto the battlefield under your control.
17. Debtors' Knell (EDHREC 7228) - At the beginning of your upkeep, put target creature card from a graveyard onto the battlefield under your control.
18. Gravespawn Sovereign (EDHREC 7243) - Tap five untapped Zombies you control: Put target creature card from a graveyard onto the battlefield under your control.
19. Teneb, the Harvester (EDHREC 7628) - If you do, put target creature card from a graveyard onto the battlefield under your control.
20. Demon of Dark Schemes (EDHREC 8297) - {2}{B}, Pay {E}{E}{E}{E}: Put target creature card from a graveyard onto the battlefield under your control tapped.
21. Quest for the Necropolis (EDHREC 9346) - {5}{B}, Sacrifice this enchantment: Put target creature card from a graveyard onto the battlefield under your control.
22. Fated Return (EDHREC 10328) - Put target creature card from a graveyard onto the battlefield under your control.
23. Rise from the Grave (EDHREC 10366) - Put target creature card from a graveyard onto the battlefield under your control.
24. Ashiok, Sculptor of Fears (EDHREC 11248) - −5: Put target creature card from a graveyard onto the battlefield under your control.
25. Nomad Mythmaker (EDHREC 12519) - {W}, {T}: Put target Aura card from a graveyard onto the battlefield under your control attached to a creature you control.
26. Waking the Trolls (EDHREC 13372) - II — Put target land card from a graveyard onto the battlefield under your control.
27. Grave Upheaval (EDHREC 13930) - Put target creature card from a graveyard onto the battlefield under your control.
28. Endless Obedience (EDHREC 14052) - Put target creature card from a graveyard onto the battlefield under your control.
29. Restore (EDHREC 14639) - Put target land card from a graveyard onto the battlefield under your control.
30. Iridescent Drake (EDHREC 24180) - When this creature enters, put target Aura card from a graveyard onto the battlefield under your control attached to this creature.
### Exact-Target Reanimation Under Owner Control

31. Kenrith, the Returned King (EDHREC 2959) - {4}{B}: Put target creature card from a graveyard onto the battlefield under its owner's control.
### Exact-Target Graveyard To Hand

32. Naya Charm (EDHREC 2840) - • Return target card from a graveyard to its owner's hand.
33. Grave Scrabbler (EDHREC 9876) - When this creature enters, if its madness cost was paid, you may return target creature card from a graveyard to its owner's hand.
34. Pulse of Murasa (EDHREC 10175) - Return target creature or land card from a graveyard to its owner's hand.
35. Revive the Fallen (EDHREC 12086) - Return target creature card from a graveyard to its owner's hand.
36. Mine Excavation (EDHREC 19661) - Return target artifact or enchantment card from a graveyard to its owner's hand.
37. Endbringer's Revel (EDHREC 22650) - {4}: Return target creature card from a graveyard to its owner's hand.
38. Disturbing Plot (EDHREC 23904) - Return target creature card from a graveyard to its owner's hand.
39. Vampire Charmseeker (EDHREC 23919) - When this creature enters, return target instant, sorcery, or creature card from a graveyard to its owner's hand.
40. Another Night in Vegas (unranked) - — Return target creature card from a graveyard to its owner's hand.
### Exact-Target Graveyard To Library

41. Noxious Revival (EDHREC 609) - Put target card from a graveyard on top of its owner's library.
42. Chrome Companion (EDHREC 11534) - {2}, {T}: Put target card from a graveyard on the bottom of its owner's library.
43. Junktroller (EDHREC 11602) - {T}: Put target card from a graveyard on the bottom of its owner's library.
44. Vessel of Endless Rest (EDHREC 12947) - When this artifact enters, put target card from a graveyard on the bottom of its owner's library.
45. Hoverstone Pilgrim (EDHREC 14250) - {2}: Put target card from a graveyard on the bottom of its owner's library.
46. Reito Lantern (EDHREC 14583) - {3}: Put target card from a graveyard on the bottom of its owner's library.
47. Reito Sentinel (EDHREC 15304) - {3}: Put target card from a graveyard on the bottom of its owner's library.
48. Jade-Cast Sentinel (EDHREC 18125) - {2}, {T}: Put target card from a graveyard on the bottom of its owner's library.
49. Malevolent Chandelier (EDHREC 18404) - {2}: Put target card from a graveyard on the bottom of its owner's library.
50. Dutiful Knowledge Seeker (EDHREC 19401) - {3}: Put target card from a graveyard on the bottom of its owner's library.
51. Phyrexian Archivist (EDHREC 21684) - {2}, {T}: Put target card from a graveyard on the bottom of its owner's library.
52. Cogwork Archivist (EDHREC 22883) - {2}, {T}: Put target card from a graveyard on the bottom of its owner's library.
53. Nantuko Tracer (EDHREC 25616) - When this creature enters, you may put target card from a graveyard on the bottom of its owner's library.
54. Keeper of the Cadence (EDHREC 26283) - {3}: Put target artifact, instant, or sorcery card from a graveyard on the bottom of its owner's library.
55. Grazing Kelpie (EDHREC 26733) - {G/U}, Sacrifice this creature: Put target card from a graveyard on the bottom of its owner's library.
### Exact-Target Graveyard Exile

56. Deathrite Shaman (EDHREC 583) - {T}: Exile target land card from a graveyard.
57. Return to Nature (EDHREC 657) - • Exile target card from a graveyard.
58. Soul-Guide Lantern (EDHREC 1359) - When this artifact enters, exile target card from a graveyard.
59. Agatha's Soul Cauldron (EDHREC 1376) - {T}: Exile target card from a graveyard.
60. Scavenging Ooze (EDHREC 1420) - {G}: Exile target card from a graveyard.
61. Lion Sash (EDHREC 1586) - {W}: Exile target card from a graveyard.
62. The Scarab God (EDHREC 1699) - {2}{U}{B}: Exile target creature card from a graveyard.
63. Cemetery Reaper (EDHREC 2029) - {2}{B}, {T}: Exile target creature card from a graveyard.
64. Hazel's Brewmaster (EDHREC 2413) - Whenever this creature enters or attacks, exile up to one target card from a graveyard and create a Food token.
65. Restless Cottage (EDHREC 2947) - Whenever this land attacks, create a Food token and exile up to one target card from a graveyard.
66. Heritage Reclamation (EDHREC 3055) - • Exile up to one target card from a graveyard.
67. General's Enforcer (EDHREC 3138) - {2}{W}{B}: Exile target card from a graveyard.
68. Abyssal Harvester (EDHREC 3214) - {T}: Exile target creature card from a graveyard that was put there this turn.
69. Mnemonic Deluge (EDHREC 3926) - Exile target instant or sorcery card from a graveyard.
70. Ghost Vacuum (EDHREC 4025) - {T}: Exile target card from a graveyard.
71. Armored Scrapgorger (EDHREC 4237) - Whenever this creature becomes tapped, exile target card from a graveyard and put an oil counter on this creature.
72. Ardyn, the Usurper (EDHREC 4631) - Starscourge — At the beginning of combat on your turn, exile up to one target creature card from a graveyard.
73. Klothys, God of Destiny (EDHREC 4818) - At the beginning of your first main phase, exile target card from a graveyard.
74. Verdant Command (EDHREC 5405) - • Exile target card from a graveyard.
75. Emperor of Bones (EDHREC 5464) - At the beginning of combat on your turn, exile up to one target card from a graveyard.
76. Intrepid Paleontologist (EDHREC 5509) - {2}: Exile target card from a graveyard.
77. Dino DNA (EDHREC 5968) - Imprint — {1}, {T}: Exile target creature card from a graveyard.
78. Dawnbringer Cleric (EDHREC 6205) - • Gentle Repose — Exile target card from a graveyard.
79. Mastermind Plum (EDHREC 6312) - Whenever Mastermind Plum attacks, exile up to one target card from a graveyard.
80. Immersturm Predator (EDHREC 6622) - Whenever this creature becomes tapped, exile up to one target card from a graveyard and put a +1/+1 counter on this creature.
81. Cremate (EDHREC 7035) - Exile target card from a graveyard.
82. Myr Welder (EDHREC 7320) - Imprint — {T}: Exile target artifact card from a graveyard.
83. Honored Heirloom (EDHREC 7818) - {2}, {T}: Exile target card from a graveyard.
84. Cling to Dust (EDHREC 7834) - Exile target card from a graveyard.
85. The Animus (EDHREC 8012) - At the beginning of your end step, exile up to one target legendary creature card from a graveyard with a memory counter on it.
86. Scrabbling Claws (EDHREC 8140) - {1}, Sacrifice this artifact: Exile target card from a graveyard.
87. Wizard's Spellbook (EDHREC 8545) - {T}: Exile target instant or sorcery card from a graveyard.
88. Dawnhand Dissident (EDHREC 8765) - {T}, Blight 2: Exile target card from a graveyard.
89. Withered Wretch (EDHREC 9269) - {1}: Exile target card from a graveyard.
90. Pharika, God of Affliction (EDHREC 9275) - {B}{G}: Exile target creature card from a graveyard.
91. Psionic Ritual (EDHREC 9352) - Exile target instant or sorcery card from a graveyard and copy it.
92. Necrogenesis (EDHREC 9462) - {2}: Exile target creature card from a graveyard.
93. The Ooze (EDHREC 9652) - {T}: Exile target card from a graveyard.
94. Keen-Eyed Curator (EDHREC 9696) - {1}: Exile target card from a graveyard.
95. Summoner's Sending (EDHREC 10378) - At the beginning of your end step, you may exile target creature card from a graveyard.
96. Misfortune Teller (EDHREC 10645) - Whenever this creature enters or deals combat damage to a player, exile target card from a graveyard.
97. Selesnya Eulogist (EDHREC 11033) - {2}{G}: Exile target creature card from a graveyard, then populate.
98. Deathgorge Scavenger (EDHREC 11084) - Whenever this creature enters or attacks, you may exile target card from a graveyard.
99. Ignis Scientia (EDHREC 11243) - — {1}{G}{U}, {T}: Exile target card from a graveyard.
100. Lantern of the Lost (EDHREC 11569) - When this artifact enters, exile target card from a graveyard.
101. Urborg Scavengers (EDHREC 11787) - Whenever this creature enters or attacks, exile target card from a graveyard.
102. Heap Doll (EDHREC 11976) - Sacrifice this creature: Exile target card from a graveyard.
103. Dimir Doppelganger (EDHREC 12210) - {1}{U}{B}: Exile target creature card from a graveyard.
104. Raven Eagle (EDHREC 12266) - Whenever this creature enters or attacks, exile up to one target card from a graveyard.
105. Stonecloaker (EDHREC 12700) - When this creature enters, exile target card from a graveyard.
106. Venom, Deadly Devourer (EDHREC 12954) - {3}: Exile target creature card from a graveyard.
107. Lazav, Wearer of Faces (EDHREC 13003) - Whenever Lazav attacks, exile target card from a graveyard, then investigate.
108. Rotten Reunion (EDHREC 13361) - Exile up to one target card from a graveyard.
109. Boiling Rock Rioter (EDHREC 13752) - Tap an untapped Ally you control: Exile target card from a graveyard.
110. Lara Croft, Tomb Raider (EDHREC 13786) - Whenever Lara Croft attacks, exile up to one target legendary artifact card or legendary land card from a graveyard and put a discovery counter on it.
111. Magic Pot (EDHREC 14838) - {2}, {T}: Exile target card from a graveyard.
112. Break Ties (EDHREC 15060) - • Exile target card from a graveyard.
113. Cleanup Crew (EDHREC 15172) - • Exile target card from a graveyard.
114. Jack-o'-Lantern (EDHREC 15226) - {1}, {T}, Sacrifice this artifact: Exile up to one target card from a graveyard.
115. Mechanical Mobster (EDHREC 15617) - When this creature enters, exile up to one target card from a graveyard.
116. Mardu Woe-Reaper (EDHREC 16152) - Whenever this creature or another Warrior you control enters, you may exile target creature card from a graveyard.
117. Ambush Wolf (EDHREC 16493) - When this creature enters, exile up to one target card from a graveyard.
118. Crossroads Candleguide (EDHREC 16624) - When this creature enters, exile up to one target card from a graveyard.
119. Wreck Remover (EDHREC 16705) - Whenever this creature enters or attacks, exile up to one target card from a graveyard.
120. Phyrexian Furnace (EDHREC 16796) - {1}, Sacrifice this artifact: Exile target card from a graveyard.
121. Vile Rebirth (EDHREC 16937) - Exile target creature card from a graveyard.
122. Blood Operative (EDHREC 17037) - When this creature enters, you may exile target card from a graveyard.
123. Veteran Survivor (EDHREC 17548) - Survival — At the beginning of your second main phase, if this creature is tapped, exile up to one target card from a graveyard.
124. Sungold Sentinel (EDHREC 17695) - Whenever this creature enters or attacks, exile up to one target card from a graveyard.
125. Shamble Back (EDHREC 17917) - Exile target creature card from a graveyard.
126. Beckon Apparition (EDHREC 18063) - Exile target card from a graveyard.
127. Offalsnout (EDHREC 18944) - When this creature leaves the battlefield, exile target card from a graveyard.
128. Diregraf Scavenger (EDHREC 19058) - When this creature enters, exile up to one target card from a graveyard.
129. Corpse Appraiser (EDHREC 19139) - When this creature enters, exile up to one target creature card from a graveyard.
130. Ashnod's Harvester (EDHREC 19270) - Whenever this creature attacks, exile target card from a graveyard.
131. Sequence Engine (EDHREC 19329) - {X}, {T}: Exile target creature card with mana value X from a graveyard.
132. The Spot, Living Portal (EDHREC 19474) - When The Spot enters, exile up to one target nonland permanent and up to one target nonland permanent card from a graveyard.
133. Crook of Condemnation (EDHREC 19961) - {1}, {T}: Exile target card from a graveyard.
134. Territorial Kavu (EDHREC 20203) - • Exile up to one target card from a graveyard.
135. Morbid Bloom (EDHREC 20372) - Exile target creature card from a graveyard, then create X 1/1 green Saproling creature tokens, where X is the exiled card's toughness.
136. Purify the Grave (EDHREC 20414) - Exile target card from a graveyard.
137. Gravestone Strider (EDHREC 20959) - {2}, Exile this card from your graveyard: Exile target card from a graveyard.
138. Apostle of Purifying Light (EDHREC 21748) - {2}: Exile target card from a graveyard.
139. Coffin Purge (EDHREC 21812) - Exile target card from a graveyard.
140. Conversion Chamber (EDHREC 22409) - {2}, {T}: Exile target artifact card from a graveyard.
141. Rotfeaster Maggot (EDHREC 22918) - When this creature enters, exile target creature card from a graveyard.
142. Fade from Memory (EDHREC 23170) - Exile target card from a graveyard.
143. Boneclad Necromancer (EDHREC 23515) - When this creature enters, you may exile target creature card from a graveyard.
144. Crypt Creeper (EDHREC 24608) - Sacrifice this creature: Exile target card from a graveyard.
145. Mourner's Shield (EDHREC 25695) - Imprint — When this artifact enters, you may exile target card from a graveyard.
146. Shadowfeed (EDHREC 25696) - Exile target card from a graveyard.
147. Soul-Guide Gryff (EDHREC 25724) - When this creature enters, exile up to one target card from a graveyard.
148. Carrion Imp (EDHREC 26082) - When this creature enters, you may exile target creature card from a graveyard.
149. Mirror Golem (EDHREC 26468) - Imprint — When this creature enters, you may exile target card from a graveyard.
150. Thraben Heretic (EDHREC 26815) - {T}: Exile target creature card from a graveyard.
151. Funeral Pyre (EDHREC 26894) - Exile target card from a graveyard.
152. Rise of Extus (EDHREC 27745) - Exile up to one target instant or sorcery card from a graveyard.
153. Headstone (EDHREC 27826) - Exile target card from a graveyard.
154. Mortiphobia (EDHREC 28441) - {1}{B}, Discard a card: Exile target card from a graveyard.
155. Grixis Sojourners (EDHREC 28799) - When you cycle this card and when this creature dies, you may exile target card from a graveyard.
156. Creakwood Ghoul (EDHREC 28972) - {B/G}{B/G}: Exile target card from a graveyard.
157. Sewerdreg (EDHREC 29567) - Sacrifice this creature: Exile target card from a graveyard.
158. Grave Robbers (EDHREC 29995) - {B}, {T}: Exile target artifact card from a graveyard.
159. Moratorium Stone (EDHREC 30352) - {2}, {T}: Exile target card from a graveyard.
160. Steamclaw (EDHREC 30442) - {3}, {T}: Exile target card from a graveyard.
161. Selfless Exorcist (EDHREC 30452) - {T}: Exile target creature card from a graveyard.
162. Color Pie (unranked) - Exile up to one target card from a graveyard.
163. The Many Deeds of Belzenlok (unranked) - I — Exile up to one target Saga card from a graveyard.
164. Trained Blessed Mind (unranked) - {TK}{TK} — {T}: Exile target card from a graveyard.
### Your Graveyard To Hand

165. Eternal Witness (EDHREC 99) - When this creature enters, you may return target card from your graveyard to your hand.
166. Buried Ruin (EDHREC 194) - {2}, {T}, Sacrifice this land: Return target artifact card from your graveyard to your hand.
167. Phyrexian Reclamation (EDHREC 912) - {1}{B}, Pay 2 life: Return target creature card from your graveyard to your hand.
168. Archaeomancer (EDHREC 940) - When this creature enters, return target instant or sorcery card from your graveyard to your hand.
169. Evolution Witness (EDHREC 969) - Whenever one or more +1/+1 counters are put on this creature, return target permanent card from your graveyard to your hand.
170. Haven of the Spirit Dragon (EDHREC 1136) - {2}, {T}, Sacrifice this land: Return target Dragon creature card or Ugin planeswalker card from your graveyard to your hand.
171. Timeless Witness (EDHREC 1210) - When this creature enters, return target card from your graveyard to your hand.
172. Regrowth (EDHREC 1312) - Return target card from your graveyard to your hand.
173. Unnatural Restoration (EDHREC 1366) - Return target permanent card from your graveyard to your hand.
174. Honest Rutstein (EDHREC 1558) - When Honest Rutstein enters, return target creature card from your graveyard to your hand.
175. Tortured Existence (EDHREC 1567) - {B}, Discard a creature card: Return target creature card from your graveyard to your hand.
176. Oversold Cemetery (EDHREC 1588) - At the beginning of your upkeep, if you have four or more creature cards in your graveyard, you may return target creature card from your graveyard to your hand.
177. Nyx Weaver (EDHREC 1631) - {1}{B}{G}, Exile this creature: Return target card from your graveyard to your hand.
178. Stitch Together (EDHREC 1746) - Return target creature card from your graveyard to your hand.
179. Emeria Shepherd (EDHREC 1958) - Landfall — Whenever a land you control enters, you may return target nonland permanent card from your graveyard to your hand.
180. Trading Post (EDHREC 2028) - {1}, {T}, Sacrifice a creature: Return target artifact card from your graveyard to your hand.
181. Sword of Light and Shadow (EDHREC 2147) - Whenever equipped creature deals combat damage to a player, you gain 3 life and you may return up to one target creature card from your graveyard to your hand.
182. Abstergo Entertainment (EDHREC 2200) - {3}, {T}, Exile Abstergo Entertainment: Return up to one target historic card from your graveyard to your hand, then exile all graveyards.
183. Samwise Gamgee (EDHREC 2289) - Sacrifice three Foods: Return target historic card from your graveyard to your hand.
184. Codex Shredder (EDHREC 2324) - {5}, {T}, Sacrifice this artifact: Return target card from your graveyard to your hand.
185. Peerless Recycling (EDHREC 2799) - Return target permanent card from your graveyard to your hand.
186. Mudflat Village (EDHREC 2821) - {1}{B}, {T}, Sacrifice this land: Return target Bat, Lizard, Rat, or Squirrel card from your graveyard to your hand.
187. Spawnbed Protector (EDHREC 2825) - At the beginning of your end step, return up to one target Eldrazi creature card from your graveyard to your hand.
188. Revive the Shire (EDHREC 2855) - Return target permanent card from your graveyard to your hand.
189. Graveshifter (EDHREC 2899) - When this creature enters, you may return target creature card from your graveyard to your hand.
190. Memorial to Folly (EDHREC 2914) - {2}{B}, {T}, Sacrifice this land: Return target creature card from your graveyard to your hand.
191. Witch of the Moors (EDHREC 2954) - At the beginning of your end step, if you gained life this turn, each opponent sacrifices a creature of their choice and you return up to one target creature card from your graveyard to your hand.
192. Tezzeret, Master of the Bridge (EDHREC 3069) - −3: Return target artifact card from your graveyard to your hand.
193. Skullwinder (EDHREC 3236) - When this creature enters, return target card from your graveyard to your hand, then choose an opponent.
194. Golgari Thug (EDHREC 3246) - When this creature dies, put target creature card from your graveyard on top of your library. Dredge 4 (If you would draw a card, you may mill four cards instead. If you do, return this card from your graveyard to you...
195. Kolaghan's Command (EDHREC 3361) - • Return target creature card from your graveyard to your hand.
196. Lord of the Undead (EDHREC 3376) - {1}{B}, {T}: Return target Zombie card from your graveyard to your hand.
197. Trailtracker Scout (EDHREC 3433) - Whenever you expend 8, return up to one target permanent card from your graveyard to your hand.
198. Cid, Freeflier Pilot (EDHREC 3513) - {2}, {T}: Return target Equipment or Vehicle card from your graveyard to your hand.
199. Court of Ardenvale (EDHREC 3533) - At the beginning of your upkeep, return target permanent card with mana value 3 or less from your graveyard to your hand.
200. Colossal Skyturtle (EDHREC 3597) - Channel — {2}{G}, Discard this card: Return target card from your graveyard to your hand.

## Notes

- Regenerate this file with `node tools/build-next-automation-queue.js --count 200` whenever the corpus or family priorities change.
- If product scope widens beyond graveyard-heavy seams, add new family configs rather than manually editing the queue body.
- For cards with quoted granted text, queue the grant and the granted effect separately instead of collapsing them into the host effect line.

