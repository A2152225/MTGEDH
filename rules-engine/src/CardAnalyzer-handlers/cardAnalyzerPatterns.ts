// Origin parent: rules-engine/src/CardAnalyzer.ts
// Cluster moved: PATTERNS (card-effect regex table).
// Public entry symbols: PATTERNS.
// Leaf must not import CardAnalyzer.ts or CardAnalyzer-handlers/index.ts.

// ============================================================================
// Card Effect Pattern Matching
// ============================================================================

// Patterns for detecting card effects
export const PATTERNS = {
  // Death triggers
  DEATH_TRIGGER: /when(?:ever)?.*dies?|when(?:ever)?\s+\S+\s+(?:is\s+)?put into.*graveyard from the battlefield/i,
  DIES_SEARCH_LAND: /when(?:ever)?.*dies?.*search.*(?:library|deck).*(?:land|basic)/i,
  DIES_DRAW: /when(?:ever)?.*dies?.*draw/i,
  DIES_TOKEN: /when(?:ever)?.*dies?.*create.*token/i,
  DIES_DAMAGE: /when(?:ever)?.*dies?.*(?:damage|lose.*life)/i,
  
  // ETB triggers
  ETB_TRIGGER: /when(?:ever)?.*enters the battlefield|enters,/i,
  ETB_SEARCH: /enters the battlefield.*search your library/i,
  ETB_DRAW: /enters the battlefield.*draw/i,
  ETB_TOKEN: /enters the battlefield.*create.*token/i,
  
  // Sacrifice abilities
  SACRIFICE_ABILITY: /sacrifice (?:a|an|another|this|~)/i,
  SACRIFICE_OUTLET: /sacrifice (?:a|an|another) (?:creature|permanent|artifact)/i,
  
  // Resource generation
  MANA_ABILITY: /\{t\}[,:]\s*add\s+|add (?:one mana of any|{[wubrgc\d]})/i,
  DRAW_CARDS: /draw (?:a|one|two|three|four|five|\d+) card/i,
  SEARCH_LIBRARY: /search your library/i,
  TUTOR: /search your library for (?:a|an)(?!.*land)/i,
  RAMP: /search your library for.*(?:land|basic)|put.*land.*onto the battlefield/i,
  
  // Removal
  DESTROY_TARGET: /destroy target/i,
  EXILE_TARGET: /exile target/i,
  DESTROY_ALL: /destroy all/i,
  EXILE_ALL: /exile all/i,
  BOUNCE: /return.*to.*owner'?s? hand/i,
  COUNTER_SPELL: /counter target.*spell/i,
  
  // Combat keywords
  FLYING: /\bflying\b/i,
  TRAMPLE: /\btrample\b/i,
  HASTE: /\bhaste\b/i,
  DEATHTOUCH: /\bdeathtouch\b/i,
  LIFELINK: /\blifelink\b/i,
  INDESTRUCTIBLE: /\bindestructible\b/i,
  HEXPROOF: /\bhexproof\b/i,
  DOUBLE_STRIKE: /\bdouble strike\b/i,
  VIGILANCE: /\bvigilance\b/i,
  FIRST_STRIKE: /\bfirst strike\b(?!\s*double)/i,
  
  // Token creation
  CREATE_TOKEN: /create.*(?:creature )?token/i,
  
  // Landfall
  LANDFALL: /\blandfall\b|whenever a land enters the battlefield under your control/i,
  
  // Graveyard
  GRAVEYARD_CARE: /(?:from|in|to).*graveyard|exile.*graveyard|return.*from.*graveyard/i,
  REANIMATION: /return.*(?:creature|permanent).*from.*graveyard to.*battlefield/i,
  
  // Combo indicators
  UNTAP_EFFECT: /untap (?:target|all|up to)/i,
  COPY_EFFECT: /create.*copy|copy target/i,
  EXTRA_TURN: /take an extra turn|additional turn/i,
  INFINITE_INDICATOR: /whenever.*trigger|each time.*trigger|add.*for each/i,
  
  // Win conditions
  WIN_GAME: /you win the game|target player loses the game/i,
  LIFE_DRAIN: /each opponent loses.*life|deals.*damage to each opponent/i,
  COMMANDER_DAMAGE: /commander damage/i,

  // Politics / kingmaking (beyond symmetric group hug)
  GOAD: /\bgoad\b/i,
  POLITICS_FIELD_SWAP: /gain control of all creatures|exchange control of all creatures|each gain control of all creatures the other controls/i,
  POLITICS_LIFE_SWAP: /exchange (?:life totals|damage)|pay (?:any amount|\{[^}]+\}) of life.*loses that much life/i,
  POLITICS_PILLOW_FORT: /can't attack you|creatures can't attack you unless|costs?\s+\{?[wubrgc\d]?\}?\s*more to attack you|sphere of safety|propaganda|ghostly prison|norn's annex|windborn muse|collective restraint|blazing archon/i,
  POLITICS_SYMMETRIC: /each player (?:draws|may draw|gains|may search|may put)|howling mine|font of mythos|tempt with/i,
  POLITICS_DEFection: /humble defector|target opponent gains control|that player gains control of/i,
  POLITICS_PUNISHMENT: /damage (?:is|would be) dealt to you|redirect(?:s|ed)? (?:that|this) damage|repercussion|stuffy doll|mogg maniac|backlash|pain for all|screaming nemesis|brash taunter|arcbond/i,
  POLITICS_GOAD_EQUIPMENT: /\bgoad\b|impetus|bloodthirsty blade|coronation of chaos|spectacular showdown|hot pursuit|komainu battle|laser screwdriver|incriminating|ghoulish|parasitic|geode rager|acquired mutation|bothersome quasit/i,
  POLITICS_ATTACH_OPPONENT: /enchant (?:creature )?an opponent controls|attach(?:ed)? to target creature an opponent controls|enchant (?:opponent|player)/i,
  POLITICS_GOAD_COMMANDER: /goad (?:all )?creatures you don't control|each creature you don't control.*\bgoad\b|power (?:is |≥ |>= |greater than )\d+.*\bgoad\b/i,

  // Tribal engines: lords, kindred, and tokens-as-resource (mill/mana/lock)
  TRIBAL_KINDRED: /choose a creature type|creature type you chose|\bkindred\b|\bchangeling\b/i,
  TRIBAL_ANTHEM: /creatures you control get \+|other .*creatures you control get|each other .*creature you control gets/i,
  TRIBAL_TOKEN_PAYOFF: /create .*creature token|twice that many of those tokens|token.*you control gets? /i,
  TRIBAL_COUNTER_LOCK: /tap .*untapped .*you control:.*counter target spell/i,
  TRIBAL_MILL_ENGINE: /\bmill \d+|put the top \d+ cards of .*library into .*graveyard|target player mills/i,
  TRIBAL_MANA_ENGINE: /add .*mana of any (?:type|color)|add \{[wubrgc]\} for each creature/i,
};

