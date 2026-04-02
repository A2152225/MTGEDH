import type { Server, Socket } from "socket.io";
import type { PlayerID, BattlefieldPermanent } from "../../../shared/src/index.js";
import crypto from "crypto";
import { ensureGame, appendGameEvent, broadcastGame, getPlayerName, emitToPlayer, broadcastManaPoolUpdate, getEffectivePower, getEffectiveToughness, parseManaCost, getOrInitManaPool, calculateTotalAvailableMana, validateManaPayment, consumeManaFromPool, calculateManaProduction, recordTreasureManaProduced, validateAndConsumeManaCostFromPool } from "./util";
import { appendEvent } from "../db";
import { games } from "./socket.js";
import { 
  permanentHasCreatureType,
  findPermanentsWithCreatureType 
} from "../../../shared/src/creatureTypes";
import { parseSacrificeCost, type SacrificeType } from "../../../shared/src/textUtils";
import { getLandfallTriggers, getETBTriggersForPermanent, getLoyaltyActivationLimit, detectUtilityLandAbility } from "../state/modules/triggered-abilities";
import { movePermanentToGraveyard, trackPermanentSacrificedThisTurn } from "../state/modules/counters_tokens.js";
import { triggerETBEffectsForToken } from "../state/modules/stack";
import { recordCardLeftGraveyardThisTurn } from "../state/modules/turn-tracking.js";
import { 
  getManaAbilitiesForPermanent, 
  getManaMultiplier, 
  getExtraManaProduction, 
  getDevotionManaAmount, 
  getCreatureCountManaAmount,
  detectManaModifiers
} from "../state/modules/mana-abilities";
import { canPayManaCost, getAvailableMana } from "../state/modules/mana-check.js";
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
import { serializeAbilityActivatedTriggeredStackItem, triggerAbilityActivatedTriggers } from "../state/modules/triggers/ability-activated.js";
import { isCreatureNow } from "../state/creatureTypeNow.js";

function cardHasSplitSecond(card: any): boolean {
  if (!card) return false;
  const keywords = Array.isArray(card.keywords) ? card.keywords : [];
  const oracleText = String(card.oracle_text || '').toLowerCase();
  return keywords.some((k: any) => String(k).toLowerCase() === 'split second') || oracleText.includes('split second');
}

function persistAbilityActivatedTriggerPushes(gameId: string, game: any, triggeredAbilities: any[]): void {
  for (const triggeredAbility of Array.isArray(triggeredAbilities) ? triggeredAbilities : []) {
    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'pushTriggeredAbility', serializeAbilityActivatedTriggeredStackItem(triggeredAbility));
    } catch (err) {
      debugWarn(1, '[activateBattlefieldAbility] appendEvent(pushTriggeredAbility ability-activated) failed:', err);
    }
  }
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

function parseStationThreshold(oracleText: string): number {
  const inlineMatch = oracleText.match(/station\s*(\d+)/i);
  if (inlineMatch) {
    return parseInt(inlineMatch[1], 10);
  }

  const thresholdLineMatch = oracleText.match(/station(?:\s*\([^)]*\))?\s*(?:\r?\n)+\s*(\d+)\+\s*\|/i);
  if (thresholdLineMatch) {
    return parseInt(thresholdLineMatch[1], 10);
  }

  return 0;
}

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

function snapshotInteractionManaPool(pool: any): Record<string, number> {
  return {
    white: Number(pool?.white || 0),
    blue: Number(pool?.blue || 0),
    black: Number(pool?.black || 0),
    red: Number(pool?.red || 0),
    green: Number(pool?.green || 0),
    colorless: Number(pool?.colorless || 0),
  };
}

function calculateInteractionManaPoolDelta(before: any, after: any): Record<string, number> | undefined {
  const baseline = snapshotInteractionManaPool(before);
  const current = snapshotInteractionManaPool(after);
  const delta: Record<string, number> = {};

  for (const key of ['white', 'blue', 'black', 'red', 'green', 'colorless']) {
    const amount = Number(current[key] || 0) - Number(baseline[key] || 0);
    if (amount !== 0) {
      delta[key] = amount;
    }
  }

  return Object.keys(delta).length > 0 ? delta : undefined;
}

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

  const hasTapUntapTargetPattern =
    /(?:tap or untap|untap or tap)\b[^.:]*\btarget\b/i.test(lowerText) ||
    /\b(?:tap|untap)\b[^.:]*\btarget\b/i.test(lowerText);
  if (!hasTapUntapTargetPattern) {
    return null;
  }
  
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

  function normalizeSelectedXValue(raw: unknown): number | undefined {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
    return Math.max(0, Math.floor(raw));
  }

  function applyXValueToText(text: string, xValue?: number): string {
    if (typeof xValue !== 'number' || !Number.isFinite(xValue)) return String(text || '');
    return String(text || '')
      .replace(/\{X\}/gi, `{${xValue}}`)
      .replace(/\bX\b/g, String(xValue))
      .replace(/\bx\b/g, String(xValue));
  }

function extractActivatedAbilitiesFromText(text: string): Array<{ cost: string; effect: string; fullText: string }> {
  const extracted: Array<{ cost: string; effect: string; fullText: string }> = [];
  const seen = new Set<string>();

  const pushAbility = (costRaw: string, effectRaw: string) => {
    const cost = String(costRaw || '').trim();
    const effect = String(effectRaw || '').trim();
    if (!cost || !effect) return;

    const costLower = cost.toLowerCase();
    if (
      !cost.includes('{') &&
      !costLower.includes('tap') &&
      !costLower.includes('sacrifice') &&
      !costLower.includes('discard') &&
      !(costLower.includes('remove') && costLower.includes('counter')) &&
      !(costLower.includes('pay') && costLower.includes('life')) &&
      !costLower.includes('exile') &&
      !costLower.includes('return')
    ) {
      return;
    }

    const fullText = `${cost}: ${effect}`.trim();
    const dedupeKey = `${cost}::${effect}`.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    extracted.push({ cost, effect, fullText });
  };

  for (const rawLine of String(text || '').split(/\r?\n+/)) {
    const line = rawLine.trim();
    if (!line.includes(':')) continue;
    const lineMatch = line.match(/^([^:]+):\s*(.+)$/);
    if (lineMatch) {
      pushAbility(lineMatch[1], lineMatch[2]);
    }
  }

  if (extracted.length > 0) {
    return extracted;
  }

  const abilityPattern = /([^:]+):\s*([^.]+\.?)/gi;
  let match;
  while ((match = abilityPattern.exec(text)) !== null) {
    pushAbility(match[1], match[2]);
  }

  return extracted;
}

export function getActivatedAbilityScopeText(oracleText: string, abilityId: string): {
  abilityText: string;
  fullAbilityText: string;
} {
  let abilityIndex = 0;
  const abilityMatch = abilityId.match(/-(\d+)$/);
  if (abilityMatch) {
    abilityIndex = parseInt(abilityMatch[1], 10);
    if (isNaN(abilityIndex)) abilityIndex = 0;
  }

  const abilities = extractActivatedAbilitiesFromText(oracleText);
  const selectedAbility = abilities[abilityIndex] || (abilities.length === 1 ? abilities[0] : null);
  if (!selectedAbility) {
    return { abilityText: '', fullAbilityText: '' };
  }

  return {
    abilityText: selectedAbility.effect,
    fullAbilityText: selectedAbility.fullText,
  };
}

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

function getCastFromGraveyardActivationCost(card: any, abilityId: string): { manaCost?: string; lifeCost?: number } {
  const oracleText = String(card?.oracle_text || '');
  const normalizedAbilityId = String(abilityId || '').trim().toLowerCase();

  if (normalizedAbilityId === 'retrace') {
    const manaCost = String(card?.mana_cost || '').trim();
    return manaCost ? { manaCost } : {};
  }

  const keywordPatterns: Record<string, RegExp> = {
    flashback: /flashback\s*[—-]?\s*(\{[^}]+\}(?:\{[^}]+\})*)/i,
    'jump-start': /jump-start\s*[—-]?\s*(\{[^}]+\}(?:\{[^}]+\})*)/i,
    escape: /escape\s*[—-]?\s*(\{[^}]+\}(?:\{[^}]+\})*)/i,
  };

  const manaMatch = keywordPatterns[normalizedAbilityId]?.exec(oracleText);
  const manaCost = manaMatch?.[1]?.trim();

  const keywordLine = oracleText
    .split(/\r?\n/)
    .find((line) => line.toLowerCase().includes(normalizedAbilityId.replace('-', '')) || line.toLowerCase().includes(normalizedAbilityId));
  const lifeMatch = keywordLine?.match(/pay\s+(\d+)\s+life/i);
  const lifeCost = lifeMatch ? parseInt(lifeMatch[1], 10) : undefined;

  return {
    ...(manaCost ? { manaCost } : {}),
    ...(Number.isFinite(lifeCost) ? { lifeCost } : {}),
  };
}

function getCastFromGraveyardDiscardCost(abilityId: string): { discardCount: number; discardTypeRestriction?: string } | undefined {
  const normalizedAbilityId = String(abilityId || '').trim().toLowerCase();
  if (normalizedAbilityId === 'jump-start') {
    return { discardCount: 1 };
  }
  if (normalizedAbilityId === 'retrace') {
    return { discardCount: 1, discardTypeRestriction: 'land' };
  }
  return undefined;
}

function getCastFromGraveyardExileCost(card: any, abilityId: string): { exileCount: number } | undefined {
  const normalizedAbilityId = String(abilityId || '').trim().toLowerCase();
  if (normalizedAbilityId !== 'escape') return undefined;

  const oracleText = String(card?.oracle_text || '');
  const exileMatch = oracleText.match(/exile\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+other\s+cards?\s+from\s+your\s+graveyard/i);
  if (!exileMatch) return undefined;

  const exileCount = parseWordNumber(String(exileMatch[1] || ''), 0);
  return exileCount > 0 ? { exileCount } : undefined;
}

function getKeywordGraveyardActivationManaCost(card: any, abilityId: string): string | undefined {
  const oracleText = String(card?.oracle_text || '');
  const normalizedAbilityId = String(abilityId || '').trim().toLowerCase();
  if (!normalizedAbilityId) return undefined;

  const escapedAbilityId = normalizedAbilityId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keywordMatch = oracleText.match(new RegExp(`${escapedAbilityId}\\s*[—-]?\\s*(\\{[^}]+\\}(?:\\{[^}]+\\})*)`, 'i'));
  return keywordMatch?.[1]?.trim() || undefined;
}

function getExplicitGraveyardActivationCost(card: any): { manaCost?: string; exileSourceFromGraveyard?: boolean } {
  const oracleText = String(card?.oracle_text || '');
  const lines = oracleText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const activationMatch = line.match(/^([^:]+):\s*(.+)$/);
    if (!activationMatch) continue;
    if (!/from\s+(?:your\s+)?graveyard/i.test(line)) continue;

    const costText = activationMatch[1].trim();
    const manaMatch = costText.match(/(\{[^}]+\}(?:\{[^}]+\})*)/);
    const exileSourceFromGraveyard = /exile\s+(?:this card|this|~|it)\s+from\s+(?:your\s+)?graveyard/i.test(costText);

    if (manaMatch || exileSourceFromGraveyard) {
      return {
        ...(manaMatch?.[1] ? { manaCost: manaMatch[1].trim() } : {}),
        ...(exileSourceFromGraveyard ? { exileSourceFromGraveyard: true } : {}),
      };
    }
  }

  return {};
}

function markCardLeftGraveyardLive(game: any, playerId: string, card: any): void {
  try {
    recordCardLeftGraveyardThisTurn({ state: game.state } as any, String(playerId), card);
  } catch {
    // best-effort only
  }
}

function markCastFromGraveyardLive(game: any, playerId: string): void {
  try {
    const stateAny = game.state as any;
    stateAny.castFromGraveyardThisTurn = stateAny.castFromGraveyardThisTurn || {};
    stateAny.castFromGraveyardThisTurn[String(playerId)] = true;
  } catch {
    // best-effort only
  }
}

function getNextEndStepFireTurnNumber(state: any): number {
  const currentTurn = Number(state?.turnNumber ?? state?.turn ?? 0) || 0;
  const currentPhase = String(state?.phase ?? '').toLowerCase();
  const currentStepUpper = String(state?.step ?? '').toUpperCase();
  const inEnding = currentPhase === 'ending' && (currentStepUpper === 'END' || currentStepUpper === 'CLEANUP');
  return inEnding ? currentTurn + 1 : currentTurn;
}

function getEncoreTargetPlayerIds(state: any, controllerId: string): string[] {
  const players = Array.isArray(state?.players) ? state.players : [];
  return players
    .filter((player: any) => player?.id && String(player.id) !== String(controllerId) && !player.hasLost)
    .map((player: any) => String(player.id));
}

function createEncoreToken(state: any, controllerId: string, card: any, tokenId: string, targetPlayerId: string): any {
  const grantedAbilities = Array.isArray(card?.keywords)
    ? [...card.keywords]
    : [];
  if (!grantedAbilities.some((ability: string) => String(ability).toLowerCase() === 'haste')) {
    grantedAbilities.push('Haste');
  }

  const power = Number.parseInt(String(card?.power ?? ''), 10);
  const toughness = Number.parseInt(String(card?.toughness ?? ''), 10);
  const oracleText = String(card?.oracle_text || '');
  const oracleWithHaste = /(^|\n)haste(\n|$)/i.test(oracleText)
    ? oracleText
    : `${oracleText}${oracleText ? '\n' : ''}Haste`;

  return {
    id: tokenId,
    controller: controllerId,
    owner: controllerId,
    tapped: false,
    counters: {},
    summoningSickness: false,
    isToken: true,
    mustAttack: true,
    encoreAttackPlayerId: targetPlayerId,
    copiedFromCardId: String(card?.id || ''),
    ...(Number.isFinite(power) ? { basePower: power } : {}),
    ...(Number.isFinite(toughness) ? { baseToughness: toughness } : {}),
    grantedAbilities,
    card: {
      ...card,
      id: tokenId,
      zone: 'battlefield',
      oracle_text: oracleWithHaste,
      keywords: grantedAbilities,
    },
  } as any;
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
    const entersTapped = text.includes('battlefield tapped') || text.includes('enters tapped');
    
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
    
    return { isTutor: true, searchCriteria, destination, maxSelections, entersTapped };
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

  const ensureInRoomAndSeated = (gameId: unknown): { gameId: string; game: any; pid: string } | undefined => {
    const pid = socket.data.playerId as string | undefined;
    const socketIsSpectator = !!(
      (socket.data as any)?.spectator || (socket.data as any)?.isSpectator
    );
    if (!pid || socketIsSpectator) return;

    if (!gameId || typeof gameId !== 'string') return;

    if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return;
    }

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit?.('error', { code: 'GAME_NOT_FOUND', message: 'Game not found' });
      return;
    }

    try {
      const seated = Array.isArray((game.state as any)?.players)
        ? (game.state as any).players.some((p: any) => p?.id === pid && !p?.spectator && !p?.isSpectator)
        : false;
      if (!seated) {
        socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
        return;
      }
    } catch {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return;
    }

    return { gameId, game, pid };
  };


  // Explore: Reveal top card, if land put in hand, else +1/+1 counter and may put in graveyard
  socket.on("beginExplore", (payload?: { gameId?: unknown; permanentId?: unknown }) => {
    const gameId = payload?.gameId;
    const permanentId = payload?.permanentId;

    if (!permanentId || typeof permanentId !== 'string') return;

    const ctx = ensureInRoomAndSeated(gameId);
    if (!ctx) return;

    const { gameId: gid, game, pid } = ctx;
    const cards = game.peekTopN(pid, 1);
    
    if (!cards || cards.length === 0) {
      // Empty library - creature still explores but nothing happens
      io.to(gid).emit("chat", {
        id: `m_${Date.now()}`,
        gameId: gid,
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
    ResolutionQueueManager.addStep(gid, {
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
    io.to(gid).emit("chat", {
      id: `m_${Date.now()}`,
      gameId: gid,
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
  socket.on("beginBatchExplore", (payload?: { gameId?: unknown; permanentIds?: unknown }) => {
    const gameId = payload?.gameId;
    const permanentIds = (payload as any)?.permanentIds as unknown;

    const ctx = ensureInRoomAndSeated(gameId);
    if (!ctx) return;

    const { gameId: gid, game, pid } = ctx;
    
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
      io.to(gid).emit("chat", {
        id: `m_${Date.now()}`,
        gameId: gid,
        from: "system",
        message: `${getPlayerName(game, pid)}'s creatures explore (empty library).`,
        ts: Date.now(),
      });
      return;
    }

    // Migrate legacy batchExplorePrompt flow to Resolution Queue.
    ResolutionQueueManager.addStep(gid, {
      type: ResolutionStepType.BATCH_EXPLORE_DECISION,
      playerId: pid as any,
      mandatory: true,
      sourceName: 'Explore',
      description: `Resolve ${explores.length} explore decision${explores.length === 1 ? '' : 's'}`,
      explores,
    } as any);

    const revealedNames = explores.map(e => e.revealedCard.name).join(", ");
    io.to(gid).emit("chat", {
      id: `m_${Date.now()}`,
      gameId: gid,
      from: "system",
      message: `${getPlayerName(game, pid)}'s creatures explore, revealing ${revealedNames}.`,
      ts: Date.now(),
    });
  });

  // Request full library for searching (tutor effect)
  socket.on(
    "requestLibrarySearch",
    (payload?: {
      gameId?: unknown;
      title?: unknown;
      description?: unknown;
      filter?: any;
      maxSelections?: unknown;
      moveTo?: unknown;
      shuffleAfter?: unknown;
    }) => {
      const gameId = payload?.gameId;
      const title = payload?.title;
      const description = payload?.description;
      const filter = (payload as any)?.filter;
      const maxSelections = payload?.maxSelections;
      const moveTo = payload?.moveTo;
      const shuffleAfter = payload?.shuffleAfter;
    const pid = socket.data.playerId as string | undefined;
    const socketIsSpectator = !!(
      (socket.data as any)?.spectator || (socket.data as any)?.isSpectator
    );
    if (!pid || socketIsSpectator) return;

    if (!gameId || typeof gameId !== 'string') return;
    if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return;
    }

    const game = ensureGame(gameId);
    try {
      const seated = Array.isArray((game.state as any)?.players)
        ? (game.state as any).players.some((p: any) => p?.id === pid && !p?.spectator && !p?.isSpectator)
        : false;
      if (!seated) {
        socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
        return;
      }
    } catch {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return;
    }
    
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
      sourceName: typeof title === 'string' && title ? title : 'Search Library',
      description: finalDescription || undefined,
      searchCriteria: typeof title === 'string' && title ? title : 'Search your library',
      minSelections: 0,
      maxSelections: typeof maxSelections === 'number' && Number.isFinite(maxSelections) ? maxSelections : 1,
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
    }
  );

  // Handle graveyard ability activation
  socket.on(
    "activateGraveyardAbility",
    (payload?: { gameId?: unknown; cardId?: unknown; abilityId?: unknown }) => {
      const gameIdRaw = payload?.gameId;
      const cardId = payload?.cardId;
      const abilityId = payload?.abilityId;

      if (!cardId || typeof cardId !== 'string') return;
      if (!abilityId || typeof abilityId !== 'string') return;

      const ctx = ensureInRoomAndSeated(gameIdRaw);
      if (!ctx) return;

      const { gameId, game, pid } = ctx;

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
      const activationCost = getCastFromGraveyardActivationCost(card, abilityId);
      const recordedManaCost = String(activationCost.manaCost || '').trim();
      const recordedLifeCost = Number(activationCost.lifeCost || 0);
      const discardCost = getCastFromGraveyardDiscardCost(abilityId);
      const exileCost = getCastFromGraveyardExileCost(card, abilityId);

      if (discardCost) {
        const hand = Array.isArray(zones.hand) ? zones.hand : [];
        const eligibleHand = discardCost.discardTypeRestriction
          ? hand.filter((entry: any) => String(entry?.type_line || '').toLowerCase().includes(discardCost.discardTypeRestriction as string))
          : hand;

        if (eligibleHand.length < discardCost.discardCount) {
          socket.emit("error", {
            code: "CANNOT_PAY_COST",
            message: discardCost.discardTypeRestriction
              ? `Cannot cast ${cardName} using ${abilityId}: you need to discard ${discardCost.discardCount} ${discardCost.discardTypeRestriction} card${discardCost.discardCount === 1 ? '' : 's'}.`
              : `Cannot cast ${cardName} using ${abilityId}: you need to discard ${discardCost.discardCount} card${discardCost.discardCount === 1 ? '' : 's'}.`,
          });
          return;
        }

        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, pid as any)
          .find(
            (s: any) =>
              s?.type === ResolutionStepType.DISCARD_SELECTION &&
              (s as any)?.graveyardCastDiscardAsCost === true &&
              String((s as any)?.cardId || s?.sourceId || '') === String(cardId)
          );

        if (!existing) {
          const discardTypeLabel = discardCost.discardTypeRestriction ? `${discardCost.discardTypeRestriction} ` : '';
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.DISCARD_SELECTION,
            playerId: pid as PlayerID,
            sourceId: cardId,
            sourceName: cardName,
            sourceImage: (card as any)?.image_uris?.small || (card as any)?.image_uris?.normal,
            description: `${cardName}: Discard ${discardCost.discardCount} ${discardTypeLabel}card${discardCost.discardCount === 1 ? '' : 's'} to cast it using ${abilityId}.`,
            mandatory: false,
            hand: eligibleHand,
            discardCount: discardCost.discardCount,
            currentHandSize: eligibleHand.length,
            maxHandSize: Math.max(7, eligibleHand.length),
            reason: 'activation_cost',
            graveyardCastDiscardAsCost: true,
            cardId,
            abilityId,
            cardName,
            manaCost: recordedManaCost || undefined,
            lifeToPayForCost: recordedLifeCost > 0 ? recordedLifeCost : undefined,
            discardTypeRestriction: discardCost.discardTypeRestriction || undefined,
          } as any);
        }

        broadcastGame(io, game, gameId);
        return;
      }

      if (exileCost) {
        const graveyardCards = Array.isArray(zones.graveyard) ? zones.graveyard : [];
        const eligibleGraveyardCards = graveyardCards.filter((entry: any) => String(entry?.id || '') !== String(cardId));

        if (eligibleGraveyardCards.length < exileCost.exileCount) {
          socket.emit("error", {
            code: "CANNOT_PAY_COST",
            message: `Cannot cast ${cardName} using ${abilityId}: you need to exile ${exileCost.exileCount} other card${exileCost.exileCount === 1 ? '' : 's'} from your graveyard.`,
          });
          return;
        }

        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, pid as any)
          .find(
            (s: any) =>
              s?.type === ResolutionStepType.GRAVEYARD_SELECTION &&
              (s as any)?.graveyardCastExileAsCost === true &&
              String((s as any)?.cardId || s?.sourceId || '') === String(cardId)
          );

        if (!existing) {
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.GRAVEYARD_SELECTION,
            playerId: pid as PlayerID,
            sourceId: cardId,
            sourceName: cardName,
            sourceImage: (card as any)?.image_uris?.small || (card as any)?.image_uris?.normal,
            description: `${cardName}: Exile ${exileCost.exileCount} other card${exileCost.exileCount === 1 ? '' : 's'} from your graveyard to cast it using ${abilityId}.`,
            mandatory: false,
            targetPlayerId: pid,
            minTargets: exileCost.exileCount,
            maxTargets: exileCost.exileCount,
            destination: 'exile',
            cardId,
            cardName,
            title: `Exile ${exileCost.exileCount} other card${exileCost.exileCount === 1 ? '' : 's'} for ${cardName}`,
            validTargets: eligibleGraveyardCards.map((graveyardCard: any) => ({
              id: graveyardCard.id,
              label: graveyardCard.name || 'Card',
              description: graveyardCard.type_line || 'Card',
              imageUrl: graveyardCard.image_uris?.small || graveyardCard.image_uris?.normal,
            })),
            graveyardCastExileAsCost: true,
            abilityId,
            manaCost: recordedManaCost || undefined,
            lifeToPayForCost: recordedLifeCost > 0 ? recordedLifeCost : undefined,
          } as any);
        }

        broadcastGame(io, game, gameId);
        return;
      }

      if (recordedManaCost) {
        const parsedCost = parseManaCost(recordedManaCost);
        const pool = getOrInitManaPool(game.state, pid);
        const totalAvailable = calculateTotalAvailableMana(pool, []);
        const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
        if (validationError) {
          socket.emit("error", {
            code: "INSUFFICIENT_MANA",
            message: `Cannot pay ${recordedManaCost}: ${validationError}`,
          });
          return;
        }
        consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, `[activateGraveyardAbility:${cardName}]`);
      }

      if (recordedLifeCost > 0) {
        const currentLife = Number(game.state.life?.[pid] ?? game.state.startingLife ?? 40);
        if (!Number.isFinite(currentLife) || currentLife <= recordedLifeCost) {
          socket.emit("error", {
            code: "INSUFFICIENT_LIFE",
            message: `Cannot pay ${recordedLifeCost} life (you have ${Number.isFinite(currentLife) ? currentLife : 0} life)`,
          });
          return;
        }
        game.state.life = game.state.life || {};
        game.state.life[pid] = currentLife - recordedLifeCost;
        try {
          (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
          (game.state as any).lifeLostThisTurn[String(pid)] = ((game.state as any).lifeLostThisTurn[String(pid)] || 0) + recordedLifeCost;
        } catch {}
      }

      // Cast from graveyard - move to stack
      // Remove from graveyard
      zones.graveyard.splice(cardIndex, 1);
      zones.graveyardCount = zones.graveyard.length;
      markCardLeftGraveyardLive(game, pid, card);
      markCastFromGraveyardLive(game, pid);
      
      // Add to stack
      const stackId = generateId("stack");
      const stackItem = {
        id: stackId,
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
        stackId,
        manaCost: recordedManaCost || undefined,
        lifePaidForCost: recordedLifeCost > 0 ? recordedLifeCost : undefined,
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} cast ${cardName} using ${abilityId}.`,
        ts: Date.now(),
      });
    } else if (abilityId === "unearth") {
      const recordedManaCost = String(getKeywordGraveyardActivationManaCost(card, abilityId) || '').trim();
      if (recordedManaCost) {
        const parsedCost = parseManaCost(recordedManaCost);
        const pool = getOrInitManaPool(game.state, pid);
        const totalAvailable = calculateTotalAvailableMana(pool, []);
        const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
        if (validationError) {
          socket.emit("error", {
            code: "INSUFFICIENT_MANA",
            message: `Cannot pay ${recordedManaCost}: ${validationError}`,
          });
          return;
        }
        consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, `[activateGraveyardAbility:${cardName}]`);
      }

      // Return to battlefield
      zones.graveyard.splice(cardIndex, 1);
      zones.graveyardCount = zones.graveyard.length;
      markCardLeftGraveyardLive(game, pid, card);
      
      // Add to battlefield
      game.state.battlefield = game.state.battlefield || [];
        const createdPermanentId = generateId("perm");
        game.state.battlefield.push({
          id: createdPermanentId,
        controller: pid,
        owner: pid,
        tapped: false,
        wasUnearthed: true,
        unearthed: true,
        counters: {},
        card: { ...card, zone: "battlefield", unearth: true, wasUnearthed: true },
      } as any);
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
        playerId: pid,
        cardId,
        abilityId,
        manaCost: recordedManaCost || undefined,
        createdPermanentIds: [createdPermanentId],
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} unearthed ${cardName}.`,
        ts: Date.now(),
      });
    } else if (abilityId === "embalm" || abilityId === "eternalize") {
      const recordedManaCost = String(getKeywordGraveyardActivationManaCost(card, abilityId) || '').trim();
      if (recordedManaCost) {
        const parsedCost = parseManaCost(recordedManaCost);
        const pool = getOrInitManaPool(game.state, pid);
        const totalAvailable = calculateTotalAvailableMana(pool, []);
        const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
        if (validationError) {
          socket.emit("error", {
            code: "INSUFFICIENT_MANA",
            message: `Cannot pay ${recordedManaCost}: ${validationError}`,
          });
          return;
        }
        consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, `[activateGraveyardAbility:${cardName}]`);
      }

      // Create token copy (simplified - doesn't track token properties properly)
      // Exile original from graveyard
      zones.graveyard.splice(cardIndex, 1);
      zones.graveyardCount = zones.graveyard.length;
      markCardLeftGraveyardLive(game, pid, card);
      
      // Move to exile
      zones.exile = zones.exile || [];
      zones.exile.push({ ...card, zone: "exile" });
      zones.exileCount = zones.exile.length;
      
      // Create token on battlefield
      const tokenName = abilityId === "eternalize" ? `${cardName} (4/4 Zombie)` : `${cardName} (Zombie)`;
      game.state.battlefield = game.state.battlefield || [];
      const createdPermanentId = generateId("token");
      game.state.battlefield.push({
        id: createdPermanentId,
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
        manaCost: recordedManaCost || undefined,
        createdPermanentIds: [createdPermanentId],
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
      const explicitActivationCost = getExplicitGraveyardActivationCost(card);
      let recordedManaCost: string | undefined;
      
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
      
      if (explicitActivationCost.manaCost) {
        recordedManaCost = explicitActivationCost.manaCost;
        const parsedCost = parseManaCost(recordedManaCost);
        const pool = getOrInitManaPool(game.state, pid);
        const totalAvailable = calculateTotalAvailableMana(pool, []);
        
        // Validate mana payment
        const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
        if (validationError) {
          socket.emit("error", {
            code: "INSUFFICIENT_MANA",
            message: `Cannot pay ${recordedManaCost}: ${validationError}`,
          });
          return;
        }
        
        // Consume mana
        consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, `[activateGraveyardAbility:${cardName}]`);
      }
      
      // Check for search library effects in the ability
      const tutorInfo = detectTutorEffect(card.oracle_text || "");
      
      if (tutorInfo.isTutor) {
        if (explicitActivationCost.exileSourceFromGraveyard) {
          const [exiledSourceCard] = zones.graveyard.splice(cardIndex, 1);
          zones.graveyardCount = zones.graveyard.length;
          markCardLeftGraveyardLive(game, pid, exiledSourceCard);
          zones.exile = zones.exile || [];
          zones.exile.push({ ...exiledSourceCard, zone: 'exile' });
          zones.exileCount = zones.exile.length;
        }

        // This ability involves searching the library
        // Don't remove from graveyard yet - the search needs to resolve first
        const filter = parseSearchCriteria(tutorInfo.searchCriteria || "");
        const library = game.searchLibrary ? game.searchLibrary(pid, "", 1000) : [];
        const isSplit = tutorInfo.splitDestination === true;
        const destination: any = (tutorInfo.destination === 'battlefield' || tutorInfo.destination === 'battlefield_tapped') ? 'battlefield'
          : (tutorInfo.destination === 'exile') ? 'exile'
          : 'hand';
        
        if (typeof game.bumpSeq === "function") {
          game.bumpSeq();
        }
        
        appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
          playerId: pid,
          cardId,
          abilityId,
          isTutor: true,
          manaCost: recordedManaCost,
          exileSourceOnActivate: explicitActivationCost.exileSourceFromGraveyard || undefined,
          searchCriteria: tutorInfo.searchCriteria || 'any card',
          destination,
          maxSelections: tutorInfo.maxSelections || (isSplit ? 2 : 1),
          splitDestination: isSplit,
          toBattlefield: tutorInfo.toBattlefield || 1,
          toHand: tutorInfo.toHand || 1,
          entersTapped: tutorInfo.entersTapped || false,
          filter,
        });
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} activated ${cardName}'s ability from graveyard.`,
          ts: Date.now(),
        });

        // Queue library search via Resolution Queue
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.LIBRARY_SEARCH,
          playerId: pid as PlayerID,
            sourceId: cardId,
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
          persistLibrarySearchResolve: true,
          persistLibrarySearchResolveReason: 'graveyard_ability',
          persistLibrarySearchResolveAbilityId: abilityId,
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
      markCardLeftGraveyardLive(game, pid, card);
      let createdPermanentId: string | undefined;
      
      if (destination === "battlefield") {
        // Move to battlefield
        game.state.battlefield = game.state.battlefield || [];
        createdPermanentId = generateId("perm");
        game.state.battlefield.push({
          id: createdPermanentId,
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
        manaCost: recordedManaCost,
        createdPermanentIds: destination === "battlefield" ? [createdPermanentId] : undefined,
      });
    } else if (abilityId === "scavenge") {
      const recordedManaCost = String(getKeywordGraveyardActivationManaCost(card, abilityId) || '').trim();
      if (recordedManaCost) {
        const parsedCost = parseManaCost(recordedManaCost);
        const pool = getOrInitManaPool(game.state, pid);
        const totalAvailable = calculateTotalAvailableMana(pool, []);
        const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
        if (validationError) {
          socket.emit("error", {
            code: "INSUFFICIENT_MANA",
            message: `Cannot pay ${recordedManaCost}: ${validationError}`,
          });
          return;
        }
        consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, `[activateGraveyardAbility:${cardName}]`);
      }

      // Scavenge - exile from graveyard (player needs to manually target creature for counters)
      zones.graveyard.splice(cardIndex, 1);
      zones.graveyardCount = zones.graveyard.length;
      markCardLeftGraveyardLive(game, pid, card);
      
      // Move to exile
      zones.exile = zones.exile || [];
      zones.exile.push({ ...card, zone: "exile" });
      zones.exileCount = zones.exile.length;
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
        playerId: pid,
        cardId,
        abilityId,
        manaCost: recordedManaCost || undefined,
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
      const recordedManaCost = String(getKeywordGraveyardActivationManaCost(card, abilityId) || '').trim();
      if (recordedManaCost) {
        const parsedCost = parseManaCost(recordedManaCost);
        const pool = getOrInitManaPool(game.state, pid);
        const totalAvailable = calculateTotalAvailableMana(pool, []);
        const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
        if (validationError) {
          socket.emit("error", {
            code: "INSUFFICIENT_MANA",
            message: `Cannot pay ${recordedManaCost}: ${validationError}`,
          });
          return;
        }
        consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, `[activateGraveyardAbility:${cardName}]`);
      }

      // Encore - exile from graveyard (creates tokens)
      zones.graveyard.splice(cardIndex, 1);
      zones.graveyardCount = zones.graveyard.length;
      markCardLeftGraveyardLive(game, pid, card);
      
      // Move to exile
      zones.exile = zones.exile || [];
      zones.exile.push({ ...card, zone: "exile" });
      zones.exileCount = zones.exile.length;

      const encoreTargetPlayerIds = getEncoreTargetPlayerIds(game.state, pid);
      const createdPermanentIds: string[] = [];
      const fireAtTurnNumber = getNextEndStepFireTurnNumber(game.state);
      game.state.battlefield = game.state.battlefield || [];
      (game.state as any).pendingSacrificeAtNextEndStep = Array.isArray((game.state as any).pendingSacrificeAtNextEndStep)
        ? (game.state as any).pendingSacrificeAtNextEndStep
        : [];
      for (const targetPlayerId of encoreTargetPlayerIds) {
        const tokenId = generateId("token");
        createdPermanentIds.push(tokenId);
        game.state.battlefield.push(createEncoreToken(game.state, pid, card, tokenId, targetPlayerId));
        (game.state as any).pendingSacrificeAtNextEndStep.push({
          permanentId: tokenId,
          fireAtTurnNumber,
          maxManaValue: 0,
          sourceName: cardName,
          createdBy: pid,
        });
      }
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
        playerId: pid,
        cardId,
        abilityId,
        manaCost: recordedManaCost || undefined,
        createdPermanentIds,
        encoreTargetPlayerIds,
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} used encore on ${cardName}. Create a token copy for each opponent.`,
        ts: Date.now(),
      });
    } else if (abilityId === "disturb") {
      const recordedManaCost = String(getKeywordGraveyardActivationManaCost(card, abilityId) || '').trim();
      if (recordedManaCost) {
        const parsedCost = parseManaCost(recordedManaCost);
        const pool = getOrInitManaPool(game.state, pid);
        const totalAvailable = calculateTotalAvailableMana(pool, []);
        const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
        if (validationError) {
          socket.emit("error", {
            code: "INSUFFICIENT_MANA",
            message: `Cannot pay ${recordedManaCost}: ${validationError}`,
          });
          return;
        }
        consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, `[activateGraveyardAbility:${cardName}]`);
      }

      // Disturb - cast transformed from graveyard
      zones.graveyard.splice(cardIndex, 1);
      zones.graveyardCount = zones.graveyard.length;
      markCardLeftGraveyardLive(game, pid, card);
      markCastFromGraveyardLive(game, pid);
      
      // Add to stack (transformed)
      const stackId = generateId("stack");
      const stackItem = {
        id: stackId,
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
        stackId,
        manaCost: recordedManaCost || undefined,
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
      let recordedManaCost: string | undefined;
      
      if (costMatch) {
        const manaCost = costMatch[1];
        recordedManaCost = manaCost;
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
      markCardLeftGraveyardLive(game, pid, card);
      
      // Move to exile
      zones.exile = zones.exile || [];
      zones.exile.push({ ...card, zone: "exile" });
      zones.exileCount = zones.exile.length;
      
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
        manaCost: recordedManaCost,
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
        const explicitActivationCost = getExplicitGraveyardActivationCost(card);
        const recordedManaCost = String(explicitActivationCost.manaCost || '').trim() || undefined;
        if (recordedManaCost) {
          const parsedCost = parseManaCost(recordedManaCost);
          const pool = getOrInitManaPool(game.state, pid);
          const totalAvailable = calculateTotalAvailableMana(pool, []);
          const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
          if (validationError) {
            socket.emit("error", {
              code: "INSUFFICIENT_MANA",
              message: `Cannot pay ${recordedManaCost}: ${validationError}`,
            });
            return;
          }

          consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, `[activateGraveyardAbility:${cardName}]`);
        }

        if (explicitActivationCost.exileSourceFromGraveyard) {
          const [exiledSourceCard] = zones.graveyard.splice(cardIndex, 1);
          zones.graveyardCount = zones.graveyard.length;
          markCardLeftGraveyardLive(game, pid, exiledSourceCard);
          zones.exile = zones.exile || [];
          zones.exile.push({ ...exiledSourceCard, zone: 'exile' });
          zones.exileCount = zones.exile.length;
        }

        // This ability involves searching the library
        const filter = parseSearchCriteria(tutorInfo.searchCriteria || "");
        const library = game.searchLibrary ? game.searchLibrary(pid, "", 1000) : [];
        const isSplit = tutorInfo.splitDestination === true;
        const destination: any = (tutorInfo.destination === 'battlefield' || tutorInfo.destination === 'battlefield_tapped') ? 'battlefield'
          : (tutorInfo.destination === 'exile') ? 'exile'
          : 'hand';
        if (typeof game.bumpSeq === "function") {
          game.bumpSeq();
        }
        
        appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
          playerId: pid,
          cardId,
          abilityId,
          isTutor: true,
          manaCost: recordedManaCost,
          exileSourceOnActivate: explicitActivationCost.exileSourceFromGraveyard || undefined,
          searchCriteria: tutorInfo.searchCriteria || 'any card',
          destination,
          maxSelections: tutorInfo.maxSelections || (isSplit ? 2 : 1),
          splitDestination: isSplit,
          toBattlefield: tutorInfo.toBattlefield || 1,
          toHand: tutorInfo.toHand || 1,
          entersTapped: tutorInfo.entersTapped || false,
          filter,
        });
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} activated ${cardName}'s ability from graveyard.`,
          ts: Date.now(),
        });

        // Queue library search via Resolution Queue
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.LIBRARY_SEARCH,
          playerId: pid as PlayerID,
          sourceId: cardId,
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
          persistLibrarySearchResolve: true,
          persistLibrarySearchResolveReason: 'graveyard_ability',
          persistLibrarySearchResolveAbilityId: abilityId,
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
    }
  );
  
  // Get graveyard contents for viewing
  socket.on(
    "requestGraveyardView",
    (payload?: { gameId?: unknown; targetPlayerId?: unknown }) => {
      const gameId = payload?.gameId;
      const targetPlayerId = payload?.targetPlayerId;
    const pid = socket.data.playerId as string | undefined;
    if (!pid) return;

    if (!gameId || typeof gameId !== 'string') return;
    if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return;
    }

    const game = ensureGame(gameId);
    const targetPid = typeof targetPlayerId === 'string' && targetPlayerId ? targetPlayerId : pid;
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
    }
  );

  // Tap a permanent on the battlefield
  socket.on(
    "tapPermanent",
    (payload?: { gameId?: unknown; permanentId?: unknown }) => {
      const gameIdRaw = payload?.gameId;
      const permanentId = payload?.permanentId;

      if (!permanentId || typeof permanentId !== 'string') return;

      const ctx = ensureInRoomAndSeated(gameIdRaw);
      if (!ctx) return;

      const { gameId, game, pid } = ctx;
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
    const isTreasureSource = /\btreasure\b/.test(typeLine);
    const recordedAddedMana: Record<string, number> = {};
    let recordedManaCost: string | undefined;
    let recordedLifeLost = 0;

    const recordAddedMana = (poolKey: string, amount: number) => {
      if (!poolKey) return;
      if (!Number.isFinite(amount) || amount === 0) return;
      recordedAddedMana[poolKey] = (recordedAddedMana[poolKey] || 0) + amount;
    };
    
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
        recordAddedMana(poolKey, totalAmount);
        if (isTreasureSource) {
          try {
            recordTreasureManaProduced(game.state, String(pid), String(poolKey) as any, totalAmount);
          } catch {}
        }
        
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
      else if (creatureCountMana && (creatureCountMana.amount > 0 || (creatureCountMana as any).requiresColorChoice === true)) {
        const baseAmount = creatureCountMana.amount;
        const totalAmount = baseAmount * effectiveMultiplier;
        
        // Handle activation cost (like Three Tree City's {2})
        if ((creatureCountMana as any).activationCost) {
          const activationCost = (creatureCountMana as any).activationCost;
          recordedManaCost = activationCost;
          const parsedCost = parseManaCost(activationCost);
          const pool = getOrInitManaPool(game.state, pid);
          const totalAvailable = calculateTotalAvailableMana(pool, []);
          
          // Validate mana payment
          const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
          if (validationError) {
            (permanent as any).tapped = false;
            if (battlefieldIndex >= 0) {
              battlefield[battlefieldIndex].tapped = false;
            }
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
            dynamicAmountSource: (creatureCountMana as any).dynamicAmountSource,
            manaMultiplier: effectiveMultiplier,
          } as any);
          
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: (creatureCountMana as any).dynamicAmountSource === 'devotion'
              ? `${getPlayerName(game, pid)} activated ${cardName} and must choose a color for devotion mana.`
              : `${getPlayerName(game, pid)} tapped ${cardName} for ${totalAmount} mana (choose a color).`,
            ts: Date.now(),
          });
          
          broadcastGame(io, game, gameId);
          return; // Exit early - wait for color choice
        } else {
          const poolKey = colorToPoolKey[creatureCountMana.color] || 'green';
          (game.state.manaPool[pid] as any)[poolKey] += totalAmount;
          recordAddedMana(poolKey, totalAmount);
          if (isTreasureSource) {
            try {
              recordTreasureManaProduced(game.state, String(pid), String(poolKey) as any, totalAmount);
            } catch {}
          }
          
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
                recordedLifeLost += Number(cost.amount) || 0;

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
            recordedLifeLost += Number(damageAmount) || 0;

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
              recordAddedMana(poolKey, effectiveMultiplier);
              if (isTreasureSource) {
                try {
                  recordTreasureManaProduced(game.state, String(pid), String(poolKey) as any, effectiveMultiplier);
                } catch {}
              }
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
              recordAddedMana(extraPoolKey, extra.amount);
              if (isTreasureSource) {
                try {
                  recordTreasureManaProduced(game.state, String(pid), String(extraPoolKey) as any, extra.amount);
                } catch {}
              }
              totalAmount += extra.amount;
            }
            
            // Add the base mana (after multiplier)
            (game.state.manaPool[pid] as any)[poolKey] += baseAmount * effectiveMultiplier;
            recordAddedMana(poolKey, baseAmount * effectiveMultiplier);
            if (isTreasureSource) {
              try {
                recordTreasureManaProduced(game.state, String(pid), String(poolKey) as any, baseAmount * effectiveMultiplier);
              } catch {}
            }
            
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
    
        appendEvent(gameId, (game as any).seq ?? 0, "tapPermanent", {
          playerId: pid,
          permanentId,
          addedMana: Object.keys(recordedAddedMana).length > 0 ? { ...recordedAddedMana } : undefined,
          manaCost: recordedManaCost || undefined,
          lifeLost: recordedLifeLost > 0 ? recordedLifeLost : undefined,
        });
    
    broadcastGame(io, game, gameId);
    }
  );

  // Untap a permanent on the battlefield
  socket.on(
    "untapPermanent",
    (payload?: { gameId?: unknown; permanentId?: unknown }) => {
      const gameIdRaw = payload?.gameId;
      const permanentId = payload?.permanentId;

      if (!permanentId || typeof permanentId !== 'string') return;

      const ctx = ensureInRoomAndSeated(gameIdRaw);
    if (!ctx) return;

    const { gameId, game, pid } = ctx;
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
    }
  );

  // Exchange oracle text boxes between two permanents (text-changing effects)
  socket.on(
    "exchangeTextBoxes",
    (payload?: { gameId?: unknown; sourcePermanentId?: unknown; targetPermanentId?: unknown }) => {
      const gameIdRaw = payload?.gameId;
      const sourcePermanentId = payload?.sourcePermanentId;
      const targetPermanentId = payload?.targetPermanentId;

      if (typeof sourcePermanentId !== "string" || typeof targetPermanentId !== "string") return;

      const ctx = ensureInRoomAndSeated(gameIdRaw);
      if (!ctx) return;

      const { gameId, game, pid } = ctx;
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
    }
  );

  // Sacrifice a permanent on the battlefield
  socket.on(
    "sacrificePermanent",
    (payload?: { gameId?: unknown; permanentId?: unknown }) => {
      const gameIdRaw = payload?.gameId;
      const permanentId = payload?.permanentId;

      if (!permanentId || typeof permanentId !== "string") return;

      const ctx = ensureInRoomAndSeated(gameIdRaw);
      if (!ctx) return;

      const { gameId, game, pid } = ctx;
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
    
    // Cleanup Equipment/Fortification attachments if this attachment is leaving battlefield
    const isEquipment = typeLine.includes("equipment");
    const isFortification = typeLine.includes("fortification");
    const isAttachmentPermanent = isEquipment || isFortification;
    if (isAttachmentPermanent && permanent.attachedTo) {
      const attachedPermanent = battlefield.find((p: any) => p?.id === permanent.attachedTo);
      if (attachedPermanent && attachedPermanent.attachedEquipment) {
        attachedPermanent.attachedEquipment = (attachedPermanent.attachedEquipment as string[]).filter(
          (id: string) => id !== permanentId
        );
        if (attachedPermanent.attachedEquipment.length === 0) {
          attachedPermanent.isEquipped = false;
        }
      }
    }
    
    // Cleanup attached equipment/fortifications if this permanent is leaving battlefield
    if (permanent.attachedEquipment && permanent.attachedEquipment.length > 0) {
      for (const equipId of permanent.attachedEquipment as string[]) {
        const equipment = battlefield.find((p: any) => p?.id === equipId);
        if (equipment) {
          equipment.attachedTo = undefined;
        }
      }
    }
    
    trackPermanentSacrificedThisTurn(game.state, permanent);

    const moved = movePermanentToGraveyard(game as any, String(permanentId), true);
    if (!moved) {
      socket.emit("error", {
        code: "PERMANENT_NOT_FOUND",
        message: "Permanent no longer on battlefield",
      });
      return;
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "sacrificePermanent", { playerId: pid, permanentId });

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} sacrificed ${cardName}.`,
      ts: Date.now(),
    });
    
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
    }
  );

  // Activate a battlefield ability (fetch lands, mana abilities, etc.)
  socket.on(
    "activateBattlefieldAbility",
    async (payload?: { gameId?: unknown; permanentId?: unknown; abilityId?: unknown; xValue?: unknown }) => {
    const gameIdRaw = payload?.gameId;
    const permanentId = payload?.permanentId;
    const abilityId = payload?.abilityId;
    const selectedXValue = normalizeSelectedXValue(payload?.xValue);

    if (typeof permanentId !== "string") return;

    const ctx = ensureInRoomAndSeated(gameIdRaw);
    if (!ctx) return;

    const { gameId, game, pid } = ctx;

    // Validate abilityId is provided
    if (!abilityId || typeof abilityId !== "string") {
      socket.emit("error", {
        code: "INVALID_ABILITY",
        message: "Ability ID is required",
      });
      return;
    }

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
    const scopedActivatedAbility = getActivatedAbilityScopeText(oracleText, abilityId);
    const scopedAbilityText = String(scopedActivatedAbility.abilityText || '').trim();
    const scopedAbilityFullText = String(scopedActivatedAbility.fullAbilityText || scopedAbilityText || oracleText || '').trim();
    const isGenericActivatedAbilityId = /-ability-(\d+)$/i.test(abilityId);

    const { isAbilityActivationProhibitedByChosenName } = await import('../state/modules/chosen-name-restrictions.js');
    
    // ========================================================================
    // Handle Special Land Activated Abilities
    // ========================================================================
    const specialLandConfig = SPECIAL_LAND_ABILITIES[cardName.toLowerCase()];
    const lowerScopedAbilityFullText = scopedAbilityFullText.toLowerCase();
    const storageCounterType = String(specialLandConfig?.counterType || '').toLowerCase();
    const isGenericHybridManaSpecialLandAbility = specialLandConfig?.type === 'hybrid_mana_production' &&
      isGenericActivatedAbilityId &&
      Boolean(specialLandConfig.cost) &&
      lowerScopedAbilityFullText.includes(String(specialLandConfig.cost || '').toLowerCase()) &&
      lowerScopedAbilityFullText.includes('add');
    const isGenericStorageAddCounterAbility = specialLandConfig?.type === 'storage_counter' &&
      isGenericActivatedAbilityId &&
      storageCounterType.length > 0 &&
      lowerScopedAbilityFullText.includes(`put a ${storageCounterType} counter on`);
    const isGenericStorageRemoveCountersAbility = specialLandConfig?.type === 'storage_counter' &&
      isGenericActivatedAbilityId &&
      storageCounterType.length > 0 &&
      lowerScopedAbilityFullText.includes('remove') &&
      lowerScopedAbilityFullText.includes(storageCounterType) &&
      lowerScopedAbilityFullText.includes('add');
    const isGenericAnimateSpecialLandAbility = specialLandConfig?.type === 'animate' &&
      isGenericActivatedAbilityId &&
      /\bbecomes\s+a\b/i.test(scopedAbilityFullText) &&
      /until end of turn/i.test(scopedAbilityFullText);
    const isGenericHideawayPlayAbility = specialLandConfig?.type === 'hideaway' &&
      isGenericActivatedAbilityId &&
      /you may play/i.test(scopedAbilityFullText) &&
      /exiled/i.test(scopedAbilityFullText);
    const hasLegacyAbilityToken = (token: string) => !abilityId.includes('-ability-') && abilityId.includes(token);
    const hasLegacyHybridManaSpecialLandAbilityId = hasLegacyAbilityToken('hybrid-mana');
    const hasLegacyStorageAddCounterAbilityId = hasLegacyAbilityToken('add-counter');
    const hasLegacyStorageRemoveCountersAbilityId = hasLegacyAbilityToken('remove-counters');
    const hasLegacyAnimateSpecialLandAbilityId = hasLegacyAbilityToken('animate');
    const hasLegacyHideawayPlayAbilityId = hasLegacyAbilityToken('play-hideaway');

    // If a special land ability will return early, we still need to enforce chosen-name activation lockouts.
    // Best-effort mapping for our special ability IDs.
    const isSpecialLandManaAbility =
      (specialLandConfig?.type === 'hybrid_mana_production' && (hasLegacyHybridManaSpecialLandAbilityId || isGenericHybridManaSpecialLandAbility)) ||
      (specialLandConfig?.type === 'storage_counter' && (hasLegacyStorageRemoveCountersAbilityId || isGenericStorageRemoveCountersAbility));

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
    if (specialLandConfig?.type === 'hybrid_mana_production' && (hasLegacyHybridManaSpecialLandAbilityId || isGenericHybridManaSpecialLandAbility)) {
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
      if (hasLegacyStorageAddCounterAbilityId || isGenericStorageAddCounterAbility) {
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
        
        const manaPoolBeforePayment = snapshotInteractionManaPool(manaPool);

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

        try {
          appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
            playerId: pid,
            permanentId,
            abilityId,
            cardName,
            tappedPermanents: [String(permanentId)],
            paymentManaDelta: calculateInteractionManaPoolDelta(manaPoolBeforePayment, manaPool),
            counterUpdates: [{
              permanentId: String(permanentId),
              deltas: { [specialLandConfig.counterType!]: 1 },
            }],
          });
        } catch (e) {
          debugWarn(1, 'appendEvent(activateBattlefieldAbility:storage-add) failed:', e);
        }

        broadcastGame(io, game, gameId);
        return;
      } else if (hasLegacyStorageRemoveCountersAbilityId || isGenericStorageRemoveCountersAbility) {
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
    if (specialLandConfig?.type === 'animate' && (hasLegacyAnimateSpecialLandAbilityId || isGenericAnimateSpecialLandAbility)) {
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
      
      const manaPoolBeforePayment = snapshotInteractionManaPool(manaPool);

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

      try {
        appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
          playerId: pid,
          permanentId,
          abilityId,
          cardName,
          paymentManaDelta: calculateInteractionManaPoolDelta(manaPoolBeforePayment, manaPool),
          specialAnimation: {
            animatedUntilEOT: true,
            basePower: specialLandConfig.power,
            baseToughness: specialLandConfig.toughness,
            effectivePower: specialLandConfig.power,
            effectiveToughness: specialLandConfig.toughness,
            typeAdditions: Array.from(new Set(Array.isArray((permanent as any).typeAdditions) ? (permanent as any).typeAdditions : [])),
            hasAllCreatureTypes: (permanent as any).hasAllCreatureTypes === true,
            untilEndOfTurn: { ...(permanent as any).untilEndOfTurn },
          },
        });
      } catch (e) {
        debugWarn(1, 'appendEvent(activateBattlefieldAbility:animate-land) failed:', e);
      }

      broadcastGame(io, game, gameId);
      return;
    }
    
    // 4. HIDEAWAY - Face-down Exile Implementation
    // Hideaway is handled during ETB (Enter the Battlefield), not as activated ability
    // The activated ability is just playing the exiled card
    if (specialLandConfig?.type === 'hideaway' && (hasLegacyHideawayPlayAbilityId || isGenericHideawayPlayAbility)) {
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
    const hasFetchPattern = lowerScopedAbilityFullText.includes("sacrifice") && 
      lowerScopedAbilityFullText.includes("search your library") && 
      (lowerScopedAbilityFullText.includes("land card") || 
       // Check for basic land type searching like "search...for a forest or plains"
       (lowerScopedAbilityFullText.match(/search[^.]*for[^.]*(?:forest|plains|island|swamp|mountain)/) !== null));
    
    // Exclude creatures and non-land artifacts from fetch land detection
    const isFetchLandAbility = (abilityId === "fetch-land" || hasLegacyAbilityToken("-fetch-") || (isGenericActivatedAbilityId && hasFetchPattern)) && 
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
      
      const fetchAbilityText = (abilityId === "fetch-land" || hasLegacyAbilityToken("-fetch-"))
        ? oracleText
        : lowerScopedAbilityFullText;

      let manaCostStr = '';
      // Parse and validate mana cost from oracle text
      // Examples: "{2}, {T}, Sacrifice ~" (Myriad Landscape), "{3}{G}, {T}, Sacrifice ~" (Blighted Woodland)
      const manaCostMatch = fetchAbilityText.match(/\{[^}]+\}(?:\s*,\s*\{[^}]+\})*(?=\s*,\s*\{t\})/i);
      if (manaCostMatch) {
        manaCostStr = manaCostMatch[0];
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
      const isTrueFetch = fetchAbilityText.includes("pay 1 life");
      
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

        try {
          (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
          (game.state as any).lifeLostThisTurn[String(pid)] = ((game.state as any).lifeLostThisTurn[String(pid)] || 0) + 1;
        } catch {}
        
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
      {
        const { movePermanentToGraveyard } = await import('../state/modules/counters_tokens.js');
        movePermanentToGraveyard(game as any, String(permanentId), true);
      }
      
      // Parse what land types this fetch can find
      const filter = parseSearchCriteria(fetchAbilityText);
      
      // Parse maxSelections from oracle text (e.g., "up to two" in Myriad Landscape)
      let maxSelections = 1; // Default to 1
      const upToMatch = fetchAbilityText.match(/search your library for up to (\w+)/i);
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
      const entersTapped = /(?:put (?:it|them) onto|enters) the battlefield tapped/i.test(fetchAbilityText);
      
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
        activatedAbilityText: fetchAbilityText,
        ...(manaCostStr ? { manaCost: manaCostStr } : {}),
        ...(isTrueFetch ? { lifePaidForCost: 1 } : {}),
        searchParams: {
          filter,
          searchDescription,
          isTrueFetch,
          maxSelections,
          entersTapped,
          cardImageUrl: card?.image_uris?.small || card?.image_uris?.normal,
        },
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
    
    // Handle sacrifice-to-draw abilities (Sunbaked Canyon, Horizon Canopy, Commander's Sphere, etc.)
    // Patterns:
    // - "{cost}, {T}, Sacrifice ~: Draw a card"
    // - "Sacrifice ~: Draw a card"
    // The client generates abilityId like "{cardId}-ability-{index}" for general activated abilities
    // Only process if oracle text actually has the sacrifice-to-draw pattern
    const hasSacrificeDrawPattern = scopedAbilityFullText.includes("sacrifice") && scopedAbilityFullText.includes("draw a card");
    const isSacrificeDrawAbility = (hasLegacyAbilityToken("sacrifice-draw") || abilityId.includes("-ability-")) && hasSacrificeDrawPattern;
    if (isSacrificeDrawAbility) {
      // Parse optional mana/tap costs from oracle text.
      const sacrificeCostMatch = scopedAbilityFullText.match(/^(?:(\{[^}]+\}(?:\s*\{[^}]+\})*)\s*,\s*)?(?:(\{T\})\s*,\s*)?sacrifice\s+([^:]+):\s*draw a card\.?$/i);
      
      if (sacrificeCostMatch) {
        const sacrificeSubject = String(sacrificeCostMatch[3] || '').trim().toLowerCase();
        const selfSacrificeSubjects = new Set([
          '~',
          'this',
          'this artifact',
          'this creature',
          'this enchantment',
          'this land',
          'this permanent',
          String(cardName || '').trim().toLowerCase(),
        ]);

        if (!selfSacrificeSubjects.has(sacrificeSubject)) {
          // Costs like "Sacrifice a creature: Draw a card" need the generic activation-cost flow.
        } else {
        const manaCostStr = sacrificeCostMatch[1];
        const requiresTap = Boolean(sacrificeCostMatch[2]);
        const manaPool = getOrInitManaPool(game.state, pid);

        if (manaCostStr) {
          const parsedCost = parseManaCost(manaCostStr);

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

        // Validate: permanent must not already be tapped if tapping is part of the cost
        if (requiresTap && (permanent as any).tapped) {
          socket.emit("error", {
            code: "ALREADY_TAPPED",
            message: `${cardName} is already tapped`,
          });
          return;
        }

        // Tap the permanent if required (part of cost - paid immediately)
        if (requiresTap) {
          (permanent as any).tapped = true;
        }
        
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
          requiresTap,
        });
        
        broadcastGame(io, game, gameId);
        return;
        }
      }
    }
    
    // Handle equip abilities (equipment cards)
    // Check if this is an equip ability - abilityId contains "equip" or it's an equipment with equip cost
    const isEquipment = typeLine.includes("equipment");
    const hasExplicitEquipAbilityId = /-equip-(\d+)$/i.test(abilityId) || abilityId === 'equip';
    const equipAbilityText = hasExplicitEquipAbilityId ? oracleText : scopedAbilityFullText;
    const isEquipAbility = hasExplicitEquipAbilityId || (isEquipment && /\bequip\b/i.test(equipAbilityText));
    if (isEquipAbility) {
      // Parse all equip abilities from oracle text to match the one being activated
      // Format: "Equip [type] [creature] {cost}" e.g., "Equip legendary creature {3}" or "Equip {7}"
      // Note: Use [a-zA-Z] to match both upper and lower case creature types (Knight, Legendary, etc.)
      const equipRegex = /equip(?:\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?))?(?:\s+creature)?\s*(\{[^}]+\}(?:\{[^}]+\})*)/gi;
      const equipAbilities: { type: string | null; cost: string; index: number }[] = [];
      let equipMatch;
      let index = 0;
      while ((equipMatch = equipRegex.exec(equipAbilityText)) !== null) {
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

      const activatedAbilityText = `Equip ${equipCost}`;

      // Unified Resolution Queue prompt
      const existing = ResolutionQueueManager
        .getStepsForPlayer(gameId, pid as any)
        .find((s: any) => s?.type === ResolutionStepType.TARGET_SELECTION && (s as any)?.battlefieldAbilityTargetSelection === true && String((s as any)?.abilityType || (s as any)?.abilityId || '') === 'equip' && String((s as any)?.equipmentId || (s as any)?.permanentId || s?.sourceId) === String(permanentId));

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
          targetTypes: ['creature'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: equipType ? `${equipType} creature you control` : 'creature you control',
          battlefieldAbilityTargetSelection: true,
          equipmentId: permanentId,
          permanentId,
          equipmentName: cardName,
          cardName,
          abilityId: 'equip',
          abilityText: activatedAbilityText,
          activatedAbilityText,
          abilityType: 'equip',
          equipCost,
          equipType,
          targetsOpponentCreatures: false,
        } as any);
      }

      debug(2, `[activateBattlefieldAbility] Equip ability on ${cardName}: queued TARGET_SELECTION (cost=${equipCost}, type=${equipType || 'any'})`);
      broadcastGame(io, game, gameId);
      return;
    }

    // Handle fortify abilities (Fortification cards)
    const hasExplicitFortifyAbilityId = /-fortify-(\d+)$/i.test(abilityId) || abilityId === 'fortify';
    const fortifyMatch = oracleText.match(/fortify\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
    const isFortifyAbility = hasExplicitFortifyAbilityId && typeLine.includes('fortification') && fortifyMatch;

    if (isFortifyAbility && fortifyMatch) {
      const fortifyCost = fortifyMatch[1];
      const validTargets = battlefield.filter((p: any) => {
        if (p.controller !== pid) return false;
        const pTypeLine = (p.card?.type_line || '').toLowerCase();
        return pTypeLine.includes('land');
      });

      if (validTargets.length === 0) {
        socket.emit('error', {
          code: 'NO_VALID_TARGETS',
          message: 'You have no lands to fortify',
        });
        return;
      }

      const activatedAbilityText = `Fortify ${fortifyCost}`;

      const existing = ResolutionQueueManager
        .getStepsForPlayer(gameId, pid as any)
        .find((s: any) => s?.type === ResolutionStepType.TARGET_SELECTION && (s as any)?.battlefieldAbilityTargetSelection === true && String((s as any)?.abilityType || (s as any)?.abilityId || '') === 'fortify' && String((s as any)?.fortificationId || (s as any)?.permanentId || s?.sourceId) === String(permanentId));

      if (!existing) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: pid as PlayerID,
          sourceId: permanentId,
          sourceName: cardName,
          sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
          description: `Choose a land to fortify ${cardName} to (${fortifyCost}).`,
          mandatory: false,
          validTargets: validTargets.map((land: any) => ({
            id: land.id,
            label: land.card?.name || 'Land',
            description: land.card?.type_line || 'Land',
            imageUrl: land.card?.image_uris?.small || land.card?.image_uris?.normal,
          })),
          targetTypes: ['land'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: 'land you control',
          battlefieldAbilityTargetSelection: true,
          fortificationId: permanentId,
          permanentId,
          fortificationName: cardName,
          cardName,
          abilityId: 'fortify',
          abilityText: activatedAbilityText,
          activatedAbilityText,
          abilityType: 'fortify',
          fortifyCost,
        } as any);
      }

      debug(2, `[activateBattlefieldAbility] Fortify ability on ${cardName}: queued TARGET_SELECTION (cost=${fortifyCost})`);
      broadcastGame(io, game, gameId);
      return;
    }

    const hasExplicitReconfigureAttachAbilityId = /-reconfigure-attach-(\d+)$/i.test(abilityId);
    const hasExplicitReconfigureUnattachAbilityId = /-reconfigure-unattach-(\d+)$/i.test(abilityId);
    const reconfigureMatch = oracleText.match(/reconfigure\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
    const isReconfigureEquipment = typeLine.includes('equipment') && /\breconfigure\b/i.test(oracleText);

    if (hasExplicitReconfigureAttachAbilityId && isReconfigureEquipment && reconfigureMatch) {
      const reconfigureCost = reconfigureMatch[1];
      const validTargets = battlefield.filter((p: any) => {
        if (!p || p.controller !== pid) return false;
        if (String(p.id) === String(permanentId)) return false;
        return isCreatureNow(p);
      });

      if (validTargets.length === 0) {
        socket.emit('error', {
          code: 'NO_VALID_TARGETS',
          message: 'You have no other creatures to attach this reconfigure permanent to',
        });
        return;
      }

      const activatedAbilityText = `Reconfigure ${reconfigureCost}`;
      const existing = ResolutionQueueManager
        .getStepsForPlayer(gameId, pid as any)
        .find((s: any) => s?.type === ResolutionStepType.TARGET_SELECTION && (s as any)?.battlefieldAbilityTargetSelection === true && String((s as any)?.abilityType || '') === 'reconfigure_attach' && String((s as any)?.reconfigureId || (s as any)?.permanentId || s?.sourceId) === String(permanentId));

      if (!existing) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: pid as PlayerID,
          sourceId: permanentId,
          sourceName: cardName,
          sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
          description: `Choose a creature to attach ${cardName} to (Reconfigure ${reconfigureCost}).`,
          mandatory: false,
          validTargets: validTargets.map((c: any) => ({
            id: c.id,
            label: `${c.card?.name || 'Creature'} (${getEffectivePower(c)}/${getEffectiveToughness(c)})`,
            description: c.card?.type_line || 'Creature',
            imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
          })),
          targetTypes: ['creature'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: 'another creature you control',
          battlefieldAbilityTargetSelection: true,
          reconfigureId: permanentId,
          permanentId,
          reconfigureName: cardName,
          cardName,
          abilityId,
          abilityText: 'Attach to target creature you control',
          activatedAbilityText,
          abilityType: 'reconfigure_attach',
          reconfigureCost,
          targetsOpponentCreatures: false,
        } as any);
      }

      debug(2, `[activateBattlefieldAbility] Reconfigure attach ability on ${cardName}: queued TARGET_SELECTION (cost=${reconfigureCost})`);
      broadcastGame(io, game, gameId);
      return;
    }

    if (hasExplicitReconfigureUnattachAbilityId && isReconfigureEquipment && reconfigureMatch) {
      const reconfigureCost = reconfigureMatch[1];

      if (!(permanent as any).attachedTo) {
        socket.emit('error', {
          code: 'INVALID_ACTIVATION',
          message: `${cardName} is not attached to anything.`,
        });
        return;
      }

      const pool = getOrInitManaPool(game.state, pid);
      const paid = validateAndConsumeManaCostFromPool(pool as any, reconfigureCost, { logPrefix: '[activateBattlefieldAbility:reconfigure-unattach]' });
      if (!paid.ok) {
        socket.emit('error', {
          code: 'INSUFFICIENT_MANA',
          message: (paid as any).error || `Cannot pay ${reconfigureCost}.`,
        });
        return;
      }

      broadcastManaPoolUpdate(io, gameId, pid, pool as any, `Activated ${cardName}`, game);

      const stackItem = {
        id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'ability' as const,
        controller: pid,
        source: permanentId,
        sourceName: cardName,
        description: 'Unattach this Equipment',
        activatedAbilityText: `Reconfigure ${reconfigureCost}`,
        abilityType: 'reconfigure_unattach',
      } as any;

      game.state.stack = game.state.stack || [];
      game.state.stack.push(stackItem);

      io.to(gameId).emit('stackUpdate', {
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

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `⚡ ${getPlayerName(game, pid)} activated ${cardName}'s ability: Unattach this Equipment`,
        ts: Date.now(),
      });

      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }

      appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
        playerId: pid,
        permanentId,
        abilityId,
        cardName,
        abilityText: 'Unattach this Equipment',
        activatedAbilityText: `Reconfigure ${reconfigureCost}`,
        abilityType: 'reconfigure_unattach',
      });

      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle activated abilities that grant abilities/keywords to target creatures.
    // Supports both trailing-duration text ("Target creature gains flying until end of turn")
    // and leading-duration text ("Until end of turn, target creature gains ...").
    // Examples: Fire Nation Palace ("{1}{R}, {T}: Target creature you control gains firebending 4")
    //           Sokrates, Athenian Teacher ("{T}: Until end of turn, target creature gains ...")
    // Note: This also applies to instants/sorceries that grant abilities, but those are handled
    // during spell resolution via the targeting system
    const scopedGrantResolvedAbilityText = String(scopedAbilityFullText).replace(/^[^:]+:\s*/, '').trim();
    const scopedGrantActivatedAbilityText = String(scopedAbilityFullText || '').trim();
    const grantAbilityMatch = scopedGrantResolvedAbilityText.match(/^(?:until end of turn,\s*)?target\s+creature(?:\s+(you control|an opponent controls))?.*?\s+(gains?|gets?)\s+(.+)$/i);
    const hasExplicitGrantAbilityId = /-grant-ability-(\d+)$/i.test(abilityId) || abilityId === 'grant-ability';

    if (grantAbilityMatch && (hasExplicitGrantAbilityId || isGenericActivatedAbilityId)) {
      const targetRestriction = grantAbilityMatch[1]?.toLowerCase() || 'any';
      let abilityGranted = grantAbilityMatch[3].trim();
      
      // Clean up the ability text
      abilityGranted = abilityGranted.replace(/\s+until end of turn\.?$/i, '').trim();
      abilityGranted = abilityGranted.replace(/\.$/, '').trim();
      if (abilityGranted.startsWith('"') && abilityGranted.endsWith('"')) {
        abilityGranted = abilityGranted.slice(1, -1).trim();
      }
      
      debug(2, `[activateBattlefieldAbility] Grant ability detected: ${cardName} - "${abilityGranted}" (restriction: ${targetRestriction})`);
      
      // Determine if this targets own or opponent creatures
      const targetsOwnCreatures = targetRestriction.includes('you control');
      const targetsOpponentCreatures = targetRestriction.includes("opponent");
      const targetDescription = targetsOpponentCreatures
        ? 'creature an opponent controls'
        : targetsOwnCreatures
          ? 'creature you control'
          : 'creature';
      const promptTargetDescription = targetsOpponentCreatures
        ? 'a target creature an opponent controls'
        : targetsOwnCreatures
          ? 'a target creature you control'
          : 'a target creature';
      
      // Get valid target creatures
      const validTargets = battlefield.filter((p: any) => {
        const pTypeLine = (p.card?.type_line || "").toLowerCase();
        if (!pTypeLine.includes("creature")) return false;
        
        if (targetsOpponentCreatures) {
          return p.controller !== pid; // Opponent's creatures
        }

        if (targetsOwnCreatures) {
          return p.controller === pid; // Own creatures
        }

        return true; // Any creature
      });
      
      if (validTargets.length === 0) {
        socket.emit("error", {
          code: "NO_VALID_TARGETS",
          message: targetsOpponentCreatures 
            ? "No opponent creatures to target"
            : targetsOwnCreatures
              ? "You have no creatures to target"
              : "No creatures to target",
        });
        return;
      }

      // Unified Resolution Queue prompt
      const existing = ResolutionQueueManager
        .getStepsForPlayer(gameId, pid as any)
        .find((s: any) => s?.type === ResolutionStepType.TARGET_SELECTION && (s as any)?.battlefieldAbilityTargetSelection === true && String((s as any)?.abilityId || '') === String(abilityId) && String(s?.sourceId) === String(permanentId));

      if (!existing) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: pid as PlayerID,
          sourceId: permanentId,
          sourceName: cardName,
          sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
          description: `${cardName}: Choose ${promptTargetDescription} to gain ${abilityGranted} until end of turn.`,
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
          targetDescription,

          battlefieldAbilityTargetSelection: true,
          permanentId,
          abilityId,
          cardName,
          abilityText: scopedGrantResolvedAbilityText,
          activatedAbilityText: scopedGrantActivatedAbilityText || undefined,
        } as any);
      }

      debug(2, `[activateBattlefieldAbility] Ability grant on ${cardName}: queued TARGET_SELECTION (ability="${abilityGranted}")`);
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle graveyard exile abilities (Keen-Eyed Curator, etc.)
    // Pattern: "{1}: Exile target card from a graveyard"
    const lowerScopedAbilityText = scopedAbilityFullText.toLowerCase();
    const hasGraveyardExileAbility = lowerScopedAbilityText.includes("exile target card from a graveyard") ||
      lowerScopedAbilityText.includes("exile target card from any graveyard");
    const hasExplicitExileGraveyardAbilityId = /-exile-graveyard-(\d+)$/i.test(abilityId) || abilityId === 'exile-graveyard';
    if (hasGraveyardExileAbility && (hasExplicitExileGraveyardAbilityId || isGenericActivatedAbilityId)) {
      // Parse the cost
      const costMatch = scopedAbilityFullText.match(/\{([^}]+)\}:\s*exile target card from (?:a|any) graveyard/i);
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
      if (scopedAbilityFullText.match(/\{[^}]*\bT\b[^}]*\}:/)) {
        (permanent as any).tapped = true;
      }

      const resolvedAbilityText = String(scopedAbilityText || 'Exile target card from a graveyard.').trim();
      const resolvedActivatedAbilityText = String(scopedAbilityFullText || `${cost}: ${resolvedAbilityText}`).trim();

      // Route through the shared battlefield target-selection continuation so the
      // activation becomes a real stack item and copied abilities can retarget honestly.
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
        battlefieldAbilityTargetSelection: true,
        permanentId,
        abilityId,
        cardName,
        abilityText: resolvedAbilityText,
        activatedAbilityText: resolvedActivatedAbilityText,
        tappedPermanentsForCost: (scopedAbilityFullText.match(/\{[^}]*\bT\b[^}]*\}:/) ? [String(permanentId)] : []),
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
    const controlChangeAbilityText = String(
      scopedAbilityFullText || abilityConfig?.tapAbility?.effect || oracleText || ''
    ).trim();
    const hasControlChangeAbility = /(?:target\s+opponent\s+gains\s+control|opponent\s+gains\s+control)/i.test(controlChangeAbilityText);
    
    if (hasControlChangeAbility) {
      // Get effect details from registry first, then fall back to oracle text parsing
      let drawCards = abilityConfig?.tapAbility?.effect?.match(/draw (\w+) card/i)?.[1];
      
      // Fallback: Parse draw count directly from oracle text if not found in registry
      if (!drawCards) {
        const oracleDrawMatch = controlChangeAbilityText.match(/draw (\w+) card/i);
        if (oracleDrawMatch) {
          drawCards = oracleDrawMatch[1].toLowerCase();
        }
      }
      
      // Convert word numbers to actual count using module-level constant
      const drawCount = drawCards ? (WORD_TO_NUMBER[drawCards.toLowerCase()] || 0) : 0;
      
      debug(2, `[activateBattlefieldAbility] Control change ability on ${cardName}: drawCards=${drawCards}, drawCount=${drawCount}`);
      
      // Parse the cost
      const { requiresTap, manaCost } = parseActivationCost(controlChangeAbilityText, /(?:draw|opponent gains control)/i);
      
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
        controlChangeAbilityText,
        {
          type: 'control_change',
          permanentId,
          drawCards: drawCount,
        },
        true,
        false
      );
      
      debug(2, `[activateBattlefieldAbility] Control change ability on ${cardName}: ${manaCost ? `paid ${manaCost}, ` : ''}${requiresTap ? 'tapped, ' : ''}prompting for opponent selection`);
      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }
      broadcastGame(io, game, gameId);
      return;
    }

    // Handle Fight abilities (Brash Taunter, etc.)
    // Pattern: "{Cost}: This creature fights target creature you don't control"
    // Pattern: "{Cost}: This creature fights another target creature" (can target any creature)
    const hasFightAbility = scopedAbilityFullText.includes("fights") || scopedAbilityFullText.includes("fight");
    const isFightAbility = hasFightAbility && /\{[^}]+\}[^:]*:\s*[^.]*fights?/i.test(scopedAbilityFullText);
    
    if (isFightAbility) {
      // Parse the cost
      const { requiresTap, manaCost } = parseActivationCost(scopedAbilityFullText, /fights?/i);
      
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
      if (scopedAbilityFullText.includes("you don't control") || scopedAbilityFullText.includes("you do not control")) {
        fightController = 'opponent';
      } else if (scopedAbilityFullText.includes("another target creature") || scopedAbilityFullText.includes("fights another target")) {
        fightController = 'any'; // Can fight any creature including your own
      } else if (scopedAbilityFullText.includes("target creature you control")) {
        fightController = 'you';
      }
      
      // Queue fight target selection via Resolution Queue
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.FIGHT_TARGET,
        playerId: pid as PlayerID,
        sourceId: permanentId,
        sourceName: cardName,
        abilityId,
        sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
        description: scopedAbilityFullText,
        activatedAbilityText: scopedAbilityFullText,
        mandatory: true,
        targetFilter: {
          types: ['creature'],
          controller: fightController,
          excludeSource: true,
        },
        title: `${cardName} - Fight`,
      });
      
      debug(2, `[activateBattlefieldAbility] Fight ability on ${cardName}: ${manaCost ? `paid ${manaCost}, ` : ''}prompting for target creature (controller: ${fightController})`);
      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }
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
    const counterMatch = scopedAbilityFullText.match(/put (?:a|an|one|two|three) ([^\s]+) counters? on target ([^.]+?)(?:\s+you\s+(don't\s+control|control|don't own|own))?(?:\s+for each ([^.]+?))?(?:\.|,|$)/i);
    const isCounterAbility = Boolean(counterMatch);
    
    if (isCounterAbility && counterMatch) {
      const counterType = counterMatch[1].toLowerCase().replace(/[^a-z0-9+\-]/g, ''); // e.g., "bribery", "+1/+1", "loyalty"
      const targetType = counterMatch[2].trim(); // e.g., "creature", "permanent", "artifact", "land"
      const targetRestriction = counterMatch[3] ? counterMatch[3].toLowerCase() : null;
      const scalingText = counterMatch[4] ? counterMatch[4].trim() : null; // e.g., "Elf you control"
      
      // Parse the cost
      const { requiresTap, manaCost } = parseActivationCost(scopedAbilityFullText, /put (?:a|an|one) [^\s]+ counter/i);
      
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
        description: scopedAbilityFullText,
        mandatory: true,
        counterType,
        targetController,
        oracleText: scopedAbilityFullText,
        scalingText,
        validTargets,
        targetTypes: wantsCreature ? ['creature'] : ['permanent'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: targetTypeLower || 'target',
        title: `${cardName} - Add ${counterType} counter`,
      });
      
      debug(2, `[activateBattlefieldAbility] Counter ability on ${cardName}: ${manaCost ? `paid ${manaCost}, ` : ''}prompting for target (controller: ${targetController}, counter: ${counterType})`);
      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle Counter-moving abilities (Nesting Grounds, Resourceful Defense, etc.)
    // Pattern: "{Cost}: Move a counter from target permanent you control onto a second target permanent"
    // Example: Nesting Grounds: "{1}, {T}: Move a counter from target permanent you control onto a second target permanent. Activate only as a sorcery."
    const moveCounterMatch = scopedAbilityFullText.match(/move (?:a|one) counter from target permanent(?:\s+you\s+control)?/i);
    const isMoveCounterAbility = Boolean(moveCounterMatch);
    
    if (isMoveCounterAbility) {
      // Parse the cost
      const { requiresTap, manaCost } = parseActivationCost(scopedAbilityFullText, /move (?:a|one) counter/i);
      
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
        description: scopedAbilityFullText,
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
      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle Tap/Untap abilities (Saryth, Merrow Reejerey, Argothian Elder, etc.)
    // Parse ability text to detect tap/untap abilities
    const tapUntapParams = parseTapUntapAbilityText(scopedAbilityFullText);
    const isTapUntapAbility = Boolean(tapUntapParams);
    
    if (isTapUntapAbility && tapUntapParams) {
      // Parse the cost
      const { requiresTap, manaCost } = parseActivationCost(scopedAbilityFullText, /(?:tap|untap)/i);
      
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
        description: scopedAbilityFullText,
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
      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle Crew abilities (Vehicle cards)
    // Crew N: Tap creatures with total power N or more to make this Vehicle an artifact creature
    const isVehicle = typeLine.includes("vehicle");
    const hasExplicitCrewAbilityId = /-crew-(\d+)$/i.test(abilityId) || abilityId === 'crew';
    const crewAbilityText = hasExplicitCrewAbilityId ? oracleText : scopedAbilityFullText;
    const isCrewAbility = hasExplicitCrewAbilityId || (isVehicle && /\bcrew\b/i.test(crewAbilityText));
    if (isCrewAbility) {
      // Parse crew power requirement from oracle text
      const crewMatch = crewAbilityText.match(/crew\s*(\d+)/i);
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
    
    // Handle Station abilities (Spacecraft cards)
    // Station N (Rule 702.184a): "Tap another untapped creature you control: Put a number of 
    // charge counters on this permanent equal to the tapped creature's power."
    const isSpacecraft = typeLine.includes("spacecraft");
    const hasExplicitStationAbilityId = /-station-(\d+)$/i.test(abilityId) || abilityId === 'station';
    const stationAbilityText = hasExplicitStationAbilityId ? oracleText : scopedAbilityFullText;
    const isStationAbility = hasExplicitStationAbilityId || (isSpacecraft && /\bstation\b/i.test(stationAbilityText));
    if (isStationAbility) {
      // Parse station threshold from oracle text
      const stationThreshold = parseStationThreshold(stationAbilityText);
      
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
        tapForCountersSource: {
          id: permanentId,
          name: cardName,
          imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
          threshold: stationThreshold,
          currentCounters: (permanent as any).counters?.charge || 0,
          counterType: 'charge',
          amountFrom: 'power',
          requireAnother: true,
        },
        tapForCountersCreatures: creatureOptions,
        title: `Station ${stationThreshold}`,
      });
      
      debug(2, `[activateBattlefieldAbility] Station ability on ${cardName}: prompting for creature selection (${untappedCreatures.length} valid targets)`);

      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle Level Up abilities (Rule 702.87)
    // "Level up [cost]" means "[Cost]: Put a level counter on this permanent. Activate only as a sorcery."
    const levelUpMatch = oracleText.match(/level\s+up\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
    const isLevelUpAbility = /-level-up-(\d+)$/i.test(abilityId) || /-levelup-(\d+)$/i.test(abilityId) || abilityId === 'level-up';
    
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
      
      game.state.stack = game.state.stack || [];
      game.state.stack.push({
        id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'ability',
        controller: pid,
        source: permanentId,
        sourceName: cardName,
        description: 'Put a level counter on this permanent',
        activatedAbilityText: scopedAbilityFullText,
        abilityType: 'level_up',
        levelUpParams: {
          amount: 1,
        },
      } as any);

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `⚡ ${getPlayerName(game, pid)} activated ${cardName}'s level up ability. Ability on the stack.`,
        ts: Date.now(),
      });

      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }

      appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
        playerId: pid,
        permanentId,
        abilityId,
        cardName,
        abilityText: 'Put a level counter on this permanent',
        activatedAbilityText: scopedAbilityFullText,
        abilityType: 'level_up',
        levelUpParams: {
          amount: 1,
        },
      });

      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle Outlast abilities (Rule 702.107)
    // "Outlast [cost]" means "[Cost], {T}: Put a +1/+1 counter on this creature. Activate only as a sorcery."
    const outlastMatch = oracleText.match(/outlast\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
    const isOutlastAbility = /-outlast-(\d+)$/i.test(abilityId) || abilityId === 'outlast';
    
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

      game.state.stack = game.state.stack || [];
      game.state.stack.push({
        id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'ability',
        controller: pid,
        source: permanentId,
        sourceName: cardName,
        description: 'Put a +1/+1 counter on this creature',
        activatedAbilityText: scopedAbilityFullText,
        abilityType: 'outlast',
        outlastParams: {
          amount: 1,
          counterType: '+1/+1',
        },
      } as any);

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `⚡ ${getPlayerName(game, pid)} activated ${cardName}'s outlast ability. Ability on the stack.`,
        ts: Date.now(),
      });

      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }

      appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
        playerId: pid,
        permanentId,
        abilityId,
        cardName,
        abilityText: 'Put a +1/+1 counter on this creature',
        activatedAbilityText: scopedAbilityFullText,
        abilityType: 'outlast',
        outlastParams: {
          amount: 1,
          counterType: '+1/+1',
        },
        tappedPermanents: [permanentId],
      });

      broadcastGame(io, game, gameId);
      return;
    }

    // Handle Monstrosity abilities (Rule 702.94)
    // "{cost}: Monstrosity N" means "If this permanent isn't monstrous, put N +1/+1 counters on it and it becomes monstrous."
    const monstrosityMatch = oracleText.match(/(\{[^}]+\}(?:\{[^}]+\})*)\s*:\s*monstrosity\s+(\d+)/i);
    const isMonstrosityAbility = /-monstrosity-(\d+)$/i.test(abilityId);

    if (isMonstrosityAbility && monstrosityMatch) {
      const monstrosityCost = monstrosityMatch[1];
      const monstrosityN = parseInt(monstrosityMatch[2], 10);
      const isAlreadyMonstrous = (permanent as any).isMonstrous === true || (permanent as any).monstrous === true;

      if (isAlreadyMonstrous) {
        socket.emit("error", {
          code: "ALREADY_MONSTROUS",
          message: `${cardName} is already monstrous`,
        });
        return;
      }

      const parsedCost = parseManaCost(monstrosityCost);
      const pool = getOrInitManaPool(game.state, pid);
      const totalAvailable = calculateTotalAvailableMana(pool, []);

      const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
      if (validationError) {
        socket.emit("error", { code: "INSUFFICIENT_MANA", message: validationError });
        return;
      }

      consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[activateBattlefieldAbility:monstrosity]');

      game.state.stack = game.state.stack || [];
      game.state.stack.push({
        id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'ability',
        controller: pid,
        source: permanentId,
        sourceName: cardName,
        description: `Monstrosity ${monstrosityN}`,
        activatedAbilityText: scopedAbilityFullText,
        abilityType: 'monstrosity',
        monstrosityParams: {
          amount: monstrosityN,
        },
      } as any);

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `⚡ ${getPlayerName(game, pid)} activated ${cardName}'s monstrosity ability. Ability on the stack.`,
        ts: Date.now(),
      });

      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }

      appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
        playerId: pid,
        permanentId,
        abilityId,
        cardName,
        abilityText: `Monstrosity ${monstrosityN}`,
        activatedAbilityText: scopedAbilityFullText,
        abilityType: 'monstrosity',
        monstrosityParams: {
          amount: monstrosityN,
        },
      });

      broadcastGame(io, game, gameId);
      return;
    }

    // Handle Adapt abilities (Rule 702.140)
    // "{cost}: Adapt N" means "If this permanent has no +1/+1 counters on it, put N +1/+1 counters on it."
    const adaptMatch = oracleText.match(/(\{[^}]+\}(?:\{[^}]+\})*)\s*:\s*adapt\s+(\d+)/i);
    const isAdaptAbility = /-adapt-(\d+)$/i.test(abilityId);

    if (isAdaptAbility && adaptMatch) {
      const adaptCost = adaptMatch[1];
      const adaptN = parseInt(adaptMatch[2], 10);
      const currentCounters = Number((permanent as any)?.counters?.['+1/+1'] || 0);

      if (currentCounters > 0) {
        socket.emit("error", {
          code: "ALREADY_HAS_COUNTERS",
          message: `${cardName} already has +1/+1 counters`,
        });
        return;
      }

      const parsedCost = parseManaCost(adaptCost);
      const pool = getOrInitManaPool(game.state, pid);
      const totalAvailable = calculateTotalAvailableMana(pool, []);

      const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
      if (validationError) {
        socket.emit("error", { code: "INSUFFICIENT_MANA", message: validationError });
        return;
      }

      consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[activateBattlefieldAbility:adapt]');

      game.state.stack = game.state.stack || [];
      game.state.stack.push({
        id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'ability',
        controller: pid,
        source: permanentId,
        sourceName: cardName,
        description: `Adapt ${adaptN}`,
        activatedAbilityText: scopedAbilityFullText,
        abilityType: 'adapt',
        adaptParams: {
          amount: adaptN,
        },
      } as any);

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `⚡ ${getPlayerName(game, pid)} activated ${cardName}'s adapt ability. Ability on the stack.`,
        ts: Date.now(),
      });

      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }

      appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
        playerId: pid,
        permanentId,
        abilityId,
        cardName,
        abilityText: `Adapt ${adaptN}`,
        activatedAbilityText: scopedAbilityFullText,
        abilityType: 'adapt',
        adaptParams: {
          amount: adaptN,
        },
      });

      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle creature upgrade abilities (Figure of Destiny, Warden of the First Tree, etc.)
    // These are activated abilities that transform or upgrade a creature
    const upgradeAbilities = parseCreatureUpgradeAbilities(oracleText, cardName);
    const hasExplicitUpgradeAbilityId = !abilityId.includes('-ability-') && (abilityId.startsWith("upgrade-") || abilityId.includes("-becomes-"));
    const normalizedScopedUpgradeText = String(scopedAbilityFullText || scopedAbilityText || '')
      .replace(new RegExp(String(cardName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '~')
      .replace(/\s+/g, ' ')
      .trim();
    const matchedUpgradeIndex = upgradeAbilities.findIndex((candidate) =>
      String(candidate?.fullText || '').replace(/\s+/g, ' ').trim() === normalizedScopedUpgradeText
    );
    const isGenericUpgradeAbility = isGenericActivatedAbilityId && matchedUpgradeIndex >= 0;
    if (hasExplicitUpgradeAbilityId || isGenericUpgradeAbility) {
      // Parse the upgrade ability from oracle text
      if (upgradeAbilities.length === 0) {
        socket.emit("error", {
          code: "NO_UPGRADE_ABILITY",
          message: `${cardName} does not have any upgrade abilities`,
        });
        return;
      }
      
      // Determine which upgrade ability to activate based on abilityId
      const upgradeIndex = hasExplicitUpgradeAbilityId
        ? (parseInt(abilityId.replace(/^upgrade-|\-becomes-.*$/g, ''), 10) || 0)
        : matchedUpgradeIndex;
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

      if (splitSecondLockActive) {
        socket.emit('error', {
          code: 'SPLIT_SECOND_LOCK',
          message: "Can't activate abilities while a spell with split second is on the stack.",
        });
        return;
      }

      const pool = getOrInitManaPool(game.state, pid);
      const paid = validateAndConsumeManaCostFromPool(pool as any, String(upgrade.cost || '').trim(), {
        logPrefix: '[activateBattlefieldAbility:upgrade]',
      });
      if (!paid.ok) {
        const paymentError = 'error' in paid ? (paid.error || 'Insufficient mana.') : 'Insufficient mana.';
        socket.emit('error', {
          code: 'INSUFFICIENT_MANA',
          message: paymentError,
        });
        return;
      }
      
      // Put the upgrade ability on the stack
      const stackItem = {
        id: `ability_upgrade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'ability' as const,
        controller: pid,
        source: permanentId,
        sourceName: cardName,
        description: normalizedScopedUpgradeText || upgrade.fullText,
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
        const triggeredAbilities = triggerAbilityActivatedTriggers(game as any, {
          activatedBy: pid as any,
          sourcePermanentId: permanentId as any,
          isManaAbility: false,
          abilityText: normalizedScopedUpgradeText || upgrade.fullText,
          stackItemId: stackItem.id,
        });
        persistAbilityActivatedTriggerPushes(gameId, game, triggeredAbilities);
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
        message: `⚡ ${getPlayerName(game, pid)} activated ${cardName}'s upgrade ability. (${String(normalizedScopedUpgradeText || upgrade.fullText).slice(0, 80)}...)`,
        ts: Date.now(),
      });
      
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle mana abilities (tap-mana-* or native_*)
    if (!abilityId.includes('-ability-') && (abilityId.startsWith("tap-mana") || abilityId.startsWith("native_"))) {
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
      const addedMana = { [poolKey]: manaAmount };
      
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
      const painLifeLost = ((isPainLand || PAIN_LANDS.has(lowerName)) && isTappingForColoredMana) ? 1 : 0;
      if (painLifeLost > 0) {
        // Deal 1 damage to controller
        game.state.life = game.state.life || {};
        const startingLife = game.state.startingLife || 40;
        const currentLife = game.state.life[pid] ?? startingLife;
        game.state.life[pid] = currentLife - painLifeLost;

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
          // Queue opponent choice via the generic option-choice flow.
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.OPTION_CHOICE,
            playerId: pid as PlayerID,
            sourceId: permanentId,
            sourceName: 'Forbidden Orchard',
            sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
            description: 'Choose target opponent to create a 1/1 colorless Spirit creature token.',
            mandatory: true,
            options: opponents.map((p: any) => ({
              id: String(p.id),
              label: String(p.name || p.id),
            })),
            minSelections: 1,
            maxSelections: 1,
            forbiddenOrchardTargetChoice: true,
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
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateManaAbility", {
        playerId: pid,
        permanentId,
        abilityId,
        manaColor,
        addedMana,
        lifeLost: painLifeLost || undefined,
      });
      
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
    if (/^pw-ability-\d+$/i.test(abilityId)) {
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
            case 'graveyard_card':
            case 'graveyard_creature_card':
            case 'graveyard_artifact_card':
            case 'graveyard_enchantment_card':
            case 'graveyard_land_card':
            case 'graveyard_instant_card':
            case 'graveyard_sorcery_card':
            case 'graveyard_planeswalker_card':
            case 'graveyard_nonland_card':
            case 'graveyard_noncreature_card': {
              const graveyard = Array.isArray((game.state as any)?.zones?.[pid]?.graveyard)
                ? (game.state as any).zones[pid].graveyard
                : [];
              const matchesGraveyardCardType = (card: any): boolean => {
                const typeLine = String(card?.type_line || '').toLowerCase();
                switch (targetType.toLowerCase()) {
                  case 'graveyard_card':
                    return true;
                  case 'graveyard_creature_card':
                    return typeLine.includes('creature');
                  case 'graveyard_artifact_card':
                    return typeLine.includes('artifact');
                  case 'graveyard_enchantment_card':
                    return typeLine.includes('enchantment');
                  case 'graveyard_land_card':
                    return typeLine.includes('land');
                  case 'graveyard_instant_card':
                    return typeLine.includes('instant');
                  case 'graveyard_sorcery_card':
                    return typeLine.includes('sorcery');
                  case 'graveyard_planeswalker_card':
                    return typeLine.includes('planeswalker');
                  case 'graveyard_nonland_card':
                    return !typeLine.includes('land');
                  case 'graveyard_noncreature_card':
                    return !typeLine.includes('creature');
                  default:
                    return false;
                }
              };
              validTargets.push(...graveyard
                .filter((card: any) => matchesGraveyardCardType(card))
                .map((card: any) => ({
                  id: card.id,
                  kind: 'graveyard_card',
                  name: card.name || 'Card',
                  controller: pid,
                  imageUrl: card.image_uris?.small || card.image_uris?.normal,
                })));
              break;
            }
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
              type: t.kind === 'player' ? 'player' : (t.kind === 'graveyard_card' ? 'graveyard_card' : 'permanent'),
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
      try {
        const triggeredAbilities = triggerAbilityActivatedTriggers(game as any, {
          activatedBy: pid as any,
          sourcePermanentId: permanentId as any,
          isManaAbility: false,
          abilityText: ability.text,
          stackItemId: stackItem.id,
        });
        persistAbilityActivatedTriggerPushes(gameId, game, triggeredAbilities);
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
    const isBoastAbility = /-boast-\d+$/i.test(String(abilityId || ''));
    
    // Extract ability text by parsing oracle text for activated abilities
    let abilityText = "";
    let requiresTap = false;
    let manaCost = "";
    let sacrificeType: 'creature' | 'artifact' | 'enchantment' | 'land' | 'permanent' | 'self' | 'artifact_or_creature' | null = null;
    let sacrificeSubtype: string | undefined = undefined; // For creature subtypes like Soldier, Goblin, etc.
    let sacrificeCount = 1;
    let mustBeOther = false;
    const abilityOracleText = String(scopedAbilityFullText || oracleText || '').trim();
    
    // Parse activated abilities: look for "cost: effect" patterns
    const abilityPattern = /([^:]+):\s*([^.]+\.?)/gi;
    const abilities: { cost: string; effect: string }[] = [];
    let match;
    while ((match = abilityPattern.exec(abilityOracleText)) !== null) {
      const cost = match[1].trim();
      const effect = match[2].trim();
      // Filter out keyword abilities and keep only activated abilities
      const costLower = cost.toLowerCase();
      if (
        cost.includes('{') ||
        costLower.includes('tap') ||
        costLower.includes('sacrifice') ||
        costLower.includes('discard') ||
        (costLower.includes('remove') && costLower.includes('counter')) ||
        (costLower.includes('pay') && costLower.includes('life')) ||
        costLower.includes('exile') ||
        costLower.includes('return')
      ) {
        abilities.push({ cost, effect });
      }
    }
    
    if (abilityIndex < abilities.length) {
      const ability = abilities[abilityIndex];
      abilityText = ability.effect;
      // Only treat the ability as requiring the SOURCE to tap when the cost includes an explicit tap symbol
      // (or the old-style "Tap:" shorthand). Do NOT match "Tap an untapped creature you control" etc.
      requiresTap = /\{t\}/i.test(ability.cost) || /^\s*tap\s*:/i.test(ability.cost);
      manaCost = ability.cost;
      
      // Detect sacrifice type from cost using shared utility
      const sacrificeInfo = parseSacrificeCost(ability.cost);
      if (sacrificeInfo.requiresSacrifice && sacrificeInfo.sacrificeType) {
        sacrificeType = sacrificeInfo.sacrificeType;
        sacrificeSubtype = sacrificeInfo.creatureSubtype;
        sacrificeCount = sacrificeInfo.sacrificeCount || 1;
        mustBeOther = Boolean(sacrificeInfo.mustBeOther);
      }

      if (
        /^choose a color\.?$/i.test(String(abilityText || '').trim()) &&
        /add\s+an\s+amount\s+of\s+mana\s+of\s+that\s+color/i.test(oracleText)
      ) {
        const fullChooseColorManaMatch = oracleText.match(
          /choose a color\.\s*add\s+an\s+amount\s+of\s+mana\s+of\s+that\s+color[^.]*\./i
        );
        if (fullChooseColorManaMatch) {
          abilityText = fullChooseColorManaMatch[0].trim();
        }
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
        requiresTap = /\{t\}/i.test(ability.cost) || /^\s*tap\s*:/i.test(ability.cost);
        manaCost = ability.cost;
        
        const sacrificeInfo = parseSacrificeCost(ability.cost);
        if (sacrificeInfo.requiresSacrifice && sacrificeInfo.sacrificeType) {
          sacrificeType = sacrificeInfo.sacrificeType;
          sacrificeSubtype = sacrificeInfo.creatureSubtype;
          sacrificeCount = sacrificeInfo.sacrificeCount || 1;
          mustBeOther = Boolean(sacrificeInfo.mustBeOther);
        }
      } else {
        // Use the full oracle text to check if this is a mana ability
        // This handles simple cases like basic lands: "{T}: Add {G}"
        abilityText = abilityOracleText;
        requiresTap = abilityOracleText.includes('{T}:') || abilityOracleText.toLowerCase().includes('tap:');
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

    if (isBoastAbility) {
      const attackedThisTurn = (permanent as any)?.attackedThisTurn === true || !!(permanent as any)?.attacking || (permanent as any)?.isAttacking === true;
      if (!attackedThisTurn) {
        socket.emit('error', {
          code: 'ACTIVATION_CONDITION_NOT_MET',
          message: `${cardName}'s boast ability can only be activated if it attacked this turn.`,
        });
        return;
      }

      if ((permanent as any)?.activatedThisTurn === true) {
        socket.emit('error', {
          code: 'ABILITY_ALREADY_USED',
          message: `${cardName}'s boast ability has already been activated this turn.`,
        });
        return;
      }
    }

    // ========================================================================
    // TAP OTHER PERMANENTS AS AN ACTIVATION COST (generic)
    // Examples:
    // - "Tap an untapped creature you control: ..."
    // - "Tap two untapped artifacts you control: ..."
    // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus exactly one
    // "Tap N untapped <type/subtype> you control" clause. No mixed sacrifice/discard/etc.
    // ========================================================================
    {
      const costStr = String(manaCost || '');
      const costLower = costStr.toLowerCase();

      // Avoid mixing multiple interactive cost types for now.
      if (costLower.includes('tap') && (costLower.includes('discard') || costLower.includes('sacrifice') || costLower.includes('exile'))) {
        // Let other cost handlers (discard/sacrifice/etc.) handle their own errors/prompts.
      } else {
        const tapOtherMatchRestrictionAfter = costLower.match(
          /\btap\s+(another\s+|other\s+)?(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+untapped\s+([a-z]+(?:\s+[a-z]+)*)\s+you\s+control\s+with\s+(power|toughness)\s+(\d+)\s+or\s+(less|greater)\b/i
        );

        const tapOtherMatchRestrictionBefore = costLower.match(
          /\btap\s+(another\s+|other\s+)?(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+untapped\s+([a-z]+(?:\s+[a-z]+)*(?:\s+with\s+(?:power|toughness)\s+\d+\s+or\s+(?:less|greater))?)\s+you\s+control\b/i
        );

        const tapOtherMatchBase = costLower.match(
          /\btap\s+(another\s+|other\s+)?(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+untapped\s+([a-z]+(?:\s+[a-z]+)*)\s+you\s+control\b/i
        );

        const tapOtherMatch = tapOtherMatchRestrictionAfter || tapOtherMatchRestrictionBefore || tapOtherMatchBase;

        if (tapOtherMatch) {
          // Optional supported additional clause: "Pay N life" (non-interactive).
          // IMPORTANT: do not actually pay life until the tap-target step resolves;
          // otherwise canceling the step would incorrectly charge life.
          let lifeToPayForCost: number | undefined;
          {
            const payLifeMatch = costStr.match(/\bpay\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/i);
            if (payLifeMatch) {
              // Conservative: reject choice-based pay-life costs ("or") and multiple pay-life clauses.
              const multiple = (costLower.match(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi) || []).length;
              if (multiple > 1 || /\bor\b/i.test(costStr)) {
                socket.emit('error', {
                  code: 'UNSUPPORTED_COST',
                  message: `Cannot activate ${cardName}: pay-life costs with choices ("or") are not supported yet.`,
                });
                return;
              }

              const raw = String(payLifeMatch[1] || '').trim();
              const n = parseWordNumber(raw, 1);
              if (!Number.isFinite(n) || n <= 0) {
                socket.emit('error', {
                  code: 'UNSUPPORTED_COST',
                  message: `Cannot activate ${cardName}: invalid life payment amount.`,
                });
                return;
              }

              const currentLife = Number((game.state as any)?.life?.[pid] ?? 40);
              if (!Number.isFinite(currentLife) || currentLife < n) {
                socket.emit('error', {
                  code: 'INSUFFICIENT_LIFE',
                  message: `Cannot activate ${cardName}: need to pay ${n} life, but you only have ${Number.isFinite(currentLife) ? currentLife : 0}.`,
                });
                return;
              }

              lifeToPayForCost = n;
            }
          }

          const mustBeOther = Boolean(tapOtherMatch[1]);
          const rawCount = String(tapOtherMatch[2] || '').trim();
          const targetCount = parseWordNumber(rawCount, 1);
          const rawTypePhrase = String(tapOtherMatch[3] || '').trim();

          // Optional supported restriction: "with power/toughness N or less/greater".
          let baseTypePhrase = rawTypePhrase;
          let minPower: number | undefined;
          let maxPower: number | undefined;
          let minToughness: number | undefined;
          let maxToughness: number | undefined;

          const hasRestrictionAfter = tapOtherMatch === tapOtherMatchRestrictionAfter;

          const powerRestr = rawTypePhrase.match(/^(.*?)\s+with\s+power\s+(\d+)\s+or\s+(less|greater)\b/i);
          const toughRestr = rawTypePhrase.match(/^(.*?)\s+with\s+toughness\s+(\d+)\s+or\s+(less|greater)\b/i);

          const afterKind = hasRestrictionAfter ? String((tapOtherMatchRestrictionAfter as any)?.[4] || '') : '';
          const afterN = hasRestrictionAfter ? String((tapOtherMatchRestrictionAfter as any)?.[5] || '') : '';
          const afterDir = hasRestrictionAfter ? String((tapOtherMatchRestrictionAfter as any)?.[6] || '') : '';

          const afterIsPower = hasRestrictionAfter && afterKind.toLowerCase() === 'power';
          const afterIsToughness = hasRestrictionAfter && afterKind.toLowerCase() === 'toughness';

          const afterRestr = hasRestrictionAfter
            ? { kind: afterKind.toLowerCase(), n: parseInt(afterN, 10), dir: afterDir.toLowerCase() }
            : null;

          const afterHasValid = Boolean(afterRestr && Number.isFinite(afterRestr.n) && (afterRestr.dir === 'less' || afterRestr.dir === 'greater') && (afterRestr.kind === 'power' || afterRestr.kind === 'toughness'));
          if ((powerRestr && toughRestr) || ((powerRestr || toughRestr) && afterHasValid)) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: multiple tap-other restrictions are not supported yet.`,
            });
            return;
          }

          if (afterHasValid && afterIsPower) {
            baseTypePhrase = rawTypePhrase;
            const n = afterRestr!.n;
            if (!Number.isFinite(n) || n < 0) {
              socket.emit('error', {
                code: 'UNSUPPORTED_COST',
                message: `Cannot activate ${cardName}: invalid power restriction.`,
              });
              return;
            }
            if (afterRestr!.dir === 'less') maxPower = n;
            else minPower = n;
          } else if (afterHasValid && afterIsToughness) {
            baseTypePhrase = rawTypePhrase;
            const n = afterRestr!.n;
            if (!Number.isFinite(n) || n < 0) {
              socket.emit('error', {
                code: 'UNSUPPORTED_COST',
                message: `Cannot activate ${cardName}: invalid toughness restriction.`,
              });
              return;
            }
            if (afterRestr!.dir === 'less') maxToughness = n;
            else minToughness = n;
          } else if (powerRestr) {
            baseTypePhrase = String(powerRestr[1] || '').trim();
            const n = parseInt(String(powerRestr[2] || '0'), 10);
            const dir = String(powerRestr[3] || '').toLowerCase();
            if (!Number.isFinite(n) || n < 0) {
              socket.emit('error', {
                code: 'UNSUPPORTED_COST',
                message: `Cannot activate ${cardName}: invalid power restriction.`,
              });
              return;
            }
            if (dir === 'less') maxPower = n;
            else minPower = n;
          } else if (toughRestr) {
            baseTypePhrase = String(toughRestr[1] || '').trim();
            const n = parseInt(String(toughRestr[2] || '0'), 10);
            const dir = String(toughRestr[3] || '').toLowerCase();
            if (!Number.isFinite(n) || n < 0) {
              socket.emit('error', {
                code: 'UNSUPPORTED_COST',
                message: `Cannot activate ${cardName}: invalid toughness restriction.`,
              });
              return;
            }
            if (dir === 'less') maxToughness = n;
            else minToughness = n;
          }

          // Conservative: reject other complex phrases.
          if (/(\bthat\b|\bwithout\b|\battacking\b|\bblocking\b|\bequipped\b|\benchanted\b)/i.test(rawTypePhrase)) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: complex tap-other cost restrictions are not supported yet.`,
            });
            return;
          }

          // If we parsed a power/toughness restriction, the base type must be creature-like.
          if ((minPower !== undefined || maxPower !== undefined || minToughness !== undefined || maxToughness !== undefined) && !/\bcreature\b/i.test(baseTypePhrase)) {
            // Allow subtype-only phrasing (e.g. "soldier") which we interpret as creature.
            // But still reject clearly non-creature types.
            const isClearlyNonCreature = /\b(artifact|enchantment|land|planeswalker|battle)\b/i.test(baseTypePhrase);
            if (isClearlyNonCreature) {
              socket.emit('error', {
                code: 'UNSUPPORTED_COST',
                message: `Cannot activate ${cardName}: power/toughness restrictions are only supported for creatures.`,
              });
              return;
            }
          }

          // Ensure there are no other non-mana cost components besides the tap-other clause.
          const remainingNonManaCostText = costStr
            .replace(/\{[^}]+\}/g, ' ')
            .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
            .replace(
              /\btap\s+(?:another\s+|other\s+)?(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+untapped\s+[a-z]+(?:\s+[a-z]+)*(?:\s+with\s+(?:power|toughness)\s+\d+\s+or\s+(?:less|greater))?\s+you\s+control(?:\s+with\s+(?:power|toughness)\s+\d+\s+or\s+(?:less|greater))?\b/gi,
              ' '
            )
            .replace(/[\s,]+/g, ' ')
            .trim();

          if (remainingNonManaCostText.length > 0) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: tap-other cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
            });
            return;
          }

          // Derive a simple type filter for TAP_UNTAP_TARGET.
          const ignored = new Set(['token', 'legendary', 'snow', 'basic', 'nontoken', 'nonbasic']);
          const words = baseTypePhrase
            .toLowerCase()
            .split(/\s+/)
            .map((w) => w.trim())
            .filter((w) => w && !ignored.has(w))
            .map((w) => (w.endsWith('s') ? w.slice(0, -1) : w));

          const knownPermanentTypes = new Set(['creature', 'artifact', 'enchantment', 'land', 'planeswalker', 'battle']);
          const knownHits = words.filter((w) => knownPermanentTypes.has(w));

          let requireAllTypes = false;
          const typesFilter: string[] = [];

          if (knownHits.length > 1) {
            // Support multi-type keywords like "artifact creature" by requiring ALL types.
            // Conservative: only allow phrases that are exactly known permanent types.
            if (!words.every((w) => knownPermanentTypes.has(w))) {
              socket.emit('error', {
                code: 'UNSUPPORTED_COST',
                message: `Cannot activate ${cardName}: tap-other cost with multiple type keywords is not supported yet.`,
              });
              return;
            }

            requireAllTypes = true;
            for (const w of words) {
              if (!typesFilter.includes(w)) typesFilter.push(w);
            }
          } else {
            const baseType = knownHits.length === 1 ? knownHits[0] : '';
            const subtype = baseType ? '' : (words[0] || '');
            if (baseType) {
              typesFilter.push(baseType);
            } else if (subtype) {
              // Treat as creature subtype (e.g. Soldier) and also require creature.
              requireAllTypes = true;
              typesFilter.push('creature', subtype);
            }
          }

          if (typesFilter.length < 1) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: could not parse tap-other cost type.`,
            });
            return;
          }

          const battlefieldNow = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
          const validNow = battlefieldNow.filter((p: any) => {
            if (!p || String(p.controller) !== String(pid)) return false;
            if ((p as any).tapped) return false;
            if (mustBeOther && String(p.id) === String(permanentId)) return false;
            const tl = String(p.card?.type_line || '').toLowerCase();
            const matchesAny = typesFilter.some((t) => tl.includes(String(t).toLowerCase()));
            if (!matchesAny) return false;
            if (requireAllTypes) {
              const matchesAll = typesFilter.every((t) => tl.includes(String(t).toLowerCase()));
              return matchesAll;
            }

            if (minPower !== undefined || maxPower !== undefined) {
              const pwr = getEffectivePower(p);
              if (minPower !== undefined && pwr < minPower) return false;
              if (maxPower !== undefined && pwr > maxPower) return false;
            }
            if (minToughness !== undefined || maxToughness !== undefined) {
              const tgh = getEffectiveToughness(p);
              if (minToughness !== undefined && tgh < minToughness) return false;
              if (maxToughness !== undefined && tgh > maxToughness) return false;
            }

            return true;
          });

          if (validNow.length < targetCount) {
            socket.emit('error', {
              code: 'INSUFFICIENT_TARGETS',
              message: `Need ${targetCount} untapped ${rawTypePhrase}${targetCount === 1 ? '' : 's'} you control, but you only have ${validNow.length}.`,
            });
            return;
          }

          const existing = ResolutionQueueManager
            .getStepsForPlayer(gameId, pid as any)
            .find((s: any) => s?.type === ResolutionStepType.TAP_UNTAP_TARGET && (s as any)?.tapOtherAbilityAsCost === true && String((s as any)?.permanentId || s?.sourceId) === String(permanentId));

          if (!existing) {
            const activatedAbilityText = (() => {
              const scopedAbilityText = String(abilityConditionText || '').trim();
              if (scopedAbilityText.includes(':')) return scopedAbilityText;
              return costStr ? `${costStr}: ${abilityText}` : (scopedAbilityText || abilityText);
            })();
            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.TAP_UNTAP_TARGET,
              playerId: pid as PlayerID,
              sourceId: permanentId,
              sourceName: cardName,
              sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
              description: `${cardName}: Tap ${targetCount} untapped ${rawTypePhrase}${targetCount === 1 ? '' : 's'} you control to activate: ${abilityText}`,
              mandatory: false,
              action: 'tap',
              targetFilter: {
                controller: 'you',
                tapStatus: 'untapped',
                excludeSource: mustBeOther,
                types: typesFilter,
                requireAllTypes,
                minPower,
                maxPower,
                minToughness,
                maxToughness,
              },
              targetCount,

              // Custom payload consumed by socket/resolution.ts
              tapOtherAbilityAsCost: true,
              permanentId,
              abilityId,
              cardName,
              abilityText,
              activatedAbilityText,
              manaCost: costStr,
              requiresTap: Boolean(requiresTap),
              lifeToPayForCost,
            } as any);
          }

          debug(2, `[activateBattlefieldAbility] ${cardName} requires tapping ${targetCount} permanent(s) (${rawTypePhrase}) as a cost. Queued TAP_UNTAP_TARGET.`);
          broadcastGame(io, game, gameId);
          return;
        }
      }
    }

    // ========================================================================
    // RETURN A PERMANENT YOU CONTROL TO ITS OWNER'S HAND AS AN ACTIVATION COST (generic)
    // Examples:
    // - "Return a creature you control to its owner's hand: Draw a card."
    // - "{1}, Return another land you control to its owner's hand: ..."
    // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus exactly one
    // "Return (another/other)? (a|an|one|1)? <type> you control to its owner's hand" clause.
    // No mixing with discard/sacrifice/remove-counters/tap-other/exile/pay-life/etc.
    // ========================================================================
    {
      const costStr = String(manaCost || '');
      const costLower = costStr.toLowerCase();

      if (costLower.includes('return') && costLower.includes("you control") && (costLower.includes("owner's hand") || costLower.includes("owner’s hand"))) {
        const returnMatch = costStr.match(
          /\breturn\s+(?:(another|other)\s+(creature|artifact|enchantment|land|permanent|nonland\s+permanent)|(a|an|one|1)\s+(creature|artifact|enchantment|land|permanent|nonland\s+permanent))\s+you\s+control\s+to\s+its\s+owner(?:'|’)s\s+hand\b/i
        );

        if (returnMatch) {
          // Optional supported additional clause: "Pay N life" (non-interactive).
          // IMPORTANT: do not actually pay life until the target-selection step resolves;
          // otherwise canceling the step would incorrectly charge life.
          let lifeToPayForCost: number | undefined;
          {
            const payLifeMatch = costStr.match(/\bpay\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/i);
            if (payLifeMatch) {
              const multiple = (costLower.match(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi) || []).length;
              if (multiple > 1 || /\bor\b/i.test(costStr)) {
                socket.emit('error', {
                  code: 'UNSUPPORTED_COST',
                  message: `Cannot activate ${cardName}: pay-life costs with choices ("or") are not supported yet.`,
                });
                return;
              }

              const raw = String(payLifeMatch[1] || '').trim();
              const n = parseWordNumber(raw, 1);
              if (!Number.isFinite(n) || n <= 0) {
                socket.emit('error', {
                  code: 'UNSUPPORTED_COST',
                  message: `Cannot activate ${cardName}: invalid life payment amount.`,
                });
                return;
              }

              const currentLife = Number((game.state as any)?.life?.[pid] ?? 40);
              if (!Number.isFinite(currentLife) || currentLife < n) {
                socket.emit('error', {
                  code: 'INSUFFICIENT_LIFE',
                  message: `Cannot activate ${cardName}: need to pay ${n} life, but you only have ${Number.isFinite(currentLife) ? currentLife : 0}.`,
                });
                return;
              }

              lifeToPayForCost = n;
            }
          }

          // Reject choice-based or mixed costs for now.
          if (/\bor\b/i.test(costStr)) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: return-to-hand costs with choices ("or") are not supported yet.`,
            });
            return;
          }

          const mustBeOther = Boolean(returnMatch[1]);
          const rawType = String(returnMatch[2] || returnMatch[4] || '').trim().toLowerCase();

          // Ensure there are no other non-mana cost components besides the return clause.
          const remainingNonManaCostText = costStr
            .replace(/\{[^}]+\}/g, ' ')
            .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
            .replace(
              /\breturn\s+(?:(?:another|other)\s+(?:creature|artifact|enchantment|land|permanent|nonland\s+permanent)|(?:a|an|one|1)\s+(?:creature|artifact|enchantment|land|permanent|nonland\s+permanent))\s+you\s+control\s+to\s+its\s+owner(?:'|’)s\s+hand\b/gi,
              ' '
            )
            .replace(/[\s,]+/g, ' ')
            .trim();

          if (remainingNonManaCostText.length > 0) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: return-to-hand cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
            });
            return;
          }

          const battlefieldNow = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
          const matchesType = (perm: any): boolean => {
            if (!perm) return false;
            if (String(perm.controller || '') !== String(pid)) return false;
            if (mustBeOther && String(perm.id) === String(permanentId)) return false;
            const tl = String(perm.card?.type_line || '').toLowerCase();
            if (rawType === 'permanent') return true;
            if (rawType === 'nonland permanent') return !tl.includes('land');
            return tl.includes(rawType);
          };

          const eligible = battlefieldNow.filter(matchesType);
          if (eligible.length < 1) {
            socket.emit('error', {
              code: 'INSUFFICIENT_TARGETS',
              message: `Cannot activate ${cardName}: you control no valid ${rawType} to return to hand for the cost.`,
            });
            return;
          }

          const validTargets = eligible.map((p: any) => ({
            id: String(p.id),
            label: String(p.card?.name || 'Permanent'),
            description: String(p.card?.type_line || rawType),
            imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
          }));

          const existing = ResolutionQueueManager
            .getStepsForPlayer(gameId, pid as any)
            .find(
              (s: any) =>
                s?.type === ResolutionStepType.TARGET_SELECTION &&
                (s as any)?.returnToHandAbilityAsCost === true &&
                String((s as any)?.permanentId || s?.sourceId) === String(permanentId)
            );

          if (!existing) {
            const activatedAbilityText = String(abilityConditionText || '').trim() || `${costStr}: ${abilityText}`;

            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.TARGET_SELECTION,
              playerId: pid as PlayerID,
              sourceId: permanentId,
              sourceName: cardName,
              sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
              description: `${cardName}: Return ${mustBeOther ? 'another ' : ''}${rawType} you control to its owner's hand to activate: ${abilityText}`,
              mandatory: false,
              validTargets,
              targetTypes: ['return_to_hand_cost'],
              minTargets: 1,
              maxTargets: 1,
              targetDescription: `${rawType} you control`,

              // Custom payload consumed by socket/resolution.ts
              returnToHandAbilityAsCost: true,
              permanentId,
              abilityId,
              cardName,
              abilityText,
              manaCost: costStr,
              requiresTap,
              returnType: rawType,
              mustBeOther,
              activatedAbilityText,
              lifeToPayForCost,
            } as any);
          }

          debug(2, `[activateBattlefieldAbility] ${cardName} requires returning ${mustBeOther ? 'another ' : ''}${rawType} you control to hand as a cost. Queued TARGET_SELECTION.`);
          broadcastGame(io, game, gameId);
          return;
        }
      }
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
        // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus "Blight X".
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

        // Store pending activation to resume after X selection + Blight target selection.
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
          activatedAbilityText: String(abilityConditionText || '').trim() || `${blightCostStr}: ${abilityText}`,
        };

        // Choose X (min 0, max 20 for UI sanity).
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.X_VALUE_SELECTION,
          playerId: pid as PlayerID,
          description: `${cardName}: Choose X for Blight X (cancel to abort activation).`,
          mandatory: false,
          sourceId: permanentId,
          sourceName: cardName,
          sourceImage: (card as any)?.image_uris?.small || (card as any)?.image_uris?.normal,

          minValue: 0,
          maxValue: 20,

          // Custom payload consumed by resolution.ts.
          keywordBlight: true,
          keywordBlightStage: 'ability_activation_cost_choose_x',
          keywordBlightController: pid,
          keywordBlightSourceName: `${cardName} — Blight X`,
          keywordBlightActivationId: activationId,
        } as any);

        debug(2, `[activateBattlefieldAbility] ${cardName} requires Blight X as activation cost; queued X_VALUE_SELECTION (activationId: ${activationId})`);
        broadcastGame(io, game, gameId);
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

      // Optional supported additional clause: "Pay N life" (non-interactive).
      // IMPORTANT: do not actually pay life until the sacrifice selection step resolves;
      // otherwise canceling the step would incorrectly charge life.
      const costStr = String(manaCost || '');
      const costLower = costStr.toLowerCase();
      let lifeToPayForCost: number | undefined;
      {
        const payLifeMatch = costStr.match(/\bpay\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/i);
        if (payLifeMatch) {
          const multiple = (costLower.match(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi) || []).length;
          if (multiple > 1 || /\bor\b/i.test(costStr)) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: pay-life costs with choices ("or") are not supported yet.`,
            });
            return;
          }

          const raw = String(payLifeMatch[1] || '').trim();
          const n = parseWordNumber(raw, 1);
          if (!Number.isFinite(n) || n <= 0) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: invalid life payment amount.`,
            });
            return;
          }

          const currentLife = Number((game.state as any)?.life?.[pid] ?? 40);
          if (!Number.isFinite(currentLife) || currentLife < n) {
            socket.emit('error', {
              code: 'INSUFFICIENT_LIFE',
              message: `Cannot activate ${cardName}: need to pay ${n} life, but you only have ${Number.isFinite(currentLife) ? currentLife : 0}.`,
            });
            return;
          }

          lifeToPayForCost = n;
        }
      }

      // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus the sacrifice clause
      // and optionally exactly one pay-life clause.
      // (Discard+sacrifice is handled by the dedicated flow below.)
      const remainingNonManaCostTextForSacOnly = costStr
        .replace(/\{[^}]+\}/g, ' ')
        .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
        .replace(/\bsacrifice\b[^,]*/gi, ' ')
        .replace(/\bdiscard\b[^,]*/gi, ' discard ')
        .replace(/[\s,]+/g, ' ')
        .trim();
      if (remainingNonManaCostTextForSacOnly.length > 0 && !/\bdiscard\b/i.test(remainingNonManaCostTextForSacOnly)) {
        socket.emit('error', {
          code: 'UNSUPPORTED_COST',
          message: `Cannot activate ${cardName}: sacrifice cost with additional non-mana components is not supported yet (${remainingNonManaCostTextForSacOnly}).`,
        });
        return;
      }

      // If the cost also requires a discard, prompt for discard first, then enqueue sacrifice.
      // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus exactly one
      // discard clause and exactly one sacrifice clause.
      // (costStr/costLower already computed above)

      if (costLower.includes('discard')) {
        const discardMatch = costLower.match(
          /\bdiscard\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\b/i
        );
        const discardTypedMatch = costLower.match(
          /\bdiscard\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+cards?\b/i
        );

        if (discardMatch || discardTypedMatch) {
          // Reject choice-based or mixed costs for now.
          if (/\bor\b/i.test(costStr)) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: discard + sacrifice costs with choices ("or") are not supported yet.`,
            });
            return;
          }

          // Ensure the cost contains no other non-mana cost components besides discard + sacrifice.
          const remainingNonManaCostText = costStr
            .replace(/\{[^}]+\}/g, ' ')
            .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
            .replace(
              /\bdiscard\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:(?:creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+)?cards?\b/gi,
              ' '
            )
            .replace(/\bsacrifice\b[^,]*/gi, ' ')
            .replace(/[\s,]+/g, ' ')
            .trim();
          if (remainingNonManaCostText.length > 0) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: discard + sacrifice cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
            });
            return;
          }

          const typedRestriction = discardTypedMatch ? String(discardTypedMatch[2] || '').trim().toLowerCase() : '';
          const rawDiscard = String((discardTypedMatch?.[1] || discardMatch?.[1]) || '').trim();
          const discardCount = parseWordNumber(rawDiscard, 1);
          if (!Number.isFinite(discardCount) || discardCount <= 0) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: invalid discard count.`,
            });
            return;
          }

          const zones = (game.state as any)?.zones?.[pid];
          const hand = zones?.hand;
          if (!zones || !Array.isArray(hand)) {
            socket.emit('error', { code: 'NO_HAND', message: 'No hand found for discard cost' });
            return;
          }

          const eligibleHand = (() => {
            if (!typedRestriction) return hand;
            return (hand as any[]).filter((c: any) => {
              const tl = String(c?.type_line || '').toLowerCase();
              switch (typedRestriction) {
                case 'creature':
                case 'artifact':
                case 'enchantment':
                case 'land':
                case 'instant':
                case 'sorcery':
                case 'planeswalker':
                  return tl.includes(typedRestriction);
                case 'nonland':
                  return !tl.includes('land');
                case 'noncreature':
                  return !tl.includes('creature');
                default:
                  return false;
              }
            });
          })();

          if (eligibleHand.length < discardCount) {
            socket.emit('error', {
              code: 'INSUFFICIENT_CARDS',
              message: typedRestriction
                ? `Need to discard ${discardCount} ${typedRestriction} card(s), but you only have ${eligibleHand.length}.`
                : `Need to discard ${discardCount} card(s), but you only have ${hand.length}.`,
            });
            return;
          }

          // Compute eligible permanents for sacrifice (same rules as sacrifice-only flow).
          const eligiblePermanents = battlefield.filter((p: any) => {
            if (p.controller !== pid) return false;
            if (mustBeOther && p.id === permanentId) return false;
            const permTypeLine = (p.card?.type_line || '').toLowerCase();
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
                matchesType = true;
                break;
              case 'artifact_or_creature':
                matchesType = permTypeLine.includes('artifact') || permTypeLine.includes('creature');
                break;
              default:
                matchesType = false;
            }
            if (!matchesType) return false;
            if (sacrificeSubtype) {
              const subtypeLower = sacrificeSubtype.toLowerCase();
              return permTypeLine.includes(subtypeLower);
            }
            return true;
          });

          let sacrificeLabel = sacrificeSubtype ? sacrificeSubtype : sacrificeType;
          let sacrificeLabelPlural = sacrificeLabel + 's';
          if (sacrificeType === 'artifact_or_creature') {
            sacrificeLabel = 'artifact or creature';
            sacrificeLabelPlural = 'artifacts and/or creatures';
          }

          if (eligiblePermanents.length < sacrificeCount) {
            socket.emit('error', {
              code: 'INSUFFICIENT_SACRIFICE_TARGETS',
              message: `You don't control enough ${sacrificeLabelPlural} to sacrifice. (Need ${sacrificeCount}, have ${eligiblePermanents.length})`,
            });
            return;
          }

          const existing = ResolutionQueueManager
            .getStepsForPlayer(gameId, pid as any)
            .find(
              (s: any) =>
                s?.type === ResolutionStepType.DISCARD_SELECTION &&
                (s as any)?.discardAbilityAsCost === true &&
                (s as any)?.discardAndSacrificeAbilityAsCost === true &&
                String((s as any)?.permanentId || s?.sourceId) === String(permanentId)
            );

          if (!existing) {
            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.DISCARD_SELECTION,
              playerId: pid as PlayerID,
              sourceId: permanentId,
              sourceName: cardName,
              description: `${cardName}: Discard ${discardCount} card${discardCount === 1 ? '' : 's'} to activate: ${abilityText}`,
              mandatory: false,
              hand: eligibleHand,
              discardCount,
              currentHandSize: eligibleHand.length,
              maxHandSize: Math.max(7, eligibleHand.length),
              reason: 'activation_cost',

              // Custom payload consumed by resolution.ts
              discardAbilityAsCost: true,
              discardAndSacrificeAbilityAsCost: true,
              permanentId,
              abilityId,
              cardName,
              abilityText,
              manaCost,
              requiresTap,
              discardTypeRestriction: typedRestriction || undefined,

              // Sacrifice continuation context
              sacrificeType,
              sacrificeSubtype,
              sacrificeCount,
              mustBeOther,

              // Optional deferred life payment (validated at activation time; paid after final step)
              lifeToPayForCost,
            } as any);
          }

          debug(2, `[activateBattlefieldAbility] ${cardName} requires discard + sacrifice as a cost. Queued DISCARD_SELECTION (will continue to sacrifice).`);
          broadcastGame(io, game, gameId);
          return;
        }
      }
      
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

      if (manaCost) {
        const manaSymbols = manaCost.match(/\{[WUBRGC0-9X\/P]+\}/gi);
        if (manaSymbols) {
          const manaOnly = manaSymbols
            .filter(symbol => symbol.toUpperCase() !== '{T}' && symbol.toUpperCase() !== '{Q}')
            .join('');

          if (manaOnly) {
            const parsedCost = parseManaCost(manaOnly);
            const manaPool = getOrInitManaPool(game.state, pid);
            const playerLife = game.state.life?.[pid] || 40;
            const phyrexianCosts = (parsedCost.hybrids || []).filter((options: string[]) =>
              options.some(option => option.startsWith('LIFE:'))
            );

            if (phyrexianCosts.length > 0) {
              const existingPhyrexianPrompt = ResolutionQueueManager
                .getStepsForPlayer(gameId, pid as any)
                .find((step: any) => step?.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step?.phyrexianManaChoice === true && String(step?.permanentId || step?.sourceId) === String(permanentId));

              if (!existingPhyrexianPrompt) {
                const activatedAbilityText = (() => {
                  const scopedAbilityText = String(abilityConditionText || '').trim();
                  if (scopedAbilityText.includes(':')) return scopedAbilityText;
                  return manaOnly ? `${manaOnly}: ${abilityText}` : (scopedAbilityText || abilityText);
                })();
                const phyrexianChoices = phyrexianCosts.map((options: string[], index: number) => {
                  const colorOption = options.find((option: string) => !option.startsWith('LIFE:') && !option.startsWith('GENERIC:'));
                  const lifeOption = options.find((option: string) => option.startsWith('LIFE:'));
                  const lifeAmount = lifeOption ? parseInt(lifeOption.split(':')[1], 10) : 2;
                  const colorMap: Record<string, string> = {
                    W: 'white',
                    U: 'blue',
                    B: 'black',
                    R: 'red',
                    G: 'green',
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

                ResolutionQueueManager.addStep(gameId, {
                  type: ResolutionStepType.MANA_PAYMENT_CHOICE,
                  playerId: pid as PlayerID,
                  sourceId: permanentId,
                  sourceName: cardName,
                  sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
                  description: `Choose how to pay Phyrexian mana for ${cardName}.`,
                  mandatory: true,
                  phyrexianManaChoice: true,
                  pendingId: `phyrexian_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                  permanentId,
                  abilityId,
                  cardName,
                  abilityText,
                  activatedAbilityText,
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
                  sacrificeCount,
                  mustBeOther,
                } as any);
              }

              debug(2, `[activateBattlefieldAbility] ${cardName} has Phyrexian mana in a sacrifice cost. Prompting ${pid} for payment choice before sacrifice selection.`);
              broadcastGame(io, game, gameId);
              return;
            }
          }
        }
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
        const activatedAbilityText = String(abilityConditionText || '').trim() || `${String(manaCost || '').trim()}: ${abilityText}`;
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
          abilityId,
          cardName,
          abilityText,
          manaCost,
          oracleText: (card?.oracle_text || oracleText || ''),
          requiresTap,
          activatedAbilityText,
          sacrificeType,
          sacrificeSubtype,
          sacrificeCount,
          mustBeOther,
          lifeToPayForCost,
        } as any);
      }

      debug(2, `[activateBattlefieldAbility] ${cardName} requires sacrifice of ${sacrificeCount} ${sacrificeLabel}(s). Queued TARGET_SELECTION.`);
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Track any permanents we tap as part of paying this activation's costs.
    // This is persisted into the activateBattlefieldAbility event for replay determinism.
    const tappedPermanentsForCost: string[] = [];

    // Track any permanents we sacrifice as part of paying this activation's costs.
    // Persisted into activateBattlefieldAbility for deterministic replay.
    const sacrificedPermanentsForCost: string[] = [];

    // Track life paid as part of paying this activation's costs.
    // Persisted into activateBattlefieldAbility for deterministic replay.
    let pendingLifePaymentForCost = 0;

    // Track any counters removed as part of paying this activation's costs.
    // Persisted into activateBattlefieldAbility for deterministic replay.
    const removedCountersForCost: Array<{ permanentId: string; counterType: string; count: number }> = [];

    // Defer applying counter removal until we're sure this activation completes.
    // (If we remove counters and later fail mana payment, we'd corrupt state.)
    const pendingCounterRemovals: Array<{ counterType: string; count: number }> = [];

    // ========================================================================
    // PAY LIFE AS AN ACTIVATION COST (generic)
    // Examples:
    // - "Pay 2 life: Draw a card."
    // - "{T}, Pay 1 life: Add {C}."
    // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus exactly one
    // "Pay N life" clause. No mixing with discard/sacrifice/remove-counters/tap-other/etc.
    // ========================================================================
    {
      const costStr = String(manaCost || '');
      const costLower = costStr.toLowerCase();

      if (costLower.includes('pay') && costLower.includes('life')) {
        const payLifeMatch = costStr.match(
          /\bpay\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/i
        );

        if (payLifeMatch) {
          // Reject choice-based or mixed costs for now.
          if (/\bor\b/i.test(costStr)) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: "pay life" costs with choices ("or") are not supported yet.`,
            });
            return;
          }

          // Ensure there are no other non-mana cost components besides the pay-life clause.
          // (We allow mana symbols inside braces and {T}/{Q}.)
          const remainingNonManaCostText = costStr
            .replace(/\{[^}]+\}/g, ' ')
            .replace(
              /\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi,
              ' '
            )
            .replace(/[\s,]+/g, ' ')
            .trim();

          let deferToSpecializedHandler = false;

          if (remainingNonManaCostText.length > 0) {
            // Mixed costs: allow other dedicated handlers to process supported combinations
            // like discard/exile-from-hand/tap-other + pay life, deferring life payment
            // until the relevant Resolution Queue step resolves.
            const remainingLower = remainingNonManaCostText.toLowerCase();
            const looksLikeSupportedTapOther = /\btap\s+(?:another\s+|other\s+)?(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+untapped\b/i.test(remainingLower) && /\byou\s+control\b/i.test(remainingLower);
            const looksLikeSupportedDiscard = /\bdiscard\b/i.test(remainingLower);
            const looksLikeSupportedExileFromHand = /\bexile\b/i.test(remainingLower) && /\bfrom\s+your\s+hand\b/i.test(remainingLower);
            const looksLikeSupportedExileFromGraveyard = /\bexile\b/i.test(remainingLower) && /\bfrom\s+your\s+graveyard\b/i.test(remainingLower);
            const looksLikeSupportedReturnToHand = /\breturn\b/i.test(remainingLower) && /\byou\s+control\b/i.test(remainingLower) && /\bowner(?:'|’)s\s+hand\b/i.test(remainingLower);
            const looksLikeSupportedSacrificeSelf = /\bsacrifice\s+(?:~|this)\b/i.test(remainingLower);

            if (looksLikeSupportedTapOther || looksLikeSupportedDiscard || looksLikeSupportedExileFromHand || looksLikeSupportedExileFromGraveyard || looksLikeSupportedReturnToHand || looksLikeSupportedSacrificeSelf) {
              // Defer entirely to the specialized cost handler.
              // IMPORTANT: do not pre-strip the pay-life clause from manaCost here;
              // the specialized handler needs to parse and carry it into the Resolution step.
              deferToSpecializedHandler = true;
            } else {
              socket.emit('error', {
                code: 'UNSUPPORTED_COST',
                message: `Cannot activate ${cardName}: pay-life cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
              });
              return;
            }
          }

          if (!deferToSpecializedHandler) {
            const raw = String(payLifeMatch[1] || '').trim();
            const lifeToPay = parseWordNumber(raw, 1);
            if (!Number.isFinite(lifeToPay) || lifeToPay <= 0) {
              socket.emit('error', {
                code: 'UNSUPPORTED_COST',
                message: `Cannot activate ${cardName}: invalid life payment amount.`,
              });
              return;
            }

            const currentLife = Number((game.state as any)?.life?.[pid] ?? 40);
            if (!Number.isFinite(currentLife) || currentLife < lifeToPay) {
              socket.emit('error', {
                code: 'INSUFFICIENT_LIFE',
                message: `Cannot activate ${cardName}: need to pay ${lifeToPay} life, but you only have ${Number.isFinite(currentLife) ? currentLife : 0}.`,
              });
              return;
            }

            pendingLifePaymentForCost = lifeToPay;

            // Strip this clause from manaCost so later mana-payment logic doesn't see non-mana text.
            try {
              manaCost = String(manaCost || '')
                .replace(
                  /\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi,
                  ' '
                )
                .replace(/^[\s,]+|[\s,]+$/g, '')
                .replace(/[\s,]+/g, ' ')
                .trim();
            } catch {
              // best-effort only
            }
          }
        }
      }
    }

    // ========================================================================
    // EXILE FROM YOUR GRAVEYARD AS AN ACTIVATION COST
    // Examples:
    // - "Exile a card from your graveyard: Draw a card."
    // - "Exile a creature card from your graveyard: ..."
    // - "{1}, Exile two cards from your graveyard: ..."
    // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus exactly one
    // "Exile N (optional <type>) card(s) from your graveyard" clause.
    // ========================================================================
    {
      const costStr = String(manaCost || '');
      const costLower = costStr.toLowerCase();

      if (costLower.includes('exile') && costLower.includes('from your graveyard')) {
        const exileMatch = costStr.match(
          /\bexile\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\s+from\s+your\s+graveyard\b/i
        );
        const exileTypedMatch = costStr.match(
          /\bexile\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+cards?\s+from\s+your\s+graveyard\b/i
        );

        if (exileMatch || exileTypedMatch) {
          const typedRestriction = exileTypedMatch ? String(exileTypedMatch[2] || '').trim().toLowerCase() : '';

          // Optional supported additional clause: "Pay N life" (non-interactive).
          // IMPORTANT: do not actually pay life until the graveyard selection step resolves;
          // otherwise canceling the step would incorrectly charge life.
          let lifeToPayForCost: number | undefined;
          {
            const payLifeMatch = costStr.match(/\bpay\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/i);
            if (payLifeMatch) {
              const multiple = (costLower.match(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi) || []).length;
              if (multiple > 1 || /\bor\b/i.test(costStr)) {
                socket.emit('error', {
                  code: 'UNSUPPORTED_COST',
                  message: `Cannot activate ${cardName}: pay-life costs with choices ("or") are not supported yet.`,
                });
                return;
              }

              const raw = String(payLifeMatch[1] || '').trim();
              const n = parseWordNumber(raw, 1);
              if (!Number.isFinite(n) || n <= 0) {
                socket.emit('error', {
                  code: 'UNSUPPORTED_COST',
                  message: `Cannot activate ${cardName}: invalid life payment amount.`,
                });
                return;
              }

              const currentLife = Number((game.state as any)?.life?.[pid] ?? 40);
              if (!Number.isFinite(currentLife) || currentLife < n) {
                socket.emit('error', {
                  code: 'INSUFFICIENT_LIFE',
                  message: `Cannot activate ${cardName}: need to pay ${n} life, but you only have ${Number.isFinite(currentLife) ? currentLife : 0}.`,
                });
                return;
              }

              lifeToPayForCost = n;
            }
          }
          // Reject choice-based or mixed costs for now.
          if (/\bor\b/i.test(costStr)) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: exile-from-graveyard costs with choices ("or") are not supported yet.`,
            });
            return;
          }

          // Ensure there are no other non-mana cost components besides the exile clause.
          const remainingNonManaCostText = costStr
            .replace(/\{[^}]+\}/g, ' ')
            .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
            .replace(
              /\bexile\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:(?:creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+)?cards?\s+from\s+your\s+graveyard\b/gi,
              ' '
            )
            .replace(/[\s,]+/g, ' ')
            .trim();

          if (remainingNonManaCostText.length > 0) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: exile-from-graveyard cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
            });
            return;
          }

          const raw = String((exileTypedMatch?.[1] || exileMatch?.[1]) || '').trim();
          const exileCount = parseWordNumber(raw, 1);
          if (!Number.isFinite(exileCount) || exileCount <= 0) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: invalid exile count.`,
            });
            return;
          }

          const zones = (game.state as any)?.zones?.[pid];
          const graveyard = zones?.graveyard;
          if (!zones || !Array.isArray(graveyard)) {
            socket.emit('error', { code: 'NO_GRAVEYARD', message: 'No graveyard found for exile cost' });
            return;
          }

          const eligibleGraveyard = (() => {
            if (!typedRestriction) return graveyard;
            return (graveyard as any[]).filter((c: any) => {
              const tl = String(c?.type_line || '').toLowerCase();
              switch (typedRestriction) {
                case 'creature':
                case 'artifact':
                case 'enchantment':
                case 'land':
                case 'instant':
                case 'sorcery':
                case 'planeswalker':
                  return tl.includes(typedRestriction);
                case 'nonland':
                  return !tl.includes('land');
                case 'noncreature':
                  return !tl.includes('creature');
                default:
                  return false;
              }
            });
          })();

          if (eligibleGraveyard.length < exileCount) {
            socket.emit('error', {
              code: 'INSUFFICIENT_CARDS',
              message: typedRestriction
                ? `Need to exile ${exileCount} ${typedRestriction} card(s) from your graveyard, but you only have ${eligibleGraveyard.length}.`
                : `Need to exile ${exileCount} card(s) from your graveyard, but you only have ${graveyard.length}.`,
            });
            return;
          }

          const validTargets = (eligibleGraveyard as any[]).map((c: any) => ({
            id: String(c?.id || ''),
            name: String(c?.name || 'Unknown'),
            typeLine: String(c?.type_line || ''),
            manaCost: String(c?.mana_cost || ''),
            imageUrl: (c as any)?.image_uris?.small || (c as any)?.image_uris?.normal,
          })).filter((t: any) => Boolean(t.id));

          if (validTargets.length < exileCount) {
            socket.emit('error', {
              code: 'INSUFFICIENT_CARDS',
              message: `Need to exile ${exileCount} card(s) from your graveyard, but there are only ${validTargets.length} selectable card(s).`,
            });
            return;
          }

          const existing = ResolutionQueueManager
            .getStepsForPlayer(gameId, pid as any)
            .find(
              (s: any) =>
                s?.type === ResolutionStepType.GRAVEYARD_SELECTION &&
                (s as any)?.graveyardExileAbilityAsCost === true &&
                String((s as any)?.permanentId || s?.sourceId) === String(permanentId)
            );

          if (!existing) {
            const effectId = `gy_exile_cost_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const activatedAbilityText = String(abilityConditionText || '').trim() || `${costStr}: ${abilityText}`;

            const typePhrase = typedRestriction ? `${typedRestriction} ` : '';
            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.GRAVEYARD_SELECTION,
              playerId: pid as PlayerID,
              sourceId: permanentId,
              sourceName: cardName,
              sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
              description: `${cardName}: Exile ${exileCount} ${typePhrase}card${exileCount === 1 ? '' : 's'} from your graveyard to activate: ${abilityText}`,
              mandatory: false,

              // Required GraveyardSelectionStep fields
              effectId,
              cardName,
              title: `${cardName} — Exile from graveyard` ,
              targetPlayerId: String(pid),
              minTargets: exileCount,
              maxTargets: exileCount,
              destination: 'exile',
              validTargets,
              imageUrl: card?.image_uris?.small || card?.image_uris?.normal,

              // Custom payload consumed by socket/resolution.ts
              graveyardExileAbilityAsCost: true,
              permanentId,
              abilityId,
              abilityText,
              manaCost: costStr,
              requiresTap,
              activatedAbilityText,
              exileCount,
              lifeToPayForCost,
            } as any);
          }

          debug(2, `[activateBattlefieldAbility] ${cardName} requires exiling ${exileCount} card(s) from graveyard as a cost. Queued GRAVEYARD_SELECTION.`);
          broadcastGame(io, game, gameId);
          return;
        }
      }
    }

    // ========================================================================
    // REMOVE COUNTERS AS AN ACTIVATION COST (source permanent only)
    // Examples:
    // - "Remove a +1/+1 counter from ~: ..."
    // - "Remove two charge counters from ~: ..."
    // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus exactly one
    // "Remove N <counterType> counter(s) from <this>" clause.
    // ========================================================================
    {
      const costStr = String(manaCost || '');
      const costLower = costStr.toLowerCase();

      // Avoid interfering with special-case storage-counter lands handled earlier.
      if (costLower.includes('storage counter')) {
        // no-op
      } else if (costLower.includes('remove') && costLower.includes('counter')) {
        const removeMatch = costStr.match(
          /\bremove\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+([^,]+?)\s+counters?\s+from\s+([^,]+)\b/i
        );

        if (removeMatch) {
          const rawCount = String(removeMatch[1] || '').trim();
          const rawTypePhrase = String(removeMatch[2] || '').trim();
          const rawSourceRef = String(removeMatch[3] || '').trim();

          const removeCount = parseWordNumber(rawCount, 1);
          if (removeCount <= 0) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: invalid counter removal count.`,
            });
            return;
          }

          // Only support removing from the source permanent (card name / this / it).
          const srcRefLower = rawSourceRef.toLowerCase();
          const nameLower = String(cardName || '').toLowerCase();
          const refersToSource =
            (nameLower && srcRefLower.includes(nameLower)) ||
            /\b(this|this permanent|it|source)\b/i.test(srcRefLower);
          if (!refersToSource) {
            // Support "Remove N <counter> counters from (another/other)? (permanent type) you control".
            if (!/\byou control\b/i.test(srcRefLower)) {
              socket.emit('error', {
                code: 'UNSUPPORTED_COST',
                message: `Cannot activate ${cardName}: removing counters from another permanent as an activation cost is not supported yet.`,
              });
              return;
            }

            const mustBeOther = /\b(another|other)\b/i.test(srcRefLower);
            const typeMatch = srcRefLower.match(/\b(creature|artifact|enchantment|land|permanent)\b/i);
            const removeFromType = String(typeMatch?.[1] || 'permanent').toLowerCase();

            // Normalize counter type.
            let counterType = rawTypePhrase;
            counterType = counterType.replace(/^\s*(?:a|an)\s+/i, '').trim();
            if (/\+\s*1\s*\/\s*\+\s*1/i.test(counterType)) counterType = '+1/+1';
            else if (/-\s*1\s*\/\s*-\s*1/i.test(counterType)) counterType = '-1/-1';
            else if (/^\d+\s*\/\s*\d+$/i.test(counterType)) {
              socket.emit('error', {
                code: 'UNSUPPORTED_COST',
                message: `Cannot activate ${cardName}: unsupported counter type (${counterType}).`,
              });
              return;
            } else {
              const first = counterType.split(/\s+/)[0];
              counterType = String(first || '').toLowerCase();
            }
            if (!counterType) {
              socket.emit('error', {
                code: 'UNSUPPORTED_COST',
                message: `Cannot activate ${cardName}: could not parse counter type.`,
              });
              return;
            }

            // Ensure no other non-mana cost components besides this remove-counters clause.
            const remainingNonManaCostText = costStr
              .replace(/\{[^}]+\}/g, ' ')
              .replace(/\bremove\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+[^,]+?\s+counters?\s+from\s+[^,]+\b/gi, ' ')
              .replace(/[\s,]+/g, ' ')
              .trim();
            if (remainingNonManaCostText.length > 0) {
              socket.emit('error', {
                code: 'UNSUPPORTED_COST',
                message: `Cannot activate ${cardName}: remove-counter cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
              });
              return;
            }

            const battlefield = (game.state?.battlefield || []) as any[];
            const matchesType = (perm: any): boolean => {
              if (!perm) return false;
              if (String(perm.controller || '') !== String(pid)) return false;
              if (mustBeOther && String(perm.id) === String(permanentId)) return false;
              const tl = String(perm.card?.type_line || '').toLowerCase();
              if (removeFromType === 'permanent') return true;
              return tl.includes(removeFromType);
            };

            const counterKeyCandidates = (() => {
              const ct = String(counterType);
              if (ct === '+1/+1') return ['+1/+1', 'p1p1', 'plus_one', 'plusone', 'plus1plus1', '+1+1'];
              if (ct === '-1/-1') return ['-1/-1', 'm1m1', 'minus_one', 'minusone', 'minus1minus1', '-1-1'];
              return [ct];
            })();

            const eligiblePermanents = battlefield.filter((p: any) => {
              if (!matchesType(p)) return false;
              const counters = (p as any).counters || {};
              const has = counterKeyCandidates.some((k) => Number(counters?.[k] || 0) >= removeCount);
              return has;
            });

            if (eligiblePermanents.length < 1) {
              socket.emit('error', {
                code: 'INSUFFICIENT_COUNTERS',
                message: `You don't control an eligible ${removeFromType} with at least ${removeCount} ${counterType} counter(s).`,
              });
              return;
            }

            const validTargets = eligiblePermanents.map((p: any) => ({
              id: p.id,
              label: p.card?.name || 'Unknown',
              description: p.card?.type_line || 'Permanent',
              imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
            }));

            const existing = ResolutionQueueManager
              .getStepsForPlayer(gameId, pid as any)
              .find(
                (s: any) =>
                  s?.type === ResolutionStepType.TARGET_SELECTION &&
                  (s as any)?.removeCountersAbilityAsCost === true &&
                  String((s as any)?.permanentId || s?.sourceId) === String(permanentId)
              );

            if (!existing) {
              const activatedAbilityText = String(abilityConditionText || '').trim() || `${costStr}: ${abilityText}`;
              ResolutionQueueManager.addStep(gameId, {
                type: ResolutionStepType.TARGET_SELECTION,
                playerId: pid as PlayerID,
                sourceId: permanentId,
                sourceName: cardName,
                sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
                description: `${cardName}: Remove ${removeCount} ${counterType} counter${removeCount === 1 ? '' : 's'} from a ${mustBeOther ? 'different ' : ''}${removeFromType} you control to activate: ${abilityText}`,
                mandatory: false,
                validTargets,
                targetTypes: ['remove_counter_cost'],
                minTargets: 1,
                maxTargets: 1,
                targetDescription: `${removeFromType} you control`,

                // Custom payload consumed by socket/resolution.ts
                removeCountersAbilityAsCost: true,
                permanentId,
                abilityId,
                cardName,
                abilityText,
                manaCost: costStr,
                requiresTap,
                activatedAbilityText,
                removeCount,
                counterType,
                counterKeyCandidates,
                removeFromType,
                mustBeOther,
              } as any);
            }

            debug(2, `[activateBattlefieldAbility] ${cardName} requires removing ${removeCount} ${counterType} counter(s) from a ${removeFromType} you control as a cost. Queued TARGET_SELECTION.`);
            broadcastGame(io, game, gameId);
            return;
          }

          // Normalize counter type.
          let counterType = rawTypePhrase;
          // Strip leading articles/words like "a" (if they made it into the type phrase).
          counterType = counterType.replace(/^\s*(?:a|an)\s+/i, '').trim();
          // Common explicit counter keys
          if (/\+\s*1\s*\/\s*\+\s*1/i.test(counterType)) counterType = '+1/+1';
          else if (/-\s*1\s*\/\s*-\s*1/i.test(counterType)) counterType = '-1/-1';
          else if (/^\d+\s*\/\s*\d+$/i.test(counterType)) {
            // "1/1" style should be treated as "+1/+1" or "-1/-1" only; reject.
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: unsupported counter type (${counterType}).`,
            });
            return;
          }
          else {
            // Use first word for named counters (charge, loyalty, time, etc.).
            const first = counterType.split(/\s+/)[0];
            counterType = String(first || '').toLowerCase();
          }

          if (!counterType) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: could not parse counter type.`,
            });
            return;
          }

          // Ensure no other non-mana cost components besides this remove-counters clause.
          const remainingNonManaCostText = costStr
            .replace(/\{[^}]+\}/g, ' ')
            .replace(/\bremove\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+[^,]+?\s+counters?\s+from\s+[^,]+\b/gi, ' ')
            .replace(/[\s,]+/g, ' ')
            .trim();
          if (remainingNonManaCostText.length > 0) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: remove-counter cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
            });
            return;
          }

          // Verify the source permanent still has enough counters.
          const currentCounters = (permanent as any).counters || {};
          const counterKeyCandidates = (() => {
            const ct = String(counterType);
            if (ct === '+1/+1') return ['+1/+1', 'p1p1', 'plus_one', 'plusone', 'plus1plus1', '+1+1'];
            if (ct === '-1/-1') return ['-1/-1', 'm1m1', 'minus_one', 'minusone', 'minus1minus1', '-1-1'];
            return [ct];
          })();
          const actualKey = counterKeyCandidates.find((k) => Number(currentCounters?.[k] || 0) >= removeCount);
          const currentN = actualKey ? Number(currentCounters?.[actualKey] || 0) : 0;
          if (!actualKey || currentN < removeCount) {
            socket.emit('error', {
              code: 'INSUFFICIENT_COUNTERS',
              message: `${cardName} doesn't have enough ${counterType} counter(s). (Need ${removeCount}, have ${currentN})`,
            });
            return;
          }

          pendingCounterRemovals.push({ counterType: actualKey, count: removeCount });

          // Strip this clause from manaCost so later mana-payment logic doesn't see non-mana text.
          // Keep any remaining mana symbols / tap symbols intact.
          try {
            manaCost = String(manaCost || '')
              .replace(
                /\bremove\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+[^,]+?\s+counters?\s+from\s+[^,]+\b/gi,
                ' '
              )
              .replace(/^[\s,]+|[\s,]+$/g, '')
              .replace(/[\s,]+/g, ' ')
              .trim();
          } catch {
            // best-effort only
          }
        }
      }
    }

    // ========================================================================
    // DISCARD AS AN ACTIVATION COST
    // Example: "Discard a card: Draw a card." (no other non-mana cost components supported yet)
    // ========================================================================
    // ========================================================================
    // EXILE FROM YOUR HAND AS AN ACTIVATION COST
    // Examples:
    // - "Exile a card from your hand: Draw a card."
    // - "Exile an instant card from your hand: ..."
    // - "{1}, Exile two cards from your hand: ..."
    // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus exactly one
    // "Exile N (optional <type>) card(s) from your hand" clause. No mixing with discard/sacrifice/remove-counters/tap-other/etc.
    // ========================================================================
    {
      const costStr = String(manaCost || '');
      const costLower = costStr.toLowerCase();

      if (costLower.includes('exile') && costLower.includes('from your hand')) {
        const exileMatch = costStr.match(
          /\bexile\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\s+from\s+your\s+hand\b/i
        );
        const exileTypedMatch = costStr.match(
          /\bexile\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+cards?\s+from\s+your\s+hand\b/i
        );

        if (exileMatch || exileTypedMatch) {
          const typedRestriction = exileTypedMatch ? String(exileTypedMatch[2] || '').trim().toLowerCase() : '';

          // Optional supported additional clause: "Pay N life" (non-interactive).
          // IMPORTANT: do not actually pay life until the discard/exile step resolves;
          // otherwise canceling the step would incorrectly charge life.
          let lifeToPayForCost: number | undefined;
          {
            const payLifeMatch = costStr.match(/\bpay\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/i);
            if (payLifeMatch) {
              const multiple = (costLower.match(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi) || []).length;
              if (multiple > 1 || /\bor\b/i.test(costStr)) {
                socket.emit('error', {
                  code: 'UNSUPPORTED_COST',
                  message: `Cannot activate ${cardName}: pay-life costs with choices ("or") are not supported yet.`,
                });
                return;
              }

              const raw = String(payLifeMatch[1] || '').trim();
              const n = parseWordNumber(raw, 1);
              if (!Number.isFinite(n) || n <= 0) {
                socket.emit('error', {
                  code: 'UNSUPPORTED_COST',
                  message: `Cannot activate ${cardName}: invalid life payment amount.`,
                });
                return;
              }

              const currentLife = Number((game.state as any)?.life?.[pid] ?? 40);
              if (!Number.isFinite(currentLife) || currentLife < n) {
                socket.emit('error', {
                  code: 'INSUFFICIENT_LIFE',
                  message: `Cannot activate ${cardName}: need to pay ${n} life, but you only have ${Number.isFinite(currentLife) ? currentLife : 0}.`,
                });
                return;
              }

              lifeToPayForCost = n;
            }
          }

          // Reject choice-based or mixed costs for now.
          if (/\bor\b/i.test(costStr)) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: exile-from-hand costs with choices ("or") are not supported yet.`,
            });
            return;
          }

          const remainingNonManaCostText = costStr
            .replace(/\{[^}]+\}/g, ' ')
            .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
            .replace(
              /\bexile\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:(?:creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+)?cards?\s+from\s+your\s+hand\b/gi,
              ' '
            )
            .replace(/[\s,]+/g, ' ')
            .trim();

          if (remainingNonManaCostText.length > 0) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: exile-from-hand cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
            });
            return;
          }

          const raw = String((exileTypedMatch?.[1] || exileMatch?.[1]) || '').trim();
          const exileCount = parseWordNumber(raw, 1);
          if (!Number.isFinite(exileCount) || exileCount <= 0) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: invalid exile count.`,
            });
            return;
          }

          const zones = (game.state as any)?.zones?.[pid];
          const hand = zones?.hand;
          if (!zones || !Array.isArray(hand)) {
            socket.emit('error', { code: 'NO_HAND', message: 'No hand found for exile cost' });
            return;
          }

          const eligibleHand = (() => {
            if (!typedRestriction) return hand;
            return (hand as any[]).filter((c: any) => {
              const tl = String(c?.type_line || '').toLowerCase();
              switch (typedRestriction) {
                case 'creature':
                case 'artifact':
                case 'enchantment':
                case 'land':
                case 'instant':
                case 'sorcery':
                case 'planeswalker':
                  return tl.includes(typedRestriction);
                case 'nonland':
                  return !tl.includes('land');
                case 'noncreature':
                  return !tl.includes('creature');
                default:
                  return false;
              }
            });
          })();

          if (eligibleHand.length < exileCount) {
            socket.emit('error', {
              code: 'INSUFFICIENT_CARDS',
              message: typedRestriction
                ? `Need to exile ${exileCount} ${typedRestriction} card(s) from your hand, but you only have ${eligibleHand.length}.`
                : `Need to exile ${exileCount} card(s) from your hand, but you only have ${hand.length}.`,
            });
            return;
          }

          const existing = ResolutionQueueManager
            .getStepsForPlayer(gameId, pid as any)
            .find((s: any) => s?.type === ResolutionStepType.DISCARD_SELECTION && (s as any)?.exileFromHandAbilityAsCost === true && String((s as any)?.permanentId || s?.sourceId) === String(permanentId));

          if (!existing) {
            const activatedAbilityText = String(abilityConditionText || '').trim() || `${costStr}: ${abilityText}`;

            const typePhrase = typedRestriction ? `${typedRestriction} ` : '';
            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.DISCARD_SELECTION,
              playerId: pid as PlayerID,
              sourceId: permanentId,
              sourceName: cardName,
              sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
              description: `${cardName}: Exile ${exileCount} ${typePhrase}card${exileCount === 1 ? '' : 's'} from your hand to activate: ${abilityText}`,
              mandatory: false,
              hand: eligibleHand,
              discardCount: exileCount,
              currentHandSize: eligibleHand.length,
              maxHandSize: Math.max(7, eligibleHand.length),
              reason: 'activation_cost',

              // Custom extensions consumed by resolution.ts
              destination: 'exile',
              exileFromHandAbilityAsCost: true,
              permanentId,
              abilityId,
              cardName,
              abilityText,
              manaCost: costStr,
              requiresTap,
              activatedAbilityText,
              exileCount,
              lifeToPayForCost,
            } as any);
          }

          debug(2, `[activateBattlefieldAbility] ${cardName} requires exiling ${exileCount} card(s) from hand as a cost. Queued DISCARD_SELECTION (destination=exile).`);
          broadcastGame(io, game, gameId);
          return;
        }
      }
    }

    {
      const costStr = String(manaCost || '');
      const costLower = costStr.toLowerCase();
      if (costLower.includes('discard')) {
        // Optional supported additional clause: "Pay N life" (non-interactive).
        // IMPORTANT: do not actually pay life until the discard step resolves;
        // otherwise canceling the step would incorrectly charge life.
        let lifeToPayForCost: number | undefined;
        {
          const payLifeMatch = costStr.match(/\bpay\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/i);
          if (payLifeMatch) {
            const multiple = (costLower.match(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi) || []).length;
            if (multiple > 1 || /\bor\b/i.test(costStr)) {
              socket.emit('error', {
                code: 'UNSUPPORTED_COST',
                message: `Cannot activate ${cardName}: pay-life costs with choices ("or") are not supported yet.`,
              });
              return;
            }

            const raw = String(payLifeMatch[1] || '').trim();
            const n = parseWordNumber(raw, 1);
            if (!Number.isFinite(n) || n <= 0) {
              socket.emit('error', {
                code: 'UNSUPPORTED_COST',
                message: `Cannot activate ${cardName}: invalid life payment amount.`,
              });
              return;
            }

            const currentLife = Number((game.state as any)?.life?.[pid] ?? 40);
            if (!Number.isFinite(currentLife) || currentLife < n) {
              socket.emit('error', {
                code: 'INSUFFICIENT_LIFE',
                message: `Cannot activate ${cardName}: need to pay ${n} life, but you only have ${Number.isFinite(currentLife) ? currentLife : 0}.`,
              });
              return;
            }

            lifeToPayForCost = n;
          }
        }

        // Conservative: support "discard N card(s)" and "discard N <type> card(s)" where <type> is a single keyword.
        // Examples:
        // - "Discard a card"
        // - "Discard a creature card"
        // - "Discard two land cards"
        const discardMatch = costLower.match(/\bdiscard\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\b/i);
        const discardTypedMatch = costLower.match(
          /\bdiscard\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+cards?\b/i
        );
        if (discardMatch || discardTypedMatch) {
          const typedRestriction = discardTypedMatch ? String(discardTypedMatch[2] || '').trim().toLowerCase() : '';

          // If this cost also includes a sacrifice clause, we don't yet support multi-step costs.
          if (costLower.includes('sacrifice')) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: discard + sacrifice as an activation cost is not supported yet.`,
            });
            return;
          }

          const raw = String((discardTypedMatch?.[1] || discardMatch?.[1]) || '').trim();
          const discardCount = parseWordNumber(raw, 1);

          // Ensure the cost contains no other non-mana cost components besides the discard clause.
          const remainingNonManaCostText = costStr
            .replace(/\{[^}]+\}/g, ' ')
            .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
            .replace(
              /\bdiscard\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:(?:creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+)?cards?\b/gi,
              ' '
            )
            .replace(/[\s,]+/g, ' ')
            .trim();
          if (remainingNonManaCostText.length > 0) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: discard cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
            });
            return;
          }

          const zones = (game.state as any)?.zones?.[pid];
          const hand = zones?.hand;
          if (!zones || !Array.isArray(hand)) {
            socket.emit('error', { code: 'NO_HAND', message: 'No hand found for discard cost' });
            return;
          }

          const eligibleHand = (() => {
            if (!typedRestriction) return hand;
            return (hand as any[]).filter((c: any) => {
              const tl = String(c?.type_line || '').toLowerCase();
              switch (typedRestriction) {
                case 'creature':
                case 'artifact':
                case 'enchantment':
                case 'land':
                case 'instant':
                case 'sorcery':
                case 'planeswalker':
                  return tl.includes(typedRestriction);
                case 'nonland':
                  return !tl.includes('land');
                case 'noncreature':
                  return !tl.includes('creature');
                default:
                  return false;
              }
            });
          })();

          if (eligibleHand.length < discardCount) {
            socket.emit('error', {
              code: 'INSUFFICIENT_CARDS',
              message: typedRestriction
                ? `Need to discard ${discardCount} ${typedRestriction} card(s), but you only have ${eligibleHand.length}.`
                : `Need to discard ${discardCount} card(s), but you only have ${hand.length}.`,
            });
            return;
          }

          const existing = ResolutionQueueManager
            .getStepsForPlayer(gameId, pid as any)
            .find((s: any) => s?.type === ResolutionStepType.DISCARD_SELECTION && (s as any)?.discardAbilityAsCost === true && String((s as any)?.permanentId || s?.sourceId) === String(permanentId));

          if (!existing) {
            const activatedAbilityText = String(abilityConditionText || '').trim() || `${String(manaCost || '').trim()}: ${abilityText}`;
            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.DISCARD_SELECTION,
              playerId: pid as PlayerID,
              sourceId: permanentId,
              sourceName: cardName,
              description: `${cardName}: Discard ${discardCount} card${discardCount === 1 ? '' : 's'} to activate: ${abilityText}`,
              mandatory: false,
              hand: eligibleHand,
              discardCount,
              currentHandSize: eligibleHand.length,
              maxHandSize: Math.max(7, eligibleHand.length),
              reason: 'activation_cost',

              // Custom payload consumed by resolution.ts
              discardAbilityAsCost: true,
              permanentId,
              abilityId,
              cardName,
              abilityText,
              manaCost,
              requiresTap,
              activatedAbilityText,
              discardTypeRestriction: typedRestriction || undefined,
              lifeToPayForCost,
            } as any);
          }

          debug(2, `[activateBattlefieldAbility] ${cardName} requires discarding ${discardCount} card(s) as a cost. Queued DISCARD_SELECTION.`);
          broadcastGame(io, game, gameId);
          return;
        }
      }
    }

    const resolvedAbilityText = applyXValueToText(abilityText, selectedXValue);
    const resolvedActivatedAbilityText = applyXValueToText(
      String(abilityConditionText || '').trim() || (manaCost ? `${manaCost}: ${abilityText}` : abilityText),
      selectedXValue
    );

    const shouldPromptForActivationPaymentChoice = (resolvedManaCost: string): boolean => {
      const parsed = parseManaCost(String(resolvedManaCost || ''));
      const hasColoredRequirement = Object.values(parsed.colors || {}).some((amount) => Number(amount || 0) > 0);
      const genericRequirement = Number(parsed.generic || 0);

      if (!hasColoredRequirement && genericRequirement <= 0) {
        return false;
      }

      const manaPool = getOrInitManaPool(game.state, pid);
      const totalAvailable = calculateTotalAvailableMana(manaPool, undefined);
      const validationError = validateManaPayment(totalAvailable, parsed.colors, genericRequirement);
      if (validationError) {
        return true;
      }

      const nonZeroPoolKeys = ['white', 'blue', 'black', 'red', 'green', 'colorless'].filter(
        (poolKey) => Number((manaPool as any)?.[poolKey] || 0) > 0,
      );

      return nonZeroPoolKeys.length > 1;
    };

    const maybeAutoTapForSimpleNonHybridCost = (required: { colors: Record<string, number>; generic: number }): void => {
      const manaPool = getOrInitManaPool(game.state, pid);
      const requiredColors: Record<string, number> = required?.colors || {};
      const requiredGeneric = Math.max(0, Number(required?.generic || 0));

      const colorKeyBySymbol: Record<string, keyof typeof manaPool> = {
        W: 'white',
        U: 'blue',
        B: 'black',
        R: 'red',
        G: 'green',
        C: 'colorless',
      } as any;

      const poolColor = (sym: string) => {
        const k = colorKeyBySymbol[String(sym || '').toUpperCase()];
        return k ? Number((manaPool as any)[k] || 0) : 0;
      };

      // Remaining colored requirements after considering currently-floated mana.
      const remainingColors: Record<string, number> = {};
      for (const [sym, needRaw] of Object.entries(requiredColors)) {
        const need = Math.max(0, Number(needRaw || 0));
        if (need <= 0) continue;
        const have = poolColor(sym);
        const rem = Math.max(0, need - have);
        if (rem > 0) remainingColors[String(sym).toUpperCase()] = rem;
      }

      const totalPool = () =>
        (manaPool.white || 0) + (manaPool.blue || 0) + (manaPool.black || 0) +
        (manaPool.red || 0) + (manaPool.green || 0) + (manaPool.colorless || 0);

      let remainingGeneric = Math.max(0, requiredGeneric - totalPool());

      const battlefield = (game.state.battlefield || []) as any[];
      const candidates: Array<{ perm: any; prod: any; amount: number }>
        = [];

      for (const perm of battlefield) {
        if (!perm || String(perm.controller) !== String(pid)) continue;
        if ((perm as any).tapped) continue;
        const c = perm.card;
        if (!c) continue;

        const typeLine = String(c.type_line || '').toLowerCase();
        const isCreature = typeLine.includes('creature');
        const isLand = typeLine.includes('land');
        if (isCreature && !isLand && (perm as any).summoningSickness) {
          const hasHaste = creatureHasHaste(perm, battlefield, pid);
          if (!hasHaste) continue;
        }

        const oracleText = String(c.oracle_text || '').toLowerCase();
        // Only auto-tap VERY simple mana sources: "{T}: Add ..." (no extra costs like "{1}, {T}" or "{T}, Sacrifice")
        if (!/\{t\}\s*:\s*add\b/i.test(oracleText)) continue;
        if (/\{t\}\s*,/i.test(oracleText)) continue;
        if (oracleText.includes('sacrifice')) continue;
        if (oracleText.includes('pay ')) continue;

        const prod = calculateManaProduction(game.state, perm, pid);
        const amt = Number(prod?.totalAmount || 0);
        if (!Number.isFinite(amt) || amt <= 0) continue;

        candidates.push({ perm, prod, amount: amt });
      }

      const chooseColorForProd = (prodColors: string[]): string => {
        const colors = Array.isArray(prodColors) ? prodColors.map(c => String(c).toUpperCase()) : [];
        // Prioritize a missing required color.
        for (const sym of Object.keys(remainingColors)) {
          if ((remainingColors[sym] || 0) > 0 && colors.includes(sym)) return sym;
        }
        // Otherwise, if it produces exactly one fixed color, use it.
        if (colors.length === 1) return colors[0];
        // Otherwise prefer colorless, else default to W.
        if (colors.includes('C')) return 'C';
        return 'W';
      };

      const tapAndAdd = (perm: any, prod: any, chosenSym: string, amount: number) => {
        (perm as any).tapped = true;
        tappedPermanentsForCost.push(String((perm as any).id));

        const sym = String(chosenSym || '').toUpperCase();
        const key = colorKeyBySymbol[sym] || 'colorless';
        (manaPool as any)[key] = Number((manaPool as any)[key] || 0) + Math.max(1, amount);
      };

      // 1) Cover colored requirements first.
      while (Object.values(remainingColors).some((n: any) => Number(n || 0) > 0)) {
        let bestIdx = -1;
        let bestScore = -1;
        let bestColor = 'C';

        for (let i = 0; i < candidates.length; i++) {
          const cand = candidates[i];
          const colors = Array.isArray(cand.prod?.colors) ? cand.prod.colors.map((x: any) => String(x).toUpperCase()) : [];
          const color = chooseColorForProd(colors);
          if (!remainingColors[color]) continue;

          // Prefer sources that produce exactly 1 (avoid leftover) and match required color.
          const amount = Number(cand.amount || 0);
          const score = (amount === 1 ? 1000 : 0) + Math.min(10, amount);
          if (score > bestScore) {
            bestScore = score;
            bestIdx = i;
            bestColor = color;
          }
        }

        if (bestIdx === -1) break;
        const chosen = candidates.splice(bestIdx, 1)[0];
        try {
          const amount = Number(chosen.amount || 1);
          tapAndAdd(chosen.perm, chosen.prod, bestColor, Math.min(amount, remainingColors[bestColor] || 1));
          remainingColors[bestColor] = Math.max(0, (remainingColors[bestColor] || 0) - 1);
        } catch {
          // best-effort only
        }
      }

      // 2) Cover generic requirement with remaining sources (prefer 1-mana producers to avoid leftover).
      remainingGeneric = Math.max(0, requiredGeneric - totalPool());
      candidates.sort((a, b) => {
        const aAmt = Number(a.amount || 0);
        const bAmt = Number(b.amount || 0);
        const aPref = aAmt === 1 ? 0 : 1;
        const bPref = bAmt === 1 ? 0 : 1;
        if (aPref !== bPref) return aPref - bPref;
        return aAmt - bAmt;
      });

      for (const cand of candidates) {
        if (remainingGeneric <= 0) break;
        try {
          const colors = Array.isArray(cand.prod?.colors) ? cand.prod.colors.map((x: any) => String(x).toUpperCase()) : [];
          const chosenColor = chooseColorForProd(colors);
          tapAndAdd(cand.perm, cand.prod, chosenColor, 1);
          remainingGeneric -= 1;
        } catch {
          // best-effort only
        }
      }
    };

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
          const xSymbolCount = (manaOnly.match(/\{X\}/gi) || []).length;
          if (xSymbolCount > 0 && selectedXValue === undefined) {
            socket.emit('error', {
              code: 'X_VALUE_REQUIRED',
              message: `Choose a value for X before activating ${cardName}.`,
            });
            return;
          }

          const resolvedManaOnly = xSymbolCount > 0
            ? applyXValueToText(manaOnly, selectedXValue)
            : manaOnly;

          const parsedCost = parseManaCost(resolvedManaOnly);
          const manaPool = getOrInitManaPool(game.state, pid);
          const wouldBeManaAbility = /add\s+(\{[wubrgc]\}(?:\s+or\s+\{[wubrgc]\})?|\{[wubrgc]\}\{[wubrgc]\}|one mana|two mana|three mana|mana of any|any color|[xX] mana|an amount of|mana in any combination)/i.test(abilityText) &&
            !/target/i.test(abilityText);
          
          // For Phyrexian mana costs, we need to check if player can pay with mana OR life
          const playerLife = game.state.life?.[pid] || 40;
          
          // Adapt parsedCost for canPayManaCost (uses 'hybrid' instead of 'hybrids')
          const costForCheck = {
            colors: parsedCost.colors,
            generic: parsedCost.generic,
            hasX: parsedCost.hasX,
            hybrid: parsedCost.hybrids, // Map hybrids to hybrid for compatibility
          };
          
          // Check if we can pay the cost, including mana that could be produced by untapped sources.
          // (Activated abilities allow activating mana abilities during cost payment.)
          // Check if there are Phyrexian mana costs that require a player choice
          // Phyrexian mana can ALWAYS be paid with life (2 life per {X/P}), even if the player has the color
          const phyrexianCosts = (parsedCost.hybrids || []).filter((options: string[]) => 
            options.some(o => o.startsWith('LIFE:'))
          );
          
          if (phyrexianCosts.length > 0) {
            const pendingPhyrexianId = `phyrexian_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const activatedAbilityText = (() => {
              const scopedAbilityText = String(abilityConditionText || '').trim();
              if (scopedAbilityText.includes(':')) return scopedAbilityText;
              return manaOnly ? `${manaOnly}: ${abilityText}` : (scopedAbilityText || abilityText);
            })();
            
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
              abilityId,
              cardName,
              abilityText,
              activatedAbilityText,
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
              sacrificeCount,
              mustBeOther,
            } as any);
            
            debug(2, `[activateBattlefieldAbility] ${cardName} has Phyrexian mana costs. Prompting ${pid} for payment choice.`);
            return; // Wait for player's choice
          }

          if (
            wouldBeManaAbility &&
            (!parsedCost.hybrids || parsedCost.hybrids.length === 0) &&
            !sacrificeType &&
            shouldPromptForActivationPaymentChoice(resolvedManaOnly)
          ) {
            const activatedAbilityText = (() => {
              const scopedAbilityText = String(abilityConditionText || '').trim();
              if (scopedAbilityText.includes(':')) return scopedAbilityText;
              return manaOnly ? `${manaOnly}: ${abilityText}` : (scopedAbilityText || abilityText);
            })();

            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.MANA_PAYMENT_CHOICE,
              playerId: pid as PlayerID,
              sourceId: permanentId,
              sourceName: cardName,
              sourceImage: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
              description: `Choose how to pay ${resolvedManaOnly} for ${cardName}.`,
              mandatory: true,
              activationPaymentChoice: true,
              activationPaymentContext: 'mana_ability',
              confirmLabel: 'Pay and Activate',
              permanentId,
              abilityId,
              cardName,
              abilityText,
              activatedAbilityText,
              manaCost: resolvedManaOnly,
              requiresTap,
            } as any);

            if (typeof game.bumpSeq === 'function') {
              game.bumpSeq();
            }
            broadcastGame(io, game, gameId);
            return;
          }

          if (
            !wouldBeManaAbility &&
            (!parsedCost.hybrids || parsedCost.hybrids.length === 0) &&
            !sacrificeType &&
            /each player draws?/i.test(String(abilityText || '')) &&
            shouldPromptForActivationPaymentChoice(resolvedManaOnly)
          ) {
            const activatedAbilityText = (() => {
              const scopedAbilityText = String(abilityConditionText || '').trim();
              if (scopedAbilityText.includes(':')) return scopedAbilityText;
              return manaOnly ? `${manaOnly}: ${abilityText}` : (scopedAbilityText || abilityText);
            })();

            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.MANA_PAYMENT_CHOICE,
              playerId: pid as PlayerID,
              sourceId: permanentId,
              sourceName: cardName,
              sourceImage: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
              description: `Choose how to pay ${resolvedManaOnly} for ${cardName}.`,
              mandatory: true,
              activationPaymentChoice: true,
              activationPaymentContext: 'battlefield_group_draw',
              confirmLabel: 'Pay and Activate',
              permanentId,
              abilityId,
              cardName,
              abilityText,
              activatedAbilityText,
              manaCost: resolvedManaOnly,
              requiresTap,
              xValue: selectedXValue,
            } as any);

            if (typeof game.bumpSeq === 'function') {
              game.bumpSeq();
            }
            broadcastGame(io, game, gameId);
            return;
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
                  message: `Cannot pay ${resolvedManaOnly} - insufficient mana`,
                });
                return;
              }
            }
            
            // Consume the mana
            consumeManaFromPool(manaPool, manaToConsume.colors, manaToConsume.generic);
          } else {
            // Non-hybrid mana costs (including mixed colored+generic like {W}{1}).
            // Attempt to auto-tap simple mana sources when the player has mana available on the field.
            const totalAvailableBefore = calculateTotalAvailableMana(manaPool, undefined);
            let validationError = validateManaPayment(totalAvailableBefore, parsedCost.colors, parsedCost.generic);
            if (validationError) {
              maybeAutoTapForSimpleNonHybridCost({ colors: parsedCost.colors, generic: parsedCost.generic });
              const totalAvailableAfter = calculateTotalAvailableMana(manaPool, undefined);
              validationError = validateManaPayment(totalAvailableAfter, parsedCost.colors, parsedCost.generic);
            }

            if (validationError) {
              socket.emit('error', {
                code: 'INSUFFICIENT_MANA',
                message: `Cannot pay ${resolvedManaOnly}: ${validationError}`,
              });
              return;
            }

            consumeManaFromPool(manaPool, parsedCost.colors, parsedCost.generic);
          }
          
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `${getPlayerName(game, pid)} paid ${resolvedManaOnly} to activate ${cardName}.`,
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

      // Pay tap cost only after all other costs validate and any interactive prompts
      // (e.g., Phyrexian/hybrid payment choice) have been handled.
      if (requiresTap && !(permanent as any).tapped) {
        (permanent as any).tapped = true;
        tappedPermanentsForCost.push(String(permanentId));
      }

      // Sacrifice the source as part of the activation cost (e.g., "Sacrifice this artifact").
      // Conservative: only support self-sacrifice costs that don't include additional non-mana components.
      if (sacrificeType === 'self') {
        const costStr = String(manaCost || '');

        // Optional supported additional clause: "Pay N life" (non-interactive).
        // Use the deferred payment slot so we only pay life after the activation successfully completes.
        // (This avoids charging life if later validation fails.)
        {
          const costLower = costStr.toLowerCase();
          const payLifeMatch = costStr.match(/\bpay\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/i);
          if (payLifeMatch) {
            const multiple = (costLower.match(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi) || []).length;
            if (multiple > 1 || /\bor\b/i.test(costStr)) {
              socket.emit('error', {
                code: 'UNSUPPORTED_COST',
                message: `Cannot activate ${cardName}: pay-life costs with choices ("or") are not supported yet.`,
              });
              return;
            }

            const raw = String(payLifeMatch[1] || '').trim();
            const n = parseWordNumber(raw, 1);
            if (!Number.isFinite(n) || n <= 0) {
              socket.emit('error', {
                code: 'UNSUPPORTED_COST',
                message: `Cannot activate ${cardName}: invalid life payment amount.`,
              });
              return;
            }

            const currentLife = Number((game.state as any)?.life?.[pid] ?? 40);
            if (!Number.isFinite(currentLife) || currentLife < n) {
              socket.emit('error', {
                code: 'INSUFFICIENT_LIFE',
                message: `Cannot activate ${cardName}: need to pay ${n} life, but you only have ${Number.isFinite(currentLife) ? currentLife : 0}.`,
              });
              return;
            }

            pendingLifePaymentForCost = n;
          }
        }

        const remainingNonManaCostText = costStr
          .replace(/\{[^}]+\}/g, ' ')
          .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
          // Strip "Sacrifice ~" and "Sacrifice this ..." clauses.
          .replace(/\bsacrifice\s+(?:~|this)\b[^,]*/gi, ' ')
          .replace(/[\s,]+/g, ' ')
          .trim();

        if (remainingNonManaCostText.length > 0) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: sacrifice-self cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
          });
          return;
        }

        try {
          const ctx = {
            state: game.state,
            libraries: (game as any).libraries,
            bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
            rng: (game as any).rng,
            gameId,
          } as any;
          const { movePermanentToGraveyard } = await import('../state/modules/counters_tokens.js');
          const moved = movePermanentToGraveyard(ctx, String(permanentId), true);
          if (!moved) {
            socket.emit('error', {
              code: 'PERMANENT_NOT_FOUND',
              message: 'Permanent no longer on battlefield',
            });
            return;
          }
          sacrificedPermanentsForCost.push(String(permanentId));
        } catch {
          socket.emit('error', {
            code: 'SACRIFICE_FAILED',
            message: `Failed to sacrifice ${cardName} as part of the activation cost.`,
          });
          return;
        }
      }

      // Check if this is a tutor effect (searches library)
      const tutorInfo = detectTutorEffect(abilityText);

      const activatedAbilityTextForStack = resolvedActivatedAbilityText;

      if (isBoastAbility) {
        (permanent as any).activatedThisTurn = true;
      }
      
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
          description: resolvedAbilityText,
          activatedAbilityText: activatedAbilityTextForStack,
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
        description: resolvedAbilityText,
        activatedAbilityText: activatedAbilityTextForStack,
        xValue: selectedXValue,
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
        message: `⚡ ${getPlayerName(game, pid)} activated ${cardName}'s ability: ${resolvedAbilityText}`,
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

      // Tap as part of the cost for mana abilities.
      if (requiresTap && !(permanent as any).tapped) {
        (permanent as any).tapped = true;
        tappedPermanentsForCost.push(String(permanentId));
      }

      // Sacrifice the source as part of the activation cost for mana abilities
      // (e.g., "{T}, Sacrifice this artifact: Add one mana of any color").
      if (sacrificeType === 'self') {
        const costStr = String(manaCost || '');

        // Optional supported additional clause: "Pay N life" (non-interactive).
        // Use the deferred payment slot so we only pay life after the activation successfully completes.
        {
          const costLower = costStr.toLowerCase();
          const payLifeMatch = costStr.match(/\bpay\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/i);
          if (payLifeMatch) {
            const multiple = (costLower.match(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi) || []).length;
            if (multiple > 1 || /\bor\b/i.test(costStr)) {
              socket.emit('error', {
                code: 'UNSUPPORTED_COST',
                message: `Cannot activate ${cardName}: pay-life costs with choices ("or") are not supported yet.`,
              });
              return;
            }

            const raw = String(payLifeMatch[1] || '').trim();
            const n = parseWordNumber(raw, 1);
            if (!Number.isFinite(n) || n <= 0) {
              socket.emit('error', {
                code: 'UNSUPPORTED_COST',
                message: `Cannot activate ${cardName}: invalid life payment amount.`,
              });
              return;
            }

            const currentLife = Number((game.state as any)?.life?.[pid] ?? 40);
            if (!Number.isFinite(currentLife) || currentLife < n) {
              socket.emit('error', {
                code: 'INSUFFICIENT_LIFE',
                message: `Cannot activate ${cardName}: need to pay ${n} life, but you only have ${Number.isFinite(currentLife) ? currentLife : 0}.`,
              });
              return;
            }

            pendingLifePaymentForCost = n;
          }
        }

        const remainingNonManaCostText = costStr
          .replace(/\{[^}]+\}/g, ' ')
          .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
          .replace(/\bsacrifice\s+(?:~|this)\b[^,]*/gi, ' ')
          .replace(/[\s,]+/g, ' ')
          .trim();

        if (remainingNonManaCostText.length > 0) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: sacrifice-self cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
          });
          return;
        }

        try {
          const ctx = {
            state: game.state,
            libraries: (game as any).libraries,
            bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
            rng: (game as any).rng,
            gameId,
          } as any;
          const { movePermanentToGraveyard } = await import('../state/modules/counters_tokens.js');
          const moved = movePermanentToGraveyard(ctx, String(permanentId), true);
          if (!moved) {
            socket.emit('error', {
              code: 'PERMANENT_NOT_FOUND',
              message: 'Permanent no longer on battlefield',
            });
            return;
          }
          sacrificedPermanentsForCost.push(String(permanentId));
        } catch {
          socket.emit('error', {
            code: 'SACRIFICE_FAILED',
            message: `Failed to sacrifice ${cardName} as part of the activation cost.`,
          });
          return;
        }
      }
      
      // Initialize mana pool if needed
      game.state.manaPool = game.state.manaPool || {};
      game.state.manaPool[pid] = game.state.manaPool[pid] || {
        white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
      };

      // Fire triggers that care about ability activation.
      // Many will be filtered out by intervening-if ("if it isn't a mana ability").
      try {
        const triggeredAbilities = triggerAbilityActivatedTriggers(game as any, {
          activatedBy: pid as any,
          sourcePermanentId: permanentId as any,
          isManaAbility: true,
          abilityText,
        });
        persistAbilityActivatedTriggerPushes(gameId, game, triggeredAbilities);
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
      else if (creatureCountMana && (creatureCountMana.amount > 0 || (creatureCountMana as any).requiresColorChoice === true)) {
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
            allowedColors: ['W', 'U', 'B', 'R', 'G'],
            dynamicAmountSource: (creatureCountMana as any).dynamicAmountSource,
            manaMultiplier: effectiveMultiplier,
            // Activation-cost evidence (for deterministic replay) and deferred costs
            lifeToPayForCost: pendingLifePaymentForCost || undefined,
            tappedPermanentsForCost: tappedPermanentsForCost,
            sacrificedPermanentsForCost: sacrificedPermanentsForCost,
          } as any);
          
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: (creatureCountMana as any).dynamicAmountSource === 'devotion'
              ? `${getPlayerName(game, pid)} activated ${cardName} and must choose a color for devotion mana.`
              : `${getPlayerName(game, pid)} tapped ${cardName} for ${totalAmount} mana (choose colors).`,
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
                // Activation-cost evidence (for deterministic replay) and deferred costs
                lifeToPayForCost: pendingLifePaymentForCost || undefined,
                tappedPermanentsForCost: tappedPermanentsForCost,
                sacrificedPermanentsForCost: sacrificedPermanentsForCost,
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

    // Apply any deferred counter removals for activation costs now that we know the activation completed.
    // This ensures we don't remove counters if the activation later fails due to mana payment, etc.
    if (pendingCounterRemovals.length > 0) {
      for (const entry of pendingCounterRemovals) {
        const counterType = String(entry?.counterType || '').trim();
        const count = Number(entry?.count || 0);
        if (!counterType || !Number.isFinite(count) || count <= 0) continue;

        try {
          const ctx = {
            state: game.state,
            libraries: (game as any).libraries,
            bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
            rng: (game as any).rng,
            gameId,
          } as any;
          const { updateCounters } = await import('../state/modules/counters_tokens.js');
          updateCounters(ctx, String(permanentId), { [counterType]: -count });
        } catch {
          // best-effort direct mutation fallback
          (permanent as any).counters = (permanent as any).counters || {};
          const next = Math.max(0, Number((permanent as any).counters[counterType] || 0) - count);
          if (next > 0) (permanent as any).counters[counterType] = next;
          else delete (permanent as any).counters[counterType];
        }

        removedCountersForCost.push({ permanentId: String(permanentId), counterType, count });
      }
    }

    // Apply any deferred life payment for activation costs now that we know the activation completed.
    // This ensures we don't pay life if the activation later fails due to mana payment, etc.
    if (pendingLifePaymentForCost > 0) {
      try {
        (game.state as any).life = (game.state as any).life || {};
        const cur = Number((game.state as any).life?.[pid] ?? 40);
        (game.state as any).life[pid] = Math.max(0, cur - Number(pendingLifePaymentForCost || 0));
      } catch {
        // best-effort only
      }
    }

    const activatedAbilityText = resolvedActivatedAbilityText;
    
    appendEvent(gameId, (game as any).seq ?? 0, "activateBattlefieldAbility", { 
      playerId: pid, 
      permanentId, 
      abilityId,
      cardName,
      abilityText: resolvedAbilityText,
      activatedAbilityText,
      xValue: selectedXValue,
      tappedPermanents: tappedPermanentsForCost,
      sacrificedPermanents: sacrificedPermanentsForCost,
      removedCountersForCost,
      lifePaidForCost: pendingLifePaymentForCost,
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
  socket.on(
    "setReplacementEffectOrder",
    (payload?: {
      gameId?: unknown;
      effectType?: unknown;
      useCustomOrder?: unknown;
      customOrder?: unknown;
      mode?: unknown;
    }) => {
    const gameId = payload?.gameId;
    const effectType = payload?.effectType;
    const useCustomOrder = payload?.useCustomOrder;
    const customOrder = payload?.customOrder;
    const mode = payload?.mode;

    const pid = socket.data.playerId as string | undefined;
    const socketIsSpectator = !!(
      (socket.data as any)?.spectator || (socket.data as any)?.isSpectator
    );
    if (!pid || socketIsSpectator) return;

    if (!gameId || typeof gameId !== "string") return;
    if (
      effectType !== "damage" &&
      effectType !== "life_gain" &&
      effectType !== "counters" &&
      effectType !== "tokens"
    ) {
      return;
    }
    if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return;
    }

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }

    const players = (game.state as any)?.players;
    const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === pid) : undefined;
    if (!seated || seated.isSpectator || seated.spectator) {
      socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' });
      return;
    }

    // Initialize replacement effect preferences if needed
    (game.state as any).replacementEffectPreferences = (game.state as any).replacementEffectPreferences || {};
    (game.state as any).replacementEffectPreferences[pid] = (game.state as any).replacementEffectPreferences[pid] || {};
    
    const normalizedMode: "minimize" | "maximize" | "custom" | "auto" = (() => {
      if (mode === "minimize" || mode === "maximize" || mode === "custom" || mode === "auto") return mode;

      // Back-compat: previous API was a boolean toggle.
      // For damage: toggle means maximize vs minimize.
      // For others: toggle means custom vs auto.
      if (effectType === "damage") {
        return useCustomOrder ? 'maximize' : 'minimize';
      }
      return useCustomOrder ? 'custom' : 'auto';
    })();

    const normalizedCustomOrder = Array.isArray(customOrder) ? (customOrder as string[]) : [];
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
  socket.on(
    "getReplacementEffectOrder",
    (payload?: { gameId?: unknown; effectType?: unknown }) => {
    const gameId = payload?.gameId;
    const effectType = payload?.effectType;

    const pid = socket.data.playerId as string | undefined;
    const socketIsSpectator = !!(
      (socket.data as any)?.spectator || (socket.data as any)?.isSpectator
    );
    if (!pid || socketIsSpectator) return;

    if (!gameId || typeof gameId !== "string") return;
    if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return;
    }

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }

    const players = (game.state as any)?.players;
    const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === pid) : undefined;
    if (!seated || seated.isSpectator || seated.spectator) {
      socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' });
      return;
    }

    const preferences = (game.state as any).replacementEffectPreferences?.[pid] || {};
    
    if (
      effectType === "damage" ||
      effectType === "life_gain" ||
      effectType === "counters" ||
      effectType === "tokens"
    ) {
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

  // Forbidden Orchard opponent selection is handled via Resolution Queue (see socket/resolution.ts)

  // Legacy confirmManaDistribution handler removed - now using resolution queue system
  // See resolution.ts MANA_COLOR_SELECTION handling

  // Cycling - discard a card from hand, pay cost, and draw a card
  // Properly uses the stack per MTG rules (Rule 702.29)
  socket.on(
    "activateCycling",
    (payload?: { gameId?: unknown; cardId?: unknown; abilityId?: unknown }) => {
      const gameId = payload?.gameId;
      const cardId = payload?.cardId;
      const abilityId = payload?.abilityId;
    const pid = socket.data.playerId as string | undefined;
    const socketIsSpectator = !!(
      (socket.data as any)?.spectator || (socket.data as any)?.isSpectator
    );
    if (!pid || socketIsSpectator) return;

    if (!gameId || typeof gameId !== 'string') return;
    if (!cardId || typeof cardId !== 'string') return;
    if (abilityId != null && typeof abilityId !== 'string') return;
    if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return;
    }

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit('error', { code: 'GAME_NOT_FOUND', message: 'Game not found' });
      return;
    }

    const players = (game.state as any)?.players;
    const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === pid) : undefined;
    if (!seated || seated.isSpectator || seated.spectator) {
      socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' });
      return;
    }

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
    const normalizedAbilityId = typeof abilityId === 'string' && abilityId.trim().length > 0 ? abilityId.trim() : 'cycling';
    const isParserCyclingAbilityId = new RegExp(`^${String(cardId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-cycling-\\d+$`, 'i').test(normalizedAbilityId);
    if (normalizedAbilityId !== 'cycling' && !isParserCyclingAbilityId) {
      socket.emit('error', {
        code: 'INVALID_ABILITY_ID',
        message: `${normalizedAbilityId} is not a cycling ability for ${cardName}`,
      });
      return;
    }

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
      abilityId: normalizedAbilityId,
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
      abilityId: normalizedAbilityId,
      cyclingCost: cyclingCostStr,
      stackId: abilityStackId,
    });

    broadcastGame(io, game, gameId);
    }
  );
}
