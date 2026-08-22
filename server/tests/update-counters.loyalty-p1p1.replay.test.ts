import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { applyPlaneswalkerLoyaltyCountersFromTriggerMetadata } from '../src/state/modules/triggerPlaneswalkerLoyaltyUtils.js';
import { applySimpleTargetedTemporarySpellEffects } from '../src/state/modules/oracleIrSpellLegacyTargetBuffUtils.js';

vi.mock('../src/db/index.js', () => ({
  appendEvent: vi.fn(),
}));

import { appendEvent } from '../src/db/index.js';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('undo/replay High #3: route loyalty / +1/+1 through updateCounters', () => {
  beforeEach(() => {
    vi.mocked(appendEvent).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('updateCounters syncs top-level loyalty and persists updateCounters event', () => {
    const gameId = 't_loyalty_update_counters_persist';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'pw_1',
        controller: p1,
        owner: p1,
        loyalty: 3,
        counters: { loyalty: 3 },
        card: { id: 'pw_card', name: 'Walker', type_line: 'Legendary Planeswalker', loyalty: 3 },
      },
    ];

    vi.mocked(appendEvent).mockClear();
    game.updateCounters('pw_1', { loyalty: 2 });

    const perm = ((game.state as any).battlefield || []).find((p: any) => p.id === 'pw_1');
    expect(perm?.counters?.loyalty).toBe(5);
    expect(perm?.loyalty).toBe(5);

    const counterAppends = vi.mocked(appendEvent).mock.calls.filter(
      (call) => String(call[2] || '') === 'updateCounters',
    );
    expect(counterAppends.length).toBeGreaterThanOrEqual(1);
    expect(counterAppends[0]?.[3]?.deltas).toEqual({ loyalty: 2 });
  });

  it('replays updateCounters loyalty deltas without nesting another append', () => {
    const gameId = 't_loyalty_update_counters_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'pw_1',
        controller: p1,
        owner: p1,
        loyalty: 4,
        counters: { loyalty: 4 },
        card: { id: 'pw_card', name: 'Walker', type_line: 'Legendary Planeswalker', loyalty: 4 },
      },
    ];

    vi.mocked(appendEvent).mockClear();
    game.applyEvent({
      type: 'updateCounters',
      permanentId: 'pw_1',
      deltas: { loyalty: -2 },
    } as any);

    const perm = ((game.state as any).battlefield || []).find((p: any) => p.id === 'pw_1');
    expect(perm?.counters?.loyalty).toBe(2);
    expect(perm?.loyalty).toBe(2);

    const nested = vi.mocked(appendEvent).mock.calls.filter(
      (call) => String(call[2] || '') === 'updateCounters',
    );
    expect(nested).toHaveLength(0);
  });

  it('applyPlaneswalkerLoyaltyCountersFromTriggerMetadata persists via updateCounters', () => {
    const gameId = 't_loyalty_trigger_metadata';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const planeswalker = {
      id: 'pw_1',
      controller: p1,
      owner: p1,
      loyalty: 3,
      counters: { loyalty: 3 },
      card: { id: 'pw_card', name: 'Walker', type_line: 'Legendary Planeswalker', loyalty: 3 },
    };
    (game.state as any).battlefield = [planeswalker];

    const ctx = {
      state: game.state,
      bumpSeq: typeof game.bumpSeq === 'function' ? game.bumpSeq.bind(game) : (() => {}),
      gameId,
    } as any;

    vi.mocked(appendEvent).mockClear();
    const handled = applyPlaneswalkerLoyaltyCountersFromTriggerMetadata({
      ctx,
      sourceName: 'Loyalty Buddy',
      triggerItem: { permanentId: 'pw_1', addsLoyaltyCounters: 2 },
      battlefield: (game.state as any).battlefield,
    });

    expect(handled).toBe(true);
    expect(planeswalker.counters.loyalty).toBe(5);
    expect(planeswalker.loyalty).toBe(5);

    const counterAppends = vi.mocked(appendEvent).mock.calls.filter(
      (call) => String(call[2] || '') === 'updateCounters',
    );
    expect(counterAppends.length).toBeGreaterThanOrEqual(1);
    expect(counterAppends[0]?.[3]).toMatchObject({
      permanentId: 'pw_1',
      deltas: { loyalty: 2 },
    });
  });

  it('legacy target buff +1/+1 counters go through updateCounters (not silent write)', () => {
    const gameId = 't_legacy_buff_counters';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'bear_1',
        controller: p1,
        owner: p1,
        counters: {},
        card: {
          id: 'bear_card',
          name: 'Bear',
          type_line: 'Creature — Bear',
          power: '2',
          toughness: '2',
        },
      },
    ];

    const ctx = {
      state: game.state,
      bumpSeq: typeof game.bumpSeq === 'function' ? game.bumpSeq.bind(game) : (() => {}),
      gameId,
    } as any;

    vi.mocked(appendEvent).mockClear();

    // Multi-clause text avoids ADD_COUNTERS_TARGET primary categorize (exact ^...$),
    // so the legacy fallback still owns the +1/+1 write — which must go through updateCounters.
    const applied = applySimpleTargetedTemporarySpellEffects(
      ctx,
      'Put a +1/+1 counter on target creature. It gains flying until end of turn.',
      ['bear_1'],
      'Test Spell',
    );

    expect(applied).toBeGreaterThanOrEqual(1);
    const bear = ((game.state as any).battlefield || []).find((p: any) => p.id === 'bear_1');
    expect(bear?.counters?.['+1/+1']).toBe(1);

    const counterAppends = vi.mocked(appendEvent).mock.calls.filter(
      (call) => String(call[2] || '') === 'updateCounters',
    );
    expect(counterAppends.length).toBeGreaterThanOrEqual(1);
    expect(counterAppends.some((call) => {
      const payload = call[3] as any;
      return payload?.permanentId === 'bear_1' && Number(payload?.deltas?.['+1/+1'] || 0) === 1;
    })).toBe(true);
  });

  it('activatePlaneswalkerAbility apply uses updateCounters without nested append', () => {
    const gameId = 't_activate_pw_loyalty_apply';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'pw_1',
        controller: p1,
        owner: p1,
        loyalty: 4,
        counters: { loyalty: 4 },
        card: {
          id: 'pw_card',
          name: 'Walker',
          type_line: 'Legendary Planeswalker — Test',
          loyalty: 4,
          oracle_text: '+1: Draw a card.\n-2: Destroy target creature.',
        },
      },
    ];

    vi.mocked(appendEvent).mockClear();
    game.applyEvent({
      type: 'activatePlaneswalkerAbility',
      playerId: p1,
      permanentId: 'pw_1',
      abilityIndex: 0,
      loyaltyCost: 1,
      newLoyalty: 5,
      abilityText: 'Draw a card.',
      activatedAbilityText: '+1: Draw a card.',
    } as any);

    const perm = ((game.state as any).battlefield || []).find((p: any) => p.id === 'pw_1');
    expect(perm?.counters?.loyalty).toBe(5);
    expect(perm?.loyalty).toBe(5);

    const nested = vi.mocked(appendEvent).mock.calls.filter(
      (call) => String(call[2] || '') === 'updateCounters',
    );
    expect(nested).toHaveLength(0);
  });
});
