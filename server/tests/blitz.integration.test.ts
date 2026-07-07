import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { destroyPermanent } from '../src/state/modules/counters_tokens.js';
import '../src/state/modules/priority.js';

const BLITZ_CREATURE_ORACLE =
  'Blitz {2}{R} (If you cast this spell for its blitz cost, it gains haste and "When this creature dies, draw a card." Sacrifice it at the beginning of the next end step.)\nHaste';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[]) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => {
        emitted.push({ room, event, payload });
      },
    }),
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
    sockets: { sockets: new Map(sockets.map((socket) => [socket.id || socket.data.playerId, socket])) },
  } as any;
}

function createMockSocket(
  playerId: string,
  emitted: Array<{ room?: string; event: string; payload: any }>,
  gameId: string,
) {
  const handlers: Record<string, Function> = {};
  const socket = {
    id: `${playerId}_socket`,
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

describe('blitz integration', () => {
  const gameId = 'test_blitz_integration';
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('schedules delayed sacrifice after a blitz cast resolves and draws on death', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).turnNumber = 2;
    (game.state as any).stack = [];
    (game.state as any).pendingSacrificeAtNextEndStep = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'mountain_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'mountain_card_1',
          name: 'Mountain',
          type_line: 'Basic Land — Mountain',
          oracle_text: '{T}: Add {R}.',
        },
      },
    ];
    (game as any).libraries = new Map([
      [playerId, [
        { id: 'lib_1', name: 'Island' },
        { id: 'lib_2', name: 'Forest' },
      ]],
    ]);
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'blitz_goblin_1',
            name: 'Blitz Goblin',
            mana_cost: '{3}{R}',
            type_line: 'Creature — Goblin',
            oracle_text: BLITZ_CREATURE_ORACLE,
            colors: ['R'],
            power: '3',
            toughness: '2',
          },
        ],
        handCount: 1,
        libraryCount: 2,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'blitz_goblin_1' });

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (entry: any) => entry.type === 'mana_payment_choice' && entry.spellPaymentRequired === true,
    ) as any;
    expect(paymentStep).toBeDefined();
    expect(paymentStep.extraAlternateCosts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'blitz', manaCost: '{2}{R}' }),
    ]));

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: {
        alternateCostId: 'blitz',
        payment: [{ permanentId: 'mountain_1', mana: 'R', count: 2 }],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    game.resolveTopOfStack();

    const blitzPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.name || '') === 'Blitz Goblin',
    );
    expect(blitzPermanent).toBeDefined();
    expect(Boolean(blitzPermanent?.blitzCostWasPaid)).toBe(true);
    expect(blitzPermanent?.summoningSickness).toBe(false);

    const blitzPermanentId = String(blitzPermanent?.id || '');
    expect(((game.state as any).pendingSacrificeAtNextEndStep || []) as any[]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        permanentId: blitzPermanentId,
        fireAtTurnNumber: 2,
        sourceName: 'Blitz Goblin',
        createdBy: playerId,
      }),
    ]));

    const handBeforeSacrifice = ((game.state as any).zones?.[playerId]?.hand || []).length;
    destroyPermanent({
      state: game.state,
      bumpSeq: () => game.bumpSeq?.(),
      gameId,
      libraries: (game as any).libraries,
    } as any, blitzPermanentId, true);
    const handAfterSacrifice = ((game.state as any).zones?.[playerId]?.hand || []).length;
    expect(handAfterSacrifice).toBe(handBeforeSacrifice + 1);

    (game.state as any).phase = 'postcombatMain';
    (game.state as any).step = 'MAIN2';
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];

    game.nextStep();

    expect((game.state as any).step).toBe('END');
    const delayedSacrificeTrigger = ((game.state as any).stack || []).find((item: any) =>
      item?.delayedAction === 'sacrifice'
      && Array.isArray(item?.delayedPermanentIds)
      && item.delayedPermanentIds.includes(blitzPermanentId),
    );
    expect(delayedSacrificeTrigger).toBeUndefined();
  });
});
