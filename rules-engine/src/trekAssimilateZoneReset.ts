/**
 * R32: CR 400.7 for Assimilate. An assimilated card that left the battlefield is a new object, so its
 * printed type line (kept on the card as assimilatedPrintedTypeLine) is restored in every non-battlefield zone.
 * Mutates the given state in place; returns how many cards were restored.
 * Public entry symbols: restoreAssimilatedCardsOutsideBattlefield.
 */
function restoreCard(card: any): boolean {
  if (!card || typeof card !== 'object' || typeof card.assimilatedPrintedTypeLine !== 'string') return false;
  card.type_line = card.assimilatedPrintedTypeLine;
  delete card.assimilatedPrintedTypeLine;
  return true;
}

export function restoreAssimilatedCardsOutsideBattlefield(state: any): number {
  let restored = 0;
  const zones = state?.zones && typeof state.zones === 'object' ? state.zones : {};
  for (const pz of Object.values(zones) as any[]) {
    if (!pz || typeof pz !== 'object') continue;
    for (const value of Object.values(pz)) {
      if (!Array.isArray(value)) continue;
      for (const card of value) if (restoreCard(card)) restored++;
    }
  }
  for (const player of Array.isArray(state?.players) ? state.players : []) {
    for (const key of ['graveyard', 'exile', 'library', 'hand']) {
      const list = player?.[key];
      if (Array.isArray(list)) for (const card of list) if (restoreCard(card)) restored++;
    }
  }
  for (const key of ['exile', 'stack', 'commandZone']) {
    const list = state?.[key];
    if (Array.isArray(list)) for (const item of list) if (restoreCard(item?.card || item)) restored++;
  }
  // A permanent that re-entered without being assimilated again is also a new object.
  for (const perm of Array.isArray(state?.battlefield) ? state.battlefield : []) {
    if (perm && !perm.assimilated && restoreCard(perm.card)) restored++;
  }
  return restored;
}
