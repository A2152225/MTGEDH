import type { Server, Socket } from "socket.io";
import type { PlayerID, BattlefieldPermanent } from "../../../shared/src/index.js";
import crypto from "crypto";
import { ensureGame, appendGameEvent, broadcastGame, getPlayerName, emitToPlayer, broadcastManaPoolUpdate, getEffectivePower, getEffectiveToughness, parseManaCost, getOrInitManaPool, calculateTotalAvailableMana, validateManaPayment, consumeManaFromPool, calculateManaProduction } from "./util";
import { appendEvent } from "../db";
import { games } from "./socket";
import { 
  permanentHasCreatureType,
  findPermanentsWithCreatureType 
} from "../../../shared/src/creatureTypes";
import { parseSacrificeCost, type SacrificeType } from "../../../shared/src/textUtils";
import { getDeathTriggers, getPlayersWhoMustSacrifice, getLandfallTriggers, getETBTriggersForPermanent } from "../state/modules/triggered-abilities";
import { triggerETBEffectsForToken } from "../state/modules/stack";
import { 
  getManaAbilitiesForPermanent, 
  getManaMultiplier, 
  getExtraManaProduction, 
  getDevotionManaAmount, 
  getCreatureCountManaAmount,
  detectManaModifiers
} from "../state/modules/mana-abilities";
import { exchangePermanentOracleText } from "../state/utils";
import { ResolutionQueueManager, ResolutionStepType } from "../state/resolution/index.js";
import { parseUpgradeAbilities as parseCreatureUpgradeAbilities } from "../../../rules-engine/src/creatureUpgradeAbilities";
import { isAIPlayer } from "./ai.js";
import { getActivatedAbilityConfig } from "../../../rules-engine/src/cards/activatedAbilityCards.js";
import { creatureHasHaste } from "./game-actions.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";
import { registerManaHandlers } from "./mana-handlers.js";

// ============================================================================
// Constants
// ============================================================================

/**
 * Mapping of number words to numeric values for parsing ability text.
 * Used for interpreting draw counts, damage amounts, etc. in oracle text.
 */
const WORD_TO_NUMBER: Record<string, number> = {
  'one': 1, 'a': 1, 'an': 1, '1': 1,
  'two': 2, '2': 2,
  'three': 3, '3': 3,
  'four': 4, '4': 4,
  'five': 5, '5': 5,
  'six': 6, '6': 6,
  'seven': 7, '7': 7,
  'eight': 8, '8': 8,
  'nine': 9, '9': 9,
  'ten': 10, '10': 10,
};

// ============================================================================
// Special Land Activated Abilities Configuration
// ============================================================================

/**
 * Configuration for lands with special activated abilities beyond standard mana production.
 * These include:
 * - Hybrid mana cost lands that produce multiple mana (Graven Cairns, Cascade Bluffs, etc.)
 * - Storage counter lands (Calciform Pools, Dreadship Reef, etc.)
 * - Creature-lands (Mutavault, Inkmoth Nexus, etc.)
 * - Hideaway lands (Windbrisk Heights, Mosswort Bridge, etc.)
 */
interface LandAbilityConfig {
  /** Type of special ability */
  type: 'hybrid_mana_production' | 'storage_counter' | 'animate' | 'hideaway';
  
  /** For hybrid_mana_production: cost to activate (e.g., "{B/R}, {T}") */
  cost?: string;
  
  /** For hybrid_mana_production: colors that can be produced (e.g., ['B', 'R']) */
  colors?: string[];
  
  /** For hybrid_mana_production: total mana produced (e.g., 2 for Graven Cairns) */
  totalMana?: number;
  
  /** For storage_counter: counter type (e.g., "storage") */
  counterType?: string;
  
  /** For animate: power/toughness when animated */
  power?: number;
  toughness?: number;
  
  /** For animate: types to add when animated */
  creatureTypes?: string[];
  
  /** For hideaway: number of cards to exile */
  hideawayCount?: number;
}

const SPECIAL_LAND_ABILITIES: Record<string, LandAbilityConfig> = {
  // Hybrid mana production lands - pay hybrid cost, tap, choose how to distribute 2 mana
  'graven cairns': {
    type: 'hybrid_mana_production',
    cost: '{B/R}',
    colors: ['B', 'R'],
    totalMana: 2,
  },
  'cascade bluffs': {
    type: 'hybrid_mana_production',
    cost: '{U/R}',
    colors: ['U', 'R'],
    totalMana: 2,
  },
  'twilight mire': {
    type: 'hybrid_mana_production',
    cost: '{B/G}',
    colors: ['B', 'G'],
    totalMana: 2,
  },
  'mystic gate': {
    type: 'hybrid_mana_production',
    cost: '{W/U}',
    colors: ['W', 'U'],
    totalMana: 2,
  },
  'fire-lit thicket': {
    type: 'hybrid_mana_production',
    cost: '{R/G}',
    colors: ['R', 'G'],
    totalMana: 2,
  },
  'wooded bastion': {
    type: 'hybrid_mana_production',
    cost: '{G/W}',
    colors: ['G', 'W'],
    totalMana: 2,
  },
  'fetid heath': {
    type: 'hybrid_mana_production',
    cost: '{W/B}',
    colors: ['W', 'B'],
    totalMana: 2,
  },
  'flooded grove': {
    type: 'hybrid_mana_production',
    cost: '{G/U}',
    colors: ['G', 'U'],
    totalMana: 2,
  },
  'sunken ruins': {
    type: 'hybrid_mana_production',
    cost: '{U/B}',
    colors: ['U', 'B'],
    totalMana: 2,
  },
  'rugged prairie': {
    type: 'hybrid_mana_production',
    cost: '{R/W}',
    colors: ['R', 'W'],
    totalMana: 2,
  },
  
  // Storage counter lands
  'calciform pools': {
    type: 'storage_counter',
    counterType: 'storage',
    colors: ['W', 'U'],
  },
  'dreadship reef': {
    type: 'storage_counter',
    counterType: 'storage',
    colors: ['U', 'B'],
  },
  'molten slagheap': {
    type: 'storage_counter',
    counterType: 'storage',
    colors: ['B', 'R'],
  },
  'fungal reaches': {
    type: 'storage_counter',
    counterType: 'storage',
    colors: ['R', 'G'],
  },
  'saltcrusted steppe': {
    type: 'storage_counter',
    counterType: 'storage',
    colors: ['G', 'W'],
  },
  
  // Creature-lands
  'mutavault': {
    type: 'animate',
    power: 2,
    toughness: 2,
    creatureTypes: ['all'], // Special: has all creature types
  },
  
  // Hideaway lands
  'windbrisk heights': {
    type: 'hideaway',
    hideawayCount: 4,
  },
  'mosswort bridge': {
    type: 'hideaway',
    hideawayCount: 4,
  },
  'shelldock isle': {
    type: 'hideaway',
    hideawayCount: 4,
  },
  'spinerock knoll': {
    type: 'hideaway',
    hideawayCount: 4,
  },
};

// ============================================================================
// Tap/Untap Ability Text Parsing
// ============================================================================

const getBattlefield = (game: any): BattlefieldPermanent[] =>
  Array.isArray(game?.state?.battlefield)
    ? (game.state.battlefield as BattlefieldPermanent[])
    : [];

/**
 * Parse ability text to determine tap/untap target parameters.
 * 
 * Analyzes oracle text to extract information about tap/untap abilities including:
 * - Action type (tap, untap, or both)
 * - Target types (creature, land, artifact, etc.)
 * - Number of targets required
 * - Controller restrictions (you control, opponent controls, any)
 * - Source exclusion (abilities that say "another target")
 * 
 * @param text - The oracle text of the ability to parse
 * @returns Object with parsed parameters, or null if text doesn't describe a tap/untap ability
 * 
 * @example
 * parseTapUntapAbilityText("Untap another target creature or land")
 * // Returns: { action: 'untap', types: ['creature', 'land'], count: 1, excludeSource: true, controller: 'any' }
 * 
 * @example
 * parseTapUntapAbilityText("Tap or untap target permanent")
 * // Returns: { action: 'both', types: ['permanent'], count: 1, excludeSource: false, controller: 'any' }
 * 
 * @example
 * parseTapUntapAbilityText("Untap two target lands")
 * // Returns: { action: 'untap', types: ['land'], count: 2, excludeSource: false, controller: 'any' }
 */
export function parseTapUntapAbilityText(text: string): {
  action: 'tap' | 'untap' | 'both';
  types: string[];
  count: number;
  excludeSource: boolean;
  controller?: 'you' | 'opponent' | 'any';
} | null {
  const lowerText = text.toLowerCase();
  
  // Check for tap/untap action
  let action: 'tap' | 'untap' | 'both' = 'untap';
  if (lowerText.includes('tap or untap') || lowerText.includes('untap or tap')) {
    action = 'both';
  } else if (lowerText.includes('untap')) {
    action = 'untap';
  } else if (lowerText.includes('tap')) {
    action = 'tap';
  } else {
    return null; // Not a tap/untap ability
  }

  // Extract target count
  let count = 1;
  const numberWords: Record<string, number> = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
  };
  
  const countMatch = lowerText.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|up to (\d+))\s+target/);
  if (countMatch) {
    if (countMatch[2]) {
      // "up to N" format
      count = parseInt(countMatch[2], 10);
    } else {
      // Number word format
      const word = countMatch[1];
      count = numberWords[word] || 1;
    }
  }

  // Extract target types
  const types: string[] = [];
  const typePattern = /target (creature|land|artifact|enchantment|planeswalker|permanent|creature or land|land or creature)s?/g;
  
  let match;
  while ((match = typePattern.exec(lowerText)) !== null) {
    const typeStr = match[1];
    if (typeStr.includes(' or ')) {
      // Handle "creature or land"
      types.push(...typeStr.split(' or ').map(t => t.trim()));
    } else {
      types.push(typeStr);
    }
  }

  // Default to 'permanent' if no specific type found
  if (types.length === 0) {
    types.push('permanent');
  }

  // Check for "another" (exclude source)
  const excludeSource = lowerText.includes('another target') || lowerText.includes('target other');

  // Check for controller restrictions
  let controller: 'you' | 'opponent' | 'any' = 'any';
  if (lowerText.includes('you control')) {
    controller = 'you';
  } else if (lowerText.includes('opponent controls') || lowerText.includes('an opponent controls')) {
    controller = 'opponent';
  }

  return {
    action,
    types,
    count,
    excludeSource,
    controller,
  };
}

/**
 * Helper function to parse activation cost from oracle text.
 * Extracts mana cost and whether the ability requires tapping.
 * 
 * @param oracleText - The oracle text to parse (should be lowercase)
 * @param abilityPattern - Regex pattern to match the ability (e.g., /untap|tap|move/)
 * @returns Object with requiresTap flag and manaCost string
 */
function parseActivationCost(oracleText: string, abilityPattern: RegExp): {
  requiresTap: boolean;
  manaCost: string;
} {
  const costMatch = oracleText.match(new RegExp(`([^:]+?):\\s*${abilityPattern.source}`, 'i'));
  const costStr = costMatch ? costMatch[1].trim() : "";
  
  const requiresTap = costStr.includes('{t}') || costStr.includes('tap');
  const manaCostMatch = costStr.match(/\{[^}]+\}/g);
  const manaCost = manaCostMatch ? manaCostMatch.filter(c => !c.includes('T')).join('') : "";
  
  return { requiresTap, manaCost };
}

// ============================================================================
// Pre-compiled RegExp patterns for creature type matching
// Optimization: Created once at module load instead of inside loops
// ============================================================================

/** All known creature types for type line parsing */
const CREATURE_TYPES = [
  // Humanoid races
  'human', 'elf', 'dwarf', 'goblin', 'orc', 'giant', 'merfolk', 'vampire', 
  'zombie', 'skeleton', 'spirit', 'specter', 'wraith', 'shade',
  'angel', 'demon', 'devil', 'dragon', 'drake', 'hydra', 'phoenix', 'sphinx',
  'elemental', 'construct', 'golem', 'myr', 'thopter', 'servo',
  'wizard', 'cleric', 'rogue', 'warrior', 'knight', 'soldier', 'berserker',
  'shaman', 'druid', 'monk', 'samurai', 'ninja', 'assassin', 'archer', 'scout',
  'artificer', 'pilot', 'pirate', 'rebel', 'advisor', 'noble', 'citizen',
  // Animals and beasts
  'beast', 'cat', 'dog', 'wolf', 'bear', 'bird', 'snake', 'spider', 'insect',
  'rat', 'bat', 'ape', 'elephant', 'dinosaur', 'lizard', 'crocodile',
  'fish', 'shark', 'whale', 'octopus', 'crab', 'turtle', 'frog', 'salamander',
  'horse', 'unicorn', 'pegasus', 'ox', 'boar', 'elk', 'deer', 'goat', 'sheep',
  'squirrel', 'rabbit', 'badger', 'weasel', 'fox', 'wolverine', 'otter',
  // Fantasy creatures
  'sliver', 'eldrazi', 'phyrexian', 'horror', 'nightmare', 'wurm', 'leviathan',
  'kraken', 'serpent', 'treefolk', 'fungus', 'plant', 'saproling', 'ooze', 'slime',
  'faerie', 'sprite', 'imp', 'homunculus', 'shapeshifter', 'changeling',
  'avatar', 'god', 'demigod', 'archon', 'incarnation', 'praetor',
  'kithkin', 'vedalken', 'viashino', 'leonin', 'loxodon', 'minotaur', 'centaur',
  'satyr', 'nymph', 'dryad', 'naiad', 'siren', 'gorgon', 'cyclops',
  // Tribal favorites
  'ally', 'mutant', 'mercenary', 'minion', 'thrull', 'serf',
  // Typal specific
  'kavu', 'atog', 'brushwagg', 'homarid', 'cephalid', 'moonfolk', 'noggle',
  'surrakar', 'kraul', 'lhurgoyf', 'thalakos', 'dauthi', 'soltari',
  // More creatures
  'gnome', 'kobold', 'werewolf', 'hellion', 'kor', 'zubera', 'bringer',
  'flagbearer', 'illusion', 'elder', 'spawn', 'scion',
  'processor', 'drone', 'ranger', 'bard', 'warlock', 'barbarian',
] as const;

/** Pre-compiled word-boundary regex patterns for each creature type */
const CREATURE_TYPE_PATTERNS: Map<string, RegExp> = new Map(
  CREATURE_TYPES.map(type => [type, new RegExp(`\\b${type}\\b`, 'i')])
);

// ============================================================================
// Library Search Restriction Handling (Aven Mindcensor, Stranglehold, etc.)
// ============================================================================

/** Known cards that prevent or restrict library searching */
const SEARCH_PREVENTION_CARDS: Record<string, { affectsOpponents: boolean; affectsSelf: boolean }> = {
  "stranglehold": { affectsOpponents: true, affectsSelf: false },
  "ashiok, dream render": { affectsOpponents: true, affectsSelf: false },
  "mindlock orb": { affectsOpponents: true, affectsSelf: true },
  "shadow of doubt": { affectsOpponents: true, affectsSelf: true },
  "leonin arbiter": { affectsOpponents: true, affectsSelf: true }, // Can pay {2}
};

/** Known cards that limit library searching to top N cards */
const SEARCH_LIMIT_CARDS: Record<string, { limit: number; affectsOpponents: boolean }> = {
  "aven mindcensor": { limit: 4, affectsOpponents: true },
};

/** Known cards that trigger when opponents search */
const SEARCH_TRIGGER_CARDS: Record<string, { effect: string; affectsOpponents: boolean }> = {
  "ob nixilis, unshackled": { effect: "Sacrifice a creature and lose 10 life", affectsOpponents: true },
};

/** Known cards that give control during opponent's search */
const SEARCH_CONTROL_CARDS = new Set(["opposition agent"]);

/**
 * Check for search restrictions affecting a player
 */
function checkLibrarySearchRestrictions(
  game: any,
  searchingPlayerId: string
): {
  canSearch: boolean;
  limitToTop?: number;
  triggerEffects: { cardName: string; effect: string; controllerId: string }[];
  controlledBy?: string;
  reason?: string;
  paymentRequired?: { cardName: string; amount: string };
} {
  const battlefield = game.state?.battlefield || [];
  const triggerEffects: { cardName: string; effect: string; controllerId: string }[] = [];
  let canSearch = true;
  let limitToTop: number | undefined;
  let controlledBy: string | undefined;
  let reason: string | undefined;
  let paymentRequired: { cardName: string; amount: string } | undefined;
  
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    
    const cardName = (perm.card.name || "").toLowerCase();
    const controllerId = perm.controller;
    const isOpponent = controllerId !== searchingPlayerId;
    
    // Check prevention cards
    for (const [name, info] of Object.entries(SEARCH_PREVENTION_CARDS)) {
      if (cardName.includes(name)) {
        const applies = (isOpponent && info.affectsOpponents) || (!isOpponent && info.affectsSelf);
        if (applies) {
          // Special case: Leonin Arbiter allows payment
          if (name === "leonin arbiter") {
            paymentRequired = { cardName: perm.card.name, amount: "{2}" };
          } else {
            canSearch = false;
            reason = `${perm.card.name} prevents library searching`;
          }
        }
      }
    }
    
    // Check limit cards (Aven Mindcensor)
    for (const [name, info] of Object.entries(SEARCH_LIMIT_CARDS)) {
      if (cardName.includes(name)) {
        if (isOpponent && info.affectsOpponents) {
          if (limitToTop === undefined || info.limit < limitToTop) {
            limitToTop = info.limit;
          }
        }
      }
    }
    
    // Check trigger cards (Ob Nixilis)
    for (const [name, info] of Object.entries(SEARCH_TRIGGER_CARDS)) {
      if (cardName.includes(name)) {
        if (isOpponent && info.affectsOpponents) {
          triggerEffects.push({
            cardName: perm.card.name,
            effect: info.effect,
            controllerId,
          });
        }
      }
    }
    
    // Check control cards (Opposition Agent)
    if (SEARCH_CONTROL_CARDS.has(cardName)) {
      if (isOpponent) {
        controlledBy = controllerId;
      }
    }
  }
  
  return {
    canSearch,
    limitToTop,
    triggerEffects,
    controlledBy,
    reason,
    paymentRequired,
  };
}

/**
 * Get searchable library cards considering Aven Mindcensor effect
 */
function getSearchableLibraryCards(library: any[], limitToTop?: number): any[] {
  if (limitToTop !== undefined && limitToTop > 0) {
    return library.slice(0, limitToTop);
  }
  return library;
}

// Simple unique ID generator for this module
let idCounter = 0;
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++idCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Find all untapped permanents controlled by a player that have a specific creature type.
 * This is used for abilities like "Tap four untapped Merfolk you control".
 * Uses the shared implementation that handles Tribal, Kindred, and Changelings.
 */
function findUntappedPermanentsWithCreatureType(
  battlefield: any[],
  playerId: string,
  creatureType: string
): any[] {
  return findPermanentsWithCreatureType(battlefield, playerId, creatureType, true);
}

/**
 * Parse an ability cost to detect tap requirements.
 * Returns info about what needs to be tapped.
 * Examples:
 * - "Tap four untapped Merfolk you control" -> { count: 4, creatureType: "merfolk", tapSelf: false }
 * - "{T}, Sacrifice ~" -> { tapSelf: true }
 */
function parseAbilityCost(oracleText: string): {
  tapSelf?: boolean;
  tapCount?: number;
  tapCreatureType?: string;
  sacrificeSelf?: boolean;
  payLife?: number;
  payMana?: string;
} {
  const text = oracleText.toLowerCase();
  const result: any = {};
  
  // Check for tap self
  if (text.includes("{t}") || text.includes("{t},") || text.includes("{t}:")) {
    result.tapSelf = true;
  }
  
  // Check for sacrifice self
  if (text.includes("sacrifice ~") || text.includes("sacrifice this")) {
    result.sacrificeSelf = true;
  }
  
  // Check for pay life
  const lifeMatch = text.match(/pay (\d+) life/);
  if (lifeMatch) {
    result.payLife = parseInt(lifeMatch[1], 10);
  }
  
  // Check for tapping multiple creatures of a type
  // Pattern: "Tap X untapped [Type] you control"
  // Use \w+ instead of [a-z]+ to properly capture creature types
  const tapCreaturesMatch = text.match(/tap (\w+|\d+) untapped (\w+)(?:s)? you control/i);
  if (tapCreaturesMatch) {
    const countStr = tapCreaturesMatch[1].toLowerCase();
    const countMap: Record<string, number> = {
      "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
      "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10
    };
    result.tapCount = countMap[countStr] || parseInt(countStr, 10) || 1;
    result.tapCreatureType = tapCreaturesMatch[2];
  }
  
  // Check for mana cost
  const manaMatch = text.match(/\{([wubrgc0-9]+)\}/gi);
  if (manaMatch && manaMatch.length > 0) {
    // Filter out {T} which is tap symbol
    const manaCosts = manaMatch.filter(m => m.toLowerCase() !== "{t}");
    if (manaCosts.length > 0) {
      result.payMana = manaCosts.join("");
    }
  }
  
  return result;
}

/**
 * Tutor effect detection result
 */
export interface TutorInfo {
  isTutor: boolean;
  searchCriteria?: string;
  destination?: string;
  maxSelections?: number;
  /** For split-destination effects like Kodama's Reach/Cultivate */
  splitDestination?: boolean;
  /** Number of cards to put on battlefield for split effects */
  toBattlefield?: number;
  /** Number of cards to put in hand for split effects */
  toHand?: number;
  /** Whether cards enter battlefield tapped */
  entersTapped?: boolean;
}

/**
 * Check if a spell's oracle text indicates it's a tutor (search library) effect
 * and parse the intended destination for the searched card.
 * 
 * Common tutor destination patterns:
 * - "put it into your hand" -> hand (Demonic Tutor, Vampiric Tutor final)
 * - "put it onto the battlefield" -> battlefield (Green Sun's Zenith, Eladamri's Call)
 * - "put it on top of your library" -> top (Vampiric Tutor, Mystical Tutor, Worldly Tutor)
 * - "put it into your graveyard" -> graveyard (Entomb, Buried Alive)
 * - "reveal it" (then hand) -> hand (most white/blue tutors)
 * 
 * Special patterns:
 * - Kodama's Reach/Cultivate: "put one onto the battlefield tapped and the other into your hand"
 */
export function detectTutorEffect(oracleText: string): TutorInfo {
  if (!oracleText) return { isTutor: false };
  
  const text = oracleText.toLowerCase();
  
  // Common tutor patterns
  if (text.includes('search your library')) {
    let searchCriteria = '';
    let destination = 'hand'; // Default destination
    let maxSelections = 1;
    
    // Detect what type of card to search for
    const forMatch = text.match(/search your library for (?:a|an|up to (\w+)) ([^,\.]+)/i);
    if (forMatch) {
      // Check for "up to N" pattern
      if (forMatch[1]) {
        const num = forMatch[1].toLowerCase();
        if (num === 'two') maxSelections = 2;
        else if (num === 'three') maxSelections = 3;
        else if (num === 'four') maxSelections = 4;
        else {
          const parsed = parseInt(num, 10);
          if (!isNaN(parsed)) maxSelections = parsed;
        }
      }
      searchCriteria = forMatch[2].trim();
    }
    
    // SPECIAL CASE: Kodama's Reach / Cultivate pattern
    // "put one onto the battlefield tapped and the other into your hand"
    if (text.includes('put one onto the battlefield') && text.includes('the other into your hand')) {
      const entersTapped = text.includes('battlefield tapped');
      return {
        isTutor: true,
        searchCriteria,
        destination: 'split', // Special destination type
        maxSelections: 2,
        splitDestination: true,
        toBattlefield: 1,
        toHand: 1,
        entersTapped,
      };
    }
    
    // SPECIAL CASE: Three Visits / Nature's Lore pattern  
    // "put that card onto the battlefield tapped"
    if (text.includes('forest card') && text.includes('put that card onto the battlefield')) {
      const entersTapped = text.includes('battlefield tapped');
      return {
        isTutor: true,
        searchCriteria: 'forest card',
        destination: 'battlefield',
        maxSelections: 1,
        entersTapped,
      };
    }
    
    // Detect destination - order matters! More specific patterns first
    
    // Top of library patterns (Vampiric Tutor, Mystical Tutor, Worldly Tutor, Enlightened Tutor)
    if (text.includes('put it on top of your library') || 
        text.includes('put that card on top of your library') ||
        text.includes('put it on top') ||
        text.includes('put that card on top')) {
      destination = 'top';
    }
    // Battlefield patterns (Green Sun's Zenith, Chord of Calling, Natural Order)
    else if (text.includes('put it onto the battlefield') || 
             text.includes('put that card onto the battlefield') ||
             text.includes('put onto the battlefield') ||
             text.includes('enters the battlefield')) {
      destination = 'battlefield';
    }
    // Graveyard patterns (Entomb, Buried Alive)
    else if (text.includes('put it into your graveyard') || 
             text.includes('put that card into your graveyard') ||
             text.includes('put into your graveyard')) {
      destination = 'graveyard';
    }
    // Hand patterns (Demonic Tutor, Diabolic Tutor, Grim Tutor)
    else if (text.includes('put it into your hand') || 
             text.includes('put that card into your hand') ||
             text.includes('add it to your hand') ||
             text.includes('reveal it') || // Most reveal tutors put to hand
             text.includes('reveal that card')) {
      destination = 'hand';
    }
    
    return { isTutor: true, searchCriteria, destination, maxSelections };
  }
  
  return { isTutor: false };
}

/**
 * Get current creature types for a permanent, including upgraded types.
 * This is used for creature upgrade abilities that have conditions like
 * "If ~ is a Spirit" (Figure of Destiny).
 * 
 * @param permanent - The permanent to get creature types from
 * @returns Array of creature types
 */
function getUpgradedCreatureTypes(permanent: any): string[] {
  // First check for explicitly upgraded types stored on the permanent
  if (permanent.upgradedCreatureTypes && Array.isArray(permanent.upgradedCreatureTypes)) {
    return permanent.upgradedCreatureTypes;
  }
  
  // Fall back to parsing from type line
  const typeLine = (permanent.card?.type_line || '').toLowerCase();
  const dashIndex = typeLine.indexOf('—');
  if (dashIndex === -1) return [];
  
  const subtypes = typeLine.slice(dashIndex + 1).trim();
  return subtypes
    .split(/\s+/)
    .filter(t => t.length > 0)
    .map(t => t.charAt(0).toUpperCase() + t.slice(1));
}

/**
 * Parse search criteria to create a filter object
 */
export function parseSearchCriteria(criteria: string): { 
  supertypes?: string[]; 
  types?: string[]; 
  subtypes?: string[];
  minCmc?: number;
  maxCmc?: number;
  minPower?: number;
  maxPower?: number;
  minToughness?: number;
  maxToughness?: number;
} {
  const result: { 
    supertypes?: string[]; 
    types?: string[]; 
    subtypes?: string[];
    minCmc?: number;
    maxCmc?: number;
    minPower?: number;
    maxPower?: number;
    minToughness?: number;
    maxToughness?: number;
  } = {};
  const text = criteria.toLowerCase();
  
  // ============================================
  // CMC / Mana Value filtering
  // ============================================
  // Pattern: "mana value X or greater" / "converted mana cost X or greater"
  // Examples: "mana value 6 or greater", "with mana value 6 or greater", "cmc >= 6"
  // The pattern allows for optional "with" or other words before "mana value"
  const manaValueGreaterMatch = text.match(/(?:with\s+)?(?:mana (?:value|cost)|converted mana cost|cmc)\s+(\d+)\s+or\s+(?:greater|more)/);
  if (manaValueGreaterMatch) {
    result.minCmc = parseInt(manaValueGreaterMatch[1], 10);
  }
  
  // Pattern: "mana value X or less" / "converted mana cost X or less"
  const manaValueLessMatch = text.match(/(?:with\s+)?(?:mana (?:value|cost)|converted mana cost|cmc)\s+(\d+)\s+or\s+(?:less|fewer)/);
  if (manaValueLessMatch) {
    result.maxCmc = parseInt(manaValueLessMatch[1], 10);
  }
  
  // Pattern: "mana value exactly X" / "mana value X"
  const manaValueExactMatch = text.match(/(?:with\s+)?(?:mana (?:value|cost)|converted mana cost|cmc)\s+(?:exactly\s+)?(\d+)(?!\s+or)/);
  if (manaValueExactMatch && !manaValueGreaterMatch && !manaValueLessMatch) {
    const cmc = parseInt(manaValueExactMatch[1], 10);
    result.minCmc = cmc;
    result.maxCmc = cmc;
  }
  
  // ============================================
  // Power filtering
  // ============================================
  // Pattern: "power X or greater" / "power X or more"
  const powerGreaterMatch = text.match(/power\s+(\d+)\s+or\s+(?:greater|more)/);
  if (powerGreaterMatch) {
    result.minPower = parseInt(powerGreaterMatch[1], 10);
  }
  
  // Pattern: "power X or less"
  const powerLessMatch = text.match(/power\s+(\d+)\s+or\s+(?:less|fewer)/);
  if (powerLessMatch) {
    result.maxPower = parseInt(powerLessMatch[1], 10);
  }
  
  // ============================================
  // Toughness filtering
  // ============================================
  // Pattern: "toughness X or greater" / "toughness X or more"
  const toughnessGreaterMatch = text.match(/toughness\s+(\d+)\s+or\s+(?:greater|more)/);
  if (toughnessGreaterMatch) {
    result.minToughness = parseInt(toughnessGreaterMatch[1], 10);
  }
  
  // Pattern: "toughness X or less"
  const toughnessLessMatch = text.match(/toughness\s+(\d+)\s+or\s+(?:less|fewer)/);
  if (toughnessLessMatch) {
    result.maxToughness = parseInt(toughnessLessMatch[1], 10);
  }
  
  // ============================================
  // Supertypes (Basic, Legendary, Snow, World, Ongoing, Host)
  // ============================================
  const supertypes: string[] = [];
  if (text.includes('basic')) supertypes.push('basic');
  if (text.includes('legendary')) supertypes.push('legendary');
  if (text.includes('snow')) supertypes.push('snow');
  if (text.includes('world')) supertypes.push('world');
  if (text.includes('ongoing')) supertypes.push('ongoing');
  if (text.includes('host')) supertypes.push('host');
  
  // ============================================
  // Card types
  // ============================================
  const types: string[] = [];
  if (text.includes('creature')) types.push('creature');
  if (text.includes('planeswalker')) types.push('planeswalker');
  if (text.includes('artifact')) types.push('artifact');
  if (text.includes('enchantment')) types.push('enchantment');
  if (text.includes('instant')) types.push('instant');
  if (text.includes('sorcery')) types.push('sorcery');
  if (text.includes('land')) types.push('land');
  if (text.includes('tribal') || text.includes('kindred')) types.push('tribal'); // Tribal/Kindred type
  if (text.includes('battle')) types.push('battle'); // New type from March of the Machine
  if (text.includes('dungeon')) types.push('dungeon');
  if (text.includes('conspiracy')) types.push('conspiracy');
  if (text.includes('phenomenon')) types.push('phenomenon');
  if (text.includes('plane')) types.push('plane');
  if (text.includes('scheme')) types.push('scheme');
  if (text.includes('vanguard')) types.push('vanguard');
  
  // Special composite searches
  if (text.includes('historic')) {
    // Historic = artifacts, legendaries, sagas
    // Add as a special marker
    types.push('historic');
  }
  if (text.includes('permanent')) {
    // Permanent = creature, artifact, enchantment, land, planeswalker, battle
    types.push('permanent');
  }
  if (text.includes('noncreature')) {
    types.push('noncreature');
  }
  if (text.includes('nonland')) {
    types.push('nonland');
  }
  if (text.includes('nonartifact')) {
    types.push('nonartifact');
  }
  
  const subtypes: string[] = [];
  
  // ============================================
  // Artifact subtypes
  // ============================================
  if (text.includes('equipment')) subtypes.push('equipment');
  if (text.includes('vehicle')) subtypes.push('vehicle');
  if (text.includes('treasure')) subtypes.push('treasure');
  if (text.includes('food')) subtypes.push('food');
  if (text.includes('clue')) subtypes.push('clue');
  if (text.includes('blood')) subtypes.push('blood');
  if (text.includes('gold')) subtypes.push('gold');
  if (text.includes('powerstone')) subtypes.push('powerstone');
  if (text.includes('map')) subtypes.push('map');
  if (text.includes('fortification')) subtypes.push('fortification');
  if (text.includes('contraption')) subtypes.push('contraption');
  if (text.includes('attraction')) subtypes.push('attraction');
  
  // ============================================
  // Enchantment subtypes
  // ============================================
  if (text.includes('aura')) subtypes.push('aura');
  if (text.includes('curse')) subtypes.push('curse');
  if (text.includes('saga')) subtypes.push('saga');
  if (text.includes('shrine')) subtypes.push('shrine');
  if (text.includes('cartouche')) subtypes.push('cartouche');
  if (text.includes('background')) subtypes.push('background');
  if (text.includes('class')) subtypes.push('class');
  if (text.includes('role')) subtypes.push('role');
  if (text.includes('room')) subtypes.push('room');
  if (text.includes('case')) subtypes.push('case');
  if (text.includes('rune')) subtypes.push('rune');
  if (text.includes('shard')) subtypes.push('shard');
  
  // ============================================
  // Land subtypes
  // ============================================
  if (text.includes('forest')) subtypes.push('forest');
  if (text.includes('plains')) subtypes.push('plains');
  if (text.includes('island')) subtypes.push('island');
  if (text.includes('swamp')) subtypes.push('swamp');
  if (text.includes('mountain')) subtypes.push('mountain');
  if (text.includes('gate')) subtypes.push('gate');
  if (text.includes('desert')) subtypes.push('desert');
  if (text.includes('locus')) subtypes.push('locus');
  if (text.includes('lair')) subtypes.push('lair');
  if (text.includes('cave')) subtypes.push('cave');
  if (text.includes('sphere')) subtypes.push('sphere');
  if (text.includes('mine')) subtypes.push('mine');
  if (text.includes('power-plant')) subtypes.push('power-plant');
  if (text.includes('tower')) subtypes.push('tower');
  
  // ============================================
  // Spell subtypes
  // ============================================
  if (text.includes('arcane')) subtypes.push('arcane');
  if (text.includes('trap')) subtypes.push('trap');
  if (text.includes('adventure')) subtypes.push('adventure');
  if (text.includes('lesson')) subtypes.push('lesson');
  
  // ============================================
  // Common creature types (using pre-compiled patterns)
  // ============================================
  for (const [creatureType, pattern] of CREATURE_TYPE_PATTERNS) {
    // Use pre-compiled word boundary regex to avoid false positives
    // e.g., "elf" should match "elf" but not "shelf"
    if (pattern.test(text)) {
      subtypes.push(creatureType);
    }
  }
  
  // ============================================
  // Planeswalker subtypes (planeswalker types)
  // ============================================
  const planeswalkerTypes = [
    'jace', 'liliana', 'chandra', 'garruk', 'ajani', 'elspeth', 'nissa', 'gideon',
    'sorin', 'tamiyo', 'nahiri', 'ashiok', 'teferi', 'karn', 'ugin', 'nicol',
    'bolas', 'tibalt', 'vraska', 'domri', 'ral', 'kaya', 'vivien', 'oko',
    'basri', 'lukka', 'calix', 'tyvar', 'lolth', 'mordenkainen', 'ellywick',
    'zariel', 'dakkon', 'dihada', 'jeska', 'ob nixilis', 'tezzeret', 'kiora',
    'xenagos', 'saheeli', 'huatli', 'angrath', 'aminatou', 'estrid', 'rowan', 'will',
    'kaito', 'the wanderer', 'wrenn', 'niko', 'quintorius', 'elminster', 'minsc',
  ];
  
  for (const pwType of planeswalkerTypes) {
    if (text.includes(pwType)) {
      subtypes.push(pwType);
    }
  }
  
  // ============================================
  // Battle subtypes
  // ============================================
  if (text.includes('siege')) subtypes.push('siege');
  
  if (supertypes.length > 0) result.supertypes = supertypes;
  if (types.length > 0) result.types = types;
  if (subtypes.length > 0) result.subtypes = subtypes;
  
  return result;
}

export function registerInteractionHandlers(io: Server, socket: Socket) {
  // Scry: Peek and reorder library cards
  // Legacy scry/surveil handlers removed - now using resolution queue system
  // See processPendingScry() and processPendingSurveil() in resolution.ts
  
  // surveilResolve continued from removed handler (keeping for any remaining references)
  // TODO: Clean up after verifying no dependencies

  // Confirm Ponder-style effect (look at top N, reorder, optionally shuffle, then draw)
  socket.on("confirmPonder", ({ gameId, effectId, newOrder, shouldShuffle, toHand }: {
    gameId: string;
    effectId: string;
    newOrder: string[];  // Card IDs in new order (top first) - cards staying on library
    shouldShuffle: boolean;
    toHand?: string[];   // Card IDs going to hand (for Telling Time style)
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }

    // Get the pending ponder effect
    const pendingPonder = (game.state as any).pendingPonder?.[pid];
    if (!pendingPonder || pendingPonder.effectId !== effectId) {
      socket.emit("error", { code: "PONDER_NOT_FOUND", message: "No matching pending Ponder effect" });
      return;
    }

    const { cardCount, cardName, drawAfter, targetPlayerId, variant } = pendingPonder;
    const targetPid = targetPlayerId || pid;

    // Get library for the target player
    const lib = (game as any).libraries?.get(targetPid) || [];
    
    // Remove the top N cards that were being reordered
    const removedCards: any[] = [];
    for (let i = 0; i < cardCount && lib.length > 0; i++) {
      removedCards.push(lib.shift());
    }
    
    const cardById = new Map(removedCards.map(c => [c.id, c]));
    
    // Move cards to hand if specified (Telling Time style)
    if (toHand && toHand.length > 0) {
      const zones = (game.state as any).zones || {};
      const z = zones[pid] = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
      z.hand = z.hand || [];
      
      for (const cardId of toHand) {
        const card = cardById.get(cardId);
        if (card) {
          (z.hand as any[]).push({ ...card, zone: 'hand' });
          cardById.delete(cardId);
        }
      }
      z.handCount = (z.hand as any[]).length;
      
      debug(2, `[confirmPonder] ${pid} put ${toHand.length} card(s) to hand`);
    }
    
    if (shouldShuffle) {
      // Shuffle the remaining cards back into library first
      for (const card of cardById.values()) {
        lib.push({ ...card, zone: 'library' });
      }
      
      // Use game's shuffleLibrary for deterministic RNG if available
      if (typeof (game as any).shuffleLibrary === "function") {
        // Set the library first so shuffleLibrary can access it
        if ((game as any).libraries) {
          (game as any).libraries.set(targetPid, lib);
        }
        (game as any).shuffleLibrary(targetPid);
      } else {
        // Fallback: manual shuffle (non-deterministic) and set library
        debugWarn(2, "[confirmPonder] game.shuffleLibrary not available, using Math.random");
        for (let i = lib.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [lib[i], lib[j]] = [lib[j], lib[i]];
        }
        if ((game as any).libraries) {
          (game as any).libraries.set(targetPid, lib);
        }
      }
      debug(2, `[confirmPonder] ${targetPid} shuffled their library`);
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} shuffled their library.`,
        ts: Date.now(),
      });
    } else {
      // Put cards back in the specified order (newOrder has IDs from top to bottom)
      for (let i = newOrder.length - 1; i >= 0; i--) {
        const card = cardById.get(newOrder[i]);
        if (card) {
          lib.unshift({ ...card, zone: 'library' });
        }
      }
      debug(2, `[confirmPonder] ${targetPid} reordered top ${newOrder.length} cards`);
    }
    
    // Update library count
    const zones = (game.state as any).zones || {};
    const targetZones = zones[targetPid] = zones[targetPid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
    targetZones.libraryCount = lib.length;
    
    // Draw a card if specified (Ponder draws after reordering/shuffling)
    let drawnCardName: string | undefined;
    if (drawAfter && pid === targetPid) {
      if (lib.length > 0) {
        const drawnCard = lib.shift();
        const playerZones = zones[pid] = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
        playerZones.hand = playerZones.hand || [];
        (playerZones.hand as any[]).push({ ...drawnCard, zone: 'hand' });
        playerZones.handCount = (playerZones.hand as any[]).length;
        playerZones.libraryCount = lib.length;
        drawnCardName = drawnCard.name;
        
        debug(2, `[confirmPonder] ${pid} drew ${drawnCardName}`);
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} draws a card.`,
          ts: Date.now(),
        });
      }
    }
    
    // Clear the pending ponder effect
    delete (game.state as any).pendingPonder[pid];
    
    // Bump sequence
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    // Emit completion event
    io.to(gameId).emit("ponderComplete", {
      gameId,
      effectId,
      playerId: pid,
      targetPlayerId: targetPid,
      cardName,
      shuffled: shouldShuffle,
      drawnCardName,
    });
    
    appendEvent(gameId, game.seq, "ponderResolve", { 
      playerId: pid, 
      effectId,
      newOrder, 
      shouldShuffle, 
      toHand,
      drawnCardName,
    });

    broadcastGame(io, game, gameId);
  });


  // Explore: Reveal top card, if land put in hand, else +1/+1 counter and may put in graveyard
  socket.on("beginExplore", ({ gameId, permanentId }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const cards = game.peekTopN(pid, 1);
    
    if (!cards || cards.length === 0) {
      // Empty library - creature still explores but nothing happens
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)}'s creature explores (empty library).`,
        ts: Date.now(),
      });
      return;
    }

    const revealedCard = cards[0];
    const typeLine = (revealedCard.type_line || "").toLowerCase();
    const isLand = typeLine.includes("land");

    // Find the exploring permanent for its name
    const battlefield = getBattlefield(game);
    const exploringPerm = battlefield.find((p: any) => p.id === permanentId && p.controller === pid);
    const exploringName = exploringPerm?.card?.name || "Creature";

    socket.emit("explorePrompt", {
      gameId,
      permanentId,
      permanentName: exploringName,
      revealedCard,
      isLand,
    });

    // Announce the reveal to all players
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)}'s ${exploringName} explores, revealing ${revealedCard.name}${isLand ? " (land)" : ""}.`,
      ts: Date.now(),
    });
  });

  socket.on("confirmExplore", ({ gameId, permanentId, toGraveyard }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const cards = game.peekTopN(pid, 1);
    
    if (!cards || cards.length === 0) {
      return;
    }

    const revealedCard = cards[0];
    // Re-check land status from server state to prevent race conditions
    // where client and server state could diverge
    const typeLine = (revealedCard.type_line || "").toLowerCase();
    const isLand = typeLine.includes("land");

    // Find the exploring permanent
    const battlefield = game.state?.battlefield || [];
    const exploringPerm = battlefield.find((p: any) => p.id === permanentId && p.controller === pid);
    const exploringName = exploringPerm?.card?.name || "Creature";

    game.applyEvent({
      type: "exploreResolve",
      playerId: pid,
      permanentId,
      revealedCardId: revealedCard.id,
      isLand,
      // Defensive: ensure lands never go to graveyard regardless of client input
      toGraveyard: isLand ? false : toGraveyard,
    });

    appendEvent(gameId, game.seq, "exploreResolve", {
      playerId: pid,
      permanentId,
      revealedCardId: revealedCard.id,
      isLand,
      toGraveyard,
    });

    // Announce the result
    let resultMessage: string;
    if (isLand) {
      resultMessage = `${getPlayerName(game, pid)} puts ${revealedCard.name} into their hand.`;
    } else if (toGraveyard) {
      resultMessage = `${getPlayerName(game, pid)} puts a +1/+1 counter on ${exploringName} and puts ${revealedCard.name} into their graveyard.`;
    } else {
      resultMessage = `${getPlayerName(game, pid)} puts a +1/+1 counter on ${exploringName} and keeps ${revealedCard.name} on top of their library.`;
    }

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: resultMessage,
      ts: Date.now(),
    });

    broadcastGame(io, game, gameId);
  });

  // Batch Explore: Handle multiple creatures exploring at once (e.g., Hakbal triggers)
  // NOTE: This implementation peeks at the top card multiple times (once in beginBatchExplore
  // and once in confirmBatchExplore). This is acceptable because peekTopN doesn't modify
  // the library - it only reveals what's there. The actual card movement happens in the
  // confirmBatchExplore handler via applyEvent("exploreResolve").
  socket.on("beginBatchExplore", ({ gameId, permanentIds }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    
    if (!permanentIds || !Array.isArray(permanentIds) || permanentIds.length === 0) {
      return;
    }

    const explores: Array<{
      permanentId: string;
      permanentName: string;
      revealedCard: any;
      isLand: boolean;
    }> = [];

    for (const permanentId of permanentIds) {
      const cards = game.peekTopN(pid, 1);
      
      if (!cards || cards.length === 0) {
        continue;
      }

      const revealedCard = cards[0];
      const typeLine = (revealedCard.type_line || "").toLowerCase();
      const isLand = typeLine.includes("land");

      const battlefield = game.state?.battlefield || [];
      const exploringPerm = battlefield.find((p: any) => p.id === permanentId && p.controller === pid);
      const exploringName = exploringPerm?.card?.name || "Creature";

      explores.push({
        permanentId,
        permanentName: exploringName,
        revealedCard,
        isLand,
      });
    }

    if (explores.length === 0) {
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)}'s creatures explore (empty library).`,
        ts: Date.now(),
      });
      return;
    }

    socket.emit("batchExplorePrompt", {
      gameId,
      explores,
    });

    const revealedNames = explores.map(e => e.revealedCard.name).join(", ");
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)}'s creatures explore, revealing ${revealedNames}.`,
      ts: Date.now(),
    });
  });

  socket.on("confirmBatchExplore", ({ gameId, decisions }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    
    if (!decisions || !Array.isArray(decisions)) {
      return;
    }

    const results: string[] = [];

    for (const decision of decisions) {
      const { permanentId, toGraveyard } = decision;
      
      const cards = game.peekTopN(pid, 1);
      
      if (!cards || cards.length === 0) {
        continue;
      }

      const revealedCard = cards[0];
      const typeLine = (revealedCard.type_line || "").toLowerCase();
      const isLand = typeLine.includes("land");

      const battlefield = game.state?.battlefield || [];
      const exploringPerm = battlefield.find((p: any) => p.id === permanentId && p.controller === pid);
      const exploringName = exploringPerm?.card?.name || "Creature";

      game.applyEvent({
        type: "exploreResolve",
        playerId: pid,
        permanentId,
        revealedCardId: revealedCard.id,
        isLand,
        toGraveyard: isLand ? false : toGraveyard,
      });

      appendEvent(gameId, game.seq, "exploreResolve", {
        playerId: pid,
        permanentId,
        revealedCardId: revealedCard.id,
        isLand,
        toGraveyard: isLand ? false : toGraveyard,  // Match applyEvent behavior
      });

      if (isLand) {
        results.push(`${exploringName} → ${revealedCard.name} to hand`);
      } else if (toGraveyard) {
        results.push(`${exploringName} → +1/+1 counter, ${revealedCard.name} to graveyard`);
      } else {
        results.push(`${exploringName} → +1/+1 counter, ${revealedCard.name} on top`);
      }
    }

    if (results.length > 0) {
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} resolves explores: ${results.join("; ")}.`,
        ts: Date.now(),
      });
    }

    broadcastGame(io, game, gameId);
  });


  // Library search: Query and select cards
  socket.on("searchLibrary", ({ gameId, query, limit }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const results = game.searchLibrary(pid, query || "", Math.max(1, Math.min(100, limit || 20)));

    socket.emit("searchResults", { gameId, cards: results, total: results.length });
  });

  socket.on("selectFromSearch", ({ gameId, cardIds, moveTo, reveal }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const movedCards = game.selectFromLibrary(pid, cardIds || [], moveTo);

    appendEvent(gameId, game.seq, "selectFromLibrary", {
      playerId: pid,
      cardIds: cardIds || [],
      moveTo,
      reveal,
    });

    if (movedCards.length) {
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} moved ${movedCards.join(", ")} to ${moveTo}`,
        ts: Date.now(),
      });
    }

    broadcastGame(io, game, gameId);
  });

  // Request full library for searching (tutor effect)
  socket.on("requestLibrarySearch", ({ gameId, title, description, filter, maxSelections, moveTo, shuffleAfter }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    
    // Check for search restrictions (Aven Mindcensor, Stranglehold, etc.)
    const searchCheck = checkLibrarySearchRestrictions(game, pid);
    
    // If search is completely prevented
    if (!searchCheck.canSearch) {
      socket.emit("error", {
        code: "SEARCH_PREVENTED",
        message: searchCheck.reason || "Library search is prevented",
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)}'s library search was prevented${searchCheck.reason ? ': ' + searchCheck.reason : ''}.`,
        ts: Date.now(),
      });
      return;
    }
    
    // Get library contents (may be limited by Aven Mindcensor)
    const fullLibrary = game.searchLibrary(pid, "", 1000);
    const searchableCards = getSearchableLibraryCards(fullLibrary, searchCheck.limitToTop);
    
    // If there are trigger effects (Ob Nixilis), notify
    if (searchCheck.triggerEffects.length > 0) {
      for (const trigger of searchCheck.triggerEffects) {
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${trigger.cardName} triggers: ${trigger.effect}`,
          ts: Date.now(),
        });
        
        // Note: Trigger resolution (e.g., Ob Nixilis forcing sacrifice/life loss)
        // would require pushing to the stack and resolving. For now, we notify
        // the players via chat. Full implementation would use the stack system.
      }
    }
    
    // Build description with restriction info
    let finalDescription = description || "";
    if (searchCheck.limitToTop) {
      finalDescription = `${finalDescription ? finalDescription + " " : ""}(Searching top ${searchCheck.limitToTop} cards only - Aven Mindcensor)`;
    }
    if (searchCheck.paymentRequired) {
      finalDescription = `${finalDescription ? finalDescription + " " : ""}(Must pay ${searchCheck.paymentRequired.amount} to ${searchCheck.paymentRequired.cardName})`;
    }
    
    socket.emit("librarySearchRequest", {
      gameId,
      cards: searchableCards,
      title: title || "Search Library",
      description: finalDescription || undefined,
      filter,
      maxSelections: maxSelections || 1,
      moveTo: moveTo || "hand",
      shuffleAfter: shuffleAfter !== false,
      searchRestrictions: {
        limitedToTop: searchCheck.limitToTop,
        paymentRequired: searchCheck.paymentRequired,
        triggerEffects: searchCheck.triggerEffects,
        controlledBy: searchCheck.controlledBy,
      },
    });
  });

  // Handle graveyard ability activation
  socket.on("activateGraveyardAbility", ({ gameId, cardId, abilityId }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const zones = (game.state as any)?.zones?.[pid];
    
    if (!zones || !Array.isArray(zones.graveyard)) {
      socket.emit("error", {
        code: "GRAVEYARD_NOT_FOUND",
        message: "Graveyard not found",
      });
      return;
    }
    
    // Find the card in graveyard
    const cardIndex = zones.graveyard.findIndex((c: any) => c?.id === cardId);
    if (cardIndex === -1) {
      socket.emit("error", {
        code: "CARD_NOT_IN_GRAVEYARD",
        message: "Card not found in graveyard",
      });
      return;
    }
    
    const card = zones.graveyard[cardIndex];
    const cardName = card?.name || "Unknown";
    
    // Handle different graveyard abilities
    if (abilityId === "flashback" || abilityId === "jump-start" || abilityId === "retrace" || abilityId === "escape") {
      // Cast from graveyard - move to stack
      // Remove from graveyard
      zones.graveyard.splice(cardIndex, 1);
      zones.graveyardCount = zones.graveyard.length;
      
      // Add to stack
      const stackItem = {
        id: generateId("stack"),
        controller: pid,
        card: { ...card, zone: "stack", castWithAbility: abilityId },
        targets: [],
      };
      
      game.state.stack = game.state.stack || [];
      game.state.stack.push(stackItem as any);
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
        playerId: pid,
        cardId,
        abilityId,
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} cast ${cardName} using ${abilityId}.`,
        ts: Date.now(),
      });
    } else if (abilityId === "unearth") {
      // Return to battlefield
      zones.graveyard.splice(cardIndex, 1);
      zones.graveyardCount = zones.graveyard.length;
      
      // Add to battlefield
      game.state.battlefield = game.state.battlefield || [];
      game.state.battlefield.push({
        id: generateId("perm"),
        controller: pid,
        owner: pid,
        tapped: false,
        counters: {},
        card: { ...card, zone: "battlefield", unearth: true },
      } as any);
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
        playerId: pid,
        cardId,
        abilityId,
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} unearthed ${cardName}.`,
        ts: Date.now(),
      });
    } else if (abilityId === "embalm" || abilityId === "eternalize") {
      // Create token copy (simplified - doesn't track token properties properly)
      // Exile original from graveyard
      zones.graveyard.splice(cardIndex, 1);
      zones.graveyardCount = zones.graveyard.length;
      
      // Move to exile
      zones.exile = zones.exile || [];
      zones.exile.push({ ...card, zone: "exile" });
      
      // Create token on battlefield
      const tokenName = abilityId === "eternalize" ? `${cardName} (4/4 Zombie)` : `${cardName} (Zombie)`;
      game.state.battlefield = game.state.battlefield || [];
      game.state.battlefield.push({
        id: generateId("token"),
        controller: pid,
        owner: pid,
        tapped: false,
        counters: {},
        isToken: true,
        card: { 
          ...card, 
          name: tokenName,
          zone: "battlefield", 
          type_line: card.type_line?.includes("Zombie") ? card.type_line : `Zombie ${card.type_line}`,
        },
        basePower: abilityId === "eternalize" ? 4 : undefined,
        baseToughness: abilityId === "eternalize" ? 4 : undefined,
      } as any);
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
        playerId: pid,
        cardId,
        abilityId,
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} created a token copy of ${cardName} using ${abilityId}.`,
        ts: Date.now(),
      });
    } else if (abilityId === "return-from-graveyard" || abilityId === "graveyard-activated" || (abilityId && abilityId.includes("-return-"))) {
      // Generic return from graveyard ability (like Magma Phoenix, Summon the School)
      // Parse the oracle text to determine the destination and mana cost
      const oracleText = (card.oracle_text || "").toLowerCase();
      
      // Parse mana cost from oracle text for graveyard abilities
      // Pattern: "{3}{R}{R}: Return this card from your graveyard to your hand"
      const graveyardAbilityMatch = oracleText.match(/(\{[^}]+\}(?:\{[^}]+\})*)\s*:\s*return\s+(?:this|~|(?:this card|it))\s+from\s+(?:your\s+)?graveyard\s+to\s+(?:your\s+)?hand/i);
      
      if (graveyardAbilityMatch) {
        const manaCost = graveyardAbilityMatch[1];
        const parsedCost = parseManaCost(manaCost);
        const pool = getOrInitManaPool(game.state, pid);
        const totalAvailable = calculateTotalAvailableMana(pool, []);
        
        // Validate mana payment
        const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
        if (validationError) {
          socket.emit("error", {
            code: "INSUFFICIENT_MANA",
            message: `Cannot pay ${manaCost}: ${validationError}`,
          });
          return;
        }
        
        // Consume mana
        consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, `[activateGraveyardAbility:${cardName}]`);
      }
      
      // Check for search library effects in the ability
      const tutorInfo = detectTutorEffect(card.oracle_text || "");
      
      if (tutorInfo.isTutor) {
        // This ability involves searching the library
        // Don't remove from graveyard yet - the search needs to resolve first
        
        if (typeof game.bumpSeq === "function") {
          game.bumpSeq();
        }
        
        appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
          playerId: pid,
          cardId,
          abilityId,
          isTutor: true,
        });
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} activated ${cardName}'s ability from graveyard.`,
          ts: Date.now(),
        });
        
        // Parse search criteria and send library search request
        const filter = parseSearchCriteria(tutorInfo.searchCriteria || "");
        const library = game.searchLibrary ? game.searchLibrary(pid, "", 1000) : [];
        
        // Handle split-destination effects (Kodama's Reach, Cultivate)
        if (tutorInfo.splitDestination) {
          socket.emit("librarySearchRequest", {
            gameId,
            cards: library,
            title: `${cardName}`,
            description: tutorInfo.searchCriteria ? `Search for: ${tutorInfo.searchCriteria}` : "Search your library",
            filter,
            maxSelections: tutorInfo.maxSelections || 2,
            moveTo: "split",
            splitDestination: true,
            toBattlefield: tutorInfo.toBattlefield || 1,
            toHand: tutorInfo.toHand || 1,
            entersTapped: tutorInfo.entersTapped,
            shuffleAfter: true,
          });
        } else {
          socket.emit("librarySearchRequest", {
            gameId,
            cards: library,
            title: `${cardName}`,
            description: tutorInfo.searchCriteria ? `Search for: ${tutorInfo.searchCriteria}` : "Search your library",
            filter,
            maxSelections: tutorInfo.maxSelections || 1,
            moveTo: tutorInfo.destination || "hand",
            shuffleAfter: true,
          });
        }
        
        broadcastGame(io, game, gameId);
        return;
      }
      
      // Check destination from oracle text
      let destination = "hand"; // default
      if (oracleText.includes("to the battlefield") || oracleText.includes("onto the battlefield")) {
        destination = "battlefield";
      } else if (oracleText.includes("to your hand") || oracleText.includes("into your hand")) {
        destination = "hand";
      }
      
      // Remove from graveyard
      zones.graveyard.splice(cardIndex, 1);
      zones.graveyardCount = zones.graveyard.length;
      
      if (destination === "battlefield") {
        // Move to battlefield
        game.state.battlefield = game.state.battlefield || [];
        game.state.battlefield.push({
          id: generateId("perm"),
          controller: pid,
          owner: pid,
          tapped: false,
          counters: {},
          card: { ...card, zone: "battlefield" },
        } as any);
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} returned ${cardName} from graveyard to the battlefield.`,
          ts: Date.now(),
        });
      } else {
        // Move to hand (default)
        zones.hand = zones.hand || [];
        zones.hand.push({ ...card, zone: "hand" });
        zones.handCount = zones.hand.length;
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} returned ${cardName} from graveyard to hand.`,
          ts: Date.now(),
        });
      }
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
        playerId: pid,
        cardId,
        abilityId,
        destination,
      });
    } else if (abilityId === "scavenge") {
      // Scavenge - exile from graveyard (player needs to manually target creature for counters)
      zones.graveyard.splice(cardIndex, 1);
      zones.graveyardCount = zones.graveyard.length;
      
      // Move to exile
      zones.exile = zones.exile || [];
      zones.exile.push({ ...card, zone: "exile" });
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
        playerId: pid,
        cardId,
        abilityId,
      });
      
      // Calculate P/T for +1/+1 counters
      const power = parseInt(card.power || "0", 10) || 0;
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} scavenged ${cardName}. Add ${power} +1/+1 counters to target creature.`,
        ts: Date.now(),
      });
    } else if (abilityId === "encore") {
      // Encore - exile from graveyard (creates tokens)
      zones.graveyard.splice(cardIndex, 1);
      zones.graveyardCount = zones.graveyard.length;
      
      // Move to exile
      zones.exile = zones.exile || [];
      zones.exile.push({ ...card, zone: "exile" });
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
        playerId: pid,
        cardId,
        abilityId,
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} used encore on ${cardName}. Create a token copy for each opponent.`,
        ts: Date.now(),
      });
    } else if (abilityId === "disturb") {
      // Disturb - cast transformed from graveyard
      zones.graveyard.splice(cardIndex, 1);
      zones.graveyardCount = zones.graveyard.length;
      
      // Add to stack (transformed)
      const stackItem = {
        id: generateId("stack"),
        controller: pid,
        card: { ...card, zone: "stack", castWithAbility: "disturb", transformed: true },
        targets: [],
      };
      
      game.state.stack = game.state.stack || [];
      game.state.stack.push(stackItem as any);
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
        playerId: pid,
        cardId,
        abilityId,
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} cast ${cardName} using disturb (transformed).`,
        ts: Date.now(),
      });
    } else {
      // Unknown or generic graveyard ability
      // Check for tutor/search effects in the oracle text
      const tutorInfo = detectTutorEffect(card.oracle_text || "");
      
      if (tutorInfo.isTutor) {
        // This ability involves searching the library
        if (typeof game.bumpSeq === "function") {
          game.bumpSeq();
        }
        
        appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
          playerId: pid,
          cardId,
          abilityId,
          isTutor: true,
        });
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} activated ${cardName}'s ability from graveyard.`,
          ts: Date.now(),
        });
        
        // Parse search criteria and send library search request
        const filter = parseSearchCriteria(tutorInfo.searchCriteria || "");
        const library = game.searchLibrary ? game.searchLibrary(pid, "", 1000) : [];
        
        // Handle split-destination effects (Kodama's Reach, Cultivate)
        if (tutorInfo.splitDestination) {
          socket.emit("librarySearchRequest", {
            gameId,
            cards: library,
            title: `${cardName}`,
            description: tutorInfo.searchCriteria ? `Search for: ${tutorInfo.searchCriteria}` : "Search your library",
            filter,
            maxSelections: tutorInfo.maxSelections || 2,
            moveTo: "split",
            splitDestination: true,
            toBattlefield: tutorInfo.toBattlefield || 1,
            toHand: tutorInfo.toHand || 1,
            entersTapped: tutorInfo.entersTapped,
            shuffleAfter: true,
          });
        } else {
          socket.emit("librarySearchRequest", {
            gameId,
            cards: library,
            title: `${cardName}`,
            description: tutorInfo.searchCriteria ? `Search for: ${tutorInfo.searchCriteria}` : "Search your library",
            filter,
            maxSelections: tutorInfo.maxSelections || 1,
            moveTo: tutorInfo.destination || "hand",
            shuffleAfter: true,
          });
        }
        
        broadcastGame(io, game, gameId);
        return;
      }
      
      // If no specific handler, log it and notify
      debug(2, `[activateGraveyardAbility] Unhandled ability ${abilityId} for ${cardName}`);
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} activated an ability on ${cardName} from graveyard.`,
        ts: Date.now(),
      });
    }
    
    broadcastGame(io, game, gameId);
  });

  // Get graveyard contents for viewing
  socket.on("requestGraveyardView", ({ gameId, targetPlayerId }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid) return;

    const game = ensureGame(gameId);
    const targetPid = targetPlayerId || pid;
    const zones = (game.state as any)?.zones?.[targetPid];
    
    if (!zones) {
      socket.emit("graveyardView", { gameId, playerId: targetPid, cards: [] });
      return;
    }
    
    const graveyard = Array.isArray(zones.graveyard) ? zones.graveyard : [];
    
    socket.emit("graveyardView", {
      gameId,
      playerId: targetPid,
      cards: graveyard,
    });
  });

  // Tap a permanent on the battlefield
  socket.on("tapPermanent", ({ gameId, permanentId }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const battlefield = getBattlefield(game);
    
    const permanent = battlefield.find((p: any) => p?.id === permanentId && p?.controller === pid);
    if (!permanent) {
      socket.emit("error", {
        code: "PERMANENT_NOT_FOUND",
        message: "Permanent not found or not controlled by you",
      });
      return;
    }
    
    if ((permanent as any).tapped) {
      socket.emit("error", {
        code: "ALREADY_TAPPED",
        message: "Permanent is already tapped",
      });
      return;
    }
    
    // Get card info early for summoning sickness check
    const card = (permanent as any).card;
    const cardName = card?.name || "Unknown";
    const typeLine = (card?.type_line || "").toLowerCase();
    const isCreature = /\bcreature\b/.test(typeLine);
    const isLand = typeLine.includes("land");
    
    // ========================================================================
    // Rule 302.6 / 702.10: Check summoning sickness for creatures with tap abilities
    // A creature can't use tap/untap abilities unless it has been continuously controlled
    // since the turn began OR it has haste (from any source).
    // Lands and non-creature permanents are NOT affected by summoning sickness.
    // ========================================================================
    if (isCreature && !isLand) {
      const hasHaste = creatureHasHaste(permanent, battlefield, pid);
      
      // summoningSickness is set when creatures enter the battlefield
      // If a creature has summoning sickness and doesn't have haste, it can't use tap abilities
      if ((permanent as any).summoningSickness && !hasHaste) {
        socket.emit("error", {
          code: "SUMMONING_SICKNESS",
          message: `${cardName} has summoning sickness and cannot use tap abilities this turn`,
        });
        return;
      }
    }
    
    // Set tapped on the permanent
    (permanent as any).tapped = true;
    
    // Also ensure it's set in the main battlefield array (defensive programming)
    const battlefieldIndex = battlefield.findIndex((p: any) => p?.id === permanentId);
    if (battlefieldIndex >= 0) {
      battlefield[battlefieldIndex].tapped = true;
    }
    
    debug(2, `[tapPermanent] Tapped ${cardName} (${permanentId}). Tapped state: ${!!permanent.tapped}`);
    
    // Check if this permanent has mana abilities (intrinsic or granted by effects like Cryptolith Rite)
    // If so, add the produced mana to the player's mana pool
    const isBasic = typeLine.includes("basic");
    
    // ========================================================================
    // Check for devotion-based or creature-count-based mana abilities FIRST
    // These are special scaling mana abilities (Karametra's Acolyte, Priest of Titania, etc.)
    // ========================================================================
    let devotionMana = getDevotionManaAmount(game.state, permanent, pid);
    let creatureCountMana = getCreatureCountManaAmount(game.state, permanent, pid);
    
    // Debug logging for devotion mana
    if (cardName.toLowerCase().includes('karametra') || cardName.toLowerCase().includes('acolyte')) {
      debug(2, `[tapPermanent] ${cardName} devotion check:`, {
        devotionMana,
        creatureCountMana,
        hasDevotionMana: !!devotionMana,
        devotionAmount: devotionMana?.amount,
        permanentController: pid,
        cardName: cardName,
      });
    }
    
    // Get mana abilities for this permanent (includes granted abilities from Cryptolith Rite, etc.)
    const manaAbilities = getManaAbilitiesForPermanent(game.state, permanent, pid);
    
    // ========================================================================
    // Calculate mana multiplier from effects like Mana Reflection, Nyxbloom Ancient
    // ========================================================================
    const manaMultiplier = getManaMultiplier(game.state, permanent, pid);
    
    // Check for Virtue of Strength (only affects basic lands)
    let effectiveMultiplier = manaMultiplier;
    if (manaMultiplier > 1 && !isBasic) {
      // Check if Virtue of Strength is the source of the multiplier
      const modifiers = detectManaModifiers(game.state, pid);
      const virtueModifier = modifiers.find(m => 
        m.cardName.toLowerCase().includes('virtue of strength') && 
        m.type === 'mana_multiplier'
      );
      if (virtueModifier) {
        // Virtue only affects basic lands - recalculate without it
        const otherMultiplier = modifiers
          .filter(m => m.type === 'mana_multiplier' && m.cardName !== virtueModifier.cardName)
          .reduce((acc, m) => acc * (m.multiplier || 1), 1);
        effectiveMultiplier = isBasic ? manaMultiplier : otherMultiplier;
      }
    }
    
    if (manaAbilities.length > 0 || devotionMana || creatureCountMana) {
      // Permanent has mana abilities - add mana to the pool
      // Initialize mana pool if needed
      game.state.manaPool = game.state.manaPool || {};
      game.state.manaPool[pid] = game.state.manaPool[pid] || {
        white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
      };
      
      // Map mana color codes to pool keys
      const colorToPoolKey: Record<string, string> = {
        'W': 'white',
        'U': 'blue',
        'B': 'black',
        'R': 'red',
        'G': 'green',
        'C': 'colorless',
      };
      
      // ========================================================================
      // Handle devotion-based mana abilities (Karametra's Acolyte, etc.)
      // ========================================================================
      if (devotionMana && devotionMana.amount > 0) {
        const baseAmount = devotionMana.amount;
        const totalAmount = baseAmount * effectiveMultiplier;
        const poolKey = colorToPoolKey[devotionMana.color] || 'green';
        (game.state.manaPool[pid] as any)[poolKey] += totalAmount;
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: effectiveMultiplier > 1 
            ? `${getPlayerName(game, pid)} tapped ${cardName} for ${totalAmount} {${devotionMana.color}} mana (devotion ${baseAmount} × ${effectiveMultiplier}).`
            : `${getPlayerName(game, pid)} tapped ${cardName} for ${totalAmount} {${devotionMana.color}} mana (devotion: ${baseAmount}).`,
          ts: Date.now(),
        });
        
        broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`, game);
      }
      // ========================================================================
      // Handle creature-count-based mana abilities (Priest of Titania, Elvish Archdruid, etc.)
      // ========================================================================
      else if (creatureCountMana && creatureCountMana.amount > 0) {
        const baseAmount = creatureCountMana.amount;
        const totalAmount = baseAmount * effectiveMultiplier;
        
        // Handle special 'any_combination' color (like Selvala)
        if (creatureCountMana.color === 'any_combination' || creatureCountMana.color.startsWith('combination:')) {
          // Store pending mana activation for when player selects color
          if (!game.state.pendingManaActivations) {
            game.state.pendingManaActivations = {};
          }
          const activationId = `mana_${crypto.randomUUID()}`;
          game.state.pendingManaActivations[activationId] = {
            playerId: pid,
            permanentId,
            cardName,
            amount: totalAmount,
            allowedColors: ['W', 'U', 'B', 'R', 'G'], // Any color combination
          };
          
          // Request color choice from player
          socket.emit("anyColorManaChoice", {
            gameId,
            activationId,
            permanentId,
            cardName,
            amount: totalAmount,
            allowedColors: ['W', 'U', 'B', 'R', 'G'], // Any color
            cardImageUrl: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
          });
          
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `${getPlayerName(game, pid)} tapped ${cardName} for ${totalAmount} mana (choose colors).`,
            ts: Date.now(),
          });
          
          broadcastGame(io, game, gameId);
          return; // Exit early - wait for color choice
        } else {
          const poolKey = colorToPoolKey[creatureCountMana.color] || 'green';
          (game.state.manaPool[pid] as any)[poolKey] += totalAmount;
          
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: effectiveMultiplier > 1 
              ? `${getPlayerName(game, pid)} tapped ${cardName} for ${totalAmount} {${creatureCountMana.color}} mana (count ${baseAmount} × ${effectiveMultiplier}).`
              : `${getPlayerName(game, pid)} tapped ${cardName} for ${totalAmount} {${creatureCountMana.color}} mana.`,
            ts: Date.now(),
          });
          
          broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`, game);
        }
      }
      // ========================================================================
      // Handle standard mana abilities (lands, mana dorks, rocks)
      // ========================================================================
      else if (manaAbilities.length > 0) {
        // ========================================================================
        // Select which ability to use:
        // If there are multiple abilities, prefer colored mana over colorless
        // This handles pain lands like Adarkar Wastes where you have {C} and {W}/{U}
        // ========================================================================
        let ability = manaAbilities[0];
        
        if (manaAbilities.length > 1) {
          // Prefer non-colorless abilities
          const coloredAbility = manaAbilities.find(a => 
            a.produces.length > 0 && !a.produces.every(c => c === 'C')
          );
          if (coloredAbility) {
            ability = coloredAbility;
          }
        }
        
        const produces = ability.produces || [];
        
        if (produces.length > 0) {
          // ========================================================================
          // Handle additional costs (pay life, etc.) for this ability
          // ========================================================================
          if (ability.additionalCosts && ability.additionalCosts.length > 0) {
            for (const cost of ability.additionalCosts) {
              if (cost.type === 'pay_life' && cost.amount) {
                // Check if player has enough life
                const currentLife = game.state.life?.[pid] || 40;
                if (currentLife <= cost.amount) {
                  socket.emit("error", {
                    code: "INSUFFICIENT_LIFE",
                    message: `Cannot pay ${cost.amount} life (you have ${currentLife} life)`,
                  });
                  return;
                }
                
                // Pay the life cost
                if (!game.state.life) game.state.life = {};
                game.state.life[pid] = currentLife - cost.amount;
                
                io.to(gameId).emit("chat", {
                  id: `m_${Date.now()}`,
                  gameId,
                  from: "system",
                  message: `${getPlayerName(game, pid)} paid ${cost.amount} life (${currentLife} → ${game.state.life[pid]}).`,
                  ts: Date.now(),
                });
              }
            }
          }
          
          // ========================================================================
          // Handle damage effects (pain lands like Adarkar Wastes)
          // ========================================================================
          if (ability.damageEffect && ability.damageEffect.type === 'damage_self') {
            const damageAmount = ability.damageEffect.amount;
            const currentLife = game.state.life?.[pid] || 40;
            
            if (!game.state.life) game.state.life = {};
            game.state.life[pid] = currentLife - damageAmount;
            
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `${cardName} deals ${damageAmount} damage to ${getPlayerName(game, pid)} (${currentLife} → ${game.state.life[pid]}).`,
              ts: Date.now(),
            });
          }
          
          // ========================================================================
          // Check if this ability produces ALL colors at once (like bounce lands)
          // If producesAllAtOnce is true, add all mana at once without prompting
          // ========================================================================
          if (ability.producesAllAtOnce && produces.length > 1) {
            // Multi-mana producer like Rakdos Carnarium - add ALL colors at once
            const manaAdded: string[] = [];
            
            for (const manaColor of produces) {
              const poolKey = colorToPoolKey[manaColor] || 'colorless';
              (game.state.manaPool[pid] as any)[poolKey] += effectiveMultiplier;
              manaAdded.push(`{${manaColor}}`);
            }
            
            const manaStr = manaAdded.join('');
            let message = `${getPlayerName(game, pid)} tapped ${cardName} for ${manaStr}`;
            if (effectiveMultiplier > 1) {
              message += ` (×${effectiveMultiplier})`;
            }
            message += '.';
            
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message,
              ts: Date.now(),
            });
            
            // Broadcast mana pool update
            broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`, game);
          }
          // If produces multiple colors but NOT all at once (like "any color"), prompt user for choice
          else if (produces.length > 1) {
            // Calculate total mana for the prompt
            const baseAmount = 1;
            const totalAmount = baseAmount * effectiveMultiplier;
            
            // Get extra mana from effects like Caged Sun, Nissa, Crypt Ghast
            const extraMana = getExtraManaProduction(game.state, permanent, pid, produces[0]);
            const totalExtra = extraMana.reduce((acc, e) => acc + e.amount, 0);
            const finalTotal = totalAmount + totalExtra;
            
            // Store pending mana activation for when player selects color
            if (!game.state.pendingManaActivations) {
              game.state.pendingManaActivations = {};
            }
            const activationId = `mana_${crypto.randomUUID()}`;
            game.state.pendingManaActivations[activationId] = {
              playerId: pid,
              permanentId,
              cardName,
              amount: finalTotal,
              allowedColors: produces, // Restrict to actual colors the land can produce
            };
            
            // Request color choice from player
            socket.emit("anyColorManaChoice", {
              gameId,
              activationId,
              permanentId,
              cardName,
              amount: finalTotal,
              allowedColors: produces, // Restrict to actual colors the land can produce
              cardImageUrl: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
            });
            
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `${getPlayerName(game, pid)} tapped ${cardName} for mana (choose color).`,
              ts: Date.now(),
            });
            
            broadcastGame(io, game, gameId);
            return; // Exit early - wait for color choice
          } else {
            // Single color production
            const manaColor = produces[0];
            const poolKey = colorToPoolKey[manaColor] || 'colorless';
            
            // Calculate base amount with multiplier
            const baseAmount = 1;
            let totalAmount = baseAmount * effectiveMultiplier;
            
            // ========================================================================
            // Apply extra mana from effects like:
            // - Caged Sun: +1 mana of chosen color when tapping lands for that color
            // - Nissa, Who Shakes the World: Forests produce +1 green
            // - Crypt Ghast: Swamps produce +1 black
            // - Zendikar Resurgent: Lands produce +1 of same color
            // - Mana Flare: Lands produce +1 of same color (all players)
            // ========================================================================
            const extraMana = getExtraManaProduction(game.state, permanent, pid, manaColor);
            for (const extra of extraMana) {
              const extraPoolKey = colorToPoolKey[extra.color] || poolKey;
              (game.state.manaPool[pid] as any)[extraPoolKey] += extra.amount;
              totalAmount += extra.amount;
            }
            
            // Add the base mana (after multiplier)
            (game.state.manaPool[pid] as any)[poolKey] += baseAmount * effectiveMultiplier;
            
            // Generate descriptive message
            let message = `${getPlayerName(game, pid)} tapped ${cardName}`;
            if (effectiveMultiplier > 1 && extraMana.length > 0) {
              message += ` for ${totalAmount} {${manaColor}} mana (×${effectiveMultiplier} + ${extraMana.length} extra).`;
            } else if (effectiveMultiplier > 1) {
              message += ` for ${totalAmount} {${manaColor}} mana (×${effectiveMultiplier}).`;
            } else if (extraMana.length > 0) {
              message += ` for ${totalAmount} {${manaColor}} mana (+${extraMana.reduce((a, e) => a + e.amount, 0)} extra).`;
            } else {
              message += ` for {${manaColor}} mana.`;
            }
            
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message,
              ts: Date.now(),
            });
            
            // Broadcast mana pool update
            broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`, game);
          }
        }
      }
    }
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "tapPermanent", { playerId: pid, permanentId });
    
    broadcastGame(io, game, gameId);
  });

  // Untap a permanent on the battlefield
  socket.on("untapPermanent", ({ gameId, permanentId }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const battlefield = getBattlefield(game);
    
    const permanent = battlefield.find((p: any) => p?.id === permanentId && p?.controller === pid);
    if (!permanent) {
      socket.emit("error", {
        code: "PERMANENT_NOT_FOUND",
        message: "Permanent not found or not controlled by you",
      });
      return;
    }
    
    if (!(permanent as any).tapped) {
      socket.emit("error", {
        code: "NOT_TAPPED",
        message: "Permanent is not tapped",
      });
      return;
    }
    
    (permanent as any).tapped = false;
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "untapPermanent", { playerId: pid, permanentId });
    
    broadcastGame(io, game, gameId);
  });

  // Exchange oracle text boxes between two permanents (text-changing effects)
  socket.on("exchangeTextBoxes", ({ gameId, sourcePermanentId, targetPermanentId }: {
    gameId: string;
    sourcePermanentId: string;
    targetPermanentId: string;
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const battlefield = game.state?.battlefield || [];

    const source = battlefield.find((p: any) => p?.id === sourcePermanentId);
    const target = battlefield.find((p: any) => p?.id === targetPermanentId);

    if (!source || !target) {
      socket.emit("error", { code: "PERMANENT_NOT_FOUND", message: "One or both permanents not found" });
      return;
    }

    if (source.controller !== pid) {
      socket.emit("error", { code: "NOT_CONTROLLER", message: "You must control the source permanent to exchange text boxes" });
      return;
    }

    const exchanged = exchangePermanentOracleText(battlefield, sourcePermanentId, targetPermanentId);
    if (!exchanged) {
      socket.emit("error", { code: "EXCHANGE_FAILED", message: "Could not exchange oracle text between permanents" });
      return;
    }

    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }

    appendEvent(gameId, (game as any).seq ?? 0, "exchangeTextBoxes", {
      playerId: pid,
      sourcePermanentId,
      targetPermanentId,
    });

    const sourceName = source?.card?.name || "Unknown";
    const targetName = target?.card?.name || "Unknown";
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} exchanged text boxes of ${sourceName} and ${targetName}.`,
      ts: Date.now(),
    });

    broadcastGame(io, game, gameId);
  });

  // Sacrifice a permanent on the battlefield
  socket.on("sacrificePermanent", ({ gameId, permanentId }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const battlefield = game.state?.battlefield || [];
    
    const permIndex = battlefield.findIndex((p: any) => p?.id === permanentId && p?.controller === pid);
    if (permIndex === -1) {
      socket.emit("error", {
        code: "PERMANENT_NOT_FOUND",
        message: "Permanent not found or not controlled by you",
      });
      return;
    }
    
    const permanent = battlefield[permIndex];
    const card = (permanent as any).card;
    const cardName = card?.name || "Unknown";
    const oracleText = (card?.oracle_text || "").toLowerCase();
    const typeLine = (card?.type_line || "").toLowerCase();
    const isCreature = typeLine.includes("creature");
    const isLand = typeLine.includes("land");
    
    // Check if this is a fetch land or similar with search effect
    // IMPORTANT: Only lands that specifically search for land cards should trigger library search
    // Creatures like Magda, Brazen Outlaw search for artifacts/dragons, not lands
    const searchesForLand = oracleText.includes("land card") || 
      oracleText.match(/search[^.]*for[^.]*(?:forest|plains|island|swamp|mountain)/) !== null;
    const isFetchLand = isLand && !isCreature && 
      oracleText.includes("sacrifice") && 
      oracleText.includes("search your library") &&
      searchesForLand;
    
    // Cleanup equipment attachments if this is equipment leaving battlefield
    const isEquipment = typeLine.includes("equipment");
    if (isEquipment && permanent.attachedTo) {
      const attachedCreature = battlefield.find((p: any) => p?.id === permanent.attachedTo);
      if (attachedCreature && attachedCreature.attachedEquipment) {
        attachedCreature.attachedEquipment = (attachedCreature.attachedEquipment as string[]).filter(
          (id: string) => id !== permanentId
        );
        // Remove equipped badge if no equipment remains
        if (attachedCreature.attachedEquipment.length === 0) {
          attachedCreature.isEquipped = false;
        }
      }
    }
    
    // Cleanup attached equipment if this is a creature leaving battlefield
    if (isCreature && permanent.attachedEquipment && permanent.attachedEquipment.length > 0) {
      for (const equipId of permanent.attachedEquipment as string[]) {
        const equipment = battlefield.find((p: any) => p?.id === equipId);
        if (equipment) {
          equipment.attachedTo = undefined;
        }
      }
    }
    
    // Remove from battlefield
    battlefield.splice(permIndex, 1);
    
    // Move to graveyard
    const zones = (game.state as any)?.zones?.[pid];
    if (zones) {
      zones.graveyard = zones.graveyard || [];
      zones.graveyard.push({ ...card, zone: "graveyard" });
      zones.graveyardCount = zones.graveyard.length;
    }
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "sacrificePermanent", { playerId: pid, permanentId });
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} sacrificed ${cardName}.`,
      ts: Date.now(),
    });
    
    // Check for death triggers (Grave Pact, Blood Artist, etc.) if this was a creature
    if (isCreature) {
      try {
        const deathTriggers = getDeathTriggers(game as any, permanent, pid);
        
        for (const trigger of deathTriggers) {
          // Emit a chat message about the trigger
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}_${trigger.source.permanentId}`,
            gameId,
            from: "system",
            message: `⚡ ${trigger.source.cardName} triggers: ${trigger.effect}`,
            ts: Date.now(),
          });
          
          // If this trigger requires sacrifice selection (Grave Pact, Dictate of Erebos, etc.)
          if (trigger.requiresSacrificeSelection) {
            const playersToSacrifice = getPlayersWhoMustSacrifice(game as any, trigger.source.controllerId);
            
            for (const targetPlayerId of playersToSacrifice) {
              // Get creatures controlled by this player
              const creatures = battlefield.filter((p: any) => 
                p?.controller === targetPlayerId && 
                (p?.card?.type_line || "").toLowerCase().includes("creature")
              );
              
              if (creatures.length > 0) {
                // Emit sacrifice selection request to the player
                emitToPlayer(io, targetPlayerId, "sacrificeSelectionRequest", {
                  gameId,
                  triggerId: `sac_${Date.now()}_${trigger.source.permanentId}`,
                  sourceName: trigger.source.cardName,
                  sourceController: trigger.source.controllerId,
                  reason: trigger.effect,
                  creatures: creatures.map((c: any) => ({
                    id: c.id,
                    name: c.card?.name || "Unknown",
                    imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
                    typeLine: c.card?.type_line,
                  })),
                });
                
                io.to(gameId).emit("chat", {
                  id: `m_${Date.now()}_sac_${targetPlayerId}`,
                  gameId,
                  from: "system",
                  message: `${getPlayerName(game, targetPlayerId)} must sacrifice a creature.`,
                  ts: Date.now(),
                });
              } else {
                io.to(gameId).emit("chat", {
                  id: `m_${Date.now()}_nosac_${targetPlayerId}`,
                  gameId,
                  from: "system",
                  message: `${getPlayerName(game, targetPlayerId)} has no creatures to sacrifice.`,
                  ts: Date.now(),
                });
              }
            }
          }
        }
      } catch (err) {
        debugWarn(1, "[sacrificePermanent] Error processing death triggers:", err);
      }
    }
    
    // If this was a fetch land, trigger library search
    if (isFetchLand) {
      // Check if it's a true fetch (pay 1 life) - note life was not paid since this is manual sacrifice
      const isTrueFetch = oracleText.includes("pay 1 life");
      
      if (isTrueFetch) {
        // Notify that the player should have paid life
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `Note: ${cardName} requires paying 1 life to search (use Fetch Land ability for automatic life payment).`,
          ts: Date.now(),
        });
      }
      
      // Parse what land types this fetch can find
      const filter = parseSearchCriteria(oracleText);
      
      // Build description for the search prompt
      let searchDescription = "Search your library for a land card";
      if (filter.subtypes && filter.subtypes.length > 0) {
        const landTypes = filter.subtypes.filter(s => !s.includes("basic")).map(s => s.charAt(0).toUpperCase() + s.slice(1));
        if (landTypes.length > 0) {
          searchDescription = `Search for a ${landTypes.join(" or ")} card`;
        }
        if (filter.subtypes.includes("basic")) {
          searchDescription = `Search for a basic ${landTypes.join(" or ")} card`;
        }
      }
      
      // Get full library for search
      const library = game.searchLibrary ? game.searchLibrary(pid, "", 1000) : [];
      
      // Send library search request to the player
      socket.emit("librarySearchRequest", {
        gameId,
        cards: library,
        title: `${cardName}`,
        description: searchDescription,
        filter,
        maxSelections: 1,
        moveTo: "battlefield",
        shuffleAfter: true,
      });
    }
    
    broadcastGame(io, game, gameId);
  });

  // Activate a battlefield ability (fetch lands, mana abilities, etc.)
  socket.on("activateBattlefieldAbility", async ({ gameId, permanentId, abilityId }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    // Validate abilityId is provided
    if (!abilityId || typeof abilityId !== 'string') {
      socket.emit("error", {
        code: "INVALID_ABILITY",
        message: "Ability ID is required",
      });
      return;
    }

    const game = ensureGame(gameId);
    const battlefield = game.state?.battlefield || [];
    
    const permIndex = battlefield.findIndex((p: any) => p?.id === permanentId && p?.controller === pid);
    if (permIndex === -1) {
      socket.emit("error", {
        code: "PERMANENT_NOT_FOUND",
        message: "Permanent not found or not controlled by you",
      });
      return;
    }
    
    const permanent = battlefield[permIndex];
    const card = (permanent as any).card;
    const cardName = card?.name || "Unknown";
    const oracleText = (card?.oracle_text || "").toLowerCase();
    const typeLine = (card?.type_line || "").toLowerCase();
    
    // ========================================================================
    // Handle Special Land Activated Abilities
    // ========================================================================
    const specialLandConfig = SPECIAL_LAND_ABILITIES[cardName.toLowerCase()];
    
    // 1. GRAVEN CAIRNS - Hybrid Mana Production Lands
    if (specialLandConfig?.type === 'hybrid_mana_production' && abilityId.includes('hybrid-mana')) {
      // Validate: permanent must not be tapped
      if ((permanent as any).tapped) {
        socket.emit("error", {
          code: "ALREADY_TAPPED",
          message: `${cardName} is already tapped`,
        });
        return;
      }
      
      // Parse and pay hybrid mana cost
      const hybridCost = specialLandConfig.cost!;
      const parsedCost = parseManaCost(hybridCost);
      const manaPool = getOrInitManaPool(game.state, pid);
      
      // Check if player can pay the hybrid cost
      const totalAvailable = calculateTotalAvailableMana(manaPool, undefined);
      
      // For hybrid costs, we need special validation
      let canPay = true;
      if (parsedCost.hybrids && parsedCost.hybrids.length > 0) {
        // For each hybrid requirement, check if we can pay with one of the options
        for (const hybridOptions of parsedCost.hybrids) {
          let paidThisHybrid = false;
          for (const option of hybridOptions) {
            const colorMap: Record<string, string> = {
              'W': 'white', 'U': 'blue', 'B': 'black', 'R': 'red', 'G': 'green'
            };
            const colorName = colorMap[option];
            if (colorName && totalAvailable[colorName] >= 1) {
              paidThisHybrid = true;
              break;
            }
          }
          if (!paidThisHybrid) {
            canPay = false;
            break;
          }
        }
      }
      
      if (!canPay) {
        socket.emit("error", {
          code: "INSUFFICIENT_MANA",
          message: "Not enough mana to activate this ability",
        });
        return;
      }
      
      // Consume the mana from the pool (hybrid mana)
      if (parsedCost.hybrids && parsedCost.hybrids.length > 0) {
        for (const hybridOptions of parsedCost.hybrids) {
          // Pay with the first available option
          const colorMap: Record<string, string> = {
            'W': 'white', 'U': 'blue', 'B': 'black', 'R': 'red', 'G': 'green'
          };
          for (const option of hybridOptions) {
            const colorName = colorMap[option];
            if (colorName && (manaPool as any)[colorName] >= 1) {
              (manaPool as any)[colorName] -= 1;
              break;
            }
          }
        }
      }
      
      // Tap the permanent (part of cost)
      (permanent as any).tapped = true;
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} activated ${cardName}, paying ${hybridCost} and tapping it.`,
        ts: Date.now(),
      });
      
      // Now prompt player to choose how to distribute the mana
      const activationId = crypto.randomUUID();
      game.state.pendingManaActivations = game.state.pendingManaActivations || {};
      (game.state.pendingManaActivations as any)[activationId] = {
        playerId: pid,
        permanentId,
        cardName,
        totalAmount: specialLandConfig.totalMana!,
        availableColors: specialLandConfig.colors!,
        timestamp: Date.now(),
      };
      
      // Emit modal request to client
      emitToPlayer(io, pid, "manaColorChoice", {
        gameId,
        permanentId,
        cardName,
        availableColors: specialLandConfig.colors!,
        totalAmount: specialLandConfig.totalMana!,
        message: `Choose how to distribute ${specialLandConfig.totalMana} mana from ${cardName}.`,
      });
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      broadcastGame(io, game, gameId);
      return;
    }
    
    // 2. CALCIFORM POOLS - Storage Counter Lands
    if (specialLandConfig?.type === 'storage_counter') {
      // Handle storage counter abilities
      if (abilityId.includes('add-counter')) {
        // {1}, {T}: Put a storage counter on ~
        // Validate: permanent must not be tapped
        if ((permanent as any).tapped) {
          socket.emit("error", {
            code: "ALREADY_TAPPED",
            message: `${cardName} is already tapped`,
          });
          return;
        }
        
        // Pay {1} cost
        const manaPool = getOrInitManaPool(game.state, pid);
        const totalAvailable = calculateTotalAvailableMana(manaPool, undefined);
        const totalMana = Object.values(totalAvailable).reduce((sum, val) => sum + val, 0);
        if (totalMana < 1) {
          socket.emit("error", {
            code: "INSUFFICIENT_MANA",
            message: "Not enough mana to activate this ability",
          });
          return;
        }
        
        // Consume 1 generic mana
        consumeManaFromPool(manaPool, {}, 1);
        
        // Tap the permanent
        (permanent as any).tapped = true;
        
        // Add storage counter
        (permanent as any).counters = (permanent as any).counters || {};
        (permanent as any).counters[specialLandConfig.counterType!] = 
          ((permanent as any).counters[specialLandConfig.counterType!] || 0) + 1;
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} put a ${specialLandConfig.counterType} counter on ${cardName}.`,
          ts: Date.now(),
        });
        
        if (typeof game.bumpSeq === "function") {
          game.bumpSeq();
        }
        broadcastGame(io, game, gameId);
        return;
      } else if (abilityId.includes('remove-counters')) {
        // {T}, Remove X storage counters from ~: Add X mana in any combination of colors
        // This requires X selection UI - for now, we'll implement basic version
        // Future: Add X-cost selection modal
        
        // Validate: permanent must not be tapped
        if ((permanent as any).tapped) {
          socket.emit("error", {
            code: "ALREADY_TAPPED",
            message: `${cardName} is already tapped`,
          });
          return;
        }
        
        const storageCounters = (permanent as any).counters?.[specialLandConfig.counterType!] || 0;
        if (storageCounters === 0) {
          socket.emit("error", {
            code: "NO_COUNTERS",
            message: `${cardName} has no ${specialLandConfig.counterType} counters`,
          });
          return;
        }
        
        // For now, prompt with mana distribution modal for all available counters
        // Future: Add X selection first
        const activationId = crypto.randomUUID();
        game.state.pendingManaActivations = game.state.pendingManaActivations || {};
        (game.state.pendingManaActivations as any)[activationId] = {
          playerId: pid,
          permanentId,
          cardName,
          totalAmount: storageCounters,
          availableColors: specialLandConfig.colors!,
          timestamp: Date.now(),
          isStorageCounter: true,
        };
        
        // Tap the permanent first
        (permanent as any).tapped = true;
        
        // Emit modal request to client
        emitToPlayer(io, pid, "manaColorChoice", {
          gameId,
          permanentId,
          cardName,
          availableColors: specialLandConfig.colors!,
          totalAmount: storageCounters,
          message: `Remove ${storageCounters} ${specialLandConfig.counterType} counter${storageCounters !== 1 ? 's' : ''} to add ${storageCounters} mana.`,
        });
        
        if (typeof game.bumpSeq === "function") {
          game.bumpSeq();
        }
        broadcastGame(io, game, gameId);
        return;
      }
    }
    
    // 3. MUTAVAULT - Land Animation
    if (specialLandConfig?.type === 'animate' && abilityId.includes('animate')) {
      // {1}: ~ becomes a 2/2 creature with all creature types until end of turn
      // Validate: permanent must not be tapped for activation
      
      // Pay {1} cost
      const manaPool = getOrInitManaPool(game.state, pid);
      const totalAvailable = calculateTotalAvailableMana(manaPool, undefined);
      const totalMana = Object.values(totalAvailable).reduce((sum, val) => sum + val, 0);
      if (totalMana < 1) {
        socket.emit("error", {
          code: "INSUFFICIENT_MANA",
          message: "Not enough mana to activate this ability",
        });
        return;
      }
      
      // Consume 1 generic mana
      consumeManaFromPool(manaPool, {}, 1);
      
      // Apply animation until end of turn
      (permanent as any).animatedUntilEOT = true;
      (permanent as any).basePower = specialLandConfig.power;
      (permanent as any).baseToughness = specialLandConfig.toughness;
      (permanent as any).effectivePower = specialLandConfig.power;
      (permanent as any).effectiveToughness = specialLandConfig.toughness;
      
      // Add creature type
      const currentTypes = (permanent as any).card?.type_line || "";
      if (!currentTypes.includes("Creature")) {
        (permanent as any).typeAdditions = (permanent as any).typeAdditions || [];
        (permanent as any).typeAdditions.push("Creature");
      }
      
      // Track "all creature types" - special handling needed in creature type checks
      if (specialLandConfig.creatureTypes?.includes('all')) {
        (permanent as any).hasAllCreatureTypes = true;
      } else if (specialLandConfig.creatureTypes) {
        (permanent as any).typeAdditions = (permanent as any).typeAdditions || [];
        specialLandConfig.creatureTypes.forEach(type => {
          if (!(permanent as any).typeAdditions.includes(type)) {
            (permanent as any).typeAdditions.push(type);
          }
        });
      }
      
      // Mark for end-of-turn cleanup
      (permanent as any).untilEndOfTurn = {
        removeAnimation: true,
        turn: (game.state as any).turnNumber || game.state.turn,
      };
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} animated ${cardName} into a ${specialLandConfig.power}/${specialLandConfig.toughness} creature until end of turn.`,
        ts: Date.now(),
      });
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      broadcastGame(io, game, gameId);
      return;
    }
    
    // 4. HIDEAWAY - Face-down Exile Implementation
    // Hideaway is handled during ETB (Enter the Battlefield), not as activated ability
    // The activated ability is just playing the exiled card
    if (specialLandConfig?.type === 'hideaway' && abilityId.includes('play-hideaway')) {
      // Check if there's a face-down exiled card for this permanent
      const hideawayData = (permanent as any).hideawayCard;
      if (!hideawayData) {
        socket.emit("error", {
          code: "NO_HIDEAWAY_CARD",
          message: `${cardName} has no exiled card to play`,
        });
        return;
      }
      
      // Check hideaway condition (this varies by card)
      // For Windbrisk Heights: "you attacked with three or more creatures this turn"
      // For now, we'll implement a basic version
      // Future: Add condition checking based on card
      
      const canPlayHideaway = true; // TODO: Implement condition checks
      
      if (!canPlayHideaway) {
        socket.emit("error", {
          code: "HIDEAWAY_CONDITION_NOT_MET",
          message: `You haven't met the condition to play ${cardName}'s exiled card`,
        });
        return;
      }
      
      // Move the hideaway card to hand or cast it
      // For now, move to hand
      const zones = (game.state as any).zones?.[pid];
      if (zones) {
        zones.hand = zones.hand || [];
        zones.hand.push({ ...hideawayData.card, zone: 'hand' });
        zones.handCount = zones.hand.length;
      }
      
      // Clear hideaway data
      delete (permanent as any).hideawayCard;
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} played ${hideawayData.card.name} from ${cardName}.`,
        ts: Date.now(),
      });
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle fetch land ability
    // Support both legacy "fetch-land" format and new parser format like "${cardId}-fetch-${index}"
    // Also validate that this is actually a land that fetches (not a spell, creature, or artifact)
    // IMPORTANT: Creatures like Magda, Brazen Outlaw have "sacrifice...search your library" text
    // but are NOT fetch lands - they search for non-land cards (artifacts, dragons, etc.)
    const isLand = typeLine.includes("land");
    const isCreature = typeLine.includes("creature");
    const isArtifact = typeLine.includes("artifact") && !typeLine.includes("land");
    
    // A true fetch land pattern requires:
    // 1. It's a land (not creature, not non-land artifact)
    // 2. Has sacrifice + search your library
    // 3. Specifically searches for LAND cards (not artifacts, dragons, etc.)
    const hasFetchPattern = oracleText.includes("sacrifice") && 
      oracleText.includes("search your library") && 
      (oracleText.includes("land card") || 
       // Check for basic land type searching like "search...for a forest or plains"
       (oracleText.match(/search[^.]*for[^.]*(?:forest|plains|island|swamp|mountain)/) !== null));
    
    // Exclude creatures and non-land artifacts from fetch land detection
    const isFetchLandAbility = (abilityId === "fetch-land" || abilityId.includes("-fetch-")) && 
      isLand && !isCreature && !isArtifact && hasFetchPattern;
    if (isFetchLandAbility) {
      // Validate: permanent must not be tapped
      if ((permanent as any).tapped) {
        socket.emit("error", {
          code: "ALREADY_TAPPED",
          message: `${cardName} is already tapped`,
        });
        return;
      }
      
      // Parse and validate mana cost from oracle text
      // Examples: "{2}, {T}, Sacrifice ~" (Myriad Landscape), "{3}{G}, {T}, Sacrifice ~" (Blighted Woodland)
      const manaCostMatch = oracleText.match(/\{[^}]+\}(?:\s*,\s*\{[^}]+\})*(?=\s*,\s*\{t\})/i);
      if (manaCostMatch) {
        const manaCostStr = manaCostMatch[0];
        const parsedCost = parseManaCost(manaCostStr);
        const manaPool = getOrInitManaPool(game.state, pid);
        
        // Check if player can pay the mana cost
        const totalAvailable = calculateTotalAvailableMana(manaPool, undefined);
        const validationError = validateManaPayment(
          totalAvailable,
          parsedCost.colors,
          parsedCost.generic
        );
        
        if (validationError) {
          socket.emit("error", {
            code: "INSUFFICIENT_MANA",
            message: validationError,
          });
          return;
        }
        
        // Consume the mana from the pool
        consumeManaFromPool(manaPool, parsedCost.colors, parsedCost.generic);
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} paid ${manaCostStr}.`,
          ts: Date.now(),
        });
      }
      
      // Check if it's a true fetch (pay 1 life)
      const isTrueFetch = oracleText.includes("pay 1 life");
      
      // Pay life cost if required (costs are paid immediately when activating)
      if (isTrueFetch) {
        // Ensure life object exists
        if (!(game.state as any).life) {
          (game.state as any).life = {};
        }
        const life = (game.state as any).life[pid] ?? (game as any).life?.[pid] ?? 40;
        const newLife = life - 1;
        
        // Update life in all locations
        (game.state as any).life[pid] = newLife;
        if ((game as any).life) {
          (game as any).life[pid] = newLife;
        }
        
        // Also update player object for UI sync
        const players = game.state?.players || [];
        const player = players.find((p: any) => p.id === pid);
        if (player) {
          (player as any).life = newLife;
        }
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} paid 1 life (${life} → ${newLife}).`,
          ts: Date.now(),
        });
      }
      
      // Tap the permanent (part of cost - paid immediately)
      (permanent as any).tapped = true;
      
      // Remove from battlefield (sacrifice - part of cost, paid immediately)
      battlefield.splice(permIndex, 1);
      
      // Move to graveyard
      const zones = (game.state as any)?.zones?.[pid];
      if (zones) {
        zones.graveyard = zones.graveyard || [];
        zones.graveyard.push({ ...card, zone: "graveyard" });
        zones.graveyardCount = zones.graveyard.length;
      }
      
      // Parse what land types this fetch can find
      const filter = parseSearchCriteria(oracleText);
      
      // Parse maxSelections from oracle text (e.g., "up to two" in Myriad Landscape)
      let maxSelections = 1; // Default to 1
      const upToMatch = oracleText.match(/search your library for up to (\w+)/i);
      if (upToMatch) {
        const num = upToMatch[1].toLowerCase();
        if (num === 'two') maxSelections = 2;
        else if (num === 'three') maxSelections = 3;
        else if (num === 'four') maxSelections = 4;
        else {
          const parsed = parseInt(num, 10);
          if (!isNaN(parsed)) maxSelections = parsed;
        }
      }
      
      // Detect if fetched lands enter tapped (Evolving Wilds, Terramorphic Expanse, etc.)
      // Look for patterns like:
      // - "put it onto the battlefield tapped"
      // - "put them onto the battlefield tapped"
      // - "enters the battlefield tapped"
      const entersTapped = /(?:put (?:it|them) onto|enters) the battlefield tapped/i.test(oracleText);
      
      // Build description for the ability
      let searchDescription = "Search your library for a land card";
      if (maxSelections > 1) {
        searchDescription = `Search your library for up to ${maxSelections} land cards`;
      }
      if (filter.subtypes && filter.subtypes.length > 0) {
        const landTypes = filter.subtypes.filter(s => !s.includes("basic")).map(s => s.charAt(0).toUpperCase() + s.slice(1));
        if (landTypes.length > 0) {
          const prefix = maxSelections > 1 ? `Search for up to ${maxSelections}` : "Search for a";
          searchDescription = `${prefix} ${landTypes.join(" or ")} card${maxSelections > 1 ? 's' : ''}`;
        }
        if (filter.subtypes.includes("basic")) {
          const prefix = maxSelections > 1 ? `Search for up to ${maxSelections} basic` : "Search for a basic";
          searchDescription = `${prefix} ${landTypes.join(" or ")} card${maxSelections > 1 ? 's' : ''}`;
        }
      }
      
      // Put the fetch land ability on the stack (per MTG rules, activated abilities use the stack)
      game.state.stack = game.state.stack || [];
      const abilityStackId = `ability_fetch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      game.state.stack.push({
        id: abilityStackId,
        type: 'ability',
        controller: pid,
        source: permanentId,
        sourceName: cardName,
        description: `${searchDescription}, put ${maxSelections > 1 ? 'them' : 'it'} onto the battlefield${entersTapped ? ' tapped' : ''}, then shuffle`,
        abilityType: 'fetch-land',
        // Store search parameters for when the ability resolves
        searchParams: {
          filter,
          searchDescription,
          isTrueFetch,
          maxSelections,
          entersTapped,
          cardImageUrl: card?.image_uris?.small || card?.image_uris?.normal,
        },
      } as any);
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateFetchland", { 
        playerId: pid, 
        permanentId, 
        abilityId, 
        cardName,
        stackId: abilityStackId,
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} activated ${cardName}${isTrueFetch ? " (paid 1 life)" : ""}, sacrificed it. Ability on the stack.`,
        ts: Date.now(),
      });
      
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle sacrifice-to-draw abilities (Sunbaked Canyon, Horizon Canopy, etc.)
    // Pattern: "{cost}, {T}, Sacrifice ~: Draw a card"
    // Examples: "{1}, {T}, Sacrifice ~" (Sunbaked Canyon), "{G}{W}, {T}, Sacrifice ~" (Horizon Canopy)
    // The client generates abilityId like "{cardId}-ability-{index}" for general activated abilities
    // Only process if oracle text actually has the sacrifice-to-draw pattern
    const hasSacrificeDrawPattern = oracleText.includes("sacrifice") && oracleText.includes("draw a card");
    const isSacrificeDrawAbility = (abilityId.includes("sacrifice-draw") || abilityId.includes("-ability-")) && hasSacrificeDrawPattern;
    if (isSacrificeDrawAbility) {
      // Parse the mana cost from oracle text
      // Pattern: "{cost}, {T}, Sacrifice: Draw a card" (case-insensitive for {T})
      const sacrificeCostMatch = oracleText.match(/(\{[^}]+\}(?:\s*\{[^}]+\})*)\s*,\s*\{T\}\s*,\s*sacrifice[^:]*:\s*draw a card/i);
      
      if (sacrificeCostMatch) {
        const manaCostStr = sacrificeCostMatch[1];
        const parsedCost = parseManaCost(manaCostStr);
        const manaPool = getOrInitManaPool(game.state, pid);
        
        // Check if player can pay the mana cost
        const totalAvailable = calculateTotalAvailableMana(manaPool, undefined);
        const validationError = validateManaPayment(
          totalAvailable,
          parsedCost.colors,
          parsedCost.generic
        );
        
        if (validationError) {
          socket.emit("error", {
            code: "INSUFFICIENT_MANA",
            message: validationError,
          });
          return;
        }
        
        // Validate: permanent must not already be tapped
        if ((permanent as any).tapped) {
          socket.emit("error", {
            code: "ALREADY_TAPPED",
            message: `${cardName} is already tapped`,
          });
          return;
        }
        
        // Consume the mana from the pool
        consumeManaFromPool(manaPool, parsedCost.colors, parsedCost.generic);
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} paid ${manaCostStr}.`,
          ts: Date.now(),
        });
        
        // Tap the permanent (part of cost - paid immediately)
        (permanent as any).tapped = true;
        
        // Remove from battlefield (sacrifice - part of cost, paid immediately)
        battlefield.splice(permIndex, 1);
        
        // Move to graveyard
        const zones = (game.state as any)?.zones?.[pid];
        if (zones) {
          zones.graveyard = zones.graveyard || [];
          zones.graveyard.push({ ...card, zone: "graveyard" });
          zones.graveyardCount = zones.graveyard.length;
        }
        
        // Draw a card (effect) - only if zones exists
        if (zones) {
          const lib = zones.library || [];
          if (lib.length > 0) {
            const drawnCard = lib.shift();
            zones.hand = zones.hand || [];
            zones.hand.push({ ...drawnCard, zone: "hand" });
            zones.handCount = zones.hand.length;
            zones.libraryCount = lib.length;
            
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `${getPlayerName(game, pid)} sacrificed ${cardName} and drew a card.`,
              ts: Date.now(),
            });
          } else {
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `${getPlayerName(game, pid)} sacrificed ${cardName} but had no cards to draw.`,
              ts: Date.now(),
            });
          }
        }
        
        if (typeof game.bumpSeq === "function") {
          game.bumpSeq();
        }
        
        appendEvent(gameId, (game as any).seq ?? 0, "activateSacrificeDrawAbility", { 
          playerId: pid, 
          permanentId, 
          abilityId, 
          cardName,
          manaCost: manaCostStr,
        });
        
        broadcastGame(io, game, gameId);
        return;
      }
    }
    
    // Handle equip abilities (equipment cards)
    // Check if this is an equip ability - abilityId contains "equip" or it's an equipment with equip cost
    const isEquipment = typeLine.includes("equipment");
    const isEquipAbility = abilityId.includes("equip") || (isEquipment && oracleText.includes("equip"));
    if (isEquipAbility) {
      // Parse all equip abilities from oracle text to match the one being activated
      // Format: "Equip [type] [creature] {cost}" e.g., "Equip legendary creature {3}" or "Equip {7}"
      // Note: Use [a-zA-Z] to match both upper and lower case creature types (Knight, Legendary, etc.)
      const equipRegex = /equip(?:\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?))?(?:\s+creature)?\s*(\{[^}]+\}(?:\{[^}]+\})*)/gi;
      const equipAbilities: { type: string | null; cost: string; index: number }[] = [];
      let equipMatch;
      let index = 0;
      while ((equipMatch = equipRegex.exec(oracleText)) !== null) {
        const conditionalType = equipMatch[1]?.trim() || null; // "legendary", "Knight", etc.
        const cost = equipMatch[2];
        equipAbilities.push({ type: conditionalType, cost, index: index++ });
      }
      
      // Extract which equip ability was selected from abilityId
      // Format: "{cardId}-equip-{index}" e.g., "card123-equip-0" or "card123-equip-1"
      let selectedAbilityIndex = 0;
      const abilityIndexMatch = abilityId.match(/-equip-(\d+)$/i);
      if (abilityIndexMatch) {
        selectedAbilityIndex = parseInt(abilityIndexMatch[1], 10);
      }
      
      // Get the selected equip ability or default to the first one
      const selectedEquip = equipAbilities[selectedAbilityIndex] || equipAbilities[0] || { type: null, cost: "{0}", index: 0 };
      const equipCost = selectedEquip.cost;
      const equipType = selectedEquip.type; // "legendary", "Knight", etc. or null for generic equip
      
      // Get valid target creatures based on equip type restriction
      const validTargets = battlefield.filter((p: any) => {
        if (p.controller !== pid) return false;
        const pTypeLine = (p.card?.type_line || "").toLowerCase();
        if (!pTypeLine.includes("creature")) return false;
        
        // If there's a type restriction (e.g., "legendary"), filter by it
        if (equipType) {
          // Handle common patterns:
          // "legendary" -> must have "legendary" in type_line
          // "legendary creature" -> same as "legendary"
          // "Knight", "Soldier" -> must have that creature type
          const typeRestriction = equipType.toLowerCase().replace(/\s+creature$/, '');
          if (!pTypeLine.includes(typeRestriction)) {
            return false;
          }
        }
        
        return true;
      });

      if (validTargets.length === 0) {
        socket.emit("error", {
          code: "NO_VALID_TARGETS",
          message: equipType 
            ? `You have no ${equipType} creatures to equip`
            : "You have no creatures to equip",
        });
        return;
      }

      // Store pending equip activation for when target is chosen
      // IMPORTANT: Preserve permanent/card info to prevent issues during target > pay workflow
      const effectId = `equip_${permanentId}_${Date.now()}`;
      (game.state as any).pendingEquipActivations = (game.state as any).pendingEquipActivations || {};
      (game.state as any).pendingEquipActivations[effectId] = {
        equipmentId: permanentId,
        equipmentName: cardName,
        equipCost,
        equipType, // Store the type restriction for logging
        playerId: pid,
        permanent: { ...permanent }, // Copy full permanent object
        validTargetIds: validTargets.map((c: any) => c.id),
      };
      
      // Send target selection prompt
      socket.emit("selectEquipTarget", {
        gameId,
        equipmentId: permanentId,
        equipmentName: cardName,
        equipCost,
        equipType, // Include type restriction for display
        imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
        effectId, // Include effectId for tracking
        validTargets: validTargets.map((c: any) => ({
          id: c.id,
          name: c.card?.name || "Creature",
          power: c.card?.power || c.basePower || "0",
          toughness: c.card?.toughness || c.baseToughness || "0",
          imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
        })),
      });
      
      debug(2, `[activateBattlefieldAbility] Equip ability on ${cardName}: cost=${equipCost}, type=${equipType || 'any'}, prompting for target selection (effectId: ${effectId})`);
      return;
    }
    
    // Handle activated abilities that grant abilities/keywords to target creatures
    // Pattern: "{cost}: Target creature you control gains/gets {ability} until end of turn"
    // Examples: Fire Nation Palace ("{1}{R}, {T}: Target creature you control gains firebending 4")
    //           Various lords and pump effects
    // Note: This also applies to instants/sorceries that grant abilities, but those are handled
    // during spell resolution via the targeting system
    const grantAbilityMatch = oracleText.match(/\{([^}]+(?:\}\s*,\s*\{[^}]+)*)\}:\s*target\s+creature\s+(you control|an opponent controls)?.*?(gains?|gets?)\s+([^.]+)/i);
    
    if (grantAbilityMatch && abilityId.includes("grant-ability")) {
      const costStr = `{${grantAbilityMatch[1]}}`;
      const targetRestriction = grantAbilityMatch[2]?.toLowerCase() || "you control";
      const grantVerb = grantAbilityMatch[3];
      let abilityGranted = grantAbilityMatch[4].trim();
      
      // Clean up the ability text
      abilityGranted = abilityGranted.replace(/\s+until end of turn$/i, '').trim();
      
      debug(2, `[activateBattlefieldAbility] Grant ability detected: ${cardName} - "${abilityGranted}" (restriction: ${targetRestriction})`);
      
      // Determine if this targets own or opponent creatures
      const targetsOpponentCreatures = targetRestriction.includes("opponent");
      
      // Get valid target creatures
      const validTargets = battlefield.filter((p: any) => {
        const pTypeLine = (p.card?.type_line || "").toLowerCase();
        if (!pTypeLine.includes("creature")) return false;
        
        if (targetsOpponentCreatures) {
          return p.controller !== pid; // Opponent's creatures
        } else {
          return p.controller === pid; // Own creatures
        }
      });
      
      if (validTargets.length === 0) {
        socket.emit("error", {
          code: "NO_VALID_TARGETS",
          message: targetsOpponentCreatures 
            ? "No opponent creatures to target"
            : "You have no creatures to target",
        });
        return;
      }
      
      // Store pending ability activation for when target is chosen
      const effectId = `grant_ability_${permanentId}_${Date.now()}`;
      (game.state as any).pendingAbilityGrants = (game.state as any).pendingAbilityGrants || {};
      (game.state as any).pendingAbilityGrants[effectId] = {
        sourceId: permanentId,
        sourceName: cardName,
        cost: costStr,
        abilityGranted,
        playerId: pid,
        permanent: { ...permanent },
        validTargetIds: validTargets.map((c: any) => c.id),
        targetsOpponentCreatures,
      };
      
      // Send target selection prompt
      socket.emit("selectAbilityTarget", {
        gameId,
        sourceId: permanentId,
        sourceName: cardName,
        cost: costStr,
        abilityGranted,
        imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
        effectId,
        validTargets: validTargets.map((c: any) => ({
          id: c.id,
          name: c.card?.name || "Creature",
          power: c.card?.power || c.basePower || "0",
          toughness: c.card?.toughness || c.baseToughness || "0",
          imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
        })),
      });
      
      debug(2, `[activateBattlefieldAbility] Ability grant on ${cardName}: ability="${abilityGranted}", prompting for target selection (effectId: ${effectId})`);
      return;
    }
    
    // Handle graveyard exile abilities (Keen-Eyed Curator, etc.)
    // Pattern: "{1}: Exile target card from a graveyard"
    const hasGraveyardExileAbility = oracleText.includes("exile target card from a graveyard") ||
      oracleText.includes("exile target card from any graveyard");
    if (hasGraveyardExileAbility && abilityId.includes("exile-graveyard")) {
      // Parse the cost
      const costMatch = oracleText.match(/\{([^}]+)\}:\s*exile target card from (?:a|any) graveyard/i);
      const cost = costMatch ? `{${costMatch[1]}}` : "{1}";
      
      // Parse the cost and validate mana availability
      const parsedCost = parseManaCost(cost);
      const pool = getOrInitManaPool(game.state, pid);
      const totalAvailable = calculateTotalAvailableMana(pool, []);
      
      // Validate payment
      const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
      if (validationError) {
        socket.emit("error", { code: "INSUFFICIENT_MANA", message: validationError });
        return;
      }
      
      // Consume mana
      consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[activateBattlefieldAbility:exile-graveyard]');
      
      // Tap the permanent if it has a tap symbol in the cost
      // Pattern: {T}: or {1}{T}: etc.
      if (oracleText.match(/\{[^}]*\bT\b[^}]*\}:/)) {
        (permanent as any).tapped = true;
      }
      
      // Request graveyard targets from all players
      const effectId = `graveyard_exile_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      
      // Store pending exile action
      if (!(game.state as any).pendingGraveyardExile) {
        (game.state as any).pendingGraveyardExile = {};
      }
      (game.state as any).pendingGraveyardExile[effectId] = {
        playerId: pid,
        permanentId,
        cardName,
        cost,
      };
      
      // Send graveyard selection prompt - allow selecting from any player's graveyard
      socket.emit("selectGraveyardExileTarget", {
        gameId,
        effectId,
        permanentId,
        cardName,
        cost,
        message: `Choose a graveyard and a card to exile`,
      });
      
      debug(2, `[activateBattlefieldAbility] Graveyard exile ability on ${cardName}: paid ${cost}, prompting for graveyard target selection`);
      return;
    }
    
    // Handle Control Change abilities (Humble Defector, etc.)
    // Check registry first, then fall back to pattern matching for unregistered cards
    const abilityConfig = getActivatedAbilityConfig(cardName);
    const hasControlChangeAbility = 
      (abilityConfig?.tapAbility?.controlChange === true) ||
      ((oracleText.includes("opponent gains control") || oracleText.includes("target opponent gains control")) &&
       abilityId.includes("control"));
    
    if (hasControlChangeAbility) {
      // Get effect details from registry first, then fall back to oracle text parsing
      let drawCards = abilityConfig?.tapAbility?.effect?.match(/draw (\w+) card/i)?.[1];
      
      // Fallback: Parse draw count directly from oracle text if not found in registry
      if (!drawCards) {
        const oracleDrawMatch = oracleText.match(/draw (\w+) card/i);
        if (oracleDrawMatch) {
          drawCards = oracleDrawMatch[1].toLowerCase();
        }
      }
      
      // Convert word numbers to actual count using module-level constant
      const drawCount = drawCards ? (WORD_TO_NUMBER[drawCards.toLowerCase()] || 0) : 0;
      
      debug(2, `[activateBattlefieldAbility] Control change ability on ${cardName}: drawCards=${drawCards}, drawCount=${drawCount}`);
      
      // Parse the cost
      const { requiresTap, manaCost } = parseActivationCost(oracleText, /(?:draw|opponent gains control)/i);
      
      if (requiresTap && (permanent as any).tapped) {
        socket.emit("error", {
          code: "ALREADY_TAPPED",
          message: `${cardName} is already tapped`,
        });
        return;
      }
      
      // Check timing restriction from registry
      const timingRestriction = abilityConfig?.tapAbility?.timingRestriction;
      if (timingRestriction === 'your_turn' && game.state?.turnPlayer !== pid) {
        socket.emit("error", {
          code: "WRONG_TIMING",
          message: `${cardName} can only be activated during your turn`,
        });
        return;
      }
      
      if (manaCost) {
        // Validate and consume mana
        const parsedCost = parseManaCost(manaCost);
        const pool = getOrInitManaPool(game.state, pid);
        const totalAvailable = calculateTotalAvailableMana(pool, []);
        
        const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
        if (validationError) {
          socket.emit("error", { code: "INSUFFICIENT_MANA", message: validationError });
          return;
        }
        
        consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[activateBattlefieldAbility:control-change]');
      }
      
      // Tap the permanent if required
      if (requiresTap) {
        (permanent as any).tapped = true;
      }
      
      // Generate activation ID
      const activationId = `control_change_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      
      // Store pending control change activation
      if (!game.state.pendingControlChangeActivations) {
        game.state.pendingControlChangeActivations = {};
      }
      game.state.pendingControlChangeActivations[activationId] = {
        playerId: pid,
        permanentId: permanentId,
        cardName: cardName,
        drawCards: drawCount, // Cards to draw from registry/oracle text
      };
      
      // Get available opponents
      const players = game.state?.players || [];
      const opponents = players.filter((p: any) => p && p.id !== pid && !(p as any).hasLost && !(p as any).eliminated).map((p: any) => ({
        id: p.id,
        name: p.name || p.id,
        life: game.state.life?.[p.id] ?? 40,
        libraryCount: game.state.zones?.[p.id]?.libraryCount ?? 0,
        isOpponent: true,
      }));
      
      // Emit opponent selection request to client
      socket.emit("controlChangeOpponentRequest", {
        gameId,
        activationId,
        source: {
          id: permanentId,
          name: cardName,
          imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
        },
        opponents,
        title: `${cardName} - Choose Opponent`,
        description: oracleText,
      });
      
      // Auto-select opponent for AI players
      if (isAIPlayer(gameId, pid)) {
        // AI should select randomly from available opponents
        // In a real implementation, AI could be smarter about target selection
        // For now, just pick a random valid opponent
        const randomOpponent = opponents[Math.floor(Math.random() * opponents.length)];
        
        if (randomOpponent) {
          // Delay slightly for more natural behavior
          setTimeout(() => {
            // Retrieve pending activation
            const pending = (game.state as any).pendingControlChangeActivations?.[activationId];
            if (!pending || pending.playerId !== pid) {
              debugWarn(2, '[AI] Control change activation expired or invalid');
              return;
            }
            
            // Clean up pending activation
            delete (game.state as any).pendingControlChangeActivations[activationId];
            
            // Find the permanent
            const battlefield = game.state?.battlefield || [];
            const permanent = battlefield.find((p: any) => p && p.id === pending.permanentId);
            
            if (!permanent) {
              debugWarn(2, '[AI] Permanent not found for control change');
              return;
            }
            
            // Draw cards if applicable
            if (pending.drawCards && pending.drawCards > 0) {
              // Try using the game's drawCards function first
              if (typeof (game as any).drawCards === 'function') {
                (game as any).drawCards(pid, pending.drawCards);
                
                io.to(gameId).emit("chat", {
                  id: `m_${Date.now()}`,
                  gameId,
                  from: "system",
                  message: `🤖 ${getPlayerName(game, pid)} draws ${pending.drawCards} card${pending.drawCards !== 1 ? 's' : ''}.`,
                  ts: Date.now(),
                });
              } else {
                // Fallback: manually draw from libraries Map
                const lib = (game as any).libraries?.get(pid) || [];
                const zones = (game.state as any).zones || {};
                const z = zones[pid] = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
                z.hand = z.hand || [];
                
                let drawnCount = 0;
                for (let i = 0; i < pending.drawCards && lib.length > 0; i++) {
                  const drawn = lib.shift();
                  if (drawn) {
                    (z.hand as any[]).push({ ...drawn, zone: 'hand' });
                    drawnCount++;
                  }
                }
                z.handCount = z.hand.length;
                z.libraryCount = lib.length;
                
                io.to(gameId).emit("chat", {
                  id: `m_${Date.now()}`,
                  gameId,
                  from: "system",
                  message: `🤖 ${getPlayerName(game, pid)} draws ${drawnCount} card${drawnCount !== 1 ? 's' : ''}.`,
                  ts: Date.now(),
                });
              }
            }
            
            // Change control
            const oldController = permanent.controller;
            permanent.controller = randomOpponent.id;
            
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `🔄 Control of ${pending.cardName} changed from ${getPlayerName(game, oldController)} to ${getPlayerName(game, randomOpponent.id)}.`,
              ts: Date.now(),
            });
            
            if (typeof game.bumpSeq === "function") {
              game.bumpSeq();
            }
            
            try {
              appendEvent(gameId, (game as any).seq ?? 0, "aiControlChangeOpponent", {
                playerId: pid,
                activationId,
                permanentId: pending.permanentId,
                cardName: pending.cardName,
                oldController,
                newController: randomOpponent.id,
                drewCards: pending.drawCards || 0,
              });
            } catch (e) {
              debugWarn(1, '[AI] Failed to persist AI control change event:', e);
            }
            
            broadcastGame(io, game, gameId);
          }, 500); // 500ms delay for AI thinking
        }
      }
      
      debug(2, `[activateBattlefieldAbility] Control change ability on ${cardName}: ${manaCost ? `paid ${manaCost}, ` : ''}${requiresTap ? 'tapped, ' : ''}prompting for opponent selection`);
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle Fight abilities (Brash Taunter, etc.)
    // Pattern: "{Cost}: This creature fights target creature you don't control"
    // Pattern: "{Cost}: This creature fights another target creature" (can target any creature)
    const hasFightAbility = oracleText.includes("fights") || oracleText.includes("fight");
    const isFightAbility = hasFightAbility && (abilityId.includes("fight") || oracleText.match(/\{[^}]+\}[^:]*:\s*[^.]*fights?/i));
    
    if (isFightAbility) {
      // Parse the cost
      const { requiresTap, manaCost } = parseActivationCost(oracleText, /fights?/i);
      
      if (requiresTap && (permanent as any).tapped) {
        socket.emit("error", {
          code: "ALREADY_TAPPED",
          message: `${cardName} is already tapped`,
        });
        return;
      }
      
      if (manaCost) {
        // Validate and consume mana
        const parsedCost = parseManaCost(manaCost);
        const pool = getOrInitManaPool(game.state, pid);
        const totalAvailable = calculateTotalAvailableMana(pool, []);
        
        const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
        if (validationError) {
          socket.emit("error", { code: "INSUFFICIENT_MANA", message: validationError });
          return;
        }
        
        consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[activateBattlefieldAbility:fight]');
      }
      
      // Tap the permanent if required
      if (requiresTap) {
        (permanent as any).tapped = true;
      }
      
      // Generate activation ID
      const activationId = `fight_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      
      // Determine fight target restrictions from oracle text
      // "another target creature" = any creature except itself
      // "target creature you don't control" = opponent's creatures only
      // "target creature" = typically opponent's creatures unless specified otherwise
      let fightController: 'opponent' | 'any' | 'you' = 'any';
      if (oracleText.includes("you don't control") || oracleText.includes("you do not control")) {
        fightController = 'opponent';
      } else if (oracleText.includes("another target creature") || oracleText.includes("fights another target")) {
        fightController = 'any'; // Can fight any creature including your own
      } else if (oracleText.includes("target creature you control")) {
        fightController = 'you';
      }
      
      // Store pending fight activation
      if (!game.state.pendingFightActivations) {
        game.state.pendingFightActivations = {};
      }
      game.state.pendingFightActivations[activationId] = {
        playerId: pid,
        sourceId: permanentId,
        sourceName: cardName,
        controller: fightController,
      };
      
      // Emit target selection request to client
      socket.emit("fightTargetRequest", {
        gameId,
        activationId,
        source: {
          id: permanentId,
          name: cardName,
          imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
        },
        targetFilter: {
          types: ['creature'],
          controller: fightController,
          excludeSource: true,
        },
        title: `${cardName} - Fight`,
        description: oracleText,
      });
      
      debug(2, `[activateBattlefieldAbility] Fight ability on ${cardName}: ${manaCost ? `paid ${manaCost}, ` : ''}prompting for target creature (controller: ${fightController})`);
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle Counter-adding abilities (Gwafa Hazid, Sage of Fables, Gavony Township, Ozolith, Immaculate Magistrate, etc.)
    // Pattern: "{Cost}: Put a [counterType] counter on target [anything]" or "Put a counter for each..."
    // Examples:
    // - Gwafa Hazid: "{W}{U}, {T}: Put a bribery counter on target creature you don't control. Its controller draws a card."
    // - Sage of Fables: "{2}: Put a +1/+1 counter on target creature."
    // - Gavony Township: "{2}{G}{W}, {T}: Put a +1/+1 counter on each creature you control."
    // - Ozolith, the Shattered Spire: "{1}, {T}: Put a +1/+1 counter on target creature you control. Activate only as a sorcery."
    // - Immaculate Magistrate: "{T}: Put a +1/+1 counter on target creature for each Elf you control."
    // Works on: creatures, permanents, lands, artifacts, enchantments, planeswalkers, etc.
    const counterMatch = oracleText.match(/put (?:a|an|one|two|three) ([^\s]+) counters? on target ([^.]+?)(?:\s+you\s+(don't\s+control|control|don't own|own))?(?:\s+for each ([^.]+?))?(?:\.|,|$)/i);
    const isCounterAbility = counterMatch && (abilityId.includes("counter") || abilityId.includes("ability"));
    
    if (isCounterAbility && counterMatch) {
      const counterType = counterMatch[1].toLowerCase().replace(/[^a-z0-9+\-]/g, ''); // e.g., "bribery", "+1/+1", "loyalty"
      const targetType = counterMatch[2].trim(); // e.g., "creature", "permanent", "artifact", "land"
      const targetRestriction = counterMatch[3] ? counterMatch[3].toLowerCase() : null;
      const scalingText = counterMatch[4] ? counterMatch[4].trim() : null; // e.g., "Elf you control"
      
      // Parse the cost
      const { requiresTap, manaCost } = parseActivationCost(oracleText, /put (?:a|an|one) [^\s]+ counter/i);
      
      if (requiresTap && (permanent as any).tapped) {
        socket.emit("error", {
          code: "ALREADY_TAPPED",
          message: `${cardName} is already tapped`,
        });
        return;
      }
      
      if (manaCost) {
        // Validate and consume mana
        const parsedCost = parseManaCost(manaCost);
        const pool = getOrInitManaPool(game.state, pid);
        const totalAvailable = calculateTotalAvailableMana(pool, []);
        
        const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
        if (validationError) {
          socket.emit("error", { code: "INSUFFICIENT_MANA", message: validationError });
          return;
        }
        
        consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[activateBattlefieldAbility:counter]');
      }
      
      // Tap the permanent if required
      if (requiresTap) {
        (permanent as any).tapped = true;
      }
      
      // Generate activation ID
      const activationId = `counter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      
      // Determine target restrictions
      let targetController: 'opponent' | 'any' | 'you' = 'any';
      if (targetRestriction) {
        if (targetRestriction.includes("don't control") || targetRestriction.includes("do not control")) {
          targetController = 'opponent';
        } else if (targetRestriction.includes("you control")) {
          targetController = 'you';
        }
      }
      
      // Store pending counter activation
      if (!game.state.pendingCounterActivations) {
        game.state.pendingCounterActivations = {};
      }
      game.state.pendingCounterActivations[activationId] = {
        playerId: pid,
        sourceId: permanentId,
        sourceName: cardName,
        counterType,
        targetController,
        oracleText, // Store for additional effects (e.g., "Its controller draws a card")
        scalingText, // Store for calculating counter count (e.g., "Elf you control")
      };
      
      // Emit target selection request to client
      socket.emit("counterTargetRequest", {
        gameId,
        activationId,
        source: {
          id: permanentId,
          name: cardName,
          imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
        },
        counterType,
        targetFilter: {
          types: ['creature', 'permanent'],
          controller: targetController,
          excludeSource: false, // Allow targeting self in some cases
        },
        title: `${cardName} - Add ${counterType} counter`,
        description: oracleText,
      });
      
      debug(2, `[activateBattlefieldAbility] Counter ability on ${cardName}: ${manaCost ? `paid ${manaCost}, ` : ''}prompting for target (controller: ${targetController}, counter: ${counterType})`);
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle Counter-moving abilities (Nesting Grounds, Resourceful Defense, etc.)
    // Pattern: "{Cost}: Move a counter from target permanent you control onto a second target permanent"
    // Example: Nesting Grounds: "{1}, {T}: Move a counter from target permanent you control onto a second target permanent. Activate only as a sorcery."
    const moveCounterMatch = oracleText.match(/move (?:a|one) counter from target permanent(?:\s+you\s+control)?/i);
    const isMoveCounterAbility = moveCounterMatch && (abilityId.includes("move") || abilityId.includes("counter") || abilityId.includes("ability"));
    
    if (isMoveCounterAbility) {
      // Parse the cost
      const { requiresTap, manaCost } = parseActivationCost(oracleText, /move (?:a|one) counter/i);
      
      if (requiresTap && (permanent as any).tapped) {
        socket.emit("error", {
          code: "ALREADY_TAPPED",
          message: `${cardName} is already tapped`,
        });
        return;
      }
      
      if (manaCost) {
        // Validate and consume mana
        const parsedCost = parseManaCost(manaCost);
        const pool = getOrInitManaPool(game.state, pid);
        const totalAvailable = calculateTotalAvailableMana(pool, []);
        
        const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
        if (validationError) {
          socket.emit("error", { code: "INSUFFICIENT_MANA", message: validationError });
          return;
        }
        
        consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[activateBattlefieldAbility:move-counter]');
      }
      
      // Tap the permanent if required
      if (requiresTap) {
        (permanent as any).tapped = true;
      }
      
      // Generate activation ID
      const activationId = `move_counter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      
      // Store pending move counter activation
      if (!game.state.pendingMoveCounterActivations) {
        game.state.pendingMoveCounterActivations = {};
      }
      game.state.pendingMoveCounterActivations[activationId] = {
        playerId: pid,
        sourceId: permanentId,
        sourceName: cardName,
        step: 'select_source', // First step: select source permanent
      };
      
      // Emit target selection request to client (first target: source permanent)
      socket.emit("moveCounterSourceRequest", {
        gameId,
        activationId,
        source: {
          id: permanentId,
          name: cardName,
          imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
        },
        targetFilter: {
          types: ['permanent'],
          controller: 'you',
          requiresCounters: true, // Must have at least one counter
          excludeSource: false,
        },
        title: `${cardName} - Select source permanent`,
        description: "Choose a permanent you control with counters to move a counter from",
      });
      
      debug(2, `[activateBattlefieldAbility] Move counter ability on ${cardName}: ${manaCost ? `paid ${manaCost}, ` : ''}prompting for source permanent`);
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle Tap/Untap abilities (Saryth, Merrow Reejerey, Argothian Elder, etc.)
    // Parse ability text to detect tap/untap abilities
    const tapUntapParams = parseTapUntapAbilityText(oracleText);
    const isTapUntapAbility = tapUntapParams && (
      abilityId.includes("tap") || 
      abilityId.includes("untap") || 
      abilityId.includes("tap-untap")
    );
    
    if (isTapUntapAbility && tapUntapParams) {
      // Parse the cost
      const { requiresTap, manaCost } = parseActivationCost(oracleText, /(?:tap|untap)/i);
      
      if (requiresTap && (permanent as any).tapped) {
        socket.emit("error", {
          code: "ALREADY_TAPPED",
          message: `${cardName} is already tapped`,
        });
        return;
      }
      
      if (manaCost) {
        // Validate and consume mana
        const parsedCost = parseManaCost(manaCost);
        const pool = getOrInitManaPool(game.state, pid);
        const totalAvailable = calculateTotalAvailableMana(pool, []);
        
        const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
        if (validationError) {
          socket.emit("error", { code: "INSUFFICIENT_MANA", message: validationError });
          return;
        }
        
        consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[activateBattlefieldAbility:tap-untap]');
      }
      
      // Tap the permanent if required
      if (requiresTap) {
        (permanent as any).tapped = true;
      }
      
      // Generate activation ID
      const activationId = `tap_untap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      
      // Store pending activation
      if (!game.state.pendingTapUntapActivations) {
        game.state.pendingTapUntapActivations = {};
      }
      game.state.pendingTapUntapActivations[activationId] = {
        playerId: pid,
        sourceId: permanentId,
        sourceName: cardName,
        targetCount: tapUntapParams.count,
        action: tapUntapParams.action,
      };
      
      // Emit target selection request to client
      socket.emit("tapUntapTargetRequest", {
        gameId,
        activationId,
        source: {
          id: permanentId,
          name: cardName,
          imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
        },
        action: tapUntapParams.action,
        targetFilter: {
          types: tapUntapParams.types as any[],
          controller: tapUntapParams.controller,
          tapStatus: 'any',
          excludeSource: tapUntapParams.excludeSource,
        },
        targetCount: tapUntapParams.count,
        title: cardName,
        description: oracleText,
      });
      
      debug(2, `[activateBattlefieldAbility] Tap/Untap ability on ${cardName}: ${manaCost ? `paid ${manaCost}, ` : ''}prompting for ${tapUntapParams.count} target(s)`);
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle Crew abilities (Vehicle cards)
    // Crew N: Tap creatures with total power N or more to make this Vehicle an artifact creature
    const isVehicle = typeLine.includes("vehicle");
    const isCrewAbility = abilityId.includes("crew") || (isVehicle && oracleText.includes("crew"));
    if (isCrewAbility) {
      // Parse crew power requirement from oracle text
      const crewMatch = oracleText.match(/crew\s*(\d+)/i);
      const crewPower = crewMatch ? parseInt(crewMatch[1], 10) : 0;
      
      // Get valid creatures that can crew (untapped creatures the player controls)
      const validCrewers = battlefield.filter((p: any) => {
        if (p.controller !== pid) return false;
        if (p.id === permanentId) return false; // Can't crew itself
        const pTypeLine = (p.card?.type_line || "").toLowerCase();
        if (!pTypeLine.includes("creature")) return false;
        if (p.tapped) return false; // Must be untapped
        return true;
      });

      if (validCrewers.length === 0) {
        socket.emit("error", {
          code: "NO_VALID_CREWERS",
          message: "You have no untapped creatures to crew with",
        });
        return;
      }

      // Calculate total available power (including counters and modifiers)
      const totalAvailablePower = validCrewers.reduce((sum: number, c: any) => {
        return sum + getEffectivePower(c);
      }, 0);

      if (totalAvailablePower < crewPower) {
        socket.emit("error", {
          code: "INSUFFICIENT_POWER",
          message: `You need creatures with total power ${crewPower}+ to crew ${cardName}. Available: ${totalAvailablePower}`,
        });
        return;
      }
      
      // Send crew selection prompt
      socket.emit("selectCrewCreatures", {
        gameId,
        vehicleId: permanentId,
        vehicleName: cardName,
        crewPower,
        imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
        validCrewers: validCrewers.map((c: any) => ({
          id: c.id,
          name: c.card?.name || "Creature",
          power: getEffectivePower(c),
          toughness: getEffectiveToughness(c),
          imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
        })),
      });
      
      debug(2, `[activateBattlefieldAbility] Crew ability on ${cardName}: prompting for creature selection (need power ${crewPower})`);
      return;
    }
    
    // Handle Counter Movement abilities (Nesting Grounds, etc.)
    // Pattern: "Move a counter from target permanent you control onto another target permanent"
    const hasCounterMovementAbility = oracleText.includes("move a counter") || 
      oracleText.includes("move") && oracleText.includes("counter");
    const isCounterMovementAbility = hasCounterMovementAbility && (
      abilityId.includes("counter-move") || 
      abilityId.includes("move-counter") ||
      cardName.toLowerCase().includes("nesting grounds")
    );
    
    if (isCounterMovementAbility) {
      // Parse the cost
      const { requiresTap, manaCost } = parseActivationCost(oracleText, /move (?:a|one) counter/i);
      
      if (requiresTap && (permanent as any).tapped) {
        socket.emit("error", {
          code: "ALREADY_TAPPED",
          message: `${cardName} is already tapped`,
        });
        return;
      }
      
      if (manaCost) {
        // Validate and consume mana
        const parsedCost = parseManaCost(manaCost);
        const pool = getOrInitManaPool(game.state, pid);
        const totalAvailable = calculateTotalAvailableMana(pool, []);
        
        const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
        if (validationError) {
          socket.emit("error", { code: "INSUFFICIENT_MANA", message: validationError });
          return;
        }
        
        consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[activateBattlefieldAbility:counter-move]');
      }
      
      // Tap the permanent if required
      if (requiresTap) {
        (permanent as any).tapped = true;
      }
      
      // Generate activation ID
      const activationId = `counter_move_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      
      // Store pending activation
      if (!game.state.pendingCounterMovements) {
        game.state.pendingCounterMovements = {};
      }
      game.state.pendingCounterMovements[activationId] = {
        playerId: pid,
        sourceId: permanentId,
        sourceName: cardName,
      };
      
      // Emit counter movement request to client
      socket.emit("counterMovementRequest", {
        gameId,
        activationId,
        source: {
          id: permanentId,
          name: cardName,
          imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
        },
        sourceFilter: {
          controller: 'you', // Nesting Grounds requires "you control"
        },
        targetFilter: {
          controller: 'any',
          excludeSource: false,
        },
        title: cardName,
        description: oracleText,
      });
      
      debug(2, `[activateBattlefieldAbility] Counter movement ability on ${cardName}: ${manaCost ? `paid ${manaCost}, ` : ''}prompting for counter selection`);
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle Multi-Mode abilities (Staff of Domination, Trading Post, etc.)
    // Import the multi-mode ability detection from triggered-abilities
    const { detectMultiModeAbility } = await import("../state/modules/triggered-abilities.js");
    const multiModeAbility = detectMultiModeAbility(card, permanent);
    // Only treat as multi-mode if the ability ID explicitly indicates it (not just by card name)
    // This allows individual abilities to be activated directly from the parsed ability list
    const isMultiModeAbility = multiModeAbility && (
      abilityId.includes("multi-mode") || 
      abilityId === "multi-mode" ||
      abilityId === "staff-multi-mode"
    );
    
    if (isMultiModeAbility && multiModeAbility) {
      // Emit mode selection request to client
      socket.emit("multiModeActivationRequest", {
        gameId,
        permanent: {
          id: permanentId,
          name: cardName,
          imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
        },
        modes: multiModeAbility.modes,
      });
      
      debug(2, `[activateBattlefieldAbility] Multi-mode ability on ${cardName}: prompting for mode selection`);
      return;
    }
    
    // Handle Station abilities (Spacecraft cards)
    // Station N (Rule 702.184a): "Tap another untapped creature you control: Put a number of 
    // charge counters on this permanent equal to the tapped creature's power."
    const isSpacecraft = typeLine.includes("spacecraft");
    const isStationAbility = abilityId.includes("station") || (isSpacecraft && oracleText.includes("station"));
    if (isStationAbility) {
      // Parse station threshold from oracle text
      const stationMatch = oracleText.match(/station\s*(\d+)/i);
      const stationThreshold = stationMatch ? parseInt(stationMatch[1], 10) : 0;
      
      // Per Rule 702.184a, station is activated at sorcery speed
      // Check if it's the player's turn and main phase
      const phase = (game.state as any).phase || '';
      const isMainPhase = phase.toLowerCase().includes('main');
      const stack = game.state?.stack || [];
      const activePlayer = (game.state as any).turnPlayer || (game.state as any).activePlayer;
      
      if (activePlayer !== pid) {
        socket.emit("error", {
          code: "NOT_YOUR_TURN",
          message: "Station can only be activated on your turn (sorcery speed)",
        });
        return;
      }
      
      if (!isMainPhase || stack.length > 0) {
        socket.emit("error", {
          code: "SORCERY_SPEED_ONLY",
          message: "Station can only be activated at sorcery speed (main phase, empty stack)",
        });
        return;
      }
      
      // Find untapped creatures the player controls (excluding the station itself)
      const untappedCreatures = battlefield.filter((p: any) => {
        if (!p || p.controller !== pid) return false;
        if (p.id === permanentId) return false; // Can't tap itself
        if (p.tapped) return false;
        const pTypeLine = (p.card?.type_line || '').toLowerCase();
        return pTypeLine.includes('creature');
      });
      
      if (untappedCreatures.length === 0) {
        socket.emit("error", {
          code: "NO_VALID_TARGETS",
          message: "No untapped creatures to tap for station ability",
        });
        return;
      }
      
      // Generate activation ID
      const activationId = `station_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      
      // Store pending activation
      if (!(game.state as any).pendingStationActivations) {
        (game.state as any).pendingStationActivations = {};
      }
      (game.state as any).pendingStationActivations[activationId] = {
        playerId: pid,
        stationId: permanentId,
        stationName: cardName,
        stationThreshold,
      };
      
      // Emit creature selection request to client
      const creatureOptions = untappedCreatures.map((c: any) => {
        const creaturePower = getEffectivePower(c);
        return {
          id: c.id,
          name: c.card?.name || 'Unknown',
          power: creaturePower,
          toughness: getEffectiveToughness(c),
          imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
        };
      });
      
      socket.emit("stationCreatureSelection", {
        gameId,
        activationId,
        station: {
          id: permanentId,
          name: cardName,
          imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
          threshold: stationThreshold,
          currentCounters: (permanent as any).counters?.charge || 0,
        },
        creatures: creatureOptions,
        title: `Station ${stationThreshold}`,
        description: `Tap another untapped creature you control. Put charge counters on ${cardName} equal to that creature's power.`,
      });
      
      debug(2, `[activateBattlefieldAbility] Station ability on ${cardName}: prompting for creature selection (${untappedCreatures.length} valid targets)`);
      return;
    }
    
    // Handle Level Up abilities (Rule 702.87)
    // "Level up [cost]" means "[Cost]: Put a level counter on this permanent. Activate only as a sorcery."
    const levelUpMatch = oracleText.match(/level\s+up\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
    const isLevelUpAbility = abilityId.includes("level-up") || abilityId.includes("levelup") || 
      (levelUpMatch && abilityId.includes("level"));
    
    if (isLevelUpAbility && levelUpMatch) {
      const levelUpCost = levelUpMatch[1];
      
      // Level up is sorcery speed only (Rule 702.87a)
      const phase = (game.state as any).phase || '';
      const isMainPhase = phase.toLowerCase().includes('main');
      const stack = game.state?.stack || [];
      const activePlayer = (game.state as any).turnPlayer || (game.state as any).activePlayer;
      
      if (activePlayer !== pid) {
        socket.emit("error", {
          code: "NOT_YOUR_TURN",
          message: "Level up can only be activated on your turn (sorcery speed)",
        });
        return;
      }
      
      if (!isMainPhase || stack.length > 0) {
        socket.emit("error", {
          code: "SORCERY_SPEED_ONLY",
          message: "Level up can only be activated at sorcery speed (main phase, empty stack)",
        });
        return;
      }
      
      // Parse and pay the mana cost
      const parsedCost = parseManaCost(levelUpCost);
      const pool = getOrInitManaPool(game.state, pid);
      const totalAvailable = calculateTotalAvailableMana(pool, []);
      
      const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
      if (validationError) {
        socket.emit("error", { code: "INSUFFICIENT_MANA", message: validationError });
        return;
      }
      
      consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[activateBattlefieldAbility:level-up]');
      
      // Add a level counter to the permanent
      (permanent as any).counters = (permanent as any).counters || {};
      const currentLevel = (permanent as any).counters.level || 0;
      (permanent as any).counters.level = currentLevel + 1;
      const newLevel = (permanent as any).counters.level;
      
      // Determine which level bracket this puts the creature in
      // Look for LEVEL N1-N2 and LEVEL N3+ patterns in the oracle text
      let levelBracket = `Level ${newLevel}`;
      const levelRangePattern = /level\s+(\d+)-(\d+)/gi;
      const levelPlusPattern = /level\s+(\d+)\+/gi;
      
      // Use matchAll for safe iteration over global regex matches
      for (const match of oracleText.matchAll(levelRangePattern)) {
        const minLevel = parseInt(match[1], 10);
        const maxLevel = parseInt(match[2], 10);
        if (newLevel >= minLevel && newLevel <= maxLevel) {
          levelBracket = `Level ${minLevel}-${maxLevel}`;
          break;
        }
      }
      
      for (const match of oracleText.matchAll(levelPlusPattern)) {
        const minLevel = parseInt(match[1], 10);
        if (newLevel >= minLevel) {
          levelBracket = `Level ${minLevel}+`;
          break;
        }
      }
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `📊 ${getPlayerName(game, pid)} paid ${levelUpCost} to level up ${cardName}! (${newLevel} level counter${newLevel !== 1 ? 's' : ''}, ${levelBracket})`,
        ts: Date.now(),
      });
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      // Append event to game log
      appendGameEvent(game, gameId, 'level_up', {
        playerId: pid,
        permanentId,
        cardName,
        cost: levelUpCost,
        newLevel,
        levelBracket,
        ts: Date.now(),
      });
      
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle Outlast abilities (Rule 702.107)
    // "Outlast [cost]" means "[Cost], {T}: Put a +1/+1 counter on this creature. Activate only as a sorcery."
    const outlastMatch = oracleText.match(/outlast\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
    const isOutlastAbility = abilityId.includes("outlast") || 
      (outlastMatch && abilityId.includes("outlast"));
    
    if (isOutlastAbility && outlastMatch) {
      const outlastCost = outlastMatch[1];
      
      // Outlast is sorcery speed only (Rule 702.107a)
      const phase = (game.state as any).phase || '';
      const isMainPhase = phase.toLowerCase().includes('main');
      const stack = game.state?.stack || [];
      const activePlayer = (game.state as any).turnPlayer || (game.state as any).activePlayer;
      
      if (activePlayer !== pid) {
        socket.emit("error", {
          code: "NOT_YOUR_TURN",
          message: "Outlast can only be activated on your turn (sorcery speed)",
        });
        return;
      }
      
      if (!isMainPhase || stack.length > 0) {
        socket.emit("error", {
          code: "SORCERY_SPEED_ONLY",
          message: "Outlast can only be activated at sorcery speed (main phase, empty stack)",
        });
        return;
      }
      
      // Outlast requires tapping the creature (Rule 702.107a)
      if (permanent.tapped) {
        socket.emit("error", {
          code: "ALREADY_TAPPED",
          message: `${cardName} is already tapped and cannot use outlast`,
        });
        return;
      }
      
      // Parse and pay the mana cost
      const parsedCost = parseManaCost(outlastCost);
      const pool = getOrInitManaPool(game.state, pid);
      const totalAvailable = calculateTotalAvailableMana(pool, []);
      
      const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
      if (validationError) {
        socket.emit("error", { code: "INSUFFICIENT_MANA", message: validationError });
        return;
      }
      
      consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[activateBattlefieldAbility:outlast]');
      
      // Tap the creature as part of the cost
      permanent.tapped = true;
      
      // Add a +1/+1 counter to the creature
      (permanent as any).counters = (permanent as any).counters || {};
      const currentCounters = (permanent as any).counters['+1/+1'] || 0;
      (permanent as any).counters['+1/+1'] = currentCounters + 1;
      const newCount = (permanent as any).counters['+1/+1'];
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `💪 ${getPlayerName(game, pid)} paid ${outlastCost} and tapped ${cardName} to outlast! (${newCount} +1/+1 counter${newCount !== 1 ? 's' : ''})`,
        ts: Date.now(),
      });
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      // Append event to game log
      appendGameEvent(game, gameId, 'outlast', {
        playerId: pid,
        permanentId,
        cardName,
        cost: outlastCost,
        newCounterCount: newCount,
        ts: Date.now(),
      });
      
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle creature upgrade abilities (Figure of Destiny, Warden of the First Tree, etc.)
    // These are activated abilities that transform or upgrade a creature
    if (abilityId.startsWith("upgrade-") || abilityId.includes("-becomes-")) {
      // Parse the upgrade ability from oracle text
      const upgradeAbilities = parseCreatureUpgradeAbilities(oracleText, cardName);
      
      if (upgradeAbilities.length === 0) {
        socket.emit("error", {
          code: "NO_UPGRADE_ABILITY",
          message: `${cardName} does not have any upgrade abilities`,
        });
        return;
      }
      
      // Determine which upgrade ability to activate based on abilityId
      const upgradeIndex = parseInt(abilityId.replace(/^upgrade-|\-becomes-.*$/g, ''), 10) || 0;
      const upgrade = upgradeAbilities[upgradeIndex < upgradeAbilities.length ? upgradeIndex : 0];
      
      if (!upgrade) {
        socket.emit("error", {
          code: "INVALID_UPGRADE_ABILITY",
          message: `Upgrade ability not found on ${cardName}`,
        });
        return;
      }
      
      // Check if condition is met (e.g., "If ~ is a Spirit")
      if (upgrade.requiredTypes && upgrade.requiredTypes.length > 0) {
        const currentTypes = getUpgradedCreatureTypes(permanent);
        const meetsCondition = upgrade.requiredTypes.every(reqType => 
          currentTypes.some(t => t.toLowerCase() === reqType.toLowerCase())
        );
        
        if (!meetsCondition) {
          socket.emit("error", {
            code: "UPGRADE_CONDITION_NOT_MET",
            message: `${cardName} must be a ${upgrade.requiredTypes.join(' ')} to activate this ability`,
          });
          return;
        }
      }
      
      // Put the upgrade ability on the stack
      const stackItem = {
        id: `ability_upgrade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'ability' as const,
        controller: pid,
        source: permanentId,
        sourceName: cardName,
        description: upgrade.fullText,
        abilityType: 'creature-upgrade',
        upgradeData: {
          newTypes: upgrade.newTypes,
          newPower: upgrade.newPower,
          newToughness: upgrade.newToughness,
          keywords: upgrade.keywords,
          counterCount: upgrade.counterCount,
          counterType: upgrade.counterType,
        },
      } as any;
      
      game.state.stack = game.state.stack || [];
      game.state.stack.push(stackItem);
      
      // Emit stack update
      io.to(gameId).emit("stackUpdate", {
        gameId,
        stack: (game.state.stack || []).map((s: any) => ({
          id: s.id,
          type: s.type,
          name: s.sourceName || s.card?.name || 'Ability',
          controller: s.controller,
          targets: s.targets,
          source: s.source,
          sourceName: s.sourceName,
          description: s.description,
        })),
      });
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateUpgradeAbility", { 
        playerId: pid, 
        permanentId, 
        abilityId,
        cardName,
        upgradeIndex,
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `⚡ ${getPlayerName(game, pid)} activated ${cardName}'s upgrade ability. (${upgrade.fullText.slice(0, 80)}...)`,
        ts: Date.now(),
      });
      
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle mana abilities (tap-mana-* or native_*)
    if (abilityId.startsWith("tap-mana") || abilityId.startsWith("native_")) {
      // Validate: permanent must not be tapped
      if ((permanent as any).tapped) {
        socket.emit("error", {
          code: "ALREADY_TAPPED",
          message: `${cardName} is already tapped`,
        });
        return;
      }
      
      // Check for Metalcraft requirement (Mox Opal)
      // Rule 702.80 - Metalcraft abilities only work if you control 3+ artifacts
      if (oracleText.includes('metalcraft')) {
        const artifactCount = battlefield.filter((p: any) => {
          if (p.controller !== pid) return false;
          const permTypeLine = (p.card?.type_line || '').toLowerCase();
          return permTypeLine.includes('artifact');
        }).length;
        
        if (artifactCount < 3) {
          socket.emit("error", {
            code: "METALCRAFT_NOT_ACTIVE",
            message: `Metalcraft is not active. You control ${artifactCount} artifacts (need 3 or more).`,
          });
          return;
        }
      }
      
      // Tap the permanent
      (permanent as any).tapped = true;
      
      // Determine mana color from ability ID
      let manaColor = "colorless";
      const manaColorMap: Record<string, string> = {
        "tap-mana-w": "W",
        "tap-mana-u": "U",
        "tap-mana-b": "B",
        "tap-mana-r": "R",
        "tap-mana-g": "G",
        "tap-mana-any": "any", // Will need to prompt for color choice
        "tap-mana": "C",
        "native_w": "W",
        "native_u": "U",
        "native_b": "B",
        "native_r": "R",
        "native_g": "G",
        "native_c": "C",
        "native_any": "any", // Will need to prompt for color choice
      };
      manaColor = manaColorMap[abilityId] || "C";
      
      // Calculate actual mana production (handles multipliers, enchantments, etc.)
      const manaProduction = calculateManaProduction(game.state, permanent, pid, manaColor);
      
      // Add mana to pool
      game.state.manaPool = game.state.manaPool || {};
      game.state.manaPool[pid] = game.state.manaPool[pid] || {
        white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
      };
      
      // Add the calculated amount of mana
      const actualColor = manaProduction.colors[0] || manaColor;
      const manaAmount = manaProduction.totalAmount;
      
      // If producing "any" color mana, prompt user for color choice
      if (actualColor === 'any') {
        // Store pending mana activation state
        if (!game.state.pendingManaActivations) {
          game.state.pendingManaActivations = {};
        }
        // Use crypto.randomUUID() for collision-resistant ID generation
        const activationId = `mana_any_${crypto.randomUUID()}`;
        game.state.pendingManaActivations[activationId] = {
          playerId: pid,
          permanentId,
          cardName,
          amount: manaAmount,
        };
        
        // Request color choice from player
        socket.emit("anyColorManaChoice", {
          gameId,
          activationId,
          permanentId,
          cardName,
          amount: manaAmount,
          cardImageUrl: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
        });
        
        broadcastGame(io, game, gameId);
        return;
      }
      
      const colorToPoolKey: Record<string, keyof typeof game.state.manaPool[typeof pid]> = {
        'W': 'white',
        'U': 'blue',
        'B': 'black',
        'R': 'red',
        'G': 'green',
        'C': 'colorless',
        // Note: 'any' color is now handled above by prompting for color choice
      };
      
      const poolKey = colorToPoolKey[actualColor] || 'colorless';
      (game.state.manaPool[pid] as any)[poolKey] = ((game.state.manaPool[pid] as any)[poolKey] || 0) + manaAmount;
      
      // Create chat message with correct amount
      const manaDescription = manaAmount > 1 
        ? `${manaAmount} ${actualColor === 'C' ? 'colorless' : actualColor} mana`
        : `${actualColor === 'C' ? 'colorless' : actualColor} mana`;
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} tapped ${cardName} for ${manaDescription}.`,
        ts: Date.now(),
      });
      
      // ===== PAIN LANDS - Deal 1 damage when tapped for colored mana =====
      // Pain lands (Shivan Reef, Nurturing Peatland, etc.) deal 1 damage to you when tapped for colored mana
      // Check oracle text for pattern like "{T}, Pay 1 life:" or "deals 1 damage to you"
      const isPainLand = oracleText.includes('deals 1 damage to you') || 
                         (oracleText.includes('{t},') && oracleText.includes('pay 1 life'));
      const isTappingForColoredMana = manaColor !== 'colorless' && manaColor !== 'any';
      
      // Known pain lands
      const PAIN_LANDS = new Set([
        'shivan reef', 'llanowar wastes', 'caves of koilos', 'adarkar wastes', 
        'sulfurous springs', 'underground river', 'karplusan forest', 'battlefield forge',
        'brushland', 'yavimaya coast',
        // Horizon lands (pay 1 life, draw a card)
        'horizon canopy', 'nurturing peatland', 'fiery islet', 'sunbaked canyon',
        'silent clearing', 'waterlogged grove',
      ]);
      
      const lowerName = cardName.toLowerCase();
      if ((isPainLand || PAIN_LANDS.has(lowerName)) && isTappingForColoredMana) {
        // Deal 1 damage to controller
        game.state.life = game.state.life || {};
        const startingLife = game.state.startingLife || 40;
        const currentLife = game.state.life[pid] ?? startingLife;
        game.state.life[pid] = currentLife - 1;
        
        // Sync to player object
        const player = (game.state.players || []).find((p: any) => p.id === pid);
        if (player) {
          player.life = game.state.life[pid];
        }
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${cardName} dealt 1 damage to ${getPlayerName(game, pid)} (${currentLife} → ${game.state.life[pid]}).`,
          ts: Date.now(),
        });
      }
      
      // ===== FORBIDDEN ORCHARD TRIGGER =====
      // "When you tap Forbidden Orchard for mana, target opponent creates a 1/1 colorless Spirit creature token."
      const lowerCardName = cardName.toLowerCase();
      if (lowerCardName === 'forbidden orchard') {
        // Get opponents from game.state.players
        const players = game.state?.players || [];
        const opponents = players.filter((p: any) => p?.id != null && p.id !== pid && !p.hasLost);
        
        if (opponents.length > 0) {
          // For AI players, auto-select a random opponent
          if (isAIPlayer(gameId, pid)) {
            // AI auto-selects a random opponent for the token
            const randomOpponent = opponents[Math.floor(Math.random() * opponents.length)];
            const targetOpponentId = randomOpponent.id;
            
            // Create 1/1 colorless Spirit token for the target opponent
            const tokenId = `token_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            game.state.battlefield = game.state.battlefield || [];
            const spiritToken = {
              id: tokenId,
              controller: targetOpponentId,
              owner: targetOpponentId,
              tapped: false,
              summoningSickness: true,
              counters: {},
              card: {
                id: tokenId,
                name: 'Spirit',
                type_line: 'Token Creature — Spirit',
                oracle_text: '',
                mana_cost: '',
                cmc: 0,
                colors: [],
              },
              basePower: 1,
              baseToughness: 1,
              isToken: true,
            };
            game.state.battlefield.push(spiritToken);
            
            debug(2, `[activateBattlefieldAbility] AI Forbidden Orchard: auto-selected ${targetOpponentId} to receive Spirit token`);
            
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `Forbidden Orchard: ${getPlayerName(game, targetOpponentId)} creates a 1/1 colorless Spirit token.`,
              ts: Date.now(),
            });
            
            // Continue with normal mana ability processing - don't return early
          } else {
            // Human player: store pending activation and request choice
            if (!(game.state as any).pendingForbiddenOrchard) {
              (game.state as any).pendingForbiddenOrchard = {};
            }
            
            const activationId = `forbidden_orchard_${crypto.randomUUID()}`;
            (game.state as any).pendingForbiddenOrchard[activationId] = {
              playerId: pid,
              permanentId,
              cardName: 'Forbidden Orchard',
              opponents: opponents.map((p: any) => ({ id: p.id, name: p.name })),
            };
            
            // Request opponent choice from player
            socket.emit("forbiddenOrchardTargetRequest", {
              gameId,
              activationId,
              permanentId,
              cardName: 'Forbidden Orchard',
              opponents: opponents.map((p: any) => ({
                id: p.id,
                name: p.name || p.id,
              })),
              message: "Choose target opponent to create a 1/1 colorless Spirit creature token.",
            });
            
            debug(2, `[activateBattlefieldAbility] Forbidden Orchard: prompting ${pid} to choose target opponent`);
            broadcastGame(io, game, gameId);
            return; // Exit early - wait for target selection
          }
        }
      }
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      // Broadcast mana pool update to ensure client sees the new floating mana
      broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`, game);
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateManaAbility", { playerId: pid, permanentId, abilityId, manaColor });
      
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle Doubling Cube: "{3}, {T}: Double the amount of each type of mana in your mana pool"
    if (cardName.toLowerCase().includes('doubling cube') || 
        (oracleText.includes('double') && oracleText.includes('mana') && oracleText.includes('mana pool'))) {
      // Validate: permanent must not be tapped
      if ((permanent as any).tapped) {
        socket.emit("error", {
          code: "ALREADY_TAPPED",
          message: `${cardName} is already tapped`,
        });
        return;
      }
      
      // Check if player can pay {3}
      const manaPool = game.state.manaPool[pid] || {
        white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
      };
      
      const totalMana = manaPool.white + manaPool.blue + manaPool.black + 
                        manaPool.red + manaPool.green + manaPool.colorless;
      
      if (totalMana < 3) {
        socket.emit("error", {
          code: "INSUFFICIENT_MANA",
          message: `Not enough mana to activate ${cardName}. Need {3}, have ${totalMana}`,
        });
        return;
      }
      
      // Consume {3} generic mana from pool (prioritize colorless, then colors)
      let remaining = 3;
      const poolCopy = { ...manaPool };
      
      // First use colorless
      const colorlessUsed = Math.min(remaining, poolCopy.colorless);
      poolCopy.colorless -= colorlessUsed;
      remaining -= colorlessUsed;
      
      // Then use colors if needed
      if (remaining > 0) {
        const colors = ['white', 'blue', 'black', 'red', 'green'] as const;
        for (const color of colors) {
          if (remaining <= 0) break;
          const used = Math.min(remaining, poolCopy[color]);
          poolCopy[color] -= used;
          remaining -= used;
        }
      }
      
      // Double all remaining mana in the pool
      game.state.manaPool[pid] = {
        white: poolCopy.white * 2,
        blue: poolCopy.blue * 2,
        black: poolCopy.black * 2,
        red: poolCopy.red * 2,
        green: poolCopy.green * 2,
        colorless: poolCopy.colorless * 2,
      };
      
      // Tap the permanent
      (permanent as any).tapped = true;
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} activated ${cardName}, doubling their mana pool.`,
        ts: Date.now(),
      });
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      // Broadcast mana pool update
      broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Activated ${cardName}`, game);
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateDoublingCube", { playerId: pid, permanentId });
      
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle planeswalker abilities (pw-ability-N)
    if (abilityId.startsWith("pw-ability-")) {
      // Parse ability index
      const abilityIndex = parseInt(abilityId.replace("pw-ability-", ""), 10);
      
      // Parse the planeswalker ability from oracle text
      // Scryfall oracle text uses plain format without brackets (e.g., "+1: Effect text")
      // The pattern matches various dash characters: regular minus (-), en dash (–), em dash (—), and Unicode minus (−)
      const pwAbilityPattern = /^([+−–—\-]?\d+):\s*(.+)/gm;
      const abilities: { loyaltyCost: number; text: string }[] = [];
      let pwMatch;
      while ((pwMatch = pwAbilityPattern.exec(oracleText)) !== null) {
        const costStr = pwMatch[1].replace(/[−–—]/g, '-');
        const cost = parseInt(costStr, 10);
        abilities.push({ loyaltyCost: cost, text: pwMatch[2].trim() });
      }
      
      if (abilityIndex < 0 || abilityIndex >= abilities.length) {
        socket.emit("error", {
          code: "INVALID_ABILITY",
          message: `Ability index ${abilityIndex} not found on ${cardName}`,
        });
        return;
      }
      
      const ability = abilities[abilityIndex];
      
      // Enqueue activation in the resolution queue for unified handling/ordering
      try {
        const step = ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.ACTIVATED_ABILITY,
          playerId: pid as PlayerID,
          description: `${cardName}: ${ability.text}`,
          mandatory: true,
          sourceId: permanentId,
          sourceName: cardName,
          legacyData: { abilityIndex, loyaltyCost: ability.loyaltyCost },
        });
        ResolutionQueueManager.completeStep(gameId, step.id, {
          stepId: step.id,
          playerId: pid as PlayerID,
          selections: abilityIndex,
          cancelled: false,
          timestamp: Date.now(),
        });
      } catch (e) {
        debugWarn(2, `[planeswalker] Failed to enqueue activation for ${cardName}:`, e);
      }
      
      // Get current loyalty
      const currentLoyalty = (permanent as any).counters?.loyalty || 0;
      const loyaltyCost = ability.loyaltyCost;
      
      // Check if we can pay the cost
      // For minus abilities, check we have enough loyalty
      if (loyaltyCost < 0 && currentLoyalty + loyaltyCost < 0) {
        socket.emit("error", {
          code: "INSUFFICIENT_LOYALTY",
          message: `${cardName} has ${currentLoyalty} loyalty, need at least ${Math.abs(loyaltyCost)} to activate this ability`,
        });
        return;
      }
      
      // Check if planeswalker has already activated an ability this turn
      // (Rule 606.3: Only one loyalty ability per turn per planeswalker)
      if ((permanent as any).loyaltyActivatedThisTurn) {
        socket.emit("error", {
          code: "LOYALTY_ALREADY_USED",
          message: `${cardName} has already activated a loyalty ability this turn`,
        });
        return;
      }
      
      // Apply loyalty cost
      const newLoyalty = currentLoyalty + loyaltyCost;
      (permanent as any).counters = (permanent as any).counters || {};
      (permanent as any).counters.loyalty = newLoyalty;
      (permanent as any).loyaltyActivatedThisTurn = true;
      
      // Put the loyalty ability on the stack
      const stackItem = {
        id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'ability' as const,
        controller: pid,
        source: permanentId,
        sourceName: cardName,
        description: ability.text,
      } as any;
      
      game.state.stack = game.state.stack || [];
      game.state.stack.push(stackItem);
      
      // Emit stack update
      io.to(gameId).emit("stackUpdate", {
        gameId,
        stack: (game.state.stack || []).map((s: any) => ({
          id: s.id,
          type: s.type,
          name: s.sourceName || s.card?.name || 'Ability',
          controller: s.controller,
          targets: s.targets,
          source: s.source,
          sourceName: s.sourceName,
          description: s.description,
        })),
      });
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activatePlaneswalkerAbility", { 
        playerId: pid, 
        permanentId, 
        abilityIndex, 
        loyaltyCost,
        newLoyalty,
      });
      
      const costSign = loyaltyCost >= 0 ? "+" : "";
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `⚡ ${getPlayerName(game, pid)} activated ${cardName}'s [${costSign}${loyaltyCost}] ability. (Loyalty: ${currentLoyalty} → ${newLoyalty})`,
        ts: Date.now(),
      });
      
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle other activated abilities - put them on the stack
    debug(2, `[activateBattlefieldAbility] Processing ability ${abilityId} on ${cardName}`);
    
    // Parse the ability from oracle text if possible
    // Ability ID format is: "{cardId}-{abilityType}-{index}" e.g., "card123-ability-0" or "card123-mana-r-0"
    // Extract the ability index from the end of the abilityId
    let abilityIndex = 0;
    const abilityMatch = abilityId.match(/-(\d+)$/);
    if (abilityMatch) {
      abilityIndex = parseInt(abilityMatch[1], 10);
      if (isNaN(abilityIndex)) abilityIndex = 0;
    }
    
    // Extract ability text by parsing oracle text for activated abilities
    let abilityText = "";
    let requiresTap = false;
    let manaCost = "";
    let sacrificeType: 'creature' | 'artifact' | 'enchantment' | 'land' | 'permanent' | 'self' | null = null;
    
    // Parse activated abilities: look for "cost: effect" patterns
    const abilityPattern = /([^:]+):\s*([^.]+\.?)/gi;
    const abilities: { cost: string; effect: string }[] = [];
    let match;
    while ((match = abilityPattern.exec(oracleText)) !== null) {
      const cost = match[1].trim();
      const effect = match[2].trim();
      // Filter out keyword abilities and keep only activated abilities
      if (cost.includes('{') || cost.toLowerCase().includes('tap') || cost.toLowerCase().includes('sacrifice')) {
        abilities.push({ cost, effect });
      }
    }
    
    if (abilityIndex < abilities.length) {
      const ability = abilities[abilityIndex];
      abilityText = ability.effect;
      requiresTap = ability.cost.toLowerCase().includes('{t}') || ability.cost.toLowerCase().includes('tap');
      manaCost = ability.cost;
      
      // Detect sacrifice type from cost using shared utility
      const sacrificeInfo = parseSacrificeCost(ability.cost);
      if (sacrificeInfo.requiresSacrifice && sacrificeInfo.sacrificeType) {
        sacrificeType = sacrificeInfo.sacrificeType;
      }
    } else {
      // FALLBACK: If parsing failed or abilityIndex is out of range, try to extract ability text from oracle
      // For cards with a single activated ability or when the client sends an unrecognized abilityId,
      // use the full oracle text to detect if it's a mana ability
      // This fixes double-clicking lands and creatures with mana abilities
      debug(1, `[activateBattlefieldAbility] Ability parsing failed or index out of range (${abilityIndex}/${abilities.length}), using oracle text as fallback`);
      
      // If there's only one ability parsed, use it
      if (abilities.length === 1) {
        const ability = abilities[0];
        abilityText = ability.effect;
        requiresTap = ability.cost.toLowerCase().includes('{t}') || ability.cost.toLowerCase().includes('tap');
        manaCost = ability.cost;
        
        const sacrificeInfo = parseSacrificeCost(ability.cost);
        if (sacrificeInfo.requiresSacrifice && sacrificeInfo.sacrificeType) {
          sacrificeType = sacrificeInfo.sacrificeType;
        }
      } else {
        // Use the full oracle text to check if this is a mana ability
        // This handles simple cases like basic lands: "{T}: Add {G}"
        abilityText = oracleText;
        requiresTap = oracleText.includes('{T}:') || oracleText.toLowerCase().includes('tap:');
      }
    }
    
    // Validate: if ability requires tap, permanent must not be tapped
    if (requiresTap && (permanent as any).tapped) {
      socket.emit("error", {
        code: "ALREADY_TAPPED",
        message: `${cardName} is already tapped`,
      });
      return;
    }
    
    // Check if sacrifice is required and we need to prompt for selection
    if (sacrificeType && sacrificeType !== 'self') {
      // Get eligible permanents for sacrifice
      const eligiblePermanents = battlefield.filter((p: any) => {
        if (p.controller !== pid) return false;
        const permTypeLine = (p.card?.type_line || '').toLowerCase();
        
        switch (sacrificeType) {
          case 'creature':
            return permTypeLine.includes('creature');
          case 'artifact':
            return permTypeLine.includes('artifact');
          case 'enchantment':
            return permTypeLine.includes('enchantment');
          case 'land':
            return permTypeLine.includes('land');
          case 'permanent':
            return true; // Any permanent
          default:
            return false;
        }
      });
      
      if (eligiblePermanents.length === 0) {
        socket.emit("error", {
          code: "NO_SACRIFICE_TARGET",
          message: `You don't control any ${sacrificeType}s to sacrifice.`,
        });
        return;
      }
      
      // Store pending ability activation and emit sacrifice selection request
      const pendingAbilityId = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      (game.state as any).pendingSacrificeAbility = (game.state as any).pendingSacrificeAbility || {};
      (game.state as any).pendingSacrificeAbility[pid] = {
        pendingId: pendingAbilityId,
        permanentId,
        abilityIndex,
        cardName,
        abilityText,
        manaCost,
        requiresTap,
        sacrificeType,
        effect: abilityText,
      };
      
      // Emit sacrifice selection request
      const sacrificeTargets = eligiblePermanents.map((p: any) => ({
        id: p.id,
        type: 'permanent' as const,
        name: p.card?.name || 'Unknown',
        imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
        typeLine: p.card?.type_line,
      }));
      
      emitToPlayer(io, pid, "abilitySacrificeRequest", {
        gameId,
        pendingId: pendingAbilityId,
        permanentId,
        cardName,
        abilityEffect: abilityText,
        sacrificeType,
        eligibleTargets: sacrificeTargets,
      });
      
      debug(2, `[activateBattlefieldAbility] ${cardName} requires sacrifice of a ${sacrificeType}. Waiting for selection from ${pid}`);
      return;
    }
    
    // Tap the permanent if required
    if (requiresTap && !(permanent as any).tapped) {
      (permanent as any).tapped = true;
    }
    
    // Parse and validate mana cost if present
    // Extract just the mana symbols from the cost string (excluding {T}, sacrifice, etc.)
    if (manaCost) {
      const manaSymbols = manaCost.match(/\{[WUBRGC0-9X]+\}/gi);
      if (manaSymbols) {
        // Filter out {T} and {Q} to get just the mana cost
        const manaOnly = manaSymbols.filter(s => 
          s.toUpperCase() !== '{T}' && s.toUpperCase() !== '{Q}'
        ).join('');
        
        if (manaOnly) {
          const parsedCost = parseManaCost(manaOnly);
          const manaPool = getOrInitManaPool(game.state, pid);
          const totalAvailable = calculateTotalAvailableMana(manaPool, undefined);
          
          // Validate payment
          const validationError = validateManaPayment(
            totalAvailable,
            parsedCost.colors,
            parsedCost.generic
          );
          
          if (validationError) {
            socket.emit("error", {
              code: "INSUFFICIENT_MANA",
              message: validationError,
            });
            return;
          }
          
          // Consume the mana from the pool
          consumeManaFromPool(manaPool, parsedCost.colors, parsedCost.generic);
          
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `${getPlayerName(game, pid)} paid ${manaOnly} to activate ${cardName}.`,
            ts: Date.now(),
          });
        }
      }
    }
    
    // Check if this is a mana ability (doesn't use the stack)
    // Mana abilities are abilities that produce mana and don't target
    // IMPORTANT: Check the specific ability text, NOT the entire oracle text
    // This fixes cards like Herd Heirloom which have both mana AND non-mana tap abilities
    // 
    // Per MTG Rule 605.1a, a mana ability is an activated ability that:
    // - Could add mana to a player's mana pool when it resolves
    // - Isn't a loyalty ability (checked earlier)
    // - Doesn't target
    // 
    // Pattern matches:
    // - "Add {W}", "Add {G}{G}", etc. (specific mana symbols including {C} for colorless)
    // - "Add one mana", "Add two mana", etc.
    // - "Add mana of any color", "Add any color"
    // - "Add X mana" (variable mana)
    // - "Add an amount of {G}" (Karametra's Acolyte, etc.)
    // - "Add X mana in any combination" (Selvala, Nykthos, etc.)
    const isManaAbility = /add\s+(\{[wubrgc]\}|\{[wubrgc]\}\{[wubrgc]\}|one mana|two mana|three mana|mana of any|any color|[xX] mana|an amount of|mana in any combination)/i.test(abilityText) && 
                          !/target/i.test(abilityText);
    
    if (!isManaAbility) {
      // Check if this is a tutor effect (searches library)
      const tutorInfo = detectTutorEffect(abilityText);
      
      if (tutorInfo.isTutor) {
        // This is a tutor effect - handle library search
        const filter = parseSearchCriteria(tutorInfo.searchCriteria || "");
        const library = game.searchLibrary ? game.searchLibrary(pid, "", 1000) : [];
        
        // Put the ability on the stack first
        const stackItem = {
          id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'ability' as const,
          controller: pid,
          source: permanentId,
          sourceName: cardName,
          description: abilityText,
          abilityType: 'tutor',
          searchParams: {
            filter,
            searchCriteria: tutorInfo.searchCriteria,
            maxSelections: tutorInfo.maxSelections || 1,
            destination: tutorInfo.destination || 'hand',
            entersTapped: tutorInfo.entersTapped,
            splitDestination: tutorInfo.splitDestination,
            toBattlefield: tutorInfo.toBattlefield,
            toHand: tutorInfo.toHand,
          },
        } as any;
        
        game.state.stack = game.state.stack || [];
        game.state.stack.push(stackItem);
        
        if (typeof game.bumpSeq === "function") {
          game.bumpSeq();
        }
        
        appendEvent(gameId, (game as any).seq ?? 0, "activateTutorAbility", { 
          playerId: pid, 
          permanentId, 
          abilityId,
          cardName,
          stackId: stackItem.id,
        });
        
        // Emit stack update
        io.to(gameId).emit("stackUpdate", {
          gameId,
          stack: (game.state.stack || []).map((s: any) => ({
            id: s.id,
            type: s.type,
            name: s.sourceName || s.card?.name || 'Ability',
            controller: s.controller,
            targets: s.targets,
            source: s.source,
            sourceName: s.sourceName,
            description: s.description,
          })),
        });
        
        // Emit library search request
        if (tutorInfo.splitDestination) {
          socket.emit("librarySearchRequest", {
            gameId,
            cards: library,
            title: `${cardName}`,
            description: tutorInfo.searchCriteria ? `Search for: ${tutorInfo.searchCriteria}` : "Search your library",
            filter,
            maxSelections: tutorInfo.maxSelections || 2,
            moveTo: "split",
            splitDestination: true,
            toBattlefield: tutorInfo.toBattlefield || 1,
            toHand: tutorInfo.toHand || 1,
            entersTapped: tutorInfo.entersTapped,
            shuffleAfter: true,
          });
        } else {
          socket.emit("librarySearchRequest", {
            gameId,
            cards: library,
            title: `${cardName}`,
            description: tutorInfo.searchCriteria ? `Search for: ${tutorInfo.searchCriteria}` : "Search your library",
            filter,
            maxSelections: tutorInfo.maxSelections || 1,
            moveTo: tutorInfo.destination || "hand",
            entersTapped: tutorInfo.entersTapped,
            shuffleAfter: true,
          });
        }
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `⚡ ${getPlayerName(game, pid)} activated ${cardName}'s ability. Ability on the stack.`,
          ts: Date.now(),
        });
        
        broadcastGame(io, game, gameId);
        return; // Early return - library search will handle the rest
      }
      
      // Not a tutor - put the ability on the stack normally
      const stackItem = {
        id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'ability' as const,
        controller: pid,
        source: permanentId,
        sourceName: cardName,
        description: abilityText,
      } as any;
      
      game.state.stack = game.state.stack || [];
      game.state.stack.push(stackItem);
      
      // Emit stack update
      io.to(gameId).emit("stackUpdate", {
        gameId,
        stack: (game.state.stack || []).map((s: any) => ({
          id: s.id,
          type: s.type,
          name: s.sourceName || s.card?.name || 'Ability',
          controller: s.controller,
          targets: s.targets,
          source: s.source,
          sourceName: s.sourceName,
          description: s.description,
        })),
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `⚡ ${getPlayerName(game, pid)} activated ${cardName}'s ability: ${abilityText}`,
        ts: Date.now(),
      });
    } else {
      // ========================================================================
      // MANA ABILITY - Handle immediately without using the stack
      // Must actually add mana to the pool, accounting for:
      // - Mana multipliers (Mana Reflection, Nyxbloom Ancient)
      // - Extra mana effects (Nissa, Crypt Ghast)
      // - Devotion-based abilities (Karametra's Acolyte)
      // - Creature-count abilities (Priest of Titania, Elvish Archdruid)
      // ========================================================================
      
      // Initialize mana pool if needed
      game.state.manaPool = game.state.manaPool || {};
      game.state.manaPool[pid] = game.state.manaPool[pid] || {
        white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
      };
      
      const colorToPoolKey: Record<string, string> = {
        'W': 'white',
        'U': 'blue',
        'B': 'black',
        'R': 'red',
        'G': 'green',
        'C': 'colorless',
      };
      
      const isLand = typeLine.includes("land");
      const isBasic = typeLine.includes("basic");
      
      // Check for devotion-based mana abilities (Karametra's Acolyte, etc.)
      const devotionMana = getDevotionManaAmount(game.state, permanent, pid);
      
      // Check for creature-count-based mana abilities (Priest of Titania, etc.)
      const creatureCountMana = getCreatureCountManaAmount(game.state, permanent, pid);
      
      // Get mana multiplier
      const manaMultiplier = getManaMultiplier(game.state, permanent, pid);
      
      // Check for Virtue of Strength (only affects basic lands)
      let effectiveMultiplier = manaMultiplier;
      if (manaMultiplier > 1 && !isBasic && isLand) {
        const modifiers = detectManaModifiers(game.state, pid);
        const virtueModifier = modifiers.find(m => 
          m.cardName.toLowerCase().includes('virtue of strength') && 
          m.type === 'mana_multiplier'
        );
        if (virtueModifier) {
          const otherMultiplier = modifiers
            .filter(m => m.type === 'mana_multiplier' && m.cardName !== virtueModifier.cardName)
            .reduce((acc, m) => acc * (m.multiplier || 1), 1);
          effectiveMultiplier = otherMultiplier;
        }
      }
      
      // Handle devotion-based mana
      if (devotionMana && devotionMana.amount > 0) {
        const totalAmount = devotionMana.amount * effectiveMultiplier;
        const poolKey = colorToPoolKey[devotionMana.color] || 'green';
        (game.state.manaPool[pid] as any)[poolKey] += totalAmount;
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: effectiveMultiplier > 1 
            ? `${getPlayerName(game, pid)} tapped ${cardName} for ${totalAmount} {${devotionMana.color}} mana (devotion ${devotionMana.amount} × ${effectiveMultiplier}).`
            : `${getPlayerName(game, pid)} tapped ${cardName} for ${totalAmount} {${devotionMana.color}} mana (devotion: ${devotionMana.amount}).`,
          ts: Date.now(),
        });
        
        broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`, game);
      }
      // Handle creature-count-based mana
      else if (creatureCountMana && creatureCountMana.amount > 0) {
        const totalAmount = creatureCountMana.amount * effectiveMultiplier;
        
        if (creatureCountMana.color === 'any_combination' || creatureCountMana.color.startsWith('combination:')) {
          // Store pending mana activation for when player selects color
          if (!game.state.pendingManaActivations) {
            game.state.pendingManaActivations = {};
          }
          const activationId = `mana_${crypto.randomUUID()}`;
          game.state.pendingManaActivations[activationId] = {
            playerId: pid,
            permanentId,
            cardName,
            amount: totalAmount,
          };
          
          // Request color choice from player
          socket.emit("anyColorManaChoice", {
            gameId,
            activationId,
            permanentId,
            cardName,
            amount: totalAmount,
            cardImageUrl: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
          });
          
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `${getPlayerName(game, pid)} tapped ${cardName} for ${totalAmount} mana (choose colors).`,
            ts: Date.now(),
          });
          
          broadcastGame(io, game, gameId);
          return; // Exit early - wait for color choice
        } else {
          const poolKey = colorToPoolKey[creatureCountMana.color] || 'green';
          (game.state.manaPool[pid] as any)[poolKey] += totalAmount;
          
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: effectiveMultiplier > 1 
              ? `${getPlayerName(game, pid)} tapped ${cardName} for ${totalAmount} {${creatureCountMana.color}} mana (count ${creatureCountMana.amount} × ${effectiveMultiplier}).`
              : `${getPlayerName(game, pid)} tapped ${cardName} for ${totalAmount} {${creatureCountMana.color}} mana.`,
            ts: Date.now(),
          });
          
          broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`, game);
        }
      }
      // Handle standard mana abilities
      else {
        // Get mana abilities for this permanent
        const manaAbilities = getManaAbilitiesForPermanent(game.state, permanent, pid);
        
        if (manaAbilities.length > 0) {
          const ability = manaAbilities[0];
          const produces = ability.produces || [];
          
          if (produces.length > 0) {
            // ========================================================================
            // Check if this ability produces ALL colors at once (like bounce lands)
            // If producesAllAtOnce is true, add all mana at once without prompting
            // ========================================================================
            if (ability.producesAllAtOnce && produces.length > 1) {
              // Multi-mana producer like Rakdos Carnarium - add ALL colors at once
              const manaAdded: string[] = [];
              
              for (const manaColor of produces) {
                const poolKey = colorToPoolKey[manaColor] || 'colorless';
                (game.state.manaPool[pid] as any)[poolKey] += effectiveMultiplier;
                manaAdded.push(`{${manaColor}}`);
              }
              
              const manaStr = manaAdded.join('');
              let message = `${getPlayerName(game, pid)} tapped ${cardName} for ${manaStr}`;
              if (effectiveMultiplier > 1) {
                message += ` (×${effectiveMultiplier})`;
              }
              message += '.';
              
              io.to(gameId).emit("chat", {
                id: `m_${Date.now()}`,
                gameId,
                from: "system",
                message,
                ts: Date.now(),
              });
              
              // Broadcast mana pool update
              broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`, game);
            }
            // If produces multiple colors but NOT all at once (like "any color"), prompt user for choice
            else if (produces.length > 1) {
              // Multi-color production - emit choice to player
              const baseAmount = 1;
              const totalAmount = baseAmount * effectiveMultiplier;
              
              // Get extra mana from effects
              const extraMana = getExtraManaProduction(game.state, permanent, pid, produces[0]);
              const totalExtra = extraMana.reduce((acc, e) => acc + e.amount, 0);
              const finalTotal = totalAmount + totalExtra;
              
              // Store pending mana activation for when player selects color
              if (!game.state.pendingManaActivations) {
                game.state.pendingManaActivations = {};
              }
              const activationId = `mana_${crypto.randomUUID()}`;
              game.state.pendingManaActivations[activationId] = {
                playerId: pid,
                permanentId,
                cardName,
                amount: finalTotal,
              };
              
              // Request color choice from player
              socket.emit("anyColorManaChoice", {
                gameId,
                activationId,
                permanentId,
                cardName,
                amount: finalTotal,
                cardImageUrl: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
              });
              
              io.to(gameId).emit("chat", {
                id: `m_${Date.now()}`,
                gameId,
                from: "system",
                message: `${getPlayerName(game, pid)} tapped ${cardName} for mana (choose color).`,
                ts: Date.now(),
              });
              
              broadcastGame(io, game, gameId);
              return; // Exit early - wait for color choice
            } else {
              // Single color production
              const manaColor = produces[0];
              const poolKey = colorToPoolKey[manaColor] || 'colorless';
              
              const baseAmount = 1;
              let totalAmount = baseAmount * effectiveMultiplier;
              
              // Apply extra mana from effects
              const extraMana = getExtraManaProduction(game.state, permanent, pid, manaColor);
              for (const extra of extraMana) {
                const extraPoolKey = colorToPoolKey[extra.color] || poolKey;
                (game.state.manaPool[pid] as any)[extraPoolKey] += extra.amount;
                totalAmount += extra.amount;
              }
              
              // Add the base mana (after multiplier)
              (game.state.manaPool[pid] as any)[poolKey] += baseAmount * effectiveMultiplier;
              
              // Generate descriptive message
              let message = `${getPlayerName(game, pid)} tapped ${cardName}`;
              if (effectiveMultiplier > 1 && extraMana.length > 0) {
                message += ` for ${totalAmount} {${manaColor}} mana (×${effectiveMultiplier} + ${extraMana.length} extra).`;
              } else if (effectiveMultiplier > 1) {
                message += ` for ${totalAmount} {${manaColor}} mana (×${effectiveMultiplier}).`;
              } else if (extraMana.length > 0) {
                message += ` for ${totalAmount} {${manaColor}} mana (+${extraMana.reduce((a, e) => a + e.amount, 0)} extra).`;
              } else {
                message += ` for {${manaColor}} mana.`;
              }
              
              io.to(gameId).emit("chat", {
                id: `m_${Date.now()}`,
                gameId,
                from: "system",
                message,
                ts: Date.now(),
              });
              
              broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`, game);
            }
          } else {
            // No mana production detected - just emit message
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `${getPlayerName(game, pid)} activated ${cardName}'s mana ability.`,
              ts: Date.now(),
            });
          }
        } else {
          // Fallback - mana ability detected but couldn't parse production
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `${getPlayerName(game, pid)} activated ${cardName}'s mana ability.`,
            ts: Date.now(),
          });
        }
      }
    }
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "activateBattlefieldAbility", { 
      playerId: pid, 
      permanentId, 
      abilityId,
      cardName,
      abilityText,
    });
    
    broadcastGame(io, game, gameId);
  });



  /**
   * Entrapment Maneuver sacrifice selection
   * When target player chooses which attacking creature to sacrifice
   */
  socket.on("entrapmentManeuverSelect", ({ gameId, creatureId }: {
    gameId: string;
    creatureId: string;
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    
    // Check if there's a pending Entrapment Maneuver for this player
    const pending = (game.state as any)?.pendingEntrapmentManeuver?.[pid];
    if (!pending) {
      socket.emit("error", {
        code: "NO_PENDING_MANEUVER",
        message: "No Entrapment Maneuver pending for you",
      });
      return;
    }
    
    // Find the creature on battlefield
    const battlefield = game.state?.battlefield || [];
    const creature = battlefield.find((p: any) => p?.id === creatureId && p?.controller === pid);
    
    if (!creature) {
      socket.emit("error", {
        code: "CREATURE_NOT_FOUND",
        message: "Creature not found or not controlled by you",
      });
      return;
    }
    
    // Verify the creature is attacking
    if (!creature.attacking) {
      socket.emit("error", {
        code: "NOT_ATTACKING",
        message: "That creature is not attacking",
      });
      return;
    }
    
    const creatureCard = (creature as any).card || {};
    const creatureName = (creatureCard as any).name || "Unknown Creature";
    
    // Get the creature's toughness for token creation
    // Handle variable toughness values like '*' or 'X' by treating them as 0
    const toughnessStr = String((creature as any).baseToughness ?? (creatureCard as any).toughness ?? "0");
    let toughness: number;
    if (toughnessStr === '*' || toughnessStr.toLowerCase() === 'x') {
      // Variable toughness - use any counters or modifiers to determine value
      const plusCounters = ((creature as any).counters?.['+1/+1']) || 0;
      const minusCounters = ((creature as any).counters?.['-1/-1']) || 0;
      toughness = plusCounters - minusCounters;
    } else {
      toughness = parseInt(toughnessStr.replace(/\D.*$/, ''), 10) || 0;
    }
    
    // Apply any toughness modifiers
    if ((creature as any).tempToughnessMod) {
      toughness += (creature as any).tempToughnessMod;
    }
    
    // Ensure toughness is at least 0 for token creation
    toughness = Math.max(0, toughness);
    
    // Get the caster of Entrapment Maneuver (who gets the tokens)
    const caster = pending.caster as string;
    
    // Sacrifice the creature (move to graveyard)
    const idx = battlefield.findIndex((p: any) => p.id === creatureId);
    if (idx >= 0) {
      battlefield.splice(idx, 1);
      
      // Move to owner's graveyard
      const owner = creature.owner || creature.controller;
      const zones = (game.state as any).zones = (game.state as any).zones || {};
      const ownerZone = zones[owner] = zones[owner] || { hand: [], graveyard: [], handCount: 0, graveyardCount: 0 };
      ownerZone.graveyard = ownerZone.graveyard || [];
      ownerZone.graveyard.push({ ...creatureCard, zone: "graveyard" });
      ownerZone.graveyardCount = ownerZone.graveyard.length;
    }
    
    // Create Soldier tokens for the caster equal to the sacrificed creature's toughness
    if (toughness > 0) {
      game.state.battlefield = game.state.battlefield || [];
      
      for (let i = 0; i < toughness; i++) {
        const tokenId = generateId("tok");
        game.state.battlefield.push({
          id: tokenId,
          controller: caster,
          owner: caster,
          tapped: false,
          counters: {},
          isToken: true,
          basePower: 1,
          baseToughness: 1,
          card: {
            id: tokenId,
            name: "Soldier",
            type_line: "Token Creature — Soldier",
            power: "1",
            toughness: "1",
            zone: "battlefield",
          },
        } as any);
      }
      
      debug(2, `[entrapmentManeuverSelect] Created ${toughness} Soldier token(s) for ${caster}`);
    }
    
    // Clear the pending Entrapment Maneuver
    delete (game.state as any).pendingEntrapmentManeuver[pid];
    if (Object.keys((game.state as any).pendingEntrapmentManeuver).length === 0) {
      delete (game.state as any).pendingEntrapmentManeuver;
    }
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "entrapmentManeuverSelect", {
      playerId: pid,
      caster,
      sacrificedCreatureId: creatureId,
      sacrificedCreatureName: creatureName,
      tokensCreated: toughness,
    });
    
    // Emit chat messages
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} sacrificed ${creatureName} (toughness ${toughness}).`,
      ts: Date.now(),
    });
    
    if (toughness > 0) {
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}_tokens`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, caster)} created ${toughness} 1/1 white Soldier creature token${toughness !== 1 ? 's' : ''}.`,
        ts: Date.now(),
      });
    }
    
    broadcastGame(io, game, gameId);
  });

  // Target selection confirmation
  socket.on("targetSelectionConfirm", ({ gameId, effectId, selectedTargetIds, targets }: {
    gameId: string;
    effectId?: string;
    selectedTargetIds?: string[];
    targets?: string[];  // Client sends 'targets' instead of 'selectedTargetIds'
  }) => {
    debug(2, `[targetSelectionConfirm] ======== CONFIRM START ========`);
    debug(2, `[targetSelectionConfirm] gameId: ${gameId}, effectId: ${effectId}`);
    debug(2, `[targetSelectionConfirm] selectedTargetIds: ${JSON.stringify(selectedTargetIds)}`);
    debug(2, `[targetSelectionConfirm] targets: ${JSON.stringify(targets)}`);
    
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) {
      debug(1, `[targetSelectionConfirm] ERROR: No playerId or is spectator`);
      return;
    }

    const game = ensureGame(gameId);
    debug(2, `[targetSelectionConfirm] playerId: ${pid}`);
    
    // CRITICAL FIX: Accept both 'selectedTargetIds' (old) and 'targets' (current client)
    // Ensure selectedTargetIds is a valid array (defensive check for malformed payloads)
    const targetIds = Array.isArray(selectedTargetIds) ? selectedTargetIds : 
                      Array.isArray(targets) ? targets : [];
    debug(1, `[targetSelectionConfirm] Validated targetIds: ${targetIds.join(',')}`);
    
    if (targetIds.length === 0) {
      debugWarn(1, `[targetSelectionConfirm] WARNING: No targets provided by client!`);
    }
    // Store targets for the pending effect/spell
    // This will be used when the spell/ability resolves
    game.state.pendingTargets = game.state.pendingTargets || {};
    game.state.pendingTargets[effectId || 'default'] = {
      playerId: pid,
      targetIds: targetIds,
    };
    debug(2, `[targetSelectionConfirm] Stored targets in pendingTargets[${effectId}]`);
    
    // =========================================================================
    // AUTO-UNIGNORE: Remove targeted permanents from ignore list
    // When a permanent becomes the target of an opponent's spell/ability,
    // automatically remove it from the ignore list so the player can respond.
    // =========================================================================
    const stateAny = game.state as any;
    if (stateAny.ignoredCardsForAutoPass) {
      const battlefield = game.state.battlefield || [];
      
      for (const targetId of targetIds) {
        // Find the target permanent
        const targetPerm = battlefield.find((p: any) => p.id === targetId);
        if (!targetPerm) continue;
        
        // Check if this is a permanent controlled by another player
        const targetController = targetPerm.controller;
        if (targetController && targetController !== pid) {
          // Check if the target is in the controller's ignore list
          const controllerIgnored = stateAny.ignoredCardsForAutoPass[targetController];
          if (controllerIgnored && controllerIgnored[targetId]) {
            const cardName = controllerIgnored[targetId].cardName;
            delete controllerIgnored[targetId];
            
            debug(2, `[targetSelectionConfirm] Auto-unignored ${cardName} (${targetId}) - targeted by opponent's spell`);
            
            // Notify the controller that their card was auto-unignored
            emitToPlayer(io, targetController, "cardUnignoredAutomatically", {
              gameId,
              playerId: targetController,
              permanentId: targetId,
              cardName,
              reason: "targeted by opponent's spell or ability",
            });
            
            // Send updated ignored cards list to the controller
            const updatedList = Object.entries(controllerIgnored).map(([id, data]: [string, any]) => ({
              permanentId: id,
              cardName: data.cardName,
              imageUrl: data.imageUrl,
            }));
            
            emitToPlayer(io, targetController, "ignoredCardsUpdated", {
              gameId,
              playerId: targetController,
              ignoredCards: updatedList,
            });
          }
        }
      }
    }
    
    // Check if this is a spell cast that was waiting for targets (via requestCastSpell)
    // effectId format is "cast_${cardId}_${timestamp}"
    if (effectId && effectId.startsWith('cast_')) {
      // Check if we have pending spell cast info
      const pendingCast = (game.state as any).pendingSpellCasts?.[effectId];
      
      if (pendingCast) {
        // MTG Rule 601.2c - Validate that selected targets are in the valid list
        // This prevents clients from selecting invalid targets
        const validTargetIds = pendingCast.validTargetIds || [];
        // Use Set for O(1) lookup instead of O(n) with Array.includes
        const validTargetSet = new Set(validTargetIds);
        const invalidTargets = targetIds.filter((t: string) => !validTargetSet.has(t));
        
        if (invalidTargets.length > 0) {
          debugWarn(1, `[targetSelectionConfirm] Invalid targets selected: ${invalidTargets.join(', ')} for ${pendingCast.cardName}`);
          
          // Clean up pending spell cast to prevent loops
          delete (game.state as any).pendingSpellCasts[effectId];
          
          socket.emit("error", {
            code: "INVALID_TARGETS",
            message: `Invalid targets selected for ${pendingCast.cardName}. The targets don't meet the spell's requirements.`,
          });
          return;
        }
        
        // MTG Rule 601.2h: After targets chosen, now request payment
        debug(2, `[targetSelectionConfirm] Targets selected for ${pendingCast.cardName}, now requesting payment`);
        debug(1, `[targetSelectionConfirm] Storing targets in pendingCast.targets: ${targetIds.join(',')}`);
        
        // Store targets with the pending cast
        pendingCast.targets = targetIds;
        
        // Emit payment required event
        emitToPlayer(io, pid as string, "paymentRequired", {
          gameId,
          cardId: pendingCast.cardId,
          cardName: pendingCast.cardName,
          manaCost: pendingCast.manaCost,
          effectId,
          targets: targetIds,
        });
        
        debug(2, `[targetSelectionConfirm] Emitted paymentRequired to ${pid}`);
        debug(2, `[targetSelectionConfirm] ======== CONFIRM END (waiting for payment) ========`);
      } else {
        // Legacy flow - old-style cast that bypassed requestCastSpell
        // Keep the old behavior for backward compatibility
        const parts = effectId.split('_');
        if (parts.length >= 2) {
          const cardId = parts.slice(1, -1).join('_');
          
          debug(1, `[targetSelectionConfirm] Legacy spell cast with targets: cardId=${cardId}, targets=${targetIds.join(',')}`);
          
          if (typeof game.applyEvent === 'function') {
            game.applyEvent({ type: "castSpell", playerId: pid, cardId, targets: targetIds });
            debug(2, `[targetSelectionConfirm] Spell ${cardId} cast with targets via applyEvent (legacy)`);
          }
        }
      }
    }
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "targetSelectionConfirm", {
      playerId: pid,
      effectId,
      selectedTargetIds: targetIds,
    });
    
    debug(2, `[targetSelectionConfirm] Player ${pid} selected targets:`, targetIds);
    
    broadcastGame(io, game, gameId);
  });

  // Target selection cancel
  socket.on("targetSelectionCancel", ({ gameId, effectId }: {
    gameId: string;
    effectId?: string;
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    
    // Clean up pending state to prevent loops when casting is cancelled
    // This fixes the Bear Umbra issue where cancelling kept looping between target and payment
    if (effectId && (game.state as any).pendingSpellCasts?.[effectId]) {
      delete (game.state as any).pendingSpellCasts[effectId];
      debug(2, `[targetSelectionCancel] Cleaned up pending spell cast for effectId: ${effectId}`);
    }
    
    // Also clean up pending targets if stored
    if (effectId && game.state.pendingTargets?.[effectId]) {
      delete game.state.pendingTargets[effectId];
    }
    
    debug(2, `[targetSelectionCancel] Player ${pid} cancelled target selection for effect ${effectId}`);
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} cancelled target selection.`,
      ts: Date.now(),
    });
    
    broadcastGame(io, game, gameId);
  });

  // ============================================================================
  // Crew Ability Confirmation (for Vehicles)
  // ============================================================================

  /**
   * Handle crew selection confirmation for vehicles
   * Player selects creatures to tap with total power >= crew requirement
   */
  socket.on("crewConfirm", ({
    gameId,
    vehicleId,
    creatureIds,
  }: {
    gameId: string;
    vehicleId: string;
    creatureIds: string[];
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", {
        code: "GAME_NOT_FOUND",
        message: "Game not found",
      });
      return;
    }

    const battlefield = game.state.battlefield || [];
    
    // Find the vehicle
    const vehicle = battlefield.find((p: any) => p.id === vehicleId && p.controller === pid);
    if (!vehicle) {
      socket.emit("error", {
        code: "VEHICLE_NOT_FOUND",
        message: "Vehicle not found",
      });
      return;
    }

    const vehicleName = (vehicle as any).card?.name || "Vehicle";
    const oracleText = ((vehicle as any).card?.oracle_text || "").toLowerCase();
    
    // Parse crew power requirement
    const crewMatch = oracleText.match(/crew\s*(\d+)/i);
    const crewPower = crewMatch ? parseInt(crewMatch[1], 10) : 0;

    // Find and validate selected creatures
    let totalPower = 0;
    const crewingCreatures: any[] = [];
    
    for (const creatureId of creatureIds) {
      const creature = battlefield.find((p: any) => 
        p.id === creatureId && p.controller === pid
      );
      
      if (!creature) {
        socket.emit("error", {
          code: "CREATURE_NOT_FOUND",
          message: "One or more selected creatures not found",
        });
        return;
      }
      
      const typeLine = ((creature as any).card?.type_line || "").toLowerCase();
      if (!typeLine.includes("creature")) {
        socket.emit("error", {
          code: "NOT_A_CREATURE",
          message: `${(creature as any).card?.name} is not a creature`,
        });
        return;
      }
      
      if ((creature as any).tapped) {
        socket.emit("error", {
          code: "CREATURE_TAPPED",
          message: `${(creature as any).card?.name} is already tapped`,
        });
        return;
      }
      
      totalPower += getEffectivePower(creature);
      crewingCreatures.push(creature);
    }

    // Validate total power meets requirement
    if (totalPower < crewPower) {
      socket.emit("error", {
        code: "INSUFFICIENT_POWER",
        message: `Total power ${totalPower} is less than crew requirement ${crewPower}`,
      });
      return;
    }

    // Tap all crewing creatures
    const creatureNames: string[] = [];
    for (const creature of crewingCreatures) {
      (creature as any).tapped = true;
      creatureNames.push((creature as any).card?.name || "Creature");
    }

    // Mark vehicle as crewed (becomes a creature until end of turn)
    (vehicle as any).crewed = true;
    (vehicle as any).grantedTypes = (vehicle as any).grantedTypes || [];
    if (!(vehicle as any).grantedTypes.includes('Creature')) {
      (vehicle as any).grantedTypes.push('Creature');
    }

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `🚗 ${getPlayerName(game, pid)} crewed ${vehicleName} with ${creatureNames.join(', ')} (total power: ${totalPower}). ${vehicleName} is now a creature until end of turn.`,
      ts: Date.now(),
    });

    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }

    broadcastGame(io, game, gameId);
  });

  // ============================================================================
  // Ability Sacrifice Selection (for Ashnod's Altar, Phyrexian Altar, etc.)
  // ============================================================================

  /**
   * Handle sacrifice selection for activated abilities that require sacrificing a permanent
   * This is used when abilities like "Sacrifice a creature: Add {C}{C}" need to know
   * which creature to sacrifice
   */
  socket.on("abilitySacrificeConfirm", ({
    gameId,
    pendingId,
    sacrificeTargetId,
  }: {
    gameId: string;
    pendingId: string;
    sacrificeTargetId: string;
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", {
        code: "GAME_NOT_FOUND",
        message: "Game not found",
      });
      return;
    }

    // Get the pending ability activation
    const pending = (game.state as any).pendingSacrificeAbility?.[pid];
    if (!pending || pending.pendingId !== pendingId) {
      socket.emit("error", {
        code: "INVALID_PENDING_ABILITY",
        message: "No pending ability activation found",
      });
      return;
    }

    // Clear the pending state
    delete (game.state as any).pendingSacrificeAbility[pid];

    const battlefield = game.state.battlefield || [];
    
    // Find and remove the sacrificed permanent
    const sacrificeIndex = battlefield.findIndex((p: any) => p.id === sacrificeTargetId && p.controller === pid);
    if (sacrificeIndex === -1) {
      socket.emit("error", {
        code: "SACRIFICE_TARGET_NOT_FOUND",
        message: "Sacrifice target not found",
      });
      return;
    }

    const sacrificed = battlefield.splice(sacrificeIndex, 1)[0];
    const sacrificedCard = (sacrificed as any).card;
    const sacrificedName = sacrificedCard?.name || "Unknown";

    // Move sacrificed permanent to graveyard
    const zones = game.state.zones?.[pid];
    if (zones) {
      zones.graveyard = zones.graveyard || [];
      (zones.graveyard as any[]).push({ ...sacrificedCard, zone: 'graveyard' });
      zones.graveyardCount = (zones.graveyard as any[]).length;
    }

    // Find the source permanent and tap it if required
    const sourcePerm = battlefield.find((p: any) => p.id === pending.permanentId);
    if (sourcePerm && pending.requiresTap && !(sourcePerm as any).tapped) {
      (sourcePerm as any).tapped = true;
    }

    // Check if this is a mana ability (doesn't use the stack)
    const oracleText = (sourcePerm as any)?.card?.oracle_text || pending.effect || "";
    const isManaAbility = /add\s*(\{[wubrgc]\}|mana|one mana|two mana|three mana)/i.test(oracleText);

    if (!isManaAbility) {
      // Put the ability on the stack
      const stackItem = {
        id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'ability' as const,
        controller: pid,
        source: pending.permanentId,
        sourceName: pending.cardName,
        description: pending.abilityText,
        sacrificedPermanent: {
          id: sacrificeTargetId,
          name: sacrificedName,
        },
      } as any;

      game.state.stack = game.state.stack || [];
      game.state.stack.push(stackItem);

      // Emit stack update
      io.to(gameId).emit("stackUpdate", {
        gameId,
        stack: (game.state.stack || []).map((s: any) => ({
          id: s.id,
          type: s.type,
          name: s.sourceName || s.card?.name || 'Ability',
          controller: s.controller,
          targets: s.targets,
          source: s.source,
          sourceName: s.sourceName,
          description: s.description,
        })),
      });

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `⚡ ${getPlayerName(game, pid)} activated ${pending.cardName}'s ability (sacrificed ${sacrificedName}): ${pending.abilityText}`,
        ts: Date.now(),
      });
    } else {
      // Mana ability - handle immediately without stack
      // Extract mana production and add to mana pool
      const manaMatch = oracleText.match(/add\s+(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
      if (manaMatch) {
        const manaStr = manaMatch[1];
        (game.state as any).manaPool = (game.state as any).manaPool || {};
        (game.state as any).manaPool[pid] = (game.state as any).manaPool[pid] || { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
        
        // Parse and add mana
        const manaRegex = /\{([WUBRGC])\}/gi;
        let manaSymbol;
        while ((manaSymbol = manaRegex.exec(manaStr)) !== null) {
          const color = manaSymbol[1].toUpperCase();
          if ((game.state as any).manaPool[pid][color] !== undefined) {
            (game.state as any).manaPool[pid][color]++;
          }
        }
      }

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} activated ${pending.cardName} (sacrificed ${sacrificedName}) for mana.`,
        ts: Date.now(),
      });
    }

    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }

    appendEvent(gameId, (game as any).seq ?? 0, "abilitySacrificeConfirm", {
      playerId: pid,
      pendingId,
      permanentId: pending.permanentId,
      sacrificeTargetId,
      sacrificedName,
    });

    broadcastGame(io, game, gameId);
  });

  /**
   * Cancel ability activation that required sacrifice
   */
  socket.on("abilitySacrificeCancel", ({
    gameId,
    pendingId,
  }: {
    gameId: string;
    pendingId: string;
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    if (!game) return;

    // Clear the pending state
    if ((game.state as any).pendingSacrificeAbility?.[pid]?.pendingId === pendingId) {
      const pending = (game.state as any).pendingSacrificeAbility[pid];
      delete (game.state as any).pendingSacrificeAbility[pid];

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} cancelled ${pending.cardName}'s ability activation.`,
        ts: Date.now(),
      });
    }

    broadcastGame(io, game, gameId);
  });

  // ============================================================================
  // Sacrifice Selection (for Grave Pact, Dictate of Erebos, etc.)
  // ============================================================================

  /**
   * Handle sacrifice selection response from a player
   * This is used when a Grave Pact-style effect requires opponents to sacrifice
   */
  socket.on("sacrificeSelected", ({ 
    gameId, 
    triggerId, 
    permanentId 
  }: { 
    gameId: string; 
    triggerId: string; 
    permanentId: string;
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", {
        code: "GAME_NOT_FOUND",
        message: "Game not found",
      });
      return;
    }

    const battlefield = game.state?.battlefield || [];
    
    // Find the permanent to sacrifice
    const permIndex = battlefield.findIndex((p: any) => 
      p?.id === permanentId && p?.controller === pid
    );
    
    if (permIndex === -1) {
      socket.emit("error", {
        code: "PERMANENT_NOT_FOUND",
        message: "Permanent not found or not controlled by you",
      });
      return;
    }
    
    const permanent = battlefield[permIndex];
    const card = (permanent as any).card;
    const cardName = card?.name || "Unknown";
    
    // Remove from battlefield
    battlefield.splice(permIndex, 1);
    
    // Move to graveyard
    const zones = (game.state as any)?.zones?.[pid];
    if (zones) {
      zones.graveyard = zones.graveyard || [];
      zones.graveyard.push({ ...card, zone: "graveyard" });
      zones.graveyardCount = zones.graveyard.length;
    }
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "sacrificeSelected", { 
      playerId: pid, 
      permanentId,
      triggerId,
    });
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} sacrificed ${cardName} to the triggered ability.`,
      ts: Date.now(),
    });
    
    broadcastGame(io, game, gameId);
  });

  // ============================================================================
  // Mana Pool Manipulation (moved to mana-handlers.ts)
  // ============================================================================
  
  // Register mana pool manipulation handlers from separate module
  registerManaHandlers(io, socket);

  // ============================================================================
  // Replacement Effect Ordering
  // ============================================================================

  /**
   * Set custom replacement effect ordering preference for a player.
   * This allows players to override the default ordering when they want to
   * maximize damage taken (e.g., for Selfless Squire, redirect effects).
   */
  socket.on("setReplacementEffectOrder", ({
    gameId,
    effectType,
    useCustomOrder,
    customOrder,
  }: {
    gameId: string;
    effectType: 'damage' | 'life_gain' | 'counters' | 'tokens';
    useCustomOrder: boolean;
    customOrder?: string[];  // Source names in desired order
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }

    // Initialize replacement effect preferences if needed
    (game.state as any).replacementEffectPreferences = (game.state as any).replacementEffectPreferences || {};
    (game.state as any).replacementEffectPreferences[pid] = (game.state as any).replacementEffectPreferences[pid] || {};
    
    (game.state as any).replacementEffectPreferences[pid][effectType] = {
      useCustomOrder,
      customOrder: customOrder || [],
      updatedAt: Date.now(),
    };

    // Bump game sequence
    if (typeof (game as any).bumpSeq === "function") { (game as any).bumpSeq(); }

    const orderDescription = useCustomOrder 
      ? `custom order: ${(customOrder || []).join(' → ')}`
      : 'default (optimal) order';
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} set ${effectType} replacement effect ordering to ${orderDescription}.`,
      ts: Date.now(),
    });

    // Notify player of the change
    socket.emit("replacementEffectOrderUpdated", {
      gameId,
      effectType,
      useCustomOrder,
      customOrder,
    });

    broadcastGame(io, game, gameId);
  });

  /**
   * Handle equipment target selection (attach equipment to creature)
   */
  socket.on("equipTargetChosen", ({
    gameId,
    equipmentId,
    targetCreatureId,
    manaPaid,
    effectId,
    payment,
  }: {
    gameId: string;
    equipmentId: string;
    targetCreatureId: string;
    manaPaid?: Record<string, number>;
    effectId?: string;
    payment?: Array<{ permanentId: string; mana: string; count: number }>;
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }
    
    // Check and clean up pending equip activation
    // IMPORTANT: Use the stored equipCost from pending activation to support multiple equip costs
    // (e.g., "Equip legendary creature {3}" vs "Equip {7}")
    let storedEquipCost: string | null = null;
    let storedEquipType: string | null = null;
    if (effectId && (game.state as any).pendingEquipActivations?.[effectId]) {
      const pendingEquip = (game.state as any).pendingEquipActivations[effectId];
      
      // Validate that the target is in the valid list
      const validTargetIds = pendingEquip.validTargetIds || [];
      if (!validTargetIds.includes(targetCreatureId)) {
        debugWarn(2, `[equipTargetChosen] Invalid target selected: ${targetCreatureId} for ${pendingEquip.equipmentName}`);
        socket.emit("error", {
          code: "INVALID_TARGET",
          message: `Invalid target selected for ${pendingEquip.equipmentName}`,
        });
        return;
      }
      
      // CRITICAL: Store the equip cost BEFORE deleting the pending state
      // This ensures we use the correct cost for conditional equip abilities
      storedEquipCost = pendingEquip.equipCost || null;
      storedEquipType = pendingEquip.equipType || null;
      
      // Clean up pending state
      delete (game.state as any).pendingEquipActivations[effectId];
      debug(2, `[equipTargetChosen] Using preserved equip data from effectId: ${effectId}, cost: ${storedEquipCost}, type: ${storedEquipType}`);
    }

    const battlefield = game.state?.battlefield || [];
    
    // Find the equipment
    const equipment = battlefield.find((p: any) => p?.id === equipmentId && p?.controller === pid);
    if (!equipment) {
      socket.emit("error", {
        code: "EQUIPMENT_NOT_FOUND",
        message: "Equipment not found or not controlled by you",
      });
      return;
    }
    
    // Find the target creature
    const targetCreature = battlefield.find((p: any) => p?.id === targetCreatureId && p?.controller === pid);
    if (!targetCreature) {
      socket.emit("error", {
        code: "INVALID_TARGET",
        message: "Target creature not found or not controlled by you",
      });
      return;
    }
    
    // Verify target is a creature
    const targetTypeLine = (targetCreature.card?.type_line || "").toLowerCase();
    if (!targetTypeLine.includes("creature")) {
      socket.emit("error", {
        code: "INVALID_TARGET",
        message: "Target must be a creature",
      });
      return;
    }
    
    // Use the stored equip cost from pending activation if available
    // This is critical for equipment with multiple equip costs (e.g., Blackblade Reforged)
    // Fallback: Parse the FIRST equip cost from oracle text (which may be wrong for conditional equip)
    let equipCost: string;
    if (storedEquipCost) {
      equipCost = storedEquipCost;
    } else {
      // Fallback parsing - only used if pending activation wasn't found
      const oracleText = equipment.card?.oracle_text || "";
      const equipCostMatch = oracleText.match(/equip\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
      equipCost = equipCostMatch ? equipCostMatch[1] : "{0}";
      debugWarn(2, `[equipTargetChosen] No stored equipCost found, using fallback parse: ${equipCost}`);
    }
    
    // Validate and consume mana payment
    const parsedCost = parseManaCost(equipCost);
    const pool = getOrInitManaPool(game.state, pid);
    
    const hasColoredMana = Object.values(parsedCost.colors).some(v => v > 0);
    const hasCost = parsedCost.generic > 0 || hasColoredMana;
    
    if (hasCost) {
      // Check if payment was provided (from mana source tapping)
      if (payment && payment.length > 0) {
        // Process payment from mana sources
        for (const p of payment) {
          const manaPerm = battlefield.find((perm: any) => perm?.id === p.permanentId);
          if (manaPerm && !manaPerm.tapped) {
            manaPerm.tapped = true;
            // Add mana to pool
            for (let i = 0; i < p.count; i++) {
              const manaColor = p.mana.toLowerCase();
              if (manaColor === 'w') pool.white += 1;
              else if (manaColor === 'u') pool.blue += 1;
              else if (manaColor === 'b') pool.black += 1;
              else if (manaColor === 'r') pool.red += 1;
              else if (manaColor === 'g') pool.green += 1;
              else pool.colorless += 1;
            }
          }
        }
        debug(2, `[equipTargetChosen] Added mana from ${payment.length} sources`);
      }
      
      const totalAvailable = calculateTotalAvailableMana(pool, []);
      const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
      
      if (validationError) {
        // Emit payment required - player needs to tap mana sources
        const paymentEffectId = `equip_payment_${equipmentId}_${Date.now()}`;
        
        // Store pending equip payment
        (game.state as any).pendingEquipPayments = (game.state as any).pendingEquipPayments || {};
        (game.state as any).pendingEquipPayments[paymentEffectId] = {
          equipmentId,
          targetCreatureId,
          equipCost,
          playerId: pid,
          equipmentName: equipment.card?.name,
          targetCreatureName: targetCreature.card?.name,
        };
        
        socket.emit("paymentRequired", {
          gameId,
          cardId: equipmentId,
          cardName: equipment.card?.name || "Equipment",
          manaCost: equipCost,
          effectId: paymentEffectId,
          abilityType: 'equip',
          targets: [targetCreatureId],
          imageUrl: equipment.card?.image_uris?.small || equipment.card?.image_uris?.normal,
        });
        
        debug(2, `[equipTargetChosen] Payment required for ${equipment.card?.name} equip cost ${equipCost}`);
        return;
      }
      
      // Consume mana from pool
      consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[equipTargetChosen]');
    }
    
    // CRITICAL FIX: Put equip ability on the stack instead of directly attaching
    // This allows players to respond to equip activations
    const equipAbilityId = `equip_ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    game.state.stack = game.state.stack || [];
    game.state.stack.push({
      id: equipAbilityId,
      type: 'ability',
      controller: pid,
      source: equipmentId,
      sourceName: equipment.card?.name || "Equipment",
      description: `Equip ${equipment.card?.name} to ${targetCreature.card?.name}`,
      abilityType: 'equip',
      // Store equip parameters for when the ability resolves
      equipParams: {
        equipmentId,
        targetCreatureId,
        equipmentName: equipment.card?.name,
        targetCreatureName: targetCreature.card?.name,
      },
    } as any);
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    // Emit chat message
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} activated equip ability: ${equipment.card?.name} targeting ${targetCreature.card?.name}. Ability on the stack.`,
      ts: Date.now(),
    });
    
    debug(2, `[equipTargetChosen] Equip ability on stack: ${equipment.card?.name} → ${targetCreature.card?.name}`);
    
    appendEvent(gameId, (game as any).seq ?? 0, "equipTarget", {
      playerId: pid,
      equipmentId,
      targetCreatureId,
      equipCost,
    });
    
    // Broadcast updated game state
    broadcastGame(io, game, gameId);
  });

  // Ability target selection handler (for effects that grant abilities to creatures)
  socket.on("abilityTargetChosen", ({
    gameId,
    targetCreatureId,
    effectId,
  }: {
    gameId: string;
    targetCreatureId: string;
    effectId: string;
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }
    
    // Retrieve pending ability grant
    const pendingGrants = (game.state as any).pendingAbilityGrants || {};
    const pendingGrant = pendingGrants[effectId];
    
    if (!pendingGrant) {
      socket.emit("error", {
        code: "INVALID_EFFECT",
        message: "Ability grant effect not found or expired",
      });
      return;
    }
    
    // Validate target
    if (!pendingGrant.validTargetIds.includes(targetCreatureId)) {
      socket.emit("error", {
        code: "INVALID_TARGET",
        message: "Invalid target for ability grant",
      });
      return;
    }
    
    const battlefield = game.state?.battlefield || [];
    const targetCreature = battlefield.find((p: any) => p.id === targetCreatureId);
    
    if (!targetCreature) {
      socket.emit("error", {
        code: "TARGET_NOT_FOUND",
        message: "Target creature not found",
      });
      delete pendingGrants[effectId];
      return;
    }
    
    // Parse and pay the cost
    const cost = pendingGrant.cost;
    const parsedCost = parseManaCost(cost);
    const pool = getOrInitManaPool(game.state, pid);
    const totalAvailable = calculateTotalAvailableMana(pool, []);
    
    // Validate mana payment
    const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
    if (validationError) {
      socket.emit("error", { code: "INSUFFICIENT_MANA", message: validationError });
      delete pendingGrants[effectId];
      return;
    }
    
    // Consume mana
    consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[abilityTargetChosen]');
    
    // Tap the source permanent if it has {T} in the cost
    const sourceId = pendingGrant.sourceId;
    const sourcePermanent = battlefield.find((p: any) => p.id === sourceId);
    if (sourcePermanent && cost.toLowerCase().includes('{t}')) {
      sourcePermanent.tapped = true;
    }
    
    // Grant the ability to the target creature until end of turn
    const abilityText = pendingGrant.abilityGranted;
    if (!targetCreature.grantedAbilities) {
      targetCreature.grantedAbilities = [];
    }
    
    // Add the ability with an expiration marker
    const grantedAbility = `${abilityText} (until end of turn)`;
    if (!targetCreature.grantedAbilities.includes(grantedAbility)) {
      targetCreature.grantedAbilities.push(grantedAbility);
    }
    
    // Track temporary abilities for cleanup at end of turn
    if (!(game.state as any).temporaryAbilities) {
      (game.state as any).temporaryAbilities = [];
    }
    (game.state as any).temporaryAbilities.push({
      creatureId: targetCreatureId,
      ability: grantedAbility,
      expiresAt: 'end_of_turn',
      grantedBy: sourceId,
    });
    
    // Clean up pending state
    delete pendingGrants[effectId];
    
    // Bump seq
    if (typeof (game as any).bumpSeq === "function") {
      (game as any).bumpSeq();
    }
    
    // Log to chat
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} activated ${pendingGrant.sourceName}: ${targetCreature.card?.name} gains ${abilityText} until end of turn`,
      ts: Date.now(),
    });
    
    debug(2, `[abilityTargetChosen] ${targetCreature.card?.name} granted "${abilityText}" from ${pendingGrant.sourceName}`);
    
    // Broadcast updated game state
    broadcastManaPoolUpdate(io, gameId, pid, pool as any, 'Ability activated', game);
    broadcastGame(io, game, gameId);
  });

  // Fight target selection handler
  socket.on("fightTargetChosen", ({
    gameId,
    activationId,
    targetCreatureId,
  }: {
    gameId: string;
    activationId: string;
    targetCreatureId: string;
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }
    
    // Retrieve pending fight activation
    const pendingFight = game.state.pendingFightActivations?.[activationId];
    if (!pendingFight) {
      socket.emit("error", {
        code: "INVALID_ACTIVATION",
        message: "Fight activation not found or expired",
      });
      return;
    }
    
    // Validate player
    if (pendingFight.playerId !== pid) {
      socket.emit("error", {
        code: "NOT_YOUR_ACTIVATION",
        message: "This is not your activation",
      });
      return;
    }
    
    const battlefield = game.state?.battlefield || [];
    
    // Find the source creature (the one that initiated the fight)
    const sourceCreature = battlefield.find((p: any) => p?.id === pendingFight.sourceId);
    if (!sourceCreature) {
      socket.emit("error", {
        code: "SOURCE_NOT_FOUND",
        message: "Source creature not found on battlefield",
      });
      delete game.state.pendingFightActivations[activationId];
      return;
    }
    
    // Find the target creature
    const targetCreature = battlefield.find((p: any) => p?.id === targetCreatureId);
    if (!targetCreature) {
      socket.emit("error", {
        code: "INVALID_TARGET",
        message: "Target creature not found on battlefield",
      });
      delete game.state.pendingFightActivations[activationId];
      return;
    }
    
    // Verify target is a creature
    const targetTypeLine = (targetCreature.card?.type_line || "").toLowerCase();
    if (!targetTypeLine.includes("creature")) {
      socket.emit("error", {
        code: "INVALID_TARGET",
        message: "Target must be a creature",
      });
      delete game.state.pendingFightActivations[activationId];
      return;
    }
    
    // Clean up pending state
    delete game.state.pendingFightActivations[activationId];
    
    // Execute the fight - each creature deals damage equal to its power to the other
    const sourcePower = getEffectivePower(sourceCreature);
    const targetPower = getEffectivePower(targetCreature);
    
    // Mark damage on both creatures
    sourceCreature.damageMarked = (sourceCreature.damageMarked || 0) + targetPower;
    targetCreature.damageMarked = (targetCreature.damageMarked || 0) + sourcePower;
    
    debug(2, `[fightTargetChosen] ${pendingFight.sourceName} (power ${sourcePower}) fights ${targetCreature.card?.name} (power ${targetPower})`);
    
    // Check for "dealt damage" triggers on the source creature
    // Brash Taunter: "Whenever this creature is dealt damage, it deals that much damage to target opponent."
    // Ill-Tempered Loner: "Whenever this creature is dealt damage, it deals that much damage to any target."
    // Wrathful Red Dragon: "Whenever a Dragon you control is dealt damage, it deals that much damage to any target that isn't a Dragon."
    const checkDamageDealtTriggers = (damagedCreature: any, damageAmount: number, controller: string) => {
      if (!damagedCreature || damageAmount <= 0) return;
      
      const oracleText = (damagedCreature.card?.oracle_text || "").toLowerCase();
      const creatureName = damagedCreature.card?.name || "Unknown";
      
      // Pattern: "Whenever this creature is dealt damage" or "Whenever ~ is dealt damage"
      if (oracleText.includes("whenever this creature is dealt damage") ||
          oracleText.includes("whenever " + creatureName.toLowerCase() + " is dealt damage")) {
        // Queue trigger for target selection
        const triggerId = `damage_trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        game.state.pendingDamageTriggers = game.state.pendingDamageTriggers || {};
        game.state.pendingDamageTriggers[triggerId] = {
          sourceId: damagedCreature.id,
          sourceName: creatureName,
          controller: controller,
          damageAmount: damageAmount,
          triggerType: 'dealt_damage',
        };
        
        // Determine target type from oracle text
        let targetType = 'any'; // Default to any target
        let targetRestriction = '';
        if (oracleText.includes("target opponent")) {
          targetType = 'opponent';
          targetRestriction = 'opponent';
        } else if (oracleText.includes("any target that isn't a dragon")) {
          targetType = 'any_non_dragon';
          targetRestriction = "that isn't a Dragon";
        }
        
        // Emit trigger to player for target selection
        socket.emit("damageTriggerTargetRequest", {
          gameId,
          triggerId,
          source: {
            id: damagedCreature.id,
            name: creatureName,
            imageUrl: damagedCreature.card?.image_uris?.small || damagedCreature.card?.image_uris?.normal,
          },
          damageAmount,
          targetType,
          targetRestriction,
          title: `${creatureName} - Damage Trigger`,
          description: `${creatureName} was dealt ${damageAmount} damage. Choose a target to deal ${damageAmount} damage to${targetRestriction ? ` (${targetRestriction})` : ''}.`,
        });
        
        debug(2, `[fightTargetChosen] Queued damage trigger from ${creatureName} for ${damageAmount} damage`);
      }
    };
    
    // Check triggers for both creatures
    checkDamageDealtTriggers(sourceCreature, targetPower, sourceCreature.controller);
    checkDamageDealtTriggers(targetCreature, sourcePower, targetCreature.controller);
    
    // Emit chat message
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `⚔️ ${pendingFight.sourceName} fights ${targetCreature.card?.name}! ${pendingFight.sourceName} deals ${sourcePower} damage, ${targetCreature.card?.name} deals ${targetPower} damage.`,
      ts: Date.now(),
    });
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "fight", {
      playerId: pid,
      sourceId: pendingFight.sourceId,
      targetId: targetCreatureId,
      sourcePower,
      targetPower,
    });
    
    // Broadcast updated game state
    broadcastGame(io, game, gameId);
  });

  /**
   * Handle counter target selection confirmation
   * Used for abilities like Gwafa Hazid, Sage of Fables, Ozolith, etc.
   */
  socket.on("counterTargetChosen", async ({
    gameId,
    activationId,
    targetId,
  }: {
    gameId: string;
    activationId: string;
    targetId: string;
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }
    
    // Retrieve pending counter activation
    const pendingCounter = game.state.pendingCounterActivations?.[activationId];
    if (!pendingCounter) {
      socket.emit("error", {
        code: "INVALID_ACTIVATION",
        message: "Counter activation not found or expired",
      });
      return;
    }
    
    // Validate player
    if (pendingCounter.playerId !== pid) {
      socket.emit("error", {
        code: "NOT_YOUR_ACTIVATION",
        message: "This is not your activation",
      });
      return;
    }
    
    const battlefield = game.state?.battlefield || [];
    
    // Find the target permanent
    const targetPermanent = battlefield.find((p: any) => p?.id === targetId);
    if (!targetPermanent) {
      socket.emit("error", {
        code: "INVALID_TARGET",
        message: "Target permanent not found on battlefield",
      });
      delete game.state.pendingCounterActivations[activationId];
      return;
    }
    
    // Clean up pending state
    delete game.state.pendingCounterActivations[activationId];
    
    // Calculate number of counters to add
    let counterCount = 1; // Default to 1
    const scalingText = pendingCounter.scalingText;
    
    if (scalingText) {
      // Handle scaling counters like "for each Elf you control"
      // Pattern: "for each [creature type/card type] you control"
      const scalingMatch = scalingText.match(/(?:for each )?(\w+)(?: you control)?/i);
      if (scalingMatch) {
        const searchType = scalingMatch[1].toLowerCase();
        const battlefield = game.state?.battlefield || [];
        
        // Count matching permanents controlled by the player
        counterCount = battlefield.filter((perm: any) => {
          if (perm.controller !== pid) return false;
          const typeLine = (perm.card?.type_line || '').toLowerCase();
          const name = (perm.card?.name || '').toLowerCase();
          
          // Check if it matches the creature type or card type
          return typeLine.includes(searchType) || name.includes(searchType);
        }).length;
        
        debug(2, `[counterTargetChosen] Scaling: ${counterCount} ${searchType}(s) controlled by ${pid}`);
      }
    }
    
    // Add the counter(s) to the target
    if (!targetPermanent.counters) {
      (targetPermanent as any).counters = {};
    }
    
    const counterType = pendingCounter.counterType;
    (targetPermanent.counters as any)[counterType] = ((targetPermanent.counters as any)[counterType] || 0) + counterCount;
    
    const targetName = targetPermanent.card?.name || "permanent";
    debug(2, `[counterTargetChosen] ${pendingCounter.sourceName} put ${counterCount} ${counterType} counter(s) on ${targetName}`);
    
    // Emit chat message
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} activated ${pendingCounter.sourceName}: Put ${counterCount} ${counterType} counter${counterCount > 1 ? 's' : ''} on ${targetName}.`,
      ts: Date.now(),
    });
    
    // Handle additional effects from the ability
    // Example: Gwafa Hazid - "Its controller draws a card"
    const oracleText = pendingCounter.oracleText || "";
    if (oracleText.includes("its controller draws") || oracleText.includes("that player draws")) {
      const targetController = targetPermanent.controller;
      if (targetController) {
        // Simple increment to hand count - proper draw handled by game flow
        const zones = game.state?.zones?.[targetController];
        if (zones && Array.isArray(zones.hand)) {
          // Add a placeholder card to hand (full draw logic handled elsewhere)
          debug(2, `[counterTargetChosen] ${targetController} should draw a card (Gwafa effect)`);
          
          // Use simplified draw - just emit message for now
          // Full implementation would require proper library management
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `${getPlayerName(game, targetController)} draws a card.`,
            ts: Date.now(),
          });
        }
      }
    }
    
    // Persist event
    try {
      await appendEvent(gameId, (game as any).seq || 0, "counterTargetChosen", {
        playerId: pid,
        activationId,
        sourceName: pendingCounter.sourceName,
        targetId,
        targetName,
        counterType,
      });
    } catch (e) {
      debugWarn(1, "[interaction] Failed to persist counterTargetChosen event:", e);
    }
    
    // Bump sequence
    if (typeof (game as any).bumpSeq === "function") {
      (game as any).bumpSeq();
    }
    
    broadcastGame(io, game, gameId);
  });

  /**
   * Handle move counter source selection (Nesting Grounds step 1)
   */
  socket.on("moveCounterSourceChosen", async ({
    gameId,
    activationId,
    sourcePermId,
    counterType,
  }: {
    gameId: string;
    activationId: string;
    sourcePermId: string;
    counterType: string;
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }
    
    // Retrieve pending activation
    const pendingMove = game.state.pendingMoveCounterActivations?.[activationId];
    if (!pendingMove || pendingMove.step !== 'select_source') {
      socket.emit("error", {
        code: "INVALID_ACTIVATION",
        message: "Move counter activation not found or in wrong step",
      });
      return;
    }
    
    // Validate player
    if (pendingMove.playerId !== pid) {
      socket.emit("error", {
        code: "NOT_YOUR_ACTIVATION",
        message: "This is not your activation",
      });
      return;
    }
    
    const battlefield = game.state?.battlefield || [];
    
    // Find the source permanent
    const sourcePermanent = battlefield.find((p: any) => p?.id === sourcePermId && p?.controller === pid);
    if (!sourcePermanent || !sourcePermanent.counters || !sourcePermanent.counters[counterType]) {
      socket.emit("error", {
        code: "INVALID_SOURCE",
        message: "Source permanent not found or doesn't have that counter type",
      });
      delete game.state.pendingMoveCounterActivations[activationId];
      return;
    }
    
    // Update pending state to step 2
    pendingMove.step = 'select_destination';
    pendingMove.sourcePermId = sourcePermId;
    pendingMove.counterType = counterType;
    
    // Emit second target selection request (destination permanent)
    socket.emit("moveCounterDestinationRequest", {
      gameId,
      activationId,
      source: {
        id: pendingMove.sourceId,
        name: pendingMove.sourceName,
      },
      counterType,
      sourcePerm: {
        id: sourcePermId,
        name: sourcePermanent.card?.name || "permanent",
      },
      targetFilter: {
        types: ['permanent'],
        controller: 'any',
        excludeSource: true, // Can't move to same permanent
      },
      title: `${pendingMove.sourceName} - Select destination`,
      description: `Choose a permanent to move the ${counterType} counter to`,
    });
    
    debug(2, `[moveCounterSourceChosen] Selected source: ${sourcePermanent.card?.name}, counter: ${counterType}`);
    broadcastGame(io, game, gameId);
  });

  /**
   * Handle move counter destination selection (Nesting Grounds step 2)
   */
  socket.on("moveCounterDestinationChosen", async ({
    gameId,
    activationId,
    destPermId,
  }: {
    gameId: string;
    activationId: string;
    destPermId: string;
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }
    
    // Retrieve pending activation
    const pendingMove = game.state.pendingMoveCounterActivations?.[activationId];
    if (!pendingMove || pendingMove.step !== 'select_destination') {
      socket.emit("error", {
        code: "INVALID_ACTIVATION",
        message: "Move counter activation not found or in wrong step",
      });
      return;
    }
    
    // Validate player
    if (pendingMove.playerId !== pid) {
      socket.emit("error", {
        code: "NOT_YOUR_ACTIVATION",
        message: "This is not your activation",
      });
      return;
    }
    
    const battlefield = game.state?.battlefield || [];
    
    // Find source and destination permanents
    const sourcePermanent = battlefield.find((p: any) => p?.id === pendingMove.sourcePermId);
    const destPermanent = battlefield.find((p: any) => p?.id === destPermId);
    
    if (!sourcePermanent || !destPermanent) {
      socket.emit("error", {
        code: "INVALID_TARGET",
        message: "Source or destination permanent not found",
      });
      delete game.state.pendingMoveCounterActivations[activationId];
      return;
    }
    
    const counterType = pendingMove.counterType;
    
    // Verify source still has the counter
    if (!sourcePermanent.counters || !sourcePermanent.counters[counterType] || sourcePermanent.counters[counterType] <= 0) {
      socket.emit("error", {
        code: "NO_COUNTER",
        message: "Source permanent no longer has that counter",
      });
      delete game.state.pendingMoveCounterActivations[activationId];
      return;
    }
    
    // Clean up pending state
    delete game.state.pendingMoveCounterActivations[activationId];
    
    // Move the counter
    (sourcePermanent.counters as any)[counterType] -= 1;
    if ((sourcePermanent.counters as any)[counterType] <= 0) {
      delete (sourcePermanent.counters as any)[counterType];
    }
    
    if (!destPermanent.counters) {
      (destPermanent as any).counters = {};
    }
    (destPermanent.counters as any)[counterType] = ((destPermanent.counters as any)[counterType] || 0) + 1;
    
    const sourceName = sourcePermanent.card?.name || "permanent";
    const destName = destPermanent.card?.name || "permanent";
    
    debug(2, `[moveCounterDestinationChosen] Moved ${counterType} counter from ${sourceName} to ${destName}`);
    
    // Emit chat message
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} activated ${pendingMove.sourceName}: Moved a ${counterType} counter from ${sourceName} to ${destName}.`,
      ts: Date.now(),
    });
    
    // Persist event
    try {
      await appendEvent(gameId, (game as any).seq || 0, "moveCounterComplete", {
        playerId: pid,
        activationId,
        sourceName: pendingMove.sourceName,
        sourcePermId: pendingMove.sourcePermId,
        destPermId,
        counterType,
      });
    } catch (e) {
      debugWarn(1, "[interaction] Failed to persist moveCounterComplete event:", e);
    }
    
    // Bump sequence
    if (typeof (game as any).bumpSeq === "function") {
      (game as any).bumpSeq();
    }
    
    broadcastGame(io, game, gameId);
  });

  /**
   * Get current replacement effect ordering preferences for a player
   */
  socket.on("getReplacementEffectOrder", ({
    gameId,
    effectType,
  }: {
    gameId: string;
    effectType?: 'damage' | 'life_gain' | 'counters' | 'tokens';
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }

    const preferences = (game.state as any).replacementEffectPreferences?.[pid] || {};
    
    if (effectType) {
      socket.emit("replacementEffectOrderResponse", {
        gameId,
        effectType,
        preference: preferences[effectType] || { useCustomOrder: false, customOrder: [] },
      });
    } else {
      // Return all preferences
      socket.emit("replacementEffectOrderResponse", {
        gameId,
        preferences,
      });
    }
  });

  // Legacy proliferateConfirm handler removed - now using resolution queue system
  // See processPendingProliferate() and handleProliferateResponse() in resolution.ts

  /**
   * Handle player's choice of color for "any color" mana production
   */
  socket.on("confirmAnyColorManaChoice", ({ gameId, activationId, chosenColor }: {
    gameId: string;
    activationId: string;
    chosenColor: 'white' | 'blue' | 'black' | 'red' | 'green';
  }) => {
    const game = ensureGame(gameId);
    if (!game || !game.state) return;

    const pid = socket.data.playerId as PlayerID;
    if (!pid) {
      socket.emit("error", { code: "NO_PLAYER_ID", message: "No player ID associated with this socket" });
      return;
    }

    // Retrieve pending activation
    const pending = game.state.pendingManaActivations?.[activationId];
    if (!pending) {
      socket.emit("error", { code: "INVALID_ACTIVATION", message: "Invalid or expired mana activation" });
      return;
    }

    // Verify it's the right player
    if (pending.playerId !== pid) {
      socket.emit("error", { code: "NOT_YOUR_ACTIVATION", message: "This is not your mana activation" });
      return;
    }
    
    // Validate chosen color is in allowed colors (if specified)
    if (pending.allowedColors && pending.allowedColors.length > 0) {
      const colorMap: Record<string, string> = {
        white: 'W',
        blue: 'U',
        black: 'B',
        red: 'R',
        green: 'G',
      };
      const chosenColorCode = colorMap[chosenColor];
      if (!pending.allowedColors.includes(chosenColorCode)) {
        socket.emit("error", { 
          code: "INVALID_COLOR_CHOICE", 
          message: `${pending.cardName} cannot produce ${chosenColor} mana. Valid colors: ${pending.allowedColors.join(', ')}` 
        });
        return;
      }
    }

    // Add mana to pool
    game.state.manaPool = game.state.manaPool || {};
    game.state.manaPool[pid] = game.state.manaPool[pid] || {
      white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
    };

    (game.state.manaPool[pid] as any)[chosenColor] = 
      ((game.state.manaPool[pid] as any)[chosenColor] || 0) + pending.amount;

    // Clean up pending activation
    delete game.state.pendingManaActivations[activationId];

    // Create chat message
    const colorMap: Record<string, string> = {
      white: 'W',
      blue: 'U',
      black: 'B',
      red: 'R',
      green: 'G',
    };
    const colorSymbol = colorMap[chosenColor];
    const manaDescription = pending.amount > 1 
      ? `${pending.amount} ${colorSymbol} mana`
      : `${colorSymbol} mana`;

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} tapped ${pending.cardName} for ${manaDescription}.`,
      ts: Date.now(),
    });

    // Broadcast updates
    broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${pending.cardName}`, game);
    broadcastGame(io, game, gameId);
  });

  /**
   * Handle tap/untap target confirmation from TapUntapTargetModal
   * Used for abilities like:
   * - Saryth, the Viper's Fang: "Untap another target creature or land"
   * - Merrow Reejerey: "Tap or untap target permanent"
   * - Argothian Elder: "Untap two target lands"
   */
  socket.on("confirmTapUntapTarget", ({ 
    gameId, 
    activationId, 
    targetIds, 
    action 
  }: {
    gameId: string;
    activationId: string;
    targetIds: string[];
    action: 'tap' | 'untap';
  }) => {
    const game = ensureGame(gameId);
    if (!game || !game.state) return;

    const pid = socket.data.playerId as PlayerID;
    if (!pid) {
      socket.emit("error", { code: "NO_PLAYER_ID", message: "No player ID associated with this socket" });
      return;
    }

    // Retrieve pending activation
    const pending = game.state.pendingTapUntapActivations?.[activationId];
    if (!pending) {
      socket.emit("error", { code: "INVALID_ACTIVATION", message: "Invalid or expired tap/untap activation" });
      return;
    }

    // Verify it's the right player
    if (pending.playerId !== pid) {
      socket.emit("error", { code: "NOT_YOUR_ACTIVATION", message: "This is not your tap/untap activation" });
      return;
    }

    // Verify target count
    if (targetIds.length !== pending.targetCount) {
      socket.emit("error", { 
        code: "INVALID_TARGET_COUNT", 
        message: `Expected ${pending.targetCount} target(s), got ${targetIds.length}` 
      });
      return;
    }

    // Apply tap/untap to each target
    const battlefield = game.state.battlefield || [];
    const affectedNames: string[] = [];
    
    for (const targetId of targetIds) {
      const target = battlefield.find((p: any) => p.id === targetId);
      if (!target) {
        debugWarn(2, `[confirmTapUntapTarget] Target ${targetId} not found on battlefield`);
        continue;
      }

      // Apply the action
      if (action === 'tap' && !target.tapped) {
        target.tapped = true;
        affectedNames.push(target.card?.name || 'permanent');
      } else if (action === 'untap' && target.tapped) {
        target.tapped = false;
        affectedNames.push(target.card?.name || 'permanent');
      }
    }

    // Clean up pending activation
    delete game.state.pendingTapUntapActivations[activationId];

    // Create chat message
    if (affectedNames.length > 0) {
      const targetsText = affectedNames.length === 1 
        ? affectedNames[0]
        : `${affectedNames.slice(0, -1).join(', ')} and ${affectedNames[affectedNames.length - 1]}`;
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} used ${pending.sourceName} to ${action} ${targetsText}.`,
        ts: Date.now(),
      });
    }

    // Append event to game log
    appendGameEvent(game, gameId, action === 'tap' ? 'permanent_tapped' : 'permanent_untapped', {
      playerId: pid,
      permanentIds: targetIds,
      source: pending.sourceName,
      ts: Date.now(),
    });

    // Broadcast updates
    broadcastGame(io, game, gameId);
  });

  /**
   * Handle counter movement confirmation from CounterMovementModal
   * Used for abilities like:
   * - Nesting Grounds: "Move a counter from target permanent you control onto another target permanent"
   */
  socket.on("confirmCounterMovement", ({ 
    gameId, 
    activationId, 
    sourcePermanentId, 
    targetPermanentId, 
    counterType 
  }: {
    gameId: string;
    activationId: string;
    sourcePermanentId: string;
    targetPermanentId: string;
    counterType: string;
  }) => {
    const game = ensureGame(gameId);
    if (!game || !game.state) return;

    const pid = socket.data.playerId as PlayerID;
    if (!pid) {
      socket.emit("error", { code: "NO_PLAYER_ID", message: "No player ID associated with this socket" });
      return;
    }

    // Retrieve pending activation
    const pending = game.state.pendingCounterMovements?.[activationId];
    if (!pending) {
      socket.emit("error", { code: "INVALID_ACTIVATION", message: "Invalid or expired counter movement" });
      return;
    }

    // Verify it's the right player
    if (pending.playerId !== pid) {
      socket.emit("error", { code: "NOT_YOUR_ACTIVATION", message: "This is not your counter movement" });
      return;
    }

    // Find source and target permanents
    const battlefield = game.state.battlefield || [];
    const source = battlefield.find((p: any) => p.id === sourcePermanentId);
    const target = battlefield.find((p: any) => p.id === targetPermanentId);

    if (!source) {
      socket.emit("error", { code: "SOURCE_NOT_FOUND", message: "Source permanent not found" });
      return;
    }

    if (!target) {
      socket.emit("error", { code: "TARGET_NOT_FOUND", message: "Target permanent not found" });
      return;
    }

    // Verify source has the counter
    const sourceCounters = (source as any).counters || {};
    if (!sourceCounters[counterType] || sourceCounters[counterType] <= 0) {
      socket.emit("error", { 
        code: "NO_COUNTER", 
        message: `Source permanent has no ${counterType} counters` 
      });
      return;
    }

    // Move one counter from source to target
    sourceCounters[counterType] = (sourceCounters[counterType] || 0) - 1;
    if (sourceCounters[counterType] <= 0) {
      delete sourceCounters[counterType];
    }

    const targetCounters = (target as any).counters || {};
    targetCounters[counterType] = (targetCounters[counterType] || 0) + 1;
    (target as any).counters = targetCounters;

    // Clean up pending activation
    delete game.state.pendingCounterMovements[activationId];

    // Create chat message
    const sourceCard = source.card as any;
    const targetCard = target.card as any;
    const sourceName = sourceCard?.name || 'permanent';
    const targetName = targetCard?.name || 'permanent';

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} used ${pending.sourceName} to move a ${counterType} counter from ${sourceName} to ${targetName}.`,
      ts: Date.now(),
    });

    // Append event to game log
    appendGameEvent(game, gameId, 'counter_moved', {
      playerId: pid,
      sourcePermanentId,
      targetPermanentId,
      counterType,
      source: pending.sourceName,
      ts: Date.now(),
    });

    // Broadcast updates
    broadcastGame(io, game, gameId);
  });

  /**
   * Handle station ability creature selection confirmation (Rule 702.184a)
   * Station: "Tap another untapped creature you control: Put a number of charge counters
   * on this permanent equal to the tapped creature's power."
   */
  socket.on("confirmStationCreatureSelection", ({
    gameId,
    activationId,
    creatureId,
  }: {
    gameId: string;
    activationId: string;
    creatureId: string;
  }) => {
    const game = ensureGame(gameId);
    if (!game || !game.state) return;

    const pid = socket.data.playerId as PlayerID;
    if (!pid) {
      socket.emit("error", { code: "NO_PLAYER_ID", message: "No player ID associated with this socket" });
      return;
    }

    // Retrieve pending activation
    const pending = (game.state as any).pendingStationActivations?.[activationId];
    if (!pending) {
      socket.emit("error", { code: "INVALID_ACTIVATION", message: "Invalid or expired station activation" });
      return;
    }

    // Verify it's the right player
    if (pending.playerId !== pid) {
      socket.emit("error", { code: "NOT_YOUR_ACTIVATION", message: "This is not your station activation" });
      return;
    }

    const battlefield = game.state.battlefield || [];
    
    // Find the station permanent
    const station = battlefield.find((p: any) => p.id === pending.stationId);
    if (!station) {
      socket.emit("error", { code: "STATION_NOT_FOUND", message: "Station permanent not found" });
      delete (game.state as any).pendingStationActivations[activationId];
      return;
    }

    // Find the creature to tap
    const creature = battlefield.find((p: any) => p.id === creatureId);
    if (!creature) {
      socket.emit("error", { code: "CREATURE_NOT_FOUND", message: "Selected creature not found" });
      return;
    }

    // Validate the creature
    if (creature.controller !== pid) {
      socket.emit("error", { code: "NOT_YOUR_CREATURE", message: "You don't control this creature" });
      return;
    }

    if (creature.tapped) {
      socket.emit("error", { code: "CREATURE_TAPPED", message: "This creature is already tapped" });
      return;
    }

    const creatureTypeLine = (creature.card?.type_line || '').toLowerCase();
    if (!creatureTypeLine.includes('creature')) {
      socket.emit("error", { code: "NOT_A_CREATURE", message: "Selected permanent is not a creature" });
      return;
    }

    // Get the creature's power
    const creaturePower = getEffectivePower(creature);
    const creatureName = creature.card?.name || 'creature';

    // Tap the creature
    (creature as any).tapped = true;

    // Add charge counters equal to the creature's power (Rule 702.184a)
    // Note: While MTG allows negative power, we use Math.max(0, ...) since tapping a
    // creature with negative power shouldn't remove counters - it just adds 0.
    (station as any).counters = (station as any).counters || {};
    const currentCounters = (station as any).counters.charge || 0;
    const countersToAdd = Math.max(0, creaturePower); // Negative power = 0 counters added
    (station as any).counters.charge = currentCounters + countersToAdd;

    const newCounterCount = (station as any).counters.charge;
    const stationThreshold = pending.stationThreshold || 0;

    // Clean up pending activation
    delete (game.state as any).pendingStationActivations[activationId];

    // Check if threshold is met
    if (stationThreshold > 0 && newCounterCount >= stationThreshold && !(station as any).stationed) {
      // Mark as stationed (becomes a creature)
      (station as any).stationed = true;
      (station as any).grantedTypes = (station as any).grantedTypes || [];
      if (!(station as any).grantedTypes.includes('Creature')) {
        (station as any).grantedTypes.push('Creature');
      }

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `🚀 ${getPlayerName(game, pid)} tapped ${creatureName} (power ${creaturePower}) to station ${pending.stationName}! It gained ${countersToAdd} charge counter${countersToAdd !== 1 ? 's' : ''} (${newCounterCount}/${stationThreshold}) and is now an artifact creature!`,
        ts: Date.now(),
      });
    } else {
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `⚡ ${getPlayerName(game, pid)} tapped ${creatureName} (power ${creaturePower}) to add ${countersToAdd} charge counter${countersToAdd !== 1 ? 's' : ''} to ${pending.stationName}. (${newCounterCount}/${stationThreshold})`,
        ts: Date.now(),
      });
    }

    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }

    // Append event to game log
    appendGameEvent(game, gameId, 'station_activated', {
      playerId: pid,
      stationId: pending.stationId,
      stationName: pending.stationName,
      creatureId,
      creatureName,
      creaturePower,
      countersAdded: countersToAdd,
      totalCounters: newCounterCount,
      threshold: stationThreshold,
      stationed: (station as any).stationed,
      ts: Date.now(),
    });

    // Broadcast updates
    broadcastGame(io, game, gameId);
  });

  /**
   * Handle multi-mode ability activation confirmation
   * Used for abilities like Staff of Domination with multiple modes
   */
  socket.on("confirmMultiModeActivation", async ({ 
    gameId, 
    permanentId, 
    modeIndex 
  }: {
    gameId: string;
    permanentId: string;
    modeIndex: number;
  }) => {
    const game = ensureGame(gameId);
    if (!game || !game.state) return;

    const pid = socket.data.playerId as PlayerID;
    if (!pid) {
      socket.emit("error", { code: "NO_PLAYER_ID", message: "No player ID associated with this socket" });
      return;
    }

    // Find the permanent
    const battlefield = game.state.battlefield || [];
    const permanent = battlefield.find((p: any) => p.id === permanentId && p.controller === pid);
    
    if (!permanent) {
      socket.emit("error", { code: "PERMANENT_NOT_FOUND", message: "Permanent not found or not controlled by you" });
      return;
    }

    const card = (permanent as any).card;
    const cardName = card?.name || "Unknown";

    // Get multi-mode ability info
    const { detectMultiModeAbility } = await import("../state/modules/triggered-abilities.js");
    const multiModeAbility = detectMultiModeAbility(card, permanent);
    
    if (!multiModeAbility || modeIndex < 0 || modeIndex >= multiModeAbility.modes.length) {
      socket.emit("error", { code: "INVALID_MODE", message: "Invalid mode selection" });
      return;
    }

    const selectedMode = multiModeAbility.modes[modeIndex];
    
    // Parse and validate the cost
    const costStr = selectedMode.cost;
    const requiresTap = costStr.includes('{T}') || costStr.toLowerCase().includes('tap');
    
    if (requiresTap && (permanent as any).tapped) {
      socket.emit("error", { code: "ALREADY_TAPPED", message: `${cardName} is already tapped` });
      return;
    }

    // Parse mana cost
    const manaCostMatch = costStr.match(/\{[^}]+\}/g);
    const manaCost = manaCostMatch ? manaCostMatch.filter(c => !c.includes('T') && !c.toLowerCase().includes('tap')).join('') : "";
    
    if (manaCost) {
      const parsedCost = parseManaCost(manaCost);
      const pool = getOrInitManaPool(game.state, pid);
      const totalAvailable = calculateTotalAvailableMana(pool, []);
      
      const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
      if (validationError) {
        socket.emit("error", { code: "INSUFFICIENT_MANA", message: validationError });
        return;
      }
      
      consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[confirmMultiModeActivation]');
    }

    // Tap the permanent if required
    if (requiresTap) {
      (permanent as any).tapped = true;
    }

    // Handle mode effects
    if (selectedMode.requiresTarget) {
      // Store pending ability for target selection
      if (!(game.state as any).pendingMultiModeTargeting) {
        (game.state as any).pendingMultiModeTargeting = {};
      }
      
      const targetingId = `multimode_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      (game.state as any).pendingMultiModeTargeting[targetingId] = {
        playerId: pid,
        permanentId,
        cardName,
        modeName: selectedMode.name,
        effect: selectedMode.effect,
        targetType: selectedMode.targetType,
      };
      
      // Emit target selection request to the player
      socket.emit("multiModeTargetSelection", {
        gameId,
        targetingId,
        permanentId,
        cardName,
        modeName: selectedMode.name,
        effect: selectedMode.effect,
        targetType: selectedMode.targetType,
        cardImageUrl: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
      });
      
      broadcastGame(io, game, gameId);
      return;
    }

    // Execute the ability effect based on the mode
    let effectExecuted = false;
    const modeName = selectedMode.name.toLowerCase();
    const effectLower = (selectedMode.effect || "").toLowerCase();
    
    // ===== MANA ABILITIES =====
    if (modeName.includes("add mana") || effectLower.includes("add one mana") || effectLower.includes("add {")) {
      // Handle mana abilities - prompt for color choice if "any color"
      if (effectLower.includes("any color")) {
        // Store pending mana activation for color choice
        if (!game.state.pendingManaActivations) {
          game.state.pendingManaActivations = {};
        }
        const activationId = `mana_any_${crypto.randomUUID()}`;
        game.state.pendingManaActivations[activationId] = {
          playerId: pid,
          permanentId,
          cardName,
          amount: 1,
        };
        
        socket.emit("anyColorManaChoice", {
          gameId,
          activationId,
          permanentId,
          cardName,
          amount: 1,
          cardImageUrl: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
        });
        
        broadcastGame(io, game, gameId);
        return;
      }
      
      // Check for specific color symbols in effect
      const manaSymbols = effectLower.match(/\{([wubrgc])\}/gi) || [];
      if (manaSymbols.length > 0) {
        game.state.manaPool = game.state.manaPool || {};
        game.state.manaPool[pid] = game.state.manaPool[pid] || {
          white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
        };
        
        const colorToPoolKey: Record<string, string> = {
          'W': 'white', 'U': 'blue', 'B': 'black', 'R': 'red', 'G': 'green', 'C': 'colorless',
        };
        
        for (const sym of manaSymbols) {
          const color = sym.replace(/[{}]/g, '').toUpperCase();
          const poolKey = colorToPoolKey[color];
          if (poolKey) {
            (game.state.manaPool[pid] as any)[poolKey]++;
          }
        }
        effectExecuted = true;
      }
    }
    
    // ===== SURVEIL =====
    else if (modeName.includes("surveil") || effectLower.includes("surveil")) {
      // Parse surveil amount
      const surveilMatch = effectLower.match(/surveil\s*(\d+)/i);
      const surveilAmount = surveilMatch ? parseInt(surveilMatch[1], 10) : 1;
      
      // Store pending surveil action
      if (!(game.state as any).pendingSurveil) {
        (game.state as any).pendingSurveil = {};
      }
      const surveilId = `surveil_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      (game.state as any).pendingSurveil[surveilId] = {
        playerId: pid,
        amount: surveilAmount,
        permanentId,
        cardName,
      };
      
      // Get top N cards from library for surveil
      const zones = (game.state as any)?.zones?.[pid];
      if (zones && zones.library && zones.library.length > 0) {
        const topCards = zones.library.slice(0, Math.min(surveilAmount, zones.library.length));
        
        socket.emit("surveilChoice", {
          gameId,
          surveilId,
          amount: surveilAmount,
          cards: topCards.map((c: any, i: number) => ({
            id: c.id,
            name: c.name,
            position: i,
            image_uris: c.image_uris,
          })),
        });
        
        broadcastGame(io, game, gameId);
        return;
      }
      effectExecuted = true; // Empty library, surveil does nothing
    }
    
    // ===== STAFF OF DOMINATION MODES =====
    else if (modeName.includes("untap staff")) {
      (permanent as any).tapped = false;
      effectExecuted = true;
    } else if (modeName.includes("draw card")) {
      // Draw a card
      const zones = (game.state as any)?.zones?.[pid];
      if (zones && zones.library && zones.library.length > 0) {
        const drawnCard = zones.library.shift();
        zones.hand = zones.hand || [];
        zones.hand.push(drawnCard);
        zones.handCount = zones.hand.length;
        zones.libraryCount = zones.library.length;
        effectExecuted = true;
      }
    } else if (modeName.includes("gain") && modeName.includes("life")) {
      // Gain life
      const lifeGain = parseInt(modeName.match(/\d+/)?.[0] || "1", 10);
      if (!(game.state as any).life) (game.state as any).life = {};
      const currentLife = (game.state as any).life[pid] ?? 40;
      (game.state as any).life[pid] = currentLife + lifeGain;
      effectExecuted = true;
    }

    if (effectExecuted) {
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} activated ${cardName}: ${selectedMode.name}`,
        ts: Date.now(),
      });

      appendGameEvent(game, gameId, 'ability_activated', {
        playerId: pid,
        permanentId,
        abilityName: selectedMode.name,
        source: cardName,
        ts: Date.now(),
      });

      broadcastGame(io, game, gameId);
    } else {
      socket.emit("error", { 
        code: "NOT_IMPLEMENTED", 
        message: `Effect for "${selectedMode.name}" not yet implemented` 
      });
    }
  });
  
  /**
   * Handle multi-mode ability target confirmation
   * For abilities like "Tap target artifact", "Goad target creature", etc.
   */
  socket.on("confirmMultiModeTarget", async ({
    gameId,
    targetingId,
    targetId,
  }: {
    gameId: string;
    targetingId: string;
    targetId: string;
  }) => {
    const pid: string | undefined = socket.data?.playerId;
    if (!pid) {
      socket.emit("error", { code: "NO_PLAYER", message: "Player not found" });
      return;
    }
    
    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }
    
    // Get pending targeting info
    const pending = (game.state as any).pendingMultiModeTargeting?.[targetingId];
    if (!pending || pending.playerId !== pid) {
      socket.emit("error", { code: "INVALID_TARGETING", message: "Invalid or expired targeting" });
      return;
    }
    
    // Remove pending
    delete (game.state as any).pendingMultiModeTargeting[targetingId];
    
    const battlefield = game.state?.battlefield || [];
    const targetPerm = battlefield.find((p: any) => p?.id === targetId);
    
    if (!targetPerm) {
      socket.emit("error", { code: "TARGET_NOT_FOUND", message: "Target not found" });
      return;
    }
    
    const targetName = (targetPerm as any).card?.name || "creature";
    
    // Execute the effect based on target type
    if (pending.targetType === 'creature') {
      // Check if this is a goad effect
      if (pending.modeName.toLowerCase().includes('goad') || pending.effect.toLowerCase().includes('goad')) {
        // Apply goad to the target creature
        const currentTurn = game.state.turn || 0;
        const expiryTurn = currentTurn + 1; // Goad until your next turn
        
        (targetPerm as any).goadedBy = (targetPerm as any).goadedBy || [];
        if (!(targetPerm as any).goadedBy.includes(pid)) {
          (targetPerm as any).goadedBy.push(pid);
        }
        
        (targetPerm as any).goadedUntil = (targetPerm as any).goadedUntil || {};
        (targetPerm as any).goadedUntil[pid] = expiryTurn;
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} activated ${pending.cardName}: Goaded ${targetName} (attacks each combat if able, attacks someone other than ${getPlayerName(game, pid)} if able)`,
          ts: Date.now(),
        });
      }
      // Check if this is a tap/untap effect
      else if (pending.modeName.toLowerCase().includes('tap') || pending.effect.toLowerCase().includes('tap target')) {
        (targetPerm as any).tapped = true;
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} activated ${pending.cardName}: Tapped ${targetName}`,
          ts: Date.now(),
        });
      }
      else if (pending.modeName.toLowerCase().includes('untap') || pending.effect.toLowerCase().includes('untap target')) {
        (targetPerm as any).tapped = false;
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} activated ${pending.cardName}: Untapped ${targetName}`,
          ts: Date.now(),
        });
      }
    }
    else if (pending.targetType === 'artifact') {
      // Tap target artifact
      if (pending.modeName.toLowerCase().includes('tap') || pending.effect.toLowerCase().includes('tap target')) {
        (targetPerm as any).tapped = true;
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} activated ${pending.cardName}: Tapped ${targetName}`,
          ts: Date.now(),
        });
      }
    }
    
    appendGameEvent(game, gameId, 'ability_activated', {
      playerId: pid,
      permanentId: pending.permanentId,
      abilityName: pending.modeName,
      targetId,
      targetName,
      source: pending.cardName,
      ts: Date.now(),
    });
    
    broadcastGame(io, game, gameId);
  });

  /**
   * Handle Forbidden Orchard opponent target selection
   * When tapping Forbidden Orchard for mana, controller must choose target opponent
   * to create a 1/1 colorless Spirit creature token.
   */
  socket.on("confirmForbiddenOrchardTarget", ({
    gameId,
    activationId,
    targetOpponentId,
  }: {
    gameId: string;
    activationId: string;
    targetOpponentId: string;
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }

    // Retrieve pending activation
    const pending = (game.state as any).pendingForbiddenOrchard?.[activationId];
    if (!pending) {
      socket.emit("error", { code: "INVALID_ACTIVATION", message: "Invalid or expired Forbidden Orchard activation" });
      return;
    }

    // Verify it's the right player
    if (pending.playerId !== pid) {
      socket.emit("error", { code: "NOT_YOUR_ACTIVATION", message: "This is not your Forbidden Orchard activation" });
      return;
    }

    // Verify target opponent is valid
    const validOpponent = pending.opponents.find((opp: any) => opp.id === targetOpponentId);
    if (!validOpponent) {
      socket.emit("error", { code: "INVALID_TARGET", message: "Invalid target opponent" });
      return;
    }

    // Clean up pending activation
    delete (game.state as any).pendingForbiddenOrchard[activationId];

    // Create 1/1 colorless Spirit token for the target opponent
    const tokenId = `token_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    game.state.battlefield = game.state.battlefield || [];
    const spiritToken = {
      id: tokenId,
      controller: targetOpponentId,
      owner: targetOpponentId,
      tapped: false,
      summoningSickness: true,
      counters: {},
      card: {
        id: tokenId,
        name: 'Spirit',
        type_line: 'Token Creature — Spirit',
        oracle_text: '',
        mana_cost: '',
        cmc: 0,
        colors: [],
      },
      basePower: 1,
      baseToughness: 1,
      isToken: true,
    };
    game.state.battlefield.push(spiritToken);
    
    // Trigger ETB effects from other permanents (Cathars' Crusade, Soul Warden, etc.)
    // Create a minimal context object for the trigger system
    const ctx = {
      state: game.state,
      bumpSeq: game.bumpSeq?.bind(game) || (() => {
        debugWarn(2, '[Forbidden Orchard] bumpSeq not available, state updates may not propagate');
      }),
    };
    triggerETBEffectsForToken(ctx as any, spiritToken, targetOpponentId);

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `Forbidden Orchard: ${getPlayerName(game, targetOpponentId)} creates a 1/1 colorless Spirit token.`,
      ts: Date.now(),
    });

    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }

    appendEvent(gameId, (game as any).seq ?? 0, "confirmForbiddenOrchardTarget", {
      playerId: pid,
      activationId,
      targetOpponentId,
    });

    broadcastGame(io, game, gameId);
  });

  // ==========================================================================
  // CONTROL CHANGE CONFIRMATION (Humble Defector, etc.)
  // ==========================================================================
  
  /**
   * Handle control change opponent confirmation for activated abilities
   */
  socket.on("confirmControlChangeOpponent", ({
    gameId,
    activationId,
    targetOpponentId,
  }: {
    gameId: string;
    activationId: string;
    targetOpponentId: string;
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }

    // Retrieve pending activation
    const pending = (game.state as any).pendingControlChangeActivations?.[activationId];
    if (!pending) {
      socket.emit("error", { code: "INVALID_ACTIVATION", message: "Invalid or expired control change activation" });
      return;
    }

    // Verify it's the right player
    if (pending.playerId !== pid) {
      socket.emit("error", { code: "NOT_YOUR_ACTIVATION", message: "This is not your activation" });
      return;
    }

    // Handle declined optional control change (empty targetOpponentId)
    if (!targetOpponentId && pending.isOptional) {
      // Player declined to give control - clean up and notify
      delete (game.state as any).pendingControlChangeActivations[activationId];
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} chose not to give control of ${pending.cardName}.`,
        ts: Date.now(),
      });
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "declinedControlChange", {
        playerId: pid,
        activationId,
        permanentId: pending.permanentId,
        cardName: pending.cardName,
      });
      
      broadcastGame(io, game, gameId);
      return;
    }

    // Verify target opponent is valid
    const players = game.state?.players || [];
    const validOpponent = players.find((p: any) => p && p.id === targetOpponentId && p.id !== pid);
    if (!validOpponent) {
      socket.emit("error", { code: "INVALID_TARGET", message: "Invalid target opponent" });
      return;
    }

    // Clean up pending activation
    delete (game.state as any).pendingControlChangeActivations[activationId];

    // Find the permanent
    const battlefield = game.state?.battlefield || [];
    const permanent = battlefield.find((p: any) => p && p.id === pending.permanentId);
    
    if (!permanent) {
      socket.emit("error", { code: "PERMANENT_NOT_FOUND", message: "Permanent not found" });
      return;
    }

    // Draw cards if applicable (Humble Defector draws 2 cards)
    if (pending.drawCards && pending.drawCards > 0) {
      // Try using the game's drawCards function first
      if (typeof (game as any).drawCards === 'function') {
        const drawn = (game as any).drawCards(pid, pending.drawCards);
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} draws ${pending.drawCards} card${pending.drawCards !== 1 ? 's' : ''}.`,
          ts: Date.now(),
        });
      } else {
        // Fallback: manually draw from libraries Map
        const lib = (game as any).libraries?.get(pid) || [];
        const zones = (game.state as any).zones || {};
        const z = zones[pid] = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
        z.hand = z.hand || [];
        
        let drawnCount = 0;
        for (let i = 0; i < pending.drawCards && lib.length > 0; i++) {
          const drawn = lib.shift();
          if (drawn) {
            (z.hand as any[]).push({ ...drawn, zone: 'hand' });
            drawnCount++;
          }
        }
        z.handCount = z.hand.length;
        z.libraryCount = lib.length;
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} draws ${drawnCount} card${drawnCount !== 1 ? 's' : ''}.`,
          ts: Date.now(),
        });
      }
    }

    // Change control of the permanent
    const oldController = permanent.controller;
    permanent.controller = targetOpponentId;
    
    // Apply goad if the control change goads the creature (Vislor Turlough)
    if (pending.goadsOnChange) {
      permanent.goadedBy = permanent.goadedBy || [];
      if (!permanent.goadedBy.includes(pid)) {
        permanent.goadedBy.push(pid);
      }
      // Goad until the original owner's next turn (track this)
      // Create a new object for the readonly record
      const newGoadedUntil: Record<string, number> = {
        ...(permanent.goadedUntil || {}),
        [pid]: (game.state as any).turnNumber + 1, // Approximate - lasts until next owner's turn
      };
      permanent.goadedUntil = newGoadedUntil;
      
      debug(2, `[confirmControlChangeOpponent] ${pending.cardName} is goaded by ${pid}`);
    }
    
    // Apply attack restrictions (Xantcha - must attack each combat, can't attack owner)
    if (pending.mustAttackEachCombat) {
      (permanent as any).mustAttackEachCombat = true;
      debug(2, `[confirmControlChangeOpponent] ${pending.cardName} must attack each combat`);
    }
    
    if (pending.cantAttackOwner) {
      (permanent as any).cantAttackOwner = true;
      (permanent as any).ownerId = pending.playerId; // Track original owner for attack restriction
      debug(2, `[confirmControlChangeOpponent] ${pending.cardName} can't attack its owner (${pending.playerId})`);
    }
    
    // Remove summoning sickness if the new controller already had control this turn
    // (For now, creature keeps summoning sickness when changing control)
    
    let messageText = `🔄 Control of ${pending.cardName} changed from ${getPlayerName(game, oldController)} to ${getPlayerName(game, targetOpponentId)}.`;
    if (pending.goadsOnChange) {
      messageText += ` ${pending.cardName} is goaded.`;
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: messageText,
      ts: Date.now(),
    });

    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }

    appendEvent(gameId, (game as any).seq ?? 0, "confirmControlChangeOpponent", {
      playerId: pid,
      activationId,
      permanentId: pending.permanentId,
      cardName: pending.cardName,
      oldController,
      newController: targetOpponentId,
      drewCards: pending.drawCards || 0,
      goaded: pending.goadsOnChange || false,
      mustAttackEachCombat: pending.mustAttackEachCombat || false,
      cantAttackOwner: pending.cantAttackOwner || false,
    });

    broadcastGame(io, game, gameId);
  });

  // Mana Distribution Confirmation (Graven Cairns, Storage Counters, etc.)
  socket.on("confirmManaDistribution", ({ gameId, permanentId, distribution }: {
    gameId: string;
    permanentId: string;
    distribution: Record<string, number>;
  }) => {
    const game = ensureGame(gameId);
    if (!game || !game.state) return;

    const pid = socket.data.playerId as PlayerID;
    if (!pid) {
      socket.emit("error", { code: "NO_PLAYER_ID", message: "No player ID associated with this socket" });
      return;
    }

    // Find the pending activation
    const pendingActivations = game.state.pendingManaActivations || {};
    let activationId: string | undefined;
    let pending: any;

    for (const [id, activation] of Object.entries(pendingActivations)) {
      if ((activation as any).permanentId === permanentId && (activation as any).playerId === pid) {
        activationId = id;
        pending = activation;
        break;
      }
    }

    if (!activationId || !pending) {
      socket.emit("error", { code: "INVALID_ACTIVATION", message: "Invalid or expired mana activation" });
      return;
    }

    // Validate distribution adds up to totalAmount
    const totalDistributed = Object.values(distribution).reduce((sum, val) => sum + val, 0);
    if (totalDistributed !== pending.totalAmount) {
      socket.emit("error", {
        code: "INVALID_DISTRIBUTION",
        message: `Total mana distributed (${totalDistributed}) doesn't match required amount (${pending.totalAmount})`,
      });
      return;
    }

    // Validate all colors are allowed
    const colorMap: Record<string, string> = {
      W: 'white',
      U: 'blue',
      B: 'black',
      R: 'red',
      G: 'green',
    };
    
    for (const [color, amount] of Object.entries(distribution)) {
      if (amount > 0 && !pending.availableColors.includes(color)) {
        socket.emit("error", {
          code: "INVALID_COLOR",
          message: `${color} is not an available color for this ability`,
        });
        return;
      }
    }

    // If this is a storage counter activation, remove the counters
    if (pending.isStorageCounter) {
      const battlefield = game.state?.battlefield || [];
      const permanent = battlefield.find((p: any) => p?.id === permanentId);
      if (permanent) {
        const counterType = SPECIAL_LAND_ABILITIES[pending.cardName.toLowerCase()]?.counterType;
        if (counterType && (permanent as any).counters?.[counterType]) {
          (permanent as any).counters[counterType] = Math.max(0, (permanent as any).counters[counterType] - pending.totalAmount);
          if ((permanent as any).counters[counterType] === 0) {
            delete (permanent as any).counters[counterType];
          }
        }
      }
    }

    // Add mana to pool according to distribution
    game.state.manaPool = game.state.manaPool || {};
    game.state.manaPool[pid] = game.state.manaPool[pid] || {
      white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
    };

    for (const [color, amount] of Object.entries(distribution)) {
      if (amount > 0) {
        const colorName = colorMap[color];
        if (colorName) {
          (game.state.manaPool[pid] as any)[colorName] = 
            ((game.state.manaPool[pid] as any)[colorName] || 0) + amount;
        }
      }
    }

    // Build chat message
    const manaStrings: string[] = [];
    for (const [color, amount] of Object.entries(distribution)) {
      if (amount > 0) {
        manaStrings.push(`{${color.repeat(amount)}}`);
      }
    }
    const manaText = manaStrings.join(', ');

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} added ${manaText} to their mana pool from ${pending.cardName}.`,
      ts: Date.now(),
    });

    // Clean up pending activation
    delete (pendingActivations as any)[activationId];

    // Bump game sequence
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }

    // Broadcast mana pool update
    broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, 'Added mana from ability', game);
    broadcastGame(io, game, gameId);
  });

  // Cycling - discard a card from hand, pay cost, and draw a card
  // Properly uses the stack per MTG rules (Rule 702.29)
  socket.on("activateCycling", ({ gameId, cardId }: { gameId: string; cardId: string }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const zones = (game.state as any)?.zones?.[pid];
    if (!zones || !zones.hand) {
      socket.emit("error", {
        code: "NO_HAND",
        message: "You have no hand to cycle from",
      });
      return;
    }

    // Find the card in hand
    const handIndex = zones.hand.findIndex((c: any) => c.id === cardId);
    if (handIndex === -1) {
      socket.emit("error", {
        code: "CARD_NOT_IN_HAND",
        message: "Card not found in hand",
      });
      return;
    }

    const card = zones.hand[handIndex];
    const cardName = card.name || "Unknown";
    const oracleText = (card.oracle_text || "").toLowerCase();

    // Parse cycling cost
    const cyclingMatch = oracleText.match(/cycling\s*(\{[^}]+\})/i);
    if (!cyclingMatch) {
      socket.emit("error", {
        code: "NO_CYCLING",
        message: `${cardName} does not have cycling`,
      });
      return;
    }

    const cyclingCostStr = cyclingMatch[1];
    const parsedCost = parseManaCost(cyclingCostStr);
    const manaPool = getOrInitManaPool(game.state, pid);

    // Check if player can pay the cycling cost
    const totalAvailable = calculateTotalAvailableMana(manaPool, undefined);
    const validationError = validateManaPayment(
      totalAvailable,
      parsedCost.colors,
      parsedCost.generic
    );

    if (validationError) {
      socket.emit("error", {
        code: "INSUFFICIENT_MANA",
        message: validationError,
      });
      return;
    }

    // Consume the mana from the pool (costs are paid when activating)
    consumeManaFromPool(manaPool, parsedCost.colors, parsedCost.generic);

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} paid ${cyclingCostStr} to cycle ${cardName}.`,
      ts: Date.now(),
    });

    // Discard the card (cost is paid immediately)
    zones.hand.splice(handIndex, 1);
    zones.graveyard = zones.graveyard || [];
    zones.graveyard.push({ ...card, zone: "graveyard" });
    zones.handCount = zones.hand.length;
    zones.graveyardCount = zones.graveyard.length;

    // Put cycling ability on the stack (per MTG rules - Rule 702.29a)
    // "Cycling is an activated ability that functions only while the card with cycling is in a player's hand"
    // "Cycling {cost} means {cost}, Discard this card: Draw a card"
    game.state.stack = game.state.stack || [];
    const abilityStackId = `ability_cycling_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    game.state.stack.push({
      id: abilityStackId,
      type: 'ability',
      controller: pid,
      source: cardId, // The card that was cycled
      sourceName: cardName,
      description: `Draw a card`,
      abilityType: 'cycling',
      cardId: cardId,
      cardName: cardName,
    } as any);

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} activated cycling on ${cardName} (on the stack).`,
      ts: Date.now(),
    });

    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }

    appendEvent(gameId, (game.state as any).seq ?? 0, "activateCycling", {
      playerId: pid,
      cardId,
      cardName,
      cyclingCost: cyclingCostStr,
      stackId: abilityStackId,
    });

    broadcastGame(io, game, gameId);
  });
}
