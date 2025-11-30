/**
 * cards/graveyardReturnCards.ts
 * 
 * Cards that return cards from graveyard.
 */

export interface GraveyardReturnConfig {
  readonly cardName: string;
  readonly returnType: string;
  readonly returnCount: number | 'all';
  readonly destination: 'hand' | 'battlefield' | 'top';
  readonly requiresTap?: boolean;
  readonly tapCount?: number;
  readonly tapType?: string;
}

export const GRAVEYARD_RETURN_CARDS: Record<string, GraveyardReturnConfig> = {
  'summon the school': {
    cardName: 'Summon the School',
    returnType: 'Merfolk',
    returnCount: 1,
    destination: 'hand',
    requiresTap: true,
    tapCount: 4,
    tapType: 'Merfolk',
  },
  "patriarch's bidding": {
    cardName: "Patriarch's Bidding",
    returnType: 'chosen type',
    returnCount: 'all',
    destination: 'battlefield',
  },
  'rally the ancestors': {
    cardName: 'Rally the Ancestors',
    returnType: 'creature with CMC X or less',
    returnCount: 'all',
    destination: 'battlefield',
  },
};

export function hasGraveyardReturn(cardName: string): boolean {
  return cardName.toLowerCase() in GRAVEYARD_RETURN_CARDS;
}

export function getGraveyardReturnConfig(cardName: string): GraveyardReturnConfig | undefined {
  return GRAVEYARD_RETURN_CARDS[cardName.toLowerCase()];
}
