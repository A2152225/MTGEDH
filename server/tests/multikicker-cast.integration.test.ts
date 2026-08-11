import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { requestCastSpellForSocket } from '../src/socket/game-actions.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { canAIAssembleSpellPaymentPlan } from '../src/socket/ai.js';
import { parseManaCost } from '../src/state/modules/mana-check.js';
import {
  chooseMultikickerTimesForChargeInvest,
  expandManaCostWithMultikicker,
  parseMultikickerManaCost,
} from '../src/state/modules/multikickerCastUtils.js';

const EVERFLOWING_ORACLE =
  'Multikicker {2} (You may pay an additional {2} any number of times as you cast this spell.)\n' +
  'This artifact enters with a charge counter on it for each time it was kicked.\n' +
  '{T}: Add {C} for each charge counter on this artifact.';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ event: string; payload: any }>) {
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

describe('multikicker cast integration', () => {
  const gameId = 'test_multikicker_everflowing_cast';
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  });

  afterEach(async () => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  });

  it('casts charge-invest multikicker with timesKicked and enters with charge counters', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(gameId as any, game as any);

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).phase = 'main1';
    (game.state as any).step = 'MAIN1';
    (game.state as any).priority = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).turnPlayer = playerId;
    (game.state as any).turnNumber = 3;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [];
    (game.state as any).manaPool = {
      [playerId]: {
        W: 0, U: 0, B: 0, R: 0, G: 0, C: 4,
        white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 4,
      },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [{
          id: 'everflowing_1',
          name: 'Everflowing Chalice',
          type_line: 'Artifact',
          mana_cost: '{0}',
          oracle_text: EVERFLOWING_ORACLE,
        }],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    const emitted: Array<{ event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createNoopIo();
    registerResolutionHandlers(io as any, socket as any);

    await requestCastSpellForSocket(
      io as any,
      socket as any,
      { gameId, cardId: 'everflowing_1' },
      { timesKicked: 2 },
    );

    const paymentStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step: any) => step.type === 'mana_payment_choice' && step.spellPaymentRequired === true) as any;
    expect(paymentStep).toBeDefined();
    const paymentCostText = String(paymentStep.manaCost || paymentStep.totalManaCost || '');
    expect(
      paymentCostText === '{4}'
      || paymentCostText === '{0}{2}{2}'
      || paymentCostText.includes('{2}{2}'),
    ).toBe(true);

    const pending = Object.values((game.state as any).pendingSpellCasts || {})[0] as any;
    expect(pending?.timesKicked).toBe(2);
    expect(
      String(pending?.manaCost || '') === '{0}{2}{2}'
      || String(pending?.manaCost || '') === '{4}',
    ).toBe(true);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(paymentStep.id),
      selections: { payment: [] },
      cancelled: false,
    });

    expect(emitted.filter((entry) => entry.event === 'error')).toHaveLength(0);
    expect((game.state as any).stack).toHaveLength(1);
    const stackItem = (game.state as any).stack[0];
    expect(stackItem?.timesKicked ?? stackItem?.card?.timesKicked).toBe(2);
    expect(stackItem?.wasKicked ?? stackItem?.card?.wasKicked).toBe(true);
    expect(
      stackItem?.entersBattlefieldWithCounters ?? stackItem?.card?.entersBattlefieldWithCounters,
    ).toEqual({ charge: 2 });

    if (typeof (game as any).resolveTopOfStack === 'function') {
      (game as any).resolveTopOfStack();
    } else {
      const { persistAndResolveTopOfStack } = await import('../src/socket/util.js');
      await persistAndResolveTopOfStack(io as any, gameId);
    }

    const permanent = ((game.state as any).battlefield || []).find((entry: any) =>
      String(entry?.card?.name || '') === 'Everflowing Chalice',
    );
    expect(permanent).toBeTruthy();
    expect(Number(permanent?.counters?.charge || 0)).toBe(2);
  }, 15000);

  it('AI can assemble payment for max affordable multikicker invest', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(gameId as any, game as any);

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
    ];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 6 },
    };
    (game.state as any).battlefield = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [{
          id: 'everflowing_ai',
          name: 'Everflowing Chalice',
          type_line: 'Artifact',
          mana_cost: '{0}',
          oracle_text: EVERFLOWING_ORACLE,
        }],
        handCount: 1,
        graveyard: [],
        exile: [],
        library: [],
      },
    };

    const times = chooseMultikickerTimesForChargeInvest(game, playerId as any, {
      oracle_text: EVERFLOWING_ORACLE,
      mana_cost: '{0}',
    }, { excludedHandCardIds: ['everflowing_ai'] });
    expect(times).toBe(3);

    const expanded = expandManaCostWithMultikicker(
      '{0}',
      parseMultikickerManaCost(EVERFLOWING_ORACLE),
      times,
    );
    expect(canAIAssembleSpellPaymentPlan(game, playerId as any, parseManaCost(expanded), ['everflowing_ai'])).toBe(true);
  });
});
