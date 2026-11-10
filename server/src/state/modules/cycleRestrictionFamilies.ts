// server/src/state/modules/cycleRestrictionFamilies.ts
// B84: "Players can't cycle cards." (Stabilizer).
// Public: cyclingProhibitionReason.

export function cyclingProhibitionReason(state: any): string | null {
  for (const perm of Array.isArray(state?.battlefield) ? state.battlefield : []) {
    const text = String(perm?.card?.oracle_text || perm?.oracle_text || '')
      .toLowerCase()
      .replace(/\u2019/g, "'");
    if (/players can(?:not|'t) cycle cards/.test(text)) {
      return `${String(perm?.card?.name || perm?.name || 'A permanent')} prevents players from cycling cards.`;
    }
  }
  return null;
}
