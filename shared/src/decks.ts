export interface SavedDeckSummary {
  id: string;
  name: string;
  created_at: number;
  created_by_id: string;
  created_by_name: string;
  card_count: number;
  /** Indicates if this deck has cached Scryfall card data */
  has_cached_cards?: boolean;
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