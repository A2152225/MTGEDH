import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import {
  computeTriggerLegacyIsKynaiosEffect,
  stripTriggerLegacyInterveningIfPrefix,
} from '../src/state/modules/oracleIrTriggerLegacyDescPrepHandlers.js';
import { applyRetiredTriggerLegacyPlaneswalkerLoyaltyCounters } from '../src/state/modules/oracleIrTriggerLegacyPrefaceHandlers.js';

describe('oracleIrTriggerLegacyPrefaceAndDescPrepHandlers', () => {
  it('adds loyalty counters to a planeswalker permanent', () => {
    const perm = { id: 'pw-1', counters: { loyalty: 3 } };

    expect(applyRetiredTriggerLegacyPlaneswalkerLoyaltyCounters({
      ctx: {} as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Chandra',
      description: 'Add a loyalty counter.',
      triggerItem: { permanentId: 'pw-1', addsLoyaltyCounters: 1 },
      state: {},
      battlefield: [perm],
    })).toBe(true);

    expect(perm.counters.loyalty).toBe(4);
  });

  it('strips leading intervening-if clauses from desc', () => {
    expect(stripTriggerLegacyInterveningIfPrefix(
      'if that player has two or fewer cards in hand, that player loses 3 life.',
    )).toBe('that player loses 3 life.');
  });

  it('detects Kynaios-style effects', () => {
    expect(computeTriggerLegacyIsKynaiosEffect(
      'Kynaios and Tiro of Meletis',
      {},
      'each player may put a land card from their hand onto the battlefield. then each opponent who didn\'t draws a card.',
    )).toBe(true);
  });
});
