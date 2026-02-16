import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { games } from '../src/socket/socket.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(),
    },
  } as any;
}

function createMockSocket(
  data: { playerId: string; spectator?: boolean; gameId?: string },
  emitted: Array<{ room?: string; event: string; payload: any }>
) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { spectator: false, ...data },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('game-actions in-room authorization (integration)', () => {
  const gameId = 'test_game_actions_inroom_auth';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    games.delete(gameId as any);
  });

  it('blocks concede when socket is not in the game room', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [p1]: 40 };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, gameId }, emitted);
    // Intentionally do NOT join the room.

    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);

    await handlers['concede']({ gameId });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_IN_GAME');

    const player = (game.state as any).players[0];
    expect(player?.conceded).toBeUndefined();
  });

  it('blocks phaseOutPermanents when socket is not in the game room', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [
      {
        id: 'perm_1',
        controller: p1,
        phasedOut: false,
        card: { name: 'Test Permanent', type_line: 'Artifact' },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, gameId }, emitted);
    // Intentionally do NOT join the room.

    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);

    await handlers['phaseOutPermanents']({ gameId, permanentIds: ['perm_1'] });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_IN_GAME');

    const perm = (game.state as any).battlefield[0];
    expect(perm?.phasedOut).toBe(false);
  });

  it('does not throw when payload is missing (crash-safety)', async () => {
    const p1 = 'p1';
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, gameId }, emitted);
    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);

    await expect(handlers['resolveAllTriggers'](undefined as any)).resolves.toBeUndefined();
    await expect(handlers['claimMyTurn'](undefined as any)).resolves.toBeUndefined();
    await expect(handlers['randomizeStartingPlayer'](undefined as any)).resolves.toBeUndefined();
    await expect(handlers['shuffleHand'](undefined as any)).resolves.toBeUndefined();
    await expect(handlers['restartGame'](undefined as any)).resolves.toBeUndefined();
    await expect(handlers['restartGameClear'](undefined as any)).resolves.toBeUndefined();
    await expect(handlers['keepHand'](undefined as any)).resolves.toBeUndefined();
    await expect(handlers['mulligan'](undefined as any)).resolves.toBeUndefined();
    await expect(handlers['concede'](undefined as any)).resolves.toBeUndefined();
  });
});
