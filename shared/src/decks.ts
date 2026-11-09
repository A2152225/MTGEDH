/** Minimum total card count required to create/update a saved deck (server or local). */
export const MIN_SAVED_DECK_CARDS = 5;

export function isBelowMinSavedDeckCards(cardCount: number, min: number = MIN_SAVED_DECK_CARDS): boolean {
  return !Number.isFinite(cardCount) || cardCount < min;
}

export function formatMinSavedDeckCardsError(cardCount: number, min: number = MIN_SAVED_DECK_CARDS): string {
  const got = Number.isFinite(cardCount) ? Math.max(0, Math.floor(cardCount)) : 0;
  return `Deck must have at least ${min} cards to save (got ${got}).`;
}

export interface SavedDeckSummary {
  id: string;
  name: string;
  created_at: number;
  created_by_id: string;
  created_by_name: string;
  card_count: number;
  /** Indicates if this deck has cached Scryfall card data */
  has_cached_cards?: boolean;
  /** Folder path for organizing decks (e.g., "Precons/2024/Bloomburrow") */
  folder?: string;
  /** public: anyone can browse/load; private: owner-only list/load/edit */
  visibility?: 'public' | 'private';
}

/** Cached card data from Scryfall */
export interface CachedCard {
  id: string;
  name: string;
  type_line?: string;
  oracle_text?: string;
  image_uris?: {
    small?: string;
    normal?: string;
    art_crop?: string;
  };
  mana_cost?: string;
  power?: string;
  toughness?: string;
  loyalty?: string; // Planeswalker starting loyalty
  card_faces?: Array<{
    name?: string;
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    image_uris?: {
      small?: string;
      normal?: string;
      art_crop?: string;
    };
    power?: string;
    toughness?: string;
    loyalty?: string; // For MDFC planeswalkers
  }>;
  layout?: string;
}

export interface SavedDeckDetail extends SavedDeckSummary {
  text: string;
  // Parsed lines: { name, count } as derived from original list (not Scryfall resolved yet)
  entries: Array<{ name: string; count: number }>;
  /** Cached resolved card data from Scryfall (if available) */
  cached_cards?: CachedCard[];
}

/** Folder structure for organizing decks */
export interface DeckFolder {
  name: string;
  path: string;
  subfolders: DeckFolder[];
  deckCount: number;
}