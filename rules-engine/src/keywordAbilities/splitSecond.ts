/**
 * Split Second keyword ability (Rule 702.61)
 * 
 * @module keywordAbilities/splitSecond
 */

/**
 * Represents a split second ability on a spell.
 * Rule 702.61: Split second is a static ability that functions only while the spell 
 * with split second is on the stack. "Split second" means "As long as this spell is 
 * on the stack, players can't cast other spells or activate abilities that aren't mana 
 * abilities."
 */
export interface SplitSecondAbility {
  readonly type: 'splitSecond';
  readonly source: string;
}

/**
 * Creates a split second ability.
 * 
 * @param source - The source spell with split second
 * @returns A split second ability
 * 
 * @example
 * ```typescript
 * const ability = splitSecond('Sudden Shock');
 * ```
 */
export function splitSecond(source: string): SplitSecondAbility {
  return {
    type: 'splitSecond',
    source
  };
}

/**
 * Checks if an action is allowed while split second is on stack.
 * 
 * @param isManaAbility - Whether the action is activating a mana ability
 * @returns True if action is allowed
 */
export function canActDuringSplitSecond(isManaAbility: boolean): boolean {
  return canActivateAbilityDuringSplitSecond(isManaAbility);
}

/**
 * Checks whether a spell may be cast while split second is on the stack.
 * Rule 702.61 forbids casting other spells.
 *
 * @returns False - no spells may be cast during split second
 */
export function canCastSpellDuringSplitSecond(): boolean {
  return false;
}

/**
 * Checks whether an activated ability may be activated while split second is on the stack.
 *
 * @param isManaAbility - Whether the ability is a mana ability
 * @returns True only for mana abilities
 */
export function canActivateAbilityDuringSplitSecond(isManaAbility: boolean): boolean {
  return isManaAbility;
}

/**
 * Creates the restriction summary imposed by split second.
 *
 * @param ability - The split second ability
 * @returns Restriction summary for the spell on the stack
 */
export function createSplitSecondRestrictionResult(ability: SplitSecondAbility): {
  source: string;
  spellsProhibited: true;
  nonManaAbilitiesProhibited: true;
  manaAbilitiesAllowed: true;
} {
  return {
    source: ability.source,
    spellsProhibited: true,
    nonManaAbilitiesProhibited: true,
    manaAbilitiesAllowed: true,
  };
}
