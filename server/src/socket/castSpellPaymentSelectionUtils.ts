/**
 * socket/castSpellPaymentSelectionUtils.ts
 *
 * Origin: game-actions.ts cast-spell payment selection.
 * Cluster: exclusive floating-pool color picks vs implicit leftover pool,
 * and whether a mana source reserves its permanent id (tap vs repeatable sacrifice).
 * Entry: castSpellPaymentHasExplicitFloatingRefs, addUnselectedFloatingPoolRemainder,
 * reserveCastSpellPaymentPermanentId.
 */

import { parseFloatingPaymentPermanentId } from './util.js';

export const CAST_SPELL_PAYMENT_SELECTION_MANA_KEYS = [
  'white',
  'blue',
  'black',
  'red',
  'green',
  'colorless',
] as const;

export function castSpellPaymentHasExplicitFloatingRefs(
  payment: Array<{ permanentId?: string } | null | undefined> | null | undefined,
): boolean {
  if (!Array.isArray(payment)) return false;
  return payment.some((item) => Boolean(parseFloatingPaymentPermanentId(String(item?.permanentId || ''))));
}

export function addUnselectedFloatingPoolRemainder(
  targetTotals: Record<string, number>,
  pool: Partial<Record<(typeof CAST_SPELL_PAYMENT_SELECTION_MANA_KEYS)[number], number>> | null | undefined,
  alreadySelected: Partial<Record<(typeof CAST_SPELL_PAYMENT_SELECTION_MANA_KEYS)[number], number>> | null | undefined,
): void {
  for (const key of CAST_SPELL_PAYMENT_SELECTION_MANA_KEYS) {
    const poolAmount = Number(pool?.[key] || 0);
    const fromSelected = Number(alreadySelected?.[key] || 0);
    const remainder = Math.max(0, poolAmount - fromSelected);
    if (remainder > 0) {
      targetTotals[key] = Number(targetTotals[key] || 0) + remainder;
    }
  }
}

export function reserveCastSpellPaymentPermanentId(
  usedIds: Set<string>,
  permanentId: string,
  taps: boolean,
): void {
  if (!taps) return;
  const id = String(permanentId || '').trim();
  if (id) usedIds.add(id);
}
