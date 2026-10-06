import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { getDeck } from '../src/db/decks.js';
import { registerJoinHandlers } from '../src/socket/join.js';
import { registerDeckHandlers } from '../src/socket/deck.js';
import { games } from '../src/socket/socket.js';
import { getSaveOwnerFromSocket } from '../src/socket/deck-handlers/deckImportConfirmState.js';

type Emitted = Array<{ room?: string; event: string; payload: any }>;

function createMockIo(emitted: Emitted) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(data: any, emitted: Emitted) {
  const handlers: Record<string, Function> = {};
  const socket = {
    id: 'sock_acct_private',
    data,
    handshake: { auth: {}, headers: {} },
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

describe('private deck save for a logged-in account after joining a game (integration)', () => {
  const gameId = 'test_private_deck_account_after_join';
  const accountId = 'acct_user_private_1';
  const list = '1 Sol Ring\n1 Command Tower\n1 Arcane Signet';

  beforeAll(async () => {
    await initDb();
  });

  afterEach(async () => {
    games.delete(gameId as any);
    await deleteGame(gameId);
  });

  async function joinAsAccount(extra: Record<string, unknown> = {}) {
    createGameIfNotExists(gameId, 'commander', 40);
    const emitted: Emitted = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(
      {
        accountUserId: accountId,
        accountUsername: 'robert',
        accountDisplayName: 'Robert',
        accountIsAdmin: false,
        ...extra,
      },
      emitted,
    );
    registerJoinHandlers(io, socket);
    registerDeckHandlers(io, socket);
    await handlers['joinGame']({ gameId, playerName: 'Robert', spectator: false });
    emitted.length = 0;
    return { io, socket, handlers, emitted };
  }

  it('keeps the account identity on the socket after joinGame', async () => {
    const { socket } = await joinAsAccount();
    expect(socket.data.accountUserId).toBe(accountId);
    expect(socket.data.accountDisplayName).toBe('Robert');
    expect(socket.data.accountUsername).toBe('robert');
    expect(socket.data.gameId).toBe(gameId);
    expect(socket.data.playerId).toBeTruthy();
  });

  it('saves an in-game deck as private and owned by the account, and lists it back to the saver', async () => {
    const { handlers, emitted } = await joinAsAccount();
    await handlers['saveDeck']({ gameId, name: 'Private Acct Deck', list, cacheCards: false, visibility: 'private' });

    expect(emitted.find((e) => e.event === 'deckError')).toBeUndefined();
    const saved = emitted.find((e) => e.event === 'deckSaved');
    expect(saved?.payload?.deckId).toBeTruthy();
    const stored = getDeck(saved!.payload.deckId);
    expect(stored?.created_by_id).toBe(accountId);
    expect(stored?.visibility).toBe('private');
    expect(stored?.created_by_name).toBe('Robert');

    const listed = emitted.find((e) => e.event === 'savedDecksList');
    expect(listed?.payload?.decks?.some((d: any) => d.id === saved!.payload.deckId)).toBe(true);
    // Not broadcast room-wide (list is per-account).
    expect(emitted.some((e) => e.event === 'savedDecksList' && e.room === gameId)).toBe(false);
  });

  it('refuses to silently downgrade a private save to public when the connection has no account', async () => {
    const { handlers, emitted } = await joinAsAccount({
      accountUserId: undefined,
      accountUsername: undefined,
      accountDisplayName: undefined,
    });
    await handlers['saveDeck']({ gameId, name: 'Anon Private Deck', list, cacheCards: false, visibility: 'private' });

    const err = emitted.find((e) => e.event === 'deckError');
    expect(err?.payload?.message).toMatch(/log(ged)? in/i);
    expect(emitted.find((e) => e.event === 'deckSaved')).toBeUndefined();
  });

  it('still allows a guest to save a public deck', async () => {
    const { handlers, emitted } = await joinAsAccount({ accountUserId: undefined, accountDisplayName: undefined });
    await handlers['saveDeck']({ gameId, name: 'Guest Public Deck', list, cacheCards: false, visibility: 'public' });
    expect(emitted.find((e) => e.event === 'deckError')).toBeUndefined();
    const saved = emitted.find((e) => e.event === 'deckSaved');
    expect(getDeck(saved!.payload.deckId)?.visibility).toBe('public');
  });

  it('import auto-save owner comes from the account, not the per-game player id', async () => {
    const { socket } = await joinAsAccount();
    expect(getSaveOwnerFromSocket(socket)).toEqual({ userId: accountId, displayName: 'Robert', isAdmin: false });
    expect(getSaveOwnerFromSocket({ data: { playerId: 'p1' } })).toBeNull();
  });});
