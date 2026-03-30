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

export interface CastResult {
  readonly spellId: string;
  readonly controllerId: string;
  readonly fromZone: string;
  readonly costsPaid: boolean;
  readonly legal: boolean;
  readonly movesToStack: boolean;
}

export function canCastFromZone(
  fromZone: string,
  allowedZones: readonly string[] = ['hand']
): boolean {
  return allowedZones.includes(fromZone);
}

export function createCastResult(
  action: CastAction,
  costsPaid: boolean,
  legal: boolean
): CastResult {
  return {
    spellId: action.spellId,
    controllerId: action.controllerId,
    fromZone: action.fromZone,
    costsPaid,
    legal,
    movesToStack: costsPaid && legal,
  };
}
