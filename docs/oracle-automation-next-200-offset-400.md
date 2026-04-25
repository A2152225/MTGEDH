# Oracle Automation Next 200 (Items 401-600)

Generated: `2026-04-25T16:45:06.731Z`
Source: `oracle-cards.json`
Scope: black-border paper-card automation candidates ordered by seam priority. The queue exhausts the active graveyard / recursion seam first, then spills into the next highest-population seams.

Queued items: `200`
Queue window: `401-600`

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
| Flashback Cards | Graveyard Permission / Replacement | 41 | 230 | Stable, populous graveyard-casting family to validate once permission windows and replacement text are tightened. |
| Unearth Cards | Graveyard Permission / Replacement | 40 | 60 | Pairs graveyard reanimation with the leave-battlefield exile replacement rider. |
| Escape And Similar Graveyard Alternate Costs | Graveyard Permission / Replacement | 55 | 108 | Includes escape-style casting/replay from graveyard with additional costs or modifiers. |
| Token Creation | High-Population Follow-On Seams | 64 | 3299 | Large practical seam spanning straightforward token creation, tapped/token modifier variants, and delayed cleanup follow-ups. |

## Ordered Queue

### Flashback Cards

401. Lingering Souls (EDHREC 5898) - Flashback {1}{B} (You may cast this card from your graveyard for its flashback cost.
402. Summons of Saruman (EDHREC 5924) - Flashback—{3}{U}{R}, Exile X cards from your graveyard.
403. Moment's Peace (EDHREC 5988) - Flashback {2}{G} (You may cast this card from your graveyard for its flashback cost.
404. Visions of Glory (EDHREC 6061) - Flashback {8}{W}{W}.
405. Snort (EDHREC 6063) - Flashback {5}{R} (You may cast this card from your graveyard for its flashback cost.
406. Isengard Unleashed (EDHREC 6077) - Flashback {4}{R}{R}{R} (You may cast this card from your graveyard for its flashback cost.
407. Lava Dart (EDHREC 6263) - Flashback—Sacrifice a Mountain.
408. Rockalanche (EDHREC 6395) - Flashback {5}{G} (You may cast this card from your graveyard for its flashback cost.
409. Reckless Charge (EDHREC 6479) - Flashback {2}{R} (You may cast this card from your graveyard for its flashback cost.
410. Creeping Renaissance (EDHREC 6566) - Flashback {5}{G}{G} (You may cast this card from your graveyard for its flashback cost.
411. Ancient Grudge (EDHREC 6779) - Flashback {G} (You may cast this card from your graveyard for its flashback cost.
412. Revenge of the Rats (EDHREC 6811) - Flashback {2}{B}{B} (You may cast this card from your graveyard for its flashback cost.
413. Iroh, Grand Lotus (EDHREC 7042) - During your turn, each non-Lesson instant and sorcery card in your graveyard has flashback.
414. Visions of Dominance (EDHREC 7161) - Flashback {8}{G}{G}.
415. Battle Screech (EDHREC 7380) - Flashback—Tap three untapped white creatures you control.
416. For the Ancestors (EDHREC 7394) - Flashback {3}{G} (You may cast this card from your graveyard for its flashback cost.
417. Spider Spawning (EDHREC 7410) - Flashback {6}{B} (You may cast this card from your graveyard for its flashback cost.
418. Resentful Revelation (EDHREC 7456) - Flashback {6}{B} (You may cast this card from your graveyard for its flashback cost.
419. Welcome the Dead (EDHREC 7692) - Flashback {5}{B} (You may cast this card from your graveyard for its flashback cost.
420. Chatter of the Squirrel (EDHREC 7712) - Flashback {1}{G} (You may cast this card from your graveyard for its flashback cost.
421. Backdraft Hellkite (EDHREC 7740) - Whenever this creature attacks, each instant and sorcery card in your graveyard gains flashback until end of turn.
422. Fire Nation Attacks (EDHREC 7981) - Flashback {8}{R} (You may cast this card from your graveyard for its flashback cost.
423. Solstice Revelations (EDHREC 8001) - Flashback {6}{R} (You may cast this card from your graveyard for its flashback cost.
424. Wreck and Rebuild (EDHREC 8055) - Flashback {3}{R}{G}
425. Visions of Ruin (EDHREC 8119) - Flashback {8}{R}{R}.
426. Wake the Dragon (EDHREC 8183) - Flashback {6}{B}{R} (You may cast this card from your graveyard for its flashback cost.
427. Sorceress's Schemes (EDHREC 8362) - Return target instant or sorcery card from your graveyard or exiled card with flashback you own to your hand.
428. Mass Diminish (EDHREC 8550) - Flashback {3}{U} (You may cast this card from your graveyard for its flashback cost.
429. Dreams of Laguna (EDHREC 8573) - Flashback {3}{U} (You may cast this card from your graveyard for its flashback cost.
430. Otterball Antics (EDHREC 8872) - Flashback {3}{U} (You may cast this card from your graveyard for its flashback cost.
431. Return the Past (EDHREC 8909) - During your turn, each instant and sorcery card in your graveyard has flashback.
432. Sphinx of Forgotten Lore (EDHREC 9216) - Whenever this creature attacks, target instant or sorcery card in your graveyard gains flashback until end of turn.
433. Devil's Play (EDHREC 9385) - Flashback {X}{R}{R}{R} (You may cast this card from your graveyard for its flashback cost.
434. Increasing Savagery (EDHREC 9487) - Flashback {5}{G}{G} (You may cast this card from your graveyard for its flashback cost.
435. Increasing Confusion (EDHREC 9531) - Flashback {X}{U} (You may cast this card from your graveyard for its flashback cost.
436. Rootcoil Creeper (EDHREC 9561) - {G}{U}, {T}, Exile this creature: Return target card with flashback you own from exile to your hand.
437. Vengeful Regrowth (EDHREC 9698) - Flashback {6}{G}{G} (You may cast this card from your graveyard for its flashback cost.
438. Dire-Strain Rampage (EDHREC 9736) - Flashback {3}{R}{G}
439. Gysahl Greens (EDHREC 9842) - Flashback {6}{G} (You may cast this card from your graveyard for its flashback cost.
440. Increasing Ambition (EDHREC 9980) - Flashback {7}{B} (You may cast this card from your graveyard for its flashback cost.
441. Mystical Teachings (EDHREC 9994) - Flashback {5}{B} (You may cast this card from your graveyard for its flashback cost.
### Unearth Cards

442. Molten Gatekeeper (EDHREC 1252) - Unearth {R} ({R}: Return this card from your graveyard to the battlefield.
443. Cityscape Leveler (EDHREC 2160) - Unearth {8}
444. Priest of Fell Rites (EDHREC 2694) - Unearth {3}{W}{B} ({3}{W}{B}: Return this card from your graveyard to the battlefield.
445. Terisian Mindbreaker (EDHREC 4502) - Unearth {1}{U}{U}{U} ({1}{U}{U}{U}: Return this card from your graveyard to the battlefield.
446. Fatestitcher (EDHREC 6254) - Unearth {U} ({U}: Return this card from your graveyard to the battlefield.
447. Salvation Colossus (EDHREC 6526) - Unearth—Pay eight {E}.
448. Chronomancer (EDHREC 7187) - Unearth {2}{B} ({2}{B}: Return this card from your graveyard to the battlefield.
449. Canoptek Tomb Sentinel (EDHREC 7407) - Unearth {7} ({7}: Return this card from your graveyard to the battlefield.
450. Skorpekh Lord (EDHREC 7619) - Unearth {2}{B} ({2}{B}: Return this card from your graveyard to the battlefield.
451. Phyrexian Dragon Engine (EDHREC 7852) - Unearth {3}{R}{R}
452. Rotting Rats (EDHREC 8197) - Unearth {1}{B} ({1}{B}: Return this card from your graveyard to the battlefield.
453. Mishra, Tamer of Mak Fawa (EDHREC 8590) - Each artifact card in your graveyard has unearth {1}{B}{R}.
454. Corpse Connoisseur (EDHREC 8624) - Unearth {3}{B} ({3}{B}: Return this card from your graveyard to the battlefield.
455. Triarch Praetorian (EDHREC 8739) - Unearth {4}{B} ({4}{B}: Return this card from your graveyard to the battlefield.
456. Kederekt Leviathan (EDHREC 9422) - Unearth {6}{U} ({6}{U}: Return this card from your graveyard to the battlefield.
457. Platoon Dispenser (EDHREC 9567) - Unearth {2}{W}{W}
458. Royal Warden (EDHREC 9915) - Unearth {3}{B} ({3}{B}: Return this card from your graveyard to the battlefield.
459. Simian Simulacrum (EDHREC 9986) - Unearth {2}{G}{G} ({2}{G}{G}: Return this card from your graveyard to the battlefield.
460. Dregscape Sliver (EDHREC 10250) - Each Sliver creature card in your graveyard has unearth {2}.
461. Anathemancer (EDHREC 10718) - Unearth {5}{B}{R} ({5}{B}{R}: Return this card from your graveyard to the battlefield.
462. Lokhust Heavy Destroyer (EDHREC 10721) - Unearth {5}{B}{B}{B} ({5}{B}{B}{B}: Return this card from your graveyard to the battlefield.
463. Solemn Doomguide (EDHREC 10873) - Each creature card in your graveyard that's a Cleric, Rogue, Warrior, and/or Wizard has unearth {1}{B}.
464. Sedris, the Traitor King (EDHREC 12281) - Each creature card in your graveyard has unearth {2}{B}.
465. Combat Courier (EDHREC 12566) - Unearth {U} ({U}: Return this card from your graveyard to the battlefield.
466. Meticulous Excavation (EDHREC 12826) - If it has unearth, instead exile it, then return that card to its owner's hand.
467. Ghost Ark (EDHREC 13036) - Repair Barge — Whenever this Vehicle becomes crewed, each artifact creature card in your graveyard gains unearth {3} until end of turn.
468. Scrapwork Mutt (EDHREC 13522) - Unearth {1}{R} ({1}{R}: Return this card from your graveyard to the battlefield.
469. Hexmark Destroyer (EDHREC 13862) - Unearth {4}{B}{B} ({4}{B}{B}: Return this card from your graveyard to the battlefield.
470. Archfiend of Sorrows (EDHREC 14315) - Unearth {3}{B}{B} ({3}{B}{B}: Return this card from your graveyard to the battlefield.
471. Extractor Demon (EDHREC 15787) - Unearth {2}{B} ({2}{B}: Return this card from your graveyard to the battlefield.
472. Tomb Blade (EDHREC 15916) - Unearth {6}{B}{B}
473. Vithian Stinger (EDHREC 16609) - Unearth {1}{R} ({1}{R}: Return this card from your graveyard to the battlefield.
474. Artificer's Dragon (EDHREC 17410) - Unearth {3}{R}{R} ({3}{R}{R}: Return this card from your graveyard to the battlefield.
475. Terror Ballista (EDHREC 18155) - Unearth {3}{B}{B} ({3}{B}{B}: Return this card from your graveyard to the battlefield.
476. Hellspark Elemental (EDHREC 18931) - Unearth {1}{R} ({1}{R}: Return this card from your graveyard to the battlefield.
477. First-Sphere Gargantua (EDHREC 19124) - Unearth {2}{B} ({2}{B}: Return this card from your graveyard to the battlefield.
478. Hell's Thunder (EDHREC 19468) - Unearth {4}{R} ({4}{R}: Return this card from your graveyard to the battlefield.
479. Scrapwork Rager (EDHREC 19650) - Unearth {3}{B} ({3}{B}: Return this card from your graveyard to the battlefield.
480. Sedraxis Specter (EDHREC 19757) - Unearth {1}{B} ({1}{B}: Return this card from your graveyard to the battlefield.
481. Yotian Frontliner (EDHREC 20441) - Unearth {W} ({W}: Return this card from your graveyard to the battlefield.
### Escape And Similar Graveyard Alternate Costs

482. Fanatic of Rhonas (EDHREC 458) - Eternalize {2}{G}{G} ({2}{G}{G}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a 4/4 black Zombie Snake Druid with no mana cost.
483. Quasiduplicate (EDHREC 3306) - Jump-start (You may cast this card from your graveyard by discarding a card in addition to paying its other costs.
484. Vizier of Many Faces (EDHREC 4248) - Embalm {3}{U}{U}
485. Kroxa, Titan of Death's Hunger (EDHREC 4687) - Escape—{B}{B}{R}{R}, Exile five other cards from your graveyard.
486. The Master of Keys (EDHREC 5059) - Each enchantment card in your graveyard has escape.
487. Formless Genesis (EDHREC 5571) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
488. Throes of Chaos (EDHREC 5607) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
489. Bloodbraid Challenger (EDHREC 6407) - Escape—{3}{R}{G}, Exile three other cards from your graveyard.
490. Adorned Pouncer (EDHREC 6824) - Eternalize {3}{W}{W} ({3}{W}{W}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a 4/4 black Zombie Cat with no mana cost.
491. Champion of Wits (EDHREC 6825) - Eternalize {5}{U}{U} ({5}{U}{U}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a 4/4 black Zombie Snake Wizard with no mana cost.
492. Deeproot Historian (EDHREC 6877) - Merfolk and Druid cards in your graveyard have retrace.
493. Sentinel's Eyes (EDHREC 7212) - Escape—{W}, Exile two other cards from your graveyard.
494. Decaying Time Loop (EDHREC 7222) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
495. Chemister's Insight (EDHREC 7308) - Jump-start (You may cast this card from your graveyard by discarding a card in addition to paying its other costs.
496. Radical Idea (EDHREC 7510) - Jump-start (You may cast this card from your graveyard by discarding a card in addition to paying its other costs.
497. Risk Factor (EDHREC 7913) - Jump-start (You may cast this card from your graveyard by discarding a card in addition to paying its other costs.
498. Sacred Cat (EDHREC 8238) - Embalm {W} ({W}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a white Zombie Cat with no mana cost.
499. Cursecloth Wrappings (EDHREC 8264) - {T}: Target creature card in your graveyard gains embalm until end of turn.
500. Phlage, Titan of Fire's Fury (EDHREC 8296) - Escape—{R}{R}{W}{W}, Exile five other cards from your graveyard.
501. Angel of Sanctions (EDHREC 8597) - Embalm {5}{W} ({5}{W}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a white Zombie Angel with no mana cost.
502. Timeless Dragon (EDHREC 8655) - Eternalize {2}{W}{W} ({2}{W}{W}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a 4/4 black Zombie Dragon with no mana cost.
503. Nethergoyf (EDHREC 8680) - Escape—{2}{B}, Exile any number of other cards from your graveyard with four or more card types among them.
504. Chainweb Aracnir (EDHREC 9011) - Escape—{3}{G}{G}, Exile four other cards from your graveyard.
505. Aven Wind Guide (EDHREC 9019) - Embalm {4}{W}{U} ({4}{W}{U}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a white Zombie Bird Warrior with no mana cost.
506. The Grim Captain's Locker (EDHREC 9022) - {T}: Until end of turn, each creature card in your graveyard gains "Escape—{3}{B}, Exile four other cards from your graveyard." (You may cast a card with escape from your graveyard for its escape cost.)
507. Ox of Agonas (EDHREC 9293) - Escape—{R}{R}, Exile eight other cards from your graveyard.
508. Gravitic Punch (EDHREC 9348) - Jump-start (You may cast this card from your graveyard by discarding a card in addition to paying its other costs.
509. Waves of Aggression (EDHREC 9671) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
510. Reality Scramble (EDHREC 9759) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
511. Spitting Image (EDHREC 10582) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
512. Worm Harvest (EDHREC 10745) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
513. Polukranos, Unchained (EDHREC 10920) - Escape—{4}{B}{G}, Exile six other cards from your graveyard.
514. Anointer Priest (EDHREC 11012) - Embalm {3}{W} ({3}{W}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a white Zombie Human Cleric with no mana cost.
515. Charred Graverobber (EDHREC 11028) - Escape—{3}{B}{B}, Exile four other cards from your graveyard.
516. Beacon Bolt (EDHREC 11401) - Jump-start (You may cast this card from your graveyard by discarding a card in addition to paying its other costs.
517. Dihada's Ploy (EDHREC 11590) - Jump-start (You may cast this card from your graveyard by discarding a card in addition to paying its other costs.
518. Chronomantic Escape (EDHREC 11661) - Exile Chronomantic Escape with three time counters on it.
519. Flame Jab (EDHREC 11708) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
520. Run for Your Life (EDHREC 11938) - Escape—{2}{U}{R}, Exile four other cards from your graveyard.
521. Start the TARDIS (EDHREC 12868) - Jump-start (You may cast this card from your graveyard by discarding a card in addition to paying its other costs.
522. Niv-Mizzet, Supreme (EDHREC 13033) - Each instant and sorcery card in your graveyard that's exactly two colors has jump-start.
523. Elspeth, Sun's Nemesis (EDHREC 13855) - Escape—{4}{W}{W}, Exile four other cards from your graveyard.
524. Filigree Racer (EDHREC 14008) - When you do, target instant or sorcery card in your graveyard gains jump-start until end of turn.
525. Glamerdye (EDHREC 14563) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
526. Raven's Crime (EDHREC 14991) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
527. Oona's Grace (EDHREC 15269) - Retrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)
528. Dreamstealer (EDHREC 15557) - Eternalize {4}{B}{B} ({4}{B}{B}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a 4/4 black Zombie Human Wizard with no mana cost.
529. Skyway Robber (EDHREC 15632) - Escape—{3}{U}, Exile five other cards from your graveyard.
530. Lunar Hatchling (EDHREC 15956) - Escape—{4}{G}{U}, Exile a land you control, Exile five other cards from your graveyard.
531. Phoenix of Ash (EDHREC 16056) - Escape—{2}{R}{R}, Exile three other cards from your graveyard.
532. Escape Velocity (EDHREC 16647) - Escape—{1}{R}, Exile two other cards from your graveyard.
533. Honored Hydra (EDHREC 16770) - Embalm {3}{G} ({3}{G}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a white Zombie Snake Hydra with no mana cost.
534. Maximize Velocity (EDHREC 17380) - Jump-start (You may cast this card from your graveyard by discarding a card in addition to paying its other costs.
535. Satyr's Cunning (EDHREC 17811) - Escape—{2}{R}, Exile two other cards from your graveyard.
536. Heart-Piercer Manticore (EDHREC 18303) - Embalm {5}{R} ({5}{R}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a white Zombie Manticore with no mana cost.
### Token Creation

537. Smothering Tithe (EDHREC 59) - If the player doesn't, you create a Treasure token.
538. Urza's Saga (EDHREC 121) - II — This Saga gains "{2}, {T}: Create a 0/0 colorless Construct artifact creature token with 'This token gets +1/+1 for each artifact you control.'"
539. Deadly Dispute (EDHREC 132) - Draw two cards and create a Treasure token.
540. Black Market Connections (EDHREC 133) - • Sell Contraband — Create a Treasure token.
541. Big Score (EDHREC 169) - Draw two cards and create two Treasure tokens.
542. Tireless Provisioner (EDHREC 177) - Landfall — Whenever a land you control enters, create a Food token or a Treasure token.
543. Idol of Oblivion (EDHREC 200) - {8}, {T}, Sacrifice this artifact: Create a 10/10 colorless Eldrazi creature token.
544. Doubling Season (EDHREC 206) - If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.
545. Professional Face-Breaker (EDHREC 217) - Whenever one or more creatures you control deal combat damage to a player, create a Treasure token.
546. Scute Swarm (EDHREC 224) - Landfall — Whenever a land you control enters, create a 1/1 green Insect creature token.
547. Storm-Kiln Artist (EDHREC 231) - Magecraft — Whenever you cast or copy an instant or sorcery spell, create a Treasure token.
548. Pitiless Plunderer (EDHREC 233) - Whenever another creature you control dies, create a Treasure token.
549. Academy Manufactor (EDHREC 261) - If you would create a Clue, Food, or Treasure token, instead create one of each.
550. Avenger of Zendikar (EDHREC 265) - When this creature enters, create a 0/1 green Plant creature token for each land you control.
551. Ragavan, Nimble Pilferer (EDHREC 268) - Whenever Ragavan deals combat damage to a player, create a Treasure token and exile the top card of that player's library.
552. Unexpected Windfall (EDHREC 300) - Draw two cards and create two Treasure tokens.
553. Bastion of Remembrance (EDHREC 333) - When this enchantment enters, create a 1/1 white Human Soldier creature token.
554. Anointed Procession (EDHREC 350) - If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.
555. Rampaging Baloths (EDHREC 360) - Landfall — Whenever a land you control enters, create a 4/4 green Beast creature token.
556. Helm of the Host (EDHREC 394) - At the beginning of combat on your turn, create a token that's a copy of equipped creature, except the token isn't legendary.
557. Lotho, Corrupt Shirriff (EDHREC 407) - Whenever a player casts their second spell each turn, you lose 1 life and create a Treasure token.
558. Parallel Lives (EDHREC 409) - If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.
559. Goldspan Dragon (EDHREC 411) - Whenever this creature attacks or becomes the target of a spell, create a Treasure token.
560. Field of the Dead (EDHREC 437) - Whenever this land or another land you control enters, if you control seven or more lands with different names, create a 2/2 black Zombie creature token.
561. Warren Soultrader (EDHREC 457) - Pay 1 life, Sacrifice another creature: Create a Treasure token.
562. Felidar Retreat (EDHREC 472) - • Create a 2/2 white Cat Beast creature token.
563. Maskwood Nexus (EDHREC 482) - {3}, {T}: Create a 2/2 blue Shapeshifter creature token with changeling.
564. Treasure Vault (EDHREC 500) - {X}{X}, {T}, Sacrifice this land: Create X Treasure tokens.
565. Adeline, Resplendent Cathar (EDHREC 512) - Whenever you attack, for each opponent, create a 1/1 white Human creature token that's tapped and attacking that player or a planeswalker they control.
566. Marionette Apprentice (EDHREC 570) - Fabricate 1 (When this creature enters, put a +1/+1 counter on it or create a 1/1 colorless Servo artifact creature token.)
567. The Reaver Cleaver (EDHREC 582) - Equipped creature gets +1/+1 and has trample and "Whenever this creature deals combat damage to a player or planeswalker, create that many Treasure tokens."
568. Tireless Tracker (EDHREC 604) - (Create a Clue token.
569. Bitterblossom (EDHREC 620) - At the beginning of your upkeep, you lose 1 life and create a 1/1 black Faerie Rogue creature token with flying.
570. Voice of Victory (EDHREC 623) - Mobilize 2 (Whenever this creature attacks, create two tapped and attacking 1/1 red Warrior creature tokens.
571. Ancient Copper Dragon (EDHREC 653) - You create a number of Treasure tokens equal to the result.
572. Castle Ardenvale (EDHREC 675) - {2}{W}{W}, {T}: Create a 1/1 white Human creature token.
573. Caretaker's Talent (EDHREC 696) - When this Class becomes level 2, create a token that's a copy of target token you control.
574. Loyal Apprentice (EDHREC 713) - Lieutenant — At the beginning of combat on your turn, if you control your commander, create a 1/1 colorless Thopter artifact creature token with flying.
575. Springheart Nantuko (EDHREC 715) - If you didn't create a token this way, create a 1/1 green Insect creature token.
576. Curse of Opulence (EDHREC 717) - Whenever enchanted player is attacked, create a Gold token.
577. Chasm Skulker (EDHREC 718) - When this creature dies, create X 1/1 blue Squid creature tokens with islandwalk, where X is the number of +1/+1 counters on this creature.
578. Talrand, Sky Summoner (EDHREC 720) - Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.
579. Elspeth, Sun's Champion (EDHREC 745) - +1: Create three 1/1 white Soldier creature tokens.
580. Liliana, Dreadhorde General (EDHREC 749) - +1: Create a 2/2 black Zombie creature token.
581. Young Pyromancer (EDHREC 765) - Whenever you cast an instant or sorcery spell, create a 1/1 red Elemental creature token.
582. Ophiomancer (EDHREC 768) - At the beginning of each upkeep, if you control no Snakes, create a 1/1 black Snake creature token with deathtouch.
583. Urza, Lord High Artificer (EDHREC 782) - When Urza enters, create a 0/0 colorless Construct artifact creature token with "This token gets +1/+1 for each artifact you control."
584. Gilded Goose (EDHREC 788) - When this creature enters, create a Food token.
585. Sai, Master Thopterist (EDHREC 792) - Whenever you cast an artifact spell, create a 1/1 colorless Thopter artifact creature token with flying.
586. Into the Flood Maw (EDHREC 815) - If you do, they create a tapped 1/1 blue Fish creature token before its other effects.)
587. Krenko, Tin Street Kingpin (EDHREC 819) - Whenever Krenko attacks, put a +1/+1 counter on it, then create a number of 1/1 red Goblin creature tokens equal to Krenko's power.
588. Myr Battlesphere (EDHREC 855) - When this creature enters, create four 1/1 colorless Myr artifact creature tokens.
589. Grim Hireling (EDHREC 860) - Whenever one or more creatures you control deal combat damage to a player, create two Treasure tokens.
590. Coruscation Mage (EDHREC 868) - If you do, when this creature enters, create a 1/1 token copy of it.)
591. Old Gnawbone (EDHREC 873) - Whenever a creature you control deals combat damage to a player, create that many Treasure tokens.
592. Thopter Spy Network (EDHREC 880) - At the beginning of your upkeep, if you control an artifact, create a 1/1 colorless Thopter artifact creature token with flying.
593. Inkshield (EDHREC 897) - For each 1 damage prevented this way, create a 2/1 white and black Inkling creature token with flying.
594. Blade of Selves (EDHREC 899) - Equipped creature has myriad. (Whenever it attacks, for each opponent other than defending player, you may create a token copy that's tapped and attacking that player or a planeswalker they control. Exile the tokens a...
595. Elspeth, Storm Slayer (EDHREC 922) - +1: Create a 1/1 white Soldier creature token.
596. Sokenzan, Crucible of Defiance (EDHREC 924) - Channel — {3}{R}, Discard this card: Create two 1/1 colorless Spirit creature tokens.
597. Omnath, Locus of Rage (EDHREC 938) - Landfall — Whenever a land you control enters, create a 5/5 red and green Elemental creature token.
598. Xorn (EDHREC 949) - If you would create one or more Treasure tokens, instead create those tokens plus an additional Treasure token.
599. Irenicus's Vile Duplication (EDHREC 952) - Create a token that's a copy of target creature you control, except the token has flying and it isn't legendary.
600. Oketra's Monument (EDHREC 961) - Whenever you cast a creature spell, create a 1/1 white Warrior creature token with vigilance.

## Notes

- Regenerate this file with `node tools/build-next-automation-queue.js --count 200 --offset 400` whenever the corpus or family priorities change.
- If product scope widens beyond graveyard-heavy seams, add new family configs rather than manually editing the queue body.
- For cards with quoted granted text, queue the grant and the granted effect separately instead of collapsing them into the host effect line.

