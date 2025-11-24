/**
 * Rule 602: Activating Activated Abilities
 * 
 * Activated abilities follow a process similar to casting spells.
 * Format: [Cost]: [Effect]. [Activation instructions (if any).]
 * 
 * Based on MagicCompRules 20251114.txt
 */

import type { ManaPool, ManaCost } from './types/mana';
import type { Cost } from './types/costs';
import type { StackObject } from './spellCasting';
import { payManaCost } from './spellCasting';

/**
 * Rule 602: Activated ability structure
 */
export interface ActivatedAbility {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly controllerId: string;
  readonly manaCost?: ManaCost;
  readonly additionalCosts?: readonly Cost[];
  readonly effect: string;
  readonly targets?: readonly string[];
  readonly restrictions?: ActivationRestriction[];
  readonly isManaAbility?: boolean;
  readonly isLoyaltyAbility?: boolean;
}

/**
 * Activation restrictions (Rule 602.5)
 */
export interface ActivationRestriction {
  readonly type: 'timing' | 'frequency' | 'condition';
  readonly description: string;
  readonly requiresSorceryTiming?: boolean;
  readonly maxPerTurn?: number;
  readonly requiresCombat?: boolean;
  readonly requiresOwnTurn?: boolean;
}

/**
 * Context for validating activation
 */
export interface ActivationContext {
  readonly hasPriority: boolean;
  readonly isMainPhase: boolean;
  readonly isOwnTurn: boolean;
  readonly stackEmpty: boolean;
  readonly isCombat: boolean;
  readonly activationsThisTurn: number;
  readonly sourceTapped: boolean;
}

/**
 * Result of ability activation
 */
export interface ActivationResult {
  readonly success: boolean;
  readonly error?: string;
  readonly stackObjectId?: string;
  readonly manaPoolAfter?: ManaPool;
  readonly log?: readonly string[];
}

/**
 * Rule 602.5: Validate activation restrictions
 */
export function validateActivationRestrictions(
  restrictions: readonly ActivationRestriction[] | undefined,
  context: ActivationContext
): { valid: boolean; reason?: string } {
  if (!restrictions || restrictions.length === 0) {
    return { valid: true };
  }
  
  for (const restriction of restrictions) {
    // Sorcery timing restriction
    if (restriction.requiresSorceryTiming) {
      if (!context.hasPriority) {
        return { valid: false, reason: 'You do not have priority' };
      }
      if (!context.isMainPhase) {
        return { valid: false, reason: 'Can only activate during main phase' };
      }
      if (!context.isOwnTurn) {
        return { valid: false, reason: 'Can only activate during your turn' };
      }
      if (!context.stackEmpty) {
        return { valid: false, reason: 'Can only activate when stack is empty' };
      }
    }
    
    // Combat restriction
    if (restriction.requiresCombat && !context.isCombat) {
      return { valid: false, reason: 'Can only activate during combat' };
    }
    
    // Own turn restriction
    if (restriction.requiresOwnTurn && !context.isOwnTurn) {
      return { valid: false, reason: 'Can only activate during your turn' };
    }
    
    // Frequency restriction
    if (restriction.maxPerTurn !== undefined) {
      if (context.activationsThisTurn >= restriction.maxPerTurn) {
        return {
          valid: false,
          reason: `Already activated ${restriction.maxPerTurn} time(s) this turn`,
        };
      }
    }
  }
  
  return { valid: true };
}

/**
 * Rule 602.5b: Loyalty abilities have special restrictions
 */
export function validateLoyaltyAbility(
  ability: ActivatedAbility,
  context: ActivationContext
): { valid: boolean; reason?: string } {
  if (!ability.isLoyaltyAbility) {
    return { valid: true };
  }
  
  // Loyalty abilities: main phase, stack empty, once per turn
  if (!context.hasPriority) {
    return { valid: false, reason: 'You do not have priority' };
  }
  if (!context.isMainPhase) {
    return { valid: false, reason: 'Loyalty abilities only during main phase' };
  }
  if (!context.isOwnTurn) {
    return { valid: false, reason: 'Loyalty abilities only during your turn' };
  }
  if (!context.stackEmpty) {
    return { valid: false, reason: 'Loyalty abilities only when stack is empty' };
  }
  if (context.activationsThisTurn > 0) {
    return { valid: false, reason: 'Already activated a loyalty ability this turn' };
  }
  
  return { valid: true };
}

/**
 * Rule 602.2: Activate an activated ability
 */
export function activateAbility(
  ability: ActivatedAbility,
  manaPool: Readonly<ManaPool>,
  context: ActivationContext
): ActivationResult {
  const logs: string[] = [];
  
  // Mana abilities handled separately (don't use stack)
  if (ability.isManaAbility) {
    return {
      success: false,
      error: 'Mana abilities should use activateManaAbility instead',
    };
  }
  
  // Check if player has priority
  if (!context.hasPriority) {
    return {
      success: false,
      error: 'You do not have priority',
    };
  }
  
  // Validate restrictions
  const restrictionValidation = validateActivationRestrictions(
    ability.restrictions,
    context
  );
  if (!restrictionValidation.valid) {
    return {
      success: false,
      error: restrictionValidation.reason,
    };
  }
  
  // Validate loyalty ability restrictions
  const loyaltyValidation = validateLoyaltyAbility(ability, context);
  if (!loyaltyValidation.valid) {
    return {
      success: false,
      error: loyaltyValidation.reason,
    };
  }
  
  logs.push(`${ability.sourceName}: Activating ability`);
  
  // Pay mana cost if present
  let updatedPool = manaPool;
  if (ability.manaCost) {
    const payment = payManaCost(manaPool, ability.manaCost);
    if (!payment.success) {
      return {
        success: false,
        error: payment.error,
      };
    }
    updatedPool = payment.remainingPool!;
    logs.push(`Paid mana cost: ${JSON.stringify(ability.manaCost)}`);
  }
  
  // Create stack object for the ability
  const stackObject: StackObject = {
    id: `ability-${Date.now()}-${ability.id}`,
    spellId: ability.id,
    cardName: `${ability.sourceName} ability`,
    controllerId: ability.controllerId,
    targets: ability.targets || [],
    timestamp: Date.now(),
    type: 'ability',
  };
  
  logs.push(`${ability.sourceName} ability added to stack`);
  
  return {
    success: true,
    stackObjectId: stackObject.id,
    manaPoolAfter: updatedPool,
    log: logs,
  };
}

/**
 * Create a simple activated ability
 */
export function createActivatedAbility(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  manaCost: ManaCost | undefined,
  effect: string,
  restrictions?: ActivationRestriction[]
): ActivatedAbility {
  return {
    id: `${sourceId}-activated-${Date.now()}`,
    sourceId,
    sourceName,
    controllerId,
    manaCost,
    effect,
    restrictions,
  };
}
