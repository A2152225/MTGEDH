/**
 * Rule 701.61: Forage
 * 
 * To forage means "Exile three cards from your graveyard or sacrifice a Food."
 * 
 * Reference: Rule 701.61
 */

export interface ForageAction {
  readonly type: 'forage';
  readonly playerId: string;
  readonly exiledCards?: readonly string[];
  readonly sacrificedFood?: string;
}

/**
 * Rule 701.61a: Forage
 */
export function forageByExiling(
  playerId: string,
  exiledCards: readonly string[]
): ForageAction {
  return {
    type: 'forage',
    playerId,
    exiledCards,
  };
}

export function forageBySacrificing(
  playerId: string,
  sacrificedFood: string
): ForageAction {
  return {
    type: 'forage',
    playerId,
    sacrificedFood,
  };
}

/**
 * Check if can forage
 */
export function canForage(
  graveyardCount: number,
  controlledFoodCount: number
): boolean {
  return graveyardCount >= 3 || controlledFoodCount > 0;
}
