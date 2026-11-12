/**
 * Rule 701.27: Transform
 * 
 * To transform a permanent, turn it over so that its other face is up. Only
 * permanents represented by double-faced tokens and double-faced cards can transform.
 * 
 * Reference: Rule 701.27, also see Rule 712 "Double-Faced Cards"
 */

import { entersBattlefieldTransformedWithInstantOrSorceryBackFace as resolveIorSBackFaceFromStack } from '../enterBattlefieldTransformedOrConverted';

export interface TransformAction {
  readonly type: 'transform';
  readonly permanentId: string;
  readonly fromFace: 'front' | 'back';
  readonly toFace: 'front' | 'back';
}

export interface TransformResult {
  readonly permanentId: string;
  readonly fromFace: 'front' | 'back';
  readonly toFace: 'front' | 'back';
  readonly legal: boolean;
  readonly transformedPermanent: boolean;
  readonly fromAbilityAllowed: boolean;
}

/**
 * Rule 701.27a: Transform a permanent
 * 
 * To transform a permanent, turn it over so that its other face is up. Only
 * permanents represented by double-faced tokens and double-faced cards can transform.
 */
export function transformPermanent(
  permanentId: string,
  currentFace: 'front' | 'back'
): TransformAction {
  return {
    type: 'transform',
    permanentId,
    fromFace: currentFace,
    toFace: currentFace === 'front' ? 'back' : 'front',
  };
}

/**
 * Rule 701.27b: Transform vs face up/down
 * 
 * Although transforming a permanent uses the same physical action as turning a
 * permanent face up or face down, they are different game actions. Abilities
 * that trigger when a permanent is turned face down won't trigger when that
 * permanent transforms, and so on.
 */
export const TRANSFORM_IS_DIFFERENT_FROM_FACE_DOWN = true;

/**
 * Rule 701.27c: A permanent that transforms doesn't become a new object.
 * Effects that applied to it continue to apply.
 */
export const TRANSFORM_DOES_NOT_CREATE_NEW_OBJECT = true;

/**
 * Rule 701.27d / 701.27e / 713.1c: Only double-faced objects can transform.
 * Instant or sorcery faces, and meld cards or melded permanents, cannot.
 */
export function canTransform(
  permanent: { isDoubleFaced: boolean; isInstantOrSorcery?: boolean; isMeldCard?: boolean; isMelded?: boolean }
): boolean {
  // Rule 713.1c: Meld cards cannot be transformed or converted.
  if (permanent.isMeldCard || permanent.isMelded) return false;
  // Rule 701.27e: Can't transform into an instant or sorcery face
  if (permanent.isInstantOrSorcery) return false;
  // Rule 701.27d: Non-double-faced objects do not transform
  return permanent.isDoubleFaced;
}

/**
 * Rule 701.27g: Transform only once per ability
 * 
 * If an activated or triggered ability of a permanent tries to transform it,
 * the permanent does so only if it hasn't transformed or converted since the
 * ability was put onto the stack.
 */
export function canTransformFromAbility(
  permanentId: string,
  abilityStackTimestamp: number,
  lastTransformTimestamp: number | null
): boolean {
  if (lastTransformTimestamp === null) return true;
  return lastTransformTimestamp < abilityStackTimestamp;
}

/**
 * Rule 701.27h: Transformed permanent definition
 * 
 * Some spells and abilities refer to a "transformed permanent." This phrase
 * refers to a double-faced permanent on the battlefield with its back face up.
 * A permanent with its front face up is never considered a transformed permanent.
 */
export function isTransformedPermanent(
  permanent: { 
    isDoubleFaced: boolean;
    currentFace: 'front' | 'back';
    isMelded?: boolean;
  }
): boolean {
  // Rule 701.27h: Melded/merged permanents are not transformed permanents
  if (permanent.isMelded) return false;
  
  // Must be double-faced with back face up
  return permanent.isDoubleFaced && permanent.currentFace === 'back';
}

/**
 * Rule 701.27f: Transform into triggers
 * 
 * Some triggered abilities trigger when an object "transforms into" an object
 * with a specified characteristic. Such an ability triggers if the object
 * either transforms or converts and has the specified characteristic immediately
 * after it does so.
 */
export function checkTransformIntoTrigger(
  permanentId: string,
  newFace: 'front' | 'back',
  hasCharacteristic: boolean
): boolean {
  // Triggers if has the characteristic after transforming
  return hasCharacteristic;
}

export function createTransformResult(
  action: TransformAction,
  permanent: { isDoubleFaced: boolean; isInstantOrSorcery?: boolean; isMelded?: boolean },
  abilityStackTimestamp?: number,
  lastTransformTimestamp: number | null = null,
): TransformResult {
  const legal = canTransform(permanent);
  const fromAbilityAllowed = abilityStackTimestamp === undefined
    ? true
    : canTransformFromAbility(action.permanentId, abilityStackTimestamp, lastTransformTimestamp);

  return {
    permanentId: action.permanentId,
    fromFace: action.fromFace,
    toFace: action.toFace,
    legal,
    transformedPermanent: legal && action.toFace === 'back' && !permanent.isMelded,
    fromAbilityAllowed,
  };
}


/**
 * Rule 701.27i: An "As [this permanent] transforms..." ability is applied while
 * the permanent is transforming or converting, not afterward.
 */
export function asTransformsAbilityAppliesWhileChangingFaces(): boolean {
  return true;
}

/**
 * Rule 701.27j: If a double-faced spell would enter the battlefield transformed
 * and its back face is an instant or sorcery, it is put into its owner's
 * graveyard instead. This is an exception to 712.10.
 */
export function entersBattlefieldTransformedWithInstantOrSorceryBackFace(
  backFaceIsInstantOrSorcery: boolean,
): 'graveyard' | 'battlefield' {
  return resolveIorSBackFaceFromStack(backFaceIsInstantOrSorcery);
}
