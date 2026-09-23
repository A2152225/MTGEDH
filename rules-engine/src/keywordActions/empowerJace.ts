/**
 * Rule 701.71: Empower Jace
 *
 * To empower Jace N means "If you don't control a Jace planeswalker token, create a
 * blue Jace planeswalker token with 0 loyalty, '[-1]: Surveil 1,' and '[-3]: Draw a card.'
 * Choose a Jace planeswalker token you control. Put N loyalty counters on it."
 *
 * Reference: MagicCompRules_20260925.txt, Rule 701.71
 */

export interface EmpowerJaceAction {
  readonly type: 'empower_jace';
  readonly playerId: string;
  readonly n: number;
  readonly chosenJaceId?: string;
  readonly createdToken?: boolean;
}

export interface EmpowerJaceResult {
  readonly playerId: string;
  readonly chosenJaceId?: string;
  readonly createdJaceToken: boolean;
  readonly loyaltyCountersAdded: number;
}

/**
 * Rule 701.71a: Empower Jace N
 */
export function empowerJace(playerId: string, n: number): EmpowerJaceAction {
  return {
    type: 'empower_jace',
    playerId,
    n,
  };
}

/**
 * Complete empower Jace after choosing a Jace planeswalker token.
 */
export function completeEmpowerJace(
  playerId: string,
  n: number,
  chosenJaceId: string,
  createdToken: boolean,
): EmpowerJaceAction {
  return {
    type: 'empower_jace',
    playerId,
    n,
    chosenJaceId,
    createdToken,
  };
}

export function needsJacePlaneswalkerToken(existingJaceTokenCount: number): boolean {
  return existingJaceTokenCount === 0;
}

export function createEmpowerJaceResult(action: EmpowerJaceAction): EmpowerJaceResult {
  return {
    playerId: action.playerId,
    chosenJaceId: action.chosenJaceId,
    createdJaceToken: action.createdToken === true,
    loyaltyCountersAdded: Math.max(0, action.n),
  };
}

/** Empowers even if no legal Jace token can receive the counters (CR keyword-action pattern). */
export const EMPOWER_JACE_EVEN_IF_IMPOSSIBLE = true;

/** Predefined Jace token characteristics from CR 701.71a. */
export const EMPOWER_JACE_TOKEN = {
  name: 'Jace',
  colors: ['U'] as const,
  typeLine: 'Token Planeswalker — Jace',
  loyalty: 0,
  abilities: [
    '[-1]: Surveil 1.',
    '[-3]: Draw a card.',
  ] as const,
} as const;
