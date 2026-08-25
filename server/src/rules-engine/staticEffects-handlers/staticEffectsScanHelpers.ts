// server/src/rules-engine/staticEffects-handlers/staticEffectsScanHelpers.ts
// Origin parent: server/src/rules-engine/staticEffects.ts
// Cluster moved: COLOR_WORDS through CREATURE_TYPES, including EffectAggregate
//   and ContinuousEffectResult. Public ContinuousEffectResult stays re-exported
//   from staticEffects.ts.
// Public entry symbols: COLOR_WORDS, parseCardCountWord, parseBuffSegment,
//   resolveGrantedAbilities, isCreature, isLegendaryCreature, isColor,
//   creatureHasManaColor, hasCreatureType, countOtherCreaturesSharingType,
//   permanentCountsForControlTypeCondition, CREATURE_TYPES, GLOBAL_TYPE_ADDITIONS,
//   EffectAggregate, ContinuousEffectResult.

import type { BattlefieldPermanent, PlayerID } from '../../../../shared/src';
import { cardHasCreatureType } from '../../../../shared/src/creatureTypes.js';
import { sanitizeOracleTextForStaticEffectScan } from '../../../../rules-engine/src/staticEffectOracleSanitize.js';
import { printedObjectHasManaColor } from '../../state/modules/printedColorSymbols.js';

export const COLOR_WORDS = ['white', 'blue', 'black', 'red', 'green'];
const ABILITIES = [
  'flying', 'indestructible', 'vigilance', 'trample', 'hexproof', 'shroud',
  'deathtouch', 'lifelink', 'haste', 'menace', 'reach', 'first strike', 
  'double strike', 'protection', 'ward', 'wither', 'infect'
];

const SMALL_NUMBER_WORDS: Record<string, number> = {
  'one': 1,
  'two': 2,
  'three': 3,
  'four': 4,
  'five': 5,
  'six': 6,
  'seven': 7,
  'eight': 8,
  'nine': 9,
  'ten': 10,
  'a': 1,
  'an': 1,
};

export function parseCardCountWord(raw: string): number | undefined {
  const lower = String(raw || '').toLowerCase();
  if (SMALL_NUMBER_WORDS[lower] !== undefined) {
    return SMALL_NUMBER_WORDS[lower];
  }
  const parsed = parseInt(lower, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export interface EffectAggregate {
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
  /** Color additions (WUBRG) from continuous effects like Painter's Servant / Alloy Golem. */
  colorAdditions: Map<string, string[]>;
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
export const GLOBAL_TYPE_ADDITIONS: Record<string, { 
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


export function parseBuffSegment(seg: string): { p: number; t: number } | null {
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

function stripCommanderGrantedAbilityQuotes(text: string): string {
  return sanitizeOracleTextForStaticEffectScan(text);
}

export function resolveGrantedAbilities(source: BattlefieldPermanent, text: string): string[] {
  const lowerText = String(text || '').toLowerCase();
  if (!lowerText.includes('abilities of your choice among')) {
    const granted = parseAbilities(stripCommanderGrantedAbilityQuotes(text));
    if (/\{t\}:\s*add\s+one\s+mana\s+of\s+any\s+color/i.test(lowerText)) {
      granted.push('tap_for_any_color');
    }
    if (/\{t\}:\s*add\s+\{g\}/i.test(lowerText)) {
      granted.push('tap_for_green');
    }
    return [...new Set(granted)];
  }

  const chosenValues = Array.isArray((source as any)?.chosenOptions)
    ? (source as any).chosenOptions
    : [((source as any)?.chosenOption ?? '')];

  return chosenValues
    .map((value: any) => String(value || '').trim().toLowerCase())
    .filter((value: string) => value.length > 0)
    .filter((value: string) => ABILITIES.includes(value));
}

export function isCreature(permanent: BattlefieldPermanent): boolean {
  const tl = ((permanent.card as any)?.type_line || '').toLowerCase();
  return /\bcreature\b/.test(tl);
}

export function isLegendaryCreature(permanent: BattlefieldPermanent): boolean {
  const tl = ((permanent.card as any)?.type_line || '').toLowerCase();
  return /\blegendary\b/.test(tl) && isCreature(permanent);
}

export function isColor(creature: BattlefieldPermanent, colorWord: string): boolean {
  // Very naive: checks oracle text or type line for color word; a robust system would parse card color identity.
  const tl = ((creature.card as any)?.type_line || '').toLowerCase();
  return tl.includes(colorWord.toLowerCase());
}

export function creatureHasManaColor(creature: BattlefieldPermanent, colorName: string): boolean {
  return printedObjectHasManaColor(creature, colorName);
}

/**
 * Check if a creature has a specific creature type (e.g., "Soldier", "Goblin")
 * Handles changeling / "every creature type" via shared helper.
 */
export function hasCreatureType(permanent: BattlefieldPermanent, creatureType: string): boolean {
  return cardHasCreatureType(
    (permanent.card as any)?.type_line,
    (permanent.card as any)?.oracle_text || (permanent.card as any)?.oracleText,
    creatureType,
  );
}

function getCreatureSubtypeWords(permanent: BattlefieldPermanent): string[] {
  const typeLine = String((permanent.card as any)?.type_line || '').toLowerCase();
  const dashSplit = typeLine.split(/—|\s-\s/);
  const subtypePart = dashSplit.length > 1 ? dashSplit.slice(1).join(' ') : '';
  return subtypePart
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9-]/g, '').trim())
    .filter(Boolean);
}

function creaturesShareCreatureType(
  left: BattlefieldPermanent,
  right: BattlefieldPermanent,
): boolean {
  const leftTypes = getCreatureSubtypeWords(left);
  const rightTypes = getCreatureSubtypeWords(right);
  if (leftTypes.length === 0 || rightTypes.length === 0) return false;
  return leftTypes.some((type) => rightTypes.includes(type));
}

export function countOtherCreaturesSharingType(
  creature: BattlefieldPermanent,
  battlefield: readonly BattlefieldPermanent[],
): number {
  let count = 0;
  for (const other of battlefield) {
    if (!isCreature(other) || other.id === creature.id) continue;
    if (creaturesShareCreatureType(creature, other)) count += 1;
  }
  return count;
}

/**
 * Count permanents for "control at least N other [TYPE]" conditions.
 * Uses printed subtypes (creature/kindred/tribal) — not ETB chosen types on lands.
 */
export function permanentCountsForControlTypeCondition(
  permanent: BattlefieldPermanent,
  requiredType: string,
  creaturesOnly: boolean,
): boolean {
  const typeLine = String((permanent.card as any)?.type_line || '');
  const oracleText = String((permanent.card as any)?.oracle_text || '');

  if (!cardHasCreatureType(typeLine, oracleText, requiredType)) {
    return false;
  }

  if (creaturesOnly) {
    return /\bcreature\b/i.test(typeLine);
  }

  return true;
}

// List of common creature types for pattern matching
export const CREATURE_TYPES = [
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

