// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: battlefieldPermanentHasFlying, battlefieldPermanentHasIslandwalk,
// permanentHasColorLetter, isAttackingBattlefieldPermanent, permanentHasBattlefieldCounters.
// Public entries: those five matchers.

import type { BattlefieldPermanent } from '../../shared/src';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';

export function battlefieldPermanentHasFlying(perm: BattlefieldPermanent): boolean {
  if (/\bflying\b/i.test(getExecutorTypeLineLower(perm))) return true;
  const keywordValues: unknown[] = [
    ...(Array.isArray((perm as any)?.keywords) ? (perm as any).keywords : []),
    ...(Array.isArray((perm as any)?.card?.keywords) ? (perm as any).card.keywords : []),
    ...(Array.isArray((perm as any)?.grantedAbilities) ? (perm as any).grantedAbilities : []),
  ];
  return keywordValues.some(value => /\bflying\b/i.test(String(value || '')));
}

export function battlefieldPermanentHasIslandwalk(perm: BattlefieldPermanent): boolean {
  if (/\bislandwalk\b/i.test(getExecutorTypeLineLower(perm))) return true;
  const keywordValues: unknown[] = [
    ...(Array.isArray((perm as any)?.keywords) ? (perm as any).keywords : []),
    ...(Array.isArray((perm as any)?.card?.keywords) ? (perm as any).card.keywords : []),
    ...(Array.isArray((perm as any)?.grantedAbilities) ? (perm as any).grantedAbilities : []),
  ];
  return keywordValues.some(value => /\bislandwalk\b/i.test(String(value || '')));
}

export function permanentHasColorLetter(perm: BattlefieldPermanent, colorLetter: string): boolean {
  const colors = Array.isArray((perm as any)?.colors)
    ? (perm as any).colors
    : Array.isArray((perm as any)?.card?.colors)
      ? (perm as any).card.colors
      : [];
  const wanted = String(colorLetter || '').trim().toUpperCase();
  return colors.some((color: unknown) => {
    const normalized = String(color || '').trim().toUpperCase();
    return normalized === wanted || normalized.startsWith(wanted);
  });
}

export function isAttackingBattlefieldPermanent(perm: BattlefieldPermanent): boolean {
  return Boolean(
    (perm as any)?.attacking ||
    (perm as any)?.attackedThisTurn ||
    (perm as any)?.attackingPlayerId
  );
}

export function permanentHasBattlefieldCounters(perm: BattlefieldPermanent): boolean {
  return Object.entries(((perm as any)?.counters || {}) as Record<string, number>).some(
    ([, count]) => Number(count) > 0
  );
}
