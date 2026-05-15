export interface CounterRemovalCostSpec {
  type?: 'remove_counters';
  amount: number;
  filter?: string;
  counterType?: string;
  distributed?: boolean;
}

export interface CounterRemovalCostOption {
  id: string;
  permanentId: string;
  permanentName: string;
  counterType: string;
  counterIndex: number;
  name: string;
  imageUrl?: string;
  typeLine?: string;
}

const COUNTER_REMOVAL_OPTION_PREFIX = 'counter-cost';

function isPositiveInteger(value: unknown): boolean {
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

export function isRemovableCounterType(counterType: unknown): boolean {
  const normalized = String(counterType || '').trim().toLowerCase();
  return Boolean(normalized) && normalized !== 'damage' && normalized !== 'marked damage';
}

function normalizeFilterWord(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized.endsWith('ies') && normalized.length > 3) return `${normalized.slice(0, -3)}y`;
  if (normalized.endsWith('s') && !normalized.endsWith('ss') && normalized.length > 3) return normalized.slice(0, -1);
  return normalized;
}

export function permanentMatchesCounterRemovalFilter(permanent: any, filter?: string): boolean {
  if (!permanent) return false;
  const normalizedFilter = normalizeFilterWord(filter || 'permanent');
  if (!normalizedFilter || normalizedFilter === 'permanent') return true;

  const typeLine = String(permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || '').toLowerCase();
  const cardTypes = Array.isArray(permanent?.card?.types)
    ? permanent.card.types.map((entry: any) => String(entry || '').toLowerCase())
    : [];

  if (normalizedFilter === 'creature') {
    return typeLine.includes('creature') || permanent.isCreature === true || cardTypes.includes('creature');
  }

  return typeLine.includes(normalizedFilter) || cardTypes.includes(normalizedFilter);
}

export function encodeCounterRemovalCostOptionId(permanentId: string, counterType: string, counterIndex: number): string {
  return `${COUNTER_REMOVAL_OPTION_PREFIX}:${encodeURIComponent(String(permanentId || ''))}:${encodeURIComponent(String(counterType || ''))}:${Math.max(1, Math.floor(Number(counterIndex || 1)))}`;
}

export function buildCounterRemovalCostOptions(
  state: any,
  playerId: string,
  cost: CounterRemovalCostSpec,
): CounterRemovalCostOption[] {
  const amount = Math.max(0, Math.floor(Number(cost?.amount || 0)));
  if (amount <= 0) return [];

  const requiredCounterType = String(cost?.counterType || '').trim();
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const options: CounterRemovalCostOption[] = [];

  for (const permanent of battlefield) {
    if (!permanent || String(permanent.controller || '') !== String(playerId || '')) continue;
    if (!permanentMatchesCounterRemovalFilter(permanent, cost?.filter || 'creature')) continue;

    const counters = permanent.counters && typeof permanent.counters === 'object' && !Array.isArray(permanent.counters)
      ? permanent.counters as Record<string, unknown>
      : {};
    const permanentId = String(permanent.id || '').trim();
    if (!permanentId) continue;

    for (const [rawCounterType, rawCount] of Object.entries(counters)) {
      const counterType = String(rawCounterType || '').trim();
      if (!isRemovableCounterType(counterType)) continue;
      if (requiredCounterType && counterType.toLowerCase() !== requiredCounterType.toLowerCase()) continue;

      const count = Math.floor(Number(rawCount || 0));
      if (!isPositiveInteger(count)) continue;

      const permanentName = String(permanent?.card?.name || permanent?.name || 'Permanent');
      for (let index = 1; index <= count; index += 1) {
        options.push({
          id: encodeCounterRemovalCostOptionId(permanentId, counterType, index),
          permanentId,
          permanentName,
          counterType,
          counterIndex: index,
          name: `${permanentName} - ${counterType} counter ${index}`,
          imageUrl: permanent?.card?.image_uris?.small || permanent?.card?.image_uris?.normal,
          typeLine: permanent?.card?.type_line || permanent?.card?.typeLine,
        });
      }
    }
  }

  return options;
}

export function getTotalAvailableCountersForRemovalCost(
  state: any,
  playerId: string,
  cost: CounterRemovalCostSpec,
): number {
  return buildCounterRemovalCostOptions(state, playerId, cost).length;
}

export function canPayCounterRemovalCost(state: any, playerId: string, cost: CounterRemovalCostSpec): boolean {
  const amount = Math.max(0, Math.floor(Number(cost?.amount || 0)));
  if (amount <= 0) return true;
  return getTotalAvailableCountersForRemovalCost(state, playerId, cost) >= amount;
}