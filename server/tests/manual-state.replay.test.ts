import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ensureGame } from '../src/socket/util.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerManaHandlers } from '../src/socket/mana-handlers.js';
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

function createMockSocket(data: any, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data,
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

describe('manual state replay persistence', () => {
  const gameId = 'test_manual_state_replay';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    games.delete(gameId as any);
    games.delete(`${gameId}_control` as any);
  });

  it('persists and replays addManaToPool and removeManaFromPool including restricted mana', async () => {
    const p1 = 'p1';
    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);
    socket.rooms.add(gameId);

    registerManaHandlers(createMockIo(emitted) as any, socket as any);

    await handlers['addManaToPool']({ gameId, color: 'green', amount: 2 });
    await handlers['addManaToPool']({
      gameId,
      color: 'red',
      amount: 1,
      restriction: 'creature_spells_only',
      restrictedTo: 'creature',
      sourceId: 'cavern_1',
      sourceName: 'Cavern of Souls',
    });
    await handlers['removeManaFromPool']({ gameId, color: 'green', amount: 1 });
    await handlers['removeManaFromPool']({ gameId, color: 'red', amount: 1, restrictedIndex: 0 });

    const persistedEvents = getEvents(gameId).filter((event: any) =>
      ['addManaToPool', 'removeManaFromPool'].includes(String(event?.type || ''))
    );
    expect(persistedEvents.map((event: any) => event.type)).toEqual([
      'addManaToPool',
      'addManaToPool',
      'removeManaFromPool',
      'removeManaFromPool',
    ]);

    const restrictedRemoval = persistedEvents.find((event: any) =>
      event.type === 'removeManaFromPool' && event.payload?.removedRestrictedMana
    ) as any;
    expect(restrictedRemoval?.payload?.removedRestrictedMana).toMatchObject({
      type: 'red',
      amount: 1,
      restriction: 'creature_spells_only',
      restrictedTo: 'creature',
      sourceId: 'cavern_1',
    });

    const replayGame = createInitialGameState(`${gameId}_rehydrated`);
    (replayGame.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];

    for (const event of persistedEvents) {
      replayGame.applyEvent({ type: event.type, ...(event.payload || {}) } as any);
    }

    expect((replayGame.state as any).manaPool?.[p1]).toMatchObject({
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 1,
      colorless: 0,
    });
    expect((replayGame.state as any).manaPool?.[p1]?.restricted).toBeUndefined();
  });

  it('persists and replays setManaPoolDoesNotEmpty and removeManaPoolDoesNotEmpty', async () => {
    const p1 = 'p1';
    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);
    socket.rooms.add(gameId);

    registerManaHandlers(createMockIo(emitted) as any, socket as any);

    await handlers['setManaPoolDoesNotEmpty']({
      gameId,
      sourceId: 'horizon_1',
      sourceName: 'Horizon Stone',
      convertsTo: 'colorless',
    });
    await handlers['removeManaPoolDoesNotEmpty']({ gameId, sourceId: 'horizon_1' });

    const persistedEvents = getEvents(gameId).filter((event: any) =>
      ['setManaPoolDoesNotEmpty', 'removeManaPoolDoesNotEmpty'].includes(String(event?.type || ''))
    );
    expect(persistedEvents.map((event: any) => event.type)).toEqual([
      'setManaPoolDoesNotEmpty',
      'removeManaPoolDoesNotEmpty',
    ]);

    const replayGame = createInitialGameState(`${gameId}_retention_rehydrated`);
    (replayGame.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];

    replayGame.applyEvent({ type: persistedEvents[0]?.type, ...(persistedEvents[0]?.payload || {}) } as any);
    expect((replayGame.state as any).manaPool?.[p1]).toMatchObject({
      doesNotEmpty: true,
      convertsTo: 'colorless',
      noEmptySourceIds: ['horizon_1'],
    });

    replayGame.applyEvent({ type: persistedEvents[1]?.type, ...(persistedEvents[1]?.payload || {}) } as any);
    expect((replayGame.state as any).manaPool?.[p1]?.doesNotEmpty).toBeUndefined();
    expect((replayGame.state as any).manaPool?.[p1]?.convertsTo).toBeUndefined();
    expect((replayGame.state as any).manaPool?.[p1]?.noEmptySourceIds).toBeUndefined();
  });

  it('persists and replays changePermanentControl', async () => {
    const controlGameId = `${gameId}_control`;
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(controlGameId, 'commander', 40, undefined, p1);
    const game = ensureGame(controlGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).battlefield = [
      {
        id: 'perm_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: { id: 'perm_1_card', name: 'Humble Defector', type_line: 'Creature — Human Rogue' },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId: controlGameId }, emitted);
    socket.rooms.add(controlGameId);

    registerGameActions(createMockIo(emitted) as any, socket as any);

    await handlers['changePermanentControl']({
      gameId: controlGameId,
      permanentId: 'perm_1',
      newController: p2,
      duration: 'eot',
    });

    const persisted = [...getEvents(controlGameId)].reverse().find((event: any) => event?.type === 'changePermanentControl') as any;
    expect(persisted).toBeDefined();
    expect(persisted.payload).toMatchObject({
      permanentId: 'perm_1',
      oldController: p1,
      newController: p2,
      duration: 'eot',
    });

    const replayGame = createInitialGameState(`${controlGameId}_rehydrated`);
    (replayGame.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (replayGame.state as any).battlefield = [
      {
        id: 'perm_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: { id: 'perm_1_card', name: 'Humble Defector', type_line: 'Creature — Human Rogue' },
      },
    ];

    replayGame.applyEvent({ type: 'changePermanentControl', ...(persisted.payload || {}) } as any);

    const replayPermanent = ((replayGame.state as any).battlefield || []).find((entry: any) => entry.id === 'perm_1');
    expect(replayPermanent?.controller).toBe(p2);
    expect((replayGame.state as any).controlChangeEffects).toEqual([
      {
        permanentId: 'perm_1',
        originalController: p1,
        newController: p2,
        duration: 'eot',
        appliedAt: Number(persisted.payload?.appliedAt || 0),
      },
    ]);
  });
});