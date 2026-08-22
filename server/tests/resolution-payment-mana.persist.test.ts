import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/index.js', () => ({
  appendEvent: vi.fn(),
}));

import { appendEvent } from '../src/db/index.js';
import { persistResolutionPaymentManaMutations } from '../src/socket/resolution.js';

describe('persistResolutionPaymentManaMutations', () => {
  beforeEach(() => {
    vi.mocked(appendEvent).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('appends permanent_tapped and mana pool events for live payments', () => {
    const game = {
      gameId: 't_persist_resolution_payment_emit',
      seq: 7,
      isReplaying: false,
    };

    persistResolutionPaymentManaMutations(
      game,
      'p1',
      ['forest_1', 'island_1'],
      { green: 0, blue: -1, colorless: -1 },
    );

    const calls = vi.mocked(appendEvent).mock.calls;
    const types = calls.map((c) => String(c[2]));
    expect(types).toContain('permanent_tapped');
    expect(types).toContain('removeManaFromPool');

    const tapCall = calls.find((c) => c[2] === 'permanent_tapped');
    expect(tapCall?.[0]).toBe('t_persist_resolution_payment_emit');
    expect(tapCall?.[3]?.permanentIds).toEqual(['forest_1', 'island_1']);

    const removals = calls.filter((c) => c[2] === 'removeManaFromPool').map((c) => c[3]);
    expect(removals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ playerId: 'p1', color: 'blue', amount: 1 }),
        expect.objectContaining({ playerId: 'p1', color: 'colorless', amount: 1 }),
      ]),
    );
  });

  it('skips append while replaying or when skipEventPersistence is set', () => {
    persistResolutionPaymentManaMutations(
      { gameId: 't_persist_skip_replay', seq: 1, isReplaying: true },
      'p1',
      ['forest_1'],
      { colorless: -1 },
    );
    persistResolutionPaymentManaMutations(
      { gameId: 't_persist_skip_flag', seq: 1, isReplaying: false },
      'p1',
      ['forest_1'],
      { colorless: -1 },
      { skipEventPersistence: true },
    );
    expect(vi.mocked(appendEvent).mock.calls).toHaveLength(0);
  });
});
