import { enqueueEdictCreatureSacrificeStep } from './sacrifice-resolution.js';
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
import { getDeathTriggers, getPlayersWhoMustSacrifice, getLandfallTriggers, getETBTriggersForPermanent, getLoyaltyActivationLimit, detectUtilityLandAbility } from "../state/modules/triggered-abilities";
import { triggerETBEffectsForToken } from "../state/modules/stack";
import { 
  getManaAbilitiesForPermanent, 
  getManaMultiplier, 
  getExtraManaProduction, 
  getDevotionManaAmount, 
  getCreatureCountManaAmount,
  detectManaModifiers
} from "../state/modules/mana-abilities";
import { canPayManaCost } from "../state/modules/mana-check.js";
import { exchangePermanentOracleText, parseWordNumber } from "../state/utils";
import { ResolutionQueueManager, ResolutionStepType } from "../state/resolution/index.js";
import { parseUpgradeAbilities as parseCreatureUpgradeAbilities } from "../../../rules-engine/src/creatureUpgradeAbilities";
import { isAIPlayer } from "./ai.js";
import { getActivatedAbilityConfig } from "../../../rules-engine/src/cards/activatedAbilityCards.js";
import { creatureHasHaste } from "./game-actions.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";
import { registerManaHandlers } from "./mana-handlers.js";
import { parseTargetRequirements } from "../rules-engine/targeting.js";
import { requestPlayerSelection } from "./player-selection.js";
import { triggerAbilityActivatedTriggers } from "../state/modules/triggers/ability-activated.js";

function cardHasSplitSecond(card: any): boolean {
  if (!card) return false;
  const keywords = Array.isArray(card.keywords) ? card.keywords : [];
  const oracleText = String(card.oracle_text || '').toLowerCase();
  return keywords.some((k: any) => String(k).toLowerCase() === 'split second') || oracleText.includes('split second');
}

function isSplitSecondLockActive(state: any): boolean {
  const stack = state?.stack;
  if (!Array.isArray(stack) || stack.length === 0) return false;
  for (const item of stack) {
    const card = item?.card ?? item?.spell?.card ?? item?.sourceCard ?? item?.source?.card;
    if (cardHasSplitSecond(card)) return true;
  }
  return false;
}

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
    const countStr = tapCreaturesMatch[1];
    result.tapCount = parseWordNumber(countStr, 1);
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
      const entersTapped = text.includes('battlefield tapped') || text.includes('enters tapped');
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
      const entersTapped = text.includes('battlefield tapped') || text.includes('enters tapped');
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
             text.includes('enters the battlefield') ||
             text.includes('enters tapped')) {
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
  // Legacy scry handlers removed - now using resolution queue system
  // See processPendingScry() in resolution.ts
  
  // surveilResolve continued from removed handler (keeping for any remaining references)
  // TODO: Clean up after verifying no dependencies

  // Legacy confirmPonder handler removed - now handled via Resolution Queue.
  // See processPendingPonder() and handlePonderEffectResponse() in resolution.ts.


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

    // Migrate legacy explorePrompt flow to Resolution Queue.
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.EXPLORE_DECISION,
      playerId: pid as any,
      mandatory: true,
      sourceId: permanentId,
      sourceName: exploringName,
      description: `${exploringName} explores`,
      permanentId,
      permanentName: exploringName,
      revealedCard,
      isLand,
    } as any);

    // Announce the reveal to all players
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)}'s ${exploringName} explores, revealing ${revealedCard.name}${isLand ? " (land)" : ""}.`,
      ts: Date.now(),
    });
  });

  // Batch Explore: Handle multiple creatures exploring at once (e.g., Hakbal triggers)
  // NOTE: This implementation peeks at the top card multiple times (once in beginBatchExplore
  // and once in the Resolution Queue response handler). This is acceptable because
  // peekTopN doesn't modify the library - it only reveals what's there. The actual card
  // movement happens when the Resolution Queue step is completed via applyEvent("exploreResolve").
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

    // Migrate legacy batchExplorePrompt flow to Resolution Queue.
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.BATCH_EXPLORE_DECISION,
      playerId: pid as any,
      mandatory: true,
      sourceName: 'Explore',
      description: `Resolve ${explores.length} explore decision${explores.length === 1 ? '' : 's'}`,
      explores,
    } as any);

    const revealedNames = explores.map(e => e.revealedCard.name).join(", ");
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)}'s creatures explore, revealing ${revealedNames}.`,
      ts: Date.now(),
    });
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
    
    // Migrate legacy librarySearchRequest flow to Resolution Queue.
    const moveToStr = String(moveTo || 'hand');
    const entersTapped = moveToStr === 'battlefield_tapped' || moveToStr.endsWith('_tapped');
    const destination: any = moveToStr.startsWith('battlefield') ? 'battlefield'
      : moveToStr === 'graveyard' ? 'graveyard'
      : moveToStr === 'exile' ? 'exile'
      : moveToStr === 'top' ? 'top'
      : moveToStr === 'bottom' ? 'bottom'
      : 'hand';

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.LIBRARY_SEARCH,
      playerId: pid as PlayerID,
      sourceName: title || 'Search Library',
      description: finalDescription || undefined,
      searchCriteria: title || 'Search your library',
      minSelections: 0,
      maxSelections: maxSelections || 1,
      mandatory: false,
      destination,
      reveal: false,
      shuffleAfter: shuffleAfter !== false,
      availableCards: searchableCards,
      entersTapped,
      filter,
      searchRestrictions: {
        limitedToTop: searchCheck.limitToTop,
        paymentRequired: searchCheck.paymentRequired,
        triggerEffects: searchCheck.triggerEffects,
        controlledBy: searchCheck.controlledBy,
      },
    } as any);
  });

  // Handle graveyard ability activation
  socket.on("activateGraveyardAbility", ({ gameId, cardId, abilityId }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);

    // Split Second: players can't cast spells or activate non-mana abilities.
    if (isSplitSecondLockActive(game.state)) {
      socket.emit('error', {
        code: 'SPLIT_SECOND_LOCK',
        message: "Can't activate abilities while a spell with split second is on the stack.",
      });
      return;
    }
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
    const oracleText = (card?.oracle_text || "").toLowerCase();
    
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
      
      // Check for creature tap costs (Summon the School style: "Tap four untapped Merfolk you control:")
      // Pattern: "Tap X untapped [Type] you control: Return this card from your graveyard to your hand"
      const tapCreatureCostMatch = oracleText.match(/tap (\w+|\d+) untapped (\w+)(?:s)? you control:\s*return\s+(?:this card|~|it)\s+from\s+(?:your\s+)?graveyard/i);
      if (tapCreatureCostMatch) {
        const countStr = tapCreatureCostMatch[1];
        const creatureType = tapCreatureCostMatch[2].toLowerCase();
        const tapCount = parseWordNumber(countStr, 1);
        
        // Find untapped creatures of the required type
        const untappedCreatures = findUntappedPermanentsWithCreatureType(
          game.state.battlefield || [],
          pid,
          creatureType
        );
        
        if (untappedCreatures.length < tapCount) {
          socket.emit("error", {
            code: "INSUFFICIENT_CREATURES",
            message: `Need ${tapCount} untapped ${creatureType}(s), but you only have ${untappedCreatures.length}.`,
          });
          return;
        }
        
        // Unified Resolution Queue prompt
        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, pid as any)
          .find((s: any) => (s as any)?.tapCreaturesCost === true && String((s as any)?.cardId || '') === String(cardId));

        if (!existing) {
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.TARGET_SELECTION,
            playerId: pid as PlayerID,
            sourceName: cardName,
            sourceId: cardId,
            sourceImage: (card as any)?.image_uris?.small || (card as any)?.image_uris?.normal,
            description: `Tap ${tapCount} untapped ${creatureType}${tapCount > 1 ? 's' : ''} you control to return ${cardName} from your graveyard to your hand.`,
            mandatory: false,
            validTargets: untappedCreatures.map((c: any) => ({
              id: c.id,
              label: c.card?.name || 'Creature',
              description: c.card?.type_line || 'Creature',
              imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
            })),
            targetTypes: ['tap_cost'],
            minTargets: tapCount,
            maxTargets: tapCount,
            targetDescription: `untapped ${creatureType}${tapCount > 1 ? 's' : ''} you control`,
            tapCreaturesCost: true,
            cardId,
            abilityId,
            creatureType,
            requiredCount: tapCount,
          } as any);
        }
        
        broadcastGame(io, game, gameId);
        return;
      }
      
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
        
        // Queue library search via Resolution Queue
        const isSplit = tutorInfo.splitDestination === true;
        const destination: any = (tutorInfo.destination === 'battlefield' || tutorInfo.destination === 'battlefield_tapped') ? 'battlefield'
          : (tutorInfo.destination === 'exile') ? 'exile'
          : 'hand';
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.LIBRARY_SEARCH,
          playerId: pid as PlayerID,
          sourceName: `${cardName}`,
          description: tutorInfo.searchCriteria ? `Search for: ${tutorInfo.searchCriteria}` : 'Search your library',
          searchCriteria: tutorInfo.searchCriteria || 'any card',
          minSelections: 0,
          maxSelections: tutorInfo.maxSelections || (isSplit ? 2 : 1),
          mandatory: false,
          destination,
          reveal: false,
          shuffleAfter: true,
          availableCards: library,
          filter,
          splitDestination: isSplit,
          toBattlefield: tutorInfo.toBattlefield || 1,
          toHand: tutorInfo.toHand || 1,
          entersTapped: tutorInfo.entersTapped || false,
        } as any);
        
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
    } else if (abilityId === "exile-to-add-counters" || oracleText.includes("exile this card from your graveyard") && oracleText.includes("counter")) {
      // Cards like Valiant Veteran: "{3}{W}{W}, Exile this card from your graveyard: Put a +1/+1 counter on each Soldier you control."
      // Parse the creature type from oracle text
      const counterMatch = oracleText.match(/put a \+1\/\+1 counter on each (\w+) you control/i);
      const creatureType = counterMatch ? counterMatch[1] : null;
      
      // Parse mana cost from oracle text - simplified pattern to avoid regex backtracking
      const costMatch = oracleText.match(/(\{[^}]+\}(?:[,\s]*\{[^}]+\})*)[,\s]*exile this card from your graveyard/i);
      
      if (costMatch) {
        const manaCost = costMatch[1];
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
      
      // Remove from graveyard
      zones.graveyard.splice(cardIndex, 1);
      zones.graveyardCount = zones.graveyard.length;
      
      // Move to exile
      zones.exile = zones.exile || [];
      zones.exile.push({ ...card, zone: "exile" });
      
      // If we have a creature type, add +1/+1 counters to those creatures
      let countersAdded = 0;
      if (creatureType) {
        const battlefield = game.state?.battlefield || [];
        for (const perm of battlefield) {
          if (perm.controller !== pid) continue;
          const typeLine = (perm.card?.type_line || "").toLowerCase();
          // Check if the permanent is a creature of the specified type
          const creatureTypePattern = new RegExp(`\\b${creatureType.toLowerCase()}s?\\b`, 'i');
          if (typeLine.includes("creature") && creatureTypePattern.test(typeLine)) {
            // Cast to any to bypass readonly restriction on counters
            const permCounters = (perm.counters || {}) as Record<string, number>;
            permCounters["+1/+1"] = (permCounters["+1/+1"] || 0) + 1;
            (perm as any).counters = permCounters;
            countersAdded++;
          }
        }
      }
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
        playerId: pid,
        cardId,
        abilityId: "exile-to-add-counters",
        creatureType,
        countersAdded,
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} exiled ${cardName} from graveyard, putting a +1/+1 counter on ${countersAdded} ${creatureType || "creature"}${countersAdded !== 1 ? "s" : ""}.`,
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
        
        // Queue library search via Resolution Queue
        const isSplit = tutorInfo.splitDestination === true;
        const destination: any = (tutorInfo.destination === 'battlefield' || tutorInfo.destination === 'battlefield_tapped') ? 'battlefield'
          : (tutorInfo.destination === 'exile') ? 'exile'
          : 'hand';
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.LIBRARY_SEARCH,
          playerId: pid as PlayerID,
          sourceName: `${cardName}`,
          description: tutorInfo.searchCriteria ? `Search for: ${tutorInfo.searchCriteria}` : 'Search your library',
          searchCriteria: tutorInfo.searchCriteria || 'any card',
          minSelections: 0,
          maxSelections: tutorInfo.maxSelections || (isSplit ? 2 : 1),
          mandatory: false,
          destination,
          reveal: false,
          shuffleAfter: true,
          availableCards: library,
          filter,
          splitDestination: isSplit,
          toBattlefield: tutorInfo.toBattlefield || 1,
          toHand: tutorInfo.toHand || 1,
          entersTapped: tutorInfo.entersTapped || false,
        } as any);
        
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

    // Intervening-if support: record that this player tapped a nonland permanent this turn.
    // Conservative: only mark true on positive evidence.
    try {
      if (!isLand) {
        (game.state as any).tappedNonlandPermanentThisTurnByPlayer = (game.state as any).tappedNonlandPermanentThisTurnByPlayer || {};
        (game.state as any).tappedNonlandPermanentThisTurnByPlayer[String(pid)] = true;
      }
    } catch {}
    
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
        
        // Handle activation cost (like Three Tree City's {2})
        if ((creatureCountMana as any).activationCost) {
          const activationCost = (creatureCountMana as any).activationCost;
          const parsedCost = parseManaCost(activationCost);
          const pool = getOrInitManaPool(game.state, pid);
          const totalAvailable = calculateTotalAvailableMana(pool, []);
          
          // Validate mana payment
          const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
          if (validationError) {
            socket.emit("error", {
              code: "INSUFFICIENT_MANA",
              message: `Cannot pay activation cost ${activationCost}: ${validationError}`,
            });
            return;
          }
          
          // Consume mana for activation cost
          consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, `[tapPermanent:${cardName}]`);
          
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `${getPlayerName(game, pid)} paid ${activationCost} for ${cardName}'s ability.`,
            ts: Date.now(),
          });
        }
        
        // Handle special 'any_combination' color (like Selvala, Three Tree City)
        // Also handle 'any_one_color' (like White Lotus Tile)
        if (creatureCountMana.color === 'any_combination' || 
            creatureCountMana.color === 'any_one_color' ||
            creatureCountMana.color.startsWith('combination:')) {
          // Resolution Queue: request a color choice from player
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.MANA_COLOR_SELECTION,
            playerId: pid as PlayerID,
            sourceId: permanentId,
            sourceName: cardName,
            sourceImage: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
            description: `Choose a color for ${cardName}'s mana.`,
            mandatory: true,
            selectionKind: 'any_color',
            permanentId,
            cardName,
            amount: totalAmount,
            allowedColors: ['W', 'U', 'B', 'R', 'G'],
            singleColor: true,
          } as any);
          
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `${getPlayerName(game, pid)} tapped ${cardName} for ${totalAmount} mana (choose a color).`,
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

                // Track life lost this turn.
                try {
                  (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
                  (game.state as any).lifeLostThisTurn[String(pid)] = ((game.state as any).lifeLostThisTurn[String(pid)] || 0) + Number(cost.amount);
                } catch {}
                
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

            // Track per-turn damage and life lost.
            try {
              (game.state as any).damageTakenThisTurnByPlayer = (game.state as any).damageTakenThisTurnByPlayer || {};
              (game.state as any).damageTakenThisTurnByPlayer[String(pid)] =
                ((game.state as any).damageTakenThisTurnByPlayer[String(pid)] || 0) + Number(damageAmount || 0);

              (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
              (game.state as any).lifeLostThisTurn[String(pid)] =
                ((game.state as any).lifeLostThisTurn[String(pid)] || 0) + Number(damageAmount || 0);
            } catch {}
            
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
            
            // Resolution Queue: request a color choice from player
            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.MANA_COLOR_SELECTION,
              playerId: pid as PlayerID,
              sourceId: permanentId,
              sourceName: cardName,
              sourceImage: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
              description: `Choose a color for ${cardName}'s mana.`,
              mandatory: true,
              selectionKind: 'any_color',
              permanentId,
              cardName,
              amount: finalTotal,
              allowedColors: produces,
            } as any);
            
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
            // Use ability.amount if specified (e.g., Sol Ring produces 2), default to 1
            const baseAmount = ability.amount ?? 1;
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
            } else if (baseAmount > 1) {
              message += ` for ${baseAmount} {${manaColor}} mana.`;
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
              enqueueEdictCreatureSacrificeStep(io as any, game as any, gameId, targetPlayerId, {
                sourceName: trigger.source.cardName,
                sourceControllerId: trigger.source.controllerId,
                reason: trigger.effect,
                sourceId: trigger.source.permanentId,
              });
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
      
      // Queue library search via Resolution Queue
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: pid as PlayerID,
        sourceName: `${cardName}`,
        description: searchDescription,
        searchCriteria: searchDescription,
        minSelections: 0,
        maxSelections: 1,
        mandatory: false,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: true,
        availableCards: library,
        filter,
        entersTapped: false,
      } as any);
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
    const splitSecondLockActive = isSplitSecondLockActive(game.state);
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

    const { isAbilityActivationProhibitedByChosenName } = await import('../state/modules/chosen-name-restrictions.js');
    
    // ========================================================================
    // Handle Special Land Activated Abilities
    // ========================================================================
    const specialLandConfig = SPECIAL_LAND_ABILITIES[cardName.toLowerCase()];

    // If a special land ability will return early, we still need to enforce chosen-name activation lockouts.
    // Best-effort mapping for our special ability IDs.
    const isSpecialLandManaAbility =
      (specialLandConfig?.type === 'hybrid_mana_production' && abilityId.includes('hybrid-mana')) ||
      (specialLandConfig?.type === 'storage_counter' && abilityId.includes('remove-counters'));

    const earlyRestriction = isAbilityActivationProhibitedByChosenName(game.state, pid as any, cardName, isSpecialLandManaAbility);
    if (earlyRestriction.prohibited) {
      const blocker = earlyRestriction.by?.sourceName || 'an effect';
      socket.emit('error', {
        code: 'CANNOT_ACTIVATE_CHOSEN_NAME',
        message: `Activated abilities of sources named "${cardName}" can't be activated (${blocker} chose that name).`,
      });
      return;
    }
    
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
      
      // Resolution Queue: prompt player to choose how to distribute the mana
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.MANA_COLOR_SELECTION,
        playerId: pid as PlayerID,
        sourceId: permanentId,
        sourceName: cardName,
        sourceImage: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
        description: `Choose how to distribute ${specialLandConfig.totalMana} mana from ${cardName}.`,
        mandatory: true,
        selectionKind: 'distribution',
        permanentId,
        cardName,
        availableColors: specialLandConfig.colors!,
        totalAmount: specialLandConfig.totalMana!,
        message: `Choose how to distribute ${specialLandConfig.totalMana} mana from ${cardName}.`,
      } as any);
      
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
        
        // Tap the permanent first
        (permanent as any).tapped = true;
        
        // Resolution Queue: prompt player to distribute mana (and consume counters)
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.MANA_COLOR_SELECTION,
          playerId: pid as PlayerID,
          sourceId: permanentId,
          sourceName: cardName,
          sourceImage: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
          description: `Remove ${storageCounters} ${specialLandConfig.counterType} counter${storageCounters !== 1 ? 's' : ''} to add ${storageCounters} mana.`,
          mandatory: true,
          selectionKind: 'distribution',
          permanentId,
          cardName,
          availableColors: specialLandConfig.colors!,
          totalAmount: storageCounters,
          message: `Remove ${storageCounters} ${specialLandConfig.counterType} counter${storageCounters !== 1 ? 's' : ''} to add ${storageCounters} mana.`,
          isStorageCounter: true,
          counterType: specialLandConfig.counterType,
          removeCounterCount: storageCounters,
        } as any);
        
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
      // Split Second: playing/casting is not allowed.
      if (splitSecondLockActive) {
        socket.emit('error', {
          code: 'SPLIT_SECOND_LOCK',
          message: "Can't cast spells or activate non-mana abilities while a spell with split second is on the stack.",
        });
        return;
      }

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
      // Split Second: can't activate non-mana abilities.
      if (splitSecondLockActive) {
        socket.emit('error', {
          code: 'SPLIT_SECOND_LOCK',
          message: "Can't activate abilities while a spell with split second is on the stack.",
        });
        return;
      }

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

      // Unified Resolution Queue prompt
      const existing = ResolutionQueueManager
        .getStepsForPlayer(gameId, pid as any)
        .find((s: any) => s?.type === ResolutionStepType.TARGET_SELECTION && (s as any)?.equipAbility === true && String((s as any)?.equipmentId || s?.sourceId) === String(permanentId));

      if (!existing) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: pid as PlayerID,
          sourceId: permanentId,
          sourceName: cardName,
          sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
          description: `Choose a creature to equip ${cardName} to (${equipType ? `equip ${equipType} creature ` : ''}${equipCost}).`,
          mandatory: false,
          validTargets: validTargets.map((c: any) => ({
            id: c.id,
            label: `${c.card?.name || 'Creature'} (${getEffectivePower(c)}/${getEffectiveToughness(c)})`,
            description: c.card?.type_line || 'Creature',
            imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
          })),
          targetTypes: ['equip_target'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: equipType ? `${equipType} creature you control` : 'creature you control',

          // Custom payload consumed by socket/resolution.ts
          equipAbility: true,
          equipmentId: permanentId,
          equipmentName: cardName,
          equipCost,
          equipType,
          targetsOpponentCreatures: false,
        } as any);
      }

      debug(2, `[activateBattlefieldAbility] Equip ability on ${cardName}: queued TARGET_SELECTION (cost=${equipCost}, type=${equipType || 'any'})`);
      broadcastGame(io, game, gameId);
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

      // Unified Resolution Queue prompt
      const existing = ResolutionQueueManager
        .getStepsForPlayer(gameId, pid as any)
        .find((s: any) => s?.type === ResolutionStepType.TARGET_SELECTION && (s as any)?.grantAbility === true && String(s?.sourceId) === String(permanentId));

      if (!existing) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: pid as PlayerID,
          sourceId: permanentId,
          sourceName: cardName,
          sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
          description: `${cardName}: Choose a target creature ${targetsOpponentCreatures ? 'an opponent controls' : 'you control'} to gain ${abilityGranted} until end of turn.`,
          mandatory: false,
          validTargets: validTargets.map((c: any) => ({
            id: c.id,
            label: `${c.card?.name || 'Creature'} (${getEffectivePower(c)}/${getEffectiveToughness(c)})`,
            description: c.card?.type_line || 'Creature',
            imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
          })),
          targetTypes: ['ability_grant_target'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: targetsOpponentCreatures ? "creature an opponent controls" : "creature you control",

          // Custom payload consumed by socket/resolution.ts
          grantAbility: true,
          grantAbilityCost: costStr,
          abilityGranted,
          targetsOpponentCreatures,
        } as any);
      }

      debug(2, `[activateBattlefieldAbility] Ability grant on ${cardName}: queued TARGET_SELECTION (ability="${abilityGranted}")`);
      broadcastGame(io, game, gameId);
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

      // Build a flat list of all cards currently in all graveyards.
      // If there are no legal targets, don't allow the activation.
      const zonesAll = (game.state as any)?.zones || {};
      const playersAll: any[] = Array.isArray((game.state as any)?.players) ? (game.state as any).players : [];
      const graveyardTargets: any[] = [];

      for (const p of playersAll) {
        const pId = String(p?.id || '');
        if (!pId) continue;
        const pZones = zonesAll?.[pId];
        const gy = pZones && Array.isArray(pZones.graveyard) ? pZones.graveyard : [];
        for (const c of gy) {
          if (!c || !c.id) continue;
          graveyardTargets.push({
            id: String(c.id),
            label: `${String(c.name || 'Card')} (${getPlayerName(game, pId)})`,
            description: String(c.type_line || 'Card'),
            imageUrl: c.image_uris?.small || c.image_uris?.normal,
          });
        }
      }

      if (graveyardTargets.length === 0) {
        socket.emit("error", {
          code: "NO_VALID_TARGETS",
          message: "No cards in any graveyard to exile",
        });
        return;
      }
      
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

      // Prompt via Resolution Queue (single unified UI).
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: pid as any,
        sourceId: permanentId,
        sourceName: cardName,
        sourceImage: (permanent as any)?.card?.image_uris?.small || (permanent as any)?.card?.image_uris?.normal,
        description: `Choose a card to exile from a graveyard (${cost})`,
        mandatory: true,
        validTargets: graveyardTargets,
        targetTypes: ['graveyard_card'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'card in a graveyard',

        // Custom payload consumed by socket/resolution.ts
        graveyardExileAbility: true,
        permanentId,
        cardName,
        cost,
      } as any);

      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }
      broadcastGame(io, game, gameId);
      debug(2, `[activateBattlefieldAbility] Graveyard exile ability on ${cardName}: paid ${cost}, queued TARGET_SELECTION (${graveyardTargets.length} targets)`);
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

      // Queue opponent selection via Resolution Queue (ResolutionStepType.PLAYER_CHOICE)
      // The queued step carries effectData so the response can apply the control change.
      requestPlayerSelection(
        io,
        gameId,
        pid as any,
        cardName,
        oracleText,
        {
          type: 'control_change',
          permanentId,
          drawCards: drawCount,
        },
        true,
        false
      );
      
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
      
      // Queue fight target selection via Resolution Queue
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.FIGHT_TARGET,
        playerId: pid as PlayerID,
        sourceId: permanentId,
        sourceName: cardName,
        sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
        description: oracleText,
        mandatory: true,
        targetFilter: {
          types: ['creature'],
          controller: fightController,
          excludeSource: true,
        },
        title: `${cardName} - Fight`,
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

      // Compute valid targets now (client no longer listens for bespoke counterTargetRequest).
      const battlefield = game.state?.battlefield || [];
      const targetTypeLower = String(targetType || '').toLowerCase();
      const wantsCreature = targetTypeLower.includes('creature');

      const validTargets = (Array.isArray(battlefield) ? battlefield : []).filter((perm: any) => {
        if (!perm || typeof perm.id !== 'string') return false;
        if (wantsCreature) {
          const tl = String(perm.card?.type_line || '').toLowerCase();
          if (!tl.includes('creature')) return false;
        }
        if (targetController === 'you' && perm.controller !== pid) return false;
        if (targetController === 'opponent' && perm.controller === pid) return false;
        return true;
      }).map((perm: any) => ({
        id: String(perm.id),
        label: String(perm.card?.name || 'permanent'),
        description: 'permanent',
        imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
      }));

      // Queue target selection via Resolution Queue
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.COUNTER_TARGET,
        playerId: pid as PlayerID,
        sourceId: permanentId,
        sourceName: cardName,
        sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
        description: oracleText,
        mandatory: true,
        counterType,
        targetController,
        oracleText,
        scalingText,
        validTargets,
        targetTypes: wantsCreature ? ['creature'] : ['permanent'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: targetTypeLower || 'target',
        title: `${cardName} - Add ${counterType} counter`,
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

      // Unified Resolution Queue prompt
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.COUNTER_MOVEMENT,
        playerId: pid as PlayerID,
        sourceId: permanentId,
        sourceName: cardName,
        sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
        description: oracleText,
        mandatory: true,
        sourceFilter: {
          controller: 'you',
          requiresCounters: true,
        },
        targetFilter: {
          controller: 'any',
          excludeSource: true,
        },
        title: cardName,
      });

      debug(2, `[activateBattlefieldAbility] Move counter ability on ${cardName}: ${manaCost ? `paid ${manaCost}, ` : ''}queued counter movement step`);
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

      // Queue tap/untap target selection via Resolution Queue
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TAP_UNTAP_TARGET,
        playerId: pid as PlayerID,
        sourceId: permanentId,
        sourceName: cardName,
        sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
        description: oracleText,
        mandatory: true,
        action: tapUntapParams.action,
        targetFilter: {
          types: tapUntapParams.types as any[],
          controller: tapUntapParams.controller,
          tapStatus: 'any',
          excludeSource: tapUntapParams.excludeSource,
        },
        targetCount: tapUntapParams.count,
        title: cardName,
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

      // Unified Resolution Queue prompt
      const existing = ResolutionQueueManager
        .getStepsForPlayer(gameId, pid as any)
        .find((s: any) => s?.type === ResolutionStepType.TARGET_SELECTION && (s as any)?.crewAbility === true && String(s?.sourceId) === String(permanentId));

      if (!existing) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: pid as PlayerID,
          sourceId: permanentId,
          sourceName: cardName,
          sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
          description: `Crew ${crewPower} — Tap any number of untapped creatures you control with total power ${crewPower} or more.`,
          mandatory: false,
          validTargets: validCrewers.map((c: any) => ({
            id: c.id,
            label: `${c.card?.name || 'Creature'} (${getEffectivePower(c)}/${getEffectiveToughness(c)})`,
            description: c.card?.type_line || 'Creature',
            imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
          })),
          targetTypes: ['crew_creature'],
          minTargets: 1,
          maxTargets: validCrewers.length,
          targetDescription: 'creatures you control to crew',

          // Custom payload consumed by socket/resolution.ts
          crewAbility: true,
          vehicleId: permanentId,
          crewPower,
        } as any);
      }

      debug(2, `[activateBattlefieldAbility] Crew ability on ${cardName}: queued TARGET_SELECTION (need power ${crewPower})`);
      broadcastGame(io, game, gameId);
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

      // Queue counter movement selection via Resolution Queue
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.COUNTER_MOVEMENT,
        playerId: pid as PlayerID,
        sourceId: permanentId,
        sourceName: cardName,
        sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
        description: oracleText,
        mandatory: true,
        sourceFilter: {
          controller: 'you', // Nesting Grounds: "...permanent you control"
        },
        targetFilter: {
          controller: 'any',
          excludeSource: true, // "...onto another target permanent"
        },
        title: cardName,
      });

      debug(2, `[activateBattlefieldAbility] Counter movement ability on ${cardName}: ${manaCost ? `paid ${manaCost}, ` : ''}queued counter movement step`);
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
      // Unified Resolution Queue prompt
      const existing = ResolutionQueueManager
        .getStepsForPlayer(gameId, pid as any)
        .find((s: any) => s?.type === ResolutionStepType.MODE_SELECTION && (s as any)?.multiModeActivation === true && String(s?.sourceId) === String(permanentId));

      if (!existing) {
        const modes = (multiModeAbility.modes || []).map((m: any, idx: number) => ({
          id: String(idx),
          label: `${String(m?.name || 'Mode')} (${String(m?.cost || '').trim() || 'no cost'})`,
          description: String(m?.effect || ''),
        }));

        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.MODE_SELECTION,
          playerId: pid as PlayerID,
          sourceId: permanentId,
          sourceName: cardName,
          sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
          description: `Choose a mode to activate for ${cardName}.`,
          mandatory: false,
          modes,
          minModes: 1,
          maxModes: 1,
          allowDuplicates: false,
          multiModeActivation: true,
          multiModeAbilityId: abilityId,
        } as any);
      }

      debug(2, `[activateBattlefieldAbility] Multi-mode ability on ${cardName}: queued mode selection step`);
      broadcastGame(io, game, gameId);
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

      // Queue creature selection via Resolution Queue
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

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.STATION_CREATURE_SELECTION,
        playerId: pid as PlayerID,
        sourceId: permanentId,
        sourceName: cardName,
        sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
        description: `Tap another untapped creature you control. Put charge counters on ${cardName} equal to that creature's power.`,
        mandatory: true,
        station: {
          id: permanentId,
          name: cardName,
          imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
          threshold: stationThreshold,
          currentCounters: (permanent as any).counters?.charge || 0,
        },
        creatures: creatureOptions,
        title: `Station ${stationThreshold}`,
      });
      
      debug(2, `[activateBattlefieldAbility] Station ability on ${cardName}: prompting for creature selection (${untappedCreatures.length} valid targets)`);

      broadcastGame(io, game, gameId);
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

      // Fire triggers that care about ability activation (e.g., Harsh Mentor, Rings of Brighthearth).
      // Best-effort: non-mana abilities use the stack.
      try {
        triggerAbilityActivatedTriggers(game as any, {
          activatedBy: pid as any,
          sourcePermanentId: permanentId as any,
          isManaAbility: false,
          abilityText: upgrade.fullText,
          stackItemId: stackItem.id,
        });
      } catch {}
      
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
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.MANA_COLOR_SELECTION,
          playerId: pid as PlayerID,
          sourceId: permanentId,
          sourceName: cardName,
          sourceImage: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
          description: `Choose a color for ${cardName}'s mana.`,
          mandatory: true,
          selectionKind: 'any_color',
          permanentId,
          cardName,
          amount: manaAmount,
        } as any);
        
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

        // Track per-turn damage and life lost.
        try {
          (game.state as any).damageTakenThisTurnByPlayer = (game.state as any).damageTakenThisTurnByPlayer || {};
          (game.state as any).damageTakenThisTurnByPlayer[String(pid)] =
            ((game.state as any).damageTakenThisTurnByPlayer[String(pid)] || 0) + 1;

          (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
          (game.state as any).lifeLostThisTurn[String(pid)] = ((game.state as any).lifeLostThisTurn[String(pid)] || 0) + 1;
        } catch {}
        
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
          // Queue opponent choice via Resolution Queue (AI auto-responds in resolution.ts)
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.FORBIDDEN_ORCHARD_TARGET,
            playerId: pid as PlayerID,
            sourceId: permanentId,
            sourceName: 'Forbidden Orchard',
            sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
            description: 'Choose target opponent to create a 1/1 colorless Spirit creature token.',
            mandatory: true,
            opponents: opponents.map((p: any) => ({
              id: String(p.id),
              name: String(p.name || p.id),
            })),
            permanentId,
            cardName: 'Forbidden Orchard',
          });
          
          debug(2, `[activateBattlefieldAbility] Forbidden Orchard: queued target opponent selection for ${pid}`);
          // Do not return early; mana ability processing continues, but the game enters resolution mode.
        }
      }
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      // Broadcast mana pool update to ensure client sees the new floating mana
      broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`, game);

      // Intervening-if support: mark that this ability produced mana this turn (best-effort).
      try {
        const stateAny = game.state as any;
        stateAny.addedManaWithThisAbilityThisTurn = stateAny.addedManaWithThisAbilityThisTurn || {};
        stateAny.addedManaWithThisAbilityThisTurn[String(pid)] = stateAny.addedManaWithThisAbilityThisTurn[String(pid)] || {};
        const permKey = String(permanentId);
        const abilityKeyRaw = abilityId != null ? String(abilityId) : '';
        const k = abilityKeyRaw ? `${permKey}:${abilityKeyRaw}` : permKey;
        (stateAny.addedManaWithThisAbilityThisTurn[String(pid)] as any)[k] = true;
      } catch {}
      
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
      const pwAbilityPattern = /^([+−–—-]?\d+):\s*(.+)/gm;
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
      
      // Check if this ability requires targets
      const targetReqs = parseTargetRequirements(ability.text);
      
      // Get current loyalty (needed for validation)
      const currentLoyalty = (permanent as any).counters?.loyalty || 0;
      const loyaltyCost = ability.loyaltyCost;
      
      // Check if we can pay the cost BEFORE prompting for targets
      // For minus abilities, check we have enough loyalty
      if (loyaltyCost < 0 && currentLoyalty + loyaltyCost < 0) {
        socket.emit("error", {
          code: "INSUFFICIENT_LOYALTY",
          message: `${cardName} has ${currentLoyalty} loyalty, need at least ${Math.abs(loyaltyCost)} to activate this ability`,
        });
        return;
      }
      
      // Check if planeswalker has already activated maximum abilities this turn
      // (Rule 606.3: Only one loyalty ability per turn per planeswalker, unless modified)
      // Chain Veil and Oath of Teferi allow 2 activations per turn
      // IMPORTANT: Increment the counter BEFORE checking to prevent race conditions
      // where clicking twice fast could activate the ability twice
      const activationsThisTurn = (permanent as any).loyaltyActivationsThisTurn || 0;
      const maxActivations = getLoyaltyActivationLimit(game.state, pid);
      
      if (activationsThisTurn >= maxActivations) {
        const extraText = maxActivations > 1 ? ` (max ${maxActivations} with effects)` : '';
        socket.emit("error", {
          code: "LOYALTY_ALREADY_USED",
          message: `${cardName} has already activated ${maxActivations} loyalty ability${maxActivations > 1 ? 'ies' : ''} this turn${extraText}`,
        });
        return;
      }
      
      // Increment the activation counter immediately to prevent double-activation
      (permanent as any).loyaltyActivationsThisTurn = activationsThisTurn + 1;
      
      // If this ability requires targets, prompt for target selection
      if (targetReqs.needsTargets) {
        // Build valid target list based on target type
        let validTargets: { id: string; kind: string; name: string; isOpponent?: boolean; controller?: string; imageUrl?: string }[] = [];
        
        for (const targetType of targetReqs.targetTypes) {
          const battlefield = game.state.battlefield || [];
          const players = game.state.players || [];
          
          switch (targetType.toLowerCase()) {
            case 'creature':
              validTargets.push(...battlefield
                .filter((p: any) => {
                  const typeLine = (p.card?.type_line || '').toLowerCase();
                  return typeLine.includes('creature');
                })
                .map((p: any) => ({
                  id: p.id,
                  kind: 'permanent',
                  name: p.card?.name || 'Creature',
                  controller: p.controller,
                  imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
                })));
              break;
            case 'permanent':
            case 'nonland':
              validTargets.push(...battlefield
                .filter((p: any) => {
                  const typeLine = (p.card?.type_line || '').toLowerCase();
                  if (targetType === 'nonland') return !typeLine.includes('land');
                  return true;
                })
                .map((p: any) => ({
                  id: p.id,
                  kind: 'permanent',
                  name: p.card?.name || 'Permanent',
                  controller: p.controller,
                  imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
                })));
              break;
            case 'player':
            case 'opponent':
              const lifeDict = game.state.life || {};
              const startingLife = game.state.startingLife || 40;
              validTargets.push(...players
                .filter((p: any) => {
                  if (!p || !p.id) return false;
                  if (targetType === 'opponent') return p.id !== pid;
                  return true;
                })
                .map((p: any) => ({
                  id: p.id,
                  kind: 'player',
                  name: p.name || p.id,
                  isOpponent: p.id !== pid,
                  life: lifeDict[p.id] ?? p.life ?? startingLife,
                })));
              break;
            case 'any':
              // Can target creatures, planeswalkers, or players
              validTargets.push(...battlefield
                .filter((p: any) => {
                  const typeLine = (p.card?.type_line || '').toLowerCase();
                  return typeLine.includes('creature') || typeLine.includes('planeswalker');
                })
                .map((p: any) => ({
                  id: p.id,
                  kind: 'permanent',
                  name: p.card?.name || 'Permanent',
                  controller: p.controller,
                  imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
                })));
              // Also add players to 'any' targets
              const anyLifeDict = game.state.life || {};
              const anyStartingLife = game.state.startingLife || 40;
              validTargets.push(...players
                .filter((p: any) => p && p.id)
                .map((p: any) => ({
                  id: p.id,
                  kind: 'player',
                  name: p.name || p.id,
                  isOpponent: p.id !== pid,
                  life: anyLifeDict[p.id] ?? p.life ?? anyStartingLife,
                })));
              break;
            case 'artifact':
            case 'enchantment':
            case 'planeswalker':
            case 'land':
              validTargets.push(...battlefield
                .filter((p: any) => {
                  const typeLine = (p.card?.type_line || '').toLowerCase();
                  return typeLine.includes(targetType);
                })
                .map((p: any) => ({
                  id: p.id,
                  kind: 'permanent',
                  name: p.card?.name || targetType,
                  controller: p.controller,
                  imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
                })));
              break;
          }
        }
        
        // Remove duplicates
        const uniqueTargets = validTargets.filter((t, i, arr) => 
          arr.findIndex(x => x.id === t.id) === i
        );
        
        // ========================================================================
        // Handle "up to X" abilities with no valid targets
        // If minTargets is 0 (e.g., "up to one target creature") and there are no
        // valid targets, proceed with the ability without target selection.
        // This prevents the game from hanging when abilities like Ajani Steadfast's
        // +1 are activated with no creatures on the battlefield.
        // ========================================================================
        if (uniqueTargets.length === 0 && targetReqs.minTargets === 0) {
          debug(2, `[planeswalker] ${cardName} ability has no valid targets but minTargets=0, proceeding without targets`);
          // Fall through to execute the ability without targets
        } else if (uniqueTargets.length < targetReqs.minTargets) {
          // Not enough valid targets and targeting is mandatory
          socket.emit("error", {
            code: "NO_VALID_TARGETS",
            message: `${cardName}'s ability requires at least ${targetReqs.minTargets} target(s) but only ${uniqueTargets.length} are available.`,
          });
          return;
        } else {
          // Use Resolution Queue for target selection (unified system)
          // This replaces the legacy pendingPlaneswalkerAbility pattern
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.TARGET_SELECTION,
            playerId: pid as PlayerID,
            description: `Choose ${targetReqs.targetDescription} for ${cardName}`,
            mandatory: targetReqs.minTargets > 0,
            sourceId: permanentId,
            sourceName: cardName,
            sourceImage: (permanent as any).card?.image_uris?.small || (permanent as any).card?.image_uris?.normal,
            validTargets: uniqueTargets.map(t => ({
              id: t.id,
              name: t.name,
              type: t.kind === 'player' ? 'player' : 'permanent',
              controller: t.controller,
              imageUrl: t.imageUrl,
              life: (t as any).life,
              isOpponent: t.isOpponent,
            })),
            targetTypes: targetReqs.targetTypes,
            minTargets: targetReqs.minTargets,
            maxTargets: targetReqs.maxTargets,
            targetDescription: targetReqs.targetDescription,
            // Store planeswalker-specific data for response handler
            planeswalkerAbility: {
              abilityIndex,
              abilityText: ability.text,
              loyaltyCost,
              currentLoyalty,
            },
          });
          
          debug(2, `[planeswalker] Added TARGET_SELECTION step for ${cardName} ability: ${targetReqs.targetDescription}`);
          return; // Wait for target selection via resolution queue
        }
      }
      
      // Enqueue activation in the resolution queue for unified handling/ordering
      try {
        const step = ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.ACTIVATED_ABILITY,
          playerId: pid as PlayerID,
          description: `${cardName}: ${ability.text}`,
          mandatory: true,
          sourceId: permanentId,
          sourceName: cardName,
          abilityIndex,
          loyaltyCost: ability.loyaltyCost,
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
      
      // Apply loyalty cost and update counters
      const newLoyalty = currentLoyalty + loyaltyCost;
      (permanent as any).counters = (permanent as any).counters || {};
      (permanent as any).counters.loyalty = newLoyalty;
      (permanent as any).loyalty = newLoyalty; // Also update top-level loyalty for client display
      // Note: loyaltyActivationsThisTurn already incremented earlier to prevent race conditions
      
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
    let sacrificeType: 'creature' | 'artifact' | 'enchantment' | 'land' | 'permanent' | 'self' | 'artifact_or_creature' | null = null;
    let sacrificeSubtype: string | undefined = undefined; // For creature subtypes like Soldier, Goblin, etc.
    
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
        sacrificeSubtype = sacrificeInfo.creatureSubtype;
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
          sacrificeSubtype = sacrificeInfo.creatureSubtype;
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
    
    // Check for activation conditions (e.g., Minas Tirith: "Activate only if you attacked with two or more creatures this turn")
    const utilityLandAbility = detectUtilityLandAbility(card, permanent);
    if (utilityLandAbility?.activationCondition) {
      if (utilityLandAbility.activationCondition === 'attacked_with_two_or_more') {
        const creaturesAttacked = (game.state as any).creaturesAttackedThisTurn?.[pid] || 0;
        if (creaturesAttacked < 2) {
          socket.emit("error", {
            code: "ACTIVATION_CONDITION_NOT_MET",
            message: `${cardName}'s ability can only be activated if you attacked with two or more creatures this turn. (You attacked with ${creaturesAttacked})`,
          });
          return;
        }
      }
    }
    
    // Also check oracle text for "activate only if" patterns dynamically
    // IMPORTANT: Check the specific ability text (abilityText) for the condition,
    // as the card may have multiple abilities and only some have restrictions.
    // For Minas Tirith:
    // - Ability 0: "{T}: Add {W}" - no restriction
    // - Ability 1: "{1}{W}, {T}: Draw a card. Activate only if you attacked with two or more creatures this turn."
    // The condition check should match against the full oracle text for ability index, or the specific ability text
    let abilityHasCondition = false;
    let abilityConditionText = '';
    
    // First, check if we're activating a specific ability that has the condition
    if (abilityIndex >= 0 && abilities.length > abilityIndex) {
      // Get the full ability text including any conditions following it in oracle text
      // Since the parsing might not capture the full line, look for the ability cost pattern in oracle text
      const costRegex = new RegExp(`${abilities[abilityIndex].cost.replace(/[{}]/g, '\\$&').replace(/[[\]\\^$.|?*+()]/g, '\\$&')}[^\\n]+`, 'i');
      const fullAbilityMatch = oracleText.match(costRegex);
      abilityConditionText = fullAbilityMatch ? fullAbilityMatch[0] : abilityText;
    } else {
      abilityConditionText = oracleText;
    }
    
    const activateOnlyIfMatch = abilityConditionText.match(/activate only if you attacked with (\w+) or more creatures this turn/i);
    if (activateOnlyIfMatch && !utilityLandAbility?.activationCondition) {
      const requiredCount = activateOnlyIfMatch[1] === 'two' ? 2 : 
                           activateOnlyIfMatch[1] === 'three' ? 3 : 
                           parseInt(activateOnlyIfMatch[1], 10) || 2;
      const creaturesAttacked = (game.state as any).creaturesAttackedThisTurn?.[pid] || 0;
      if (creaturesAttacked < requiredCount) {
        socket.emit("error", {
          code: "ACTIVATION_CONDITION_NOT_MET",
          message: `${cardName}'s ability can only be activated if you attacked with ${requiredCount} or more creatures this turn. (You attacked with ${creaturesAttacked})`,
        });
        return;
      }
      abilityHasCondition = true;
    }
    
    // Log successful activation condition check for debugging
    if (abilityHasCondition || (utilityLandAbility?.activationCondition === 'attacked_with_two_or_more')) {
      const creaturesAttacked = (game.state as any).creaturesAttackedThisTurn?.[pid] || 0;
      debug(2, `[activateBattlefieldAbility] ${cardName} activation condition met: attacked with ${creaturesAttacked} creatures this turn`);
    }

    // ========================================================================
    // Blight as an activated-ability cost (e.g., "{T}, Blight 1: ...")
    // Queue a TARGET_SELECTION step to pay Blight, then resume activation from resolution.ts.
    // ========================================================================
    const blightCostStr = String(manaCost || '');
    const blightCostMatch = blightCostStr.match(/\bblight\s+(\w+)\b/i);
    if (blightCostMatch) {
      const raw = String(blightCostMatch[1] || '').trim();
      if (raw.toLowerCase() === 'x') {
        socket.emit('error', {
          code: 'UNSUPPORTED_COST',
          message: `Cannot activate ${cardName}: Blight X as an activation cost is not supported yet.`,
        });
        return;
      }

      const blightN = parseWordNumber(raw) || parseInt(raw, 10) || 0;
      if (blightN > 0) {
        // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus "Blight N".
        // If the cost contains other text (e.g., sacrifice/discard/exile/tap a creature), reject up-front
        // so we don't take Blight payment and then fail to resume correctly.
        const remainingNonManaCostText = blightCostStr
          .replace(/\{[^}]+\}/g, ' ')
          .replace(/\bblight\s+\w+\b/gi, ' ')
          .replace(/[\s,]+/g, ' ')
          .trim();

        if (remainingNonManaCostText.length > 0) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: Blight cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
          });
          return;
        }

        const validTargets = battlefield
          .filter((p: any) => p && p.controller === pid)
          .filter((p: any) => ((p.card?.type_line || '').toLowerCase().includes('creature')))
          .map((p: any) => ({
            id: p.id,
            label: p.card?.name || 'Creature',
            description: p.card?.type_line || 'creature',
            imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
          }));

        if (validTargets.length === 0) {
          socket.emit('error', {
            code: 'NO_VALID_TARGETS',
            message: `Cannot pay Blight ${blightN} (you control no creatures).`,
          });
          return;
        }

        // Store pending activation to resume after Blight payment.
        const activationId = `blight_activation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        (game.state as any).pendingBlightAbilityActivations = (game.state as any).pendingBlightAbilityActivations || {};
        (game.state as any).pendingBlightAbilityActivations[activationId] = {
          playerId: pid,
          permanentId,
          abilityId,
          cardName,
          abilityText,
          manaCost,
          requiresTap,
          timestamp: Date.now(),
        };

        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: pid as PlayerID,
          description: `${cardName}: Blight ${blightN} — Choose a creature you control to put ${blightN} -1/-1 counter${blightN === 1 ? '' : 's'} on it (cancel to abort activation).`,
          mandatory: false,
          sourceName: cardName,
          sourceImage: (card as any)?.image_uris?.small || (card as any)?.image_uris?.normal,
          validTargets,
          targetTypes: ['creature'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: 'creature you control',

          // Custom payload consumed by resolution.ts.
          keywordBlight: true,
          keywordBlightStage: 'ability_activation_cost',
          keywordBlightController: pid,
          keywordBlightN: blightN,
          keywordBlightSourceName: `${cardName} — Blight ${blightN}`,
          keywordBlightActivationId: activationId,
        } as any);

        debug(2, `[activateBattlefieldAbility] ${cardName} requires Blight ${blightN} as activation cost; queued TARGET_SELECTION (activationId: ${activationId})`);
        broadcastGame(io, game, gameId);
        return;
      }
    }
    
    // Check if sacrifice is required and we need to prompt for selection
    if (sacrificeType && sacrificeType !== 'self') {
      // Get the sacrifice count (default 1)
      const sacrificeInfo = parseSacrificeCost(manaCost || '');
      const sacrificeCount = sacrificeInfo.sacrificeCount || 1;
      const mustBeOther = sacrificeInfo.mustBeOther || false;
      
      // Get eligible permanents for sacrifice
      const eligiblePermanents = battlefield.filter((p: any) => {
        if (p.controller !== pid) return false;
        // If mustBeOther is true, exclude the source permanent
        if (mustBeOther && p.id === permanentId) return false;
        
        const permTypeLine = (p.card?.type_line || '').toLowerCase();
        
        // First check if it matches the basic type requirement
        let matchesType = false;
        switch (sacrificeType) {
          case 'creature':
            matchesType = permTypeLine.includes('creature');
            break;
          case 'artifact':
            matchesType = permTypeLine.includes('artifact');
            break;
          case 'enchantment':
            matchesType = permTypeLine.includes('enchantment');
            break;
          case 'land':
            matchesType = permTypeLine.includes('land');
            break;
          case 'permanent':
            matchesType = true; // Any permanent
            break;
          case 'artifact_or_creature':
            // Match either artifact or creature (e.g., Mondrak's ability)
            matchesType = permTypeLine.includes('artifact') || permTypeLine.includes('creature');
            break;
          default:
            matchesType = false;
        }
        
        if (!matchesType) return false;
        
        // If there's a creature subtype requirement, also check that
        // Subtypes like "Soldier", "Goblin", etc. appear in the type_line after the em-dash
        // Example: "Token Creature — Human Soldier" contains "Soldier" subtype
        if (sacrificeSubtype) {
          const subtypeLower = sacrificeSubtype.toLowerCase();
          // Check if the type line contains the subtype
          // Type line format: "Creature — Human Soldier" or "Token Creature — Goblin Warrior"
          return permTypeLine.includes(subtypeLower);
        }
        
        return true;
      });
      
      // Determine what type label to show in error message
      let sacrificeLabel = sacrificeSubtype ? sacrificeSubtype : sacrificeType;
      let sacrificeLabelPlural = sacrificeLabel + 's';
      if (sacrificeType === 'artifact_or_creature') {
        sacrificeLabel = 'artifact or creature';
        sacrificeLabelPlural = 'artifacts and/or creatures';
      }
      
      if (eligiblePermanents.length < sacrificeCount) {
        socket.emit("error", {
          code: "INSUFFICIENT_SACRIFICE_TARGETS",
          message: `You don't control enough ${sacrificeLabelPlural} to sacrifice. (Need ${sacrificeCount}, have ${eligiblePermanents.length})`,
        });
        return;
      }

      const sacrificeTargets = eligiblePermanents.map((p: any) => ({
        id: p.id,
        label: p.card?.name || 'Unknown',
        description: p.card?.type_line || 'Permanent',
        imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
      }));

      // Unified Resolution Queue prompt
      const existing = ResolutionQueueManager
        .getStepsForPlayer(gameId, pid as any)
        .find((s: any) => s?.type === ResolutionStepType.TARGET_SELECTION && (s as any)?.sacrificeAbilityAsCost === true && String((s as any)?.permanentId || s?.sourceId) === String(permanentId));

      if (!existing) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: pid as PlayerID,
          sourceId: permanentId,
          sourceName: cardName,
          sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
          description: `${cardName}: Sacrifice ${sacrificeCount} ${sacrificeLabelPlural} to activate: ${abilityText}`,
          mandatory: false,
          validTargets: sacrificeTargets,
          targetTypes: ['sacrifice_cost'],
          minTargets: sacrificeCount,
          maxTargets: sacrificeCount,
          targetDescription: `${sacrificeLabelPlural} you control`,

          // Custom payload consumed by socket/resolution.ts
          sacrificeAbilityAsCost: true,
          permanentId,
          cardName,
          abilityText,
          oracleText: (card?.oracle_text || oracleText || ''),
          requiresTap,
          sacrificeType,
          sacrificeSubtype,
          sacrificeCount,
          mustBeOther,
        } as any);
      }

      debug(2, `[activateBattlefieldAbility] ${cardName} requires sacrifice of ${sacrificeCount} ${sacrificeLabel}(s). Queued TARGET_SELECTION.`);
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Tap the permanent if required
    if (requiresTap && !(permanent as any).tapped) {
      (permanent as any).tapped = true;
    }
    
    // Parse and validate mana cost if present
    // Extract just the mana symbols from the cost string (excluding {T}, sacrifice, etc.)
    if (manaCost) {
      // Match all mana symbols including Phyrexian {W/P}, hybrid {W/U}, etc.
      const manaSymbols = manaCost.match(/\{[WUBRGC0-9X\/P]+\}/gi);
      if (manaSymbols) {
        // Filter out {T} and {Q} to get just the mana cost
        const manaOnly = manaSymbols.filter(s => 
          s.toUpperCase() !== '{T}' && s.toUpperCase() !== '{Q}'
        ).join('');
        
        if (manaOnly) {
          const parsedCost = parseManaCost(manaOnly);
          const manaPool = getOrInitManaPool(game.state, pid);
          
          // For Phyrexian mana costs, we need to check if player can pay with mana OR life
          const playerLife = game.state.life?.[pid] || 40;
          
          // Adapt parsedCost for canPayManaCost (uses 'hybrid' instead of 'hybrids')
          const costForCheck = {
            colors: parsedCost.colors,
            generic: parsedCost.generic,
            hasX: parsedCost.hasX,
            hybrid: parsedCost.hybrids, // Map hybrids to hybrid for compatibility
          };
          
          // Check if we can pay the cost (considering Phyrexian mana can be paid with life)
          if (!canPayManaCost(manaPool as unknown as Record<string, number>, costForCheck, playerLife)) {
            socket.emit("error", {
              code: "INSUFFICIENT_MANA",
              message: `Cannot pay ${manaOnly} - insufficient mana or life`,
            });
            return;
          }
          
          // Check if there are Phyrexian mana costs that require a player choice
          // Phyrexian mana can ALWAYS be paid with life (2 life per {X/P}), even if the player has the color
          const phyrexianCosts = (parsedCost.hybrids || []).filter((options: string[]) => 
            options.some(o => o.startsWith('LIFE:'))
          );
          
          if (phyrexianCosts.length > 0) {
            const pendingPhyrexianId = `phyrexian_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            
            // Build the choice options for each Phyrexian mana symbol
            const phyrexianChoices = phyrexianCosts.map((options: string[], index: number) => {
              const colorOption = options.find((o: string) => !o.startsWith('LIFE:') && !o.startsWith('GENERIC:'));
              const lifeOption = options.find((o: string) => o.startsWith('LIFE:'));
              const lifeAmount = lifeOption ? parseInt(lifeOption.split(':')[1], 10) : 2;
              
              const colorMap: Record<string, string> = {
                'W': 'white', 'U': 'blue', 'B': 'black', 'R': 'red', 'G': 'green'
              };
              const colorName = colorOption ? colorMap[colorOption] || colorOption : 'colored';
              const hasColorMana = colorOption ? (manaPool[colorName] || 0) >= 1 : false;
              
              return {
                index,
                colorOption,
                colorName,
                lifeAmount,
                hasColorMana,
                symbol: colorOption ? `{${colorOption}/P}` : '{P}',
              };
            });
            
            // Resolution Queue: prompt player to choose how to pay the Phyrexian symbols
            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.MANA_PAYMENT_CHOICE,
              playerId: pid as PlayerID,
              sourceId: permanentId,
              sourceName: cardName,
              sourceImage: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
              description: `Choose how to pay Phyrexian mana for ${cardName}.`,
              mandatory: true,
              phyrexianManaChoice: true,
              pendingId: pendingPhyrexianId,
              permanentId,
              cardName,
              abilityText,
              manaCost: manaOnly,
              totalManaCost: manaOnly,
              genericCost: parsedCost.generic,
              phyrexianChoices,
              playerLife,
              parsedCost,
              phyrexianCosts,
              requiresTap,
              sacrificeType,
              sacrificeSubtype,
            } as any);
            
            debug(2, `[activateBattlefieldAbility] ${cardName} has Phyrexian mana costs. Prompting ${pid} for payment choice.`);
            return; // Wait for player's choice
          }
          
          // No Phyrexian costs - handle regular hybrid costs (like {W/U} or {2/W})
          if (parsedCost.hybrids && parsedCost.hybrids.length > 0) {
            let manaToConsume = { colors: { ...parsedCost.colors }, generic: parsedCost.generic };
            
            for (const hybridOptions of parsedCost.hybrids) {
              let paid = false;
              
              for (const option of hybridOptions) {
                if (option.startsWith('GENERIC:')) {
                  // Hybrid generic/color option (like {2/W}) - check if we have enough generic
                  const genericAmount = parseInt(option.split(':')[1], 10);
                  const totalAvailable = calculateTotalAvailableMana(manaPool, undefined);
                  const totalMana = Object.values(totalAvailable).reduce((a, b) => a + b, 0);
                  if (totalMana >= genericAmount + manaToConsume.generic) {
                    // Can pay with generic - add to generic cost
                    manaToConsume.generic += genericAmount;
                    paid = true;
                    break;
                  }
                } else {
                  // Regular hybrid color option (like W or U from {W/U})
                  const colorMap: Record<string, string> = {
                    'W': 'white', 'U': 'blue', 'B': 'black', 'R': 'red', 'G': 'green'
                  };
                  const colorKey = colorMap[option];
                  if (colorKey && (manaPool[colorKey] || 0) >= 1) {
                    manaToConsume.colors[option] = (manaToConsume.colors[option] || 0) + 1;
                    paid = true;
                    break;
                  }
                }
              }
              
              if (!paid) {
                socket.emit("error", {
                  code: "INSUFFICIENT_MANA",
                  message: `Cannot pay ${manaOnly} - insufficient mana`,
                });
                return;
              }
            }
            
            // Consume the mana
            consumeManaFromPool(manaPool, manaToConsume.colors, manaToConsume.generic);
          } else {
            // No hybrid costs - just validate and consume normally
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
          }
          
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
    // - "Add {W}", "Add {G}{G}", "Add {R} or {W}", etc. (specific mana symbols including {C} for colorless)
    // - "Add one mana", "Add two mana", etc.
    // - "Add mana of any color", "Add any color"
    // - "Add X mana" (variable mana)
    // - "Add an amount of {G}" (Karametra's Acolyte, etc.)
    // - "Add X mana in any combination" (Selvala, Nykthos, etc.)
    // Note: Also matches Talisman pattern: "{T}: Add {R} or {W}. This artifact deals 1 damage to you."
    const isManaAbility = /add\s+(\{[wubrgc]\}(?:\s+or\s+\{[wubrgc]\})?|\{[wubrgc]\}\{[wubrgc]\}|one mana|two mana|three mana|mana of any|any color|[xX] mana|an amount of|mana in any combination)/i.test(abilityText) && 
                          !/target/i.test(abilityText);

    // Chosen-name activation restrictions (e.g., Pithing Needle / Phyrexian Revoker)
    // Important: we check after identifying whether THIS specific activation is a mana ability,
    // so "unless they're mana abilities" is respected.
    const activationRestriction = isAbilityActivationProhibitedByChosenName(game.state, pid as any, cardName, isManaAbility);
    if (activationRestriction.prohibited) {
      const blocker = activationRestriction.by?.sourceName || 'an effect';
      socket.emit('error', {
        code: 'CANNOT_ACTIVATE_CHOSEN_NAME',
        message: `Activated abilities of sources named "${cardName}" can't be activated (${blocker} chose that name).`,
      });
      return;
    }
    
    if (!isManaAbility) {
      // Split Second: can't activate non-mana abilities.
      if (splitSecondLockActive) {
        socket.emit('error', {
          code: 'SPLIT_SECOND_LOCK',
          message: "Can't activate abilities while a spell with split second is on the stack.",
        });
        return;
      }

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
        
        // Queue library search via Resolution Queue
        const isSplit = tutorInfo.splitDestination === true;
        const destination: any = (tutorInfo.destination === 'battlefield' || tutorInfo.destination === 'battlefield_tapped') ? 'battlefield'
          : (tutorInfo.destination === 'exile') ? 'exile'
          : 'hand';
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.LIBRARY_SEARCH,
          playerId: pid as PlayerID,
          sourceName: `${cardName}`,
          description: tutorInfo.searchCriteria ? `Search for: ${tutorInfo.searchCriteria}` : 'Search your library',
          searchCriteria: tutorInfo.searchCriteria || 'any card',
          minSelections: 0,
          maxSelections: tutorInfo.maxSelections || (isSplit ? 2 : 1),
          mandatory: false,
          destination,
          reveal: false,
          shuffleAfter: true,
          availableCards: library,
          filter,
          splitDestination: isSplit,
          toBattlefield: tutorInfo.toBattlefield || 1,
          toHand: tutorInfo.toHand || 1,
          entersTapped: tutorInfo.entersTapped || false,
        } as any);
        
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

      // Fire triggers that care about ability activation.
      // Many will be filtered out by intervening-if ("if it isn't a mana ability").
      try {
        triggerAbilityActivatedTriggers(game as any, {
          activatedBy: pid as any,
          sourcePermanentId: permanentId as any,
          isManaAbility: true,
          abilityText,
        });
      } catch {}
      
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
          // Resolution Queue: request a color choice from player
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.MANA_COLOR_SELECTION,
            playerId: pid as PlayerID,
            sourceId: permanentId,
            sourceName: cardName,
            sourceImage: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
            description: `Choose a color for ${cardName}'s mana.`,
            mandatory: true,
            selectionKind: 'any_color',
            permanentId,
            abilityId,
            cardName,
            amount: totalAmount,
          } as any);
          
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
              
              // Resolution Queue: request a color choice from player
              ResolutionQueueManager.addStep(gameId, {
                type: ResolutionStepType.MANA_COLOR_SELECTION,
                playerId: pid as PlayerID,
                sourceId: permanentId,
                sourceName: cardName,
                sourceImage: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
                description: `Choose a color for ${cardName}'s mana.`,
                mandatory: true,
                selectionKind: 'any_color',
                permanentId,
                abilityId,
                cardName,
                amount: finalTotal,
              } as any);
              
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

    // Intervening-if support: if this activation was a mana ability and we didn't early-return
    // for a later color-choice step, then mana was added immediately.
    try {
      if (isManaAbility) {
        const stateAny = game.state as any;
        stateAny.addedManaWithThisAbilityThisTurn = stateAny.addedManaWithThisAbilityThisTurn || {};
        stateAny.addedManaWithThisAbilityThisTurn[String(pid)] = stateAny.addedManaWithThisAbilityThisTurn[String(pid)] || {};
        const permKey = String(permanentId);
        const abilityKeyRaw = abilityId != null ? String(abilityId) : '';
        const k = abilityKeyRaw ? `${permKey}:${abilityKeyRaw}` : permKey;
        (stateAny.addedManaWithThisAbilityThisTurn[String(pid)] as any)[k] = true;
      }
    } catch {}
    
    appendEvent(gameId, (game as any).seq ?? 0, "activateBattlefieldAbility", { 
      playerId: pid, 
      permanentId, 
      abilityId,
      cardName,
      abilityText,
    });
    
    broadcastGame(io, game, gameId);
  });



  // ========================================================================
  // NOTE: The legacy entrapmentManeuverSelect handler has been removed.
  // Entrapment Maneuver is now handled by the Resolution Queue system
  // via submitResolutionResponse. See resolution.ts handleEntrapmentManeuverResponse.
  // ========================================================================

  // ========================================================================
  // NOTE: The legacy targetSelectionConfirm and targetSelectionCancel handlers 
  // have been removed. Target selection is now handled by the Resolution Queue
  // system via submitResolutionResponse and cancelResolutionStep.
  // See resolution.ts handleTargetSelectionResponse for the new implementation.
  // ========================================================================

  // ========================================================================
  // NOTE: The legacy perOpponentTargetSelectionConfirm handler has been removed.
  // Per-opponent targeting is now handled by the Resolution Queue system
  // via submitResolutionResponse. See resolution.ts handleTargetSelectionResponse.
  // ========================================================================

  // ============================================================================
  // Phyrexian Mana Payment Choice
  // ============================================================================

  // Legacy phyrexianManaConfirm handler removed - now using resolution queue system
  // See resolution.ts MANA_PAYMENT_CHOICE handling

  // ============================================================================
  // NOTE: The legacy sacrificeSelected handler has been removed.
  // Sacrifice selection is now handled by the Resolution Queue system:
  // - UPKEEP_SACRIFICE (edict style: sacrifice 1 creature)
  // - TARGET_SELECTION with sacrificeSelection metadata (sacrifice N permanents of a given type)
  // See resolution.ts handleTargetSelectionResponse.
  // ============================================================================

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
    mode,
  }: {
    gameId: string;
    effectType: 'damage' | 'life_gain' | 'counters' | 'tokens';
    useCustomOrder?: boolean;
    customOrder?: string[];  // Source names in desired order
    mode?: 'minimize' | 'maximize' | 'custom' | 'auto';
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
    
    const normalizedMode: 'minimize' | 'maximize' | 'custom' | 'auto' = (() => {
      if (mode) return mode;

      // Back-compat: previous API was a boolean toggle.
      // For damage: toggle means maximize vs minimize.
      // For others: toggle means custom vs auto.
      if (effectType === 'damage') {
        return useCustomOrder ? 'maximize' : 'minimize';
      }
      return useCustomOrder ? 'custom' : 'auto';
    })();

    const normalizedCustomOrder = Array.isArray(customOrder) ? customOrder : [];
    const normalizedUseCustomOrder = normalizedMode === 'maximize' || normalizedMode === 'custom';

    (game.state as any).replacementEffectPreferences[pid][effectType] = {
      mode: normalizedMode,
      useCustomOrder: normalizedUseCustomOrder,
      customOrder: normalizedCustomOrder,
      updatedAt: Date.now(),
    };

    // Bump game sequence
    if (typeof (game as any).bumpSeq === "function") { (game as any).bumpSeq(); }

    const orderDescription = normalizedMode === 'custom'
      ? `custom order: ${normalizedCustomOrder.join(' → ') || '(none)'}`
      : normalizedMode === 'maximize'
        ? 'maximize'
        : normalizedMode === 'minimize'
          ? 'minimize'
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
      mode: normalizedMode,
      useCustomOrder: normalizedUseCustomOrder,
      customOrder: normalizedCustomOrder,
    });

    broadcastGame(io, game, gameId);
  });

  // Fight target selection is handled via Resolution Queue (see socket/resolution.ts)

  // Legacy counterTargetChosen handler removed - now using resolution queue system

  // moveCounterSourceChosen/moveCounterDestinationChosen are removed.
  // Counter movement is handled via Resolution Queue (ResolutionStepType.COUNTER_MOVEMENT).

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

  // Legacy confirmAnyColorManaChoice handler removed - now using resolution queue system
  // See resolution.ts MANA_COLOR_SELECTION handling

  // Tap/Untap target selection is handled via Resolution Queue (see socket/resolution.ts)

  // Counter movement is handled via Resolution Queue (see socket/resolution.ts)

  // Legacy confirmCounterMovement handler removed - now using resolution queue system

  // Station creature selection is handled via Resolution Queue (see socket/resolution.ts)

  // Multi-mode activation and any follow-up targeting are handled via Resolution Queue
  // (ResolutionStepType.MODE_SELECTION + ResolutionStepType.TARGET_SELECTION).

  // Forbidden Orchard opponent selection is handled via Resolution Queue (see socket/resolution.ts)

  // Legacy confirmManaDistribution handler removed - now using resolution queue system
  // See resolution.ts MANA_COLOR_SELECTION handling

  // Cycling - discard a card from hand, pay cost, and draw a card
  // Properly uses the stack per MTG rules (Rule 702.29)
  socket.on("activateCycling", ({ gameId, cardId }: { gameId: string; cardId: string }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);

    // Split Second: cycling is an activated ability (non-mana).
    if (isSplitSecondLockActive(game.state)) {
      socket.emit('error', {
        code: 'SPLIT_SECOND_LOCK',
        message: "Can't activate abilities while a spell with split second is on the stack.",
      });
      return;
    }
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
