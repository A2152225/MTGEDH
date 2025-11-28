/**
 * tribalSupport.ts
 * 
 * Support for tribal mechanics and creature type-based effects.
 * Includes support for effects like Kindred Discovery, Deeproot Waters,
 * and general tribal casting bonuses.
 * 
 * Rules Reference:
 * - Rule 205.3m: Creature types list
 * - Rule 702.73: Changeling (has all creature types)
 * - Rule 308.2k: Kindred (formerly Tribal) card type
 */

import type { PlayerID, BattlefieldPermanent, KnownCardRef } from '../../shared/src';
import { CREATURE_TYPES, cardHasCreatureType, extractCreatureTypes } from '../../shared/src/creatureTypes';

/**
 * Tribal trigger types
 */
export enum TribalTriggerType {
  CAST_CREATURE = 'cast_creature',
  ENTERS_BATTLEFIELD = 'enters_battlefield',
  DIES = 'dies',
  ATTACKS = 'attacks',
  DEALS_DAMAGE = 'deals_damage',
  TAP = 'tap',
}

/**
 * Tribal effect definition
 */
export interface TribalEffect {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly controllerId: PlayerID;
  readonly creatureType: string;
  readonly triggerType: TribalTriggerType;
  readonly effect: string;
  readonly isTriggered: boolean;
  readonly requiresChoice?: boolean;
  readonly choiceType?: 'target' | 'may' | 'choice';
}

/**
 * Tribal trigger event
 */
export interface TribalTriggerEvent {
  readonly effect: TribalEffect;
  readonly triggeredByPermanentId?: string;
  readonly triggeredByPermanentName?: string;
  readonly triggeredByCreatureTypes: readonly string[];
}

/**
 * Check if a card/permanent is a changeling
 * Rule 702.73: Changeling means "This object is every creature type."
 */
export function hasChangeling(
  oracleText: string | undefined | null,
  typeLine: string | undefined | null
): boolean {
  const textLower = (oracleText || '').toLowerCase();
  const typeLower = (typeLine || '').toLowerCase();
  
  return textLower.includes('changeling') || 
         typeLower.includes('changeling') ||
         textLower.includes('is every creature type') ||
         textLower.includes('all creature types');
}

/**
 * Get all creature types for a card (including changeling handling)
 */
export function getAllCreatureTypes(
  typeLine: string | undefined | null,
  oracleText: string | undefined | null
): readonly string[] {
  if (hasChangeling(oracleText, typeLine)) {
    return CREATURE_TYPES;
  }
  
  return extractCreatureTypes(typeLine, oracleText);
}

/**
 * Check if a permanent qualifies for a tribal effect
 */
export function permanentQualifiesForTribal(
  permanent: BattlefieldPermanent,
  requiredType: string
): boolean {
  const card = permanent.card as KnownCardRef;
  if (!card) return false;
  
  // Check changeling first
  if (hasChangeling(card.oracle_text, card.type_line)) {
    return true;
  }
  
  // Check specific creature type
  return cardHasCreatureType(card.type_line, card.oracle_text, requiredType);
}

/**
 * Count creatures of a specific type controlled by a player
 */
export function countCreaturesOfType(
  battlefield: readonly BattlefieldPermanent[],
  controllerId: PlayerID,
  creatureType: string
): number {
  return battlefield.filter(perm => {
    if (perm.controller !== controllerId) return false;
    
    const card = perm.card as KnownCardRef;
    if (!card?.type_line?.toLowerCase().includes('creature')) return false;
    
    return permanentQualifiesForTribal(perm, creatureType);
  }).length;
}

/**
 * Find all creatures of a specific type controlled by a player
 */
export function findCreaturesOfType(
  battlefield: readonly BattlefieldPermanent[],
  controllerId: PlayerID,
  creatureType: string
): readonly BattlefieldPermanent[] {
  return battlefield.filter(perm => {
    if (perm.controller !== controllerId) return false;
    
    const card = perm.card as KnownCardRef;
    if (!card?.type_line?.toLowerCase().includes('creature')) return false;
    
    return permanentQualifiesForTribal(perm, creatureType);
  });
}

/**
 * Detect tribal triggers from a cast spell
 */
export function detectCastTribalTriggers(
  spellTypes: readonly string[],
  spellOracleText: string | undefined | null,
  spellTypeLine: string | undefined | null,
  battlefield: readonly BattlefieldPermanent[]
): readonly TribalTriggerEvent[] {
  const triggers: TribalTriggerEvent[] = [];
  const spellCreatureTypes = getAllCreatureTypes(spellTypeLine, spellOracleText);
  const spellIsCreature = (spellTypeLine || '').toLowerCase().includes('creature');
  
  if (!spellIsCreature || spellCreatureTypes.length === 0) {
    return triggers;
  }
  
  // Check each permanent for tribal triggers
  for (const perm of battlefield) {
    const card = perm.card as KnownCardRef;
    if (!card?.oracle_text) continue;
    
    const oracleText = card.oracle_text.toLowerCase();
    
    // Pattern: "Whenever you cast a [creature type] spell"
    for (const creatureType of spellCreatureTypes) {
      const typeLower = creatureType.toLowerCase();
      
      // Deeproot Waters pattern: "Whenever you cast a Merfolk spell..."
      if (oracleText.includes(`whenever you cast a ${typeLower} spell`) ||
          oracleText.includes(`whenever you cast a ${typeLower} creature`)) {
        
        const effect: TribalEffect = {
          id: `${perm.id}-cast-${typeLower}`,
          sourceId: perm.id,
          sourceName: card.name || 'Unknown',
          controllerId: perm.controller,
          creatureType,
          triggerType: TribalTriggerType.CAST_CREATURE,
          effect: extractEffectFromOracleText(card.oracle_text, `whenever you cast a ${typeLower}`),
          isTriggered: true,
          requiresChoice: oracleText.includes('target') || oracleText.includes('may'),
          choiceType: oracleText.includes('target') ? 'target' : (oracleText.includes('may') ? 'may' : undefined),
        };
        
        triggers.push({
          effect,
          triggeredByCreatureTypes: spellCreatureTypes,
        });
      }
      
      // Kindred Discovery pattern: "Whenever a [creature type] enters the battlefield..."
      // (This would be an ETB trigger, not cast trigger, but included for reference)
    }
  }
  
  return triggers;
}

/**
 * Detect tribal triggers from a creature entering the battlefield
 */
export function detectETBTribalTriggers(
  enteringPermanent: BattlefieldPermanent,
  battlefield: readonly BattlefieldPermanent[]
): readonly TribalTriggerEvent[] {
  const triggers: TribalTriggerEvent[] = [];
  const card = enteringPermanent.card as KnownCardRef;
  
  if (!card?.type_line?.toLowerCase().includes('creature')) {
    return triggers;
  }
  
  const creatureTypes = getAllCreatureTypes(card.type_line, card.oracle_text);
  
  // Check each permanent for tribal ETB triggers
  for (const perm of battlefield) {
    const permCard = perm.card as KnownCardRef;
    if (!permCard?.oracle_text) continue;
    if (perm.id === enteringPermanent.id) continue; // Skip self
    
    const oracleText = permCard.oracle_text.toLowerCase();
    
    for (const creatureType of creatureTypes) {
      const typeLower = creatureType.toLowerCase();
      
      // Kindred Discovery pattern
      if (oracleText.includes(`whenever a ${typeLower} enters the battlefield`) ||
          oracleText.includes(`whenever a ${typeLower} you control enters`)) {
        
        // Check controller requirement
        const youControl = oracleText.includes('you control');
        if (youControl && perm.controller !== enteringPermanent.controller) {
          continue;
        }
        
        const effect: TribalEffect = {
          id: `${perm.id}-etb-${typeLower}`,
          sourceId: perm.id,
          sourceName: permCard.name || 'Unknown',
          controllerId: perm.controller,
          creatureType,
          triggerType: TribalTriggerType.ENTERS_BATTLEFIELD,
          effect: extractEffectFromOracleText(permCard.oracle_text, `whenever a ${typeLower}`),
          isTriggered: true,
          requiresChoice: oracleText.includes('target') || oracleText.includes('may'),
          choiceType: oracleText.includes('target') ? 'target' : (oracleText.includes('may') ? 'may' : undefined),
        };
        
        triggers.push({
          effect,
          triggeredByPermanentId: enteringPermanent.id,
          triggeredByPermanentName: card.name,
          triggeredByCreatureTypes: creatureTypes,
        });
      }
    }
  }
  
  return triggers;
}

/**
 * Extract effect text from oracle text after a trigger condition
 */
function extractEffectFromOracleText(oracleText: string, triggerPattern: string): string {
  const lower = oracleText.toLowerCase();
  const patternIndex = lower.indexOf(triggerPattern);
  
  if (patternIndex === -1) return oracleText;
  
  // Find the comma or period after the trigger condition
  const afterPattern = oracleText.substring(patternIndex + triggerPattern.length);
  const commaIndex = afterPattern.indexOf(',');
  
  if (commaIndex !== -1) {
    // Return everything after the comma, up to the first period
    const effectPart = afterPattern.substring(commaIndex + 1).trim();
    const periodIndex = effectPart.indexOf('.');
    return periodIndex !== -1 ? effectPart.substring(0, periodIndex + 1) : effectPart;
  }
  
  return afterPattern.trim();
}

/**
 * Common tribal effects (for reference)
 */
export const COMMON_TRIBAL_EFFECTS: Record<string, {
  name: string;
  creatureType: string;
  effect: string;
}> = {
  'Deeproot Waters': {
    name: 'Deeproot Waters',
    creatureType: 'Merfolk',
    effect: 'Create a 1/1 blue Merfolk creature token with hexproof.',
  },
  'Kindred Discovery': {
    name: 'Kindred Discovery',
    creatureType: 'chosen', // Player chooses
    effect: 'Draw a card.',
  },
  'Kindred Summons': {
    name: 'Kindred Summons',
    creatureType: 'chosen',
    effect: 'Reveal cards from library until you reveal X creature cards of the chosen type, put them onto the battlefield.',
  },
  'Herald\'s Horn': {
    name: "Herald's Horn",
    creatureType: 'chosen',
    effect: 'At the beginning of your upkeep, look at the top card of your library. If it\'s a creature card of the chosen type, you may reveal it and put it into your hand.',
  },
  'Urza\'s Incubator': {
    name: "Urza's Incubator",
    creatureType: 'chosen',
    effect: 'Creature spells of the chosen type cost {2} less to cast.',
  },
  'Coat of Arms': {
    name: 'Coat of Arms',
    creatureType: 'all',
    effect: 'Each creature gets +1/+1 for each other creature on the battlefield that shares at least one creature type with it.',
  },
  'Vanquisher\'s Banner': {
    name: "Vanquisher's Banner",
    creatureType: 'chosen',
    effect: 'Creatures you control of the chosen type get +1/+1. Whenever you cast a creature spell of the chosen type, draw a card.',
  },
};

/**
 * Parse oracle text to detect if it's a tribal effect
 */
export function detectTribalEffectInText(oracleText: string): {
  isTribal: boolean;
  creatureTypes: readonly string[];
  triggerType?: TribalTriggerType;
} {
  const lower = oracleText.toLowerCase();
  
  // Check for creature type references
  const foundTypes: string[] = [];
  
  for (const type of CREATURE_TYPES) {
    const typeLower = type.toLowerCase();
    
    // Check for patterns like "whenever you cast a [type]" or "[type] creatures"
    if (lower.includes(`cast a ${typeLower}`) ||
        lower.includes(`${typeLower} creatures`) ||
        lower.includes(`${typeLower} you control`) ||
        lower.includes(`a ${typeLower} enters`)) {
      foundTypes.push(type);
    }
  }
  
  if (foundTypes.length === 0) {
    return { isTribal: false, creatureTypes: [] };
  }
  
  // Determine trigger type
  let triggerType: TribalTriggerType | undefined;
  if (lower.includes('whenever you cast')) {
    triggerType = TribalTriggerType.CAST_CREATURE;
  } else if (lower.includes('enters the battlefield')) {
    triggerType = TribalTriggerType.ENTERS_BATTLEFIELD;
  } else if (lower.includes('dies')) {
    triggerType = TribalTriggerType.DIES;
  } else if (lower.includes('attacks')) {
    triggerType = TribalTriggerType.ATTACKS;
  }
  
  return {
    isTribal: true,
    creatureTypes: foundTypes,
    triggerType,
  };
}

/**
 * Banneret-style cost reduction effect
 * Cards like Stonybrook Banneret, Frogtosser Banneret, etc.
 * that reduce the cost of specific creature types by {1}
 */
export interface BanneretCostReduction {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly controllerId: PlayerID;
  readonly creatureTypes: readonly string[];
  readonly reduction: number; // Usually 1 for most Bannerets
  readonly reducesGeneric: boolean; // Whether it reduces generic mana
  readonly reducesColored?: ManaColorReduction; // For effects that reduce specific colors
}

/**
 * Mana color reduction specification
 * For effects like Morophon that reduce specific colors
 */
export interface ManaColorReduction {
  readonly white?: number;
  readonly blue?: number;
  readonly black?: number;
  readonly red?: number;
  readonly green?: number;
}

/**
 * Well-known Banneret cards and their creature type reductions
 */
export const BANNERET_CARDS: Record<string, { types: string[]; reduction: number }> = {
  // Lorwyn/Morningtide Bannerets
  'stonybrook banneret': { types: ['Merfolk', 'Wizard'], reduction: 1 },
  'brighthearth banneret': { types: ['Elemental', 'Warrior'], reduction: 1 },
  'frogtosser banneret': { types: ['Goblin', 'Rogue'], reduction: 1 },
  'bosk banneret': { types: ['Treefolk', 'Shaman'], reduction: 1 },
  'ballyrush banneret': { types: ['Kithkin', 'Soldier'], reduction: 1 },
  
  // Other cost reducers by creature type
  'goblin warchief': { types: ['Goblin'], reduction: 1 },
  'dragonspeaker shaman': { types: ['Dragon'], reduction: 2 },
  'dragonlord\'s servant': { types: ['Dragon'], reduction: 1 },
  'herald of secret streams': { types: ['Merfolk'], reduction: 0 }, // Doesn't reduce cost, included for completeness
  'undead warchief': { types: ['Zombie'], reduction: 1 },
  'semblance anvil': { types: ['imprinted'], reduction: 2 }, // Type depends on imprinted card
  'cloud key': { types: ['chosen'], reduction: 1 }, // Player chooses card type
  'helm of awakening': { types: ['all'], reduction: 1 }, // All spells cost {1} less
  'bontu\'s monument': { types: ['Creature'], reduction: 1 }, // Just black creatures
  'hazoret\'s monument': { types: ['Creature'], reduction: 1 }, // Just red creatures
  'kefnet\'s monument': { types: ['Creature'], reduction: 1 }, // Just blue creatures
  'oketra\'s monument': { types: ['Creature'], reduction: 1 }, // Just white creatures
  'rhonas\'s monument': { types: ['Creature'], reduction: 1 }, // Just green creatures
  'foundry inspector': { types: ['Artifact'], reduction: 1 },
  'etherium sculptor': { types: ['Artifact'], reduction: 1 },
  'jhoira\'s familiar': { types: ['Artifact', 'Historic'], reduction: 1 },
};

/**
 * Create a Banneret-style cost reduction
 */
export function createBanneretReduction(
  sourceId: string,
  sourceName: string,
  controllerId: PlayerID,
  creatureTypes: readonly string[],
  reduction: number = 1
): BanneretCostReduction {
  return {
    sourceId,
    sourceName,
    controllerId,
    creatureTypes,
    reduction,
    reducesGeneric: true,
  };
}

/**
 * Detect Banneret-style cost reduction from oracle text
 * Patterns:
 * - "[Type] spells you cast cost {1} less to cast"
 * - "[Type] and [Type] spells you cast cost {1} less to cast"
 * - "Creature spells of the chosen type you cast cost {1} less to cast"
 */
export function detectBanneretReduction(
  oracleText: string,
  cardName: string
): { types: string[]; reduction: number } | null {
  const lower = oracleText.toLowerCase();
  const nameLower = cardName.toLowerCase();
  
  // Check known Banneret cards first
  const known = BANNERET_CARDS[nameLower];
  if (known) {
    return known;
  }
  
  // Pattern: "[Type] spells you cast cost {X} less to cast"
  // Pattern: "[Type] and [Type] spells cost {X} less to cast"
  // Pattern: "[Type] creatures you cast cost {X} less to cast"
  const patterns = [
    /(\w+(?:\s+and\s+\w+)*)\s+(?:spells|creatures)\s+(?:you\s+cast\s+)?cost\s*\{(\d+)\}\s*less/i,
    /(\w+)\s+creature\s+spells\s+cost\s*\{(\d+)\}\s*less/i,
    /creature\s+spells\s+of\s+the\s+chosen\s+type\s+(?:you\s+cast\s+)?cost\s*\{(\d+)\}\s*less/i,
  ];
  
  for (const pattern of patterns) {
    const match = lower.match(pattern);
    if (match) {
      // Extract types
      const typeStr = match[1];
      const reduction = parseInt(match[2] || match[1], 10) || 1;
      
      if (typeStr) {
        const types = typeStr.split(/\s+and\s+/).map(t => 
          t.charAt(0).toUpperCase() + t.slice(1)
        );
        return { types, reduction };
      }
      
      // "chosen type" placeholder
      return { types: ['chosen'], reduction };
    }
  }
  
  return null;
}

/**
 * Get applicable Banneret cost reductions for a spell being cast
 */
export function getApplicableBanneretReductions(
  battlefield: readonly BattlefieldPermanent[],
  castingPlayerId: PlayerID,
  spellCard: KnownCardRef
): BanneretCostReduction[] {
  const reductions: BanneretCostReduction[] = [];
  const spellTypeLine = (spellCard.type_line || '').toLowerCase();
  const spellTypes = extractCreatureTypes(spellCard.type_line || '');
  const isCreature = spellTypeLine.includes('creature');
  const isArtifact = spellTypeLine.includes('artifact');
  
  for (const permanent of battlefield) {
    // Only check permanents controlled by the casting player
    if (permanent.controller !== castingPlayerId) continue;
    
    const card = permanent.card as KnownCardRef;
    const oracleText = card?.oracle_text || '';
    const cardName = card?.name || '';
    
    const detected = detectBanneretReduction(oracleText, cardName);
    if (!detected) continue;
    
    // Check if the spell qualifies for this reduction
    let applies = false;
    
    for (const type of detected.types) {
      if (type === 'all') {
        applies = true;
        break;
      }
      if (type === 'chosen') {
        // For "chosen type" effects, we'd need to track what was chosen
        // For now, assume it applies if it's a creature
        applies = isCreature;
        break;
      }
      if (type === 'Artifact' && isArtifact) {
        applies = true;
        break;
      }
      if (type === 'Creature' && isCreature) {
        applies = true;
        break;
      }
      if (type === 'Historic' && (isArtifact || spellTypeLine.includes('legendary') || spellTypeLine.includes('saga'))) {
        applies = true;
        break;
      }
      // Check creature subtypes
      if (spellTypes.some(st => st.toLowerCase() === type.toLowerCase())) {
        applies = true;
        break;
      }
      // Check for changeling - if spell has changeling and type is a valid creature type
      if (hasChangeling(card?.oracle_text, card?.type_line) && 
          CREATURE_TYPES.some(ct => ct.toLowerCase() === type.toLowerCase())) {
        applies = true;
        break;
      }
    }
    
    if (applies) {
      reductions.push(createBanneretReduction(
        permanent.id,
        cardName,
        castingPlayerId,
        detected.types,
        detected.reduction
      ));
    }
  }
  
  return reductions;
}

/**
 * Calculate total generic mana reduction from Banneret effects
 */
export function calculateBanneretReduction(
  reductions: readonly BanneretCostReduction[]
): number {
  let total = 0;
  for (const r of reductions) {
    if (r.reducesGeneric) {
      total += r.reduction;
    }
  }
  return total;
}

/**
 * Apply Banneret reductions to a mana cost
 * Returns the reduced cost (minimum 0 for generic)
 */
export function applyBanneretReductions(
  manaCost: { generic?: number; white?: number; blue?: number; black?: number; red?: number; green?: number; colorless?: number },
  reductions: readonly BanneretCostReduction[]
): { generic?: number; white?: number; blue?: number; black?: number; red?: number; green?: number; colorless?: number } {
  const totalReduction = calculateBanneretReduction(reductions);
  
  if (totalReduction === 0) {
    return manaCost;
  }
  
  // Banneret reductions typically reduce generic mana only
  const newGeneric = Math.max(0, (manaCost.generic || 0) - totalReduction);
  
  return {
    ...manaCost,
    generic: newGeneric,
  };
}

export default {
  hasChangeling,
  getAllCreatureTypes,
  permanentQualifiesForTribal,
  countCreaturesOfType,
  findCreaturesOfType,
  detectCastTribalTriggers,
  detectETBTribalTriggers,
  detectTribalEffectInText,
  COMMON_TRIBAL_EFFECTS,
  TribalTriggerType,
  // Banneret support
  createBanneretReduction,
  detectBanneretReduction,
  getApplicableBanneretReductions,
  calculateBanneretReduction,
  applyBanneretReductions,
  BANNERET_CARDS,
};
