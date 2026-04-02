import { describe, expect, it } from 'vitest';

import { createContext } from '../src/state/context.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { tryResolvePlaneswalkerLoyaltyTemplate } from '../src/state/planeswalker/templates/resolve.js';
import { transformDbEventsForReplay } from '../src/socket/util.js';

function applyStunUntapBaseline(game: any) {
  Object.assign(game.state as any, {
    turnPlayer: 'p1',
    priority: null,
    turnNumber: 1,
    turn: 1,
    phase: 'beginning',
    step: 'UNTAP',
    players: [
      { id: 'p1', name: 'P1', seat: 0, spectator: false },
      { id: 'p2', name: 'P2', seat: 1, spectator: false },
    ],
    stack: [],
    battlefield: [
      {
        id: 'stunned_creature',
        controller: 'p1',
        owner: 'p1',
        tapped: true,
        counters: { stun: 2 },
        card: {
          id: 'stunned_creature_card',
          name: 'Test Creature',
          type_line: 'Creature — Test',
          oracle_text: '',
        },
      },
    ],
    priorityPassedBy: new Set<string>(),
  });
}

function buildStunUntapGame(gameId: string) {
  const game = createInitialGameState(gameId);
  game.applyEvent({ type: 'join', playerId: 'p1', name: 'P1' } as any);
  game.applyEvent({ type: 'join', playerId: 'p2', name: 'P2' } as any);
  applyStunUntapBaseline(game);

  return game;
}

function getPermanent(game: any, permanentId: string) {
  return (game.state.battlefield || []).find((entry: any) => entry.id === permanentId) as any;
}

describe('stun counter support', () => {
  it('removes one stun counter instead of untapping during the untap step', () => {
    const game = buildStunUntapGame('stun_untap_live');

    game.applyEvent({ type: 'nextStep' } as any);

    const permanent = getPermanent(game, 'stunned_creature');
    expect(String((game.state as any).step || '').toUpperCase()).toBe('UPKEEP');
    expect(Boolean(permanent?.tapped)).toBe(true);
    expect(Number(permanent?.counters?.stun || 0)).toBe(1);
  });

  it('replay applies the same stun-counter untap replacement during nextStep', () => {
    const liveGame = buildStunUntapGame('stun_untap_live_compare');
    liveGame.applyEvent({ type: 'nextStep' } as any);

    const replayGame = buildStunUntapGame('stun_untap_replay_compare');
    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }
    replayGame.replay([{ type: 'nextStep' }] as any);

    const livePermanent = getPermanent(liveGame, 'stunned_creature');
    const replayPermanent = getPermanent(replayGame, 'stunned_creature');

    expect(String((replayGame.state as any).step || '').toUpperCase()).toBe('UPKEEP');
    expect(Boolean(replayPermanent?.tapped)).toBe(Boolean(livePermanent?.tapped));
    expect(Number(replayPermanent?.counters?.stun || 0)).toBe(Number(livePermanent?.counters?.stun || 0));
  });

  it('restores the same stun-counter untap result from persisted restart replay events', () => {
    const liveGame = buildStunUntapGame('stun_restart_live');
    liveGame.applyEvent({ type: 'nextStep' } as any);

    const replayEvents = transformDbEventsForReplay([
      { type: 'nextStep', payload: {} },
    ] as any);

    const replayGame = buildStunUntapGame('stun_restart_replay');
    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }
    replayGame.replay(replayEvents as any);

    const livePermanent = getPermanent(liveGame, 'stunned_creature');
    const replayPermanent = getPermanent(replayGame, 'stunned_creature');

    expect(String((replayGame.state as any).step || '').toUpperCase()).toBe('UPKEEP');
    expect(Boolean(replayPermanent?.tapped)).toBe(Boolean(livePermanent?.tapped));
    expect(Number(replayPermanent?.counters?.stun || 0)).toBe(Number(livePermanent?.counters?.stun || 0));
  });

  it('reset plus replay without the nextStep event restores the pre-advance stun state', () => {
    const game = buildStunUntapGame('stun_undo_reset_replay');
    game.applyEvent({ type: 'nextStep' } as any);

    if (typeof game.reset !== 'function' || typeof game.replay !== 'function') {
      throw new Error('game reset/replay helpers are not available');
    }

    game.reset(true);
    applyStunUntapBaseline(game);
    game.replay([] as any);

    const permanent = getPermanent(game, 'stunned_creature');
    expect(String((game.state as any).step || '').toUpperCase()).toBe('UNTAP');
    expect(Boolean(permanent?.tapped)).toBe(true);
    expect(Number(permanent?.counters?.stun || 0)).toBe(2);
  });

  it('resolves the explicit stun-counter template by tapping the target and adding two stun counters', () => {
    const ctx = createContext('stun_template_resolution');
    Object.assign((ctx as any).state, {
      players: [{ id: 'p1', name: 'P1', spectator: false }],
      battlefield: [
        {
          id: 'target_creature',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          counters: {},
          card: {
            id: 'target_creature_card',
            name: 'Target Creature',
            type_line: 'Creature — Test',
            oracle_text: '',
          },
        },
      ],
    });

    const resolved = tryResolvePlaneswalkerLoyaltyTemplate(
      ctx as any,
      'p1' as any,
      'Test Source',
      'Tap target creature. Put two stun counters on it.',
      { targets: ['target_creature'] } as any,
    );

    const permanent = (((ctx as any).state?.battlefield) || []).find((entry: any) => entry.id === 'target_creature') as any;
    expect(resolved).toBe(true);
    expect(Boolean(permanent?.tapped)).toBe(true);
    expect(Number(permanent?.counters?.stun || 0)).toBe(2);
  });
});