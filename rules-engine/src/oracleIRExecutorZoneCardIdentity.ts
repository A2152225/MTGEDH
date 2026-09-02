// Origin parent: oracleIRExecutorZoneOpsBattlefieldEntry.ts /
//   oracleIRExecutorMoveZoneGuardsTypedCardsRevealedThisWay.ts
// Cluster: flatten nested zone-card wrappers and pick a named copy when
// Warp World put matches duplicate library ids (basics share oracle id).
// Public entries: isUsableCardDisplayName, flattenZoneCardForBattlefield,
// findBestZoneCardIndex, mergeRevealedCardIdentity, takeRevealedCardSnapshot.

export function isUsableCardDisplayName(name: unknown, id?: unknown): boolean {
  const display = String(name || '').trim();
  if (!display) return false;
  const idStr = String(id || '').trim();
  if (idStr && display === idStr) return false;
  if (/^(?:perm|card|stack)[-_]/i.test(display) && display.length > 12) return false;
  return true;
}

export function flattenZoneCardForBattlefield(card: any): any {
  if (!card || typeof card !== 'object' || Array.isArray(card)) return card;
  const nested = card.card && typeof card.card === 'object' && !Array.isArray(card.card)
    ? card.card
    : null;
  if (!nested) return card;

  const outerName = String(card.name || '').trim();
  const nestedName = String(nested.name || '').trim();
  const outerUsable = isUsableCardDisplayName(outerName, card.id);
  const nestedUsable = isUsableCardDisplayName(nestedName, nested.id);
  if (outerUsable && (card.image_uris || !nested.image_uris)) return card;
  if (!nestedUsable && !nested.image_uris && !nested.type_line) return card;

  const { card: _nestedCard, ...outerRest } = card;
  return {
    ...nested,
    ...outerRest,
    name: outerUsable ? outerName : nestedName,
    type_line: outerRest.type_line || nested.type_line,
    oracle_text: outerRest.oracle_text || nested.oracle_text,
    image_uris: outerRest.image_uris || nested.image_uris,
    id: String(outerRest.id || nested.id || '').trim() || outerRest.id,
  };
}

export function findBestZoneCardIndex(pile: readonly any[], cardId: string): number {
  const wanted = String(cardId || '').trim();
  if (!wanted || !Array.isArray(pile)) return -1;
  let fallback = -1;
  for (let i = 0; i < pile.length; i += 1) {
    const entry = pile[i];
    const id = String(entry?.id || entry?.card?.id || '').trim();
    if (id !== wanted) continue;
    if (fallback < 0) fallback = i;
    const flat = flattenZoneCardForBattlefield(entry);
    if (isUsableCardDisplayName(flat?.name, flat?.id || wanted)) return i;
  }
  return fallback;
}

export function mergeRevealedCardIdentity(zoneCard: any, revealed: any): any {
  const zone = flattenZoneCardForBattlefield(zoneCard) || {};
  const snap = flattenZoneCardForBattlefield(revealed) || {};
  const zoneName = isUsableCardDisplayName(zone.name, zone.id) ? String(zone.name).trim() : '';
  const snapName = isUsableCardDisplayName(snap.name, snap.id) ? String(snap.name).trim() : '';
  return {
    ...snap,
    ...zone,
    ...(zoneName || snapName ? { name: zoneName || snapName } : {}),
    type_line: zone.type_line || snap.type_line,
    oracle_text: zone.oracle_text || snap.oracle_text,
    image_uris: zone.image_uris || snap.image_uris,
    id: zone.id || snap.id,
  };
}

export function takeRevealedCardSnapshot(
  remaining: any[],
  cardId: string,
  ownerId?: string,
): any | undefined {
  const wanted = String(cardId || '').trim();
  if (!wanted || !Array.isArray(remaining)) return undefined;
  const owner = String(ownerId || '').trim();
  const idx = remaining.findIndex((card) => {
    if (String(card?.id || '').trim() !== wanted) return false;
    if (!owner) return true;
    const cardOwner = String(card?.owner || card?.ownerId || '').trim();
    return !cardOwner || cardOwner === owner;
  });
  if (idx < 0) return undefined;
  return remaining.splice(idx, 1)[0];
}
