/**
 * Rule 701.27: Transform
 * 
 * To transform a permanent, turn it over so that its other face is up. Only
 * permanents represented by double-faced tokens and double-faced cards can transform.
 * 
 * Reference: Rule 701.27, also see Rule 712 "Double-Faced Cards"
 */

export interface TransformAction {
  readonly type: 'transform';
  readonly permanentId: string;
  readonly fromFace: 'front' | 'back';
  readonly toFace: 'front' | 'back';
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
 * Rule 701.27c: Can only transform double-faced objects
 * 
 * If a spell or ability instructs a player to transform a permanent that isn't
 * represented by a double-faced token or a double-faced card, nothing happens.
 */
export function canTransform(
  permanent: { isDoubleFaced: boolean; isInstantOrSorcery?: boolean }
): boolean {
  // Rule 701.27d: Can't transform into instant/sorcery face
  if (permanent.isInstantOrSorcery) return false;
  
  return permanent.isDoubleFaced;
}

/**
 * Rule 701.27f: Transform only once per ability
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
 * Rule 701.27g: Transformed permanent definition
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
  // Rule 701.27g: Melded/merged permanents are not transformed permanents
  if (permanent.isMelded) return false;
  
  // Must be double-faced with back face up
  return permanent.isDoubleFaced && permanent.currentFace === 'back';
}

/**
 * Rule 701.27e: Transform into triggers
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
