import { describe, expect, it } from 'vitest';

import {
  calculateManaProduction,
  parseRemoveCounterActivationCost,
  paymentActivationCostHasUnsupportedAdditionalCosts,
  permanentHasManaBatteryCounterLoop,
} from '../src/socket/util.js';

describe('mana-battery counter helpers', () => {
  it('parses self remove-counter costs with and without "from"', () => {
    expect(parseRemoveCounterActivationCost('Remove a charge counter from this artifact')).toMatchObject({
      count: 1,
      counterType: 'charge',
      refersToSource: true,
    });
    expect(parseRemoveCounterActivationCost('Remove a charge counter')).toMatchObject({
      count: 1,
      counterType: 'charge',
      refersToSource: true,
    });
    expect(
      parseRemoveCounterActivationCost('Remove a charge counter from Mirrodin\'s Core', "Mirrodin's Core"),
    ).toMatchObject({
      count: 1,
      counterType: 'charge',
      refersToSource: true,
    });
    expect(
      parseRemoveCounterActivationCost('Remove a charge counter from an artifact you control'),
    ).toMatchObject({
      refersToSource: false,
    });
  });

  it('treats self remove-counter clauses as supported spell-payment costs', () => {
    expect(paymentActivationCostHasUnsupportedAdditionalCosts('Remove a charge counter from this artifact')).toBe(false);
    expect(paymentActivationCostHasUnsupportedAdditionalCosts('Remove a charge counter')).toBe(false);
    expect(
      paymentActivationCostHasUnsupportedAdditionalCosts(
        "Remove a charge counter from Mirrodin's Core",
        "Mirrodin's Core",
      ),
    ).toBe(false);
    expect(
      paymentActivationCostHasUnsupportedAdditionalCosts('{T}, Remove a charge counter from this land'),
    ).toBe(false);
    expect(
      paymentActivationCostHasUnsupportedAdditionalCosts('Remove a charge counter from an artifact you control'),
    ).toBe(true);
  });

  it('detects pay-now / payout-later battery loops generically', () => {
    const gemstone = {
      card: {
        name: 'Gemstone Array',
        oracle_text:
          '{2}: Put a charge counter on this artifact.\nRemove a charge counter from this artifact: Add one mana of any color.',
      },
    };
    const mirrodinCore = {
      card: {
        name: "Mirrodin's Core",
        oracle_text:
          "{T}: Add {C}.\n{2}, {T}: Put a charge counter on Mirrodin's Core.\n{T}, Remove a charge counter from Mirrodin's Core: Add one mana of any color.",
      },
    };
    const pentadOnly = {
      card: {
        name: 'Pentad Prism',
        oracle_text: 'Sunburst\nRemove a charge counter: Add one mana of any color.',
      },
    };

    expect(permanentHasManaBatteryCounterLoop(gemstone)).toMatchObject({
      invests: true,
      paysOut: true,
      counterTypes: ['charge'],
    });
    expect(permanentHasManaBatteryCounterLoop(mirrodinCore)).toMatchObject({
      invests: true,
      paysOut: true,
      counterTypes: ['charge'],
    });
    // ETB/sunburst-only payouts are still payouts, but not invest-via-activation batteries.
    expect(permanentHasManaBatteryCounterLoop(pentadOnly).paysOut).toBe(true);
    expect(permanentHasManaBatteryCounterLoop(pentadOnly).invests).toBe(false);
  });

  it('gates mana production on available self counters for battery-style cards', () => {
    const prism = {
      id: 'prism_1',
      controller: 'player1',
      counters: {},
      card: {
        name: 'Pentad Prism',
        type_line: 'Artifact',
        oracle_text: 'Sunburst\nRemove a charge counter: Add one mana of any color.',
      },
    };

    expect(calculateManaProduction({ battlefield: [prism] }, prism, 'player1', 'G').totalAmount).toBe(0);

    const charged = { ...prism, counters: { charge: 2 } };
    expect(calculateManaProduction({ battlefield: [charged] }, charged, 'player1', 'G').totalAmount).toBe(1);
    expect(calculateManaProduction({ battlefield: [charged] }, charged, 'player1', 'G').colors).toContain('G');
  });
});
