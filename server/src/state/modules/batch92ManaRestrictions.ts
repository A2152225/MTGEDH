// server/src/state/modules/batch92ManaRestrictions.ts
// B92: "Spend only mana produced by creatures to cast this spell."
// Public: parseBatch92ManaRestrictionSentence, isCreatureProducedManaOnlySpell,
// manaPaymentSatisfiesCreatureProductionRestriction.

import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const CREATURE_MANA_RE = /spend only mana produced by creatures to cast this spell/i;

export function parseBatch92ManaRestrictionSentence(oracle: string): { kind: 'creature-produced-only' } | null {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  return CREATURE_MANA_RE.test(text) ? { kind: 'creature-produced-only' } : null;
}

export function isCreatureProducedManaOnlySpell(card: any): boolean {
  const oracle = readCardOracleText(card) || String(card?.oracle_text || card?.oracleText || '');
  return Boolean(parseBatch92ManaRestrictionSentence(oracle));
}

function looksLikeCreatureSource(source: any, battlefield?: any[]): boolean {
  if (!source) return false;
  if (source.isCreature === true || source.producedByCreature === true) return true;
  const type = String(source.type_line || source.typeLine || source.sourceTypeLine || source.permanentTypeLine || '');
  if (/\bcreature\b/i.test(type)) return true;
  const pid = String(source.permanentId || source.sourcePermanentId || source.id || '');
  if (pid && Array.isArray(battlefield)) {
    const perm = battlefield.find((p: any) => String(p?.id || '') === pid);
    if (perm && /\bcreature\b/i.test(String(perm?.card?.type_line || perm?.type_line || ''))) return true;
  }
  return false;
}

/**
 * Return true when every payment part in `payments` is marked as produced by a
 * creature (or the restriction does not apply). Unknown provenance fails closed
 * so the restriction cannot be skipped by missing metadata.
 */
export function manaPaymentSatisfiesCreatureProductionRestriction(
  card: any,
  payments: Array<{ source?: any; amount?: number; producedByCreature?: boolean }> | undefined,
  battlefield?: any[],
): boolean {
  if (!isCreatureProducedManaOnlySpell(card)) return true;
  const parts = Array.isArray(payments) ? payments : [];
  if (!parts.length) return false;
  return parts.every((part) => {
    if (part && part.producedByCreature === true) return true;
    return looksLikeCreatureSource(part?.source ?? part, battlefield);
  });
}
