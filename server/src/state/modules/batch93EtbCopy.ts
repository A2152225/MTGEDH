// server/src/state/modules/batch93EtbCopy.ts
// B93: "Nontoken creatures you control enter as a copy of enchanted creature."
// Public: parseBatch93EtbCopySentence, findInfiniteReflectionCopyTarget,
// applyNontokenEntersAsCopyOfEnchanted.

import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const COPY_RE = /nontoken creatures you control enter as a copy of enchanted creature/i;

export function parseBatch93EtbCopySentence(oracle: string): boolean {
  return COPY_RE.test(normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'"));
}

function isNontokenCreature(obj: any): boolean {
  if (obj?.isToken === true || obj?.card?.isToken === true || obj?.permanentIsToken === true) return false;
  return /\bcreature\b/i.test(String(obj?.card?.type_line || obj?.type_line || ''));
}

export function findInfiniteReflectionCopyTarget(state: any, enteringController: string): any | null {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const pid = String(enteringController || '');
  for (const perm of battlefield) {
    if (!perm || perm.phasedOut === true || !perm.card) continue;
    if (String(perm.controller || '') !== pid) continue;
    if (!parseBatch93EtbCopySentence(readCardOracleText(perm.card))) continue;
    const hostId = String(perm.attachedTo || perm.enchantedPermanentId || perm.attachedToId || '').trim();
    const host = hostId ? battlefield.find((p: any) => String(p?.id || '') === hostId) : null;
    if (host && isNontokenCreature(host) || (host && /\bcreature\b/i.test(String(host?.card?.type_line || '')))) return host;
  }
  return null;
}

/** Stamp an entering nontoken creature as a copy of the enchanted creature, if a matching aura is present. */
export function applyNontokenEntersAsCopyOfEnchanted(state: any, entering: any): { applied: boolean; copiedFrom?: any } {
  if (!entering || !isNontokenCreature(entering)) return { applied: false };
  const controller = String(entering.controller || '');
  const target = findInfiniteReflectionCopyTarget(state, controller);
  if (!target) return { applied: false };
  const srcCard = target.card || target;
  entering.copiedFromPermanentId = String(target.id || '');
  entering.card = { ...(entering.card || {}), ...srcCard, id: entering.card?.id || entering.id, oracle_id: srcCard.oracle_id };
  entering.copyOf = String(target.card?.name || target.name || '');
  return { applied: true, copiedFrom: target };
}
