// server/src/state/modules/batch93CantBeAttacked.ts
// B93: "As long as [this] is attached to a creature, [this] can't be attacked."
// Public: permanentCantBeAttacked, attackTargetPermanentIsIllegal.

import { getContinuousGrantedAbilitiesForPermanent } from './staticEffectSpec.js';
import { readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const ATTACHED_CANT_RE = /as long as .+ is attached to a creature, .+ can't be attacked/i;

function isAttachedToACreature(perm: any, battlefield: any[]): boolean {
  const attachedTo = String(perm?.attachedTo || perm?.attachedToId || perm?.equipTarget || '').trim();
  if (!attachedTo) return false;
  const host = (Array.isArray(battlefield) ? battlefield : []).find((p: any) => String(p?.id || '') === attachedTo);
  if (!host) return false;
  return /\bcreature\b/i.test(String(host?.card?.type_line || host?.type_line || ''));
}

export function permanentCantBeAttacked(perm: any, state: any): boolean {
  if (!perm) return false;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : (Array.isArray(state) ? state : []);
  const granted = (() => {
    try { return getContinuousGrantedAbilitiesForPermanent(perm, state?.battlefield ? state : { battlefield }) || []; }
    catch { return perm?.grantedAbilities || []; }
  })();
  const hasGrant = (Array.isArray(granted) ? granted : []).some((a: any) => String(a).toLowerCase().includes("can't be attacked") || String(a).toLowerCase().includes('cant be attacked'));
  if (hasGrant) return true;
  if (ATTACHED_CANT_RE.test(readCardOracleText(perm.card || perm)) && isAttachedToACreature(perm, battlefield)) return true;
  return false;
}

export function attackTargetPermanentIsIllegal(state: any, targetPermanentId?: string): { illegal: boolean; reason?: string } {
  const id = String(targetPermanentId || '').trim();
  if (!id) return { illegal: false };
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const perm = battlefield.find((p: any) => String(p?.id || '') === id);
  if (!perm) return { illegal: false };
  if (!permanentCantBeAttacked(perm, state)) return { illegal: false };
  const name = String(perm?.card?.name || 'That permanent');
  return { illegal: true, reason: `${name} can't be attacked.` };
}
