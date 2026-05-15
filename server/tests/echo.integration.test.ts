import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { getUpkeepTriggersForPlayer } from '../src/state/modules/upkeep-triggers.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: {
      sockets: new Map(),
    },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])),
    },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, gameId, spectator: false },
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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('Echo upkeep trigger integration', () => {
  const gameId = 'test_echo_upkeep_integration';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('queues an optional payment prompt and marks echo as paid when the controller pays', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UPKEEP';
    (game.state as any).turnNumber = 2;
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 2, blue: 0, black: 0, red: 0, green: 0, colorless: 3 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'echo_perm_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        enteredThisTurn: true,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'echo_card_1',
          name: 'Karmic Guide',
          type_line: 'Creature - Angel Spirit',
          oracle_text: 'Flying, protection from black\nEcho {3}{W}{W}\nWhen Karmic Guide enters, return target creature card from your graveyard to the battlefield.',
          power: '2',
          toughness: '2',
        },
      },
    ];

    const upkeepTrigger = getUpkeepTriggersForPlayer(game as any, playerId).find(
      (trigger: any) => String(trigger?.triggerType || '') === 'echo'
    );
    expect(upkeepTrigger).toBeDefined();

    (game.state as any).stack.push({
      id: 'echo_trigger_1',
      type: 'triggered_ability',
      controller: playerId,
      source: 'echo_perm_1',
      permanentId: 'echo_perm_1',
      sourceName: 'Karmic Guide',
      description: String(upkeepTrigger?.description || ''),
      effect: String(upkeepTrigger?.description || ''),
      triggerType: 'echo',
      mandatory: false,
    });

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    const payStep = queue.steps.find((step: any) => (step as any)?.optionalPaymentPrompt === true) as any;
    expect(payStep).toBeDefined();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(payStep.id),
      selections: 'pay_echo',
    });

    const permanent = ((game.state as any).battlefield || []).find((entry: any) => String(entry?.id || '') === 'echo_perm_1');
    expect(permanent).toBeDefined();
    expect(Boolean((permanent as any)?.echoPaid)).toBe(true);
  });

  it('does not trigger echo for a permanent that is no longer newly controlled', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'echo_perm_old_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        enteredThisTurn: false,
        counters: {},
        card: {
          id: 'echo_card_old_1',
          name: 'Karmic Guide',
          type_line: 'Creature - Angel Spirit',
          oracle_text: 'Flying, protection from black\nEcho {3}{W}{W}\nWhen Karmic Guide enters, return target creature card from your graveyard to the battlefield.',
          power: '2',
          toughness: '2',
        },
      },
    ];

    const upkeepTriggers = getUpkeepTriggersForPlayer(game as any, playerId);
    expect(upkeepTriggers.some((trigger: any) => String(trigger?.triggerType || '') === 'echo')).toBe(false);
  });
});