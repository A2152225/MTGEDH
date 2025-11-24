/**
 * Phasing keyword ability implementation
 * Rule 702.26
 * 
 * Phasing is a static ability that modifies the rules of the untap step.
 */

/**
 * Phasing ability
 * Rule 702.26a
 * 
 * During each player's untap step, before the active player untaps permanents,
 * all phased-in permanents with phasing that player controls phase out.
 * All phased-out permanents that had phased out under that player's control phase in.
 */
export interface PhasingAbility {
  readonly type: 'phasing';
  readonly source: string;
  readonly phasedOut: boolean;
}

/**
 * Creates a phasing ability
 * Rule 702.26a
 * 
 * @param source - The permanent with phasing
 * @returns Phasing ability
 */
export function phasing(source: string): PhasingAbility {
  return {
    type: 'phasing',
    source,
    phasedOut: false,
  };
}

/**
 * Phases a permanent out
 * Rule 702.26b
 * 
 * @param ability - The phasing ability
 * @returns Updated ability with phased out state
 */
export function phaseOut(ability: PhasingAbility): PhasingAbility {
  return {
    ...ability,
    phasedOut: true,
  };
}

/**
 * Phases a permanent in
 * Rule 702.26c
 * 
 * @param ability - The phasing ability
 * @returns Updated ability with phased in state
 */
export function phaseIn(ability: PhasingAbility): PhasingAbility {
  return {
    ...ability,
    phasedOut: false,
  };
}

/**
 * Checks if phased-out permanent is treated as non-existent
 * Rule 702.26d
 * 
 * @param ability - The phasing ability
 * @returns True if permanent is phased out
 */
export function isPhasedOut(ability: PhasingAbility): boolean {
  return ability.phasedOut;
}

/**
 * Checks if multiple phasing abilities are redundant
 * Rule 702.26g - Multiple instances of phasing are redundant
 * 
 * @param abilities - Array of phasing abilities
 * @returns True (multiple phasing is redundant)
 */
export function hasRedundantPhasing(abilities: readonly PhasingAbility[]): boolean {
  return abilities.length > 1;
}
