/**
 * Rule 701.37: Monstrosity
 * 
 * "Monstrosity N" means "If this permanent isn't monstrous, put N +1/+1 counters
 * on it and it becomes monstrous."
 * 
 * Reference: Rule 701.37
 */

export interface MonstrosityAction {
  readonly type: 'monstrosity';
  readonly permanentId: string;
  readonly n: number; // Number of +1/+1 counters to add
}

export interface MonstrousState {
  readonly permanentId: string;
  readonly isMonstrous: boolean;
  readonly monstrosityX: number; // The value of X when it became monstrous
}

/**
 * Rule 701.37a: Monstrosity N
 * 
 * "Monstrosity N" means "If this permanent isn't monstrous, put N +1/+1 counters
 * on it and it becomes monstrous."
 */
export function monstrosity(permanentId: string, n: number): MonstrosityAction {
  return {
    type: 'monstrosity',
    permanentId,
    n,
  };
}

/**
 * Apply monstrosity to a permanent
 */
export function applyMonstrosity(
  currentState: MonstrousState,
  n: number
): MonstrousState {
  // Rule 701.37a: Only if not already monstrous
  if (currentState.isMonstrous) {
    return currentState; // No change if already monstrous
  }
  
  return {
    ...currentState,
    isMonstrous: true,
    monstrosityX: n, // Rule 701.37c: Store X value
  };
}

/**
 * Rule 701.37b: Monstrous designation
 * 
 * Monstrous is a designation that has no rules meaning other than to act as a
 * marker. Only permanents can be or become monstrous. Once a permanent becomes
 * monstrous, it stays monstrous until it leaves the battlefield. Monstrous is
 * neither an ability nor part of the permanent's copiable values.
 */
export function isMonstrous(state: MonstrousState): boolean {
  return state.isMonstrous;
}

export function canBecomeMonstrousAgain(state: MonstrousState): boolean {
  // Once monstrous, can't become monstrous again
  return !state.isMonstrous;
}

/**
 * Rule 701.37c: X value reference
 * 
 * If a permanent's ability instructs a player to "monstrosity X," other abilities
 * of that permanent may also refer to X. The value of X in those abilities is
 * equal to the value of X as that permanent became monstrous.
 */
export function getMonstrosityX(state: MonstrousState): number {
  return state.monstrosityX;
}

/**
 * Create initial monstrous state
 */
export function createMonstrousState(permanentId: string): MonstrousState {
  return {
    permanentId,
    isMonstrous: false,
    monstrosityX: 0,
  };
}
