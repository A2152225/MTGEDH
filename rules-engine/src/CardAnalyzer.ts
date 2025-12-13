/**
 * CardAnalyzer.ts
 * 
 * Comprehensive card analysis system for AI decision-making.
 * Analyzes cards for:
 * - Effects and abilities
 * - Threat levels
 * - Synergies with other cards
 * - Combo potential
 * - Strategic value
 * 
 * This module enables AI players to make more intelligent decisions by
 * understanding what their cards do and how they work together.
 */

import type { BattlefieldPermanent, KnownCardRef } from '../../shared/src';

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

// ============================================================================
// Card Effect Pattern Matching
// ============================================================================

// Patterns for detecting card effects
const PATTERNS = {
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
};

// Known combo pieces and their partners
const KNOWN_COMBOS: Record<string, string[]> = {
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

// Cards that benefit from dying (for Veteran Explorer-like effects)
const BENEFICIAL_DEATH_CARDS: Record<string, { effect: string; symmetric: boolean; priority: number }> = {
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

// ============================================================================
// CardAnalyzer Class
// ============================================================================

/**
 * CardAnalyzer - Analyzes cards for AI decision making
 */
export class CardAnalyzer {
  
  /**
   * Analyze a single card
   */
  analyzeCard(card: KnownCardRef | BattlefieldPermanent): CardAnalysis {
    // Handle both card references and permanents
    const cardData = this.extractCardData(card);
    const { name, typeLine, oracleText, power, toughness } = cardData;
    
    const categories = this.categorizeCard(cardData);
    const details = this.extractEffectDetails(cardData);
    const threatLevel = this.assessThreatLevel(cardData, details);
    const synergyTags = this.identifySynergyTags(cardData, details);
    const comboPotential = this.assessComboPotential(cardData);
    const removalPriority = this.assessRemovalPriority(cardData, details, threatLevel);
    
    return {
      cardId: cardData.id,
      cardName: name,
      categories,
      threatLevel,
      synergyTags,
      comboPotential,
      removalTargetPriority: removalPriority,
      details,
    };
  }
  
  /**
   * Analyze the entire battlefield for a player
   */
  analyzeBattlefield(
    battlefield: readonly BattlefieldPermanent[],
    targetPlayerId: string,
    analyzerPlayerId: string
  ): BattlefieldAnalysis {
    const playerPerms = battlefield.filter(p => p.controller === targetPlayerId);
    const isOpponent = targetPlayerId !== analyzerPlayerId;
    
    const threatsByPermanent = new Map<string, ThreatLevel>();
    let totalThreat = 0;
    const removalPriorities: { permanentId: string; priority: number }[] = [];
    let hasCommander = false;
    let commanderThreat = ThreatLevel.MINIMAL;
    const comboPieces: string[] = [];
    
    // Analyze each permanent
    for (const perm of playerPerms) {
      const analysis = this.analyzeCard(perm);
      threatsByPermanent.set(perm.id, analysis.threatLevel);
      totalThreat += analysis.threatLevel;
      
      if (isOpponent && analysis.removalTargetPriority > 3) {
        removalPriorities.push({
          permanentId: perm.id,
          priority: analysis.removalTargetPriority,
        });
      }
      
      if ((perm as any).isCommander || analysis.categories.includes(CardCategory.COMMANDER)) {
        hasCommander = true;
        commanderThreat = analysis.threatLevel;
      }
      
      if (analysis.comboPotential >= 7) {
        comboPieces.push(analysis.cardName);
      }
    }
    
    // Sort removal priorities
    removalPriorities.sort((a, b) => b.priority - a.priority);
    
    // Detect synergies on the battlefield
    const synergies = this.detectBattlefieldSynergies(playerPerms);
    
    return {
      playerId: targetPlayerId,
      totalThreatLevel: totalThreat,
      threatsByPermanent,
      synergiesDetected: synergies,
      comboPiecesOnBoard: comboPieces,
      removalPriorities,
      hasCommanderOnBoard: hasCommander,
      commanderThreatLevel: commanderThreat,
    };
  }
  
  /**
   * Check if two cards have synergy
   */
  checkSynergy(card1: KnownCardRef, card2: KnownCardRef): { hasSynergy: boolean; strength: number; reason?: string } {
    const name1 = (card1.name || '').toLowerCase();
    const name2 = (card2.name || '').toLowerCase();
    
    // Check known combos
    const combos1 = KNOWN_COMBOS[name1];
    if (combos1 && combos1.some(c => name2.includes(c) || c.includes(name2))) {
      return { hasSynergy: true, strength: 10, reason: 'Known combo pair' };
    }
    
    const combos2 = KNOWN_COMBOS[name2];
    if (combos2 && combos2.some(c => name1.includes(c) || c.includes(name1))) {
      return { hasSynergy: true, strength: 10, reason: 'Known combo pair' };
    }
    
    // Check archetype synergies
    const analysis1 = this.analyzeCard(card1);
    const analysis2 = this.analyzeCard(card2);
    
    // Sacrifice outlet + death trigger synergy
    if (analysis1.categories.includes(CardCategory.SACRIFICE_OUTLET) && 
        analysis2.details.hasDeathTrigger) {
      return { hasSynergy: true, strength: 8, reason: 'Sacrifice outlet + death trigger' };
    }
    if (analysis2.categories.includes(CardCategory.SACRIFICE_OUTLET) && 
        analysis1.details.hasDeathTrigger) {
      return { hasSynergy: true, strength: 8, reason: 'Sacrifice outlet + death trigger' };
    }
    
    // Token generator + sacrifice outlet
    if (analysis1.details.createsTokens && 
        analysis2.categories.includes(CardCategory.SACRIFICE_OUTLET)) {
      return { hasSynergy: true, strength: 7, reason: 'Token generator + sacrifice outlet' };
    }
    if (analysis2.details.createsTokens && 
        analysis1.categories.includes(CardCategory.SACRIFICE_OUTLET)) {
      return { hasSynergy: true, strength: 7, reason: 'Token generator + sacrifice outlet' };
    }
    
    // Aristocrats synergy
    if (analysis1.categories.includes(CardCategory.ARISTOCRAT) && 
        (analysis2.details.hasDeathTrigger || analysis2.details.createsTokens)) {
      return { hasSynergy: true, strength: 8, reason: 'Aristocrat synergy' };
    }
    if (analysis2.categories.includes(CardCategory.ARISTOCRAT) && 
        (analysis1.details.hasDeathTrigger || analysis1.details.createsTokens)) {
      return { hasSynergy: true, strength: 8, reason: 'Aristocrat synergy' };
    }
    
    // Landfall synergy
    if (analysis1.details.hasLandfall && analysis2.categories.includes(CardCategory.RAMP)) {
      return { hasSynergy: true, strength: 6, reason: 'Landfall + ramp' };
    }
    if (analysis2.details.hasLandfall && analysis1.categories.includes(CardCategory.RAMP)) {
      return { hasSynergy: true, strength: 6, reason: 'Landfall + ramp' };
    }
    
    // Check for shared synergy tags
    const sharedTags = analysis1.synergyTags.filter(tag => 
      analysis2.synergyTags.includes(tag)
    );
    if (sharedTags.length > 0) {
      return { hasSynergy: true, strength: 5, reason: `Shared synergy: ${sharedTags.join(', ')}` };
    }
    
    return { hasSynergy: false, strength: 0 };
  }
  
  /**
   * Find the best sacrifice target among a list of creatures
   * Prioritizes creatures with beneficial death triggers
   */
  findBestSacrificeTarget(
    creatures: readonly BattlefieldPermanent[],
    preferBeneficial: boolean = true
  ): { creature: BattlefieldPermanent | null; reason: string; priority: number } {
    if (creatures.length === 0) {
      return { creature: null, reason: 'No creatures available', priority: 0 };
    }
    
    let best: BattlefieldPermanent | null = null;
    let bestPriority = -Infinity;
    let bestReason = '';
    
    for (const creature of creatures) {
      const cardData = this.extractCardData(creature);
      const name = cardData.name.toLowerCase();
      
      // Check known beneficial death cards
      const knownDeath = BENEFICIAL_DEATH_CARDS[name];
      if (knownDeath) {
        // Prefer beneficial death triggers
        let priority = knownDeath.priority;
        if (preferBeneficial) {
          priority += 10; // Bonus for beneficial deaths
        }
        if (priority > bestPriority) {
          bestPriority = priority;
          best = creature;
          bestReason = `${cardData.name}: ${knownDeath.effect}`;
        }
        continue;
      }
      
      // Analyze the card for death triggers
      const details = this.extractEffectDetails(cardData);
      if (details.hasDeathTrigger && details.deathTriggerBenefitsMe) {
        let priority = 7; // Base priority for beneficial death trigger
        if (preferBeneficial) {
          priority += 5;
        }
        if (priority > bestPriority) {
          bestPriority = priority;
          best = creature;
          bestReason = `${cardData.name}: ${details.deathTriggerEffect || 'Has death trigger'}`;
        }
        continue;
      }
      
      // Tokens are lowest priority (easy to sacrifice)
      if ((creature as any).isToken) {
        const priority = 1;
        if (priority > bestPriority) {
          bestPriority = priority;
          best = creature;
          bestReason = 'Token creature';
        }
        continue;
      }
      
      // Small creatures without abilities
      const power = cardData.power;
      const toughness = cardData.toughness;
      const hasAbilities = details.hasActivatedAbility || 
                          details.hasDeathTrigger || 
                          details.hasETBTrigger;
      
      if (!hasAbilities && power + toughness <= 2) {
        const priority = 2;
        if (priority > bestPriority) {
          bestPriority = priority;
          best = creature;
          bestReason = 'Small creature with no abilities';
        }
      }
    }
    
    // Fallback: use the smallest creature
    if (!best && creatures.length > 0) {
      creatures.forEach(c => {
        const data = this.extractCardData(c);
        const stats = data.power + data.toughness;
        const priority = -stats; // Smaller is better
        if (priority > bestPriority) {
          bestPriority = priority;
          best = c;
          bestReason = 'Smallest available creature';
        }
      });
    }
    
    return {
      creature: best,
      reason: bestReason,
      priority: bestPriority,
    };
  }
  
  /**
   * Identify which cards in hand/library synergize with the battlefield
   */
  findSynergyCards(
    cards: readonly KnownCardRef[],
    battlefield: readonly BattlefieldPermanent[],
    playerId: string
  ): { card: KnownCardRef; synergyScore: number; synergizesWith: string[] }[] {
    const playerBattlefield = battlefield.filter(p => p.controller === playerId);
    const results: { card: KnownCardRef; synergyScore: number; synergizesWith: string[] }[] = [];
    
    for (const card of cards) {
      let totalSynergy = 0;
      const synergizesWith: string[] = [];
      
      for (const perm of playerBattlefield) {
        const permCard = this.extractCardData(perm) as any;
        const synergy = this.checkSynergy(card, permCard);
        if (synergy.hasSynergy) {
          totalSynergy += synergy.strength;
          synergizesWith.push(`${permCard.name} (${synergy.reason})`);
        }
      }
      
      if (totalSynergy > 0) {
        results.push({
          card,
          synergyScore: totalSynergy,
          synergizesWith,
        });
      }
    }
    
    // Sort by synergy score descending
    results.sort((a, b) => b.synergyScore - a.synergyScore);
    
    return results;
  }
  
  /**
   * Assess if using Veteran Explorer-like cards is beneficial
   * Consider opponent board state and our mana needs
   */
  shouldUseSymmetricDeathEffect(
    card: KnownCardRef,
    ownLandCount: number,
    opponentLandCounts: readonly number[],
    opponentThreatLevels: readonly number[]
  ): { shouldUse: boolean; reason: string } {
    const name = (card.name || '').toLowerCase();
    const known = BENEFICIAL_DEATH_CARDS[name];
    
    if (!known || !known.symmetric) {
      return { shouldUse: true, reason: 'Not a symmetric effect' };
    }
    
    // Calculate relative mana disadvantage
    const avgOpponentLands = opponentLandCounts.reduce((a, b) => a + b, 0) / opponentLandCounts.length;
    const landDisadvantage = avgOpponentLands - ownLandCount;
    
    // If we're behind on lands, symmetric ramp helps us more
    if (landDisadvantage >= 2) {
      return { 
        shouldUse: true, 
        reason: `Behind on lands by ${landDisadvantage.toFixed(1)} - symmetric ramp is beneficial` 
      };
    }
    
    // If opponents have high threat levels and more lands, be cautious
    const avgThreat = opponentThreatLevels.reduce((a, b) => a + b, 0) / opponentThreatLevels.length;
    if (avgThreat > 10 && landDisadvantage < 1) {
      return { 
        shouldUse: false, 
        reason: 'Opponents have high threats and similar mana - don\'t help them ramp' 
      };
    }
    
    // In early game, symmetric ramp is generally fine
    if (ownLandCount <= 4) {
      return { shouldUse: true, reason: 'Early game - mana development is priority' };
    }
    
    // Default to using it
    return { shouldUse: true, reason: 'Symmetric effect is acceptable' };
  }
  
  // ============================================================================
  // Private Helper Methods
  // ============================================================================
  
  private extractCardData(card: KnownCardRef | BattlefieldPermanent): {
    id: string;
    name: string;
    typeLine: string;
    oracleText: string;
    power: number;
    toughness: number;
    cmc: number;
    colors: readonly string[];
  } {
    // Handle BattlefieldPermanent
    if ('card' in card && card.card) {
      const innerCard = card.card as KnownCardRef;
      return {
        id: card.id || innerCard.id || '',
        name: innerCard.name || '',
        typeLine: innerCard.type_line || '',
        oracleText: innerCard.oracle_text || '',
        power: parseInt(String(innerCard.power || '0'), 10) || 0,
        toughness: parseInt(String(innerCard.toughness || '0'), 10) || 0,
        cmc: (innerCard as any).cmc || (innerCard as any).mana_value || 0,
        colors: (innerCard as any).colors || [],
      };
    }
    
    // Handle KnownCardRef directly
    const cardRef = card as KnownCardRef;
    return {
      id: cardRef.id || '',
      name: cardRef.name || '',
      typeLine: cardRef.type_line || '',
      oracleText: cardRef.oracle_text || '',
      power: parseInt(String(cardRef.power || '0'), 10) || 0,
      toughness: parseInt(String(cardRef.toughness || '0'), 10) || 0,
      cmc: (cardRef as any).cmc || (cardRef as any).mana_value || 0,
      colors: (cardRef as any).colors || [],
    };
  }
  
  private categorizeCard(cardData: { typeLine: string; oracleText: string; name: string }): CardCategory[] {
    const { typeLine, oracleText, name } = cardData;
    const type = typeLine.toLowerCase();
    const text = oracleText.toLowerCase();
    const categories: CardCategory[] = [];
    
    // Type-based categorization
    if (type.includes('land')) {
      categories.push(CardCategory.LAND);
    }
    if (type.includes('creature')) {
      categories.push(CardCategory.CREATURE);
    }
    if (type.includes('planeswalker')) {
      categories.push(CardCategory.PLANESWALKER);
    }
    
    // Effect-based categorization
    if (PATTERNS.COUNTER_SPELL.test(text)) {
      categories.push(CardCategory.COUNTERSPELL);
    }
    if (PATTERNS.DESTROY_ALL.test(text) || PATTERNS.EXILE_ALL.test(text)) {
      categories.push(CardCategory.BOARD_WIPE);
    } else if (PATTERNS.DESTROY_TARGET.test(text) || PATTERNS.EXILE_TARGET.test(text) || PATTERNS.BOUNCE.test(text)) {
      categories.push(CardCategory.REMOVAL);
    }
    if (PATTERNS.RAMP.test(text) || (PATTERNS.MANA_ABILITY.test(text) && !type.includes('land'))) {
      categories.push(CardCategory.RAMP);
    }
    if (PATTERNS.DRAW_CARDS.test(text)) {
      categories.push(CardCategory.DRAW);
    }
    if (PATTERNS.TUTOR.test(text)) {
      categories.push(CardCategory.TUTOR);
    }
    if (PATTERNS.SACRIFICE_OUTLET.test(text)) {
      categories.push(CardCategory.SACRIFICE_OUTLET);
    }
    if (PATTERNS.DEATH_TRIGGER.test(text)) {
      categories.push(CardCategory.DEATH_TRIGGER);
    }
    if (PATTERNS.ETB_TRIGGER.test(text)) {
      categories.push(CardCategory.ETB_TRIGGER);
    }
    if (PATTERNS.CREATE_TOKEN.test(text)) {
      categories.push(CardCategory.TOKEN_GENERATOR);
    }
    if (PATTERNS.REANIMATION.test(text)) {
      categories.push(CardCategory.REANIMATOR);
    }
    if (PATTERNS.LANDFALL.test(text)) {
      categories.push(CardCategory.LANDFALL);
    }
    
    // Aristocrats detection (drains life on death)
    if ((text.includes('whenever') && text.includes('dies') && 
        (text.includes('loses') || text.includes('gain') || text.includes('damage')))) {
      categories.push(CardCategory.ARISTOCRAT);
    }
    
    // Win condition / finisher detection
    if (PATTERNS.WIN_GAME.test(text) || PATTERNS.EXTRA_TURN.test(text)) {
      categories.push(CardCategory.FINISHER);
    }
    
    // Protection effects
    if (PATTERNS.HEXPROOF.test(text) || PATTERNS.INDESTRUCTIBLE.test(text) ||
        text.includes('protection from')) {
      categories.push(CardCategory.PROTECTION);
    }
    
    if (categories.length === 0) {
      categories.push(CardCategory.OTHER);
    }
    
    return categories;
  }
  
  private extractEffectDetails(cardData: { oracleText: string; typeLine: string; power: number; toughness: number; name: string }): CardEffectDetails {
    const { oracleText, typeLine, power, toughness, name } = cardData;
    const text = oracleText.toLowerCase();
    const type = typeLine.toLowerCase();
    
    // Combat keywords
    const combatKeywords: string[] = [];
    if (PATTERNS.FLYING.test(text)) combatKeywords.push('flying');
    if (PATTERNS.TRAMPLE.test(text)) combatKeywords.push('trample');
    if (PATTERNS.HASTE.test(text)) combatKeywords.push('haste');
    if (PATTERNS.DEATHTOUCH.test(text)) combatKeywords.push('deathtouch');
    if (PATTERNS.LIFELINK.test(text)) combatKeywords.push('lifelink');
    if (PATTERNS.FIRST_STRIKE.test(text)) combatKeywords.push('first strike');
    if (PATTERNS.DOUBLE_STRIKE.test(text)) combatKeywords.push('double strike');
    if (PATTERNS.VIGILANCE.test(text)) combatKeywords.push('vigilance');
    if (PATTERNS.INDESTRUCTIBLE.test(text)) combatKeywords.push('indestructible');
    if (PATTERNS.HEXPROOF.test(text)) combatKeywords.push('hexproof');
    
    // Death trigger analysis
    const hasDeathTrigger = PATTERNS.DEATH_TRIGGER.test(text);
    let deathTriggerEffect: string | undefined;
    let deathTriggerBenefitsMe = false;
    let deathTriggerSymmetric = false;
    
    if (hasDeathTrigger) {
      // Extract death trigger effect
      const match = text.match(/when(?:ever)?.*dies?,?\s*([^.]+)/i);
      if (match) {
        deathTriggerEffect = match[1];
      }
      
      // Check if it benefits the controller
      const beneficialPatterns = [
        /search.*library/, /draw/, /create.*token/, /return.*to.*hand/,
        /gain.*life/, /opponent.*loses/, /damage.*opponent/
      ];
      deathTriggerBenefitsMe = beneficialPatterns.some(p => p.test(text));
      
      // Check if symmetric (helps all players)
      const symmetricPatterns = [/each player/];
      deathTriggerSymmetric = symmetricPatterns.some(p => p.test(text));
      
      // Check known beneficial death cards
      const knownDeath = BENEFICIAL_DEATH_CARDS[name.toLowerCase()];
      if (knownDeath) {
        deathTriggerBenefitsMe = true;
        deathTriggerSymmetric = knownDeath.symmetric;
        deathTriggerEffect = knownDeath.effect;
      }
    }
    
    // Sacrifice detection - check for activated ability patterns like "Sacrifice CardName:"
    const canSacrifice = PATTERNS.SACRIFICE_ABILITY.test(text) || 
                         /sacrifice [^:]+:/i.test(text);  // "Sacrifice CardName:" format
    let sacrificeTarget: 'self' | 'creature' | 'permanent' | 'artifact' | null = null;
    let sacrificeEffect: string | undefined;
    
    if (canSacrifice) {
      // Check for self-sacrifice patterns
      // Use simple string check instead of regex for "Sacrifice CardName:" pattern
      const escapedName = name.toLowerCase();
      const sacrificeNamePattern = `sacrifice ${escapedName}:`;
      
      if (text.includes('sacrifice ~') || 
          text.includes('sacrifice this') ||
          // Check for "Sacrifice CardName:" pattern (self-sacrifice activated ability)
          text.includes(sacrificeNamePattern)) {
        sacrificeTarget = 'self';
      } else if (text.includes('sacrifice a creature') || text.includes('sacrifice another creature')) {
        sacrificeTarget = 'creature';
      } else if (text.includes('sacrifice an artifact')) {
        sacrificeTarget = 'artifact';
      } else if (text.includes('sacrifice a permanent')) {
        sacrificeTarget = 'permanent';
      }
      
      const sacrificeMatch = text.match(/sacrifice[^:,]*[,:]\s*([^.]+)/i);
      if (sacrificeMatch) {
        sacrificeEffect = sacrificeMatch[1];
      }
    }
    
    // ETB trigger
    const hasETBTrigger = PATTERNS.ETB_TRIGGER.test(text);
    let etbTriggerEffect: string | undefined;
    if (hasETBTrigger) {
      const match = text.match(/enters the battlefield[^,]*,?\s*([^.]+)/i);
      if (match) {
        etbTriggerEffect = match[1];
      }
    }
    
    return {
      hasDeathTrigger,
      deathTriggerEffect,
      deathTriggerBenefitsMe,
      deathTriggerSymmetric,
      hasETBTrigger,
      etbTriggerEffect,
      canSacrifice,
      sacrificeTarget,
      sacrificeEffect,
      combatKeywords,
      power,
      toughness,
      producesMana: PATTERNS.MANA_ABILITY.test(text),
      drawsCards: PATTERNS.DRAW_CARDS.test(text),
      searchesLibrary: PATTERNS.SEARCH_LIBRARY.test(text),
      destroysTargets: PATTERNS.DESTROY_TARGET.test(text),
      exilesTargets: PATTERNS.EXILE_TARGET.test(text),
      countersSpells: PATTERNS.COUNTER_SPELL.test(text),
      createsTokens: PATTERNS.CREATE_TOKEN.test(text),
      hasLandfall: PATTERNS.LANDFALL.test(text),
      careAboutGraveyard: PATTERNS.GRAVEYARD_CARE.test(text),
      hasActivatedAbility: text.includes('{t}:') || /\{[0-9wubrgc]+\}[,:]/.test(text),
      isComboEnablerPiece: PATTERNS.UNTAP_EFFECT.test(text) || PATTERNS.COPY_EFFECT.test(text),
    };
  }
  
  private assessThreatLevel(
    cardData: { typeLine: string; oracleText: string; power: number; toughness: number; name: string },
    details: CardEffectDetails
  ): ThreatLevel {
    const { typeLine, oracleText, power, toughness, name } = cardData;
    const type = typeLine.toLowerCase();
    const text = oracleText.toLowerCase();
    
    // Instant win conditions
    if (PATTERNS.WIN_GAME.test(text) || PATTERNS.EXTRA_TURN.test(text)) {
      return ThreatLevel.GAME_WINNING;
    }
    
    // Known dangerous cards
    const dangerousCards = [
      'consecrated sphinx', 'rhystic study', 'smothering tithe',
      'seedborn muse', 'prophet of kruphix', 'notion thief',
      'craterhoof behemoth', 'tooth and nail', 'expropriate',
      'cyclonic rift', 'teferi\'s protection', 'dockside extortionist',
    ];
    if (dangerousCards.some(c => name.toLowerCase().includes(c))) {
      return ThreatLevel.CRITICAL;
    }
    
    // High threat indicators
    if (details.isComboEnablerPiece && type.includes('creature')) {
      return ThreatLevel.HIGH;
    }
    
    if (type.includes('planeswalker')) {
      return ThreatLevel.HIGH;
    }
    
    if (type.includes('creature')) {
      // Big creatures with evasion
      if (power >= 5 && details.combatKeywords.length >= 2) {
        return ThreatLevel.HIGH;
      }
      if (power >= 7) {
        return ThreatLevel.HIGH;
      }
      // Creatures with draw engines
      if (details.drawsCards && !text.includes('when this creature dies')) {
        return ThreatLevel.HIGH;
      }
      // Medium threats
      if (power >= 4 || details.combatKeywords.includes('flying')) {
        return ThreatLevel.MODERATE;
      }
      if (power >= 2) {
        return ThreatLevel.LOW;
      }
      return ThreatLevel.MINIMAL;
    }
    
    // Enchantments that generate value
    if (type.includes('enchantment') && (details.drawsCards || details.createsTokens)) {
      return ThreatLevel.MODERATE;
    }
    
    // Artifacts that generate mana or value
    if (type.includes('artifact')) {
      if (details.producesMana) {
        return ThreatLevel.LOW;
      }
      if (details.drawsCards) {
        return ThreatLevel.MODERATE;
      }
    }
    
    // Lands
    if (type.includes('land')) {
      if (details.producesMana && text.includes('add') && text.includes('any color')) {
        return ThreatLevel.LOW;
      }
      return ThreatLevel.MINIMAL;
    }
    
    return ThreatLevel.MINIMAL;
  }
  
  private identifySynergyTags(
    cardData: { typeLine: string; oracleText: string; name: string },
    details: CardEffectDetails
  ): string[] {
    const tags: string[] = [];
    const { typeLine, oracleText, name } = cardData;
    const type = typeLine.toLowerCase();
    const text = oracleText.toLowerCase();
    
    // Aristocrats archetype
    if (details.hasDeathTrigger || details.canSacrifice || 
        text.includes('blood artist') || text.includes('whenever') && text.includes('dies')) {
      tags.push('aristocrats');
    }
    
    // Token strategy
    if (details.createsTokens || text.includes('token') && text.includes('you control')) {
      tags.push('tokens');
    }
    
    // Graveyard strategy
    if (details.careAboutGraveyard || PATTERNS.REANIMATION.test(text)) {
      tags.push('graveyard');
    }
    
    // Landfall
    if (details.hasLandfall) {
      tags.push('landfall');
    }
    
    // Counters matter
    if (text.includes('+1/+1 counter') || text.includes('proliferate')) {
      tags.push('counters');
    }
    
    // Artifacts matter
    if (type.includes('artifact') || text.includes('artifact you control')) {
      tags.push('artifacts');
    }
    
    // Enchantments matter
    if (type.includes('enchantment') || text.includes('enchantment you control')) {
      tags.push('enchantments');
    }
    
    // Spellslinger
    if (text.includes('instant or sorcery') || text.includes('noncreature spell')) {
      tags.push('spellslinger');
    }
    
    // Voltron (equipment/auras)
    if (type.includes('equipment') || text.includes('equipped creature') ||
        (type.includes('aura') && text.includes('enchanted creature'))) {
      tags.push('voltron');
    }
    
    // Stax
    if (text.includes('opponents can\'t') || text.includes('opponents don\'t') ||
        text.includes('each opponent') && text.includes('sacrifice')) {
      tags.push('stax');
    }
    
    return tags;
  }
  
  private assessComboPotential(cardData: { name: string; oracleText: string }): number {
    const { name, oracleText } = cardData;
    const lowerName = name.toLowerCase();
    const text = oracleText.toLowerCase();
    let potential = 0;
    
    // Check known combo pieces
    if (KNOWN_COMBOS[lowerName]) {
      potential = 10;
    }
    
    // Check if part of another combo
    for (const pieces of Object.values(KNOWN_COMBOS)) {
      if (pieces.some(p => lowerName.includes(p) || p.includes(lowerName))) {
        potential = Math.max(potential, 9);
        break;
      }
    }
    
    // Combo indicators
    if (PATTERNS.UNTAP_EFFECT.test(text)) potential = Math.max(potential, 7);
    if (PATTERNS.COPY_EFFECT.test(text)) potential = Math.max(potential, 6);
    if (PATTERNS.INFINITE_INDICATOR.test(text)) potential = Math.max(potential, 8);
    if (text.includes('mana') && text.includes('untap')) potential = Math.max(potential, 8);
    
    return potential;
  }
  
  private assessRemovalPriority(
    cardData: { name: string; typeLine: string; oracleText: string },
    details: CardEffectDetails,
    threatLevel: ThreatLevel
  ): number {
    let priority = threatLevel * 2; // Base priority from threat level
    
    const text = cardData.oracleText.toLowerCase();
    
    // Higher priority for value engines
    if (details.drawsCards && !text.includes('when this creature dies')) {
      priority += 3;
    }
    
    // Higher priority for untap effects (combo enablers)
    if (PATTERNS.UNTAP_EFFECT.test(text)) {
      priority += 2;
    }
    
    // Higher priority for life drain (aristocrats payoffs)
    if (PATTERNS.LIFE_DRAIN.test(text)) {
      priority += 2;
    }
    
    // Lower priority for cards with beneficial death triggers (we don't want to help them)
    if (details.hasDeathTrigger && details.deathTriggerBenefitsMe) {
      priority -= 2;
    }
    
    return Math.max(0, Math.min(10, priority));
  }
  
  private detectBattlefieldSynergies(permanents: readonly BattlefieldPermanent[]): SynergyArchetype[] {
    const synergies: Set<SynergyArchetype> = new Set();
    
    let hasSacrificeOutlet = false;
    let hasAristocrat = false;
    let hasDeathTrigger = false;
    let hasTokenGenerator = false;
    let hasLandfall = false;
    let hasCountersSynergy = false;
    let hasGraveyardCare = false;
    let hasArtifactTheme = false;
    let hasEnchantmentTheme = false;
    
    for (const perm of permanents) {
      const analysis = this.analyzeCard(perm);
      
      if (analysis.categories.includes(CardCategory.SACRIFICE_OUTLET)) hasSacrificeOutlet = true;
      if (analysis.categories.includes(CardCategory.ARISTOCRAT)) hasAristocrat = true;
      if (analysis.categories.includes(CardCategory.DEATH_TRIGGER)) hasDeathTrigger = true;
      if (analysis.categories.includes(CardCategory.TOKEN_GENERATOR)) hasTokenGenerator = true;
      if (analysis.categories.includes(CardCategory.LANDFALL)) hasLandfall = true;
      if (analysis.categories.includes(CardCategory.REANIMATOR)) hasGraveyardCare = true;
      
      if (analysis.synergyTags.includes('counters')) hasCountersSynergy = true;
      if (analysis.synergyTags.includes('artifacts')) hasArtifactTheme = true;
      if (analysis.synergyTags.includes('enchantments')) hasEnchantmentTheme = true;
      if (analysis.synergyTags.includes('graveyard')) hasGraveyardCare = true;
    }
    
    // Detect aristocrats
    if ((hasSacrificeOutlet && hasAristocrat) || (hasAristocrat && hasDeathTrigger)) {
      synergies.add(SynergyArchetype.ARISTOCRATS);
    }
    
    // Detect tokens
    if (hasTokenGenerator && (hasSacrificeOutlet || hasAristocrat)) {
      synergies.add(SynergyArchetype.TOKENS);
    }
    
    // Detect landfall
    if (hasLandfall) {
      synergies.add(SynergyArchetype.LANDFALL);
    }
    
    // Detect graveyard
    if (hasGraveyardCare) {
      synergies.add(SynergyArchetype.GRAVEYARD);
    }
    
    // Detect counters
    if (hasCountersSynergy) {
      synergies.add(SynergyArchetype.COUNTERS);
    }
    
    // Detect artifacts theme
    if (hasArtifactTheme) {
      synergies.add(SynergyArchetype.ARTIFACTS);
    }
    
    // Detect enchantments theme  
    if (hasEnchantmentTheme) {
      synergies.add(SynergyArchetype.ENCHANTMENTS);
    }
    
    return Array.from(synergies);
  }
}

/**
 * Singleton instance
 */
export const cardAnalyzer = new CardAnalyzer();

export default CardAnalyzer;
