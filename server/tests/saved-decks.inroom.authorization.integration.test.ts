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

describe('saved decks in-room authorization (integration)', () => {
  const gameId = 'test_saved_decks_inroom_auth';

  beforeAll(async () => {
    await initDb();
  });

  it('blocks listSavedDecks when socket is not in the game room', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);

    registerDeckHandlers(io as any, socket as any);

    await handlers['listSavedDecks']({ gameId });

    const deckError = emitted.find(e => e.event === 'deckError');
    expect(deckError?.payload?.message).toBe('Not in game.');

    const list = emitted.find(e => e.event === 'savedDecksList');
    expect(list).toBeUndefined();
  });

  it('blocks getSavedDeck when socket is not in the game room', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);

    registerDeckHandlers(io as any, socket as any);

    await handlers['getSavedDeck']({ gameId, deckId: 'deck_1' });

    const deckError = emitted.find(e => e.event === 'deckError');
    expect(deckError?.payload?.message).toBe('Not in game.');

    const detail = emitted.find(e => e.event === 'savedDeckDetail');
    expect(detail).toBeUndefined();
  });
});
