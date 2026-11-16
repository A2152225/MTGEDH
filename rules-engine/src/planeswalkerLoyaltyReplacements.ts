// rules-engine/src/planeswalkerLoyaltyReplacements.ts
// B99: Deification-style last-loyalty save. When damage would remove all
// loyalty counters from a planeswalker you control of the chosen type, and
// you control a creature, instead all but one of those counters are removed.
// Public: parseDeificationLoyaltySave, nextLoyaltyAfterDamageWithSave.

function normalizeOracle(text: string): string {
  return String(text || '').replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
}

function oracleOf(perm: any): string {
  return normalizeOracle(perm?.card?.oracle_text || perm?.oracle_text || '');
}

function typeLineOf(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '');
}

export function parseDeificationLoyaltySave(oracle: string): boolean {
  return /as long as you control a creature, if damage dealt to a planeswalker you control of the chosen type would result in all loyalty counters on it being removed, instead all but one of those counters are removed/i.test(normalizeOracle(oracle));
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`);
}

function chosenPlaneswalkerTypeOf(source: any): string {
  return String(
    source?.chosenPlaneswalkerType
    || source?.card?.chosenPlaneswalkerType
    || source?.chosenType
    || '',
  ).trim();
}

function controllerControlsCreature(state: any, controllerId: string): boolean {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.some((perm) => {
    if (!perm || perm.phasedOut === true) return false;
    if (String(perm.controller || '') !== String(controllerId)) return false;
    return /\bcreature\b/i.test(typeLineOf(perm));
  });
}

export function deificationLoyaltySaveApplies(perm: any, state: any): boolean {
  if (!perm || !state) return false;
  const battlefield: any[] = Array.isArray(state.battlefield) ? state.battlefield : [];
  const controller = String(perm.controller || '');
  if (!controller) return false;
  const typeLine = typeLineOf(perm);
  if (!/\bplaneswalker\b/i.test(typeLine)) return false;
  for (const source of battlefield) {
    if (!source || source.phasedOut === true) continue;
    if (!parseDeificationLoyaltySave(oracleOf(source))) continue;
    if (String(source.controller || '') !== controller) continue;
    if (!controllerControlsCreature(state, controller)) continue;
    const chosen = chosenPlaneswalkerTypeOf(source);
    if (!chosen) continue;
    if (new RegExp(`\\b${escapeRe(chosen)}\\b`, 'i').test(typeLine)) return true;
  }
  return false;
}

/** Next loyalty after `amount` damage, leaving 1 when the save applies and all would be removed. */
export function nextLoyaltyAfterDamageWithSave(perm: any, amount: number, state?: any): number {
  const current = Number((perm as any)?.loyalty ?? (perm as any)?.counters?.loyalty ?? 0) || 0;
  const n = Math.max(0, amount | 0);
  const next = Math.max(0, current - n);
  if (next > 0 || current <= 0 || n <= 0) return next;
  if (state && deificationLoyaltySaveApplies(perm, state)) return 1;
  return next;
}
