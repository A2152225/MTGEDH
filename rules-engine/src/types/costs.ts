/**
 * Rule 118: Costs
 * Actions or payments necessary to take another action
 */

import { ObjectID, ControllerID } from './objects';
import { ManaPool, ManaType, ManaCost as ManaAmount } from './mana';

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
 * Uses ManaAmount from mana.ts
 */
export interface ManaCostPayment extends Cost {
  readonly type: CostType.MANA;
  readonly amount: ManaAmount;  // Uses type from mana.ts
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
  cost: ManaAmount,
  manaPool: Readonly<ManaPool>
): CostPaymentValidation {
  // Check each color requirement
  const white = cost.white || 0;
  const blue = cost.blue || 0;
  const black = cost.black || 0;
  const red = cost.red || 0;
  const green = cost.green || 0;
  const colorless = cost.colorless || 0;
  const generic = cost.generic || 0;
  
  if (white > manaPool.white ||
      blue > manaPool.blue ||
      black > manaPool.black ||
      red > manaPool.red ||
      green > manaPool.green ||
      colorless > manaPool.colorless) {
    return { canPay: false, reason: 'Insufficient mana of required colors' };
  }
  
  // Check generic cost can be paid with remaining mana
  const usedMana = white + blue + black + red + green + colorless;
  const totalMana = manaPool.white + manaPool.blue + manaPool.black + 
                    manaPool.red + manaPool.green + manaPool.colorless;
  const availableForGeneric = totalMana - usedMana;
  
  if (generic > availableForGeneric) {
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
    const manaCostPayment = cost as ManaCostPayment;
    const amount = manaCostPayment.amount;
    return (amount.white || 0) === 0 &&
           (amount.blue || 0) === 0 &&
           (amount.black || 0) === 0 &&
           (amount.red || 0) === 0 &&
           (amount.green || 0) === 0 &&
           (amount.colorless || 0) === 0 &&
           (amount.generic || 0) === 0;
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
  originalCost: ManaAmount,
  reduction: CostModification
): ManaAmount {
  if (reduction.type !== 'reduction') {
    return originalCost;
  }
  
  // Rule 118.7a - Generic reductions only affect generic component
  if (!reduction.manaType) {
    const newGeneric = Math.max(0, (originalCost.generic || 0) - reduction.amount);
    return { ...originalCost, generic: newGeneric };
  }
  
  // Colored reduction
  const reduced = { ...originalCost };
  const manaKey = reduction.manaType as keyof ManaAmount;
  
  if (typeof reduced[manaKey] === 'number') {
    const current = reduced[manaKey] as number;
    const newValue = Math.max(0, current - reduction.amount);
    
    // Rule 118.7c - Excess colored reduction reduces generic
    const excess = Math.max(0, reduction.amount - current);
    
    return {
      ...reduced,
      [manaKey]: newValue,
      generic: Math.max(0, (reduced.generic || 0) - excess)
    } as ManaAmount;
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
  readonly source?: string;             // Source of the alternative cost (e.g., "Jodah, Archmage Eternal")
  readonly description?: string;        // Human-readable description
}

/**
 * Jodah, Archmage Eternal style alternative cost
 * "You may pay {W}{U}{B}{R}{G} rather than pay the mana cost"
 */
export const JODAH_ALTERNATIVE_COST: ManaAmount = {
  white: 1,
  blue: 1,
  black: 1,
  red: 1,
  green: 1,
  generic: 0,
  colorless: 0,
};

/**
 * Create Jodah-style alternative cost
 */
export function createJodahAlternativeCost(): AlternativeCost {
  return {
    cost: {
      type: CostType.MANA,
      description: 'Pay {W}{U}{B}{R}{G} instead of mana cost',
      isOptional: true,
      isMandatory: false,
      amount: JODAH_ALTERNATIVE_COST,
    } as ManaCostPayment,
    isOptional: true,
    replacesManaCost: true,
    source: 'Jodah, Archmage Eternal',
    description: 'Pay {W}{U}{B}{R}{G} instead of mana cost',
  };
}

/**
 * Morophon-style cost reduction
 * "Spells of the chosen type cost {W}{U}{B}{R}{G} less to cast"
 */
export interface MorophonCostReduction {
  readonly creatureType: string;
  readonly reduction: ManaAmount;
}

/**
 * Create Morophon-style cost reduction
 */
export function createMorophonCostReduction(creatureType: string): MorophonCostReduction {
  return {
    creatureType,
    reduction: {
      white: 1,
      blue: 1,
      black: 1,
      red: 1,
      green: 1,
      generic: 0,
      colorless: 0,
    },
  };
}

/**
 * Apply Morophon-style reduction (each color by 1)
 * This is a specific reduction that removes one of each color
 */
export function applyMorophonReduction(
  originalCost: ManaAmount,
  reduction: ManaAmount
): ManaAmount {
  const result = { ...originalCost };
  
  // Reduce each color, with excess going to generic
  let excess = 0;
  
  // White
  const whiteReduction = reduction.white || 0;
  const currentWhite = result.white || 0;
  if (whiteReduction > currentWhite) {
    excess += whiteReduction - currentWhite;
    result.white = 0;
  } else {
    result.white = currentWhite - whiteReduction;
  }
  
  // Blue
  const blueReduction = reduction.blue || 0;
  const currentBlue = result.blue || 0;
  if (blueReduction > currentBlue) {
    excess += blueReduction - currentBlue;
    result.blue = 0;
  } else {
    result.blue = currentBlue - blueReduction;
  }
  
  // Black
  const blackReduction = reduction.black || 0;
  const currentBlack = result.black || 0;
  if (blackReduction > currentBlack) {
    excess += blackReduction - currentBlack;
    result.black = 0;
  } else {
    result.black = currentBlack - blackReduction;
  }
  
  // Red
  const redReduction = reduction.red || 0;
  const currentRed = result.red || 0;
  if (redReduction > currentRed) {
    excess += redReduction - currentRed;
    result.red = 0;
  } else {
    result.red = currentRed - redReduction;
  }
  
  // Green
  const greenReduction = reduction.green || 0;
  const currentGreen = result.green || 0;
  if (greenReduction > currentGreen) {
    excess += greenReduction - currentGreen;
    result.green = 0;
  } else {
    result.green = currentGreen - greenReduction;
  }
  
  // Colorless
  const colorlessReduction = reduction.colorless || 0;
  const currentColorless = result.colorless || 0;
  if (colorlessReduction > currentColorless) {
    excess += colorlessReduction - currentColorless;
    result.colorless = 0;
  } else {
    result.colorless = currentColorless - colorlessReduction;
  }
  
  // Apply excess to generic (Rule 118.7c)
  result.generic = Math.max(0, (result.generic || 0) - excess);
  
  return result;
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
