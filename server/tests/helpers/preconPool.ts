/**
 * Self-play deck pool from the baked precon catalogue (not the 12 precon_json text files).
 *
 * Origin: AI_Upgrade Phase 0-1 (P0-3).
 * Public entry symbols: SelfPlayDeckMeta, listSelfPlayPreconPool, loadSelfPlayDeckLines,
 * shuffleInPlace, drawPodDecks.
 */

import {
  getPreconDecklistLines,
  listPreconDeckMeta,
  type PreconDeckMeta,
} from '../../src/services/preconDecklistStore.js';
import { getPreconDecklistLines as getBundledFallbackLines } from '../../src/services/bundledPreconDecklists.js';
import type { ParsedLine } from '../../src/services/scryfall.js';
import { aiRandom } from '../../../rules-engine/src/aiRandom.js';

export interface SelfPlayDeckMeta {
  id: string;
  setCode: string;
  deckName: string;
  source: string;
  cardCount: number;
}

const ALLOWED_SOURCES = new Set(['mtgjson', 'mtgjson-local']);

/**
 * Commander precons from the SQLite catalogue (cardCount 100, mtgjson sources).
 * Throws a clear error when the catalogue is empty (run npm run precon:bake).
 */
export function listSelfPlayPreconPool(): SelfPlayDeckMeta[] {
  let meta: PreconDeckMeta[] = [];
  try {
    meta = listPreconDeckMeta();
  } catch (err) {
    throw new Error(
      `precon catalogue unavailable (${String(err)}). Run \`npm run precon:bake --workspace=server\` first.`,
    );
  }

  const pool = meta
    .filter((row) => ALLOWED_SOURCES.has(String(row.source || '')))
    .filter((row) => Number(row.cardCount) === 100)
    .map((row) => ({
      id: `${row.setCode}::${row.deckName}`,
      setCode: row.setCode,
      deckName: row.deckName,
      source: String(row.source),
      cardCount: Number(row.cardCount),
    }));

  if (pool.length === 0) {
    throw new Error(
      'precon catalogue has no mtgjson decks with cardCount 100. Run `npm run precon:bake --workspace=server`.',
    );
  }

  return pool;
}

export function loadSelfPlayDeckLines(deck: SelfPlayDeckMeta): ParsedLine[] {
  const fromStore = getPreconDecklistLines(deck.setCode, deck.deckName);
  if (fromStore && fromStore.length > 0) return fromStore;
  const fromBundle = getBundledFallbackLines(deck.setCode, deck.deckName);
  if (fromBundle && fromBundle.length > 0) return fromBundle;
  return [];
}

/** Fisher–Yates using aiRandom so seeded self-play is reproducible. */
export function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(aiRandom() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}

/** Draw `count` distinct decks from the pool with a seeded shuffle. */
export function drawPodDecks(pool: readonly SelfPlayDeckMeta[], count: number): SelfPlayDeckMeta[] {
  if (pool.length < count) {
    throw new Error(`Need at least ${count} decks in the precon pool; have ${pool.length}`);
  }
  const copy = shuffleInPlace([...pool]);
  return copy.slice(0, count);
}
