/**
 * triggers/card-data-tables.ts
 * 
 * Card lookup tables for known triggered abilities.
 * These are optimization caches for frequently-used cards. The actual trigger 
 * detection uses dynamic pattern recognition via regex patterns which can 
 * handle any card by parsing its oracle text.
 * 
 * This file contains:
 * - Death trigger cards (Grave Pact, Blood Artist, etc.)
 * - Attack trigger cards (Kaalia, Najeela, etc.)
 * - ETB trigger cards (Soul Warden, Altar of the Brood, etc.)
 * - Combat damage trigger cards (Swords, Edric, etc.)
 * - Beginning of combat trigger cards
 * - End step trigger cards
 * - Untap trigger cards
 * - Cast type trigger cards
 * - Tap/untap ability cards
 */

// ============================================================================
// Death Triggers
// ============================================================================

/**
 * Known cards with important death triggered abilities
 */
export const KNOWN_DEATH_TRIGGERS: Record<string, { effect: string; triggerOn: 'own' | 'controlled' | 'any' | 'opponent' }> = {
  "grave pact": { effect: "Each other player sacrifices a creature", triggerOn: 'controlled' },
  "dictate of erebos": { effect: "Each other player sacrifices a creature", triggerOn: 'controlled' },
  "butcher of malakir": { effect: "Each other player sacrifices a creature", triggerOn: 'controlled' },
  "blood artist": { effect: "Target player loses 1 life, you gain 1 life", triggerOn: 'any' },
  "zulaport cutthroat": { effect: "Each opponent loses 1 life, you gain 1 life", triggerOn: 'controlled' },
  "cruel celebrant": { effect: "Each opponent loses 1 life, you gain 1 life", triggerOn: 'controlled' },
  "bastion of remembrance": { effect: "Each opponent loses 1 life, you gain 1 life", triggerOn: 'controlled' },
  "syr konrad, the grim": { effect: "Each opponent loses 1 life", triggerOn: 'any' },
  "massacre wurm": { effect: "Opponent loses 2 life (when their creatures die)", triggerOn: 'any' },
  "skullclamp": { effect: "Draw 2 cards when equipped creature dies", triggerOn: 'own' },
  "grim haruspex": { effect: "Draw a card when nontoken creature dies", triggerOn: 'controlled' },
  "midnight reaper": { effect: "Draw a card, lose 1 life when nontoken creature dies", triggerOn: 'controlled' },
  "species specialist": { effect: "Draw a card when chosen creature type dies", triggerOn: 'any' },
  "harvester of souls": { effect: "Draw a card when nontoken creature dies", triggerOn: 'any' },
  "dark prophecy": { effect: "Draw a card, lose 1 life when creature dies", triggerOn: 'controlled' },
  // The Scorpion God - "When The Scorpion God dies, return it to its owner's hand at the beginning of the next end step."
  // Also has "Whenever a creature with a -1/-1 counter on it dies, draw a card."
  "the scorpion god": { effect: "Return to owner's hand at beginning of next end step", triggerOn: 'own' },
  // Leyline Tyrant - "When Leyline Tyrant dies, you may pay any amount of {R}. When you do, it deals that much damage to any target."
  "leyline tyrant": { effect: "Pay any amount of {R}. When you do, deal that much damage to any target", triggerOn: 'own' },
  // Wurmcoil Engine - leaves behind two tokens
  "wurmcoil engine": { effect: "Create a 3/3 colorless Wurm artifact creature token with deathtouch and a 3/3 colorless Wurm artifact creature token with lifelink", triggerOn: 'own' },
  // Kokusho, the Evening Star - each opponent loses life
  "kokusho, the evening star": { effect: "Each opponent loses 5 life. You gain life equal to the life lost this way", triggerOn: 'own' },
  // Yosei, the Morning Star - tap and skip untap
  "yosei, the morning star": { effect: "Target player skips their next untap step. Tap up to five target permanents that player controls", triggerOn: 'own' },
  // Keiga, the Tide Star - gain control
  "keiga, the tide star": { effect: "Gain control of target creature", triggerOn: 'own' },
  // Ryusei, the Falling Star - deal damage
  "ryusei, the falling star": { effect: "Deal 5 damage to each creature without flying", triggerOn: 'own' },
  // Junji, the Midnight Sky - reanimate or mill/draw
  "junji, the midnight sky": { effect: "Choose one - Target opponent discards two cards and loses 2 life; or put target non-Dragon creature card from a graveyard onto the battlefield under your control", triggerOn: 'own' },
  // Ao, the Dawn Sky - counters or manifest
  "ao, the dawn sky": { effect: "Choose one - Look at the top seven cards of your library. Put any number of nonland permanent cards with total mana value 4 or less from among them onto the battlefield. Put the rest on the bottom of your library in a random order; or put two +1/+1 counters on each permanent you control that's a creature or Vehicle", triggerOn: 'own' },
  // Control change death triggers
  "grave betrayal": { effect: "Return creature to battlefield under your control with +1/+1 counter at beginning of next end step. Creature becomes black Zombie in addition to other types.", triggerOn: 'opponent' },
  "endless whispers": { effect: "Choose target opponent. That player puts this card onto the battlefield under their control at beginning of next end step.", triggerOn: 'any' },
  "unholy indenture": { effect: "Return enchanted creature to battlefield under your control with +1/+1 counter.", triggerOn: 'own' },
};

// ============================================================================
// Attack Triggers
// ============================================================================

/**
 * OPTIMIZATION CACHE: Known cards with attack triggers
 * 
 * NOTE: This is an OPTIMIZATION cache for frequently-used cards, NOT the primary
 * trigger detection mechanism. The actual trigger detection uses DYNAMIC PATTERN
 * RECOGNITION via regex patterns in detectAttackTriggers() which can handle ANY
 * card by parsing its oracle text with patterns like:
 * - "Whenever ~ attacks, [effect]"
 * - "Whenever a creature you control attacks, [effect]"
 * - Token creation patterns like "create a X/Y [type] creature token"
 * 
 * This cache provides faster lookups for common tournament-level cards.
 */
export const KNOWN_ATTACK_TRIGGERS: Record<string, { 
  effect: string; 
  value?: number; 
  putFromHand?: boolean; 
  tappedAndAttacking?: boolean;
  conditionalTappedAttacking?: 'enchantment'; // For Summoner's Grimoire - only enchantment creatures
  createTokens?: { 
    count: number; 
    power: number; 
    toughness: number; 
    type: string; 
    color: string; 
    abilities?: string[] 
  } 
}> = {
  "hellkite charger": { effect: "Pay {5}{R}{R} for additional combat phase" },
  "combat celebrant": { effect: "Exert for additional combat phase" },
  "aurelia, the warleader": { effect: "Additional combat phase (first attack each turn)" },
  "moraug, fury of akoum": { effect: "Additional combat phase when landfall" },
  "najeela, the blade-blossom": { effect: "Create 1/1 Warrior token" },
  "marisi, breaker of the coil": { effect: "Goad all creatures that player controls" },
  "grand warlord radha": { effect: "Add mana for each attacking creature" },
  "neheb, the eternal": { effect: "Add {R} for each life opponent lost (postcombat)" },
  // Token creation on attack
  "hero of bladehold": { 
    effect: "Create two 1/1 white Soldier creature tokens tapped and attacking", 
    createTokens: { count: 2, power: 1, toughness: 1, type: "Soldier", color: "white" }
  },
  "brimaz, king of oreskos": { 
    effect: "Create a 1/1 white Cat Soldier creature token with vigilance tapped and attacking", 
    createTokens: { count: 1, power: 1, toughness: 1, type: "Cat Soldier", color: "white", abilities: ["vigilance"] }
  },
  "hanweir garrison": {
    effect: "Create two 1/1 red Human creature tokens tapped and attacking",
    createTokens: { count: 2, power: 1, toughness: 1, type: "Human", color: "red" }
  },
  "Captain of the Watch": {
    effect: "Create 1/1 white Soldier creature tokens",
    createTokens: { count: 3, power: 1, toughness: 1, type: "Soldier", color: "white" }
  },
  // Creatures that put cards from hand onto battlefield tapped and attacking
  "kaalia of the vast": { effect: "Put an Angel, Demon, or Dragon from hand onto battlefield tapped and attacking", putFromHand: true, tappedAndAttacking: true },
  "kaalia, zenith seeker": { effect: "Look at top 6 cards, reveal Angel/Demon/Dragon to hand" },
  "isshin, two heavens as one": { effect: "Attack triggers happen twice" },
  "winota, joiner of forces": { effect: "Look for a Human, put onto battlefield tapped and attacking", putFromHand: false, tappedAndAttacking: true },
  "ilharg, the raze-boar": { effect: "Put a creature from hand onto battlefield tapped and attacking", putFromHand: true, tappedAndAttacking: true },
  "summoner's grimoire": { effect: "Put a creature card from hand onto battlefield (if enchantment, enters tapped and attacking)", putFromHand: true, conditionalTappedAttacking: 'enchantment' },
  "sneak attack": { effect: "Put creature from hand, sacrifice at end step", putFromHand: true },
  "champion of rhonas": { effect: "Exert to put creature from hand", putFromHand: true },
  "elvish piper": { effect: "Put creature from hand onto battlefield" }, // Not attack trigger but related
  "quicksilver amulet": { effect: "Put creature from hand onto battlefield" },
  "descendants' path": { effect: "Reveal top card, put creature onto battlefield if shares type" },
  "belbe's portal": { effect: "Put creature of chosen type from hand" },
  "casal, lurkwood pathfinder": { 
    effect: "You may pay {1}{G}. If you do, transform her.", 
    value: 0, // No token creation
    // Special handling needed for optional payment and transform
  },
};

// ============================================================================
// Untap Triggers
// ============================================================================

/**
 * Known cards with "untap lands" or "untap permanents" triggers
 * These trigger on attack or combat damage
 */
export const KNOWN_UNTAP_TRIGGERS: Record<string, { 
  effect: string; 
  triggerOn: 'attack' | 'combat_damage' | 'damage_to_player';
  untapType: 'lands' | 'all' | 'creatures';
  controller: 'you' | 'opponent';
}> = {
  // Attack triggers - untap when creature attacks
  "bear umbra": { 
    effect: "Untap all lands you control", 
    triggerOn: 'attack',
    untapType: 'lands',
    controller: 'you',
  },
  "nature's will": { 
    effect: "Untap all lands you control, tap all lands defending player controls", 
    triggerOn: 'combat_damage',
    untapType: 'lands',
    controller: 'you',
  },
  "sword of feast and famine": { 
    effect: "Untap all lands you control, target player discards a card", 
    triggerOn: 'combat_damage',
    untapType: 'lands',
    controller: 'you',
  },
  "aggravated assault": { 
    effect: "Pay {3}{R}{R} for additional combat phase, untap all creatures", 
    triggerOn: 'attack', // Actually an activated ability, but included for reference
    untapType: 'creatures',
    controller: 'you',
  },
  "savage ventmaw": { 
    effect: "Add {R}{R}{R}{G}{G}{G} when attacking", 
    triggerOn: 'attack',
    untapType: 'lands', // Not exactly untap, but mana production
    controller: 'you',
  },
  "druids' repository": { 
    effect: "Put a charge counter when a creature attacks, remove to add mana", 
    triggerOn: 'attack',
    untapType: 'lands',
    controller: 'you',
  },
  "sword of hearth and home": { 
    effect: "Search for a basic land, put onto battlefield", 
    triggerOn: 'combat_damage',
    untapType: 'lands',
    controller: 'you',
  },
  "neheb, dreadhorde champion": { 
    effect: "Discard and draw, add {R} for each discarded", 
    triggerOn: 'combat_damage',
    untapType: 'lands',
    controller: 'you',
  },
};

// ============================================================================
// Cast Type Triggers
// ============================================================================

/**
 * Known cards with "whenever you cast a [type] spell" triggers
 * Merrow Reejerey, Goblin Warchief, etc.
 */
export const KNOWN_CAST_TYPE_TRIGGERS: Record<string, {
  effect: string;
  creatureType: string;
  tapOrUntap: 'tap' | 'untap' | 'choice';
  targetType: 'permanent' | 'creature' | 'land' | 'artifact' | 'spell';
}> = {
  "merrow reejerey": {
    effect: "Tap or untap target permanent",
    creatureType: "Merfolk",
    tapOrUntap: 'choice',
    targetType: 'permanent',
  },
  "lullmage mentor": {
    effect: "Tap 7 untapped Merfolk, counter target spell",
    creatureType: "Merfolk",
    tapOrUntap: 'tap',
    targetType: 'spell',
  },
  "goblin warchief": {
    effect: "Goblin spells cost {1} less, Goblins have haste",
    creatureType: "Goblin",
    tapOrUntap: 'untap',
    targetType: 'creature',
  },
  "elvish archdruid": {
    effect: "Add {G} for each Elf you control",
    creatureType: "Elf",
    tapOrUntap: 'untap',
    targetType: 'creature',
  },
  "bloodline pretender": {
    effect: "Put a +1/+1 counter when you cast a creature of chosen type",
    creatureType: "chosen",
    tapOrUntap: 'untap',
    targetType: 'creature',
  },
};

// ============================================================================
// Tap/Untap Abilities
// ============================================================================

/**
 * Known cards with activated tap/untap abilities
 * Dawnglare Invoker, Opposition, etc.
 */
export const KNOWN_TAP_UNTAP_ABILITIES: Record<string, {
  effect: string;
  cost: string;
  targetType: 'permanent' | 'creature' | 'land' | 'all_creatures';
  targetController?: 'any' | 'opponent' | 'you';
  tapOrUntap: 'tap' | 'untap';
}> = {
  "dawnglare invoker": {
    effect: "Tap all creatures target player controls",
    cost: "{8}",
    targetType: 'all_creatures',
    targetController: 'any',
    tapOrUntap: 'tap',
  },
  "opposition": {
    effect: "Tap target artifact, creature, or land",
    cost: "Tap an untapped creature you control",
    targetType: 'permanent',
    targetController: 'any',
    tapOrUntap: 'tap',
  },
  "citanul hierophants": {
    effect: "Creatures you control have 'T: Add {G}'",
    cost: "{T}",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'tap',
  },
  "cryptic command": {
    effect: "Tap all creatures your opponents control",
    cost: "{1}{U}{U}{U}",
    targetType: 'all_creatures',
    targetController: 'opponent',
    tapOrUntap: 'tap',
  },
  "sleep": {
    effect: "Tap all creatures target player controls, they don't untap",
    cost: "{2}{U}{U}",
    targetType: 'all_creatures',
    targetController: 'any',
    tapOrUntap: 'tap',
  },
  "icy manipulator": {
    effect: "Tap target artifact, creature, or land",
    cost: "{1}, {T}",
    targetType: 'permanent',
    targetController: 'any',
    tapOrUntap: 'tap',
  },
  "puppet strings": {
    effect: "Tap or untap target creature",
    cost: "{2}, {T}",
    targetType: 'creature',
    targetController: 'any',
    tapOrUntap: 'tap', // Can be either
  },
  "aphetto alchemist": {
    effect: "Untap target artifact or creature",
    cost: "{T}",
    targetType: 'permanent',
    targetController: 'any',
    tapOrUntap: 'untap',
  },
  "kiora's follower": {
    effect: "Untap target permanent",
    cost: "{T}",
    targetType: 'permanent',
    targetController: 'any',
    tapOrUntap: 'untap',
  },
  "vizier of tumbling sands": {
    effect: "Untap target permanent",
    cost: "{T}",
    targetType: 'permanent',
    targetController: 'any',
    tapOrUntap: 'untap',
  },
  "seeker of skybreak": {
    effect: "Untap target creature",
    cost: "{T}",
    targetType: 'creature',
    targetController: 'any',
    tapOrUntap: 'untap',
  },
  "fatestitcher": {
    effect: "Tap or untap target permanent",
    cost: "{T}",
    targetType: 'permanent',
    targetController: 'any',
    tapOrUntap: 'tap', // Can be either
  },
  "myr galvanizer": {
    effect: "Untap each other Myr you control",
    cost: "{1}, {T}",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "intruder alarm": {
    effect: "Untap all creatures when a creature enters",
    cost: "Trigger",
    targetType: 'all_creatures',
    targetController: 'any',
    tapOrUntap: 'untap',
  },
  "awakening": {
    effect: "Untap all creatures and lands during each player's upkeep",
    cost: "Trigger",
    targetType: 'permanent',
    targetController: 'any',
    tapOrUntap: 'untap',
  },
  "seedborn muse": {
    effect: "Untap all permanents you control during each other player's untap step",
    cost: "Trigger",
    targetType: 'permanent',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "prophet of kruphix": {
    effect: "Untap all creatures and lands you control during each other player's untap step",
    cost: "Trigger",
    targetType: 'permanent',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "murkfiend liege": {
    effect: "Untap all green and/or blue creatures you control during each other player's untap step",
    cost: "Trigger",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "quest for renewal": {
    effect: "Untap all creatures you control during each other player's untap step",
    cost: "Trigger (4+ counters)",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "pemmin's aura": {
    effect: "Untap enchanted creature",
    cost: "{U}",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "freed from the real": {
    effect: "Untap enchanted creature",
    cost: "{U}",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "umbral mantle": {
    effect: "Untap equipped creature, +2/+2",
    cost: "{3}",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "sword of the paruns": {
    effect: "Untap equipped creature",
    cost: "{3}",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "staff of domination": {
    effect: "Untap target creature",
    cost: "{3}, {T}",
    targetType: 'creature',
    targetController: 'any',
    tapOrUntap: 'untap',
  },
  "thousand-year elixir": {
    effect: "Untap target creature",
    cost: "{1}, {T}",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
};

// ============================================================================
// ETB Triggers
// ============================================================================

/**
 * OPTIMIZATION CACHE: Known cards with ETB triggers (enters the battlefield)
 * 
 * NOTE: This is an OPTIMIZATION cache for frequently-used cards, NOT the primary
 * trigger detection mechanism. The actual trigger detection uses DYNAMIC PATTERN
 * RECOGNITION via regex patterns in detectETBTriggers() which can handle ANY
 * of the 27,000+ MTG cards by parsing their oracle text.
 * 
 * The pattern detection handles:
 * - "When ~ enters the battlefield, [effect]"
 * - "Whenever a creature enters the battlefield under your control, [effect]"
 * - "Whenever another permanent enters the battlefield, [effect]"
 * - "Search your library for a [type] card" with power/toughness/CMC restrictions
 * - Token creation patterns
 * - And more...
 * 
 * This cache provides faster lookups for common tournament-level cards.
 */
export const KNOWN_ETB_TRIGGERS: Record<string, { 
  effect: string; 
  triggerOn: 'self' | 'creature' | 'another_permanent' | 'any_permanent';
  millAmount?: number;
  searchFilter?: { types?: string[]; subtypes?: string[]; maxPower?: number; maxToughness?: number };
  searchDestination?: 'hand' | 'battlefield' | 'top';
  searchEntersTapped?: boolean;
}> = {
  "altar of the brood": { 
    effect: "Each opponent mills 1 card", 
    triggerOn: 'another_permanent',
    millAmount: 1,
  },
  "impact tremors": { 
    effect: "Each opponent loses 1 life", 
    triggerOn: 'creature',
  },
  "purphoros, god of the forge": { 
    effect: "Each opponent loses 2 life", 
    triggerOn: 'creature',
  },
  "soul warden": { 
    effect: "You gain 1 life", 
    triggerOn: 'creature',
  },
  "soul's attendant": { 
    effect: "You may gain 1 life", 
    triggerOn: 'creature',
  },
  "essence warden": { 
    effect: "You gain 1 life", 
    triggerOn: 'creature',
  },
  "ajani's welcome": { 
    effect: "You gain 1 life", 
    triggerOn: 'creature',
  },
  "corpse knight": { 
    effect: "Each opponent loses 1 life", 
    triggerOn: 'creature',
  },
  "blood seeker": { 
    effect: "Creature's controller loses 1 life", 
    triggerOn: 'creature',
  },
  "suture priest": { 
    effect: "You gain 1 life; if opponent's creature, they lose 1 life", 
    triggerOn: 'creature',
  },
  "impassioned orator": { 
    effect: "You gain 1 life", 
    triggerOn: 'creature',
  },
  "dina, soul steeper": { 
    effect: "Each opponent loses 1 life when you gain life", 
    triggerOn: 'self', // Actually triggers on life gain, but she's an ETB-related card
  },
  "cathar's crusade": { 
    effect: "+1/+1 counter on each creature you control", 
    triggerOn: 'creature',
  },
  // Tutor creatures
  "imperial recruiter": {
    effect: "Search your library for a creature with power 2 or less, reveal it, and put it into your hand",
    triggerOn: 'self',
    searchFilter: { types: ['creature'], maxPower: 2 },
    searchDestination: 'hand',
  },
  "recruiter of the guard": {
    effect: "Search your library for a creature with toughness 2 or less, reveal it, and put it into your hand",
    triggerOn: 'self',
    searchFilter: { types: ['creature'], maxToughness: 2 },
    searchDestination: 'hand',
  },
  "wood elves": {
    effect: "Search your library for a Forest card and put it onto the battlefield",
    triggerOn: 'self',
    searchFilter: { subtypes: ['Forest'] },
    searchDestination: 'battlefield',
  },
  "farhaven elf": {
    effect: "Search your library for a basic land card and put it onto the battlefield tapped",
    triggerOn: 'self',
    searchFilter: { types: ['land'], subtypes: ['Basic'] },
    searchDestination: 'battlefield',
    searchEntersTapped: true,
  },
  "sakura-tribe elder": {
    effect: "Sacrifice Sakura-Tribe Elder: Search your library for a basic land card and put it onto the battlefield tapped",
    triggerOn: 'self',
    searchFilter: { types: ['land'], subtypes: ['Basic'] },
    searchDestination: 'battlefield',
    searchEntersTapped: true,
  },
  "solemn simulacrum": {
    effect: "Search your library for a basic land card and put it onto the battlefield tapped",
    triggerOn: 'self',
    searchFilter: { types: ['land'], subtypes: ['Basic'] },
    searchDestination: 'battlefield',
    searchEntersTapped: true,
  },
  "elvish rejuvenator": {
    effect: "Look at the top five cards of your library and put a land card onto the battlefield tapped",
    triggerOn: 'self',
    searchFilter: { types: ['land'] },
    searchDestination: 'battlefield',
    searchEntersTapped: true,
  },
  "silvergill adept": {
    effect: "As an additional cost, reveal a Merfolk card from your hand or pay {3}",
    triggerOn: 'self',
  },
  // Equipment with legendary creature triggers
  "hero's blade": {
    effect: "Whenever a legendary creature enters the battlefield under your control, you may attach Hero's Blade to it",
    triggerOn: 'creature',
  },
  "bane of progress": {
    effect: "Destroy all artifacts and enchantments, then put a +1/+1 counter on Bane of Progress for each permanent destroyed this way",
    triggerOn: 'self',
  },
  "marwyn, the nurturer": {
    effect: "Whenever another Elf enters the battlefield under your control, put a +1/+1 counter on Marwyn, the Nurturer",
    triggerOn: 'creature',
  },
  "bojuka bog": {
    effect: "Target player exiles all cards from their graveyard",
    triggerOn: 'self',
  },
};

// ============================================================================
// Combat Damage Triggers
// ============================================================================

/**
 * Known cards with combat damage triggers (deals combat damage to a player)
 */
export const KNOWN_COMBAT_DAMAGE_TRIGGERS: Record<string, { 
  effect: string;
  tokenType?: string;
  tokenCount?: number;
  toOpponent?: boolean; // Only triggers on damage to opponents
}> = {
  "precinct captain": { 
    effect: "Create a 1/1 white Soldier creature token",
    tokenType: "Soldier",
    tokenCount: 1,
  },
  "brimaz, king of oreskos": { 
    effect: "Create a 1/1 white Cat Soldier creature token with vigilance",
    tokenType: "Cat Soldier",
    tokenCount: 1,
  },
  "ophiomancer": { 
    effect: "Create a 1/1 black Snake creature token with deathtouch",
    tokenType: "Snake",
    tokenCount: 1,
  },
  "edric, spymaster of trest": { 
    effect: "That creature's controller draws a card",
    toOpponent: true,
  },
  "toski, bearer of secrets": { 
    effect: "Draw a card",
  },
  "ohran frostfang": { 
    effect: "Draw a card",
  },
  "coastal piracy": { 
    effect: "Draw a card",
  },
  "bident of thassa": { 
    effect: "Draw a card",
  },
  "reconnaissance mission": { 
    effect: "Draw a card",
  },
  "curiosity": { 
    effect: "Draw a card (enchanted creature)",
  },
  "sword of fire and ice": { 
    effect: "Draw a card and deal 2 damage to any target",
  },
  "sword of feast and famine": { 
    effect: "Target player discards a card, untap all lands you control",
  },
  "sword of light and shadow": { 
    effect: "Gain 3 life, return creature card from graveyard to hand",
  },
  "sword of war and peace": { 
    effect: "Deal damage equal to cards in opponent's hand, gain life equal to cards in your hand",
  },
  "sword of body and mind": { 
    effect: "Create a 2/2 Wolf token, target player mills 10",
  },
  "sword of truth and justice": { 
    effect: "Put a +1/+1 counter on a creature, proliferate",
  },
  "sword of sinew and steel": { 
    effect: "Destroy target planeswalker and artifact",
  },
  "sword of hearth and home": { 
    effect: "Exile then return target creature, search for a basic land",
  },
  "infiltration lens": { 
    effect: "Draw two cards (when blocked)",
  },
};

// ============================================================================
// Beginning of Combat Triggers
// ============================================================================

/**
 * Known cards with beginning of combat triggers
 */
export const KNOWN_BEGINNING_COMBAT_TRIGGERS: Record<string, { 
  effect: string; 
  requiresChoice?: boolean; 
  createsToken?: boolean; 
  tokenCopy?: boolean 
}> = {
  "hakbal of the surging soul": { effect: "Reveal the top card of your library. If it's a land, put it onto the battlefield tapped. Otherwise, put a +1/+1 counter on Hakbal." },
  "etali, primal storm": { effect: "Exile cards from each opponent's library and cast them without paying mana costs" },
  "marisi, breaker of the coil": { effect: "Goaded creatures can't block" },
  "aurelia, the warleader": { effect: "Untap all creatures, additional combat phase (first combat each turn)" },
  "gisela, blade of goldnight": { effect: "Damage dealt to opponents is doubled; damage dealt to you is halved" },
  "iroas, god of victory": { effect: "Creatures you control have menace and prevent damage that would be dealt to them" },
  "xenagos, god of revels": { effect: "Choose target creature you control. It gains haste and gets +X/+X", requiresChoice: true },
  "combat celebrant": { effect: "You may exert for additional combat phase" },
  "grand warlord radha": { effect: "Add mana equal to attacking creatures at beginning of combat" },
  "saskia the unyielding": { effect: "Damage to chosen player is dealt to them again" },
  "najeela, the blade-blossom": { effect: "Create 1/1 Warrior token when attacking", createsToken: true },
  "grand arbiter augustin iv": { effect: "Your spells cost less; opponent spells cost more" },
  // Token creation triggers
  "legion warboss": { effect: "Create a 1/1 red Goblin creature token with haste. That token attacks this combat if able.", createsToken: true },
  "hanweir garrison": { effect: "Create two 1/1 red Human creature tokens tapped and attacking", createsToken: true },
  "hero of bladehold": { effect: "Create two 1/1 white Soldier creature tokens tapped and attacking", createsToken: true },
  "brimaz, king of oreskos": { effect: "Create a 1/1 white Cat Soldier creature token with vigilance", createsToken: true },
  "rabble rousing": { effect: "Create X 1/1 green and white Citizen creature tokens, where X is the number of creatures attacking", createsToken: true },
  "adeline, resplendent cathar": { effect: "Create a 1/1 white Human creature token tapped and attacking", createsToken: true },
  "goblin rabblemaster": { effect: "Create a 1/1 red Goblin creature token with haste", createsToken: true },
  "krenko, tin street kingpin": { effect: "Put a +1/+1 counter on Krenko. Create X 1/1 red Goblin tokens where X is Krenko's power", createsToken: true },
  "tilonalli's summoner": { effect: "Create X 1/1 red Elemental tokens tapped and attacking, exile at end of combat", createsToken: true },
  "tendershoot dryad": { effect: "Create a 1/1 green Saproling creature token" },
  "captain of the watch": { effect: "Soldier creatures you control get +1/+1 and have vigilance" },
  // Equipment triggers
  "helm of the host": { effect: "Create a token that's a copy of equipped creature, except it's not legendary and has haste", tokenCopy: true, createsToken: true },
  "blade of selves": { effect: "Myriad - create token copies attacking each opponent", tokenCopy: true, createsToken: true },
  // Combat phase triggers
  "reconnaissance": { effect: "Remove attacking creature from combat and untap it" },
  "aggravated assault": { effect: "Pay to untap creatures and get additional combat phase" },
  "hellkite charger": { effect: "Pay to get additional combat phase" },
  "moraug, fury of akoum": { effect: "Landfall - additional combat phase, untap creatures" },
  "breath of fury": { effect: "Sacrifice creature for additional combat phase" },
  "world at war": { effect: "Additional combat phase this turn, rebound" },
  "savage beating": { effect: "Double strike or additional combat phase" },
  // FF7 cards
  "heidegger, shinra executive": { effect: "Create 1/1 white Soldier creature token for each Soldier you control", createsToken: true },
  "cait sith, fortune teller": { effect: "Roll a die and trigger based on result", requiresChoice: false },
};

// ============================================================================
// Precombat Main Phase Triggers
// ============================================================================

/**
 * Known cards with precombat main phase triggered abilities
 */
export const KNOWN_PRECOMBAT_MAIN_TRIGGERS: Record<string, { 
  effect: string;
  affectsEachPlayer?: boolean;
}> = {
  "magus of the vineyard": { 
    effect: "Each player adds {G}{G}",
    affectsEachPlayer: true,
  },
};

// ============================================================================
// End Step Triggers
// ============================================================================

/**
 * Known cards with end step triggered abilities
 */
export const KNOWN_END_STEP_TRIGGERS: Record<string, { 
  effect: string; 
  mandatory: boolean; 
  requiresChoice?: boolean;
  affectsAllPlayers?: boolean;
  modalOptions?: string[];
}> = {
  "kynaios and tiro of meletis": { 
    effect: "draw a card. Each player may put a land card from their hand onto the battlefield, then each opponent who didn't draws a card", 
    mandatory: true,
    requiresChoice: true,
    affectsAllPlayers: true,
  },
  "edric, spymaster of trest": { 
    effect: "Opponents who dealt combat damage to your opponents draw a card", 
    mandatory: true,
  },
  "nekusar, the mindrazer": { 
    effect: "Each player draws a card at end step (draw step)", 
    mandatory: true,
  },
  "meren of clan nel toth": { 
    effect: "Return a creature card from graveyard based on experience counters", 
    mandatory: true,
    requiresChoice: true,
  },
  "atraxa, praetors' voice": { 
    effect: "Proliferate", 
    mandatory: true,
  },
  "wound reflection": { 
    effect: "Each opponent loses life equal to life they lost this turn", 
    mandatory: true,
  },
  "hope estheim": {
    effect: "Each opponent mills X cards, where X is the amount of life you gained this turn",
    mandatory: true,
  },
  "twilight prophet": {
    effect: "If you have the city's blessing, reveal top card, opponent loses life equal to its mana value, you gain that life",
    mandatory: true,
  },
  "blightsteel colossus": {
    effect: "Shuffle into library if put into graveyard (replacement)",
    mandatory: true,
  },
  // Prosper, Tome-Bound - exile top card at end step, can play until end of next turn
  "prosper, tome-bound": {
    effect: "Exile the top card of your library. Until the end of your next turn, you may play that card.",
    mandatory: true,
  },
  // Outpost Siege (Dragons mode)
  "outpost siege": {
    effect: "At the beginning of your end step, Outpost Siege deals 1 damage to any target (Dragons mode)",
    mandatory: true,
    requiresChoice: true,
  },
  // Theater of Horrors
  "theater of horrors": {
    effect: "Exile the top card of your library. You may play that card this turn.",
    mandatory: true,
  },
  // Laelia, the Blade Reforged
  "laelia, the blade reforged": {
    effect: "Exile the top card of your library. You may play that card this turn.",
    mandatory: true,
  },
  // Furious Rise - At the beginning of your end step, if you control a creature with power 4 or greater,
  // exile the top card of your library. You may play that card until you exile another card with Furious Rise.
  "furious rise": {
    effect: "Exile the top card of your library if you control a creature with power 4+. You may play that card.",
    mandatory: true,
    requiresChoice: false,
  },
  // Abiding Grace - At the beginning of your end step, choose one —
  // • You gain 1 life.
  // • Return target creature card with mana value 1 or less from your graveyard to the battlefield.
  "abiding grace": {
    effect: "Choose one: You gain 1 life; or return a creature card with mana value 1 or less from your graveyard to the battlefield.",
    mandatory: true,
    requiresChoice: true,
    modalOptions: ["You gain 1 life", "Return a creature card with mana value 1 or less from your graveyard to the battlefield"],
  },
  // Agitator Ant - At the beginning of your end step, each player may put two +1/+1 counters on a creature they control.
  // Goad each creature that had counters put on it this way. (Until your next turn, those creatures attack each combat
  // if able and attack a player other than you if able.)
  "agitator ant": {
    effect: "Each player may put two +1/+1 counters on a creature they control. Goad each creature that had counters put on it this way.",
    mandatory: true,
    requiresChoice: true,
    affectsAllPlayers: true,
  },
};

// ============================================================================
// Damage Received Triggers (Whenever ~ is dealt damage)
// ============================================================================

/**
 * Known cards with "whenever this creature is dealt damage" triggers.
 * These trigger when the creature RECEIVES damage, not when it deals damage.
 * 
 * Examples:
 * - Brash Taunter: "Whenever Brash Taunter is dealt damage, it deals that much damage to target opponent."
 * - Ill-Tempered Loner: "Whenever this creature is dealt damage, it deals that much damage to any target."
 * - Wrathful Red Dragon: "Whenever a Dragon you control is dealt damage, it deals that much damage to any target that isn't a Dragon."
 * - Stuffy Doll: "Whenever Stuffy Doll is dealt damage, it deals that much damage to the chosen player."
 * - Boros Reckoner: "Whenever Boros Reckoner is dealt damage, it deals that much damage to any target."
 */
export const KNOWN_DAMAGE_RECEIVED_TRIGGERS: Record<string, { 
  effect: string;
  targetType: 'opponent' | 'any' | 'any_non_dragon' | 'chosen_player' | 'controller';
  triggerOn: 'self' | 'dragon_controlled' | 'creature_controlled';
}> = {
  // Brash Taunter - "Whenever Brash Taunter is dealt damage, it deals that much damage to target opponent."
  "brash taunter": {
    effect: "Deals that much damage to target opponent",
    targetType: 'opponent',
    triggerOn: 'self',
  },
  // Ill-Tempered Loner // Howlpack Avenger - "Whenever this creature is dealt damage, it deals that much damage to any target."
  "ill-tempered loner": {
    effect: "Deals that much damage to any target",
    targetType: 'any',
    triggerOn: 'self',
  },
  "howlpack avenger": {
    effect: "Deals that much damage to any target",
    targetType: 'any',
    triggerOn: 'self',
  },
  // Wrathful Red Dragon - "Whenever a Dragon you control is dealt damage, it deals that much damage to any target that isn't a Dragon."
  "wrathful red dragon": {
    effect: "Deals that much damage to any target that isn't a Dragon",
    targetType: 'any_non_dragon',
    triggerOn: 'dragon_controlled',
  },
  // Stuffy Doll - "Whenever Stuffy Doll is dealt damage, it deals that much damage to the chosen player."
  "stuffy doll": {
    effect: "Deals that much damage to the chosen player",
    targetType: 'chosen_player',
    triggerOn: 'self',
  },
  // Boros Reckoner - "Whenever Boros Reckoner is dealt damage, it deals that much damage to any target."
  "boros reckoner": {
    effect: "Deals that much damage to any target",
    targetType: 'any',
    triggerOn: 'self',
  },
  // Spitemare - "Whenever Spitemare is dealt damage, it deals that much damage to any target."
  "spitemare": {
    effect: "Deals that much damage to any target",
    targetType: 'any',
    triggerOn: 'self',
  },
  // Mogg Maniac - "Whenever Mogg Maniac is dealt damage, it deals that much damage to target opponent."
  "mogg maniac": {
    effect: "Deals that much damage to target opponent",
    targetType: 'opponent',
    triggerOn: 'self',
  },
  // Truefire Captain - "Whenever Truefire Captain is dealt damage, it deals that much damage to target player."
  "truefire captain": {
    effect: "Deals that much damage to target player",
    targetType: 'any',
    triggerOn: 'self',
  },
  // Coalhauler Swine - "Whenever Coalhauler Swine is dealt damage, it deals that much damage to each player."
  "coalhauler swine": {
    effect: "Deals that much damage to each player",
    targetType: 'any',
    triggerOn: 'self',
  },
  // Creepy Doll - "Whenever Creepy Doll is dealt combat damage by a creature, flip a coin. If you win the flip, destroy that creature."
  // This is slightly different - triggers only on combat damage and has coin flip
  "creepy doll": {
    effect: "Flip a coin. If you win, destroy that creature",
    targetType: 'controller',
    triggerOn: 'self',
  },
};

// ============================================================================
// Auras and Equipment that grant "damage received" triggers to attached creature
// ============================================================================

/**
 * Common interface for attachment damage-received triggers.
 * Used by both auras and equipment that grant "whenever [attached] creature is dealt damage" triggers.
 */
export interface AttachmentDamageReceivedTrigger {
  effect: string;
  targetType: 'opponent' | 'any' | 'each_opponent' | 'controller';
}

/**
 * Known auras with "whenever enchanted creature is dealt damage" triggers.
 * These grant the trigger to the creature they're attached to.
 * 
 * Examples:
 * - Pain for All: "Whenever enchanted creature is dealt damage, it deals that much damage to each opponent."
 */
export const KNOWN_DAMAGE_RECEIVED_AURAS: Record<string, AttachmentDamageReceivedTrigger> = {
  // Pain for All - "Whenever enchanted creature is dealt damage, it deals that much damage to each opponent."
  "pain for all": {
    effect: "Deals that much damage to each opponent",
    targetType: 'each_opponent',
  },
};

/**
 * Known equipment with "whenever equipped creature is dealt damage" triggers.
 * These grant the trigger to the creature they're attached to.
 * 
 * Examples:
 * - Blazing Sunsteel: "Whenever equipped creature is dealt damage, it deals that much damage to any target."
 */
export const KNOWN_DAMAGE_RECEIVED_EQUIPMENT: Record<string, AttachmentDamageReceivedTrigger> = {
  // Blazing Sunsteel - "Whenever equipped creature is dealt damage, it deals that much damage to any target."
  "blazing sunsteel": {
    effect: "Deals that much damage to any target",
    targetType: 'any',
  },
};

// ============================================================================
// Sacrifice Triggers (Whenever an opponent sacrifices)
// ============================================================================

/**
 * Known cards with "whenever an opponent sacrifices" triggers.
 * These trigger when an OPPONENT sacrifices a permanent.
 * 
 * Examples:
 * - It That Betrays: "Whenever an opponent sacrifices a nontoken permanent, put that card onto the battlefield under your control."
 * - Tergrid, God of Fright: "Whenever an opponent sacrifices a nontoken permanent or discards a permanent card, you may put that card from a graveyard onto the battlefield under your control."
 */
export const KNOWN_SACRIFICE_TRIGGERS: Record<string, { 
  effect: string;
  stealPermanent: boolean;
  permanentType: 'nontoken' | 'any' | 'creature' | 'artifact' | 'land';
  isOptional: boolean;
}> = {
  // It That Betrays - "Whenever an opponent sacrifices a nontoken permanent, put that card onto the battlefield under your control."
  "it that betrays": {
    effect: "Put that card onto the battlefield under your control",
    stealPermanent: true,
    permanentType: 'nontoken',
    isOptional: false,
  },
  // Tergrid, God of Fright - "Whenever an opponent sacrifices a nontoken permanent or discards a permanent card, you may put that card onto the battlefield under your control."
  "tergrid, god of fright": {
    effect: "You may put that card from a graveyard onto the battlefield under your control",
    stealPermanent: true,
    permanentType: 'nontoken',
    isOptional: true,
  },
  // Butcher of Malakir - While not strictly a sacrifice trigger, triggers on your creature deaths
  // Note: Already in death triggers
};

// ============================================================================
// Control Change ETB Triggers
// ============================================================================

/**
 * Known cards with ETB control change effects.
 * These are permanents that enter under another player's control.
 * 
 * Examples:
 * - Xantcha, Sleeper Agent: "Xantcha enters under the control of an opponent of your choice."
 * - Vislor Turlough: "you may have an opponent gain control of it. If you do, it's goaded"
 * - Akroan Horse: "When this creature enters, an opponent gains control of it."
 */
export const KNOWN_CONTROL_CHANGE_ETB: Record<string, {
  type: 'enters_opponent_choice' | 'may_give_opponent' | 'opponent_gains';
  isOptional: boolean;
  goadsOnChange?: boolean;
  mustAttackEachCombat?: boolean;
  cantAttackOwner?: boolean;
  anyPlayerCanActivate?: boolean;
}> = {
  // Xantcha, Sleeper Agent
  "xantcha, sleeper agent": {
    type: 'enters_opponent_choice',
    isOptional: false,
    mustAttackEachCombat: true,
    cantAttackOwner: true,
    anyPlayerCanActivate: true,
  },
  // Vislor Turlough
  "vislor turlough": {
    type: 'may_give_opponent',
    isOptional: true,
    goadsOnChange: true,
  },
  // Akroan Horse
  "akroan horse": {
    type: 'opponent_gains',
    isOptional: false,
  },
  // Humble Defector (activated ability, not ETB, but relevant)
  "humble defector": {
    type: 'opponent_gains',
    isOptional: false,
  },
};
