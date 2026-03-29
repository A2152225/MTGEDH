/**
 * Flanking keyword ability implementation
 * Rule 702.25
 * 
 * Flanking is a triggered ability that triggers when a creature without flanking blocks.
 */

/**
 * Flanking ability
 * Rule 702.25a
 * 
 * Whenever a creature with flanking is blocked by a creature without flanking,
 * the blocking creature gets -1/-1 until end of turn.
 */
export interface FlankingAbility {
  readonly type: 'flanking';
  readonly source: string;
}

export interface FlankingPenalty {
  readonly power: number;
  readonly toughness: number;
}

/**
 * Creates a flanking ability
 * Rule 702.25a
 * 
 * @param source - The creature with flanking
 * @returns Flanking ability
 */
export function flanking(source: string): FlankingAbility {
  return {
    type: 'flanking',
    source,
  };
}

/**
 * Checks if flanking triggers for a blocker
 * Rule 702.25a
 * 
 * @param blockerHasFlanking - Whether the blocker has flanking
 * @returns True if flanking triggers (blocker doesn't have flanking)
 */
export function doesFlankingTrigger(blockerHasFlanking: boolean): boolean {
  return !blockerHasFlanking;
}

export function shouldTriggerFlanking(
  blockerHasFlanking: boolean,
  creatureIsBlocking: boolean
): boolean {
  return creatureIsBlocking && doesFlankingTrigger(blockerHasFlanking);
}

/**
 * Checks if multiple flanking abilities are cumulative
 * Rule 702.25b - Multiple instances of flanking are cumulative
 * 
 * @param flankingCount - Number of flanking abilities
 * @returns Total penalty to blocking creature
 */
export function calculateFlankingPenalty(flankingCount: number): FlankingPenalty {
  return {
    power: -flankingCount,
    toughness: -flankingCount,
  };
}

export function getFlankingPenaltyForAbilities(
  abilities: readonly FlankingAbility[]
): FlankingPenalty {
  return calculateFlankingPenalty(abilities.length);
}
