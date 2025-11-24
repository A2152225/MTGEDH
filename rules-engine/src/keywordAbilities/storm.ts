/**
 * Storm keyword ability implementation (Rule 702.40)
 * 
 * @see MagicCompRules 702.40
 */

/**
 * Storm ability interface
 * Rule 702.40a: "Storm" means "When you cast this spell, copy it for each other spell
 * that was cast before it this turn. If the spell has any targets, you may choose new targets for any of the copies."
 */
export interface StormAbility {
  readonly type: 'storm';
  readonly source: string;
  readonly spellsCastThisTurn: number;
  readonly copies: readonly string[];
}

/**
 * Creates a Storm ability
 * 
 * @param source - The source spell ID
 * @returns StormAbility object
 */
export function storm(source: string): StormAbility {
  return {
    type: 'storm',
    source,
    spellsCastThisTurn: 0,
    copies: [],
  };
}

/**
 * Triggers storm ability and creates copies
 * 
 * @param ability - The storm ability
 * @param spellsCastBefore - Number of spells cast before this one this turn
 * @returns Updated StormAbility with copies
 */
export function triggerStorm(
  ability: StormAbility,
  spellsCastBefore: number
): StormAbility {
  const copyIds = Array.from({ length: spellsCastBefore }, (_, i) => 
    `${ability.source}-storm-copy-${i + 1}`
  );
  
  return {
    ...ability,
    spellsCastThisTurn: spellsCastBefore,
    copies: copyIds,
  };
}

/**
 * Gets the number of copies created by storm
 * Rule 702.40a: Copy for each OTHER spell cast before it this turn
 * 
 * @param ability - The storm ability
 * @returns Number of copies created
 */
export function getStormCopies(ability: StormAbility): number {
  return ability.copies.length;
}

/**
 * Checks if storm abilities are redundant
 * Rule 702.40b: If a spell has multiple instances of storm, each triggers separately
 * 
 * @returns False - storm instances are never redundant
 */
export function isStormRedundant(): boolean {
  return false; // Rule 702.40b: Each instance triggers separately
}
