/**
 * Frenzy keyword ability (Rule 702.68)
 * 
 * @module keywordAbilities/frenzy
 */

/**
 * Represents a frenzy ability on a creature.
 * Rule 702.68: Frenzy is a triggered ability. "Frenzy N" means "Whenever this creature 
 * attacks and isn't blocked, it gets +N/+0 until end of turn."
 */
export interface FrenzyAbility {
  readonly type: 'frenzy';
  readonly count: number;
  readonly source: string;
}

/**
 * Creates a frenzy ability.
 * 
 * @param source - The source creature with frenzy
 * @param count - Power bonus (frenzy N)
 * @returns A frenzy ability
 * 
 * @example
 * ```typescript
 * const ability = frenzy('Goblin Berserker', 2);
 * ```
 */
export function frenzy(source: string, count: number): FrenzyAbility {
  return {
    type: 'frenzy',
    count,
    source
  };
}

/**
 * Gets the power bonus from frenzy.
 * 
 * @param ability - The frenzy ability
 * @returns Power bonus
 */
export function getFrenzyBonus(ability: FrenzyAbility): number {
  return ability.count;
}
