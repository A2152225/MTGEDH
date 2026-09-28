// client/src/components/zonesPilesGraveyardContextTarget.ts
// Picks which graveyard card a right-click on the table's graveyard pile should target.
import type { KnownCardRef } from '../../../shared/src';

/**
 * Graveyard arrays are oldest-first (the last entry is the visible top card).
 * Prefer the top card when it is playable; otherwise the topmost playable card
 * (e.g. a land playable via Conduit of Worlds / Crucible of Worlds); otherwise the top card.
 */
export function pickGraveyardContextMenuCard(
  graveyard: readonly KnownCardRef[] | null | undefined,
  playableCards?: readonly string[] | null,
): KnownCardRef | undefined {
  const cards = Array.isArray(graveyard) ? graveyard.filter(Boolean) : [];
  if (cards.length === 0) return undefined;
  const top = cards[cards.length - 1];
  const playable = new Set(playableCards || []);
  if (playable.has(String(top.id))) return top;
  for (let i = cards.length - 1; i >= 0; i--) {
    if (playable.has(String(cards[i].id))) return cards[i];
  }
  return top;
}
