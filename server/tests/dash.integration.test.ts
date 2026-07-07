import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

const AERIAL_RESPONDER_ORACLE = 'Flying, vigilance\nDash {1}{W} (You may cast this spell for its dash cost. If you do, it gains haste, and it\'s returned from the battlefield to its owner\'s hand at the beginning of the next end step.)';

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

describe('dash integration', () => {
  const gameId = 'test_dash_integration';
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

  it('schedules delayed return to hand after a dash cast resolves', async () => {
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
    (game.state as any).pendingReturnToHandAtNextEndStep = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 2, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'plains_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'plains_card_1',
          name: 'Plains',
          type_line: 'Basic Land — Plains',
          oracle_text: '{T}: Add {W}.',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'aerial_responder_1',
            name: 'Aerial Responder',
            mana_cost: '{1}{W}',
            type_line: 'Creature — Dwarf Soldier',
            oracle_text: AERIAL_RESPONDER_ORACLE,
            colors: ['W'],
            power: '2',
            toughness: '3',
          },
        ],
        handCount: 1,
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

    await handlers['requestCastSpell']({ gameId, cardId: 'aerial_responder_1' });

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (entry: any) => entry.type === 'mana_payment_choice' && entry.spellPaymentRequired === true,
    ) as any;
    expect(paymentStep).toBeDefined();
    expect(paymentStep.extraAlternateCosts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'dash', manaCost: '{1}{W}' }),
    ]));

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: {
        alternateCostId: 'dash',
        payment: [{ permanentId: 'plains_1', mana: 'W', count: 1 }],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    game.resolveTopOfStack();

    const dashedPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.name || '') === 'Aerial Responder',
    );
    expect(dashedPermanent).toBeDefined();
    expect(Boolean(dashedPermanent?.dashCostWasPaid)).toBe(true);
    expect(dashedPermanent?.summoningSickness).toBe(false);

    const dashedPermanentId = String(dashedPermanent?.id || '');
    expect(((game.state as any).pendingReturnToHandAtNextEndStep || []) as any[]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        permanentId: dashedPermanentId,
        fireAtTurnNumber: 2,
        sourceName: 'Aerial Responder',
        createdBy: playerId,
      }),
    ]));

    (game.state as any).phase = 'postcombatMain';
    (game.state as any).step = 'MAIN2';
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];

    game.nextStep();

    expect((game.state as any).step).toBe('END');
    const delayedReturnTrigger = ((game.state as any).stack || []).find((item: any) =>
      item?.delayedAction === 'return_hand'
      && Array.isArray(item?.delayedPermanentIds)
      && item.delayedPermanentIds.includes(dashedPermanentId),
    );
    expect(delayedReturnTrigger).toMatchObject({
      delayedAction: 'return_hand',
      delayedPermanentIds: [dashedPermanentId],
    });

    game.resolveTopOfStack();

    expect((((game.state as any).battlefield || []) as any[]).some((perm: any) => String(perm?.id || '') === dashedPermanentId)).toBe(false);
    expect((((game.state as any).zones?.[playerId]?.hand || []) as any[]).some((card: any) => String(card?.id || '') === 'aerial_responder_1')).toBe(true);
  });
});
