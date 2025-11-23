/**
 * Echo keyword ability implementation
 * Rule 702.30
 * 
 * Echo is a triggered ability that triggers during the controller's upkeep.
 */

/**
 * Echo ability
 * Rule 702.30a
 * 
 * "Echo [cost]" means "At the beginning of your upkeep, if this permanent came under
 * your control since the beginning of your last upkeep, sacrifice it unless you pay [cost]."
 */
export interface EchoAbility {
  readonly type: 'echo';
  readonly cost: string;
  readonly source: string;
  readonly turnEnteredControl: number;
}

/**
 * Creates an echo ability
 * Rule 702.30a
 * 
 * @param source - The permanent with echo
 * @param cost - The echo cost
 * @param turnEnteredControl - Turn number when it entered control
 * @returns Echo ability
 */
export function echo(source: string, cost: string, turnEnteredControl: number): EchoAbility {
  return {
    type: 'echo',
    cost,
    source,
    turnEnteredControl,
  };
}

/**
 * Checks if echo triggers
 * Rule 702.30a
 * 
 * @param ability - The echo ability
 * @param currentTurn - The current turn number
 * @param lastUpkeepTurn - Turn of the last upkeep
 * @returns True if echo triggers (came under control since last upkeep)
 */
export function doesEchoTrigger(
  ability: EchoAbility,
  currentTurn: number,
  lastUpkeepTurn: number
): boolean {
  return ability.turnEnteredControl >= lastUpkeepTurn;
}

/**
 * Checks if multiple echo abilities are redundant
 * Rule 702.30b - Multiple instances of echo are redundant
 * 
 * @param abilities - Array of echo abilities
 * @returns True if more than one echo
 */
export function hasRedundantEcho(abilities: readonly EchoAbility[]): boolean {
  return abilities.length > 1;
}
