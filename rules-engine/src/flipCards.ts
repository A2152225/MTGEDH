/**
 * Rule 710: Flip Cards
 * 
 * Implements the rules for flip cards, which have alternative characteristics
 * printed upside-down on the card that become active when the permanent flips.
 * 
 * Reference: MagicCompRules 20251114.txt, Rule 710
 */

/**
 * Represents the characteristics of one side of a flip card.
 */
export interface FlipCardCharacteristics {
  readonly name: string;
  readonly textBox: string;
  readonly types: readonly string[];
  readonly subtypes: readonly string[];
  readonly supertypes: readonly string[];
  readonly power: number | null;
  readonly toughness: number | null;
}

/**
 * Represents a flip card.
 * 
 * Rule 710.1: Flip cards have a two-part card frame on a single card.
 */
export interface FlipCard {
  readonly type: 'flip-card';
  readonly normalSide: FlipCardCharacteristics;
  readonly flippedSide: FlipCardCharacteristics;
  readonly color: readonly string[];
  readonly manaCost: string;
}

/**
 * Represents a flip card permanent on the battlefield.
 */
export interface FlipCardPermanent {
  readonly id: string;
  readonly card: FlipCard;
  readonly isFlipped: boolean;
  readonly controller: string;
}

/**
 * Gets the current characteristics of a flip card permanent (Rule 710.2).
 * 
 * On battlefield before flipping: uses normal characteristics
 * On battlefield after flipping: uses flipped characteristics
 */
export function getFlipCardCharacteristics(
  permanent: FlipCardPermanent
): FlipCardCharacteristics {
  return permanent.isFlipped 
    ? permanent.card.flippedSide 
    : permanent.card.normalSide;
}

/**
 * Gets a flip card's characteristics in non-battlefield zones (Rule 710.2).
 * 
 * In every zone except the battlefield, uses only normal characteristics.
 */
export function getFlipCardCharacteristicsInZone(
  card: FlipCard,
  zone: string
): FlipCardCharacteristics {
  // Always use normal side in non-battlefield zones
  return card.normalSide;
}

/**
 * Flips a permanent (Rule 710.4).
 * 
 * Flipping is a one-way process - once flipped, cannot become unflipped.
 */
export function flipPermanent(permanent: FlipCardPermanent): FlipCardPermanent {
  if (permanent.isFlipped) {
    return permanent; // Already flipped
  }
  
  return {
    ...permanent,
    isFlipped: true,
  };
}

/**
 * Checks if flipping is possible.
 * 
 * Rule 710.4: Once flipped, impossible to become unflipped.
 */
export function canFlip(permanent: FlipCardPermanent): boolean {
  return !permanent.isFlipped;
}

/**
 * Resets flip status when permanent leaves battlefield (Rule 710.4).
 * 
 * If a flipped permanent leaves the battlefield, it retains no memory
 * of its status (Rule 110.5).
 */
export function resetFlipStatus(card: FlipCard): FlipCard {
  // Card itself doesn't track flip status - only permanents do
  // This is just for clarity
  return card;
}

/**
 * Gets the color of a flip card (Rule 710.1c).
 * 
 * Color doesn't change when flipped.
 */
export function getFlipCardColor(card: FlipCard): readonly string[] {
  return card.color;
}

/**
 * Gets the mana cost of a flip card (Rule 710.1c).
 * 
 * Mana cost doesn't change when flipped.
 */
export function getFlipCardManaCost(card: FlipCard): string {
  return card.manaCost;
}

/**
 * Creates a flip card permanent entering the battlefield.
 */
export function createFlipCardPermanent(
  id: string,
  card: FlipCard,
  controller: string
): FlipCardPermanent {
  return {
    id,
    card,
    isFlipped: false,
    controller,
  };
}

/**
 * Checks if a player can choose a flip card's alternative name (Rule 710.5).
 * 
 * When choosing a card name, player may choose the flipped side's name.
 */
export function canChooseFlippedName(card: FlipCard, chosenName: string): boolean {
  return chosenName === card.normalSide.name || chosenName === card.flippedSide.name;
}

/**
 * Gets the appropriate name for a flip card based on state.
 */
export function getFlipCardName(permanent: FlipCardPermanent): string {
  const characteristics = getFlipCardCharacteristics(permanent);
  return characteristics.name;
}

/**
 * Gets the appropriate power/toughness for a flip card based on state.
 */
export function getFlipCardPowerToughness(
  permanent: FlipCardPermanent
): { power: number | null; toughness: number | null } {
  const characteristics = getFlipCardCharacteristics(permanent);
  return {
    power: characteristics.power,
    toughness: characteristics.toughness,
  };
}

/**
 * Checks if a flip card permanent matches search criteria based on current state.
 * 
 * Example from Rule 710.2: "Search for a legendary card" can't find
 * Akki Lavarunner (not legendary) but can find Tok-Tok, Volcano Born (legendary).
 */
export function flipCardMatchesCriteria(
  permanent: FlipCardPermanent,
  criteria: (characteristics: FlipCardCharacteristics) => boolean
): boolean {
  const currentCharacteristics = getFlipCardCharacteristics(permanent);
  return criteria(currentCharacteristics);
}
