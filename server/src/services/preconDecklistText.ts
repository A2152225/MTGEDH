/**
 * Plain-text export of a baked precon decklist ("1 Card Name" per line).
 * Used by the deck builder Copy Decklist action. Variant planes and schemes
 * stay out of this text; import reattaches them when the deck still matches
 * the catalog precon.
 *
 * Public: formatPreconDecklistText, loadPreconDecklistText.
 */
import { getPreconDecklistLines } from './bundledPreconDecklists.js';

export function formatPreconDecklistText(
  lines: ReadonlyArray<{ name?: string; count?: number }>,
): string {
  const out: string[] = [];
  for (const line of lines) {
    const name = String(line.name || '').trim();
    if (!name) continue;
    const count = Math.max(1, Number(line.count) || 1);
    out.push(`${count} ${name}`);
  }
  return out.join('\n');
}

export function loadPreconDecklistText(
  setCode: string,
  deckName: string,
): { setCode: string; deckName: string; text: string; cardCount: number } | null {
  const normalizedSet = String(setCode || '').trim().toUpperCase();
  const normalizedDeck = String(deckName || '').trim();
  if (!normalizedSet || !normalizedDeck) return null;

  const lines = getPreconDecklistLines(normalizedSet, normalizedDeck);
  if (!lines || lines.length === 0) return null;

  const text = formatPreconDecklistText(lines);
  if (!text) return null;

  const cardCount = lines.reduce(
    (sum, line) => sum + Math.max(1, Number(line.count) || 1),
    0,
  );
  return { setCode: normalizedSet, deckName: normalizedDeck, text, cardCount };
}
