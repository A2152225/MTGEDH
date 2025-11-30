/**
 * cards/searchEffects.ts
 * 
 * Cards that search libraries with special behavior.
 */

export interface SearchEffectConfig {
  readonly cardName: string;
  readonly searchType: string;
  readonly searchFilter: string;
  readonly destination: 'battlefield' | 'hand' | 'top' | 'bottom';
  readonly entersTapped: boolean;
  readonly countType?: 'lands' | 'creatures' | 'fixed';
  readonly countValue?: number;
}

export const SEARCH_EFFECT_CARDS: Record<string, SearchEffectConfig> = {
  "nature's lore": {
    cardName: "Nature's Lore",
    searchType: 'land',
    searchFilter: 'Forest',
    destination: 'battlefield',
    entersTapped: false,
    countType: 'fixed',
    countValue: 1,
  },
  'farseek': {
    cardName: 'Farseek',
    searchType: 'land',
    searchFilter: 'Plains, Island, Swamp, or Mountain',
    destination: 'battlefield',
    entersTapped: true,
    countType: 'fixed',
    countValue: 1,
  },
  'harvest season': {
    cardName: 'Harvest Season',
    searchType: 'land',
    searchFilter: 'basic land',
    destination: 'battlefield',
    entersTapped: true,
    countType: 'creatures',
  },
  'cultivate': {
    cardName: 'Cultivate',
    searchType: 'land',
    searchFilter: 'basic land',
    destination: 'battlefield',
    entersTapped: true,
    countType: 'fixed',
    countValue: 2,
  },
  "kodama's reach": {
    cardName: "Kodama's Reach",
    searchType: 'land',
    searchFilter: 'basic land',
    destination: 'battlefield',
    entersTapped: true,
    countType: 'fixed',
    countValue: 2,
  },
  'three visits': {
    cardName: 'Three Visits',
    searchType: 'land',
    searchFilter: 'Forest',
    destination: 'battlefield',
    entersTapped: false,
    countType: 'fixed',
    countValue: 1,
  },
};

export function hasSearchEffect(cardName: string): boolean {
  return cardName.toLowerCase() in SEARCH_EFFECT_CARDS;
}

export function getSearchEffectConfig(cardName: string): SearchEffectConfig | undefined {
  return SEARCH_EFFECT_CARDS[cardName.toLowerCase()];
}

/**
 * Parse search filter into card types array
 */
export function parseSearchFilter(filter: string): string[] {
  // Handle "A, B, C, or D" format
  const parts = filter
    .replace(/ or /g, ', ')
    .split(',')
    .map(p => p.trim())
    .filter(p => p.length > 0);
  
  return parts;
}
