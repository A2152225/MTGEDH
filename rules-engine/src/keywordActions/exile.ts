/**
 * Rule 701.13: Exile
 * 
 * To exile an object, move it to the exile zone from wherever it is.
 * 
 * Reference: Rule 701.13, also see Rule 406 "Exile"
 */

export interface ExileAction {
  readonly type: 'exile';
  readonly objectId: string;
  readonly fromZone: string;
  readonly faceDown?: boolean; // Some cards exile face down
  readonly exileZoneId?: string; // For tracking specific exile zones (e.g., "exiled with Card X")
}

export interface ExileResult {
  readonly objectId: string;
  readonly fromZone: string;
  readonly destinationZone: 'exile';
  readonly faceDown: boolean;
  readonly usesLinkedExileZone: boolean;
  readonly exileZoneId?: string;
}

/**
 * Rule 701.13a: Move to exile zone
 * 
 * To exile an object, move it to the exile zone from wherever it is.
 */
export function exileObject(
  objectId: string,
  fromZone: string,
  options: {
    faceDown?: boolean;
    exileZoneId?: string;
  } = {}
): ExileAction {
  return {
    type: 'exile',
    objectId,
    fromZone,
    faceDown: options.faceDown,
    exileZoneId: options.exileZoneId,
  };
}

export function isFaceDownExile(action: ExileAction): boolean {
  return action.faceDown === true;
}

export function usesLinkedExileZone(action: ExileAction): boolean {
  return typeof action.exileZoneId === 'string' && action.exileZoneId.length > 0;
}

export function createExileResult(action: ExileAction): ExileResult {
  return {
    objectId: action.objectId,
    fromZone: action.fromZone,
    destinationZone: 'exile',
    faceDown: isFaceDownExile(action),
    usesLinkedExileZone: usesLinkedExileZone(action),
    exileZoneId: action.exileZoneId,
  };
}
