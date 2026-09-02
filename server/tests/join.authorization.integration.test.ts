import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerJoinHandlers } from '../src/socket/join.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(socketId: string, data: any, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    id: socketId,
    data: { spectator: false, ...data },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
    join: (room: string) => {
      socket.rooms.add(room);
    },
  } as any;
  return { socket, handlers };
}

async function resetGame(gameId: string) {
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('joinGame authorization boundary (integration)', () => {
  beforeAll(async () => {
    await initDb();
  });

  it('does not throw when payload is missing and emits MISSING_GAME_ID', async () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('sock_join_auth', {}, emitted);
    const io = createMockIo(emitted);

    registerJoinHandlers(io as any, socket as any);

    await expect(Promise.resolve().then(() => handlers['joinGame'](undefined as any))).resolves.toBeUndefined();

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('MISSING_GAME_ID');
  });
});

describe('joinGame pre-game spectator <-> player convert', () => {
  const gameId = 'test_join_pregame_seat_convert';
  const spectatorId = 'p_spec_convert';
  const aiId = 'p_ai_player';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  function seedPregameWithSpectator() {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game.state as any).phase = 'PRE_GAME';
    (game.state as any).players = [
      {
        id: aiId,
        name: 'Player',
        spectator: false,
        isSpectator: false,
        isAI: true,
        seat: 0,
        seatToken: 'seat_ai',
      },
      {
        id: spectatorId,
        name: 'Player',
        spectator: true,
        isSpectator: true,
        seatToken: 'seat_spec',
        socketId: 'sock_spec',
      },
    ];
    (game as any).participantsList.length = 0;
    (game as any).participantsList.push({
      socketId: 'sock_spec',
      playerId: spectatorId,
      spectator: true,
    });
    (game as any).joinedBySocket.clear();
    (game as any).joinedBySocket.set('sock_spec', {
      socketId: 'sock_spec',
      playerId: spectatorId,
      spectator: true,
    });
    return game;
  }

  it('converts the same spectator row to a seated player during PRE_GAME', async () => {
    const game = seedPregameWithSpectator();
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket('sock_spec', {
      gameId,
      playerId: spectatorId,
      spectator: true,
      isSpectator: true,
    }, emitted);

    registerJoinHandlers(io as any, socket as any);
    await handlers['joinGame']({
      gameId,
      playerName: 'Player',
      spectator: false,
      seatToken: 'seat_spec',
    });

    const spec = (game.state as any).players.find((p: any) => p.id === spectatorId);
    const ai = (game.state as any).players.find((p: any) => p.id === aiId);
    expect(spec.spectator).toBe(false);
    expect(spec.isSpectator).toBe(false);
    expect(spec.seatToken).toBe('seat_spec');
    expect(ai.isAI).toBe(true);
    expect(ai.spectator).toBe(false);
    expect((game.state as any).players.filter((p: any) => p.id === spectatorId)).toHaveLength(1);
    expect(socket.data.spectator).toBe(false);
    expect(socket.data.playerId).toBe(spectatorId);
  });

  it('converts a seated player to spectator during PRE_GAME', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game.state as any).phase = 'PRE_GAME';
    (game.state as any).players = [
      {
        id: spectatorId,
        name: 'Tester',
        spectator: false,
        isSpectator: false,
        seat: 0,
        seatToken: 'seat_player',
        socketId: 'sock_player',
      },
    ];
    (game as any).participantsList.length = 0;
    (game as any).participantsList.push({
      socketId: 'sock_player',
      playerId: spectatorId,
      spectator: false,
    });
    (game as any).joinedBySocket.clear();
    (game as any).joinedBySocket.set('sock_player', {
      socketId: 'sock_player',
      playerId: spectatorId,
      spectator: false,
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket('sock_player', {
      gameId,
      playerId: spectatorId,
      spectator: false,
    }, emitted);

    registerJoinHandlers(io as any, socket as any);
    await handlers['joinGame']({
      gameId,
      playerName: 'Tester',
      spectator: true,
      seatToken: 'seat_player',
    });

    const row = (game.state as any).players.find((p: any) => p.id === spectatorId);
    expect(row.spectator).toBe(true);
    expect(row.isSpectator).toBe(true);
    expect(row.id).toBe(spectatorId);
    expect(socket.data.spectator).toBe(true);
  });

  it('does not convert seats after the game has started', async () => {
    const game = seedPregameWithSpectator();
    (game.state as any).phase = 'precombatMain';

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket('sock_spec', {
      gameId,
      playerId: spectatorId,
      spectator: true,
      isSpectator: true,
    }, emitted);

    registerJoinHandlers(io as any, socket as any);
    await handlers['joinGame']({
      gameId,
      playerName: 'Player',
      spectator: false,
      seatToken: 'seat_spec',
    });

    const spec = (game.state as any).players.find((p: any) => p.id === spectatorId);
    expect(spec.spectator).toBe(true);
    expect(spec.isSpectator).toBe(true);
  });
});
