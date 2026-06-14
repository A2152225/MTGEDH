import { describe, it, expect, beforeAll } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { saveDeck, getDeck, updateDeckContent } from '../src/db/decks.js';
import { registerDeckHandlers } from '../src/socket/deck.js';
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

function createMockSocket(
  data: any,
  emitted: Array<{ room?: string; event: string; payload: any }>,
  gameId?: string
) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data,
    rooms: new Set<string>(),
    handshake: { address: '127.0.0.1' },
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

describe('saved decks update (integration)', () => {
  const gameId = 'test_saved_decks_update';
  const deckId = 'deck_update_test_1';

  beforeAll(async () => {
    await initDb();
    createGameIfNotExists(gameId, 'commander', 40, undefined, 'p1');
    if (!getDeck(deckId)) {
      saveDeck({
        id: deckId,
        name: 'Original Deck',
        text: '1 Sol Ring\n1 Command Tower',
        created_by_id: 'p1',
        created_by_name: 'Player One',
        card_count: 2,
      });
    } else {
      updateDeckContent(deckId, {
        name: 'Original Deck',
        text: '1 Sol Ring\n1 Command Tower',
        card_count: 2,
        resolved_cards: null,
      });
    }
  });

  it('updates a saved deck when socket is in the game room', async () => {
    const p1 = 'p1';
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(
      { playerId: p1, spectator: false, gameId },
      emitted,
      gameId
    );

    registerDeckHandlers(io as any, socket as any);

    await handlers['updateSavedDeck']({
      gameId,
      deckId,
      name: 'Updated Deck',
      list: '1 Sol Ring\n1 Command Tower\n1 Arcane Signet',
      cacheCards: false,
    });

    const deckError = emitted.find((e) => e.event === 'deckError');
    expect(deckError).toBeUndefined();

    const updated = emitted.find((e) => e.event === 'deckUpdated');
    expect(updated?.payload?.deck?.name).toBe('Updated Deck');
    expect(updated?.payload?.deck?.card_count).toBe(3);

    const listBroadcast = emitted.find((e) => e.event === 'savedDecksList' && e.room === gameId);
    expect(listBroadcast?.payload?.decks?.some((d: any) => d.id === deckId && d.name === 'Updated Deck')).toBe(
      true
    );

    const stored = getDeck(deckId);
    expect(stored?.name).toBe('Updated Deck');
    expect(stored?.text).toContain('Arcane Signet');
  });

  it('blocks updateSavedDeck when socket is not in the game room', async () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(
      { playerId: 'p1', spectator: false, gameId },
      emitted
    );

    registerDeckHandlers(io as any, socket as any);

    await handlers['updateSavedDeck']({
      gameId,
      deckId,
      name: 'Should Fail',
      list: '1 Sol Ring',
    });

    const deckError = emitted.find((e) => e.event === 'deckError');
    expect(deckError?.payload?.message).toBe('Not in game.');
  });
});
