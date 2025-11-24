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
