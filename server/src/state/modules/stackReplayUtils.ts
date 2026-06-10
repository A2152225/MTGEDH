function removeReplayDuplicateCardEntries(cards: any, cardId: string): number {
  if (!Array.isArray(cards) || !cardId) return 0;

  let removed = 0;
  for (let index = cards.length - 1; index >= 0; index--) {
    if (cards[index] && String(cards[index].id || '') === cardId) {
      cards.splice(index, 1);
      removed++;
    }
  }

  return removed;
}

export function repairReplayCardSourceZones(
  ctxOrState: any,
  playerId: string,
  cardId: string,
): { total: number; hand: number; exile: number; graveyard: number; library: number } {
  const state = ctxOrState?.state || ctxOrState;
  const libraries = ctxOrState?.libraries || state?.libraries;
  if (!state || !cardId) {
    return { total: 0, hand: 0, exile: 0, graveyard: 0, library: 0 };
  }

  const zones = state.zones || {};
  const zone = zones[playerId];
  if (!zone || typeof zone !== 'object') {
    return { total: 0, hand: 0, exile: 0, graveyard: 0, library: 0 };
  }

  const hand = removeReplayDuplicateCardEntries(zone.hand, cardId);
  if (Array.isArray(zone.hand)) {
    zone.handCount = zone.hand.length;
  }

  const exile = removeReplayDuplicateCardEntries(zone.exile, cardId);
  if (Array.isArray(zone.exile)) {
    zone.exileCount = zone.exile.length;
  }

  const graveyard = removeReplayDuplicateCardEntries(zone.graveyard, cardId);
  if (Array.isArray(zone.graveyard)) {
    zone.graveyardCount = zone.graveyard.length;
  }

  const libraryCards = Array.isArray(libraries?.get?.(playerId))
    ? libraries.get(playerId)
    : (Array.isArray(libraries?.[playerId]) ? libraries[playerId] : undefined);
  const library = removeReplayDuplicateCardEntries(libraryCards, cardId);

  return {
    total: hand + exile + graveyard + library,
    hand,
    exile,
    graveyard,
    library,
  };
}
