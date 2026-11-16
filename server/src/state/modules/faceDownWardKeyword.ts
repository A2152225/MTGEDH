/**
 * Batch 14: ward for face-down disguise permanents is a granted keyword (CR 702.168b), not oracle text.
 * getPermanentWardCost checks the face-down grant and explicit ward grants before the card's oracle text.
 */
import { getWardCost } from './stack-mechanics.js';
import { findAnyGrantedWardCost } from './grantedWardCostFromBattlefield.js';
import { batch105GrantedWardCost } from './batch105Apply.js';

export const DISGUISE_WARD_COST = '{2}';

export function getGrantedWardCost(perm: any, state?: any): string | null {
  if (!perm) return null;
  if (perm.isFaceDown === true && String(perm.faceDownType || '').toLowerCase() === 'disguise') return DISGUISE_WARD_COST;
  const b105Ward = batch105GrantedWardCost(perm);
  if (b105Ward) return b105Ward;
  return findAnyGrantedWardCost(perm, state);
}

export function getPermanentWardCost(perm: any, state?: any): string | null {
  const granted = getGrantedWardCost(perm, state);
  if (granted) return granted;
  if (perm?.isFaceDown === true) return null;
  return getWardCost(perm?.card);
}
