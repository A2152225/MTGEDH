import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { games } from '../src/socket/socket.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(data: any, emitted: Array<{ room?: string; event: string; payload: any }>) {
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

describe('claimMyTurn in-room authorization (integration)', () => {
  const gameId = 'test_claim_my_turn_inroom';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    games.delete(gameId as any);
    try {
      deleteGame(gameId);
    } catch {
      // ignore
    }
  });

  it('rejects claimMyTurn when socket is not in the game room', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).phase = 'pre_game';
    delete (game.state as any).turnPlayer;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, gameId }, emitted);

    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);

    const before = (game.state as any).turnPlayer;
    await handlers['claimMyTurn']({ gameId });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_IN_GAME');
    expect((game.state as any).turnPlayer).toBe(before);
  });

  it('rejects claimMyTurn when socket.data.gameId mismatches (even if in room)', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).phase = 'pre_game';
    delete (game.state as any).turnPlayer;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, gameId: 'other_game' }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);

    const before = (game.state as any).turnPlayer;
    await handlers['claimMyTurn']({ gameId });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_IN_GAME');
    expect((game.state as any).turnPlayer).toBe(before);
  });
});
