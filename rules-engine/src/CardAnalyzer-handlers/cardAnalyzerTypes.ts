// Origin parent: rules-engine/src/CardAnalyzer.ts
// Cluster moved: CardCategory, ThreatLevel, SynergyArchetype, CardAnalysis,
//   CardEffectDetails, BattlefieldAnalysis, DeckArchetypeProfile.
// Public entry symbols: CardCategory, ThreatLevel, SynergyArchetype,
//   CardAnalysis, CardEffectDetails, BattlefieldAnalysis, DeckArchetypeProfile.
// Leaf must not import CardAnalyzer.ts or CardAnalyzer-handlers/index.ts.

// ============================================================================
// Card Categories
// ============================================================================

/**
 * Primary card categories for strategic analysis
 */
export enum CardCategory {
  // Resource generation
  RAMP = 'ramp',                    // Mana acceleration (Sol Ring, Cultivate)
  DRAW = 'draw',                    // Card advantage (Rhystic Study, Harmonize)
  TUTOR = 'tutor',                  // Library search (Demonic Tutor, Worldly Tutor)
  
  // Interaction
  REMOVAL = 'removal',              // Targeted removal (Swords to Plowshares, Beast Within)
  BOARD_WIPE = 'board_wipe',        // Mass removal (Wrath of God, Cyclonic Rift)
  COUNTERSPELL = 'counterspell',    // Spell countering (Counterspell, Negate)
  PROTECTION = 'protection',        // Shields/hexproof/indestructible granters
  
  // Threats
  CREATURE = 'creature',            // Standard creatures
  FINISHER = 'finisher',           // Win condition creatures (Craterhoof, Blightsteel)
  COMMANDER = 'commander',          // Commander-focused card
  PLANESWALKER = 'planeswalker',
  
  // Synergy pieces
  SACRIFICE_OUTLET = 'sacrifice_outlet',  // Ashnod's Altar, Viscera Seer
  ARISTOCRAT = 'aristocrat',              // Blood Artist, Zulaport Cutthroat
  TOKEN_GENERATOR = 'token_generator',    // Produces tokens
  REANIMATOR = 'reanimator',              // Graveyard recursion
  DEATH_TRIGGER = 'death_trigger',        // Benefits from dying (Veteran Explorer)
  ETB_TRIGGER = 'etb_trigger',            // Enters-the-battlefield value
  LANDFALL = 'landfall',                  // Landfall triggers
  
  // Utility
  UTILITY = 'utility',              // General utility
  LAND = 'land',
  OTHER = 'other',
}

/**
 * Threat level for cards on the battlefield
 */
export enum ThreatLevel {
  MINIMAL = 0,      // Vanilla creature, basic land
  LOW = 1,          // Small utility creature, mana rock
  MODERATE = 2,     // Decent threat, needs attention eventually
  HIGH = 3,         // Significant threat, should be dealt with
  CRITICAL = 4,     // Must answer immediately or lose
  GAME_WINNING = 5, // Will win the game if not answered
}

/**
 * Known synergy archetypes
 */
export enum SynergyArchetype {
  ARISTOCRATS = 'aristocrats',       // Sacrifice + death payoffs
  TOKENS = 'tokens',                 // Token generation + buffs
  GRAVEYARD = 'graveyard',          // Reanimation + mill
  LANDFALL = 'landfall',            // Land drops + triggers
  SPELLSLINGER = 'spellslinger',    // Instants/sorceries matter
  COUNTERS = 'counters',            // +1/+1 counters manipulation
  ARTIFACTS = 'artifacts',          // Artifact synergy
  ENCHANTMENTS = 'enchantments',    // Enchantment synergy
  TRIBAL = 'tribal',                // Creature type matters
  VOLTRON = 'voltron',              // Equipment/aura focused
  COMBO = 'combo',                  // Infinite/game-ending combos
  STAX = 'stax',                    // Resource denial
  GROUP_HUG = 'group_hug',          // Symmetric benefits
  POLITICS = 'politics',            // Goad, pillow fort, kingmaking, field/life manipulation
}

// ============================================================================
// Analysis Results
// ============================================================================

/**
 * Card analysis result
 */
export interface CardAnalysis {
  readonly cardId: string;
  readonly cardName: string;
  readonly categories: readonly CardCategory[];
  readonly threatLevel: ThreatLevel;
  readonly synergyTags: readonly string[];
  readonly comboPotential: number;         // 0-10 scale
  readonly removalTargetPriority: number;  // 0-10 scale, higher = remove first
  readonly details: CardEffectDetails;
}

/**
 * Detailed card effect information
 */
export interface CardEffectDetails {
  // Death triggers
  readonly hasDeathTrigger: boolean;
  readonly deathTriggerEffect?: string;
  readonly deathTriggerBenefitsMe: boolean;
  readonly deathTriggerSymmetric: boolean;  // Benefits all players (Veteran Explorer)
  
  // ETB triggers
  readonly hasETBTrigger: boolean;
  readonly etbTriggerEffect?: string;
  
  // Sacrifice abilities
  readonly canSacrifice: boolean;
  readonly sacrificeTarget: 'self' | 'creature' | 'permanent' | 'artifact' | null;
  readonly sacrificeEffect?: string;
  
  // Combat abilities
  readonly combatKeywords: readonly string[];
  readonly power: number;
  readonly toughness: number;
  
  // Resource effects
  readonly producesMana: boolean;
  readonly drawsCards: boolean;
  readonly searchesLibrary: boolean;
  readonly destroysTargets: boolean;
  readonly exilesTargets: boolean;
  readonly countersSpells: boolean;
  
  // Synergy flags
  readonly createsTokens: boolean;
  readonly hasLandfall: boolean;
  readonly careAboutGraveyard: boolean;
  readonly hasActivatedAbility: boolean;
  readonly isComboEnablerPiece: boolean;

  /** Whenever another/other creature you control … (dies, enters, attacks, etc.) */
  readonly hasAnotherCreatureTrigger: boolean;
  /** 0–10: how much the card wants a stable board of other creatures */
  readonly anotherCreatureTriggerStrength: number;
}

/**
 * Battlefield analysis for threat assessment
 */
export interface BattlefieldAnalysis {
  readonly playerId: string;
  readonly totalThreatLevel: number;
  readonly threatsByPermanent: ReadonlyMap<string, ThreatLevel>;
  readonly synergiesDetected: readonly SynergyArchetype[];
  readonly comboPiecesOnBoard: readonly string[];
  readonly removalPriorities: readonly { permanentId: string; priority: number }[];
  readonly hasCommanderOnBoard: boolean;
  readonly commanderThreatLevel: ThreatLevel;
}

/**
 * Deck-level strategic profile for AI planning.
 */
export interface DeckArchetypeProfile {
  readonly totalCards: number;
  readonly landCount: number;
  readonly averageCmc: number;
  readonly curve: {
    readonly low: number;
    readonly mid: number;
    readonly high: number;
  };
  readonly categoryCounts: Readonly<Record<string, number>>;
  readonly synergyTagCounts: Readonly<Record<string, number>>;
  readonly archetypeScores: Readonly<Record<string, number>>;
  readonly primaryArchetypes: readonly SynergyArchetype[];
  readonly comboPairs: readonly string[];
  readonly keyCards: readonly string[];
}
