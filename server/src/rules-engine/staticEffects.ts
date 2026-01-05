import type { GameState, BattlefieldPermanent, PlayerID } from '../../../shared/src';

/**
 * Lightweight continuous effect scanner.
 * Supports additive constant buffs and keyword grants from simple oracle text templates:
 * Patterns (case-insensitive):
 *  - "creatures you control get +X/+Y"
 *  - "other creatures you control get +X/+Y"
 *  - "all creatures get +X/+Y"
 *  - "<color> creatures get +X/+Y" (color words: white, blue, black, red, green)
 *  - "creatures you control get +X/+Y and have <abilities...>"
 *  - "you have hexproof" / "you have shroud"
 *  - "creatures you control have <abilities...>"
 *  - "other creatures you control have <abilities...>"
 *  - "you and other creatures you control have <abilities...>" (Shalai, Voice of Plenty)
 *  - Combined examples: Eldrazi Monument, Crusade, Glorious Anthem, Leyline of Sanctity, Witchbane Orb.
 *
 * Abilities recognized: flying, indestructible, vigilance, trample, hexproof, shroud, deathtouch,
 *                       lifelink, haste, menace, reach, first strike, double strike, protection.
 *
 * Limitations:
 *  - Ignores layer ordering, timestamp precedence, dependency resolution.
 *  - Does not handle "+X/+0 until end of turn" (temporary effects).
 */

const COLOR_WORDS = ['white', 'blue', 'black', 'red', 'green'];
const ABILITIES = [
  'flying', 'indestructible', 'vigilance', 'trample', 'hexproof', 'shroud',
  'deathtouch', 'lifelink', 'haste', 'menace', 'reach', 'first strike', 
  'double strike', 'protection', 'ward', 'wither', 'infect'
];

interface EffectAggregate {
  pDelta: number;
  tDelta: number;
  abilities: Set<string>;
}

export interface ContinuousEffectResult {
  perPermanent: Map<string, EffectAggregate>;
  playerHexproof: Set<PlayerID>;
  playerShroud: Set<PlayerID>;
  /** Type additions from global effects like Enchanted Evening */
  typeAdditions: Map<string, string[]>;
  /** Abilities granted to ALL permanents (not just creatures) - for Avacyn, etc. */
  permanentAbilities: Map<string, Set<string>>;
}

// ============================================================================
// Global Type-Changing Effects
// ============================================================================

/**
 * Known cards that add types to all permanents globally
 * Examples:
 * - Enchanted Evening: "All permanents are enchantments in addition to their other types."
 * - Mycosynth Lattice: "All permanents are artifacts in addition to their other types."
 */
const GLOBAL_TYPE_ADDITIONS: Record<string, { 
  addsType: string; 
  affectsAll: boolean;
  condition?: string;
}> = {
  "enchanted evening": {
    addsType: "Enchantment",
    affectsAll: true,
  },
  "mycosynth lattice": {
    addsType: "Artifact",
    affectsAll: true,
  },
};

// ============================================================================
// Known static effect cards for special handling
// ============================================================================

/**
 * Known cards with static effects that need special handling
 * These are cards that grant abilities but have complex patterns
 */
const KNOWN_STATIC_EFFECT_CARDS: Record<string, {
  grantsToCreatures?: string[];
  grantsToPlayer?: string[];
  affectsOtherCreatures?: boolean;
  affectsAllCreatures?: boolean;
  affectsOpponentCreatures?: boolean;
  powerToughnessBonus?: { power: number; toughness: number };
  requiresCondition?: string;
}> = {
  // Ability granters
  "anger": { grantsToCreatures: ['haste'], requiresCondition: 'graveyard_and_mountain' },
  "brawn": { grantsToCreatures: ['trample'], requiresCondition: 'graveyard_and_forest' },
  "wonder": { grantsToCreatures: ['flying'], requiresCondition: 'graveyard_and_island' },
  "filth": { grantsToCreatures: ['swampwalk'], requiresCondition: 'graveyard_and_swamp' },
  "glory": { grantsToCreatures: ['protection'], requiresCondition: 'graveyard_and_plains' },
  
  // Buff granters
  "craterhoof behemoth": { powerToughnessBonus: { power: 0, toughness: 0 }, grantsToCreatures: ['trample'] }, // +X/+X where X = creatures you control
  "overwhelming stampede": { powerToughnessBonus: { power: 0, toughness: 0 }, grantsToCreatures: ['trample'] }, // +X/+X where X = greatest power
  
  // Hexproof granters
  "shalai, voice of plenty": { grantsToPlayer: ['hexproof'], grantsToCreatures: ['hexproof'], affectsOtherCreatures: true },
  "leyline of sanctity": { grantsToPlayer: ['hexproof'] },
  "aegis of the gods": { grantsToPlayer: ['hexproof'] },
  "orbs of warding": { grantsToPlayer: ['hexproof'] },
  "witchbane orb": { grantsToPlayer: ['hexproof'] },
  "sigarda, heron's grace": { grantsToPlayer: ['hexproof'], grantsToCreatures: ['hexproof'] },
  
  // Protection granters
  "kira, great glass-spinner": { grantsToCreatures: ['ward'], affectsOtherCreatures: false }, // Creatures you control have ward (counter first spell)
  "saryth, the viper's fang": { grantsToCreatures: ['deathtouch', 'hexproof'] }, // Tapped have deathtouch, untapped have hexproof
  
  // Lure effects
  "lure": { }, // Enchanted creature must be blocked if able
  "shinen of life's roar": { }, // Must be blocked if able
  "engulfing slagwurm": { }, // Destroys creature before damage
  
  // All creatures effects
  "elesh norn, grand cenobite": { powerToughnessBonus: { power: 2, toughness: 2 }, affectsOpponentCreatures: true },
  "glaring spotlight": { }, // Creatures your opponents control lose hexproof
  
  // Mana ability granters
  "cryptolith rite": { grantsToCreatures: ['tap_for_any_color'] },
  "citanul hierophants": { grantsToCreatures: ['tap_for_green'] },
  "chromatic lantern": { }, // Lands have "tap: add one mana of any color"
  "elven chorus": { grantsToCreatures: ['tap_for_any_color'] }, // Nontoken creatures have convoke
};

function parseBuffSegment(seg: string): { p: number; t: number } | null {
  const m = seg.match(/\+(\d+)\s*\/\s*\+(\d+)/);
  if (m) return { p: parseInt(m[1], 10), t: parseInt(m[2], 10) };
  // Accept "+X/+Y" where Y may be same pattern
  return null;
}

function parseAbilities(text: string): string[] {
  const found: string[] = [];
  for (const a of ABILITIES) {
    const re = new RegExp(`\\b${a}\\b`, 'i');
    if (re.test(text)) found.push(a);
  }
  return found;
}

function isCreature(permanent: BattlefieldPermanent): boolean {
  const tl = ((permanent.card as any)?.type_line || '').toLowerCase();
  return /\bcreature\b/.test(tl);
}

function isColor(creature: BattlefieldPermanent, colorWord: string): boolean {
  // Very naive: checks oracle text or type line for color word; a robust system would parse card color identity.
  const tl = ((creature.card as any)?.type_line || '').toLowerCase();
  return tl.includes(colorWord.toLowerCase());
}

/**
 * Check if a creature has a specific creature type (e.g., "Soldier", "Goblin")
 * Handles both main types and subtypes in the type line
 */
function hasCreatureType(permanent: BattlefieldPermanent, creatureType: string): boolean {
  const tl = ((permanent.card as any)?.type_line || '').toLowerCase();
  // Check if the creature type exists as a word in the type line
  // Use word boundary to avoid false positives (e.g., "soldier" shouldn't match "soldiers")
  const typePattern = new RegExp(`\\b${creatureType.toLowerCase()}s?\\b`, 'i');
  return typePattern.test(tl);
}

// List of common creature types for pattern matching
const CREATURE_TYPES = [
  'advisor', 'aetherborn', 'ally', 'angel', 'antelope', 'ape', 'archer', 'archon', 'army', 'assassin', 'avatar',
  'barbarian', 'basilisk', 'bat', 'bear', 'beast', 'bird', 'boar', 'bringer', 'brushwagg',
  'camel', 'cat', 'centaur', 'chimera', 'cleric', 'construct', 'coward', 'crab', 'crocodile', 'cyclops',
  'demon', 'djinn', 'dragon', 'drake', 'druid', 'dwarf',
  'elder', 'elemental', 'elephant', 'elf', 'elk', 'eye',
  'faerie', 'ferret', 'fish', 'flagbearer', 'fox', 'frog', 'fungus',
  'giant', 'gnome', 'goat', 'goblin', 'god', 'golem', 'gorgon', 'griffin',
  'hag', 'harpy', 'hippo', 'horror', 'human', 'hydra', 'hyena',
  'illusion', 'imp', 'insect',
  'jellyfish',
  'kavu', 'kirin', 'kithkin', 'knight', 'kobold', 'kor',
  'leviathan', 'lhurgoyf', 'lizard',
  'manticore', 'masticore', 'mercenary', 'merfolk', 'minion', 'minotaur', 'monkey', 'monk', 'moonfolk', 'mutant', 'myr',
  'naga', 'nightmare', 'ninja', 'noble', 'noggle', 'nomad', 'nymph',
  'octopus', 'ogre', 'ooze', 'orb', 'orc', 'ox',
  'peasant', 'pegasus', 'pest', 'phoenix', 'pilot', 'pirate', 'plant', 'praetor', 'prism', 'processor',
  'rabbit', 'rat', 'rebel', 'reflection', 'rhino', 'rogue',
  'salamander', 'samurai', 'satyr', 'scarecrow', 'scorpion', 'scout', 'serpent', 'shade', 'shaman', 'shapeshifter', 'skeleton', 'slith', 'sliver', 'slug', 'snake', 'soldier', 'soltari', 'specter', 'spider', 'spike', 'spirit', 'sponge', 'squid', 'squirrel', 'starfish', 'survivor',
  'tentacle', 'thopter', 'treefolk', 'troll', 'turtle',
  'vampire', 'vedalken', 'viashino',
  'wall', 'warrior', 'weird', 'werewolf', 'whale', 'wizard', 'wolf', 'wolverine', 'worm', 'wraith',
  'zombie', 'zubera'
];

export function computeContinuousEffects(state: GameState): ContinuousEffectResult {
  const perPermanent = new Map<string, EffectAggregate>();
  const playerHexproof = new Set<PlayerID>();
  const playerShroud = new Set<PlayerID>();
  const permanentAbilities = new Map<string, Set<string>>();

  // Initialize aggregates for creatures and all permanents
  for (const perm of state.battlefield) {
    // Initialize ability tracking for ALL permanents (for Avacyn, etc.)
    permanentAbilities.set(perm.id, new Set());
    
    // Initialize creature-specific tracking
    if (isCreature(perm)) {
      perPermanent.set(perm.id, { pDelta: 0, tDelta: 0, abilities: new Set() });
    }
  }

  for (const source of state.battlefield) {
    const oracle = ((source.card as any)?.oracle_text || '').toLowerCase();
    if (!oracle) continue;
    const controller = source.controller;

    // Player hexproof/shroud
    if (/\byou have hexproof\b/.test(oracle)) playerHexproof.add(controller);
    if (/\byou have shroud\b/.test(oracle)) playerShroud.add(controller);

    // Global patterns
    // All creatures get +X/+Y
    const allMatch = oracle.match(/all creatures get (\+\d+\s*\/\s*\+\d+)/);
    if (allMatch) {
      const buff = parseBuffSegment(allMatch[1]);
      if (buff) {
        for (const perm of state.battlefield) {
          if (isCreature(perm)) {
            const agg = perPermanent.get(perm.id)!;
            agg.pDelta += buff.p;
            agg.tDelta += buff.t;
          }
        }
      }
    }

    // Color creatures get +X/+Y (global, e.g. Crusade)
    for (const colorWord of COLOR_WORDS) {
      const re = new RegExp(`${colorWord}\\s+creatures\\s+get\\s+(\\+\\d+\\s*/\\s*\\+\\d+)`, 'i');
      const m = oracle.match(re);
      if (m) {
        const buff = parseBuffSegment(m[1]);
        if (buff) {
          for (const perm of state.battlefield) {
            if (isCreature(perm) && isColor(perm, colorWord)) {
              const agg = perPermanent.get(perm.id)!;
              agg.pDelta += buff.p;
              agg.tDelta += buff.t;
            }
          }
        }
      }
    }

    // Creatures you control get +X/+Y (and maybe abilities)
    const ctrlBuffMatches = oracle.match(/creatures you control get (\+\d+\s*\/\s*\+\d+)([^.]*)/);
    if (ctrlBuffMatches) {
      const buffSeg = ctrlBuffMatches[1];
      const tail = ctrlBuffMatches[2];
      const buff = parseBuffSegment(buffSeg);
      if (buff) {
        for (const perm of state.battlefield) {
          if (perm.controller === controller && isCreature(perm)) {
            const agg = perPermanent.get(perm.id)!;
            agg.pDelta += buff.p;
            agg.tDelta += buff.t;
          }
        }
      }
      // Abilities in tail
      const abilities = parseAbilities(tail);
      if (abilities.length) {
        for (const perm of state.battlefield) {
          if (perm.controller === controller && isCreature(perm)) {
            const agg = perPermanent.get(perm.id)!;
            for (const a of abilities) agg.abilities.add(a);
          }
        }
      }
    }

    // "Other creatures you control have <abilities>" (e.g., Shalai for OTHER creatures)
    // Must check before "creatures you control have" to handle "other" correctly
    const otherCtrlHaveMatch = oracle.match(/other creatures you control have ([^.]+)/);
    if (otherCtrlHaveMatch) {
      const abilities = parseAbilities(otherCtrlHaveMatch[1]);
      if (abilities.length) {
        for (const perm of state.battlefield) {
          // "other" means exclude the source permanent itself
          if (perm.controller === controller && isCreature(perm) && perm.id !== source.id) {
            const agg = perPermanent.get(perm.id)!;
            for (const a of abilities) agg.abilities.add(a);
          }
        }
      }
    }
    
    // "You and other creatures you control have <abilities>" (Shalai, Voice of Plenty pattern)
    // This gives the player hexproof AND other creatures hexproof, but NOT the source creature
    const youAndOtherMatch = oracle.match(/you and other creatures you control have ([^.]+)/);
    if (youAndOtherMatch) {
      const abilities = parseAbilities(youAndOtherMatch[1]);
      if (abilities.length) {
        // Grant abilities to OTHER creatures (not the source)
        for (const perm of state.battlefield) {
          if (perm.controller === controller && isCreature(perm) && perm.id !== source.id) {
            const agg = perPermanent.get(perm.id)!;
            for (const a of abilities) agg.abilities.add(a);
          }
        }
        // Grant player hexproof/shroud if those abilities are in the list
        if (abilities.includes('hexproof')) playerHexproof.add(controller);
        if (abilities.includes('shroud')) playerShroud.add(controller);
      }
    }
    
    // "You and permanents you control have <abilities>" (broader pattern)
    const youAndPermsMatch = oracle.match(/you and permanents you control have ([^.]+)/);
    if (youAndPermsMatch) {
      const abilities = parseAbilities(youAndPermsMatch[1]);
      if (abilities.length) {
        // Grant abilities to ALL permanents (not just creatures), excluding self if "other" was in text
        const excludeSelf = oracle.includes('other permanents');
        for (const perm of state.battlefield) {
          if (perm.controller === controller && (!excludeSelf || perm.id !== source.id)) {
            // Only add to perPermanent if it's a creature (since perPermanent only tracks creatures)
            if (isCreature(perm)) {
              const agg = perPermanent.get(perm.id)!;
              for (const a of abilities) agg.abilities.add(a);
            }
          }
        }
        // Grant player hexproof/shroud if those abilities are in the list
        if (abilities.includes('hexproof')) playerHexproof.add(controller);
        if (abilities.includes('shroud')) playerShroud.add(controller);
      }
    }

    // Creatures you control have <abilities> (but NOT if it matches "other creatures" already handled above)
    // Only match if the text doesn't say "other creatures"
    if (!otherCtrlHaveMatch && !youAndOtherMatch) {
      const ctrlHaveMatch = oracle.match(/creatures you control have ([^.]+)/);
      if (ctrlHaveMatch) {
        const abilities = parseAbilities(ctrlHaveMatch[1]);
        if (abilities.length) {
          for (const perm of state.battlefield) {
            if (perm.controller === controller && isCreature(perm)) {
              const agg = perPermanent.get(perm.id)!;
              for (const a of abilities) agg.abilities.add(a);
            }
          }
        }
      }
    }

    // ============================================
    // ALL PERMANENTS ABILITY GRANTS (Avacyn, etc.)
    // ============================================
    // Pattern: "Other permanents you control have <abilities>" (Avacyn, Angel of Hope)
    // This grants abilities to ALL permanents (not just creatures), excluding the source
    const otherPermsHaveMatch = oracle.match(/other permanents you control have ([^.]+)/);
    if (otherPermsHaveMatch) {
      const abilities = parseAbilities(otherPermsHaveMatch[1]);
      if (abilities.length) {
        for (const perm of state.battlefield) {
          // "other" means exclude the source permanent itself
          if (perm.controller === controller && perm.id !== source.id) {
            // Add to permanentAbilities map for ALL permanents
            const permAbilities = permanentAbilities.get(perm.id);
            if (permAbilities) {
              for (const a of abilities) permAbilities.add(a);
            }
            // Also add to creature-specific tracking if applicable
            if (isCreature(perm)) {
              const agg = perPermanent.get(perm.id);
              if (agg) {
                for (const a of abilities) agg.abilities.add(a);
              }
            }
          }
        }
      }
    }
    
    // Pattern: "Permanents you control have <abilities>" (without "other")
    // This grants abilities to ALL permanents including the source
    if (!otherPermsHaveMatch) {
      const permsHaveMatch = oracle.match(/permanents you control have ([^.]+)/);
      if (permsHaveMatch && !oracle.includes('other permanents')) {
        const abilities = parseAbilities(permsHaveMatch[1]);
        if (abilities.length) {
          for (const perm of state.battlefield) {
            if (perm.controller === controller) {
              // Add to permanentAbilities map for ALL permanents
              const permAbilities = permanentAbilities.get(perm.id);
              if (permAbilities) {
                for (const a of abilities) permAbilities.add(a);
              }
              // Also add to creature-specific tracking if applicable
              if (isCreature(perm)) {
                const agg = perPermanent.get(perm.id);
                if (agg) {
                  for (const a of abilities) agg.abilities.add(a);
                }
              }
            }
          }
        }
      }
    }
    
    // ============================================
    // CONDITIONAL INDESTRUCTIBLE (Svyelun, etc.)
    // ============================================
    // Pattern: "[Card] has indestructible as long as you control at least X other [TYPE]"
    // Examples: 
    // - Svyelun of Sea and Sky: "Svyelun has indestructible as long as you control at least two other Merfolk."
    const conditionalIndestructibleMatch = oracle.match(/has indestructible as long as you control at least (\w+) other (\w+)/i);
    if (conditionalIndestructibleMatch) {
      const countWord = conditionalIndestructibleMatch[1].toLowerCase();
      const requiredType = conditionalIndestructibleMatch[2].toLowerCase();
      
      // Convert word to number (common number words for MTG card text)
      const countMap: Record<string, number> = {
        'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 
        'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
        'a': 1, 'an': 1
      };
      // Try number word first, then numeric parsing, log warning if neither works
      const parsedFromWord = countMap[countWord];
      const parsedFromInt = parseInt(countWord, 10);
      const requiredCount = parsedFromWord ?? (isNaN(parsedFromInt) ? undefined : parsedFromInt);
      
      if (requiredCount === undefined) {
        // Skip this effect if we couldn't parse the count - better than silent wrong behavior
        continue;
      }
      
      // Count other permanents of the required type controlled by this player
      let typeCount = 0;
      for (const perm of state.battlefield) {
        if (perm.controller === controller && perm.id !== source.id) {
          const tl = ((perm.card as any)?.type_line || '').toLowerCase();
          if (tl.includes(requiredType)) {
            typeCount++;
          }
        }
      }
      
      // If condition is met, grant indestructible to the source
      if (typeCount >= requiredCount) {
        const permAbilities = permanentAbilities.get(source.id);
        if (permAbilities) {
          permAbilities.add('indestructible');
        }
        if (isCreature(source)) {
          const agg = perPermanent.get(source.id);
          if (agg) {
            agg.abilities.add('indestructible');
          }
        }
      }
    }

    // Specific pattern: Eldrazi Monument style "creatures you control get +1/+1 and have flying and indestructible"
    const monumentMatch = oracle.match(/creatures you control get (\+\d+\s*\/\s*\+\d+)\s+and have\s+([^.]+)/);
    if (monumentMatch) {
      const buff = parseBuffSegment(monumentMatch[1]);
      const abilities = parseAbilities(monumentMatch[2]);
      if (buff) {
        for (const perm of state.battlefield) {
          if (perm.controller === controller && isCreature(perm)) {
            const agg = perPermanent.get(perm.id)!;
            agg.pDelta += buff.p;
            agg.tDelta += buff.t;
            for (const a of abilities) agg.abilities.add(a);
          }
        }
      }
    }
    
    // ============================================
    // CREATURE TYPE LORD EFFECTS
    // ============================================
    // Pattern: "Other [TYPE]s (you control) get +X/+Y"
    // Examples: Valiant Veteran ("Other Soldiers you control get +1/+1")
    //           Lord of Atlantis ("Other Merfolk get +1/+1 and have islandwalk") - GLOBAL effect
    //           Goblin King ("Other Goblins get +1/+1 and have mountainwalk") - GLOBAL effect
    //           Field Marshal ("Other Soldier creatures get +1/+1 and have first strike.") - GLOBAL effect
    //           Death Baron ("Skeletons you control and other Zombies you control get +1/+1 and have deathtouch")
    //           Elvish Archdruid ("Other Elf creatures you control get +1/+1")
    
    // First, check for "Other [TYPE]s you control get +X/+Y" pattern
    for (const creatureType of CREATURE_TYPES) {
      // Pattern 1a: "Other [TYPE](s) (creatures) you control get +X/+Y" (controller-only lord)
      // Pattern 1b: "Other [TYPE](s) (creatures) get +X/+Y" (GLOBAL lord - no "you control")
      // 
      // The key difference is:
      // - If "you control" is present: only affects controller's creatures
      // - If "you control" is absent: affects ALL creatures of that type (global effect)
      //
      // Examples:
      //   - Field Marshal: "Other Soldier creatures get +1/+1 and have first strike" (GLOBAL)
      //   - Lord of Atlantis: "Other Merfolk get +1/+1 and have islandwalk" (GLOBAL)
      //   - Valiant Veteran: "Other Soldiers you control get +1/+1" (controller only)
      
      const otherTypeBuffPattern = new RegExp(
        `other\\s+${creatureType}s?\\s+(?:creatures?\\s+)?(?:(you\\s+control)\\s+)?get\\s+(\\+\\d+\\s*/\\s*\\+\\d+)([^.]*)`,
        'i'
      );
      const otherTypeMatch = oracle.match(otherTypeBuffPattern);
      if (otherTypeMatch) {
        const hasYouControl = !!otherTypeMatch[1]; // Check if "you control" was captured
        const buff = parseBuffSegment(otherTypeMatch[2]);
        if (buff) {
          for (const perm of state.battlefield) {
            // "Other" means exclude source, must be the creature type
            // If "you control" is present, restrict to controller's creatures
            // If "you control" is absent, this is a GLOBAL effect affecting ALL creatures of that type
            const matchesController = hasYouControl ? (perm.controller === controller) : true;
            
            if (matchesController && 
                isCreature(perm) && 
                perm.id !== source.id && 
                hasCreatureType(perm, creatureType)) {
              const agg = perPermanent.get(perm.id)!;
              agg.pDelta += buff.p;
              agg.tDelta += buff.t;
              // Check for abilities in the tail text (e.g., "and have first strike")
              const tail = otherTypeMatch[3] || '';
              const abilities = parseAbilities(tail);
              for (const a of abilities) agg.abilities.add(a);
            }
          }
        }
      }
      
      // Pattern 2: "[TYPE](s) (creatures) you control get +X/+Y" (affects all including self)
      const typeBuffPattern = new RegExp(
        `(?<!other\\s+)${creatureType}s?\\s+(?:creatures?\\s+)?you\\s+control\\s+get\\s+(\\+\\d+\\s*/\\s*\\+\\d+)([^.]*)`,
        'i'
      );
      const typeMatch = oracle.match(typeBuffPattern);
      if (typeMatch && !otherTypeMatch) { // Don't double-apply if already matched "other"
        const buff = parseBuffSegment(typeMatch[1]);
        if (buff) {
          for (const perm of state.battlefield) {
            if (perm.controller === controller && 
                isCreature(perm) && 
                hasCreatureType(perm, creatureType)) {
              const agg = perPermanent.get(perm.id)!;
              agg.pDelta += buff.p;
              agg.tDelta += buff.t;
              // Check for abilities in the tail text
              const tail = typeMatch[2] || '';
              const abilities = parseAbilities(tail);
              for (const a of abilities) agg.abilities.add(a);
            }
          }
        }
      }
      
      // Pattern 3: "Other [TYPE] creatures you control have [ABILITIES]"
      const otherTypeAbilitiesPattern = new RegExp(
        `other\\s+${creatureType}\\s+creatures?\\s+you\\s+control\\s+have\\s+([^.]+)`,
        'i'
      );
      const otherTypeAbilitiesMatch = oracle.match(otherTypeAbilitiesPattern);
      if (otherTypeAbilitiesMatch) {
        const abilities = parseAbilities(otherTypeAbilitiesMatch[1]);
        for (const perm of state.battlefield) {
          if (perm.controller === controller && 
              isCreature(perm) && 
              perm.id !== source.id && 
              hasCreatureType(perm, creatureType)) {
            const agg = perPermanent.get(perm.id)!;
            for (const a of abilities) agg.abilities.add(a);
          }
        }
      }
      
      // Pattern 4: "Other [TYPE] creatures have [ABILITIES]" (GLOBAL ability grant - no "you control")
      // Example: If a card said "Other Soldier creatures have first strike" (affects all players)
      // This pattern should NOT match if "you control" is present
      const otherTypeGlobalAbilitiesPattern = new RegExp(
        `other\\s+${creatureType}\\s+creatures?\\s+have\\s+([^.]+)`,
        'i'
      );
      const otherTypeGlobalAbilitiesMatch = oracle.match(otherTypeGlobalAbilitiesPattern);
      // Only process if:
      // 1. We matched the pattern
      // 2. The "you control" pattern did NOT match (already handled above)
      // 3. The oracle text doesn't contain "you control" for this type (double-check)
      const hasYouControlAbilities = oracle.match(new RegExp(`other\\s+${creatureType}\\s+creatures?\\s+you\\s+control\\s+have`, 'i'));
      if (otherTypeGlobalAbilitiesMatch && !otherTypeAbilitiesMatch && !hasYouControlAbilities) {
        const abilities = parseAbilities(otherTypeGlobalAbilitiesMatch[1]);
        for (const perm of state.battlefield) {
          // Global effect - affects ALL creatures of the type, not just controller's
          if (isCreature(perm) && 
              perm.id !== source.id && 
              hasCreatureType(perm, creatureType)) {
            const agg = perPermanent.get(perm.id)!;
            for (const a of abilities) agg.abilities.add(a);
          }
        }
      }
    }
  }

  // Detect global type-changing effects like Enchanted Evening and Mycosynth Lattice
  const typeAdditions = new Map<string, string[]>();
  
  for (const source of state.battlefield) {
    const cardName = ((source.card as any)?.name || '').toLowerCase();
    
    // Check known global type-addition cards
    for (const [knownName, effect] of Object.entries(GLOBAL_TYPE_ADDITIONS)) {
      if (cardName.includes(knownName) && effect.affectsAll) {
        // Add this type to ALL permanents
        for (const perm of state.battlefield) {
          const existingTypes = typeAdditions.get(perm.id) || [];
          if (!existingTypes.includes(effect.addsType)) {
            existingTypes.push(effect.addsType);
            typeAdditions.set(perm.id, existingTypes);
          }
        }
      }
    }
    
    // Dynamic detection: "All permanents are [type] in addition to their other types"
    const oracle = ((source.card as any)?.oracle_text || '').toLowerCase();
    const allPermsMatch = oracle.match(/all permanents are (\w+)s? in addition to their other types/i);
    if (allPermsMatch) {
      const addedType = allPermsMatch[1].charAt(0).toUpperCase() + allPermsMatch[1].slice(1);
      for (const perm of state.battlefield) {
        const existingTypes = typeAdditions.get(perm.id) || [];
        if (!existingTypes.includes(addedType)) {
          existingTypes.push(addedType);
          typeAdditions.set(perm.id, existingTypes);
        }
      }
    }
  }

  return { perPermanent, playerHexproof, playerShroud, typeAdditions, permanentAbilities };
}