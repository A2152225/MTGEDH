/**
 * Generic Haunt (CR 702.55) targeting: exile this card from graveyard
 * haunting a chosen creature. Not a card-name handler.
 */

export function listLegalHauntCreatureTargets(
  state: any,
  options?: { excludePermanentId?: string },
): Array<{
  id: string;
  name: string;
  power?: number | string;
  toughness?: number | string;
  typeLine?: string;
  imageUrl?: string;
  controller?: string;
}> {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const excludeId = String(options?.excludePermanentId || '').trim();
  const targets: Array<{
    id: string;
    name: string;
    power?: number | string;
    toughness?: number | string;
    typeLine?: string;
    imageUrl?: string;
    controller?: string;
  }> = [];

  for (const permanent of battlefield) {
    if (!permanent) continue;
    const id = String(permanent.id || '').trim();
    if (!id || (excludeId && id === excludeId)) continue;
    if (permanent.phasedOut === true) continue;
    const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;
    const card = permanent.card || {};
    targets.push({
      id,
      name: String(card?.name || 'Creature'),
      power: permanent.power ?? card?.power,
      toughness: permanent.toughness ?? card?.toughness,
      typeLine: card?.type_line,
      imageUrl: card?.image_uris?.small || card?.image_uris?.normal || card?.imageUrl,
      controller: String(permanent.controller || ''),
    });
  }

  return targets;
}

function stampHauntingIds(card: any, targetPermanentId: string): void {
  const targetId = String(targetPermanentId || '').trim();
  if (!card || typeof card !== 'object' || !targetId) return;
  card.hauntingPermanentId = targetId;
  card.hauntedCard = targetId;
  card.hauntingTargetId = targetId;
}

/**
 * Exile the haunt card from its owner's graveyard and stamp the haunted
 * creature id so later leave/dies detectors can fire from exile.
 */
export function applyHauntExileToTarget(
  state: any,
  options: {
    ownerId: string;
    hauntCardId: string;
    targetPermanentId: string;
    sourceName?: string;
  },
): { applied: boolean; card?: any } {
  const ownerId = String(options.ownerId || '').trim();
  const hauntCardId = String(options.hauntCardId || '').trim();
  const targetPermanentId = String(options.targetPermanentId || '').trim();
  const sourceName = String(options.sourceName || '').trim().toLowerCase();
  if (!ownerId || (!hauntCardId && !sourceName) || !targetPermanentId) {
    return { applied: false };
  }

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const targetExists = battlefield.some((permanent: any) => String(permanent?.id || '') === targetPermanentId);
  if (!targetExists) {
    return { applied: false };
  }

  const zones = (state.zones = state.zones || {});
  const playerZones = (zones[ownerId] = zones[ownerId] || {
    hand: [],
    handCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
    library: [],
    libraryCount: 0,
  });
  playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];
  playerZones.exile = Array.isArray(playerZones.exile) ? playerZones.exile : [];

  let gyIndex = hauntCardId
    ? playerZones.graveyard.findIndex((card: any) => {
      const ids = [card?.id, card?.objectId, card?.cardId]
        .map((value) => String(value || '').trim())
        .filter(Boolean);
      return ids.includes(hauntCardId);
    })
    : -1;
  if (gyIndex < 0 && sourceName) {
    const nameMatches = playerZones.graveyard
      .map((card: any, index: number) => ({ card, index }))
      .filter(({ card }) => String(card?.name || '').trim().toLowerCase() === sourceName);
    if (nameMatches.length === 1) {
      gyIndex = nameMatches[0].index;
    }
  }
  if (gyIndex < 0) {
    return { applied: false };
  }

  const [hauntCard] = playerZones.graveyard.splice(gyIndex, 1);
  stampHauntingIds(hauntCard, targetPermanentId);
  hauntCard.zone = 'exile';
  playerZones.exile.push(hauntCard);
  playerZones.graveyardCount = playerZones.graveyard.length;
  playerZones.exileCount = playerZones.exile.length;

  return { applied: true, card: hauntCard };
}
