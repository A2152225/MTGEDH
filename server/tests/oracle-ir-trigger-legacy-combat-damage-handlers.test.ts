import { describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import {
  applyRetiredTriggerLegacyCombatDamageDrawEffects,
} from '../src/state/modules/oracleIrTriggerLegacyCombatDamageHandlers.js';

describe('oracleIrTriggerLegacyCombatDamageHandlers', () => {
  it('draws for each opponent dealt combat damage this turn', () => {
    const ctx = {
      bumpSeq: vi.fn(),
      libraries: new Map([['p1', [{ id: 'c1' }, { id: 'c2' }]]]),
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
        creaturesThatDealtDamageToPlayer: {
          p2: { c1: { creatureName: 'Attacker' } },
          p3: { c1: { creatureName: 'Attacker' } },
        },
        zones: { p1: { hand: [], handCount: 0 } },
      },
    } as any;

    expect(applyRetiredTriggerLegacyCombatDamageDrawEffects({
      ctx,
      controller: 'p1' as PlayerID,
      sourceName: 'Source',
      desc: 'draw cards equal to the number of opponents who were dealt combat damage this turn.',
      triggerItem: {},
      state: ctx.state,
      sourceNameLower: 'source',
      triggerSourceNameLower: 'source',
    })).toBe(true);

    expect(ctx.state.zones.p1.hand.length).toBe(2);
  });
});
