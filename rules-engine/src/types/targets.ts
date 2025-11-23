/**
 * Rule 115: Targets
 * Type definitions for targeting in spells and abilities
 */

import { ObjectID, ControllerID, Zone } from './objects';

/**
 * Rule 115.1 - Targets are objects/players a spell/ability will affect
 * Declared when putting spell/ability on stack
 */
export interface Target {
  readonly id: ObjectID | ControllerID; // Object or player ID
  readonly type: TargetType;
  readonly zone?: Zone; // Where the target is expected to be
  readonly isLegal: boolean; // Whether target is currently legal
  readonly wasLegalOnSelection: boolean; // Whether target was legal when chosen
}

/**
 * Types of targets
 */
export enum TargetType {
  PERMANENT = 'permanent',        // Rule 115.2 - Default for most targets
  PLAYER = 'player',             // Can target players
  SPELL = 'spell',               // Can target spells on stack
  CARD = 'card',                 // Card in specific zone
  CREATURE = 'creature',         // Specific permanent type
  PLANESWALKER = 'planeswalker', // Rule 115.4 - "any target"
  BATTLE = 'battle',             // Rule 115.4 - "any target"
  ANY_TARGET = 'any_target'      // Rule 115.4 - creature, player, planeswalker, or battle
}

/**
 * Rule 115.1a-d - Different targeting contexts
 */
export enum TargetingContext {
  INSTANT_SORCERY_SPELL = 'instant_sorcery_spell',     // 115.1a
  AURA_SPELL = 'aura_spell',                           // 115.1b
  ACTIVATED_ABILITY = 'activated_ability',              // 115.1c
  TRIGGERED_ABILITY = 'triggered_ability'               // 115.1d
}

/**
 * Targeting requirements for a spell or ability
 */
export interface TargetRequirement {
  readonly minTargets: number;  // Minimum number of targets
  readonly maxTargets: number;  // Maximum number of targets
  readonly targetTypes: TargetType[];  // Valid target types
  readonly restrictions?: TargetRestriction[];  // Additional restrictions
  readonly allowZeroTargets?: boolean;  // Rule 115.6 - May allow zero targets
}

/**
 * Restrictions on what can be targeted
 */
export interface TargetRestriction {
  readonly type: 'color' | 'cardType' | 'subtype' | 'controller' | 'power' | 'toughness' | 'other';
  readonly description: string;
  // Examples:
  // - "target creature you control"
  // - "target red permanent"
  // - "target creature with flying"
  // - "target creature with power 2 or less"
}

/**
 * Rule 115.2 - Only permanents are legal targets by default
 * Unless spell/ability specifies it can target other zones or players
 */
export function isLegalTargetByDefault(type: TargetType, zone: Zone): boolean {
  if (type === TargetType.PLAYER) {
    return true; // Players are always targetable
  }
  if (type === TargetType.SPELL) {
    return zone === Zone.STACK; // Spells only exist on stack
  }
  if (type === TargetType.CARD) {
    return true; // Cards can be in any zone if spell specifies
  }
  // Permanents must be on battlefield
  return zone === Zone.BATTLEFIELD;
}

/**
 * Rule 115.3 - Same target can't be chosen multiple times for one instance of "target"
 * But can be chosen for different instances
 */
export function canChooseTargetMultipleTimes(
  targetId: ObjectID | ControllerID,
  currentTargets: Target[],
  instanceIndex: number
): boolean {
  // Same target can be chosen for different instances of "target" keyword
  // but not for the same instance
  return !currentTargets.some(
    t => t.id === targetId && 
    // This would need instance tracking in actual implementation
    true
  );
}

/**
 * Rule 115.4 - "Any target" means creature, player, planeswalker, or battle
 */
export function isValidAnyTarget(type: TargetType): boolean {
  return type === TargetType.CREATURE ||
         type === TargetType.PLAYER ||
         type === TargetType.PLANESWALKER ||
         type === TargetType.BATTLE;
}

/**
 * Rule 115.5 - Spell/ability on stack is illegal target for itself
 */
export function canTargetItself(spellId: ObjectID, targetId: ObjectID): boolean {
  return spellId !== targetId;
}

/**
 * Rule 115.7 - Changing or choosing new targets
 */
export interface TargetChange {
  readonly type: 'change' | 'changeOne' | 'changeAny' | 'chooseNew';
  readonly originalTargets: Target[];
  readonly newTargets: Target[];
}

/**
 * Rule 115.7a - Change the target(s)
 * Each target can be changed only to another legal target
 * If can't change all targets, none are changed
 */
export function changeTargets(
  originalTargets: readonly Target[],
  newTargetIds: readonly (ObjectID | ControllerID)[]
): Target[] | null {
  // All targets must be changeable to legal targets
  if (newTargetIds.length !== originalTargets.length) {
    return null; // Must change all or none
  }
  
  // Validate all new targets are legal
  // In real implementation, would check target legality
  const newTargets: Target[] = newTargetIds.map((id, index) => ({
    ...originalTargets[index],
    id,
    isLegal: true, // Would validate in real implementation
    wasLegalOnSelection: true
  }));
  
  return newTargets;
}

/**
 * Rule 115.7b - Change a target (singular)
 * Only one target may be changed
 */
export function changeOneTarget(
  originalTargets: readonly Target[],
  targetIndex: number,
  newTargetId: ObjectID | ControllerID
): Target[] | null {
  if (targetIndex < 0 || targetIndex >= originalTargets.length) {
    return null;
  }
  
  const newTargets = [...originalTargets];
  newTargets[targetIndex] = {
    ...newTargets[targetIndex],
    id: newTargetId,
    isLegal: true,
    wasLegalOnSelection: true
  };
  
  return newTargets;
}

/**
 * Rule 115.7d - Choose new targets
 * May leave any number unchanged, even if illegal
 * New targets must be legal and not make unchanged targets illegal
 */
export function chooseNewTargets(
  originalTargets: readonly Target[],
  changesToMake: Map<number, ObjectID | ControllerID>
): Target[] {
  const newTargets = [...originalTargets];
  
  changesToMake.forEach((newTargetId, index) => {
    if (index >= 0 && index < newTargets.length) {
      newTargets[index] = {
        ...newTargets[index],
        id: newTargetId,
        isLegal: true,
        wasLegalOnSelection: true
      };
    }
  });
  
  return newTargets;
}

/**
 * Rule 115.9 - Checking what another spell/ability is targeting
 */
export interface TargetCheck {
  readonly checkCurrentState: boolean;  // Check current state of targets
  readonly checkSelectionState: boolean;  // Check state when selected
  readonly countingTargets: boolean;  // Count number of targets selected
}

/**
 * Rule 115.10 - Objects/players affected but not targeted
 * "target" keyword must appear in text or rule
 */
export function isTargeted(abilityText: string): boolean {
  return /\btarget\b/i.test(abilityText);
}

/**
 * Rule 115.10b - "you" doesn't indicate a target
 */
export function doesYouIndicateTarget(): boolean {
  return false;
}
