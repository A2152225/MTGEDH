import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { resolveTopOfStack } from '../src/state/modules/stack.js';
import {
  isCounterPreventingAttack,
  isCounterPreventingBlock,
} from '../../shared/src/counterCombatRestrictions.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => {},
    }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
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

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId?: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('Gwafa Hazid bribery counter activation (integration)', () => {
  const gameId = 'test_gwafa_bribery_counter';
  const p1 = 'p1';
  const p2 = 'p2';

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
      turnPlayer: p1,
      priority: p1,
      stack: [],
      manaPool: {
        [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, ...manaPool },
      },
      battlefield: [
        {
          id: 'gwafa_1',
          controller: p1,
          owner: p1,
          tapped: false,
          summoningSickness: false,
          card: {
            id: 'gwafa_card',
            name: 'Gwafa Hazid, Profiteer',
            type_line: 'Legendary Creature — Human Rogue',
            oracle_text: "{W}{U}, {T}: Put a bribery counter on target creature you don't control. Its controller draws a card.\nCreatures with bribery counters on them can't attack or block.",
          },
        },
        {
          id: 'plains_1',
          controller: p1,
          owner: p1,
          tapped: false,
          card: {
            id: 'plains_card',
            name: 'Plains',
            type_line: 'Basic Land — Plains',
            oracle_text: '{T}: Add {W}.',
          },
        },
        {
          id: 'island_1',
          controller: p1,
          owner: p1,
          tapped: false,
          card: {
            id: 'island_card',
            name: 'Island',
            type_line: 'Basic Land — Island',
            oracle_text: '{T}: Add {U}.',
          },
        },
        {
          id: 'opp_creature_1',
          controller: p2,
          owner: p2,
          tapped: false,
          card: {
            id: 'opp_creature_card',
            name: 'Fyndhorn Elves',
            type_line: 'Creature — Elf Druid',
            oracle_text: '{T}: Add {G}.',
          },
        },
      ],
    });

    return game;
  }

  it('queues mana payment when {W}{U} is not in the pool but lands can pay', async () => {
    setupGame({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'gwafa_1',
      abilityId: 'gwafa_card-ability-0',
    });

    const errorEvent = emitted.find((entry) => entry.event === 'error');
    expect(errorEvent).toBeUndefined();

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(queue.steps[0]?.type).toBe(ResolutionStepType.MANA_PAYMENT_CHOICE);
    expect((queue.steps[0] as any).activationPaymentContext).toBe('battlefield_counter_target');
    expect(String((queue.steps[0] as any).manaCost || '').toUpperCase()).toBe('{W}{U}');
  });

  it('queues counter target selection immediately when {W}{U} is already in the pool', async () => {
    setupGame({ white: 1, blue: 1, black: 0, red: 0, green: 0, colorless: 0 });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'gwafa_1',
      abilityId: 'gwafa_card-ability-0',
    });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(queue.steps[0]?.type).toBe(ResolutionStepType.COUNTER_TARGET);
    expect((queue.steps[0] as any).counterType).toBe('bribery');
    expect(Boolean(((ensureGame(gameId)?.state as any).battlefield || []).find((perm: any) => perm.id === 'gwafa_1')?.tapped)).toBe(true);
  });

  it('puts Gwafa counter ability on the stack after target selection so opponents can respond', async () => {
    setupGame({ white: 1, blue: 1, black: 0, red: 0, green: 0, colorless: 0 });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'gwafa_1',
      abilityId: 'gwafa_card-ability-0',
    });

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === ResolutionStepType.COUNTER_TARGET);
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((step as any).id),
      selections: ['opp_creature_1'],
    });

    const game = ensureGame(gameId);
    expect(game).toBeDefined();
    const stack = (game!.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]).toMatchObject({
      type: 'ability',
      controller: p1,
      source: 'gwafa_1',
      abilityType: 'add_counter',
      targets: ['opp_creature_1'],
    });
    expect((stack[0] as any).counterParams?.counterType).toBe('bribery');

    const targetBefore = ((game!.state as any).battlefield || []).find((perm: any) => perm.id === 'opp_creature_1');
    expect(Number(targetBefore?.counters?.bribery || 0)).toBe(0);

    resolveTopOfStack({
      state: game!.state,
      libraries: (game as any).libraries,
      bumpSeq: () => {
        if (typeof (game as any).bumpSeq === 'function') {
          (game as any).bumpSeq();
        }
      },
      rng: Math.random,
      gameId,
    } as any);

    const targetAfter = ((game!.state as any).battlefield || []).find((perm: any) => perm.id === 'opp_creature_1');
    expect(Number(targetAfter?.counters?.bribery || 0)).toBe(1);
    expect((game!.state as any).stack || []).toHaveLength(0);
  });

  it('prevents bribery-marked creatures from attacking or blocking while Gwafa remains on the battlefield', async () => {
    setupGame({ white: 1, blue: 1, black: 0, red: 0, green: 0, colorless: 0 });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'gwafa_1',
      abilityId: 'gwafa_card-ability-0',
    });

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === ResolutionStepType.COUNTER_TARGET);
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((step as any).id),
      selections: ['opp_creature_1'],
    });

    const game = ensureGame(gameId)!;
    resolveTopOfStack({
      state: game.state,
      libraries: (game as any).libraries,
      bumpSeq: () => {
        if (typeof (game as any).bumpSeq === 'function') {
          (game as any).bumpSeq();
        }
      },
      rng: Math.random,
      gameId,
    } as any);

    const battlefield = (game.state as any).battlefield || [];
    const target = battlefield.find((perm: any) => perm.id === 'opp_creature_1');
    expect(Number(target?.counters?.bribery || 0)).toBe(1);
    expect(isCounterPreventingAttack(target, battlefield).isPrevented).toBe(true);
    expect(isCounterPreventingBlock(target, battlefield).isPrevented).toBe(true);

    (game.state as any).battlefield = battlefield.filter((perm: any) => perm.id !== 'gwafa_1');
    const battlefieldWithoutGwafa = (game.state as any).battlefield;
    expect(isCounterPreventingAttack(target, battlefieldWithoutGwafa).isPrevented).toBe(false);
    expect(isCounterPreventingBlock(target, battlefieldWithoutGwafa).isPrevented).toBe(false);
  });
});
