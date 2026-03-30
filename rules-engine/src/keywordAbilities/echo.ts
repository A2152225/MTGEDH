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
 * Creates the upkeep summary for echo.
 *
 * @param ability - The echo ability
 * @param currentTurn - The current turn number
 * @param lastUpkeepTurn - Turn number of the controller's last upkeep
 * @param echoWasPaid - Whether the echo cost was paid
 * @returns Upkeep summary, or null if echo does not trigger
 */
export function createEchoUpkeepResult(
  ability: EchoAbility,
  currentTurn: number,
  lastUpkeepTurn: number,
  echoWasPaid: boolean
): {
  source: string;
  cost: string;
  triggered: true;
  shouldSacrifice: boolean;
} | null {
  if (!doesEchoTrigger(ability, currentTurn, lastUpkeepTurn)) {
    return null;
  }

  return {
    source: ability.source,
    cost: ability.cost,
    triggered: true,
    shouldSacrifice: !echoWasPaid,
  };
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
