import type { BattlefieldPermanent } from '../../shared/src';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';

export type LastKnownPermanentSnapshot = {
  readonly id: string;
  readonly name: string;
  readonly controller?: string;
  readonly owner?: string;
  readonly typeLine: string;
  readonly power: number | null;
  readonly toughness: number | null;
  readonly manaValue: number | null;
  readonly colors: readonly string[];
};

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getPermanentBaseStat(perm: BattlefieldPermanent | any, which: 'power' | 'toughness'): number | null {
  const baseKey = which === 'power' ? 'basePower' : 'baseToughness';
  const base = toFiniteNumber((perm as any)?.[baseKey]);
  if (base !== null) return base;

  const card = (perm as any)?.card || perm;
  return toFiniteNumber((card as any)?.[which]);
}

function getPermanentModifierDelta(perm: BattlefieldPermanent | any, which: 'power' | 'toughness'): number {
  const modifiers = Array.isArray((perm as any)?.modifiers) ? (perm as any).modifiers : [];
  let total = 0;

  for (const modifier of modifiers) {
    const modifierType = String((modifier as any)?.type || '').toLowerCase();
    if (modifierType !== 'powertoughness' && modifierType !== 'power_toughness') continue;
    const delta = Number((modifier as any)?.[which]);
    if (Number.isFinite(delta)) total += delta;
  }

  return total;
}

export function getPermanentLastKnownStat(
  perm: BattlefieldPermanent | any,
  which: 'power' | 'toughness'
): number | null {
  const effectiveKey = which === 'power' ? 'effectivePower' : 'effectiveToughness';
  const effective = toFiniteNumber((perm as any)?.[effectiveKey]);
  if (effective !== null) return effective;

  const base = getPermanentBaseStat(perm, which);
  if (base !== null) {
    const counters = (perm as any)?.counters || {};
    const plusOne = Number(counters?.['+1/+1']);
    const minusOne = Number(counters?.['-1/-1']);
    const plusDelta = Number.isFinite(plusOne) ? plusOne : 0;
    const minusDelta = Number.isFinite(minusOne) ? minusOne : 0;
    return base + plusDelta - minusDelta + getPermanentModifierDelta(perm, which);
  }

  const current = toFiniteNumber((perm as any)?.[which]);
  if (current !== null) return current;

  const card = (perm as any)?.card || perm;
  return toFiniteNumber((card as any)?.[which]);
}

export function createLastKnownPermanentSnapshot(perm: BattlefieldPermanent | any): LastKnownPermanentSnapshot {
  const card = (perm as any)?.card || perm;
  const colors = Array.isArray((perm as any)?.colors)
    ? (perm as any).colors
    : (Array.isArray((card as any)?.colors) ? (card as any).colors : []);

  return {
    id: String((perm as any)?.id || '').trim(),
    name: String((perm as any)?.name || (card as any)?.name || '').trim(),
    controller: String((perm as any)?.controller || '').trim() || undefined,
    owner: String((perm as any)?.owner || (perm as any)?.ownerId || '').trim() || undefined,
    typeLine: getExecutorTypeLineLower(perm),
    power: getPermanentLastKnownStat(perm, 'power'),
    toughness: getPermanentLastKnownStat(perm, 'toughness'),
    manaValue: getCardManaValue(card),
    colors: [...colors],
  };
}

export function lastKnownSnapshotHasClass(
  snapshot: LastKnownPermanentSnapshot,
  klass: 'creature' | 'artifact' | 'permanent'
): boolean {
  if (klass === 'permanent') return true;
  return snapshot.typeLine.includes(klass);
}
