import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId: undefined },
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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try {
    await deleteGame(gameId);
  } catch {
    // Ignore cleanup failures for test-only game ids.
  }
}

describe('playLand graveyard permission windows (integration)', () => {
  const gameId = 'test_play_land_graveyard_permission_window';
  const playerId = 'p1';
  const opponentId = 'p2';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('allows subtype-limited graveyard land replay through the live playLand handler', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false },
      { id: opponentId, name: 'P2', spectator: false, life: 40, isAI: false },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'titania_1',
        controller: playerId,
        tapped: false,
        card: {
          id: 'titania_card_1',
          name: "Titania, Nature's Force",
          type_line: 'Legendary Creature — Elemental',
          oracle_text: 'You may play Forests from your graveyard.',
        },
      },
    ];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).landsPlayedThisTurn = { [playerId]: 0, [opponentId]: 0 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'forest_1',
            name: 'Forest',
            type_line: 'Basic Land — Forest',
            oracle_text: '{T}: Add {G}.',
            image_uris: { small: 'https://example.com/forest.jpg' },
          },
          {
            id: 'wasteland_1',
            name: 'Wasteland',
            type_line: 'Land',
            oracle_text: '{T}: Add {C}.',
            image_uris: { small: 'https://example.com/wasteland.jpg' },
          },
        ],
        graveyardCount: 2,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.data.gameId = gameId;
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerGameActions(io as any, socket as any);

    await handlers['playLand']({ gameId, cardId: 'forest_1', fromZone: 'graveyard' });

    const errorCodes = emitted
      .filter((entry) => entry.event === 'error')
      .map((entry) => entry.payload?.code);
    expect(errorCodes).not.toContain('NO_PERMISSION');

    const battlefield = (game.state as any).battlefield || [];
    const graveyard = (game.state as any).zones?.[playerId]?.graveyard || [];
    expect(battlefield.some((permanent: any) => permanent?.card?.name === 'Forest')).toBe(true);
    expect(graveyard.some((card: any) => card?.id === 'forest_1')).toBe(false);
    expect(graveyard.some((card: any) => card?.id === 'wasteland_1')).toBe(true);
  });

  it('allows graveyard lands marked playable by effect-program permissions through the live playLand handler', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false },
      { id: opponentId, name: 'P2', spectator: false, life: 40, isAI: false },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).turnNumber = 4;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [];
    (game.state as any).playableFromGraveyard = {
      [playerId]: { forest_1: 4 },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).landsPlayedThisTurn = { [playerId]: 0, [opponentId]: 0 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'forest_1',
            name: 'Forest',
            type_line: 'Basic Land — Forest',
            oracle_text: '{T}: Add {G}.',
            canBePlayedBy: playerId,
            playableUntilTurn: 4,
            image_uris: { small: 'https://example.com/forest.jpg' },
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.data.gameId = gameId;
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerGameActions(io as any, socket as any);

    await handlers['playLand']({ gameId, cardId: 'forest_1', fromZone: 'graveyard' });

    const errorCodes = emitted
      .filter((entry) => entry.event === 'error')
      .map((entry) => entry.payload?.code);
    expect(errorCodes).not.toContain('NO_PERMISSION');

    const battlefield = (game.state as any).battlefield || [];
    const graveyard = (game.state as any).zones?.[playerId]?.graveyard || [];
    expect(battlefield.some((permanent: any) => permanent?.card?.name === 'Forest')).toBe(true);
    expect(graveyard.some((card: any) => card?.id === 'forest_1')).toBe(false);
  });
});