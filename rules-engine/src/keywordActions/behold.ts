/**
 * Rule 701.4: Behold
 * 
 * "Behold a [quality]" means "Reveal a [quality] card from your hand or
 * choose a [quality] permanent you control on the battlefield."
 */

export interface BeholdAction {
  readonly type: 'behold';
  readonly playerId: string;
  readonly quality: string; // e.g., "legendary", "artifact"
  readonly choice: 'revealed-card' | 'chosen-permanent';
  readonly cardOrPermanentId: string;
}

/**
 * Rule 701.4b: Quality checking
 * 
 * The phrase "if a [quality] was beheld" refers to whether or not the object
 * had that quality at the time the player took that action.
 */
export function createBeholdAction(
  playerId: string,
  quality: string,
  choice: 'revealed-card' | 'chosen-permanent',
  cardOrPermanentId: string
): BeholdAction {
  return {
    type: 'behold',
    playerId,
    quality,
    choice,
    cardOrPermanentId,
  };
}

export function wasBeheld(action: BeholdAction, quality: string): boolean {
  return action.quality === quality;
}
