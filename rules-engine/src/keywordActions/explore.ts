/**
 * Rule 701.44: Explore
 * 
 * Certain spells and abilities instruct a permanent to explore. To do so, that
 * permanent's controller reveals the top card of their library. If a land card
 * is revealed this way, that player puts that card into their hand. Otherwise,
 * that player puts a +1/+1 counter on the exploring permanent and may put the
 * revealed card into their graveyard.
 * 
 * Reference: Rule 701.44
 */

export interface ExploreAction {
  readonly type: 'explore';
  readonly permanentId: string;
  readonly controllerId: string;
  readonly revealedCardId?: string;
  readonly wasLand?: boolean;
  readonly counterAdded?: boolean;
  readonly cardToGraveyard?: boolean;
}

/**
 * Rule 701.44a: Explore
 */
export function explore(permanentId: string, controllerId: string): ExploreAction {
  return {
    type: 'explore',
    permanentId,
    controllerId,
  };
}

/**
 * Complete explore with results
 */
export function completeExplore(
  permanentId: string,
  controllerId: string,
  revealedCardId: string,
  wasLand: boolean,
  cardToGraveyard?: boolean
): ExploreAction {
  return {
    type: 'explore',
    permanentId,
    controllerId,
    revealedCardId,
    wasLand,
    counterAdded: !wasLand,
    cardToGraveyard: wasLand ? false : cardToGraveyard,
  };
}

/**
 * Rule 701.44b: Explored even if impossible
 */
export const EXPLORES_EVEN_IF_IMPOSSIBLE = true;

/**
 * Rule 701.44c: Last known information
 */
export function useLastKnownInformation(
  permanentChangedZones: boolean
): boolean {
  return permanentChangedZones;
}

/**
 * Rule 701.44d: APNAP order for multiple explores
 */
export function sortMultipleExplores(
  permanents: readonly { id: string; controllerId: string }[],
  apnapOrder: readonly string[]
): readonly { id: string; controllerId: string }[] {
  return [...permanents].sort((a, b) => {
    const indexA = apnapOrder.indexOf(a.controllerId);
    const indexB = apnapOrder.indexOf(b.controllerId);
    return indexA - indexB;
  });
}
