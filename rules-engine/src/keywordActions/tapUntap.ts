/**
 * Rule 701.26: Tap and Untap
 * 
 * To tap a permanent, turn it sideways from an upright position. To untap a
 * permanent, rotate it back to the upright position. Only untapped permanents
 * can be tapped, and only tapped permanents can be untapped.
 * 
 * Reference: Rule 701.26
 */

export interface TapUntapAction {
  readonly type: 'tap-untap';
  readonly action: 'tap' | 'untap';
  readonly permanentId: string;
}

export interface TappedState {
  readonly permanentId: string;
  readonly tapped: boolean;
}

/**
 * Rule 701.26a: Tap a permanent
 * 
 * To tap a permanent, turn it sideways from an upright position. Only untapped
 * permanents can be tapped.
 */
export function tapPermanent(permanentId: string): TapUntapAction {
  return {
    type: 'tap-untap',
    action: 'tap',
    permanentId,
  };
}

/**
 * Rule 701.26b: Untap a permanent
 * 
 * To untap a permanent, rotate it back to the upright position. Only tapped
 * permanents can be untapped.
 */
export function untapPermanent(permanentId: string): TapUntapAction {
  return {
    type: 'tap-untap',
    action: 'untap',
    permanentId,
  };
}

/**
 * Rule 701.26c: Can only tap if untapped
 * 
 * Only untapped permanents can be tapped, and only tapped permanents can be
 * untapped.
 */
export function canTap(state: TappedState): boolean {
  return !state.tapped;
}

export function canUntap(state: TappedState): boolean {
  return state.tapped;
}

/**
 * Apply tap/untap action
 */
export function applyTapUntap(
  state: TappedState,
  action: 'tap' | 'untap'
): TappedState {
  if (action === 'tap' && !canTap(state)) {
    return state; // No change if already tapped
  }
  if (action === 'untap' && !canUntap(state)) {
    return state; // No change if already untapped
  }
  
  return {
    ...state,
    tapped: action === 'tap',
  };
}

/**
 * Rule 701.26d: Tapped permanents entering the battlefield
 * 
 * Some effects instruct a permanent to enter the battlefield tapped. If a
 * permanent enters the battlefield tapped, it doesn't become tapped when it
 * enters; it's created in a tapped state.
 */
export function enterBattlefieldTapped(permanentId: string): TappedState {
  return {
    permanentId,
    tapped: true,
  };
}

/**
 * Rule 701.26e: Does not tap
 * 
 * If an effect says that a permanent "doesn't untap," this means it can't be
 * untapped during its controller's untap step. It can still be untapped by
 * other effects.
 */
export function canUntapDuringUntapStep(
  state: TappedState,
  hasDoesntUntapEffect: boolean
): boolean {
  return !hasDoesntUntapEffect;
}
