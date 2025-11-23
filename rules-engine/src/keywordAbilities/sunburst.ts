/**
 * Sunburst keyword ability implementation (Rule 702.44)
 * 
 * @see MagicCompRules 702.44
 */

/**
 * Sunburst ability interface
 * Rule 702.44a: Sunburst means "If this object is entering the battlefield as a creature,
 * it enters with a +1/+1 counter on it for each color of mana spent to cast it.
 * Otherwise, it enters with a charge counter on it for each color of mana spent to cast it."
 */
export interface SunburstAbility {
  readonly type: 'sunburst';
  readonly source: string;
  readonly colorsSpent: readonly string[];
  readonly counters: number;
  readonly counterType: '+1/+1' | 'charge';
}

/**
 * Creates a Sunburst ability
 * 
 * @param source - The source permanent ID
 * @returns SunburstAbility object
 */
export function sunburst(source: string): SunburstAbility {
  return {
    type: 'sunburst',
    source,
    colorsSpent: [],
    counters: 0,
    counterType: 'charge',
  };
}

/**
 * Resolves sunburst based on colors of mana spent
 * 
 * @param ability - The sunburst ability
 * @param colorsSpent - Array of color names spent to cast
 * @param isCreature - Whether the permanent is entering as a creature
 * @returns Updated SunburstAbility
 */
export function resolveSunburst(
  ability: SunburstAbility,
  colorsSpent: readonly string[],
  isCreature: boolean
): SunburstAbility {
  return {
    ...ability,
    colorsSpent,
    counters: colorsSpent.length,
    counterType: isCreature ? '+1/+1' : 'charge',
  };
}

/**
 * Checks if sunburst abilities are redundant
 * Rule 702.44b: If a permanent has multiple instances of sunburst, each one works separately
 * 
 * @returns False - sunburst instances are never redundant
 */
export function isSunburstRedundant(): boolean {
  return false; // Rule 702.44b: Each instance works separately
}
