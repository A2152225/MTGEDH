/**
 * Rule 712: Double-Faced Cards
 * 
 * Implements the comprehensive rules for double-faced cards (DFCs), including
 * transforming double-faced cards (TDFCs), modal double-faced cards (MDFCs),
 * and other double-faced card mechanics.
 * 
 * References: MagicCompRules 20251114.txt, Rule 712
 */

/**
 * The two faces of a double-faced card.
 * Rule 712.1a: Each face has its own set of characteristics
 */
export type CardFace = 'front' | 'back';

/**
 * Type of double-faced card.
 * Rule 712.1b: There are transforming DFCs (TDFCs) and modal DFCs (MDFCs)
 */
export type DoubleFacedCardType = 'transforming' | 'modal';

/**
 * Characteristics that can differ between faces.
 * Rule 712.1a: Each face can have its own name, mana cost, color indicator,
 * type line, expansion symbol, text box, power, toughness, and loyalty.
 */
export interface FaceCharacteristics {
  readonly name: string;
  readonly manaCost: string | null;
  readonly colorIndicator: readonly string[] | null;
  readonly types: readonly string[];
  readonly subtypes: readonly string[];
  readonly supertypes: readonly string[];
  readonly rulesText: string;
  readonly power: number | null;
  readonly toughness: number | null;
  readonly loyalty: number | null;
}

/**
 * Represents a double-faced card.
 * Rule 712.1: A double-faced card has a Magic card face on each side
 */
export interface DoubleFacedCard {
  readonly type: DoubleFacedCardType;
  readonly frontFace: FaceCharacteristics;
  readonly backFace: FaceCharacteristics;
  readonly currentFace: CardFace;
  readonly isTransformed: boolean; // Only relevant for TDFCs
}

/**
 * Rule 712.2: Front face vs back face determination.
 * Rule 712.2a: The front face has a sun or moon symbol in its upper left corner
 * Rule 712.2b: A TDFC's back face has a full moon symbol or power/toughness
 * Rule 712.2c: An MDFC's back face has a full moon symbol in upper left corner
 */
export function determineFrontFace(
  face1: FaceCharacteristics,
  face2: FaceCharacteristics,
  type: DoubleFacedCardType
): { frontFace: FaceCharacteristics; backFace: FaceCharacteristics } {
  // In practice, this would check the actual card symbols/layout
  // For this implementation, we assume face1 is front, face2 is back
  return {
    frontFace: face1,
    backFace: face2
  };
}

/**
 * Rule 712.3: A transforming double-faced card's back face can be a permanent or instant/sorcery.
 */
export function isTransformingDoubleFacedCard(card: DoubleFacedCard): boolean {
  return card.type === 'transforming';
}

/**
 * Rule 712.4: A modal double-faced card's back face can be any card type.
 */
export function isModalDoubleFacedCard(card: DoubleFacedCard): boolean {
  return card.type === 'modal';
}

/**
 * Rule 712.4a: While outside the game, a modal DFC is only its front face.
 */
export function getModalDFCCharacteristicsOutsideGame(card: DoubleFacedCard): FaceCharacteristics {
  if (card.type !== 'modal') {
    throw new Error('Card is not a modal double-faced card');
  }
  return card.frontFace;
}

/**
 * Rule 712.4b: A modal DFC can be cast either face.
 */
export function chooseFaceToCast(
  card: DoubleFacedCard,
  chosenFace: CardFace
): DoubleFacedCard {
  if (card.type !== 'modal') {
    throw new Error('Only modal double-faced cards can choose which face to cast');
  }
  
  return {
    ...card,
    currentFace: chosenFace
  };
}

/**
 * Rule 712.4c: MDFC enters the battlefield on chosen face, can't be put on battlefield transformed.
 */
export function putModalDFCOntoBattlefield(
  card: DoubleFacedCard,
  chosenFace: CardFace
): DoubleFacedCard {
  if (card.type !== 'modal') {
    throw new Error('Card is not a modal double-faced card');
  }
  
  return {
    ...card,
    currentFace: chosenFace,
    isTransformed: false
  };
}

/**
 * Rule 712.4d: If a MDFC is a copy of another card, include front face characteristics.
 * Rule 712.4e: If another card is a copy of a MDFC permanent, it copies only the face that's up.
 */
export function getModalDFCCopyCharacteristics(
  card: DoubleFacedCard,
  copyingOtherCard: boolean
): FaceCharacteristics {
  if (card.type !== 'modal') {
    throw new Error('Card is not a modal double-faced card');
  }
  
  if (copyingOtherCard) {
    // Rule 712.4d: Copy includes front face characteristics
    return card.frontFace;
  } else {
    // Rule 712.4e: Others copy only the face that's up
    return card.currentFace === 'front' ? card.frontFace : card.backFace;
  }
}

/**
 * Rule 712.5: One MDFC remains only that object.
 * Rule 712.5a: Characteristics from only one face apply at a time.
 */
export function getCurrentFaceCharacteristics(card: DoubleFacedCard): FaceCharacteristics {
  return card.currentFace === 'front' ? card.frontFace : card.backFace;
}

/**
 * Rule 712.6: Some cards have back faces that aren't normal Magic card faces.
 * Rule 712.6a: Substitute card back face, meld card back face, etc.
 */
export interface SpecialBackFace {
  readonly type: 'substitute' | 'meld' | 'other';
  readonly characteristics: FaceCharacteristics | null;
}

/**
 * Rule 712.7: A TDFC's back face is not a second card.
 */
export function isSecondCard(card: DoubleFacedCard): boolean {
  // Rule 712.7: Back face is not a separate card
  return false;
}

/**
 * Rule 712.7a: While outside the game, TDFCs have only front face characteristics.
 */
export function getTransformingDFCCharacteristicsOutsideGame(
  card: DoubleFacedCard
): FaceCharacteristics {
  if (card.type !== 'transforming') {
    throw new Error('Card is not a transforming double-faced card');
  }
  return card.frontFace;
}

/**
 * Rule 712.7b: TDFC can only be cast using front face.
 */
export function canCastFace(card: DoubleFacedCard, face: CardFace): boolean {
  if (card.type === 'modal') {
    // MDFCs can cast either face (Rule 712.4b)
    return true;
  } else {
    // TDFCs can only cast front face (Rule 712.7b)
    return face === 'front';
  }
}

/**
 * Rule 712.7c: TDFC enters the battlefield with front face up.
 */
export function putTransformingDFCOntoBattlefield(
  card: DoubleFacedCard
): DoubleFacedCard {
  if (card.type !== 'transforming') {
    throw new Error('Card is not a transforming double-faced card');
  }
  
  return {
    ...card,
    currentFace: 'front',
    isTransformed: false
  };
}

/**
 * Rule 712.7d: If TDFC enters transformed, it enters with back face up.
 */
export function putTransformingDFCOntoBattlefieldTransformed(
  card: DoubleFacedCard
): DoubleFacedCard {
  if (card.type !== 'transforming') {
    throw new Error('Card is not a transforming double-faced card');
  }
  
  return {
    ...card,
    currentFace: 'back',
    isTransformed: true
  };
}

/**
 * Rule 712.7e: If TDFC would be put onto battlefield as a copy, enters with front face.
 */
export function putTransformingDFCAsCopyOntoBattlefield(
  card: DoubleFacedCard
): DoubleFacedCard {
  if (card.type !== 'transforming') {
    throw new Error('Card is not a transforming double-faced card');
  }
  
  return {
    ...card,
    currentFace: 'front',
    isTransformed: false
  };
}

/**
 * Rule 712.8: While on the battlefield, tokens can be transforming DFCs.
 * Rule 712.8a: Token copy of TDFC enters front face up.
 */
export function createTransformingTokenCopy(
  card: DoubleFacedCard
): DoubleFacedCard {
  if (card.type !== 'transforming') {
    throw new Error('Card is not a transforming double-faced card');
  }
  
  return {
    ...card,
    currentFace: 'front',
    isTransformed: false
  };
}

/**
 * Rule 712.9: TDFC's back face may have characteristics not found on front.
 */
export function hasCharacteristicOnBackFaceOnly(
  card: DoubleFacedCard,
  characteristic: keyof FaceCharacteristics
): boolean {
  if (card.type !== 'transforming') {
    return false;
  }
  
  const frontValue = card.frontFace[characteristic];
  const backValue = card.backFace[characteristic];
  
  return frontValue === null && backValue !== null;
}

/**
 * Rule 712.10: To transform a permanent, turn it over so opposite face is up.
 * Rule 712.10a: Only TDFCs and tokens can transform.
 */
export function transformPermanent(card: DoubleFacedCard): DoubleFacedCard {
  if (card.type !== 'transforming') {
    throw new Error('Only transforming double-faced cards can transform');
  }
  
  return {
    ...card,
    currentFace: card.currentFace === 'front' ? 'back' : 'front',
    isTransformed: card.currentFace === 'front' // true if now showing back face
  };
}

/**
 * Rule 712.10b: One permanent transforming doesn't affect other permanents.
 */
export function canTransformIndependently(): boolean {
  // Each permanent transforms independently
  return true;
}

/**
 * Rule 712.11: Double-faced Planeswalker cards can be cast face up.
 */
export function canCastPlaneswalkerFaceUp(card: DoubleFacedCard): boolean {
  const currentFace = getCurrentFaceCharacteristics(card);
  return currentFace.types.includes('Planeswalker');
}

/**
 * Rule 712.12: Double-faced permanents can't be turned face down.
 */
export function canBeTurnedFaceDown(card: DoubleFacedCard): boolean {
  // Rule 712.12: DFCs can't be turned face down
  return false;
}

/**
 * Rule 712.13: If effect references front/back face, applies to both TDFC and MDFC.
 */
export function applyEffectToFace(
  card: DoubleFacedCard,
  face: CardFace,
  effectFunction: (face: FaceCharacteristics) => FaceCharacteristics
): DoubleFacedCard {
  if (face === 'front') {
    return {
      ...card,
      frontFace: effectFunction(card.frontFace)
    };
  } else {
    return {
      ...card,
      backFace: effectFunction(card.backFace)
    };
  }
}

/**
 * Rule 712.14: Name of TDFC is front face name only.
 * Rule 712.14a: Name of TDFC is front face name in all zones except battlefield.
 */
export function getDoubleFacedCardName(
  card: DoubleFacedCard,
  onBattlefield: boolean
): string {
  if (card.type === 'transforming') {
    if (onBattlefield) {
      // On battlefield, use current face name
      return getCurrentFaceCharacteristics(card).name;
    } else {
      // In other zones, use front face name
      return card.frontFace.name;
    }
  } else {
    // Modal DFC uses current face name
    return getCurrentFaceCharacteristics(card).name;
  }
}

/**
 * Rule 712.14b: Effect referencing TDFC by name refers only to front face.
 */
export function doesEffectReferenceCard(
  card: DoubleFacedCard,
  referencedName: string
): boolean {
  if (card.type === 'transforming') {
    // Only front face name matches
    return card.frontFace.name === referencedName;
  } else {
    // MDFC can match either face name
    return card.frontFace.name === referencedName || card.backFace.name === referencedName;
  }
}

/**
 * Rule 712.15: Mana cost of TDFC is front face cost.
 * Rule 712.15a: While on battlefield, use current face mana cost.
 */
export function getDoubleFacedCardManaCost(
  card: DoubleFacedCard,
  onBattlefield: boolean
): string | null {
  if (card.type === 'transforming') {
    if (onBattlefield) {
      // On battlefield, use current face mana cost
      return getCurrentFaceCharacteristics(card).manaCost;
    } else {
      // In other zones, use front face mana cost
      return card.frontFace.manaCost;
    }
  } else {
    // Modal DFC uses current face mana cost
    return getCurrentFaceCharacteristics(card).manaCost;
  }
}

/**
 * Rule 712.16: Facedown TDFC that transforms uses back face.
 */
export function transformFaceDownPermanent(
  card: DoubleFacedCard,
  isFaceDown: boolean
): DoubleFacedCard {
  if (!isFaceDown) {
    throw new Error('Card is not face down');
  }
  
  if (card.type !== 'transforming') {
    throw new Error('Only transforming double-faced cards can transform while face down');
  }
  
  // Rule 712.16: Face-down TDFC that transforms has characteristics of back face
  return {
    ...card,
    currentFace: 'back',
    isTransformed: true
  };
}

/**
 * Rule 712.17: If TDFC is a copy of another permanent, use copiable values.
 * The other card's characteristics override front face.
 */
export function transformingDFCBecomesACopy(
  card: DoubleFacedCard,
  copiedCharacteristics: FaceCharacteristics
): DoubleFacedCard {
  if (card.type !== 'transforming') {
    throw new Error('Card is not a transforming double-faced card');
  }
  
  // Rule 712.17: Copy values override front face characteristics
  return {
    ...card,
    frontFace: copiedCharacteristics,
    currentFace: 'front',
    isTransformed: false
  };
}

/**
 * Helper: Check if a card is currently transformed.
 */
export function isTransformed(card: DoubleFacedCard): boolean {
  return card.isTransformed;
}

/**
 * Helper: Check if permanent can transform.
 */
export function canTransform(card: DoubleFacedCard): boolean {
  // Rule 712.10a: Only TDFCs can transform
  return card.type === 'transforming';
}

/**
 * Helper: Get both face names for searching/filtering.
 */
export function getAllFaceNames(card: DoubleFacedCard): readonly string[] {
  return [card.frontFace.name, card.backFace.name];
}

/**
 * Helper: Check if card has a specific characteristic on either face.
 */
export function hasCharacteristicOnAnyFace(
  card: DoubleFacedCard,
  checkFunction: (face: FaceCharacteristics) => boolean
): boolean {
  return checkFunction(card.frontFace) || checkFunction(card.backFace);
}
