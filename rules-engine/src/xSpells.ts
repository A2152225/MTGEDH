/**
 * X Spell Support
 * Rule 107.3
 * 
 * Handles variable mana costs with X in spells and abilities.
 * X can appear in mana costs and can be chosen by players during casting.
 */

import type { ManaCost } from './types/mana';

/**
 * X value configuration for a spell or ability
 */
export interface XCostConfiguration {
  readonly hasX: boolean;
  readonly xCount: number; // How many X symbols (e.g., XX = 2)
  readonly minX: number; // Minimum value for X (usually 0)
  readonly maxX?: number; // Maximum value (usually undefined = no limit)
  readonly restrictions?: XRestriction[];
}

/**
 * Restrictions on X value
 */
export interface XRestriction {
  readonly type: 'min' | 'max' | 'must_be' | 'must_divide_by';
  readonly value: number;
  readonly reason?: string;
}

/**
 * Result of X value selection
 */
export interface XValueSelection {
  readonly xValue: number;
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly totalManaValue: number;
}

/**
 * X cost payment information
 */
export interface XCostPayment {
  readonly declaredX: number;
  readonly manaForX: number; // declaredX * xCount
  readonly baseCost: ManaCost;
  readonly totalCost: ManaCost;
}

/**
 * Creates an X cost configuration from a mana cost
 * Rule 107.3a - If X is in mana cost, value is chosen by controller
 * 
 * @param manaCostString - The mana cost string (e.g., "{X}{U}{U}")
 * @returns X cost configuration
 */
export function parseXCost(manaCostString: string): XCostConfiguration {
  // Count X symbols
  const xMatches = manaCostString.match(/\{X\}/gi) || [];
  const xCount = xMatches.length;
  
  return {
    hasX: xCount > 0,
    xCount,
    minX: 0,
    maxX: undefined, // No upper limit by default
  };
}

/**
 * Validates an X value selection
 * Rule 107.3 - X must be a non-negative number
 * 
 * @param config - X cost configuration
 * @param xValue - The chosen X value
 * @param availableMana - Total mana available (optional check)
 * @returns Validation result
 */
export function validateXValue(
  config: XCostConfiguration,
  xValue: number,
  availableMana?: number
): XValueSelection {
  const errors: string[] = [];
  
  // X must be a non-negative integer
  if (xValue < 0) {
    errors.push('X must be 0 or greater');
  }
  
  if (!Number.isInteger(xValue)) {
    errors.push('X must be a whole number');
  }
  
  // Check minimum
  if (xValue < config.minX) {
    errors.push(`X must be at least ${config.minX}`);
  }
  
  // Check maximum
  if (config.maxX !== undefined && xValue > config.maxX) {
    errors.push(`X cannot be greater than ${config.maxX}`);
  }
  
  // Check restrictions
  if (config.restrictions) {
    for (const restriction of config.restrictions) {
      switch (restriction.type) {
        case 'min':
          if (xValue < restriction.value) {
            errors.push(restriction.reason || `X must be at least ${restriction.value}`);
          }
          break;
        case 'max':
          if (xValue > restriction.value) {
            errors.push(restriction.reason || `X cannot be greater than ${restriction.value}`);
          }
          break;
        case 'must_be':
          if (xValue !== restriction.value) {
            errors.push(restriction.reason || `X must be exactly ${restriction.value}`);
          }
          break;
        case 'must_divide_by':
          if (xValue % restriction.value !== 0) {
            errors.push(restriction.reason || `X must be divisible by ${restriction.value}`);
          }
          break;
      }
    }
  }
  
  // Calculate total mana needed for X
  const manaForX = xValue * config.xCount;
  
  // Check if we have enough mana
  if (availableMana !== undefined && manaForX > availableMana) {
    errors.push(`Not enough mana to pay for X=${xValue} (need ${manaForX}, have ${availableMana})`);
  }
  
  return {
    xValue,
    isValid: errors.length === 0,
    errors,
    totalManaValue: manaForX,
  };
}

/**
 * Calculates the total cost including X
 * Rule 107.3b - Value of X is considered part of mana cost
 * 
 * @param baseCost - The base mana cost without X value
 * @param xValue - The chosen X value
 * @param xCount - Number of X symbols
 * @returns Total mana cost
 */
export function calculateTotalCostWithX(
  baseCost: ManaCost,
  xValue: number,
  xCount: number = 1
): ManaCost {
  const xMana = xValue * xCount;
  
  return {
    ...baseCost,
    x: xValue, // Store the X value
    generic: (baseCost.generic || 0) + xMana,
  };
}

/**
 * Creates X cost payment information
 * 
 * @param baseCost - Base mana cost
 * @param xValue - Chosen X value
 * @param xCount - Number of X symbols
 * @returns Payment information
 */
export function createXCostPayment(
  baseCost: ManaCost,
  xValue: number,
  xCount: number = 1
): XCostPayment {
  return {
    declaredX: xValue,
    manaForX: xValue * xCount,
    baseCost,
    totalCost: calculateTotalCostWithX(baseCost, xValue, xCount),
  };
}

/**
 * Gets the X value from a resolved spell or ability
 * Rule 107.3c - While on stack, X has the value chosen
 * 
 * @param cost - The cost that was paid
 * @returns The X value, or 0 if no X
 */
export function getXValue(cost: ManaCost): number {
  return cost.x || 0;
}

/**
 * Checks if a mana cost contains X
 * Rule 107.3
 * 
 * @param manaCostString - The mana cost string
 * @returns Whether the cost contains X
 */
export function hasXInCost(manaCostString: string): boolean {
  return /\{X\}/i.test(manaCostString);
}

/**
 * Gets X value when spell is copied
 * Rule 107.3e - When copying, X has same value as original
 * 
 * @param originalCost - The original spell's cost
 * @returns The X value to use for the copy
 */
export function getXValueForCopy(originalCost: ManaCost): number {
  return originalCost.x || 0;
}

/**
 * Gets X value when spell is in graveyard/exile
 * Rule 107.3f - X is 0 outside the stack
 * 
 * @returns Always 0
 */
export function getXValueOutsideStack(): number {
  return 0;
}

/**
 * Calculates mana value with X
 * Rule 202.3 - X is treated as 0 when calculating mana value except on stack
 * 
 * @param baseManaValue - Base mana value without X
 * @param xValue - The X value (only counts on stack)
 * @param onStack - Whether the spell is on the stack
 * @returns Effective mana value
 */
export function calculateManaValueWithX(
  baseManaValue: number,
  xValue: number,
  onStack: boolean
): number {
  if (onStack) {
    return baseManaValue + xValue;
  }
  // X is 0 when not on stack
  return baseManaValue;
}

/**
 * Parses X cost effects from oracle text
 * Handles effects like "deals X damage" or "create X tokens"
 * 
 * @param oracleText - The oracle text
 * @returns How X is used in the effect
 */
export function parseXUsage(oracleText: string): {
  usesX: boolean;
  usages: readonly {
    description: string;
    multiplier?: number;
  }[];
} {
  const text = oracleText.toLowerCase();
  const usages: { description: string; multiplier?: number }[] = [];
  
  // Common X usage patterns
  const patterns: [RegExp, string][] = [
    [/deals x damage/i, 'deals X damage'],
    [/create x/i, 'creates X tokens'],
    [/draw x cards/i, 'draws X cards'],
    [/gain x life/i, 'gains X life'],
    [/x \+1\/\+1 counters/i, 'puts X +1/+1 counters'],
    [/x\/x/i, 'X/X power/toughness'],
    [/costs x less/i, 'reduces cost by X'],
    [/target creature gets \+x\/\+0/i, '+X/+0 bonus'],
    [/target creature gets \+0\/\+x/i, '+0/+X bonus'],
    [/target creature gets \+x\/\+x/i, '+X/+X bonus'],
    [/return x/i, 'returns X cards'],
    [/scry x/i, 'scry X'],
    [/surveil x/i, 'surveil X'],
    [/mill x/i, 'mill X cards'],
  ];
  
  for (const [pattern, description] of patterns) {
    if (pattern.test(text)) {
      usages.push({ description });
    }
  }
  
  // Check for multiplied X (2X damage, etc.)
  const multipliedMatch = text.match(/(\d+)x\s+(damage|life|cards)/i);
  if (multipliedMatch) {
    usages.push({
      description: `${multipliedMatch[2]} (${multipliedMatch[1]}X)`,
      multiplier: parseInt(multipliedMatch[1]),
    });
  }
  
  return {
    usesX: usages.length > 0 || /\{x\}/i.test(oracleText),
    usages,
  };
}

/**
 * Gets maximum X value player can afford
 * 
 * @param availableMana - Total available mana
 * @param baseCost - Base mana cost
 * @param xCount - Number of X symbols
 * @returns Maximum affordable X value
 */
export function getMaxAffordableX(
  availableMana: number,
  baseCost: ManaCost,
  xCount: number = 1
): number {
  // Calculate mana needed for base cost
  const baseCostTotal = 
    (baseCost.white || 0) +
    (baseCost.blue || 0) +
    (baseCost.black || 0) +
    (baseCost.red || 0) +
    (baseCost.green || 0) +
    (baseCost.colorless || 0) +
    (baseCost.generic || 0);
  
  const availableForX = Math.max(0, availableMana - baseCostTotal);
  return Math.floor(availableForX / xCount);
}

/**
 * Creates a prompt for X value selection
 * 
 * @param config - X cost configuration
 * @param maxAffordable - Maximum affordable X value
 * @returns Prompt information
 */
export function createXValuePrompt(
  config: XCostConfiguration,
  maxAffordable: number
): {
  minValue: number;
  maxValue: number;
  description: string;
} {
  const maxValue = config.maxX !== undefined 
    ? Math.min(config.maxX, maxAffordable)
    : maxAffordable;
  
  let description = 'Choose a value for X';
  if (config.xCount > 1) {
    description += ` (cost is ${config.xCount}X mana)`;
  }
  
  return {
    minValue: config.minX,
    maxValue,
    description,
  };
}
