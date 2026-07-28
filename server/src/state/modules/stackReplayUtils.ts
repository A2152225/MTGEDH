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

export type DualZoneRepairZone = 'hand' | 'exile' | 'graveyard' | 'library';

/**
 * Remove matching card.id copies from selected non-authoritative zones.
 * Callers choose which zones to scrub so the real copy (BF/GY/exile/stack) is kept.
 */
export function repairCardIdAwayFromZones(
  ctxOrState: any,
  playerId: string,
  cardId: string,
  zonesToScrub: DualZoneRepairZone[],
): { total: number; hand: number; exile: number; graveyard: number; library: number } {
  const state = ctxOrState?.state || ctxOrState;
  const libraries = ctxOrState?.libraries || state?.libraries;
  const empty = { total: 0, hand: 0, exile: 0, graveyard: 0, library: 0 };
  if (!state || !cardId || !playerId || !Array.isArray(zonesToScrub) || zonesToScrub.length === 0) {
    return empty;
  }

  const zones = state.zones || {};
  const zone = zones[playerId];
  if (!zone || typeof zone !== 'object') {
    return empty;
  }

  const scrub = new Set(zonesToScrub);
  let hand = 0;
  let exile = 0;
  let graveyard = 0;
  let library = 0;

  if (scrub.has('hand')) {
    hand = removeReplayDuplicateCardEntries(zone.hand, cardId);
    if (Array.isArray(zone.hand)) {
      zone.handCount = zone.hand.length;
    }
  }

  if (scrub.has('exile')) {
    exile = removeReplayDuplicateCardEntries(zone.exile, cardId);
    if (Array.isArray(zone.exile)) {
      zone.exileCount = zone.exile.length;
    }
  }

  if (scrub.has('graveyard')) {
    graveyard = removeReplayDuplicateCardEntries(zone.graveyard, cardId);
    if (Array.isArray(zone.graveyard)) {
      zone.graveyardCount = zone.graveyard.length;
    }
  }

  if (scrub.has('library')) {
    const libraryCards = Array.isArray(libraries?.get?.(playerId))
      ? libraries.get(playerId)
      : (Array.isArray(libraries?.[playerId]) ? libraries[playerId] : undefined);
    library = removeReplayDuplicateCardEntries(libraryCards, cardId);
  }

  return {
    total: hand + exile + graveyard + library,
    hand,
    exile,
    graveyard,
    library,
  };
}

export function repairReplayCardSourceZones(
  ctxOrState: any,
  playerId: string,
  cardId: string,
): { total: number; hand: number; exile: number; graveyard: number; library: number } {
  return repairCardIdAwayFromZones(ctxOrState, playerId, cardId, [
    'hand',
    'exile',
    'graveyard',
    'library',
  ]);
}

/**
 * After undo/replay, a card can sit on the battlefield while a ghost copy with the
 * same card.id remains in hand (snapshot BF-enter when source splice missed).
 * Strip those ghosts from non-battlefield zones for every battlefield card id.
 */
export function repairBattlefieldDualZoneGhosts(ctxOrState: any): number {
  const state = ctxOrState?.state || ctxOrState;
  if (!state || !Array.isArray(state.battlefield) || state.battlefield.length === 0) {
    return 0;
  }

  let total = 0;
  const seen = new Set<string>();
  for (const permanent of state.battlefield) {
    const cardId = String(permanent?.card?.id || '').trim();
    const ownerId = String(permanent?.owner || permanent?.controller || '').trim();
    if (!cardId || !ownerId) continue;
    const key = `${ownerId}:${cardId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    total += repairReplayCardSourceZones(ctxOrState, ownerId, cardId).total;
    const controllerId = String(permanent?.controller || '').trim();
    if (controllerId && controllerId !== ownerId) {
      total += repairReplayCardSourceZones(ctxOrState, controllerId, cardId).total;
    }
  }
  return total;
}

/**
 * Fetch lands / sacrifices leave the battlefield. A hand (or library/exile) ghost with
 * the same card.id can survive undo/replay and make Polluted Delta appear "back in hand"
 * while also sitting in the graveyard. Keep GY; scrub the other zones.
 */
export function repairGraveyardDualZoneGhosts(ctxOrState: any): number {
  const state = ctxOrState?.state || ctxOrState;
  const zones = state?.zones;
  if (!state || !zones || typeof zones !== 'object') {
    return 0;
  }

  let total = 0;
  const seen = new Set<string>();
  for (const [playerId, zone] of Object.entries(zones as Record<string, any>)) {
    const graveyard = Array.isArray(zone?.graveyard) ? zone.graveyard : [];
    for (const card of graveyard) {
      const cardId = String(card?.id || '').trim();
      if (!cardId) continue;
      const key = `${playerId}:${cardId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      total += repairCardIdAwayFromZones(ctxOrState, playerId, cardId, [
        'hand',
        'exile',
        'library',
      ]).total;
    }
  }
  return total;
}

/**
 * Same pattern for exile: keep exile copies, strip hand/library ghosts.
 * (Does not strip graveyard — GY scrub already removes exile ghosts for GY cards.)
 */
export function repairExileDualZoneGhosts(ctxOrState: any): number {
  const state = ctxOrState?.state || ctxOrState;
  const zones = state?.zones;
  if (!state || !zones || typeof zones !== 'object') {
    return 0;
  }

  let total = 0;
  const seen = new Set<string>();
  for (const [playerId, zone] of Object.entries(zones as Record<string, any>)) {
    const exile = Array.isArray(zone?.exile) ? zone.exile : [];
    for (const card of exile) {
      const cardId = String(card?.id || '').trim();
      if (!cardId) continue;
      const key = `${playerId}:${cardId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      total += repairCardIdAwayFromZones(ctxOrState, playerId, cardId, [
        'hand',
        'library',
      ]).total;
    }
  }
  return total;
}

/** Run all dual-zone ghost scrubs used after undo/replay reconcile. */
export function repairAllDualZoneGhosts(ctxOrState: any): number {
  return (
    repairBattlefieldDualZoneGhosts(ctxOrState)
    + repairGraveyardDualZoneGhosts(ctxOrState)
    + repairExileDualZoneGhosts(ctxOrState)
  );
}
