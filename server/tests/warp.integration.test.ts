import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { cardAllowsPlayerToPlayFromExile } from '../src/state/modules/playable-from-exile.js';
import '../src/state/modules/priority.js';

const EXALTED_SUNBORN_ORACLE =
  'Flying, lifelink\nIf one or more tokens would be created under your control, twice that many of those tokens are created instead.\nWarp {1}{W} (You may cast this card from your hand for its warp cost. Exile this creature at the beginning of the next end step, then you may cast it from exile on a later turn.)';

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

describe('warp integration', () => {
  const gameId = 'test_warp_integration';
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

  it('schedules delayed exile after a warp cast resolves and allows recast from exile next turn', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).turnNumber = 3;
    (game.state as any).stack = [];
    (game.state as any).pendingExileAtNextEndStep = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
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
            id: 'exalted_sunborn_1',
            name: 'Exalted Sunborn',
            mana_cost: '{3}{W}{W}',
            type_line: 'Creature — Angel',
            oracle_text: EXALTED_SUNBORN_ORACLE,
            colors: ['W'],
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

    await handlers['requestCastSpell']({ gameId, cardId: 'exalted_sunborn_1' });

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (entry: any) => entry.type === 'mana_payment_choice' && entry.spellPaymentRequired === true,
    ) as any;
    expect(paymentStep).toBeDefined();
    expect(paymentStep.extraAlternateCosts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'warp', manaCost: '{1}{W}' }),
    ]));

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: {
        alternateCostId: 'warp',
        payment: [{ permanentId: 'plains_1', mana: 'W', count: 1 }],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(((game.state as any).stack || []).some((entry: any) => String(entry?.card?.name || '') === 'Exalted Sunborn')).toBe(true);
    expect(((game.state as any).zones?.[playerId]?.hand || []).length).toBe(0);

    game.resolveTopOfStack();

    const battlefield = (game.state as any).battlefield || [];
    const warpedPermanent = battlefield.find((perm: any) => String(perm?.card?.name || '') === 'Exalted Sunborn');
    expect(warpedPermanent).toBeDefined();
    const warpedPermanentId = String(warpedPermanent?.id || '');
    expect(warpedPermanentId).toBeTruthy();
    expect(Boolean(warpedPermanent?.warpCostWasPaid)).toBe(true);
    expect(((game.state as any).pendingExileAtNextEndStep || []) as any[]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        permanentId: warpedPermanentId,
        fireAtTurnNumber: 3,
        sourceName: 'Exalted Sunborn',
        createdBy: playerId,
      }),
    ]));

    (game.state as any).phase = 'postcombatMain';
    (game.state as any).step = 'MAIN2';
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];

    game.nextStep();

    expect((game.state as any).step).toBe('END');
    const endStepStack = ((game.state as any).stack || []) as any[];
    expect(endStepStack).toHaveLength(1);
    const delayedExileTrigger = endStepStack.find((item: any) =>
      item?.delayedAction === 'exile'
      && Array.isArray(item?.delayedPermanentIds)
      && item.delayedPermanentIds.includes(warpedPermanentId),
    );
    expect(delayedExileTrigger).toMatchObject({
      sourceName: 'Exalted Sunborn',
      delayedAction: 'exile',
      delayedPermanentIds: [warpedPermanentId],
    });

    game.resolveTopOfStack();

    expect((((game.state as any).battlefield || []) as any[]).some((perm: any) => String(perm?.id || '') === warpedPermanentId)).toBe(false);
    const exiledCard = (((game.state as any).zones?.[playerId]?.exile || []) as any[]).find(
      (card: any) => String(card?.id || '') === 'exalted_sunborn_1',
    );
    expect(exiledCard).toMatchObject({
      id: 'exalted_sunborn_1',
      isWarped: true,
      exiledBecauseWarped: true,
      warpedExiledOnTurn: 3,
    });
    expect(cardAllowsPlayerToPlayFromExile(exiledCard, playerId as any, 3, game.state)).toBe(false);
    expect(cardAllowsPlayerToPlayFromExile(exiledCard, playerId as any, 4, game.state)).toBe(true);
  });
});
