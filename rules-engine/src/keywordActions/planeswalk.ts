/**
 * Rule 701.31: Planeswalk
 * 
 * A player may planeswalk only during a Planechase game. To planeswalk is to
 * put each face-up plane card and phenomenon card on the bottom of its owner's
 * planar deck face down, then move the top card of your planar deck off that
 * planar deck and turn it face up.
 * 
 * Reference: Rule 701.31, also see Rule 901 "Planechase"
 */

export interface PlaneswalkAction {
  readonly type: 'planeswalk';
  readonly playerId: string; // The planar controller
  readonly fromPlane?: string; // Plane/phenomenon being planeswalked away from
  readonly toPlane?: string; // Plane/phenomenon being planeswalked to
}

/**
 * Rule 701.31a: Planechase game only
 * 
 * A player may planeswalk only during a Planechase game. Only the planar
 * controller may planeswalk.
 */
export function canPlaneswalk(
  isPlanechaseGame: boolean,
  isPlanarController: boolean
): boolean {
  return isPlanechaseGame && isPlanarController;
}

/**
 * Rule 701.31b: Planeswalk mechanic
 * 
 * To planeswalk is to put each face-up plane card and phenomenon card on the
 * bottom of its owner's planar deck face down, then move the top card of your
 * planar deck off that planar deck and turn it face up.
 */
export function planeswalk(
  playerId: string,
  fromPlane?: string,
  toPlane?: string
): PlaneswalkAction {
  return {
    type: 'planeswalk',
    playerId,
    fromPlane,
    toPlane,
  };
}

/**
 * Rule 701.31c: Causes of planeswalking
 * 
 * A player may planeswalk as the result of the "planeswalking ability", because
 * the owner of a face-up plane card or phenomenon card leaves the game, or
 * because a phenomenon's triggered ability leaves the stack. Abilities may also
 * instruct a player to planeswalk.
 */
export enum PlaneswalkCause {
  PLANESWALKING_ABILITY = 'planeswalking-ability', // Rule 901.8
  OWNER_LEAVES = 'owner-leaves', // Rule 901.10
  PHENOMENON_TRIGGER = 'phenomenon-trigger', // Rule 704.6f
  ABILITY_INSTRUCTION = 'ability-instruction',
}

/**
 * Rule 701.31d: Planes planeswalked to/from
 * 
 * The plane card that's turned face up is the plane the player planeswalks to.
 * The plane card that's turned face down or that leaves the game is the plane
 * the player planeswalks away from. The same is true with respect to phenomena.
 */
export interface PlaneswalkResult {
  readonly planeswalkedTo: string;
  readonly planeswalkedFrom: string | null;
  readonly cause: PlaneswalkCause;
}

export function createPlaneswalkResult(
  toPlane: string,
  fromPlane: string | null,
  cause: PlaneswalkCause
): PlaneswalkResult {
  return {
    planeswalkedTo: toPlane,
    planeswalkedFrom: fromPlane,
    cause,
  };
}
