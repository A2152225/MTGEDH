/**
 * Rule 701.5: Cast
 * 
 * To cast a spell is to take it from the zone it's in (usually the hand),
 * put it on the stack, and pay its costs, so that it will eventually
 * resolve and have its effect.
 * 
 * Reference: Rule 701.5, also see Rule 601
 */

export interface CastAction {
  readonly type: 'cast';
  readonly spellId: string;
  readonly controllerId: string;
  readonly fromZone: string;
}
