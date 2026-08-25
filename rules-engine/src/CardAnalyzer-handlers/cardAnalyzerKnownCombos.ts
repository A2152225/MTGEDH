// Origin parent: rules-engine/src/CardAnalyzer.ts
// Cluster moved: KNOWN_COMBOS (named combo-piece partners).
// Public entry symbols: KNOWN_COMBOS.
// Leaf must not import CardAnalyzer.ts or CardAnalyzer-handlers/index.ts.

// Known combo pieces and their partners
export const KNOWN_COMBOS: Record<string, string[]> = {
  // Aristocrats combos
  "blood artist": ["viscera seer", "ashnod's altar", "phyrexian altar", "grave pact"],
  "zulaport cutthroat": ["viscera seer", "ashnod's altar", "phyrexian altar"],
  "viscera seer": ["blood artist", "zulaport cutthroat", "grave pact", "dictate of erebos"],
  "ashnod's altar": ["blood artist", "nim deathmantle", "grave titan"],
  "phyrexian altar": ["gravecrawler", "blood artist", "pitiless plunderer"],
  
  // Degenerate combos
  "dramatic reversal": ["isochron scepter"],
  "isochron scepter": ["dramatic reversal", "counterspell", "swords to plowshares"],
  "deadeye navigator": ["peregrine drake", "palinchron", "great whale"],
  "peregrine drake": ["deadeye navigator", "ghostly flicker"],
  "thoracle": ["demonic consultation", "tainted pact"],  // Thassa's Oracle
  "thassa's oracle": ["demonic consultation", "tainted pact", "laboratory maniac"],
  "demonic consultation": ["thassa's oracle", "laboratory maniac", "jace, wielder of mysteries"],
  
  // Value combos
  "seedborn muse": ["wilderness reclamation", "prophet of kruphix"],
  "consecrated sphinx": ["notion thief"],
  "notion thief": ["wheel of fortune", "windfall"],
  
  // Creature combos
  "kiki-jiki, mirror breaker": ["zealous conscripts", "deceiver exarch", "pestermite", "felidar guardian"],
  "splinter twin": ["deceiver exarch", "pestermite", "zealous conscripts"],
  "devoted druid": ["vizier of remedies", "luxior, giada's gift"],
  
  // Land combos
  "dark depths": ["thespian's stage", "vampire hexmage"],
  "cabal coffers": ["urborg, tomb of yawgmoth"],
  
  // Graveyard
  "animate dead": ["worldgorger dragon"],
  "worldgorger dragon": ["animate dead", "dance of the dead", "necromancy"],
  
  // Equipment
  "sword of the meek": ["thopter foundry"],
  "thopter foundry": ["sword of the meek"],
};
