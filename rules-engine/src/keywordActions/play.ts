/**
 * Rule 701.18: Play
 * 
 * To play a land means to put it onto the battlefield from the zone it's in
 * (usually the hand). To play a card means to play that card as a land or to
 * cast that card as a spell, whichever is appropriate.
 * 
 * Reference: Rule 701.18, also see Rule 305 "Lands"
 */

export interface PlayAction {
  readonly type: 'play';
  readonly cardId: string;
  readonly playType: 'land' | 'spell';
  readonly playerId: string;
  readonly fromZone: string;
}

/**
 * Rule 701.18a: Play a land
 * 
 * To play a land means to put it onto the battlefield from the zone it's in
 * (usually the hand). A player may play a land if they have priority during
 * their main phase while the stack is empty and they haven't played a land yet
 * this turn (unless an effect allows them to play additional lands).
 */
export function playLand(
  cardId: string,
  playerId: string,
  fromZone: string = 'hand'
): PlayAction {
  return {
    type: 'play',
    cardId,
    playType: 'land',
    playerId,
    fromZone,
  };
}

/**
 * Rule 701.18b: Play a card
 * 
 * To play a card means to play that card as a land or to cast that card as a
 * spell, whichever is appropriate.
 */
export function playCard(
  cardId: string,
  playerId: string,
  playType: 'land' | 'spell',
  fromZone: string = 'hand'
): PlayAction {
  return {
    type: 'play',
    cardId,
    playType,
    playerId,
    fromZone,
  };
}

/**
 * Rule 701.18c: Play without paying mana cost
 * 
 * Some effects allow a player to "play" a card or "play" a land. These effects
 * are synonymous with playing that card as a land or casting that card as a
 * spell, whichever is appropriate.
 */
export function canPlay(
  cardType: string,
  hasPriority: boolean,
  isMainPhase: boolean,
  stackEmpty: boolean,
  landsPlayedThisTurn: number,
  additionalLandPlays: number
): boolean {
  if (cardType === 'land') {
    // Rule 305.1: Can play land during main phase with priority and empty stack
    return (
      hasPriority &&
      isMainPhase &&
      stackEmpty &&
      landsPlayedThisTurn < 1 + additionalLandPlays
    );
  }
  // For spells, check casting rules (Rule 601)
  return hasPriority;
}
