# Oracle Automation Next 200

Generated: `2026-04-22T08:54:02.008Z`
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
| Exact-Target Graveyard To Library | Near-Term Graveyard Move-Zone | 16 | 16 | Covers top/bottom placement variants that reuse current exact-target graveyard selectors. |
| Exact-Target Graveyard Exile | Near-Term Graveyard Move-Zone | 110 | 115 | Large real-card family that benefits from variant locks and remaining qualifier coverage. |
| Your Graveyard To Hand | Near-Term Graveyard Move-Zone | 34 | 341 | High-volume self-recursion family; good for tightening direct target binding and context-driven return paths. |
| Dies Triggers Returning The Card To Battlefield | Contextual Graveyard Recursion | 0 | 41 | Needs stronger antecedent binding from the dying object into the follow-up move-zone action. |
| Dies Triggers Returning The Card To Hand | Contextual Graveyard Recursion | 0 | 22 | Similar contextual binding seam, but with hand destination instead of battlefield. |
| Pay-To-Return Deathmantle-Style Recursion | Contextual Graveyard Recursion | 0 | 3 | Includes Nim Deathmantle-style payment + return + attachment bundles. |
| Entered Or Cast From Graveyard Checks | Graveyard Context / Conditional | 0 | 7 | Good follow-up once provenance is threaded more broadly across server and rules-engine paths. |
| Leave-Battlefield Exile Replacement Riders | Graveyard Context / Conditional | 0 | 4 | Important support glue for temporary recursion families such as unearth and similar reanimation effects. |
| Cast From Graveyard Permission Windows | Graveyard Permission / Replacement | 0 | 403 | Useful for later test runs because these create lots of visible automation gaps when not modeled cleanly. |
| Play From Graveyard Permission Windows | Graveyard Permission / Replacement | 0 | 27 | Covers lands and mixed play-permission text from graveyard. |
| Flashback Cards | Graveyard Permission / Replacement | 0 | 230 | Stable, populous graveyard-casting family to validate once permission windows and replacement text are tightened. |
| Unearth Cards | Graveyard Permission / Replacement | 0 | 60 | Pairs graveyard reanimation with the leave-battlefield exile replacement rider. |
| Escape And Similar Graveyard Alternate Costs | Graveyard Permission / Replacement | 0 | 108 | Includes escape-style casting/replay from graveyard with additional costs or modifiers. |
| Token Creation | High-Population Follow-On Seams | 0 | 3299 | Large practical seam spanning straightforward token creation, tapped/token modifier variants, and delayed cleanup follow-ups. |
| Direct Damage And Damage-Based Follow-Ups | High-Population Follow-On Seams | 0 | 2572 | Covers direct damage sentences, symmetric sweepers, and that-much/excess-damage follow-up families. |
| Draw And Draw-Scaling Effects | High-Population Follow-On Seams | 0 | 3668 | Dense seam for raw draw, target draw, each-player draw, and draw-scaling follow-up text. |
| Sacrifice And Sacrifice Follow-Up Effects | High-Population Follow-On Seams | 0 | 3690 | Useful after the graveyard slice because it overlaps strongly with death/reanimation bookkeeping and delayed cleanup. |
| +1/+1 Counter Placement And Counter Scaling | High-Population Follow-On Seams | 0 | 3786 | Large seam with lots of deterministic counter placement, ETB modifiers, and count-based follow-up clauses. |
| Life Gain And Life Loss | High-Population Follow-On Seams | 0 | 2383 | Dense practical seam for gain/lose life, target-player life swings, and equal-to/reference clauses. |
| Targeted Destroy Effects | High-Population Follow-On Seams | 0 | 1173 | Broad removal seam that tends to be straightforward once target binding and rider text are preserved. |
| Library Search And Tutor Effects | High-Population Follow-On Seams | 0 | 1011 | Large queue for search workflows, especially once resolution-queue driven player choice paths are tightened further. |
| Bounce And Return-To-Hand Effects | High-Population Follow-On Seams | 0 | 722 | Captures both battlefield bounce and zone-return effects that tend to be good deterministic automation candidates. |
| Discard Effects | High-Population Follow-On Seams | 0 | 2028 | Useful for queueing both deterministic discard counts and player-choice discard families for later resolution support. |
| Scry / Surveil / Topdeck Manipulation | High-Population Follow-On Seams | 0 | 1019 | Good post-graveyard seam because it is common, visible in tests, and already has some queue-backed infrastructure on the server side. |
| Tap / Untap Effects | High-Population Follow-On Seams | 0 | 615 | Broad tactical seam with many deterministic single-target and each-target templates. |
| Counterspell And Stack Interaction | High-Population Follow-On Seams | 0 | 294 | Queue for explicit spell/ability countering and related stack-target clauses. |
| Mill Effects | High-Population Follow-On Seams | 0 | 516 | Smaller but clean seam for library-to-graveyard movement and count scaling. |
| Impulse Exile Permission Windows | High-Population Follow-On Seams | 0 | 267 | Natural next seam after graveyard and cast-from-zone work; high visibility in actual gameplay and already partially automated. |
| Fight And Bite-Style Combat Resolution | High-Population Follow-On Seams | 0 | 127 | Smaller seam, but useful for concrete combat-automation expansion after damage families are mined. |
| Goad And Attack-Pressure Effects | High-Population Follow-On Seams | 0 | 152 | Included as a modest spillover seam once higher-volume deterministic text families are exhausted. |

## Ordered Queue

### Dynamic Graveyard Mana-Value Reanimation

1. Narset, Enlightened Exile (EDHREC 5028) - Whenever Narset attacks, exile target noncreature, nonland card with mana value less than Narset's power from a graveyard and copy it.
### Counter-Bearing Graveyard Reanimation

2. From the Catacombs (EDHREC 7804) - Put target creature card from a graveyard onto the battlefield under your control with a corpse counter on it.
3. Coalstoke Gearhulk (EDHREC 8802) - When this creature enters, put target creature card with mana value 4 or less from a graveyard onto the battlefield under your control with a finality counter on it.
4. Necromantic Summons (EDHREC 17829) - Put target creature card from a graveyard onto the battlefield under your control. Spell mastery — If there are two or more instant and/or sorcery cards in your graveyard, that creature enters with two additional +1/+...
### Exact-Target Reanimation Under Your Control

5. Reanimate (EDHREC 57) - Put target creature card from a graveyard onto the battlefield under your control.
6. Necromancy (EDHREC 950) - When this enchantment enters, if it's on the battlefield, it becomes an Aura with "enchant creature put onto the battlefield with Necromancy." Put target creature card from a graveyard onto the battlefield under your control and attach this enchantment to it.
7. Portal to Phyrexia (EDHREC 1082) - At the beginning of your upkeep, put target creature card from a graveyard onto the battlefield under your control.
8. Junji, the Midnight Sky (EDHREC 1188) - • Put target non-Dragon creature card from a graveyard onto the battlefield under your control.
9. The Eldest Reborn (EDHREC 1815) - III — Put target creature or planeswalker card from a graveyard onto the battlefield under your control.
10. The Cruelty of Gix (EDHREC 3809) - III — Put target creature card from a graveyard onto the battlefield under your control.
11. Beacon of Unrest (EDHREC 4189) - Put target artifact or creature card from a graveyard onto the battlefield under your control.
12. Vat Emergence (EDHREC 4679) - Put target creature card from a graveyard onto the battlefield under your control.
13. Chainer, Dementia Master (EDHREC 5097) - {B}{B}{B}, Pay 3 life: Put target creature card from a graveyard onto the battlefield under your control.
14. Liliana, Waker of the Dead (EDHREC 5527) - −7: You get an emblem with "At the beginning of combat on your turn, put target creature card from a graveyard onto the battlefield under your control.
15. Staff of Eden, Vault's Key (EDHREC 5625) - When Staff of Eden enters, put target legendary permanent card not named Staff of Eden, Vault's Key from a graveyard onto the battlefield under your control.
16. Too Greedily, Too Deep (EDHREC 7109) - Put target creature card from a graveyard onto the battlefield under your control.
17. Debtors' Knell (EDHREC 7291) - At the beginning of your upkeep, put target creature card from a graveyard onto the battlefield under your control.
18. Gravespawn Sovereign (EDHREC 7356) - Tap five untapped Zombies you control: Put target creature card from a graveyard onto the battlefield under your control.
19. Teneb, the Harvester (EDHREC 7732) - If you do, put target creature card from a graveyard onto the battlefield under your control.
20. Demon of Dark Schemes (EDHREC 8392) - {2}{B}, Pay {E}{E}{E}{E}: Put target creature card from a graveyard onto the battlefield under your control tapped.
21. Quest for the Necropolis (EDHREC 9267) - {5}{B}, Sacrifice this enchantment: Put target creature card from a graveyard onto the battlefield under your control.
22. Fated Return (EDHREC 10373) - Put target creature card from a graveyard onto the battlefield under your control.
23. Rise from the Grave (EDHREC 10405) - Put target creature card from a graveyard onto the battlefield under your control.
24. Ashiok, Sculptor of Fears (EDHREC 11292) - −5: Put target creature card from a graveyard onto the battlefield under your control.
25. Nomad Mythmaker (EDHREC 12621) - {W}, {T}: Put target Aura card from a graveyard onto the battlefield under your control attached to a creature you control.
26. Waking the Trolls (EDHREC 13523) - II — Put target land card from a graveyard onto the battlefield under your control.
27. Grave Upheaval (EDHREC 13981) - Put target creature card from a graveyard onto the battlefield under your control.
28. Endless Obedience (EDHREC 14115) - Put target creature card from a graveyard onto the battlefield under your control.
29. Restore (EDHREC 14786) - Put target land card from a graveyard onto the battlefield under your control.
30. Iridescent Drake (EDHREC 24414) - When this creature enters, put target Aura card from a graveyard onto the battlefield under your control attached to this creature.
### Exact-Target Reanimation Under Owner Control

31. Kenrith, the Returned King (EDHREC 2976) - {4}{B}: Put target creature card from a graveyard onto the battlefield under its owner's control.
### Exact-Target Graveyard To Hand

32. Naya Charm (EDHREC 2892) - • Return target card from a graveyard to its owner's hand.
33. Grave Scrabbler (EDHREC 9979) - When this creature enters, if its madness cost was paid, you may return target creature card from a graveyard to its owner's hand.
34. Pulse of Murasa (EDHREC 10239) - Return target creature or land card from a graveyard to its owner's hand.
35. Revive the Fallen (EDHREC 12063) - Return target creature card from a graveyard to its owner's hand.
36. Mine Excavation (EDHREC 19804) - Return target artifact or enchantment card from a graveyard to its owner's hand.
37. Endbringer's Revel (EDHREC 22788) - {4}: Return target creature card from a graveyard to its owner's hand.
38. Vampire Charmseeker (EDHREC 24064) - When this creature enters, return target instant, sorcery, or creature card from a graveyard to its owner's hand.
39. Disturbing Plot (EDHREC 24126) - Return target creature card from a graveyard to its owner's hand.
40. Another Night in Vegas (unranked) - — Return target creature card from a graveyard to its owner's hand.
### Exact-Target Graveyard To Library

41. Noxious Revival (EDHREC 608) - Put target card from a graveyard on top of its owner's library.
42. Chrome Companion (EDHREC 11285) - {2}, {T}: Put target card from a graveyard on the bottom of its owner's library.
43. Junktroller (EDHREC 11635) - {T}: Put target card from a graveyard on the bottom of its owner's library.
44. Vessel of Endless Rest (EDHREC 13000) - When this artifact enters, put target card from a graveyard on the bottom of its owner's library.
45. Hoverstone Pilgrim (EDHREC 14328) - {2}: Put target card from a graveyard on the bottom of its owner's library.
46. Reito Lantern (EDHREC 14702) - {3}: Put target card from a graveyard on the bottom of its owner's library.
47. Reito Sentinel (EDHREC 15417) - {3}: Put target card from a graveyard on the bottom of its owner's library.
48. Jade-Cast Sentinel (EDHREC 17985) - {2}, {T}: Put target card from a graveyard on the bottom of its owner's library.
49. Malevolent Chandelier (EDHREC 18505) - {2}: Put target card from a graveyard on the bottom of its owner's library.
50. Dutiful Knowledge Seeker (EDHREC 19155) - {3}: Put target card from a graveyard on the bottom of its owner's library.
51. Phyrexian Archivist (EDHREC 21867) - {2}, {T}: Put target card from a graveyard on the bottom of its owner's library.
52. Cogwork Archivist (EDHREC 22975) - {2}, {T}: Put target card from a graveyard on the bottom of its owner's library.
53. Nantuko Tracer (EDHREC 25849) - When this creature enters, you may put target card from a graveyard on the bottom of its owner's library.
54. Keeper of the Cadence (EDHREC 26603) - {3}: Put target artifact, instant, or sorcery card from a graveyard on the bottom of its owner's library.
55. Grazing Kelpie (EDHREC 26925) - {G/U}, Sacrifice this creature: Put target card from a graveyard on the bottom of its owner's library.
56. Sundering Archaic (EDHREC 29915) - {2}: Put target card from a graveyard on the bottom of its owner's library.
### Exact-Target Graveyard Exile

57. Deathrite Shaman (EDHREC 584) - {T}: Exile target land card from a graveyard.
58. Return to Nature (EDHREC 673) - • Exile target card from a graveyard.
59. Soul-Guide Lantern (EDHREC 1358) - When this artifact enters, exile target card from a graveyard.
60. Agatha's Soul Cauldron (EDHREC 1382) - {T}: Exile target card from a graveyard.
61. Scavenging Ooze (EDHREC 1460) - {G}: Exile target card from a graveyard.
62. Lion Sash (EDHREC 1622) - {W}: Exile target card from a graveyard.
63. The Scarab God (EDHREC 1697) - {2}{U}{B}: Exile target creature card from a graveyard.
64. Cemetery Reaper (EDHREC 2063) - {2}{B}, {T}: Exile target creature card from a graveyard.
65. Hazel's Brewmaster (EDHREC 2385) - Whenever this creature enters or attacks, exile up to one target card from a graveyard and create a Food token.
66. Heritage Reclamation (EDHREC 2966) - • Exile up to one target card from a graveyard.
67. Restless Cottage (EDHREC 2990) - Whenever this land attacks, create a Food token and exile up to one target card from a graveyard.
68. Abyssal Harvester (EDHREC 3188) - {T}: Exile target creature card from a graveyard that was put there this turn.
69. General's Enforcer (EDHREC 3193) - {2}{W}{B}: Exile target card from a graveyard.
70. Ghost Vacuum (EDHREC 3892) - {T}: Exile target card from a graveyard.
71. Mnemonic Deluge (EDHREC 3895) - Exile target instant or sorcery card from a graveyard.
72. Armored Scrapgorger (EDHREC 4294) - Whenever this creature becomes tapped, exile target card from a graveyard and put an oil counter on this creature.
73. Ardyn, the Usurper (EDHREC 4360) - Starscourge — At the beginning of combat on your turn, exile up to one target creature card from a graveyard.
74. Klothys, God of Destiny (EDHREC 4868) - At the beginning of your first main phase, exile target card from a graveyard.
75. Emperor of Bones (EDHREC 5395) - At the beginning of combat on your turn, exile up to one target card from a graveyard.
76. Verdant Command (EDHREC 5414) - • Exile target card from a graveyard.
77. Intrepid Paleontologist (EDHREC 5585) - {2}: Exile target card from a graveyard.
78. Dino DNA (EDHREC 6023) - Imprint — {1}, {T}: Exile target creature card from a graveyard.
79. Dawnbringer Cleric (EDHREC 6271) - • Gentle Repose — Exile target card from a graveyard.
80. Mastermind Plum (EDHREC 6437) - Whenever Mastermind Plum attacks, exile up to one target card from a graveyard.
81. Immersturm Predator (EDHREC 6701) - Whenever this creature becomes tapped, exile up to one target card from a graveyard and put a +1/+1 counter on this creature.
82. Cremate (EDHREC 7059) - Exile target card from a graveyard.
83. The Ooze (EDHREC 7312) - {T}: Exile target card from a graveyard.
84. Myr Welder (EDHREC 7334) - Imprint — {T}: Exile target artifact card from a graveyard.
85. Cling to Dust (EDHREC 7882) - Exile target card from a graveyard.
86. Honored Heirloom (EDHREC 7910) - {2}, {T}: Exile target card from a graveyard.
87. The Animus (EDHREC 8036) - At the beginning of your end step, exile up to one target legendary creature card from a graveyard with a memory counter on it.
88. Dawnhand Dissident (EDHREC 8154) - {T}, Blight 2: Exile target card from a graveyard.
89. Scrabbling Claws (EDHREC 8167) - {1}, Sacrifice this artifact: Exile target card from a graveyard.
90. Wizard's Spellbook (EDHREC 8635) - {T}: Exile target instant or sorcery card from a graveyard.
91. Pharika, God of Affliction (EDHREC 9337) - {B}{G}: Exile target creature card from a graveyard.
92. Withered Wretch (EDHREC 9363) - {1}: Exile target card from a graveyard.
93. Psionic Ritual (EDHREC 9440) - Exile target instant or sorcery card from a graveyard and copy it.
94. Necrogenesis (EDHREC 9543) - {2}: Exile target creature card from a graveyard.
95. Keen-Eyed Curator (EDHREC 9634) - {1}: Exile target card from a graveyard.
96. Summoner's Sending (EDHREC 10030) - At the beginning of your end step, you may exile target creature card from a graveyard.
97. Misfortune Teller (EDHREC 10882) - Whenever this creature enters or deals combat damage to a player, exile target card from a graveyard.
98. Ignis Scientia (EDHREC 11085) - — {1}{G}{U}, {T}: Exile target card from a graveyard.
99. Selesnya Eulogist (EDHREC 11209) - {2}{G}: Exile target creature card from a graveyard, then populate.
100. Deathgorge Scavenger (EDHREC 11214) - Whenever this creature enters or attacks, you may exile target card from a graveyard.
101. Lantern of the Lost (EDHREC 11619) - When this artifact enters, exile target card from a graveyard.
102. Raven Eagle (EDHREC 11844) - Whenever this creature enters or attacks, exile up to one target card from a graveyard.
103. Urborg Scavengers (EDHREC 11864) - Whenever this creature enters or attacks, exile target card from a graveyard.
104. Heap Doll (EDHREC 12068) - Sacrifice this creature: Exile target card from a graveyard.
105. Dimir Doppelganger (EDHREC 12299) - {1}{U}{B}: Exile target creature card from a graveyard.
106. Stonecloaker (EDHREC 12784) - When this creature enters, exile target card from a graveyard.
107. Venom, Deadly Devourer (EDHREC 12863) - {3}: Exile target creature card from a graveyard.
108. Lazav, Wearer of Faces (EDHREC 13174) - Whenever Lazav attacks, exile target card from a graveyard, then investigate.
109. Rotten Reunion (EDHREC 13441) - Exile up to one target card from a graveyard.
110. Boiling Rock Rioter (EDHREC 13640) - Tap an untapped Ally you control: Exile target card from a graveyard.
111. Lara Croft, Tomb Raider (EDHREC 13976) - Whenever Lara Croft attacks, exile up to one target legendary artifact card or legendary land card from a graveyard and put a discovery counter on it.
112. Magic Pot (EDHREC 14671) - {2}, {T}: Exile target card from a graveyard.
113. Break Ties (EDHREC 15152) - • Exile target card from a graveyard.
114. Jack-o'-Lantern (EDHREC 15224) - {1}, {T}, Sacrifice this artifact: Exile up to one target card from a graveyard.
115. Cleanup Crew (EDHREC 15254) - • Exile target card from a graveyard.
116. Mechanical Mobster (EDHREC 15550) - When this creature enters, exile up to one target card from a graveyard.
117. Mardu Woe-Reaper (EDHREC 16280) - Whenever this creature or another Warrior you control enters, you may exile target creature card from a graveyard.
118. Ambush Wolf (EDHREC 16518) - When this creature enters, exile up to one target card from a graveyard.
119. Wreck Remover (EDHREC 16660) - Whenever this creature enters or attacks, exile up to one target card from a graveyard.
120. Crossroads Candleguide (EDHREC 16737) - When this creature enters, exile up to one target card from a graveyard.
121. Phyrexian Furnace (EDHREC 16926) - {1}, Sacrifice this artifact: Exile target card from a graveyard.
122. Vile Rebirth (EDHREC 17108) - Exile target creature card from a graveyard.
123. Blood Operative (EDHREC 17209) - When this creature enters, you may exile target card from a graveyard.
124. Veteran Survivor (EDHREC 17646) - Survival — At the beginning of your second main phase, if this creature is tapped, exile up to one target card from a graveyard.
125. Sungold Sentinel (EDHREC 17856) - Whenever this creature enters or attacks, exile up to one target card from a graveyard.
126. Beckon Apparition (EDHREC 17977) - Exile target card from a graveyard.
127. Shamble Back (EDHREC 18012) - Exile target creature card from a graveyard.
128. Feral Appetite (EDHREC 18079) - {1}{G}: Exile target card from a graveyard.
129. Sequence Engine (EDHREC 19027) - {X}, {T}: Exile target creature card with mana value X from a graveyard.
130. Diregraf Scavenger (EDHREC 19082) - When this creature enters, exile up to one target card from a graveyard.
131. Offalsnout (EDHREC 19136) - When this creature leaves the battlefield, exile target card from a graveyard.
132. The Spot, Living Portal (EDHREC 19328) - When The Spot enters, exile up to one target nonland permanent and up to one target nonland permanent card from a graveyard.
133. Corpse Appraiser (EDHREC 19380) - When this creature enters, exile up to one target creature card from a graveyard.
134. Ashnod's Harvester (EDHREC 19511) - Whenever this creature attacks, exile target card from a graveyard.
135. Crook of Condemnation (EDHREC 20066) - {1}, {T}: Exile target card from a graveyard.
136. Purify the Grave (EDHREC 20207) - Exile target card from a graveyard.
137. Morbid Bloom (EDHREC 20292) - Exile target creature card from a graveyard, then create X 1/1 green Saproling creature tokens, where X is the exiled card's toughness.
138. Territorial Kavu (EDHREC 20387) - • Exile up to one target card from a graveyard.
139. Gravestone Strider (EDHREC 21183) - {2}, Exile this card from your graveyard: Exile target card from a graveyard.
140. Apostle of Purifying Light (EDHREC 21882) - {2}: Exile target card from a graveyard.
141. Coffin Purge (EDHREC 21956) - Exile target card from a graveyard.
142. Conversion Chamber (EDHREC 22609) - {2}, {T}: Exile target artifact card from a graveyard.
143. Rotfeaster Maggot (EDHREC 23020) - When this creature enters, exile target creature card from a graveyard.
144. Fade from Memory (EDHREC 23317) - Exile target card from a graveyard.
145. Boneclad Necromancer (EDHREC 23725) - When this creature enters, you may exile target creature card from a graveyard.
146. Crypt Creeper (EDHREC 24693) - Sacrifice this creature: Exile target card from a graveyard.
147. Shadowfeed (EDHREC 25781) - Exile target card from a graveyard.
148. Mourner's Shield (EDHREC 25856) - Imprint — When this artifact enters, you may exile target card from a graveyard.
149. Soul-Guide Gryff (EDHREC 25865) - When this creature enters, exile up to one target card from a graveyard.
150. Carrion Imp (EDHREC 26233) - When this creature enters, you may exile target creature card from a graveyard.
151. Mirror Golem (EDHREC 26747) - Imprint — When this creature enters, you may exile target card from a graveyard.
152. Thraben Heretic (EDHREC 26933) - {T}: Exile target creature card from a graveyard.
153. Funeral Pyre (EDHREC 27118) - Exile target card from a graveyard.
154. Rise of Extus (EDHREC 27938) - Exile up to one target instant or sorcery card from a graveyard.
155. Headstone (EDHREC 28015) - Exile target card from a graveyard.
156. Glorious Decay (EDHREC 28242) - • Exile target card from a graveyard.
157. Mortiphobia (EDHREC 28659) - {1}{B}, Discard a card: Exile target card from a graveyard.
158. Creakwood Ghoul (EDHREC 29073) - {B/G}{B/G}: Exile target card from a graveyard.
159. Grixis Sojourners (EDHREC 29092) - When you cycle this card and when this creature dies, you may exile target card from a graveyard.
160. Sewerdreg (EDHREC 29911) - Sacrifice this creature: Exile target card from a graveyard.
161. Startled Relic Sloth (EDHREC 30071) - At the beginning of combat on your turn, exile up to one target card from a graveyard.
162. Grave Robbers (EDHREC 30272) - {B}, {T}: Exile target artifact card from a graveyard.
163. Ascendant Dustspeaker (EDHREC 30351) - At the beginning of combat on your turn, exile up to one target card from a graveyard.
164. Moratorium Stone (EDHREC 30627) - {2}, {T}: Exile target card from a graveyard.
165. Steamclaw (EDHREC 30761) - {3}, {T}: Exile target card from a graveyard.
166. Selfless Exorcist (EDHREC 30768) - {T}: Exile target creature card from a graveyard.
### Your Graveyard To Hand

167. Eternal Witness (EDHREC 100) - When this creature enters, you may return target card from your graveyard to your hand.
168. Buried Ruin (EDHREC 195) - {2}, {T}, Sacrifice this land: Return target artifact card from your graveyard to your hand.
169. Phyrexian Reclamation (EDHREC 916) - {1}{B}, Pay 2 life: Return target creature card from your graveyard to your hand.
170. Evolution Witness (EDHREC 939) - Whenever one or more +1/+1 counters are put on this creature, return target permanent card from your graveyard to your hand.
171. Archaeomancer (EDHREC 940) - When this creature enters, return target instant or sorcery card from your graveyard to your hand.
172. Haven of the Spirit Dragon (EDHREC 1129) - {2}, {T}, Sacrifice this land: Return target Dragon creature card or Ugin planeswalker card from your graveyard to your hand.
173. Timeless Witness (EDHREC 1218) - When this creature enters, return target card from your graveyard to your hand.
174. Regrowth (EDHREC 1321) - Return target card from your graveyard to your hand.
175. Unnatural Restoration (EDHREC 1379) - Return target permanent card from your graveyard to your hand.
176. Tortured Existence (EDHREC 1563) - {B}, Discard a creature card: Return target creature card from your graveyard to your hand.
177. Honest Rutstein (EDHREC 1565) - When Honest Rutstein enters, return target creature card from your graveyard to your hand.
178. Oversold Cemetery (EDHREC 1609) - At the beginning of your upkeep, if you have four or more creature cards in your graveyard, you may return target creature card from your graveyard to your hand.
179. Nyx Weaver (EDHREC 1631) - {1}{B}{G}, Exile this creature: Return target card from your graveyard to your hand.
180. Stitch Together (EDHREC 1721) - Return target creature card from your graveyard to your hand.
181. Emeria Shepherd (EDHREC 1997) - Landfall — Whenever a land you control enters, you may return target nonland permanent card from your graveyard to your hand.
182. Trading Post (EDHREC 2064) - {1}, {T}, Sacrifice a creature: Return target artifact card from your graveyard to your hand.
183. Sword of Light and Shadow (EDHREC 2156) - Whenever equipped creature deals combat damage to a player, you gain 3 life and you may return up to one target creature card from your graveyard to your hand.
184. Abstergo Entertainment (EDHREC 2157) - {3}, {T}, Exile Abstergo Entertainment: Return up to one target historic card from your graveyard to your hand, then exile all graveyards.
185. Samwise Gamgee (EDHREC 2307) - Sacrifice three Foods: Return target historic card from your graveyard to your hand.
186. Codex Shredder (EDHREC 2336) - {5}, {T}, Sacrifice this artifact: Return target card from your graveyard to your hand.
187. Peerless Recycling (EDHREC 2762) - Return target permanent card from your graveyard to your hand.
188. Mudflat Village (EDHREC 2785) - {1}{B}, {T}, Sacrifice this land: Return target Bat, Lizard, Rat, or Squirrel card from your graveyard to your hand.
189. Spawnbed Protector (EDHREC 2805) - At the beginning of your end step, return up to one target Eldrazi creature card from your graveyard to your hand.
190. Graveshifter (EDHREC 2862) - When this creature enters, you may return target creature card from your graveyard to your hand.
191. Revive the Shire (EDHREC 2870) - Return target permanent card from your graveyard to your hand.
192. Witch of the Moors (EDHREC 2874) - At the beginning of your end step, if you gained life this turn, each opponent sacrifices a creature of their choice and you return up to one target creature card from your graveyard to your hand.
193. Memorial to Folly (EDHREC 2902) - {2}{B}, {T}, Sacrifice this land: Return target creature card from your graveyard to your hand.
194. Tezzeret, Master of the Bridge (EDHREC 3093) - −3: Return target artifact card from your graveyard to your hand.
195. Skullwinder (EDHREC 3286) - When this creature enters, return target card from your graveyard to your hand, then choose an opponent.
196. Golgari Thug (EDHREC 3288) - When this creature dies, put target creature card from your graveyard on top of your library. Dredge 4 (If you would draw a card, you may mill four cards instead. If you do, return this card from your graveyard to you...
197. Cid, Freeflier Pilot (EDHREC 3394) - {2}, {T}: Return target Equipment or Vehicle card from your graveyard to your hand.
198. Trailtracker Scout (EDHREC 3397) - Whenever you expend 8, return up to one target permanent card from your graveyard to your hand.
199. Kolaghan's Command (EDHREC 3398) - • Return target creature card from your graveyard to your hand.
200. Lord of the Undead (EDHREC 3420) - {1}{B}, {T}: Return target Zombie card from your graveyard to your hand.

## Notes

- Regenerate this file with `node tools/build-next-automation-queue.js --count 200` whenever the corpus or family priorities change.
- If product scope widens beyond graveyard-heavy seams, add new family configs rather than manually editing the queue body.
- For cards with quoted granted text, queue the grant and the granted effect separately instead of collapsing them into the host effect line.

