/**
 * Rule 601: Casting Spells - Complete Implementation
 * 
 * Comprehensive spell casting system with mana payment, targeting, and stack integration.
 * Based on MagicCompRules 20251114.txt
 */

import type { ManaPool, ManaCost, ManaType } from './types/mana';
import type { Cost, CostType } from './types/costs';
import type { CastingProcess, CastingStep } from './types/spellsAbilitiesEffects';
import { canPayManaCost } from './types/costs';

/** Type for mana color keys (subset of ManaPool that are numeric) */
type ManaColorKey = 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';

/**
 * Complete spell casting context with all necessary state
 */
export interface SpellCastingContext {
  readonly spellId: string;
  readonly cardName: string;
  readonly controllerId: string;
  readonly manaCost: ManaCost;
  readonly additionalCosts?: readonly Cost[];
  readonly targets?: readonly string[];
  readonly modes?: readonly string[];
  readonly xValue?: number;
}

/**
 * Result of a spell casting operation
 */
export interface CastingResult {
  readonly success: boolean;
  readonly error?: string;
  readonly stackObjectId?: string;
  readonly manaPoolAfter?: ManaPool;
  readonly log?: readonly string[];
}

/**
 * Rule 601.2h: Pay all costs to cast the spell
 * Returns updated mana pool after payment
 */
export function payManaCost(
  manaPool: Readonly<ManaPool>,
  cost: ManaCost
): { success: boolean; remainingPool?: ManaPool; error?: string } {
  // First validate we can pay the cost
  const validation = canPayManaCost(cost, manaPool);
  if (!validation.canPay) {
    return { success: false, error: validation.reason };
  }

  // Pay colored mana first
  let pool = { ...manaPool };
  
  // White
  if (cost.white && cost.white > 0) {
    if (pool.white < cost.white) {
      return { success: false, error: 'Insufficient white mana' };
    }
    pool.white -= cost.white;
  }
  
  // Blue
  if (cost.blue && cost.blue > 0) {
    if (pool.blue < cost.blue) {
      return { success: false, error: 'Insufficient blue mana' };
    }
    pool.blue -= cost.blue;
  }
  
  // Black
  if (cost.black && cost.black > 0) {
    if (pool.black < cost.black) {
      return { success: false, error: 'Insufficient black mana' };
    }
    pool.black -= cost.black;
  }
  
  // Red
  if (cost.red && cost.red > 0) {
    if (pool.red < cost.red) {
      return { success: false, error: 'Insufficient red mana' };
    }
    pool.red -= cost.red;
  }
  
  // Green
  if (cost.green && cost.green > 0) {
    if (pool.green < cost.green) {
      return { success: false, error: 'Insufficient green mana' };
    }
    pool.green -= cost.green;
  }
  
  // Colorless (explicit {C})
  if (cost.colorless && cost.colorless > 0) {
    if (pool.colorless < cost.colorless) {
      return { success: false, error: 'Insufficient colorless mana' };
    }
    pool.colorless -= cost.colorless;
  }
  
  // Generic cost - can be paid with any mana
  if (cost.generic && cost.generic > 0) {
    let remaining = cost.generic;
    
    // Use up any remaining colored mana first (player's choice, simplified here)
    const payFromColor = (color: ManaColorKey, amount: number) => {
      const available = pool[color] as number;
      const toPay = Math.min(available, amount);
      (pool as Record<ManaColorKey, number>)[color] -= toPay;
      return amount - toPay;
    };
    
    // Try colorless first
    remaining = payFromColor('colorless', remaining);
    if (remaining === 0) return { success: true, remainingPool: pool };
    
    // Then try each color
    remaining = payFromColor('white', remaining);
    if (remaining === 0) return { success: true, remainingPool: pool };
    
    remaining = payFromColor('blue', remaining);
    if (remaining === 0) return { success: true, remainingPool: pool };
    
    remaining = payFromColor('black', remaining);
    if (remaining === 0) return { success: true, remainingPool: pool };
    
    remaining = payFromColor('red', remaining);
    if (remaining === 0) return { success: true, remainingPool: pool };
    
    remaining = payFromColor('green', remaining);
    if (remaining === 0) return { success: true, remainingPool: pool };
    
    if (remaining > 0) {
      return { success: false, error: 'Insufficient mana for generic cost' };
    }
  }
  
  return { success: true, remainingPool: pool };
}

/**
 * Rule 601.2i: Once costs are paid, spell becomes cast
 * Creates the stack object
 */
export interface StackObject {
  readonly id: string;
  readonly spellId: string;
  readonly cardName: string;
  readonly controllerId: string;
  readonly targets: readonly string[];
  readonly modes?: readonly string[];
  readonly xValue?: number;
  readonly triggerMeta?: {
    readonly effectText?: string;
    readonly triggerFilter?: string;
    readonly interveningIfClause?: string;
    readonly hasInterveningIf?: boolean;
    readonly interveningIfWasTrueAtTrigger?: boolean;
    readonly triggerEventDataSnapshot?: {
      readonly sourceId?: string;
      readonly sourceControllerId?: string;
      readonly targetId?: string;
      readonly targetControllerId?: string;
      readonly targetPlayerId?: string;
      readonly targetOpponentId?: string;
      readonly affectedPlayerIds?: readonly string[];
      readonly affectedOpponentIds?: readonly string[];
      readonly opponentsDealtDamageIds?: readonly string[];
      readonly lifeTotal?: number;
      readonly lifeLost?: number;
      readonly lifeGained?: number;
      readonly damageDealt?: number;
      readonly cardsDrawn?: number;
      readonly isYourTurn?: boolean;
      readonly isOpponentsTurn?: boolean;
      readonly battlefield?: readonly { id: string; types?: string[]; controllerId?: string }[];
    };
  };
  readonly timestamp: number;
  readonly type: 'spell' | 'ability';
}

export function createStackObject(
  context: SpellCastingContext,
  timestamp: number
): StackObject {
  return {
    id: `stack-${timestamp}-${context.spellId}`,
    spellId: context.spellId,
    cardName: context.cardName,
    controllerId: context.controllerId,
    targets: context.targets || [],
    modes: context.modes,
    xValue: context.xValue,
    timestamp,
    type: 'spell',
  };
}

/**
 * Validate spell timing restrictions
 * Rule 307.5: Sorcery timing
 */
export function validateSpellTiming(
  cardTypes: readonly string[],
  context: {
    isMainPhase: boolean;
    isOwnTurn: boolean;
    stackEmpty: boolean;
    hasPriority: boolean;
  }
): { valid: boolean; reason?: string } {
  const isSorcery = cardTypes.some(t => t.toLowerCase() === 'sorcery');
  const isPermanent = cardTypes.some(t => 
    ['creature', 'artifact', 'enchantment', 'planeswalker'].includes(t.toLowerCase())
  );
  
  // Sorcery-speed spells (sorceries and permanent spells) need sorcery timing
  if (isSorcery || isPermanent) {
    if (!context.hasPriority) {
      return { valid: false, reason: 'You do not have priority' };
    }
    if (!context.isMainPhase) {
      return { valid: false, reason: 'Can only cast during your main phase' };
    }
    if (!context.isOwnTurn) {
      return { valid: false, reason: 'Can only cast during your turn' };
    }
    if (!context.stackEmpty) {
      return { valid: false, reason: 'Can only cast when stack is empty' };
    }
  } else {
    // Instant-speed spells just need priority
    if (!context.hasPriority) {
      return { valid: false, reason: 'You do not have priority' };
    }
  }
  
  return { valid: true };
}

/**
 * Complete spell casting orchestration
 */
export function castSpell(
  context: SpellCastingContext,
  manaPool: Readonly<ManaPool>,
  cardTypes: readonly string[],
  timingContext: {
    isMainPhase: boolean;
    isOwnTurn: boolean;
    stackEmpty: boolean;
    hasPriority: boolean;
  }
): CastingResult {
  const logs: string[] = [];
  
  // Step 1: Validate timing
  const timingValidation = validateSpellTiming(cardTypes, timingContext);
  if (!timingValidation.valid) {
    return {
      success: false,
      error: timingValidation.reason,
    };
  }
  
  logs.push(`${context.controllerId} announces ${context.cardName}`);
  
  // Step 2: Validate and pay mana cost
  const payment = payManaCost(manaPool, context.manaCost);
  if (!payment.success) {
    return {
      success: false,
      error: payment.error,
    };
  }
  
  logs.push(`Mana cost paid: ${JSON.stringify(context.manaCost)}`);
  
  // Step 3: Create stack object
  const stackObject = createStackObject(context, Date.now());
  logs.push(`${context.cardName} added to stack`);
  
  return {
    success: true,
    stackObjectId: stackObject.id,
    manaPoolAfter: payment.remainingPool,
    log: logs,
  };
}
