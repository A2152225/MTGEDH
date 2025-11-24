/**
 * Rule 708: Face-Down Spells and Permanents
 * 
 * Implements the rules for objects that are face down, including morphing,
 * manifesting, cloaking, and other face-down mechanics.
 * 
 * Reference: MagicCompRules 20251114.txt, Rule 708
 */

/**
 * Represents the copiable characteristics of a face-down object.
 * 
 * Rule 708.2: Face-down spells and permanents have no characteristics
 * other than those listed by the ability or rules that allowed them to be face down.
 */
export interface FaceDownCharacteristics {
  readonly power: number | null;
  readonly toughness: number | null;
  readonly types: readonly string[];
  readonly subtypes: readonly string[];
  readonly name: string | null;
  readonly text: string | null;
  readonly manaCost: string | null;
  readonly colors: readonly string[];
}

/**
 * Represents a face-down permanent on the battlefield.
 */
export interface FaceDownPermanent {
  readonly id: string;
  readonly isFaceDown: true;
  readonly characteristics: FaceDownCharacteristics;
  readonly controller: string;
  readonly abilityThatTurnedItFaceDown: string | null;
  readonly orderEntered: number;
  readonly canBeTurnedFaceUp: boolean;
  readonly faceUpCharacteristics: object; // Hidden from other players
}

/**
 * Represents a face-down spell on the stack.
 */
export interface FaceDownSpell {
  readonly id: string;
  readonly isFaceDown: true;
  readonly characteristics: FaceDownCharacteristics;
  readonly controller: string;
  readonly orderCast: number;
  readonly faceUpCharacteristics: object; // Hidden from other players
}

/**
 * Creates default face-down characteristics (Rule 708.2a).
 * 
 * Default: 2/2 creature with no text, name, subtypes, or mana cost.
 */
export function getDefaultFaceDownCharacteristics(): FaceDownCharacteristics {
  return {
    power: 2,
    toughness: 2,
    types: ['Creature'],
    subtypes: [],
    name: null,
    text: null,
    manaCost: null,
    colors: [],
  };
}

/**
 * Creates custom face-down characteristics as specified by an ability.
 * 
 * Rule 708.2: Face-down objects have characteristics listed by the ability
 * that allowed them to be face down.
 */
export function createFaceDownCharacteristics(
  characteristics: Partial<FaceDownCharacteristics>
): FaceDownCharacteristics {
  const defaults = getDefaultFaceDownCharacteristics();
  return {
    power: characteristics.power ?? defaults.power,
    toughness: characteristics.toughness ?? defaults.toughness,
    types: characteristics.types ?? defaults.types,
    subtypes: characteristics.subtypes ?? defaults.subtypes,
    name: characteristics.name ?? defaults.name,
    text: characteristics.text ?? defaults.text,
    manaCost: characteristics.manaCost ?? defaults.manaCost,
    colors: characteristics.colors ?? defaults.colors,
  };
}

/**
 * Puts a permanent onto the battlefield face down (Rule 708.3).
 * 
 * Objects are turned face down BEFORE entering the battlefield,
 * so ETB abilities won't trigger.
 */
export function putPermanentFaceDown(
  permanentId: string,
  controller: string,
  characteristics: FaceDownCharacteristics,
  faceUpCharacteristics: object,
  orderEntered: number,
  abilitySource: string | null = null,
  canBeTurnedFaceUp: boolean = true
): FaceDownPermanent {
  return {
    id: permanentId,
    isFaceDown: true,
    characteristics,
    controller,
    abilityThatTurnedItFaceDown: abilitySource,
    orderEntered,
    canBeTurnedFaceUp,
    faceUpCharacteristics,
  };
}

/**
 * Casts a spell face down (Rule 708.4).
 * 
 * Objects are turned face down BEFORE being put onto the stack.
 */
export function castSpellFaceDown(
  spellId: string,
  controller: string,
  characteristics: FaceDownCharacteristics,
  faceUpCharacteristics: object,
  orderCast: number
): FaceDownSpell {
  return {
    id: spellId,
    isFaceDown: true,
    characteristics,
    controller,
    orderCast,
    faceUpCharacteristics,
  };
}

/**
 * Checks if a player can look at a face-down object (Rule 708.5).
 * 
 * A player can look at face-down spells they control on the stack
 * and face-down permanents they control (even if phased out).
 */
export function canPlayerLookAtFaceDownObject(
  playerId: string,
  objectController: string,
  zone: 'battlefield' | 'stack' | 'other'
): boolean {
  if (playerId !== objectController) {
    return false;
  }
  return zone === 'battlefield' || zone === 'stack';
}

/**
 * Attempts to turn a face-down permanent face down (Rule 708.2b).
 * 
 * A face-down permanent can't be turned face down. Nothing happens.
 */
export function attemptToTurnFaceDownPermanentFaceDown(
  permanent: FaceDownPermanent
): FaceDownPermanent {
  // Nothing happens, return unchanged
  return permanent;
}

/**
 * Turns a face-down permanent face up (Rule 708.8).
 * 
 * Copiable values revert to normal. Effects already applied still apply.
 * No ETB abilities trigger.
 */
export function turnPermanentFaceUp(
  permanent: FaceDownPermanent,
  faceUpObject: object
): object {
  // Return the face-up version of the permanent
  // Copiable values revert to normal
  // Any effects applied to face-down permanent still apply
  // No ETB abilities trigger
  return faceUpObject;
}

/**
 * Checks if a face-down object must be revealed (Rule 708.9).
 * 
 * Face-down permanents/spells must be revealed when:
 * - Moving from battlefield/stack to another zone
 * - Player leaves the game
 * - End of game
 */
export function mustRevealFaceDownObject(
  zone: string,
  movingTo: string | null,
  reason: 'moving' | 'player-leaving' | 'game-ending'
): boolean {
  if (reason === 'player-leaving' || reason === 'game-ending') {
    return true;
  }
  
  if (reason === 'moving' && movingTo !== null) {
    if (zone === 'battlefield') {
      return true; // Moving from battlefield to any zone
    }
    if (zone === 'stack' && movingTo !== 'battlefield') {
      return true; // Moving from stack to anywhere except battlefield
    }
  }
  
  return false;
}

/**
 * Handles a face-down permanent becoming a copy of another permanent (Rule 708.10).
 * 
 * Copiable values become those of the copied permanent, modified by face-down status.
 * Characteristics remain those listed by the ability that made it face down.
 */
export function faceDownPermanentBecomesACopy(
  faceDownPermanent: FaceDownPermanent,
  copiedPermanent: object,
  faceDownCharacteristics: FaceDownCharacteristics
): FaceDownPermanent {
  return {
    ...faceDownPermanent,
    characteristics: faceDownCharacteristics,
    // Copiable values are now from copied permanent, but modified by face-down status
    // If turned face up later, will have copied permanent's characteristics
    faceUpCharacteristics: copiedPermanent,
  };
}

/**
 * Applies "As [this permanent] is turned face up" abilities (Rule 708.11).
 * 
 * These abilities are applied WHILE the permanent is being turned face up,
 * not afterward.
 */
export function applyAsTurnedFaceUpAbility(
  permanent: FaceDownPermanent,
  abilityEffect: (perm: object) => object
): object {
  // Apply the ability while turning face up
  const faceUpPermanent = permanent.faceUpCharacteristics;
  return abilityEffect(faceUpPermanent);
}

/**
 * Gets revealed object characteristics for abilities that need information (Rule 708.12).
 * 
 * When revealing a face-down permanent for information, use characteristics
 * ignoring continuous effects.
 */
export function getRevealedCharacteristics(
  faceDownPermanent: FaceDownPermanent
): object {
  // Return characteristics ignoring continuous effects
  return faceDownPermanent.faceUpCharacteristics;
}
