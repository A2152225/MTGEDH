/**
 * Rule 605: Mana Abilities
 * 
 * Mana abilities are activated or triggered abilities that could add mana to a player's mana pool.
 * Special rules apply: they don't use the stack and can be activated while paying costs.
 * 
 * Based on MagicCompRules 20251114.txt
 */

import type { ManaPool } from './types/mana';
import { ManaType, addMana } from './types/mana';

/**
 * Rule 605.1: Mana ability definition
 * - Activated ability that could add mana
 * - Triggered ability that could add mana and triggers from activating a mana ability
 * - Triggered ability that could add mana and doesn't target
 */
export interface ManaAbility {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly controllerId: string;
  readonly type: 'activated' | 'triggered';
  readonly requiresTap: boolean;
  readonly produces: ManaProduction[];
  readonly additionalCosts?: ManaAbilityCost[];
  readonly restrictions?: ManaRestriction[];
}

/**
 * What mana the ability produces
 */
export interface ManaProduction {
  readonly type: ManaType;
  readonly amount: number;
}

/**
 * Additional costs for mana abilities
 */
export interface ManaAbilityCost {
  readonly type: 'tap' | 'untap' | 'sacrifice' | 'pay_life' | 'other';
  readonly description: string;
}

/**
 * Restrictions on produced mana
 */
export interface ManaRestriction {
  readonly restrictionType: 'spell' | 'ability' | 'cardType' | 'color';
  readonly allowedValues: string[];
  readonly description: string;
}

/**
 * Result of activating a mana ability
 */
export interface ManaAbilityResult {
  readonly success: boolean;
  readonly error?: string;
  readonly manaAdded?: ManaProduction[];
  readonly manaPoolAfter?: ManaPool;
  readonly log?: readonly string[];
}

/**
 * Rule 605.3: Mana abilities don't use the stack
 * They resolve immediately when activated
 */
export function activateManaAbility(
  ability: ManaAbility,
  manaPool: Readonly<ManaPool>,
  context: {
    sourceTapped: boolean;
    sourceOnBattlefield: boolean;
    controllerHasPriority: boolean;
  }
): ManaAbilityResult {
  const logs: string[] = [];
  
  // Validate source is on battlefield (for most mana abilities)
  if (!context.sourceOnBattlefield) {
    return {
      success: false,
      error: 'Source must be on battlefield to activate mana ability',
    };
  }
  
  // Validate tap requirement
  if (ability.requiresTap && context.sourceTapped) {
    return {
      success: false,
      error: 'Source is already tapped',
    };
  }
  
  // Activate the ability and add mana
  let updatedPool = { ...manaPool };
  
  for (const production of ability.produces) {
    updatedPool = addMana(updatedPool, production.type, production.amount);
    logs.push(`Added ${production.amount} ${production.type} mana to pool`);
  }
  
  logs.push(`${ability.sourceName} activated for mana`);
  
  return {
    success: true,
    manaAdded: ability.produces,
    manaPoolAfter: updatedPool,
    log: logs,
  };
}

/**
 * Rule 106.4: Mana pools empty at the end of each step and phase
 */
export function emptyManaPool(): ManaPool {
  return {
    white: 0,
    blue: 0,
    black: 0,
    red: 0,
    green: 0,
    colorless: 0,
  };
}

/**
 * Create a basic land tap ability
 */
export function createBasicLandManaAbility(
  landId: string,
  landName: string,
  controllerId: string,
  manaType: ManaType
): ManaAbility {
  return {
    id: `${landId}-tap-for-mana`,
    sourceId: landId,
    sourceName: landName,
    controllerId,
    type: 'activated',
    requiresTap: true,
    produces: [{ type: manaType, amount: 1 }],
  };
}

/**
 * Rule 605.3b: Player can activate mana ability whenever they have priority
 * OR when they're asked to pay a cost (even if they don't have priority)
 */
export function canActivateManaAbility(
  ability: ManaAbility,
  context: {
    hasPriority: boolean;
    isPayingCost: boolean;
    sourceTapped: boolean;
  }
): { canActivate: boolean; reason?: string } {
  // Can activate if has priority or paying a cost
  if (!context.hasPriority && !context.isPayingCost) {
    return {
      canActivate: false,
      reason: 'No priority and not paying a cost',
    };
  }
  
  // Check if source is tapped (when tap is required)
  if (ability.requiresTap && context.sourceTapped) {
    return {
      canActivate: false,
      reason: 'Source is already tapped',
    };
  }
  
  return { canActivate: true };
}

/**
 * Common mana ability templates for different land types
 */
export const BASIC_LAND_ABILITIES = {
  plains: (landId: string, controllerId: string) =>
    createBasicLandManaAbility(landId, 'Plains', controllerId, ManaType.WHITE),
  
  island: (landId: string, controllerId: string) =>
    createBasicLandManaAbility(landId, 'Island', controllerId, ManaType.BLUE),
  
  swamp: (landId: string, controllerId: string) =>
    createBasicLandManaAbility(landId, 'Swamp', controllerId, ManaType.BLACK),
  
  mountain: (landId: string, controllerId: string) =>
    createBasicLandManaAbility(landId, 'Mountain', controllerId, ManaType.RED),
  
  forest: (landId: string, controllerId: string) =>
    createBasicLandManaAbility(landId, 'Forest', controllerId, ManaType.GREEN),
};

/**
 * Tap a permanent for mana (common operation)
 */
export interface TapForManaContext {
  readonly permanentId: string;
  readonly permanentName: string;
  readonly controllerId: string;
  readonly manaToAdd: ManaProduction[];
  readonly currentlyTapped: boolean;
}

export function tapPermanentForMana(
  context: TapForManaContext,
  manaPool: Readonly<ManaPool>
): ManaAbilityResult {
  if (context.currentlyTapped) {
    return {
      success: false,
      error: `${context.permanentName} is already tapped`,
    };
  }
  
  let updatedPool = { ...manaPool };
  const logs: string[] = [];
  
  for (const production of context.manaToAdd) {
    updatedPool = addMana(updatedPool, production.type, production.amount);
    logs.push(`Added ${production.amount} ${production.type} mana`);
  }
  
  logs.push(`Tapped ${context.permanentName} for mana`);
  
  return {
    success: true,
    manaAdded: context.manaToAdd,
    manaPoolAfter: updatedPool,
    log: logs,
  };
}
