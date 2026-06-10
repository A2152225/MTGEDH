import { describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import {
  applyRetiredTriggerLegacyExtraTurnAfterThisOne,
  applyRetiredTriggerLegacyExileTargetPlayerGraveyard,
  applyRetiredTriggerLegacyGainControlOfTargetOpponent,
} from '../src/state/modules/oracleIrTriggerLegacyTurnAndZoneHandlers.js';

vi.mock('../src/state/modules/turn.js', () => ({
  addExtraTurn: vi.fn(),
}));

import { addExtraTurn } from '../src/state/modules/turn.js';

describe('oracleIrTriggerLegacyTurnAndZoneHandlers', () => {
  it('grants an extra turn after this one', () => {
    const ctx = {} as any;

    expect(applyRetiredTriggerLegacyExtraTurnAfterThisOne({
      ctx,
      controller: 'p1' as PlayerID,
      sourceName: 'Source',
      description: 'You take an extra turn after this one.',
    })).toBe(true);

    expect(addExtraTurn).toHaveBeenCalledWith(ctx, 'p1', 'Source');
  });

  it('exiles all cards from a target player graveyard', () => {
    const state = {
      zones: {
        p2: {
          graveyard: [{ id: 'c1', name: 'Card' }],
          graveyardCount: 1,
          exile: [],
          exileCount: 0,
        },
      },
    };

    expect(applyRetiredTriggerLegacyExileTargetPlayerGraveyard({
      desc: 'exile target player graveyard.',
      triggerItem: { targets: ['p2'] },
      state,
    })).toBe(true);

    expect(state.zones.p2.graveyard).toEqual([]);
    expect(state.zones.p2.exile).toHaveLength(1);
  });

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
