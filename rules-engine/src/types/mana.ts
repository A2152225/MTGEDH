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

// Rule 106.4 - Mana pool holds unspent mana
export interface ManaPool {
  readonly white: number;
  readonly blue: number;
  readonly black: number;
  readonly red: number;
  readonly green: number;
  readonly colorless: number;
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

// Rule 106.4 - Empty mana pool (happens at end of each step and phase)
export function emptyManaPool(): ManaPool {
  return createEmptyManaPool();
}

// Check if mana pool has sufficient mana of a specific type
export function hasMana(pool: Readonly<ManaPool>, type: ManaType, amount: number = 1): boolean {
  return pool[type] >= amount;
}

// Calculate total mana in pool
export function totalMana(pool: Readonly<ManaPool>): number {
  return pool.white + pool.blue + pool.black + pool.red + pool.green + pool.colorless;
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
 * Rule 106.6 - Mana restrictions and additional effects
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
