/**
 * Shared constants for MTGEDH
 */

export const DEFAULT_LIFE_TOTALS: Record<string, number> = {
  commander: 40,
  standard: 20,
  modern: 20,
  vintage: 20,
  legacy: 20,
  pauper: 20,
  custom: 20
};

export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;

export const COMMANDER_DAMAGE_LETHAL = 21;
export const POISON_COUNTERS_LETHAL = 10;

export const SCRYFALL_API_DELAY_MS = 100; // Rate limit delay
