/**
 * Hideaway (CR 702.75) stores the chosen card in exile face down.
 * The controller of the hiding permanent may look at it; others see a face-down stub.
 */

export function createHideawayExiledCard(card: any, opts: {
  controllerId: string;
  sourcePermanentId: string;
  sourceName?: string;
}): any {
  return {
    ...card,
    zone: 'exile',
    faceDown: true,
    hideawaySourcePermanentId: opts.sourcePermanentId,
    exiledBy: opts.sourceName || 'Hideaway',
    canBeExaminedBy: [opts.controllerId].filter(Boolean),
  };
}

export function putHideawayCardInExile(state: any, playerId: string, exiledCard: any): void {
  if (!state || !playerId || !exiledCard) return;
  state.zones = state.zones || {};
  const z = state.zones[playerId] = state.zones[playerId] || {
    hand: [],
    handCount: 0,
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  };
  z.exile = Array.isArray(z.exile) ? z.exile : [];
  const cardId = String(exiledCard.id || '');
  const sourceId = String(exiledCard.hideawaySourcePermanentId || '');
  const already = z.exile.some((entry: any) =>
    (cardId && String(entry?.id || '') === cardId)
    || (sourceId && String(entry?.hideawaySourcePermanentId || '') === sourceId),
  );
  if (already) return;
  z.exile.push(exiledCard);
  z.exileCount = z.exile.length;
}

export function removeHideawayCardFromExile(
  zones: Record<string, any> | undefined,
  playerId: string | undefined,
  opts: { cardId?: string; sourcePermanentId?: string } = {},
): any | undefined {
  if (!zones || typeof zones !== 'object') return undefined;
  const cardId = String(opts.cardId || '').trim();
  const sourceId = String(opts.sourcePermanentId || '').trim();
  if (!cardId && !sourceId) return undefined;

  const matches = (card: any) => {
    if (!card || typeof card !== 'object') return false;
    if (cardId && String(card.id || '') === cardId) return true;
    if (sourceId && String(card.hideawaySourcePermanentId || '') === sourceId) return true;
    return false;
  };

  const playerIds = playerId
    ? [playerId, ...Object.keys(zones).filter((id) => id !== playerId)]
    : Object.keys(zones);

  for (const pid of playerIds) {
    const z = zones[pid];
    if (!z || !Array.isArray(z.exile)) continue;
    const idx = z.exile.findIndex(matches);
    if (idx === -1) continue;
    const [removed] = z.exile.splice(idx, 1);
    z.exileCount = z.exile.length;
    return removed;
  }
  return undefined;
}

export function storeHideawayExiledCard(args: {
  state: any;
  playerId: string;
  permanent: any;
  selectedCard: any;
  sourceName?: string;
}): any {
  const { state, playerId, permanent, selectedCard, sourceName } = args;
  const exiledCard = createHideawayExiledCard(selectedCard, {
    controllerId: playerId,
    sourcePermanentId: String(permanent?.id || ''),
    sourceName,
  });
  permanent.hideawayCard = {
    card: { ...selectedCard, zone: 'exile' },
  };
  putHideawayCardInExile(state, playerId, exiledCard);
  return exiledCard;
}

export function clearStoredHideawayCard(state: any, permanent: any, playerId?: string): void {
  const cardId = String(permanent?.hideawayCard?.card?.id || '');
  const sourceId = String(permanent?.id || '');
  if (permanent && typeof permanent === 'object' && 'hideawayCard' in permanent) {
    delete permanent.hideawayCard;
  }
  removeHideawayCardFromExile(state?.zones, playerId, {
    cardId,
    sourcePermanentId: sourceId,
  });
}

export function cardFromHideawayToHand(card: any): any {
  const next = { ...(card || {}), zone: 'hand' } as any;
  delete next.faceDown;
  delete next.hideawaySourcePermanentId;
  delete next.canBeExaminedBy;
  delete next.exiledBy;
  delete next.known;
  return next;
}

export function sanitizeHideawayCardForViewer(
  hideawayCard: any,
  viewer: string,
  controllerId: string,
): any {
  if (!hideawayCard || typeof hideawayCard !== 'object') return undefined;
  if (viewer === controllerId || viewer === 'spectator:judge') {
    return { ...hideawayCard };
  }
  return { present: true };
}

export function applyCurrentHideawayExamination(card: any, battlefield: any[]): any {
  if (!card || typeof card !== 'object') return card;
  const sourceId = String(card.hideawaySourcePermanentId || '').trim();
  if (!sourceId) return card;
  const perm = (Array.isArray(battlefield) ? battlefield : []).find(
    (entry: any) => String(entry?.id || '') === sourceId,
  );
  if (!perm) return card;
  const controllerId = String(perm.controller || '').trim();
  if (!controllerId) return card;
  return {
    ...card,
    canBeExaminedBy: [controllerId],
  };
}

export function collectMissingHideawayExileCards(ownerId: string, battlefield: any[]): any[] {
  const missing: any[] = [];
  for (const perm of Array.isArray(battlefield) ? battlefield : []) {
    const hidden = (perm as any)?.hideawayCard?.card;
    if (!hidden || typeof hidden !== 'object') continue;
    const owner = String(perm.owner || perm.controller || '');
    if (owner !== ownerId) continue;
    missing.push(createHideawayExiledCard(hidden, {
      controllerId: String(perm.controller || owner),
      sourcePermanentId: String(perm.id || ''),
      sourceName: perm.card?.name,
    }));
  }
  return missing;
}
