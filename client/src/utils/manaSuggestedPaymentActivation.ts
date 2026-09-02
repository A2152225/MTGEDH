// Origin parent: client/src/utils/manaUtils.ts / manaSourceBuilder.ts
// Cluster moved: sequential {1}{T} mana-ability auto-pay (Signets, Talismans).
// Public entry symbols: getSourceActivationManaPips, getFixedMixedManaBundleColors,
//   tryAssignFixedMixedManaBundle, chargeSourceActivationCost, sortPaymentItemsForSequentialActivation,
//   manaPoolToColorRecord, simulateSequentialPaymentPool.

import type { PaymentItem } from '../../../shared/src';
import type { Color, ManaPaymentSource } from './manaUtils';

const MANA_COLOR_SET = new Set<Color>(['W', 'U', 'B', 'R', 'G', 'C']);

export function getSourceActivationManaPips(source: Pick<ManaPaymentSource, 'activationManaCost'>): number {
  const tokens = String(source.activationManaCost || '').match(/\{[^}]+\}/g) || [];
  let pips = 0;
  for (const token of tokens) {
    const symbol = token.replace(/[{}]/g, '').toUpperCase();
    if (/^\d+$/.test(symbol)) {
      pips += Number.parseInt(symbol, 10) || 0;
      continue;
    }
    if (MANA_COLOR_SET.has(symbol as Color)) {
      pips += 1;
    }
  }
  return Math.max(0, pips);
}

export function getFixedMixedManaBundleColors(source: Pick<ManaPaymentSource, 'producedColors'>): Color[] | null {
  const produced = Array.isArray(source.producedColors)
    ? source.producedColors.filter((color): color is Color => MANA_COLOR_SET.has(color))
    : [];
  if (produced.length < 2) return null;
  if (new Set(produced).size <= 1) return null;
  return produced;
}

export type MixedBundleAssignState = {
  genericLeft: number;
  costRemaining: Record<Color, number>;
  remainingSourceCapacity: Map<string, number>;
  remainingNative: Map<string, number>;
  usedPermanentIds: Set<string>;
};

/**
 * Assign one activation of a fixed mixed bundle (Rakdos Signet {B}{R}) atomically.
 * Returns null when the source is not that kind of ability so the caller uses the normal path.
 */
export function tryAssignFixedMixedManaBundle(
  source: ManaPaymentSource,
  color: Color,
  requestedAmount: number,
  state: MixedBundleAssignState,
  appendProducedMana: (sourceId: string, color: Color, amount: number) => void,
): number | null {
  const bundle = getFixedMixedManaBundleColors(source);
  if (!bundle) return null;

  const available = state.remainingSourceCapacity.get(source.id) || 0;
  if (available <= 0 || requestedAmount <= 0) return 0;
  if (bundle.length > available) return 0;
  if (!bundle.includes(color)) return 0;

  const sourcePermanentId = String(source.sourcePermanentId || source.id || '').trim();
  if (sourcePermanentId) {
    state.usedPermanentIds.add(sourcePermanentId);
  }

  const leftover: Color[] = [];
  let assigned = 0;
  for (const produced of bundle) {
    appendProducedMana(source.id, produced, 1);
    if (produced === color && assigned < requestedAmount) {
      assigned += 1;
    } else {
      leftover.push(produced);
    }
  }

  for (const extraColor of leftover) {
    if (state.costRemaining[extraColor] > 0) {
      state.costRemaining[extraColor] -= 1;
    } else if (state.genericLeft > 0) {
      state.genericLeft -= 1;
    }
  }

  state.remainingSourceCapacity.set(source.id, available - bundle.length);
  state.remainingNative.set(
    source.id,
    Math.max(0, (state.remainingNative.get(source.id) || 0) - bundle.length),
  );

  return assigned;
}

export function chargeSourceActivationCost(
  source: Pick<ManaPaymentSource, 'id' | 'activationManaCost'>,
  unitsUsed: number,
  alreadyCharged: Map<string, number>,
): number {
  const pips = getSourceActivationManaPips(source);
  if (pips <= 0 || unitsUsed <= 0) return 0;

  const previous = alreadyCharged.get(source.id) || 0;
  if (unitsUsed <= previous) return 0;

  alreadyCharged.set(source.id, unitsUsed);
  return pips * (unitsUsed - previous);
}

export function sortPaymentItemsForSequentialActivation(
  items: PaymentItem[],
  sourceById: ReadonlyMap<string, ManaPaymentSource>,
): PaymentItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftId = String(left.item.permanentId || '');
      const rightId = String(right.item.permanentId || '');
      const leftPool = leftId.startsWith('__pool__');
      const rightPool = rightId.startsWith('__pool__');
      if (leftPool !== rightPool) return leftPool ? -1 : 1;

      const leftPips = getPaymentItemActivationPips(left.item, sourceById);
      const rightPips = getPaymentItemActivationPips(right.item, sourceById);
      if (leftPips !== rightPips) return leftPips - rightPips;
      return left.index - right.index;
    })
    .map((entry) => entry.item);
}

function getPaymentItemActivationPips(
  item: PaymentItem,
  sourceById: ReadonlyMap<string, Pick<ManaPaymentSource, 'activationManaCost'>>,
): number {
  const paymentSourceId = String((item as { paymentSourceId?: string }).paymentSourceId || '');
  const source = (paymentSourceId && sourceById.get(paymentSourceId))
    || sourceById.get(String(item.permanentId || ''));
  return source ? getSourceActivationManaPips(source) : 0;
}

const GENERIC_DRAIN_ORDER: readonly Color[] = ['C', 'W', 'U', 'B', 'R', 'G'];

export function manaPoolToColorRecord(
  pool?: Partial<Record<'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless', number>> | null,
): Record<Color, number> {
  return {
    W: Number(pool?.white || 0),
    U: Number(pool?.blue || 0),
    B: Number(pool?.black || 0),
    R: Number(pool?.red || 0),
    G: Number(pool?.green || 0),
    C: Number(pool?.colorless || 0),
  };
}

function emptyColorPool(): Record<Color, number> {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

function addPaymentItemProduction(pool: Record<Color, number>, item: PaymentItem): void {
  const produced = Array.isArray(item.producedColors)
    ? item.producedColors
        .map((color) => String(color || '').toUpperCase())
        .filter((color): color is Color => MANA_COLOR_SET.has(color as Color))
    : [];
  if (produced.length > 0) {
    for (const color of produced) {
      pool[color] = (pool[color] || 0) + 1;
    }
    return;
  }

  const mana = String(item.mana || '').toUpperCase() as Color;
  if (!MANA_COLOR_SET.has(mana)) return;
  const amount = Math.max(1, Number(item.count || 1));
  pool[mana] = (pool[mana] || 0) + amount;
}

function consumeGenericPipsFromColorPool(pool: Record<Color, number>, pips: number): number {
  let left = Math.max(0, pips);
  for (const color of GENERIC_DRAIN_ORDER) {
    if (left <= 0) break;
    const available = Number(pool[color] || 0);
    if (available <= 0) continue;
    const use = Math.min(available, left);
    pool[color] = available - use;
    left -= use;
  }
  return left;
}

export type SequentialPaymentPoolResult = {
  pool: Record<Color, number>;
  unpaidActivationPips: number;
};

/**
 * Replay payment items in tap order: pay each source's extra activation cost from
 * the running pool, then add what it produces. Lands that only exist to float a
 * Signet `{1}` are consumed before the bundle is added.
 */
export function simulateSequentialPaymentPool(
  payment: PaymentItem[],
  sourceById: ReadonlyMap<string, Pick<ManaPaymentSource, 'activationManaCost'>>,
  startingPool?: Partial<Record<Color, number>> | null,
): SequentialPaymentPoolResult {
  const pool = emptyColorPool();
  pool.W = Number(startingPool?.W || 0);
  pool.U = Number(startingPool?.U || 0);
  pool.B = Number(startingPool?.B || 0);
  pool.R = Number(startingPool?.R || 0);
  pool.G = Number(startingPool?.G || 0);
  pool.C = Number(startingPool?.C || 0);

  let unpaidActivationPips = 0;
  for (const item of Array.isArray(payment) ? payment : []) {
    const permanentId = String(item.permanentId || '');
    if (!permanentId.startsWith('__pool__')) {
      unpaidActivationPips += consumeGenericPipsFromColorPool(
        pool,
        getPaymentItemActivationPips(item, sourceById),
      );
    }
    addPaymentItemProduction(pool, item);
  }

  return { pool, unpaidActivationPips };
}
