// server/src/state/modules/equipmentEquipCostGrants.ts
// B62: "Equipment you control have equip {M}." (Astor, Bearer of Blades).
// Metalcraft-gated Puresteel ("Metalcraft ? Equipment you control have equip {0}") stays on the
// existing hasMetalcraft path in equip socket handlers ? this module skips metalcraft lines.
// Public: oracleGrantsEquipmentEquipCost, getGrantedEquipmentEquipCost, cheaperEquipCost.

const EQUIP_RE = /equipment you control have equip (\{[^}]+\}(?:\s*\{[^}]+\})*)/i;

export function oracleGrantsEquipmentEquipCost(oracle: string): string | null {
  const text = String(oracle || '');
  // Ability-word Metalcraft lines are handled by hasMetalcraft in the equip handlers.
  if (/metalcraft/i.test(text) && /equipment you control have equip/i.test(text)) return null;
  const m = text.match(EQUIP_RE);
  return m ? String(m[1]).replace(/\s+/g, '') : null;
}

function costLength(cost: string): number {
  const nums = String(cost).match(/\{(\d+)\}/g) || [];
  let n = 0;
  for (const p of nums) n += Number(p.replace(/[{}]/g, '')) || 0;
  n += (String(cost).match(/\{[WUBRGC]\}/gi) || []).length;
  return n;
}

function isManaEquipCost(cost: string): boolean {
  return /\{[^}]+\}/.test(cost) && !/\b(sacrifice|discard|pay\s+\d+\s+life)\b/i.test(cost);
}

/** Prefer the cheaper of two mana equip costs (lower converted symbols). Non-mana costs are left alone. */
export function cheaperEquipCost(a: string | null | undefined, b: string | null | undefined): string | null {
  const rawA = a ? String(a) : null;
  const rawB = b ? String(b) : null;
  if (rawA && !isManaEquipCost(rawA)) return rawA;
  if (!rawA) return rawB;
  if (!rawB || !isManaEquipCost(rawB)) return rawA;
  const left = rawA.replace(/\s+/g, '');
  const right = rawB.replace(/\s+/g, '');
  return costLength(right) < costLength(left) ? rawB : rawA;
}

export function getGrantedEquipmentEquipCost(state: any, controllerId: string): string | null {
  const pid = String(controllerId || '');
  const board = Array.isArray(state?.battlefield) ? state.battlefield : [];
  let best: string | null = null;
  for (const perm of board) {
    if (!perm || perm.phasedOut || String(perm.controller || '') !== pid) continue;
    const cost = oracleGrantsEquipmentEquipCost(String(perm.card?.oracle_text || ''));
    if (!cost) continue;
    best = cheaperEquipCost(best, cost);
  }
  return best;
}
