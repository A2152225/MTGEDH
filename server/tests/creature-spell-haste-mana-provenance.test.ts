import { describe, expect, it } from 'vitest';

import {
  consumeManaFromPool,
  deriveCreatureSpellHasteFromManaSpent,
  getOrInitManaPool,
  recordCreatureSpellHasteManaProduced,
  snapshotCreatureSpellHasteManaLowerBound,
} from '../src/socket/util.js';

describe('Creature-spell haste mana provenance', () => {
  it('derives true when payment must have consumed haste-granting mana', () => {
    const state: any = { manaPool: {} };
    const playerId = 'p1';
    const pool = getOrInitManaPool(state, playerId) as any;

    pool.red = 2;
    recordCreatureSpellHasteManaProduced(state, playerId, 'red', 2);

    const poolBeforePayment = { ...pool };
    const lowerBoundBeforePayment = snapshotCreatureSpellHasteManaLowerBound(state, playerId);
    const manaConsumption = consumeManaFromPool(pool, { R: 1 }, 1);

    expect(manaConsumption).not.toBeNull();
    expect(
      deriveCreatureSpellHasteFromManaSpent(state, playerId, {
        poolBeforePayment,
        consumed: (manaConsumption as any).consumed,
        creatureSpellHasteLowerBoundBeforePayment: lowerBoundBeforePayment,
      }),
    ).toBe(true);
  });

  it('derives false when no haste-granting mana was recorded in the pool', () => {
    const state: any = { manaPool: {} };
    const playerId = 'p1';
    const pool = getOrInitManaPool(state, playerId) as any;

    pool.red = 2;

    const poolBeforePayment = { ...pool };
    const lowerBoundBeforePayment = snapshotCreatureSpellHasteManaLowerBound(state, playerId);
    const manaConsumption = consumeManaFromPool(pool, { R: 1 }, 1);

    expect(manaConsumption).not.toBeNull();
    expect(
      deriveCreatureSpellHasteFromManaSpent(state, playerId, {
        poolBeforePayment,
        consumed: (manaConsumption as any).consumed,
        creatureSpellHasteLowerBoundBeforePayment: lowerBoundBeforePayment,
      }),
    ).toBe(false);
  });
});