/**
 * Match an imported deck to a Commander precon so its stored planes / schemes
 * can be seeded when the deck list itself is only the 100-card library.
 *
 * Public: matchCatalogPrecon.
 */
import { listAllPrecons } from '../../../shared/src/precons.js';

export type CatalogPreconMatch = { setCode: string; deckName: string };

function normalizeName(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Drop a trailing "(Doctor Who 2023)" so a saved name still matches the catalog. */
function deckNameKey(value: unknown): string {
  return normalizeName(value).replace(/\s+\([^)]*\)\s*$/, '').trim();
}

/**
 * Exact deck-name match wins. Otherwise the precon whose commanders are all in
 * the list, and which has the most commanders, wins. A tie is left unmatched.
 */
export function matchCatalogPrecon(options: {
  deckName?: string;
  cardNames?: readonly string[];
}): CatalogPreconMatch | null {
  const entries = listAllPrecons();
  const named = deckNameKey(options.deckName);
  if (named) {
    const byName = entries.filter((entry) => deckNameKey(entry.deck.name) === named);
    if (byName.length === 1) {
      return { setCode: byName[0]!.set.code, deckName: byName[0]!.deck.name };
    }
  }

  const names = new Set((options.cardNames || []).map(normalizeName).filter(Boolean));
  if (names.size === 0) return null;

  const byCommanders = entries.filter((entry) => {
    const commanders = entry.deck.commanders.map(normalizeName).filter(Boolean);
    return commanders.length > 0 && commanders.every((name) => names.has(name));
  });
  if (byCommanders.length === 0) return null;

  const richest = byCommanders.reduce((best, entry) => Math.max(best, entry.deck.commanders.length), 0);
  const top = byCommanders.filter((entry) => entry.deck.commanders.length === richest);
  if (top.length !== 1) return null;
  return { setCode: top[0]!.set.code, deckName: top[0]!.deck.name };
}
