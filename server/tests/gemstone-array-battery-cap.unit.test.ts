import { describe, expect, it } from 'vitest';

import { permanentHasManaBatteryCounterLoop } from '../src/socket/util.js';

describe('Gemstone Array mana-battery detection', () => {
  const gemstone = {
    id: 'ga1',
    controller: 'player1',
    counters: { charge: 62 },
    card: {
      id: 'gemstone-array-card',
      name: 'Gemstone Array',
      type_line: 'Artifact',
      oracle_text:
        '{2}: Put a charge counter on this artifact.\nRemove a charge counter from this artifact: Add one mana of any color.',
    },
  };

  it('detects invest + payout loop and charge counter type', () => {
    const battery = permanentHasManaBatteryCounterLoop(gemstone);
    expect(battery.invests).toBe(true);
    expect(battery.paysOut).toBe(true);
    expect(battery.counterTypes).toContain('charge');
  });

  it('reads existing high charge counts from the permanent', () => {
    expect(Number(gemstone.counters.charge)).toBe(62);
  });
});
