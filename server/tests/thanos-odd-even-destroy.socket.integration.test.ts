import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { hasUsedPowerUpAbility } from '../src/state/modules/marvelMechanicsHelpers.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const THANOS_ODD_EVEN_ORACLE =
  'Power-up — {6}: Put two +1/+1 counters on Thanos. Choose odd or even. Destroy each other creature with mana value of the chosen quality. (Activate each power-up ability only once. Reduce the cost by his mana cost if he entered this turn. Zero is even.)';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try {
    await deleteGame(gameId);
  } catch {
    // test-only cleanup
  }
}

function seedThanosOddEvenGame(game: any, playerId: string) {
  Object.assign(game.state as any, {
    players: [{ id: playerId, name: 'P1', spectator: false, life: 40, isAI: false }],
    startingLife: 40,
    life: { [playerId]: 40 },
    phase: 'precombat_main',
    step: 'MAIN1',
    turnPlayer: playerId,
    activePlayer: playerId,
    turnNumber: 3,
    priority: playerId,
    stack: [],
    manaPool: {
      [playerId]: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    },
    battlefield: [
      {
        id: 'thanos_perm',
        controller: playerId,
        owner: playerId,
        tapped: false,
        enteredThisTurn: true,
        counters: {},
        card: {
          id: 'thanos_card',
          name: 'Thanos, the Mad Titan',
          type_line: 'Legendary Creature — Eternal Villain',
          mana_cost: '{6}',
          cmc: 6,
          oracle_text: THANOS_ODD_EVEN_ORACLE,
        },
      },
      {
        id: 'odd_one',
        controller: playerId,
        owner: playerId,
        card: { name: 'Odd Bear', type_line: 'Creature — Bear', cmc: 1, mana_cost: '{1}' },
      },
      {
        id: 'even_two',
        controller: playerId,
        owner: playerId,
        card: { name: 'Even Bear', type_line: 'Creature — Bear', cmc: 2, mana_cost: '{2}' },
      },
      {
        id: 'odd_three',
        controller: playerId,
        owner: playerId,
        card: { name: 'Odd Bear Three', type_line: 'Creature — Bear', cmc: 3, mana_cost: '{3}' },
      },
    ],
    zones: {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    },
  });
}

describe('Thanos odd/even destroy power-up socket integration (Layer 3)', () => {
  const gameId = 'test_thanos_odd_even_destroy_socket';
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('activates discounted power-up, queues odd/even, and destroys odd-mana-value creatures', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(gameId as any, game as any);
    seedThanosOddEvenGame(game, playerId);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers.activateBattlefieldAbility({
      gameId,
      permanentId: 'thanos_perm',
      abilityId: 'thanos_card-ability-0',
    });

    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
    expect(((game.state as any).stack || []).length).toBe(1);

    game.resolveTopOfStack();

    const thanosAfterCounters = ((game.state as any).battlefield || []).find((perm: any) => perm.id === 'thanos_perm');
    expect(thanosAfterCounters?.counters?.['+1/+1']).toBe(2);
    expect(hasUsedPowerUpAbility(thanosAfterCounters, 0)).toBe(true);

    const steps = ResolutionQueueManager.getQueue(gameId).steps;
    const oddEvenStep = steps.find((step) => step.type === ResolutionStepType.OPTION_CHOICE);
    expect(oddEvenStep).toBeTruthy();
    expect((oddEvenStep as any)?.oracleIrPlayerChoiceKind).toBe('odd_even');

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(oddEvenStep!.id),
      selections: ['odd'],
      cancelled: false,
    });

    expect(emitted.filter((entry) => entry.event === 'error')).toHaveLength(0);

    const battlefieldIds = ((game.state as any).battlefield || []).map((perm: any) => perm.id);
    expect(battlefieldIds).toEqual(['thanos_perm', 'even_two']);

    const thanosFinal = ((game.state as any).battlefield || []).find((perm: any) => perm.id === 'thanos_perm');
    expect(thanosFinal?.counters?.['+1/+1']).toBe(2);
    expect(((game.state as any).stack || []).length).toBe(0);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  }, 15000);
});
