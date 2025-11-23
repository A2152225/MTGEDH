/**
 * Rule 701.64: Harness
 * 
 * "Harness [this permanent]" means "If this permanent isn't harnessed, it becomes
 * harnessed."
 * 
 * Reference: Rule 701.64
 */

export interface HarnessAction {
  readonly type: 'harness';
  readonly permanentId: string;
}

/**
 * Rule 701.64a: Harness a permanent
 */
export function harness(permanentId: string): HarnessAction {
  return {
    type: 'harness',
    permanentId,
  };
}

/**
 * Rule 701.64b: Harnessed designation
 * 
 * Harnessed is a designation that has no rules meaning other than to act as a
 * marker that other spells and abilities can identify. Only permanents can be or
 * become harnessed. Once a permanent becomes harnessed, it stays harnessed until
 * it leaves the battlefield.
 */
export interface HarnessedState {
  readonly permanentId: string;
  readonly isHarnessed: boolean;
}

export function createHarnessedState(permanentId: string): HarnessedState {
  return {
    permanentId,
    isHarnessed: true,
  };
}

export function isHarnessed(state: HarnessedState): boolean {
  return state.isHarnessed;
}

export function canBecomeHarnessed(isAlreadyHarnessed: boolean): boolean {
  return !isAlreadyHarnessed;
}
