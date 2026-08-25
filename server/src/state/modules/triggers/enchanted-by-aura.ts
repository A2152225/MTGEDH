/**
 * Origin: server/src/state/modules/triggers/combat.ts
 * Cluster: isEnchantedByAuraYouControl
 * Public: isEnchantedByAuraYouControl
 */

export function isEnchantedByAuraYouControl(
  battlefield: readonly any[],
  creatureId: string,
  controllerId: string,
): boolean {
  const id = String(creatureId || '').trim();
  const ctrl = String(controllerId || '').trim();
  if (!id || !ctrl) return false;
  return (battlefield || []).some((perm: any) => {
    const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
    if (!/\baura\b/.test(typeLine)) return false;
    if (String(perm?.controller || '') !== ctrl) return false;
    const attachedTo = String(perm?.attachedTo || perm?.enchanting || '').trim();
    return attachedTo === id;
  });
}
