// server/src/state/modules/batch94ManaPayment.ts
// B94: tighten Myr Superion-style "spend only mana produced by creatures"
// for a pre-floated mana pool (no payment items, or leftover pool spend).
// Public: floatingPoolIsCreatureProduced, spellPaymentSatisfiesCreatureProducedManaRestrictionWithPool.

import { isCreatureProducedManaOnlySpell } from './batch92ManaRestrictions.js';
import { spellPaymentSatisfiesCreatureProducedManaRestriction } from './batch93ManaPayment.js';

const COLORS = ['white', 'blue', 'black', 'red', 'green', 'colorless'] as const;

function looksLikeCreature(obj: any): boolean {
  return /\bcreature\b/i.test(String(obj?.card?.type_line || obj?.type_line || obj?.typeLine || obj?.sourceTypeLine || ''));
}

function poolTotal(pool: any): number {
  if (!pool || typeof pool !== 'object') return 0;
  let n = 0;
  for (const k of COLORS) n += Math.max(0, Math.floor(Number(pool[k] || 0)));
  return n;
}

function lowerBoundByPermanent(state: any, playerId: string, pool?: any): Record<string, Record<string, number>> {
  const maps = [
    pool?.manaProducedByPermanentLowerBound,
    state?.manaProducedByPermanentLowerBound?.[playerId],
    state?.manaProducedByPermanent?.[playerId],
    state?.players?.find?.((p: any) => String(p?.id) === playerId)?.manaProducedByPermanent,
  ];
  for (const m of maps) {
    if (m && typeof m === 'object') return m;
  }
  return {};
}

/**
 * True when every unit of floating mana in `pool` can be attributed to a
 * creature permanent via the lower-bound provenance map. Unaccounted pool
 * mana, or mana from a non-creature, fails closed.
 */
export function floatingPoolIsCreatureProduced(state: any, playerId: string, pool?: any, battlefield?: any[]): boolean {
  const pid = String(playerId || '');
  const total = poolTotal(pool);
  if (!pid || total <= 0) return false;
  const bf: any[] = Array.isArray(battlefield) ? battlefield : (Array.isArray(state?.battlefield) ? state.battlefield : []);
  const byPerm = lowerBoundByPermanent(state, pid, pool);
  let accounted = 0;
  for (const [permId, colors] of Object.entries(byPerm || {})) {
    const rec = (colors || {}) as Record<string, number>;
    let units = 0;
    for (const k of COLORS) units += Math.max(0, Math.floor(Number(rec[k] || 0)));
    if (units <= 0) continue;
    const perm = bf.find((p: any) => String(p?.id || '') === String(permId));
    if (!looksLikeCreature(perm) && !looksLikeCreature({ id: permId, ...(rec as any) })) return false;
    accounted += units;
  }
  return accounted >= total;
}

/**
 * Payment items, if present, must all be creature-produced. When there are no
 * payment items (or the caller also supplies an existing pool that will be
 * spent), the floating pool must also be fully creature-attributed.
 */
export function spellPaymentSatisfiesCreatureProducedManaRestrictionWithPool(
  card: any,
  payments: any[] | undefined,
  state?: any,
  extras?: { playerId?: string; existingPool?: any },
): boolean {
  if (!isCreatureProducedManaOnlySpell(card?.card || card)) return true;
  const hasPayment = Array.isArray(payments) && payments.length > 0;
  if (hasPayment) {
    if (!spellPaymentSatisfiesCreatureProducedManaRestriction(card, payments, state)) return false;
    return true;
  }
  const pool = extras?.existingPool ?? state?.manaPool?.[extras?.playerId || ''] ?? state?.mana?.[extras?.playerId || ''];
  if (poolTotal(pool) > 0) {
    return floatingPoolIsCreatureProduced(state, String(extras?.playerId || ''), pool, state?.battlefield);
  }
  // No payment items and no floating pool to inspect: fail closed.
  return false;
}
