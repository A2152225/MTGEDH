import { describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import {
  applyRetiredTriggerLegacyLoseGameReplacement,
  applyRetiredTriggerLegacyThousandLifeLoseGame,
  applyRetiredTriggerLegacyUpkeepEffectDoubling,
} from '../src/state/modules/oracleIrTriggerLegacyLifeAndGameHandlers.js';

describe('oracleIrTriggerLegacyLifeAndGameHandlers', () => {
  it('sets life to 0 when controller has 1,000 or more life', () => {
    const state = { life: { p1: 1200 } };

    expect(applyRetiredTriggerLegacyThousandLifeLoseGame({
      controller: 'p1' as PlayerID,
      sourceName: 'Test Source',
      desc: 'then, if you have 1,000 or more life, you lose the game.',
      triggerItem: {},
      state,
    })).toBe(true);

    expect(state.life.p1).toBe(0);
  });

  it('does not change life when below 1,000', () => {
    const state = { life: { p1: 999 } };

    expect(applyRetiredTriggerLegacyThousandLifeLoseGame({
      controller: 'p1' as PlayerID,
      sourceName: 'Test Source',
      desc: 'then, if you have 1,000 or more life, you lose the game.',
      triggerItem: {},
      state,
    })).toBe(true);

    expect(state.life.p1).toBe(999);
  });

  it('enables upkeep effect doubling on the source permanent', () => {
    const perm = { id: 'perm-1' };
    const state = { battlefield: [perm] };

    expect(applyRetiredTriggerLegacyUpkeepEffectDoubling({
      controller: 'p1' as PlayerID,
      sourceName: 'Test Source',
      desc: 'double the amount of life you lose and cards you draw for the rest of the game from this ability.',
      triggerItem: { source: 'perm-1' },
      state,
      battlefield: state.battlefield,
    })).toBe(true);

    expect(perm.upkeepEffectDoubling).toBe(true);
  });

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
