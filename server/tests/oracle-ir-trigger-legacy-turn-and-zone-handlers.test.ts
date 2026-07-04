import { describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import {
  applyRetiredTriggerLegacyGainControlOfTargetOpponent,
} from '../src/state/modules/oracleIrTriggerLegacyTurnAndZoneHandlers.js';

vi.mock('../src/state/modules/turn.js', () => ({
  addExtraTurn: vi.fn(),
}));

import { addExtraTurn } from '../src/state/modules/turn.js';

describe('oracleIrTriggerLegacyTurnAndZoneHandlers', () => {
  it('registers Emrakul-style opponent control and extra turn', () => {
    const ctx = {} as any;
    const state = {} as any;

    expect(applyRetiredTriggerLegacyGainControlOfTargetOpponent({
      ctx,
      controller: 'p1' as PlayerID,
      sourceName: 'Emrakul',
      description: 'You gain control of target opponent during that player\'s next turn.',
      triggerItem: { targets: ['p2'] },
      state,
    })).toBe(true);

    expect(state.controlledPlayerNextTurn.p2).toBe('p1');
    expect(addExtraTurn).toHaveBeenCalledWith(ctx, 'p2', 'Emrakul');
  });
});
