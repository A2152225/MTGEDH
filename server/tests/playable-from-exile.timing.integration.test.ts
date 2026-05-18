import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { ensureGame } from '../src/socket/util.js';
import { buildDurablePlayableFromExilePermission } from '../src/state/modules/durable-permissions.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import type { PlayerID } from '@mtgedh/shared';

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

describe('playable-from-exile timing (integration)', () => {
  const gameId = 'test_playable_from_exile_timing';
  const playerId = 'p1';
  const opponentId = 'p2';

  async function resetGame(targetGameId: string) {
    ResolutionQueueManager.removeQueue(targetGameId);
    games.delete(targetGameId as any);
    try {
      await deleteGame(targetGameId);
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

  afterEach(async () => {
    await resetGame(gameId);
  });

  function setupGame() {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const exiledCard = {
      id: 'divination_exile_1',
      name: 'Divination',
      mana_cost: '{2}{U}',
      manaCost: '{2}{U}',
      type_line: 'Sorcery',
      oracle_text: 'Draw two cards.',
      image_uris: { small: 'https://example.com/divination.jpg' },
      zone: 'exile',
    };

    (game.state as any).players = [
      {
        id: playerId,
        name: 'P1',
        spectator: false,
        life: 40,
        hand: [],
        library: [],
        graveyard: [],
        exile: [exiledCard],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 2 },
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
    (game.state as any).battlefield = [];
    (game.state as any).stack = [];
    (game.state as any).turnNumber = 1;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 2 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        exile: [exiledCard],
        exileCount: 1,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
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
    (game.state as any).durablePermissions = [
      buildDurablePlayableFromExilePermission({
        playerId: playerId as PlayerID,
        cardIds: ['divination_exile_1'],
        action: 'cast',
        duration: 'this_turn',
        turnApplied: 1,
        expiresAtTurn: 1,
        sourceName: 'Flash Impulse',
        grantsFlash: true,
      }),
    ];

    return game;
  }

  it('lets durable playable-from-exile flash permissions cast sorceries outside the main phase', async () => {
    setupGame();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'divination_exile_1', fromZone: 'exile' });

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(errors).not.toContain('SORCERY_TIMING');
    expect(errors).not.toContain('NO_PERMISSION');

    const queue = ResolutionQueueManager.getQueue(gameId);
    const paymentStep = queue.steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.spellPaymentRequired === true
    ) as any;

    expect(paymentStep).toEqual(expect.objectContaining({
      cardName: 'Divination',
      manaCost: '{2}{U}',
    }));
  });
});