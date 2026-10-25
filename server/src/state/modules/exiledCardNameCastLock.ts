// server/src/state/modules/exiledCardNameCastLock.ts
// Batch 29: name locks keyed on a card the permanent exiled (CR 201.2):
//   "Your opponents can't cast spells with the same name as the exiled card." (Ashiok's Erasure, Ixalan's Binding)
//   also "... as a card exiled with ~" / "... as the exiled cards".
// Exiled cards are found through state.linkedExiles (registerLinkedExile) and exile-zone cards stamped with
// exiledWithSourceId / exiledBy / exiledByPermanentId.
// Origin parent: chosen-name-restrictions.ts (isSpellCastingProhibitedByChosenName).
// Public entry symbols: findExiledCardNameCastLock, exiledCardNamesForSource.

const LOCK_RE = /can't cast spells with the same name as (?:the exiled cards?|a card exiled with (?:~|this [a-z]+|it))/;

function oracleOf(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/[\u2018\u2019]/g, "'").toLowerCase();
}

export function exiledCardNamesForSource(state: any, sourceId: string): string[] {
  const names: string[] = [];
  const id = String(sourceId || '');
  if (!id) return names;
  for (const link of Array.isArray(state?.linkedExiles) ? state.linkedExiles : []) {
    if (String(link?.exilingPermanentId || '') !== id) continue;
    const n = String(link?.exiledCardName || link?.exiledCard?.name || '').trim();
    if (n) names.push(n);
  }
  const zones = state?.zones && typeof state.zones === 'object' ? Object.values(state.zones) : [];
  for (const z of zones as any[]) {
    for (const card of Array.isArray(z?.exile) ? z.exile : []) {
      const by = [card?.exiledWithSourceId, card?.exiledBy, card?.exiledByPermanentId].map((v) => String(v || ''));
      if (!by.includes(id)) continue;
      const n = String(card?.name || card?.card?.name || '').trim();
      if (n) names.push(n);
    }
  }
  return names;
}

export function findExiledCardNameCastLock(
  state: any,
  playerId: string,
  targetName: string,
  normalize: (name: string) => string,
): { sourceId?: string; sourceName?: string; chosenName?: string } | null {
  if (!targetName) return null;
  for (const perm of Array.isArray(state?.battlefield) ? state.battlefield : []) {
    const oracle = oracleOf(perm);
    if (!LOCK_RE.test(oracle)) continue;
    const controller = String(perm?.controller || '');
    if (/\b(?:your opponents|each opponent)\b/.test(oracle) && (!controller || controller === String(playerId))) continue;
    for (const name of exiledCardNamesForSource(state, String(perm?.id || ''))) {
      const faces = [name, ...name.split('//').map((f) => f.trim())];
      if (faces.some((f) => normalize(f) === targetName)) {
        return { sourceId: perm?.id, sourceName: perm?.card?.name, chosenName: name };
      }
    }
  }
  return null;
}
