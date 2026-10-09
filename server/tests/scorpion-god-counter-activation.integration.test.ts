import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

// Quoted from The Scorpion God oracle (mtg_data.db cards.text, is_token = 0).
const SCORPION_ORACLE =
  'Whenever a creature with a -1/-1 counter on it dies, you draw a card and you gain 1 life.\n{1}{B}{R}: Put a -1/-1 counter on another target creature.\nWhen The Scorpion God dies, return it to its owner\'s hand at the beginning of the next end step.';

function createNoopIo() {
  return {
    to: () => ({ emit: () => {} }),
    emit: () => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ event: string; payload: any }>, gameId: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => { handlers[event] = handler; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  } as any;
  return { socket, handlers };
}

describe('The Scorpion God -1/-1 counter activation', () => {
  const gameId = 'test_scorpion_god_counter';
  const p1 = 'p1';
  const p2 = 'p2';

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

  function setupGame(manaPool: Record<string, number>) {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    Object.assign(game.state as any, {
      players: [
        { id: p1, name: 'P1', spectator: false, life: 40 },
        { id: p2, name: 'P2', spectator: false, life: 40 },
      ],
      startingLife: 40,
      life: { [p1]: 40, [p2]: 40 },
      phase: 'precombatMain',
      step: 'MAIN1',
      turnPlayer: p1,
      priority: p1,
      stack: [],
      manaPool: { [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, ...manaPool } },
      battlefield: [
        {
          id: 'scorpion_1',
          controller: p1,
          owner: p1,
          tapped: false,
          summoningSickness: false,
          counters: {},
          card: {
            id: 'scorpion_card',
            name: 'The Scorpion God',
            type_line: 'Legendary Creature — God',
            oracle_text: SCORPION_ORACLE,
          },
        },
        {
          id: 'bear_1',
          controller: p2,
          owner: p2,
          tapped: false,
          card: {
            id: 'bear_card',
            name: 'Grizzly Bears',
            type_line: 'Creature — Bear',
            oracle_text: '',
          },
        },
        land('swamp_1', 'Swamp', '{T}: Add {B}.'),
        land('mountain_1', 'Mountain', '{T}: Add {R}.'),
        land('wastes_1', 'Wastes', '{T}: Add {C}.'),
      ],
    });
    return game;
  }

  it('queues mana payment instead of a target when {1}{B}{R} is not floating', async () => {
    setupGame({});
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io, socket);
    registerResolutionHandlers(io, socket);

    await handlers.activateBattlefieldAbility({
      gameId,
      permanentId: 'scorpion_1',
      abilityId: 'scorpion_card-counter-0',
    });

    expect(emitted.find((entry) => entry.event === 'error')).toBeUndefined();
    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(queue.steps[0]?.type).toBe(ResolutionStepType.MANA_PAYMENT_CHOICE);
    expect((queue.steps[0] as any).activationPaymentContext).toBe('battlefield_counter_target');
    expect((queue.steps[0] as any).counterType).toBe('-1/-1');
  });

  it('prompts for another creature and keeps the source off the target list when mana is paid', async () => {
    setupGame({ colorless: 1, black: 1, red: 1 });
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io, socket);
    registerResolutionHandlers(io, socket);

    await handlers.activateBattlefieldAbility({
      gameId,
      permanentId: 'scorpion_1',
      abilityId: 'scorpion_card-counter-0',
    });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(queue.steps[0]?.type).toBe(ResolutionStepType.COUNTER_TARGET);
    expect((queue.steps[0] as any).counterType).toBe('-1/-1');
    const targetIds = ((queue.steps[0] as any).validTargets || []).map((target: any) => target.id);
    expect(targetIds).toContain('bear_1');
    expect(targetIds).not.toContain('scorpion_1');

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String((queue.steps[0] as any).id),
      selections: ['bear_1'],
    });

    const stack = ((ensureGame(gameId)?.state as any).stack || []);
    expect(stack).toHaveLength(1);
    expect(stack[0]).toMatchObject({
      abilityType: 'add_counter',
      targets: ['bear_1'],
      counterParams: { counterType: '-1/-1', targetId: 'bear_1' },
    });
  });
});

function land(id: string, name: string, oracle: string) {
  return {
    id,
    controller: 'p1',
    owner: 'p1',
    tapped: false,
    card: {
      id: `${id}_card`,
      name,
      type_line: name === 'Wastes' ? 'Basic Land' : `Basic Land — ${name}`,
      oracle_text: oracle,
    },
  };
}
