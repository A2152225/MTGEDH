/**
 * Rule 701.62: Manifest Dread
 * 
 * "Manifest dread" means "Look at the top two cards of your library. Manifest
 * one of them, then put the cards you looked at that were not manifested this
 * way into your graveyard."
 * 
 * Reference: Rule 701.62, also see Rule 701.40 "Manifest"
 */

export interface ManifestDreadAction {
  readonly type: 'manifest-dread';
  readonly playerId: string;
  readonly manifestedCardId?: string;
  readonly cardsToGraveyard?: readonly string[];
}

export interface ManifestDreadResult {
  readonly manifestedCardId: string;
  readonly cardsToGraveyard: readonly string[];
}

export interface ManifestDreadSummary {
  readonly playerId: string;
  readonly seenCardCount: number;
  readonly manifestedCardId?: string;
  readonly graveyardCount: number;
  readonly canManifest: boolean;
  readonly evenIfImpossible: boolean;
}

/**
 * Rule 701.62a: Manifest dread
 */
export function manifestDread(playerId: string): ManifestDreadAction {
  return {
    type: 'manifest-dread',
    playerId,
  };
}

/**
 * Complete manifest dread
 */
export function completeManifestDread(
  playerId: string,
  manifestedCardId: string,
  cardsToGraveyard: readonly string[]
): ManifestDreadAction {
  return {
    type: 'manifest-dread',
    playerId,
    manifestedCardId,
    cardsToGraveyard,
  };
}

/**
 * Rule 701.62b: Manifested dread even if impossible
 */
export const MANIFESTED_DREAD_EVEN_IF_IMPOSSIBLE = true;

/**
 * Number of cards to look at
 */
export const MANIFEST_DREAD_CARD_COUNT = 2;

/**
 * Manifest dread needs at least one card to look at.
 */
export function canManifestDread(libraryCount: number): boolean {
  return libraryCount > 0;
}

/**
 * Return how many cards will actually be looked at.
 */
export function getManifestDreadSeenCardCount(libraryCount: number): number {
  return Math.max(0, Math.min(MANIFEST_DREAD_CARD_COUNT, libraryCount));
}

/**
 * Validate the chosen card from the looked-at subset.
 */
export function isValidManifestDreadChoice(cardsLookedAt: readonly string[], manifestedCardId: string): boolean {
  return cardsLookedAt.includes(manifestedCardId);
}

/**
 * Resolve the looked-at cards into a manifested card and graveyard remainder.
 */
export function resolveManifestDreadLook(
  cardsLookedAt: readonly string[],
  manifestedCardId: string,
): ManifestDreadResult | null {
  if (!isValidManifestDreadChoice(cardsLookedAt, manifestedCardId)) {
    return null;
  }

  return {
    manifestedCardId,
    cardsToGraveyard: cardsLookedAt.filter((cardId) => cardId !== manifestedCardId),
  };
}

export function createManifestDreadSummary(
  action: ManifestDreadAction,
  libraryCount: number,
): ManifestDreadSummary {
  return {
    playerId: action.playerId,
    seenCardCount: getManifestDreadSeenCardCount(libraryCount),
    manifestedCardId: action.manifestedCardId,
    graveyardCount: action.cardsToGraveyard?.length ?? 0,
    canManifest: canManifestDread(libraryCount),
    evenIfImpossible: MANIFESTED_DREAD_EVEN_IF_IMPOSSIBLE,
  };
}
