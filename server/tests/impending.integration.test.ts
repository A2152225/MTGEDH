import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

const OVERLORD_ORACLE =
  'Impending 4-{2}{W}{W} (If you cast this spell for its impending cost, it enters with four time counters and is not a creature until the last is removed. At the beginning of your end step, remove a time counter from it.)\n' +
  'Whenever this permanent enters or attacks, create two 2/1 white Insect creature tokens with flying.';

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

describe('impending integration', () => {
  const gameId = 'test_impending_integration';
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

  it('offers impending alternate cost and enters with time counters / notCreature; end step removes one', async () => {
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
    (game.state as any).manaPool = {
      [playerId]: { white: 2, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
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
          type_line: 'Basic Land - Plains',
          oracle_text: '{T}: Add {W}.',
        },
      },
      {
        id: 'plains_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'plains_card_2',
          name: 'Plains',
          type_line: 'Basic Land - Plains',
          oracle_text: '{T}: Add {W}.',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'overlord_1',
            name: 'Overlord of the Mistmoors',
            mana_cost: '{5}{W}{W}',
            type_line: 'Enchantment Creature - Avatar Horror',
            oracle_text: OVERLORD_ORACLE,
            colors: ['W'],
            power: '6',
            toughness: '6',
          },
        ],
        handCount: 1,
        library: [],
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

    await handlers['requestCastSpell']({ gameId, cardId: 'overlord_1' });

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (entry: any) => entry.type === 'mana_payment_choice' && entry.spellPaymentRequired === true,
    ) as any;
    expect(paymentStep).toBeDefined();
    expect(paymentStep.extraAlternateCosts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'impending', manaCost: '{2}{W}{W}' }),
    ]));

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: {
        alternateCostId: 'impending',
        payment: [
          { permanentId: 'plains_1', mana: 'W', count: 1 },
          { permanentId: 'plains_2', mana: 'W', count: 1 },
        ],
        poolPayment: { colorless: 2 },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Drain any intervening stack/queue work until Overlord is on BF or stack top is Overlord ready to resolve
    for (let i = 0; i < 8; i++) {
      const stack = ((game.state as any).stack || []) as any[];
      if (stack.length === 0) break;
      game.resolveTopOfStack();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const overlord = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.name || '') === 'Overlord of the Mistmoors',
    );
    expect(overlord).toBeDefined();
    expect(Boolean(overlord?.impendingCostWasPaid || overlord?.wasImpendingCast)).toBe(true);
    expect(Number(overlord?.counters?.time || 0)).toBe(4);
    expect(Boolean(overlord?.notCreature)).toBe(true);

    // End step should remove one time counter
    (game.state as any).phase = 'postcombatMain';
    (game.state as any).step = 'MAIN2';
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    game.nextStep();
    expect((game.state as any).step).toBe('END');
    expect(Number(overlord?.counters?.time || 0)).toBe(3);
    expect(Boolean(overlord?.notCreature)).toBe(true);
  });
});
