/**
 * Rule 701.54: The Ring Tempts You
 * 
 * Certain spells and abilities have the text "the Ring tempts you." Each time the
 * Ring tempts you, choose a creature you control. That creature becomes your
 * Ring-bearer until another creature becomes your Ring-bearer or another player
 * gains control of it.
 * 
 * Reference: Rule 701.54
 */

export interface RingTemptsYouAction {
  readonly type: 'ring-tempts-you';
  readonly playerId: string;
  readonly chosenRingBearer?: string;
  readonly temptCount: number;
}

/**
 * Rule 701.54a: The Ring tempts you
 */
export function ringTemptsYou(
  playerId: string,
  chosenRingBearer: string,
  temptCount: number
): RingTemptsYouAction {
  return {
    type: 'ring-tempts-you',
    playerId,
    chosenRingBearer,
    temptCount,
  };
}

/**
 * Rule 701.54b: Ring-bearer designation
 */
export interface RingBearerState {
  readonly playerId: string;
  readonly ringBearerId: string | null;
  readonly temptCount: number;
}

export function createRingBearerState(
  playerId: string,
  ringBearerId: string,
  temptCount: number
): RingBearerState {
  return {
    playerId,
    ringBearerId,
    temptCount,
  };
}

/**
 * Rule 701.54c: The Ring emblem abilities
 */
export function getRingAbilities(temptCount: number): readonly string[] {
  const abilities: string[] = [
    "Your Ring-bearer is legendary and can't be blocked by creatures with greater power.",
  ];
  
  if (temptCount >= 2) {
    abilities.push("Whenever your Ring-bearer attacks, draw a card, then discard a card.");
  }
  
  if (temptCount >= 3) {
    abilities.push("Whenever your Ring-bearer becomes blocked by a creature, the blocking creature's controller sacrifices it at end of combat.");
  }
  
  if (temptCount >= 4) {
    abilities.push("Whenever your Ring-bearer deals combat damage to a player, each opponent loses 3 life.");
  }
  
  return abilities;
}

/**
 * Rule 701.54d: Triggers when Ring tempts
 */
export const TRIGGERS_WHEN_RING_TEMPTS = true;

/**
 * Rule 701.54e: Is your Ring-bearer
 */
export function isYourRingBearer(
  creatureId: string,
  controllerId: string,
  state: RingBearerState
): boolean {
  return state.playerId === controllerId && state.ringBearerId === creatureId;
}
