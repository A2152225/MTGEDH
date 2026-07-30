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
    // Cast/resolve can leave the same card.id in zones.library while libraries Map
    // was already spliced — scrub both so dual-zone ghosts cannot survive.
    if (Array.isArray(zone.library)) {
      library += removeReplayDuplicateCardEntries(zone.library, cardId);
      zone.libraryCount = Array.isArray(libraryCards) ? libraryCards.length : zone.library.length;
    } else if (Array.isArray(libraryCards)) {
      zone.libraryCount = libraryCards.length;
    }
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

/** Face-down / morph / manifest / cloak objects may legally be instants or sorceries. */
export function isFaceDownBattlefieldPermanentFlags(...candidates: any[]): boolean {
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    if (
      candidate.faceDown
      || candidate.isFaceDown
      || candidate.manifested
      || candidate.cloaked
      || candidate.card?.faceDown
      || candidate.card?.isFaceDown
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Instants and sorceries cannot exist as face-up battlefield permanents.
 * Face-down morph/manifest/cloak objects remain legal.
 */
export function isImpossibleFaceUpNonPermanentBattlefieldCard(
  cardOrPermanent: any,
  extraFlags?: any,
): boolean {
  const card = cardOrPermanent?.card && typeof cardOrPermanent.card === 'object'
    ? cardOrPermanent.card
    : cardOrPermanent;
  const typeLine = String(
    card?.type_line || cardOrPermanent?.type_line || '',
  ).toLowerCase();
  if (!(typeLine.includes('instant') || typeLine.includes('sorcery'))) {
    return false;
  }
  if (isFaceDownBattlefieldPermanentFlags(cardOrPermanent, extraFlags, card)) {
    return false;
  }
  return true;
}

/**
 * Instants and sorceries cannot exist as face-up battlefield permanents. Replay
 * ordering bugs can leave the resolved stack snapshot there even though the same
 * physical card was subsequently moved to another zone. Prefer the real zone and
 * remove the impossible battlefield object.
 */
export function repairNonPermanentBattlefieldGhosts(ctxOrState: any): number {
  const state = ctxOrState?.state || ctxOrState;
  if (!state || !Array.isArray(state.battlefield)) return 0;

  const zones = state.zones && typeof state.zones === 'object' ? state.zones : {};
  const libraries = ctxOrState?.libraries;
  const removed: any[] = [];
  const kept = state.battlefield.filter((permanent: any) => {
    if (!isImpossibleFaceUpNonPermanentBattlefieldCard(permanent)) return true;
    removed.push(permanent);
    return false;
  });

  if (removed.length === 0) return 0;
  state.battlefield = kept;

  for (const permanent of removed) {
    const card = permanent?.card || {};
    const cardId = String(card?.id || '').trim();
    const ownerId = String(permanent?.owner || permanent?.controller || '').trim();
    if (!cardId || !ownerId) continue;
    const ownerZones = zones?.[ownerId];
    if (!ownerZones) continue;

    const alreadyInZone = ['hand', 'graveyard', 'exile', 'library'].some((zoneName) =>
      Array.isArray(ownerZones?.[zoneName])
      && ownerZones[zoneName].some((entry: any) => String(entry?.id || entry?.card?.id || '') === cardId),
    ) || (
      libraries instanceof Map
      && Array.isArray(libraries.get(ownerId))
      && libraries.get(ownerId).some((entry: any) => String(entry?.id || entry?.card?.id || '') === cardId)
    );
    if (!alreadyInZone) {
      ownerZones.graveyard = Array.isArray(ownerZones.graveyard) ? ownerZones.graveyard : [];
      ownerZones.graveyard.push({ ...card, zone: 'graveyard' });
      ownerZones.graveyardCount = ownerZones.graveyard.length;
    }
  }

  return removed.length;
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
    // Tokens are new objects, even when they copy a physical card. Historical
    // copied-permanent tokens could retain the source card id; using that id to
    // repair zones would delete the real card from hand/library/graveyard.
    if (permanent?.isToken === true || permanent?.card?.isToken === true) continue;

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
    repairNonPermanentBattlefieldGhosts(ctxOrState)
    + repairBattlefieldDualZoneGhosts(ctxOrState)
    + repairGraveyardDualZoneGhosts(ctxOrState)
    + repairExileDualZoneGhosts(ctxOrState)
  );
}
