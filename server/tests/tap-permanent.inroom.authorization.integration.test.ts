import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
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

function createMockSocket(
  data: any,
  emitted: Array<{ room?: string; event: string; payload: any }>
) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data,
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

describe('tapPermanent in-room authorization (integration)', () => {
  const gameId = 'test_tapPermanent_inroom_auth';
  const otherGameId = 'test_tapPermanent_inroom_auth_other';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    games.delete(gameId as any);
    games.delete(otherGameId as any);
  });

  it('blocks tapPermanent when socket is not in the game room (no mutation)', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [
      {
        id: 'perm_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: { name: 'Test Permanent', type_line: 'Artifact', oracle_text: '' },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['tapPermanent']({ gameId, permanentId: 'perm_1' });

    const err = emitted.find((e) => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_IN_GAME');

    const permanent = (game.state as any).battlefield.find((p: any) => p.id === 'perm_1');
    expect(Boolean(permanent?.tapped)).toBe(false);
  });

  it('blocks tapPermanent when socket.data.gameId is set and mismatched (no mutation)', async () => {
    createGameIfNotExists(otherGameId, 'commander', 40);
    const game = ensureGame(otherGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [
      {
        id: 'perm_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: { name: 'Test Permanent', type_line: 'Artifact', oracle_text: '' },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(
      { playerId: p1, spectator: false, gameId: 'some_other_game' },
      emitted
    );
    socket.rooms.add(otherGameId);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['tapPermanent']({ gameId: otherGameId, permanentId: 'perm_1' });

    const err = emitted.find((e) => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_IN_GAME');

    const permanent = (game.state as any).battlefield.find((p: any) => p.id === 'perm_1');
    expect(Boolean(permanent?.tapped)).toBe(false);
  });

  it('does not throw when payload is missing (crash-safety)', async () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket({ playerId: 'p1', spectator: false, gameId: 'g' }, emitted);
    registerInteractionHandlers(io as any, socket as any);

    await expect(handlers['beginExplore'](undefined as any)).resolves.toBeUndefined();
    await expect(handlers['beginBatchExplore'](undefined as any)).resolves.toBeUndefined();
    await expect(handlers['requestLibrarySearch'](undefined as any)).resolves.toBeUndefined();
    await expect(handlers['activateGraveyardAbility'](undefined as any)).resolves.toBeUndefined();
    await expect(handlers['requestGraveyardView'](undefined as any)).resolves.toBeUndefined();
    await expect(handlers['tapPermanent'](undefined as any)).resolves.toBeUndefined();
    await expect(handlers['untapPermanent'](undefined as any)).resolves.toBeUndefined();
    await expect(handlers['sacrificePermanent'](undefined as any)).resolves.toBeUndefined();
    await expect(handlers['activateCycling'](undefined as any)).resolves.toBeUndefined();
  });
});
