# Oracle Automation Next 200 (Items 201-400)

Generated: `2026-04-06T11:09:05.057Z`
Source: `oracle-cards.json`
Scope: black-border paper-card automation candidates ordered by seam priority. The queue exhausts the active graveyard / recursion seam first, then spills into the next highest-population seams.

Queued items: `200`
Queue window: `201-400`

Grant review note: when Oracle text contains quoted text like `gains "..."`, treat the quoted text as a granted effect to model separately from the host card's own effect text.

## Queue Rules

- Ordered by family priority first, then by EDHREC rank, then by card name.
- Cards are deduped by `oracle_id`, so multi-print duplicates do not crowd out breadth.
- This queue is intentionally seam-priority driven: graveyard/recursion work comes first, then the generator rolls into broader high-population seams like token creation, direct damage, draw, sacrifice, counters, and search effects.
- Offset windows preserve the original global queue order; item numbers remain global queue indices rather than restarting from 1.
- Nim Deathmantle-style payment + return + attach recursion is explicitly kept in the queue even when the family is small.

## Family Summary

| Family | Category | Queued | Available | Notes |
|---|---|---:|---:|---|
| Your Graveyard To Hand | Near-Term Graveyard Move-Zone | 44 | 340 | High-volume self-recursion family; good for tightening direct target binding and context-driven return paths. |
| Dies Triggers Returning The Card To Battlefield | Contextual Graveyard Recursion | 40 | 40 | Needs stronger antecedent binding from the dying object into the follow-up move-zone action. |
| Dies Triggers Returning The Card To Hand | Contextual Graveyard Recursion | 21 | 22 | Similar contextual binding seam, but with hand destination instead of battlefield. |
| Pay-To-Return Deathmantle-Style Recursion | Contextual Graveyard Recursion | 3 | 3 | Includes Nim Deathmantle-style payment + return + attachment bundles. |
| Entered Or Cast From Graveyard Checks | Graveyard Context / Conditional | 7 | 7 | Good follow-up once provenance is threaded more broadly across server and rules-engine paths. |
| Leave-Battlefield Exile Replacement Riders | Graveyard Context / Conditional | 4 | 4 | Important support glue for temporary recursion families such as unearth and similar reanimation effects. |
| Cast From Graveyard Permission Windows | Graveyard Permission / Replacement | 35 | 392 | Useful for later test runs because these create lots of visible automation gaps when not modeled cleanly. |
| Play From Graveyard Permission Windows | Graveyard Permission / Replacement | 25 | 27 | Covers lands and mixed play-permission text from graveyard. |
| Flashback Cards | Graveyard Permission / Replacement | 21 | 220 | Stable, populous graveyard-casting family to validate once permission windows and replacement text are tightened. |

## Ordered Queue

### Your Graveyard To Hand

201. Scour for Scrap (EDHREC 3751) - • Return target artifact card from your graveyard to your hand.
202. Toph, Hardheaded Teacher (EDHREC 3825) - If you do, return target instant or sorcery card from your graveyard to your hand.
203. Sam's Desperate Rescue (EDHREC 3941) - Return target creature card from your graveyard to your hand.
204. Auramancer (EDHREC 4004) - When this creature enters, you may return target enchantment card from your graveyard to your hand.
205. Greenwarden of Murasa (EDHREC 4009) - When this creature enters, you may return target card from your graveyard to your hand.
206. Undead Butler (EDHREC 4137) - When you do, return target creature card from your graveyard to your hand.
207. Auroral Procession (EDHREC 4305) - Return target card from your graveyard to your hand.
208. Nissa, Vital Force (EDHREC 4310) - −3: Return target permanent card from your graveyard to your hand.
209. The Underworld Cookbook (EDHREC 4409) - {4}, {T}, Sacrifice this artifact: Return target creature card from your graveyard to your hand.
210. Atzocan Seer (EDHREC 4482) - Sacrifice this creature: Return target Dinosaur card from your graveyard to your hand.
211. Satsuki, the Living Lore (EDHREC 4489) - • Return target Saga card from your graveyard to your hand.
212. Stormchaser's Talent (EDHREC 4656) - When this Class becomes level 2, return target instant or sorcery card from your graveyard to your hand.
213. Veinwitch Coven (EDHREC 4692) - If you do, return target creature card from your graveyard to your hand.
214. Red XIII, Proud Warrior (EDHREC 4708) - Cosmo Memory — When Red XIII enters, return target Aura or Equipment card from your graveyard to your hand.
215. Golbez, Crystal Collector (EDHREC 4903) - At the beginning of your end step, if you control four or more artifacts, return target creature card from your graveyard to your hand.
216. Palace Siege (EDHREC 4938) - • Khans — At the beginning of your upkeep, return target creature card from your graveyard to your hand.
217. Mystic Retrieval (EDHREC 5049) - Return target instant or sorcery card from your graveyard to your hand.
218. Hanna, Ship's Navigator (EDHREC 5118) - {1}{W}{U}, {T}: Return target artifact or enchantment card from your graveyard to your hand.
219. Cavalier of Dawn (EDHREC 5361) - When this creature dies, return target artifact or enchantment card from your graveyard to your hand.
220. Reconstruct History (EDHREC 5578) - Return up to one target artifact card, up to one target enchantment card, up to one target instant card, up to one target sorcery card, and up to one target planeswalker card from your graveyard to your hand.
221. Fungal Rebirth (EDHREC 5667) - Return target permanent card from your graveyard to your hand.
222. Awaken the Honored Dead (EDHREC 5841) - When you do, return target creature or land card from your graveyard to your hand.
223. Den Protector (EDHREC 5904) - When this creature is turned face up, return target card from your graveyard to your hand.
224. Wrenn and Six (EDHREC 5945) - +1: Return up to one target land card from your graveyard to your hand.
225. Layla Hassan (EDHREC 5946) - When Layla Hassan enters and whenever one or more Assassins you control deal combat damage to a player, return target historic card from your graveyard to your hand.
226. Genesis (EDHREC 5973) - If you do, return target creature card from your graveyard to your hand.
227. Cormela, Glamour Thief (EDHREC 6034) - When Cormela dies, return up to one target instant or sorcery card from your graveyard to your hand.
228. Mnemonic Wall (EDHREC 6047) - When this creature enters, you may return target instant or sorcery card from your graveyard to your hand.
229. Volcanic Vision (EDHREC 6074) - Return target instant or sorcery card from your graveyard to your hand.
230. Echoing Return (EDHREC 6137) - Return target creature card and all other cards with the same name as that card from your graveyard to your hand.
231. Ruxa, Patient Professor (EDHREC 6209) - Whenever Ruxa enters or attacks, return target creature card with no abilities from your graveyard to your hand.
232. Grave Venerations (EDHREC 6365) - At the beginning of your end step, if you're the monarch, return up to one target creature card from your graveyard to your hand.
233. Planewide Celebration (EDHREC 6393) - • Return target permanent card from your graveyard to your hand.
234. Call to the Netherworld (EDHREC 6421) - Return target black creature card from your graveyard to your hand.
235. Gloomshrieker (EDHREC 6618) - When this creature enters, return target permanent card from your graveyard to your hand.
236. Turntimber Sower (EDHREC 6665) - {G}, Sacrifice three creatures: Return target land card from your graveyard to your hand.
237. Consumed by Greed (EDHREC 6700) - If the gift was promised, return target creature card from your graveyard to your hand.
238. Dryad's Revival (EDHREC 6817) - Return target card from your graveyard to your hand.
239. Aerith, Last Ancient (EDHREC 6875) - Raise — At the beginning of your end step, if you gained life this turn, return target creature card from your graveyard to your hand.
240. True Ancestry (EDHREC 6914) - Return up to one target permanent card from your graveyard to your hand.
241. Spring-Leaf Avenger (EDHREC 7003) - Whenever this creature deals combat damage to a player, return target permanent card from your graveyard to your hand.
242. Elena, Turk Recruit (EDHREC 7060) - When Elena enters, return target non-Assassin historic card from your graveyard to your hand.
243. Flood of Recollection (EDHREC 7354) - Return target instant or sorcery card from your graveyard to your hand.
244. Evolution Charm (EDHREC 7385) - • Return target creature card from your graveyard to your hand.
### Dies Triggers Returning The Card To Battlefield

245. Not Dead After All (EDHREC 1050) - Until end of turn, target creature you control gains "When this creature dies, return it to the battlefield tapped under its owner's control, then create a Wicked Role token attached to it." (Enchanted creature gets +1/+1.
246. Luminous Broodmoth (EDHREC 1232) - Whenever a creature you control without flying dies, return it to the battlefield under its owner's control with a flying counter on it.
247. Undying Malice (EDHREC 1373) - Until end of turn, target creature gains "When this creature dies, return it to the battlefield tapped under its owner's control with a +1/+1 counter on it."
248. Feign Death (EDHREC 1461) - Until end of turn, target creature gains "When this creature dies, return it to the battlefield tapped under its owner's control with a +1/+1 counter on it."
249. Fake Your Own Death (EDHREC 1550) - Until end of turn, target creature gets +2/+0 and gains "When this creature dies, return it to the battlefield tapped under its owner's control and you create a Treasure token." (It's an artifact with "{T}, Sacrifice this token: Add one mana of any color.")
250. Supernatural Stamina (EDHREC 1768) - Until end of turn, target creature gets +2/+0 and gains "When this creature dies, return it to the battlefield tapped under its owner's control."
251. Gift of Immortality (EDHREC 2271) - When enchanted creature dies, return that card to the battlefield under its owner's control.
252. Resurrection Orb (EDHREC 4051) - Whenever equipped creature dies, return that card to the battlefield under its owner's control at the beginning of the next end step.
253. Grave Betrayal (EDHREC 4365) - Whenever a creature you don't control dies, return it to the battlefield under your control with an additional +1/+1 counter on it at the beginning of the next end step.
254. Marchesa, the Black Rose (EDHREC 4632) - Whenever a creature you control with a +1/+1 counter on it dies, return that card to the battlefield under your control at the beginning of the next end step.
255. Necrogen Communion (EDHREC 4997) - When enchanted creature dies, return that card to the battlefield under your control.
256. Fungal Fortitude (EDHREC 5261) - When enchanted creature dies, return it to the battlefield tapped under its owner's control.
257. Minion's Return (EDHREC 5275) - When enchanted creature dies, return that card to the battlefield under your control.
258. Valkyrie's Call (EDHREC 5514) - Whenever a nontoken, non-Angel creature you control dies, return that card to the battlefield under its owner's control with a +1/+1 counter on it.
259. Return to Action (EDHREC 7531) - Until end of turn, target creature gets +1/+0 and gains lifelink and "When this creature dies, return it to the battlefield tapped under its owner's control."
260. Vincent's Limit Break (EDHREC 8255) - Until end of turn, target creature you control gains "When this creature dies, return it to the battlefield tapped under its owner's control" and has the chosen base power and toughness.
261. Demonic Gifts (EDHREC 8319) - Until end of turn, target creature gets +2/+0 and gains "When this creature dies, return it to the battlefield under its owner's control."
262. Phytotitan (EDHREC 8351) - When this creature dies, return it to the battlefield tapped under its owner's control at the beginning of their next upkeep.
263. Abnormal Endurance (EDHREC 9332) - Until end of turn, target creature gets +2/+0 and gains "When this creature dies, return it to the battlefield tapped under its owner's control."
264. Bronzehide Lion (EDHREC 9429) - When this creature dies, return it to the battlefield.
265. Missy (EDHREC 9482) - Whenever another nonartifact creature dies, return it to the battlefield under your control face down and tapped.
266. Unholy Indenture (EDHREC 10403) - When enchanted creature dies, return that card to the battlefield under your control with a +1/+1 counter on it.
267. Oathkeeper, Takeno's Daisho (EDHREC 10405) - Whenever equipped creature dies, return that card to the battlefield under your control if it's a Samurai card.
268. Infuse with Vitality (EDHREC 10489) - Until end of turn, target creature gains deathtouch and "When this creature dies, return it to the battlefield tapped under its owner's control."
269. Ashcloud Phoenix (EDHREC 11015) - When this creature dies, return it to the battlefield face down under your control.
270. Yarus, Roar of the Old Gods (EDHREC 11181) - Whenever a face-down creature you control dies, return it to the battlefield face down under its owner's control if it's a permanent card, then turn it face up.
271. Fool's Demise (EDHREC 12439) - When enchanted creature dies, return that card to the battlefield under your control.
272. Scythe of the Wretched (EDHREC 12970) - Whenever a creature dealt damage by equipped creature this turn dies, return that card to the battlefield under your control.
273. Presumed Dead (EDHREC 13172) - Until end of turn, target creature gets +2/+0 and gains "When this creature dies, return it to the battlefield under its owner's control and suspect it." (A suspected creature has menace and can't block.)
274. Perigee Beckoner (EDHREC 13853) - When this creature enters, until end of turn, another target creature you control gets +2/+0 and gains "When this creature dies, return it to the battlefield tapped under its owner's control."
275. Unhallowed Pact (EDHREC 14020) - When enchanted creature dies, return that card to the battlefield under your control.
276. Shade's Form (EDHREC 14774) - When enchanted creature dies, return that card to the battlefield under your control.
277. Edea, Possessed Sorceress (EDHREC 16078) - Whenever a creature you control but don't own dies, return it to the battlefield under its owner's control and you draw a card.
278. Abduction (EDHREC 18211) - When enchanted creature dies, return that card to the battlefield under its owner's control.
279. Dread Slaver (EDHREC 18459) - Whenever a creature dealt damage by this creature this turn dies, return it to the battlefield under your control.
280. False Demise (EDHREC 18518) - When enchanted creature dies, return that card to the battlefield under your control.
281. Pain 101 (EDHREC 19119) - Until end of turn, target creature gains deathtouch and "When this creature dies, return it to the battlefield tapped under its owner's control."
282. Soul Collector (EDHREC 20529) - Whenever a creature dealt damage by this creature this turn dies, return that card to the battlefield under your control.
283. Molten Firebird (EDHREC 24979) - When this creature dies, return it to the battlefield under its owner's control at the beginning of the next end step and you skip your next draw step.
284. Thunderbolts Conspiracy (EDHREC 28725) - Whenever a Villain you control dies, return it to the battlefield under its owner's control with a finality counter on it.
### Dies Triggers Returning The Card To Hand

285. The Locust God (EDHREC 1582) - When The Locust God dies, return it to its owner's hand at the beginning of the next end step.
286. Liesa, Forgotten Archangel (EDHREC 1962) - Whenever another nontoken creature you control dies, return that card to its owner's hand at the beginning of the next end step.
287. Athreos, God of Passage (EDHREC 2758) - Whenever another creature you own dies, return it to your hand unless target opponent pays 3 life.
288. The Scorpion God (EDHREC 5947) - When The Scorpion God dies, return it to its owner's hand at the beginning of the next end step.
289. Rienne, Angel of Rebirth (EDHREC 6648) - Whenever another multicolored creature you control dies, return it to its owner's hand at the beginning of the next end step.
290. Demonic Vigor (EDHREC 12403) - When enchanted creature dies, return that card to its owner's hand.
291. Endless Cockroaches (EDHREC 12520) - When this creature dies, return it to its owner's hand.
292. Verdant Rebirth (EDHREC 13221) - Until end of turn, target creature gains "When this creature dies, return it to its owner's hand."
293. Squee's Embrace (EDHREC 15836) - When enchanted creature dies, return that card to its owner's hand.
294. Immortal Phoenix (EDHREC 17411) - When this creature dies, return it to its owner's hand.
295. Flame-Wreathed Phoenix (EDHREC 18160) - When this creature enters, if tribute wasn't paid, it gains haste and "When this creature dies, return it to its owner's hand."
296. Nissa's Zendikon (EDHREC 19403) - When enchanted land dies, return that card to its owner's hand.
297. Wind Zendikon (EDHREC 19414) - When enchanted land dies, return that card to its owner's hand.
298. Mortus Strider (EDHREC 20965) - When this creature dies, return it to its owner's hand.
299. Weatherseed Treefolk (EDHREC 21793) - When this creature dies, return it to its owner's hand.
300. Guardian Zendikon (EDHREC 22054) - When enchanted land dies, return that card to its owner's hand.
301. Shivan Phoenix (EDHREC 22202) - When this creature dies, return it to its owner's hand.
302. Vastwood Zendikon (EDHREC 23506) - When enchanted land dies, return that card to its owner's hand.
303. Corrupted Zendikon (EDHREC 23901) - When enchanted land dies, return that card to its owner's hand.
304. Crusher Zendikon (EDHREC 24617) - When enchanted land dies, return that card to its owner's hand.
305. Puppet Master (EDHREC 28410) - When enchanted creature dies, return that card to its owner's hand.
### Pay-To-Return Deathmantle-Style Recursion

306. Nim Deathmantle (EDHREC 3299) - Equipped creature gets +2/+2, has intimidate, and is a black Zombie. (A creature with intimidate can't be blocked except by artifact creatures and/or creatures that share a color with it.) Whenever a nontoken creature...
307. Vraska, the Silencer (EDHREC 5262) - Deathtouch Whenever a nontoken creature an opponent controls dies, you may pay {1}. If you do, return that card to the battlefield tapped under your control. It's a Treasure artifact with "{T}, Sacrifice this artifact...
308. Lim-Dûl the Necromancer (EDHREC 18580) - Whenever a creature an opponent controls dies, you may pay {1}{B}. If you do, return that card to the battlefield under your control. If it's a creature, it's a Zombie in addition to its other creature types. {1}{B}: ...
### Entered Or Cast From Graveyard Checks

309. Oskar, Rubbish Reclaimer (EDHREC 10158) - Whenever you discard a nonland card, you may cast it from your graveyard.
310. Rocket-Powered Goblin Glider (EDHREC 11610) - When this Equipment enters, if it was cast from your graveyard, attach it to target creature you control.
311. Prized Amalgam (EDHREC 13131) - Whenever a creature enters, if it entered from your graveyard or you cast it from your graveyard, return this card from your graveyard to the battlefield tapped at the beginning of the next end step.
312. Confession Dial (EDHREC 13149) - (You may cast it from your graveyard for its escape cost this turn.)
313. Skyclave Shade (EDHREC 13263) - Landfall — Whenever a land you control enters, if this card is in your graveyard and it's your turn, you may cast it from your graveyard this turn.
314. Archfiend's Vessel (EDHREC 13850) - When this creature enters, if it entered from your graveyard or you cast it from your graveyard, exile it.
315. Desdemona, Freedom's Edge (EDHREC 15257) - (You may cast it from your graveyard for its escape cost this turn.)
### Leave-Battlefield Exile Replacement Riders

316. Whip of Erebos (EDHREC 722) - If it would leave the battlefield, exile it instead of putting it anywhere else.
317. Moira and Teshar (EDHREC 14473) - If it would leave the battlefield, exile it instead of putting it anywhere else.
318. Kheru Lich Lord (EDHREC 25929) - If it would leave the battlefield, exile it instead of putting it anywhere else.
319. Personal Decoy (unranked) - If it would leave the battlefield, exile it instead of putting it anywhere else.
### Cast From Graveyard Permission Windows

320. Faithless Looting (EDHREC 95) - Flashback {2}{R} (You may cast this card from your graveyard for its flashback cost.
321. Sevinne's Reclamation (EDHREC 345) - Flashback {4}{W} (You may cast this card from your graveyard for its flashback cost.
322. Underworld Breach (EDHREC 399) - (You may cast cards from your graveyard for their escape cost.)
323. Dread Return (EDHREC 521) - (You may cast this card from your graveyard for its flashback cost.
324. Six (EDHREC 561) - (You may cast permanent cards from your graveyard by discarding a land card in addition to paying their other costs.)
325. Gravecrawler (EDHREC 710) - You may cast this card from your graveyard as long as you control a Zombie.
326. Strike It Rich (EDHREC 1190) - Flashback {2}{R} (You may cast this card from your graveyard for its flashback cost.
327. Nature's Rhythm (EDHREC 1231) - Harmonize {X}{G}{G}{G}{G} (You may cast this card from your graveyard for its harmonize cost.
328. Past in Flames (EDHREC 1352) - Flashback {4}{R} (You may cast this card from your graveyard for its flashback cost.
329. Uro, Titan of Nature's Wrath (EDHREC 1411) - (You may cast this card from your graveyard for its escape cost.)
330. Deep Analysis (EDHREC 1454) - (You may cast this card from your graveyard for its flashback cost.
331. Snapcaster Mage (EDHREC 1468) - (You may cast that card from your graveyard for its flashback cost.
332. Chainer, Nightmare Adept (EDHREC 1516) - Discard a card: You may cast a creature spell from your graveyard this turn.
333. Seize the Day (EDHREC 1721) - Flashback {2}{R} (You may cast this card from your graveyard for its flashback cost.
334. Woe Strider (EDHREC 1736) - (You may cast this card from your graveyard for its escape cost.)
335. Army of the Damned (EDHREC 1939) - Flashback {7}{B}{B}{B} (You may cast this card from your graveyard for its flashback cost.
336. Squee, the Immortal (EDHREC 2078) - You may cast this card from your graveyard or from exile.
337. Exploration Broodship (EDHREC 2091) - Once during each of your turns, you may cast a permanent spell from your graveyard by sacrificing a land in addition to paying its other costs.
338. Bulk Up (EDHREC 2104) - Flashback {4}{R}{R} (You may cast this card from your graveyard for its flashback cost.
339. The Indomitable (EDHREC 2171) - You may cast this card from your graveyard as long as you control three or more tapped Pirates and/or Vehicles.
340. Think Twice (EDHREC 2215) - Flashback {2}{U} (You may cast this card from your graveyard for its flashback cost.
341. Primevals' Glorious Rebirth (EDHREC 2419) - (You may cast a legendary sorcery only if you control a legendary creature or planeswalker.) Return all legendary permanent cards from your graveyard to the battlefield.
342. Quilled Greatwurm (EDHREC 2441) - You may cast this card from your graveyard by removing six counters from among creatures you control in addition to paying its other costs.
343. Otherworldly Gaze (EDHREC 2459) - Flashback {1}{U} (You may cast this card from your graveyard for its flashback cost.
344. Resurgent Belief (EDHREC 2543) - Suspend 2—{1}{W} (Rather than cast this card from your hand, pay {1}{W} and exile it with two time counters on it. At the beginning of your upkeep, remove a time counter. When the last is removed, you may cast it with...
345. Momentary Blink (EDHREC 2606) - Flashback {3}{U} (You may cast this card from your graveyard for its flashback cost.
346. Electroduplicate (EDHREC 2623) - Flashback {2}{R}{R} (You may cast this card from your graveyard for its flashback cost.
347. Echo of Eons (EDHREC 2634) - Flashback {2}{U} (You may cast this card from your graveyard for its flashback cost.
348. Lurrus of the Dream-Den (EDHREC 2682) - Once during each of your turns, you may cast a permanent spell with mana value 2 or less from your graveyard.
349. Torrential Gearhulk (EDHREC 2846) - When this creature enters, you may cast target instant card from your graveyard without paying its mana cost.
350. Galvanic Iteration (EDHREC 2852) - Flashback {1}{U}{R} (You may cast this card from your graveyard for its flashback cost.
351. Rivaz of the Claw (EDHREC 2882) - Once during each of your turns, you may cast a Dragon creature spell from your graveyard.
352. Laughing Mad (EDHREC 2890) - Flashback {3}{R} (You may cast this card from your graveyard for its flashback cost and any additional costs.
353. Cackling Counterpart (EDHREC 2925) - Flashback {5}{U}{U} (You may cast this card from your graveyard for its flashback cost.
354. Kess, Dissident Mage (EDHREC 2961) - Once during each of your turns, you may cast an instant or sorcery spell from your graveyard.
### Play From Graveyard Permission Windows

355. Ramunap Excavator (EDHREC 411) - You may play lands from your graveyard.
356. Conduit of Worlds (EDHREC 519) - You may play lands from your graveyard.
357. Crucible of Worlds (EDHREC 570) - You may play lands from your graveyard.
358. Ancient Greenwarden (EDHREC 649) - You may play lands from your graveyard.
359. Icetill Explorer (EDHREC 957) - You may play lands from your graveyard.
360. Muldrotha, the Gravetide (EDHREC 1139) - During each of your turns, you may play a land and cast a permanent spell of each permanent type from your graveyard.
361. Wrenn and Realmbreaker (EDHREC 2489) - −7: You get an emblem with "You may play lands and cast permanent spells from your graveyard."
362. Ignite the Future (EDHREC 3390) - Exile the top three cards of your library. Until the end of your next turn, you may play those cards. If this spell was cast from a graveyard, you may play cards this way without paying their mana costs. Flashback {7}...
363. Perennial Behemoth (EDHREC 3549) - You may play lands from your graveyard.
364. Titania, Nature's Force (EDHREC 3816) - You may play Forests from your graveyard.
365. Serra Paragon (EDHREC 4141) - Once during each of your turns, you may play a land from your graveyard or cast a permanent spell with mana value 3 or less from your graveyard.
366. Szarel, Genesis Shepherd (EDHREC 4875) - You may play lands from your graveyard.
367. Oscorp Industries (EDHREC 5074) - Mayhem (You may play this card from your graveyard if you discarded it this turn.
368. Glacierwood Siege (EDHREC 5807) - • Sultai — You may play lands from your graveyard.
369. Embrace the Unknown (EDHREC 6105) - Exile the top two cards of your library. Until the end of your next turn, you may play those cards. Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
370. Zask, Skittering Swarmlord (EDHREC 6660) - You may play lands and cast Insect spells from your graveyard.
371. Hazezon, Shaper of Sand (EDHREC 6696) - You may play Desert lands from your graveyard.
372. Kethis, the Hidden Hand (EDHREC 6937) - Exile two legendary cards from your graveyard: Until end of turn, each legendary card in your graveyard gains "You may play this card from your graveyard."
373. Horde of Notions (EDHREC 6963) - {W}{U}{B}{R}{G}: You may play target Elemental card from your graveyard without paying its mana cost.
374. Zenith Festival (EDHREC 8081) - Exile the top X cards of your library. You may play them until the end of your next turn. Harmonize {X}{R}{R} (You may cast this card from your graveyard for its harmonize cost. You may tap a creature you control to r...
375. The Eighth Doctor (EDHREC 10872) - Once during each of your turns, you may play a historic land or cast a historic permanent spell from your graveyard.
376. Lidless Gaze (EDHREC 11635) - Exile the top card of each player's library. Until the end of your next turn, you may play those cards, and mana of any type can be spent to cast those spells. Flashback {2}{B}{R} (You may cast this card from your gra...
377. Mishra's Research Desk (EDHREC 14867) - {1}, {T}, Sacrifice this artifact: Exile the top two cards of your library. Choose one of them. Until the end of your next turn, you may play that card. Unearth {1}{R} ({1}{R}: Return this card from your graveyard to ...
378. Gaea's Will (EDHREC 15090) - Until end of turn, you may play lands and cast spells from your graveyard.
379. Magus of the Will (EDHREC 16347) - {2}{B}, {T}, Exile this creature: Until end of turn, you may play lands and cast spells from your graveyard.
### Flashback Cards

380. Lier, Disciple of the Drowned (EDHREC 2270) - Each instant and sorcery card in your graveyard has flashback.
381. Will of the Jeskai (EDHREC 2812) - • Each instant and sorcery card in your graveyard gains flashback until end of turn.
382. Increasing Vengeance (EDHREC 3012) - Flashback {3}{R}{R} (You may cast this card from your graveyard for its flashback cost.
383. Increasing Devotion (EDHREC 3176) - Flashback {7}{W}{W} (You may cast this card from your graveyard for its flashback cost.
384. Prisoner's Dilemma (EDHREC 3343) - Flashback {5}{R}{R}
385. Divine Reckoning (EDHREC 3428) - Flashback {5}{W}{W} (You may cast this card from your graveyard for its flashback cost.
386. Rite of Oblivion (EDHREC 3459) - Flashback {2}{W}{B} (You may cast this card from your graveyard for its flashback cost and any additional costs.
387. Faithful Mending (EDHREC 3467) - Flashback {1}{W}{U} (You may cast this card from your graveyard for its flashback cost.
388. Eviscerator's Insight (EDHREC 3822) - Flashback {4}{B} (You may cast this card from your graveyard for its flashback cost and any additional costs.
389. Unburial Rites (EDHREC 3875) - Flashback {3}{W} (You may cast this card from your graveyard for its flashback cost.
390. Siphon Insight (EDHREC 3882) - Flashback {1}{U}{B}
391. Rite of Harmony (EDHREC 4074) - Flashback {2}{G}{W} (You may cast this card from your graveyard for its flashback cost.
392. Artful Dodge (EDHREC 4075) - Flashback {U} (You may cast this card from your graveyard for its flashback cost.
393. Nibelheim Aflame (EDHREC 4701) - Flashback {5}{R}{R} (You may cast this card from your graveyard for its flashback cost.
394. Angelfire Ignition (EDHREC 4828) - Flashback {2}{R}{W} (You may cast this card from your graveyard for its flashback cost.
395. Forbidden Alchemy (EDHREC 5266) - Flashback {6}{B} (You may cast this card from your graveyard for its flashback cost.
396. Croaking Counterpart (EDHREC 5362) - Flashback {3}{G}{U} (You may cast this card from your graveyard for its flashback cost.
397. Electric Revelation (EDHREC 5380) - Flashback {3}{R} (You may cast this card from your graveyard for its flashback cost and any additional costs.
398. Memory Deluge (EDHREC 5835) - Flashback {5}{U}{U} (You may cast this card from your graveyard for its flashback cost.
399. Summons of Saruman (EDHREC 5944) - Flashback—{3}{U}{R}, Exile X cards from your graveyard.
400. Moment's Peace (EDHREC 6000) - Flashback {2}{G} (You may cast this card from your graveyard for its flashback cost.

## Notes

- Regenerate this file with `node tools/build-next-automation-queue.js --count 200 --offset 200` whenever the corpus or family priorities change.
- If product scope widens beyond graveyard-heavy seams, add new family configs rather than manually editing the queue body.
- For cards with quoted granted text, queue the grant and the granted effect separately instead of collapsing them into the host effect line.

