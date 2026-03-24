# Oracle Automation Next 500

Generated: `2026-03-24T06:07:53.438Z`
Source: `oracle-cards.json`
Scope: black-border paper-card graveyard / recursion / graveyard-casting seams that are likely to move practical automation forward for the next test run.

Queued items: `500`

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
| Escape And Similar Graveyard Alternate Costs | Graveyard Permission / Replacement | 21 | 108 | Includes escape-style casting/replay from graveyard with additional costs or modifiers. |

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

## Notes

- Regenerate this file with `node tools/build-next-automation-queue.js` whenever the corpus or family priorities change.
- If product scope widens beyond graveyard-heavy seams, add new family configs rather than manually editing the queue body.

