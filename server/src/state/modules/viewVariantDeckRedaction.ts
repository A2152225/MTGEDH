/**
 * Client view redaction for Planechase / Archenemy hidden zones.
 *
 * `viewFor` (view.ts) spreads the authoritative state into the client view, which would hand every
 * client the full, ordered planar deck, each player's planar contributions and the scheme deck.
 * Those decks are face-down hidden information, so the client gets counts only. Face-up public
 * state (currentPlane / activePlane, ongoingSchemes, schemeGraveyard, lastSchemeInMotion,
 * archenemyPlayerId) is left untouched.
 *
 * Public: redactVariantDecksForView.
 */

const HIDDEN_VARIANT_DECK_KEYS = [
  'planarDeckFaceDown',
  'planarDeck',
  'planarContributions',
  'schemeDeck',
] as const;

function lengthOf(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

/**
 * Returns a shallow copy of the view without the face-down decks, plus `planarDeckCount`,
 * `schemeDeckCount` and `planarContributionCounts` (cards contributed per player).
 */
export function redactVariantDecksForView<T extends Record<string, any>>(view: T): T {
  const planarCount = lengthOf(view.planarDeckFaceDown) ?? lengthOf(view.planarDeck);
  const schemeCount = lengthOf(view.schemeDeck);
  const hasHidden = HIDDEN_VARIANT_DECK_KEYS.some((key) => key in view);
  if (!hasHidden) return view;

  // How many planar cards each player contributed is public setup information; which cards is not.
  const contributions = view.planarContributions;
  const contributionCounts: Record<string, number> | null =
    contributions && typeof contributions === 'object' && !Array.isArray(contributions)
      ? Object.fromEntries(
          Object.entries(contributions).map(([playerId, cards]) => [playerId, lengthOf(cards) ?? 0]),
        )
      : null;

  const out: Record<string, any> = { ...view };
  for (const key of HIDDEN_VARIANT_DECK_KEYS) delete out[key];
  if (planarCount !== null) out.planarDeckCount = planarCount;
  if (schemeCount !== null) out.schemeDeckCount = schemeCount;
  if (contributionCounts) out.planarContributionCounts = contributionCounts;
  return out as T;
}
