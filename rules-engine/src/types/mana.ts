/**
 * Rule 106: Mana
 * Type definitions for mana - the primary resource in the game
 */

import { Color } from './colors';

// Rule 106.1a - There are five colors of mana
export type ColoredMana = Color;

// Rule 106.1b - There are six types of mana: white, blue, black, red, green, and colorless
export enum ManaType {
  WHITE = 'white',
  BLUE = 'blue',
  BLACK = 'black',
  RED = 'red',
  GREEN = 'green',
  COLORLESS = 'colorless'
}

// Mana cost interface (from Rule 202)
export interface ManaCost {
  readonly white?: number;
  readonly blue?: number;
  readonly black?: number;
  readonly red?: number;
  readonly green?: number;
  readonly generic?: number;
  readonly colorless?: number;  // Explicit colorless mana {C}
  readonly x?: number;  // X in cost
}

/**
 * Mana restriction type - specifies how restricted mana can be spent
 * Rule 106.6: Some abilities produce mana that can be spent only on certain things
 */
export type ManaRestrictionType = 
  | 'creatures'           // Can only be spent on creatures
  | 'abilities'           // Can only be spent on abilities
  | 'colorless_spells'    // Can only be spent on colorless spells
  | 'artifacts'           // Can only be spent on artifacts
  | 'legendary'           // Can only be spent on legendary spells
  | 'multicolored'        // Can only be spent on multicolored spells
  | 'commander'           // Can only be spent on commander costs
  | 'activated_abilities' // Can only be spent to activate abilities
  | 'instant_sorcery'     // Can only be spent on instants and sorceries
  | 'specific_card';      // Can only be spent on a specific card or permanent

/**
 * Represents a single unit of restricted mana in the mana pool
 * Rule 106.6: Some effects produce mana with restrictions on what it can be spent on
 */
export interface RestrictedManaEntry {
  /** The type of mana - accepts both ManaType enum and string literals for compatibility */
  type: ManaType | 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';
  /** Amount of mana with this restriction */
  amount: number;
  /** Type of restriction on this mana */
  restriction: ManaRestrictionType;
  /** Optional: specific card/permanent ID this mana can be spent on */
  restrictedTo?: string;
  /** Source permanent that produced this mana (for tracking) */
  sourceId?: string;
  /** Source permanent name (for display) */
  sourceName?: string;
}

// Rule 106.4 - Mana pool holds unspent mana
export interface ManaPool {
  readonly white: number;
  readonly blue: number;
  readonly black: number;
  readonly red: number;
  readonly green: number;
  readonly colorless: number;
  
  /** 
   * Restricted mana entries - mana that can only be spent on specific things
   */
  readonly restricted?: readonly RestrictedManaEntry[];
  
  /**
   * Flag indicating this player's mana pool doesn't empty at end of phases/steps
   * Set by effects like Horizon Stone, Omnath Locus of Mana, Kruphix God of Horizons
   */
  readonly doesNotEmpty?: boolean;
  
  /**
   * If mana doesn't empty but converts to colorless, specify that transformation
   */
  readonly convertsToColorless?: boolean;
  
  /**
   * Source permanent(s) providing the "doesn't empty" effect
   */
  readonly noEmptySourceIds?: readonly string[];
}

// Create empty mana pool
export function createEmptyManaPool(): ManaPool {
  return {
    white: 0,
    blue: 0,
    black: 0,
    red: 0,
    green: 0,
    colorless: 0
  };
}

// Rule 106.3 - Add mana to a player's mana pool
export function addMana(pool: Readonly<ManaPool>, type: ManaType, amount: number = 1): ManaPool {
  return {
    ...pool,
    [type]: pool[type] + amount
  };
}

/**
 * Rule 106.3 - Add restricted mana to a player's mana pool
 */
export function addRestrictedMana(
  pool: Readonly<ManaPool>, 
  type: ManaType, 
  amount: number, 
  restriction: ManaRestrictionType,
  sourceId?: string,
  sourceName?: string,
  restrictedTo?: string
): ManaPool {
  const existingRestricted = pool.restricted ? [...pool.restricted] : [];
  
  // Check if there's already an entry with the same type and restriction from the same source
  const existingIndex = existingRestricted.findIndex(
    entry => entry.type === type && 
             entry.restriction === restriction && 
             entry.sourceId === sourceId &&
             entry.restrictedTo === restrictedTo
  );
  
  if (existingIndex >= 0) {
    // Add to existing entry
    existingRestricted[existingIndex] = {
      ...existingRestricted[existingIndex],
      amount: existingRestricted[existingIndex].amount + amount
    };
  } else {
    // Create new entry
    existingRestricted.push({
      type,
      amount,
      restriction,
      sourceId,
      sourceName,
      restrictedTo
    });
  }
  
  return {
    ...pool,
    restricted: existingRestricted
  };
}

// Rule 106.4 - Empty mana pool (happens at end of each step and phase)
// Modified to respect doesNotEmpty flag
export function emptyManaPool(pool?: Readonly<ManaPool>): ManaPool {
  // If no pool provided, return empty pool
  if (!pool) {
    return createEmptyManaPool();
  }
  
  // If mana doesn't empty, return the pool as-is (or with conversion)
  if (pool.doesNotEmpty) {
    if (pool.convertsToColorless) {
      // Convert all colored mana to colorless (e.g., Kruphix)
      const totalColored = pool.white + pool.blue + pool.black + pool.red + pool.green;
      return {
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
        colorless: pool.colorless + totalColored,
        doesNotEmpty: pool.doesNotEmpty,
        convertsToColorless: pool.convertsToColorless,
        noEmptySourceIds: pool.noEmptySourceIds,
        // Restricted mana also converts to colorless but keeps restrictions
        restricted: pool.restricted?.map(entry => ({
          ...entry,
          type: ManaType.COLORLESS
        }))
      };
    }
    // Otherwise keep the pool as-is
    return pool;
  }
  
  // Normal case: empty the pool
  return createEmptyManaPool();
}

// Check if mana pool has sufficient mana of a specific type
export function hasMana(pool: Readonly<ManaPool>, type: ManaType, amount: number = 1): boolean {
  return pool[type] >= amount;
}

// Calculate total mana in pool (including restricted mana)
export function totalMana(pool: Readonly<ManaPool>): number {
  const regularMana = pool.white + pool.blue + pool.black + pool.red + pool.green + pool.colorless;
  const restrictedMana = pool.restricted?.reduce((sum, entry) => sum + entry.amount, 0) || 0;
  return regularMana + restrictedMana;
}

// Calculate total mana of a specific color (including restricted mana of that color)
export function totalManaOfType(pool: Readonly<ManaPool>, type: ManaType): number {
  const regularMana = pool[type];
  const restrictedMana = pool.restricted
    ?.filter(entry => entry.type === type)
    .reduce((sum, entry) => sum + entry.amount, 0) || 0;
  return regularMana + restrictedMana;
}

// Rule 106.4b - Check if player has any unspent mana
export function hasUnspentMana(pool: Readonly<ManaPool>): boolean {
  return totalMana(pool) > 0;
}

// Remove mana from pool (for paying costs)
export function removeMana(pool: Readonly<ManaPool>, type: ManaType, amount: number = 1): ManaPool {
  const current = pool[type];
  if (current < amount) {
    throw new Error(`Insufficient ${type} mana: has ${current}, needs ${amount}`);
  }
  return {
    ...pool,
    [type]: current - amount
  };
}

/**
 * Remove restricted mana from pool
 */
export function removeRestrictedMana(
  pool: Readonly<ManaPool>, 
  restrictedIndex: number, 
  amount: number = 1
): ManaPool {
  if (!pool.restricted || restrictedIndex >= pool.restricted.length) {
    throw new Error(`Invalid restricted mana index: ${restrictedIndex}`);
  }
  
  const entry = pool.restricted[restrictedIndex];
  if (entry.amount < amount) {
    throw new Error(`Insufficient restricted ${entry.type} mana: has ${entry.amount}, needs ${amount}`);
  }
  
  const newRestricted = [...pool.restricted];
  if (entry.amount === amount) {
    // Remove the entry entirely
    newRestricted.splice(restrictedIndex, 1);
  } else {
    // Reduce the amount
    newRestricted[restrictedIndex] = {
      ...entry,
      amount: entry.amount - amount
    };
  }
  
  return {
    ...pool,
    restricted: newRestricted.length > 0 ? newRestricted : undefined
  };
}

/**
 * Set the "doesn't empty" flag on a mana pool
 * Used by effects like Horizon Stone, Omnath, Kruphix
 */
export function setManaDoesNotEmpty(
  pool: Readonly<ManaPool>,
  sourceId: string,
  convertsToColorless: boolean = false
): ManaPool {
  const existingSourceIds = pool.noEmptySourceIds ? [...pool.noEmptySourceIds] : [];
  if (!existingSourceIds.includes(sourceId)) {
    existingSourceIds.push(sourceId);
  }
  
  return {
    ...pool,
    doesNotEmpty: true,
    convertsToColorless: convertsToColorless || pool.convertsToColorless,
    noEmptySourceIds: existingSourceIds
  };
}

/**
 * Remove the "doesn't empty" effect from a specific source
 * Called when the source permanent leaves the battlefield
 */
export function removeManaDoesNotEmpty(
  pool: Readonly<ManaPool>,
  sourceId: string
): ManaPool {
  if (!pool.noEmptySourceIds) {
    return pool;
  }
  
  const newSourceIds = pool.noEmptySourceIds.filter(id => id !== sourceId);
  
  if (newSourceIds.length === 0) {
    // No more sources, remove the effect by returning a pool without those fields
    const { doesNotEmpty, convertsToColorless, noEmptySourceIds, ...rest } = pool;
    return rest as ManaPool;
  }
  
  return {
    ...pool,
    noEmptySourceIds: newSourceIds
  };
}

/**
 * Rule 106.6 - Mana restrictions and additional effects (legacy interface)
 * Some mana can only be spent in specific ways
 */
export interface RestrictedMana {
  readonly type: ManaType;
  readonly amount: number;
  readonly restrictions?: ManaRestriction[];
}

export interface ManaRestriction {
  readonly restrictionType: 'spell' | 'ability' | 'cardType' | 'color';
  readonly allowedValues: string[]; // Card types, colors, etc.
}

/**
 * Rule 106.8 - Hybrid mana symbols
 * Player chooses one half when adding to pool
 */
export type HybridManaChoice = {
  readonly colorOption: ManaType;
  readonly genericAmount?: number; // For {2/W} style hybrid
};

/**
 * Rule 106.12 - "Tap for mana" 
 * Activating a mana ability with {T} in its cost
 */
export interface TapForManaAbility {
  readonly produces: ManaType | ManaType[];
  readonly amount?: number;
  readonly restrictions?: ManaRestriction[];
}
