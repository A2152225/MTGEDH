/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: shared AI timing, library-search, hand-size, optional-control,
 * and mana-color constants used by commander selection, scheduling, and mana-pool mapping.
 *
 * Public entry symbols: AI_THINK_TIME_MS, AI_FAST_CONTINUE_MS, AI_PASSIVE_STEP_DELAY_MS,
 * AI_REACTION_DELAY_MS, AI_EXCLUSIVE_ACTION_TIMEOUT_MS, MAX_LIBRARY_SEARCH_LIMIT, INITIAL_HAND_SIZE,
 * AI_OPTIONAL_GIVE_CONTROL_PROBABILITY, COLOR_IDENTITY_MAP, AI_MANA_COLOR_PRIORITY,
 * AI_MANA_ABILITY_PATTERN.
 */

/** AI timing delays for more natural behavior */
export const AI_THINK_TIME_MS = 500;
export const AI_FAST_CONTINUE_MS = 75;
export const AI_PASSIVE_STEP_DELAY_MS = 300;
export const AI_REACTION_DELAY_MS = 300;

/** Hard ceiling for one exclusive AI priority/gameFlow turn so a hung decision cannot hold the lock forever. */
export const AI_EXCLUSIVE_ACTION_TIMEOUT_MS = 12_000;

/** Maximum cards to retrieve when searching the entire library for commander selection */
export const MAX_LIBRARY_SEARCH_LIMIT = 1000;

/** Initial hand size for commander format (7 cards) */
export const INITIAL_HAND_SIZE = 7;

/** Probability that AI gives up control of optional creatures (0.3 = 30%) */
export const AI_OPTIONAL_GIVE_CONTROL_PROBABILITY = 0.3;

/** MTG color identity symbols */
export const COLOR_IDENTITY_MAP: Record<string, string> = {
  'W': 'white',
  'U': 'blue',
  'B': 'black',
  'R': 'red',
  'G': 'green',
};

export const AI_MANA_COLOR_PRIORITY = ['W', 'U', 'B', 'R', 'G', 'C'];

export const AI_MANA_ABILITY_PATTERN = /add\s+(\{[wubrgc]\}(?:\s+or\s+\{[wubrgc]\})?|\{[wubrgc]\}\{[wubrgc]\}|one mana|two mana|three mana|mana of any|any color|[xX] mana|an amount of|mana in any combination)/i;
