/**
 * Squad keyword ability (Rule 702.157)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.157. Squad
 * 702.157a Squad is a keyword that represents two linked abilities. The first is a static ability 
 * that functions while the creature spell with squad is on the stack. The second is a triggered 
 * ability that functions when the creature with squad enters the battlefield. "Squad [cost]" means 
 * "As an additional cost to cast this spell, you may pay [cost] any number of times" and "When 
 * this creature enters, if its squad cost was paid, create a token that's a copy of it for each 
 * time its squad cost was paid."
 * 702.157b If a spell has multiple instances of squad, each is paid separately. If a permanent 
 * has multiple instances of squad, each triggers based on the payments made for that squad ability 
 * as it was cast, not based on payments for any other instance of squad.
 */

export interface SquadAbility {
  readonly type: 'squad';
  readonly source: string;
  readonly squadCost: string;
  readonly timesPaid: number;
  readonly tokenIds: readonly string[];
}

/**
 * Create a squad ability
 * Rule 702.157a
 * @param source - The creature spell with squad
 * @param squadCost - Additional cost
 * @returns Squad ability object
 */
export function squad(source: string, squadCost: string): SquadAbility {
  return {
    type: 'squad',
    source,
    squadCost,
    timesPaid: 0,
    tokenIds: [],
  };
}

/**
 * Pay squad cost when casting
 * Rule 702.157a - May pay any number of times
 * @param ability - Squad ability
 * @param timesPaid - Number of times cost was paid
 * @returns Updated ability
 */
export function paySquadCost(ability: SquadAbility, timesPaid: number): SquadAbility {
  return {
    ...ability,
    timesPaid,
  };
}

/**
 * Create token copies when creature enters
 * Rule 702.157a - Create token copy for each time cost was paid
 * @param ability - Squad ability
 * @param tokenIds - IDs of created tokens
 * @returns Updated ability
 */
export function createSquadTokens(ability: SquadAbility, tokenIds: readonly string[]): SquadAbility {
  return {
    ...ability,
    tokenIds,
  };
}

/**
 * Check if squad cost was paid
 * @param ability - Squad ability
 * @returns True if paid at least once
 */
export function wasSquadPaid(ability: SquadAbility): boolean {
  return ability.timesPaid > 0;
}

/**
 * Get number of times squad cost was paid
 * @param ability - Squad ability
 * @returns Times paid
 */
export function getSquadTimesPaid(ability: SquadAbility): number {
  return ability.timesPaid;
}

/**
 * Multiple instances of squad are paid and trigger separately
 * Rule 702.157b
 * @param abilities - Array of squad abilities
 * @returns False - each is separate
 */
export function hasRedundantSquad(abilities: readonly SquadAbility[]): boolean {
  return false; // Each instance is paid and triggers separately
}
