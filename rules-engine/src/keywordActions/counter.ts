/**
 * Rule 701.6: Counter
 * 
 * To counter a spell or ability means to cancel it, removing it from the stack.
 * It doesn't resolve and none of its effects occur. A countered spell is put
 * into its owner's graveyard.
 */

export interface CounterAction {
  readonly type: 'counter';
  readonly targetType: 'spell' | 'ability';
  readonly targetId: string;
}

/**
 * Rule 701.6a: Countered spells go to graveyard
 */
export function counterSpell(spellId: string): CounterAction {
  return {
    type: 'counter',
    targetType: 'spell',
    targetId: spellId,
  };
}

export function counterAbility(abilityId: string): CounterAction {
  return {
    type: 'counter',
    targetType: 'ability',
    targetId: abilityId,
  };
}

/**
 * Rule 701.6b: No cost refund
 * 
 * The player who cast a countered spell or activated a countered ability
 * doesn't get a "refund" of any costs that were paid.
 */
export interface CounterResult {
  readonly countered: boolean;
  readonly costsRefunded: false; // Always false per Rule 701.6b
  readonly destination: 'graveyard' | 'ceases-to-exist';
}

export function getCounterResult(targetType: 'spell' | 'ability'): CounterResult {
  return {
    countered: true,
    costsRefunded: false, // Rule 701.6b
    destination: targetType === 'spell' ? 'graveyard' : 'ceases-to-exist',
  };
}
