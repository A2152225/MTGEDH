/**
 * Casual Variants - Rules 901-904
 * Implementation of casual Magic variants including Planechase, Commander, and Archenemy
 * Reference: Magic: The Gathering Comprehensive Rules (November 14, 2025)
 */

// ============================================================================
// Rule 901: Planechase Variant
// ============================================================================

/**
 * Rule 901.1 - Planechase variant with planar deck
 */
export interface PlanechaseGame {
  readonly planarDeck: readonly string[]; // Plane and phenomenon cards
  readonly currentPlane: string | null;
  readonly planarDeckFaceDown: readonly string[];
  readonly planeswalkedThisTurn: boolean;
  readonly planeswalksAttempted: number; // For cost tracking
}

/**
 * Rule 901.3 - Planar die results
 */
export type PlanarDieResult = 'chaos' | 'planeswalk' | 'blank';

/**
 * Rule 901.2 - Create planar deck (minimum 10 cards)
 */
export function createPlanarDeck(planeCards: readonly string[]): readonly string[] {
  if (planeCards.length < 10) {
    throw new Error('Planar deck must contain at least 10 plane and/or phenomenon cards');
  }
  return planeCards;
}

/**
 * Rule 901.3 - Roll the planar die
 */
export function rollPlanarDie(): PlanarDieResult {
  const roll = Math.floor(Math.random() * 6);
  if (roll === 0) return 'planeswalk'; // ⚀ symbol
  if (roll === 1) return 'chaos'; // Chaos symbol
  return 'blank'; // Blank faces (4 of them)
}

/**
 * Rule 901.5 - Execute planeswalking (special action)
 */
export function executePlaneswalking(
  game: PlanechaseGame,
  playerId: string
): PlanechaseGame {
  if (game.planarDeckFaceDown.length === 0) {
    // Shuffle planes in exile to create new deck
    return { ...game, planeswalkedThisTurn: true };
  }

  const [newPlane, ...remainingDeck] = game.planarDeckFaceDown;
  return {
    ...game,
    currentPlane: newPlane,
    planarDeckFaceDown: remainingDeck,
    planeswalkedThisTurn: true,
    planeswalksAttempted: game.planeswalksAttempted + 1,
  };
}

/**
 * Rule 901.4 - Trigger chaos ability on current plane
 */
export function triggerChaosAbility(game: PlanechaseGame): void {
  // Chaos ability is triggered (implementation depends on specific plane)
  // This function marks that the trigger should occur
}

/**
 * Rule 901.7 - Handle phenomenon card
 */
export function handlePhenomenon(game: PlanechaseGame): PlanechaseGame {
  // Phenomenon triggers when revealed, then planeswalk again
  return executePlaneswalking(game, 'activePlayer');
}

/**
 * Rule 901.14 - Calculate planeswalk cost
 * First planeswalk each turn costs {0}, subsequent cost {1}, {2}, {3}...
 */
export function getPlaneswalkCost(planeswalksAttempted: number): number {
  return Math.max(0, planeswalksAttempted - 1);
}

// ============================================================================
// Rule 903: Commander Variant
// ============================================================================

/**
 * Rule 903.3 - Commander designation
 */
export interface Commander {
  readonly cardName: string;
  readonly isLegendary: boolean;
  readonly colorIdentity: readonly string[]; // W, U, B, R, G
  readonly canBeCommander: boolean;
  readonly timesCommanderCast: number; // For tax calculation
}

/**
 * Rule 903.5 - Commander deck
 */
export interface CommanderDeck {
  readonly commanders: readonly Commander[]; // 1 or 2 (with partner)
  readonly deck: readonly string[]; // Must be exactly 99 or 98 cards
  readonly colorIdentity: readonly string[];
}

/**
 * Rule 903.10 - Commander damage tracking
 */
export interface CommanderDamage {
  readonly playerDealtTo: string;
  readonly commanderName: string;
  readonly damageDealt: number;
}

/**
 * Rule 903.4 - Get color identity from card
 */
export function getColorIdentity(card: {
  manaCost?: string;
  rulesText?: string;
  colorIndicator?: readonly string[];
  type?: string;
}): readonly string[] {
  const colors = new Set<string>();

  // Mana symbols in cost
  if (card.manaCost) {
    const symbols = card.manaCost.match(/\{[WUBRG]\}/g) || [];
    symbols.forEach((symbol) => colors.add(symbol[1]));
  }

  // Mana symbols in rules text
  if (card.rulesText) {
    const symbols = card.rulesText.match(/\{[WUBRG]\}/g) || [];
    symbols.forEach((symbol) => colors.add(symbol[1]));
  }

  // Color indicator
  if (card.colorIndicator) {
    card.colorIndicator.forEach((color) => colors.add(color));
  }

  return Array.from(colors).sort();
}

/**
 * Rule 903.5 - Validate commander deck construction
 */
export function validateCommanderDeck(deck: CommanderDeck): {
  valid: boolean;
  errors: readonly string[];
} {
  const errors: string[] = [];

  // Check deck size (100 cards total)
  const totalCards = deck.commanders.length + deck.deck.length;
  if (totalCards !== 100) {
    errors.push(`Deck must contain exactly 100 cards (has ${totalCards})`);
  }

  // Check singleton (except basic lands)
  const cardCounts = new Map<string, number>();
  deck.deck.forEach((card) => {
    cardCounts.set(card, (cardCounts.get(card) || 0) + 1);
  });
  for (const [card, count] of cardCounts) {
    if (count > 1 && !isBasicLand(card)) {
      errors.push(`${card} appears ${count} times (singleton violation)`);
    }
  }

  // Check color identity
  // TODO: This check expects card color identity but deck.deck contains card names.
  // For now, we skip this validation as it would require resolving card names to color identities.
  // for (const card of deck.deck) {
  //   if (!canCardBeInCommanderDeck(card, deck.colorIdentity)) {
  //     errors.push(`${card} violates color identity`);
  //   }
  // }

  // Validate commanders
  for (const commander of deck.commanders) {
    if (!isValidCommander(commander)) {
      errors.push(`${commander.cardName} cannot be a commander`);
    }
  }

  // Validate partner
  if (deck.commanders.length === 2) {
    const partnerValid = validatePartners(deck.commanders[0], deck.commanders[1]);
    if (!partnerValid) {
      errors.push('Commanders do not have valid partner relationship');
    }
  } else if (deck.commanders.length > 2) {
    errors.push('Cannot have more than 2 commanders');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Rule 903.4 - Check if card can be in commander deck based on color identity
 */
export function canCardBeInCommanderDeck(
  cardColorIdentity: readonly string[],
  deckColorIdentity: readonly string[]
): boolean {
  return cardColorIdentity.every((color) => deckColorIdentity.includes(color));
}

/**
 * Rule 903.3 - Check if card is a valid commander
 */
export function isValidCommander(commander: Commander): boolean {
  return commander.isLegendary || commander.canBeCommander;
}

/**
 * Check if card is a basic land
 */
function isBasicLand(cardName: string): boolean {
  const basicLands = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes'];
  return basicLands.includes(cardName);
}

/**
 * Rule 903.8a - Calculate commander tax
 * {2} for each time cast from command zone previously
 */
export function calculateCommanderTax(commander: Commander): number {
  return commander.timesCommanderCast * 2;
}

/**
 * Rule 903.8 - Cast commander from command zone
 */
export function castCommanderFromCommandZone(commander: Commander): Commander {
  return {
    ...commander,
    timesCommanderCast: commander.timesCommanderCast + 1,
  };
}

/**
 * Rule 903.8 - Move commander to command zone (replacement effect)
 */
export function moveCommanderToCommandZone(
  commander: Commander,
  chooseCommandZone: boolean
): 'command' | 'normal' {
  // Player chooses whether to put in command zone or normal destination
  return chooseCommandZone ? 'command' : 'normal';
}

/**
 * Rule 903.10 - Track commander damage
 */
export function trackCommanderDamage(
  existingDamage: CommanderDamage,
  additionalDamage: number
): CommanderDamage {
  return {
    ...existingDamage,
    damageDealt: existingDamage.damageDealt + additionalDamage,
  };
}

/**
 * Rule 903.10 - Check if commander damage results in loss
 */
export function checkCommanderDamageWin(damage: CommanderDamage): boolean {
  return damage.damageDealt >= 21;
}

/**
 * Rule 903.3b-c - Validate partner commanders
 */
export function validatePartners(commander1: Commander, commander2: Commander): boolean {
  // Both must have partner, or partner with each other
  return hasPartner(commander1) && hasPartner(commander2);
}

/**
 * Check if commander has partner ability
 */
export function hasPartner(commander: Commander): boolean {
  // This would check for partner, partner with, friends forever, etc.
  // Simplified for this implementation
  return true; // Placeholder
}

/**
 * Rule 903.7 - Get starting life total for Commander
 */
export function getStartingLifeTotal(): number {
  return 40;
}

/**
 * Rule 903.5 - Get deck size requirement
 */
export function getDeckSizeRequirement(): number {
  return 100;
}

// ============================================================================
// Rule 904: Archenemy Variant
// ============================================================================

/**
 * Rule 904.1 - Archenemy game structure
 */
export interface ArchenemyGame {
  readonly archenemyPlayer: string;
  readonly teamPlayers: readonly string[];
  readonly schemeDeck: readonly string[];
  readonly ongoingSchemes: readonly string[];
  readonly schemeGraveyard: readonly string[];
}

/**
 * Rule 904.3 - Scheme card
 */
export interface SchemeCard {
  readonly name: string;
  readonly isOngoing: boolean;
  readonly abilities: readonly string[];
}

/**
 * Rule 904.1 - Setup archenemy game
 */
export function setupArchenemyGame(
  archenemyPlayer: string,
  teamPlayers: readonly string[]
): ArchenemyGame {
  if (teamPlayers.length < 1) {
    throw new Error('Archenemy game requires at least one team player');
  }

  return {
    archenemyPlayer,
    teamPlayers,
    schemeDeck: [],
    ongoingSchemes: [],
    schemeGraveyard: [],
  };
}

/**
 * Rule 904.3 - Create scheme deck (minimum 20 schemes)
 */
export function createSchemeDeck(schemes: readonly string[]): readonly string[] {
  if (schemes.length < 20) {
    throw new Error('Scheme deck must contain at least 20 scheme cards');
  }
  return schemes;
}

/**
 * Rule 904.4 - Set scheme in motion (turn-based action)
 */
export function setSchemeInMotion(game: ArchenemyGame): ArchenemyGame {
  if (game.schemeDeck.length === 0) {
    // Shuffle scheme graveyard to create new deck
    return game;
  }

  const [scheme, ...remainingDeck] = game.schemeDeck;
  
  // Check if ongoing or one-shot
  const isOngoing = checkIfOngoingScheme(scheme);

  if (isOngoing) {
    return {
      ...game,
      schemeDeck: remainingDeck,
      ongoingSchemes: [...game.ongoingSchemes, scheme],
    };
  } else {
    return {
      ...game,
      schemeDeck: remainingDeck,
      schemeGraveyard: [...game.schemeGraveyard, scheme],
    };
  }
}

/**
 * Check if scheme is ongoing
 */
function checkIfOngoingScheme(scheme: string): boolean {
  // This would check the scheme's type
  return false; // Placeholder
}

/**
 * Rule 904.7 - Abandon ongoing scheme
 */
export function abandonScheme(game: ArchenemyGame, schemeName: string): ArchenemyGame {
  const remainingSchemes = game.ongoingSchemes.filter((s) => s !== schemeName);
  return {
    ...game,
    ongoingSchemes: remainingSchemes,
    schemeGraveyard: [...game.schemeGraveyard, schemeName],
  };
}

/**
 * Rule 904.6 - Execute ongoing scheme effects
 */
export function executeOngoingScheme(scheme: SchemeCard): void {
  // Execute the ongoing scheme's static and triggered abilities
  // Implementation depends on specific scheme
}

/**
 * Rule 904.4a - Check if archenemy is active player
 */
export function canSetSchemeInMotion(
  game: ArchenemyGame,
  activePlayer: string
): boolean {
  return activePlayer === game.archenemyPlayer;
}
