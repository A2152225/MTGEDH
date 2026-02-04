import { describe, expect, it } from 'vitest';

import {
  consumeManaFromPool,
  deriveManaFromTreasureSpent,
  getOrInitManaPool,
  recordTreasureManaProduced,
  snapshotTreasureManaLowerBound,
} from '../src/socket/util';

describe('Treasure mana provenance (activated abilities): pool lower-bound tracking', () => {
  it('derives deterministic false when no mana was spent', () => {
    const state: any = {};
    const pid = 'p1';
    const pool = getOrInitManaPool(state, pid) as any;

    const before = { ...pool };
    const treasureBefore = snapshotTreasureManaLowerBound(state, pid);
    const spend = consumeManaFromPool(pool, {}, 0);

    const meta = deriveManaFromTreasureSpent(state, pid, {
      poolBeforePayment: before,
      consumed: (spend as any).consumed,
      treasureLowerBoundBeforePayment: treasureBefore,
    });

    expect(meta).toEqual({ manaFromTreasureSpentKnown: true, manaFromTreasureSpent: false });
  });

  it('derives deterministic true when Treasure mana was forced by the lower bound', () => {
    const state: any = {};
    const pid = 'p1';
    const pool = getOrInitManaPool(state, pid) as any;

    // 1 white mana in pool, and we know at least 1 of it came from a Treasure.
    pool.white = 1;
    recordTreasureManaProduced(state, pid, 'white', 1);

    const before = { ...pool };
    const treasureBefore = snapshotTreasureManaLowerBound(state, pid);
    const spend = consumeManaFromPool(pool, { W: 1 }, 0);

    const meta = deriveManaFromTreasureSpent(state, pid, {
      poolBeforePayment: before,
      consumed: (spend as any).consumed,
      treasureLowerBoundBeforePayment: treasureBefore,
    });

    expect(meta).toEqual({ manaFromTreasureSpentKnown: true, manaFromTreasureSpent: true });

    // Lower bound is pessimistically decremented during spending.
    expect((pool as any).treasureManaLowerBound?.white ?? 0).toBe(0);
  });

  it('returns unknown when Treasure provenance is not forced', () => {
    const state: any = {};
    const pid = 'p1';
    const pool = getOrInitManaPool(state, pid) as any;

    pool.white = 1;
    // No Treasure provenance recorded.

    const before = { ...pool };
    const treasureBefore = snapshotTreasureManaLowerBound(state, pid);
    const spend = consumeManaFromPool(pool, { W: 1 }, 0);

    const meta = deriveManaFromTreasureSpent(state, pid, {
      poolBeforePayment: before,
      consumed: (spend as any).consumed,
      treasureLowerBoundBeforePayment: treasureBefore,
    });

    expect(meta.manaFromTreasureSpentKnown).toBeUndefined();
    expect(meta.manaFromTreasureSpent).toBeUndefined();
  });
});
