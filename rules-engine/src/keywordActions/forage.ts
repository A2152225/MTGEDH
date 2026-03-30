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

export interface ForageResult {
  readonly playerId: string;
  readonly method: 'exile' | 'sacrifice' | 'none';
  readonly paidCost: boolean;
  readonly exiledCardCount: number;
  readonly sacrificedFood?: string;
}

type FoodLike = {
  readonly isFood?: boolean;
  readonly type_line?: string;
  readonly card?: {
    readonly type_line?: string;
  };
};

export const FORAGE_EXILE_COUNT = 3;

function isFoodLike(permanent: FoodLike): boolean {
  if (permanent.isFood === true) {
    return true;
  }

  const typeLine = String(permanent.type_line || permanent.card?.type_line || '').toLowerCase();
  return typeLine.includes('food');
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

/**
 * Exiling for forage requires exactly three graveyard cards.
 */
export function isValidForageExile(exiledCards: readonly string[]): boolean {
  return exiledCards.length === FORAGE_EXILE_COUNT;
}

/**
 * Check whether a permanent can be sacrificed for forage.
 */
export function canSacrificeFoodForForage(permanent: FoodLike | null | undefined): boolean {
  return Boolean(permanent) && isFoodLike(permanent);
}

/**
 * Identify which forage branch was used.
 */
export function getForageMethod(action: ForageAction): 'exile' | 'sacrifice' | 'none' {
  if (action.exiledCards && action.exiledCards.length > 0) {
    return 'exile';
  }

  if (action.sacrificedFood) {
    return 'sacrifice';
  }

  return 'none';
}

export function createForageResult(action: ForageAction): ForageResult {
  const method = getForageMethod(action);

  return {
    playerId: action.playerId,
    method,
    paidCost: method !== 'none',
    exiledCardCount: action.exiledCards?.length || 0,
    sacrificedFood: action.sacrificedFood,
  };
}
