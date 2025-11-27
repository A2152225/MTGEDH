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
};
