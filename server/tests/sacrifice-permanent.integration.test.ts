import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
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

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  return { socket, handlers };
}

describe('sacrificePermanent live tracking (integration)', () => {
  const clueGameId = 'test_sacrifice_permanent_clue_integration';
  const foodGameId = 'test_sacrifice_permanent_food_integration';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    games.delete(clueGameId as any);
    games.delete(foodGameId as any);
  });

  it('tracks sacrificed Clues in live play and token Clues cease to exist', async () => {
    createGameIfNotExists(clueGameId, 'commander', 40);
    const game = ensureGame(clueGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'clue_1',
        controller: p1,
        owner: p1,
        isToken: true,
        tapped: false,
        card: {
          id: 'clue_token',
          name: 'Clue',
          type_line: 'Artifact Token - Clue',
          oracle_text: '{2}, Sacrifice this artifact: Draw a card.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(clueGameId);
    const io = createMockIo(emitted);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['sacrificePermanent']({ gameId: clueGameId, permanentId: 'clue_1' });

    expect((game.state as any).battlefield).toHaveLength(0);
    expect((game.state as any).zones[p1].graveyard).toHaveLength(0);
    expect((game.state as any).permanentLeftBattlefieldThisTurn?.[p1]).toBe(true);
    expect((game.state as any).sacrificedCluesThisTurn?.[p1]).toBe(1);
    expect((game.state as any).cluesSacrificedThisTurn?.[p1]).toBe(1);
    expect((game.state as any).cluesSacrificedThisTurnCount?.[p1]).toBe(1);
    expect((game.state as any).permanentsSacrificedThisTurn?.[p1]).toBe(1);

    const persisted = [...getEvents(clueGameId)].reverse().find((event: any) => event?.type === 'sacrificePermanent') as any;
    expect(persisted?.payload?.playerId).toBe(p1);
    expect(persisted?.payload?.permanentId).toBe('clue_1');
  });

  it('tracks sacrificed Foods in live play and non-token Foods go to the graveyard', async () => {
    createGameIfNotExists(foodGameId, 'commander', 40);
    const game = ensureGame(foodGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'food_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'food_card',
          name: 'Food',
          type_line: 'Artifact - Food',
          oracle_text: '{2}, {T}, Sacrifice this artifact: You gain 3 life.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(foodGameId);
    const io = createMockIo(emitted);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['sacrificePermanent']({ gameId: foodGameId, permanentId: 'food_1' });

    expect((game.state as any).battlefield).toHaveLength(0);
    expect((game.state as any).zones[p1].graveyard).toHaveLength(1);
    expect((game.state as any).zones[p1].graveyard[0]?.name).toBe('Food');
    expect((game.state as any).permanentLeftBattlefieldThisTurn?.[p1]).toBe(true);
    expect((game.state as any).permanentsSacrificedThisTurn?.[p1]).toBe(1);
    expect((game.state as any).foodsSacrificedThisTurn?.[p1]).toBe(1);
  });
});