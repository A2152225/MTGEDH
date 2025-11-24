/**
 * Escalate keyword ability (Rule 702.120)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.120. Escalate
 * 702.120a Escalate is a static ability of modal spells (see rule 700.2) that functions while 
 * the spell with escalate is on the stack. "Escalate [cost]" means "For each mode you choose 
 * beyond the first as you cast this spell, you pay an additional [cost]." Paying a spell's 
 * escalate cost follows the rules for paying additional costs in rules 601.2f–h.
 */

export interface EscalateAbility {
  readonly type: 'escalate';
  readonly source: string;
  readonly escalateCost: string;
  readonly modesChosen: number;
}

/**
 * Create an escalate ability
 * Rule 702.120a
 * @param source - The modal spell with escalate
 * @param escalateCost - Additional cost per mode beyond first
 * @returns Escalate ability object
 */
export function escalate(source: string, escalateCost: string): EscalateAbility {
  return {
    type: 'escalate',
    source,
    escalateCost,
    modesChosen: 1, // At least one mode must be chosen
  };
}

/**
 * Choose modes for escalate spell
 * Rule 702.120a - Pay additional cost for each mode beyond first
 * @param ability - Escalate ability
 * @param numberOfModes - Total number of modes to choose
 * @returns Updated ability
 */
export function chooseEscalateModes(ability: EscalateAbility, numberOfModes: number): EscalateAbility {
  return {
    ...ability,
    modesChosen: Math.max(1, numberOfModes),
  };
}

/**
 * Calculate total escalate cost
 * Rule 702.120a - [cost] for each mode beyond first
 * @param ability - Escalate ability
 * @returns Number of times escalate cost must be paid
 */
export function getEscalateCostMultiplier(ability: EscalateAbility): number {
  return Math.max(0, ability.modesChosen - 1);
}

/**
 * Get number of modes chosen
 * @param ability - Escalate ability
 * @returns Number of modes
 */
export function getModesChosen(ability: EscalateAbility): number {
  return ability.modesChosen;
}

/**
 * Multiple instances of escalate are not redundant
 * @param abilities - Array of escalate abilities
 * @returns False
 */
export function hasRedundantEscalate(abilities: readonly EscalateAbility[]): boolean {
  return false;
}
