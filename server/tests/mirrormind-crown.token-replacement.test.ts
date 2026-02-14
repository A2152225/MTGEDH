import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createMockIo(
  emitted: Array<{ room?: string; event: string; payload: any }>,
  sockets: any[] = []
) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((s, idx) => [`s_${idx}`, s])),
    },
  } as any;
}

function createMockSocket(
  playerId: string,
  emitted: Array<{ room?: string; event: string; payload: any }>,
  gameId?: string
) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

describe('Mirrormind Crown (token replacement)', () => {
  const gameId = 'test_mirrormind_crown_token_replacement';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('queues a choice on first token creation, then creates copy tokens when chosen', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [
      {
        id: 'creature_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'creature_1',
          name: 'Elvish Visionary',
          type_line: 'Creature — Elf Shaman',
          oracle_text: 'When Elvish Visionary enters the battlefield, draw a card.',
          mana_cost: '{1}{G}',
          power: '1',
          toughness: '1',
          zone: 'battlefield',
        },
      },
      {
        id: 'crown_1',
        controller: p1,
        owner: p1,
        attachedTo: 'creature_1',
        tapped: false,
        counters: {},
        card: {
          id: 'crown_1',
          name: 'Mirrormind Crown',
          type_line: 'Artifact — Equipment',
          oracle_text:
            'As long as this Equipment is attached to a creature, the first time you would create one or more tokens each turn, you may instead create that many tokens that are copies of equipped creature. Equip {2}',
          zone: 'battlefield',
        },
      },
    ];

    const { createToken } = await import('../src/state/modules/counters_tokens.js');
    const ctx: any = { state: game.state, bumpSeq: () => {}, gameId };

    const created = createToken(
      ctx,
      p1,
      'Soldier',
      2,
      1,
      1,
      { colors: ['W'], typeLine: 'Token Creature — Soldier' },
      false
    );

    // Token creation is deferred to the resolution step.
    expect(created).toEqual([]);
    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    expect(steps.length).toBe(1);
    expect((steps[0] as any).mirrormindCrownTokenReplacementChoice).toBe(true);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    expect(typeof handlers['submitResolutionResponse']).toBe('function');
    await handlers['submitResolutionResponse']({ gameId, stepId: steps[0].id, selections: ['replace'] });

    const battlefield = (game.state as any).battlefield as any[];
    const copyTokens = battlefield.filter((p: any) => p?.isToken === true && p?.card?.name === 'Elvish Visionary');
    expect(copyTokens.length).toBe(2);
    expect(copyTokens.every((t: any) => t.controller === p1)).toBe(true);

    // Not offered again this turn.
    const created2 = createToken(
      ctx,
      p1,
      'Soldier',
      1,
      1,
      1,
      { colors: ['W'], typeLine: 'Token Creature — Soldier' },
      false
    );
    expect(created2.length).toBe(1);
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, p1).length).toBe(0);
  });

  it('sets X to 0 in mana cost for copied tokens', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [
      {
        id: 'creature_x',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'creature_x',
          name: 'Hydra Test',
          type_line: 'Creature — Hydra',
          oracle_text: '',
          mana_cost: '{X}{G}',
          power: '1',
          toughness: '1',
          zone: 'battlefield',
        },
      },
      {
        id: 'crown_x',
        controller: p1,
        owner: p1,
        attachedTo: 'creature_x',
        tapped: false,
        counters: {},
        card: {
          id: 'crown_x',
          name: 'Mirrormind Crown',
          type_line: 'Artifact — Equipment',
          oracle_text:
            'As long as this Equipment is attached to a creature, the first time you would create one or more tokens each turn, you may instead create that many tokens that are copies of equipped creature. Equip {2}',
          zone: 'battlefield',
        },
      },
    ];

    const { createToken } = await import('../src/state/modules/counters_tokens.js');
    const ctx: any = { state: game.state, bumpSeq: () => {}, gameId };

    createToken(ctx, p1, 'Soldier', 1, 1, 1, { colors: ['W'], typeLine: 'Token Creature — Soldier' }, false);

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    expect(steps.length).toBe(1);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: steps[0].id, selections: ['replace'] });

    const battlefield = (game.state as any).battlefield as any[];
    const copyTokens = battlefield.filter((p: any) => p?.isToken === true && p?.card?.name === 'Hydra Test');
    expect(copyTokens.length).toBe(1);
    expect(String(copyTokens[0].card?.mana_cost || '')).toBe('{0}{G}');
  });
});
