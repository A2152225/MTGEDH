// Origin parent: shared/src/combatLandwalk.ts
// "Creatures with Xwalk can be blocked as though they didn't have Xwalk" (Undertow, Great Wall,
// Crevasse...) and "Creatures with landwalk abilities can be blocked as though they didn't have
// those abilities" (Staff of the Ages, Lord Magnus).
// Public entry symbols: landwalkIgnoredByBattlefield.

export function landwalkIgnoredByBattlefield(
  battlefield: ReadonlyArray<{ card?: { oracle_text?: string }; oracle_text?: string } | undefined>,
  walkKeyword: string,
): boolean {
  const kw = walkKeyword.toLowerCase();
  const specific = `creatures with ${kw} can be blocked as though they didn't have ${kw}`;
  const generic = "creatures with landwalk abilities can be blocked as though they didn't have those abilities";
  return (battlefield || []).some((perm) => {
    const oracle = String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/[\u2018\u2019]/g, "'").toLowerCase();
    return oracle.includes(specific) || oracle.includes(generic);
  });
}
