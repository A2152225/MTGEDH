// server/src/state/modules/batch93ManaPayment.ts
// B93: wire "Spend only mana produced by creatures to cast this spell" into
// the payment path. Public: spellPaymentSatisfiesCreatureProducedManaRestriction.

import { isCreatureProducedManaOnlySpell, manaPaymentSatisfiesCreatureProductionRestriction } from './batch92ManaRestrictions.js';

function looksLikeCreature(obj: any): boolean {
  return /\bcreature\b/i.test(String(obj?.card?.type_line || obj?.type_line || obj?.typeLine || obj?.sourceTypeLine || ''));
}

function resolvePaymentSource(item: any, battlefield: any[]): any {
  if (!item) return null;
  if (item.producedByCreature === true || item.source?.producedByCreature === true) return { producedByCreature: true };
  const pid = String(item.permanentId || item.sourcePermanentId || item.sourceId || item.id || item.source?.permanentId || item.source?.id || '').trim();
  if (pid && Array.isArray(battlefield)) {
    const perm = battlefield.find((p: any) => String(p?.id || '') === pid);
    if (perm) return { ...perm, producedByCreature: looksLikeCreature(perm) };
  }
  if (looksLikeCreature(item.source) || looksLikeCreature(item)) return { producedByCreature: true, ...(item.source || item) };
  return item.source || item;
}

/**
 * Returns true when the spell has no creature-mana restriction, or every
 * payment part is produced by a creature. Unknown provenance fails closed.
 */
export function spellPaymentSatisfiesCreatureProducedManaRestriction(
  card: any,
  payments: any[] | undefined,
  state?: any,
): boolean {
  if (!isCreatureProducedManaOnlySpell(card?.card || card)) return true;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const parts = (Array.isArray(payments) ? payments : []).map((item) => {
    const source = resolvePaymentSource(item, battlefield);
    return {
      source,
      producedByCreature: source?.producedByCreature === true || looksLikeCreature(source),
    };
  });
  return manaPaymentSatisfiesCreatureProductionRestriction(card?.card || card, parts, battlefield);
}
