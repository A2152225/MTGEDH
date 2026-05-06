import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try {
    await deleteGame(gameId);
  } catch {
    // Ignore cleanup failures for non-existent test rows.
  }
}

describe('requestCastSpell graveyard permission windows (integration)', () => {
  const gameId = 'test_request_cast_graveyard_permission_window';
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

  function setupGame() {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const consider = {
      id: 'consider_1',
      name: 'Consider',
      mana_cost: '{U}',
      manaCost: '{U}',
      type_line: 'Instant',
      oracle_text: 'Look at the top card of your library. You may put that card into your graveyard. Draw a card.',
      image_uris: { small: 'https://example.com/consider.jpg' },
    };
    const bear = {
      id: 'bear_1',
      name: 'Runeclaw Bear',
      mana_cost: '{1}{G}',
      manaCost: '{1}{G}',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
      image_uris: { small: 'https://example.com/bear.jpg' },
    };

    (game.state as any).players = [
      {
        id: playerId,
        name: 'P1',
        spectator: false,
        life: 40,
        hand: [],
        library: [],
        graveyard: [consider, bear],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 2, colorless: 0 },
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
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [
      {
        id: 'kess_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'kess_card',
          name: 'Kess, Dissident Mage',
          type_line: 'Legendary Creature — Human Wizard',
          oracle_text: 'During each of your turns, you may cast an instant or sorcery spell from your graveyard.',
        },
      },
    ];
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 1, black: 0, red: 0, green: 2, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [consider, bear],
        graveyardCount: 2,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    (game as any).libraries = new Map<string, any[]>();
    (game as any).libraries.set(playerId, []);
    (game as any).libraries.set(opponentId, []);

    return game;
  }

  it('allows a Kess-legal graveyard instant to enter the cast request flow', async () => {
    setupGame();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'consider_1', fromZone: 'graveyard' });

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(errors).not.toContain('NO_PERMISSION');

    const queue = ResolutionQueueManager.getQueue(gameId);
    const paymentStep = queue.steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.cardId === 'consider_1'
    ) as any;

    expect(paymentStep).toBeDefined();
    expect(paymentStep.cardName).toBe('Consider');
  });

  it('rejects graveyard spells outside the shared permission surface', async () => {
    setupGame();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'bear_1', fromZone: 'graveyard' });

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(errors).toContain('NO_PERMISSION');

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((step: any) => step.cardId === 'bear_1')).toBe(false);
  });

  it('allows graveyard spells marked playable by effect-program permissions', async () => {
    const game = setupGame();
    (game.state as any).battlefield = [];
    (game.state as any).turnNumber = 4;
    (game.state as any).playableFromGraveyard = {
      [playerId]: { consider_1: 4 },
    };

    const graveyardCard = (game.state as any).zones[playerId].graveyard.find((card: any) => card?.id === 'consider_1');
    Object.assign(graveyardCard, {
      canBePlayedBy: playerId,
      playableUntilTurn: 4,
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'consider_1', fromZone: 'graveyard' });

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(errors).not.toContain('NO_PERMISSION');

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((step: any) => step.cardId === 'consider_1')).toBe(true);
  });
});