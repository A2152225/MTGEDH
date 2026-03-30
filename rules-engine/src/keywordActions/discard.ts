/**
 * Rule 701.9: Discard
 * 
 * To discard a card, move it from its owner's hand to that player's graveyard.
 */

export interface DiscardAction {
  readonly type: 'discard';
  readonly playerId: string;
  readonly mode: 'choice' | 'random' | 'opponent-choice';
  readonly cardId?: string; // Specified for choice/opponent-choice modes
  readonly discarderId?: string; // Player who chooses (for opponent-choice)
}

/**
 * Rule 701.9b: Discard modes
 * 
 * By default, effects that cause a player to discard a card allow the affected
 * player to choose which card to discard. Some effects, however, require a
 * random discard or allow another player to choose which card is discarded.
 */
export function discardCard(
  playerId: string,
  cardId: string
): DiscardAction {
  return {
    type: 'discard',
    playerId,
    mode: 'choice',
    cardId,
  };
}

export function discardRandom(playerId: string): DiscardAction {
  return {
    type: 'discard',
    playerId,
    mode: 'random',
  };
}

export function discardChosen(
  playerId: string,
  discarderId: string,
  cardId: string
): DiscardAction {
  return {
    type: 'discard',
    playerId,
    mode: 'opponent-choice',
    cardId,
    discarderId,
  };
}

/**
 * Rule 701.9c: Hidden zone handling
 * 
 * If a card is discarded, but an effect causes it to be put into a hidden zone
 * instead of into its owner's graveyard without being revealed, all values of
 * that card's characteristics are considered to be undefined.
 */
export interface DiscardResult {
  readonly discarded: boolean;
  readonly destination: 'graveyard' | 'hidden-zone';
  readonly revealed: boolean;
  readonly characteristicsDefined: boolean;
}

export interface DiscardResolution extends DiscardResult {
  readonly playerId: string;
  readonly mode: DiscardAction['mode'];
  readonly cardId?: string;
}

export function getDiscardResult(
  destination: 'graveyard' | 'hidden-zone',
  revealed: boolean
): DiscardResult {
  return {
    discarded: true,
    destination,
    revealed,
    // Rule 701.9c: If hidden and not revealed, characteristics are undefined
    characteristicsDefined: destination === 'graveyard' || revealed,
  };
}

export function requiresDiscardChoice(mode: DiscardAction['mode']): boolean {
  return mode !== 'random';
}

export function createDiscardResolution(
  action: DiscardAction,
  destination: 'graveyard' | 'hidden-zone',
  revealed: boolean
): DiscardResolution {
  return {
    playerId: action.playerId,
    mode: action.mode,
    cardId: action.cardId,
    ...getDiscardResult(destination, revealed),
  };
}
