import { describe, it, expect, beforeAll } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { registerDeckHandlers } from '../src/socket/deck.js';

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

describe('imported deck candidates authorization (integration)', () => {
  const gameId = 'test_imported_deck_candidates_auth';

  beforeAll(async () => {
    await initDb();
  });

  it('does not allow getImportedDeckCandidates when socket.data.gameId mismatches (even if in room)', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId: 'other_game' }, emitted);
    socket.rooms.add(gameId);

    registerDeckHandlers(io as any, socket as any);

    await handlers['getImportedDeckCandidates']({ gameId });

    const response = emitted.find(e => e.event === 'importedDeckCandidates');
    expect(response?.payload?.gameId).toBe(gameId);
    expect(response?.payload?.candidates).toEqual([]);
  });
});
