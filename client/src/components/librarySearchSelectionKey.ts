/**
 * librarySearchSelectionKey.ts
 *
 * The server can re-send the same pending library-search step (for example after
 * any resolution-queue change triggers a prompt nudge). Each re-send rebuilds the
 * card arrays, so keying the modal's "reset selection" effect on array identity
 * wiped the player's pick mid-choice. Key it on the offered card ids instead.
 */

export function librarySearchSelectionResetKey(
  cards: ReadonlyArray<{ id?: string | null } | null | undefined>
): string {
  return cards.map((card) => String(card?.id ?? '')).join('\u0001');
}

/**
 * When the choice is forced (mandatory and exactly as many selectable cards as must be
 * picked, e.g. a reveal-until that found one card), pre-select those cards so the player
 * only has to confirm.
 */
export function librarySearchForcedSelectionIds(args: {
  cards: ReadonlyArray<{ id?: string | null } | null | undefined>;
  minSelections: number;
  mandatory: boolean;
  splitDestination?: boolean;
  maxTotalManaValue?: number;
}): string[] {
  if (!args.mandatory || args.splitDestination || typeof args.maxTotalManaValue === 'number') return [];
  const ids = args.cards.map((card) => String(card?.id ?? '')).filter(Boolean);
  if (args.minSelections <= 0 || ids.length !== args.minSelections) return [];
  return ids;
}
