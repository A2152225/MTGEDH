import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import {
  applyRetiredTriggerLegacyLoseGameReplacement,
} from '../src/state/modules/oracleIrTriggerLegacyLifeAndGameHandlers.js';

describe('oracleIrTriggerLegacyLifeAndGameHandlers', () => {
  it('registers a lose-the-game replacement effect', () => {
    const state = { pendingLoseGameReplacements: [] as any[] };

    expect(applyRetiredTriggerLegacyLoseGameReplacement({
      controller: 'p1' as PlayerID,
      sourceName: 'Test Source',
      desc: 'the next time you would lose the game this turn, instead draw three cards and your life total becomes 5.',
      triggerItem: {},
      state,
    })).toBe(true);

    expect(state.pendingLoseGameReplacements).toHaveLength(1);
    expect(state.pendingLoseGameReplacements[0]).toMatchObject({
      playerId: 'p1',
      drawCount: 3,
      lifeTotal: 5,
      sourceName: 'Test Source',
      expiresAt: 'end_of_turn',
    });
  });
});
