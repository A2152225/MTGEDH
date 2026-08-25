// Origin parent: rules-engine/src/CardAnalyzer.ts
// Cluster moved: BENEFICIAL_DEATH_CARDS (Veteran Explorer-like death payoffs).
// Public entry symbols: BENEFICIAL_DEATH_CARDS.
// Leaf must not import CardAnalyzer.ts or CardAnalyzer-handlers/index.ts.

// Cards that benefit from dying (for Veteran Explorer-like effects)
export const BENEFICIAL_DEATH_CARDS: Record<string, { effect: string; symmetric: boolean; priority: number }> = {
  "veteran explorer": { effect: "Each player searches for 2 basic lands", symmetric: true, priority: 10 },
  "sakura-tribe elder": { effect: "Search for a basic land", symmetric: false, priority: 8 },
  "solemn simulacrum": { effect: "Draw a card", symmetric: false, priority: 7 },
  "yavimaya elder": { effect: "Search for 2 basic lands", symmetric: false, priority: 8 },
  "wood elves": { effect: "Search for a Forest", symmetric: false, priority: 7 },
  "farhaven elf": { effect: "Search for a basic land", symmetric: false, priority: 7 },
  "elvish visionary": { effect: "Draw a card", symmetric: false, priority: 5 },
  "coiling oracle": { effect: "Reveal top card, land to battlefield or hand", symmetric: false, priority: 6 },
  "fiend hunter": { effect: "Return exiled creature (flicker combo)", symmetric: false, priority: 6 },
  "eternal witness": { effect: "Return card from graveyard (with flicker)", symmetric: false, priority: 7 },
  "stonehorn dignitary": { effect: "Skip combat (with flicker)", symmetric: false, priority: 5 },
  "ravenous chupacabra": { effect: "Destroy creature (with flicker)", symmetric: false, priority: 6 },
  "shriekmaw": { effect: "Destroy nonblack/artifact creature", symmetric: false, priority: 6 },
  "acidic slime": { effect: "Destroy artifact/enchantment/land", symmetric: false, priority: 7 },
  "reclamation sage": { effect: "Destroy artifact or enchantment", symmetric: false, priority: 6 },
  "kokusho, the evening star": { effect: "Each opponent loses 5 life, you gain", symmetric: false, priority: 9 },
  "wurmcoil engine": { effect: "Create 2 Wurm tokens", symmetric: false, priority: 8 },
  "hangarback walker": { effect: "Create Thopter tokens", symmetric: false, priority: 7 },
  "doomed traveler": { effect: "Create 1/1 Spirit token", symmetric: false, priority: 5 },
  "tuktuk the explorer": { effect: "Create 5/5 Golem token", symmetric: false, priority: 6 },
  "mitotic slime": { effect: "Create 2 Ooze tokens", symmetric: false, priority: 6 },
  "reef worm": { effect: "Create bigger Fish token", symmetric: false, priority: 7 },
  "archon of cruelty": { effect: "Opponent discards, loses life, you gain", symmetric: false, priority: 8 },
  "grave titan": { effect: "Create Zombie tokens", symmetric: false, priority: 8 },
  "sun titan": { effect: "Return permanent CMC 3 or less", symmetric: false, priority: 8 },
  "mulldrifter": { effect: "Draw 2 cards", symmetric: false, priority: 7 },
  "reveillark": { effect: "Return 2 creatures power 2 or less", symmetric: false, priority: 9 },
  "karmic guide": { effect: "Return creature from graveyard", symmetric: false, priority: 8 },
};
