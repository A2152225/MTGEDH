/**
 * Rule 701.28: Convert
 * 
 * To convert a permanent, turn it so that its other face is up. This follows
 * the same rules as transform.
 * 
 * Reference: Rule 701.28
 */

export interface ConvertAction {
  readonly type: 'convert';
  readonly permanentId: string;
  readonly fromFace: 'front' | 'back';
  readonly toFace: 'front' | 'back';
}

/**
 * Rule 701.28a: Convert a permanent
 * 
 * To convert a permanent, turn it so that its other face is up. This follows
 * rules 701.27a–f, 712.9–10, and 712.18. Those rules apply to converting a
 * permanent just as they apply to transforming a permanent.
 */
export function convertPermanent(
  permanentId: string,
  currentFace: 'front' | 'back'
): ConvertAction {
  return {
    type: 'convert',
    permanentId,
    fromFace: currentFace,
    toFace: currentFace === 'front' ? 'back' : 'front',
  };
}

/**
 * Rule 701.28b: Convert vs face up/down
 * 
 * Although converting a permanent uses the same physical action as turning a
 * permanent face up or face down, they are different game actions.
 */
export const CONVERT_IS_DIFFERENT_FROM_FACE_DOWN = true;

/**
 * Rule 701.28c: Can only convert double-faced objects
 * 
 * If a spell or ability instructs a player to convert a permanent that isn't
 * represented by a double-faced token or a double-faced card, nothing happens.
 */
export function canConvert(
  permanent: { isDoubleFaced: boolean; isInstantOrSorcery?: boolean }
): boolean {
  // Rule 701.28d: Can't convert into instant/sorcery face
  if (permanent.isInstantOrSorcery) return false;
  
  return permanent.isDoubleFaced;
}

/**
 * Rule 701.28e: Convert only once per ability
 * 
 * If an activated or triggered ability of a permanent tries to convert it,
 * the permanent does so only if it hasn't converted or transformed since the
 * ability was put onto the stack.
 */
export function canConvertFromAbility(
  permanentId: string,
  abilityStackTimestamp: number,
  lastConvertOrTransformTimestamp: number | null
): boolean {
  if (lastConvertOrTransformTimestamp === null) return true;
  return lastConvertOrTransformTimestamp < abilityStackTimestamp;
}

/**
 * Rule 701.28f: Can't transform also means can't convert
 * 
 * If a spell or ability states that a permanent can't transform, that permanent
 * also can't convert.
 */
export function canConvertWhenTransformPrevented(
  canTransform: boolean
): boolean {
  return canTransform; // If can't transform, also can't convert
}
