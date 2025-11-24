/**
 * Tribute keyword ability implementation (Rule 702.104)
 * 
 * From MTG Comprehensive Rules (Nov 2025):
 * 702.104a Tribute is a static ability that functions as a creature with tribute is
 * entering the battlefield. "Tribute N" means "As this creature enters the battlefield,
 * choose an opponent. That player may have this creature enter the battlefield with N
 * +1/+1 counters on it. If they don't, this creature gains an ability as it enters the
 * battlefield that triggers at the beginning of your end step."
 * 
 * 702.104b The opponent chooses whether to pay tribute as the creature with tribute is
 * entering the battlefield. If they pay the tribute, the creature enters the battlefield
 * with N +1/+1 counters on it. If they don't pay the tribute, any abilities that say
 * "If tribute wasn't paid" trigger at the appropriate time.
 */

/**
 * Tribute ability interface
 */
export interface TributeAbility {
  readonly type: 'tribute';
  readonly source: string;
  readonly tributeAmount: number;
  readonly chosenOpponent: string;
  readonly tributePaid: boolean;
}

/**
 * Creates a tribute ability
 * @param source - Source creature with tribute
 * @param amount - Number of counters if tribute is paid
 * @param opponent - Chosen opponent who decides
 * @returns Tribute ability
 */
export function tribute(
  source: string,
  amount: number,
  opponent: string
): TributeAbility {
  return {
    type: 'tribute',
    source,
    tributeAmount: amount,
    chosenOpponent: opponent,
    tributePaid: false,
  };
}

/**
 * Opponent pays tribute
 * @param ability - Tribute ability
 * @returns Updated tribute ability with paid status
 */
export function payTribute(ability: TributeAbility): TributeAbility {
  return {
    ...ability,
    tributePaid: true,
  };
}

/**
 * Opponent declines to pay tribute
 * @param ability - Tribute ability
 * @returns Updated tribute ability with unpaid status
 */
export function declineTribute(ability: TributeAbility): TributeAbility {
  return {
    ...ability,
    tributePaid: false,
  };
}

/**
 * Checks if tribute was paid
 * @param ability - Tribute ability
 * @returns True if opponent paid tribute
 */
export function wasTributePaid(ability: TributeAbility): boolean {
  return ability.tributePaid;
}

/**
 * Gets number of counters if tribute paid
 * @param ability - Tribute ability
 * @returns Counter amount
 */
export function getTributeAmount(ability: TributeAbility): number {
  return ability.tributeAmount;
}
