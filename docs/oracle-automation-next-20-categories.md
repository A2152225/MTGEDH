# Oracle Automation Next 20 Work Categories

Generated: `2026-08-16T01:18:21.668Z`
Source: `oracle-cards.jsonl`
Excluded: oracle IDs already present in `tools/oracle-automation-next-10000.json`.
Ordering: categories are ordered by the next configured queue families first, then corpus-mined follow-on seams; items are ordered by EDHREC rank, then card name.

## Category Summary

| # | Category | Source | Items Listed | Available | Notes |
|---:|---|---|---:|---:|---|
| 1 | Bounce And Return-To-Hand Effects | existing queue family after library_search | 200 | 546 | Battlefield bounce and zone-return effects after the current queue tail. |
| 2 | Discard Effects | existing queue family after library_search | 200 | 1091 | Deterministic discard counts plus player-choice discard families. |
| 3 | Scry / Surveil / Topdeck Manipulation | existing queue family after library_search | 200 | 761 | Visible topdeck manipulation and queue-backed choice candidates. |
| 4 | Tap / Untap Effects | existing queue family after library_search | 200 | 533 | Single-target, multi-target, and each-target tap/untap templates. |
| 5 | Counterspell And Stack Interaction | existing queue family after library_search | 200 | 244 | Explicit spell and ability countering clauses. |
| 6 | Mill Effects | existing queue family after library_search | 200 | 369 | Library-to-graveyard movement and count scaling. |
| 7 | Impulse Exile Permission Windows | existing queue family after library_search | 177 | 177 | Exile-top plus temporary play/cast permission windows. |
| 8 | Fight And Bite-Style Combat Resolution | existing queue family after library_search | 38 | 38 | Fight, bite, and power-based creature damage clauses. |
| 9 | Goad And Attack-Pressure Effects | existing queue family after library_search | 126 | 126 | Goad, forced attacks, and attack restriction pressure text. |
| 10 | Non-Graveyard Exile Effects | corpus-mined follow-on seam | 200 | 443 | Targeted and sweeper exile effects excluding graveyard-target rows already covered by the current queue. |
| 11 | Power/Toughness Modification | corpus-mined follow-on seam | 200 | 4122 | Temporary and static P/T changes, including target and team-wide buffs/debuffs. |
| 12 | Keyword Grants And Losses | corpus-mined follow-on seam | 200 | 2408 | Gains/has/loses evergreen and combat keywords, especially duration-bound grants. |
| 13 | Combat Restrictions And Evasion Rules | corpus-mined follow-on seam | 200 | 1735 | Cannot attack/block, cannot be blocked, and blocking requirement templates. |
| 14 | Control Change And Exchange Effects | corpus-mined follow-on seam | 200 | 255 | Gain-control, donate, and exchange-control effects across permanent types. |
| 15 | Copy Spells And Abilities | corpus-mined follow-on seam | 200 | 276 | Spell/ability copy text, copied permanent spells, and retarget follow-ups. |
| 16 | Mana Generation And Mana Riders | corpus-mined follow-on seam | 200 | 1363 | Add-mana clauses, conditional mana, and rider text attached to mana production. |
| 17 | Cast Without Paying Mana Cost | corpus-mined follow-on seam | 200 | 324 | Free-cast windows from exile, library, hand, graveyard, and copied spells. |
| 18 | Modal Choices | corpus-mined follow-on seam | 200 | 231 | Choose-one, choose-one-or-more, charm, command, spree, and bullet-mode parsing. |
| 19 | Reveal / Look At Top Library Cards | corpus-mined follow-on seam | 200 | 879 | Top-library look/reveal actions beyond scry and surveil templates. |
| 20 | Attach / Equip / Aura Movement | corpus-mined follow-on seam | 200 | 553 | Attach equipment/auras and move attachments to new permanents. |

## Category Items

### 1. Bounce And Return-To-Hand Effects

Source: existing queue family after library_search
Available after current queue exclusion: 546

1. Cyclonic Rift (EDHREC 53) - Return target nonland permanent you don't control to its owner's hand.
2. Otawara, Soaring City (EDHREC 88) - Channel — {3}{U}, Discard this card: Return target artifact, creature, enchantment, or planeswalker to its owner's hand. This ability costs {1} less to activate for each legendary creature you control.
3. Snap (EDHREC 267) - Return target creature to its owner's hand.
4. Hullbreaker Horror (EDHREC 269) - • Return target spell you don't control to its owner's hand.
5. Desynchronization (EDHREC 1555) - Return each nonland permanent that's not historic to its owner's hand.
6. Riptide Laboratory (EDHREC 1773) - {1}{U}, {T}: Return target Wizard you control to its owner's hand.
7. Venser, Shaper Savant (EDHREC 1968) - When Venser enters, return target spell or permanent to its owner's hand.
8. Scourge of Fleets (EDHREC 2164) - When this creature enters, return each creature your opponents control with toughness X or less to its owner's hand, where X is the number of Islands you control.
9. Simic Charm (EDHREC 2837) - • Return target creature to its owner's hand.
10. Unsummon (EDHREC 2956) - Return target creature to its owner's hand.
11. Mistblade Shinobi (EDHREC 3225) - Whenever this creature deals combat damage to a player, you may return target creature that player controls to its owner's hand.
12. Sigil of Sleep (EDHREC 3460) - Whenever enchanted creature deals damage to a player, return target creature that player controls to its owner's hand.
13. Sanctum of Eternity (EDHREC 3719) - {2}, {T}: Return target commander you own from the battlefield to your hand. Activate only during your turn.
14. Baral's Expertise (EDHREC 3800) - Return up to three target artifacts and/or creatures to their owners' hands.
15. Tidespout Tyrant (EDHREC 3852) - Whenever you cast a spell, return target permanent to its owner's hand.
16. Karn's Temporal Sundering (EDHREC 4039) - Return up to one target nonland permanent to its owner's hand.
17. Decoction Module (EDHREC 4150) - {4}, {T}: Return target creature you control to its owner's hand.
18. Retraction Helix (EDHREC 4218) - Until end of turn, target creature gains "{T}: Return target nonland permanent to its owner's hand."
19. Spectral Deluge (EDHREC 4220) - Return each creature your opponents control with toughness X or less to its owner's hand, where X is the number of Islands you control.
20. Serum Snare (EDHREC 4477) - Return target nonland permanent to its owner's hand.
21. Snapback (EDHREC 4575) - Return target creature to its owner's hand.
22. Reflector Mage (EDHREC 4806) - When this creature enters, return target creature an opponent controls to its owner's hand.
23. Hammerhead Tyrant (EDHREC 4939) - Whenever you cast a spell, return up to one target nonland permanent an opponent controls with mana value less than or equal to that spell's mana value to its owner's hand.
24. Ugin's Binding (EDHREC 4970) - Return target nonland permanent you don't control to its owner's hand.
25. Unsubstantiate (EDHREC 5090) - Return target spell or creature to its owner's hand.
26. Macabre Waltz (EDHREC 5283) - Return up to two target creature cards from your graveyard to your hand, then discard a card.
27. Brinelin, the Moon Kraken (EDHREC 5356) - When Brinelin enters and whenever you cast a spell with mana value 6 or greater, you may return target nonland permanent to its owner's hand.
28. Press the Enemy (EDHREC 5488) - Return target spell or nonland permanent an opponent controls to its owner's hand.
29. Fight On! (EDHREC 5941) - Return up to two target creature cards from your graveyard to your hand.
30. Soothing of Sméagol (EDHREC 5942) - Return target nontoken creature to its owner's hand.
31. Crystal Shard (EDHREC 5994) - {3}, {T} or {U}, {T}: Return target creature to its owner's hand unless its controller pays {1}.
32. Prismari Charm (EDHREC 6166) - • Return target nonland permanent to its owner's hand.
33. Clement, the Worrywort (EDHREC 6409) - Whenever Clement or another creature you control enters, return up to one target creature you control with lesser mana value to its owner's hand.
34. Drafna, Founder of Lat-Nam (EDHREC 6534) - {1}{U}: Return target artifact you control to its owner's hand.
35. Banishing Knack (EDHREC 6684) - Until end of turn, target creature gains "{T}: Return target nonland permanent to its owner's hand."
36. Pouncing Shoreshark (EDHREC 6916) - Whenever this creature mutates, you may return target creature an opponent controls to its owner's hand.
37. Wastescape Battlemage (EDHREC 7069) - When you cast this spell, if it was kicked with its {1}{U} kicker, return target creature an opponent controls to its owner's hand.
38. Moonsnare Specialist (EDHREC 7081) - When this creature enters, return up to one target creature to its owner's hand.
39. Colfenor, the Last Yew (EDHREC 7192) - Whenever Colfenor or another creature you control dies, return up to one other target creature card with lesser toughness from your graveyard to your hand.
40. Vronos, Masked Inquisitor (EDHREC 7196) - −2: For each opponent, return up to one target nonland permanent that player controls to its owner's hand.
41. Tombstone, Career Criminal (EDHREC 7284) - When Tombstone enters, return target Villain card from your graveyard to your hand.
42. Fading Hope (EDHREC 7301) - Return target creature to its owner's hand.
43. Krile Baldesion (EDHREC 7722) - Trace Aether — Whenever you cast a noncreature spell, you may return target creature card with mana value equal to that spell's mana value from your graveyard to your hand. Do this only once each turn.
44. Elvish Regrower (EDHREC 7732) - When this creature enters, return target permanent card from your graveyard to your hand.
45. Boneyard Lurker (EDHREC 7768) - Whenever this creature mutates, return target permanent card from your graveyard to your hand.
46. You Come to a River (EDHREC 8011) - • Fight the Current — Return target nonland permanent to its owner's hand.
47. Man-o'-War (EDHREC 8081) - When this creature enters, return target creature to its owner's hand.
48. Ardent Elementalist (EDHREC 8092) - When this creature enters, return target instant or sorcery card from your graveyard to your hand.
49. Soul Manipulation (EDHREC 8109) - • Return target creature card from your graveyard to your hand.
50. Alchemist's Retrieval (EDHREC 8546) - Return target nonland permanent [you control] to its owner's hand.
51. Shipwreck Dowser (EDHREC 8612) - When this creature enters, return target instant or sorcery card from your graveyard to your hand.
52. Golgari Findbroker (EDHREC 8686) - When this creature enters, return target permanent card from your graveyard to your hand.
53. Disentomb (EDHREC 8738) - Return target creature card from your graveyard to your hand.
54. Raise the Draugr (EDHREC 8744) - • Return target creature card from your graveyard to your hand.
55. Circle of the Land Druid (EDHREC 8858) - Natural Recovery — When this creature dies, return target land card from your graveyard to your hand.
56. Gravedigger (EDHREC 8879) - When this creature enters, you may return target creature card from your graveyard to your hand.
57. Unbury (EDHREC 8912) - • Return target creature card from your graveyard to your hand.
58. Surgespanner (EDHREC 8946) - If you do, return target permanent to its owner's hand.
59. Stickytongue Sentinel (EDHREC 8996) - When this creature enters, return up to one other target permanent you control to its owner's hand.
60. This Town Ain't Big Enough (EDHREC 9024) - Return up to two target nonland permanents to their owners' hands.
61. Myr Reservoir (EDHREC 9104) - {3}, {T}: Return target Myr card from your graveyard to your hand.
62. Raise Dead (EDHREC 9114) - Return target creature card from your graveyard to your hand.
63. Dream Eater (EDHREC 9120) - When you do, you may return target nonland permanent an opponent controls to its owner's hand.
64. Groundskeeper (EDHREC 9184) - {1}{G}: Return target basic land card from your graveyard to your hand.
65. Loamcrafter Faun (EDHREC 9294) - When you do, return up to that many target nonland permanent cards from your graveyard to your hand.
66. Bygone Marvels (EDHREC 9301) - Return target permanent card from your graveyard to your hand.
67. Zuko's Conviction (EDHREC 9365) - Return target creature card from your graveyard to your hand.
68. Glissa, the Traitor (EDHREC 9379) - Whenever a creature an opponent controls dies, you may return target artifact card from your graveyard to your hand.
69. Glissa's Retriever (EDHREC 9404) - Corrupted — When this creature dies, exile it. When you do, return up to X target cards from your graveyard to your hand, where X is the number of opponents who have three or more poison counters.
70. Ravos, Soultender (EDHREC 9436) - At the beginning of your upkeep, you may return target creature card from your graveyard to your hand.
71. Chakra Meditation (EDHREC 9619) - When this enchantment enters, return up to one target instant or sorcery card from your graveyard to your hand.
72. Winds of Rebuke (EDHREC 9634) - Return target nonland permanent to its owner's hand.
73. Monk Class (EDHREC 9655) - When this Class becomes level 2, return up to one target nonland permanent to its owner's hand.
74. Bounce Off (EDHREC 9669) - Return target creature or Vehicle to its owner's hand.
75. Depart the Realm (EDHREC 9767) - Return target nonland permanent to its owner's hand.
76. Ice Magic (EDHREC 9793) - • Blizzard — {0} — Return target creature to its owner's hand.
77. Otrimi, the Ever-Playful (EDHREC 9888) - Whenever this creature deals combat damage to a player, return target creature card with mutate from your graveyard to your hand.
78. Unauthorized Exit (EDHREC 9926) - Return target nonland permanent to its owner's hand.
79. Pull Through the Weft (EDHREC 10059) - Return up to two target nonland permanent cards from your graveyard to your hand, then return up to two target land cards from your graveyard to the battlefield tapped.
80. Scholar of the Ages (EDHREC 10096) - When this creature enters, return up to two target instant and/or sorcery cards from your graveyard to your hand.
81. March of the Drowned (EDHREC 10140) - • Return target creature card from your graveyard to your hand.
82. Cadaver Imp (EDHREC 10144) - When this creature enters, you may return target creature card from your graveyard to your hand.
83. Reality Strobe (EDHREC 10366) - Return target permanent to its owner's hand.
84. Reap (EDHREC 10393) - Return up to X target cards from your graveyard to your hand, where X is the number of black permanents target opponent controls as you cast this spell.
85. Argivian Find (EDHREC 10466) - Return target artifact or enchantment card from your graveyard to your hand.
86. Ozox, the Clattering King (EDHREC 10520) - When Ozox dies, create Jumblebones, a legendary 2/1 black Skeleton creature token with "Jumblebones can't block" and "When Jumblebones leaves the battlefield, return target card named Ozox, the Clattering King from your graveyard to your hand."
87. Expel from Orazca (EDHREC 10550) - Return target nonland permanent to its owner's hand.
88. Road of Return (EDHREC 10575) - • Return target permanent card from your graveyard to your hand.
89. Galecaster Colossus (EDHREC 10579) - Tap an untapped Wizard you control: Return target nonland permanent you don't control to its owner's hand.
90. Treasured Find (EDHREC 10633) - Return target card from your graveyard to your hand.
91. Call to Mind (EDHREC 10690) - Return target instant or sorcery card from your graveyard to your hand.
92. Walker of Secret Ways (EDHREC 10773) - {1}{U}: Return target Ninja you control to its owner's hand. Activate only during your turn.
93. Keeper of the Nine Gales (EDHREC 10810) - {T}, Tap two untapped Birds you control: Return target permanent to its owner's hand.
94. Ephara's Dispersal (EDHREC 10901) - Return target creature to its owner's hand.
95. Karai, Future of the Foot (EDHREC 10949) - Whenever Karai deals combat damage to a player, return target creature card from your graveyard to your hand.
96. Cresting Mosasaurus (EDHREC 10995) - When this creature enters, if you cast it, return each non-Dinosaur creature to its owner's hand.
97. Spider-Byte, Web Warden (EDHREC 11127) - When Spider-Byte enters, return up to one target nonland permanent to its owner's hand.
98. Undertaker (EDHREC 11197) - {B}, {T}, Discard a card: Return target creature card from your graveyard to your hand.
99. Greasefang, Okiba Boss (EDHREC 11206) - At the beginning of combat on your turn, return target Vehicle card from your graveyard to the battlefield. It gains haste. Return it to its owner's hand at the beginning of your next end step.
100. Equilibrium (EDHREC 11266) - If you do, return target creature to its owner's hand.
101. Elder Owyn Lyons (EDHREC 11371) - When Elder Owyn Lyons enters or dies, return target artifact card from your graveyard to your hand.
102. Stern Dismissal (EDHREC 11425) - Return target creature or enchantment an opponent controls to its owner's hand.
103. Harbinger of the Tides (EDHREC 11428) - When this creature enters, you may return target tapped creature an opponent controls to its owner's hand.
104. Flock Impostor (EDHREC 11445) - When this creature enters, return up to one other target creature you control to its owner's hand.
105. Eject (EDHREC 11482) - Return target nonland permanent to its owner's hand.
106. Imperial Recovery Unit (EDHREC 11500) - Whenever this Vehicle attacks, return target creature or Vehicle card with mana value 2 or less from your graveyard to your hand.
107. Lore Drakkis (EDHREC 11517) - Whenever this creature mutates, return target instant or sorcery card from your graveyard to your hand.
108. Paleoloth (EDHREC 11608) - Whenever another creature you control with power 5 or greater enters, you may return target creature card from your graveyard to your hand.
109. Fumble (EDHREC 11626) - Return target creature to its owner's hand.
110. Spider-Man 2099, Miguel O'Hara (EDHREC 11630) - When Spider-Man 2099 enters, return up to one target creature to its owner's hand.
111. Fates' Reversal (EDHREC 11631) - Return up to one target creature card from your graveyard to your hand.
112. Return from Extinction (EDHREC 11642) - • Return target creature card from your graveyard to your hand.
113. Water Whip (EDHREC 11651) - Return up to two target creatures to their owners' hands.
114. Aethersnipe (EDHREC 11725) - When this creature enters, return target nonland permanent to its owner's hand.
115. Pull from the Grave (EDHREC 11743) - Return up to two target creature cards from your graveyard to your hand.
116. Auriok Salvagers (EDHREC 11774) - {1}{W}: Return target artifact card with mana value 1 or less from your graveyard to your hand.
117. Corpse Cur (EDHREC 11792) - When this creature enters, you may return target creature card with infect from your graveyard to your hand.
118. Courier Bat (EDHREC 11807) - When this creature enters, if you gained life this turn, return up to one target creature card from your graveyard to your hand.
119. Edgar's Awakening (EDHREC 11833) - When you do, return target creature card from your graveyard to your hand.
120. Murasa Rootgrazer (EDHREC 11834) - {T}: Return target basic land you control to its owner's hand.
121. Wort, Boggart Auntie (EDHREC 11842) - At the beginning of your upkeep, you may return target Goblin card from your graveyard to your hand.
122. Temporal Fissure (EDHREC 11854) - Return target permanent to its owner's hand.
123. Season of Renewal (EDHREC 11908) - • Return target creature card from your graveyard to your hand.
124. Whoosh! (EDHREC 11921) - Return target nonland permanent to its owner's hand.
125. Kirri, Talented Sprout (EDHREC 11960) - At the beginning of each of your postcombat main phases, return target Plant, Treefolk, or land card from your graveyard to your hand.
126. Gravedig (EDHREC 12002) - • Return target creature card from your graveyard to your hand.
127. Aid the Fallen (EDHREC 12039) - • Return target creature card from your graveyard to your hand.
128. Repeal (EDHREC 12114) - Return target nonland permanent with mana value X to its owner's hand.
129. Cephalid Constable (EDHREC 12202) - Whenever this creature deals combat damage to a player, return up to that many target permanents that player controls to their owner's hand.
130. Enigma Thief (EDHREC 12246) - When this creature enters, for each opponent, return up to one target nonland permanent that player controls to its owner's hand.
131. Mischievous Pup (EDHREC 12249) - When this creature enters, return up to one other target permanent you control to its owner's hand.
132. Revolutionist (EDHREC 12331) - When this creature enters, return target instant or sorcery card from your graveyard to your hand.
133. Nature's Spiral (EDHREC 12426) - Return target permanent card from your graveyard to your hand.
134. Walk with the Ancestors (EDHREC 12512) - Return up to one target permanent card from your graveyard to your hand.
135. Revive (EDHREC 12539) - Return target green card from your graveyard to your hand.
136. Disperse (EDHREC 12563) - Return target nonland permanent to its owner's hand.
137. Divergent Equation (EDHREC 12621) - Return up to X target instant and/or sorcery cards from your graveyard to your hand.
138. Aether Adept (EDHREC 12625) - When this creature enters, return target creature to its owner's hand.
139. Badlands Revival (EDHREC 12638) - Return up to one target permanent card from your graveyard to your hand.
140. Custodi Squire (EDHREC 12716) - Will of the council — When this creature enters, starting with you, each player votes for an artifact, creature, or enchantment card in your graveyard. Return each card with the most votes or tied for most votes to your hand.
141. Fortuitous Find (EDHREC 12725) - • Return target artifact card from your graveyard to your hand.
142. Whirlpool Whelm (EDHREC 12801) - Clash with an opponent, then return target creature to its owner's hand.
143. Ironclad Slayer (EDHREC 12815) - When this creature enters, you may return target Aura or Equipment card from your graveyard to your hand.
144. Soul Transfer (EDHREC 12821) - • Return target creature or planeswalker card from your graveyard to your hand.
145. Escape Detection (EDHREC 12848) - Return target creature to its owner's hand.
146. Tidecaller Mentor (EDHREC 12974) - Threshold — When this creature enters, if there are seven or more cards in your graveyard, return up to one target nonland permanent to its owner's hand.
147. Blood Beckoning (EDHREC 13031) - Return target creature card from your graveyard to your hand.
148. Deny Reality (EDHREC 13129) - Return target permanent to its owner's hand.
149. Sunpearl Kirin (EDHREC 13132) - When this creature enters, return up to one other target nonland permanent you control to its owner's hand.
150. Northampton Farm (EDHREC 13192) - {2}, {T}, Sacrifice this land: Return a creature card exiled with this land to the battlefield under your control. Return each other card exiled with this land to its owner's hand.
151. Cauldron Dance (EDHREC 13193) - Return target creature card from your graveyard to the battlefield. That creature gains haste. Return it to your hand at the beginning of the next end step.
152. Recollect (EDHREC 13371) - Return target card from your graveyard to your hand.
153. Supplant Form (EDHREC 13392) - Return target creature to its owner's hand.
154. Ghoulcaller's Chant (EDHREC 13396) - • Return target creature card from your graveyard to your hand.
155. Mourner's Surprise (EDHREC 13519) - Return up to one target creature card from your graveyard to your hand.
156. Loran, Disciple of History (EDHREC 13622) - Whenever Loran or another legendary creature you control enters, return target artifact card from your graveyard to your hand.
157. Desculpting Blast (EDHREC 13715) - Return target nonland permanent to its owner's hand.
158. Wail of the Forgotten (EDHREC 13761) - • Return target nonland permanent to its owner's hand.
159. Disruptor of Currents (EDHREC 13846) - When this creature enters, return up to one other target nonland permanent to its owner's hand.
160. Coati Scavenger (EDHREC 13883) - Descend 4 — When this creature enters, if there are four or more permanent cards in your graveyard, return target permanent card from your graveyard to your hand.
161. Angel of Flight Alabaster (EDHREC 14019) - At the beginning of your upkeep, return target Spirit card from your graveyard to your hand.
162. Rite of Renewal (EDHREC 14044) - Return up to two target permanent cards from your graveyard to your hand.
163. Silent Departure (EDHREC 14066) - Return target creature to its owner's hand.
164. Recover (EDHREC 14069) - Return target creature card from your graveyard to your hand.
165. Absorb Identity (EDHREC 14118) - Return target creature to its owner's hand.
166. Rydia's Return (EDHREC 14162) - • Return up to two target permanent cards from your graveyard to your hand.
167. Boing! (EDHREC 14185) - Return target creature to its owner's hand, then roll a six-sided die.
168. Bigfin Bouncer (EDHREC 14188) - When this creature enters, return target creature an opponent controls to its owner's hand.
169. Horses of the Bruinen (EDHREC 14283) - Return up to two target creatures to their owners' hands.
170. Gust of Wind (EDHREC 14287) - Return target nonland permanent you don't control to its owner's hand.
171. Bilbo's Gambit (EDHREC 14298) - Return target spell to its owner's hand.
172. Salvager of Secrets (EDHREC 14331) - When this creature enters, return target instant or sorcery card from your graveyard to your hand.
173. Damage Control Crew (EDHREC 14335) - • Repair — Return target card with mana value 4 or greater from your graveyard to your hand.
174. Wail of War (EDHREC 14336) - • Return up to two target creature cards from your graveyard to your hand.
175. Inscription of Insight (EDHREC 14411) - • Return up to two target creatures to their owners' hands.
176. Skeleton Shard (EDHREC 14559) - {3}, {T} or {B}, {T}: Return target artifact creature card from your graveyard to your hand.
177. Deceit (EDHREC 14624) - When this creature enters, if {U}{U} was spent to cast it, return up to one other target nonland permanent to its owner's hand.
178. Once and Future (EDHREC 14653) - Return target card from your graveyard to your hand.
179. Specimen Freighter (EDHREC 14710) - When this Spacecraft enters, return up to two target non-Spacecraft creatures to their owners' hands.
180. Dundoolin Weaver (EDHREC 14775) - When this creature enters, if you control three or more creatures, return target permanent card from your graveyard to your hand.
181. Void Snare (EDHREC 14799) - Return target nonland permanent to its owner's hand.
182. Machine Over Matter (EDHREC 14842) - Return target nonland permanent to its owner's hand.
183. Maestros Confluence (EDHREC 14945) - • Return target monocolored instant or sorcery card from your graveyard to your hand.
184. Super Mutant Scavenger (EDHREC 14962) - When this creature enters or dies, return up to one target Aura or Equipment card from your graveyard to your hand.
185. Nurturing Pixie (EDHREC 15021) - When this creature enters, return up to one target non-Faerie, nonland permanent you control to its owner's hand.
186. Sanguine Indulgence (EDHREC 15024) - Return up to two target creature cards from your graveyard to your hand.
187. Wipe Away (EDHREC 15075) - Return target permanent to its owner's hand.
188. Shreds of Sanity (EDHREC 15130) - Return up to one target instant card and up to one target sorcery card from your graveyard to your hand, then discard a card.
189. Macabre Reconstruction (EDHREC 15134) - Return up to two target creature cards from your graveyard to your hand.
190. Reborn Hope (EDHREC 15137) - Return target multicolored card from your graveyard to your hand.
191. Seeds of Renewal (EDHREC 15171) - Return up to two target cards from your graveyard to your hand.
192. Does Machines (EDHREC 15190) - When this Class becomes level 2, return up to two target artifact cards from your graveyard to your hand.
193. Boggart Birth Rite (EDHREC 15191) - Return target Goblin card from your graveyard to your hand.
194. Shepherd of the Clouds (EDHREC 15197) - When this creature enters, return target permanent card with mana value 3 or less from your graveyard to your hand.
195. Exclusion Mage (EDHREC 15240) - When this creature enters, return target creature an opponent controls to its owner's hand.
196. Banishing Betrayal (EDHREC 15245) - Return target nonland permanent to its owner's hand.
197. Calamitous Tide (EDHREC 15327) - Return up to two target creatures to their owners' hands.
198. Soul of Innistrad (EDHREC 15345) - {3}{B}{B}: Return up to three target creature cards from your graveyard to your hand.
199. Vampire Soulcaller (EDHREC 15384) - When this creature enters, return target creature card from your graveyard to your hand.
200. Nimraiser Paladin (EDHREC 15390) - When this creature enters, return target creature card with mana value 3 or less from your graveyard to your hand.

### 2. Discard Effects

Source: existing queue family after library_search
Available after current queue exclusion: 1091

1. Windfall (EDHREC 157) - Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way.
2. Necropotence (EDHREC 508) - Whenever you discard a card, exile that card from your graveyard.
3. Sword of Feast and Famine (EDHREC 540) - Whenever equipped creature deals combat damage to a player, that player discards a card and you untap all lands you control.
4. Plaguecrafter (EDHREC 629) - Each player who can't discards a card.
5. Dark Deal (EDHREC 1453) - Each player discards all the cards in their hand, then draws that many cards minus one.
6. Fomori Vault (EDHREC 1609) - {3}, {T}, Discard a card: Look at the top X cards of your library, where X is the number of artifacts you control. Put one of those cards into your hand and the rest on the bottom of your library in a random order.
7. Reforge the Soul (EDHREC 1693) - Each player discards their hand, then draws seven cards.
8. Containment Construct (EDHREC 1869) - Whenever you discard a card, you may exile that card from your graveyard.
9. Jace's Archivist (EDHREC 1901) - {U}, {T}: Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way.
10. Party Thrasher (EDHREC 2084) - At the beginning of your first main phase, you may discard a card.
11. Burglar Rat (EDHREC 2580) - When this creature enters, each opponent discards a card.
12. Tinybones, Bauble Burglar (EDHREC 2733) - Whenever an opponent discards a card, exile it from their graveyard with a stash counter on it.
13. Witch-king of Angmar (EDHREC 2805) - Discard a card: Witch-king of Angmar gains indestructible until end of turn.
14. Dragon Mage (EDHREC 2913) - Whenever this creature deals combat damage to a player, each player discards their hand, then draws seven cards.
15. Skirge Familiar (EDHREC 2935) - Discard a card: Add {B}.
16. Liliana of the Veil (EDHREC 2953) - +1: Each player discards a card.
17. Necrogoyf (EDHREC 3034) - At the beginning of each player's upkeep, that player discards a card.
18. Whispering Madness (EDHREC 3130) - Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way.
19. Chain of Smog (EDHREC 3189) - Target player discards two cards.
20. Oppression (EDHREC 3199) - Whenever a player casts a spell, that player discards a card.
21. Duress (EDHREC 3249) - That player discards that card.
22. Pack Rat (EDHREC 3553) - {2}{B}, Discard a card: Create a token that's a copy of this creature.
23. Wheel of Fate (EDHREC 3643) - Each player discards their hand, then draws seven cards.
24. Virus Beetle (EDHREC 4043) - When this creature enters, each opponent discards a card.
25. Balor (EDHREC 4284) - • Target opponent draws three cards, then discards three cards at random.
26. Liliana's Triumph (EDHREC 4370) - If you control a Liliana planeswalker, each opponent also discards a card.
27. Elderfang Disciple (EDHREC 4587) - When this creature enters, each opponent discards a card.
28. Nezumi Informant (EDHREC 4653) - When this creature enters, each opponent discards a card.
29. Rush of Dread (EDHREC 5040) - + {2} — Target opponent discards half the cards in their hand, rounded up.
30. Rotting Regisaur (EDHREC 5171) - At the beginning of your upkeep, discard a card.
31. Anvil of Bogardan (EDHREC 5211) - At the beginning of each player's draw step, that player draws an additional card, then discards a card.
32. Macabre Waltz (EDHREC 5283) - Return up to two target creature cards from your graveyard to your hand, then discard a card.
33. Victor, Valgavoth's Seneschal (EDHREC 5295) - Eerie — Whenever an enchantment you control enters and whenever you fully unlock a Room, surveil 2 if this is the first time this ability has resolved this turn. If it's the second time, each opponent discards a card. If it's the third time, put a creature card from a graveyard onto the battlefield under your control.
34. Bottomless Pit (EDHREC 5510) - At the beginning of each player's upkeep, that player discards a card at random.
35. Honden of Night's Reach (EDHREC 5537) - At the beginning of your upkeep, target opponent discards a card for each Shrine you control.
36. Mjölnir, Hammer of Thor (EDHREC 5720) - {2}{R}, Discard this card: It deals 2 damage to each creature.
37. Monastery Siege (EDHREC 5885) - • Khans — At the beginning of your draw step, draw an additional card, then discard a card.
38. Armix, Filigree Thrasher (EDHREC 5996) - Whenever Armix attacks, you may discard a card.
39. Necrogen Mists (EDHREC 6360) - At the beginning of each player's upkeep, that player discards a card.
40. Grief (EDHREC 6404) - That player discards that card.
41. Bog Witch (EDHREC 7337) - {B}, {T}, Discard a card: Add {B}{B}{B}.
42. Delirium Skeins (EDHREC 7441) - Each player discards three cards.
43. Lord Xander, the Collector (EDHREC 7461) - When Lord Xander enters, target opponent discards half the cards in their hand, rounded down.
44. Stronghold Rats (EDHREC 7592) - Whenever this creature deals combat damage to a player, each player discards a card.
45. Wasteland Viper (EDHREC 7651) - Bloodrush — {G}, Discard this card: Target attacking creature gets +1/+2 and gains deathtouch until end of turn.
46. Lorehold, the Historian (EDHREC 7940) - At the beginning of each opponent's upkeep, you may discard a card.
47. Hecteyes (EDHREC 7943) - When this creature enters, each opponent discards a card.
48. Mind Over Matter (EDHREC 8002) - Discard a card: You may tap or untap target artifact, creature, or land.
49. Cunning Lethemancer (EDHREC 8024) - At the beginning of your upkeep, each player discards a card.
50. Mind Rake (EDHREC 8405) - Target player discards two cards.
51. Fraying Omnipotence (EDHREC 8564) - Each player loses half their life, then discards half the cards in their hand, then sacrifices half the creatures they control of their choice.
52. Rapturous Moment (EDHREC 8608) - Draw three cards, then discard two cards.
53. Hypnotic Specter (EDHREC 8687) - Whenever this creature deals damage to an opponent, that player discards a card at random.
54. Pilfer (EDHREC 8815) - That player discards that card.
55. Inquisition of Kozilek (EDHREC 9063) - That player discards that card.
56. Hobgoblin, Mantled Marauder (EDHREC 9225) - Whenever you discard a card, Hobgoblin gets +2/+0 until end of turn.
57. Awaken the Erstwhile (EDHREC 9264) - Each player discards all the cards in their hand, then creates that many 2/2 black Zombie creature tokens.
58. Loamcrafter Faun (EDHREC 9294) - When this creature enters, you may discard one or more land cards.
59. Khorvath's Fury (EDHREC 9350) - Each friend discards all cards from their hand, then draws that many cards plus one.
60. Capital Punishment (EDHREC 9380) - Council's dilemma — Starting with you, each player votes for death or taxes. Each opponent sacrifices a creature of their choice for each death vote and discards a card for each taxes vote.
61. Traumatic Critique (EDHREC 9389) - Draw two cards, then discard a card.
62. Villainous Hideout (EDHREC 9513) - {3}, {T}: Target Villain you control connives. Activate only as a sorcery. (Draw a card, then discard a card. If you discarded a nonland card, put a +1/+1 counter on that creature.)
63. Hymn to Tourach (EDHREC 9552) - Target player discards two cards at random.
64. Baron Strucker, HYDRA Overlord (EDHREC 9612) - (Draw a card, then discard a card. If you discarded a nonland card, put a +1/+1 counter on that creature.)
65. Chakra Meditation (EDHREC 9619) - Then discard a card unless there are three or more Lesson cards in your graveyard.
66. M.O.D.O.K. (EDHREC 9713) - Mental Organism — Pay 3 life: M.O.D.O.K. connives. Activate only during your turn. (Draw a card, then discard a card. If you discarded a nonland card, put a +1/+1 counter on this creature.)
67. Liliana's Specter (EDHREC 9737) - When this creature enters, each opponent discards a card.
68. Rix Maadi, Dungeon Palace (EDHREC 9742) - {1}{B}{R}, {T}: Each player discards a card. Activate only as a sorcery.
69. Nephalia Academy (EDHREC 9743) - If a spell or ability an opponent controls causes you to discard a card, you may reveal that card and put it on top of your library instead of putting it anywhere else.
70. Okiba-Gang Shinobi (EDHREC 9822) - Whenever this creature deals combat damage to a player, that player discards two cards.
71. Cavern Whisperer (EDHREC 9861) - Whenever this creature mutates, each opponent discards a card.
72. Quintorius, History Chaser (EDHREC 9948) - +1: You may discard a card.
73. Pursue the Past (EDHREC 10081) - You may discard a card.
74. Lluwen, Imperfect Naturalist (EDHREC 10089) - {2}{B/G}{B/G}{B/G}, {T}, Discard a land card: Create a 1/1 black and green Worm creature token for each land card in your graveyard.
75. Death Cloud (EDHREC 10242) - Each player loses X life, discards X cards, sacrifices X creatures of their choice, then sacrifices X lands of their choice.
76. Oildeep Gearhulk (EDHREC 10253) - If you do, that player discards that card, then draws a card.
77. Leader, Super-Genius (EDHREC 10268) - (Draw a card, then discard a card. If you discarded a nonland card, put a +1/+1 counter on that creature.)
78. Prognostic Sphinx (EDHREC 10292) - Discard a card: This creature gains hexproof until end of turn.
79. Doctor Doom, King of Latveria (EDHREC 10351) - Whenever you discard one or more land cards, each opponent loses 2 life.
80. Sycorax Commander (EDHREC 10356) - Sanctified Rules of Combat — When this creature enters, each opponent faces a villainous choice — That opponent discards all the cards in their hand, then draws that many cards minus one, or this creature deals damage to that player equal to the number of cards in their hand.
81. Ral Zarek, Guest Lecturer (EDHREC 10437) - −1: Any number of target players each discard a card.
82. Tireless Tribe (EDHREC 10458) - Discard a card: This creature gets +0/+4 until end of turn.
83. Reality Smasher (EDHREC 10496) - Whenever this creature becomes the target of a spell an opponent controls, counter that spell unless its controller discards a card.
84. Ultron, Unlimited (EDHREC 10588) - (Draw a card, then discard a card. If you discarded a nonland card, put a +1/+1 counter on this creature.)
85. Thoughtrender Lamia (EDHREC 10793) - Constellation — Whenever this creature or another enchantment you control enters, each opponent discards a card.
86. Fearless Swashbuckler (EDHREC 10798) - Whenever you attack, if a Pirate and a Vehicle attacked this combat, draw three cards, then discard two cards.
87. Vision of Love (EDHREC 10822) - You may sacrifice an artifact or discard a card.
88. Adventurer's Airship (EDHREC 10925) - Whenever this Vehicle attacks, draw a card, then discard a card.
89. Pox Plague (EDHREC 10988) - Each player loses half their life, then discards half the cards in their hand, then sacrifices half the permanents they control of their choice.
90. Thirst for Identity (EDHREC 11032) - Then discard two cards unless you discard a creature card.
91. Dreadwing Scavenger (EDHREC 11087) - Whenever this creature enters or attacks, draw a card, then discard a card.
92. Locke Cole (EDHREC 11100) - Whenever Locke Cole deals combat damage to a player, draw a card, then discard a card.
93. Noose Constrictor (EDHREC 11125) - Discard a card: This creature gets +1/+1 until end of turn.
94. Undertaker (EDHREC 11197) - {B}, {T}, Discard a card: Return target creature card from your graveyard to your hand.
95. Send in the Pest (EDHREC 11288) - Each opponent discards a card.
96. The Queen of Dale (EDHREC 11322) - (Draw a card, then discard a card. If you discarded a nonland card, create a 1/1 white Human Soldier creature token.)
97. Byway Barterer (EDHREC 11344) - Whenever you expend 4, you may discard your hand. If you do, draw two cards. (You expend 4 as you spend your fourth total mana to cast spells during a turn.)
98. Kang, Temporal Tyrant (EDHREC 11383) - (Draw a card, then discard a card. If you discarded a nonland card, put a +1/+1 counter on this creature.)
99. Strix Lookout (EDHREC 11434) - {1}{U}, {T}: Draw a card, then discard a card.
100. Steal the Show (EDHREC 11502) - • Target player discards any number of cards, then draws that many cards.
101. Elvish Doomsayer (EDHREC 11528) - When this creature dies, each opponent discards a card.
102. Unexpected Assistance (EDHREC 11565) - Draw three cards, then discard a card.
103. Ravenous Rats (EDHREC 11591) - When this creature enters, target opponent discards a card.
104. Wilt-Leaf Liege (EDHREC 11741) - If a spell or ability an opponent controls causes you to discard this card, put it onto the battlefield instead of putting it into your graveyard.
105. Horrid Shadowspinner (EDHREC 11813) - If you do, discard that many cards.
106. Peer Past the Veil (EDHREC 11814) - Discard your hand. Then draw X cards, where X is the number of card types among cards in your graveyard.
107. Edgar's Awakening (EDHREC 11833) - When you discard this card, you may pay {B}.
108. Bite of the Black Rose (EDHREC 11861) - Will of the council — Starting with you, each player votes for sickness or psychosis. If sickness gets more votes, creatures your opponents control get -2/-2 until end of turn. If psychosis gets more votes or the vote is tied, each opponent discards two cards.
109. Narset, Jeskai Waymaster (EDHREC 11987) - At the beginning of your end step, you may discard your hand. If you do, draw cards equal to the number of spells you've cast this turn.
110. Whiskerquill Scribe (EDHREC 12063) - Valiant — Whenever this creature becomes the target of a spell or ability you control for the first time each turn, you may discard a card. If you do, draw a card.
111. The Destined Thief (EDHREC 12074) - Whenever one or more creatures you control deal combat damage to one or more players, draw a card, then discard a card.
112. Akki Ronin (EDHREC 12118) - Whenever a Samurai or Warrior you control attacks alone, you may discard a card.
113. Fell Flagship (EDHREC 12166) - Whenever this Vehicle deals combat damage to a player, that player discards a card.
114. Ancestral Reminiscence (EDHREC 12205) - Draw three cards, then discard a card.
115. Unnerve (EDHREC 12209) - Each opponent discards two cards.
116. Raphael's Technique (EDHREC 12228) - Each player may discard their hand and draw seven cards.
117. Whirlwind Technique (EDHREC 12239) - Target player draws two cards, then discards a card.
118. Arm-Mounted Anchor (EDHREC 12245) - Then discard two cards unless you discard a Pirate card.
119. Oblivion Crown (EDHREC 12404) - Enchanted creature has "Discard a card: This creature gets +1/+1 until end of turn."
120. Mind Rot (EDHREC 12444) - Target player discards two cards.
121. Runehorn Hellkite (EDHREC 12446) - {5}{R}, Exile this card from your graveyard: Each player discards their hand, then draws seven cards.
122. Hardened Academic (EDHREC 12456) - Discard a card: This creature gains lifelink until end of turn.
123. Disinformation Campaign (EDHREC 12476) - When this enchantment enters, you draw a card and each opponent discards a card.
124. Mystic Redaction (EDHREC 12483) - Whenever you discard a card, each opponent mills two cards.
125. Into the Night (EDHREC 12498) - Discard any number of cards, then draw that many cards plus one.
126. Miasmic Mummy (EDHREC 12519) - When this creature enters, each player discards a card.
127. Body Snatcher (EDHREC 12522) - When this creature enters, exile it unless you discard a creature card.
128. Dragonborn Looter (EDHREC 12607) - {1}, {T}: Draw a card, then discard a card.
129. Queen Kayla bin-Kroog (EDHREC 12631) - {4}, {T}: Discard all the cards in your hand, then draw that many cards. You may choose an artifact or creature card with mana value 1 you discarded this way, then do the same for artifact or creature cards with mana values 2 and 3. Return those cards to the battlefield. Activate only as a sorcery.
130. Oblivious Bookworm (EDHREC 12665) - If you do, discard a card unless a permanent entered the battlefield face down under your control this turn or you turned a permanent face up this turn.
131. Words of Waste (EDHREC 12691) - {1}: The next time you would draw a card this turn, each opponent discards a card instead.
132. Moonstone, Harsh Mistress (EDHREC 12692) - Whenever you discard a card, you may exile that card from your graveyard.
133. Thought-Stalker Warlock (EDHREC 12744) - If they lost life this turn, they reveal their hand, you choose a nonland card from it, and they discard that card.
134. Pain Magnification (EDHREC 12755) - Whenever an opponent is dealt 3 or more damage by a single source, that player discards a card.
135. Nath of the Gilt-Leaf (EDHREC 12781) - At the beginning of your upkeep, you may have target opponent discard a card at random.
136. Giott, King of the Dwarves (EDHREC 12785) - Whenever Giott or another Dwarf you control enters and whenever an Equipment you control enters, you may discard a card.
137. Pore Over the Pages (EDHREC 12910) - Draw three cards, untap up to two lands, then discard a card.
138. Case of the Crimson Pulse (EDHREC 12918) - When this Case enters, discard a card, then draw two cards.
139. Chandra's Regulator (EDHREC 12941) - {1}, {T}, Discard a Mountain card or a red card: Draw a card.
140. Call the Bloodline (EDHREC 12985) - {1}, Discard a card: Create a 1/1 black Vampire Knight creature token with lifelink. Activate only once each turn.
141. Drainpipe Vermin (EDHREC 13038) - If you do, target player discards a card.
142. Rubblehulk (EDHREC 13065) - Bloodrush — {1}{R}{G}, Discard this card: Target attacking creature gets +X/+X until end of turn, where X is the number of lands you control.
143. Academy Wall (EDHREC 13139) - If you do, discard a card.
144. Scuttletide (EDHREC 13153) - {1}, Discard a card: Create a 0/3 blue Crab creature token.
145. Poison the Waters (EDHREC 13154) - • Target player reveals their hand. You choose an artifact or creature card from it. That player discards that card.
146. Gristle Glutton (EDHREC 13224) - {T}, Blight 1: Discard a card. If you do, draw a card. (To blight 1, put a -1/-1 counter on a creature you control.)
147. Mishra, Excavation Prodigy (EDHREC 13249) - {1}, {T}, Discard a card: Draw a card.
148. Practical Research (EDHREC 13266) - Then discard two cards unless you discard an instant or sorcery card.
149. Magus of the Bazaar (EDHREC 13307) - {T}: Draw two cards, then discard three cards.
150. Llanowar Mentor (EDHREC 13360) - {G}, {T}, Discard a card: Create a 1/1 green Elf Druid creature token named Llanowar Elves. It has "{T}: Add {G}."
151. Cloudpiercer (EDHREC 13410) - Whenever this creature mutates, you may discard a card.
152. Pilfering Hawk (EDHREC 13438) - {S}, {T}: Draw a card, then discard a card. ({S} can be paid with one mana from a snow source.)
153. Shattered Perception (EDHREC 13455) - Discard all the cards in your hand, then draw that many cards.
154. Azula, Ruthless Firebender (EDHREC 13549) - Whenever Azula attacks, you may discard a card.
155. Lys Alana Scarblade (EDHREC 13586) - {T}, Discard an Elf card: Target creature gets -X/-X until end of turn, where X is the number of Elves you control.
156. Borrowed Knowledge (EDHREC 13616) - • Discard your hand, then draw cards equal to the number of cards in target opponent's hand.
157. Crosis, the Purger (EDHREC 13693) - If you do, choose a color, then that player reveals their hand and discards all cards of that color.
158. Wail of the Forgotten (EDHREC 13761) - • Target opponent discards a card.
159. Bedlam Reveler (EDHREC 13793) - When this creature enters, discard your hand, then draw three cards.
160. Rain of Revelation (EDHREC 13808) - Draw three cards, then discard a card.
161. Ill-Gotten Gains (EDHREC 13904) - Each player discards their hand, then returns up to three cards from their graveyard to their hand.
162. Cracked Skull (EDHREC 13963) - That player discards that card.
163. Artificer's Epiphany (EDHREC 14036) - If you control no artifacts, discard a card.
164. Magmatic Channeler (EDHREC 14052) - {T}, Discard a card: Exile the top two cards of your library, then choose one of them. You may play that card this turn.
165. Hell Mongrel (EDHREC 14097) - Discard a card: This creature gets +1/+1 until end of turn.
166. Curse of Chaos (EDHREC 14143) - Whenever a player attacks enchanted player with one or more creatures, that attacking player may discard a card.
167. Pirate Hat (EDHREC 14169) - Equipped creature gets +1/+1 and has "Whenever this creature attacks, draw a card, then discard a card."
168. Harvester of Misery (EDHREC 14195) - {1}{B}, Discard this card: Target creature gets -2/-2 until end of turn.
169. Fanatic of the Harrowing (EDHREC 14202) - When this creature enters, each player discards a card.
170. Nico Minoru, Runaway (EDHREC 14230) - {2}{R}, {T}, Discard a card: Exile cards from the top of your library until you exile a nonland card. You may cast that card without paying its mana cost.
171. Blizzard Specter (EDHREC 14236) - • That player discards a card.
172. Seeker's Folly (EDHREC 14267) - • Target opponent discards two cards.
173. Careful Consideration (EDHREC 14276) - Target player draws four cards, then discards three cards.
174. Dire Undercurrents (EDHREC 14280) - Whenever a black creature you control enters, you may have target player discard a card.
175. Divest (EDHREC 14314) - That player discards that card.
176. Muse Seeker (EDHREC 14324) - Opus — Whenever you cast an instant or sorcery spell, draw a card. Then discard a card unless five or more mana was spent to cast that spell.
177. Malfegor (EDHREC 14346) - When Malfegor enters, discard your hand. Each opponent sacrifices a creature of their choice for each card discarded this way.
178. Iron-Shield Elf (EDHREC 14404) - Discard a card: This creature gains indestructible until end of turn.
179. Wild Mongrel (EDHREC 14424) - Discard a card: This creature gets +1/+1 and becomes the color of your choice until end of turn.
180. Uthros Scanship (EDHREC 14447) - When this Spacecraft enters, draw two cards, then discard a card.
181. Dark Intimations (EDHREC 14452) - Each opponent sacrifices a creature or planeswalker of their choice, then discards a card.
182. Rubble Rouser (EDHREC 14514) - When this creature enters, you may discard a card.
183. Sage of the Falls (EDHREC 14531) - If you do, discard a card.
184. Black Cat (EDHREC 14551) - When this creature dies, target opponent discards a card at random.
185. Pulling Teeth (EDHREC 14606) - If you win, target player discards two cards.
186. Deceit (EDHREC 14624) - That player discards that card.
187. Rites of Refusal (EDHREC 14631) - Discard any number of cards.
188. Go Blank (EDHREC 14652) - Target player discards two cards.
189. Goblin Lore (EDHREC 14665) - Draw four cards, then discard three cards at random.
190. Tasigur's Cruelty (EDHREC 14666) - Each opponent discards two cards.
191. Extract the Truth (EDHREC 14780) - • Target opponent reveals their hand. You may choose a creature, enchantment, or planeswalker card from it. That player discards that card.
192. Goblin Picker (EDHREC 14847) - {R}, {T}, Discard a card: Draw a card.
193. Dangerous Wager (EDHREC 14861) - Discard your hand, then draw two cards.
194. Jalum Tome (EDHREC 14902) - {2}, {T}: Draw a card, then discard a card.
195. Canyon Crab (EDHREC 14907) - At the beginning of your end step, if you haven't cast a spell from your hand this turn, draw a card, then discard a card.
196. Mechan Navigator (EDHREC 14910) - Whenever this creature becomes tapped, draw a card, then discard a card.
197. Faerie Macabre (EDHREC 14948) - Discard this card: Exile up to two target cards from graveyards.
198. Gastal Thrillroller (EDHREC 14970) - {2}{R}, Discard a card: Return this card from your graveyard to the battlefield with a finality counter on it. Activate only as a sorcery.
199. Bloodthorn Flail (EDHREC 14993) - Equip—Pay {3} or discard a card.
200. Turbulent Dreams (EDHREC 15083) - As an additional cost to cast this spell, discard X cards.

### 3. Scry / Surveil / Topdeck Manipulation

Source: existing queue family after library_search
Available after current queue exclusion: 761

1. Path of Ancestry (EDHREC 14) - {T}: Add one mana of any color in your commander's color identity. When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1. (Look at the top card of your library. You may put that card on the bottom.)
2. Mosswort Bridge (EDHREC 196) - Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)
3. Temple of Epiphany (EDHREC 284) - When this land enters, scry 1.
4. Temple of Silence (EDHREC 290) - When this land enters, scry 1.
5. Temple of Triumph (EDHREC 303) - When this land enters, scry 1.
6. Temple of Enlightenment (EDHREC 316) - When this land enters, scry 1.
7. Temple of Mystery (EDHREC 319) - When this land enters, scry 1.
8. Temple of Deceit (EDHREC 345) - When this land enters, scry 1.
9. Temple of Malady (EDHREC 354) - When this land enters, scry 1.
10. Undercity Sewers (EDHREC 421) - When this land enters, surveil 1.
11. Thassa's Oracle (EDHREC 430) - When this creature enters, look at the top X cards of your library, where X is your devotion to blue.
12. Temple of Malice (EDHREC 438) - When this land enters, scry 1.
13. Underground Mortuary (EDHREC 474) - When this land enters, surveil 1.
14. Temple of Plenty (EDHREC 492) - When this land enters, scry 1.
15. Temple of Abandon (EDHREC 516) - When this land enters, scry 1.
16. Hedge Maze (EDHREC 547) - When this land enters, surveil 1.
17. Raucous Theater (EDHREC 566) - When this land enters, surveil 1.
18. Shadowy Backstreet (EDHREC 574) - When this land enters, surveil 1.
19. Dig Through Time (EDHREC 621) - Look at the top seven cards of your library.
20. Thundering Falls (EDHREC 623) - When this land enters, surveil 1.
21. Commercial District (EDHREC 651) - When this land enters, surveil 1.
22. Windbrisk Heights (EDHREC 657) - Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)
23. Meticulous Archive (EDHREC 695) - When this land enters, surveil 1.
24. Lush Portico (EDHREC 725) - When this land enters, surveil 1.
25. Aqueous Form (EDHREC 743) - Whenever enchanted creature attacks, scry 1.
26. Spinerock Knoll (EDHREC 763) - Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)
27. Elegant Parlor (EDHREC 770) - When this land enters, surveil 1.
28. Expressive Iteration (EDHREC 881) - Look at the top three cards of your library.
29. Loot, Exuberant Explorer (EDHREC 915) - {4}{G}{G}, {T}: Look at the top six cards of your library. You may reveal a creature card with mana value less than or equal to the number of lands you control from among them and put it onto the battlefield. Put the rest on the bottom in a random order.
30. Narset, Parter of Veils (EDHREC 940) - −2: Look at the top four cards of your library.
31. Castle Vantress (EDHREC 990) - {2}{U}{U}, {T}: Scry 2.
32. Rivendell (EDHREC 1032) - {1}{U}, {T}: Scry 2. Activate only if you control a legendary creature.
33. Halimar Depths (EDHREC 1291) - When this land enters, look at the top three cards of your library, then put them back in any order.
34. Experimental Augury (EDHREC 1314) - Look at the top three cards of your library.
35. Kinnan, Bonder Prodigy (EDHREC 1355) - {5}{G}{U}: Look at the top five cards of your library. You may put a non-Human creature card from among them onto the battlefield. Put the rest on the bottom of your library in a random order.
36. Stock Up (EDHREC 1414) - Look at the top five cards of your library.
37. Planar Genesis (EDHREC 1467) - Look at the top four cards of your library.
38. Monumental Henge (EDHREC 1476) - {2}{W}{W}, {T}: Look at the top five cards of your library. You may reveal a historic card from among them and put it into your hand. Put the rest on the bottom of your library in a random order. (Artifacts, legendaries, and Sagas are historic.)
39. Arid Archway (EDHREC 1483) - If another Desert was returned this way, surveil 1.
40. The Grey Havens (EDHREC 1561) - When The Grey Havens enters, scry 1.
41. Fomori Vault (EDHREC 1609) - {3}, {T}, Discard a card: Look at the top X cards of your library, where X is the number of artifacts you control. Put one of those cards into your hand and the rest on the bottom of your library in a random order.
42. Retreat to Coralhelm (EDHREC 1768) - • Scry 1. (Look at the top card of your library. You may put that card on the bottom.)
43. Dragon's Rage Channeler (EDHREC 1808) - Whenever you cast a noncreature spell, surveil 1.
44. Doom Whisperer (EDHREC 1824) - Pay 2 life: Surveil 2.
45. Loran's Escape (EDHREC 1897) - Scry 1.
46. Sonic Screwdriver (EDHREC 1899) - {2}, {T}: Scry 1. (Look at the top card of your library. You may put that card on the bottom.)
47. Thassa, God of the Sea (EDHREC 1972) - At the beginning of your upkeep, scry 1.
48. Conduit Pylons (EDHREC 1995) - When this land enters, surveil 1.
49. Adaptive Omnitool (EDHREC 2088) - Whenever equipped creature attacks, look at the top six cards of your library.
50. Hidden Grotto (EDHREC 2243) - When this land enters, surveil 1.
51. Icon of Ancestry (EDHREC 2356) - {3}, {T}: Look at the top three cards of your library. You may reveal a creature card of the chosen type from among them and put it into your hand. Put the rest on the bottom of your library in a random order.
52. Lim-Dûl's Vault (EDHREC 2361) - Look at the top five cards of your library.
53. Faerie Seer (EDHREC 2425) - When this creature enters, scry 2.
54. Weatherlight (EDHREC 2444) - Whenever Weatherlight deals combat damage to a player, look at the top five cards of your library.
55. Ureni of the Unwritten (EDHREC 2512) - Whenever Ureni enters or attacks, look at the top eight cards of your library.
56. Armored Skyhunter (EDHREC 2547) - Whenever this creature attacks, look at the top six cards of your library.
57. Zhalfirin Void (EDHREC 2550) - When this land enters, scry 1.
58. Impulse (EDHREC 2610) - Look at the top four cards of your library.
59. Crystal Grotto (EDHREC 2629) - When this land enters, scry 1.
60. Heroes' Podium (EDHREC 2658) - {X}, {T}: Look at the top X cards of your library. You may reveal a legendary creature card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.
61. Cemetery Tampering (EDHREC 2768) - Hideaway 5 (When this enchantment enters, look at the top five cards of your library, exile one face down, then put the rest on the bottom in a random order.)
62. Sylvan Anthem (EDHREC 2797) - Whenever a green creature you control enters, scry 1.
63. Sleight of Hand (EDHREC 3084) - Look at the top two cards of your library.
64. Rumble Arena (EDHREC 3245) - When this land enters, scry 1.
65. Twilight Diviner (EDHREC 3285) - When this creature enters, surveil 2.
66. Karumonix, the Rat King (EDHREC 3408) - When Karumonix enters, look at the top five cards of your library.
67. Gods Willing (EDHREC 3479) - Scry 1.
68. Florian, Voldaren Scion (EDHREC 3489) - At the beginning of each of your postcombat main phases, look at the top X cards of your library, where X is the total amount of life your opponents lost this turn.
69. Aetherworks Marvel (EDHREC 3490) - {T}, Pay six {E}: Look at the top six cards of your library. You may cast a spell from among them without paying its mana cost. Put the rest on the bottom of your library in a random order.
70. Consult the Star Charts (EDHREC 3584) - Look at the top X cards of your library, where X is the number of lands you control.
71. Satoru Umezawa (EDHREC 3602) - Whenever you activate a ninjutsu ability, look at the top three cards of your library.
72. Glarb, Calamity's Augur (EDHREC 3648) - {T}: Surveil 2.
73. Study Hall (EDHREC 3775) - {1}, {T}: Add one mana of any color. When you spend this mana to cast your commander, scry X, where X is the number of times it's been cast from the command zone this game.
74. Lilypad Village (EDHREC 3811) - {U}, {T}: Surveil 2. Activate only if a Bird, Frog, Otter, or Rat entered the battlefield under your control this turn.
75. Genesis Ultimatum (EDHREC 3813) - Look at the top five cards of your library.
76. Vivien, Champion of the Wilds (EDHREC 3897) - −2: Look at the top three cards of your library.
77. Planetarium of Wan Shi Tong (EDHREC 3923) - {1}, {T}: Scry 2.
78. Jace's Sanctum (EDHREC 4112) - Whenever you cast an instant or sorcery spell, scry 1.
79. Horn of the Mark (EDHREC 4244) - Whenever two or more creatures you control attack a player, look at the top five cards of your library.
80. Teferi, Temporal Archmage (EDHREC 4320) - +1: Look at the top two cards of your library.
81. Gossip's Talent (EDHREC 4322) - Whenever a creature you control enters, surveil 1.
82. Titan's Strength (EDHREC 4383) - Scry 1.
83. Seismic Sense (EDHREC 4661) - Look at the top X cards of your library, where X is the number of lands you control.
84. Quandrix Campus (EDHREC 4687) - {4}, {T}: Scry 1. (Look at the top card of your library. You may put that card on the bottom.)
85. Restless Spire (EDHREC 4754) - Whenever this land attacks, scry 1.
86. Doors of Durin (EDHREC 4756) - Whenever you attack, scry 2, then you may reveal the top card of your library.
87. Astor, Bearer of Blades (EDHREC 4762) - When Astor enters, look at the top seven cards of your library.
88. Sword of Once and Future (EDHREC 4804) - Whenever equipped creature deals combat damage to a player, surveil 2.
89. Gilgamesh, Master-at-Arms (EDHREC 4818) - Whenever Gilgamesh enters or attacks, look at the top six cards of your library.
90. Winota, Joiner of Forces (EDHREC 4834) - Whenever a non-Human creature you control attacks, look at the top six cards of your library.
91. Calix, Destiny's Hand (EDHREC 4874) - +1: Look at the top four cards of your library.
92. Mission Briefing (EDHREC 4883) - Surveil 2, then choose an instant or sorcery card in your graveyard.
93. Kishla Village (EDHREC 4968) - {3}{G}, {T}: Surveil 2. (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)
94. Valley Questcaller (EDHREC 5002) - Whenever one or more other Rabbits, Bats, Birds, and/or Mice you control enter, scry 1.
95. Sauron's Ransom (EDHREC 5014) - They look at the top four cards of your library and separate them into a face-down pile and a face-up pile.
96. Aminatou, Veil Piercer (EDHREC 5036) - At the beginning of your upkeep, surveil 2.
97. Snarling Gorehound (EDHREC 5058) - Whenever another creature you control with power 2 or less enters, surveil 1.
98. Expand the Sphere (EDHREC 5072) - Look at the top six cards of your library.
99. Clive's Hideaway (EDHREC 5162) - Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)
100. Elvish Rejuvenator (EDHREC 5172) - When this creature enters, look at the top five cards of your library.
101. Djeru and Hazoret (EDHREC 5238) - Whenever Djeru and Hazoret attacks, look at the top six cards of your library.
102. Desmond Miles (EDHREC 5288) - Whenever Desmond Miles deals combat damage to a player, surveil X, where X is the amount of damage it dealt to that player.
103. Flow State (EDHREC 5294) - Look at the top three cards of your library.
104. Victor, Valgavoth's Seneschal (EDHREC 5295) - Eerie — Whenever an enchantment you control enters and whenever you fully unlock a Room, surveil 2 if this is the first time this ability has resolved this turn. If it's the second time, each opponent discards a card. If it's the third time, put a creature card from a graveyard onto the battlefield under your control.
105. Evercoat Ursine (EDHREC 5435) - Hideaway 3, hideaway 3 (When this creature enters, look at the top three cards of your library, exile one face down, then put the rest on the bottom in a random order. Then do it again.)
106. Abhorrent Oculus (EDHREC 5502) - (Look at the top two cards of your library. Put one onto the battlefield face down as a 2/2 creature and the other into your graveyard. Turn it face up any time for its mana cost if it's a creature card.)
107. Freestrider Lookout (EDHREC 5504) - Whenever you commit a crime, look at the top five cards of your library.
108. Gallifrey Council Chamber (EDHREC 5536) - When Gallifrey Council Chamber enters, surveil 1.
109. Artificer's Assistant (EDHREC 5542) - Whenever you cast a historic spell, scry 1.
110. Nymris, Oona's Trickster (EDHREC 5580) - Whenever you cast your first spell during each opponent's turn, look at the top two cards of your library.
111. Prismari Campus (EDHREC 5619) - {4}, {T}: Scry 1. (Look at the top card of your library. You may put that card on the bottom.)
112. Telling Time (EDHREC 5622) - Look at the top three cards of your library.
113. Hauntwoods Shrieker (EDHREC 5691) - (Look at the top two cards of your library. Put one onto the battlefield face down as a 2/2 creature and the other into your graveyard. Turn it face up any time for its mana cost if it's a creature card.)
114. Zimone, Mystery Unraveler (EDHREC 5760) - Landfall — Whenever a land you control enters, manifest dread if this is the first time this ability has resolved this turn. Otherwise, you may turn a permanent you control face up. (To manifest dread, look at the top two cards of your library. Put one onto the battlefield face down as a 2/2 creature and the other into your graveyard. Turn it face up any time for its mana cost if it's a creature card.)
115. Cream of the Crop (EDHREC 5782) - Whenever a creature you control enters, you may look at the top X cards of your library, where X is that creature's power.
116. Accumulate Wisdom (EDHREC 5799) - Look at the top three cards of your library.
117. Cait Sith, Fortune Teller (EDHREC 5847) - Lucky Slots — At the beginning of combat on your turn, scry 1, then exile the top card of your library. You may play that card this turn. When you exile a card this way, target creature you control gets +X/+0 until end of turn, where X is that card's mana value.
118. Perception Bobblehead (EDHREC 5939) - {3}, {T}: Look at the top X cards of your library, where X is the number of Bobbleheads you control. You may cast a spell with mana value 3 or less from among them without paying its mana cost. Put the rest on the bottom of your library in a random order.
119. Don't Make a Sound (EDHREC 5992) - If they do, surveil 2.
120. Kamahl's Druidic Vow (EDHREC 5993) - Look at the top X cards of your library.
121. Condescend (EDHREC 6044) - Scry 2.
122. Silverquill Campus (EDHREC 6143) - {4}, {T}: Scry 1. (Look at the top card of your library. You may put that card on the bottom.)
123. Prismari Charm (EDHREC 6166) - • Surveil 2, then draw a card.
124. Tocasia's Dig Site (EDHREC 6170) - {3}, {T}: Surveil 1. (Look at the top card of your library. You may put it into your graveyard.)
125. Dissolve (EDHREC 6219) - Scry 1.
126. See the Truth (EDHREC 6254) - Look at the top three cards of your library.
127. Sinister Sabotage (EDHREC 6321) - Surveil 1.
128. Anticipate (EDHREC 6353) - Look at the top three cards of your library.
129. Dragonologist (EDHREC 6442) - When this creature enters, look at the top six cards of your library.
130. Witherbloom Campus (EDHREC 6491) - {4}, {T}: Scry 1. (Look at the top card of your library. You may put that card on the bottom.)
131. Laser Screwdriver (EDHREC 6538) - {2}, {T}: Surveil 1. (Look at the top card of your library. You may put that card into your graveyard.)
132. Lapis Orb of Dragonkind (EDHREC 6544) - {T}: Add {U}. When you spend this mana to cast a Dragon creature spell, scry 2. (Look at the top two cards of your library, then put any number of them on the bottom and the rest on top in any order.)
133. Elrond, Lord of Rivendell (EDHREC 6557) - Whenever Elrond or another creature you control enters, scry 1.
134. Acclaimed Contender (EDHREC 6632) - When this creature enters, if you control another Knight, look at the top five cards of your library.
135. Owlbear Cub (EDHREC 6663) - Mama's Coming — Whenever this creature attacks a player who controls eight or more lands, look at the top eight cards of your library. You may put a creature card from among them onto the battlefield tapped and attacking that player. Put the rest on the bottom of your library in a random order.
136. Mirri's Guile (EDHREC 6693) - At the beginning of your upkeep, you may look at the top three cards of your library, then put them back in any order.
137. Elvish Mariner (EDHREC 6696) - Whenever this creature attacks, scry 1.
138. Nissa, Steward of Elements (EDHREC 6714) - +2: Scry 2.
139. Boromir, Gondor's Hope (EDHREC 6821) - Whenever Boromir enters or attacks, look at the top six cards of your library.
140. Mana Geode (EDHREC 6878) - When this artifact enters, scry 1.
141. Dogged Detective (EDHREC 6887) - When this creature enters, surveil 2.
142. Kaalia, Zenith Seeker (EDHREC 6898) - When Kaalia enters, look at the top six cards of your library.
143. Carth the Lion (EDHREC 6964) - Whenever Carth enters or a planeswalker you control dies, look at the top seven cards of your library.
144. Dragonlord Ojutai (EDHREC 7000) - Whenever Dragonlord Ojutai deals combat damage to a player, look at the top three cards of your library.
145. Master of Death (EDHREC 7030) - When this creature enters, surveil 2.
146. Psychic Impetus (EDHREC 7045) - Whenever enchanted creature attacks, you scry 2.
147. Cosmic Cube (EDHREC 7051) - Whenever you attack, look at the top six cards of your library.
148. Crystal Ball (EDHREC 7061) - {1}, {T}: Scry 2. (Look at the top two cards of your library, then put any number of them on the bottom and the rest on top in any order.)
149. Lydia Frye (EDHREC 7092) - At the beginning of your end step, surveil X, where X is the number of tapped Assassins you control.
150. Thassa's Intervention (EDHREC 7119) - • Look at the top X cards of your library. Put up to two of them into your hand and the rest on the bottom of your library in a random order.
151. Galadriel of Lothlórien (EDHREC 7153) - Whenever the Ring tempts you, if you chose a creature other than Galadriel as your Ring-bearer, scry 3.
152. Lorehold Campus (EDHREC 7290) - {4}, {T}: Scry 1. (Look at the top card of your library. You may put that card on the bottom.)
153. Fading Hope (EDHREC 7301) - If its mana value was 3 or less, scry 1.
154. Diabolic Vision (EDHREC 7356) - Look at the top five cards of your library.
155. Nightveil Sprite (EDHREC 7373) - Whenever this creature attacks, surveil 1.
156. Web of Life and Destiny (EDHREC 7394) - At the beginning of combat on your turn, look at the top five cards of your library.
157. Watcher for Tomorrow (EDHREC 7430) - Hideaway 4 (When this creature enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)
158. Velomachus Lorehold (EDHREC 7498) - Whenever Velomachus Lorehold attacks, look at the top seven cards of your library.
159. Wall of Runes (EDHREC 7591) - When this creature enters, scry 1.
160. Confounding Riddle (EDHREC 7603) - • Look at the top four cards of your library. Put one of them into your hand and the rest into your graveyard.
161. Silver Raven (EDHREC 7634) - When this creature enters, scry 1.
162. Sea Gate Oracle (EDHREC 7641) - When this creature enters, look at the top two cards of your library.
163. Conjurer's Mantle (EDHREC 7674) - Whenever equipped creature attacks, look at the top six cards of your library.
164. Mystic Speculation (EDHREC 7708) - Scry 3.
165. Oath of Nissa (EDHREC 7721) - When Oath of Nissa enters, look at the top three cards of your library.
166. Strategic Planning (EDHREC 7739) - Look at the top three cards of your library.
167. Firja, Judge of Valor (EDHREC 7759) - Whenever you cast your second spell each turn, look at the top three cards of your library.
168. Sinister Hideout (EDHREC 7814) - {4}, {T}: Surveil 1. (Look at the top card of your library. You may put it into your graveyard.)
169. In Search of Greatness (EDHREC 7831) - If you don't, scry 1.
170. Arthur, Marigold Knight (EDHREC 7915) - Whenever Arthur and at least one other creature attack, look at the top six cards of your library.
171. Nine-Fingers Keene (EDHREC 7935) - Whenever Nine-Fingers Keene deals combat damage to a player, look at the top nine cards of your library.
172. Fortune, Loyal Steed (EDHREC 7983) - When Fortune enters, scry 2.
173. Radagast the Brown (EDHREC 7987) - Whenever Radagast or another nontoken creature you control enters, look at the top X cards of your library, where X is that creature's mana value.
174. Titan's Grave (EDHREC 8074) - {2}{B}{G}, {T}: Surveil 1. (Look at the top card of your library. You may put it into your graveyard.)
175. Nessian Wanderer (EDHREC 8142) - Constellation — Whenever an enchantment you control enters, look at the top three cards of your library. You may reveal a land card from among them and put that card into your hand. Put the rest on the bottom of your library in a random order.
176. Ruin-Lurker Bat (EDHREC 8175) - At the beginning of your end step, if you descended this turn, scry 1.
177. Devourer of Destiny (EDHREC 8184) - If you do, at the beginning of your first upkeep, look at the top four cards of your library.
178. Ominous Asylum (EDHREC 8201) - {4}, {T}: Surveil 1. (Look at the top card of your library. You may put it into your graveyard.)
179. Fated Infatuation (EDHREC 8329) - If it's your turn, scry 2.
180. Eclipsed Elf (EDHREC 8375) - When this creature enters, look at the top four cards of your library.
181. Augury Owl (EDHREC 8378) - When this creature enters, scry 3.
182. Adventurous Impulse (EDHREC 8390) - Look at the top three cards of your library.
183. Soothsaying (EDHREC 8437) - {X}: Look at the top X cards of your library, then put them back in any order.
184. Mindwhisker (EDHREC 8444) - At the beginning of your upkeep, surveil 1.
185. Commune with Beavers (EDHREC 8496) - Look at the top three cards of your library.
186. Harald, King of Skemfar (EDHREC 8523) - When Harald enters, look at the top five cards of your library.
187. Freeze in Place (EDHREC 8544) - Scry 2.
188. Lazav, the Multifarious (EDHREC 8568) - When Lazav enters, surveil 1.
189. Ancient Stirrings (EDHREC 8625) - Look at the top five cards of your library.
190. Kiora, Sovereign of the Deep (EDHREC 8640) - Whenever you cast a Kraken, Leviathan, Octopus, or Serpent spell from your hand, look at the top X cards of your library, where X is that spell's mana value.
191. Model of Unity (EDHREC 8661) - Whenever players finish voting, you and each opponent who voted for a choice you voted for may scry 2.
192. Supreme Will (EDHREC 8734) - • Look at the top four cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.
193. Avengers Tower (EDHREC 8737) - {4}, {T}: Look at the top three cards of your library. You may reveal a Hero card from among them and put it into your hand. Put the rest on the bottom of your library in any order.
194. Zurgo and Ojutai (EDHREC 8782) - Whenever one or more Dragons you control deal combat damage to a player or battle, look at the top three cards of your library.
195. Once Upon a Time (EDHREC 8839) - Look at the top five cards of your library.
196. Case of the Shifting Visage (EDHREC 8855) - At the beginning of your upkeep, surveil 1.
197. Samut's Sprint (EDHREC 8895) - Scry 1.
198. The Temporal Anchor (EDHREC 8910) - At the beginning of your upkeep, scry 2.
199. Eclipsed Flamekin (EDHREC 8924) - When this creature enters, look at the top four cards of your library.
200. Sultai Ascendancy (EDHREC 9012) - At the beginning of your upkeep, surveil 2.

### 4. Tap / Untap Effects

Source: existing queue family after library_search
Available after current queue exclusion: 533

1. Snap (EDHREC 267) - Untap up to two lands.
2. Dispatch (EDHREC 466) - Tap target creature.
3. Maze of Ith (EDHREC 543) - {T}: Untap target attacking creature. Prevent all combat damage that would be dealt to and dealt by that creature this turn.
4. Arbor Elf (EDHREC 596) - {T}: Untap target Forest.
5. Minamo, School at Water's Edge (EDHREC 602) - {U}, {T}: Untap target legendary permanent.
6. Thousand-Year Elixir (EDHREC 908) - {1}, {T}: Untap target creature.
7. Peregrine Drake (EDHREC 921) - When this creature enters, untap up to five lands.
8. Rewind (EDHREC 1005) - Untap up to four lands.
9. Unwind (EDHREC 1062) - Untap up to three lands.
10. Patriar's Seal (EDHREC 1185) - {1}, {T}: Untap target legendary creature you control.
11. Deserted Temple (EDHREC 1624) - {1}, {T}: Untap target land.
12. Clock of Omens (EDHREC 1735) - Tap two untapped artifacts you control: Untap target artifact.
13. Voltaic Key (EDHREC 1761) - {1}, {T}: Untap target artifact.
14. Retreat to Coralhelm (EDHREC 1768) - • You may tap or untap target creature.
15. Junk Winder (EDHREC 1822) - Whenever a token you control enters, tap target nonland permanent an opponent controls.
16. Port Razer (EDHREC 1917) - Whenever this creature deals combat damage to a player, untap each creature you control.
17. Quirion Ranger (EDHREC 2252) - Return a Forest you control to its owner's hand: Untap target creature.
18. Tyvar, Jubilant Brawler (EDHREC 2322) - +1: Untap up to one target creature.
19. Wirewood Lodge (EDHREC 2432) - {G}, {T}: Untap target Elf.
20. Anzrag, the Quake-Mole (EDHREC 2680) - Whenever Anzrag becomes blocked, untap each creature you control.
21. Magewright's Stone (EDHREC 2880) - {1}, {T}: Untap target creature that has an activated ability with {T} in its cost.
22. Derevi, Empyrial Tactician (EDHREC 2886) - When Derevi enters and whenever a creature you control deals combat damage to a player, you may tap or untap target permanent.
23. Tiller Engine (EDHREC 3290) - • Tap target nonland permanent an opponent controls.
24. Wirewood Symbiote (EDHREC 3533) - Return an Elf you control to its owner's hand: Untap target creature.
25. All-Out Assault (EDHREC 3713) - When you next attack this turn, untap each creature you control.
26. Seeker of Skybreak (EDHREC 3949) - {T}: Untap target creature.
27. Merrow Reejerey (EDHREC 3988) - Whenever you cast a Merfolk spell, you may tap or untap target permanent.
28. Earthcraft (EDHREC 4142) - Tap an untapped creature you control: Untap target basic land.
29. Hidden Strings (EDHREC 4243) - You may tap or untap target permanent, then you may tap or untap another target permanent.
30. Teferi, Temporal Archmage (EDHREC 4320) - −1: Untap up to four target permanents.
31. Grim Reaper's Sprint (EDHREC 4537) - When this Aura enters, untap each creature you control.
32. Ring of the Lucii (EDHREC 4569) - {2}, {T}, Pay 1 life: Tap target nonland permanent.
33. Kelpie Guide (EDHREC 4656) - {T}: Tap target permanent. Activate only if you control eight or more lands.
34. Aphetto Alchemist (EDHREC 4967) - {T}: Untap target artifact or creature.
35. Scryb Ranger (EDHREC 5351) - Return a Forest you control to its owner's hand: Untap target creature.
36. Shriekwood Devourer (EDHREC 5431) - Whenever you attack with one or more creatures, untap up to X lands, where X is the greatest power among those creatures.
37. Copperhorn Scout (EDHREC 5531) - Whenever this creature attacks, untap each other creature you control.
38. High Alert (EDHREC 5624) - {2}{W}{U}: Untap target creature.
39. Chakram Retriever (EDHREC 6024) - Whenever you cast a spell during your turn, untap target creature.
40. Sanctum of Tranquil Light (EDHREC 6038) - {5}{W}: Tap target creature. This ability costs {1} less to activate for each Shrine you control.
41. Tori D'Avenant, Fury Rider (EDHREC 6076) - Untap each other white attacking creature you control.
42. Opposition (EDHREC 6148) - Tap an untapped creature you control: Tap target artifact, creature, or land.
43. Oboro Breezecaller (EDHREC 6436) - {2}, Return a land you control to its owner's hand: Untap target land.
44. Myr Galvanizer (EDHREC 6440) - {1}, {T}: Untap each other Myr you control.
45. Laser Screwdriver (EDHREC 6538) - {1}, {T}: Tap target artifact.
46. Blustersquall (EDHREC 6671) - Tap target creature you don't control.
47. Elvish Mariner (EDHREC 6696) - Whenever you scry, tap up to X target nonland permanents, where X is the number of cards looked at while scrying this way.
48. Nissa, Steward of Elements (EDHREC 6714) - −6: Untap up to two target lands you control.
49. Time Spiral (EDHREC 6868) - You untap up to six lands.
50. Ty Lee, Chi Blocker (EDHREC 6901) - When Ty Lee enters, tap up to one target creature.
51. Merchant Raiders (EDHREC 6923) - Whenever this creature or another Pirate you control enters, tap up to one target creature.
52. Raggadragga, Goreguts Boss (EDHREC 7146) - Whenever you cast a spell, if at least seven mana was spent to cast it, untap target creature.
53. Captain America's Shield (EDHREC 7270) - Whenever equipped creature attacks, tap target creature defending player controls.
54. Nature's Chosen (EDHREC 7341) - Tap enchanted creature: Untap target artifact, creature, or land.
55. Court Street Denizen (EDHREC 7496) - Whenever another white creature you control enters, tap target creature an opponent controls.
56. Lorthos, the Tidemaker (EDHREC 7545) - If you do, tap up to eight target permanents.
57. You See a Guard Approach (EDHREC 7587) - • Distract the Guard — Tap target creature.
58. Elder Deep-Fiend (EDHREC 7719) - When you cast this spell, tap up to four target permanents.
59. Twiddle (EDHREC 7783) - You may tap or untap target artifact, creature, or land.
60. Killian, Decisive Mentor (EDHREC 7826) - Whenever an enchantment you control enters, tap up to one target creature and goad it.
61. Niblis of Frost (EDHREC 7978) - Whenever you cast an instant or sorcery spell, tap target creature an opponent controls.
62. Mind Over Matter (EDHREC 8002) - Discard a card: You may tap or untap target artifact, creature, or land.
63. Treachery (EDHREC 8028) - When this Aura enters, untap up to five lands.
64. Dreamshackle Geist (EDHREC 8121) - • Tap target creature.
65. Forensic Researcher (EDHREC 8155) - {T}, Collect evidence 3: Tap target creature you don't control. (To collect evidence 3, exile cards with total mana value 3 or greater from your graveyard.)
66. Voltaic Construct (EDHREC 8336) - {2}: Untap target artifact creature.
67. Energy Tap (EDHREC 8340) - Tap target untapped creature you control.
68. Voyaging Satyr (EDHREC 8493) - {T}: Untap target land.
69. Freeze in Place (EDHREC 8544) - Tap target creature an opponent controls and put three stun counters on it.
70. Crashing Wave (EDHREC 8707) - Tap up to X target creatures, then distribute three stun counters among any number of tapped creatures your opponents control.
71. Mirran Spy (EDHREC 8727) - Whenever you cast an artifact spell, you may untap target creature.
72. Corridor Monitor (EDHREC 8962) - When this creature enters, untap target artifact or creature you control.
73. North Pole Patrol (EDHREC 9031) - Waterbend {3}, {T}: Tap target creature an opponent controls.
74. Binding Mummy (EDHREC 9186) - Whenever another Zombie you control enters, you may tap target artifact or creature.
75. Ojutai, Soul of Winter (EDHREC 9239) - Whenever a Dragon you control attacks, tap target nonland permanent an opponent controls.
76. Urza's Rebuff (EDHREC 9253) - • Tap up to two target creatures.
77. Archipelagore (EDHREC 9275) - Whenever this creature mutates, tap up to X target creatures, where X is the number of times this creature has mutated.
78. Hyrax Tower Scout (EDHREC 9295) - When this creature enters, untap target creature.
79. Dream's Grip (EDHREC 9324) - • Tap target permanent.
80. High-Speed Hoverbike (EDHREC 9470) - When this Vehicle enters, tap up to one target creature.
81. Topplegeist (EDHREC 9481) - When this creature enters, tap target creature an opponent controls.
82. Puppet Strings (EDHREC 9497) - {2}, {T}: You may tap or untap target creature.
83. Clever Conjurer (EDHREC 9550) - Mage Hand — {T}: Untap target permanent not named Clever Conjurer. Activate only as a sorcery.
84. Frost Titan (EDHREC 9561) - Whenever this creature enters or attacks, tap target permanent.
85. Veteran Beastrider (EDHREC 9689) - At the beginning of your end step, untap each creature you control.
86. Merfolk Trickster (EDHREC 9741) - When this creature enters, tap target creature an opponent controls.
87. Octopus Umbra (EDHREC 9747) - Enchanted creature has base power and toughness 8/8 and has "Whenever this creature attacks, you may tap target creature with power 8 or less."
88. Timin, Youthful Geist (EDHREC 9952) - At the beginning of each combat, tap up to one target creature.
89. Yosei, the Morning Star (EDHREC 9987) - Tap up to five target permanents that player controls.
90. Stone-Seeder Hierophant (EDHREC 10035) - {T}: Untap target land.
91. Sewer-veillance Cam (EDHREC 10229) - When this artifact enters or leaves the battlefield, you may tap or untap target creature.
92. Voltaic Servant (EDHREC 10303) - At the beginning of your end step, untap target artifact.
93. Dross Scorpion (EDHREC 10411) - Whenever this creature or another artifact creature dies, you may untap target artifact.
94. Icy Manipulator (EDHREC 10541) - {1}, {T}: Tap target artifact, creature, or land.
95. Krosan Restorer (EDHREC 10663) - {T}: Untap target land.
96. Gigadrowse (EDHREC 10665) - Tap target permanent.
97. Pestermite (EDHREC 10725) - When this creature enters, you may tap or untap target permanent.
98. Cacophodon (EDHREC 10879) - Enrage — Whenever this creature is dealt damage, untap target permanent.
99. Icingdeath, Frost Tyrant (EDHREC 10880) - When Icingdeath, Frost Tyrant dies, create Icingdeath, Frost Tongue, a legendary white Equipment artifact token with "Equipped creature gets +2/+0," "Whenever equipped creature attacks, tap target creature defending player controls," and equip {2}.
100. Network Disruptor (EDHREC 10931) - When this creature enters, tap target permanent.
101. Mind Games (EDHREC 11063) - Tap target artifact, creature, or land.
102. Icebind Pillar (EDHREC 11111) - {S}, {T}: Tap target artifact or creature. ({S} can be paid with one mana from a snow source.)
103. Nebelgast Herald (EDHREC 11215) - Whenever this creature or another Spirit you control enters, tap target creature an opponent controls.
104. Glare of Subdual (EDHREC 11470) - Tap an untapped creature you control: Tap target artifact or creature.
105. Great Whale (EDHREC 11523) - When this creature enters, untap up to seven lands.
106. Mental Modulation (EDHREC 11624) - Tap target artifact or creature.
107. Sculptor of Winter (EDHREC 11658) - {T}: Untap target snow land.
108. Web-Shooters (EDHREC 11773) - Equipped creature gets +1/+1 and has reach and "Whenever this creature attacks, tap target creature an opponent controls."
109. Skateboard (EDHREC 11800) - When this Equipment enters, tap target permanent.
110. Gideon's Lawkeeper (EDHREC 11878) - {W}, {T}: Tap target creature.
111. Flash Thompson, Spider-Fan (EDHREC 11884) - • Heckle — Tap target creature.
112. Katara's Reversal (EDHREC 12037) - Untap up to four target artifacts and/or creatures.
113. Icewrought Sentry (EDHREC 12103) - When you do, tap target creature an opponent controls.
114. Abominable Treefolk (EDHREC 12294) - When this creature enters, tap target creature an opponent controls.
115. Thistledown Players (EDHREC 12304) - Whenever this creature attacks, untap target nonland permanent.
116. Impede Momentum (EDHREC 12346) - Tap target creature and put three stun counters on it.
117. Imperial Subduer (EDHREC 12354) - Whenever a Samurai or Warrior you control attacks alone, tap target creature you don't control.
118. Mouse Trapper (EDHREC 12409) - Valiant — Whenever this creature becomes the target of a spell or ability you control for the first time each turn, tap target creature an opponent controls.
119. Shacklegeist (EDHREC 12504) - Tap two untapped Spirits you control: Tap target creature you don't control.
120. Icefall Regent (EDHREC 12820) - When this creature enters, tap target creature an opponent controls.
121. Eddymurk Crab (EDHREC 12847) - When this creature enters, tap up to two target creatures.
122. Tranquilize (EDHREC 12865) - Tap target creature an opponent controls and put three stun counters on it.
123. Word of Seizing (EDHREC 12909) - Untap target permanent and gain control of it until end of turn.
124. Pore Over the Pages (EDHREC 12910) - Draw three cards, untap up to two lands, then discard a card.
125. Downpour (EDHREC 13111) - Tap up to three target creatures.
126. Filigree Sages (EDHREC 13265) - {2}{U}: Untap target artifact.
127. Angelic Benediction (EDHREC 13308) - Whenever a creature you control attacks alone, you may tap target creature.
128. Minister of Impediments (EDHREC 13310) - {T}: Tap target creature.
129. Glamermite (EDHREC 13463) - • Tap target creature.
130. Guardian of Tazeem (EDHREC 13520) - Landfall — Whenever a land you control enters, tap target creature an opponent controls. If that land is an Island, that creature doesn't untap during its controller's next untap step.
131. Deceiver Exarch (EDHREC 13624) - • Untap target permanent you control.
132. Djeru's Resolve (EDHREC 13718) - Untap target creature.
133. Procrastinate (EDHREC 13801) - Tap target creature.
134. Stall Out (EDHREC 13945) - Tap target creature or Vehicle, then put three stun counters on it.
135. Niblis of the Urn (EDHREC 13964) - Whenever this creature attacks, you may tap target creature.
136. Rowdy Snowballers (EDHREC 14028) - When this creature enters, tap target creature an opponent controls and put a stun counter on it.
137. Stinging Lionfish (EDHREC 14126) - Whenever you cast your first spell during each opponent's turn, you may tap or untap target nonland permanent.
138. Swashbuckler's Whip (EDHREC 14182) - Equipped creature has reach, "{2}, {T}: Tap target artifact or creature," and "{8}, {T}: Discover 10." (Exile cards from the top of your library until you exile a nonland card with mana value 10 or less. Cast it without paying its mana cost or put it into your hand. Put the rest on the bottom in a random order.)
139. Tidal Bore (EDHREC 14222) - You may tap or untap target creature.
140. Feeling of Dread (EDHREC 14360) - Tap up to two target creatures.
141. Gilded Scuttler (EDHREC 14399) - When this creature enters, tap target creature an opponent controls and put a stun counter on it.
142. Trusty Boomerang (EDHREC 14429) - Equipped creature has "{1}, {T}: Tap target creature.
143. Azorius Guildmage (EDHREC 14489) - {2}{W}: Tap target creature.
144. Telekinetic Sliver (EDHREC 14491) - All Slivers have "{T}: Tap target permanent."
145. Rishadan Port (EDHREC 14499) - {1}, {T}: Tap target land.
146. Breath of the Sleepless (EDHREC 14511) - Whenever you cast a creature spell during an opponent's turn, tap up to one target creature.
147. Sanctuary Lockdown (EDHREC 14550) - {2}, Tap two untapped Humans you control: Tap target creature an opponent controls.
148. Ultros, Obnoxious Octopus (EDHREC 14687) - Whenever you cast a noncreature spell, if at least four mana was spent to cast it, tap target creature an opponent controls and put a stun counter on it.
149. Pressure Point (EDHREC 14730) - Tap target creature.
150. Juvenile Mist Dragon (EDHREC 14745) - Confounding Clouds — When this creature enters, for each opponent, tap up to one target creature that player controls. Each of those creatures doesn't untap during its controller's next untap step.
151. Curse of Inertia (EDHREC 14886) - Whenever a player attacks enchanted player with one or more creatures, that attacking player may tap or untap target permanent of their choice.
152. Mechanozoa (EDHREC 14981) - When this creature enters, tap target artifact or creature an opponent controls and put a stun counter on it.
153. The Wondrous Wasp (EDHREC 15013) - Wasp's Sting — When The Wondrous Wasp enters, tap up to one target creature. It loses all abilities for as long as The Wondrous Wasp remains on the battlefield.
154. Loch Mare (EDHREC 15050) - {2}{U}, Remove two counters from this creature: Tap target creature. Put a stun counter on it. (If a permanent with a stun counter would become untapped, remove one from it instead.)
155. Silvanus's Invoker (EDHREC 15128) - Conjure Elemental — {8}: Untap target land you control. It becomes an 8/8 Elemental creature with trample and haste until end of turn. It's still a land.
156. Nissa, Genesis Mage (EDHREC 15149) - +2: Untap up to two target creatures and up to two target lands.
157. Aim High (EDHREC 15227) - Untap target creature.
158. Goldmeadow Harrier (EDHREC 15290) - {W}, {T}: Tap target creature.
159. Puppeteer (EDHREC 15329) - {U}, {T}: You may tap or untap target creature.
160. Hands of Binding (EDHREC 15490) - Tap target creature an opponent controls.
161. Vibrant Outburst (EDHREC 15511) - Tap up to one target creature.
162. Scepter of Dominance (EDHREC 15689) - {W}, {T}: Tap target permanent.
163. Squall Drifter (EDHREC 15716) - {W}, {T}: Tap target creature.
164. Threaten (EDHREC 15736) - Untap target creature and gain control of it until end of turn.
165. The Wasp, Winsome Avenger (EDHREC 15827) - Whenever The Wasp attacks, tap target creature defending player controls.
166. Thunder Lasso (EDHREC 15833) - Whenever equipped creature attacks, tap target creature defending player controls.
167. Ojutai Exemplars (EDHREC 15873) - • Tap target creature.
168. Champions of the Shoal (EDHREC 15916) - Whenever this creature enters or becomes tapped, tap up to one target creature and put a stun counter on it.
169. You're Confronted by Robbers (EDHREC 15937) - • Stall for Time — Tap up to three target creatures.
170. Greenside Watcher (EDHREC 15955) - {T}: Untap target Gate.
171. Rustvine Cultivator (EDHREC 15993) - {T}, Remove an oil counter from this creature: Untap target land.
172. Jandor's Saddlebags (EDHREC 16003) - {3}, {T}: Untap target creature.
173. White Dragon (EDHREC 16151) - Cold Breath — When this creature enters, tap target creature an opponent controls. That creature doesn't untap during its controller's next untap step.
174. Blinkmoth Well (EDHREC 16199) - {2}, {T}: Tap target noncreature artifact.
175. Berg Strider (EDHREC 16260) - When this creature enters, tap target artifact or creature an opponent controls.
176. Rapier Wit (EDHREC 16389) - Tap target creature.
177. Kang Dynasty (EDHREC 16433) - I, II — For each opponent, tap up to one target creature that player controls. Goad those creatures. Until your next turn, whenever any of those creatures deals combat damage to a player, draw a card.
178. Sunstar Chaplain (EDHREC 16500) - {2}, Remove a +1/+1 counter from a creature you control: Tap target artifact or creature.
179. Sygg's Command (EDHREC 16503) - • Tap target creature. Put a stun counter on it.
180. Tidal Force (EDHREC 16554) - At the beginning of each upkeep, you may tap or untap target permanent.
181. Choking Tethers (EDHREC 16607) - Tap up to four target creatures.
182. Jolt (EDHREC 16725) - You may tap or untap target artifact, creature, or land.
183. Sentinel of the Eternal Watch (EDHREC 16789) - At the beginning of combat on each opponent's turn, tap target creature that player controls.
184. Fear of Immobility (EDHREC 16921) - When this creature enters, tap up to one target creature.
185. Hope Tender (EDHREC 16963) - {1}, {T}: Untap target land.
186. Blessed Alliance (EDHREC 17013) - • Untap up to two target creatures.
187. Disciple of the Ring (EDHREC 17068) - • Tap target creature.
188. Deepchannel Duelist (EDHREC 17139) - At the beginning of your end step, untap target Merfolk you control.
189. Rishadan Dockhand (EDHREC 17151) - {1}, {T}: Tap target land.
190. Act of Heroism (EDHREC 17233) - Untap target creature.
191. Sunstrike Legionnaire (EDHREC 17281) - {T}: Tap target creature with mana value 3 or less.
192. Niblis of the Breath (EDHREC 17308) - {U}, {T}: You may tap or untap target creature.
193. Ray of Command (EDHREC 17317) - Untap target creature an opponent controls and gain control of it until end of turn.
194. Frost Trickster (EDHREC 17420) - When this creature enters, tap target creature an opponent controls.
195. Coeurl (EDHREC 17488) - {1}{W}, {T}: Tap target nonenchantment creature.
196. Spinning Wheel (EDHREC 17520) - {5}, {T}: Tap target creature.
197. Frost Breath (EDHREC 17548) - Tap up to two target creatures.
198. Ivorytusk Fortress (EDHREC 17574) - Untap each creature you control with a +1/+1 counter on it during each other player's untap step.
199. Glaring Aegis (EDHREC 17577) - When this Aura enters, tap target creature an opponent controls.
200. Ornamental Courage (EDHREC 17595) - Untap target creature.

### 5. Counterspell And Stack Interaction

Source: existing queue family after library_search
Available after current queue exclusion: 244

1. Counterspell (EDHREC 16) - Counter target spell.
2. Mana Drain (EDHREC 117) - Counter target spell.
3. Force of Will (EDHREC 193) - Counter target spell.
4. Pact of Negation (EDHREC 365) - Counter target spell.
5. Mental Misstep (EDHREC 458) - Counter target spell with mana value 1.
6. Tibalt's Trickery (EDHREC 590) - Counter target spell.
7. Rewind (EDHREC 1005) - Counter target spell.
8. Rebuff the Wicked (EDHREC 1558) - Counter target spell that targets a permanent you control.
9. Mana Leak (EDHREC 1730) - Counter target spell unless its controller pays {3}.
10. Disallow (EDHREC 1823) - Counter target spell, activated ability, or triggered ability.
11. Cancel (EDHREC 2042) - Counter target spell.
12. Dawn Charm (EDHREC 2087) - • Counter target spell that targets you.
13. Delay (EDHREC 2119) - Counter target spell.
14. Mana Tithe (EDHREC 2144) - Counter target spell unless its controller pays {1}.
15. Disdainful Stroke (EDHREC 2384) - Counter target spell with mana value 4 or greater.
16. Not of This World (EDHREC 2467) - Counter target spell or ability that targets a permanent you control.
17. Wash Away (EDHREC 2893) - Counter target spell [that wasn't cast from its owner's hand].
18. Saw It Coming (EDHREC 2991) - Counter target spell.
19. Daze (EDHREC 3103) - Counter target spell unless its controller pays {1}.
20. Render Silent (EDHREC 3140) - Counter target spell.
21. Memory Lapse (EDHREC 3192) - Counter target spell.
22. Ertai Resurrected (EDHREC 3357) - • Counter target spell, activated ability, or triggered ability. Its controller draws a card.
23. Didn't Say Please (EDHREC 3423) - Counter target spell.
24. Spellstutter Sprite (EDHREC 3621) - When this creature enters, counter target spell with mana value X or less, where X is the number of Faeries you control.
25. Syncopate (EDHREC 3847) - Counter target spell unless its controller pays {X}.
26. It'll Quench Ya! (EDHREC 3865) - Counter target spell unless its controller pays {2}.
27. Spell Stutter (EDHREC 4006) - Counter target spell unless its controller pays {2} plus an additional {1} for each Faerie you control.
28. Dazzling Denial (EDHREC 4121) - Counter target spell unless its controller pays {2}.
29. Foil (EDHREC 4262) - Counter target spell.
30. Amazing Acrobatics (EDHREC 4442) - • Counter target spell.
31. Mana Sculpt (EDHREC 4488) - Counter target spell.
32. Voidslime (EDHREC 4514) - Counter target spell, activated ability, or triggered ability.
33. Reject Imperfection (EDHREC 4680) - Counter target spell.
34. Wizard's Retort (EDHREC 4711) - Counter target spell.
35. Tale's End (EDHREC 4763) - Counter target activated ability, triggered ability, or legendary spell.
36. Fear of Impostors (EDHREC 5198) - When this creature enters, counter target spell.
37. Lofty Denial (EDHREC 5278) - Counter target spell unless its controller pays {1}.
38. Electrosiphon (EDHREC 5625) - Counter target spell.
39. Thought Collapse (EDHREC 5641) - Counter target spell.
40. Mystic Snake (EDHREC 5681) - When this creature enters, counter target spell.
41. Counterflux (EDHREC 5795) - Counter target spell you don't control.
42. No More Lies (EDHREC 5806) - Counter target spell unless its controller pays {3}.
43. Don't Make a Sound (EDHREC 5992) - Counter target spell unless its controller pays {2}.
44. Condescend (EDHREC 6044) - Counter target spell unless its controller pays {X}.
45. Dissolve (EDHREC 6219) - Counter target spell.
46. Dissipate (EDHREC 6314) - Counter target spell.
47. Sinister Sabotage (EDHREC 6321) - Counter target spell.
48. Fuel for the Cause (EDHREC 6355) - Counter target spell, then proliferate.
49. Lapse of Certainty (EDHREC 6357) - Counter target spell.
50. Disruption Protocol (EDHREC 6431) - Counter target spell.
51. Turn Aside (EDHREC 6526) - Counter target spell that targets a permanent you control.
52. Plasm Capture (EDHREC 6564) - Counter target spell.
53. Stoic Rebuttal (EDHREC 6580) - Counter target spell.
54. Familiar's Ruse (EDHREC 6930) - Counter target spell.
55. Frilled Mystic (EDHREC 7094) - When this creature enters, you may counter target spell.
56. Thassa's Intervention (EDHREC 7119) - • Counter target spell unless its controller pays twice {X}.
57. Desertion (EDHREC 7213) - Counter target spell.
58. Transcendent Dragon (EDHREC 7219) - When this creature enters, if you cast it, counter target spell.
59. Temur Charm (EDHREC 7248) - • Counter target spell unless its controller pays {3}.
60. Consign to Memory (EDHREC 7280) - Counter target triggered ability or colorless spell.
61. Circular Logic (EDHREC 7505) - Counter target spell unless its controller pays {1} for each card in your graveyard.
62. Kheru Spellsnatcher (EDHREC 7599) - When this creature is turned face up, counter target spell.
63. Confounding Riddle (EDHREC 7603) - • Counter target spell unless its controller pays {4}.
64. Spectral Denial (EDHREC 8220) - Counter target spell unless its controller pays {X}.
65. Quandrix Charm (EDHREC 8400) - • Counter target spell unless its controller pays {2}.
66. Mirrorshell Crab (EDHREC 8411) - Channel — {2}{U}, Discard this card: Counter target spell or ability unless its controller pays {3}.
67. Spell Snare (EDHREC 8515) - Counter target spell with mana value 2.
68. Insidious Will (EDHREC 8558) - • Counter target spell.
69. Supreme Will (EDHREC 8734) - • Counter target spell unless its controller pays {3}.
70. Psychic Strike (EDHREC 8987) - Counter target spell.
71. Dispelling Exhale (EDHREC 9028) - Counter target spell unless its controller pays {2}.
72. Urza's Rebuff (EDHREC 9253) - • Counter target spell.
73. Twist Reality (EDHREC 9260) - • Counter target spell.
74. Ertai's Scorn (EDHREC 9262) - Counter target spell.
75. Forceful Denial (EDHREC 9284) - Counter target spell.
76. Counterpoint (EDHREC 9574) - Counter target spell.
77. Reinterpret (EDHREC 9582) - Counter target spell.
78. Deprive (EDHREC 9725) - Counter target spell.
79. Spell Burst (EDHREC 10176) - Counter target spell with mana value X.
80. Bring the Ending (EDHREC 10191) - Counter target spell unless its controller pays {2}.
81. Lose Focus (EDHREC 10261) - Counter target spell unless its controller pays {2}.
82. Disrupting Shoal (EDHREC 10296) - Counter target spell if its mana value is X.
83. Patron Wizard (EDHREC 10401) - Tap an untapped Wizard you control: Counter target spell unless its controller pays {1}.
84. Lookout's Dispersal (EDHREC 10475) - Counter target spell unless its controller pays {4}.
85. Dash Hopes (EDHREC 10538) - Counter target spell.
86. Convolute (EDHREC 10900) - Counter target spell unless its controller pays {4}.
87. Metallic Rebuke (EDHREC 10946) - Counter target spell unless its controller pays {3}.
88. Mystical Dispute (EDHREC 11021) - Counter target spell unless its controller pays {3}.
89. Admiral's Order (EDHREC 11327) - Counter target spell.
90. Spell Rupture (EDHREC 11439) - Counter target spell unless its controller pays {X}, where X is the greatest power among creatures you control.
91. Hinder (EDHREC 11711) - Counter target spell.
92. Confound (EDHREC 11882) - Counter target spell that targets a creature.
93. Katara's Reversal (EDHREC 12037) - Counter up to four target spells and/or abilities.
94. Void Shatter (EDHREC 12106) - Counter target spell.
95. Hope-Ender Coatl (EDHREC 12123) - When you cast this spell, counter target spell an opponent controls unless they pay {1}.
96. Voidmage Apprentice (EDHREC 12191) - When this creature is turned face up, counter target spell.
97. Fugitive Droid (EDHREC 12195) - {U}, Sacrifice this creature: Counter target spell that targets an artifact or creature you control.
98. Assert Authority (EDHREC 12272) - Counter target spell.
99. Broken Ambitions (EDHREC 12359) - Counter target spell unless its controller pays {X}.
100. Clash of Wills (EDHREC 12505) - Counter target spell unless its controller pays {X}.
101. Logic Knot (EDHREC 12608) - Counter target spell unless its controller pays {X}.
102. Scattering Stroke (EDHREC 12703) - Counter target spell.
103. Spell Crumple (EDHREC 12726) - Counter target spell.
104. Devious Cover-Up (EDHREC 12780) - Counter target spell.
105. Wild Unraveling (EDHREC 12895) - Counter target spell.
106. Quench (EDHREC 12934) - Counter target spell unless its controller pays {2}.
107. Silumgar's Scorn (EDHREC 13001) - Counter target spell unless its controller pays {1}.
108. Force Spike (EDHREC 13232) - Counter target spell unless its controller pays {1}.
109. Censor (EDHREC 13268) - Counter target spell unless its controller pays {1}.
110. School Daze (EDHREC 13278) - • Fight Crime — Counter target spell. Draw a card.
111. Complicate (EDHREC 13357) - Counter target spell unless its controller pays {3}.
112. Brush Off (EDHREC 13536) - Counter target spell.
113. Corrupted Resolve (EDHREC 13566) - Counter target spell if its controller is poisoned.
114. Out of Air (EDHREC 13584) - Counter target spell.
115. Countermand (EDHREC 13981) - Counter target spell.
116. Unravel (EDHREC 14046) - Counter target spell.
117. Change the Equation (EDHREC 14061) - • Counter target spell with mana value 2 or less.
118. Ulamog's Nullifier (EDHREC 14250) - If you do, counter target spell.
119. Ooze Spill (EDHREC 14402) - Counter target spell.
120. We Say Thee Nay! (EDHREC 14459) - Counter target spell unless its controller pays {2}.
121. Azorius Guildmage (EDHREC 14489) - {2}{U}: Counter target activated ability. (Mana abilities can't be targeted.)
122. Minor Misstep (EDHREC 14616) - Counter target spell with mana value 1 or less.
123. Rites of Refusal (EDHREC 14631) - Counter target spell unless its controller pays {3} for each card discarded this way.
124. Soratami Savant (EDHREC 14790) - {3}, Return a land you control to its owner's hand: Counter target spell unless its controller pays {3}.
125. Thassa's Rebuff (EDHREC 14932) - Counter target spell unless its controller pays {X}, where X is your devotion to blue.
126. Bind (EDHREC 15242) - Counter target activated ability.
127. Thwart (EDHREC 15412) - Counter target spell.
128. Intervene (EDHREC 15728) - Counter target spell that targets a creature.
129. Soul Read (EDHREC 15733) - • Counter target spell unless its controller pays {4}.
130. Overwhelming Denial (EDHREC 16114) - Counter target spell.
131. Calculated Dismissal (EDHREC 16162) - Counter target spell unless its controller pays {3}.
132. Geistlight Snare (EDHREC 16164) - Counter target spell unless its controller pays {3}.
133. Reasonable Doubt (EDHREC 16250) - Counter target spell unless its controller pays {2}.
134. Counterlash (EDHREC 16494) - Counter target spell.
135. Memory Drain (EDHREC 16502) - Counter target spell.
136. Spell Shrivel (EDHREC 16532) - Counter target spell unless its controller pays {4}.
137. Scatter to the Winds (EDHREC 16653) - Counter target spell.
138. Spelljack (EDHREC 16695) - Counter target spell.
139. Rimewind Cryomancer (EDHREC 16698) - {1}, {T}: Counter target activated ability. Activate only if you control four or more snow permanents. (Mana abilities can't be targeted.)
140. Dispersal Shield (EDHREC 17005) - Counter target spell if its mana value is less than or equal to the greatest mana value among permanents you control.
141. Disruptive Pitmage (EDHREC 17581) - {T}: Counter target spell unless its controller pays {1}.
142. Evasive Action (EDHREC 17793) - Domain — Counter target spell unless its controller pays {1} for each basic land type among lands you control.
143. Out of Bounds (EDHREC 18142) - Counter target spell.
144. Ertai, the Corrupted (EDHREC 18147) - {U}, {T}, Sacrifice a creature or enchantment: Counter target spell.
145. Crush Dissent (EDHREC 18243) - Counter target spell unless its controller pays {2}.
146. Declaration of Naught (EDHREC 18249) - {U}: Counter target spell with the chosen name.
147. Override (EDHREC 18286) - Counter target spell unless its controller pays {1} for each artifact you control.
148. Disappearing Act (EDHREC 18304) - Counter target spell.
149. Unified Will (EDHREC 18342) - Counter target spell if you control more creatures than that spell's controller.
150. Broken Concentration (EDHREC 18364) - Counter target spell.
151. Ertai, Wizard Adept (EDHREC 18416) - {2}{U}{U}, {T}: Counter target spell.
152. Rakshasa's Disdain (EDHREC 18562) - Counter target spell unless its controller pays {1} for each card in your graveyard.
153. Mystic Genesis (EDHREC 18655) - Counter target spell.
154. Spell Snuff (EDHREC 18668) - Counter target spell.
155. Last Word (EDHREC 18920) - Counter target spell.
156. Sage's Dousing (EDHREC 19007) - Counter target spell unless its controller pays {3}.
157. Voidmage Husher (EDHREC 19218) - When this creature enters, counter target activated ability.
158. Diplomatic Escort (EDHREC 19295) - {U}, {T}, Discard a card: Counter target spell or ability that targets a creature.
159. Contradict (EDHREC 19390) - Counter target spell.
160. Sunken Field (EDHREC 19404) - Enchanted land has "{T}: Counter target spell unless its controller pays {1}."
161. Spiketail Drakeling (EDHREC 19549) - Sacrifice this creature: Counter target spell unless its controller pays {2}.
162. Grip of Amnesia (EDHREC 19642) - Counter target spell unless its controller exiles all cards from their graveyard.
163. Spiketail Hatchling (EDHREC 19729) - Sacrifice this creature: Counter target spell unless its controller pays {1}.
164. Traumatic Visions (EDHREC 19862) - Counter target spell.
165. Spell Syphon (EDHREC 20331) - Counter target spell unless its controller pays {1} for each blue permanent you control.
166. Disruptive Student (EDHREC 20505) - {T}: Counter target spell unless its controller pays {1}.
167. Double Negative (EDHREC 20803) - Counter up to two target spells.
168. Vigilant Martyr (EDHREC 20826) - {W}{W}, {T}, Sacrifice this creature: Counter target spell that targets an enchantment.
169. Induce Paranoia (EDHREC 21190) - Counter target spell.
170. Jaded Response (EDHREC 21211) - Counter target spell if it shares a color with a creature you control.
171. Martyr of Frost (EDHREC 21388) - {2}, Reveal X blue cards from your hand, Sacrifice this creature: Counter target spell unless its controller pays {X}.
172. Wizard Replica (EDHREC 21687) - {U}, Sacrifice this creature: Counter target spell unless its controller pays {2}.
173. Discombobulate (EDHREC 21782) - Counter target spell.
174. Failed Inspection (EDHREC 21804) - Counter target spell.
175. Squelch (EDHREC 22069) - Counter target activated ability.
176. Teferi's Response (EDHREC 22073) - Counter target spell or ability an opponent controls that targets a land you control.
177. Lilting Refrain (EDHREC 22215) - Sacrifice this enchantment: Counter target spell unless its controller pays {X}, where X is the number of verse counters on this enchantment.
178. Equinox (EDHREC 22241) - Enchanted land has "{T}: Counter target spell if it would destroy a land you control."
179. Interdict (EDHREC 22421) - Counter target activated ability from an artifact, creature, enchantment, or land.
180. Prohibit (EDHREC 22441) - Counter target spell if its mana value is 2 or less.
181. Hindering Touch (EDHREC 22579) - Counter target spell unless its controller pays {2}.
182. Mindstatic (EDHREC 22655) - Counter target spell unless its controller pays {6}.
183. Fervent Denial (EDHREC 22660) - Counter target spell.
184. Silumgar Spell-Eater (EDHREC 22668) - When this creature is turned face up, counter target spell unless its controller pays {3}.
185. Ixidor's Will (EDHREC 22771) - Counter target spell unless its controller pays {2} for each Wizard on the battlefield.
186. Confusticate and Bebother (EDHREC 22843) - • Counter target spell unless its controller pays {4}.
187. Rethink (EDHREC 22881) - Counter target spell unless its controller pays {X}, where X is its mana value.
188. Stymied Hopes (EDHREC 23088) - Counter target spell unless its controller pays {1}.
189. Vodalian Mage (EDHREC 23422) - {U}, {T}: Counter target spell unless its controller pays {1}.
190. Ghost-Lit Warder (EDHREC 23565) - {3}{U}, {T}: Counter target spell unless its controller pays {2}.
191. Outwit (EDHREC 23756) - Counter target spell that targets a player.
192. Punish Ignorance (EDHREC 24004) - Counter target spell.
193. Lost in the Mist (EDHREC 24046) - Counter target spell.
194. Oppressive Will (EDHREC 24094) - Counter target spell unless its controller pays {1} for each card in your hand.
195. Suffocating Blast (EDHREC 24112) - Counter target spell and Suffocating Blast deals 3 damage to target creature.
196. Lay Bare (EDHREC 24140) - Counter target spell.
197. Statute of Denial (EDHREC 24250) - Counter target spell.
198. Mundungu (EDHREC 24291) - {T}: Counter target spell unless its controller pays {1} and 1 life.
199. Vex (EDHREC 24477) - Counter target spell.
200. Dismissive Denial (EDHREC 24522) - Counter target spell.

### 6. Mill Effects

Source: existing queue family after library_search
Available after current queue exclusion: 369

1. Takenuma, Abandoned Mire (EDHREC 248) - Channel — {3}{B}, Discard this card: Mill three cards, then return a creature or planeswalker card from your graveyard to your hand. This ability costs {1} less to activate for each legendary creature you control.
2. Ripples of Undeath (EDHREC 532) - At the beginning of your first main phase, mill three cards.
3. Tibalt's Trickery (EDHREC 590) - Its controller mills that many cards, then exiles cards from the top of their library until they exile a nonland card with a different name than that spell.
4. Emry, Lurker of the Loch (EDHREC 604) - When Emry enters, mill four cards.
5. Stitcher's Supplier (EDHREC 622) - When this creature enters or dies, mill three cards.
6. Breach the Multiverse (EDHREC 858) - Each player mills ten cards.
7. Mindcrank (EDHREC 963) - Whenever an opponent loses life, that player mills that many cards.
8. Mesmeric Orb (EDHREC 1084) - Whenever a permanent becomes untapped, that permanent's controller mills a card.
9. Lumra, Bellow of the Woods (EDHREC 1146) - When Lumra enters, mill four cards.
10. Millikin (EDHREC 1224) - {T}, Mill a card: Add {C}. (Activate only as an instant. To mill a card, put the top card of your library into your graveyard.)
11. Hedge Shredder (EDHREC 1277) - Whenever this Vehicle attacks, you may mill two cards.
12. Ruin Crab (EDHREC 1292) - Landfall — Whenever a land you control enters, each opponent mills three cards. (To mill a card, a player puts the top card of their library into their graveyard.)
13. Skull Prophet (EDHREC 1372) - {T}: Mill two cards. (Put the top two cards of your library into your graveyard.)
14. Altar of the Brood (EDHREC 1422) - Whenever another permanent you control enters, each opponent mills a card.
15. World Shaper (EDHREC 1437) - Whenever this creature attacks, you may mill three cards.
16. Hedron Crab (EDHREC 1466) - Landfall — Whenever a land you control enters, target player mills three cards. (They put the top three cards of their library into their graveyard.)
17. Smuggler's Surprise (EDHREC 1585) - + {2} — Mill four cards. You may put up to two creature and/or land cards from among the milled cards into your hand.
18. Maddening Cacophony (EDHREC 1619) - Each opponent mills eight cards.
19. The Water Crystal (EDHREC 1639) - If an opponent would mill one or more cards, they mill that many cards plus four instead.
20. Colossal Grave-Reaver (EDHREC 1933) - Whenever this creature enters or attacks, mill three cards.
21. Perpetual Timepiece (EDHREC 2014) - {T}: Mill two cards. (Put the top two cards of your library into your graveyard.)
22. Bruvac the Grandiloquent (EDHREC 2112) - If an opponent would mill one or more cards, they mill twice that many cards instead.
23. Grapple with the Past (EDHREC 2147) - Mill three cards, then you may return a creature or land card from your graveyard to your hand.
24. The Mindskinner (EDHREC 2150) - If a source you control would deal damage to an opponent, prevent that damage and each opponent mills that many cards.
25. Overlord of the Balemurk (EDHREC 2225) - Whenever this permanent enters or attacks, mill four cards, then you may return a non-Avatar creature card or a planeswalker card from your graveyard to your hand.
26. Tyvar, Jubilant Brawler (EDHREC 2322) - −2: Mill three cards, then you may return a creature card with mana value 2 or less from your graveyard to the battlefield.
27. Court of Cunning (EDHREC 2669) - At the beginning of your upkeep, any number of target players each mill two cards.
28. Cemetery Tampering (EDHREC 2768) - At the beginning of your upkeep, you may mill three cards.
29. Fraying Sanity (EDHREC 2870) - At the beginning of each end step, enchanted player mills X cards, where X is the number of cards put into their graveyard from anywhere this turn.
30. Extract from Darkness (EDHREC 3234) - Each player mills two cards.
31. Blossoming Tortoise (EDHREC 3235) - Whenever this creature enters or attacks, mill three cards, then return a land card from your graveyard to the battlefield tapped.
32. Nephalia Drownyard (EDHREC 3271) - {1}{U}{B}, {T}: Target player mills three cards.
33. Deadbridge Chant (EDHREC 3277) - When this enchantment enters, mill ten cards.
34. The Warring Triad (EDHREC 3396) - {T}, Mill a card: Target player adds one mana of any color. (Activate only as an instant.)
35. Didn't Say Please (EDHREC 3423) - Its controller mills three cards.
36. Incarnation Technique (EDHREC 3547) - Mill five cards, then return a creature card from your graveyard to the battlefield.
37. Memory Erosion (EDHREC 3660) - Whenever an opponent casts a spell, that player mills two cards.
38. Riverchurn Monument (EDHREC 3744) - {1}, {T}: Any number of target players each mill two cards. (Each of them puts the top two cards of their library into their graveyard.)
39. Gisa and Geralf (EDHREC 3907) - When Gisa and Geralf enters, mill four cards.
40. Restless Reef (EDHREC 3958) - Whenever this land attacks, target player mills four cards.
41. Barrowgoyf (EDHREC 4097) - Whenever this creature deals combat damage to a player, you may mill that many cards.
42. Gyruda, Doom of Depths (EDHREC 4362) - When Gyruda enters, each player mills four cards.
43. Tablet of Discovery (EDHREC 4380) - When this artifact enters, mill a card.
44. Captain N'ghathrod (EDHREC 4404) - Whenever a Horror you control deals combat damage to a player, that player mills that many cards.
45. Nemesis of Reason (EDHREC 4520) - Whenever this creature attacks, defending player mills ten cards.
46. Angel of Suffering (EDHREC 4638) - If damage would be dealt to you, prevent that damage and mill twice that many cards.
47. Deranged Assistant (EDHREC 4672) - {T}, Mill a card: Add {C}. (Activate only as an instant. To mill a card, put the top card of your library into your graveyard.)
48. Wondrous Crucible (EDHREC 4722) - At the beginning of your end step, mill two cards, then exile a nonland card at random from your graveyard.
49. Tomb Fortress (EDHREC 4975) - {2}{B}{B}{B}, {T}, Exile this land: Mill four cards, then return a creature card from your graveyard to the battlefield. Activate only as a sorcery.
50. Infesting Radroach (EDHREC 4988) - Whenever an opponent mills a nonland card, if this creature is in your graveyard, you may return it to your hand.
51. Phenax, God of Deception (EDHREC 4998) - Creatures you control have "{T}: Target player mills X cards, where X is this creature's toughness."
52. Rampant Frogantua (EDHREC 5001) - Whenever this creature deals combat damage to a player, you may mill that many cards.
53. Glimpse the Unthinkable (EDHREC 5155) - Target player mills ten cards.
54. Ashcoat of the Shadow Swarm (EDHREC 5158) - At the beginning of your end step, you may mill four cards.
55. Sauron, Lord of the Rings (EDHREC 5236) - When you cast this spell, amass Orcs 5, mill five cards, then return a creature card from your graveyard to the battlefield.
56. Splinterfright (EDHREC 5274) - At the beginning of your upkeep, mill two cards.
57. Raul, Trouble Shooter (EDHREC 5471) - {T}: Each player mills a card. (They each put the top card of their library into their graveyard.)
58. Terra, Herald of Hope (EDHREC 5514) - Trance — At the beginning of combat on your turn, mill two cards. Terra gains flying until end of turn.
59. Thought Collapse (EDHREC 5641) - Its controller mills three cards.
60. Archive Trap (EDHREC 5764) - Target opponent mills thirteen cards.
61. Kagha, Shadow Archdruid (EDHREC 5856) - Mill two cards.
62. Sewer Nemesis (EDHREC 5933) - Whenever the chosen player casts a spell, that player mills a card.
63. Go-Shintai of Lost Wisdom (EDHREC 6016) - When you do, target player mills X cards, where X is the number of Shrines you control.
64. Hope Estheim (EDHREC 6055) - At the beginning of your end step, each opponent mills X cards, where X is the amount of life you gained this turn.
65. Molt Tender (EDHREC 6270) - {T}: Mill a card. (Put the top card of your library into your graveyard.)
66. Ghoulcaller's Bell (EDHREC 6452) - {T}: Each player mills a card.
67. Coram, the Undertaker (EDHREC 7105) - Whenever Coram attacks, each player mills a card.
68. Mindwrack Harpy (EDHREC 7214) - At the beginning of combat on your turn, each player mills three cards.
69. Corpse Churn (EDHREC 7259) - Mill three cards, then you may return a creature card from your graveyard to your hand.
70. Kairi, the Swirling Sky (EDHREC 7272) - • Mill six cards, then return up to two instant and/or sorcery cards from your graveyard to your hand.
71. Dreamborn Muse (EDHREC 7467) - At the beginning of each player's upkeep, that player mills X cards, where X is the number of cards in their hand.
72. Admiral Brass, Unsinkable (EDHREC 7477) - When Admiral Brass enters, mill four cards.
73. Shadow Kin (EDHREC 7757) - At the beginning of your upkeep, each player mills three cards.
74. Tasigur, the Golden Fang (EDHREC 7822) - {2}{G/U}{G/U}: Mill two cards, then return a nonland card of an opponent's choice from your graveyard to your hand.
75. Mole Man, Moloid Master (EDHREC 7866) - Landfall — Whenever a land you control enters, create a 1/1 green Minion creature token named Moloid with "Whenever this token attacks, you may mill a card."
76. Trenchpost (EDHREC 7933) - {3}, {T}: Target player mills a card for each Locus you control.
77. The Cyber-Controller (EDHREC 8108) - When The Cyber-Controller enters, each opponent mills X cards.
78. Geth, Lord of the Vault (EDHREC 8135) - {X}{B}: Put target artifact or creature card with mana value X from an opponent's graveyard onto the battlefield under your control tapped. Then that player mills X cards.
79. Drowned Secrets (EDHREC 8441) - Whenever you cast a blue spell, target player mills two cards.
80. Rejoin the Fight (EDHREC 8457) - Mill three cards.
81. Sorcerous Squall (EDHREC 8458) - Target opponent mills nine cards, then you may cast an instant or sorcery spell from that player's graveyard without paying its mana cost.
82. Relic Golem (EDHREC 8674) - {2}, {T}: Target player mills two cards. (They put the top two cards of their library into their graveyard.)
83. Diviner of Mist (EDHREC 8683) - Whenever this creature attacks, mill four cards.
84. Unseal the Necropolis (EDHREC 8714) - Each player mills three cards.
85. Circle of the Land Druid (EDHREC 8858) - When this creature enters, you may mill four cards.
86. Thieves' Guild Enforcer (EDHREC 8982) - Whenever this creature or another Rogue you control enters, each opponent mills two cards.
87. Psychic Strike (EDHREC 8987) - Its controller mills two cards.
88. Another Chance (EDHREC 9162) - You may mill two cards.
89. Midnight Tilling (EDHREC 9173) - Mill four cards, then you may return a permanent card from among them to your hand.
90. Keening Stone (EDHREC 9227) - {5}, {T}: Target player mills X cards, where X is the number of cards in that player's graveyard.
91. Vanille, Cheerful l'Cie (EDHREC 9304) - When Vanille enters, mill two cards, then return a permanent card from your graveyard to your hand.
92. Technomancer (EDHREC 9399) - When this creature enters, mill three cards, then return any number of artifact creature cards with total mana value 6 or less from your graveyard to the battlefield.
93. Eivor, Wolf-Kissed (EDHREC 9448) - Whenever Eivor deals combat damage to a player, you mill that many cards.
94. Exhibition Tidecaller (EDHREC 9471) - Opus — Whenever you cast an instant or sorcery spell, target player mills three cards. If five or more mana was spent to cast that spell, that player mills ten cards instead.
95. Ark of Hunger (EDHREC 9494) - {T}: Mill a card. You may play that card this turn.
96. Ursine Monstrosity (EDHREC 9522) - At the beginning of combat on your turn, mill a card and choose an opponent at random.
97. Rex, Cyber-Hound (EDHREC 9623) - Whenever Rex deals combat damage to a player, they mill two cards and you get {E}{E} (two energy counters).
98. Winds of Rebuke (EDHREC 9634) - Each player mills two cards.
99. Tayam, Luminous Enigma (EDHREC 9753) - {3}, Remove three counters from among creatures you control: Mill three cards, then return a permanent card with mana value 3 or less from your graveyard to the battlefield.
100. Daggerfang Duo (EDHREC 9852) - When this creature enters, you may mill two cards.
101. Glowspore Shaman (EDHREC 9915) - When this creature enters, mill three cards.
102. Inspiration from Beyond (EDHREC 9918) - Mill three cards, then return an instant or sorcery card from your graveyard to your hand.
103. Bond of Insight (EDHREC 9927) - Each player mills four cards.
104. Szarekh, the Silent King (EDHREC 9946) - My Will Be Done — Whenever Szarekh attacks, mill three cards. You may put an artifact creature card or Vehicle card from among the cards milled this way into your hand.
105. Quintorius, History Chaser (EDHREC 9948) - If you do, draw two cards, then mill a card.
106. Manic Scribe (EDHREC 9951) - When this creature enters, each opponent mills three cards.
107. Gnawing Vermin (EDHREC 9963) - When this creature enters, target player mills two cards.
108. Persistent Petitioners (EDHREC 9972) - {1}, {T}: Target player mills a card. (They put the top card of their library into their graveyard.)
109. Deepmuck Desperado (EDHREC 10010) - Whenever you commit a crime, each opponent mills three cards.
110. Riddlekeeper (EDHREC 10030) - Whenever a creature attacks you or a planeswalker you control, that creature's controller mills two cards.
111. Advanced Reconstruction (EDHREC 10085) - At the beginning of your first main phase, mill a card, then exile a card from your graveyard at random.
112. Lluwen, Imperfect Naturalist (EDHREC 10089) - When Lluwen enters, mill four cards, then you may put a creature or land card from among the milled cards on top of your library.
113. Eye Collector (EDHREC 10269) - Whenever this creature deals combat damage to a player, each player mills a card.
114. Carrion Grub (EDHREC 10529) - When this creature enters, mill four cards.
115. Psychic Spiral (EDHREC 10654) - Target player mills that many cards.
116. Soaring Thought-Thief (EDHREC 10735) - Whenever one or more Rogues you control attack, each opponent mills two cards.
117. Deathcap Marionette (EDHREC 10817) - When this creature enters, you may mill two cards.
118. Stillness in Motion (EDHREC 11041) - At the beginning of your upkeep, mill three cards.
119. Scrabbling Skullcrab (EDHREC 11465) - Eerie — Whenever an enchantment you control enters and whenever you fully unlock a Room, target player mills two cards. (They put the top two cards of their library into their graveyard.)
120. Vantress Gargoyle (EDHREC 11481) - {T}: Each player mills a card.
121. Mind Sculpt (EDHREC 11503) - Target opponent mills seven cards.
122. Avatar Destiny (EDHREC 11606) - When enchanted creature dies, mill cards equal to its power. Return this card to its owner's hand and up to one creature card milled this way to the battlefield under your control.
123. Saruman of Many Colors (EDHREC 11672) - Whenever you cast your second spell each turn, each opponent mills two cards.
124. Overwhelmed Apprentice (EDHREC 11701) - When this creature enters, each opponent mills two cards.
125. Convergence of Dominion (EDHREC 11727) - Translocation Protocols — {3}, {T}: Mill three cards.
126. Dream Twist (EDHREC 11802) - Target player mills three cards.
127. Tome Scour (EDHREC 11811) - Target player mills five cards.
128. Master Pakku (EDHREC 11970) - Whenever Master Pakku becomes tapped, target player mills X cards, where X is the number of Lesson cards in your graveyard.
129. Flayed One (EDHREC 12023) - Flesh Flayer — When this creature enters, mill three cards.
130. Druidic Ritual (EDHREC 12126) - You may mill three cards.
131. Patchwork Beastie (EDHREC 12163) - At the beginning of your upkeep, you may mill a card.
132. Millstone (EDHREC 12174) - {2}, {T}: Target player mills two cards.
133. Duskmantle, House of Shadow (EDHREC 12188) - {U}{B}, {T}: Target player mills a card.
134. Crow of Dark Tidings (EDHREC 12307) - When this creature enters or dies, mill two cards.
135. Broken Ambitions (EDHREC 12359) - If you win, that spell's controller mills four cards.
136. Mole Module (EDHREC 12377) - Whenever this Vehicle deals combat damage to a player, mill four cards.
137. Madame Web, Clairvoyant (EDHREC 12413) - Whenever you attack, you may mill a card.
138. Wand of Vertebrae (EDHREC 12425) - {T}: Mill a card.
139. Mystic Redaction (EDHREC 12483) - Whenever you discard a card, each opponent mills two cards.
140. Eccentric Farmer (EDHREC 12551) - When this creature enters, mill three cards, then you may return a land card from your graveyard to your hand.
141. Curse of the Bloody Tome (EDHREC 12680) - At the beginning of enchanted player's upkeep, that player mills two cards.
142. Embalmer's Tools (EDHREC 12740) - Tap an untapped Zombie you control: Target player mills a card.
143. Aven Heartstabber (EDHREC 13045) - When this creature dies, mill two cards, then draw a card.
144. Venomized Cat (EDHREC 13099) - When this creature enters, mill two cards.
145. Iceberg Cancrix (EDHREC 13104) - Whenever another snow permanent you control enters, you may have target player mill two cards.
146. Acolyte of Affliction (EDHREC 13263) - When this creature enters, mill two cards, then you may return a permanent card from your graveyard to your hand.
147. Rainveil Rejuvenator (EDHREC 13312) - When this creature enters, you may mill three cards.
148. Fell Gravship (EDHREC 13523) - When this Spacecraft enters, mill three cards, then return a creature or Spacecraft card from your graveyard to your hand.
149. Chronic Flooding (EDHREC 13607) - Whenever enchanted land becomes tapped, its controller mills three cards.
150. Quag Feast (EDHREC 13621) - Mill two cards, then destroy the chosen permanent if its mana value is less than or equal to the number of cards in your graveyard.
151. Chancellor of the Spires (EDHREC 13757) - If you do, at the beginning of the first upkeep, each opponent mills seven cards.
152. Wall of Lost Thoughts (EDHREC 13854) - When this creature enters, target player mills four cards.
153. Rosheen, Roaring Prophet (EDHREC 13862) - When Rosheen enters, mill six cards.
154. Countermand (EDHREC 13981) - Its controller mills four cards.
155. Grasping Tentacles (EDHREC 14005) - Target opponent mills eight cards.
156. Halimar Excavator (EDHREC 14138) - Whenever this creature or another Ally you control enters, target player mills X cards, where X is the number of Allies you control.
157. Summon Undead (EDHREC 14212) - You may mill three cards.
158. Scarblade Scout (EDHREC 14218) - When this creature enters, mill two cards.
159. Desperate Bloodseeker (EDHREC 14241) - When this creature enters, target player mills two cards.
160. Roots of Wisdom (EDHREC 14343) - Mill three cards, then return a land card or Elf card from your graveyard to your hand.
161. Veteran Ice Climber (EDHREC 14416) - Whenever this creature attacks, up to one target player mills cards equal to this creature's power. (They put that many cards from the top of their library into their graveyard.)
162. Jace's Mindseeker (EDHREC 14526) - When this creature enters, target opponent mills five cards.
163. Urborg Lhurgoyf (EDHREC 14549) - As this creature enters, mill three cards for each time it was kicked.
164. Sands of Delirium (EDHREC 14648) - {X}, {T}: Target player mills X cards.
165. Specimen Freighter (EDHREC 14710) - Whenever this Spacecraft attacks, defending player mills four cards.
166. Wick's Patrol (EDHREC 14779) - When this creature enters, mill three cards.
167. Excavated Wall (EDHREC 14829) - {1}, {T}: Mill a card. (Put the top card of your library into your graveyard.)
168. Infernal Genesis (EDHREC 14875) - At the beginning of each player's upkeep, that player mills a card.
169. Fateful Tempest (EDHREC 14953) - Council's dilemma — Starting with you, each player votes for past or present. You mill a card for each past vote, then Fateful Tempest deals damage to each opponent equal to the total mana value of cards milled this way. Exile the top card of your library for each present vote. Until the end of your next turn, you may play the exiled cards.
170. Pelargir Survivor (EDHREC 14971) - {5}{U}, {T}: Target player mills three cards. (They put the top three cards of their library into their graveyard.)
171. Carrion Cruiser (EDHREC 15080) - When this Vehicle enters, mill two cards.
172. Does Machines (EDHREC 15190) - When this Class enters, mill two cards, draw two cards, then discard two cards.
173. Shaun & Rebecca, Agents (EDHREC 15289) - {T}: Add {C}. When you do, mill two cards.
174. Sludge Titan (EDHREC 15339) - Whenever this creature enters or attacks, mill five cards.
175. Drown in Filth (EDHREC 15356) - Mill four cards, then that creature gets -1/-1 until end of turn for each land card in your graveyard.
176. Wasteful Harvest (EDHREC 15388) - Mill five cards.
177. Stream of Thought (EDHREC 15468) - Target player mills four cards.
178. Patient Naturalist (EDHREC 15494) - When this creature enters, mill three cards.
179. The Fifteenth Doctor (EDHREC 15578) - Whenever The Fifteenth Doctor enters or attacks, mill three cards.
180. Eyeblight Cullers (EDHREC 15673) - When this creature dies, create three 1/1 green Elf Warrior creature tokens, then mill three cards.
181. Random Encounter (EDHREC 15684) - Shuffle your library, then mill four cards.
182. Sphinx Mindbreaker (EDHREC 15692) - When this creature enters, each opponent mills ten cards.
183. Cephalid Illusionist (EDHREC 15800) - Whenever this creature becomes the target of a spell or ability, mill three cards.
184. Mindshrieker (EDHREC 15912) - {2}: Target player mills a card. This creature gets +X/+X until end of turn, where X is the milled card's mana value.
185. Compelling Argument (EDHREC 16264) - Target player mills five cards.
186. Cathartic Adept (EDHREC 16296) - {T}: Target player mills a card.
187. Paranoid Delusions (EDHREC 16340) - Target player mills three cards.
188. Sage of Mysteries (EDHREC 16770) - Constellation — Whenever an enchantment you control enters, target player mills two cards.
189. Sigil of Myrkul (EDHREC 16806) - At the beginning of combat on your turn, mill a card.
190. Grave Strength (EDHREC 16819) - Mill three cards, then put a +1/+1 counter on that creature for each creature card in your graveyard.
191. Coral Colony (EDHREC 16938) - {1}{U}, {T}: Target player mills X cards, where X is the number of creatures you control with defender. (To mill a card, a player puts the top card of their library into their graveyard.)
192. Screeching Sliver (EDHREC 16990) - All Slivers have "{T}: Target player mills a card."
193. Hama, the Bloodbender (EDHREC 16997) - When Hama enters, target opponent mills three cards.
194. Eerie Soultender (EDHREC 17239) - When this creature enters, mill three cards.
195. Dreadwaters (EDHREC 17296) - Target player mills X cards, where X is the number of lands you control.
196. Shriekhorn (EDHREC 17335) - {T}, Remove a charge counter from this artifact: Target player mills two cards.
197. Path of the Schemer (EDHREC 17411) - Each player mills two cards.
198. Mysterio's Phantasm (EDHREC 17461) - Whenever this creature attacks, mill a card.
199. Fallaji Archaeologist (EDHREC 17466) - When this creature enters, mill three cards.
200. Screaming Swarm (EDHREC 17473) - Whenever you attack with one or more creatures, target player mills that many cards.

### 7. Impulse Exile Permission Windows

Source: existing queue family after library_search
Available after current queue exclusion: 177

1. Jeska's Will (EDHREC 103) - • Exile the top three cards of your library. You may play them this turn.
2. Mosswort Bridge (EDHREC 196) - {G}, {T}: You may play the exiled card without paying its mana cost if creatures you control have total power 10 or greater.
3. Etali, Primal Storm (EDHREC 262) - Whenever Etali attacks, exile the top card of each player's library, then you may cast any number of spells from among those cards without paying their mana costs.
4. Windbrisk Heights (EDHREC 657) - {W}, {T}: You may play the exiled card without paying its mana cost if you attacked with three or more creatures this turn.
5. Spinerock Knoll (EDHREC 763) - {R}, {T}: You may play the exiled card without paying its mana cost if an opponent was dealt 7 or more damage this turn.
6. Expressive Iteration (EDHREC 881) - You may play the exiled card this turn.
7. Light Up the Stage (EDHREC 1219) - Exile the top two cards of your library. Until the end of your next turn, you may play those cards.
8. Grenzo, Havoc Raiser (EDHREC 1633) - • Exile the top card of that player's library. Until end of turn, you may cast that card and you may spend mana as though it were mana of any color to cast that spell.
9. Sword of Forge and Frontier (EDHREC 1885) - Whenever equipped creature deals combat damage to a player, exile the top two cards of your library. You may play those cards this turn. You may play an additional land this turn.
10. Party Thrasher (EDHREC 2084) - At the beginning of your first main phase, you may discard a card. If you do, exile the top two cards of your library, then choose one of them. You may play that card this turn.
11. Reckless Impulse (EDHREC 2123) - Exile the top two cards of your library. Until the end of your next turn, you may play those cards.
12. Wrenn's Resolve (EDHREC 2126) - Exile the top two cards of your library. Until the end of your next turn, you may play those cards.
13. The Key to the Vault (EDHREC 2149) - You may cast the exiled card without paying its mana cost.
14. Escape to the Wilds (EDHREC 2313) - Exile the top five cards of your library. You may play cards exiled this way until the end of your next turn.
15. Aminatou's Augury (EDHREC 2509) - Exile the top eight cards of your library. You may put a land card from among them onto the battlefield. Until end of turn, for each nonland card type, you may cast a spell of that type from among the exiled cards without paying its mana cost.
16. Cunning Rhetoric (EDHREC 2613) - Whenever an opponent attacks you and/or one or more planeswalkers you control, exile the top card of that player's library. You may play that card for as long as it remains exiled, and you may spend mana as though it were mana of any color to cast it.
17. Cemetery Tampering (EDHREC 2768) - Then if there are twenty or more cards in your graveyard, you may play the exiled card without paying its mana cost.
18. Court of Locthwain (EDHREC 3301) - At the beginning of your upkeep, exile the top card of target opponent's library. You may play that card for as long as it remains exiled, and mana of any type can be spent to cast it. If you're the monarch, until end of turn, you may cast a spell from among cards exiled with this enchantment without paying its mana cost.
19. Neyali, Suns' Vanguard (EDHREC 3362) - Whenever one or more tokens you control attack a player, exile the top card of your library. During any turn you attacked with a token, you may play that card.
20. Florian, Voldaren Scion (EDHREC 3489) - You may play the exiled card this turn.
21. Mind's Desire (EDHREC 3588) - Shuffle your library. Then exile the top card of your library. Until end of turn, you may play that card without paying its mana cost.
22. Blazing Crescendo (EDHREC 3622) - Exile the top card of your library. Until the end of your next turn, you may play that card.
23. Cori Mountain Monastery (EDHREC 3651) - {3}{R}, {T}: Exile the top card of your library. Until the end of your next turn, you may play that card.
24. Laughing Jasper Flint (EDHREC 3683) - At the beginning of your upkeep, exile the top X cards of target opponent's library, where X is the number of outlaws you control. Until end of turn, you may cast spells from among those cards, and mana of any type can be spent to cast those spells.
25. Commune with Lava (EDHREC 3878) - Exile the top X cards of your library. Until the end of your next turn, you may play those cards.
26. Vivien, Champion of the Wilds (EDHREC 3897) - For as long as it remains exiled, you may cast it if it's a creature spell.
27. Apex of Power (EDHREC 3966) - Exile the top seven cards of your library. Until end of turn, you may cast spells from among them.
28. Haste Magic (EDHREC 4064) - Target creature gets +3/+1 and gains haste until end of turn. Exile the top card of your library. You may play it until your next end step.
29. Tavern Brawler (EDHREC 4230) - Commander creatures you own have "At the beginning of your upkeep, exile the top card of your library. This creature gets +X/+0 until end of turn, where X is that card's mana value. You may play that card this turn."
30. Count on Luck (EDHREC 4330) - At the beginning of your upkeep, exile the top card of your library. You may play that card this turn.
31. Wild Wasteland (EDHREC 4340) - At the beginning of your upkeep, exile the top two cards of your library. You may play those cards this turn.
32. Dance with Calamity (EDHREC 4343) - Shuffle your library. As many times as you choose, you may exile the top card of your library. If the total mana value of the cards exiled this way is 13 or less, you may cast any number of spells from among those cards without paying their mana costs.
33. Stolen Strategy (EDHREC 4494) - At the beginning of your upkeep, exile the top card of each opponent's library. Until end of turn, you may cast spells from among those exiled cards, and you may spend mana as though it were mana of any color to cast those spells.
34. Zuko, Exiled Prince (EDHREC 4529) - {3}: Exile the top card of your library. You may play that card this turn.
35. Rundvelt Hordemaster (EDHREC 4559) - Whenever this creature or another Goblin you control dies, exile the top card of your library. If it's a Goblin creature card, you may cast that card until the end of your next turn.
36. Breeches, Brazen Plunderer (EDHREC 4563) - Whenever one or more Pirates you control deal damage to your opponents, exile the top card of each of those opponents' libraries. You may play those cards this turn, and you may spend mana as though it were mana of any color to cast those spells.
37. Stella Lee, Wild Card (EDHREC 4844) - Whenever you cast your second spell each turn, exile the top card of your library. Until the end of your next turn, you may play that card.
38. Hugs, Grisly Guardian (EDHREC 4853) - When Hugs enters, exile the top X cards of your library. Until the end of your next turn, you may play those cards.
39. Creative Technique (EDHREC 4860) - You may cast the exiled card without paying its mana cost.
40. Clive's Hideaway (EDHREC 5162) - {2}, {T}: You may play the exiled card without paying its mana cost if you control four or more legendary creatures.
41. Nahiri, Forged in Fury (EDHREC 5195) - Whenever an equipped creature you control attacks, exile the top card of your library. You may play that card this turn. You may cast Equipment spells this way without paying their mana costs.
42. Djeru and Hazoret (EDHREC 5238) - Until end of turn, you may cast the exiled card without paying its mana cost.
43. Kotis, the Fangkeeper (EDHREC 5388) - Whenever Kotis deals combat damage to a player, exile the top X cards of their library, where X is the amount of damage dealt. You may cast any number of spells with mana value X or less from among them without paying their mana costs.
44. Moria Marauder (EDHREC 5470) - Whenever a Goblin or Orc you control deals combat damage to a player, exile the top card of your library. You may play that card this turn.
45. Opera Love Song (EDHREC 5530) - • Exile the top two cards of your library. You may play those cards until your next end step.
46. Cait Sith, Fortune Teller (EDHREC 5847) - Lucky Slots — At the beginning of combat on your turn, scry 1, then exile the top card of your library. You may play that card this turn. When you exile a card this way, target creature you control gets +X/+0 until end of turn, where X is that card's mana value.
47. Epic Experiment (EDHREC 6107) - Exile the top X cards of your library. You may cast instant and sorcery spells with mana value X or less from among them without paying their mana costs. Then put all cards exiled this way that weren't cast into your graveyard.
48. Dream-Thief's Bandana (EDHREC 6312) - For as long as it remains exiled, you may play it, and mana of any type can be spent to cast that spell.
49. Chaos Channeler (EDHREC 6515) - You may play them this turn.
50. Interdimensional Web Watch (EDHREC 6766) - When this artifact enters, exile the top two cards of your library. Until the end of your next turn, you may play those cards.
51. Smirking Spelljacker (EDHREC 6943) - Whenever this creature attacks, if a card is exiled with it, you may cast the exiled card without paying its mana cost.
52. Black Cat, Cunning Thief (EDHREC 6975) - You may play the exiled cards for as long as they remain exiled.
53. Riveteers Charm (EDHREC 7126) - • Exile the top three cards of your library. Until your next end step, you may play those cards.
54. Caves of Chaos Adventurer (EDHREC 7478) - Whenever this creature attacks, exile the top card of your library. If you've completed a dungeon, you may play that card this turn without paying its mana cost. Otherwise, you may play that card this turn.
55. Chiss-Goria, Forge Tyrant (EDHREC 7575) - Whenever Chiss-Goria attacks, exile the top five cards of your library. You may cast an artifact spell from among them this turn. If you do, it has affinity for artifacts.
56. March of Reckless Joy (EDHREC 7612) - Exile the top X cards of your library. You may play up to two of those cards until the end of your next turn.
57. Commander Liara Portyr (EDHREC 7726) - Whenever you attack, spells you cast from exile this turn cost {X} less to cast, where X is the number of players being attacked. Exile the top X cards of your library. Until end of turn, you may cast spells from among those exiled cards.
58. Harnesser of Storms (EDHREC 7969) - Whenever you cast a noncreature or Otter spell, you may exile the top card of your library. Until end of turn, you may play that card. This ability triggers only once each turn.
59. Armory Paladin (EDHREC 8192) - Whenever you cast an Aura or Equipment spell, exile the top card of your library. You may play that card until the end of your next turn.
60. Etrata, Deadly Fugitive (EDHREC 8290) - If you can't, exile it, then you may cast the exiled card without paying its mana cost."
61. Narset, Enlightened Master (EDHREC 8347) - Whenever Narset attacks, exile the top four cards of your library. Until end of turn, you may cast noncreature spells from among those cards without paying their mana costs.
62. Hex Magic (EDHREC 8521) - Until the end of your next turn, you may play cards exiled this way.
63. Clockwork Percussionist (EDHREC 8689) - When this creature dies, exile the top card of your library. You may play it until the end of your next turn.
64. Emberheart Challenger (EDHREC 8825) - Valiant — Whenever this creature becomes the target of a spell or ability you control for the first time each turn, exile the top card of your library. Until end of turn, you may play that card.
65. Furious Rise (EDHREC 8915) - At the beginning of your end step, if you control a creature with power 4 or greater, exile the top card of your library. You may play that card until you exile another card with this enchantment.
66. Gale's Redirection (EDHREC 9041) - 1—14 | You may cast the exiled card for as long as it remains exiled, and you may spend mana as though it were mana of any color to cast that spell.
67. Fireglass Mentor (EDHREC 9526) - At the beginning of your second main phase, if an opponent lost life this turn, exile the top two cards of your library. Choose one of them. Until end of turn, you may play that card.
68. Heroes' Hangout (EDHREC 9644) - • Date Night — Exile the top two cards of your library. Choose one of them. Until the end of your next turn, you may play that card.
69. Galvanic Relay (EDHREC 9806) - Exile the top card of your library. During your next turn, you may play that card.
70. Stromkirk Occultist (EDHREC 9825) - Whenever this creature deals combat damage to a player, exile the top card of your library. Until end of turn, you may play that card.
71. Smuggler's Buggy (EDHREC 10076) - Whenever this Vehicle deals combat damage to a player, you may cast the exiled card without paying its mana cost.
72. Advanced Reconstruction (EDHREC 10085) - You may play the exiled card this turn.
73. Lightning, Security Sergeant (EDHREC 10316) - Whenever Lightning deals combat damage to a player, exile the top card of your library. You may play that card for as long as you control Lightning.
74. Meria, Scholar of Antiquity (EDHREC 10347) - Tap two untapped nontoken artifacts you control: Exile the top card of your library. You may play it this turn.
75. Robber of the Rich (EDHREC 10361) - Whenever this creature attacks, if defending player has more cards in hand than you, exile the top card of their library. During any turn you attacked with a Rogue, you may cast that card and you may spend mana as though it were mana of any color to cast that spell.
76. Sanwell, Avenger Ace (EDHREC 10442) - Whenever Sanwell becomes tapped, exile the top six cards of your library. You may cast a Vehicle or artifact creature spell from among them. Then put the rest on the bottom of your library in a random order.
77. Primeval Spawn (EDHREC 10467) - When this creature leaves the battlefield, exile the top ten cards of your library. You may cast any number of spells with total mana value 10 or less from among them without paying their mana costs.
78. Ecstatic Beauty (EDHREC 10774) - Exile the top three cards of your library. You may play those cards until end of turn. Put four time counters on each of those cards that has suspend.
79. Loot, the Key to Everything (EDHREC 10927) - At the beginning of your upkeep, exile the top X cards of your library, where X is the number of card types among other nonland permanents you control. You may play those cards this turn.
80. Durnan of the Yawning Portal (EDHREC 11013) - For as long as that card remains exiled, you may cast it.
81. Intet, the Dreamer (EDHREC 11162) - Whenever Intet deals combat damage to a player, you may pay {2}{U}. If you do, exile the top card of your library face down. You may look at that card for as long as it remains exiled. You may play that card without paying its mana cost for as long as Intet remains on the battlefield.
82. Herald of Amity (EDHREC 11186) - When this creature enters, exile the top eight cards of your library. You may cast an Aura spell from among them without paying its mana cost. Then put the rest on the bottom of your library in a random order.
83. Seize Opportunity (EDHREC 11611) - • Exile the top two cards of your library. Until the end of your next turn, you may play those cards.
84. Alania's Pathmaker (EDHREC 11977) - When this creature enters, exile the top card of your library. Until the end of your next turn, you may play that card.
85. Abstract Performance (EDHREC 12137) - Exile the top four cards of your library in a face-down pile, then exile the top four cards of your library in a face-up pile. An opponent chooses one of those piles. Put that pile into your graveyard. Look at the cards in the other pile. You may cast a spell from among them without paying its mana cost. Put the rest into your hand.
86. Tempered in Solitude (EDHREC 12189) - Whenever a creature you control attacks alone, exile the top card of your library. You may play that card this turn.
87. Glorious Purpose (EDHREC 12327) - When the sixth plan counter is put on this enchantment, sacrifice it. If you do, exile the top four cards of your library. You may cast any number of spells from among them without paying their mana costs. Put the rest into your hand.
88. Brilliant Ultimatum (EDHREC 12351) - Exile the top five cards of your library. An opponent separates those cards into two piles. You may play lands and cast spells from one of those piles. If you cast a spell this way, you cast it without paying its mana cost.
89. Kellan, Planar Trailblazer (EDHREC 12360) - {1}{R}: If Kellan is a Scout, it becomes a Human Faerie Detective and gains "Whenever Kellan deals combat damage to a player, exile the top card of your library. You may play that card this turn."
90. Ryan Sinclair (EDHREC 12537) - You may cast the exiled card without paying its mana cost if it's a spell with mana value less than or equal to Ryan's power.
91. Spark of Creativity (EDHREC 12617) - Choose target creature. Exile the top card of your library. You may have Spark of Creativity deal damage to that creature equal to the exiled card's mana value. If you don't, you may play that card until end of turn.
92. Duelist's Flame (EDHREC 12946) - You may cast the exiled card without paying its mana cost."
93. Capricious Sliver (EDHREC 13170) - Sliver creatures you control have "Whenever this creature deals combat damage to a player, exile the top card of your library. You may play that card this turn."
94. Campus Renovation (EDHREC 13800) - Return up to one target artifact or enchantment card from your graveyard to the battlefield. Exile the top two cards of your library. Until the end of your next turn, you may play those cards.
95. Magmatic Channeler (EDHREC 14052) - {T}, Discard a card: Exile the top two cards of your library, then choose one of them. You may play that card this turn.
96. Daredevil, Man Without Fear (EDHREC 14181) - Whenever you attack, you may exile the top card of your library. If that card is a Hero card, Daredevil gets +2/+1 until end of turn. You may play that card this turn.
97. Nathan Drake, Treasure Hunter (EDHREC 14814) - Whenever Nathan Drake attacks, exile the top card of each player's library. You may cast a spell from among those cards.
98. Fateful Tempest (EDHREC 14953) - Council's dilemma — Starting with you, each player votes for past or present. You mill a card for each past vote, then Fateful Tempest deals damage to each opponent equal to the total mana value of cards milled this way. Exile the top card of your library for each present vote. Until the end of your next turn, you may play the exiled cards.
99. Anep, Vizier of Hazoret (EDHREC 15121) - You may exert Anep as it attacks. When you do, exile the top two cards of your library. Until the end of your next turn, you may play those cards. (An exerted creature won't untap during your next untap step.)
100. Bruse Tarl, Roving Rancher (EDHREC 15257) - Whenever Bruse Tarl enters or attacks, exile the top card of your library. If it's a land card, create a 2/2 white Ox creature token. Otherwise, you may cast it until the end of your next turn.
101. Wiretapping (EDHREC 15262) - Then if you have nine or more cards in hand, you may play the exiled card without paying its mana cost.
102. Yasmin Khan (EDHREC 15331) - {T}: Exile the top card of your library. Until your next end step, you may play it.
103. Act on Impulse (EDHREC 15557) - Exile the top three cards of your library. Until end of turn, you may play those cards. (If you cast a spell this way, you still pay its costs. You can play a land this way only if you have an available land play remaining.)
104. Superior Foes of Spider-Man (EDHREC 15590) - Whenever you cast a spell with mana value 4 or greater, you may exile the top card of your library. If you do, you may play that card until you exile another card with this creature.
105. Monastery Raid (EDHREC 15772) - You may play the exiled cards until the end of your next turn.
106. Shelldock Isle (EDHREC 16035) - {U}, {T}: You may play the exiled card without paying its mana cost if a library has twenty or fewer cards in it.
107. Gila Courser (EDHREC 16248) - Whenever this creature attacks while saddled, exile the top card of your library. Until the end of your next turn, you may play that card.
108. Sizzling Changeling (EDHREC 16434) - When this creature dies, exile the top card of your library. Until the end of your next turn, you may play that card.
109. Bell Borca, Spectral Sergeant (EDHREC 16640) - At the beginning of your upkeep, exile the top card of your library. You may play that card this turn.
110. The Great Goblin (EDHREC 16703) - Whenever another Goblin, Orc, or Army you control dies, exile the top card of your library. You may play it until the end of your next turn.
111. Abbot of Keral Keep (EDHREC 16907) - When this creature enters, exile the top card of your library. Until end of turn, you may play that card.
112. Muse Vortex (EDHREC 16952) - Exile the top X cards of your library. You may cast an instant or sorcery spell with mana value X or less from among them without paying its mana cost. Then put the exiled instant and sorcery cards that weren't cast this way into your hand and the rest on the bottom of your library in a random order.
113. Hama, the Bloodbender (EDHREC 16997) - For as long as you control Hama, you may cast the exiled card during your turn by waterbending {X} rather than paying its mana cost, where X is its mana value.
114. Possibility Technician (EDHREC 17166) - For as long as that card remains exiled, you may play it if you control a Kavu.
115. Prophetic Flamespeaker (EDHREC 17218) - Whenever this creature deals combat damage to a player, exile the top card of your library. You may play it this turn.
116. Annie Flash, the Veteran (EDHREC 17346) - Whenever Annie Flash becomes tapped, exile the top two cards of your library. You may play those cards this turn.
117. Daredevil, Fearless Fighter (EDHREC 17490) - Whenever Daredevil attacks, exile the top card of your library. Daredevil deals damage to you equal to that card's mana value. You may play it this turn.
118. Outlaws' Fury (EDHREC 17891) - Creatures you control get +2/+0 until end of turn. If you control an outlaw, exile the top card of your library. Until the end of your next turn, you may play that card. (Assassins, Mercenaries, Pirates, Rogues, and Warlocks are outlaws.)
119. Sanar, Innovative First-Year (EDHREC 17895) - Vivid — At the beginning of your first main phase, reveal cards from the top of your library until you reveal X nonland cards, where X is the number of colors among permanents you control. For each of those colors, you may exile a card of that color from among the revealed cards. Then shuffle. You may cast the exiled cards this turn.
120. Unlucky Witness (EDHREC 18230) - When this creature dies, exile the top two cards of your library. Until your next end step, you may play one of those cards.
121. Discover the Impossible (EDHREC 18245) - You may cast the exiled card without paying its mana cost if it's an instant spell with mana value 2 or less.
122. Keldon Flamesage (EDHREC 18309) - You may cast the exiled card without paying its mana cost.
123. Cleon, Merry Champion (EDHREC 18417) - Heroic — Whenever you cast a spell that targets Cleon, exile the top card of your library. You may play that card until the end of your next turn.
124. Endrider Spikespitter (EDHREC 18527) - Max speed — At the beginning of your upkeep, exile the top card of your library. You may play that card this turn.
125. Nivix, Aerie of the Firemind (EDHREC 19203) - {2}{U}{R}, {T}: Exile the top card of your library. Until your next turn, you may cast it if it's an instant or sorcery spell.
126. Kulrath Zealot (EDHREC 19314) - When this creature enters, exile the top card of your library. Until the end of your next turn, you may play that card.
127. Evolving Door (EDHREC 19511) - {1}, {T}, Sacrifice a creature: Count the colors of the sacrificed creature, then search your library for a creature card that's exactly that many colors plus one. Exile that card, then shuffle. You may cast the exiled card. Activate only as a sorcery.
128. Asgardian Inspiration (EDHREC 19589) - Exile the top card of your library. You may play it this turn.
129. Boros Strike-Captain (EDHREC 19612) - Battalion — Whenever this creature and at least two other creatures attack, exile the top card of your library. During any turn you attacked with three or more creatures, you may play that card.
130. Collected Conjuring (EDHREC 19953) - Exile the top six cards of your library. You may cast up to two sorcery spells with mana value 3 or less from among them without paying their mana costs. Put the exiled cards not cast this way on the bottom of your library in a random order.
131. Wiccan, Young Avenger (EDHREC 20183) - Whenever you cast a noncreature spell, exile the top card of your library. Until your next end step, you may play that card.
132. Inside Information (EDHREC 20469) - Exile the top X cards of target opponent's library. You may play those cards this turn. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.
133. Charforger (EDHREC 20493) - Remove three oil counters from this creature: Exile the top card of your library. You may play that card this turn.
134. Riverwheel Sweep (EDHREC 20565) - Exile the top two cards of your library. Choose one of them. Until the end of your next turn, you may play that card.
135. Jessica Jones, Private Eye (EDHREC 20622) - {T}, Put a stun counter on Jessica Jones: Exile the top X cards of your library, where X is Jessica Jones's power. You may play those cards this turn. (If a permanent with a stun counter would become untapped, remove one from it instead.)
136. Grotag Night-Runner (EDHREC 20708) - Whenever this creature deals combat damage to a player, exile the top card of your library. You may play that card this turn.
137. Elemental Mascot (EDHREC 20801) - Opus — Whenever you cast an instant or sorcery spell, this creature gets +1/+0 until end of turn. If five or more mana was spent to cast that spell, exile the top card of your library. You may play that card until the end of your next turn.
138. Equilibrium Adept (EDHREC 20870) - When this creature enters, exile the top card of your library. Until the end of your next turn, you may play that card.
139. Strongbox Raider (EDHREC 20945) - Raid — When this creature enters, if you attacked this turn, exile the top two cards of your library. Choose one of them. Until the end of your next turn, you may play that card.
140. Stick, Fearless Mentor (EDHREC 20977) - Whenever a source you control deals damage to you, exile the top card of your library. You may play it until the end of your next turn. This ability triggers only once each turn.
141. Ardent Dustspeaker (EDHREC 21204) - Whenever this creature attacks, you may put an instant or sorcery card from your graveyard on the bottom of your library. If you do, exile the top two cards of your library. You may play those cards this turn.
142. Howltooth Hollow (EDHREC 21220) - {B}, {T}: You may play the exiled card without paying its mana cost if each player has no cards in hand.
143. Flameskull (EDHREC 21406) - Rejuvenation — When this creature dies, exile it. If you do, exile the top card of your library. Until the end of your next turn, you may play one of those cards. (If you cast Flameskull this way, you can't play the other card, and vice versa.)
144. Heroes for Hire (EDHREC 21608) - Sacrifice a Treasure: Exile the top card of your library. You may play it this turn.
145. Irascible Wolverine (EDHREC 21739) - When this creature enters, exile the top card of your library. Until end of turn, you may play that card.
146. Crossover Collaboration (EDHREC 21853) - Exile the top two cards of your library. Until the end of your next turn, you may play those cards. If this spell was cast using teamwork, create a Treasure token. (It's an artifact with "{T}, Sacrifice this token: Add one mana of any color.")
147. Meeting of the Five (EDHREC 22047) - Exile the top ten cards of your library. You may cast spells with exactly three colors from among them this turn. Add {W}{W}{U}{U}{B}{B}{R}{R}{G}{G}. Spend this mana only to cast spells with exactly three colors.
148. Ire Shaman (EDHREC 22634) - When this creature is turned face up, exile the top card of your library. Until end of turn, you may play that card.
149. Diversion Specialist (EDHREC 22928) - {1}, Sacrifice another creature or enchantment: Exile the top card of your library. You may play it this turn.
150. Magus of the Mind (EDHREC 23373) - {U}, {T}, Sacrifice this creature: Shuffle your library, then exile the top X cards, where X is one plus the number of spells cast this turn. Until end of turn, you may play lands and cast spells from among cards exiled this way without paying their mana costs.
151. Living Lore (EDHREC 23441) - If you do, you may cast the exiled card without paying its mana cost.
152. Chase Stein, Runaway (EDHREC 23731) - {T}, Discard a card: Exile the top card of your library. Until the end of your next turn, you may play that card.
153. Hazoret's Undying Fury (EDHREC 23868) - Shuffle your library, then exile the top four cards. You may cast any number of spells with mana value 5 or less from among them without paying their mana costs. Lands you control don't untap during your next untap step.
154. Warehouse Thief (EDHREC 24258) - {2}, {T}, Sacrifice an artifact or creature: Exile the top card of your library. Until the end of your next turn, you may play that card.
155. Tuskeri Firewalker (EDHREC 24587) - Boast — {1}: Exile the top card of your library. You may play that card this turn. (Activate only if this creature attacked this turn and only once each turn.)
156. Mjölnir's Might (EDHREC 25037) - Exile the top card of your library. Until the end of your next turn, you may play that card.
157. Crimson Operative (EDHREC 25078) - When this creature enters, exile the top card of your library. Until the end of your next turn, you may play that card.
158. Case of the Burning Masks (EDHREC 25198) - Solved — Sacrifice this Case: Exile the top three cards of your library. Choose one of them. You may play that card this turn.
159. Goblin Researcher (EDHREC 25348) - When this creature enters, exile the top card of your library. During any turn you attacked with this creature, you may play that card.
160. Molly Hayes, Runaway (EDHREC 26263) - Power-up — {5}{R}: Put two +1/+1 counters on Molly Hayes. Exile the top card of your library. Until the end of your next turn, you may play that card. (Activate each power-up ability only once. Reduce the cost by her mana cost if she entered this turn.)
161. Snowslope Hunter (EDHREC 26487) - Sacrifice another creature or artifact: Exile the top card of your library. You may play it until the end of your next turn. Activate only during your turn and only once each turn.
162. Three Wishes (EDHREC 26816) - Exile the top three cards of your library face down. You may look at those cards for as long as they remain exiled. Until your next turn, you may play those cards. At the beginning of your next upkeep, put any of those cards you didn't play into your graveyard.
163. Gundabad Opportunist (EDHREC 28668) - When this creature enters, exile the top card of your library. Until the end of your next turn, you may play that card.
164. U.S.S. Enterprise-D, Galaxy-Class (EDHREC 29807) - Whenever one or more charge counters are put on U.S.S. Enterprise-D for the first time each turn, exile the top card of your library. You may play that card this turn.
165. Aerial Caravan (EDHREC 29873) - {1}{U}{U}: Exile the top card of your library. Until end of turn, you may play that card. (Reveal the card as you exile it.)
166. Matoc, Lavamancer (EDHREC 30693) - Whenever a source you control deals damage, if at least one permanent or player was dealt exactly 2 of that damage, exile the top card of your library. You may play it until the end of your next turn.
167. Kirk, Enterprising Captain (EDHREC 31953) - Whenever Kirk attacks while creatures you control have total power 8 or greater, exile the top card of your library. You may play that card this turn.
168. Storybook Ride (EDHREC 32051) - Visit — Exile the top X cards of your library, where X is the number of Attractions you've visited this turn (including this one). You may play those cards this turn. At the beginning of the next end step, if any of those cards remain exiled, put them on the bottom of your library in any order.
169. Silicate Surveyor (EDHREC 32072) - When this creature enters, exile the top card of your library. Until the end of your next turn, you may play that card.
170. Goblin Savant (unranked) - {T}: Exile the top card of your library. If that card is a Goblin or an artifact card, you may play it this turn.
171. Golos, Tireless Pilgrim (unranked) - {2}{W}{U}{B}{R}{G}: Exile the top three cards of your library. You may play them this turn without paying their mana costs.
172. Mr. Monopoly, On the Go (unranked) - −2: Heist! — Exile the top two cards of target opponent's library. Until end of turn, you may play those cards, and mana of any type can be spent to cast them.
173. Now THIS Is Aether Racing (unranked) - Team Speed Demons — Exile the top two cards of your library. You may play those cards until your next end step.
174. Planeswalkerificate (unranked) - −1: Exile the top card of your library. You may play it this turn.
175. The Great Juggernaut (unranked) - Whenever The Great Juggernaut attacks, shuffle your library then exile the top card of your library. You may play that card without paying its mana cost this turn.
176. The Magic Bandit (unranked) - When The Magic Bandit deals combat damage to an opponent, exile the top card of that player's library. You may cast that card for as long as it remains exiled, and mana of any type can be spent to cast that spell.
177. The Powerful Dragon (unranked) - Whenever one or more +1/+1 counters are put on a creature you control, exile the top card of your library. Until end of turn, you may play that card.

### 8. Fight And Bite-Style Combat Resolution

Source: existing queue family after library_search
Available after current queue exclusion: 38

1. Domri, Anarch of Bolas (EDHREC 2655) - −2: Target creature you control fights target creature you don't control.
2. Frontier Siege (EDHREC 3280) - • Dragons — Whenever a creature you control with flying enters, you may have it fight target creature you don't control.
3. The Tarrasque (EDHREC 5842) - Whenever The Tarrasque attacks, it fights target creature defending player controls.
4. Temur Charm (EDHREC 7248) - • Target creature you control gets +1/+1 until end of turn. It fights target creature you don't control.
5. Gruul Ragebeast (EDHREC 7589) - Whenever this creature or another creature you control enters, that creature fights target creature an opponent controls.
6. Temur War Shaman (EDHREC 7948) - Whenever a permanent you control is turned face up, if it's a creature, you may have it fight target creature you don't control.
7. Epic Fight (EDHREC 12717) - • Target creature you control fights target creature an opponent controls.
8. HULK SMASH! (EDHREC 13088) - • Target creature you control deals damage equal to its power to target creature an opponent controls.
9. Savage Punch (EDHREC 13164) - Target creature you control fights target creature you don't control.
10. Barroom Brawl (EDHREC 13699) - Target creature you control fights target creature the opponent to your left controls.
11. Go Nuts! (EDHREC 15589) - • Target creature you control fights target creature an opponent controls.
12. Fight for the Throne (EDHREC 16363) - Then it fights target creature an opponent controls.
13. Brigid's Command (EDHREC 16702) - • Target creature you control fights target creature an opponent controls.
14. Tenderize (EDHREC 16892) - Target creature you control deals damage equal to its power to target creature an opponent controls.
15. It's Clobberin' Time! (EDHREC 17746) - • Target creature you control deals damage equal to its power to target creature an opponent controls.
16. Unnatural Aggression (EDHREC 20017) - Target creature you control fights target creature an opponent controls.
17. Hunt the Hunter (EDHREC 23148) - It fights target green creature an opponent controls.
18. Colossal Collision (EDHREC 23564) - Then that creature deals damage equal to its power to target creature an opponent controls.
19. Somberwald Stag (EDHREC 24041) - When this creature enters, you may have it fight target creature you don't control.
20. Brawl (EDHREC 24354) - Until end of turn, all creatures gain "{T}: This creature deals damage equal to its power to target creature."
21. Bite Down on Crime (EDHREC 25317) - It deals damage equal to its power to target creature you don't control.
22. Swift Kick (EDHREC 25515) - It fights target creature you don't control.
23. Quarrel (EDHREC 26412) - Target creature you control deals damage equal to its power to target creature an opponent controls.
24. Wild Instincts (EDHREC 26994) - It fights target creature an opponent controls.
25. Spoils of the Hunt (EDHREC 27402) - Then that creature deals damage equal to its power to target creature an opponent controls.
26. Wing Puncture (EDHREC 27936) - Target creature you control deals damage equal to its power to target creature with flying.
27. Faunsbane Troll (EDHREC 28376) - {1}, Sacrifice an Aura attached to this creature: This creature fights target creature you don't control. If that creature would die this turn, exile it instead. Activate only as a sorcery.
28. Scab-Clan Giant (EDHREC 28910) - When this creature enters, it fights target creature an opponent controls chosen at random.
29. Stalking Yeti (EDHREC 29403) - When this creature enters, if it's on the battlefield, it deals damage equal to its power to target creature an opponent controls and that creature deals damage equal to its power to this creature.
30. Troll Negotiations (EDHREC 29685) - Then it fights target creature an opponent controls.
31. Cinder Shade (EDHREC 30986) - {R}, Sacrifice this creature: It deals damage equal to its power to target creature.
32. Karplusan Yeti (EDHREC 31085) - {T}: This creature deals damage equal to its power to target creature. That creature deals damage equal to its power to this creature.
33. Flame Elemental (EDHREC 31447) - {R}, {T}, Sacrifice this creature: It deals damage equal to its power to target creature.
34. Minotaur Illusionist (EDHREC 31700) - {R}, Sacrifice this creature: It deals damage equal to its power to target creature.
35. Efteekay, Flame of the Kav (unranked) - Whenever Efteekay or another Kavu you control enters, it deals damage equal to its power to target creature.
36. Really Epic Punch (unranked) - Then it fights target creature you don't control.
37. Take the High Ground (unranked) - Target creature you control fights target creature you don't control.
38. The Cobra King (unranked) - • Strike first — Target Snake or Serpent you control fights target creature an opponent controls.

### 9. Goad And Attack-Pressure Effects

Source: existing queue family after library_search
Available after current queue exclusion: 126

1. Sphere of Safety (EDHREC 669) - Creatures can't attack you or planeswalkers you control unless their controller pays {X} for each of those creatures, where X is the number of enchantments you control.
2. Promise of Loyalty (EDHREC 955) - Each of those creatures can't attack you or planeswalkers you control for as long as it has a vow counter on it.
3. Grenzo, Havoc Raiser (EDHREC 1633) - • Goad target creature that player controls.
4. Dragon's Rage Channeler (EDHREC 1808) - Delirium — As long as there are four or more card types among cards in your graveyard, this creature gets +2/+2, has flying, and attacks each combat if able.
5. Norn's Annex (EDHREC 1960) - Creatures can't attack you or planeswalkers you control unless their controller pays {W/P} for each of those creatures.
6. Archangel of Tithes (EDHREC 2202) - As long as this creature is untapped, creatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures.
7. Bloodthirsty Blade (EDHREC 2258) - (It attacks each combat if able and attacks a player other than you if able.)
8. Baird, Steward of Argive (EDHREC 2549) - Creatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures.
9. Ghoulish Impetus (EDHREC 2646) - (It attacks each combat if able and attacks a player other than you if able.)
10. Geode Rager (EDHREC 2896) - Landfall — Whenever a land you control enters, goad each creature target player controls. (Until your next turn, those creatures attack each combat if able and attack a player other than you if able.)
11. Bothersome Quasit (EDHREC 3081) - Whenever you cast a noncreature spell, goad target creature an opponent controls.
12. Ulamog's Crusher (EDHREC 3406) - This creature attacks each combat if able.
13. Komainu Battle Armor (EDHREC 3468) - Whenever this creature or equipped creature deals combat damage to a player, goad each creature that player controls.
14. Redemption Arc (EDHREC 3609) - (It attacks each combat if able and attacks a player other than you if able.)
15. Eye of Nidhogg (EDHREC 3763) - (It attacks each combat if able and attacks a player other than you if able.)
16. Martial Impetus (EDHREC 3768) - (It attacks each combat if able and attacks a player other than you if able.)
17. Illusionist's Gambit (EDHREC 3785) - They can't attack you or planeswalkers you control that combat.
18. Chaos Dragon (EDHREC 3903) - This creature attacks each combat if able.
19. Assault Suit (EDHREC 4135) - Equipped creature gets +2/+2, has haste, can't attack you or planeswalkers you control, and can't be sacrificed.
20. Marisi, Breaker of the Coil (EDHREC 4613) - Whenever a creature you control deals combat damage to a player, goad each creature that player controls.
21. Darksteel Juggernaut (EDHREC 4641) - This creature attacks each combat if able.
22. Combat Calligrapher (EDHREC 4914) - Inklings can't attack you or planeswalkers you control.
23. Varchild, Betrayer of Kjeldor (EDHREC 5974) - Survivors your opponents control can't block, and they can't attack you or planeswalkers you control.
24. Red Death, Shipwrecker (EDHREC 6306) - Alluring Eyes — {T}: Goad target creature an opponent controls. That player draws a card. You add {R}. (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)
25. Laser Screwdriver (EDHREC 6538) - {3}, {T}: Goad target creature. (Until your next turn, it attacks each combat if able and attacks a player other than you if able.)
26. Psychic Impetus (EDHREC 7045) - (It attacks each combat if able and attacks a player other than you if able.)
27. Vow of Duty (EDHREC 7204) - Enchanted creature gets +2/+2, has vigilance, and can't attack you or planeswalkers you control.
28. Archon of Absolution (EDHREC 7577) - Creatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures.
29. Vow of Lightning (EDHREC 7713) - Enchanted creature gets +2/+2, has first strike, and can't attack you or planeswalkers you control.
30. Coercive Impetus (EDHREC 7762) - (It attacks each combat if able and attacks a player other than you if able.)
31. Killian, Decisive Mentor (EDHREC 7826) - (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)
32. Nettling Nuisance (EDHREC 7961) - (It attacks each combat if able and attacks a player other than you if able.)
33. Popular Entertainer (EDHREC 8803) - Commander creatures you own have "Whenever one or more creatures you control deal combat damage to a player, goad target creature that player controls." (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)
34. Vow of Malice (EDHREC 9090) - Enchanted creature gets +2/+2, has intimidate, and can't attack you or planeswalkers you control.
35. Taunting Kobold (EDHREC 9170) - Whenever this creature attacks, goad target creature an opponent controls.
36. Vow of Torment (EDHREC 9197) - Enchanted creature gets +2/+2, has menace, and can't attack you or planeswalkers you control.
37. Taunting Sliver (EDHREC 9756) - Sliver creatures you control have "When this creature enters, goad target creature an opponent controls." (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)
38. Acquired Mutation (EDHREC 9808) - (It attacks each combat if able and attacks a player other than you if able.)
39. Flamewake Phoenix (EDHREC 10131) - This creature attacks each combat if able.
40. Vow of Wildness (EDHREC 10248) - Enchanted creature gets +3/+3, has trample, and can't attack you or planeswalkers you control.
41. Fealty to the Realm (EDHREC 10385) - Enchanted creature attacks each combat if able and can't attack you.
42. Sly Instigator (EDHREC 10709) - {U}, {T}: Until your next turn, target creature an opponent controls can't be blocked. Goad that creature. (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)
43. Besmirch (EDHREC 11017) - (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)
44. Bohn, Beguiling Balladeer (EDHREC 11295) - Whenever you cast your second spell each turn, goad target creature an opponent controls.
45. Vow of Flight (EDHREC 11570) - Enchanted creature gets +2/+2, has flying, and can't attack you or planeswalkers you control.
46. The Sentry, Golden Guardian (EDHREC 11845) - When The Sentry enters, target opponent creates The Void, a legendary 5/5 black Horror Villain creature token with flying, indestructible, and "The Void attacks each combat if able."
47. The Beamtown Bullies (EDHREC 11887) - {T}: Target opponent whose turn it is puts target nonlegendary creature card from your graveyard onto the battlefield under their control. It gains haste. Goad it. At the beginning of the next end step, exile it. (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)
48. Frenzied Gorespawn (EDHREC 12441) - When this creature enters, for each opponent, goad target creature that player controls.
49. Ares, God of War (EDHREC 12951) - Ares attacks each combat if able.
50. Puppet Master, String Puller (EDHREC 13076) - Whenever you attack, goad target creature an opponent controls.
51. Insufferable Balladeer (EDHREC 13436) - Vicious Mockery — When this creature enters, target creature an opponent controls can't block this turn. Goad it. (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)
52. Predatory Impetus (EDHREC 13564) - (It attacks each combat if able and attacks a player other than you if able.)
53. Maeve, Insidious Singer (EDHREC 14465) - {2}{U}: Goad target creature. Whenever that creature attacks one of your opponents this turn, you draw a card. (A goaded creature attacks each combat if able and attacks a player other than you if able, until your next turn.)
54. Incriminating Impetus (EDHREC 14660) - (It attacks each combat if able and attacks a player other than you if able.)
55. Maestros Confluence (EDHREC 14945) - • Goad each creature target player controls. (Until your next turn, those creatures attack each combat if able and attack a player other than you if able.)
56. Spectral Grasp (EDHREC 15460) - Enchanted creature can't attack you or planeswalkers you control.
57. Seifer, Balamb Rival (EDHREC 15521) - Whenever you attack a player, goad target creature that player controls.
58. Forbidding Spirit (EDHREC 15906) - When this creature enters, until your next turn, creatures can't attack you or planeswalkers you control unless their controller pays {2} for each of those creatures.
59. Skeletal Swarming (EDHREC 16608) - Each Skeleton you control has trample, attacks each combat if able, and gets +X/+0, where X is the number of other Skeletons you control.
60. Kaima, the Fractured Calm (EDHREC 17386) - At the beginning of your end step, goad each creature your opponents control that's enchanted by an Aura you control.
61. Haktos the Unscarred (EDHREC 17705) - Haktos attacks each combat if able.
62. Hulk, Brutal Brawler (EDHREC 17912) - Hulk attacks each combat if able.
63. Juggernaut (EDHREC 18156) - This creature attacks each combat if able.
64. Akoum Firebird (EDHREC 18166) - This creature attacks each combat if able.
65. Oceanus Dragon (EDHREC 18378) - (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)
66. Coveted Peacock (EDHREC 18800) - Whenever this creature attacks, you may goad target creature defending player controls.
67. Alpine Guide (EDHREC 19012) - This creature attacks each combat if able.
68. Furor of the Bitten (EDHREC 19088) - Enchanted creature gets +2/+2 and attacks each combat if able.
69. Jeering Homunculus (EDHREC 19093) - When this creature enters, you may goad target creature.
70. Hulk, Always Angry (EDHREC 19189) - Hulk attacks each combat if able.
71. Oathsworn Knight (EDHREC 19210) - This creature attacks each combat if able.
72. Insatiable Gorgers (EDHREC 19565) - This creature attacks each combat if able.
73. Barricade Breaker (EDHREC 20061) - This creature attacks each combat if able.
74. Goblin Racketeer (EDHREC 20116) - Whenever this creature attacks, you may goad target creature defending player controls.
75. Deathbellow Raider (EDHREC 20460) - This creature attacks each combat if able.
76. Red Herring (EDHREC 21329) - This creature attacks each combat if able.
77. Alien Invasion (EDHREC 21413) - At the beginning of combat on your turn, create a 1/1 red Alien creature token with haste and "This token attacks each combat if able." Put a +1/+1 counter on it for each invasion counter on this enchantment, then put an invasion counter on this enchantment.
78. Bloodcrazed Neonate (EDHREC 22567) - This creature attacks each combat if able.
79. Crazed Goblin (EDHREC 22602) - This creature attacks each combat if able.
80. Phyrexian Snowcrusher (EDHREC 22691) - This creature attacks each combat if able.
81. Underworld Rage-Hound (EDHREC 22692) - This creature attacks each combat if able.
82. Mogis's Warhound (EDHREC 22742) - This creature attacks each combat if able.
83. Impetuous Sunchaser (EDHREC 22952) - This creature attacks each combat if able.
84. Monstrous Carabid (EDHREC 23508) - This creature attacks each combat if able.
85. Battle-Mad Ronin (EDHREC 24125) - This creature attacks each combat if able.
86. Galvanic Juggernaut (EDHREC 24537) - This creature attacks each combat if able.
87. Impending Doom (EDHREC 24559) - Enchanted creature gets +3/+3 and attacks each combat if able.
88. Riot Piker (EDHREC 24609) - This creature attacks each combat if able.
89. Mishra's Juggernaut (EDHREC 25539) - This creature attacks each combat if able.
90. Utvara Scalper (EDHREC 25641) - This creature attacks each combat if able.
91. Lust for War (EDHREC 25695) - Enchanted creature attacks each combat if able.
92. Primordial Ooze (EDHREC 26023) - This creature attacks each combat if able.
93. Manticore Eternal (EDHREC 26069) - This creature attacks each combat if able.
94. Tormentor's Trident (EDHREC 26154) - Equipped creature gets +3/+0 and attacks each combat if able.
95. Bloodshed Fever (EDHREC 26849) - Enchanted creature attacks each combat if able.
96. Kuldotha Ringleader (EDHREC 27600) - This creature attacks each combat if able.
97. Ramroller (EDHREC 27606) - This creature attacks each combat if able.
98. Sprinting Warbrute (EDHREC 28067) - This creature attacks each combat if able.
99. Guise of Fire (EDHREC 28428) - Enchanted creature gets +1/-1 and attacks each combat if able.
100. Valley Dasher (EDHREC 28435) - This creature attacks each combat if able.
101. Mage-Ring Bully (EDHREC 28473) - This creature attacks each combat if able.
102. Uncontrollable Anger (EDHREC 28640) - Enchanted creature gets +2/+2 and attacks each combat if able.
103. Ashen Monstrosity (EDHREC 28774) - This creature attacks each combat if able.
104. Kill-Suit Cultist (EDHREC 28821) - This creature attacks each combat if able.
105. Goblin Brigand (EDHREC 28966) - This creature attacks each combat if able.
106. Rubblebelt Recluse (EDHREC 29038) - This creature attacks each combat if able.
107. Infectious Bloodlust (EDHREC 29262) - Enchanted creature gets +2/+1, has haste, and attacks each combat if able.
108. Otarian Juggernaut (EDHREC 29419) - Threshold — As long as there are seven or more cards in your graveyard, this creature gets +3/+0 and attacks each combat if able.
109. Reckless Cohort (EDHREC 29804) - This creature attacks each combat if able unless you control another Ally.
110. Istvan, Butcher of Eln (EDHREC 29986) - Istvan attacks each combat if able.
111. Tattermunge Maniac (EDHREC 30055) - This creature attacks each combat if able.
112. Sabertooth Alley Cat (EDHREC 30108) - This creature attacks each combat if able.
113. Berserkers of Blood Ridge (EDHREC 30341) - This creature attacks each combat if able.
114. Flameborn Hellion (EDHREC 30486) - This creature attacks each combat if able.
115. Emberwilde Caliph (EDHREC 30571) - This creature attacks each combat if able.
116. Reckless Brute (EDHREC 30578) - This creature attacks each combat if able.
117. Bloodrock Cyclops (EDHREC 30756) - This creature attacks each combat if able.
118. Frontline Rebel (EDHREC 30811) - This creature attacks each combat if able.
119. Marauding Maulhorn (EDHREC 30992) - This creature attacks each combat if able unless you control a creature named Advocate of the Beast.
120. Cogwork Tracker (EDHREC 31417) - This creature attacks each combat if able.
121. Tectonic Fiend (EDHREC 31418) - This creature attacks each combat if able.
122. Thran War Machine (EDHREC 31520) - This creature attacks each combat if able.
123. Urborg Drake (EDHREC 31546) - This creature attacks each combat if able.
124. Boomstacker (unranked) - This creature attacks each combat if able.
125. Catch of the Day (unranked) - Whenever this creature attacks → Scry 2; goad target creature an opponent controls; or tap target creature an opponent controls.
126. The Five Stages of Grief (unranked) - II Anger — Goad target creature.

### 10. Non-Graveyard Exile Effects

Source: corpus-mined follow-on seam
Available after current queue exclusion: 443

1. Deadly Rollick (EDHREC 108) - Exile target creature.
2. Farewell (EDHREC 167) - • Exile all artifacts.
3. Reality Shift (EDHREC 280) - Exile target creature.
4. Despark (EDHREC 410) - Exile target permanent with mana value 4 or greater.
5. Ephemerate (EDHREC 440) - Exile target creature you control, then return it to the battlefield under its owner's control.
6. Conjurer's Closet (EDHREC 481) - At the beginning of your end step, you may exile target creature you control, then return that card to the battlefield under your control.
7. Displacer Kitten (EDHREC 549) - Avoidance — Whenever you cast a noncreature spell, exile up to one target nonland permanent you control, then return that card to the battlefield under its owner's control.
8. Opposition Agent (EDHREC 558) - While an opponent is searching their library, they exile each card they find.
9. Cloudshift (EDHREC 787) - Exile target creature you control, then return that card to the battlefield under your control.
10. Tear Asunder (EDHREC 868) - Exile target artifact or enchantment.
11. Resculpt (EDHREC 890) - Exile target artifact or creature.
12. Teleportation Circle (EDHREC 986) - At the beginning of your end step, exile up to one target artifact or creature you control, then return that card to the battlefield under its owner's control.
13. Grasp of Fate (EDHREC 1134) - When this enchantment enters, for each opponent, exile up to one target nonland permanent that player controls until this enchantment leaves the battlefield.
14. Skyclave Apparition (EDHREC 1210) - When this creature enters, exile up to one target nonland, nontoken permanent you don't control with mana value 4 or less.
15. Thassa, Deep-Dwelling (EDHREC 1269) - At the beginning of your end step, exile up to one other target creature you control, then return that card to the battlefield under your control.
16. Sheltered by Ghosts (EDHREC 1307) - When this Aura enters, exile target nonland permanent an opponent controls until this Aura leaves the battlefield.
17. Baleful Mastery (EDHREC 1366) - Exile target creature or planeswalker.
18. Restoration Angel (EDHREC 1367) - When this creature enters, you may exile target non-Angel creature you control, then return that card to the battlefield under your control.
19. Return to Dust (EDHREC 1537) - Exile target artifact or enchantment.
20. Urza's Ruinous Blast (EDHREC 1613) - Exile all nonland permanents that aren't legendary.
21. Utter End (EDHREC 1642) - Exile target nonland permanent.
22. Extraplanar Lens (EDHREC 1710) - Imprint — When this artifact enters, you may exile target land you control.
23. Touch the Spirit Realm (EDHREC 1848) - When this enchantment enters, exile up to one target artifact or creature until this enchantment leaves the battlefield.
24. Aven Interrupter (EDHREC 1876) - When this creature enters, exile target spell.
25. Ravenform (EDHREC 1915) - Exile target artifact or creature.
26. Winds of Abandon (EDHREC 2031) - Exile target creature you don't control.
27. Flicker of Fate (EDHREC 2096) - Exile target creature or enchantment, then return it to the battlefield under its owner's control.
28. Masked Vandal (EDHREC 2111) - If you do, exile target artifact or enchantment an opponent controls.
29. Rest in Peace (EDHREC 2291) - When this enchantment enters, exile all graveyards.
30. Displace (EDHREC 2299) - Exile up to two target creatures you control, then return those cards to the battlefield under their owner's control.
31. Banishing Light (EDHREC 2355) - When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.
32. Mnemonic Betrayal (EDHREC 2393) - Exile all opponents' graveyards.
33. Crib Swap (EDHREC 2431) - Exile target creature.
34. Y'shtola Rhul (EDHREC 2618) - At the beginning of your end step, exile target creature you control, then return it to the battlefield under its owner's control.
35. Lae'zel's Acrobatics (EDHREC 2746) - Exile all nontoken creatures you control, then roll a d20.
36. Sundial of the Infinite (EDHREC 2785) - {1}, {T}: End the turn. Activate only during your turn. (Exile all spells and abilities from the stack. Discard down to your maximum hand size. Damage wears off, and "this turn" and "until end of turn" effects end.)
37. Duplicant (EDHREC 2865) - Imprint — When this creature enters, you may exile target nontoken creature.
38. Merciless Eviction (EDHREC 3049) - • Exile all artifacts.
39. Éowyn, Fearless Knight (EDHREC 3161) - When Éowyn enters, exile target creature an opponent controls with greater power.
40. Ghostway (EDHREC 3331) - Exile each creature you control.
41. Pit of Offerings (EDHREC 3441) - When this land enters, exile up to three target cards from graveyards.
42. Council's Judgment (EDHREC 3535) - Will of the council — Starting with you, each player votes for a nonland permanent you don't control. Exile each permanent with the most votes or tied for most votes.
43. Titan's Presence (EDHREC 3538) - Exile target creature if its power is less than or equal to the revealed card's power.
44. Selective Obliteration (EDHREC 3597) - Then exile each permanent unless it's colorless or it's only the color its controller chose.
45. Angel of Serenity (EDHREC 3700) - When this creature enters, you may exile up to three other target creatures from the battlefield and/or creature cards from graveyards.
46. Final Act (EDHREC 3765) - • Exile all graveyards.
47. Desecrate Reality (EDHREC 3902) - For each opponent, exile up to one target permanent that player controls with an even mana value.
48. White Auracite (EDHREC 3954) - When this artifact enters, exile target nonland permanent an opponent controls until this artifact leaves the battlefield.
49. Palace Jailer (EDHREC 4011) - When this creature enters, exile target creature an opponent controls until an opponent becomes the monarch.
50. Crush Contraband (EDHREC 4232) - • Exile target artifact.
51. Ossification (EDHREC 4238) - When this Aura enters, exile target creature or planeswalker an opponent controls until this Aura leaves the battlefield.
52. Vanishing Verse (EDHREC 4289) - Exile target monocolored permanent.
53. Everything Comes to Dust (EDHREC 4508) - Exile all creatures except those that share a creature type with a creature that convoked this spell, all artifacts, and all enchantments.
54. Fractured Identity (EDHREC 4532) - Exile target nonland permanent.
55. Calamity of the Titans (EDHREC 4567) - Exile each creature and planeswalker with mana value less than the revealed card's mana value.
56. Far Traveler (EDHREC 4651) - Commander creatures you own have "At the beginning of your end step, exile up to one target tapped creature you control, then return it to the battlefield under its owner's control."
57. Ravnica at War (EDHREC 4820) - Exile all multicolored permanents.
58. Calix, Destiny's Hand (EDHREC 4874) - −3: Exile target creature or enchantment you don't control until target enchantment you control leaves the battlefield.
59. The Wanderer (EDHREC 4943) - −2: Exile target creature with power 4 or greater.
60. Slip On the Ring (EDHREC 5005) - Exile target creature you own, then return it to the battlefield under your control.
61. Contraband Livestock (EDHREC 5037) - Exile target creature, then roll a d20.
62. Chains of Custody (EDHREC 5151) - When this Aura enters, exile target nonland permanent an opponent controls until this Aura leaves the battlefield.
63. Scour from Existence (EDHREC 5279) - Exile target permanent.
64. Suspend (EDHREC 5460) - Exile target creature and put two time counters on it.
65. Abstruse Appropriation (EDHREC 5516) - Exile target nonland permanent.
66. Heartless Conscription (EDHREC 5647) - Exile all creatures.
67. The Mind Stone (EDHREC 5802) - ∞ — At the beginning of your end step, exile up to one other target nonland permanent you control, then return that card to the battlefield under its owner's control.
68. Introduction to Annihilation (EDHREC 5882) - Exile target nonland permanent.
69. Worldgorger Dragon (EDHREC 5895) - When this creature enters, exile all other permanents you control.
70. Golden Argosy (EDHREC 5979) - Whenever Golden Argosy attacks, exile each creature that crewed it this turn.
71. Exorcise (EDHREC 6110) - Exile target artifact, enchantment, or creature with power 4 or greater.
72. Hurl Through Hell (EDHREC 6120) - Exile target creature.
73. Venser, the Sojourner (EDHREC 6260) - +2: Exile target permanent you own.
74. Ashen Rider (EDHREC 6494) - When this creature enters or dies, exile target permanent.
75. Leveler (EDHREC 6551) - When this creature enters, exile all cards from your library.
76. Unexplained Absence (EDHREC 6623) - For each player, exile up to one target nonland permanent that player controls.
77. Soul Partition (EDHREC 6673) - Exile target nonland permanent.
78. Constricting Sliver (EDHREC 6782) - Sliver creatures you control have "When this creature enters, you may exile target creature an opponent controls until this creature leaves the battlefield."
79. Legions to Ashes (EDHREC 6825) - Exile target nonland permanent an opponent controls and all tokens that player controls with the same name as that permanent.
80. Buried in the Garden (EDHREC 6885) - When this Aura enters, exile target nonland permanent you don't control until this Aura leaves the battlefield.
81. Mystifying Maze (EDHREC 6908) - {4}, {T}: Exile target attacking creature an opponent controls. At the beginning of the next end step, return it to the battlefield tapped under its owner's control.
82. Justiciar's Portal (EDHREC 6929) - Exile target creature you control, then return that card to the battlefield under its owner's control.
83. Smirking Spelljacker (EDHREC 6943) - When this creature enters, exile target spell an opponent controls.
84. Unidentified Hovership (EDHREC 7001) - When this Vehicle enters, exile up to one target creature with toughness 5 or less.
85. Leonin Relic-Warder (EDHREC 7018) - When this creature enters, you may exile target artifact or enchantment.
86. Wastescape Battlemage (EDHREC 7069) - When you cast this spell, if it was kicked with its {G} kicker, exile target artifact or enchantment an opponent controls.
87. Karn Liberated (EDHREC 7103) - −3: Exile target permanent.
88. Legion's Initiative (EDHREC 7133) - {R}{W}, Exile this enchantment: Exile all creatures you control. At the beginning of the next combat, return those cards to the battlefield under their owner's control and those creatures gain haste until end of turn.
89. Overwhelming Remorse (EDHREC 7207) - Exile target creature or planeswalker.
90. Time Stop (EDHREC 7266) - End the turn. (Exile all spells and abilities, including this spell. The player whose turn it is discards down to their maximum hand size. Damage heals and "this turn" and "until end of turn" effects end.)
91. Meneldor, Swift Savior (EDHREC 7631) - Whenever Meneldor deals combat damage to a player, exile up to one target creature you own, then return it to the battlefield under your control.
92. Obeka, Brute Chronologist (EDHREC 7664) - {T}: The player whose turn it is may end the turn. (Exile all spells and abilities from the stack. The player whose turn it is discards down to their maximum hand size. Damage wears off, and "this turn" and "until end of turn" effects end.)
93. March of Otherworldly Light (EDHREC 7770) - Exile target artifact, creature, or enchantment with mana value X or less.
94. Mandate of Peace (EDHREC 7810) - End the combat phase. (Remove all attackers and blockers from combat. Exile all spells and abilities from the stack, including this spell.)
95. Epic Downfall (EDHREC 7836) - Exile target creature with mana value 3 or greater.
96. Admonition Angel (EDHREC 7898) - Landfall — Whenever a land you control enters, you may exile target nonland permanent other than this creature.
97. Guardian of Ghirapur (EDHREC 8089) - When this creature enters, exile up to one other target creature or artifact you control.
98. Revoke Existence (EDHREC 8090) - Exile target artifact or enchantment.
99. Worldfire (EDHREC 8136) - Exile all permanents.
100. Devourer of Destiny (EDHREC 8184) - When you cast this spell, exile target permanent that's one or more colors.
101. O-Kagachi, Vengeful Kami (EDHREC 8293) - Whenever O-Kagachi deals combat damage to a player, if that player attacked you during their last turn, exile target nonland permanent that player controls.
102. Final Judgment (EDHREC 8302) - Exile all creatures.
103. Detention Sphere (EDHREC 8307) - When this enchantment enters, you may exile target nonland permanent not named Detention Sphere and all other permanents with the same name as that permanent.
104. Salvation Swan (EDHREC 8334) - Whenever this creature or another Bird you control enters, exile up to one target creature you control without flying.
105. Hex Magic (EDHREC 8521) - Exile all the cards from your hand, then draw that many cards.
106. Phoenix Down (EDHREC 8527) - • Exile target Skeleton, Spirit, or Zombie.
107. Ultima (EDHREC 8565) - Destroy all artifacts and creatures. End the turn. (Exile all spells and abilities from the stack, including this card. The player whose turn it is discards down to their maximum hand size. Damage wears off, and "this turn" and "until end of turn" effects end.)
108. Journey to Nowhere (EDHREC 8606) - When this enchantment enters, exile target creature.
109. Haytham Kenway (EDHREC 8622) - When Haytham Kenway enters, for each opponent, exile up to one target creature that player controls until Haytham Kenway leaves the battlefield.
110. Gideon Blackblade (EDHREC 8671) - −6: Exile target nonland permanent.
111. Summary Dismissal (EDHREC 8798) - Exile all other spells and counter all abilities.
112. Trapped in the Screen (EDHREC 8828) - When this enchantment enters, exile target artifact, creature, or enchantment an opponent controls until this enchantment leaves the battlefield.
113. Angel of the Dire Hour (EDHREC 8841) - When this creature enters, if you cast it from your hand, exile all attacking creatures.
114. Annex Sentry (EDHREC 8869) - When this creature enters, exile target artifact or creature an opponent controls with mana value 3 or less until this creature leaves the battlefield.
115. Devout Chaplain (EDHREC 8902) - {T}, Tap two untapped Humans you control: Exile target artifact or enchantment.
116. Gale's Redirection (EDHREC 9041) - Exile target spell, then roll a d20 and add that spell's mana value.
117. Trapjaw Tyrant (EDHREC 9109) - Enrage — Whenever this creature is dealt damage, exile target creature an opponent controls until this creature leaves the battlefield.
118. Daydream (EDHREC 9161) - Exile target creature you control, then return that card to the battlefield under its owner's control with a +1/+1 counter on it.
119. Conclave Tribunal (EDHREC 9196) - When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.
120. Seal from Existence (EDHREC 9204) - When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.
121. In the Trenches (EDHREC 9345) - {5}{W}: Exile target nonland permanent you don't control until this enchantment leaves the battlefield. Activate only as a sorcery and only once.
122. Stalking Leonin (EDHREC 9370) - Reveal the player you chose: Exile target creature that's attacking you if it's controlled by the chosen player.
123. On Thin Ice (EDHREC 9372) - When this Aura enters, exile target creature an opponent controls until this Aura leaves the battlefield.
124. Release to the Wind (EDHREC 9505) - Exile target nonland permanent.
125. Kappa Tech-Wrecker (EDHREC 9568) - When you do, exile target artifact or enchantment that player controls.
126. Become Anonymous (EDHREC 9675) - Exile target nontoken creature you own and the top two cards of your library in a face-down pile, shuffle that pile, then cloak those cards.
127. Thieves' Auction (EDHREC 9686) - Exile all nontoken permanents.
128. Against All Odds (EDHREC 9696) - • Exile target artifact or creature you control, then return it to the battlefield under its owner's control.
129. Devouring Light (EDHREC 9699) - Exile target attacking or blocking creature.
130. Koh, the Face Stealer (EDHREC 9778) - When Koh enters, exile up to one other target creature.
131. Assimilation Aegis (EDHREC 9842) - When this Equipment enters, exile up to one target creature until this Equipment leaves the battlefield.
132. Break Down the Door (EDHREC 9843) - • Exile target artifact.
133. Perilous Vault (EDHREC 9867) - {5}, {T}, Exile this artifact: Exile all nonland permanents.
134. Skyskipper Duo (EDHREC 9882) - When this creature enters, exile up to one other target creature you control.
135. Extinction Event (EDHREC 10029) - Exile each creature with mana value of the chosen quality.
136. Leyline Binding (EDHREC 10044) - When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.
137. Web Up (EDHREC 10074) - When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.
138. Portable Hole (EDHREC 10088) - When this artifact enters, exile target nonland permanent an opponent controls with mana value 2 or less until this artifact leaves the battlefield.
139. Calamity's Wake (EDHREC 10157) - Exile all graveyards.
140. Spell Queller (EDHREC 10332) - When this creature enters, exile target spell with mana value 4 or less.
141. Nightmare Unmaking (EDHREC 10413) - • Exile each creature with power greater than the number of cards in your hand.
142. Lay Down Arms (EDHREC 10446) - Exile target creature with mana value less than or equal to the number of Plains you control.
143. Sinister Concierge (EDHREC 10460) - If you do, exile up to one target creature and put three time counters on it.
144. Glorious End (EDHREC 10506) - End the turn. (Exile all spells and abilities from the stack, including this card. The player whose turn it is discards down to their maximum hand size. Damage wears off, and "this turn" and "until end of turn" effects end.)
145. Flicker (EDHREC 10684) - Exile target nontoken permanent, then return it to the battlefield under its owner's control.
146. Discontinuity (EDHREC 10800) - End the turn. (Exile all spells and abilities from the stack, including this card. The player whose turn it is discards down to their maximum hand size. Damage wears off, and "this turn" and "until end of turn" effects end.)
147. Catapult Master (EDHREC 10897) - Tap five untapped Soldiers you control: Exile target creature.
148. Dakkon, Shadow Slayer (EDHREC 10934) - −3: Exile target creature.
149. Transmogrify (EDHREC 10958) - Exile target creature.
150. Beyond the Quiet (EDHREC 10968) - Exile all creatures and Spacecraft.
151. Skybind (EDHREC 11023) - Constellation — Whenever this enchantment or another enchantment you control enters, exile target nonenchantment permanent. Return that card to the battlefield under its owner's control at the beginning of the next end step.
152. Faith Unbroken (EDHREC 11043) - When this Aura enters, exile target creature an opponent controls until this Aura leaves the battlefield.
153. Icewind Stalwart (EDHREC 11195) - Protection Fighting Style — When this creature enters, exile up to one target non-Warrior creature you control, then return it to the battlefield under its owner's control.
154. All-Fates Stalker (EDHREC 11370) - When this creature enters, exile up to one target non-Assassin creature until this creature leaves the battlefield.
155. Anoint with Affliction (EDHREC 11411) - Exile target creature if it has mana value 3 or less.
156. Banisher Priest (EDHREC 11421) - When this creature enters, exile target creature an opponent controls until this creature leaves the battlefield.
157. Angelic Ascension (EDHREC 11423) - Exile target creature or planeswalker.
158. Ashiok, Nightmare Weaver (EDHREC 11446) - −10: Exile all cards from all opponents' hands and graveyards.
159. Aether Snap (EDHREC 11489) - Remove all counters from all permanents and exile all tokens.
160. Earth Kingdom Jailer (EDHREC 11603) - When this creature enters, exile up to one target artifact, creature, or enchantment an opponent controls with mana value 3 or greater until this creature leaves the battlefield.
161. Chaotic Transformation (EDHREC 11674) - Exile up to one target artifact, up to one target creature, up to one target enchantment, up to one target planeswalker, and/or up to one target land.
162. Stasis Snare (EDHREC 11764) - When this enchantment enters, exile target creature an opponent controls until this enchantment leaves the battlefield.
163. Silverquill Charm (EDHREC 12257) - • Exile target creature with power 2 or less.
164. Wanderer's Strike (EDHREC 12385) - Exile target creature, then proliferate.
165. Phyrexian Ingester (EDHREC 12415) - Imprint — When this creature enters, you may exile target nontoken creature.
166. Mistmeadow Witch (EDHREC 12457) - {2}{W}{U}: Exile target creature. Return that card to the battlefield under its owner's control at the beginning of the next end step.
167. Turn to Mist (EDHREC 12467) - Exile target creature.
168. Colossal Whale (EDHREC 12527) - Whenever this creature attacks, you may exile target creature defending player controls until this creature leaves the battlefield.
169. Author of Shadows (EDHREC 12737) - When this creature enters, exile all opponents' graveyards.
170. Boneyard Parley (EDHREC 12805) - Exile up to five target creature cards from graveyards.
171. Soul Transfer (EDHREC 12821) - • Exile target creature or planeswalker.
172. Drach'Nyen (EDHREC 12921) - Echo of the First Murder — When Drach'Nyen enters, exile up to one target creature.
173. Duelist's Flame (EDHREC 12946) - Exile up to one nonland card from among them and put the rest on the bottom of your library in a random order.
174. Thief of Existence (EDHREC 12952) - When you cast this spell, exile up to one target noncreature, nonland permanent an opponent controls with mana value 4 or less.
175. Erase (EDHREC 12971) - Exile target enchantment.
176. Wall of Nets (EDHREC 13005) - At end of combat, exile all creatures blocked by this creature.
177. Hardlight Containment (EDHREC 13024) - When this Aura enters, exile target creature an opponent controls until this Aura leaves the battlefield.
178. Galactus, Devourer of Worlds (EDHREC 13116) - When Galactus enters, exile target permanent.
179. The Mighty Thor, Jane Foster (EDHREC 13134) - Whenever The Mighty Thor attacks, exile up to one target nontoken artifact or creature, then return that card to the battlefield tapped under its owner's control.
180. Northampton Farm (EDHREC 13192) - {1}, {T}: Exile target creature you own.
181. Aligned Hedron Network (EDHREC 13290) - When this artifact enters, exile all creatures with power 5 or greater until this artifact leaves the battlefield.
182. Settle the Score (EDHREC 13295) - Exile target creature.
183. Fade into Antiquity (EDHREC 13531) - Exile target artifact or enchantment.
184. Voidwalk (EDHREC 13651) - Exile target creature.
185. Not on My Watch (EDHREC 13731) - Exile target attacking creature.
186. Synthetic Destiny (EDHREC 13894) - Exile all creatures you control.
187. Sigrid, God-Favored (EDHREC 13900) - When Sigrid enters, exile up to one target attacking or blocking creature until Sigrid leaves the battlefield.
188. Prismatic Ending (EDHREC 13979) - Converge — Exile target nonland permanent if its mana value is less than or equal to the number of colors of mana spent to cast this spell.
189. Mysterious Limousine (EDHREC 13980) - Whenever this Vehicle enters or attacks, exile up to one other target creature until this Vehicle leaves the battlefield.
190. Kin-Tree Severance (EDHREC 14071) - Exile target permanent with mana value 3 or greater.
191. Kaya, Spirits' Justice (EDHREC 14121) - −2: Exile target creature you control.
192. Sculpted Sunburst (EDHREC 14199) - If you chose a creature this way, exile each creature not chosen by any player this way.
193. Damage Control Crew (EDHREC 14335) - • Impound — Exile target artifact or enchantment.
194. Aurelia's Vindicator (EDHREC 14374) - When this creature is turned face up, exile up to X other target creatures from the battlefield and/or creature cards from graveyards.
195. Act of Authority (EDHREC 14450) - When this enchantment enters, you may exile target artifact or enchantment.
196. Banish to Another Universe (EDHREC 14527) - When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.
197. Ruin Ghost (EDHREC 14581) - {W}, {T}: Exile target land you control, then return it to the battlefield under your control.
198. Stormplain Detainment (EDHREC 14582) - When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.
199. Mass Polymorph (EDHREC 14611) - Exile all creatures you control, then reveal cards from the top of your library until you reveal that many creature cards.
200. Don & Leo, Problem Solvers (EDHREC 14668) - At the beginning of your end step, exile up to one target artifact you control and up to one target creature you control.

### 11. Power/Toughness Modification

Source: corpus-mined follow-on seam
Available after current queue exclusion: 4122

1. Toxic Deluge (EDHREC 67) - All creatures get -X/-X until end of turn.
2. Patchwork Banner (EDHREC 201) - Creatures you control of the chosen type get +1/+1.
3. Animate Dead (EDHREC 223) - Enchanted creature gets -1/-0.
4. Craterhoof Behemoth (EDHREC 312) - When this creature enters, creatures you control gain trample and get +X/+X until end of turn, where X is the number of creatures you control.
5. Shadowspear (EDHREC 317) - Equipped creature gets +1/+1 and has trample and lifelink.
6. Blackblade Reforged (EDHREC 349) - Equipped creature gets +1/+1 for each land you control.
7. Commander's Plate (EDHREC 487) - Equipped creature gets +3/+3 and has protection from each color that's not in your commander's color identity.
8. Faeburrow Elder (EDHREC 504) - This creature gets +1/+1 for each color among permanents you control.
9. Ignoble Hierarch (EDHREC 530) - Exalted (Whenever a creature you control attacks alone, that creature gets +1/+1 until end of turn.)
10. Overwhelming Stampede (EDHREC 538) - Until end of turn, creatures you control gain trample and get +X/+X, where X is the greatest power among creatures you control.
11. Sword of Feast and Famine (EDHREC 540) - Equipped creature gets +2/+2 and has protection from black and from green.
12. Darksteel Mutation (EDHREC 581) - Enchanted creature is an Insect artifact creature with base power and toughness 0/1 and has indestructible, and it loses all other abilities, card types, and creature types.
13. All That Glitters (EDHREC 620) - Enchanted creature gets +1/+1 for each artifact and/or enchantment you control.
14. Banner of Kinship (EDHREC 637) - Creatures you control of the chosen type get +1/+1 for each fellowship counter on this artifact.
15. Intangible Virtue (EDHREC 658) - Creature tokens you control get +1/+1 and have vigilance.
16. Goreclaw, Terror of Qal Sisma (EDHREC 668) - Whenever Goreclaw attacks, each creature you control with power 4 or greater gets +1/+1 and gains trample until end of turn.
17. Harmonic Prodigy (EDHREC 670) - Prowess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.)
18. Shared Animosity (EDHREC 677) - Whenever a creature you control attacks, it gets +1/+0 until end of turn for each other attacking creature that shares a creature type with it.
19. Mirari's Wake (EDHREC 692) - Creatures you control get +1/+1.
20. Rising of the Day (EDHREC 706) - Legendary creatures you control get +1/+0.
21. Hammer of Nazahn (EDHREC 744) - Equipped creature gets +2/+0 and has indestructible.
22. Champion's Helm (EDHREC 749) - Equipped creature gets +2/+2.
23. Valley Floodcaller (EDHREC 751) - Whenever you cast a noncreature spell, Birds, Frogs, Otters, and Rats you control get +1/+1 until end of turn.
24. Noble Hierarch (EDHREC 775) - Exalted (Whenever a creature you control attacks alone, that creature gets +1/+1 until end of turn.)
25. Veyran, Voice of Duality (EDHREC 780) - Magecraft — Whenever you cast or copy an instant or sorcery spell, Veyran gets +1/+1 until end of turn.
26. Flowering of the White Tree (EDHREC 802) - Legendary creatures you control get +2/+1 and have ward {1}.
27. Rancor (EDHREC 822) - Enchanted creature gets +2/+0 and has trample.
28. Elesh Norn, Grand Cenobite (EDHREC 845) - Other creatures you control get +2/+2.
29. Colossus Hammer (EDHREC 857) - Equipped creature gets +10/+10 and loses flying.
30. Heraldic Banner (EDHREC 862) - Creatures you control of the chosen color get +1/+0.
31. Tragic Slip (EDHREC 866) - Target creature gets -1/-1 until end of turn.
32. Bear Umbra (EDHREC 885) - Enchanted creature gets +2/+2 and has "Whenever this creature attacks, untap all lands you control."
33. Caged Sun (EDHREC 905) - Creatures you control of the chosen color get +1/+1.
34. Excalibur, Sword of Eden (EDHREC 906) - Equipped creature gets +10/+0 and has vigilance.
35. Elvish Archdruid (EDHREC 916) - Other Elf creatures you control get +1/+1.
36. Dismember (EDHREC 930) - Target creature gets -5/-5 until end of turn.
37. Bastion Protector (EDHREC 931) - Commander creatures you control get +2/+2 and have indestructible.
38. Stormcatch Mentor (EDHREC 939) - Prowess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.)
39. Coat of Arms (EDHREC 946) - Each creature gets +1/+1 for each other creature on the battlefield that shares at least one creature type with it.
40. Loxodon Warhammer (EDHREC 958) - Equipped creature gets +3/+0 and has trample and lifelink.
41. Mirror Entity (EDHREC 962) - {X}: Until end of turn, creatures you control have base power and toughness X/X and gain all creature types.
42. Moraug, Fury of Akoum (EDHREC 985) - Each creature you control gets +1/+0 for each time it has attacked this turn.
43. Defile (EDHREC 988) - Target creature gets -1/-1 until end of turn for each Swamp you control.
44. Castle Embereth (EDHREC 1071) - {1}{R}{R}, {T}: Creatures you control get +1/+0 until end of turn.
45. Ethereal Armor (EDHREC 1079) - Enchanted creature gets +1/+1 for each enchantment you control and has first strike.
46. Enduring Courage (EDHREC 1148) - Whenever another creature you control enters, it gets +2/+0 and gains haste until end of turn.
47. Amphibian Downpour (EDHREC 1223) - Enchanted creature loses all abilities and is a blue Frog creature with base power and toughness 1/1.
48. Moonshaker Cavalry (EDHREC 1227) - When this creature enters, creatures you control gain flying and get +X/+X until end of turn, where X is the number of creatures you control.
49. Slayers' Stronghold (EDHREC 1249) - {R}{W}, {T}: Target creature gets +2/+0 and gains vigilance and haste until end of turn.
50. Sheltered by Ghosts (EDHREC 1307) - Enchanted creature gets +1/+0 and has lifelink and ward {2}.
51. Embercleave (EDHREC 1339) - Equipped creature gets +1/+1 and has double strike and trample.
52. Conqueror's Flail (EDHREC 1363) - Equipped creature gets +1/+1 for each color among permanents you control.
53. Mantle of the Ancients (EDHREC 1369) - Enchanted creature gets +1/+1 for each Aura and Equipment attached to it.
54. Leyline Axe (EDHREC 1396) - Equipped creature gets +1/+1 and has double strike and trample.
55. Caduceus, Staff of Hermes (EDHREC 1412) - As long as you have 30 or more life, equipped creature gets +5/+5 and has indestructible and "Prevent all damage that would be dealt to this creature."
56. Lavaspur Boots (EDHREC 1474) - Equipped creature gets +1/+0 and has haste and ward {1}.
57. Morophon, the Boundless (EDHREC 1547) - Other creatures you control of the chosen type get +1/+1.
58. End-Raze Forerunners (EDHREC 1571) - When this creature enters, other creatures you control get +2/+2 and gain vigilance and trample until end of turn.
59. Sword of Vengeance (EDHREC 1572) - Equipped creature gets +2/+0 and has first strike, vigilance, trample, and haste.
60. Thran Power Suit (EDHREC 1574) - Equipped creature gets +1/+1 for each Aura and Equipment attached to it and has ward {2}.
61. Overprotect (EDHREC 1578) - Target creature you control gets +3/+3 and gains trample, hexproof, and indestructible until end of turn.
62. Eldrazi Conscription (EDHREC 1600) - Enchanted creature gets +10/+10 and has trample and annihilator 2.
63. Sting, the Glinting Dagger (EDHREC 1611) - Equipped creature gets +1/+1 and has haste.
64. Bloodforged Battle-Axe (EDHREC 1650) - Equipped creature gets +2/+0.
65. Massacre Girl (EDHREC 1672) - When Massacre Girl enters, each other creature gets -1/-1 until end of turn.
66. Kaldra Compleat (EDHREC 1679) - Equipped creature gets +5/+5 and has first strike, trample, indestructible, haste, and "Whenever this creature deals combat damage to a creature, exile that creature."
67. Shore Up (EDHREC 1682) - Target creature you control gets +1/+1 and gains hexproof until end of turn.
68. Mirror Box (EDHREC 1691) - Each legendary creature you control gets +1/+1.
69. Spirit Mantle (EDHREC 1703) - Enchanted creature gets +1/+1 and has protection from creatures.
70. Allosaurus Shepherd (EDHREC 1712) - {4}{G}{G}: Until end of turn, each Elf creature you control has base power and toughness 5/5 and becomes a Dinosaur in addition to its other creature types.
71. Overrun (EDHREC 1715) - Creatures you control get +3/+3 and gain trample until end of turn.
72. Death Baron (EDHREC 1723) - Skeletons you control and other Zombies you control get +1/+1 and have deathtouch.
73. Stridehangar Automaton (EDHREC 1747) - Thopters you control get +1/+1.
74. Adaptive Automaton (EDHREC 1756) - Other creatures you control of the chosen type get +1/+1.
75. Doomwake Giant (EDHREC 1776) - Constellation — Whenever this creature or another enchantment you control enters, creatures your opponents control get -1/-1 until end of turn.
76. Renewed Solidarity (EDHREC 1790) - Creatures you control of the chosen type get +1/+0.
77. Dragon's Rage Channeler (EDHREC 1808) - Delirium — As long as there are four or more card types among cards in your graveyard, this creature gets +2/+2, has flying, and attacks each combat if able.
78. Multani, Yavimaya's Avatar (EDHREC 1838) - Multani gets +1/+1 for each land you control and each land card in your graveyard.
79. Hero's Blade (EDHREC 1875) - Equipped creature gets +3/+2.
80. Sword of Forge and Frontier (EDHREC 1885) - Equipped creature gets +2/+2 and has protection from red and from green.
81. Witness Protection (EDHREC 1951) - Enchanted creature loses all abilities and is a green and white Citizen creature with base power and toughness 1/1 named Legitimate Businessperson.
82. Lord of the Accursed (EDHREC 1973) - Other Zombies you control get +1/+1.
83. Thunderfoot Baloth (EDHREC 1999) - Lieutenant — As long as you control your commander, this creature gets +2/+2 and other creatures you control get +2/+2 and have trample.
84. Crippling Fear (EDHREC 2000) - Creatures that aren't of the chosen type get -3/-3 until end of turn.
85. Drown in Ichor (EDHREC 2054) - Target creature gets -4/-4 until end of turn.
86. Weaver of Harmony (EDHREC 2056) - Other enchantment creatures you control get +1/+1.
87. Sudden Spoiling (EDHREC 2068) - Until end of turn, creatures target player controls lose all abilities and have base power and toughness 0/2.
88. Adaptive Omnitool (EDHREC 2088) - Equipped creature gets +1/+1 for each artifact you control.
89. Balmor, Battlemage Captain (EDHREC 2130) - Whenever you cast an instant or sorcery spell, creatures you control get +1/+0 and gain trample until end of turn.
90. Master of Etherium (EDHREC 2148) - Other artifact creatures you control get +1/+1.
91. Rhonas's Monument (EDHREC 2157) - Whenever you cast a creature spell, target creature you control gets +2/+2 and gains trample until end of turn.
92. Ruby, Daring Tracker (EDHREC 2162) - Whenever Ruby attacks while you control a creature with power 4 or greater, Ruby gets +2/+2 until end of turn.
93. Jetmir, Nexus of Revels (EDHREC 2182) - Creatures you control get +1/+0 and have vigilance as long as you control three or more creatures.
94. Overkill (EDHREC 2229) - Target creature gets -0/-9999 until end of turn.
95. Ancestral Mask (EDHREC 2230) - Enchanted creature gets +2/+2 for each other enchantment on the battlefield.
96. Dragonfire Blade (EDHREC 2246) - Equipped creature gets +2/+2 and has hexproof from monocolored.
97. Bloodthirsty Blade (EDHREC 2258) - Equipped creature gets +2/+0 and is goaded.
98. Lignify (EDHREC 2271) - Enchanted creature is a Treefolk with base power and toughness 0/4 and loses all abilities.
99. Blacksmith's Skill (EDHREC 2274) - If it's an artifact creature, it gets +2/+2 until end of turn.
100. It That Heralds the End (EDHREC 2328) - Other colorless creatures you control get +1/+1.
101. Umbral Mantle (EDHREC 2333) - Equipped creature has "{3}, {Q}: This creature gets +2/+2 until end of turn." ({Q} is the untap symbol.)
102. Tainted Strike (EDHREC 2338) - Target creature gets +1/+0 and gains infect until end of turn.
103. Icon of Ancestry (EDHREC 2356) - Creatures you control of the chosen type get +1/+1.
104. Mutilate (EDHREC 2375) - All creatures get -1/-1 until end of turn for each Swamp you control.
105. Cranial Plating (EDHREC 2389) - Equipped creature gets +1/+0 for each artifact you control.
106. Ezuri, Renegade Leader (EDHREC 2420) - {2}{G}{G}{G}: Elf creatures you control get +3/+3 and gain trample until end of turn.
107. Captivating Vampire (EDHREC 2477) - Other Vampire creatures you control get +1/+1.
108. Bruenor Battlehammer (EDHREC 2487) - Each creature you control gets +2/+0 for each Equipment attached to it.
109. Gauntlet of Power (EDHREC 2534) - Creatures of the chosen color get +1/+1.
110. Assault Formation (EDHREC 2535) - {2}{G}: Creatures you control get +0/+1 until end of turn.
111. The Immortal Sun (EDHREC 2567) - Creatures you control get +1/+1.
112. Goblin Chieftain (EDHREC 2587) - Other Goblin creatures you control get +1/+1 and have haste.
113. Blossoming Defense (EDHREC 2589) - Target creature you control gets +2/+2 and gains hexproof until end of turn.
114. Murkfiend Liege (EDHREC 2608) - Other green creatures you control get +1/+1.
115. Angelic Destiny (EDHREC 2617) - Enchanted creature gets +4/+4, has flying and first strike, and is an Angel in addition to its other types.
116. Hyena Umbra (EDHREC 2640) - Enchanted creature gets +1/+1 and has first strike.
117. Ghoulish Impetus (EDHREC 2646) - Enchanted creature gets +1/+1, has deathtouch, and is goaded.
118. Domri, Anarch of Bolas (EDHREC 2655) - Creatures you control get +1/+0.
119. Heroes' Podium (EDHREC 2658) - Each legendary creature you control gets +1/+1 for each other legendary creature you control.
120. Pemmin's Aura (EDHREC 2681) - {1}: Enchanted creature gets +1/-1 or -1/+1 until end of turn.
121. Gogo, Mysterious Mime (EDHREC 2730) - If you do, Gogo and that creature each get +2/+0 and gain haste until end of turn and attack this turn if able.
122. Fecund Greenshell (EDHREC 2781) - As long as you control ten or more lands, creatures you control get +2/+2.
123. Inspiring Leader (EDHREC 2791) - Commander creatures you own have "Creature tokens you control get +2/+2."
124. Sylvan Anthem (EDHREC 2797) - Green creatures you control get +1/+1.
125. Vorpal Sword (EDHREC 2801) - Equipped creature gets +2/+0 and has deathtouch.
126. Heartless Summoning (EDHREC 2807) - Creatures you control get -1/-1.
127. Guardian Augmenter (EDHREC 2809) - Commander creatures you control get +2/+2.
128. Silver-Fur Master (EDHREC 2824) - Other Ninja and Rogue creatures you control get +1/+1.
129. Simic Charm (EDHREC 2837) - • Target creature gets +3/+3 until end of turn.
130. Jodah, the Unifier (EDHREC 2848) - Legendary creatures you control get +X/+X, where X is the number of legendary creatures you control.
131. Weathered Sentinels (EDHREC 2853) - Whenever this creature attacks, it gets +3/+3 and gains indestructible until end of turn.
132. Chief of the Foundry (EDHREC 2868) - Other artifact creatures you control get +1/+1.
133. Nirkana Revenant (EDHREC 2872) - {B}: This creature gets +1/+1 until end of turn.
134. Undead Warchief (EDHREC 2874) - Zombie creatures you control get +2/+1.
135. Preposterous Proportions (EDHREC 2906) - Creatures you control get +10/+10 and gain vigilance until end of turn.
136. Nowhere to Run (EDHREC 2932) - When this enchantment enters, target creature an opponent controls gets -3/-3 until end of turn.
137. Tower Defense (EDHREC 2933) - Creatures you control get +0/+5 and gain reach until end of turn.
138. Aettir and Priwen (EDHREC 2971) - Equipped creature has base power and toughness X/X, where X is your life total.
139. Robe of Stars (EDHREC 2984) - Equipped creature gets +0/+3.
140. Bria, Riptide Rogue (EDHREC 2993) - Prowess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.)
141. Stromkirk Captain (EDHREC 3000) - Other Vampire creatures you control get +1/+1 and have first strike.
142. Legion Lieutenant (EDHREC 3009) - Other Vampires you control get +1/+1.
143. Blinkmoth Nexus (EDHREC 3027) - {1}, {T}: Target Blinkmoth creature gets +1/+1 until end of turn.
144. Empyrean Eagle (EDHREC 3044) - Other creatures you control with flying get +1/+1.
145. Wrecking Ball Arm (EDHREC 3097) - Equipped creature has base power and toughness 7/7 and can't be blocked by creatures with power 2 or less.
146. Elvish Champion (EDHREC 3109) - Other Elf creatures get +1/+1 and have forestwalk.
147. Blanchwood Armor (EDHREC 3114) - Enchanted creature gets +1/+1 for each Forest you control.
148. Jumbo Cactuar (EDHREC 3124) - 10,000 Needles — Whenever this creature attacks, it gets +9999/+0 until end of turn.
149. Mishra's Factory (EDHREC 3147) - {T}: Target Assembly-Worker creature gets +1/+1 until end of turn.
150. Tyvar, the Pummeler (EDHREC 3155) - {3}{G}{G}: Creatures you control get +X/+X until end of turn, where X is the greatest power among creatures you control.
151. Flayer of Loyalties (EDHREC 3174) - Until end of turn, it has base power and toughness 10/10 and gains trample, annihilator 2, and haste.
152. Skyhunter Strike Force (EDHREC 3176) - Melee (Whenever this creature attacks, it gets +1/+1 until end of turn for each opponent you attacked this combat.)
153. Favorable Winds (EDHREC 3193) - Creatures you control with flying get +1/+1.
154. Canopy Tactician (EDHREC 3202) - Other Elves you control get +1/+1.
155. Strong Back (EDHREC 3203) - Enchanted creature gets +2/+2 for each Aura and Equipment attached to it.
156. Magic Damper (EDHREC 3210) - Target creature you control gets +1/+1 and gains hexproof until end of turn.
157. Blossoming Tortoise (EDHREC 3235) - Land creatures you control get +1/+1.
158. Skarrg, the Rage Pits (EDHREC 3246) - {R}{G}, {T}: Target creature gets +1/+1 and gains trample until end of turn.
159. Ogre Battledriver (EDHREC 3262) - Whenever another creature you control enters, that creature gets +2/+0 and gains haste until end of turn.
160. Firebending Student (EDHREC 3276) - Prowess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.)
161. Lion Umbra (EDHREC 3281) - Enchanted creature gets +3/+3 and has reach and vigilance.
162. Make a Stand (EDHREC 3297) - Creatures you control get +1/+0 and gain indestructible until end of turn.
163. Nylea, God of the Hunt (EDHREC 3311) - {3}{G}: Target creature gets +2/+2 until end of turn.
164. Goblin King (EDHREC 3332) - Other Goblins get +1/+1 and have mountainwalk.
165. Celestial Armor (EDHREC 3361) - Equipped creature gets +2/+0 and has flying.
166. Giant Growth (EDHREC 3378) - Target creature gets +3/+3 until end of turn.
167. Eidolon of Countless Battles (EDHREC 3386) - This creature and enchanted creature each get +1/+1 for each creature you control and +1/+1 for each Aura you control.
168. Octopus Form (EDHREC 3424) - Target creature you control gets +1/+1 and gains hexproof until end of turn.
169. Pathbreaker Ibex (EDHREC 3428) - Whenever this creature attacks, creatures you control gain trample and get +X/+X until end of turn, where X is the greatest power among creatures you control.
170. Scion of Oona (EDHREC 3453) - Other Faerie creatures you control get +1/+1.
171. Knight Exemplar (EDHREC 3458) - Other Knight creatures you control get +1/+1 and have indestructible.
172. Komainu Battle Armor (EDHREC 3468) - Equipped creature gets +2/+2 and has menace.
173. Master of the Pearl Trident (EDHREC 3486) - Other Merfolk creatures you control get +1/+1 and have islandwalk.
174. Markov Baron (EDHREC 3591) - Other Vampires you control get +1/+1.
175. Jazal Goldmane (EDHREC 3606) - {3}{W}{W}: Attacking creatures you control get +X/+X until end of turn, where X is the number of attacking creatures.
176. Blazing Crescendo (EDHREC 3622) - Target creature gets +3/+1 until end of turn.
177. And They Shall Know No Fear (EDHREC 3628) - Creatures you control of the chosen type get +1/+0 and gain indestructible until end of turn.
178. Bladewing the Risen (EDHREC 3658) - {B}{R}: Dragon creatures get +1/+1 until end of turn.
179. Lyse Hext (EDHREC 3659) - Prowess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.)
180. Omnath, Locus of Mana (EDHREC 3668) - Omnath gets +1/+1 for each unspent green mana you have.
181. Behemoth Sledge (EDHREC 3684) - Equipped creature gets +2/+2 and has trample and lifelink.
182. Tempered Steel (EDHREC 3686) - Artifact creatures you control get +2/+2.
183. Whisper of the Dross (EDHREC 3690) - Target creature gets -1/-1 until end of turn.
184. Phyresis Outbreak (EDHREC 3696) - Then each creature your opponents control gets -1/-1 until end of turn for each poison counter its controller has.
185. All-Out Assault (EDHREC 3713) - Creatures you control get +1/+1 and have deathtouch.
186. Crucible of Fire (EDHREC 3739) - Dragon creatures you control get +3/+3.
187. Goldnight Commander (EDHREC 3749) - Whenever another creature you control enters, creatures you control get +1/+1 until end of turn.
188. Eaten by Piranhas (EDHREC 3761) - Enchanted creature loses all abilities and is a black Skeleton creature with base power and toughness 1/1.
189. Riptide Gearhulk (EDHREC 3762) - Prowess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.)
190. Eye of Nidhogg (EDHREC 3763) - Enchanted creature is a black Dragon with base power and toughness 4/2, has flying and deathtouch, and is goaded.
191. Martial Impetus (EDHREC 3768) - Enchanted creature gets +1/+1 and is goaded.
192. Stoneskin (EDHREC 3808) - Enchanted creature gets +0/+10.
193. Heirloom Blade (EDHREC 3823) - Equipped creature gets +3/+1.
194. The Irencrag (EDHREC 3834) - If you do, it gains equip {3} and "Equipped creature gets +3/+3" and loses all other abilities.
195. Salvation Engine (EDHREC 3862) - Other artifact creatures you control get +2/+2.
196. Rampaging Brontodon (EDHREC 3870) - Whenever this creature attacks, it gets +1/+1 until end of turn for each land you control.
197. Tifa, Martial Artist (EDHREC 3965) - Melee (Whenever this creature attacks, it gets +1/+1 until end of turn for each opponent you attacked this combat.)
198. Unable to Scream (EDHREC 3967) - Enchanted creature loses all abilities and is a Toy artifact creature with base power and toughness 0/2 in addition to its other types.
199. Obelisk of Urd (EDHREC 3972) - Creatures you control of the chosen type get +2/+2.
200. Colossification (EDHREC 3982) - Enchanted creature gets +20/+20.

### 12. Keyword Grants And Losses

Source: corpus-mined follow-on seam
Available after current queue exclusion: 2408

1. Swiftfoot Boots (EDHREC 12) - Equipped creature has hexproof and haste.
2. Lightning Greaves (EDHREC 13) - Equipped creature has haste and shroud.
3. Heroic Intervention (EDHREC 31) - Permanents you control gain hexproof and indestructible until end of turn.
4. Flawless Maneuver (EDHREC 181) - Creatures you control gain indestructible until end of turn.
5. Akroma's Will (EDHREC 189) - • Creatures you control gain flying, vigilance, and double strike until end of turn.
6. Mithril Coat (EDHREC 239) - Equipped creature has indestructible.
7. Craterhoof Behemoth (EDHREC 312) - When this creature enters, creatures you control gain trample and get +X/+X until end of turn, where X is the number of creatures you control.
8. Shadowspear (EDHREC 317) - Equipped creature gets +1/+1 and has trample and lifelink.
9. Whispersilk Cloak (EDHREC 332) - Equipped creature can't be blocked and has shroud.
10. Arena of Glory (EDHREC 375) - {R}, {T}, Exert this land: Add {R}{R}. If that mana is spent on a creature spell, it gains haste until end of turn. (An exerted permanent won't untap during your next untap step.)
11. Kessig Wolf Run (EDHREC 399) - {X}{R}{G}, {T}: Target creature gets +X/+0 and gains trample until end of turn.
12. Cursed Mirror (EDHREC 452) - As this artifact enters, you may have it become a copy of any creature on the battlefield until end of turn, except it has haste.
13. Vault of the Archangel (EDHREC 461) - {2}{W}{B}, {T}: Creatures you control gain deathtouch and lifelink until end of turn.
14. Vito, Thorn of the Dusk Rose (EDHREC 493) - {3}{B}{B}: Creatures you control gain lifelink until end of turn.
15. Plaza of Heroes (EDHREC 495) - {3}, {T}, Exile this land: Target legendary creature gains hexproof and indestructible until end of turn.
16. Overwhelming Stampede (EDHREC 538) - Until end of turn, creatures you control gain trample and get +X/+X, where X is the greatest power among creatures you control.
17. Brotherhood Regalia (EDHREC 551) - Equipped creature has ward {2}, is an Assassin in addition to its other types, and can't be blocked.
18. Darksteel Mutation (EDHREC 581) - Enchanted creature is an Insect artifact creature with base power and toughness 0/1 and has indestructible, and it loses all other abilities, card types, and creature types.
19. Goreclaw, Terror of Qal Sisma (EDHREC 668) - Whenever Goreclaw attacks, each creature you control with power 4 or greater gets +1/+1 and gains trample until end of turn.
20. Mockingbird (EDHREC 731) - You may have this creature enter as a copy of any creature on the battlefield with mana value less than or equal to the amount of mana spent to cast this creature, except it's a Bird in addition to its other types and it has flying.
21. Tyvar's Stand (EDHREC 736) - Target creature you control gets +X/+X and gains hexproof and indestructible until end of turn.
22. Hammer of Nazahn (EDHREC 744) - Equipped creature gets +2/+0 and has indestructible.
23. Champion's Helm (EDHREC 749) - As long as equipped creature is legendary, it has hexproof.
24. Rancor (EDHREC 822) - Enchanted creature gets +2/+0 and has trample.
25. Colossus Hammer (EDHREC 857) - Equipped creature gets +10/+10 and loses flying.
26. Excalibur, Sword of Eden (EDHREC 906) - Equipped creature gets +10/+0 and has vigilance.
27. Darksteel Plate (EDHREC 924) - Equipped creature has indestructible.
28. Loxodon Warhammer (EDHREC 958) - Equipped creature gets +3/+0 and has trample and lifelink.
29. Crashing Drawbridge (EDHREC 970) - {T}: Creatures you control gain haste until end of turn.
30. Bloodghast (EDHREC 1041) - This creature has haste as long as an opponent has 10 or less life.
31. The Wind Crystal (EDHREC 1049) - {4}{W}{W}, {T}: Creatures you control gain flying and lifelink until end of turn.
32. Karlach, Fury of Avernus (EDHREC 1051) - They gain first strike until end of turn.
33. Arcane Lighthouse (EDHREC 1064) - {1}, {T}: Until end of turn, creatures your opponents control lose hexproof and shroud and can't have hexproof or shroud.
34. Witch's Clinic (EDHREC 1073) - {2}, {T}: Target commander gains lifelink until end of turn.
35. Ethereal Armor (EDHREC 1079) - Enchanted creature gets +1/+1 for each enchantment you control and has first strike.
36. Fireshrieker (EDHREC 1115) - Equipped creature has double strike.
37. Skrelv, Defector Mite (EDHREC 1124) - {W/P}, {T}: Choose a color. Another target creature you control gains toxic 1 and hexproof from that color until end of turn. It can't be blocked by creatures of that color this turn. ({W/P} can be paid with either {W} or 2 life.)
38. Enduring Courage (EDHREC 1148) - Whenever another creature you control enters, it gets +2/+0 and gains haste until end of turn.
39. Genji Glove (EDHREC 1152) - Equipped creature has double strike.
40. Xenagos, God of Revels (EDHREC 1200) - At the beginning of combat on your turn, another target creature you control gains haste and gets +X/+X until end of turn, where X is that creature's power.
41. Moonshaker Cavalry (EDHREC 1227) - When this creature enters, creatures you control gain flying and get +X/+X until end of turn, where X is the number of creatures you control.
42. Slayers' Stronghold (EDHREC 1249) - {R}{W}, {T}: Target creature gets +2/+0 and gains vigilance and haste until end of turn.
43. Duelist's Heritage (EDHREC 1279) - Whenever one or more creatures attack, you may have target attacking creature gain double strike until end of turn.
44. Sheltered by Ghosts (EDHREC 1307) - Enchanted creature gets +1/+0 and has lifelink and ward {2}.
45. Atarka, World Render (EDHREC 1328) - Whenever a Dragon you control attacks, it gains double strike until end of turn.
46. Embercleave (EDHREC 1339) - Equipped creature gets +1/+1 and has double strike and trample.
47. Leyline Axe (EDHREC 1396) - Equipped creature gets +1/+1 and has double strike and trample.
48. Lizard Blades (EDHREC 1403) - Equipped creature has double strike.
49. Caduceus, Staff of Hermes (EDHREC 1412) - Equipped creature has lifelink.
50. Temur Battle Rage (EDHREC 1426) - Target creature gains double strike until end of turn.
51. Lavaspur Boots (EDHREC 1474) - Equipped creature gets +1/+0 and has haste and ward {1}.
52. Odric, Lunarch Marshal (EDHREC 1489) - At the beginning of each combat, creatures you control gain first strike until end of turn if a creature you control has first strike.
53. End-Raze Forerunners (EDHREC 1571) - When this creature enters, other creatures you control get +2/+2 and gain vigilance and trample until end of turn.
54. Sword of Vengeance (EDHREC 1572) - Equipped creature gets +2/+0 and has first strike, vigilance, trample, and haste.
55. Thran Power Suit (EDHREC 1574) - Equipped creature gets +1/+1 for each Aura and Equipment attached to it and has ward {2}.
56. Overprotect (EDHREC 1578) - Target creature you control gets +3/+3 and gains trample, hexproof, and indestructible until end of turn.
57. Smuggler's Surprise (EDHREC 1585) - + {1} — Creatures you control with power 4 or greater gain hexproof and indestructible until end of turn.
58. Eldrazi Conscription (EDHREC 1600) - Enchanted creature gets +10/+10 and has trample and annihilator 2.
59. Sting, the Glinting Dagger (EDHREC 1611) - Equipped creature gets +1/+1 and has haste.
60. Timely Ward (EDHREC 1659) - Enchanted creature has indestructible.
61. Kaldra Compleat (EDHREC 1679) - Equipped creature gets +5/+5 and has first strike, trample, indestructible, haste, and "Whenever this creature deals combat damage to a creature, exile that creature."
62. Shore Up (EDHREC 1682) - Target creature you control gets +1/+1 and gains hexproof until end of turn.
63. Overrun (EDHREC 1715) - Creatures you control get +3/+3 and gain trample until end of turn.
64. Dragon's Rage Channeler (EDHREC 1808) - Delirium — As long as there are four or more card types among cards in your graveyard, this creature gets +2/+2, has flying, and attacks each combat if able.
65. Silver Shroud Costume (EDHREC 1809) - That creature gains shroud until end of turn.
66. Sunhome, Fortress of the Legion (EDHREC 1813) - {2}{R}{W}, {T}: Target creature gains double strike until end of turn.
67. Archetype of Imagination (EDHREC 1825) - Creatures your opponents control lose flying and can't have or gain flying.
68. Temur Sabertooth (EDHREC 1870) - {1}{G}: You may return another creature you control to its owner's hand. If you do, this creature gains indestructible until end of turn.
69. Insurrection (EDHREC 1873) - They gain haste until end of turn.
70. Winged Boots (EDHREC 1874) - Equipped creature has flying and ward {4}.
71. Loran's Escape (EDHREC 1897) - Target artifact or creature gains hexproof and indestructible until end of turn.
72. Hellkite Courser (EDHREC 1898) - It gains haste.
73. Lord of the Accursed (EDHREC 1973) - {1}{B}, {T}: All Zombies gain menace until end of turn.
74. Mutational Advantage (EDHREC 1983) - Permanents you control with counters on them gain hexproof and indestructible until end of turn.
75. Shinka, the Bloodsoaked Keep (EDHREC 1998) - {R}, {T}: Target legendary creature gains first strike until end of turn.
76. Wake the Past (EDHREC 2035) - They gain haste until end of turn.
77. Everybody Lives! (EDHREC 2073) - All creatures gain hexproof and indestructible until end of turn.
78. Paradise Druid (EDHREC 2081) - This creature has hexproof as long as it's untapped.
79. Mina and Denn, Wildborn (EDHREC 2114) - {R}{G}, Return a land you control to its owner's hand: Target creature gains trample until end of turn.
80. Haunted Cloak (EDHREC 2115) - Equipped creature has vigilance, trample, and haste.
81. Delay (EDHREC 2119) - Counter target spell. If the spell is countered this way, exile it with three time counters on it instead of putting it into its owner's graveyard. If it doesn't have suspend, it gains suspend. (At the beginning of its owner's upkeep, they remove a time counter. When the last is removed, they may play it without paying its mana cost. If it's a creature, it has haste.)
82. Balmor, Battlemage Captain (EDHREC 2130) - Whenever you cast an instant or sorcery spell, creatures you control get +1/+0 and gain trample until end of turn.
83. Poison Dart Frog (EDHREC 2151) - {2}: This creature gains deathtouch until end of turn.
84. Rhonas's Monument (EDHREC 2157) - Whenever you cast a creature spell, target creature you control gets +2/+2 and gains trample until end of turn.
85. Carnelian Orb of Dragonkind (EDHREC 2195) - {T}: Add {R}. If that mana is spent on a Dragon creature spell, it gains haste until end of turn.
86. Final Showdown (EDHREC 2216) - + {1} — Choose a creature you control. It gains indestructible until end of turn.
87. Dragonfire Blade (EDHREC 2246) - Equipped creature gets +2/+2 and has hexproof from monocolored.
88. Blacksmith's Skill (EDHREC 2274) - Target permanent gains hexproof and indestructible until end of turn.
89. Mimic Vat (EDHREC 2345) - {3}, {T}: Create a token that's a copy of a card exiled with this artifact. It gains haste. Exile it at the beginning of the next end step.
90. Zealous Conscripts (EDHREC 2349) - It gains haste until end of turn.
91. Ezuri, Renegade Leader (EDHREC 2420) - {2}{G}{G}{G}: Elf creatures you control get +3/+3 and gain trample until end of turn.
92. Amonkhet Raceway (EDHREC 2449) - Max speed — {T}: Target creature gains haste until end of turn.
93. Twinferno (EDHREC 2581) - • Target creature you control gains double strike until end of turn. (It deals both first-strike and regular combat damage.)
94. Gold-Forged Thopteryx (EDHREC 2584) - Each legendary permanent you control has ward {2}.
95. Blossoming Defense (EDHREC 2589) - Target creature you control gets +2/+2 and gains hexproof until end of turn.
96. Angelic Destiny (EDHREC 2617) - Enchanted creature gets +4/+4, has flying and first strike, and is an Angel in addition to its other types.
97. Hyena Umbra (EDHREC 2640) - Enchanted creature gets +1/+1 and has first strike.
98. Ghoulish Impetus (EDHREC 2646) - Enchanted creature gets +1/+1, has deathtouch, and is goaded.
99. Pemmin's Aura (EDHREC 2681) - {U}: Enchanted creature gains flying until end of turn.
100. Skithiryx, the Blight Dragon (EDHREC 2685) - {B}: Skithiryx gains haste until end of turn.
101. Quietus Spike (EDHREC 2716) - Equipped creature has deathtouch.
102. Gogo, Mysterious Mime (EDHREC 2730) - If you do, Gogo and that creature each get +2/+0 and gain haste until end of turn and attack this turn if able.
103. Vorpal Sword (EDHREC 2801) - Equipped creature gets +2/+0 and has deathtouch.
104. Witch-king of Angmar (EDHREC 2805) - Discard a card: Witch-king of Angmar gains indestructible until end of turn.
105. Ultimate Magic: Holy (EDHREC 2818) - Permanents you control gain indestructible until end of turn.
106. Simic Charm (EDHREC 2837) - • Permanents you control gain hexproof until end of turn.
107. Archetype of Aggression (EDHREC 2850) - Creatures your opponents control lose trample and can't have or gain trample.
108. Weathered Sentinels (EDHREC 2853) - Whenever this creature attacks, it gets +3/+3 and gains indestructible until end of turn.
109. Archetype of Endurance (EDHREC 2864) - Creatures your opponents control lose hexproof and can't have or gain hexproof.
110. Reyav, Master Smith (EDHREC 2879) - Whenever a creature you control that's enchanted or equipped attacks, that creature gains double strike until end of turn.
111. Preposterous Proportions (EDHREC 2906) - Creatures you control get +10/+10 and gain vigilance until end of turn.
112. Tower Defense (EDHREC 2933) - Creatures you control get +0/+5 and gain reach until end of turn.
113. Savage Beating (EDHREC 2939) - • Creatures you control gain double strike until end of turn.
114. Surge of Salvation (EDHREC 2975) - You and permanents you control gain hexproof until end of turn.
115. Hall of the Bandit Lord (EDHREC 2979) - {T}, Pay 3 life: Add {C}. If that mana is spent on a creature spell, it gains haste.
116. Alpha Authority (EDHREC 3067) - Enchanted creature has hexproof and can't be blocked by more than one creature.
117. Otepec Huntmaster (EDHREC 3073) - {T}: Target Dinosaur gains haste until end of turn.
118. Frontier Warmonger (EDHREC 3137) - Whenever one or more creatures attack one of your opponents or a planeswalker they control, those creatures gain menace until end of turn.
119. Tyvar, the Pummeler (EDHREC 3155) - Tap another untapped creature you control: Tyvar gains indestructible until end of turn.
120. Flayer of Loyalties (EDHREC 3174) - Until end of turn, it has base power and toughness 10/10 and gains trample, annihilator 2, and haste.
121. Hanweir Battlements (EDHREC 3201) - {R}, {T}: Target creature gains haste until end of turn.
122. Magic Damper (EDHREC 3210) - Target creature you control gets +1/+1 and gains hexproof until end of turn.
123. Skarrg, the Rage Pits (EDHREC 3246) - {R}{G}, {T}: Target creature gets +1/+1 and gains trample until end of turn.
124. Ogre Battledriver (EDHREC 3262) - Whenever another creature you control enters, that creature gets +2/+0 and gains haste until end of turn.
125. Lion Umbra (EDHREC 3281) - Enchanted creature gets +3/+3 and has reach and vigilance.
126. Make a Stand (EDHREC 3297) - Creatures you control get +1/+0 and gain indestructible until end of turn.
127. Skittering Cicada (EDHREC 3321) - Whenever you cast a colorless spell, until end of turn, this creature gains trample and gets +X/+X, where X is that spell's mana value.
128. Shielded by Faith (EDHREC 3327) - Enchanted creature has indestructible.
129. Celestial Armor (EDHREC 3361) - That creature gains hexproof and indestructible until end of turn.
130. Mob Rule (EDHREC 3367) - • Gain control of all creatures with power 4 or greater until end of turn. Untap those creatures. They gain haste until end of turn.
131. Soul of New Phyrexia (EDHREC 3421) - {5}: Permanents you control gain indestructible until end of turn.
132. Octopus Form (EDHREC 3424) - Target creature you control gets +1/+1 and gains hexproof until end of turn.
133. Pathbreaker Ibex (EDHREC 3428) - Whenever this creature attacks, creatures you control gain trample and get +X/+X until end of turn, where X is the greatest power among creatures you control.
134. Agent Frank Horrigan (EDHREC 3447) - Agent Frank Horrigan has indestructible as long as it attacked this turn.
135. Captivating Crew (EDHREC 3451) - {3}{R}: Gain control of target creature an opponent controls until end of turn. Untap that creature. It gains haste until end of turn. Activate only as a sorcery.
136. Komainu Battle Armor (EDHREC 3468) - Equipped creature gets +2/+2 and has menace.
137. Daily Bugle Building (EDHREC 3536) - Smear Campaign — {1}, {T}: Target legendary creature gains menace until end of turn. Activate only as a sorcery.
138. Coercive Recruiter (EDHREC 3576) - Until end of turn, it gains haste and becomes a Pirate in addition to its other types.
139. Redemption Arc (EDHREC 3609) - Enchanted creature has indestructible and is goaded.
140. Berserk (EDHREC 3624) - Target creature gains trample and gets +X/+0 until end of turn, where X is its power.
141. And They Shall Know No Fear (EDHREC 3628) - Creatures you control of the chosen type get +1/+0 and gain indestructible until end of turn.
142. Flamekin Village (EDHREC 3636) - {R}, {T}: Target creature gains haste until end of turn.
143. Lyse Hext (EDHREC 3659) - As long as you've cast two or more noncreature spells this turn, Lyse Hext has double strike.
144. Behemoth Sledge (EDHREC 3684) - Equipped creature gets +2/+2 and has trample and lifelink.
145. Thundermane Dragon (EDHREC 3699) - If you cast a creature spell this way, it gains haste until end of turn.
146. Squall, SeeD Mercenary (EDHREC 3733) - Rough Divide — Whenever a creature you control attacks alone, it gains double strike until end of turn.
147. Eye of Nidhogg (EDHREC 3763) - Enchanted creature is a black Dragon with base power and toughness 4/2, has flying and deathtouch, and is goaded.
148. Hideous Taskmaster (EDHREC 3784) - They gain trample, haste, and annihilator 1 until end of turn.
149. The Masamune (EDHREC 3822) - As long as equipped creature is attacking, it has first strike and must be blocked if able.
150. Deceptive Frostkite (EDHREC 3844) - You may have this creature enter as a copy of a creature you control with power 4 or greater, except it's a Dragon in addition to its other types and it has flying.
151. Vivien, Champion of the Wilds (EDHREC 3897) - +1: Until your next turn, up to one target creature gains reach and vigilance.
152. Reins of Power (EDHREC 3912) - Those creatures gain haste until end of turn.
153. Scion of Draco (EDHREC 3936) - Each creature you control has vigilance if it's white, hexproof if it's blue, lifelink if it's black, first strike if it's red, and trample if it's green.
154. Ozai, the Phoenix King (EDHREC 3993) - Ozai has flying and indestructible as long as you have six or more unspent mana.
155. Barbarian Class (EDHREC 4015) - Whenever you roll one or more dice, target creature you control gets +2/+0 and gains menace until end of turn.
156. Hero's Heirloom (EDHREC 4041) - As long as equipped creature is legendary, it has trample and haste.
157. Mask of Avacyn (EDHREC 4045) - Equipped creature gets +1/+2 and has hexproof.
158. Maul of the Skyclaves (EDHREC 4062) - Equipped creature gets +2/+2 and has flying and first strike.(It deals combat damage before creatures without first strike.)
159. Haste Magic (EDHREC 4064) - Target creature gets +3/+1 and gains haste until end of turn.
160. Nazgûl Battle-Mace (EDHREC 4070) - Equipped creature has menace, deathtouch, annihilator 1, and "Whenever an opponent sacrifices a nontoken permanent, put that card onto the battlefield under your control unless that player pays 3 life." (Whenever a creature with annihilator 1 attacks, defending player sacrifices a permanent of their choice.)
161. Coppercoat Vanguard (EDHREC 4073) - Each other Human you control gets +1/+0 and has ward {1}.
162. Assault Suit (EDHREC 4135) - Equipped creature gets +2/+2, has haste, can't attack you or planeswalkers you control, and can't be sacrificed.
163. Mothdust Changeling (EDHREC 4274) - Tap an untapped creature you control: This creature gains flying until end of turn.
164. Plumecreed Escort (EDHREC 4297) - When this creature enters, target creature you control gains hexproof until end of turn.
165. Chocobo Knights (EDHREC 4381) - Whenever you attack, creatures you control with counters on them gain double strike until end of turn.
166. Vizkopa Guildmage (EDHREC 4415) - {1}{W}{B}: Target creature gains lifelink until end of turn.
167. Malleable Impostor (EDHREC 4449) - You may have this creature enter as a copy of a creature an opponent controls, except it's a Faerie Shapeshifter in addition to its other types and it has flying.
168. Walking Bulwark (EDHREC 4455) - {2}: Until end of turn, target creature with defender gains haste, can attack as though it didn't have defender, and assigns combat damage equal to its toughness rather than its power. Activate only as a sorcery.
169. Selfless Safewright (EDHREC 4458) - Other permanents you control of that type gain hexproof and indestructible until end of turn.
170. Shield of the Oversoul (EDHREC 4459) - As long as enchanted creature is green, it gets +1/+1 and has indestructible.
171. Battle Mastery (EDHREC 4478) - Enchanted creature has double strike.
172. Short Bow (EDHREC 4480) - Equipped creature gets +1/+1 and has reach and vigilance.
173. Legion Loyalist (EDHREC 4482) - Battalion — Whenever this creature and at least two other creatures attack, creatures you control gain first strike and trample until end of turn and can't be blocked by creature tokens this turn.
174. Archetype of Courage (EDHREC 4510) - Creatures your opponents control lose first strike and can't have or gain first strike.
175. Grim Reaper's Sprint (EDHREC 4537) - Enchanted creature gets +2/+2 and has haste.
176. Sokrates, Athenian Teacher (EDHREC 4553) - Sokrates has hexproof as long as it's untapped.
177. Théoden, King of Rohan (EDHREC 4592) - Whenever Théoden or another Human you control enters, target creature gains double strike until end of turn.
178. Paladin Class (EDHREC 4607) - Whenever you attack, until end of turn, target attacking creature gets +1/+1 for each other attacking creature and gains double strike.
179. Enter the Avatar State (EDHREC 4616) - Until end of turn, target creature you control becomes an Avatar in addition to its other types and gains flying, first strike, lifelink, and hexproof.
180. Act of Treason (EDHREC 4737) - It gains haste until end of turn.
181. Divine Resilience (EDHREC 4752) - Target creature you control gains indestructible until end of turn.
182. Restless Spire (EDHREC 4754) - {U}{R}: Until end of turn, this land becomes a 2/1 blue and red Elemental creature with "During your turn, this creature has first strike." It's still a land.
183. Doors of Durin (EDHREC 4756) - Until your next turn, it gains trample if you control a Dwarf and hexproof if you control an Elf.
184. Stonehoof Chieftain (EDHREC 4782) - Whenever another creature you control attacks, it gains trample and indestructible until end of turn.
185. Nogi, Draco-Zealot (EDHREC 4793) - Whenever Nogi attacks, if you control three or more Dragons, until end of turn, Nogi becomes a Dragon with base power and toughness 5/5 and gains flying.
186. Winota, Joiner of Forces (EDHREC 4834) - It gains indestructible until end of turn.
187. Twinblade Blessing (EDHREC 4859) - Enchanted creature has double strike.
188. Freya Crescent (EDHREC 4861) - Jump — During your turn, Freya Crescent has flying.
189. Tromokratis (EDHREC 4916) - Tromokratis has hexproof unless it's attacking or blocking.
190. Elenda, Saint of Dusk (EDHREC 4917) - As long as your life total is greater than your starting life total, Elenda gets +1/+1 and has menace.
191. Taigam, Master Opportunist (EDHREC 4925) - Flurry — Whenever you cast your second spell each turn, copy it, then exile the spell you cast with four time counters on it. If it doesn't have suspend, it gains suspend. (At the beginning of its owner's upkeep, they remove a time counter. When the last is removed, they may play it without paying its mana cost. If it's a creature, it has haste.)
192. God-Eternal Rhonas (EDHREC 4935) - Those creatures gain vigilance until end of turn.
193. Flaming Fist (EDHREC 4936) - Commander creatures you own have "Whenever this creature attacks, it gains double strike until end of turn."
194. Brass Knuckles (EDHREC 4959) - Equipped creature has double strike as long as two or more Equipment are attached to it.
195. Agility Bobblehead (EDHREC 4996) - {3}, {T}: Up to X target creatures you control each gain haste until end of turn and can't be blocked this turn except by creatures with haste, where X is the number of Bobbleheads you control as you activate this ability.
196. Minthara, Merciless Soul (EDHREC 5019) - Minthara has ward {X}, where X is the number of experience counters you have.
197. Kamahl, Heart of Krosa (EDHREC 5076) - At the beginning of combat on your turn, creatures you control get +3/+3 and gain trample until end of turn.
198. Cloudsteel Kirin (EDHREC 5100) - Equipped creature has flying and "You can't lose the game and your opponents can't win the game."
199. Akroma, Vision of Ixidor (EDHREC 5112) - At the beginning of each combat, until end of turn, each other creature you control gets +1/+1 if it has flying, +1/+1 if it has first strike, and so on for double strike, deathtouch, haste, hexproof, indestructible, lifelink, menace, protection, reach, trample, vigilance, and partner.
200. Rhonas the Indomitable (EDHREC 5132) - {2}{G}: Another target creature gets +2/+0 and gains trample until end of turn.

### 13. Combat Restrictions And Evasion Rules

Source: corpus-mined follow-on seam
Available after current queue exclusion: 1735

1. Rogue's Passage (EDHREC 18) - {4}, {T}: Target creature can't be blocked this turn.
2. Propaganda (EDHREC 115) - Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.
3. Ghostly Prison (EDHREC 161) - Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.
4. Whispersilk Cloak (EDHREC 332) - Equipped creature can't be blocked and has shroud.
5. Brotherhood Regalia (EDHREC 551) - Equipped creature has ward {2}, is an Assassin in addition to its other types, and can't be blocked.
6. Access Tunnel (EDHREC 588) - {3}, {T}: Target creature with power 3 or less can't be blocked this turn.
7. Shizo, Death's Storehouse (EDHREC 614) - {B}, {T}: Target legendary creature gains fear until end of turn. (It can't be blocked except by artifact creatures and/or black creatures.)
8. Changeling Outcast (EDHREC 663) - This creature can't block and can't be blocked.
9. Trailblazer's Boots (EDHREC 664) - (It can't be blocked as long as defending player controls a nonbasic land.)
10. Sphere of Safety (EDHREC 669) - Creatures can't attack you or planeswalkers you control unless their controller pays {X} for each of those creatures, where X is the number of enchantments you control.
11. Sheoldred, Whispering One (EDHREC 709) - Swampwalk (This creature can't be blocked as long as defending player controls a Swamp.)
12. Aqueous Form (EDHREC 743) - Enchanted creature can't be blocked.
13. Delney, Streetwise Lookout (EDHREC 844) - Creatures you control with power 2 or less can't be blocked by creatures with power 3 or greater.
14. Promise of Loyalty (EDHREC 955) - Each of those creatures can't attack you or planeswalkers you control for as long as it has a vow counter on it.
15. Windborn Muse (EDHREC 998) - Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.
16. Wayward Swordtooth (EDHREC 1014) - This creature can't attack or block unless you have the city's blessing.
17. Manifold Key (EDHREC 1030) - {3}, {T}: Target creature can't be blocked this turn.
18. Bloodghast (EDHREC 1041) - This creature can't block.
19. Skrelv, Defector Mite (EDHREC 1124) - Skrelv can't block.
20. The Black Gate (EDHREC 1198) - {1}{B}, {T}: Choose a player with the most life or tied for most life. Target creature can't be blocked by creatures that player controls this turn.
21. Secret Tunnel (EDHREC 1444) - This land can't be blocked.
22. Cover of Darkness (EDHREC 1455) - (They can't be blocked except by artifact creatures and/or black creatures.)
23. Tetsuko Umezawa, Fugitive (EDHREC 1604) - Creatures you control with power or toughness 1 or less can't be blocked.
24. Void Winnower (EDHREC 1692) - Your opponents can't block with creatures with even mana values.
25. Slither Blade (EDHREC 1716) - This creature can't be blocked.
26. Dragon's Rage Channeler (EDHREC 1808) - Delirium — As long as there are four or more card types among cards in your graveyard, this creature gets +2/+2, has flying, and attacks each combat if able.
27. Silver Shroud Costume (EDHREC 1809) - Equipped creature can't be blocked.
28. Sonic Screwdriver (EDHREC 1899) - {3}, {T}: Target creature can't be blocked this turn.
29. Orim's Chant (EDHREC 1905) - If this spell was kicked, creatures can't attack this turn.
30. Port Razer (EDHREC 1917) - This creature can't attack a player it has already attacked this turn.
31. Norn's Annex (EDHREC 1960) - Creatures can't attack you or planeswalkers you control unless their controller pays {W/P} for each of those creatures.
32. Thassa, God of the Sea (EDHREC 1972) - {1}{U}: Target creature you control can't be blocked this turn.
33. Triton Shorestalker (EDHREC 2002) - This creature can't be blocked.
34. Crystal Barricade (EDHREC 2067) - Defender (This creature can't attack.)
35. Taunt from the Rampart (EDHREC 2077) - Until your next turn, those creatures can't block.
36. The Mindskinner (EDHREC 2150) - The Mindskinner can't be blocked.
37. Sepulchral Primordial (EDHREC 2196) - Intimidate (This creature can't be blocked except by artifact creatures and/or creatures that share a color with it.)
38. Archangel of Tithes (EDHREC 2202) - As long as this creature is untapped, creatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures.
39. Bloodthirsty Blade (EDHREC 2258) - (It attacks each combat if able and attacks a player other than you if able.)
40. Pathrazer of Ulamog (EDHREC 2414) - This creature can't be blocked except by three or more creatures.
41. Forsaken Miner (EDHREC 2451) - This creature can't block.
42. Baird, Steward of Argive (EDHREC 2549) - Creatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures.
43. Bloodthirster (EDHREC 2551) - This creature can't attack a player it has already attacked this turn.
44. Ghoulish Impetus (EDHREC 2646) - (It attacks each combat if able and attacks a player other than you if able.)
45. Mirri, Weatherlight Duelist (EDHREC 2660) - Whenever Mirri attacks, each opponent can't block with more than one creature this combat.
46. Invisible Stalker (EDHREC 2673) - This creature can't be blocked.
47. Anzrag, the Quake-Mole (EDHREC 2680) - {3}{R}{R}{G}{G}: Anzrag must be blocked each combat this turn if able.
48. Fog Bank (EDHREC 2721) - Defender (This creature can't attack.)
49. Mist-Cloaked Herald (EDHREC 2830) - This creature can't be blocked.
50. Stormtide Leviathan (EDHREC 2838) - Islandwalk (This creature can't be blocked as long as defending player controls an Island.)
51. Creeping Tar Pit (EDHREC 2960) - {1}{U}{B}: Until end of turn, this land becomes a 3/2 blue and black Elemental creature. It's still a land. It can't be blocked this turn.
52. Bria, Riptide Rogue (EDHREC 2993) - Whenever you cast a noncreature spell, target creature you control can't be blocked this turn.
53. Stonybrook Banneret (EDHREC 3045) - Islandwalk (This creature can't be blocked as long as defending player controls an Island.)
54. Blighted Agent (EDHREC 3054) - This creature can't be blocked.
55. Alpha Authority (EDHREC 3067) - Enchanted creature has hexproof and can't be blocked by more than one creature.
56. Bothersome Quasit (EDHREC 3081) - Goaded creatures your opponents control can't block.
57. Wrecking Ball Arm (EDHREC 3097) - Equipped creature has base power and toughness 7/7 and can't be blocked by creatures with power 2 or less.
58. Elvish Champion (EDHREC 3109) - (They can't be blocked as long as defending player controls a Forest.)
59. Gríma, Saruman's Footman (EDHREC 3182) - Gríma can't be blocked.
60. Pippin, Guard of the Citadel (EDHREC 3183) - {T}: Another target creature you control gains protection from the card type of your choice until end of turn. (It can't be blocked, targeted, dealt damage, enchanted, or equipped by anything of that type.)
61. Misleading Signpost (EDHREC 3221) - (It can't attack its controller or their permanents.)
62. Zirda, the Dawnwaker (EDHREC 3289) - {1}, {T}: Target creature can't block this turn.
63. Tormented Soul (EDHREC 3388) - This creature can't block and can't be blocked.
64. Killian, Ink Duelist (EDHREC 3401) - Menace (This creature can't be blocked except by two or more creatures.)
65. K-9, Mark I (EDHREC 3403) - Affirmative — {1}{U}, {T}: Target legendary creature can't be blocked this turn.
66. Prowler's Helm (EDHREC 3404) - Equipped creature can't be blocked except by Walls.
67. Ulamog's Crusher (EDHREC 3406) - This creature attacks each combat if able.
68. Gods Willing (EDHREC 3479) - (It can't be blocked, targeted, dealt damage, enchanted, or equipped by anything of that color.)
69. Master of the Pearl Trident (EDHREC 3486) - (They can't be blocked as long as defending player controls an Island.)
70. Redemption Arc (EDHREC 3609) - (It attacks each combat if able and attacks a player other than you if able.)
71. Eye of Nidhogg (EDHREC 3763) - (It attacks each combat if able and attacks a player other than you if able.)
72. Martial Impetus (EDHREC 3768) - (It attacks each combat if able and attacks a player other than you if able.)
73. Illusionist's Gambit (EDHREC 3785) - They can't attack you or planeswalkers you control that combat.
74. The Masamune (EDHREC 3822) - As long as equipped creature is attacking, it has first strike and must be blocked if able.
75. Chaos Dragon (EDHREC 3903) - This creature attacks each combat if able.
76. Azure Beastbinder (EDHREC 3984) - This creature can't be blocked by creatures with power 2 or greater.
77. Rikku, Resourceful Guardian (EDHREC 4034) - Whenever you put one or more counters on a creature, until end of turn, that creature can't be blocked by creatures your opponents control.
78. Aragorn, King of Gondor (EDHREC 4085) - Whenever Aragorn attacks, up to one target creature can't block this turn.
79. Merfolk Sovereign (EDHREC 4117) - {T}: Target Merfolk creature can't be blocked this turn.
80. Assault Suit (EDHREC 4135) - Equipped creature gets +2/+2, has haste, can't attack you or planeswalkers you control, and can't be sacrificed.
81. Shifting Sliver (EDHREC 4246) - Slivers can't be blocked except by Slivers.
82. Canopy Cover (EDHREC 4251) - Enchanted creature can't be blocked except by creatures with flying or reach.
83. Aether Tunnel (EDHREC 4306) - Enchanted creature gets +1/+0 and can't be blocked.
84. Gossip's Talent (EDHREC 4322) - Whenever you attack, target attacking creature with power 3 or less can't be blocked this turn.
85. Bloodsoaked Champion (EDHREC 4474) - This creature can't block.
86. Legion Loyalist (EDHREC 4482) - Battalion — Whenever this creature and at least two other creatures attack, creatures you control gain first strike and trample until end of turn and can't be blocked by creature tokens this turn.
87. Serpent of Yawning Depths (EDHREC 4593) - Krakens, Leviathans, Octopuses, and Serpents you control can't be blocked except by Krakens, Leviathans, Octopuses, and Serpents.
88. Darksteel Juggernaut (EDHREC 4641) - This creature attacks each combat if able.
89. Filth (EDHREC 4698) - Swampwalk (This creature can't be blocked as long as defending player controls a Swamp.)
90. Nullpriest of Oblivion (EDHREC 4727) - Menace (This creature can't be blocked except by two or more creatures.)
91. Goblin War Drums (EDHREC 4842) - (They can't be blocked except by two or more creatures.)
92. Combat Calligrapher (EDHREC 4914) - Inklings can't attack you or planeswalkers you control.
93. Tromokratis (EDHREC 4916) - Tromokratis can't be blocked unless all creatures defending player controls block it.
94. Profane Command (EDHREC 4920) - • Up to X target creatures gain fear until end of turn. (They can't be blocked except by artifact creatures and/or black creatures.)
95. Behind the Scenes (EDHREC 4929) - (They can't be blocked by creatures with greater power.)
96. Inkwell Leviathan (EDHREC 4954) - Islandwalk (This creature can't be blocked as long as defending player controls an Island.)
97. Ensnaring Bridge (EDHREC 4958) - Creatures with power greater than the number of cards in your hand can't attack.
98. Infesting Radroach (EDHREC 4988) - This creature can't block.
99. Suspicious Bookcase (EDHREC 4991) - {3}, {T}: Target creature can't be blocked this turn.
100. Reverse the Polarity (EDHREC 4993) - • Creatures can't be blocked this turn.
101. Agility Bobblehead (EDHREC 4996) - {3}, {T}: Up to X target creatures you control each gain haste until end of turn and can't be blocked this turn except by creatures with haste, where X is the number of Bobbleheads you control as you activate this ability.
102. Herald of Hoofbeats (EDHREC 4997) - Horsemanship (This creature can't be blocked except by creatures with horsemanship.)
103. Angelic Arbiter (EDHREC 5043) - Each opponent who cast a spell this turn can't attack with creatures.
104. Relentless Dead (EDHREC 5044) - Menace (This creature can't be blocked except by two or more creatures.)
105. Lord of Atlantis (EDHREC 5059) - (They can't be blocked as long as defending player controls an Island.)
106. Rhonas the Indomitable (EDHREC 5132) - Rhonas can't attack or block unless you control another creature with power 4 or greater.
107. Sidar Kondo of Jamuraa (EDHREC 5225) - Creatures your opponents control without flying or reach can't block creatures with power 2 or less.
108. Abomination of Llanowar (EDHREC 5226) - Vigilance; menace (This creature can't be blocked except by two or more creatures.)
109. Champions of Minas Tirith (EDHREC 5237) - If they don't, they can't attack you this combat.
110. Wrexial, the Risen Deep (EDHREC 5244) - Islandwalk, swampwalk (This creature can't be blocked as long as defending player controls an Island or a Swamp.)
111. Pacifism (EDHREC 5259) - Enchanted creature can't attack or block.
112. Deep-Sea Kraken (EDHREC 5306) - This creature can't be blocked.
113. Kulrath Knight (EDHREC 5649) - Creatures your opponents control with counters on them can't attack or block.
114. Bellowing Tanglewurm (EDHREC 5823) - Intimidate (This creature can't be blocked except by artifact creatures and/or creatures that share a color with it.)
115. Sword Coast Sailor (EDHREC 5836) - Commander creatures you own have "Whenever this creature attacks a player, if no opponent has more life than that player, this creature can't be blocked this turn."
116. Vorrac Battlehorns (EDHREC 5903) - Equipped creature has trample and can't be blocked by more than one creature.
117. Gornog, the Red Reaper (EDHREC 5906) - Cowards can't block Warriors.
118. Varchild, Betrayer of Kjeldor (EDHREC 5974) - Survivors your opponents control can't block, and they can't attack you or planeswalkers you control.
119. Wall of Junk (EDHREC 6045) - Defender (This creature can't attack.)
120. Two-Headed Sliver (EDHREC 6078) - (They can't be blocked except by two or more creatures.)
121. Wall of Blood (EDHREC 6080) - Defender (This creature can't attack.)
122. Distortion Strike (EDHREC 6084) - Target creature gets +1/+0 until end of turn and can't be blocked this turn.
123. Sunscape Familiar (EDHREC 6090) - Defender (This creature can't attack.)
124. Turtle Lair (EDHREC 6098) - {3}, {T}: Target Ninja or Turtle can't be blocked this turn.
125. Long River Lurker (EDHREC 6163) - When this creature enters, target creature you control can't be blocked this turn.
126. Vine Trellis (EDHREC 6167) - Defender (This creature can't attack.)
127. Signal Pest (EDHREC 6203) - This creature can't be blocked except by creatures with flying or reach.
128. Venser, the Sojourner (EDHREC 6260) - −1: Creatures can't be blocked this turn.
129. Sandstorm Verge (EDHREC 6289) - {3}, {T}: Target creature can't block this turn. Activate only as a sorcery.
130. Red Death, Shipwrecker (EDHREC 6306) - Alluring Eyes — {T}: Goad target creature an opponent controls. That player draws a card. You add {R}. (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)
131. Psychic Paper (EDHREC 6331) - Equipped creature has ward {1}, it can't be blocked, and its name and creature type are the last chosen name and creature type.
132. Planar Disruption (EDHREC 6339) - Enchanted permanent can't attack or block, and its activated abilities can't be activated.
133. Goblin Piledriver (EDHREC 6528) - Protection from blue (This creature can't be blocked, targeted, dealt damage, or enchanted by anything blue.)
134. Laser Screwdriver (EDHREC 6538) - {3}, {T}: Goad target creature. (Until your next turn, it attacks each combat if able and attacks a player other than you if able.)
135. Collective Restraint (EDHREC 6752) - Domain — Creatures can't attack you unless their controller pays {X} for each creature they control that's attacking you, where X is the number of basic land types among lands you control.
136. Francisco, Fowl Marauder (EDHREC 6780) - Francisco can't block.
137. Cephalid Facetaker (EDHREC 6781) - This creature can't be blocked.
138. Aegis Angel (EDHREC 6845) - Flying (This creature can't be blocked except by creatures with flying or reach.)
139. Dimir Keyrune (EDHREC 6867) - {U}{B}: This artifact becomes a 2/2 blue and black Horror artifact creature until end of turn and can't be blocked this turn.
140. Achilles Davenport (EDHREC 6900) - Menace (This creature can't be blocked except by two or more creatures.)
141. Bedlam (EDHREC 6909) - Creatures can't block.
142. Deluxe Dragster (EDHREC 6976) - This Vehicle can't be blocked except by Vehicles.
143. Graaz, Unstoppable Juggernaut (EDHREC 6997) - Juggernauts you control can't be blocked by Walls.
144. Teacher's Pest (EDHREC 7008) - Menace (This creature can't be blocked except by two or more creatures.)
145. Psychic Impetus (EDHREC 7045) - (It attacks each combat if able and attacks a player other than you if able.)
146. Dog Umbra (EDHREC 7056) - As long as another player controls enchanted creature, it can't attack or block.
147. Nightkin Ambusher (EDHREC 7076) - This creature can't be blocked as long as defending player has a rad counter.
148. Spectra Ward (EDHREC 7084) - (It can't be blocked, targeted, or dealt damage by anything that's white, blue, black, red, or green.)
149. Lydia Frye (EDHREC 7092) - Lydia Frye can't be blocked by creatures with power 3 or greater.
150. Nuka-Nuke Launcher (EDHREC 7131) - (It can't be blocked except by artifact creatures and/or creatures that share a color with it.)
151. Onakke Oathkeeper (EDHREC 7154) - Creatures can't attack planeswalkers you control unless their controller pays {1} for each creature they control that's attacking a planeswalker you control.
152. Vronos, Masked Inquisitor (EDHREC 7196) - −7: Target artifact you control becomes a 9/9 Construct artifact creature and gains vigilance, indestructible, and "This creature can't be blocked."
153. Vow of Duty (EDHREC 7204) - Enchanted creature gets +2/+2, has vigilance, and can't attack you or planeswalkers you control.
154. Blazing Archon (EDHREC 7210) - Creatures can't attack you.
155. Shadow Alley Denizen (EDHREC 7241) - (It can't be blocked except by artifact creatures and/or creatures that share a color with it.)
156. Temur Charm (EDHREC 7248) - • Creatures with power 3 or less can't block this turn.
157. Medomai the Ageless (EDHREC 7252) - Medomai can't attack during extra turns.
158. How to Start a Riot (EDHREC 7278) - (It can't be blocked except by two or more creatures.)
159. Midnight Pathlighter (EDHREC 7448) - Creatures you control can't be blocked except by legendary creatures.
160. Magus of the Moat (EDHREC 7472) - Creatures without flying can't attack.
161. Immortal Obligation (EDHREC 7526) - For as long as that creature has a duty counter on it, it is goaded, can't attack you or a permanent you control, and can't block creatures you control.
162. Archon of Absolution (EDHREC 7577) - Protection from white (This creature can't be blocked, targeted, dealt damage, enchanted, or equipped by anything white.)
163. Wall of Runes (EDHREC 7591) - Defender (This creature can't attack.)
164. Vow of Lightning (EDHREC 7713) - Enchanted creature gets +2/+2, has first strike, and can't attack you or planeswalkers you control.
165. Coercive Impetus (EDHREC 7762) - (It attacks each combat if able and attacks a player other than you if able.)
166. Killian, Decisive Mentor (EDHREC 7826) - (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)
167. Coronation of Chaos (EDHREC 7908) - Up to three target creatures can't block this turn.
168. Nettling Nuisance (EDHREC 7961) - Whenever one or more Faeries you control deal combat damage to a player, that player creates a 4/2 red Pirate creature token with "This token can't block." The token is goaded for the rest of the game.
169. You Come to a River (EDHREC 8011) - • Find a Crossing — Target creature gets +1/+0 until end of turn and can't be blocked this turn.
170. Hraesvelgr of the First Brood (EDHREC 8031) - Shiva's Aid — When Hraesvelgr enters and whenever you cast a noncreature spell, target creature gets +1/+0 until end of turn and can't be blocked this turn.
171. Time Beetle (EDHREC 8104) - Skulk (This creature can't be blocked by creatures with greater power.)
172. Wall of Glare (EDHREC 8123) - Defender (This creature can't attack.)
173. Geth, Lord of the Vault (EDHREC 8135) - Intimidate (This creature can't be blocked except by artifact creatures and/or creatures that share a color with it.)
174. Immerwolf (EDHREC 8195) - Intimidate (This creature can't be blocked except by artifact creatures and/or creatures that share a color with it.)
175. Opportunistic Dragon (EDHREC 8241) - For as long as this creature remains on the battlefield, gain control of that permanent, it loses all abilities, and it can't attack or block.
176. Sun Quan, Lord of Wu (EDHREC 8253) - (They can't be blocked except by creatures with horsemanship.)
177. Dwarven Grunt (EDHREC 8278) - Mountainwalk (This creature can't be blocked as long as defending player controls a Mountain.)
178. Tax Collector (EDHREC 8344) - • Arrest — Detain target creature an opponent controls. (Until your next turn, that creature can't attack or block and its activated abilities can't be activated.)
179. Petrify (EDHREC 8371) - Enchanted permanent can't attack or block, and its activated abilities can't be activated.
180. Yuan-Ti Malison (EDHREC 8461) - This creature can't be blocked as long as it's attacking alone.
181. Bower Passage (EDHREC 8495) - Creatures with flying can't block creatures you control.
182. Headliner Scarlett (EDHREC 8508) - When Headliner Scarlett enters, creatures target player controls can't block this turn.
183. Harald, King of Skemfar (EDHREC 8523) - Menace (This creature can't be blocked except by two or more creatures.)
184. Relic Golem (EDHREC 8674) - This creature can't attack or block unless an opponent has eight or more cards in their graveyard.
185. Shifting Ceratops (EDHREC 8676) - Protection from blue (This creature can't be blocked, targeted, dealt damage, enchanted, or equipped by anything blue.)
186. Eladamri, Lord of Leaves (EDHREC 8736) - (They can't be blocked as long as defending player controls a Forest.)
187. Angelic Wall (EDHREC 8788) - Defender (This creature can't attack.)
188. Popular Entertainer (EDHREC 8803) - Commander creatures you own have "Whenever one or more creatures you control deal combat damage to a player, goad target creature that player controls." (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)
189. Frodo Baggins (EDHREC 8814) - As long as Frodo Baggins is your Ring-bearer, it must be blocked if able.
190. Rancid Rats (EDHREC 8848) - Skulk (This creature can't be blocked by creatures with greater power.)
191. Serra's Guardian (EDHREC 9019) - Flying (This creature can't be blocked except by creatures with flying or reach.)
192. Goblin Dark-Dwellers (EDHREC 9032) - Menace (This creature can't be blocked except by two or more creatures.)
193. Dauthi Horror (EDHREC 9082) - This creature can't be blocked by white creatures.
194. Vow of Malice (EDHREC 9090) - Enchanted creature gets +2/+2, has intimidate, and can't attack you or planeswalkers you control.
195. Lupine Prototype (EDHREC 9096) - This creature can't attack or block unless a player has no cards in hand.
196. Taunting Kobold (EDHREC 9170) - (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)
197. Vow of Torment (EDHREC 9197) - Enchanted creature gets +2/+2, has menace, and can't attack you or planeswalkers you control.
198. Glissa's Retriever (EDHREC 9404) - This creature can't be blocked by creatures with power 2 or less.
199. Sandman, Shifting Scoundrel (EDHREC 9434) - Sandman can't be blocked by creatures with power 2 or less.
200. The Eleventh Doctor (EDHREC 9453) - {2}: Target creature with power 3 or less can't be blocked this turn.

### 14. Control Change And Exchange Effects

Source: corpus-mined follow-on seam
Available after current queue exclusion: 255

1. Hellkite Tyrant (EDHREC 768) - Whenever this creature deals combat damage to a player, gain control of all artifacts that player controls.
2. Homeward Path (EDHREC 1203) - {T}: Each player gains control of all creatures they own.
3. Treasure Nabber (EDHREC 1458) - Whenever an opponent taps an artifact for mana, gain control of that artifact until the end of your next turn.
4. Emrakul, the Promised End (EDHREC 1859) - When you cast this spell, you gain control of target opponent during that player's next turn.
5. Insurrection (EDHREC 1873) - Untap all creatures and gain control of them until end of turn.
6. Commandeer (EDHREC 2045) - Gain control of target noncreature spell.
7. Invert Polarity (EDHREC 2184) - If you win the flip, gain control of that spell and you may choose new targets for it.
8. Thieving Skydiver (EDHREC 2293) - When this creature enters, if it was kicked, gain control of target artifact with mana value X or less.
9. Zealous Conscripts (EDHREC 2349) - When this creature enters, gain control of target permanent until end of turn.
10. Captivating Vampire (EDHREC 2477) - Tap five untapped Vampires you control: Gain control of target creature.
11. Expropriate (EDHREC 2479) - Council's dilemma — Starting with you, each player votes for time or money. For each time vote, take an extra turn after this one. For each money vote, choose a permanent owned by the voter and gain control of it. Exile Expropriate.
12. Flayer of Loyalties (EDHREC 3174) - When you cast this spell, gain control of target creature until end of turn.
13. Mob Rule (EDHREC 3367) - • Gain control of all creatures with power 4 or greater until end of turn. Untap those creatures. They gain haste until end of turn.
14. Captivating Crew (EDHREC 3451) - {3}{R}: Gain control of target creature an opponent controls until end of turn. Untap that creature. It gains haste until end of turn. Activate only as a sorcery.
15. Coercive Recruiter (EDHREC 3576) - Whenever this creature or another Pirate you control enters, gain control of target creature until end of turn.
16. Hideous Taskmaster (EDHREC 3784) - When you cast this spell, for each opponent, gain control of up to one target creature that player controls until end of turn.
17. Roil Elemental (EDHREC 3904) - Landfall — Whenever a land you control enters, you may gain control of target creature for as long as you control this creature.
18. Reins of Power (EDHREC 3912) - You and that opponent each gain control of all creatures the other controls until end of turn.
19. Sower of Temptation (EDHREC 3996) - When this creature enters, gain control of target creature for as long as this creature remains on the battlefield.
20. Assault Suit (EDHREC 4135) - At the beginning of each opponent's upkeep, you may have that player gain control of equipped creature until end of turn.
21. Blue Sun's Twilight (EDHREC 4166) - Gain control of target creature with mana value X or less.
22. Keiga, the Tide Star (EDHREC 4329) - When Keiga dies, gain control of target creature.
23. New Blood (EDHREC 4369) - Gain control of target creature.
24. Akroan Horse (EDHREC 4476) - When this creature enters, an opponent gains control of it.
25. Mind Flayer (EDHREC 4526) - Dominate Monster — When this creature enters, gain control of target creature for as long as you control this creature.
26. Blatant Thievery (EDHREC 4682) - For each opponent, gain control of target permanent that player controls.
27. Act of Treason (EDHREC 4737) - Gain control of target creature until end of turn.
28. Harmless Offering (EDHREC 5376) - Target opponent gains control of target permanent you control.
29. Chef's Kiss (EDHREC 5426) - Gain control of target spell that targets only a single permanent or player.
30. Perplexing Chimera (EDHREC 5469) - Whenever an opponent casts a spell, you may exchange control of this creature and that spell.
31. Molten Primordial (EDHREC 5609) - When this creature enters, for each opponent, gain control of up to one target creature that player controls until end of turn.
32. Grishnákh, Brash Instigator (EDHREC 5717) - When you do, until end of turn, gain control of target nonlegendary creature an opponent controls with power less than or equal to the amassed Army's power.
33. Wrong Turn (EDHREC 5732) - Target opponent gains control of target creature.
34. Varchild, Betrayer of Kjeldor (EDHREC 5974) - When Varchild leaves the battlefield, gain control of all Survivors.
35. Admiral Beckett Brass (EDHREC 5998) - At the beginning of your end step, gain control of target nonland permanent controlled by a player who was dealt combat damage by three or more Pirates this turn.
36. Yuffie, Materia Hunter (EDHREC 6187) - When Yuffie enters, gain control of target noncreature artifact for as long as you control Yuffie.
37. Mass Manipulation (EDHREC 6189) - Gain control of X target creatures and/or planeswalkers.
38. Hot Pursuit (EDHREC 6275) - At the beginning of combat on your turn, if two or more players have lost the game, gain control of all goaded and/or suspected creatures until end of turn.
39. Willbreaker (EDHREC 6286) - Whenever a creature an opponent controls becomes the target of a spell or ability you control, gain control of that creature for as long as you control this creature.
40. Shifting Grift (EDHREC 6403) - + {2} — Exchange control of two target creatures.
41. Dragonlord Silumgar (EDHREC 6639) - When Dragonlord Silumgar enters, gain control of target creature or planeswalker for as long as you control Dragonlord Silumgar.
42. Claim the Firstborn (EDHREC 6834) - Gain control of target creature with mana value 3 or less until end of turn.
43. Kari Zev's Expertise (EDHREC 6835) - Gain control of target creature or Vehicle until end of turn.
44. Mass Mutiny (EDHREC 6960) - For each opponent, gain control of up to one target creature that player controls until end of turn.
45. Bazaar Trader (EDHREC 7020) - {T}: Target player gains control of target artifact, creature, or land you control.
46. Sudden Substitution (EDHREC 7040) - Exchange control of target noncreature spell and target creature.
47. Confiscation Coup (EDHREC 7608) - If you do, gain control of it.
48. Role Reversal (EDHREC 7703) - Exchange control of two target permanents that share a permanent type.
49. Memnarch (EDHREC 7854) - {3}{U}: Gain control of target artifact. (This effect lasts indefinitely.)
50. Confusion in the Ranks (EDHREC 7990) - Exchange control of those permanents.
51. Secret of Bloodbending (EDHREC 8030) - You control target opponent during their next combat phase.
52. Midnight Crusader Shuttle (EDHREC 8105) - Midnight Entity — Whenever this Vehicle attacks, defending player faces a villainous choice — That player sacrifices a creature of their choice, or you gain control of a creature of your choice that player controls until end of turn. If you gain control of a creature this way, tap it, and it's attacking that player.
53. Opportunistic Dragon (EDHREC 8241) - For as long as this creature remains on the battlefield, gain control of that permanent, it loses all abilities, and it can't attack or block.
54. Karrthus, Tyrant of Jund (EDHREC 8252) - When Karrthus enters, gain control of all Dragons, then untap all Dragons.
55. Domineering Will (EDHREC 8284) - Target player gains control of up to three target nonattacking creatures until end of turn.
56. Worst Fears (EDHREC 8408) - You control target player during that player's next turn.
57. Souvenir Snatcher (EDHREC 8554) - Whenever this creature mutates, gain control of target noncreature artifact.
58. Sakashima's Will (EDHREC 8677) - • Target opponent chooses a creature they control. You gain control of it.
59. Traitorous Greed (EDHREC 8752) - Gain control of target creature until end of turn.
60. Subjugate the Hobbits (EDHREC 8761) - Gain control of each noncommander creature with mana value 3 or less.
61. Pyreswipe Hawk (EDHREC 8921) - Whenever you expend 6, gain control of up to one target artifact for as long as you control this creature.
62. Crown of Doom (EDHREC 9033) - {2}: Target player other than this artifact's owner gains control of it. Activate only during your turn.
63. Act of Aggression (EDHREC 9042) - Gain control of target creature an opponent controls until end of turn.
64. Hijack (EDHREC 9364) - Gain control of target artifact or creature until end of turn.
65. Chromeshell Crab (EDHREC 9477) - When this creature is turned face up, you may exchange control of target creature you control and target creature an opponent controls.
66. Empress Galina (EDHREC 9541) - {U}{U}, {T}: Gain control of target legendary permanent. (This effect lasts indefinitely.)
67. Scrambleverse (EDHREC 9584) - Then each player gains control of each permanent for which they were chosen.
68. Puca's Mischief (EDHREC 9745) - At the beginning of your upkeep, you may exchange control of target nonland permanent you control and target nonland permanent an opponent controls with equal or lesser mana value.
69. Loki's Scepter (EDHREC 9865) - When Loki's Scepter enters, gain control of target creature until end of turn.
70. The Dominion Bracelet (EDHREC 10239) - Equipped creature gets +1/+1 and has "{15}, Exile The Dominion Bracelet: You control target opponent during their next turn.
71. Possession Engine (EDHREC 10246) - When this Vehicle enters, gain control of target creature an opponent controls for as long as you control this Vehicle.
72. Aura Thief (EDHREC 10850) - When this creature dies, you gain control of all enchantments.
73. The Nipton Lottery (EDHREC 10936) - You gain control of that creature until end of turn.
74. Besmirch (EDHREC 11017) - Until end of turn, gain control of target creature and it gains haste.
75. Invoke the Winds (EDHREC 11056) - Gain control of target artifact or creature.
76. Blim, Comedic Genius (EDHREC 11249) - Whenever Blim deals combat damage to a player, that player gains control of target permanent you control.
77. Entrancing Melody (EDHREC 11486) - Gain control of target creature with mana value X.
78. Vedalken Shackles (EDHREC 11612) - {2}, {T}: Gain control of target creature with power less than or equal to the number of Islands you control for as long as this artifact remains tapped.
79. Fumble (EDHREC 11626) - Gain control of all Auras and Equipment that were attached to it, then attach them to another creature.
80. Beguiler of Wills (EDHREC 11828) - {T}: Gain control of target creature with power less than or equal to the number of creatures you control.
81. Traitorous Blood (EDHREC 11829) - Gain control of target creature until end of turn.
82. Goblin Cadets (EDHREC 11830) - Whenever this creature blocks or becomes blocked, target opponent gains control of it.
83. Risky Move (EDHREC 11846) - At the beginning of each player's upkeep, that player gains control of this enchantment.
84. Gilt-Leaf Archdruid (EDHREC 11855) - Tap seven untapped Druids you control: Gain control of all lands target player controls.
85. Dominus of Fealty (EDHREC 11865) - At the beginning of your upkeep, you may gain control of target permanent until end of turn.
86. Peer Pressure (EDHREC 12068) - If you control more creatures of that type than each other player, you gain control of all creatures of that type.
87. Dominating Vampire (EDHREC 12069) - When this creature enters, gain control of target creature with mana value less than or equal to the number of Vampires you control until end of turn.
88. Vedalken Plotter (EDHREC 12313) - When this creature enters, exchange control of target land you control and target land an opponent controls.
89. Take for a Ride (EDHREC 12555) - Gain control of target creature until end of turn.
90. Cultural Exchange (EDHREC 12590) - Those players exchange control of those creatures.
91. Eyes Everywhere (EDHREC 12640) - {5}{U}: Exchange control of this enchantment and target nonland permanent. Activate only as a sorcery.
92. Spreading Insurrection (EDHREC 12662) - Gain control of target creature you don't control until end of turn.
93. Garland, Royal Kidnapper (EDHREC 12742) - Whenever an opponent becomes the monarch, gain control of target creature that player controls for as long as they're the monarch.
94. Wrangle (EDHREC 12754) - Gain control of target creature with power 4 or less until end of turn.
95. Unexpected Request (EDHREC 12767) - Gain control of target creature until end of turn.
96. Captivating Glance (EDHREC 12842) - If you win, gain control of enchanted creature.
97. Word of Seizing (EDHREC 12909) - Untap target permanent and gain control of it until end of turn.
98. Construct a Cosmic Cube (EDHREC 13142) - When you do, you control target opponent during their next turn.
99. Avarice Amulet (EDHREC 13203) - Whenever equipped creature dies, target opponent gains control of this Equipment.
100. Jace, Ingenious Mind-Mage (EDHREC 13377) - −9: Gain control of up to three target creatures.
101. Harness by Force (EDHREC 13582) - Gain control of any number of target creatures until end of turn.
102. Daring Thief (EDHREC 13639) - Inspired — Whenever this creature becomes untapped, you may exchange control of target nonland permanent you control and target permanent an opponent controls that shares a card type with it.
103. Karona, False God (EDHREC 13673) - At the beginning of each player's upkeep, that player untaps Karona and gains control of it.
104. Reptilian Recruiter (EDHREC 13688) - If that creature's power is 2 or less or if you control another Lizard, gain control of that creature until end of turn, untap it, and it gains haste until end of turn.
105. Donate (EDHREC 13836) - Target player gains control of target permanent you control.
106. Price of Loyalty (EDHREC 13867) - Gain control of target creature until end of turn.
107. Aethersnatch (EDHREC 13927) - Gain control of target spell.
108. Merieke Ri Berit (EDHREC 14016) - {T}: Gain control of target creature for as long as you control Merieke Ri Berit. When Merieke Ri Berit leaves the battlefield or becomes untapped, destroy that creature. It can't be regenerated.
109. Tempted by the Oriq (EDHREC 14135) - For each opponent, gain control of up to one target creature or planeswalker that player controls with mana value 3 or less.
110. Switcheroo (EDHREC 14176) - Exchange control of two target creatures.
111. Djinn of Infinite Deceits (EDHREC 14348) - {T}: Exchange control of two target nonlegendary creatures. You can't activate this ability during combat.
112. Malevolent Whispers (EDHREC 14382) - Gain control of target creature until end of turn.
113. Act of Authority (EDHREC 14450) - If you do, its controller gains control of this enchantment.
114. Power of Persuasion (EDHREC 14558) - 20 | Gain control of it until the end of your next turn.
115. Avarice Totem (EDHREC 14569) - {5}: Exchange control of this artifact and target nonland permanent.
116. Contested War Zone (EDHREC 14573) - Whenever a creature deals combat damage to you, that creature's controller gains control of this land.
117. Goatnap (EDHREC 14658) - Gain control of target creature until end of turn.
118. Eriette, the Beguiler (EDHREC 14708) - Whenever an Aura you control becomes attached to a nonland permanent an opponent controls with mana value less than or equal to that Aura's mana value, gain control of that permanent for as long as that Aura is attached to it.
119. Frenzied Fugue (EDHREC 15042) - When this Aura enters and at the beginning of your upkeep, gain control of enchanted permanent until end of turn.
120. Systems Override (EDHREC 15157) - Gain control of target artifact or creature until end of turn.
121. Chamber of Manipulation (EDHREC 15231) - Enchanted land has "{T}, Discard a card: Gain control of target creature until end of turn."
122. Pack's Betrayal (EDHREC 15265) - Gain control of target creature until end of turn.
123. Tahngarth, First Mate (EDHREC 15553) - Whenever an opponent attacks with one or more creatures, if Tahngarth is tapped, you may have that opponent gain control of Tahngarth until end of combat.
124. Conquering Manticore (EDHREC 15556) - When this creature enters, gain control of target creature an opponent controls until end of turn.
125. Callous Oppressor (EDHREC 15585) - {T}: Gain control of target creature that isn't of the chosen type for as long as this creature remains tapped.
126. Threaten (EDHREC 15736) - Untap target creature and gain control of it until end of turn.
127. Rangers of Ithilien (EDHREC 15848) - When this creature enters, gain control of up to one target creature with lesser power for as long as you control this creature.
128. Jeering Instigator (EDHREC 15930) - When this creature is turned face up, if it's your turn, gain control of another target creature until end of turn.
129. Master Thief (EDHREC 15958) - When this creature enters, gain control of target artifact for as long as you control this creature.
130. Sarkhan Vol (EDHREC 16068) - −2: Gain control of target creature until end of turn.
131. Trade the Helm (EDHREC 16099) - Exchange control of target artifact or creature you control and target artifact or creature an opponent controls.
132. Stolen Uniform (EDHREC 16234) - Gain control of that Equipment until end of turn.
133. Awaken the Sleeper (EDHREC 16242) - Gain control of target creature until end of turn.
134. Tentative Connection (EDHREC 16341) - Gain control of target creature until end of turn.
135. Debt of Loyalty (EDHREC 16513) - You gain control of that creature if it regenerates this way.
136. Momo's Heist (EDHREC 16580) - Gain control of target artifact.
137. Order of Succession (EDHREC 16622) - Each player gains control of the creature they chose.
138. Portent of Betrayal (EDHREC 16650) - Gain control of target creature until end of turn.
139. Alicia Masters, Skilled Sculptor (EDHREC 16776) - Sense the Good — At the beginning of your end step, each player gains control of all creatures they own.
140. Dominate (EDHREC 16874) - Gain control of target creature with mana value X or less.
141. Visions of Duplicity (EDHREC 17001) - Exchange control of two target creatures you don't control.
142. Ray of Command (EDHREC 17317) - Untap target creature an opponent controls and gain control of it until end of turn.
143. Charisma (EDHREC 17365) - Whenever enchanted creature deals damage to a creature, gain control of the other creature for as long as this Aura remains on the battlefield.
144. Caught Red-Handed (EDHREC 17566) - Gain control of target creature until end of turn.
145. Political Trickery (EDHREC 17600) - Exchange control of target land you control and target land an opponent controls.
146. Yasova Dragonclaw (EDHREC 17609) - If you do, gain control of target creature an opponent controls with power less than Yasova Dragonclaw's power until end of turn, untap that creature, and it gains haste until end of turn.
147. Broadcast Takeover (EDHREC 17614) - Gain control of all artifacts your opponents control until end of turn.
148. Kitsune, Dragon's Daughter (EDHREC 17638) - Whenever Kitsune enters or deals combat damage to a player, you may exchange control of two other target creatures controlled by different players.
149. Inniaz, the Gale Force (EDHREC 17734) - Whenever three or more creatures you control with flying attack, each player gains control of a nonland permanent of your choice controlled by the player to their right.
150. Conjured Currency (EDHREC 18117) - At the beginning of your upkeep, you may exchange control of this enchantment and target permanent you neither own nor control.
151. Treacherous Pit-Dweller (EDHREC 18271) - When this creature enters from a graveyard, target opponent gains control of it.
152. Shifting Borders (EDHREC 18276) - Exchange control of two target lands.
153. Stilt-Man, Towering Terror (EDHREC 18282) - Whenever one or more Villains you control deal combat damage to a player, gain control of target noncreature, nonland permanent that player controls until the end of your next turn.
154. Sibling Rivalry (EDHREC 18284) - Gain control of target artifact or creature until end of turn.
155. Rubinia Soulsinger (EDHREC 18865) - {T}: Gain control of target creature for as long as you control Rubinia Soulsinger and Rubinia Soulsinger remains tapped.
156. Giant's Grasp (EDHREC 19015) - When this Aura enters, gain control of target nonland permanent for as long as this Aura remains on the battlefield.
157. Akroan Conscriptor (EDHREC 19596) - Heroic — Whenever you cast a spell that targets this creature, gain control of another target creature until end of turn. Untap that creature. It gains haste until end of turn.
158. Lullmage's Domination (EDHREC 19604) - Gain control of target creature with mana value X.
159. Traitorous Instinct (EDHREC 19651) - Gain control of target creature until end of turn.
160. Crown of Empires (EDHREC 19818) - {3}, {T}: Tap target creature. Gain control of that creature instead if you control artifacts named Scepter of Empires and Throne of Empires.
161. Bringer of the Red Dawn (EDHREC 19991) - At the beginning of your upkeep, you may untap target creature and gain control of it until end of turn.
162. Blind with Anger (EDHREC 20046) - Untap target nonlegendary creature and gain control of it until end of turn.
163. Spawnbroker (EDHREC 20185) - When this creature enters, you may exchange control of target creature you control and target creature with power less than or equal to that creature's power an opponent controls.
164. Eldrazi Obligator (EDHREC 20293) - If you do, gain control of target creature until end of turn, untap that creature, and it gains haste until end of turn.
165. Grip of Phyresis (EDHREC 20476) - Gain control of target Equipment, then create a 0/0 black Phyrexian Germ creature token and attach that Equipment to it.
166. The Super Hero Civil War (EDHREC 20542) - I — Gain control of up to two target creatures with total mana value 6 or less for as long as this Saga remains on the battlefield.
167. Welcome to the Fold (EDHREC 20586) - Gain control of target creature if its toughness is 2 or less.
168. Stardew Valley (EDHREC 20725) - {3}, {T}: Choose target permanent you control. Draw a card, then another player of your choice may gain control of that permanent. Activate only as a sorcery.
169. Aura Graft (EDHREC 21341) - Gain control of target Aura that's attached to a permanent.
170. Turf War (EDHREC 21353) - Whenever a creature deals combat damage to a player, if that player controls one or more lands with contested counters on them, that creature's controller gains control of one of those lands of their choice and untaps it.
171. Shifting Loyalties (EDHREC 21494) - Exchange control of two target permanents that share a card type.
172. Fickle Efreet (EDHREC 21518) - If you lose the flip, an opponent gains control of this creature.
173. Loki, God of Lies (EDHREC 21570) - Whenever you cast a spell that targets only a single creature, gain control of that creature until end of turn.
174. Limits of Solidarity (EDHREC 21583) - Gain control of target creature until end of turn.
175. Bill Ferny, Bree Swindler (EDHREC 21619) - • Target opponent gains control of target Horse you control. If they do, remove Bill Ferny from combat and create three Treasure tokens.
176. Loxodon Peacekeeper (EDHREC 21707) - At the beginning of your upkeep, the player with the lowest life total gains control of this creature.
177. In Thrall to the Pit (EDHREC 21938) - Gain control of target creature until end of turn.
178. Might Makes Right (EDHREC 22034) - At the beginning of combat on your turn, if you control each creature on the battlefield with the greatest power, gain control of target creature an opponent controls until end of turn.
179. Drooling Ogre (EDHREC 22163) - Whenever a player casts an artifact spell, that player gains control of this creature.
180. Lose Calm (EDHREC 22165) - Gain control of target creature until end of turn.
181. Twist Allegiance (EDHREC 22293) - You and target opponent each gain control of all creatures the other controls until end of turn.
182. Skyfire Kirin (EDHREC 22296) - Whenever you cast a Spirit or Arcane spell, you may gain control of target creature with that spell's mana value until end of turn.
183. Overtaker (EDHREC 22447) - {3}{U}, {T}, Discard a card: Untap target creature and gain control of it until end of turn. That creature gains haste until end of turn.
184. Kukemssa Pirates (EDHREC 22459) - Whenever this creature attacks and isn't blocked, you may gain control of target artifact defending player controls.
185. Mascot Interception (EDHREC 22606) - Gain control of target creature until end of turn.
186. Enthralling Victor (EDHREC 22624) - When this creature enters, gain control of target creature an opponent controls with power 2 or less until end of turn.
187. Fractured Loyalty (EDHREC 22694) - Whenever enchanted creature becomes the target of a spell or ability, that spell or ability's controller gains control of that creature.
188. Evil's Thrall (EDHREC 22871) - Gain control of target creature until end of turn.
189. Govern the Guildless (EDHREC 22916) - Gain control of target monocolored creature.
190. Press into Service (EDHREC 22919) - Gain control of target creature until end of turn.
191. Unwilling Recruit (EDHREC 22951) - Gain control of target creature until end of turn.
192. Kefnet's Last Word (EDHREC 23094) - Gain control of target artifact, creature, or enchantment.
193. Witch Engine (EDHREC 23123) - {T}: Add {B}{B}{B}{B}. Target opponent gains control of this creature. (Activate only as an instant.)
194. Shuriken (EDHREC 23607) - That creature's controller gains control of Shuriken unless it was unattached from a Ninja."
195. Bond of Passion (EDHREC 23626) - Gain control of target creature until end of turn.
196. Rootwater Matriarch (EDHREC 23909) - {T}: Gain control of target creature for as long as that creature is enchanted.
197. Tolarian Entrancer (EDHREC 24193) - Whenever this creature becomes blocked by a creature, gain control of that creature at end of combat.
198. Keldon Overseer (EDHREC 24535) - When this creature enters, if it was kicked, gain control of target creature until end of turn.
199. Evangelize (EDHREC 24551) - Gain control of target creature of an opponent's choice they control.
200. Shrewd Negotiation (EDHREC 24698) - Exchange control of target artifact you control and target artifact or creature you don't control.

### 15. Copy Spells And Abilities

Source: corpus-mined follow-on seam
Available after current queue exclusion: 276

1. Flusterstorm (EDHREC 308) - Storm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.)
2. Strionic Resonator (EDHREC 584) - {2}, {T}: Copy target triggered ability you control. You may choose new targets for the copy. (A triggered ability uses the words "when," "whenever," or "at.")
3. Return the Favor (EDHREC 609) - + {1} — Copy target instant spell, sorcery spell, activated ability, or triggered ability. You may choose new targets for the copy.
4. Dualcaster Mage (EDHREC 661) - You may choose new targets for the copy.
5. Reflections of Littjara (EDHREC 671) - Whenever you cast a spell of the chosen type, copy that spell.
6. Narset's Reversal (EDHREC 735) - You may choose new targets for the copy.
7. Mizzix's Mastery (EDHREC 804) - For each card exiled this way, copy it, and you may cast the copy without paying its mana cost.
8. Amphibian Downpour (EDHREC 1223) - Storm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies. Copies become tokens.)
9. Reverberate (EDHREC 1393) - You may choose new targets for the copy.
10. Thousand-Year Storm (EDHREC 1402) - Whenever you cast an instant or sorcery spell, copy it for each other instant and sorcery spell you've cast before it this turn.
11. Rings of Brighthearth (EDHREC 1409) - If you do, copy that ability.
12. Echoes of Eternity (EDHREC 1504) - Whenever you cast a colorless spell, copy it.
13. Illusionist's Bracers (EDHREC 1601) - Whenever an ability of equipped creature is activated, if it isn't a mana ability, copy that ability.
14. Jin-Gitaxias, Progress Tyrant (EDHREC 1717) - Whenever you cast an artifact, instant, or sorcery spell, copy that spell.
15. Lithoform Engine (EDHREC 1719) - {2}, {T}: Copy target activated or triggered ability you control. You may choose new targets for the copy.
16. Twinning Staff (EDHREC 1721) - If you would copy a spell one or more times, instead copy it that many times plus an additional time.
17. Weaver of Harmony (EDHREC 2056) - {G}, {T}: Copy target activated or triggered ability you control from an enchantment source. You may choose new targets for the copy. (Mana abilities can't be targeted.)
18. Twinferno (EDHREC 2581) - • When you cast your next instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy.
19. Reiterate (EDHREC 2591) - You may choose new targets for the copy.
20. Unbound Flourishing (EDHREC 2666) - Whenever you cast an instant or sorcery spell or activate an ability, if that spell's mana cost or that ability's activation cost contains {X}, copy that spell or ability.
21. Double Vision (EDHREC 2706) - Whenever you cast your first instant or sorcery spell each turn, copy that spell.
22. Wyll's Reversal (EDHREC 2810) - Then copy it.
23. Pyromancer's Goggles (EDHREC 2812) - {T}: Add {R}. When that mana is spent to cast a red instant or sorcery spell, copy that spell and you may choose new targets for the copy.
24. Radstorm (EDHREC 3011) - Storm (When you cast this spell, copy it for each spell cast before it this turn.)
25. Chain of Smog (EDHREC 3189) - That player may copy this spell and may choose a new target for that copy.
26. See Double (EDHREC 3353) - • Copy target spell. You may choose new targets for the copy. (A copy of a permanent spell becomes a token.)
27. Zada, Hedron Grinder (EDHREC 3383) - Whenever you cast an instant or sorcery spell that targets only Zada, copy that spell for each other creature you control that the spell could target.
28. Mendicant Core, Guidelight (EDHREC 3419) - Max speed — Whenever you cast an artifact spell, you may pay {1}. If you do, copy it. (The copy becomes a token.)
29. Krark, the Thumbless (EDHREC 3512) - If you win the flip, copy that spell, and you may choose new targets for the copy.
30. Incarnation Technique (EDHREC 3547) - Demonstrate (When you cast this spell, you may copy it. If you do, choose an opponent to also copy it.)
31. Peter Parker's Camera (EDHREC 3587) - {2}, {T}, Remove a film counter from this artifact: Copy target activated or triggered ability you control. You may choose new targets for the copy.
32. Mind's Desire (EDHREC 3588) - Storm (When you cast this spell, copy it for each spell cast before it this turn.)
33. Storm of Saruman (EDHREC 3607) - Whenever you cast your second spell each turn, copy it, except the copy isn't legendary.
34. Fire Lord Azula (EDHREC 3801) - Whenever you cast a spell while Fire Lord Azula is attacking, copy that spell.
35. Aboleth Spawn (EDHREC 3883) - Probing Telepathy — Whenever a creature entering under an opponent's control causes a triggered ability of that creature to trigger, you may copy that ability. You may choose new targets for the copy.
36. Wild Ricochet (EDHREC 4018) - Then copy that spell.
37. Archmage of Echoes (EDHREC 4197) - Whenever you cast a Faerie or Wizard permanent spell, copy it.
38. Replication Technique (EDHREC 4314) - Demonstrate (When you cast this spell, you may copy it. If you do, choose an opponent to also copy it. Players may choose new targets for their copies.)
39. Haze of Rage (EDHREC 4456) - Storm (When you cast this spell, copy it for each spell cast before it this turn.)
40. Sunken Palace (EDHREC 4463) - {1}{U}, {T}, Exile seven cards from your graveyard: Add {U}. When you spend this mana to cast a spell or activate an ability, copy that spell or ability. You may choose new targets for the copy. (Mana abilities can't be copied.)
41. Swarm Intelligence (EDHREC 4647) - Whenever you cast an instant or sorcery spell, you may copy that spell.
42. Wondrous Crucible (EDHREC 4722) - Copy it.
43. Storm of Souls (EDHREC 4841) - Exile Storm of Souls.
44. Prismari, the Inspiration (EDHREC 4843) - Instant and sorcery spells you cast have storm.
45. Stella Lee, Wild Card (EDHREC 4844) - {T}: Copy target instant or sorcery spell you control. You may choose new targets for the copy. Activate only if you've cast three or more spells this turn.
46. Creative Technique (EDHREC 4860) - Demonstrate (When you cast this spell, you may copy it. If you do, choose an opponent to also copy it.)
47. Stormscale Scion (EDHREC 4904) - Storm (When you cast this spell, copy it for each spell cast before it this turn. Copies become tokens.)
48. Taigam, Master Opportunist (EDHREC 4925) - Flurry — Whenever you cast your second spell each turn, copy it, then exile the spell you cast with four time counters on it. If it doesn't have suspend, it gains suspend. (At the beginning of its owner's upkeep, they remove a time counter. When the last is removed, they may play it without paying its mana cost. If it's a creature, it has haste.)
49. Brass Knuckles (EDHREC 4959) - When you cast this spell, copy it.
50. Tempt with Mayhem (EDHREC 4965) - Tempting offer — Choose target instant or sorcery spell. Each opponent may copy that spell and may choose new targets for the copy they control. You copy that spell once plus an additional time for each opponent who copied the spell this way. You may choose new targets for the copies you control.
51. Leyline of Resonance (EDHREC 5402) - Whenever you cast an instant or sorcery spell that targets only a single creature you control, copy that spell.
52. Chef's Kiss (EDHREC 5426) - Copy it, then reselect the targets at random for the spell and the copy.
53. Battlemage's Bracers (EDHREC 5482) - If you do, copy that ability.
54. Tempest Technique (EDHREC 5571) - Storm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies. Copies become tokens.)
55. Abstruse Archaic (EDHREC 5583) - {1}, {T}: Copy target activated or triggered ability you control from a colorless source. You may choose new targets for the copy. (Mana abilities can't be targeted.)
56. Storm King's Thunder (EDHREC 5631) - When you next cast an instant or sorcery spell this turn, copy that spell X times.
57. Ivy, Gleeful Spellthief (EDHREC 5955) - Whenever a player casts a spell that targets only a single creature other than Ivy, you may copy that spell.
58. Double Down (EDHREC 5986) - Whenever you cast an outlaw spell, copy that spell.
59. Tomb of Horrors Adventurer (EDHREC 6059) - Whenever you cast your second spell each turn, copy it.
60. Hatchery Sliver (EDHREC 6258) - Replicate {1}{G} (When you cast this spell, copy it for each time you paid its replicate cost.)
61. Naru Meha, Master Wizard (EDHREC 6261) - You may choose new targets for the copy.
62. Twincast (EDHREC 6273) - You may choose new targets for the copy.
63. The Peregrine Dynamo (EDHREC 6376) - {1}, {T}: Copy target activated or triggered ability you control from another legendary source that's not a commander. You may choose new targets for the copy. (Mana abilities can't be targeted.)
64. The Sixth Doctor (EDHREC 6485) - Time Lord's Prerogative — Whenever you cast a historic spell, copy it, except the copy isn't legendary. This ability triggers only once each turn. (Artifacts, legendaries, and Sagas are historic. A copy of a permanent spell becomes a token.)
65. Split Decision (EDHREC 7178) - Will of the council — Choose target instant or sorcery spell. Starting with you, each player votes for denial or duplication. If denial gets more votes, counter the spell. If duplication gets more votes or the vote is tied, copy the spell. You may choose new targets for the copy.
66. Storm, Force of Nature (EDHREC 7200) - Ceaseless Tempest — Whenever Storm deals combat damage to a player, the next instant or sorcery spell you cast this turn has storm. (When you cast it, copy it for each spell cast before it this turn. You may choose new targets for the copies.)
67. Consign to Memory (EDHREC 7280) - Replicate {1} (When you cast this spell, copy it for each time you paid its replicate cost. You may choose new targets for the copies.)
68. Changing Loyalty (EDHREC 7311) - Replicate {2} (When you cast this spell, copy it for each time you paid its replicate cost. You may choose new targets for the copies. Copies become tokens.)
69. Melek, Izzet Paragon (EDHREC 7329) - Whenever you cast an instant or sorcery spell from your library, copy it.
70. Fury Storm (EDHREC 7444) - When you cast this spell, copy it for each time you've cast your commander from the command zone this game.
71. Teach by Example (EDHREC 7624) - When you next cast an instant or sorcery spell this turn, copy that spell.
72. Blue Mage's Cane (EDHREC 7659) - If you do, copy it.
73. Kirol, Attentive First-Year (EDHREC 7705) - You may choose new targets for the copy.
74. Repeated Reverberation (EDHREC 7758) - When you next cast an instant spell, cast a sorcery spell, or activate a loyalty ability this turn, copy that spell or ability twice.
75. Jacob Frye (EDHREC 7845) - If you do, copy it.
76. Silverquill, the Disputant (EDHREC 8055) - Each instant and sorcery spell you cast has casualty 1. (As you cast that spell, you may sacrifice a creature with power 1 or greater. When you do, copy the spell and you may choose new targets for the copy.)
77. Spider-Verse (EDHREC 8193) - Whenever you cast a spell from anywhere other than your hand, you may copy it.
78. Jaya's Phoenix (EDHREC 8345) - You may choose new targets for the copy.
79. Insidious Will (EDHREC 8558) - • Copy target instant or sorcery spell. You may choose new targets for the copy.
80. Volo, Guide to Monsters (EDHREC 8600) - Whenever you cast a creature spell that doesn't share a creature type with a creature you control or a creature card in your graveyard, copy that spell.
81. Mists of Lórien (EDHREC 8658) - Replicate {U} (When you cast this spell, copy it for each time you paid its replicate cost. You may choose new targets for the copies.)
82. Errant, Street Artist (EDHREC 8665) - {1}{U}, {T}: Copy target spell you control that wasn't cast. You may choose new targets for the copy.
83. Crackling Spellslinger (EDHREC 8787) - When this creature enters, if you cast it, the next instant or sorcery spell you cast this turn has storm.
84. Owlin Spiralmancer (EDHREC 8818) - Whenever you cast your first spell with {X} in its mana cost each turn, you may copy it.
85. Tawnos, the Toymaker (EDHREC 8844) - Whenever you cast a Beast or Bird creature spell, you may copy it, except the copy is an artifact in addition to its other types.
86. Case of the Shifting Visage (EDHREC 8855) - Solved — Whenever you cast a nonlegendary creature spell, copy that spell. (The copy becomes a token.)
87. Complete the Circuit (EDHREC 9067) - When you next cast an instant or sorcery spell this turn, copy that spell twice.
88. Mysterious Stranger (EDHREC 9143) - If two or more cards are exiled this way, choose one of them at random and copy it.
89. Bygone Marvels (EDHREC 9301) - Descend 8 — When you cast this spell, if there are eight or more permanent cards in your graveyard, copy this spell twice. You may choose new targets for the copies.
90. All of History, All at Once (EDHREC 9326) - Storm (When you cast this spell, copy it for each spell cast before it this turn.)
91. Reenact the Crime (EDHREC 9649) - Copy it.
92. Galvanic Relay (EDHREC 9806) - Storm (When you cast this spell, copy it for each spell cast before it this turn.)
93. Donal, Herald of Wings (EDHREC 9814) - Whenever you cast a nonlegendary creature spell with flying, you may copy it, except the copy is a 1/1 Spirit in addition to its other types.
94. Dual Strike (EDHREC 9872) - When you next cast an instant or sorcery spell with mana value 4 or less this turn, copy that spell.
95. Garth One-Eye (EDHREC 9913) - {T}: Choose a card name that hasn't been chosen from among Disenchant, Braingeyser, Terror, Shivan Dragon, Regrowth, and Black Lotus. Create a copy of the card with the chosen name. You may cast the copy. (You still pay its costs.)
96. Spinerock Tyrant (EDHREC 9925) - Whenever you cast an instant or sorcery spell with a single target, you may copy it.
97. Curse of Echoes (EDHREC 10050) - Whenever enchanted player casts an instant or sorcery spell, each other player may copy that spell and may choose new targets for the copy they control.
98. Lose Focus (EDHREC 10261) - Replicate {U} (When you cast this spell, copy it for each time you paid its replicate cost. You may choose new targets for the copies.)
99. Lucky Clover (EDHREC 10407) - Whenever you cast an Adventure instant or sorcery spell, copy it.
100. Rally the Galadhrim (EDHREC 10468) - Conspire (As you cast this spell, you may tap two untapped creatures you control that share a color with it. When you do, copy it and you may choose a new target for the copy.)
101. Gigadrowse (EDHREC 10665) - Replicate {U} (When you cast this spell, copy it for each time you paid its replicate cost. You may choose new targets for the copies.)
102. Ominous Harvest (EDHREC 10974) - Gravestorm (When you cast this spell, copy it for each permanent put into a graveyard from the battlefield this turn.)
103. Rowan's Talent (EDHREC 11035) - Whenever you activate a loyalty ability of enchanted planeswalker, copy that ability.
104. Verrak, Warped Sengir (EDHREC 11184) - If you do, copy that ability.
105. Shiko, Paragon of the Way (EDHREC 11198) - Copy it, then you may cast the copy without paying its mana cost.
106. Magar of the Magic Strings (EDHREC 11200) - {1}{B}{R}: Note the name of target instant or sorcery card in your graveyard and put it onto the battlefield face down. It's a 3/3 creature with "Whenever this creature deals combat damage to a player, you may create a copy of the card with the noted name. You may cast the copy without paying its mana cost" and "If this creature would leave the battlefield, exile it instead of putting it anywhere else."
107. Radiant Performer (EDHREC 11224) - Copy that spell or ability for each other permanent or player the spell or ability could target.
108. Doublecast (EDHREC 11241) - When you next cast an instant or sorcery spell this turn, copy that spell.
109. Echo Storm (EDHREC 11420) - When you cast this spell, copy it for each time you've cast your commander from the command zone this game.
110. Silverquill Lecturer (EDHREC 11436) - (Whenever you cast a creature spell, you may copy it. If you do, choose an opponent to also copy it. Each copy becomes a token.)
111. Choreographed Sparks (EDHREC 11544) - • Copy target instant or sorcery spell you control. You may choose new targets for the copy.
112. Iron Man, Bleeding Edge (EDHREC 11562) - Whenever you cast an artifact spell, you may copy it, except the copy isn't legendary.
113. Leori, Sparktouched Hunter (EDHREC 11646) - Until end of turn, whenever you activate an ability of a planeswalker of that type, copy that ability.
114. Temporal Fissure (EDHREC 11854) - Storm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.)
115. Agrus Kos, Eternal Soldier (EDHREC 11930) - If you do, copy that ability for each other creature you control that ability could target.
116. Riku of Two Reflections (EDHREC 11989) - If you do, copy that spell.
117. Pit Automaton (EDHREC 11995) - {2}, {T}: When you next activate an exhaust ability that isn't a mana ability this turn, copy it. You may choose new targets for the copy.
118. Flamehold Grappler (EDHREC 12064) - You may choose new targets for the copy.
119. Chancellor of Tales (EDHREC 12086) - Whenever you cast an Adventure spell, you may copy it.
120. Najal, the Storm Runner (EDHREC 12116) - If you do, when you next cast an instant or sorcery spell this turn, copy it.
121. Lutri, the Spellchaser (EDHREC 12386) - You may choose new targets for the copy.
122. Will Kenrith (EDHREC 12414) - −8: Target player gets an emblem with "Whenever you cast an instant or sorcery spell, copy it.
123. Ignite Memories (EDHREC 12510) - Storm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.)
124. Dual Casting (EDHREC 12653) - You may choose new targets for the copy."
125. Spreading Insurrection (EDHREC 12662) - Storm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.)
126. Sage of the Skies (EDHREC 12666) - When you cast this spell, if you've cast another spell this turn, copy this spell.
127. Gandalf, Westward Voyager (EDHREC 12766) - If any of those cards shares a card type with that spell, copy that spell, you may choose new targets for the copy, and each opponent draws a card.
128. Skull Storm (EDHREC 12794) - When you cast this spell, copy it for each time you've cast your commander from the command zone this game.
129. Ian Chesterton (EDHREC 12827) - Science Teacher — Each Saga spell you cast has replicate. The replicate cost is equal to its mana cost. (When you cast that Saga, copy it for each time you paid its replicate cost. Copies of Saga spells become tokens.)
130. Mathise, Surge Channeler (EDHREC 12889) - 20 | Copy that spell.
131. Zevlor, Elturel Exile (EDHREC 12922) - {2}, {T}: When you next cast an instant or sorcery spell that targets only a single opponent or a single permanent an opponent controls this turn, for each other opponent, choose that player or a permanent they control, copy that spell, and the copy targets the chosen player or permanent.
132. Chandra's Regulator (EDHREC 12941) - If you do, copy that ability.
133. Aziza, Mage Tower Captain (EDHREC 12964) - If you do, copy that spell.
134. Genesis Storm (EDHREC 13109) - When you cast this spell, copy it for each time you've cast your commander from the command zone this game.
135. Thurid, Mare of Destiny (EDHREC 13136) - Whenever you cast a Pegasus, Unicorn, or Horse creature spell, copy it.
136. Echo, Perceptive Prodigy (EDHREC 13257) - {1}, {T}: Copy target activated or triggered ability you control from a creature source. You may choose new targets for the copy. (Mana abilities can't be targeted.)
137. Rootha, Mercurial Artist (EDHREC 13275) - {2}, Return Rootha to its owner's hand: Copy target instant or sorcery spell you control. You may choose new targets for the copy.
138. Dynaheir, Invoker Adept (EDHREC 13292) - {T}: When you next activate an ability that isn't a mana ability this turn by spending four or more mana to activate it, copy that ability. You may choose new targets for the copy.
139. Ashnod the Uncaring (EDHREC 13316) - Whenever you activate an ability of an artifact or creature that isn't a mana ability, if one or more permanents were sacrificed to activate it, you may copy that ability.
140. Howl of the Horde (EDHREC 13647) - When you next cast an instant or sorcery spell this turn, copy that spell.
141. Exterminator Magmarch (EDHREC 13687) - Copy that spell.
142. Barroom Brawl (EDHREC 13699) - Then that player may copy this spell and may choose new targets for the copy.
143. Raiding Schemes (EDHREC 13738) - When you do, copy it and you may choose new targets for the copy.
144. Sigil Tracer (EDHREC 13780) - {1}{U}, Tap two untapped Wizards you control: Copy target instant or sorcery spell. You may choose new targets for the copy.
145. Ether (EDHREC 13829) - {T}, Exile this artifact: Add {U}. When you next cast an instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy.
146. Radiate (EDHREC 13910) - Copy that spell for each other permanent or player the spell could target.
147. Feather, Radiant Arbiter (EDHREC 14024) - If you do, for each of those creatures, copy that spell.
148. Uyo, Silent Prophet (EDHREC 14027) - {2}, Return two lands you control to their owner's hand: Copy target instant or sorcery spell. You may choose new targets for the copy.
149. Storm of Memories (EDHREC 14147) - Storm (When you cast this spell, copy it for each spell cast before it this turn.)
150. Wing Shards (EDHREC 14291) - Storm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.)
151. Eternal Dominion (EDHREC 14425) - At the beginning of each of your upkeeps, copy this spell except for its epic ability.
152. Hunting Pack (EDHREC 14583) - Storm (When you cast this spell, copy it for each spell cast before it this turn.)
153. Capricious Hellraiser (EDHREC 14620) - Choose a noncreature, nonland card from among them and copy it.
154. Renegade Bull (EDHREC 14662) - Whenever this creature attacks, exile up to one target instant or sorcery card from your graveyard and copy it.
155. Mica, Reader of Ruins (EDHREC 14867) - If you do, copy that spell and you may choose new targets for the copy.
156. Mirari (EDHREC 15089) - If you do, copy that spell.
157. Tzaangor Shaman (EDHREC 15127) - Sorcerous Elixir — Whenever this creature deals combat damage to a player, copy the next instant or sorcery spell you cast this turn when you cast it. You may choose new targets for the copy.
158. Mordor on the March (EDHREC 15307) - Storm (When you cast this spell, copy it for each spell cast before it this turn.)
159. Wing Storm (EDHREC 15342) - Wing Storm deals damage to each player equal to twice the number of creatures that player controls with flying.
160. Jackal, Genius Geneticist (EDHREC 15436) - Whenever you cast a creature spell with mana value equal to Jackal's power, copy that spell, except the copy isn't legendary.
161. Stream of Thought (EDHREC 15468) - Replicate {2}{U}{U} (When you cast this spell, copy it for each time you paid its replicate cost. You may choose new targets for the copies.)
162. Storm of Forms (EDHREC 15815) - When you cast this spell, copy it for each kind of counter among permanents you control.
163. Ground Rift (EDHREC 15890) - Storm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.)
164. Echo Mage (EDHREC 16044) - {U}{U}, {T}: Copy target instant or sorcery spell. You may choose new targets for the copy.
165. Nivix Guildmage (EDHREC 16064) - {2}{U}{R}: Copy target instant or sorcery spell you control. You may choose new targets for the copy.
166. Cosmic Crucible (EDHREC 16149) - Whenever you cast a noncreature spell, you may copy it.
167. Demilich (EDHREC 16289) - Copy it.
168. Mentor's Guidance (EDHREC 16360) - When you cast this spell, copy it if you control a planeswalker, Cleric, Druid, Shaman, Warlock, or Wizard.
169. Parnesse, the Subtle Brush (EDHREC 16493) - Whenever you copy a spell, up to one target opponent may also copy that spell.
170. Storm, Queen of Wakanda (EDHREC 16573) - Whenever Storm attacks, until end of turn, another target attacking creature gains flying and gets +X/+0, where X is Storm's power.
171. Tawnos, Urza's Apprentice (EDHREC 16591) - {U}{R}, {T}: Copy target activated or triggered ability you control from an artifact source. You may choose new targets for the copy. (Mana abilities can't be targeted.)
172. Slick Imitator (EDHREC 16652) - Max speed — {1}, Sacrifice this creature: Copy target spell you control. You may choose new targets for the copy. (A copy of a permanent spell becomes a token.)
173. Gorion, Wise Mentor (EDHREC 17009) - Whenever you cast an Adventure spell, you may copy it.
174. Reaping the Graves (EDHREC 17017) - Storm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.)
175. Djinn Illuminatus (EDHREC 17246) - (When you cast it, copy it for each time you paid its replicate cost. You may choose new targets for the copies.)
176. Loki Laufeyson (EDHREC 17276) - {1}, {T}: When you next cast an instant or sorcery spell with mana value less than or equal to Loki's power this turn, copy that spell. You may choose new targets for the copy.
177. Ancestral Communion (EDHREC 17309) - When you cast this spell while you control your commander, copy this spell.
178. Kurkesh, Onakke Ancient (EDHREC 17700) - If you do, copy that ability.
179. Astral Steel (EDHREC 18111) - Storm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.)
180. Scientist Supreme of A.I.M. (EDHREC 18326) - You may choose new targets for the copy.
181. Empyrial Storm (EDHREC 18458) - When you cast this spell, copy it for each time you've cast your commander from the command zone this game.
182. Nashi, Moon's Legacy (EDHREC 18470) - Whenever Nashi attacks, exile up to one target legendary or Rat card from your graveyard and copy it.
183. Izzet Guildmage (EDHREC 18630) - {2}{U}: Copy target instant spell you control with mana value 2 or less. You may choose new targets for the copy.
184. Sea Gate Stormcaller (EDHREC 18742) - If this creature was kicked, copy that spell twice instead.
185. Endless Swarm (EDHREC 18874) - Epic (For the rest of the game, you can't cast spells. At the beginning of each of your upkeeps, copy this spell except for its epic ability.)
186. String of Disappearances (EDHREC 19198) - If the player does, they may copy this spell and may choose a new target for that copy.
187. Chain Stasis (EDHREC 19236) - If the player does, they may copy this spell and may choose a new target for that copy.
188. Hatut Zeraze Strike Force (EDHREC 19240) - When you cast this spell, copy it for each time you've cast your commander from the command zone this game.
189. League Guildmage (EDHREC 19257) - {X}{R}, {T}: Copy target instant or sorcery spell you control with mana value X. You may choose new targets for the copy.
190. Verazol, the Split Current (EDHREC 19341) - If you do, copy that spell.
191. Gadwick's First Duel (EDHREC 19600) - III — When you next cast an instant or sorcery spell with mana value 3 or less this turn, copy that spell. You may choose new targets for the copy.
192. Psychic Rebuttal (EDHREC 19930) - Spell mastery — If there are two or more instant and/or sorcery cards in your graveyard, you may copy the spell countered this way. You may choose new targets for the copy.
193. Sevinne, the Chronoclasm (EDHREC 20043) - Whenever you cast your first instant or sorcery spell from your graveyard each turn, copy that spell.
194. Photon Blast Barrage (EDHREC 20168) - When you cast this spell, copy it X times.
195. Social Snub (EDHREC 20541) - When you cast this spell while you control a creature, you may copy this spell.
196. Beamsplitter Mage (EDHREC 20933) - Copy that spell.
197. Fin Fang Foom (EDHREC 21416) - Whenever you cast an instant or sorcery spell that targets an artifact or land, copy that spell.
198. Train of Thought (EDHREC 21528) - Replicate {1}{U} (When you cast this spell, copy it for each time you paid its replicate cost.)
199. Cloven Casting (EDHREC 22185) - If you do, copy that spell.
200. Banish into Fable (EDHREC 22187) - When you cast this spell from your hand, copy it if you control an artifact, then copy it if you control an enchantment.

### 16. Mana Generation And Mana Riders

Source: corpus-mined follow-on seam
Available after current queue exclusion: 1363

1. Sol Ring (EDHREC 1) - {T}: Add {C}{C}.
2. Command Tower (EDHREC 2) - {T}: Add one mana of any color in your commander's color identity.
3. Arcane Signet (EDHREC 3) - {T}: Add one mana of any color in your commander's color identity.
4. Exotic Orchard (EDHREC 9) - {T}: Add one mana of any color that a land an opponent controls could produce.
5. Reliquary Tower (EDHREC 10) - {T}: Add {C}.
6. Path of Ancestry (EDHREC 14) - {T}: Add one mana of any color in your commander's color identity. When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1. (Look at the top card of your library. You may put that card on the bottom.)
7. Fellwar Stone (EDHREC 17) - {T}: Add one mana of any color that a land an opponent controls could produce.
8. Rogue's Passage (EDHREC 18) - {T}: Add {C}.
9. Thought Vessel (EDHREC 21) - {T}: Add {C}.
10. Bojuka Bog (EDHREC 24) - {T}: Add {B}.
11. Dark Ritual (EDHREC 33) - Add {B}{B}{B}.
12. Birds of Paradise (EDHREC 34) - {T}: Add one mana of any color.
13. Watery Grave (EDHREC 51) - ({T}: Add {U} or {B}.)
14. Llanowar Elves (EDHREC 58) - {T}: Add {G}.
15. Breeding Pool (EDHREC 60) - ({T}: Add {G} or {U}.)
16. Godless Shrine (EDHREC 61) - ({T}: Add {W} or {B}.)
17. Hallowed Fountain (EDHREC 63) - ({T}: Add {W} or {U}.)
18. Steam Vents (EDHREC 65) - ({T}: Add {U} or {R}.)
19. Stomping Ground (EDHREC 68) - ({T}: Add {R} or {G}.)
20. Blood Crypt (EDHREC 69) - ({T}: Add {B} or {R}.)
21. Overgrown Tomb (EDHREC 71) - ({T}: Add {B} or {G}.)
22. Sacred Foundry (EDHREC 74) - ({T}: Add {R} or {W}.)
23. Temple of the False God (EDHREC 79) - {T}: Add {C}{C}. Activate only if you control five or more lands.
24. Sulfur Falls (EDHREC 80) - {T}: Add {U} or {R}.
25. Clifftop Retreat (EDHREC 81) - {T}: Add {R} or {W}.
26. Temple Garden (EDHREC 83) - ({T}: Add {G} or {W}.)
27. Dragonskull Summit (EDHREC 84) - {T}: Add {B} or {R}.
28. Chromatic Lantern (EDHREC 85) - Lands you control have "{T}: Add one mana of any color."
29. Sunken Hollow (EDHREC 86) - ({T}: Add {U} or {B}.)
30. Cinder Glade (EDHREC 87) - ({T}: Add {R} or {G}.)
31. Otawara, Soaring City (EDHREC 88) - {T}: Add {U}.
32. Smoldering Marsh (EDHREC 93) - ({T}: Add {B} or {R}.)
33. Isolated Chapel (EDHREC 94) - {T}: Add {W} or {B}.
34. Glacial Fortress (EDHREC 95) - {T}: Add {W} or {U}.
35. Hinterland Harbor (EDHREC 98) - {T}: Add {G} or {U}.
36. Jeska's Will (EDHREC 103) - • Add {R} for each card in target opponent's hand.
37. Elvish Mystic (EDHREC 104) - {T}: Add {G}.
38. Canopy Vista (EDHREC 105) - ({T}: Add {G} or {W}.)
39. Prairie Stream (EDHREC 106) - ({T}: Add {W} or {U}.)
40. Drowned Catacomb (EDHREC 109) - {T}: Add {U} or {B}.
41. Woodland Cemetery (EDHREC 112) - {T}: Add {B} or {G}.
42. Cavern of Souls (EDHREC 113) - {T}: Add {C}.
43. Mana Confluence (EDHREC 119) - {T}, Pay 1 life: Add one mana of any color.
44. Rootbound Crag (EDHREC 127) - {T}: Add {R} or {G}.
45. Sunpetal Grove (EDHREC 134) - {T}: Add {G} or {W}.
46. Morphic Pool (EDHREC 140) - {T}: Add {U} or {B}.
47. Rejuvenating Springs (EDHREC 142) - {T}: Add {G} or {U}.
48. Chrome Mox (EDHREC 147) - {T}: Add one mana of any of the exiled card's colors.
49. Training Center (EDHREC 149) - {T}: Add {U} or {R}.
50. Dimir Signet (EDHREC 153) - {1}, {T}: Add {U}{B}.
51. Delighted Halfling (EDHREC 155) - {T}: Add {C}.
52. Luxury Suite (EDHREC 162) - {T}: Add {B} or {R}.
53. Sea of Clouds (EDHREC 163) - {T}: Add {W} or {U}.
54. Nykthos, Shrine to Nyx (EDHREC 164) - {T}: Add {C}.
55. Rakdos Signet (EDHREC 165) - {1}, {T}: Add {B}{R}.
56. Izzet Signet (EDHREC 169) - {1}, {T}: Add {U}{R}.
57. Vault of Champions (EDHREC 170) - {T}: Add {W} or {B}.
58. Spectator Seating (EDHREC 171) - {T}: Add {R} or {W}.
59. Reflecting Pool (EDHREC 173) - {T}: Add one mana of any type that a land you control could produce.
60. Mystic Sanctuary (EDHREC 174) - ({T}: Add {U}.)
61. Undergrowth Stadium (EDHREC 175) - {T}: Add {B} or {G}.
62. Three Tree City (EDHREC 176) - {T}: Add {C}.
63. Dreamroot Cascade (EDHREC 177) - {T}: Add {G} or {U}.
64. Gemstone Caverns (EDHREC 180) - {T}: Add {C}. If Gemstone Caverns has a luck counter on it, instead add one mana of any color.
65. Orzhov Signet (EDHREC 184) - {1}, {T}: Add {W}{B}.
66. Spire Garden (EDHREC 187) - {T}: Add {R} or {G}.
67. Stormcarved Coast (EDHREC 188) - {T}: Add {U} or {R}.
68. Cabal Coffers (EDHREC 192) - {2}, {T}: Add {B} for each Swamp you control.
69. Mosswort Bridge (EDHREC 196) - {T}: Add {G}.
70. Thran Dynamo (EDHREC 200) - {T}: Add {C}{C}{C}.
71. Patchwork Banner (EDHREC 201) - {T}: Add one mana of any color.
72. Mox Amber (EDHREC 206) - {T}: Add one mana of any color among legendary creatures and planeswalkers you control.
73. Karn's Bastion (EDHREC 207) - {T}: Add {C}.
74. Bountiful Promenade (EDHREC 211) - {T}: Add {G} or {W}.
75. Azorius Signet (EDHREC 213) - {1}, {T}: Add {W}{U}.
76. Fyndhorn Elves (EDHREC 218) - {T}: Add {G}.
77. Ornithopter of Paradise (EDHREC 220) - {T}: Add one mana of any color.
78. Secluded Courtyard (EDHREC 222) - {T}: Add {C}.
79. Rockfall Vale (EDHREC 224) - {T}: Add {R} or {G}.
80. Shipwreck Marsh (EDHREC 229) - {T}: Add {U} or {B}.
81. Mox Opal (EDHREC 241) - Metalcraft — {T}: Add one mana of any color. Activate only if you control three or more artifacts.
82. Boros Signet (EDHREC 243) - {1}, {T}: Add {R}{W}.
83. Unclaimed Territory (EDHREC 245) - {T}: Add {C}.
84. Takenuma, Abandoned Mire (EDHREC 248) - {T}: Add {B}.
85. Everflowing Chalice (EDHREC 251) - {T}: Add {C} for each charge counter on this artifact.
86. Bloom Tender (EDHREC 260) - Vivid — {T}: For each color among permanents you control, add one mana of that color.
87. Sundown Pass (EDHREC 272) - {T}: Add {R} or {W}.
88. Deserted Beach (EDHREC 274) - {T}: Add {W} or {U}.
89. Haunted Ridge (EDHREC 278) - {T}: Add {B} or {R}.
90. Shattered Sanctum (EDHREC 279) - {T}: Add {W} or {B}.
91. Darksteel Citadel (EDHREC 283) - {T}: Add {C}.
92. Temple of Epiphany (EDHREC 284) - {T}: Add {U} or {R}.
93. Rugged Prairie (EDHREC 285) - {T}: Add {C}.
94. Overgrown Farmland (EDHREC 288) - {T}: Add {G} or {W}.
95. Choked Estuary (EDHREC 289) - {T}: Add {U} or {B}.
96. Temple of Silence (EDHREC 290) - {T}: Add {W} or {B}.
97. Cascade Bluffs (EDHREC 292) - {T}: Add {C}.
98. Mana Geyser (EDHREC 296) - Add {R} for each tapped land your opponents control.
99. Simic Growth Chamber (EDHREC 301) - {T}: Add {G}{U}.
100. Temple of Triumph (EDHREC 303) - {T}: Add {R} or {W}.
101. Flooded Grove (EDHREC 304) - {T}: Add {C}.
102. Decanter of Endless Water (EDHREC 309) - {T}: Add one mana of any color.
103. Seething Song (EDHREC 313) - Add {R}{R}{R}{R}{R}.
104. Jungle Shrine (EDHREC 314) - {T}: Add {R}, {G}, or {W}.
105. Temple of Enlightenment (EDHREC 316) - {T}: Add {W} or {U}.
106. Temple of Mystery (EDHREC 319) - {T}: Add {G} or {U}.
107. Darkwater Catacombs (EDHREC 320) - {1}, {T}: Add {U}{B}.
108. Seat of the Synod (EDHREC 325) - {T}: Add {U}.
109. Lotus Cobra (EDHREC 327) - Landfall — Whenever a land you control enters, add one mana of any color.
110. Foreboding Ruins (EDHREC 328) - {T}: Add {B} or {R}.
111. Golgari Rot Farm (EDHREC 330) - {T}: Add {B}{G}.
112. Frostboil Snarl (EDHREC 334) - {T}: Add {U} or {R}.
113. Port Town (EDHREC 337) - {T}: Add {W} or {U}.
114. Fetid Heath (EDHREC 339) - {T}: Add {C}.
115. Fortified Village (EDHREC 342) - {T}: Add {G} or {W}.
116. Furycalm Snarl (EDHREC 344) - {T}: Add {R} or {W}.
117. Temple of Deceit (EDHREC 345) - {T}: Add {U} or {B}.
118. Skycloud Expanse (EDHREC 348) - {1}, {T}: Add {W}{U}.
119. Arcane Sanctum (EDHREC 350) - {T}: Add {W}, {U}, or {B}.
120. Temple of Malady (EDHREC 354) - {T}: Add {B} or {G}.
121. Dimir Aqueduct (EDHREC 357) - {T}: Add {U}{B}.
122. Crumbling Necropolis (EDHREC 360) - {T}: Add {U}, {B}, or {R}.
123. Deathcap Glade (EDHREC 361) - {T}: Add {B} or {G}.
124. Twilight Mire (EDHREC 362) - {T}: Add {C}.
125. Shifting Woodland (EDHREC 363) - {T}: Add {G}.
126. Nomad Outpost (EDHREC 369) - {T}: Add {R}, {W}, or {B}.
127. Mystic Monastery (EDHREC 374) - {T}: Add {U}, {R}, or {W}.
128. Arena of Glory (EDHREC 375) - {T}: Add {R}.
129. Opulent Palace (EDHREC 381) - {T}: Add {B}, {G}, or {U}.
130. Game Trail (EDHREC 384) - {T}: Add {R} or {G}.
131. Great Furnace (EDHREC 392) - {T}: Add {R}.
132. Spire of Industry (EDHREC 393) - {T}: Add {C}.
133. Frontier Bivouac (EDHREC 395) - {T}: Add {G}, {U}, or {R}.
134. Kessig Wolf Run (EDHREC 399) - {T}: Add {C}.
135. Orzhov Basilica (EDHREC 400) - {T}: Add {W}{B}.
136. Mistrise Village (EDHREC 401) - {T}: Add {U}.
137. Seaside Citadel (EDHREC 402) - {T}: Add {G}, {W}, or {U}.
138. Izzet Boilerworks (EDHREC 411) - {T}: Add {U}{R}.
139. Gilded Lotus (EDHREC 412) - {T}: Add three mana of any one color.
140. Hall of Heliod's Generosity (EDHREC 416) - {T}: Add {C}.
141. Shineshadow Snarl (EDHREC 417) - {T}: Add {W} or {B}.
142. Undercity Sewers (EDHREC 421) - ({T}: Add {U} or {B}.)
143. Tainted Wood (EDHREC 427) - {T}: Add {C}.
144. Shadowblood Ridge (EDHREC 429) - {1}, {T}: Add {B}{R}.
145. Simian Spirit Guide (EDHREC 432) - Exile this card from your hand: Add {R}.
146. Tainted Field (EDHREC 433) - {T}: Add {C}.
147. Sungrass Prairie (EDHREC 434) - {1}, {T}: Add {G}{W}.
148. Gruul Turf (EDHREC 436) - {T}: Add {R}{G}.
149. Temple of Malice (EDHREC 438) - {T}: Add {B} or {R}.
150. Enduring Vitality (EDHREC 446) - Creatures you control have "{T}: Add one mana of any color."
151. Gaea's Cradle (EDHREC 449) - {T}: Add {G} for each creature you control.
152. Cursed Mirror (EDHREC 452) - {T}: Add {R}.
153. Azorius Chancery (EDHREC 454) - {T}: Add {W}{U}.
154. Vault of the Archangel (EDHREC 461) - {T}: Add {C}.
155. Academy Ruins (EDHREC 468) - {T}: Add {C}.
156. Underground Mortuary (EDHREC 474) - ({T}: Add {B} or {G}.)
157. Boros Garrison (EDHREC 486) - {T}: Add {R}{W}.
158. Temple of Plenty (EDHREC 492) - {T}: Add {G} or {W}.
159. Rakdos Carnarium (EDHREC 494) - {T}: Add {B}{R}.
160. Plaza of Heroes (EDHREC 495) - {T}: Add {C}.
161. Tainted Peak (EDHREC 498) - {T}: Add {C}.
162. Ancient Den (EDHREC 503) - {T}: Add {W}.
163. Faeburrow Elder (EDHREC 504) - {T}: For each color among permanents you control, add one mana of that color.
164. Sandsteppe Citadel (EDHREC 505) - {T}: Add {W}, {B}, or {G}.
165. Tainted Isle (EDHREC 506) - {T}: Add {C}.
166. Liquimetal Torque (EDHREC 514) - {T}: Add {C}.
167. Temple of Abandon (EDHREC 516) - {T}: Add {R} or {G}.
168. Avacyn's Pilgrim (EDHREC 519) - {T}: Add {W}.
169. Necroblossom Snarl (EDHREC 525) - {T}: Add {B} or {G}.
170. Blazemire Verge (EDHREC 529) - {T}: Add {B}.
171. Ignoble Hierarch (EDHREC 530) - {T}: Add {B}, {R}, or {G}.
172. Vineglimmer Snarl (EDHREC 534) - {T}: Add {G} or {U}.
173. Mossfire Valley (EDHREC 537) - {1}, {T}: Add {R}{G}.
174. Relic of Legends (EDHREC 544) - {T}: Add one mana of any color.
175. Hedge Maze (EDHREC 547) - ({T}: Add {G} or {U}.)
176. Nesting Grounds (EDHREC 561) - {T}: Add {C}.
177. Basalt Monolith (EDHREC 563) - {T}: Add {C}{C}{C}.
178. Selesnya Sanctuary (EDHREC 565) - {T}: Add {G}{W}.
179. Raucous Theater (EDHREC 566) - ({T}: Add {B} or {R}.)
180. Graven Cairns (EDHREC 568) - {T}: Add {C}.
181. Thespian's Stage (EDHREC 572) - {T}: Add {C}.
182. Worn Powerstone (EDHREC 573) - {T}: Add {C}{C}.
183. Shadowy Backstreet (EDHREC 574) - ({T}: Add {W} or {B}.)
184. Talon Gates of Madara (EDHREC 577) - {T}: Add {C}.
185. Springleaf Drum (EDHREC 578) - {T}, Tap an untapped creature you control: Add one mana of any color.
186. Access Tunnel (EDHREC 588) - {T}: Add {C}.
187. Simic Signet (EDHREC 597) - {1}, {T}: Add {G}{U}.
188. Gloomlake Verge (EDHREC 601) - {T}: Add {U}.
189. Minamo, School at Water's Edge (EDHREC 602) - {T}: Add {U}.
190. Vault of Whispers (EDHREC 608) - {T}: Add {B}.
191. Bender's Waterskin (EDHREC 612) - {T}: Add one mana of any color.
192. Shizo, Death's Storehouse (EDHREC 614) - {T}: Add {B}.
193. Thundering Falls (EDHREC 623) - ({T}: Add {U} or {R}.)
194. Sanctum Weaver (EDHREC 628) - {T}: Add X mana of any one color, where X is the number of enchantments you control.
195. Savage Lands (EDHREC 633) - {T}: Add {B}, {R}, or {G}.
196. Commercial District (EDHREC 651) - ({T}: Add {R} or {G}.)
197. Floodfarm Verge (EDHREC 653) - {T}: Add {W}.
198. Rite of Flame (EDHREC 654) - Add {R}{R}, then add {R} for each card named Rite of Flame in each graveyard.
199. Windbrisk Heights (EDHREC 657) - {T}: Add {W}.
200. Grim Monolith (EDHREC 674) - {T}: Add {C}{C}{C}.

### 17. Cast Without Paying Mana Cost

Source: corpus-mined follow-on seam
Available after current queue exclusion: 324

1. Mosswort Bridge (EDHREC 196) - {G}, {T}: You may play the exiled card without paying its mana cost if creatures you control have total power 10 or greater.
2. Etali, Primal Storm (EDHREC 262) - Whenever Etali attacks, exile the top card of each player's library, then you may cast any number of spells from among those cards without paying their mana costs.
3. Tibalt's Trickery (EDHREC 590) - They may cast that card without paying its mana cost.
4. Windbrisk Heights (EDHREC 657) - {W}, {T}: You may play the exiled card without paying its mana cost if you attacked with three or more creatures this turn.
5. Isochron Scepter (EDHREC 733) - {2}, {T}: You may copy the exiled card. If you do, you may cast the copy without paying its mana cost.
6. Chimil, the Inner Sun (EDHREC 761) - Cast it without paying its mana cost or put it into your hand.
7. Spinerock Knoll (EDHREC 763) - {R}, {T}: You may play the exiled card without paying its mana cost if an opponent was dealt 7 or more damage this turn.
8. Mizzix's Mastery (EDHREC 804) - For each card exiled this way, copy it, and you may cast the copy without paying its mana cost.
9. Sunbird's Invocation (EDHREC 1862) - You may cast a spell with mana value X or less from among cards revealed this way without paying its mana cost.
10. Aven Interrupter (EDHREC 1876) - When this creature enters, exile target spell. It becomes plotted. (Its owner may cast it as a sorcery on a later turn without paying its mana cost.)
11. Fallen Shinobi (EDHREC 2036) - Until end of turn, you may play those cards without paying their mana costs.
12. The Key to the Vault (EDHREC 2149) - You may cast the exiled card without paying its mana cost.
13. Monstrous Vortex (EDHREC 2177) - Cast it without paying its mana cost or put it into your hand.
14. Descendants' Path (EDHREC 2181) - If it's a creature card that shares a creature type with a creature you control, you may cast it without paying its mana cost.
15. Thrumming Stone (EDHREC 2260) - You may cast spells with the same name as that spell from among the revealed cards without paying their mana costs.
16. Arcane Bombardment (EDHREC 2262) - You may cast any number of the copies without paying their mana costs.
17. Plargg and Nassari (EDHREC 2287) - You may cast up to two spells from among the other cards exiled this way without paying their mana costs.
18. Dracogenesis (EDHREC 2339) - You may cast Dragon spells without paying their mana costs.
19. Villainous Wealth (EDHREC 2376) - You may cast any number of spells with mana value X or less from among them without paying their mana costs.
20. Powerbalance (EDHREC 2383) - If you do, you may cast that card without paying its mana cost if the two spells have the same mana value.
21. Wand of Wonder (EDHREC 2413) - {4}, {T}: Roll a d20. Each opponent exiles cards from the top of their library until they exile an instant or sorcery card, then shuffles the rest into their library. You may cast up to X instant and/or sorcery spells from among cards exiled this way without paying their mana costs.
22. Pantlaza, Sun-Favored (EDHREC 2422) - Cast it without paying its mana cost or put it into your hand.
23. Aminatou's Augury (EDHREC 2509) - Until end of turn, for each nonland card type, you may cast a spell of that type from among the exiled cards without paying its mana cost.
24. Mind's Dilation (EDHREC 2671) - If it's a nonland card, you may cast it without paying its mana cost.
25. Cemetery Tampering (EDHREC 2768) - Then if there are twenty or more cards in your graveyard, you may play the exiled card without paying its mana cost.
26. Silent-Blade Oni (EDHREC 2820) - You may cast a spell from among those cards without paying its mana cost.
27. Jodah, the Unifier (EDHREC 2848) - You may cast that card without paying its mana cost.
28. Geode Golem (EDHREC 3113) - Whenever this creature deals combat damage to a player, you may cast your commander from the command zone without paying its mana cost.
29. Gríma, Saruman's Footman (EDHREC 3182) - You may cast that card without paying its mana cost.
30. Improvisation Capstone (EDHREC 3265) - You may cast any number of spells from among them without paying their mana costs.
31. Court of Locthwain (EDHREC 3301) - If you're the monarch, until end of turn, you may cast a spell from among cards exiled with this enchantment without paying its mana cost.
32. Aetherworks Marvel (EDHREC 3490) - {T}, Pay six {E}: Look at the top six cards of your library. You may cast a spell from among them without paying its mana cost. Put the rest on the bottom of your library in a random order.
33. Rashmi, Eternities Crafter (EDHREC 3534) - You may cast it without paying its mana cost if it's a spell with lesser mana value.
34. Mind's Desire (EDHREC 3588) - Until end of turn, you may play that card without paying its mana cost.
35. Diluvian Primordial (EDHREC 3630) - When this creature enters, for each opponent, you may cast up to one target instant or sorcery card from that player's graveyard without paying its mana cost.
36. Baral's Expertise (EDHREC 3800) - You may cast a spell with mana value 4 or less from your hand without paying its mana cost.
37. Planetarium of Wan Shi Tong (EDHREC 3923) - You may cast that card without paying its mana cost.
38. Germination Practicum (EDHREC 3938) - Paradigm (Then exile this spell. After you first resolve a spell with this name, you may cast a copy of it from exile without paying its mana cost at the beginning of each of your first main phases.)
39. Breaching Dragonstorm (EDHREC 4053) - You may cast it without paying its mana cost if that spell's mana value is 8 or less.
40. Invoke Calamity (EDHREC 4107) - You may cast up to two instant and/or sorcery spells with total mana value 6 or less from your graveyard and/or hand without paying their mana costs.
41. Chaos Wand (EDHREC 4194) - {4}, {T}: Target opponent exiles cards from the top of their library until they exile an instant or sorcery card. You may cast that card without paying its mana cost. Then put the exiled cards that weren't cast this way on the bottom of that library in a random order.
42. Decorum Dissertation (EDHREC 4227) - Paradigm (Then exile this spell. After you first resolve a spell with this name, you may cast a copy of it from exile without paying its mana cost at the beginning of each of your first main phases.)
43. Submerge (EDHREC 4303) - If an opponent controls a Forest and you control an Island, you may cast this spell without paying its mana cost.
44. Dance with Calamity (EDHREC 4343) - If the total mana value of the cards exiled this way is 13 or less, you may cast any number of spells from among those cards without paying their mana costs.
45. Guff Rewrites History (EDHREC 4395) - Each player may cast the nonland card they exiled without paying its mana cost.
46. Memory Plunder (EDHREC 4655) - You may cast target instant or sorcery card from an opponent's graveyard without paying its mana cost.
47. Wondrous Crucible (EDHREC 4722) - You may cast the copy without paying its mana cost.
48. Sword of Once and Future (EDHREC 4804) - Then you may cast an instant or sorcery spell with mana value 2 or less from your graveyard without paying its mana cost.
49. Possibility Storm (EDHREC 4809) - That player may cast that card without paying its mana cost.
50. Creative Technique (EDHREC 4860) - You may cast the exiled card without paying its mana cost.
51. Surge to Victory (EDHREC 5026) - You may cast the copy without paying its mana cost.
52. Triple Triad (EDHREC 5069) - Until end of turn, you may play the card you own exiled this way and each other card exiled this way with lesser mana value than it without paying their mana costs.
53. Bigger on the Inside (EDHREC 5088) - They may cast it without paying its mana cost.
54. Arcane Heist (EDHREC 5120) - You may cast target instant or sorcery card from an opponent's graveyard without paying its mana cost.
55. Clive's Hideaway (EDHREC 5162) - {2}, {T}: You may play the exiled card without paying its mana cost if you control four or more legendary creatures.
56. Nahiri, Forged in Fury (EDHREC 5195) - You may cast Equipment spells this way without paying their mana costs.
57. Djeru and Hazoret (EDHREC 5238) - Until end of turn, you may cast the exiled card without paying its mana cost.
58. Wrexial, the Risen Deep (EDHREC 5244) - Whenever Wrexial deals combat damage to a player, you may cast target instant or sorcery card from that player's graveyard without paying its mana cost.
59. Deep-Sea Kraken (EDHREC 5306) - When the last is removed, you may cast it without paying its mana cost.
60. Zoyowa's Justice (EDHREC 5368) - They cast it without paying its mana cost or put it into their hand.
61. Kotis, the Fangkeeper (EDHREC 5388) - You may cast any number of spells with mana value X or less from among them without paying their mana costs.
62. Fevered Suspicion (EDHREC 5411) - You may cast any number of spells from among those nonland cards without paying their mana costs.
63. Evercoat Ursine (EDHREC 5435) - Whenever this creature deals combat damage to a player, if there are cards exiled with it, you may play one of them without paying its mana cost.
64. Kellan, the Kid (EDHREC 5446) - Whenever you cast a spell from anywhere other than your hand, you may cast a permanent spell with equal or lesser mana value from your hand without paying its mana cost.
65. Finale of Promise (EDHREC 5450) - You may cast up to one target instant card and/or up to one target sorcery card from your graveyard each with mana value X or less without paying their mana costs.
66. Echocasting Symposium (EDHREC 5451) - Paradigm (Then exile this spell. After you first resolve a spell with this name, you may cast a copy of it from exile without paying its mana cost at the beginning of each of your first main phases.)
67. Press the Enemy (EDHREC 5488) - You may cast an instant or sorcery spell with equal or lesser mana value from your hand without paying its mana cost.
68. Restoration Seminar (EDHREC 5557) - Paradigm (Then exile this spell. After you first resolve a spell with this name, you may cast a copy of it from exile without paying its mana cost at the beginning of each of your first main phases.)
69. Glamdring (EDHREC 5667) - Whenever equipped creature deals combat damage to a player, you may cast an instant or sorcery spell from your hand with mana value less than or equal to that damage without paying its mana cost.
70. Sarevok's Tome (EDHREC 5809) - {3}, {T}: Exile cards from the top of your library until you exile a nonland card. You may cast that card without paying its mana cost. Activate only if you've completed a dungeon.
71. Perception Bobblehead (EDHREC 5939) - {3}, {T}: Look at the top X cards of your library, where X is the number of Bobbleheads you control. You may cast a spell with mana value 3 or less from among them without paying its mana cost. Put the rest on the bottom of your library in a random order.
72. Star Whale (EDHREC 5944) - When the last is removed, you may cast it without paying its mana cost.
73. River Song's Diary (EDHREC 6043) - At the beginning of your upkeep, if there are four or more cards exiled with this artifact, choose one of them at random. You may cast it without paying its mana cost.
74. Epic Experiment (EDHREC 6107) - You may cast instant and sorcery spells with mana value X or less from among them without paying their mana costs.
75. Halo Forager (EDHREC 6128) - When you do, you may cast target instant or sorcery card with mana value X from a graveyard without paying its mana cost.
76. Dazzling Sphinx (EDHREC 6338) - You may cast that card without paying its mana cost.
77. Maelstrom Archangel (EDHREC 6513) - Whenever this creature deals combat damage to a player, you may cast a spell from your hand without paying its mana cost.
78. Crabomination (EDHREC 6703) - You may cast a spell from among cards exiled this way without paying its mana cost.
79. Dream Harvest (EDHREC 6722) - Until end of turn, you may cast cards exiled this way without paying their mana costs.
80. Wildfire Devils (EDHREC 6733) - You may cast the copy without paying its mana cost.
81. Knowledge Pool (EDHREC 6758) - If the player does, they may cast a spell from among other cards exiled with this artifact without paying its mana cost.
82. Yue, the Moon Spirit (EDHREC 6806) - Waterbend {5}, {T}: You may cast a noncreature spell from your hand without paying its mana cost.
83. Etali's Favor (EDHREC 6811) - Cast it without paying its mana cost or put it into your hand.
84. Kari Zev's Expertise (EDHREC 6835) - You may cast a spell with mana value 2 or less from your hand without paying its mana cost.
85. Smirking Spelljacker (EDHREC 6943) - Whenever this creature attacks, if a card is exiled with it, you may cast the exiled card without paying its mana cost.
86. Deluxe Dragster (EDHREC 6976) - Whenever this Vehicle deals combat damage to a player, you may cast target instant or sorcery card from that player's graveyard without paying its mana cost.
87. Baral and Kari Zev (EDHREC 7034) - Whenever you cast your first instant or sorcery spell each turn, you may cast a spell with lesser mana value that shares a card type with it from your hand without paying its mana cost.
88. Cosmic Cube (EDHREC 7051) - You may cast a spell from among them with mana value less than or equal to the greatest power among attacking creatures you control without paying its mana cost.
89. Transcendent Dragon (EDHREC 7219) - If that spell is countered this way, exile it instead of putting it into its owner's graveyard, then you may cast it without paying its mana cost.
90. Mindleech Mass (EDHREC 7307) - If you do, you may cast a spell from among those cards without paying its mana cost.
91. Visage Bandit (EDHREC 7426) - Cast it as a sorcery on a later turn without paying its mana cost.
92. Caves of Chaos Adventurer (EDHREC 7478) - If you've completed a dungeon, you may play that card this turn without paying its mana cost.
93. Velomachus Lorehold (EDHREC 7498) - You may cast an instant or sorcery spell with mana value less than or equal to Velomachus Lorehold's power from among them without paying its mana cost.
94. Kheru Spellsnatcher (EDHREC 7599) - You may cast that card without paying its mana cost for as long as it remains exiled.
95. Spelltwine (EDHREC 7736) - Cast the copies if able without paying their mana costs.
96. Dreadhorde Arcanist (EDHREC 7936) - Whenever this creature attacks, you may cast target instant or sorcery card with mana value less than or equal to this creature's power from your graveyard without paying its mana cost.
97. Neera, Wild Mage (EDHREC 8043) - You may cast that card without paying its mana cost.
98. Bre of Clan Stoutarm (EDHREC 8207) - You may cast that card without paying its mana cost if the spell's mana value is less than or equal to the amount of life you gained this turn.
99. Etrata, Deadly Fugitive (EDHREC 8290) - If you can't, exile it, then you may cast the exiled card without paying its mana cost."
100. Narset, Enlightened Master (EDHREC 8347) - Until end of turn, you may cast noncreature spells from among those cards without paying their mana costs.
101. Extract Brain (EDHREC 8402) - You may cast a spell from among them without paying its mana cost.
102. Sorcerous Squall (EDHREC 8458) - Target opponent mills nine cards, then you may cast an instant or sorcery spell from that player's graveyard without paying its mana cost.
103. Yahenni's Expertise (EDHREC 8566) - You may cast a spell with mana value 3 or less from your hand without paying its mana cost.
104. Kiora, Sovereign of the Deep (EDHREC 8640) - You may cast a spell with mana value less than X from among them without paying its mana cost.
105. Diviner of Mist (EDHREC 8683) - You may cast an instant or sorcery spell from your graveyard with mana value 4 or less without paying its mana cost.
106. Daring Waverider (EDHREC 8693) - When this creature enters, you may cast target instant or sorcery card with mana value 4 or less from your graveyard without paying its mana cost.
107. Once Upon a Time (EDHREC 8839) - If this spell is the first spell you've cast this game, you may cast it without paying its mana cost.
108. The Dawning Archaic (EDHREC 8900) - Whenever The Dawning Archaic attacks, you may cast target instant or sorcery card from your graveyard without paying its mana cost.
109. Goblin Dark-Dwellers (EDHREC 9032) - When this creature enters, you may cast target instant or sorcery card with mana value 3 or less from your graveyard without paying its mana cost.
110. Gale's Redirection (EDHREC 9041) - 15+ | You may cast the exiled card without paying its mana cost for as long as it remains exiled.
111. Stolen Goods (EDHREC 9053) - Until end of turn, you may cast that card without paying its mana cost.
112. Pillage the Bog (EDHREC 9064) - Cast it as a sorcery on a later turn without paying its mana cost.
113. Mysterious Stranger (EDHREC 9143) - You may cast the copy without paying its mana cost.
114. Forger's Foundry (EDHREC 9148) - {3}{U}{U}, {T}: You may cast any number of spells from among cards exiled with this artifact without paying their mana costs. Activate only as a sorcery.
115. Slickshot Show-Off (EDHREC 9164) - Cast it as a sorcery on a later turn without paying its mana cost.
116. World War Hulk (EDHREC 9183) - I — The next red or green creature spell you cast this turn can be cast without paying its mana cost.
117. Make Your Own Luck (EDHREC 9235) - Look at the top three cards of your library. You may exile a nonland card from among them. If you do, it becomes plotted. Put the rest into your hand. (You may cast it as a sorcery on a later turn without paying its mana cost.)
118. Release to the Wind (EDHREC 9505) - For as long as that card remains exiled, its owner may cast it without paying its mana cost.
119. Reinterpret (EDHREC 9582) - You may cast a spell with equal or lesser mana value from your hand without paying its mana cost.
120. Portent of Calamity (EDHREC 9599) - You may cast a spell from among the exiled cards without paying its mana cost if you exiled four or more cards this way.
121. Reenact the Crime (EDHREC 9649) - You may cast the copy without paying its mana cost.
122. Goliath Daydreamer (EDHREC 9921) - Whenever this creature attacks, you may cast a spell from among cards you own in exile with dream counters on them without paying its mana cost.
123. Unexpected Results (EDHREC 9933) - If it's a nonland card, you may cast it without paying its mana cost.
124. Smuggler's Buggy (EDHREC 10076) - Whenever this Vehicle deals combat damage to a player, you may cast the exiled card without paying its mana cost.
125. Talent of the Telepath (EDHREC 10193) - You may cast an instant or sorcery spell from among them without paying its mana cost.
126. Scholar of the Lost Trove (EDHREC 10251) - When this creature enters, you may cast target instant, sorcery, or artifact card from your graveyard without paying its mana cost.
127. Panoptic Mirror (EDHREC 10311) - If you do, you may cast the copy without paying its mana cost.
128. Spell Queller (EDHREC 10332) - When this creature leaves the battlefield, the exiled card's owner may cast that card without paying its mana cost.
129. Step Between Worlds (EDHREC 10410) - Cast it as a sorcery on a later turn without paying its mana cost.
130. Lilah, Undefeated Slickshot (EDHREC 10414) - Whenever you cast a multicolored instant or sorcery spell from your hand, exile that spell instead of putting it into your graveyard as it resolves. If you do, it becomes plotted. (You may cast it as a sorcery on a later turn without paying its mana cost.)
131. Watcher of Hours (EDHREC 10419) - When the last is removed, you may cast it without paying its mana cost.
132. Sinister Concierge (EDHREC 10460) - When the last is removed, they may cast it without paying its mana cost.
133. Primeval Spawn (EDHREC 10467) - You may cast any number of spells with total mana value 10 or less from among them without paying their mana costs.
134. Seifer Almasy (EDHREC 10574) - Fire Cross — Whenever Seifer Almasy deals combat damage to a player, you may cast target instant or sorcery card with mana value 3 or less from your graveyard without paying its mana cost. If that spell would be put into your graveyard, exile it instead.
135. Leaf-Crowned Elder (EDHREC 10627) - Kinship — At the beginning of your upkeep, you may look at the top card of your library. If it shares a creature type with this creature, you may reveal it. If you do, you may play that card without paying its mana cost.
136. Aloy, Savior of Meridian (EDHREC 10667) - In You, All Things Are Possible — Whenever one or more artifact creatures you control attack, discover X, where X is the greatest power among them. (Exile cards from the top of your library until you exile a nonland card with that mana value or less. Cast it without paying its mana cost or put it into your hand. Put the rest on the bottom in a random order.)
137. Treasure Keeper (EDHREC 10707) - You may cast that card without paying its mana cost.
138. Spellweaver Helix (EDHREC 11020) - If you do, you may cast the copy without paying its mana cost.
139. Intet, the Dreamer (EDHREC 11162) - You may play that card without paying its mana cost for as long as Intet remains on the battlefield.
140. Herald of Amity (EDHREC 11186) - You may cast an Aura spell from among them without paying its mana cost.
141. Shiko, Paragon of the Way (EDHREC 11198) - Copy it, then you may cast the copy without paying its mana cost.
142. Magar of the Magic Strings (EDHREC 11200) - {1}{B}{R}: Note the name of target instant or sorcery card in your graveyard and put it onto the battlefield face down. It's a 3/3 creature with "Whenever this creature deals combat damage to a player, you may create a copy of the card with the noted name. You may cast the copy without paying its mana cost" and "If this creature would leave the battlefield, exile it instead of putting it anywhere else."
143. Massacre (EDHREC 11319) - If an opponent controls a Plains and you control a Swamp, you may cast this spell without paying its mana cost.
144. Master of Predicaments (EDHREC 11401) - If the player guessed wrong, you may cast the card without paying its mana cost.
145. Mindclaw Shaman (EDHREC 11406) - You may cast an instant or sorcery spell from among those cards without paying its mana cost.
146. Eye of the Storm (EDHREC 11531) - For each copy, the player may cast the copy without paying its mana cost.
147. Daring Discovery (EDHREC 11548) - Cast it without paying its mana cost or put it into your hand.
148. Codie, Vociferous Codex (EDHREC 11600) - {4}, {T}: Add {W}{U}{B}{R}{G}. When you next cast a spell this turn, exile cards from the top of your library until you exile an instant or sorcery card with lesser mana value. Until end of turn, you may cast that card without paying its mana cost. Put each other card exiled this way on the bottom of your library in a random order.
149. Doom's Time Platform (EDHREC 11621) - When the last is removed, you may cast it without paying its mana cost.
150. Guile (EDHREC 11635) - If a spell or ability you control would counter a spell, instead exile that spell and you may play that card without paying its mana cost.
151. Saruman of Many Colors (EDHREC 11672) - You may cast the copy without paying its mana cost.
152. Caparocti Sunborn (EDHREC 12042) - Cast it without paying its mana cost or put it into your hand.
153. Abstract Performance (EDHREC 12137) - You may cast a spell from among them without paying its mana cost.
154. Doom Reigns Supreme (EDHREC 12218) - You may cast up to two spells from among the exiled cards without paying their mana costs.
155. Glorious Purpose (EDHREC 12327) - You may cast any number of spells from among them without paying their mana costs.
156. Judoon Enforcers (EDHREC 12342) - When the last is removed, you may cast it without paying its mana cost.
157. Brilliant Ultimatum (EDHREC 12351) - If you cast a spell this way, you cast it without paying its mana cost.
158. Spectral Arcanist (EDHREC 12431) - When this creature enters, you may cast an instant or sorcery spell with mana value less than or equal to the number of Spirits you control from a graveyard without paying its mana cost.
159. Walk with the Ancestors (EDHREC 12512) - Cast it without paying its mana cost or put it into your hand.
160. Ryan Sinclair (EDHREC 12537) - You may cast the exiled card without paying its mana cost if it's a spell with mana value less than or equal to Ryan's power.
161. Knowledge Exploitation (EDHREC 12586) - You may cast that card without paying its mana cost.
162. Rift Sower (EDHREC 12727) - When the last is removed, you may cast it without paying its mana cost.
163. Duelist's Flame (EDHREC 12946) - You may cast the exiled card without paying its mana cost."
164. Alaundo the Seer (EDHREC 12956) - {T}: Draw a card, then exile a card from your hand and put a number of time counters on it equal to its mana value. It gains "When the last time counter is removed from this card, if it's exiled, you may cast it without paying its mana cost. If you cast a creature spell this way, it gains haste until end of turn." Then remove a time counter from each other card you own in exile.
165. Galvanoth (EDHREC 12973) - You may cast it without paying its mana cost if it's an instant or sorcery spell.
166. Krang & Shredder (EDHREC 13019) - Disappear — At the beginning of your end step, if a permanent left the battlefield under your control this turn, you may cast a card exiled with Krang & Shredder without paying its mana cost.
167. Scarlet Witch, Chaotic Avenger (EDHREC 13053) - Then you may cast a Hero or noncreature spell from among cards exiled with Scarlet Witch without paying its mana cost.
168. Geological Appraiser (EDHREC 13061) - Cast it without paying its mana cost or put it into your hand.
169. Vadrok, Apex of Thunder (EDHREC 13235) - Whenever this creature mutates, you may cast target noncreature card with mana value 3 or less from your graveyard without paying its mana cost.
170. Baron Helmut Zemo (EDHREC 13412) - Boast — Exile any number of black cards from your graveyard with fifteen or more black mana symbols among their mana costs: Copy those exiled cards. You may cast up to three of the copies without paying their mana costs. (Activate only if this creature attacked this turn and only once each turn.)
171. Chancellor of the Spires (EDHREC 13757) - When this creature enters, you may cast target instant or sorcery card from an opponent's graveyard without paying its mana cost.
172. Epistolary Librarian (EDHREC 13843) - Veil of Time — Whenever this creature attacks, you may cast a spell with mana value X or less from your hand without paying its mana cost, where X is the number of attacking creatures.
173. Jeleva, Nephalia's Scourge (EDHREC 14145) - Whenever Jeleva attacks, you may cast an instant or sorcery spell from among cards exiled with Jeleva without paying its mana cost.
174. Storm of Memories (EDHREC 14147) - Exile an instant or sorcery card with mana value 3 or less from your graveyard at random. You may cast it without paying its mana cost. If that spell would be put into a graveyard, exile it instead.
175. Swashbuckler's Whip (EDHREC 14182) - Cast it without paying its mana cost or put it into your hand.
176. Nico Minoru, Runaway (EDHREC 14230) - {2}{R}, {T}, Discard a card: Exile cards from the top of your library until you exile a nonland card. You may cast that card without paying its mana cost.
177. Fires of Invention (EDHREC 14247) - You may cast spells with mana value less than or equal to the number of lands you control without paying their mana costs.
178. Ellie and Alan, Paleontologists (EDHREC 14372) - {T}, Exile a creature card from your graveyard: Discover X, where X is the mana value of the exiled card. Activate only as a sorcery. (Exile cards from the top of your library until you exile a nonland card with that mana value or less. Cast it without paying its mana cost or put it into your hand. Put the rest on the bottom in a random order.)
179. Jace's Mindseeker (EDHREC 14526) - You may cast an instant or sorcery spell from among them without paying its mana cost.
180. Weftwalking (EDHREC 14612) - The first spell each player casts during each of their turns may be cast without paying its mana cost.
181. Capricious Hellraiser (EDHREC 14620) - You may cast the copy without paying its mana cost.
182. Renegade Bull (EDHREC 14662) - You may cast the copy without paying its mana cost.
183. Plan the Heist (EDHREC 14678) - Cast it as a sorcery on a later turn without paying its mana cost.
184. Spellbinder (EDHREC 15214) - If you do, you may cast the copy without paying its mana cost.
185. Efreet Flamepainter (EDHREC 15246) - Whenever this creature deals combat damage to a player, you may cast target instant or sorcery card from your graveyard without paying its mana cost.
186. Wiretapping (EDHREC 15262) - Then if you have nine or more cards in hand, you may play the exiled card without paying its mana cost.
187. Atraxi Warden (EDHREC 15315) - When the last is removed, you may cast it without paying its mana cost.
188. Nihilith (EDHREC 15414) - When the last is removed, you may cast it without paying its mana cost.
189. Synthesis Pod (EDHREC 15515) - {1}{U/P}, {T}, Exile a spell you control: Target opponent reveals cards from the top of their library until they reveal a card with mana value equal to 1 plus the exiled spell's mana value. Exile that card, then that player shuffles. You may cast that exiled card without paying its mana cost.
190. Hurl into History (EDHREC 15610) - Cast it without paying its mana cost or put it into your hand.
191. Qasali Ambusher (EDHREC 16004) - If a creature is attacking you and you control a Forest and a Plains, you may cast this creature without paying its mana cost and as though it had flash.
192. Shelldock Isle (EDHREC 16035) - {U}, {T}: You may play the exiled card without paying its mana cost if a library has twenty or fewer cards in it.
193. Arcane Proxy (EDHREC 16128) - You may cast the copy without paying its mana cost.
194. West Coast Expansion (EDHREC 16135) - If X is 5 or more, you may cast a Hero spell from your hand without paying its mana cost.
195. Franklin Richards, Ascendant (EDHREC 16277) - Cast it without paying its mana cost or put it into your hand.
196. Aisha of Sparks and Smoke (EDHREC 16292) - Whenever Aisha deals combat damage, you may cast a sorcery spell from your hand with mana value less than or equal to that damage without paying its mana cost.
197. Kang Prime (EDHREC 16300) - When the last is removed, you may cast it without paying its mana cost.
198. Counterlash (EDHREC 16494) - You may cast a spell that shares a card type with it from your hand without paying its mana cost.
199. Spelljack (EDHREC 16695) - You may play it without paying its mana cost for as long as it remains exiled.
200. Wanda's Vision (EDHREC 16754) - You may cast that card without paying its mana cost.

### 18. Modal Choices

Source: corpus-mined follow-on seam
Available after current queue exclusion: 231

1. Jeska's Will (EDHREC 103) - Choose one. If you control a commander as you cast this spell, you may choose both instead. / • Add {R} for each card in target opponent's hand. / • Exile the top three cards of your library. You may play them this turn.
2. Farewell (EDHREC 167) - Choose one or more — / • Exile all artifacts. / • Exile all creatures. / • Exile all enchantments. / • Exile all graveyards.
3. Austere Command (EDHREC 168) - Choose two — / • Destroy all artifacts. / • Destroy all enchantments. / • Destroy all creatures with mana value 3 or less. / • Destroy all creatures with mana value 4 or greater.
4. Akroma's Will (EDHREC 189) - Choose one. If you control a commander as you cast this spell, you may choose both instead. / • Creatures you control gain flying, vigilance, and double strike until end of turn. / • Creatures you control gain lifelink, indestructible, and protection from each color until end of turn.
5. Sheoldred's Edict (EDHREC 1151) - Choose one — / • Each opponent sacrifices a nontoken creature of their choice. / • Each opponent sacrifices a creature token of their choice. / • Each opponent sacrifices a planeswalker of their choice.
6. Cleansing Nova (EDHREC 1262) - Choose one — / • Destroy all creatures. / • Destroy all artifacts and enchantments.
7. Heliod's Intervention (EDHREC 1465) - Choose one — / • Destroy X target artifacts and/or enchantments. / • Target player gains twice X life.
8. Crux of Fate (EDHREC 1567) - Choose one — / • Destroy all Dragon creatures. / • Destroy all non-Dragon creatures.
9. Split Up (EDHREC 2017) - Choose one — / • Destroy all tapped creatures. / • Destroy all untapped creatures.
10. Dawn Charm (EDHREC 2087) - Choose one — / • Prevent all combat damage that would be dealt this turn. / • Regenerate target creature. / • Counter target spell that targets you.
11. Perplexing Test (EDHREC 2091) - Choose one — / • Return all creature tokens to their owners' hands. / • Return all nontoken creatures to their owners' hands.
12. Twinferno (EDHREC 2581) - Choose one — / • When you cast your next instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy. / • Target creature you control gains double strike until end of turn. (It deals both first-strike and regular combat damage.)
13. Simic Charm (EDHREC 2837) - Choose one — / • Target creature gets +3/+3 until end of turn. / • Permanents you control gain hexproof until end of turn. / • Return target creature to its owner's hand.
14. Savage Beating (EDHREC 2939) - Choose one — / • Creatures you control gain double strike until end of turn. / • Untap all creatures you control. After this phase, there is an additional combat phase.
15. Merciless Eviction (EDHREC 3049) - Choose one — / • Exile all artifacts. / • Exile all creatures. / • Exile all enchantments. / • Exile all planeswalkers.
16. Pick Your Poison (EDHREC 3231) - Choose one — / • Each opponent sacrifices an artifact of their choice. / • Each opponent sacrifices an enchantment of their choice. / • Each opponent sacrifices a creature with flying of their choice.
17. See Double (EDHREC 3353) - Choose one. If an opponent has eight or more cards in their graveyard, you may choose both instead. / • Copy target spell. You may choose new targets for the copy. (A copy of a permanent spell becomes a token.) / • Create a token that's a copy of target creature.
18. Mob Rule (EDHREC 3367) - Choose one — / • Gain control of all creatures with power 4 or greater until end of turn. Untap those creatures. They gain haste until end of turn. / • Gain control of all creatures with power 3 or less until end of turn. Untap those creatures. They gain haste until end of turn.
19. Final Act (EDHREC 3765) - Choose one or more — / • Destroy all creatures. / • Destroy all planeswalkers. / • Destroy all battles. / • Exile all graveyards. / • Each opponent loses all counters.
20. Crush Contraband (EDHREC 4232) - Choose one or both — / • Exile target artifact. / • Exile target enchantment.
21. Amazing Acrobatics (EDHREC 4442) - Choose one or both — / • Counter target spell. / • Tap one or two target creatures.
22. Profane Command (EDHREC 4920) - Choose two — / • Target player loses X life. / • Return target creature card with mana value X or less from your graveyard to the battlefield. / • Target creature gets -X/-X until end of turn. / • Up to X target creatures gain fear until end of turn. (They can't be blocked except by artifact creatures and/or black creatures.)
23. Reverse the Polarity (EDHREC 4993) - Choose one — / • Counter all other spells. / • Switch each creature's power and toughness until end of turn. / • Creatures can't be blocked this turn.
24. Witherbloom Charm (EDHREC 5503) - Choose one — / • You may sacrifice a permanent. If you do, draw two cards. / • You gain 5 life. / • Destroy target nonland permanent with mana value 2 or less.
25. Opera Love Song (EDHREC 5530) - Choose one — / • Exile the top two cards of your library. You may play those cards until your next end step. / • One or two target creatures each get +2/+0 until end of turn.
26. Get Out (EDHREC 5926) - Choose one — / • Counter target creature or enchantment spell. / • Return one or two target creatures and/or enchantments you own to your hand.
27. Prismari Charm (EDHREC 6166) - Choose one — / • Surveil 2, then draw a card. / • Prismari Charm deals 1 damage to each of one or two targets. / • Return target nonland permanent to its owner's hand.
28. Defabricate (EDHREC 6345) - Choose one — / • Counter target artifact or enchantment spell. If that spell is countered this way, exile it instead of putting it into its owner's graveyard. / • Counter target activated or triggered ability.
29. Thassa's Intervention (EDHREC 7119) - Choose one — / • Look at the top X cards of your library. Put up to two of them into your hand and the rest on the bottom of your library in a random order. / • Counter target spell unless its controller pays twice {X}.
30. Riveteers Charm (EDHREC 7126) - Choose one — / • Target opponent sacrifices a creature or planeswalker they control with the greatest mana value among creatures and planeswalkers they control. / • Exile the top three cards of your library. Until your next end step, you may play those cards. / • Exile target player's graveyard.
31. Temur Charm (EDHREC 7248) - Choose one — / • Target creature you control gets +1/+1 until end of turn. It fights target creature you don't control. / • Counter target spell unless its controller pays {3}. / • Creatures with power 3 or less can't block this turn.
32. Lorehold Charm (EDHREC 7432) - Choose one — / • Each opponent sacrifices a nontoken artifact of their choice. / • Return target artifact or creature card with mana value 2 or less from your graveyard to the battlefield. / • Creatures you control get +1/+1 and gain trample until end of turn.
33. Blood on the Snow (EDHREC 7571) - Choose one — / • Destroy all creatures. / • Destroy all planeswalkers.
34. You See a Guard Approach (EDHREC 7587) - Choose one — / • Distract the Guard — Tap target creature. / • Hide — Target creature you control gains hexproof until end of turn. (It can't be the target of spells or abilities your opponents control.)
35. Confounding Riddle (EDHREC 7603) - Choose one — / • Look at the top four cards of your library. Put one of them into your hand and the rest into your graveyard. / • Counter target spell unless its controller pays {4}.
36. You Come to a River (EDHREC 8011) - Choose one — / • Fight the Current — Return target nonland permanent to its owner's hand. / • Find a Crossing — Target creature gets +1/+0 until end of turn and can't be blocked this turn.
37. You Look Upon the Tarrasque (EDHREC 8061) - Choose one — / • Run and Hide — Prevent all combat damage that would be dealt to you and creatures you control this turn. / • Gather Your Courage — Target creature gets +5/+5 and gains indestructible until end of turn. All creatures your opponents control able to block that creature this turn do so.
38. Soul Manipulation (EDHREC 8109) - Choose one or both — / • Counter target creature spell. / • Return target creature card from your graveyard to your hand.
39. Quandrix Charm (EDHREC 8400) - Choose one — / • Counter target spell unless its controller pays {2}. / • Destroy target enchantment. / • Target creature has base power and toughness 5/5 until end of turn.
40. Insidious Will (EDHREC 8558) - Choose one — / • Counter target spell. / • You may choose new targets for target spell. / • Copy target instant or sorcery spell. You may choose new targets for the copy.
41. Sakashima's Will (EDHREC 8677) - Choose one. If you control a commander as you cast this spell, you may choose both instead. / • Target opponent chooses a creature they control. You gain control of it. / • Choose a creature you control. Each other creature you control becomes a copy of that creature until end of turn.
42. Supreme Will (EDHREC 8734) - Choose one — / • Counter target spell unless its controller pays {3}. / • Look at the top four cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.
43. Raise the Draugr (EDHREC 8744) - Choose one — / • Return target creature card from your graveyard to your hand. / • Return two target creature cards that share a creature type from your graveyard to your hand.
44. Unbury (EDHREC 8912) - Choose one — / • Return target creature card from your graveyard to your hand. / • Return two target creature cards that share a creature type from your graveyard to your hand.
45. Urza's Rebuff (EDHREC 9253) - Choose one — / • Counter target spell. / • Tap up to two target creatures.
46. Twist Reality (EDHREC 9260) - Choose one — / • Counter target spell. / • Manifest dread. (Look at the top two cards of your library. Put one onto the battlefield face down as a 2/2 creature and the other into your graveyard. Turn it face up any time for its mana cost if it's a creature card.)
47. Dream's Grip (EDHREC 9324) - Choose one — / • Tap target permanent. / • Untap target permanent.
48. Heroes' Hangout (EDHREC 9644) - Choose one — / • Date Night — Exile the top two cards of your library. Choose one of them. Until the end of your next turn, you may play that card. / • Patrol Night — One or two target creatures each get +1/+0 and gain first strike until end of turn.
49. Against All Odds (EDHREC 9696) - Choose one or both — / • Exile target artifact or creature you control, then return it to the battlefield under its owner's control. / • Return target artifact or creature card with mana value 3 or less from your graveyard to the battlefield.
50. Rude Awakening (EDHREC 9812) - Choose one — / • Untap all lands you control. / • Until end of turn, lands you control become 2/2 creatures that are still lands.
51. Break Down the Door (EDHREC 9843) - Choose one — / • Exile target artifact. / • Exile target enchantment. / • Manifest dread. (Look at the top two cards of your library. Put one onto the battlefield face down as a 2/2 creature and the other into your graveyard. Turn it face up any time for its mana cost if it's a creature card.)
52. Brokers Confluence (EDHREC 9844) - Choose three. You may choose the same mode more than once. / • Proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.) / • Target creature phases out. (Treat it and anything attached to it as though they don't exist until its controller's next turn.) / • Counter target activated or triggered ability.
53. Trickery Charm (EDHREC 9877) - Choose one — / • Target creature gains flying until end of turn. / • Target creature becomes the creature type of your choice until end of turn. / • Look at the top four cards of your library, then put them back in any order.
54. Invigorated Rampage (EDHREC 9958) - Choose one — / • Target creature gets +4/+0 and gains trample until end of turn. / • Two target creatures each get +2/+0 and gain trample until end of turn.
55. March of the Drowned (EDHREC 10140) - Choose one — / • Return target creature card from your graveyard to your hand. / • Return two target Pirate cards from your graveyard to your hand.
56. Fight as One (EDHREC 10265) - Choose one or both — / • Target Human creature you control gets +1/+1 and gains indestructible until end of turn. / • Target non-Human creature you control gets +1/+1 and gains indestructible until end of turn.
57. Nightmare Unmaking (EDHREC 10413) - Choose one — / • Exile each creature with power greater than the number of cards in your hand. / • Exile each creature with power less than the number of cards in your hand.
58. Road of Return (EDHREC 10575) - Choose one — / • Return target permanent card from your graveyard to your hand. / • Put your commander into your hand from the command zone.
59. Secret Identity (EDHREC 10951) - Choose one — / • Conceal — Until end of turn, target creature you control becomes a Citizen with base power and toughness 1/1 and gains hexproof. / • Reveal — Until end of turn, target creature you control becomes a Hero with base power and toughness 3/4 and gains flying and vigilance.
60. Reality Spasm (EDHREC 10962) - Choose one — / • Tap X target permanents. / • Untap X target permanents.
61. Steal the Show (EDHREC 11502) - Choose one or both — / • Target player discards any number of cards, then draws that many cards. / • Steal the Show deals damage equal to the number of instant and sorcery cards in your graveyard to target creature or planeswalker.
62. Choreographed Sparks (EDHREC 11544) - Choose one or both — / • Copy target instant or sorcery spell you control. You may choose new targets for the copy. / • Copy target creature spell you control. The copy gains haste and "At the beginning of the end step, sacrifice this token."
63. Seize Opportunity (EDHREC 11611) - Choose one — / • Exile the top two cards of your library. Until the end of your next turn, you may play those cards. / • Up to two target creatures each get +2/+1 until end of turn.
64. Return from Extinction (EDHREC 11642) - Choose one — / • Return target creature card from your graveyard to your hand. / • Return two target creature cards that share a creature type from your graveyard to your hand.
65. Season of Renewal (EDHREC 11908) - Choose one or both — / • Return target creature card from your graveyard to your hand. / • Return target enchantment card from your graveyard to your hand.
66. Nexus Mentality (EDHREC 12001) - Choose one. If you control a commander as you cast this spell, you may choose both instead. / • Move all counters from target nonland permanent you control onto another target nonland permanent you control. / • Remove all counters from target nonland permanent you control. Draw a card for each counter removed this way.
67. Gravedig (EDHREC 12002) - Choose one — / • Target player creates a 2/2 black Zombie creature token. / • Return target creature card from your graveyard to your hand.
68. Aid the Fallen (EDHREC 12039) - Choose one or both — / • Return target creature card from your graveyard to your hand. / • Return target planeswalker card from your graveyard to your hand.
69. Family Reunion (EDHREC 12171) - Choose one — / • Creatures you control get +1/+1 until end of turn. / • Creatures you control gain hexproof until end of turn. (They can't be the targets of spells or abilities your opponents control.)
70. Splatter Technique (EDHREC 12211) - Choose one — / • Draw four cards. / • Splatter Technique deals 4 damage to each creature and planeswalker.
71. Silverquill Charm (EDHREC 12257) - Choose one — / • Put two +1/+1 counters on target creature. / • Exile target creature with power 2 or less. / • Each opponent loses 3 life and you gain 3 life.
72. Crisis of Conscience (EDHREC 12270) - Choose one — / • Destroy all tokens. / • Destroy all nonland, nontoken permanents.
73. Epic Fight (EDHREC 12717) - Choose one or both — / • Double target creature's power and toughness until end of turn. / • Target creature you control fights target creature an opponent controls.
74. Fortuitous Find (EDHREC 12725) - Choose one or both — / • Return target artifact card from your graveyard to your hand. / • Return target creature card from your graveyard to your hand.
75. Bloodline Culling (EDHREC 12783) - Choose one — / • Target creature gets -5/-5 until end of turn. / • Creature tokens get -2/-2 until end of turn.
76. Moment of Reckoning (EDHREC 12784) - Choose up to four. You may choose the same mode more than once. / • Destroy target nonland permanent. / • Return target nonland permanent card from your graveyard to the battlefield.
77. Soul Transfer (EDHREC 12821) - Choose one. If you control an artifact and an enchantment as you cast this spell, you may choose both instead. / • Exile target creature or planeswalker. / • Return target creature or planeswalker card from your graveyard to your hand.
78. Open the Omenpaths (EDHREC 13074) - Choose one — / • Add two mana of any one color and two mana of any other color. Spend this mana only to cast creature or enchantment spells. / • Creatures you control get +1/+0 until end of turn.
79. HULK SMASH! (EDHREC 13088) - Choose one. If this spell was cast using teamwork, choose both instead. / • Destroy target noncreature artifact. / • Target creature you control deals damage equal to its power to target creature an opponent controls.
80. Poison the Waters (EDHREC 13154) - Choose one — / • All creatures get -1/-1 until end of turn. / • Target player reveals their hand. You choose an artifact or creature card from it. That player discards that card.
81. Borrowed Hostility (EDHREC 13175) - Choose one or both — / • Target creature gets +3/+0 until end of turn. / • Target creature gains first strike until end of turn.
82. School Daze (EDHREC 13278) - Choose one — / • Do Homework — Draw three cards. / • Fight Crime — Counter target spell. Draw a card.
83. Ghoulcaller's Chant (EDHREC 13396) - Choose one — / • Return target creature card from your graveyard to your hand. / • Return two target Zombie cards from your graveyard to your hand.
84. Pharika's Libation (EDHREC 13440) - Choose one — / • Target opponent sacrifices a creature of their choice. / • Target opponent sacrifices an enchantment of their choice.
85. Command Performance (EDHREC 13446) - Choose two — / • Open an Attraction. (Put the top card of your Attraction deck onto the battlefield.) / • Roll to visit your Attractions. / • You get {TK}{TK}. / • You may put a sticker on a nonland permanent you own.
86. Borrowed Knowledge (EDHREC 13616) - Choose one — / • Discard your hand, then draw cards equal to the number of cards in target opponent's hand. / • Discard your hand, then draw cards equal to the number of cards discarded this way.
87. Change the Equation (EDHREC 14061) - Choose one — / • Counter target spell with mana value 2 or less. / • Counter target red or green spell with mana value 6 or less.
88. Rydia's Return (EDHREC 14162) - Choose one — / • Creatures you control get +3/+3 until end of turn. / • Return up to two target permanent cards from your graveyard to your hand.
89. Seeker's Folly (EDHREC 14267) - Choose one — / • Target opponent discards two cards. / • Creatures your opponents control get -1/-1 until end of turn.
90. Wail of War (EDHREC 14336) - Choose one — / • Creatures target opponent controls get -1/-1 until end of turn. / • Return up to two target creature cards from your graveyard to your hand.
91. Inscription of Insight (EDHREC 14411) - Choose one. If this spell was kicked, choose any number instead. / • Return up to two target creatures to their owners' hands. / • Scry 2, then draw two cards. / • Target player creates an X/X blue Illusion creature token, where X is the number of cards in their hand.
92. Extract the Truth (EDHREC 14780) - Choose one — / • Target opponent reveals their hand. You may choose a creature, enchantment, or planeswalker card from it. That player discards that card. / • Target opponent sacrifices an enchantment of their choice.
93. Angrath's Rampage (EDHREC 14802) - Choose one — / • Target player sacrifices an artifact of their choice. / • Target player sacrifices a creature of their choice. / • Target player sacrifices a planeswalker of their choice.
94. You Meet in a Tavern (EDHREC 14887) - Choose one — / • Form a Party — Look at the top five cards of your library. You may reveal any number of creature cards from among them and put them into your hand. Put the rest on the bottom of your library in a random order. / • Start a Brawl — Creatures you control get +2/+2 until end of turn.
95. Call Damage Control (EDHREC 14905) - Choose up to two. Return those cards from your graveyard to your hand. / • Target artifact card. / • Target creature card. / • Target enchantment card. / • Target land card.
96. Maestros Confluence (EDHREC 14945) - Choose three. You may choose the same mode more than once. / • Return target monocolored instant or sorcery card from your graveyard to your hand. / • Target creature gets -3/-3 until end of turn. / • Goad each creature target player controls. (Until your next turn, those creatures attack each combat if able and attack a player other than you if able.)
97. Early Winter (EDHREC 15047) - Choose one — / • Exile target creature. / • Target opponent exiles an enchantment they control.
98. Debt to the Kami (EDHREC 15260) - Choose one — / • Target opponent exiles a creature they control. / • Target opponent exiles an enchantment they control.
99. Wild Shape (EDHREC 15261) - Choose one. Until end of turn, target creature you control has that base power and toughness, becomes that creature type, and gains that ability. / • 1/3 Turtle with hexproof. / • 1/5 Spider with reach. / • 3/3 Elephant with trample.
100. Glorious Decay (EDHREC 15336) - Choose one — / • Destroy target artifact. / • Glorious Decay deals 4 damage to target creature with flying. / • Exile target card from a graveyard. Draw a card.
101. Grim Discovery (EDHREC 15558) - Choose one or both — / • Return target creature card from your graveyard to your hand. / • Return target land card from your graveyard to your hand.
102. Go Nuts! (EDHREC 15589) - Choose one. If this spell was cast using teamwork, choose both instead. / • Put a +1/+1 counter on target creature. / • Target creature you control fights target creature an opponent controls.
103. Sapphire Charm (EDHREC 15606) - Choose one — / • Target player draws a card at the beginning of the next turn's upkeep. / • Target creature gains flying until end of turn. / • Target creature an opponent controls phases out. (While it's phased out, it's treated as though it doesn't exist. It phases in before its controller untaps during their next untap step.)
104. Auntie's Sentence (EDHREC 15686) - Choose one — / • Target opponent reveals their hand. You choose a nonland permanent card from it. That player discards that card. / • Target creature gets -2/-2 until end of turn.
105. Soul Read (EDHREC 15733) - Choose one — / • Counter target spell unless its controller pays {4}. / • Draw two cards.
106. Shredder's Revenge (EDHREC 15853) - Choose one — / • Target player discards two cards. / • Target player draws two cards and loses 2 life.
107. You're Confronted by Robbers (EDHREC 15937) - Choose one — / • Stall for Time — Tap up to three target creatures. / • Call for Aid — Create three 1/1 white Soldier creature tokens.
108. Dust of Moments (EDHREC 16033) - Choose one — / • Remove two time counters from each permanent and each suspended card. / • Put two time counters on each permanent with a time counter on it and each suspended card.
109. Remember the Fallen (EDHREC 16124) - Choose one or both — / • Return target creature card from your graveyard to your hand. / • Return target artifact card from your graveyard to your hand.
110. Settle Beyond Reality (EDHREC 16134) - Choose one or both — / • Exile target creature you don't control. / • Exile target creature you control, then return it to the battlefield under its owner's control.
111. Expose the Culprit (EDHREC 16152) - Choose one or both — / • Turn target face-down creature face up. / • Exile any number of face-up creatures you control with disguise in a face-down pile, shuffle that pile, then cloak them. (To cloak a card, put it onto the battlefield face down as a 2/2 creature with ward {2}. Turn it face up any time for its mana cost if it's a creature card.)
112. Grixis Charm (EDHREC 16227) - Choose one — / • Return target permanent to its owner's hand. / • Target creature gets -4/-4 until end of turn. / • Creatures you control get +2/+0 until end of turn.
113. Sygg's Command (EDHREC 16503) - Choose two — / • Create a token that's a copy of target Merfolk you control. / • Creatures target player controls gain lifelink until end of turn. / • Target player draws a card. / • Tap target creature. Put a stun counter on it.
114. Methods of the Mighty (EDHREC 16600) - Choose one or more — / • Destroy target artifact. / • Destroy target tapped creature. / • Put a +1/+1 counter on each creature you control.
115. Aether Shockwave (EDHREC 16630) - Choose one — / • Tap all Spirits. / • Tap all non-Spirit creatures.
116. Storyweave (EDHREC 16637) - Choose one — / • Put two +1/+1 counters on target creature you control. / • Put two lore counters on target Saga you control. The next time one or more enchantment creatures you control enter this turn, each enters with two additional +1/+1 counters on it.
117. Brigid's Command (EDHREC 16702) - Choose two — / • Create a token that's a copy of target Kithkin you control. / • Target player creates a 1/1 green and white Kithkin creature token. / • Target creature you control gets +3/+3 until end of turn. / • Target creature you control fights target creature an opponent controls.
118. Avengers Disassembled (EDHREC 16959) - Choose one or both — / • Avengers Disassembled deals 3 damage to each creature. / • Destroy target land. Its controller may search their library for a basic land card, put it onto the battlefield tapped, then shuffle.
119. Blessed Alliance (EDHREC 17013) - Choose one or more — / • Target player gains 4 life. / • Untap up to two target creatures. / • Target opponent sacrifices an attacking creature of their choice.
120. Temporal Cascade (EDHREC 17059) - Choose one — / • Each player shuffles their hand and graveyard into their library. / • Each player draws seven cards.
121. Obscura Confluence (EDHREC 17211) - Choose three. You may choose the same mode more than once. / • Until end of turn, target creature loses all abilities and has base power and toughness 1/1. / • Target creature connives. (Draw a card, then discard a card. If you discarded a nonland card, put a +1/+1 counter on that creature.) / • Target player returns a creature card from their graveyard to their hand.
122. Cerebral Confiscation (EDHREC 17224) - Choose one — / • Target opponent discards two cards. / • Target opponent reveals their hand. You choose a nonland card from it. That player discards that card.
123. Applied Biomancy (EDHREC 17285) - Choose one or both — / • Target creature gets +1/+1 until end of turn. / • Return target creature to its owner's hand.
124. Fantastic Elasticity (EDHREC 17437) - Choose one — / • Return target nonland permanent to its owner's hand. / • Return target instant or sorcery card from your graveyard to your hand.
125. Go Ninja Go (EDHREC 17565) - Choose one or both — / • Exile target creature you control, then return it to the battlefield under its owner's control. / • Go Ninja Go deals damage equal to the greatest power among creatures you control to target creature an opponent controls.
126. You Come to the Gnoll Camp (EDHREC 17649) - Choose one — / • Intimidate Them — Up to two target creatures can't block this turn. / • Fend Them Off — Target creature gets +3/+1 until end of turn.
127. It's Clobberin' Time! (EDHREC 17746) - Choose one — / • Target creature you control deals damage equal to its power to target creature an opponent controls. / • Destroy target artifact or enchantment.
128. Karai's Technique (EDHREC 17852) - Choose one or both — / • Target creature gets +3/+3 until end of turn. / • Target creature gets -3/-3 until end of turn.
129. Funeral Charm (EDHREC 18034) - Choose one — / • Target player discards a card. / • Target creature gets +2/-1 until end of turn. / • Target creature gains swampwalk until end of turn. (It can't be blocked as long as defending player controls a Swamp.)
130. Riverwalk Technique (EDHREC 18046) - Choose one — / • The owner of target nonland permanent puts it on their choice of the top or bottom of their library. / • Counter target noncreature spell.
131. Artistic Process (EDHREC 18088) - Choose one — / • Artistic Process deals 6 damage to target creature. / • Artistic Process deals 2 damage to each creature you don't control. / • Create a 3/3 blue and red Elemental creature token with flying. It gains haste until end of turn.
132. Perfect Intimidation (EDHREC 18259) - Choose one or both — / • Target opponent exiles two cards from their hand. / • Remove all counters from target creature.
133. Confront the Past (EDHREC 18296) - Choose one — / • Return target planeswalker card with mana value X or less from your graveyard to the battlefield. / • Remove twice X loyalty counters from target planeswalker an opponent controls.
134. Repel the Vile (EDHREC 18519) - Choose one — / • Exile target creature with power 4 or greater. / • Exile target enchantment.
135. Graceful Restoration (EDHREC 18745) - Choose one — / • Return target creature card from your graveyard to the battlefield with an additional +1/+1 counter on it. / • Return up to two target creature cards with power 2 or less from your graveyard to the battlefield.
136. Murdock's Crusade (EDHREC 18759) - Choose one. If this spell was cast using teamwork, choose both instead. / • Street Justice — Exile target creature with toughness 4 or greater. / • Legal Justice — Exile target enchantment with mana value 4 or greater.
137. Reviving Melody (EDHREC 18859) - Choose one or both — / • Return target creature card from your graveyard to your hand. / • Return target enchantment card from your graveyard to your hand.
138. Piracy Charm (EDHREC 18943) - Choose one — / • Target creature gains islandwalk until end of turn. (It can't be blocked as long as defending player controls an Island.) / • Target creature gets +2/-1 until end of turn. / • Target player discards a card.
139. Buccaneer's Bravado (EDHREC 19123) - Choose one — / • Target creature gets +1/+1 and gains first strike until end of turn. / • Target Pirate gets +1/+1 and gains double strike until end of turn.
140. Spectral Shift (EDHREC 19339) - Choose one — / • Change the text of target spell or permanent by replacing all instances of one basic land type with another. (This effect lasts indefinitely.) / • Change the text of target spell or permanent by replacing all instances of one color word with another. (This effect lasts indefinitely.)
141. Survivors' Bond (EDHREC 19423) - Choose one or both — / • Return target Human creature card from your graveyard to your hand. / • Return target non-Human creature card from your graveyard to your hand.
142. Steel Sabotage (EDHREC 19588) - Choose one — / • Counter target artifact spell. / • Return target artifact to its owner's hand.
143. Solar Tide (EDHREC 19630) - Choose one — / • Destroy all creatures with power 2 or less. / • Destroy all creatures with power 3 or greater.
144. Seedling Charm (EDHREC 19643) - Choose one — / • Return target Aura attached to a creature to its owner's hand. / • Regenerate target green creature. / • Target creature gains trample until end of turn.
145. Decoy Ploy (EDHREC 19800) - Choose one or both — / • Return target Villain card from your graveyard to your hand. / • Return target Hero card from your graveyard to your hand.
146. Alley Evasion (EDHREC 19802) - Choose one — / • Target creature you control gets +1/+2 until end of turn. / • Return target creature you control to its owner's hand.
147. Subtle Strike (EDHREC 19832) - Choose one or both — / • Target creature gets -1/-1 until end of turn. / • Put a +1/+1 counter on target creature.
148. You're Ambushed on the Road (EDHREC 19834) - Choose one — / • Make a Retreat — Return target creature you control to its owner's hand. / • Stand and Fight — Target creature gets +1/+3 until end of turn.
149. Vision Charm (EDHREC 20551) - Choose one — / • Target player mills four cards. / • Choose a land type and a basic land type. Each land of the first chosen type becomes the second chosen type until end of turn. / • Target artifact phases out. (While it's phased out, it's treated as though it doesn't exist. It phases in before its controller untaps during their next untap step.)
150. Mishra's Onslaught (EDHREC 20805) - Choose one — / • Create two 1/1 colorless Soldier artifact creature tokens. / • Creatures you control get +2/+0 until end of turn.
151. Rise to Glory (EDHREC 21174) - Choose one or both — / • Return target creature card from your graveyard to the battlefield. / • Return target Aura card from your graveyard to the battlefield.
152. Vitality Charm (EDHREC 21585) - Choose one — / • Create a 1/1 green Insect creature token. / • Target creature gets +1/+1 and gains trample until end of turn. / • Regenerate target Beast.
153. Mouser Attack! (EDHREC 21708) - Choose one — / • Create a 1/1 colorless Robot artifact creature token. / • Target creature gets +3/+0 and gains first strike until end of turn.
154. One Dozen Eyes (EDHREC 21845) - Choose one — / • Create a 5/5 green Beast creature token. / • Create five 1/1 green Insect creature tokens.
155. Roar of the Kha (EDHREC 21863) - Choose one — / • Creatures you control get +1/+1 until end of turn. / • Untap all creatures you control.
156. Doomfall (EDHREC 22058) - Choose one — / • Target opponent exiles a creature they control. / • Target opponent reveals their hand. You choose a nonland card from it. Exile that card.
157. Consult the Necrosages (EDHREC 22094) - Choose one — / • Target player draws two cards. / • Target player discards two cards.
158. Healing Salve (EDHREC 22270) - Choose one — / • Target player gains 3 life. / • Prevent the next 3 damage that would be dealt to any target this turn.
159. Fortify (EDHREC 22298) - Choose one — / • Creatures you control get +2/+0 until end of turn. / • Creatures you control get +0/+2 until end of turn.
160. Confusticate and Bebother (EDHREC 22843) - Choose one — / • Counter target spell unless its controller pays {4}. / • Draw two cards, then discard a card.
161. Aim for the Head (EDHREC 22962) - Choose one — / • Exile target Zombie. / • Target opponent exiles two cards from their hand.
162. Abuna's Chant (EDHREC 22983) - Choose one — / • You gain 5 life. / • Prevent the next 5 damage that would be dealt to target creature this turn.
163. Umbral Juke (EDHREC 23271) - Choose one — / • Target player sacrifices a creature or planeswalker of their choice. / • Create a 2/1 white and black Inkling creature token with flying.
164. Fever Charm (EDHREC 23283) - Choose one — / • Target creature gains haste until end of turn. / • Target creature gets +2/+0 until end of turn. / • Fever Charm deals 3 damage to target Wizard creature.
165. Thorin's Last Stand (EDHREC 23358) - Choose one — / • Creatures you control get +2/+1 until end of turn. / • Destroy target artifact or enchantment. You gain 2 life.
166. Read the Tides (EDHREC 23395) - Choose one — / • Draw three cards. / • Return up to two target creatures to their owners' hands.
167. Brilliance Unleashed (EDHREC 23666) - Choose one or both — / • Brilliance Unleashed deals 5 damage to target creature. / • Choose target artifact card in your graveyard. Return it to the battlefield if it's an artifact creature card. Otherwise, return it to the battlefield and it's a 3/3 Robot artifact creature with flying.
168. Midnight Charm (EDHREC 23973) - Choose one — / • Midnight Charm deals 1 damage to target creature and you gain 1 life. / • Target creature gains first strike until end of turn. / • Tap target creature.
169. Stone by Sunlight (EDHREC 24107) - Choose one — / • Destroy target creature with power 4 or greater. / • Until end of turn, target creature becomes an artifact in addition to its other types and gains indestructible. (Damage and effects that say "destroy" don't destroy it.)
170. Widow's Bite (EDHREC 24346) - Choose one. If this spell was cast using teamwork, choose both instead. / • Target creature gains deathtouch until end of turn. / • Target creature gets -2/-2 until end of turn.
171. Ruthless Instincts (EDHREC 24488) - Choose one — / • Target nonattacking creature gains reach and deathtouch until end of turn. Untap it. / • Target attacking creature gets +2/+2 and gains trample until end of turn.
172. Atlantis Attacks (EDHREC 24552) - Choose one. If this spell was cast using teamwork, choose both instead. / • Target player creates a 6/5 blue Leviathan creature token with hexproof. / • Return one or two target nonland permanents to their owners' hands.
173. Branching Bolt (EDHREC 24616) - Choose one or both — / • Branching Bolt deals 3 damage to target creature with flying. / • Branching Bolt deals 3 damage to target creature without flying.
174. Academic Probation (EDHREC 24760) - Choose one — / • Choose a nonland card name. Opponents can't cast spells with the chosen name until your next turn. / • Choose target nonland permanent. Until your next turn, it can't attack or block, and its activated abilities can't be activated.
175. Artful Takedown (EDHREC 24780) - Choose one or both — / • Tap target creature. / • Target creature gets -2/-4 until end of turn.
176. Second Sight (EDHREC 24892) - Choose one — / • Look at the top five cards of target opponent's library, then put them back in any order. / • Look at the top five cards of your library, then put them back in any order.
177. Pestilent Haze (EDHREC 25054) - Choose one — / • All creatures get -2/-2 until end of turn. / • Remove two loyalty counters from each planeswalker.
178. Warg Tactics (EDHREC 25192) - Choose one — / • Destroy target creature with flying. / • Put a +1/+1 counter on target creature you control. It gains trample and hexproof until end of turn. (It can't be the target of spells or abilities your opponents control.)
179. Reverent Howl (EDHREC 25235) - Choose one — / • Target player draws two cards and loses 2 life. / • Target creature gets +2/+2 and gains lifelink until end of turn.
180. Run Ashore (EDHREC 25282) - Choose one or both — / • The owner of target nonland permanent puts it on their choice of the top or bottom of their library. / • Return target nonland permanent to its owner's hand.
181. Incite War (EDHREC 25315) - Choose one — / • Creatures target player controls attack this turn if able. / • Creatures you control gain first strike until end of turn.
182. Hurly-Burly (EDHREC 26175) - Choose one — / • Hurly-Burly deals 1 damage to each creature without flying. / • Hurly-Burly deals 1 damage to each creature with flying.
183. Pinecone Strike (EDHREC 26189) - Choose one or both — / • Pinecone Strike deals 3 damage to target creature. If that creature would die this turn, exile it instead. / • Destroy target artifact token.
184. Gnashing of Teeth (EDHREC 26247) - Choose one — / • Target creature gets -5/-5 until end of turn. If that creature would die this turn, exile it instead. / • Creatures target player controls get -1/-1 until end of turn.
185. Engineered Might (EDHREC 26419) - Choose one — / • Target creature gets +5/+5 and gains trample until end of turn. / • Creatures you control get +2/+2 and gain vigilance until end of turn.
186. Umezawa's Charm (EDHREC 26444) - Choose one — / • Target creature gets +2/+2 until end of turn. / • Target creature gets -1/-1 until end of turn. / • You gain 2 life.
187. Blinding Beam (EDHREC 26637) - Choose one — / • Tap two target creatures. / • Creatures don't untap during target player's next untap step.
188. Energy Bolt (EDHREC 26904) - Choose one — / • Energy Bolt deals X damage to target player or planeswalker. / • Target player gains X life.
189. Borrowed Grace (EDHREC 27069) - Choose one or both — / • Creatures you control get +2/+0 until end of turn. / • Creatures you control get +0/+2 until end of turn.
190. Shatter Assumptions (EDHREC 27234) - Choose one — / • Target opponent reveals their hand and discards all colorless nonland cards. / • Target opponent reveals their hand and discards all multicolored cards.
191. Borrowed Malevolence (EDHREC 27396) - Choose one or both — / • Target creature gets +1/+1 until end of turn. / • Target creature gets -1/-1 until end of turn.
192. Healing Leaves (EDHREC 27410) - Choose one — / • Target player gains 3 life. / • Prevent the next 3 damage that would be dealt to any target this turn.
193. Stir the Pride (EDHREC 27411) - Choose one — / • Creatures you control get +2/+2 until end of turn. / • Until end of turn, creatures you control gain "Whenever this creature deals damage, you gain that much life."
194. Take Down (EDHREC 27725) - Choose one — / • Take Down deals 4 damage to target creature with flying. / • Take Down deals 1 damage to each creature with flying.
195. Consuming Sinkhole (EDHREC 28074) - Choose one — / • Exile target land creature. / • Consuming Sinkhole deals 4 damage to target player or planeswalker.
196. Twisted Reflection (EDHREC 28102) - Choose one — / • Target creature gets -6/-0 until end of turn. / • Switch target creature's power and toughness until end of turn.
197. Ivory Charm (EDHREC 29524) - Choose one — / • All creatures get -2/-0 until end of turn. / • Tap target creature. / • Prevent the next 1 damage that would be dealt to any target this turn.
198. Swirling Torrent (EDHREC 30016) - Choose one or both — / • Put target creature on top of its owner's library. / • Return target creature to its owner's hand.
199. Parch (EDHREC 30502) - Choose one — / • Parch deals 2 damage to any target. / • Parch deals 4 damage to target blue creature.
200. Consuming Bonfire (EDHREC 30558) - Choose one — / • Consuming Bonfire deals 4 damage to target non-Elemental creature. / • Consuming Bonfire deals 7 damage to target Treefolk creature.

### 19. Reveal / Look At Top Library Cards

Source: corpus-mined follow-on seam
Available after current queue exclusion: 879

1. Path of Ancestry (EDHREC 14) - {T}: Add one mana of any color in your commander's color identity. When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1. (Look at the top card of your library. You may put that card on the bottom.)
2. Herald's Horn (EDHREC 148) - At the beginning of your upkeep, look at the top card of your library.
3. Mosswort Bridge (EDHREC 196) - Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)
4. Temple of Epiphany (EDHREC 284) - (Look at the top card of your library. You may put that card on the bottom.)
5. Temple of Silence (EDHREC 290) - (Look at the top card of your library. You may put that card on the bottom.)
6. Temple of Triumph (EDHREC 303) - (Look at the top card of your library. You may put that card on the bottom.)
7. Temple of Enlightenment (EDHREC 316) - (Look at the top card of your library. You may put that card on the bottom.)
8. Temple of Mystery (EDHREC 319) - (Look at the top card of your library. You may put that card on the bottom.)
9. Temple of Deceit (EDHREC 345) - (Look at the top card of your library. You may put that card on the bottom.)
10. Temple of Malady (EDHREC 354) - (Look at the top card of your library. You may put that card on the bottom.)
11. Mystic Forge (EDHREC 414) - You may look at the top card of your library any time.
12. Undercity Sewers (EDHREC 421) - (Look at the top card of your library. You may put it into your graveyard.)
13. Thassa's Oracle (EDHREC 430) - When this creature enters, look at the top X cards of your library, where X is your devotion to blue.
14. Temple of Malice (EDHREC 438) - (Look at the top card of your library. You may put that card on the bottom.)
15. Underground Mortuary (EDHREC 474) - (Look at the top card of your library. You may put it into your graveyard.)
16. Temple of Plenty (EDHREC 492) - (Look at the top card of your library. You may put that card on the bottom.)
17. Temple of Abandon (EDHREC 516) - (Look at the top card of your library. You may put that card on the bottom.)
18. Hedge Maze (EDHREC 547) - (Look at the top card of your library. You may put it into your graveyard.)
19. Raucous Theater (EDHREC 566) - (Look at the top card of your library. You may put it into your graveyard.)
20. Shadowy Backstreet (EDHREC 574) - (Look at the top card of your library. You may put it into your graveyard.)
21. Realmwalker (EDHREC 606) - You may look at the top card of your library any time.
22. Dig Through Time (EDHREC 621) - Look at the top seven cards of your library.
23. Thundering Falls (EDHREC 623) - (Look at the top card of your library. You may put it into your graveyard.)
24. Commercial District (EDHREC 651) - (Look at the top card of your library. You may put it into your graveyard.)
25. Windbrisk Heights (EDHREC 657) - Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)
26. Fact or Fiction (EDHREC 694) - Reveal the top five cards of your library.
27. Meticulous Archive (EDHREC 695) - (Look at the top card of your library. You may put it into your graveyard.)
28. Lush Portico (EDHREC 725) - (Look at the top card of your library. You may put it into your graveyard.)
29. Aqueous Form (EDHREC 743) - (Look at the top card of your library. You may put that card on the bottom.)
30. Spinerock Knoll (EDHREC 763) - Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)
31. Elegant Parlor (EDHREC 770) - (Look at the top card of your library. You may put it into your graveyard.)
32. Expressive Iteration (EDHREC 881) - Look at the top three cards of your library.
33. Loot, Exuberant Explorer (EDHREC 915) - {4}{G}{G}, {T}: Look at the top six cards of your library. You may reveal a creature card with mana value less than or equal to the number of lands you control from among them and put it onto the battlefield. Put the rest on the bottom in a random order.
34. Narset, Parter of Veils (EDHREC 940) - −2: Look at the top four cards of your library.
35. The Reality Chip (EDHREC 1048) - You may look at the top card of your library any time.
36. Augur of Autumn (EDHREC 1129) - You may look at the top card of your library any time.
37. Halimar Depths (EDHREC 1291) - When this land enters, look at the top three cards of your library, then put them back in any order.
38. Experimental Augury (EDHREC 1314) - Look at the top three cards of your library.
39. Coiling Oracle (EDHREC 1321) - When this creature enters, reveal the top card of your library.
40. Grisly Salvage (EDHREC 1344) - Reveal the top five cards of your library.
41. Kinnan, Bonder Prodigy (EDHREC 1355) - {5}{G}{U}: Look at the top five cards of your library. You may put a non-Human creature card from among them onto the battlefield. Put the rest on the bottom of your library in a random order.
42. Genesis Wave (EDHREC 1374) - Reveal the top X cards of your library.
43. Elven Chorus (EDHREC 1382) - You may look at the top card of your library any time.
44. Stock Up (EDHREC 1414) - Look at the top five cards of your library.
45. Case of the Locked Hothouse (EDHREC 1441) - Solved — You may look at the top card of your library any time, and you may play lands and cast creature and enchantment spells from the top of your library.
46. Planar Genesis (EDHREC 1467) - Look at the top four cards of your library.
47. Monumental Henge (EDHREC 1476) - {2}{W}{W}, {T}: Look at the top five cards of your library. You may reveal a historic card from among them and put it into your hand. Put the rest on the bottom of your library in a random order. (Artifacts, legendaries, and Sagas are historic.)
48. Arid Archway (EDHREC 1483) - (Look at the top card of your library. You may put it into your graveyard.)
49. Fomori Vault (EDHREC 1609) - {3}, {T}, Discard a card: Look at the top X cards of your library, where X is the number of artifacts you control. Put one of those cards into your hand and the rest on the bottom of your library in a random order.
50. Shigeki, Jukai Visionary (EDHREC 1674) - {1}{G}, {T}, Return Shigeki to its owner's hand: Reveal the top four cards of your library. You may put a land card from among them onto the battlefield tapped. Put the rest into your graveyard.
51. Satyr Wayfinder (EDHREC 1739) - When this creature enters, reveal the top four cards of your library.
52. Retreat to Coralhelm (EDHREC 1768) - • Scry 1. (Look at the top card of your library. You may put that card on the bottom.)
53. Dragon's Rage Channeler (EDHREC 1808) - (Look at the top card of your library. You may put that card into your graveyard.)
54. Doom Whisperer (EDHREC 1824) - (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)
55. Sunbird's Invocation (EDHREC 1862) - Whenever you cast a spell from your hand, reveal the top X cards of your library, where X is that spell's mana value.
56. Sonic Screwdriver (EDHREC 1899) - {2}, {T}: Scry 1. (Look at the top card of your library. You may put that card on the bottom.)
57. One with the Multiverse (EDHREC 1911) - You may look at the top card of your library any time.
58. Crystal Skull, Isu Spyglass (EDHREC 1947) - You may look at the top card of your library any time.
59. Traveling Chocobo (EDHREC 1974) - You may look at the top card of your library any time.
60. Conduit Pylons (EDHREC 1995) - (Look at the top card of your library. You may put it into your graveyard.)
61. Gonti, Lord of Luxury (EDHREC 2023) - When Gonti enters, look at the top four cards of target opponent's library, exile one of them face down, then put the rest on the bottom of that library in a random order.
62. Eladamri, Korvecdal (EDHREC 2063) - You may look at the top card of your library any time.
63. Adaptive Omnitool (EDHREC 2088) - Whenever equipped creature attacks, look at the top six cards of your library.
64. Risen Reef (EDHREC 2154) - Whenever this creature or another Elemental you control enters, look at the top card of your library.
65. Descendants' Path (EDHREC 2181) - At the beginning of your upkeep, reveal the top card of your library.
66. Hidden Grotto (EDHREC 2243) - (Look at the top card of your library. You may put it into your graveyard.)
67. Explorer's Scope (EDHREC 2247) - Whenever equipped creature attacks, look at the top card of your library.
68. Thrumming Stone (EDHREC 2260) - (Whenever you cast a spell, you may reveal the top four cards of your library. You may cast spells with the same name as that spell from among the revealed cards without paying their mana costs. Put the rest on the bottom of your library.)
69. Icon of Ancestry (EDHREC 2356) - {3}, {T}: Look at the top three cards of your library. You may reveal a creature card of the chosen type from among them and put it into your hand. Put the rest on the bottom of your library in a random order.
70. Lim-Dûl's Vault (EDHREC 2361) - Look at the top five cards of your library.
71. Powerbalance (EDHREC 2383) - Whenever an opponent casts a spell, you may reveal the top card of your library.
72. Faerie Seer (EDHREC 2425) - (Look at the top two cards of your library, then put any number of them on the bottom and the rest on top in any order.)
73. Weatherlight (EDHREC 2444) - Whenever Weatherlight deals combat damage to a player, look at the top five cards of your library.
74. Ureni of the Unwritten (EDHREC 2512) - Whenever Ureni enters or attacks, look at the top eight cards of your library.
75. Armored Skyhunter (EDHREC 2547) - Whenever this creature attacks, look at the top six cards of your library.
76. Animist's Awakening (EDHREC 2548) - Reveal the top X cards of your library.
77. Zhalfirin Void (EDHREC 2550) - (Look at the top card of your library. You may put that card on the bottom.)
78. Impulse (EDHREC 2610) - Look at the top four cards of your library.
79. Heroes' Podium (EDHREC 2658) - {X}, {T}: Look at the top X cards of your library. You may reveal a legendary creature card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.
80. Cemetery Tampering (EDHREC 2768) - Hideaway 5 (When this enchantment enters, look at the top five cards of your library, exile one face down, then put the rest on the bottom in a random order.)
81. Fecund Greenshell (EDHREC 2781) - Whenever this creature or another creature you control with toughness greater than its power enters, look at the top card of your library.
82. Sleight of Hand (EDHREC 3084) - Look at the top two cards of your library.
83. Lurking Predators (EDHREC 3145) - Whenever an opponent casts a spell, reveal the top card of your library.
84. Thief of Sanity (EDHREC 3168) - Whenever this creature deals combat damage to a player, look at the top three cards of that player's library, exile one of them face down, then put the rest into their graveyard.
85. Rumble Arena (EDHREC 3245) - (Look at the top card of your library. You may put it on the bottom.)
86. Counterbalance (EDHREC 3268) - Whenever an opponent casts a spell, you may reveal the top card of your library.
87. Twilight Diviner (EDHREC 3285) - (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)
88. Sigarda, Font of Blessings (EDHREC 3323) - You may look at the top card of your library any time.
89. Karumonix, the Rat King (EDHREC 3408) - When Karumonix enters, look at the top five cards of your library.
90. Florian, Voldaren Scion (EDHREC 3489) - At the beginning of each of your postcombat main phases, look at the top X cards of your library, where X is the total amount of life your opponents lost this turn.
91. Aetherworks Marvel (EDHREC 3490) - {T}, Pay six {E}: Look at the top six cards of your library. You may cast a spell from among them without paying its mana cost. Put the rest on the bottom of your library in a random order.
92. Nylea, Keen-Eyed (EDHREC 3499) - {2}{G}: Reveal the top card of your library. If it's a creature card, put it into your hand. Otherwise, you may put it into your graveyard.
93. Atraxa, Grand Unifier (EDHREC 3529) - When Atraxa enters, reveal the top ten cards of your library.
94. Gathering Stone (EDHREC 3532) - When this artifact enters and at the beginning of your upkeep, look at the top card of your library.
95. Rashmi, Eternities Crafter (EDHREC 3534) - Whenever you cast your first spell each turn, reveal the top card of your library.
96. Consult the Star Charts (EDHREC 3584) - Look at the top X cards of your library, where X is the number of lands you control.
97. Satoru Umezawa (EDHREC 3602) - Whenever you activate a ninjutsu ability, look at the top three cards of your library.
98. Korlessa, Scale Singer (EDHREC 3627) - You may look at the top card of your library any time.
99. Glarb, Calamity's Augur (EDHREC 3648) - You may look at the top card of your library any time.
100. Thundermane Dragon (EDHREC 3699) - You may look at the top card of your library any time.
101. Fortune Teller's Talent (EDHREC 3751) - You may look at the top card of your library any time.
102. Genesis Ultimatum (EDHREC 3813) - Look at the top five cards of your library.
103. Vivien, Champion of the Wilds (EDHREC 3897) - −2: Look at the top three cards of your library.
104. Planetarium of Wan Shi Tong (EDHREC 3923) - Whenever you scry or surveil, look at the top card of your library.
105. Muxus, Goblin Grandee (EDHREC 3997) - When Muxus enters, reveal the top six cards of your library.
106. Horn of the Mark (EDHREC 4244) - Whenever two or more creatures you control attack a player, look at the top five cards of your library.
107. Vizier of the Menagerie (EDHREC 4278) - You may look at the top card of your library any time.
108. Goblin Ringleader (EDHREC 4319) - When this creature enters, reveal the top four cards of your library.
109. Teferi, Temporal Archmage (EDHREC 4320) - +1: Look at the top two cards of your library.
110. Titan's Strength (EDHREC 4383) - (Look at the top card of your library. You may put that card on the bottom.)
111. Assemble the Players (EDHREC 4594) - You may look at the top card of your library any time.
112. Mulch (EDHREC 4625) - Reveal the top four cards of your library.
113. Seismic Sense (EDHREC 4661) - Look at the top X cards of your library, where X is the number of lands you control.
114. Quandrix Campus (EDHREC 4687) - {4}, {T}: Scry 1. (Look at the top card of your library. You may put that card on the bottom.)
115. Doors of Durin (EDHREC 4756) - Whenever you attack, scry 2, then you may reveal the top card of your library.
116. Astor, Bearer of Blades (EDHREC 4762) - When Astor enters, look at the top seven cards of your library.
117. Gilgamesh, Master-at-Arms (EDHREC 4818) - Whenever Gilgamesh enters or attacks, look at the top six cards of your library.
118. Winota, Joiner of Forces (EDHREC 4834) - Whenever a non-Human creature you control attacks, look at the top six cards of your library.
119. Calix, Destiny's Hand (EDHREC 4874) - +1: Look at the top four cards of your library.
120. Mission Briefing (EDHREC 4883) - (To surveil 2, look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)
121. Sarinth Steelseeker (EDHREC 4941) - Whenever an artifact you control enters, look at the top card of your library.
122. Fblthp, Lost on the Range (EDHREC 4949) - You may look at the top card of your library any time.
123. Kishla Village (EDHREC 4968) - {3}{G}, {T}: Surveil 2. (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)
124. Sauron's Ransom (EDHREC 5014) - They look at the top four cards of your library and separate them into a face-down pile and a face-up pile.
125. Aminatou, Veil Piercer (EDHREC 5036) - (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)
126. Snarling Gorehound (EDHREC 5058) - (Look at the top card of your library. You may put it into your graveyard.)
127. Expand the Sphere (EDHREC 5072) - Look at the top six cards of your library.
128. Clive's Hideaway (EDHREC 5162) - Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)
129. Elvish Rejuvenator (EDHREC 5172) - When this creature enters, look at the top five cards of your library.
130. Mm'menon, the Right Hand (EDHREC 5201) - You may look at the top card of your library any time.
131. Djeru and Hazoret (EDHREC 5238) - Whenever Djeru and Hazoret attacks, look at the top six cards of your library.
132. Flow State (EDHREC 5294) - Look at the top three cards of your library.
133. Cavalier of Thorns (EDHREC 5319) - When this creature enters, reveal the top five cards of your library.
134. Omnath, Locus of All (EDHREC 5331) - At the beginning of your first main phase, look at the top card of your library.
135. Verge Rangers (EDHREC 5362) - You may look at the top card of your library any time.
136. Evercoat Ursine (EDHREC 5435) - Hideaway 3, hideaway 3 (When this creature enters, look at the top three cards of your library, exile one face down, then put the rest on the bottom in a random order. Then do it again.)
137. Abhorrent Oculus (EDHREC 5502) - (Look at the top two cards of your library. Put one onto the battlefield face down as a 2/2 creature and the other into your graveyard. Turn it face up any time for its mana cost if it's a creature card.)
138. Freestrider Lookout (EDHREC 5504) - Whenever you commit a crime, look at the top five cards of your library.
139. Gallifrey Council Chamber (EDHREC 5536) - (Look at the top card of your library. You may put that card into your graveyard.)
140. Artificer's Assistant (EDHREC 5542) - Whenever you cast a historic spell, scry 1. (Artifacts, legendaries, and Sagas are historic. To scry 1, look at the top card of your library, then you may put that card on the bottom.)
141. Nymris, Oona's Trickster (EDHREC 5580) - Whenever you cast your first spell during each opponent's turn, look at the top two cards of your library.
142. Prismari Campus (EDHREC 5619) - {4}, {T}: Scry 1. (Look at the top card of your library. You may put that card on the bottom.)
143. Telling Time (EDHREC 5622) - Look at the top three cards of your library.
144. Green Sun's Twilight (EDHREC 5651) - Reveal the top X plus one cards of your library.
145. Hauntwoods Shrieker (EDHREC 5691) - (Look at the top two cards of your library. Put one onto the battlefield face down as a 2/2 creature and the other into your graveyard. Turn it face up any time for its mana cost if it's a creature card.)
146. Zimone, Mystery Unraveler (EDHREC 5760) - Landfall — Whenever a land you control enters, manifest dread if this is the first time this ability has resolved this turn. Otherwise, you may turn a permanent you control face up. (To manifest dread, look at the top two cards of your library. Put one onto the battlefield face down as a 2/2 creature and the other into your graveyard. Turn it face up any time for its mana cost if it's a creature card.)
147. Majestic Genesis (EDHREC 5768) - Reveal the top X cards of your library, where X is the greatest mana value of a commander you own on the battlefield or in the command zone.
148. Cream of the Crop (EDHREC 5782) - Whenever a creature you control enters, you may look at the top X cards of your library, where X is that creature's power.
149. Accumulate Wisdom (EDHREC 5799) - Look at the top three cards of your library.
150. Into the Pit (EDHREC 5849) - You may look at the top card of your library any time.
151. Perception Bobblehead (EDHREC 5939) - {3}, {T}: Look at the top X cards of your library, where X is the number of Bobbleheads you control. You may cast a spell with mana value 3 or less from among them without paying its mana cost. Put the rest on the bottom of your library in a random order.
152. Don't Make a Sound (EDHREC 5992) - (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)
153. Kamahl's Druidic Vow (EDHREC 5993) - Look at the top X cards of your library.
154. Condescend (EDHREC 6044) - (Look at the top two cards of your library, then put any number of them on the bottom and the rest on top in any order.)
155. Blightwing Bandit (EDHREC 6068) - Whenever you cast your first spell during each opponent's turn, look at the top card of that player's library, then exile it face down.
156. Archghoul of Thraben (EDHREC 6095) - Whenever this creature or another Zombie you control dies, look at the top card of your library.
157. Silverquill Campus (EDHREC 6143) - {4}, {T}: Scry 1. (Look at the top card of your library. You may put that card on the bottom.)
158. Tocasia's Dig Site (EDHREC 6170) - {3}, {T}: Surveil 1. (Look at the top card of your library. You may put it into your graveyard.)
159. Dissolve (EDHREC 6219) - (Look at the top card of your library. You may put that card on the bottom.)
160. See the Truth (EDHREC 6254) - Look at the top three cards of your library.
161. Dream-Thief's Bandana (EDHREC 6312) - Whenever equipped creature deals combat damage to a player, look at the top card of their library, then exile it face down.
162. Sinister Sabotage (EDHREC 6321) - (Look at the top card of your library. You may put it into your graveyard.)
163. Anticipate (EDHREC 6353) - Look at the top three cards of your library.
164. Dragonologist (EDHREC 6442) - When this creature enters, look at the top six cards of your library.
165. Witherbloom Campus (EDHREC 6491) - {4}, {T}: Scry 1. (Look at the top card of your library. You may put that card on the bottom.)
166. Laser Screwdriver (EDHREC 6538) - {2}, {T}: Surveil 1. (Look at the top card of your library. You may put that card into your graveyard.)
167. Lapis Orb of Dragonkind (EDHREC 6544) - {T}: Add {U}. When you spend this mana to cast a Dragon creature spell, scry 2. (Look at the top two cards of your library, then put any number of them on the bottom and the rest on top in any order.)
168. Adéwalé, Breaker of Chains (EDHREC 6560) - When Adéwalé enters, reveal the top six cards of your library.
169. Elsha of the Infinite (EDHREC 6628) - You may look at the top card of your library any time.
170. Acclaimed Contender (EDHREC 6632) - When this creature enters, if you control another Knight, look at the top five cards of your library.
171. Xanathar, Guild Kingpin (EDHREC 6635) - Until end of turn, that player can't cast spells, you may look at the top card of their library any time, you may play the top card of their library, and you may spend mana as though it were mana of any color to cast spells this way.
172. Owlbear Cub (EDHREC 6663) - Mama's Coming — Whenever this creature attacks a player who controls eight or more lands, look at the top eight cards of your library. You may put a creature card from among them onto the battlefield tapped and attacking that player. Put the rest on the bottom of your library in a random order.
173. Summoning Materia (EDHREC 6683) - You may look at the top card of your library any time.
174. Mirri's Guile (EDHREC 6693) - At the beginning of your upkeep, you may look at the top three cards of your library, then put them back in any order.
175. Nissa, Steward of Elements (EDHREC 6714) - 0: Look at the top card of your library.
176. Boromir, Gondor's Hope (EDHREC 6821) - Whenever Boromir enters or attacks, look at the top six cards of your library.
177. Dogged Detective (EDHREC 6887) - (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)
178. Kaalia, Zenith Seeker (EDHREC 6898) - When Kaalia enters, look at the top six cards of your library.
179. Carth the Lion (EDHREC 6964) - Whenever Carth enters or a planeswalker you control dies, look at the top seven cards of your library.
180. Falco Spara, Pactweaver (EDHREC 6968) - You may look at the top card of your library any time.
181. Black Cat, Cunning Thief (EDHREC 6975) - When Black Cat enters, look at the top nine cards of target opponent's library, exile two of them face down, then put the rest on the bottom of their library in a random order.
182. Dragonlord Ojutai (EDHREC 7000) - Whenever Dragonlord Ojutai deals combat damage to a player, look at the top three cards of your library.
183. Master of Death (EDHREC 7030) - (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)
184. Vendilion Clique (EDHREC 7032) - When Vendilion Clique enters, look at target player's hand.
185. Cosmic Cube (EDHREC 7051) - Whenever you attack, look at the top six cards of your library.
186. Crystal Ball (EDHREC 7061) - {1}, {T}: Scry 2. (Look at the top two cards of your library, then put any number of them on the bottom and the rest on top in any order.)
187. Sin Prodder (EDHREC 7087) - At the beginning of your upkeep, reveal the top card of your library.
188. Lydia Frye (EDHREC 7092) - (Look at the top X cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)
189. Parcelbeast (EDHREC 7106) - {1}, {T}: Look at the top card of your library. If it's a land card, you may put it onto the battlefield. If you don't put the card onto the battlefield, put it into your hand.
190. Thassa's Intervention (EDHREC 7119) - • Look at the top X cards of your library. Put up to two of them into your hand and the rest on the bottom of your library in a random order.
191. Galadriel of Lothlórien (EDHREC 7153) - Whenever you scry, you may reveal the top card of your library.
192. Lorehold Campus (EDHREC 7290) - {4}, {T}: Scry 1. (Look at the top card of your library. You may put that card on the bottom.)
193. Fading Hope (EDHREC 7301) - (Look at the top card of your library. You may put that card on the bottom.)
194. Diabolic Vision (EDHREC 7356) - Look at the top five cards of your library.
195. Nightveil Sprite (EDHREC 7373) - (Look at the top card of your library. You may put it into your graveyard.)
196. Web of Life and Destiny (EDHREC 7394) - At the beginning of combat on your turn, look at the top five cards of your library.
197. Watcher for Tomorrow (EDHREC 7430) - Hideaway 4 (When this creature enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)
198. Velomachus Lorehold (EDHREC 7498) - Whenever Velomachus Lorehold attacks, look at the top seven cards of your library.
199. Wall of Runes (EDHREC 7591) - (Look at the top card of your library. You may put that card on the bottom.)
200. Confounding Riddle (EDHREC 7603) - • Look at the top four cards of your library. Put one of them into your hand and the rest into your graveyard.

### 20. Attach / Equip / Aura Movement

Source: corpus-mined follow-on seam
Available after current queue exclusion: 553

1. Swiftfoot Boots (EDHREC 12) - Equip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)
2. Lightning Greaves (EDHREC 13) - Equip {0}
3. Animate Dead (EDHREC 223) - When this Aura enters, if it's on the battlefield, it loses "enchant creature card in a graveyard" and gains "enchant creature put onto the battlefield with this Aura." Return enchanted creature card to the battlefield under your control and attach this Aura to it.
4. Mithril Coat (EDHREC 239) - When Mithril Coat enters, attach it to target legendary creature you control.
5. Shadowspear (EDHREC 317) - Equip {2}
6. Whispersilk Cloak (EDHREC 332) - Equip {2}
7. Blackblade Reforged (EDHREC 349) - Equip legendary creature {3}
8. Commander's Plate (EDHREC 487) - Equip commander {3}
9. Sword of Feast and Famine (EDHREC 540) - Equip {2}
10. Brotherhood Regalia (EDHREC 551) - Equip legendary creature {1}
11. Trailblazer's Boots (EDHREC 664) - Equip {2}
12. Hammer of Nazahn (EDHREC 744) - Whenever Hammer of Nazahn or another Equipment you control enters, you may attach that Equipment to target creature you control.
13. Champion's Helm (EDHREC 749) - Equip {1}
14. Sigarda's Aid (EDHREC 841) - Whenever an Equipment you control enters, you may attach it to target creature you control.
15. Colossus Hammer (EDHREC 857) - Equip {8} ({8}: Attach to target creature you control. Equip only as a sorcery.)
16. Excalibur, Sword of Eden (EDHREC 906) - Equip legendary creature {2}
17. Darksteel Plate (EDHREC 924) - Equip {2}
18. Loxodon Warhammer (EDHREC 958) - Equip {3}
19. Fireshrieker (EDHREC 1115) - Equip {2} ({2}: Attach to target creature you control. Equip only as a sorcery.)
20. Genji Glove (EDHREC 1152) - Equip {3}
21. Forge Anew (EDHREC 1239) - During your turn, you may activate equip abilities any time you could cast an instant.
22. Embercleave (EDHREC 1339) - When Embercleave enters, attach it to target creature you control.
23. Conqueror's Flail (EDHREC 1363) - Equip {2}
24. Leyline Axe (EDHREC 1396) - Equip {3} ({3}: Attach to target creature you control. Equip only as a sorcery.)
25. Caduceus, Staff of Hermes (EDHREC 1412) - Equip {W}{W}
26. Lavaspur Boots (EDHREC 1474) - Equip {1}
27. Codsworth, Handy Helper (EDHREC 1539) - {T}: Attach target Aura or Equipment you control to target creature you control. Activate only as a sorcery.
28. Sword of Vengeance (EDHREC 1572) - Equip {3}
29. Thran Power Suit (EDHREC 1574) - Equip {2} ({2}: Attach to target creature you control. Equip only as a sorcery.)
30. Illusionist's Bracers (EDHREC 1601) - Equip {3}
31. Sting, the Glinting Dagger (EDHREC 1611) - Equip {2}
32. Bloodforged Battle-Axe (EDHREC 1650) - Equip {2}
33. Ardenn, Intrepid Archaeologist (EDHREC 1676) - At the beginning of combat on your turn, you may attach any number of Auras and Equipment you control to target permanent or player.
34. Kaldra Compleat (EDHREC 1679) - Equip {7}
35. Silver Shroud Costume (EDHREC 1809) - When this Equipment enters, attach it to target creature you control.
36. Paradise Mantle (EDHREC 1830) - Equip {1}
37. Winged Boots (EDHREC 1874) - Equip {1}
38. Hero's Blade (EDHREC 1875) - Whenever a legendary creature you control enters, you may attach this Equipment to it.
39. Sword of Forge and Frontier (EDHREC 1885) - Equip {2}
40. Adaptive Omnitool (EDHREC 2088) - Equip {3}
41. Haunted Cloak (EDHREC 2115) - Equip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)
42. The Key to the Vault (EDHREC 2149) - Equip {2}{U}
43. Dragonfire Blade (EDHREC 2246) - Equip {4}.
44. Explorer's Scope (EDHREC 2247) - Equip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)
45. Bloodthirsty Blade (EDHREC 2258) - {1}: Attach this Equipment to target creature an opponent controls. Activate only as a sorcery.
46. Thieving Skydiver (EDHREC 2293) - If that artifact is an Equipment, attach it to this creature.
47. Umbral Mantle (EDHREC 2333) - Equip {0}
48. Cranial Plating (EDHREC 2389) - {B}{B}: Attach this Equipment to target creature you control.
49. Bruenor Battlehammer (EDHREC 2487) - You may pay {0} rather than pay the equip cost of the first equip ability you activate each turn.
50. Armored Skyhunter (EDHREC 2547) - If an Equipment is put onto the battlefield this way, you may attach it to a creature you control.
51. Brass Squire (EDHREC 2605) - {T}: Attach target Equipment you control to target creature you control.
52. Quietus Spike (EDHREC 2716) - Equip {3}
53. Vorpal Sword (EDHREC 2801) - Equip {B}{B}
54. Aettir and Priwen (EDHREC 2971) - Equip {5}
55. Robe of Stars (EDHREC 2984) - Equip {1}
56. Wrecking Ball Arm (EDHREC 3097) - Equip legendary creature {3}
57. Strong Back (EDHREC 3203) - Equip abilities you activate that target enchanted creature cost {3} less to activate.
58. Shielded by Faith (EDHREC 3327) - Whenever a creature enters, you may attach this Aura to that creature.
59. Inventory Management (EDHREC 3350) - For each Aura and Equipment you control, you may attach it to a creature you control.
60. Celestial Armor (EDHREC 3361) - When this Equipment enters, attach it to target creature you control.
61. Prowler's Helm (EDHREC 3404) - Equip {2}
62. Bureau Headmaster (EDHREC 3594) - Equip abilities you activate cost {1} less to activate.
63. Behemoth Sledge (EDHREC 3684) - Equip {3}
64. The Masamune (EDHREC 3822) - Equip {2}
65. Heirloom Blade (EDHREC 3823) - Equip {1}
66. The Irencrag (EDHREC 3834) - If you do, it gains equip {3} and "Equipped creature gets +3/+3" and loses all other abilities.
67. Maddening Hex (EDHREC 3872) - Then attach this Aura to another one of your opponents chosen at random.
68. Sword of the Squeak (EDHREC 4028) - Whenever a Hamster, Mouse, Rat, or Squirrel you control enters, you may attach this Equipment to that creature.
69. Hero's Heirloom (EDHREC 4041) - Equip {2}
70. Mask of Avacyn (EDHREC 4045) - Equip {3}
71. Maul of the Skyclaves (EDHREC 4062) - When this Equipment enters, attach it to target creature you control.
72. Nazgûl Battle-Mace (EDHREC 4070) - Equip {3}
73. Assault Suit (EDHREC 4135) - Equip {3}
74. Inquisitor's Flail (EDHREC 4157) - Equip {2}
75. Umbra Mystic (EDHREC 4162) - (If an enchanted permanent you control would be destroyed, instead remove all damage from it and destroy an Aura attached to it.)
76. Pariah's Shield (EDHREC 4231) - Equip {3}
77. Luxior, Giada's Gift (EDHREC 4403) - Equip planeswalker {1}
78. Short Bow (EDHREC 4480) - Equip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)
79. Helm of the Gods (EDHREC 4748) - Equip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)
80. Astor, Bearer of Blades (EDHREC 4762) - Equipment you control have equip {1}.
81. Sword of Once and Future (EDHREC 4804) - Equip {2}
82. Gilgamesh, Master-at-Arms (EDHREC 4818) - When you put one or more Equipment onto the battlefield this way, you may attach one of them to a Samurai you control.
83. Freya Crescent (EDHREC 4861) - {T}: Add {R}. Spend this mana only to cast an Equipment spell or activate an equip ability.
84. Brass Knuckles (EDHREC 4959) - Equip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)
85. Mirror Shield (EDHREC 5142) - Equip {2} ({2}: Attach to target creature you control. Equip only as a sorcery.)
86. Stoneforge Masterwork (EDHREC 5146) - Equip {2}
87. Sword of the Paruns (EDHREC 5409) - Equip {3}
88. Benevolent Blessing (EDHREC 5415) - This effect doesn't remove Auras and Equipment you control that are already attached to it.
89. Battlemage's Bracers (EDHREC 5482) - Equip {2}
90. Crown of Gondor (EDHREC 5587) - Equip {4}.
91. Glamdring (EDHREC 5667) - Equip {3}
92. Tenza, Godo's Maul (EDHREC 5711) - Equip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)
93. Mjölnir, Hammer of Thor (EDHREC 5720) - Equip worthy {1} (A creature is worthy if it's a legendary non-Villain that's red and/or white.)
94. Vorrac Battlehorns (EDHREC 5903) - Equip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)
95. Hidden Blade (EDHREC 5927) - When this Equipment enters, attach it to target creature you control.
96. Cloak of the Bat (EDHREC 5985) - Equip {2} ({2}: Attach to target creature you control. Equip only as a sorcery.)
97. Gorgon's Head (EDHREC 6037) - Equip {2}
98. Pre-War Formalwear (EDHREC 6053) - When this Equipment enters, return target creature card with mana value 3 or less from your graveyard to the battlefield and attach this Equipment to it.
99. Cliffhaven Kitesail (EDHREC 6127) - When this Equipment enters, attach it to target creature you control.
100. Yuffie, Materia Hunter (EDHREC 6187) - Then you may attach an Equipment you control to Yuffie.
101. Dream-Thief's Bandana (EDHREC 6312) - Equip {1}
102. Psychic Paper (EDHREC 6331) - Equip {2}
103. Balan, Wandering Knight (EDHREC 6472) - {1}{W}: Attach all Equipment you control to Balan.
104. Accorder's Shield (EDHREC 6562) - Equip {3} ({3}: Attach to target creature you control. Equip only as a sorcery.)
105. Adventuring Gear (EDHREC 6646) - Equip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)
106. Summoning Materia (EDHREC 6683) - Equip {2}
107. Bone Saw (EDHREC 6736) - Equip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)
108. Nemesis Mask (EDHREC 6743) - Equip {3} ({3}: Attach to target creature you control. Equip only as a sorcery.)
109. Magnetic Theft (EDHREC 6770) - Attach target Equipment to target creature.
110. Leonin Shikari (EDHREC 6833) - You may activate equip abilities any time you could cast an instant.
111. Belt of Giant Strength (EDHREC 7011) - Equip {10}.
112. Multiclass Baldric (EDHREC 7046) - Equip {2}
113. Nuka-Nuke Launcher (EDHREC 7131) - Equip {3}
114. Armory Automaton (EDHREC 7189) - Whenever this creature enters or attacks, you may attach any number of target Equipment to it.
115. O-Naginata (EDHREC 7191) - Equip {2} ({2}: Attach to target creature you control. Equip only as a sorcery.)
116. Dragon Throne of Tarkir (EDHREC 7195) - Equip {3}
117. Cloud, Planet's Champion (EDHREC 7215) - Equip abilities you activate that target Cloud cost {2} less to activate.
118. Golem-Skin Gauntlets (EDHREC 7234) - Equip {2} ({2}: Attach to target creature you control. Equip only as a sorcery.)
119. Éowyn, Lady of Rohan (EDHREC 7268) - Equip abilities you activate cost {1} less to activate.
120. Captain America's Shield (EDHREC 7270) - Equip {2}
121. Barrow-Blade (EDHREC 7308) - Equip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)
122. Cathar's Shield (EDHREC 7340) - Equip {3} ({3}: Attach to target creature you control. Equip only as a sorcery.)
123. Sword of the Meek (EDHREC 7351) - Equip {2}
124. Hunter's Blowgun (EDHREC 7463) - Equip {2} ({2}: Attach to target creature you control. Equip only as a sorcery.)
125. Felidar Umbra (EDHREC 7493) - {1}{W}: Attach this Aura to target creature you control.
126. Chariot of Victory (EDHREC 7637) - Equip {1}
127. Blue Mage's Cane (EDHREC 7659) - Spirit of the Whalaqee — Equip {2}
128. Conjurer's Mantle (EDHREC 7674) - Equip {1}
129. Armed and Armored (EDHREC 7761) - Attach any number of Equipment you control to it.
130. Godsend (EDHREC 7828) - Equip {3}
131. Battlefield Improvisation (EDHREC 7884) - If that creature is attacking, you may attach any number of Equipment you control to it.
132. Forebear's Blade (EDHREC 7905) - Whenever equipped creature dies, attach this Equipment to target creature you control.
133. Helitrooper (EDHREC 7964) - Equip abilities you activate that target this creature cost {2} less to activate.
134. Summoner's Grimoire (EDHREC 7967) - Abraxas — Equip {3}
135. Amy Rose (EDHREC 8132) - Whenever Amy Rose attacks, attach up to one target Equipment to her.
136. Fervent Champion (EDHREC 8216) - Equip abilities you activate that target this creature cost {3} less to activate.
137. Beatrix, Loyal General (EDHREC 8363) - At the beginning of combat on your turn, you may attach any number of Equipment you control to target creature you control.
138. Quick-Draw Katana (EDHREC 8407) - Equip {2} ({2}: Attach to target creature you control. Equip only as a sorcery.)
139. Sigil of Valor (EDHREC 8503) - Equip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)
140. Plate Armor (EDHREC 8532) - Equip {3}.
141. Worldslayer (EDHREC 8537) - Equip {5} ({5}: Attach to target creature you control. Equip only as a sorcery.)
142. Doc Ock's Tentacles (EDHREC 8611) - Whenever a creature you control with mana value 5 or greater enters, you may attach this Equipment to it.
143. Mabel, Heir to Cragflame (EDHREC 8722) - When Mabel enters, create Cragflame, a legendary colorless Equipment artifact token with "Equipped creature gets +1/+1 and has vigilance, trample, and haste" and equip {2}.
144. Glider Staff (EDHREC 8746) - Equip {2}
145. Empyrial Plate (EDHREC 8760) - Equip {2}
146. Biorganic Carapace (EDHREC 8784) - When this Equipment enters, attach it to target creature you control.
147. Spidersilk Net (EDHREC 8797) - Equip {2} ({2}: Attach to target creature you control. Equip only as a sorcery.)
148. Sword of Kaldra (EDHREC 8880) - Equip {4} ({4}: Attach to target creature you control. Equip only as a sorcery.)
149. Brilliant Wings (EDHREC 8913) - If you do, attach this Aura to that creature.
150. Trepanation Blade (EDHREC 8945) - Equip {2}
151. Eater of Virtue (EDHREC 9163) - Equip {1}
152. Prosthetic Injector (EDHREC 9254) - Equip {1}
153. Meteoric Mace (EDHREC 9281) - Equip {4}
154. Gorgon Flail (EDHREC 9305) - Equip {2} ({2}: Attach to target creature you control. Equip only as a sorcery.)
155. Hand of Vecna (EDHREC 9573) - Equip—Pay 1 life for each card in your hand.
156. Holy Avenger (EDHREC 9674) - Equip {2}{W}
157. Runechanter's Pike (EDHREC 9818) - Equip {2}
158. Assimilation Aegis (EDHREC 9842) - Equip {2}
159. Fleetfeather Sandals (EDHREC 9858) - Equip {2} ({2}: Attach to target creature you control. Equip only as a sorcery.)
160. Boots of Speed (EDHREC 9884) - Equip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)
161. Hot Soup (EDHREC 9935) - Equip {3} ({3}: Attach to target creature you control. Equip only as a sorcery.)
162. Grappling Hook (EDHREC 9947) - Equip {4}
163. Cloak and Dagger (EDHREC 10033) - Whenever a Rogue creature enters, you may attach this Equipment to it.
164. Phantom Blade (EDHREC 10051) - When this Equipment enters, attach it to up to one target creature you control.
165. Leather Armor (EDHREC 10111) - Equip {0}.
166. Stalactite Dagger (EDHREC 10166) - Equip {2} ({2}: Attach to target creature you control. Equip only as a sorcery.)
167. Gimli's Axe (EDHREC 10171) - Equip {2} ({2}: Attach to target creature you control. Equip only as a sorcery.)
168. The Dominion Bracelet (EDHREC 10239) - Equip {1}
169. Fishing Gear (EDHREC 10377) - Equip {2}
170. Deathrender (EDHREC 10525) - Whenever equipped creature dies, you may put a creature card from your hand onto the battlefield and attach this Equipment to it.
171. Skyclave Pick-Axe (EDHREC 10540) - When this Equipment enters, attach it to target creature you control.
172. Bruna, Light of Alabaster (EDHREC 10620) - Whenever Bruna attacks or blocks, you may attach to it any number of Auras on the battlefield and you may put onto the battlefield attached to it any number of Aura cards that could enchant it from your graveyard and/or hand.
173. Bearded Axe (EDHREC 10711) - Equip {2}
174. Cass, Hand of Vengeance (EDHREC 10742) - Whenever Cass or another creature you control dies, if it was enchanted or equipped, return any number of Aura cards that were attached to it from your graveyard to the battlefield attached to target creature, then attach any number of Equipment that were attached to it to that creature.
175. Twin Blades (EDHREC 10749) - When this Equipment enters, attach it to target creature you control.
176. Improvised Arsenal (EDHREC 10769) - Equip {R}
177. Icingdeath, Frost Tyrant (EDHREC 10880) - When Icingdeath, Frost Tyrant dies, create Icingdeath, Frost Tongue, a legendary white Equipment artifact token with "Equipped creature gets +2/+0," "Whenever equipped creature attacks, tap target creature defending player controls," and equip {2}.
178. Bonesplitter (EDHREC 10921) - Equip {1}
179. Nightmare Lash (EDHREC 10989) - Equip—Pay 3 life.
180. Shield of Kaldra (EDHREC 11005) - Equip {4}
181. Konda's Banner (EDHREC 11048) - Equip {2}
182. Heavenly Blademaster (EDHREC 11137) - When this creature enters, you may attach any number of Auras and Equipment you control to it.
183. Hookblade (EDHREC 11148) - When this Equipment enters, attach it to target creature you control.
184. Hidden Footblade (EDHREC 11151) - When this Equipment enters, attach it to target creature you control.
185. Hulkbuster Armor (EDHREC 11166) - Equip Hero {3}
186. Iron Man Armor (EDHREC 11181) - When this Equipment enters, attach it to target creature you control.
187. Cobbled Wings (EDHREC 11239) - Equip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)
188. Cryptic Coat (EDHREC 11272) - When this Equipment enters, cloak the top card of your library, then attach this Equipment to it.
189. Ace's Baseball Bat (EDHREC 11365) - Equip legendary creature {1}
190. Swordsman's Steel (EDHREC 11377) - Equip {3}
191. Kite Shield (EDHREC 11390) - Equip {3} ({3}: Attach to target creature you control. Equip only as a sorcery.)
192. Super-Soldier Serum (EDHREC 11480) - Whenever enchanted creature attacks or blocks, attach any number of target Equipment you control to it.
193. Fumble (EDHREC 11626) - Gain control of all Auras and Equipment that were attached to it, then attach them to another creature.
194. Shuko (EDHREC 11628) - Equip {0} ({0}: Attach to target creature you control. Equip only as a sorcery.)
195. Orcrist, Goblin-cleaver (EDHREC 11671) - Equip {3}
196. Web-Shooters (EDHREC 11773) - Equip {2} ({2}: Attach to target creature you control. Equip only as a sorcery.)
197. Skateboard (EDHREC 11800) - Equip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)
198. Spider-Suit (EDHREC 11937) - Equip {3} ({3}: Attach to target creature you control. Equip only as a sorcery.)
199. Dark Knight's Greatsword (EDHREC 11957) - Job select (When this Equipment enters, create a 1/1 colorless Hero creature token, then attach this to it.)
200. Rover Blades (EDHREC 12099) - Equip {4}

## Notes

- Regenerate with `node tools/build-next-automation-categories.js` whenever the corpus or category patterns change.
- Modal fixtures must include the choose header and all immediately following mode bullets; bare headers are rejected.
- Clauses are never ellipsized; incomplete parenthetical reminders are skipped.

