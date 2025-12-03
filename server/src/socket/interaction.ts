import type { Server, Socket } from "socket.io";
import { ensureGame, appendGameEvent, broadcastGame, getPlayerName, emitToPlayer, broadcastManaPoolUpdate, getEffectivePower, getEffectiveToughness } from "./util";
import { appendEvent } from "../db";
import { games } from "./socket";
import { 
  permanentHasCreatureType,
  findPermanentsWithCreatureType 
} from "../../../shared/src/creatureTypes";
import { parseSacrificeCost, type SacrificeType } from "../../../shared/src/textUtils";
import { getDeathTriggers, getPlayersWhoMustSacrifice } from "../state/modules/triggered-abilities";
import { 
  getManaAbilitiesForPermanent, 
  getManaMultiplier, 
  getExtraManaProduction, 
  getDevotionManaAmount, 
  getCreatureCountManaAmount,
  detectManaModifiers
} from "../state/modules/mana-abilities";

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
interface TutorInfo {
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
function detectTutorEffect(oracleText: string): TutorInfo {
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
 * Parse search criteria to create a filter object
 */
function parseSearchCriteria(criteria: string): { supertypes?: string[]; types?: string[]; subtypes?: string[] } {
  const result: { supertypes?: string[]; types?: string[]; subtypes?: string[] } = {};
  const text = criteria.toLowerCase();
  
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
  socket.on("beginScry", ({ gameId, count }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const numCards = Math.max(1, Math.min(10, count));
    const cards = game.peekTopN(pid, numCards);

    socket.emit("scryPeek", { gameId, cards });
  });

  socket.on("confirmScry", ({ gameId, keepTopOrder, bottomOrder }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const peekedCards = game.peekTopN(pid, (keepTopOrder?.length || 0) + (bottomOrder?.length || 0));
    const allSelected = [...(keepTopOrder || []), ...(bottomOrder || [])].map(c => c.id);

    // Validate consistency between client and game state
    if (
      peekedCards.length !== allSelected.length ||
      !peekedCards.every(card => allSelected.includes(card.id))
    ) {
      socket.emit("error", {
        code: "SCRY",
        message: "Scry selection does not match current library state.",
      });
      return;
    }

    game.applyEvent({
      type: "scryResolve",
      playerId: pid,
      keepTopOrder: keepTopOrder || [],
      bottomOrder: bottomOrder || [],
    });
    appendEvent(gameId, game.seq, "scryResolve", { playerId: pid, keepTopOrder, bottomOrder });

    broadcastGame(io, game, gameId);
  });

  // Surveil: Peek, send cards to graveyard, or reorder
  socket.on("beginSurveil", ({ gameId, count }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const numCards = Math.max(1, Math.min(10, count));
    const cards = game.peekTopN(pid, numCards);

    socket.emit("surveilPeek", { gameId, cards });
  });

  socket.on("confirmSurveil", ({ gameId, toGraveyard, keepTopOrder }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const peekedCards = game.peekTopN(pid, (toGraveyard?.length || 0) + (keepTopOrder?.length || 0));
    const allSelected = [...(toGraveyard || []), ...(keepTopOrder || [])].map(c => c.id);

    // Validate consistency between client and game state
    if (
      peekedCards.length !== allSelected.length ||
      !peekedCards.every(card => allSelected.includes(card.id))
    ) {
      socket.emit("error", {
        code: "SURVEIL",
        message: "Surveil selection does not match current library state.",
      });
      return;
    }

    game.applyEvent({
      type: "surveilResolve",
      playerId: pid,
      toGraveyard: toGraveyard || [],
      keepTopOrder: keepTopOrder || [],
    });
    appendEvent(gameId, game.seq, "surveilResolve", { playerId: pid, toGraveyard, keepTopOrder });

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
    const battlefield = game.state?.battlefield || [];
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
    } else if (abilityId === "return-from-graveyard" || abilityId === "graveyard-activated") {
      // Generic return from graveyard ability (like Summon the School)
      // Parse the oracle text to determine the destination
      const oracleText = (card.oracle_text || "").toLowerCase();
      
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
      console.log(`[activateGraveyardAbility] Unhandled ability ${abilityId} for ${cardName}`);
      
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
    const battlefield = game.state?.battlefield || [];
    
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
    
    (permanent as any).tapped = true;
    
    // Check if this permanent has mana abilities (intrinsic or granted by effects like Cryptolith Rite)
    // If so, add the produced mana to the player's mana pool
    const card = (permanent as any).card;
    const cardName = card?.name || "Unknown";
    const typeLine = (card?.type_line || "").toLowerCase();
    const isLand = typeLine.includes("land");
    const isBasic = typeLine.includes("basic");
    
    // ========================================================================
    // Check for devotion-based or creature-count-based mana abilities FIRST
    // These are special scaling mana abilities (Karametra's Acolyte, Priest of Titania, etc.)
    // ========================================================================
    let devotionMana = getDevotionManaAmount(game.state, permanent, pid);
    let creatureCountMana = getCreatureCountManaAmount(game.state, permanent, pid);
    
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
        
        broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`);
      }
      // ========================================================================
      // Handle creature-count-based mana abilities (Priest of Titania, Elvish Archdruid, etc.)
      // ========================================================================
      else if (creatureCountMana && creatureCountMana.amount > 0) {
        const baseAmount = creatureCountMana.amount;
        const totalAmount = baseAmount * effectiveMultiplier;
        
        // Handle special 'any_combination' color (like Selvala)
        if (creatureCountMana.color === 'any_combination' || creatureCountMana.color.startsWith('combination:')) {
          socket.emit("manaColorChoice", {
            gameId,
            permanentId,
            cardName,
            availableColors: ['W', 'U', 'B', 'R', 'G'],
            totalAmount,
            isAnyColor: true,
            message: `Choose how to distribute ${totalAmount} mana`,
          });
          
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `${getPlayerName(game, pid)} tapped ${cardName} for ${totalAmount} mana (choose colors).`,
            ts: Date.now(),
          });
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
          
          broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`);
        }
      }
      // ========================================================================
      // Handle standard mana abilities (lands, mana dorks, rocks)
      // ========================================================================
      else if (manaAbilities.length > 0) {
        // Use the first mana ability's production
        const ability = manaAbilities[0];
        const produces = ability.produces || [];
        
        if (produces.length > 0) {
          // If produces multiple colors (like "any color"), prompt user for choice
          if (produces.length > 1) {
            // Calculate total mana for the prompt
            const baseAmount = 1;
            const totalAmount = baseAmount * effectiveMultiplier;
            
            // Get extra mana from effects like Caged Sun, Nissa, Crypt Ghast
            const extraMana = getExtraManaProduction(game.state, permanent, pid, produces[0]);
            const totalExtra = extraMana.reduce((acc, e) => acc + e.amount, 0);
            
            socket.emit("manaColorChoice", {
              gameId,
              permanentId,
              cardName,
              availableColors: produces,
              grantedBy: ability.isGranted ? ability.grantedBy : undefined,
              manaMultiplier: effectiveMultiplier > 1 ? effectiveMultiplier : undefined,
              extraMana: totalExtra > 0 ? extraMana : undefined,
              totalAmount: totalAmount + totalExtra,
            });
            
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `${getPlayerName(game, pid)} tapped ${cardName} for mana (choose color).`,
              ts: Date.now(),
            });
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
            broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`);
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
    const battlefield = game.state?.battlefield || [];
    
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
        console.warn("[sacrificePermanent] Error processing death triggers:", err);
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
  socket.on("activateBattlefieldAbility", ({ gameId, permanentId, abilityId }) => {
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
      
      // Build description for the ability
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
      
      // Put the fetch land ability on the stack (per MTG rules, activated abilities use the stack)
      game.state.stack = game.state.stack || [];
      const abilityStackId = `ability_fetch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      game.state.stack.push({
        id: abilityStackId,
        type: 'ability',
        controller: pid,
        source: permanentId,
        sourceName: cardName,
        description: `${searchDescription}, put it onto the battlefield, then shuffle`,
        abilityType: 'fetch-land',
        // Store search parameters for when the ability resolves
        searchParams: {
          filter,
          searchDescription,
          isTrueFetch,
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
    
    // Handle equip abilities (equipment cards)
    // Check if this is an equip ability - abilityId contains "equip" or it's an equipment with equip cost
    const isEquipment = typeLine.includes("equipment");
    const isEquipAbility = abilityId.includes("equip") || (isEquipment && oracleText.includes("equip"));
    if (isEquipAbility) {
      // Get valid target creatures
      const validTargets = battlefield.filter((p: any) => {
        if (p.controller !== pid) return false;
        const pTypeLine = (p.card?.type_line || "").toLowerCase();
        return pTypeLine.includes("creature");
      });

      if (validTargets.length === 0) {
        socket.emit("error", {
          code: "NO_VALID_TARGETS",
          message: "You have no creatures to equip",
        });
        return;
      }

      // Parse equip cost from oracle text
      const equipCostMatch = oracleText.match(/equip\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
      const equipCost = equipCostMatch ? equipCostMatch[1] : "{0}";
      
      // Send target selection prompt
      socket.emit("selectEquipTarget", {
        gameId,
        equipmentId: permanentId,
        equipmentName: cardName,
        equipCost,
        imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
        validTargets: validTargets.map((c: any) => ({
          id: c.id,
          name: c.card?.name || "Creature",
          power: c.card?.power || c.basePower || "0",
          toughness: c.card?.toughness || c.baseToughness || "0",
          imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
        })),
      });
      
      console.log(`[activateBattlefieldAbility] Equip ability on ${cardName}: prompting for target selection`);
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
      
      console.log(`[activateBattlefieldAbility] Crew ability on ${cardName}: prompting for creature selection (need power ${crewPower})`);
      return;
    }
    
    // Handle Station abilities (Spacecraft cards)
    // Station N: Add charge counters, becomes creature when threshold is met
    const isSpacecraft = typeLine.includes("spacecraft");
    const isStationAbility = abilityId.includes("station") || (isSpacecraft && oracleText.includes("station"));
    if (isStationAbility) {
      // Parse station threshold from oracle text
      const stationMatch = oracleText.match(/station\s*(\d+)/i);
      const stationThreshold = stationMatch ? parseInt(stationMatch[1], 10) : 0;
      
      // Add a charge counter
      (permanent as any).counters = (permanent as any).counters || {};
      const currentCounters = (permanent as any).counters.charge || 0;
      (permanent as any).counters.charge = currentCounters + 1;
      
      const newCounterCount = (permanent as any).counters.charge;
      
      // Check if threshold is met
      if (stationThreshold > 0 && newCounterCount >= stationThreshold) {
        // Mark as stationed (becomes a creature)
        (permanent as any).stationed = true;
        (permanent as any).grantedTypes = (permanent as any).grantedTypes || [];
        if (!(permanent as any).grantedTypes.includes('Creature')) {
          (permanent as any).grantedTypes.push('Creature');
        }
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `🚀 ${cardName} is now stationed! (${newCounterCount}/${stationThreshold} charge counters) It becomes an artifact creature.`,
          ts: Date.now(),
        });
      } else {
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `⚡ ${getPlayerName(game, pid)} added a charge counter to ${cardName}. (${newCounterCount}/${stationThreshold})`,
          ts: Date.now(),
        });
      }
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle mana abilities (tap-mana-*)
    if (abilityId.startsWith("tap-mana")) {
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
        "tap-mana-w": "white",
        "tap-mana-u": "blue",
        "tap-mana-b": "black",
        "tap-mana-r": "red",
        "tap-mana-g": "green",
        "tap-mana-any": "any", // Will need to prompt for color choice
        "tap-mana": "colorless",
      };
      manaColor = manaColorMap[abilityId] || "colorless";
      
      // Add mana to pool
      game.state.manaPool = game.state.manaPool || {};
      game.state.manaPool[pid] = game.state.manaPool[pid] || {
        white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
      };
      
      if (manaColor === "any") {
        // For "any color" mana, add colorless for now (ideally prompt user)
        // TODO: Implement color choice prompt
        game.state.manaPool[pid].colorless++;
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} tapped ${cardName} for mana.`,
          ts: Date.now(),
        });
      } else {
        (game.state.manaPool[pid] as any)[manaColor]++;
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} tapped ${manaColor} mana.`,
          ts: Date.now(),
        });
      }
      
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
        const opponents = players.filter((p: any) => p?.id != null && p.id !== pid);
        
        if (opponents.length > 0) {
          // TODO: In a real implementation, controller should choose the target opponent
          // For now, give token to first opponent
          const targetOpponent = opponents[0];
          const opponentId = targetOpponent.id;
          
          // Create 1/1 colorless Spirit token for opponent
          const tokenId = `token_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          game.state.battlefield = game.state.battlefield || [];
          game.state.battlefield.push({
            id: tokenId,
            controller: opponentId,
            owner: opponentId,
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
          });
          
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `Forbidden Orchard: ${getPlayerName(game, opponentId)} creates a 1/1 colorless Spirit token.`,
            ts: Date.now(),
          });
        }
      }
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      // Broadcast mana pool update to ensure client sees the new floating mana
      broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`);
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateManaAbility", { playerId: pid, permanentId, abilityId, manaColor });
      
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle planeswalker abilities (pw-ability-N)
    if (abilityId.startsWith("pw-ability-")) {
      // Parse ability index
      const abilityIndex = parseInt(abilityId.replace("pw-ability-", ""), 10);
      
      // Parse the planeswalker ability from oracle text
      const pwAbilityPattern = /\[([+−\-]?\d+)\]:\s*([^[\]]+?)(?=\n|\[|$)/gi;
      const abilities: { loyaltyCost: number; text: string }[] = [];
      let pwMatch;
      while ((pwMatch = pwAbilityPattern.exec(oracleText)) !== null) {
        const costStr = pwMatch[1].replace('−', '-');
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
    console.log(`[activateBattlefieldAbility] Processing ability ${abilityId} on ${cardName}`);
    
    // Parse the ability from oracle text if possible
    const abilityParts = abilityId.split('_');
    const abilityIndex = abilityParts.length > 1 ? parseInt(abilityParts[1], 10) : 0;
    
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
      abilityText = `Activated ability on ${cardName}`;
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
      
      console.log(`[activateBattlefieldAbility] ${cardName} requires sacrifice of a ${sacrificeType}. Waiting for selection from ${pid}`);
      return;
    }
    
    // Tap the permanent if required
    if (requiresTap && !(permanent as any).tapped) {
      (permanent as any).tapped = true;
    }
    
    // Check if this is a mana ability (doesn't use the stack)
    // Mana abilities are abilities that produce mana and don't target
    const isManaAbility = /add\s*(\{[wubrgc]\}|mana|one mana|two mana|three mana)/i.test(oracleText);
    
    if (!isManaAbility) {
      // Put the ability on the stack
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
        
        broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`);
      }
      // Handle creature-count-based mana
      else if (creatureCountMana && creatureCountMana.amount > 0) {
        const totalAmount = creatureCountMana.amount * effectiveMultiplier;
        
        if (creatureCountMana.color === 'any_combination' || creatureCountMana.color.startsWith('combination:')) {
          socket.emit("manaColorChoice", {
            gameId,
            permanentId,
            cardName,
            availableColors: ['W', 'U', 'B', 'R', 'G'],
            totalAmount,
            isAnyColor: true,
            message: `Choose how to distribute ${totalAmount} mana`,
          });
          
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `${getPlayerName(game, pid)} tapped ${cardName} for ${totalAmount} mana (choose colors).`,
            ts: Date.now(),
          });
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
          
          broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`);
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
            if (produces.length > 1) {
              // Multi-color production - emit choice to player
              const baseAmount = 1;
              const totalAmount = baseAmount * effectiveMultiplier;
              
              // Get extra mana from effects
              const extraMana = getExtraManaProduction(game.state, permanent, pid, produces[0]);
              const totalExtra = extraMana.reduce((acc, e) => acc + e.amount, 0);
              
              socket.emit("manaColorChoice", {
                gameId,
                permanentId,
                cardName,
                availableColors: produces,
                grantedBy: ability.isGranted ? ability.grantedBy : undefined,
                manaMultiplier: effectiveMultiplier > 1 ? effectiveMultiplier : undefined,
                extraMana: totalExtra > 0 ? extraMana : undefined,
                totalAmount: totalAmount + totalExtra,
              });
              
              io.to(gameId).emit("chat", {
                id: `m_${Date.now()}`,
                gameId,
                from: "system",
                message: `${getPlayerName(game, pid)} tapped ${cardName} for mana (choose color).`,
                ts: Date.now(),
              });
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
              
              broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`);
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

  // Library search selection (response to librarySearchRequest from tutors)
  socket.on("librarySearchSelect", ({ gameId, selectedCardIds, moveTo, targetPlayerId, splitAssignments, filter }: { 
    gameId: string; 
    selectedCardIds: string[]; 
    moveTo: string;
    targetPlayerId?: string; // For searching opponent's library (Gitaxian Probe, etc.)
    splitAssignments?: { toBattlefield: string[]; toHand: string[] }; // For split destination (Cultivate, Kodama's Reach)
    filter?: { supertypes?: string[]; types?: string[]; subtypes?: string[] }; // Filter to validate selections
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    
    // Determine whose library we're searching
    const libraryOwner = targetPlayerId || pid;
    
    const zones = game.state?.zones?.[libraryOwner];
    if (!zones) {
      socket.emit("error", {
        code: "ZONES_NOT_FOUND",
        message: "Player zones not found",
      });
      return;
    }
    
    // Get library data for validation
    const libraryData = typeof game.searchLibrary === 'function' 
      ? game.searchLibrary(libraryOwner, "", 1000) 
      : [];
    
    // Validate selected cards against filter (e.g., basic lands for Cultivate)
    if (filter && selectedCardIds.length > 0) {
      const cardDataById = new Map<string, any>();
      for (const card of libraryData) {
        cardDataById.set(card.id, card);
      }
      
      for (const cardId of selectedCardIds) {
        const card = cardDataById.get(cardId);
        if (!card) continue;
        
        const typeLine = ((card as any).type_line || '').toLowerCase();
        // Split type line into words for exact matching
        const typeLineWords = typeLine.split(/[\s—-]+/);
        
        // Check supertypes (e.g., 'basic' for Cultivate/Kodama's Reach)
        // Use word boundary matching to avoid false positives
        if (filter.supertypes && filter.supertypes.length > 0) {
          for (const supertype of filter.supertypes) {
            const lowerSupertype = supertype.toLowerCase();
            // Check if supertype appears as a standalone word in the type line
            if (!typeLineWords.includes(lowerSupertype)) {
              socket.emit("error", {
                code: "INVALID_SELECTION",
                message: `${(card as any).name || 'Selected card'} is not a ${supertype} card. Only ${supertype} cards can be selected.`,
              });
              return;
            }
          }
        }
        
        // Check card types (e.g., 'land')
        if (filter.types && filter.types.length > 0) {
          let matchesType = false;
          for (const cardType of filter.types) {
            if (typeLine.includes(cardType.toLowerCase())) {
              matchesType = true;
              break;
            }
          }
          if (!matchesType) {
            socket.emit("error", {
              code: "INVALID_SELECTION",
              message: `${(card as any).name || 'Selected card'} is not the required type. Only ${filter.types.join('/')} cards can be selected.`,
            });
            return;
          }
        }
        
        // Check subtypes (e.g., 'forest', 'island')
        if (filter.subtypes && filter.subtypes.length > 0) {
          let matchesSubtype = false;
          for (const subtype of filter.subtypes) {
            if (typeLine.includes(subtype.toLowerCase())) {
              matchesSubtype = true;
              break;
            }
          }
          if (!matchesSubtype) {
            socket.emit("error", {
              code: "INVALID_SELECTION",
              message: `${(card as any).name || 'Selected card'} doesn't have the required subtype. Only ${filter.subtypes.join('/')} cards can be selected.`,
            });
            return;
          }
        }
      }
    }
    
    const movedCardNames: string[] = [];
    const battlefieldCardNames: string[] = [];
    const handCardNames: string[] = [];
    
    // Handle split destination (Cultivate, Kodama's Reach)
    if (moveTo === 'split' && splitAssignments) {
      // Get full card data before any operations
      const libraryData = typeof game.searchLibrary === 'function' 
        ? game.searchLibrary(libraryOwner, "", 1000) 
        : [];
      
      const cardDataById = new Map<string, any>();
      for (const card of libraryData) {
        cardDataById.set(card.id, card);
      }
      
      if (typeof game.selectFromLibrary === 'function') {
        // Handle battlefield cards first
        if (splitAssignments.toBattlefield && splitAssignments.toBattlefield.length > 0) {
          const battlefieldCards = game.selectFromLibrary(libraryOwner, splitAssignments.toBattlefield, 'battlefield' as any);
          
          game.state.battlefield = game.state.battlefield || [];
          
          for (const minimalCard of battlefieldCards) {
            const cardId = (minimalCard as any).id;
            const fullCard = cardDataById.get(cardId) || minimalCard;
            const cardName = (fullCard as any).name || "Unknown";
            
            battlefieldCardNames.push(cardName);
            movedCardNames.push(cardName);
            
            const permanentId = generateId("perm");
            
            game.state.battlefield.push({
              id: permanentId,
              card: { ...fullCard, zone: 'battlefield' },
              controller: pid,
              owner: libraryOwner,
              tapped: true, // Cultivate/Kodama's Reach puts lands onto battlefield tapped
              counters: {},
            } as any);
          }
        }
        
        // Handle hand cards
        if (splitAssignments.toHand && splitAssignments.toHand.length > 0) {
          const handCards = game.selectFromLibrary(libraryOwner, splitAssignments.toHand, 'hand');
          
          for (const card of handCards) {
            const cardName = (card as any).name || "Unknown";
            handCardNames.push(cardName);
            movedCardNames.push(cardName);
          }
        }
        
        // Shuffle library after search
        if (typeof game.shuffleLibrary === "function") {
          game.shuffleLibrary(libraryOwner);
        }
        
        if (typeof game.bumpSeq === "function") {
          game.bumpSeq();
        }
        
        appendEvent(gameId, (game as any).seq ?? 0, "librarySearchSelect", {
          playerId: pid,
          libraryOwner,
          selectedCardIds,
          moveTo: 'split',
          splitAssignments,
        });
        
        // Create message describing split destination
        let message = `${getPlayerName(game, pid)} searched their library`;
        if (battlefieldCardNames.length > 0) {
          message += `, put ${battlefieldCardNames.join(", ")} onto the battlefield tapped`;
        }
        if (handCardNames.length > 0) {
          if (battlefieldCardNames.length > 0) {
            message += ` and ${handCardNames.join(", ")} into their hand`;
          } else {
            message += `, put ${handCardNames.join(", ")} into their hand`;
          }
        }
        message += ', then shuffled.';
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message,
          ts: Date.now(),
        });
        
        broadcastGame(io, game, gameId);
        return;
      }
    }
    
    // Use the game's selectFromLibrary function for supported destinations
    // This properly accesses the internal libraries Map
    if (moveTo === 'hand' || moveTo === 'graveyard' || moveTo === 'exile') {
      // selectFromLibrary handles hand, graveyard, exile
      if (typeof game.selectFromLibrary === 'function') {
        const moved = game.selectFromLibrary(libraryOwner, selectedCardIds, moveTo as any);
        for (const card of moved) {
          movedCardNames.push((card as any).name || "Unknown");
        }
      } else {
        console.error('[librarySearchSelect] game.selectFromLibrary not available');
        socket.emit("error", {
          code: "INTERNAL_ERROR",
          message: "Library selection not available",
        });
        return;
      }
    } else if (moveTo === 'battlefield' || moveTo === 'top') {
      // For 'battlefield' and 'top', we need special handling:
      // - battlefield: selectFromLibrary returns minimal objects, need to get full card data first
      // - top: use applyScry to reorder library and put cards on top
      
      // Get current library for card data lookup (BEFORE modifying)
      const libraryData = typeof game.searchLibrary === 'function' 
        ? game.searchLibrary(libraryOwner, "", 1000) 
        : [];
      
      // Create a map of card data by ID for full card info
      const cardDataById = new Map<string, any>();
      for (const card of libraryData) {
        cardDataById.set(card.id, card);
      }
      
      if (moveTo === 'battlefield') {
        // Use selectFromLibrary to remove from library, then add to battlefield
        if (typeof game.selectFromLibrary === 'function') {
          const moved = game.selectFromLibrary(libraryOwner, selectedCardIds, 'battlefield' as any);
          
          game.state.battlefield = game.state.battlefield || [];
          
          for (const minimalCard of moved) {
            const cardId = (minimalCard as any).id;
            // Get full card data from our lookup or use what we have
            const fullCard = cardDataById.get(cardId) || minimalCard;
            
            movedCardNames.push((fullCard as any).name || (minimalCard as any).name || "Unknown");
            
            const cardName = ((fullCard as any).name || "").toLowerCase();
            
            // Check if this is a shock land that needs a prompt
            const SHOCK_LANDS = new Set([
              "blood crypt", "breeding pool", "godless shrine", "hallowed fountain",
              "overgrown tomb", "sacred foundry", "steam vents", "stomping ground",
              "temple garden", "watery grave"
            ]);
            
            const isShockLand = SHOCK_LANDS.has(cardName);
            
            // Check if this land enters tapped based on oracle text
            const oracleText = ((fullCard as any).oracle_text || "").toLowerCase();
            
            // Lands that always enter tapped (shock lands enter tapped by default, prompt for paying 2 life)
            const entersTapped = 
              isShockLand ||
              (oracleText.includes('enters the battlefield tapped') && 
               !oracleText.includes('unless') && 
               !oracleText.includes('you may pay'));
            
            const permanentId = generateId("perm");
            
            game.state.battlefield.push({
              id: permanentId,
              card: { ...fullCard, zone: 'battlefield' },
              controller: pid,
              owner: libraryOwner,
              tapped: entersTapped,
              counters: {},
            } as any);
            
            // If it's a shock land, emit prompt to player to optionally pay life to untap
            if (isShockLand) {
              const currentLife = (game.state as any)?.life?.[pid] || 40;
              const cardImageUrl = (fullCard as any).image_uris?.small || (fullCard as any).image_uris?.normal;
              
              socket.emit("shockLandPrompt", {
                gameId,
                permanentId,
                cardName: (fullCard as any).name,
                imageUrl: cardImageUrl,
                currentLife,
              });
            }
          }
        } else {
          console.error('[librarySearchSelect] game.selectFromLibrary not available');
        }
      } else {
        // moveTo === 'top': For tutors that put card on top of library (e.g., Vampiric Tutor)
        // Correct sequence: remove card → shuffle library → put card on top
        // This ensures the rest of the library is properly randomized and hidden info is protected
        
        // Get full card data before any operations
        const cardsToTop: any[] = [];
        for (const cardId of selectedCardIds) {
          const card = cardDataById.get(cardId);
          if (card) {
            movedCardNames.push((card as any).name || "Unknown");
            cardsToTop.push({ ...card });
          }
        }
        
        if (typeof game.selectFromLibrary === 'function' && 
            typeof game.shuffleLibrary === 'function' &&
            typeof game.putCardsOnTopOfLibrary === 'function') {
          // Step 1: Remove the selected cards from library
          // Using 'battlefield' as destination just removes them without placing anywhere
          game.selectFromLibrary(libraryOwner, selectedCardIds, 'battlefield' as any);
          
          // Step 2: Shuffle the remaining library (this randomizes the order, protecting hidden info)
          game.shuffleLibrary(libraryOwner);
          
          // Step 3: Put the saved cards on top of the library
          game.putCardsOnTopOfLibrary(libraryOwner, cardsToTop);
          
          console.info('[librarySearchSelect] Cards put on top of library after shuffle:', 
            cardsToTop.map(c => c.name).join(', '));
        } else {
          console.warn('[librarySearchSelect] Required functions not available for top destination');
        }
      }
    }
    
    // Shuffle library after search (standard for tutors)
    // EXCEPTION: Don't shuffle if moveTo === 'top' since shuffling is handled specially above
    if (moveTo !== 'top' && typeof game.shuffleLibrary === "function") {
      game.shuffleLibrary(libraryOwner);
    }
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "librarySearchSelect", {
      playerId: pid,
      libraryOwner,
      selectedCardIds,
      moveTo,
    });
    
    const ownerName = libraryOwner === pid ? "their" : `${getPlayerName(game, libraryOwner)}'s`;
    const destName = moveTo === 'hand' ? 'hand' : moveTo === 'battlefield' ? 'the battlefield' : moveTo === 'top' ? 'the top of their library' : 'graveyard';
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} searched ${ownerName} library and put ${movedCardNames.join(", ")} to ${destName}.`,
      ts: Date.now(),
    });
    
    broadcastGame(io, game, gameId);
  });

  /**
   * Split-destination library search selection (for Kodama's Reach, Cultivate, etc.)
   * 
   * Player selects cards from library, then assigns each to either battlefield or hand.
   */
  socket.on("librarySearchSplitSelect", ({ gameId, battlefieldCardIds, handCardIds, entersTapped }: { 
    gameId: string; 
    battlefieldCardIds: string[];
    handCardIds: string[];
    entersTapped?: boolean;
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    
    const zones = game.state?.zones?.[pid];
    if (!zones) {
      socket.emit("error", {
        code: "ZONES_NOT_FOUND",
        message: "Player zones not found",
      });
      return;
    }
    
    const movedToBattlefield: string[] = [];
    const movedToHand: string[] = [];
    
    // Get current library for card data lookup (BEFORE modifying)
    const libraryData = typeof game.searchLibrary === 'function' 
      ? game.searchLibrary(pid, "", 1000) 
      : [];
    
    // Create a map of card data by ID for full card info
    const cardDataById = new Map<string, any>();
    for (const card of libraryData) {
      cardDataById.set(card.id, card);
    }
    
    // Combine all card IDs for removal from library
    const allSelectedIds = [...battlefieldCardIds, ...handCardIds];
    
    if (typeof game.selectFromLibrary === 'function') {
      // First, put cards that go to hand
      if (handCardIds.length > 0) {
        const movedHand = game.selectFromLibrary(pid, handCardIds, 'hand' as any);
        for (const card of movedHand) {
          movedToHand.push((card as any).name || "Unknown");
        }
      }
      
      // Then, put cards on battlefield (need special handling for tapped state)
      if (battlefieldCardIds.length > 0) {
        // Get full card data before removal
        const battlefieldCards = battlefieldCardIds.map(id => cardDataById.get(id)).filter(Boolean);
        
        // Remove from library by moving to a temp location
        game.selectFromLibrary(pid, battlefieldCardIds, 'battlefield' as any);
        
        game.state.battlefield = game.state.battlefield || [];
        
        for (const fullCard of battlefieldCards) {
          movedToBattlefield.push((fullCard as any).name || "Unknown");
          
          const permanentId = generateId("perm");
          
          // For Kodama's Reach/Cultivate, the land enters tapped
          const shouldEnterTapped = entersTapped ?? true;
          
          game.state.battlefield.push({
            id: permanentId,
            card: { ...fullCard, zone: 'battlefield' },
            controller: pid,
            owner: pid,
            tapped: shouldEnterTapped,
            counters: {},
          } as any);
        }
      }
    } else {
      console.error('[librarySearchSplitSelect] game.selectFromLibrary not available');
      socket.emit("error", {
        code: "INTERNAL_ERROR",
        message: "Library selection not available",
      });
      return;
    }
    
    // Shuffle library after search
    if (typeof game.shuffleLibrary === "function") {
      game.shuffleLibrary(pid);
    }
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "librarySearchSplitSelect", {
      playerId: pid,
      battlefieldCardIds,
      handCardIds,
      entersTapped,
    });
    
    // Build chat message
    const messages: string[] = [];
    if (movedToBattlefield.length > 0) {
      messages.push(`${movedToBattlefield.join(", ")} to the battlefield${entersTapped ? ' tapped' : ''}`);
    }
    if (movedToHand.length > 0) {
      messages.push(`${movedToHand.join(", ")} to their hand`);
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} searched their library and put ${messages.join(" and ")}.`,
      ts: Date.now(),
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
      
      console.log(`[entrapmentManeuverSelect] Created ${toughness} Soldier token(s) for ${caster}`);
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

  // Library search cancel
  socket.on("librarySearchCancel", ({ gameId }: { gameId: string }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    
    // Just shuffle library (most tutor effects require shuffle even if not finding)
    if (typeof game.shuffleLibrary === "function") {
      game.shuffleLibrary(pid);
    }
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} finished searching their library.`,
      ts: Date.now(),
    });
    
    broadcastGame(io, game, gameId);
  });

  // Target selection confirmation
  socket.on("targetSelectionConfirm", ({ gameId, effectId, selectedTargetIds }: {
    gameId: string;
    effectId?: string;
    selectedTargetIds: string[];
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    
    // Ensure selectedTargetIds is a valid array (defensive check for malformed payloads)
    const targetIds = Array.isArray(selectedTargetIds) ? selectedTargetIds : [];
    
    // Store targets for the pending effect/spell
    // This will be used when the spell/ability resolves
    game.state.pendingTargets = game.state.pendingTargets || {};
    game.state.pendingTargets[effectId || 'default'] = {
      playerId: pid,
      targetIds: targetIds,
    };
    
    // Check if this is a spell cast that was waiting for targets
    // effectId format is "cast_${cardId}_${timestamp}"
    if (effectId && effectId.startsWith('cast_')) {
      const parts = effectId.split('_');
      if (parts.length >= 2) {
        // cardId can contain underscores, so we join all parts except first and last
        const cardId = parts.slice(1, -1).join('_');
        
        console.log(`[targetSelectionConfirm] Spell cast with targets: cardId=${cardId}, targets=${targetIds.join(',')}`);
        
        // Now cast the spell with the selected targets
        if (typeof game.applyEvent === 'function') {
          game.applyEvent({ type: "castSpell", playerId: pid, cardId, targets: targetIds });
          console.log(`[targetSelectionConfirm] Spell ${cardId} cast with targets via applyEvent`);
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
    
    console.log(`[targetSelectionConfirm] Player ${pid} selected targets:`, targetIds);
    
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
    
    // Cancel the spell/effect if targets are required but not provided
    // For now, just log and broadcast
    console.log(`[targetSelectionCancel] Player ${pid} cancelled target selection for effect ${effectId}`);
    
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
  // Mana Pool Manipulation
  // ============================================================================

  /**
   * Add mana to a player's mana pool
   * Used for manual adjustments or card effects that add restricted mana
   */
  socket.on("addManaToPool", ({
    gameId,
    color,
    amount,
    restriction,
    restrictedTo,
    sourceId,
    sourceName,
  }: {
    gameId: string;
    color: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';
    amount: number;
    restriction?: string;
    restrictedTo?: string;
    sourceId?: string;
    sourceName?: string;
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }

    // Initialize mana pool if needed
    game.state.manaPool = game.state.manaPool || {};
    game.state.manaPool[pid] = game.state.manaPool[pid] || {
      white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
    };

    if (restriction) {
      // Add restricted mana
      const pool = game.state.manaPool[pid] as any;
      pool.restricted = pool.restricted || [];
      pool.restricted.push({
        type: color,
        amount,
        restriction,
        restrictedTo,
        sourceId,
        sourceName,
      });
    } else {
      // Add regular mana
      (game.state.manaPool[pid] as any)[color] = 
        ((game.state.manaPool[pid] as any)[color] || 0) + amount;
    }

    // Bump game sequence
    if (typeof (game as any).bumpSeq === "function") {
      (game as any).bumpSeq();
    }

    // Log the mana addition
    const restrictionText = restriction ? ` (${restriction})` : '';
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} added ${amount} ${color} mana to their pool${restrictionText}.`,
      ts: Date.now(),
    });

    // Emit mana pool update
    broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, 'Added mana');
    broadcastGame(io, game, gameId);
  });

  /**
   * Remove mana from a player's mana pool
   * Used for manual adjustments or payment verification
   */
  socket.on("removeManaFromPool", ({
    gameId,
    color,
    amount,
    restrictedIndex,
  }: {
    gameId: string;
    color: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';
    amount: number;
    restrictedIndex?: number;
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }

    const pool = game.state.manaPool?.[pid] as any;
    if (!pool) {
      socket.emit("error", { code: "INVALID_ACTION", message: "No mana pool to remove from" });
      return;
    }

    if (restrictedIndex !== undefined) {
      // Remove from restricted mana
      if (!pool.restricted || restrictedIndex >= pool.restricted.length) {
        socket.emit("error", { code: "INVALID_ACTION", message: "Invalid restricted mana index" });
        return;
      }
      const entry = pool.restricted[restrictedIndex];
      if (entry.amount < amount) {
        socket.emit("error", { code: "INVALID_ACTION", message: "Not enough restricted mana" });
        return;
      }
      if (entry.amount === amount) {
        pool.restricted.splice(restrictedIndex, 1);
        if (pool.restricted.length === 0) {
          delete pool.restricted;
        }
      } else {
        entry.amount -= amount;
      }
    } else {
      // Remove from regular mana
      if ((pool[color] || 0) < amount) {
        socket.emit("error", { code: "INVALID_ACTION", message: `Not enough ${color} mana` });
        return;
      }
      pool[color] = (pool[color] || 0) - amount;
    }

    // Bump game sequence
    if (typeof (game as any).bumpSeq === "function") { (game as any).bumpSeq(); }

    // Log the mana removal
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} removed ${amount} ${color} mana from their pool.`,
      ts: Date.now(),
    });

    // Emit mana pool update
    broadcastManaPoolUpdate(io, gameId, pid, pool, 'Removed mana');
    broadcastGame(io, game, gameId);
  });

  /**
   * Set mana pool "doesn't empty" effect
   * Used by cards like Horizon Stone, Omnath Locus of Mana, Kruphix
   */
  socket.on("setManaPoolDoesNotEmpty", ({
    gameId,
    sourceId,
    sourceName,
    convertsTo,
    convertsToColorless,
  }: {
    gameId: string;
    sourceId: string;
    sourceName: string;
    convertsTo?: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';
    convertsToColorless?: boolean;
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }

    // Initialize mana pool if needed
    game.state.manaPool = game.state.manaPool || {};
    game.state.manaPool[pid] = game.state.manaPool[pid] || {
      white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
    };

    const pool = game.state.manaPool[pid] as any;
    pool.doesNotEmpty = true;
    
    // Support both new convertsTo and deprecated convertsToColorless
    if (convertsTo) {
      pool.convertsTo = convertsTo;
    } else if (convertsToColorless) {
      pool.convertsTo = 'colorless';
      pool.convertsToColorless = true; // Keep for backwards compatibility
    }
    
    pool.noEmptySourceIds = pool.noEmptySourceIds || [];
    if (!pool.noEmptySourceIds.includes(sourceId)) {
      pool.noEmptySourceIds.push(sourceId);
    }

    // Bump game sequence
    if (typeof (game as any).bumpSeq === "function") { (game as any).bumpSeq(); }

    // Log the effect
    const targetColor = convertsTo || (convertsToColorless ? 'colorless' : null);
    const effectText = targetColor 
      ? `Mana converts to ${targetColor} instead of emptying (${sourceName})`
      : `Mana doesn't empty from pool (${sourceName})`;
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)}: ${effectText}`,
      ts: Date.now(),
    });

    // Emit mana pool update
    broadcastManaPoolUpdate(io, gameId, pid, pool, `Doesn't empty (${sourceName})`);
    broadcastGame(io, game, gameId);
  });

  /**
   * Remove mana pool "doesn't empty" effect
   * Called when the source permanent leaves the battlefield
   */
  socket.on("removeManaPoolDoesNotEmpty", ({
    gameId,
    sourceId,
  }: {
    gameId: string;
    sourceId: string;
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }

    const pool = game.state.manaPool?.[pid] as any;
    if (!pool || !pool.noEmptySourceIds) return;

    pool.noEmptySourceIds = pool.noEmptySourceIds.filter((id: string) => id !== sourceId);

    if (pool.noEmptySourceIds.length === 0) {
      delete pool.doesNotEmpty;
      delete pool.convertsToColorless;
      delete pool.noEmptySourceIds;
    }

    // Bump game sequence
    if (typeof (game as any).bumpSeq === "function") { (game as any).bumpSeq(); }

    broadcastGame(io, game, gameId);
  });

  // ============================================================================
  // Mana Color Selection (for creatures with "any color" mana abilities)
  // ============================================================================

  /**
   * Handle mana color selection when tapping a creature for mana of any color
   * This is used when creatures have granted mana abilities like Cryptolith Rite
   */
  socket.on("manaColorSelect", ({
    gameId,
    permanentId,
    selectedColor,
  }: {
    gameId: string;
    permanentId: string;
    selectedColor: 'W' | 'U' | 'B' | 'R' | 'G';
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }

    // Map color codes to pool keys
    const colorToPoolKey: Record<string, string> = {
      'W': 'white',
      'U': 'blue',
      'B': 'black',
      'R': 'red',
      'G': 'green',
    };

    const poolKey = colorToPoolKey[selectedColor];
    if (!poolKey) {
      socket.emit("error", { code: "INVALID_COLOR", message: "Invalid mana color selected" });
      return;
    }

    // Initialize mana pool if needed
    game.state.manaPool = game.state.manaPool || {};
    game.state.manaPool[pid] = game.state.manaPool[pid] || {
      white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
    };

    // Add the selected mana
    (game.state.manaPool[pid] as any)[poolKey]++;

    // Find the permanent to get its name for the chat message
    const battlefield = game.state?.battlefield || [];
    const permanent = battlefield.find((p: any) => p?.id === permanentId);
    const cardName = permanent?.card?.name || "Unknown";

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} added {${selectedColor}} mana from ${cardName}.`,
      ts: Date.now(),
    });

    // Bump game sequence
    if (typeof (game as any).bumpSeq === "function") { (game as any).bumpSeq(); }

    // Broadcast mana pool update
    broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Selected ${selectedColor} mana`);

    broadcastGame(io, game, gameId);
  });
}