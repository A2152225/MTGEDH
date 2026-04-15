import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
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

function createMockSocket(data: any, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { spectator: false, ...data },
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

describe('top-library cast timing (integration)', () => {
  const gameId = 'test_top_library_cast_timing';
  const playerId = 'p1';
  const opponentId = 'p2';

  async function resetGame(gameId: string) {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    try {
      await deleteGame(gameId);
    } catch {
      // ignore cleanup failures for non-existent test DB rows
    }
  }

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  function setupGame() {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const topCard = {
      id: 'mind_stone_top',
      name: 'Mind Stone',
      mana_cost: '{2}',
      manaCost: '{2}',
      type_line: 'Artifact',
      oracle_text: '{T}: Add {C}.',
      colors: [],
      image_uris: { small: 'https://example.com/mind-stone.jpg' },
    };

    (game.state as any).players = [
      {
        id: playerId,
        name: 'P1',
        spectator: false,
        life: 40,
        hand: [],
        library: [topCard],
        graveyard: [],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
      },
      {
        id: opponentId,
        name: 'P2',
        spectator: false,
        life: 40,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'combat';
    (game.state as any).step = 'DECLARE_ATTACKERS';
    (game.state as any).turnPlayer = opponentId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [
      {
        id: 'elsha',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          name: 'Elsha of the Infinite',
          type_line: 'Legendary Creature — Djinn Monk',
          oracle_text: 'You may look at the top card of your library any time. You may cast noncreature spells from the top of your library as though they had flash.',
          image_uris: { small: 'https://example.com/elsha.jpg' },
        },
      },
    ];
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 1,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
    };

    (game as any).libraries = new Map<string, any[]>();
    (game as any).libraries.set(playerId, [topCard]);
    (game as any).libraries.set(opponentId, []);

    return game;
  }

  it('allows Elsha to request-cast a noncreature top card outside the main phase', async () => {
    setupGame();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'mind_stone_top', fromZone: 'library' });

    const errors = emitted.filter(entry => entry.event === 'error').map(entry => entry.payload?.code);
    expect(errors).not.toContain('SORCERY_TIMING');
    expect(errors).not.toContain('NO_PERMISSION');

    const queue = ResolutionQueueManager.getQueue(gameId);
    const paymentStep = queue.steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.spellPaymentRequired === true
    ) as any;

    expect(paymentStep).toBeDefined();
    expect(paymentStep.cardName).toBe('Mind Stone');
  });
});