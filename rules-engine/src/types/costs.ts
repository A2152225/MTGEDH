/**
 * Rule 118: Costs
 * Actions or payments necessary to take another action
 */

import { ObjectID, ControllerID } from './objects';
import { ManaPool, ManaType } from './mana';

/**
 * Rule 118.1 - Cost is action/payment necessary to take another action
 */
export enum CostType {
  MANA = 'mana',                    // 118.2 - Mana payment
  TAP = 'tap',                      // Tapping permanent
  UNTAP = 'untap',                  // Untapping permanent
  SACRIFICE = 'sacrifice',          // Sacrificing permanent
  DISCARD = 'discard',              // Discarding card
  EXILE = 'exile',                  // Exiling card/permanent
  LIFE = 'life',                    // 118.3b - Paying life
  REMOVE_COUNTER = 'remove_counter', // Removing counters
  RETURN_TO_HAND = 'return_to_hand', // Returning permanent to hand
  PAY_ENERGY = 'pay_energy',        // Paying energy counters
  MILL = 'mill',                    // Putting cards from library to graveyard
  REVEAL = 'reveal',                // Revealing card
  OTHER = 'other'                   // Other cost types
}

/**
 * Base cost interface
 */
export interface Cost {
  readonly type: CostType;
  readonly description: string;
  readonly isOptional: boolean;     // "you may" costs
  readonly isMandatory: boolean;    // Must pay if able
}

/**
 * Rule 118.2, 118.3a - Mana cost
 * Paying mana from mana pool
 */
export interface ManaCost extends Cost {
  readonly type: CostType.MANA;
  readonly white: number;
  readonly blue: number;
  readonly black: number;
  readonly red: number;
  readonly green: number;
  readonly colorless: number;
  readonly generic: number;         // Can be paid with any mana
  readonly x?: number;              // Variable X cost (Rule 118.4)
}

/**
 * Rule 118.3b - Life cost
 * Paying life (subtracting from life total)
 */
export interface LifeCost extends Cost {
  readonly type: CostType.LIFE;
  readonly amount: number;
}

/**
 * Tap/Untap cost
 */
export interface TapCost extends Cost {
  readonly type: CostType.TAP | CostType.UNTAP;
  readonly permanentId: ObjectID;
}

/**
 * Sacrifice cost
 */
export interface SacrificeCost extends Cost {
  readonly type: CostType.SACRIFICE;
  readonly permanentIds: ObjectID[];  // Specific permanents
  readonly count?: number;            // Or number to sacrifice
  readonly restrictions?: string[];   // E.g., "sacrifice a creature"
}

/**
 * Discard cost
 */
export interface DiscardCost extends Cost {
  readonly type: CostType.DISCARD;
  readonly cardIds?: ObjectID[];      // Specific cards
  readonly count?: number;            // Or number to discard
  readonly restrictions?: string[];   // E.g., "discard a card"
}

/**
 * Exile cost
 */
export interface ExileCost extends Cost {
  readonly type: CostType.EXILE;
  readonly objectIds: ObjectID[];
  readonly fromZone?: string;         // Which zone to exile from
}

/**
 * Remove counter cost
 */
export interface RemoveCounterCost extends Cost {
  readonly type: CostType.REMOVE_COUNTER;
  readonly counterType: string;       // E.g., "+1/+1", "loyalty"
  readonly count: number;
  readonly fromId?: ObjectID;         // Which permanent
}

/**
 * Composite cost (multiple costs combined)
 */
export interface CompositeCost {
  readonly costs: readonly Cost[];
  readonly isAdditional: boolean;     // Rule 118.8 - Additional cost
  readonly isAlternative: boolean;    // Rule 118.9 - Alternative cost
}

/**
 * Rule 118.3 - Can't pay cost without necessary resources
 */
export interface CostPaymentValidation {
  readonly canPay: boolean;
  readonly reason?: string;
}

/**
 * Validate if player can pay mana cost
 */
export function canPayManaCost(
  cost: ManaCost,
  manaPool: Readonly<ManaPool>
): CostPaymentValidation {
  // Check each color requirement
  if (cost.white > manaPool.white ||
      cost.blue > manaPool.blue ||
      cost.black > manaPool.black ||
      cost.red > manaPool.red ||
      cost.green > manaPool.green ||
      cost.colorless > manaPool.colorless) {
    return { canPay: false, reason: 'Insufficient mana of required colors' };
  }
  
  // Check generic cost can be paid with remaining mana
  const usedMana = cost.white + cost.blue + cost.black + cost.red + cost.green + cost.colorless;
  const totalMana = manaPool.white + manaPool.blue + manaPool.black + 
                    manaPool.red + manaPool.green + manaPool.colorless;
  const availableForGeneric = totalMana - usedMana;
  
  if (cost.generic > availableForGeneric) {
    return { canPay: false, reason: 'Insufficient mana for generic cost' };
  }
  
  return { canPay: true };
}

/**
 * Rule 118.3b - Validate if player can pay life
 */
export function canPayLifeCost(
  cost: LifeCost,
  currentLife: number
): CostPaymentValidation {
  // Rule 119.4b - Can always pay 0 life, no matter what life total is
  if (cost.amount === 0) {
    return { canPay: true };
  }
  
  // Rule 119.4 - Can pay life only if life total >= payment
  if (currentLife < cost.amount) {
    return { canPay: false, reason: 'Insufficient life' };
  }
  
  return { canPay: true };
}

/**
 * Rule 118.5 - {0} costs
 * Action is acknowledgment of payment
 */
export function isZeroCost(cost: Cost): boolean {
  if (cost.type === CostType.MANA) {
    const manaCost = cost as ManaCost;
    return manaCost.white === 0 &&
           manaCost.blue === 0 &&
           manaCost.black === 0 &&
           manaCost.red === 0 &&
           manaCost.green === 0 &&
           manaCost.colorless === 0 &&
           manaCost.generic === 0;
  }
  return false;
}

/**
 * Rule 118.6 - Unpayable costs
 * Some objects have no mana cost
 */
export interface UnpayableCost {
  readonly isUnpayable: true;
  readonly reason: 'no_mana_cost' | 'based_on_unpayable' | 'other';
}

/**
 * Rule 118.7 - Cost reduction and modification
 */
export interface CostModification {
  readonly type: 'reduction' | 'increase';
  readonly amount: number;
  readonly manaType?: ManaType;      // Specific mana type affected
  readonly affectsGeneric: boolean;  // Rule 118.7a - Reductions affect generic
}

/**
 * Apply cost reduction to mana cost
 */
export function applyCostReduction(
  originalCost: ManaCost,
  reduction: CostModification
): ManaCost {
  if (reduction.type !== 'reduction') {
    return originalCost;
  }
  
  // Rule 118.7a - Generic reductions only affect generic component
  if (!reduction.manaType) {
    const newGeneric = Math.max(0, originalCost.generic - reduction.amount);
    return { ...originalCost, generic: newGeneric };
  }
  
  // Colored reduction
  const reduced = { ...originalCost };
  const manaKey = reduction.manaType as keyof ManaCost;
  
  if (typeof reduced[manaKey] === 'number') {
    const current = reduced[manaKey] as number;
    const newValue = Math.max(0, current - reduction.amount);
    
    // Rule 118.7c - Excess colored reduction reduces generic
    const excess = Math.max(0, reduction.amount - current);
    
    return {
      ...reduced,
      [manaKey]: newValue,
      generic: Math.max(0, reduced.generic - excess)
    } as ManaCost;
  }
  
  return originalCost;
}

/**
 * Rule 118.8 - Additional costs
 * Costs added to normal cost
 */
export interface AdditionalCost {
  readonly cost: Cost;
  readonly condition?: string;  // When this additional cost applies
}

/**
 * Rule 118.9 - Alternative costs
 * Generally optional, replaces normal cost
 */
export interface AlternativeCost {
  readonly cost: Cost | CompositeCost;
  readonly isOptional: boolean;         // Rule 118.9b
  readonly replacesManaCost: boolean;   // Rule 118.9c - Doesn't change mana cost
}

/**
 * Rule 118.10 - Each payment applies to only one spell/ability
 */
export function canPayForMultiple(cost: Cost): boolean {
  return false; // Each payment is single-use
}

/**
 * Rule 118.12 - "If you do" costs
 * Checks whether player chose to pay optional cost or started to pay mandatory cost
 */
export interface ConditionalCostPayment {
  readonly cost: Cost;
  readonly wasChosen: boolean;       // Did player choose to pay?
  readonly wasStarted: boolean;      // Did payment begin?
  readonly wasCompleted: boolean;    // Was payment successful?
}

/**
 * Rule 118.13 - Hybrid and Phyrexian mana symbols
 * Choice made when proposing spell/ability
 * (HybridManaChoice type defined in mana.ts)
 */
