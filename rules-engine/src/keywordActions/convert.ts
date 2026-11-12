/**
 * Rule 701.28: Convert
 * 
 * To convert a permanent, turn it so that its other face is up. This follows
 * the same rules as transform.
 * 
 * Reference: Rule 701.28
 */

import { entersBattlefieldConvertedWithInstantOrSorceryBackFace as resolveConvertedIorSBackFaceFromStack } from '../enterBattlefieldTransformedOrConverted';

export interface ConvertAction {
  readonly type: 'convert';
  readonly permanentId: string;
  readonly fromFace: 'front' | 'back';
  readonly toFace: 'front' | 'back';
}

export interface ConvertResult {
  readonly permanentId: string;
  readonly fromFace: 'front' | 'back';
  readonly toFace: 'front' | 'back';
  readonly legal: boolean;
  readonly fromAbilityAllowed: boolean;
  readonly transformPreventionBlocksConvert: boolean;
}

/**
 * Rule 701.28a: Convert a permanent
 * 
 * To convert a permanent, turn it so that its other face is up. This follows
 * rules 701.27a-g, 712.7, and 712.15. Those rules apply to converting a
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
 * Rule 701.28c: A permanent that converts doesn't become a new object.
 * Effects that applied to it continue to apply.
 */
export const CONVERT_DOES_NOT_CREATE_NEW_OBJECT = true;

/**
 * Rule 701.28d / 701.28e / 713.1c: Only double-faced objects can convert.
 * Instant or sorcery faces, and meld cards or melded permanents, cannot.
 */
export function canConvert(
  permanent: { isDoubleFaced: boolean; isInstantOrSorcery?: boolean; isMeldCard?: boolean; isMelded?: boolean }
): boolean {
  // Rule 713.1c: Meld cards cannot be transformed or converted.
  if (permanent.isMeldCard || permanent.isMelded) return false;
  // Rule 701.28e: Can't convert into an instant or sorcery face
  if (permanent.isInstantOrSorcery) return false;
  // Rule 701.28d: Non-double-faced objects do not convert
  return permanent.isDoubleFaced;
}

/**
 * Rule 701.28f: Convert only once per ability
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
 * Rule 701.28g: Can't transform also means can't convert
 * 
 * If a spell or ability states that a permanent can't transform, that permanent
 * also can't convert.
 */
export function canConvertWhenTransformPrevented(
  canTransform: boolean
): boolean {
  return canTransform; // If can't transform, also can't convert
}

export function createConvertResult(
  action: ConvertAction,
  permanent: { isDoubleFaced: boolean; isInstantOrSorcery?: boolean; isMeldCard?: boolean; isMelded?: boolean },
  canTransformNow: boolean,
  abilityStackTimestamp?: number,
  lastConvertOrTransformTimestamp: number | null = null,
): ConvertResult {
  return {
    permanentId: action.permanentId,
    fromFace: action.fromFace,
    toFace: action.toFace,
    legal: canConvert(permanent) && canConvertWhenTransformPrevented(canTransformNow),
    fromAbilityAllowed: abilityStackTimestamp === undefined
      ? true
      : canConvertFromAbility(action.permanentId, abilityStackTimestamp, lastConvertOrTransformTimestamp),
    transformPreventionBlocksConvert: !canConvertWhenTransformPrevented(canTransformNow),
  };
}


/**
 * Rule 701.28h: If a double-faced spell would enter the battlefield converted
 * and its back face is an instant or sorcery, it is put into its owner's
 * graveyard instead. This is an exception to 712.10.
 */
export function entersBattlefieldConvertedWithInstantOrSorceryBackFace(
  backFaceIsInstantOrSorcery: boolean,
): 'graveyard' | 'battlefield' {
  return resolveConvertedIorSBackFaceFromStack(backFaceIsInstantOrSorcery);
}
