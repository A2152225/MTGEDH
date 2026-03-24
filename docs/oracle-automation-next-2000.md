# Oracle Automation Next 2000

Generated: `2026-03-24T06:09:51.777Z`
Source: `oracle-cards.json`
Scope: black-border paper-card graveyard / recursion / graveyard-casting seams that are likely to move practical automation forward for the next test run.

Queued items: `1089`

## Queue Rules

- Ordered by family priority first, then by EDHREC rank, then by card name.
- Cards are deduped by `oracle_id`, so multi-print duplicates do not crowd out breadth.
- This queue is intentionally graveyard-heavy because the current executor/parser work is already landing there, making the next slices cheaper to implement safely.
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
| Your Graveyard To Hand | Near-Term Graveyard Move-Zone | 80 | 340 | High-volume self-recursion family; good for tightening direct target binding and context-driven return paths. |
| Dies Triggers Returning The Card To Battlefield | Contextual Graveyard Recursion | 40 | 40 | Needs stronger antecedent binding from the dying object into the follow-up move-zone action. |
| Dies Triggers Returning The Card To Hand | Contextual Graveyard Recursion | 21 | 22 | Similar contextual binding seam, but with hand destination instead of battlefield. |
| Pay-To-Return Deathmantle-Style Recursion | Contextual Graveyard Recursion | 3 | 3 | Includes Nim Deathmantle-style payment + return + attachment bundles. |
| Entered Or Cast From Graveyard Checks | Graveyard Context / Conditional | 7 | 7 | Good follow-up once provenance is threaded more broadly across server and rules-engine paths. |
| Leave-Battlefield Exile Replacement Riders | Graveyard Context / Conditional | 4 | 4 | Important support glue for temporary recursion families such as unearth and similar reanimation effects. |
| Cast From Graveyard Permission Windows | Graveyard Permission / Replacement | 35 | 392 | Useful for later test runs because these create lots of visible automation gaps when not modeled cleanly. |
| Play From Graveyard Permission Windows | Graveyard Permission / Replacement | 25 | 27 | Covers lands and mixed play-permission text from graveyard. |
| Flashback Cards | Graveyard Permission / Replacement | 60 | 220 | Stable, populous graveyard-casting family to validate once permission windows and replacement text are tightened. |
| Unearth Cards | Graveyard Permission / Replacement | 40 | 60 | Pairs graveyard reanimation with the leave-battlefield exile replacement rider. |
| Escape And Similar Graveyard Alternate Costs | Graveyard Permission / Replacement | 55 | 108 | Includes escape-style casting/replay from graveyard with additional costs or modifiers. |

## Ordered Queue

### Dynamic Graveyard Mana-Value Reanimation

1. Narset, Enlightened Exile (EDHREC 4933) - Whenever Narset attacks, exile target noncreature, nonland card with mana value less than Narset's power from a graveyard and copy it.
### Counter-Bearing Graveyard Reanimation

2. From the Catacombs (EDHREC 7641) - Put target creature card from a graveyard onto the battlefield under your control with a corpse counter on it.
3. Coalstoke Gearhulk (EDHREC 8979) - When this creature enters, put target creature card with mana value 4 or less from a graveyard onto the battlefield under your control with a finality counter on it.
4. Necromantic Summons (EDHREC 17780) - Put target creature card from a graveyard onto the battlefield under your control. Spell mastery — If there are two or more instant and/or sorcery cards in your graveyard, that creature enters with two additional +1/+...
### Exact-Target Reanimation Under Your Control

5. Reanimate (EDHREC 59) - Put target creature card from a graveyard onto the battlefield under your control.
6. Necromancy (EDHREC 938) - When this enchantment enters, if it's on the battlefield, it becomes an Aura with "enchant creature put onto the battlefield with Necromancy." Put target creature card from a graveyard onto the battlefield under your control and attach this enchantment to it.
7. Portal to Phyrexia (EDHREC 1051) - At the beginning of your upkeep, put target creature card from a graveyard onto the battlefield under your control.
8. Junji, the Midnight Sky (EDHREC 1184) - • Put target non-Dragon creature card from a graveyard onto the battlefield under your control.
9. The Eldest Reborn (EDHREC 1783) - III — Put target creature or planeswalker card from a graveyard onto the battlefield under your control.
10. The Cruelty of Gix (EDHREC 3740) - III — Put target creature card from a graveyard onto the battlefield under your control.
11. Beacon of Unrest (EDHREC 4109) - Put target artifact or creature card from a graveyard onto the battlefield under your control.
12. Vat Emergence (EDHREC 4582) - Put target creature card from a graveyard onto the battlefield under your control.
13. Chainer, Dementia Master (EDHREC 5003) - {B}{B}{B}, Pay 3 life: Put target creature card from a graveyard onto the battlefield under your control.
14. Liliana, Waker of the Dead (EDHREC 5453) - −7: You get an emblem with "At the beginning of combat on your turn, put target creature card from a graveyard onto the battlefield under your control.
15. Staff of Eden, Vault's Key (EDHREC 5740) - When Staff of Eden enters, put target legendary permanent card not named Staff of Eden, Vault's Key from a graveyard onto the battlefield under your control.
16. Too Greedily, Too Deep (EDHREC 7081) - Put target creature card from a graveyard onto the battlefield under your control.
17. Debtors' Knell (EDHREC 7224) - At the beginning of your upkeep, put target creature card from a graveyard onto the battlefield under your control.
18. Gravespawn Sovereign (EDHREC 7227) - Tap five untapped Zombies you control: Put target creature card from a graveyard onto the battlefield under your control.
19. Teneb, the Harvester (EDHREC 7600) - If you do, put target creature card from a graveyard onto the battlefield under your control.
20. Demon of Dark Schemes (EDHREC 8269) - {2}{B}, Pay {E}{E}{E}{E}: Put target creature card from a graveyard onto the battlefield under your control tapped.
21. Quest for the Necropolis (EDHREC 9360) - {5}{B}, Sacrifice this enchantment: Put target creature card from a graveyard onto the battlefield under your control.
22. Fated Return (EDHREC 10306) - Put target creature card from a graveyard onto the battlefield under your control.
23. Rise from the Grave (EDHREC 10337) - Put target creature card from a graveyard onto the battlefield under your control.
24. Ashiok, Sculptor of Fears (EDHREC 11237) - −5: Put target creature card from a graveyard onto the battlefield under your control.
25. Nomad Mythmaker (EDHREC 12471) - {W}, {T}: Put target Aura card from a graveyard onto the battlefield under your control attached to a creature you control.
26. Waking the Trolls (EDHREC 13324) - II — Put target land card from a graveyard onto the battlefield under your control.
27. Grave Upheaval (EDHREC 13875) - Put target creature card from a graveyard onto the battlefield under your control.
28. Endless Obedience (EDHREC 14036) - Put target creature card from a graveyard onto the battlefield under your control.
29. Restore (EDHREC 14582) - Put target land card from a graveyard onto the battlefield under your control.
30. Iridescent Drake (EDHREC 24171) - When this creature enters, put target Aura card from a graveyard onto the battlefield under your control attached to this creature.
### Exact-Target Reanimation Under Owner Control

31. Kenrith, the Returned King (EDHREC 2948) - {4}{B}: Put target creature card from a graveyard onto the battlefield under its owner's control.
### Exact-Target Graveyard To Hand

32. Naya Charm (EDHREC 2829) - • Return target card from a graveyard to its owner's hand.
33. Grave Scrabbler (EDHREC 9848) - When this creature enters, if its madness cost was paid, you may return target creature card from a graveyard to its owner's hand.
34. Pulse of Murasa (EDHREC 10153) - Return target creature or land card from a graveyard to its owner's hand.
35. Revive the Fallen (EDHREC 12068) - Return target creature card from a graveyard to its owner's hand.
36. Mine Excavation (EDHREC 19606) - Return target artifact or enchantment card from a graveyard to its owner's hand.
37. Endbringer's Revel (EDHREC 22631) - {4}: Return target creature card from a graveyard to its owner's hand.
38. Vampire Charmseeker (EDHREC 23903) - When this creature enters, return target instant, sorcery, or creature card from a graveyard to its owner's hand.
39. Disturbing Plot (EDHREC 23928) - Return target creature card from a graveyard to its owner's hand.
40. Another Night in Vegas (unranked) - — Return target creature card from a graveyard to its owner's hand.
### Exact-Target Graveyard To Library

41. Noxious Revival (EDHREC 608) - Put target card from a graveyard on top of its owner's library.
42. Junktroller (EDHREC 11558) - {T}: Put target card from a graveyard on the bottom of its owner's library.
43. Chrome Companion (EDHREC 11623) - {2}, {T}: Put target card from a graveyard on the bottom of its owner's library.
44. Vessel of Endless Rest (EDHREC 12920) - When this artifact enters, put target card from a graveyard on the bottom of its owner's library.
45. Hoverstone Pilgrim (EDHREC 14225) - {2}: Put target card from a graveyard on the bottom of its owner's library.
46. Reito Lantern (EDHREC 14543) - {3}: Put target card from a graveyard on the bottom of its owner's library.
47. Reito Sentinel (EDHREC 15251) - {3}: Put target card from a graveyard on the bottom of its owner's library.
48. Jade-Cast Sentinel (EDHREC 18181) - {2}, {T}: Put target card from a graveyard on the bottom of its owner's library.
49. Malevolent Chandelier (EDHREC 18397) - {2}: Put target card from a graveyard on the bottom of its owner's library.
50. Dutiful Knowledge Seeker (EDHREC 19525) - {3}: Put target card from a graveyard on the bottom of its owner's library.
51. Phyrexian Archivist (EDHREC 21643) - {2}, {T}: Put target card from a graveyard on the bottom of its owner's library.
52. Cogwork Archivist (EDHREC 22909) - {2}, {T}: Put target card from a graveyard on the bottom of its owner's library.
53. Nantuko Tracer (EDHREC 25540) - When this creature enters, you may put target card from a graveyard on the bottom of its owner's library.
54. Keeper of the Cadence (EDHREC 26285) - {3}: Put target artifact, instant, or sorcery card from a graveyard on the bottom of its owner's library.
55. Grazing Kelpie (EDHREC 26628) - {G/U}, Sacrifice this creature: Put target card from a graveyard on the bottom of its owner's library.
### Exact-Target Graveyard Exile

56. Deathrite Shaman (EDHREC 580) - {T}: Exile target land card from a graveyard.
57. Return to Nature (EDHREC 654) - • Exile target card from a graveyard.
58. Soul-Guide Lantern (EDHREC 1357) - When this artifact enters, exile target card from a graveyard.
59. Agatha's Soul Cauldron (EDHREC 1379) - {T}: Exile target card from a graveyard.
60. Scavenging Ooze (EDHREC 1413) - {G}: Exile target card from a graveyard.
61. Lion Sash (EDHREC 1578) - {W}: Exile target card from a graveyard.
62. The Scarab God (EDHREC 1699) - {2}{U}{B}: Exile target creature card from a graveyard.
63. Cemetery Reaper (EDHREC 2021) - {2}{B}, {T}: Exile target creature card from a graveyard.
64. Hazel's Brewmaster (EDHREC 2437) - Whenever this creature enters or attacks, exile up to one target card from a graveyard and create a Food token.
65. Restless Cottage (EDHREC 2929) - Whenever this land attacks, create a Food token and exile up to one target card from a graveyard.
66. Heritage Reclamation (EDHREC 3093) - • Exile up to one target card from a graveyard.
67. General's Enforcer (EDHREC 3119) - {2}{W}{B}: Exile target card from a graveyard.
68. Abyssal Harvester (EDHREC 3225) - {T}: Exile target creature card from a graveyard that was put there this turn.
69. Mnemonic Deluge (EDHREC 3924) - Exile target instant or sorcery card from a graveyard.
70. Ghost Vacuum (EDHREC 4058) - {T}: Exile target card from a graveyard.
71. Armored Scrapgorger (EDHREC 4214) - Whenever this creature becomes tapped, exile target card from a graveyard and put an oil counter on this creature.
72. Ardyn, the Usurper (EDHREC 4700) - Starscourge — At the beginning of combat on your turn, exile up to one target creature card from a graveyard.
73. Klothys, God of Destiny (EDHREC 4820) - At the beginning of your first main phase, exile target card from a graveyard.
74. Verdant Command (EDHREC 5387) - • Exile target card from a graveyard.
75. Intrepid Paleontologist (EDHREC 5504) - {2}: Exile target card from a graveyard.
76. Emperor of Bones (EDHREC 5514) - At the beginning of combat on your turn, exile up to one target card from a graveyard.
77. Dino DNA (EDHREC 5948) - Imprint — {1}, {T}: Exile target creature card from a graveyard.
78. Dawnbringer Cleric (EDHREC 6183) - • Gentle Repose — Exile target card from a graveyard.
79. Mastermind Plum (EDHREC 6279) - Whenever Mastermind Plum attacks, exile up to one target card from a graveyard.
80. Immersturm Predator (EDHREC 6609) - Whenever this creature becomes tapped, exile up to one target card from a graveyard and put a +1/+1 counter on this creature.
81. Cremate (EDHREC 7024) - Exile target card from a graveyard.
82. Myr Welder (EDHREC 7311) - Imprint — {T}: Exile target artifact card from a graveyard.
83. Honored Heirloom (EDHREC 7811) - {2}, {T}: Exile target card from a graveyard.
84. Cling to Dust (EDHREC 7820) - Exile target card from a graveyard.
85. The Animus (EDHREC 8026) - At the beginning of your end step, exile up to one target legendary creature card from a graveyard with a memory counter on it.
86. Scrabbling Claws (EDHREC 8140) - {1}, Sacrifice this artifact: Exile target card from a graveyard.
87. Wizard's Spellbook (EDHREC 8506) - {T}: Exile target instant or sorcery card from a graveyard.
88. Dawnhand Dissident (EDHREC 9017) - {T}, Blight 2: Exile target card from a graveyard.
89. Pharika, God of Affliction (EDHREC 9241) - {B}{G}: Exile target creature card from a graveyard.
90. Withered Wretch (EDHREC 9257) - {1}: Exile target card from a graveyard.
91. Psionic Ritual (EDHREC 9300) - Exile target instant or sorcery card from a graveyard and copy it.
92. Necrogenesis (EDHREC 9421) - {2}: Exile target creature card from a graveyard.
93. Keen-Eyed Curator (EDHREC 9713) - {1}: Exile target card from a graveyard.
94. Summoner's Sending (EDHREC 10430) - At the beginning of your end step, you may exile target creature card from a graveyard.
95. Misfortune Teller (EDHREC 10615) - Whenever this creature enters or deals combat damage to a player, exile target card from a graveyard.
96. Selesnya Eulogist (EDHREC 10989) - {2}{G}: Exile target creature card from a graveyard, then populate.
97. Deathgorge Scavenger (EDHREC 11036) - Whenever this creature enters or attacks, you may exile target card from a graveyard.
98. The Ooze (EDHREC 11053) - {T}: Exile target card from a graveyard.
99. Ignis Scientia (EDHREC 11318) - — {1}{G}{U}, {T}: Exile target card from a graveyard.
100. Lantern of the Lost (EDHREC 11543) - When this artifact enters, exile target card from a graveyard.
101. Urborg Scavengers (EDHREC 11755) - Whenever this creature enters or attacks, exile target card from a graveyard.
102. Heap Doll (EDHREC 11941) - Sacrifice this creature: Exile target card from a graveyard.
103. Dimir Doppelganger (EDHREC 12172) - {1}{U}{B}: Exile target creature card from a graveyard.
104. Raven Eagle (EDHREC 12397) - Whenever this creature enters or attacks, exile up to one target card from a graveyard.
105. Stonecloaker (EDHREC 12661) - When this creature enters, exile target card from a graveyard.
106. Lazav, Wearer of Faces (EDHREC 12955) - Whenever Lazav attacks, exile target card from a graveyard, then investigate.
107. Venom, Deadly Devourer (EDHREC 12991) - {3}: Exile target creature card from a graveyard.
108. Rotten Reunion (EDHREC 13320) - Exile up to one target card from a graveyard.
109. Lara Croft, Tomb Raider (EDHREC 13707) - Whenever Lara Croft attacks, exile up to one target legendary artifact card or legendary land card from a graveyard and put a discovery counter on it.
110. Boiling Rock Rioter (EDHREC 13802) - Tap an untapped Ally you control: Exile target card from a graveyard.
111. Magic Pot (EDHREC 14933) - {2}, {T}: Exile target card from a graveyard.
112. Break Ties (EDHREC 15032) - • Exile target card from a graveyard.
113. Cleanup Crew (EDHREC 15155) - • Exile target card from a graveyard.
114. Jack-o'-Lantern (EDHREC 15223) - {1}, {T}, Sacrifice this artifact: Exile up to one target card from a graveyard.
115. Mechanical Mobster (EDHREC 15648) - When this creature enters, exile up to one target card from a graveyard.
116. Mardu Woe-Reaper (EDHREC 16100) - Whenever this creature or another Warrior you control enters, you may exile target creature card from a graveyard.
117. Ambush Wolf (EDHREC 16491) - When this creature enters, exile up to one target card from a graveyard.
118. Crossroads Candleguide (EDHREC 16577) - When this creature enters, exile up to one target card from a graveyard.
119. Wreck Remover (EDHREC 16722) - Whenever this creature enters or attacks, exile up to one target card from a graveyard.
120. Phyrexian Furnace (EDHREC 16778) - {1}, Sacrifice this artifact: Exile target card from a graveyard.
121. Vile Rebirth (EDHREC 16910) - Exile target creature card from a graveyard.
122. Blood Operative (EDHREC 16978) - When this creature enters, you may exile target card from a graveyard.
123. Veteran Survivor (EDHREC 17531) - Survival — At the beginning of your second main phase, if this creature is tapped, exile up to one target card from a graveyard.
124. Sungold Sentinel (EDHREC 17641) - Whenever this creature enters or attacks, exile up to one target card from a graveyard.
125. Shamble Back (EDHREC 17905) - Exile target creature card from a graveyard.
126. Beckon Apparition (EDHREC 18086) - Exile target card from a graveyard.
127. Offalsnout (EDHREC 18942) - When this creature leaves the battlefield, exile target card from a graveyard.
128. Diregraf Scavenger (EDHREC 19024) - When this creature enters, exile up to one target card from a graveyard.
129. Corpse Appraiser (EDHREC 19071) - When this creature enters, exile up to one target creature card from a graveyard.
130. Ashnod's Harvester (EDHREC 19242) - Whenever this creature attacks, exile target card from a graveyard.
131. Sequence Engine (EDHREC 19274) - {X}, {T}: Exile target creature card with mana value X from a graveyard.
132. The Spot, Living Portal (EDHREC 19498) - When The Spot enters, exile up to one target nonland permanent and up to one target nonland permanent card from a graveyard.
133. Crook of Condemnation (EDHREC 19936) - {1}, {T}: Exile target card from a graveyard.
134. Territorial Kavu (EDHREC 20164) - • Exile up to one target card from a graveyard.
135. Morbid Bloom (EDHREC 20374) - Exile target creature card from a graveyard, then create X 1/1 green Saproling creature tokens, where X is the exiled card's toughness.
136. Purify the Grave (EDHREC 20443) - Exile target card from a graveyard.
137. Gravestone Strider (EDHREC 20896) - {2}, Exile this card from your graveyard: Exile target card from a graveyard.
138. Apostle of Purifying Light (EDHREC 21757) - {2}: Exile target card from a graveyard.
139. Coffin Purge (EDHREC 21832) - Exile target card from a graveyard.
140. Conversion Chamber (EDHREC 22344) - {2}, {T}: Exile target artifact card from a graveyard.
141. Rotfeaster Maggot (EDHREC 22898) - When this creature enters, exile target creature card from a graveyard.
142. Fade from Memory (EDHREC 23125) - Exile target card from a graveyard.
143. Boneclad Necromancer (EDHREC 23492) - When this creature enters, you may exile target creature card from a graveyard.
144. Crypt Creeper (EDHREC 24608) - Sacrifice this creature: Exile target card from a graveyard.
145. Shadowfeed (EDHREC 25667) - Exile target card from a graveyard.
146. Mourner's Shield (EDHREC 25728) - Imprint — When this artifact enters, you may exile target card from a graveyard.
147. Soul-Guide Gryff (EDHREC 25740) - When this creature enters, exile up to one target card from a graveyard.
148. Carrion Imp (EDHREC 26062) - When this creature enters, you may exile target creature card from a graveyard.
149. Mirror Golem (EDHREC 26459) - Imprint — When this creature enters, you may exile target card from a graveyard.
150. Thraben Heretic (EDHREC 26779) - {T}: Exile target creature card from a graveyard.
151. Funeral Pyre (EDHREC 26952) - Exile target card from a graveyard.
152. Rise of Extus (EDHREC 27747) - Exile up to one target instant or sorcery card from a graveyard.
153. Headstone (EDHREC 27823) - Exile target card from a graveyard.
154. Mortiphobia (EDHREC 28443) - {1}{B}, Discard a card: Exile target card from a graveyard.
155. Grixis Sojourners (EDHREC 28774) - When you cycle this card and when this creature dies, you may exile target card from a graveyard.
156. Creakwood Ghoul (EDHREC 28946) - {B/G}{B/G}: Exile target card from a graveyard.
157. Sewerdreg (EDHREC 29566) - Sacrifice this creature: Exile target card from a graveyard.
158. Grave Robbers (EDHREC 29986) - {B}, {T}: Exile target artifact card from a graveyard.
159. Moratorium Stone (EDHREC 30344) - {2}, {T}: Exile target card from a graveyard.
160. Selfless Exorcist (EDHREC 30444) - {T}: Exile target creature card from a graveyard.
161. Steamclaw (EDHREC 30456) - {3}, {T}: Exile target card from a graveyard.
162. Color Pie (unranked) - Exile up to one target card from a graveyard.
163. The Many Deeds of Belzenlok (unranked) - I — Exile up to one target Saga card from a graveyard.
164. Trained Blessed Mind (unranked) - {TK}{TK} — {T}: Exile target card from a graveyard.
### Your Graveyard To Hand

165. Eternal Witness (EDHREC 98) - When this creature enters, you may return target card from your graveyard to your hand.
166. Buried Ruin (EDHREC 194) - {2}, {T}, Sacrifice this land: Return target artifact card from your graveyard to your hand.
167. Phyrexian Reclamation (EDHREC 911) - {1}{B}, Pay 2 life: Return target creature card from your graveyard to your hand.
168. Archaeomancer (EDHREC 941) - When this creature enters, return target instant or sorcery card from your graveyard to your hand.
169. Evolution Witness (EDHREC 991) - Whenever one or more +1/+1 counters are put on this creature, return target permanent card from your graveyard to your hand.
170. Haven of the Spirit Dragon (EDHREC 1137) - {2}, {T}, Sacrifice this land: Return target Dragon creature card or Ugin planeswalker card from your graveyard to your hand.
171. Timeless Witness (EDHREC 1211) - When this creature enters, return target card from your graveyard to your hand.
172. Regrowth (EDHREC 1313) - Return target card from your graveyard to your hand.
173. Unnatural Restoration (EDHREC 1361) - Return target permanent card from your graveyard to your hand.
174. Honest Rutstein (EDHREC 1565) - When Honest Rutstein enters, return target creature card from your graveyard to your hand.
175. Tortured Existence (EDHREC 1570) - {B}, Discard a creature card: Return target creature card from your graveyard to your hand.
176. Oversold Cemetery (EDHREC 1592) - At the beginning of your upkeep, if you have four or more creature cards in your graveyard, you may return target creature card from your graveyard to your hand.
177. Nyx Weaver (EDHREC 1625) - {1}{B}{G}, Exile this creature: Return target card from your graveyard to your hand.
178. Stitch Together (EDHREC 1746) - Return target creature card from your graveyard to your hand.
179. Emeria Shepherd (EDHREC 1953) - Landfall — Whenever a land you control enters, you may return target nonland permanent card from your graveyard to your hand.
180. Trading Post (EDHREC 2014) - {1}, {T}, Sacrifice a creature: Return target artifact card from your graveyard to your hand.
181. Sword of Light and Shadow (EDHREC 2147) - Whenever equipped creature deals combat damage to a player, you gain 3 life and you may return up to one target creature card from your graveyard to your hand.
182. Abstergo Entertainment (EDHREC 2219) - {3}, {T}, Exile Abstergo Entertainment: Return up to one target historic card from your graveyard to your hand, then exile all graveyards.
183. Samwise Gamgee (EDHREC 2285) - Sacrifice three Foods: Return target historic card from your graveyard to your hand.
184. Codex Shredder (EDHREC 2319) - {5}, {T}, Sacrifice this artifact: Return target card from your graveyard to your hand.
185. Peerless Recycling (EDHREC 2820) - Return target permanent card from your graveyard to your hand.
186. Spawnbed Protector (EDHREC 2844) - At the beginning of your end step, return up to one target Eldrazi creature card from your graveyard to your hand.
187. Mudflat Village (EDHREC 2845) - {1}{B}, {T}, Sacrifice this land: Return target Bat, Lizard, Rat, or Squirrel card from your graveyard to your hand.
188. Revive the Shire (EDHREC 2851) - Return target permanent card from your graveyard to your hand.
189. Graveshifter (EDHREC 2911) - When this creature enters, you may return target creature card from your graveyard to your hand.
190. Memorial to Folly (EDHREC 2921) - {2}{B}, {T}, Sacrifice this land: Return target creature card from your graveyard to your hand.
191. Witch of the Moors (EDHREC 2949) - At the beginning of your end step, if you gained life this turn, each opponent sacrifices a creature of their choice and you return up to one target creature card from your graveyard to your hand.
192. Tezzeret, Master of the Bridge (EDHREC 3069) - −3: Return target artifact card from your graveyard to your hand.
193. Skullwinder (EDHREC 3226) - When this creature enters, return target card from your graveyard to your hand, then choose an opponent.
194. Golgari Thug (EDHREC 3235) - When this creature dies, put target creature card from your graveyard on top of your library. Dredge 4 (If you would draw a card, you may mill four cards instead. If you do, return this card from your graveyard to you...
195. Kolaghan's Command (EDHREC 3355) - • Return target creature card from your graveyard to your hand.
196. Lord of the Undead (EDHREC 3370) - {1}{B}, {T}: Return target Zombie card from your graveyard to your hand.
197. Trailtracker Scout (EDHREC 3452) - Whenever you expend 8, return up to one target permanent card from your graveyard to your hand.
198. Court of Ardenvale (EDHREC 3513) - At the beginning of your upkeep, return target permanent card with mana value 3 or less from your graveyard to your hand.
199. Cid, Freeflier Pilot (EDHREC 3563) - {2}, {T}: Return target Equipment or Vehicle card from your graveyard to your hand.
200. Colossal Skyturtle (EDHREC 3591) - Channel — {2}{G}, Discard this card: Return target card from your graveyard to your hand.
201. Scour for Scrap (EDHREC 3837) - • Return target artifact card from your graveyard to your hand.
202. Toph, Hardheaded Teacher (EDHREC 3878) - If you do, return target instant or sorcery card from your graveyard to your hand.
203. Sam's Desperate Rescue (EDHREC 3929) - Return target creature card from your graveyard to your hand.
204. Auramancer (EDHREC 3993) - When this creature enters, you may return target enchantment card from your graveyard to your hand.
205. Greenwarden of Murasa (EDHREC 4059) - When this creature enters, you may return target card from your graveyard to your hand.
206. Undead Butler (EDHREC 4123) - When you do, return target creature card from your graveyard to your hand.
207. Nissa, Vital Force (EDHREC 4284) - −3: Return target permanent card from your graveyard to your hand.
208. Auroral Procession (EDHREC 4351) - Return target card from your graveyard to your hand.
209. The Underworld Cookbook (EDHREC 4412) - {4}, {T}, Sacrifice this artifact: Return target creature card from your graveyard to your hand.
210. Atzocan Seer (EDHREC 4462) - Sacrifice this creature: Return target Dinosaur card from your graveyard to your hand.
211. Satsuki, the Living Lore (EDHREC 4482) - • Return target Saga card from your graveyard to your hand.
212. Veinwitch Coven (EDHREC 4676) - If you do, return target creature card from your graveyard to your hand.
213. Stormchaser's Talent (EDHREC 4679) - When this Class becomes level 2, return target instant or sorcery card from your graveyard to your hand.
214. Red XIII, Proud Warrior (EDHREC 4762) - Cosmo Memory — When Red XIII enters, return target Aura or Equipment card from your graveyard to your hand.
215. Palace Siege (EDHREC 4918) - • Khans — At the beginning of your upkeep, return target creature card from your graveyard to your hand.
216. Golbez, Crystal Collector (EDHREC 4956) - At the beginning of your end step, if you control four or more artifacts, return target creature card from your graveyard to your hand.
217. Mystic Retrieval (EDHREC 5031) - Return target instant or sorcery card from your graveyard to your hand.
218. Hanna, Ship's Navigator (EDHREC 5086) - {1}{W}{U}, {T}: Return target artifact or enchantment card from your graveyard to your hand.
219. Cavalier of Dawn (EDHREC 5365) - When this creature dies, return target artifact or enchantment card from your graveyard to your hand.
220. Reconstruct History (EDHREC 5566) - Return up to one target artifact card, up to one target enchantment card, up to one target instant card, up to one target sorcery card, and up to one target planeswalker card from your graveyard to your hand.
221. Fungal Rebirth (EDHREC 5644) - Return target permanent card from your graveyard to your hand.
222. Den Protector (EDHREC 5865) - When this creature is turned face up, return target card from your graveyard to your hand.
223. Awaken the Honored Dead (EDHREC 5891) - When you do, return target creature or land card from your graveyard to your hand.
224. Wrenn and Six (EDHREC 5926) - +1: Return up to one target land card from your graveyard to your hand.
225. Genesis (EDHREC 5942) - If you do, return target creature card from your graveyard to your hand.
226. Layla Hassan (EDHREC 5957) - When Layla Hassan enters and whenever one or more Assassins you control deal combat damage to a player, return target historic card from your graveyard to your hand.
227. Mnemonic Wall (EDHREC 6009) - When this creature enters, you may return target instant or sorcery card from your graveyard to your hand.
228. Cormela, Glamour Thief (EDHREC 6018) - When Cormela dies, return up to one target instant or sorcery card from your graveyard to your hand.
229. Volcanic Vision (EDHREC 6104) - Return target instant or sorcery card from your graveyard to your hand.
230. Echoing Return (EDHREC 6155) - Return target creature card and all other cards with the same name as that card from your graveyard to your hand.
231. Ruxa, Patient Professor (EDHREC 6186) - Whenever Ruxa enters or attacks, return target creature card with no abilities from your graveyard to your hand.
232. Planewide Celebration (EDHREC 6369) - • Return target permanent card from your graveyard to your hand.
233. Call to the Netherworld (EDHREC 6394) - Return target black creature card from your graveyard to your hand.
234. Gloomshrieker (EDHREC 6607) - When this creature enters, return target permanent card from your graveyard to your hand.
235. Turntimber Sower (EDHREC 6654) - {G}, Sacrifice three creatures: Return target land card from your graveyard to your hand.
236. Grave Venerations (EDHREC 6660) - At the beginning of your end step, if you're the monarch, return up to one target creature card from your graveyard to your hand.
237. Consumed by Greed (EDHREC 6718) - If the gift was promised, return target creature card from your graveyard to your hand.
238. Dryad's Revival (EDHREC 6811) - Return target card from your graveyard to your hand.
239. Aerith, Last Ancient (EDHREC 6940) - Raise — At the beginning of your end step, if you gained life this turn, return target creature card from your graveyard to your hand.
240. Spring-Leaf Avenger (EDHREC 6975) - Whenever this creature deals combat damage to a player, return target permanent card from your graveyard to your hand.
241. True Ancestry (EDHREC 7002) - Return up to one target permanent card from your graveyard to your hand.
242. Elena, Turk Recruit (EDHREC 7138) - When Elena enters, return target non-Assassin historic card from your graveyard to your hand.
243. Flood of Recollection (EDHREC 7331) - Return target instant or sorcery card from your graveyard to your hand.
244. Evolution Charm (EDHREC 7365) - • Return target creature card from your graveyard to your hand.
### Dies Triggers Returning The Card To Battlefield

245. Not Dead After All (EDHREC 1048) - Until end of turn, target creature you control gains "When this creature dies, return it to the battlefield tapped under its owner's control, then create a Wicked Role token attached to it." (Enchanted creature gets +1/+1.
246. Luminous Broodmoth (EDHREC 1237) - Whenever a creature you control without flying dies, return it to the battlefield under its owner's control with a flying counter on it.
247. Undying Malice (EDHREC 1373) - Until end of turn, target creature gains "When this creature dies, return it to the battlefield tapped under its owner's control with a +1/+1 counter on it."
248. Feign Death (EDHREC 1463) - Until end of turn, target creature gains "When this creature dies, return it to the battlefield tapped under its owner's control with a +1/+1 counter on it."
249. Fake Your Own Death (EDHREC 1558) - Until end of turn, target creature gets +2/+0 and gains "When this creature dies, return it to the battlefield tapped under its owner's control and you create a Treasure token." (It's an artifact with "{T}, Sacrifice this token: Add one mana of any color.")
250. Supernatural Stamina (EDHREC 1768) - Until end of turn, target creature gets +2/+0 and gains "When this creature dies, return it to the battlefield tapped under its owner's control."
251. Gift of Immortality (EDHREC 2258) - When enchanted creature dies, return that card to the battlefield under its owner's control.
252. Resurrection Orb (EDHREC 4040) - Whenever equipped creature dies, return that card to the battlefield under its owner's control at the beginning of the next end step.
253. Grave Betrayal (EDHREC 4354) - Whenever a creature you don't control dies, return it to the battlefield under your control with an additional +1/+1 counter on it at the beginning of the next end step.
254. Marchesa, the Black Rose (EDHREC 4613) - Whenever a creature you control with a +1/+1 counter on it dies, return that card to the battlefield under your control at the beginning of the next end step.
255. Necrogen Communion (EDHREC 4976) - When enchanted creature dies, return that card to the battlefield under your control.
256. Fungal Fortitude (EDHREC 5243) - When enchanted creature dies, return it to the battlefield tapped under its owner's control.
257. Minion's Return (EDHREC 5260) - When enchanted creature dies, return that card to the battlefield under your control.
258. Valkyrie's Call (EDHREC 5554) - Whenever a nontoken, non-Angel creature you control dies, return that card to the battlefield under its owner's control with a +1/+1 counter on it.
259. Return to Action (EDHREC 7524) - Until end of turn, target creature gets +1/+0 and gains lifelink and "When this creature dies, return it to the battlefield tapped under its owner's control."
260. Phytotitan (EDHREC 8326) - When this creature dies, return it to the battlefield tapped under its owner's control at the beginning of their next upkeep.
261. Demonic Gifts (EDHREC 8329) - Until end of turn, target creature gets +2/+0 and gains "When this creature dies, return it to the battlefield under its owner's control."
262. Vincent's Limit Break (EDHREC 8332) - Until end of turn, target creature you control gains "When this creature dies, return it to the battlefield tapped under its owner's control" and has the chosen base power and toughness.
263. Abnormal Endurance (EDHREC 9351) - Until end of turn, target creature gets +2/+0 and gains "When this creature dies, return it to the battlefield tapped under its owner's control."
264. Bronzehide Lion (EDHREC 9408) - When this creature dies, return it to the battlefield.
265. Missy (EDHREC 9448) - Whenever another nonartifact creature dies, return it to the battlefield under your control face down and tapped.
266. Unholy Indenture (EDHREC 10380) - When enchanted creature dies, return that card to the battlefield under your control with a +1/+1 counter on it.
267. Oathkeeper, Takeno's Daisho (EDHREC 10399) - Whenever equipped creature dies, return that card to the battlefield under your control if it's a Samurai card.
268. Infuse with Vitality (EDHREC 10449) - Until end of turn, target creature gains deathtouch and "When this creature dies, return it to the battlefield tapped under its owner's control."
269. Ashcloud Phoenix (EDHREC 10946) - When this creature dies, return it to the battlefield face down under your control.
270. Yarus, Roar of the Old Gods (EDHREC 11104) - Whenever a face-down creature you control dies, return it to the battlefield face down under its owner's control if it's a permanent card, then turn it face up.
271. Fool's Demise (EDHREC 12423) - When enchanted creature dies, return that card to the battlefield under your control.
272. Scythe of the Wretched (EDHREC 12944) - Whenever a creature dealt damage by equipped creature this turn dies, return that card to the battlefield under your control.
273. Presumed Dead (EDHREC 13150) - Until end of turn, target creature gets +2/+0 and gains "When this creature dies, return it to the battlefield under its owner's control and suspect it." (A suspected creature has menace and can't block.)
274. Perigee Beckoner (EDHREC 13894) - When this creature enters, until end of turn, another target creature you control gets +2/+0 and gains "When this creature dies, return it to the battlefield tapped under its owner's control."
275. Unhallowed Pact (EDHREC 14043) - When enchanted creature dies, return that card to the battlefield under your control.
276. Shade's Form (EDHREC 14754) - When enchanted creature dies, return that card to the battlefield under your control.
277. Edea, Possessed Sorceress (EDHREC 16251) - Whenever a creature you control but don't own dies, return it to the battlefield under its owner's control and you draw a card.
278. Abduction (EDHREC 18205) - When enchanted creature dies, return that card to the battlefield under its owner's control.
279. Dread Slaver (EDHREC 18452) - Whenever a creature dealt damage by this creature this turn dies, return it to the battlefield under your control.
280. False Demise (EDHREC 18510) - When enchanted creature dies, return that card to the battlefield under your control.
281. Soul Collector (EDHREC 20531) - Whenever a creature dealt damage by this creature this turn dies, return that card to the battlefield under your control.
282. Pain 101 (EDHREC 20745) - Until end of turn, target creature gains deathtouch and "When this creature dies, return it to the battlefield tapped under its owner's control."
283. Molten Firebird (EDHREC 24901) - When this creature dies, return it to the battlefield under its owner's control at the beginning of the next end step and you skip your next draw step.
284. Thunderbolts Conspiracy (EDHREC 28850) - Whenever a Villain you control dies, return it to the battlefield under its owner's control with a finality counter on it.
### Dies Triggers Returning The Card To Hand

285. The Locust God (EDHREC 1574) - When The Locust God dies, return it to its owner's hand at the beginning of the next end step.
286. Liesa, Forgotten Archangel (EDHREC 1962) - Whenever another nontoken creature you control dies, return that card to its owner's hand at the beginning of the next end step.
287. Athreos, God of Passage (EDHREC 2754) - Whenever another creature you own dies, return it to your hand unless target opponent pays 3 life.
288. The Scorpion God (EDHREC 6028) - When The Scorpion God dies, return it to its owner's hand at the beginning of the next end step.
289. Rienne, Angel of Rebirth (EDHREC 6633) - Whenever another multicolored creature you control dies, return it to its owner's hand at the beginning of the next end step.
290. Demonic Vigor (EDHREC 12415) - When enchanted creature dies, return that card to its owner's hand.
291. Endless Cockroaches (EDHREC 12506) - When this creature dies, return it to its owner's hand.
292. Verdant Rebirth (EDHREC 13178) - Until end of turn, target creature gains "When this creature dies, return it to its owner's hand."
293. Squee's Embrace (EDHREC 15734) - When enchanted creature dies, return that card to its owner's hand.
294. Immortal Phoenix (EDHREC 17331) - When this creature dies, return it to its owner's hand.
295. Flame-Wreathed Phoenix (EDHREC 18077) - When this creature enters, if tribute wasn't paid, it gains haste and "When this creature dies, return it to its owner's hand."
296. Nissa's Zendikon (EDHREC 19323) - When enchanted land dies, return that card to its owner's hand.
297. Wind Zendikon (EDHREC 19368) - When enchanted land dies, return that card to its owner's hand.
298. Mortus Strider (EDHREC 20926) - When this creature dies, return it to its owner's hand.
299. Weatherseed Treefolk (EDHREC 21764) - When this creature dies, return it to its owner's hand.
300. Guardian Zendikon (EDHREC 22059) - When enchanted land dies, return that card to its owner's hand.
301. Shivan Phoenix (EDHREC 22134) - When this creature dies, return it to its owner's hand.
302. Vastwood Zendikon (EDHREC 23415) - When enchanted land dies, return that card to its owner's hand.
303. Corrupted Zendikon (EDHREC 23877) - When enchanted land dies, return that card to its owner's hand.
304. Crusher Zendikon (EDHREC 24581) - When enchanted land dies, return that card to its owner's hand.
305. Puppet Master (EDHREC 28426) - When enchanted creature dies, return that card to its owner's hand.
### Pay-To-Return Deathmantle-Style Recursion

306. Nim Deathmantle (EDHREC 3281) - Equipped creature gets +2/+2, has intimidate, and is a black Zombie. (A creature with intimidate can't be blocked except by artifact creatures and/or creatures that share a color with it.) Whenever a nontoken creature...
307. Vraska, the Silencer (EDHREC 5276) - Deathtouch Whenever a nontoken creature an opponent controls dies, you may pay {1}. If you do, return that card to the battlefield tapped under your control. It's a Treasure artifact with "{T}, Sacrifice this artifact...
308. Lim-Dûl the Necromancer (EDHREC 18549) - Whenever a creature an opponent controls dies, you may pay {1}{B}. If you do, return that card to the battlefield under your control. If it's a creature, it's a Zombie in addition to its other creature types. {1}{B}: ...
### Entered Or Cast From Graveyard Checks

309. Oskar, Rubbish Reclaimer (EDHREC 10152) - Whenever you discard a nonland card, you may cast it from your graveyard.
310. Rocket-Powered Goblin Glider (EDHREC 11668) - When this Equipment enters, if it was cast from your graveyard, attach it to target creature you control.
311. Prized Amalgam (EDHREC 13082) - Whenever a creature enters, if it entered from your graveyard or you cast it from your graveyard, return this card from your graveyard to the battlefield tapped at the beginning of the next end step.
312. Confession Dial (EDHREC 13102) - (You may cast it from your graveyard for its escape cost this turn.)
313. Skyclave Shade (EDHREC 13219) - Landfall — Whenever a land you control enters, if this card is in your graveyard and it's your turn, you may cast it from your graveyard this turn.
314. Archfiend's Vessel (EDHREC 13832) - When this creature enters, if it entered from your graveyard or you cast it from your graveyard, exile it.
315. Desdemona, Freedom's Edge (EDHREC 15119) - (You may cast it from your graveyard for its escape cost this turn.)
### Leave-Battlefield Exile Replacement Riders

316. Whip of Erebos (EDHREC 724) - If it would leave the battlefield, exile it instead of putting it anywhere else.
317. Moira and Teshar (EDHREC 14415) - If it would leave the battlefield, exile it instead of putting it anywhere else.
318. Kheru Lich Lord (EDHREC 25896) - If it would leave the battlefield, exile it instead of putting it anywhere else.
319. Personal Decoy (unranked) - If it would leave the battlefield, exile it instead of putting it anywhere else.
### Cast From Graveyard Permission Windows

320. Faithless Looting (EDHREC 94) - Flashback {2}{R} (You may cast this card from your graveyard for its flashback cost.
321. Sevinne's Reclamation (EDHREC 345) - Flashback {4}{W} (You may cast this card from your graveyard for its flashback cost.
322. Underworld Breach (EDHREC 400) - (You may cast cards from your graveyard for their escape cost.)
323. Dread Return (EDHREC 520) - (You may cast this card from your graveyard for its flashback cost.
324. Six (EDHREC 566) - (You may cast permanent cards from your graveyard by discarding a land card in addition to paying their other costs.)
325. Gravecrawler (EDHREC 713) - You may cast this card from your graveyard as long as you control a Zombie.
326. Strike It Rich (EDHREC 1198) - Flashback {2}{R} (You may cast this card from your graveyard for its flashback cost.
327. Nature's Rhythm (EDHREC 1252) - Harmonize {X}{G}{G}{G}{G} (You may cast this card from your graveyard for its harmonize cost.
328. Past in Flames (EDHREC 1354) - Flashback {4}{R} (You may cast this card from your graveyard for its flashback cost.
329. Uro, Titan of Nature's Wrath (EDHREC 1412) - (You may cast this card from your graveyard for its escape cost.)
330. Deep Analysis (EDHREC 1451) - (You may cast this card from your graveyard for its flashback cost.
331. Snapcaster Mage (EDHREC 1473) - (You may cast that card from your graveyard for its flashback cost.
332. Chainer, Nightmare Adept (EDHREC 1510) - Discard a card: You may cast a creature spell from your graveyard this turn.
333. Seize the Day (EDHREC 1718) - Flashback {2}{R} (You may cast this card from your graveyard for its flashback cost.
334. Woe Strider (EDHREC 1734) - (You may cast this card from your graveyard for its escape cost.)
335. Army of the Damned (EDHREC 1932) - Flashback {7}{B}{B}{B} (You may cast this card from your graveyard for its flashback cost.
336. Squee, the Immortal (EDHREC 2073) - You may cast this card from your graveyard or from exile.
337. Bulk Up (EDHREC 2121) - Flashback {4}{R}{R} (You may cast this card from your graveyard for its flashback cost.
338. Exploration Broodship (EDHREC 2124) - Once during each of your turns, you may cast a permanent spell from your graveyard by sacrificing a land in addition to paying its other costs.
339. The Indomitable (EDHREC 2165) - You may cast this card from your graveyard as long as you control three or more tapped Pirates and/or Vehicles.
340. Think Twice (EDHREC 2220) - Flashback {2}{U} (You may cast this card from your graveyard for its flashback cost.
341. Primevals' Glorious Rebirth (EDHREC 2405) - (You may cast a legendary sorcery only if you control a legendary creature or planeswalker.) Return all legendary permanent cards from your graveyard to the battlefield.
342. Otherworldly Gaze (EDHREC 2443) - Flashback {1}{U} (You may cast this card from your graveyard for its flashback cost.
343. Quilled Greatwurm (EDHREC 2453) - You may cast this card from your graveyard by removing six counters from among creatures you control in addition to paying its other costs.
344. Resurgent Belief (EDHREC 2534) - Suspend 2—{1}{W} (Rather than cast this card from your hand, pay {1}{W} and exile it with two time counters on it. At the beginning of your upkeep, remove a time counter. When the last is removed, you may cast it with...
345. Momentary Blink (EDHREC 2601) - Flashback {3}{U} (You may cast this card from your graveyard for its flashback cost.
346. Echo of Eons (EDHREC 2630) - Flashback {2}{U} (You may cast this card from your graveyard for its flashback cost.
347. Electroduplicate (EDHREC 2634) - Flashback {2}{R}{R} (You may cast this card from your graveyard for its flashback cost.
348. Lurrus of the Dream-Den (EDHREC 2673) - Once during each of your turns, you may cast a permanent spell with mana value 2 or less from your graveyard.
349. Galvanic Iteration (EDHREC 2850) - Flashback {1}{U}{R} (You may cast this card from your graveyard for its flashback cost.
350. Torrential Gearhulk (EDHREC 2854) - When this creature enters, you may cast target instant card from your graveyard without paying its mana cost.
351. Rivaz of the Claw (EDHREC 2871) - Once during each of your turns, you may cast a Dragon creature spell from your graveyard.
352. Cackling Counterpart (EDHREC 2917) - Flashback {5}{U}{U} (You may cast this card from your graveyard for its flashback cost.
353. Laughing Mad (EDHREC 2930) - Flashback {3}{R} (You may cast this card from your graveyard for its flashback cost and any additional costs.
354. Kess, Dissident Mage (EDHREC 2955) - Once during each of your turns, you may cast an instant or sorcery spell from your graveyard.
### Play From Graveyard Permission Windows

355. Ramunap Excavator (EDHREC 410) - You may play lands from your graveyard.
356. Conduit of Worlds (EDHREC 517) - You may play lands from your graveyard.
357. Crucible of Worlds (EDHREC 565) - You may play lands from your graveyard.
358. Ancient Greenwarden (EDHREC 649) - You may play lands from your graveyard.
359. Icetill Explorer (EDHREC 993) - You may play lands from your graveyard.
360. Muldrotha, the Gravetide (EDHREC 1145) - During each of your turns, you may play a land and cast a permanent spell of each permanent type from your graveyard.
361. Wrenn and Realmbreaker (EDHREC 2472) - −7: You get an emblem with "You may play lands and cast permanent spells from your graveyard."
362. Ignite the Future (EDHREC 3374) - Exile the top three cards of your library. Until the end of your next turn, you may play those cards. If this spell was cast from a graveyard, you may play cards this way without paying their mana costs. Flashback {7}...
363. Perennial Behemoth (EDHREC 3532) - You may play lands from your graveyard.
364. Titania, Nature's Force (EDHREC 3806) - You may play Forests from your graveyard.
365. Serra Paragon (EDHREC 4130) - Once during each of your turns, you may play a land from your graveyard or cast a permanent spell with mana value 3 or less from your graveyard.
366. Szarel, Genesis Shepherd (EDHREC 4931) - You may play lands from your graveyard.
367. Oscorp Industries (EDHREC 5161) - Mayhem (You may play this card from your graveyard if you discarded it this turn.
368. Glacierwood Siege (EDHREC 5848) - • Sultai — You may play lands from your graveyard.
369. Embrace the Unknown (EDHREC 6123) - Exile the top two cards of your library. Until the end of your next turn, you may play those cards. Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
370. Zask, Skittering Swarmlord (EDHREC 6646) - You may play lands and cast Insect spells from your graveyard.
371. Hazezon, Shaper of Sand (EDHREC 6681) - You may play Desert lands from your graveyard.
372. Kethis, the Hidden Hand (EDHREC 6921) - Exile two legendary cards from your graveyard: Until end of turn, each legendary card in your graveyard gains "You may play this card from your graveyard."
373. Horde of Notions (EDHREC 7058) - {W}{U}{B}{R}{G}: You may play target Elemental card from your graveyard without paying its mana cost.
374. Zenith Festival (EDHREC 8118) - Exile the top X cards of your library. You may play them until the end of your next turn. Harmonize {X}{R}{R} (You may cast this card from your graveyard for its harmonize cost. You may tap a creature you control to r...
375. The Eighth Doctor (EDHREC 10830) - Once during each of your turns, you may play a historic land or cast a historic permanent spell from your graveyard.
376. Lidless Gaze (EDHREC 11631) - Exile the top card of each player's library. Until the end of your next turn, you may play those cards, and mana of any type can be spent to cast those spells. Flashback {2}{B}{R} (You may cast this card from your gra...
377. Mishra's Research Desk (EDHREC 14802) - {1}, {T}, Sacrifice this artifact: Exile the top two cards of your library. Choose one of them. Until the end of your next turn, you may play that card. Unearth {1}{R} ({1}{R}: Return this card from your graveyard to ...
378. Gaea's Will (EDHREC 15039) - Until end of turn, you may play lands and cast spells from your graveyard.
379. Magus of the Will (EDHREC 16320) - {2}{B}, {T}, Exile this creature: Until end of turn, you may play lands and cast spells from your graveyard.
### Flashback Cards

380. Lier, Disciple of the Drowned (EDHREC 2272) - Each instant and sorcery card in your graveyard has flashback.
381. Will of the Jeskai (EDHREC 2848) - • Each instant and sorcery card in your graveyard gains flashback until end of turn.
382. Increasing Vengeance (EDHREC 3010) - Flashback {3}{R}{R} (You may cast this card from your graveyard for its flashback cost.
383. Increasing Devotion (EDHREC 3157) - Flashback {7}{W}{W} (You may cast this card from your graveyard for its flashback cost.
384. Prisoner's Dilemma (EDHREC 3325) - Flashback {5}{R}{R}
385. Divine Reckoning (EDHREC 3408) - Flashback {5}{W}{W} (You may cast this card from your graveyard for its flashback cost.
386. Rite of Oblivion (EDHREC 3439) - Flashback {2}{W}{B} (You may cast this card from your graveyard for its flashback cost and any additional costs.
387. Faithful Mending (EDHREC 3460) - Flashback {1}{W}{U} (You may cast this card from your graveyard for its flashback cost.
388. Eviscerator's Insight (EDHREC 3841) - Flashback {4}{B} (You may cast this card from your graveyard for its flashback cost and any additional costs.
389. Unburial Rites (EDHREC 3866) - Flashback {3}{W} (You may cast this card from your graveyard for its flashback cost.
390. Siphon Insight (EDHREC 3879) - Flashback {1}{U}{B}
391. Rite of Harmony (EDHREC 4055) - Flashback {2}{G}{W} (You may cast this card from your graveyard for its flashback cost.
392. Artful Dodge (EDHREC 4073) - Flashback {U} (You may cast this card from your graveyard for its flashback cost.
393. Nibelheim Aflame (EDHREC 4737) - Flashback {5}{R}{R} (You may cast this card from your graveyard for its flashback cost.
394. Angelfire Ignition (EDHREC 4818) - Flashback {2}{R}{W} (You may cast this card from your graveyard for its flashback cost.
395. Forbidden Alchemy (EDHREC 5277) - Flashback {6}{B} (You may cast this card from your graveyard for its flashback cost.
396. Croaking Counterpart (EDHREC 5346) - Flashback {3}{G}{U} (You may cast this card from your graveyard for its flashback cost.
397. Electric Revelation (EDHREC 5374) - Flashback {3}{R} (You may cast this card from your graveyard for its flashback cost and any additional costs.
398. Memory Deluge (EDHREC 5828) - Flashback {5}{U}{U} (You may cast this card from your graveyard for its flashback cost.
399. Summons of Saruman (EDHREC 5950) - Flashback—{3}{U}{R}, Exile X cards from your graveyard.
400. Visions of Glory (EDHREC 5994) - Flashback {8}{W}{W}.
401. Moment's Peace (EDHREC 6014) - Flashback {2}{G} (You may cast this card from your graveyard for its flashback cost.
402. Isengard Unleashed (EDHREC 6099) - Flashback {4}{R}{R}{R} (You may cast this card from your graveyard for its flashback cost.
403. Lingering Souls (EDHREC 6207) - Flashback {1}{B} (You may cast this card from your graveyard for its flashback cost.
404. Lava Dart (EDHREC 6247) - Flashback—Sacrifice a Mountain.
405. Snort (EDHREC 6329) - Flashback {5}{R} (You may cast this card from your graveyard for its flashback cost.
406. Creeping Renaissance (EDHREC 6425) - Flashback {5}{G}{G} (You may cast this card from your graveyard for its flashback cost.
407. Reckless Charge (EDHREC 6492) - Flashback {2}{R} (You may cast this card from your graveyard for its flashback cost.
408. Rockalanche (EDHREC 6736) - Flashback {5}{G} (You may cast this card from your graveyard for its flashback cost.
409. Ancient Grudge (EDHREC 6765) - Flashback {G} (You may cast this card from your graveyard for its flashback cost.
410. Visions of Dominance (EDHREC 7001) - Flashback {8}{G}{G}.
411. Revenge of the Rats (EDHREC 7105) - Flashback {2}{B}{B} (You may cast this card from your graveyard for its flashback cost.
412. For the Ancestors (EDHREC 7236) - Flashback {3}{G} (You may cast this card from your graveyard for its flashback cost.
413. Spider Spawning (EDHREC 7316) - Flashback {6}{B} (You may cast this card from your graveyard for its flashback cost.
414. Iroh, Grand Lotus (EDHREC 7323) - During your turn, each non-Lesson instant and sorcery card in your graveyard has flashback.
415. Battle Screech (EDHREC 7364) - Flashback—Tap three untapped white creatures you control.
416. Backdraft Hellkite (EDHREC 7653) - Whenever this creature attacks, each instant and sorcery card in your graveyard gains flashback until end of turn.
417. Chatter of the Squirrel (EDHREC 7680) - Flashback {1}{G} (You may cast this card from your graveyard for its flashback cost.
418. Resentful Revelation (EDHREC 7682) - Flashback {6}{B} (You may cast this card from your graveyard for its flashback cost.
419. Welcome the Dead (EDHREC 7864) - Flashback {5}{B} (You may cast this card from your graveyard for its flashback cost.
420. Wreck and Rebuild (EDHREC 7910) - Flashback {3}{R}{G}
421. Visions of Ruin (EDHREC 8027) - Flashback {8}{R}{R}.
422. Wake the Dragon (EDHREC 8189) - Flashback {6}{B}{R} (You may cast this card from your graveyard for its flashback cost.
423. Fire Nation Attacks (EDHREC 8200) - Flashback {8}{R} (You may cast this card from your graveyard for its flashback cost.
424. Solstice Revelations (EDHREC 8264) - Flashback {6}{R} (You may cast this card from your graveyard for its flashback cost.
425. Mass Diminish (EDHREC 8429) - Flashback {3}{U} (You may cast this card from your graveyard for its flashback cost.
426. Sorceress's Schemes (EDHREC 8718) - Return target instant or sorcery card from your graveyard or exiled card with flashback you own to your hand.
427. Return the Past (EDHREC 8783) - During your turn, each instant and sorcery card in your graveyard has flashback.
428. Dreams of Laguna (EDHREC 8815) - Flashback {3}{U} (You may cast this card from your graveyard for its flashback cost.
429. Otterball Antics (EDHREC 8965) - Flashback {3}{U} (You may cast this card from your graveyard for its flashback cost.
430. Devil's Play (EDHREC 9264) - Flashback {X}{R}{R}{R} (You may cast this card from your graveyard for its flashback cost.
431. Increasing Savagery (EDHREC 9283) - Flashback {5}{G}{G} (You may cast this card from your graveyard for its flashback cost.
432. Sphinx of Forgotten Lore (EDHREC 9292) - Whenever this creature attacks, target instant or sorcery card in your graveyard gains flashback until end of turn.
433. Increasing Confusion (EDHREC 9471) - Flashback {X}{U} (You may cast this card from your graveyard for its flashback cost.
434. Rootcoil Creeper (EDHREC 9496) - {G}{U}, {T}, Exile this creature: Return target card with flashback you own from exile to your hand.
435. Vengeful Regrowth (EDHREC 9534) - Flashback {6}{G}{G} (You may cast this card from your graveyard for its flashback cost.
436. Dire-Strain Rampage (EDHREC 9658) - Flashback {3}{R}{G}
437. Scour All Possibilities (EDHREC 9898) - Flashback {4}{U} (You may cast this card from your graveyard for its flashback cost.
438. Gysahl Greens (EDHREC 9983) - Flashback {6}{G} (You may cast this card from your graveyard for its flashback cost.
439. Slickshot Lockpicker (EDHREC 10025) - When this creature enters, target instant or sorcery card in your graveyard gains flashback until end of turn.
### Unearth Cards

440. Molten Gatekeeper (EDHREC 1285) - Unearth {R} ({R}: Return this card from your graveyard to the battlefield.
441. Cityscape Leveler (EDHREC 2177) - Unearth {8}
442. Priest of Fell Rites (EDHREC 2730) - Unearth {3}{W}{B} ({3}{W}{B}: Return this card from your graveyard to the battlefield.
443. Terisian Mindbreaker (EDHREC 4443) - Unearth {1}{U}{U}{U} ({1}{U}{U}{U}: Return this card from your graveyard to the battlefield.
444. Fatestitcher (EDHREC 6176) - Unearth {U} ({U}: Return this card from your graveyard to the battlefield.
445. Salvation Colossus (EDHREC 6569) - Unearth—Pay eight {E}.
446. Chronomancer (EDHREC 7072) - Unearth {2}{B} ({2}{B}: Return this card from your graveyard to the battlefield.
447. Canoptek Tomb Sentinel (EDHREC 7276) - Unearth {7} ({7}: Return this card from your graveyard to the battlefield.
448. Skorpekh Lord (EDHREC 7491) - Unearth {2}{B} ({2}{B}: Return this card from your graveyard to the battlefield.
449. Phyrexian Dragon Engine (EDHREC 7678) - Unearth {3}{R}{R}
450. Rotting Rats (EDHREC 8131) - Unearth {1}{B} ({1}{B}: Return this card from your graveyard to the battlefield.
451. Mishra, Tamer of Mak Fawa (EDHREC 8446) - Each artifact card in your graveyard has unearth {1}{B}{R}.
452. Corpse Connoisseur (EDHREC 8551) - Unearth {3}{B} ({3}{B}: Return this card from your graveyard to the battlefield.
453. Triarch Praetorian (EDHREC 8581) - Unearth {4}{B} ({4}{B}: Return this card from your graveyard to the battlefield.
454. Kederekt Leviathan (EDHREC 9312) - Unearth {6}{U} ({6}{U}: Return this card from your graveyard to the battlefield.
455. Platoon Dispenser (EDHREC 9359) - Unearth {2}{W}{W}
456. Royal Warden (EDHREC 9762) - Unearth {3}{B} ({3}{B}: Return this card from your graveyard to the battlefield.
457. Simian Simulacrum (EDHREC 9899) - Unearth {2}{G}{G} ({2}{G}{G}: Return this card from your graveyard to the battlefield.
458. Dregscape Sliver (EDHREC 10195) - Each Sliver creature card in your graveyard has unearth {2}.
459. Lokhust Heavy Destroyer (EDHREC 10545) - Unearth {5}{B}{B}{B} ({5}{B}{B}{B}: Return this card from your graveyard to the battlefield.
460. Anathemancer (EDHREC 10676) - Unearth {5}{B}{R} ({5}{B}{R}: Return this card from your graveyard to the battlefield.
461. Solemn Doomguide (EDHREC 10790) - Each creature card in your graveyard that's a Cleric, Rogue, Warrior, and/or Wizard has unearth {1}{B}.
462. Sedris, the Traitor King (EDHREC 12027) - Each creature card in your graveyard has unearth {2}{B}.
463. Combat Courier (EDHREC 12500) - Unearth {U} ({U}: Return this card from your graveyard to the battlefield.
464. Meticulous Excavation (EDHREC 12639) - If it has unearth, instead exile it, then return that card to its owner's hand.
465. Ghost Ark (EDHREC 12907) - Repair Barge — Whenever this Vehicle becomes crewed, each artifact creature card in your graveyard gains unearth {3} until end of turn.
466. Scrapwork Mutt (EDHREC 13475) - Unearth {1}{R} ({1}{R}: Return this card from your graveyard to the battlefield.
467. Hexmark Destroyer (EDHREC 13774) - Unearth {4}{B}{B} ({4}{B}{B}: Return this card from your graveyard to the battlefield.
468. Archfiend of Sorrows (EDHREC 14142) - Unearth {3}{B}{B} ({3}{B}{B}: Return this card from your graveyard to the battlefield.
469. Extractor Demon (EDHREC 15634) - Unearth {2}{B} ({2}{B}: Return this card from your graveyard to the battlefield.
470. Tomb Blade (EDHREC 15730) - Unearth {6}{B}{B}
471. Vithian Stinger (EDHREC 16331) - Unearth {1}{R} ({1}{R}: Return this card from your graveyard to the battlefield.
472. Artificer's Dragon (EDHREC 17209) - Unearth {3}{R}{R} ({3}{R}{R}: Return this card from your graveyard to the battlefield.
473. Terror Ballista (EDHREC 17940) - Unearth {3}{B}{B} ({3}{B}{B}: Return this card from your graveyard to the battlefield.
474. Hellspark Elemental (EDHREC 18792) - Unearth {1}{R} ({1}{R}: Return this card from your graveyard to the battlefield.
475. First-Sphere Gargantua (EDHREC 18837) - Unearth {2}{B} ({2}{B}: Return this card from your graveyard to the battlefield.
476. Scrapwork Rager (EDHREC 19379) - Unearth {3}{B} ({3}{B}: Return this card from your graveyard to the battlefield.
477. Hell's Thunder (EDHREC 19383) - Unearth {4}{R} ({4}{R}: Return this card from your graveyard to the battlefield.
478. Sedraxis Specter (EDHREC 19558) - Unearth {1}{B} ({1}{B}: Return this card from your graveyard to the battlefield.
479. Yotian Frontliner (EDHREC 20223) - Unearth {W} ({W}: Return this card from your graveyard to the battlefield.
### Escape And Similar Graveyard Alternate Costs

480. Fanatic of Rhonas (EDHREC 478) - Eternalize {2}{G}{G} ({2}{G}{G}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a 4/4 black Zombie Snake Druid with no mana cost.
481. Quasiduplicate (EDHREC 3260) - Jump-start (You may cast this card from your graveyard by discarding a card in addition to paying its other costs.
482. Vizier of Many Faces (EDHREC 4196) - Embalm {3}{U}{U}
483. Kroxa, Titan of Death's Hunger (EDHREC 4640) - Escape—{B}{B}{R}{R}, Exile five other cards from your graveyard.
484. The Master of Keys (EDHREC 5085) - Each enchantment card in your graveyard has escape.
485. Throes of Chaos (EDHREC 5613) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
486. Formless Genesis (EDHREC 5640) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
487. Bloodbraid Challenger (EDHREC 6469) - Escape—{3}{R}{G}, Exile three other cards from your graveyard.
488. Champion of Wits (EDHREC 6767) - Eternalize {5}{U}{U} ({5}{U}{U}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a 4/4 black Zombie Snake Wizard with no mana cost.
489. Deeproot Historian (EDHREC 6772) - Merfolk and Druid cards in your graveyard have retrace.
490. Adorned Pouncer (EDHREC 6826) - Eternalize {3}{W}{W} ({3}{W}{W}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a 4/4 black Zombie Cat with no mana cost.
491. Chemister's Insight (EDHREC 7152) - Jump-start (You may cast this card from your graveyard by discarding a card in addition to paying its other costs.
492. Decaying Time Loop (EDHREC 7218) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
493. Radical Idea (EDHREC 7354) - Jump-start (You may cast this card from your graveyard by discarding a card in addition to paying its other costs.
494. Sentinel's Eyes (EDHREC 7429) - Escape—{W}, Exile two other cards from your graveyard.
495. Risk Factor (EDHREC 7817) - Jump-start (You may cast this card from your graveyard by discarding a card in addition to paying its other costs.
496. Sacred Cat (EDHREC 8225) - Embalm {W} ({W}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a white Zombie Cat with no mana cost.
497. Cursecloth Wrappings (EDHREC 8379) - {T}: Target creature card in your graveyard gains embalm until end of turn.
498. Phlage, Titan of Fire's Fury (EDHREC 8483) - Escape—{R}{R}{W}{W}, Exile five other cards from your graveyard.
499. Angel of Sanctions (EDHREC 8539) - Embalm {5}{W} ({5}{W}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a white Zombie Angel with no mana cost.
500. Timeless Dragon (EDHREC 8592) - Eternalize {2}{W}{W} ({2}{W}{W}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a 4/4 black Zombie Dragon with no mana cost.
501. Nethergoyf (EDHREC 8692) - Escape—{2}{B}, Exile any number of other cards from your graveyard with four or more card types among them.
502. The Grim Captain's Locker (EDHREC 8854) - {T}: Until end of turn, each creature card in your graveyard gains "Escape—{3}{B}, Exile four other cards from your graveyard." (You may cast a card with escape from your graveyard for its escape cost.)
503. Chainweb Aracnir (EDHREC 8900) - Escape—{3}{G}{G}, Exile four other cards from your graveyard.
504. Aven Wind Guide (EDHREC 8956) - Embalm {4}{W}{U} ({4}{W}{U}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a white Zombie Bird Warrior with no mana cost.
505. Ox of Agonas (EDHREC 9186) - Escape—{R}{R}, Exile eight other cards from your graveyard.
506. Gravitic Punch (EDHREC 9265) - Jump-start (You may cast this card from your graveyard by discarding a card in addition to paying its other costs.
507. Reality Scramble (EDHREC 9686) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
508. Waves of Aggression (EDHREC 10048) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
509. Spitting Image (EDHREC 10396) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
510. Worm Harvest (EDHREC 10620) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
511. Polukranos, Unchained (EDHREC 10725) - Escape—{4}{B}{G}, Exile six other cards from your graveyard.
512. Charred Graverobber (EDHREC 10845) - Escape—{3}{B}{B}, Exile four other cards from your graveyard.
513. Anointer Priest (EDHREC 11010) - Embalm {3}{W} ({3}{W}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a white Zombie Human Cleric with no mana cost.
514. Beacon Bolt (EDHREC 11247) - Jump-start (You may cast this card from your graveyard by discarding a card in addition to paying its other costs.
515. Dihada's Ploy (EDHREC 11467) - Jump-start (You may cast this card from your graveyard by discarding a card in addition to paying its other costs.
516. Flame Jab (EDHREC 11487) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
517. Chronomantic Escape (EDHREC 11526) - Exile Chronomantic Escape with three time counters on it.
518. Run for Your Life (EDHREC 11805) - Escape—{2}{U}{R}, Exile four other cards from your graveyard.
519. Start the TARDIS (EDHREC 12683) - Jump-start (You may cast this card from your graveyard by discarding a card in addition to paying its other costs.
520. Niv-Mizzet, Supreme (EDHREC 13128) - Each instant and sorcery card in your graveyard that's exactly two colors has jump-start.
521. Elspeth, Sun's Nemesis (EDHREC 13700) - Escape—{4}{W}{W}, Exile four other cards from your graveyard.
522. Filigree Racer (EDHREC 13992) - When you do, target instant or sorcery card in your graveyard gains jump-start until end of turn.
523. Glamerdye (EDHREC 14533) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
524. Raven's Crime (EDHREC 14853) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
525. Oona's Grace (EDHREC 15070) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
526. Dreamstealer (EDHREC 15389) - Eternalize {4}{B}{B} ({4}{B}{B}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a 4/4 black Zombie Human Wizard with no mana cost.
527. Skyway Robber (EDHREC 15470) - Escape—{3}{U}, Exile five other cards from your graveyard.
528. Lunar Hatchling (EDHREC 15735) - Escape—{4}{G}{U}, Exile a land you control, Exile five other cards from your graveyard.
529. Phoenix of Ash (EDHREC 15827) - Escape—{2}{R}{R}, Exile three other cards from your graveyard.
530. Escape Velocity (EDHREC 16512) - Escape—{1}{R}, Exile two other cards from your graveyard.
531. Honored Hydra (EDHREC 16608) - Embalm {3}{G} ({3}{G}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a white Zombie Snake Hydra with no mana cost.
532. Maximize Velocity (EDHREC 17248) - Jump-start (You may cast this card from your graveyard by discarding a card in addition to paying its other costs.
533. Satyr's Cunning (EDHREC 17669) - Escape—{2}{R}, Exile two other cards from your graveyard.
534. Heart-Piercer Manticore (EDHREC 18094) - Embalm {5}{R} ({5}{R}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a white Zombie Manticore with no mana cost.
### Cast From Graveyard Permission Windows (Overflow)

535. Zul Ashur, Lich Lord (EDHREC 3044) - {T}: You may cast target Zombie creature card from your graveyard this turn.
536. Chameleon, Master of Disguise (EDHREC 3258) - Mayhem {2}{U} (You may cast this card from your graveyard for {2}{U} if you discarded it this turn.
537. Gisa and Geralf (EDHREC 3639) - Once during each of your turns, you may cast a Zombie creature spell from your graveyard.
538. Vohar, Vodalian Desecrator (EDHREC 3834) - {2}, Sacrifice Vohar: You may cast target instant or sorcery card from your graveyard this turn.
539. Emet-Selch of the Third Seat (EDHREC 3838) - Whenever one or more opponents lose life, you may cast target instant or sorcery card from your graveyard.
540. Restart Sequence (EDHREC 4187) - Freerunning {1}{B} (You may cast this spell for its freerunning cost if you dealt combat damage to a player this turn with an Assassin or commander.) Return target creature card from your graveyard to the battlefield.
541. Sword of Once and Future (EDHREC 4362) - Then you may cast an instant or sorcery spell with mana value 2 or less from your graveyard without paying its mana cost.
542. Danitha, New Benalia's Light (EDHREC 4585) - Once during each of your turns, you may cast an Aura or Equipment spell from your graveyard.
543. Invoke Calamity (EDHREC 4631) - You may cast up to two instant and/or sorcery spells with total mana value 6 or less from your graveyard and/or hand without paying their mana costs.
544. Squee, Dubious Monarch (EDHREC 4739) - You may cast this card from your graveyard by paying {3}{R} and exiling four other cards from your graveyard rather than paying its mana cost.
545. Aurora Phoenix (EDHREC 4795) - Flying Cascade (When you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom in a ...
546. Gale, Waterdeep Prodigy (EDHREC 4915) - Whenever you cast an instant or sorcery spell from your hand, you may cast up to one target card of the other type from your graveyard.
547. Finale of Promise (EDHREC 4941) - You may cast up to one target instant card and/or up to one target sorcery card from your graveyard each with mana value X or less without paying their mana costs.
548. Chandra, Acolyte of Flame (EDHREC 5491) - −2: You may cast target instant or sorcery card with mana value 3 or less from your graveyard.
549. Case of the Uneaten Feast (EDHREC 5529) - Solved — Sacrifice this Case: Creature cards in your graveyard gain "You may cast this card from your graveyard" until end of turn.
550. Kaya the Inexorable (EDHREC 5560) - −7: You get an emblem with "At the beginning of your upkeep, you may cast a legendary spell from your hand, from your graveyard, or from among cards you own in exile without paying its mana cost."
551. Osteomancer Adept (EDHREC 5749) - {T}: Until end of turn, you may cast creature spells from your graveyard by foraging in addition to paying their other costs.
552. Oathsworn Vampire (EDHREC 5899) - You may cast this card from your graveyard if you gained life this turn.
553. Timeline Culler (EDHREC 6390) - You may cast this card from your graveyard using its warp ability.
554. Haakon, Stromgald Scourge (EDHREC 6399) - You may cast this card from your graveyard, but not from anywhere else.
555. Ebondeath, Dracolich (EDHREC 6477) - You may cast this card from your graveyard if a creature not named Ebondeath, Dracolich died this turn.
556. Winternight Stories (EDHREC 6704) - Harmonize {4}{U} (You may cast this card from your graveyard for its harmonize cost.
557. Liliana, Untouched by Death (EDHREC 6886) - −3: You may cast Zombie spells from your graveyard this turn.
558. Demonic Embrace (EDHREC 7014) - You may cast this card from your graveyard by paying 3 life and discarding a card in addition to paying its other costs.
559. Wild Ride (EDHREC 7077) - Harmonize {4}{R} (You may cast this card from your graveyard for its harmonize cost.
### Your Graveyard To Hand (Overflow)

560. Boneyard Lurker (EDHREC 7412) - Whenever this creature mutates, return target permanent card from your graveyard to your hand.
561. Soul Manipulation (EDHREC 7627) - • Return target creature card from your graveyard to your hand.
562. Tamiyo, Collector of Tales (EDHREC 7634) - −3: Return target card from your graveyard to your hand.
563. Ardent Elementalist (EDHREC 7657) - When this creature enters, return target instant or sorcery card from your graveyard to your hand.
564. Petrified Field (EDHREC 7669) - {T}, Sacrifice this land: Return target land card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

565. Dreadhorde Arcanist (EDHREC 7697) - Whenever this creature attacks, you may cast target instant or sorcery card with mana value less than or equal to this creature's power from your graveyard without paying its mana cost.
566. Kotis, Sibsig Champion (EDHREC 7710) - Once during each of your turns, you may cast a creature spell from your graveyard by exiling three other cards from your graveyard in addition to paying its other costs.
567. Roamer's Routine (EDHREC 7739) - Harmonize {4}{G} (You may cast this card from your graveyard for its harmonize cost.
568. Brokkos, Apex of Forever (EDHREC 7777) - You may cast this card from your graveyard using its mutate ability.
### Your Graveyard To Hand (Overflow)

569. Golgari Findbroker (EDHREC 8078) - When this creature enters, return target permanent card from your graveyard to your hand.
570. Circle of the Land Druid (EDHREC 8159) - Natural Recovery — When this creature dies, return target land card from your graveyard to your hand.
571. Raise the Draugr (EDHREC 8207) - • Return target creature card from your graveyard to your hand.
572. Elvish Regrower (EDHREC 8234) - When this creature enters, return target permanent card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

573. Impulsivity (EDHREC 8258) - When this creature enters, you may cast target instant or sorcery card from a graveyard without paying its mana cost. If that spell would be put into a graveyard, exile it instead. Encore {7}{R}{R} ({7}{R}{R}, Exile t...
574. Jaya Ballard (EDHREC 8392) - −8: You get an emblem with "You may cast instant and sorcery spells from your graveyard.
### Your Graveyard To Hand (Overflow)

575. Bygone Marvels (EDHREC 8521) - Return target permanent card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

576. Their Number Is Legion (EDHREC 8545) - You may cast this card from your graveyard.
### Your Graveyard To Hand (Overflow)

577. You Happen On a Glade (EDHREC 8561) - • Make Camp — Return target permanent card from your graveyard to your hand.
578. Shipwreck Dowser (EDHREC 8576) - When this creature enters, return target instant or sorcery card from your graveyard to your hand.
579. Gravedigger (EDHREC 8617) - When this creature enters, you may return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

580. Detective's Phoenix (EDHREC 8645) - You may cast this card from your graveyard using its bestow ability.
### Your Graveyard To Hand (Overflow)

581. Edgewall Inn (EDHREC 8746) - {3}, {T}, Sacrifice this land: Return target card that has an Adventure from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

582. Daring Waverider (EDHREC 8777) - When this creature enters, you may cast target instant or sorcery card with mana value 4 or less from your graveyard without paying its mana cost.
### Your Graveyard To Hand (Overflow)

583. Jared Carthalion (EDHREC 8817) - −6: Return target multicolored card from your graveyard to your hand.
584. Disentomb (EDHREC 8823) - Return target creature card from your graveyard to your hand.
585. Krile Baldesion (EDHREC 8874) - Trace Aether — Whenever you cast a noncreature spell, you may return target creature card with mana value equal to that spell's mana value from your graveyard to your hand.
586. Myr Reservoir (EDHREC 8892) - {3}, {T}: Return target Myr card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

587. Noctis, Prince of Lucis (EDHREC 8939) - You may cast artifact spells from your graveyard by paying 3 life in addition to paying their other costs.
### Your Graveyard To Hand (Overflow)

588. Neva, Stalked by Nightmares (EDHREC 8964) - When Neva enters, return target creature or enchantment card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

589. Scourge of Nel Toth (EDHREC 8976) - You may cast this creature from your graveyard by paying {B}{B} and sacrificing two creatures rather than paying its mana cost.
### Your Graveyard To Hand (Overflow)

590. Ravos, Soultender (EDHREC 9012) - At the beginning of your upkeep, you may return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

591. Heiko Yamazaki, the General (EDHREC 9015) - Whenever a Samurai or Warrior you control attacks alone, you may cast target artifact card from your graveyard this turn.
592. Ultimate Green Goblin (EDHREC 9107) - Mayhem {2}{B/R} (You may cast this card from your graveyard for {2}{B/R} if you discarded it this turn.
### Your Graveyard To Hand (Overflow)

593. Raise Dead (EDHREC 9116) - Return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

594. Counterpoint (EDHREC 9169) - You may cast a creature, instant, sorcery, or planeswalker spell from your graveyard with mana value less than or equal to that spell's mana value without paying its mana cost.
595. Diviner of Mist (EDHREC 9183) - You may cast an instant or sorcery spell from your graveyard with mana value 4 or less without paying its mana cost.
### Your Graveyard To Hand (Overflow)

596. Glissa, the Traitor (EDHREC 9207) - Whenever a creature an opponent controls dies, you may return target artifact card from your graveyard to your hand.
597. Curious Forager (EDHREC 9369) - When you do, return target permanent card from your graveyard to your hand.
598. Groundskeeper (EDHREC 9371) - {1}{G}: Return target basic land card from your graveyard to your hand.
599. Otrimi, the Ever-Playful (EDHREC 9491) - Whenever this creature deals combat damage to a player, return target creature card with mutate from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

600. Goblin Dark-Dwellers (EDHREC 9552) - When this creature enters, you may cast target instant or sorcery card with mana value 3 or less from your graveyard without paying its mana cost.
### Your Graveyard To Hand (Overflow)

601. Dawn-Blessed Pennant (EDHREC 9579) - {2}, {T}, Sacrifice this artifact: Return target card of the chosen type from your graveyard to your hand.
602. Cadaver Imp (EDHREC 9584) - When this creature enters, you may return target creature card from your graveyard to your hand.
603. March of the Drowned (EDHREC 9600) - • Return target creature card from your graveyard to your hand.
604. The Binding of the Titans (EDHREC 9727) - III — Return target creature or land card from your graveyard to your hand.
605. Road of Return (EDHREC 9822) - • Return target permanent card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

606. Karador, Ghost Chieftain (EDHREC 9842) - Once during each of your turns, you may cast a creature spell from your graveyard.
607. Hogaak, Arisen Necropolis (EDHREC 9915) - You may cast this card from your graveyard.
608. Mavinda, Students' Advocate (EDHREC 9967) - {0}: You may cast target instant or sorcery card from your graveyard this turn.
609. Scholar of the Lost Trove (EDHREC 9989) - When this creature enters, you may cast target instant, sorcery, or artifact card from your graveyard without paying its mana cost.
610. Mystical Teachings (EDHREC 10119) - Flashback {5}{B} (You may cast this card from your graveyard for its flashback cost.
611. Tenacious Underdog (EDHREC 10150) - You may cast this card from your graveyard using its blitz ability.
612. Increasing Ambition (EDHREC 10183) - Flashback {7}{B} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

613. Verdant Confluence (EDHREC 10205) - • Return target permanent card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

614. Self-Reflection (EDHREC 10209) - Flashback {3}{U} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

615. Treasured Find (EDHREC 10254) - Return target card from your graveyard to your hand.
616. Call to Mind (EDHREC 10271) - Return target instant or sorcery card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

617. Norika Yamazaki, the Poet (EDHREC 10274) - Whenever a Samurai or Warrior you control attacks alone, you may cast target enchantment card from your graveyard this turn.
618. March from Velis Vel (EDHREC 10339) - Flashback {4}{U} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

619. Argivian Find (EDHREC 10342) - Return target artifact or enchantment card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

620. Edgar, Master Machinist (EDHREC 10379) - Once during each of your turns, you may cast an artifact spell from your graveyard.
### Your Graveyard To Hand (Overflow)

621. Elder Owyn Lyons (EDHREC 10395) - When Elder Owyn Lyons enters or dies, return target artifact card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

622. Inspiration from Beyond (EDHREC 10410) - Flashback {5}{U}{U} (You may cast this card from your graveyard for its flashback cost.
### Flashback Cards (Overflow)

623. Memories Returning (EDHREC 10414) - Flashback {7}{U}{U}
### Cast From Graveyard Permission Windows (Overflow)

624. Unnatural Moonrise (EDHREC 10465) - Flashback {2}{R}{G} (You may cast this card from your graveyard for its flashback cost.
625. Arcade Gannon (EDHREC 10469) - For Auld Lang Syne — Once during each of your turns, you may cast an artifact or Human spell from your graveyard with mana value less than or equal to the number of quest counters on Arcade Gannon.
626. Unending Whisper (EDHREC 10497) - Harmonize {5}{U} (You may cast this card from your graveyard for its harmonize cost.
### Your Graveyard To Hand (Overflow)

627. Imperial Recovery Unit (EDHREC 10576) - Whenever this Vehicle attacks, return target creature or Vehicle card with mana value 2 or less from your graveyard to your hand.
628. Emergency Weld (EDHREC 10674) - Return target artifact or creature card from your graveyard to your hand.
629. Crawl from the Cellar (EDHREC 10739) - Return target creature card from your graveyard to your hand.
630. Kirri, Talented Sprout (EDHREC 10761) - At the beginning of each of your postcombat main phases, return target Plant, Treefolk, or land card from your graveyard to your hand.
631. Ozox, the Clattering King (EDHREC 10788) - When Ozox dies, create Jumblebones, a legendary 2/1 black Skeleton creature token with "Jumblebones can't block" and "When Jumblebones leaves the battlefield, return target card named Ozox, the Clattering King from your graveyard to your hand."
632. Zuko's Conviction (EDHREC 10792) - Return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

633. Wishing Well (EDHREC 10865) - When you do, you may cast target instant or sorcery card with mana value equal to the number of coin counters on this artifact from your graveyard without paying its mana cost.
### Your Graveyard To Hand (Overflow)

634. Braids's Frightful Return (EDHREC 10925) - II — Return target creature card from your graveyard to your hand.
635. Cemetery Recruitment (EDHREC 10956) - Return target creature card from your graveyard to your hand.
636. Lore Drakkis (EDHREC 10975) - Whenever this creature mutates, return target instant or sorcery card from your graveyard to your hand.
637. Undertaker (EDHREC 10985) - {B}, {T}, Discard a card: Return target creature card from your graveyard to your hand.
638. Auriok Salvagers (EDHREC 10991) - {1}{W}: Return target artifact card with mana value 1 or less from your graveyard to your hand.
639. Return from Extinction (EDHREC 11069) - • Return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

640. Festival of Embers (EDHREC 11162) - During your turn, you may cast instant and sorcery spells from your graveyard by paying 1 life in addition to their other costs.
### Your Graveyard To Hand (Overflow)

641. Season of Renewal (EDHREC 11215) - • Return target creature card from your graveyard to your hand.
642. Chakra Meditation (EDHREC 11224) - When this enchantment enters, return up to one target instant or sorcery card from your graveyard to your hand.
643. Corpse Cur (EDHREC 11299) - When this creature enters, you may return target creature card with infect from your graveyard to your hand.
644. Fates' Reversal (EDHREC 11306) - Return up to one target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

645. Seifer Almasy (EDHREC 11335) - Fire Cross — Whenever Seifer Almasy deals combat damage to a player, you may cast target instant or sorcery card with mana value 3 or less from your graveyard without paying its mana cost.
### Your Graveyard To Hand (Overflow)

646. Paleoloth (EDHREC 11368) - Whenever another creature you control with power 5 or greater enters, you may return target creature card from your graveyard to your hand.
647. Edgar's Awakening (EDHREC 11434) - When you do, return target creature card from your graveyard to your hand.
648. Healing Technique (EDHREC 11495) - Return target card from your graveyard to your hand.
649. Courier Bat (EDHREC 11513) - When this creature enters, if you gained life this turn, return up to one target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

650. Arcane Infusion (EDHREC 11535) - Flashback {3}{U}{R} (You may cast this card from your graveyard for its flashback cost.
651. Turn the Earth (EDHREC 11614) - Flashback {1}{G} (You may cast this card from your graveyard for its flashback cost.
652. Synchronized Charge (EDHREC 11626) - Harmonize {4}{G} (You may cast this card from your graveyard for its harmonize cost.
### Your Graveyard To Hand (Overflow)

653. Unbury (EDHREC 11630) - • Return target creature card from your graveyard to your hand.
654. Walk with the Ancestors (EDHREC 11651) - Return up to one target permanent card from your graveyard to your hand.
655. Dross Skullbomb (EDHREC 11669) - {2}{B}, Sacrifice this artifact: Return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

656. Dream Twist (EDHREC 11676) - Flashback {1}{U} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

657. Wort, Boggart Auntie (EDHREC 11706) - At the beginning of your upkeep, you may return target Goblin card from your graveyard to your hand.
658. Revolutionist (EDHREC 11708) - When this creature enters, return target instant or sorcery card from your graveyard to your hand.
659. Aid the Fallen (EDHREC 11800) - • Return target creature card from your graveyard to your hand.
660. Gravedig (EDHREC 11804) - • Return target creature card from your graveyard to your hand.
661. Omen of the Dead (EDHREC 11827) - When this enchantment enters, return target creature card from your graveyard to your hand.
662. Wretched Confluence (EDHREC 11828) - • Return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

663. Parallel Evolution (EDHREC 11837) - Flashback {4}{G}{G}{G} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

664. The Mirari Conjecture (EDHREC 11851) - I — Return target instant card from your graveyard to your hand.
665. Professor Zei, Anthropologist (EDHREC 11856) - {1}, {T}, Sacrifice Professor Zei: Return target instant or sorcery card from your graveyard to your hand.
666. Ironclad Slayer (EDHREC 11876) - When this creature enters, you may return target Aura or Equipment card from your graveyard to your hand.
667. Urborg Repossession (EDHREC 11897) - Return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

668. Chandra, Flame's Catalyst (EDHREC 11898) - −2: You may cast target red instant or sorcery card from your graveyard.
### Your Graveyard To Hand (Overflow)

669. Soul Transfer (EDHREC 11921) - • Return target creature or planeswalker card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

670. Diregraf Rebirth (EDHREC 11938) - Flashback {5}{B}{G} (You may cast this card from your graveyard for its flashback cost.
### Flashback Cards (Overflow)

671. Quiet Speculation (EDHREC 11970) - Search target player's library for up to three cards with flashback and put them into that player's graveyard.
### Cast From Graveyard Permission Windows (Overflow)

672. Acorn Harvest (EDHREC 11986) - (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

673. Badlands Revival (EDHREC 12029) - Return up to one target permanent card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

674. Sabin, Master Monk (EDHREC 12049) - You may cast this card from your graveyard using its blitz ability.
675. Prison Break (EDHREC 12132) - Mayhem {3}{B} (You may cast this card from your graveyard for {3}{B} if you discarded it this turn.
### Your Graveyard To Hand (Overflow)

676. Trusty Retriever (EDHREC 12148) - • Return target artifact or enchantment card from your graveyard to your hand.
677. Nature's Spiral (EDHREC 12156) - Return target permanent card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

678. Join the Dance (EDHREC 12167) - Flashback {3}{G}{W} (You may cast this card from your graveyard for its flashback cost.
679. Marang River Prowler (EDHREC 12184) - You may cast this card from your graveyard as long as you control a black or green permanent.
680. From Father to Son (EDHREC 12233) - Flashback {4}{W}{W}{W} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

681. Revive (EDHREC 12251) - Return target green card from your graveyard to your hand.
682. Tombstone, Career Criminal (EDHREC 12265) - When Tombstone enters, return target Villain card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

683. Toshiro Umezawa (EDHREC 12266) - Whenever a creature an opponent controls dies, you may cast target instant card from your graveyard.
### Your Graveyard To Hand (Overflow)

684. Fortuitous Find (EDHREC 12300) - • Return target artifact card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

685. Prismatic Strands (EDHREC 12333) - (You may cast this card from your graveyard for its flashback cost.
### Flashback Cards (Overflow)

686. Flash Photography (EDHREC 12338) - Flashback {4}{U}{U}
### Your Graveyard To Hand (Overflow)

687. Mourner's Surprise (EDHREC 12497) - Return up to one target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

688. Archmage's Newt (EDHREC 12498) - (You may cast that card from your graveyard for its flashback cost.
689. Alien Symbiosis (EDHREC 12514) - You may cast this card from your graveyard by discarding a card in addition to paying its other costs.
### Your Graveyard To Hand (Overflow)

690. Pyretic Rebirth (EDHREC 12536) - Return target artifact or creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

691. Vadrok, Apex of Thunder (EDHREC 12584) - Whenever this creature mutates, you may cast target noncreature card with mana value 3 or less from your graveyard without paying its mana cost.
692. Abandoned Sarcophagus (EDHREC 12608) - You may cast spells that have a cycling ability from your graveyard.
### Flashback Cards (Overflow)

693. Secrets of the Key (EDHREC 12650) - Flashback {3}{U}
### Cast From Graveyard Permission Windows (Overflow)

694. Lightwheel Enhancements (EDHREC 12659) - Max speed — You may cast this card from your graveyard.
### Your Graveyard To Hand (Overflow)

695. Blood Beckoning (EDHREC 12673) - Return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

696. Rona, Sheoldred's Faithful (EDHREC 12706) - You may cast this card from your graveyard by discarding two cards in addition to paying its other costs.
697. Wurmquake (EDHREC 12740) - Flashback {8}{G}{G} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

698. Repository Skaab (EDHREC 12795) - When this creature exploits a creature, return target instant or sorcery card from your graveyard to your hand.
699. Ghoulcaller's Chant (EDHREC 12803) - • Return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

700. Undead Sprinter (EDHREC 12836) - You may cast this card from your graveyard if a non-Zombie creature died this turn.
701. Songcrafter Mage (EDHREC 12838) - (You may cast that card from your graveyard for its harmonize cost.
### Flashback Cards (Overflow)

702. Catalyst Stone (EDHREC 12840) - Flashback costs you pay cost {2} less.
### Your Graveyard To Hand (Overflow)

703. Loran, Disciple of History (EDHREC 12858) - Whenever Loran or another legendary creature you control enters, return target artifact card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

704. Defy Gravity (EDHREC 12922) - Flashback {U} (You may cast this card from your graveyard for its flashback cost.
705. Memory's Journey (EDHREC 12961) - Flashback {G} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

706. Recollect (EDHREC 13024) - Return target card from your graveyard to your hand.
707. Restoration Specialist (EDHREC 13030) - {W}, Sacrifice this creature: Return up to one target artifact card and up to one target enchantment card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

708. Founding the Third Path (EDHREC 13044) - Read ahead (Choose a chapter and start with that many lore counters. Add one after your draw step. Skipped chapters don't trigger. Sacrifice after III.) I — You may cast an instant or sorcery spell with mana value 1 o...
### Your Graveyard To Hand (Overflow)

709. Crop Sigil (EDHREC 13053) - Delirium — {2}{G}, Sacrifice this enchantment: Return up to one target creature card and up to one target land card from your graveyard to your hand.
710. Coati Scavenger (EDHREC 13133) - Descend 4 — When this creature enters, if there are four or more permanent cards in your graveyard, return target permanent card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

711. Recoup (EDHREC 13142) - Flashback {3}{R} (You may cast this card from your graveyard for its flashback cost.
712. Shattered Perception (EDHREC 13154) - Flashback {5}{R} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

713. Lie in Wait (EDHREC 13187) - Return target creature card from your graveyard to your hand.
714. Liliana, Death Mage (EDHREC 13195) - +1: Return up to one target creature card from your graveyard to your hand.
715. Angel of Flight Alabaster (EDHREC 13209) - At the beginning of your upkeep, return target Spirit card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

716. Scarlet Spider, Kaine (EDHREC 13226) - Mayhem {B/R} (You may cast this card from your graveyard for {B/R} if you discarded it this turn.
717. Sacred Fire (EDHREC 13315) - Flashback {4}{R}{W} (You may cast this card from your graveyard for its flashback cost.
718. The Fugitive Doctor (EDHREC 13497) - (You may cast that card from your graveyard for its flashback cost.
719. Ninja Teen (EDHREC 13553) - You may cast creature spells from your graveyard using their sneak abilities.
720. Glacial Dragonhunt (EDHREC 13556) - Harmonize {4}{U}{R} (You may cast this card from your graveyard for its harmonize cost.
721. Call the Mountain Chocobo (EDHREC 13697) - Flashback {5}{R} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

722. Recover (EDHREC 13703) - Return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

723. Feeling of Dread (EDHREC 13721) - Flashback {1}{U} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

724. Once and Future (EDHREC 13741) - Return target card from your graveyard to your hand.
725. Salvager of Secrets (EDHREC 13804) - When this creature enters, return target instant or sorcery card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

726. Chainer's Edict (EDHREC 13862) - Flashback {5}{B}{B} (You may cast this card from your graveyard for its flashback cost.
727. Swarm, Being of Bees (EDHREC 13866) - Mayhem {B} (You may cast this card from your graveyard for {B} if you discarded it this turn.
### Your Graveyard To Hand (Overflow)

728. Super Mutant Scavenger (EDHREC 13888) - When this creature enters or dies, return up to one target Aura or Equipment card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

729. The Final Days (EDHREC 13890) - Flashback {4}{B}{B} (You may cast this card from your graveyard for its flashback cost.
730. Silent Departure (EDHREC 13897) - Flashback {4}{U} (You may cast this card from your graveyard for its flashback cost.
731. Electro's Bolt (EDHREC 13933) - Mayhem {1}{R} (You may cast this card from your graveyard for {1}{R} if you discarded it this turn.
### Your Graveyard To Hand (Overflow)

732. Skeleton Shard (EDHREC 13953) - {3}, {T} or {B}, {T}: Return target artifact creature card from your graveyard to your hand.
733. Interceptor Mechan (EDHREC 14051) - When this creature enters, return target artifact or creature card from your graveyard to your hand.
734. Maestros Confluence (EDHREC 14058) - • Return target monocolored instant or sorcery card from your graveyard to your hand.
735. Mirkwood Elk (EDHREC 14109) - Whenever this creature enters or attacks, return target Elf card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

736. Glimpse the Cosmos (EDHREC 14208) - As long as you control a Giant, you may cast this card from your graveyard by paying {U} rather than paying its mana cost.
737. Seize the Storm (EDHREC 14214) - Flashback {6}{R} (You may cast this card from your graveyard for its flashback cost.
738. Hallowed Respite (EDHREC 14267) - Flashback {1}{W}{U} (You may cast this card from your graveyard for its flashback cost.
739. Lost in Memories (EDHREC 14376) - The flashback cost is equal to its mana cost." (You may cast that card from your graveyard for its flashback cost.
740. Storm the Festival (EDHREC 14382) - Flashback {7}{G}{G}{G} (You may cast this card from your graveyard for its flashback cost.
741. Me, the Immortal (EDHREC 14426) - You may cast this card from your graveyard by discarding two cards in addition to paying its other costs.
742. Risen Executioner (EDHREC 14439) - You may cast this creature from your graveyard if you pay {1} more to cast it for each other creature card in your graveyard.
### Your Graveyard To Hand (Overflow)

743. Retrieve (EDHREC 14538) - Return up to one target creature card and up to one target noncreature permanent card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

744. Efreet Flamepainter (EDHREC 14607) - Whenever this creature deals combat damage to a player, you may cast target instant or sorcery card from your graveyard without paying its mana cost.
### Your Graveyard To Hand (Overflow)

745. Shreds of Sanity (EDHREC 14623) - Return up to one target instant card and up to one target sorcery card from your graveyard to your hand, then discard a card.
746. Reborn Hope (EDHREC 14634) - Return target multicolored card from your graveyard to your hand.
747. Nimraiser Paladin (EDHREC 14688) - When this creature enters, return target creature card with mana value 3 or less from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

748. Path to the Festival (EDHREC 14782) - Flashback {4}{G} (You may cast this card from your graveyard for its flashback cost.
749. Desperate Ravings (EDHREC 14828) - Flashback {2}{U} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

750. Grim Discovery (EDHREC 14907) - • Return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

751. Cabal Therapy (EDHREC 14941) - (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

752. Shepherd of the Clouds (EDHREC 14959) - When this creature enters, return target permanent card with mana value 3 or less from your graveyard to your hand.
753. Cruel Revival (EDHREC 15020) - Return up to one target Zombie card from your graveyard to your hand.
754. Lethal Protection (EDHREC 15034) - Return up to one target creature card from your graveyard to your hand.
755. Archaeomender (EDHREC 15095) - When this creature enters, return target artifact card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

756. Crush of Wurms (EDHREC 15105) - Flashback {9}{G}{G}{G} (You may cast this card from your graveyard for its flashback cost.
757. Firebolt (EDHREC 15118) - Flashback {4}{R} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

758. Boggart Birth Rite (EDHREC 15168) - Return target Goblin card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

759. Sproutback Trudge (EDHREC 15217) - At the beginning of your end step, if you gained life this turn, you may cast this creature from your graveyard.
### Your Graveyard To Hand (Overflow)

760. Pull from the Deep (EDHREC 15237) - Return up to one target instant card and up to one target sorcery card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

761. Geistflame (EDHREC 15309) - Flashback {3}{R} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

762. Vampire Soulcaller (EDHREC 15321) - When this creature enters, return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

763. Gnaw to the Bone (EDHREC 15363) - Flashback {2}{G} (You may cast this card from your graveyard for its flashback cost.
764. Arcane Proxy (EDHREC 15367) - Prototype {1}{U}{U} — 2/1 (You may cast this spell with different mana cost, color, and size. It keeps its abilities and types.) When this creature enters, if you cast it, exile target instant or sorcery card with man...
765. Alter Reality (EDHREC 15374) - Flashback {1}{U} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

766. Halimar Tidecaller (EDHREC 15418) - When this creature enters, you may return target card with awaken from your graveyard to your hand.
767. Liliana, the Necromancer (EDHREC 15426) - −1: Return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

768. Firecat Blitz (EDHREC 15508) - (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

769. Damage Control Crew (EDHREC 15568) - • Repair — Return target card with mana value 4 or greater from your graveyard to your hand.
770. Remember the Fallen (EDHREC 15592) - • Return target creature card from your graveyard to your hand.
771. Treasury Thrull (EDHREC 15596) - Whenever this creature attacks, you may return target artifact, creature, or enchantment card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

772. Demilich (EDHREC 15629) - You may cast this card from your graveyard by exiling four instant and/or sorcery cards from your graveyard in addition to paying its other costs.
773. Maestros Ascendancy (EDHREC 15636) - Once during each of your turns, you may cast an instant or sorcery spell from your graveyard by sacrificing a creature in addition to paying its other costs.
774. Sandman's Quicksand (EDHREC 15643) - Mayhem {3}{B} (You may cast this card from your graveyard for {3}{B} if you discarded it this turn.
775. Raging Goblinoids (EDHREC 15704) - Mayhem {2}{R} (You may cast this card from your graveyard for {2}{R} if you discarded it this turn.
776. Viral Spawning (EDHREC 15777) - (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

777. Sanctum Gargoyle (EDHREC 15848) - When this creature enters, you may return target artifact card from your graveyard to your hand.
778. All Suns' Dawn (EDHREC 15878) - For each color, return up to one target card of that color from your graveyard to your hand.
779. Kraven's Last Hunt (EDHREC 15896) - III — Return target creature card from your graveyard to your hand.
780. Eternal Taskmaster (EDHREC 15938) - If you do, return target creature card from your graveyard to your hand.
781. Resourceful Return (EDHREC 15969) - Return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

782. Katilda and Lier (EDHREC 16032) - (You may cast that card from your graveyard for its flashback cost.
783. Harness the Storm (EDHREC 16067) - Whenever you cast an instant or sorcery spell from your hand, you may cast target card with the same name as that spell from your graveyard.
### Your Graveyard To Hand (Overflow)

784. Tragic Poet (EDHREC 16107) - {T}, Sacrifice this creature: Return target enchantment card from your graveyard to your hand.
785. Relearn (EDHREC 16148) - Return target instant or sorcery card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

786. Syrix, Carrier of the Flame (EDHREC 16165) - Whenever another Phoenix you control dies, you may cast this card from your graveyard.
787. Skaab Ruinator (EDHREC 16181) - You may cast this card from your graveyard.
788. Rite of the Moth (EDHREC 16182) - Flashback {3}{W}{W}{B} (You may cast this card from your graveyard for its flashback cost.
789. Volcanic Spray (EDHREC 16191) - Flashback {1}{R} (You may cast this card from your graveyard for its flashback cost.
790. Random Encounter (EDHREC 16235) - Flashback {6}{R}{R} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

791. Karai, Future of the Foot (EDHREC 16243) - Whenever Karai deals combat damage to a player, return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

792. Visions of Duplicity (EDHREC 16275) - (You may cast this card from your graveyard for its flashback cost.
793. Deep Reconnaissance (EDHREC 16346) - Flashback {4}{G} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

794. Monk Idealist (EDHREC 16355) - When this creature enters, return target enchantment card from your graveyard to your hand.
795. Savior of the Small (EDHREC 16374) - Survival — At the beginning of your second main phase, if this creature is tapped, return target creature card with mana value 3 or less from your graveyard to your hand.
796. Vexing Scuttler (EDHREC 16385) - When you cast this spell, you may return target instant or sorcery card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

797. Channeled Dragonfire (EDHREC 16401) - Harmonize {5}{R}{R} (You may cast this card from your graveyard for its harmonize cost.
798. Can't Stay Away (EDHREC 16418) - Flashback {3}{W}{B} (You may cast this card from your graveyard for its flashback cost.
799. Kindle the Inner Flame (EDHREC 16477) - (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

800. Dundoolin Weaver (EDHREC 16504) - When this creature enters, if you control three or more creatures, return target permanent card from your graveyard to your hand.
801. Phyrexian Missionary (EDHREC 16528) - When this creature enters, if it was kicked, return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

802. Homestead Courage (EDHREC 16553) - Flashback {W} (You may cast this card from your graveyard for its flashback cost.
803. Visions of Dread (EDHREC 16720) - (You may cast this card from your graveyard for its flashback cost.
804. Abandon the Post (EDHREC 16723) - Flashback {3}{R} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

805. Reaping the Graves (EDHREC 16785) - Return target creature card from your graveyard to your hand.
806. Thief of Hope (EDHREC 16803) - Soulshift 2 (When this creature dies, you may return target Spirit card with mana value 2 or less from your graveyard to your hand.)
807. Izzet Chronarch (EDHREC 16823) - When this creature enters, return target instant or sorcery card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

808. Sever the Bloodline (EDHREC 16853) - Flashback {5}{B}{B} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

809. Daily Bugle Reporters (EDHREC 16931) - • Investigative Journalism — Return target creature card with mana value 2 or less from your graveyard to your hand.
810. Rogues' Gallery (EDHREC 17003) - For each color, return up to one target creature card of that color from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

811. Ureni's Rebuff (EDHREC 17009) - Harmonize {5}{U} (You may cast this card from your graveyard for its harmonize cost.
### Flashback Cards (Overflow)

812. Runic Repetition (EDHREC 17013) - Return target exiled card with flashback you own to your hand.
### Your Graveyard To Hand (Overflow)

813. Salvage Scout (EDHREC 17021) - {W}, Sacrifice this creature: Return target artifact card from your graveyard to your hand.
814. He Who Hungers (EDHREC 17080) - Soulshift 4 (When this creature dies, you may return target Spirit card with mana value 4 or less from your graveyard to your hand.)
815. Living Lightning (EDHREC 17144) - When this creature dies, return target instant or sorcery card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

816. Conflagrate (EDHREC 17220) - (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

817. Entomber Exarch (EDHREC 17332) - • Return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

818. Spider-Islanders (EDHREC 17334) - Mayhem {1}{R} (You may cast this card from your graveyard for {1}{R} if you discarded it this turn.
819. Leonardo's Technique (EDHREC 17348) - Sneak {1}{W} (You may cast this spell for {1}{W} if you also return an unblocked attacker you control to hand during the declare blockers step.) Return one or two target creature cards each with mana value 3 or less f...
### Your Graveyard To Hand (Overflow)

820. Pharika's Mender (EDHREC 17374) - When this creature enters, you may return target creature or enchantment card from your graveyard to your hand.
821. Elder Pine of Jukai (EDHREC 17427) - Soulshift 2 (When this creature dies, you may return target Spirit card with mana value 2 or less from your graveyard to your hand.)
### Cast From Graveyard Permission Windows (Overflow)

822. Tapping at the Window (EDHREC 17441) - Flashback {2}{G} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

823. Wildwood Rebirth (EDHREC 17462) - Return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

824. Retrieve the Esper (EDHREC 17464) - Flashback {5}{U} (You may cast this card from your graveyard for its flashback cost.
825. Leonardo, Sewer Samurai (EDHREC 17467) - During your turn, you may cast creature spells with power or toughness 1 or less from your graveyard.
### Your Graveyard To Hand (Overflow)

826. Murasa Sproutling (EDHREC 17468) - When this creature enters, if it was kicked, return target card with a kicker ability from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

827. Light Up the Night (EDHREC 17549) - (You may cast this card from your graveyard for its flashback cost.
828. Ruthless Negotiation (EDHREC 17560) - Flashback {4}{B} (You may cast this card from your graveyard for its flashback cost.
829. Flaring Pain (EDHREC 17636) - Flashback {R} (You may cast this card from your graveyard for its flashback cost.
830. Raffine's Guidance (EDHREC 17656) - You may cast this card from your graveyard by paying {2}{W} rather than paying its mana cost.
### Your Graveyard To Hand (Overflow)

831. Midnight Scavengers (EDHREC 17791) - When this creature enters, you may return target creature card with mana value 3 or less from your graveyard to your hand.
832. Foul Renewal (EDHREC 17818) - Return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

833. Dead Revels (EDHREC 17823) - Spectacle {1}{B} (You may cast this spell for its spectacle cost rather than its mana cost if an opponent lost life this turn.) Return up to two target creature cards from your graveyard to your hand.
### Your Graveyard To Hand (Overflow)

834. Dawn to Dusk (EDHREC 17858) - • Return target enchantment card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

835. Deadly Allure (EDHREC 17899) - Flashback {G} (You may cast this card from your graveyard for its flashback cost.
836. Ghoulcaller's Harvest (EDHREC 17901) - Flashback {3}{B}{G} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

837. Golgari Guildmage (EDHREC 17912) - {4}{B}, Sacrifice a creature: Return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

838. Hungry for More (EDHREC 17927) - Flashback {1}{B}{R} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

839. Spellpyre Phoenix (EDHREC 18035) - When this creature enters, you may return target instant or sorcery card with a cycling ability from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

840. Roar of the Wurm (EDHREC 18083) - Flashback {3}{G} (You may cast this card from your graveyard for its flashback cost.
841. Corpse Cobble (EDHREC 18131) - Flashback {3}{U}{B} (You may cast this card from your graveyard for its flashback cost and any additional costs.
### Your Graveyard To Hand (Overflow)

842. Reviving Melody (EDHREC 18185) - • Return target creature card from your graveyard to your hand.
843. Blood Spatter Analysis (EDHREC 18235) - When you do, return target creature card from your graveyard to your hand.
### Escape And Similar Graveyard Alternate Costs (Overflow)

844. Unblinking Observer (EDHREC 18254) - Spend this mana only to pay a disturb cost or cast an instant or sorcery spell.
### Your Graveyard To Hand (Overflow)

845. Rise from the Wreck (EDHREC 18303) - Return up to one target creature card, up to one target Mount card, up to one target Vehicle card, and up to one target creature card with no abilities from your graveyard to your hand.
846. Daring Archaeologist (EDHREC 18370) - When this creature enters, you may return target artifact card from your graveyard to your hand.
847. Midnight Recovery (EDHREC 18409) - Return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

848. Wake to Slaughter (EDHREC 18413) - Flashback {4}{B}{R} (You may cast this card from your graveyard for its flashback cost.
849. Glimpse of Freedom (EDHREC 18426) - (You may cast this card from your graveyard for its escape cost.)
850. Moan of the Unhallowed (EDHREC 18444) - Flashback {5}{B}{B} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

851. Skull of Orm (EDHREC 18481) - {5}, {T}: Return target enchantment card from your graveyard to your hand.
### Escape And Similar Graveyard Alternate Costs (Overflow)

852. Temmet, Vizier of Naktamun (EDHREC 18486) - Embalm {3}{W}{U} ({3}{W}{U}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a white Zombie Human Cleric with no mana cost.
### Your Graveyard To Hand (Overflow)

853. Survivors' Bond (EDHREC 18503) - • Return target Human creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

854. Wickerfolk Indomitable (EDHREC 18547) - You may cast this card from your graveyard by paying 2 life and sacrificing an artifact or creature in addition to paying its other costs.
### Your Graveyard To Hand (Overflow)

855. Disturbed Burial (EDHREC 18556) - Return target creature card from your graveyard to your hand.
856. Charnelhoard Wurm (EDHREC 18583) - Whenever this creature deals damage to an opponent, you may return target card from your graveyard to your hand.
857. Kodama of the Center Tree (EDHREC 18608) - (When this creature dies, you may return target Spirit card with mana value X or less from your graveyard to your hand.)
858. Tenacious Tomeseeker (EDHREC 18609) - When this creature enters, if it was bargained, return target instant or sorcery card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

859. Dralnu, Lich Lord (EDHREC 18712) - (You may cast that card from your graveyard for its flashback cost.
860. Call the Skybreaker (EDHREC 18717) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
### Your Graveyard To Hand (Overflow)

861. Aether Helix (EDHREC 18726) - Return target permanent card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

862. Auron's Inspiration (EDHREC 18767) - Flashback {2}{W}{W} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

863. Soulless Revival (EDHREC 18898) - Return target creature card from your graveyard to your hand.
864. Grim Harvest (EDHREC 18918) - Return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

865. Helbrute (EDHREC 18922) - Sarcophagus — You may cast this card from your graveyard by exiling another creature card from your graveyard in addition to paying its other costs.
### Your Graveyard To Hand (Overflow)

866. Trusty Packbeast (EDHREC 19029) - When this creature enters, return target artifact card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

867. Calibrated Blast (EDHREC 19083) - Flashback {3}{R}{R} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

868. Dee Kay, Finder of the Lost (EDHREC 19107) - Whenever you roll a 6, return target creature card from your graveyard to your hand.
869. Pit Keeper (EDHREC 19187) - When this creature enters, if you have four or more creature cards in your graveyard, you may return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

870. Chill of Foreboding (EDHREC 19237) - Flashback {7}{U} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

871. The Unspeakable (EDHREC 19295) - Whenever The Unspeakable deals combat damage to a player, you may return target Arcane card from your graveyard to your hand.
872. Pillardrop Warden (EDHREC 19350) - {2}, {T}, Sacrifice this creature: Return target instant or sorcery card from your graveyard to your hand.
873. Ritual of Restoration (EDHREC 19461) - Return target artifact card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

874. Maximize Altitude (EDHREC 19566) - Jump-start (You may cast this card from your graveyard by discarding a card in addition to paying its other costs.
### Escape And Similar Graveyard Alternate Costs (Overflow)

875. Glyph Keeper (EDHREC 19776) - Embalm {5}{U}{U} ({5}{U}{U}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a white Zombie Sphinx with no mana cost.
### Your Graveyard To Hand (Overflow)

876. Kami of Restless Shadows (EDHREC 19838) - • Return up to one target Ninja or Rogue creature card from your graveyard to your hand.
877. Niko Defies Destiny (EDHREC 19868) - III — Return target card with foretell from your graveyard to your hand.
878. Ghitu Chronicler (EDHREC 19877) - When this creature enters, if it was kicked, return target instant or sorcery card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

879. Ray of Revelation (EDHREC 19884) - Flashback {G} (You may cast this card from your graveyard for its flashback cost.
880. Winterthorn Blessing (EDHREC 19901) - Flashback {1}{G}{U} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

881. Kishla Trawlers (EDHREC 20214) - When you do, return target instant or sorcery card from your graveyard to your hand.
882. Malevolent Awakening (EDHREC 20215) - {1}{B}{B}, Sacrifice a creature: Return target creature card from your graveyard to your hand.
883. Draugr Recruiter (EDHREC 20225) - Boast — {3}{B}: Return target creature card from your graveyard to your hand.
884. Possessed Skaab (EDHREC 20310) - When this creature enters, return target instant, sorcery, or creature card from your graveyard to your hand.
885. Necromantic Thirst (EDHREC 20416) - Whenever enchanted creature deals combat damage to a player, you may return target creature card from your graveyard to your hand.
886. Tazeem Roilmage (EDHREC 20456) - When this creature enters, if it was kicked, return target instant or sorcery card from your graveyard to your hand.
887. Vengeful Rebirth (EDHREC 20540) - Return target card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

888. Sleep of the Dead (EDHREC 20545) - (You may cast this card from your graveyard for its escape cost.)
### Your Graveyard To Hand (Overflow)

889. Dawn Evangel (EDHREC 20547) - Whenever a creature dies, if an Aura you controlled was attached to it, return target creature card with mana value 2 or less from your graveyard to your hand.
890. Disciple of the Sun (EDHREC 20579) - When this creature enters, return target permanent card with mana value 3 or less from your graveyard to your hand.
891. Darigaaz's Charm (EDHREC 20604) - • Return target creature card from your graveyard to your hand.
892. Dowsing Shaman (EDHREC 20605) - {2}{G}, {T}: Return target enchantment card from your graveyard to your hand.
### Unearth Cards (Overflow)

893. Reconstructed Thopter (EDHREC 20622) - Unearth {2} ({2}: Return this card from your graveyard to the battlefield.
### Cast From Graveyard Permission Windows (Overflow)

894. Flash of Insight (EDHREC 20723) - (You may cast this card from your graveyard for its flashback cost, then exile it.
### Your Graveyard To Hand (Overflow)

895. Scribe of the Mindful (EDHREC 20809) - {1}, {T}, Sacrifice this creature: Return target instant or sorcery card from your graveyard to your hand.
896. Holistic Wisdom (EDHREC 20824) - {2}, Exile a card from your hand: Return target card from your graveyard to your hand if it shares a card type with the card exiled this way.
### Unearth Cards (Overflow)

897. Dregscape Zombie (EDHREC 20867) - Unearth {B} ({B}: Return this card from your graveyard to the battlefield.
### Cast From Graveyard Permission Windows (Overflow)

898. Krosan Reclamation (EDHREC 20870) - Flashback {1}{G} (You may cast this card from your graveyard for its flashback cost.
899. Rally the Peasants (EDHREC 20938) - Flashback {2}{R} (You may cast this card from your graveyard for its flashback cost.
900. Travel Preparations (EDHREC 21035) - Flashback {1}{W} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

901. Griffin Dreamfinder (EDHREC 21042) - When this creature enters, return target enchantment card from your graveyard to your hand.
### Escape And Similar Graveyard Alternate Costs (Overflow)

902. Oketra's Attendant (EDHREC 21073) - Embalm {3}{W}{W} ({3}{W}{W}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a white Zombie Bird Soldier with no mana cost.
### Cast From Graveyard Permission Windows (Overflow)

903. Tracker's Instincts (EDHREC 21081) - Flashback {2}{U} (You may cast this card from your graveyard for its flashback cost.
904. Pharika's Spawn (EDHREC 21124) - (You may cast this card from your graveyard for its escape cost.)
### Your Graveyard To Hand (Overflow)

905. Wayspeaker Bodyguard (EDHREC 21125) - When this creature enters, return target nonland permanent card with mana value 2 or less from your graveyard to your hand.
906. Returned Pastcaller (EDHREC 21166) - When this creature enters, return target Spirit, instant, or sorcery card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

907. Saving Grasp (EDHREC 21241) - Flashback {W} (You may cast this card from your graveyard for its flashback cost.
908. Cenn's Enlistment (EDHREC 21246) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
909. Sweet Oblivion (EDHREC 21300) - (You may cast this card from your graveyard for its escape cost.)
### Unearth Cards (Overflow)

910. Mask of the Jadecrafter (EDHREC 21305) - Unearth {2}{G} ({2}{G}: Return this card from your graveyard to the battlefield.
### Cast From Graveyard Permission Windows (Overflow)

911. Call of the Herd (EDHREC 21319) - Flashback {3}{G} (You may cast this card from your graveyard for its flashback cost.
912. Sylvan Might (EDHREC 21356) - Flashback {2}{G}{G} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

913. Sibsig Muckdraggers (EDHREC 21425) - When this creature enters, return target creature card from your graveyard to your hand.
914. Morgue Theft (EDHREC 21456) - Return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

915. Underworld Rage-Hound (EDHREC 21534) - (You may cast this card from your graveyard for its escape cost.)
### Escape And Similar Graveyard Alternate Costs (Overflow)

916. Earthshaker Khenra (EDHREC 21555) - Eternalize {4}{R}{R} ({4}{R}{R}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a 4/4 black Zombie Jackal Warrior with no mana cost.
### Cast From Graveyard Permission Windows (Overflow)

917. Fervent Denial (EDHREC 21729) - Flashback {5}{U}{U} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

918. Elven Cache (EDHREC 21758) - Return target card from your graveyard to your hand.
919. Hana Kami (EDHREC 21766) - {1}{G}, Sacrifice this creature: Return target Arcane card from your graveyard to your hand.
920. Morgue Burst (EDHREC 21771) - Return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

921. Sonic Assault (EDHREC 21778) - Jump-start (You may cast this card from your graveyard by discarding a card in addition to paying its other costs.
### Your Graveyard To Hand (Overflow)

922. Treasure Hunter (EDHREC 21799) - When this creature enters, you may return target artifact card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

923. Embolden (EDHREC 21812) - Flashback {1}{W} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

924. Oltec Archaeologists (EDHREC 21868) - • Return target artifact card from your graveyard to your hand.
### Unearth Cards (Overflow)

925. Scrapwork Cohort (EDHREC 21871) - Unearth {2}{W} ({2}{W}: Return this card from your graveyard to the battlefield.
926. Viscera Dragger (EDHREC 21904) - Unearth {1}{B} ({1}{B}: Return this card from your graveyard to the battlefield.
### Cast From Graveyard Permission Windows (Overflow)

927. Mogis's Favor (EDHREC 21914) - (You may cast this card from your graveyard for its escape cost.)
### Your Graveyard To Hand (Overflow)

928. Spellkeeper Weird (EDHREC 21922) - {2}, {T}, Sacrifice this creature: Return target instant or sorcery card from your graveyard to your hand.
929. Harbinger of Spring (EDHREC 21995) - Soulshift 4 (When this creature dies, you may return target Spirit card with mana value 4 or less from your graveyard to your hand.)
930. Mtenda Griffin (EDHREC 21996) - {W}, {T}: Return this creature to its owner's hand and return target Griffin card from your graveyard to your hand.
931. Pillardrop Rescuer (EDHREC 22239) - When this creature enters, return target creature card with mana value 3 or less from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

932. Mammoth Bellow (EDHREC 22333) - Harmonize {5}{G}{U}{R} (You may cast this card from your graveyard for its harmonize cost.
933. Sins of the Past (EDHREC 22387) - Until end of turn, you may cast target instant or sorcery card from your graveyard without paying its mana cost.
934. Rise of the Ants (EDHREC 22500) - Flashback {6}{G}{G} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

935. Wildwood Escort (EDHREC 22521) - When this creature enters, return target creature or battle card from your graveyard to your hand.
936. Misery Charm (EDHREC 22523) - • Return target Cleric card from your graveyard to your hand.
937. Rootwater Diver (EDHREC 22664) - {T}, Sacrifice this creature: Return target artifact card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

938. Rolling Temblor (EDHREC 22694) - Flashback {4}{R}{R} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

939. Promised Kannushi (EDHREC 22719) - Soulshift 7 (When this creature dies, you may return target Spirit card with mana value 7 or less from your graveyard to your hand.)
### Cast From Graveyard Permission Windows (Overflow)

940. Ray of Distortion (EDHREC 22822) - Flashback {4}{W}{W} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

941. Leonin Squire (EDHREC 22920) - When this creature enters, return target artifact card with mana value 1 or less from your graveyard to your hand.
942. Lotus-Eye Mystics (EDHREC 22975) - When this creature enters, return target enchantment card from your graveyard to your hand.
943. Woodland Guidance (EDHREC 23009) - Return target card from your graveyard to your hand.
### Flashback Cards (Overflow)

944. Altar of the Lost (EDHREC 23024) - Spend this mana only to cast spells with flashback from a graveyard.
### Unearth Cards (Overflow)

945. Heavyweight Demolisher (EDHREC 23164) - Unearth {6}{R}{R} ({6}{R}{R}: Return this card from your graveyard to the battlefield.
### Cast From Graveyard Permission Windows (Overflow)

946. Marshaling Cry (EDHREC 23193) - Flashback {3}{W} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

947. Déjà Vu (EDHREC 23209) - Return target sorcery card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

948. Ogre Battlecaster (EDHREC 23242) - Whenever this creature attacks, you may cast target instant or sorcery card from your graveyard by paying {R}{R} in addition to its other costs.
### Your Graveyard To Hand (Overflow)

949. Warden of the Eye (EDHREC 23296) - When this creature enters, return target noncreature, nonland card from your graveyard to your hand.
950. Ulamog's Reclaimer (EDHREC 23336) - If you do, return target instant or sorcery card from your graveyard to your hand.
951. Warren Pilferers (EDHREC 23379) - When this creature enters, return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

952. Gaze of Justice (EDHREC 23470) - Flashback {5}{W} (You may cast this card from your graveyard for its flashback cost and any additional costs.
953. Direct Current (EDHREC 23484) - Jump-start (You may cast this card from your graveyard by discarding a card in addition to paying its other costs.
### Your Graveyard To Hand (Overflow)

954. Pus Kami (EDHREC 23488) - Soulshift 6 (When this creature dies, you may return target Spirit card with mana value 6 or less from your graveyard to your hand.)
955. The Last Ronin (EDHREC 23532) - When you do, return target creature card from your graveyard to your hand.
### Escape And Similar Graveyard Alternate Costs (Overflow)

956. Sunscourge Champion (EDHREC 23562) - Eternalize—{2}{W}{W}, Discard a card.
### Cast From Graveyard Permission Windows (Overflow)

957. Wild Hunger (EDHREC 23632) - Flashback {3}{R} (You may cast this card from your graveyard for its flashback cost.
958. Eelectrocute (EDHREC 23755) - You may cast this card from your graveyard as long as you've rolled a 6 this turn.
### Your Graveyard To Hand (Overflow)

959. Body of Jukai (EDHREC 23764) - Soulshift 8 (When this creature dies, you may return target Spirit card with mana value 8 or less from your graveyard to your hand.)
960. Monastery Loremaster (EDHREC 23778) - When this creature is turned face up, return target noncreature, nonland card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

961. Syphon Life (EDHREC 23830) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
### Your Graveyard To Hand (Overflow)

962. Kami of the Honored Dead (EDHREC 23918) - Soulshift 6 (When this creature dies, you may return target Spirit card with mana value 6 or less from your graveyard to your hand.)
### Unearth Cards (Overflow)

963. Kathari Bomber (EDHREC 23919) - Unearth {3}{B}{R} ({3}{B}{R}: Return this card from your graveyard to the battlefield.
### Your Graveyard To Hand (Overflow)

964. Restoration Gearsmith (EDHREC 23998) - When this creature enters, return target artifact or creature card from your graveyard to your hand.
### Unearth Cards (Overflow)

965. Mishra's Juggernaut (EDHREC 24098) - Unearth {5}{R} ({5}{R}: Return this card from your graveyard to the battlefield.
### Your Graveyard To Hand (Overflow)

966. Master Skald (EDHREC 24118) - If you do, return target artifact or enchantment card from your graveyard to your hand.
967. Moonlit Strider (EDHREC 24189) - Soulshift 3 (When this creature dies, you may return target Spirit card with mana value 3 or less from your graveyard to your hand.)
968. Grave Exchange (EDHREC 24351) - Return target creature card from your graveyard to your hand.
969. Cartographer (EDHREC 24356) - When this creature enters, you may return target land card from your graveyard to your hand.
### Escape And Similar Graveyard Alternate Costs (Overflow)

970. Trueheart Duelist (EDHREC 24391) - Embalm {2}{W} ({2}{W}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a white Zombie Human Warrior with no mana cost.
### Cast From Graveyard Permission Windows (Overflow)

971. Bump in the Night (EDHREC 24404) - Flashback {5}{R} (You may cast this card from your graveyard for its flashback cost.
972. Traitor's Clutch (EDHREC 24496) - Flashback {1}{B} (You may cast this card from your graveyard for its flashback cost.
973. Hundred-Battle Veteran (EDHREC 24516) - You may cast this card from your graveyard.
974. Underworld Charger (EDHREC 24535) - (You may cast this card from your graveyard for its escape cost.)
### Your Graveyard To Hand (Overflow)

975. Woebearer (EDHREC 24559) - Whenever this creature deals combat damage to a player, you may return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

976. Earth Rift (EDHREC 24571) - Flashback {5}{R}{R} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

977. Gibbering Kami (EDHREC 24635) - Soulshift 3 (When this creature dies, you may return target Spirit card with mana value 3 or less from your graveyard to your hand.)
### Flashback Cards (Overflow)

978. Phantom Carriage (EDHREC 24688) - When this creature enters, you may search your library for a card with flashback or disturb, put it into your graveyard, then shuffle.
### Your Graveyard To Hand (Overflow)

979. Kami of Empty Graves (EDHREC 24799) - Soulshift 3 (When this creature dies, you may return target Spirit card with mana value 3 or less from your graveyard to your hand.)
980. Nucklavee (EDHREC 24925) - When this creature enters, you may return target red sorcery card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

981. Nightbird's Clutches (EDHREC 24999) - Flashback {3}{R} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

982. Kami of Lunacy (EDHREC 25024) - Soulshift 5 (When this creature dies, you may return target Spirit card with mana value 5 or less from your graveyard to your hand.)
### Escape And Similar Graveyard Alternate Costs (Overflow)

983. Shipwreck Sifters (EDHREC 25045) - Whenever you discard a Spirit card or a card with disturb, put a +1/+1 counter on this creature.
### Cast From Graveyard Permission Windows (Overflow)

984. Shadowbeast Sighting (EDHREC 25133) - Flashback {6}{G} (You may cast this card from your graveyard for its flashback cost.
### Unearth Cards (Overflow)

985. Scourge Devil (EDHREC 25154) - Unearth {2}{R} ({2}{R}: Return this card from your graveyard to the battlefield.
### Cast From Graveyard Permission Windows (Overflow)

986. Voracious Typhon (EDHREC 25168) - (You may cast this card from your graveyard for its escape cost.)
### Unearth Cards (Overflow)

987. Grixis Slavedriver (EDHREC 25184) - Unearth {3}{B} ({3}{B}: Return this card from your graveyard to the battlefield.
### Cast From Graveyard Permission Windows (Overflow)

988. Fruit of Tizerus (EDHREC 25193) - (You may cast this card from your graveyard for its escape cost.)
989. Ancestral Tribute (EDHREC 25262) - Flashback {9}{W}{W}{W} (You may cast this card from your graveyard for its flashback cost.
### Play From Graveyard Permission Windows (Overflow)

990. Yawgmoth's Agenda (EDHREC 25452) - You may play lands and cast spells from your graveyard.
### Escape And Similar Graveyard Alternate Costs (Overflow)

991. Vizier of the Anointed (EDHREC 25621) - When this creature enters, you may search your library for a creature card with eternalize or embalm, put that card into your graveyard, then shuffle.
### Your Graveyard To Hand (Overflow)

992. Return to Battle (EDHREC 25672) - Return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

993. Grasp of Phantoms (EDHREC 25709) - Flashback {7}{U} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

994. Clear the Stage (EDHREC 25762) - If you control a creature with power 4 or greater, you may return up to one target creature card from your graveyard to your hand.
995. Mausoleum Turnkey (EDHREC 25833) - When this creature enters, return target creature card of an opponent's choice from your graveyard to your hand.
996. Razor Hippogriff (EDHREC 25884) - When this creature enters, return target artifact card from your graveyard to your hand.
997. Odunos River Trawler (EDHREC 25977) - When this creature enters, return target enchantment creature card from your graveyard to your hand.
998. Kami of the Palace Fields (EDHREC 26016) - Soulshift 5 (When this creature dies, you may return target Spirit card with mana value 5 or less from your graveyard to your hand.)
999. Thousand-legged Kami (EDHREC 26039) - Soulshift 7 (When this creature dies, you may return target Spirit card with mana value 7 or less from your graveyard to your hand.)
### Cast From Graveyard Permission Windows (Overflow)

1000. Beast Attack (EDHREC 26146) - Flashback {2}{G}{G}{G} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

1001. Crypt Angel (EDHREC 26293) - When this creature enters, return target blue or red creature card from your graveyard to your hand.
1002. Stoic Builder (EDHREC 26305) - When this creature enters, you may return target land card from your graveyard to your hand.
1003. Deathknell Kami (EDHREC 26307) - Soulshift 1 (When this creature dies, you may return target Spirit card with mana value 1 or less from your graveyard to your hand.)
1004. Nightsoil Kami (EDHREC 26313) - Soulshift 5 (When this creature dies, you may return target Spirit card with mana value 5 or less from your graveyard to your hand.)
1005. Burr Grafter (EDHREC 26327) - Soulshift 3 (When this creature dies, you may return target Spirit card with mana value 3 or less from your graveyard to your hand.)
1006. Scuttling Death (EDHREC 26361) - Soulshift 4 (When this creature dies, you may return target Spirit card with mana value 4 or less from your graveyard to your hand.)
### Cast From Graveyard Permission Windows (Overflow)

1007. Monstrify (EDHREC 26471) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
### Your Graveyard To Hand (Overflow)

1008. Ragamuffin Raptor (EDHREC 26510) - When this creature enters, return up to one target creature or Food card from your graveyard to your hand.
1009. Barrow Witches (EDHREC 26529) - When this creature enters, return target Knight card from your graveyard to your hand.
1010. Crawling Filth (EDHREC 26572) - Soulshift 5 (When this creature dies, you may return target Spirit card with mana value 5 or less from your graveyard to your hand.)
### Cast From Graveyard Permission Windows (Overflow)

1011. Elephant Ambush (EDHREC 26644) - Flashback {6}{G}{G} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

1012. Vine Kami (EDHREC 26653) - Soulshift 6 (When this creature dies, you may return target Spirit card with mana value 6 or less from your graveyard to your hand.)
### Cast From Graveyard Permission Windows (Overflow)

1013. Flaming Gambit (EDHREC 26696) - Flashback {X}{R}{R} (You may cast this card from your graveyard for its flashback cost.
1014. Volley of Boulders (EDHREC 26707) - Flashback {R}{R}{R}{R}{R}{R} (You may cast this card from your graveyard for its flashback cost.
1015. Canopy Claws (EDHREC 26708) - Flashback {G} (You may cast this card from your graveyard for its flashback cost.
### Escape And Similar Graveyard Alternate Costs (Overflow)

1016. Labyrinth Guardian (EDHREC 26955) - Embalm {3}{U} ({3}{U}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a white Zombie Illusion Warrior with no mana cost.
### Your Graveyard To Hand (Overflow)

1017. Strongarm Thug (EDHREC 26958) - When this creature enters, you may return target Mercenary card from your graveyard to your hand.
### Unearth Cards (Overflow)

1018. Tocasia's Onulet (EDHREC 26960) - Unearth {3}{W} ({3}{W}: Return this card from your graveyard to the battlefield.
### Escape And Similar Graveyard Alternate Costs (Overflow)

1019. Resilient Khenra (EDHREC 26993) - Eternalize {4}{G}{G} ({4}{G}{G}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a 4/4 black Zombie Jackal Wizard with no mana cost.
1020. Aven Initiate (EDHREC 27018) - Embalm {6}{U} ({6}{U}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a white Zombie Bird Warrior with no mana cost.
1021. Unwavering Initiate (EDHREC 27058) - Embalm {4}{W} ({4}{W}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a white Zombie Human Warrior with no mana cost.
### Your Graveyard To Hand (Overflow)

1022. Hundred-Talon Kami (EDHREC 27076) - Soulshift 4 (When this creature dies, you may return target Spirit card with mana value 4 or less from your graveyard to your hand.)
1023. Rootrunner (EDHREC 27082) - Soulshift 3 (When this creature dies, you may return target Spirit card with mana value 3 or less from your graveyard to your hand.)
### Escape And Similar Graveyard Alternate Costs (Overflow)

1024. Proven Combatant (EDHREC 27130) - Eternalize {4}{U}{U} ({4}{U}{U}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a 4/4 black Zombie Human Warrior with no mana cost.
### Cast From Graveyard Permission Windows (Overflow)

1025. Bash to Bits (EDHREC 27158) - Flashback {4}{R}{R} (You may cast this card from your graveyard for its flashback cost.
### Escape And Similar Graveyard Alternate Costs (Overflow)

1026. Thraben Exorcism (EDHREC 27199) - Exile target Spirit, creature with disturb, or enchantment.
### Cast From Graveyard Permission Windows (Overflow)

1027. Lightning Surge (EDHREC 27283) - Flashback {5}{R}{R} (You may cast this card from your graveyard for its flashback cost.
1028. Rat in the Hat (EDHREC 27304) - {T}, Sacrifice this creature: Until end of turn, you may cast target creature card that has a hat from your graveyard.
### Your Graveyard To Hand (Overflow)

1029. Sage's Knowledge (EDHREC 27347) - Return target sorcery card from your graveyard to your hand.
1030. Exhumer Thrull (EDHREC 27365) - When this creature enters or the creature it haunts dies, return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

1031. Loathsome Chimera (EDHREC 27384) - (You may cast this card from your graveyard for its escape cost.)
### Escape And Similar Graveyard Alternate Costs (Overflow)

1032. Steadfast Sentinel (EDHREC 27411) - Eternalize {4}{W}{W} ({4}{W}{W}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a 4/4 black Zombie Human Cleric with no mana cost.
### Unearth Cards (Overflow)

1033. Shambling Remains (EDHREC 27469) - Unearth {B}{R} ({B}{R}: Return this card from your graveyard to the battlefield.
### Cast From Graveyard Permission Windows (Overflow)

1034. Reap the Seagraf (EDHREC 27548) - Flashback {4}{U} (You may cast this card from your graveyard for its flashback cost.
1035. Engulfing Flames (EDHREC 27584) - Flashback {3}{R} (You may cast this card from your graveyard for its flashback cost.
1036. Skull Fracture (EDHREC 27648) - Flashback {3}{B} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

1037. Excavation Elephant (EDHREC 27663) - When this creature enters, if it was kicked, return target artifact card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

1038. Kaleidoscorch (EDHREC 27686) - Flashback {4}{R} (You may cast this card from your graveyard for its flashback cost.
1039. Burning Oil (EDHREC 27790) - Flashback {3}{W} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

1040. Venerable Kumo (EDHREC 27872) - Soulshift 4 (When this creature dies, you may return target Spirit card with mana value 4 or less from your graveyard to your hand.)
### Cast From Graveyard Permission Windows (Overflow)

1041. Crippling Fatigue (EDHREC 27952) - (You may cast this card from your graveyard for its flashback cost.
1042. Folk Medicine (EDHREC 27996) - Flashback {1}{W} (You may cast this card from your graveyard for its flashback cost.
### Your Graveyard To Hand (Overflow)

1043. Kami of the Tended Garden (EDHREC 28075) - Soulshift 3 (When this creature dies, you may return target Spirit card with mana value 3 or less from your graveyard to your hand.)
### Cast From Graveyard Permission Windows (Overflow)

1044. Dematerialize (EDHREC 28141) - Flashback {5}{U}{U} (You may cast this card from your graveyard for its flashback cost.
### Unearth Cards (Overflow)

1045. Fire-Field Ogre (EDHREC 28213) - Unearth {U}{B}{R} ({U}{B}{R}: Return this card from your graveyard to the battlefield.
### Cast From Graveyard Permission Windows (Overflow)

1046. Flash of Defiance (EDHREC 28253) - (You may cast this card from your graveyard for its flashback cost.
### Unearth Cards (Overflow)

1047. Brackwater Elemental (EDHREC 28298) - Unearth {2}{U} ({2}{U}: Return this card from your graveyard to the battlefield.
### Escape And Similar Graveyard Alternate Costs (Overflow)

1048. Sinuous Striker (EDHREC 28304) - Eternalize—{3}{U}{U}, Discard a card.
1049. Tah-Crop Skirmisher (EDHREC 28345) - Embalm {3}{U} ({3}{U}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a white Zombie Snake Warrior with no mana cost.
### Your Graveyard To Hand (Overflow)

1050. Torii Watchward (EDHREC 28521) - Soulshift 4 (When this creature dies, you may return target Spirit card with mana value 4 or less from your graveyard to your hand.)
1051. Moriok Scavenger (EDHREC 28565) - When this creature enters, you may return target artifact creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

1052. Worldheart Phoenix (EDHREC 28617) - You may cast this card from your graveyard by paying {W}{U}{B}{R}{G} rather than paying its mana cost.
### Your Graveyard To Hand (Overflow)

1053. Cabal Surgeon (EDHREC 28662) - {2}{B}{B}, {T}, Exile two cards from your graveyard: Return target creature card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

1054. Thrill of the Hunt (EDHREC 28833) - Flashback {W} (You may cast this card from your graveyard for its flashback cost.
1055. Howling Gale (EDHREC 28894) - Flashback {1}{G} (You may cast this card from your graveyard for its flashback cost.
1056. Spirit Flare (EDHREC 28911) - (You may cast this card from your graveyard for its flashback cost.
### Unearth Cards (Overflow)

1057. Etherium Abomination (EDHREC 28917) - Unearth {1}{U}{B} ({1}{U}{B}: Return this card from your graveyard to the battlefield.
### Cast From Graveyard Permission Windows (Overflow)

1058. Smiting Helix (EDHREC 28924) - Flashback {R}{W} (You may cast this card from your graveyard for its flashback cost.
1059. Tizerus Charger (EDHREC 28961) - (You may cast this card from your graveyard for its escape cost.)
1060. Savage Conception (EDHREC 28978) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
1061. Fires of Undeath (EDHREC 29052) - Flashback {5}{B} (You may cast this card from your graveyard for its flashback cost.
1062. Strangling Soot (EDHREC 29482) - Flashback {5}{R} (You may cast this card from your graveyard for its flashback cost.
1063. Scorching Missile (EDHREC 29564) - Flashback {9}{R} (You may cast this card from your graveyard for its flashback cost.
1064. Morbid Hunger (EDHREC 29632) - Flashback {7}{B}{B} (You may cast this card from your graveyard for its flashback cost.
### Unearth Cards (Overflow)

1065. Kathari Screecher (EDHREC 29810) - Unearth {2}{U} ({2}{U}: Return this card from your graveyard to the battlefield.
1066. Undead Leotau (EDHREC 30533) - Unearth {2}{B} ({2}{B}: Return this card from your graveyard to the battlefield.
### Flashback Cards (Overflow)

1067. Tombfire (EDHREC 30560) - Target player exiles all cards with flashback from their graveyard.
### Your Graveyard To Hand (Overflow)

1068. Groffskithur (EDHREC 30681) - Whenever this creature becomes blocked, you may return target card named Groffskithur from your graveyard to your hand.
### Escape And Similar Graveyard Alternate Costs (Overflow)

1069. Banned Eldraine Card (unranked) - It becomes a copy respectively of Cauldron Familiar, Escape to the Wilds, Fires of Invention, Lucky Clover, Mystic Sanctuary, Once Upon A Time for the rest of the game in all zones.
### Flashback Cards (Overflow)

1070. Blast from the Past (unranked) - Madness {R}, cycling {1}{R}, kicker {2}{R}, flashback {3}{R}, buyback {4}{R}
### Your Graveyard To Hand (Overflow)

1071. Catch-Up Mechanic (unranked) - • Return target artifact card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

1072. Eldrazi Guacamole Tightrope (unranked) - {TK}{TK}{TK}{TK}{TK} — You may cast this card from your graveyard by paying 2 life in addition to paying its other costs.
1073. Elemental Time Flamingo (unranked) - {TK}{TK} — Exile this permanent: You may cast target nonland card from your graveyard this turn.
### Your Graveyard To Hand (Overflow)

1074. Fraction Jackson (unranked) - {G}, {T}: Return target card with a ½ on it from your graveyard to your hand.
1075. Gerrard and Hanna (unranked) - • Return target artifact or enchantment card from your graveyard to your hand.
### Flashback Cards (Overflow)

1076. Htbr, Racetrack Referee (unranked) - Anything that replaces the mana cost like flashback or madness is not.)
1077. Incubob (unranked) - Flashback {3}{B}, Pay 3 life.
### Cast From Graveyard Permission Windows (Overflow)

1078. Jiffy, Vehicle Repairer (unranked) - (You may cast a Vehicle card from your graveyard by discarding a card in addition to paying its other costs.
### Escape And Similar Graveyard Alternate Costs (Overflow)

1079. Jund 'Em Out (unranked) - Retrace (Sorry, no room for reminder text.)
### Your Graveyard To Hand (Overflow)

1080. Labro Bot (unranked) - When this creature enters, return target host card or card with augment from your graveyard to your hand.
### Escape And Similar Graveyard Alternate Costs (Overflow)

1081. Lazotep Archway (unranked) - Eternalize {3}{W}{B} ({3}{W}{B}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a 4/4 black Zombie creature and loses all other card types.
### Your Graveyard To Hand (Overflow)

1082. Long-Term Phyresis Study (unranked) - When Long-Term Phyresis Study enters the battlefield, return up to one target creature card from your graveyard to your hand.
1083. Number Crunch (unranked) - Return target permanent to its owner's hand. Gotcha — If an opponent says a number, you may say "Gotcha!" When you do, return this card from your graveyard to your hand.
1084. Refibrillator (unranked) - Whenever you crank this Contraption, return target creature card from your graveyard to your hand.
### Flashback Cards (Overflow)

1085. Second Stage of Magic Design (unranked) - (Keywords and ability words include abilities like flying, flashback, and landfall.)
### Your Graveyard To Hand (Overflow)

1086. Spellmorph Raise Dead (unranked) - Return target creature card from your graveyard to your hand.
1087. Unassuming Gelatinous Serpent (unranked) - {TK}{TK} — When this permanent dies, return target noncreature, nonland card from your graveyard to your hand.
1088. Very Cryptic Command (unranked) - • Return target instant or sorcery card from your graveyard to your hand.
### Cast From Graveyard Permission Windows (Overflow)

1089. Yawgmoth's Day Planner (unranked) - You may cast spells from your graveyard.

## Notes

- Regenerate this file with `node tools/build-next-automation-queue.js --count 2000` whenever the corpus or family priorities change.
- If product scope widens beyond graveyard-heavy seams, add new family configs rather than manually editing the queue body.

