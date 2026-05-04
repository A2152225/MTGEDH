# Oracle Automation Next 20 Work Categories

Generated: `2026-05-04T18:17:00.742Z`
Source: `oracle-cards.json`
Excluded: oracle IDs already present in `tools/oracle-automation-next-10000.json`.
Ordering: categories are ordered by the next configured queue families first, then corpus-mined follow-on seams; items are ordered by EDHREC rank, then card name.

## Category Summary

| # | Category | Source | Items Listed | Available | Notes |
|---:|---|---|---:|---:|---|
| 1 | Bounce And Return-To-Hand Effects | existing queue family after library_search | 200 | 525 | Battlefield bounce and zone-return effects after the current queue tail. |
| 2 | Discard Effects | existing queue family after library_search | 200 | 1204 | Deterministic discard counts plus player-choice discard families. |
| 3 | Scry / Surveil / Topdeck Manipulation | existing queue family after library_search | 200 | 739 | Visible topdeck manipulation and queue-backed choice candidates. |
| 4 | Tap / Untap Effects | existing queue family after library_search | 200 | 507 | Single-target, multi-target, and each-target tap/untap templates. |
| 5 | Counterspell And Stack Interaction | existing queue family after library_search | 200 | 237 | Explicit spell and ability countering clauses. |
| 6 | Mill Effects | existing queue family after library_search | 200 | 351 | Library-to-graveyard movement and count scaling. |
| 7 | Impulse Exile Permission Windows | existing queue family after library_search | 160 | 160 | Exile-top plus temporary play/cast permission windows. |
| 8 | Fight And Bite-Style Combat Resolution | existing queue family after library_search | 30 | 30 | Fight, bite, and power-based creature damage clauses. |
| 9 | Goad And Attack-Pressure Effects | existing queue family after library_search | 119 | 119 | Goad, forced attacks, and attack restriction pressure text. |
| 10 | Non-Graveyard Exile Effects | corpus-mined follow-on seam | 200 | 439 | Targeted and sweeper exile effects excluding graveyard-target rows already covered by the current queue. |
| 11 | Power/Toughness Modification | corpus-mined follow-on seam | 200 | 4070 | Temporary and static P/T changes, including target and team-wide buffs/debuffs. |
| 12 | Keyword Grants And Losses | corpus-mined follow-on seam | 200 | 2236 | Gains/has/loses evergreen and combat keywords, especially duration-bound grants. |
| 13 | Combat Restrictions And Evasion Rules | corpus-mined follow-on seam | 200 | 1603 | Cannot attack/block, cannot be blocked, and blocking requirement templates. |
| 14 | Control Change And Exchange Effects | corpus-mined follow-on seam | 200 | 242 | Gain-control, donate, and exchange-control effects across permanent types. |
| 15 | Copy Spells And Abilities | corpus-mined follow-on seam | 200 | 228 | Spell/ability copy text, copied permanent spells, and retarget follow-ups. |
| 16 | Mana Generation And Mana Riders | corpus-mined follow-on seam | 200 | 1274 | Add-mana clauses, conditional mana, and rider text attached to mana production. |
| 17 | Cast Without Paying Mana Cost | corpus-mined follow-on seam | 200 | 412 | Free-cast windows from exile, library, hand, graveyard, and copied spells. |
| 18 | Modal Choices | corpus-mined follow-on seam | 200 | 405 | Choose-one, choose-one-or-more, charm, command, spree, and bullet-mode parsing. |
| 19 | Reveal / Look At Top Library Cards | corpus-mined follow-on seam | 200 | 785 | Top-library look/reveal actions beyond scry and surveil templates. |
| 20 | Attach / Equip / Aura Movement | corpus-mined follow-on seam | 200 | 432 | Attach equipment/auras and move attachments to new permanents. |

## Category Items

### 1. Bounce And Return-To-Hand Effects

Source: existing queue family after library_search
Available after current queue exclusion: 525

1. Cyclonic Rift (EDHREC 50) - Return target nonland permanent you don't control to its owner's hand.
2. Otawara, Soaring City (EDHREC 91) - Channel — {3}{U}, Discard this card: Return target artifact, creature, enchantment, or planeswalker to its owner's hand.
3. Hullbreaker Horror (EDHREC 269) - • Return target spell you don't control to its owner's hand.
4. Snap (EDHREC 274) - Return target creature to its owner's hand.
5. Desynchronization (EDHREC 1587) - Return each nonland permanent that's not historic to its owner's hand.
6. Riptide Laboratory (EDHREC 1734) - {1}{U}, {T}: Return target Wizard you control to its owner's hand.
7. Venser, Shaper Savant (EDHREC 1916) - When Venser enters, return target spell or permanent to its owner's hand.
8. Scourge of Fleets (EDHREC 2094) - When this creature enters, return each creature your opponents control with toughness X or less to its owner's hand, where X is the number of Islands you control.
9. Simic Charm (EDHREC 2647) - • Return target creature to its owner's hand.
10. Unsummon (EDHREC 2977) - Return target creature to its owner's hand.
11. Mistblade Shinobi (EDHREC 3094) - Whenever this creature deals combat damage to a player, you may return target creature that player controls to its owner's hand.
12. Sanctum of Eternity (EDHREC 3565) - {2}, {T}: Return target commander you own from the battlefield to your hand.
13. Tidespout Tyrant (EDHREC 3681) - Whenever you cast a spell, return target permanent to its owner's hand.
14. Sigil of Sleep (EDHREC 3686) - Whenever enchanted creature deals damage to a player, return target creature that player controls to its owner's hand.
15. Baral's Expertise (EDHREC 3774) - Return up to three target artifacts and/or creatures to their owners' hands.
16. Karn's Temporal Sundering (EDHREC 3814) - Return up to one target nonland permanent to its owner's hand.
17. Decoction Module (EDHREC 3860) - {4}, {T}: Return target creature you control to its owner's hand.
18. Spectral Deluge (EDHREC 4024) - Return each creature your opponents control with toughness X or less to its owner's hand, where X is the number of Islands you control.
19. Serum Snare (EDHREC 4249) - Return target nonland permanent to its owner's hand.
20. Retraction Helix (EDHREC 4412) - Until end of turn, target creature gains "{T}: Return target nonland permanent to its owner's hand."
21. Ugin's Binding (EDHREC 4586) - Return target nonland permanent you don't control to its owner's hand.
22. Reflector Mage (EDHREC 4735) - When this creature enters, return target creature an opponent controls to its owner's hand.
23. Unsubstantiate (EDHREC 4895) - Return target spell or creature to its owner's hand.
24. Brinelin, the Moon Kraken (EDHREC 5133) - When Brinelin enters and whenever you cast a spell with mana value 6 or greater, you may return target nonland permanent to its owner's hand.
25. Hammerhead Tyrant (EDHREC 5292) - Whenever you cast a spell, return up to one target nonland permanent an opponent controls with mana value less than or equal to that spell's mana value to its owner's hand.
26. Macabre Waltz (EDHREC 5441) - Return up to two target creature cards from your graveyard to your hand, then discard a card.
27. Press the Enemy (EDHREC 5529) - Return target spell or nonland permanent an opponent controls to its owner's hand.
28. Snapback (EDHREC 5621) - Return target creature to its owner's hand.
29. Crystal Shard (EDHREC 5623) - {3}, {T} or {U}, {T}: Return target creature to its owner's hand unless its controller pays {1}.
30. Soothing of Sméagol (EDHREC 5954) - Return target nontoken creature to its owner's hand.
31. Drafna, Founder of Lat-Nam (EDHREC 6227) - {1}{U}: Return target artifact you control to its owner's hand.
32. Clement, the Worrywort (EDHREC 6361) - Whenever Clement or another creature you control enters, return up to one target creature you control with lesser mana value to its owner's hand.
33. Wastescape Battlemage (EDHREC 6388) - When you cast this spell, if it was kicked with its {1}{U} kicker, return target creature an opponent controls to its owner's hand.
34. Fight On! (EDHREC 6487) - Return up to two target creature cards from your graveyard to your hand.
35. Pouncing Shoreshark (EDHREC 6656) - Whenever this creature mutates, you may return target creature an opponent controls to its owner's hand.
36. Vronos, Masked Inquisitor (EDHREC 6739) - −2: For each opponent, return up to one target nonland permanent that player controls to its owner's hand.
37. Moonsnare Specialist (EDHREC 6819) - When this creature enters, return up to one target creature to its owner's hand.
38. Banishing Knack (EDHREC 6941) - Until end of turn, target creature gains "{T}: Return target nonland permanent to its owner's hand."
39. Fading Hope (EDHREC 7164) - Return target creature to its owner's hand.
40. Colfenor, the Last Yew (EDHREC 7246) - Whenever Colfenor or another creature you control dies, return up to one other target creature card with lesser toughness from your graveyard to your hand.
41. Boneyard Lurker (EDHREC 7484) - Whenever this creature mutates, return target permanent card from your graveyard to your hand.
42. Alchemist's Retrieval (EDHREC 7717) - Return target nonland permanent [you control] to its owner's hand.
43. Soul Manipulation (EDHREC 7733) - • Return target creature card from your graveyard to your hand.
44. Ardent Elementalist (EDHREC 7754) - When this creature enters, return target instant or sorcery card from your graveyard to your hand.
45. You Come to a River (EDHREC 7855) - • Fight the Current — Return target nonland permanent to its owner's hand.
46. Man-o'-War (EDHREC 7863) - When this creature enters, return target creature to its owner's hand.
47. Elvish Regrower (EDHREC 8044) - When this creature enters, return target permanent card from your graveyard to your hand.
48. Golgari Findbroker (EDHREC 8179) - When this creature enters, return target permanent card from your graveyard to your hand.
49. Circle of the Land Druid (EDHREC 8288) - Natural Recovery — When this creature dies, return target land card from your graveyard to your hand.
50. Raise the Draugr (EDHREC 8303) - • Return target creature card from your graveyard to your hand.
51. Surgespanner (EDHREC 8527) - If you do, return target permanent to its owner's hand.
52. Shipwreck Dowser (EDHREC 8585) - When this creature enters, return target instant or sorcery card from your graveyard to your hand.
53. Krile Baldesion (EDHREC 8614) - Trace Aether — Whenever you cast a noncreature spell, you may return target creature card with mana value equal to that spell's mana value from your graveyard to your hand.
54. Gravedigger (EDHREC 8654) - When this creature enters, you may return target creature card from your graveyard to your hand.
55. Dream Eater (EDHREC 8679) - When you do, you may return target nonland permanent an opponent controls to its owner's hand.
56. Bygone Marvels (EDHREC 8692) - Return target permanent card from your graveyard to your hand.
57. Disentomb (EDHREC 8764) - Return target creature card from your graveyard to your hand.
58. Glissa's Retriever (EDHREC 8931) - When you do, return up to X target cards from your graveyard to your hand, where X is the number of opponents who have three or more poison counters.
59. Stickytongue Sentinel (EDHREC 8932) - When this creature enters, return up to one other target permanent you control to its owner's hand.
60. Myr Reservoir (EDHREC 8944) - {3}, {T}: Return target Myr card from your graveyard to your hand.
61. Winds of Rebuke (EDHREC 8968) - Return target nonland permanent to its owner's hand.
62. Raise Dead (EDHREC 9083) - Return target creature card from your graveyard to your hand.
63. Ravos, Soultender (EDHREC 9098) - At the beginning of your upkeep, you may return target creature card from your graveyard to your hand.
64. Loamcrafter Faun (EDHREC 9173) - When you do, return up to that many target nonland permanent cards from your graveyard to your hand.
65. Glissa, the Traitor (EDHREC 9260) - Whenever a creature an opponent controls dies, you may return target artifact card from your graveyard to your hand.
66. This Town Ain't Big Enough (EDHREC 9278) - Return up to two target nonland permanents to their owners' hands.
67. Groundskeeper (EDHREC 9284) - {1}{G}: Return target basic land card from your graveyard to your hand.
68. Depart the Realm (EDHREC 9294) - Return target nonland permanent to its owner's hand.
69. Monk Class (EDHREC 9424) - When this Class becomes level 2, return up to one target nonland permanent to its owner's hand.
70. Otrimi, the Ever-Playful (EDHREC 9559) - Whenever this creature deals combat damage to a player, return target creature card with mutate from your graveyard to your hand.
71. Unauthorized Exit (EDHREC 9587) - Return target nonland permanent to its owner's hand.
72. March of the Drowned (EDHREC 9672) - • Return target creature card from your graveyard to your hand.
73. Cadaver Imp (EDHREC 9678) - When this creature enters, you may return target creature card from your graveyard to your hand.
74. Reality Strobe (EDHREC 9870) - Return target permanent to its owner's hand.
75. Scholar of the Ages (EDHREC 9883) - When this creature enters, return up to two target instant and/or sorcery cards from your graveyard to your hand.
76. Road of Return (EDHREC 9978) - • Return target permanent card from your graveyard to your hand.
77. Expel from Orazca (EDHREC 10101) - Return target nonland permanent to its owner's hand.
78. Walker of Secret Ways (EDHREC 10128) - {1}{U}: Return target Ninja you control to its owner's hand.
79. Bounce Off (EDHREC 10138) - Return target creature or Vehicle to its owner's hand.
80. Reap (EDHREC 10181) - Return up to X target cards from your graveyard to your hand, where X is the number of black permanents target opponent controls as you cast this spell.
81. Galecaster Colossus (EDHREC 10198) - Tap an untapped Wizard you control: Return target nonland permanent you don't control to its owner's hand.
82. Ice Magic (EDHREC 10211) - • Blizzard — {0} — Return target creature to its owner's hand.
83. Treasured Find (EDHREC 10303) - Return target card from your graveyard to your hand.
84. Zuko's Conviction (EDHREC 10314) - Return target creature card from your graveyard to your hand.
85. Ephara's Dispersal (EDHREC 10327) - Return target creature to its owner's hand.
86. Argivian Find (EDHREC 10348) - Return target artifact or enchantment card from your graveyard to your hand.
87. Call to Mind (EDHREC 10356) - Return target instant or sorcery card from your graveyard to your hand.
88. Keeper of the Nine Gales (EDHREC 10376) - {T}, Tap two untapped Birds you control: Return target permanent to its owner's hand.
89. Unbury (EDHREC 10456) - • Return target creature card from your graveyard to your hand.
90. Elder Owyn Lyons (EDHREC 10667) - When Elder Owyn Lyons enters or dies, return target artifact card from your graveyard to your hand.
91. Ozox, the Clattering King (EDHREC 10687) - When Ozox dies, create Jumblebones, a legendary 2/1 black Skeleton creature token with "Jumblebones can't block" and "When Jumblebones leaves the battlefield, return target card named Ozox, the Clattering King from your graveyard to your hand."
92. Greasefang, Okiba Boss (EDHREC 10712) - At the beginning of combat on your turn, return target Vehicle card from your graveyard to the battlefield. It gains haste. Return it to its owner's hand at the beginning of your next end step.
93. Chakra Meditation (EDHREC 10723) - When this enchantment enters, return up to one target instant or sorcery card from your graveyard to your hand.
94. Cresting Mosasaurus (EDHREC 10757) - When this creature enters, if you cast it, return each non-Dinosaur creature to its owner's hand.
95. Pull Through the Weft (EDHREC 10759) - Return up to two target nonland permanent cards from your graveyard to your hand, then return up to two target land cards from your graveyard to the battlefield tapped.
96. Imperial Recovery Unit (EDHREC 10806) - Whenever this Vehicle attacks, return target creature or Vehicle card with mana value 2 or less from your graveyard to your hand.
97. Kirri, Talented Sprout (EDHREC 10950) - At the beginning of each of your postcombat main phases, return target Plant, Treefolk, or land card from your graveyard to your hand.
98. Undertaker (EDHREC 11022) - {B}, {T}, Discard a card: Return target creature card from your graveyard to your hand.
99. Equilibrium (EDHREC 11023) - If you do, return target creature to its owner's hand.
100. Lore Drakkis (EDHREC 11108) - Whenever this creature mutates, return target instant or sorcery card from your graveyard to your hand.
101. Murasa Rootgrazer (EDHREC 11116) - {T}: Return target basic land you control to its owner's hand.
102. Auriok Salvagers (EDHREC 11166) - {1}{W}: Return target artifact card with mana value 1 or less from your graveyard to your hand.
103. Return from Extinction (EDHREC 11176) - • Return target creature card from your graveyard to your hand.
104. Harbinger of the Tides (EDHREC 11201) - When this creature enters, you may return target tapped creature an opponent controls to its owner's hand.
105. Stern Dismissal (EDHREC 11274) - Return target creature or enchantment an opponent controls to its owner's hand.
106. Fumble (EDHREC 11328) - Return target creature to its owner's hand.
107. Fates' Reversal (EDHREC 11348) - Return up to one target creature card from your graveyard to your hand.
108. Season of Renewal (EDHREC 11374) - • Return target creature card from your graveyard to your hand.
109. Corpse Cur (EDHREC 11406) - When this creature enters, you may return target creature card with infect from your graveyard to your hand.
110. Paleoloth (EDHREC 11416) - Whenever another creature you control with power 5 or greater enters, you may return target creature card from your graveyard to your hand.
111. Temporal Fissure (EDHREC 11426) - Return target permanent to its owner's hand.
112. Courier Bat (EDHREC 11460) - When this creature enters, if you gained life this turn, return up to one target creature card from your graveyard to your hand.
113. Edgar's Awakening (EDHREC 11473) - When you do, return target creature card from your graveyard to your hand.
114. Aethersnipe (EDHREC 11645) - When this creature enters, return target nonland permanent to its owner's hand.
115. Enigma Thief (EDHREC 11653) - When this creature enters, for each opponent, return up to one target nonland permanent that player controls to its owner's hand.
116. Wort, Boggart Auntie (EDHREC 11713) - At the beginning of your upkeep, you may return target Goblin card from your graveyard to your hand.
117. Gravedig (EDHREC 11719) - • Return target creature card from your graveyard to your hand.
118. Revolutionist (EDHREC 11811) - When this creature enters, return target instant or sorcery card from your graveyard to your hand.
119. Walk with the Ancestors (EDHREC 11824) - Return up to one target permanent card from your graveyard to your hand.
120. Spider-Byte, Web Warden (EDHREC 11838) - When Spider-Byte enters, return up to one target nonland permanent to its owner's hand.
121. Aid the Fallen (EDHREC 11840) - • Return target creature card from your graveyard to your hand.
122. Mischievous Pup (EDHREC 11937) - When this creature enters, return up to one other target permanent you control to its owner's hand.
123. Badlands Revival (EDHREC 12018) - Return up to one target permanent card from your graveyard to your hand.
124. Eject (EDHREC 12053) - Return target nonland permanent to its owner's hand.
125. Ironclad Slayer (EDHREC 12072) - When this creature enters, you may return target Aura or Equipment card from your graveyard to your hand.
126. Tombstone, Career Criminal (EDHREC 12084) - When Tombstone enters, return target Villain card from your graveyard to your hand.
127. Cephalid Constable (EDHREC 12088) - Whenever this creature deals combat damage to a player, return up to that many target permanents that player controls to their owner's hand.
128. Escape Detection (EDHREC 12099) - Return target creature to its owner's hand.
129. Soul Transfer (EDHREC 12101) - • Return target creature or planeswalker card from your graveyard to your hand.
130. Aether Adept (EDHREC 12125) - When this creature enters, return target creature to its owner's hand.
131. Water Whip (EDHREC 12141) - Return up to two target creatures to their owners' hands.
132. Custodi Squire (EDHREC 12180) - Return each card with the most votes or tied for most votes to your hand.
133. Nature's Spiral (EDHREC 12199) - Return target permanent card from your graveyard to your hand.
134. Revive (EDHREC 12246) - Return target green card from your graveyard to your hand.
135. Disperse (EDHREC 12262) - Return target nonland permanent to its owner's hand.
136. Repeal (EDHREC 12284) - Return target nonland permanent with mana value X to its owner's hand.
137. Fortuitous Find (EDHREC 12391) - • Return target artifact card from your graveyard to your hand.
138. Tidecaller Mentor (EDHREC 12439) - Threshold — When this creature enters, if there are seven or more cards in your graveyard, return up to one target nonland permanent to its owner's hand.
139. Mourner's Surprise (EDHREC 12521) - Return up to one target creature card from your graveyard to your hand.
140. Cauldron Dance (EDHREC 12536) - Cast this spell only during combat. Return target creature card from your graveyard to the battlefield. That creature gains haste. Return it to your hand at the beginning of the next end step. You may put a creature card from your hand onto the battlefield....
141. Whirlpool Whelm (EDHREC 12582) - Clash with an opponent, then return target creature to its owner's hand.
142. Spider-Man 2099, Miguel O'Hara (EDHREC 12602) - When Spider-Man 2099 enters, return up to one target creature to its owner's hand.
143. Deny Reality (EDHREC 12647) - Return target permanent to its owner's hand.
144. Blood Beckoning (EDHREC 12716) - Return target creature card from your graveyard to your hand.
145. Whoosh! (EDHREC 12803) - Return target nonland permanent to its owner's hand.
146. Supplant Form (EDHREC 12873) - Return target creature to its owner's hand.
147. Ghoulcaller's Chant (EDHREC 12897) - • Return target creature card from your graveyard to your hand.
148. Wail of the Forgotten (EDHREC 12909) - • Return target nonland permanent to its owner's hand.
149. Loran, Disciple of History (EDHREC 12980) - Whenever Loran or another legendary creature you control enters, return target artifact card from your graveyard to your hand.
150. Karai, Future of the Foot (EDHREC 12999) - Whenever Karai deals combat damage to a player, return target creature card from your graveyard to your hand.
151. Recollect (EDHREC 13057) - Return target card from your graveyard to your hand.
152. Coati Scavenger (EDHREC 13200) - Descend 4 — When this creature enters, if there are four or more permanent cards in your graveyard, return target permanent card from your graveyard to your hand.
153. Flock Impostor (EDHREC 13320) - When this creature enters, return up to one other target creature you control to its owner's hand.
154. Angel of Flight Alabaster (EDHREC 13371) - At the beginning of your upkeep, return target Spirit card from your graveyard to your hand.
155. Inscription of Insight (EDHREC 13467) - • Return up to two target creatures to their owners' hands.
156. Sunpearl Kirin (EDHREC 13490) - When this creature enters, return up to one other target nonland permanent you control to its owner's hand.
157. Absorb Identity (EDHREC 13656) - Return target creature to its owner's hand.
158. Recover (EDHREC 13738) - Return target creature card from your graveyard to your hand.
159. Boing! (EDHREC 13815) - Return target creature to its owner's hand, then roll a six-sided die.
160. Horses of the Bruinen (EDHREC 13851) - Return up to two target creatures to their owners' hands.
161. Silent Departure (EDHREC 13878) - Return target creature to its owner's hand.
162. Salvager of Secrets (EDHREC 13896) - When this creature enters, return target instant or sorcery card from your graveyard to your hand.
163. Gust of Wind (EDHREC 13911) - Return target nonland permanent you don't control to its owner's hand.
164. Once and Future (EDHREC 13912) - Return target card from your graveyard to your hand.
165. Skeleton Shard (EDHREC 14098) - {3}, {T} or {B}, {T}: Return target artifact creature card from your graveyard to your hand.
166. Void Snare (EDHREC 14102) - Return target nonland permanent to its owner's hand.
167. Super Mutant Scavenger (EDHREC 14135) - When this creature enters or dies, return up to one target Aura or Equipment card from your graveyard to your hand.
168. Machine Over Matter (EDHREC 14138) - Return target nonland permanent to its owner's hand.
169. Bigfin Bouncer (EDHREC 14159) - When this creature enters, return target creature an opponent controls to its owner's hand.
170. Maestros Confluence (EDHREC 14208) - • Return target monocolored instant or sorcery card from your graveyard to your hand.
171. Rite of Renewal (EDHREC 14215) - Return up to two target permanent cards from your graveyard to your hand.
172. Desculpting Blast (EDHREC 14332) - Return target nonland permanent to its owner's hand.
173. Wail of War (EDHREC 14354) - • Return up to two target creature cards from your graveyard to your hand.
174. Rydia's Return (EDHREC 14433) - • Return up to two target permanent cards from your graveyard to your hand.
175. Macabre Reconstruction (EDHREC 14439) - Return up to two target creature cards from your graveyard to your hand.
176. Diabolic Servitude (EDHREC 14596) - When this enchantment enters, return target creature card from your graveyard to the battlefield. When the creature put onto the battlefield with this enchantment dies, exile it and return this enchantment to its owner's hand. When this enchantment leaves t...
177. Soul of Innistrad (EDHREC 14640) - {3}{B}{B}: Return up to three target creature cards from your graveyard to your hand.
178. Just the Wind (EDHREC 14677) - Return target creature to its owner's hand.
179. Retrieve (EDHREC 14713) - Return up to one target creature card and up to one target noncreature permanent card from your graveyard to your hand.
180. Nurturing Pixie (EDHREC 14717) - When this creature enters, return up to one target non-Faerie, nonland permanent you control to its owner's hand.
181. Sentinel of Lost Lore (EDHREC 14728) - • Return target card you own in exile that has an Adventure to your hand.
182. Reborn Hope (EDHREC 14751) - Return target multicolored card from your graveyard to your hand.
183. Shreds of Sanity (EDHREC 14752) - Return up to one target instant card and up to one target sorcery card from your graveyard to your hand, then discard a card.
184. Nimraiser Paladin (EDHREC 14799) - When this creature enters, return target creature card with mana value 3 or less from your graveyard to your hand.
185. Exclusion Mage (EDHREC 14832) - When this creature enters, return target creature an opponent controls to its owner's hand.
186. Seeds of Renewal (EDHREC 14835) - Return up to two target cards from your graveyard to your hand.
187. Sanguine Indulgence (EDHREC 14840) - Return up to two target creature cards from your graveyard to your hand.
188. Wipe Away (EDHREC 14855) - Return target permanent to its owner's hand.
189. Winter Eladrin (EDHREC 14865) - Gust of Wind — When this creature enters, return up to one other target creature to its owner's hand.
190. Shepherd of the Clouds (EDHREC 14888) - When this creature enters, return target permanent card with mana value 3 or less from your graveyard to your hand.
191. Grim Discovery (EDHREC 15051) - • Return target creature card from your graveyard to your hand.
192. Calamitous Tide (EDHREC 15097) - Return up to two target creatures to their owners' hands.
193. Voyage's End (EDHREC 15173) - Return target creature to its owner's hand.
194. Boggart Birth Rite (EDHREC 15174) - Return target Goblin card from your graveyard to your hand.
195. Archaeomender (EDHREC 15179) - When this creature enters, return target artifact card from your graveyard to your hand.
196. Spectral Shepherd (EDHREC 15193) - {1}{U}: Return target Spirit you control to its owner's hand.
197. Storm of Forms (EDHREC 15230) - Return target nonland permanent to its owner's hand.
198. Damage Control Crew (EDHREC 15238) - • Repair — Return target card with mana value 4 or greater from your graveyard to your hand.
199. Specimen Freighter (EDHREC 15258) - When this Spacecraft enters, return up to two target non-Spacecraft creatures to their owners' hands.
200. Disruptor of Currents (EDHREC 15311) - When this creature enters, return up to one other target nonland permanent to its owner's hand.

### 2. Discard Effects

Source: existing queue family after library_search
Available after current queue exclusion: 1204

1. Otawara, Soaring City (EDHREC 91) - Channel — {3}{U}, Discard this card: Return target artifact, creature, enchantment, or planeswalker to its owner's hand.
2. Windfall (EDHREC 147) - Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way.
3. Takenuma, Abandoned Mire (EDHREC 239) - Channel — {3}{B}, Discard this card: Mill three cards, then return a creature or planeswalker card from your graveyard to your hand.
4. Necropotence (EDHREC 501) - Whenever you discard a card, exile that card from your graveyard.
5. Sword of Feast and Famine (EDHREC 538) - Whenever equipped creature deals combat damage to a player, that player discards a card and you untap all lands you control.
6. Plaguecrafter (EDHREC 613) - Each player who can't discards a card.
7. Dark Deal (EDHREC 1457) - Each player discards all the cards in their hand, then draws that many cards minus one.
8. Shigeki, Jukai Visionary (EDHREC 1608) - Channel — {X}{X}{G}{G}, Discard this card: Return X target nonlegendary cards from your graveyard to your hand.
9. Fomori Vault (EDHREC 1618) - {3}, {T}, Discard a card: Look at the top X cards of your library, where X is the number of artifacts you control.
10. Reforge the Soul (EDHREC 1747) - Each player discards their hand, then draws seven cards.
11. Touch the Spirit Realm (EDHREC 1760) - Channel — {1}{W}, Discard this card: Exile target artifact or creature.
12. Jace's Archivist (EDHREC 1893) - {U}, {T}: Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way.
13. Maha, Its Feathers Night (EDHREC 1983) - Ward—Discard a card.
14. Containment Construct (EDHREC 2101) - Whenever you discard a card, you may exile that card from your graveyard.
15. Party Thrasher (EDHREC 2149) - At the beginning of your first main phase, you may discard a card.
16. Burglar Rat (EDHREC 2526) - When this creature enters, each opponent discards a card.
17. Witch-king of Angmar (EDHREC 2802) - Discard a card: Witch-king of Angmar gains indestructible until end of turn.
18. Dragon Mage (EDHREC 2829) - Whenever this creature deals combat damage to a player, each player discards their hand, then draws seven cards.
19. Necrogoyf (EDHREC 2843) - At the beginning of each player's upkeep, that player discards a card.
20. Liliana of the Veil (EDHREC 2868) - +1: Each player discards a card.
21. Tinybones, Bauble Burglar (EDHREC 2997) - Whenever an opponent discards a card, exile it from their graveyard with a stash counter on it.
22. Skirge Familiar (EDHREC 3005) - Discard a card: Add {B}.
23. Whispering Madness (EDHREC 3083) - Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way.
24. Chain of Smog (EDHREC 3147) - Target player discards two cards.
25. Oppression (EDHREC 3171) - Whenever a player casts a spell, that player discards a card.
26. Duress (EDHREC 3218) - That player discards that card.
27. Pack Rat (EDHREC 3375) - {2}{B}, Discard a card: Create a token that's a copy of this creature.
28. Markov Baron (EDHREC 3424) - Madness {2}{B} (If you discard this card, discard it into exile.
29. Wheel of Fate (EDHREC 3464) - Each player discards their hand, then draws seven cards.
30. Virus Beetle (EDHREC 3983) - When this creature enters, each opponent discards a card.
31. Balor (EDHREC 4037) - • Target opponent draws three cards, then discards three cards at random.
32. Foil (EDHREC 4250) - You may discard an Island card and another card rather than pay this spell's mana cost.
33. Liliana's Triumph (EDHREC 4268) - If you control a Liliana planeswalker, each opponent also discards a card.
34. Nezumi Informant (EDHREC 4367) - When this creature enters, each opponent discards a card.
35. Elderfang Disciple (EDHREC 4503) - When this creature enters, each opponent discards a card.
36. Rush of Dread (EDHREC 4553) - + {2} — Target opponent discards half the cards in their hand, rounded up.
37. Rotting Regisaur (EDHREC 5140) - At the beginning of your upkeep, discard a card.
38. Anvil of Bogardan (EDHREC 5303) - At the beginning of each player's draw step, that player draws an additional card, then discards a card.
39. Honden of Night's Reach (EDHREC 5333) - At the beginning of your upkeep, target opponent discards a card for each Shrine you control.
40. Bottomless Pit (EDHREC 5403) - At the beginning of each player's upkeep, that player discards a card at random.
41. Macabre Waltz (EDHREC 5441) - Return up to two target creature cards from your graveyard to your hand, then discard a card.
42. Monastery Siege (EDHREC 5566) - • Khans — At the beginning of your draw step, draw an additional card, then discard a card.
43. Armix, Filigree Thrasher (EDHREC 5704) - Whenever Armix attacks, you may discard a card.
44. Victor, Valgavoth's Seneschal (EDHREC 5749) - If it's the second time, each opponent discards a card.
45. Necrogen Mists (EDHREC 6275) - At the beginning of each player's upkeep, that player discards a card.
46. Grief (EDHREC 6398) - That player discards that card.
47. Arna Kennerüd, Skycaptain (EDHREC 6928) - Ward—Discard a card.
48. Lord Xander, the Collector (EDHREC 7099) - When Lord Xander enters, target opponent discards half the cards in their hand, rounded down.
49. Stronghold Rats (EDHREC 7269) - Whenever this creature deals combat damage to a player, each player discards a card.
50. Circular Logic (EDHREC 7349) - Madness {U} (If you discard this card, discard it into exile.
51. Delirium Skeins (EDHREC 7413) - Each player discards three cards.
52. Bog Witch (EDHREC 7491) - {B}, {T}, Discard a card: Add {B}{B}{B}.
53. Wasteland Viper (EDHREC 7637) - Bloodrush — {G}, Discard this card: Target attacking creature gets +1/+2 and gains deathtouch until end of turn.
54. Moonsnare Prototype (EDHREC 7658) - Channel — {4}{U}, Discard this card: The owner of target nonland permanent puts it on their choice of the top or bottom of their library.
55. Cunning Lethemancer (EDHREC 7817) - At the beginning of your upkeep, each player discards a card.
56. Mind Over Matter (EDHREC 8074) - Discard a card: You may tap or untap target artifact, creature, or land.
57. Mind Rake (EDHREC 8135) - Target player discards two cards.
58. Fraying Omnipotence (EDHREC 8227) - Each player loses half their life, then discards half the cards in their hand, then sacrifices half the creatures they control of their choice.
59. Mirrorshell Crab (EDHREC 8312) - Channel — {2}{U}, Discard this card: Counter target spell or ability unless its controller pays {3}.
60. Hypnotic Specter (EDHREC 8401) - Whenever this creature deals damage to an opponent, that player discards a card at random.
61. Inquisition of Kozilek (EDHREC 8783) - That player discards that card.
62. Pilfer (EDHREC 8853) - That player discards that card.
63. Awaken the Erstwhile (EDHREC 8973) - Each player discards all the cards in their hand, then creates that many 2/2 black Zombie creature tokens.
64. Khorvath's Fury (EDHREC 9129) - Each friend discards all cards from their hand, then draws that many cards plus one.
65. Hecteyes (EDHREC 9149) - When this creature enters, each opponent discards a card.
66. Loamcrafter Faun (EDHREC 9173) - When this creature enters, you may discard one or more land cards.
67. Capital Punishment (EDHREC 9229) - Each opponent sacrifices a creature of their choice for each death vote and discards a card for each taxes vote.
68. Blazing Rootwalla (EDHREC 9315) - Madness {0} (If you discard this card, discard it into exile.
69. Okiba-Gang Shinobi (EDHREC 9335) - Whenever this creature deals combat damage to a player, that player discards two cards.
70. Rix Maadi, Dungeon Palace (EDHREC 9338) - {1}{B}{R}, {T}: Each player discards a card.
71. Stromkirk Occultist (EDHREC 9345) - Madness {1}{R} (If you discard this card, discard it into exile.
72. Hymn to Tourach (EDHREC 9384) - Target player discards two cards at random.
73. Nephalia Academy (EDHREC 9490) - If a spell or ability an opponent controls causes you to discard a card, you may reveal that card and put it on top of your library instead of putting it anywhere else.
74. Liliana's Specter (EDHREC 9509) - When this creature enters, each opponent discards a card.
75. Cavern Whisperer (EDHREC 9563) - Whenever this creature mutates, each opponent discards a card.
76. Reality Smasher (EDHREC 9785) - Whenever this creature becomes the target of a spell an opponent controls, counter that spell unless its controller discards a card.
77. Prognostic Sphinx (EDHREC 9877) - Discard a card: This creature gains hexproof until end of turn.
78. Death Cloud (EDHREC 9928) - Each player loses X life, discards X cards, sacrifices X creatures of their choice, then sacrifices X lands of their choice.
79. Sycorax Commander (EDHREC 10075) - Sanctified Rules of Combat — When this creature enters, each opponent faces a villainous choice — That opponent discards all the cards in their hand, then draws that many cards minus one, or this creature deals damage to that player equal to the number of cards in their hand.
80. Thoughtrender Lamia (EDHREC 10389) - Constellation — Whenever this creature or another enchantment you control enters, each opponent discards a card.
81. Tireless Tribe (EDHREC 10445) - Discard a card: This creature gets +0/+4 until end of turn.
82. Oildeep Gearhulk (EDHREC 10608) - If you do, that player discards that card, then draws a card.
83. Hobgoblin, Mantled Marauder (EDHREC 10705) - Whenever you discard a card, Hobgoblin gets +2/+0 until end of turn.
84. Noose Constrictor (EDHREC 10707) - Discard a card: This creature gets +1/+1 until end of turn.
85. Chakra Meditation (EDHREC 10723) - Then discard a card unless there are three or more Lesson cards in your graveyard.
86. Falkenrath Gorger (EDHREC 10901) - (If you discard a card with madness, discard it into exile.
87. Undertaker (EDHREC 11022) - {B}, {T}, Discard a card: Return target creature card from your graveyard to your hand.
88. Elvish Doomsayer (EDHREC 11120) - When this creature dies, each opponent discards a card.
89. Ravenous Rats (EDHREC 11151) - When this creature enters, target opponent discards a card.
90. Byway Barterer (EDHREC 11184) - Menace Whenever you expend 4, you may discard your hand. If you do, draw two cards. (You expend 4 as you spend your fourth total mana to cast spells during a turn.)
91. Dreadwing Scavenger (EDHREC 11191) - Whenever this creature enters or attacks, draw a card, then discard a card.
92. Alpharael, Stonechosen (EDHREC 11323) - Ward—Discard a card at random.
93. Fearless Swashbuckler (EDHREC 11346) - Whenever you attack, if a Pirate and a Vehicle attacked this combat, draw three cards, then discard two cards.
94. Kitchen Imp (EDHREC 11363) - Madness {B} (If you discard this card, discard it into exile.
95. Wilt-Leaf Liege (EDHREC 11377) - If a spell or ability an opponent controls causes you to discard this card, put it onto the battlefield instead of putting it into your graveyard.
96. Saruman of Many Colors (EDHREC 11430) - Ward—Discard an enchantment, instant, or sorcery card.
97. Horrid Shadowspinner (EDHREC 11464) - If you do, discard that many cards.
98. Edgar's Awakening (EDHREC 11473) - When you discard this card, you may pay {B}.
99. Fell Flagship (EDHREC 11488) - Whenever this Vehicle deals combat damage to a player, that player discards a card.
100. Akki Ronin (EDHREC 11542) - Whenever a Samurai or Warrior you control attacks alone, you may discard a card.
101. Strix Lookout (EDHREC 11571) - {1}{U}, {T}: Draw a card, then discard a card.
102. Bite of the Black Rose (EDHREC 11644) - If psychosis gets more votes or the vote is tied, each opponent discards two cards.
103. Locke Cole (EDHREC 11675) - Whenever Locke Cole deals combat damage to a player, draw a card, then discard a card.
104. Peer Past the Veil (EDHREC 11726) - Discard your hand. Then draw X cards, where X is the number of card types among cards in your graveyard.
105. Adventurer's Airship (EDHREC 11773) - Whenever this Vehicle attacks, draw a card, then discard a card.
106. Lluwen, Imperfect Naturalist (EDHREC 11791) - {2}{B/G}{B/G}{B/G}, {T}, Discard a land card: Create a 1/1 black and green Worm creature token for each land card in your graveyard.
107. Revolutionist (EDHREC 11811) - Madness {3}{R} (If you discard this card, discard it into exile.
108. Ancestral Reminiscence (EDHREC 11818) - Draw three cards, then discard a card.
109. Whiskerquill Scribe (EDHREC 11830) - Valiant — Whenever this creature becomes the target of a spell or ability you control for the first time each turn, you may discard a card.
110. Disinformation Campaign (EDHREC 11843) - When this enchantment enters, you draw a card and each opponent discards a card.
111. Unnerve (EDHREC 11935) - Each opponent discards two cards.
112. Arm-Mounted Anchor (EDHREC 11964) - Then discard two cards unless you discard a Pirate card.
113. Dragonborn Looter (EDHREC 11991) - {1}, {T}: Draw a card, then discard a card.
114. Narset, Jeskai Waymaster (EDHREC 12037) - At the beginning of your end step, you may discard your hand. If you do, draw cards equal to the number of spells you've cast this turn.
115. Oblivion Crown (EDHREC 12039) - Enchanted creature has "Discard a card: This creature gets +1/+1 until end of turn."
116. Runehorn Hellkite (EDHREC 12047) - {5}{R}, Exile this card from your graveyard: Each player discards their hand, then draws seven cards.
117. Mystic Redaction (EDHREC 12051) - Whenever you discard a card, each opponent mills two cards.
118. Body Snatcher (EDHREC 12057) - When this creature enters, exile it unless you discard a creature card.
119. Striped Riverwinder (EDHREC 12159) - Cycling {U} ({U}, Discard this card: Draw a card.)
120. Thought-Stalker Warlock (EDHREC 12175) - If they lost life this turn, they reveal their hand, you choose a nonland card from it, and they discard that card.
121. Case of the Crimson Pulse (EDHREC 12190) - When this Case enters, discard a card, then draw two cards.
122. Mind Rot (EDHREC 12215) - Target player discards two cards.
123. Into the Night (EDHREC 12249) - Discard any number of cards, then draw that many cards plus one.
124. Gorgon Recluse (EDHREC 12253) - Madness {B}{B} (If you discard this card, discard it into exile.
125. Miasmic Mummy (EDHREC 12263) - When this creature enters, each player discards a card.
126. Rubblehulk (EDHREC 12277) - Bloodrush — {1}{R}{G}, Discard this card: Target attacking creature gets +X/+X until end of turn, where X is the number of lands you control.
127. Pain Magnification (EDHREC 12315) - Whenever an opponent is dealt 3 or more damage by a single source, that player discards a card.
128. Queen Kayla bin-Kroog (EDHREC 12351) - {4}, {T}: Discard all the cards in your hand, then draw that many cards.
129. Words of Waste (EDHREC 12353) - {1}: The next time you would draw a card this turn, each opponent discards a card instead.
130. Chandra's Regulator (EDHREC 12519) - {1}, {T}, Discard a Mountain card or a red card: Draw a card.
131. Drainpipe Vermin (EDHREC 12530) - If you do, target player discards a card.
132. Savai Crystal (EDHREC 12575) - Cycling {2} ({2}, Discard this card: Draw a card.)
133. Nath of the Gilt-Leaf (EDHREC 12585) - At the beginning of your upkeep, you may have target opponent discard a card at random.
134. Oblivious Bookworm (EDHREC 12596) - If you do, discard a card unless a permanent entered the battlefield face down under your control this turn or you turned a permanent face up this turn.
135. Call the Bloodline (EDHREC 12646) - {1}, Discard a card: Create a 1/1 black Vampire Knight creature token with lifelink.
136. Nightshade Assassin (EDHREC 12650) - Madness {1}{B} (If you discard this card, discard it into exile.
137. Practical Research (EDHREC 12680) - Then discard two cards unless you discard an instant or sorcery card.
138. Mishra, Excavation Prodigy (EDHREC 12747) - {1}, {T}, Discard a card: Draw a card.
139. Pore Over the Pages (EDHREC 12773) - Draw three cards, untap up to two lands, then discard a card.
140. Complicate (EDHREC 12842) - Cycling {2}{U} ({2}{U}, Discard this card: Draw a card.)
141. Academy Wall (EDHREC 12843) - If you do, discard a card.
142. Wail of the Forgotten (EDHREC 12909) - • Target opponent discards a card.
143. Haze of Pollen (EDHREC 12913) - Cycling {3} ({3}, Discard this card: Draw a card.)
144. Pilfering Hawk (EDHREC 12932) - {S}, {T}: Draw a card, then discard a card.
145. Censor (EDHREC 12971) - Cycling {U} ({U}, Discard this card: Draw a card.)
146. Whirlwind Technique (EDHREC 12972) - Target player draws two cards, then discards a card.
147. Basri, Tomorrow's Champion (EDHREC 12989) - Cycling {2}{W} ({2}{W}, Discard this card: Draw a card.)
148. Magus of the Bazaar (EDHREC 13056) - {T}: Draw two cards, then discard three cards.
149. Thirst for Identity (EDHREC 13060) - Then discard two cards unless you discard a creature card.
150. Cloudpiercer (EDHREC 13079) - Whenever this creature mutates, you may discard a card.
151. Crosis, the Purger (EDHREC 13166) - If you do, choose a color, then that player reveals their hand and discards all cards of that color.
152. Lys Alana Scarblade (EDHREC 13182) - {T}, Discard an Elf card: Target creature gets -X/-X until end of turn, where X is the number of Elves you control.
153. Cid, Timeless Artificer (EDHREC 13234) - Cycling {W}{U} ({W}{U}, Discard this card: Draw a card.)
154. Harvester of Misery (EDHREC 13253) - {1}{B}, Discard this card: Target creature gets -2/-2 until end of turn.
155. Shattered Perception (EDHREC 13260) - Discard all the cards in your hand, then draw that many cards.
156. Gisa's Bidding (EDHREC 13287) - Madness {2}{B} (If you discard this card, discard it into exile.
157. Bedlam Reveler (EDHREC 13329) - When this creature enters, discard your hand, then draw three cards.
158. Rain of Revelation (EDHREC 13366) - Draw three cards, then discard a card.
159. Llanowar Mentor (EDHREC 13377) - {G}, {T}, Discard a card: Create a 1/1 green Elf Druid creature token named Llanowar Elves.
160. The Destined Thief (EDHREC 13402) - Whenever one or more creatures you control deal combat damage to one or more players, draw a card, then discard a card.
161. Scuttletide (EDHREC 13421) - {1}, Discard a card: Create a 0/3 blue Crab creature token.
162. Djeru's Resolve (EDHREC 13452) - Cycling {2} ({2}, Discard this card: Draw a card.)
163. Magmatic Channeler (EDHREC 13463) - {T}, Discard a card: Exile the top two cards of your library, then choose one of them.
164. Poison the Waters (EDHREC 13509) - That player discards that card.
165. Dire Undercurrents (EDHREC 13524) - Whenever a black creature you control enters, you may have target player discard a card.
166. Ill-Gotten Gains (EDHREC 13538) - Each player discards their hand, then returns up to three cards from their graveyard to their hand.
167. Chitin Gravestalker (EDHREC 13542) - Cycling {2} ({2}, Discard this card: Draw a card.)
168. Hell Mongrel (EDHREC 13594) - Discard a card: This creature gets +1/+1 until end of turn.
169. Clamorous Ironclad (EDHREC 13655) - Cycling {R} ({R}, Discard this card: Draw a card.)
170. Unexpected Assistance (EDHREC 13667) - Draw three cards, then discard a card.
171. Artificer's Epiphany (EDHREC 13699) - If you control no artifacts, discard a card.
172. Pirate Hat (EDHREC 13727) - Equipped creature gets +1/+1 and has "Whenever this creature attacks, draw a card, then discard a card."
173. Cracked Skull (EDHREC 13770) - That player discards that card.
174. Malevolent Whispers (EDHREC 13808) - Madness {3}{R} (If you discard this card, discard it into exile.
175. Wild Mongrel (EDHREC 13835) - Discard a card: This creature gets +1/+1 and becomes the color of your choice until end of turn.
176. Divest (EDHREC 13847) - That player discards that card.
177. Blizzard Specter (EDHREC 13859) - • That player discards a card.
178. Curse of Chaos (EDHREC 13900) - Whenever a player attacks enchanted player with one or more creatures, that attacking player may discard a card.
179. Crystal Carapace (EDHREC 13915) - Cycling {2} ({2}, Discard this card: Draw a card.)
180. Stall Out (EDHREC 13926) - Cycling {2} ({2}, Discard this card: Draw a card.)
181. Sage of the Falls (EDHREC 13940) - If you do, discard a card.
182. Malfegor (EDHREC 13941) - Flying When Malfegor enters, discard your hand. Each opponent sacrifices a creature of their choice for each card discarded this way.
183. Dark Intimations (EDHREC 13964) - Each opponent sacrifices a creature or planeswalker of their choice, then discards a card.
184. Muck Drubb (EDHREC 13966) - Madness {2}{B} (If you discard this card, discard it into exile.
185. Suffocating Fumes (EDHREC 13991) - Cycling {2} ({2}, Discard this card: Draw a card.)
186. Azula, Ruthless Firebender (EDHREC 14055) - Whenever Azula attacks, you may discard a card.
187. Windcaller Aven (EDHREC 14065) - Cycling {U} ({U}, Discard this card: Draw a card.)
188. Go Blank (EDHREC 14079) - Target player discards two cards.
189. Careful Consideration (EDHREC 14152) - Target player draws four cards, then discards three cards.
190. Lorehold, the Historian (EDHREC 14167) - At the beginning of each opponent's upkeep, you may discard a card.
191. Extract the Truth (EDHREC 14171) - That player discards that card.
192. Skophos Reaver (EDHREC 14177) - Madness {1}{R} (If you discard this card, discard it into exile.
193. Fanatic of the Harrowing (EDHREC 14191) - When this creature enters, each player discards a card.
194. Seeker's Folly (EDHREC 14220) - • Target opponent discards two cards.
195. Tasigur's Cruelty (EDHREC 14240) - Each opponent discards two cards.
196. Pulling Teeth (EDHREC 14272) - If you win, target player discards two cards.
197. Goblin Picker (EDHREC 14321) - {R}, {T}, Discard a card: Draw a card.
198. Hollow One (EDHREC 14356) - Cycling {2} ({2}, Discard this card: Draw a card.)
199. Goblin Lore (EDHREC 14373) - Draw four cards, then discard three cards at random.
200. Rites of Refusal (EDHREC 14396) - Discard any number of cards.

### 3. Scry / Surveil / Topdeck Manipulation

Source: existing queue family after library_search
Available after current queue exclusion: 739

1. Path of Ancestry (EDHREC 14) - When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1.
2. Mosswort Bridge (EDHREC 193) - Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)
3. Temple of Epiphany (EDHREC 267) - When this land enters, scry 1.
4. Temple of Silence (EDHREC 272) - When this land enters, scry 1.
5. Temple of Triumph (EDHREC 287) - When this land enters, scry 1.
6. Temple of Mystery (EDHREC 294) - When this land enters, scry 1.
7. Temple of Enlightenment (EDHREC 295) - When this land enters, scry 1.
8. Temple of Deceit (EDHREC 313) - When this land enters, scry 1.
9. Temple of Malady (EDHREC 345) - When this land enters, scry 1.
10. Temple of Malice (EDHREC 400) - When this land enters, scry 1.
11. Thassa's Oracle (EDHREC 402) - When this creature enters, look at the top X cards of your library, where X is your devotion to blue.
12. Mystic Forge (EDHREC 426) - You may look at the top card of your library any time. You may cast artifact spells and colorless spells from the top of your library. {T}, Pay 1 life: Exile the top card of your library.
13. Undercity Sewers (EDHREC 433) - When this land enters, surveil 1.
14. Temple of Plenty (EDHREC 466) - When this land enters, scry 1.
15. Temple of Abandon (EDHREC 468) - When this land enters, scry 1.
16. Underground Mortuary (EDHREC 473) - When this land enters, surveil 1.
17. Hedge Maze (EDHREC 539) - When this land enters, surveil 1.
18. Raucous Theater (EDHREC 557) - When this land enters, surveil 1.
19. Shadowy Backstreet (EDHREC 560) - When this land enters, surveil 1.
20. Dig Through Time (EDHREC 625) - Look at the top seven cards of your library.
21. Thundering Falls (EDHREC 635) - When this land enters, surveil 1.
22. Commercial District (EDHREC 637) - When this land enters, surveil 1.
23. Windbrisk Heights (EDHREC 641) - Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)
24. Lush Portico (EDHREC 699) - When this land enters, surveil 1.
25. Meticulous Archive (EDHREC 703) - When this land enters, surveil 1.
26. Aqueous Form (EDHREC 716) - Whenever enchanted creature attacks, scry 1.
27. Spinerock Knoll (EDHREC 739) - Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)
28. Elegant Parlor (EDHREC 786) - When this land enters, surveil 1.
29. Narset, Parter of Veils (EDHREC 861) - −2: Look at the top four cards of your library.
30. Castle Vantress (EDHREC 919) - {2}{U}{U}, {T}: Scry 2.
31. Expressive Iteration (EDHREC 951) - Look at the top three cards of your library.
32. Rivendell (EDHREC 953) - {1}{U}, {T}: Scry 2.
33. Loot, Exuberant Explorer (EDHREC 981) - {4}{G}{G}, {T}: Look at the top six cards of your library.
34. Halimar Depths (EDHREC 1240) - When this land enters, look at the top three cards of your library, then put them back in any order.
35. Experimental Augury (EDHREC 1309) - Look at the top three cards of your library.
36. Kinnan, Bonder Prodigy (EDHREC 1354) - {5}{G}{U}: Look at the top five cards of your library.
37. Arid Archway (EDHREC 1429) - If another Desert was returned this way, surveil 1.
38. The Grey Havens (EDHREC 1489) - When The Grey Havens enters, scry 1.
39. Monumental Henge (EDHREC 1498) - {2}{W}{W}, {T}: Look at the top five cards of your library.
40. Planar Genesis (EDHREC 1502) - Look at the top four cards of your library.
41. Fomori Vault (EDHREC 1618) - {3}, {T}, Discard a card: Look at the top X cards of your library, where X is the number of artifacts you control.
42. Retreat to Coralhelm (EDHREC 1700) - • Scry 1.
43. Doom Whisperer (EDHREC 1779) - Pay 2 life: Surveil 2.
44. Dragon's Rage Channeler (EDHREC 1800) - Whenever you cast a noncreature spell, surveil 1.
45. Sonic Screwdriver (EDHREC 1810) - {2}, {T}: Scry 1.
46. Loran's Escape (EDHREC 1864) - Scry 1.
47. Thassa, God of the Sea (EDHREC 1875) - At the beginning of your upkeep, scry 1.
48. Conduit Pylons (EDHREC 1928) - When this land enters, surveil 1.
49. Eladamri, Korvecdal (EDHREC 2088) - You may look at the top card of your library any time. You may cast creature spells from the top of your library. {G}, {T}, Tap two untapped creatures you control: Reveal a card from your hand or the top card of your library. If you reveal a creature card t...
50. Icon of Ancestry (EDHREC 2192) - {3}, {T}: Look at the top three cards of your library.
51. Lim-Dûl's Vault (EDHREC 2272) - Look at the top five cards of your library.
52. Faerie Seer (EDHREC 2362) - When this creature enters, scry 2.
53. Hidden Grotto (EDHREC 2396) - When this land enters, surveil 1.
54. Weatherlight (EDHREC 2409) - Whenever Weatherlight deals combat damage to a player, look at the top five cards of your library.
55. Stock Up (EDHREC 2466) - Look at the top five cards of your library.
56. Impulse (EDHREC 2529) - Look at the top four cards of your library.
57. Crystal Grotto (EDHREC 2541) - When this land enters, scry 1.
58. Zhalfirin Void (EDHREC 2578) - When this land enters, scry 1.
59. Heroes' Podium (EDHREC 2581) - {X}, {T}: Look at the top X cards of your library.
60. Cemetery Tampering (EDHREC 2640) - Hideaway 5 (When this enchantment enters, look at the top five cards of your library, exile one face down, then put the rest on the bottom in a random order.)
61. Adaptive Omnitool (EDHREC 2645) - Whenever equipped creature attacks, look at the top six cards of your library.
62. Armored Skyhunter (EDHREC 2668) - Whenever this creature attacks, look at the top six cards of your library.
63. Sylvan Anthem (EDHREC 2716) - Whenever a green creature you control enters, scry 1.
64. Ureni of the Unwritten (EDHREC 2778) - Whenever Ureni enters or attacks, look at the top eight cards of your library.
65. Aetherworks Marvel (EDHREC 3257) - {T}, Pay six {E}: Look at the top six cards of your library.
66. Karumonix, the Rat King (EDHREC 3296) - When Karumonix enters, look at the top five cards of your library.
67. Florian, Voldaren Scion (EDHREC 3339) - At the beginning of each of your postcombat main phases, look at the top X cards of your library, where X is the total amount of life your opponents lost this turn.
68. Satoru Umezawa (EDHREC 3438) - Whenever you activate a ninjutsu ability, look at the top three cards of your library.
69. Gods Willing (EDHREC 3444) - Scry 1.
70. Vivien, Champion of the Wilds (EDHREC 3557) - −2: Look at the top three cards of your library.
71. Glarb, Calamity's Augur (EDHREC 3677) - {T}: Surveil 2.
72. Genesis Ultimatum (EDHREC 3699) - Look at the top five cards of your library.
73. Lilypad Village (EDHREC 3765) - {U}, {T}: Surveil 2.
74. Jace's Sanctum (EDHREC 3819) - Whenever you cast an instant or sorcery spell, scry 1.
75. Sleight of Hand (EDHREC 3936) - Look at the top two cards of your library.
76. Horn of the Mark (EDHREC 3958) - Whenever two or more creatures you control attack a player, look at the top five cards of your library.
77. Rumble Arena (EDHREC 4030) - When this land enters, scry 1.
78. Teferi, Temporal Archmage (EDHREC 4120) - +1: Look at the top two cards of your library.
79. Consult the Star Charts (EDHREC 4328) - Look at the top X cards of your library, where X is the number of lands you control.
80. Doors of Durin (EDHREC 4350) - Whenever you attack, scry 2, then you may reveal the top card of your library.
81. Gossip's Talent (EDHREC 4378) - Whenever a creature you control enters, surveil 1.
82. Titan's Strength (EDHREC 4388) - Scry 1.
83. Fblthp, Lost on the Range (EDHREC 4392) - Ward {2} You may look at the top card of your library any time. The top card of your library has plot. The plot cost is equal to its mana cost. You may plot nonland cards from the top of your library.
84. Sword of Once and Future (EDHREC 4483) - Whenever equipped creature deals combat damage to a player, surveil 2.
85. Astor, Bearer of Blades (EDHREC 4536) - When Astor enters, look at the top seven cards of your library.
86. Calix, Destiny's Hand (EDHREC 4579) - +1: Look at the top four cards of your library.
87. Mission Briefing (EDHREC 4630) - Surveil 2, then choose an instant or sorcery card in your graveyard.
88. Elvish Rejuvenator (EDHREC 4726) - When this creature enters, look at the top five cards of your library.
89. Expand the Sphere (EDHREC 4746) - Look at the top six cards of your library.
90. Winota, Joiner of Forces (EDHREC 4796) - Whenever a non-Human creature you control attacks, look at the top six cards of your library.
91. Desmond Miles (EDHREC 4830) - Whenever Desmond Miles deals combat damage to a player, surveil X, where X is the amount of damage it dealt to that player.
92. Twilight Diviner (EDHREC 4856) - When this creature enters, surveil 2.
93. Snarling Gorehound (EDHREC 4911) - Whenever another creature you control with power 2 or less enters, surveil 1.
94. Sauron's Ransom (EDHREC 4923) - They look at the top four cards of your library and separate them into a face-down pile and a face-up pile.
95. Restless Spire (EDHREC 4947) - Whenever this land attacks, scry 1.
96. Quandrix Campus (EDHREC 4964) - {4}, {T}: Scry 1.
97. Djeru and Hazoret (EDHREC 4977) - Whenever Djeru and Hazoret attacks, look at the top six cards of your library.
98. Valley Questcaller (EDHREC 5053) - Whenever one or more other Rabbits, Bats, Birds, and/or Mice you control enter, scry 1.
99. Aminatou, Veil Piercer (EDHREC 5081) - At the beginning of your upkeep, surveil 2.
100. Planetarium of Wan Shi Tong (EDHREC 5191) - {1}, {T}: Scry 2.
101. Nymris, Oona's Trickster (EDHREC 5271) - Whenever you cast your first spell during each opponent's turn, look at the top two cards of your library.
102. Kishla Village (EDHREC 5328) - {3}{G}, {T}: Surveil 2.
103. Seismic Sense (EDHREC 5334) - Look at the top X cards of your library, where X is the number of lands you control.
104. Gallifrey Council Chamber (EDHREC 5335) - When Gallifrey Council Chamber enters, surveil 1.
105. Telling Time (EDHREC 5367) - Look at the top three cards of your library.
106. Freestrider Lookout (EDHREC 5377) - Whenever you commit a crime, look at the top five cards of your library.
107. Gilgamesh, Master-at-Arms (EDHREC 5485) - Whenever Gilgamesh enters or attacks, look at the top six cards of your library.
108. Artificer's Assistant (EDHREC 5632) - Whenever you cast a historic spell, scry 1.
109. Kamahl's Druidic Vow (EDHREC 5670) - Look at the top X cards of your library.
110. Tocasia's Dig Site (EDHREC 5745) - {3}, {T}: Surveil 1.
111. Victor, Valgavoth's Seneschal (EDHREC 5749) - Eerie — Whenever an enchantment you control enters and whenever you fully unlock a Room, surveil 2 if this is the first time this ability has resolved this turn.
112. Clive's Hideaway (EDHREC 5781) - Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)
113. Abhorrent Oculus (EDHREC 5815) - (Look at the top two cards of your library.
114. Zimone, Mystery Unraveler (EDHREC 5824) - (To manifest dread, look at the top two cards of your library.
115. Hauntwoods Shrieker (EDHREC 5837) - (Look at the top two cards of your library.
116. Perception Bobblehead (EDHREC 5846) - {3}, {T}: Look at the top X cards of your library, where X is the number of Bobbleheads you control.
117. Evercoat Ursine (EDHREC 5888) - Hideaway 3, hideaway 3 (When this creature enters, look at the top three cards of your library, exile one face down, then put the rest on the bottom in a random order.
118. Dissolve (EDHREC 5934) - Scry 1.
119. Don't Make a Sound (EDHREC 5937) - If they do, surveil 2.
120. See the Truth (EDHREC 5972) - Look at the top three cards of your library.
121. Prismari Campus (EDHREC 5985) - {4}, {T}: Scry 1.
122. Sinister Sabotage (EDHREC 6038) - Surveil 1.
123. Lapis Orb of Dragonkind (EDHREC 6114) - When you spend this mana to cast a Dragon creature spell, scry 2.
124. Anticipate (EDHREC 6134) - Look at the top three cards of your library.
125. Nissa, Steward of Elements (EDHREC 6186) - +2: Scry 2.
126. Acclaimed Contender (EDHREC 6269) - When this creature enters, if you control another Knight, look at the top five cards of your library.
127. Laser Screwdriver (EDHREC 6296) - {2}, {T}: Surveil 1.
128. Elrond, Lord of Rivendell (EDHREC 6334) - Whenever Elrond or another creature you control enters, scry 1.
129. Dogged Detective (EDHREC 6392) - When this creature enters, surveil 2.
130. Elvish Mariner (EDHREC 6450) - Whenever this creature attacks, scry 1.
131. Lydia Frye (EDHREC 6499) - At the beginning of your end step, surveil X, where X is the number of tapped Assassins you control.
132. Master of Death (EDHREC 6506) - When this creature enters, surveil 2.
133. Condescend (EDHREC 6511) - Scry 2.
134. Cait Sith, Fortune Teller (EDHREC 6537) - Lucky Slots — At the beginning of combat on your turn, scry 1, then exile the top card of your library.
135. Dragonlord Ojutai (EDHREC 6577) - Whenever Dragonlord Ojutai deals combat damage to a player, look at the top three cards of your library.
136. Accumulate Wisdom (EDHREC 6584) - Look at the top three cards of your library.
137. Kaalia, Zenith Seeker (EDHREC 6629) - When Kaalia enters, look at the top six cards of your library.
138. Mana Geode (EDHREC 6633) - When this artifact enters, scry 1.
139. Boromir, Gondor's Hope (EDHREC 6662) - Whenever Boromir enters or attacks, look at the top six cards of your library.
140. Cream of the Crop (EDHREC 6672) - Whenever a creature you control enters, you may look at the top X cards of your library, where X is that creature's power.
141. Silverquill Campus (EDHREC 6682) - {4}, {T}: Scry 1.
142. Study Hall (EDHREC 6694) - When you spend this mana to cast your commander, scry X, where X is the number of times it's been cast from the command zone this game.
143. Carth the Lion (EDHREC 6709) - Whenever Carth enters or a planeswalker you control dies, look at the top seven cards of your library.
144. Owlbear Cub (EDHREC 6764) - Mama's Coming — Whenever this creature attacks a player who controls eight or more lands, look at the top eight cards of your library.
145. Psychic Impetus (EDHREC 6813) - Whenever enchanted creature attacks, you scry 2.
146. Mirri's Guile (EDHREC 6838) - At the beginning of your upkeep, you may look at the top three cards of your library, then put them back in any order.
147. Nightveil Sprite (EDHREC 6858) - Whenever this creature attacks, surveil 1.
148. Dragonologist (EDHREC 6930) - When this creature enters, look at the top six cards of your library.
149. Galadriel of Lothlórien (EDHREC 6944) - Whenever the Ring tempts you, if you chose a creature other than Galadriel as your Ring-bearer, scry 3.
150. Crystal Ball (EDHREC 7123) - {1}, {T}: Scry 2.
151. Fading Hope (EDHREC 7164) - If its mana value was 3 or less, scry 1.
152. Conjurer's Mantle (EDHREC 7177) - Whenever equipped creature attacks, look at the top six cards of your library.
153. Thassa's Intervention (EDHREC 7184) - • Look at the top X cards of your library.
154. Wall of Runes (EDHREC 7201) - When this creature enters, scry 1.
155. Watcher for Tomorrow (EDHREC 7259) - Hideaway 4 (When this creature enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)
156. Sea Gate Oracle (EDHREC 7298) - When this creature enters, look at the top two cards of your library.
157. Diabolic Vision (EDHREC 7315) - Look at the top five cards of your library.
158. Confounding Riddle (EDHREC 7397) - • Look at the top four cards of your library.
159. Oath of Nissa (EDHREC 7421) - When Oath of Nissa enters, look at the top three cards of your library.
160. Nine-Fingers Keene (EDHREC 7455) - Whenever Nine-Fingers Keene deals combat damage to a player, look at the top nine cards of your library.
161. Fortune, Loyal Steed (EDHREC 7463) - When Fortune enters, scry 2.
162. In Search of Greatness (EDHREC 7478) - If you don't, scry 1.
163. Firja, Judge of Valor (EDHREC 7497) - Whenever you cast your second spell each turn, look at the top three cards of your library.
164. Strategic Planning (EDHREC 7573) - Look at the top three cards of your library.
165. Witherbloom Campus (EDHREC 7607) - {4}, {T}: Scry 1.
166. Nessian Wanderer (EDHREC 7614) - Constellation — Whenever an enchantment you control enters, look at the top three cards of your library.
167. Silver Raven (EDHREC 7617) - When this creature enters, scry 1.
168. Mystic Speculation (EDHREC 7672) - Scry 3.
169. Radagast the Brown (EDHREC 7771) - Whenever Radagast or another nontoken creature you control enters, look at the top X cards of your library, where X is that creature's mana value.
170. Devourer of Destiny (EDHREC 7806) - If you do, at the beginning of your first upkeep, look at the top four cards of your library.
171. Ruin-Lurker Bat (EDHREC 7848) - At the beginning of your end step, if you descended this turn, scry 1.
172. Lorehold Campus (EDHREC 7908) - {4}, {T}: Scry 1.
173. Arthur, Marigold Knight (EDHREC 7964) - Whenever Arthur and at least one other creature attack, look at the top six cards of your library.
174. Velomachus Lorehold (EDHREC 7997) - Whenever Velomachus Lorehold attacks, look at the top seven cards of your library.
175. Augury Owl (EDHREC 8014) - When this creature enters, scry 3.
176. Ancient Stirrings (EDHREC 8075) - Look at the top five cards of your library.
177. Lazav, the Multifarious (EDHREC 8113) - When Lazav enters, surveil 1.
178. Web of Life and Destiny (EDHREC 8158) - At the beginning of combat on your turn, look at the top five cards of your library.
179. Case of the Shifting Visage (EDHREC 8214) - At the beginning of your upkeep, surveil 1.
180. Freeze in Place (EDHREC 8236) - Scry 2.
181. Make Your Own Luck (EDHREC 8256) - Look at the top three cards of your library.
182. Soothsaying (EDHREC 8278) - {X}: Look at the top X cards of your library, then put them back in any order.
183. Adventurous Impulse (EDHREC 8291) - Look at the top three cards of your library.
184. Zurgo and Ojutai (EDHREC 8299) - Whenever one or more Dragons you control deal combat damage to a player or battle, look at the top three cards of your library.
185. Mindwhisker (EDHREC 8328) - At the beginning of your upkeep, surveil 1.
186. Harald, King of Skemfar (EDHREC 8363) - When Harald enters, look at the top five cards of your library.
187. Kiora, Sovereign of the Deep (EDHREC 8367) - Whenever you cast a Kraken, Leviathan, Octopus, or Serpent spell from your hand, look at the top X cards of your library, where X is that spell's mana value.
188. The Temporal Anchor (EDHREC 8436) - At the beginning of your upkeep, scry 2.
189. Supreme Will (EDHREC 8443) - • Look at the top four cards of your library.
190. Model of Unity (EDHREC 8444) - Whenever players finish voting, you and each opponent who voted for a choice you voted for may scry 2.
191. Pillage the Bog (EDHREC 8447) - Look at the top X cards of your library, where X is twice the number of lands you control.
192. Sultai Ascendancy (EDHREC 8579) - At the beginning of your upkeep, surveil 2.
193. Fated Infatuation (EDHREC 8604) - If it's your turn, scry 2.
194. Dream Eater (EDHREC 8679) - When this creature enters, surveil 4.
195. Samut's Sprint (EDHREC 8702) - Scry 1.
196. Once Upon a Time (EDHREC 8748) - Look at the top five cards of your library.
197. Bronze Walrus (EDHREC 8836) - When this creature enters, scry 2.
198. Sinister Hideout (EDHREC 8892) - {4}, {T}: Surveil 1.
199. Celeborn the Wise (EDHREC 8922) - Whenever you attack with one or more Elves, scry 1.
200. Commune with Beavers (EDHREC 9137) - Look at the top three cards of your library.

### 4. Tap / Untap Effects

Source: existing queue family after library_search
Available after current queue exclusion: 507

1. Snap (EDHREC 274) - Untap up to two lands.
2. Dispatch (EDHREC 488) - Tap target creature.
3. Maze of Ith (EDHREC 517) - {T}: Untap target attacking creature.
4. Arbor Elf (EDHREC 590) - {T}: Untap target Forest.
5. Minamo, School at Water's Edge (EDHREC 599) - {U}, {T}: Untap target legendary permanent.
6. Peregrine Drake (EDHREC 887) - When this creature enters, untap up to five lands.
7. Thousand-Year Elixir (EDHREC 904) - {1}, {T}: Untap target creature.
8. Rewind (EDHREC 992) - Untap up to four lands.
9. Unwind (EDHREC 1042) - Untap up to three lands.
10. Patriar's Seal (EDHREC 1123) - {1}, {T}: Untap target legendary creature you control.
11. Retreat to Coralhelm (EDHREC 1700) - • You may tap or untap target creature.
12. Junk Winder (EDHREC 1736) - Whenever a token you control enters, tap target nonland permanent an opponent controls.
13. Deserted Temple (EDHREC 1752) - {1}, {T}: Untap target land.
14. Clock of Omens (EDHREC 1761) - Tap two untapped artifacts you control: Untap target artifact.
15. Voltaic Key (EDHREC 1841) - {1}, {T}: Untap target artifact.
16. Port Razer (EDHREC 1882) - Whenever this creature deals combat damage to a player, untap each creature you control.
17. Quirion Ranger (EDHREC 2184) - Return a Forest you control to its owner's hand: Untap target creature.
18. Tyvar, Jubilant Brawler (EDHREC 2337) - +1: Untap up to one target creature.
19. Wirewood Lodge (EDHREC 2428) - {G}, {T}: Untap target Elf.
20. Anzrag, the Quake-Mole (EDHREC 2689) - Whenever Anzrag becomes blocked, untap each creature you control.
21. Derevi, Empyrial Tactician (EDHREC 2801) - When Derevi enters and whenever a creature you control deals combat damage to a player, you may tap or untap target permanent.
22. Magewright's Stone (EDHREC 2855) - {1}, {T}: Untap target creature that has an activated ability with {T} in its cost.
23. Tiller Engine (EDHREC 3175) - • Tap target nonland permanent an opponent controls.
24. Wirewood Symbiote (EDHREC 3531) - Return an Elf you control to its owner's hand: Untap target creature.
25. All-Out Assault (EDHREC 3951) - When you next attack this turn, untap each creature you control.
26. Merrow Reejerey (EDHREC 3955) - Whenever you cast a Merfolk spell, you may tap or untap target permanent.
27. Seeker of Skybreak (EDHREC 3973) - {T}: Untap target creature.
28. Teferi, Temporal Archmage (EDHREC 4120) - −1: Untap up to four target permanents.
29. Grim Reaper's Sprint (EDHREC 4344) - When this Aura enters, untap each creature you control.
30. Earthcraft (EDHREC 4381) - Tap an untapped creature you control: Untap target basic land.
31. Hidden Strings (EDHREC 4531) - You may tap or untap target permanent, then you may tap or untap another target permanent.
32. Kelpie Guide (EDHREC 4611) - {T}: Tap target permanent.
33. Aphetto Alchemist (EDHREC 5136) - {T}: Untap target artifact or creature.
34. Scryb Ranger (EDHREC 5159) - Return a Forest you control to its owner's hand: Untap target creature.
35. Copperhorn Scout (EDHREC 5347) - Whenever this creature attacks, untap each other creature you control.
36. Ring of the Lucii (EDHREC 5416) - {2}, {T}, Pay 1 life: Tap target nonland permanent.
37. High Alert (EDHREC 5435) - {2}{W}{U}: Untap target creature.
38. Shriekwood Devourer (EDHREC 5546) - Whenever you attack with one or more creatures, untap up to X lands, where X is the greatest power among those creatures.
39. Tori D'Avenant, Fury Rider (EDHREC 5790) - Untap each other white attacking creature you control.
40. Sanctum of Tranquil Light (EDHREC 5867) - {5}{W}: Tap target creature.
41. Chakram Retriever (EDHREC 6001) - Whenever you cast a spell during your turn, untap target creature.
42. Opposition (EDHREC 6043) - Tap an untapped creature you control: Tap target artifact, creature, or land.
43. Nissa, Steward of Elements (EDHREC 6186) - −6: Untap up to two target lands you control.
44. Myr Galvanizer (EDHREC 6247) - {1}, {T}: Untap each other Myr you control.
45. Laser Screwdriver (EDHREC 6296) - {1}, {T}: Tap target artifact.
46. Elvish Mariner (EDHREC 6450) - Whenever you scry, tap up to X target nonland permanents, where X is the number of cards looked at while scrying this way.
47. Blustersquall (EDHREC 6469) - Tap target creature you don't control.
48. Merchant Raiders (EDHREC 6533) - Whenever this creature or another Pirate you control enters, tap up to one target creature.
49. Time Spiral (EDHREC 6866) - You untap up to six lands.
50. Raggadragga, Goreguts Boss (EDHREC 6973) - Whenever you cast a spell, if at least seven mana was spent to cast it, untap target creature.
51. Oboro Breezecaller (EDHREC 7009) - {2}, Return a land you control to its owner's hand: Untap target land.
52. Elder Deep-Fiend (EDHREC 7156) - When you cast this spell, tap up to four target permanents.
53. Court Street Denizen (EDHREC 7231) - Whenever another white creature you control enters, tap target creature an opponent controls.
54. Lorthos, the Tidemaker (EDHREC 7285) - If you do, tap up to eight target permanents.
55. Nature's Chosen (EDHREC 7358) - Tap enchanted creature: Untap target artifact, creature, or land.
56. Niblis of Frost (EDHREC 7544) - Whenever you cast an instant or sorcery spell, tap target creature an opponent controls.
57. You See a Guard Approach (EDHREC 7553) - • Distract the Guard — Tap target creature.
58. Ty Lee, Chi Blocker (EDHREC 7685) - When Ty Lee enters, tap up to one target creature.
59. Dreamshackle Geist (EDHREC 7846) - • Tap target creature.
60. Twiddle (EDHREC 7971) - You may tap or untap target artifact, creature, or land.
61. Treachery (EDHREC 7985) - When this Aura enters, untap up to five lands.
62. Mind Over Matter (EDHREC 8074) - Discard a card: You may tap or untap target artifact, creature, or land.
63. Forensic Researcher (EDHREC 8122) - {T}, Collect evidence 3: Tap target creature you don't control.
64. Voyaging Satyr (EDHREC 8228) - {T}: Untap target land.
65. Freeze in Place (EDHREC 8236) - Tap target creature an opponent controls and put three stun counters on it.
66. Energy Tap (EDHREC 8348) - Tap target untapped creature you control.
67. Voltaic Construct (EDHREC 8370) - {2}: Untap target artifact creature.
68. Ojutai, Soul of Winter (EDHREC 8646) - Whenever a Dragon you control attacks, tap target nonland permanent an opponent controls.
69. Urza's Rebuff (EDHREC 8728) - • Tap up to two target creatures.
70. Corridor Monitor (EDHREC 8801) - When this creature enters, untap target artifact or creature you control.
71. Mirran Spy (EDHREC 8862) - Whenever you cast an artifact spell, you may untap target creature.
72. Hyrax Tower Scout (EDHREC 9008) - When this creature enters, untap target creature.
73. Archipelagore (EDHREC 9015) - Whenever this creature mutates, tap up to X target creatures, where X is the number of times this creature has mutated.
74. High-Speed Hoverbike (EDHREC 9016) - When this Vehicle enters, tap up to one target creature.
75. Binding Mummy (EDHREC 9073) - Whenever another Zombie you control enters, you may tap target artifact or creature.
76. Frost Titan (EDHREC 9086) - Whenever this creature enters or attacks, tap target permanent.
77. Topplegeist (EDHREC 9178) - When this creature enters, tap target creature an opponent controls.
78. Octopus Umbra (EDHREC 9185) - Enchanted creature has base power and toughness 8/8 and has "Whenever this creature attacks, you may tap target creature with power 8 or less."
79. Puppet Strings (EDHREC 9320) - {2}, {T}: You may tap or untap target creature.
80. Dream's Grip (EDHREC 9416) - • Tap target permanent.
81. Clever Conjurer (EDHREC 9438) - Mage Hand — {T}: Untap target permanent not named Clever Conjurer.
82. Merfolk Trickster (EDHREC 9479) - When this creature enters, tap target creature an opponent controls.
83. Timin, Youthful Geist (EDHREC 9497) - At the beginning of each combat, tap up to one target creature.
84. Yosei, the Morning Star (EDHREC 9607) - Tap up to five target permanents that player controls.
85. Crashing Wave (EDHREC 9676) - Tap up to X target creatures, then distribute three stun counters among any number of tapped creatures your opponents control.
86. Stone-Seeder Hierophant (EDHREC 9790) - {T}: Untap target land.
87. Veteran Beastrider (EDHREC 10019) - At the beginning of your end step, untap each creature you control.
88. Dross Scorpion (EDHREC 10103) - Whenever this creature or another artifact creature dies, you may untap target artifact.
89. Icy Manipulator (EDHREC 10207) - {1}, {T}: Tap target artifact, creature, or land.
90. Krosan Restorer (EDHREC 10251) - {T}: Untap target land.
91. Pestermite (EDHREC 10302) - When this creature enters, you may tap or untap target permanent.
92. North Pole Patrol (EDHREC 10312) - Waterbend {3}, {T}: Tap target creature an opponent controls.
93. Voltaic Servant (EDHREC 10326) - At the beginning of your end step, untap target artifact.
94. Icingdeath, Frost Tyrant (EDHREC 10415) - When Icingdeath, Frost Tyrant dies, create Icingdeath, Frost Tongue, a legendary white Equipment artifact token with "Equipped creature gets +2/+0," "Whenever equipped creature attacks, tap target creature defending player controls," and equip {2}.
95. Gigadrowse (EDHREC 10417) - Tap target permanent.
96. Icebind Pillar (EDHREC 10671) - {S}, {T}: Tap target artifact or creature.
97. Cacophodon (EDHREC 10711) - Enrage — Whenever this creature is dealt damage, untap target permanent.
98. Nebelgast Herald (EDHREC 10786) - Whenever this creature or another Spirit you control enters, tap target creature an opponent controls.
99. Network Disruptor (EDHREC 10841) - When this creature enters, tap target permanent.
100. Mind Games (EDHREC 10892) - Tap target artifact, creature, or land.
101. Glare of Subdual (EDHREC 11035) - Tap an untapped creature you control: Tap target artifact or creature.
102. Sculptor of Winter (EDHREC 11243) - {T}: Untap target snow land.
103. Great Whale (EDHREC 11404) - When this creature enters, untap up to seven lands.
104. Icewrought Sentry (EDHREC 11496) - When you do, tap target creature an opponent controls.
105. Gideon's Lawkeeper (EDHREC 11525) - {W}, {T}: Tap target creature.
106. Imperial Subduer (EDHREC 11754) - Whenever a Samurai or Warrior you control attacks alone, tap target creature you don't control.
107. Abominable Treefolk (EDHREC 11849) - When this creature enters, tap target creature an opponent controls.
108. Impede Momentum (EDHREC 11950) - Tap target creature and put three stun counters on it.
109. Shacklegeist (EDHREC 11958) - Tap two untapped Spirits you control: Tap target creature you don't control.
110. Thistledown Players (EDHREC 12040) - Whenever this creature attacks, untap target nonland permanent.
111. Mouse Trapper (EDHREC 12133) - Valiant — Whenever this creature becomes the target of a spell or ability you control for the first time each turn, tap target creature an opponent controls.
112. Icefall Regent (EDHREC 12260) - When this creature enters, tap target creature an opponent controls.
113. Mental Modulation (EDHREC 12421) - Tap target artifact or creature.
114. Tranquilize (EDHREC 12451) - Tap target creature an opponent controls and put three stun counters on it.
115. Word of Seizing (EDHREC 12570) - Untap target permanent and gain control of it until end of turn.
116. Web-Shooters (EDHREC 12619) - Equipped creature gets +1/+1 and has reach and "Whenever this creature attacks, tap target creature an opponent controls."
117. Downpour (EDHREC 12705) - Tap up to three target creatures.
118. Pore Over the Pages (EDHREC 12773) - Draw three cards, untap up to two lands, then discard a card.
119. Minister of Impediments (EDHREC 12799) - {T}: Tap target creature.
120. Angelic Benediction (EDHREC 12899) - Whenever a creature you control attacks alone, you may tap target creature.
121. Guardian of Tazeem (EDHREC 12917) - Landfall — Whenever a land you control enters, tap target creature an opponent controls.
122. Katara's Reversal (EDHREC 12966) - Untap up to four target artifacts and/or creatures.
123. Flash Thompson, Spider-Fan (EDHREC 12981) - • Heckle — Tap target creature.
124. Deceiver Exarch (EDHREC 13034) - • Untap target permanent you control.
125. Eddymurk Crab (EDHREC 13236) - When this creature enters, tap up to two target creatures.
126. Djeru's Resolve (EDHREC 13452) - Untap target creature.
127. Filigree Sages (EDHREC 13525) - {2}{U}: Untap target artifact.
128. Swashbuckler's Whip (EDHREC 13553) - Equipped creature has reach, "{2}, {T}: Tap target artifact or creature," and "{8}, {T}: Discover 10." (Exile cards from the top of your library until you exile a nonland card with mana value 10 or less.
129. Niblis of the Urn (EDHREC 13564) - Whenever this creature attacks, you may tap target creature.
130. Breath of the Sleepless (EDHREC 13774) - Whenever you cast a creature spell during an opponent's turn, tap up to one target creature.
131. Feeling of Dread (EDHREC 13854) - Tap up to two target creatures.
132. Sanctuary Lockdown (EDHREC 13903) - {2}, Tap two untapped Humans you control: Tap target creature an opponent controls.
133. Stall Out (EDHREC 13926) - Tap target creature or Vehicle, then put three stun counters on it.
134. Stinging Lionfish (EDHREC 13930) - Whenever you cast your first spell during each opponent's turn, you may tap or untap target nonland permanent.
135. Juvenile Mist Dragon (EDHREC 13937) - Confounding Clouds — When this creature enters, for each opponent, tap up to one target creature that player controls.
136. Tidal Bore (EDHREC 14026) - You may tap or untap target creature.
137. Azorius Guildmage (EDHREC 14039) - {2}{W}: Tap target creature.
138. Telekinetic Sliver (EDHREC 14207) - All Slivers have "{T}: Tap target permanent."
139. Rishadan Port (EDHREC 14222) - {1}, {T}: Tap target land.
140. Pressure Point (EDHREC 14231) - Tap target creature.
141. Silvanus's Invoker (EDHREC 14420) - Conjure Elemental — {8}: Untap target land you control.
142. Rowdy Snowballers (EDHREC 14578) - When this creature enters, tap target creature an opponent controls and put a stun counter on it.
143. Glamermite (EDHREC 14641) - • Tap target creature.
144. Curse of Inertia (EDHREC 14646) - Whenever a player attacks enchanted player with one or more creatures, that attacking player may tap or untap target permanent of their choice.
145. Sewer-veillance Cam (EDHREC 14721) - When this artifact enters or leaves the battlefield, you may tap or untap target creature.
146. Nissa, Genesis Mage (EDHREC 14733) - +2: Untap up to two target creatures and up to two target lands.
147. Puppeteer (EDHREC 14887) - {U}, {T}: You may tap or untap target creature.
148. Killian, Decisive Mentor (EDHREC 14894) - Whenever an enchantment you control enters, tap up to one target creature and goad it.
149. Goldmeadow Harrier (EDHREC 14895) - {W}, {T}: Tap target creature.
150. Squall Drifter (EDHREC 14989) - {W}, {T}: Tap target creature.
151. Trusty Boomerang (EDHREC 14998) - Equipped creature has "{1}, {T}: Tap target creature.
152. Ultros, Obnoxious Octopus (EDHREC 15003) - Whenever you cast a noncreature spell, if at least four mana was spent to cast it, tap target creature an opponent controls and put a stun counter on it.
153. Scepter of Dominance (EDHREC 15005) - {W}, {T}: Tap target permanent.
154. Ojutai Exemplars (EDHREC 15017) - • Tap target creature.
155. Thunder Lasso (EDHREC 15029) - Whenever equipped creature attacks, tap target creature defending player controls.
156. Hands of Binding (EDHREC 15064) - Tap target creature an opponent controls.
157. Aim High (EDHREC 15069) - Untap target creature.
158. Gilded Scuttler (EDHREC 15091) - When this creature enters, tap target creature an opponent controls and put a stun counter on it.
159. Greenside Watcher (EDHREC 15220) - {T}: Untap target Gate.
160. Threaten (EDHREC 15233) - Untap target creature and gain control of it until end of turn.
161. Mechanozoa (EDHREC 15316) - When this creature enters, tap target artifact or creature an opponent controls and put a stun counter on it.
162. Rustvine Cultivator (EDHREC 15454) - {T}, Remove an oil counter from this creature: Untap target land.
163. You're Confronted by Robbers (EDHREC 15502) - • Stall for Time — Tap up to three target creatures.
164. White Dragon (EDHREC 15571) - Cold Breath — When this creature enters, tap target creature an opponent controls.
165. Jandor's Saddlebags (EDHREC 15659) - {3}, {T}: Untap target creature.
166. Berg Strider (EDHREC 15725) - When this creature enters, tap target artifact or creature an opponent controls.
167. Blinkmoth Well (EDHREC 15750) - {2}, {T}: Tap target noncreature artifact.
168. Skateboard (EDHREC 15906) - When this Equipment enters, tap target permanent.
169. Tidal Force (EDHREC 16019) - At the beginning of each upkeep, you may tap or untap target permanent.
170. Jolt (EDHREC 16091) - You may tap or untap target artifact, creature, or land.
171. Choking Tethers (EDHREC 16104) - Tap up to four target creatures.
172. Sentinel of the Eternal Watch (EDHREC 16134) - At the beginning of combat on each opponent's turn, tap target creature that player controls.
173. Loch Mare (EDHREC 16321) - {2}{U}, Remove two counters from this creature: Tap target creature.
174. Hope Tender (EDHREC 16398) - {1}, {T}: Untap target land.
175. Rishadan Dockhand (EDHREC 16404) - {1}, {T}: Tap target land.
176. Sunstrike Legionnaire (EDHREC 16489) - {T}: Tap target creature with mana value 3 or less.
177. Blessed Alliance (EDHREC 16556) - • Untap up to two target creatures.
178. Disciple of the Ring (EDHREC 16619) - • Tap target creature.
179. Ray of Command (EDHREC 16657) - Untap target creature an opponent controls and gain control of it until end of turn.
180. Niblis of the Breath (EDHREC 16690) - {U}, {T}: You may tap or untap target creature.
181. Fear of Immobility (EDHREC 16694) - When this creature enters, tap up to one target creature.
182. Sunstar Chaplain (EDHREC 16748) - {2}, Remove a +1/+1 counter from a creature you control: Tap target artifact or creature.
183. Frost Breath (EDHREC 16804) - Tap up to two target creatures.
184. Ivorytusk Fortress (EDHREC 16826) - Untap each creature you control with a +1/+1 counter on it during each other player's untap step.
185. Frost Trickster (EDHREC 16853) - When this creature enters, tap target creature an opponent controls.
186. Bounding Krasis (EDHREC 16880) - When this creature enters, you may tap or untap target creature.
187. Spinning Wheel (EDHREC 16889) - {5}, {T}: Tap target creature.
188. Mothrider Patrol (EDHREC 16919) - {3}{W}, {T}: Tap target creature.
189. Territorial Hammerskull (EDHREC 16990) - Whenever this creature attacks, tap target creature an opponent controls.
190. Act of Heroism (EDHREC 16991) - Untap target creature.
191. Glaring Aegis (EDHREC 17047) - When this Aura enters, tap target creature an opponent controls.
192. Sinew Dancer (EDHREC 17098) - {3}{W}, {T}: Tap target creature.
193. Griffin Canyon (EDHREC 17109) - {T}: Untap target Griffin.
194. Dungeon Geists (EDHREC 17115) - When this creature enters, tap target creature an opponent controls.
195. Champions of the Shoal (EDHREC 17132) - Whenever this creature enters or becomes tapped, tap up to one target creature and put a stun counter on it.
196. Clockwork Drawbridge (EDHREC 17145) - {2}{W}, {T}: Tap target creature.
197. Ornamental Courage (EDHREC 17157) - Untap target creature.
198. Oceanus Dragon (EDHREC 17352) - When this creature enters, tap target creature an opponent controls.
199. Sanctuary Wall (EDHREC 17431) - {2}{W}, {T}: Tap target creature.
200. Rimewind Taskmage (EDHREC 17465) - {1}, {T}: You may tap or untap target permanent.

### 5. Counterspell And Stack Interaction

Source: existing queue family after library_search
Available after current queue exclusion: 237

1. Counterspell (EDHREC 16) - Counter target spell.
2. Mana Drain (EDHREC 114) - Counter target spell.
3. Force of Will (EDHREC 191) - Counter target spell.
4. Pact of Negation (EDHREC 357) - Counter target spell.
5. Mental Misstep (EDHREC 444) - Counter target spell with mana value 1.
6. Tibalt's Trickery (EDHREC 581) - Counter target spell.
7. Rewind (EDHREC 992) - Counter target spell.
8. Rebuff the Wicked (EDHREC 1603) - Counter target spell that targets a permanent you control.
9. Mana Leak (EDHREC 1649) - Counter target spell unless its controller pays {3}.
10. Disallow (EDHREC 1826) - Counter target spell, activated ability, or triggered ability.
11. Delay (EDHREC 1912) - Counter target spell.
12. Cancel (EDHREC 2005) - Counter target spell.
13. Dawn Charm (EDHREC 2072) - • Counter target spell that targets you.
14. Mana Tithe (EDHREC 2100) - Counter target spell unless its controller pays {1}.
15. Not of This World (EDHREC 2448) - Counter target spell or ability that targets a permanent you control.
16. Disdainful Stroke (EDHREC 2539) - Counter target spell with mana value 4 or greater.
17. Saw It Coming (EDHREC 2740) - Counter target spell.
18. Wash Away (EDHREC 2787) - Counter target spell [that wasn't cast from its owner's hand].
19. Memory Lapse (EDHREC 3057) - Counter target spell.
20. Ertai Resurrected (EDHREC 3133) - • Counter target spell, activated ability, or triggered ability.
21. Render Silent (EDHREC 3168) - Counter target spell.
22. Didn't Say Please (EDHREC 3322) - Counter target spell.
23. Daze (EDHREC 3526) - Counter target spell unless its controller pays {1}.
24. Spellstutter Sprite (EDHREC 3556) - When this creature enters, counter target spell with mana value X or less, where X is the number of Faeries you control.
25. Spell Stutter (EDHREC 3837) - Counter target spell unless its controller pays {2} plus an additional {1} for each Faerie you control.
26. Dazzling Denial (EDHREC 4205) - Counter target spell unless its controller pays {2}.
27. Foil (EDHREC 4250) - Counter target spell.
28. Voidslime (EDHREC 4293) - Counter target spell, activated ability, or triggered ability.
29. Syncopate (EDHREC 4312) - Counter target spell unless its controller pays {X}.
30. Reject Imperfection (EDHREC 4465) - Counter target spell.
31. It'll Quench Ya! (EDHREC 4496) - Counter target spell unless its controller pays {2}.
32. Tale's End (EDHREC 4619) - Counter target activated ability, triggered ability, or legendary spell.
33. Wizard's Retort (EDHREC 4665) - Counter target spell.
34. Electrosiphon (EDHREC 5087) - Counter target spell.
35. Lofty Denial (EDHREC 5202) - Counter target spell unless its controller pays {1}.
36. Mystic Snake (EDHREC 5325) - When this creature enters, counter target spell.
37. No More Lies (EDHREC 5369) - Counter target spell unless its controller pays {3}.
38. Counterflux (EDHREC 5383) - Counter target spell you don't control.
39. Fear of Impostors (EDHREC 5432) - When this creature enters, counter target spell.
40. Thought Collapse (EDHREC 5472) - Counter target spell.
41. Amazing Acrobatics (EDHREC 5603) - • Counter target spell.
42. Dissolve (EDHREC 5934) - Counter target spell.
43. Don't Make a Sound (EDHREC 5937) - Counter target spell unless its controller pays {2}.
44. Sinister Sabotage (EDHREC 6038) - Counter target spell.
45. Fuel for the Cause (EDHREC 6045) - Counter target spell, then proliferate.
46. Dissipate (EDHREC 6069) - Counter target spell.
47. Disruption Protocol (EDHREC 6152) - Counter target spell.
48. Lapse of Certainty (EDHREC 6163) - Counter target spell.
49. Plasm Capture (EDHREC 6181) - Counter target spell.
50. Stoic Rebuttal (EDHREC 6412) - Counter target spell.
51. Turn Aside (EDHREC 6428) - Counter target spell that targets a permanent you control.
52. Condescend (EDHREC 6511) - Counter target spell unless its controller pays {X}.
53. Familiar's Ruse (EDHREC 6581) - Counter target spell.
54. Frilled Mystic (EDHREC 6763) - When this creature enters, you may counter target spell.
55. Temur Charm (EDHREC 6879) - • Counter target spell unless its controller pays {3}.
56. Desertion (EDHREC 7011) - Counter target spell.
57. Thassa's Intervention (EDHREC 7184) - • Counter target spell unless its controller pays twice {X}.
58. Circular Logic (EDHREC 7349) - Counter target spell unless its controller pays {1} for each card in your graveyard.
59. Kheru Spellsnatcher (EDHREC 7367) - When this creature is turned face up, counter target spell.
60. Consign to Memory (EDHREC 7395) - Counter target triggered ability or colorless spell.
61. Confounding Riddle (EDHREC 7397) - • Counter target spell unless its controller pays {4}.
62. Transcendent Dragon (EDHREC 7660) - When this creature enters, if you cast it, counter target spell.
63. Insidious Will (EDHREC 8175) - • Counter target spell.
64. Mirrorshell Crab (EDHREC 8312) - Channel — {2}{U}, Discard this card: Counter target spell or ability unless its controller pays {3}.
65. Supreme Will (EDHREC 8443) - • Counter target spell unless its controller pays {3}.
66. Spell Snare (EDHREC 8464) - Counter target spell with mana value 2.
67. Psychic Strike (EDHREC 8643) - Counter target spell.
68. Urza's Rebuff (EDHREC 8728) - • Counter target spell.
69. Ertai's Scorn (EDHREC 8824) - Counter target spell.
70. Forceful Denial (EDHREC 9002) - Counter target spell.
71. Reinterpret (EDHREC 9143) - Counter target spell.
72. Counterpoint (EDHREC 9286) - Counter target spell.
73. Twist Reality (EDHREC 9358) - • Counter target spell.
74. Deprive (EDHREC 9472) - Counter target spell.
75. Dispelling Exhale (EDHREC 9488) - Counter target spell unless its controller pays {2}.
76. Spectral Denial (EDHREC 9601) - Counter target spell unless its controller pays {X}.
77. Bring the Ending (EDHREC 9924) - Counter target spell unless its controller pays {2}.
78. Lose Focus (EDHREC 9973) - Counter target spell unless its controller pays {2}.
79. Lookout's Dispersal (EDHREC 10016) - Counter target spell unless its controller pays {4}.
80. Patron Wizard (EDHREC 10119) - Tap an untapped Wizard you control: Counter target spell unless its controller pays {1}.
81. Dash Hopes (EDHREC 10625) - Counter target spell.
82. Convolute (EDHREC 10664) - Counter target spell unless its controller pays {4}.
83. Mystical Dispute (EDHREC 10679) - Counter target spell unless its controller pays {3}.
84. Metallic Rebuke (EDHREC 10993) - Counter target spell unless its controller pays {3}.
85. Spell Burst (EDHREC 10996) - Counter target spell with mana value X.
86. Admiral's Order (EDHREC 11065) - Counter target spell.
87. Hope-Ender Coatl (EDHREC 11170) - When you cast this spell, counter target spell an opponent controls unless they pay {1}.
88. Hinder (EDHREC 11231) - Counter target spell.
89. Void Shatter (EDHREC 11335) - Counter target spell.
90. Spell Rupture (EDHREC 11381) - Counter target spell unless its controller pays {X}, where X is the greatest power among creatures you control.
91. Voidmage Apprentice (EDHREC 11706) - When this creature is turned face up, counter target spell.
92. Confound (EDHREC 11948) - Counter target spell that targets a creature.
93. Disrupting Shoal (EDHREC 11961) - Counter target spell if its mana value is X.
94. Assert Authority (EDHREC 12272) - Counter target spell.
95. Logic Knot (EDHREC 12335) - Counter target spell unless its controller pays {X}.
96. Broken Ambitions (EDHREC 12344) - Counter target spell unless its controller pays {X}.
97. Devious Cover-Up (EDHREC 12383) - Counter target spell.
98. Quench (EDHREC 12424) - Counter target spell unless its controller pays {2}.
99. Spell Crumple (EDHREC 12469) - Counter target spell.
100. Scattering Stroke (EDHREC 12479) - Counter target spell.
101. Silumgar's Scorn (EDHREC 12493) - Counter target spell unless its controller pays {1}.
102. Out of Air (EDHREC 12545) - Counter target spell.
103. Complicate (EDHREC 12842) - Counter target spell unless its controller pays {3}.
104. Corrupted Resolve (EDHREC 12939) - Counter target spell if its controller is poisoned.
105. Katara's Reversal (EDHREC 12966) - Counter up to four target spells and/or abilities.
106. Censor (EDHREC 12971) - Counter target spell unless its controller pays {1}.
107. Ulamog's Nullifier (EDHREC 13029) - If you do, counter target spell.
108. Clash of Wills (EDHREC 13039) - Counter target spell unless its controller pays {X}.
109. Force Spike (EDHREC 13053) - Counter target spell unless its controller pays {1}.
110. Change the Equation (EDHREC 13670) - • Counter target spell with mana value 2 or less.
111. Countermand (EDHREC 13676) - Counter target spell.
112. Minor Misstep (EDHREC 13970) - Counter target spell with mana value 1 or less.
113. Azorius Guildmage (EDHREC 14039) - {2}{U}: Counter target activated ability.
114. School Daze (EDHREC 14120) - • Fight Crime — Counter target spell.
115. Rites of Refusal (EDHREC 14396) - Counter target spell unless its controller pays {3} for each card discarded this way.
116. Unravel (EDHREC 14422) - Counter target spell.
117. Soratami Savant (EDHREC 14509) - {3}, Return a land you control to its owner's hand: Counter target spell unless its controller pays {3}.
118. Thassa's Rebuff (EDHREC 14579) - Counter target spell unless its controller pays {X}, where X is your devotion to blue.
119. Wild Unraveling (EDHREC 14716) - Counter target spell.
120. Bind (EDHREC 15088) - Counter target activated ability.
121. Thwart (EDHREC 15148) - Counter target spell.
122. Soul Read (EDHREC 15232) - • Counter target spell unless its controller pays {4}.
123. Intervene (EDHREC 15370) - Counter target spell that targets a creature.
124. Reasonable Doubt (EDHREC 15564) - Counter target spell unless its controller pays {2}.
125. Spell Shrivel (EDHREC 15592) - Counter target spell unless its controller pays {4}.
126. Geistlight Snare (EDHREC 15717) - Counter target spell unless its controller pays {3}.
127. Overwhelming Denial (EDHREC 15719) - Counter target spell.
128. Calculated Dismissal (EDHREC 15784) - Counter target spell unless its controller pays {3}.
129. Scatter to the Winds (EDHREC 15830) - Counter target spell.
130. Fugitive Droid (EDHREC 15997) - {U}, Sacrifice this creature: Counter target spell that targets an artifact or creature you control.
131. Memory Drain (EDHREC 16041) - Counter target spell.
132. Rimewind Cryomancer (EDHREC 16195) - {1}, {T}: Counter target activated ability.
133. Counterlash (EDHREC 16215) - Counter target spell.
134. Spelljack (EDHREC 16309) - Counter target spell.
135. Dispersal Shield (EDHREC 16603) - Counter target spell if its mana value is less than or equal to the greatest mana value among permanents you control.
136. Disruptive Pitmage (EDHREC 16959) - {T}: Counter target spell unless its controller pays {1}.
137. Evasive Action (EDHREC 17001) - Domain — Counter target spell unless its controller pays {1} for each basic land type among lands you control.
138. Ooze Spill (EDHREC 17167) - Counter target spell.
139. Out of Bounds (EDHREC 17440) - Counter target spell.
140. Ertai, the Corrupted (EDHREC 17632) - {U}, {T}, Sacrifice a creature or enchantment: Counter target spell.
141. Disappearing Act (EDHREC 17689) - Counter target spell.
142. Broken Concentration (EDHREC 17704) - Counter target spell.
143. Unified Will (EDHREC 17705) - Counter target spell if you control more creatures than that spell's controller.
144. Crush Dissent (EDHREC 17770) - Counter target spell unless its controller pays {2}.
145. Ertai, Wizard Adept (EDHREC 17848) - {2}{U}{U}, {T}: Counter target spell.
146. Mana Sculpt (EDHREC 17875) - Counter target spell.
147. Override (EDHREC 18011) - Counter target spell unless its controller pays {1} for each artifact you control.
148. Mystic Genesis (EDHREC 18096) - Counter target spell.
149. Rakshasa's Disdain (EDHREC 18106) - Counter target spell unless its controller pays {1} for each card in your graveyard.
150. Spell Snuff (EDHREC 18147) - Counter target spell.
151. Voidmage Husher (EDHREC 18262) - When this creature enters, counter target activated ability.
152. Sage's Dousing (EDHREC 18467) - Counter target spell unless its controller pays {3}.
153. Declaration of Naught (EDHREC 18471) - {U}: Counter target spell with the chosen name.
154. Last Word (EDHREC 18491) - Counter target spell.
155. Spiketail Drakeling (EDHREC 18808) - Sacrifice this creature: Counter target spell unless its controller pays {2}.
156. Sunken Field (EDHREC 18870) - Enchanted land has "{T}: Counter target spell unless its controller pays {1}."
157. Contradict (EDHREC 18918) - Counter target spell.
158. Diplomatic Escort (EDHREC 18967) - {U}, {T}, Discard a card: Counter target spell or ability that targets a creature.
159. Spiketail Hatchling (EDHREC 19012) - Sacrifice this creature: Counter target spell unless its controller pays {1}.
160. Traumatic Visions (EDHREC 19103) - Counter target spell.
161. Quandrix Charm (EDHREC 19257) - • Counter target spell unless its controller pays {2}.
162. Grip of Amnesia (EDHREC 19436) - Counter target spell unless its controller exiles all cards from their graveyard.
163. Spell Syphon (EDHREC 19893) - Counter target spell unless its controller pays {1} for each blue permanent you control.
164. Disruptive Student (EDHREC 20011) - {T}: Counter target spell unless its controller pays {1}.
165. Vigilant Martyr (EDHREC 20104) - {W}{W}, {T}, Sacrifice this creature: Counter target spell that targets an enchantment.
166. Double Negative (EDHREC 20114) - Counter up to two target spells.
167. Induce Paranoia (EDHREC 20339) - Counter target spell.
168. Martyr of Frost (EDHREC 20567) - {2}, Reveal X blue cards from your hand, Sacrifice this creature: Counter target spell unless its controller pays {X}.
169. Jaded Response (EDHREC 20761) - Counter target spell if it shares a color with a creature you control.
170. Teferi's Response (EDHREC 20896) - Counter target spell or ability an opponent controls that targets a land you control.
171. Wizard Replica (EDHREC 21099) - {U}, Sacrifice this creature: Counter target spell unless its controller pays {2}.
172. Discombobulate (EDHREC 21274) - Counter target spell.
173. Lilting Refrain (EDHREC 21282) - Sacrifice this enchantment: Counter target spell unless its controller pays {X}, where X is the number of verse counters on this enchantment.
174. Squelch (EDHREC 21300) - Counter target activated ability.
175. Failed Inspection (EDHREC 21343) - Counter target spell.
176. Equinox (EDHREC 21522) - Enchanted land has "{T}: Counter target spell if it would destroy a land you control."
177. Silumgar Spell-Eater (EDHREC 21732) - When this creature is turned face up, counter target spell unless its controller pays {3}.
178. Interdict (EDHREC 21741) - Counter target activated ability from an artifact, creature, enchantment, or land.
179. Prohibit (EDHREC 21745) - Counter target spell if its mana value is 2 or less.
180. Fervent Denial (EDHREC 21900) - Counter target spell.
181. Hindering Touch (EDHREC 21960) - Counter target spell unless its controller pays {2}.
182. Mindstatic (EDHREC 22179) - Counter target spell unless its controller pays {6}.
183. Rethink (EDHREC 22220) - Counter target spell unless its controller pays {X}, where X is its mana value.
184. Ixidor's Will (EDHREC 22287) - Counter target spell unless its controller pays {2} for each Wizard on the battlefield.
185. Stymied Hopes (EDHREC 22431) - Counter target spell unless its controller pays {1}.
186. Ghost-Lit Warder (EDHREC 22601) - {3}{U}, {T}: Counter target spell unless its controller pays {2}.
187. Vodalian Mage (EDHREC 22810) - {U}, {T}: Counter target spell unless its controller pays {1}.
188. Suffocating Blast (EDHREC 23008) - Counter target spell and Suffocating Blast deals 3 damage to target creature.
189. Outwit (EDHREC 23160) - Counter target spell that targets a player.
190. Punish Ignorance (EDHREC 23208) - Counter target spell.
191. Lay Bare (EDHREC 23280) - Counter target spell.
192. Lost in the Mist (EDHREC 23285) - Counter target spell.
193. Mundungu (EDHREC 23468) - {T}: Counter target spell unless its controller pays {1} and 1 life.
194. Oppressive Will (EDHREC 23473) - Counter target spell unless its controller pays {1} for each card in your hand.
195. Statute of Denial (EDHREC 23600) - Counter target spell.
196. Vex (EDHREC 23709) - Counter target spell.
197. Spell Contortion (EDHREC 23833) - Counter target spell unless its controller pays {2}.
198. Brown Ouphe (EDHREC 24013) - {1}{G}, {T}: Counter target activated ability from an artifact source.
199. Fall of the Gavel (EDHREC 24100) - Counter target spell.
200. Dismal Failure (EDHREC 24276) - Counter target spell.

### 6. Mill Effects

Source: existing queue family after library_search
Available after current queue exclusion: 351

1. Takenuma, Abandoned Mire (EDHREC 239) - Channel — {3}{B}, Discard this card: Mill three cards, then return a creature or planeswalker card from your graveyard to your hand.
2. Ripples of Undeath (EDHREC 561) - At the beginning of your first main phase, mill three cards.
3. Tibalt's Trickery (EDHREC 581) - Its controller mills that many cards, then exiles cards from the top of their library until they exile a nonland card with a different name than that spell.
4. Emry, Lurker of the Loch (EDHREC 616) - When Emry enters, mill four cards.
5. Stitcher's Supplier (EDHREC 663) - When this creature enters or dies, mill three cards.
6. Breach the Multiverse (EDHREC 818) - Each player mills ten cards.
7. Mindcrank (EDHREC 946) - Whenever an opponent loses life, that player mills that many cards.
8. Mesmeric Orb (EDHREC 1086) - Whenever a permanent becomes untapped, that permanent's controller mills a card.
9. Lumra, Bellow of the Woods (EDHREC 1203) - When Lumra enters, mill four cards.
10. World Shaper (EDHREC 1273) - Whenever this creature attacks, you may mill three cards.
11. Millikin (EDHREC 1300) - {T}, Mill a card: Add {C}.
12. Ruin Crab (EDHREC 1305) - Landfall — Whenever a land you control enters, each opponent mills three cards.
13. Skull Prophet (EDHREC 1349) - {T}: Mill two cards.
14. Hedge Shredder (EDHREC 1363) - Whenever this Vehicle attacks, you may mill two cards.
15. Altar of the Brood (EDHREC 1411) - Whenever another permanent you control enters, each opponent mills a card.
16. Smuggler's Surprise (EDHREC 1501) - + {2} — Mill four cards.
17. Hedron Crab (EDHREC 1568) - Landfall — Whenever a land you control enters, target player mills three cards.
18. Maddening Cacophony (EDHREC 1615) - Each opponent mills eight cards.
19. The Water Crystal (EDHREC 1984) - If an opponent would mill one or more cards, they mill that many cards plus four instead.
20. Perpetual Timepiece (EDHREC 2020) - {T}: Mill two cards.
21. Grapple with the Past (EDHREC 2114) - Mill three cards, then you may return a creature or land card from your graveyard to your hand.
22. Bruvac the Grandiloquent (EDHREC 2118) - If an opponent would mill one or more cards, they mill twice that many cards instead.
23. Colossal Grave-Reaver (EDHREC 2173) - Whenever this creature enters or attacks, mill three cards.
24. Tyvar, Jubilant Brawler (EDHREC 2337) - −2: Mill three cards, then you may return a creature card with mana value 2 or less from your graveyard to the battlefield.
25. The Mindskinner (EDHREC 2341) - If a source you control would deal damage to an opponent, prevent that damage and each opponent mills that many cards.
26. Overlord of the Balemurk (EDHREC 2349) - Whenever this permanent enters or attacks, mill four cards, then you may return a non-Avatar creature card or a planeswalker card from your graveyard to your hand.
27. Court of Cunning (EDHREC 2521) - At the beginning of your upkeep, any number of target players each mill two cards.
28. Cemetery Tampering (EDHREC 2640) - At the beginning of your upkeep, you may mill three cards.
29. Fraying Sanity (EDHREC 2849) - At the beginning of each end step, enchanted player mills X cards, where X is the number of cards put into their graveyard from anywhere this turn.
30. Blossoming Tortoise (EDHREC 2975) - Whenever this creature enters or attacks, mill three cards, then return a land card from your graveyard to the battlefield tapped.
31. Nephalia Drownyard (EDHREC 3092) - {1}{U}{B}, {T}: Target player mills three cards.
32. Deadbridge Chant (EDHREC 3108) - When this enchantment enters, mill ten cards.
33. Extract from Darkness (EDHREC 3172) - Each player mills two cards.
34. Didn't Say Please (EDHREC 3322) - Its controller mills three cards.
35. Incarnation Technique (EDHREC 3443) - Mill five cards, then return a creature card from your graveyard to the battlefield.
36. Memory Erosion (EDHREC 3575) - Whenever an opponent casts a spell, that player mills two cards.
37. Restless Reef (EDHREC 3581) - Whenever this land attacks, target player mills four cards.
38. Gisa and Geralf (EDHREC 3697) - When Gisa and Geralf enters, mill four cards.
39. The Warring Triad (EDHREC 3965) - {T}, Mill a card: Target player adds one mana of any color.
40. Barrowgoyf (EDHREC 4006) - Whenever this creature deals combat damage to a player, you may mill that many cards.
41. Gyruda, Doom of Depths (EDHREC 4175) - When Gyruda enters, each player mills four cards.
42. Riverchurn Monument (EDHREC 4234) - {1}, {T}: Any number of target players each mill two cards.
43. Captain N'ghathrod (EDHREC 4275) - Whenever a Horror you control deals combat damage to a player, that player mills that many cards.
44. Nemesis of Reason (EDHREC 4310) - Whenever this creature attacks, defending player mills ten cards.
45. Angel of Suffering (EDHREC 4492) - If damage would be dealt to you, prevent that damage and mill twice that many cards.
46. Wondrous Crucible (EDHREC 4571) - At the beginning of your end step, mill two cards, then exile a nonland card at random from your graveyard.
47. Deranged Assistant (EDHREC 4580) - {T}, Mill a card: Add {C}.
48. Infesting Radroach (EDHREC 4695) - Whenever an opponent mills a nonland card, if this creature is in your graveyard, you may return it to your hand.
49. Rampant Frogantua (EDHREC 4701) - Whenever this creature deals combat damage to a player, you may mill that many cards.
50. Tomb Fortress (EDHREC 4716) - {2}{B}{B}{B}, {T}, Exile this land: Mill four cards, then return a creature card from your graveyard to the battlefield.
51. Phenax, God of Deception (EDHREC 4853) - Creatures you control have "{T}: Target player mills X cards, where X is this creature's toughness."
52. Splinterfright (EDHREC 4871) - At the beginning of your upkeep, mill two cards.
53. Raul, Trouble Shooter (EDHREC 5055) - {T}: Each player mills a card.
54. Glimpse the Unthinkable (EDHREC 5174) - Target player mills ten cards.
55. Ashcoat of the Shadow Swarm (EDHREC 5193) - At the beginning of your end step, you may mill four cards.
56. Sauron, Lord of the Rings (EDHREC 5275) - When you cast this spell, amass Orcs 5, mill five cards, then return a creature card from your graveyard to the battlefield.
57. Kagha, Shadow Archdruid (EDHREC 5390) - Mill two cards.
58. Thought Collapse (EDHREC 5472) - Its controller mills three cards.
59. Sewer Nemesis (EDHREC 5636) - Whenever the chosen player casts a spell, that player mills a card.
60. Archive Trap (EDHREC 5754) - Target opponent mills thirteen cards.
61. Go-Shintai of Lost Wisdom (EDHREC 5842) - When you do, target player mills X cards, where X is the number of Shrines you control.
62. Terra, Herald of Hope (EDHREC 6162) - Trance — At the beginning of combat on your turn, mill two cards.
63. Ghoulcaller's Bell (EDHREC 6340) - {T}: Each player mills a card.
64. Coram, the Undertaker (EDHREC 6491) - Whenever Coram attacks, each player mills a card.
65. Hope Estheim (EDHREC 6560) - At the beginning of your end step, each opponent mills X cards, where X is the amount of life you gained this turn.
66. Molt Tender (EDHREC 6675) - {T}: Mill a card.
67. Mindwrack Harpy (EDHREC 6873) - At the beginning of combat on your turn, each player mills three cards.
68. Kairi, the Swirling Sky (EDHREC 6988) - • Mill six cards, then return up to two instant and/or sorcery cards from your graveyard to your hand.
69. Admiral Brass, Unsinkable (EDHREC 7065) - When Admiral Brass enters, mill four cards.
70. Corpse Churn (EDHREC 7089) - Mill three cards, then you may return a creature card from your graveyard to your hand.
71. Dreamborn Muse (EDHREC 7102) - At the beginning of each player's upkeep, that player mills X cards, where X is the number of cards in their hand.
72. Shadow Kin (EDHREC 7383) - At the beginning of your upkeep, each player mills three cards.
73. Tasigur, the Golden Fang (EDHREC 7503) - {2}{G/U}{G/U}: Mill two cards, then return a nonland card of an opponent's choice from your graveyard to your hand.
74. Trenchpost (EDHREC 7518) - {3}, {T}: Target player mills a card for each Locus you control.
75. Geth, Lord of the Vault (EDHREC 7726) - Then that player mills X cards.
76. The Cyber-Controller (EDHREC 7813) - When The Cyber-Controller enters, each opponent mills X cards.
77. Unseal the Necropolis (EDHREC 8123) - Each player mills three cards.
78. Sorcerous Squall (EDHREC 8184) - Target opponent mills nine cards, then you may cast an instant or sorcery spell from that player's graveyard without paying its mana cost.
79. Circle of the Land Druid (EDHREC 8288) - When this creature enters, you may mill four cards.
80. Drowned Secrets (EDHREC 8294) - Whenever you cast a blue spell, target player mills two cards.
81. Relic Golem (EDHREC 8336) - {2}, {T}: Target player mills two cards.
82. Thieves' Guild Enforcer (EDHREC 8399) - Whenever this creature or another Rogue you control enters, each opponent mills two cards.
83. Psychic Strike (EDHREC 8643) - Its controller mills two cards.
84. Another Chance (EDHREC 8676) - You may mill two cards.
85. Rex, Cyber-Hound (EDHREC 8830) - Whenever Rex deals combat damage to a player, they mill two cards and you get {E}{E} (two energy counters).
86. Keening Stone (EDHREC 8858) - {5}, {T}: Target player mills X cards, where X is the number of cards in that player's graveyard.
87. Eivor, Wolf-Kissed (EDHREC 8953) - Whenever Eivor deals combat damage to a player, you mill that many cards.
88. Rejoin the Fight (EDHREC 8958) - Mill three cards.
89. Winds of Rebuke (EDHREC 8968) - Each player mills two cards.
90. Diviner of Mist (EDHREC 8989) - Whenever this creature attacks, mill four cards.
91. Technomancer (EDHREC 9269) - When this creature enters, mill three cards, then return any number of artifact creature cards with total mana value 6 or less from your graveyard to the battlefield.
92. Gnawing Vermin (EDHREC 9458) - When this creature enters, target player mills two cards.
93. Glowspore Shaman (EDHREC 9478) - When this creature enters, mill three cards.
94. Tayam, Luminous Enigma (EDHREC 9544) - {3}, Remove three counters from among creatures you control: Mill three cards, then return a permanent card with mana value 3 or less from your graveyard to the battlefield.
95. Manic Scribe (EDHREC 9588) - When this creature enters, each opponent mills three cards.
96. Bond of Insight (EDHREC 9699) - Each player mills four cards.
97. Daggerfang Duo (EDHREC 9730) - When this creature enters, you may mill two cards.
98. Riddlekeeper (EDHREC 9814) - Whenever a creature attacks you or a planeswalker you control, that creature's controller mills two cards.
99. Vanille, Cheerful l'Cie (EDHREC 9822) - When Vanille enters, mill two cards, then return a permanent card from your graveyard to your hand.
100. Eye Collector (EDHREC 9843) - Whenever this creature deals combat damage to a player, each player mills a card.
101. Ursine Monstrosity (EDHREC 9858) - At the beginning of combat on your turn, mill a card and choose an opponent at random.
102. Szarekh, the Silent King (EDHREC 9869) - My Will Be Done — Whenever Szarekh attacks, mill three cards.
103. Deepmuck Desperado (EDHREC 9880) - Whenever you commit a crime, each opponent mills three cards.
104. Persistent Petitioners (EDHREC 9993) - {1}, {T}: Target player mills a card.
105. Carrion Grub (EDHREC 10078) - When this creature enters, mill four cards.
106. Soaring Thought-Thief (EDHREC 10151) - Whenever one or more Rogues you control attack, each opponent mills two cards.
107. Deathcap Marionette (EDHREC 10277) - When this creature enters, you may mill two cards.
108. Inspiration from Beyond (EDHREC 10289) - Mill three cards, then return an instant or sorcery card from your graveyard to your hand.
109. Psychic Spiral (EDHREC 10364) - Target player mills that many cards.
110. Overwhelmed Apprentice (EDHREC 11171) - When this creature enters, each opponent mills two cards.
111. Midnight Tilling (EDHREC 11175) - Mill four cards, then you may return a permanent card from among them to your hand.
112. Mind Sculpt (EDHREC 11307) - Target opponent mills seven cards.
113. Convergence of Dominion (EDHREC 11325) - Translocation Protocols — {3}, {T}: Mill three cards.
114. Stillness in Motion (EDHREC 11367) - At the beginning of your upkeep, mill three cards.
115. Vantress Gargoyle (EDHREC 11394) - {T}: Each player mills a card.
116. Saruman of Many Colors (EDHREC 11430) - Whenever you cast your second spell each turn, each opponent mills two cards.
117. Eccentric Farmer (EDHREC 11555) - When this creature enters, mill three cards, then you may return a land card from your graveyard to your hand.
118. Druidic Ritual (EDHREC 11581) - You may mill three cards.
119. Tome Scour (EDHREC 11604) - Target player mills five cards.
120. Dream Twist (EDHREC 11684) - Target player mills three cards.
121. Lluwen, Imperfect Naturalist (EDHREC 11791) - When Lluwen enters, mill four cards, then you may put a creature or land card from among the milled cards on top of your library.
122. Duskmantle, House of Shadow (EDHREC 11795) - {U}{B}, {T}: Target player mills a card.
123. Millstone (EDHREC 11808) - {2}, {T}: Target player mills two cards.
124. Flayed One (EDHREC 11816) - Flesh Flayer — When this creature enters, mill three cards.
125. Scrabbling Skullcrab (EDHREC 11842) - Eerie — Whenever an enchantment you control enters and whenever you fully unlock a Room, target player mills two cards.
126. Aven Heartstabber (EDHREC 11996) - When this creature dies, mill two cards, then draw a card.
127. Patchwork Beastie (EDHREC 12046) - At the beginning of your upkeep, you may mill a card.
128. Mystic Redaction (EDHREC 12051) - Whenever you discard a card, each opponent mills two cards.
129. Embalmer's Tools (EDHREC 12059) - Tap an untapped Zombie you control: Target player mills a card.
130. Crow of Dark Tidings (EDHREC 12082) - When this creature enters or dies, mill two cards.
131. Wand of Vertebrae (EDHREC 12298) - {T}: Mill a card.
132. Broken Ambitions (EDHREC 12344) - If you win, that spell's controller mills four cards.
133. Avatar Destiny (EDHREC 12403) - Enchant creature you control Enchanted creature gets +1/+1 for each creature card in your graveyard and is an Avatar in addition to its other types. When enchanted creature dies, mill cards equal to its power. Return this card to its owner's hand and up to ...
134. Master Pakku (EDHREC 12428) - Whenever Master Pakku becomes tapped, target player mills X cards, where X is the number of Lesson cards in your graveyard.
135. Curse of the Bloody Tome (EDHREC 12436) - At the beginning of enchanted player's upkeep, that player mills two cards.
136. Acolyte of Affliction (EDHREC 12560) - When this creature enters, mill two cards, then you may return a permanent card from your graveyard to your hand.
137. Madame Web, Clairvoyant (EDHREC 13054) - Whenever you attack, you may mill a card.
138. Chronic Flooding (EDHREC 13195) - Whenever enchanted land becomes tapped, its controller mills three cards.
139. Iceberg Cancrix (EDHREC 13227) - Whenever another snow permanent you control enters, you may have target player mill two cards.
140. Wall of Lost Thoughts (EDHREC 13315) - When this creature enters, target player mills four cards.
141. Rosheen, Roaring Prophet (EDHREC 13321) - When Rosheen enters, mill six cards.
142. Chancellor of the Spires (EDHREC 13360) - If you do, at the beginning of the first upkeep, each opponent mills seven cards.
143. Urborg Lhurgoyf (EDHREC 13476) - As this creature enters, mill three cards for each time it was kicked.
144. Summon Undead (EDHREC 13612) - You may mill three cards.
145. Countermand (EDHREC 13676) - Its controller mills four cards.
146. Rainveil Rejuvenator (EDHREC 13688) - When this creature enters, you may mill three cards.
147. Venomized Cat (EDHREC 13697) - When this creature enters, mill two cards.
148. Quag Feast (EDHREC 13698) - Mill two cards, then destroy the chosen permanent if its mana value is less than or equal to the number of cards in your graveyard.
149. Desperate Bloodseeker (EDHREC 13776) - When this creature enters, target player mills two cards.
150. Roots of Wisdom (EDHREC 13817) - Mill three cards, then return a land card or Elf card from your graveyard to your hand.
151. Jace's Mindseeker (EDHREC 14016) - When this creature enters, target opponent mills five cards.
152. Halimar Excavator (EDHREC 14064) - Whenever this creature or another Ally you control enters, target player mills X cards, where X is the number of Allies you control.
153. Sands of Delirium (EDHREC 14080) - {X}, {T}: Target player mills X cards.
154. Infernal Genesis (EDHREC 14141) - At the beginning of each player's upkeep, that player mills a card.
155. Fell Gravship (EDHREC 14184) - When this Spacecraft enters, mill three cards, then return a creature or Spacecraft card from your graveyard to your hand.
156. Wick's Patrol (EDHREC 14260) - When this creature enters, mill three cards.
157. Shaun & Rebecca, Agents (EDHREC 14294) - When you do, mill two cards.
158. Patient Naturalist (EDHREC 14395) - When this creature enters, mill three cards.
159. Excavated Wall (EDHREC 14407) - {1}, {T}: Mill a card.
160. Pelargir Survivor (EDHREC 14438) - {5}{U}, {T}: Target player mills three cards.
161. The Fifteenth Doctor (EDHREC 14564) - Whenever The Fifteenth Doctor enters or attacks, mill three cards.
162. Sludge Titan (EDHREC 14605) - Whenever this creature enters or attacks, mill five cards.
163. Veteran Ice Climber (EDHREC 14619) - Vigilance This creature can't be blocked. Whenever this creature attacks, up to one target player mills cards equal to this creature's power. (They put that many cards from the top of their library into their graveyard.)
164. Wasteful Harvest (EDHREC 14744) - Mill five cards.
165. Grasping Tentacles (EDHREC 14779) - Target opponent mills eight cards.
166. Drown in Filth (EDHREC 14856) - Mill four cards, then that creature gets -1/-1 until end of turn for each land card in your graveyard.
167. Cephalid Illusionist (EDHREC 15045) - Whenever this creature becomes the target of a spell or ability, mill three cards.
168. Carrion Cruiser (EDHREC 15101) - When this Vehicle enters, mill two cards.
169. Stream of Thought (EDHREC 15163) - Target player mills four cards.
170. Sphinx Mindbreaker (EDHREC 15214) - When this creature enters, each opponent mills ten cards.
171. Eyeblight Cullers (EDHREC 15222) - When this creature dies, create three 1/1 green Elf Warrior creature tokens, then mill three cards.
172. Specimen Freighter (EDHREC 15258) - Whenever this Spacecraft attacks, defending player mills four cards.
173. Mindshrieker (EDHREC 15295) - {2}: Target player mills a card.
174. Scarblade Scout (EDHREC 15519) - When this creature enters, mill two cards.
175. Compelling Argument (EDHREC 15866) - Target player mills five cards.
176. Paranoid Delusions (EDHREC 15903) - Target player mills three cards.
177. Mole Module (EDHREC 15958) - Whenever this Vehicle deals combat damage to a player, mill four cards.
178. Random Encounter (EDHREC 16057) - Shuffle your library, then mill four cards.
179. Sigil of Myrkul (EDHREC 16117) - At the beginning of combat on your turn, mill a card.
180. Cathartic Adept (EDHREC 16120) - {T}: Target player mills a card.
181. Coral Colony (EDHREC 16207) - {1}{U}, {T}: Target player mills X cards, where X is the number of creatures you control with defender.
182. Sage of Mysteries (EDHREC 16282) - Constellation — Whenever an enchantment you control enters, target player mills two cards.
183. Screeching Sliver (EDHREC 16479) - All Slivers have "{T}: Target player mills a card."
184. Eerie Soultender (EDHREC 16596) - When this creature enters, mill three cards.
185. Grave Strength (EDHREC 16648) - Mill three cards, then put a +1/+1 counter on that creature for each creature card in your graveyard.
186. Fallaji Archaeologist (EDHREC 16814) - When this creature enters, mill three cards.
187. Screaming Swarm (EDHREC 16847) - Whenever you attack with one or more creatures, target player mills that many cards.
188. Dreadwaters (EDHREC 16856) - Target player mills X cards, where X is the number of lands you control.
189. Path of the Schemer (EDHREC 16881) - Each player mills two cards.
190. Doorkeeper (EDHREC 16885) - {2}{U}, {T}: Target player mills X cards, where X is the number of creatures you control with defender.
191. Returned Reveler (EDHREC 16910) - When this creature dies, each player mills three cards.
192. Siren of the Silent Song (EDHREC 16974) - Inspired — Whenever this creature becomes untapped, each opponent discards a card, then each opponent mills a card.
193. Shriekhorn (EDHREC 17124) - {T}, Remove a charge counter from this artifact: Target player mills two cards.
194. Tazri, Stalwart Survivor (EDHREC 17131) - {W}{U}{B}{R}{G}, {T}: Mill five cards.
195. Sage's Row Denizen (EDHREC 17229) - Whenever another blue creature you control enters, target player mills two cards.
196. Leyline Dowser (EDHREC 17301) - {1}, {T}: Mill a card.
197. Predict (EDHREC 17389) - Choose a card name, then target player mills a card.
198. Diligent Excavator (EDHREC 17412) - Whenever you cast a historic spell, target player mills two cards.
199. Airlift Chaplain (EDHREC 17460) - When this creature enters, mill three cards.
200. Hama, the Bloodbender (EDHREC 17501) - When Hama enters, target opponent mills three cards.

### 7. Impulse Exile Permission Windows

Source: existing queue family after library_search
Available after current queue exclusion: 160

1. Jeska's Will (EDHREC 105) - Choose one. If you control a commander as you cast this spell, you may choose both instead. • Add {R} for each card in target opponent's hand. • Exile the top three cards of your library. You may play them this turn.
2. Mosswort Bridge (EDHREC 193) - {G}, {T}: You may play the exiled card without paying its mana cost if creatures you control have total power 10 or greater.
3. Etali, Primal Storm (EDHREC 257) - Whenever Etali attacks, exile the top card of each player's library, then you may cast any number of spells from among those cards without paying their mana costs.
4. Windbrisk Heights (EDHREC 641) - {W}, {T}: You may play the exiled card without paying its mana cost if you attacked with three or more creatures this turn.
5. Spinerock Knoll (EDHREC 739) - {R}, {T}: You may play the exiled card without paying its mana cost if an opponent was dealt 7 or more damage this turn.
6. Expressive Iteration (EDHREC 951) - You may play the exiled card this turn.
7. Light Up the Stage (EDHREC 1196) - Spectacle {R} (You may cast this spell for its spectacle cost rather than its mana cost if an opponent lost life this turn.) Exile the top two cards of your library. Until the end of your next turn, you may play those cards.
8. Grenzo, Havoc Raiser (EDHREC 1627) - Whenever a creature you control deals combat damage to a player, choose one — • Goad target creature that player controls. • Exile the top card of that player's library. Until end of turn, you may cast that card and you may spend mana as though it were mana...
9. Sword of Forge and Frontier (EDHREC 1809) - Equipped creature gets +2/+2 and has protection from red and from green. Whenever equipped creature deals combat damage to a player, exile the top two cards of your library. You may play those cards this turn. You may play an additional land this turn. Equi...
10. The Key to the Vault (EDHREC 2055) - You may cast the exiled card without paying its mana cost.
11. Wrenn's Resolve (EDHREC 2119) - Exile the top two cards of your library. Until the end of your next turn, you may play those cards.
12. Reckless Impulse (EDHREC 2142) - Exile the top two cards of your library. Until the end of your next turn, you may play those cards.
13. Party Thrasher (EDHREC 2149) - Noncreature spells you cast from exile have convoke. (Each creature you tap while casting a noncreature spell from exile pays for {1} or one mana of that creature's color.) At the beginning of your first main phase, you may discard a card. If you do, exile ...
14. Escape to the Wilds (EDHREC 2230) - Exile the top five cards of your library. You may play cards exiled this way until the end of your next turn. You may play an additional land this turn.
15. Cunning Rhetoric (EDHREC 2497) - Whenever an opponent attacks you and/or one or more planeswalkers you control, exile the top card of that player's library. You may play that card for as long as it remains exiled, and you may spend mana as though it were mana of any color to cast it.
16. Aminatou's Augury (EDHREC 2618) - Exile the top eight cards of your library. You may put a land card from among them onto the battlefield. Until end of turn, for each nonland card type, you may cast a spell of that type from among the exiled cards without paying its mana cost.
17. Cemetery Tampering (EDHREC 2640) - Then if there are twenty or more cards in your graveyard, you may play the exiled card without paying its mana cost.
18. Court of Locthwain (EDHREC 3025) - When this enchantment enters, you become the monarch. At the beginning of your upkeep, exile the top card of target opponent's library. You may play that card for as long as it remains exiled, and mana of any type can be spent to cast it. If you're the mona...
19. Neyali, Suns' Vanguard (EDHREC 3129) - Attacking tokens you control have double strike. Whenever one or more tokens you control attack a player, exile the top card of your library. During any turn you attacked with a token, you may play that card.
20. Florian, Voldaren Scion (EDHREC 3339) - You may play the exiled card this turn.
21. Laughing Jasper Flint (EDHREC 3347) - Creatures you control but don't own are Mercenaries in addition to their other types. At the beginning of your upkeep, exile the top X cards of target opponent's library, where X is the number of outlaws you control. Until end of turn, you may cast spells f...
22. Vivien, Champion of the Wilds (EDHREC 3557) - For as long as it remains exiled, you may cast it if it's a creature spell.
23. Mind's Desire (EDHREC 3570) - Shuffle your library. Then exile the top card of your library. Until end of turn, you may play that card without paying its mana cost. Storm (When you cast this spell, copy it for each spell cast before it this turn.)
24. Commune with Lava (EDHREC 3795) - Exile the top X cards of your library. Until the end of your next turn, you may play those cards.
25. Cori Mountain Monastery (EDHREC 4038) - This land enters tapped unless you control a Plains or an Island. {T}: Add {R}. {3}{R}, {T}: Exile the top card of your library. Until the end of your next turn, you may play that card.
26. Blazing Crescendo (EDHREC 4045) - Target creature gets +3/+1 until end of turn. Exile the top card of your library. Until the end of your next turn, you may play that card.
27. Stella Lee, Wild Card (EDHREC 4100) - Whenever you cast your second spell each turn, exile the top card of your library. Until the end of your next turn, you may play that card. {T}: Copy target instant or sorcery spell you control. You may choose new targets for the copy. Activate only if you'...
28. Stolen Strategy (EDHREC 4105) - At the beginning of your upkeep, exile the top card of each opponent's library. Until end of turn, you may cast spells from among those exiled cards, and you may spend mana as though it were mana of any color to cast those spells.
29. Wild Wasteland (EDHREC 4112) - Skip your draw step. At the beginning of your upkeep, exile the top two cards of your library. You may play those cards this turn.
30. Tavern Brawler (EDHREC 4134) - Commander creatures you own have "At the beginning of your upkeep, exile the top card of your library. This creature gets +X/+0 until end of turn, where X is that card's mana value. You may play that card this turn."
31. Breeches, Brazen Plunderer (EDHREC 4186) - Menace Whenever one or more Pirates you control deal damage to your opponents, exile the top card of each of those opponents' libraries. You may play those cards this turn, and you may spend mana as though it were mana of any color to cast those spells. Par...
32. Apex of Power (EDHREC 4411) - Exile the top seven cards of your library. Until end of turn, you may cast spells from among them. If this spell was cast from your hand, add ten mana of any one color.
33. Rundvelt Hordemaster (EDHREC 4768) - Other Goblins you control get +1/+1. Whenever this creature or another Goblin you control dies, exile the top card of your library. If it's a Goblin creature card, you may cast that card until the end of your next turn.
34. Hugs, Grisly Guardian (EDHREC 4797) - Trample When Hugs enters, exile the top X cards of your library. Until the end of your next turn, you may play those cards. You may play an additional land on each of your turns.
35. Count on Luck (EDHREC 4803) - At the beginning of your upkeep, exile the top card of your library. You may play that card this turn.
36. Haste Magic (EDHREC 4827) - Target creature gets +3/+1 and gains haste until end of turn. Exile the top card of your library. You may play it until your next end step.
37. Djeru and Hazoret (EDHREC 4977) - Until end of turn, you may cast the exiled card without paying its mana cost.
38. Nahiri, Forged in Fury (EDHREC 4987) - Affinity for Equipment (This spell costs {1} less to cast for each Equipment you control.) Whenever an equipped creature you control attacks, exile the top card of your library. You may play that card this turn. You may cast Equipment spells this way withou...
39. Zuko, Exiled Prince (EDHREC 5005) - Firebending 3 (Whenever this creature attacks, add {R}{R}{R}. This mana lasts until end of combat.) {3}: Exile the top card of your library. You may play that card this turn.
40. Rogue Class (EDHREC 5038) - (Gain the next level as a sorcery to add its ability.) Whenever a creature you control deals combat damage to a player, exile the top card of that player's library face down. You may look at it for as long as it remains exiled. {1}{U}{B}: Level 2 Creatures ...
41. Moria Marauder (EDHREC 5299) - Double strike Whenever a Goblin or Orc you control deals combat damage to a player, exile the top card of your library. You may play that card this turn.
42. Dance with Calamity (EDHREC 5418) - Shuffle your library. As many times as you choose, you may exile the top card of your library. If the total mana value of the cards exiled this way is 13 or less, you may cast any number of spells from among those cards without paying their mana costs.
43. Kotis, the Fangkeeper (EDHREC 5665) - Indestructible Whenever Kotis deals combat damage to a player, exile the top X cards of their library, where X is the amount of damage dealt. You may cast any number of spells with mana value X or less from among them without paying their mana costs.
44. Epic Experiment (EDHREC 5729) - Exile the top X cards of your library. You may cast instant and sorcery spells with mana value X or less from among them without paying their mana costs. Then put all cards exiled this way that weren't cast into your graveyard.
45. Clive's Hideaway (EDHREC 5781) - {2}, {T}: You may play the exiled card without paying its mana cost if you control four or more legendary creatures.
46. Dream-Thief's Bandana (EDHREC 5904) - For as long as it remains exiled, you may play it, and mana of any type can be spent to cast that spell.
47. Creative Technique (EDHREC 6000) - You may cast the exiled card without paying its mana cost.
48. Chaos Channeler (EDHREC 6213) - Wild Magic Surge — Whenever this creature attacks, roll a d20. 1—9 | Exile the top card of your library. You may play it this turn. 10—19 | Exile the top two cards of your library. You may play them this turn. 20 | Exile the top three cards of your library....
49. Opera Love Song (EDHREC 6455) - Choose one — • Exile the top two cards of your library. You may play those cards until your next end step. • One or two target creatures each get +2/+0 until end of turn.
50. Smirking Spelljacker (EDHREC 6525) - Whenever this creature attacks, if a card is exiled with it, you may cast the exiled card without paying its mana cost.
51. Cait Sith, Fortune Teller (EDHREC 6537) - Lucky Slots — At the beginning of combat on your turn, scry 1, then exile the top card of your library. You may play that card this turn. When you exile a card this way, target creature you control gets +X/+0 until end of turn, where X is that card's mana v...
52. Riveteers Charm (EDHREC 6597) - Choose one — • Target opponent sacrifices a creature or planeswalker they control with the greatest mana value among creatures and planeswalkers they control. • Exile the top three cards of your library. Until your next end step, you may play those cards. •...
53. Caves of Chaos Adventurer (EDHREC 6934) - Trample When this creature enters, you take the initiative. Whenever this creature attacks, exile the top card of your library. If you've completed a dungeon, you may play that card this turn without paying its mana cost. Otherwise, you may play that card t...
54. Chiss-Goria, Forge Tyrant (EDHREC 7083) - Affinity for artifacts (This spell costs {1} less to cast for each artifact you control.) Flying, haste Whenever Chiss-Goria attacks, exile the top five cards of your library. You may cast an artifact spell from among them this turn. If you do, it has affin...
55. March of Reckless Joy (EDHREC 7341) - As an additional cost to cast this spell, you may exile any number of red cards from your hand. This spell costs {2} less to cast for each card exiled this way. Exile the top X cards of your library. You may play up to two of those cards until the end of yo...
56. Etrata, Deadly Fugitive (EDHREC 7527) - If you can't, exile it, then you may cast the exiled card without paying its mana cost."
57. Commander Liara Portyr (EDHREC 7542) - Whenever you attack, spells you cast from exile this turn cost {X} less to cast, where X is the number of players being attacked. Exile the top X cards of your library. Until end of turn, you may cast spells from among those exiled cards.
58. Maralen, Fae Ascendant (EDHREC 7548) - Flying Whenever Maralen or another Elf or Faerie you control enters, exile the top two cards of target opponent's library. Once each turn, you may cast a spell with mana value less than or equal to the number of Elves and Faeries you control from among card...
59. Armory Paladin (EDHREC 7566) - Trample Whenever you cast an Aura or Equipment spell, exile the top card of your library. You may play that card until the end of your next turn.
60. Narset, Enlightened Master (EDHREC 7841) - First strike, hexproof Whenever Narset attacks, exile the top four cards of your library. Until end of turn, you may cast noncreature spells from among those cards without paying their mana costs.
61. Harnesser of Storms (EDHREC 7872) - Whenever you cast a noncreature or Otter spell, you may exile the top card of your library. Until end of turn, you may play that card. This ability triggers only once each turn.
62. Interdimensional Web Watch (EDHREC 8009) - When this artifact enters, exile the top two cards of your library. Until the end of your next turn, you may play those cards. {T}: Add two mana in any combination of colors. Spend this mana only to cast spells from exile.
63. Black Cat, Cunning Thief (EDHREC 8124) - You may play the exiled cards for as long as they remain exiled.
64. Gale's Redirection (EDHREC 8594) - 1—14 | You may cast the exiled card for as long as it remains exiled, and you may spend mana as though it were mana of any color to cast that spell.
65. Emberheart Challenger (EDHREC 8827) - Haste Prowess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.) Valiant — Whenever this creature becomes the target of a spell or ability you control for the first time each turn, exile the top card of your library. Until ...
66. Furious Rise (EDHREC 8977) - At the beginning of your end step, if you control a creature with power 4 or greater, exile the top card of your library. You may play that card until you exile another card with this enchantment.
67. Clockwork Percussionist (EDHREC 8994) - Haste When this creature dies, exile the top card of your library. You may play it until the end of your next turn.
68. Fireglass Mentor (EDHREC 9155) - At the beginning of your second main phase, if an opponent lost life this turn, exile the top two cards of your library. Choose one of them. Until end of turn, you may play that card.
69. Galvanic Relay (EDHREC 9298) - Exile the top card of your library. During your next turn, you may play that card. Storm (When you cast this spell, copy it for each spell cast before it this turn.)
70. Stromkirk Occultist (EDHREC 9345) - Trample Whenever this creature deals combat damage to a player, exile the top card of your library. Until end of turn, you may play that card. Madness {1}{R} (If you discard this card, discard it into exile. When you do, cast it for its madness cost or put ...
71. Loot, the Key to Everything (EDHREC 9584) - Ward {1} At the beginning of your upkeep, exile the top X cards of your library, where X is the number of card types among other nonland permanents you control. You may play those cards this turn.
72. Smuggler's Buggy (EDHREC 9821) - Whenever this Vehicle deals combat damage to a player, you may cast the exiled card without paying its mana cost.
73. Robber of the Rich (EDHREC 9853) - Reach, haste Whenever this creature attacks, if defending player has more cards in hand than you, exile the top card of their library. During any turn you attacked with a Rogue, you may cast that card and you may spend mana as though it were mana of any col...
74. Sanwell, Avenger Ace (EDHREC 9929) - As long as an artifact creature you control is attacking, prevent all damage that would be dealt to Sanwell. Whenever Sanwell becomes tapped, exile the top six cards of your library. You may cast a Vehicle or artifact creature spell from among them. Then pu...
75. Primeval Spawn (EDHREC 10027) - If this creature would enter and it wasn't cast or no mana was spent to cast it, exile it instead. Vigilance, trample, lifelink When this creature leaves the battlefield, exile the top ten cards of your library. You may cast any number of spells with total ...
76. Meria, Scholar of Antiquity (EDHREC 10035) - Tap an untapped nontoken artifact you control: Add {G}. Tap two untapped nontoken artifacts you control: Exile the top card of your library. You may play it this turn.
77. Durnan of the Yawning Portal (EDHREC 10073) - For as long as that card remains exiled, you may cast it.
78. Ecstatic Beauty (EDHREC 10234) - Exile the top three cards of your library. You may play those cards until end of turn. Put four time counters on each of those cards that has suspend. Suspend 4—{R}
79. Intet, the Dreamer (EDHREC 10459) - Flying Whenever Intet deals combat damage to a player, you may pay {2}{U}. If you do, exile the top card of your library face down. You may look at that card for as long as it remains exiled. You may play that card without paying its mana cost for as long a...
80. Heroes' Hangout (EDHREC 10684) - Choose one — • Date Night — Exile the top two cards of your library. Choose one of them. Until the end of your next turn, you may play that card. • Patrol Night — One or two target creatures each get +1/+0 and gain first strike until end of turn.
81. Lightning, Security Sergeant (EDHREC 10767) - Menace (This creature can't be blocked except by two or more creatures.) Whenever Lightning deals combat damage to a player, exile the top card of your library. You may play that card for as long as you control Lightning.
82. Tempered in Solitude (EDHREC 11595) - Whenever a creature you control attacks alone, exile the top card of your library. You may play that card this turn.
83. Alania's Pathmaker (EDHREC 11721) - When this creature enters, exile the top card of your library. Until the end of your next turn, you may play that card.
84. Brilliant Ultimatum (EDHREC 11828) - Exile the top five cards of your library. An opponent separates those cards into two piles. You may play lands and cast spells from one of those piles. If you cast a spell this way, you cast it without paying its mana cost.
85. Ryan Sinclair (EDHREC 12107) - You may cast the exiled card without paying its mana cost if it's a spell with mana value less than or equal to Ryan's power.
86. Seize Opportunity (EDHREC 12166) - Choose one — • Exile the top two cards of your library. Until the end of your next turn, you may play those cards. • Up to two target creatures each get +2/+1 until end of turn.
87. Kellan, Planar Trailblazer (EDHREC 12320) - {1}{R}: If Kellan is a Scout, it becomes a Human Faerie Detective and gains "Whenever Kellan deals combat damage to a player, exile the top card of your library. You may play that card this turn." {2}{R}: If Kellan is a Detective, it becomes a 3/2 Human Fae...
88. Spark of Creativity (EDHREC 12411) - Choose target creature. Exile the top card of your library. You may have Spark of Creativity deal damage to that creature equal to the exiled card's mana value. If you don't, you may play that card until end of turn.
89. Capricious Sliver (EDHREC 12467) - Sliver creatures you control have "Whenever this creature deals combat damage to a player, exile the top card of your library. You may play that card this turn."
90. Campus Renovation (EDHREC 13170) - Return up to one target artifact or enchantment card from your graveyard to the battlefield. Exile the top two cards of your library. Until the end of your next turn, you may play those cards.
91. Magmatic Channeler (EDHREC 13463) - As long as there are four or more instant and/or sorcery cards in your graveyard, this creature gets +3/+1. {T}, Discard a card: Exile the top two cards of your library, then choose one of them. You may play that card this turn.
92. Evelyn, the Covetous (EDHREC 13953) - Flash Whenever Evelyn or another Vampire you control enters, exile the top card of each player's library with a collection counter on it. Once each turn, you may play a card from exile with a collection counter on it if it was exiled by an ability you contr...
93. Duelist's Flame (EDHREC 14155) - You may cast the exiled card without paying its mana cost."
94. Bruse Tarl, Roving Rancher (EDHREC 14360) - Oxen you control have double strike. Whenever Bruse Tarl enters or attacks, exile the top card of your library. If it's a land card, create a 2/2 white Ox creature token. Otherwise, you may cast it until the end of your next turn.
95. Yasmin Khan (EDHREC 14491) - {T}: Exile the top card of your library. Until your next end step, you may play it. Doctor's companion (You can have two commanders if the other is the Doctor.)
96. Wiretapping (EDHREC 14565) - Then if you have nine or more cards in hand, you may play the exiled card without paying its mana cost.
97. Monastery Raid (EDHREC 14883) - You may play the exiled cards until the end of your next turn.
98. Anep, Vizier of Hazoret (EDHREC 15070) - Trample You may exert Anep as it attacks. When you do, exile the top two cards of your library. Until the end of your next turn, you may play those cards. (An exerted creature won't untap during your next untap step.)
99. Act on Impulse (EDHREC 15108) - Exile the top three cards of your library. Until end of turn, you may play those cards. (If you cast a spell this way, you still pay its costs. You can play a land this way only if you have an available land play remaining.)
100. Gila Courser (EDHREC 15261) - Whenever this creature attacks while saddled, exile the top card of your library. Until the end of your next turn, you may play that card. Saddle 1 (Tap any number of other creatures you control with total power 1 or more: This Mount becomes saddled until e...
101. Nathan Drake, Treasure Hunter (EDHREC 15493) - First strike You may spend mana as though it were mana of any color to cast spells you don't own or to activate abilities of permanents you control but don't own. Whenever Nathan Drake attacks, exile the top card of each player's library. You may cast a spe...
102. Shelldock Isle (EDHREC 15682) - {U}, {T}: You may play the exiled card without paying its mana cost if a library has twenty or fewer cards in it.
103. Bell Borca, Spectral Sergeant (EDHREC 15805) - Note the mana value of each card as it's put into exile. Bell Borca's power is equal to the greatest number noted for it this turn. At the beginning of your upkeep, exile the top card of your library. You may play that card this turn.
104. Annie Flash, the Veteran (EDHREC 16015) - Flash When Annie Flash enters, if you cast it, return target permanent card with mana value 3 or less from your graveyard to the battlefield tapped. Whenever Annie Flash becomes tapped, exile the top two cards of your library. You may play those cards this ...
105. Abbot of Keral Keep (EDHREC 16180) - Prowess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.) When this creature enters, exile the top card of your library. Until end of turn, you may play that card.
106. Muse Vortex (EDHREC 16317) - Exile the top X cards of your library. You may cast an instant or sorcery spell with mana value X or less from among them without paying its mana cost. Then put the exiled instant and sorcery cards that weren't cast this way into your hand and the rest on t...
107. Prophetic Flamespeaker (EDHREC 16582) - Double strike, trample Whenever this creature deals combat damage to a player, exile the top card of your library. You may play it this turn.
108. Outlaws' Fury (EDHREC 16828) - Creatures you control get +2/+0 until end of turn. If you control an outlaw, exile the top card of your library. Until the end of your next turn, you may play that card. (Assassins, Mercenaries, Pirates, Rogues, and Warlocks are outlaws.)
109. Superior Foes of Spider-Man (EDHREC 17338) - Trample Whenever you cast a spell with mana value 4 or greater, you may exile the top card of your library. If you do, you may play that card until you exile another card with this creature.
110. Hama, the Bloodbender (EDHREC 17501) - For as long as you control Hama, you may cast the exiled card during your turn by waterbending {X} rather than paying its mana cost, where X is its mana value.
111. Unlucky Witness (EDHREC 17571) - When this creature dies, exile the top two cards of your library. Until your next end step, you may play one of those cards.
112. Keldon Flamesage (EDHREC 17603) - You may cast the exiled card without paying its mana cost.
113. Discover the Impossible (EDHREC 17663) - You may cast the exiled card without paying its mana cost if it's an instant spell with mana value 2 or less.
114. Possibility Technician (EDHREC 17912) - For as long as that card remains exiled, you may play it if you control a Kavu.
115. Sizzling Changeling (EDHREC 17958) - Changeling (This card is every creature type.) When this creature dies, exile the top card of your library. Until the end of your next turn, you may play that card.
116. Cleon, Merry Champion (EDHREC 18259) - Double strike Heroic — Whenever you cast a spell that targets Cleon, exile the top card of your library. You may play that card until the end of your next turn.
117. Colfenor's Plans (EDHREC 18413) - When this enchantment enters, exile the top seven cards of your library face down. You may look at the cards exiled with this enchantment, and you may play lands and cast spells from among those cards. Skip your draw step. You can't cast more than one spell...
118. Endrider Spikespitter (EDHREC 18456) - Reach Start your engines! (If you have no speed, it starts at 1. It increases once on each of your turns when an opponent loses life. Max speed is 4.) Max speed — At the beginning of your upkeep, exile the top card of your library. You may play that card th...
119. Nivix, Aerie of the Firemind (EDHREC 18465) - {T}: Add {C}. {2}{U}{R}, {T}: Exile the top card of your library. Until your next turn, you may cast it if it's an instant or sorcery spell.
120. Boros Strike-Captain (EDHREC 18803) - Battalion — Whenever this creature and at least two other creatures attack, exile the top card of your library. During any turn you attacked with three or more creatures, you may play that card.
121. Collected Conjuring (EDHREC 18819) - Exile the top six cards of your library. You may cast up to two sorcery spells with mana value 3 or less from among them without paying their mana costs. Put the exiled cards not cast this way on the bottom of your library in a random order.
122. Evolving Door (EDHREC 18862) - You may cast the exiled card.
123. Sanar, Innovative First-Year (EDHREC 19025) - You may cast the exiled cards this turn.
124. Herald of Amity (EDHREC 19281) - Flying When this creature enters, exile the top eight cards of your library. You may cast an Aura spell from among them without paying its mana cost. Then put the rest on the bottom of your library in a random order. Whenever this creature attacks, it gets ...
125. Charforger (EDHREC 19465) - When this creature enters, create a 1/1 red Phyrexian Goblin creature token. Whenever another creature or artifact you control is put into a graveyard from the battlefield, put an oil counter on this creature. Remove three oil counters from this creature: E...
126. Grotag Night-Runner (EDHREC 19841) - Whenever this creature deals combat damage to a player, exile the top card of your library. You may play that card this turn.
127. Advanced Reconstruction (EDHREC 20013) - You may play the exiled card this turn.
128. Raphael, Most Attitude (EDHREC 20168) - Menace (This creature can't be blocked except by two or more creatures.) Alliance — Whenever another creature you control enters, you may exile the top card of your library. Whenever Raphael attacks, until end of turn, you may play a card exiled with Raphael.
129. Ardent Dustspeaker (EDHREC 20283) - Whenever this creature attacks, you may put an instant or sorcery card from your graveyard on the bottom of your library. If you do, exile the top two cards of your library. You may play those cards this turn.
130. Howltooth Hollow (EDHREC 20300) - {B}, {T}: You may play the exiled card without paying its mana cost if each player has no cards in hand.
131. Flameskull (EDHREC 20327) - Flying This creature can't block. Rejuvenation — When this creature dies, exile it. If you do, exile the top card of your library. Until the end of your next turn, you may play one of those cards. (If you cast Flameskull this way, you can't play the other c...
132. Riverwheel Sweep (EDHREC 20343) - Tap target creature. Put three stun counters on it. (If a permanent with a stun counter would become untapped, remove one from it instead.) Exile the top two cards of your library. Choose one of them. Until the end of your next turn, you may play that card.
133. Kulrath Zealot (EDHREC 20356) - When this creature enters, exile the top card of your library. Until the end of your next turn, you may play that card. Basic landcycling {1}{R} ({1}{R}, Discard this card: Search your library for a basic land card, reveal it, put it into your hand, then sh...
134. Irascible Wolverine (EDHREC 20599) - When this creature enters, exile the top card of your library. Until end of turn, you may play that card. Plot {2}{R} (You may pay {2}{R} and exile this card from your hand. Cast it as a sorcery on a later turn without paying its mana cost. Plot only as a s...
135. Equilibrium Adept (EDHREC 20701) - When this creature enters, exile the top card of your library. Until the end of your next turn, you may play that card. Flurry — Whenever you cast your second spell each turn, this creature gains double strike until end of turn.
136. Strongbox Raider (EDHREC 20774) - Raid — When this creature enters, if you attacked this turn, exile the top two cards of your library. Choose one of them. Until the end of your next turn, you may play that card.
137. Meeting of the Five (EDHREC 21074) - Exile the top ten cards of your library. You may cast spells with exactly three colors from among them this turn. Add {W}{W}{U}{U}{B}{B}{R}{R}{G}{G}. Spend this mana only to cast spells with exactly three colors.
138. Abstract Performance (EDHREC 21435) - Exile the top four cards of your library in a face-down pile, then exile the top four cards of your library in a face-up pile. An opponent chooses one of those piles. Put that pile into your graveyard. Look at the cards in the other pile. You may cast a spe...
139. Ire Shaman (EDHREC 21540) - Menace (This creature can't be blocked except by two or more creatures.) Megamorph {R} (You may cast this card face down as a 2/2 creature for {3}. Turn it face up any time for its megamorph cost and put a +1/+1 counter on it.) When this creature is turned ...
140. Diversion Specialist (EDHREC 22410) - Menace (This creature can't be blocked except by two or more creatures.) {1}, Sacrifice another creature or enchantment: Exile the top card of your library. You may play it this turn.
141. Magus of the Mind (EDHREC 22414) - {U}, {T}, Sacrifice this creature: Shuffle your library, then exile the top X cards, where X is one plus the number of spells cast this turn. Until end of turn, you may play lands and cast spells from among cards exiled this way without paying their mana co...
142. Living Lore (EDHREC 22636) - If you do, you may cast the exiled card without paying its mana cost.
143. Fateful Tempest (EDHREC 22789) - Until the end of your next turn, you may play the exiled cards.
144. Hazoret's Undying Fury (EDHREC 23134) - Shuffle your library, then exile the top four cards. You may cast any number of spells with mana value 5 or less from among them without paying their mana costs. Lands you control don't untap during your next untap step.
145. Warehouse Thief (EDHREC 23211) - {2}, {T}, Sacrifice an artifact or creature: Exile the top card of your library. Until the end of your next turn, you may play that card.
146. Tuskeri Firewalker (EDHREC 23537) - Boast — {1}: Exile the top card of your library. You may play that card this turn. (Activate only if this creature attacked this turn and only once each turn.)
147. Case of the Burning Masks (EDHREC 24023) - When this Case enters, it deals 3 damage to target creature an opponent controls. To solve — Three or more sources you controlled dealt damage this turn. (If unsolved, solve at the beginning of your end step.) Solved — Sacrifice this Case: Exile the top thr...
148. Goblin Researcher (EDHREC 24519) - When this creature enters, exile the top card of your library. During any turn you attacked with this creature, you may play that card.
149. Three Wishes (EDHREC 25841) - Exile the top three cards of your library face down. You may look at those cards for as long as they remain exiled. Until your next turn, you may play those cards. At the beginning of your next upkeep, put any of those cards you didn't play into your gravey...
150. Elemental Mascot (EDHREC 28191) - Flying, vigilance Opus — Whenever you cast an instant or sorcery spell, this creature gets +1/+0 until end of turn. If five or more mana was spent to cast that spell, exile the top card of your library. You may play that card until the end of your next turn.
151. Aerial Caravan (EDHREC 29758) - Flying {1}{U}{U}: Exile the top card of your library. Until end of turn, you may play that card. (Reveal the card as you exile it.)
152. Storybook Ride (EDHREC 31034) - Visit — Exile the top X cards of your library, where X is the number of Attractions you've visited this turn (including this one). You may play those cards this turn. At the beginning of the next end step, if any of those cards remain exiled, put them on th...
153. Goblin Savant (unranked) - {T}: Exile the top card of your library. If that card is a Goblin or an artifact card, you may play it this turn.
154. Golos, Tireless Pilgrim (unranked) - When Golos enters, you may search your library for a land card, put that card onto the battlefield tapped, then shuffle. {2}{W}{U}{B}{R}{G}: Exile the top three cards of your library. You may play them this turn without paying their mana costs.
155. Now THIS Is Aether Racing (unranked) - Team Cloudspire — This spell deals 3 damage to any target. Team Speed Demons — Exile the top two cards of your library. You may play those cards until your next end step.
156. Planeswalkerificate (unranked) - Enchant creature you control Enchanted creature is a planeswalker in addition to its other types. Its toughness becomes its loyalty. (You change its toughness to activate loyalty abilities. Damage lowers toughness. Toughness doesn't heal at end of turn.) It...
157. The Great Juggernaut (unranked) - At the beginning of your upkeep, sacrifice The Great Juggernaut unless you discard a card. Whenever The Great Juggernaut attacks, shuffle your library then exile the top card of your library. You may play that card without paying its mana cost this turn.
158. The Magic Bandit (unranked) - When The Magic Bandit deals combat damage to an opponent, exile the top card of that player's library. You may cast that card for as long as it remains exiled, and mana of any type can be spent to cast that spell. Whenever you cast a spell or play a land yo...
159. The Mysterious Sphere (unranked) - Advertising — {T}: Exile the top card of your library. You gain 1 life. Show — At the beginning of combat on your turn, if there are three or more cards exiled with The Mysterious Sphere, you may put them into your graveyard. If you do, create copies of eac...
160. The Powerful Dragon (unranked) - Flying Mentor (Whenever this creature attacks, put a +1/+1 counter on target attacking creature with lesser power.) Whenever one or more +1/+1 counters are put on a creature you control, exile the top card of your library. Until end of turn, you may play th...

### 8. Fight And Bite-Style Combat Resolution

Source: existing queue family after library_search
Available after current queue exclusion: 30

1. Domri, Anarch of Bolas (EDHREC 2585) - −2: Target creature you control fights target creature you don't control.
2. Frontier Siege (EDHREC 3256) - • Dragons — Whenever a creature you control with flying enters, you may have it fight target creature you don't control.
3. The Tarrasque (EDHREC 5703) - Whenever The Tarrasque attacks, it fights target creature defending player controls.
4. Temur Charm (EDHREC 6879) - It fights target creature you don't control.
5. Gruul Ragebeast (EDHREC 7457) - Whenever this creature or another creature you control enters, that creature fights target creature an opponent controls.
6. Temur War Shaman (EDHREC 7682) - Whenever a permanent you control is turned face up, if it's a creature, you may have it fight target creature you don't control.
7. Savage Punch (EDHREC 12712) - Target creature you control fights target creature you don't control.
8. Barroom Brawl (EDHREC 13202) - Target creature you control fights target creature the opponent to your left controls.
9. Brigid's Command (EDHREC 17253) - • Target creature you control fights target creature an opponent controls.
10. Unnatural Aggression (EDHREC 19225) - Target creature you control fights target creature an opponent controls.
11. Tenderize (EDHREC 19775) - Target creature you control deals damage equal to its power to target creature an opponent controls.
12. Hunt the Hunter (EDHREC 22436) - It fights target green creature an opponent controls.
13. Somberwald Stag (EDHREC 22959) - When this creature enters, you may have it fight target creature you don't control.
14. Brawl (EDHREC 23908) - Until end of turn, all creatures gain "{T}: This creature deals damage equal to its power to target creature."
15. Bite Down on Crime (EDHREC 24114) - It deals damage equal to its power to target creature you don't control.
16. Swift Kick (EDHREC 24840) - It fights target creature you don't control.
17. Wild Instincts (EDHREC 26017) - It fights target creature an opponent controls.
18. Spoils of the Hunt (EDHREC 26397) - Then that creature deals damage equal to its power to target creature an opponent controls.
19. Wing Puncture (EDHREC 26900) - Target creature you control deals damage equal to its power to target creature with flying.
20. Faunsbane Troll (EDHREC 27141) - {1}, Sacrifice an Aura attached to this creature: This creature fights target creature you don't control.
21. Scab-Clan Giant (EDHREC 28008) - When this creature enters, it fights target creature an opponent controls chosen at random.
22. Stalking Yeti (EDHREC 28402) - When this creature enters, if it's on the battlefield, it deals damage equal to its power to target creature an opponent controls and that creature deals damage equal to its power to this creature.
23. Cinder Shade (EDHREC 30122) - {R}, Sacrifice this creature: It deals damage equal to its power to target creature.
24. Karplusan Yeti (EDHREC 30125) - {T}: This creature deals damage equal to its power to target creature.
25. Flame Elemental (EDHREC 30441) - {R}, {T}, Sacrifice this creature: It deals damage equal to its power to target creature.
26. Minotaur Illusionist (EDHREC 30654) - {R}, Sacrifice this creature: It deals damage equal to its power to target creature.
27. Efteekay, Flame of the Kav (unranked) - Whenever Efteekay or another Kavu you control enters, it deals damage equal to its power to target creature.
28. Really Epic Punch (unranked) - Then it fights target creature you don't control.
29. Take the High Ground (unranked) - Target creature you control fights target creature you don't control.
30. The Cobra King (unranked) - • Strike first — Target Snake or Serpent you control fights target creature an opponent controls.

### 9. Goad And Attack-Pressure Effects

Source: existing queue family after library_search
Available after current queue exclusion: 119

1. Sphere of Safety (EDHREC 678) - Creatures can't attack you or planeswalkers you control unless their controller pays {X} for each of those creatures, where X is the number of enchantments you control.
2. Promise of Loyalty (EDHREC 1061) - Each of those creatures can't attack you or planeswalkers you control for as long as it has a vow counter on it.
3. Grenzo, Havoc Raiser (EDHREC 1627) - • Goad target creature that player controls.
4. Dragon's Rage Channeler (EDHREC 1800) - Delirium — As long as there are four or more card types among cards in your graveyard, this creature gets +2/+2, has flying, and attacks each combat if able.
5. Norn's Annex (EDHREC 1920) - Creatures can't attack you or planeswalkers you control unless their controller pays {W/P} for each of those creatures.
6. Archangel of Tithes (EDHREC 2171) - As long as this creature is untapped, creatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures.
7. Bloodthirsty Blade (EDHREC 2247) - (It attacks each combat if able and attacks a player other than you if able.)
8. Baird, Steward of Argive (EDHREC 2536) - Creatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures.
9. Geode Rager (EDHREC 2747) - Landfall — Whenever a land you control enters, goad each creature target player controls.
10. Bothersome Quasit (EDHREC 2983) - Whenever you cast a noncreature spell, goad target creature an opponent controls.
11. Ghoulish Impetus (EDHREC 3014) - (It attacks each combat if able and attacks a player other than you if able.)
12. Ulamog's Crusher (EDHREC 3123) - This creature attacks each combat if able.
13. Komainu Battle Armor (EDHREC 3225) - Whenever this creature or equipped creature deals combat damage to a player, goad each creature that player controls.
14. Chaos Dragon (EDHREC 3653) - This creature attacks each combat if able.
15. Illusionist's Gambit (EDHREC 3753) - They can't attack you or planeswalkers you control that combat.
16. Assault Suit (EDHREC 4077) - Equipped creature gets +2/+2, has haste, can't attack you or planeswalkers you control, and can't be sacrificed.
17. Redemption Arc (EDHREC 4144) - (It attacks each combat if able and attacks a player other than you if able.)
18. Martial Impetus (EDHREC 4210) - (It attacks each combat if able and attacks a player other than you if able.)
19. Marisi, Breaker of the Coil (EDHREC 4498) - Whenever a creature you control deals combat damage to a player, goad each creature that player controls.
20. Darksteel Juggernaut (EDHREC 4706) - This creature attacks each combat if able.
21. Eye of Nidhogg (EDHREC 4713) - (It attacks each combat if able and attacks a player other than you if able.)
22. Combat Calligrapher (EDHREC 5149) - Inklings can't attack you or planeswalkers you control.
23. Varchild, Betrayer of Kjeldor (EDHREC 5887) - Survivors your opponents control can't block, and they can't attack you or planeswalkers you control.
24. Red Death, Shipwrecker (EDHREC 6169) - Alluring Eyes — {T}: Goad target creature an opponent controls.
25. Laser Screwdriver (EDHREC 6296) - {3}, {T}: Goad target creature.
26. Psychic Impetus (EDHREC 6813) - (It attacks each combat if able and attacks a player other than you if able.)
27. Vow of Duty (EDHREC 7128) - Enchanted creature gets +2/+2, has vigilance, and can't attack you or planeswalkers you control.
28. Vow of Lightning (EDHREC 7426) - Enchanted creature gets +2/+2, has first strike, and can't attack you or planeswalkers you control.
29. Nettling Nuisance (EDHREC 7438) - (It attacks each combat if able and attacks a player other than you if able.)
30. Archon of Absolution (EDHREC 7445) - Creatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures.
31. Popular Entertainer (EDHREC 8598) - Commander creatures you own have "Whenever one or more creatures you control deal combat damage to a player, goad target creature that player controls." (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)
32. Taunting Kobold (EDHREC 8992) - Whenever this creature attacks, goad target creature an opponent controls.
33. Vow of Torment (EDHREC 9108) - Enchanted creature gets +2/+2, has menace, and can't attack you or planeswalkers you control.
34. Vow of Malice (EDHREC 9167) - Enchanted creature gets +2/+2, has intimidate, and can't attack you or planeswalkers you control.
35. Taunting Sliver (EDHREC 9299) - Sliver creatures you control have "When this creature enters, goad target creature an opponent controls." (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)
36. Acquired Mutation (EDHREC 9477) - (It attacks each combat if able and attacks a player other than you if able.)
37. Vow of Wildness (EDHREC 9889) - Enchanted creature gets +3/+3, has trample, and can't attack you or planeswalkers you control.
38. Flamewake Phoenix (EDHREC 9992) - This creature attacks each combat if able.
39. Fealty to the Realm (EDHREC 10324) - Enchanted creature attacks each combat if able and can't attack you.
40. Sly Instigator (EDHREC 10493) - (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)
41. Besmirch (EDHREC 10783) - (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)
42. Bohn, Beguiling Balladeer (EDHREC 10979) - Whenever you cast your second spell each turn, goad target creature an opponent controls.
43. Vow of Flight (EDHREC 11165) - Enchanted creature gets +2/+2, has flying, and can't attack you or planeswalkers you control.
44. The Beamtown Bullies (EDHREC 11545) - (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)
45. Frenzied Gorespawn (EDHREC 12131) - When this creature enters, for each opponent, goad target creature that player controls.
46. Insufferable Balladeer (EDHREC 13082) - (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)
47. Predatory Impetus (EDHREC 13112) - (It attacks each combat if able and attacks a player other than you if able.)
48. Maeve, Insidious Singer (EDHREC 13901) - {2}{U}: Goad target creature.
49. Maestros Confluence (EDHREC 14208) - • Goad each creature target player controls.
50. Incriminating Impetus (EDHREC 14235) - (It attacks each combat if able and attacks a player other than you if able.)
51. Killian, Decisive Mentor (EDHREC 14894) - (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)
52. Spectral Grasp (EDHREC 15319) - Enchanted creature can't attack you or planeswalkers you control.
53. Forbidding Spirit (EDHREC 15605) - When this creature enters, until your next turn, creatures can't attack you or planeswalkers you control unless their controller pays {2} for each of those creatures.
54. Skeletal Swarming (EDHREC 15747) - Each Skeleton you control has trample, attacks each combat if able, and gets +X/+0, where X is the number of other Skeletons you control.
55. Coercive Impetus (EDHREC 16557) - (It attacks each combat if able and attacks a player other than you if able.)
56. Kaima, the Fractured Calm (EDHREC 16725) - At the beginning of your end step, goad each creature your opponents control that's enchanted by an Aura you control.
57. Seifer, Balamb Rival (EDHREC 16740) - Whenever you attack a player, goad target creature that player controls.
58. Haktos the Unscarred (EDHREC 16886) - Haktos attacks each combat if able.
59. Akoum Firebird (EDHREC 17320) - This creature attacks each combat if able.
60. Oceanus Dragon (EDHREC 17352) - (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)
61. Juggernaut (EDHREC 18023) - This creature attacks each combat if able.
62. Coveted Peacock (EDHREC 18100) - Whenever this creature attacks, you may goad target creature defending player controls.
63. Furor of the Bitten (EDHREC 18330) - Enchanted creature gets +2/+2 and attacks each combat if able.
64. Alpine Guide (EDHREC 18424) - This creature attacks each combat if able.
65. Oathsworn Knight (EDHREC 18528) - This creature attacks each combat if able.
66. Jeering Homunculus (EDHREC 18699) - When this creature enters, you may goad target creature.
67. Insatiable Gorgers (EDHREC 18718) - This creature attacks each combat if able.
68. Goblin Racketeer (EDHREC 19484) - Whenever this creature attacks, you may goad target creature defending player controls.
69. Barricade Breaker (EDHREC 19488) - This creature attacks each combat if able.
70. Deathbellow Raider (EDHREC 19675) - This creature attacks each combat if able.
71. Red Herring (EDHREC 20510) - This creature attacks each combat if able.
72. Underworld Rage-Hound (EDHREC 21711) - This creature attacks each combat if able.
73. Crazed Goblin (EDHREC 21858) - This creature attacks each combat if able.
74. Phyrexian Snowcrusher (EDHREC 21866) - This creature attacks each combat if able.
75. Mogis's Warhound (EDHREC 21890) - This creature attacks each combat if able.
76. Bloodcrazed Neonate (EDHREC 22003) - This creature attacks each combat if able.
77. The Sentry, Golden Guardian (EDHREC 22028) - When The Sentry enters, target opponent creates The Void, a legendary 5/5 black Horror Villain creature token with flying, indestructible, and "The Void attacks each combat if able."
78. Impetuous Sunchaser (EDHREC 22187) - This creature attacks each combat if able.
79. Monstrous Carabid (EDHREC 22730) - This creature attacks each combat if able.
80. Battle-Mad Ronin (EDHREC 23362) - This creature attacks each combat if able.
81. Impending Doom (EDHREC 23590) - Enchanted creature gets +3/+3 and attacks each combat if able.
82. Riot Piker (EDHREC 23683) - This creature attacks each combat if able.
83. Galvanic Juggernaut (EDHREC 23915) - This creature attacks each combat if able.
84. Mishra's Juggernaut (EDHREC 24369) - This creature attacks each combat if able.
85. Lust for War (EDHREC 24870) - Enchanted creature attacks each combat if able.
86. Utvara Scalper (EDHREC 24947) - This creature attacks each combat if able.
87. Manticore Eternal (EDHREC 25209) - This creature attacks each combat if able.
88. Tormentor's Trident (EDHREC 25376) - Equipped creature gets +3/+0 and attacks each combat if able.
89. Primordial Ooze (EDHREC 25477) - This creature attacks each combat if able.
90. Bloodshed Fever (EDHREC 26090) - Enchanted creature attacks each combat if able.
91. Ramroller (EDHREC 26733) - This creature attacks each combat if able.
92. Kuldotha Ringleader (EDHREC 26788) - This creature attacks each combat if able.
93. Sprinting Warbrute (EDHREC 27025) - This creature attacks each combat if able.
94. Valley Dasher (EDHREC 27423) - This creature attacks each combat if able.
95. Guise of Fire (EDHREC 27591) - Enchanted creature gets +1/-1 and attacks each combat if able.
96. Mage-Ring Bully (EDHREC 27731) - This creature attacks each combat if able.
97. Uncontrollable Anger (EDHREC 27872) - Enchanted creature gets +2/+2 and attacks each combat if able.
98. Rubblebelt Recluse (EDHREC 27944) - This creature attacks each combat if able.
99. Goblin Brigand (EDHREC 27975) - This creature attacks each combat if able.
100. Ashen Monstrosity (EDHREC 27998) - This creature attacks each combat if able.
101. Kill-Suit Cultist (EDHREC 28108) - This creature attacks each combat if able.
102. Infectious Bloodlust (EDHREC 28385) - Enchanted creature gets +2/+1, has haste, and attacks each combat if able.
103. Otarian Juggernaut (EDHREC 28409) - Threshold — As long as there are seven or more cards in your graveyard, this creature gets +3/+0 and attacks each combat if able.
104. Reckless Cohort (EDHREC 28694) - This creature attacks each combat if able unless you control another Ally.
105. Tattermunge Maniac (EDHREC 28849) - This creature attacks each combat if able.
106. Sabertooth Alley Cat (EDHREC 28984) - This creature attacks each combat if able.
107. Berserkers of Blood Ridge (EDHREC 29549) - This creature attacks each combat if able.
108. Reckless Brute (EDHREC 29624) - This creature attacks each combat if able.
109. Flameborn Hellion (EDHREC 29651) - This creature attacks each combat if able.
110. Emberwilde Caliph (EDHREC 29680) - This creature attacks each combat if able.
111. Frontline Rebel (EDHREC 29837) - This creature attacks each combat if able.
112. Bloodrock Cyclops (EDHREC 29891) - This creature attacks each combat if able.
113. Marauding Maulhorn (EDHREC 29994) - This creature attacks each combat if able unless you control a creature named Advocate of the Beast.
114. Tectonic Fiend (EDHREC 30452) - This creature attacks each combat if able.
115. Cogwork Tracker (EDHREC 30472) - This creature attacks each combat if able.
116. Urborg Drake (EDHREC 30515) - This creature attacks each combat if able.
117. Thran War Machine (EDHREC 30661) - This creature attacks each combat if able.
118. Boomstacker (unranked) - This creature attacks each combat if able.
119. Catch of the Day (unranked) - Whenever this creature attacks → Scry 2; goad target creature an opponent controls; or tap target creature an opponent controls.

### 10. Non-Graveyard Exile Effects

Source: corpus-mined follow-on seam
Available after current queue exclusion: 439

1. Bojuka Bog (EDHREC 27) - When this land enters, exile target player's graveyard.
2. Deadly Rollick (EDHREC 115) - Exile target creature.
3. Farewell (EDHREC 151) - • Exile all artifacts.
4. Reality Shift (EDHREC 270) - Exile target creature.
5. Despark (EDHREC 390) - Exile target permanent with mana value 4 or greater.
6. Ephemerate (EDHREC 443) - Exile target creature you control, then return it to the battlefield under its owner's control.
7. Conjurer's Closet (EDHREC 504) - At the beginning of your end step, you may exile target creature you control, then return that card to the battlefield under your control.
8. Opposition Agent (EDHREC 515) - While an opponent is searching their library, they exile each card they find.
9. Displacer Kitten (EDHREC 535) - Avoidance — Whenever you cast a noncreature spell, exile up to one target nonland permanent you control, then return that card to the battlefield under its owner's control.
10. Cloudshift (EDHREC 801) - Exile target creature you control, then return that card to the battlefield under your control.
11. Resculpt (EDHREC 827) - Exile target artifact or creature.
12. Tear Asunder (EDHREC 890) - Exile target artifact or enchantment.
13. Teleportation Circle (EDHREC 1006) - At the beginning of your end step, exile up to one target artifact or creature you control, then return that card to the battlefield under its owner's control.
14. Grasp of Fate (EDHREC 1104) - When this enchantment enters, for each opponent, exile up to one target nonland permanent that player controls until this enchantment leaves the battlefield.
15. Skyclave Apparition (EDHREC 1198) - When this creature enters, exile up to one target nonland, nontoken permanent you don't control with mana value 4 or less.
16. Thassa, Deep-Dwelling (EDHREC 1215) - At the beginning of your end step, exile up to one other target creature you control, then return that card to the battlefield under your control.
17. Baleful Mastery (EDHREC 1261) - Exile target creature or planeswalker.
18. Restoration Angel (EDHREC 1342) - When this creature enters, you may exile target non-Angel creature you control, then return that card to the battlefield under your control.
19. Return to Dust (EDHREC 1366) - Exile target artifact or enchantment.
20. Utter End (EDHREC 1494) - Exile target nonland permanent.
21. Urza's Ruinous Blast (EDHREC 1530) - Exile all nonland permanents that aren't legendary.
22. Wild-Magic Sorcerer (EDHREC 1594) - The first spell you cast from exile each turn has cascade.
23. Sheltered by Ghosts (EDHREC 1629) - When this Aura enters, exile target nonland permanent an opponent controls until this Aura leaves the battlefield.
24. Extraplanar Lens (EDHREC 1715) - Imprint — When this artifact enters, you may exile target land you control.
25. Ravenform (EDHREC 1730) - Exile target artifact or creature.
26. Touch the Spirit Realm (EDHREC 1760) - When this enchantment enters, exile up to one target artifact or creature until this enchantment leaves the battlefield.
27. Aven Interrupter (EDHREC 1790) - When this creature enters, exile target spell.
28. Flicker of Fate (EDHREC 2127) - Exile target creature or enchantment, then return it to the battlefield under its owner's control.
29. Winds of Abandon (EDHREC 2131) - Exile target creature you don't control.
30. Mnemonic Betrayal (EDHREC 2204) - Exile all opponents' graveyards.
31. Displace (EDHREC 2253) - Exile up to two target creatures you control, then return those cards to the battlefield under their owner's control.
32. Rest in Peace (EDHREC 2274) - When this enchantment enters, exile all graveyards.
33. Banishing Light (EDHREC 2334) - When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.
34. Crib Swap (EDHREC 2366) - Exile target creature.
35. Lae'zel's Acrobatics (EDHREC 2550) - Exile all nontoken creatures you control, then roll a d20.
36. Duplicant (EDHREC 2649) - Imprint — When this creature enters, you may exile target nontoken creature.
37. Merciless Eviction (EDHREC 2786) - • Exile all artifacts.
38. Sundial of the Infinite (EDHREC 2817) - (Exile all spells and abilities from the stack.
39. Éowyn, Fearless Knight (EDHREC 2989) - When Éowyn enters, exile target creature an opponent controls with greater power.
40. Y'shtola Rhul (EDHREC 3000) - At the beginning of your end step, exile target creature you control, then return it to the battlefield under its owner's control.
41. Nautiloid Ship (EDHREC 3010) - When this Vehicle enters, exile target player's graveyard.
42. Ghostway (EDHREC 3212) - Exile each creature you control.
43. Pit of Offerings (EDHREC 3297) - When this land enters, exile up to three target cards from graveyards.
44. Council's Judgment (EDHREC 3409) - Exile each permanent with the most votes or tied for most votes.
45. Titan's Presence (EDHREC 3422) - Exile target creature if its power is less than or equal to the revealed card's power.
46. Angel of Serenity (EDHREC 3476) - When this creature enters, you may exile up to three other target creatures from the battlefield and/or creature cards from graveyards.
47. Unlicensed Hearse (EDHREC 3724) - {T}: Exile up to two target cards from a single graveyard.
48. Selective Obliteration (EDHREC 3733) - Then exile each permanent unless it's colorless or it's only the color its controller chose.
49. Crush Contraband (EDHREC 3816) - • Exile target artifact.
50. Palace Jailer (EDHREC 3952) - When this creature enters, exile target creature an opponent controls until an opponent becomes the monarch.
51. Ossification (EDHREC 3954) - When this Aura enters, exile target creature or planeswalker an opponent controls until this Aura leaves the battlefield.
52. Angel of Finality (EDHREC 4196) - When this creature enters, exile target player's graveyard.
53. Calamity of the Titans (EDHREC 4198) - Exile each creature and planeswalker with mana value less than the revealed card's mana value.
54. Final Act (EDHREC 4222) - • Exile all graveyards.
55. Everything Comes to Dust (EDHREC 4342) - Exile all creatures except those that share a creature type with a creature that convoked this spell, all artifacts, and all enchantments.
56. Far Traveler (EDHREC 4484) - Commander creatures you own have "At the beginning of your end step, exile up to one target tapped creature you control, then return it to the battlefield under its owner's control."
57. White Auracite (EDHREC 4487) - When this artifact enters, exile target nonland permanent an opponent controls until this artifact leaves the battlefield.
58. Fractured Identity (EDHREC 4538) - Exile target nonland permanent.
59. Vanishing Verse (EDHREC 4715) - Exile target monocolored permanent.
60. The Wanderer (EDHREC 4731) - −2: Exile target creature with power 4 or greater.
61. Contraband Livestock (EDHREC 4732) - Exile target creature, then roll a d20.
62. Slip On the Ring (EDHREC 4890) - Exile target creature you own, then return it to the battlefield under your control.
63. Ravnica at War (EDHREC 4954) - Exile all multicolored permanents.
64. Abstruse Appropriation (EDHREC 5127) - Exile target nonland permanent.
65. Heartless Conscription (EDHREC 5164) - Exile all creatures.
66. Suspend (EDHREC 5288) - Exile target creature and put two time counters on it.
67. Scour from Existence (EDHREC 5340) - Exile target permanent.
68. Day's Undoing (EDHREC 5589) - (Exile all spells and abilities from the stack, including this card.
69. Worldgorger Dragon (EDHREC 5669) - When this creature enters, exile all other permanents you control.
70. Golden Argosy (EDHREC 5682) - Whenever Golden Argosy attacks, exile each creature that crewed it this turn.
71. Hurl Through Hell (EDHREC 5715) - Exile target creature.
72. Chains of Custody (EDHREC 5826) - When this Aura enters, exile target nonland permanent an opponent controls until this Aura leaves the battlefield.
73. Skullsnatcher (EDHREC 5829) - Whenever this creature deals combat damage to a player, exile up to two target cards from that player's graveyard.
74. Venser, the Sojourner (EDHREC 6009) - +2: Exile target permanent you own.
75. Introduction to Annihilation (EDHREC 6047) - Exile target nonland permanent.
76. Soul Partition (EDHREC 6140) - Exile target nonland permanent.
77. Exorcise (EDHREC 6268) - Exile target artifact, enchantment, or creature with power 4 or greater.
78. Ashen Rider (EDHREC 6320) - When this creature enters or dies, exile target permanent.
79. Unexplained Absence (EDHREC 6367) - For each player, exile up to one target nonland permanent that player controls.
80. Wastescape Battlemage (EDHREC 6388) - When you cast this spell, if it was kicked with its {G} kicker, exile target artifact or enchantment an opponent controls.
81. Overwhelming Remorse (EDHREC 6476) - Exile target creature or planeswalker.
82. Constricting Sliver (EDHREC 6521) - Sliver creatures you control have "When this creature enters, you may exile target creature an opponent controls until this creature leaves the battlefield."
83. Smirking Spelljacker (EDHREC 6525) - When this creature enters, exile target spell an opponent controls.
84. Buried in the Garden (EDHREC 6583) - When this Aura enters, exile target nonland permanent you don't control until this Aura leaves the battlefield.
85. Riveteers Charm (EDHREC 6597) - • Exile target player's graveyard.
86. Leonin Relic-Warder (EDHREC 6653) - When this creature enters, you may exile target artifact or enchantment.
87. Leveler (EDHREC 6724) - When this creature enters, exile all cards from your library.
88. Karn Liberated (EDHREC 6800) - −3: Exile target permanent.
89. Mystifying Maze (EDHREC 6896) - {4}, {T}: Exile target attacking creature an opponent controls.
90. Justiciar's Portal (EDHREC 6966) - Exile target creature you control, then return that card to the battlefield under its owner's control.
91. Legions to Ashes (EDHREC 6976) - Exile target nonland permanent an opponent controls and all tokens that player controls with the same name as that permanent.
92. Legion's Initiative (EDHREC 7014) - {R}{W}, Exile this enchantment: Exile all creatures you control.
93. Unidentified Hovership (EDHREC 7066) - When this Vehicle enters, exile up to one target creature with toughness 5 or less.
94. March of Otherworldly Light (EDHREC 7320) - Exile target artifact, creature, or enchantment with mana value X or less.
95. Espers to Magicite (EDHREC 7377) - Exile each opponent's graveyard.
96. Hive of the Eye Tyrant (EDHREC 7485) - {3}{B}: Until end of turn, this land becomes a 3/3 black Beholder creature with menace and "Whenever this creature attacks, exile target card from defending player's graveyard." It's still a land.
97. Time Stop (EDHREC 7511) - (Exile all spells and abilities, including this spell.
98. Meneldor, Swift Savior (EDHREC 7517) - Whenever Meneldor deals combat damage to a player, exile up to one target creature you own, then return it to the battlefield under your control.
99. Admonition Angel (EDHREC 7537) - Landfall — Whenever a land you control enters, you may exile target nonland permanent other than this creature.
100. Obeka, Brute Chronologist (EDHREC 7552) - (Exile all spells and abilities from the stack.
101. Guardian of Ghirapur (EDHREC 7689) - When this creature enters, exile up to one other target creature or artifact you control.
102. Mandate of Peace (EDHREC 7727) - Exile all spells and abilities from the stack, including this spell.)
103. Devourer of Destiny (EDHREC 7806) - When you cast this spell, exile target permanent that's one or more colors.
104. Revoke Existence (EDHREC 7880) - Exile target artifact or enchantment.
105. O-Kagachi, Vengeful Kami (EDHREC 7962) - Whenever O-Kagachi deals combat damage to a player, if that player attacked you during their last turn, exile target nonland permanent that player controls.
106. Worldfire (EDHREC 7984) - Exile all permanents.
107. Detention Sphere (EDHREC 7999) - When this enchantment enters, you may exile target nonland permanent not named Detention Sphere and all other permanents with the same name as that permanent.
108. Journey to Nowhere (EDHREC 8187) - When this enchantment enters, exile target creature.
109. Blue Mage's Cane (EDHREC 8217) - Equipped creature gets +0/+2, is a Wizard in addition to its other types, and has "Whenever this creature attacks, exile up to one target instant or sorcery card from defending player's graveyard.
110. Gideon Blackblade (EDHREC 8347) - −6: Exile target nonland permanent.
111. Epic Downfall (EDHREC 8437) - Exile target creature with mana value 3 or greater.
112. Salvation Swan (EDHREC 8456) - Whenever this creature or another Bird you control enters, exile up to one target creature you control without flying.
113. Summary Dismissal (EDHREC 8466) - Exile all other spells and counter all abilities.
114. Seal from Existence (EDHREC 8474) - When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.
115. Angel of the Dire Hour (EDHREC 8512) - When this creature enters, if you cast it from your hand, exile all attacking creatures.
116. Haytham Kenway (EDHREC 8532) - When Haytham Kenway enters, for each opponent, exile up to one target creature that player controls until Haytham Kenway leaves the battlefield.
117. Devout Chaplain (EDHREC 8592) - {T}, Tap two untapped Humans you control: Exile target artifact or enchantment.
118. Gale's Redirection (EDHREC 8594) - Exile target spell, then roll a d20 and add that spell's mana value.
119. Annex Sentry (EDHREC 8605) - When this creature enters, exile target artifact or creature an opponent controls with mana value 3 or less until this creature leaves the battlefield.
120. Trapjaw Tyrant (EDHREC 8716) - Enrage — Whenever this creature is dealt damage, exile target creature an opponent controls until this creature leaves the battlefield.
121. Conclave Tribunal (EDHREC 8848) - When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.
122. Mysterious Stranger (EDHREC 8854) - When this creature enters, for each graveyard with an instant or sorcery card in it, exile target instant or sorcery card from that graveyard.
123. In the Trenches (EDHREC 8894) - {5}{W}: Exile target nonland permanent you don't control until this enchantment leaves the battlefield.
124. Final Judgment (EDHREC 8895) - Exile all creatures.
125. Stalking Leonin (EDHREC 8914) - Reveal the player you chose: Exile target creature that's attacking you if it's controlled by the chosen player.
126. Trapped in the Screen (EDHREC 8935) - When this enchantment enters, exile target artifact, creature, or enchantment an opponent controls until this enchantment leaves the battlefield.
127. On Thin Ice (EDHREC 9006) - When this Aura enters, exile target creature an opponent controls until this Aura leaves the battlefield.
128. Kappa Tech-Wrecker (EDHREC 9037) - When you do, exile target artifact or enchantment that player controls.
129. Reenact the Crime (EDHREC 9089) - Exile target nonland card in a graveyard that was put there from anywhere this turn.
130. Perilous Vault (EDHREC 9276) - {5}, {T}, Exile this artifact: Exile all nonland permanents.
131. Become Anonymous (EDHREC 9290) - Exile target nontoken creature you own and the top two cards of your library in a face-down pile, shuffle that pile, then cloak those cards.
132. Release to the Wind (EDHREC 9307) - Exile target nonland permanent.
133. Ultima (EDHREC 9319) - (Exile all spells and abilities from the stack, including this card.
134. Devouring Light (EDHREC 9344) - Exile target attacking or blocking creature.
135. Agent of Erebos (EDHREC 9536) - Constellation — Whenever this creature or another enchantment you control enters, exile target player's graveyard.
136. Thieves' Auction (EDHREC 9548) - Exile all nontoken permanents.
137. Assimilation Aegis (EDHREC 9577) - When this Equipment enters, exile up to one target creature until this Equipment leaves the battlefield.
138. Portable Hole (EDHREC 9581) - When this artifact enters, exile target nonland permanent an opponent controls with mana value 2 or less until this artifact leaves the battlefield.
139. Leyline Binding (EDHREC 9642) - When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.
140. Calamity's Wake (EDHREC 9680) - Exile all graveyards.
141. Nightmare Unmaking (EDHREC 9697) - • Exile each creature with power greater than the number of cards in your hand.
142. Skyskipper Duo (EDHREC 9718) - When this creature enters, exile up to one other target creature you control.
143. Lay Down Arms (EDHREC 9793) - Exile target creature with mana value less than or equal to the number of Plains you control.
144. Sinister Concierge (EDHREC 9798) - If you do, exile up to one target creature and put three time counters on it.
145. Break Down the Door (EDHREC 9977) - • Exile target artifact.
146. Spell Queller (EDHREC 10194) - When this creature enters, exile target spell with mana value 4 or less.
147. Dakkon, Shadow Slayer (EDHREC 10284) - −3: Exile target creature.
148. Glorious End (EDHREC 10325) - (Exile all spells and abilities from the stack, including this card.
149. Extinction Event (EDHREC 10412) - Exile each creature with mana value of the chosen quality.
150. Faith Unbroken (EDHREC 10494) - When this Aura enters, exile target creature an opponent controls until this Aura leaves the battlefield.
151. Catapult Master (EDHREC 10495) - Tap five untapped Soldiers you control: Exile target creature.
152. Discontinuity (EDHREC 10575) - (Exile all spells and abilities from the stack, including this card.
153. Flicker (EDHREC 10576) - Exile target nontoken permanent, then return it to the battlefield under its owner's control.
154. Koh, the Face Stealer (EDHREC 10678) - When Koh enters, exile up to one other target creature.
155. Transmogrify (EDHREC 10760) - Exile target creature.
156. Banisher Priest (EDHREC 11002) - When this creature enters, exile target creature an opponent controls until this creature leaves the battlefield.
157. Angelic Ascension (EDHREC 11016) - Exile target creature or planeswalker.
158. Anoint with Affliction (EDHREC 11042) - Exile target creature if it has mana value 3 or less.
159. Aether Snap (EDHREC 11079) - Remove all counters from all permanents and exile all tokens.
160. Skybind (EDHREC 11155) - Constellation — Whenever this enchantment or another enchantment you control enters, exile target nonenchantment permanent.
161. Ashiok, Nightmare Weaver (EDHREC 11179) - −10: Exile all cards from all opponents' hands and graveyards.
162. Icewind Stalwart (EDHREC 11316) - Protection Fighting Style — When this creature enters, exile up to one target non-Warrior creature you control, then return it to the battlefield under its owner's control.
163. Chaotic Transformation (EDHREC 11366) - Exile up to one target artifact, up to one target creature, up to one target enchantment, up to one target planeswalker, and/or up to one target land.
164. Web Up (EDHREC 11527) - When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.
165. Thief of Existence (EDHREC 11608) - When you cast this spell, exile up to one target noncreature, nonland permanent an opponent controls with mana value 4 or less.
166. Stasis Snare (EDHREC 11615) - When this enchantment enters, exile target creature an opponent controls until this enchantment leaves the battlefield.
167. Beyond the Quiet (EDHREC 11632) - Exile all creatures and Spacecraft.
168. Mistmeadow Witch (EDHREC 11657) - {2}{W}{U}: Exile target creature.
169. Phyrexian Ingester (EDHREC 11760) - Imprint — When this creature enters, you may exile target nontoken creature.
170. Author of Shadows (EDHREC 11899) - When this creature enters, exile all opponents' graveyards.
171. All-Fates Stalker (EDHREC 11909) - When this creature enters, exile up to one target non-Assassin creature until this creature leaves the battlefield.
172. Wanderer's Strike (EDHREC 11998) - Exile target creature, then proliferate.
173. Turn to Mist (EDHREC 12119) - Exile target creature.
174. Colossal Whale (EDHREC 12149) - Whenever this creature attacks, you may exile target creature defending player controls until this creature leaves the battlefield.
175. Boneyard Parley (EDHREC 12154) - Exile up to five target creature cards from graveyards.
176. Drach'Nyen (EDHREC 12171) - Echo of the First Murder — When Drach'Nyen enters, exile up to one target creature.
177. Earth Kingdom Jailer (EDHREC 12458) - When this creature enters, exile up to one target artifact, creature, or enchantment an opponent controls with mana value 3 or greater until this creature leaves the battlefield.
178. Wall of Nets (EDHREC 12637) - At end of combat, exile all creatures blocked by this creature.
179. Settle the Score (EDHREC 12780) - Exile target creature.
180. Erase (EDHREC 12789) - Exile target enchantment.
181. Fade into Antiquity (EDHREC 12918) - Exile target artifact or enchantment.
182. Aligned Hedron Network (EDHREC 13059) - When this artifact enters, exile all creatures with power 5 or greater until this artifact leaves the battlefield.
183. Voidwalk (EDHREC 13154) - Exile target creature.
184. Sigrid, God-Favored (EDHREC 13207) - When Sigrid enters, exile up to one target attacking or blocking creature until Sigrid leaves the battlefield.
185. Not on My Watch (EDHREC 13208) - Exile target attacking creature.
186. Synthetic Destiny (EDHREC 13297) - Exile all creatures you control.
187. Mysterious Limousine (EDHREC 13299) - Whenever this Vehicle enters or attacks, exile up to one other target creature until this Vehicle leaves the battlefield.
188. Hardlight Containment (EDHREC 13514) - When this Aura enters, exile target creature an opponent controls until this Aura leaves the battlefield.
189. Sculpted Sunburst (EDHREC 13551) - If you chose a creature this way, exile each creature not chosen by any player this way.
190. Ruin Ghost (EDHREC 13713) - {W}, {T}: Exile target land you control, then return it to the battlefield under your control.
191. Aurelia's Vindicator (EDHREC 13732) - When this creature is turned face up, exile up to X other target creatures from the battlefield and/or creature cards from graveyards.
192. Act of Authority (EDHREC 13897) - When this enchantment enters, you may exile target artifact or enchantment.
193. Banish to Another Universe (EDHREC 13943) - When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.
194. Kin-Tree Severance (EDHREC 14021) - Exile target permanent with mana value 3 or greater.
195. Vanish into Eternity (EDHREC 14076) - Exile target nonland permanent.
196. Mass Polymorph (EDHREC 14092) - Exile all creatures you control, then reveal cards from the top of your library until you reveal that many creature cards.
197. Borrowed Time (EDHREC 14202) - When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.
198. Prismatic Ending (EDHREC 14244) - Converge — Exile target nonland permanent if its mana value is less than or equal to the number of colors of mana spent to cast this spell.
199. Declaration in Stone (EDHREC 14300) - Exile target creature and all other creatures its controller controls with the same name as that creature.
200. Legacy Weapon (EDHREC 14449) - {W}{U}{B}{R}{G}: Exile target permanent.

### 11. Power/Toughness Modification

Source: corpus-mined follow-on seam
Available after current queue exclusion: 4070

1. Toxic Deluge (EDHREC 66) - All creatures get -X/-X until end of turn.
2. Animate Dead (EDHREC 229) - Enchanted creature gets -1/-0.
3. Patchwork Banner (EDHREC 244) - Creatures you control of the chosen type get +1/+1.
4. Blackblade Reforged (EDHREC 329) - Equipped creature gets +1/+1 for each land you control.
5. Shadowspear (EDHREC 331) - Equipped creature gets +1/+1 and has trample and lifelink.
6. Craterhoof Behemoth (EDHREC 337) - When this creature enters, creatures you control gain trample and get +X/+X until end of turn, where X is the number of creatures you control.
7. Faeburrow Elder (EDHREC 523) - This creature gets +1/+1 for each color among permanents you control.
8. Ignoble Hierarch (EDHREC 533) - Exalted (Whenever a creature you control attacks alone, that creature gets +1/+1 until end of turn.)
9. Commander's Plate (EDHREC 534) - Equipped creature gets +3/+3 and has protection from each color that's not in your commander's color identity.
10. Sword of Feast and Famine (EDHREC 538) - Equipped creature gets +2/+2 and has protection from black and from green.
11. Overwhelming Stampede (EDHREC 548) - Until end of turn, creatures you control gain trample and get +X/+X, where X is the greatest power among creatures you control.
12. Darksteel Mutation (EDHREC 577) - Enchanted creature is an Insect artifact creature with base power and toughness 0/1 and has indestructible, and it loses all other abilities, card types, and creature types.
13. All That Glitters (EDHREC 601) - Enchanted creature gets +1/+1 for each artifact and/or enchantment you control.
14. Intangible Virtue (EDHREC 632) - Creature tokens you control get +1/+1 and have vigilance.
15. Mirari's Wake (EDHREC 640) - Creatures you control get +1/+1.
16. Rising of the Day (EDHREC 657) - Legendary creatures you control get +1/+0.
17. Shared Animosity (EDHREC 665) - Whenever a creature you control attacks, it gets +1/+0 until end of turn for each other attacking creature that shares a creature type with it.
18. Goreclaw, Terror of Qal Sisma (EDHREC 676) - Whenever Goreclaw attacks, each creature you control with power 4 or greater gets +1/+1 and gains trample until end of turn.
19. Harmonic Prodigy (EDHREC 688) - Prowess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.)
20. Banner of Kinship (EDHREC 712) - Creatures you control of the chosen type get +1/+1 for each fellowship counter on this artifact.
21. Flowering of the White Tree (EDHREC 746) - Legendary creatures you control get +2/+1 and have ward {1}.
22. Rancor (EDHREC 752) - Enchanted creature gets +2/+0 and has trample.
23. Elesh Norn, Grand Cenobite (EDHREC 766) - Other creatures you control get +2/+2.
24. Noble Hierarch (EDHREC 776) - Exalted (Whenever a creature you control attacks alone, that creature gets +1/+1 until end of turn.)
25. Tyvar's Stand (EDHREC 794) - Target creature you control gets +X/+X and gains hexproof and indestructible until end of turn.
26. Hammer of Nazahn (EDHREC 798) - Equipped creature gets +2/+0 and has indestructible.
27. Tragic Slip (EDHREC 807) - Target creature gets -1/-1 until end of turn.
28. Champion's Helm (EDHREC 810) - Equipped creature gets +2/+2.
29. Valley Floodcaller (EDHREC 831) - Whenever you cast a noncreature spell, Birds, Frogs, Otters, and Rats you control get +1/+1 until end of turn.
30. Heraldic Banner (EDHREC 837) - Creatures you control of the chosen color get +1/+0.
31. Bear Umbra (EDHREC 844) - Enchanted creature gets +2/+2 and has "Whenever this creature attacks, untap all lands you control."
32. Caged Sun (EDHREC 847) - Creatures you control of the chosen color get +1/+1.
33. Veyran, Voice of Duality (EDHREC 851) - Magecraft — Whenever you cast or copy an instant or sorcery spell, Veyran gets +1/+1 until end of turn.
34. Mirror Entity (EDHREC 891) - {X}: Until end of turn, creatures you control have base power and toughness X/X and gain all creature types.
35. Colossus Hammer (EDHREC 910) - Equipped creature gets +10/+10 and loses flying.
36. Elvish Archdruid (EDHREC 915) - Other Elf creatures you control get +1/+1.
37. Loxodon Warhammer (EDHREC 917) - Equipped creature gets +3/+0 and has trample and lifelink.
38. Coat of Arms (EDHREC 928) - Each creature gets +1/+1 for each other creature on the battlefield that shares at least one creature type with it.
39. Defile (EDHREC 955) - Target creature gets -1/-1 until end of turn for each Swamp you control.
40. Excalibur, Sword of Eden (EDHREC 962) - Equipped creature gets +10/+0 and has vigilance.
41. Bastion Protector (EDHREC 977) - Commander creatures you control get +2/+2 and have indestructible.
42. Dismember (EDHREC 978) - Target creature gets -5/-5 until end of turn.
43. Moraug, Fury of Akoum (EDHREC 1013) - Each creature you control gets +1/+0 for each time it has attacked this turn.
44. Castle Embereth (EDHREC 1030) - {1}{R}{R}, {T}: Creatures you control get +1/+0 until end of turn.
45. Ethereal Armor (EDHREC 1062) - Enchanted creature gets +1/+1 for each enchantment you control and has first strike.
46. Stormcatch Mentor (EDHREC 1102) - Prowess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.)
47. Xenagos, God of Revels (EDHREC 1180) - At the beginning of combat on your turn, another target creature you control gains haste and gets +X/+X until end of turn, where X is that creature's power.
48. Enduring Courage (EDHREC 1211) - Whenever another creature you control enters, it gets +2/+0 and gains haste until end of turn.
49. Slayers' Stronghold (EDHREC 1217) - {R}{W}, {T}: Target creature gets +2/+0 and gains vigilance and haste until end of turn.
50. Amphibian Downpour (EDHREC 1244) - Enchanted creature loses all abilities and is a blue Frog creature with base power and toughness 1/1.
51. Moonshaker Cavalry (EDHREC 1286) - When this creature enters, creatures you control gain flying and get +X/+X until end of turn, where X is the number of creatures you control.
52. Lavaspur Boots (EDHREC 1293) - Equipped creature gets +1/+0 and has haste and ward {1}.
53. Mantle of the Ancients (EDHREC 1298) - Enchanted creature gets +1/+1 for each Aura and Equipment attached to it.
54. Embercleave (EDHREC 1313) - Equipped creature gets +1/+1 and has double strike and trample.
55. Caduceus, Staff of Hermes (EDHREC 1443) - As long as you have 30 or more life, equipped creature gets +5/+5 and has indestructible and "Prevent all damage that would be dealt to this creature."
56. Morophon, the Boundless (EDHREC 1470) - Other creatures you control of the chosen type get +1/+1.
57. Thran Power Suit (EDHREC 1481) - Equipped creature gets +1/+1 for each Aura and Equipment attached to it and has ward {2}.
58. End-Raze Forerunners (EDHREC 1485) - When this creature enters, other creatures you control get +2/+2 and gain vigilance and trample until end of turn.
59. Conqueror's Flail (EDHREC 1508) - Equipped creature gets +1/+1 for each color among permanents you control.
60. Sword of Vengeance (EDHREC 1513) - Equipped creature gets +2/+0 and has first strike, vigilance, trample, and haste.
61. Massacre Girl (EDHREC 1531) - When Massacre Girl enters, each other creature gets -1/-1 until end of turn.
62. Sting, the Glinting Dagger (EDHREC 1550) - Equipped creature gets +1/+1 and has haste.
63. Leyline Axe (EDHREC 1551) - Equipped creature gets +1/+1 and has double strike and trample.
64. Sheltered by Ghosts (EDHREC 1629) - Enchanted creature gets +1/+0 and has lifelink and ward {2}.
65. Eldrazi Conscription (EDHREC 1636) - Enchanted creature gets +10/+10 and has trample and annihilator 2.
66. Death Baron (EDHREC 1641) - Skeletons you control and other Zombies you control get +1/+1 and have deathtouch.
67. Kaldra Compleat (EDHREC 1643) - Equipped creature gets +5/+5 and has first strike, trample, indestructible, haste, and "Whenever this creature deals combat damage to a creature, exile that creature."
68. Bloodforged Battle-Axe (EDHREC 1654) - Equipped creature gets +2/+0.
69. Mirror Box (EDHREC 1671) - Each legendary creature you control gets +1/+1.
70. Overprotect (EDHREC 1680) - Target creature you control gets +3/+3 and gains trample, hexproof, and indestructible until end of turn.
71. Adaptive Automaton (EDHREC 1707) - Other creatures you control of the chosen type get +1/+1.
72. Overrun (EDHREC 1708) - Creatures you control get +3/+3 and gain trample until end of turn.
73. Allosaurus Shepherd (EDHREC 1717) - {4}{G}{G}: Until end of turn, each Elf creature you control has base power and toughness 5/5 and becomes a Dinosaur in addition to its other creature types.
74. Shore Up (EDHREC 1727) - Target creature you control gets +1/+1 and gains hexproof until end of turn.
75. Multani, Yavimaya's Avatar (EDHREC 1783) - Multani gets +1/+1 for each land you control and each land card in your graveyard.
76. Doomwake Giant (EDHREC 1788) - Constellation — Whenever this creature or another enchantment you control enters, creatures your opponents control get -1/-1 until end of turn.
77. Dragon's Rage Channeler (EDHREC 1800) - Delirium — As long as there are four or more card types among cards in your graveyard, this creature gets +2/+2, has flying, and attacks each combat if able.
78. Sword of Forge and Frontier (EDHREC 1809) - Equipped creature gets +2/+2 and has protection from red and from green.
79. Spirit Mantle (EDHREC 1812) - Enchanted creature gets +1/+1 and has protection from creatures.
80. Lord of the Accursed (EDHREC 1876) - Other Zombies you control get +1/+1.
81. Crippling Fear (EDHREC 1878) - Creatures that aren't of the chosen type get -3/-3 until end of turn.
82. Witness Protection (EDHREC 1919) - Enchanted creature loses all abilities and is a green and white Citizen creature with base power and toughness 1/1 named Legitimate Businessperson.
83. Hero's Blade (EDHREC 1941) - Equipped creature gets +3/+2.
84. Thunderfoot Baloth (EDHREC 1949) - Lieutenant — As long as you control your commander, this creature gets +2/+2 and other creatures you control get +2/+2 and have trample.
85. Renewed Solidarity (EDHREC 1955) - Creatures you control of the chosen type get +1/+0.
86. Weaver of Harmony (EDHREC 1969) - Other enchantment creatures you control get +1/+1.
87. Drown in Ichor (EDHREC 1974) - Target creature gets -4/-4 until end of turn.
88. Stridehangar Automaton (EDHREC 1977) - Thopters you control get +1/+1.
89. Sudden Spoiling (EDHREC 1994) - Until end of turn, creatures target player controls lose all abilities and have base power and toughness 0/2.
90. Rhonas's Monument (EDHREC 2057) - Whenever you cast a creature spell, target creature you control gets +2/+2 and gains trample until end of turn.
91. Jetmir, Nexus of Revels (EDHREC 2071) - Creatures you control get +1/+0 and have vigilance as long as you control three or more creatures.
92. Master of Etherium (EDHREC 2092) - Other artifact creatures you control get +1/+1.
93. Ancestral Mask (EDHREC 2095) - Enchanted creature gets +2/+2 for each other enchantment on the battlefield.
94. Balmor, Battlemage Captain (EDHREC 2117) - Whenever you cast an instant or sorcery spell, creatures you control get +1/+0 and gain trample until end of turn.
95. Ruby, Daring Tracker (EDHREC 2153) - Whenever Ruby attacks while you control a creature with power 4 or greater, Ruby gets +2/+2 until end of turn.
96. Lignify (EDHREC 2179) - Enchanted creature is a Treefolk with base power and toughness 0/4 and loses all abilities.
97. Icon of Ancestry (EDHREC 2192) - Creatures you control of the chosen type get +1/+1.
98. It That Heralds the End (EDHREC 2194) - Other colorless creatures you control get +1/+1.
99. Mutilate (EDHREC 2206) - All creatures get -1/-1 until end of turn for each Swamp you control.
100. Bloodthirsty Blade (EDHREC 2247) - Equipped creature gets +2/+0 and is goaded.
101. Blacksmith's Skill (EDHREC 2254) - If it's an artifact creature, it gets +2/+2 until end of turn.
102. Cranial Plating (EDHREC 2259) - Equipped creature gets +1/+0 for each artifact you control.
103. Tainted Strike (EDHREC 2292) - Target creature gets +1/+0 and gains infect until end of turn.
104. Umbral Mantle (EDHREC 2381) - Equipped creature has "{3}, {Q}: This creature gets +2/+2 until end of turn." ({Q} is the untap symbol.)
105. Gauntlet of Power (EDHREC 2425) - Creatures of the chosen color get +1/+1.
106. Ezuri, Renegade Leader (EDHREC 2436) - {2}{G}{G}{G}: Elf creatures you control get +3/+3 and gain trample until end of turn.
107. The Immortal Sun (EDHREC 2446) - Creatures you control get +1/+1.
108. Murkfiend Liege (EDHREC 2455) - Other green creatures you control get +1/+1.
109. Captivating Vampire (EDHREC 2458) - Other Vampire creatures you control get +1/+1.
110. Overkill (EDHREC 2499) - Target creature gets -0/-9999 until end of turn.
111. Hyena Umbra (EDHREC 2507) - Enchanted creature gets +1/+1 and has first strike.
112. Dragonfire Blade (EDHREC 2518) - Equipped creature gets +2/+2 and has hexproof from monocolored.
113. Bruenor Battlehammer (EDHREC 2538) - Each creature you control gets +2/+0 for each Equipment attached to it.
114. Assault Formation (EDHREC 2547) - {2}{G}: Creatures you control get +0/+1 until end of turn.
115. Inspiring Leader (EDHREC 2553) - Commander creatures you own have "Creature tokens you control get +2/+2."
116. Heroes' Podium (EDHREC 2581) - Each legendary creature you control gets +1/+1 for each other legendary creature you control.
117. Domri, Anarch of Bolas (EDHREC 2585) - Creatures you control get +1/+0.
118. Basilisk Gate (EDHREC 2588) - {2}, {T}: Target creature gets +X/+X until end of turn, where X is the number of Gates you control.
119. Adaptive Omnitool (EDHREC 2645) - Equipped creature gets +1/+1 for each artifact you control.
120. Simic Charm (EDHREC 2647) - • Target creature gets +3/+3 until end of turn.
121. Silver-Fur Master (EDHREC 2672) - Other Ninja and Rogue creatures you control get +1/+1.
122. Vorpal Sword (EDHREC 2674) - Equipped creature gets +2/+0 and has deathtouch.
123. Olivia's Wrath (EDHREC 2679) - Each non-Vampire creature gets -X/-X until end of turn, where X is the number of Vampires you control.
124. Goblin Chieftain (EDHREC 2691) - Other Goblin creatures you control get +1/+1 and have haste.
125. Sylvan Anthem (EDHREC 2716) - Green creatures you control get +1/+1.
126. Pemmin's Aura (EDHREC 2717) - {1}: Enchanted creature gets +1/-1 or -1/+1 until end of turn.
127. Blossoming Defense (EDHREC 2721) - Target creature you control gets +2/+2 and gains hexproof until end of turn.
128. Undead Warchief (EDHREC 2729) - Zombie creatures you control get +2/+1.
129. Nirkana Revenant (EDHREC 2771) - {B}: This creature gets +1/+1 until end of turn.
130. Jodah, the Unifier (EDHREC 2783) - Legendary creatures you control get +X/+X, where X is the number of legendary creatures you control.
131. Angelic Destiny (EDHREC 2791) - Enchanted creature gets +4/+4, has flying and first strike, and is an Angel in addition to its other types.
132. Chief of the Foundry (EDHREC 2842) - Other artifact creatures you control get +1/+1.
133. Fecund Greenshell (EDHREC 2859) - As long as you control ten or more lands, creatures you control get +2/+2.
134. Flayer of Loyalties (EDHREC 2871) - Until end of turn, it has base power and toughness 10/10 and gains trample, annihilator 2, and haste.
135. Legion Lieutenant (EDHREC 2888) - Other Vampires you control get +1/+1.
136. Heartless Summoning (EDHREC 2903) - Creatures you control get -1/-1.
137. Weathered Sentinels (EDHREC 2917) - Whenever this creature attacks, it gets +3/+3 and gains indestructible until end of turn.
138. Stromkirk Captain (EDHREC 2924) - Other Vampire creatures you control get +1/+1 and have first strike.
139. Robe of Stars (EDHREC 2925) - Equipped creature gets +0/+3.
140. Tower Defense (EDHREC 2945) - Creatures you control get +0/+5 and gain reach until end of turn.
141. Bria, Riptide Rogue (EDHREC 2960) - Prowess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.)
142. Mishra's Factory (EDHREC 2964) - {T}: Target Assembly-Worker creature gets +1/+1 until end of turn.
143. Blinkmoth Nexus (EDHREC 2974) - {1}, {T}: Target Blinkmoth creature gets +1/+1 until end of turn.
144. Blossoming Tortoise (EDHREC 2975) - Land creatures you control get +1/+1.
145. Empyrean Eagle (EDHREC 2984) - Other creatures you control with flying get +1/+1.
146. Skyhunter Strike Force (EDHREC 3011) - Melee (Whenever this creature attacks, it gets +1/+1 until end of turn for each opponent you attacked this combat.)
147. Ghoulish Impetus (EDHREC 3014) - Enchanted creature gets +1/+1, has deathtouch, and is goaded.
148. Strong Back (EDHREC 3023) - Enchanted creature gets +2/+2 for each Aura and Equipment attached to it.
149. Elvish Champion (EDHREC 3032) - Other Elf creatures get +1/+1 and have forestwalk.
150. Canopy Tactician (EDHREC 3055) - Other Elves you control get +1/+1.
151. Guardian Augmenter (EDHREC 3065) - Commander creatures you control get +2/+2.
152. Favorable Winds (EDHREC 3073) - Creatures you control with flying get +1/+1.
153. Skarrg, the Rage Pits (EDHREC 3089) - {R}{G}, {T}: Target creature gets +1/+1 and gains trample until end of turn.
154. Blanchwood Armor (EDHREC 3104) - Enchanted creature gets +1/+1 for each Forest you control.
155. Nylea, God of the Hunt (EDHREC 3112) - {3}{G}: Target creature gets +2/+2 until end of turn.
156. Ogre Battledriver (EDHREC 3195) - Whenever another creature you control enters, that creature gets +2/+0 and gains haste until end of turn.
157. Make a Stand (EDHREC 3209) - Creatures you control get +1/+0 and gain indestructible until end of turn.
158. Skittering Cicada (EDHREC 3213) - Whenever you cast a colorless spell, until end of turn, this creature gains trample and gets +X/+X, where X is that spell's mana value.
159. Komainu Battle Armor (EDHREC 3225) - Equipped creature gets +2/+2 and has menace.
160. Nowhere to Run (EDHREC 3237) - When this enchantment enters, target creature an opponent controls gets -3/-3 until end of turn.
161. Lion Umbra (EDHREC 3273) - Enchanted creature gets +3/+3 and has vigilance and reach.
162. Idolized (EDHREC 3293) - Enchanted creature has "Whenever this creature attacks alone, it gets +X/+X until end of turn, where X is the number of nonland permanents you control."
163. Gogo, Mysterious Mime (EDHREC 3294) - If you do, Gogo and that creature each get +2/+0 and gain haste until end of turn and attack this turn if able.
164. Scion of Oona (EDHREC 3308) - Other Faerie creatures you control get +1/+1.
165. Knight Exemplar (EDHREC 3320) - Other Knight creatures you control get +1/+1 and have indestructible.
166. Goblin King (EDHREC 3340) - Other Goblins get +1/+1 and have mountainwalk.
167. And They Shall Know No Fear (EDHREC 3364) - Creatures you control of the chosen type get +1/+0 and gain indestructible until end of turn.
168. Tempered Steel (EDHREC 3373) - Artifact creatures you control get +2/+2.
169. Tyvar, the Pummeler (EDHREC 3408) - {3}{G}{G}: Creatures you control get +X/+X until end of turn, where X is the greatest power among creatures you control.
170. Markov Baron (EDHREC 3424) - Other Vampires you control get +1/+1.
171. Eaten by Piranhas (EDHREC 3427) - Enchanted creature loses all abilities and is a black Skeleton creature with base power and toughness 1/1.
172. Jazal Goldmane (EDHREC 3435) - {3}{W}{W}: Attacking creatures you control get +X/+X until end of turn, where X is the number of attacking creatures.
173. Pathbreaker Ibex (EDHREC 3453) - Whenever this creature attacks, creatures you control gain trample and get +X/+X until end of turn, where X is the greatest power among creatures you control.
174. Preposterous Proportions (EDHREC 3477) - Creatures you control get +10/+10 and gain vigilance until end of turn.
175. Master of the Pearl Trident (EDHREC 3481) - Other Merfolk creatures you control get +1/+1 and have islandwalk.
176. Bladewing the Risen (EDHREC 3496) - {B}{R}: Dragon creatures get +1/+1 until end of turn.
177. Omnath, Locus of Mana (EDHREC 3499) - Omnath gets +1/+1 for each unspent green mana you have.
178. Crucible of Fire (EDHREC 3518) - Dragon creatures you control get +3/+3.
179. Phyresis Outbreak (EDHREC 3525) - Then each creature your opponents control gets -1/-1 until end of turn for each poison counter its controller has.
180. Whisper of the Dross (EDHREC 3563) - Target creature gets -1/-1 until end of turn.
181. Eidolon of Countless Battles (EDHREC 3576) - This creature and enchanted creature each get +1/+1 for each creature you control and +1/+1 for each Aura you control.
182. The Irencrag (EDHREC 3602) - If you do, it gains equip {3} and "Equipped creature gets +3/+3" and loses all other abilities.
183. Celestial Armor (EDHREC 3629) - Equipped creature gets +2/+0 and has flying.
184. Heirloom Blade (EDHREC 3650) - Equipped creature gets +3/+1.
185. Goldnight Commander (EDHREC 3659) - Whenever another creature you control enters, creatures you control get +1/+1 until end of turn.
186. Wrecking Ball Arm (EDHREC 3678) - Equipped creature has base power and toughness 7/7 and can't be blocked by creatures with power 2 or less.
187. Stoneskin (EDHREC 3703) - Enchanted creature gets +0/+10.
188. Obelisk of Urd (EDHREC 3707) - Creatures you control of the chosen type get +2/+2.
189. Giant Growth (EDHREC 3717) - Target creature gets +3/+3 until end of turn.
190. Aettir and Priwen (EDHREC 3722) - Equipped creature has base power and toughness X/X, where X is your life total.
191. Rampaging Brontodon (EDHREC 3730) - Whenever this creature attacks, it gets +1/+1 until end of turn for each land you control.
192. Jumbo Cactuar (EDHREC 3734) - 10,000 Needles — Whenever this creature attacks, it gets +9999/+0 until end of turn.
193. Behemoth Sledge (EDHREC 3755) - Equipped creature gets +2/+2 and has trample and lifelink.
194. Firebending Student (EDHREC 3801) - Prowess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.)
195. Colossification (EDHREC 3802) - Enchanted creature gets +20/+20.
196. Barbarian Class (EDHREC 3812) - Whenever you roll one or more dice, target creature you control gets +2/+0 and gains menace until end of turn.
197. Maul of the Skyclaves (EDHREC 3813) - Equipped creature gets +2/+2 and has flying and first strike.(It deals combat damage before creatures without first strike.)
198. Mask of Avacyn (EDHREC 3821) - Equipped creature gets +1/+2 and has hexproof.
199. Coppercoat Vanguard (EDHREC 3824) - Each other Human you control gets +1/+0 and has ward {1}.
200. Magic Damper (EDHREC 3890) - Target creature you control gets +1/+1 and gains hexproof until end of turn.

### 12. Keyword Grants And Losses

Source: corpus-mined follow-on seam
Available after current queue exclusion: 2236

1. Swiftfoot Boots (EDHREC 12) - Equipped creature has hexproof and haste.
2. Lightning Greaves (EDHREC 13) - Equipped creature has haste and shroud.
3. Heroic Intervention (EDHREC 32) - Permanents you control gain hexproof and indestructible until end of turn.
4. Flawless Maneuver (EDHREC 181) - Creatures you control gain indestructible until end of turn.
5. Akroma's Will (EDHREC 203) - • Creatures you control gain flying, vigilance, and double strike until end of turn.
6. Mithril Coat (EDHREC 241) - Equipped creature has indestructible.
7. Shadowspear (EDHREC 331) - Equipped creature gets +1/+1 and has trample and lifelink.
8. Craterhoof Behemoth (EDHREC 337) - When this creature enters, creatures you control gain trample and get +X/+X until end of turn, where X is the number of creatures you control.
9. Kessig Wolf Run (EDHREC 376) - {X}{R}{G}, {T}: Target creature gets +X/+0 and gains trample until end of turn.
10. Arena of Glory (EDHREC 406) - If that mana is spent on a creature spell, it gains haste until end of turn.
11. Cursed Mirror (EDHREC 447) - As this artifact enters, you may have it become a copy of any creature on the battlefield until end of turn, except it has haste.
12. Vault of the Archangel (EDHREC 453) - {2}{W}{B}, {T}: Creatures you control gain deathtouch and lifelink until end of turn.
13. Vito, Thorn of the Dusk Rose (EDHREC 494) - {3}{B}{B}: Creatures you control gain lifelink until end of turn.
14. Plaza of Heroes (EDHREC 529) - {3}, {T}, Exile this land: Target legendary creature gains hexproof and indestructible until end of turn.
15. Overwhelming Stampede (EDHREC 548) - Until end of turn, creatures you control gain trample and get +X/+X, where X is the greatest power among creatures you control.
16. Darksteel Mutation (EDHREC 577) - Enchanted creature is an Insect artifact creature with base power and toughness 0/1 and has indestructible, and it loses all other abilities, card types, and creature types.
17. Goreclaw, Terror of Qal Sisma (EDHREC 676) - Whenever Goreclaw attacks, each creature you control with power 4 or greater gets +1/+1 and gains trample until end of turn.
18. Rancor (EDHREC 752) - Enchanted creature gets +2/+0 and has trample.
19. Tyvar's Stand (EDHREC 794) - Target creature you control gets +X/+X and gains hexproof and indestructible until end of turn.
20. Hammer of Nazahn (EDHREC 798) - Equipped creature gets +2/+0 and has indestructible.
21. Champion's Helm (EDHREC 810) - As long as equipped creature is legendary, it has hexproof.
22. Mockingbird (EDHREC 814) - You may have this creature enter as a copy of any creature on the battlefield with mana value less than or equal to the amount of mana spent to cast this creature, except it's a Bird in addition to its other types and it has flying.
23. Colossus Hammer (EDHREC 910) - Equipped creature gets +10/+10 and loses flying.
24. Loxodon Warhammer (EDHREC 917) - Equipped creature gets +3/+0 and has trample and lifelink.
25. Excalibur, Sword of Eden (EDHREC 962) - Equipped creature gets +10/+0 and has vigilance.
26. Crashing Drawbridge (EDHREC 975) - {T}: Creatures you control gain haste until end of turn.
27. Darksteel Plate (EDHREC 987) - Equipped creature has indestructible.
28. Karlach, Fury of Avernus (EDHREC 1012) - They gain first strike until end of turn.
29. Fireshrieker (EDHREC 1047) - Equipped creature has double strike.
30. Ethereal Armor (EDHREC 1062) - Enchanted creature gets +1/+1 for each enchantment you control and has first strike.
31. Witch's Clinic (EDHREC 1095) - {2}, {T}: Target commander gains lifelink until end of turn.
32. Bloodghast (EDHREC 1126) - This creature has haste as long as an opponent has 10 or less life.
33. Arcane Lighthouse (EDHREC 1143) - {1}, {T}: Until end of turn, creatures your opponents control lose hexproof and shroud and can't have hexproof or shroud.
34. Xenagos, God of Revels (EDHREC 1180) - At the beginning of combat on your turn, another target creature you control gains haste and gets +X/+X until end of turn, where X is that creature's power.
35. Enduring Courage (EDHREC 1211) - Whenever another creature you control enters, it gets +2/+0 and gains haste until end of turn.
36. Slayers' Stronghold (EDHREC 1217) - {R}{W}, {T}: Target creature gets +2/+0 and gains vigilance and haste until end of turn.
37. Amphibian Downpour (EDHREC 1244) - Enchanted creature loses all abilities and is a blue Frog creature with base power and toughness 1/1.
38. The Wind Crystal (EDHREC 1251) - {4}{W}{W}, {T}: Creatures you control gain flying and lifelink until end of turn.
39. Atarka, World Render (EDHREC 1276) - Whenever a Dragon you control attacks, it gains double strike until end of turn.
40. Moonshaker Cavalry (EDHREC 1286) - When this creature enters, creatures you control gain flying and get +X/+X until end of turn, where X is the number of creatures you control.
41. Lavaspur Boots (EDHREC 1293) - Equipped creature gets +1/+0 and has haste and ward {1}.
42. Lizard Blades (EDHREC 1299) - Equipped creature has double strike.
43. Embercleave (EDHREC 1313) - Equipped creature gets +1/+1 and has double strike and trample.
44. Duelist's Heritage (EDHREC 1325) - Whenever one or more creatures attack, you may have target attacking creature gain double strike until end of turn.
45. Temur Battle Rage (EDHREC 1383) - Target creature gains double strike until end of turn.
46. Odric, Lunarch Marshal (EDHREC 1441) - At the beginning of each combat, creatures you control gain first strike until end of turn if a creature you control has first strike.
47. Caduceus, Staff of Hermes (EDHREC 1443) - Equipped creature has lifelink.
48. End-Raze Forerunners (EDHREC 1485) - When this creature enters, other creatures you control get +2/+2 and gain vigilance and trample until end of turn.
49. Smuggler's Surprise (EDHREC 1501) - + {1} — Creatures you control with power 4 or greater gain hexproof and indestructible until end of turn.
50. Sword of Vengeance (EDHREC 1513) - Equipped creature gets +2/+0 and has first strike, vigilance, trample, and haste.
51. Genji Glove (EDHREC 1523) - Equipped creature has double strike.
52. Sting, the Glinting Dagger (EDHREC 1550) - Equipped creature gets +1/+1 and has haste.
53. Leyline Axe (EDHREC 1551) - Equipped creature gets +1/+1 and has double strike and trample.
54. Timely Ward (EDHREC 1584) - Enchanted creature has indestructible.
55. Sheltered by Ghosts (EDHREC 1629) - Enchanted creature gets +1/+0 and has lifelink and ward {2}.
56. Eldrazi Conscription (EDHREC 1636) - Enchanted creature gets +10/+10 and has trample and annihilator 2.
57. Kaldra Compleat (EDHREC 1643) - Equipped creature gets +5/+5 and has first strike, trample, indestructible, haste, and "Whenever this creature deals combat damage to a creature, exile that creature."
58. Temur Sabertooth (EDHREC 1669) - If you do, this creature gains indestructible until end of turn.
59. Overprotect (EDHREC 1680) - Target creature you control gets +3/+3 and gains trample, hexproof, and indestructible until end of turn.
60. Overrun (EDHREC 1708) - Creatures you control get +3/+3 and gain trample until end of turn.
61. Sunhome, Fortress of the Legion (EDHREC 1716) - {2}{R}{W}, {T}: Target creature gains double strike until end of turn.
62. Shore Up (EDHREC 1727) - Target creature you control gets +1/+1 and gains hexproof until end of turn.
63. Winged Boots (EDHREC 1754) - Equipped creature has flying and ward {4}.
64. Archetype of Imagination (EDHREC 1793) - Creatures your opponents control lose flying and can't have or gain flying.
65. Dragon's Rage Channeler (EDHREC 1800) - Delirium — As long as there are four or more card types among cards in your graveyard, this creature gets +2/+2, has flying, and attacks each combat if able.
66. Loran's Escape (EDHREC 1864) - Target artifact or creature gains hexproof and indestructible until end of turn.
67. Lord of the Accursed (EDHREC 1876) - {1}{B}, {T}: All Zombies gain menace until end of turn.
68. Delay (EDHREC 1912) - If it's a creature, it has haste.)
69. Witness Protection (EDHREC 1919) - Enchanted creature loses all abilities and is a green and white Citizen creature with base power and toughness 1/1 named Legitimate Businessperson.
70. Hellkite Courser (EDHREC 1934) - It gains haste.
71. Mina and Denn, Wildborn (EDHREC 1936) - {R}{G}, Return a land you control to its owner's hand: Target creature gains trample until end of turn.
72. Mutational Advantage (EDHREC 1947) - Permanents you control with counters on them gain hexproof and indestructible until end of turn.
73. Paradise Druid (EDHREC 1987) - This creature has hexproof as long as it's untapped.
74. Sudden Spoiling (EDHREC 1994) - Until end of turn, creatures target player controls lose all abilities and have base power and toughness 0/2.
75. Poison Dart Frog (EDHREC 2006) - {2}: This creature gains deathtouch until end of turn.
76. Everybody Lives! (EDHREC 2012) - All creatures gain hexproof and indestructible until end of turn.
77. Insurrection (EDHREC 2033) - They gain haste until end of turn.
78. Final Showdown (EDHREC 2043) - + {1} — All creatures lose all abilities until end of turn.
79. Wake the Past (EDHREC 2046) - They gain haste until end of turn.
80. Rhonas's Monument (EDHREC 2057) - Whenever you cast a creature spell, target creature you control gets +2/+2 and gains trample until end of turn.
81. Haunted Cloak (EDHREC 2081) - Equipped creature has vigilance, trample, and haste.
82. Carnelian Orb of Dragonkind (EDHREC 2097) - If that mana is spent on a Dragon creature spell, it gains haste until end of turn.
83. Shinka, the Bloodsoaked Keep (EDHREC 2104) - {R}, {T}: Target legendary creature gains first strike until end of turn.
84. Balmor, Battlemage Captain (EDHREC 2117) - Whenever you cast an instant or sorcery spell, creatures you control get +1/+0 and gain trample until end of turn.
85. Mimic Vat (EDHREC 2146) - It gains haste.
86. Lignify (EDHREC 2179) - Enchanted creature is a Treefolk with base power and toughness 0/4 and loses all abilities.
87. Zealous Conscripts (EDHREC 2237) - It gains haste until end of turn.
88. Blacksmith's Skill (EDHREC 2254) - Target permanent gains hexproof and indestructible until end of turn.
89. Ezuri, Renegade Leader (EDHREC 2436) - {2}{G}{G}{G}: Elf creatures you control get +3/+3 and gain trample until end of turn.
90. Hyena Umbra (EDHREC 2507) - Enchanted creature gets +1/+1 and has first strike.
91. Dragonfire Blade (EDHREC 2518) - Equipped creature gets +2/+2 and has hexproof from monocolored.
92. Twinferno (EDHREC 2520) - • Target creature you control gains double strike until end of turn.
93. Tishana's Tidebinder (EDHREC 2572) - If an ability of an artifact, creature, or planeswalker is countered this way, that permanent loses all abilities for as long as this creature remains on the battlefield.
94. Quietus Spike (EDHREC 2592) - Equipped creature has deathtouch.
95. Skithiryx, the Blight Dragon (EDHREC 2639) - {B}: Skithiryx gains haste until end of turn.
96. Simic Charm (EDHREC 2647) - • Permanents you control gain hexproof until end of turn.
97. Vorpal Sword (EDHREC 2674) - Equipped creature gets +2/+0 and has deathtouch.
98. Amonkhet Raceway (EDHREC 2685) - Max speed — {T}: Target creature gains haste until end of turn.
99. Pemmin's Aura (EDHREC 2717) - {U}: Enchanted creature gains flying until end of turn.
100. Blossoming Defense (EDHREC 2721) - Target creature you control gets +2/+2 and gains hexproof until end of turn.
101. Surge of Salvation (EDHREC 2722) - You and permanents you control gain hexproof until end of turn.
102. Angelic Destiny (EDHREC 2791) - Enchanted creature gets +4/+4, has flying and first strike, and is an Angel in addition to its other types.
103. Witch-king of Angmar (EDHREC 2802) - Discard a card: Witch-king of Angmar gains indestructible until end of turn.
104. Archetype of Endurance (EDHREC 2841) - Creatures your opponents control lose hexproof and can't have or gain hexproof.
105. Archetype of Aggression (EDHREC 2848) - Creatures your opponents control lose trample and can't have or gain trample.
106. Reyav, Master Smith (EDHREC 2864) - Whenever a creature you control that's enchanted or equipped attacks, that creature gains double strike until end of turn.
107. Flayer of Loyalties (EDHREC 2871) - Until end of turn, it has base power and toughness 10/10 and gains trample, annihilator 2, and haste.
108. Weathered Sentinels (EDHREC 2917) - Whenever this creature attacks, it gets +3/+3 and gains indestructible until end of turn.
109. Hall of the Bandit Lord (EDHREC 2919) - If that mana is spent on a creature spell, it gains haste.
110. Tower Defense (EDHREC 2945) - Creatures you control get +0/+5 and gain reach until end of turn.
111. Otepec Huntmaster (EDHREC 2953) - {T}: Target Dinosaur gains haste until end of turn.
112. Alpha Authority (EDHREC 2980) - Enchanted creature has hexproof and can't be blocked by more than one creature.
113. Ghoulish Impetus (EDHREC 3014) - Enchanted creature gets +1/+1, has deathtouch, and is goaded.
114. Frontier Warmonger (EDHREC 3030) - Whenever one or more creatures attack one of your opponents or a planeswalker they control, those creatures gain menace until end of turn.
115. Hanweir Battlements (EDHREC 3049) - {R}, {T}: Target creature gains haste until end of turn.
116. Savage Beating (EDHREC 3059) - • Creatures you control gain double strike until end of turn.
117. Skarrg, the Rage Pits (EDHREC 3089) - {R}{G}, {T}: Target creature gets +1/+1 and gains trample until end of turn.
118. Soul of New Phyrexia (EDHREC 3179) - {5}: Permanents you control gain indestructible until end of turn.
119. Captivating Crew (EDHREC 3190) - It gains haste until end of turn.
120. Ogre Battledriver (EDHREC 3195) - Whenever another creature you control enters, that creature gets +2/+0 and gains haste until end of turn.
121. Make a Stand (EDHREC 3209) - Creatures you control get +1/+0 and gain indestructible until end of turn.
122. Skittering Cicada (EDHREC 3213) - Whenever you cast a colorless spell, until end of turn, this creature gains trample and gets +X/+X, where X is that spell's mana value.
123. Komainu Battle Armor (EDHREC 3225) - Equipped creature gets +2/+2 and has menace.
124. Agent Frank Horrigan (EDHREC 3238) - Agent Frank Horrigan has indestructible as long as it attacked this turn.
125. Mob Rule (EDHREC 3249) - They gain haste until end of turn.
126. Lion Umbra (EDHREC 3273) - Enchanted creature gets +3/+3 and has vigilance and reach.
127. Gogo, Mysterious Mime (EDHREC 3294) - If you do, Gogo and that creature each get +2/+0 and gain haste until end of turn and attack this turn if able.
128. Ultimate Magic: Holy (EDHREC 3307) - Permanents you control gain indestructible until end of turn.
129. Coercive Recruiter (EDHREC 3318) - Until end of turn, it gains haste and becomes a Pirate in addition to its other types.
130. And They Shall Know No Fear (EDHREC 3364) - Creatures you control of the chosen type get +1/+0 and gain indestructible until end of turn.
131. Tyvar, the Pummeler (EDHREC 3408) - Tap another untapped creature you control: Tyvar gains indestructible until end of turn.
132. Eaten by Piranhas (EDHREC 3427) - Enchanted creature loses all abilities and is a black Skeleton creature with base power and toughness 1/1.
133. Pathbreaker Ibex (EDHREC 3453) - Whenever this creature attacks, creatures you control gain trample and get +X/+X until end of turn, where X is the greatest power among creatures you control.
134. Preposterous Proportions (EDHREC 3477) - Creatures you control get +10/+10 and gain vigilance until end of turn.
135. Hideous Taskmaster (EDHREC 3483) - They gain trample, haste, and annihilator 1 until end of turn.
136. Vivien, Champion of the Wilds (EDHREC 3557) - +1: Until your next turn, up to one target creature gains vigilance and reach.
137. Celestial Armor (EDHREC 3629) - That creature gains hexproof and indestructible until end of turn.
138. Flamekin Village (EDHREC 3695) - {R}, {T}: Target creature gains haste until end of turn.
139. Shielded by Faith (EDHREC 3739) - Enchanted creature has indestructible.
140. Behemoth Sledge (EDHREC 3755) - Equipped creature gets +2/+2 and has trample and lifelink.
141. Scion of Draco (EDHREC 3759) - Each creature you control has vigilance if it's white, hexproof if it's blue, lifelink if it's black, first strike if it's red, and trample if it's green.
142. Reins of Power (EDHREC 3806) - Those creatures gain haste until end of turn.
143. Barbarian Class (EDHREC 3812) - Whenever you roll one or more dice, target creature you control gets +2/+0 and gains menace until end of turn.
144. Maul of the Skyclaves (EDHREC 3813) - Equipped creature gets +2/+2 and has flying and first strike.(It deals combat damage before creatures without first strike.)
145. Mask of Avacyn (EDHREC 3821) - Equipped creature gets +1/+2 and has hexproof.
146. Magic Damper (EDHREC 3890) - Target creature you control gets +1/+1 and gains hexproof until end of turn.
147. Berserk (EDHREC 3918) - Target creature gains trample and gets +X/+0 until end of turn, where X is its power.
148. Nazgûl Battle-Mace (EDHREC 3926) - Equipped creature has menace, deathtouch, annihilator 1, and "Whenever an opponent sacrifices a nontoken permanent, put that card onto the battlefield under your control unless that player pays 3 life." (Whenever a creature with annihilator 1 attacks, defending player sacrifices a permanent of their choice.)
149. Thundermane Dragon (EDHREC 3972) - If you cast a creature spell this way, it gains haste until end of turn.
150. Azure Beastbinder (EDHREC 3976) - Whenever this creature attacks, up to one target artifact, creature, or planeswalker an opponent controls loses all abilities until your next turn.
151. Mothdust Changeling (EDHREC 4021) - Tap an untapped creature you control: This creature gains flying until end of turn.
152. Unable to Scream (EDHREC 4056) - Enchanted creature loses all abilities and is a Toy artifact creature with base power and toughness 0/2 in addition to its other types.
153. Assault Suit (EDHREC 4077) - Equipped creature gets +2/+2, has haste, can't attack you or planeswalkers you control, and can't be sacrificed.
154. Deceptive Frostkite (EDHREC 4139) - You may have this creature enter as a copy of a creature you control with power 4 or greater, except it's a Dragon in addition to its other types and it has flying.
155. Redemption Arc (EDHREC 4144) - Enchanted creature has indestructible and is goaded.
156. Vizkopa Guildmage (EDHREC 4150) - {1}{W}{B}: Target creature gains lifelink until end of turn.
157. Squall, SeeD Mercenary (EDHREC 4176) - Rough Divide — Whenever a creature you control attacks alone, it gains double strike until end of turn.
158. Malleable Impostor (EDHREC 4177) - You may have this creature enter as a copy of a creature an opponent controls, except it's a Faerie Shapeshifter in addition to its other types and it has flying.
159. Hero's Heirloom (EDHREC 4215) - As long as equipped creature is legendary, it has trample and haste.
160. The Masamune (EDHREC 4228) - As long as equipped creature is attacking, it has first strike and must be blocked if able.
161. Battle Mastery (EDHREC 4241) - Enchanted creature has double strike.
162. Lyse Hext (EDHREC 4269) - As long as you've cast two or more noncreature spells this turn, Lyse Hext has double strike.
163. Polymorphist's Jest (EDHREC 4272) - Until end of turn, each creature target player controls loses all abilities and becomes a blue Frog with base power and toughness 1/1.
164. Frogify (EDHREC 4284) - Enchanted creature loses all abilities and is a blue Frog creature with base power and toughness 1/1.
165. Shield of the Oversoul (EDHREC 4290) - As long as enchanted creature is green, it gets +1/+1 and has indestructible.
166. Daily Bugle Building (EDHREC 4297) - Smear Campaign — {1}, {T}: Target legendary creature gains menace until end of turn.
167. Paladin Class (EDHREC 4300) - Whenever you attack, until end of turn, target attacking creature gets +1/+1 for each other attacking creature and gains double strike.
168. Grim Reaper's Sprint (EDHREC 4344) - Enchanted creature gets +2/+2 and has haste.
169. Octopus Form (EDHREC 4349) - Target creature you control gets +1/+1 and gains hexproof until end of turn.
170. Doors of Durin (EDHREC 4350) - Until your next turn, it gains trample if you control a Dwarf and hexproof if you control an Elf.
171. Archetype of Courage (EDHREC 4394) - Creatures your opponents control lose first strike and can't have or gain first strike.
172. Théoden, King of Rohan (EDHREC 4395) - Whenever Théoden or another Human you control enters, target creature gains double strike until end of turn.
173. Plumecreed Escort (EDHREC 4437) - When this creature enters, target creature you control gains hexproof until end of turn.
174. Legion Loyalist (EDHREC 4490) - Battalion — Whenever this creature and at least two other creatures attack, creatures you control gain first strike and trample until end of turn and can't be blocked by creature tokens this turn.
175. Short Bow (EDHREC 4525) - Equipped creature gets +1/+1 and has vigilance and reach.
176. Walking Bulwark (EDHREC 4535) - {2}: Until end of turn, target creature with defender gains haste, can attack as though it didn't have defender, and assigns combat damage equal to its toughness rather than its power.
177. Ozai, the Phoenix King (EDHREC 4595) - Ozai has flying and indestructible as long as you have six or more unspent mana.
178. Act of Treason (EDHREC 4643) - It gains haste until end of turn.
179. Stonehoof Chieftain (EDHREC 4656) - Whenever another creature you control attacks, it gains trample and indestructible until end of turn.
180. God-Eternal Rhonas (EDHREC 4692) - Those creatures gain vigilance until end of turn.
181. Kamahl, Heart of Krosa (EDHREC 4694) - At the beginning of combat on your turn, creatures you control get +3/+3 and gain trample until end of turn.
182. Eye of Nidhogg (EDHREC 4713) - Enchanted creature is a black Dragon with base power and toughness 4/2, has flying and deathtouch, and is goaded.
183. Sokrates, Athenian Teacher (EDHREC 4728) - Sokrates has hexproof as long as it's untapped.
184. Tromokratis (EDHREC 4739) - Tromokratis has hexproof unless it's attacking or blocking.
185. Flaming Fist (EDHREC 4760) - Commander creatures you own have "Whenever this creature attacks, it gains double strike until end of turn."
186. Winota, Joiner of Forces (EDHREC 4796) - It gains indestructible until end of turn.
187. Haste Magic (EDHREC 4827) - Target creature gets +3/+1 and gains haste until end of turn.
188. Brass Knuckles (EDHREC 4829) - Equipped creature has double strike as long as two or more Equipment are attached to it.
189. Cloudsteel Kirin (EDHREC 4847) - Equipped creature has flying and "You can't lose the game and your opponents can't win the game."
190. Rabbit Battery (EDHREC 4884) - Equipped creature gets +1/+1 and has haste.
191. Agility Bobblehead (EDHREC 4913) - {3}, {T}: Up to X target creatures you control each gain haste until end of turn and can't be blocked this turn except by creatures with haste, where X is the number of Bobbleheads you control as you activate this ability.
192. Restless Spire (EDHREC 4947) - {U}{R}: Until end of turn, this land becomes a 2/1 blue and red Elemental creature with "During your turn, this creature has first strike." It's still a land.
193. Rhonas the Indomitable (EDHREC 4955) - {2}{G}: Another target creature gets +2/+0 and gains trample until end of turn.
194. Akroma, Vision of Ixidor (EDHREC 4968) - At the beginning of each combat, until end of turn, each other creature you control gets +1/+1 if it has flying, +1/+1 if it has first strike, and so on for double strike, deathtouch, haste, hexproof, indestructible, lifelink, menace, protection, reach, trample, vigilance, and partner.
195. Djeru and Hazoret (EDHREC 4977) - As long as you have one or fewer cards in hand, Djeru and Hazoret has vigilance and haste.
196. Nogi, Draco-Zealot (EDHREC 4984) - Whenever Nogi attacks, if you control three or more Dragons, until end of turn, Nogi becomes a Dragon with base power and toughness 5/5 and gains flying.
197. Deep-Sea Kraken (EDHREC 5012) - It has haste.)
198. Chocobo Knights (EDHREC 5032) - Whenever you attack, creatures you control with counters on them gain double strike until end of turn.
199. Offer Immortality (EDHREC 5033) - Target creature gains deathtouch and indestructible until end of turn.
200. Divine Resilience (EDHREC 5043) - Target creature you control gains indestructible until end of turn.

### 13. Combat Restrictions And Evasion Rules

Source: corpus-mined follow-on seam
Available after current queue exclusion: 1603

1. Rogue's Passage (EDHREC 19) - {4}, {T}: Target creature can't be blocked this turn.
2. Propaganda (EDHREC 120) - Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.
3. Ghostly Prison (EDHREC 168) - Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.
4. Whispersilk Cloak (EDHREC 316) - Equipped creature can't be blocked and has shroud.
5. Brotherhood Regalia (EDHREC 569) - Equipped creature has ward {2}, is an Assassin in addition to its other types, and can't be blocked.
6. Access Tunnel (EDHREC 579) - {3}, {T}: Target creature with power 3 or less can't be blocked this turn.
7. Shizo, Death's Storehouse (EDHREC 600) - (It can't be blocked except by artifact creatures and/or black creatures.)
8. Changeling Outcast (EDHREC 618) - This creature can't block and can't be blocked.
9. Sphere of Safety (EDHREC 678) - Creatures can't attack you or planeswalkers you control unless their controller pays {X} for each of those creatures, where X is the number of enchantments you control.
10. Sheoldred, Whispering One (EDHREC 679) - Swampwalk (This creature can't be blocked as long as defending player controls a Swamp.)
11. Trailblazer's Boots (EDHREC 681) - (It can't be blocked as long as defending player controls a nonbasic land.)
12. Aqueous Form (EDHREC 716) - Enchanted creature can't be blocked.
13. Delney, Streetwise Lookout (EDHREC 853) - Creatures you control with power 2 or less can't be blocked by creatures with power 3 or greater.
14. Wayward Swordtooth (EDHREC 912) - This creature can't attack or block unless you have the city's blessing.
15. Windborn Muse (EDHREC 997) - Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.
16. Manifold Key (EDHREC 1033) - {3}, {T}: Target creature can't be blocked this turn.
17. Promise of Loyalty (EDHREC 1061) - Each of those creatures can't attack you or planeswalkers you control for as long as it has a vow counter on it.
18. Skrelv, Defector Mite (EDHREC 1115) - Skrelv can't block.
19. Bloodghast (EDHREC 1126) - This creature can't block.
20. The Black Gate (EDHREC 1178) - Target creature can't be blocked by creatures that player controls this turn.
21. Cover of Darkness (EDHREC 1456) - (They can't be blocked except by artifact creatures and/or black creatures.)
22. Tetsuko Umezawa, Fugitive (EDHREC 1492) - Creatures you control with power or toughness 1 or less can't be blocked.
23. Void Winnower (EDHREC 1604) - Your opponents can't block with creatures with even mana values.
24. Slither Blade (EDHREC 1639) - This creature can't be blocked.
25. Sonic Screwdriver (EDHREC 1810) - {3}, {T}: Target creature can't be blocked this turn.
26. Silver Shroud Costume (EDHREC 1828) - Equipped creature can't be blocked.
27. Secret Tunnel (EDHREC 1850) - This land can't be blocked.
28. Thassa, God of the Sea (EDHREC 1875) - {1}{U}: Target creature you control can't be blocked this turn.
29. Port Razer (EDHREC 1882) - This creature can't attack a player it has already attacked this turn.
30. Norn's Annex (EDHREC 1920) - Creatures can't attack you or planeswalkers you control unless their controller pays {W/P} for each of those creatures.
31. Triton Shorestalker (EDHREC 1921) - This creature can't be blocked.
32. Sepulchral Primordial (EDHREC 2138) - Intimidate (This creature can't be blocked except by artifact creatures and/or creatures that share a color with it.)
33. Archangel of Tithes (EDHREC 2171) - As long as this creature is untapped, creatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures.
34. Orim's Chant (EDHREC 2181) - If this spell was kicked, creatures can't attack this turn.
35. Taunt from the Rampart (EDHREC 2226) - Until your next turn, those creatures can't block.
36. Crystal Barricade (EDHREC 2264) - Defender (This creature can't attack.)
37. Pathrazer of Ulamog (EDHREC 2296) - This creature can't be blocked except by three or more creatures.
38. The Mindskinner (EDHREC 2341) - The Mindskinner can't be blocked.
39. Bloodthirster (EDHREC 2496) - This creature can't attack a player it has already attacked this turn.
40. Forsaken Miner (EDHREC 2500) - This creature can't block.
41. Invisible Stalker (EDHREC 2534) - This creature can't be blocked.
42. Baird, Steward of Argive (EDHREC 2536) - Creatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures.
43. Mirri, Weatherlight Duelist (EDHREC 2633) - Whenever Mirri attacks, each opponent can't block with more than one creature this combat.
44. Fog Bank (EDHREC 2677) - Defender (This creature can't attack.)
45. Anzrag, the Quake-Mole (EDHREC 2689) - {3}{R}{R}{G}{G}: Anzrag must be blocked each combat this turn if able.
46. Stormtide Leviathan (EDHREC 2731) - Islandwalk (This creature can't be blocked as long as defending player controls an Island.)
47. Creeping Tar Pit (EDHREC 2756) - It can't be blocked this turn.
48. Mist-Cloaked Herald (EDHREC 2806) - This creature can't be blocked.
49. Blighted Agent (EDHREC 2951) - This creature can't be blocked.
50. Bria, Riptide Rogue (EDHREC 2960) - Whenever you cast a noncreature spell, target creature you control can't be blocked this turn.
51. Alpha Authority (EDHREC 2980) - Enchanted creature has hexproof and can't be blocked by more than one creature.
52. Bothersome Quasit (EDHREC 2983) - Goaded creatures your opponents control can't block.
53. Stonybrook Banneret (EDHREC 2995) - Islandwalk (This creature can't be blocked as long as defending player controls an Island.)
54. Elvish Champion (EDHREC 3032) - (They can't be blocked as long as defending player controls a Forest.)
55. Pippin, Guard of the Citadel (EDHREC 3033) - (It can't be blocked, targeted, dealt damage, enchanted, or equipped by anything of that type.)
56. Misleading Signpost (EDHREC 3052) - (It can't attack its controller or their permanents.)
57. Gríma, Saruman's Footman (EDHREC 3099) - Gríma can't be blocked.
58. Prowler's Helm (EDHREC 3227) - Equipped creature can't be blocked except by Walls.
59. K-9, Mark I (EDHREC 3247) - Affirmative — {1}{U}, {T}: Target legendary creature can't be blocked this turn.
60. Zirda, the Dawnwaker (EDHREC 3254) - {1}, {T}: Target creature can't block this turn.
61. Tormented Soul (EDHREC 3277) - This creature can't block and can't be blocked.
62. Gods Willing (EDHREC 3444) - (It can't be blocked, targeted, dealt damage, enchanted, or equipped by anything of that color.)
63. Master of the Pearl Trident (EDHREC 3481) - (They can't be blocked as long as defending player controls an Island.)
64. Chaos Dragon (EDHREC 3653) - If one or more opponents had the highest result, this creature can't attack those players or planeswalkers they control this combat.
65. Wrecking Ball Arm (EDHREC 3678) - Equipped creature has base power and toughness 7/7 and can't be blocked by creatures with power 2 or less.
66. Illusionist's Gambit (EDHREC 3753) - They can't attack you or planeswalkers you control that combat.
67. Aragorn, King of Gondor (EDHREC 3903) - Whenever Aragorn attacks, up to one target creature can't block this turn.
68. Killian, Ink Duelist (EDHREC 3923) - Menace (This creature can't be blocked except by two or more creatures.)
69. Azure Beastbinder (EDHREC 3976) - This creature can't be blocked by creatures with power 2 or greater.
70. Canopy Cover (EDHREC 4026) - Enchanted creature can't be blocked except by creatures with flying or reach.
71. Shifting Sliver (EDHREC 4070) - Slivers can't be blocked except by Slivers.
72. Assault Suit (EDHREC 4077) - Equipped creature gets +2/+2, has haste, can't attack you or planeswalkers you control, and can't be sacrificed.
73. Merfolk Sovereign (EDHREC 4087) - {T}: Target Merfolk creature can't be blocked this turn.
74. The Masamune (EDHREC 4228) - As long as equipped creature is attacking, it has first strike and must be blocked if able.
75. Bloodsoaked Champion (EDHREC 4230) - This creature can't block.
76. Aether Tunnel (EDHREC 4260) - Enchanted creature gets +1/+0 and can't be blocked.
77. Gossip's Talent (EDHREC 4378) - Whenever you attack, target attacking creature with power 3 or less can't be blocked this turn.
78. Serpent of Yawning Depths (EDHREC 4485) - Krakens, Leviathans, Octopuses, and Serpents you control can't be blocked except by Krakens, Leviathans, Octopuses, and Serpents.
79. Legion Loyalist (EDHREC 4490) - Battalion — Whenever this creature and at least two other creatures attack, creatures you control gain first strike and trample until end of turn and can't be blocked by creature tokens this turn.
80. Nullpriest of Oblivion (EDHREC 4566) - Menace (This creature can't be blocked except by two or more creatures.)
81. Herald of Hoofbeats (EDHREC 4648) - Horsemanship (This creature can't be blocked except by creatures with horsemanship.)
82. Filth (EDHREC 4667) - Swampwalk (This creature can't be blocked as long as defending player controls a Swamp.)
83. Rikku, Resourceful Guardian (EDHREC 4690) - Whenever you put one or more counters on a creature, until end of turn, that creature can't be blocked by creatures your opponents control.
84. Infesting Radroach (EDHREC 4695) - This creature can't block.
85. Tromokratis (EDHREC 4739) - Tromokratis can't be blocked unless all creatures defending player controls block it.
86. Reverse the Polarity (EDHREC 4772) - • Creatures can't be blocked this turn.
87. Goblin War Drums (EDHREC 4783) - (They can't be blocked except by two or more creatures.)
88. Suspicious Bookcase (EDHREC 4799) - {3}, {T}: Target creature can't be blocked this turn.
89. Inkwell Leviathan (EDHREC 4804) - Islandwalk (This creature can't be blocked as long as defending player controls an Island.)
90. Profane Command (EDHREC 4824) - (They can't be blocked except by artifact creatures and/or black creatures.)
91. Angelic Arbiter (EDHREC 4865) - Each opponent who cast a spell this turn can't attack with creatures.
92. Ensnaring Bridge (EDHREC 4883) - Creatures with power greater than the number of cards in your hand can't attack.
93. Relentless Dead (EDHREC 4893) - Menace (This creature can't be blocked except by two or more creatures.)
94. Agility Bobblehead (EDHREC 4913) - {3}, {T}: Up to X target creatures you control each gain haste until end of turn and can't be blocked this turn except by creatures with haste, where X is the number of Bobbleheads you control as you activate this ability.
95. Rhonas the Indomitable (EDHREC 4955) - Rhonas can't attack or block unless you control another creature with power 4 or greater.
96. Deep-Sea Kraken (EDHREC 5012) - This creature can't be blocked.
97. Wrexial, the Risen Deep (EDHREC 5067) - Islandwalk, swampwalk (This creature can't be blocked as long as defending player controls an Island or a Swamp.)
98. Behind the Scenes (EDHREC 5096) - (They can't be blocked by creatures with greater power.)
99. Combat Calligrapher (EDHREC 5149) - Inklings can't attack you or planeswalkers you control.
100. Champions of Minas Tirith (EDHREC 5247) - If they don't, they can't attack you this combat.
101. Sidar Kondo of Jamuraa (EDHREC 5253) - Creatures your opponents control without flying or reach can't block creatures with power 2 or less.
102. Lord of Atlantis (EDHREC 5256) - (They can't be blocked as long as defending player controls an Island.)
103. Pacifism (EDHREC 5315) - Enchanted creature can't attack or block.
104. Abomination of Llanowar (EDHREC 5374) - Vigilance; menace (This creature can't be blocked except by two or more creatures.)
105. Sword Coast Sailor (EDHREC 5519) - Commander creatures you own have "Whenever this creature attacks a player, if no opponent has more life than that player, this creature can't be blocked this turn."
106. Bellowing Tanglewurm (EDHREC 5588) - Intimidate (This creature can't be blocked except by artifact creatures and/or creatures that share a color with it.)
107. Vorrac Battlehorns (EDHREC 5622) - Equipped creature has trample and can't be blocked by more than one creature.
108. Wall of Junk (EDHREC 5836) - Defender (This creature can't attack.)
109. Varchild, Betrayer of Kjeldor (EDHREC 5887) - Survivors your opponents control can't block, and they can't attack you or planeswalkers you control.
110. Two-Headed Sliver (EDHREC 5908) - (They can't be blocked except by two or more creatures.)
111. Sunscape Familiar (EDHREC 5916) - Defender (This creature can't attack.)
112. Planar Disruption (EDHREC 5920) - Enchanted permanent can't attack or block, and its activated abilities can't be activated.
113. Sandstorm Verge (EDHREC 5949) - {3}, {T}: Target creature can't block this turn.
114. Vine Trellis (EDHREC 5975) - Defender (This creature can't attack.)
115. Venser, the Sojourner (EDHREC 6009) - −1: Creatures can't be blocked this turn.
116. Signal Pest (EDHREC 6118) - This creature can't be blocked except by creatures with flying or reach.
117. Long River Lurker (EDHREC 6147) - When this creature enters, target creature you control can't be blocked this turn.
118. Psychic Paper (EDHREC 6161) - Equipped creature has ward {1}, it can't be blocked, and its name and creature type are the last chosen name and creature type.
119. Kulrath Knight (EDHREC 6172) - Creatures your opponents control with counters on them can't attack or block.
120. Francisco, Fowl Marauder (EDHREC 6226) - Francisco can't block.
121. Wall of Blood (EDHREC 6273) - Defender (This creature can't attack.)
122. Gornog, the Red Reaper (EDHREC 6278) - Cowards can't block Warriors.
123. Achilles Davenport (EDHREC 6314) - Menace (This creature can't be blocked except by two or more creatures.)
124. Goblin Piledriver (EDHREC 6317) - Protection from blue (This creature can't be blocked, targeted, dealt damage, or enchanted by anything blue.)
125. Distortion Strike (EDHREC 6376) - Target creature gets +1/+0 until end of turn and can't be blocked this turn.
126. Cephalid Facetaker (EDHREC 6391) - This creature can't be blocked.
127. Dimir Keyrune (EDHREC 6415) - {U}{B}: This artifact becomes a 2/2 blue and black Horror artifact creature until end of turn and can't be blocked this turn.
128. Lydia Frye (EDHREC 6499) - Lydia Frye can't be blocked by creatures with power 3 or greater.
129. Collective Restraint (EDHREC 6590) - Domain — Creatures can't attack you unless their controller pays {X} for each creature they control that's attacking you, where X is the number of basic land types among lands you control.
130. Deluxe Dragster (EDHREC 6612) - This Vehicle can't be blocked except by Vehicles.
131. Aegis Angel (EDHREC 6640) - Flying (This creature can't be blocked except by creatures with flying or reach.)
132. Graaz, Unstoppable Juggernaut (EDHREC 6648) - Juggernauts you control can't be blocked by Walls.
133. Nightkin Ambusher (EDHREC 6663) - This creature can't be blocked as long as defending player has a rad counter.
134. Berserker's Frenzy (EDHREC 6696) - They block this turn if able.
135. Spectra Ward (EDHREC 6708) - (It can't be blocked, targeted, or dealt damage by anything that's white, blue, black, red, or green.)
136. Fumiko the Lowblood (EDHREC 6738) - Fumiko has bushido X, where X is the number of attacking creatures. (Whenever this creature blocks or becomes blocked, it gets +X/+X until end of turn.) Creatures your opponents control attack each combat if able.
137. Vronos, Masked Inquisitor (EDHREC 6739) - −7: Target artifact you control becomes a 9/9 Construct artifact creature and gains vigilance, indestructible, and "This creature can't be blocked."
138. Nuka-Nuke Launcher (EDHREC 6817) - (It can't be blocked except by artifact creatures and/or creatures that share a color with it.)
139. Temur Charm (EDHREC 6879) - • Creatures with power 3 or less can't block this turn.
140. Bedlam (EDHREC 6956) - Creatures can't block.
141. Blazing Archon (EDHREC 6990) - Creatures can't attack you.
142. Dog Umbra (EDHREC 7006) - As long as another player controls enchanted creature, it can't attack or block.
143. Onakke Oathkeeper (EDHREC 7027) - Creatures can't attack planeswalkers you control unless their controller pays {1} for each creature they control that's attacking a planeswalker you control.
144. Shadow Alley Denizen (EDHREC 7122) - (It can't be blocked except by artifact creatures and/or creatures that share a color with it.)
145. Vow of Duty (EDHREC 7128) - Enchanted creature gets +2/+2, has vigilance, and can't attack you or planeswalkers you control.
146. Wall of Runes (EDHREC 7201) - Defender (This creature can't attack.)
147. Medomai the Ageless (EDHREC 7249) - Medomai can't attack during extra turns.
148. Midnight Pathlighter (EDHREC 7307) - Creatures you control can't be blocked except by legendary creatures.
149. Magus of the Moat (EDHREC 7326) - Creatures without flying can't attack.
150. Vow of Lightning (EDHREC 7426) - Enchanted creature gets +2/+2, has first strike, and can't attack you or planeswalkers you control.
151. Nettling Nuisance (EDHREC 7438) - Whenever one or more Faeries you control deal combat damage to a player, that player creates a 4/2 red Pirate creature token with "This token can't block." The token is goaded for the rest of the game.
152. Archon of Absolution (EDHREC 7445) - Protection from white (This creature can't be blocked, targeted, dealt damage, enchanted, or equipped by anything white.)
153. Immortal Obligation (EDHREC 7448) - For as long as that creature has a duty counter on it, it is goaded, can't attack you or a permanent you control, and can't block creatures you control.
154. Coronation of Chaos (EDHREC 7696) - Up to three target creatures can't block this turn.
155. Geth, Lord of the Vault (EDHREC 7726) - Intimidate (This creature can't be blocked except by artifact creatures and/or creatures that share a color with it.)
156. Wall of Glare (EDHREC 7821) - Defender (This creature can't attack.)
157. Petrify (EDHREC 7838) - Enchanted permanent can't attack or block, and its activated abilities can't be activated.
158. You Come to a River (EDHREC 7855) - • Find a Crossing — Target creature gets +1/+0 until end of turn and can't be blocked this turn.
159. Immerwolf (EDHREC 7899) - Intimidate (This creature can't be blocked except by artifact creatures and/or creatures that share a color with it.)
160. Time Beetle (EDHREC 7901) - Skulk (This creature can't be blocked by creatures with greater power.)
161. How to Start a Riot (EDHREC 7933) - (It can't be blocked except by two or more creatures.)
162. Turtle Lair (EDHREC 7976) - {3}, {T}: Target Ninja or Turtle can't be blocked this turn.
163. Sun Quan, Lord of Wu (EDHREC 8102) - (They can't be blocked except by creatures with horsemanship.)
164. Dwarven Grunt (EDHREC 8107) - Mountainwalk (This creature can't be blocked as long as defending player controls a Mountain.)
165. Opportunistic Dragon (EDHREC 8110) - For as long as this creature remains on the battlefield, gain control of that permanent, it loses all abilities, and it can't attack or block.
166. Domineering Will (EDHREC 8143) - They block this turn if able.
167. Bower Passage (EDHREC 8161) - Creatures with flying can't block creatures you control.
168. Yuan-Ti Malison (EDHREC 8198) - This creature can't be blocked as long as it's attacking alone.
169. Headliner Scarlett (EDHREC 8281) - When Headliner Scarlett enters, creatures target player controls can't block this turn.
170. Relic Golem (EDHREC 8336) - This creature can't attack or block unless an opponent has eight or more cards in their graveyard.
171. Harald, King of Skemfar (EDHREC 8363) - Menace (This creature can't be blocked except by two or more creatures.)
172. Shifting Ceratops (EDHREC 8377) - Protection from blue (This creature can't be blocked, targeted, dealt damage, enchanted, or equipped by anything blue.)
173. Frodo Baggins (EDHREC 8414) - As long as Frodo Baggins is your Ring-bearer, it must be blocked if able.
174. Rancid Rats (EDHREC 8458) - Skulk (This creature can't be blocked by creatures with greater power.)
175. Angelic Wall (EDHREC 8488) - Defender (This creature can't attack.)
176. Tax Collector (EDHREC 8578) - (Until your next turn, that creature can't attack or block and its activated abilities can't be activated.)
177. Eladamri, Lord of Leaves (EDHREC 8667) - (They can't be blocked as long as defending player controls a Forest.)
178. Serra's Guardian (EDHREC 8701) - Flying (This creature can't be blocked except by creatures with flying or reach.)
179. Hraesvelgr of the First Brood (EDHREC 8769) - Shiva's Aid — When Hraesvelgr enters and whenever you cast a noncreature spell, target creature gets +1/+0 until end of turn and can't be blocked this turn.
180. Lupine Prototype (EDHREC 8772) - This creature can't attack or block unless a player has no cards in hand.
181. The Eleventh Doctor (EDHREC 8891) - {2}: Target creature with power 3 or less can't be blocked this turn.
182. Glissa's Retriever (EDHREC 8931) - This creature can't be blocked by creatures with power 2 or less.
183. Dauthi Horror (EDHREC 8936) - This creature can't be blocked by white creatures.
184. Silhana Ledgewalker (EDHREC 8959) - This creature can't be blocked except by creatures with flying.
185. Vow of Torment (EDHREC 9108) - Enchanted creature gets +2/+2, has menace, and can't attack you or planeswalkers you control.
186. Vow of Malice (EDHREC 9167) - Enchanted creature gets +2/+2, has intimidate, and can't attack you or planeswalkers you control.
187. Merfolk Cave-Diver (EDHREC 9313) - Whenever a creature you control explores, this creature gets +1/+0 until end of turn and can't be blocked this turn.
188. Ghost of Ramirez DePietro (EDHREC 9414) - Ghost of Ramirez DePietro can't be blocked by creatures with toughness 3 or greater.
189. Azure Fleet Admiral (EDHREC 9437) - This creature can't be blocked by creatures the monarch controls.
190. Tolsimir, Midnight's Light (EDHREC 9445) - Whenever a Wolf you control attacks, if Tolsimir attacked this combat, target creature an opponent controls blocks that Wolf this combat if able.
191. Phantom Blade (EDHREC 9480) - (It can't be blocked except by two or more creatures.)
192. Knight of Dusk's Shadow (EDHREC 9553) - Menace (This creature can't be blocked except by two or more creatures.)
193. The Foretold Soldier (EDHREC 9557) - This creature must be blocked if able.
194. Cavern Whisperer (EDHREC 9563) - Menace (This creature can't be blocked except by two or more creatures.)
195. Goblin Dark-Dwellers (EDHREC 9566) - Menace (This creature can't be blocked except by two or more creatures.)
196. Frenzied Goblin (EDHREC 9619) - If you do, target creature can't block this turn.
197. Lavinia of the Tenth (EDHREC 9654) - (Until your next turn, those permanents can't attack or block and their activated abilities can't be activated.)
198. Grappling Hook (EDHREC 9663) - Whenever equipped creature attacks, you may have target creature block it this turn if able.
199. Hot Soup (EDHREC 9705) - Equipped creature can't be blocked.
200. Alora, Merry Thief (EDHREC 9721) - Whenever you attack, up to one target attacking creature can't be blocked this turn.

### 14. Control Change And Exchange Effects

Source: corpus-mined follow-on seam
Available after current queue exclusion: 242

1. Hellkite Tyrant (EDHREC 769) - Whenever this creature deals combat damage to a player, gain control of all artifacts that player controls.
2. Homeward Path (EDHREC 1140) - {T}: Each player gains control of all creatures they own.
3. Treasure Nabber (EDHREC 1439) - Whenever an opponent taps an artifact for mana, gain control of that artifact until the end of your next turn.
4. Emrakul, the Promised End (EDHREC 1816) - When you cast this spell, you gain control of target opponent during that player's next turn.
5. Insurrection (EDHREC 2033) - Untap all creatures and gain control of them until end of turn.
6. Thieving Skydiver (EDHREC 2108) - When this creature enters, if it was kicked, gain control of target artifact with mana value X or less.
7. Invert Polarity (EDHREC 2161) - If you win the flip, gain control of that spell and you may choose new targets for it.
8. Zealous Conscripts (EDHREC 2237) - When this creature enters, gain control of target permanent until end of turn.
9. Commandeer (EDHREC 2388) - Gain control of target noncreature spell.
10. Captivating Vampire (EDHREC 2458) - Tap five untapped Vampires you control: Gain control of target creature.
11. Expropriate (EDHREC 2494) - For each money vote, choose a permanent owned by the voter and gain control of it.
12. Flayer of Loyalties (EDHREC 2871) - When you cast this spell, gain control of target creature until end of turn.
13. Captivating Crew (EDHREC 3190) - {3}{R}: Gain control of target creature an opponent controls until end of turn.
14. Mob Rule (EDHREC 3249) - • Gain control of all creatures with power 4 or greater until end of turn.
15. Coercive Recruiter (EDHREC 3318) - Whenever this creature or another Pirate you control enters, gain control of target creature until end of turn.
16. Hideous Taskmaster (EDHREC 3483) - When you cast this spell, for each opponent, gain control of up to one target creature that player controls until end of turn.
17. Roil Elemental (EDHREC 3735) - Landfall — Whenever a land you control enters, you may gain control of target creature for as long as you control this creature.
18. Sower of Temptation (EDHREC 3776) - When this creature enters, gain control of target creature for as long as this creature remains on the battlefield.
19. Reins of Power (EDHREC 3806) - You and that opponent each gain control of all creatures the other controls until end of turn.
20. Blue Sun's Twilight (EDHREC 3948) - Gain control of target creature with mana value X or less.
21. Assault Suit (EDHREC 4077) - At the beginning of each opponent's upkeep, you may have that player gain control of equipped creature until end of turn.
22. New Blood (EDHREC 4123) - Gain control of target creature.
23. Keiga, the Tide Star (EDHREC 4202) - When Keiga dies, gain control of target creature.
24. Mind Flayer (EDHREC 4335) - Dominate Monster — When this creature enters, gain control of target creature for as long as you control this creature.
25. Akroan Horse (EDHREC 4447) - When this creature enters, an opponent gains control of it.
26. Act of Treason (EDHREC 4643) - Gain control of target creature until end of turn.
27. Blatant Thievery (EDHREC 4757) - For each opponent, gain control of target permanent that player controls.
28. Perplexing Chimera (EDHREC 5173) - Whenever an opponent casts a spell, you may exchange control of this creature and that spell.
29. Chef's Kiss (EDHREC 5226) - Gain control of target spell that targets only a single permanent or player.
30. Molten Primordial (EDHREC 5245) - When this creature enters, for each opponent, gain control of up to one target creature that player controls until end of turn.
31. Harmless Offering (EDHREC 5445) - Target opponent gains control of target permanent you control.
32. Admiral Beckett Brass (EDHREC 5513) - At the beginning of your end step, gain control of target nonland permanent controlled by a player who was dealt combat damage by three or more Pirates this turn.
33. Wrong Turn (EDHREC 5630) - Target opponent gains control of target creature.
34. Grishnákh, Brash Instigator (EDHREC 5860) - When you do, until end of turn, gain control of target nonlegendary creature an opponent controls with power less than or equal to the amassed Army's power.
35. Varchild, Betrayer of Kjeldor (EDHREC 5887) - When Varchild leaves the battlefield, gain control of all Survivors.
36. Hot Pursuit (EDHREC 6050) - At the beginning of combat on your turn, if two or more players have lost the game, gain control of all goaded and/or suspected creatures until end of turn.
37. Shifting Grift (EDHREC 6113) - + {2} — Exchange control of two target creatures.
38. Willbreaker (EDHREC 6168) - Whenever a creature an opponent controls becomes the target of a spell or ability you control, gain control of that creature for as long as you control this creature.
39. Mass Manipulation (EDHREC 6179) - Gain control of X target creatures and/or planeswalkers.
40. Dragonlord Silumgar (EDHREC 6354) - When Dragonlord Silumgar enters, gain control of target creature or planeswalker for as long as you control Dragonlord Silumgar.
41. Claim the Firstborn (EDHREC 6725) - Gain control of target creature with mana value 3 or less until end of turn.
42. Kari Zev's Expertise (EDHREC 6749) - Gain control of target creature or Vehicle until end of turn.
43. Mass Mutiny (EDHREC 6756) - For each opponent, gain control of up to one target creature that player controls until end of turn.
44. Yuffie, Materia Hunter (EDHREC 6798) - When Yuffie enters, gain control of target noncreature artifact for as long as you control Yuffie.
45. Bazaar Trader (EDHREC 7120) - {T}: Target player gains control of target artifact, creature, or land you control.
46. Confiscation Coup (EDHREC 7144) - If you do, gain control of it.
47. Sudden Substitution (EDHREC 7153) - Exchange control of target noncreature spell and target creature.
48. Role Reversal (EDHREC 7486) - Exchange control of two target permanents that share a permanent type.
49. Memnarch (EDHREC 7588) - {3}{U}: Gain control of target artifact.
50. Karrthus, Tyrant of Jund (EDHREC 7905) - When Karrthus enters, gain control of all Dragons, then untap all Dragons.
51. Confusion in the Ranks (EDHREC 7970) - Exchange control of those permanents.
52. Midnight Crusader Shuttle (EDHREC 8042) - Midnight Entity — Whenever this Vehicle attacks, defending player faces a villainous choice — That player sacrifices a creature of their choice, or you gain control of a creature of your choice that player controls until end of turn.
53. Opportunistic Dragon (EDHREC 8110) - For as long as this creature remains on the battlefield, gain control of that permanent, it loses all abilities, and it can't attack or block.
54. Domineering Will (EDHREC 8143) - Target player gains control of up to three target nonattacking creatures until end of turn.
55. Souvenir Snatcher (EDHREC 8188) - Whenever this creature mutates, gain control of target noncreature artifact.
56. Sakashima's Will (EDHREC 8351) - You gain control of it.
57. Traitorous Greed (EDHREC 8665) - Gain control of target creature until end of turn.
58. Act of Aggression (EDHREC 8791) - Gain control of target creature an opponent controls until end of turn.
59. Subjugate the Hobbits (EDHREC 8927) - Gain control of each noncommander creature with mana value 3 or less.
60. Pyreswipe Hawk (EDHREC 8939) - Whenever you expend 6, gain control of up to one target artifact for as long as you control this creature.
61. Crown of Doom (EDHREC 8949) - {2}: Target player other than this artifact's owner gains control of it.
62. Hijack (EDHREC 9118) - Gain control of target artifact or creature until end of turn.
63. Chromeshell Crab (EDHREC 9161) - When this creature is turned face up, you may exchange control of target creature you control and target creature an opponent controls.
64. Empress Galina (EDHREC 9306) - {U}{U}, {T}: Gain control of target legendary permanent.
65. Scrambleverse (EDHREC 9521) - Then each player gains control of each permanent for which they were chosen.
66. Puca's Mischief (EDHREC 9776) - At the beginning of your upkeep, you may exchange control of target nonland permanent you control and target nonland permanent an opponent controls with equal or lesser mana value.
67. The Nipton Lottery (EDHREC 10390) - You gain control of that creature until end of turn.
68. Aura Thief (EDHREC 10517) - When this creature dies, you gain control of all enchantments.
69. Possession Engine (EDHREC 10668) - When this Vehicle enters, gain control of target creature an opponent controls for as long as you control this Vehicle.
70. Besmirch (EDHREC 10783) - Until end of turn, gain control of target creature and it gains haste.
71. Invoke the Winds (EDHREC 10942) - Gain control of target artifact or creature.
72. Blim, Comedic Genius (EDHREC 11125) - Whenever Blim deals combat damage to a player, that player gains control of target permanent you control.
73. Vedalken Shackles (EDHREC 11320) - {2}, {T}: Gain control of target creature with power less than or equal to the number of Islands you control for as long as this artifact remains tapped.
74. Fumble (EDHREC 11328) - Gain control of all Auras and Equipment that were attached to it, then attach them to another creature.
75. Dominus of Fealty (EDHREC 11354) - At the beginning of your upkeep, you may gain control of target permanent until end of turn.
76. Traitorous Blood (EDHREC 11356) - Gain control of target creature until end of turn.
77. Gilt-Leaf Archdruid (EDHREC 11502) - Tap seven untapped Druids you control: Gain control of all lands target player controls.
78. Beguiler of Wills (EDHREC 11587) - {T}: Gain control of target creature with power less than or equal to the number of creatures you control.
79. Goblin Cadets (EDHREC 11588) - Whenever this creature blocks or becomes blocked, target opponent gains control of it.
80. Risky Move (EDHREC 11624) - At the beginning of each player's upkeep, that player gains control of this enchantment.
81. Dominating Vampire (EDHREC 11688) - When this creature enters, gain control of target creature with mana value less than or equal to the number of Vampires you control until end of turn.
82. Peer Pressure (EDHREC 11822) - If you control more creatures of that type than each other player, you gain control of all creatures of that type.
83. Vedalken Plotter (EDHREC 11903) - When this creature enters, exchange control of target land you control and target land an opponent controls.
84. Take for a Ride (EDHREC 11967) - Gain control of target creature until end of turn.
85. Eyes Everywhere (EDHREC 12291) - {5}{U}: Exchange control of this enchantment and target nonland permanent.
86. Wrangle (EDHREC 12396) - Gain control of target creature with power 4 or less until end of turn.
87. Cultural Exchange (EDHREC 12562) - Those players exchange control of those creatures.
88. Word of Seizing (EDHREC 12570) - Untap target permanent and gain control of it until end of turn.
89. Captivating Glance (EDHREC 12598) - If you win, gain control of enchanted creature.
90. Harness by Force (EDHREC 12945) - Gain control of any number of target creatures until end of turn.
91. Avarice Amulet (EDHREC 12994) - Whenever equipped creature dies, target opponent gains control of this Equipment.
92. Reptilian Recruiter (EDHREC 13100) - If that creature's power is 2 or less or if you control another Lizard, gain control of that creature until end of turn, untap it, and it gains haste until end of turn.
93. Jace, Ingenious Mind-Mage (EDHREC 13228) - −9: Gain control of up to three target creatures.
94. Unexpected Request (EDHREC 13244) - Gain control of target creature until end of turn.
95. Daring Thief (EDHREC 13256) - Inspired — Whenever this creature becomes untapped, you may exchange control of target nonland permanent you control and target permanent an opponent controls that shares a card type with it.
96. Karona, False God (EDHREC 13375) - At the beginning of each player's upkeep, that player untaps Karona and gains control of it.
97. Price of Loyalty (EDHREC 13399) - Gain control of target creature until end of turn.
98. Eriette, the Beguiler (EDHREC 13489) - Whenever an Aura you control becomes attached to a nonland permanent an opponent controls with mana value less than or equal to that Aura's mana value, gain control of that permanent for as long as that Aura is attached to it.
99. Spreading Insurrection (EDHREC 13513) - Gain control of target creature you don't control until end of turn.
100. Merieke Ri Berit (EDHREC 13577) - {T}: Gain control of target creature for as long as you control Merieke Ri Berit.
101. Aethersnatch (EDHREC 13651) - Gain control of target spell.
102. Donate (EDHREC 13751) - Target player gains control of target permanent you control.
103. Malevolent Whispers (EDHREC 13808) - Gain control of target creature until end of turn.
104. Djinn of Infinite Deceits (EDHREC 13816) - {T}: Exchange control of two target nonlegendary creatures.
105. Entrancing Melody (EDHREC 13849) - Gain control of target creature with mana value X.
106. Switcheroo (EDHREC 13873) - Exchange control of two target creatures.
107. Act of Authority (EDHREC 13897) - If you do, its controller gains control of this enchantment.
108. Tempted by the Oriq (EDHREC 14101) - For each opponent, gain control of up to one target creature or planeswalker that player controls with mana value 3 or less.
109. Power of Persuasion (EDHREC 14108) - 20 | Gain control of it until the end of your next turn.
110. Garland, Royal Kidnapper (EDHREC 14268) - Whenever an opponent becomes the monarch, gain control of target creature that player controls for as long as they're the monarch.
111. Contested War Zone (EDHREC 14475) - Whenever a creature deals combat damage to you, that creature's controller gains control of this land.
112. Goatnap (EDHREC 14650) - Gain control of target creature until end of turn.
113. Chamber of Manipulation (EDHREC 14675) - Enchanted land has "{T}, Discard a card: Gain control of target creature until end of turn."
114. Frenzied Fugue (EDHREC 14689) - When this Aura enters and at the beginning of your upkeep, gain control of enchanted permanent until end of turn.
115. Conquering Manticore (EDHREC 14759) - When this creature enters, gain control of target creature an opponent controls until end of turn.
116. Pack's Betrayal (EDHREC 14772) - Gain control of target creature until end of turn.
117. Avarice Totem (EDHREC 14893) - {5}: Exchange control of this artifact and target nonland permanent.
118. Callous Oppressor (EDHREC 15096) - {T}: Gain control of target creature that isn't of the chosen type for as long as this creature remains tapped.
119. Tahngarth, First Mate (EDHREC 15103) - Whenever an opponent attacks with one or more creatures, if Tahngarth is tapped, you may have that opponent gain control of Tahngarth until end of combat.
120. Master Thief (EDHREC 15154) - When this creature enters, gain control of target artifact for as long as you control this creature.
121. Jeering Instigator (EDHREC 15194) - When this creature is turned face up, if it's your turn, gain control of another target creature until end of turn.
122. Rangers of Ithilien (EDHREC 15208) - When this creature enters, gain control of up to one target creature with lesser power for as long as you control this creature.
123. Threaten (EDHREC 15233) - Untap target creature and gain control of it until end of turn.
124. Sarkhan Vol (EDHREC 15398) - −2: Gain control of target creature until end of turn.
125. Systems Override (EDHREC 15423) - Gain control of target artifact or creature until end of turn.
126. Tentative Connection (EDHREC 15736) - Gain control of target creature until end of turn.
127. Awaken the Sleeper (EDHREC 15815) - Gain control of target creature until end of turn.
128. Order of Succession (EDHREC 16005) - Each player gains control of the creature they chose.
129. Debt of Loyalty (EDHREC 16076) - You gain control of that creature if it regenerates this way.
130. Trade the Helm (EDHREC 16108) - Exchange control of target artifact or creature you control and target artifact or creature an opponent controls.
131. Portent of Betrayal (EDHREC 16227) - Gain control of target creature until end of turn.
132. Visions of Duplicity (EDHREC 16390) - Exchange control of two target creatures you don't control.
133. Dominate (EDHREC 16554) - Gain control of target creature with mana value X or less.
134. Stolen Uniform (EDHREC 16628) - Gain control of that Equipment until end of turn.
135. Ray of Command (EDHREC 16657) - Untap target creature an opponent controls and gain control of it until end of turn.
136. Yasova Dragonclaw (EDHREC 16772) - If you do, gain control of target creature an opponent controls with power less than Yasova Dragonclaw's power until end of turn, untap that creature, and it gains haste until end of turn.
137. Charisma (EDHREC 16787) - Whenever enchanted creature deals damage to a creature, gain control of the other creature for as long as this Aura remains on the battlefield.
138. Political Trickery (EDHREC 16940) - Exchange control of target land you control and target land an opponent controls.
139. Caught Red-Handed (EDHREC 16946) - Gain control of target creature until end of turn.
140. Inniaz, the Gale Force (EDHREC 17064) - Whenever three or more creatures you control with flying attack, each player gains control of a nonland permanent of your choice controlled by the player to their right.
141. Momo's Heist (EDHREC 17210) - Gain control of target artifact.
142. Conjured Currency (EDHREC 17438) - At the beginning of your upkeep, you may exchange control of this enchantment and target permanent you neither own nor control.
143. Shifting Borders (EDHREC 17516) - Exchange control of two target lands.
144. Sibling Rivalry (EDHREC 17594) - Gain control of target artifact or creature until end of turn.
145. Treacherous Pit-Dweller (EDHREC 17709) - When this creature enters from a graveyard, target opponent gains control of it.
146. Rubinia Soulsinger (EDHREC 18142) - {T}: Gain control of target creature for as long as you control Rubinia Soulsinger and Rubinia Soulsinger remains tapped.
147. Giant's Grasp (EDHREC 18235) - When this Aura enters, gain control of target nonland permanent for as long as this Aura remains on the battlefield.
148. Akroan Conscriptor (EDHREC 18786) - Heroic — Whenever you cast a spell that targets this creature, gain control of another target creature until end of turn.
149. Traitorous Instinct (EDHREC 18950) - Gain control of target creature until end of turn.
150. Lullmage's Domination (EDHREC 18999) - Gain control of target creature with mana value X.
151. Eldrazi Obligator (EDHREC 19046) - If you do, gain control of target creature until end of turn, untap that creature, and it gains haste until end of turn.
152. Spawnbroker (EDHREC 19372) - When this creature enters, you may exchange control of target creature you control and target creature with power less than or equal to that creature's power an opponent controls.
153. Welcome to the Fold (EDHREC 19422) - Gain control of target creature if its toughness is 2 or less.
154. Crown of Empires (EDHREC 19533) - Gain control of that creature instead if you control artifacts named Scepter of Empires and Throne of Empires.
155. Blind with Anger (EDHREC 19592) - Untap target nonlegendary creature and gain control of it until end of turn.
156. Bringer of the Red Dawn (EDHREC 19603) - At the beginning of your upkeep, you may untap target creature and gain control of it until end of turn.
157. Grip of Phyresis (EDHREC 19677) - Gain control of target Equipment, then create a 0/0 black Phyrexian Germ creature token and attach that Equipment to it.
158. Kitsune, Dragon's Daughter (EDHREC 20173) - Whenever Kitsune enters or deals combat damage to a player, you may exchange control of two other target creatures controlled by different players.
159. Broadcast Takeover (EDHREC 20288) - Gain control of all artifacts your opponents control until end of turn.
160. Aura Graft (EDHREC 20422) - Gain control of target Aura that's attached to a permanent.
161. Turf War (EDHREC 20534) - Whenever a creature deals combat damage to a player, if that player controls one or more lands with contested counters on them, that creature's controller gains control of one of those lands of their choice and untaps it.
162. Limits of Solidarity (EDHREC 20708) - Gain control of target creature until end of turn.
163. Shifting Loyalties (EDHREC 20797) - Exchange control of two target permanents that share a card type.
164. In Thrall to the Pit (EDHREC 20960) - Gain control of target creature until end of turn.
165. Bill Ferny, Bree Swindler (EDHREC 20985) - • Target opponent gains control of target Horse you control.
166. Fickle Efreet (EDHREC 21037) - If you lose the flip, an opponent gains control of this creature.
167. Might Makes Right (EDHREC 21157) - At the beginning of combat on your turn, if you control each creature on the battlefield with the greatest power, gain control of target creature an opponent controls until end of turn.
168. Loxodon Peacekeeper (EDHREC 21161) - At the beginning of your upkeep, the player with the lowest life total gains control of this creature.
169. Lose Calm (EDHREC 21387) - Gain control of target creature until end of turn.
170. Drooling Ogre (EDHREC 21477) - Whenever a player casts an artifact spell, that player gains control of this creature.
171. Kukemssa Pirates (EDHREC 21541) - Whenever this creature attacks and isn't blocked, you may gain control of target artifact defending player controls.
172. Overtaker (EDHREC 21594) - {3}{U}, {T}, Discard a card: Untap target creature and gain control of it until end of turn.
173. Skyfire Kirin (EDHREC 21613) - Whenever you cast a Spirit or Arcane spell, you may gain control of target creature with that spell's mana value until end of turn.
174. Mascot Interception (EDHREC 21709) - Gain control of target creature until end of turn.
175. Enthralling Victor (EDHREC 21716) - When this creature enters, gain control of target creature an opponent controls with power 2 or less until end of turn.
176. Twist Allegiance (EDHREC 21772) - You and target opponent each gain control of all creatures the other controls until end of turn.
177. Press into Service (EDHREC 21805) - Gain control of target creature until end of turn.
178. Fractured Loyalty (EDHREC 22089) - Whenever enchanted creature becomes the target of a spell or ability, that spell or ability's controller gains control of that creature.
179. Unwilling Recruit (EDHREC 22105) - Gain control of target creature until end of turn.
180. Kefnet's Last Word (EDHREC 22199) - Gain control of target artifact, creature, or enchantment.
181. Bond of Passion (EDHREC 22404) - Gain control of target creature until end of turn.
182. Govern the Guildless (EDHREC 22441) - Gain control of target monocolored creature.
183. Witch Engine (EDHREC 22475) - Target opponent gains control of this creature.
184. Shuriken (EDHREC 22904) - That creature's controller gains control of Shuriken unless it was unattached from a Ninja."
185. Rootwater Matriarch (EDHREC 23039) - {T}: Gain control of target creature for as long as that creature is enchanted.
186. Tolarian Entrancer (EDHREC 23347) - Whenever this creature becomes blocked by a creature, gain control of that creature at end of combat.
187. Keldon Overseer (EDHREC 23477) - When this creature enters, if it was kicked, gain control of target creature until end of turn.
188. Shrewd Negotiation (EDHREC 23814) - Exchange control of target artifact you control and target artifact or creature you don't control.
189. Evangelize (EDHREC 23890) - Gain control of target creature of an opponent's choice they control.
190. Turn Against (EDHREC 23974) - Gain control of target creature until end of turn.
191. Brooding Saurian (EDHREC 24225) - At the beginning of each end step, each player gains control of all nontoken permanents they own.
192. Sky Swallower (EDHREC 24257) - When this creature enters, target opponent gains control of all other permanents you control.
193. Smelt-Ward Gatekeepers (EDHREC 24425) - When this creature enters, if you control two or more Gates, gain control of target creature an opponent controls until end of turn.
194. Wild Dogs (EDHREC 24444) - At the beginning of your upkeep, if a player has more life than each other player, the player with the most life gains control of this creature.
195. Measure of Wickedness (EDHREC 24490) - Whenever another card is put into your graveyard from anywhere, target opponent gains control of this enchantment.
196. Phyrexian Infiltrator (EDHREC 24617) - {2}{U}{U}: Exchange control of this creature and target creature.
197. Metallic Mastery (EDHREC 24784) - Gain control of target artifact until end of turn.
198. Siren of the Fanged Coast (EDHREC 25002) - When this creature enters, if tribute wasn't paid, gain control of target creature.
199. Wellspring (EDHREC 25255) - When this Aura enters, gain control of enchanted land until end of turn.
200. Exert Influence (EDHREC 25423) - Converge — Gain control of target creature if its power is less than or equal to the number of colors of mana spent to cast this spell.

### 15. Copy Spells And Abilities

Source: corpus-mined follow-on seam
Available after current queue exclusion: 228

1. Flusterstorm (EDHREC 308) - Storm (When you cast this spell, copy it for each spell cast before it this turn.
2. Strionic Resonator (EDHREC 550) - You may choose new targets for the copy.
3. Reflections of Littjara (EDHREC 627) - Whenever you cast a spell of the chosen type, copy that spell.
4. Dualcaster Mage (EDHREC 633) - When this creature enters, copy target instant or sorcery spell.
5. Return the Favor (EDHREC 748) - + {1} — Copy target instant spell, sorcery spell, activated ability, or triggered ability.
6. Narset's Reversal (EDHREC 777) - Copy target instant or sorcery spell, then return it to its owner's hand.
7. Mizzix's Mastery (EDHREC 824) - Exile target card that's an instant or sorcery from your graveyard. For each card exiled this way, copy it, and you may cast the copy without paying its mana cost. Exile Mizzix's Mastery. Overload {5}{R}{R}{R} (You may cast this spell for its overload cost....
8. Veyran, Voice of Duality (EDHREC 851) - Magecraft — Whenever you cast or copy an instant or sorcery spell, Veyran gets +1/+1 until end of turn.
9. Amphibian Downpour (EDHREC 1244) - Storm (When you cast this spell, copy it for each spell cast before it this turn.
10. Rings of Brighthearth (EDHREC 1351) - If you do, copy that ability.
11. Reverberate (EDHREC 1372) - Copy target instant or sorcery spell.
12. Thousand-Year Storm (EDHREC 1449) - Whenever you cast an instant or sorcery spell, copy it for each other instant and sorcery spell you've cast before it this turn.
13. Echoes of Eternity (EDHREC 1529) - You may choose new targets for the copy.
14. Illusionist's Bracers (EDHREC 1533) - Whenever an ability of equipped creature is activated, if it isn't a mana ability, copy that ability.
15. Lithoform Engine (EDHREC 1626) - {2}, {T}: Copy target activated or triggered ability you control.
16. Jin-Gitaxias, Progress Tyrant (EDHREC 1628) - Whenever you cast an artifact, instant, or sorcery spell, copy that spell.
17. Twinning Staff (EDHREC 1737) - If you would copy a spell one or more times, instead copy it that many times plus an additional time.
18. Weaver of Harmony (EDHREC 1969) - {G}, {T}: Copy target activated or triggered ability you control from an enchantment source.
19. Quantum Misalignment (EDHREC 1995) - Create a token that's a copy of target creature you control, except it isn't legendary. Rebound (If you cast this spell from your hand, exile it as it resolves. At the beginning of your next upkeep, you may cast this card from exile without paying its mana ...
20. Twinferno (EDHREC 2520) - • When you cast your next instant or sorcery spell this turn, copy that spell.
21. Wyll's Reversal (EDHREC 2628) - You may choose new targets for the copy.
22. Double Vision (EDHREC 2659) - Whenever you cast your first instant or sorcery spell each turn, copy that spell.
23. Reiterate (EDHREC 2700) - Copy target instant or sorcery spell.
24. Radstorm (EDHREC 2749) - Storm (When you cast this spell, copy it for each spell cast before it this turn.)
25. Pyromancer's Goggles (EDHREC 2836) - When that mana is spent to cast a red instant or sorcery spell, copy that spell and you may choose new targets for the copy.
26. Double Major (EDHREC 2921) - Copy target creature spell you control, except it isn't legendary if the spell is legendary.
27. See Double (EDHREC 3120) - • Copy target spell.
28. Chain of Smog (EDHREC 3147) - That player may copy this spell and may choose a new target for that copy.
29. Unbound Flourishing (EDHREC 3156) - Whenever you cast an instant or sorcery spell or activate an ability, if that spell's mana cost or that ability's activation cost contains {X}, copy that spell or ability.
30. Krark, the Thumbless (EDHREC 3390) - If you win the flip, copy that spell, and you may choose new targets for the copy.
31. Storm of Saruman (EDHREC 3472) - You may choose new targets for the copy.
32. Zada, Hedron Grinder (EDHREC 3566) - Whenever you cast an instant or sorcery spell that targets only Zada, copy that spell for each other creature you control that the spell could target.
33. Mind's Desire (EDHREC 3570) - Storm (When you cast this spell, copy it for each spell cast before it this turn.)
34. Aboleth Spawn (EDHREC 3715) - Probing Telepathy — Whenever a creature entering under an opponent's control causes a triggered ability of that creature to trigger, you may copy that ability.
35. Wild Ricochet (EDHREC 3869) - Then copy that spell.
36. Ulalek, Fused Atrocity (EDHREC 4043) - If you do, copy all spells you control, then copy all other activated and triggered abilities you control.
37. Gogo, Master of Mimicry (EDHREC 4047) - {X}{X}, {T}: Copy target activated or triggered ability you control X times.
38. Stella Lee, Wild Card (EDHREC 4100) - {T}: Copy target instant or sorcery spell you control.
39. Fire Lord Azula (EDHREC 4327) - Whenever you cast a spell while Fire Lord Azula is attacking, copy that spell.
40. Sunken Palace (EDHREC 4336) - When you spend this mana to cast a spell or activate an ability, copy that spell or ability.
41. Swarm Intelligence (EDHREC 4353) - Whenever you cast an instant or sorcery spell, you may copy that spell.
42. Stolen Identity (EDHREC 4514) - Create a token that's a copy of target artifact or creature. Cipher (Then you may exile this spell card encoded on a creature you control. Whenever that creature deals combat damage to a player, its controller may cast a copy of the encoded card without pay...
43. Peter Parker's Camera (EDHREC 4543) - {2}, {T}, Remove a film counter from this artifact: Copy target activated or triggered ability you control.
44. Wondrous Crucible (EDHREC 4571) - (A copy of a permanent spell becomes a token.)
45. March of Progress (EDHREC 4616) - Choose target artifact creature you control. For each creature chosen this way, create a token that's a copy of it. Overload {6}{U} (You may cast this spell for its overload cost. If you do, change its text by replacing all instances of "target" with "each.")
46. Haze of Rage (EDHREC 4668) - Storm (When you cast this spell, copy it for each spell cast before it this turn.)
47. Bonus Round (EDHREC 4992) - Until end of turn, whenever a player casts an instant or sorcery spell, that player copies it and may choose new targets for the copy.
48. Finale of Promise (EDHREC 5004) - If X is 10 or more, copy each of those spells twice.
49. Tempt with Mayhem (EDHREC 5069) - Each opponent may copy that spell and may choose new targets for the copy they control.
50. Battlemage's Bracers (EDHREC 5121) - If you do, copy that ability.
51. Chef's Kiss (EDHREC 5226) - Copy it, then reselect the targets at random for the spell and the copy.
52. Display of Power (EDHREC 5230) - Copy any number of target instant and/or sorcery spells.
53. Stormscale Scion (EDHREC 5238) - Storm (When you cast this spell, copy it for each spell cast before it this turn.
54. Abstruse Archaic (EDHREC 5267) - {1}, {T}: Copy target activated or triggered ability you control from a colorless source.
55. Taigam, Master Opportunist (EDHREC 5284) - Flurry — Whenever you cast your second spell each turn, copy it, then exile the spell you cast with four time counters on it.
56. Double Down (EDHREC 5411) - Whenever you cast an outlaw spell, copy that spell.
57. Octavia, Living Thesis (EDHREC 5468) - Magecraft — Whenever you cast or copy an instant or sorcery spell, target creature has base power and toughness 8/8 until end of turn.
58. Storm King's Thunder (EDHREC 5528) - When you next cast an instant or sorcery spell this turn, copy that spell X times.
59. Tomb of Horrors Adventurer (EDHREC 5724) - If you've completed a dungeon, copy that spell twice instead.
60. Ivy, Gleeful Spellthief (EDHREC 5732) - Whenever a player casts a spell that targets only a single creature other than Ivy, you may copy that spell.
61. Leyline of Resonance (EDHREC 5946) - Whenever you cast an instant or sorcery spell that targets only a single creature you control, copy that spell.
62. Hatchery Sliver (EDHREC 6042) - (A copy of a permanent spell becomes a token.)
63. The Peregrine Dynamo (EDHREC 6065) - {1}, {T}: Copy target activated or triggered ability you control from another legendary source that's not a commander.
64. Naru Meha, Master Wizard (EDHREC 6141) - When Naru Meha enters, copy target instant or sorcery spell you control.
65. The Sixth Doctor (EDHREC 6160) - A copy of a permanent spell becomes a token.)
66. Drafna, Founder of Lat-Nam (EDHREC 6227) - {3}, {T}: Copy target artifact spell you control.
67. Tempest Technique (EDHREC 6309) - Storm (When you cast this spell, copy it for each spell cast before it this turn.
68. Twincast (EDHREC 6343) - Copy target instant or sorcery spell.
69. Leonin Lightscribe (EDHREC 6408) - Magecraft — Whenever you cast or copy an instant or sorcery spell, creatures you control get +1/+1 until end of turn.
70. Melek, Izzet Paragon (EDHREC 6915) - You may choose new targets for the copy.
71. Split Decision (EDHREC 7043) - If duplication gets more votes or the vote is tied, copy the spell.
72. Fury Storm (EDHREC 7168) - Copy target instant or sorcery spell.
73. Consign to Memory (EDHREC 7395) - Replicate {1} (When you cast this spell, copy it for each time you paid its replicate cost. You may choose new targets for the copies.) Counter target triggered ability or colorless spell.
74. Storm, Force of Nature (EDHREC 7419) - (When you cast it, copy it for each spell cast before it this turn.
75. Myojin of Cryptic Dreams (EDHREC 7487) - Remove an indestructible counter from Myojin of Cryptic Dreams: Copy target permanent spell you control three times.
76. Teach by Example (EDHREC 7550) - When you next cast an instant or sorcery spell this turn, copy that spell.
77. Spelltwine (EDHREC 7628) - Exile target instant or sorcery card from your graveyard and target instant or sorcery card from an opponent's graveyard. Copy those cards. Cast the copies if able without paying their mana costs. Exile Spelltwine.
78. Repeated Reverberation (EDHREC 7671) - When you next cast an instant spell, cast a sorcery spell, or activate a loyalty ability this turn, copy that spell or ability twice.
79. Crackling Spellslinger (EDHREC 7686) - (When you cast that spell, copy it for each spell cast before it this turn.
80. Jaya's Phoenix (EDHREC 7948) - You may choose new targets for the copy.
81. Insidious Will (EDHREC 8175) - • Copy target instant or sorcery spell.
82. Case of the Shifting Visage (EDHREC 8214) - Solved — Whenever you cast a nonlegendary creature spell, copy that spell.
83. Errant, Street Artist (EDHREC 8230) - {1}{U}, {T}: Copy target spell you control that wasn't cast.
84. Volo, Guide to Monsters (EDHREC 8307) - Whenever you cast a creature spell that doesn't share a creature type with a creature you control or a creature card in your graveyard, copy that spell.
85. Bygone Marvels (EDHREC 8692) - Descend 8 — When you cast this spell, if there are eight or more permanent cards in your graveyard, copy this spell twice.
86. Complete the Circuit (EDHREC 8984) - When you next cast an instant or sorcery spell this turn, copy that spell twice.
87. All of History, All at Once (EDHREC 9117) - Storm (When you cast this spell, copy it for each spell cast before it this turn.)
88. Spider-Verse (EDHREC 9240) - If you do, you may choose new targets for the copy.
89. Galvanic Relay (EDHREC 9298) - Storm (When you cast this spell, copy it for each spell cast before it this turn.)
90. Kirol, Attentive First-Year (EDHREC 9378) - You may choose new targets for the copy.
91. Dual Strike (EDHREC 9474) - When you next cast an instant or sorcery spell with mana value 4 or less this turn, copy that spell.
92. Rally the Galadhrim (EDHREC 9881) - Create a token that's a copy of target creature you control. Conspire (As you cast this spell, you may tap two untapped creatures you control that share a color with it. When you do, copy it and you may choose a new target for the copy.)
93. Lucky Clover (EDHREC 9944) - You may choose new targets for the copy.
94. Lose Focus (EDHREC 9973) - Replicate {U} (When you cast this spell, copy it for each time you paid its replicate cost. You may choose new targets for the copies.) Counter target spell unless its controller pays {2}.
95. Curse of Echoes (EDHREC 9988) - Whenever enchanted player casts an instant or sorcery spell, each other player may copy that spell and may choose new targets for the copy they control.
96. Quandrix Apprentice (EDHREC 10011) - Magecraft — Whenever you cast or copy an instant or sorcery spell, look at the top three cards of your library.
97. Rowan's Talent (EDHREC 10638) - Whenever you activate a loyalty ability of enchanted planeswalker, copy that ability.
98. Doublecast (EDHREC 10816) - When you next cast an instant or sorcery spell this turn, copy that spell.
99. Verrak, Warped Sengir (EDHREC 10852) - If you do, copy that ability.
100. Radiant Performer (EDHREC 11076) - Copy that spell or ability for each other permanent or player the spell or ability could target.
101. Leori, Sparktouched Hunter (EDHREC 11082) - Until end of turn, whenever you activate an ability of a planeswalker of that type, copy that ability.
102. Shiko, Paragon of the Way (EDHREC 11280) - (A copy of a permanent spell becomes a token.)
103. Temporal Fissure (EDHREC 11426) - Storm (When you cast this spell, copy it for each spell cast before it this turn.
104. Chancellor of Tales (EDHREC 11466) - You may choose new targets for the copy.
105. Riku of Two Reflections (EDHREC 11475) - If you do, copy that spell.
106. Najal, the Storm Runner (EDHREC 11622) - You may choose new targets for the copy.
107. Agrus Kos, Eternal Soldier (EDHREC 11659) - If you do, copy that ability for each other creature you control that ability could target.
108. Will Kenrith (EDHREC 11763) - You may choose new targets for the copy."
109. Spinerock Tyrant (EDHREC 11923) - You may choose new targets for the copy.
110. Flamehold Grappler (EDHREC 12001) - When this creature enters, copy the next spell you cast this turn when you cast it.
111. Ian Chesterton (EDHREC 12060) - Science Teacher — Each Saga spell you cast has replicate. The replicate cost is equal to its mana cost. (When you cast that Saga, copy it for each time you paid its replicate cost. Copies of Saga spells become tokens.) Doctor's companion (You can have two c...
112. Zevlor, Elturel Exile (EDHREC 12167) - {2}, {T}: When you next cast an instant or sorcery spell that targets only a single opponent or a single permanent an opponent controls this turn, for each other opponent, choose that player or a permanent they control, copy that spell, and the copy targets the chosen player or permanent.
113. Gandalf, Westward Voyager (EDHREC 12177) - If any of those cards shares a card type with that spell, copy that spell, you may choose new targets for the copy, and each opponent draws a card.
114. Ignite Memories (EDHREC 12248) - Storm (When you cast this spell, copy it for each spell cast before it this turn.
115. Dual Casting (EDHREC 12338) - Enchanted creature has "{R}, {T}: Copy target instant or sorcery spell you control.
116. Chandra's Regulator (EDHREC 12519) - If you do, copy that ability.
117. Mythos of Illuna (EDHREC 12630) - Create a token that's a copy of target permanent. If {R}{G} was spent to cast this spell, instead create a token that's a copy of that permanent, except the token has "When this token enters, if it's a creature, it fights up to one target creature you don't...
118. Pit Automaton (EDHREC 12634) - You may choose new targets for the copy.
119. Mischievous Quanar (EDHREC 12654) - When this creature is turned face up, copy target instant or sorcery spell.
120. Ashnod the Uncaring (EDHREC 12656) - Whenever you activate an ability of an artifact or creature that isn't a mana ability, if one or more permanents were sacrificed to activate it, you may copy that ability.
121. Mathise, Surge Channeler (EDHREC 12732) - 20 | Copy that spell.
122. Sage of the Skies (EDHREC 12859) - When you cast this spell, if you've cast another spell this turn, copy this spell.
123. Dynaheir, Invoker Adept (EDHREC 12870) - {T}: When you next activate an ability that isn't a mana ability this turn by spending four or more mana to activate it, copy that ability.
124. Exterminator Magmarch (EDHREC 13043) - Copy that spell.
125. Howl of the Horde (EDHREC 13169) - When you next cast an instant or sorcery spell this turn, copy that spell.
126. Barroom Brawl (EDHREC 13202) - Then that player may copy this spell and may choose new targets for the copy.
127. Feather, Radiant Arbiter (EDHREC 13235) - If you do, for each of those creatures, copy that spell.
128. Sigil Tracer (EDHREC 13283) - {1}{U}, Tap two untapped Wizards you control: Copy target instant or sorcery spell.
129. Spreading Insurrection (EDHREC 13513) - Storm (When you cast this spell, copy it for each spell cast before it this turn.
130. Prismari, the Inspiration (EDHREC 13754) - (Whenever you cast an instant or sorcery spell, copy it for each spell cast before it this turn.
131. Uyo, Silent Prophet (EDHREC 13769) - {2}, Return two lands you control to their owner's hand: Copy target instant or sorcery spell.
132. Radiate (EDHREC 13773) - Copy that spell for each other permanent or player the spell could target.
133. Wing Shards (EDHREC 13853) - Storm (When you cast this spell, copy it for each spell cast before it this turn.
134. Eternal Dominion (EDHREC 13989) - At the beginning of each of your upkeeps, copy this spell except for its epic ability.
135. Lutri, the Spellchaser (EDHREC 14134) - When Lutri enters, if you cast it, copy target instant or sorcery spell you control.
136. Ether (EDHREC 14153) - When you next cast an instant or sorcery spell this turn, copy that spell.
137. Rootha, Mercurial Artist (EDHREC 14371) - {2}, Return Rootha to its owner's hand: Copy target instant or sorcery spell you control.
138. Mordor on the March (EDHREC 14458) - Storm (When you cast this spell, copy it for each spell cast before it this turn.)
139. Tzaangor Shaman (EDHREC 14741) - Sorcerous Elixir — Whenever this creature deals combat damage to a player, copy the next instant or sorcery spell you cast this turn when you cast it.
140. Hunting Pack (EDHREC 14773) - Storm (When you cast this spell, copy it for each spell cast before it this turn.)
141. Mirari (EDHREC 14834) - If you do, copy that spell.
142. Raiding Schemes (EDHREC 14960) - When you do, copy it and you may choose new targets for the copy.
143. Ground Rift (EDHREC 15267) - Storm (When you cast this spell, copy it for each spell cast before it this turn.
144. Nivix Guildmage (EDHREC 15433) - {2}{U}{R}: Copy target instant or sorcery spell you control.
145. Silverquill, the Disputant (EDHREC 15452) - When you do, copy the spell and you may choose new targets for the copy.)
146. Echo Mage (EDHREC 15468) - {U}{U}, {T}: Copy target instant or sorcery spell.
147. Dragonsguard Elite (EDHREC 15530) - Magecraft — Whenever you cast or copy an instant or sorcery spell, put a +1/+1 counter on this creature.
148. Ertai's Meddling (EDHREC 15708) - If the card has no delay counters on it, the player puts it onto the stack as a copy of the original spell.
149. Jackal, Genius Geneticist (EDHREC 15797) - Whenever you cast a creature spell with mana value equal to Jackal's power, copy that spell, except the copy isn't legendary.
150. Parnesse, the Subtle Brush (EDHREC 15868) - Whenever you copy a spell, up to one target opponent may also copy that spell.
151. Tawnos, Urza's Apprentice (EDHREC 15990) - {U}{R}, {T}: Copy target activated or triggered ability you control from an artifact source.
152. Storm of Memories (EDHREC 15995) - Storm (When you cast this spell, copy it for each spell cast before it this turn.)
153. Gorion, Wise Mentor (EDHREC 16055) - You may choose new targets for the copy.
154. Reaping the Graves (EDHREC 16798) - Storm (When you cast this spell, copy it for each spell cast before it this turn.
155. Kurkesh, Onakke Ancient (EDHREC 16892) - If you do, copy that ability.
156. Nashi, Moon's Legacy (EDHREC 17361) - A copy of a permanent spell becomes a token.)
157. Astral Steel (EDHREC 17554) - Storm (When you cast this spell, copy it for each spell cast before it this turn.
158. Slick Imitator (EDHREC 17638) - Max speed — {1}, Sacrifice this creature: Copy target spell you control.
159. Sea Gate Stormcaller (EDHREC 17895) - When this creature enters, copy the next instant or sorcery spell with mana value 2 or less you cast this turn when you cast it.
160. Izzet Guildmage (EDHREC 17946) - {2}{U}: Copy target instant spell you control with mana value 2 or less.
161. Endless Swarm (EDHREC 18228) - At the beginning of each of your upkeeps, copy this spell except for its epic ability.)
162. League Guildmage (EDHREC 18405) - {X}{R}, {T}: Copy target instant or sorcery spell you control with mana value X.
163. Verazol, the Split Current (EDHREC 18422) - If you do, copy that spell.
164. String of Disappearances (EDHREC 18558) - If the player does, they may copy this spell and may choose a new target for that copy.
165. Owlin Spiralmancer (EDHREC 18607) - You may choose new targets for the copy.
166. Gadwick's First Duel (EDHREC 18631) - III — When you next cast an instant or sorcery spell with mana value 3 or less this turn, copy that spell.
167. Chain Stasis (EDHREC 18857) - If the player does, they may copy this spell and may choose a new target for that copy.
168. Clever Lumimancer (EDHREC 18930) - Magecraft — Whenever you cast or copy an instant or sorcery spell, this creature gets +2/+2 until end of turn.
169. Echocasting Symposium (EDHREC 19128) - Target player creates a token that's a copy of target creature you control. Paradigm (Then exile this spell. After you first resolve a spell with this name, you may cast a copy of it from exile without paying its mana cost at the beginning of each of your f...
170. Sevinne, the Chronoclasm (EDHREC 19222) - Whenever you cast your first instant or sorcery spell from your graveyard each turn, copy that spell.
171. Psychic Rebuttal (EDHREC 19287) - Spell mastery — If there are two or more instant and/or sorcery cards in your graveyard, you may copy the spell countered this way.
172. Karok Wrangler (EDHREC 19718) - Magecraft — Whenever you cast or copy an instant or sorcery spell, put a +1/+1 counter on target creature you control.
173. Beamsplitter Mage (EDHREC 20147) - Copy that spell.
174. Meletis Charlatan (EDHREC 20285) - That player may choose new targets for the copy.
175. Ink-Treader Nephilim (EDHREC 20564) - Whenever a player casts an instant or sorcery spell, if that spell targets only this creature, copy the spell for each other creature that spell could target.
176. Quandrix Pledgemage (EDHREC 20981) - Magecraft — Whenever you cast or copy an instant or sorcery spell, put a +1/+1 counter on this creature.
177. Cloven Casting (EDHREC 21382) - If you do, copy that spell.
178. Prismari Apprentice (EDHREC 21710) - Magecraft — Whenever you cast or copy an instant or sorcery spell, this creature can't be blocked this turn.
179. Rooftop Nuisance (EDHREC 21895) - When you do, copy this spell and you may choose a new target for the copy.)
180. Hindering Touch (EDHREC 21960) - Storm (When you cast this spell, copy it for each spell cast before it this turn.
181. Bill Potts (EDHREC 21989) - Whenever you cast an instant or sorcery spell that targets only Bill Potts or activate an ability that targets only Bill Potts, copy that spell or ability.
182. Threefold Signal (EDHREC 22018) - A copy of a permanent spell becomes a token.)
183. Elemental Expressionist (EDHREC 22367) - Magecraft — Whenever you cast or copy an instant or sorcery spell, choose target creature you control.
184. Mirror-Shield Hoplite (EDHREC 22654) - Whenever a creature you control becomes the target of a backup ability, copy that ability.
185. Neverending Torment (EDHREC 22794) - At the beginning of each of your upkeeps, copy this spell except for its epic ability.
186. Aziza, Mage Tower Captain (EDHREC 23166) - If you do, copy that spell.
187. Reflective Golem (EDHREC 23230) - If you do, copy that spell.
188. Grisly Sigil (EDHREC 23428) - When you do, copy this spell and you may choose a new target for the copy.)
189. Undying Flames (EDHREC 23963) - At the beginning of each of your upkeeps, copy this spell except for its epic ability.
190. Mica, Reader of Ruins (EDHREC 24335) - If you do, copy that spell and you may choose new targets for the copy.
191. Choreographed Sparks (EDHREC 24366) - • Copy target instant or sorcery spell you control.
192. Resonance Technician (EDHREC 24481) - {T}, Tap X untapped artifacts you control: Copy target instant or sorcery spell you control with mana value X.
193. Symmetry Sage (EDHREC 24747) - Magecraft — Whenever you cast or copy an instant or sorcery spell, target creature you control has base power 2 until end of turn.
194. Light 'Em Up (EDHREC 24883) - When you do, copy this spell and you may choose a new target for the copy.)
195. Join the Maestros (EDHREC 24935) - When you do, copy this spell.)
196. Mirror Sheen (EDHREC 25157) - {1}{U/R}{U/R}: Copy target instant or sorcery spell that targets you.
197. Prismari Pledgemage (EDHREC 25511) - Magecraft — Whenever you cast or copy an instant or sorcery spell, this creature can attack this turn as though it didn't have defender.
198. Silverquill Pledgemage (EDHREC 25637) - Magecraft — Whenever you cast or copy an instant or sorcery spell, this creature gains your choice of flying or lifelink until end of turn.
199. Imperial Mask (EDHREC 26027) - When this enchantment enters, if it's not a token, each of your teammates creates a token that's a copy of this enchantment. You have hexproof. (You can't be the target of spells or abilities your opponents control.)
200. Silverquill Apprentice (EDHREC 26228) - Magecraft — Whenever you cast or copy an instant or sorcery spell, target creature gets +1/+0 until end of turn.

### 16. Mana Generation And Mana Riders

Source: corpus-mined follow-on seam
Available after current queue exclusion: 1274

1. Sol Ring (EDHREC 1) - {T}: Add {C}{C}.
2. Command Tower (EDHREC 2) - {T}: Add one mana of any color in your commander's color identity.
3. Arcane Signet (EDHREC 3) - {T}: Add one mana of any color in your commander's color identity.
4. Exotic Orchard (EDHREC 9) - {T}: Add one mana of any color that a land an opponent controls could produce.
5. Reliquary Tower (EDHREC 10) - {T}: Add {C}.
6. Path of Ancestry (EDHREC 14) - {T}: Add one mana of any color in your commander's color identity.
7. Fellwar Stone (EDHREC 18) - {T}: Add one mana of any color that a land an opponent controls could produce.
8. Rogue's Passage (EDHREC 19) - {T}: Add {C}.
9. Thought Vessel (EDHREC 21) - {T}: Add {C}.
10. Bojuka Bog (EDHREC 27) - {T}: Add {B}.
11. Birds of Paradise (EDHREC 33) - {T}: Add one mana of any color.
12. Dark Ritual (EDHREC 34) - Add {B}{B}{B}.
13. Watery Grave (EDHREC 52) - ({T}: Add {U} or {B}.)
14. Godless Shrine (EDHREC 61) - ({T}: Add {W} or {B}.)
15. Llanowar Elves (EDHREC 62) - {T}: Add {G}.
16. Breeding Pool (EDHREC 63) - ({T}: Add {G} or {U}.)
17. Hallowed Fountain (EDHREC 65) - ({T}: Add {W} or {U}.)
18. Stomping Ground (EDHREC 67) - ({T}: Add {R} or {G}.)
19. Steam Vents (EDHREC 68) - ({T}: Add {U} or {R}.)
20. Temple of the False God (EDHREC 70) - {T}: Add {C}{C}.
21. Blood Crypt (EDHREC 72) - ({T}: Add {B} or {R}.)
22. Overgrown Tomb (EDHREC 73) - ({T}: Add {B} or {G}.)
23. Sacred Foundry (EDHREC 79) - ({T}: Add {R} or {W}.)
24. Chromatic Lantern (EDHREC 80) - Lands you control have "{T}: Add one mana of any color."
25. Temple Garden (EDHREC 82) - ({T}: Add {G} or {W}.)
26. Sunken Hollow (EDHREC 83) - ({T}: Add {U} or {B}.)
27. Cinder Glade (EDHREC 84) - ({T}: Add {R} or {G}.)
28. Sulfur Falls (EDHREC 85) - {T}: Add {U} or {R}.
29. Clifftop Retreat (EDHREC 86) - {T}: Add {R} or {W}.
30. Dragonskull Summit (EDHREC 88) - {T}: Add {B} or {R}.
31. Otawara, Soaring City (EDHREC 91) - {T}: Add {U}.
32. Smoldering Marsh (EDHREC 93) - ({T}: Add {B} or {R}.)
33. Isolated Chapel (EDHREC 97) - {T}: Add {W} or {B}.
34. Glacial Fortress (EDHREC 102) - {T}: Add {W} or {U}.
35. Canopy Vista (EDHREC 103) - ({T}: Add {G} or {W}.)
36. Hinterland Harbor (EDHREC 104) - {T}: Add {G} or {U}.
37. Jeska's Will (EDHREC 105) - • Add {R} for each card in target opponent's hand.
38. Prairie Stream (EDHREC 106) - ({T}: Add {W} or {U}.)
39. Elvish Mystic (EDHREC 109) - {T}: Add {G}.
40. Drowned Catacomb (EDHREC 111) - {T}: Add {U} or {B}.
41. Cavern of Souls (EDHREC 113) - {T}: Add {C}.
42. Mana Confluence (EDHREC 118) - {T}, Pay 1 life: Add one mana of any color.
43. Woodland Cemetery (EDHREC 119) - {T}: Add {B} or {G}.
44. Rootbound Crag (EDHREC 131) - {T}: Add {R} or {G}.
45. Sunpetal Grove (EDHREC 135) - {T}: Add {G} or {W}.
46. Dimir Signet (EDHREC 137) - {1}, {T}: Add {U}{B}.
47. Morphic Pool (EDHREC 138) - {T}: Add {U} or {B}.
48. Rejuvenating Springs (EDHREC 141) - {T}: Add {G} or {U}.
49. Chrome Mox (EDHREC 142) - {T}: Add one mana of any of the exiled card's colors.
50. Training Center (EDHREC 149) - {T}: Add {U} or {R}.
51. Rakdos Signet (EDHREC 155) - {1}, {T}: Add {B}{R}.
52. Delighted Halfling (EDHREC 157) - {T}: Add {C}.
53. Luxury Suite (EDHREC 162) - {T}: Add {B} or {R}.
54. Izzet Signet (EDHREC 164) - {1}, {T}: Add {U}{R}.
55. Sea of Clouds (EDHREC 166) - {T}: Add {W} or {U}.
56. Vault of Champions (EDHREC 167) - {T}: Add {W} or {B}.
57. Nykthos, Shrine to Nyx (EDHREC 170) - {T}: Add {C}.
58. Spectator Seating (EDHREC 171) - {T}: Add {R} or {W}.
59. Orzhov Signet (EDHREC 172) - {1}, {T}: Add {W}{B}.
60. Reflecting Pool (EDHREC 175) - {T}: Add one mana of any type that a land you control could produce.
61. Mystic Sanctuary (EDHREC 176) - ({T}: Add {U}.)
62. Undergrowth Stadium (EDHREC 178) - {T}: Add {B} or {G}.
63. Gemstone Caverns (EDHREC 179) - {T}: Add {C}.
64. Dreamroot Cascade (EDHREC 184) - {T}: Add {G} or {U}.
65. Spire Garden (EDHREC 185) - {T}: Add {R} or {G}.
66. Cabal Coffers (EDHREC 186) - {2}, {T}: Add {B} for each Swamp you control.
67. Three Tree City (EDHREC 187) - {T}: Add {C}.
68. Azorius Signet (EDHREC 192) - {1}, {T}: Add {W}{U}.
69. Mosswort Bridge (EDHREC 193) - {T}: Add {G}.
70. Karn's Bastion (EDHREC 199) - {T}: Add {C}.
71. Thran Dynamo (EDHREC 205) - {T}: Add {C}{C}{C}.
72. Bountiful Promenade (EDHREC 207) - {T}: Add {G} or {W}.
73. Mox Amber (EDHREC 209) - {T}: Add one mana of any color among legendary creatures and planeswalkers you control.
74. Rockfall Vale (EDHREC 210) - {T}: Add {R} or {G}.
75. Fyndhorn Elves (EDHREC 212) - {T}: Add {G}.
76. Secluded Courtyard (EDHREC 215) - {T}: Add {C}.
77. Stormcarved Coast (EDHREC 216) - {T}: Add {U} or {R}.
78. Shipwreck Marsh (EDHREC 223) - {T}: Add {U} or {B}.
79. Ornithopter of Paradise (EDHREC 225) - {T}: Add one mana of any color.
80. Boros Signet (EDHREC 232) - {1}, {T}: Add {R}{W}.
81. Unclaimed Territory (EDHREC 236) - {T}: Add {C}.
82. Mox Opal (EDHREC 238) - Metalcraft — {T}: Add one mana of any color.
83. Takenuma, Abandoned Mire (EDHREC 239) - {T}: Add {B}.
84. Patchwork Banner (EDHREC 244) - {T}: Add one mana of any color.
85. Everflowing Chalice (EDHREC 250) - {T}: Add {C} for each charge counter on this artifact.
86. Temple of Epiphany (EDHREC 267) - {T}: Add {U} or {R}.
87. Temple of Silence (EDHREC 272) - {T}: Add {W} or {B}.
88. Haunted Ridge (EDHREC 273) - {T}: Add {B} or {R}.
89. Deserted Beach (EDHREC 275) - {T}: Add {W} or {U}.
90. Simic Growth Chamber (EDHREC 277) - {T}: Add {G}{U}.
91. Decanter of Endless Water (EDHREC 278) - {T}: Add one mana of any color.
92. Bloom Tender (EDHREC 279) - Vivid — {T}: For each color among permanents you control, add one mana of that color.
93. Choked Estuary (EDHREC 284) - {T}: Add {U} or {B}.
94. Temple of Triumph (EDHREC 287) - {T}: Add {R} or {W}.
95. Darksteel Citadel (EDHREC 288) - {T}: Add {C}.
96. Overgrown Farmland (EDHREC 292) - {T}: Add {G} or {W}.
97. Jungle Shrine (EDHREC 293) - {T}: Add {R}, {G}, or {W}.
98. Temple of Mystery (EDHREC 294) - {T}: Add {G} or {U}.
99. Temple of Enlightenment (EDHREC 295) - {T}: Add {W} or {U}.
100. Darkwater Catacombs (EDHREC 301) - {1}, {T}: Add {U}{B}.
101. Golgari Rot Farm (EDHREC 305) - {T}: Add {B}{G}.
102. Lotus Cobra (EDHREC 310) - Landfall — Whenever a land you control enters, add one mana of any color.
103. Sundown Pass (EDHREC 312) - {T}: Add {R} or {W}.
104. Temple of Deceit (EDHREC 313) - {T}: Add {U} or {B}.
105. Rugged Prairie (EDHREC 314) - {T}: Add {C}.
106. Flooded Grove (EDHREC 320) - {T}: Add {C}.
107. Foreboding Ruins (EDHREC 321) - {T}: Add {B} or {R}.
108. Shattered Sanctum (EDHREC 322) - {T}: Add {W} or {B}.
109. Cascade Bluffs (EDHREC 324) - {T}: Add {C}.
110. Dimir Aqueduct (EDHREC 326) - {T}: Add {U}{B}.
111. Seat of the Synod (EDHREC 332) - {T}: Add {U}.
112. Arcane Sanctum (EDHREC 334) - {T}: Add {W}, {U}, or {B}.
113. Mana Geyser (EDHREC 336) - Add {R} for each tapped land your opponents control.
114. Fortified Village (EDHREC 339) - {T}: Add {G} or {W}.
115. Port Town (EDHREC 341) - {T}: Add {W} or {U}.
116. Temple of Malady (EDHREC 345) - {T}: Add {B} or {G}.
117. Skycloud Expanse (EDHREC 347) - {1}, {T}: Add {W}{U}.
118. Frostboil Snarl (EDHREC 349) - {T}: Add {U} or {R}.
119. Crumbling Necropolis (EDHREC 352) - {T}: Add {U}, {B}, or {R}.
120. Nomad Outpost (EDHREC 355) - {T}: Add {R}, {W}, or {B}.
121. Seething Song (EDHREC 356) - Add {R}{R}{R}{R}{R}.
122. Furycalm Snarl (EDHREC 361) - {T}: Add {R} or {W}.
123. Game Trail (EDHREC 362) - {T}: Add {R} or {G}.
124. Orzhov Basilica (EDHREC 366) - {T}: Add {W}{B}.
125. Opulent Palace (EDHREC 368) - {T}: Add {B}, {G}, or {U}.
126. Mystic Monastery (EDHREC 372) - {T}: Add {U}, {R}, or {W}.
127. Fetid Heath (EDHREC 374) - {T}: Add {C}.
128. Kessig Wolf Run (EDHREC 376) - {T}: Add {C}.
129. Izzet Boilerworks (EDHREC 377) - {T}: Add {U}{R}.
130. Frontier Bivouac (EDHREC 381) - {T}: Add {G}, {U}, or {R}.
131. Shifting Woodland (EDHREC 382) - {T}: Add {G}.
132. Spire of Industry (EDHREC 384) - {T}: Add {C}.
133. Seaside Citadel (EDHREC 391) - {T}: Add {G}, {W}, or {U}.
134. Gruul Turf (EDHREC 399) - {T}: Add {R}{G}.
135. Temple of Malice (EDHREC 400) - {T}: Add {B} or {R}.
136. Arena of Glory (EDHREC 406) - {T}: Add {R}.
137. Great Furnace (EDHREC 408) - {T}: Add {R}.
138. Gilded Lotus (EDHREC 414) - {T}: Add three mana of any one color.
139. Twilight Mire (EDHREC 416) - {T}: Add {C}.
140. Shadowblood Ridge (EDHREC 417) - {1}, {T}: Add {B}{R}.
141. Hall of Heliod's Generosity (EDHREC 419) - {T}: Add {C}.
142. Tainted Field (EDHREC 424) - {T}: Add {C}.
143. Azorius Chancery (EDHREC 427) - {T}: Add {W}{U}.
144. Tainted Wood (EDHREC 432) - {T}: Add {C}.
145. Undercity Sewers (EDHREC 433) - ({T}: Add {U} or {B}.)
146. Sungrass Prairie (EDHREC 435) - {1}, {T}: Add {G}{W}.
147. Shineshadow Snarl (EDHREC 436) - {T}: Add {W} or {B}.
148. Simian Spirit Guide (EDHREC 440) - Exile this card from your hand: Add {R}.
149. Boros Garrison (EDHREC 441) - {T}: Add {R}{W}.
150. Deathcap Glade (EDHREC 442) - {T}: Add {B} or {G}.
151. Cursed Mirror (EDHREC 447) - {T}: Add {R}.
152. Vault of the Archangel (EDHREC 453) - {T}: Add {C}.
153. Rakdos Carnarium (EDHREC 459) - {T}: Add {B}{R}.
154. Gaea's Cradle (EDHREC 461) - {T}: Add {G} for each creature you control.
155. Temple of Plenty (EDHREC 466) - {T}: Add {G} or {W}.
156. Temple of Abandon (EDHREC 468) - {T}: Add {R} or {G}.
157. Underground Mortuary (EDHREC 473) - ({T}: Add {B} or {G}.)
158. Mistrise Village (EDHREC 478) - {T}: Add {U}.
159. Tainted Isle (EDHREC 485) - {T}: Add {C}.
160. Sandsteppe Citadel (EDHREC 493) - {T}: Add {W}, {B}, or {G}.
161. Liquimetal Torque (EDHREC 496) - {T}: Add {C}.
162. Tainted Peak (EDHREC 497) - {T}: Add {C}.
163. Academy Ruins (EDHREC 499) - {T}: Add {C}.
164. Avacyn's Pilgrim (EDHREC 507) - {T}: Add {W}.
165. Mossfire Valley (EDHREC 521) - {1}, {T}: Add {R}{G}.
166. Faeburrow Elder (EDHREC 523) - {T}: For each color among permanents you control, add one mana of that color.
167. Ancient Den (EDHREC 524) - {T}: Add {W}.
168. Selesnya Sanctuary (EDHREC 527) - {T}: Add {G}{W}.
169. Plaza of Heroes (EDHREC 529) - {T}: Add {C}.
170. Ignoble Hierarch (EDHREC 533) - {T}: Add {B}, {R}, or {G}.
171. Enduring Vitality (EDHREC 536) - Creatures you control have "{T}: Add one mana of any color."
172. Hedge Maze (EDHREC 539) - ({T}: Add {G} or {U}.)
173. Thespian's Stage (EDHREC 543) - {T}: Add {C}.
174. Vineglimmer Snarl (EDHREC 547) - {T}: Add {G} or {U}.
175. Basalt Monolith (EDHREC 552) - {T}: Add {C}{C}{C}.
176. Simic Signet (EDHREC 553) - {1}, {T}: Add {G}{U}.
177. Necroblossom Snarl (EDHREC 555) - {T}: Add {B} or {G}.
178. Raucous Theater (EDHREC 557) - ({T}: Add {B} or {R}.)
179. Shadowy Backstreet (EDHREC 560) - ({T}: Add {W} or {B}.)
180. Worn Powerstone (EDHREC 567) - {T}: Add {C}{C}.
181. Relic of Legends (EDHREC 571) - {T}: Add one mana of any color.
182. Nesting Grounds (EDHREC 574) - {T}: Add {C}.
183. Access Tunnel (EDHREC 579) - {T}: Add {C}.
184. Blazemire Verge (EDHREC 585) - {T}: Add {B}.
185. Graven Cairns (EDHREC 586) - {T}: Add {C}.
186. Talon Gates of Madara (EDHREC 594) - {T}: Add {C}.
187. Springleaf Drum (EDHREC 595) - {T}, Tap an untapped creature you control: Add one mana of any color.
188. Sanctum Weaver (EDHREC 596) - {T}: Add X mana of any one color, where X is the number of enchantments you control.
189. Minamo, School at Water's Edge (EDHREC 599) - {T}: Add {U}.
190. Shizo, Death's Storehouse (EDHREC 600) - {T}: Add {B}.
191. Vault of Whispers (EDHREC 605) - {T}: Add {B}.
192. Savage Lands (EDHREC 619) - {T}: Add {B}, {R}, or {G}.
193. Mortuary Mire (EDHREC 634) - {T}: Add {B}.
194. Thundering Falls (EDHREC 635) - ({T}: Add {U} or {R}.)
195. Commercial District (EDHREC 637) - ({T}: Add {R} or {G}.)
196. Mirari's Wake (EDHREC 640) - Whenever you tap a land for mana, add one mana of any type that land produced.
197. Windbrisk Heights (EDHREC 641) - {T}: Add {W}.
198. Golgari Signet (EDHREC 643) - {1}, {T}: Add {B}{G}.
199. Charcoal Diamond (EDHREC 644) - {T}: Add {B}.
200. Fire Diamond (EDHREC 660) - {T}: Add {R}.

### 17. Cast Without Paying Mana Cost

Source: corpus-mined follow-on seam
Available after current queue exclusion: 412

1. Fierce Guardianship (EDHREC 78) - If you control a commander, you may cast this spell without paying its mana cost.
2. Deflecting Swat (EDHREC 81) - If you control a commander, you may cast this spell without paying its mana cost.
3. Deadly Rollick (EDHREC 115) - If you control a commander, you may cast this spell without paying its mana cost.
4. Flawless Maneuver (EDHREC 181) - If you control a commander, you may cast this spell without paying its mana cost.
5. Mosswort Bridge (EDHREC 193) - {G}, {T}: You may play the exiled card without paying its mana cost if creatures you control have total power 10 or greater.
6. Etali, Primal Storm (EDHREC 257) - Whenever Etali attacks, exile the top card of each player's library, then you may cast any number of spells from among those cards without paying their mana costs.
7. Ephemerate (EDHREC 443) - At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost.)
8. Tibalt's Trickery (EDHREC 581) - They may cast that card without paying its mana cost.
9. Windbrisk Heights (EDHREC 641) - {W}, {T}: You may play the exiled card without paying its mana cost if you attacked with three or more creatures this turn.
10. Isochron Scepter (EDHREC 706) - If you do, you may cast the copy without paying its mana cost.
11. Spinerock Knoll (EDHREC 739) - {R}, {T}: You may play the exiled card without paying its mana cost if an opponent was dealt 7 or more damage this turn.
12. Mizzix's Mastery (EDHREC 824) - For each card exiled this way, copy it, and you may cast the copy without paying its mana cost.
13. Chimil, the Inner Sun (EDHREC 834) - Cast it without paying its mana cost or put it into your hand.
14. Omniscience (EDHREC 1032) - You may cast spells from your hand without paying their mana costs.
15. Apex Devastator (EDHREC 1052) - You may cast it without paying its mana cost.
16. Obscuring Haze (EDHREC 1522) - If you control a commander, you may cast this spell without paying its mana cost.
17. Wild-Magic Sorcerer (EDHREC 1594) - You may cast it without paying its mana cost.
18. Maelstrom Wanderer (EDHREC 1644) - You may cast it without paying its mana cost.
19. Aven Interrupter (EDHREC 1790) - (Its owner may cast it as a sorcery on a later turn without paying its mana cost.)
20. Sunbird's Invocation (EDHREC 1837) - You may cast a spell with mana value X or less from among cards revealed this way without paying its mana cost.
21. One with the Multiverse (EDHREC 1892) - Once during each of your turns, you may cast a spell from your hand or the top of your library without paying its mana cost.
22. Delay (EDHREC 1912) - When the last is removed, they may play it without paying its mana cost.
23. Fallen Shinobi (EDHREC 1915) - Until end of turn, you may play those cards without paying their mana costs.
24. Call Forth the Tempest (EDHREC 1975) - You may cast it without paying its mana cost.
25. Quantum Misalignment (EDHREC 1995) - At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost.)
26. The Key to the Vault (EDHREC 2055) - You may cast the exiled card without paying its mana cost.
27. Descendants' Path (EDHREC 2163) - If it's a creature card that shares a creature type with a creature you control, you may cast it without paying its mana cost.
28. Monstrous Vortex (EDHREC 2176) - Cast it without paying its mana cost or put it into your hand.
29. Arcane Bombardment (EDHREC 2203) - You may cast any number of the copies without paying their mana costs.
30. Villainous Wealth (EDHREC 2214) - You may cast any number of spells with mana value X or less from among them without paying their mana costs.
31. Powerbalance (EDHREC 2231) - If you do, you may cast that card without paying its mana cost if the two spells have the same mana value.
32. Plargg and Nassari (EDHREC 2246) - You may cast up to two spells from among the other cards exiled this way without paying their mana costs.
33. Wand of Wonder (EDHREC 2266) - You may cast up to X instant and/or sorcery spells from among cards exiled this way without paying their mana costs.
34. Thrumming Stone (EDHREC 2287) - You may cast spells with the same name as that spell from among the revealed cards without paying their mana costs.
35. Sol Talisman (EDHREC 2293) - When the last is removed, you may cast it without paying its mana cost.)
36. Pantlaza, Sun-Favored (EDHREC 2376) - Cast it without paying its mana cost or put it into your hand.
37. Imoti, Celebrant of Bounty (EDHREC 2491) - You may cast it without paying its mana cost.
38. Dracogenesis (EDHREC 2597) - You may cast Dragon spells without paying their mana costs.
39. Mind's Dilation (EDHREC 2617) - If it's a nonland card, you may cast it without paying its mana cost.
40. Aminatou's Augury (EDHREC 2618) - Until end of turn, for each nonland card type, you may cast a spell of that type from among the exiled cards without paying its mana cost.
41. Silent-Blade Oni (EDHREC 2631) - You may cast a spell from among those cards without paying its mana cost.
42. Cemetery Tampering (EDHREC 2640) - Then if there are twenty or more cards in your graveyard, you may play the exiled card without paying its mana cost.
43. Zhulodok, Void Gorger (EDHREC 2648) - You may cast it without paying its mana cost.
44. Jodah, the Unifier (EDHREC 2783) - You may cast that card without paying its mana cost.
45. Rousing Refrain (EDHREC 2833) - When the last is removed, you may cast it without paying its mana cost.)
46. Geode Golem (EDHREC 2896) - Whenever this creature deals combat damage to a player, you may cast your commander from the command zone without paying its mana cost.
47. Inevitable Betrayal (EDHREC 2986) - When the last is removed, you may cast it without paying its mana cost.)
48. Court of Locthwain (EDHREC 3025) - If you're the monarch, until end of turn, you may cast a spell from among cards exiled with this enchantment without paying its mana cost.
49. Whispering Madness (EDHREC 3083) - Whenever that creature deals combat damage to a player, its controller may cast a copy of the encoded card without paying its mana cost.)
50. Gríma, Saruman's Footman (EDHREC 3099) - You may cast that card without paying its mana cost.
51. Aetherworks Marvel (EDHREC 3257) - You may cast a spell from among them without paying its mana cost.
52. Diluvian Primordial (EDHREC 3413) - When this creature enters, for each opponent, you may cast up to one target instant or sorcery card from that player's graveyard without paying its mana cost.
53. Rashmi, Eternities Crafter (EDHREC 3417) - You may cast it without paying its mana cost if it's a spell with lesser mana value.
54. Wildsear, Scouring Maw (EDHREC 3460) - You may cast it without paying its mana cost.
55. Wheel of Fate (EDHREC 3464) - When the last is removed, you may cast it without paying its mana cost.)
56. World at War (EDHREC 3547) - At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost.)
57. Mind's Desire (EDHREC 3570) - Until end of turn, you may play that card without paying its mana cost.
58. Baral's Expertise (EDHREC 3774) - You may cast a spell with mana value 4 or less from your hand without paying its mana cost.
59. Annoyed Altisaur (EDHREC 3868) - You may cast it without paying its mana cost.
60. Chaos Wand (EDHREC 3880) - You may cast that card without paying its mana cost.
61. The First Sliver (EDHREC 4053) - You may cast it without paying its mana cost.
62. Guff Rewrites History (EDHREC 4135) - Each player may cast the nonland card they exiled without paying its mana cost.
63. Mox Tantalite (EDHREC 4227) - When the last is removed, you may cast it without paying its mana cost.)
64. Submerge (EDHREC 4317) - If an opponent controls a Forest and you control an Island, you may cast this spell without paying its mana cost.
65. Memory Plunder (EDHREC 4348) - You may cast target instant or sorcery card from an opponent's graveyard without paying its mana cost.
66. Breaching Dragonstorm (EDHREC 4380) - You may cast it without paying its mana cost if that spell's mana value is 8 or less.
67. Maelstrom Colossus (EDHREC 4441) - You may cast it without paying its mana cost.
68. Invoke Calamity (EDHREC 4446) - You may cast up to two instant and/or sorcery spells with total mana value 6 or less from your graveyard and/or hand without paying their mana costs.
69. Bloodbraid Elf (EDHREC 4471) - You may cast it without paying its mana cost.
70. Sword of Once and Future (EDHREC 4483) - Then you may cast an instant or sorcery spell with mana value 2 or less from your graveyard without paying its mana cost.
71. Stolen Identity (EDHREC 4514) - Whenever that creature deals combat damage to a player, its controller may cast a copy of the encoded card without paying its mana cost.)
72. Hidden Strings (EDHREC 4531) - Whenever that creature deals combat damage to a player, its controller may cast a copy of the encoded card without paying its mana cost.)
73. Wondrous Crucible (EDHREC 4571) - You may cast the copy without paying its mana cost.
74. Maelstrom Nexus (EDHREC 4606) - You may cast it without paying its mana cost.
75. Possibility Storm (EDHREC 4744) - That player may cast that card without paying its mana cost.
76. Arcane Heist (EDHREC 4790) - You may cast target instant or sorcery card from an opponent's graveyard without paying its mana cost.
77. Aurora Phoenix (EDHREC 4826) - You may cast it without paying its mana cost.
78. Bigger on the Inside (EDHREC 4838) - They may cast it without paying its mana cost.
79. Djeru and Hazoret (EDHREC 4977) - Until end of turn, you may cast the exiled card without paying its mana cost.
80. Nahiri, Forged in Fury (EDHREC 4987) - You may cast Equipment spells this way without paying their mana costs.
81. Finale of Promise (EDHREC 5004) - You may cast up to one target instant card and/or up to one target sorcery card from your graveyard each with mana value X or less without paying their mana costs.
82. Deep-Sea Kraken (EDHREC 5012) - When the last is removed, you may cast it without paying its mana cost.
83. Wrexial, the Risen Deep (EDHREC 5067) - Whenever Wrexial deals combat damage to a player, you may cast target instant or sorcery card from that player's graveyard without paying its mana cost.
84. Zoyowa's Justice (EDHREC 5071) - They cast it without paying its mana cost or put it into their hand.
85. Fevered Suspicion (EDHREC 5073) - You may cast any number of spells from among those nonland cards without paying their mana costs.
86. Kellan, the Kid (EDHREC 5171) - Whenever you cast a spell from anywhere other than your hand, you may cast a permanent spell with equal or lesser mana value from your hand without paying its mana cost.
87. Planetarium of Wan Shi Tong (EDHREC 5191) - You may cast that card without paying its mana cost.
88. Taigam, Master Opportunist (EDHREC 5284) - When the last is removed, they may play it without paying its mana cost.
89. Suspend (EDHREC 5288) - When the last is removed, they may play it without paying its mana cost.
90. Dance with Calamity (EDHREC 5418) - If the total mana value of the cards exiled this way is 13 or less, you may cast any number of spells from among those cards without paying their mana costs.
91. Sarevok's Tome (EDHREC 5473) - You may cast that card without paying its mana cost.
92. Press the Enemy (EDHREC 5529) - You may cast an instant or sorcery spell with equal or lesser mana value from your hand without paying its mana cost.
93. Halo Forager (EDHREC 5559) - When you do, you may cast target instant or sorcery card with mana value X from a graveyard without paying its mana cost.
94. Into the Time Vortex (EDHREC 5573) - You may cast it without paying its mana cost.
95. Glamdring (EDHREC 5615) - Whenever equipped creature deals combat damage to a player, you may cast an instant or sorcery spell from your hand with mana value less than or equal to that damage without paying its mana cost.
96. Sakashima's Protege (EDHREC 5655) - You may cast it without paying its mana cost.
97. Kotis, the Fangkeeper (EDHREC 5665) - You may cast any number of spells with mana value X or less from among them without paying their mana costs.
98. Star Whale (EDHREC 5673) - When the last is removed, you may cast it without paying its mana cost.
99. Triple Triad (EDHREC 5677) - Until end of turn, you may play the card you own exiled this way and each other card exiled this way with lesser mana value than it without paying their mana costs.
100. Epic Experiment (EDHREC 5729) - You may cast instant and sorcery spells with mana value X or less from among them without paying their mana costs.
101. River Song's Diary (EDHREC 5751) - You may cast it without paying its mana cost.
102. Clive's Hideaway (EDHREC 5781) - {2}, {T}: You may play the exiled card without paying its mana cost if you control four or more legendary creatures.
103. Dazzling Sphinx (EDHREC 5828) - You may cast that card without paying its mana cost.
104. Perception Bobblehead (EDHREC 5846) - You may cast a spell with mana value 3 or less from among them without paying its mana cost.
105. Evercoat Ursine (EDHREC 5888) - Whenever this creature deals combat damage to a player, if there are cards exiled with it, you may play one of them without paying its mana cost.
106. Jhoira of the Ghitu (EDHREC 5909) - When the last is removed, you may cast it without paying its mana cost.
107. Creative Technique (EDHREC 6000) - You may cast the exiled card without paying its mana cost.
108. Wildfire Devils (EDHREC 6321) - You may cast the copy without paying its mana cost.
109. Etali's Favor (EDHREC 6337) - Cast it without paying its mana cost or put it into your hand.
110. Maelstrom Archangel (EDHREC 6356) - Whenever this creature deals combat damage to a player, you may cast a spell from your hand without paying its mana cost.
111. Surge to Victory (EDHREC 6365) - You may cast the copy without paying its mana cost.
112. Distortion Strike (EDHREC 6376) - At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost.)
113. Smirking Spelljacker (EDHREC 6525) - Whenever this creature attacks, if a card is exiled with it, you may cast the exiled card without paying its mana cost.
114. Deluxe Dragster (EDHREC 6612) - Whenever this Vehicle deals combat damage to a player, you may cast target instant or sorcery card from that player's graveyard without paying its mana cost.
115. Baral and Kari Zev (EDHREC 6669) - Whenever you cast your first instant or sorcery spell each turn, you may cast a spell with lesser mana value that shares a card type with it from your hand without paying its mana cost.
116. Crabomination (EDHREC 6736) - You may cast a spell from among cards exiled this way without paying its mana cost.
117. Knowledge Pool (EDHREC 6746) - If the player does, they may cast a spell from among other cards exiled with this artifact without paying its mana cost.
118. Kari Zev's Expertise (EDHREC 6749) - You may cast a spell with mana value 2 or less from your hand without paying its mana cost.
119. Caves of Chaos Adventurer (EDHREC 6934) - If you've completed a dungeon, you may play that card this turn without paying its mana cost.
120. Shardless Agent (EDHREC 7057) - You may cast it without paying its mana cost.
121. Mindleech Mass (EDHREC 7182) - If you do, you may cast a spell from among those cards without paying its mana cost.
122. Visage Bandit (EDHREC 7319) - Cast it as a sorcery on a later turn without paying its mana cost.
123. Kheru Spellsnatcher (EDHREC 7367) - You may cast that card without paying its mana cost for as long as it remains exiled.
124. In Search of Greatness (EDHREC 7478) - At the beginning of your upkeep, you may cast a permanent spell from your hand with mana value equal to 1 plus the greatest mana value among other permanents you control without paying its mana cost.
125. Yue, the Moon Spirit (EDHREC 7521) - Waterbend {5}, {T}: You may cast a noncreature spell from your hand without paying its mana cost.
126. Etrata, Deadly Fugitive (EDHREC 7527) - If you can't, exile it, then you may cast the exiled card without paying its mana cost."
127. Maralen, Fae Ascendant (EDHREC 7548) - Once each turn, you may cast a spell with mana value less than or equal to the number of Elves and Faeries you control from among cards exiled with Maralen this turn without paying its mana cost.
128. Boarding Party (EDHREC 7611) - You may cast it without paying its mana cost.
129. Spelltwine (EDHREC 7628) - Cast the copies if able without paying their mana costs.
130. Transcendent Dragon (EDHREC 7660) - If that spell is countered this way, exile it instead of putting it into its owner's graveyard, then you may cast it without paying its mana cost.
131. Neera, Wild Mage (EDHREC 7730) - You may cast that card without paying its mana cost.
132. Narset Transcendent (EDHREC 7763) - At the beginning of your next upkeep, you may cast that card from exile without paying its mana cost.)
133. Dreadhorde Arcanist (EDHREC 7766) - Whenever this creature attacks, you may cast target instant or sorcery card with mana value less than or equal to this creature's power from your graveyard without paying its mana cost.
134. Narset, Enlightened Master (EDHREC 7841) - Until end of turn, you may cast noncreature spells from among those cards without paying their mana costs.
135. Extract Brain (EDHREC 7992) - You may cast a spell from among them without paying its mana cost.
136. Velomachus Lorehold (EDHREC 7997) - You may cast an instant or sorcery spell with mana value less than or equal to Velomachus Lorehold's power from among them without paying its mana cost.
137. Forger's Foundry (EDHREC 8062) - {3}{U}{U}, {T}: You may cast any number of spells from among cards exiled with this artifact without paying their mana costs.
138. Flamekin Herald (EDHREC 8091) - You may cast it without paying its mana cost.
139. Sorcerous Squall (EDHREC 8184) - Target opponent mills nine cards, then you may cast an instant or sorcery spell from that player's graveyard without paying its mana cost.
140. Make Your Own Luck (EDHREC 8256) - (You may cast it as a sorcery on a later turn without paying its mana cost.)
141. Etherium-Horn Sorcerer (EDHREC 8260) - You may cast it without paying its mana cost.
142. Yahenni's Expertise (EDHREC 8349) - You may cast a spell with mana value 3 or less from your hand without paying its mana cost.
143. Kiora, Sovereign of the Deep (EDHREC 8367) - You may cast a spell with mana value less than X from among them without paying its mana cost.
144. Pillage the Bog (EDHREC 8447) - Cast it as a sorcery on a later turn without paying its mana cost.
145. Dream Harvest (EDHREC 8453) - Until end of turn, you may cast cards exiled this way without paying their mana costs.
146. Emerge Unscathed (EDHREC 8467) - At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost.)
147. Stolen Goods (EDHREC 8509) - Until end of turn, you may cast that card without paying its mana cost.
148. Gale's Redirection (EDHREC 8594) - 15+ | You may cast the exiled card without paying its mana cost for as long as it remains exiled.
149. Slickshot Show-Off (EDHREC 8644) - Cast it as a sorcery on a later turn without paying its mana cost.
150. Daring Waverider (EDHREC 8647) - When this creature enters, you may cast target instant or sorcery card with mana value 4 or less from your graveyard without paying its mana cost.
151. Heralds of Tzeentch (EDHREC 8719) - You may cast it without paying its mana cost.
152. Once Upon a Time (EDHREC 8748) - If this spell is the first spell you've cast this game, you may cast it without paying its mana cost.
153. Yidris, Maelstrom Wielder (EDHREC 8757) - You may cast it without paying its mana cost.
154. Mysterious Stranger (EDHREC 8854) - You may cast the copy without paying its mana cost.
155. Taigam, Ojutai Master (EDHREC 8906) - At the beginning of your next upkeep, you may cast that card from exile without paying its mana cost.)
156. Diviner of Mist (EDHREC 8989) - You may cast an instant or sorcery spell from your graveyard with mana value 4 or less without paying its mana cost.
157. Forceful Denial (EDHREC 9002) - You may cast it without paying its mana cost.
158. Reenact the Crime (EDHREC 9089) - You may cast the copy without paying its mana cost.
159. Meteoric Mace (EDHREC 9102) - You may cast it without paying its mana cost.
160. Ethersworn Sphinx (EDHREC 9114) - You may cast it without paying its mana cost.
161. Reinterpret (EDHREC 9143) - You may cast a spell with equal or lesser mana value from your hand without paying its mana cost.
162. Let the Galaxy Burn (EDHREC 9194) - You may cast it without paying its mana cost.
163. Counterpoint (EDHREC 9286) - You may cast a creature, instant, sorcery, or planeswalker spell from your graveyard with mana value less than or equal to that spell's mana value without paying its mana cost.
164. Release to the Wind (EDHREC 9307) - For as long as that card remains exiled, its owner may cast it without paying its mana cost.
165. Step Between Worlds (EDHREC 9503) - Cast it as a sorcery on a later turn without paying its mana cost.
166. Charnel Serenade (EDHREC 9535) - When the last is removed, you may cast it without paying its mana cost.)
167. Goblin Dark-Dwellers (EDHREC 9566) - When this creature enters, you may cast target instant or sorcery card with mana value 3 or less from your graveyard without paying its mana cost.
168. Unexpected Results (EDHREC 9611) - If it's a nonland card, you may cast it without paying its mana cost.
169. Bre of Clan Stoutarm (EDHREC 9618) - You may cast that card without paying its mana cost if the spell's mana value is less than or equal to the amount of life you gained this turn.
170. Portent of Calamity (EDHREC 9628) - You may cast a spell from among the exiled cards without paying its mana cost if you exiled four or more cards this way.
171. Watcher of Hours (EDHREC 9668) - When the last is removed, you may cast it without paying its mana cost.
172. Omen Machine (EDHREC 9701) - Otherwise, the player casts it without paying its mana cost if able.
173. Talent of the Telepath (EDHREC 9791) - You may cast an instant or sorcery spell from among them without paying its mana cost.
174. Sinister Concierge (EDHREC 9798) - When the last is removed, they may cast it without paying its mana cost.
175. Smuggler's Buggy (EDHREC 9821) - Whenever this Vehicle deals combat damage to a player, you may cast the exiled card without paying its mana cost.
176. Reality Strobe (EDHREC 9870) - When the last is removed, you may cast it without paying its mana cost.)
177. Wild Evocation (EDHREC 10000) - Otherwise, the player casts it without paying its mana cost if able.
178. Primeval Spawn (EDHREC 10027) - You may cast any number of spells with total mana value 10 or less from among them without paying their mana costs.
179. Scholar of the Lost Trove (EDHREC 10050) - When this creature enters, you may cast target instant, sorcery, or artifact card from your graveyard without paying its mana cost.
180. Treasure Keeper (EDHREC 10162) - You may cast that card without paying its mana cost.
181. Lilah, Undefeated Slickshot (EDHREC 10177) - (You may cast it as a sorcery on a later turn without paying its mana cost.)
182. Spell Queller (EDHREC 10194) - When this creature leaves the battlefield, the exiled card's owner may cast that card without paying its mana cost.
183. Leaf-Crowned Elder (EDHREC 10268) - If you do, you may play that card without paying its mana cost.
184. Intet, the Dreamer (EDHREC 10459) - You may play that card without paying its mana cost for as long as Intet remains on the battlefield.
185. Mindclaw Shaman (EDHREC 10692) - You may cast an instant or sorcery spell from among those cards without paying its mana cost.
186. Writ of Return (EDHREC 10770) - Whenever that creature deals combat damage to a player, its controller may cast a copy of the encoded card without paying its mana cost.)
187. Massacre (EDHREC 10874) - If an opponent controls a Plains and you control a Swamp, you may cast this spell without paying its mana cost.
188. Ziatora's Envoy (EDHREC 10893) - You may play a land from the top of your library or cast a spell with mana value less than or equal to the damage dealt from the top of your library without paying its mana cost.
189. Magar of the Magic Strings (EDHREC 10926) - You may cast the copy without paying its mana cost" and "If this creature would leave the battlefield, exile it instead of putting it anywhere else."
190. Spellweaver Helix (EDHREC 11013) - If you do, you may cast the copy without paying its mana cost.
191. Master of Predicaments (EDHREC 11026) - If the player guessed wrong, you may cast the card without paying its mana cost.
192. Seifer Almasy (EDHREC 11173) - Fire Cross — Whenever Seifer Almasy deals combat damage to a player, you may cast target instant or sorcery card with mana value 3 or less from your graveyard without paying its mana cost.
193. Aloy, Savior of Meridian (EDHREC 11219) - Cast it without paying its mana cost or put it into your hand.
194. Panoptic Mirror (EDHREC 11239) - If you do, you may cast the copy without paying its mana cost.
195. Dark Apostle (EDHREC 11279) - You may cast it without paying its mana cost.
196. Shiko, Paragon of the Way (EDHREC 11280) - Copy it, then you may cast the copy without paying its mana cost.
197. Guile (EDHREC 11331) - If a spell or ability you control would counter a spell, instead exile that spell and you may play that card without paying its mana cost.
198. Caparocti Sunborn (EDHREC 11336) - Cast it without paying its mana cost or put it into your hand.
199. Eye of the Storm (EDHREC 11371) - For each copy, the player may cast the copy without paying its mana cost.
200. Saruman of Many Colors (EDHREC 11430) - You may cast the copy without paying its mana cost.

### 18. Modal Choices

Source: corpus-mined follow-on seam
Available after current queue exclusion: 405

1. Jeska's Will (EDHREC 105) - Choose one.
2. Farewell (EDHREC 151) - Choose one or more —
3. Austere Command (EDHREC 165) - Choose two —
4. Akroma's Will (EDHREC 203) - Choose one.
5. Sylvan Library (EDHREC 256) - If you do, choose two cards in your hand drawn this turn.
6. Hullbreaker Horror (EDHREC 269) - Whenever you cast a spell, choose up to one —
7. Return the Favor (EDHREC 748) - Spree (Choose one or more additional costs.)
8. Sheoldred's Edict (EDHREC 1185) - Choose one —
9. Cleansing Nova (EDHREC 1204) - Choose one —
10. Heliod's Intervention (EDHREC 1359) - Choose one —
11. Smuggler's Surprise (EDHREC 1501) - Spree (Choose one or more additional costs.)
12. Crux of Fate (EDHREC 1542) - Choose one —
13. Grenzo, Havoc Raiser (EDHREC 1627) - Whenever a creature you control deals combat damage to a player, choose one —
14. Retreat to Coralhelm (EDHREC 1700) - Landfall — Whenever a land you control enters, choose one —
15. Run Away Together (EDHREC 1718) - Choose two target creatures controlled by different players.
16. Scheming Symmetry (EDHREC 1824) - Choose two target players.
17. Final Showdown (EDHREC 2043) - Spree (Choose one or more additional costs.)
18. Dawn Charm (EDHREC 2072) - Choose one —
19. Perplexing Test (EDHREC 2140) - Choose one —
20. Party Thrasher (EDHREC 2149) - If you do, exile the top two cards of your library, then choose one of them.
21. Split Up (EDHREC 2249) - Choose one —
22. Avatar's Wrath (EDHREC 2371) - Choose up to one target creature, then airbend all other creatures.
23. Twinferno (EDHREC 2520) - Choose one —
24. Simic Charm (EDHREC 2647) - Choose one —
25. Merciless Eviction (EDHREC 2786) - Choose one —
26. Aetheric Amplifier (EDHREC 2818) - {4}, {T}: Choose one.
27. Court of Vantress (EDHREC 2881) - At the beginning of your upkeep, choose up to one other target enchantment or artifact.
28. Savage Beating (EDHREC 3059) - Choose one —
29. See Double (EDHREC 3120) - Choose one.
30. Ertai Resurrected (EDHREC 3133) - When Ertai Resurrected enters, choose up to one —
31. Tiller Engine (EDHREC 3175) - Whenever a land you control enters tapped, choose one —
32. Mob Rule (EDHREC 3249) - Choose one —
33. Sower of Discord (EDHREC 3442) - As this creature enters, choose two players.
34. Pick Your Poison (EDHREC 3457) - Choose one —
35. Crush Contraband (EDHREC 3816) - Choose one or both —
36. Balor (EDHREC 4037) - Whenever this creature attacks or dies, choose one or more.
37. Final Act (EDHREC 4222) - Choose one or more —
38. Subtlety (EDHREC 4456) - When this creature enters, choose up to one target creature spell or planeswalker spell.
39. Rush of Dread (EDHREC 4553) - Spree (Choose one or more additional costs.)
40. Afterlife from the Loam (EDHREC 4626) - For each player, choose up to one target creature card in that player's graveyard.
41. Samwise the Stouthearted (EDHREC 4740) - When Samwise enters, choose up to one target permanent card in your graveyard that was put there from the battlefield this turn.
42. Reverse the Polarity (EDHREC 4772) - Choose one —
43. Profane Command (EDHREC 4824) - Choose two —
44. Brought Back (EDHREC 4846) - Choose up to two target permanent cards in your graveyard that were put there from the battlefield this turn.
45. Scaretiller (EDHREC 5134) - Whenever this creature becomes tapped, choose one —
46. Make an Example (EDHREC 5213) - For each opponent, you choose one of their piles.
47. Greymond, Avacyn's Stalwart (EDHREC 5285) - As Greymond, Avacyn's Stalwart enters, choose two abilities from among first strike, vigilance, and lifelink.
48. Tifa's Limit Break (EDHREC 5425) - Tiered (Choose one additional cost.)
49. Amazing Acrobatics (EDHREC 5603) - Choose one or both —
50. River Song's Diary (EDHREC 5751) - At the beginning of your upkeep, if there are four or more cards exiled with this artifact, choose one of them at random.
51. Defabricate (EDHREC 6027) - Choose one —
52. Get Out (EDHREC 6029) - Choose one —
53. Shifting Grift (EDHREC 6113) - Spree (Choose one or more additional costs.)
54. Opera Love Song (EDHREC 6455) - Choose one —
55. Gaius van Baelsar (EDHREC 6567) - When Gaius van Baelsar enters, choose one —
56. Riveteers Charm (EDHREC 6597) - Choose one —
57. Temur Charm (EDHREC 6879) - Choose one —
58. Kairi, the Swirling Sky (EDHREC 6988) - When Kairi dies, choose one —
59. Captive Audience (EDHREC 7148) - At the beginning of your upkeep, choose one that hasn't been chosen —
60. Thassa's Intervention (EDHREC 7184) - Choose one —
61. Blood on the Snow (EDHREC 7209) - Choose one —
62. Appa, Loyal Sky Bison (EDHREC 7330) - Whenever Appa enters or attacks, choose one —
63. Espers to Magicite (EDHREC 7377) - When you do, choose up to one target creature card exiled this way.
64. Confounding Riddle (EDHREC 7397) - Choose one —
65. Duneblast (EDHREC 7443) - Choose up to one creature.
66. You See a Guard Approach (EDHREC 7553) - Choose one —
67. Soul Manipulation (EDHREC 7733) - Choose one or both —
68. You Look Upon the Tarrasque (EDHREC 7842) - Choose one —
69. Dreamshackle Geist (EDHREC 7846) - At the beginning of combat on your turn, choose up to one —
70. You Come to a River (EDHREC 7855) - Choose one —
71. Orcus, Prince of Undeath (EDHREC 7937) - When Orcus enters, choose one —
72. Insidious Will (EDHREC 8175) - Choose one —
73. Raise the Draugr (EDHREC 8303) - Choose one —
74. Continue? (EDHREC 8319) - Choose up to four target creature cards in your graveyard that were put there from the battlefield this turn.
75. Sakashima's Will (EDHREC 8351) - Choose one.
76. Rustler Rampage (EDHREC 8384) - Spree (Choose one or more additional costs.)
77. Supreme Will (EDHREC 8443) - Choose one —
78. Stick Together (EDHREC 8525) - (To choose a party, choose up to one each of Cleric, Rogue, Warrior, and Wizard.)
79. Tax Collector (EDHREC 8578) - When this creature enters, choose one —
80. Urza's Rebuff (EDHREC 8728) - Choose one —
81. One Last Job (EDHREC 8837) - Spree (Choose one or more additional costs.)
82. Mysterious Stranger (EDHREC 8854) - If two or more cards are exiled this way, choose one of them at random and copy it.
83. Phoenix Down (EDHREC 9093) - {1}{W}, {T}, Exile this artifact: Choose one —
84. Fireglass Mentor (EDHREC 9155) - Choose one of them.
85. Twist Reality (EDHREC 9358) - Choose one —
86. Against All Odds (EDHREC 9389) - Choose one or both —
87. Ghost of Ramirez DePietro (EDHREC 9414) - Whenever Ghost of Ramirez DePietro deals combat damage to a player, choose up to one target card in a graveyard that was discarded or put there from a library this turn.
88. Dream's Grip (EDHREC 9416) - Choose one —
89. Rude Awakening (EDHREC 9463) - Choose one —
90. Hunted by The Family (EDHREC 9615) - Choose up to four target creatures you don't control.
91. Trickery Charm (EDHREC 9648) - Choose one —
92. March of the Drowned (EDHREC 9672) - Choose one —
93. Nightmare Unmaking (EDHREC 9697) - Choose one —
94. Fight as One (EDHREC 9767) - Choose one or both —
95. Invigorated Rampage (EDHREC 9885) - Choose one —
96. Break Down the Door (EDHREC 9977) - Choose one —
97. Road of Return (EDHREC 9978) - Choose one —
98. Ice Magic (EDHREC 10211) - Tiered (Choose one additional cost.)
99. Unbury (EDHREC 10456) - Choose one —
100. Adaptive Sporesinger (EDHREC 10553) - When this creature enters, choose one —
101. Exchange of Words (EDHREC 10643) - When this enchantment enters, choose two target creatures.
102. Heroes' Hangout (EDHREC 10684) - Choose one —
103. Reality Spasm (EDHREC 10781) - Choose one —
104. Storvald, Frost Giant Jarl (EDHREC 10959) - Whenever Storvald enters or attacks, choose one or both —
105. Return from Extinction (EDHREC 11176) - Choose one —
106. Kargan Intimidator (EDHREC 11244) - {1}: Choose one that hasn't been chosen this turn —
107. Alacrian Armory (EDHREC 11263) - At the beginning of combat on your turn, choose up to one target Mount or Vehicle you control.
108. Agrus Kos, Spirit of Justice (EDHREC 11319) - Whenever Agrus Kos enters or attacks, choose up to one target creature.
109. Season of Renewal (EDHREC 11374) - Choose one or both —
110. Family Reunion (EDHREC 11523) - Choose one —
111. Venser, Corpse Puppet (EDHREC 11667) - Whenever you proliferate, choose one —
112. Gravedig (EDHREC 11719) - Choose one —
113. Crisis of Conscience (EDHREC 11806) - Choose one —
114. Aid the Fallen (EDHREC 11840) - Choose one or both —
115. Kitsune Ace (EDHREC 11906) - Whenever a Vehicle you control attacks, choose one —
116. Soul Transfer (EDHREC 12101) - Choose one.
117. Seal of the Guildpact (EDHREC 12152) - As this artifact enters, choose two colors.
118. Bloodline Culling (EDHREC 12161) - Choose one —
119. Seize Opportunity (EDHREC 12166) - Choose one —
120. Secret Identity (EDHREC 12280) - Choose one —
121. Fortuitous Find (EDHREC 12391) - Choose one or both —
122. Metamorphic Blast (EDHREC 12616) - Spree (Choose one or more additional costs.)
123. Radagast, Wizard of Wilds (EDHREC 12866) - Whenever you cast a spell with mana value 5 or greater, choose one —
124. Pharika's Libation (EDHREC 12876) - Choose one —
125. Ghoulcaller's Chant (EDHREC 12897) - Choose one —
126. Wail of the Forgotten (EDHREC 12909) - Descend 8 — Choose one.
127. Flash Thompson, Spider-Fan (EDHREC 12981) - When Flash Thompson enters, choose one or both —
128. Deceiver Exarch (EDHREC 13034) - When this creature enters, choose one —
129. Exterminator Magmarch (EDHREC 13043) - Whenever you cast an instant or sorcery spell that targets only a single nonland permanent an opponent controls, if another opponent controls one or more nonland permanents that spell could target, choose one of those permanents.
130. Deliver Unto Evil (EDHREC 13201) - Choose up to four target cards in your graveyard.
131. Command Performance (EDHREC 13212) - Choose two —
132. Borrowed Hostility (EDHREC 13335) - Choose one or both —
133. Ferocification (EDHREC 13407) - At the beginning of combat on your turn, choose one —
134. Kraul Harpooner (EDHREC 13426) - Undergrowth — When this creature enters, choose up to one target creature you don't control with flying.
135. Magmatic Channeler (EDHREC 13463) - {T}, Discard a card: Exile the top two cards of your library, then choose one of them.
136. Inscription of Insight (EDHREC 13467) - Choose one.
137. Decoy Gambit (EDHREC 13487) - For each opponent, choose up to one target creature that player controls, then return that creature to its owner's hand unless its controller has you draw a card.
138. Poison the Waters (EDHREC 13509) - Choose one —
139. Change the Equation (EDHREC 13670) - Choose one —
140. Blizzard Specter (EDHREC 13859) - Whenever this creature deals combat damage to a player, choose one —
141. Open the Omenpaths (EDHREC 14047) - Choose one —
142. School Daze (EDHREC 14120) - Choose one —
143. Extract the Truth (EDHREC 14171) - Choose one —
144. Angrath's Rampage (EDHREC 14178) - Choose one —
145. Glorfindel, Dauntless Rescuer (EDHREC 14219) - Whenever you scry, choose one and Glorfindel gets +1/+1 until end of turn.
146. Seeker's Folly (EDHREC 14220) - Choose one —
147. You Meet in a Tavern (EDHREC 14274) - Choose one —
148. Bamboozling Beeble (EDHREC 14313) - {1}, {T}: The next time target player would roll one or more dice this turn, instead they roll that many dice plus one and you choose one of those rolls to ignore.
149. Wail of War (EDHREC 14354) - Choose one —
150. Glamer Gifter (EDHREC 14409) - When this creature enters, choose up to one other target creature.
151. Rydia's Return (EDHREC 14433) - Choose one —
152. Bitter Feud (EDHREC 14548) - As this enchantment enters, choose two players.
153. Debt to the Kami (EDHREC 14611) - Choose one —
154. Wild Shape (EDHREC 14625) - Choose one.
155. Glamermite (EDHREC 14641) - When this creature enters, choose one —
156. Early Winter (EDHREC 14660) - Choose one —
157. Sentinel of Lost Lore (EDHREC 14728) - When this creature enters, choose one or more —
158. Ojutai Exemplars (EDHREC 15017) - Whenever you cast a noncreature spell, choose one —
159. Grim Discovery (EDHREC 15051) - Choose one or both —
160. Soul Read (EDHREC 15232) - Choose one —
161. Damage Control Crew (EDHREC 15238) - When this creature enters, choose one —
162. Sapphire Charm (EDHREC 15321) - Choose one —
163. Expose the Culprit (EDHREC 15365) - Choose one or both —
164. Timebender (EDHREC 15413) - When this creature is turned face up, choose one —
165. Inspired Inventor (EDHREC 15439) - When this creature enters, choose one —
166. Dust of Moments (EDHREC 15470) - Choose one —
167. Retreat to Valakut (EDHREC 15480) - Landfall — Whenever a land you control enters, choose one —
168. Oracle of Tragedy (EDHREC 15484) - When this creature enters or dies, choose one —
169. Grixis Charm (EDHREC 15492) - Choose one —
170. Settle Beyond Reality (EDHREC 15498) - Choose one or both —
171. You're Confronted by Robbers (EDHREC 15502) - Choose one —
172. Remember the Fallen (EDHREC 15681) - Choose one or both —
173. Witherbloom Charm (EDHREC 15833) - Choose one —
174. Storyweave (EDHREC 16026) - Choose one —
175. Incriminate (EDHREC 16129) - Choose two target creatures controlled by the same player.
176. Feldon, Ronom Excavator (EDHREC 16202) - Choose one of them.
177. Aether Shockwave (EDHREC 16253) - Choose one —
178. Applied Biomancy (EDHREC 16297) - Choose one or both —
179. Prismari Charm (EDHREC 16333) - Choose one —
180. Cerebral Confiscation (EDHREC 16505) - Choose one —
181. Atomic Microsizer (EDHREC 16542) - Whenever equipped creature attacks, choose up to one target creature.
182. Blessed Alliance (EDHREC 16556) - Choose one or more —
183. Disciple of the Ring (EDHREC 16619) - {1}, Exile an instant or sorcery card from your graveyard: Choose one —
184. Temporal Cascade (EDHREC 16665) - Choose one —
185. Daily Bugle Reporters (EDHREC 16739) - When this creature enters, choose one —
186. Cemetery Desecrator (EDHREC 16755) - When you do, choose one —
187. Auntie's Sentence (EDHREC 16803) - Choose one —
188. You Come to the Gnoll Camp (EDHREC 17233) - Choose one —
189. Brigid's Command (EDHREC 17253) - Choose two —
190. Baleful Beholder (EDHREC 17354) - When this creature enters, choose one —
191. Funeral Charm (EDHREC 17372) - Choose one —
192. Taster of Wares (EDHREC 17426) - You choose one of those cards.
193. Entomber Exarch (EDHREC 17541) - When this creature enters, choose one —
194. Sudden Salvation (EDHREC 17558) - Choose up to three target permanent cards in graveyards that were put there from the battlefield this turn.
195. Depth Defiler (EDHREC 17623) - When you cast this spell, choose one.
196. Repel the Vile (EDHREC 17636) - Choose one —
197. Confront the Past (EDHREC 17674) - Choose one —
198. Sygg's Command (EDHREC 17728) - Choose two —
199. Graceful Restoration (EDHREC 17783) - Choose one —
200. Lorehold Charm (EDHREC 17804) - Choose one —

### 19. Reveal / Look At Top Library Cards

Source: corpus-mined follow-on seam
Available after current queue exclusion: 785

1. Path of Ancestry (EDHREC 14) - (Look at the top card of your library.
2. Herald's Horn (EDHREC 139) - At the beginning of your upkeep, look at the top card of your library.
3. Mosswort Bridge (EDHREC 193) - Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)
4. Temple of Epiphany (EDHREC 267) - (Look at the top card of your library.
5. Temple of Silence (EDHREC 272) - (Look at the top card of your library.
6. Temple of Triumph (EDHREC 287) - (Look at the top card of your library.
7. Temple of Mystery (EDHREC 294) - (Look at the top card of your library.
8. Temple of Enlightenment (EDHREC 295) - (Look at the top card of your library.
9. Temple of Deceit (EDHREC 313) - (Look at the top card of your library.
10. Temple of Malady (EDHREC 345) - (Look at the top card of your library.
11. Temple of Malice (EDHREC 400) - (Look at the top card of your library.
12. Thassa's Oracle (EDHREC 402) - When this creature enters, look at the top X cards of your library, where X is your devotion to blue.
13. Mystic Forge (EDHREC 426) - You may look at the top card of your library any time.
14. Undercity Sewers (EDHREC 433) - (Look at the top card of your library.
15. Temple of Plenty (EDHREC 466) - (Look at the top card of your library.
16. Temple of Abandon (EDHREC 468) - (Look at the top card of your library.
17. Underground Mortuary (EDHREC 473) - (Look at the top card of your library.
18. Hedge Maze (EDHREC 539) - (Look at the top card of your library.
19. Raucous Theater (EDHREC 557) - (Look at the top card of your library.
20. Shadowy Backstreet (EDHREC 560) - (Look at the top card of your library.
21. Realmwalker (EDHREC 598) - You may look at the top card of your library any time.
22. Dig Through Time (EDHREC 625) - Look at the top seven cards of your library.
23. Thundering Falls (EDHREC 635) - (Look at the top card of your library.
24. Commercial District (EDHREC 637) - (Look at the top card of your library.
25. Windbrisk Heights (EDHREC 641) - Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)
26. Fact or Fiction (EDHREC 642) - Reveal the top five cards of your library.
27. Lush Portico (EDHREC 699) - (Look at the top card of your library.
28. Meticulous Archive (EDHREC 703) - (Look at the top card of your library.
29. Aqueous Form (EDHREC 716) - (Look at the top card of your library.
30. Spinerock Knoll (EDHREC 739) - Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)
31. Elegant Parlor (EDHREC 786) - (Look at the top card of your library.
32. Narset, Parter of Veils (EDHREC 861) - −2: Look at the top four cards of your library.
33. Expressive Iteration (EDHREC 951) - Look at the top three cards of your library.
34. The Reality Chip (EDHREC 959) - You may look at the top card of your library any time.
35. Loot, Exuberant Explorer (EDHREC 981) - {4}{G}{G}, {T}: Look at the top six cards of your library.
36. Augur of Autumn (EDHREC 1091) - You may look at the top card of your library any time.
37. Halimar Depths (EDHREC 1240) - When this land enters, look at the top three cards of your library, then put them back in any order.
38. Grisly Salvage (EDHREC 1284) - Reveal the top five cards of your library.
39. Case of the Locked Hothouse (EDHREC 1285) - Solved — You may look at the top card of your library any time, and you may play lands and cast creature and enchantment spells from the top of your library.
40. Elven Chorus (EDHREC 1290) - You may look at the top card of your library any time.
41. Experimental Augury (EDHREC 1309) - Look at the top three cards of your library.
42. Kinnan, Bonder Prodigy (EDHREC 1354) - {5}{G}{U}: Look at the top five cards of your library.
43. Scroll Rack (EDHREC 1391) - Then look at the exiled cards and put them on top of your library in any order.
44. Genesis Wave (EDHREC 1404) - Reveal the top X cards of your library.
45. Arid Archway (EDHREC 1429) - (Look at the top card of your library.
46. Monumental Henge (EDHREC 1498) - {2}{W}{W}, {T}: Look at the top five cards of your library.
47. Planar Genesis (EDHREC 1502) - Look at the top four cards of your library.
48. Shigeki, Jukai Visionary (EDHREC 1608) - {1}{G}, {T}, Return Shigeki to its owner's hand: Reveal the top four cards of your library.
49. Fomori Vault (EDHREC 1618) - {3}, {T}, Discard a card: Look at the top X cards of your library, where X is the number of artifacts you control.
50. Satyr Wayfinder (EDHREC 1662) - When this creature enters, reveal the top four cards of your library.
51. Retreat to Coralhelm (EDHREC 1700) - (Look at the top card of your library.
52. Doom Whisperer (EDHREC 1779) - (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)
53. Dragon's Rage Channeler (EDHREC 1800) - (Look at the top card of your library.
54. Sonic Screwdriver (EDHREC 1810) - (Look at the top card of your library.
55. Sunbird's Invocation (EDHREC 1837) - Whenever you cast a spell from your hand, reveal the top X cards of your library, where X is that spell's mana value.
56. Gonti, Lord of Luxury (EDHREC 1853) - When Gonti enters, look at the top four cards of target opponent's library, exile one of them face down, then put the rest on the bottom of that library in a random order.
57. One with the Multiverse (EDHREC 1892) - You may look at the top card of your library any time.
58. Conduit Pylons (EDHREC 1928) - (Look at the top card of your library.
59. Crystal Skull, Isu Spyglass (EDHREC 1972) - You may look at the top card of your library any time.
60. The Key to the Vault (EDHREC 2055) - Whenever equipped creature deals combat damage to a player, look at that many cards from the top of your library.
61. Eladamri, Korvecdal (EDHREC 2088) - You may look at the top card of your library any time.
62. Risen Reef (EDHREC 2188) - Whenever this creature or another Elemental you control enters, look at the top card of your library.
63. Icon of Ancestry (EDHREC 2192) - {3}, {T}: Look at the top three cards of your library.
64. Explorer's Scope (EDHREC 2207) - Whenever equipped creature attacks, look at the top card of your library.
65. Traveling Chocobo (EDHREC 2232) - You may look at the top card of your library any time.
66. Lim-Dûl's Vault (EDHREC 2272) - Look at the top five cards of your library.
67. Thrumming Stone (EDHREC 2287) - (Whenever you cast a spell, you may reveal the top four cards of your library.
68. Faerie Seer (EDHREC 2362) - (Look at the top two cards of your library, then put any number of them on the bottom and the rest on top in any order.)
69. Hidden Grotto (EDHREC 2396) - (Look at the top card of your library.
70. Weatherlight (EDHREC 2409) - Whenever Weatherlight deals combat damage to a player, look at the top five cards of your library.
71. Stock Up (EDHREC 2466) - Look at the top five cards of your library.
72. Impulse (EDHREC 2529) - Look at the top four cards of your library.
73. Zhalfirin Void (EDHREC 2578) - (Look at the top card of your library.
74. Heroes' Podium (EDHREC 2581) - {X}, {T}: Look at the top X cards of your library.
75. Cemetery Tampering (EDHREC 2640) - Hideaway 5 (When this enchantment enters, look at the top five cards of your library, exile one face down, then put the rest on the bottom in a random order.)
76. Adaptive Omnitool (EDHREC 2645) - Whenever equipped creature attacks, look at the top six cards of your library.
77. Armored Skyhunter (EDHREC 2668) - Whenever this creature attacks, look at the top six cards of your library.
78. Ureni of the Unwritten (EDHREC 2778) - Whenever Ureni enters or attacks, look at the top eight cards of your library.
79. Fecund Greenshell (EDHREC 2859) - Whenever this creature or another creature you control with toughness greater than its power enters, look at the top card of your library.
80. Thief of Sanity (EDHREC 2957) - Whenever this creature deals combat damage to a player, look at the top three cards of that player's library, exile one of them face down, then put the rest into their graveyard.
81. Animist's Awakening (EDHREC 3158) - Reveal the top X cards of your library.
82. Sigarda, Font of Blessings (EDHREC 3201) - You may look at the top card of your library any time.
83. Aetherworks Marvel (EDHREC 3257) - {T}, Pay six {E}: Look at the top six cards of your library.
84. Karumonix, the Rat King (EDHREC 3296) - When Karumonix enters, look at the top five cards of your library.
85. Florian, Voldaren Scion (EDHREC 3339) - At the beginning of each of your postcombat main phases, look at the top X cards of your library, where X is the total amount of life your opponents lost this turn.
86. Korlessa, Scale Singer (EDHREC 3419) - You may look at the top card of your library any time.
87. Atraxa, Grand Unifier (EDHREC 3423) - When Atraxa enters, reveal the top ten cards of your library.
88. Satoru Umezawa (EDHREC 3438) - Whenever you activate a ninjutsu ability, look at the top three cards of your library.
89. Vivien, Champion of the Wilds (EDHREC 3557) - −2: Look at the top three cards of your library.
90. Glarb, Calamity's Augur (EDHREC 3677) - You may look at the top card of your library any time.
91. Genesis Ultimatum (EDHREC 3699) - Look at the top five cards of your library.
92. Sleight of Hand (EDHREC 3936) - Look at the top two cards of your library.
93. Fortune Teller's Talent (EDHREC 3943) - You may look at the top card of your library any time.
94. Horn of the Mark (EDHREC 3958) - Whenever two or more creatures you control attack a player, look at the top five cards of your library.
95. Thundermane Dragon (EDHREC 3972) - You may look at the top card of your library any time.
96. Muxus, Goblin Grandee (EDHREC 4004) - When Muxus enters, reveal the top six cards of your library.
97. Rumble Arena (EDHREC 4030) - (Look at the top card of your library.
98. Teferi, Temporal Archmage (EDHREC 4120) - +1: Look at the top two cards of your library.
99. Goblin Ringleader (EDHREC 4244) - When this creature enters, reveal the top four cards of your library.
100. Vizier of the Menagerie (EDHREC 4247) - You may look at the top card of your library any time.
101. Consult the Star Charts (EDHREC 4328) - Look at the top X cards of your library, where X is the number of lands you control.
102. Titan's Strength (EDHREC 4388) - (Look at the top card of your library.
103. Fblthp, Lost on the Range (EDHREC 4392) - You may look at the top card of your library any time.
104. Assemble the Players (EDHREC 4409) - You may look at the top card of your library any time.
105. Mulch (EDHREC 4443) - Reveal the top four cards of your library.
106. Astor, Bearer of Blades (EDHREC 4536) - When Astor enters, look at the top seven cards of your library.
107. Calix, Destiny's Hand (EDHREC 4579) - +1: Look at the top four cards of your library.
108. Mission Briefing (EDHREC 4630) - (To surveil 2, look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)
109. Sarinth Steelseeker (EDHREC 4674) - Whenever an artifact you control enters, look at the top card of your library.
110. Elvish Rejuvenator (EDHREC 4726) - When this creature enters, look at the top five cards of your library.
111. Expand the Sphere (EDHREC 4746) - Look at the top six cards of your library.
112. Gathering Stone (EDHREC 4759) - When this artifact enters and at the beginning of your upkeep, look at the top card of your library.
113. Winota, Joiner of Forces (EDHREC 4796) - Whenever a non-Human creature you control attacks, look at the top six cards of your library.
114. Twilight Diviner (EDHREC 4856) - (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)
115. Snarling Gorehound (EDHREC 4911) - (Look at the top card of your library.
116. Sauron's Ransom (EDHREC 4923) - They look at the top four cards of your library and separate them into a face-down pile and a face-up pile.
117. Quandrix Campus (EDHREC 4964) - (Look at the top card of your library.
118. Djeru and Hazoret (EDHREC 4977) - Whenever Djeru and Hazoret attacks, look at the top six cards of your library.
119. Omnath, Locus of All (EDHREC 5061) - At the beginning of your first main phase, look at the top card of your library.
120. Aminatou, Veil Piercer (EDHREC 5081) - (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)
121. Green Sun's Twilight (EDHREC 5160) - Reveal the top X plus one cards of your library.
122. Planetarium of Wan Shi Tong (EDHREC 5191) - Whenever you scry or surveil, look at the top card of your library.
123. Nymris, Oona's Trickster (EDHREC 5271) - Whenever you cast your first spell during each opponent's turn, look at the top two cards of your library.
124. Kishla Village (EDHREC 5328) - (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)
125. Seismic Sense (EDHREC 5334) - Look at the top X cards of your library, where X is the number of lands you control.
126. Gallifrey Council Chamber (EDHREC 5335) - (Look at the top card of your library.
127. Telling Time (EDHREC 5367) - Look at the top three cards of your library.
128. Freestrider Lookout (EDHREC 5377) - Whenever you commit a crime, look at the top five cards of your library.
129. Verge Rangers (EDHREC 5464) - You may look at the top card of your library any time.
130. Gilgamesh, Master-at-Arms (EDHREC 5485) - Whenever Gilgamesh enters or attacks, look at the top six cards of your library.
131. Majestic Genesis (EDHREC 5631) - Reveal the top X cards of your library, where X is the greatest mana value of a commander you own on the battlefield or in the command zone.
132. Artificer's Assistant (EDHREC 5632) - To scry 1, look at the top card of your library, then you may put that card on the bottom.)
133. Stargaze (EDHREC 5664) - Look at twice X cards from the top of your library.
134. Kamahl's Druidic Vow (EDHREC 5670) - Look at the top X cards of your library.
135. Enhanced Surveillance (EDHREC 5707) - You may look at an additional two cards each time you surveil. Exile this enchantment: Shuffle your graveyard into your library.
136. Into the Pit (EDHREC 5718) - You may look at the top card of your library any time.
137. Blightwing Bandit (EDHREC 5727) - Whenever you cast your first spell during each opponent's turn, look at the top card of that player's library, then exile it face down.
138. Cavalier of Thorns (EDHREC 5737) - When this creature enters, reveal the top five cards of your library.
139. Tocasia's Dig Site (EDHREC 5745) - (Look at the top card of your library.
140. Clive's Hideaway (EDHREC 5781) - Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)
141. Abhorrent Oculus (EDHREC 5815) - (Look at the top two cards of your library.
142. Zimone, Mystery Unraveler (EDHREC 5824) - (To manifest dread, look at the top two cards of your library.
143. Hauntwoods Shrieker (EDHREC 5837) - (Look at the top two cards of your library.
144. Perception Bobblehead (EDHREC 5846) - {3}, {T}: Look at the top X cards of your library, where X is the number of Bobbleheads you control.
145. Evercoat Ursine (EDHREC 5888) - Hideaway 3, hideaway 3 (When this creature enters, look at the top three cards of your library, exile one face down, then put the rest on the bottom in a random order.
146. Dream-Thief's Bandana (EDHREC 5904) - Whenever equipped creature deals combat damage to a player, look at the top card of their library, then exile it face down.
147. Archghoul of Thraben (EDHREC 5906) - Whenever this creature or another Zombie you control dies, look at the top card of your library.
148. Dissolve (EDHREC 5934) - (Look at the top card of your library.
149. Don't Make a Sound (EDHREC 5937) - (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)
150. See the Truth (EDHREC 5972) - Look at the top three cards of your library.
151. Prismari Campus (EDHREC 5985) - (Look at the top card of your library.
152. Mm'menon, the Right Hand (EDHREC 6008) - You may look at the top card of your library any time.
153. Sinister Sabotage (EDHREC 6038) - (Look at the top card of your library.
154. Lapis Orb of Dragonkind (EDHREC 6114) - (Look at the top two cards of your library, then put any number of them on the bottom and the rest on top in any order.)
155. Adéwalé, Breaker of Chains (EDHREC 6117) - When Adéwalé enters, reveal the top six cards of your library.
156. Anticipate (EDHREC 6134) - Look at the top three cards of your library.
157. Nissa, Steward of Elements (EDHREC 6186) - 0: Look at the top card of your library.
158. Elsha of the Infinite (EDHREC 6193) - You may look at the top card of your library any time.
159. Xanathar, Guild Kingpin (EDHREC 6223) - Until end of turn, that player can't cast spells, you may look at the top card of their library any time, you may play the top card of their library, and you may spend mana as though it were mana of any color to cast spells this way.
160. Acclaimed Contender (EDHREC 6269) - When this creature enters, if you control another Knight, look at the top five cards of your library.
161. Laser Screwdriver (EDHREC 6296) - (Look at the top card of your library.
162. Dogged Detective (EDHREC 6392) - (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)
163. Lydia Frye (EDHREC 6499) - (Look at the top X cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)
164. Master of Death (EDHREC 6506) - (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)
165. Condescend (EDHREC 6511) - (Look at the top two cards of your library, then put any number of them on the bottom and the rest on top in any order.)
166. Dragonlord Ojutai (EDHREC 6577) - Whenever Dragonlord Ojutai deals combat damage to a player, look at the top three cards of your library.
167. Accumulate Wisdom (EDHREC 6584) - Look at the top three cards of your library.
168. Kaalia, Zenith Seeker (EDHREC 6629) - When Kaalia enters, look at the top six cards of your library.
169. Choco, Seeker of Paradise (EDHREC 6658) - Whenever one or more Birds you control attack, look at that many cards from the top of your library.
170. Boromir, Gondor's Hope (EDHREC 6662) - Whenever Boromir enters or attacks, look at the top six cards of your library.
171. Cream of the Crop (EDHREC 6672) - Whenever a creature you control enters, you may look at the top X cards of your library, where X is that creature's power.
172. Silverquill Campus (EDHREC 6682) - (Look at the top card of your library.
173. Carth the Lion (EDHREC 6709) - Whenever Carth enters or a planeswalker you control dies, look at the top seven cards of your library.
174. Owlbear Cub (EDHREC 6764) - Mama's Coming — Whenever this creature attacks a player who controls eight or more lands, look at the top eight cards of your library.
175. Parcelbeast (EDHREC 6766) - {1}, {T}: Look at the top card of your library.
176. Falco Spara, Pactweaver (EDHREC 6771) - You may look at the top card of your library any time.
177. Mirri's Guile (EDHREC 6838) - At the beginning of your upkeep, you may look at the top three cards of your library, then put them back in any order.
178. Nightveil Sprite (EDHREC 6858) - (Look at the top card of your library.
179. Vendilion Clique (EDHREC 6868) - Flash Flying When Vendilion Clique enters, look at target player's hand. You may choose a nonland card from it. If you do, that player reveals the chosen card, puts it on the bottom of their library, then draws a card.
180. Dragonologist (EDHREC 6930) - When this creature enters, look at the top six cards of your library.
181. Crystal Ball (EDHREC 7123) - (Look at the top two cards of your library, then put any number of them on the bottom and the rest on top in any order.)
182. Fading Hope (EDHREC 7164) - (Look at the top card of your library.
183. Conjurer's Mantle (EDHREC 7177) - Whenever equipped creature attacks, look at the top six cards of your library.
184. Thassa's Intervention (EDHREC 7184) - • Look at the top X cards of your library.
185. Wall of Runes (EDHREC 7201) - (Look at the top card of your library.
186. Summoning Materia (EDHREC 7238) - You may look at the top card of your library any time.
187. Watcher for Tomorrow (EDHREC 7259) - Hideaway 4 (When this creature enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)
188. Gonti, Canny Acquisitor (EDHREC 7274) - Whenever one or more creatures you control deal combat damage to a player, look at the top card of that player's library, then exile it face down.
189. Sea Gate Oracle (EDHREC 7298) - When this creature enters, look at the top two cards of your library.
190. Diabolic Vision (EDHREC 7315) - Look at the top five cards of your library.
191. Radha, Heart of Keld (EDHREC 7323) - You may look at the top card of your library any time, and you may play lands from the top of your library.
192. Confounding Riddle (EDHREC 7397) - • Look at the top four cards of your library.
193. Oath of Nissa (EDHREC 7421) - When Oath of Nissa enters, look at the top three cards of your library.
194. Nine-Fingers Keene (EDHREC 7455) - Whenever Nine-Fingers Keene deals combat damage to a player, look at the top nine cards of your library.
195. Firja, Judge of Valor (EDHREC 7497) - Whenever you cast your second spell each turn, look at the top three cards of your library.
196. Strategic Planning (EDHREC 7573) - Look at the top three cards of your library.
197. Witherbloom Campus (EDHREC 7607) - (Look at the top card of your library.
198. Nessian Wanderer (EDHREC 7614) - Constellation — Whenever an enchantment you control enters, look at the top three cards of your library.
199. Silver Raven (EDHREC 7617) - (Look at the top card of your library.
200. Errant and Giada (EDHREC 7665) - You may look at the top card of your library any time.

### 20. Attach / Equip / Aura Movement

Source: corpus-mined follow-on seam
Available after current queue exclusion: 432

1. Swiftfoot Boots (EDHREC 12) - Equip {1} ({1}: Attach to target creature you control.
2. Lightning Greaves (EDHREC 13) - Equip {0}
3. Mithril Coat (EDHREC 241) - When Mithril Coat enters, attach it to target legendary creature you control.
4. Whispersilk Cloak (EDHREC 316) - Equip {2}
5. Blackblade Reforged (EDHREC 329) - Equip {7}
6. Shadowspear (EDHREC 331) - Equip {2}
7. Commander's Plate (EDHREC 534) - Equip {5}
8. Sword of Feast and Famine (EDHREC 538) - Equip {2}
9. Brotherhood Regalia (EDHREC 569) - Equip {3} ({3}: Attach to target creature you control.
10. Trailblazer's Boots (EDHREC 681) - Equip {2}
11. Hammer of Nazahn (EDHREC 798) - Whenever Hammer of Nazahn or another Equipment you control enters, you may attach that Equipment to target creature you control.
12. Champion's Helm (EDHREC 810) - Equip {1}
13. Sigarda's Aid (EDHREC 869) - Whenever an Equipment you control enters, you may attach it to target creature you control.
14. Colossus Hammer (EDHREC 910) - Equip {8} ({8}: Attach to target creature you control.
15. Loxodon Warhammer (EDHREC 917) - Equip {3}
16. Darksteel Plate (EDHREC 987) - Equip {2}
17. Fireshrieker (EDHREC 1047) - Equip {2} ({2}: Attach to target creature you control.
18. Lavaspur Boots (EDHREC 1293) - Equip {1}
19. Embercleave (EDHREC 1313) - When Embercleave enters, attach it to target creature you control.
20. Caduceus, Staff of Hermes (EDHREC 1443) - Equip {W}{W}
21. Thran Power Suit (EDHREC 1481) - Equip {2} ({2}: Attach to target creature you control.
22. Conqueror's Flail (EDHREC 1508) - Equip {2}
23. Sword of Vengeance (EDHREC 1513) - Equip {3}
24. Codsworth, Handy Helper (EDHREC 1520) - {T}: Attach target Aura or Equipment you control to target creature you control.
25. Genji Glove (EDHREC 1523) - Equip {3}
26. Illusionist's Bracers (EDHREC 1533) - Equip {3}
27. Sting, the Glinting Dagger (EDHREC 1550) - Equip {2}
28. Leyline Axe (EDHREC 1551) - Equip {3} ({3}: Attach to target creature you control.
29. Kaldra Compleat (EDHREC 1643) - Equip {7}
30. Ardenn, Intrepid Archaeologist (EDHREC 1651) - At the beginning of combat on your turn, you may attach any number of Auras and Equipment you control to target permanent or player.
31. Bloodforged Battle-Axe (EDHREC 1654) - Equip {2}
32. Winged Boots (EDHREC 1754) - Equip {1}
33. Sword of Forge and Frontier (EDHREC 1809) - Equip {2}
34. Silver Shroud Costume (EDHREC 1828) - When this Equipment enters, attach it to target creature you control.
35. Paradise Mantle (EDHREC 1930) - Equip {1}
36. Hero's Blade (EDHREC 1941) - Equip {4} ({4}: Attach to target creature you control.
37. The Key to the Vault (EDHREC 2055) - Equip {2}{U}
38. Haunted Cloak (EDHREC 2081) - Equip {1} ({1}: Attach to target creature you control.
39. Explorer's Scope (EDHREC 2207) - Equip {1} ({1}: Attach to target creature you control.
40. Bloodthirsty Blade (EDHREC 2247) - {1}: Attach this Equipment to target creature an opponent controls.
41. Cranial Plating (EDHREC 2259) - {B}{B}: Attach this Equipment to target creature you control.
42. Umbral Mantle (EDHREC 2381) - Equip {0}
43. Dragonfire Blade (EDHREC 2518) - Equip {4}.
44. Quietus Spike (EDHREC 2592) - Equip {3}
45. Brass Squire (EDHREC 2629) - {T}: Attach target Equipment you control to target creature you control.
46. Adaptive Omnitool (EDHREC 2645) - Equip {3}
47. Vorpal Sword (EDHREC 2674) - Equip {B}{B}
48. Robe of Stars (EDHREC 2925) - Equip {1}
49. Prowler's Helm (EDHREC 3227) - Equip {2}
50. The Irencrag (EDHREC 3602) - If you do, it gains equip {3} and "Equipped creature gets +3/+3" and loses all other abilities.
51. Celestial Armor (EDHREC 3629) - When this Equipment enters, attach it to target creature you control.
52. Heirloom Blade (EDHREC 3650) - Equip {1}
53. Wrecking Ball Arm (EDHREC 3678) - Equip {7}
54. Aettir and Priwen (EDHREC 3722) - Equip {5}
55. Behemoth Sledge (EDHREC 3755) - Equip {3}
56. Maul of the Skyclaves (EDHREC 3813) - When this Equipment enters, attach it to target creature you control.
57. Mask of Avacyn (EDHREC 3821) - Equip {3}
58. Nazgûl Battle-Mace (EDHREC 3926) - Equip {3}
59. Assault Suit (EDHREC 4077) - Equip {3}
60. Luxior, Giada's Gift (EDHREC 4197) - Equip {3}
61. Hero's Heirloom (EDHREC 4215) - Equip {2}
62. The Masamune (EDHREC 4228) - Equip {2}
63. Inquisitor's Flail (EDHREC 4258) - Equip {2}
64. Sword of the Squeak (EDHREC 4387) - Equip {2}
65. Helm of the Gods (EDHREC 4480) - Equip {1} ({1}: Attach to target creature you control.
66. Sword of Once and Future (EDHREC 4483) - Equip {2}
67. Short Bow (EDHREC 4525) - Equip {1} ({1}: Attach to target creature you control.
68. Astor, Bearer of Blades (EDHREC 4536) - Equipment you control have equip {1}.
69. Pariah's Shield (EDHREC 4723) - Equip {3}
70. Brass Knuckles (EDHREC 4829) - Equip {1} ({1}: Attach to target creature you control.
71. Mirror Shield (EDHREC 5049) - Equip {2} ({2}: Attach to target creature you control.
72. Battlemage's Bracers (EDHREC 5121) - Equip {2}
73. Stoneforge Masterwork (EDHREC 5161) - Equip {2}
74. Tenza, Godo's Maul (EDHREC 5263) - Equip {1} ({1}: Attach to target creature you control.
75. Sword of the Paruns (EDHREC 5270) - Equip {3}
76. Hidden Blade (EDHREC 5402) - When this Equipment enters, attach it to target creature you control.
77. Crown of Gondor (EDHREC 5537) - Equip {4}.
78. Glamdring (EDHREC 5615) - Equip {3}
79. Vorrac Battlehorns (EDHREC 5622) - Equip {1} ({1}: Attach to target creature you control.
80. Cloak of the Bat (EDHREC 5709) - Equip {2} ({2}: Attach to target creature you control.
81. Gorgon's Head (EDHREC 5757) - Equip {2}
82. Dream-Thief's Bandana (EDHREC 5904) - Equip {1}
83. Cliffhaven Kitesail (EDHREC 6046) - When this Equipment enters, attach it to target creature you control.
84. Psychic Paper (EDHREC 6161) - As this Equipment becomes attached to a creature, choose a creature card name and a creature type.
85. Pre-War Formalwear (EDHREC 6237) - Equip {3}
86. Magnetic Theft (EDHREC 6677) - Attach target Equipment to target creature.
87. Accorder's Shield (EDHREC 6721) - Equip {3} ({3}: Attach to target creature you control.
88. Belt of Giant Strength (EDHREC 6729) - Equip {10}.
89. Dragon Throne of Tarkir (EDHREC 6810) - Equip {3}
90. Nuka-Nuke Launcher (EDHREC 6817) - Equip {3}
91. Bone Saw (EDHREC 6832) - Equip {1} ({1}: Attach to target creature you control.
92. Multiclass Baldric (EDHREC 6835) - Equip {2}
93. O-Naginata (EDHREC 6910) - Equip {2} ({2}: Attach to target creature you control.
94. Adventuring Gear (EDHREC 6992) - Equip {1} ({1}: Attach to target creature you control.
95. Hunter's Blowgun (EDHREC 7003) - Equip {2} ({2}: Attach to target creature you control.
96. Nemesis Mask (EDHREC 7033) - Equip {3} ({3}: Attach to target creature you control.
97. Sword of the Meek (EDHREC 7098) - Equip {2}
98. Golem-Skin Gauntlets (EDHREC 7135) - Equip {2} ({2}: Attach to target creature you control.
99. Conjurer's Mantle (EDHREC 7177) - Equip {1}
100. Summoning Materia (EDHREC 7238) - Equip {2}
101. Felidar Umbra (EDHREC 7304) - {1}{W}: Attach this Aura to target creature you control.
102. Barrow-Blade (EDHREC 7333) - Equip {1} ({1}: Attach to target creature you control.
103. Cathar's Shield (EDHREC 7430) - Equip {3} ({3}: Attach to target creature you control.
104. Chariot of Victory (EDHREC 7513) - Equip {1}
105. Forebear's Blade (EDHREC 7729) - Whenever equipped creature dies, attach this Equipment to target creature you control.
106. Godsend (EDHREC 7800) - Equip {3}
107. Sigil of Valor (EDHREC 8208) - Equip {1} ({1}: Attach to target creature you control.
108. Blue Mage's Cane (EDHREC 8217) - Spirit of the Whalaqee — Equip {2}
109. Plate Armor (EDHREC 8338) - Equip {3}.
110. Worldslayer (EDHREC 8345) - Equip {5} ({5}: Attach to target creature you control.
111. Summoner's Grimoire (EDHREC 8364) - Abraxas — Equip {3}
112. Quick-Draw Katana (EDHREC 8413) - Equip {2} ({2}: Attach to target creature you control.
113. Trepanation Blade (EDHREC 8569) - Equip {2}
114. Mabel, Heir to Cragflame (EDHREC 8600) - When Mabel enters, create Cragflame, a legendary colorless Equipment artifact token with "Equipped creature gets +1/+1 and has vigilance, trample, and haste" and equip {2}.
115. Eater of Virtue (EDHREC 8762) - Equip {1}
116. Spidersilk Net (EDHREC 8857) - Equip {2} ({2}: Attach to target creature you control.
117. Sword of Kaldra (EDHREC 8885) - Equip {4} ({4}: Attach to target creature you control.
118. Prosthetic Injector (EDHREC 9045) - Equip {1}
119. Beatrix, Loyal General (EDHREC 9063) - At the beginning of combat on your turn, you may attach any number of Equipment you control to target creature you control.
120. Meteoric Mace (EDHREC 9102) - Equip {4}
121. Empyrial Plate (EDHREC 9110) - Equip {2}
122. Gorgon Flail (EDHREC 9170) - Equip {2} ({2}: Attach to target creature you control.
123. Holy Avenger (EDHREC 9182) - Equip {2}{W}
124. Phantom Blade (EDHREC 9480) - Equip {2}
125. Hand of Vecna (EDHREC 9498) - Equip {2}
126. Boots of Speed (EDHREC 9514) - Equip {1} ({1}: Attach to target creature you control.
127. Assimilation Aegis (EDHREC 9577) - Whenever this Equipment becomes attached to a creature, for as long as this Equipment remains attached to it, that creature becomes a copy of a creature card exiled with this Equipment.
128. Fleetfeather Sandals (EDHREC 9625) - Equip {2} ({2}: Attach to target creature you control.
129. Grappling Hook (EDHREC 9663) - Equip {4}
130. Cloak and Dagger (EDHREC 9693) - Equip {3}
131. Hot Soup (EDHREC 9705) - Equip {3} ({3}: Attach to target creature you control.
132. Runechanter's Pike (EDHREC 9775) - Equip {2}
133. Doc Ock's Tentacles (EDHREC 9802) - Equip {5}
134. Glider Staff (EDHREC 9809) - Equip {2}
135. Deathrender (EDHREC 10230) - Equip {2}
136. Leather Armor (EDHREC 10279) - Equip {0}.
137. Gimli's Axe (EDHREC 10361) - Equip {2} ({2}: Attach to target creature you control.
138. Icingdeath, Frost Tyrant (EDHREC 10415) - When Icingdeath, Frost Tyrant dies, create Icingdeath, Frost Tongue, a legendary white Equipment artifact token with "Equipped creature gets +2/+0," "Whenever equipped creature attacks, tap target creature defending player controls," and equip {2}.
139. Hookblade (EDHREC 10446) - When this Equipment enters, attach it to target creature you control.
140. Hidden Footblade (EDHREC 10657) - When this Equipment enters, attach it to target creature you control.
141. Skyclave Pick-Axe (EDHREC 10724) - When this Equipment enters, attach it to target creature you control.
142. Shield of Kaldra (EDHREC 10794) - Equip {4}
143. Bonesplitter (EDHREC 10804) - Equip {1}
144. Biorganic Carapace (EDHREC 10815) - When this Equipment enters, attach it to target creature you control.
145. Konda's Banner (EDHREC 10869) - Equip {2}
146. The Dominion Bracelet (EDHREC 10945) - Equip {1}
147. Cobbled Wings (EDHREC 11183) - Equip {1} ({1}: Attach to target creature you control.
148. Ace's Baseball Bat (EDHREC 11287) - Equip {3}
149. Kite Shield (EDHREC 11360) - Equip {3} ({3}: Attach to target creature you control.
150. Galea, Kindler of Hope (EDHREC 11557) - When you cast an Equipment spell this way, it gains "When this Equipment enters, attach it to target creature you control."
151. Twin Blades (EDHREC 11697) - When this Equipment enters, attach it to target creature you control.
152. Bearded Axe (EDHREC 11723) - Equip {2}
153. Shuko (EDHREC 11889) - Equip {0} ({0}: Attach to target creature you control.
154. Arm-Mounted Anchor (EDHREC 11964) - Equip {2}.
155. Fishing Gear (EDHREC 12041) - Equip {2}
156. Helm of Kaldra (EDHREC 12049) - Equip {2}
157. Mirran Banesplitter (EDHREC 12078) - When this Equipment enters, attach it to target creature you control.
158. Drach'Nyen (EDHREC 12171) - Equip {2} ({2}: Attach to target creature you control.
159. Rover Blades (EDHREC 12356) - Equip {4}
160. Dueling Rapier (EDHREC 12600) - When this Equipment enters, attach it to target creature you control.
161. Web-Shooters (EDHREC 12619) - Equip {2} ({2}: Attach to target creature you control.
162. Delver's Torch (EDHREC 12631) - Equip {3} ({3}: Attach to target creature you control.
163. Stalactite Dagger (EDHREC 12751) - Equip {2} ({2}: Attach to target creature you control.
164. Stormbeacon Blade (EDHREC 12774) - Equip {2} ({2}: Attach to target creature you control.
165. Spider-Suit (EDHREC 12816) - Equip {3} ({3}: Attach to target creature you control.
166. Ancestral Katana (EDHREC 12882) - Equip {3} ({3}: Attach to target creature you control.
167. Bladed Pinions (EDHREC 12884) - Equip {2}
168. Galadhrim Bow (EDHREC 12955) - When this Equipment enters, attach it to target creature you control.
169. Glaive of the Guildpact (EDHREC 12976) - Equip {3} ({3}: Attach to target creature you control.
170. Avarice Amulet (EDHREC 12994) - Equip {2} ({2}: Attach to target creature you control.
171. Giant's Amulet (EDHREC 13008) - Equip {2}
172. Darksteel Axe (EDHREC 13086) - Equip {2}
173. Colossal Dreadmask (EDHREC 13135) - Equip {3}{G}{G}
174. Aeronaut's Wings (EDHREC 13209) - Equip {2} ({2}: Attach to target creature you control.
175. Obsidian Battle-Axe (EDHREC 13219) - Equip {3}
176. Eriette, the Beguiler (EDHREC 13489) - Whenever an Aura you control becomes attached to a nonland permanent an opponent controls with mana value less than or equal to that Aura's mana value, gain control of that permanent for as long as that Aura is attached to it.
177. General's Kabuto (EDHREC 13531) - Equip {2} ({2}: Attach to target creature you control.
178. Swashbuckler's Whip (EDHREC 13553) - Equip {1}
179. Greataxe (EDHREC 13556) - Equip {5} ({5}: Attach to target creature you control.
180. Frodo, Determined Hero (EDHREC 13560) - Whenever Frodo enters or attacks, you may attach target Equipment you control with mana value 2 or 3 to Frodo.
181. Team Pennant (EDHREC 13567) - Equip {3}
182. Kyoshi Battle Fan (EDHREC 13571) - Equip {2} ({2}: Attach to target creature you control.
183. Barbed Batterfist (EDHREC 13572) - Equip {1} ({1}: Attach to target creature you control.
184. Sanctuary Blade (EDHREC 13626) - As this Equipment becomes attached to a creature, choose a color.
185. Seraphic Greatsword (EDHREC 13636) - Equip {4}
186. Pirate Hat (EDHREC 13727) - Equip {2} ({2}: Attach to target creature you control.
187. Kazuul's Toll Collector (EDHREC 13800) - {0}: Attach target Equipment you control to this creature.
188. Magebane Armor (EDHREC 13977) - Equip {2} ({2}: Attach to target creature you control.
189. Monk's Fist (EDHREC 13992) - Equip {2} ({2}: Attach to target creature you control.
190. Hedgewitch's Mask (EDHREC 14005) - Equip {2} ({2}: Attach to target creature you control.
191. Amorphous Axe (EDHREC 14136) - Equip {3} ({3}: Attach to target creature you control.
192. Butcher's Cleaver (EDHREC 14227) - Equip {3}
193. Pennon Blade (EDHREC 14230) - Equip {4} ({4}: Attach to target creature you control.
194. Runed Stalactite (EDHREC 14270) - Equip {2}
195. Starforged Sword (EDHREC 14441) - When this Equipment enters, if the gift was promised, attach this Equipment to target creature you control.
196. Kor Halberd (EDHREC 14442) - Equip {1} ({1}: Attach to target creature you control.
197. Kitesail (EDHREC 14541) - Equip {2} ({2}: Attach to target creature you control.
198. Illvoi Light Jammer (EDHREC 14554) - When this Equipment enters, attach it to target creature you control.
199. Mechanical Glider (EDHREC 14571) - When this Equipment enters, attach it to target creature you control.
200. Barbed Spike (EDHREC 14652) - Equip {2}

