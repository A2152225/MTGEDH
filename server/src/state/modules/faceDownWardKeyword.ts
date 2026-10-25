/**
 * Batch 14: ward for face-down disguise permanents is a granted keyword (CR 702.168b), not oracle text.
 * getPermanentWardCost checks the face-down grant and explicit ward grants before the card's oracle text.
 */
import { getWardCost } from './stack-mechanics.js';

export const DISGUISE_WARD_COST = '{2}';

export function getGrantedWardCost(perm: any): string | null {
  if (!perm) return null;
  if (perm.isFaceDown === true && String(perm.faceDownType || '').toLowerCase() === 'disguise') return DISGUISE_WARD_COST;
  if (typeof perm.wardCost === 'string' && perm.wardCost) return perm.wardCost;
  // Static grants ("Each creature you control with a counter on it has ward {1}") keep their cost.
  for (const a of Array.isArray(perm.continuousAbilities) ? perm.continuousAbilities : []) {
    const m = /^ward\s*((?:\{[^}]+\})+)$/i.exec(String(a || '').trim());
    if (m) return m[1].toUpperCase();
  }
  return null;
}

export function getPermanentWardCost(perm: any): string | null {
  const granted = getGrantedWardCost(perm);
  if (granted) return granted;
  if (perm?.isFaceDown === true) return null;
  return getWardCost(perm?.card);
}