import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

const SOZINS_COMET_ORACLE =
  'Each creature you control gains firebending 5 until end of turn. (Whenever it attacks, add {R}{R}{R}{R}{R}. This mana lasts until end of combat.)\nForetell {2}{R} (During your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn for its foretell cost.)';

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
  playerId: string,
  gameId: string,
  emitted: Array<{ room?: string; event: string; payload: any }>,
) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe("Foretell Sozin's Comet", () => {
  const gameId = 'test_foretell_sozins_comet';
  const playerId = 'p1';
  const opponentId = 'p2';

  async function resetGame() {
    GameManager.deleteGame(gameId);
    games.delete(gameId as any);
    try {
      await deleteGame(gameId);
    } catch {
      // test-only cleanup
    }
  }

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame();
  });

  afterEach(async () => {
    await resetGame();
  });

  function seedGame(opts?: { mana?: number; turnPlayer?: string; priority?: string; step?: string }) {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(gameId as any, game as any);

    const sozin = {
      id: 'sozin_1',
      name: "Sozin's Comet",
      type_line: 'Sorcery',
      mana_cost: '{3}{R}{R}',
      oracle_text: SOZINS_COMET_ORACLE,
      keywords: ['Foretell'],
    };

    Object.assign(game.state as any, {
      players: [
        { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false },
        { id: opponentId, name: 'P2', spectator: false, life: 40, isAI: false },
      ],
      startingLife: 40,
      life: { [playerId]: 40, [opponentId]: 40 },
      phase: 'beginning',
      step: opts?.step ?? 'DRAW',
      turnPlayer: opts?.turnPlayer ?? playerId,
      activePlayer: opts?.turnPlayer ?? playerId,
      turnNumber: 1,
      priority: opts?.priority ?? playerId,
      stack: [],
      battlefield: [],
      manaPool: {
        [playerId]: {
          white: 0,
          blue: 0,
          black: 0,
          red: opts?.mana ?? 2,
          green: 0,
          colorless: 0,
        },
      },
      zones: {
        [playerId]: {
          hand: [sozin],
          handCount: 1,
          library: [],
          libraryCount: 0,
          graveyard: [],
          graveyardCount: 0,
          exile: [],
          exileCount: 0,
        },
        [opponentId]: {
          hand: [],
          handCount: 0,
          library: [],
          libraryCount: 0,
          graveyard: [],
          graveyardCount: 0,
          exile: [],
          exileCount: 0,
        },
      },
    });

    return game;
  }

  it('exiles Sozin\'s Comet face-down from hand during DRAW after paying {2}', async () => {
    const game = seedGame({ mana: 2, step: 'DRAW' });
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    registerGameActions(createMockIo(emitted), socket as any);

    await handlers['foretellCard']({ gameId, cardId: 'sozin_1' });

    const err = emitted.find((entry) => entry.event === 'error');
    expect(err).toBeUndefined();

    const zones = (game.state as any).zones[playerId];
    expect(zones.hand.map((card: any) => card.id)).toEqual([]);
    expect(zones.handCount).toBe(0);
    expect(zones.exile).toHaveLength(1);
    expect(zones.exile[0]).toMatchObject({
      id: 'sozin_1',
      name: "Sozin's Comet",
      foretold: true,
      faceDown: true,
      foretellCost: '{2}{R}',
      foretoldBy: playerId,
      zone: 'exile',
    });
    expect((game.state as any).manaPool[playerId].red).toBe(0);
  });

  it('accepts the legacy client event name "foretell"', async () => {
    const game = seedGame({ mana: 2 });
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    registerGameActions(createMockIo(emitted), socket as any);

    await handlers['foretell']({ gameId, cardId: 'sozin_1' });

    expect(emitted.find((entry) => entry.event === 'error')).toBeUndefined();
    expect((game.state as any).zones[playerId].exile[0]?.foretold).toBe(true);
  });

  it('rejects Foretell when the player cannot pay {2}', async () => {
    const game = seedGame({ mana: 1 });
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    registerGameActions(createMockIo(emitted), socket as any);

    await handlers['foretellCard']({ gameId, cardId: 'sozin_1' });

    const err = emitted.find((entry) => entry.event === 'error');
    expect(err?.payload?.code).toBe('CANNOT_PAY_FORETELL');
    expect((game.state as any).zones[playerId].hand).toHaveLength(1);
    expect((game.state as any).zones[playerId].exile).toHaveLength(0);
  });

  it('rejects Foretell on an opponent\'s turn', async () => {
    const game = seedGame({ turnPlayer: opponentId, priority: opponentId });
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    registerGameActions(createMockIo(emitted), socket as any);

    await handlers['foretellCard']({ gameId, cardId: 'sozin_1' });

    const err = emitted.find((entry) => entry.event === 'error');
    expect(err?.payload?.code).toBe('NOT_YOUR_TURN');
    expect((game.state as any).zones[playerId].hand).toHaveLength(1);
  });
});
