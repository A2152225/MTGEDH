/**
 * Entwine keyword ability implementation (Rule 702.42)
 * 
 * @see MagicCompRules 702.42
 */

/**
 * Entwine ability interface
 * Rule 702.42a: "Entwine [cost]" means "You may choose all modes of this spell instead of just the number specified.
 * If you do, you pay an additional [cost]."
 */
export interface EntwineAbility {
  readonly type: 'entwine';
  readonly cost: string;
  readonly source: string;
  readonly wasEntwined: boolean;
}

/**
 * Creates an Entwine ability
 * 
 * @param source - The source spell ID
 * @param cost - The additional cost to entwine
 * @returns EntwineAbility object
 */
export function entwine(source: string, cost: string): EntwineAbility {
  return {
    type: 'entwine',
    cost,
    source,
    wasEntwined: false,
  };
}

/**
 * Pays the entwine cost to choose all modes
 * 
 * @param ability - The entwine ability
 * @returns Updated EntwineAbility
 */
export function payEntwine(ability: EntwineAbility): EntwineAbility {
  return {
    ...ability,
    wasEntwined: true,
  };
}

/**
 * Checks if the spell was entwined
 * 
 * @param ability - The entwine ability
 * @returns True if entwine cost was paid
 */
export function wasEntwined(ability: EntwineAbility): boolean {
  return ability.wasEntwined;
}
