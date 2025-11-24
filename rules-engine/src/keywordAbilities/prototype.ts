/**
 * Prototype keyword ability (Rule 702.160)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.160. Prototype
 * 702.160a Prototype is a static ability that appears on prototype cards that have a secondary 
 * set of power, toughness, and mana cost characteristics. A player who casts a spell with 
 * prototype can choose to cast that card "prototyped." If they do, the alternative set of its 
 * power, toughness, and mana cost characteristics are used.
 */

export interface PrototypeAbility {
  readonly type: 'prototype';
  readonly source: string;
  readonly prototypeCost: string;
  readonly prototypePower: number;
  readonly prototypeToughness: number;
  readonly wasPrototyped: boolean;
}

/**
 * Create a prototype ability
 * Rule 702.160a
 * @param source - The card with prototype
 * @param prototypeCost - Alternative mana cost
 * @param prototypePower - Alternative power
 * @param prototypeToughness - Alternative toughness
 * @returns Prototype ability object
 */
export function prototype(
  source: string,
  prototypeCost: string,
  prototypePower: number,
  prototypeToughness: number
): PrototypeAbility {
  return {
    type: 'prototype',
    source,
    prototypeCost,
    prototypePower,
    prototypeToughness,
    wasPrototyped: false,
  };
}

/**
 * Cast spell as prototyped
 * Rule 702.160a - Uses alternative characteristics
 * @param ability - Prototype ability
 * @returns Updated ability
 */
export function castPrototyped(ability: PrototypeAbility): PrototypeAbility {
  return {
    ...ability,
    wasPrototyped: true,
  };
}

/**
 * Check if spell was prototyped
 * @param ability - Prototype ability
 * @returns True if prototyped
 */
export function wasPrototyped(ability: PrototypeAbility): boolean {
  return ability.wasPrototyped;
}

/**
 * Get effective power
 * Rule 702.160a
 * @param ability - Prototype ability
 * @param normalPower - Normal power value
 * @returns Effective power
 */
export function getEffectivePower(ability: PrototypeAbility, normalPower: number): number {
  return ability.wasPrototyped ? ability.prototypePower : normalPower;
}

/**
 * Get effective toughness
 * Rule 702.160a
 * @param ability - Prototype ability
 * @param normalToughness - Normal toughness value
 * @returns Effective toughness
 */
export function getEffectiveToughness(ability: PrototypeAbility, normalToughness: number): number {
  return ability.wasPrototyped ? ability.prototypeToughness : normalToughness;
}

/**
 * Get effective cost
 * Rule 702.160a
 * @param ability - Prototype ability
 * @param normalCost - Normal mana cost
 * @returns Effective mana cost
 */
export function getEffectiveCost(ability: PrototypeAbility, normalCost: string): string {
  return ability.wasPrototyped ? ability.prototypeCost : normalCost;
}

/**
 * Multiple instances of prototype are redundant
 * @param abilities - Array of prototype abilities
 * @returns True if more than one
 */
export function hasRedundantPrototype(abilities: readonly PrototypeAbility[]): boolean {
  return abilities.length > 1;
}
