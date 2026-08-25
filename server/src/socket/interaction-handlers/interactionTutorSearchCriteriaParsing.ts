/**
 * socket/interaction-handlers/interactionTutorSearchCriteriaParsing.ts
 *
 * Origin parent: server/src/socket/interaction.ts
 * Cluster moved: tutor detection and library-search criteria parsing -
 *   CREATURE_TYPES / CREATURE_TYPE_PATTERNS tables, the TutorInfo shape,
 *   detectTutorEffect, getUpgradedCreatureTypes, parseSearchCriteria.
 * Public entry symbols: TutorInfo, detectTutorEffect, getUpgradedCreatureTypes,
 *   parseSearchCriteria (re-exported from interaction.ts for stable import paths).
 */

import { inferSplitLibrarySearchPlan } from "../../../../rules-engine/src/oracleIRSplitLibrarySearch.js";

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
  toHand?: number | 'rest';
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
  
  // Ignore reminder text so keywords like landcycling do not masquerade as spell tutors.
  const text = oracleText.replace(/\([^)]*\)/g, ' ').toLowerCase();
  
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
    
    // Split-destination tutors (Cultivate / Kodama's Reach / Boreas Charger)
    const splitPlan = inferSplitLibrarySearchPlan(text);
    if (splitPlan) {
      return {
        isTutor: true,
        searchCriteria,
        destination: 'split',
        maxSelections: splitPlan.toHand === 'rest' ? maxSelections : 2,
        splitDestination: true,
        toBattlefield: splitPlan.toBattlefield,
        toHand: splitPlan.toHand,
        entersTapped: splitPlan.entersTapped || entersTapped,
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
export function getUpgradedCreatureTypes(permanent: any): string[] {
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
