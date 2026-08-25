// server/src/socket/util-handlers/manaProvenanceLowerBounds.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: replay-safe lower-bound provenance tracking for mana sitting in a
//   player's pool - Treasure-produced mana, creature-spell-haste mana, and
//   per-permanent-source mana - plus the derive helpers that read those bounds.
// Public entry symbols: recordTreasureManaProduced, snapshotTreasureManaLowerBound,
//   applyManaSpendToTreasureLowerBound, deriveManaFromTreasureSpent,
//   recordCreatureSpellHasteManaProduced, snapshotCreatureSpellHasteManaLowerBound,
//   applyManaSpendToCreatureSpellHasteManaLowerBound, deriveCreatureSpellHasteFromManaSpent,
//   recordManaProducedByPermanentSource, snapshotManaProducedByPermanentLowerBound,
//   applyManaSpendToManaProducedByPermanentLowerBound, deriveCastUsedManaFromPermanentSource.
// Re-exported from util.ts so the "./util.js" import path keeps working.

import { getOrInitManaPool } from "./manaPoolStateOperations.js";

type ManaPoolColorKey = 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';

function getOrInitTreasureManaLowerBound(gameState: any, playerId: string): Record<ManaPoolColorKey, number> {
  const pool = getOrInitManaPool(gameState, String(playerId)) as any;
  pool.treasureManaLowerBound = pool.treasureManaLowerBound || {
    white: 0,
    blue: 0,
    black: 0,
    red: 0,
    green: 0,
    colorless: 0,
  };
  return pool.treasureManaLowerBound as Record<ManaPoolColorKey, number>;
}

/**
 * Best-effort, replay-safe lower-bound tracking for how much mana in the pool could
 * have been produced by Treasures.
 *
 * This is intentionally conservative:
 * - We only ever increment when we directly see a Treasure produce mana.
 * - We may decrement aggressively during spending so we never over-claim Treasure provenance.
 */
export function recordTreasureManaProduced(
  gameState: any,
  playerId: string,
  poolKey: ManaPoolColorKey,
  amount: number
): void {
  const n = Number(amount || 0);
  if (!Number.isFinite(n) || n <= 0) return;
  const lb = getOrInitTreasureManaLowerBound(gameState, playerId);
  lb[poolKey] = Number(lb[poolKey] || 0) + n;
}

export function snapshotTreasureManaLowerBound(gameState: any, playerId: string): Record<ManaPoolColorKey, number> {
  const lb = getOrInitTreasureManaLowerBound(gameState, playerId);
  return { ...lb };
}

export function applyManaSpendToTreasureLowerBound(
  gameState: any,
  playerId: string,
  consumed: Record<string, number> | null | undefined
): void {
  if (!consumed || typeof consumed !== 'object') return;
  const lb = getOrInitTreasureManaLowerBound(gameState, playerId);
  const keys: ManaPoolColorKey[] = ['white', 'blue', 'black', 'red', 'green', 'colorless'];
  for (const k of keys) {
    const used = Number((consumed as any)[k] || 0);
    if (!Number.isFinite(used) || used <= 0) continue;
    lb[k] = Math.max(0, Number(lb[k] || 0) - used);
  }
}

/**
 * Derive a replay-stable boolean for "mana from a Treasure was spent".
 *
 * We only return a known result when:
 * - No mana was spent at all => deterministically false.
 * - Treasure mana was *forced* based on a lower bound of Treasure-produced mana
 *   present in the pool at the moment of payment.
 */
export function deriveManaFromTreasureSpent(
  gameState: any,
  playerId: string,
  opts: {
    poolBeforePayment: Record<string, number> | null | undefined;
    consumed: Record<string, number> | null | undefined;
    treasureLowerBoundBeforePayment?: Record<string, number> | null | undefined;
  }
): { manaFromTreasureSpentKnown?: true; manaFromTreasureSpent?: boolean } {
  const consumed = opts.consumed;
  if (!consumed || typeof consumed !== 'object') return {};

  const keys: ManaPoolColorKey[] = ['white', 'blue', 'black', 'red', 'green', 'colorless'];
  const spentTotal = keys.reduce((sum, k) => sum + Number((consumed as any)[k] || 0), 0);

  if (spentTotal <= 0) {
    return { manaFromTreasureSpentKnown: true, manaFromTreasureSpent: false };
  }

  const poolBefore = (opts.poolBeforePayment && typeof opts.poolBeforePayment === 'object')
    ? opts.poolBeforePayment
    : {};
  const treasureLB = (opts.treasureLowerBoundBeforePayment && typeof opts.treasureLowerBoundBeforePayment === 'object')
    ? (opts.treasureLowerBoundBeforePayment as any)
    : snapshotTreasureManaLowerBound(gameState, playerId);

  for (const k of keys) {
    const used = Number((consumed as any)[k] || 0);
    if (!Number.isFinite(used) || used <= 0) continue;

    const before = Number((poolBefore as any)[k] || 0);
    const lb = Number((treasureLB as any)[k] || 0);
    const maxNonTreasure = Math.max(0, before - lb);
    const minTreasureSpent = Math.max(0, used - maxNonTreasure);
    if (minTreasureSpent > 0) {
      return { manaFromTreasureSpentKnown: true, manaFromTreasureSpent: true };
    }
  }

  return {};
}

function getOrInitCreatureSpellHasteManaLowerBound(gameState: any, playerId: string): Record<ManaPoolColorKey, number> {
  const pool = getOrInitManaPool(gameState, String(playerId)) as any;
  if (!pool.creatureSpellHasteManaLowerBound || typeof pool.creatureSpellHasteManaLowerBound !== 'object') {
    Object.defineProperty(pool, 'creatureSpellHasteManaLowerBound', {
      value: {
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
        colorless: 0,
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  return pool.creatureSpellHasteManaLowerBound as Record<ManaPoolColorKey, number>;
}

export function recordCreatureSpellHasteManaProduced(
  gameState: any,
  playerId: string,
  poolKey: ManaPoolColorKey,
  amount: number,
): void {
  const n = Number(amount || 0);
  if (!Number.isFinite(n) || n <= 0) return;
  const lb = getOrInitCreatureSpellHasteManaLowerBound(gameState, playerId);
  lb[poolKey] = Number(lb[poolKey] || 0) + n;
}

export function snapshotCreatureSpellHasteManaLowerBound(
  gameState: any,
  playerId: string,
): Record<ManaPoolColorKey, number> {
  const lb = getOrInitCreatureSpellHasteManaLowerBound(gameState, playerId);
  return { ...lb };
}

export function applyManaSpendToCreatureSpellHasteManaLowerBound(
  gameState: any,
  playerId: string,
  consumed: Record<string, number> | null | undefined,
): void {
  if (!consumed || typeof consumed !== 'object') return;
  const lb = getOrInitCreatureSpellHasteManaLowerBound(gameState, playerId);
  const keys: ManaPoolColorKey[] = ['white', 'blue', 'black', 'red', 'green', 'colorless'];
  for (const k of keys) {
    const used = Number((consumed as any)[k] || 0);
    if (!Number.isFinite(used) || used <= 0) continue;
    lb[k] = Math.max(0, Number(lb[k] || 0) - used);
  }
}

export function deriveCreatureSpellHasteFromManaSpent(
  gameState: any,
  playerId: string,
  opts: {
    poolBeforePayment: Record<string, number> | null | undefined;
    consumed: Record<string, number> | null | undefined;
    creatureSpellHasteLowerBoundBeforePayment?: Record<string, number> | null | undefined;
  },
): boolean {
  const consumed = opts.consumed;
  if (!consumed || typeof consumed !== 'object') return false;

  const keys: ManaPoolColorKey[] = ['white', 'blue', 'black', 'red', 'green', 'colorless'];
  const spentTotal = keys.reduce((sum, k) => sum + Number((consumed as any)[k] || 0), 0);
  if (spentTotal <= 0) return false;

  const poolBefore = (opts.poolBeforePayment && typeof opts.poolBeforePayment === 'object')
    ? opts.poolBeforePayment
    : {};
  const hasteLB = (opts.creatureSpellHasteLowerBoundBeforePayment && typeof opts.creatureSpellHasteLowerBoundBeforePayment === 'object')
    ? (opts.creatureSpellHasteLowerBoundBeforePayment as any)
    : snapshotCreatureSpellHasteManaLowerBound(gameState, playerId);

  for (const k of keys) {
    const used = Number((consumed as any)[k] || 0);
    if (!Number.isFinite(used) || used <= 0) continue;

    const before = Number((poolBefore as any)[k] || 0);
    const lb = Number((hasteLB as any)[k] || 0);
    const maxNormalMana = Math.max(0, before - lb);
    const minHasteManaSpent = Math.max(0, used - maxNormalMana);
    if (minHasteManaSpent > 0) {
      return true;
    }
  }

  return false;
}

function getOrInitManaProducedByPermanentLowerBound(gameState: any, playerId: string): Record<string, Record<ManaPoolColorKey, number>> {
  const pool = getOrInitManaPool(gameState, playerId) as any;
  if (!pool.manaProducedByPermanentLowerBound || typeof pool.manaProducedByPermanentLowerBound !== 'object') {
    Object.defineProperty(pool, 'manaProducedByPermanentLowerBound', {
      value: {},
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
  return pool.manaProducedByPermanentLowerBound as Record<string, Record<ManaPoolColorKey, number>>;
}

export function recordManaProducedByPermanentSource(
  gameState: any,
  playerId: string,
  permanentId: string,
  poolKey: ManaPoolColorKey,
  amount: number,
): void {
  const sourceId = String(permanentId || '').trim();
  const n = Number(amount || 0);
  if (!sourceId || !Number.isFinite(n) || n <= 0) return;
  const byPermanent = getOrInitManaProducedByPermanentLowerBound(gameState, playerId);
  const entry = byPermanent[sourceId] || {
    white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0,
  };
  entry[poolKey] = Number(entry[poolKey] || 0) + n;
  byPermanent[sourceId] = entry;
}

export function snapshotManaProducedByPermanentLowerBound(
  gameState: any,
  playerId: string,
): Record<string, Record<ManaPoolColorKey, number>> {
  const byPermanent = getOrInitManaProducedByPermanentLowerBound(gameState, playerId);
  const snapshot: Record<string, Record<ManaPoolColorKey, number>> = {};
  for (const [permanentId, colors] of Object.entries(byPermanent)) {
    snapshot[permanentId] = { ...(colors as Record<ManaPoolColorKey, number>) };
  }
  return snapshot;
}

export function applyManaSpendToManaProducedByPermanentLowerBound(
  gameState: any,
  playerId: string,
  consumed: Record<string, number> | null | undefined,
): void {
  if (!consumed || typeof consumed !== 'object') return;
  const byPermanent = getOrInitManaProducedByPermanentLowerBound(gameState, playerId);
  const keys: ManaPoolColorKey[] = ['white', 'blue', 'black', 'red', 'green', 'colorless'];
  for (const permanentId of Object.keys(byPermanent)) {
    const entry = byPermanent[permanentId];
    if (!entry) continue;
    for (const key of keys) {
      const used = Number((consumed as any)[key] || 0);
      if (!Number.isFinite(used) || used <= 0) continue;
      entry[key] = Math.max(0, Number(entry[key] || 0) - used);
    }
  }
}

export function deriveCastUsedManaFromPermanentSource(
  gameState: any,
  playerId: string,
  permanentId: string,
  opts: {
    poolBeforePayment?: Record<string, number> | null | undefined;
    consumed?: Record<string, number> | null | undefined;
    manaProducedByPermanentBeforePayment?: Record<string, Record<ManaPoolColorKey, number>> | null | undefined;
    manaPayment?: Array<{ permanentId?: string }> | null | undefined;
  },
): boolean {
  const sourceId = String(permanentId || '').trim();
  if (!sourceId) return false;

  const payment = Array.isArray(opts.manaPayment) ? opts.manaPayment : [];
  if (payment.some((entry) => String(entry?.permanentId || '').trim() === sourceId)) {
    return true;
  }

  const consumed = opts.consumed;
  if (!consumed || typeof consumed !== 'object') return false;

  const keys: ManaPoolColorKey[] = ['white', 'blue', 'black', 'red', 'green', 'colorless'];
  const spentTotal = keys.reduce((sum, key) => sum + Number((consumed as any)[key] || 0), 0);
  if (spentTotal <= 0) return false;

  const poolBefore = (opts.poolBeforePayment && typeof opts.poolBeforePayment === 'object')
    ? opts.poolBeforePayment
    : {};
  const sourceLB = (opts.manaProducedByPermanentBeforePayment && typeof opts.manaProducedByPermanentBeforePayment === 'object')
    ? (opts.manaProducedByPermanentBeforePayment[sourceId] || {})
    : (snapshotManaProducedByPermanentLowerBound(gameState, playerId)[sourceId] || {});

  for (const key of keys) {
    const used = Number((consumed as any)[key] || 0);
    if (!Number.isFinite(used) || used <= 0) continue;
    const before = Number((poolBefore as any)[key] || 0);
    const lb = Number((sourceLB as any)[key] || 0);
    const maxNormalMana = Math.max(0, before - lb);
    const minSourceManaSpent = Math.max(0, used - maxNormalMana);
    if (minSourceManaSpent > 0) {
      return true;
    }
  }

  return false;
}
