/**
 * Rule 701.15: Goad
 * 
 * Certain spells and abilities can goad a creature. Until the next turn of the
 * controller of that spell or ability, that creature is goaded.
 * 
 * Reference: Rule 701.15
 */

export interface GoadAction {
  readonly type: 'goad';
  readonly creatureId: string;
  readonly goaderId: string; // Controller of the spell/ability that goaded
}

export interface GoadedState {
  readonly creatureId: string;
  readonly goadedBy: Set<string>; // Can be goaded by multiple players
  readonly expiresOnTurnOf: Map<string, number>; // Player ID -> turn number
}

/**
 * Rule 701.15a: Goad duration
 * 
 * Certain spells and abilities can goad a creature. Until the next turn of the
 * controller of that spell or ability, that creature is goaded.
 */
export function goadCreature(creatureId: string, goaderId: string): GoadAction {
  return {
    type: 'goad',
    creatureId,
    goaderId,
  };
}

/**
 * Rule 701.15b: Goaded combat requirements
 * 
 * Goaded is a designation a permanent can have. A goaded creature attacks each
 * combat if able and attacks a player other than the controller of the permanent,
 * spell, or ability that caused it to be goaded if able.
 */
export function mustAttackIfGoaded(creatureState: GoadedState): boolean {
  return creatureState.goadedBy.size > 0;
}

export function canAttackGoader(
  creatureState: GoadedState,
  targetPlayerId: string
): boolean {
  // Can't attack a player who goaded this creature (if possible to attack someone else)
  return !creatureState.goadedBy.has(targetPlayerId);
}

/**
 * Rule 701.15c: Multiple goad effects
 * 
 * A creature can be goaded by multiple players. Doing so creates additional
 * combat requirements.
 */
export function addGoad(
  state: GoadedState,
  goaderId: string,
  expiryTurn: number
): GoadedState {
  const newGoadedBy = new Set(state.goadedBy);
  newGoadedBy.add(goaderId);
  
  const newExpiry = new Map(state.expiresOnTurnOf);
  newExpiry.set(goaderId, expiryTurn);
  
  return {
    ...state,
    goadedBy: newGoadedBy,
    expiresOnTurnOf: newExpiry,
  };
}

/**
 * Rule 701.15d: Redundant goad
 * 
 * Once a player has goaded a creature, the same player goading it again has no
 * effect. Doing so doesn't create additional combat requirements.
 */
export function isAlreadyGoadedBy(
  state: GoadedState,
  goaderId: string
): boolean {
  return state.goadedBy.has(goaderId);
}
