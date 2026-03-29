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

function extractPrototypeDetails(oracleText: string): { cost: string; power: number; toughness: number } | null {
  const normalized = String(oracleText || '').replace(/\r?\n/g, ' ');
  const match = normalized.match(/prototype\s+([^\s]+)\s+(\d+)\/(\d+)/i);
  if (!match) {
    return null;
  }

  const power = Number.parseInt(String(match[2] || ''), 10);
  const toughness = Number.parseInt(String(match[3] || ''), 10);
  if (!Number.isFinite(power) || !Number.isFinite(toughness)) {
    return null;
  }

  return {
    cost: String(match[1] || '').trim(),
    power,
    toughness,
  };
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
 * Prototype is an alternative way to cast the spell from hand.
 */
export function canCastPrototyped(zone: string): boolean {
  return zone === 'hand' || zone === 'command';
}

/**
 * Return the prototype power and toughness together.
 */
export function getPrototypeStats(ability: PrototypeAbility): { power: number; toughness: number } {
  return {
    power: ability.prototypePower,
    toughness: ability.prototypeToughness,
  };
}

/**
 * Parse prototype details from oracle text.
 */
export function parsePrototype(oracleText: string): { cost: string; power: number; toughness: number } | null {
  return extractPrototypeDetails(oracleText);
}

/**
 * Multiple instances of prototype are redundant
 * @param abilities - Array of prototype abilities
 * @returns True if more than one
 */
export function hasRedundantPrototype(abilities: readonly PrototypeAbility[]): boolean {
  return abilities.length > 1;
}
