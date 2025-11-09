export interface SavedDeckSummary {
  id: string;
  name: string;
  created_at: number;
  created_by_id: string;
  created_by_name: string;
  card_count: number;
}

export interface SavedDeckDetail extends SavedDeckSummary {
  text: string;
  // Parsed lines: { name, count } as derived from original list (not Scryfall resolved yet)
  entries: Array<{ name: string; count: number }>;
}