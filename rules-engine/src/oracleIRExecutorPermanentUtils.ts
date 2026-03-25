import type { BattlefieldPermanent } from '../../shared/src';
import { isCurrentlyCreature } from './actions/combat';

export function isExecutorCreature(permanent: BattlefieldPermanent | any): boolean {
  if (isCurrentlyCreature(permanent)) {
    return true;
  }

  return getExecutorTypeLineLower(permanent).includes('creature');
}

export function getExecutorTypeLineLower(permanent: BattlefieldPermanent | any): string {
  const rawParts = [
    (permanent as any)?.cardType,
    (permanent as any)?.type_line,
    (permanent as any)?.card?.type_line,
  ]
    .map(value => String(value || '').toLowerCase().trim())
    .filter(Boolean);

  for (const list of [(permanent as any)?.types, (permanent as any)?.effectiveTypes, (permanent as any)?.grantedTypes]) {
    if (!Array.isArray(list)) continue;
    for (const value of list) {
      const normalized = String(value || '').toLowerCase().trim();
      if (normalized) rawParts.push(normalized);
    }
  }

  if (rawParts.length === 0) return '';

  const uniqueParts: string[] = [];
  for (const part of rawParts) {
    if (!uniqueParts.includes(part)) uniqueParts.push(part);
  }
  return uniqueParts.join(' ').trim();
}

export function hasExecutorClass(permanent: BattlefieldPermanent | any, klass: string): boolean {
  const tl = getExecutorTypeLineLower(permanent);
  if (!tl) return false;
  if (klass === 'creature') return isExecutorCreature(permanent);
  if (klass === 'permanent') {
    return (
      tl.includes('artifact') ||
      tl.includes('battle') ||
      tl.includes('creature') ||
      tl.includes('enchantment') ||
      tl.includes('land') ||
      tl.includes('planeswalker')
    );
  }
  if (klass === 'nonland permanent') return hasExecutorClass(permanent, 'permanent') && !tl.includes('land');
  return tl.includes(klass);
}

export function addDamageToPermanentLikeCreature(perm: BattlefieldPermanent, amount: number): BattlefieldPermanent {
  return addDamageToPermanentLikeCreatureFromSource(perm, amount);
}

export function addDamageToPermanentLikeCreatureFromSource(
  perm: BattlefieldPermanent,
  amount: number,
  sourcePermanentId?: string
): BattlefieldPermanent {
  const n = Math.max(0, amount | 0);
  if (n <= 0) return perm;

  const current =
    Number((perm as any).markedDamage ?? (perm as any).damageMarked ?? (perm as any).damage ?? (perm as any).counters?.damage ?? 0) || 0;
  const next = current + n;
  const counters = { ...(((perm as any).counters || {}) as any), damage: next };
  const currentDamageSourceIds = Array.isArray((perm as any)?.damageSourceIds)
    ? (perm as any).damageSourceIds
        .map((id: unknown) => String(id || '').trim())
        .filter(Boolean)
    : [];
  const normalizedSourcePermanentId = String(sourcePermanentId || '').trim();
  const damageSourceIds =
    normalizedSourcePermanentId && !currentDamageSourceIds.includes(normalizedSourcePermanentId)
      ? [...currentDamageSourceIds, normalizedSourcePermanentId]
      : currentDamageSourceIds;
  return {
    ...(perm as any),
    counters,
    markedDamage: next,
    damageMarked: next,
    damage: next,
    ...(damageSourceIds.length > 0 ? { damageSourceIds } : {}),
  } as any;
}

export function getExcessDamageToPermanent(perm: BattlefieldPermanent, amount: number): number {
  const n = Math.max(0, amount | 0);
  if (n <= 0) return 0;

  if (hasExecutorClass(perm, 'creature')) {
    const toughness = Number((perm as any)?.toughness ?? (perm as any)?.card?.toughness);
    if (!Number.isFinite(toughness)) return 0;
    const marked =
      Number((perm as any).markedDamage ?? (perm as any).damageMarked ?? (perm as any).damage ?? (perm as any).counters?.damage ?? 0) || 0;
    const remaining = Math.max(0, toughness - marked);
    return Math.max(0, n - remaining);
  }

  if (hasExecutorClass(perm, 'planeswalker')) {
    const loyalty = Number((perm as any).loyalty ?? (perm as any).counters?.loyalty ?? 0);
    if (!Number.isFinite(loyalty)) return 0;
    return Math.max(0, n - Math.max(0, loyalty));
  }

  if (hasExecutorClass(perm, 'battle')) {
    const defense = Number((perm as any).counters?.defense ?? 0);
    if (!Number.isFinite(defense)) return 0;
    return Math.max(0, n - Math.max(0, defense));
  }

  return 0;
}

export function removeLoyaltyFromPlaneswalker(perm: BattlefieldPermanent, amount: number): BattlefieldPermanent {
  const n = Math.max(0, amount | 0);
  if (n <= 0) return perm;

  const current = Number((perm as any).loyalty ?? (perm as any).counters?.loyalty ?? 0) || 0;
  const next = Math.max(0, current - n);
  const counters = { ...(((perm as any).counters || {}) as any), loyalty: next };
  return { ...(perm as any), counters, loyalty: next } as any;
}

export function removeDefenseCountersFromBattle(perm: BattlefieldPermanent, amount: number): BattlefieldPermanent {
  const n = Math.max(0, amount | 0);
  if (n <= 0) return perm;

  const current = Number((perm as any).counters?.defense ?? 0);
  if (!Number.isFinite(current)) return perm;

  const next = Math.max(0, current - n);
  const counters = { ...(((perm as any).counters || {}) as any), defense: next };
  return { ...(perm as any), counters } as any;
}
