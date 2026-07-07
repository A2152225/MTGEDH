import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

const SNEAK_CREATURE_ORACLE =
  'Sneak {1}{R} (You may cast this spell for its sneak cost during your declare blockers step by returning an unblocked attacking creature you control to its owner\'s hand. If you do, this permanent enters tapped and attacking.)';

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

describe('sneak integration', () => {
  const gameId = 'test_sneak_integration';
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

  it('returns an unblocked attacker and enters tapped and attacking via sneak', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).phase = 'combat';
    (game.state as any).step = 'DECLARE_BLOCKERS';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).turnNumber = 3;
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 0 },
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
      {
        id: 'attacker_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        attacking: opponentId,
        card: {
          id: 'attacker_card_1',
          name: 'Goblin Guide',
          type_line: 'Creature — Goblin Scout',
          oracle_text: 'Haste',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'sneak_creature_1',
            name: 'Sneak Raider',
            mana_cost: '{2}{R}',
            type_line: 'Creature — Human Rogue',
            oracle_text: SNEAK_CREATURE_ORACLE,
            colors: ['R'],
            power: '2',
            toughness: '2',
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
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

    await handlers['requestCastSpell']({ gameId, cardId: 'sneak_creature_1' });

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (entry: any) => entry.type === 'mana_payment_choice' && entry.spellPaymentRequired === true,
    ) as any;
    expect(paymentStep).toBeDefined();
    expect(paymentStep.extraAlternateCosts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sneak', manaCost: '{1}{R}' }),
    ]));

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: {
        alternateCostId: 'sneak',
        sneakReturnedCreatureId: 'attacker_1',
        payment: [{ permanentId: 'mountain_1', mana: 'R', count: 1 }],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    game.resolveTopOfStack();

    expect((((game.state as any).battlefield || []) as any[]).some((perm: any) => String(perm?.id || '') === 'attacker_1')).toBe(false);
    expect((((game.state as any).zones?.[playerId]?.hand || []) as any[]).some((card: any) => String(card?.name || '') === 'Goblin Guide')).toBe(true);

    const sneakPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.name || '') === 'Sneak Raider',
    );
    expect(sneakPermanent).toMatchObject({
      tapped: true,
      attacking: opponentId,
      isAttacking: true,
      sneakCostWasPaid: true,
      summoningSickness: false,
    });
  });
});
