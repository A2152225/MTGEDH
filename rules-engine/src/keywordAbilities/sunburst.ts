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

const VALID_SUNBURST_COLORS = new Set(['W', 'U', 'B', 'R', 'G']);

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
  const normalizedColors = getDistinctSunburstColors(colorsSpent);

  return {
    ...ability,
    colorsSpent: normalizedColors,
    counters: normalizedColors.length,
    counterType: isCreature ? '+1/+1' : 'charge',
  };
}

/**
 * Gets the distinct colors of mana spent to cast a spell for sunburst.
 * Invalid or colorless values are ignored.
 *
 * @param colorsSpent - Raw mana colors spent to cast the spell
 * @returns Distinct, normalized color symbols in first-seen order
 */
export function getDistinctSunburstColors(colorsSpent: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalizedColors: string[] = [];

  for (const color of colorsSpent) {
    const normalizedColor = color.trim().toUpperCase();
    if (!VALID_SUNBURST_COLORS.has(normalizedColor) || seen.has(normalizedColor)) {
      continue;
    }

    seen.add(normalizedColor);
    normalizedColors.push(normalizedColor);
  }

  return normalizedColors;
}

/**
 * Counts the number of distinct colors spent for sunburst.
 *
 * @param colorsSpent - Raw mana colors spent to cast the spell
 * @returns The number of distinct colors spent
 */
export function getSunburstColorCount(colorsSpent: readonly string[]): number {
  return getDistinctSunburstColors(colorsSpent).length;
}

/**
 * Creates the battlefield-entry result for sunburst.
 *
 * @param ability - The resolved sunburst ability
 * @returns Summary of counters added and the counter type used
 */
export function createSunburstEntryResult(ability: SunburstAbility): {
  source: string;
  colorsSpent: readonly string[];
  countersAdded: number;
  counterType: '+1/+1' | 'charge';
} {
  return {
    source: ability.source,
    colorsSpent: ability.colorsSpent,
    countersAdded: ability.counters,
    counterType: ability.counterType,
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
