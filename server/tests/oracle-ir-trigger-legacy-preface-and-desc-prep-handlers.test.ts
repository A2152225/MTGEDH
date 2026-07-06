import { describe, expect, it } from 'vitest';

import {
  computeTriggerLegacyIsKynaiosEffect,
  stripTriggerLegacyInterveningIfPrefix,
} from '../src/state/modules/oracleIrTriggerLegacyDescPrepHandlers.js';
import { applyPlaneswalkerLoyaltyCountersFromTriggerMetadata } from '../src/state/modules/triggerPlaneswalkerLoyaltyUtils.js';

describe('oracleIrTriggerLegacyPrefaceAndDescPrepHandlers', () => {
  it('adds loyalty counters to a planeswalker permanent', () => {
    const perm = { id: 'pw-1', counters: { loyalty: 3 } };

    expect(applyPlaneswalkerLoyaltyCountersFromTriggerMetadata({
      sourceName: 'Chandra',
      triggerItem: { permanentId: 'pw-1', addsLoyaltyCounters: 1 },
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
